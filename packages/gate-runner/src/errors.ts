/**
 * Failures the MyWork gate runner raises.
 *
 * These codes are gate-runner-local for the same reason the storage, evidence,
 * and lease codes are (MW-004 §7.2, MW-008 §7): architecture §42 closes the
 * domain error vocabulary, and "this spec cannot be run" is not one of its
 * outcomes. The vocabulary a *verdict* travels in is different and lives in
 * `@dsh-mywork/contracts`: a caller maps {@link GateError} `duplicate-gate-id`
 * onto `GATE_DUPLICATE_ID`, `gate-unconfigured` onto `GATE_UNCONFIGURED`, and a
 * head that could not be read onto the attested run it refuses to produce.
 * @module
 */

/** Every failure the gate runner can raise. */
export type GateErrorCode =
  /** The spec is not a runnable gate: blank id or command, malformed args, an unbounded timeout, or a cwd outside the worktree. */
  | 'invalid-spec'
  /** The head a verdict would be pinned to is not a 40-character lowercase hex object name. */
  | 'invalid-head'
  /** The head of the worktree could not be read, so no verdict can be pinned to it. */
  | 'head-unavailable'
  /** Two gates of one policy share an identifier. */
  | 'duplicate-gate-id'
  /** The policy source holds no policy for the workspace that asked. */
  | 'gate-unconfigured'
  /** The policy itself is malformed, or one workspace was configured twice. */
  | 'invalid-policy'

/** Every gate error code, so a test or a doctor can pin the vocabulary. */
export const GATE_ERROR_CODES: readonly GateErrorCode[] = Object.freeze([
  'invalid-spec',
  'invalid-head',
  'head-unavailable',
  'duplicate-gate-id',
  'gate-unconfigured',
  'invalid-policy',
])

/** Options accepted by the {@link GateError} constructor. */
export interface GateErrorOptions {
  /** Structured context for logs and diagnostics (gate id, head, allowed values). */
  readonly details?: Readonly<Record<string, unknown>>
  /** Underlying cause, when the failure wraps a process or git failure. */
  readonly cause?: unknown
}

/** Failure raised by the gate runner. */
export class GateError extends Error {
  /** Machine-readable failure code. */
  readonly code: GateErrorCode

  /** Structured context for logs and diagnostics. */
  readonly details: Readonly<Record<string, unknown>>

  /**
   * @param code - stable gate-runner failure code.
   * @param message - human-readable detail; never parsed by callers.
   * @param options - optional structured details and cause.
   */
  constructor(code: GateErrorCode, message: string, options: GateErrorOptions = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause })
    this.name = 'GateError'
    this.code = code
    this.details = Object.freeze({ ...options.details })
  }
}

/**
 * Whether a value is a {@link GateError} raised by this layer.
 * @param value - the value to test.
 */
export function isGateError(value: unknown): value is GateError {
  return value instanceof GateError
}
