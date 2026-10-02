/**
 * The store the composition root opens (F-29, MW-058).
 *
 * The first live database in this workspace is a fact worth asserting precisely:
 * the path is `$DSH_HOME/dsh-mywork/state/controller.sqlite`, the schema is the
 * canonical version of the whole list, the journal has one row per migration, and
 * `stop()` really closes it — a store that stays open after the row unloads is a
 * leaked handle, not a detail.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

import { adapterTesting, repoRoot } from './lib/fixtures.mjs'
import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'

// The controller opens its state under `$DSH_HOME`, so the variable is pinned
// before the bundle is imported — and the shared guard proves the home really is
// inside `<repo>/.tmp/`, the assertion that catches a live-profile leak.
scratchDshHome('app-store')
assertScratchHome()

/** The built controller, exactly as a consumer receives it. */
const controller = await import(pathToFileURL(join(repoRoot, 'packages/controller/lib/index.js')).href)

/** Temporary homes this suite created. */
const homes = []

/** Applications this suite started; a failing assertion must not leak a handle. */
const started = []

after(async () => {
  for (const app of started) {
    try {
      await app.stop()
    } catch (error) {
      process.stderr.write(`app-store: could not stop an application: ${error.message}\n`)
    }
  }
  for (const dir of homes) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      process.stderr.write(`app-store: could not remove ${dir}: ${error.message}\n`)
    }
  }
})

/** A fresh `$DSH_HOME`; the live profile is never addressed. */
function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-store-'))
  homes.push(dir)
  return dir
}

/** An application over one isolated home, tracked so the teardown can stop it. */
function appAt(home, clock = new adapterTesting.FakeClock(1_000)) {
  const app = controller.createMyWorkApplication({ dshHome: home, clock })
  started.push(app)
  return app
}

test('start() creates controller.sqlite in the isolated home', async () => {
  const home = tempHome()
  const app = appAt(home)
  const stateDir = join(home, 'dsh-mywork', 'state')

  assert.equal(existsSync(stateDir), false, 'a fresh home has no state directory yet')
  await app.start()
  assert.equal(existsSync(join(stateDir, 'controller.sqlite')), true)
  // The registry database is opened too: the lease decides leadership in it.
  assert.equal(existsSync(join(stateDir, 'registry.sqlite')), true)
  await app.stop()
})

test('the database is at the canonical version, journalled, and closed by stop()', async () => {
  const home = tempHome()
  const app = appAt(home)
  await app.start()

  const store = app.store
  assert.notEqual(store, undefined)
  // The canonical base stays ordered and every factory-backed migration follows
  // it in allocator order. No allocated version is typed into this test.
  const allocated = app.migrations.allocated()
  assert.deepEqual(
    allocated.map(allocation => allocation.key),
    ['background_job', 'artifact-retention', 'review_claim'],
  )
  assert.equal(new Set(allocated.map(allocation => allocation.version)).size, 3)
  assert.equal(
    store.schemaVersion,
    store.migrations.at(-1).version,
    'the schema stamp is the last canonical migration, not a separately maintained literal',
  )
  assert.deepEqual(
    store.migrations.slice(-3).map(migration => migration.name),
    ['background-job', 'artifact-retention', 'review-claim'],
  )
  assert.deepEqual(
    store.migrations.slice(-3).map(migration => migration.version),
    allocated.map(allocation => allocation.version),
    'the allocator book and controller migration journal use the same versions',
  )
  assert.equal(app.store.path, join(home, 'dsh-mywork', 'state', 'controller.sqlite'))

  // The schema those allocated migrations bring really exists in the open database.
  assert.notEqual(
    store.transaction(tx => tx.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'background_job'")),
    undefined,
    'the background_job table must exist after start()',
  )
  assert.notEqual(
    store.transaction(tx => tx.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'artifact_tombstone'")),
    undefined,
    'the retention migration must create its tombstone table',
  )
  assert.notEqual(
    store.transaction(tx => tx.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'review_claim'")),
    undefined,
    'the review migration must create the durable review queue table',
  )
  assert.notEqual(app.reviewQueue, undefined, 'the review queue is composed over the same controller database')
  assert.deepEqual(app.reviewQueue.liveReviews(), [], 'a fresh review queue is durably empty')
  // The unconditional delete guard is replaced by the conditional one: the
  // trigger exists, and its body names the tombstone.
  const guard = store.transaction(tx => tx.get(
    "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'artifacts_no_delete'",
  ))
  assert.notEqual(guard, undefined, 'the conditional retention trigger must be installed')
  assert.match(guard.sql, /artifact_tombstone/)

  await app.stop()
  // A closed store refuses work rather than failing in a later write.
  assert.throws(
    () => store.transaction(() => undefined),
    error => error.code === 'store-closed',
  )
})


test('losing registry.sqlite adopts every allocated migration, including review_claim, from the controller journal', async () => {
  const home = tempHome()
  const first = appAt(home, new adapterTesting.FakeClock(10_000))
  await first.start()

  const before = first.migrations.allocated().map(allocation => [allocation.key, allocation.version])
  const reviewVersion = first.store.migrations.find(migration => migration.name === 'review-claim')?.version
  assert.notEqual(reviewVersion, undefined)
  await first.stop()

  const stateDir = join(home, 'dsh-mywork', 'state')
  rmSync(join(stateDir, 'registry.sqlite'), { force: true })
  rmSync(join(stateDir, 'registry.sqlite-wal'), { force: true })
  rmSync(join(stateDir, 'registry.sqlite-shm'), { force: true })

  const second = appAt(home, new adapterTesting.FakeClock(20_000))
  await second.start()

  assert.deepEqual(
    second.migrations.allocated().map(allocation => [allocation.key, allocation.version]),
    before,
    'the rebuilt allocator book adopts the versions already journalled by controller.sqlite',
  )
  assert.equal(
    second.store.migrations.find(migration => migration.name === 'review-claim')?.version,
    reviewVersion,
    'review_claim keeps its recorded version instead of being renumbered after book loss',
  )
  assert.notEqual(second.reviewQueue, undefined)
  assert.deepEqual(second.reviewQueue.liveReviews(), [])
  await second.stop()
})
