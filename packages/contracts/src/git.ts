/**
 * Git command port (architecture §19, §31; MW-021/MW-025, E-26).
 *
 * The port is the whole of the domain's contact with a repository: reading the
 * head, hashing a diff, and writing a *local* commit, merge, or rebase. Two
 * properties are expressed by the shape rather than left to discipline:
 *
 * - **There is no `push`.** The integrator integrates into a local branch and
 *   stops there; a port that cannot reach a remote cannot rewrite one, so the
 *   guarantee holds even if a caller wants it not to.
 * - **Nothing here runs a shell.** A command is named and its arguments are
 *   passed verbatim, so a caller cannot smuggle a pipeline or a redirection into
 *   what is supposed to be a fixed verification command.
 *
 * The implementation lives in `@dsh-mywork/worktree-adapter` (the package that
 * may spawn a process); `@dsh-mywork/execution` consumes this port only, because
 * its built bundle may import `node:crypto` and nothing else.
 * @module
 */

import type { OperationMeta, Result } from './operation.ts'

/** Caller-owned controls for one port call. */
export interface GitCallOptions {
  /** Cancellation owned by the caller. */
  readonly signal?: AbortSignal
}

/** How the integrator brings an approved head into the target branch. */
export type GitLandingStrategy =
  /** Create a merge commit; the default, because it never rewrites the attempt. */
  | 'merge-no-ff'
  /** Replay the attempt's commits onto the target head; only when policy says so. */
  | 'rebase'

/** Every landing strategy. */
export const GIT_LANDING_STRATEGIES: readonly GitLandingStrategy[] = Object.freeze([
  'merge-no-ff',
  'rebase',
])

/** One commit the integrator asks for. */
export interface GitCommitRequest {
  /** Directory to commit in. */
  readonly cwd: string
  /** Full commit message; the trailer is part of it, not appended by git. */
  readonly message: string
  /** Paths to stage; absent stages every change git already tracks. */
  readonly paths?: readonly string[]
}

/** One landing the integrator asks for. */
export interface GitLandRequest {
  /** Directory of the target branch's checkout. */
  readonly cwd: string
  /** Revision to bring in (the approved attempt head). */
  readonly revision: string
  /** How to bring it in. */
  readonly strategy: GitLandingStrategy
}

/** What a landing did. */
export interface GitLandOutcome {
  /** Head after the operation. */
  readonly headSha: string
  /** True when git stopped on a conflict the caller must resolve or abort. */
  readonly conflicted: boolean
  /** The files git reported as conflicting, in its own order. */
  readonly conflictedPaths: readonly string[]
}

/** Fields of {@link GitLandOutcome}; the shape is closed. */
export const GIT_LAND_OUTCOME_FIELDS: readonly string[] = Object.freeze([
  'headSha',
  'conflicted',
  'conflictedPaths',
])

/**
 * Git command port.
 *
 * Every method answers with a {@link Result}; a repository that is missing, a
 * revision that does not exist, or a process that cannot be started is a typed
 * failure with the command's own stderr in the message, never a thrown string.
 */
export interface GitPort {
  /**
   * Read the head commit of a checkout.
   * @param cwd - directory to read.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   * @returns the 40-character head SHA.
   */
  resolveHead(cwd: string, meta: OperationMeta, options?: GitCallOptions): Promise<Result<string>>
  /**
   * Hash the diff between two revisions.
   * @param cwd - directory to read.
   * @param baseSha - revision the attempt started from.
   * @param headSha - revision the attempt ended on.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   * @returns a stable hash of the patch, computed by one implementation only.
   */
  diffHash(
    cwd: string,
    baseSha: string,
    headSha: string,
    meta: OperationMeta,
    options?: GitCallOptions,
  ): Promise<Result<string>>
  /**
   * Whether the checkout has uncommitted changes.
   * @param cwd - directory to inspect.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   */
  isClean(cwd: string, meta: OperationMeta, options?: GitCallOptions): Promise<Result<boolean>>
  /**
   * Create a commit in a checkout.
   * @param request - directory, message, and paths to stage.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   * @returns the new head SHA.
   */
  commit(request: GitCommitRequest, meta: OperationMeta, options?: GitCallOptions): Promise<Result<string>>
  /**
   * Bring a revision into the current branch, locally.
   * @param request - directory, revision, and strategy.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   * @returns the head after the operation and whether it conflicted.
   */
  land(request: GitLandRequest, meta: OperationMeta, options?: GitCallOptions): Promise<Result<GitLandOutcome>>
  /**
   * Abort an interrupted landing, restoring the pre-merge head.
   * @param cwd - directory to restore.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   */
  abortLanding(cwd: string, meta: OperationMeta, options?: GitCallOptions): Promise<Result<string>>
}
