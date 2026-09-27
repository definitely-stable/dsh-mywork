/**
 * Atomic state-file writes (F-33, MW-004/039/040).
 *
 * What has to hold: a written file is either the old content or the new one,
 * never half of each; the temporary never survives a successful write; and a
 * failure at the last step (the rename) leaves the previous content in place.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
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

test('a file is written whole, with no temporary left behind', async () => {
  const dir = tempDir()
  const target = join(dir, 'state.json')

  await storage.writeFileAtomic(target, 'payload')
  assert.equal(readFileSync(target, 'utf8'), 'payload')
  assert.deepEqual(readdirSync(dir).filter(name => name.endsWith('.tmp')), [], 'no temporary survives the write')

  // Overwriting a longer file must not leave a tail of the old content.
  await storage.writeFileAtomic(target, 'shorter')
  assert.equal(readFileSync(target, 'utf8'), 'shorter')
  assert.deepEqual(readdirSync(dir), ['state.json'], 'the directory holds the target and nothing else')

  // Bytes are written as-is, not through a string conversion.
  await storage.writeFileAtomic(target, new Uint8Array([0x61, 0x00, 0x62]))
  assert.deepEqual(readFileSync(target), Buffer.from([0x61, 0x00, 0x62]))
})

test('a failed rename keeps the previous content and removes the temporary', async () => {
  const dir = tempDir()
  const target = join(dir, 'state.json')
  await storage.writeFileAtomic(target, 'first')

  await assert.rejects(
    () => storage.writeFileAtomic(target, 'second', {
      rename: async () => {
        throw new Error('rename refused')
      },
    }),
    /rename refused/,
  )
  assert.equal(readFileSync(target, 'utf8'), 'first', 'the last complete content survives a failed write')
  assert.deepEqual(readdirSync(dir), ['state.json'], 'the abandoned temporary is cleaned up')
})
