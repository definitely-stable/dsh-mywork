/**
 * Controller lease, epoch, and lifecycle acceptance (architecture §5.3, §16.1,
 * §17, §49).
 *
 * The invariants that have to hold, and are checked here directly rather than
 * through the code that claims them:
 *
 * - two controllers never both believe they are the writer;
 * - a lease expires on its own and the next claimant takes over at a HIGHER
 *   epoch (§49 failover);
 * - a superseded epoch can no longer commit anything, and cannot resurrect
 *   itself by writing a lower epoch;
 * - the lifecycle is driven by activation, not by a browser tab, and on disposal
 *   it stops admission before it gives the lease up.
 *
 * Time comes from `FakeClock`, so expiry and failover are exercised without
 * waiting. Databases live in fresh temporary directories; the live `$DSH_HOME`
 * state is only ever fingerprinted, never written.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { adapterTesting, contracts, lease, storage } from './lib/fixtures.mjs'

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-lease-'

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  tempDirs.push(dir)
  return dir
}

/** Open a temporary controller database carrying the lease schema. */
async function openLeaseDatabase(dir, clock) {
  return storage.openStore({
    path: join(dir, 'controller.sqlite'),
    migrations: [...storage.MYWORK_MIGRATIONS, ...lease.LEASE_MIGRATIONS],
    clock: { now: () => clock.now() },
  })
}

/** A store bound to a fresh temporary database. */
async function freshStore(clock = new adapterTesting.FakeClock(1_000)) {
  return openLeaseDatabase(tempDir(), clock)
}

/** One acquisition request for an instance, taken at the clock's current time. */
function acquireFor(store, instanceId, clock, leaseMs = 5_000, scopeId = 'local') {
  return lease.createLeaseStore(store).acquire({
    scopeId,
    instanceId,
    processId: 4242,
    now: clock.now(),
    leaseMs,
  })
}

/** The live harness home, used only to prove this suite never writes it. */
const liveHome = process.env[storage.DSH_HOME_ENV] ?? join(homedir(), '.dsh')

/** What the live harness home looks like, without reading any of its files. */
function liveHomeFingerprint() {
  const root = join(liveHome, storage.MYWORK_DIR_NAME)
  return { exists: existsSync(root), entries: existsSync(root) ? readdirSync(root).sort() : [] }
}

const liveHomeBefore = liveHomeFingerprint()

after(() => {
  const liveHomeAfter = liveHomeFingerprint()
  assert.deepEqual(liveHomeAfter, liveHomeBefore, 'the suite must not create or change state under the live DSH home')
  for (const dir of tempDirs) {
    // Delete by handle: only a directory this suite created, under the temp root,
    // is ever a cleanup target. A failing test must not stop the others, because
    // an open database handle keeps the file locked on Windows.
    assert.ok(dir.startsWith(join(tmpdir(), TEMP_PREFIX)), `refusing to remove a directory this suite did not create: ${dir}`)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Removed on a best-effort basis; the assertion above is what protects the
      // filesystem, not this call.
    }
  }
})

test('a database without the lease migration is refused where it is wired', async () => {
  const dir = tempDir()
  const plain = await storage.openStore({ path: join(dir, 'plain.sqlite'), migrations: storage.MYWORK_MIGRATIONS })
  assert.throws(
    () => lease.createLeaseStore(plain),
    error => lease.isLeaseError(error) && error.code === 'schema-missing',
  )
  plain.close()
})

test('the first controller acquires leadership at epoch 1 and reads it back', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const result = acquireFor(store, 'controller-a', clock)
    assert.equal(result.outcome, 'acquired')
    assert.equal(result.lease.epoch, 1)
    assert.equal(result.lease.instanceId, 'controller-a')
    assert.equal(result.lease.processId, 4242)
    assert.equal(result.lease.acquiredAt, 1_000)
    assert.equal(result.lease.heartbeatAt, 1_000)
    assert.equal(result.lease.leaseUntil, 6_000, 'the lease must run for the requested window')
    assert.equal(Object.isFrozen(result.lease), true)
    // The row is durable, not in-memory belief.
    assert.equal(lease.createLeaseStore(store).read('local').epoch, 1)
  } finally {
    store.close()
  }
})

