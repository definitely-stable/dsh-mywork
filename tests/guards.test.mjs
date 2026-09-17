/**
 * Guard acceptance (architecture §9, §35, §42).
 *
 * Revision, fence, and controller-epoch mismatches must each answer with their
 * own error code, and a frozen revision set must reject an unknown family.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { core, meta } from './lib/fixtures.mjs'

const M = meta()

test('an operation identity is validated and frozen', () => {
  const full = core.defineOperationMeta({
    operationId: 'op-9',
    correlationId: 'corr-9',
    expectedRevision: 4,
    controllerEpoch: 2,
  })
  assert.deepEqual({ ...full }, { operationId: 'op-9', correlationId: 'corr-9', expectedRevision: 4, controllerEpoch: 2 })
  assert.equal(Object.isFrozen(full), true)

  const minimal = core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1' })
  assert.equal('expectedRevision' in minimal, false)
  assert.equal('controllerEpoch' in minimal, false)

  assert.throws(() => core.defineOperationMeta({ operationId: ' ', correlationId: 'corr' }), TypeError)
  assert.throws(() => core.defineOperationMeta({ operationId: 'op', correlationId: '' }), TypeError)
  assert.throws(
    () => core.defineOperationMeta({ operationId: 'op', correlationId: 'corr', expectedRevision: -1 }),
    TypeError,
  )
  assert.throws(
    () => core.defineOperationMeta({ operationId: 'op', correlationId: 'corr', controllerEpoch: 1.5 }),
    TypeError,
  )
})

test('results carry their operation metadata and are frozen', () => {
  const success = core.ok({ answer: 42 }, M)
  assert.equal(success.ok, true)
  assert.deepEqual(success.value, { answer: 42 })
  assert.equal(success.meta.operationId, 'op-1')
  assert.equal(Object.isFrozen(success), true)

  const failure = core.fail(new core.MyWorkError('TASK_CONFLICT', 'nope'), M)
  assert.equal(failure.ok, false)
  assert.equal(failure.error.code, 'TASK_CONFLICT')
  assert.equal(failure.meta.correlationId, 'corr-1')
  assert.equal(core.isMyWorkError(failure.error), true)
  assert.equal(core.isMyWorkError(new Error('plain')), false)
  assert.equal(new core.MyWorkError('STALE_FENCE', 'x').name, 'MyWorkError')
  assert.deepEqual(new core.MyWorkError('STALE_FENCE', 'x').details, {})
})

test('a revision mismatch is STALE_REVISION, an absent expectation passes', () => {
  assert.equal(core.assertRevision(undefined, 5, M).ok, true)
  assert.equal(core.assertRevision(5, 5, M).ok, true)

  const stale = core.assertRevision(4, 5, M)
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'STALE_REVISION')
  assert.deepEqual(stale.error.details, { expected: 4, actual: 5 })
})

test('a fence or epoch mismatch has its own error', () => {
  const staleFence = core.assertFence(3, 4, M)
  assert.equal(staleFence.ok, false)
  assert.equal(staleFence.error.code, 'STALE_FENCE')

  const lostLease = core.assertControllerEpoch(1, 2, M)
  assert.equal(lostLease.ok, false)
  assert.equal(lostLease.error.code, 'LEASE_LOST')
  assert.equal(core.assertControllerEpoch(undefined, 2, M).ok, true)
  assert.equal(core.assertControllerEpoch(2, 2, M).ok, true)

  assert.throws(() => core.assertFence(1.5, 2, M), TypeError)
  assert.equal(core.isCounter(0), true)
  assert.equal(core.isCounter(-1), false)
})

test('a frozen revision set rejects an unknown family or a bad counter', () => {
  const frozen = core.freezeRevisions({ config: 3, role: 7 }, M)
  assert.equal(frozen.ok, true)
  assert.deepEqual({ ...frozen.value }, { config: 3, role: 7 })
  assert.equal(Object.isFrozen(frozen.value), true)

  const unknown = core.freezeRevisions({ workflow: 1, banana: 2 }, M)
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'CONTRACT_MISMATCH')
  assert.equal(unknown.error.details.kind, 'banana')

  const negative = core.freezeRevisions({ config: -1 }, M)
  assert.equal(negative.ok, false)
  assert.equal(negative.error.code, 'CONTRACT_MISMATCH')
})
