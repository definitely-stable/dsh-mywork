/**
 * The single place that hands out schema migration versions (F-63, §15.3).
 *
 * A version request is identified by a stable key (`'background_job'`,
 * `'retention-triggers'`, …), never by a file name, a position in a list, or a
 * number typed by hand. The number a request receives is remembered in
 * `migration_allocations`, so a restart cannot re-issue it, and `UNIQUE(version)`
 * makes two requests sharing a number impossible. The table is created by the
 * storage bootstrap before any migration runs, which is why the allocator needs
 * no migration version of its own.
 *
 * This module is the composition layer's (`packages/controller`, D07). It talks
 * to a store through a structural port and imports the storage package for
 * types only, so the controller keeps its single external import
 * (`@deepseek-ai/cordis`) and the allocator stays usable in isolation.
 * @module
 */

import type { SqlExecutor, SqlRow, SqlValue } from '@dsh-mywork/storage'

/** Statement surface the allocator needs; the store's transaction satisfies it. */
export type AllocationExecutor = SqlExecutor

/** One result row. */
export type AllocationRow = SqlRow

/** A value that may cross the SQLite boundary. */
export type AllocationValue = SqlValue

/** A store the allocator can work inside; `MyWorkStore` satisfies it. */
export interface AllocationStore {
  /**
   * Run one write transaction.
   * @param body - synchronous body; its return value is returned after the commit.
   */
  transaction<T>(body: (tx: AllocationExecutor) => T): T
}

/** One request for a version. */
export interface MigrationRequest {
  /** Stable identifier of the request (`'background_job'`), never a number. */
  readonly key: string
}

/** A version handed to one request. */
export interface Allocation {
  /** The request it was handed to. */
  readonly key: string
  /** The version it received; unique for the lifetime of the database. */
  readonly version: number
  /** Clock reading of the allocation. */
  readonly requestedAt: number
}

/** The version allocator. */
export interface MigrationAllocator {
  /**
   * Hand the request its version, allocating one on first sight.
   * @param request - the request, identified by a stable key.
   * @returns the version, the same one on every later call for that key.
   * @throws {MigrationAllocatorError} `invalid-request` for a blank key.
   */
  allocate(request: MigrationRequest): number
  /** Every allocation made so far, oldest version first. */
  allocated(): readonly Allocation[]
}

/** Options of {@link createMigrationAllocator}. */
export interface MigrationAllocatorOptions {
  /** Time source for `requested_at`; defaults to `Date.now`. */
  readonly now?: () => number
}

/** Failures the allocator raises. */
export class MigrationAllocatorError extends Error {
  /** Machine-readable failure code. */
  readonly code: 'invalid-request'

  /**
   * @param code - stable failure code.
   * @param message - human-readable detail.
   */
  constructor(code: 'invalid-request', message: string) {
    super(message)
    this.name = 'MigrationAllocatorError'
    this.code = code
  }
}

/**
 * Whether a value is a failure raised by this module.
 * @param value - the value to test.
 */
export function isMigrationAllocatorError(value: unknown): value is MigrationAllocatorError {
  return value instanceof MigrationAllocatorError
}

/** Table of requests, created by the storage bootstrap before any migration. */
const ALLOCATIONS_TABLE = 'migration_allocations'

/**
 * Restated here because the controller cannot import a value from the storage
 * package at runtime (its manifest does not depend on it). `IF NOT EXISTS`
 * makes this a no-op on every store this build opened; it only matters for a
 * database that predates the bootstrap table (F-63, fact 2).
 */
const ALLOCATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS migration_allocations (
    key          TEXT    NOT NULL PRIMARY KEY,
    version      INTEGER NOT NULL UNIQUE,
    requested_at INTEGER NOT NULL
  ) STRICT
`

/** A value read back from SQLite, as a number. */
function count(value: AllocationValue | undefined): number {
  if (value === undefined || value === null) return 0
  return Number(value)
}

/** The request key, refused when it is missing or blank. */
function keyOf(request: MigrationRequest): string {
  const key = request?.key
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new MigrationAllocatorError(
      'invalid-request',
      'dsh-mywork: a migration request needs a stable, non-empty key (for example "background_job")',
    )
  }
  return key.trim()
}

/** Whether one table exists in this database. */
function hasTable(tx: AllocationExecutor, name: string): boolean {
  return tx.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name) !== undefined
}

/**
 * The highest version that is already taken.
 *
 * Three sources, because a version may have been consumed without a request row
 * surviving: the applied migrations, the version stamp, and the requests on
 * file. A number is never reused while any of them remembers it.
 */
function highestOccupied(tx: AllocationExecutor): number {
  const journal = hasTable(tx, 'schema_migrations')
    ? count(tx.get('SELECT MAX(version) AS version FROM schema_migrations')?.version)
    : 0
  const requests = count(tx.get(`SELECT MAX(version) AS version FROM ${ALLOCATIONS_TABLE}`)?.version)
  const stamp = count(tx.get('PRAGMA user_version')?.user_version)
  return Math.max(journal, requests, stamp)
}

/**
 * Create the version allocator of one store.
 * @param store - an open MyWork store (or anything with the same transaction port).
 * @param options - optional clock for `requested_at`.
 * @returns the allocator; every call runs in a single transaction.
 */
export function createMigrationAllocator(
  store: AllocationStore,
  options: MigrationAllocatorOptions = {},
): MigrationAllocator {
  const now = options.now ?? Date.now
  return {
    allocate(request: MigrationRequest): number {
      const key = keyOf(request)
      return store.transaction(tx => {
        tx.exec(ALLOCATIONS_DDL)
        const existing = tx.get(`SELECT version FROM ${ALLOCATIONS_TABLE} WHERE key = ?`, key)
        if (existing !== undefined) return count(existing.version)
        const version = highestOccupied(tx) + 1
        tx.run(
          `INSERT INTO ${ALLOCATIONS_TABLE} (key, version, requested_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`,
          key,
          version,
          now(),
        )
        const row = tx.get(`SELECT version FROM ${ALLOCATIONS_TABLE} WHERE key = ?`, key)
        if (row === undefined) {
          throw new MigrationAllocatorError('invalid-request', `dsh-mywork: the allocation for "${key}" was not recorded`)
        }
        return count(row.version)
      })
    },

    allocated(): readonly Allocation[] {
      return store.transaction(tx => {
        tx.exec(ALLOCATIONS_DDL)
        return tx
          .all(`SELECT key, version, requested_at FROM ${ALLOCATIONS_TABLE} ORDER BY version`)
          .map(row => Object.freeze({
            key: String(row.key),
            version: count(row.version),
            requestedAt: count(row.requested_at),
          }))
      })
    },
  }
}
