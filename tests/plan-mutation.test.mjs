/**
 * Plan mutation acceptance: validation, staged activation, replanning, and the
 * blocker gate (architecture §9, §10, §11; ADR024, ADR026, ADR028 §5.5).
 *
 * The invariants this suite holds, checked directly rather than through the code
 * that claims them:
 *
 * - a cycle, a stale plan revision, and an inadmissible change to a running task
 *   are all refused *before* anything is written;
 * - a composite mutation with `dep_remove` goes through the staged path: the
 *   admission pause and the intent are durable before the graph is touched, the
 *   parts are applied separately, and nothing is admitted until integrity
 *   verification has passed;
 * - a failure in the middle leaves `PLAN_MUTATION_RECOVERY` with the pause in
 *   place, and a partially visible DAG never appears on any path;
 * - the additive-only classifier answers `true` for creations and for edges
 *   between creations, and `false` for anything that touches what exists;
 * - the blocker gate is derived, so it is open exactly while a frozen blocker has
 *   an unsatisfied dependent, and only the decision is stored.
 *
 * Time comes from `FakeClock`; databases live in fresh temporary directories; the
 * live `$DSH_HOME` state, the board, and the DSH profile are never touched. The
 * task graph is a local fake, so the suite needs neither `bd` nor a model.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { adapterTesting, contracts, core, evidence, lease, planner, storage } from './lib/fixtures.mjs'

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-plan-'

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) {
    // Refuse anything this suite did not create, and treat a locked database as a
    // best-effort cleanup: the assertion below is what protects the filesystem.
    assert.ok(dir.startsWith(join(tmpdir(), TEMP_PREFIX)), `refusing to remove ${dir}`)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // A store left open by a failing test keeps the file locked on Windows.
    }
  }
})

/** Operation identity for one call. */
function meta(overrides = {}) {
  return core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1', ...overrides })
}

/** A dependency edge fixture. */
function edge(from, to, kind = 'blocks') {
  return { from, to, kind }
}

/** A plan mutation intent fixture. */
function intent(overrides = {}) {
  const { command = {}, ...rest } = overrides
  return {
    workspaceId: 'W-1',
    origin: 'replan',
    command: { baseRevision: 1, meta: meta(), ...command },
    ...rest,
  }
}

