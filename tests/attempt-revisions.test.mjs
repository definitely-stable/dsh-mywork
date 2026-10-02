/**
 * Frozen revisions and the `context-snapshot` evidence of one attempt
 * (architecture §21.7, §32, §35; MW-022, E-09).
 *
 * §35 says an attempt freezes the revisions it resolved and never mutates them,
 * and §21.7 makes the snapshot the audit record of what the model was shown. The
 * four tests here pin both facts to durable bytes: the snapshot is stored before
 * the session starts, it is bound to the attempt, a repeat re-uses it rather than
 * minting a second revision, and the frozen set the attempt reports is the set
 * it was admitted with.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { adapterTesting, core, evidence, execution, lease, storage } from './lib/fixtures.mjs'

const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-worker-revisions-'

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

/** A `TaskGraphPort` fake that claims and projects one task. */
function fakeGraph() {
  const tasks = new Map([
    ['T-1', { id: 'T-1', workspaceId: 'W-1', title: 'T-1', description: '', state: 'ready', revision: 1, dependsOn: [] }],
  ])
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
        const registration = registrations.get(attemptId)
        if (registration === undefined) {
          return core.fail(
            new core.MyWorkError('TASK_CONFLICT', `no worktree for "${attemptId}"`, {
              details: { refusal: 'WORKTREE_MISSING' },
            }),
            callMeta,
          )
        }
        return core.ok(registration, callMeta)
      },
      cleanup: async (attemptId, callMeta) => core.ok(Object.freeze({ outcome: 'kept-orphan' }), callMeta),
      list: async (workspaceId, callMeta) => core.ok(Object.freeze([...registrations.values()]), callMeta),
    },
  }
}

