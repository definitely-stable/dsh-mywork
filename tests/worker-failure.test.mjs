/**
 * The failure path: evidence kept, capacity released (architecture §17, §18.2,
 * §32, §49; MW-022, E-10).
 *
 * A failed attempt is the case where two mistakes are easy and expensive: losing
 * the reason the work stopped, and leaving the task's only lease slot occupied.
 * The five tests here pin both: the attempt reaches a terminal state with its
 * evidence written first, the live-attempt list is empty afterwards, the fence
 * counter did not move, and a second task can be admitted immediately.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { adapterTesting, contracts, core, evidence, execution, lease, storage } from './lib/fixtures.mjs'

const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-worker-failure-'

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

/** A `TaskGraphPort` fake carrying the two tasks the suite admits. */
function fakeGraph() {
  const tasks = new Map(
    ['T-1', 'T-2'].map(id => [
      id,
      { id, workspaceId: 'W-1', title: id, description: '', state: 'ready', revision: 1, dependsOn: [] },
    ]),
  )
  return {
    tasks,
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
        const task = tasks.get(command.id)
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
function fakeWorktrees(journal) {
  const registrations = new Map()
  return {
    registrations,
    port: {
      prepare: async (request, callMeta) => {
        journal.push('prepare')
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
      resolve: async (attemptId, callMeta) => {
        journal.push('resolve')
        return core.ok(registrations.get(attemptId), callMeta)
      },
      cleanup: async (attemptId, callMeta) => core.ok(Object.freeze({ outcome: 'kept-orphan' }), callMeta),
      list: async (workspaceId, callMeta) => core.ok(Object.freeze([...registrations.values()]), callMeta),
    },
  }
}

/** An `AttemptContextPort` fake: one deterministic snapshot per attempt. */
function fakeContext(journal) {
  return {
    port: {
      materialize: async (request, callMeta) => {
        journal.push('materialize')
        return core.ok(
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
        )
      },
    },
  }
}

/** An `AttemptRunPort` fake whose run refuses, observing the live attempts while it runs. */
function fakeRuntime(journal, refusal, onRun) {
  return {
    port: {
      run: async (request, callMeta) => {
        journal.push('start')
        onRun?.(request)
        return core.fail(
          new core.MyWorkError('TASK_CONFLICT', `dsh-mywork: ${refusal}`, {
            details: { runId: request.runId, reason: 'run-refused' },
          }),
          callMeta,
        )
      },
      resume: async () => {
        throw new Error('the failure fixture never resumes')
      },
      status: async (runId, callMeta) => core.ok(Object.freeze({ runId, running: false }), callMeta),
    },
  }
}

/** A worker over fakes, with every call recorded in one journal. */
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
  const worktrees = fakeWorktrees(journal)
  const context = fakeContext(journal)
  let liveDuringRun
  const runtime = fakeRuntime(journal, options.refusal ?? 'the run was refused', () => {
    liveDuringRun = saga.liveAttempts('W-1').length
  })
  const realArtifacts = evidence.createArtifactStore(store, { now: () => clock.now() })
  const artifacts = {
    put: request => {
      journal.push(`put:${request.kind}`)
      if (options.refuseReport === true && request.kind === 'worker-report') {
        throw new Error('the evidence store refused the report')
      }
      return realArtifacts.put(request)
    },
    get: ref => realArtifacts.get(ref),
  }
  const worker = execution.createWorker({
    store,
    saga,
    worktrees: worktrees.port,
    context: context.port,
    runtime: runtime.port,
    evidence: artifacts,
    clock,
  })
  return { clock, store, worker, journal, saga: real, worktrees, artifacts, liveDuringRun: () => liveDuringRun }
}

/** An admission for one of the fixture tasks. */
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
    instructions: 'Do the work.',
    meta: meta(),
    ...overrides,
  }
}

/** The attempt row of one operation, as SQLite returns it. */
function attemptRow(store, attemptId) {
  return store.transaction(tx =>
    tx.get('SELECT state, settled_at, fence FROM attempt WHERE attempt_id = ?', attemptId),
  )
}

/** The current fence token of one task, or 0 when no attempt was ever made. */
function fenceOf(store, taskId) {
  const row = store.transaction(tx => tx.get('SELECT fence FROM task_fence WHERE task_id = ?', taskId))
  return row === undefined ? 0 : Number(row.fence)
}

