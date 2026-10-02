/**
 * Reviewer read-only scope (architecture §13.2, §28, §31; MW-024, E-21).
 *
 * "The reviewer does not edit the implementation" is enforced by permission, not
 * by asking nicely in a prompt: the scope the queue hands the session starter is
 * pinned at harness policy `read-only`, a grant that can write is refused by the
 * domain invariant, and the platform gate refuses the write itself when the
 * scope is used. The last check is the one that matters — it runs the real
 * `authorizeOperation`, not a restatement of it.
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

async function harness() {
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
  return { store, queue, clock, reviewId: requested.value.claim.reviewId }
}

const READ_ONLY_GRANT = { agentId: 'Neo-2', instanceId: 'I-2', permissions: ['workspace.read', 'git.read', 'review.approve'] }

test('the review scope is pinned at read-only and carries no transcript', async () => {
  const h = await harness()
  try {
    const claimed = h.queue.claimReview({ reviewId: h.reviewId, expectedRevision: 1, actor: { kind: 'agent', grant: READ_ONLY_GRANT }, meta: meta('op-claim') })
    assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.error.message)

    const scope = h.queue.scopeOf(h.reviewId)
    assert.equal(scope.permission, execution.REVIEW_HARNESS_POLICY)
    assert.equal(scope.permission, 'read-only')
    assert.equal(scope.agentPreset, execution.REVIEW_AGENT_PRESET)
    assert.equal(scope.pool, execution.REVIEW_POOL)
    assert.equal(scope.purpose, 'review')
    assert.equal(scope.fresh, true, '§22.2: a session per review')
    assert.equal(scope.carriesTranscript, false)
    assert.equal(scope.reviewerId, 'Neo-2')
    assert.equal(scope.workerAgentId, 'Neo-1')
    assert.equal(scope.evidence.reviewId, h.reviewId)

    // The scope exists only once a reviewer holds the review: before that there
    // is nothing to compose a session for.
    const other = await harness()
    try {
      assert.equal(other.queue.scopeOf(other.reviewId), undefined)
    } finally {
      other.store.close()
    }
  } finally {
    h.store.close()
  }
})

test('a reviewer granted a write permission is refused before the claim', async () => {
  const h = await harness()
  try {
    for (const permission of ['workspace.write', 'git.write', 'shell']) {
      const refused = h.queue.claimReview({
        reviewId: h.reviewId,
        expectedRevision: 1,
        actor: { kind: 'agent', grant: { ...READ_ONLY_GRANT, permissions: ['workspace.read', permission] } },
        meta: meta(`op-${permission}`),
      })
      assert.equal(refused.ok, false, `${permission} must not be held by a reviewer`)
      assert.equal(refused.error.code, 'SECURITY_DENIED')
      assert.equal(refused.error.details.permissions.includes(permission), true)
    }
    const stored = h.store.transaction(tx => tx.get('SELECT state, revision FROM review_claim WHERE review_id = ?', h.reviewId))
    assert.equal(stored.state, 'queued')
    assert.equal(stored.revision, 1)
  } finally {
    h.store.close()
  }
})

test('the reviewer permission set holds no implementation write and is bound to the reviewed worker', async () => {
  const h = await harness()
  try {
    const claimed = h.queue.claimReview({ reviewId: h.reviewId, expectedRevision: 1, actor: { kind: 'agent', grant: READ_ONLY_GRANT }, meta: meta('op-claim') })
    assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.error.message)
    const scope = h.queue.scopeOf(h.reviewId)

    for (const permission of contracts.IMPLEMENTATION_WRITE_PERMISSIONS) {
      assert.equal(scope.permissions.includes(permission), false, `the reviewer must not hold ${permission}`)
    }
    assert.ok(scope.permissions.includes('review.approve'), 'a reviewer may approve — the work it reviewed')

    // §13.2 in the platform's own gate: the approver permission is bound to the
    // worker identity, and a grant for its own work is refused as self-approval.
    const own = core.authorizeOperation(
      {
        agentId: 'Neo-1',
        permissions: [...contracts.REVIEWER_DEFAULT_PERMISSIONS],
        workspaceId: 'W-1',
        workspaceRoot: 'H:\\ws',
        harnessPolicy: 'read-only',
        reviewer: true,
        workerAgentId: 'Neo-1',
      },
      { domain: 'review', action: 'approve', workspaceId: 'W-1' },
      meta('op-self-approve'),
    )
    assert.equal(own.ok, false)
    assert.equal(own.error.code, 'SECURITY_DENIED')
    assert.equal(own.error.details.reason, 'self-approval')

    const foreign = core.authorizeOperation(
      {
        agentId: scope.reviewerId,
        permissions: [...scope.permissions],
        workspaceId: scope.workspaceId,
        workspaceRoot: 'H:\\ws',
        harnessPolicy: scope.permission,
        reviewer: true,
        workerAgentId: scope.workerAgentId,
      },
      { domain: 'review', action: 'approve', workspaceId: scope.workspaceId },
      meta('op-foreign-approve'),
    )
    assert.equal(foreign.ok, true, foreign.ok ? '' : foreign.error.message)
  } finally {
    h.store.close()
  }
})

test('a file write from a review session is refused by the platform gate', async () => {
  const h = await harness()
  try {
    h.queue.claimReview({ reviewId: h.reviewId, expectedRevision: 1, actor: { kind: 'agent', grant: READ_ONLY_GRANT }, meta: meta('op-claim') })
    const scope = h.queue.scopeOf(h.reviewId)
    const context = {
      agentId: scope.reviewerId,
      permissions: [...scope.permissions],
      workspaceId: scope.workspaceId,
      workspaceRoot: 'H:\\ws',
      worktreeRoot: 'H:\\ws\\wt',
      harnessPolicy: scope.permission,
      reviewer: true,
      workerAgentId: scope.workerAgentId,
    }
    const writeRequest = { domain: 'filesystem', action: 'write', workspaceId: 'W-1', path: 'H:\\ws\\wt\\src\\a.ts' }
    const denied = core.authorizeOperation(context, writeRequest, meta('op-write'))
    assert.equal(denied.ok, false, 'a review session must not write the implementation')
    assert.equal(denied.error.code, 'SECURITY_DENIED')
    assert.equal(denied.error.details.reason, 'permission-missing')
    assert.equal(denied.error.details.permission, 'workspace.write')

    // Positive control: reading the same path under the same grant is allowed,
    // so the refusal is about the write and not about the path.
    const read = core.authorizeOperation(
      context,
      { domain: 'filesystem', action: 'read', workspaceId: 'W-1', path: 'H:\\ws\\wt\\src\\a.ts' },
      meta('op-read'),
    )
    assert.equal(read.ok, true, read.ok ? '' : read.error.message)

    // The platform policy is the second half of the enforcement: even a grant
    // that holds the write permission is refused while the policy is read-only.
    const wider = core.authorizeOperation(
      { agentId: 'Neo-2', permissions: ['workspace.read', 'workspace.write'], workspaceId: 'W-1', workspaceRoot: 'H:\\ws', harnessPolicy: 'read-only' },
      writeRequest,
      meta('op-write-wide'),
    )
    assert.equal(wider.ok, false)
    assert.equal(wider.error.code, 'SECURITY_DENIED')
    assert.equal(wider.error.details.reason, 'harness-policy')
  } finally {
    h.store.close()
  }
})
