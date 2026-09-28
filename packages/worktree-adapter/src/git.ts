/**
 * The local git port and the process runner behind it (architecture §19, §31;
 * MW-021, E-03).
 *
 * This module is the only place in the tree where the worktree layer runs a
 * process. Two properties are expressed by the code rather than left to
 * discipline, and both are §31 requirements:
 *
 * - **No shell.** `execFile` is called with `shell: false`, so a command is named
 *   and its arguments are passed verbatim: a caller cannot smuggle a pipeline,
 *   a redirection, or a `&&` into what is supposed to be a fixed verification
 *   command.
 * - **A cleaned environment.** `GIT_DIR`, `GIT_WORK_TREE`, and the other
 *   redirecting variables are removed from the child environment, because a
 *   developer's exported `GIT_DIR` would otherwise point every command at another
 *   repository — an isolation guarantee that depends on the caller's shell is not
 *   a guarantee. `LC_ALL`/`LANG` are pinned so git's messages stay the English
 *   ones this module classifies and quotes into evidence.
 *
 * The port answers with {@link Result}: a git command that *ran and refused* is a
 * typed failure carrying git's own stderr, while a git executable that could not
 * be started at all is a {@link WorktreeAdapterError} with `git-not-found` —
 * a misconfigured deployment, not a domain outcome.
 * @module
 */

import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'

import {
  GIT_LANDING_STRATEGIES,
  type GitCallOptions,
  type GitCommitRequest,
  type GitLandOutcome,
  type GitLandRequest,
  type GitLandingStrategy,
  type GitPort,
  type OperationMeta,
  type Result,
} from '@dsh-mywork/contracts'
import { fail, MyWorkError, ok } from '@dsh-mywork/core'

import { WorktreeAdapterError } from './errors.ts'

/** Promise form of `execFile`; every call site below asks for utf8 strings. */
const execFileAsync: (
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding,
) => Promise<{ readonly stdout: string; readonly stderr: string }> = promisify(execFile)

/** Executable this build runs when no path is pinned. */
export const DEFAULT_GIT_EXECUTABLE = 'git'

/** Bounded capture, so one runaway command cannot exhaust the host process. */
export const GIT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** How long one git command may take before it is killed. */
export const GIT_TIMEOUT_MS = 60_000

/**
 * Environment variables that would point git at another repository.
 *
 * `GIT_DIR` and `GIT_WORK_TREE` are the documented pair; the rest are the object
 * database and index redirects that achieve the same thing through a different
 * door. Removing them is what makes the port's answer a function of its `cwd`
 * argument rather than of the shell that started the controller.
 */
export const GIT_REDIRECTING_ENV_VARS: readonly string[] = Object.freeze([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
])

/** One finished git process. */
export interface GitRun {
  /** Exit status; `-1` when git reported no numeric status (killed or never started). */
  readonly code: number
  /** Standard output, decoded as utf8. */
  readonly stdout: string
  /** Standard error, decoded as utf8. */
  readonly stderr: string
  /** True when a process was spawned; false when the executable was not found. */
  readonly started: boolean
}

/** Options of {@link runGit}. */
export interface RunGitOptions {
  /** Executable name or absolute path; defaults to {@link DEFAULT_GIT_EXECUTABLE}. */
  readonly executable?: string
  /** Cancellation owned by the caller. */
  readonly signal?: AbortSignal
  /** Clock budget for this command; defaults to {@link GIT_TIMEOUT_MS}. */
  readonly timeoutMs?: number
}

/** Options of {@link createGitPort}. */
export interface GitPortOptions {
  /**
   * Executable name or absolute path; defaults to `git` resolved through `PATH`.
   *
   * The E-01 decision resolves it by name first and only pins an absolute path
   * when a deployment proves the name is not found; {@link WorktreeAdapterError}
   * with `git-not-found` is how that need becomes visible instead of silent.
   */
  readonly executable?: string
  /** Clock budget for every command of this port. */
  readonly timeoutMs?: number
}

