/**
 * Version recovery when the allocator's book is lost (F-63b).
 *
 * The allocator's book lives in `registry.sqlite`; the numbers it hands out are
 * written into the journal of `controller.sqlite`. Both scenarios below lose the
 * book the same way and differ only in whether the numbers are recovered from
 * the journal that recorded them:
 *
 * - **without recovery**, a build that allocates one more migration *ahead* of
 *   the others hands the new key a version another migration already owns. The
 *   store opens — the journal check compares versions, not names — the schema
 *   version advances, and the new migration **never runs**. That is silent
 *   schema loss, not a loud refusal;
 * - **with recovery**, the recorded numbers are adopted, the new key sits above
 *   every one of them, and its migration actually runs.
 *
 * The stage-2 gate report claimed the failure would be loud (`validateMigrations`
 * throwing on a duplicate). That claim is reproduced and falsified here in the
 * first scenario: re-deriving the same keys in the same order reproduces the same
 * numbers, and only a *changed* allocation list makes the renumbering visible —
 * which is exactly what a later stage does when it appends a migration.
 */

import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { evidence, execution, lease, planner, repoRoot, storage } from './lib/fixtures.mjs'
import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'

const controller = await import(pathToFileURL(join(repoRoot, 'packages', 'controller', 'lib', 'index.js')).href)

/** Root every scenario below works in; never the user's home. */
const workRoot = join(repoRoot, '.tmp', 'allocator-recovery')

/** The base migration set the composition root assembles (F-18/F-29). */
const baseMigrations = storage.canonicalMigrations([
  storage.MYWORK_MIGRATIONS,
  evidence.EVIDENCE_MIGRATIONS,
  lease.LEASE_MIGRATIONS,
  planner.PLAN_MUTATION_MIGRATIONS,
  execution.CLAIM_SAGA_MIGRATIONS,
])

