/**
 * Adapter error vocabulary: one typed error every adapter implementation
 * raises, so callers branch on a stable code instead of on provider text.
 * @module
 */

/** Machine-readable adapter failure codes. */
export type AdapterErrorCode =
  /** Backend is unreachable or not yet configured. */
  | 'unavailable'
  /** The referenced entity does not exist or is outside the caller's scope. */
  | 'invalid-ref'
  /** The operation conflicts with current state (duplicate id, stale revision). */
  | 'conflict'
  /** The adapter and the caller disagree about the contract revision. */
  | 'version-mismatch'
  /** The operation exceeded its deadline. */
  | 'timeout'
  /** Caller cancellation. */
  | 'cancelled'

/** Error raised by an adapter, carrying a stable {@link AdapterErrorCode}. */
export class AdapterError extends Error {
  /** Machine-readable failure code. */
  readonly code: AdapterErrorCode

  /**
   * @param code - the failure code.
   * @param message - human-readable detail.
   * @param options - optional underlying cause.
   */
  constructor(code: AdapterErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AdapterError'
    this.code = code
  }
}

/**
 * Whether a value is an {@link AdapterError} raised by an adapter.
 * @param value - the value to test.
 */
export function isAdapterError(value: unknown): value is AdapterError {
  return value instanceof AdapterError
}
