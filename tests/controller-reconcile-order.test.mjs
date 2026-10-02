/**
 * Reconciliation before admission, and the durable admission hold (MW-028 E-45).
 *
 * §16.1 makes the order non-negotiable: a controller that starts admitting before
 * it has reconciled would run work against state it has not repaired yet. The
 * activation trace is the proof — `lease → stores → reconcile → admission`, with
 * the gate closed while `reconcile` ran — and the failure case is the interesting
 * one: a reconcile that fails must leave the controller inactive and give the
 * lease back, not limp on.
 *
 * The second half is ADR020's hold. It is a row, not a flag: an unfinished staged
 * plan mutation keeps admission closed across a restart, the leader keeps renewing
 * its lease while paused, and admission opens only after the operation settled
 * and the row was released.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'

scratchDshHome('controller-reconcile-order')
assertScratchHome()

/**
 * Repository root, derived from this file.
 *
 * This suite imports only the packages it exercises — the controller bundle, the
 * planner whose row is the admission hold, the lease row it reads back, and the
 * storage kernel it probes with — so a sibling rebuild of an unrelated package
 * cannot turn a reconciliation test red.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The built controller, exactly as a consumer receives it. */
const controller = await import(pathToFileURL(join(repoRoot, 'packages/controller/lib/index.js')).href)

/** The planner as built: the suite writes the durable hold with its own executor function. */
const planner = await import(pathToFileURL(join(repoRoot, 'packages/planner/lib/index.js')).href)

/** The lease layer as built: the suite reads the durable row with it. */
const lease = await import(pathToFileURL(join(repoRoot, 'packages/lease/lib/index.js')).href)

/** The storage kernel as built: the suite opens probe connections with it. */
const storage = await import(pathToFileURL(join(repoRoot, 'packages/storage/lib/index.js')).href)

/** The deterministic fakes of `@dsh-mywork/adapter-sdk/testing`. */
const adapterTesting = await import(pathToFileURL(join(repoRoot, 'packages/adapter-sdk/lib/testing.js')).href)

/** Lease window every test in this suite acquired, in milliseconds. */
const LEASE_MS = 3_000

/** Identity of the durable admission hold this suite writes, as a plan operation would. */
const HOLD_ID = 'hold-op-1'

/** Temporary homes this suite created. */
const homes = []

/** Applications this suite started; a failing assertion must not leak a handle. */
const started = []

after(async () => {
  for (const app of started) {
    try {
      await app.stop()
    } catch (error) {
      process.stderr.write(`controller-reconcile-order: could not stop an application: ${error.message}\n`)
    }
  }
  for (const dir of homes) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      process.stderr.write(`controller-reconcile-order: could not remove ${dir}: ${error.message}\n`)
    }
  }
})

/** A fresh `$DSH_HOME`; the live profile is never addressed. */
function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-reconcile-'))
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

/**
 * Start one controller, take the admission pause of a staged plan mutation, and
 * stop it again: the durable state a controller that was killed mid-operation
 * leaves behind. The row is written through the planner's own executor function
 * (`holdAdmission`), which is the same code path `Planner.stage` uses.
 */
async function homeWithOpenHold(clock, instanceId) {
  const home = tempHome()
  const setup = appAt(home, clock, { instanceId })
  await setup.start()
  setup.store.transaction(tx => planner.holdAdmission(tx, {
    holdId: HOLD_ID,
    workspaceId: 'W-1',
    operationId: 'op-1',
    reason: planner.PLAN_MUTATION_HOLD_REASON,
    heldAt: clock.now(),
  }))
  await setup.stop()
  return home
}

test('reconcile runs before the first admission', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const app = appAt(home, clock, { instanceId: 'order-1' })
  await app.start()

  assert.deepEqual(
    app.startupTrace.map(entry => entry.step),
    ['lease', 'stores', 'reconcile', 'admission'],
    'the order of §16.1, as the runtime recorded it',
  )
  const reconciled = app.startupTrace[2]
  assert.equal(reconciled.leaseHeld, true, 'the state was reconciled under real leadership')
  assert.equal(reconciled.admitting, false, 'the gate was still closed while reconcile ran')
  assert.equal(reconciled.admissionHeld, false)
  assert.equal(app.startupTrace[3].admitting, true, 'and it opened only after reconcile returned')

  assert.notEqual(app.lease.reconcileReport, undefined, 'the activation published a reconciliation report')
  assert.deepEqual(app.lease.reconcileReport, { operations: 0, leases: 0 }, 'nothing was left to report on a fresh state')
  assert.equal(app.admissions.length, 0, 'no admission happened before or during the reconcile step')

  await app.stop()
})

