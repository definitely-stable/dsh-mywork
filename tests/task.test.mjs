/**
 * Task state machine acceptance (architecture §18.1, §17).
 *
 * Covers the allowed main line, a sweep over every forbidden pair, the
 * attempt-binding invariants (a completed task admits no attempt, ownership is
 * continuous), the admission-only path into `assigned`, the stale revision
 * error, and the events a transition emits.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { contracts, core, meta, taskFixture } from './lib/fixtures.mjs'

const M = meta()
const MAIN_LINE = ['planned', 'ready', 'executing', 'awaiting-review', 'reviewing', 'approved', 'integrating', 'done']

/** Build a transition command that satisfies the attempt binding of the target state. */
function command(to, at, extra = {}) {
  const bound = core.requiresActiveAttempt(to) ? { activeAttemptId: 'A-1' } : {}
  return { to, at, ...bound, ...extra }
}

test('the main line from draft to done is allowed and increments the revision', () => {
  let task = taskFixture({ state: 'draft' })
  let at = 1_000

  for (const to of MAIN_LINE.slice(0, 2)) {
    const result = core.transitionTask(task, command(to, at), M)
    assert.equal(result.ok, true, `draft → … → ${to} must be allowed: ${result.ok ? '' : result.error.message}`)
    assert.equal(result.value.task.revision, task.revision + 1)
    assert.equal(result.value.from, task.state)
    assert.equal(result.value.to, to)
    task = result.value.task
    at += 1
  }

  // `ready → assigned` is reachable only by admitting an attempt.
  const admitted = core.admitAttempt(task, { attemptId: 'A-1', at }, M)
  assert.equal(admitted.ok, true, admitted.ok ? '' : admitted.error.message)
  assert.equal(admitted.value.task.revision, task.revision + 1)
  assert.equal(admitted.value.task.activeAttemptId, 'A-1')
  task = admitted.value.task
  at += 1

  for (const to of MAIN_LINE.slice(2)) {
    const result = core.transitionTask(task, command(to, at), M)
    assert.equal(result.ok, true, `${task.state} → ${to} must be allowed: ${result.ok ? '' : result.error.message}`)
    assert.equal(result.value.task.revision, task.revision + 1)
    task = result.value.task
    at += 1
  }

  assert.equal(task.state, 'done')
  assert.equal(task.completedAt, at - 1)
  assert.equal(task.activeAttemptId, undefined)
  assert.equal(Object.isFrozen(task), true)
})

test('every pair outside the transition table is refused with TASK_CONFLICT', () => {
  let refused = 0
  for (const from of contracts.TASK_STATES) {
    for (const to of contracts.TASK_STATES) {
      if (core.canTransitionTask(from, to)) continue
      const task = taskFixture({
        state: from,
        revision: 4,
        ...(core.requiresActiveAttempt(from) ? { activeAttemptId: 'A-1' } : {}),
      })
      const result = core.transitionTask(task, command(to, 500), M)
      assert.equal(result.ok, false, `${from} → ${to} must be refused`)
      assert.equal(result.error.code, 'TASK_CONFLICT', `${from} → ${to} must report TASK_CONFLICT`)
      assert.deepEqual(result.error.details.from, from)
      assert.deepEqual(result.error.details.to, to)
      refused += 1
    }
  }
  assert.ok(refused >= 150, `expected the sweep to cover most of the 16×16 matrix, covered ${refused}`)
})

test('entering assigned is possible only by admitting an attempt', () => {
  const ready = taskFixture()
  const direct = core.transitionTask(ready, { to: 'assigned', at: 10, activeAttemptId: 'A-1' }, M)
  assert.equal(direct.ok, false)
  assert.equal(direct.error.code, 'TASK_CONFLICT')
  assert.match(direct.error.message, /can only be assigned by admitting an attempt/)

  const admitted = core.admitAttempt(ready, { attemptId: 'A-1', at: 10 }, M)
  assert.equal(admitted.ok, true)
  assert.deepEqual(
    admitted.value.events.map(event => event.type),
    ['task.state.changed', 'task.attempt.admitted'],
    'every admission must emit the admission event',
  )
})

