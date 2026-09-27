/**
 * Budget admission acceptance (architecture §30, §53, §62 item 38).
 *
 * The suite pins the two rules that decide whether §30 can be trusted: a limit
 * admits a charge that lands exactly on its ceiling and refuses the next unit,
 * and nothing unmeasured is ever read as zero — an unreported usage, an unpriced
 * route, an unmeasured charge, or a scope the caller never measured all stop the
 * admission with the reason that stopped it.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { contracts, core } from './lib/fixtures.mjs'

/** One admission decision, spelled the way the caller spells it. */
function decide(input) {
  return core.decideBudgetAdmission(input)
}

/** A task ledger carrying the given consumption. */
function taskLedger(overrides = {}) {
  return { scope: 'task', consumption: { ...contracts.EMPTY_BUDGET_CONSUMPTION, ...overrides } }
}

/** A ledger of one scope with the given consumption. */
function ledger(scope, overrides = {}) {
  return { scope, consumption: { ...contracts.EMPTY_BUDGET_CONSUMPTION, ...overrides } }
}

/** The request that charges one §30 limit, used to prove every limit is reachable. */
function chargeFor(limit) {
  switch (limit) {
    case 'maxAttempts':
      return { kind: 'attempt' }
    case 'maxReviewLoops':
      return { kind: 'review-loop' }
    case 'maxPlannerCalls':
      return { kind: 'planner-call' }
    case 'maxSteps':
      return { kind: 'step' }
    case 'maxTokensPerTask':
      return { kind: 'model-call', tokens: core.knownAmount(1) }
    case 'maxOptimizerCostPerDay':
      return { kind: 'optimizer-call', cost: core.knownAmount(1) }
    default:
      return { kind: 'model-call', cost: core.knownAmount(1) }
  }
}

test('an unmeasured amount is unknown with its reason, never zero', () => {
  assert.deepEqual(core.knownAmount(7), { kind: 'known', value: 7 })
  assert.deepEqual(core.unknownAmount('the provider reported no usage'), {
    kind: 'unknown',
    reason: 'the provider reported no usage',
  })
  assert.equal(core.amountValue(core.unknownAmount('not measured')), undefined)
  assert.equal(core.amountValue(core.knownAmount(0)), 0)

  const sum = core.addAmounts(core.knownAmount(5), core.unknownAmount('not measured'))
  assert.deepEqual(sum, { kind: 'unknown', reason: 'not measured' }, 'an unknown operand poisons the total')
  assert.deepEqual(core.addAmounts(core.knownAmount(5), core.knownAmount(2)), { kind: 'known', value: 7 })

  assert.throws(() => core.knownAmount(-1), TypeError)
  assert.throws(() => core.knownAmount(Number.NaN), TypeError)
  assert.throws(() => core.unknownAmount('   '), TypeError)
})

test('a call whose usage nobody reported leaves the token total unknown', () => {
  const none = core.readCallTokens(undefined)
  assert.equal(none.input.kind, 'unknown')
  assert.equal(none.output.kind, 'unknown')
  assert.match(none.input.reason, /reported no usage/)

  const partial = core.readCallTokens({ inputTokens: 10 })
  assert.deepEqual(partial.input, { kind: 'known', value: 10 })
  assert.equal(partial.output.kind, 'unknown')
  assert.match(partial.output.reason, /reported no outputTokens/)

  const invalid = core.readCallTokens({ inputTokens: 'ten', outputTokens: -3 })
  assert.equal(invalid.input.kind, 'unknown')
  assert.equal(invalid.output.kind, 'unknown')
  assert.match(invalid.input.reason, /reported inputTokens as string/)
  assert.match(invalid.output.reason, /reported outputTokens as -3/)

  const settled = core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, {
    tokens: core.addAmounts(none.input, none.output),
  })
  assert.equal(settled.consumption.tokens.kind, 'unknown')
  assert.notEqual(core.amountValue(settled.consumption.tokens), 0, 'an unreported usage is not a usage of zero')
  assert.equal(
    settled.consumption.cost.kind,
    'unknown',
    'a dimension the charge omits is recorded as unknown, not left as a measured zero',
  )
  assert.match(settled.consumption.cost.reason, /the charge measured no cost/)
})

