/**
 * Review queue acceptance (architecture §14, §18.3, §19; MW-024, E-19).
 *
 * What has to hold: a review is queued from `awaiting-review` as its own claim
 * at revision 1; requesting the same review twice is the same review; a claim
 * moves `queued` → `claimed` only against the revision the caller read; review
 * work lands in the reviewer pool as *numbers* the scheduler counts; and a
 * worker attempt and a review of its task are never live at the same time.
 *
 * The schema version is read from the allocator, never written here (§1.6,
 * D08): a literal version in a test is exactly the defect R-04 describes.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root, derived here so this suite does not depend on every package being built. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** One built package of the workspace. */
const load = async name => import(pathToFileURL(join(repoRoot, 'packages', name, 'lib', 'index.js')).href)

const contracts = await load('contracts')
const core = await load('core')
const storage = await load('storage')
const evidence = await load('evidence')
const execution = await load('execution')

/**
 * The allocator is the composition layer's module, so it is imported from its
 * source, exactly as `tests/storage/migration-allocator.test.mjs` does.
 */
const allocatorModule = await import(
  pathToFileURL(join(repoRoot, 'packages', 'controller', 'src', 'migration-allocator.ts')).href
)

/** Heads and hashes the fixtures use. */
const HEAD_A = 'a'.repeat(40)
const DH_A = 'd'.repeat(64)

/** Temporary directories this suite created, removed at the end. */
const tempDirs = []

/** A fresh temporary directory. */
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

/** A deterministic clock: the only time source these tests allow. */
function fakeClock(start = 1_000) {
  let now = start
  return {
    get nowMs() {
      return now
    },
    advance(ms) {
      now += ms
      return now
    },
    port: {
      now: () => now,
      sleep: async () => {},
    },
  }
}

/** Operation identity for one call. */
const meta = (operationId = 'op-1') => core.defineOperationMeta({ operationId, correlationId: 'corr-1' })

