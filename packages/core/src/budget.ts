/**
 * Budget policy (architecture §15, §30, §53, §62 item 38).
 *
 * Two things live here: the accounting that makes an unknown amount stay
 * unknown, and the admission gate that reads the §30 limits. Both are pure, so
 * the whole of §30 — including the exact boundary of a limit and the fail-closed
 * treatment of an unmeasurable charge — is decided without a provider, a clock,
 * or a store.
 *
 * The gate refuses, it does not repair: §30's three outcomes (pause, escalate,
 * human decision) are workflow policy, and choosing one of them here would
 * invent a fallback the architecture leaves to the caller.
 * @module
 */

import {
  BUDGET_LIMIT_NAMES,
  BUDGET_LIMIT_SCOPES,
  BUDGET_REQUEST_KINDS,
  type BudgetAdmissionInput,
  type BudgetAmount,
  type BudgetCheck,
  type BudgetConsumption,
  type BudgetDecision,
  type BudgetLedger,
  type BudgetLimitName,
  type BudgetRefusal,
  type BudgetRequest,
  type BudgetRequestKind,
  type BudgetScope,
  type ModelCallTokens,
  type ModelRate,
  type ModelRateTable,
  type ModelRoute,
} from '@dsh-mywork/contracts'

/** What one settlement adds to a scope's consumption. */
export interface BudgetCharge {
  /** Tokens the call spent; omitting it leaves the token total as it was. */
  readonly tokens?: BudgetAmount
  /** Cost the call spent; omitting it leaves the cost total as it was. */
  readonly cost?: BudgetAmount
  /** Attempts to add. */
  readonly attempts?: number
  /** Review loops to add. */
  readonly reviewLoops?: number
  /** Planner calls to add. */
  readonly plannerCalls?: number
}

/** One settled charge and the consumption it produced. */
export interface BudgetSettlement {
  /** Consumption after the charge: the recorded sum, dimension by dimension. */
  readonly consumption: BudgetConsumption
  /**
   * What the charge added. Every dimension is present, and one the caller did
   * not state is **unknown** rather than zero — see {@link chargeConsumption}.
   */
  readonly charged: BudgetConsumption
}

/** A measured amount. */
export function knownAmount(value: number): BudgetAmount {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`dsh-mywork: a budget amount must be a non-negative finite number, received ${String(value)}`)
  }
  return Object.freeze({ kind: 'known', value })
}

/** An amount nobody measured, with the reason it is not known. */
export function unknownAmount(reason: string): BudgetAmount {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new TypeError('dsh-mywork: an unknown budget amount must state why it is unknown')
  }
  return Object.freeze({ kind: 'unknown', reason })
}

/**
 * The number an amount carries, or `undefined` when it is unknown.
 *
 * There is no default: a caller that needs a number must decide what an unknown
 * one means for its own policy, which is exactly the decision this repository
 * refuses to make silently on its behalf.
 * @param amount - the amount to read.
 */
export function amountValue(amount: BudgetAmount): number | undefined {
  return amount.kind === 'known' ? amount.value : undefined
}

/**
 * Add two amounts. An unknown operand makes the sum unknown — an unmeasured
 * charge can never be absorbed into a total as if it were zero.
 * @param left - first amount.
 * @param right - second amount.
 */
export function addAmounts(left: BudgetAmount, right: BudgetAmount): BudgetAmount {
  if (left.kind === 'unknown') return left
  if (right.kind === 'unknown') return right
  return knownAmount(left.value + right.value)
}

