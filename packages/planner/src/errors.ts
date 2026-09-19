/**
 * Failures the MyWork planner raises.
 *
 * These codes are planner-local for the same reason the storage, evidence, and
 * lease codes are (MW-004 §7.2, MW-008 §7, MW-009 §7): architecture §42 closes the
 * domain error vocabulary, and "the database was opened without the plan schema"
 * or "this gate is not open" are not among its outcomes. A caller that answers
 * with a `Result` maps a {@link PlanError} onto the domain code that fits the
 * operation.
 * @module
 */

/** Every failure the planner can raise. */
export type PlanErrorCode =
  /** The caller passed a value the layer cannot accept (blank id, missing actor). */
  | 'invalid-input'
  /** The operation the caller named is unknown. */
  | 'not-found'
  /** The operation is in a state that does not allow what was asked. */
  | 'conflict'
  /** The database was opened without the plan-mutation or evidence migration. */
  | 'schema-missing'
  /** The plan revision moved while the operation was being committed. */
  | 'stale-revision'

/** Every planner error code, so a test or a doctor can pin the vocabulary. */
export const PLAN_ERROR_CODES: readonly PlanErrorCode[] = Object.freeze([
  'invalid-input',
  'not-found',
  'conflict',
  'schema-missing',
  'stale-revision',
])

/** Options accepted by the {@link PlanError} constructor. */
export interface PlanErrorOptions {
  /** Structured context for logs and diagnostics (ids, states, revisions). */
  readonly details?: Readonly<Record<string, unknown>>
  /** Underlying cause, when the failure wraps another error. */
  readonly cause?: unknown
}

/** Failure raised by the planner layer. */
export class PlanError extends Error {
  /** Machine-readable failure code. */
  readonly code: PlanErrorCode

  /** Structured context for logs and diagnostics. */
  readonly details: Readonly<Record<string, unknown>>

  /**
   * @param code - stable planner failure code.
   * @param message - human-readable detail; never parsed by callers.
   * @param options - optional structured details and cause.
   */
  constructor(code: PlanErrorCode, message: string, options: PlanErrorOptions = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause })
    this.name = 'PlanError'
    this.code = code
    this.details = Object.freeze({ ...options.details })
  }
}

/**
 * Whether a value is a {@link PlanError} raised by this layer.
 * @param value - the value to test.
 */
export function isPlanError(value: unknown): value is PlanError {
  return value instanceof PlanError
}
