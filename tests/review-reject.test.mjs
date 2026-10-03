/**
 * The reject-flow (architecture §18.3, §21, §22.3, §28, §30; MW-024, E-24).
 *
 * What has to hold: a rejection reopens the work — the task asks for changes
 * rather than silently continuing; the next attempt keeps the identity and the
 * checkout; it gets a **new** session that carries the findings and the
 * checkpoint but never the transcript; `needs-evidence` returns to `reviewing`
 * without creating an attempt; an escalation produces a human decision request
 * instead of finishing quietly; and the loop is bounded, so exceeding it needs a
 * human rather than another cycle.
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
const WORKTREE = Object.freeze({ worktreeId: 'WT-1', cwd: 'H:\\ws\\wt', baseSha: 'c'.repeat(40) })

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
  const transitions = []
  return {
    tasks,
    transitions,
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
        transitions.push(command.to)
        const task = tasks.get(command.id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${command.id}"`)
        if (command.expectedRevision !== undefined && command.expectedRevision !== task.revision) {
          throw new core.MyWorkError('STALE_REVISION', `task "${command.id}" moved`)
        }
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
    checkpoint: put(store, { ...common, artifactId: `${attemptId}-checkpoint`, kind: 'checkpoint', contentType: 'application/json', bytes: text('{"cursor":7}') }, now),
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
const REVIEWER = { kind: 'agent', grant: READ_ONLY_GRANT }

async function baseHarness() {
  const clock = fakeClock()
  const { store, migration } = await openQueueDatabase(clock)
  const graph = fakeGraph()
  const queue = execution.createReviewQueue({ store, graph: graph.port, clock: clock.port, migration, git: fakeGit() })
  insertAttempt(store, { id: 'A-1', state: 'running', settled: true }, clock.nowMs)
  return { store, graph, queue, clock }
}

/** Queue a review of one attempt and hand it to a reviewer, in `reviewing`. */
async function startReview(h, attemptId) {
  const refs = evidenceRefs(h.store, attemptId, h.clock.nowMs)
  const gate = recordGatePass(h.store, attemptId, HEAD_A, h.clock.nowMs)
  const requested = await h.queue.requestReview({
    attemptId,
    evidence: { reviewed: { headSha: HEAD_A, diffHash: DH_A }, gates: [gate], ...refs },
    meta: meta(`op-review-${attemptId}`),
  })
  assert.equal(requested.ok, true, requested.ok ? '' : requested.error.message)
  const reviewId = requested.value.claim.reviewId
  const claimed = h.queue.claimReview({ reviewId, expectedRevision: 1, actor: REVIEWER, meta: meta(`op-claim-${attemptId}`) })
  assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.error.message)
  const began = h.queue.beginReviewing({ reviewId, expectedRevision: claimed.value.claim.revision, meta: meta(`op-begin-${attemptId}`) })
  assert.equal(began.ok, true, began.ok ? '' : began.error.message)
  return { reviewId, revision: began.value.claim.revision }
}

/** What one rejection produced, for the loop test. */
async function rejectOnce(h, { attemptId, cycle, budget }) {
  const { reviewId, revision } = await startReview(h, attemptId)
  const outcome = await h.queue.rejectReview({
    reviewId,
    expectedRevision: revision,
    actor: REVIEWER,
    findings: { summary: `cycle ${cycle} needs changes` },
    worktree: WORKTREE,
    controllerEpoch: 3,
    leaseMs: 60_000,
    ...(budget === undefined ? {} : { budget }),
    meta: meta(`op-reject-${cycle}`),
  })
  assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.error.message)
  return outcome.value
}

test('a rejection asks the task for changes instead of continuing', async () => {
  const h = await baseHarness()
  try {
    const { reviewId, revision } = await startReview(h, 'A-1')
    const outcome = await h.queue.rejectReview({
      reviewId,
      expectedRevision: revision,
      actor: REVIEWER,
      findings: { summary: 'the coverage is missing' },
      worktree: WORKTREE,
      controllerEpoch: 3,
      leaseMs: 60_000,
      meta: meta('op-reject'),
    })
    assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.error.message)
    assert.equal(outcome.value.claim.state, 'rejected')
    assert.equal(outcome.value.review.state, 'rejected')
    assert.equal(outcome.value.taskState, 'changes-requested')
    assert.deepEqual(h.graph.transitions, ['changes-requested'], 'one transition, to the side state')
    assert.equal(h.graph.transitions.includes('ready'), false, 'a rejection never jumps back to ready')
    assert.equal(h.graph.tasks.get('T-1').state, 'changes-requested')
    assert.equal(outcome.value.rejected, 1)
    assert.equal(outcome.value.loopLimit, execution.DEFAULT_MAX_REVIEW_LOOPS)
  } finally {
    h.store.close()
  }
})

