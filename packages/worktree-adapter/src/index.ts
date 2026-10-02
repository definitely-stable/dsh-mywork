/**
 * `@dsh-mywork/worktree-adapter` — git worktree isolation and the local git port
 * (architecture §19, §31; MW-021).
 *
 * ```ts
 * const git = createGitPort()
 * const worktrees = createWorktreePort({
 *   policy: { root: stateWorktreesPath, branchPrefix: 'mywork/', retentionMs, keepDirty: true },
 *   repository: workspaceRoot,
 *   git,
 *   registry: createWorktreeRegistry(rowsOfAttemptWorktree),
 * })
 * const created = await worktrees.prepare({ workspaceId, taskId, attemptId, baseSha }, meta)
 * ```
 *
 * This is the only package in the tree that may run `git` for the worktree layer:
 * `@dsh-mywork/execution` imports the two ports and nothing else, because its
 * built bundle may import `node:crypto` alone (`tests/boundaries.test.mjs`). The
 * package owns both ports — {@link WorktreePort} for isolation and {@link GitPort}
 * for the local commands the integrator and the gate need — so a caller never has
 * to reach for a second adapter to ask about the same repository.
 * @module @dsh-mywork/worktree-adapter
 */

export {
  WorktreeAdapterError,
  isWorktreeAdapterError,
  type WorktreeAdapterErrorCode,
  type WorktreeAdapterErrorOptions,
} from './errors.ts'
export {
  DEFAULT_GIT_EXECUTABLE,
  GIT_MAX_OUTPUT_BYTES,
  GIT_REDIRECTING_ENV_VARS,
  GIT_TIMEOUT_MS,
  createGitPort,
  gitEnvironment,
  runGit,
  type GitPortOptions,
  type GitRun,
  type RunGitOptions,
} from './git.ts'
export {
  createWorktreePort,
  createWorktreeRegistry,
  type WorktreeAdapterOptions,
  type WorktreeRegistry,
} from './adapter.ts'