/** A graph observation fixture: T-1 and T-2 wait for the done task T-3. */
function observation(overrides = {}) {
  return {
    planRevision: 1,
    states: { 'T-1': 'ready', 'T-2': 'ready', 'T-3': 'done' },
    edges: [edge('T-1', 'T-3')],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Fixtures for the staged scenarios: a temporary store, a fake task graph, and
// a clock. No `bd`, no model, no DSH profile.
// ---------------------------------------------------------------------------

/**
 * Open a temporary controller database carrying every schema the planner writes
 * through. The plan tables, the audit, and the artifact of one operation must be
 * in the same file, because they commit in the same transaction (§48).
 */
async function openPlannerDatabase(clock) {
  return storage.openStore({
    path: join(tempDir(), 'controller.sqlite'),
    migrations: [
      ...storage.MYWORK_MIGRATIONS,
      ...evidence.EVIDENCE_MIGRATIONS,
      ...lease.LEASE_MIGRATIONS,
      ...planner.PLAN_MUTATION_MIGRATIONS,
    ],
    clock: { now: () => clock.now() },
  })
}

/**
 * A deterministic `TaskGraphPort`: an in-memory graph with call counters, an
 * order history, and injectable failures, so the staged operation is exercised
 * without a subprocess. It deliberately enforces the transition table, so a test
 * cannot make the planner "succeed" through an illegal move.
 */
function fakeGraph(options = {}) {
  const tasks = new Map()
  const edges = new Map()
  const calls = { mutatePlan: 0, transition: 0, create: 0, dependencies: 0, get: 0 }
  const history = []
  let created = 0
  const key = (from, to) => `${from}\u0000${to}`
  return {
    tasks,
    edges,
    calls,
    history,
    addTask(id, state = 'ready', extra = {}) {
      tasks.set(id, { id, workspaceId: 'W-1', title: id, description: '', state, revision: 1, ...extra })
      return this
    },
    addEdge(from, to) {
      edges.set(key(from, to), { from, to, kind: 'blocks' })
      return this
    },
    edgePairs() {
      return [...edges.values()]
        .map(entry => `${entry.from}->${entry.to}`)
        .sort()
    },
    port: {
      capabilities: async () => ({
        adapterId: 'fake',
        contractVersion: 'taskgraph/v1',
        capabilities: {},
        source: 'declared',
      }),
      get: async id => {
        calls.get += 1
        const task = tasks.get(id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${id}"`)
        return Object.freeze({
          ...task,
          dependsOn: [...edges.values()].filter(entry => entry.from === id).map(entry => entry.to),
        })
      },
      ready: async () =>
        [...tasks.values()].filter(task => task.state === 'ready').map(task => ({ id: task.id, state: task.state })),
      blocked: async () => [],
      claim: async () => ({ won: true }),
      transition: async command => {
        calls.transition += 1
        history.push(`transition:${command.id}->${command.to}`)
        if (options.onTransition !== undefined) await options.onTransition(command)
        const task = tasks.get(command.id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${command.id}"`)
        if (!core.canTransitionTask(task.state, command.to)) {
          throw new core.MyWorkError('TASK_CONFLICT', `illegal transition ${task.state} → ${command.to}`)
        }
        task.state = command.to
        task.revision += 1
        return Object.freeze({ ...task })
      },
      dependencies: async id => {
        calls.dependencies += 1
        history.push('dependencies')
        return [...edges.values()].filter(entry => id === undefined || entry.from === id || entry.to === id)
      },
      mutatePlan: async command => {
        calls.mutatePlan += 1
        history.push(`mutatePlan:${(command.create ?? []).length}c${(command.addDependencies ?? []).length}a${(command.removeDependencies ?? []).length}r`)
        if (options.onMutatePlan !== undefined) await options.onMutatePlan(command)
        const mapping = {}
        for (const spec of command.create ?? []) {
          created += 1
          const id = `mw-${created}`
          calls.create += 1
          mapping[spec.key] = id
          tasks.set(id, {
            id,
            workspaceId: 'W-1',
            title: spec.title,
            description: spec.description ?? '',
            state: 'ready',
            revision: 1,
            ...(spec.priority === undefined ? {} : { priority: spec.priority }),
            ...(spec.externalRef === undefined ? {} : { externalRef: spec.externalRef }),
          })
        }
        for (const entry of command.addDependencies ?? []) {
          edges.set(key(entry.from, entry.to), { from: entry.from, to: entry.to, kind: entry.kind ?? 'blocks' })
        }
        // `bd create --graph` wires the intra-plan keys itself, so the composite
        // form of a create carries them and the fake reproduces that: a staged
        // create never sees them, because the planner strips them first.
        for (const spec of command.create ?? []) {
          for (const dependency of spec.dependsOnKeys ?? []) {
            const from = mapping[spec.key]
            const to = mapping[dependency]
            if (from !== undefined && to !== undefined) {
              edges.set(key(from, to), { from, to, kind: 'blocks' })
            }
          }
        }
        for (const entry of command.removeDependencies ?? []) edges.delete(key(entry.from, entry.to))
        if (options.afterMutatePlan !== undefined) await options.afterMutatePlan(command)
        const atomic =
          (command.create ?? []).length > 0
          && (command.addDependencies ?? []).length === 0
          && (command.removeDependencies ?? []).length === 0
          && (command.update ?? []).length === 0
        return {
          mode: atomic ? 'atomic' : 'staged',
          created: mapping,
          addedDependencies: command.addDependencies ?? [],
          removedDependencies: command.removeDependencies ?? [],
        }
      },
      doctor: async () => [],
    },
  }
}

/**
 * A store wrapper that can be "killed": once killed, every transaction refuses, so
 * nothing more is journalled — which is what a controller dying mid-operation
 * looks like from the journal's point of view.
 */
function crashableStore(store) {
  const state = { killed: false }
  return {
    state,
    kill() {
      state.killed = true
    },
    get path() {
      return store.path
    },
    get schemaVersion() {
      return store.schemaVersion
    },
    get migrations() {
      return store.migrations
    },
    get outbox() {
      return store.outbox
    },
    get inbox() {
      return store.inbox
    },
    transaction(fn) {
      if (state.killed) throw new Error('simulated controller kill: the writer is gone')
      return store.transaction(fn)
    },
    close() {
      store.close()
    },
  }
}

/** Assert that a validation refused with one code and return the failure. */
function refused(result, code) {
  assert.equal(result.ok, false, `expected a refusal with ${code}, received a value`)
  assert.equal(result.error.code, code)
  return result.error
}

// ---------------------------------------------------------------------------
// A. Pure policy: what a plan may do at all
// ---------------------------------------------------------------------------

test('a plan that asks for nothing is refused before anything is read', () => {
  const error = refused(core.validatePlanMutation(intent(), observation()), 'TASK_CONFLICT')
  assert.equal(error.details.reason, 'empty-mutation')
})

test('a plan that would close a cycle is refused before any write', () => {
  const cyclic = intent({ command: { addDependencies: [edge('T-3', 'T-1')] } })
  const error = refused(core.validatePlanMutation(cyclic, observation()), 'ENTITY_CYCLE')
  assert.deepEqual(error.details.path, ['T-1', 'T-3', 'T-1'])
})

test('reversing an edge is legal: the removed edge is excluded from the cycle check', () => {
  const reversed = intent({
    command: {
      addDependencies: [edge('T-3', 'T-1')],
      removeDependencies: [edge('T-1', 'T-3')],
    },
  })
  const result = core.validatePlanMutation(reversed, observation())
  assert.equal(result.ok, true, 'removing A→B and adding B→A is a rewire, not a cycle')
  assert.equal(result.value.mutationClass, 'destructive')
})

test('a stale base revision is refused and an equal one is accepted', () => {
  const stale = intent({ command: { baseRevision: 4, addDependencies: [edge('T-2', 'T-3')] } })
  const error = refused(core.validatePlanMutation(stale, observation()), 'STALE_REVISION')
  assert.equal(error.details.expectedRevision, 4)
  assert.equal(error.details.actualRevision, 1)

  const current = intent({ command: { baseRevision: 1, addDependencies: [edge('T-2', 'T-3')] } })
  assert.equal(core.validatePlanMutation(current, observation()).ok, true)
})

test('the planner may not touch existing work; the separate replan path may', () => {
  const command = { update: [{ id: 'T-1', title: 'renamed' }] }
  const planner = intent({ origin: 'planner', command })
  const error = refused(core.validatePlanMutation(planner, observation()), 'PLANNER_SCOPE_DENIED')
  assert.equal(error.details.mutationClass, 'modifying')
  assert.deepEqual(error.details.refused, ['T-1'])

  const replan = intent({ origin: 'replan', command })
  assert.equal(core.validatePlanMutation(replan, observation()).ok, true)
})

test('a running task is refused without a policy, and named with one', () => {
  const running = observation({ states: { 'T-1': 'executing', 'T-2': 'ready', 'T-3': 'done' } })
  const touch = { update: [{ id: 'T-1', title: 'renamed' }] }

  const withoutPolicy = refused(core.validatePlanMutation(intent({ command: touch }), running), 'TASK_CONFLICT')
  assert.deepEqual(withoutPolicy.details.tasks, ['T-1'])
  assert.deepEqual(withoutPolicy.details.legalPolicies, contracts.RUNNING_TASK_POLICIES)
  assert.equal(withoutPolicy.details.reason, 'running-task-policy-required')

  for (const policy of contracts.RUNNING_TASK_POLICIES) {
    const error = refused(
      core.validatePlanMutation(intent({ command: touch, runningTaskPolicy: policy }), running),
      'TASK_CONFLICT',
    )
    assert.equal(error.details.policy, policy)
    assert.equal(error.details.reason, 'running-task-protected')
    assert.ok(
      typeof error.details.legalPath === 'string' && error.details.legalPath.length > 0,
      `policy ${policy} must name the legal path`,
    )
  }
})

test('an edge to a task that exists nowhere is refused', () => {
  const ghost = intent({ command: { addDependencies: [edge('T-1', 'T-ghost')] } })
  const error = refused(core.validatePlanMutation(ghost, observation()), 'TASK_CONFLICT')
  assert.deepEqual(error.details.unknown, ['T-ghost'])
  assert.equal(error.details.reason, 'unknown-edge-endpoint')
})

test('an intra-plan dependency on an unknown key is refused', () => {
  const broken = intent({
    command: { create: [{ key: 'a', title: 'A', dependsOnKeys: ['missing'] }] },
  })
  const error = refused(core.validatePlanMutation(broken, observation()), 'TASK_CONFLICT')
  assert.equal(error.details.reason, 'unknown-plan-key')
})

test('atomicity is refused rather than emulated when the caller demands it', () => {
  const composite = intent({
    command: { create: [{ key: 'a', title: 'A' }], removeDependencies: [edge('T-1', 'T-3')] },
    requireAtomic: true,
  })
  const error = refused(core.validatePlanMutation(composite, observation()), 'PLAN_MUTATION_STAGED')
  assert.equal(error.details.reason, 'atomic-not-expressible')

  const createOnly = intent({
    command: { create: [{ key: 'a', title: 'A' }] },
    requireAtomic: true,
  })
  assert.equal(core.validatePlanMutation(createOnly, observation()).ok, true)
})

test('the additive-only classifier is true only for creations and edges between them', () => {
  const base = observation()
  const cases = [
    ['create only', { create: [{ key: 'a', title: 'A' }] }, true],
    ['edge between two new tasks', {
      create: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }],
      addDependencies: [edge('b', 'a')],
    }, true],
    ['intra-plan key dependency', {
      create: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B', dependsOnKeys: ['a'] }],
    }, true],
    ['edge to an existing task', {
      create: [{ key: 'a', title: 'A' }],
      addDependencies: [edge('a', 'T-3')],
    }, false],
    ['edge from an existing task', {
      create: [{ key: 'a', title: 'A' }],
      addDependencies: [edge('T-2', 'a')],
    }, false],
    ['any update', { create: [{ key: 'a', title: 'A' }], update: [{ id: 'T-2', title: 'x' }] }, false],
    ['a priority change', {
      create: [{ key: 'a', title: 'A' }],
      update: [{ id: 'T-2', priority: 4 }],
    }, false],
    ['a removed edge', { removeDependencies: [edge('T-1', 'T-3')] }, false],
  ]
  for (const [label, command, expected] of cases) {
    const candidate = intent({ command })
    assert.equal(
      core.isAdditiveOnly(candidate),
      expected,
      `${label} must be ${expected ? 'additive' : 'non-additive'}`,
    )
  }

  const scopeChange = intent({ command: { create: [{ key: 'a', title: 'A' }] }, retire: [{ taskId: 'T-2', to: 'superseded' }] })
  assert.equal(core.isAdditiveOnly(scopeChange), false, 'retiring a task is never additive')
  assert.equal(core.classifyPlanMutation(scopeChange), 'destructive')
  assert.equal(core.classifyPlanMutation(intent({ command: { removeDependencies: [edge('T-1', 'T-3')] } })), 'destructive')
  assert.equal(core.classifyPlanMutation(intent({ command: { update: [{ id: 'T-2', priority: 2 }] } })), 'modifying')
})

test('every existing task is classified by the revision (§10.3)', () => {
  const candidate = intent({
    command: {
      create: [{ key: 'c', title: 'C' }],
      update: [{ id: 'T-1', title: 'renamed' }],
      addDependencies: [edge('T-3', 'T-2')],
    },
    retire: [{ taskId: 'T-2', to: 'superseded' }],
  })
  const review = core.reviewPlanMutation(
    candidate,
    observation({ states: { 'T-1': 'ready', 'T-2': 'ready', 'T-3': 'done', 'T-4': 'ready' } }),
  )
  const byId = Object.fromEntries(review.changes.map(change => [change.taskId, change]))
  assert.deepEqual(Object.keys(byId).sort(), ['T-1', 'T-2', 'T-3', 'T-4', 'c'])
  assert.deepEqual(byId['T-1'].class, 'modified')
  assert.deepEqual(byId['T-1'].reasons, ['title'])
  assert.equal(byId['T-2'].class, 'superseded')
  assert.deepEqual(byId['T-3'].class, 'modified')
  assert.deepEqual(byId['T-3'].reasons, ['dependency-added'])
  assert.equal(byId['T-4'].class, 'unchanged')
  assert.deepEqual(byId['T-4'].reasons, [])
  assert.equal(byId['c'].class, 'newly-created')
  assert.deepEqual(
    review.changes.map(change => change.class).sort(),
    ['modified', 'modified', 'newly-created', 'superseded', 'unchanged'].sort(),
  )
  assert.deepEqual(review.runningTasksTouched, [])
})

test('the parts split creations from edges and keep intra-plan keys out of the create call', () => {
  const candidate = intent({
    command: {
      create: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B', dependsOnKeys: ['a'] }],
      update: [{ id: 'T-2', title: 'renamed' }],
      addDependencies: [edge('T-1', 'T-3')],
    },
  })
  const parts = core.planMutationParts(candidate)
  assert.deepEqual(parts.map(part => part.kind), ['create', 'edges', 'fields'])
  assert.deepEqual(
    parts[0].command.create.map(spec => spec.key),
    ['a', 'b'],
  )
  for (const spec of parts[0].command.create) {
    assert.equal(spec.dependsOnKeys, undefined, 'the create part must not carry intra-plan keys')
  }
  const edgesPart = core.materializePlanPart(parts[1], candidate, { a: 'mw-1', b: 'mw-2' })
  assert.deepEqual(
    edgesPart.command.addDependencies.map(planned => `${planned.from}->${planned.to}`).sort(),
    ['T-1->T-3', 'mw-2->mw-1'],
  )

  const atomic = core.planMutationParts(intent({ command: { create: [{ key: 'a', title: 'A' }] }, requireAtomic: true }))
  assert.equal(atomic.length, 1)
  assert.equal(atomic[0].kind, 'create')
})

test('integrity verification compares the intent with the graph, not with the commands', () => {
  const candidate = intent({
    command: {
      create: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B', dependsOnKeys: ['a'] }],
      addDependencies: [edge('T-1', 'T-3')],
      removeDependencies: [edge('T-2', 'T-3')],
    },
  })
  const created = { a: 'mw-1', b: 'mw-2' }
  const clean = core.verifyPlanIntegrity({
    operationId: 'op-1',
    intent: candidate,
    baseRevision: 1,
    observedRevision: 1,
    created,
    observedEdges: [edge('T-1', 'T-3'), edge('mw-2', 'mw-1')],
    observedStates: {},
    checkedAt: 10,
  })
  assert.equal(clean.verified, true)
  assert.deepEqual(clean.missing, [])

  const missingEdge = core.verifyPlanIntegrity({
    operationId: 'op-1',
    intent: candidate,
    baseRevision: 1,
    observedRevision: 1,
    created,
    observedEdges: [edge('T-1', 'T-3')],
    observedStates: {},
    checkedAt: 10,
  })
  assert.equal(missingEdge.verified, false)
  assert.deepEqual(missingEdge.missing, ['mw-2\u0000mw-1'])

  const removalDidNotLand = core.verifyPlanIntegrity({
    operationId: 'op-1',
    intent: candidate,
    baseRevision: 1,
    observedRevision: 1,
    created,
    observedEdges: [edge('T-1', 'T-3'), edge('T-2', 'T-3'), edge('mw-2', 'mw-1')],
    observedStates: {},
    checkedAt: 10,
  })
  assert.equal(removalDidNotLand.verified, false)
  assert.deepEqual(removalDidNotLand.pendingRemovals, ['T-2\u0000T-3'], 'a removal that did not take effect')
  assert.deepEqual(removalDidNotLand.unexpected, [], 'it is work left, not a foreign change')

  const foreign = core.verifyPlanIntegrity({
    operationId: 'op-1',
    intent: candidate,
    baseRevision: 1,
    observedRevision: 1,
    created,
    observedEdges: [edge('T-1', 'T-3'), edge('mw-2', 'mw-1'), edge('T-1', 'T-2')],
    observedStates: {},
    checkedAt: 10,
  })
  assert.equal(foreign.verified, false)
  assert.deepEqual(foreign.unexpected, ['T-1\u0000T-2'], 'an edge between touched tasks nobody asked for')

  const movedRevision = core.verifyPlanIntegrity({
    operationId: 'op-1',
    intent: candidate,
    baseRevision: 1,
    observedRevision: 2,
    created,
    observedEdges: [edge('T-1', 'T-3'), edge('mw-2', 'mw-1')],
    observedStates: {},
    checkedAt: 10,
  })
  assert.equal(movedRevision.verified, false, 'another writer committed a plan while this one was staged')

  const cycle = core.verifyPlanIntegrity({
    operationId: 'op-1',
    intent: intent({ command: { addDependencies: [edge('T-2', 'T-3')] } }),
    baseRevision: 1,
    observedRevision: 1,
    created: {},
    observedEdges: [edge('T-1', 'T-3'), edge('T-2', 'T-3'), edge('T-3', 'T-2')],
    observedStates: {},
    checkedAt: 10,
  })
  assert.deepEqual(cycle.cycle, ['T-3', 'T-2', 'T-3'])
  assert.equal(cycle.verified, false)
})

test('a retirement is journaled as irreversible, and edges and fields as reversible', () => {
  const candidate = intent({
    command: {
      create: [{ key: 'a', title: 'A' }],
      addDependencies: [edge('T-1', 'T-3')],
      removeDependencies: [edge('T-2', 'T-3')],
      update: [{ id: 'T-2', title: 'renamed' }],
    },
    retire: [{ taskId: 'T-3', to: 'cancelled' }],
  })
  const steps = core.planSteps(candidate, { 'T-2': { title: 'before', priority: 2 } })
  const byKind = Object.fromEntries(steps.map(step => [step.kind, step]))
  assert.equal(byKind['create'].reversible, false)
  assert.equal(byKind['retire'].reversible, false)
  assert.equal(byKind['add-edge'].reversible, true)
  assert.equal(byKind['remove-edge'].reversible, true)
  assert.equal(byKind['update'].reversible, true)
  assert.deepEqual(byKind['update'].previous, { title: 'before', priority: '2' })

  const applied = steps.map(step => ({ ...step, state: 'applied' }))
  const inversion = core.invertPlanSteps(applied, meta(), 2)
  assert.deepEqual(
    inversion.irreversible.map(step => step.ref).sort(),
    ['T-3', 'key:a'].sort(),
  )
  const edges = inversion.parts.find(part => part.kind === 'edges')
  assert.deepEqual(
    edges.command.addDependencies.map(planned => `${planned.from}->${planned.to}`),
    ['T-2->T-3'],
  )
  assert.deepEqual(
    edges.command.removeDependencies.map(planned => `${planned.from}->${planned.to}`),
    ['T-1->T-3'],
  )
})

test('the external reference of a plan-created task round-trips', () => {
  const ref = core.planExternalRef('op-9', 'node-a')
  assert.equal(ref, `${contracts.PLAN_EXTERNAL_REF_PREFIX}op-9:node-a`)
  assert.deepEqual(core.parsePlanExternalRef(ref), { operationId: 'op-9', key: 'node-a' })
  assert.equal(core.parsePlanExternalRef('mw-card:MW-011'), undefined)
})

// ---------------------------------------------------------------------------
// B. The derived blocker gate (§5.5)
// ---------------------------------------------------------------------------

test('a cancelled blocker with two dependents opens one gate exactly on those two', () => {
  const states = { 'B-1': 'cancelled', 'D-1': 'blocked', 'D-2': 'planned' }
  const edges = [edge('D-1', 'B-1'), edge('D-2', 'B-1')]
  const observations = core.observeBlockerGates(edges, states, 'W-1')
  assert.equal(observations.length, 1)
  const gates = core.deriveBlockerGates(observations)
  assert.equal(gates.length, 1)
  assert.deepEqual(gates[0].dependents, ['D-1', 'D-2'])
  assert.equal(gates[0].open, true)
  assert.equal(gates[0].awaitingDecision, true)
  assert.equal(gates[0].gateId, 'W-1:B-1')
})

test('a blocker in done opens no gate, and a terminal dependent is not waiting', () => {
  const done = core.deriveBlockerGates(
    core.observeBlockerGates([edge('D-1', 'B-1')], { 'B-1': 'done', 'D-1': 'blocked' }, 'W-1'),
  )
  assert.deepEqual(done, [], 'a blocker in done satisfies its dependency')

  const supersededDependent = core.deriveBlockerGates(
    core.observeBlockerGates(
      [edge('D-1', 'B-1'), edge('D-2', 'B-1')],
      { 'B-1': 'superseded', 'D-1': 'superseded', 'D-2': 'blocked' },
      'W-1',
    ),
  )
  assert.deepEqual(supersededDependent[0].dependents, ['D-2'])
})

test('keep-blocking leaves the gate open but no longer awaiting a decision', () => {
  const observations = core.observeBlockerGates(
    [edge('D-1', 'B-1'), edge('D-2', 'B-1')],
    { 'B-1': 'cancelled', 'D-1': 'blocked', 'D-2': 'blocked' },
    'W-1',
  )
  const decision = {
    decisionId: 'dec-1',
    workspaceId: 'W-1',
    blockerTaskId: 'B-1',
    action: 'keep-blocking',
    dependents: ['D-1', 'D-2'],
    reason: 'the vendor still owes the API key',
    decidedBy: 'operator',
    decidedAt: 5,
    correlationId: 'corr-1',
  }
  const gates = core.deriveBlockerGates(observations, [decision])
  assert.equal(gates[0].open, true)
  assert.equal(gates[0].awaitingDecision, false)
  assert.equal(gates[0].latestDecision.reason, 'the vendor still owes the API key')

  const newer = { ...decision, decisionId: 'dec-2', action: 'void', decidedAt: 9 }
  const latest = core.deriveBlockerGates(observations, [decision, newer])
  assert.equal(latest[0].latestDecision.decisionId, 'dec-2')
})

test('void makes the gate disappear because the condition itself is gone', () => {
  // `void` removes the edges through a staged mutation, so the derivation sees a
  // graph without them: the gate is not "resolved", it no longer exists.
  const afterVoid = core.observeBlockerGates([], { 'B-1': 'cancelled', 'D-1': 'ready', 'D-2': 'ready' }, 'W-1')
  assert.deepEqual(afterVoid, [])
  assert.deepEqual(core.openBlockerGates(afterVoid), [])

  // And while the edges are still there, the dependents are still waiting — the
  // gate does not close by itself just because somebody decided something.
  const stillOpen = core.observeBlockerGates(
    [edge('D-1', 'B-1')],
    { 'B-1': 'cancelled', 'D-1': 'ready' },
    'W-1',
  )
  assert.deepEqual(core.openBlockerGates(stillOpen)[0].dependents, ['D-1'])
})

// ---------------------------------------------------------------------------
// C. Staged activation: pause, journal, separate application, verification
// ---------------------------------------------------------------------------

/** A planner over a fresh temporary store and a fake graph. */
async function plannerFor(clock, graph, options = {}) {
  const real = await openPlannerDatabase(clock)
  const store = options.crashable === true ? crashableStore(real) : real
  return { planner: planner.createPlanner({ store, graph: graph.port, clock }), store, real }
}

/** A graph with one cancelled blocker holding two dependents. */
function blockedGraph(options = {}) {
  const graph = fakeGraph(options)
  graph.addTask('B-1', 'cancelled').addTask('D-1', 'blocked').addTask('D-2', 'blocked')
  graph.addEdge('D-1', 'B-1').addEdge('D-2', 'B-1')
  return graph
}

/** A composite mutation: create one task, drop both blocker edges, release both dependents. */
function compositeIntent(overrides = {}) {
  const { command = {}, ...rest } = overrides
  return {
    workspaceId: 'W-1',
    origin: 'replan',
    command: {
      baseRevision: 0,
      create: [{ key: 'n1', title: 'New work' }],
      removeDependencies: [edge('D-1', 'B-1'), edge('D-2', 'B-1')],
      meta: meta(),
      ...command,
    },
    retire: [
      { taskId: 'D-1', to: 'ready' },
      { taskId: 'D-2', to: 'ready' },
    ],
    ...rest,
  }
}

test('stage records the intent and pauses admission without touching the graph', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const staged = await taskSetter.stage(
      intent({ command: { baseRevision: 0, removeDependencies: [edge('D-1', 'B-1')] } }),
    )
    assert.equal(staged.ok, true)
    assert.equal(staged.value.state, 'staged')
    assert.equal(graph.calls.mutatePlan, 0, 'staging must not write to the graph')
    assert.deepEqual(graph.edgePairs(), ['D-1->B-1', 'D-2->B-1'])
    assert.equal(taskSetter.admissionHeld('W-1'), true, 'admission is paused while the journal is open')
    assert.equal(taskSetter.admissionHold('W-1').operationId, 'op-1')

    const record = store.transaction(tx => planner.readMutation(tx, 'op-1'))
    assert.equal(record.intent.command.removeDependencies.length, 1, 'the whole intent is on disk')
    assert.deepEqual(record.steps.map(step => [step.kind, step.reversible, step.state]), [
      ['remove-edge', true, 'pending'],
    ])
    assert.deepEqual(record.created, {})
    assert.equal(staged.value.runningTaskPolicy, undefined)
  } finally {
    store.close()
  }
})

