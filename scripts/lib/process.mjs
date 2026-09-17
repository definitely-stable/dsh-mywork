/**
 * Process helpers shared by the verification scripts.
 *
 * Every spawn uses file-backed stdio instead of pipes, so these scripts also
 * run inside a confined DSH shell where a child process cannot open pipes
 * (`spawn EPERM`). The pnpm launcher prefers the package manager's own JS entry
 * (`npm_execpath`), which needs no shell and no argument re-quoting.
 */

import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

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
 * Launch specification for pnpm: its JavaScript entry when the running package
 * manager exposes one, otherwise the executable from `PATH`.
 * @returns {{ command: string, args: string[], shell: boolean }} the spawn specification.
 */
export function pnpmLaunch() {
  const execPath = process.env.npm_execpath
  if (execPath !== undefined && /\.[cm]?js$/.test(execPath)) {
    return { command: process.execPath, args: [execPath], shell: false }
  }
  return { command: 'pnpm', args: [], shell: process.platform === 'win32' }
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
 * Run pnpm with the given arguments, preferring a shell-free launch. When a
 * shell is unavoidable (pnpm resolved through its Windows executable), the
 * whole command is passed as one command line: `shell: true` with an argument
 * vector is what Node 24 deprecates (DEP0190), and it would re-quote the paths.
 * @param {string[]} args - pnpm arguments.
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, logDir: string, logName: string }} options - spawn context.
 * @returns {ReturnType<typeof runCaptured>} the captured result.
 */
export function runPnpm(args, options) {
  const launch = pnpmLaunch()
  if (launch.shell) {
    const line = [launch.command, ...launch.args, ...args].map(quoteCommandArg).join(' ')
    return runCaptured(line, [], { ...options, shell: true })
  }
  return runCaptured(launch.command, [...launch.args, ...args], { ...options, shell: false })
}
