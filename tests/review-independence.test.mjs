/**
 * Reviewer independence (architecture §13.2, §13.4, §18.3; MW-024, E-20).
 *
 * The acceptance criterion this suite proves is "self-review is forbidden", and
 * it proves it **on the admission path**: a claim by the agent that produced the
 * attempt is refused with a typed code, and the review row is byte-for-byte what
 * it was. The second case is the interesting one — the same durable identity
 * under another live instance is the same reviewer, so an instance id can never
 * be a disguise.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const load = async name => import(pathToFileURL(join(repoRoot, 'packages', name, 'lib', 'index.js')).href)

const core = await load('core')
const storage = await load('storage')
const evidence = await load('evidence')
const execution = await load('execution')

const allocatorModule = await import(
  pathToFileURL(join(repoRoot, 'packages', 'controller', 'src', 'migration-allocator.ts')).href
)

const HEAD_A = 'a'.repeat(40)
const DH_A = 'd'.repeat(64)

const tempDirs = []
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-review-'))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) {
    assert.ok(dir.startsWith(join(tmpdir(), 'dsh-mywork-review-')), `refusing to remove ${dir}`)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // A store left open by a failing test keeps the file locked on Windows.
    }
  }
})

function fakeClock(start = 1_000) {
  let now = start
  return {
    get nowMs() {
      return now
    },
    advance: ms => (now += ms),
    port: { now: () => now, sleep: async () => {} },
  }
}

const meta = (operationId = 'op-1') => core.defineOperationMeta({ operationId, correlationId: 'corr-1' })

function fakeGraph(initialState = 'awaiting-review') {
  const tasks = new Map([
    ['T-1', Object.freeze({ id: 'T-1', workspaceId: 'W-1', title: 'Task 1', description: '', state: initialState, revision: 1, dependsOn: [] })],
  ])
  return {
    tasks,
    port: {
      capabilities: async () => ({ adapterId: 'fake', contractVersion: 'taskgraph/v1', capabilities: {}, source: 'declared' }),
      get: async id => {
        const task = tasks.get(id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${id}"`)
        return task
      },
      ready: async () => [],
      blocked: async () => [],
      dependencies: async () => [],
      mutatePlan: async () => {
        throw new Error('unused')
      },
      claim: async () => {
        throw new Error('unused')
      },
      doctor: async () => [],
      transition: async command => {
        const task = tasks.get(command.id)
        const next = Object.freeze({ ...task, state: command.to, revision: task.revision + 1 })
        tasks.set(command.id, next)
        return next
      },
    },
  }
}

function fakeGit(head = HEAD_A, diffHash = DH_A) {
  return {
    resolveHead: async (_cwd, callMeta) => core.ok(head, callMeta),
    diffHash: async (_cwd, _base, _head, callMeta) => core.ok(diffHash, callMeta),
    isClean: async (_cwd, callMeta) => core.ok(true, callMeta),
  }
}

async function openQueueDatabase(clock) {
  const path = join(tempDir(), 'controller.sqlite')
  const baseMigrations = [...storage.MYWORK_MIGRATIONS, ...evidence.EVIDENCE_MIGRATIONS, ...execution.CLAIM_SAGA_MIGRATIONS]
  const book = await storage.openStore({ path, migrations: baseMigrations, clock: { now: () => clock.nowMs } })
  const allocator = allocatorModule.createMigrationAllocator(book, { now: () => clock.nowMs })
  const version = allocator.allocate({ key: execution.REVIEW_CLAIM_ALLOCATION_KEY })
  book.close()
  const migration = execution.createReviewClaimMigration({ version })
  const store = await storage.openStore({ path, migrations: [...baseMigrations, migration], clock: { now: () => clock.nowMs } })
  return { store, migration }
}

const text = value => new TextEncoder().encode(value)

function put(store, request, now) {
  return store.transaction(tx => evidence.putArtifact(tx, request, now).ref)
}

function evidenceRefs(store, attemptId, now) {
  const common = { workspaceId: 'W-1', correlationId: 'corr-1', taskId: 'T-1', attemptId }
  return {
    diff: put(store, { ...common, artifactId: `${attemptId}-diff`, kind: 'diff', contentType: 'text/x-diff', bytes: text('--- a\n+++ b\n') }, now),
    workerReport: put(store, { ...common, artifactId: `${attemptId}-report`, kind: 'worker-report', contentType: 'application/json', bytes: text('{}') }, now),
    contextSnapshot: put(store, { ...common, artifactId: `${attemptId}-context`, kind: 'context-snapshot', contentType: 'application/json', bytes: text('{}') }, now),
  }
}

function recordGatePass(store, attemptId, headSha, now) {
  const common = { workspaceId: 'W-1', correlationId: 'corr-1', taskId: 'T-1', attemptId }
  return store.transaction(tx => {
    const log = evidence.putArtifact(tx, { ...common, artifactId: `${attemptId}-gate-log`, kind: 'build-log', contentType: 'text/plain', bytes: text('ok') }, now).ref
    const result = { id: 'unit', headSha, exitCode: 0, verdict: 'pass', artifactRef: { artifactId: log.artifactId, hash: log.hash } }
    return evidence.putArtifact(
      tx,
      { ...common, artifactId: `${attemptId}-gate-result`, kind: 'gate-result', contentType: 'application/json', bytes: text(JSON.stringify(result)) },
      now,
    ).ref
  })
}

function insertAttempt(store, { id, state = 'created', settled = false, agentId = 'Neo-1' }, now) {
  return store.transaction(tx => {
    const fence = execution.allocateFence(tx, 'T-1', now)
    execution.insertAttempt(tx, {
      id,
      taskId: 'T-1',
      workspaceId: 'W-1',
      agentId,
      state,
      revision: 1,
      fence,
      controllerEpoch: 3,
      leaseExpiresAt: now + 60_000,
      operationId: `op-${id}`,
      createdAt: now,
    })
    if (settled) execution.settleAttempt(tx, id, state, 'completed', now + 1)
    return fence
  })
}

async function harness() {
  const clock = fakeClock()
  const { store, migration } = await openQueueDatabase(clock)
  const graph = fakeGraph()
  const queue = execution.createReviewQueue({ store, graph: graph.port, clock: clock.port, migration, git: fakeGit() })
  insertAttempt(store, { id: 'A-1', state: 'running', settled: true }, clock.nowMs)
  const refs = evidenceRefs(store, 'A-1', clock.nowMs)
  const gate = recordGatePass(store, 'A-1', HEAD_A, clock.nowMs)
  const requested = await queue.requestReview({
    attemptId: 'A-1',
    evidence: { reviewed: { headSha: HEAD_A, diffHash: DH_A }, gates: [gate], ...refs },
    meta: meta(),
  })
  assert.equal(requested.ok, true, requested.ok ? '' : requested.error.message)
  return { store, graph, queue, clock, reviewId: requested.value.claim.reviewId }
}

/** The stored row of one review, as SQLite returns it. */
function row(store, reviewId) {
  return store.transaction(tx => tx.get('SELECT state, revision, reviewer_id FROM review_claim WHERE review_id = ?', reviewId))
}

