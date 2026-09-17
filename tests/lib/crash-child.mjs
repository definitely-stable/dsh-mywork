/**
 * Child process for the storage crash test.
 *
 * It opens a real store, commits one transaction (mode `commit`) or dies in the
 * middle of one (mode `exit`, exit code 7), and prints what it could see from
 * inside the transaction. The parent then reopens the same file and checks
 * whether the half-finished transaction left anything behind.
 *
 * Usage: node crash-child.mjs <database-path> <commit|exit>
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [databasePath, mode] = process.argv.slice(2)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { openStore } = await import(pathToFileURL(resolve(repoRoot, 'packages', 'storage', 'lib', 'index.js')).href)

/** The event the crashed transaction tried to commit. */
const event = {
  type: 'task.state.changed',
  payload: { taskId: 'T-1', from: 'ready', to: 'assigned', at: 1_000 },
}

const store = await openStore({ path: databasePath })
store.transaction(tx => {
  tx.outbox.append({ event, workspaceId: 'W-1', correlationId: 'corr-crash', eventId: 'e-crash' })
  tx.inbox.applyOnce('crash-consumer', 'e-crash', () => 'applied')
  const visible = {
    phase: 'inside-transaction',
    outbox: Number(tx.get('SELECT COUNT(*) AS n FROM outbox').n),
    dedup: Number(tx.get('SELECT COUNT(*) AS n FROM inbox_dedup').n),
  }
  // Written to a file-backed stdout, which is synchronous; the parent reads it
  // even when the process dies on the next line.
  process.stdout.write(`${JSON.stringify(visible)}\n`)
  if (mode === 'exit') {
    process.exit(7)
  }
  return 'committed'
})
process.stdout.write(`${JSON.stringify({ phase: 'committed' })}\n`)
store.close()
