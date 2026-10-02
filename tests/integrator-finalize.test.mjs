/**
 * Idempotent finalize acceptance (architecture §9, §48; MW-025, E-28).
 *
 * What this suite holds: **a repeated `finalize` is safe.** The graph moves to
 * `done` exactly once, guarded by the revision the caller observed; a second call
 * with the same `operationId` replays the recorded outcome instead of creating a
 * second commit, a second transition, or a second gate run; and `done` is never
 * reached while a required gate is red or the approval is gone.
 *
 * The ledger behind that idempotency is the migration this step owns, and its
 * version comes from the **allocator** (`D08`, `F-63`) rather than from a literal:
 * the test asserts that by reading the number out of the composition layer's own
 * allocator, and by proving the source file contains no `version: <number>`.
 *
 * The `GitPort` here is a **fake over a real repository** (`packages/worktree-adapter`
 * is another card); repositories live in `$TEMP` and are removed in `after`.
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
 * observation is refused by the graph rather than by the caller's bookkeeping, and
 * it can fail one `done` transition so a crash between the landing and the graph
 * move is expressible.
 */
function graphPort(options = {}) {
  const tasks = new Map()
  const calls = []
  let doneFailures = 0
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
        if (options.failDoneOnce === true && command.to === 'done' && doneFailures === 0) {
          doneFailures += 1
          throw new core.MyWorkError('ADAPTER_UNAVAILABLE', 'the graph was unreachable when the task was completed')
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
  const graph = options.graph ?? graphPort(options.graphOptions).addTask('T-1', options.taskState ?? 'approved')
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

/**
 * A landing whose last step did not happen, so the ledger owes it.
 *
 * The gates are green and the commit exists; the operation stopped before `done`
 * — the graph refused the move once, or the task still has open work. That is the
 * state `finalize` exists for, and it is what makes a standalone `finalize` call
 * testable rather than vacuous.
 */
async function landedScenario(options = {}) {
  const fixture = await scenario({ graphOptions: { failDoneOnce: true }, ...options })
  const first = await fixture.integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })
  assert.equal(first.ok, false, 'the first run must not settle the task')
  assert.equal(fixture.integrator.operation('op-1').state, 'landed')
  assert.equal(fixture.graph.tasks.get('T-1').state, 'integrating')
  return fixture
}

test('the first finalize moves the task to done with the revision the caller observed', async (t) => {
  const fixture = await landedScenario()
  const outcome = unwrap(await fixture.integrator.finalize({ expectedRevision: 4, meta: meta() }))

  assert.equal(outcome.state, 'done')
  assert.equal(outcome.graphRevision, 5)
  assert.equal(fixture.graph.tasks.get('T-1').state, 'done')
  assert.equal(fixture.integrator.operation('op-1').state, 'done')
  const doneCalls = fixture.graph.calls.filter(call => call.includes('->done'))
  assert.ok(doneCalls.length >= 1, 'the completion must be attempted')
  assert.deepEqual(
    doneCalls.filter(call => call !== 'transition:T-1->done:4'),
    [],
    'every completion attempt must carry the revision the caller observed',
  )
  t.diagnostic(`transition calls -> ${fixture.graph.calls.filter(call => call.startsWith('transition:')).join(', ')}`)

  // The ledger this step owns is a migration whose version the allocator hands
  // out: the number is read from the composition layer, never written here.
  assert.equal(fixture.version, fixture.allocator.allocate({ key: 'integration-operation' }))
  const migration = execution.createIntegrationMigration(fixture.version)
  assert.equal(migration.version, fixture.version)
  assert.equal(migration.name, 'integration-operation')
  assert.equal(migration.version > execution.CLAIM_SAGA_SCHEMA_VERSION, true, 'the ledger lands after the saga')
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => execution.createIntegrationMigration(bad), error => error.code === 'invalid-input')
  }
  const source = readFileSync(join(repoRoot, 'packages', 'execution', 'src', 'integration-schema.ts'), 'utf8')
  assert.equal(/version:\s*\d+/.test(source), false, 'the migration source must not carry a version literal')
  // Positive control: the same scan does find literals in a file that writes them.
  const control = readFileSync(join(repoRoot, 'packages', 'storage', 'src', 'migrations.ts'), 'utf8')
  assert.equal(/version:\s*\d+/.test(control), true, 'the scan must be able to see a literal version')
})

