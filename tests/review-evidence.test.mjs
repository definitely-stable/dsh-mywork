/**
 * The evidence package and the `review-verdict` artifact (architecture §8, §19,
 * §32; MW-024, E-22).
 *
 * What has to hold: the verdict is a closed dictionary; a finding carries a
 * severity, a summary, and a status; the stored record is tied to the review and
 * the attempt it judges; the artifact it binds to is the one the queue recorded
 * rather than one the reviewer typed; and the states that require findings
 * (`REVIEW_STATES_REQUIRING_FINDINGS`) refuse a verdict without them **without
 * changing the review**.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const load = async name => import(pathToFileURL(join(repoRoot, 'packages', name, 'lib', 'index.js')).href)

const contracts = await load('contracts')
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

const READ_ONLY_GRANT = { agentId: 'Neo-2', instanceId: 'I-2', permissions: ['workspace.read', 'git.read', 'review.approve'] }

/** A review that a reviewer holds and has started. */
async function reviewingHarness() {
  const clock = fakeClock()
  const { store, migration } = await openQueueDatabase(clock)
  const queue = execution.createReviewQueue({ store, graph: fakeGraph().port, clock: clock.port, migration, git: fakeGit() })
  insertAttempt(store, { id: 'A-1', state: 'running', settled: true }, clock.nowMs)
  const refs = evidenceRefs(store, 'A-1', clock.nowMs)
  const gate = recordGatePass(store, 'A-1', HEAD_A, clock.nowMs)
  const requested = await queue.requestReview({
    attemptId: 'A-1',
    evidence: { reviewed: { headSha: HEAD_A, diffHash: DH_A }, gates: [gate], ...refs },
    meta: meta(),
  })
  assert.equal(requested.ok, true, requested.ok ? '' : requested.error.message)
  const reviewId = requested.value.claim.reviewId
  const claimed = queue.claimReview({ reviewId, expectedRevision: 1, actor: { kind: 'agent', grant: READ_ONLY_GRANT }, meta: meta('op-claim') })
  assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.error.message)
  const began = queue.beginReviewing({ reviewId, expectedRevision: claimed.value.claim.revision, meta: meta('op-begin') })
  assert.equal(began.ok, true, began.ok ? '' : began.error.message)
  return { store, queue, clock, reviewId, revision: began.value.claim.revision }
}

test('a verdict comes from a closed dictionary', async () => {
  const m = meta()
  for (const verdict of contracts.REVIEW_VERDICTS) {
    const draft = execution.readReviewVerdictDraft({ verdict, justification: 'because' }, m)
    assert.equal(draft.ok, true, `${verdict}: ${draft.ok ? '' : draft.error.message}`)
    assert.equal(draft.value.verdict, verdict)
  }
  assert.deepEqual([...contracts.REVIEW_VERDICTS], ['PASS', 'PASS WITH FINDINGS', 'FAIL'])

  for (const verdict of ['pass', 'Pass', 'PASSED', 'FAILED', '', null, undefined, 7, ['PASS'], { verdict: 'PASS' }]) {
    const draft = execution.readReviewVerdictDraft({ verdict, justification: 'because' }, m)
    assert.equal(draft.ok, false, `${JSON.stringify(verdict)} must be refused`)
    assert.equal(draft.error.code, 'CONTRACT_MISMATCH')
  }
  const empty = execution.readReviewVerdictDraft({ verdict: 'PASS', justification: '  ' }, m)
  assert.equal(empty.ok, false)
  assert.equal(empty.error.code, 'CONTRACT_MISMATCH')
})