test('a done task is terminal and admits no further transition', () => {
  const done = taskFixture({ state: 'done', revision: 9, completedAt: 1_000 })
  for (const to of contracts.TASK_STATES) {
    const result = core.transitionTask(done, command(to, 1_100), M)
    assert.equal(result.ok, false, `done → ${to} must be refused`)
    assert.equal(result.error.code, 'TASK_CONFLICT')
  }
  assert.deepEqual(core.allowedTaskTransitions('done'), [])
})

test('the terminal task states are exactly the architecture ones', () => {
  assert.deepEqual([...contracts.TASK_TERMINAL_STATES], ['done', 'cancelled', 'superseded'])
  for (const state of contracts.TASK_STATES) {
    const terminal = contracts.TASK_TERMINAL_STATES.includes(state)
    assert.equal(core.isTaskTerminal(state), terminal, `${state} terminality`)
    if (terminal) {
      assert.deepEqual(core.allowedTaskTransitions(state), [], `${state} must have no outgoing edge`)
    } else {
      assert.ok(core.allowedTaskTransitions(state).length > 0, `${state} must have an outgoing edge`)
    }
  }
})

test('a completed task admits no attempt (UNSCHEDULABLE)', () => {
  for (const state of contracts.TASK_TERMINAL_STATES) {
    const result = core.admitAttempt(taskFixture({ state, revision: 3 }), { attemptId: 'A-9', at: 2_000 }, M)
    assert.equal(result.ok, false, `${state} must not admit an attempt`)
    assert.equal(result.error.code, 'UNSCHEDULABLE')
    assert.equal(result.error.details.state, state)
  }
})

test('only a ready task admits an attempt', () => {
  for (const state of contracts.TASK_STATES) {
    const task = taskFixture({
      state,
      revision: 2,
      ...(core.requiresActiveAttempt(state) ? { activeAttemptId: 'A-0' } : {}),
    })
    const result = core.admitAttempt(task, { attemptId: 'A-9', at: 2_000 }, M)
    if (state === 'ready') {
      assert.equal(result.ok, true)
      assert.equal(result.value.task.state, 'assigned')
      assert.equal(result.value.task.activeAttemptId, 'A-9')
    } else {
      assert.equal(result.ok, false, `${state} must not admit an attempt`)
      assert.equal(result.error.code, 'UNSCHEDULABLE')
    }
  }
})

test('moving into awaiting-review also requests a review', () => {
  const executing = taskFixture({ state: 'executing', revision: 5, activeAttemptId: 'A-1' })
  const result = core.transitionTask(executing, command('awaiting-review', 700), M)
  assert.equal(result.ok, true)
  assert.deepEqual(
    result.value.events.map(event => event.type),
    ['task.state.changed', 'task.review.requested'],
  )
})

test('ownership of an attempt is continuous within a task', () => {
  const assigned = taskFixture({ state: 'assigned', revision: 4, activeAttemptId: 'A-1' })

  const swapped = core.transitionTask(assigned, { to: 'executing', at: 10, activeAttemptId: 'A-2' }, M)
  assert.equal(swapped.ok, false, 'a task must not silently swap its attempt')
  assert.equal(swapped.error.code, 'TASK_CONFLICT')
  assert.deepEqual(swapped.error.details, { taskId: 'T-1', currentAttemptId: 'A-1', requestedAttemptId: 'A-2' })

  const kept = core.transitionTask(assigned, { to: 'executing', at: 10 }, M)
  assert.equal(kept.ok, true, kept.ok ? '' : kept.error.message)
  assert.equal(kept.value.task.activeAttemptId, 'A-1', 'the running attempt must be kept')
})

test('the holder the graph recorded survives a transition', () => {
  // `assignee` is the graph's own view of who holds the task (§8), and §49's
  // reconciler reads it to tell a live claim from a lost one. A transition that
  // dropped it would make a claimed task look unheld to the next reader — which
  // is exactly the state a reconciler must never be handed.
  const claimed = taskFixture({ state: 'assigned', revision: 4, activeAttemptId: 'A-1', assignee: 'worker-a' })

  const moved = core.transitionTask(claimed, { to: 'executing', at: 10 }, M)
  assert.equal(moved.ok, true, moved.ok ? '' : moved.error.message)
  assert.equal(moved.value.task.assignee, 'worker-a', 'a transition must not lose the holder')

  // A task nobody holds carries no holder, rather than an invented one.
  const bare = core.transitionTask(taskFixture({ state: 'ready', revision: 2 }), { to: 'blocked', at: 11 }, M)
  assert.equal(bare.ok, true, bare.ok ? '' : bare.error.message)
  assert.equal('assignee' in bare.value.task, false, 'an unheld task must not gain a holder')
})

