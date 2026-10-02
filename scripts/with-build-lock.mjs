#!/usr/bin/env node
/**
 * Run one command under a named build lock.
 *
 * Several agents work in this workspace at once, and `tsdown` is configured
 * with `clean: true`: two concurrent builds of one package delete each other's
 * `lib/`, and a third agent's test then fails on `missing build output` — a
 * failure that has nothing to do with its own change. The lock makes a build of
 * one package exclusive while leaving builds of *different* packages parallel.
 *
 * Usage:
 *   node scripts/with-build-lock.mjs <lock-name> <command> [args...]
 *
 * Example (the canonical build of one package):
 *   node scripts/with-build-lock.mjs execution node ../../node_modules/tsdown/dist/run.mjs
 *
 * The lock lives in `.tmp/locks/<name>.lock`, is taken with `O_EXCL`, and is
 * released even when the command fails. A lock whose owner died is broken at
 * once, because the file names the owner's pid, and {@link STALE_MS} breaks one
 * whose owner cannot be trusted to release it (a reused id, a hung process).
 * @module
 */

import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, derived so the script works from any directory. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** How long to wait for a lock before giving up. */
const WAIT_MS = 180_000

/**
 * A lock older than this is treated as abandoned.
 *
 * The pid written into the file is the primary detector, and this is the
 * backstop for the case it cannot answer (a reused pid, or a lock written by an
 * older revision of this script that named nobody). It has to be longer than any
 * real build: the full workspace build took 190.9 s and 237.6 s in this stage,
 * and a loaded machine can exceed five minutes — the first revision used
 * 300_000 ms, which a live build could outlast, after which a waiter would break
 * the lock and start a second `clean: true` build over the first one's output.
 */
const STALE_MS = 1_800_000

/** How long one retry sleeps, in milliseconds. */
const RETRY_MS = 250

const [name, ...command] = process.argv.slice(2)
if (name === undefined || command.length === 0) {
  process.stderr.write(
    'usage: node scripts/with-build-lock.mjs <lock-name> <command> [args...]\n'
    + 'example: node scripts/with-build-lock.mjs execution node ../../node_modules/tsdown/dist/run.mjs\n',
  )
  process.exit(2)
}

const lockDir = join(repoRoot, '.tmp', 'locks')
mkdirSync(lockDir, { recursive: true })
const lockPath = join(lockDir, `${name}.lock`)

/** Sleep without a timer, so the wait is synchronous and cheap. */
function pause() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_MS)
}

/** The pid a held lock names, when it names one at all. */
function ownerOf(path) {
  const text = readFileSync(path, 'utf8').trim()
  if (text === '') return undefined
  const pid = Number.parseInt(text, 10)
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

/** Whether a process with this id is still running. */
function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // A process this one may not signal is a process that exists.
    return error.code === 'EPERM'
  }
}

/**
 * Whether a held lock is abandoned.
 *
 * The pid is the precise answer and the reason a killed build no longer blocks
 * anyone: it is asked first, and a **live** owner keeps the lock. Age is asked
 * in the same breath rather than only when nobody is named, because a pid
 * outlives the meaning it had here — a reused id names a process that has
 * nothing to do with this lock, and a hung owner names one that will never
 * release it — and a lock nobody can break is worse than a build that retries.
 * {@link STALE_MS} is far longer than any real build for exactly that reason. A
 * lock whose owner has not been written yet is protected by its own fresh mtime,
 * so the two questions cannot race into stealing a just-taken lock.
 * @param path - the lock file to judge.
 */
function abandoned(path) {
  if (Date.now() - statSync(path).mtimeMs > STALE_MS) return true
  const owner = ownerOf(path)
  return owner !== undefined && !isAlive(owner)
}

/** Take the lock, or report that the wait expired. */
function acquire() {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    try {
      const descriptor = openSync(lockPath, 'wx')
      // The owner is named inside the lock: a killed build leaves the file
      // behind, and a waiter that can prove the owner is gone breaks it at once
      // instead of waiting out a timeout — a timeout a live long build can
      // outlast just as well as a dead one.
      writeSync(descriptor, String(process.pid))
      return descriptor
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      try {
        if (abandoned(lockPath)) {
          unlinkSync(lockPath)
          continue
        }
      } catch {
        // The holder released it between the open and the read: retry at once.
        continue
      }
      if (Date.now() > deadline) {
        process.stderr.write(`with-build-lock: gave up waiting for "${name}" after ${WAIT_MS} ms\n`)
        process.exit(3)
      }
      pause()
    }
  }
}

const descriptor = acquire()
try {
  // `packages/execution` outgrew the default heap while the E-stage modules were
  // added: tsdown died with exit 134 and, because `clean: true` had already
  // emptied `lib/`, every suite loading `tests/lib/fixtures.mjs` failed on a
  // missing entry point. The ceiling is raised here rather than in each command,
  // and an explicit NODE_OPTIONS from the caller still wins.
  const env = process.env.NODE_OPTIONS === undefined
    ? { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' }
    : process.env
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', shell: false, env })
  if (result.error !== undefined) {
    process.stderr.write(`with-build-lock: could not run "${command[0]}": ${result.error.message}\n`)
    process.exitCode = 1
  } else {
    process.exitCode = result.status ?? 1
  }
} finally {
  closeSync(descriptor)
  unlinkSync(lockPath)
}