test('two controllers never both become writer', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const first = acquireFor(store, 'controller-a', clock, 5_000)
    const second = acquireFor(store, 'controller-b', clock, 5_000)

    assert.equal(first.outcome, 'acquired')
    assert.equal(second.outcome, 'held-by-other', 'a live lease must not be taken by a second controller')
    assert.equal(second.lease.instanceId, 'controller-a')
    assert.equal(second.lease.epoch, 1, 'a refused claim must not bump the epoch')

    // Exactly one of the two may consider itself the writer.
    const epochA = first.lease.epoch
    const epochB = second.lease.epoch
    assert.equal(lease.createLeaseStore(store).holdsLeadership('local', 'controller-a', epochA, clock.now()), true)

    // B must not be able to heartbeat a lease it does not hold.
    assert.throws(
      () =>
        lease.createLeaseStore(store).heartbeat({
          scopeId: 'local',
          instanceId: 'controller-b',
          processId: 4242,
          now: clock.now(),
          leaseMs: 5_000,
        }),
      error => lease.isLeaseError(error) && error.code === 'lease-lost',
    )
    assert.equal(epochB, 1, 'the loser keeps seeing the holder as the current epoch')
  } finally {
    store.close()
  }
})

test('a lease expires on its own, and the failover takes over at a higher epoch', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const port = lease.createLeaseStore(store)
    const first = port.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    assert.equal(first.outcome, 'acquired')
    assert.equal(first.lease.epoch, 1)

    // Before expiry the second controller is still refused.
    await clock.advance(4_999)
    assert.equal(acquireFor(store, 'controller-b', clock).outcome, 'held-by-other')

    // At expiry the same attempt succeeds — this is §49: "Lease expires →
    // another controller gets epoch → reconcile".
    await clock.advance(1)
    const takeover = acquireFor(store, 'controller-b', clock)
    assert.equal(takeover.outcome, 'expired-taken-over')
    assert.equal(takeover.lease.epoch, 2, 'a failover must move the epoch forward')
    assert.equal(takeover.lease.instanceId, 'controller-b')
    assert.equal(takeover.lease.acquiredAt, 6_000)
  } finally {
    store.close()
  }
})

test('a claim that loses the takeover race is refused, not granted', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const dir = tempDir()
  const path = join(dir, 'controller.sqlite')
  const migrations = [...storage.MYWORK_MIGRATIONS, ...lease.LEASE_MIGRATIONS]

  const first = await storage.openStore({ path, migrations })
  const second = await storage.openStore({ path, migrations })
  try {
    const portA = lease.createLeaseStore(first)
    const portB = lease.createLeaseStore(second)

    // A holds an expired-by-now lease, so both are looking at a claimable scope.
    portA.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: 1_000, leaseMs: 1 })
    await clock.advance(10)

    // A wins the takeover.
    const winner = portA.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    assert.equal(winner.outcome, 'renewed')
    assert.equal(winner.lease.epoch, 2)

    // B's attempt at the SAME clock reading now sees a live lease, so it is
    // refused on the expiry condition rather than on identity.
    const loser = portB.acquire({ scopeId: 'local', instanceId: 'controller-b', processId: 2, now: clock.now(), leaseMs: 5_000 })
    assert.equal(loser.outcome, 'held-by-other', 'a claim on a scope that is no longer expired must not be granted')
    assert.equal(loser.lease.instanceId, 'controller-a')
    assert.equal(loser.lease.epoch, 2, 'a lost race must not advance the epoch')
    assert.equal(portB.holdsLeadership('local', 'controller-b', 2, clock.now()), false, 'the loser must not be a writer at the winner epoch')
  } finally {
    first.close()
    second.close()
  }
})

