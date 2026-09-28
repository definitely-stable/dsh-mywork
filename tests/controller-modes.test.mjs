/**
 * Embedded and resident deployments, and the one graceful shutdown (MW-028 E-44).
 *
 * The two modes are the same application layer over the same **external** state
 * directory; what differs is what the deployment promises its host. Three claims
 * carry the acceptance criterion and are tested here directly:
 *
 * - closing the browser does not stop resident execution — expressed as
 *   `clients.detachAll()`, which closes the client layer and nothing else. This
 *   test does **not** start a browser; it pins the one link that would break the
 *   promise, namely that a client attachment is not part of the controller's
 *   lifetime, and says so instead of pretending to be an end-to-end check;
 * - a reconnect finds the same state and the epoch the durable row records;
 * - two deployments on one scope still have exactly one leader.
 *
 * A fourth claim is the shutdown order: admission → settle → release, with the
 * lease provably still held while the work in flight settles.
 *
 * A fifth is what an idle shutdown is *made of*: microtasks and nothing else. The
 * only thing that may hold `stop()` open is work registered through `trackWork`,
 * and the heartbeat timer must be dead by the end of the first step. That claim
 * is the answer to the question the night campaign left in `.tmp/dbg-shutdown.mjs`
 * ("where does the graceful shutdown spend its time?") and is pinned here so a
 * later `setInterval` cannot quietly reintroduce a timer-driven shutdown.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'

scratchDshHome('controller-modes')
assertScratchHome()

/**
 * Repository root, derived from this file.
 *
 * This suite imports only the packages it exercises — the controller bundle, the
 * lease row it reads, and the storage kernel it probes with — so a sibling
 * rebuild of an unrelated package cannot turn a deployment test red.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The built controller, exactly as a consumer receives it. */
const controller = await import(pathToFileURL(join(repoRoot, 'packages/controller/lib/index.js')).href)

/** The lease layer as built: the suite reads the durable row with it. */
const lease = await import(pathToFileURL(join(repoRoot, 'packages/lease/lib/index.js')).href)

/** The storage kernel as built: the suite opens probe connections with it. */
const storage = await import(pathToFileURL(join(repoRoot, 'packages/storage/lib/index.js')).href)

/** The deterministic fakes of `@dsh-mywork/adapter-sdk/testing`. */
const adapterTesting = await import(pathToFileURL(join(repoRoot, 'packages/adapter-sdk/lib/testing.js')).href)

/** Lease window every test in this suite acquired, in milliseconds. */
const LEASE_MS = 3_000

/** Temporary homes this suite created. */
const homes = []

/** Applications this suite started; a failing assertion must not leak a handle. */
const started = []

after(async () => {
  for (const app of started) {
    try {
      await app.stop()
    } catch (error) {
      process.stderr.write(`controller-modes: could not stop an application: ${error.message}\n`)
    }
  }
  for (const dir of homes) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      process.stderr.write(`controller-modes: could not remove ${dir}: ${error.message}\n`)
    }
  }
})

/** A fresh `$DSH_HOME` outside the repository; the live profile is never addressed. */
function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-modes-'))
  homes.push(dir)
  return dir
}

/** An application over one isolated home, tracked so the teardown can stop it. */
function appAt(home, clock, options = {}) {
  const app = controller.createMyWorkApplication({ dshHome: home, clock, leaseMs: LEASE_MS, ...options })
  started.push(app)
  return app
}

/** Let the microtasks of a step run; nothing here waits on real time. */
async function drain(rounds = 32) {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve()
}

/** The durable lease row of one home, read through a second connection. */
async function readLeaseRow(home, scopeId = 'local') {
  const probe = await storage.openStore({
    path: join(home, 'dsh-mywork', 'state', 'registry.sqlite'),
    migrations: controller.MYWORK_DATABASE_MIGRATIONS,
  })
  try {
    return lease.createLeaseStore(probe).read(scopeId)
  } finally {
    probe.close()
  }
}

