/**
 * The migration journal of a state file, read without opening it as a store.
 *
 * The composition root cannot use `openStore` to ask this question: a migration
 * that exists as a factory receives its version from the allocator *before* the
 * database it lands in is opened (`migration-allocator.ts`, F-63), so opening
 * the database to learn which numbers it already recorded is exactly the
 * chicken-and-egg problem this module breaks. The journal is the record that
 * survives independently of the allocator's book, and reading it is what lets a
 * lost book adopt the numbers the database already knows instead of handing out
 * new ones (F-63b).
 *
 * Read-only by construction: the connection is opened with `readOnly`, no pragma
 * is applied, and no statement writes. A missing file is not an error — a fresh
 * `$DSH_HOME` has no state yet — but a file that exists and cannot be read is,
 * because answering "no journal" there is how a version gets silently
 * renumbered onto a migration that already owns it.
 * @module
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { STATE_UNREADABLE, StorageError } from './errors.ts'
import type { AppliedMigration } from './migrations.ts'

/** Journal table of a database this build migrated. */
export const JOURNAL_TABLE = 'schema_migrations'

/** One row of `sqlite_master`, as read back. */
interface SqliteMasterRow {
  readonly name: string
}

/** One `schema_migrations` row, as SQLite hands it over. */
interface JournalRow {
  readonly version: number | bigint
  readonly name: string
  readonly applied_at: number | bigint
}

/**
 * Applied migrations of a database file, oldest first, without opening a store.
 *
 * @param path - path of the state database; it need not exist.
 * @returns the journal rows, or an empty list when the file or the journal table
 *   does not exist yet.
 * @throws {StorageError} `state-unreadable` when the file exists but its journal
 *   cannot be read, with the underlying SQLite failure as cause.
 */
export function readMigrationJournal(path: string): readonly AppliedMigration[] {
  const resolved = resolve(path)
  if (!existsSync(resolved)) return Object.freeze([])
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(resolved, { readOnly: true })
    const table = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(JOURNAL_TABLE) as unknown as SqliteMasterRow | undefined
    if (table === undefined) return Object.freeze([])
    const rows = database
      .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
      .all() as unknown as JournalRow[]
    return Object.freeze(rows.map(row => Object.freeze({
      version: Number(row.version),
      name: String(row.name),
      appliedAt: Number(row.applied_at),
    })))
  } catch (error) {
    throw new StorageError(
      STATE_UNREADABLE,
      `dsh-mywork: the migration journal of "${resolved}" could not be read; `
        + 'refusing to guess, because a version renumbered onto a migration that already owns it is silent schema loss',
      { details: { path: resolved }, cause: error },
    )
  } finally {
    database?.close()
  }
}
