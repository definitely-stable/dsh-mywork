/**
 * Open pragmas of the state store (F-35, MW-004/039/040).
 *
 * What has to hold: WAL and foreign keys stay as they were (this is a
 * regression check, not a re-open of a settled question), `synchronous` is the
 * WAL recommendation `NORMAL` unless a caller asks for `FULL`, and a database
 * created by this build starts in `INCREMENTAL` auto-vacuum mode so freed pages
 * can return to the filesystem (F-39).
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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

/** One PRAGMA value read through an open store. */
function pragma(store, name) {
  return store.transaction(tx => tx.get(`PRAGMA ${name}`))
}

test('the settled pragmas are still in place: WAL and foreign keys', async () => {
  const store = await storage.openStore({
    path: join(tempDir(), 'registry.sqlite'),
    migrations: storage.MYWORK_MIGRATIONS,
  })
  try {
    assert.equal(pragma(store, 'journal_mode').journal_mode, 'wal', 'the store runs on WAL')
    assert.equal(pragma(store, 'foreign_keys').foreign_keys, 1, 'foreign keys are enforced')
    assert.equal(pragma(store, 'busy_timeout').timeout, storage.DEFAULT_BUSY_TIMEOUT_MS)
  } finally {
    store.close()
  }
})

test('synchronous is NORMAL by default, and FULL is available on request', async () => {
  const dir = tempDir()
  const store = await storage.openStore({ path: join(dir, 'registry.sqlite'), migrations: storage.MYWORK_MIGRATIONS })
  try {
    assert.equal(pragma(store, 'synchronous').synchronous, 1, 'NORMAL is the WAL default this build uses')
  } finally {
    store.close()
  }

  const connection = await storage.openSqlite({
    path: join(dir, 'explicit-full.sqlite'),
    busyTimeoutMs: storage.DEFAULT_BUSY_TIMEOUT_MS,
    synchronous: 'FULL',
  })
  try {
    assert.equal(Number(connection.get('PRAGMA synchronous').synchronous), 2, 'a caller can still pay for FULL')
  } finally {
    connection.close()
  }
})

test('a database created by this build starts in incremental auto-vacuum mode', async () => {
  const dir = tempDir()
  const store = await storage.openStore({ path: join(dir, 'registry.sqlite'), migrations: storage.MYWORK_MIGRATIONS })
  try {
    assert.equal(pragma(store, 'auto_vacuum').auto_vacuum, 2, 'INCREMENTAL, so compact() can return pages later')
    assert.equal(store.schemaVersion, storage.MYWORK_SCHEMA_VERSION)
  } finally {
    store.close()
  }

  // The mode is only honoured while the database has no schema, so one created
  // before F-35 keeps `NONE` — and `compact()` is what adopts `INCREMENTAL`,
  // because only the rewrite `VACUUM` performs applies a pending change.
  const legacyPath = join(dir, 'legacy.sqlite')
  const raw = new DatabaseSync(legacyPath)
  raw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT')
  raw.close()

  const legacy = await storage.openSqlite({ path: legacyPath, busyTimeoutMs: 5_000 })
  try {
    assert.equal(
      Number(legacy.get('PRAGMA auto_vacuum').auto_vacuum),
      0,
      'the pragma on an existing schema is ignored, so the old database keeps NONE',
    )
  } finally {
    legacy.close()
  }

  await storage.compact({ path: legacyPath })

  const compacted = await storage.openSqlite({ path: legacyPath, busyTimeoutMs: 5_000 })
  try {
    assert.equal(
      Number(compacted.get('PRAGMA auto_vacuum').auto_vacuum),
      2,
      'compact() is what moves an existing database to INCREMENTAL',
    )
    assert.equal(compacted.get('PRAGMA journal_mode').journal_mode, 'wal', 'compaction kept the database on WAL')
  } finally {
    compacted.close()
  }
})
