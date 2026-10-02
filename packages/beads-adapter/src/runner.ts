/**
 * The `bd` process seam.
 *
 * Everything adapter-specific is expressed as a typed command and a parsed
 * answer, and one narrow interface actually spawns the process. Two reasons for
 * the split:
 *
 * 1. The adapter's policy — capability negotiation, status mapping, staged
 *    mutation, reconciliation — is testable without a `bd` binary, while the
 *    command surface itself is verified once, against the real CLI.
 * 2. Exit codes are part of the Beads contract, not an implementation detail.
 *    `bd update` uses `13` to mean "a guard no longer held and nothing was
 *    written", and `bd init` panics with `2` when its Dolt root is unreachable
 *    (ADR023). Both are facts a caller must act on, so they are decoded here and
 *    never leak upward as bare numbers.
 * @module
 */

import { spawn } from 'node:child_process'

import { resolveBeadsLaunch, type BeadsLaunch } from './launch.ts'

/** Exit code `bd update` returns when every failure was a stale guard (ADR023). */
export const BD_EXIT_GUARD_FAILED = 13

/** Exit code a panicking `bd init` returns when its Dolt root is unreachable. */
export const BD_EXIT_PANIC = 2

/** One completed `bd` invocation. */
export interface BeadsCommandResult {
  /** Process exit code. */
  readonly code: number
  /** Standard output, with a trailing newline removed. */
  readonly stdout: string
  /** Standard error, with a trailing newline removed. */
  readonly stderr: string
}

/** One request to run `bd`. */
export interface BeadsCommand {
  /** Arguments after the binary, e.g. `['ready', '--json']`. */
  readonly args: readonly string[]
  /** Working directory the command runs in; the workspace is discovered from it. */
  readonly cwd: string
  /**
   * Standard input, when the command reads it (`bd batch` reads its operations
   * from stdin).
   */
  readonly stdin?: string
  /**
   * Extra environment entries for this invocation.
   *
   * Used to pass `BEADS_ACTOR`, which is how `bd` records the acting identity
   * for a claim and for the audit trail.
   */
  readonly env?: Readonly<Record<string, string>>
}

/**
 * Runs `bd`. The only interface in the adapter that touches the operating
 * system, so it is the only one a test has to replace.
 */
export interface BeadsRunner {
  /**
   * Run one `bd` command.
   * @param command - arguments, working directory, and optional stdin.
   * @throws {Error} only when the process could not be spawned at all; a non-zero
   * exit is returned in {@link BeadsCommandResult} and interpreted by the caller.
   */
  run(command: BeadsCommand): Promise<BeadsCommandResult>
}

/** Options accepted by {@link createProcessRunner}. */
export interface ProcessRunnerOptions {
  /**
   * Path or name of the `bd` binary. Highest priority: an explicit binary is the
   * caller's answer, and {@link launch} and the resolver are only defaults.
   */
  readonly binary?: string
  /**
   * How to start `bd`. Defaults to {@link resolveBeadsLaunch}, which finds the
   * JavaScript entry on Windows and keeps the direct spawn on POSIX.
   */
  readonly launch?: BeadsLaunch
  /**
   * Milliseconds before the process is killed.
   *
   * A hung `bd` must not hang a reconciler: the adapter reports it as an
   * unavailable backend rather than waiting forever.
   */
  readonly timeoutMs?: number
}

/** Default command timeout; generous for a cold embedded Dolt start. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000

/**
 * A runner that spawns the real `bd` process.
 *
 * Output is collected through the child's own pipes. The adapter never runs a
 * shell, so no argument is word-split or glob-expanded, and a task title can
 * never turn into a command.
 * @param options - binary path, launch specification, and timeout.
 * @returns a runner whose construction never fails: the launch is resolved at the
 * first command, so composing a profile on a machine without `bd` is not an error
 * by itself. The refusal surfaces as a rejected `run`.
 */
