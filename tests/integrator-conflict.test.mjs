/**
 * Conflict and divergence acceptance (architecture §9, §19; MW-025, E-29).
 *
 * What this suite holds: **a conflict becomes a decision, never a silent loss.**
 * When git cannot merge the approved attempt, the landing is aborted, the tree is
 * left clean, no commit is created, the task is recorded as `needs-attention` with
 * the closed-catalogue reason `reconciliation-divergence`, and a human decision is
 * requested — without waiting for an answer, because §28's gate must free the
 * worker session rather than hold it open.
 *
 * A merge that succeeds textually but combines work the reviewer never saw is the
 * same kind of event: the integrator proves the landed patch against the approved
 * one, and refuses to continue when the proof fails. Nothing here resolves a
 * conflict with `--force`, `--ours`, or `--theirs`; the last test reads the sources
 * and shows those flags are absent.
 *
 * The `GitPort` here is a **fake over a real repository** (`packages/worktree-adapter`
 * is another card); repositories live in `$TEMP` and are removed in `after`.
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * Commit a change on the target branch and let the caller observe the new head.
 *
 * The subject's `targetHeadSha` is what the caller saw when it decided to
 * integrate, so a test that moves the branch has to move that observation too —
 * otherwise the refusal would be about the observation rather than about the
 * conflict being tested.
 */
async function landOnTarget(fixture, name, contents) {
  writeFileSync(join(fixture.target, name), contents)
  await git(fixture.target, ['add', '-A'])
  await git(fixture.target, ['commit', '-m', `target change in ${name}`])
  const head = await git(fixture.target, ['rev-parse', 'HEAD'])
  fixture.subject.targetHeadSha = head
  return head
}

test('a textual conflict aborts the landing, leaves a clean tree, and asks a human', async (t) => {
  // (а) Both sides changed the same file: git cannot merge it, and the integrator
  // must not choose a side. The abort is what makes the tree clean again.
  const fixture = await scenario()
  writeFileSync(join(fixture.target, 'work.txt'), 'target change\n')
  await git(fixture.target, ['add', '-A'])
  await git(fixture.target, ['commit', '-m', 'target change'])
  const targetHead = await git(fixture.target, ['rev-parse', 'HEAD'])
  fixture.subject.targetHeadSha = targetHead
  const commitsBefore = await git(fixture.target, ['rev-list', '--count', 'HEAD'])

  const result = await fixture.integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'TASK_CONFLICT')
  assert.equal(result.error.details.reason, 'merge-conflict')
  assert.deepEqual(result.error.details.conflictedPaths, ['work.txt'])
  assert.equal(result.error.details.targetClean, true)
  assert.ok(fixture.git.calls.includes('abortLanding'), 'the landing must be aborted')
  assert.equal(fixture.git.calls.filter(call => call.startsWith('commit:')).length, 0, 'no commit may be created')
  assert.equal(await git(fixture.target, ['status', '--porcelain']), '', 'git status must be clean after the abort')
  assert.equal(await git(fixture.target, ['rev-parse', 'HEAD']), targetHead, 'the head must be the pre-merge head')
  assert.equal(await git(fixture.target, ['rev-list', '--count', 'HEAD']), commitsBefore)
  assert.equal(fixture.graph.tasks.get('T-1').state, 'needs-attention')
  assert.equal(fixture.integrator.operation('op-1').state, 'needs-attention')
  assert.equal(fixture.escalation.raised.length, 1)
  assert.equal(fixture.escalation.raised[0].reason, 'reconciliation-divergence')
  assert.equal(fixture.escalation.raised[0].detail.includes('work.txt'), true)
  assert.equal(fixture.escalation.decisions.length, 1, 'a human decision must be requested')
  assert.equal(fixture.escalation.decisions[0].reason, 'reconciliation-divergence')
  t.diagnostic(`git status after the conflict -> ${JSON.stringify(await git(fixture.target, ['status', '--porcelain']))}`)
  t.diagnostic(`needs-attention -> ${fixture.escalation.raised[0].reason}: ${fixture.escalation.raised[0].detail}`)
})