/** The child environment git is run with: redirects removed, messages pinned to English. */
export function gitEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, LC_ALL: 'C', LANG: 'C' }
  for (const name of GIT_REDIRECTING_ENV_VARS) delete env[name]
  return env
}

/**
 * Run one git command without a shell.
 *
 * The returned value never throws for git's own failure: a non-zero status and
 * both streams come back so the caller can classify them. Only a process that
 * cannot be started is reported through {@link GitRun.started} — turning that
 * into a failure is the caller's decision, because "git is missing" and "git
 * refused this command" are different answers.
 * @param args - arguments passed verbatim; the executable is not included.
 * @param cwd - directory the process runs in; it also decides which repository git discovers.
 * @param options - executable, cancellation, and clock budget.
 */
export async function runGit(
  args: readonly string[],
  cwd: string,
  options: RunGitOptions = {},
): Promise<GitRun> {
  const execOptions: ExecFileOptionsWithStringEncoding = {
    cwd,
    env: gitEnvironment(),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: GIT_MAX_OUTPUT_BYTES,
    timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  try {
    const done = await execFileAsync(options.executable ?? DEFAULT_GIT_EXECUTABLE, [...args], execOptions)
    return Object.freeze({ code: 0, stdout: done.stdout, stderr: done.stderr, started: true })
  } catch (error) {
    const failure = error as { readonly code?: unknown; readonly stdout?: unknown; readonly stderr?: unknown; readonly message?: unknown }
    // `ENOENT`/`EACCES`/`EPERM` come from the spawn itself; every other shape
    // (a numeric status, a signal, a timeout) means a process did run.
    const notStarted = failure.code === 'ENOENT' || failure.code === 'EACCES' || failure.code === 'EPERM'
    return Object.freeze({
      code: typeof failure.code === 'number' ? failure.code : -1,
      stdout: typeof failure.stdout === 'string' ? failure.stdout : '',
      stderr: typeof failure.stderr === 'string' ? failure.stderr : String(failure.message ?? error),
      started: !notStarted,
    })
  }
}

/** A non-empty string, refused before any process is started. */
function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorktreeAdapterError('invalid-input', `dsh-mywork: ${field} must be a non-empty string`)
  }
  return value
}

/** Refuse a command that could not be started, naming the executable. */
function requireStarted(run: GitRun, args: readonly string[]): void {
  if (run.started) return
  throw new WorktreeAdapterError(
    'git-not-found',
    `dsh-mywork: the git executable could not be started for "git ${args.join(' ')}"; `
      + 'install git or pin an absolute path (E-01 decision)',
    { details: { args: [...args], stderr: run.stderr.trim() } },
  )
}

/** The typed failure of a git command that ran and refused. */
function gitRefused(
  what: string,
  run: GitRun,
  cwd: string,
  meta: OperationMeta,
  code: 'ADAPTER_UNAVAILABLE' | 'TASK_CONFLICT' = 'ADAPTER_UNAVAILABLE',
  details: Readonly<Record<string, unknown>> = {},
): Result<never> {
  const said = run.stderr.trim() === '' ? run.stdout.trim() : run.stderr.trim()
  return fail(
    new MyWorkError(code, `dsh-mywork: ${what} failed in "${cwd}" (exit ${run.code}): ${said}`, {
      details: { cwd, code: run.code, stderr: run.stderr.trim(), ...details },
    }),
    meta,
  )
}

/** A lowercase 40-character object name. */
const HEAD_SHA_PATTERN = /^[0-9a-f]{40}$/

/**
 * Create the local git port.
 *
 * Every method runs a fixed command through {@link runGit}; none of them can
 * reach a remote, because the port has no `push` and this implementation adds no
 * arguments of its own beyond the ones the contract names.
 * @param options - executable and clock budget; both have defaults.
 */
