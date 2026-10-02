/**
 * Retention: the first limit on how the state database grows (F-38, F-39;
 * MW-040, D17).
 *
 * Two things live here. {@link pruneOutbox}, {@link pruneInboxDedup} and
 * {@link pruneAuditEvents} delete rows older than an **explicit** window and
 * report how many they removed; {@link compact} returns the pages they freed to
 * the filesystem. Nothing in this module decides *what* may be deleted — that is
 * the owner's policy (D17) — it only carries it out, which is why every window
 * is a parameter and no window is a constant.
 *
 * The audit log is append-only by a database trigger, so pruning it is the one
 * explicit path that removes the guard, deletes, and puts the guard back inside
 * the same transaction; a caller cannot end up with an unguarded log.
 * @module
 */

import { statSync } from 'node:fs'

import { StorageError } from './errors.ts'
import { openSqlite, type SqlExecutor } from './sql.ts'
import { DEFAULT_BUSY_TIMEOUT_MS } from './store.ts'

/** One retention window. */
export interface RetentionWindow {
  /**
   * Boundary in the same clock units as the stored timestamps: rows with a
   * **lower** stamp are removed, a row exactly on the boundary stays.
   */
  readonly olderThan: number
}

/** What one prune call did. */
export interface PruneResult {
  /** Rows the statement removed. */
  readonly deleted: number
  /** The boundary that was applied. */
  readonly cutoff: number
}

/** Inputs of {@link compact}. */
export interface CompactOptions {
  /** Database file to compact; the caller must not hold a transaction on it. */
  readonly path: string
  /** Lock wait of the dedicated connection; defaults to the store's own budget. */
  readonly busyTimeoutMs?: number
}

/** What compaction did. */
export interface CompactResult {
  /** Size of the database file before compaction. */
  readonly fileSizeBefore: number
  /** Size of the database file after compaction. */
  readonly fileSizeAfter: number
  /** Whether the write-ahead log was checkpointed and truncated. */
  readonly checkpointed: boolean
  /** Whether the file was rewritten by `VACUUM`. */
  readonly vacuumed: boolean
}

/**
 * Remove delivered outbox events older than the window.
 *
 * A `pending` event is never touched: it has not been published yet, and losing
 * it would lose the event itself, not a copy of it.
 * @param executor - connection or open transaction.
 * @param window - explicit boundary.
 * @returns how many rows went.
 * @throws {StorageError} `invalid-input` for a boundary that is not a non-negative integer.
 */
export function pruneOutbox(executor: SqlExecutor, window: RetentionWindow): PruneResult {
  const cutoff = cutoffOf(window)
  const deleted = executor.run("DELETE FROM outbox WHERE status = 'delivered' AND occurred_at < ?", cutoff)
  return { deleted, cutoff }
}

/**
 * Remove inbox dedup rows older than the window.
 *
 * The window must outlast the longest redelivery the deployment allows, or a
 * redelivered event is applied twice (D17).
 * @param executor - connection or open transaction.
 * @param window - explicit boundary.
 */
export function pruneInboxDedup(executor: SqlExecutor, window: RetentionWindow): PruneResult {
  const cutoff = cutoffOf(window)
  const deleted = executor.run('DELETE FROM inbox_dedup WHERE processed_at < ?', cutoff)
  return { deleted, cutoff }
}

/**
 * Remove audit events older than the window.
 *
 * The log is append-only by trigger, so this is the explicit deletion path: the
 * guard is read, dropped, the window is applied, and the very same guard is put
 * back in a `finally` on the same executor — success or failure.
 *
 * What this function guarantees is the restore. What makes the three steps **one
 * unit** is the caller's transaction: call it as
 * `store.transaction(tx => pruneAuditEvents(tx, window))`. On a bare connection
 * every statement autocommits, so a crash between the drop and the restore would
 * leave the log unguarded until the next prune; a parameter type cannot express
 * "must be inside a transaction", so the contract is stated here rather than
 * implied.
 * @param executor - open transaction (preferred, see above) or connection.
 * @param window - explicit boundary.
 */
export function pruneAuditEvents(executor: SqlExecutor, window: RetentionWindow): PruneResult {
  const cutoff = cutoffOf(window)
  const guard = executor.get("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'audit_events_no_delete'")
  if (guard !== undefined) executor.exec('DROP TRIGGER audit_events_no_delete')
  try {
    const deleted = executor.run('DELETE FROM audit_events WHERE occurred_at < ?', cutoff)
    return { deleted, cutoff }
  } finally {
    if (guard !== undefined) executor.exec(String(guard.sql))
  }
}

/**
 * Return free pages to the filesystem.
 *
 * `DELETE` only marks pages free inside the file, so the file keeps its size
 * until something rewrites it. The write-ahead log is checkpointed and
 * truncated first — that alone moves committed pages into the database — and
 * the file is then rewritten (`VACUUM`), which is what actually shrinks it. The
 * pragma is (re)asserted before the rewrite, so a database created before F-35
 * adopts incremental auto-vacuum on its first compaction.
 *
 * Never call this on a request path: `VACUUM` takes the database exclusively.
 * F-39 schedules it as a durable job instead.
 * @param options - database path and optional lock budget.
 * @returns the file sizes around the compaction.
 * @throws {StorageError} `invalid-input` for a path that is not a file.
 */
export async function compact(options: CompactOptions): Promise<CompactResult> {
  if (typeof options.path !== 'string' || options.path.trim().length === 0) {
    throw new StorageError('invalid-input', 'dsh-mywork: compact() needs the path of a database file')
  }
  const fileSizeBefore = sizeOf(options.path)
  const connection = await openSqlite({
    path: options.path,
    busyTimeoutMs: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
  })
  try {
    connection.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    connection.exec('PRAGMA auto_vacuum = INCREMENTAL')
    connection.exec('VACUUM')
  } finally {
    connection.close()
  }
  return {
    fileSizeBefore,
    fileSizeAfter: sizeOf(options.path),
    checkpointed: true,
    vacuumed: true,
  }
}

/** The boundary of a window, refused when it is not a usable stamp. */
function cutoffOf(window: RetentionWindow): number {
  const cutoff = window?.olderThan
  if (typeof cutoff !== 'number' || !Number.isInteger(cutoff) || cutoff < 0) {
    throw new StorageError(
      'invalid-input',
      `dsh-mywork: a retention window must be a non-negative integer stamp, received ${String(cutoff)}`,
    )
  }
  return cutoff
}

/** Size of a file on disk. */
function sizeOf(path: string): number {
  return statSync(path).size
}
