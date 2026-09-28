/**
 * Worktree isolation over a real repository (architecture §19, §31; MW-021,
 * E-03, E-06).
 *
 * One attempt, one worktree: a branch cut from the attempt's pinned base SHA, a
 * directory under the policy root, and nothing else. The port is written so the
 * three acceptance criteria of §19 are properties of the code rather than of the
 * caller's care:
 *
 * - **The shared checkout is never written.** `prepare` runs `git worktree add`
 *   from the shared checkout, which creates the new branch and the admin entry;
 *   no method ever checks a branch out there, commits there, or resets it.
 * - **A path that is not the attempt's own is refused, not repaired.** `resolve`
 *   answers `WORKTREE_OUTSIDE_WORKSPACE` for a registration whose path leaves the
 *   policy root, and `cleanup` answers `WORKTREE_FOREIGN` for the same situation:
 *   the two questions differ — "is this a legal worktree of this workspace?" and
 *   "is this a directory I may delete?" — so the refusal names the question that
 *   was asked, while both travel as a denial.
 * - **Cleanup deletes nothing it did not create, and nothing that is dirty.**
 *   A directory under the root that no registration claims is `kept-orphan`; a
 *   worktree with uncommitted changes is `WORKTREE_DIRTY` and stays on disk.
 *
 * Retention (`WorktreePolicy.retentionMs`) is a *schedule* input: it tells the
 * caller when a settled attempt's worktree may be handed to `cleanup`. The port
 * does not read a clock — it removes what it is asked to remove, and refuses only
 * what it must not touch — so the retention window stays a policy decision made
 * by the composition root rather than a second, hidden rule here.
 * @module
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  WORKTREE_REFUSAL_CODES,
  type AttemptId,
  type GitPort,
  type OperationMeta,
  type Result,
  type WorkspaceId,
  type WorktreeCallOptions,
  type WorktreeCleanupOutcome,
  type WorktreePolicy,
  type WorktreePort,
  type WorktreeRefusal,
  type WorktreeRegistration,
  type WorktreeRequest,
} from '@dsh-mywork/contracts'
import { fail, isWithinRoot, MyWorkError, ok } from '@dsh-mywork/core'

import { WorktreeAdapterError } from './errors.ts'
import { createGitPort, runGit, type GitPortOptions, type RunGitOptions } from './git.ts'

/**
 * Where the port records the worktrees it created and reads them back.
 *
 * The port owns the *behaviour* of isolation, not the bookkeeping of which
 * attempt owns which directory: that record is durable state and belongs with the
 * attempt, in `attempt_worktree` (`@dsh-mywork/execution`). The registry is the
 * seam between the two — the composition root hands in a registry backed by that
 * table, and a test hands in a map. Every method is synchronous because the port
 * calls it between its own `await`s, never inside a store transaction.
 */
export interface WorktreeRegistry {
  /** Record one registration, replacing any earlier record of the same attempt. */
  put(registration: WorktreeRegistration): void
  /** The registration of one attempt, or `undefined` when it has none. */
  get(attemptId: AttemptId): WorktreeRegistration | undefined
  /** Every registration of one workspace, in insertion order. */
  entries(workspaceId: WorkspaceId): readonly WorktreeRegistration[]
  /** Forget one attempt, after its directory was removed. */
  remove(attemptId: AttemptId): void
}

/**
 * A registry held in memory, seeded with what the caller already recorded.
 *
 * The seed is how a restart keeps its worktrees: the composition root reads
 * `attempt_worktree` and hands the rows in, so `resolve` and `cleanup` answer for
 * attempts created by an earlier process. Records are copied and frozen on the
 * way in, so a caller that keeps mutating its own object cannot change what the
 * port believes about a directory it is about to delete.
 * @param initial - registrations recovered from durable state.
 */
export function createWorktreeRegistry(initial: readonly WorktreeRegistration[] = []): WorktreeRegistry {
  const records = new Map<string, WorktreeRegistration>()
  for (const registration of initial) records.set(registration.attemptId, Object.freeze({ ...registration }))
  return {
    put(registration: WorktreeRegistration): void {
      records.set(registration.attemptId, Object.freeze({ ...registration }))
    },
    get(attemptId: AttemptId): WorktreeRegistration | undefined {
      return records.get(attemptId)
    },
    entries(workspaceId: WorkspaceId): readonly WorktreeRegistration[] {
      return Object.freeze([...records.values()].filter(record => record.workspaceId === workspaceId))
    },
    remove(attemptId: AttemptId): void {
      records.delete(attemptId)
    },
  }
}

