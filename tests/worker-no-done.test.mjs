/**
 * The worker does not finalize the Task Graph (architecture §8, §18.1, §19;
 * MW-022, E-12).
 *
 * Authority over the task graph belongs to the layer that owns it: a finished
 * attempt is a settled attempt plus a report, and the transition into
 * `awaiting-review` — let alone `done` — is the caller's decision. The three
 * tests here pin that boundary from both sides: the worker records no transition
 * of its own, `executing → done` is refused by the state machine, and the side
 * states that mean "run it again" still admit a new attempt.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { adapterTesting, core, evidence, execution, lease, storage } from './lib/fixtures.mjs'

const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-worker-no-done-'

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) {
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
  return core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1', controllerEpoch: 3, ...overrides })
}

/** A `TaskGraphPort` fake that records every transition it is asked for. */
function fakeGraph() {
  const tasks = new Map([
    ['T-1', { id: 'T-1', workspaceId: 'W-1', title: 'T-1', description: '', state: 'ready', revision: 1, dependsOn: [] }],
  ])
  const transitions = []
  return {
    tasks,
    transitions,
    port: {
      capabilities: async () => ({ adapterId: 'fake', contractVersion: 'taskgraph/v1', capabilities: {}, source: 'declared' }),
      get: async id => Object.freeze({ ...tasks.get(id) }),
      ready: async () => [],
      blocked: async () => [],
      claim: async command => {
        const task = tasks.get(command.id)
        task.assignee = command.claimant
        return Object.freeze({ won: true, task: Object.freeze({ ...task }) })
      },
      transition: async command => {
        transitions.push(`${command.id}->${command.to}`)
        const task = tasks.get(command.id)
        if (!core.canTransitionTask(task.state, command.to)) {
          throw new core.MyWorkError('TASK_CONFLICT', `illegal transition ${task.state} → ${command.to}`)
        }
        task.state = command.to
        task.revision += 1
        return Object.freeze({ ...task })
      },
      dependencies: async () => [],
      mutatePlan: async () => ({ mode: 'atomic', created: {} }),
      doctor: async () => [],
    },
  }
}

/** A `WorktreePort` fake: one registration per attempt. */
function fakeWorktrees() {
  const registrations = new Map()
  return {
    port: {
      prepare: async (request, callMeta) => {
        const registration = Object.freeze({
          attemptId: request.attemptId,
          workspaceId: request.workspaceId,
          taskId: request.taskId,
          path: join('C:/worktrees', request.attemptId),
          branch: `mywork/${request.taskId}-${request.attemptId}`,
          baseSha: request.baseSha,
        })
        registrations.set(request.attemptId, registration)
        return core.ok(registration, callMeta)
      },
      resolve: async (attemptId, callMeta) => core.ok(registrations.get(attemptId), callMeta),
      cleanup: async (attemptId, callMeta) => core.ok(Object.freeze({ outcome: 'kept-orphan' }), callMeta),
      list: async (workspaceId, callMeta) => core.ok(Object.freeze([...registrations.values()]), callMeta),
    },
  }
}

/** An `AttemptContextPort` fake: one deterministic snapshot per attempt. */
function fakeContext() {
  return {
    port: {
      materialize: async (request, callMeta) =>
        core.ok(
          Object.freeze({
            revision: 1,
            attemptId: request.attemptId,
            taskId: request.taskId,
            workspaceId: request.workspaceId,
            createdAt: 1_000,
            revisions: { task: 1, role: 4, blueprint: 17, workflow: 1 },
            skillRevisions: {},
            modelRoute: { provider: 'deepseek', model: 'flash' },
            modelRouteRole: 'primary',
            contextWindow: 128_000,
            toolSurface: ['shell'],
            budget: {},
            items: [],
            contentHashes: {},
            tokenEstimates: { prompt: 0, context: 0, total: 0 },
            dropped: [],
            provenance: [],
            fingerprint: `fp-${request.attemptId}`,
          }),
          callMeta,
        ),
    },
  }
}

/** An `AttemptRunPort` fake that completes, or refuses the runs the test refuses. */
function fakeRuntime(options = {}) {
  const sessions = new Map()
  let runs = 0
  return {
    sessions,
    port: {
      run: async (request, callMeta) => {
        runs += 1
        if (options.refuse === true || (options.refuseOnce === true && runs === 1)) {
          return core.fail(
            new core.MyWorkError('TASK_CONFLICT', 'dsh-mywork: the run was refused', {
              details: { runId: request.runId, reason: 'run-refused' },
            }),
            callMeta,
          )
        }
        sessions.set(request.runId, 'session-fake-1')
        return core.ok(
          Object.freeze({
            runId: request.runId,
            attemptId: request.attemptId,
            outcome: 'completed',
            sessionId: 'session-fake-1',
            artifactRefs: [],
          }),
          callMeta,
        )
      },
      resume: async () => {
        throw new Error('the no-done fixture never resumes')
      },
      status: async (runId, callMeta) => core.ok(Object.freeze({ runId, running: false }), callMeta),
    },
  }
}

