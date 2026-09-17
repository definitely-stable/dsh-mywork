/**
 * Durability against a real process death (architecture §9, §47, §48).
 *
 * The in-process test can only throw inside a transaction; this one kills the
 * process between the mutation and the commit and then reopens the database. A
 * committed control run proves the difference is the crash, not the setup.
 *
 * The child is spawned with file-backed stdio, the pattern this repository uses
 * for confined shells where a child cannot open a pipe (`spawn EPERM`).
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { repoRoot, storage } from './lib/fixtures.mjs'
import { runCaptured } from '../scripts/lib/process.mjs'

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-crash-'))
  tempDirs.push(dir)
  return dir
}

after(() => {
  const leftover = []
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      leftover.push(dir)
    }
  }
  assert.deepEqual(leftover, [], `temporary databases were left behind: ${leftover.join(', ')}`)
})

/** Run the child process against one database. */
function runChild(databasePath, mode, logDir) {
  return runCaptured(
    process.execPath,
    [join(repoRoot, 'tests', 'lib', 'crash-child.mjs'), databasePath, mode],
    { cwd: repoRoot, env: process.env, logDir, logName: mode },
  )
}

/** The last JSON line the child wrote. */
function lastLine(output) {
  const lines = output.trim().split('\n').filter(line => line.startsWith('{'))
  assert.ok(lines.length > 0, `child produced no report: ${output}`)
  return JSON.parse(lines[lines.length - 1])
}

test('a process that dies between the mutation and the commit leaves no half change', async () => {
  const dir = tempDir()
  const path = join(dir, 'state', 'registry.sqlite')
  const crashed = runChild(path, 'exit', dir)
  assert.equal(crashed.status, 7, `child stderr: ${crashed.stderr}`)

  // Both writes were there inside the dying transaction.
  assert.deepEqual(lastLine(crashed.stdout), { phase: 'inside-transaction', outbox: 1, dedup: 1 })

  const store = await storage.openStore({ path })
  try {
    assert.equal(store.schemaVersion, storage.MYWORK_SCHEMA_VERSION, 'the schema survives the crash')
    assert.deepEqual(store.migrations.map(row => row.version), [1])
    assert.deepEqual(store.outbox.pending(), [], 'the uncommitted event must not be visible')
    assert.equal(store.inbox.isProcessed('crash-consumer', 'e-crash'), false, 'the uncommitted dedup row must not be visible')
    assert.equal(store.transaction(tx => tx.get('PRAGMA integrity_check').integrity_check), 'ok')

    // The database is writable again, and the redelivery applies once.
    const retry = store.transaction(tx => tx.inbox.applyOnce('crash-consumer', 'e-crash', () => 'applied'))
    assert.deepEqual(retry, { applied: true, value: 'applied' })
    const second = store.transaction(tx => tx.inbox.applyOnce('crash-consumer', 'e-crash', () => 'applied'))
    assert.deepEqual(second, { applied: false })
  } finally {
    store.close()
  }

  // Reopening once more still shows the retried state: the recovery is durable.
  const reopened = await storage.openStore({ path })
  try {
    assert.equal(reopened.inbox.isProcessed('crash-consumer', 'e-crash'), true)
    assert.deepEqual(reopened.outbox.pending(), [])
  } finally {
    reopened.close()
  }
})

test('a process that commits before exiting leaves the whole change', async () => {
  const dir = tempDir()
  const path = join(dir, 'state', 'registry.sqlite')
  const committed = runChild(path, 'commit', dir)
  assert.equal(committed.status, 0, `child stderr: ${committed.stderr}`)
  assert.deepEqual(lastLine(committed.stdout), { phase: 'committed' })

  const store = await storage.openStore({ path })
  try {
    const pending = store.outbox.pending()
    assert.deepEqual(pending.map(record => record.envelope.eventId), ['e-crash'])
    assert.equal(pending[0].envelope.sequence, 1)
    assert.deepEqual(pending[0].envelope.payload, { taskId: 'T-1', from: 'ready', to: 'assigned', at: 1_000 })
    assert.equal(store.inbox.isProcessed('crash-consumer', 'e-crash'), true)
  } finally {
    store.close()
  }
})
