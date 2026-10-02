/**
 * §30 defaults and the outcome of a refusal (F-52, D05, R-16).
 *
 * Two claims are pinned here. **The values**: 60 steps and 2 000 000 tokens per
 * attempt are canon (R-16), and every limit that has a default has an explicit
 * number — a limit this build means not to check is absent, never silently
 * `undefined`. **The behaviour**: every default value is a ceiling the gate
 * actually reads, and a refusal becomes `needs-attention` with the refusal as its
 * cause and `retry: false` — §30 hands the decision to a human, so nothing in
 * this tree retries a refused attempt on its own.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { contracts, core } from './lib/fixtures.mjs'

/** A task ledger carrying the given consumption. */
function taskLedger(overrides = {}) {
  return { scope: 'task', consumption: { ...contracts.EMPTY_BUDGET_CONSUMPTION, ...overrides } }
}

/**
 * The request that charges one limit and the consumption that sits exactly on
 * its ceiling: one more unit of either the work or the charge is the refusal.
 */
function atCeiling(limit, value) {
  switch (limit) {
    case 'maxSteps':
      return { request: { kind: 'step' }, consumption: { steps: value } }
    case 'maxAttempts':
      return { request: { kind: 'attempt' }, consumption: { attempts: value } }
    case 'maxReviewLoops':
      return { request: { kind: 'review-loop' }, consumption: { reviewLoops: value } }
    case 'maxPlannerCalls':
      return { request: { kind: 'planner-call' }, consumption: { plannerCalls: value } }
    case 'maxTokensPerTask':
      return { request: { kind: 'model-call', tokens: core.knownAmount(1) }, consumption: { tokens: core.knownAmount(value) } }
    default:
      return { request: { kind: 'model-call', cost: core.knownAmount(1) }, consumption: { cost: core.knownAmount(value) } }
  }
}

test('the defaults state the canon values, and every other value is stated rather than hidden', () => {
  const defaults = core.DEFAULT_BUDGET_LIMITS

  // CANON (R-16, 01-MASTER-PLAN §16, D05): 60 steps and 2 000 000 tokens per
  // attempt. A divergence here is a defect, not a setting.
  assert.equal(defaults.maxSteps, 60)
  assert.equal(defaults.maxTokensPerTask, 2_000_000)

  // The five limits F-52 names carry a default, and each is a positive ceiling
  // rather than a zero that would stop all work on mount.
  for (const limit of ['maxAttempts', 'maxReviewLoops', 'maxPlannerCalls', 'maxTokensPerTask', 'maxCostPerTask']) {
    assert.equal(typeof defaults[limit], 'number', `${limit} must have a default`)
    assert.ok(defaults[limit] > 0, `${limit} must be a deliberate ceiling, not a zero`)
  }

  // Deliberately absent: the three per-day ceilings. Their scopes have no ledger
  // in this build, and the gate refuses a declared limit whose scope was never
  // measured — so defaulting them would refuse every admission.
  for (const limit of ['maxOptimizerCostPerDay', 'workspaceDailyBudget', 'providerDailyBudget']) {
    assert.equal(defaults[limit], undefined, `${limit} must not be defaulted`)
  }
  assert.ok(Object.isFrozen(defaults), 'the values in force are not editable in place')

  // A deployment replaces them key by key, and an absent or undefined key keeps
  // the default rather than erasing the ceiling.
  assert.deepEqual(core.budgetLimitsFrom(), defaults, 'no config means the defaults themselves')
  assert.deepEqual(
    core.budgetLimitsFrom({ maxSteps: 5, maxCostPerTask: 3 }),
    { ...defaults, maxSteps: 5, maxCostPerTask: 3 },
  )
  assert.deepEqual(core.budgetLimitsFrom({ maxSteps: undefined }), defaults)
  assert.ok(Object.isFrozen(core.budgetLimitsFrom()))

  // A misspelled limit must not read as "no limit declared" — the same rule the
  // gate applies to the limits it is handed.
  assert.throws(() => core.budgetLimitsFrom({ maxStep: 5 }), /declares no budget limit "maxStep"/)
  assert.throws(() => core.budgetLimitsFrom({ maxSteps: -1 }), /non-negative finite number/)
  assert.throws(() => core.budgetLimitsFrom({ maxAttempts: Number.NaN }), /non-negative finite number/)
})