/** A worker over fakes. */
async function workerFixture(options = {}) {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await storage.openStore({
    path: join(tempDir(), 'controller.sqlite'),
    migrations: [
      ...storage.MYWORK_MIGRATIONS,
      ...evidence.EVIDENCE_MIGRATIONS,
      ...lease.LEASE_MIGRATIONS,
      ...execution.CLAIM_SAGA_MIGRATIONS,
    ],
    clock: { now: () => clock.now() },
  })
  const graph = fakeGraph()
  const saga = execution.createClaimSaga({ store, graph: graph.port, clock })
  const worktrees = fakeWorktrees()
  const context = fakeContext()
  const runtime = fakeRuntime(options)
  const artifacts = evidence.createArtifactStore(store, { now: () => clock.now() })
  const worker = execution.createWorker({
    store,
    saga,
    worktrees: worktrees.port,
    context: context.port,
    runtime: runtime.port,
    evidence: artifacts,
    clock,
  })
  return { clock, store, graph, saga, worker, runtime, artifacts }
}

/** An admission for the fixture task. */
function admission(overrides = {}) {
  return {
    taskId: 'T-1',
    workspaceId: 'W-1',
    claimant: 'worker-1',
    agentId: 'Neo-1',
    expectedRevision: 1,
    leaseMs: 5_000,
    baseSha: 'a'.repeat(40),
    scope: { agentPreset: 'worker' },
    frozen: { config: 2, role: 4 },
    instructions: 'Do the work of T-1.',
    meta: meta(),
    ...overrides,
  }
}

/** Unwrap a successful result. */
function unwrap(result) {
  assert.equal(result.ok, true, result.ok ? '' : `${result.error.code}: ${result.error.message}`)
  return result.value
}

test('a finished run is handed back to the caller, which moves the task to awaiting-review', async () => {
  const { worker, graph } = await workerFixture()
  const report = unwrap(await worker.runAttempt(admission()))
  assert.equal(report.outcome, 'completed')
  assert.equal(report.attemptState, 'completed')

  // The worker's own footprint on the graph is exactly the projection the claim
  // saga performs (§9 step 4) — nothing else, and certainly nothing terminal.
  assert.deepEqual(graph.transitions, ['T-1->assigned'])
  assert.equal(graph.tasks.get('T-1').state, 'assigned')

  // The caller layer owns the next hops. `assigned → executing → awaiting-review`
  // is the §18.1 main line, and it is the caller that walks it — binding the
  // attempt it just ran, because that identity is the caller's knowledge.
  graph.tasks.get('T-1').activeAttemptId = report.attemptId
  const running = core.transitionTask(
    graph.tasks.get('T-1'),
    { to: 'executing', activeAttemptId: report.attemptId, at: 2_000 },
    meta(),
  )
  assert.equal(running.ok, true, running.ok ? '' : running.error.message)
  const awaiting = core.transitionTask(running.value.task, { to: 'awaiting-review', at: 3_000 }, meta())
  assert.equal(awaiting.ok, true, awaiting.ok ? '' : awaiting.error.message)
  assert.equal(awaiting.value.task.state, 'awaiting-review')
  // And from there the graph refuses the terminal state: only the integrator
  // reaches `done`, after an approved review (§19, E-28).
  assert.equal(core.canTransitionTask('awaiting-review', 'done'), false)
})

test('a transition to done is refused from every state an attempt can produce', async () => {
  const { worker, graph } = await workerFixture()
  unwrap(await worker.runAttempt(admission()))

  // The graph itself refuses the edge, so an orchestrator that tried it would be
  // refused rather than obeyed — and the worker never tries: its journal holds no
  // transition at all beyond the saga's projection.
  const fromAssigned = core.transitionTask(graph.tasks.get('T-1'), { to: 'done', at: 2_000 }, meta())
  assert.equal(fromAssigned.ok, false)
  assert.equal(fromAssigned.error.code, 'TASK_CONFLICT')
  assert.deepEqual(graph.transitions, ['T-1->assigned'])

  const producing = ['assigned', 'executing', 'awaiting-review', 'reviewing']
  for (const state of producing) {
    assert.equal(core.canTransitionTask(state, 'done'), false, `${state} must not reach done directly`)
  }
  // The one edge into `done` starts at `integrating`, which is reachable only
  // from an approved review.
  const intoDone = Object.entries(core.TASK_TRANSITIONS)
    .filter(([, targets]) => targets.includes('done'))
    .map(([from]) => from)
  assert.deepEqual(intoDone, ['integrating'])
  assert.equal(core.canTransitionTask('integrating', 'done'), true)
})

test('the side states that mean "run it again" still admit a new attempt', async () => {
  const { worker, store, graph, saga } = await workerFixture({ refuseOnce: true })
  const failed = await worker.runAttempt(admission())
  assert.equal(failed.ok, false)
  assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)), 1)

  // `failed → ready` is the retry edge (§18.1), and it is open.
  assert.equal(core.canTransitionTask('failed', 'ready'), true)
  assert.equal(core.canTransitionTask('changes-requested', 'ready'), true)
  const task = graph.tasks.get('T-1')
  task.state = 'ready'
  task.revision += 1

  const again = unwrap(
    await worker.runAttempt(admission({ meta: meta({ operationId: 'op-2', correlationId: 'corr-2' }) })),
  )
  assert.equal(again.attemptId, 'attempt-op-2')
  assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)), 2)
  assert.equal(saga.liveAttempts('W-1').length, 0)
})