/** A deterministic `TaskGraphPort` that records every transition it was asked for. */
function fakeGraph(initialState = 'awaiting-review') {
  const tasks = new Map([
    [
      'T-1',
      Object.freeze({ id: 'T-1', workspaceId: 'W-1', title: 'Task 1', description: '', state: initialState, revision: 1, dependsOn: [] }),
    ],
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
        throw new Error('the review queue never mutates a plan')
      },
      claim: async () => {
        throw new Error('the review queue never claims a task')
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

/** A `GitPort` whose head and diff hash the test drives. */
function fakeGit({ head = HEAD_A, diffHash = DH_A } = {}) {
  const state = { head, diffHash }
  const result = value => async (...args) => Object.freeze({ ok: true, value, meta: args.at(-2) ?? meta() })
  return {
    state,
    port: {
      resolveHead: async (_cwd, callMeta) => core.ok(state.head, callMeta),
      diffHash: async (_cwd, _base, _head, callMeta) => core.ok(state.diffHash, callMeta),
      isClean: result(true),
      commit: async (_request, callMeta) => core.ok(state.head, callMeta),
      land: async (_request, callMeta) => core.ok({ headSha: state.head, conflicted: false, conflictedPaths: [] }, callMeta),
      abortLanding: async (_cwd, callMeta) => core.ok(state.head, callMeta),
    },
  }
}

/**
 * Open a controller database carrying every schema the review queue writes
 * through, with the review migration at the version the **allocator** handed out.
 */
async function openQueueDatabase(clock) {
  const path = join(tempDir(), 'controller.sqlite')
  const baseMigrations = [
    ...storage.MYWORK_MIGRATIONS,
    ...evidence.EVIDENCE_MIGRATIONS,
    ...execution.CLAIM_SAGA_MIGRATIONS,
  ]
  const book = await storage.openStore({ path, migrations: baseMigrations, clock: { now: () => clock.nowMs } })
  const allocator = allocatorModule.createMigrationAllocator(book, { now: () => clock.nowMs })
  const version = allocator.allocate({ key: execution.REVIEW_CLAIM_ALLOCATION_KEY })
  book.close()
  const migration = execution.createReviewClaimMigration({ version })
  const store = await storage.openStore({
    path,
    migrations: [...baseMigrations, migration],
    clock: { now: () => clock.nowMs },
  })
  return { store, migration, version }
}

/** Store one artifact and answer with its reference. */
function put(store, request, now) {
  return store.transaction(tx => evidence.putArtifact(tx, request, now).ref)
}

/** The artifact references one review's evidence package is built from. */
function evidenceRefs(store, attemptId, now) {
  const common = { workspaceId: 'W-1', correlationId: 'corr-1', taskId: 'T-1', attemptId }
  const text = value => new TextEncoder().encode(value)
  return {
    diff: put(store, { ...common, artifactId: 'diff-1', kind: 'diff', contentType: 'text/x-diff', bytes: text('--- a\n+++ b\n') }, now),
    workerReport: put(store, { ...common, artifactId: 'worker-report-1', kind: 'worker-report', contentType: 'application/json', bytes: text('{"summary":"done"}') }, now),
    contextSnapshot: put(store, { ...common, artifactId: 'context-snapshot-1', kind: 'context-snapshot', contentType: 'application/json', bytes: text('{"revision":1}') }, now),
    checkpoint: put(store, { ...common, artifactId: 'checkpoint-1', kind: 'checkpoint', contentType: 'application/json', bytes: text('{"cursor":7}') }, now),
  }
}

/** Record one passing `gate-result` for an attempt, as E-17's runner does (§19). */
function recordGatePass(store, attemptId, headSha, now) {
  const common = { workspaceId: 'W-1', correlationId: 'corr-1', taskId: 'T-1', attemptId }
  const text = value => new TextEncoder().encode(value)
  return store.transaction(tx => {
    const log = evidence.putArtifact(
      tx,
      { ...common, artifactId: `gate-log-${attemptId}`, kind: 'build-log', contentType: 'text/plain', bytes: text('gate output') },
      now,
    ).ref
    const result = {
      id: 'unit',
      headSha,
      exitCode: 0,
      verdict: 'pass',
      artifactRef: { artifactId: log.artifactId, hash: log.hash },
    }
    return evidence.putArtifact(
      tx,
      {
        ...common,
        artifactId: `gate-result-${attemptId}`,
        kind: 'gate-result',
        contentType: 'application/json',
        bytes: text(JSON.stringify(result)),
      },
      now,
    ).ref
  })
}

/** Insert one attempt through the package's own store helpers, and settle it when asked. */
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

/** A queue wired to a fresh database, with one settled attempt and a passing gate. */
async function harness(options = {}) {
  const clock = fakeClock()
  const { store, migration, version } = await openQueueDatabase(clock)
  const graph = fakeGraph(options.taskState ?? 'awaiting-review')
  const git = fakeGit()
  const queue = execution.createReviewQueue({
    store,
    graph: graph.port,
    clock: clock.port,
    migration,
    git: git.port,
  })
  const attemptId = options.attemptId ?? 'A-1'
  insertAttempt(store, { id: attemptId, state: 'running', settled: true, agentId: options.agentId ?? 'Neo-1' }, clock.nowMs)
  const refs = evidenceRefs(store, attemptId, clock.nowMs)
  const gate = recordGatePass(store, attemptId, HEAD_A, clock.nowMs)
  return { clock, store, migration, version, graph, git, queue, attemptId, refs, gate }
}

/** The evidence input for the settled attempt of a harness. */
function evidenceInput(harness, overrides = {}) {
  return {
    reviewed: { headSha: HEAD_A, diffHash: DH_A },
    diff: harness.refs.diff,
    gates: [harness.gate],
    workerReport: harness.refs.workerReport,
    contextSnapshot: harness.refs.contextSnapshot,
    checkpoint: harness.refs.checkpoint,
    ...overrides,
  }
}

/** A reviewer grant that passes every independence and read-only check. */
const REVIEWER = { kind: 'agent', grant: { agentId: 'Neo-2', instanceId: 'I-2', permissions: ['workspace.read', 'git.read', 'review.approve'] } }

test('a review is queued from awaiting-review at revision 1 on the allocated version', async () => {
  const h = await harness()
  try {
    const requested = await h.queue.requestReview({ attemptId: h.attemptId, evidence: evidenceInput(h), meta: meta() })
    assert.equal(requested.ok, true, requested.ok ? '' : requested.error.message)
    assert.equal(requested.value.created, true)
    assert.equal(requested.value.claim.state, 'queued')
    assert.equal(requested.value.claim.revision, 1)
    assert.equal(requested.value.claim.workerAgentId, 'Neo-1')
    assert.equal(requested.value.gates.length, 1, 'the admitted gate set is reported')
    assert.equal(requested.value.gates[0].id, 'unit')

    const row = h.store.transaction(tx => tx.get('SELECT state, revision, head_sha FROM review_claim WHERE review_id = ?', requested.value.claim.reviewId))
    assert.equal(row.state, 'queued')
    assert.equal(row.revision, 1)
    assert.equal(row.head_sha, HEAD_A)

    // The migration is on disk under the number the allocator handed out — never a literal.
    const applied = h.store.transaction(tx => tx.get('SELECT name FROM schema_migrations WHERE version = ?', h.version))
    assert.equal(applied.name, execution.REVIEW_CLAIM_SCHEMA_NAME)
    assert.ok(h.version >= 7, `the allocator handed out ${h.version}`)
  } finally {
    h.store.close()
  }
})

test('requesting the same review twice is the same review, and other evidence is refused', async () => {
  const h = await harness()
  try {
    const first = await h.queue.requestReview({ attemptId: h.attemptId, evidence: evidenceInput(h), meta: meta('op-1') })
    assert.equal(first.ok, true, first.ok ? '' : first.error.message)
    assert.equal(first.value.created, true)

    const second = await h.queue.requestReview({ attemptId: h.attemptId, evidence: evidenceInput(h), meta: meta('op-2') })
    assert.equal(second.ok, true, second.ok ? '' : second.error.message)
    assert.equal(second.value.created, false, 'the request is idempotent')
    assert.equal(second.value.claim.reviewId, first.value.claim.reviewId)
    assert.equal(
      h.store.transaction(tx => tx.get('SELECT COUNT(*) AS n FROM review_claim').n),
      1,
      'one attempt and head produce one review',
    )

    // Positive control: different evidence for the same (attempt, head) is not a
    // silent second review. The package is immutable (§32), so it is refused.
    const otherDiff = put(h.store, { workspaceId: 'W-1', correlationId: 'corr-1', taskId: 'T-1', attemptId: h.attemptId, artifactId: 'diff-2', kind: 'diff', contentType: 'text/x-diff', bytes: new TextEncoder().encode('other') }, h.clock.nowMs)
    const conflicting = await h.queue.requestReview({ attemptId: h.attemptId, evidence: evidenceInput(h, { diff: otherDiff }), meta: meta('op-3') })
    assert.equal(conflicting.ok, false)
    assert.equal(conflicting.error.code, 'TASK_CONFLICT')
    assert.match(conflicting.error.message, /another evidence package/)

    // A review is requested from `awaiting-review` and nowhere else.
    const notAwaiting = await harness({ taskState: 'executing' })
    try {
      const refused = await notAwaiting.queue.requestReview({ attemptId: notAwaiting.attemptId, evidence: evidenceInput(notAwaiting), meta: meta() })
      assert.equal(refused.ok, false)
      assert.equal(refused.error.code, 'TASK_CONFLICT')
      assert.match(refused.error.message, /awaiting-review/)
      assert.deepEqual(notAwaiting.graph.transitions, [], 'the queue does not move a task into awaiting-review')
    } finally {
      notAwaiting.store.close()
    }
  } finally {
    h.store.close()
  }
})

test('a claim moves queued to claimed against the revision the caller read', async () => {
  const h = await harness()
  try {
    const requested = await h.queue.requestReview({ attemptId: h.attemptId, evidence: evidenceInput(h), meta: meta() })
    const reviewId = requested.value.claim.reviewId

    const claimed = h.queue.claimReview({ reviewId, expectedRevision: 1, actor: REVIEWER, meta: meta('op-claim') })
    assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.error.message)
    assert.equal(claimed.value.claim.state, 'claimed')
    assert.equal(claimed.value.claim.revision, 2)
    assert.equal(claimed.value.claim.reviewerId, 'Neo-2')
    assert.equal(claimed.value.review.state, 'claimed')

    // The state machine is the authority for what may follow: a second claim of
    // an already claimed review is a conflict, not a second claim.
    const again = h.queue.claimReview({ reviewId, expectedRevision: 2, actor: REVIEWER, meta: meta('op-claim-again') })
    assert.equal(again.ok, false)
    assert.equal(again.error.code, 'TASK_CONFLICT')
    assert.equal(h.store.transaction(tx => tx.get('SELECT revision FROM review_claim WHERE review_id = ?', reviewId)).revision, 2)

    const missing = h.queue.claimReview({ reviewId: 'R-none', expectedRevision: 1, actor: REVIEWER, meta: meta('op-claim-missing') })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'TASK_CONFLICT')
  } finally {
    h.store.close()
  }
})

test('a stale revision is STALE_REVISION and changes no state', async () => {
  const h = await harness()
  try {
    const requested = await h.queue.requestReview({ attemptId: h.attemptId, evidence: evidenceInput(h), meta: meta() })
    const reviewId = requested.value.claim.reviewId
    const claimed = h.queue.claimReview({ reviewId, expectedRevision: 1, actor: REVIEWER, meta: meta('op-claim') })
    assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.error.message)

    const stale = h.queue.claimReview({ reviewId, expectedRevision: 1, actor: REVIEWER, meta: meta('op-claim-stale') })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, 'STALE_REVISION')
    assert.equal(stale.error.details.expectedRevision, 1)
    assert.equal(stale.error.details.currentRevision, 2)
    assert.equal(stale.error.details.currentState, 'claimed')

    const row = h.store.transaction(tx => tx.get('SELECT state, revision, reviewer_id FROM review_claim WHERE review_id = ?', reviewId))
    assert.equal(row.state, 'claimed')
    assert.equal(row.revision, 2)
    assert.equal(row.reviewer_id, 'Neo-2', 'a refused claim writes no reviewer')
  } finally {
    h.store.close()
  }
})

