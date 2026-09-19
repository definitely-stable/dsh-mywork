/**
 * Beads workspace discovery and the fail-closed refusal (ADR023).
 *
 * The adapter operates on a workspace the owner already initialised. It never
 * creates one: ADR023 requires a missing workspace to produce a typed refusal
 * carrying the exact command an operator should run, and the card repeats that
 * `bd init` must not be executed by the adapter.
 *
 * Discovery uses `bd context`, not a filesystem walk. That matters because `bd`
 * resolves a workspace by walking **up** from the working directory, so a command
 * issued from any subdirectory of the repository lands in the repository's
 * ancestor workspace (ADR023). Asking `bd` where it landed is therefore the only
 * answer that matches where the commands will actually go; looking for `.beads`
 * ourselves could disagree with it.
 * @module
 */

import type { BeadsRunner } from './runner.ts'

/** Where `bd` resolved its workspace, as `bd context` reports it. */
export interface BeadsWorkspace {
  /** Absolute path of the `.beads` directory. */
  readonly beadsDir: string
  /** Repository root `bd` considers itself to belong to. */
  readonly repoRoot: string
  /** Backend type, e.g. `dolt`. */
  readonly backendType: string
  /** Backend mode, e.g. `embedded`. */
  readonly backendMode: string
  /** Database name. */
  readonly database: string
  /** Issue id prefix, e.g. `mw`. */
  readonly issuePrefix: string
}

/** The `bd init` invocation that would create the workspace MyWork expects. */
export const BEADS_INIT_COMMAND = 'bd init --prefix mw --skip-agents --skip-hooks'

/**
 * Parse `bd context` output.
 *
 * The format is `  key:   value` lines under headings. Parsing is tolerant about
 * spacing but strict about which keys it needs: a `bd` that stops reporting the
 * beads directory makes discovery fail rather than silently returning a
 * half-filled workspace.
 * @param output - stdout of `bd context`.
 * @returns the resolved workspace, or `undefined` when the output is not a context report.
 */
export function parseBeadsContext(output: string): BeadsWorkspace | undefined {
  const fields = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([a-z][a-z0-9 _-]*?):\s+(.*\S)\s*$/i.exec(line)
    if (match === null) continue
    const key = match[1]?.trim().toLowerCase()
    const value = match[2]?.trim()
    if (key === undefined || value === undefined) continue
    // First occurrence wins: `bd context` prints the resolved workspace before
    // any later section that might reuse a label.
    if (!fields.has(key)) fields.set(key, value)
  }
  const beadsDir = fields.get('beads dir')
  const repoRoot = fields.get('repo root')
  if (beadsDir === undefined || repoRoot === undefined) return undefined
  return Object.freeze({
    beadsDir,
    repoRoot,
    backendType: fields.get('type') ?? '',
    backendMode: fields.get('mode') ?? '',
    database: fields.get('database') ?? '',
    // `bd context` reports the prefix inside the id example ("mw-<hash>"), so it
    // is read from `issue_prefix` config rather than invented from the example.
    issuePrefix: fields.get('issue prefix') ?? '',
  })
}

/** How `bd` failed, in the terms ADR023 requires the adapter to recognise. */
export type BeadsFailureKind =
  /** No beads workspace was found from this directory. */
  | 'no-workspace'
  /** `bd` panicked — observed as `bd init` exiting 2 while its Dolt root was unreachable. */
  | 'panic'
  /** The process could not be started at all (missing binary, EPERM, sandbox denial). */
  | 'spawn-failed'
  /** `bd` ran and failed for an ordinary reason. */
  | 'command-failed'

/**
 * Classify a `bd` failure from its exit code and stderr.
 *
 * `bd init` panics with exit `2` and a nil-pointer trace when its Dolt root is
 * unreachable, instead of reporting a clean error (ADR023). That case must be
 * told apart from an ordinary failure, because an ordinary failure is worth
 * retrying and a missing Dolt root is not — it resolves to `ADAPTER_UNAVAILABLE`
 * with a Doctor entry rather than a silent retry loop.
 * @param code - process exit code.
 * @param stderr - process standard error.
 */
export function classifyBeadsFailure(code: number, stderr: string): BeadsFailureKind {
  // A Go panic always prints this marker before the goroutine trace.
  if (/panic:/i.test(stderr) || /goroutine \d+ \[running\]/.test(stderr)) return 'panic'
  if (/no beads database found/i.test(stderr)) return 'no-workspace'
  if (/not a beads workspace|no \.beads directory/i.test(stderr)) return 'no-workspace'
  // Exit 2 without a panic marker is still worth separating from a plain failure.
  if (code === 2) return 'panic'
  return 'command-failed'
}

/**
 * Discover the workspace `bd` would use from `cwd`.
 * @param runner - the process seam.
 * @param cwd - directory commands will run in.
 * @returns the workspace, or `undefined` when none could be resolved.
 */
export async function discoverWorkspace(
  runner: BeadsRunner,
  cwd: string,
): Promise<BeadsWorkspace | undefined> {
  let result
  try {
    result = await runner.run({ args: ['context'], cwd })
  } catch {
    return undefined
  }
  if (result.code !== 0) return undefined
  return parseBeadsContext(result.stdout)
}
