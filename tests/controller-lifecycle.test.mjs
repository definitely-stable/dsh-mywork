/**
 * The leadership lifecycle of the composition root (MW-028 E-42).
 *
 * `start()` is not "open the databases": it is "become the leader, and only then
 * touch state". These six tests pin that order from the outside — the schema is
 * the version the allocator handed out (never a literal, §1.6), the controller
 * database opens *after* the lease row names this instance, a passive controller
 * opens no controller database at all and admits nothing, a refused activation
 * leaves no lease behind, and disposal closes admission, waits for the work in
 * flight, and releases the lease last.
 *
 * Every home below is a fresh directory under the operating system's temporary
 * directory, and the shared guard proves `$DSH_HOME` is a scratch home before a
 * bundle that opens state is imported: the live profile is never addressed.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'

scratchDshHome('controller-lifecycle')
assertScratchHome()

/**
 * Repository root, derived from this file.
 *
 * This suite imports **only** the packages it exercises — the controller bundle
 * and the two layers whose durable rows it reads — instead of the whole fixture
 * world, because a sibling rebuild of an unrelated package (`clean: true` deletes
 * `lib/`) must not turn a leadership test red.
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

/** Temporary homes this suite created. */
const homes = []

/** Applications this suite started; a failing assertion must not leak a handle. */
const started = []

after(async () => {
  for (const app of started) {
    try {
      await app.stop()
    } catch (error) {
      process.stderr.write(`controller-lifecycle: could not stop an application: ${error.message}\n`)
    }
  }
  for (const dir of homes) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      process.stderr.write(`controller-lifecycle: could not remove ${dir}: ${error.message}\n`)
    }
  }
})

/** A fresh `$DSH_HOME`; the live profile is never addressed. */
function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-lifecycle-'))
  homes.push(dir)
  return dir
}

/** An application over one isolated home, tracked so the teardown can stop it. */
function appAt(home, clock, options = {}) {
  const app = controller.createMyWorkApplication({ dshHome: home, clock, ...options })
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

/** One recorded activation step. */
function stepOf(app, step) {
  const entry = app.startupTrace.find(candidate => candidate.step === step)
  assert.notEqual(entry, undefined, `the startup trace must record the "${step}" step`)
  return entry
}

test('activation opens controller.sqlite at the version the allocator handed out', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const app = appAt(home, clock, { instanceId: 'lifecycle-active' })

  await app.start()
  const store = app.store
  assert.notEqual(store, undefined, 'the leader opens the controller database')

  // The expected schema is computed from the allocator, never typed by hand: the
  // base list carries the versions the packages own, and the two allocated
  // migrations carry the numbers the book of record handed out for this file.
  const base = controller.MYWORK_DATABASE_MIGRATIONS.map(migration => migration.version)
  const allocated = app.migrations.allocated().map(allocation => allocation.version)
  const expected = [...base, ...allocated].sort((left, right) => left - right)
  assert.deepEqual(store.migrations.map(migration => migration.version), expected)
  assert.equal(store.migrations.length, expected.length)
  assert.equal(store.schemaVersion, expected[expected.length - 1])

  // `user_version` on disk is that same number: the gate is the file, not the
  // object this process happens to hold.
  assert.equal(store.schemaVersion, store.migrations[store.migrations.length - 1].version)

  const databasePath = join(home, 'dsh-mywork', 'state', 'controller.sqlite')
  assert.equal(store.path, databasePath)
  assert.equal(existsSync(databasePath), true, 'the smoke check of the E-42 gate')

  // The allocator is bound to this database: the next request is the number
  // after the journal, not one typed into a test.
  assert.equal(app.migrations.allocate({ key: 'lifecycle-probe' }), expected[expected.length - 1] + 1)

  await app.stop()
})

test('a passive controller on the same scope admits nothing and opens no controller database', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const leader = appAt(home, clock, { instanceId: 'leader-a' })
  await leader.start()

  const passive = appAt(home, clock, { instanceId: 'passive-b' })
  await passive.start()

  // The single-controller invariant, expressed as an admission gate: exactly one
  // of the two may admit, and the refused one holds nothing it could write with.
  assert.equal(leader.lease.info().admitting, true)
  assert.equal(passive.lease.info().admitting, false)
  assert.equal(passive.lease.info().phase, 'passive')
  assert.equal(leader.lease.isWriter(), true)
  assert.equal(passive.lease.isWriter(), false)
  assert.equal(passive.admitting, false)

  assert.equal(passive.store, undefined, 'a passive controller opens no controller database')
  assert.equal(passive.planner, undefined, 'and hands out no planner for a scope it does not lead')
  assert.equal(passive.scheduler, undefined)
  assert.equal(passive.evidence, undefined)
  assert.deepEqual(passive.services.map(service => service.name), ['lease'])
  assert.deepEqual(passive.startupTrace.map(entry => entry.step), ['lease', 'admission'])

  // Neither controller admitted work, and the passive one has no path that could:
  // it has neither the scheduler nor the ports the leader published.
  assert.equal(leader.admissions.length, 0)
  assert.equal(passive.admissions.length, 0)

  process.stdout.write(
    `controller-lifecycle: admissions leader=${String(leader.admissions.length)} `
    + `passive=${String(passive.admissions.length)}\n`,
  )

  await leader.stop()
  await passive.stop()
})