/**
 * Record one settled charge in a scope's consumption.
 *
 * Counters add up exactly. Token and cost totals add through {@link addAmounts}.
 *
 * A dimension the charge omits is recorded as **unknown**, not as zero: omitting
 * a measurement is not a claim that the spend was nothing, and a ledger that
 * quietly added `0` there would let the next admission pass with a ceiling it
 * had already exceeded. A real zero is a measurement, so a caller that spent
 * nothing says `knownAmount(0)` — the same rule the gate applies to a pending
 * charge, where an unmeasured dimension is refused rather than assumed.
 *
 * Once such a dimension is unknown it stays unknown: {@link addAmounts} never
 * lets a later measured charge heal it, so the limit stays unverifiable until a
 * scope is measured afresh rather than appearing to recover.
 * @param consumption - consumption before the charge.
 * @param charge - what settled.
 * @returns the consumption after the charge and the charge itself, both frozen.
 * @throws {TypeError} when a counter is not a non-negative integer, or a stated amount is not a non-negative finite number.
 */
export function chargeConsumption(consumption: BudgetConsumption, charge: BudgetCharge): BudgetSettlement {
  if (charge.tokens !== undefined) requireAmount(charge.tokens, 'charge tokens')
  if (charge.cost !== undefined) requireAmount(charge.cost, 'charge cost')
  const attempts = requireCounter(charge.attempts ?? 0, 'attempts')
  const reviewLoops = requireCounter(charge.reviewLoops ?? 0, 'reviewLoops')
  const plannerCalls = requireCounter(charge.plannerCalls ?? 0, 'plannerCalls')
  const tokens = charge.tokens ?? unmeasured('tokens', 'charge')
  const cost = charge.cost ?? unmeasured('cost', 'charge')
  return Object.freeze({
    consumption: Object.freeze({
      tokens: addAmounts(consumption.tokens, tokens),
      cost: addAmounts(consumption.cost, cost),
      attempts: consumption.attempts + attempts,
      reviewLoops: consumption.reviewLoops + reviewLoops,
      plannerCalls: consumption.plannerCalls + plannerCalls,
    }),
    charged: Object.freeze({ tokens, cost, attempts, reviewLoops, plannerCalls }),
  })
}

/**
 * Read the tokens a provider reported for one call (§53).
 *
 * A call that reported no usage, or reported a value that is not a count of
 * tokens, produces an unknown amount with the reason attached: an unreported
 * usage is not a usage of zero, and treating it as one is how a token limit gets
 * silently outrun.
 * @param usage - the usage a provider reported, or `undefined` when it reported none.
 */
export function readCallTokens(usage: unknown): ModelCallTokens {
  if (usage === undefined || usage === null) {
    return Object.freeze({
      input: unknownAmount('the provider reported no usage for this call'),
      output: unknownAmount('the provider reported no usage for this call'),
    })
  }
  if (typeof usage !== 'object') {
    return Object.freeze({
      input: unknownAmount(`the provider reported usage as ${typeof usage}`),
      output: unknownAmount(`the provider reported usage as ${typeof usage}`),
    })
  }
  const record = usage as { readonly inputTokens?: unknown; readonly outputTokens?: unknown }
  return Object.freeze({
    input: tokenCount(record.inputTokens, 'inputTokens'),
    output: tokenCount(record.outputTokens, 'outputTokens'),
  })
}

/**
 * Price one call from its route's rate.
 *
 * A route with no rate has no cost — the result is unknown, not zero — and a
 * call whose token counts are not both known cannot be priced at all, because
 * the missing half would have to be charged as if it were free.
 * @param route - route the call ran on.
 * @param rate - the route's rate, or `undefined` when none is configured.
 * @param tokens - tokens the call accounted for.
 */
export function modelCallCost(route: ModelRoute, rate: ModelRate | undefined, tokens: ModelCallTokens): BudgetAmount {
  if (rate === undefined) {
    return unknownAmount(`no rate is configured for route "${route.provider}/${route.model}"`)
  }
  if (tokens.input.kind === 'unknown') return tokens.input
  if (tokens.output.kind === 'unknown') return tokens.output
  return knownAmount(tokens.input.value * rate.inputPerToken + tokens.output.value * rate.outputPerToken)
}

/**
 * The rate of one route in a rate table.
 * @param table - rates keyed as `provider/model`.
 * @param route - route to look up.
 */
