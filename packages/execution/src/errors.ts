/**
 * Refusals of the claim saga (architecture §9, §17, §49).
 *
 * The saga reports its own conditions — a missing schema, a malformed request, an
 * operation that is not open — as typed errors, so a caller can branch on a code
 * instead of parsing a message. The domain refusals a caller acts on
 * (`STALE_REVISION`, `LEASE_LOST`, `STALE_FENCE`, `TASK_CONFLICT`) come from
 * `@dsh-mywork/core` and `Result`, not from here.
 * @module
 */

/** Machine-readable failure codes of this layer. */
export type ExecutionErrorCode =
  /** The database lacks a schema this layer writes through. */
  | 'schema-missing'
  /** A request is malformed; no store was touched. */
  | 'invalid-input'
  /** The named claim operation does not exist. */
  | 'not-found'
  /** The operation exists but is not in a state this call may act on. */
  | 'conflict'

/** Options carried by an {@link ExecutionError}. */
export interface ExecutionErrorOptions {
  /** Structured context for logs and the audit. */
  readonly details?: Readonly<Record<string, unknown>>
  /** Underlying failure, when this one wraps another. */
  readonly cause?: unknown
}

/**
 * A refusal raised by this layer.
 *
 * `code` is read structurally by callers rather than through `instanceof`,
 * because every package in this workspace bundles its dependencies and therefore
 * carries its own copy of the class (the same reason `planner` does it).
 */
export class ExecutionError extends Error {
  /** Stable failure code. */
  readonly code: ExecutionErrorCode
  /** Structured context for logs and the audit. */
  readonly details: Readonly<Record<string, unknown>>

  /**
   * @param code - stable failure code.
   * @param message - human-readable detail; never parsed by callers.
   * @param options - structured context and an optional cause.
   */
  constructor(code: ExecutionErrorCode, message: string, options: ExecutionErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ExecutionError'
    this.code = code
    this.details = Object.freeze({ ...(options.details ?? {}) })
  }
}

/**
 * Whether a value is a refusal from this layer.
 *
 * A structural check, not `instanceof`: the built package inlines its
 * dependencies, so a caller in another bundle sees a different class object for
 * the same error.
 * @param error - value to inspect.
 */
export function isExecutionError(error: unknown): error is ExecutionError {
  return (
    typeof error === 'object'
    && error !== null
    && (error as { readonly name?: unknown }).name === 'ExecutionError'
    && typeof (error as { readonly code?: unknown }).code === 'string'
  )
}
