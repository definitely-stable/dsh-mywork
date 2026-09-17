/**
 * Explicit schema migrations and the version stamp (architecture §61).
 *
 * `PRAGMA user_version` is the single schema version of a database; the
 * `schema_migrations` journal records which migration produced it. Both move
 * inside one transaction per migration, so an interrupted upgrade leaves the
 * database at its previous, complete version instead of half-migrated.
 *
 * Scope: this is the apply half of §61. Backup → migrate → verify → activate,
 * export/import, repair, and the rollback policy are MW-040, which extends this
 * journal rather than replacing it.
 * @module
 */

import { StorageError } from './errors.ts'
import { withTransaction, type SqlExecutor, type SqliteConnection } from './sql.ts'
import type { StorageClock } from './clock.ts'

/** Statement surface a migration body may use. */
export type MigrationContext = SqlExecutor

/** One ordered schema change. */
export interface Migration {
  /** Monotonic version this migration brings the database to; starts at 1. */
  readonly version: number
  /** Short journal label, e.g. `outbox-inbox`. */
  readonly name: string
  /**
   * Apply the change. Runs inside a transaction: either every statement of the
   * migration commits, or the database keeps the previous version.
   */
  up(context: MigrationContext): void
}

/** One journal row, as read back from `schema_migrations`. */
export interface AppliedMigration {
  /** Schema version this migration produced. */
  readonly version: number
  /** Journal label recorded when it was applied. */
  readonly name: string
  /** Clock reading of the apply. */
  readonly appliedAt: number
}

/**
 * Version 1 — the outbox/inbox kernel: the transactional outbox and the
 * consumer-side dedup ledger of architecture §48.
 */
const OUTBOX_INBOX: Migration = {
  version: 1,
  name: 'outbox-inbox',
  up(context: MigrationContext): void {
    context.exec(`
      CREATE TABLE outbox (
        event_id       TEXT    NOT NULL PRIMARY KEY,
        workspace_id   TEXT    NOT NULL,
        sequence       INTEGER NOT NULL,
        type           TEXT    NOT NULL,
        correlation_id TEXT    NOT NULL,
        causation_id   TEXT,
        occurred_at    INTEGER NOT NULL,
        payload        TEXT    NOT NULL,
        status         TEXT    NOT NULL CHECK (status IN ('pending', 'delivered')),
        attempts       INTEGER NOT NULL DEFAULT 0,
        last_error     TEXT,
        created_at     INTEGER NOT NULL,
        delivered_at   INTEGER,
        UNIQUE (workspace_id, sequence)
      ) STRICT
    `)
    context.exec(`
      CREATE TABLE inbox_dedup (
        consumer     TEXT    NOT NULL,
        event_id     TEXT    NOT NULL,
        processed_at INTEGER NOT NULL,
        PRIMARY KEY (consumer, event_id)
      ) STRICT
    `)
    // The delivery loop scans undelivered events per workspace in stream order.
    context.exec('CREATE INDEX outbox_pending ON outbox (status, workspace_id, sequence)')
  },
}

/**
 * Every migration this build knows, in application order.
 *
 * Tables are added by the migration of the entity that implements them: the
 * domain repositories arrive in MW-006/MW-008/MW-010 and append their own
 * versions here.
 */
export const MYWORK_MIGRATIONS: readonly Migration[] = Object.freeze([OUTBOX_INBOX])

/** Schema version this build produces: the latest known migration. */
export const MYWORK_SCHEMA_VERSION: number = MYWORK_MIGRATIONS[MYWORK_MIGRATIONS.length - 1]?.version ?? 0

/** Journal table, created before any migration runs so it can record them. */
const JOURNAL_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER NOT NULL PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at INTEGER NOT NULL
  ) STRICT
`

/**
 * Validate a migration list before it touches a database.
 * @param migrations - candidate list.
 * @throws {StorageError} `invalid-input` for a malformed, duplicated, or
 * out-of-order version.
 */
export function validateMigrations(migrations: readonly Migration[]): readonly Migration[] {
  let previous = 0
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new StorageError('invalid-input', `dsh-mywork: migration version must be a positive integer, received ${String(migration.version)}`)
    }
    if (migration.version <= previous) {
      throw new StorageError('invalid-input', `dsh-mywork: migrations must be ordered by unique version, ${migration.version} follows ${previous}`)
    }
    if (typeof migration.name !== 'string' || migration.name.trim().length === 0) {
      throw new StorageError('invalid-input', `dsh-mywork: migration ${migration.version} needs a non-empty name`)
    }
    if (typeof migration.up !== 'function') {
      throw new StorageError('invalid-input', `dsh-mywork: migration ${migration.version} needs an up(context) function`)
    }
    previous = migration.version
  }
  return migrations
}

/**
 * Bring a database up to the version the given migrations describe.
 *
 * The write lock is taken before the version is re-read, so two processes
 * opening the same file concurrently apply each migration exactly once, and a
 * version newer than this build understands is refused instead of downgraded.
 * @param connection - open connection.
 * @param migrations - ordered migrations; already validated by the caller.
 * @param clock - time source for journal rows.
 * @throws {StorageError} `schema-version-unsupported` or `migration-failed`.
 */
export function runMigrations(
  connection: SqliteConnection,
  migrations: readonly Migration[],
  clock: StorageClock,
): void {
  connection.exec(JOURNAL_DDL)
  const latest = migrations[migrations.length - 1]?.version ?? 0
  let applied = connection.userVersion()
  if (applied > latest) {
    throw new StorageError(
      'schema-version-unsupported',
      `dsh-mywork: database is at schema version ${applied}, this build knows ${latest}; refusing to open newer state`,
      { details: { onDisk: applied, supported: latest } },
    )
  }
  for (const migration of migrations) {
    if (migration.version <= applied) continue
    try {
      const committed = withTransaction(connection, (): boolean => {
        // Re-read under the write lock: another process may have applied this
        // migration while we waited for it.
        if (connection.userVersion() >= migration.version) return false
        migration.up(connection)
        connection.run(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          migration.version,
          migration.name,
          clock.now(),
        )
        connection.setUserVersion(migration.version)
        return true
      })
      if (committed) applied = migration.version
    } catch (error) {
      if (error instanceof StorageError && error.code === 'schema-version-unsupported') throw error
      throw new StorageError(
        'migration-failed',
        `dsh-mywork: migration ${migration.version} (${migration.name}) failed; the database stays at version ${connection.userVersion()}`,
        { details: { version: migration.version, name: migration.name, at: connection.userVersion() }, cause: error },
      )
    }
  }
}

/**
 * Journal rows of one database, oldest first.
 * @param executor - connection to read through.
 */
export function listAppliedMigrations(executor: SqlExecutor): readonly AppliedMigration[] {
  return executor
    .all('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
    .map(row => ({
      version: Number(row.version),
      name: String(row.name),
      appliedAt: Number(row.applied_at),
    }))
}
