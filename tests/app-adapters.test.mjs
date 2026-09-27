/**
 * What the composition root publishes into `myworkAdapters` (F-31, MW-058).
 *
 * The registry stops being empty, and — more importantly — it is emptied again:
 * a mount/unmount/mount cycle must leave the same set of rows, because a
 * duplicate registration is refused by id and would fail the second mount.
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
scratchDshHome('app-adapters')
assertScratchHome()

/** The built controller, exactly as a consumer receives it. */
const controller = await import(pathToFileURL(join(repoRoot, 'packages/controller/lib/index.js')).href)

const { Context } = await import('@deepseek-ai/cordis')

/** Temporary homes this suite created. */
const homes = []

after(() => {
  for (const dir of homes) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      process.stderr.write(`app-adapters: could not remove ${dir}: ${error.message}\n`)
    }
  }
})

/**
 * A harness: one Cordis context carrying one adapter registry, so the root can be
 * composed exactly as the plugin composes it.
 */
async function harness() {
  const ctx = new Context()
  let adapters
  const fiber = ctx.plugin({
    name: 'app-adapters-harness',
    apply(context) {
      adapters = new controller.MyWorkAdaptersService(context)
    },
  })
  await fiber.await()
  return { ctx, fiber, adapters }
}

/** An application over one isolated home, publishing into the harness registry. */
function appIn(home, adapters) {
  return controller.createMyWorkApplication({
    dshHome: home,
    adapters,
    clock: new adapterTesting.FakeClock(1_000),
  })
}

test('start() publishes the ports the root owns, and stop() withdraws them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-mywork-adapters-'))
  homes.push(home)
  const { adapters } = await harness()
  const app = appIn(home, adapters)

  assert.equal(adapters.size, 0, 'the registry starts empty')
  await app.start()

  const published = adapters.list().map(manifest => manifest.adapterId).sort()
  assert.deepEqual(published, ['mywork-evidence', 'mywork-lease'])
  // The kinds are stable §36 ports: an artifact store and a lease store.
  assert.deepEqual(
    adapters.list().map(manifest => manifest.kind).sort(),
    ['artifact-store', 'lease-store'],
  )
  assert.equal(adapters.resolve('artifact-store').ok, true)
  assert.equal(adapters.resolve('lease-store').ok, true)

  await app.stop()
  assert.equal(adapters.size, 0, 'stop() must withdraw every registration it made')
  assert.equal(adapters.resolve('artifact-store').ok, false)
})

test('a mount/unmount/mount cycle leaves exactly the same rows', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-mywork-adapters-cycle-'))
  homes.push(home)
  const { adapters } = await harness()
  const app = appIn(home, adapters)

  await app.start()
  const first = adapters.list().map(manifest => manifest.adapterId).sort()
  await app.stop()
  await app.start()
  const second = adapters.list().map(manifest => manifest.adapterId).sort()

  assert.deepEqual(second, first, 'a second mount must not duplicate or drop rows')
  assert.equal(adapters.size, 2)
  await app.stop()
  assert.equal(adapters.size, 0)
})
