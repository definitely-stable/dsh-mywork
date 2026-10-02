/**
 * The worker orchestrator end to end (architecture §9, §17, §21.7, §22, §35;
 * MW-022, E-08).
 *
 * The whole path runs on fakes — a fake task graph, worktree port, context
 * fabric, and attempt runtime — so the order of the hops, the identity a session
 * is opened under, and the prompt handed to the agent are observed as data
 * rather than inferred from a model's behaviour. No DSH row is mounted and no
 * model is called.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { adapterTesting, contracts, core, evidence, execution, lease, storage } from './lib/fixtures.mjs'

const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-worker-flow-'

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
  return core.defineOperationMeta({
    operationId: 'op-1',
    correlationId: 'corr-1',
    controllerEpoch: 3,
    ...overrides,
  })
}

/** Open a temporary controller database carrying every schema the worker writes through. */
async function openWorkerDatabase(clock) {
  return storage.openStore({
    path: join(tempDir(), 'controller.sqlite'),
    migrations: [
      ...storage.MYWORK_MIGRATIONS,
      ...evidence.EVIDENCE_MIGRATIONS,
      ...lease.LEASE_MIGRATIONS,
      ...execution.CLAIM_SAGA_MIGRATIONS,
    ],
    clock: { now: () => clock.now() },
  })
}