/** An `AttemptContextPort` fake: deterministic for one attempt, as §35 requires. */
function fakeContext(journal) {
  const requests = []
  return {
    requests,
    port: {
      materialize: async (request, callMeta) => {
        journal.push('materialize')
        requests.push(request)
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

/** An `AttemptRunPort` fake that records what it was handed. */
function fakeRuntime(journal) {
  const requests = []
  const sessions = new Map()
  return {
    requests,
    sessions,
    port: {
      run: async (request, callMeta) => {
        journal.push('start')
        requests.push(request)
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
        throw new Error('the revisions fixture never resumes')
      },
      status: async (runId, callMeta) => {
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

/** A worker over fakes, with every call recorded in one journal. */
async function workerFixture() {
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
  const runtime = fakeRuntime(journal)
  const realArtifacts = evidence.createArtifactStore(store, { now: () => clock.now() })
  const artifacts = {
    put: request => {
      journal.push(`put:${request.kind}`)
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
  return { clock, store, worker, journal, context, runtime, artifacts }
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

/** Every `artifacts` row of one kind for one attempt, in recording order. */
function artifactRows(store, kind, attemptId) {
  return store.transaction(tx =>
    tx.all(
      'SELECT artifact_id, hash FROM artifacts WHERE kind = ? AND attempt_id = ? ORDER BY created_at, artifact_id',
      kind,
      attemptId,
    ),
  )
}

/** The stored bytes of the newest artifact of one kind, parsed as JSON. */
function storedJson(store, artifacts, kind, attemptId) {
  const rows = artifactRows(store, kind, attemptId)
  assert.ok(rows.length > 0, `no ${kind} artifact was stored for ${attemptId}`)
  const row = rows[rows.length - 1]
  const artifact = artifacts.get({ artifactId: row.artifact_id, hash: row.hash })
  return { artifact, body: JSON.parse(new TextDecoder().decode(artifact.bytes)) }
}

test('the context snapshot is stored before the session starts', async () => {
  const { worker, journal } = await workerFixture()
  unwrap(await worker.runAttempt(admission()))

  assert.deepEqual(journal, [
    'claim',
    'prepare',
    'materialize',
    'put:context-snapshot',
    'start',
    'put:worker-report',
    'settle',
  ])
  assert.ok(journal.indexOf('put:context-snapshot') < journal.indexOf('start'))
})

test('the snapshot metadata carries the task, the attempt, and the correlation', async () => {
  const { worker, store, artifacts } = await workerFixture()
  const report = unwrap(await worker.runAttempt(admission()))

  const rows = artifactRows(store, 'context-snapshot', report.attemptId)
  assert.equal(rows.length, 1)
  const metadata = store.transaction(tx =>
    tx.get('SELECT task_id, attempt_id, correlation_id, content_type FROM artifacts WHERE artifact_id = ?', rows[0].artifact_id),
  )
  assert.equal(metadata.task_id, 'T-1')
  assert.equal(metadata.attempt_id, report.attemptId)
  assert.equal(metadata.correlation_id, 'corr-1')
  assert.equal(metadata.content_type, 'application/json')

  const { body } = storedJson(store, artifacts, 'context-snapshot', report.attemptId)
  assert.equal(body.attemptId, report.attemptId)
  assert.equal(body.taskId, 'T-1')
  assert.equal(body.fingerprint, `fp-${report.attemptId}`)
  // The snapshot is the evidence the worker points at, by identity and hash.
  assert.deepEqual(report.artifactRefs[0], { artifactId: rows[0].artifact_id, hash: rows[0].hash })
})

test('a repeated run re-uses the same snapshot artifact', async () => {
  const { worker, store, artifacts } = await workerFixture()
  const first = unwrap(await worker.runAttempt(admission()))
  const rowsBefore = artifactRows(store, 'context-snapshot', first.attemptId)
  assert.equal(rowsBefore.length, 1)
  const storedBefore = artifacts.get({ artifactId: rowsBefore[0].artifact_id, hash: rowsBefore[0].hash })

  const second = unwrap(await worker.runAttempt(admission()))
  assert.equal(second.reused, true)

  const rowsAfter = artifactRows(store, 'context-snapshot', first.attemptId)
  assert.equal(rowsAfter.length, 1, 'a repeat must not mint a second revision of one attempt’s context')
  assert.deepEqual(rowsAfter[0], rowsBefore[0])
  const storedAfter = artifacts.get({ artifactId: rowsAfter[0].artifact_id, hash: rowsAfter[0].hash })
  assert.equal(storedAfter.metadata.hash, storedBefore.metadata.hash)
  assert.equal(storedAfter.metadata.createdAt, storedBefore.metadata.createdAt, 'the write time did not move either')
  // A repeated call reports the settled attempt; it does not re-list the evidence
  // it deliberately did not write again.
  assert.deepEqual(second.artifactRefs, [])
  assert.deepEqual(first.artifactRefs[0], { artifactId: rowsBefore[0].artifact_id, hash: rowsBefore[0].hash })
})

test('the attempt reports exactly the revisions it was frozen with', async t => {
  const { worker, store, context, artifacts } = await workerFixture()
  const frozen = Object.freeze({ config: 9, role: 4, skill: 11 })
  const report = unwrap(await worker.runAttempt(admission({ frozen })))

  assert.deepEqual(report.frozen, frozen)
  const { body } = storedJson(store, artifacts, 'worker-report', report.attemptId)
  assert.deepEqual(body.frozen, frozen, 'the frozen set is durable in the attempt’s own evidence')
  assert.equal(body.attemptId, report.attemptId)
  assert.equal(body.settledAs, 'completed')
  // The report names the evidence written before it; its own reference is added
  // by the settlement and cannot be inside the bytes it is hashing.
  assert.deepEqual(body.artifactRefs, [report.artifactRefs[0]])
  assert.equal(report.artifactRefs.length, 2)
  assert.equal(report.artifactRefs[1].artifactId, `worker-report-${report.attemptId}`)
  // And the fabric was asked to materialize exactly those revisions: the set the
  // attempt reports is the set it resolved, not one rebuilt afterwards.
  assert.deepEqual(context.requests[0].frozen, frozen)

  // The numbers the MW-022 report quotes, printed where they were measured: the
  // digest of the frozen context and the durable row the attempt settled as.
  t.diagnostic(`context-snapshot sha256 -> ${report.artifactRefs[0].hash}`)
  t.diagnostic(`frozen revisions -> ${JSON.stringify(report.frozen)}`)
  t.diagnostic(
    `attempt row -> ${JSON.stringify(store.transaction(tx =>
      tx.get('SELECT state, revision, settled_at FROM attempt WHERE attempt_id = ?', report.attemptId)))}`,
  )
})
