/**
 * The step circuit-breaker of one agent cycle (F-53, D05, RT-2).
 *
 * The ceiling has to mean something, so the suite pins both halves: a fourth
 * step past a ceiling of three is refused by the §30 gate with the numbers it
 * read (not by a second counter beside it), and the counter starts over on a new
 * attempt **only** when the caller says so — carrying it over would stop a task
 * that retried on the step ceiling of a cycle it is not running.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { core } from './lib/fixtures.mjs'

test('the step past the ceiling is refused by the §30 gate, with the numbers it read', () => {
  const limits = { maxSteps: 3 }

  const third = core.stepBudget({ limits, steps: 2 })
  assert.equal(third.kind, 'admitted')
  assert.deepEqual(third.checks, [{
    limit: 'maxSteps',
    scope: 'task',
    declared: 3,
    used: { kind: 'known', value: 2 },
    requested: { kind: 'known', value: 1 },
  }])

  const fourth = core.stepBudget({ limits, steps: 3 })
  assert.equal(fourth.kind, 'refused')
  assert.equal(fourth.refusal.reason, 'limit-exceeded')
  assert.equal(fourth.refusal.limit, 'maxSteps')
  assert.equal(fourth.refusal.scope, 'task')
  assert.equal(fourth.refusal.declared, 3)
  assert.deepEqual(fourth.refusal.used, { kind: 'known', value: 3 })
  assert.deepEqual(fourth.refusal.requested, { kind: 'known', value: 1 })

  // No declared ceiling is no ceiling: the breaker invents neither a value nor a
  // refusal, exactly as the gate leaves an undeclared limit unchecked.
  assert.equal(core.stepBudget({ limits: {}, steps: 10_000 }).kind, 'admitted')

  // The breaker reads the step ceiling and nothing else: a token ceiling governs
  // work it does not measure, and re-deciding it here with no measurement would
  // refuse every step as unverifiable instead of checking a step.
  const withTokenCeiling = core.stepBudget({ limits: { maxTokensPerTask: 10, maxSteps: 3 }, steps: 1 })
  assert.equal(withTokenCeiling.kind, 'admitted')
  assert.deepEqual(withTokenCeiling.checks.map(check => check.limit), ['maxSteps'])

  // A count that is not a count, or a ceiling that is not one, fails loud.
  assert.throws(() => core.stepBudget({ limits, steps: 1.5 }), TypeError)
  assert.throws(() => core.stepBudget({ limits, steps: -1 }), TypeError)
  assert.throws(() => core.stepBudget({ limits: { maxSteps: -1 }, steps: 0 }), TypeError)
  assert.throws(() => core.stepBudget({ limits: undefined, steps: 0 }), TypeError)
  assert.throws(() => core.stepBudget(undefined), TypeError)
})

test('the counter starts over on a new attempt, and only when the caller says so', () => {
  const limits = { maxSteps: 3 }

  const carried = core.stepBudget({ limits, steps: 3 })
  assert.equal(carried.kind, 'refused', 'without the reset the cycle stops on the carried count')

  const fresh = core.stepBudget({ limits, steps: 3, newAttempt: true })
  assert.equal(fresh.kind, 'admitted', 'a new attempt starts the count over')
  assert.deepEqual(fresh.checks[0].used, { kind: 'known', value: 0 })
  assert.deepEqual(fresh.checks[0].requested, { kind: 'known', value: 1 })

  // The reset is a statement about the attempt, not about every call: an
  // explicit `false`, or an absent flag, keeps counting.
  assert.equal(core.stepBudget({ limits, steps: 3, newAttempt: false }).kind, 'refused')

  // The canon ceiling (R-16): 60 steps per attempt, and the 61st needs a new
  // attempt — which is the whole reason a long task can finish at all.
  const canon = core.DEFAULT_BUDGET_LIMITS
  assert.equal(core.stepBudget({ limits: canon, steps: 59 }).kind, 'admitted')
  assert.equal(core.stepBudget({ limits: canon, steps: 60 }).kind, 'refused')
  assert.equal(core.stepBudget({ limits: canon, steps: 60, newAttempt: true }).kind, 'admitted')
  assert.equal(core.stepsOfNewAttempt(), 0)
})
