/**
 * The bridge from the platform token meter to the §30 charge (F-51, D05).
 *
 * Three things are pinned. **Every token number is a measurement**: the charge
 * carries `knownAmount(measurement.totalTokens)`, so a heuristic total is still
 * known and an empty surface is a measured zero rather than an unmeasured
 * amount. **A cost is priced only from a split that exists**: only a `usage`
 * baseline has input and output counts, so only it produces a cost, and an
 * unpriced route stays unknown instead of becoming free. **Nothing is counted
 * here**: two calls measure twice, and the numbers move with the meter rather
 * than with anything this module remembers.
 *
 * The controller is imported as a consumer receives it, and `DSH_HOME` is pinned
 * to `<repo>/.tmp` before the import so a live profile can never be reached.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

import { contracts, core, repoRoot } from './lib/fixtures.mjs'
import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'

scratchDshHome('budget-meter')
assertScratchHome()

/** The built controller, exactly as a deployment mounts it. */
const controller = await import(pathToFileURL(join(repoRoot, 'packages/controller/lib/index.js')).href)

/** The route every fixture prices, and its rate. */
const route = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }
const rate = { provider: route.provider, model: route.model, inputPerToken: 2, outputPerToken: 3 }

/** A measurement whose provider reported an input/output split. */
function usageMeasurement(overrides = {}) {
  return {
    logRevision: 42,
    baseline: { kind: 'usage', tokens: 1_500, usage: { inputTokens: 1_000, outputTokens: 500 } },
    surfaceDeltaTokens: 0,
    totalTokens: 1_500,
    surfaceTokens: 1_500,
    ...overrides,
  }
}

test('a measured session becomes a §30 charge, priced from the split the provider reported', () => {
  const charge = controller.bridgeMeasurement({ measurement: usageMeasurement(), route, rate })

  assert.deepEqual(charge.tokens, { kind: 'known', value: 1_500 }, 'the token number is the meter total')
  assert.deepEqual(charge.cost, { kind: 'known', value: 3_500 }, '1 000 × 2 + 500 × 3, through modelCallCost')
  assert.equal(charge.source, 'usage', 'the charge says which anchor it was measured from')
  assert.equal(charge.logRevision, 42, 'and which reading it came from')
  assert.ok(Object.isFrozen(charge))

  // It IS a BudgetCharge: the accounting §30 already has accepts it unchanged.
  const settled = core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, charge)
  assert.deepEqual(settled.consumption.tokens, { kind: 'known', value: 1_500 })
  assert.deepEqual(settled.consumption.cost, { kind: 'known', value: 3_500 })
  assert.equal(settled.consumption.attempts, 0, 'a measurement is not an attempt')
  assert.equal(settled.consumption.steps, 0, 'and not a step of the agent cycle')
})

test('a heuristic total is still known, an empty surface is a measured zero, and an unpriced route stays unknown', () => {
  const estimated = controller.bridgeMeasurement({
    measurement: usageMeasurement({ baseline: { kind: 'estimated', tokens: 1_234 }, totalTokens: 1_234, surfaceTokens: 1_234 }),
    route,
    rate,
  })
  assert.deepEqual(estimated.tokens, { kind: 'known', value: 1_234 }, 'an estimate is a reading, not a missing number')
  assert.equal(estimated.source, 'estimated')
  assert.equal(estimated.cost.kind, 'unknown', 'an unsplit total cannot be priced honestly')
  assert.match(estimated.cost.reason, /carries no input\/output split to price/)

  const empty = controller.bridgeMeasurement({
    measurement: {
      logRevision: 0,
      baseline: { kind: 'none', tokens: 0 },
      surfaceDeltaTokens: 0,
      totalTokens: 0,
      surfaceTokens: 0,
    },
    route,
    rate,
  })
  assert.deepEqual(empty.tokens, { kind: 'known', value: 0 }, 'an empty surface is a measured zero, not an unknown')
  assert.equal(empty.source, 'none')
  const settledZero = core.chargeConsumption(contracts.EMPTY_BUDGET_CONSUMPTION, empty)
  assert.deepEqual(
    settledZero.consumption.tokens,
    { kind: 'known', value: 0 },
    'the ledger records the measured zero instead of poisoning the token total',
  )

  const unpriced = controller.bridgeMeasurement({ measurement: usageMeasurement(), route })
  assert.equal(unpriced.cost.kind, 'unknown')
  assert.match(unpriced.cost.reason, /no rate is configured for route "opencode-go\/deepseek-v4.1-flash"/)
  assert.deepEqual(unpriced.tokens, { kind: 'known', value: 1_500 }, 'the token number does not depend on a rate')
})

test('the bridge counts nothing: every number is the meter reading taken on that call', () => {
  let calls = 0
  const plain = controller.createBudgetMeter({
    measure: (session) => {
      calls += 1
      assert.equal(session, 'session-1')
      return usageMeasurement({
        logRevision: calls,
        baseline: { kind: 'usage', tokens: 7, usage: { inputTokens: 7, outputTokens: 0 } },
        totalTokens: 7,
        surfaceTokens: 7,
      })
    },
  })

  const first = plain.chargeFor('session-1', { route, rate })
  const second = plain.chargeFor('session-1', { route, rate })
  assert.equal(calls, 2, 'each charge measures; nothing is cached, accumulated, or carried between calls')
  assert.deepEqual(first.tokens, { kind: 'known', value: 7 })
  assert.deepEqual(first.cost, { kind: 'known', value: 14 })
  assert.equal(first.logRevision, 1)
  assert.equal(second.logRevision, 2, 'the revision comes from the reading, not from a counter of ours')

  // The effective request envelope is forwarded, so the meter prices the surface
  // under the header the call actually runs with.
  let seen
  const echoing = controller.createBudgetMeter({
    measure: (_session, header) => {
      seen = header
      return usageMeasurement()
    },
  })
  echoing.chargeFor('session-1', { route, header: 'header-1' })
  assert.equal(seen, 'header-1')

  // An absent meter and a malformed reading are refused, never replaced with a
  // number this bridge would have to invent.
  assert.throws(() => controller.createBudgetMeter({}), /needs a token meter with a measure method/)
  assert.throws(
    () => controller.bridgeMeasurement({ measurement: usageMeasurement({ totalTokens: -1 }), route, rate }),
    /non-negative finite number/,
  )
  assert.throws(
    () => controller.bridgeMeasurement({ measurement: usageMeasurement(), route: { provider: 'other', model: 'model' }, rate }),
    /describes "opencode-go\/deepseek-v4.1-flash"/,
  )
})
