/**
 * The composition root's lifecycle (F-28, MW-058, D07).
 *
 * The root is the only place a store is opened, so its lifecycle has to be
 * boring: `start()` brings everything up once, `stop()` takes it down once, and
 * both are safe to call again. A second `start()` must not open a second
 * database — that is what "there is exactly one composition root" means in
 * practice.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

import { adapterTesting, repoRoot } from './lib/fixtures.mjs'
import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'

// The controller opens its state under `$DSH_HOME`, so the variable is pinned
// before the bundle is imported — and the shared guard proves the home really is
// inside `<repo>/.tmp/`, the assertion that catches a live-profile leak.
scratchDshHome('app-lifecycle')
assertScratchHome()

/** The built controller, exactly as a consumer receives it. */
const controller = await import(pathToFileURL(join(repoRoot, 'packages/controller/lib/index.js')).href)

/** Temporary homes this suite created. */
const homes = []

after(() => {
  for (const dir of homes) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      process.stderr.write(`app-lifecycle: could not remove ${dir}: ${error.message}\n`)
    }
  }
})

/** A fresh `$DSH_HOME`, so no test can reach the live profile. */
function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-app-'))
  homes.push(dir)
  return dir
}

test('the root exposes a lifecycle and stops idempotently', async () => {
  const app = controller.createMyWorkApplication({
    dshHome: tempHome(),
    clock: new adapterTesting.FakeClock(1_000),
  })
  assert.equal(typeof app.start, 'function')
  assert.equal(typeof app.stop, 'function')
  assert.equal(app.store, undefined, 'nothing is open before start()')
  assert.equal(app.reviewQueue, undefined, 'no SQLite-backed review queue exists before start()')
  assert.equal(app.services.length, 0)

  await app.start()
  assert.notEqual(app.store, undefined, 'start() opens the controller database')
  assert.notEqual(app.reviewQueue, undefined, 'the leader composes the durable review queue')
  assert.equal(app.services.length, 5)

  await app.stop()
  assert.equal(app.store, undefined, 'stop() releases the database')
  assert.equal(app.reviewQueue, undefined, 'stop() never exposes a queue over a closed store')
  await app.stop() // Idempotent: a second stop is not an error.
  assert.equal(app.services.length, 0)
})

test('start() and stop() are no-ops when repeated in the other order', async () => {
  const app = controller.createMyWorkApplication({ dshHome: tempHome() })
  // stop() before start() must not touch anything.
  await app.stop()
  assert.equal(app.store, undefined)

  await app.start()
  const opened = app.store
  await app.start()
  assert.equal(app.store, opened, 'a second start() must not open a second database')
  assert.equal(app.services.length, 5, 'a second start() must not duplicate the subsystems')

  await app.stop()
  assert.equal(app.store, undefined)
})
