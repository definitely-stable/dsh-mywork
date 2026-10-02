/**
 * Integrator gate re-run acceptance (architecture §19; MW-025, E-27).
 *
 * What this suite holds: **a successful merge is not acceptance.** The workspace's
 * gate policy runs against the *integrated* head — the commit the integrator just
 * created — with `strict`, and a verdict that belongs to any other head is
 * discarded instead of counted. A red gate leaves the task in `integrating`, never
 * in `done`, and a repeat of the same operation re-runs the gates on the same head
 * without producing a second commit or a second artifact for one verdict.
 *
 * The `GitPort` here is a **fake over a real repository** (`packages/worktree-adapter`
 * is another card); repositories live in `$TEMP` and are removed in `after`.
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

import { adapterTesting, core, evidence, execution, lease, repoRoot, storage } from './lib/fixtures.mjs'

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
      const args = request.strategy === 'rebase'
        ? ['merge', '--ff-only', request.revision]
        : options.commitLanding === true
          ? ['merge', '--no-ff', '-m', `Merge ${request.revision.slice(0, 7)}`, request.revision]
          : ['merge', '--no-ff', '--no-commit', request.revision]
      const result = await gitTry(request.cwd, args)
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
  const runs = []
  return {
    stored,
    calls,
    runs,
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
      runs.push(Object.freeze(results))
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

test('the gates run against the integrated head, not against the approved attempt head', async (t) => {
  // (а) The commit the integrator created is the head the policy verifies.
  const { integrator, target, gates, headSha } = await scenario({ gatesOptions: { verdicts: ['pass', 'pass'] } })
  const outcome = unwrap(await integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() }))

  assert.equal(outcome.state, 'done')
  assert.notEqual(outcome.landedHeadSha, outcome.approvedHeadSha)
  assert.equal(outcome.approvedHeadSha, headSha)
  assert.equal(gates.calls.length, 1)
  assert.deepEqual(gates.calls, [`run:${target}:strict=true`])
  assert.equal(gates.runs.length, 1)
  for (const result of gates.runs[0]) assert.equal(result.headSha, outcome.landedHeadSha)
  assert.deepEqual(
    outcome.gates.map(result => result.headSha),
    [outcome.landedHeadSha, outcome.landedHeadSha],
  )
  t.diagnostic(`gate head -> ${outcome.gates[0].headSha}; approved head -> ${outcome.approvedHeadSha}`)
})

test('a failing required gate leaves the task in integrating, never in done', async (t) => {
  // (б) The merge landed, the gates said no, and the graph says the work is not
  // finished: "merged" and "accepted" are different facts.
  const { integrator, graph, target, gates } = await scenario({ gatesOptions: { verdicts: ['pass', 'fail'] } })
  const result = await integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'TASK_CONFLICT')
  assert.equal(result.error.details.reason, 'gate-not-passed')
  assert.deepEqual(result.error.details.failed, ['gate-2:fail'])
  assert.equal(graph.tasks.get('T-1').state, 'integrating', 'the task must not reach done')
  const row = integrator.operation('op-1')
  assert.equal(row.state, 'gated')
  assert.notEqual(row.landedHeadSha, null, 'the landing itself did happen')
  const body = await git(target, ['log', '-1', '--format=%B'])
  assert.ok(body.includes(execution.taskRefTrailer('T-1')))
  t.diagnostic(`gate verdicts -> ${gates.runs[0].map(entry => `${entry.id}:${entry.verdict}`).join(', ')}`)
})

test('a verdict that belongs to another head is discarded and escalated', async (t) => {
  // (в) A gate run whose head is not the integrated head proves nothing; the
  // integrator refuses to count it and asks a human instead.
  const { integrator, graph, escalation } = await scenario({ gatesOptions: { headShift: true } })
  const result = await integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })

  assert.equal(result.ok, false)
  assert.equal(result.error.details.reason, 'gate-head-moved')
  assert.equal(result.error.details.gateHeadSha, 'f'.repeat(40))
  assert.equal(graph.tasks.get('T-1').state, 'needs-attention')
  assert.equal(escalation.raised.length, 1)
  assert.equal(escalation.raised[0].reason, 'reconciliation-divergence')
  assert.equal(escalation.decisions.length, 1)
  assert.equal(integrator.operation('op-1').state, 'needs-attention')
  t.diagnostic(`needs-attention reason -> ${escalation.raised[0].reason}`)
})

test('re-running the gates on the same head is idempotent', async (t) => {
  // (г) A retry of the same operation re-runs the policy on the same head: no
  // second commit, and one artifact per verdict rather than one per run.
  const { integrator, gates, target, baseSha } = await scenario({ gatesOptions: { verdicts: ['fail'] } })
  const first = await integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })
  const headAfterFirst = await git(target, ['rev-parse', 'HEAD'])
  const second = await integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })

  assert.equal(first.ok, false)
  assert.equal(second.ok, false)
  assert.equal(second.error.details.reason, 'gate-not-passed')
  assert.equal(gates.calls.length, 2, 'the policy is asked again on a retry')
  assert.equal(gates.stored.size, 1, 'one head and one verdict keep one stored log')
  assert.equal(gates.runs[0][0].artifactRef.artifactId, gates.runs[1][0].artifactRef.artifactId)
  assert.equal(gates.runs[0][0].artifactRef.hash, gates.runs[1][0].artifactRef.hash)
  assert.equal(await git(target, ['rev-parse', 'HEAD']), headAfterFirst, 'no second commit')
  assert.equal(await git(target, ['rev-list', '--count', `${baseSha}..HEAD`]), '2')
  assert.equal(await git(target, ['rev-list', '--count', '--first-parent', `${baseSha}..HEAD`]), '1')
  t.diagnostic(`artifact refs -> ${gates.runs.map(run => run[0].artifactRef.artifactId).join(', ')}`)
})
