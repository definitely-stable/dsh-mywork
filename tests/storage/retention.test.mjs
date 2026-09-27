/**
 * Retention windows over `outbox`, `inbox_dedup` and `audit_events` (F-38,
 * MW-040, D17).
 *
 * What has to hold: an explicit window removes exactly the rows older than it;
 * a delivered event goes while a pending one stays (a pending event has not been
 * published yet); a fresh dedup row stays, or a redelivery would be applied
 * twice; and the append-only audit log is pruned through its one explicit path
 * with the guard back in place afterwards.
 *
 * Every window here is passed in; none of them is a constant in the code, so
 * the policy stays with its owner (D17).
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
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

/** A store whose schema carries the kernel and the evidence tables. */
async function openStore(dir) {
  const migrations = storage.canonicalMigrations([
    storage.MYWORK_MIGRATIONS,
    evidence.EVIDENCE_MIGRATIONS,
    lease.LEASE_MIGRATIONS,
    planner.PLAN_MUTATION_MIGRATIONS,
    execution.CLAIM_SAGA_MIGRATIONS,
  ])
  return storage.openStore({ path: join(dir, 'registry.sqlite'), migrations })
}

/** Insert one outbox row with the given status and stamp. */
function insertEvent(store, { eventId, occurredAt, status }) {
  store.transaction(tx => tx.run(
    'INSERT INTO outbox (event_id, workspace_id, sequence, type, correlation_id, causation_id, occurred_at, payload, status, attempts, last_error, created_at, delivered_at) '
      + 'VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, NULL, ?, ?)',
    eventId,
    'W-1',
    Number(eventId.replace(/\D/g, '')),
    'task.state.changed',
    'corr-1',
    occurredAt,
    '{}',
    status,
    occurredAt,
    status === 'delivered' ? occurredAt : null,
  ))
}

/** Insert one dedup row with the given stamp. */
function insertDedup(store, { consumer, eventId, processedAt }) {
  store.transaction(tx => tx.run(
    'INSERT INTO inbox_dedup (consumer, event_id, processed_at) VALUES (?, ?, ?)',
    consumer,
    eventId,
    processedAt,
  ))
}

/** Insert one audit row with the given stamp. */
function insertAudit(store, { auditId, occurredAt }) {
  store.transaction(tx => tx.run(
    'INSERT INTO audit_events (audit_id, type, workspace_id, correlation_id, occurred_at) VALUES (?, ?, ?, ?, ?)',
    auditId,
    'artifact.put',
    'W-1',
    'corr-1',
    occurredAt,
  ))
}

test('a delivered event older than the window is pruned, a pending one is not', async () => {
  const store = await openStore(tempDir())
  try {
    insertEvent(store, { eventId: 'e-1', occurredAt: 1_000, status: 'delivered' })
    insertEvent(store, { eventId: 'e-2', occurredAt: 1_500, status: 'delivered' })
    insertEvent(store, { eventId: 'e-3', occurredAt: 1_000, status: 'pending' })
    insertEvent(store, { eventId: 'e-4', occurredAt: 9_000, status: 'delivered' })

    const result = store.transaction(tx => storage.pruneOutbox(tx, { olderThan: 2_000 }))
    assert.deepEqual(result, { deleted: 2, cutoff: 2_000 })

    const remaining = store.transaction(tx => tx.all('SELECT event_id, status FROM outbox ORDER BY event_id'))
    assert.deepEqual(
      remaining.map(row => [row.event_id, row.status]),
      [['e-3', 'pending'], ['e-4', 'delivered']],
      'the unpublished event and the fresh one stay',
    )
  } finally {
    store.close()
  }
})

test('dedup rows older than the window go, fresh ones stay', async () => {
  const store = await openStore(tempDir())
  try {
    insertDedup(store, { consumer: 'projection', eventId: 'e-old-1', processedAt: 100 })
    insertDedup(store, { consumer: 'projection', eventId: 'e-old-2', processedAt: 200 })
    insertDedup(store, { consumer: 'audit', eventId: 'e-fresh', processedAt: 5_000 })

    assert.equal(store.transaction(tx => storage.pruneInboxDedup(tx, { olderThan: 1_000 }).deleted), 2)
    assert.deepEqual(
      store.transaction(tx => tx.all('SELECT consumer, event_id FROM inbox_dedup')).map(row => [row.consumer, row.event_id]),
      [['audit', 'e-fresh']],
      'a dedup row inside the window must survive, or the event would be applied twice',
    )
  } finally {
    store.close()
  }
})

test('the append-only audit log is pruned through its explicit path, and the guard comes back', async () => {
  const store = await openStore(tempDir())
  try {
    insertAudit(store, { auditId: 'au-1', occurredAt: 100 })
    insertAudit(store, { auditId: 'au-2', occurredAt: 200 })
    insertAudit(store, { auditId: 'au-3', occurredAt: 5_000 })

    // The guard really is in the way first.
    assert.throws(
      () => store.transaction(tx => tx.run("DELETE FROM audit_events WHERE audit_id = 'au-1'")),
      error => String(error.message).includes(evidence.AUDIT_APPEND_ONLY_MARKER),
    )

    const result = store.transaction(tx => storage.pruneAuditEvents(tx, { olderThan: 1_000 }))
    assert.deepEqual(result, { deleted: 2, cutoff: 1_000 })
    assert.deepEqual(
      store.transaction(tx => tx.all('SELECT audit_id FROM audit_events')).map(row => row.audit_id),
      ['au-3'],
    )

    // The append-only guarantee is restored inside the same transaction.
    assert.equal(
      store.transaction(tx => tx.get("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'audit_events_no_delete'") !== undefined),
      true,
      'the delete guard is back after the prune',
    )
    assert.throws(
      () => store.transaction(tx => tx.run("DELETE FROM audit_events WHERE audit_id = 'au-3'")),
      error => String(error.message).includes(evidence.AUDIT_APPEND_ONLY_MARKER),
      'the log is append-only again',
    )

    // An unusable window is refused before anything is deleted.
    for (const olderThan of [-1, 1.5, Number.NaN]) {
      assert.throws(
        () => store.transaction(tx => storage.pruneAuditEvents(tx, { olderThan })),
        error => error.name === 'StorageError' && error.code === 'invalid-input',
        `window ${String(olderThan)} must be refused`,
      )
    }
  } finally {
    store.close()
  }
})