export function modelRateOf(table: ModelRateTable, route: ModelRoute): ModelRate | undefined {
  const rate = table[`${route.provider}/${route.model}`]
  if (rate === undefined) return undefined
  requireRate(rate, route)
  return rate
}

/**
 * Decide whether one unit of work may be admitted under the §30 limits.
 *
 * Every declared limit the request charges is checked, in §30's order, and the
 * first one that stops the admission is reported with the numbers it read. The
 * boundary is inclusive: a charge that lands exactly on the ceiling is admitted,
 * and the next token, attempt, or unit of cost past it is not.
 *
 * A limit the request does not charge is not checked at all — an exhausted
 * attempt budget does not stop a review loop. A limit whose dimension the
 * request leaves unmeasured is refused as unverifiable, and so is one whose
 * scope the caller passed no ledger for.
 * @param input - declared limits, measured consumption per scope, and the pending request.
 * @throws {TypeError} when the limits, the ledgers, or the request are malformed.
 */
export function decideBudgetAdmission(input: BudgetAdmissionInput): BudgetDecision {
  const { limits, ledgers, request } = requireAdmissionInput(input)
  const checks: BudgetCheck[] = []
  for (const limit of BUDGET_LIMIT_NAMES) {
    const declared = limits[limit]
    if (declared === undefined) continue
    const charged = chargeOf(limit, request)
    if (charged === undefined) continue
    const scope = BUDGET_LIMIT_SCOPES[limit]
    const ledger = ledgers.find(candidate => candidate.scope === scope)
    if (ledger === undefined) {
      return refuse({ limit, scope, declared, used: unknownAmount(`no ledger was passed for scope "${scope}"`), requested: charged }, 'scope-not-measured')
    }
    const used = usedOf(limit, ledger.consumption)
    if (used.kind === 'unknown') return refuse({ limit, scope, declared, used, requested: charged }, 'limit-unverifiable')
    if (charged.kind === 'unknown') return refuse({ limit, scope, declared, used, requested: charged }, 'limit-unverifiable')
    if (used.value + charged.value > declared) {
      return refuse({ limit, scope, declared, used, requested: charged }, 'limit-exceeded')
    }
    checks.push(Object.freeze({ limit, scope, declared, used, requested: charged }))
  }
  return Object.freeze({ kind: 'admitted', checks: Object.freeze(checks) })
}

/** Build one refusal, with the check it is based on. */
function refuse(check: BudgetCheck, reason: BudgetRefusal['reason']): BudgetDecision {
  return Object.freeze({
    kind: 'refused',
    refusal: Object.freeze({
      limit: check.limit,
      scope: check.scope,
      declared: check.declared,
      used: check.used,
      requested: check.requested,
      reason,
    }),
  })
}

/**
 * What a request charges against one limit, or `undefined` when it charges
 * nothing and the limit therefore does not govern it.
 */
function chargeOf(limit: BudgetLimitName, request: BudgetRequest): BudgetAmount | undefined {
  switch (limit) {
    case 'maxAttempts':
      return request.kind === 'attempt' ? knownAmount(1) : undefined
    case 'maxReviewLoops':
      return request.kind === 'review-loop' ? knownAmount(1) : undefined
    case 'maxPlannerCalls':
      return request.kind === 'planner-call' ? knownAmount(1) : undefined
    case 'maxOptimizerCostPerDay':
      return request.kind === 'optimizer-call' ? request.cost ?? unmeasured('cost', 'request') : undefined
    case 'maxTokensPerTask':
      return request.tokens ?? unmeasured('tokens', 'request')
    case 'maxCostPerTask':
    case 'workspaceDailyBudget':
    case 'providerDailyBudget':
      return request.cost ?? unmeasured('cost', 'request')
    default:
      return undefined
  }
}

