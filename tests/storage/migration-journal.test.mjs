/**
 * The migration journal is a checked contract, not an artefact (F-20, MW-040).
 *
 * What has to hold: `schema_migrations` and `PRAGMA user_version` are written in
 * the same transaction, so a database whose journal lost a row — or whose
 * journal runs ahead of the stamp — is damaged state, and it is refused with a
 * typed failure instead of being opened as if it were complete. A healthy
 * database keeps opening, and a repaired journal makes the refusal go away.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { after } from 'node:test'

import { evidence, execution, lease, planner, storage } from '../lib/fixtures.mjs'

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

/** The canonical set the composition root assembles (F-18/F-29). */
function canonicalMigrations() {
  return storage.canonicalMigrations([
    storage.MYWORK_MIGRATIONS,
    evidence.EVIDENCE_MIGRATIONS,
    lease.LEASE_MIGRATIONS,
    planner.PLAN_MUTATION_MIGRATIONS,
    execution.CLAIM_SAGA_MIGRATIONS,
  ])
}

test('a journal that lost a row refuses to open the database, and repairing it opens again', async () => {
  const path = join(tempDir(), 'registry.sqlite')
  const migrations = canonicalMigrations()
  const last = migrations.at(-1)
  const victim = migrations[2]

  const store = await storage.openStore({ path, migrations })
  assert.equal(store.schemaVersion, last.version)
  assert.equal(store.migrations.length, migrations.length)
  store.transaction(tx => tx.run('DELETE FROM schema_migrations WHERE version = ?', victim.version))
  store.close()

  await assert.rejects(
    () => storage.openStore({ path, migrations }),
    error => error.name === 'StorageError'
      && error.code === storage.MIGRATION_JOURNAL_INCONSISTENT
      && error.details.userVersion === last.version
      && !error.details.journal.includes(victim.version)
      && error.details.expected.includes(victim.version),
    'a version stamped on disk but missing from the journal must be reported, not accepted',
  )

  // Restoring the row repairs the database; the check is exact, not "refuse
  // everything from now on".
  const raw = new DatabaseSync(path)
  raw.exec(
    `INSERT INTO schema_migrations (version, name, applied_at) VALUES (${victim.version}, '${victim.name}', 0)`,
  )
  raw.close()

  const repaired = await storage.openStore({ path, migrations })
  try {
    assert.equal(repaired.schemaVersion, last.version)
    assert.deepEqual(repaired.migrations.map(row => row.version), migrations.map(migration => migration.version))
  } finally {
    repaired.close()
  }
})

test('a journal row ahead of the version stamp is refused as well', async () => {
  const path = join(tempDir(), 'registry.sqlite')
  const migrations = canonicalMigrations()
  const last = migrations.at(-1)

  // A healthy database opens twice without complaint.
  const first = await storage.openStore({ path, migrations })
  const applied = first.migrations.map(row => row.version)
  first.close()
  const second = await storage.openStore({ path, migrations })
  assert.deepEqual(second.migrations.map(row => row.version), applied, 'reopening applies nothing twice')

  const ahead = last.version + 1
  second.transaction(tx =>
    tx.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', ahead, 'claimed-but-not-applied', 0),
  )
  assert.equal(second.schemaVersion, last.version, 'the stamp did not move with the extra row')
  second.close()

  await assert.rejects(
    () => storage.openStore({ path, migrations }),
    error => error.code === storage.MIGRATION_JOURNAL_INCONSISTENT
      && error.details.journal.includes(ahead)
      && error.details.userVersion === last.version,
    'a journal that runs ahead of the stamp must be reported',
  )

  // The version the stamp does not know cannot be applied away: the list this
  // build has ends at `last`, so the database is genuinely inconsistent.
  assert.equal(migrations.some(migration => migration.version === ahead), false)
})
