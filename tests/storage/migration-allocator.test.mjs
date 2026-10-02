/**
 * The migration version allocator (F-63, §15.3, D07/D08).
 *
 * What has to hold: one place hands out versions; a request gets the same number
 * every time it asks, even across a restart; two requests never share a number;
 * a number that was handed out is not handed out again; and a migration that
 * carries an allocated number still validates, so the store keeps opening.
 *
 * The expected versions are read from the store (`schema_migrations`,
 * `PRAGMA user_version`) and from the allocator itself — never from a literal,
 * because a hand-typed number is exactly the defect this allocator removes.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

import { evidence, execution, lease, planner, repoRoot, storage } from '../lib/fixtures.mjs'

// The allocator is the composition layer's module, so it is not part of the
// domain fixture set: it is imported from its source, type-only imports and all.
const allocatorModule = await import(
  pathToFileURL(join(repoRoot, 'packages', 'controller', 'src', 'migration-allocator.ts')).href
)

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

/** A store carrying the canonical schema. */
async function openCanonical(dir) {
  return storage.openStore({ path: join(dir, 'registry.sqlite'), migrations: canonicalMigrations() })
}

/**
 * The highest version the database already accounts for — the floor every newly
 * allocated number must sit above. Read from the database, not written here.
 */
function highestOccupied(store) {
  return store.transaction(tx => Math.max(
    Number(tx.get('SELECT MAX(version) AS version FROM schema_migrations').version),
    Number(tx.get('PRAGMA user_version').user_version),
  ))
}

test('allocating the same request twice returns the same number', async () => {
  const store = await openCanonical(tempDir())
  try {
    const allocator = allocatorModule.createMigrationAllocator(store, { now: () => 1_000 })
    const first = allocator.allocate({ key: 'background_job' })
    const second = allocator.allocate({ key: 'background_job' })
    assert.equal(first, second, 'a request is idempotent: it is a name, not a counter')
    assert.equal(allocator.allocated().length, 1, 'one request, one allocation')
    assert.equal(allocator.allocated()[0].requestedAt, 1_000, 'the clock it was given is what is recorded')

    assert.throws(
      () => allocator.allocate({ key: '   ' }),
      error => allocatorModule.isMigrationAllocatorError(error) && error.code === 'invalid-request',
      'a request needs a stable key',
    )
  } finally {
    store.close()
  }
})

test('different requests get different numbers, above everything already occupied', async () => {
  const store = await openCanonical(tempDir())
  try {
    const floor = highestOccupied(store)
    const allocator = allocatorModule.createMigrationAllocator(store)
    const triggers = allocator.allocate({ key: 'retention-triggers' })
    const worktree = allocator.allocate({ key: 'attempt_worktree' })

    assert.notEqual(triggers, worktree)
    assert.ok(triggers > floor, `retention-triggers got ${triggers}, which must be above ${floor}`)
    assert.ok(worktree > floor, `attempt_worktree got ${worktree}, which must be above ${floor}`)
    assert.deepEqual(
      allocator.allocated().map(allocation => allocation.key),
      ['retention-triggers', 'attempt_worktree'],
      'allocations are reported in version order',
    )
  } finally {
    store.close()
  }
})

test('a restart keeps the numbers it handed out and does not reuse them', async () => {
  const dir = tempDir()
  const migrations = canonicalMigrations()
  const path = join(dir, 'registry.sqlite')

  const before = await storage.openStore({ path, migrations })
  const first = allocatorModule.createMigrationAllocator(before)
  const backgroundJob = first.allocate({ key: 'background_job' })
  const issued = first.allocated().map(allocation => allocation.version)
  before.close()

  const after_ = await storage.openStore({ path, migrations })
  try {
    const second = allocatorModule.createMigrationAllocator(after_)
    assert.equal(second.allocate({ key: 'background_job' }), backgroundJob, 'the same request, the same number')
    const projection = second.allocate({ key: 'placement-projection' })
    assert.equal(issued.includes(projection), false, `version ${projection} was already handed out`)
    assert.ok(projection > Math.max(backgroundJob, ...issued), 'a new number sits above every previous one')
  } finally {
    after_.close()
  }
})