test('a failed reconcile leaves the controller inactive and gives the lease back', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const setup = appAt(home, clock, { instanceId: 'reconcile-fails' })
  await setup.start()
  // A plan journal that survived while its table did not: the schema assertion
  // still passes, and the failure lands exactly in the reconcile read.
  setup.store.transaction(tx => tx.exec('DROP TABLE plan_mutation'))
  await setup.stop()

  const app = appAt(home, clock, { instanceId: 'reconcile-fails' })
  await assert.rejects(app.start(), error => /plan_mutation/.test(error.message))

  assert.equal(app.store, undefined, 'the stores are closed again by the failed activation')
  assert.equal(app.lease, undefined)
  assert.equal(app.admitting, false, 'admission stays closed')
  assert.deepEqual(
    app.startupTrace.map(entry => entry.step),
    ['lease', 'stores'],
    'the failure happened in the reconcile step, after leadership and after the stores opened',
  )
  assert.equal(await readLeaseRow(home), undefined, 'a failed reconcile does not keep the scope')
  assert.deepEqual(app.shutdownTrace.map(entry => entry.step), ['admission', 'settle', 'release'])
})

test('an unfinished staged plan mutation keeps admission held', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const home = await homeWithOpenHold(clock, 'held-start')

  const app = appAt(home, clock, { instanceId: 'held-start' })
  await app.start()

  const info = app.lease.info()
  assert.deepEqual(
    { ...info },
    {
      phase: 'active',
      instanceId: 'held-start',
      epoch: info.epoch,
      activatedAt: clock.now(),
      admitting: false,
      admissionHeld: true,
    },
    'the whole lifecycle snapshot, with the hold named as the reason',
  )
  assert.equal(app.admitting, false)
  assert.notEqual(app.admissionHold, undefined, 'the projection can name the pause')
  assert.equal(app.admissionHold.holdId, HOLD_ID)
  assert.equal(app.admissionHold.reason, planner.PLAN_MUTATION_HOLD_REASON)
  assert.notEqual(app.planner, undefined, 'the subsystems are up; only the gate is closed')
  assert.equal(app.startupTrace[3].admissionHeld, true)

  // A paused leader is still the leader: the lease must keep being renewed, or
  // the pause would hand the scope to a controller that would also pause.
  const beats = app.heartbeat.beats
  await clock.advance(app.heartbeat.intervalMs)
  await drain()
  assert.equal(app.heartbeat.beats, beats + 1)
  assert.equal(app.lease.holdsLease(), true)

  await app.stop()
})

test('resumeAdmission opens the gate once the hold has been released', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const home = await homeWithOpenHold(clock, 'held-resume')

  const app = appAt(home, clock, { instanceId: 'held-resume' })
  await app.start()
  const held = { ...app.lease.info() }
  assert.equal(held.admissionHeld, true)

  // The row is the truth: while it stands, the gate may not be opened.
  await assert.rejects(
    app.resumeAdmission(),
    error => error.code === 'hold-still-open',
  )
  assert.equal(app.admitting, false)

  // The operation settled: release the pause, then open the gate.
  const released = app.store.transaction(tx => planner.releaseAdmission(tx, HOLD_ID, clock.now(), 'test'))
  assert.equal(released, true)
  const resumed = await app.resumeAdmission()

  assert.deepEqual(
    Object.keys({ ...resumed }).sort(),
    ['activatedAt', 'admitting', 'epoch', 'instanceId', 'phase'],
    'the hold is gone from the snapshot instead of being renamed',
  )
  assert.equal(resumed.admitting, true)
  assert.equal(app.admitting, true)
  assert.equal(app.admissionHold, undefined)
  assert.equal((await app.resumeAdmission()).admitting, true, 'resuming an admitting controller is idempotent')

  process.stdout.write(
    `controller-reconcile-order: info held=${JSON.stringify(held)} `
    + `resumed=${JSON.stringify({ ...resumed })}\n`,
  )

  await app.stop()
})

test('two activations of one state directory reconcile in the same order', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  // A state directory that carries a durable hold: the interesting case for
  // determinism, because both the order *and* the pause have to come out the same
  // way when the same deployment is started twice.
  const home = await homeWithOpenHold(clock, 'order-held-setup')

  const first = appAt(home, clock, { instanceId: 'order-deterministic' })
  await first.start()
  const firstOrder = first.startupTrace.map(entry => entry.step)
  const firstHeld = first.startupTrace.at(-1).admissionHeld
  const firstReport = { ...first.lease.reconcileReport }
  await first.stop()

  const second = appAt(home, clock, { instanceId: 'order-deterministic' })
  await second.start()

  assert.deepEqual(firstOrder, ['lease', 'stores', 'reconcile', 'admission'], 'the §16.1 order, first activation')
  assert.deepEqual(second.startupTrace.map(entry => entry.step), firstOrder, 'and the same order on the second one')
  assert.deepEqual(
    second.startupTrace.map(entry => entry.admitting),
    [false, false, false, false],
    'a durable hold keeps the gate shut on every activation, not only on the first',
  )
  assert.equal(firstHeld, true)
  assert.equal(second.startupTrace.at(-1).admissionHeld, true)
  assert.equal(second.admitting, false)
  assert.deepEqual({ ...second.lease.reconcileReport }, firstReport, 'the reconciliation report is deterministic too')
  assert.deepEqual(firstReport, { operations: 0, leases: 0 })

  // The pause is a row, so it survives the restart that just happened.
  assert.equal(second.admissionHold.holdId, HOLD_ID)
  assert.equal(second.admissionHold.reason, planner.PLAN_MUTATION_HOLD_REASON)

  await second.stop()
})