test('two staged operations cannot share one admission pause', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const first = await taskSetter.stage(
      intent({ command: { baseRevision: 0, removeDependencies: [edge('D-1', 'B-1')] } }),
    )
    assert.equal(first.ok, true)

    const second = await taskSetter.stage(
      intent({
        command: {
          baseRevision: 0,
          meta: meta({ operationId: 'op-2' }),
          removeDependencies: [edge('D-2', 'B-1')],
        },
      }),
    )
    assert.equal(second.ok, false, 'a second operation would silently share a pause it did not take')
    assert.equal(second.error.code, 'TASK_CONFLICT')
    assert.equal(taskSetter.pending('W-1').length, 1)
    assert.equal(graph.calls.mutatePlan, 0)
    assert.equal(taskSetter.admissionHold('W-1').operationId, 'op-1')
  } finally {
    store.close()
  }
})

test('the journal exists before the graph is touched', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const holder = {}
  const graph = blockedGraph({
    onMutatePlan: async () => {
      holder.seen = holder.store.transaction(tx => planner.readMutation(tx, 'op-1'))
    },
  })
  const wired = await plannerFor(clock, graph)
  holder.store = wired.store
  try {
    const applied = await wired.planner.submit(
      intent({ command: { baseRevision: 0, removeDependencies: [edge('D-1', 'B-1')] } }),
    )
    assert.equal(applied.ok, true)
    assert.ok(holder.seen !== undefined, 'the graph was called before the intent was journalled')
    assert.equal(holder.seen.state, 'applying')
    assert.equal(holder.seen.intent.command.removeDependencies.length, 1)
    assert.equal(holder.seen.baseRevision, 0)
  } finally {
    wired.store.close()
  }
})

test('a composite with dep_remove is staged, verified, and only then resumes the queue', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit(compositeIntent())
    assert.equal(applied.ok, true)
    assert.equal(applied.value.mode, 'staged', 'several primitives were needed, so nothing claims atomicity')
    assert.equal(applied.value.state, 'applied')
    assert.deepEqual(graph.edgePairs(), [], 'both blocker edges came off through the staged path')
    assert.equal(graph.tasks.get('D-1').state, 'ready')
    assert.equal(graph.tasks.get('D-2').state, 'ready')
    assert.equal(taskSetter.admissionHeld('W-1'), false, 'the pause is released once verification passed')
    assert.equal(taskSetter.planRevision('W-1'), 1)

    const lastTransition = graph.history.reduce(
      (found, entry, index) => (entry.startsWith('transition:') ? index : found),
      -1,
    )
    assert.ok(
      graph.history.lastIndexOf('dependencies') > lastTransition,
      'integrity verification must read the graph after the last write',
    )

    const audit = store.transaction(tx => evidence.readAuditLog(tx, { workspaceId: 'W-1' }))
    const applied_rows = audit.filter(row => row.type === 'plan.mutation.applied')
    assert.equal(applied_rows.length, 1)
    assert.ok(applied_rows[0].artifactId !== undefined, 'the audit row points at the evidence (§8)')
    const artifact = store.transaction(tx =>
      tx.get('SELECT artifact_id, kind FROM artifacts WHERE artifact_id = ?', applied_rows[0].artifactId),
    )
    assert.equal(artifact.kind, 'planner-dag')
    assert.equal(store.transaction(tx => planner.readMutation(tx, 'op-1')).mode, 'staged')
  } finally {
    store.close()
  }
})

test('a failure in the middle leaves PLAN_MUTATION_RECOVERY, the pause, and no started dependent', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  graph.port.transition = async () => {
    throw new core.MyWorkError('TASK_CONFLICT', 'the graph refused the release')
  }
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit(compositeIntent())
    assert.equal(applied.ok, false)
    assert.equal(applied.error.code, 'PLAN_MUTATION_RECOVERY')
    assert.deepEqual(graph.edgePairs(), [], 'the edges part had already landed')
    assert.equal(graph.tasks.get('D-1').state, 'blocked', 'no dependent started')
    assert.equal(taskSetter.admissionHeld('W-1'), true, 'the pause stays until an operator decides')

    const record = store.transaction(tx => planner.readMutation(tx, 'op-1'))
    assert.equal(record.state, 'recovery')
    assert.match(record.failure, /refused the release/)
    assert.deepEqual(
      record.steps.map(step => [step.kind, step.state]),
      [
        ['create', 'applied'],
        ['remove-edge', 'applied'],
        ['remove-edge', 'applied'],
        ['retire', 'pending'],
        ['retire', 'pending'],
      ],
    )
    const report = store.transaction(tx => planner.readMutation(tx, 'op-1')).report
    assert.equal(report.verified, false)
    const recovered = store
      .transaction(tx => evidence.readAuditLog(tx, { workspaceId: 'W-1' }))
      .filter(row => row.type === 'plan.mutation.recovered')
    assert.equal(recovered.length, 1)
    assert.equal(taskSetter.planRevision('W-1'), 0, 'nothing committed, so the plan revision did not advance')
  } finally {
    store.close()
  }
})