test('a route without a rate has an unknown cost, and an unknown count cannot be priced', () => {
  const route = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }
  const rate = { provider: route.provider, model: route.model, inputPerToken: 2, outputPerToken: 3 }
  const tokens = { input: core.knownAmount(1_000), output: core.knownAmount(500) }

  assert.equal(core.amountValue(core.modelCallCost(route, rate, tokens)), 3_500)
  assert.equal(core.modelRateOf({ 'opencode-go/deepseek-v4.1-flash': rate }, route), rate)
  assert.equal(core.modelRateOf({}, route), undefined)

  const unpriced = core.modelCallCost(route, undefined, tokens)
  assert.equal(unpriced.kind, 'unknown')
  assert.match(unpriced.reason, /no rate is configured for route "opencode-go\/deepseek-v4.1-flash"/)

  const unmeasured = core.modelCallCost(route, rate, core.readCallTokens(undefined))
  assert.equal(unmeasured.kind, 'unknown')
  assert.match(unmeasured.reason, /reported no usage/)

  assert.throws(
    () => core.modelRateOf({ 'p/m': { provider: 'q', model: 'm', inputPerToken: 1, outputPerToken: 1 } }, { provider: 'p', model: 'm' }),
    TypeError,
  )
})

test('a token limit admits a charge that lands exactly on the ceiling and refuses the next token', () => {
  const limits = { maxTokensPerTask: 1_000 }

  const exact = decide({
    limits,
    ledgers: [taskLedger({ tokens: core.knownAmount(999) })],
    request: { kind: 'model-call', tokens: core.knownAmount(1) },
  })
  assert.equal(exact.kind, 'admitted')
  assert.deepEqual(exact.checks, [{
    limit: 'maxTokensPerTask',
    scope: 'task',
    declared: 1_000,
    used: { kind: 'known', value: 999 },
    requested: { kind: 'known', value: 1 },
  }])

  const past = decide({
    limits,
    ledgers: [taskLedger({ tokens: core.knownAmount(1_000) })],
    request: { kind: 'model-call', tokens: core.knownAmount(1) },
  })
  assert.equal(past.kind, 'refused')
  assert.deepEqual(past.refusal, {
    limit: 'maxTokensPerTask',
    scope: 'task',
    declared: 1_000,
    used: { kind: 'known', value: 1_000 },
    requested: { kind: 'known', value: 1 },
    reason: 'limit-exceeded',
  })

  const idle = decide({
    limits,
    ledgers: [taskLedger({ tokens: core.knownAmount(1_000) })],
    request: { kind: 'model-call', tokens: core.knownAmount(0) },
  })
  assert.equal(idle.kind, 'admitted', 'a spent budget still admits a charge that adds nothing')
})