test('heartbeat refuses an instance that is not the holder, at the same epoch', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const port = lease.createLeaseStore(store)
    const held = port.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    const epoch = held.lease.epoch

    // The refusal must come from the IDENTITY check, not incidentally from the
    // epoch or expiry check: B quotes the live holder's exact epoch, at a time
    // when the lease is unexpired.
    let refusal
    try {
      port.heartbeat({ scopeId: 'local', instanceId: 'controller-b', processId: 2, now: clock.now(), leaseMs: 5_000 })
      refusal = 'accepted'
    } catch (error) {
      refusal = { code: error.code, holder: error.details?.holder }
    }
    assert.deepEqual(refusal, { code: 'lease-lost', holder: 'controller-a' }, 'a non-holder must not renew at the holder epoch')

    // The holder's own heartbeat at that same epoch still works, so the test is
    // not merely observing a broken heartbeat.
    const renewed = port.heartbeat({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    assert.equal(renewed.outcome, 'renewed')
    assert.equal(renewed.lease.epoch, epoch)
  } finally {
    store.close()
  }
})

test('release by the right instance is refused if the epoch is stale', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const port = lease.createLeaseStore(store)
    const first = port.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    const oldEpoch = first.lease.epoch

    // A loses leadership by expiry, then re-acquires it itself: same instance,
    // higher epoch. Releasing with the OLD epoch must not drop the new claim, so
    // the epoch half of the release condition is what is under test here.
    await clock.advance(5_000)
    const reacquired = port.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    assert.equal(reacquired.outcome, 'renewed')
    assert.equal(reacquired.lease.epoch, oldEpoch + 1, 'a re-acquisition after expiry is a new epoch')

    assert.equal(
      port.release({ scopeId: 'local', instanceId: 'controller-a', epoch: oldEpoch }),
      false,
      'a stale epoch must not release the current claim, even for the same instance',
    )
    assert.equal(port.read('local').epoch, oldEpoch + 1, 'the current claim must survive the stale release')

    // The epoch it actually holds does release it.
    assert.equal(port.release({ scopeId: 'local', instanceId: 'controller-a', epoch: oldEpoch + 1 }), true)
    assert.equal(port.read('local'), undefined)
  } finally {
    store.close()
  }
})

test('a superseded epoch cannot commit, and cannot resurrect itself', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const port = lease.createLeaseStore(store)
    const first = port.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    const oldEpoch = first.lease.epoch

    // Hand leadership over through a real expiry, not by editing the row.
    await clock.advance(5_000)
    const takeover = port.acquire({ scopeId: 'local', instanceId: 'controller-b', processId: 2, now: clock.now(), leaseMs: 5_000 })
    assert.equal(takeover.outcome, 'expired-taken-over')

    // The old epoch is refused the writer gate ...
    assert.equal(port.holdsLeadership('local', 'controller-a', oldEpoch, clock.now()), false, 'a stale epoch must not hold leadership')
    assert.equal(port.holdsLeadership('local', 'controller-b', takeover.lease.epoch, clock.now()), true)
    // The successor's epoch quoted by the predecessor is still not leadership:
    // identity and epoch must both match the row.
    assert.equal(port.holdsLeadership('local', 'controller-a', takeover.lease.epoch, clock.now()), false, 'an epoch alone is not ownership')

    // ... its release is a no-op that must not clear the successor's claim ...
    assert.equal(port.release({ scopeId: 'local', instanceId: 'controller-a', epoch: oldEpoch }), false)
    assert.equal(port.read('local').instanceId, 'controller-b', 'the predecessor must not be able to drop the successor row')

    // ... and it cannot write itself back in at a lower epoch: monotonicity is
    // enforced by the database, so no code path in the layer can lower it.
    const raw = store.transaction(tx => {
      try {
        tx.run('UPDATE controller_lease SET epoch = ? WHERE scope_id = ?', oldEpoch, 'local')
        return 'accepted'
      } catch (error) {
        return String(error.message)
      }
    })
    assert.match(raw, new RegExp(lease.EPOCH_NOT_MONOTONIC_MARKER), 'lowering the epoch must be refused by the database')
    assert.equal(port.read('local').epoch, takeover.lease.epoch, 'the epoch must be unchanged after the refused write')
  } finally {
    store.close()
  }
})

test('an expired lease cannot be heartbeated back to life', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const port = lease.createLeaseStore(store)
    port.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    await clock.advance(5_000)
    assert.throws(
      () => port.heartbeat({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 }),
      error => lease.isLeaseError(error) && error.code === 'lease-lost',
    )
  } finally {
    store.close()
  }
})