export function createGitPort(options: GitPortOptions = {}): GitPort {
  const executable = options.executable ?? DEFAULT_GIT_EXECUTABLE
  const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS

  /** The run options of one call, so every command of this port is bounded the same way. */
  const runOptions = (call: GitCallOptions | undefined): RunGitOptions => ({
    executable,
    timeoutMs,
    ...(call?.signal === undefined ? {} : { signal: call.signal }),
  })

  /** `git rev-parse --verify HEAD` in one checkout, as the port's typed answer. */
  async function readHead(
    cwd: string,
    meta: OperationMeta,
    call: GitCallOptions | undefined,
  ): Promise<Result<string>> {
    const inside = await runGit(['rev-parse', '--is-inside-work-tree'], cwd, runOptions(call))
    requireStarted(inside, ['rev-parse', '--is-inside-work-tree'])
    if (inside.code !== 0) {
      return gitRefused('git rev-parse --is-inside-work-tree', inside, cwd, meta, 'ADAPTER_UNAVAILABLE', {
        reason: 'not-a-repository',
      })
    }
    const head = await runGit(['rev-parse', '--verify', 'HEAD'], cwd, runOptions(call))
    requireStarted(head, ['rev-parse', '--verify', 'HEAD'])
    if (head.code !== 0) {
      // A repository with no commit yet: a precondition the caller must answer
      // for, never something this port repairs by committing on its behalf.
      return gitRefused('git rev-parse --verify HEAD', head, cwd, meta, 'TASK_CONFLICT', { reason: 'no-head' })
    }
    const sha = head.stdout.trim()
    if (!HEAD_SHA_PATTERN.test(sha)) {
      return fail(
        new MyWorkError('ADAPTER_UNAVAILABLE', `dsh-mywork: "${cwd}" reported head "${sha}", which is not a 40-character object name`, {
          details: { cwd, head: sha },
        }),
        meta,
      )
    }
    return ok(sha, meta)
  }

  return {
    resolveHead(cwd: string, meta: OperationMeta, call?: GitCallOptions): Promise<Result<string>> {
      return readHead(requireText(cwd, 'cwd'), meta, call)
    },

    async diffHash(
      cwd: string,
      baseSha: string,
      headSha: string,
      meta: OperationMeta,
      call?: GitCallOptions,
    ): Promise<Result<string>> {
      const directory = requireText(cwd, 'cwd')
      const base = requireText(baseSha, 'baseSha')
      const head = requireText(headSha, 'headSha')
      // `--binary --full-index` keeps the patch complete and independent of the
      // local abbreviation setting, so the digest of two identical changes is
      // identical on two machines.
      const diff = await runGit(
        ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-ext-diff', '--full-index', '--binary', base, head],
        directory,
        runOptions(call),
      )
      requireStarted(diff, ['diff'])
      if (diff.code !== 0) {
        return gitRefused('git diff', diff, directory, meta, 'TASK_CONFLICT', { baseSha: base, headSha: head })
      }
      return ok(createHash('sha256').update(diff.stdout, 'utf8').digest('hex'), meta)
    },

    async isClean(cwd: string, meta: OperationMeta, call?: GitCallOptions): Promise<Result<boolean>> {
      const directory = requireText(cwd, 'cwd')
      const status = await runGit(['status', '--porcelain'], directory, runOptions(call))
      requireStarted(status, ['status', '--porcelain'])
      if (status.code !== 0) return gitRefused('git status', status, directory, meta)
      // Untracked files count: "clean" has to mean "nothing here would be lost",
      // which is exactly the question cleanup asks before it deletes a directory.
      return ok(status.stdout.trim() === '', meta)
    },

    async commit(request: GitCommitRequest, meta: OperationMeta, call?: GitCallOptions): Promise<Result<string>> {
      const directory = requireText(request?.cwd, 'cwd')
      const message = requireText(request?.message, 'message')
      const paths = request?.paths ?? []
      if (paths.length > 0) {
        const staged = await runGit(['add', '--', ...paths], directory, runOptions(call))
        requireStarted(staged, ['add'])
        if (staged.code !== 0) return gitRefused('git add', staged, directory, meta)
      }
      // With explicit paths the staging above decides what is committed; without
      // them `-a` stages the changes git already tracks, which is what the
      // contract's "absent stages every change git already tracks" means.
      const args = paths.length > 0 ? ['commit', '-m', message] : ['commit', '-a', '-m', message]
      const committed = await runGit(args, directory, runOptions(call))
      requireStarted(committed, args)
      if (committed.code !== 0) return gitRefused('git commit', committed, directory, meta, 'TASK_CONFLICT')
      return readHead(directory, meta, call)
    },

    async land(request: GitLandRequest, meta: OperationMeta, call?: GitCallOptions): Promise<Result<GitLandOutcome>> {
      const directory = requireText(request?.cwd, 'cwd')
      const revision = requireText(request?.revision, 'revision')
      const strategy = request?.strategy
      if (!GIT_LANDING_STRATEGIES.includes(strategy as GitLandingStrategy)) {
        throw new WorktreeAdapterError(
          'invalid-input',
          `dsh-mywork: unknown landing strategy "${String(strategy)}"; known strategies are ${GIT_LANDING_STRATEGIES.join(', ')}`,
        )
      }
      // `merge-no-ff` never rewrites the attempt; `rebase` replays the commits of
      // the checkout at `cwd` onto `revision`. The direction matters and is stated
      // here because it is the one thing a caller can get wrong silently.
      const args = strategy === 'merge-no-ff'
        ? ['merge', '--no-ff', '--no-edit', revision]
        : ['rebase', revision]
      const landed = await runGit(args, directory, runOptions(call))
      requireStarted(landed, args)
      const head = await readHead(directory, meta, call)
      if (!head.ok) return head
      if (landed.code === 0) {
        return ok(
          Object.freeze({ headSha: head.value, conflicted: false, conflictedPaths: Object.freeze([]) }),
          meta,
        )
      }
      const unmerged = await runGit(['diff', '--name-only', '--diff-filter=U'], directory, runOptions(call))
      requireStarted(unmerged, ['diff', '--name-only', '--diff-filter=U'])
      const conflictedPaths = Object.freeze(
        unmerged.stdout
          .split('\n')
          .map(line => line.trim())
          .filter(line => line !== ''),
      )
      if (conflictedPaths.length === 0) {
        return gitRefused(`git ${args[0]}`, landed, directory, meta, 'TASK_CONFLICT', { revision, strategy })
      }
      // A conflict is a value, not a failure: the caller has to decide between
      // resolving and `abortLanding`, and the head stays where it was until then.
      return ok(Object.freeze({ headSha: head.value, conflicted: true, conflictedPaths }), meta)
    },

    async abortLanding(cwd: string, meta: OperationMeta, call?: GitCallOptions): Promise<Result<string>> {
      const directory = requireText(cwd, 'cwd')
      // Two states can be interrupted, and they are told apart by git itself
      // rather than by a directory layout this module would have to know.
      const merging = await runGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], directory, runOptions(call))
      requireStarted(merging, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
      if (merging.code === 0) {
        const aborted = await runGit(['merge', '--abort'], directory, runOptions(call))
        requireStarted(aborted, ['merge', '--abort'])
        if (aborted.code !== 0) return gitRefused('git merge --abort', aborted, directory, meta, 'TASK_CONFLICT')
        return readHead(directory, meta, call)
      }
      const rebasing = await runGit(['rev-parse', '-q', '--verify', 'REBASE_HEAD'], directory, runOptions(call))
      requireStarted(rebasing, ['rev-parse', '-q', '--verify', 'REBASE_HEAD'])
      if (rebasing.code === 0) {
        const aborted = await runGit(['rebase', '--abort'], directory, runOptions(call))
        requireStarted(aborted, ['rebase', '--abort'])
        if (aborted.code !== 0) return gitRefused('git rebase --abort', aborted, directory, meta, 'TASK_CONFLICT')
        return readHead(directory, meta, call)
      }
      // Nothing was interrupted: the pre-landing head is already in place, which
      // makes the call idempotent instead of an error a caller has to interpret.
      return readHead(directory, meta, call)
    },
  }
}
