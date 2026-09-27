/**
 * Single-writer discipline for state files (F-34, MW-004/039/040).
 *
 * What has to hold: while one holder is inside the critical section a second
 * one does not enter it and learns why in a typed way (`lock-timeout`); when the
 * holder leaves, the next caller gets in; and a lock abandoned by a crashed
 * writer does not block the store forever.
 *
 * The lock is not applied to `.sqlite` files: SQLite serialises writers itself.
 * The files it protects are the single-file artefacts of MW-040 (export, backup
 * manifest, migration journal), which is also why this suite uses a plain file.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { storage } from '../lib/fixtures.mjs'

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-storage-'))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

test('a second holder does not enter the critical section and times out', async () => {
  const target = join(tempDir(), 'state.json')
  const entered = []
  let release
  const held = new Promise(resolve => {
    release = resolve
  })
  let inside
  const holding = new Promise(resolve => {
    inside = resolve
  })

  const first = storage.withFileLock(target, async () => {
    entered.push('first')
    inside()
    await held
  })
  await holding
  assert.deepEqual(entered, ['first'], 'the first holder owns the lock')

  await assert.rejects(
    () => storage.withFileLock(target, () => {
      entered.push('second')
      return 'never entered'
    }, { timeoutMs: 50 }),
    error => error.name === 'StorageError'
      && error.code === storage.LOCK_TIMEOUT
      && /held by another writer/.test(error.message),
    'a busy lock is a typed refusal, not a hang',
  )
  assert.deepEqual(entered, ['first'], 'the second body never ran')

  release()
  await first
  assert.equal(existsSync(`${target}.lock`), false, 'the lock is released with the critical section')
})

test('the lock is released, and an abandoned one is broken', async () => {
  const target = join(tempDir(), 'state.json')
  const ran = []

  await storage.withFileLock(target, () => {
    ran.push('first')
  })
  assert.deepEqual(ran, ['first'])
  assert.equal(existsSync(`${target}.lock`), false)

  await storage.withFileLock(target, () => {
    ran.push('second')
  })
  assert.deepEqual(ran, ['first', 'second'], 'the lock is free again')

  // A writer that died leaves `<target>.lock` behind; its age is the evidence.
  writeFileSync(`${target}.lock`, JSON.stringify({ pid: 999_999, at: 1 }))
  await storage.withFileLock(target, () => {
    ran.push('third')
  }, { staleMs: 50, timeoutMs: 500 })
  assert.deepEqual(ran, ['first', 'second', 'third'], 'an abandoned lock is broken, not waited on')
  assert.equal(existsSync(`${target}.lock`), false, 'the broken lock does not outlive the call')

  // A throwing critical section must release the lock on the way out, too.
  await assert.rejects(
    () => storage.withFileLock(target, () => {
      throw new Error('body failed')
    }),
    /body failed/,
  )
  assert.equal(existsSync(`${target}.lock`), false, 'the lock does not survive a failed body')
  await storage.withFileLock(target, () => {
    ran.push('fourth')
  })
  assert.deepEqual(ran, ['first', 'second', 'third', 'fourth'])
})
