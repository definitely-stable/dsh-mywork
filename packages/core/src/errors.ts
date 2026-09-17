/**
 * Canonical error value and the `Result` constructors (architecture §42).
 * Everything the domain returns goes through these two helpers, so a failure is
 * always a typed code rather than a thrown adapter string.
 * @module
 */

import type { MyWorkErrorCode, MyWorkErrorShape, OperationMeta, Result } from '@dsh-mywork/contracts'

/** Options accepted by the {@link MyWorkError} constructor. */
export interface MyWorkErrorOptions {
  /** Structured context for logs and audit (expected/actual, ids). */
  details?: Readonly<Record<string, unknown>>
  /** Underlying cause, when the failure wraps another error. */
  cause?: unknown
}

/** Failure value of a failed `Result`, carrying a stable {@link MyWorkErrorCode}. */
export class MyWorkError extends Error implements MyWorkErrorShape {
  /** Machine-readable failure code. */
  readonly code: MyWorkErrorCode

  /** Structured context for logs and audit. */
  readonly details: Readonly<Record<string, unknown>>

  /**
   * @param code - stable failure code from architecture §42.
   * @param message - human-readable detail; never parsed by callers.
   * @param options - optional structured details and cause.
   */
  constructor(code: MyWorkErrorCode, message: string, options: MyWorkErrorOptions = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause })
    this.name = 'MyWorkError'
    this.code = code
    this.details = Object.freeze({ ...options.details })
  }
}

/**
 * Whether a value is a {@link MyWorkError} raised by the domain.
 * @param value - the value to test.
 */
export function isMyWorkError(value: unknown): value is MyWorkError {
  return value instanceof MyWorkError
}

/**
 * Successful result. The operation metadata is part of the value, so a caller
 * can always correlate the answer with the mutation it issued (§42).
 * @param value - the produced value.
 * @param meta - identity of the operation that produced it.
 */
export function ok<T>(value: T, meta: OperationMeta): Result<T> {
  const result: Result<T> = { ok: true, value, meta }
  return Object.freeze(result)
}

/**
 * Failed result.
 *
 * The parameter is the error shape rather than the class, so a caller can
 * propagate a failure produced for one payload through a function that returns
 * another payload without rebuilding the error.
 * @param error - the typed failure.
 * @param meta - identity of the operation that failed.
 */
export function fail<T = never>(error: MyWorkErrorShape, meta: OperationMeta): Result<T> {
  const result: Result<T> = { ok: false, error, meta }
  return Object.freeze(result)
}