test('an attempt limit admits the attempt that lands on the ceiling and refuses the one past it', () => {
  const limits = { maxAttempts: 8 }

  const eighth = decide({ limits, ledgers: [taskLedger({ attempts: 7 })], request: { kind: 'attempt' } })
  assert.equal(eighth.kind, 'admitted')
  assert.deepEqual(eighth.checks, [{
    limit: 'maxAttempts',
    scope: 'task',
    declared: 8,
    used: { kind: 'known', value: 7 },
    requested: { kind: 'known', value: 1 },
  }])

  const ninth = decide({ limits, ledgers: [taskLedger({ attempts: 8 })], request: { kind: 'attempt' } })
  assert.equal(ninth.kind, 'refused')
  assert.equal(ninth.refusal.reason, 'limit-exceeded')
  assert.deepEqual(ninth.refusal.used, { kind: 'known', value: 8 })

  // A limit governs the work it counts and nothing else: an exhausted attempt
  // budget does not stop a review loop, which has a limit of its own.
  const review = decide({
    limits,
    ledgers: [taskLedger({ attempts: 8 })],
    request: { kind: 'review-loop' },
  })
  assert.equal(review.kind, 'admitted')
  assert.deepEqual(review.checks, [])

  const loops = decide({
    limits: { maxReviewLoops: 2 },
    ledgers: [taskLedger({ reviewLoops: 2 })],
    request: { kind: 'review-loop' },
  })
  assert.equal(loops.kind, 'refused')
  assert.equal(loops.refusal.limit, 'maxReviewLoops')

  const planner = decide({
    limits: { maxPlannerCalls: 1 },
    ledgers: [taskLedger({ plannerCalls: 1 })],
    request: { kind: 'planner-call' },
  })
  assert.equal(planner.kind, 'refused')
  assert.equal(planner.refusal.limit, 'maxPlannerCalls')

  // F-53: the agent cycle's step ceiling is the same mechanism with its own
  // counter, decided by the same gate and recorded in the same ledger.
  const steppedOnce = core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, { steps: 1 }).consumption
  const secondStep = decide({
    limits: { maxSteps: 3 },
    ledgers: [{ scope: 'task', consumption: steppedOnce }],
    request: { kind: 'step' },
  })
  assert.equal(secondStep.kind, 'admitted')
  assert.deepEqual(secondStep.checks, [{
    limit: 'maxSteps',
    scope: 'task',
    declared: 3,
    used: { kind: 'known', value: 1 },
    requested: { kind: 'known', value: 1 },
  }])

  const pastTheCeiling = decide({
    limits: { maxSteps: 3 },
    ledgers: [{ scope: 'task', consumption: core.chargeConsumption(steppedOnce, { steps: 2 }).consumption }],
    request: { kind: 'step' },
  })
  assert.equal(pastTheCeiling.kind, 'refused')
  assert.equal(pastTheCeiling.refusal.limit, 'maxSteps')
  assert.equal(pastTheCeiling.refusal.reason, 'limit-exceeded')
  assert.deepEqual(pastTheCeiling.refusal.used, { kind: 'known', value: 3 })

  // A step is not an attempt: an exhausted attempt ceiling does not stop a step,
  // exactly as an exhausted attempt ceiling does not stop a review loop.
  const stepPastAttempts = decide({
    limits: { maxAttempts: 1 },
    ledgers: [taskLedger({ attempts: 9 })],
    request: { kind: 'step' },
  })
  assert.equal(stepPastAttempts.kind, 'admitted')
  assert.deepEqual(stepPastAttempts.checks, [])
})

test('a declared limit the request does not measure is refused, not treated as free', () => {
  const unmeasuredCost = decide({
    limits: { maxCostPerTask: 10 },
    ledgers: [taskLedger()],
    request: { kind: 'model-call' },
  })
  assert.equal(unmeasuredCost.kind, 'refused')
  assert.equal(unmeasuredCost.refusal.reason, 'limit-unverifiable')
  assert.equal(unmeasuredCost.refusal.requested.kind, 'unknown')
  assert.match(unmeasuredCost.refusal.requested.reason, /the request measured no cost/)
  assert.deepEqual(unmeasuredCost.refusal.used, { kind: 'known', value: 0 })

  // The same rule on the token half: a token limit nobody measured is not a
  // token limit that passed. Both halves are separate branches, so both need
  // their own test.
  const unmeasuredTokens = decide({
    limits: { maxTokensPerTask: 10 },
    ledgers: [taskLedger()],
    request: { kind: 'model-call' },
  })
  assert.equal(unmeasuredTokens.kind, 'refused')
  assert.equal(unmeasuredTokens.refusal.reason, 'limit-unverifiable')
  assert.equal(unmeasuredTokens.refusal.limit, 'maxTokensPerTask')
  assert.match(unmeasuredTokens.refusal.requested.reason, /the request measured no tokens/)

  // Even a ceiling of zero does not admit an unmeasured request: the refusal is
  // "cannot be verified", not "adds nothing".
  const zeroCeiling = decide({
    limits: { maxTokensPerTask: 0 },
    ledgers: [taskLedger()],
    request: { kind: 'model-call' },
  })
  assert.equal(zeroCeiling.kind, 'refused')
  assert.equal(zeroCeiling.refusal.reason, 'limit-unverifiable')

  const unconstrained = decide({ limits: {}, ledgers: [], request: { kind: 'model-call' } })
  assert.equal(unconstrained.kind, 'admitted', 'with no declared limit there is nothing to verify')
  assert.deepEqual(unconstrained.checks, [])
})