test('repeating a staged operation does not duplicate anything', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const first = await taskSetter.submit(compositeIntent())
    assert.equal(first.ok, true)
    const creates = graph.calls.create
    const applications = graph.calls.mutatePlan
    assert.equal(creates, 1)

    const replay = await taskSetter.submit(compositeIntent())
    assert.equal(replay.ok, true, 'a repeat answers with the recorded outcome')
    assert.equal(graph.calls.create, creates, 'no task was created twice')
    assert.equal(graph.calls.mutatePlan, applications, 'the parts were not applied again')
    assert.equal(taskSetter.planRevision('W-1'), 1, 'and the plan revision advanced once')
    assert.deepEqual(replay.value.created, first.value.created)
  } finally {
    store.close()
  }
})

test('a repeat of an apply names the settled operation instead of re-running it', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const first = await taskSetter.submit(compositeIntent())
    assert.equal(first.ok, true)
    const applications = graph.calls.mutatePlan
    const again = await taskSetter.apply('op-1')
    assert.equal(again.ok, true)
    assert.equal(again.value.state, 'applied')
    assert.equal(graph.calls.mutatePlan, applications)
  } finally {
    store.close()
  }
})

test('a controller killed mid-apply comes back paused, and resume finishes the plan', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const real = await openPlannerDatabase(clock)
  const store = crashableStore(real)
  const path = store.path
  const first = planner.createPlanner({ store, graph: graph.port, clock })
  // The edges part lands, then the writer dies before anything is journalled
  // about it: that is the window ADR024's recovery exists for.
  graph.port.mutatePlan = (() => {
    const original = graph.port.mutatePlan
    return async command => {
      const result = await original(command)
      if ((command.removeDependencies ?? []).length > 0) store.kill()
      return result
    }
  })()
  await assert.rejects(first.submit(compositeIntent()), /simulated controller kill/)
  store.close()

  const reopened = await storage.openStore({
    path,
    migrations: [
      ...storage.MYWORK_MIGRATIONS,
      ...evidence.EVIDENCE_MIGRATIONS,
      ...lease.LEASE_MIGRATIONS,
      ...planner.PLAN_MUTATION_MIGRATIONS,
    ],
    clock: { now: () => clock.now() },
  })
  try {
    const pending = reopened.transaction(tx => planner.listPendingMutations(tx, 'W-1'))
    assert.equal(pending.length, 1, 'the operation is still open after the kill')
    assert.equal(pending[0].state, 'applying')
    assert.ok(
      reopened.transaction(tx => planner.readOpenHold(tx, 'W-1')) !== undefined,
      'the admission pause is a row, so it survived the kill',
    )
    assert.deepEqual(graph.edgePairs(), [], 'the graph kept the part that had landed')

    const resumed = planner.createPlanner({ store: reopened, graph: graph.port, clock })
    const creates = graph.calls.create
    const outcome = await resumed.resume('op-1', { decidedBy: 'operator', reason: 'read the journal', at: clock.now() })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.value.integrity.verified, true)
    assert.equal(graph.calls.create, creates, 'resume must not create the tasks again')
    assert.equal(resumed.admissionHeld('W-1'), false)
    assert.equal(graph.tasks.get('D-1').state, 'ready')
    assert.equal(resumed.planRevision('W-1'), 1)
  } finally {
    reopened.close()
  }
})

test('a create whose id was never journalled needs the operator to resolve it', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const real = await openPlannerDatabase(clock)
  const store = crashableStore(real)
  const path = store.path
  const first = planner.createPlanner({ store, graph: graph.port, clock })
  // This time the writer dies right after the create part: the graph holds the new
  // task, the journal does not hold its id, and no automatic replay could tell
  // whether creating again would duplicate it.
  graph.port.mutatePlan = (() => {
    const original = graph.port.mutatePlan
    return async command => {
      const result = await original(command)
      if ((command.create ?? []).length > 0) store.kill()
      return result
    }
  })()
  await assert.rejects(first.submit(compositeIntent()), /simulated controller kill/)
  store.close()

  const reopened = await storage.openStore({
    path,
    migrations: [
      ...storage.MYWORK_MIGRATIONS,
      ...evidence.EVIDENCE_MIGRATIONS,
      ...lease.LEASE_MIGRATIONS,
      ...planner.PLAN_MUTATION_MIGRATIONS,
    ],
    clock: { now: () => clock.now() },
  })
  try {
    const resumed = planner.createPlanner({ store: reopened, graph: graph.port, clock })
    const blind = await resumed.resume('op-1', { decidedBy: 'operator', at: clock.now() })
    assert.equal(blind.ok, false)
    assert.equal(blind.error.code, 'PLAN_MUTATION_RECOVERY')
    assert.deepEqual(blind.error.details.report.unresolvedCreates, ['n1'])
    assert.equal(graph.calls.create, 1, 'and nothing was created a second time')

    const createdId = [...graph.tasks.keys()].find(id => id.startsWith('mw-'))
    const resolved = await resumed.resume(
      'op-1',
      { decidedBy: 'operator', reason: 'found the task by its external ref', at: clock.now() },
      { adoptedCreated: { n1: createdId } },
    )
    assert.equal(resolved.ok, true)
    assert.equal(resolved.value.created.n1, createdId)
    assert.equal(graph.calls.create, 1)
    assert.equal(resumed.admissionHeld('W-1'), false)
    assert.deepEqual(
      reopened
        .transaction(tx => planner.readMutation(tx, 'op-1'))
        .steps.filter(step => step.kind === 'create')
        .map(step => step.state),
      ['applied'],
      'an adopted id is a landed creation, and the journal must say so',
    )
  } finally {
    reopened.close()
  }
})

test('resume refuses to guess when the graph moved in a way the intent does not explain', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const real = await openPlannerDatabase(clock)
  const store = crashableStore(real)
  const path = store.path
  const first = planner.createPlanner({ store, graph: graph.port, clock })
  graph.port.mutatePlan = (() => {
    const original = graph.port.mutatePlan
    return async command => {
      const result = await original(command)
      if ((command.removeDependencies ?? []).length > 0) store.kill()
      return result
    }
  })()
  await assert.rejects(first.submit(compositeIntent()), /simulated controller kill/)
  store.close()

  const reopened = await storage.openStore({
    path,
    migrations: [
      ...storage.MYWORK_MIGRATIONS,
      ...evidence.EVIDENCE_MIGRATIONS,
      ...lease.LEASE_MIGRATIONS,
      ...planner.PLAN_MUTATION_MIGRATIONS,
    ],
    clock: { now: () => clock.now() },
  })
  try {
    // Somebody wired two tasks this operation touched with an edge the intent
    // never mentions: the graph no longer matches the plan, and a resume would
    // have to guess what that edge is for.
    graph.addEdge('D-1', 'D-2')
    const resumed = planner.createPlanner({ store: reopened, graph: graph.port, clock })
    const outcome = await resumed.resume('op-1', { decidedBy: 'operator', at: clock.now() })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.code, 'PLAN_MUTATION_RECOVERY')
    assert.deepEqual(outcome.error.details.report.unexpected, ['D-1\u0000D-2'])
    assert.equal(resumed.admissionHeld('W-1'), true, 'a refused resume keeps the pause')
  } finally {
    reopened.close()
  }
})

test('revert restores the previous dependency set', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  graph.addTask('A-1').addTask('B-1').addTask('C-1').addTask('D-1')
  graph.addEdge('A-1', 'B-1')
  graph.port.transition = async () => {
    throw new core.MyWorkError('TASK_CONFLICT', 'the graph refused the retirement')
  }
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'replan',
      command: {
        baseRevision: 0,
        addDependencies: [edge('C-1', 'D-1')],
        removeDependencies: [edge('A-1', 'B-1')],
        meta: meta(),
      },
      retire: [{ taskId: 'D-1', to: 'cancelled' }],
    })
    assert.equal(applied.ok, false)
    assert.equal(applied.error.code, 'PLAN_MUTATION_RECOVERY')
    assert.deepEqual(graph.edgePairs(), ['C-1->D-1'], 'the edge swap had landed')

    const reverted = await taskSetter.revert('op-1', { decidedBy: 'operator', at: clock.now() })
    assert.equal(reverted.ok, true)
    assert.equal(reverted.value.state, 'reverted')
    assert.deepEqual(graph.edgePairs(), ['A-1->B-1'], 'the previous dependency set is back')
    assert.equal(taskSetter.admissionHeld('W-1'), false)
    assert.equal(taskSetter.planRevision('W-1'), 0, 'a revert does not advance the plan')
    assert.equal(store.transaction(tx => planner.readMutation(tx, 'op-1')).state, 'reverted')
  } finally {
    store.close()
  }
})

test('revert refuses when a creation landed, and names it', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  graph.port.mutatePlan = (() => {
    const original = graph.port.mutatePlan
    return async command => {
      if ((command.removeDependencies ?? []).length > 0) {
        throw new core.MyWorkError('PLAN_MUTATION_RECOVERY', 'the batch rolled back')
      }
      return original(command)
    }
  })()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit(compositeIntent())
    assert.equal(applied.ok, false)
    assert.equal(graph.calls.create, 1, 'the create part had landed')
    const reverted = await taskSetter.revert('op-1', { decidedBy: 'operator', at: clock.now() })
    assert.equal(reverted.ok, false)
    assert.equal(reverted.error.code, 'TASK_CONFLICT')
    assert.equal(reverted.error.details.reason, 'irreversible-steps')
    assert.deepEqual(reverted.error.details.irreversible, ['create:key:n1'])
    assert.equal(taskSetter.admissionHeld('W-1'), true, 'nothing was released')
  } finally {
    store.close()
  }
})

test('a plan revision that moved before the parts ran is refused without touching the graph', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const staged = await taskSetter.stage(
      intent({ command: { baseRevision: 0, removeDependencies: [edge('D-1', 'B-1')] } }),
    )
    assert.equal(staged.ok, true)
    // Another writer commits a plan revision while this operation is staged.
    store.transaction(tx => planner.commitPlanRevision(tx, 'W-1', 0, clock.now()))
    const applied = await taskSetter.apply('op-1')
    assert.equal(applied.ok, false)
    assert.equal(applied.error.code, 'STALE_REVISION')
    assert.deepEqual(graph.edgePairs(), ['D-1->B-1', 'D-2->B-1'], 'nothing was applied under a stale revision')
    assert.equal(store.transaction(tx => planner.readMutation(tx, 'op-1')).state, 'recovery')
  } finally {
    store.close()
  }
})