/** Options of {@link createWorktreePort}. */
export interface WorktreeAdapterOptions {
  /** Where worktrees live, how their branches are named, and how long they are kept. */
  readonly policy: WorktreePolicy
  /** Absolute path of the shared checkout every worktree is cut from. */
  readonly repository: string
  /** Git port for the commands the port's contract names; defaults to {@link createGitPort}. */
  readonly git?: GitPort
  /** Where the port records what it created; defaults to a fresh in-memory registry. */
  readonly registry?: WorktreeRegistry
  /** Executable and clock budget of the worktree commands the git port does not name. */
  readonly gitRun?: GitPortOptions
}

/** A worktree name segment that is a legal git ref component. */
function sanitizeRef(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '')
  return cleaned === '' ? 'x' : cleaned
}

/** The branch one attempt's worktree is checked out on. */
function branchNameOf(policy: WorktreePolicy, request: WorktreeRequest): string {
  return `${policy.branchPrefix}${sanitizeRef(request.taskId)}-${sanitizeRef(request.attemptId)}`
}

/** The directory name of a branch: git refs may carry `/`, directory names may not. */
function directoryNameOf(branch: string): string {
  return branch.split('/').join('-')
}

/** A non-empty string, refused before any process is started. */
function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorktreeAdapterError('invalid-input', `dsh-mywork: ${field} must be a non-empty string`)
  }
  return value
}

/**
 * Refuse a policy this port could not honour.
 *
 * The check runs when the port is built rather than on every call: a policy with
 * a blank root or a space in its branch prefix is a wiring defect, and finding it
 * at composition time names the composition root instead of failing later inside
 * a git command with a message about a ref name.
 * @param policy - the policy to check.
 * @throws {WorktreeAdapterError} `invalid-input` for a malformed policy.
 */
function requirePolicy(policy: WorktreePolicy): void {
  requireText(policy?.root, 'the policy root')
  const prefix = requireText(policy?.branchPrefix, 'the policy branchPrefix')
  if (/\s/.test(prefix)) {
    throw new WorktreeAdapterError('invalid-input', `dsh-mywork: the policy branchPrefix "${prefix}" must not contain whitespace`)
  }
  if (!Number.isInteger(policy?.retentionMs) || policy.retentionMs < 0) {
    throw new WorktreeAdapterError(
      'invalid-input',
      `dsh-mywork: the policy retentionMs must be a non-negative integer, received ${String(policy?.retentionMs)}`,
    )
  }
  if (policy?.keepDirty !== true) {
    throw new WorktreeAdapterError('invalid-input', 'dsh-mywork: the policy must set keepDirty: true; a dirty worktree is never removed')
  }
}

/**
 * Refuse a request this port could not honour.
 * @param request - the request to check.
 * @returns the request, so the caller can use the checked values.
 * @throws {WorktreeAdapterError} `invalid-input` for a missing id or a base SHA that is not 40 lowercase hex characters.
 */
function requireRequest(request: WorktreeRequest): WorktreeRequest {
  requireText(request?.workspaceId, 'workspaceId')
  requireText(request?.taskId, 'taskId')
  requireText(request?.attemptId, 'attemptId')
  const baseSha = requireText(request?.baseSha, 'baseSha')
  if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    throw new WorktreeAdapterError(
      'invalid-input',
      `dsh-mywork: baseSha must be 40 lowercase hex characters, received "${baseSha}"`,
    )
  }
  return request
}

/** A typed refusal of the worktree port, as the closed vocabulary names it. */
function refuse<T>(
  refusal: WorktreeRefusal,
  message: string,
  meta: OperationMeta,
  details: Readonly<Record<string, unknown>> = {},
): Result<T> {
  return fail(
    new MyWorkError(WORKTREE_REFUSAL_CODES[refusal], message, { details: { refusal, ...details } }),
    meta,
  )
}

/**
 * Create the worktree port over one repository and one policy.
 *
 * @param options - policy, shared checkout, and the two injectable seams (the git
 *   port and the registry).
 * @throws {WorktreeAdapterError} `invalid-input` for a malformed policy.
 */
