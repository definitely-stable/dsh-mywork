/**
 * Integrator admission acceptance (architecture §19, §48; MW-025, E-25).
 *
 * The rule this suite holds: **stale approval is refused at the entrance, not
 * noticed afterwards.** An attempt is integrated only when a review approved the
 * artifact the repository shows right now — the same head SHA and the same diff
 * hash — and when the target branch is still where the decision was taken. Every
 * refusal happens before anything is written, so a refusal leaves no commit, no
 * ledger row, and no graph move behind.
 *
 * The `GitPort` here is a **fake over a real repository**: the production adapter
 * is `packages/worktree-adapter` (`E-26`, another card) and does not exist yet, so
 * this suite runs the same git commands itself and asserts on the repository's own
 * output. Repositories live in `$TEMP` and are removed in `after`; the live
 * profile, the board, and the workspace are never touched.
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { adapterTesting, contracts, core, evidence, execution, lease, repoRoot, storage } from './lib/fixtures.mjs'

/** The migration-version allocator of the composition layer (`D08`, `F-63`). */
const controller = await import(pathToFileURL(join(repoRoot, 'packages/controller/lib/index.js')).href)
const run = promisify(execFile)

/** The migrations the integration ledger is composed after, as the packages own them. */
const BASE_MIGRATIONS = [
  ...storage.MYWORK_MIGRATIONS,
  ...evidence.EVIDENCE_MIGRATIONS,
  ...lease.LEASE_MIGRATIONS,
  ...execution.CLAIM_SAGA_MIGRATIONS,
]

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-integrator-'

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

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

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  tempDirs.push(dir)
  return dir
}

/** Run git and return its trimmed stdout. */
async function git(cwd, args) {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 })
  return stdout.trim()
}

/** Run git, tolerating a non-zero exit (a conflict, an absent remote). */
async function gitTry(cwd, args) {
  try {
    return { status: 0, stdout: await git(cwd, args) }
  } catch (error) {
    return {
      status: typeof error.code === 'number' ? error.code : 1,
      stdout: `${error.stdout ?? ''}`.trim(),
      stderr: `${error.stderr ?? ''}`.trim(),
    }
  }
}

/** The diff hash of a patch, computed exactly as the port computes it. */
async function patchHash(cwd, baseSha, headSha) {
  const patch = await git(cwd, ['diff', baseSha, headSha])
  return createHash('sha256').update(patch).digest('hex')
}

/**
 * A `GitPort` over a real repository.
 *
 * The port is the whole of the integrator's contact with a repository, so this
 * fake is where the repository's own truth enters the suite: every method runs the
 * git command the production adapter would run, and the tests assert on `git log`,
 * `git status`, and `git rev-list` output rather than on the fake's bookkeeping.
 */
function gitPort(options = {}) {
  const calls = []
  return {
    calls,
    async resolveHead(cwd, meta) {
      calls.push(`resolveHead:${cwd}`)
      return core.ok(await git(cwd, ['rev-parse', 'HEAD']), meta)
    },
    async diffHash(cwd, baseSha, headSha, meta) {
      calls.push(`diffHash:${baseSha.slice(0, 7)}..${headSha.slice(0, 7)}`)
      return core.ok(await patchHash(cwd, baseSha, headSha), meta)
    },
    async isClean(cwd, meta) {
      calls.push('isClean')
      return core.ok((await git(cwd, ['status', '--porcelain'])) === '', meta)
    },
    async commit(request, meta) {
      calls.push(`commit:${request.cwd}`)
      if (options.inertCommit === true) return core.ok(await git(request.cwd, ['rev-parse', 'HEAD']), meta)
      await git(request.cwd, ['add', '-A'])
      await git(request.cwd, ['commit', '--allow-empty', '-m', request.message])
      return core.ok(await git(request.cwd, ['rev-parse', 'HEAD']), meta)
    },
    async land(request, meta) {
      calls.push(`land:${request.strategy}:${request.revision.slice(0, 7)}`)
      if (options.inertLand === true) {
        return core.ok(Object.freeze({ headSha: await git(request.cwd, ['rev-parse', 'HEAD']), conflicted: false, conflictedPaths: Object.freeze([]) }), meta)
      }
      const result = options.commitLanding === true
        ? await gitTry(request.cwd, ['merge', '--no-ff', '-m', `Merge ${request.revision.slice(0, 7)}`, request.revision])
        : await gitTry(request.cwd, ['merge', '--no-ff', '--no-commit', request.revision])
      const conflicted = result.status !== 0
      const paths = conflicted
        ? (await gitTry(request.cwd, ['diff', '--name-only', '--diff-filter=U'])).stdout.split(/\r?\n/).filter(Boolean)
        : []
      return core.ok(
        Object.freeze({
          headSha: await git(request.cwd, ['rev-parse', 'HEAD']),
          conflicted,
          conflictedPaths: Object.freeze(paths),
        }),
        meta,
      )
    },
    async abortLanding(cwd, meta) {
      calls.push('abortLanding')
      await gitTry(cwd, ['merge', '--abort'])
      return core.ok(await git(cwd, ['rev-parse', 'HEAD']), meta)
    },
  }
}