test('a live lease is renewed by its holder without moving the epoch', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const port = lease.createLeaseStore(store)
    port.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })

    await clock.advance(3_000)
    const renewed = port.heartbeat({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    assert.equal(renewed.outcome, 'renewed')
    assert.equal(renewed.lease.epoch, 1, 'a renewal is not a handover, so the epoch stays put')
    assert.equal(renewed.lease.heartbeatAt, 4_000)
    assert.equal(renewed.lease.leaseUntil, 9_000)
    assert.equal(renewed.lease.acquiredAt, 1_000, 'the acquisition time is not rewritten by a heartbeat')

    // The window really moved: at a time past the original expiry the holder is
    // still the writer.
    await clock.advance(4_000)
    assert.equal(port.holdsLeadership('local', 'controller-a', 1, clock.now()), true)
  } finally {
    store.close()
  }
})

test('release gives leadership up, and the next controller starts a new epoch', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const port = lease.createLeaseStore(store)
    const first = port.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    assert.equal(port.release({ scopeId: 'local', instanceId: 'controller-a', epoch: first.lease.epoch }), true)
    assert.equal(port.read('local'), undefined, 'a released scope has no row')

    const second = port.acquire({ scopeId: 'local', instanceId: 'controller-b', processId: 2, now: clock.now(), leaseMs: 5_000 })
    assert.equal(second.outcome, 'acquired')
    assert.equal(second.lease.epoch, 1, 'the first row of a released scope starts a fresh sequence')
    assert.equal(second.lease.instanceId, 'controller-b')
  } finally {
    store.close()
  }
})

test('two controllers on one file: only one holds the lease at any instant', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const dir = tempDir()
  const path = join(dir, 'controller.sqlite')

  // Two connections to one database, as two mounted controllers would be.
  const first = await storage.openStore({ path, migrations: [...storage.MYWORK_MIGRATIONS, ...lease.LEASE_MIGRATIONS] })
  const second = await storage.openStore({ path, migrations: [...storage.MYWORK_MIGRATIONS, ...lease.LEASE_MIGRATIONS] })
  try {
    const portA = lease.createLeaseStore(first)
    const portB = lease.createLeaseStore(second)

    const a = portA.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    const b = portB.acquire({ scopeId: 'local', instanceId: 'controller-b', processId: 2, now: clock.now(), leaseMs: 5_000 })
    assert.equal(a.outcome, 'acquired')
    assert.equal(b.outcome, 'held-by-other')

    // Both connections see the same row, and it names exactly one holder.
    assert.equal(portA.read('local').instanceId, 'controller-a')
    assert.equal(portB.read('local').instanceId, 'controller-a')

    // Each connection checks leadership with the identity it believes it has. A
    // is the holder; B was refused, so B quoting A's epoch must not pass.
    assert.equal(portA.holdsLeadership('local', 'controller-a', a.lease.epoch, clock.now()), true, 'A holds the current epoch')
    assert.equal(portB.holdsLeadership('local', 'controller-b', b.lease.epoch, clock.now()), false, 'B must not be a writer')
    assert.equal(b.lease.epoch, a.lease.epoch, 'B was shown the holder current epoch, not one of its own')
  } finally {
    first.close()
    second.close()
  }
})

test('a malformed acquisition is refused before the database is touched', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const port = lease.createLeaseStore(store)
    const bad = [
      { scopeId: ' ', instanceId: 'c', processId: 1, now: 0, leaseMs: 100 },
      { scopeId: 'local', instanceId: '', processId: 1, now: 0, leaseMs: 100 },
      { scopeId: 'local', instanceId: 'c', processId: -1, now: 0, leaseMs: 100 },
      { scopeId: 'local', instanceId: 'c', processId: 1, now: 0.5, leaseMs: 100 },
      { scopeId: 'local', instanceId: 'c', processId: 1, now: 0, leaseMs: 0 },
    ]
    for (const request of bad) {
      assert.throws(
        () => port.acquire(request),
        error => lease.isLeaseError(error) && error.code === 'invalid-input',
        `expected a refusal for ${JSON.stringify(request)}`,
      )
    }
    assert.equal(port.read('local'), undefined, 'a refused request must not create a row')
  } finally {
    store.close()
  }
})