test('review work is reviewer-pool occupancy, counted as numbers', async () => {
  const h = await harness()
  try {
    const requested = await h.queue.requestReview({ attemptId: h.attemptId, evidence: evidenceInput(h), meta: meta() })
    h.queue.claimReview({ reviewId: requested.value.claim.reviewId, expectedRevision: 1, actor: REVIEWER, meta: meta() })

    const live = h.queue.liveReviews('W-1')
    assert.equal(live.length, 1)
    assert.equal(live[0].state, 'claimed')

    // The pool name is the scheduler's own, so the numbers land in the same
    // bucket a tick fills — asserted against the policy, not against a string here.
    const policy = core.resolveSchedulerPolicy()
    assert.equal(execution.REVIEW_POOL, policy.reviewerPool)

    // A claimed review occupies a slot until it settles; `waiting-external` is
    // the resource state §15 charges a pool slot and an active attempt for.
    const observations = live.map(claim => ({
      instanceId: `I-${claim.reviewId}`,
      agentId: claim.reviewerId,
      pool: execution.REVIEW_POOL,
      roleId: 'reviewer',
      workspaceId: claim.workspaceId,
      resource: 'waiting-external',
    }))
    const occupancy = core.countSchedulerOccupancy(observations, policy)
    assert.equal(occupancy.pools[policy.reviewerPool], 1)
    assert.equal(occupancy.workspaces['W-1'].reviewers, 1)
    assert.equal(occupancy.workspaces['W-1'].workers, 0)
    assert.equal(occupancy.activeAttempts, 1)

    // Non-vacuity: with no live review there is no occupancy.
    const settled = core.countSchedulerOccupancy([], policy)
    assert.equal(settled.pools[policy.reviewerPool] ?? 0, 0)
  } finally {
    h.store.close()
  }
})