const grant = (agentId, instanceId) => ({
  kind: 'agent',
  grant: { agentId, instanceId, permissions: ['workspace.read', 'git.read', 'review.approve'] },
})

test('a reviewer that produced the attempt is refused, and the review does not move', async () => {
  const h = await harness()
  try {
    const refused = h.queue.claimReview({ reviewId: h.reviewId, expectedRevision: 1, actor: grant('Neo-1', 'I-9'), meta: meta('op-self') })
    assert.equal(refused.ok, false, 'a worker cannot review its own attempt')
    assert.equal(refused.error.code, 'SECURITY_DENIED')
    assert.equal(refused.error.details.workerAgentId, 'Neo-1')
    assert.equal(refused.error.details.reviewerAgentId, 'Neo-1')
    assert.match(refused.error.message, /cannot review its own attempt/)

    // §62 item 16 is about state, not only about a return value.
    const stored = row(h.store, h.reviewId)
    assert.equal(stored.state, 'queued')
    assert.equal(stored.revision, 1)
    assert.equal(stored.reviewer_id, null)
  } finally {
    h.store.close()
  }
})

test('another instance of the worker identity is still the same reviewer', async () => {
  const h = await harness()
  try {
    const refused = h.queue.claimReview({ reviewId: h.reviewId, expectedRevision: 1, actor: grant('Neo-1', 'I-2'), meta: meta('op-instance') })
    assert.equal(refused.ok, false, 'an instance id is not an identity')
    assert.equal(refused.error.code, 'SECURITY_DENIED')
    assert.equal(row(h.store, h.reviewId).state, 'queued')

    // Non-vacuity: the very same instance id with another durable identity is
    // accepted, so what was refused is the identity and not the instance field.
    const accepted = h.queue.claimReview({ reviewId: h.reviewId, expectedRevision: 1, actor: grant('Neo-2', 'I-2'), meta: meta('op-other') })
    assert.equal(accepted.ok, true, accepted.ok ? '' : accepted.error.message)
    assert.equal(accepted.value.claim.reviewerId, 'Neo-2')
  } finally {
    h.store.close()
  }
})

test('an independent reviewer is admitted', async () => {
  const h = await harness()
  try {
    const claimed = h.queue.claimReview({ reviewId: h.reviewId, expectedRevision: 1, actor: grant('Neo-3', 'I-3'), meta: meta('op-independent') })
    assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.error.message)
    assert.equal(claimed.value.claim.state, 'claimed')
    assert.equal(claimed.value.claim.reviewerId, 'Neo-3')
    assert.equal(claimed.value.claim.workerAgentId, 'Neo-1', 'the claim records whose work is reviewed')
    assert.equal(row(h.store, h.reviewId).state, 'claimed')
  } finally {
    h.store.close()
  }
})

test('a refused claim leaves the review claimable by an independent reviewer', async () => {
  const h = await harness()
  try {
    const before = row(h.store, h.reviewId)
    const refused = h.queue.claimReview({ reviewId: h.reviewId, expectedRevision: 1, actor: grant('Neo-1', 'I-9'), meta: meta('op-self') })
    assert.equal(refused.ok, false)
    const after = row(h.store, h.reviewId)
    assert.deepEqual(after, before, 'a refusal writes nothing')

    const accepted = h.queue.claimReview({ reviewId: h.reviewId, expectedRevision: 1, actor: grant('Neo-4', 'I-4'), meta: meta('op-next') })
    assert.equal(accepted.ok, true, accepted.ok ? '' : accepted.error.message)
    const stored = row(h.store, h.reviewId)
    assert.equal(stored.state, 'claimed')
    assert.equal(stored.revision, 2)
  } finally {
    h.store.close()
  }
})
