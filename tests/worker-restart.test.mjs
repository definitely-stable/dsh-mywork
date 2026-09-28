/**
 * Restart and late callbacks do not create a second authoritative attempt
 * (architecture §17, §19, §22, §36, §39; MW-022, E-11).
 *
 * Two processes are involved in a restart, so the tests here are built the way
 * the platform is: the durable facts live in the database, a second worker object
 * over the same database *is* the rebuilt process, and the crash child is a real
 * process that dies between §19's worktree and §22's session. What is asserted is
 * what the world shows afterwards — one attempt row, one worktree row, one
 * session, and a `STALE_FENCE` for a result that arrives too late.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { adapterTesting, contracts, core, evidence, execution, lease, repoRoot, storage } from './lib/fixtures.mjs'
import { runCaptured } from '../scripts/lib/process.mjs'

const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-worker-restart-'

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

/** Operation identity for one call. */
function meta(overrides = {}) {
  return core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1', controllerEpoch: 3, ...overrides })
}

/**
 * The durable worktree binding (`E-04`).
 *
 * The test writes it the way the claim saga does once that step lands, so the
 * parent of the crash child resolves the attempt's worktree from the database
 * rather than from the memory of a process that is gone.
 */
const WORKTREE_DDL = `CREATE TABLE IF NOT EXISTS attempt_worktree (
  attempt_id TEXT PRIMARY KEY REFERENCES attempt(attempt_id),
  path       TEXT NOT NULL,
  branch     TEXT NOT NULL,
  base_sha   TEXT NOT NULL CHECK(length(base_sha) = 40),
  head_sha   TEXT,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
)`

