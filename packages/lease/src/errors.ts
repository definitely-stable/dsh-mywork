/**
 * Failures the MyWork lease layer raises.
 *
 * These codes are lease-local for the same reason the storage and evidence codes
 * are (MW-004 §7.2, MW-008 §7): architecture §42 closes the domain error
 * vocabulary, and "another controller holds this scope" is not one of its
 * thirteen outcomes. A caller that answers with a `Result` maps a
 * {@link LeaseError} onto the domain code that fits its operation — `LEASE_LOST`
 * for a superseded epoch, which the core guards already produce.
 * @module
 */

/** Every failure the lease layer can raise. */
export type LeaseErrorCode =
  /** The caller passed a value the store cannot accept (blank id, negative window). */
  | 'invalid-input'
  /** The lease is held by another instance, or is expired but was claimed by someone else first. */
  | 'lease-held'
  /** This instance is no longer the holder, or holds a superseded epoch. */
  | 'lease-lost'
  /** The database was opened without the lease migration. */
  | 'schema-missing'

/** Every lease error code, so a test or a doctor can pin the vocabulary. */
export const LEASE_ERROR_CODES: readonly LeaseErrorCode[] = Object.freeze([
  'invalid-input',
  'lease-held',
  'lease-lost',
  'schema-missing',
])

/** Options accepted by the {@link LeaseError} constructor. */
export interface LeaseErrorOptions {
  /** Structured context for logs and diagnostics (scope, epoch, holder). */
  readonly details?: Readonly<Record<string, unknown>>
  /** Underlying cause, when the failure wraps a SQLite error. */
  readonly cause?: unknown
}

/** Failure raised by the lease layer. */
export class LeaseError extends Error {
  /** Machine-readable failure code. */
  readonly code: LeaseErrorCode

  /** Structured context for logs and diagnostics. */
  readonly details: Readonly<Record<string, unknown>>

  /**
   * @param code - stable lease failure code.
   * @param message - human-readable detail; never parsed by callers.
   * @param options - optional structured details and cause.
   */
  constructor(code: LeaseErrorCode, message: string, options: LeaseErrorOptions = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause })
    this.name = 'LeaseError'
    this.code = code
    this.details = Object.freeze({ ...options.details })
  }
}

/**
 * Whether a value is a {@link LeaseError} raised by this layer.
 * @param value - the value to test.
 */
export function isLeaseError(value: unknown): value is LeaseError {
  return value instanceof LeaseError
}
