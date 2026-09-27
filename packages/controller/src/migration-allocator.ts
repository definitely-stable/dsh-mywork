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
 * The book is one database while the numbers land in the journals of others, so
 * losing the book must not renumber them: {@link AllocationAdoption} lets the
 * caller hand back the versions the numbered databases already recorded, and an
 * adopted request keeps its number instead of taking a fresh one (F-63b).
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

/**
 * A version one numbered database already recorded for a request (F-63b).
 *
 * The allocator's book is one database (`registry.sqlite`), and the numbers it
 * hands out are written into the journal of another (`controller.sqlite`). When
 * the book is lost — the file deleted, restored from an older copy, or the state
 * directory rebuilt — the numbers must be **recovered from the journal that
 * recorded them**, not re-derived from the book's emptiness: re-deriving them
 * renumbers a migration onto a version another migration already owns, and the
 * journal check compares versions only, so the store opens with the wrong name
 * behind a version and the migration that should have run never does.
 */
export interface AllocationAdoption {
  /** The request the version was recorded for. */
  readonly key: string
  /** The version the database's journal records for that request. */
  readonly version: number
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
  /**
   * Versions the databases this allocator numbers already recorded, recovered
   * from their migration journals (see {@link AllocationAdoption}). An adopted
   * request keeps its recorded number and the adoption is written back into the
   * book, so the loss that made the recovery necessary heals on this open.
   */
  readonly adopt?: readonly AllocationAdoption[]
}

/** Every failure the allocator raises. */
export type MigrationAllocatorErrorCode =
  /** The request or the adoption is malformed. */
  | 'invalid-request'
  /** The version being recorded is already owned by another request. */
  | 'version-conflict'

/** Options accepted by the {@link MigrationAllocatorError} constructor. */
export interface MigrationAllocatorErrorOptions {
  /** Underlying SQLite or caller failure, when the error wraps one. */
  readonly cause?: unknown
}

/** Failures the allocator raises. */
export class MigrationAllocatorError extends Error {
  /** Machine-readable failure code. */
  readonly code: MigrationAllocatorErrorCode

  /**
   * @param code - stable failure code.
   * @param message - human-readable detail.
   * @param options - optional underlying cause.
   */
  constructor(code: MigrationAllocatorErrorCode, message: string, options: MigrationAllocatorErrorOptions = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause })
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
 * The highest version the book's own schema occupies.
 *
 * Two sources, because a version may have been consumed without a request row
 * surviving: the applied migrations and the version stamp. Request rows are
 * deliberately **not** part of this number — a request that holds a higher
 * number is a later allocation, not a claim on an adopted one; the
 * `UNIQUE(version)` constraint is what refuses a request that really does hold
 * the same number (see the insert in `allocate`).
 * @param tx - statement surface of the book's transaction.
 */
function occupiedBySchema(tx: AllocationExecutor): number {
  const journal = hasTable(tx, 'schema_migrations')
    ? count(tx.get('SELECT MAX(version) AS version FROM schema_migrations')?.version)
    : 0
  const stamp = count(tx.get('PRAGMA user_version')?.user_version)
  return Math.max(journal, stamp)
}

/**
 * The highest version that is already taken.
 *
 * A number is never reused while any of the three sources remembers it — the
 * book's own schema, the requests on file, and the versions adopted from other
 * journals — so a request that is new to this book cannot take a number another
 * database already recorded.
 * @param tx - statement surface of the book's transaction.
 * @param extra - versions recovered from other journals, if any.
 */
function highestOccupied(tx: AllocationExecutor, extra: readonly number[]): number {
  const requests = count(tx.get(`SELECT MAX(version) AS version FROM ${ALLOCATIONS_TABLE}`)?.version)
  return Math.max(occupiedBySchema(tx), requests, ...extra)
}

/**
 * The adoptions as a lookup, refused when malformed or self-contradicting.
 *
 * A duplicated version across two keys is refused here rather than at the first
 * insert: two requests claiming one number is a defect of the caller's recovery,
 * and finding it before the transaction starts keeps the message about the
 * recovery instead of about a SQLite constraint.
 * @param adoptions - recovered versions.
 * @throws {MigrationAllocatorError} `invalid-request` for a blank key, a
 *   non-positive version, or one version recorded for two requests.
 */
function adoptionIndex(adoptions: readonly AllocationAdoption[]): ReadonlyMap<string, number> {
  const index = new Map<string, number>()
  const owners = new Map<number, string>()
  for (const adoption of adoptions) {
    const key = keyOf(adoption)
    const version = adoption.version
    if (!Number.isInteger(version) || version < 1) {
      throw new MigrationAllocatorError(
        'invalid-request',
        `dsh-mywork: an adopted version must be a positive integer, received ${String(version)} for "${key}"`,
      )
    }
    const owner = owners.get(version)
    if (owner !== undefined) {
      throw new MigrationAllocatorError(
        'invalid-request',
        `dsh-mywork: version ${version} is recorded for both "${owner}" and "${key}"; one number cannot belong to two migrations`,
      )
    }
    owners.set(version, key)
    index.set(key, version)
  }
  return index
}

/**
 * Create the version allocator of one store.
 * @param store - an open MyWork store (or anything with the same transaction port).
 * @param options - optional clock for `requested_at` and adopted versions.
 * @returns the allocator; every call runs in a single transaction.
 * @throws {MigrationAllocatorError} `invalid-request` when an adoption is malformed.
 */
export function createMigrationAllocator(
  store: AllocationStore,
  options: MigrationAllocatorOptions = {},
): MigrationAllocator {
  const now = options.now ?? Date.now
  const adopted = adoptionIndex(options.adopt ?? [])
  const adoptedVersions = Object.freeze([...adopted.values()])
  return {
    allocate(request: MigrationRequest): number {
      const key = keyOf(request)
      return store.transaction(tx => {
        tx.exec(ALLOCATIONS_DDL)
        const existing = tx.get(`SELECT version FROM ${ALLOCATIONS_TABLE} WHERE key = ?`, key)
        if (existing !== undefined) return count(existing.version)
        const recorded = adopted.get(key)
        if (recorded !== undefined) {
          // The number came from the journal of the database this book numbers.
          // A number that the book's own schema already occupies means two
          // migrations claim one version; refusing here names the recovery
          // rather than failing later inside the migration set.
          const schemaFloor = occupiedBySchema(tx)
          if (recorded <= schemaFloor) {
            throw new MigrationAllocatorError(
              'version-conflict',
              `dsh-mywork: the journal records version ${recorded} for "${key}", but this book's own schema already occupies ${schemaFloor}; `
                + 'the two databases disagree about which migration owns that number',
            )
          }
        }
        const version = recorded ?? highestOccupied(tx, adoptedVersions) + 1
        try {
          tx.run(
            `INSERT INTO ${ALLOCATIONS_TABLE} (key, version, requested_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`,
            key,
            version,
            now(),
          )
        } catch (error) {
          throw new MigrationAllocatorError(
            'version-conflict',
            `dsh-mywork: version ${version} could not be recorded for "${key}"; another request already owns it`,
            { cause: error },
          )
        }
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
