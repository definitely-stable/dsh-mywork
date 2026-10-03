/**
 * Approval binding and staleness (architecture §19; MW-024, E-23).
 *
 * The acceptance criterion is "a change of SHA or diff cancels the approval",
 * and this suite proves it where it matters: the approval path re-reads the
 * checkout through the Git port, so a commit — or a rebuilt diff of the same
 * commit — is refused with `STALE_APPROVAL` instead of being integrated as if it
 * were approved. The last test checks the error dictionary itself: the code was
 * added additively, exactly once, and the order of the codes before it is
 * untouched.
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
const HEAD_B = 'b'.repeat(40)
const DH_A = 'd'.repeat(64)
const DH_B = 'e'.repeat(64)

/** The error dictionary as it stood before this card: `STALE_APPROVAL` is not in it. */
const CODES_BEFORE = Object.freeze([
  'ADAPTER_UNAVAILABLE',
  'CAPABILITY_UNSUPPORTED',
  'CONTRACT_MISMATCH',
  'TASK_CONFLICT',
  'STALE_REVISION',
  'LEASE_LOST',
  'STALE_FENCE',
  'CONTEXT_BUDGET_EXCEEDED',
  'MEMORY_BACKEND_ERROR',
  'SESSION_NOT_FOUND',
  'BUDGET_EXCEEDED',
  'UNSCHEDULABLE',
  'SECURITY_DENIED',
  'PLANNER_SCOPE_DENIED',
  'ORDER_RENUMBER_REQUIRED',
  'STALE_COLUMN_REVISION',
  'EVIDENCE_REQUEST_REQUIRED',
  'PLAN_MUTATION_STAGED',
  'PLAN_MUTATION_RECOVERY',
  'ENTITY_CYCLE',
])

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

