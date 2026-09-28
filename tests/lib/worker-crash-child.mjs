/**
 * Child process for the worker restart test.
 *
 * It runs a real worker against a real database and dies *between* the two hops
 * that a restart must tell apart: the worktree is prepared and the session is not
 * started. The parent then reopens the same file and adopts the attempt, which is
 * the one thing an in-process test cannot show — a process that never returned is
 * not the same event as a promise that rejected.
 *
 * Usage: node worker-crash-child.mjs <database-path> <between-prepare-and-start|commit> <journal-path>
 *
 * The report goes to file-backed stdout and to the journal file, both of which
 * survive `process.exit`. Pipes are avoided on purpose: this repository's
 * confined shells cannot open one (`spawn EPERM`).
 */

import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [databasePath, mode, journalPath] = process.argv.slice(2)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const load = relative => import(pathToFileURL(join(repoRoot, relative)).href)
const [storage, evidence, lease, execution, core, contracts] = await Promise.all([
  load('packages/storage/lib/index.js'),
  load('packages/evidence/lib/index.js'),
  load('packages/lease/lib/index.js'),
  load('packages/execution/lib/index.js'),
  load('packages/core/lib/index.js'),
  load('packages/contracts/lib/index.js'),
])

const store = await storage.openStore({
  path: databasePath,
  migrations: [
    ...storage.MYWORK_MIGRATIONS,
    ...evidence.EVIDENCE_MIGRATIONS,
    ...lease.LEASE_MIGRATIONS,
    ...execution.CLAIM_SAGA_MIGRATIONS,
  ],
  clock: { now: () => 1_000 },
})

/** Write the journal file the parent reads after the process is gone. */
function journal(entry) {
  writeFileSync(journalPath, `${JSON.stringify(entry)}\n`)
}

/**
 * Record the attempt's worktree the way the claim saga does (`E-04`).
 *
 * The binding is durable state, so the child writes it to the database instead of
 * keeping it in memory: the parent process has to be able to resolve the attempt's
 * worktree after the child is gone, and a table the child created with
 * `IF NOT EXISTS` matches the migration that step adds when it lands.
 */
function recordWorktree(registration) {
  store.transaction(tx => {
    tx.exec(`CREATE TABLE IF NOT EXISTS attempt_worktree (
      attempt_id TEXT PRIMARY KEY REFERENCES attempt(attempt_id),
      path       TEXT NOT NULL,
      branch     TEXT NOT NULL,
      base_sha   TEXT NOT NULL CHECK(length(base_sha) = 40),
      head_sha   TEXT,
      created_at INTEGER NOT NULL,
      settled_at INTEGER
    )`)
    tx.run(
      `INSERT INTO attempt_worktree (attempt_id, path, branch, base_sha, head_sha, created_at, settled_at)
       VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
      registration.attemptId,
      registration.path,
      registration.branch,
      registration.baseSha,
      1_000,
    )
  })
}

/** A `TaskGraphPort` that claims one ready task. */
function graphPort() {
  const tasks = new Map([
    ['T-1', { id: 'T-1', workspaceId: 'W-1', title: 'T-1', description: '', state: 'ready', revision: 1, dependsOn: [] }],
  ])
  return {
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
  }
}

const baseSha = 'a'.repeat(40)

/** The worktree port: it records the binding and then, in crash mode, dies. */
const worktrees = {
  prepare: async (request, callMeta) => {
    const registration = Object.freeze({
      attemptId: request.attemptId,
      workspaceId: request.workspaceId,
      taskId: request.taskId,
      path: join('C:/worktrees', request.attemptId),
      branch: `mywork/${request.taskId}-${request.attemptId}`,
      baseSha: request.baseSha,
    })
    recordWorktree(registration)
    const counts = {
      attempts: store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)),
      worktrees: store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt_worktree').n)),
    }
    journal({ phase: 'prepared', attemptId: request.attemptId, worktree: registration, ...counts })
    if (mode === 'between-prepare-and-start') {
      // The window between §19's worktree and §22's session: the attempt is live,
      // the worktree is registered, and no session exists yet.
      process.stdout.write(`${JSON.stringify({ phase: 'prepared', ...counts })}\n`)
      process.exit(9)
    }
    return core.ok(registration, callMeta)
  },
  resolve: async () => {
    throw new Error('the crash child never resumes')
  },
  cleanup: async (attemptId, callMeta) => core.ok(Object.freeze({ outcome: 'kept-orphan' }), callMeta),
  list: async (workspaceId, callMeta) => core.ok(Object.freeze([]), callMeta),
}

/** The context fabric: deterministic for one attempt, as §35 requires. */
const context = {
  materialize: async (request, callMeta) =>
    core.ok(
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
    ),
}

/** The attempt runtime: it mints one session and reports it as completed. */
const runtime = {
  run: async (request, callMeta) => {
    journal({ phase: 'started', attemptId: request.attemptId, runId: request.runId, prompt: request.prompt })
    return core.ok(
      Object.freeze({
        runId: request.runId,
        attemptId: request.attemptId,
        outcome: 'completed',
        sessionId: `session-crash-${request.attemptId}`,
        artifactRefs: [],
      }),
      callMeta,
    )
  },
  resume: async () => {
    throw new Error('the crash child never resumes')
  },
  status: async (runId, callMeta) => core.ok(Object.freeze({ runId, running: false }), callMeta),
}

const clock = { now: () => 1_000, sleep: async () => {} }
const saga = execution.createClaimSaga({ store, graph: graphPort(), clock })
const worker = execution.createWorker({
  store,
  saga,
  worktrees,
  context,
  runtime,
  evidence: evidence.createArtifactStore(store, { now: () => clock.now() }),
  clock,
})

const result = await worker.runAttempt({
  taskId: 'T-1',
  workspaceId: 'W-1',
  claimant: 'worker-crash',
  agentId: 'Neo-1',
  expectedRevision: 1,
  leaseMs: 5_000,
  baseSha,
  scope: { agentPreset: 'worker' },
  frozen: { config: 2, role: 4 },
  instructions: 'Do the work of T-1.',
  meta: core.defineOperationMeta({ operationId: 'op-crash', correlationId: 'corr-crash', controllerEpoch: 3 }),
})

// Reached only in `commit` mode: the worker ran to completion.
const visible = {
  phase: 'committed',
  ok: result.ok,
  attemptId: result.ok ? result.value.attemptId : null,
  outcome: result.ok ? result.value.outcome : null,
  state: result.ok ? result.value.attemptState : null,
  runId: contracts.attemptRunId('attempt-op-crash'),
  attempts: store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)),
  worktrees: store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt_worktree').n)),
  liveAttempts: store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt WHERE settled_at IS NULL').n)),
}
journal(visible)
process.stdout.write(`${JSON.stringify(visible)}\n`)
store.close()