export function createProcessRunner(options: ProcessRunnerOptions = {}): BeadsRunner {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  let resolved: BeadsLaunch | undefined

  /**
   * The launch specification, resolved once and only when it is needed.
   * @returns the shell-free launch this runner spawns.
   * @throws {BeadsLaunchRefusal} when no `bd` can be located on Windows.
   */
  function launchOf(): BeadsLaunch {
    if (options.binary !== undefined) {
      return { command: options.binary, args: [], shell: false }
    }
    if (options.launch !== undefined) return options.launch
    resolved ??= resolveBeadsLaunch()
    return resolved
  }

  return {
    run(command: BeadsCommand): Promise<BeadsCommandResult> {
      return new Promise<BeadsCommandResult>((resolve, reject) => {
        let launch: BeadsLaunch
        try {
          launch = launchOf()
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
          return
        }
        const child = spawn(launch.command, [...launch.args, ...command.args], {
          cwd: command.cwd,
          // No shell: arguments are passed as an argument vector verbatim, and a
          // launch record can only ever be shell-free.
          shell: launch.shell,
          windowsHide: true,
          env: command.env === undefined ? process.env : { ...process.env, ...command.env },
        })

        const stdout: string[] = []
        const stderr: string[] = []
        let settled = false

        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          child.kill()
          reject(
            new Error(
              `dsh-mywork: bd ${command.args.join(' ')} exceeded ${String(timeoutMs)}ms and was killed`,
            ),
          )
        }, timeoutMs)

        child.stdout?.setEncoding('utf8')
        child.stderr?.setEncoding('utf8')
        child.stdout?.on('data', (chunk: string) => stdout.push(chunk))
        child.stderr?.on('data', (chunk: string) => stderr.push(chunk))

        child.on('error', (error: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(error)
        })

        child.on('close', (code: number | null) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({
            code: code ?? 1,
            stdout: stdout.join('').replace(/\r?\n$/, ''),
            stderr: stderr.join('').replace(/\r?\n$/, ''),
          })
        })

        if (command.stdin !== undefined) {
          child.stdin?.end(command.stdin)
        } else {
          child.stdin?.end()
        }
      })
    },
  }
}

/** A runner backed by an in-memory script, for tests. */
export interface ScriptedCall extends BeadsCommand {
  /** The result the call answers with. */
  readonly result: BeadsCommandResult
}

/**
 * A runner that answers from a recorded script and records what it was asked.
 *
 * The recorded calls are the evidence that the adapter builds the command a
 * capability requires — for instance that a guarded transition really passes
 * `--if-status`, rather than only that the result was right.
 */
export interface ScriptedRunner extends BeadsRunner {
  /** Every command this runner was asked to run, in order. */
  readonly calls: readonly BeadsCommand[]
  /** The stdin payloads, in call order; absent entries mean no stdin. */
  readonly payloads: readonly (string | undefined)[]
}

/**
 * Build a scripted runner.
 * @param script - the answers to hand out; the last entry repeats once exhausted.
 * @param fallback - used when the script is empty.
 */
export function createScriptedRunner(
  script: readonly ScriptedCall[],
  fallback?: BeadsCommandResult,
): ScriptedRunner {
  const calls: BeadsCommand[] = []
  const payloads: (string | undefined)[] = []
  return {
    get calls(): readonly BeadsCommand[] {
      return calls
    },
    get payloads(): readonly (string | undefined)[] {
      return payloads
    },
    async run(command: BeadsCommand): Promise<BeadsCommandResult> {
      calls.push(command)
      payloads.push(command.stdin)
      const index = Math.min(calls.length - 1, script.length - 1)
      const entry = script[index]
      if (entry !== undefined && script.length > 0) return entry.result
      if (fallback !== undefined) return fallback
      return { code: 0, stdout: '', stderr: '' }
    },
  }
}

/**
 * Parse a `<name>:<category>` list as Beads reports it.
 * Kept as a string operation because the value is opaque configuration.
 * @param value - a configuration value, or `undefined` when unset.
 */
export function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0] ?? ''
}