test('an automatic deny may request changes but an automatic allow may not', async () => {
  const deniedHarness = await baseHarness()
  try {
    const { reviewId, revision } = await startReview(deniedHarness, 'A-1')
    const denied = await deniedHarness.queue.rejectReview({
      reviewId,
      expectedRevision: revision,
      actor: { kind: 'automatic', verdict: 'deny', autoReviewActive: true },
      findings: { summary: 'automatic reviewer found a blocking problem' },
      worktree: WORKTREE,
      controllerEpoch: 3,
      leaseMs: 60_000,
      meta: meta('op-auto-deny'),
    })
    assert.equal(denied.ok, true, denied.ok ? '' : denied.error.message)
    assert.equal(denied.value.claim.state, 'rejected')
    assert.equal(denied.value.taskState, 'changes-requested')
  } finally {
    deniedHarness.store.close()
  }

  const allowHarness = await baseHarness()
  try {
    const { reviewId, revision } = await startReview(allowHarness, 'A-1')
    const before = allowHarness.queue.reviewOf(reviewId)
    const allowed = await allowHarness.queue.rejectReview({
      reviewId,
      expectedRevision: revision,
      actor: { kind: 'automatic', verdict: 'allow', autoReviewActive: true },
      findings: { summary: 'this must not be converted into a rejection' },
      worktree: WORKTREE,
      controllerEpoch: 3,
      leaseMs: 60_000,
      meta: meta('op-auto-allow'),
    })
    assert.equal(allowed.ok, false, 'an allow verdict requires a human decision rather than a synthetic reject')
    assert.equal(allowed.error.code, 'SECURITY_DENIED')
    assert.equal(allowed.error.details.ruling, 'human-decision-required')
    assert.equal(allowed.error.details.gate, 'security-change')
    assert.deepEqual(allowHarness.queue.reviewOf(reviewId), before, 'the refused allow verdict must not mutate the review')
    assert.deepEqual(allowHarness.graph.transitions, [], 'the task must not move when a human decision is required')
  } finally {
    allowHarness.store.close()
  }
})

test('the next attempt keeps the identity and the checkout, and grows the fence', async () => {
  const h = await baseHarness()
  try {
    const reviewed = h.queue.attemptsOf('T-1')[0]
    const outcome = await rejectOnce(h, { attemptId: 'A-1', cycle: 1 })
    const next = outcome.attempt
    assert.equal(next.agentId, reviewed.agentId, 'the identity survives the rejection')
    assert.equal(next.agentId, 'Neo-1')
    assert.equal(next.taskId, reviewed.taskId)
    assert.equal(next.workspaceId, reviewed.workspaceId)
    assert.equal(next.id !== reviewed.id, true, 'a rejection makes a new attempt')
    assert.equal(next.fence > reviewed.fence, true, `fence ${reviewed.fence} → ${next.fence}`)
    assert.deepEqual(h.queue.attemptsOf('T-1').map(attempt => attempt.fence), [1, 2])
    assert.deepEqual(outcome.worktree, WORKTREE, 'the checkout is reused, not re-made')

    // The reviewed attempt stayed settled; the new one holds the task's lease.
    assert.equal(h.queue.attemptsOf('T-1')[0].settledAt !== undefined, true)
    assert.equal(h.queue.liveAttemptOf('T-1').id, next.id)
  } finally {
    h.store.close()
  }
})

test('the next attempt gets a fresh session that carries findings, not a transcript', async () => {
  const h = await baseHarness()
  try {
    const outcome = await rejectOnce(h, { attemptId: 'A-1', cycle: 1 })
    assert.deepEqual(outcome.session, {
      trigger: 'reject',
      preservesAttempt: false,
      reusesSession: false,
      createsSession: true,
      carriesCheckpoint: true,
      carriesFindings: true,
      carriesTranscript: false,
    })
    assert.equal(outcome.session.carriesTranscript, false)
    assert.equal(contracts.DEFAULT_FRESH_SESSION_POLICY.perAttempt, true)
  } finally {
    h.store.close()
  }
})