test('embedded runs inside the host process over the external state directory', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const app = appAt(home, clock, { mode: 'embedded', instanceId: 'embedded-1' })

  assert.equal(app.deployment.mode, 'embedded')
  assert.equal(app.deployment.headless, false, 'an embedded deployment lives in the host process')
  assert.equal(app.deployment.stopsWithHost, true, 'so unloading the host row stops it')
  assert.equal(app.deployment.stateDir, app.layout.stateDir)
  assert.equal(app.deployment.stateDir, join(home, 'dsh-mywork', 'state'))
  assert.equal(app.deployment.stateDir.startsWith(repoRoot), false, 'state never lives in the repository')

  await app.start()
  assert.equal(app.store.path, join(app.deployment.stateDir, 'controller.sqlite'))
  assert.equal(existsSync(app.store.path), true)
  assert.equal(app.admitting, true)

  await app.stop()
})

test('resident activates with no client at all and keeps heartbeating', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const app = appAt(home, clock, { mode: 'resident', instanceId: 'resident-1' })

  assert.equal(app.clients.count, 0, 'a resident profile has no UI session')
  assert.equal(app.deployment.mode, 'resident')
  assert.equal(app.deployment.headless, true)
  assert.equal(app.deployment.stopsWithHost, false, 'a headless deployment is stopped explicitly')

  await app.start()
  assert.equal(app.lease.info().phase, 'active')
  assert.equal(app.admitting, true)

  await clock.advance(app.heartbeat.intervalMs)
  await drain()
  await clock.advance(app.heartbeat.intervalMs)
  await drain()
  assert.equal(app.heartbeat.beats, 2, 'a resident deployment renews without any client watching')

  await app.stop()
})

test('closing the client layer does not dispose the controller', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const app = appAt(home, clock, { mode: 'resident', instanceId: 'resident-tab' })
  await app.start()

  const first = app.clients.attach('tab-1')
  const second = app.clients.attach('tab-2')
  assert.equal(app.clients.count, 2)
  assert.deepEqual(app.clients.ids, ['client-1', 'client-2'])
  assert.equal(first.attached, true)
  assert.equal(first.label, 'tab-1')
  assert.equal(second.detach(), true)
  assert.equal(second.detach(), false, 'detaching twice is not an error')
  assert.equal(app.clients.detachAll(), 1)
  assert.equal(app.clients.count, 0)

  // The browser is gone; the controller is not. This is the client layer only:
  // no browser was started, and no end-to-end claim is made here.
  assert.equal(app.lease.info().phase, 'active')
  assert.equal(app.admitting, true)
  assert.notEqual(app.store, undefined)
  assert.deepEqual(app.shutdownTrace, [], 'no shutdown step ran when the last client left')

  const beats = app.heartbeat.beats
  await clock.advance(app.heartbeat.intervalMs)
  await drain()
  assert.equal(app.heartbeat.beats, beats + 1, 'a resident deployment keeps renewing after its last client left')

  await app.stop()
})

test('graceful shutdown runs admission, then settle, then release', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const app = appAt(home, clock, { mode: 'resident', instanceId: 'resident-stop' })
  await app.start()

  let finish
  const work = new Promise(resolve => {
    finish = resolve
  })
  app.trackWork(work)

  const stopping = app.stop()
  await drain()
  assert.deepEqual(app.shutdownTrace.map(entry => entry.step), ['admission'])
  assert.equal(app.admitting, false, 'the gate is closed before anything is waited for')
  assert.equal(app.lease.holdsLease(), true, 'and the lease is still held while the work settles')

  finish()
  await stopping
  assert.deepEqual(app.shutdownTrace.map(entry => entry.step), ['admission', 'settle', 'release'])
  assert.deepEqual(
    app.shutdownTrace.map(entry => [entry.admitting, entry.leaseHeld]),
    [[false, true], [false, true], [false, false]],
    'the lease is released by the last step, never before the work settled',
  )

  // One shutdown function, idempotent: a second stop neither repeats the steps
  // nor touches a lease that is already given back.
  await app.stop()
  assert.deepEqual(app.shutdownTrace.map(entry => entry.step), ['admission', 'settle', 'release'])

  process.stdout.write(
    `controller-modes: shutdown order ${app.shutdownTrace.map(entry => entry.step).join(' -> ')}; `
    + `stateDir=${app.deployment.stateDir}\n`,
  )
})