test('every declared default is a ceiling the gate reads, and exhaustion refuses instead of passing unchecked', () => {
  const defaults = core.DEFAULT_BUDGET_LIMITS
  const reached = new Set()

  for (const [limit, declared] of Object.entries(defaults)) {
    const { request, consumption } = atCeiling(limit, declared)
    const decision = core.decideBudgetAdmission({ limits: { [limit]: declared }, ledgers: [taskLedger(consumption)], request })
    assert.equal(decision.kind, 'refused', `${limit} must stop work that reaches its default ceiling`)
    assert.equal(decision.refusal.limit, limit)
    assert.equal(decision.refusal.scope, contracts.BUDGET_LIMIT_SCOPES[limit], `${limit} must be read from its own scope ledger`)
    assert.equal(decision.refusal.reason, 'limit-exceeded', `${limit} must not pass as "limit not checked"`)
    assert.equal(decision.refusal.declared, declared)
    reached.add(limit)
  }
  // Guard the loop: a scan that iterated nothing would pass vacuously.
  assert.equal(reached.size, Object.keys(defaults).length)
  assert.ok(reached.has('maxSteps') && reached.has('maxTokensPerTask') && reached.has('maxCostPerTask'))

  // Every key at once is a legal declaration: the shape is closed, and the gate
  // reads the set the deployment will actually run with.
  const whole = core.decideBudgetAdmission({
    limits: defaults,
    ledgers: [taskLedger()],
    request: { kind: 'attempt', tokens: core.knownAmount(0), cost: core.knownAmount(0) },
  })
  assert.equal(whole.kind, 'admitted')
  assert.deepEqual(
    whole.checks.map(check => check.limit).sort(),
    ['maxAttempts', 'maxCostPerTask', 'maxTokensPerTask'],
    'an attempt charges the attempt, token, and cost ceilings and nothing else',
  )

  // A step inside the step ceiling is admitted — decided against the step ceiling
  // alone. Handing the gate the whole default set instead refuses, because a step
  // measures no tokens and a declared token ceiling it cannot measure is
  // unverifiable (§30's fail-closed rule); that is why `stepBudget` narrows the
  // limits it reads rather than re-deciding a ceiling it cannot measure.
  const narrowed = core.decideBudgetAdmission({
    limits: defaults,
    ledgers: [taskLedger({ steps: 59 })],
    request: { kind: 'step' },
  })
  assert.equal(narrowed.kind, 'refused')
  assert.equal(narrowed.refusal.limit, 'maxTokensPerTask')
  assert.equal(narrowed.refusal.reason, 'limit-unverifiable')

  const inside = core.decideBudgetAdmission({
    limits: { maxSteps: 60 },
    ledgers: [taskLedger({ steps: 59 })],
    request: { kind: 'step' },
  })
  assert.equal(inside.kind, 'admitted')
  assert.deepEqual(inside.checks, [{
    limit: 'maxSteps',
    scope: 'task',
    declared: 60,
    used: { kind: 'known', value: 59 },
    requested: { kind: 'known', value: 1 },
  }])
})

test('a refusal becomes needs-attention with the refusal as its cause, never a silent retry', () => {
  const decision = core.decideBudgetAdmission({
    limits: core.DEFAULT_BUDGET_LIMITS,
    ledgers: [taskLedger({ attempts: 8 })],
    request: { kind: 'attempt', tokens: core.knownAmount(1_000), cost: core.knownAmount(1) },
  })
  assert.equal(decision.kind, 'refused')

  const outcome = core.budgetOutcome(decision)
  assert.equal(outcome.kind, 'needs-attention')
  assert.equal(outcome.needsAttention, 'budget-exhausted')
  assert.deepEqual(outcome.cause, decision.refusal, 'the refusal is the reason the card shows')
  assert.equal(outcome.cause.limit, 'maxAttempts')
  assert.equal(outcome.retry, false, '§30 hands a refusal to a human, so nothing retries it')
  assert.ok(Object.isFrozen(outcome))
  // The trigger and the state are the ones the tree already names: a §5.7
  // trigger for a budget that ran out, and a legal task transition to it.
  assert.ok(contracts.NEEDS_ATTENTION_REASONS.includes(outcome.needsAttention))
  assert.ok(core.canTransitionTask('executing', 'needs-attention'))

  const admitted = core.budgetOutcome(
    core.decideBudgetAdmission({ limits: { maxSteps: 3 }, ledgers: [taskLedger({ steps: 2 })], request: { kind: 'step' } }),
  )
  assert.equal(admitted.kind, 'admitted')
  assert.deepEqual(admitted.checks, [{
    limit: 'maxSteps',
    scope: 'task',
    declared: 3,
    used: { kind: 'known', value: 2 },
    requested: { kind: 'known', value: 1 },
  }])

  assert.throws(() => core.budgetOutcome({ kind: 'maybe' }), TypeError)
  assert.throws(() => core.budgetOutcome(undefined), TypeError)
})
