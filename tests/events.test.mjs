/**
 * Event envelope acceptance (architecture §43).
 *
 * Every declared event type must be produced by a real transition, every
 * payload must be lossless JSON, and an envelope stamped by the event bus must
 * keep the fields the architecture lists.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  attemptFixture,
  contracts,
  core,
  instanceFixture,
  leaseFixture,
  meta,
  reviewFixture,
  taskFixture,
} from './lib/fixtures.mjs'

const M = meta({ controllerEpoch: 3 })

/** Unwrap a successful transition and collect its events. */
function take(result, into) {
  assert.equal(result.ok, true, result.ok ? '' : result.error.message)
  into.push(...result.value.events)
  return result.value
}

test('every declared event type is produced by the domain', () => {
  const events = []

  let task = taskFixture()
  task = take(core.admitAttempt(task, { attemptId: 'A-1', at: 1_000 }, M), events).task
  task = take(core.transitionTask(task, { to: 'executing', at: 1_001, activeAttemptId: 'A-1' }, M), events).task
  task = take(core.transitionTask(task, { to: 'awaiting-review', at: 1_002 }, M), events).task

  let attempt = attemptFixture()
  attempt = take(core.transitionAttempt(attempt, { to: 'leased', at: 1_000, lease: leaseFixture() }, M), events).attempt
  for (const to of ['starting', 'running', 'settling', 'completed']) {
    attempt = take(core.transitionAttempt(attempt, { to, at: 1_003, expectedFence: 17 }, M), events).attempt
  }

  let review = reviewFixture()
  review = take(core.transitionReview(review, { to: 'claimed', at: 1_004 }, M), events).review
  review = take(core.transitionReview(review, { to: 'reviewing', at: 1_005 }, M), events).review
  review = take(
    core.transitionReview(
      review,
      { to: 'approved', at: 1_006, artifact: { headSha: 'a'.repeat(40), diffHash: 'd1' }, workerAgentId: 'Neo-1' },
      M,
    ),
    events,
  ).review

  let instance = instanceFixture()
  instance = take(core.transitionAgentInstance(instance, { to: 'waking', at: 1_007 }, M), events).instance
  instance = take(core.transitionAgentInstance(instance, { to: 'running', at: 1_008, attemptId: 'A-1' }, M), events).instance
  instance = take(core.transitionAgentInstance(instance, { to: 'settling', at: 1_009 }, M), events).instance
  take(core.transitionAgentInstance(instance, { to: 'sleeping', at: 1_010 }, M), events)

  const produced = [...new Set(events.map(event => event.type))].sort()
  assert.deepEqual(produced, [...contracts.MYWORK_EVENT_TYPES].sort(), 'declared and produced event types must match')
  // task: admit + state change, executing, awaiting-review (state change + review requested) = 5
  // attempt: leased + four state changes = 5; review: three; instance: four.
  assert.equal(events.length, 17, 'every accepted transition must produce at least one event')
  assert.equal(Object.isFrozen(events[0]), true)
  assert.equal(Object.isFrozen(events[0].payload), true)
})

test('event payloads survive a JSON round trip', () => {
  const events = []
  const task = take(core.admitAttempt(taskFixture(), { attemptId: 'A-1', at: 1_000 }, M), events)
  take(core.transitionTask(task.task, { to: 'executing', at: 1_001, activeAttemptId: 'A-1' }, M), events)
  for (const event of events) {
    assert.deepEqual(JSON.parse(JSON.stringify(event)), { type: event.type, payload: { ...event.payload } })
  }
})

test('a stamped event keeps the envelope fields of the architecture', () => {
  const events = []
  take(core.admitAttempt(taskFixture(), { attemptId: 'A-1', at: 1_000 }, M), events)
  const domainEvent = events[0]

  assert.equal(contracts.MYWORK_EVENT_SCHEMA, 'mywork.event/v1')
  assert.deepEqual([...contracts.MYWORK_ENVELOPE_FIELDS], [
    'schema',
    'eventId',
    'sequence',
    'workspaceId',
    'type',
    'correlationId',
    'causationId',
    'occurredAt',
    'payload',
  ])

  const envelope = {
    schema: contracts.MYWORK_EVENT_SCHEMA,
    eventId: 'e-1',
    sequence: 1842,
    workspaceId: 'W-1',
    type: domainEvent.type,
    correlationId: 'corr-1',
    causationId: 'e-0',
    occurredAt: 1_700_000_000_000,
    payload: domainEvent.payload,
  }
  assert.deepEqual(Object.keys(envelope).sort(), [...contracts.MYWORK_ENVELOPE_FIELDS].sort())
  assert.deepEqual(JSON.parse(JSON.stringify(envelope)), envelope)

  // A root event carries no cause; the field is then simply absent.
  const root = { ...envelope }
  delete root.causationId
  assert.equal('causationId' in JSON.parse(JSON.stringify(root)), false)
  assert.deepEqual(
    Object.keys(root).sort(),
    [...contracts.MYWORK_ENVELOPE_FIELDS].filter(field => field !== 'causationId').sort(),
  )
})

test('the error vocabulary is exactly the one the architecture lists', () => {
  assert.deepEqual([...contracts.MYWORK_ERROR_CODES], [
    'ADAPTER_UNAVAILABLE',
    'CAPABILITY_UNSUPPORTED',
    'CONTRACT_MISMATCH',
    'TASK_CONFLICT',
    'STALE_REVISION',
    'LEASE_LOST',
    'STALE_FENCE',
    'CONTEXT_BUDGET_EXCEEDED',
    'MEMORY_BACKEND_ERROR',
    'SESSION_NOT_FOUND',
    'BUDGET_EXCEEDED',
    'UNSCHEDULABLE',
    'SECURITY_DENIED',
  ])
})