test('an idle shutdown is microtask-driven and leaves no live heartbeat timer', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const app = appAt(home, clock, { mode: 'resident', instanceId: 'resident-timers' })
  await app.start()

  // Renew once first, so "stopped" cannot be confused with "never beat": the loop
  // is demonstrably live and owns exactly one pending sleep.
  const beating = app.heartbeat
  await clock.advance(beating.intervalMs)
  await drain()
  assert.equal(beating.beats, 1)
  assert.equal(clock.pendingSleeps, 1, 'the live heartbeat owns exactly one pending sleep')

  const stopping = app.stop()
  // A microtask budget and not a single macrotask. This is the measurement the
  // night campaign left open (`.tmp/dbg-shutdown.mjs`): an idle shutdown needs 25
  // microtask turns — `admission` at 5, `settle` at 9, `release` at 18 — and no
  // timer at all. A step that waited on one (`setInterval`, or a sleep nobody
  // aborts) cannot finish inside this budget while the fake clock stands still,
  // which is what makes the assertion falsifiable rather than decorative.
  await drain(48)
  assert.deepEqual(
    app.shutdownTrace.map(entry => entry.step),
    ['admission', 'settle', 'release'],
    'no shutdown step waits for a timer: the fake clock never advanced',
  )
  await stopping

  // Stopped, not silenced: the loop holds no sleeper, does not renew when time
  // moves, and the application has dropped it.
  assert.equal(clock.pendingSleeps, 0, 'no timer of the controller survives the shutdown')
  assert.equal(beating.running, false)
  await clock.advance(beating.intervalMs * 10)
  await drain()
  assert.equal(beating.beats, 1, 'a stopped heartbeat never renews again')
  assert.equal(clock.pendingSleeps, 0)
  assert.equal(app.heartbeat, undefined)

  // And no new work may be registered into a stopped controller.
  assert.equal(app.admitting, false)
  assert.equal(app.store, undefined)
  assert.throws(() => app.trackWork(Promise.resolve()), error => error.code === 'not-active')
})

test('a reconnecting client finds the same state and the epoch of the durable row', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const app = appAt(home, clock, { mode: 'resident', instanceId: 'resident-reconnect' })
  await app.start()

  const tab = app.clients.attach('tab-1')
  const statePath = app.store.path
  const epoch = app.lease.heldEpoch
  assert.notEqual(epoch, undefined)

  // The tab reconnects: the client layer is rebuilt, the controller is not.
  tab.detach()
  const reconnected = app.clients.attach('tab-1-again')
  assert.equal(reconnected.attached, true)
  assert.equal(app.store.path, statePath)
  assert.equal(app.lease.heldEpoch, epoch)
  assert.equal(app.lease.info().phase, 'active')

  // The epoch a client reads is the one the shared state directory records, not
  // a number this process remembers.
  const durable = await readLeaseRow(home)
  assert.equal(durable.instanceId, 'resident-reconnect')
  assert.equal(durable.epoch, epoch)

  // A controller restart keeps the same external state. The lease row is deleted
  // by the release (packages/lease/src/lease.ts:253-263), so a released scope
  // starts a fresh sequence: what must hold is that the epoch is again exactly
  // the epoch of the row, and that it never moves backwards.
  await app.stop()
  await app.start()
  const afterRestart = await readLeaseRow(home)
  assert.equal(app.store.path, statePath)
  assert.equal(app.deployment.stateDir, join(home, 'dsh-mywork', 'state'))
  assert.equal(afterRestart.epoch, app.lease.heldEpoch)
  assert.equal(app.lease.heldEpoch >= epoch, true, 'a failover token never moves backwards')

  await app.stop()
})

test('an embedded and a resident deployment on one scope keep the single-controller invariant', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const embedded = appAt(home, clock, { mode: 'embedded', instanceId: 'deploy-embedded', leaseMs: 30_000 })
  const resident = appAt(home, clock, { mode: 'resident', instanceId: 'deploy-resident', leaseMs: 30_000 })

  await embedded.start()
  await resident.start()

  assert.equal(embedded.lease.info().admitting, true)
  assert.equal(resident.lease.info().admitting, false)
  assert.equal(resident.lease.info().phase, 'passive')
  assert.equal(resident.store, undefined, 'the second deployment writes nothing')

  const holder = await readLeaseRow(home)
  assert.equal(holder.instanceId, 'deploy-embedded', 'the durable row names exactly one holder')
  assert.equal(holder.epoch, embedded.lease.heldEpoch)
  assert.equal(embedded.admissions.length, 0)
  assert.equal(resident.admissions.length, 0)

  await embedded.stop()
  await resident.stop()
})