test('a settlement never reports a measurement it was not given', () => {
  const settled = core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, { attempts: 1 })

  assert.deepEqual(settled.consumption, {
    ...contracts.EMPTY_BUDGET_CONSUMPTION,
    attempts: 1,
    tokens: { kind: 'unknown', reason: 'the charge measured no tokens, so the limit cannot be verified' },
    cost: { kind: 'unknown', reason: 'the charge measured no cost, so the limit cannot be verified' },
  })
  assert.equal(
    core.amountValue(settled.charged.tokens),
    undefined,
    'the attempt said nothing about tokens, so the charge must not claim a measured zero',
  )
  assert.equal(core.amountValue(settled.charged.cost), undefined)
  assert.equal(settled.charged.attempts, 1)

  // A real zero is a measurement, so it has to be stated: this is the only way
  // to record a settlement that genuinely spent nothing.
  const statedZero = core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, {
    tokens: core.knownAmount(0),
    cost: core.knownAmount(0),
    attempts: 1,
  })
  assert.equal(core.amountValue(statedZero.charged.tokens), 0)
  assert.equal(core.amountValue(statedZero.consumption.tokens), 0)

  // F-53: a step is a count like the others, so omitting it adds none and stating
  // it adds exactly that many — never "unknown", because nobody measures a count.
  const stepped = core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, { steps: 3 })
  assert.equal(stepped.consumption.steps, 3)
  assert.equal(stepped.charged.steps, 3)
  assert.equal(stepped.consumption.attempts, 0, 'a step is not an attempt')
  assert.equal(stepped.consumption.tokens.kind, 'unknown', 'the charge still states no token measurement')

  const measured = core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, {
    tokens: core.knownAmount(7),
    cost: core.unknownAmount('no rate'),
  })
  assert.deepEqual(measured.charged.tokens, { kind: 'known', value: 7 })
  assert.deepEqual(measured.charged.cost, { kind: 'unknown', reason: 'no rate' })
  assert.equal(measured.consumption.tokens.kind, 'known')
  assert.equal(measured.consumption.cost.kind, 'unknown', 'an unknown charge still poisons its own dimension')
})

test('an unmeasured settlement cannot be laundered by a later measured admission', () => {
  // The attempt was admitted without anyone measuring its tokens. That spend is
  // in the past and no gate can refuse it retroactively — so the LEDGER has to
  // remember it, or the next call walks through a ceiling already exceeded.
  const afterAttempt = core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, { attempts: 1 }).consumption
  assert.equal(core.amountValue(afterAttempt.tokens), undefined)

  const laterCall = decide({
    limits: { maxTokensPerTask: 1_000 },
    ledgers: [{ scope: 'task', consumption: afterAttempt }],
    request: { kind: 'model-call', tokens: core.knownAmount(200) },
  })
  assert.equal(laterCall.kind, 'refused')
  assert.equal(laterCall.refusal.reason, 'limit-unverifiable')
  assert.equal(laterCall.refusal.used.kind, 'unknown')
  assert.match(laterCall.refusal.used.reason, /the charge measured no tokens/)

  // Same shape one phase later: a token limit declared after the fact still
  // refuses, because the earlier spend was never recorded as a number.
  const declaredLater = decide({
    limits: { maxTokensPerTask: 1_000 },
    ledgers: [{ scope: 'task', consumption: afterAttempt }],
    request: { kind: 'attempt' },
  })
  assert.equal(declaredLater.kind, 'refused')
  assert.equal(declaredLater.refusal.reason, 'limit-unverifiable')

  // And the guard the other way: a scope measured honestly stays measurable.
  const measured = core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, {
    tokens: core.knownAmount(100),
    cost: core.knownAmount(1),
    attempts: 1,
  }).consumption
  const admitted = decide({
    limits: { maxTokensPerTask: 1_000, maxAttempts: 8 },
    ledgers: [{ scope: 'task', consumption: measured }],
    request: { kind: 'model-call', tokens: core.knownAmount(200), cost: core.knownAmount(1) },
  })
  assert.equal(admitted.kind, 'admitted')
  assert.deepEqual(admitted.checks[0].used, { kind: 'known', value: 100 })
})