test('a second finalize with the same operationId replays the outcome without a new commit', async (t) => {
  const fixture = await landedScenario()
  const first = unwrap(await fixture.integrator.finalize({ expectedRevision: 4, meta: meta() }))
  const headAfterFirst = await git(fixture.target, ['rev-parse', 'HEAD'])
  const transitionsAfterFirst = fixture.graph.calls.filter(call => call.startsWith('transition:')).length
  const gateRunsAfterFirst = fixture.gates.calls.length

  // The revision is deliberately stale now: the operation is settled, so the
  // recorded outcome is replayed instead of re-decided.
  const second = unwrap(await fixture.integrator.finalize({ expectedRevision: 4, meta: meta() }))

  assert.deepEqual(second, first)
  assert.equal(second.commitSha, first.commitSha)
  assert.equal(second.graphRevision, first.graphRevision)
  assert.equal(await git(fixture.target, ['rev-parse', 'HEAD']), headAfterFirst)
  assert.equal(fixture.graph.calls.filter(call => call.startsWith('transition:')).length, transitionsAfterFirst)
  assert.equal(fixture.gates.calls.length, gateRunsAfterFirst)
  assert.equal(await git(fixture.target, ['rev-list', '--count', '--first-parent', `${fixture.baseSha}..HEAD`]), '1')
  t.diagnostic(`git rev-list --count --first-parent ${fixture.baseSha.slice(0, 7)}..HEAD -> 1`)
})

test('a stale graph revision is refused with STALE_REVISION and changes nothing', async () => {
  const fixture = await landedScenario()
  const headBefore = await git(fixture.target, ['rev-parse', 'HEAD'])

  const refused = await fixture.integrator.finalize({ expectedRevision: 2, meta: meta() })
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'STALE_REVISION')
  assert.equal(fixture.graph.tasks.get('T-1').state, 'integrating')
  assert.equal(fixture.integrator.operation('op-1').state, 'landed')
  assert.equal(await git(fixture.target, ['rev-parse', 'HEAD']), headBefore)

  // The refusal is not a dead end: the same operation finishes with the right
  // observation, and still with one commit.
  const settled = unwrap(await fixture.integrator.finalize({ expectedRevision: 4, meta: meta() }))
  assert.equal(settled.state, 'done')
  assert.equal(await git(fixture.target, ['rev-parse', 'HEAD']), headBefore)
})

test('finalize refuses while an attempt is live or a review is open, and leaves neither behind', async () => {
  // The scenario spends its one injected `done` failure in `integrate`, which is
  // what leaves the ledger owing the completion; the guard states below are set
  // after that, so the refusal under test is the guard and not the crash.
  const live = await landedScenario()
  live.records.state.liveAttempts = ['A-1']
  const liveRefusal = await live.integrator.finalize({ expectedRevision: 4, meta: meta() })
  assert.equal(liveRefusal.ok, false)
  assert.equal(liveRefusal.error.details.reason, 'live-attempt')
  assert.equal(live.graph.tasks.get('T-1').state, 'integrating')
  assert.equal(live.integrator.operation('op-1').state, 'landed', 'a refusal leaves the ledger where it was')

  live.records.state.liveAttempts = []
  live.records.state.openReviews = ['R-2']
  const openRefusal = await live.integrator.finalize({ expectedRevision: 4, meta: meta() })
  assert.equal(openRefusal.ok, false)
  assert.equal(openRefusal.error.details.reason, 'open-review')

  live.records.state.openReviews = []
  const settled = unwrap(await live.integrator.finalize({ expectedRevision: 4, meta: meta() }))
  assert.equal(settled.state, 'done')
  // The state after `done` is what the acceptance criterion names: no live
  // attempt and no review still open on the task.
  assert.deepEqual(live.records.state.liveAttempts, [])
  assert.deepEqual(live.records.state.openReviews, [])
})

test('done is not set while a required gate is red or the approval is gone', async () => {
  const red = await scenario({ gatesOptions: { verdicts: ['fail'] } })
  const redLanding = await red.integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })
  assert.equal(redLanding.ok, false)
  const redFinalize = await red.integrator.finalize({ expectedRevision: 4, meta: meta() })
  assert.equal(redFinalize.ok, false)
  assert.equal(redFinalize.error.details.reason, 'gate-not-passed')
  assert.equal(red.graph.tasks.get('T-1').state, 'integrating')

  const withdrawn = await landedScenario()
  withdrawn.records.state.review = { ...withdrawn.review, state: 'rejected' }
  const rejected = await withdrawn.integrator.finalize({ expectedRevision: 4, meta: meta() })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'TASK_CONFLICT')
  assert.equal(rejected.error.details.reason, 'review-not-approved')
  assert.equal(withdrawn.graph.tasks.get('T-1').state, 'integrating')

  const moved = await landedScenario()
  moved.records.state.review = {
    ...moved.review,
    artifact: { headSha: moved.review.artifact.headSha, diffHash: 'f'.repeat(64) },
  }
  const stale = await moved.integrator.finalize({ expectedRevision: 4, meta: meta() })
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, execution.staleApprovalCode())
  assert.equal(stale.error.details.reason, 'stale-approval')
  assert.equal(moved.graph.tasks.get('T-1').state, 'integrating')
})
