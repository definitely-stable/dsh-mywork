/**
 * The lease heartbeat of the composition root (MW-028 E-43).
 *
 * The heartbeat is the only reason a live controller keeps a scope another
 * controller is waiting for, so it has to be observable and deterministic: the
 * loop is driven by the injected clock (`ClockPort.sleep`, the same shape as
 * `reconcileLoop` in `packages/scheduler/src/service.ts:290`), never by
 * `setInterval` and never by `Date.now`. `FakeClock` therefore decides exactly
 * when a renewal happens, which is what makes the five claims below testable:
 * the cadence is strictly inside the lease window, a lost lease moves the
 * controller to `passive` with admission closed, nothing is admitted afterwards,
 * leadership can be re-acquired, and a second controller admits nothing at all
 * while the first one is alive.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'

scratchDshHome('controller-heartbeat')
assertScratchHome()

/**
 * Repository root, derived from this file.
 *
 * This suite imports only the controller bundle and the deterministic clock: a
 * sibling rebuild of an unrelated package must not turn a heartbeat test red.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The built controller, exactly as a consumer receives it. */
const controller = await import(pathToFileURL(join(repoRoot, 'packages/controller/lib/index.js')).href)

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
      process.stderr.write(`controller-heartbeat: could not stop an application: ${error.message}\n`)
    }
  }
  for (const dir of homes) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      process.stderr.write(`controller-heartbeat: could not remove ${dir}: ${error.message}\n`)
    }
  }
})

/** A fresh `$DSH_HOME`; the live profile is never addressed. */
function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-heartbeat-'))
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

test('the heartbeat renews strictly inside the lease window', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const app = appAt(home, clock, { instanceId: 'beating' })
  await app.start()

  const heartbeat = app.heartbeat
  assert.notEqual(heartbeat, undefined, 'an active controller beats')
  assert.equal(heartbeat.intervalMs, controller.heartbeatIntervalMs(LEASE_MS))
  assert.equal(heartbeat.intervalMs < LEASE_MS, true, 'a renewal outside the window would let the lease expire')
  assert.equal(heartbeat.intervalMs * 2 < LEASE_MS, true, 'two missed renewals still fit inside the window')
  assert.equal(heartbeat.beats, 0, 'the lease was just acquired, so the first renewal is not immediate')
  assert.equal(heartbeat.running, true)

  // One advance per interval: the number of renewals is the number of clock
  // windows that passed, not a number that happens to be non-zero.
  for (let round = 1; round <= 4; round += 1) {
    await clock.advance(heartbeat.intervalMs)
    await drain()
    assert.equal(heartbeat.beats, round, `renewal ${String(round)} must follow the clock`)
  }

  assert.equal(app.lease.holdsLease(), true, 'the lease never expired under a live heartbeat')
  assert.equal(app.lease.info().phase, 'active')
  assert.equal(app.admitting, true)

  process.stdout.write(
    `controller-heartbeat: leaseMs=${String(LEASE_MS)} intervalMs=${String(heartbeat.intervalMs)} `
    + `beats=${String(heartbeat.beats)}\n`,
  )

  await app.stop()
})

test('losing the lease moves the controller to passive and closes admission', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const app = appAt(home, clock, { instanceId: 'stalled' })
  await app.start()

  // One jump past the whole window: the renewal runs once and finds a row that
  // expired while the controller was not looking.
  await clock.advance(LEASE_MS * 4)
  await drain()

  const heartbeat = app.heartbeat
  assert.equal(heartbeat.lost, true, 'the renewal failed, and the runtime recorded it')
  assert.match(heartbeat.reason, /expired/)
  assert.equal(heartbeat.running, false, 'a superseded controller does not keep renewing')
  assert.equal(app.lease.info().phase, 'passive')
  assert.equal(app.lease.info().admitting, false)
  assert.equal(app.admitting, false, 'the runtime gate mirrors the lifecycle')

  const beats = heartbeat.beats
  await clock.advance(LEASE_MS)
  await drain()
  assert.equal(heartbeat.beats, beats, 'no renewal happens after the loss')
  assert.equal(app.lease.isWriter(), false)

  await app.stop()
})