test('an unknown total makes its limit unverifiable even when the request measures itself', () => {
  const route = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }
  const unpriced = core.modelCallCost(route, undefined, {
    input: core.knownAmount(10),
    output: core.knownAmount(10),
  })
  const consumption = core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, { cost: unpriced }).consumption

  const decision = decide({
    limits: { maxCostPerTask: 5 },
    ledgers: [{ scope: 'task', consumption }],
    request: { kind: 'model-call', cost: core.knownAmount(1) },
  })
  assert.equal(decision.kind, 'refused')
  assert.equal(decision.refusal.reason, 'limit-unverifiable')
  assert.equal(decision.refusal.used.kind, 'unknown')
  assert.match(decision.refusal.used.reason, /no rate is configured/)
})

test('a limit whose scope the caller never measured is refused', () => {
  const decision = decide({
    limits: { workspaceDailyBudget: 10 },
    ledgers: [taskLedger()],
    request: { kind: 'model-call', cost: core.knownAmount(1) },
  })
  assert.equal(decision.kind, 'refused')
  assert.equal(decision.refusal.reason, 'scope-not-measured')
  assert.equal(decision.refusal.scope, 'workspace-day')
  assert.equal(decision.refusal.limit, 'workspaceDailyBudget')
  assert.equal(decision.refusal.used.kind, 'unknown')
})

test('a declared limit of zero is a hard stop, not an absent limit', () => {
  const decision = decide({ limits: { maxAttempts: 0 }, ledgers: [taskLedger()], request: { kind: 'attempt' } })
  assert.equal(decision.kind, 'refused')
  assert.equal(decision.refusal.declared, 0)
  assert.equal(decision.refusal.reason, 'limit-exceeded')
})

test('the per-day scopes are checked against their own ledgers', () => {
  const ledgers = [
    ledger('provider-day', { cost: core.knownAmount(4) }),
    ledger('optimizer-day', { cost: core.knownAmount(3) }),
  ]

  const provider = decide({
    limits: { providerDailyBudget: 5 },
    ledgers,
    request: { kind: 'model-call', cost: core.knownAmount(1) },
  })
  assert.equal(provider.kind, 'admitted', '4 + 1 lands exactly on the provider ceiling')

  const optimizer = decide({
    limits: { maxOptimizerCostPerDay: 3 },
    ledgers,
    request: { kind: 'optimizer-call', cost: core.knownAmount(1) },
  })
  assert.equal(optimizer.kind, 'refused')
  assert.equal(optimizer.refusal.limit, 'maxOptimizerCostPerDay')
  assert.equal(optimizer.refusal.scope, 'optimizer-day')

  const ordinaryCall = decide({
    limits: { maxOptimizerCostPerDay: 3 },
    ledgers,
    request: { kind: 'model-call', cost: core.knownAmount(100) },
  })
  assert.equal(ordinaryCall.kind, 'admitted', 'the optimizer budget does not govern an ordinary model call')
})

test('every §30 limit is declared, scoped, and actually read by the gate', () => {
  // §30's eight names, in §30's order, plus the agent cycle's own ceiling (D05,
  // F-52/F-53) — the ninth limit, in the same vocabulary rather than beside it.
  assert.deepEqual([...contracts.BUDGET_LIMIT_NAMES], [
    'maxTokensPerTask',
    'maxCostPerTask',
    'maxAttempts',
    'maxReviewLoops',
    'maxPlannerCalls',
    'maxOptimizerCostPerDay',
    'workspaceDailyBudget',
    'providerDailyBudget',
    'maxSteps',
  ])
  assert.deepEqual(
    Object.keys(contracts.BUDGET_LIMIT_SCOPES).sort(),
    [...contracts.BUDGET_LIMIT_NAMES].sort(),
    'the scope table must cover every limit, or a limit would be checked against the wrong ledger',
  )

  const reached = new Set()
  for (const limit of contracts.BUDGET_LIMIT_NAMES) {
    const scope = contracts.BUDGET_LIMIT_SCOPES[limit]
    const decision = decide({
      limits: { [limit]: 0 },
      ledgers: [ledger(scope)],
      request: chargeFor(limit),
    })
    assert.equal(decision.kind, 'refused', `${limit} must be refused by a zero ceiling`)
    assert.equal(decision.refusal.limit, limit)
    assert.equal(decision.refusal.scope, scope)
    assert.equal(decision.refusal.reason, 'limit-exceeded')
    reached.add(limit)
  }
  assert.equal(reached.size, contracts.BUDGET_LIMIT_NAMES.length)
})