test('the findings and the checkpoint are visible to the new attempt through the context port', async () => {
  const h = await baseHarness()
  try {
    const outcome = await rejectOnce(h, { attemptId: 'A-1', cycle: 1 })
    const provider = h.queue.handoff()
    const capabilities = await provider.capabilities()
    assert.deepEqual([...capabilities.classes], ['raw-evidence', 'execution-state'])

    const candidates = await provider.discover({ scopes: [{ kind: 'task', id: 'T-1' }] })
    assert.equal(candidates.length, 2, 'the findings and the checkpoint')
    const findings = candidates.find(candidate => candidate.uri.startsWith('review-findings:'))
    const checkpoint = candidates.find(candidate => candidate.uri.startsWith('checkpoint:'))
    assert.ok(findings !== undefined, 'the findings travel with the work')
    assert.equal(findings.kind, 'raw-evidence')
    assert.equal(findings.trust, 'trusted')
    assert.deepEqual(
      findings.scopes.map(scope => scope.kind),
      ['task', 'attempt', 'review'],
    )
    assert.equal(checkpoint.kind, 'execution-state')
    assert.equal(checkpoint.attributes.artifactId, 'A-1-checkpoint')
    assert.equal(checkpoint.attributes.hash, checkpoint.contentHash)

    // The body is fetchable, and it is the rejection that was recorded.
    const materialized = await provider.materialize({ uri: findings.uri, level: 'L2' })
    assert.match(materialized.content.text, /cycle 1 needs changes/)
    assert.equal(materialized.level, 'L2')
    assert.equal(materialized.contentHash, findings.contentHash)

    // A scope this provider knows nothing about answers with nothing.
    assert.deepEqual(await provider.discover({ scopes: [{ kind: 'team', id: 'X' }] }), [])
    // Only the classes asked for are disclosed.
    assert.equal((await provider.discover({ scopes: [{ kind: 'task', id: 'T-1' }], classes: ['execution-state'] })).length, 1)
  } finally {
    h.store.close()
  }
})

test('needs-evidence returns a review to reviewing and creates no attempt', async () => {
  const h = await baseHarness()
  try {
    const { reviewId, revision } = await startReview(h, 'A-1')
    const before = h.queue.attemptsOf('T-1').length
    const asked = h.queue.requestMoreEvidence({
      reviewId,
      expectedRevision: revision,
      findings: { summary: 'provide the coverage report' },
      meta: meta('op-ask'),
    })
    assert.equal(asked.ok, true, asked.ok ? '' : asked.error.message)
    assert.equal(asked.value.claim.state, 'needs-evidence')

    const resumed = h.queue.provideEvidence({ reviewId, expectedRevision: asked.value.claim.revision, meta: meta('op-resume') })
    assert.equal(resumed.ok, true, resumed.ok ? '' : resumed.error.message)
    assert.equal(resumed.value.claim.state, 'reviewing')
    assert.equal(core.isReviewTerminal('needs-evidence'), false, 'the state is not terminal')
    assert.equal(h.queue.attemptsOf('T-1').length, before, 'no attempt is created for evidence')
    assert.deepEqual(h.graph.transitions, [], 'the task is not moved')
  } finally {
    h.store.close()
  }
})

