/**
 * Attempt, lease, and fence acceptance (architecture §17, §18.2).
 *
 * Covers the main line, the forbidden-pair sweep, and the ownership checks:
 * a mismatched fence is `STALE_FENCE`, a superseded controller is `LEASE_LOST`,
 * and a superseded attempt is terminal so its late result cannot be applied.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { contracts, core, attemptFixture, leasedAttemptFixture, leaseFixture, meta } from './lib/fixtures.mjs'

const M = meta({ controllerEpoch: 3 })

/** Build a transition command for a leased attempt. */
function command(to, at, extra = {}) {
  const fence = core.ATTEMPT_FENCE_CHECKED_STATES.includes(to) ? { expectedFence: 17 } : {}
  return { to, at, ...fence, ...extra }
}

test('the main line from created to completed is allowed', () => {
  const leased = core.transitionAttempt(
    attemptFixture(),
    { to: 'leased', at: 1_000, lease: leaseFixture() },
    M,
  )
  assert.equal(leased.ok, true, leased.ok ? '' : leased.error.message)
  assert.equal(leased.value.attempt.state, 'leased')
  assert.equal(leased.value.attempt.lease.fence, 17)
  assert.equal(leased.value.events[0].payload.fence, 17)

  let attempt = leased.value.attempt
  for (const to of ['starting', 'running', 'settling', 'completed']) {
    const result = core.transitionAttempt(attempt, command(to, 1_001), M)
    assert.equal(result.ok, true, `→ ${to}: ${result.ok ? '' : result.error.message}`)
    assert.equal(result.value.attempt.revision, attempt.revision + 1)
    attempt = result.value.attempt
  }
  assert.equal(attempt.state, 'completed')
  assert.equal(attempt.startedAt, 1_001)
  assert.equal(attempt.settledAt, 1_001)
  assert.equal(core.isAttemptTerminal(attempt.state), true)
  assert.deepEqual(core.allowedAttemptTransitions('completed'), [])
})

test('every pair outside the transition table is refused with TASK_CONFLICT', () => {
  let refused = 0
  for (const from of contracts.ATTEMPT_STATES) {
    for (const to of contracts.ATTEMPT_STATES) {
      if (core.canTransitionAttempt(from, to)) continue
      const attempt = leasedAttemptFixture({ state: from, revision: 3 })
      const result = core.transitionAttempt(attempt, command(to, 100), M)
      assert.equal(result.ok, false, `${from} → ${to} must be refused`)
      assert.equal(result.error.code, 'TASK_CONFLICT', `${from} → ${to} must report TASK_CONFLICT`)
      refused += 1
    }
  }
  assert.ok(refused >= 90, `expected the sweep to cover the attempt matrix (27 legal pairs), covered ${refused}`)
})

test('a late result from a superseded attempt is refused', () => {
  // §17: attempt A1 holds fence 17, crashes, the task is reassigned to A2 with
  // fence 18; A1 is marked stale, so nothing A1 sends afterwards is applied.
  const a1 = leasedAttemptFixture({ state: 'running', revision: 4 })
  const superseded = core.transitionAttempt(a1, { to: 'stale', at: 2_000 }, M)
  assert.equal(superseded.ok, true, superseded.ok ? '' : superseded.error.message)
  assert.equal(superseded.value.attempt.state, 'stale')

  const lateResult = core.transitionAttempt(superseded.value.attempt, command('completed', 2_100), M)
  assert.equal(lateResult.ok, false)
  assert.equal(lateResult.error.code, 'TASK_CONFLICT')

  // The reassigned attempt carries a higher fence and cannot reuse the old one.
  const a2 = attemptFixture({ id: 'A-2', state: 'created', revision: 1 })
  const reuse = core.transitionAttempt(
    a2,
    { to: 'leased', at: 2_200, lease: leaseFixture({ attemptId: 'A-2', fence: 17 }), previousFence: 17 },
    M,
  )
  assert.equal(reuse.ok, false)
  assert.equal(reuse.error.code, 'TASK_CONFLICT')
  assert.match(reuse.error.message, /higher than the previous fence/)

  const fresh = core.transitionAttempt(
    a2,
    { to: 'leased', at: 2_200, lease: leaseFixture({ attemptId: 'A-2', fence: 18 }), previousFence: 17 },
    M,
  )
  assert.equal(fresh.ok, true, fresh.ok ? '' : fresh.error.message)
  assert.equal(fresh.value.attempt.lease.fence, 18)
})

test('a mismatched fence is a dedicated STALE_FENCE error', () => {
  const running = leasedAttemptFixture({ state: 'running', revision: 5 })
  const result = core.transitionAttempt(running, { to: 'settling', at: 300, expectedFence: 18 }, M)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'STALE_FENCE')
  assert.deepEqual(result.error.details, { expected: 18, actual: 17 })

  const guard = core.assertFence(16, 17, M)
  assert.equal(guard.ok, false)
  assert.equal(guard.error.code, 'STALE_FENCE')
  const matching = core.assertFence(17, 17, M)
  assert.equal(matching.ok, true)
})