test('the writer gate honours expiry directly, not only through a lifecycle', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const port = lease.createLeaseStore(store)
    const held = port.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    const epoch = held.lease.epoch

    assert.equal(port.holdsLeadership('local', 'controller-a', epoch, clock.now()), true)
    // One millisecond before expiry it still holds; at expiry it does not.
    assert.equal(port.holdsLeadership('local', 'controller-a', epoch, 5_999), true)
    assert.equal(port.holdsLeadership('local', 'controller-a', epoch, 6_000), false, 'the boundary must be exclusive')
    assert.equal(port.holdsLeadership('local', 'controller-a', epoch, 6_001), false)
  } finally {
    store.close()
  }
})

test('the database itself refuses to lower the epoch, and the guard is not merely a name', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const port = lease.createLeaseStore(store)
    const held = port.acquire({ scopeId: 'local', instanceId: 'controller-a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    const epoch = held.lease.epoch

    // The trigger must exist under its declared name AND actually guard: a check
    // for the name alone would pass on a trigger whose body does nothing.
    const triggers = store.transaction(tx =>
      tx.all("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'controller_lease'"),
    )
    assert.deepEqual(
      triggers.map(row => String(row.name)),
      ['controller_lease_epoch_monotonic'],
      'the monotonicity guard must be installed on the lease table',
    )

    // Lowering the epoch is refused by the DATABASE, not by this layer's code:
    // the statement below bypasses every check the layer has.
    const lowered = store.transaction(tx => {
      try {
        tx.run('UPDATE controller_lease SET epoch = ? WHERE scope_id = ?', epoch - 1, 'local')
        return 'accepted'
      } catch (error) {
        return String(error.message)
      }
    })
    assert.match(lowered, new RegExp(lease.EPOCH_NOT_MONOTONIC_MARKER), 'lowering the epoch must abort the statement')
    assert.equal(port.read('local').epoch, epoch, 'the refused write must leave the row untouched')

    // The guard is scoped to LOWERING only: an equal epoch must still be
    // writable, because that is exactly what a heartbeat does.
    const equal = store.transaction(tx => {
      tx.run('UPDATE controller_lease SET epoch = ? WHERE scope_id = ?', epoch, 'local')
      return 'accepted'
    })
    assert.equal(equal, 'accepted', 'an equal epoch is a renewal, not a transition, and must be allowed')

    // And the guard does not block the legitimate advance.
    await clock.advance(5_000)
    const takeover = acquireFor(store, 'controller-b', clock)
    assert.equal(takeover.outcome, 'expired-taken-over')
    assert.equal(takeover.lease.epoch, epoch + 1, 'a real handover must still be able to raise the epoch')
  } finally {
    store.close()
  }
})

test('the lease table is STRICT and holds one row per scope', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const port = lease.createLeaseStore(store)
    port.acquire({ scopeId: 'local', instanceId: 'a', processId: 1, now: clock.now(), leaseMs: 5_000 })
    port.acquire({ scopeId: 'other', instanceId: 'b', processId: 2, now: clock.now(), leaseMs: 5_000 })
    const scopes = store.transaction(tx => tx.all('SELECT scope_id FROM controller_lease ORDER BY scope_id'))
    assert.deepEqual(scopes.map(row => String(row.scope_id)), ['local', 'other'], 'one row per scope, kept apart')

    const refusal = store.transaction(tx => {
      try {
        tx.run(
          'INSERT INTO controller_lease (scope_id, instance_id, process_id, epoch, acquired_at, heartbeat_at, lease_until) VALUES (?, ?, ?, ?, ?, ?, ?)',
          'strict',
          'c',
          3,
          1,
          'not-a-number',
          1,
          2,
        )
        return 'accepted'
      } catch (error) {
        return String(error.message)
      }
    })
    assert.match(refusal, /cannot store TEXT value in INTEGER column/i, 'STRICT must refuse a value of the wrong type')
  } finally {
    store.close()
  }
})

