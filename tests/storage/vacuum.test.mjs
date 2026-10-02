/**
 * Compaction returns freed pages to the filesystem (F-39, MW-040, D17, P6).
 *
 * What has to hold: after a large prune, `compact({ path })` leaves a smaller
 * file; the database stays readable afterwards; and a path that is not a
 * database is refused rather than silently "compacted".
 *
 * `VACUUM` takes the database exclusively and cannot run inside a transaction,
 * so compaction opens a connection of its own — it is scheduled as a durable job
 * (F-37), never called on a request path.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { evidence, execution, lease, planner, storage } from '../lib/fixtures.mjs'

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-storage-'))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/** The canonical migration set, as the composition root assembles it. */
function migrations() {
  return storage.canonicalMigrations([
    storage.MYWORK_MIGRATIONS,
    evidence.EVIDENCE_MIGRATIONS,
    lease.LEASE_MIGRATIONS,
    planner.PLAN_MUTATION_MIGRATIONS,
    execution.CLAIM_SAGA_MIGRATIONS,
  ])
}

test('compact returns pages to the filesystem after a prune', async () => {
  const dir = tempDir()
  const path = join(dir, 'registry.sqlite')
  const payload = 'x'.repeat(4_096)
  const store = await storage.openStore({ path, migrations: migrations() })
  try {
    // Enough delivered history for the file to grow well past its final size.
    store.transaction(tx => {
      for (let index = 0; index < 400; index += 1) {
        tx.run(
          'INSERT INTO outbox (event_id, workspace_id, sequence, type, correlation_id, causation_id, occurred_at, payload, status, attempts, last_error, created_at, delivered_at) '
            + "VALUES (?, 'W-1', ?, 'task.state.changed', 'corr-1', NULL, ?, ?, 'delivered', 0, NULL, ?, ?)",
          `e-${index}`,
          index,
          1_000,
          payload,
          1_000,
          1_000,
        )
      }
    })
    const pruned = store.transaction(tx => storage.pruneOutbox(tx, { olderThan: 2_000 }))
    assert.equal(pruned.deleted, 400, 'the history is what the window removes')
  } finally {
    store.close()
  }

  const before = statSync(path).size
  const result = await storage.compact({ path })
  const after = statSync(path).size

  assert.equal(result.fileSizeBefore, before)
  assert.equal(result.fileSizeAfter, after)
  assert.equal(result.checkpointed, true)
  assert.equal(result.vacuumed, true)
  assert.ok(after < before, `the file must shrink: ${before} -> ${after}`)
})

test('a compacted database is still a database, and a non-database path is refused', async () => {
  const dir = tempDir()
  const path = join(dir, 'registry.sqlite')
  const store = await storage.openStore({ path, migrations: migrations() })
  let version
  try {
    version = store.schemaVersion
    store.transaction(tx => tx.run(
      'INSERT INTO outbox (event_id, workspace_id, sequence, type, correlation_id, causation_id, occurred_at, payload, status, attempts, last_error, created_at, delivered_at) '
        + "VALUES ('e-keep', 'W-1', 1, 'task.state.changed', 'corr-1', NULL, 1000, '{}', 'pending', 0, NULL, 1000, NULL)",
    ))
  } finally {
    store.close()
  }

  await storage.compact({ path })

  const reopened = await storage.openStore({ path, migrations: migrations() })
  try {
    assert.equal(reopened.schemaVersion, version, 'compaction did not touch the schema version')
    assert.deepEqual(
      reopened.transaction(tx => tx.all('SELECT event_id FROM outbox')).map(row => row.event_id),
      ['e-keep'],
      'the pending event survived compaction',
    )
    reopened.transaction(tx => tx.run(
      'INSERT INTO outbox (event_id, workspace_id, sequence, type, correlation_id, causation_id, occurred_at, payload, status, attempts, last_error, created_at, delivered_at) '
        + "VALUES ('e-after', 'W-1', 2, 'task.state.changed', 'corr-1', NULL, 2000, '{}', 'pending', 0, NULL, 2000, NULL)",
    ))
    assert.equal(reopened.transaction(tx => tx.get('SELECT COUNT(*) AS n FROM outbox').n), 2, 'the file is writable again')
  } finally {
    reopened.close()
  }

  const notADatabase = join(dir, 'notes.txt')
  writeFileSync(notADatabase, 'this is not a database')
  await assert.rejects(() => storage.compact({ path: notADatabase }), 'a file that is not a database must be refused')
})