test('a finding requires a severity, a summary, and a status', async () => {
  const m = meta()
  const finding = { id: 'F-1', severity: 'MAJOR', summary: 'the check is missing', status: 'open' }
  const full = execution.readReviewVerdictDraft({ verdict: 'FAIL', justification: 'no', findings: [{ ...finding, location: 'a.ts:7', detail: 'because' }] }, m)
  assert.equal(full.ok, true, full.ok ? '' : full.error.message)
  assert.equal(full.value.findings.length, 1)
  assert.equal(full.value.findings[0].location, 'a.ts:7')

  const cases = [
    [{ id: 'F-1', summary: 'x', status: 'open' }, /severity/],
    [{ id: 'F-1', severity: 'CRITICAL', summary: 'x', status: 'open' }, /severity/],
    [{ id: 'F-1', severity: 'MAJOR', status: 'open' }, /summary/],
    [{ id: 'F-1', severity: 'MAJOR', summary: '   ', status: 'open' }, /summary/],
    [{ id: 'F-1', severity: 'MAJOR', summary: 'x' }, /status/],
    [{ id: 'F-1', severity: 'MAJOR', summary: 'x', status: 'fixed' }, /status/],
    [{ severity: 'MAJOR', summary: 'x', status: 'open' }, /id/],
  ]
  for (const [candidate, pattern] of cases) {
    const draft = execution.readReviewVerdictDraft({ verdict: 'FAIL', justification: 'no', findings: [candidate] }, m)
    assert.equal(draft.ok, false, `${JSON.stringify(candidate)} must be refused`)
    assert.equal(draft.error.code, 'CONTRACT_MISMATCH')
    assert.match(draft.error.message, pattern)
  }
  assert.deepEqual([...contracts.REVIEW_FINDING_SEVERITIES], ['MAJOR', 'MINOR', 'NIT'])
  assert.deepEqual([...contracts.REVIEW_FINDING_STATUSES], ['open', 'addressed', 'accepted'])
})

test('the stored verdict artifact is tied to the review and the attempt', async () => {
  const h = await reviewingHarness()
  try {
    const submitted = await h.queue.submitVerdict({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      draft: {
        verdict: 'PASS WITH FINDINGS',
        justification: 'the work is accepted with two notes',
        commands: [{ command: 'node --test tests/review-evidence.test.mjs', exitCode: 0, observation: 'pass 6 / fail 0' }],
        findings: [
          { id: 'F-1', severity: 'MINOR', summary: 'a comment is stale', status: 'open' },
          { id: 'F-2', severity: 'NIT', summary: 'naming', status: 'accepted' },
        ],
        unverified: [{ claim: 'no flakiness', reason: 'the suite ran once' }],
        limitations: ['a live review session was not started'],
      },
      meta: meta('op-verdict'),
    })
    assert.equal(submitted.ok, true, submitted.ok ? '' : submitted.error.message)
    assert.equal(submitted.value.claim.state, 'approved')
    assert.equal(submitted.value.review.state, 'approved')

    const artifact = h.store.transaction(tx =>
      tx.get("SELECT kind, review_id, attempt_id, hash FROM artifacts WHERE review_id = ? AND kind = 'review-verdict'", h.reviewId),
    )
    assert.equal(artifact.kind, 'review-verdict')
    assert.equal(artifact.review_id, h.reviewId)
    assert.equal(artifact.attempt_id, 'A-1')
    assert.equal(artifact.hash, submitted.value.artifact.hash)

    const payload = h.queue.verdictOf(h.reviewId)
    assert.equal(payload.schema, contracts.REVIEW_VERDICT_SCHEMA)
    assert.equal(payload.reviewId, h.reviewId)
    assert.equal(payload.attemptId, 'A-1')
    assert.equal(payload.taskId, 'T-1')
    assert.equal(payload.reviewerId, 'Neo-2')
    assert.equal(payload.verdict, 'PASS WITH FINDINGS')
    assert.equal(payload.findings.length, 2)
    assert.equal(payload.commands[0].exitCode, 0)
    assert.equal(payload.unverified.length, 1)
    assert.equal(payload.limitations.length, 1)

    // The machine reads the same verdict as the findings of the review.
    assert.match(submitted.value.review.findings.summary, /MINOR: a comment is stale/)
  } finally {
    h.store.close()
  }
})