test('a failover may take ownership away but not settle an old attempt', () => {
  assert.deepEqual([...core.ATTEMPT_OWNERSHIP_LOSS_STATES], ['stale', 'revoked'])
  const running = leasedAttemptFixture({ state: 'running', revision: 5 })
  const newController = meta({ controllerEpoch: 4, operationId: 'op-4' })

  const settle = core.transitionAttempt(running, command('settling', 700), newController)
  assert.equal(settle.ok, false, 'a newer controller must not settle the predecessor attempt')
  assert.equal(settle.error.code, 'LEASE_LOST')
  assert.deepEqual(settle.error.details, { expected: 4, actual: 3, to: 'settling' })

  const superseded = core.transitionAttempt(running, { to: 'stale', at: 701 }, newController)
  assert.equal(superseded.ok, true, superseded.ok ? '' : superseded.error.message)
  assert.equal(superseded.value.attempt.state, 'stale')

  const revoked = core.transitionAttempt(running, { to: 'revoked', at: 702 }, newController)
  assert.equal(revoked.ok, true, revoked.ok ? '' : revoked.error.message)
  assert.equal(revoked.value.attempt.state, 'revoked')
})

test('a superseded controller cannot mutate the attempt', () => {
  const running = leasedAttemptFixture({ state: 'running', revision: 5 })
  const staleController = meta({ controllerEpoch: 2, operationId: 'op-2' })
  const result = core.transitionAttempt(running, command('settling', 400), staleController)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'LEASE_LOST')
  assert.deepEqual(result.error.details, { expected: 2, actual: 3, to: 'settling' })

  // Revocation is a controller action, so it is checked against the epoch, not the fence.
  const revoke = core.transitionAttempt(running, { to: 'revoked', at: 401 }, staleController)
  assert.equal(revoke.ok, false)
  assert.equal(revoke.error.code, 'LEASE_LOST')
  const revoked = core.transitionAttempt(running, { to: 'revoked', at: 401 }, M)
  assert.equal(revoked.ok, true, revoked.ok ? '' : revoked.error.message)
})

test('a fence-checked transition without a fence token is a programming error', () => {
  const running = leasedAttemptFixture({ state: 'running', revision: 5 })
  assert.throws(() => core.transitionAttempt(running, { to: 'settling', at: 500 }, M), TypeError)
  // Applying a result is the moment §17 protects, so `completed` must be fenced too.
  assert.throws(() => core.transitionAttempt(running, { to: 'failed', at: 500 }, M), TypeError)
  assert.deepEqual(
    [...core.ATTEMPT_FENCE_CHECKED_STATES],
    ['starting', 'running', 'settling', 'completed', 'failed', 'timed-out', 'cancelled'],
  )
})

test('a leased attempt cannot be moved by a caller that hides its controller epoch', () => {
  const running = leasedAttemptFixture({ state: 'running', revision: 5 })
  const withoutEpoch = meta({ operationId: 'op-3' })
  assert.equal('controllerEpoch' in withoutEpoch, false)
  assert.throws(() => core.transitionAttempt(running, command('settling', 600), withoutEpoch), TypeError)
  assert.throws(() => core.transitionAttempt(running, { to: 'revoked', at: 601 }, withoutEpoch), TypeError)
})

test('leasing requires a matching, unused lease', () => {
  const created = attemptFixture()
  const missing = core.transitionAttempt(created, { to: 'leased', at: 1 }, M)
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'TASK_CONFLICT')

  const foreign = core.transitionAttempt(
    created,
    { to: 'leased', at: 1, lease: leaseFixture({ attemptId: 'A-OTHER' }) },
    M,
  )
  assert.equal(foreign.ok, false)
  assert.equal(foreign.error.code, 'CONTRACT_MISMATCH')

  const leased = leasedAttemptFixture({ state: 'leased', revision: 2 })
  const again = core.transitionAttempt(leased, { to: 'leased', at: 1, lease: leaseFixture() }, M)
  assert.equal(again.ok, false)
  assert.equal(again.error.code, 'TASK_CONFLICT')
})

test('leasing requires the issuing controller to declare its epoch', () => {
  const created = attemptFixture()
  const foreignLease = leaseFixture({ controllerEpoch: 99 })

  assert.throws(
    () => core.transitionAttempt(created, { to: 'leased', at: 1, lease: foreignLease }, meta({ operationId: 'op-5' })),
    TypeError,
    'a lease must not be minted by a caller that hides its epoch',
  )

  const mismatched = core.transitionAttempt(created, { to: 'leased', at: 1, lease: foreignLease }, M)
  assert.equal(mismatched.ok, false)
  assert.equal(mismatched.error.code, 'LEASE_LOST')

  const matching = core.transitionAttempt(created, { to: 'leased', at: 1, lease: leaseFixture() }, M)
  assert.equal(matching.ok, true, matching.ok ? '' : matching.error.message)
})

test('a malformed lease is a programming error', () => {
  const created = attemptFixture()
  assert.throws(
    () => core.transitionAttempt(created, { to: 'leased', at: 1, lease: leaseFixture({ fence: -1 }) }, M),
    TypeError,
  )
})

test('attempt activity classification matches the architecture', () => {
  assert.deepEqual(
    contracts.ATTEMPT_STATES.filter(state => core.isAttemptActive(state)),
    ['created', 'leased', 'starting', 'running', 'settling'],
  )
  assert.deepEqual([...contracts.ATTEMPT_TERMINAL_STATES], [
    'completed',
    'failed',
    'timed-out',
    'cancelled',
    'revoked',
    'stale',
  ])
  for (const state of contracts.ATTEMPT_STATES) {
    const terminal = contracts.ATTEMPT_TERMINAL_STATES.includes(state)
    assert.equal(core.isAttemptTerminal(state), terminal, `${state} terminality`)
    assert.equal(core.isAttemptActive(state), !terminal, `${state} activity`)
    if (terminal) {
      assert.deepEqual(core.allowedAttemptTransitions(state), [], `${state} must have no outgoing edge`)
    } else {
      assert.ok(core.allowedAttemptTransitions(state).length > 0, `${state} must have an outgoing edge`)
    }
  }
})
