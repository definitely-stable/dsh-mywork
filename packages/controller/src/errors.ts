/**
 * Failures the controller runtime raises before it can admit any work (MW-028).
 *
 * These codes are runtime-local for the same reason the lease and plan codes are:
 * architecture §42 closes the domain error vocabulary, and "this deployment is
 * not the leader" is not one of its outcomes. A caller that answers with a
 * `Result` maps a {@link ControllerRuntimeError} onto the domain code that fits
 * its operation — `LEASE_LOST` for a superseded controller, `UNAVAILABLE` for a
 * deployment that never became active.
 * @module
 */

/** Every failure the controller runtime can raise. */
export type ControllerRuntimeErrorCode =
  /** The caller passed a value the runtime cannot accept (unknown mode, blank id, bad window). */
  | 'invalid-input'
  /** The operation needs an active controller and this one is passive, disposed, or idle. */
  | 'not-active'
  /** A durable admission hold still stands, so admission may not be resumed yet. */
  | 'hold-still-open'
  /** Shutdown already began; new work may no longer be registered or admitted. */
  | 'shutting-down'

/** Every runtime error code, so a test or a doctor can pin the vocabulary. */
export const CONTROLLER_RUNTIME_ERROR_CODES: readonly ControllerRuntimeErrorCode[] = Object.freeze([
  'invalid-input',
  'not-active',
  'hold-still-open',
  'shutting-down',
])

/** Options accepted by the {@link ControllerRuntimeError} constructor. */
export interface ControllerRuntimeErrorOptions {
  /** Structured context for logs and diagnostics (mode, phase, hold id). */
  readonly details?: Readonly<Record<string, unknown>>
  /** Underlying cause, when the failure wraps another layer's error. */
  readonly cause?: unknown
}

/** Failure raised by the embedded/resident controller runtime. */
export class ControllerRuntimeError extends Error {
  /** Machine-readable failure code. */
  readonly code: ControllerRuntimeErrorCode

  /** Structured context for logs and diagnostics. */
  readonly details: Readonly<Record<string, unknown>>

  /**
   * @param code - stable runtime failure code.
   * @param message - human-readable detail; never parsed by callers.
   * @param options - optional structured details and cause.
   */
  constructor(code: ControllerRuntimeErrorCode, message: string, options: ControllerRuntimeErrorOptions = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause })
    this.name = 'ControllerRuntimeError'
    this.code = code
    this.details = Object.freeze({ ...options.details })
  }
}

/**
 * Whether a value is a {@link ControllerRuntimeError} raised by this layer.
 * @param value - the value to test.
 */
export function isControllerRuntimeError(value: unknown): value is ControllerRuntimeError {
  return value instanceof ControllerRuntimeError
}