/**
 * A deterministic `TaskGraphPort` over one task.
 *
 * It enforces `expectedRevision` the way a guarded backend does, so a stale
 * observation is refused by the graph rather than by the caller's bookkeeping.
 */
function graphPort() {
  const tasks = new Map()
  const calls = []
  return {
    tasks,
    calls,
    addTask(id, state, extra = {}) {
      tasks.set(id, { id, workspaceId: 'W-1', title: id, description: '', state, revision: 3, dependsOn: [], ...extra })
      return this
    },
    port: {
      capabilities: async () => ({ adapterId: 'fake', contractVersion: 'taskgraph/v1', capabilities: {}, source: 'declared' }),
      get: async id => {
        calls.push(`get:${id}`)
        const task = tasks.get(id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${id}"`)
        return Object.freeze({ ...task })
      },
      ready: async () => [],
      blocked: async () => [],
      claim: async () => {
        throw new core.MyWorkError('TASK_CONFLICT', 'the integrator never claims')
      },
      transition: async command => {
        calls.push(`transition:${command.id}->${command.to}:${String(command.expectedRevision)}`)
        const task = tasks.get(command.id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${command.id}"`)
        if (command.expectedRevision !== undefined && command.expectedRevision !== task.revision) {
          throw new core.MyWorkError(
            'STALE_REVISION',
            `task "${command.id}" is at revision ${task.revision}, not ${command.expectedRevision}`,
          )
        }
        if (!core.canTransitionTask(task.state, command.to)) {
          throw new core.MyWorkError('TASK_CONFLICT', `illegal transition ${task.state} -> ${command.to}`)
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

/** The three reads the integrator asks of the attempt, its review, and its task. */
function recordsPort(options = {}) {
  const state = {
    subject: options.subject,
    review: options.review ?? null,
    liveAttempts: options.liveAttempts ?? [],
    openReviews: options.openReviews ?? [],
    calls: [],
  }
  return {
    state,
    async read(attemptId, meta) {
      state.calls.push('read')
      return core.ok(state.subject, meta)
    },
    async reviewOf(attemptId, meta) {
      state.calls.push('reviewOf')
      return core.ok(state.review ?? undefined, meta)
    },
    async liveAttempts(taskId, meta) {
      state.calls.push('liveAttempts')
      return core.ok(state.liveAttempts, meta)
    },
    async openReviews(taskId, meta) {
      state.calls.push('openReviews')
      return core.ok(state.openReviews, meta)
    },
  }
}

/**
 * A gate policy runner whose stored logs are keyed by hash.
 *
 * The dedupe is the port's own: one verdict for one (head, gate, output) triple
 * reuses its artifact reference, which is what "artifacts are not duplicated"
 * means for a caller.
 */
function gatesPort(options = {}) {
  const stored = new Map()
  const calls = []
  return {
    stored,
    calls,
    async run(request, meta) {
      calls.push(`run:${request.cwd}:strict=${String(request.strict)}`)
      const head = await git(request.cwd, ['rev-parse', 'HEAD'])
      const reported = options.headShift === true ? 'f'.repeat(40) : head
      const results = (options.verdicts ?? ['pass']).map((verdict, index) => {
        const id = options.ids?.[index] ?? `gate-${index + 1}`
        const hash = createHash('sha256').update(`${reported}:${id}:${verdict}`).digest('hex')
        if (!stored.has(hash)) stored.set(hash, Object.freeze({ artifactId: `gate-log-${stored.size + 1}`, hash }))
        return Object.freeze({
          id,
          headSha: reported,
          exitCode: verdict === 'pass' ? 0 : 1,
          verdict,
          artifactRef: stored.get(hash),
        })
      })
      return core.ok(
        Object.freeze({
          headSha: reported,
          results: Object.freeze(results),
          ...(options.refusal === undefined ? {} : { refusal: options.refusal }),
        }),
        meta,
      )
    },
  }
}

/** A sink for `needs-attention` rows and human decision requests. */
function escalationPort() {
  const raised = []
  const decisions = []
  return {
    raised,
    decisions,
    async raise(request, meta) {
      raised.push(request)
      return core.ok(`attention-${raised.length}`, meta)
    },
    async requestDecision(request, meta) {
      decisions.push(request)
      return core.ok(`decision-${decisions.length}`, meta)
    },
  }
}

/** Operation identity for one call. */
function meta(overrides = {}) {
  return core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1', ...overrides })
}

/**
 * An approved attempt against a target checkout, with the ledger open.
 *
 * The attempt is a real worktree on a real branch: the head the review approved
 * is the branch's own head, so a test that moves it moves something the port can
 * see.
 */
async function scenario(options = {}) {
  const dir = tempDir()
  const target = join(dir, 'main')
  mkdirSync(target, { recursive: true })
  await git(target, ['init', '--initial-branch=main'])
  await git(target, ['config', 'user.email', 'integrator@example.invalid'])
  await git(target, ['config', 'user.name', 'MyWork Integrator Test'])
  await git(target, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(target, 'README.md'), '# target\n')
  await git(target, ['add', '-A'])
  await git(target, ['commit', '-m', 'initial'])

  const attempt = join(dir, 'attempt')
  await git(target, ['worktree', 'add', '-b', 'attempt-1', attempt, 'HEAD'])
  writeFileSync(join(attempt, 'work.txt'), 'attempt change\n')
  await git(attempt, ['add', '-A'])
  await git(attempt, ['commit', '-m', 'attempt change'])

  const baseSha = await git(target, ['rev-parse', 'HEAD'])
  const headSha = await git(attempt, ['rev-parse', 'HEAD'])
  const diffHash = await patchHash(attempt, baseSha, headSha)
  const subject = {
    taskId: 'T-1',
    attemptId: 'A-1',
    workspaceId: 'W-1',
    targetPath: target,
    attemptPath: attempt,
    baseSha,
    headSha,
    diffHash,
    targetHeadSha: baseSha,
    ...(options.subject ?? {}),
  }
  const review = options.review === null ? null : {
    id: 'R-1',
    taskId: 'T-1',
    attemptId: 'A-1',
    reviewerId: 'Neo-2',
    state: 'approved',
    revision: 4,
    requestedAt: 500,
    artifact: { headSha, diffHash },
    settledAt: 900,
    ...(options.review ?? {}),
  }

  const registry = await storage.openStore({ path: join(dir, 'registry.sqlite'), migrations: [...BASE_MIGRATIONS] })
  const allocator = controller.createMigrationAllocator(registry)
  const version = allocator.allocate({ key: 'integration-operation' })
  const store = await storage.openStore({
    path: join(dir, 'controller.sqlite'),
    migrations: [...BASE_MIGRATIONS, execution.createIntegrationMigration(version)],
  })
  const clock = new adapterTesting.FakeClock(1_000)
  const git_ = options.git ?? gitPort(options.gitOptions)
  const graph = options.graph ?? graphPort().addTask('T-1', options.taskState ?? 'approved')
  const records = options.records ?? recordsPort({ subject, review, ...(options.recordsOptions ?? {}) })
  const gates = options.gates ?? gatesPort(options.gatesOptions)
  const escalation = options.escalation ?? escalationPort()
  const integrator = execution.createIntegrator({
    store,
    git: git_,
    graph: graph.port,
    records,
    gates,
    escalation,
    clock,
    integrationSchemaVersion: version,
  })
  return { dir, target, attempt, baseSha, headSha, diffHash, subject, review, store, clock, git: git_, graph, records, gates, escalation, integrator, version, allocator }
}

/** Unwrap a successful result. */
function unwrap(result) {
  assert.equal(result.ok, true, result.ok ? '' : `${result.error.code}: ${result.error.message}`)
  return result.value
}

/** The reason a refusal carries, as the closed catalogue names it. */
function reasonOf(result) {
  assert.equal(result.ok, false, 'expected a refusal')
  return result.error.details.reason
}

/** The number of commits on the target branch, read from the repository itself. */
async function commitCount(target) {
  return Number(await git(target, ['rev-list', '--count', 'HEAD']))
}

test('a review that is not approved is refused with TASK_CONFLICT and the reason review-not-approved', async () => {
  // (а) `approved` is the only state that admits work; anything else — including
  // no review at all — is refused before the repository is touched.
  for (const state of [null, 'queued', 'claimed', 'reviewing']) {
    const { integrator, graph, git: port, escalation } = await scenario({
      review: state === null ? null : { state },
    })
    const result = await integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })
    assert.equal(result.ok, false, `state ${String(state)} must not be integrated`)
    assert.equal(result.error.code, 'TASK_CONFLICT')
    assert.equal(reasonOf(result), 'review-not-approved')
    assert.equal(result.error.details.state, state)
    assert.equal(graph.tasks.get('T-1').state, 'approved', 'the graph must not move')
    assert.equal(port.calls.filter(call => call.startsWith('land:')).length, 0, 'nothing may land')
    assert.equal(escalation.raised.length, 0, 'an admission refusal is not an escalation')
    assert.equal(integrator.operation('op-1'), undefined, 'a refusal writes no ledger row')
  }
})

test('an approval whose artifact moved is refused with the stale-approval code', async () => {
  // (б) The head moved after the approval: the reviewer saw another diff.
  const moved = await scenario()
  writeFileSync(join(moved.attempt, 'work.txt'), 'attempt change, moved\n')
  await git(moved.attempt, ['add', '-A'])
  await git(moved.attempt, ['commit', '-m', 'a later change nobody reviewed'])
  const movedHead = await git(moved.attempt, ['rev-parse', 'HEAD'])
  const refused = await moved.integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, execution.staleApprovalCode(), 'the catalogue code for a stale approval')
  assert.ok(contracts.MYWORK_ERROR_CODES.includes(refused.error.code), 'the code must be a §42 code')
  assert.equal(reasonOf(refused), 'stale-approval')
  assert.equal(refused.error.details.current, movedHead)
  assert.equal(await commitCount(moved.target), 1, 'the target branch must not move')

  // The same refusal covers a recorded artifact whose diff no longer matches the
  // repository: the approval is bound to the patch, not to the head alone.
  const drifted = await scenario({ subject: { diffHash: 'f'.repeat(64) } })
  const driftedResult = await drifted.integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })
  assert.equal(driftedResult.ok, false)
  assert.equal(reasonOf(driftedResult), 'stale-approval')
  assert.equal(driftedResult.error.code, execution.staleApprovalCode())
})

test('an approved artifact that is still current is admitted, landed, and finalized', async () => {
  // (в) The positive control: without it every refusal above could be vacuous.
  const { integrator, graph, target, subject } = await scenario()
  const outcome = unwrap(await integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() }))
  assert.equal(outcome.state, 'done')
  assert.equal(outcome.baseSha, subject.baseSha)
  assert.equal(outcome.approvedHeadSha, subject.headSha)
  assert.equal(outcome.approvedDiffHash, subject.diffHash)
  assert.equal(outcome.landedHeadSha, outcome.commitSha)
  assert.equal(graph.tasks.get('T-1').state, 'done')
  assert.equal(await git(target, ['rev-parse', 'HEAD']), outcome.commitSha)
  const body = await git(target, ['log', '-1', '--format=%B'])
  assert.ok(body.includes(execution.taskRefTrailer('T-1')), `the commit body must carry the trailer, got: ${body}`)
})

