/**
 * The SQLite connection below the store: open sequence, pragmas, statement
 * execution, and the transaction primitive.
 *
 * The open sequence mirrors the harness' own SQLite backends
 * (`packages/storage/storage-sqlite`, `packages/session-query/session-query-sqlite`):
 * `node:sqlite` (no third-party driver), owner-only database file, foreign keys
 * on, WAL. Durability is a contract here, so a filesystem that refuses WAL
 * fails the open instead of silently degrading to a rollback journal.
 * @module
 */

import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { StorageError } from './errors.ts'

/** A value that may cross the SQLite boundary in either direction. */
export type SqlValue = null | number | bigint | string | Uint8Array

/** One result row. */
export type SqlRow = Record<string, SqlValue>

/** Statement surface shared by the connection and an open transaction. */
export interface SqlExecutor {
  /** Run one or more statements without binding. */
  exec(sql: string): void
  /**
   * Run one statement and count the rows it changed.
   * @returns the number of changed rows.
   */
  run(sql: string, ...params: SqlValue[]): number
  /**
   * Run one statement and read the first row.
   * @returns the row, or `undefined` when the statement matched nothing.
   */
  get(sql: string, ...params: SqlValue[]): SqlRow | undefined
  /** Run one statement and read every row. */
  all(sql: string, ...params: SqlValue[]): SqlRow[]
}

/** An open connection with the store's pragmas applied. */
export interface SqliteConnection extends SqlExecutor {
  /** Absolute database path. */
  readonly path: string
  /** `PRAGMA user_version`, the on-disk schema version. */
  userVersion(): number
  /** Stamp `PRAGMA user_version`; transactional, like any other write. */
  setUserVersion(version: number): void
  /** Close the connection. Statements afterwards fail. */
  close(): void
}

/** Inputs of {@link openSqlite}. */
export interface OpenSqliteOptions {
  /** Database file path. `:memory:` is rejected: this store is durable. */
  readonly path: string
  /** Milliseconds SQLite waits for a lock before reporting the database busy. */
  readonly busyTimeoutMs: number
  /**
   * Durability mode of the connection; `NORMAL` by default.
   *
   * In WAL a `NORMAL` commit survives a process crash and only risks the last
   * commits when the operating system itself dies; `FULL` is available for a
   * caller that wants to pay a fsync per commit (MW-004/039/040, F-35).
   */
  readonly synchronous?: 'NORMAL' | 'FULL'
}

/**
 * Exclusively create a missing database file with owner-only permissions.
 * An existing file keeps its mode; every error other than `EEXIST` propagates.
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open the database and apply its pragmas.
 * @param options - database path and lock timeout.
 * @returns the configured connection.
 * @throws {StorageError} `invalid-input` for an in-memory path or an unusable
 * journal mode, with the filesystem error as cause when the open itself failed.
 */
export async function openSqlite(options: OpenSqliteOptions): Promise<SqliteConnection> {
  if (options.path === ':memory:' || options.path.trim().length === 0) {
    throw new StorageError(
      'invalid-input',
      `dsh-mywork: the state store is durable by contract, "${options.path}" is not a database file`,
    )
  }
  const path = resolve(options.path)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await createDatabaseFile(path)

  const database = new DatabaseSync(path, { timeout: options.busyTimeoutMs })
  try {
    configure(database, path, options.synchronous ?? 'NORMAL')
  } catch (error) {
    database.close()
    throw error
  }

  const connection: SqliteConnection = {
    path,
    exec: (sql: string): void => {
      database.exec(sql)
    },
    run: (sql: string, ...params: SqlValue[]): number => {
      return Number(database.prepare(sql).run(...params).changes)
    },
    get: (sql: string, ...params: SqlValue[]): SqlRow | undefined => {
      return database.prepare(sql).get(...params)
    },
    all: (sql: string, ...params: SqlValue[]): SqlRow[] => {
      return database.prepare(sql).all(...params)
    },
    userVersion: (): number => readUserVersion(database),
    setUserVersion: (version: number): void => {
      database.exec(`PRAGMA user_version = ${Math.trunc(version)}`)
    },
    close: (): void => {
      database.close()
    },
  }
  return connection
}

/**
 * Apply the pragmas this store requires and prove the journal mode took.
 *
 * `WAL` and `foreign_keys` were already here; F-35 closes the two gaps that
 * remained: `synchronous = NORMAL` (the WAL recommendation — a process crash
 * still cannot lose a committed transaction) and `auto_vacuum = INCREMENTAL`,
 * which returns pages to the filesystem as they are freed instead of only on an
 * explicit `VACUUM` (F-39). SQLite only honours `auto_vacuum` when it is set
 * before the first table exists, so a database created earlier keeps the old
 * mode until `compact()` vacuums it once.
 */
function configure(database: DatabaseSync, path: string, synchronous: 'NORMAL' | 'FULL'): void {
  database.exec('PRAGMA foreign_keys = ON')
  // `auto_vacuum` must be set while the database still has no schema: switching
  // the journal mode to WAL already writes page 1, after which SQLite silently
  // ignores the pragma until a VACUUM runs.
  database.exec('PRAGMA auto_vacuum = INCREMENTAL')
  database.exec('PRAGMA journal_mode = WAL')
  const journalMode = database.prepare('PRAGMA journal_mode').get() as { journal_mode?: unknown } | undefined
  if (journalMode?.journal_mode !== 'wal') {
    throw new StorageError(
      'invalid-input',
      `dsh-mywork: "${path}" refused WAL (journal_mode=${String(journalMode?.journal_mode)}); a durable store does not run on a rollback journal`,
      { details: { path, journalMode: journalMode?.journal_mode ?? null } },
    )
  }
  database.exec(`PRAGMA synchronous = ${synchronous}`)
}

/** `PRAGMA user_version` always answers exactly one row. */
function readUserVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as { user_version: number }
  return row.user_version
}

/**
 * Run `body` inside one write transaction.
 *
 * `BEGIN IMMEDIATE` takes the write lock up front, so a mutation and the
 * outbox rows it appends (§48) cannot interleave with another writer, and a
 * throw rolls the whole unit back: there is no observable half-mutation.
 * @param connection - open connection.
 * @param body - synchronous statements to run inside the transaction.
 * @returns whatever `body` returned, after the commit.
 */
export function withTransaction<T>(connection: SqlExecutor, body: () => T): T {
  connection.exec('BEGIN IMMEDIATE')
  let value: T
  try {
    value = body()
  } catch (error) {
    rollbackQuietly(connection)
    throw error
  }
  try {
    connection.exec('COMMIT')
  } catch (error) {
    rollbackQuietly(connection)
    throw error
  }
  return value
}

/** Roll back, tolerating a transaction that is already gone. */
function rollbackQuietly(connection: SqlExecutor): void {
  try {
    connection.exec('ROLLBACK')
  } catch {
    // The transaction was already rolled back or aborted by SQLite itself;
    // the original failure is the one worth reporting.
  }
}