/** Store one attempt's worktree registration. */
function recordWorktree(store, registration, at) {
  store.transaction(tx => {
    tx.exec(WORKTREE_DDL)
    tx.run(
      `INSERT INTO attempt_worktree (attempt_id, path, branch, base_sha, head_sha, created_at, settled_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      registration.attemptId,
      registration.path,
      registration.branch,
      registration.baseSha,
      registration.headSha ?? null,
      at,
    )
  })
}

/** Read one attempt's worktree registration, if it is durable. */
function readWorktree(store, attemptId) {
  const row = store.transaction(tx => {
    const exists = tx.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attempt_worktree'")
    if (exists === undefined) return undefined
    return tx.get('SELECT * FROM attempt_worktree WHERE attempt_id = ?', attemptId)
  })
  if (row === undefined) return undefined
  return Object.freeze({
    attemptId: row.attempt_id,
    workspaceId: 'W-1',
    taskId: 'T-1',
    path: row.path,
    branch: row.branch,
    baseSha: row.base_sha,
    ...(row.head_sha === null ? {} : { headSha: row.head_sha }),
  })
}

/** How many rows one table holds, read straight from the database. */
function countRows(store, table) {
  return store.transaction(tx => Number(tx.get(`SELECT COUNT(*) AS n FROM ${table}`).n))
}

/** Open a temporary controller database carrying every schema the worker writes through. */
async function openWorkerDatabase(clock, path = join(tempDir(), 'controller.sqlite')) {
  return storage.openStore({
    path,
    migrations: [
      ...storage.MYWORK_MIGRATIONS,
      ...evidence.EVIDENCE_MIGRATIONS,
      ...lease.LEASE_MIGRATIONS,
      ...execution.CLAIM_SAGA_MIGRATIONS,
    ],
    clock: { now: () => clock.now() },
  })
}

/** A `TaskGraphPort` fake that claims and projects one task. */
function fakeGraph() {
  const tasks = new Map([
    ['T-1', { id: 'T-1', workspaceId: 'W-1', title: 'T-1', description: '', state: 'ready', revision: 1, dependsOn: [] }],
  ])
  return {
    tasks,
    port: {
      capabilities: async () => ({ adapterId: 'fake', contractVersion: 'taskgraph/v1', capabilities: {}, source: 'declared' }),
      get: async id => Object.freeze({ ...tasks.get(id) }),
      ready: async () => [],
      blocked: async () => [],
      claim: async command => {
        const task = tasks.get(command.id)
        task.assignee = command.claimant
        return Object.freeze({ won: true, task: Object.freeze({ ...task }) })
      },
      transition: async command => {
        const task = tasks.get(command.id)
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

/** A `WorktreePort` fake whose registrations are durable rows, not memory. */
function fakeWorktrees(store, journal) {
  return {
    port: {
      prepare: async (request, callMeta) => {
        journal.push('prepare')
        const registration = Object.freeze({
          attemptId: request.attemptId,
          workspaceId: request.workspaceId,
          taskId: request.taskId,
          path: join('C:/worktrees', request.attemptId),
          branch: `mywork/${request.taskId}-${request.attemptId}`,
          baseSha: request.baseSha,
        })
        recordWorktree(store, registration, 1_000)
        return core.ok(registration, callMeta)
      },
      resolve: async (attemptId, callMeta) => {
        journal.push('resolve')
        const registration = readWorktree(store, attemptId)
        if (registration === undefined) {
          return core.fail(
            new core.MyWorkError('TASK_CONFLICT', `dsh-mywork: attempt "${attemptId}" has no worktree`, {
              details: { refusal: 'WORKTREE_MISSING', attemptId },
            }),
            callMeta,
          )
        }
        return core.ok(registration, callMeta)
      },
      cleanup: async (attemptId, callMeta) => core.ok(Object.freeze({ outcome: 'kept-orphan' }), callMeta),
      list: async (workspaceId, callMeta) => core.ok(Object.freeze([]), callMeta),
    },
  }
}

/** An `AttemptContextPort` fake: deterministic for one attempt, as §35 requires. */
function fakeContext(journal) {
  return {
    port: {
      materialize: async (request, callMeta) => {
        journal.push('materialize')
        return core.ok(
          Object.freeze({
            revision: 1,
            attemptId: request.attemptId,
            taskId: request.taskId,
            workspaceId: request.workspaceId,
            createdAt: 1_000,
            revisions: { task: 1, role: 4, blueprint: 17, workflow: 1 },
            skillRevisions: {},
            modelRoute: { provider: 'deepseek', model: 'flash' },
            modelRouteRole: 'primary',
            contextWindow: 128_000,
            toolSurface: ['shell'],
            budget: {},
            items: [],
            contentHashes: {},
            tokenEstimates: { prompt: 0, context: 0, total: 0 },
            dropped: [],
            provenance: [],
            fingerprint: `fp-${request.attemptId}`,
          }),
          callMeta,
        )
      },
    },
  }
}

/**
 * An `AttemptRunPort` fake whose sessions live in a map the caller owns.
 *
 * Sharing that map between two runtime objects is what makes an in-process
 * restart faithful: the session identity is durable in the owner, and a rebuilt
 * process finds it there instead of in its own memory (§22).
 */
function fakeRuntime(sessions, journal, options = {}) {
  const requests = []
  const resumes = []
  const pins = new Map()
  let sessionSeq = 0
  return {
    requests,
    resumes,
    pins,
    port: {
      run: async (request, callMeta, callOptions) => {
        journal.push('start')
        requests.push(request)
        if (sessions.has(request.runId)) {
          return core.fail(
            new core.MyWorkError('TASK_CONFLICT', `dsh-mywork: run "${request.runId}" was already started`, {
              details: { runId: request.runId, reason: 'run-already-started' },
            }),
            callMeta,
          )
        }
        sessionSeq += 1
        const sessionId = `session-fake-${sessions.size + sessionSeq}`
        sessions.set(request.runId, sessionId)
        if (options.gate !== undefined) await options.gate
        return core.ok(
          Object.freeze({
            runId: request.runId,
            attemptId: request.attemptId,
            outcome: 'completed',
            sessionId,
            artifactRefs: [],
          }),
          callMeta,
        )
      },
      resume: async (request, callMeta) => {
        journal.push('resume')
        resumes.push(request)
        const sessionId = sessions.get(request.runId)
        if (sessionId === undefined || sessionId !== request.sessionId) {
          return core.fail(
            new core.MyWorkError('SESSION_NOT_FOUND', `dsh-mywork: no session "${request.sessionId}"`, {
              details: { runId: request.runId, sessionId: request.sessionId },
            }),
            callMeta,
          )
        }
        // The scope is re-asserted on the adopted session; the fake records the
        // pins so "the preset survived the restart" is observable.
        const recorded = pins.get(sessionId) ?? []
        recorded.push(`preset:${request.scope?.agentPreset}`)
        pins.set(sessionId, recorded)
        return core.ok(
          Object.freeze({
            runId: request.runId,
            attemptId: request.attemptId,
            outcome: 'completed',
            sessionId,
            artifactRefs: [],
          }),
          callMeta,
        )
      },
      status: async (runId, callMeta) => {
        journal.push('status')
        const sessionId = sessions.get(runId)
        return core.ok(
          Object.freeze({ runId, running: sessionId !== undefined, ...(sessionId === undefined ? {} : { sessionId }) }),
          callMeta,
        )
      },
    },
  }
}

/**
 * Two workers over one database and one shared session owner.
 *
 * `workerA` is the process that runs; `workerB` is the one rebuilt after it is
 * gone. They share the store, the saga, the worktree port, and the artifact
 * store — everything durable — and differ only in the runtime object and the
 * ports' call journal, which is exactly the split a restart makes.
 */
async function restartFixture(options = {}) {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await openWorkerDatabase(clock)
  const graph = fakeGraph()
  const real = execution.createClaimSaga({ store, graph: graph.port, clock })
  const journal = []
  const saga = {
    claim: async command => {
      journal.push('claim')
      return real.claim(command)
    },
    settle: async command => {
      journal.push('settle')
      return real.settle(command)
    },
    recover: request => real.recover(request),
    revoke: request => real.revoke(request),
    attemptOf: taskId => real.attemptOf(taskId),
    liveAttempts: workspaceId => real.liveAttempts(workspaceId),
    openIntents: workspaceId => real.openIntents(workspaceId),
    stepsOf: operationId => real.stepsOf(operationId),
  }
  const sessions = new Map()
  const worktrees = fakeWorktrees(store, journal)
  const context = fakeContext(journal)
  const runtimeA = fakeRuntime(sessions, journal, options)
  const runtimeB = fakeRuntime(sessions, journal, options)
  const realArtifacts = evidence.createArtifactStore(store, { now: () => clock.now() })
  const artifacts = {
    put: request => {
      journal.push(`put:${request.kind}`)
      return realArtifacts.put(request)
    },
    get: ref => realArtifacts.get(ref),
  }
  const build = runtime =>
    execution.createWorker({
      store,
      saga,
      worktrees: worktrees.port,
      context: context.port,
      runtime: runtime.port,
      evidence: artifacts,
      clock,
    })
  return {
    clock,
    store,
    saga: real,
    journal,
    sessions,
    worktrees,
    context,
    runtimeA,
    runtimeB,
    artifacts,
    workerA: build(runtimeA),
    workerB: build(runtimeB),
  }
}

/** An admission for the fixture task. */
function admission(overrides = {}) {
  return {
    taskId: 'T-1',
    workspaceId: 'W-1',
    claimant: 'worker-1',
    agentId: 'Neo-1',
    expectedRevision: 1,
    leaseMs: 5_000,
    baseSha: 'a'.repeat(40),
    scope: { agentPreset: 'worker' },
    frozen: { config: 2, role: 4 },
    instructions: 'Do the work of T-1.',
    meta: meta(),
    ...overrides,
  }
}

/** The run request the crashed process would have handed the port. */
function runRequest(attemptId, registration) {
  return {
    runId: contracts.attemptRunId(attemptId),
    attemptId,
    worktree: {
      path: registration.path,
      branch: registration.branch,
      baseSha: registration.baseSha,
      headSha: registration.baseSha,
    },
    frozen: admission().frozen,
    scope: admission().scope,
    prompt: `Do the work of T-1.\n\ntask: T-1\nattempt: ${attemptId}`,
  }
}

/** Unwrap a successful result. */
function unwrap(result) {
  assert.equal(result.ok, true, result.ok ? '' : `${result.error.code}: ${result.error.message}`)
  return result.value
}

/** The attempt row of one attempt, as SQLite returns it. */
function attemptRow(store, attemptId) {
  return store.transaction(tx => tx.get('SELECT state, settled_at, fence FROM attempt WHERE attempt_id = ?', attemptId))
}

/** Wait until a predicate holds, without sleeping on a fixed delay. */
async function waitFor(predicate, what, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}

test('a restart adopts the session and never prepares a second worktree', async () => {
  const fixture = await restartFixture()
  const claim = unwrap(
    await fixture.saga.claim({
      taskId: 'T-1',
      workspaceId: 'W-1',
      claimant: 'worker-1',
      agentId: 'Neo-1',
      expectedRevision: 1,
      leaseMs: 5_000,
      meta: meta(),
    }),
  )
  const attemptId = claim.attemptId
  // The process that dies: it claimed, prepared the worktree, and opened a
  // session — then vanished before it settled anything.
  const registration = unwrap(
    await fixture.worktrees.port.prepare(
      { workspaceId: 'W-1', taskId: 'T-1', attemptId, baseSha: 'a'.repeat(40) },
      meta(),
    ),
  )
  unwrap(await fixture.runtimeA.port.run(runRequest(attemptId, registration), meta()))

  const mark = fixture.journal.length
  const report = unwrap(
    await fixture.workerB.resumeAttempt({
      attemptId,
      scope: admission().scope,
      frozen: admission().frozen,
      prompt: runRequest(attemptId, registration).prompt,
      meta: meta({ operationId: 'op-recover', correlationId: 'corr-recover' }),
    }),
  )

  assert.deepEqual(fixture.journal.slice(mark), [
    'resolve',
    'materialize',
    'put:context-snapshot',
    'status',
    'resume',
    'put:worker-report',
    'settle',
  ])
  assert.equal(fixture.journal.filter(entry => entry === 'prepare').length, 1, 'only the dead process prepared')
  assert.equal(fixture.runtimeB.requests.length, 0, 'a restart must not start a second session')
  assert.equal(fixture.sessions.size, 1)
  assert.equal(fixture.runtimeB.resumes.length, 1)
  assert.equal(fixture.runtimeB.resumes[0].sessionId, fixture.sessions.get(contracts.attemptRunId(attemptId)))
  assert.deepEqual(fixture.runtimeB.pins.get(fixture.runtimeB.resumes[0].sessionId), ['preset:worker'])
  assert.equal(report.attemptState, 'completed')
  assert.equal(report.sessionId, fixture.sessions.get(contracts.attemptRunId(attemptId)))
  assert.equal(countRows(fixture.store, 'attempt'), 1)
})

test('starting a run id that is already taken refuses instead of opening a second session', async () => {
  const fixture = await restartFixture()
  // The owner already holds a session for the run this attempt derives, which is
  // what a second process starting the same attempt would meet.
  fixture.sessions.set(contracts.attemptRunId('attempt-op-1'), 'session-existing')

  const refused = await fixture.workerA.runAttempt(admission())
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'TASK_CONFLICT')
  assert.equal(refused.error.details.reason, 'run-already-started')
  assert.equal(fixture.sessions.size, 1, 'the refusal created no second session')
  assert.equal(attemptRow(fixture.store, 'attempt-op-1').state, 'failed')
  assert.equal(countRows(fixture.store, 'attempt'), 1)
})

test('a result that arrives after a newer attempt is rejected with STALE_FENCE', async t => {
  let release
  const gate = new Promise(resolve => {
    release = resolve
  })
  const fixture = await restartFixture({ gate })
  const pending = fixture.workerA.runAttempt(admission())
  await waitFor(() => fixture.journal.includes('start'), 'the first run to start')

  // A newer worker takes the task over while the first one is still working: the
  // first attempt is superseded and the task's fence moves on.
  const second = unwrap(
    await fixture.saga.claim({
      taskId: 'T-1',
      workspaceId: 'W-1',
      claimant: 'worker-1',
      agentId: 'Neo-2',
      expectedRevision: 1,
      leaseMs: 5_000,
      meta: meta({ operationId: 'op-2', correlationId: 'corr-2' }),
    }),
  )
  assert.notEqual(second.attemptId, 'attempt-op-1')
  release()

  const late = await pending
  assert.equal(late.ok, false)
  assert.equal(late.error.code, 'STALE_FENCE')
  assert.match(late.error.message, /is not the current fence/)
  assert.equal(attemptRow(fixture.store, 'attempt-op-1').state, 'stale', 'the supersession is durable')
  assert.equal(attemptRow(fixture.store, 'attempt-op-2').state, 'leased')
  assert.equal(countRows(fixture.store, 'attempt'), 2, 'the late result created no third attempt')

  // The literal refusal the MW-022 report quotes, with the counters around it.
  t.diagnostic(`late result -> ${late.error.code}: ${late.error.message}`)
  t.diagnostic(
    `attempts after the late result -> ${countRows(fixture.store, 'attempt')}, worktrees -> ${countRows(fixture.store, 'attempt_worktree')}`,
  )
})

test('a process killed between the worktree and the session leaves one attempt and one worktree', async () => {
  const dir = tempDir()
  const runChild = (databasePath, mode, name) => {
    const journalPath = join(dir, `${name}.json`)
    const captured = runCaptured(
      process.execPath,
      [join(repoRoot, 'tests', 'lib', 'worker-crash-child.mjs'), databasePath, mode, journalPath],
      { cwd: repoRoot, env: process.env, logDir: dir, logName: `worker-${name}` },
    )
    // The child is gone by the time `spawnSync` returns, so the marker file is
    // read afterwards rather than waited for — there is no timing window to race.
    const marker = JSON.parse(readFileSync(journalPath, 'utf8'))
    return { captured, marker }
  }

  // Control first: the same code path, allowed to finish, so the difference the
  // crash makes is the crash and not the setup.
  const control = runChild(join(dir, 'control.sqlite'), 'commit', 'control')
  assert.equal(control.captured.status, 0, `child stderr: ${control.captured.stderr}`)
  assert.equal(control.marker.phase, 'committed')
  assert.equal(control.marker.ok, true)
  assert.equal(control.marker.state, 'completed')
  assert.equal(control.marker.attempts, 1)
  assert.equal(control.marker.worktrees, 1)

  const crashPath = join(dir, 'crash.sqlite')
  const crashed = runChild(crashPath, 'between-prepare-and-start', 'crash')
  assert.equal(crashed.captured.status, 9, `child stderr: ${crashed.captured.stderr}`)
  assert.equal(crashed.marker.phase, 'prepared')
  assert.equal(crashed.marker.attempts, 1)
  assert.equal(crashed.marker.worktrees, 1)
  assert.equal(crashed.marker.worktree.attemptId, 'attempt-op-crash')

  // The parent reopens the file the child left and adopts the attempt: a real
  // restart, with nothing carried over but the database.
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await openWorkerDatabase(clock, crashPath)
  try {
    assert.equal(countRows(store, 'attempt'), 1)
    assert.equal(countRows(store, 'attempt_worktree'), 1)
    const graph = fakeGraph()
    const real = execution.createClaimSaga({ store, graph: graph.port, clock })
    const journal = []
    const worktrees = fakeWorktrees(store, journal)
    const context = fakeContext(journal)
    const sessions = new Map()
    const runtime = fakeRuntime(sessions, journal)
    const artifacts = evidence.createArtifactStore(store, { now: () => clock.now() })
    const worker = execution.createWorker({
      store,
      saga: real,
      worktrees: worktrees.port,
      context: context.port,
      runtime: runtime.port,
      evidence: artifacts,
      clock,
    })

    const report = unwrap(
      await worker.resumeAttempt({
        attemptId: 'attempt-op-crash',
        scope: { agentPreset: 'worker' },
        frozen: { config: 2, role: 4 },
        prompt: 'Do the work of T-1.',
        meta: meta({ operationId: 'op-recover', correlationId: 'corr-recover' }),
      }),
    )

    assert.equal(report.attemptState, 'completed')
    assert.equal(report.sessionId, sessions.get(contracts.attemptRunId('attempt-op-crash')))
    // The worktree was resolved, never re-prepared, and the session was started
    // because the dead process never reached it.
    assert.equal(journal.filter(entry => entry === 'prepare').length, 0)
    assert.equal(journal.filter(entry => entry === 'resolve').length, 1)
    assert.equal(journal.filter(entry => entry === 'start').length, 1)
    assert.equal(journal.filter(entry => entry === 'resume').length, 0)
    assert.equal(countRows(store, 'attempt'), 1, 'exactly one attempt row after the restart')
    assert.equal(countRows(store, 'attempt_worktree'), 1, 'exactly one worktree row after the restart')
    assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt WHERE settled_at IS NULL').n)), 0)
  } finally {
    store.close()
  }
})

test('a repeated resume is idempotent', async () => {
  const fixture = await restartFixture()
  const claim = unwrap(
    await fixture.saga.claim({
      taskId: 'T-1',
      workspaceId: 'W-1',
      claimant: 'worker-1',
      agentId: 'Neo-1',
      expectedRevision: 1,
      leaseMs: 5_000,
      meta: meta(),
    }),
  )
  const attemptId = claim.attemptId
  const registration = unwrap(
    await fixture.worktrees.port.prepare(
      { workspaceId: 'W-1', taskId: 'T-1', attemptId, baseSha: 'a'.repeat(40) },
      meta(),
    ),
  )
  unwrap(await fixture.runtimeA.port.run(runRequest(attemptId, registration), meta()))

  const request = {
    attemptId,
    scope: admission().scope,
    frozen: admission().frozen,
    prompt: runRequest(attemptId, registration).prompt,
    meta: meta({ operationId: 'op-recover', correlationId: 'corr-recover' }),
  }
  const first = unwrap(await fixture.workerB.resumeAttempt(request))
  const mark = fixture.journal.length
  const second = unwrap(await fixture.workerB.resumeAttempt(request))

  assert.equal(second.reused, true)
  assert.equal(second.attemptState, 'completed')
  assert.equal(second.attemptId, first.attemptId)
  // The session identity is observed again, and the settlement is re-asked: the
  // saga owns the authority check, so a repeated call asks it rather than
  // assuming its own copy of the fence is still the current one — which is what
  // makes a late result refusable (`STALE_FENCE`). Everything that would *do*
  // work is skipped: no worktree, no snapshot, no session, no new attempt.
  assert.deepEqual(fixture.journal.slice(mark), ['status', 'settle'])
  assert.equal(fixture.journal.filter(entry => entry === 'prepare').length, 1)
  assert.equal(fixture.journal.filter(entry => entry === 'materialize').length, 1)
  assert.equal(fixture.journal.filter(entry => entry === 'start').length, 1)
  assert.equal(fixture.sessions.size, 1)
  assert.equal(fixture.runtimeB.resumes.length, 1)
  assert.equal(countRows(fixture.store, 'attempt'), 1)
  assert.equal(countRows(fixture.store, 'attempt_worktree'), 1)
  assert.equal(fixture.store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt WHERE settled_at IS NULL').n)), 0)
})
