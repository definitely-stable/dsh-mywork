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
  // The version is the last migration of the canonical list, never a literal:
  // kernel, evidence (two), lease, plan mutations, claim saga — then the two
  // migrations the allocator numbers, in allocation order.
  assert.deepEqual(store.migrations.map(migration => migration.version), [1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(store.schemaVersion, 8)
  assert.equal(store.migrations.length, 8)
  assert.equal(app.store.path, join(home, 'dsh-mywork', 'state', 'controller.sqlite'))

  // The two allocated migrations are named, and their numbers came from the
  // allocator: the book of record says so, and the journal agrees with it.
  assert.deepEqual(
    app.migrations.allocated().map(allocation => [allocation.key, allocation.version]),
    [['background_job', 7], ['artifact-retention', 8]],
  )
  assert.deepEqual(
    store.migrations.filter(migration => migration.version >= 7).map(migration => migration.name),
    ['background-job', 'artifact-retention'],
  )

  // The schema those two migrations bring really exists in the open database.
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
