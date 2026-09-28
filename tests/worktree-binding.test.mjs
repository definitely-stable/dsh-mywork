/**
 * The attempt↔worktree binding in the claim saga (MW-021, E-04; architecture §9,
 * §17, §19, §49).
 *
 * What has to hold: every isolated attempt gets a durable row naming the checkout
 * it works in and the base commit it was cut from; the base is read **before** the
 * checkout is created; a port that refuses leaves no attempt behind and no second
 * row; a crash between the two transactions leaves exactly one attempt and no
 * binding, and neither a repeated claim nor a recovery creates a second one.
 *
 * Two things about this suite are deliberate. The migration version is **read from
 * the allocator**, never written here — a hand-typed number is the defect the
 * allocator exists to remove (F-63, §15.3). And the port and the git reader are
 * fakes, so the suite proves the saga's ordering and its durability without
 * spawning a process; the real adapter is exercised by
 * `tests/worktree-adapter.test.mjs`.
 *
 * The last test is the exception to that rule, and deliberately so: "parallel
 * attempts do not write to the shared checkout" is a statement about two real
 * checkouts, so it runs the real adapter against a real repository with the saga
 * on top. Everything else here is fakes.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root, derived here so this suite needs no shared fixture module. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * One built package, loaded from its bundle.
 * @param name - package directory under `packages/`.
 */
async function built(name) {
  return import(pathToFileURL(join(repoRoot, 'packages', name, 'lib', 'index.js')).href)
}

const adapter = await built('worktree-adapter')
const contracts = await built('contracts')
const core = await built('core')
const evidence = await built('evidence')
const execution = await built('execution')
const lease = await built('lease')
const planner = await built('planner')
const storage = await built('storage')

// The allocator is the composition layer's module, so it is imported from its
// source, type-only imports and all — the same way
// `tests/storage/migration-allocator.test.mjs` reaches it.
const allocatorModule = await import(
  pathToFileURL(join(repoRoot, 'packages', 'controller', 'src', 'migration-allocator.ts')).href
)

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-binding-'

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  tempDirs.push(dir)
  return dir
}

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

/** A clock the suite advances by hand. */
function fakeClock(start = 1_000) {
  let value = start
  return {
    now: () => value,
    advance(by = 1_000) {
      value += by
      return value
    },
  }
}

/** Operation identity for one call. */
function meta(overrides = {}) {
  return core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1', controllerEpoch: 3, ...overrides })
}

/**
 * A deterministic `TaskGraphPort` for the claim path.
 *
 * It records every call and keeps the assignee, which is what the saga's
 * projection and its recovery both read back.
 */