test('deleting a request does not free its number', async () => {
  const store = await openCanonical(tempDir())
  try {
    const allocator = allocatorModule.createMigrationAllocator(store)
    const first = allocator.allocate({ key: 'background_job' })
    const second = allocator.allocate({ key: 'retention-triggers' })
    const issued = [first, second]
    assert.deepEqual(allocator.allocated().map(allocation => allocation.version), issued)

    store.transaction(tx => tx.run('DELETE FROM migration_allocations WHERE key = ?', 'background_job'))
    assert.deepEqual(allocator.allocated().map(allocation => allocation.key), ['retention-triggers'])

    const reissued = allocator.allocate({ key: 'attempt_worktree' })
    assert.equal(issued.includes(reissued), false, `version ${reissued} was handed out before and must not come back`)
    assert.ok(reissued > Math.max(...issued), 'the allocator moves forward from the highest number it remembers')
  } finally {
    store.close()
  }
})

test('a migration carrying an allocated number keeps the canonical set valid', async () => {
  const store = await openCanonical(tempDir())
  try {
    const migrations = canonicalMigrations()
    const allocated = allocatorModule.createMigrationAllocator(store).allocate({ key: 'background_job' })
    const extension = { version: allocated, name: 'background-job', up: () => {} }

    const extended = storage.canonicalMigrations([migrations, [extension]])
    assert.equal(extended.at(-1).version, allocated, 'the allocated number is the next version of the set')
    assert.equal(extended.length, migrations.length + 1, 'exactly one migration was added')
    assert.doesNotThrow(() => storage.validateMigrations(extended))

    // The machine check the allocator exists for: the same number twice is a
    // duplicate, and a duplicate stops the store from opening at all.
    assert.throws(
      () => storage.canonicalMigrations([migrations, [extension, { ...extension, name: 'duplicate-request' }]]),
      error => error.name === 'StorageError' && error.code === 'invalid-input',
      'two requests sharing a number must be refused before they reach a database',
    )
  } finally {
    store.close()
  }
})

test('an adopted version is kept instead of re-derived', async () => {
  // The book is one database and the numbers land in the journals of others
  // (F-63b): when the book is lost, the recorded number must come back, not a
  // fresh one that renumbers a migration onto a version already taken.
  const store = await openCanonical(tempDir())
  try {
    const floor = highestOccupied(store)
    const recorded = floor + 7
    const allocator = allocatorModule.createMigrationAllocator(store, {
      adopt: [{ key: 'background_job', version: recorded }],
    })

    assert.equal(allocator.allocate({ key: 'background_job' }), recorded, 'the adopted number is the answer')
    const fresh = allocator.allocate({ key: 'attempt_worktree' })
    assert.ok(fresh > recorded, `a new request got ${fresh}, which must sit above the adopted ${recorded}`)
    assert.deepEqual(
      allocator.allocated().map(allocation => allocation.version),
      [recorded, fresh],
      'the adoption is written back into the book, so the next open needs no recovery',
    )
  } finally {
    store.close()
  }
})

test('an adoption the book contradicts is refused as a version conflict', async () => {
  const store = await openCanonical(tempDir())
  try {
    const floor = highestOccupied(store)
    const allocator = allocatorModule.createMigrationAllocator(store, {
      adopt: [{ key: 'background_job', version: floor }],
    })
    assert.throws(
      () => allocator.allocate({ key: 'background_job' }),
      error => allocatorModule.isMigrationAllocatorError(error) && error.code === 'version-conflict',
      'a number the schema already occupies cannot be adopted for a new migration',
    )
  } finally {
    store.close()
  }
})

test('a malformed adoption is refused before a transaction starts', async () => {
  const store = await openCanonical(tempDir())
  try {
    assert.throws(
      () => allocatorModule.createMigrationAllocator(store, {
        adopt: [{ key: 'background_job', version: 9 }, { key: 'attempt_worktree', version: 9 }],
      }),
      error => allocatorModule.isMigrationAllocatorError(error) && error.code === 'invalid-request',
      'one version cannot belong to two migrations',
    )
    assert.throws(
      () => allocatorModule.createMigrationAllocator(store, { adopt: [{ key: 'background_job', version: 0 }] }),
      error => allocatorModule.isMigrationAllocatorError(error) && error.code === 'invalid-request',
      'a version is a positive integer',
    )
    assert.throws(
      () => allocatorModule.createMigrationAllocator(store, { adopt: [{ key: '  ', version: 9 }] }),
      error => allocatorModule.isMigrationAllocatorError(error) && error.code === 'invalid-request',
      'an adoption is identified by a stable key',
    )
  } finally {
    store.close()
  }
})
