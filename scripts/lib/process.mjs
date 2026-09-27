/**
 * Process helpers shared by the verification scripts.
 *
 * Every spawn uses file-backed stdio instead of pipes, so these scripts also
 * run inside a confined DSH shell where a child process cannot open pipes
 * (`spawn EPERM`). The pnpm launcher prefers the package manager's own JS entry
 * (`npm_execpath`), which needs no shell and no argument re-quoting.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, parse, resolve } from 'node:path'

/**
 * Run a command and capture its streams in files.
 * @param {string} command - executable to spawn.
 * @param {string[]} args - argument vector.
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, logDir: string, logName: string, shell?: boolean }} options
 *   - working directory, environment, log destination, and optional shell.
 * @returns {{ status: number | undefined, error: Error | undefined, stdout: string, stderr: string, outPath: string, errPath: string }}
 *   the exit status (undefined when the spawn itself failed) and both streams.
 */
export function runCaptured(command, args, options) {
  const { cwd, env, logDir, logName, shell = false } = options
  mkdirSync(logDir, { recursive: true })
  const outPath = join(logDir, `${logName}.out.log`)
  const errPath = join(logDir, `${logName}.err.log`)
  const out = openSync(outPath, 'w')
  const err = openSync(errPath, 'w')
  let result
  try {
    result = spawnSync(command, args, { cwd, env, stdio: ['ignore', out, err], shell })
  } finally {
    closeSync(out)
    closeSync(err)
  }
  return {
    status: result.error === undefined ? result.status : undefined,
    error: result.error,
    stdout: readFileSync(outPath, 'utf8'),
    stderr: readFileSync(errPath, 'utf8'),
    outPath,
    errPath,
  }
}

/**
 * Quote one argument for a `cmd.exe` command line. Used only on the fallback
 * path where no shell-free launch exists.
 * @param {string} value - the raw argument.
 * @returns {string} the argument, quoted when it contains characters the shell would split on.
 */