test('an escalation produces a human decision request and attention', async () => {
  const h = await baseHarness()
  try {
    const { reviewId, revision } = await startReview(h, 'A-1')
    const outcome = await h.queue.escalateReview({
      reviewId,
      expectedRevision: revision,
      gate: 'security-change',
      reason: 'human-gate-deadline-exceeded',
      detail: 'the reviewer and the author disagree about the security boundary',
      meta: meta('op-escalate'),
    })
    assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.error.message)
    assert.equal(outcome.value.claim.state, 'escalated')
    assert.equal(outcome.value.claim.settledAt, h.clock.nowMs)
    assert.equal(outcome.value.attention.taskId, 'T-1')
    assert.equal(outcome.value.attention.reason, 'human-gate-deadline-exceeded')
    assert.equal(outcome.value.attention.gate, 'security-change')
    assert.equal(contracts.HUMAN_GATES.includes(outcome.value.attention.gate), true)
    assert.equal(contracts.NEEDS_ATTENTION_REASONS.includes(outcome.value.attention.reason), true)

    // The task is in `needs-attention`, not silently finished, and the request
    // is durable in the row rather than only in a return value.
    assert.equal(h.graph.tasks.get('T-1').state, 'needs-attention')
    assert.equal(h.graph.transitions.includes('done'), false)
    const stored = h.store.transaction(tx => tx.get('SELECT escalation FROM review_claim WHERE review_id = ?', reviewId))
    assert.equal(JSON.parse(stored.escalation).reason, 'human-gate-deadline-exceeded')
    assert.equal(JSON.parse(stored.escalation).gate, 'security-change')
    assert.deepEqual(h.queue.attemptsOf('T-1').map(attempt => attempt.id), ['A-1'], 'an escalation creates no attempt')

    // A reason outside the closed catalogue is refused rather than recorded.
    await assert.rejects(
      () => h.queue.escalateReview({ reviewId, expectedRevision: 2, gate: 'release', reason: 'we-are-done', detail: 'x', meta: meta('op-bad') }),
      TypeError,
    )
  } finally {
    h.store.close()
  }
})

test('the review loop is bounded and the excess needs a human', async () => {
  const run = async (maxAttempts, cycles) => {
    const h = await baseHarness()
    const outcomes = []
    // The queue mints the id of the attempt a rejection creates, so the cycle
    // continues with the id it returned rather than with a guessed name.
    let attemptId = 'A-1'
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      const next = await rejectOnce(h, { attemptId, cycle, budget: maxAttempts === undefined ? undefined : { maxAttempts } })
      outcomes.push(next)
      if (next.attempt !== undefined) {
        // The card path puts the task back into review and settles the attempt
        // the rejection created; the queue never does either on its own. The
        // reset belongs to a cycle that continues: the last iteration leaves the
        // state the queue itself set (attention), which is what is asserted.
        h.graph.tasks.set('T-1', Object.freeze({ ...h.graph.tasks.get('T-1'), state: 'awaiting-review' }))
        h.store.transaction(tx => execution.settleAttempt(tx, next.attempt.id, 'created', 'completed', h.clock.advance(5)))
        attemptId = next.attempt.id
      }
    }
    return {
      h,
      outcomes,
      attempts: h.queue.attemptsOf('T-1').map(attempt => attempt.fence),
      taskState: h.graph.tasks.get('T-1').state,
      dbAttempts: h.queue.attemptsOf('T-1').length,
    }
  }

  const byDefault = await run(undefined, 3)
  try {
    assert.deepEqual(byDefault.outcomes.map(outcome => outcome.taskState), ['changes-requested', 'changes-requested', 'needs-attention'])
    const last = byDefault.outcomes.at(-1)
    assert.equal(last.attempt, undefined, 'the attempt over the limit is not created')
    assert.equal(last.attention.reason, 'retry-budget-exhausted')
    assert.equal(last.loopLimit, 3)
    assert.equal(last.rejected, 3)
    assert.deepEqual(last.handoff.length >= 1, true)
    assert.equal(byDefault.dbAttempts, 3, 'three attempts, and a fourth is not made')
    assert.deepEqual(byDefault.attempts, [1, 2, 3], 'every fence is greater than the one before it')
    assert.equal(byDefault.taskState, 'needs-attention')
    assert.equal(contracts.NEEDS_ATTENTION_REASONS.includes('retry-budget-exhausted'), true)

    const stored = byDefault.h.store.transaction(tx =>
      tx.all("SELECT state FROM review_claim WHERE task_id = 'T-1' ORDER BY requested_at"),
    )
    assert.deepEqual(stored.map(row => row.state), ['rejected', 'rejected', 'rejected'])
  } finally {
    byDefault.h.store.close()
  }

  // The §30 budget of the task is what bounds the loop, not the queue's default.
  const byBudget = await run(2, 2)
  try {
    assert.equal(byBudget.outcomes[0].taskState, 'changes-requested')
    assert.equal(byBudget.outcomes[1].taskState, 'needs-attention')
    assert.equal(byBudget.outcomes[1].loopLimit, 2)
    assert.equal(byBudget.dbAttempts, 2, 'the budget of two attempts is honoured')
  } finally {
    byBudget.h.store.close()
  }
})
