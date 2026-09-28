/**
 * Integrator commit acceptance (architecture §19; MW-025, E-26).
 *
 * What this suite holds: **the link between a task and the commit that integrated
 * it is written by MyWork, not by a git hook.** The integrator's commit body
 * carries `Refs: mw-<hash>`, derived from the task id, so a reader can recognise
 * the commit in a workspace where no Beads hook was ever installed — which is the
 * card's own acceptance criterion (`MW-025.md:20`).
 *
 * Two further properties are proved by construction rather than by discipline:
 * the port has no `push` (so a remote cannot be reached at all), and the landing
 * strategy is the caller's — `merge --no-ff` by default, `rebase` only when the
 * policy asks for it, and never a flag that resolves a conflict by picking a side.
 *
 * The `GitPort` here is a **fake over a real repository** (`packages/worktree-adapter`
 * is another card); repositories live in `$TEMP` and are removed in `after`.
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
      // `rebase` is a fast-forward here: the attempt is based on the target head,
      // so replaying it there is exactly a fast-forward of the target. `merge-no-ff`
      // is staged and left for the integrator's own commit.
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

test('the integration commit carries the Refs: mw-<hash> trailer in its body', async (t) => {
  // (а) The link is written by MyWork into the commit message it hands to git, so
  // it holds in a workspace where no Beads hook was installed.
  const { integrator, target, headSha, baseSha } = await scenario()
  const outcome = unwrap(
    await integrator.integrate({
      attemptId: 'A-1',
      expectedRevision: 3,
      summary: 'Integrate T-1 for MW-025',
      meta: meta(),
    }),
  )
  const body = await git(target, ['log', '-1', '--format=%B'])
  const subject = await git(target, ['log', '-1', '--format=%s'])
  const parents = (await git(target, ['rev-list', '--parents', '-n', '1', 'HEAD'])).split(' ')
  const trailer = execution.taskRefTrailer('T-1')

  t.diagnostic(`git log -1 --format=%B -> ${JSON.stringify(body)}`)
  assert.equal(subject, 'Integrate T-1 for MW-025')
  assert.equal(body.trimEnd(), `Integrate T-1 for MW-025\n\n${trailer}`)
  assert.ok(trailer.startsWith('Refs: mw-'), `the trailer must start with "Refs: mw-", got "${trailer}"`)
  assert.match(trailer.slice('Refs: mw-'.length), /^[0-9a-f]{12}$/)
  assert.equal(outcome.commitSha, await git(target, ['rev-parse', 'HEAD']))
  // The integration is a merge commit: the approved head is preserved as the
  // second parent, so the reviewed revision is still in the history.
  assert.deepEqual(parents, [outcome.commitSha, baseSha, headSha])
})

test('the integrator cannot push: no remote exists and the port has no such operation', async (t) => {
  // (б) Absence by construction: the repository has no remote, and the port's own
  // declaration has no `push` member — the guarantee is the type, not discipline.
  const { integrator, target } = await scenario()
  unwrap(await integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() }))

  const origin = await gitTry(target, ['config', '--get', 'remote.origin.url'])
  const remotes = await git(target, ['remote'])
  const remoteRefs = await git(target, ['for-each-ref', 'refs/remotes'])
  t.diagnostic(`git config --get remote.origin.url -> exit ${origin.status}, stdout ${JSON.stringify(origin.stdout)}`)
  assert.notEqual(origin.status, 0, 'no remote may be configured')
  assert.equal(remotes, '')
  assert.equal(remoteRefs, '')

  const sources = readdirSync(join(repoRoot, 'packages', 'execution', 'src'))
    .filter(name => name.endsWith('.ts'))
    .map(name => join(repoRoot, 'packages', 'execution', 'src', name))
  const portSource = join(repoRoot, 'packages', 'contracts', 'src', 'git.ts')
  const quotedVerb = /(['"])(push|rebase|merge-no-ff)\1/g
  const found = []
  for (const file of [...sources, portSource]) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(quotedVerb)) found.push(`${file}:${match[2]}`)
  }
  // Positive control: the same scan does see the landing verbs the port declares,
  // so a zero for `push` is a fact about the sources rather than about the pattern.
  assert.ok(found.includes(`${portSource}:rebase`), `the scan must see the declared verbs, found ${found.join(', ')}`)
  assert.ok(found.includes(`${portSource}:merge-no-ff`), 'the scan must see the default strategy')
  assert.deepEqual(found.filter(entry => entry.endsWith(':push')), [], 'no source may name a push operation')

  // The port's declaration has no `push` method; the control is the `land` method
  // that sits next to it.
  const portText = readFileSync(portSource, 'utf8')
  assert.equal(/^ {2}push\(/m.test(portText), false, 'GitPort must not declare push')
  assert.equal(/^ {2}land\(/m.test(portText), true, 'GitPort declares land')
})

test('the landing strategy is the caller\'s, and the integration commit is the one that carries the trailer', async (t) => {
  // (в) The default is a local `merge --no-ff`; `rebase` is used only when the
  // policy asks for it; and a port that cannot produce the integration commit is
  // refused rather than silently landing a commit with no trailer.
  const byDefault = await scenario()
  unwrap(await byDefault.integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() }))
  const defaultLand = byDefault.git.calls.filter(call => call.startsWith('land:'))
  assert.deepEqual(defaultLand, [`land:merge-no-ff:${byDefault.headSha.slice(0, 7)}`])
  t.diagnostic(`default landing -> ${defaultLand.join(', ')}`)

  const byPolicy = await scenario()
  unwrap(
    await byPolicy.integrator.integrate({
      attemptId: 'A-1',
      expectedRevision: 3,
      strategy: 'rebase',
      meta: meta(),
    }),
  )
  assert.deepEqual(byPolicy.git.calls.filter(call => call.startsWith('land:')), [`land:rebase:${byPolicy.headSha.slice(0, 7)}`])
  const rebasedBody = await git(byPolicy.target, ['log', '-1', '--format=%B'])
  assert.ok(rebasedBody.includes(execution.taskRefTrailer('T-1')), 'a rebase landing still carries the trailer')

  // A port that commits the landing itself: the integrator's own commit is still
  // the last one, so `git log -1` shows the trailer.
  const byPort = await scenario({ gitOptions: { commitLanding: true } })
  unwrap(await byPort.integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() }))
  const portBody = await git(byPort.target, ['log', '-1', '--format=%B'])
  assert.ok(portBody.includes(execution.taskRefTrailer('T-1')))
  assert.equal(await git(byPort.target, ['rev-list', '--count', 'HEAD']), '4', 'the merge and the record commit both exist')

  // A port whose commit writes nothing: the trailer would be absent, so the
  // integrator refuses instead of reporting a success it cannot substantiate.
  const inert = await scenario({ gitOptions: { inertLand: true, inertCommit: true } })
  const refused = await inert.integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() })
  assert.equal(refused.ok, false)
  assert.equal(refused.error.details.reason, 'landing-not-staged')
  assert.equal(await git(inert.target, ['rev-parse', 'HEAD']), inert.baseSha, 'the head must not move')
})

test('the approved attempt branch is not rewritten and the integration lands on the checked-out branch', async (t) => {
  // (г) Nothing rewrites the reviewed revision: the attempt branch keeps its head,
  // the target branch is the one checked out, and the tree is clean afterwards.
  const { integrator, target, baseSha, headSha } = await scenario()
  const beforeBranch = await git(target, ['branch', '--show-current'])
  assert.equal(beforeBranch, 'main')
  assert.equal(await git(target, ['rev-parse', 'HEAD']), baseSha)

  const outcome = unwrap(await integrator.integrate({ attemptId: 'A-1', expectedRevision: 3, meta: meta() }))

  assert.equal(await git(target, ['rev-parse', 'attempt-1']), headSha, 'the attempt branch must not be rewritten')
  assert.equal(await git(target, ['branch', '--show-current']), 'main')
  assert.equal(await git(target, ['status', '--porcelain']), '', 'the integration leaves a clean tree')
  // Exactly one commit is added to the target's first-parent line: the merge.
  const firstParent = await git(target, ['rev-list', '--count', '--first-parent', `${baseSha}..${outcome.commitSha}`])
  t.diagnostic(`git rev-list --count --first-parent ${baseSha.slice(0, 7)}..HEAD -> ${firstParent}`)
  assert.equal(firstParent, '1')
  assert.equal(await git(target, ['rev-list', '--count', `${baseSha}..${outcome.commitSha}`]), '2')
})