test('the attempt binding of a state is enforced by the transition itself', () => {
  const executing = taskFixture({ state: 'executing', revision: 5, activeAttemptId: 'A-1' })
  const withAttempt = core.transitionTask(executing, command('awaiting-review', 11, { activeAttemptId: 'A-1' }), M)
  assert.equal(withAttempt.ok, false)
  assert.equal(withAttempt.error.code, 'TASK_CONFLICT')
  assert.match(withAttempt.error.message, /must not hold an active attempt/)

  const bare = taskFixture({ state: 'ready', revision: 2 })
  const missing = core.transitionTask(bare, { to: 'executing', at: 12 }, M)
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'TASK_CONFLICT')
  assert.match(missing.error.message, /cannot move from "ready" to "executing"/)
})

test('a nonsensical task is refused before any edge is considered', () => {
  const broken = taskFixture({ state: 'done', revision: 3, activeAttemptId: 'A-1' })
  const result = core.transitionTask(broken, { to: 'planned', at: 100 }, M)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'TASK_CONFLICT')
  assert.match(result.error.message, /terminal task/)

  const missingAttempt = taskFixture({ state: 'executing', revision: 3 })
  const invariants = core.assertTaskInvariants(missingAttempt, M)
  assert.equal(invariants.ok, false)
  assert.equal(invariants.error.code, 'TASK_CONFLICT')
  assert.match(invariants.error.message, /requires an active attempt/)
})

test('a stale expected revision fails before the transition is evaluated', () => {
  const task = taskFixture({ state: 'draft', revision: 7 })
  const stale = core.transitionTask(task, { to: 'planned', at: 1, expectedRevision: 6 }, M)
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'STALE_REVISION')
  assert.deepEqual(stale.error.details, { expected: 6, actual: 7 })
  assert.equal(stale.meta.operationId, 'op-1')

  const staleAdmission = core.admitAttempt(task, { attemptId: 'A-1', at: 1, expectedRevision: 6 }, M)
  assert.equal(staleAdmission.ok, false)
  assert.equal(staleAdmission.error.code, 'STALE_REVISION')

  const current = core.transitionTask(task, { to: 'planned', at: 1, expectedRevision: 7 }, M)
  assert.equal(current.ok, true)
})

test('a stale expected revision wins over the admission guard', () => {
  const ready = taskFixture({ revision: 4 })
  const stale = core.transitionTask(ready, { to: 'assigned', at: 5, activeAttemptId: 'A-1', expectedRevision: 1 }, M)
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'STALE_REVISION', 'the revision check must run before the admission guard')
  assert.deepEqual(stale.error.details, { expected: 1, actual: 4 })
})

test('a revoked attempt returns the task to ready and clears the binding', () => {
  const assigned = taskFixture({ state: 'assigned', revision: 4, activeAttemptId: 'A-1' })
  const result = core.transitionTask(assigned, { to: 'ready', at: 900 }, M)
  assert.equal(result.ok, true)
  assert.equal(result.value.task.state, 'ready')
  assert.equal(result.value.task.activeAttemptId, undefined)
})

test('a rejection returns the task to ready through changes-requested', () => {
  const reviewing = taskFixture({ state: 'reviewing', revision: 6 })
  const rejected = core.transitionTask(reviewing, { to: 'changes-requested', at: 950 }, M)
  assert.equal(rejected.ok, true)
  const requeued = core.transitionTask(rejected.value.task, { to: 'ready', at: 951 }, M)
  assert.equal(requeued.ok, true)
  const readmitted = core.admitAttempt(requeued.value.task, { attemptId: 'A-2', at: 952 }, M)
  assert.equal(readmitted.ok, true, 'a new attempt must be admissible after a rejection')
  assert.equal(readmitted.value.task.activeAttemptId, 'A-2')
})