/* ------------------------------------------------------------------ *
 * Lifecycle: activation opens stores and reconciles; disposal stops
 * admission before releasing the lease. No browser tab is involved.
 * ------------------------------------------------------------------ */

/** A lifecycle over a real lease store, recording what the factories were asked to do. */
function lifecycleFor(store, clock, overrides = {}) {
  const calls = { opened: 0, reconciled: 0, closed: 0 }
  const instance = new lease.ControllerLifecycle({
    scopeId: 'local',
    instanceId: 'controller-a',
    processId: 4242,
    clock,
    leaseMs: 5_000,
    leases: lease.createLeaseStore(store),
    openStores: () => {
      calls.opened += 1
      return { registry: store, controller: store }
    },
    reconcile: () => {
      calls.reconciled += 1
      return { operations: 2, leases: 1 }
    },
    closeStores: () => {
      calls.closed += 1
    },
    ...overrides,
  })
  return { instance, calls }
}

test('activation acquires the lease, opens stores, reconciles, then admits work', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const { instance, calls } = lifecycleFor(store, clock)
    assert.equal(instance.info().phase, 'idle')
    assert.equal(instance.isWriter(), false, 'an idle controller is not a writer')

    const info = await instance.activate()
    assert.equal(info.phase, 'active')
    assert.equal(info.epoch, 1)
    assert.equal(info.activatedAt, 1_000)
    assert.equal(info.admitting, true)
    assert.equal(calls.opened, 1, 'activation must open the stores')
    assert.equal(calls.reconciled, 1, 'activation must reconcile before admitting work')
    assert.deepEqual(instance.reconcileReport, { operations: 2, leases: 1 })
    assert.equal(instance.isWriter(), true)
  } finally {
    store.close()
  }
})

test('a passive controller opens nothing and admits nothing', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    assert.equal(acquireFor(store, 'controller-a', clock).outcome, 'acquired')
    const { instance, calls } = lifecycleFor(store, clock, { instanceId: 'controller-b' })

    const info = await instance.activate()
    assert.equal(info.phase, 'passive')
    assert.equal(info.admitting, false)
    assert.equal(instance.isWriter(), false)
    assert.equal(calls.opened, 0, 'a controller that did not win leadership must not open the stores')
    assert.equal(calls.reconciled, 0)
    assert.equal(instance.heldEpoch, undefined)
  } finally {
    store.close()
  }
})

test('disposal stops admission, closes the stores, and only then releases the lease', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const order = []
    const { instance } = lifecycleFor(store, clock, {
      closeStores: () => {
        // At the moment the stores close, admission must already be shut but the
        // lease must still be held: a successor may not start writing while this
        // controller is still finishing.
        order.push(`close:admitting=${instance.isWriter()}`)
        order.push(`close:lease=${lease.createLeaseStore(store).read('local') !== undefined}`)
      },
    })

    await instance.activate()
    order.push(`active:admitting=${instance.isWriter()}`)

    await instance.dispose()
    order.push(`disposed:admitting=${instance.isWriter()}`)
    assert.deepEqual(order, [
      'active:admitting=true',
      'close:admitting=false',
      'close:lease=true',
      'disposed:admitting=false',
    ])
    assert.equal(instance.info().phase, 'disposed')
    assert.equal(lease.createLeaseStore(store).read('local'), undefined, 'disposal must give the lease up')
  } finally {
    store.close()
  }
})

test('disposal is idempotent, and safe on a controller that never activated', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const { instance, calls } = lifecycleFor(store, clock)
    await instance.dispose()
    await instance.dispose()
    assert.equal(calls.closed, 0, 'nothing was opened, so nothing is closed')
    assert.equal(instance.info().phase, 'disposed')

    const second = lifecycleFor(store, clock, { instanceId: 'controller-b' })
    await second.instance.activate()
    await second.instance.dispose()
    await second.instance.dispose()
    assert.equal(second.calls.closed, 1, 'the stores are closed exactly once')
  } finally {
    store.close()
  }
})

