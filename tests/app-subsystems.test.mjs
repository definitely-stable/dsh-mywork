/**
 * The subsystems the composition root brings up (F-30, MW-058).
 *
 * Four of the twelve packages were unreachable from runtime before this step, so
 * the assertion is not "the objects exist" but "the objects are live": the lease
 * activated against the injected clock, the scheduler answers a snapshot, the
 * evidence stores are usable, and the version allocator is bound to the database
 * that was just opened.
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
scratchDshHome('app-subsystems')
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
      process.stderr.write(`app-subsystems: could not stop an application: ${error.message}\n`)
    }
  }
  for (const dir of homes) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      process.stderr.write(`app-subsystems: could not remove ${dir}: ${error.message}\n`)
    }
  }
})

test('start() brings the five subsystems up, in order, on the injected clock', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-mywork-subsystems-'))
  homes.push(home)
  const clock = new adapterTesting.FakeClock(5_000)
  const app = controller.createMyWorkApplication({ dshHome: home, clock, instanceId: 'test-instance' })
  started.push(app)

  await app.start()
  assert.deepEqual(
    app.services.map(service => service.name),
    ['evidence', 'lease', 'planner', 'execution', 'scheduler'],
  )

  // Lease: activated against the injected clock, and this controller is the writer
  // (it is the only one competing for the scope).
  const lease = app.lease
  assert.notEqual(lease, undefined)
  assert.equal(lease.info().instanceId, 'test-instance')
  assert.equal(lease.isWriter(), true, 'a single controller must hold the lease')

  // Planner and saga: constructed over the controller store and the registry.
  assert.equal(typeof app.planner, 'object')
  assert.equal(typeof app.saga, 'object')

  // Scheduler: reachable and quiet — the root does not arm a timer that would
  // decide over an observation with no queue in it.
  assert.equal(app.scheduler.snapshot().running, false)
  assert.equal(app.scheduler.snapshot().ticks, 0)

  // Evidence: the stores are usable through the same database.
  const request = {
    artifactId: 'art-subsystems-1',
    kind: 'build-log',
    workspaceId: 'W-1',
    correlationId: 'corr-1',
    contentType: 'text/plain',
    bytes: new TextEncoder().encode('hello'),
  }
  const written = app.evidence.artifacts.put(request)
  assert.equal(written.created, true, 'the first write stores the artifact')
  assert.equal(app.evidence.artifacts.put(request).created, false, 'an identical write is idempotent')

  // Versions come from the allocator bound to this database: the two schema
  // migrations already took 7 and 8, so the next request is the one after the
  // journal — not a number typed by hand.
  const next = app.store.schemaVersion + 1
  assert.equal(app.migrations.allocate({ key: 'subsystems-probe' }), next)
  assert.equal(app.migrations.allocate({ key: 'subsystems-probe' }), next, 'a request keeps its version')

  await app.stop()
  assert.equal(app.store, undefined)
})
