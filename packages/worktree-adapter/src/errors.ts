/**
 * Failures the worktree adapter raises (architecture §19, §42; MW-021).
 *
 * A port call answers with a {@link Result}, so a refusal *of the domain* travels
 * as a typed `MyWorkError` inside one. This class is for the two faults that are
 * not domain outcomes and that no `MyWorkErrorCode` names:
 *
 * - `invalid-input`: the caller's policy or request is malformed, so nothing was
 *   attempted and there is no state to report;
 * - `git-not-found`: the `git` executable could not be started at all. The
 *   deployment is misconfigured, and a caller cannot act on a `Result` that says
 *   "the tool this port is made of is missing" — it has to fix the environment.
 *
 * A `git` process that *ran* and refused is neither: its own exit status and
 * stderr become a `MyWorkError` inside a failed `Result`, so the caller sees what
 * git said.
 * @module
 */

/** Every failure the adapter raises before or instead of a port answer. */
export type WorktreeAdapterErrorCode =
  /** The policy or the request is malformed. */
  | 'invalid-input'
  /** `git` could not be started (absent from PATH, not executable). */
  | 'git-not-found'
  /** `git` ran and the command failed, with no domain refusal to map it to. */
  | 'git-failed'

/** Options accepted by the {@link WorktreeAdapterError} constructor. */
export interface WorktreeAdapterErrorOptions {
  /** Structured context for logs and evidence (command, cwd, exit status). */
  readonly details?: Readonly<Record<string, unknown>>
  /** Underlying cause, when the failure wraps one. */
  readonly cause?: unknown
}

/** Failures the worktree adapter raises. */
export class WorktreeAdapterError extends Error {
  /** Machine-readable failure code. */
  readonly code: WorktreeAdapterErrorCode

  /** Structured context for logs and evidence. */
  readonly details: Readonly<Record<string, unknown>>

  /**
   * @param code - stable failure code.
   * @param message - human-readable detail.
   * @param options - optional structured details and cause.
   */
  constructor(code: WorktreeAdapterErrorCode, message: string, options: WorktreeAdapterErrorOptions = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause })
    this.name = 'WorktreeAdapterError'
    this.code = code
    this.details = Object.freeze({ ...options.details })
  }
}

/**
 * Whether a value is a failure raised by this package.
 * @param value - the value to test.
 */
export function isWorktreeAdapterError(value: unknown): value is WorktreeAdapterError {
  return value instanceof WorktreeAdapterError
}
