/**
 * Opening a store requires an explicit migration list (F-19, D08).
 *
 * What has to hold: a store that is handed no list refuses to open — with a
 * typed failure, before the file is touched — because the old default opened a
 * v1 database and declared it complete. An empty list is not a list either. An
 * explicit subset is fine: the rule is explicitness, not one mandatory set.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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

test('a store refuses to open without an explicit migration list', async () => {
  const dir = tempDir()
  const path = join(dir, 'registry.sqlite')

  await assert.rejects(
    () => storage.openStore({ path }),
    error => error.name === 'StorageError'
      && error.code === storage.MIGRATIONS_REQUIRED
      && /openStore requires an explicit migration list/.test(error.message),
    'opening without a list must be a typed refusal',
  )
  assert.equal(existsSync(path), false, 'the refusal happens before the database file is created')

  // The vocabulary is pinned: the repository spells codes in kebab case, and the
  // plan's identifier is the same value under a named constant.
  assert.equal(storage.MIGRATIONS_REQUIRED, 'migrations-required')
  assert.ok(storage.STORAGE_ERROR_CODES.includes(storage.MIGRATIONS_REQUIRED))
})

test('an empty list is refused too, and an explicit subset opens', async () => {
  const dir = tempDir()
  const path = join(dir, 'registry.sqlite')

  await assert.rejects(
    () => storage.openStore({ path, migrations: [] }),
    error => error.code === storage.MIGRATIONS_REQUIRED,
    'an empty list is not a complete database',
  )
  assert.equal(existsSync(path), false, 'the empty list is refused before the file is created')

  // An explicit list — even a short one — is a valid open: the database is
  // declared to be exactly what the caller named.
  const kernel = storage.MYWORK_MIGRATIONS[0]
  const store = await storage.openStore({ path, migrations: [kernel] })
  try {
    assert.equal(store.schemaVersion, kernel.version)
    assert.deepEqual(store.migrations.map(row => row.name), [kernel.name])
  } finally {
    store.close()
  }
})
