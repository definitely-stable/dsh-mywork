/**
 * Worktree adapter over real repositories (MW-021, E-03; architecture §19, §31).
 *
 * Every test builds a throwaway repository under the system temporary directory
 * and removes it at the end; the live workspace, the board, and the DSH profile
 * are never touched. What is checked here is what §19's acceptance rests on:
 * `prepare` cuts a branch from the pinned base inside the policy root, an empty
 * repository is refused instead of being committed to, a second worktree for one
 * attempt is refused, `resolve` refuses a path that leaves the policy root, a
 * dirty worktree survives `cleanup`, and a `GIT_DIR` exported by the caller's
 * shell cannot redirect any of it.
 *
 * The acceptance of the card is a statement about *two* attempts at once, so the
 * two criteria that need a pair are checked as a pair: two attempts get two
 * checkouts and the shared one is never written, and `cleanup` deletes a clean
 * worktree while keeping an orphan directory, a foreign one, and a repeated call
 * working. `list` is checked against the same registry, because "only the
 * worktrees MyWork created" is what makes a cleanup sweep safe to run.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root, derived here so this suite needs no shared fixture module. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * One built package, loaded from its bundle.
 *
 * The suite imports the packages it uses directly rather than through
 * `tests/lib/fixtures.mjs`: that module requires the build output of *every*
 * package, so a neighbour's concurrent build of an unrelated package would fail
 * these tests for a reason that is not theirs.
 * @param name - package directory under `packages/`.
 */
async function built(name) {
  return import(pathToFileURL(join(repoRoot, 'packages', name, 'lib', 'index.js')).href)
}

/** The adapter as built: the tests exercise the bundle a consumer loads. */
const adapter = await built('worktree-adapter')

/** The domain primitives the assertions use (`isWithinRoot`, operation identity). */
const core = await built('core')

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-worktree-'

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) {
    // Refuse anything this suite did not create: a recursive delete built from a
    // computed path is only safe while the path is provably one of ours.
    assert.ok(dir.startsWith(join(tmpdir(), TEMP_PREFIX)), `refusing to remove ${dir}`)
    rmSync(dir, { recursive: true, force: true })
  }
})

/** Operation identity for fixture calls. */
function meta(overrides = {}) {
  return core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1', ...overrides })
}

/**
 * Run one git command and require it to succeed.
 * @param args - arguments after the executable.
 * @param cwd - directory to run in.
 * @returns trimmed stdout.
 */
