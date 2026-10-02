/**
 * The one question "is a usable `bd` there?" — asked once, answered the same way
 * everywhere.
 *
 * The probe used to live inside a test file, which is how a suite and the
 * Doctor could disagree: the test spawned `bd` from `PATH`, the adapter used its
 * own seam, and a machine where one worked and the other did not looked like a
 * green run next to a red diagnosis. The probe is therefore a package export,
 * and it **never throws**: a missing backend is a value a caller reports, not an
 * exception that hides which check failed.
 * @module
 */

import { BeadsLaunchRefusal, BEADS_INSTALL_HINT, type BeadsLaunch } from './launch.ts'
import { parseBdVersion } from './memory.ts'
import { createProcessRunner, type BeadsRunner } from './runner.ts'

/**
 * Probe timeout.
 *
 * Deliberately shorter than `DEFAULT_COMMAND_TIMEOUT_MS`: a probe answers "is it
 * there", and a cold embedded Dolt start must not hold a Doctor report or a test
 * file for half a minute.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 5_000

/** Why the probe could not confirm a usable `bd`. */
export type BeadsProbeFailure =
  /** No `bd` installation could be located at all. */
  | 'binary-not-found'
  /** A located `bd` could not be started (spawn error, e.g. `ENOENT`). */
  | 'spawn-failed'
  /** `bd version` ran and exited non-zero. */
  | 'nonzero-exit'
  /** `bd version` did not answer inside the timeout. */
  | 'timeout'

/** `bd` answered: it is installed, runnable, and reports a version. */
export interface BeadsProbeAvailable {
  readonly available: true
  /** Version token, e.g. `1.3.0`. */
  readonly version: string
  /** The first line `bd version` printed, kept verbatim for diagnostics. */
  readonly banner: string
}

/** `bd` could not be confirmed; `reason` names what actually happened. */
export interface BeadsProbeUnavailable {
  readonly available: false
  readonly reason: BeadsProbeFailure
  /** Diagnostic text: the OS error, or what `bd` wrote to stderr. */
  readonly stderr: string
  /** Node error code (`ENOENT`) or the process exit code, when there is one. */
  readonly code?: string | number
  /** Node `errno`, when the failure came from the OS rather than from `bd`. */
  readonly errno?: number
  /** Install command, set when the failure means "no installation was found". */
  readonly hint?: string
}

/** The discriminated probe outcome. */
export type BeadsProbeResult = BeadsProbeAvailable | BeadsProbeUnavailable

/** Options accepted by {@link probeBeads}. */
export interface ProbeBeadsOptions {
  /** Runner to probe through. Defaults to a process runner using the launch seam. */
  readonly runner?: BeadsRunner
  /** Launch specification for the default runner. */
  readonly launch?: BeadsLaunch
  /** Directory `bd version` runs in. Defaults to the current directory. */
  readonly cwd?: string
  /** Milliseconds before the probe gives up. */
  readonly timeoutMs?: number
  /** Reuse the process-wide answer. Defaults to true; ignored for an injected runner. */
  readonly cache?: boolean
}

/** The process-wide answer, so a Doctor and a suite do not each start `bd`. */
let cached: Promise<BeadsProbeResult> | undefined

/**
 * Ask whether a usable `bd` is there.
 *
 * Never throws. An injected `runner` is used verbatim, which is what makes the
 * function testable without a binary; otherwise the launch seam decides how to
 * start `bd`.
 * @param options - runner, launch, directory, timeout, cache control.
 * @returns `{ available: true, version }`, or `{ available: false, reason, … }`
 * naming the real failure — the OS code when `bd` could not be started, or the
 * exit code and stderr when it ran and refused.
 */
export function probeBeads(options: ProbeBeadsOptions = {}): Promise<BeadsProbeResult> {
  const reusable = (options.cache ?? true) && options.runner === undefined && options.launch === undefined
  if (reusable) {
    cached ??= runProbe(options)
    return cached
  }
  return runProbe(options)
}

/** One probe attempt, with every failure turned into a value. */
async function runProbe(options: ProbeBeadsOptions): Promise<BeadsProbeResult> {
  const cwd = options.cwd ?? process.cwd()
  let runner = options.runner
  try {
    runner ??= createProcessRunner({
      ...(options.launch === undefined ? {} : { launch: options.launch }),
      timeoutMs: options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    })
    const result = await runner.run({ args: ['version'], cwd })
    if (result.code !== 0) {
      return {
        available: false,
        reason: 'nonzero-exit',
        code: result.code,
        stderr: result.stderr,
      }
    }
    return {
      available: true,
      version: parseBdVersion(result.stdout),
      banner: result.stdout.split(/\r?\n/, 1)[0] ?? '',
    }
  } catch (error) {
    return failureOf(error)
  }
}

/** Turn anything a probe can throw into the discriminated failure value. */
function failureOf(error: unknown): BeadsProbeUnavailable {
  if (error instanceof BeadsLaunchRefusal) {
    return {
      available: false,
      reason: 'binary-not-found',
      stderr: error.message,
      code: error.code,
      hint: error.hint,
    }
  }
  const code = (error as { code?: unknown } | null)?.code
  const errno = (error as { errno?: unknown } | null)?.errno
  const message = error instanceof Error ? error.message : String(error)
  return {
    available: false,
    reason: /exceeded \d+ ?ms/i.test(message) ? 'timeout' : 'spawn-failed',
    stderr: message,
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    ...(typeof errno === 'number' ? { errno } : {}),
  }
}

/**
 * One line an operator can act on: what failed, with the OS code, and the exact
 * command that fixes it.
 *
 * Shared by the Doctor finding and by the test suite's skip notice, so the two
 * cannot drift — and so neither can claim a cause (EPERM, for instance) that the
 * probe never observed.
 * @param result - a probe outcome.
 * @returns a human-readable sentence naming the real failure.
 */
export function describeBeadsProbe(result: BeadsProbeResult): string {
  if (result.available) return `bd ${result.version} is available (${result.banner})`
  const codes = [
    result.code === undefined ? undefined : `code=${String(result.code)}`,
    result.errno === undefined ? undefined : `errno=${String(result.errno)}`,
  ].filter((part): part is string => part !== undefined)
  const suffix = codes.length === 0 ? '' : ` (${codes.join(' ')})`
  const detail = result.stderr === '' ? '' : `; ${result.stderr}`
  return (
    `bd is unavailable: ${result.reason}${suffix}${detail}`
    + `; install Beads 1.3.0 with "${result.hint ?? BEADS_INSTALL_HINT}" and check \`bd version\``
  )
}