/** A fresh scenario directory. */
function scenario(name) {
  const dir = join(workRoot, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Open the book the way the composition root does. */
function openBook(dir) {
  return storage.openStore({ path: join(dir, 'registry.sqlite'), migrations: baseMigrations })
}
/** Drop the book's database and sidecars, keeping the database it numbered. */
function loseBook(dir) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(join(dir, `registry.sqlite${suffix}`), { force: true })
}

/** The request table the composition root holds: key → journal name → factory. */
const REQUESTS = Object.freeze([
  Object.freeze({ key: 'background_job', journalName: 'background-job', create: storage.createBackgroundJobMigration }),
  Object.freeze({ key: 'artifact-retention', journalName: 'artifact-retention', create: evidence.createArtifactRetentionMigration }),
])

/** The three-key build scenario A and B both model: the new key comes first. */
function threeKeyBuild(newMigrationFactory) {
  return Object.freeze([
    Object.freeze({ key: 'attempt_worktree', journalName: 'attempt-worktree', create: newMigrationFactory }),
    ...REQUESTS,
  ])
}

/** Adoptions recovered from the journal of the numbered database. */
function adoptionsFrom(dir) {
  const journal = storage.readMigrationJournal(join(dir, 'controller.sqlite'))
  const byName = new Map(REQUESTS.map(request => [request.journalName, request.key]))
  return journal.flatMap(row => {
    const key = byName.get(row.name)
    return key === undefined ? [] : [Object.freeze({ key, version: row.version })]
  })
}

/** A list of migrations for a build, read from the allocator the build owns. */
function listOf(build, allocator) {
  return storage.canonicalMigrations([
    baseMigrations,
    build.map(request => request.create(allocator.allocate({ key: request.key }))),
  ])
}

test('re-deriving the same keys in the same order reproduces the same numbers', async () => {
  // The falsified claim from the stage-2 report: "the next request gets 7, which
  // the controller already uses, and validateMigrations throws on the duplicate".
  // It does not: the numbers come out identical, so nothing throws at all.
  const dir = scenario('same-order')
  const first = await openBook(dir)
  const firstAllocator = controller.createMigrationAllocator(first)
  const firstList = listOf(REQUESTS, firstAllocator)
  first.close()
  const controllerStore = await storage.openStore({ path: join(dir, 'controller.sqlite'), migrations: firstList })
  const recorded = controllerStore.migrations.map(row => `${row.version}:${row.name}`)
  controllerStore.close()

  loseBook(dir)
  const second = await openBook(dir)
  try {
    const secondList = listOf(REQUESTS, controller.createMigrationAllocator(second))
    assert.deepEqual(
      secondList.map(migration => migration.version),
      firstList.map(migration => migration.version),
      'the same keys in the same order re-derive the same numbers',
    )
    const reopened = await storage.openStore({ path: join(dir, 'controller.sqlite'), migrations: secondList })
    assert.deepEqual(
      reopened.migrations.map(row => `${row.version}:${row.name}`),
      recorded,
      'and the database opens with the journal it already had',
    )
    reopened.close()
  } finally {
    second.close()
  }
})

test('without recovery a lost book renumbers a new migration onto a version already owned', async () => {
  const dir = scenario('without-recovery')
  const book = await openBook(dir)
  const writer = controller.createMigrationAllocator(book)
  const written = listOf(REQUESTS, writer)
  const versions = Object.fromEntries(written.map(migration => [migration.name, migration.version]))
  book.close()
  const opened = await storage.openStore({ path: join(dir, 'controller.sqlite'), migrations: written })
  opened.close()

  loseBook(dir)
  const lost = await openBook(dir)
  try {
    let ran = false
    const build = threeKeyBuild(version => Object.freeze({
      version,
      name: 'attempt-worktree',
      up() {
        ran = true
      },
    }))
    const renumbered = listOf(build, controller.createMigrationAllocator(lost))

    assert.equal(
      renumbered.find(migration => migration.name === 'attempt-worktree').version,
      versions['background-job'],
      'the new migration is handed the version the controller already records for background-job',
    )

    const reopened = await storage.openStore({ path: join(dir, 'controller.sqlite'), migrations: renumbered })
    try {
      // The harm is the silence: the store opens, the stamp advances, and the
      // new migration's body is skipped because its version is already applied.
      assert.equal(ran, false, 'the new migration never ran, and nothing reported that')
      const row = reopened.migrations.find(entry => entry.version === versions['background-job'])
      assert.equal(row.name, 'background-job', 'the journal still names that version after the old build')
      assert.equal(
        renumbered.find(migration => migration.version === versions['background-job']).name,
        'attempt-worktree',
        'while this build believes the same version is the new migration',
      )
    } finally {
      reopened.close()
    }
  } finally {
    lost.close()
  }
})

test('recovery keeps the recorded numbers and lets the new migration run', async () => {
  const dir = scenario('with-recovery')
  const book = await openBook(dir)
  const writer = controller.createMigrationAllocator(book)
  const written = listOf(REQUESTS, writer)
  const versions = Object.fromEntries(written.map(migration => [migration.name, migration.version]))
  book.close()
  const opened = await storage.openStore({ path: join(dir, 'controller.sqlite'), migrations: written })
  const recorded = opened.migrations.map(row => `${row.version}:${row.name}`)
  opened.close()

  loseBook(dir)
  const adopt = adoptionsFrom(dir)
  assert.deepEqual(
    adopt.map(entry => `${entry.key}@${entry.version}`).sort(),
    ['artifact-retention@' + String(versions['artifact-retention']), 'background_job@' + String(versions['background-job'])].sort(),
    'the journal is what the recovery reads',
  )

  const healed = await openBook(dir)
  try {
    let ran = false
    const build = threeKeyBuild(version => Object.freeze({
      version,
      name: 'attempt-worktree',
      up() {
        ran = true
      },
    }))
    const allocator = controller.createMigrationAllocator(healed, { adopt })
    const recovered = listOf(build, allocator)

    assert.equal(
      recovered.find(migration => migration.name === 'background-job').version,
      versions['background-job'],
      'the adopted version is kept, not re-derived',
    )
    assert.equal(
      recovered.find(migration => migration.name === 'artifact-retention').version,
      versions['artifact-retention'],
      'every adopted version is kept',
    )
    assert.equal(
      recovered.find(migration => migration.name === 'attempt-worktree').version,
      versions['artifact-retention'] + 1,
      'the new request sits above everything the journals and the book remember',
    )
    assert.deepEqual(
      allocator.allocated().map(allocation => `${allocation.key}@${allocation.version}`),
      [
        `background_job@${versions['background-job']}`,
        `artifact-retention@${versions['artifact-retention']}`,
        `attempt_worktree@${versions['artifact-retention'] + 1}`,
      ],
      'the recovery is written back into the book, so the next open needs no recovery',
    )

    const reopened = await storage.openStore({ path: join(dir, 'controller.sqlite'), migrations: recovered })
    try {
      assert.equal(ran, true, 'the new migration ran, because it got a version of its own')
      assert.ok(
        recorded.every(entry => reopened.migrations.map(row => `${row.version}:${row.name}`).includes(entry)),
        'every journal row the old build wrote is still named exactly as it was',
      )
      assert.equal(
        reopened.migrations.find(row => row.name === 'attempt-worktree').version,
        versions['artifact-retention'] + 1,
      )
    } finally {
      reopened.close()
    }
  } finally {
    healed.close()
  }
})

test('the composition root recovers its numbers after the book is lost', async () => {
  const home = scratchDshHome('allocator-recovery')
  assertScratchHome()
  const stateDir = join(home, 'dsh-mywork', 'state')

  const first = controller.createMyWorkApplication({ dshHome: home })
  await first.start()
  const before = first.migrations.allocated().map(allocation => `${allocation.key}@${allocation.version}`)
  const schemaVersion = first.store.schemaVersion
  const journal = first.store.migrations.map(row => `${row.version}:${row.name}`)
  await first.stop()
  assert.ok(before.length >= 2, `expected the allocated migrations, found ${before.join(', ')}`)

  loseBook(stateDir)
  const second = controller.createMyWorkApplication({ dshHome: home })
  await second.start()
  try {
    assert.deepEqual(
      second.migrations.allocated().map(allocation => `${allocation.key}@${allocation.version}`),
      before,
      'a lost book must not renumber the migrations the controller already recorded',
    )
    assert.equal(second.store.schemaVersion, schemaVersion, 'the controller opens at the version it had')
    assert.deepEqual(second.store.migrations.map(row => `${row.version}:${row.name}`), journal, 'with its journal intact')
  } finally {
    await second.stop()
  }
})
