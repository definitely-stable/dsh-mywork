/**
 * Agent instance lifecycle acceptance (architecture §13.5).
 *
 * The instance cycle from sleep to sleep must hold, the attempt binding must be
 * enforced, and the failure paths must be terminal for the instance.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { contracts, core, instanceFixture, meta } from './lib/fixtures.mjs'

const M = meta()

test('an instance wakes, runs its attempt, settles, and sleeps again', () => {
  let instance = instanceFixture()
  const steps = [
    { to: 'waking', at: 1_000 },
    { to: 'running', at: 1_001, attemptId: 'A-1' },
    { to: 'settling', at: 1_002 },
    { to: 'sleeping', at: 1_003 },
  ]
  for (const step of steps) {
    const result = core.transitionAgentInstance(instance, step, M)
    assert.equal(result.ok, true, `→ ${step.to}: ${result.ok ? '' : result.error.message}`)
    instance = result.value.instance
    assert.equal(result.value.events[0].type, 'agent.instance.state.changed')
  }
  assert.equal(instance.state, 'sleeping')
  assert.equal(instance.attemptId, undefined, 'a sleeping instance holds no attempt')
  assert.equal(instance.since, 1_003)
})

test('the attempt binding of an instance state is enforced', () => {
  const waking = instanceFixture({ state: 'waking', since: 1_000 })
  const withoutAttempt = core.transitionAgentInstance(waking, { to: 'running', at: 1_001 }, M)
  assert.equal(withoutAttempt.ok, false)
  assert.equal(withoutAttempt.error.code, 'TASK_CONFLICT')
  assert.match(withoutAttempt.error.message, /without an attempt/)

  const running = instanceFixture({ state: 'running', since: 1_000, attemptId: 'A-1' })
  const settling = core.transitionAgentInstance(running, { to: 'settling', at: 1_001 }, M)
  assert.equal(settling.ok, true)
  assert.equal(settling.value.instance.attemptId, 'A-1', 'settling keeps the attempt it is winding down')

  const terminated = core.transitionAgentInstance(running, { to: 'terminated', at: 1_002 }, M)
  assert.equal(terminated.ok, true)
  assert.equal(terminated.value.instance.attemptId, undefined, 'a terminated instance holds no attempt')
})

test('every pair outside the transition table is refused with TASK_CONFLICT', () => {
  let refused = 0
  for (const from of contracts.AGENT_INSTANCE_STATES) {
    for (const to of contracts.AGENT_INSTANCE_STATES) {
      if (core.canTransitionAgentInstance(from, to)) continue
      const instance = instanceFixture({
        state: from,
        since: 1_000,
        ...(core.AGENT_INSTANCE_STATES_WITH_ATTEMPT.includes(from) ? { attemptId: 'A-1' } : {}),
      })
      const result = core.transitionAgentInstance(instance, { to, at: 2_000, attemptId: 'A-1' }, M)
      assert.equal(result.ok, false, `${from} → ${to} must be refused`)
      assert.equal(result.error.code, 'TASK_CONFLICT')
      refused += 1
    }
  }
  assert.ok(refused >= 20, `expected the sweep to cover the instance matrix, covered ${refused}`)
})

test('the failure states are terminal for an instance', () => {
  for (const state of ['failed', 'revoked', 'terminated']) {
    assert.deepEqual(core.allowedAgentInstanceTransitions(state), [])
    const result = core.transitionAgentInstance(instanceFixture({ state, since: 1_000 }), { to: 'waking', at: 2_000 }, M)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'TASK_CONFLICT')
  }
  assert.deepEqual(contracts.AGENT_INSTANCE_ACTIVE_STATES, ['waking', 'running', 'settling'])
})
