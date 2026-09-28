/**
 * Worktree isolation contracts (architecture §19, §31; MW-021, E-01…E-06).
 *
 * One attempt runs in one git worktree of its own: a branch cut from a pinned
 * base SHA, a directory under the policy root, and nothing else. §19 states the
 * acceptance the port has to make provable — two attempts never write to the
 * shared checkout, an attempt cannot leave its worktree, and cleanup never
 * deletes work that is foreign or dirty.
 *
 * The port is deliberately separate from the layer that runs git
 * (`@dsh-mywork/worktree-adapter`): `@dsh-mywork/execution` may import nothing
 * but `node:crypto` (`tests/boundaries.test.mjs` pins that), so the process that
 * speaks to git cannot live inside it.
 *
 * Failure shape. Every call answers with a {@link Result}, and a refusal is
 * carried both as the MyWork error code a caller branches on (through
 * {@link WORKTREE_REFUSAL_CODES}) and as the closed {@link WorktreeRefusal} in
 * `details.refusal` — so a caller never parses a message to learn which of the
 * six situations it met.
 * @module
 */

import type { AttemptId, TaskId, WorkspaceId } from './ids.ts'
import type { MyWorkErrorCode, OperationMeta, Result } from './operation.ts'

/**
 * The closed set of situations in which a worktree operation refuses.
 *
 * Six values, and the count is part of the contract: `EMPTY_REPOSITORY` names a
 * repository without a commit to start from (refused instead of committing on
 * the caller's behalf), `WORKTREE_DIRTY` protects uncommitted work,
 * `WORKTREE_FOREIGN` and `WORKTREE_OUTSIDE_WORKSPACE` protect directories this
 * attempt does not own, `WORKTREE_ALREADY_REGISTERED` makes `prepare`
 * idempotent rather than duplicating, and `WORKTREE_MISSING` reports a path a
 * caller assumed was there.
 */
export type WorktreeRefusal =
  | 'EMPTY_REPOSITORY'
  | 'WORKTREE_DIRTY'
  | 'WORKTREE_FOREIGN'
  | 'WORKTREE_OUTSIDE_WORKSPACE'
  | 'WORKTREE_ALREADY_REGISTERED'
  | 'WORKTREE_MISSING'

/** Every refusal, in the order §19 names the acceptance criteria. */
export const WORKTREE_REFUSALS: readonly WorktreeRefusal[] = Object.freeze([
  'EMPTY_REPOSITORY',
  'WORKTREE_DIRTY',
  'WORKTREE_FOREIGN',
  'WORKTREE_OUTSIDE_WORKSPACE',
  'WORKTREE_ALREADY_REGISTERED',
  'WORKTREE_MISSING',
])

/**
 * The error code each refusal travels as.
 *
 * A refusal that would let an attempt touch something it does not own is
 * `SECURITY_DENIED`; the rest are conflicts with the state of the repository or
 * the registry. The refusal itself stays in `details.refusal`, so the mapping
 * never hides which situation was met.
 */
export const WORKTREE_REFUSAL_CODES: Readonly<Record<WorktreeRefusal, MyWorkErrorCode>> = Object.freeze({
  EMPTY_REPOSITORY: 'TASK_CONFLICT',
  WORKTREE_DIRTY: 'TASK_CONFLICT',
  WORKTREE_FOREIGN: 'SECURITY_DENIED',
  WORKTREE_OUTSIDE_WORKSPACE: 'SECURITY_DENIED',
  WORKTREE_ALREADY_REGISTERED: 'TASK_CONFLICT',
  WORKTREE_MISSING: 'TASK_CONFLICT',
})

/**
 * Whether a value is one of the six refusals.
 * @param value - the value to test.
 */
export function isWorktreeRefusal(value: unknown): value is WorktreeRefusal {
  return typeof value === 'string' && (WORKTREE_REFUSALS as readonly string[]).includes(value)
}

/**
 * The refusal a value names, or `undefined` when it names none.
 *
 * A string that merely looks like a code — including an error code from another
 * domain — resolves to `undefined` rather than being coerced into the closest
 * match, because a caller that mislabels a refusal would report the wrong
 * situation to the board.
 * @param value - the value to resolve.
 */
export function resolveWorktreeRefusal(value: unknown): WorktreeRefusal | undefined {
  return isWorktreeRefusal(value) ? value : undefined
}

/**
 * Where worktrees of one deployment live and how they are named (§19).
 *
 * `root` is the only directory the port may create under or delete from;
 * `branchPrefix` keeps MyWork's branches distinguishable from a human's, which
 * is what lets `list` answer "mine" without guessing; `retentionMs` bounds how
 * long a settled worktree survives before cleanup may remove it; `keepDirty`
 * is fixed at `true` and states the rule instead of leaving it to a default —
 * a dirty worktree is never deleted.
 */