function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, windowsHide: true })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed in ${cwd}: ${result.stderr}`)
  return result.stdout.trim()
}

/** One repository with an identity and one commit on `main`. */
function repository() {
  const dir = tempDir()
  git(['init', '-q', '-b', 'main'], dir)
  git(['config', 'user.email', 'mywork-tests@example.invalid'], dir)
  git(['config', 'user.name', 'MyWork Tests'], dir)
  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  git(['add', '--', 'README.md'], dir)
  git(['commit', '-q', '-m', 'fixture: initial commit'], dir)
  return dir
}

/** A policy whose root sits inside one temporary directory. */
function policyFor(dir, overrides = {}) {
  return {
    root: join(dir, 'worktrees'),
    branchPrefix: 'mywork/',
    retentionMs: 7 * 24 * 3600 * 1000,
    keepDirty: true,
    ...overrides,
  }
}

/** A request for one attempt of one workspace. */
function request(baseSha, overrides = {}) {
  return { workspaceId: 'W-1', taskId: 'T-1', attemptId: 'A-1', baseSha, ...overrides }
}

/** The refusal a failed result carries, or `undefined` for a success. */
function refusalOf(result) {
  return result.ok ? undefined : result.error.details?.refusal
}

test('prepare cuts a branch from the pinned base inside the policy root', async () => {
  const repo = repository()
  const head = git(['rev-parse', 'HEAD'], repo)
  const policy = policyFor(repo)
  const port = adapter.createWorktreePort({ policy, repository: repo })
  const prepared = await port.prepare(request(head), meta())

  assert.equal(prepared.ok, true, `prepare failed: ${JSON.stringify(prepared.error)}`)
  const registration = prepared.value
  assert.equal(registration.baseSha, head, 'the worktree must be cut from the pinned base')
  assert.equal(registration.branch, 'mywork/T-1-A-1')
  assert.ok(
    core.isWithinRoot(policy.root, registration.path),
    `"${registration.path}" must be inside the policy root "${policy.root}"`,
  )
  assert.equal(existsSync(registration.path), true, 'the worktree directory must exist')
  assert.equal(git(['rev-parse', 'HEAD'], registration.path), head, 'the new worktree must start at the base')
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], registration.path), registration.branch)
  assert.match(git(['worktree', 'list', '--porcelain'], repo), /worktree /, 'git must list the new worktree')
  assert.ok(
    git(['worktree', 'list', '--porcelain'], repo).includes(registration.path.replace(/\\/g, '/')),
    'the shared repository must own the new worktree entry',
  )
})

test('an empty repository is refused instead of being committed to', async () => {
  const repo = tempDir()
  git(['init', '-q', '-b', 'main'], repo)
  const policy = policyFor(repo)
  const port = adapter.createWorktreePort({ policy, repository: repo })
  const prepared = await port.prepare(request('0'.repeat(40)), meta())

  assert.equal(prepared.ok, false)
  assert.equal(refusalOf(prepared), 'EMPTY_REPOSITORY')
  assert.equal(prepared.error.code, 'TASK_CONFLICT')
  // No hidden first commit, no branch, no directory: the precondition is stated
  // rather than repaired.
  assert.notEqual(spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repo, encoding: 'utf8' }).status, 0)
  assert.equal(git(['branch', '--list'], repo), '')
  assert.equal(existsSync(policy.root), false, 'a refused prepare must not leave a directory behind')
})

test('a second worktree for one attempt is refused', async () => {
  const repo = repository()
  const head = git(['rev-parse', 'HEAD'], repo)
  const port = adapter.createWorktreePort({ policy: policyFor(repo), repository: repo })
  const first = await port.prepare(request(head), meta())
  assert.equal(first.ok, true)
  const second = await port.prepare(request(head), meta({ operationId: 'op-2' }))

  assert.equal(second.ok, false)
  assert.equal(refusalOf(second), 'WORKTREE_ALREADY_REGISTERED')
  const listed = git(['worktree', 'list', '--porcelain'], repo)
  assert.equal(listed.split('worktree ').length - 1, 2, `expected the shared checkout and one worktree, got:\n${listed}`)
})

test('resolve refuses a worktree registered outside the policy root', async () => {
  const repo = repository()
  const outside = tempDir()
  const policy = policyFor(repo)
  const registry = adapter.createWorktreeRegistry([
    {
      attemptId: 'A-1',
      workspaceId: 'W-1',
      taskId: 'T-1',
      path: join(outside, 'somewhere-else'),
      branch: 'mywork/T-1-A-1',
      baseSha: git(['rev-parse', 'HEAD'], repo),
    },
  ])
  const port = adapter.createWorktreePort({ policy, repository: repo, registry })
  const resolved = await port.resolve('A-1', meta())

  assert.equal(resolved.ok, false)
  assert.equal(refusalOf(resolved), 'WORKTREE_OUTSIDE_WORKSPACE')
  assert.equal(resolved.error.code, 'SECURITY_DENIED')
  // Positive control: the same call on a path inside the root answers, so the
  // check refuses the escape rather than refusing everything.
  const inside = adapter.createWorktreeRegistry([
    {
      attemptId: 'A-2',
      workspaceId: 'W-1',
      taskId: 'T-1',
      path: join(policy.root, 'mywork-T-1-A-2'),
      branch: 'mywork/T-1-A-2',
      baseSha: git(['rev-parse', 'HEAD'], repo),
    },
  ])
  const honest = adapter.createWorktreePort({ policy, repository: repo, registry: inside })
  assert.equal((await honest.resolve('A-2', meta())).ok, true)
})

test('resolve refuses an absolute escape and a path that climbs out with ..', async () => {
  const repo = repository()
  const policy = policyFor(repo)
  const baseSha = git(['rev-parse', 'HEAD'], repo)
  const escapes = {
    absolute: resolve(tmpdir(), 'dsh-mywork-not-a-worktree'),
    climbing: join(policy.root, '..', 'escaped-worktree'),
    sibling: `${policy.root}-evil`,
  }
  for (const [name, path] of Object.entries(escapes)) {
    const registry = adapter.createWorktreeRegistry([
      { attemptId: 'A-1', workspaceId: 'W-1', taskId: 'T-1', path, branch: 'mywork/T-1-A-1', baseSha },
    ])
    const port = adapter.createWorktreePort({ policy, repository: repo, registry })
    const resolved = await port.resolve('A-1', meta())
    assert.equal(resolved.ok, false, `${name}: "${path}" must not resolve`)
    assert.equal(refusalOf(resolved), 'WORKTREE_OUTSIDE_WORKSPACE', `${name}: wrong refusal`)
  }
})

test('cleanup refuses a dirty worktree and leaves the directory in place', async () => {
  const repo = repository()
  const head = git(['rev-parse', 'HEAD'], repo)
  const port = adapter.createWorktreePort({ policy: policyFor(repo), repository: repo })
  const prepared = await port.prepare(request(head), meta())
  assert.equal(prepared.ok, true)
  const path = prepared.value.path
  writeFileSync(join(path, 'work-in-progress.txt'), 'not committed yet\n')

  const cleaned = await port.cleanup('A-1', meta({ operationId: 'op-3' }))
  assert.equal(cleaned.ok, false)
  assert.equal(refusalOf(cleaned), 'WORKTREE_DIRTY')
  assert.equal(existsSync(path), true, 'uncommitted work must survive a cleanup')
  assert.equal(existsSync(join(path, 'work-in-progress.txt')), true, 'the dirty file must survive too')
  assert.ok(
    git(['worktree', 'list', '--porcelain'], repo).includes(path.replace(/\\/g, '/')),
    'the worktree must stay registered in the shared repository',
  )
})

test('a GIT_DIR exported by the caller cannot redirect the port', async () => {
  const primary = repository()
  const decoy = repository()
  const head = git(['rev-parse', 'HEAD'], primary)
  const policy = policyFor(primary)
  const previous = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE }
  let prepared
  try {
    process.env.GIT_DIR = join(decoy, '.git')
    process.env.GIT_WORK_TREE = decoy
    const port = adapter.createWorktreePort({ policy, repository: primary })
    prepared = await port.prepare(request(head), meta())
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }

  assert.equal(prepared.ok, true, `prepare failed: ${JSON.stringify(prepared.error)}`)
  assert.equal(prepared.value.baseSha, head, 'the base must come from the repository the port was given')
  // The worktree landed in the primary repository and nowhere else: without the
  // cleaned environment git would have answered about the decoy.
  assert.ok(git(['worktree', 'list', '--porcelain'], primary).includes(prepared.value.path.replace(/\\/g, '/')))
  const decoyList = git(['worktree', 'list', '--porcelain'], decoy)
  assert.equal(decoyList.includes(prepared.value.path.replace(/\\/g, '/')), false, 'the decoy must not own the worktree')
  assert.equal(decoyList.split('worktree ').length - 1, 1, `the decoy must keep only its own checkout:\n${decoyList}`)
  assert.equal(git(['branch', '--list', '--format=%(refname:short)'], decoy), 'main')
})

test('a malformed policy or request is refused before any git process runs', async () => {
  const repo = repository()
  const head = git(['rev-parse', 'HEAD'], repo)
  for (const policy of [
    policyFor(repo, { root: '  ' }),
    policyFor(repo, { branchPrefix: 'my work/' }),
    policyFor(repo, { retentionMs: -1 }),
    policyFor(repo, { keepDirty: false }),
  ]) {
    assert.throws(
      () => adapter.createWorktreePort({ policy, repository: repo }),
      error => error.code === 'invalid-input',
      `policy ${JSON.stringify(policy)} must be refused when the port is built`,
    )
  }
  const port = adapter.createWorktreePort({ policy: policyFor(repo), repository: repo })
  for (const bad of [request('abc'), request(head, { attemptId: '' }), request(head.toUpperCase())]) {
    // `prepare` is asynchronous, so a refusal of malformed input arrives as a
    // rejected promise rather than as a synchronous throw.
    await assert.rejects(
      () => port.prepare(bad, meta()),
      error => error.code === 'invalid-input',
      `request ${JSON.stringify(bad)} must be refused`,
    )
  }
  assert.equal(existsSync(policyFor(repo).root), false, 'a refused request must not create the policy root')
  assert.equal(git(['worktree', 'list', '--porcelain'], repo).split('worktree ').length - 1, 1)
})

test('two attempts get their own checkouts, and the shared one is never written', async () => {
  const repo = repository()
  const head = git(['rev-parse', 'HEAD'], repo)
  // The worktrees live outside the shared checkout, as they do in a deployment.
  // A policy root inside it would make the shared `git status` report the
  // worktrees directory itself, and "the shared checkout is not written" is
  // exactly the property under test — the fixture must not blur it.
  const policy = policyFor(repo, { root: join(tempDir(), 'worktrees') })
  const port = adapter.createWorktreePort({ policy, repository: repo })
  const [first, second] = await Promise.all([
    port.prepare(request(head, { attemptId: 'A-1' }), meta()),
    port.prepare(request(head, { attemptId: 'A-2', taskId: 'T-2' }), meta({ operationId: 'op-2' })),
  ])
  assert.equal(first.ok, true, `first prepare failed: ${JSON.stringify(first.error)}`)
  assert.equal(second.ok, true, `second prepare failed: ${JSON.stringify(second.error)}`)

  // Two attempts, two directories, two branches — the criterion of §19 (а).
  assert.notEqual(first.value.path, second.value.path, 'two attempts must not share a checkout')
  assert.notEqual(first.value.branch, second.value.branch)
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], first.value.path), first.value.branch)
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], second.value.path), second.value.branch)

  // Work written in one attempt is invisible to the other and to the shared
  // checkout (§19 (б)).
  writeFileSync(join(first.value.path, 'attempt-a.txt'), 'work of A\n')
  assert.equal(existsSync(join(second.value.path, 'attempt-a.txt')), false, 'B must not see the work of A')
  assert.equal(existsSync(join(repo, 'attempt-a.txt')), false, 'the shared checkout must not see it either')

  // And the shared checkout is untouched: clean, still on the branch and the
  // commit the worktrees were cut from (§19 (г)).
  assert.equal(git(['status', '--porcelain'], repo), '', 'the shared checkout must stay clean')
  assert.equal(git(['rev-parse', 'HEAD'], repo), head, 'the shared head must not move')
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], repo), 'main')
  const listed = git(['worktree', 'list', '--porcelain'], repo)
  assert.equal(listed.split('worktree ').length - 1, 3, `expected the shared checkout and two worktrees:\n${listed}`)
})

test('cleanup removes a clean worktree once, and a repeated cleanup is not an error', async () => {
  const repo = repository()
  const head = git(['rev-parse', 'HEAD'], repo)
  const policy = policyFor(repo)
  const port = adapter.createWorktreePort({ policy, repository: repo })
  const prepared = await port.prepare(request(head), meta())
  assert.equal(prepared.ok, true, `prepare failed: ${JSON.stringify(prepared.error)}`)
  const path = prepared.value.path

  // §19 (а) of E-06: a clean worktree is removed, and the shared repository
  // forgets the entry rather than keeping a stale one.
  const removed = await port.cleanup('A-1', meta({ operationId: 'op-2' }))
  assert.equal(removed.ok, true, `cleanup failed: ${JSON.stringify(removed.error)}`)
  assert.equal(removed.value, 'removed')
  assert.equal(existsSync(path), false, 'a clean worktree is removed')
  assert.equal(
    git(['worktree', 'list', '--porcelain'], repo).includes(path.replace(/\\/g, '/')),
    false,
    'the registration must disappear from the shared repository',
  )
  assert.equal(git(['worktree', 'list', '--porcelain'], repo).split('worktree ').length - 1, 1)

  // §19 (д) of E-06: the second call has nothing left to remove and says so
  // instead of failing with WORKTREE_MISSING.
  const again = await port.cleanup('A-1', meta({ operationId: 'op-3' }))
  assert.equal(again.ok, true, `a repeated cleanup must not fail: ${JSON.stringify(again.error)}`)
  assert.equal(again.value, 'removed')
})

test('cleanup keeps an orphan directory and refuses a foreign worktree', async () => {
  const repo = repository()
  const head = git(['rev-parse', 'HEAD'], repo)
  const policy = policyFor(repo)

  // §19 (в) of E-06: a directory this policy named but no registration claims is
  // work whose owner was lost, and it is kept rather than deleted.
  const orphan = join(policy.root, 'mywork-T-1-A-1')
  mkdirSync(orphan, { recursive: true })
  const orphanFile = join(orphan, 'unfinished.txt')
  writeFileSync(orphanFile, 'work whose owner was lost\n')
  const bare = adapter.createWorktreePort({ policy, repository: repo })
  const kept = await bare.cleanup('A-1', meta({ operationId: 'op-2' }))
  assert.equal(kept.ok, true, `cleanup failed: ${JSON.stringify(kept.error)}`)
  assert.equal(kept.value, 'kept-orphan')
  assert.equal(existsSync(orphanFile), true, 'the orphan work must survive')

  // §19 (г) of E-06: a registration whose path leaves the policy root, and one
  // whose branch this policy did not name, are somebody else's directories. Both
  // are refused, and both stay on disk — the positive control is the clean
  // removal above, so these refusals are about ownership and not about refusing
  // every cleanup.
  const outsidePath = join(tempDir(), 'not-ours')
  mkdirSync(outsidePath, { recursive: true })
  writeFileSync(join(outsidePath, 'keep-me.txt'), 'not a MyWork worktree\n')
  const foreignBranchPath = join(policy.root, 'mywork-T-3-A-3')
  mkdirSync(foreignBranchPath, { recursive: true })
  writeFileSync(join(foreignBranchPath, 'keep-me-too.txt'), 'not this policy branch\n')
  const registry = adapter.createWorktreeRegistry([
    { attemptId: 'A-2', workspaceId: 'W-1', taskId: 'T-2', path: outsidePath, branch: 'mywork/T-2-A-2', baseSha: head },
    { attemptId: 'A-3', workspaceId: 'W-1', taskId: 'T-3', path: foreignBranchPath, branch: 'someone-else/T-3-A-3', baseSha: head },
  ])
  const guarded = adapter.createWorktreePort({ policy, repository: repo, registry })
  for (const [attemptId, path, why] of [
    ['A-2', outsidePath, 'a path outside the policy root'],
    ['A-3', foreignBranchPath, 'a branch this policy did not name'],
  ]) {
    const cleaned = await guarded.cleanup(attemptId, meta({ operationId: `op-${attemptId}` }))
    assert.equal(cleaned.ok, false, `${why}: cleanup must refuse`)
    assert.equal(refusalOf(cleaned), 'WORKTREE_FOREIGN', `${why}: wrong refusal`)
    assert.equal(existsSync(path), true, `${why}: the directory must survive`)
  }
  assert.equal(existsSync(join(outsidePath, 'keep-me.txt')), true)
  assert.equal(existsSync(join(foreignBranchPath, 'keep-me-too.txt')), true)
})

test('list answers only with the worktrees this policy created', async () => {
  const repo = repository()
  const head = git(['rev-parse', 'HEAD'], repo)
  const policy = policyFor(repo)
  const mine = {
    attemptId: 'A-1',
    workspaceId: 'W-1',
    taskId: 'T-1',
    path: join(policy.root, 'mywork-T-1-A-1'),
    branch: 'mywork/T-1-A-1',
    baseSha: head,
  }
  const otherBranch = {
    attemptId: 'A-2',
    workspaceId: 'W-1',
    taskId: 'T-2',
    path: join(policy.root, 'other-T-2-A-2'),
    branch: 'other/T-2-A-2',
    baseSha: head,
  }
  const outside = {
    attemptId: 'A-3',
    workspaceId: 'W-1',
    taskId: 'T-3',
    path: join(tempDir(), 'elsewhere'),
    branch: 'mywork/T-3-A-3',
    baseSha: head,
  }
  const otherWorkspace = {
    attemptId: 'A-4',
    workspaceId: 'W-2',
    taskId: 'T-4',
    path: join(policy.root, 'mywork-T-4-A-4'),
    branch: 'mywork/T-4-A-4',
    baseSha: head,
  }
  const port = adapter.createWorktreePort({
    policy,
    repository: repo,
    registry: adapter.createWorktreeRegistry([mine, otherBranch, outside, otherWorkspace]),
  })

  // §19 (е) of E-06: a cleanup sweep must be safe to run over this answer, so a
  // worktree of another branch, one outside the root, and one of another
  // workspace are all absent from it.
  const listed = await port.list('W-1', meta())
  assert.equal(listed.ok, true, `list failed: ${JSON.stringify(listed.error)}`)
  assert.deepEqual(listed.value.map(record => record.attemptId), ['A-1'])
  assert.deepEqual(listed.value[0], mine)
  assert.deepEqual((await port.list('W-2', meta())).value.map(record => record.attemptId), ['A-4'])
  assert.deepEqual((await port.list('W-9', meta())).value, [])
})