test('needs-evidence and rejected reviews are refused with TASK_CONFLICT', async () => {
  // (г) The two states that carry findings are refusals like any other, not a
  // second kind of answer a caller has to know about.
  for (const state of ['needs-evidence', 'rejected']) {
    const { integrator, graph, target } = await scenario({ review: { state } })
    const result = await integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'TASK_CONFLICT')
    assert.equal(reasonOf(result), 'review-not-approved')
    assert.equal(result.error.details.state, state)
    assert.equal(graph.tasks.get('T-1').state, 'approved')
    assert.equal(await commitCount(target), 1)
  }
})

test('every admission refusal leaves the repository, the graph, and the ledger untouched', async () => {
  // (д) "Refused at the entrance" is only meaningful if nothing moved: no commit,
  // no ledger row, no graph transition, and no board escalation.
  const scenarios = [
    {
      name: 'the target branch moved after the decision',
      build: async () => {
        const fixture = await scenario()
        writeFileSync(join(fixture.target, 'other.txt'), 'somebody else landed\n')
        await git(fixture.target, ['add', '-A'])
        await git(fixture.target, ['commit', '-m', 'another landing'])
        return { fixture, code: 'STALE_REVISION', reason: 'stale-base' }
      },
    },
    {
      name: 'the target checkout is dirty',
      build: async () => {
        const fixture = await scenario()
        writeFileSync(join(fixture.target, 'uncommitted.txt'), 'not committed\n')
        return { fixture, code: 'TASK_CONFLICT', reason: 'target-dirty' }
      },
    },
    {
      name: 'the task is not approved',
      build: async () => {
        const fixture = await scenario({ taskState: 'reviewing' })
        return { fixture, code: 'TASK_CONFLICT', reason: 'task-not-approved' }
      },
    },
    {
      name: 'the caller observed an older revision',
      build: async () => {
        const fixture = await scenario()
        return { fixture, code: 'STALE_REVISION', reason: undefined, expectedRevision: 2 }
      },
    },
  ]

  for (const entry of scenarios) {
    const { fixture, code, reason, expectedRevision } = await entry.build()
    const before = await git(fixture.target, ['rev-parse', 'HEAD'])
    const result = await fixture.integrator.integrate({
      attemptId: 'A-1',
      expectedRevision: expectedRevision ?? 3,
      meta: meta(),
    })
    assert.equal(result.ok, false, entry.name)
    assert.equal(result.error.code, code, entry.name)
    if (reason !== undefined) assert.equal(result.error.details.reason, reason, entry.name)
    assert.equal(await git(fixture.target, ['rev-parse', 'HEAD']), before, `${entry.name}: the head must not move`)
    assert.equal(fixture.git.calls.filter(call => call.startsWith('land:')).length, 0, `${entry.name}: no landing`)
    assert.equal(fixture.git.calls.filter(call => call.startsWith('commit:')).length, 0, `${entry.name}: no commit`)
    assert.equal(fixture.graph.calls.filter(call => call.startsWith('transition:')).length, 0, `${entry.name}: no transition`)
    assert.equal(fixture.integrator.operation('op-1'), undefined, `${entry.name}: no ledger row`)
    assert.equal(fixture.escalation.raised.length, 0, `${entry.name}: no escalation`)
  }
})