test('a durable hold keeps a controller from admitting, and resumeAdmission opens it', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const plain = new lease.ControllerLifecycle({
      scopeId: 'local',
      instanceId: 'controller-plain',
      processId: 1,
      clock,
      leaseMs: 5_000,
      leases: lease.createLeaseStore(store),
      openStores: () => ({ registry: store, controller: store }),
      reconcile: () => ({ operations: 2, leases: 1 }),
      closeStores: () => {},
    })
    const plainInfo = await plain.activate()
    assert.equal(plainInfo.admitting, true, 'without a hold nothing changes for a lease-only deployment')
    assert.equal('admissionHeld' in plainInfo, false)
    assert.deepEqual(plain.reconcileReport, { operations: 2, leases: 1 })
    await plain.dispose()

    await taskSetter.stage(intent({ command: { baseRevision: 0, removeDependencies: [edge('D-1', 'B-1')] } }))
    const held = new lease.ControllerLifecycle({
      scopeId: 'local',
      instanceId: 'controller-held',
      processId: 2,
      clock,
      leaseMs: 5_000,
      leases: lease.createLeaseStore(store),
      openStores: () => ({ registry: store, controller: store }),
      reconcile: () => ({ operations: 0, leases: 0 }),
      admissionHold: () => taskSetter.admissionHeld('W-1'),
      closeStores: () => {},
    })
    const heldInfo = await held.activate()
    assert.equal(heldInfo.admitting, false, 'a staged operation keeps admission closed')
    assert.equal(heldInfo.admissionHeld, true)
    assert.equal(held.isWriter(), false)

    await taskSetter.revert('op-1', { decidedBy: 'operator', at: clock.now() })
    assert.equal(taskSetter.admissionHeld('W-1'), false)
    const resumed = held.resumeAdmission()
    assert.equal(resumed.admitting, true)
    assert.equal(held.isWriter(), true)
    await held.dispose()
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// D. The blocker gate on a live graph, and the worker's proposal path
// ---------------------------------------------------------------------------

test('the gate is derived from a live graph and covers exactly the waiting dependents', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  graph.addTask('E-1', 'ready')
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const gates = await taskSetter.gates('W-1')
    assert.equal(gates.length, 1)
    assert.deepEqual(gates[0].dependents, ['D-1', 'D-2'])
    assert.equal(gates[0].open, true)
    assert.equal(gates[0].awaitingDecision, true)
    assert.equal(gates[0].latestDecision, undefined)

    // A blocker in done satisfies its dependency: no gate at all.
    graph.tasks.get('B-1').state = 'done'
    assert.deepEqual(await taskSetter.gates('W-1'), [])
  } finally {
    store.close()
  }
})

test('keep-blocking requires a reason and leaves it in the audit and in an artifact', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const withoutReason = await taskSetter.decideGate({
      workspaceId: 'W-1',
      blockerTaskId: 'B-1',
      action: 'keep-blocking',
      decision: { decidedBy: 'operator', at: clock.now() },
      meta: meta(),
    })
    assert.equal(withoutReason.ok, false)
    assert.equal(withoutReason.error.details.reason, 'reason-required')

    const reason = 'the vendor still owes the API key'
    const decided = await taskSetter.decideGate({
      workspaceId: 'W-1',
      blockerTaskId: 'B-1',
      action: 'keep-blocking',
      reason,
      decision: { decidedBy: 'operator', at: clock.now() },
      meta: meta(),
    })
    assert.equal(decided.ok, true)
    assert.equal(decided.value.open, true, 'the dependents are still blocked')
    assert.equal(decided.value.awaitingDecision, false, 'but a human has answered')
    assert.equal(decided.value.latestDecision.reason, reason)
    assert.deepEqual(decided.value.latestDecision.dependents, ['D-1', 'D-2'])

    const rows = store
      .transaction(tx => evidence.readAuditLog(tx, { workspaceId: 'W-1', type: 'gate.decided' }))
      .filter(row => row.auditId.startsWith('audit-gate-'))
    assert.equal(rows.length, 1)
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        gateId: 'W-1:B-1',
        action: 'keep-blocking',
        dependents: ['D-1', 'D-2'],
        reason,
        decidedBy: 'operator',
        decidedAt: clock.now(),
        operationId: null,
      }),
    )
    const artifact = store.transaction(tx =>
      evidence.getArtifact(tx, { artifactId: rows[0].artifactId, hash: evidence.sha256Hex(bytes) }),
    )
    assert.equal(artifact.metadata.kind, 'gate-decision')
    assert.deepEqual([...artifact.bytes], [...bytes], 'the reason is stored as the artifact the audit points at')
  } finally {
    store.close()
  }
})

test('void removes both edges through the staged path and returns both dependents to ready', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const decided = await taskSetter.decideGate({
      workspaceId: 'W-1',
      blockerTaskId: 'B-1',
      action: 'void',
      reason: 'the blocker was cancelled on purpose',
      decision: { decidedBy: 'operator', at: clock.now() },
      meta: meta(),
    })
    assert.equal(decided.ok, true)
    assert.deepEqual(graph.edgePairs(), [], 'both edges came off through the staged mutation')
    assert.equal(graph.tasks.get('D-1').state, 'ready')
    assert.equal(graph.tasks.get('D-2').state, 'ready')
    const gates = await taskSetter.gates('W-1')
    assert.deepEqual(gates, [], 'the derived condition is gone, so the gate is gone')
    const voided = store.transaction(tx => planner.readMutation(tx, 'op-1'))
    assert.equal(voided.state, 'applied')
    assert.equal(voided.origin, 'replan')
    assert.deepEqual(voided.intent.command.removeDependencies.length, 2)
    assert.deepEqual(voided.intent.retire.map(entry => entry.to), ['ready', 'ready'])
    const decisions = store.transaction(tx => planner.readGateDecisions(tx, 'W-1', 'B-1'))
    assert.equal(decisions.length, 1)
    assert.equal(decisions[0].action, 'void')
    assert.equal(decisions[0].operationId, 'op-1', 'the decision names the staged operation that carried it out')
  } finally {
    store.close()
  }
})

test('supersede-dependent moves both dependents to superseded', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const decided = await taskSetter.decideGate({
      workspaceId: 'W-1',
      blockerTaskId: 'B-1',
      action: 'supersede-dependent',
      decision: { decidedBy: 'operator', at: clock.now() },
      meta: meta(),
    })
    assert.equal(decided.ok, true)
    assert.equal(graph.tasks.get('D-1').state, 'superseded')
    assert.equal(graph.tasks.get('D-2').state, 'superseded')
    const open = (await taskSetter.gates('W-1')).filter(gate => gate.open)
    assert.deepEqual(open, [], 'terminal dependents no longer wait on the blocker')
    const decisions = store.transaction(tx => planner.readGateDecisions(tx, 'W-1', 'B-1'))
    assert.deepEqual(decisions[0].dependents, ['D-1', 'D-2'])
  } finally {
    store.close()
  }
})

test('a gate that is not open cannot be decided', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  graph.tasks.get('B-1').state = 'done'
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const refused = await taskSetter.decideGate({
      workspaceId: 'W-1',
      blockerTaskId: 'B-1',
      action: 'void',
      decision: { decidedBy: 'operator', at: clock.now() },
      meta: meta(),
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.details.reason, 'gate-not-open')
    assert.equal(graph.calls.mutatePlan, 0, 'nothing was attempted')
  } finally {
    store.close()
  }
})

test('a worker raises a proposal, and only the Task Setter accepts it into the DAG', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const raised = taskSetter.propose({
      workspaceId: 'W-1',
      kind: 'blocker',
      taskId: 'D-1',
      detail: 'the blocker was cancelled by another team',
      raisedBy: 'worker-a',
      correlationId: 'corr-1',
    })
    assert.equal(raised.ok, true)
    assert.equal(raised.value.state, 'open')
    assert.equal(graph.calls.mutatePlan, 0, 'a proposal never touches the DAG')
    assert.equal(graph.calls.transition, 0)
    const proposalId = raised.value.proposalId

    const refused = await taskSetter.acceptProposal(
      proposalId,
      {
        workspaceId: 'W-1',
        origin: 'proposal',
        command: { baseRevision: 0, update: [{ id: 'D-1', title: 'renamed' }], meta: meta() },
      },
      { decidedBy: 'task-setter', at: clock.now() },
    )
    assert.equal(refused.ok, true, 'the Setter may replan, and its decision is what the path records')
    assert.equal(graph.calls.mutatePlan, 1, 'the change went through the staged path, not around it')
    assert.equal(store.transaction(tx => planner.readProposal(tx, proposalId)).state, 'accepted')

    const second = taskSetter.propose({
      workspaceId: 'W-1',
      kind: 'follow-up',
      detail: 'document the cancellation',
      raisedBy: 'worker-b',
      correlationId: 'corr-2',
    })
    // A proposal is not an operation and cannot be applied on its own: only the
    // Setter's accepted mutation becomes a staged plan mutation (§10.4).
    await assert.rejects(taskSetter.apply(second.value.proposalId), /no plan mutation/)
    await assert.rejects(
      taskSetter.acceptProposal(second.value.proposalId, compositeIntent({ origin: 'proposal' }), { at: clock.now() }),
      /needs a deciding actor/,
    )
    assert.equal(graph.calls.mutatePlan, 1, 'nothing happened without a decision')

    const third = taskSetter.propose({
      workspaceId: 'W-1',
      kind: 'security-risk',
      detail: 'the token is in the log',
      raisedBy: 'worker-c',
      correlationId: 'corr-3',
    })
    const rejected = taskSetter.rejectProposal(third.value.proposalId, {
      decidedBy: 'task-setter',
      reason: 'handled by the security gate',
      at: clock.now(),
    })
    assert.equal(rejected.ok, true)
    assert.equal(rejected.value.state, 'rejected')
    assert.equal(rejected.value.decisionReason, 'handled by the security gate')
  } finally {
    store.close()
  }
})

test('an accepted proposal is one operation, and a second decision on it is refused', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const raised = taskSetter.propose({
      workspaceId: 'W-1',
      kind: 'blocker',
      detail: 'the blocker was cancelled by another team',
      raisedBy: 'worker-a',
      correlationId: 'corr-1',
    })
    const proposalId = raised.value.proposalId
    const accepted = await taskSetter.acceptProposal(proposalId, compositeIntent(), {
      decidedBy: 'task-setter',
      reason: 'the blocker really was cancelled',
      at: clock.now(),
    })
    assert.equal(accepted.ok, true)
    const record = store.transaction(tx => planner.readProposal(tx, proposalId))
    assert.equal(record.state, 'accepted')
    assert.equal(record.decidedBy, 'task-setter')
    assert.equal(record.operationId, 'op-1')
    assert.equal(store.transaction(tx => planner.readMutation(tx, 'op-1')).origin, 'proposal')

    const again = await taskSetter.acceptProposal(proposalId, compositeIntent(), {
      decidedBy: 'task-setter',
      at: clock.now(),
    })
    assert.equal(again.ok, false)
    assert.equal(again.error.details.reason, 'proposal-settled')
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// E. Regressions from the independent review: the path the planner is *for*
// ---------------------------------------------------------------------------

test('a plan of new tasks with intra-plan dependencies wires them between the created ids', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      command: {
        baseRevision: 0,
        create: [
          { key: 'root', title: 'Root' },
          { key: 'child', title: 'Child', dependsOnKeys: ['root'] },
        ],
        meta: meta(),
      },
    })
    assert.equal(applied.ok, true, applied.ok ? '' : `${applied.error.code}: ${applied.error.message}`)
    assert.equal(applied.value.integrity.verified, true)
    const created = applied.value.created
    assert.deepEqual(
      graph.edgePairs(),
      [`${created['child']}->${created['root']}`],
      'the intra-plan dependency must be an edge between the ids the tasks received',
    )
    assert.equal(taskSetter.admissionHeld('W-1'), false)
    const steps = store.transaction(tx => planner.readMutation(tx, 'op-1')).steps
    assert.deepEqual(
      steps.filter(step => step.kind === 'add-edge').map(step => step.state),
      ['applied'],
      'the journal describes the edge the part actually wired',
    )
  } finally {
    store.close()
  }
})