test('a live worker attempt and a live review of one task are never both live', async () => {
  const h = await harness()
  try {
    const requested = await h.queue.requestReview({ attemptId: h.attemptId, evidence: evidenceInput(h), meta: meta() })
    const reviewId = requested.value.claim.reviewId

    // A review that is only waiting for a reviewer is not a review *attempt*:
    // it holds no slot and the work may move on. What it can never do is start.
    const reviewAttempts = () => h.queue.liveReviews('W-1').filter(claim => claim.state !== 'queued').length
    const liveWorkerAttempts = () => h.queue.attemptsOf('T-1').filter(attempt => attempt.settledAt === undefined).length

    // A second, live attempt appears on the task: the review may not be claimed.
    insertAttempt(h.store, { id: 'A-2', state: 'running', settled: false }, h.clock.nowMs)
    const blocked = h.queue.claimReview({ reviewId, expectedRevision: 1, actor: REVIEWER, meta: meta('op-blocked') })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.error.code, 'TASK_CONFLICT')
    assert.match(blocked.error.message, /never live at once/)
    assert.equal(h.queue.liveAttemptOf('T-1').id, 'A-2')
    assert.equal(h.queue.reviewOf(reviewId).state, 'queued', 'the refused claim changed no state')
    assert.equal(liveWorkerAttempts() + reviewAttempts(), 1, 'the live worker attempt is the only live unit of work')

    // The worker attempt settles; now the review may be claimed, and the task
    // still holds exactly one live unit of work on either side.
    h.store.transaction(tx => {
      execution.settleAttempt(tx, 'A-2', 'running', 'completed', h.clock.advance(10))
    })
    const claimed = h.queue.claimReview({ reviewId, expectedRevision: 1, actor: REVIEWER, meta: meta('op-claimed') })
    assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.error.message)
    assert.equal(h.queue.reviewOf(reviewId).state, 'claimed')
    assert.equal(h.queue.liveReviews('W-1').length, 1)
    assert.equal(h.queue.liveAttemptOf('T-1'), undefined)
    assert.equal(liveWorkerAttempts() + reviewAttempts(), 1)
  } finally {
    h.store.close()
  }
})