/** The charge a caller failed to measure for one dimension. */
function unmeasured(dimension: 'tokens' | 'cost', what: 'request' | 'charge'): BudgetAmount {
  const subject = what === 'request' ? 'the request' : 'the charge'
  return unknownAmount(`${subject} measured no ${dimension}, so the limit cannot be verified`)
}

/** What one scope has consumed in the dimension one limit governs. */
function usedOf(limit: BudgetLimitName, consumption: BudgetConsumption): BudgetAmount {
  switch (limit) {
    case 'maxTokensPerTask':
      return consumption.tokens
    case 'maxCostPerTask':
    case 'maxOptimizerCostPerDay':
    case 'workspaceDailyBudget':
    case 'providerDailyBudget':
      return consumption.cost
    case 'maxAttempts':
      return knownAmount(consumption.attempts)
    case 'maxReviewLoops':
      return knownAmount(consumption.reviewLoops)
    case 'maxPlannerCalls':
      return knownAmount(consumption.plannerCalls)
    default:
      return unknownAmount(`limit "${limit}" is not known to this build`)
  }
}

/** Validate one admission input; a malformed one is a programming error, not a refusal. */
function requireAdmissionInput(input: BudgetAdmissionInput): BudgetAdmissionInput {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('dsh-mywork: a budget admission input must be an object')
  }
  const { limits, ledgers, request } = input
  if (limits === null || typeof limits !== 'object') {
    throw new TypeError('dsh-mywork: budget limits must be an object')
  }
  // The shape is closed for the same reason the §13 shapes are: `maxTokensPerTask`
  // misspelled as `maxTokensPerTasks` would otherwise read as "no limit declared",
  // and the work it was meant to bound would be admitted unchecked.
  //
  // The check reads own names AND the prototype chain, because a misspelling is
  // just as invisible one level up: an object inheriting `maxTokensPerTasks` is
  // still an object that declares no limit this build knows, while an inherited
  // *valid* name would be applied by the loop below without ever having been
  // checked. Anything but a plain object is refused outright for the same reason.
  requirePlainLimits(limits)
  for (const name of Object.getOwnPropertyNames(limits)) {
    if (!BUDGET_LIMIT_NAMES.includes(name as BudgetLimitName)) {
      throw new TypeError(`dsh-mywork: §30 declares no budget limit "${name}"`)
    }
  }
  for (const name in limits) {
    if (!BUDGET_LIMIT_NAMES.includes(name as BudgetLimitName)) {
      throw new TypeError(`dsh-mywork: §30 declares no budget limit "${name}"`)
    }
  }
  for (const limit of BUDGET_LIMIT_NAMES) {
    const declared = limits[limit]
    if (declared === undefined) continue
    if (!Number.isFinite(declared) || declared < 0) {
      throw new TypeError(
        `dsh-mywork: ${limit} must be a non-negative finite number, received ${String(declared)}`,
      )
    }
  }
  requireLedgers(ledgers)
  requireRequest(request)
  return input
}

/**
 * Require a plain limits object: no array, no class instance, no inherited
 * fields.
 *
 * "Plain" is judged by identity with this realm's `Object.prototype`, so a value
 * carrying a prototype is refused rather than read: its inherited names would
 * otherwise be either invisible to the closed-shape check or applied without one.
 * @param limits - the value to check.
 * @throws {TypeError} when it is not a plain object.
 */
function requirePlainLimits(limits: object): void {
  if (Array.isArray(limits)) {
    throw new TypeError('dsh-mywork: budget limits must be a plain object, received an array')
  }
  const prototype = Object.getPrototypeOf(limits)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('dsh-mywork: budget limits must be a plain object, without a prototype of its own')
  }
}