test('an edge between two created tasks given as addDependencies is resolved to their ids', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      command: {
        baseRevision: 0,
        create: [
          { key: 'root', title: 'Root' },
          { key: 'child', title: 'Child' },
        ],
        addDependencies: [edge('child', 'root')],
        meta: meta(),
      },
    })
    assert.equal(applied.ok, true, applied.ok ? '' : `${applied.error.code}: ${applied.error.message}`)
    const created = applied.value.created
    assert.deepEqual(graph.edgePairs(), [`${created['child']}->${created['root']}`])
    assert.equal(
      graph.edgePairs().includes('child->root'),
      false,
      'a literal plan key must never reach the graph as a task id',
    )
    assert.equal(applied.value.integrity.verified, true)
  } finally {
    store.close()
  }
})

test('a retry through apply does not create a task whose id was never journalled', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const real = await openPlannerDatabase(clock)
  const store = crashableStore(real)
  const taskSetter = planner.createPlanner({ store, graph: graph.port, clock })
  // The create lands and the writer dies before the id reaches the journal.
  graph.port.mutatePlan = (() => {
    const original = graph.port.mutatePlan
    return async command => {
      const result = await original(command)
      if ((command.create ?? []).length > 0) store.kill()
      return result
    }
  })()
  await assert.rejects(taskSetter.submit(compositeIntent()), /simulated controller kill/)
  store.state.killed = false

  const retry = await taskSetter.apply('op-1')
  assert.equal(retry.ok, false, 'apply must refuse exactly like resume does here')
  assert.equal(retry.error.code, 'PLAN_MUTATION_RECOVERY')
  assert.equal(graph.calls.create, 1, 'the retry must not create the task again')
  assert.equal(taskSetter.admissionHeld('W-1'), true)
  assert.deepEqual(retry.error.details.report.unresolvedCreates, ['n1'])
  store.close()
})

test('a revert that did not restore the graph keeps the pause and stays in recovery', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  graph.addTask('A-1').addTask('B-1').addTask('C-1').addTask('D-1')
  graph.addEdge('A-1', 'B-1')
  graph.port.transition = async () => {
    throw new core.MyWorkError('TASK_CONFLICT', 'the graph refused the retirement')
  }
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'replan',
      command: {
        baseRevision: 0,
        addDependencies: [edge('C-1', 'D-1')],
        removeDependencies: [edge('A-1', 'B-1')],
        meta: meta(),
      },
      retire: [{ taskId: 'D-1', to: 'cancelled' }],
    })
    assert.equal(applied.ok, false)
    // The backend now answers success without writing anything: the inverse never lands.
    graph.port.mutatePlan = async command => ({
      mode: 'staged',
      created: {},
      addedDependencies: command.addDependencies ?? [],
      removedDependencies: command.removeDependencies ?? [],
    })
    const reverted = await taskSetter.revert('op-1', { decidedBy: 'operator', at: clock.now() })
    assert.equal(reverted.ok, false)
    assert.equal(reverted.error.code, 'PLAN_MUTATION_RECOVERY')
    assert.equal(reverted.error.details.report.verified, false)
    assert.equal(
      store.transaction(tx => planner.readMutation(tx, 'op-1')).state,
      'recovery',
      'an unverified revert must not settle the operation',
    )
    assert.equal(taskSetter.admissionHeld('W-1'), true, 'and admission stays paused')
  } finally {
    store.close()
  }
})

test('a created task carries the reference an operator would search for', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      command: { baseRevision: 0, create: [{ key: 'leaf', title: 'Leaf' }], meta: meta() },
    })
    assert.equal(applied.ok, true)
    const id = applied.value.created['leaf']
    const reference = graph.tasks.get(id).externalRef
    assert.equal(reference, core.planExternalRef('op-1', 'leaf'))
    assert.deepEqual(core.parsePlanExternalRef(reference), { operationId: 'op-1', key: 'leaf' })
  } finally {
    store.close()
  }
})

test('the journal of an edge between created tasks names ids, and its inverse restores them', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      command: {
        baseRevision: 0,
        create: [
          { key: 'root', title: 'Root' },
          { key: 'child', title: 'Child' },
        ],
        addDependencies: [edge('child', 'root')],
        meta: meta(),
      },
    })
    assert.equal(applied.ok, true)
    const created = applied.value.created
    const record = store.transaction(tx => planner.readMutation(tx, 'op-1'))
    const edgeSteps = record.steps.filter(step => step.kind === 'add-edge')
    assert.equal(edgeSteps.length, 1)
    assert.equal(edgeSteps[0].state, 'applied', 'the edge landed, so the journal must not say otherwise')

    // The inverse of that step must carry the ids too: a revert that wrote the
    // plan keys back into the graph would be a second defect, not a rollback.
    const inversion = core.invertPlanSteps(
      record.steps,
      core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1' }),
      1,
      created,
    )
    assert.deepEqual(inversion.irreversible.map(step => step.kind), ['create', 'create'])
    const edges = inversion.parts.find(part => part.kind === 'edges')
    assert.deepEqual(
      edges.command.removeDependencies.map(entry => `${entry.from}->${entry.to}`),
      [`${created['child']}->${created['root']}`],
    )
  } finally {
    store.close()
  }
})

test('a composite call marks its intra-plan edge steps as applied', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      requireAtomic: true,
      command: {
        baseRevision: 0,
        create: [
          { key: 'root', title: 'Root' },
          { key: 'child', title: 'Child', dependsOnKeys: ['root'] },
        ],
        meta: meta(),
      },
    })
    assert.equal(applied.ok, true, applied.ok ? '' : `${applied.error.code}: ${applied.error.message}`)
    assert.equal(applied.value.mode, 'atomic')
    const created = applied.value.created
    assert.deepEqual(graph.edgePairs(), [`${created['child']}->${created['root']}`])
    const steps = store.transaction(tx => planner.readMutation(tx, 'op-1')).steps
    assert.deepEqual(
      steps.filter(step => step.kind === 'add-edge').map(step => step.state),
      ['applied'],
      'a committed composite must not leave its edge steps pending',
    )
  } finally {
    store.close()
  }
})

test('a guarded refusal raised by another bundle is reported as itself', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  // The shape a port from another bundle throws: its own error class, the
  // canonical code, structured details. An `instanceof` check would miss it.
  const foreign = Object.assign(new Error('dsh-mywork: the adapter does not declare the batch capability'), {
    code: 'CAPABILITY_UNSUPPORTED',
    details: { missing: ['batch'] },
  })
  graph.port.mutatePlan = async () => {
    throw foreign
  }
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    assert.equal(core.isMyWorkError(foreign), false, 'the error really is foreign to the planners class')
    const applied = await taskSetter.submit(compositeIntent())
    assert.equal(applied.ok, false)
    assert.equal(applied.error.code, 'CAPABILITY_UNSUPPORTED', 'the caller must learn what to change')
    assert.deepEqual(applied.error.details.missing, ['batch'])
    assert.equal(
      store.transaction(tx => planner.readMutation(tx, 'op-1')).state,
      'recovery',
      'the operation itself is still unfinished, whoever explains the failure',
    )
    assert.equal(taskSetter.admissionHeld('W-1'), true)
  } finally {
    store.close()
  }
})

test('a conflict from the middle of an operation stays a recovery, not a pre-write refusal', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const foreign = Object.assign(new Error('dsh-mywork: the dependent is not blocked'), {
    code: 'TASK_CONFLICT',
    details: { taskId: 'D-1' },
  })
  // It really throws: a stub that never fires would leave the guard unobserved.
  graph.port.mutatePlan = async () => {
    throw foreign
  }
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      command: { baseRevision: 0, create: [{ key: 'solo', title: 'Solo' }], meta: meta() },
    })
    assert.equal(applied.ok, false)
    assert.equal(
      applied.error.code,
      'PLAN_MUTATION_RECOVERY',
      'a create-bearing operation cannot claim that nothing was written',
    )
  } finally {
    store.close()
  }
})

test('the ids of created tasks are durable before anything else is read', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  let failing = false
  const original = graph.port.dependencies
  graph.port.dependencies = async id => {
    // The composite create has already written when this fires: the tasks exist.
    if (failing && graph.tasks.size >= 2) {
      throw Object.assign(new Error('dsh-mywork: the adapter is unreachable'), { code: 'ADAPTER_UNAVAILABLE' })
    }
    return original(id)
  }
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    failing = true
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      requireAtomic: true,
      command: {
        baseRevision: 0,
        create: [
          { key: 'root', title: 'Root' },
          { key: 'child', title: 'Child', dependsOnKeys: ['root'] },
        ],
        meta: meta(),
      },
    })
    assert.equal(applied.ok, false)
    assert.equal(applied.error.code, 'ADAPTER_UNAVAILABLE')
    const record = store.transaction(tx => planner.readMutation(tx, 'op-1'))
    assert.deepEqual(
      record.created,
      { root: 'mw-1', child: 'mw-2' },
      'a failing read must not lose the ids of tasks that already exist',
    )
    assert.deepEqual(record.steps.filter(step => step.kind === 'create').map(step => step.state), ['applied', 'applied'])
    assert.equal(record.state, 'recovery')
    assert.deepEqual(record.created, { root: 'mw-1', child: 'mw-2' }, 'the journal holds the ids, so no guessing is needed')
  } finally {
    store.close()
  }
})

test('an edge named twice is one journal step and one inverse command', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      command: {
        baseRevision: 0,
        create: [
          { key: 'root', title: 'Root' },
          { key: 'child', title: 'Child', dependsOnKeys: ['root'] },
        ],
        addDependencies: [edge('child', 'root')],
        meta: meta(),
      },
    })
    assert.equal(applied.ok, true)
    const record = store.transaction(tx => planner.readMutation(tx, 'op-1'))
    assert.equal(
      record.steps.filter(step => step.kind === 'add-edge').length,
      1,
      'one edge is one step, however many times the plan names it',
    )
    const inversion = core.invertPlanSteps(
      record.steps,
      core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1' }),
      1,
      record.created,
    )
    const edges = inversion.parts.find(part => part.kind === 'edges')
    assert.equal(edges.command.removeDependencies.length, 1)
  } finally {
    store.close()
  }
})

test('a port that reports success without writing the edge goes to recovery, not to success', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  // The ADR024 case itself: the backend answers "done" and the graph did not change.
  graph.port.mutatePlan = async command => ({
    mode: 'staged',
    created: {},
    addedDependencies: command.addDependencies ?? [],
    removedDependencies: command.removeDependencies ?? [],
  })
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit(
      intent({ command: { baseRevision: 0, removeDependencies: [edge('D-1', 'B-1')] } }),
    )
    assert.equal(applied.ok, false, 'a command that reported success is not a verified outcome')
    assert.equal(applied.error.code, 'PLAN_MUTATION_RECOVERY')
    assert.deepEqual(applied.error.details.report.pendingRemovals, ['D-1\u0000B-1'])
    assert.equal(taskSetter.admissionHeld('W-1'), true, 'the pause stays: the plan is not what it promised')
    const record = store.transaction(tx => planner.readMutation(tx, 'op-1'))
    assert.equal(record.state, 'recovery')
    assert.equal(record.report.verified, false)
    assert.deepEqual(graph.edgePairs(), ['D-1->B-1', 'D-2->B-1'], 'and nothing was written')
  } finally {
    store.close()
  }
})