export function quoteCommandArg(value) {
  return /[\s"&|<>^()]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/**
 * Whether a path exists and is a regular file.
 * @param {string} path - candidate path.
 * @returns {boolean} true when a readable regular file sits there.
 */
function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Find the real `pnpm` JavaScript entry near an `npm_execpath` value.
 *
 * `npm_execpath` is not always a `.js` file: pnpm's own `exe` layout points at
 * `...\node_modules\@pnpm\exe\pnpm.exe`, and older store links point at an
 * extensionless `...\node_modules\pnpm\pnpm`. The executable or bare path is a
 * shim, but the real entry (`node_modules/pnpm/bin/pnpm.cjs`) usually sits next
 * to it, and that entry can be spawned without any shell.
 * @param {string} execPath - the raw `npm_execpath` value.
 * @returns {string | undefined} absolute path of `pnpm.cjs`, or undefined.
 */
function defaultPnpmCjsNear(execPath) {
  const absolute = resolve(execPath)
  const candidates = [
    join(dirname(absolute), 'bin', 'pnpm.cjs'),
    join(absolute, 'bin', 'pnpm.cjs'),
    join(dirname(absolute), 'pnpm', 'bin', 'pnpm.cjs'),
  ]
  // Walk up towards the drive root: any ancestor may carry node_modules/pnpm.
  let current = dirname(absolute)
  const { root } = parse(current)
  for (let depth = 0; depth < 8; depth += 1) {
    candidates.push(join(current, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'))
    candidates.push(join(current, 'pnpm', 'bin', 'pnpm.cjs'))
    if (current === root) break
    current = dirname(current)
  }
  return candidates.find(candidate => isFile(candidate))
}

/**
 * Locate corepack's JavaScript entry, which ships with Node itself.
 * @returns {string | undefined} absolute path of `corepack.js`, or undefined.
 */
function defaultCorepackEntry() {
  const candidates = [
    join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js'),
    'C:\\Program Files\\nodejs\\node_modules\\corepack\\dist\\corepack.js',
  ]
  return candidates.find(candidate => isFile(candidate))
}

/**
 * Resolve `pnpm` through `PATH` without asking a shell to do it.
 *
 * Only a real executable is returned; `.cmd`/`.bat` shims are reported
 * separately because they still need `cmd.exe` (but never `shell: true`).
 * @returns {string | undefined} absolute path of the first `pnpm` on `PATH`.
 */
function defaultPnpmOnPath() {
  const result = spawnSync('where.exe', ['pnpm'], { encoding: 'utf8', shell: false })
  if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
  const lines = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
  return lines[0]
}

/**
 * Production probes. Injected into {@link pnpmLaunch} so the launcher is
 * testable without a real toolchain, and so the test never touches the host.
 * @returns {{ isFile: typeof isFile, pnpmCjsNear: typeof defaultPnpmCjsNear, corepackEntry: typeof defaultCorepackEntry, pnpmOnPath: typeof defaultPnpmOnPath }}
 *   the probe bundle.
 */
export function createProbes() {
  return { isFile, pnpmCjsNear: defaultPnpmCjsNear, corepackEntry: defaultCorepackEntry, pnpmOnPath: defaultPnpmOnPath }
}

/**
 * Launch specification for pnpm.
 *
 * The default path used to be `{ command: 'pnpm', shell: true }` on Windows,
 * which handed the decision to `cmd.exe`; that reached a 52-byte broken store
 * shim and failed with `'…\node_modules\pnpm\pnpm"' is not recognized as an
 * internal or external command`. Every branch below is shell-free, so the
 * runner no longer depends on what `PATH` happens to resolve to first.
 * @param {{ env?: NodeJS.ProcessEnv, probe?: ReturnType<typeof createProbes> }} [options]
 *   - environment override and injectable probes.
 * @returns {{ kind: 'js-entry' | 'pnpm-cjs' | 'corepack' | 'exe' | 'cmd-shim' | 'unavailable', command?: string, args?: string[], style?: 'vector' | 'command-line', shim?: string, shell: boolean, reason?: string }}
 *   the spawn specification; `kind: 'unavailable'` carries a human reason.
 */
export function pnpmLaunch(options = {}) {
  const env = options.env ?? process.env
  const probe = options.probe ?? createProbes()
  const execPath = env.npm_execpath

  if (execPath !== undefined && /\.[cm]?js$/.test(execPath) && probe.isFile(execPath)) {
    return { kind: 'js-entry', command: process.execPath, args: [execPath], shell: false }
  }

  if (execPath !== undefined) {
    const cjs = probe.pnpmCjsNear(execPath)
    if (cjs !== undefined) return { kind: 'pnpm-cjs', command: process.execPath, args: [cjs], shell: false }
  }

  const corepack = probe.corepackEntry()
  if (corepack !== undefined) {
    return { kind: 'corepack', command: process.execPath, args: [corepack, 'pnpm'], shell: false }
  }

  const onPath = probe.pnpmOnPath()
  if (onPath !== undefined) {
    if (/\.(cmd|bat)$/i.test(onPath)) {
      return {
        kind: 'cmd-shim',
        command: env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c'],
        style: 'command-line',
        shim: onPath,
        shell: false,
      }
    }
    return { kind: 'exe', command: onPath, args: [], shell: false }
  }

  const seen = execPath === undefined ? 'npm_execpath is not set' : `npm_execpath=${execPath}`
  return {
    kind: 'unavailable',
    shell: false,
    reason: `no shell-free pnpm launch found (${seen}); tried a nearby pnpm.cjs, corepack, and PATH`,
  }
}

/**
 * Run pnpm with the given arguments, preferring a shell-free launch.
 *
 * The `cmd-shim` branch needs `cmd.exe` to expand a `.cmd` batch file, but it
 * passes the whole command as one quoted argument to an explicit `cmd.exe`
 * with `shell: false`, which is not what Node 24 deprecates (DEP0190) and does
 * not re-quote the paths a second time.
 * @param {string[]} args - pnpm arguments.
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, logDir: string, logName: string }} options - spawn context.
 * @returns {ReturnType<typeof runCaptured> & { launch: ReturnType<typeof pnpmLaunch> }} the captured result plus the branch that ran.
 * @throws {Error} when no shell-free launch exists.
 */
export function runPnpm(args, options) {
  const launch = pnpmLaunch()
  if (launch.kind === 'unavailable') throw new Error(`pnpm is unavailable: ${launch.reason}`)
  if (launch.style === 'command-line') {
    const line = [launch.shim, ...args].map(quoteCommandArg).join(' ')
    return { ...runCaptured(launch.command, [...launch.args, line], { ...options, shell: false }), launch }
  }
  return { ...runCaptured(launch.command, [...launch.args, ...args], { ...options, shell: false }), launch }
}