test('after the lease is lost nothing is admitted and a successor takes the scope over', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const lost = appAt(home, clock, { instanceId: 'lost-a' })
  await lost.start()
  const epochBefore = lost.lease.heldEpoch

  await clock.advance(LEASE_MS * 4)
  await drain()
  assert.equal(lost.lease.info().phase, 'passive')
  assert.equal(lost.admitting, false, 'the gate of the superseded controller is closed')

  const successor = appAt(home, clock, { instanceId: 'takeover-b' })
  await successor.start()

  assert.equal(successor.lease.info().phase, 'active')
  assert.equal(successor.lease.info().admitting, true)
  assert.equal(successor.admitting, true)
  assert.equal(successor.lease.heldEpoch > epochBefore, true, 'a takeover is a new epoch, never a reused one')
  assert.equal(
    successor.lease.reconcileReport.leases,
    1,
    'the activation reclaimed the expired row instead of leaving it to expire twice',
  )
  assert.equal(successor.lease.isWriter(), true)
  assert.equal(lost.lease.isWriter(), false)
  assert.equal(lost.admissions.length, 0)
  assert.equal(successor.admissions.length, 0)

  process.stdout.write(
    `controller-heartbeat: admissions after takeover: lost=${String(lost.admissions.length)} `
    + `successor=${String(successor.admissions.length)}\n`,
  )

  await successor.stop()
  await lost.stop()
})

test('leadership is re-acquired by a fresh activation and a passive disposal touches nothing', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const first = appAt(home, clock, { instanceId: 'first-a' })
  await first.start()
  await clock.advance(LEASE_MS * 4)
  await drain()
  assert.equal(first.lease.info().phase, 'passive')

  const second = appAt(home, clock, { instanceId: 'second-b' })
  await second.start()
  assert.equal(second.lease.info().phase, 'active')

  // The superseded controller is disposed *while* the successor leads: its
  // release must not clear a row that no longer belongs to it.
  await first.stop()
  assert.equal(second.lease.isWriter(), true, 'a passive disposal must not release somebody else lease')
  assert.equal(second.lease.info().phase, 'active')
  assert.equal(second.lease.holdsLease(), true)

  await second.stop()
  await first.start()
  const revived = first.lease.info()
  assert.equal(revived.phase, 'active', 're-activation after leadership was recovered returns active')
  assert.equal(revived.admitting, true)
  assert.equal(first.admitting, true)
  assert.equal(first.lease.isWriter(), true)
  assert.equal(first.heartbeat.lost, false, 'the fresh activation has a fresh heartbeat')

  await first.stop()
})

test('a second controller admits nothing while the first one is alive', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const leader = appAt(home, clock, { instanceId: 'live-a' })
  await leader.start()

  const waiting = appAt(home, clock, { instanceId: 'waiting-b' })
  await waiting.start()

  assert.equal(waiting.lease.info().phase, 'passive')
  assert.equal(waiting.lease.info().admitting, false)
  assert.equal(waiting.admitting, false)
  assert.equal(waiting.startupTrace[0].leaseHeld, false, 'the trace records who held the scope instead')
  assert.equal(waiting.startupTrace[0].epoch, undefined, 'a refused claimant does not adopt the holder epoch')
  assert.equal(waiting.store, undefined)

  // The leader keeps renewing; the waiting controller has no heartbeat at all.
  // One interval per advance: a single jump past the whole window would let the
  // lease expire between two renewals, which is a different test.
  for (let round = 0; round < 3; round += 1) {
    await clock.advance(leader.heartbeat.intervalMs)
    await drain()
  }
  assert.equal(leader.heartbeat.beats >= 3, true, 'the leader renewed through the same clock')
  assert.equal(leader.lease.holdsLease(), true)
  assert.equal(waiting.heartbeat, undefined)

  assert.equal(leader.admissions.length, 0)
  assert.equal(waiting.admissions.length, 0, 'the waiting controller admitted nothing while the leader lived')

  process.stdout.write(
    `controller-heartbeat: two-controller admissions: leader=${String(leader.admissions.length)} `
    + `waiting=${String(waiting.admissions.length)}\n`,
  )

  await leader.stop()
  await waiting.stop()
})