test('a composite create whose ids are adopted still gets its edge steps marked', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  const real = await openPlannerDatabase(clock)
  const store = crashableStore(real)
  const taskSetter = planner.createPlanner({ store, graph: graph.port, clock })
  // The composite creates both tasks and their edge, and the writer dies before
  // anything about it is journalled: exactly the state only an operator can resolve.
  graph.port.mutatePlan = (() => {
    const original = graph.port.mutatePlan
    return async command => {
      const result = await original(command)
      if ((command.create ?? []).length > 0) store.kill()
      return result
    }
  })()
  await assert.rejects(
    taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      requireAtomic: true,
      command: {
        baseRevision: 0,
        create: [
          { key: 'root', title: 'Root' },
          { key: 'child', title: 'Child', dependsOnKeys: ['root'] },
        ],
        meta: meta(),
      },
    }),
    /simulated controller kill/,
  )
  store.state.killed = false
  assert.deepEqual(graph.edgePairs(), ['mw-2->mw-1'], 'the composite wired the edge itself')

  const resumed = await taskSetter.resume(
    'op-1',
    { decidedBy: 'operator', reason: 'found the tasks by their external refs', at: clock.now() },
    { adoptedCreated: { root: 'mw-1', child: 'mw-2' } },
  )
  assert.equal(resumed.ok, true, resumed.ok ? '' : `${resumed.error.code}: ${resumed.error.message}`)
  const record = store.transaction(tx => planner.readMutation(tx, 'op-1'))
  assert.equal(record.state, 'applied')
  assert.deepEqual(
    record.steps.map(step => [step.kind, step.state]),
    [
      ['create', 'applied'],
      ['create', 'applied'],
      ['add-edge', 'applied'],
    ],
    'a committed operation must not leave its edge step pending',
  )
  assert.match(record.steps[0].detail, /id adopted by operator/, 'and the journal says the id was adopted')
  store.close()
})

test('an adopted id that the graph does not hold is refused instead of trusted', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  const real = await openPlannerDatabase(clock)
  const store = crashableStore(real)
  const taskSetter = planner.createPlanner({ store, graph: graph.port, clock })
  graph.port.mutatePlan = (() => {
    const original = graph.port.mutatePlan
    return async command => {
      const result = await original(command)
      if ((command.create ?? []).length > 0) store.kill()
      return result
    }
  })()
  await assert.rejects(
    taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      requireAtomic: true,
      command: {
        baseRevision: 0,
        create: [
          { key: 'root', title: 'Root' },
          { key: 'child', title: 'Child', dependsOnKeys: ['root'] },
        ],
        meta: meta(),
      },
    }),
    /simulated controller kill/,
  )
  store.state.killed = false

  const ghost = await taskSetter.resume('op-1', { decidedBy: 'operator', at: clock.now() }, {
    adoptedCreated: { root: 'mw-999' },
  })
  assert.equal(ghost.ok, false)
  assert.equal(ghost.error.code, 'PLAN_MUTATION_RECOVERY')
  assert.deepEqual(ghost.error.details.rejectedAdoptions, { root: 'the task graph does not hold this id' })
  assert.deepEqual(store.transaction(tx => planner.readMutation(tx, 'op-1')).created, {})

  const foreignKey = await taskSetter.resume('op-1', { decidedBy: 'operator', at: clock.now() }, {
    adoptedCreated: { 'not-created-here': 'mw-1' },
  })
  assert.equal(foreignKey.ok, false)
  assert.deepEqual(foreignKey.error.details.rejectedAdoptions, {
    'not-created-here': 'the mutation does not create this key',
  })

  const accepted = await taskSetter.resume(
    'op-1',
    { decidedBy: 'operator', at: clock.now() },
    { adoptedCreated: { root: 'mw-1', child: 'mw-2' } },
  )
  assert.equal(accepted.ok, true, accepted.ok ? '' : `${accepted.error.code}: ${accepted.error.message}`)
  assert.deepEqual(store.transaction(tx => planner.readMutation(tx, 'op-1')).created, {
    root: 'mw-1',
    child: 'mw-2',
  })
  store.close()
})

test('a port that refuses during staging answers with a typed failure, not an exception', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  graph.port.dependencies = async () => {
    throw Object.assign(new Error('dsh-mywork: the adapter is unreachable'), { code: 'ADAPTER_UNAVAILABLE' })
  }
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const staged = await taskSetter.stage(
      intent({ command: { baseRevision: 0, removeDependencies: [edge('D-1', 'B-1')] } }),
    )
    assert.equal(staged.ok, false)
    assert.equal(staged.error.code, 'ADAPTER_UNAVAILABLE')
    assert.equal(taskSetter.admissionHeld('W-1'), false, 'and no pause was taken for an operation that never staged')
  } finally {
    store.close()
  }
})
test('a decision without a clock reading is refused as a programming error', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    await taskSetter.stage(intent({ command: { baseRevision: 0, removeDependencies: [edge('D-1', 'B-1')] } }))
    await assert.rejects(taskSetter.resume('op-1', { decidedBy: 'operator' }), /needs a clock reading in "at"/)
  } finally {
    store.close()
  }
})

test('the integrity report of a committed operation is the one that admitted it', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit(compositeIntent())
    assert.equal(applied.ok, true)
    assert.equal(applied.value.integrity.verified, true)
    const report = await taskSetter.integrityReport('op-1')
    assert.equal(report.ok, true)
    assert.equal(report.value.verified, true, 'the commit advanced the plan revision; the report must expect that')
    assert.equal(report.value.observedRevision, report.value.baseRevision)
  } finally {
    store.close()
  }
})

test('a metadata update is journalled as irreversible, and revert names it', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  graph.addTask('A-1').addTask('B-1')
  graph.port.transition = async () => {
    throw new core.MyWorkError('TASK_CONFLICT', 'the graph refused the retirement')
  }
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'replan',
      command: {
        baseRevision: 0,
        update: [{ id: 'A-1', setMetadata: { 'mywork.scope': 'narrow' } }],
        meta: meta(),
      },
      retire: [{ taskId: 'B-1', to: 'cancelled' }],
    })
    assert.equal(applied.ok, false)
    const steps = store.transaction(tx => planner.readMutation(tx, 'op-1')).steps
    const metadataStep = steps.find(step => step.kind === 'update')
    assert.equal(metadataStep.state, 'applied')
    assert.equal(metadataStep.reversible, false, 'metadata cannot be read back, so it cannot be undone')

    const reverted = await taskSetter.revert('op-1', { decidedBy: 'operator', at: clock.now() })
    assert.equal(reverted.ok, false)
    assert.equal(reverted.error.details.reason, 'irreversible-steps')
    assert.deepEqual(reverted.error.details.irreversible, ['update:A-1'])
  } finally {
    store.close()
  }
})

test('a retirement that landed before the journal did is not replayed', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const real = await openPlannerDatabase(clock)
  const store = crashableStore(real)
  const taskSetter = planner.createPlanner({ store, graph: graph.port, clock })
  graph.port.transition = (() => {
    const original = graph.port.transition
    return async command => {
      const result = await original(command)
      store.kill()
      return result
    }
  })()
  await assert.rejects(taskSetter.submit(compositeIntent()), /simulated controller kill/)
  store.state.killed = false
  assert.equal(graph.tasks.get('D-1').state, 'ready', 'the first retirement landed')

  const resumed = await taskSetter.resume('op-1', { decidedBy: 'operator', at: clock.now() })
  assert.equal(resumed.ok, true, resumed.ok ? '' : `${resumed.error.code}: ${resumed.error.message}`)
  assert.equal(graph.tasks.get('D-2').state, 'ready')
  assert.equal(taskSetter.admissionHeld('W-1'), false)
  store.close()
})

test('staging pauses admission and resuming it are both journalled as events', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    await taskSetter.stage(intent({ command: { baseRevision: 0, removeDependencies: [edge('D-1', 'B-1')] } }))
    assert.deepEqual(
      store.outbox.pending({ workspaceId: 'W-1' }).map(record => record.envelope.type).sort(),
      ['admission.paused', 'plan.mutation.staged'],
    )
    const applied = await taskSetter.apply('op-1')
    assert.equal(applied.ok, true)
    assert.deepEqual(
      store.outbox.pending({ workspaceId: 'W-1' }).map(record => record.envelope.type).sort(),
      ['admission.paused', 'admission.resumed', 'plan.mutation.applied', 'plan.mutation.staged'],
    )
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// The paths a falsifying pass broke: a revert that had no evidence of what
// landed, two callers of one operation, and a created key that names a task the
// graph already holds. Every case here was observed to fail before the fix.
// ---------------------------------------------------------------------------

/** A port that writes the create and kills the store before the answer is journalled. */
function dyingOnCreate(graph, store) {
  const original = graph.port.mutatePlan
  graph.port.mutatePlan = async command => {
    const result = await original(command)
    if ((command.create ?? []).length > 0) store.kill()
    return result
  }
  return original
}

test('revert refuses when a create may have landed without reaching the journal', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  const real = await openPlannerDatabase(clock)
  const store = crashableStore(real)
  const taskSetter = planner.createPlanner({ store, graph: graph.port, clock })
  dyingOnCreate(graph, store)
  await assert.rejects(
    taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      command: { baseRevision: 0, create: [{ key: 'n1', title: 'N1' }], meta: meta() },
    }),
    /simulated controller kill/,
  )
  store.state.killed = false
  assert.equal(graph.tasks.has('mw-1'), true, 'the task is in the graph although no journal holds its id')

  const reverted = await taskSetter.revert('op-1', { decidedBy: 'operator', reason: 'cancel', at: clock.now() })
  assert.equal(reverted.ok, false, 'a revert that cannot show the create did not happen must refuse')
  assert.equal(reverted.error.code, 'TASK_CONFLICT')
  assert.equal(reverted.error.details.reason, 'irreversible-steps')
  assert.notEqual(store.transaction(tx => planner.readMutation(tx, 'op-1')).state, 'reverted')
  assert.equal(taskSetter.admissionHeld('W-1'), true, 'and admission stays paused for the operator')
  store.close()
})

test('revert maps the journal onto the graph before inverting it', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const original = graph.port.mutatePlan
    graph.port.mutatePlan = async command => {
      await original(command)
      throw Object.assign(new Error('dsh-mywork: the adapter is unreachable'), { code: 'ADAPTER_UNAVAILABLE' })
    }
    const submitted = await taskSetter.submit(
      intent({ command: { baseRevision: 0, removeDependencies: [edge('D-1', 'B-1')] } }),
    )
    assert.equal(submitted.ok, false)
    assert.deepEqual(graph.edgePairs(), ['D-2->B-1'], 'the removal landed although the journal never heard')

    graph.port.mutatePlan = original
    const reverted = await taskSetter.revert('op-1', { decidedBy: 'operator', at: clock.now() })
    assert.equal(reverted.ok, true, reverted.ok ? '' : `${reverted.error.code}: ${reverted.error.message}`)
    assert.deepEqual(
      [...graph.edgePairs()].sort(),
      ['D-1->B-1', 'D-2->B-1'],
      'the set the revert promised is the set the graph holds',
    )
    assert.equal(taskSetter.admissionHeld('W-1'), false)

    const again = await taskSetter.submit(
      intent({ command: { baseRevision: 0, removeDependencies: [edge('D-1', 'B-1')] } }),
    )
    assert.equal(again.ok, false, 'a reverted operation is settled and does not run a second time')
    assert.equal(again.error.code, 'TASK_CONFLICT')
  } finally {
    store.close()
  }
})

