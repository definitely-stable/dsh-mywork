/**
 * Child process for the claim-saga crash test.
 *
 * It runs a real claim saga against a real database and dies at a chosen point in
 * §9's step list, so the parent can reopen the same file and ask what the saga
 * left behind. That is the one thing an in-process test cannot show: a throw
 * inside a transaction is not the same event as a process that never returns.
 *
 * Usage: node claim-crash-child.mjs <database-path> <after-intent|after-claim|commit>
 *
 * The report is written to file-backed stdout, which is synchronous, so the
 * parent reads it even when the process dies on the next line. Pipes are avoided
 * on purpose: this repository's confined shells cannot open one (`spawn EPERM`).
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [databasePath, mode] = process.argv.slice(2)
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
})

/**
 * A graph port that claims successfully and then dies at the requested point.
 *
 * `after-intent` dies before the graph is touched at all, which is the window
 * between §9 step 1 and step 2. `after-claim` lets the claim land and dies before
 * the attempt exists, which is the window between step 2 and step 3.
 */
function graphPort() {
  const tasks = new Map([['T-1', { id: 'T-1', workspaceId: 'W-1', title: 'T-1', description: '', state: 'ready', revision: 1, dependsOn: [] }]])
  return {
    tasks,
    capabilities: async () => ({ adapterId: 'fake', contractVersion: 'taskgraph/v1', capabilities: {}, source: 'declared' }),
    get: async id => {
      const task = tasks.get(id)
      if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${id}"`)
      return Object.freeze({ ...task })
    },
    ready: async () => [],
    blocked: async () => [],
    claim: async command => {
      if (mode === 'after-intent') {
        // Killed in the window between §9 step 1 and step 2: the intent is durable
        // and the graph was never touched.
        process.stdout.write(`${JSON.stringify({ phase: 'before-claim' })}\n`)
        process.exit(7)
      }
      const task = tasks.get(command.id)
      task.assignee = command.claimant
      if (mode === 'after-claim') {
        // Killed in the window between §9 step 2 and step 3: the graph recorded the
        // claim and MyWork never recorded an attempt for it.
        process.stdout.write(`${JSON.stringify({ phase: 'claim-landed' })}\n`)
        process.exit(7)
      }
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

const clock = { now: () => 1_000, sleep: async () => {} }
const graph = graphPort()
const saga = execution.createClaimSaga({ store, graph, clock })

const result = await saga.claim({
  taskId: 'T-1',
  workspaceId: 'W-1',
  claimant: 'worker-crash',
  agentId: 'Neo-1',
  expectedRevision: 1,
  leaseMs: 5_000,
  meta: core.defineOperationMeta({ operationId: 'op-crash', correlationId: 'corr-crash', controllerEpoch: 3 }),
})

// Reached only in `commit` mode: the saga ran to completion.
const visible = {
  phase: 'committed',
  ok: result.ok,
  state: result.ok ? result.value.state : null,
  intents: store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM claim_intent').n)),
  attempts: store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)),
  liveAttempts: store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt WHERE settled_at IS NULL').n)),
  schema: store.schemaVersion,
  expectedSchema: execution.CLAIM_SAGA_SCHEMA_VERSION,
  terminal: contracts.CLAIM_INTENT_TERMINAL_STATES.includes(result.ok ? result.value.state : 'recorded'),
}
process.stdout.write(`${JSON.stringify(visible)}\n`)
store.close()