test('a heartbeat after a failover closes admission before it reports the loss', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const { instance } = lifecycleFor(store, clock)
    await instance.activate()
    assert.equal(instance.isWriter(), true)

    // Leadership is lost the way §49 says it is lost: the lease expires and a
    // successor takes over.
    await clock.advance(5_000)
    const takeover = acquireFor(store, 'controller-b', clock)
    assert.equal(takeover.outcome, 'expired-taken-over')

    assert.throws(
      () => instance.heartbeat(),
      error => lease.isLeaseError(error) && error.code === 'lease-lost',
    )
    assert.equal(instance.isWriter(), false, 'admission must be closed by the failed heartbeat')
    assert.equal(instance.info().phase, 'passive')
    assert.equal(instance.info().admitting, false)
  } finally {
    store.close()
  }
})

test('a superseded controller is no longer a writer even before it notices', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const { instance } = lifecycleFor(store, clock)
    await instance.activate()
    const oldEpoch = instance.heldEpoch

    // The successor takes over without this controller being told anything.
    await clock.advance(5_000)
    acquireFor(store, 'controller-b', clock, 5_000)

    // `isWriter` reads durable state, so the loss is visible without a heartbeat
    // having failed first. That is what stops a late write from a dead leader.
    assert.equal(instance.isWriter(), false, 'a stale epoch must not pass the writer gate')
    assert.equal(instance.holdsLease(), false)
    assert.notEqual(instance.heldEpoch, undefined)
  } finally {
    store.close()
  }
})

test('a failed activation gives the lease back instead of blocking a successor', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    const { instance } = lifecycleFor(store, clock, {
      openStores: () => {
        throw new Error('dsh-mywork: the registry database is unavailable')
      },
    })
    await assert.rejects(instance.activate(), /registry database is unavailable/)

    assert.equal(
      lease.createLeaseStore(store).read('local'),
      undefined,
      'leadership without open stores must be handed back, not held until expiry',
    )

    // A healthy successor is not blocked by the failed attempt.
    const next = lifecycleFor(store, clock, { instanceId: 'controller-b' })
    assert.equal((await next.instance.activate()).phase, 'active')
  } finally {
    store.close()
  }
})

test('the lifecycle survives a restart: the lease row outlives the process', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const dir = tempDir()
  const path = join(dir, 'controller.sqlite')
  const migrations = [...storage.MYWORK_MIGRATIONS, ...lease.LEASE_MIGRATIONS]

  const first = await storage.openStore({ path, migrations })
  const instance = new lease.ControllerLifecycle({
    scopeId: 'local',
    instanceId: 'controller-a',
    processId: 4242,
    clock,
    leaseMs: 5_000,
    leases: lease.createLeaseStore(first),
    openStores: () => ({ registry: first, controller: first }),
    reconcile: () => ({ operations: 0, leases: 0 }),
    closeStores: () => {},
  })
  await instance.activate()
  first.close()

  // Reopen as a new process would, without disposing: the lease is still there
  // and still unexpired, so a second controller is still refused.
  const reopened = await storage.openStore({ path, migrations })
  try {
    const row = lease.createLeaseStore(reopened).read('local')
    assert.equal(row.epoch, 1)
    assert.equal(row.instanceId, 'controller-a')
    assert.equal(row.leaseUntil, 6_000)
    assert.equal(acquireFor(reopened, 'controller-b', clock).outcome, 'held-by-other')
  } finally {
    reopened.close()
  }
})

test('the lifecycle needs no open UI: activation and disposal are self-contained', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await freshStore(clock)
  try {
    // Nothing here reads a document, a window, or a page: the whole lifecycle is
    // driven by the clock and the durable row.
    assert.equal(typeof globalThis.document, 'undefined', 'this suite must run without a DOM')
    const { instance } = lifecycleFor(store, clock)
    await instance.activate()
    assert.equal(instance.isWriter(), true)

    // Time passing alone expires it, with no event and no tab.
    await clock.advance(5_000)
    assert.equal(instance.isWriter(), false, 'expiry must not require a UI event to take effect')

    await instance.dispose()
    assert.equal(instance.info().phase, 'disposed')
  } finally {
    store.close()
  }
})