test('two overlapping callers of one operation do not both create', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const staged = await taskSetter.stage({
      workspaceId: 'W-1',
      origin: 'planner',
      command: { baseRevision: 0, create: [{ key: 'n1', title: 'N1' }], meta: meta() },
    })
    assert.equal(staged.ok, true, staged.ok ? '' : `${staged.error.code}: ${staged.error.message}`)
    const outcomes = await Promise.all([taskSetter.apply('op-1'), taskSetter.apply('op-1')])
    assert.equal(outcomes.filter(entry => entry.ok).length, 1, 'exactly one caller applies the operation')
    assert.equal(graph.calls.create, 1, 'the graph is asked to create once')
    assert.deepEqual([...graph.tasks.keys()], ['mw-1'], 'and exactly one task exists')
    const loser = outcomes.find(entry => !entry.ok)
    assert.equal(loser.error.code, 'TASK_CONFLICT')
    assert.equal(loser.error.details.reason, 'operation-already-claimed')
  } finally {
    store.close()
  }
})

test('a create key may neither shadow an existing id nor repeat another key', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  graph.addTask('T-1').addTask('T-3', 'done')
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const shadowed = await taskSetter.stage(
      intent({
        command: {
          baseRevision: 0,
          create: [{ key: 'T-3', title: 'Shadow' }],
          addDependencies: [edge('T-1', 'T-3')],
        },
      }),
    )
    assert.equal(shadowed.ok, false, 'a key naming an existing task would resolve the edge onto that task')
    assert.equal(shadowed.error.code, 'TASK_CONFLICT')
    assert.equal(shadowed.error.details.reason, 'create-key-shadows-existing-task')

    const doubled = await taskSetter.stage(
      intent({
        command: {
          baseRevision: 0,
          create: [
            { key: 'a', title: 'A' },
            { key: 'a', title: 'Again' },
          ],
        },
      }),
    )
    assert.equal(doubled.ok, false, 'two specs under one key would create two tasks for one reference')
    assert.equal(doubled.error.details.reason, 'duplicate-plan-key')
    assert.equal(taskSetter.admissionHeld('W-1'), false, 'and a refused mutation stages nothing')
  } finally {
    store.close()
  }
})

test('a task the port cannot read is not an absent task for the running guard', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  graph.addTask('T-1', 'executing')
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const readable = graph.port.get
    graph.port.get = async id => {
      if (id === 'T-1') {
        throw Object.assign(new Error('dsh-mywork: the adapter is unreachable'), { code: 'ADAPTER_UNAVAILABLE' })
      }
      return readable(id)
    }
    const staged = await taskSetter.stage(
      intent({ command: { baseRevision: 0, update: [{ id: 'T-1', title: 'Rewritten' }] } }),
    )
    assert.equal(staged.ok, false, 'an unreadable running task must not pass §10.3 as if it were absent')
    assert.equal(staged.error.code, 'ADAPTER_UNAVAILABLE')
    assert.equal(taskSetter.admissionHeld('W-1'), false)
  } finally {
    store.close()
  }
})

test('an operation id reused for another mutation is refused, not answered with the first outcome', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const first = await taskSetter.stage(
      intent({ command: { baseRevision: 0, removeDependencies: [edge('D-1', 'B-1')] } }),
    )
    assert.equal(first.ok, true)
    const second = await taskSetter.stage(
      intent({ command: { baseRevision: 0, removeDependencies: [edge('D-2', 'B-1')] } }),
    )
    assert.equal(second.ok, false, 'answering with the first outcome would claim the second was applied')
    assert.equal(second.error.code, 'TASK_CONFLICT')
    assert.equal(second.error.details.reason, 'operation-id-reused')
  } finally {
    store.close()
  }
})

test('an adopted id may not become a way around the planner scope', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  graph.addTask('X-1').addTask('Y-1')
  const real = await openPlannerDatabase(clock)
  const store = crashableStore(real)
  const taskSetter = planner.createPlanner({ store, graph: graph.port, clock })
  dyingOnCreate(graph, store)
  await assert.rejects(
    taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      command: {
        baseRevision: 0,
        create: [
          { key: 'a', title: 'A' },
          { key: 'b', title: 'B' },
        ],
        addDependencies: [edge('b', 'a')],
        meta: meta(),
      },
    }),
    /simulated controller kill/,
  )
  store.state.killed = false

  const adopted = await taskSetter.resume(
    'op-1',
    { decidedBy: 'operator', reason: 'adopted from the graph', at: clock.now() },
    { adoptedCreated: { a: 'X-1', b: 'Y-1' } },
  )
  assert.equal(adopted.ok, false, 'the edge would be written on work this mutation cannot show it created')
  assert.equal(adopted.error.code, 'PLANNER_SCOPE_DENIED')
  assert.equal(adopted.error.details.reason, 'adopted-id-scope-unverified')
  assert.deepEqual(
    store.transaction(tx => planner.readMutation(tx, 'op-1')).created,
    {},
    'and the attestation is not journalled as an observation',
  )
  assert.equal(graph.edges.has('Y-1\u0000X-1'), false, 'no edge was written onto the existing tasks')
  assert.equal(store.transaction(tx => planner.readMutation(tx, 'op-1')).state, 'recovery')
  assert.equal(taskSetter.admissionHeld('W-1'), true, 'the operator keeps the pause and the report')
  store.close()
})

test('an adopted id the port cannot read names the read failure, not an absence', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  const real = await openPlannerDatabase(clock)
  const store = crashableStore(real)
  const taskSetter = planner.createPlanner({ store, graph: graph.port, clock })
  dyingOnCreate(graph, store)
  await assert.rejects(
    taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      command: { baseRevision: 0, create: [{ key: 'n1', title: 'N1' }], meta: meta() },
    }),
    /simulated controller kill/,
  )
  store.state.killed = false
  graph.port.get = async () => {
    throw Object.assign(new Error('dsh-mywork: the adapter is unreachable'), { code: 'ADAPTER_UNAVAILABLE' })
  }
  const probed = await taskSetter.resume(
    'op-1',
    { decidedBy: 'operator', at: clock.now() },
    { adoptedCreated: { n1: 'mw-1' } },
  )
  assert.equal(probed.ok, false)
  assert.deepEqual(probed.error.details.rejectedAdoptions, {
    n1: 'the task graph could not be read for this id: ADAPTER_UNAVAILABLE',
  })
  store.close()
})

test('void does not release a dependent a second open gate still holds', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  graph.addTask('B-1', 'cancelled').addTask('B-2', 'cancelled').addTask('D-1', 'blocked')
  graph.addEdge('D-1', 'B-1').addEdge('D-1', 'B-2')
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const decided = await taskSetter.decideGate({
      workspaceId: 'W-1',
      blockerTaskId: 'B-1',
      action: 'void',
      reason: 'B-1 turned out not to be a real blocker',
      decision: { decidedBy: 'operator', at: clock.now() },
      meta: meta(),
    })
    assert.equal(decided.ok, true, decided.ok ? '' : `${decided.error.code}: ${decided.error.message}`)
    assert.equal(graph.edges.has('D-1\u0000B-1'), false, 'the edge to the voided blocker comes off')
    assert.equal(graph.tasks.get('D-1').state, 'blocked', 'but the second open gate still holds the task')
    const open = (await taskSetter.gates('W-1')).filter(gate => gate.open)
    assert.deepEqual(open.map(gate => gate.blockerTaskId), ['B-2'])
    assert.deepEqual(open[0].dependents, ['D-1'])
    const voided = store.transaction(tx => planner.readMutation(tx, 'op-1'))
    assert.deepEqual(voided.intent.retire, [], 'and nothing is moved to ready while another gate holds it')
  } finally {
    store.close()
  }
})

test('a repeated gate decision is refused instead of colliding in SQLite or doubling', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = blockedGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const first = await taskSetter.decideGate({
      workspaceId: 'W-1',
      blockerTaskId: 'B-1',
      action: 'keep-blocking',
      reason: 'waiting for the human decision',
      decision: { decidedBy: 'operator', at: clock.now() },
      meta: meta(),
    })
    assert.equal(first.ok, true, first.ok ? '' : `${first.error.code}: ${first.error.message}`)
    const again = await taskSetter.decideGate({
      workspaceId: 'W-1',
      blockerTaskId: 'B-1',
      action: 'keep-blocking',
      reason: 'asked a second time',
      decision: { decidedBy: 'operator', at: clock.now() + 1 },
      meta: meta(),
    })
    assert.equal(again.ok, false, 'one operation may not record a second decision for the same gate')
    assert.equal(again.error.code, 'TASK_CONFLICT')
    assert.equal(again.error.details.reason, 'gate-already-decided')
    assert.equal(store.transaction(tx => planner.readGateDecisions(tx, 'W-1', 'B-1')).length, 1)
  } finally {
    store.close()
  }
})

test('an edge nobody asked for onto a task this mutation created is reported, not absorbed', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  graph.addTask('Z-9', 'done')
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const original = graph.port.mutatePlan
    graph.port.mutatePlan = async command => {
      const result = await original(command)
      if ((command.create ?? []).length > 0) graph.addEdge('Z-9', result.created.n1)
      return result
    }
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      command: { baseRevision: 0, create: [{ key: 'n1', title: 'N1' }], meta: meta() },
    })
    assert.equal(applied.ok, false, 'a dependency nobody wrote is the graph moving under the operation')
    assert.equal(applied.error.code, 'PLAN_MUTATION_RECOVERY')
    assert.deepEqual(applied.error.details.report.unexpected, ['Z-9\u0000mw-1'])
    assert.equal(taskSetter.admissionHeld('W-1'), true)
  } finally {
    store.close()
  }
})

test('revert refuses when a create landed but the port answered without its id', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const graph = fakeGraph()
  const { planner: taskSetter, store } = await plannerFor(clock, graph)
  try {
    const original = graph.port.mutatePlan
    graph.port.mutatePlan = async command => {
      const result = await original(command)
      // The contract promises only the ids the backend knew: a create that landed
      // without one is the state nobody can disprove afterwards.
      return (command.create ?? []).length > 0 ? { ...result, created: {} } : result
    }
    const applied = await taskSetter.submit({
      workspaceId: 'W-1',
      origin: 'planner',
      command: { baseRevision: 0, create: [{ key: 'n1', title: 'N1' }], meta: meta() },
    })
    assert.equal(applied.ok, false)
    assert.equal(graph.tasks.has('mw-1'), true, 'the task is in the graph although no journal holds its id')
    const reverted = await taskSetter.revert('op-1', { decidedBy: 'operator', at: clock.now() })
    assert.equal(reverted.ok, false, 'a failed create may still have created the task')
    assert.equal(reverted.error.code, 'TASK_CONFLICT')
    assert.equal(reverted.error.details.reason, 'irreversible-steps')
    assert.equal(taskSetter.admissionHeld('W-1'), true, 'the pause stays until an operator resolves it')
  } finally {
    store.close()
  }
})