/** A deterministic `TaskGraphPort` that records every call in order. */
function fakeGraph(options = {}) {
  const tasks = new Map()
  const calls = []
  return {
    tasks,
    calls,
    addTask(id, state = 'ready', extra = {}) {
      tasks.set(id, {
        id,
        workspaceId: 'W-1',
        title: id,
        description: '',
        state,
        revision: 1,
        dependsOn: [],
        ...extra,
      })
      return this
    },
    port: {
      capabilities: async () => ({
        adapterId: 'fake',
        contractVersion: 'taskgraph/v1',
        capabilities: {},
        source: 'declared',
      }),
      get: async id => {
        calls.push(`get:${id}`)
        const task = tasks.get(id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${id}"`)
        return Object.freeze({ ...task })
      },
      ready: async () => [],
      blocked: async () => [],
      claim: async command => {
        calls.push(`claim:${command.id}:${command.claimant}`)
        const task = tasks.get(command.id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${command.id}"`)
        if (task.assignee !== undefined && task.assignee !== command.claimant) {
          return Object.freeze({ won: false, holder: task.assignee })
        }
        task.assignee = command.claimant
        return Object.freeze({ won: true, task: Object.freeze({ ...task }) })
      },
      transition: async command => {
        calls.push(`transition:${command.id}->${command.to}`)
        const task = tasks.get(command.id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${command.id}"`)
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

/** A `WorktreePort` fake: one registration per attempt, recorded in call order. */
function fakeWorktrees(journal, options = {}) {
  const calls = []
  const registrations = new Map()
  return {
    calls,
    registrations,
    port: {
      prepare: async (request, callMeta) => {
        calls.push(`prepare:${request.attemptId}`)
        journal.push('prepare')
        if (options.onPrepare !== undefined) {
          const injected = await options.onPrepare(request, callMeta)
          if (injected !== undefined) return injected
        }
        if (registrations.has(request.attemptId)) {
          return core.fail(
            new core.MyWorkError(
              'TASK_CONFLICT',
              `dsh-mywork: the worktree of "${request.attemptId}" is already registered`,
              { details: { refusal: 'WORKTREE_ALREADY_REGISTERED', attemptId: request.attemptId } },
            ),
            callMeta,
          )
        }
        const registration = Object.freeze({
          attemptId: request.attemptId,
          workspaceId: request.workspaceId,
          taskId: request.taskId,
          path: join(tempDir(), 'worktrees', request.attemptId),
          branch: `mywork/${request.taskId}-${request.attemptId}`,
          baseSha: request.baseSha,
        })
        registrations.set(request.attemptId, registration)
        return core.ok(registration, callMeta)
      },
      resolve: async (attemptId, callMeta) => {
        calls.push(`resolve:${attemptId}`)
        journal.push('resolve')
        const registration = registrations.get(attemptId)
        if (registration === undefined) {
          return core.fail(
            new core.MyWorkError('TASK_CONFLICT', `dsh-mywork: attempt "${attemptId}" has no worktree`, {
              details: { refusal: 'WORKTREE_MISSING', attemptId },
            }),
            callMeta,
          )
        }
        return core.ok(registration, callMeta)
      },
      cleanup: async (attemptId, callMeta) => {
        calls.push(`cleanup:${attemptId}`)
        return core.ok(Object.freeze({ outcome: 'kept-orphan' }), callMeta)
      },
      list: async (workspaceId, callMeta) => {
        calls.push(`list:${workspaceId}`)
        return core.ok(Object.freeze([...registrations.values()]), callMeta)
      },
    },
  }
}

/** A `ContextSnapshot` fake: deterministic for one attempt, as §35 requires. */
function snapshotFor(request) {
  return Object.freeze({
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
  })
}

/** An `AttemptContextPort` fake recording the requests it was handed. */
function fakeContext(journal, options = {}) {
  const calls = []
  const requests = []
  return {
    calls,
    requests,
    port: {
      materialize: async (request, callMeta) => {
        calls.push(`materialize:${request.attemptId}`)
        journal.push('materialize')
        requests.push(request)
        if (options.onMaterialize !== undefined) {
          const injected = await options.onMaterialize(request, callMeta)
          if (injected !== undefined) return injected
        }
        return core.ok(snapshotFor(request), callMeta)
      },
    },
  }
}

/**
 * An `AttemptRunPort` fake.
 *
 * It refuses a duplicate `runId` the way a session owner does (§36), so the tests
 * can observe that refusal instead of trusting an internal flag. `gate` is a
 * promise the test releases to hold a run open.
 */
function fakeRuntime(journal, options = {}) {
  const calls = []
  const requests = []
  const resumes = []
  const sessions = new Map()
  let sessionSeq = 0
  return {
    calls,
    requests,
    resumes,
    sessions,
    port: {
      run: async (request, callMeta, callOptions) => {
        calls.push(`start:${request.runId}`)
        journal.push('start')
        requests.push(request)
        if (options.onRun !== undefined) {
          const injected = await options.onRun(request, callMeta)
          if (injected !== undefined) return injected
        }
        if (sessions.has(request.runId)) {
          return core.fail(
            new core.MyWorkError('TASK_CONFLICT', `dsh-mywork: run "${request.runId}" was already started`, {
              details: { runId: request.runId, reason: 'run-already-started' },
            }),
            callMeta,
          )
        }
        sessionSeq += 1
        const sessionId = `session-fake-${sessionSeq}`
        sessions.set(request.runId, sessionId)
        if (options.gate !== undefined) await options.gate
        if (callOptions?.signal?.aborted === true) {
          return core.ok(
            Object.freeze({ runId: request.runId, attemptId: request.attemptId, outcome: 'cancelled', sessionId, artifactRefs: [] }),
            callMeta,
          )
        }
        return core.ok(
          Object.freeze({
            runId: request.runId,
            attemptId: request.attemptId,
            outcome: options.outcome ?? 'completed',
            sessionId,
            artifactRefs: [],
          }),
          callMeta,
        )
      },
      resume: async (request, callMeta) => {
        calls.push(`resume:${request.runId}`)
        journal.push('resume')
        resumes.push(request)
        if (options.onResume !== undefined) {
          const injected = await options.onResume(request, callMeta)
          if (injected !== undefined) return injected
        }
        const sessionId = sessions.get(request.runId)
        if (sessionId === undefined || sessionId !== request.sessionId) {
          return core.fail(
            new core.MyWorkError('SESSION_NOT_FOUND', `dsh-mywork: no session "${request.sessionId}"`, {
              details: { runId: request.runId, sessionId: request.sessionId },
            }),
            callMeta,
          )
        }
        return core.ok(
          Object.freeze({ runId: request.runId, attemptId: request.attemptId, outcome: 'completed', sessionId, artifactRefs: [] }),
          callMeta,
        )
      },
      status: async (runId, callMeta) => {
        calls.push(`status:${runId}`)
        journal.push('status')
        const sessionId = sessions.get(runId)
        return core.ok(
          Object.freeze({ runId, running: sessionId !== undefined, ...(sessionId === undefined ? {} : { sessionId }) }),
          callMeta,
        )
      },
    },
  }
}

/** The artifact store with its writes recorded in the same journal as the port calls. */
function journaledEvidence(store, clock, journal) {
  const real = evidence.createArtifactStore(store, { now: () => clock.now() })
  return {
    put: request => {
      journal.push(`put:${request.kind}`)
      return real.put(request)
    },
    get: ref => real.get(ref),
  }
}

/** The gate set a fake policy runs, in policy order. */
const FAKE_GATES = Object.freeze(['unit', 'lint'])

/** One `GateResult` of a fake run; the gate's log travels as a reference. */
function fakeVerdict(headSha, id, verdict) {
  return Object.freeze({
    id,
    headSha,
    exitCode: verdict === 'pass' ? 0 : 1,
    verdict,
    artifactRef: Object.freeze({ artifactId: `gate-log-${id}`, hash: 'b'.repeat(64) }),
  })
}

/**
 * An `AttemptGatePort` fake: one verdict per gate of {@link FAKE_GATES}.
 *
 * The refusal a real port answers with is a value, not a throw (`GateRunResult`
 * carries it), and a refused run carries no verdicts — both are reproduced here so
 * the worker is exercised against the shape the port actually has.
 * @param journal - the shared call journal.
 * @param options - gates that fail, a run-level refusal, or an injected answer.
 */
function fakeGates(journal, options = {}) {
  const calls = []
  const requests = []
  const failing = new Set(options.failing ?? [])
  return {
    calls,
    requests,
    port: {
      run: async (request, callMeta) => {
        calls.push(`gates:${request.attemptId}`)
        journal.push('gates')
        requests.push(request)
        if (options.onRun !== undefined) {
          const injected = await options.onRun(request, callMeta)
          if (injected !== undefined) return injected
        }
        const results =
          options.refusal === undefined
            ? FAKE_GATES.map(id => fakeVerdict(request.headSha, id, failing.has(id) ? 'fail' : 'pass'))
            : []
        return core.ok(
          Object.freeze({
            headSha: request.headSha,
            results: Object.freeze(results),
            ...(options.refusal === undefined ? {} : { refusal: options.refusal }),
          }),
          callMeta,
        )
      },
    },
  }
}

/** A worker over fakes, with every call recorded in one journal. */
async function workerFixture(options = {}) {
  const clock = new adapterTesting.FakeClock(options.start ?? 1_000)
  const store = await openWorkerDatabase(clock)
  const graph = fakeGraph(options).addTask('T-1', options.taskState ?? 'ready')
  const real = execution.createClaimSaga({ store, graph: graph.port, clock })
  const journal = []
  const saga = {
    claim: async command => {
      journal.push('claim')
      return real.claim(command)
    },
    settle: async command => {
      journal.push('settle')
      return real.settle(command)
    },
    recover: request => real.recover(request),
    revoke: request => real.revoke(request),
    attemptOf: taskId => real.attemptOf(taskId),
    liveAttempts: workspaceId => real.liveAttempts(workspaceId),
    openIntents: workspaceId => real.openIntents(workspaceId),
    stepsOf: operationId => real.stepsOf(operationId),
  }
  const worktrees = fakeWorktrees(journal, options)
  const context = fakeContext(journal, options)
  const runtime = fakeRuntime(journal, options)
  const artifacts = journaledEvidence(store, clock, journal)
  // The gate port is injected only when a test asks for it: a deployment without a
  // runner is a real configuration (and not a pass — see the tests below).
  const gates = options.gates === undefined ? undefined : fakeGates(journal, options.gates)
  const worker = execution.createWorker({
    store,
    saga,
    worktrees: worktrees.port,
    context: context.port,
    runtime: runtime.port,
    ...(gates === undefined ? {} : { gates: gates.port }),
    evidence: artifacts,
    clock,
  })
  return { clock, store, graph, saga: real, worker, journal, worktrees, context, runtime, artifacts, gates }
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
    frozen: { config: 2, role: 4, 'agent-blueprint': 17 },
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

/** Wait until a predicate holds, without sleeping on a fixed delay. */
async function waitFor(predicate, what, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}

/** The port calls of one journal, in order. */
function portCalls(journal) {
  return journal.filter(entry => !entry.startsWith('put:'))
}

test('the ports are called in the order claim → prepare → materialize → start → settle', async () => {
  const { worker, journal } = await workerFixture()
  const report = unwrap(await worker.runAttempt(admission()))

  assert.deepEqual(portCalls(journal), ['claim', 'prepare', 'materialize', 'start', 'settle'])
  assert.equal(report.outcome, 'completed')
  assert.equal(report.attemptState, 'completed')
  // The evidence of the attempt is written before the session starts and before
  // the settlement, which is the order §21.7 and §17 require.
  assert.deepEqual(journal, [
    'claim',
    'prepare',
    'materialize',
    'put:context-snapshot',
    'start',
    'put:worker-report',
    'settle',
  ])
})

test('the session is opened under the derived run id, in the worktree, under the role preset', async () => {
  const { worker, runtime, worktrees, journal } = await workerFixture()
  const report = unwrap(await worker.runAttempt(admission()))

  const prepared = worktrees.registrations.get(report.attemptId)
  assert.ok(prepared !== undefined, 'the fixture must have prepared a worktree')
  assert.equal(runtime.requests.length, 1)
  const started = runtime.requests[0]
  assert.equal(started.runId, contracts.attemptRunId(report.attemptId))
  // Not a fresh random id: the same attempt names the same run in every process.
  assert.equal(started.runId, contracts.attemptRunId(report.attemptId))
  assert.equal(started.worktree.path, prepared.path)
  assert.equal(started.scope.agentPreset, 'worker')
  assert.deepEqual(started.frozen, admission().frozen)
  assert.equal(report.worktree.path, prepared.path)
  assert.equal(report.sessionId, 'session-fake-1')
  assert.deepEqual(portCalls(journal), ['claim', 'prepare', 'materialize', 'start', 'settle'])
})

test('a second runAttempt on the same attempt does not start a second session', async () => {
  const { worker, runtime, store } = await workerFixture()
  const first = unwrap(await worker.runAttempt(admission()))
  assert.equal(runtime.calls.filter(call => call.startsWith('start:')).length, 1)

  /** The durable settlement of one attempt, as SQLite holds it. */
  const settledRow = attemptId =>
    store.transaction(tx => tx.get('SELECT state, revision, settled_at FROM attempt WHERE attempt_id = ?', attemptId))
  const before = settledRow(first.attemptId)

  const second = unwrap(await worker.runAttempt(admission()))
  assert.equal(second.reused, true)
  assert.equal(second.attemptId, first.attemptId)
  assert.equal(second.attemptState, 'completed')
  // No port was touched again: not the worktree, not the fabric, not the runtime.
  assert.equal(runtime.calls.filter(call => call.startsWith('start:')).length, 1)
  assert.equal(second.sessionId, first.sessionId)
  // §17: one attempt has one authoritative settlement. The worker asks the saga
  // again on the repeated call — deliberately, because the owner of the fence is
  // the one that decides whether a result may still be applied (`worker.ts:773`),
  // and a late result is refused with STALE_FENCE right there. What must happen
  // exactly once is the *durable* settlement, so the row is what is checked: the
  // second call moves neither the state, nor the revision, nor `settled_at`.
  assert.deepEqual(settledRow(first.attemptId), before, 'the repeated call must not settle the attempt a second time')
})

test('a refused runtime run fails the attempt and keeps its evidence', async () => {
  const { worker, store, journal } = await workerFixture({
    onRun: (request, callMeta) =>
      core.fail(
        new core.MyWorkError('TASK_CONFLICT', `dsh-mywork: run "${request.runId}" was already started`, {
          details: { runId: request.runId, reason: 'run-already-started' },
        }),
        callMeta,
      ),
  })
  const refused = await worker.runAttempt(admission())
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'TASK_CONFLICT')
  assert.match(refused.error.message, /already started/)

  const attempt = store.transaction(tx =>
    tx.get('SELECT state, settled_at FROM attempt ORDER BY created_at LIMIT 1'),
  )
  assert.equal(attempt.state, 'failed')
  assert.notEqual(attempt.settled_at, null)
  assert.ok(journal.includes('put:worker-report'), 'the failure must leave a report behind')
  assert.equal(journal[journal.length - 1], 'settle')
})

test('the context fabric is asked only after the claim froze the attempt revisions', async () => {
  const { worker, context, journal } = await workerFixture()
  unwrap(await worker.runAttempt(admission()))

  assert.equal(context.requests.length, 1)
  const request = context.requests[0]
  assert.deepEqual(request.frozen, admission().frozen)
  assert.ok(journal.indexOf('claim') < journal.indexOf('materialize'), 'the claim must come first')
  assert.ok(journal.indexOf('materialize') < journal.indexOf('start'), 'the snapshot must precede the session')
})

test('a cancelled run settles the attempt as cancelled', async () => {
  let release
  const gate = new Promise(resolve => {
    release = resolve
  })
  const { worker, runtime } = await workerFixture({ gate })
  const controller = new AbortController()
  const pending = worker.runAttempt(admission(), { signal: controller.signal })
  await waitFor(() => runtime.calls.some(call => call.startsWith('start:')), 'the session to start')
  controller.abort()
  release()

  const report = unwrap(await pending)
  assert.equal(report.outcome, 'cancelled')
  assert.equal(report.attemptState, 'cancelled')
})

test('the prompt carries the task, the attempt, and the worktree — never the shared checkout', async () => {
  const { worker, runtime } = await workerFixture()
  const report = unwrap(await worker.runAttempt(admission()))
  const prompt = runtime.requests[0].prompt

  assert.match(prompt, /task: T-1/)
  assert.match(prompt, new RegExp(`attempt: ${report.attemptId}`))
  assert.match(prompt, new RegExp(`worktree: ${report.worktree.path.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`))
  // §19: the attempt's world is its worktree. Nothing the worker could read from
  // the shared checkout belongs in a prompt, so the prompt is exactly the text
  // the admission carried plus the identity lines.
  assert.equal(
    prompt,
    [
      'Do the work of T-1.',
      '',
      'task: T-1',
      `attempt: ${report.attemptId}`,
      `worktree: ${report.worktree.path}`,
      `branch: ${report.worktree.branch}`,
      `base: ${'a'.repeat(40)}`,
    ].join('\n'),
  )
  assert.equal(prompt.includes('shared checkout'), false)
  assert.equal(runtime.requests[0].attemptId, report.attemptId)
})

test('a completed run records every gate verdict before it may be reported', async t => {
  const { worker, journal, store, gates } = await workerFixture({ gates: {} })
  const report = unwrap(await worker.runAttempt(admission()))

  assert.equal(report.outcome, 'completed')
  assert.equal(report.attemptState, 'completed')
  // §19, E-17: the session, then the gates, then the report and the settlement —
  // the verdicts exist before anything may call the run done.
  assert.deepEqual(journal, [
    'claim',
    'prepare',
    'materialize',
    'put:context-snapshot',
    'start',
    'gates',
    'put:gate-result',
    'put:gate-result',
    'put:worker-report',
    'settle',
  ])
  assert.equal(gates.requests.length, 1)
  const request = gates.requests[0]
  assert.equal(request.attemptId, report.attemptId)
  assert.equal(request.taskId, 'T-1')
  assert.equal(request.workspaceId, 'W-1')
  // The gates run inside the attempt's own worktree, and answer about the head
  // pinned for the attempt — never a fresh read of the shared checkout (§19).
  assert.equal(request.cwd, report.worktree.path)
  assert.equal(request.cwd.includes('worktrees'), true)
  assert.equal(request.headSha, 'a'.repeat(40))
  assert.equal(request.headSha, report.worktree.headSha)
  // Every verdict is durable evidence of the attempt, and the report names them in
  // the order the policy ran them.
  const rows = store.transaction(tx =>
    tx.all(
      "SELECT artifact_id, task_id, correlation_id FROM artifacts WHERE kind = 'gate-result' AND attempt_id = ? ORDER BY artifact_id",
      report.attemptId,
    ),
  )
  assert.deepEqual(
    rows.map(row => row.artifact_id),
    [`gate-result-${report.attemptId}-lint`, `gate-result-${report.attemptId}-unit`],
    'one gate-result per verdict',
  )
  assert.equal(rows[0].task_id, 'T-1')
  assert.equal(rows[0].correlation_id, 'corr-1')
  assert.deepEqual(report.artifactRefs.map(ref => ref.artifactId), [
    `context-snapshot-${report.attemptId}`,
    `gate-result-${report.attemptId}-unit`,
    `gate-result-${report.attemptId}-lint`,
    `worker-report-${report.attemptId}`,
  ])
  // The numbers the MW-023 report quotes, printed where they were measured.
  t.diagnostic(`gate-result rows -> ${JSON.stringify(rows.map(row => row.artifact_id))}`)
  t.diagnostic(`request -> cwd ${request.cwd}, head ${request.headSha}`)
  t.diagnostic(`attempt -> ${JSON.stringify(store.transaction(tx => tx.get('SELECT state, revision, settled_at FROM attempt WHERE attempt_id = ?', report.attemptId)))}`)
})

test('a failing required gate settles the attempt as failed with REVIEW_GATES_MISSING', async t => {
  const { worker, store, saga } = await workerFixture({ gates: { failing: ['unit'] } })
  const refused = await worker.runAttempt(admission())

  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'TASK_CONFLICT')
  assert.equal(refused.error.details.refusal, 'REVIEW_GATES_MISSING')
  assert.equal(refused.error.details.reason, 'gates-not-passing')
  assert.match(refused.error.message, /no passing gate set/)
  // The verdicts are evidence even though the attempt failed: the failing gate is
  // exactly what a reviewer has to be able to see, so both were still recorded.
  const rows = store.transaction(tx =>
    tx.all("SELECT artifact_id FROM artifacts WHERE kind = 'gate-result' AND attempt_id = ?", 'attempt-op-1'),
  )
  assert.equal(rows.length, 2)
  const row = store.transaction(tx =>
    tx.get('SELECT state, settled_at FROM attempt WHERE attempt_id = ?', 'attempt-op-1'),
  )
  assert.equal(row.state, 'failed')
  assert.notEqual(row.settled_at, null, 'the attempt is settled, not left live')
  assert.deepEqual(saga.liveAttempts('W-1'), [], 'no live attempt is left behind')
  t.diagnostic(`refusal -> ${refused.error.code}: ${refused.error.message}`)
  t.diagnostic(`verdict rows despite the failure -> ${rows.length}; attempt -> ${JSON.stringify(row)}`)
})

test('a gate run refused with GATE_HEAD_MOVED settles the attempt as failed', async () => {
  const { worker, store, saga, journal } = await workerFixture({ gates: { refusal: 'GATE_HEAD_MOVED' } })
  const refused = await worker.runAttempt(admission())

  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'TASK_CONFLICT')
  assert.equal(refused.error.details.refusal, 'REVIEW_GATES_MISSING')
  assert.equal(refused.error.details.gateRefusal, 'GATE_HEAD_MOVED')
  assert.match(refused.error.message, /GATE_HEAD_MOVED/)
  // A refused run carries no verdicts, so nothing is written for it.
  assert.equal(journal.includes('put:gate-result'), false)
  assert.equal(
    store.transaction(tx => Number(tx.get("SELECT COUNT(*) AS n FROM artifacts WHERE kind = 'gate-result'").n)),
    0,
  )
  const row = store.transaction(tx =>
    tx.get('SELECT state, settled_at FROM attempt WHERE attempt_id = ?', 'attempt-op-1'),
  )
  assert.equal(row.state, 'failed')
  assert.notEqual(row.settled_at, null)
  assert.deepEqual(saga.liveAttempts('W-1'), [])
})

test('a run that did not complete asks for no verdicts, and an absent port is not a pass', async () => {
  // (1) A run that did not complete has nothing to verify: the port is not asked,
  // because verdicts about work nobody claims is finished may not admit anything.
  const cancelled = await workerFixture({ gates: {}, outcome: 'cancelled' })
  const report = unwrap(await cancelled.worker.runAttempt(admission()))
  assert.equal(report.outcome, 'cancelled')
  assert.equal(cancelled.gates.requests.length, 0)
  assert.equal(cancelled.journal.includes('gates'), false)

  // (2) A worker with no port records no verdicts — and that is not a silent
  // pass: the consumer's own check refuses admission for exactly that reason.
  const bare = await workerFixture()
  unwrap(await bare.worker.runAttempt(admission()))
  assert.equal(
    bare.store.transaction(tx => Number(tx.get("SELECT COUNT(*) AS n FROM artifacts WHERE kind = 'gate-result'").n)),
    0,
  )
  const judged = execution.assertGatesSatisfied('attempt-op-1', 'a'.repeat(40), [])
  assert.equal(judged.ok, false)
  assert.equal(judged.error.details.refusal, execution.REVIEW_ADMISSION_REFUSAL)
})