export function createWorktreePort(options: WorktreeAdapterOptions): WorktreePort {
  const { policy, repository } = options
  requirePolicy(policy)
  requireText(repository, 'the repository path')
  const git = options.git ?? createGitPort()
  const registry = options.registry ?? createWorktreeRegistry()
  const runOptions = (call: WorktreeCallOptions | undefined): RunGitOptions => ({
    ...(options.gitRun?.executable === undefined ? {} : { executable: options.gitRun.executable }),
    ...(options.gitRun?.timeoutMs === undefined ? {} : { timeoutMs: options.gitRun.timeoutMs }),
    ...(call?.signal === undefined ? {} : { signal: call.signal }),
  })

  /**
   * The directory under the policy root that names one attempt, if it is there.
   *
   * Used only when no registration claims the attempt: a directory MyWork named
   * after this attempt but does not have on file is work whose owner was lost, and
   * §19 says it is kept rather than deleted.
   */
  function orphanPath(attemptId: AttemptId): string | undefined {
    if (!existsSync(policy.root)) return undefined
    const wanted = sanitizeRef(attemptId)
    const prefix = directoryNameOf(policy.branchPrefix)
    for (const entry of readdirSync(policy.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith(prefix)) continue
      if (!entry.name.endsWith(wanted)) continue
      return join(policy.root, entry.name)
    }
    return undefined
  }

  return {
    async prepare(
      request: WorktreeRequest,
      meta: OperationMeta,
      call?: WorktreeCallOptions,
    ): Promise<Result<WorktreeRegistration>> {
      const asked = requireRequest(request)
      if (registry.get(asked.attemptId) !== undefined) {
        return refuse(
          'WORKTREE_ALREADY_REGISTERED',
          `dsh-mywork: attempt "${asked.attemptId}" already has a worktree; a second one would give one attempt two checkouts`,
          meta,
          { attemptId: asked.attemptId },
        )
      }
      // The precondition is read before anything is created: a repository with no
      // commit has no base to cut from, and §19 forbids making one on the
      // caller's behalf — a hidden first commit would be MyWork writing to the
      // shared checkout.
      const head = await git.resolveHead(repository, meta, call)
      if (!head.ok) {
        if (head.error.details?.['reason'] === 'no-head') {
          return refuse(
            'EMPTY_REPOSITORY',
            `dsh-mywork: the repository "${repository}" has no commit to cut a worktree from; commit first, or run the attempt without worktree isolation`,
            meta,
            { repository },
          )
        }
        return fail(head.error, meta)
      }
      const branch = branchNameOf(policy, asked)
      const path = join(policy.root, directoryNameOf(branch))
      mkdirSync(policy.root, { recursive: true })
      if (existsSync(path)) {
        return refuse(
          'WORKTREE_ALREADY_REGISTERED',
          `dsh-mywork: "${path}" already exists; refusing to cut a worktree onto a directory this port did not create`,
          meta,
          { attemptId: asked.attemptId, path },
        )
      }
      const added = await runGit(
        ['worktree', 'add', '-b', branch, path, asked.baseSha],
        repository,
        runOptions(call),
      )
      if (!added.started) {
        throw new WorktreeAdapterError(
          'git-not-found',
          'dsh-mywork: the git executable could not be started for "git worktree add"',
          { details: { stderr: added.stderr.trim() } },
        )
      }
      if (added.code !== 0) {
        if (/already exists/i.test(added.stderr)) {
          return refuse(
            'WORKTREE_ALREADY_REGISTERED',
            `dsh-mywork: the branch "${branch}" already exists; refusing to reuse a branch this attempt does not own`,
            meta,
            { attemptId: asked.attemptId, branch },
          )
        }
        return fail(
          new MyWorkError(
            'TASK_CONFLICT',
            `dsh-mywork: git worktree add failed for attempt "${asked.attemptId}" (exit ${added.code}): ${added.stderr.trim()}`,
            { details: { attemptId: asked.attemptId, branch, path, code: added.code, stderr: added.stderr.trim() } },
          ),
          meta,
        )
      }
      const registration: WorktreeRegistration = Object.freeze({
        attemptId: asked.attemptId,
        workspaceId: asked.workspaceId,
        taskId: asked.taskId,
        path,
        branch,
        baseSha: asked.baseSha,
      })
      registry.put(registration)
      return ok(registration, meta)
    },

    async resolve(
      attemptId: AttemptId,
      meta: OperationMeta,
      _call?: WorktreeCallOptions,
    ): Promise<Result<WorktreeRegistration>> {
      const id = requireText(attemptId, 'attemptId')
      const registration = registry.get(id)
      if (registration === undefined) {
        return refuse('WORKTREE_MISSING', `dsh-mywork: attempt "${id}" has no worktree on file`, meta, { attemptId: id })
      }
      if (!isWithinRoot(policy.root, registration.path)) {
        return refuse(
          'WORKTREE_OUTSIDE_WORKSPACE',
          `dsh-mywork: the worktree of attempt "${id}" is at "${registration.path}", outside the policy root "${policy.root}"`,
          meta,
          { attemptId: id, path: registration.path, root: policy.root },
        )
      }
      return ok(registration, meta)
    },

    async cleanup(
      attemptId: AttemptId,
      meta: OperationMeta,
      call?: WorktreeCallOptions,
    ): Promise<Result<WorktreeCleanupOutcome>> {
      const id = requireText(attemptId, 'attemptId')
      const registration = registry.get(id)
      if (registration === undefined) {
        const orphan = orphanPath(id)
        if (orphan === undefined) {
          // Nothing of this attempt is left: the question "is its worktree gone?"
          // is answered yes, which is what makes a repeated cleanup idempotent
          // instead of an error the caller has to interpret.
          return ok('removed', meta)
        }
        return ok('kept-orphan', meta)
      }
      // The two guards of §19, in the order that keeps the answer honest: a path
      // outside the root, or a branch this policy did not name, is somebody
      // else's directory, and MyWork does not delete what it did not create.
      if (!isWithinRoot(policy.root, registration.path)) {
        return refuse(
          'WORKTREE_FOREIGN',
          `dsh-mywork: refusing to remove "${registration.path}" for attempt "${id}": it is outside the policy root "${policy.root}"`,
          meta,
          { attemptId: id, path: registration.path, root: policy.root },
        )
      }
      if (!registration.branch.startsWith(policy.branchPrefix)) {
        return refuse(
          'WORKTREE_FOREIGN',
          `dsh-mywork: refusing to remove the worktree of attempt "${id}": branch "${registration.branch}" is not one this policy created`,
          meta,
          { attemptId: id, branch: registration.branch, branchPrefix: policy.branchPrefix },
        )
      }
      const clean = await git.isClean(registration.path, meta, call)
      if (!clean.ok) {
        if (clean.error.details?.['reason'] === 'not-a-repository') {
          // The directory was removed outside MyWork: the registration is stale
          // bookkeeping, and forgetting it is all that is left to do. `prune`
          // clears the admin entry of a worktree whose directory is gone.
          registry.remove(id)
          await runGit(['worktree', 'prune'], repository, runOptions(call))
          return ok('removed', meta)
        }
        return fail(clean.error, meta)
      }
      if (!clean.value) {
        return refuse(
          'WORKTREE_DIRTY',
          `dsh-mywork: the worktree of attempt "${id}" has uncommitted changes; it is kept, not removed`,
          meta,
          { attemptId: id, path: registration.path },
        )
      }
      const removed = await runGit(['worktree', 'remove', registration.path], repository, runOptions(call))
      if (!removed.started) {
        throw new WorktreeAdapterError(
          'git-not-found',
          'dsh-mywork: the git executable could not be started for "git worktree remove"',
          { details: { stderr: removed.stderr.trim() } },
        )
      }
      if (removed.code !== 0) {
        return fail(
          new MyWorkError(
            'TASK_CONFLICT',
            `dsh-mywork: git worktree remove failed for attempt "${id}" (exit ${removed.code}): ${removed.stderr.trim()}`,
            { details: { attemptId: id, path: registration.path, code: removed.code, stderr: removed.stderr.trim() } },
          ),
          meta,
        )
      }
      // `prune` runs only for a record this port itself removed, which is the
      // §19 rule: a stale admin entry of somebody else's worktree is not ours to
      // clean up, and pruning it would delete the only trace of their directory.
      await runGit(['worktree', 'prune'], repository, runOptions(call))
      registry.remove(id)
      return ok('removed', meta)
    },

    async list(
      workspaceId: WorkspaceId,
      meta: OperationMeta,
      _call?: WorktreeCallOptions,
    ): Promise<Result<readonly WorktreeRegistration[]>> {
      const workspace = requireText(workspaceId, 'workspaceId')
      const mine = registry
        .entries(workspace)
        .filter(record => record.branch.startsWith(policy.branchPrefix))
        .filter(record => isWithinRoot(policy.root, record.path))
      return ok(Object.freeze([...mine]), meta)
    },
  }
}
