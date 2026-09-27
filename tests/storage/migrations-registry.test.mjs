/**
 * The single migration registry (F-18, D08, §15.3).
 *
 * What has to hold: one list describes the database as a whole, its versions are
 * every layer's versions and nothing else, they run `1..N` without a gap, and
 * the set passes the same validation a store applies before it opens. The
 * expected versions are read from the packages themselves — a hand-typed
 * `[1, 2, 3, 4, 5, 6]` here would have to be edited by hand whenever a migration
 * is added, and would "confirm" a duplicate (defect R-04).
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { evidence, execution, lease, planner, storage } from '../lib/fixtures.mjs'

/**
 * The layer lists, as the composition root will hand them over — the same
 * assembly F-29 performs, in the order the packages declare.
 */
function layerLists() {
  return [
    storage.MYWORK_MIGRATIONS,
    evidence.EVIDENCE_MIGRATIONS,
    lease.LEASE_MIGRATIONS,
    planner.PLAN_MUTATION_MIGRATIONS,
    execution.CLAIM_SAGA_MIGRATIONS,
  ]
}

test('the canonical registry is exactly the union of the layer lists', () => {
  const lists = layerLists()
  const canonical = storage.canonicalMigrations(lists)

  for (const list of lists) {
    assert.ok(list.length > 0, 'every layer contributes at least one migration')
    for (const migration of list) {
      const found = canonical.find(candidate => candidate.version === migration.version)
      assert.ok(found !== undefined, `version ${migration.version} of "${migration.name}" is in the registry`)
      assert.equal(found.name, migration.name, `version ${migration.version} keeps the name its layer gave it`)
    }
  }

  const versions = canonical.map(migration => migration.version)
  assert.equal(new Set(versions).size, versions.length, 'no version appears twice')
  for (let index = 1; index < versions.length; index += 1) {
    assert.ok(versions[index] > versions[index - 1], `versions rise: ${versions[index - 1]} < ${versions[index]}`)
  }
  assert.equal(versions.length, canonical.length, 'the registry holds every contribution')
})

test('the schema version is the last canonical migration, not a written-down number', () => {
  const lists = layerLists()
  const canonical = storage.canonicalMigrations(lists)
  const version = canonical[canonical.length - 1].version

  // Each layer's own declared version is the last of its list.
  assert.equal(evidence.EVIDENCE_SCHEMA_VERSION, evidence.EVIDENCE_MIGRATIONS.at(-1).version)
  assert.equal(lease.LEASE_SCHEMA_VERSION, lease.LEASE_MIGRATIONS.at(-1).version)
  assert.equal(planner.PLAN_MUTATION_SCHEMA_VERSION, planner.PLAN_MUTATION_MIGRATIONS.at(-1).version)
  assert.equal(execution.CLAIM_SAGA_SCHEMA_VERSION, execution.CLAIM_SAGA_MIGRATIONS.at(-1).version)
  assert.equal(storage.MYWORK_SCHEMA_VERSION, storage.MYWORK_MIGRATIONS.at(-1).version)

  // The database version is the greatest declared version, and the set is dense:
  // so many migrations, so many versions, ending at the version itself.
  assert.equal(version, Math.max(...lists.map(list => list.at(-1).version)))
  assert.equal(canonical.length, version, 'the canonical set is dense: version N is the Nth migration')
  assert.ok(version >= lists.length, `the layers named ${lists.length} versions, the registry ends at ${version}`)
})

test('the canonical set passes validation, and a skipped or duplicated version does not', () => {
  const canonical = storage.canonicalMigrations(layerLists())

  assert.doesNotThrow(() => storage.validateMigrations(canonical))
  assert.doesNotThrow(() => storage.assertCanonicalMigrations(canonical))

  const last = canonical.at(-1)
  const skipped = { version: last.version + 2, name: 'skipped-number', up: () => {} }
  assert.throws(
    () => storage.assertCanonicalMigrations([...canonical, skipped]),
    error => error.name === 'StorageError' && error.code === 'invalid-input',
    'a hand-typed number that leaves a gap in the sequence is refused',
  )

  assert.throws(
    () => storage.validateMigrations([...canonical, last]),
    error => error.name === 'StorageError' && error.code === 'invalid-input',
    'a duplicated version is refused',
  )

  // A registry with a hole is not canonical: the missing version is a gap, and
  // the check names it rather than letting a hand-picked set pass as complete.
  // (A prefix such as `[1]` is dense and therefore canonical — the rule is
  // "1..N without a hole", not "the one blessed N".)
  const gapped = canonical.filter((_, index) => index !== 1)
  assert.throws(
    () => storage.assertCanonicalMigrations(gapped),
    error => error.name === 'StorageError' && error.code === 'invalid-input',
    'a version missing from the middle is refused',
  )
})