test('a refused run settles the attempt as failed, and a refused report cannot keep it live', async t => {
  const { worker, store, journal } = await workerFixture({ refusal: 'the owner refused the run' })
  const refused = await worker.runAttempt(admission())
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'TASK_CONFLICT')
  assert.match(refused.error.message, /owner refused the run/)

  const row = attemptRow(store, 'attempt-op-1')
  assert.equal(row.state, 'failed')
  assert.notEqual(row.settled_at, null, 'a failed attempt is settled, not merely marked')
  assert.ok(journal.indexOf('put:worker-report') < journal.indexOf('settle'), 'evidence is written before the settlement')

  // The two queries the MW-022 report quotes: the row a failed attempt settles
  // as, and the count of attempts still holding a lease slot.
  t.diagnostic(`failed attempt -> ${JSON.stringify(row)}`)
  t.diagnostic(
    `live attempts -> ${store.transaction(tx =>
      Number(tx.get("SELECT COUNT(*) AS n FROM attempt WHERE state IN ('created','leased','starting','running','settling')").n))}`,
  )

  // The same flow with an evidence store that refuses the report: the attempt
  // must still reach a terminal state, and the caller must be told which failure
  // it is looking at.
  const second = await workerFixture({ refuseReport: true })
  const failed = await second.worker.runAttempt(admission())
  assert.equal(failed.ok, false)
  const rowDespiteRefusal = attemptRow(second.store, 'attempt-op-1')
  assert.equal(rowDespiteRefusal.state, 'failed')
  assert.notEqual(rowDespiteRefusal.settled_at, null)
  assert.ok(second.journal.includes('settle'), 'the settlement still ran')
})

test('the attempt keeps a report that names the reason it failed', async () => {
  const { worker, store, artifacts } = await workerFixture({ refusal: 'the toolchain was missing' })
  await worker.runAttempt(admission())

  const rows = store.transaction(tx =>
    tx.all("SELECT artifact_id, hash FROM artifacts WHERE kind = 'worker-report' AND attempt_id = ?", 'attempt-op-1'),
  )
  assert.equal(rows.length, 1, 'exactly one report for one failed attempt')
  const artifact = artifacts.get({ artifactId: rows[0].artifact_id, hash: rows[0].hash })
  const body = JSON.parse(new TextDecoder().decode(artifact.bytes))
  assert.equal(body.outcome, 'failed')
  assert.equal(body.settledAs, 'failed')
  assert.match(body.reason, /TASK_CONFLICT/)
  assert.match(body.reason, /the toolchain was missing/)
  assert.equal(body.attemptId, 'attempt-op-1')
  assert.equal(body.runId, contracts.attemptRunId('attempt-op-1'))
  assert.deepEqual(body.frozen, admission().frozen)
})

test('no live attempt is left behind by a failure', async () => {
  const { worker, saga, liveDuringRun } = await workerFixture()
  await worker.runAttempt(admission())
  // Control: while the run was being attempted the claim was live, so the empty
  // list below is the settlement's doing and not a claim that never happened.
  assert.equal(liveDuringRun(), 1)
  assert.deepEqual(saga.liveAttempts('W-1'), [])
  assert.equal(saga.attemptOf('T-1'), undefined, 'the task holds no attempt once the run failed')
})

test('the task fence does not move on a failure', async () => {
  const { worker, store } = await workerFixture()
  assert.equal(fenceOf(store, 'T-1'), 0, 'no attempt was ever admitted for the task')
  await worker.runAttempt(admission())

  // The fence the claim issued is the one the attempt carries, and the failure
  // spent nothing further: fence tokens are allocated by admissions, and a
  // settlement — successful or not — never touches the allocator (§17).
  const attempt = attemptRow(store, 'attempt-op-1')
  assert.equal(attempt.fence, 1)
  assert.equal(fenceOf(store, 'T-1'), 1)
  assert.equal(attempt.state, 'failed')

  // The next admission on the same task is the only thing that advances it.
  await worker.runAttempt(admission({ meta: meta({ operationId: 'op-2', correlationId: 'corr-2' }) }))
  assert.equal(fenceOf(store, 'T-1'), 2, 'a new attempt spends the next token, monotonically')
  assert.equal(attemptRow(store, 'attempt-op-2').fence, 2)
})

test('a failed attempt frees the capacity for the next admission', async () => {
  const { worker, store, saga } = await workerFixture()
  const failed = await worker.runAttempt(admission())
  assert.equal(failed.ok, false)

  const next = await worker.runAttempt(
    admission({ taskId: 'T-2', meta: meta({ operationId: 'op-2', correlationId: 'corr-2' }) }),
  )
  assert.equal(next.ok, false, 'the second admission is refused by the runtime too, not by capacity')
  // The second task got its own authoritative attempt with its own fence: the
  // first task's failure released the slot rather than blocking the workspace.
  const second = attemptRow(store, 'attempt-op-2')
  assert.equal(second.state, 'failed')
  // Fences are allocated per task, so the second task starts at its own first
  // token rather than inheriting the first task's counter.
  assert.equal(second.fence, 1)
  assert.equal(attemptRow(store, 'attempt-op-1').fence, 1)
  assert.deepEqual(saga.liveAttempts('W-1'), [])
  assert.equal(saga.openIntents('W-1').length, 0)
})