function fakeGraph() {
  const tasks = new Map()
  const calls = []
  return {
    tasks,
    calls,
    addTask(id, state = 'ready') {
      tasks.set(id, { id, workspaceId: 'W-1', title: id, description: '', state, revision: 1, dependsOn: [] })
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
      claim: async command => {
        calls.push(`claim:${command.id}`)
        const task = tasks.get(command.id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${command.id}"`)
        if (task.assignee !== undefined && task.assignee !== command.claimant) {
          return Object.freeze({ won: false, holder: task.assignee })
        }
        task.assignee = command.claimant
        return Object.freeze({ won: true, task: Object.freeze({ ...task }) })
      },
      transition: async command => {
        calls.push(`transition:${command.id}->${command.to}`)
        const task = tasks.get(command.id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${command.id}"`)
        if (!core.canTransitionTask(task.state, command.to)) {
          throw new core.MyWorkError('TASK_CONFLICT', `illegal transition ${task.state} → ${command.to}`)
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

/**
 * A fake worktree port and git reader that record the order they were called in.
 *
 * The order is the point of test (д): §19 requires the base commit to be pinned
 * before the checkout exists, and only a shared call log can show it.
 * @param options - the head to report, a refusal to answer with, or an error to throw.
 */
function fakeIsolation(options = {}) {
  const calls = []
  const head = options.head ?? 'a'.repeat(40)
  const root = options.root ?? tempDirs[0]
  return {
    calls,
    git: {
      async resolveHead(cwd, callMeta) {
        calls.push({ kind: 'resolveHead', cwd })
        if (options.headFailure !== undefined) return core.fail(options.headFailure, callMeta)
        return core.ok(head, callMeta)
      },
      async diffHash() {
        throw new Error('the saga must not compute a diff hash')
      },
      async isClean() {
        throw new Error('the saga must not read cleanliness')
      },
      async commit() {
        throw new Error('the saga must not commit')
      },
      async land() {
        throw new Error('the saga must not land anything')
      },
      async abortLanding() {
        throw new Error('the saga must not abort a landing')
      },
    },
    port: {
      async prepare(request, callMeta) {
        calls.push({ kind: 'prepare', request })
        if (options.throwOnPrepare !== undefined) throw options.throwOnPrepare
        if (options.refusal !== undefined) {
          return core.fail(
            new core.MyWorkError(contracts.WORKTREE_REFUSAL_CODES[options.refusal], `refused: ${options.refusal}`, {
              details: { refusal: options.refusal },
            }),
            callMeta,
          )
        }
        return core.ok(
          Object.freeze({
            attemptId: request.attemptId,
            workspaceId: request.workspaceId,
            taskId: request.taskId,
            path: join(root, `mywork-${request.taskId}-${request.attemptId}`),
            branch: `mywork/${request.taskId}-${request.attemptId}`,
            baseSha: request.baseSha,
          }),
          callMeta,
        )
      },
      async resolve() {
        throw new Error('the saga must not resolve a worktree')
      },
      async cleanup() {
        throw new Error('the saga must not clean up a worktree')
      },
      async list() {
        throw new Error('the saga must not list worktrees')
      },
    },
  }
}

/**
 * Open a controller database whose binding table carries an **allocated** version.
 *
 * The version comes from the single allocator (D08) over a first open, exactly as
 * the composition root does it; the store is then reopened with that migration in
 * the set. No number is written in this file.
 */
async function openBoundDatabase(clock) {
  const path = join(tempDir(), 'controller.sqlite')
  // The canonical set of the composition root, minus nothing: `canonicalMigrations`
  // refuses a gap, so every layer's list is present and the allocated number is
  // the next free version of the whole set.
  const base = [
    ...storage.MYWORK_MIGRATIONS,
    ...evidence.EVIDENCE_MIGRATIONS,
    ...lease.LEASE_MIGRATIONS,
    ...planner.PLAN_MUTATION_MIGRATIONS,
    ...execution.CLAIM_SAGA_MIGRATIONS,
  ]
  const before = await storage.openStore({ path, migrations: base, clock: { now: () => clock.now() } })
  let version
  try {
    version = allocatorModule.createMigrationAllocator(before).allocate({ key: 'attempt-worktree' })
  } finally {
    before.close()
  }
  const migrations = storage.canonicalMigrations([base, [execution.createAttemptWorktreeMigration(version)]])
  const store = await storage.openStore({ path, migrations, clock: { now: () => clock.now() } })
  return { store, version }
}

/** The claim command of one task. */
function claimCommand(taskId, overrides = {}) {
  return {
    taskId,
    workspaceId: 'W-1',
    claimant: 'worker-1',
    agentId: 'Neo-1',
    expectedRevision: 1,
    leaseMs: 60_000,
    meta: meta(),
    ...overrides,
  }
}

/** Every attempt row of the database. */
function attempts(store) {
  return store.transaction(tx => execution.listLiveAttempts(tx))
}

/** Every binding row of the database. */
function bindings(store) {
  return store.transaction(tx => execution.listAttemptWorktrees(tx))
}

test('an isolated claim binds the attempt to the pinned base, and a saga without a port does not', async () => {
  const clock = fakeClock()
  const { store, version } = await openBoundDatabase(clock)
  try {
    // The schema is the one the allocator numbered, not a number written here.
    assert.equal(store.transaction(tx => Number(tx.get('PRAGMA user_version').user_version)), version)
    const graph = fakeGraph().addTask('T-1').addTask('T-2')
    const isolation = fakeIsolation()
    const saga = execution.createClaimSaga({ store, graph: graph.port, clock, worktrees: isolation.port, repository: 'C:\\ws', git: isolation.git })
    const claimed = await saga.claim(claimCommand('T-1'))
    assert.equal(claimed.ok, true, `claim failed: ${JSON.stringify(claimed.error)}`)

    const rows = bindings(store)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].attemptId, claimed.value.attemptId)
    assert.equal(rows[0].baseSha, 'a'.repeat(40), 'the binding must carry the base the port was asked for')
    assert.equal(rows[0].baseSha, isolation.calls.find(call => call.kind === 'prepare').request.baseSha)
    assert.equal(rows[0].path, join(tempDirs[0], `mywork-T-1-${claimed.value.attemptId}`))
    assert.equal(rows[0].headSha, undefined, 'a live attempt has no head yet')

    // Risk (1) of E-04: the port is optional, and a saga without one must behave
    // exactly as it did before worktree isolation existed.
    const plain = execution.createClaimSaga({ store, graph: graph.port, clock })
    const unisolated = await plain.claim(claimCommand('T-2', { meta: meta({ operationId: 'op-2' }) }))
    assert.equal(unisolated.ok, true, `claim without a port failed: ${JSON.stringify(unisolated.error)}`)
    assert.equal(bindings(store).length, 1, 'a saga without a port must not create a binding')
    assert.equal(attempts(store).length, 2)
  } finally {
    store.close()
  }
})

test('the head is written only when the binding settles', async () => {
  const clock = fakeClock()
  const { store } = await openBoundDatabase(clock)
  try {
    const graph = fakeGraph().addTask('T-1')
    const isolation = fakeIsolation()
    const saga = execution.createClaimSaga({ store, graph: graph.port, clock, worktrees: isolation.port, repository: 'C:\\ws', git: isolation.git })
    const claimed = await saga.claim(claimCommand('T-1'))
    const attemptId = claimed.value.attemptId
    assert.equal(store.transaction(tx => execution.readAttemptWorktree(tx, attemptId)).headSha, undefined)

    const head = 'b'.repeat(40)
    const at = clock.advance()
    assert.equal(store.transaction(tx => execution.settleAttemptWorktree(tx, attemptId, head, at)), true)
    const settled = store.transaction(tx => execution.readAttemptWorktree(tx, attemptId))
    assert.equal(settled.headSha, head)
    assert.equal(settled.settledAt, at)
    // A second settlement changes nothing: the head of a settled attempt is a
    // recorded fact, not a value a later caller may overwrite.
    assert.equal(store.transaction(tx => execution.settleAttemptWorktree(tx, attemptId, 'c'.repeat(40), at)), false)
    assert.equal(store.transaction(tx => execution.readAttemptWorktree(tx, attemptId)).headSha, head)
  } finally {
    store.close()
  }
})

test('a port that refuses an empty repository abandons the claim without an attempt', async () => {
  const clock = fakeClock()
  const { store } = await openBoundDatabase(clock)
  try {
    const graph = fakeGraph().addTask('T-1')
    const isolation = fakeIsolation({
      headFailure: new core.MyWorkError('TASK_CONFLICT', 'dsh-mywork: the repository has no commit', {
        details: { reason: 'no-head' },
      }),
      // The saga must not even ask for a checkout once the precondition failed.
      refusal: 'EMPTY_REPOSITORY',
    })
    const saga = execution.createClaimSaga({ store, graph: graph.port, clock, worktrees: isolation.port, repository: 'C:\\ws', git: isolation.git })
    const claimed = await saga.claim(claimCommand('T-1'))

    assert.equal(claimed.ok, false)
    assert.equal(claimed.error.code, 'TASK_CONFLICT')
    assert.equal(claimed.error.details.refusal, 'EMPTY_REPOSITORY')
    assert.equal(claimed.error.details.reason, 'worktree-precondition')
    assert.equal(attempts(store).length, 0, 'a refused precondition must not leave an attempt')
    assert.equal(bindings(store).length, 0)
    assert.equal(isolation.calls.filter(call => call.kind === 'prepare').length, 0)
    const intent = store.transaction(tx => execution.readIntent(tx, 'op-1'))
    assert.equal(intent.state, 'abandoned')
    assert.match(intent.failure, /no commit/)
    const steps = store.transaction(tx => execution.readSteps(tx, 'op-1'))
    assert.equal(steps.find(step => step.kind === 'attempt').state, 'failed')
  } finally {
    store.close()
  }
})

test('a repeated claim with the same operation id adds no second binding', async () => {
  const clock = fakeClock()
  const { store } = await openBoundDatabase(clock)
  try {
    const graph = fakeGraph().addTask('T-1')
    const isolation = fakeIsolation()
    const saga = execution.createClaimSaga({ store, graph: graph.port, clock, worktrees: isolation.port, repository: 'C:\\ws', git: isolation.git })
    const first = await saga.claim(claimCommand('T-1'))
    assert.equal(first.ok, true)
    const again = await saga.claim(claimCommand('T-1'))

    assert.equal(again.ok, true, 'a settled saga answers with what it recorded')
    assert.equal(again.value.operationId, first.value.operationId)
    assert.equal(again.value.attemptId, first.value.attemptId)
    assert.equal(bindings(store).length, 1, 'the same operation must not create a second worktree row')
    assert.equal(attempts(store).length, 1)
    assert.equal(isolation.calls.filter(call => call.kind === 'prepare').length, 1)
  } finally {
    store.close()
  }
})

test('the base commit is read before the checkout is created', async () => {
  const clock = fakeClock()
  const { store } = await openBoundDatabase(clock)
  try {
    const graph = fakeGraph().addTask('T-1')
    const isolation = fakeIsolation({ head: 'd'.repeat(40) })
    const saga = execution.createClaimSaga({ store, graph: graph.port, clock, worktrees: isolation.port, repository: 'C:\\ws', git: isolation.git })
    const claimed = await saga.claim(claimCommand('T-1'))
    assert.equal(claimed.ok, true)

    assert.deepEqual(
      isolation.calls.map(call => call.kind),
      ['resolveHead', 'prepare'],
      'the base must be pinned before anything is created',
    )
    assert.equal(isolation.calls[0].cwd, 'C:\\ws', 'the base is read from the shared checkout')
    assert.equal(isolation.calls[1].request.baseSha, 'd'.repeat(40))
    assert.equal(bindings(store)[0].baseSha, 'd'.repeat(40))
  } finally {
    store.close()
  }
})

test('a crash between the transactions leaves one attempt, no binding, and no second attempt', async () => {
  const clock = fakeClock()
  const { store } = await openBoundDatabase(clock)
  try {
    const graph = fakeGraph().addTask('T-1')
    // The crash stands in for a process that died between the two transactions:
    // the attempt is committed, the checkout may or may not exist, and the
    // binding row was never written.
    const isolation = fakeIsolation({ throwOnPrepare: new Error('the worker process died') })
    const saga = execution.createClaimSaga({ store, graph: graph.port, clock, worktrees: isolation.port, repository: 'C:\\ws', git: isolation.git })
    await assert.rejects(() => saga.claim(claimCommand('T-1')), /the worker process died/)

    assert.equal(attempts(store).length, 1, 'the durable intent of §9 is the attempt itself')
    assert.equal(bindings(store).length, 0)
    const intent = store.transaction(tx => execution.readIntent(tx, 'op-1'))
    assert.equal(intent.state, 'attempted')

    // A repeated claim is refused instead of re-running the saga, and it adds no
    // second attempt: this is the window §49 hands to a reconciler, not to a retry.
    const repeated = await saga.claim(claimCommand('T-1'))
    assert.equal(repeated.ok, false)
    assert.equal(repeated.error.code, 'TASK_CONFLICT')
    assert.equal(attempts(store).length, 1)
    assert.equal(bindings(store).length, 0)

    const recovered = await saga.recover({
      operationId: 'op-1',
      action: 'recover',
      decision: { decidedBy: 'operator', at: clock.advance(), reason: 'finish the saga the crash left open' },
    })
    assert.equal(recovered.ok, true, `recover failed: ${JSON.stringify(recovered.error)}`)
    assert.equal(recovered.value.state, 'recovered')
    assert.equal(attempts(store).length, 1, 'a recovery must not create a second attempt')
    assert.equal(bindings(store).length, 0)
  } finally {
    store.close()
  }
})

test('an asynchronous transaction body is refused, so a git process cannot run inside one', async () => {
  const clock = fakeClock()
  const { store } = await openBoundDatabase(clock)
  try {
    // The negative control of the design: `prepare` is asynchronous and the saga
    // calls it between two synchronous transactions, because the store refuses an
    // async body — it would commit before its work finished.
    assert.throws(
      () => store.transaction(async () => 1),
      error => error.code === 'invalid-input'
        && /a transaction body must be synchronous/.test(error.message)
        && /would commit before its work finished/.test(error.message),
    )
    // Positive control: the same call with a synchronous body commits, so the
    // refusal above is about the body's shape and not about the store refusing
    // everything.
    assert.equal(store.transaction(() => 1), 1)
    assert.equal(store.transaction(tx => tx.get('SELECT 1 AS one').one), 1)
  } finally {
    store.close()
  }
})

/** Run one git command in a directory and require it to succeed. */
function gitIn(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, windowsHide: true })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed in ${cwd}: ${result.stderr}`)
  return result.stdout.trim()
}

/** One real repository with an identity and one commit, for the isolation test. */
function realRepository() {
  const dir = tempDir()
  gitIn(dir, ['init', '-q', '-b', 'main'])
  gitIn(dir, ['config', 'user.email', 'mywork-tests@example.invalid'])
  gitIn(dir, ['config', 'user.name', 'MyWork Tests'])
  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  gitIn(dir, ['add', '--', 'README.md'])
  gitIn(dir, ['commit', '-q', '-m', 'fixture: initial commit'])
  return dir
}

test('two isolated claims never share a checkout, and the shared one stays clean', async () => {
  const clock = fakeClock()
  const { store } = await openBoundDatabase(clock)
  const repository = realRepository()
  try {
    const head = gitIn(repository, ['rev-parse', 'HEAD'])
    // The worktrees live outside the shared checkout, as they do in a deployment:
    // a policy root inside it would make the shared `git status` report the
    // worktrees directory, which is the property this test is about.
    const policy = {
      root: join(tempDir(), 'worktrees'),
      branchPrefix: 'mywork/',
      retentionMs: 7 * 24 * 3600 * 1000,
      keepDirty: true,
    }
    const worktrees = adapter.createWorktreePort({ policy, repository })
    const graph = fakeGraph().addTask('T-1').addTask('T-2')
    const saga = execution.createClaimSaga({
      store,
      graph: graph.port,
      clock,
      worktrees,
      repository,
      git: adapter.createGitPort(),
    })

    // The criterion is about two attempts at once, so the two claims run together
    // rather than one after the other.
    const [first, second] = await Promise.all([
      saga.claim(claimCommand('T-1')),
      saga.claim(claimCommand('T-2', { meta: meta({ operationId: 'op-2' }) })),
    ])
    assert.equal(first.ok, true, `first claim failed: ${JSON.stringify(first.error)}`)
    assert.equal(second.ok, true, `second claim failed: ${JSON.stringify(second.error)}`)

    const rows = bindings(store)
    assert.equal(rows.length, 2, 'each attempt gets its own binding')
    assert.equal(new Set(rows.map(row => row.path)).size, 2, 'two attempts must not share a checkout')
    assert.equal(new Set(rows.map(row => row.branch)).size, 2)
    for (const row of rows) {
      assert.ok(row.path.startsWith(policy.root), `"${row.path}" must be inside the policy root`)
      assert.equal(existsSync(row.path), true, 'the bound checkout must exist')
      assert.equal(row.baseSha, head, 'both attempts are cut from the same pinned base')
      assert.equal(gitIn(row.path, ['rev-parse', 'HEAD']), head, 'the checkout starts at the base')
    }

    // Work written in one attempt is invisible to the other and to the shared
    // checkout, and the shared checkout is left exactly as it was.
    writeFileSync(join(rows[0].path, 'attempt-work.txt'), 'work in progress\n')
    assert.equal(existsSync(join(rows[1].path, 'attempt-work.txt')), false, 'the second attempt must not see it')
    assert.equal(existsSync(join(repository, 'attempt-work.txt')), false, 'the shared checkout must not see it')
    assert.equal(gitIn(repository, ['status', '--porcelain']), '', 'the shared checkout must stay clean')
    assert.equal(gitIn(repository, ['rev-parse', 'HEAD']), head, 'the shared head must not move')
    assert.equal(gitIn(repository, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main')
  } finally {
    store.close()
  }
})
