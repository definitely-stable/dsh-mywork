/**
 * Failures the MyWork storage layer raises.
 *
 * These codes are storage-local on purpose: architecture §42 closes the domain
 * error vocabulary, and a schema or transaction fault is not a domain outcome.
 * A repository that answers with a `Result` maps a {@link StorageError} to the
 * domain code that fits its operation.
 * @module
 */

/** Every failure the storage layer can raise. */
export type StorageErrorCode =
  /** The caller passed a value the store cannot accept (bad id, non-JSON payload). */
  | 'invalid-input'
  /** A referenced row does not exist. */
  | 'not-found'
  /** The event id is already recorded with different content, or a write raced. */
  | 'conflict'
  /** The database on disk was written by a newer schema than this build knows. */
  | 'schema-version-unsupported'
  /** A migration threw; the database stays at the version it had before it. */
  | 'migration-failed'
  /** Transactions do not nest, and the store cannot close inside one. */
  | 'transaction-conflict'
  /** The store was closed; no further statement may run. */
  | 'store-closed'
  /**
   * The caller opened a store without an explicit migration list. A store that
   * picks its own list silently declares a partial database complete (D08).
   */
  | 'migrations-required'
  /** The journal disagrees with the version stamp: rows are missing or ahead. */
  | 'migration-journal-inconsistent'

/** Every storage error code, so a test or a doctor can pin the vocabulary. */
export const STORAGE_ERROR_CODES: readonly StorageErrorCode[] = Object.freeze([
  'invalid-input',
  'not-found',
  'conflict',
  'schema-version-unsupported',
  'migration-failed',
  'transaction-conflict',
  'store-closed',
  'migrations-required',
  'migration-journal-inconsistent',
])

/**
 * Opening a store without an explicit migration list (D08). Spelled as a named
 * constant because the plan and its verifier look for this identifier; the
 * value follows the repository's kebab-case error vocabulary.
 */
export const MIGRATIONS_REQUIRED: StorageErrorCode = 'migrations-required'

/**
 * The `schema_migrations` journal does not describe the database stamped by
 * `PRAGMA user_version`: rows are missing, or they run ahead of the stamp.
 */
export const MIGRATION_JOURNAL_INCONSISTENT: StorageErrorCode = 'migration-journal-inconsistent'

/** Options accepted by the {@link StorageError} constructor. */
export interface StorageErrorOptions {
  /** Structured context for logs and diagnostics (version, ids, counts). */
  readonly details?: Readonly<Record<string, unknown>>
  /** Underlying cause, when the failure wraps a SQLite or filesystem error. */
  readonly cause?: unknown
}

/** Failure raised by the storage layer. */
export class StorageError extends Error {
  /** Machine-readable failure code. */
  readonly code: StorageErrorCode

  /** Structured context for logs and diagnostics. */
  readonly details: Readonly<Record<string, unknown>>

  /**
   * @param code - stable storage failure code.
   * @param message - human-readable detail; never parsed by callers.
   * @param options - optional structured details and cause.
   */
  constructor(code: StorageErrorCode, message: string, options: StorageErrorOptions = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause })
    this.name = 'StorageError'
    this.code = code
    this.details = Object.freeze({ ...options.details })
  }
}

/**
 * Whether a value is a {@link StorageError} raised by this layer.
 * @param value - the value to test.
 */
export function isStorageError(value: unknown): value is StorageError {
  return value instanceof StorageError
}