test('the reviewed artifact is the queue\u2019s, not the reviewer\u2019s', async () => {
  const h = await reviewingHarness()
  try {
    const forged = await h.queue.submitVerdict({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      draft: { verdict: 'PASS', justification: 'looks fine', reviewed: { headSha: 'b'.repeat(40), diffHash: 'e'.repeat(64) } },
      meta: meta('op-forged'),
    })
    assert.equal(forged.ok, false, 'a verdict cannot name the revision it examined')
    assert.equal(forged.error.code, 'CONTRACT_MISMATCH')
    assert.match(forged.error.message, /reviewed/)
    assert.equal(h.queue.reviewOf(h.reviewId).state, 'reviewing')

    const honest = await h.queue.submitVerdict({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      draft: { verdict: 'PASS', justification: 'looks fine' },
      meta: meta('op-honest'),
    })
    assert.equal(honest.ok, true, honest.ok ? '' : honest.error.message)
    assert.deepEqual(honest.value.payload.reviewed, { headSha: HEAD_A, diffHash: DH_A })
    assert.deepEqual(honest.value.review.artifact, { headSha: HEAD_A, diffHash: DH_A })
  } finally {
    h.store.close()
  }
})

test('a rejection without findings is refused and leaves the review alone', async () => {
  const h = await reviewingHarness()
  try {
    const before = h.store.transaction(tx => tx.get('SELECT state, revision FROM review_claim WHERE review_id = ?', h.reviewId))
    const refused = await h.queue.submitVerdict({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      draft: { verdict: 'FAIL', justification: 'not acceptable' },
      meta: meta('op-bare-fail'),
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'TASK_CONFLICT')
    assert.match(refused.error.message, /without findings/)

    const after = h.store.transaction(tx => tx.get('SELECT state, revision FROM review_claim WHERE review_id = ?', h.reviewId))
    assert.deepEqual(after, before, 'the refusal changed no state')
    assert.equal(
      h.store.transaction(tx => tx.get('SELECT COUNT(*) AS n FROM artifacts WHERE review_id = ?', h.reviewId)).n,
      0,
      'a refused verdict writes no artifact',
    )
    assert.equal(h.queue.verdictOf(h.reviewId), undefined)

    // The same verdict with findings moves the review to rejected.
    const documented = await h.queue.submitVerdict({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      draft: {
        verdict: 'FAIL',
        justification: 'not acceptable',
        findings: [{ id: 'F-1', severity: 'MAJOR', summary: 'coverage is missing', status: 'open' }],
      },
      meta: meta('op-documented-fail'),
    })
    assert.equal(documented.ok, true, documented.ok ? '' : documented.error.message)
    assert.equal(documented.value.claim.state, 'rejected')
    assert.equal(core.REVIEW_STATES_REQUIRING_FINDINGS.includes('rejected'), true)
    assert.equal(core.REVIEW_STATES_REQUIRING_FINDINGS.includes('needs-evidence'), true)
  } finally {
    h.store.close()
  }
})

test('needs-evidence requires findings and returns to reviewing', async () => {
  const h = await reviewingHarness()
  try {
    const bare = h.queue.requestMoreEvidence({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      findings: { summary: '   ' },
      meta: meta('op-bare-evidence'),
    })
    assert.equal(bare.ok, false)
    assert.equal(bare.error.code, 'TASK_CONFLICT')
    assert.equal(h.queue.reviewOf(h.reviewId).state, 'reviewing')

    const asked = h.queue.requestMoreEvidence({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      findings: { summary: 'Provide the coverage report of the reviewed head' },
      meta: meta('op-ask-evidence'),
    })
    assert.equal(asked.ok, true, asked.ok ? '' : asked.error.message)
    assert.equal(asked.value.claim.state, 'needs-evidence')
    assert.equal(asked.value.claim.settledAt, undefined, 'needs-evidence is not terminal')

    const resumed = h.queue.provideEvidence({ reviewId: h.reviewId, expectedRevision: asked.value.claim.revision, meta: meta('op-resume') })
    assert.equal(resumed.ok, true, resumed.ok ? '' : resumed.error.message)
    assert.equal(resumed.value.claim.state, 'reviewing')
    assert.equal(core.isReviewTerminal('needs-evidence'), false)
  } finally {
    h.store.close()
  }
})
