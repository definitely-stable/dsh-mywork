/**
 * How the adapter starts `bd`.
 *
 * The adapter never runs a shell, so no argument is word-split and a task title
 * can never turn into a command. On Windows that rule meets a second fact: npm
 * installs `bd` as an extensionless POSIX script plus a `bd.cmd` shim, and
 * neither can be spawned with `shell: false`. `spawn('bd', …, { shell: false })`
 * fails with `ENOENT` (`errno` -4058) and `bd.cmd` fails with `EINVAL` — the
 * shim is a command *line*, not an executable.
 *
 * The seam is therefore the JavaScript entry `@beads/bd` publishes
 * (`bin/bd.js`), started with `process.execPath`. That is what the shim itself
 * would run, so the behaviour is identical, but no shell and no `PATH` lookup is
 * involved. On POSIX nothing changes: `bd` is an executable script and is spawned
 * directly.
 * @module
 */

import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'

/** Refusal code raised when no usable `bd` entry can be located. */
export const BEADS_BINARY_NOT_FOUND = 'BEADS_BINARY_NOT_FOUND'

/** Command that installs a usable `bd`; printed with every refusal. */
export const BEADS_INSTALL_HINT = 'npm install -g @beads/bd@1.3.0'

/** Package that publishes the `bd` JavaScript entry. */
const BD_PACKAGE = ['@beads', 'bd'] as const

/** Entry extensions that only a JavaScript interpreter can run. */
const JAVASCRIPT_ENTRY = /\.(?:js|mjs|cjs)$/i

/**
 * A missing or unusable `bd` installation, reported as a value a caller can act
 * on rather than as a bare `ENOENT`.
 *
 * It is deliberately not a `MyWorkError`: the §42 code set describes operations
 * on a task graph, while this failure happens before any operation exists. The
 * adapter maps it to `ADAPTER_UNAVAILABLE` at its own boundary.
 */
export class BeadsLaunchRefusal extends Error {
  /** Machine-readable code; never parsed out of the message. */
  readonly code = BEADS_BINARY_NOT_FOUND

  /** Command that installs a usable `bd`. */
  readonly hint: string

  /**
   * @param message - what could not be resolved, in operator terms.
   * @param hint - install command; defaults to {@link BEADS_INSTALL_HINT}.
   */
  constructor(message: string, hint: string = BEADS_INSTALL_HINT) {
    super(message)
    this.name = 'BeadsLaunchRefusal'
    this.hint = hint
  }
}

/** How to start `bd`: one command, its leading arguments, and no shell. */
export interface BeadsLaunch {
  /** Executable to spawn — `process.execPath` for a JavaScript entry. */
  readonly command: string
  /** Arguments that precede the command's own, e.g. the entry path. */
  readonly args: readonly string[]
  /** Always false: a shell would re-split the argument vector. */
  readonly shell: false
}

/** Options accepted by {@link resolveBeadsLaunch}. */
export interface ResolveBeadsLaunchOptions {
  /** Platform to resolve for. Defaults to the running one; injectable for tests. */
  readonly platform?: NodeJS.Platform
  /** Explicit JavaScript entry. Wins over every search. */
  readonly entry?: string
  /** Search used on Windows when `entry` is absent. Defaults to {@link findBeadsEntry}. */
  readonly findEntry?: () => string | undefined
  /** Interpreter that runs the entry. Defaults to `process.execPath`. */
  readonly execPath?: string
  /** Directory the project-local `node_modules` search starts from. */
  readonly cwd?: string
}

/**
 * Decide how `bd` is started on this platform.
 *
 * Windows needs the JavaScript entry; POSIX keeps the direct `bd` spawn. An
 * explicit `entry` is honoured on both, because a caller that names the entry has
 * already answered the question this function exists to answer.
 * @param options - platform, explicit entry, and the search to fall back on.
 * @returns the shell-free launch specification.
 * @throws {BeadsLaunchRefusal} on Windows when no JavaScript entry is found —
 * never a silent fallback to the shim that cannot be spawned.
 */