/** A `GitPort` whose checkout the test moves by hand. */
function fakeGit() {
  const state = { head: HEAD_A, diffHash: DH_A }
  return {
    state,
    port: {
      resolveHead: async (_cwd, callMeta) => core.ok(state.head, callMeta),
      diffHash: async (_cwd, _base, _head, callMeta) => core.ok(state.diffHash, callMeta),
      isClean: async (_cwd, callMeta) => core.ok(true, callMeta),
    },
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
const WORKTREE = { worktreeId: 'WT-1', cwd: 'H:\\ws\\wt', baseSha: 'c'.repeat(40) }

/** A review a reviewer holds and has started, with the checkout at HEAD_A. */
async function reviewingHarness() {
  const clock = fakeClock()
  const { store, migration } = await openQueueDatabase(clock)
  const git = fakeGit()
  const queue = execution.createReviewQueue({ store, graph: fakeGraph().port, clock: clock.port, migration, git: git.port })
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
  return { store, queue, clock, git, reviewId, revision: began.value.claim.revision }
}

/** The approval artifact count of one review. */
function approvalCount(store, reviewId) {
  return store.transaction(tx => tx.get('SELECT COUNT(*) AS n FROM artifacts WHERE review_id = ?', reviewId)).n
}

test('an approval of the artifact in front of the reviewer is given and is current', async () => {
  const h = await reviewingHarness()
  try {
    const approved = await h.queue.approveReview({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      actor: { kind: 'agent', grant: READ_ONLY_GRANT },
      worktree: WORKTREE,
      meta: meta('op-approve'),
    })
    assert.equal(approved.ok, true, approved.ok ? '' : approved.error.message)
    assert.equal(approved.value.created, true)
    assert.equal(approved.value.claim.state, 'approved')
    assert.equal(approved.value.claim.settledAt, h.clock.nowMs)
    assert.deepEqual(approved.value.artifact, { headSha: HEAD_A, diffHash: DH_A })
    assert.equal(approved.value.approval.artifactId.startsWith(`review-approval:${h.reviewId}:`), true)
    // The evidence schema caps an artifact id at 64 characters
    // (`packages/evidence/src/metadata.ts:40`): the reviewed SHAs are folded into
    // a fingerprint rather than spelled out, or the write is refused as
    // `invalid-input` and the approval never lands.
    assert.equal(approved.value.approval.artifactId.length <= 64, true, approved.value.approval.artifactId)
    assert.match(approved.value.approval.artifactId, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
    assert.equal(core.isReviewApprovalCurrent(approved.value.review, { headSha: HEAD_A, diffHash: DH_A }), true)

    const current = core.assertReviewApprovalCurrent(approved.value.review, { headSha: HEAD_A, diffHash: DH_A }, meta('op-check'))
    assert.equal(current.ok, true, current.ok ? '' : current.error.message)
  } finally {
    h.store.close()
  }
})

test('a commit after the approval makes it stale, and the integrator is refused', async () => {
  const h = await reviewingHarness()
  try {
    const approved = await h.queue.approveReview({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      actor: { kind: 'agent', grant: READ_ONLY_GRANT },
      worktree: WORKTREE,
      meta: meta('op-approve'),
    })
    assert.equal(approved.ok, true, approved.ok ? '' : approved.error.message)

    h.git.state.head = HEAD_B
    assert.equal(core.isReviewApprovalCurrent(approved.value.review, { headSha: HEAD_B, diffHash: DH_A }), false)

    const stale = await h.queue.approveReview({
      reviewId: h.reviewId,
      expectedRevision: approved.value.claim.revision,
      actor: { kind: 'agent', grant: READ_ONLY_GRANT },
      worktree: WORKTREE,
      meta: meta('op-stale'),
    })
    assert.equal(stale.ok, false, 'a moved head must not be integrated as approved')
    assert.equal(stale.error.code, 'STALE_APPROVAL')
    assert.deepEqual(stale.error.details.reviewed, { headSha: HEAD_A, diffHash: DH_A })
    assert.deepEqual(stale.error.details.current, { headSha: HEAD_B, diffHash: DH_A })
    assert.equal(approvalCount(h.store, h.reviewId), 1, 'the stale attempt writes no second approval')
  } finally {
    h.store.close()
  }
})

test('a rebuilt diff of the same commit cancels the approval too', async () => {
  const h = await reviewingHarness()
  try {
    const approved = await h.queue.approveReview({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      actor: { kind: 'agent', grant: READ_ONLY_GRANT },
      worktree: WORKTREE,
      meta: meta('op-approve'),
    })
    assert.equal(approved.ok, true, approved.ok ? '' : approved.error.message)

    // Same head, another diff hash: the reviewer looked at a different patch.
    h.git.state.diffHash = DH_B
    const stale = await h.queue.approveReview({
      reviewId: h.reviewId,
      expectedRevision: approved.value.claim.revision,
      actor: { kind: 'agent', grant: READ_ONLY_GRANT },
      worktree: WORKTREE,
      meta: meta('op-stale-diff'),
    })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, 'STALE_APPROVAL')
    assert.equal(stale.error.details.reviewed.diffHash, DH_A)
    assert.equal(stale.error.details.current.diffHash, DH_B)
    assert.equal(core.isReviewApprovalCurrent(approved.value.review, { headSha: HEAD_A, diffHash: DH_B }), false)
  } finally {
    h.store.close()
  }
})

test('approving the same artifact twice is idempotent and writes no second artifact', async () => {
  const h = await reviewingHarness()
  try {
    const first = await h.queue.approveReview({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      actor: { kind: 'agent', grant: READ_ONLY_GRANT },
      worktree: WORKTREE,
      meta: meta('op-approve-1'),
    })
    assert.equal(first.ok, true, first.ok ? '' : first.error.message)
    assert.equal(first.value.created, true)
    const after = approvalCount(h.store, h.reviewId)
    assert.equal(after, 1)

    const second = await h.queue.approveReview({
      reviewId: h.reviewId,
      expectedRevision: first.value.claim.revision,
      actor: { kind: 'agent', grant: READ_ONLY_GRANT },
      worktree: WORKTREE,
      meta: meta('op-approve-2'),
    })
    assert.equal(second.ok, true, second.ok ? '' : second.error.message)
    assert.equal(second.value.created, false, 'the same approval is not recorded twice')
    assert.equal(second.value.approval.artifactId, first.value.approval.artifactId)
    assert.equal(second.value.approval.hash, first.value.approval.hash)
    assert.equal(second.value.claim.revision, first.value.claim.revision, 'no state change on a repeat')
    assert.equal(approvalCount(h.store, h.reviewId), after, 'no second artifact')
    assert.deepEqual(h.queue.approvalOf(h.reviewId), first.value.approval)
  } finally {
    h.store.close()
  }
})

test('an automatic actor cannot approve through the public queue path', async () => {
  const h = await reviewingHarness()
  try {
    const before = h.queue.reviewOf(h.reviewId)
    const beforeApprovals = approvalCount(h.store, h.reviewId)

    const refused = await h.queue.approveReview({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      actor: { kind: 'automatic', verdict: 'allow', autoReviewActive: true },
      worktree: WORKTREE,
      meta: meta('op-auto-approve'),
    })
    assert.equal(refused.ok, false, 'an automatic actor must never reach the approval transition')
    assert.equal(refused.error.code, 'SECURITY_DENIED')
    assert.equal(refused.error.details.path, 'approve')
    assert.equal(refused.error.details.approveAllowedForAutomatic, false)

    const after = h.queue.reviewOf(h.reviewId)
    assert.deepEqual(after, before, 'a refused automatic approval must not mutate the review claim')
    assert.equal(after.state, 'reviewing')
    assert.equal(after.revision, h.revision)
    assert.equal(approvalCount(h.store, h.reviewId), beforeApprovals, 'no approval artifact may be written')

    const ruling = h.queue.ruleOnAutomaticVerdict({
      reviewId: h.reviewId,
      verdict: 'allow',
      autoReviewActive: true,
      meta: meta('op-auto-ruling'),
    })
    assert.equal(ruling.ok, true, ruling.ok ? '' : ruling.error.message)
    assert.equal(ruling.value.ruling.kind, 'human-decision-required')
    assert.equal(ruling.value.ruling.gate, 'security-change')
    assert.deepEqual(ruling.value.claim, before, 'an allowing automatic verdict is advisory and leaves the claim unchanged')
  } finally {
    h.store.close()
  }
})

test('STALE_APPROVAL was added additively to the error dictionary', async () => {
  const codes = [...contracts.MYWORK_ERROR_CODES]
  assert.equal(codes.length, CODES_BEFORE.length + 1, 'exactly one new code')
  assert.deepEqual(codes.slice(0, CODES_BEFORE.length), CODES_BEFORE, 'the order of the existing codes is untouched')
  assert.equal(codes.at(-1), 'STALE_APPROVAL')
  assert.equal(codes.includes('STALE_APPROVAL'), true)
  assert.equal(CODES_BEFORE.includes('STALE_APPROVAL'), false, 'the code did not exist before this card')

  // The dictionary is what the refusals use, so the code above is the code the
  // queue reports — not a name the test invented.
  const h = await reviewingHarness()
  try {
    const approved = await h.queue.approveReview({
      reviewId: h.reviewId,
      expectedRevision: h.revision,
      actor: { kind: 'agent', grant: READ_ONLY_GRANT },
      worktree: WORKTREE,
      meta: meta('op-approve'),
    })
    assert.equal(approved.ok, true, approved.ok ? '' : approved.error.message)
    h.git.state.head = HEAD_B
    const stale = await h.queue.approveReview({
      reviewId: h.reviewId,
      // Approving moved the claim, so the CAS is satisfied and the staleness of
      // the artifact is what refuses — not a stale revision.
      expectedRevision: approved.value.claim.revision,
      actor: { kind: 'agent', grant: READ_ONLY_GRANT },
      worktree: WORKTREE,
      meta: meta('op-stale'),
    })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, 'STALE_APPROVAL')
    assert.equal(contracts.MYWORK_ERROR_CODES.includes(stale.error.code), true)
  } finally {
    h.store.close()
  }
})