export interface WorktreePolicy {
  /** Directory every worktree of this policy is created under. */
  readonly root: string
  /** Prefix of every branch this policy creates, without whitespace. */
  readonly branchPrefix: string
  /** How long a settled worktree is kept before cleanup may remove it. */
  readonly retentionMs: number
  /** Never remove a worktree with uncommitted changes. Always `true`. */
  readonly keepDirty: true
}

/** Fields of {@link WorktreePolicy}; the shape is closed. */
export const WORKTREE_POLICY_FIELDS: readonly string[] = Object.freeze([
  'root',
  'branchPrefix',
  'retentionMs',
  'keepDirty',
])

/** What one attempt asks for. */
export interface WorktreeRequest {
  /** Workspace the attempt belongs to; scopes which repositories are legal. */
  readonly workspaceId: WorkspaceId
  /** Task the attempt works on. */
  readonly taskId: TaskId
  /** Attempt the worktree belongs to; its identity names the branch and path. */
  readonly attemptId: AttemptId
  /** Exact base commit the branch is cut from, as 40 lowercase hex characters. */
  readonly baseSha: string
}

/** Fields of {@link WorktreeRequest}; the shape is closed. */
export const WORKTREE_REQUEST_FIELDS: readonly string[] = Object.freeze([
  'workspaceId',
  'taskId',
  'attemptId',
  'baseSha',
])

/** One worktree as the port records it. */
export interface WorktreeRegistration {
  /** Attempt the worktree belongs to. */
  readonly attemptId: AttemptId
  /** Workspace the attempt belongs to. */
  readonly workspaceId: WorkspaceId
  /** Task the attempt works on. */
  readonly taskId: TaskId
  /** Absolute directory of the worktree. */
  readonly path: string
  /** Branch the worktree is checked out on. */
  readonly branch: string
  /** Base commit the branch was cut from. */
  readonly baseSha: string
  /** Head commit the worktree is on; absent until the attempt settled. */
  readonly headSha?: string
}

/** Fields of {@link WorktreeRegistration}; the shape is closed. */
export const WORKTREE_REGISTRATION_FIELDS: readonly string[] = Object.freeze([
  'attemptId',
  'workspaceId',
  'taskId',
  'path',
  'branch',
  'baseSha',
  'headSha',
])

/** What cleanup did with one worktree. */
export type WorktreeCleanupOutcome =
  /** The worktree was clean and was removed. */
  | 'removed'
  /** Uncommitted changes were present; the directory was kept. */
  | 'kept-dirty'
  /** The directory is not registered to MyWork; it was kept. */
  | 'kept-orphan'

/** Every cleanup outcome. */
export const WORKTREE_CLEANUP_OUTCOMES: readonly WorktreeCleanupOutcome[] = Object.freeze([
  'removed',
  'kept-dirty',
  'kept-orphan',
])

/** Caller-owned controls for one port call. */
export interface WorktreeCallOptions {
  /** Cancellation owned by the caller. */
  readonly signal?: AbortSignal
}

/**
 * Worktree isolation port (architecture §19).
 *
 * The port is the whole of MyWork's contact with git: `prepare` creates the
 * isolated checkout for one attempt, `resolve` reads it back, `cleanup` removes
 * it when it is safe to, and `list` reports what this deployment owns. No method
 * touches the shared checkout of a workspace.
 */
export interface WorktreePort {
  /**
   * Create the attempt's worktree from the pinned base SHA.
   * @param request - workspace, task, attempt, and base commit.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   * @returns the registration, or a refusal from {@link WORKTREE_REFUSALS}.
   */
  prepare(
    request: WorktreeRequest,
    meta: OperationMeta,
    options?: WorktreeCallOptions,
  ): Promise<Result<WorktreeRegistration>>
  /**
   * Read the worktree registered to one attempt.
   * @param attemptId - attempt whose worktree is read.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   */
  resolve(
    attemptId: AttemptId,
    meta: OperationMeta,
    options?: WorktreeCallOptions,
  ): Promise<Result<WorktreeRegistration>>
  /**
   * Remove the attempt's worktree when it is clean and owned by MyWork.
   * @param attemptId - attempt whose worktree is cleaned up.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   * @returns what happened, including the two cases in which nothing was removed.
   */
  cleanup(
    attemptId: AttemptId,
    meta: OperationMeta,
    options?: WorktreeCallOptions,
  ): Promise<Result<WorktreeCleanupOutcome>>
  /**
   * Every worktree this deployment owns in one workspace.
   * @param workspaceId - workspace to list.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   */
  list(
    workspaceId: WorkspaceId,
    meta: OperationMeta,
    options?: WorktreeCallOptions,
  ): Promise<Result<readonly WorktreeRegistration[]>>
}
