/**
 * Atomic writes and single-writer locks for state files that are not the SQLite
 * database (F-33, F-34; MW-004/039/040).
 *
 * A half-written state file is worse than an old one: the export, the backup
 * manifest and the journal MW-040 will write are single files, so the store
 * needs one primitive that writes a file whole and one that keeps two processes
 * from writing it at the same time. Both live here rather than in the caller,
 * because a directory-wide convention is what makes them hold.
 *
 * The lock is deliberately **not** applied to `.sqlite` files: SQLite already
 * serialises writers with `BEGIN IMMEDIATE` and a busy timeout, and a second
 * lock layer around it would only add deadlocks.
 * @module
 */

import { randomBytes } from 'node:crypto'
import { open, readFile, rename as renameFile, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { LOCK_TIMEOUT, StorageError } from './errors.ts'

/** How long {@link withFileLock} waits for a lock before reporting `lock-timeout`. */
export const DEFAULT_LOCK_TIMEOUT_MS = 5_000

/** Age after which a lock file is treated as abandoned by a dead process. */
export const DEFAULT_LOCK_STALE_MS = 30_000

/** Time between two attempts to take a lock. */
const LOCK_POLL_MS = 10

/** Inputs of {@link writeFileAtomic}. */
export interface WriteFileAtomicOptions {
  /**
   * The rename step; defaults to `node:fs/promises` `rename`.
   *
   * Injected so a caller — or a test — can prove what happens when the last
   * step fails: the previous content must survive and the temporary must go.
   */
  readonly rename?: (from: string, to: string) => Promise<void>
}

/**
 * Write a whole file at once: a temporary in the **same directory**, fsynced,
 * then renamed over the target.
 *
 * The temporary lives next to the target on purpose: `rename` is atomic within
 * one volume, and moving a file across volumes is a copy, which is exactly the
 * half-written state this function exists to prevent.
 * @param target - file to replace; it is created when missing.
 * @param data - the complete new content.
 * @param options - optional rename seam.
 * @throws whatever the filesystem raised; the target keeps its previous content.
 */
export async function writeFileAtomic(
  target: string,
  data: string | Uint8Array,
  options: WriteFileAtomicOptions = {},
): Promise<void> {
  const directory = dirname(target)
  const temporary = join(directory, `.${basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  const rename = options.rename ?? renameFile
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data

  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(temporary).catch(() => {})
    throw error
  }
  await handle.close()

  try {
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  await syncDirectory(directory)
}

/**
 * Ask the filesystem to make the rename itself durable.
 *
 * Best effort by design: Windows refuses to open a directory as a file, and a
 * missing directory fsync must not fail a write that has already landed.
 */
async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close().catch(() => {})
    }
  } catch {
    // Not supported here; the rename is still atomic, only its durability hint is lost.
  }
}

/** Inputs of {@link withFileLock}. */
export interface FileLockOptions {
  /** How long to wait for the lock; defaults to {@link DEFAULT_LOCK_TIMEOUT_MS}. */
  readonly timeoutMs?: number
  /** Age after which an existing lock file is abandoned; defaults to {@link DEFAULT_LOCK_STALE_MS}. */
  readonly staleMs?: number
  /** Clock, defaults to `Date.now`. */
  readonly now?: () => number
  /** Pause between attempts; defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>
}

/**
 * Run `body` while holding `<target>.lock` exclusively.
 *
 * The lock is a file created with `O_EXCL`, so two processes cannot both hold
 * it; its body carries the pid and the acquisition time, and a lock older than
 * `staleMs` is treated as abandoned and broken, so a crashed writer cannot stop
 * the store forever.
 * @param target - the state file the lock protects; the lock is `<target>.lock`.
 * @param body - critical section; its value, or its error, passes through.
 * @param options - wait budget, staleness, clock, and sleep seam.
 * @throws {StorageError} `lock-timeout` when the wait budget runs out.
 */
export async function withFileLock<T>(
  target: string,
  body: () => T | Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const lockPath = `${target}.lock`
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? delay
  const deadline = now() + timeoutMs

  for (;;) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: now() }))
      } finally {
        await handle.close()
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (await breakIfStale(lockPath, staleMs, now)) continue
      if (now() >= deadline) {
        throw new StorageError(
          LOCK_TIMEOUT,
          `dsh-mywork: "${lockPath}" is held by another writer; gave up after ${timeoutMs} ms`,
          { details: { path: target, lockPath, timeoutMs, staleMs } },
        )
      }
      await sleep(LOCK_POLL_MS)
    }
  }

  try {
    return await body()
  } finally {
    await unlink(lockPath).catch(() => {})
  }
}

/**
 * Remove an abandoned lock.
 * @returns whether the caller may retry immediately.
 */
async function breakIfStale(lockPath: string, staleMs: number, now: () => number): Promise<boolean> {
  let held = false
  try {
    const body = JSON.parse(await readFile(lockPath, 'utf8')) as { at?: unknown }
    const at = typeof body.at === 'number' ? body.at : (await stat(lockPath)).mtimeMs
    held = now() - at <= staleMs
  } catch {
    // The body was unreadable; the file's age is the only evidence left.
    try {
      held = now() - (await stat(lockPath)).mtimeMs <= staleMs
    } catch {
      return true
    }
  }
  if (held) return false
  await unlink(lockPath).catch(() => {})
  return true
}

/** Wait for a real timer. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}