test('a priced run is stopped by its own ceiling, with the reason and the numbers', () => {
  const route = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }
  const rate = { provider: route.provider, model: route.model, inputPerToken: 2, outputPerToken: 3 }
  const cost = core.modelCallCost(route, rate, core.readCallTokens({ inputTokens: 100, outputTokens: 100 }))
  assert.equal(core.amountValue(cost), 500)

  const limits = { maxCostPerTask: 500 }
  const first = decide({ limits, ledgers: [taskLedger()], request: { kind: 'model-call', cost } })
  assert.equal(first.kind, 'admitted', 'the first call lands exactly on the ceiling')

  const afterFirst = core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, { cost }).consumption
  const second = decide({
    limits,
    ledgers: [{ scope: 'task', consumption: afterFirst }],
    request: { kind: 'model-call', cost },
  })
  assert.equal(second.kind, 'refused')
  assert.deepEqual(second.refusal, {
    limit: 'maxCostPerTask',
    scope: 'task',
    declared: 500,
    used: { kind: 'known', value: 500 },
    requested: { kind: 'known', value: 500 },
    reason: 'limit-exceeded',
  })
})

test('a malformed limit, ledger, or request fails loud', () => {
  assert.throws(() => decide({ limits: { maxAttempts: -1 }, ledgers: [], request: { kind: 'attempt' } }), TypeError)
  assert.throws(() => decide({ limits: { maxCostPerTask: Number.NaN }, ledgers: [], request: { kind: 'model-call' } }), TypeError)
  // A misspelled limit must not read as "no limit declared": §30's names are a
  // closed shape, exactly like the §13 shapes.
  assert.throws(
    () => decide({ limits: { maxTokensPerTasks: 0 }, ledgers: [], request: { kind: 'model-call' } }),
    /declares no budget limit "maxTokensPerTasks"/,
  )
  // One level up is the same object as far as this check is concerned: an
  // inherited misspelling would be just as invisible, and an inherited valid
  // name would be applied without ever passing the check.
  assert.throws(
    () => decide({ limits: Object.create({ maxTokensPerTasks: 0 }), ledgers: [], request: { kind: 'model-call' } }),
    /plain object/,
  )
  assert.throws(
    () => decide({ limits: Object.create({ maxTokensPerTask: 0 }), ledgers: [], request: { kind: 'model-call' } }),
    /plain object/,
    'an inherited valid limit must be refused too, not silently applied',
  )
  assert.throws(() => decide({ limits: [], ledgers: [], request: { kind: 'model-call' } }), /plain object/)
  assert.throws(() => decide({ limits: {}, ledgers: [taskLedger(), taskLedger()], request: { kind: 'attempt' } }), /more than one ledger/)
  assert.throws(() => decide({ limits: {}, ledgers: [{ scope: 'task' }], request: { kind: 'attempt' } }), TypeError)
  assert.throws(() => decide({ limits: {}, ledgers: [], request: { kind: 'side-quest' } }), TypeError)
  assert.throws(
    () => decide({ limits: {}, ledgers: [], request: { kind: 'model-call', tokens: { kind: 'maybe', value: 1 } } }),
    TypeError,
  )
  assert.throws(
    () => decide({ limits: {}, ledgers: [taskLedger({ attempts: 1.5 })], request: { kind: 'attempt' } }),
    TypeError,
  )
  assert.throws(() => core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, { reviewLoops: -1 }), TypeError)
  // F-53: the step counter is validated like every other counter, on both sides.
  assert.throws(() => core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, { steps: -1 }), TypeError)
  assert.throws(() => core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, { steps: 1.5 }), TypeError)
  assert.throws(() => decide({ limits: {}, ledgers: [taskLedger({ steps: 1.5 })], request: { kind: 'step' } }), TypeError)
})