/** Validate the ledgers: at most one per scope, each a measured consumption. */function requireLedgers(ledgers: readonly BudgetLedger[]): readonly BudgetLedger[] {
  if (!Array.isArray(ledgers)) {
    throw new TypeError('dsh-mywork: budget ledgers must be an array')
  }
  const seen = new Set<BudgetScope>()
  for (const ledger of ledgers) {
    if (ledger === null || typeof ledger !== 'object' || typeof ledger.scope !== 'string') {
      throw new TypeError('dsh-mywork: a budget ledger must state its scope')
    }
    if (seen.has(ledger.scope)) {
      throw new TypeError(`dsh-mywork: scope "${ledger.scope}" has more than one ledger`)
    }
    seen.add(ledger.scope)
    requireConsumption(ledger.consumption, ledger.scope)
  }
  return ledgers
}

/** Validate one consumption: the amounts are well formed and the counters are counts. */
function requireConsumption(consumption: BudgetConsumption, scope: string): BudgetConsumption {
  if (consumption === null || typeof consumption !== 'object') {
    throw new TypeError(`dsh-mywork: scope "${scope}" must carry a consumption`)
  }
  requireAmount(consumption.tokens, `scope "${scope}" tokens`)
  requireAmount(consumption.cost, `scope "${scope}" cost`)
  requireCounter(consumption.attempts, `scope "${scope}" attempts`)
  requireCounter(consumption.reviewLoops, `scope "${scope}" reviewLoops`)
  requireCounter(consumption.plannerCalls, `scope "${scope}" plannerCalls`)
  return consumption
}

/** Validate one amount and the numbers it may carry. */
function requireAmount(amount: BudgetAmount, label: string): BudgetAmount {
  if (amount === null || typeof amount !== 'object') {
    throw new TypeError(`dsh-mywork: ${label} must be a budget amount`)
  }
  // Read the discriminant as an unknown so a value from outside the type system
  // is described instead of silently narrowed away.
  const kind: unknown = (amount as { readonly kind?: unknown }).kind
  if (kind === 'known') {
    knownAmount((amount as { readonly value: number }).value)
    return amount
  }
  if (kind === 'unknown') {
    unknownAmount((amount as { readonly reason: string }).reason)
    return amount
  }
  throw new TypeError(`dsh-mywork: ${label} must be known or unknown, received ${describe(kind)}`)
}

/** Validate one request: a known kind, with well formed amounts when it states them. */
function requireRequest(request: BudgetRequest): BudgetRequest {
  if (request === null || typeof request !== 'object') {
    throw new TypeError('dsh-mywork: a budget request must be an object')
  }
  if (!BUDGET_REQUEST_KINDS.includes(request.kind as BudgetRequestKind)) {
    throw new TypeError(`dsh-mywork: a budget request kind must be one of §30's, received ${String(request.kind)}`)
  }
  if (request.tokens !== undefined) requireAmount(request.tokens, 'request tokens')
  if (request.cost !== undefined) requireAmount(request.cost, 'request cost')
  return request
}

/** Validate one rate table entry against the route it claims to price. */
function requireRate(rate: ModelRate, route: ModelRoute): ModelRate {
  if (rate.provider !== route.provider || rate.model !== route.model) {
    throw new TypeError(
      `dsh-mywork: the rate for "${route.provider}/${route.model}" describes "${rate.provider}/${rate.model}"`,
    )
  }
  for (const [name, value] of [['inputPerToken', rate.inputPerToken], ['outputPerToken', rate.outputPerToken]] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`dsh-mywork: ${name} must be a non-negative finite number, received ${String(value)}`)
    }
  }
  return rate
}

/** Read one reported token count, or explain why it is not a count. */
function tokenCount(value: unknown, label: string): BudgetAmount {
  if (value === undefined) return unknownAmount(`the provider reported no ${label}`)
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return unknownAmount(`the provider reported ${label} as ${describe(value)}`)
  }
  return knownAmount(value)
}

/** Validate a counter and return it. */
function requireCounter(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`dsh-mywork: ${label} must be a non-negative integer, received ${String(value)}`)
  }
  return value
}

/** Short description of a value that failed validation. */
function describe(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return 'an array'
  return typeof value
}