export function resolveBeadsLaunch(options: ResolveBeadsLaunchOptions = {}): BeadsLaunch {
  const platform = options.platform ?? process.platform
  const entry =
    options.entry ??
    (platform === 'win32'
      ? (options.findEntry ?? (() => findBeadsEntry(options.cwd)))()
      : undefined)

  if (entry !== undefined && entry !== '') {
    return Object.freeze({
      command: options.execPath ?? process.execPath,
      args: Object.freeze([entry]),
      shell: false,
    })
  }

  if (platform !== 'win32') {
    // Unchanged POSIX behaviour: `bd` is an executable on PATH.
    return Object.freeze({ command: 'bd', args: Object.freeze([]), shell: false })
  }

  throw new BeadsLaunchRefusal(
    'dsh-mywork: cannot locate the bd JavaScript entry (@beads/bd/bin/bd.js); the Windows '
    + 'shim on PATH is a command line, not an executable, and cannot be spawned without a shell',
  )
}

/**
 * Locate the `bd` JavaScript entry.
 *
 * Three sources, in the order of how specific they are:
 *
 * 1. the `node_modules` chain above `cwd`, so a project that pins `@beads/bd`
 *    uses its own copy;
 * 2. the `bd.cmd` shim `PATH` would use — the shim already names the entry it
 *    runs, which makes this the exact answer to "what would the shell start";
 * 3. the well-known npm global roots, for an installation whose bin directory is
 *    not on this process's `PATH`.
 *
 * A `.bin` shim is never returned: only `.js`/`.mjs`/`.cjs` files can be handed
 * to `process.execPath`.
 * @param cwd - directory the project-local search starts from.
 * @returns absolute path of the entry, or `undefined` when there is none.
 */
export function findBeadsEntry(cwd: string = process.cwd()): string | undefined {
  return fromProject(cwd) ?? fromPathShim() ?? fromGlobalRoots()
}

/** The entry a package directory declares in its `bin.bd` field. */
function entryOf(packageDir: string): string | undefined {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
  const bin = (manifest as { bin?: unknown } | null)?.bin
  const relative =
    typeof bin === 'string' ? bin : (bin as { bd?: unknown } | undefined)?.bd
  if (typeof relative !== 'string' || relative === '') return undefined
  const entry = resolve(packageDir, relative)
  return JAVASCRIPT_ENTRY.test(entry) && existsSync(entry) ? entry : undefined
}

/** Walk up from `cwd` looking for a project-local `@beads/bd`. */
function fromProject(cwd: string): string | undefined {
  let current = resolve(cwd)
  for (;;) {
    const found = entryOf(join(current, 'node_modules', ...BD_PACKAGE))
    if (found !== undefined) return found
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * Read the `bd.cmd` shim `PATH` resolves first and take the entry it runs.
 *
 * Only the path the shim itself names is used; the shim is never executed, since
 * that would need the shell this module exists to avoid.
 */
function fromPathShim(): string | undefined {
  const entries = (process.env.PATH ?? '').split(delimiter)
  for (const directory of entries) {
    if (directory === '') continue
    const shim = join(directory, 'bd.cmd')
    if (!existsSync(shim)) continue
    let text: string
    try {
      text = readFileSync(shim, 'utf8')
    } catch {
      continue
    }
    const match = /["'](?:%dp0%[\\/])?([^"'\r\n]*@beads[\\/]bd[\\/][^"'\r\n]*\.(?:js|mjs|cjs))["']/i.exec(text)
    const named = match?.[1]
    if (named === undefined) continue
    const candidate = resolve(directory, named)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Well-known npm global roots, when the bin directory is not on `PATH`. */
function fromGlobalRoots(): string | undefined {
  const roots: string[] = []
  for (const variable of ['APPDATA', 'LOCALAPPDATA'] as const) {
    const value = process.env[variable]
    if (value !== undefined && value !== '') roots.push(join(value, 'npm', 'node_modules'))
  }
  const prefix = process.env.npm_config_prefix
  if (prefix !== undefined && prefix !== '') {
    roots.push(join(prefix, 'node_modules'), join(prefix, 'lib', 'node_modules'))
  }
  const execDir = dirname(process.execPath)
  roots.push(
    join(execDir, 'node_modules'),
    join(execDir, '..', 'node_modules'),
    join(execDir, '..', 'lib', 'node_modules'),
  )
  for (const root of roots) {
    const found = entryOf(join(root, ...BD_PACKAGE))
    if (found !== undefined) return found
  }
  return undefined
}