test('a merge that silently combines divergent work is escalated, not accepted', async (t) => {
  // (б) The same invariant changed in two different files: git merges textually,
  // and the merged tree carries both — work the reviewer never saw. The integrator
  // proves the landed patch against the approved one and refuses to continue.
  const fixture = await scenario()
  writeFileSync(join(fixture.attempt, 'invariant-b.txt'), 'retention = 30 days\n')
  await git(fixture.attempt, ['add', '-A'])
  await git(fixture.attempt, ['commit', '-m', 'attempt sets the retention invariant'])
  const head = await git(fixture.attempt, ['rev-parse', 'HEAD'])
  const diffHash = await patchHash(fixture.attempt, fixture.baseSha, head)
  fixture.subject.headSha = head
  fixture.subject.diffHash = diffHash
  fixture.records.state.subject = fixture.subject
  fixture.records.state.review = { ...fixture.review, artifact: { headSha: head, diffHash } }
  await landOnTarget(fixture, 'invariant-a.txt', 'retention = 7 days\n')

  const result = await fixture.integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })

  assert.equal(result.ok, false)
  assert.equal(result.error.details.reason, 'landed-content-mismatch')
  assert.equal(result.error.code, execution.staleApprovalCode())
  assert.equal(fixture.graph.tasks.get('T-1').state, 'needs-attention')
  assert.equal(fixture.integrator.operation('op-1').state, 'needs-attention')
  assert.equal(fixture.escalation.raised.length, 1)
  assert.equal(fixture.escalation.raised[0].reason, 'reconciliation-divergence')
  assert.equal(fixture.escalation.decisions.length, 1)
  // The divergence is a fact about the repository, not about the integrator: the
  // landed tree really does carry both sides of the invariant.
  const landed = await git(fixture.target, ['rev-parse', 'HEAD'])
  assert.equal(await git(fixture.target, ['show', `${landed}:invariant-a.txt`]), 'retention = 7 days')
  assert.equal(await git(fixture.target, ['show', `${landed}:invariant-b.txt`]), 'retention = 30 days')
  assert.equal(fixture.gates.calls.length, 0, 'a head that is not the approved result is not verified as if it were')
  t.diagnostic(`landed tree carries both invariants; needs-attention -> ${fixture.escalation.raised[0].reason}`)
})

test('a failed verify after the merge does not mark the task done', async (t) => {
  // (в) The merge landed and the workspace's own verification said no: the task
  // stays in `integrating`, and a finalize cannot talk it into `done`.
  const fixture = await scenario({ gatesOptions: { verdicts: ['pass', 'fail'] } })
  const landed = await fixture.integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })

  assert.equal(landed.ok, false)
  assert.equal(landed.error.details.reason, 'gate-not-passed')
  assert.equal(fixture.graph.tasks.get('T-1').state, 'integrating')
  assert.notEqual(fixture.graph.tasks.get('T-1').state, 'done')
  assert.equal(fixture.integrator.operation('op-1').state, 'gated')
  const head = await git(fixture.target, ['rev-parse', 'HEAD'])
  assert.notEqual(head, fixture.baseSha, 'the landing itself did happen')
  const body = await git(fixture.target, ['log', '-1', '--format=%B'])
  assert.ok(body.includes(execution.taskRefTrailer('T-1')))

  const finalize = await fixture.integrator.finalize({ expectedRevision: 4, meta: meta() })
  assert.equal(finalize.ok, false)
  assert.equal(finalize.error.details.reason, 'gate-not-passed')
  assert.equal(fixture.graph.tasks.get('T-1').state, 'integrating')
  assert.equal(await git(fixture.target, ['status', '--porcelain']), '')
  t.diagnostic(`git status after the failed verify -> ${JSON.stringify(await git(fixture.target, ['status', '--porcelain']))}`)
})

test('no source resolves a conflict with a force flag', async () => {
  // (г) The vocabulary is the guarantee: there is no flag in the integrator that
  // could pick a side, so the only path from a conflict is the human one.
  const directory = join(repoRoot, 'packages', 'execution', 'src')
  const sources = readdirSync(directory).filter(name => name.endsWith('.ts')).map(name => join(directory, name))
  const forbidden = ['--force', '--ours', '--theirs']
  const hits = []
  for (const file of sources) {
    const text = readFileSync(file, 'utf8')
    for (const flag of forbidden) if (text.includes(flag)) hits.push(`${file}:${flag}`)
  }
  assert.deepEqual(hits, [])
  // Positive control: the same scan does find these flags in a file that carries
  // them — this suite's own text — so a zero above is a fact about the sources.
  const control = readFileSync(new URL(import.meta.url), 'utf8')
  for (const flag of forbidden) assert.ok(control.includes(flag), `the scan must be able to see ${flag}`)
  assert.ok(
    readFileSync(join(directory, 'integrator.ts'), 'utf8').includes('abortLanding'),
    'the integrator source must be the file being scanned',
  )
})