test('the controller database opens only after leadership is acquired', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(2_000)
  const app = appAt(home, clock, { instanceId: 'ordered-open' })
  await app.start()

  assert.deepEqual(
    app.startupTrace.map(entry => entry.step),
    ['lease', 'stores', 'reconcile', 'admission'],
    'the activation order of §16.1, as the runtime recorded it',
  )

  const acquired = stepOf(app, 'lease')
  assert.equal(acquired.leaseHeld, true, 'the lease row named this instance when the step completed')
  assert.equal(acquired.admitting, false, 'nothing may be admitted before the stores are open')
  assert.equal(acquired.epoch, app.lease.heldEpoch)

  const opened = stepOf(app, 'stores')
  assert.equal(opened.leaseHeld, true, 'the stores opened under real, durable leadership')
  assert.equal(opened.admitting, false)
  assert.equal(opened.epoch, app.lease.heldEpoch)

  const reconciled = stepOf(app, 'reconcile')
  assert.equal(reconciled.admitting, false, 'reconciliation runs behind a closed gate')

  const admitting = stepOf(app, 'admission')
  assert.equal(admitting.admitting, true)
  assert.equal(admitting.admissionHeld, false)
  assert.equal(admitting.leaseHeld, true)

  await app.stop()
})

test('a controller database that cannot be opened refuses the activation and leaves no lease', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const setup = appAt(home, clock, { instanceId: 'refused-open' })
  await setup.start()
  // State a newer build wrote: the journal is readable, the stamp is one this
  // build does not know. `openStore` refuses it, and it refuses it *inside*
  // `openStores` — after leadership was acquired.
  setup.store.transaction(tx => tx.exec('PRAGMA user_version = 99'))
  await setup.stop()

  const app = appAt(home, clock, { instanceId: 'refused-open' })
  await assert.rejects(
    app.start(),
    error => error.code === 'schema-version-unsupported',
  )

  assert.equal(app.store, undefined)
  assert.equal(app.lease, undefined, 'a failed activation leaves no lifecycle behind')
  assert.equal(app.admitting, false, 'admission is closed by the failure')
  assert.deepEqual(
    app.startupTrace.map(entry => entry.step),
    ['lease'],
    'leadership was acquired and given back; no store and no admission followed',
  )
  assert.deepEqual(app.shutdownTrace.map(entry => entry.step), ['admission', 'settle', 'release'])
  assert.equal(await readLeaseRow(home), undefined, 'a successor is not blocked by a failed activation')
})

test('a refused activation can be retried and leaks no handle', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const setup = appAt(home, clock, { instanceId: 'retry' })
  await setup.start()
  setup.store.transaction(tx => tx.exec('PRAGMA user_version = 99'))
  await setup.stop()

  const app = appAt(home, clock, { instanceId: 'retry' })
  await assert.rejects(app.start(), error => error.code === 'schema-version-unsupported')

  // Removing the state directory only succeeds if no handle survived the failed
  // activation: on Windows an open SQLite file cannot be unlinked.
  rmSync(join(home, 'dsh-mywork', 'state'), { recursive: true, force: true })

  await app.start()
  assert.equal(app.lease.info().phase, 'active')
  assert.equal(app.admitting, true)
  assert.notEqual(app.store, undefined)
  await app.stop()
})

test('disposal closes admission, waits for the work in flight, and releases the lease last', async () => {
  const home = tempHome()
  const clock = new adapterTesting.FakeClock(1_000)
  const app = appAt(home, clock, { instanceId: 'ordered-stop' })
  await app.start()
  assert.equal(app.admitting, true)

  let finish
  const work = new Promise(resolve => {
    finish = resolve
  })
  app.trackWork(work)

  const stopping = app.stop()
  await drain()

  assert.deepEqual(
    app.shutdownTrace.map(entry => entry.step),
    ['admission'],
    'the settle step is still waiting for the work in flight',
  )
  assert.equal(app.admitting, false, 'admission is closed first')
  assert.equal(app.lease.holdsLease(), true, 'the lease is still held while the work settles')
  assert.notEqual(await readLeaseRow(home), undefined, 'the durable row is still this instance')

  finish()
  await stopping

  assert.deepEqual(app.shutdownTrace.map(entry => entry.step), ['admission', 'settle', 'release'])
  assert.deepEqual(
    app.shutdownTrace.map(entry => [entry.admitting, entry.leaseHeld]),
    [[false, true], [false, true], [false, false]],
    'the lease is held through the settle step and released by the last one',
  )
  assert.equal(app.store, undefined, 'the stores are closed by the release step')
  assert.equal(await readLeaseRow(home), undefined, 'and the scope is free for a successor')
})
