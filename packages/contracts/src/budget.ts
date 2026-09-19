/**
 * Budgeting: the §30 limits and the admission decision they produce
 * (architecture §15, §30, §53, §62 item 38).
 *
 * §30 names eight limits and one outcome — exceeding any of them stops the work
 * and hands the decision to a pause, an escalation, or a human. This module
 * carries the limits and the shape of the decision; which of the three outcomes
 * a deployment applies is workflow policy and lives in the caller.
 *
 * Three rules are baked into the types rather than left to a caller's care:
 *
 * - **An unmeasured amount is not zero.** {@link BudgetAmount} has no default
 *   value: a cost nobody priced and a usage nobody reported are `unknown` with
 *   the reason attached, and the only way to read a number is to have matched
 *   `known`. Arithmetic over an unknown total stays unknown.
 * - **An unverifiable limit refuses.** When a charged dimension is unknown, or
 *   when the caller passed no ledger for the scope a declared limit governs, the
 *   admission is refused with the reason and the numbers — never admitted
 *   because the check could not be completed.
 * - **A declared limit that the request does not measure refuses too.** A
 *   request that charges no amount against a declared limit leaves the limit
 *   unverifiable, and an unmeasured charge is not a free one.
 * @module
 */

/**
 * One budget amount. `known` carries the number; `unknown` carries why it is not
 * known. There is deliberately no third state and no zero default: a consumer
 * that needs a number must handle the absence.
 */
export type BudgetAmount =
  | { readonly kind: 'known'; readonly value: number }
  | { readonly kind: 'unknown'; readonly reason: string }

/** What one scope has accumulated (§30, §53). */
export interface BudgetConsumption {
  /** Input plus output tokens spent, or unknown when a call's usage was never reported. */
  readonly tokens: BudgetAmount
  /** Cost spent, or unknown when a route had no price or a call reported no usage. */
  readonly cost: BudgetAmount
  /** Attempts admitted so far. Counted here, so it is always known. */
  readonly attempts: number
  /** Review loops entered so far. */
  readonly reviewLoops: number
  /** Planner calls made so far. */
  readonly plannerCalls: number
}

/** Consumption of a scope that has spent nothing yet. */
export const EMPTY_BUDGET_CONSUMPTION: BudgetConsumption = Object.freeze({
  tokens: Object.freeze({ kind: 'known', value: 0 }),
  cost: Object.freeze({ kind: 'known', value: 0 }),
  attempts: 0,
  reviewLoops: 0,
  plannerCalls: 0,
})

/** One §30 limit, named exactly as §30 names it. */
export type BudgetLimitName =
  /** Tokens one task may spend. */
  | 'maxTokensPerTask'
  /** Cost one task may spend. */
  | 'maxCostPerTask'
  /** Attempts one task may admit. */
  | 'maxAttempts'
  /** Review loops one task may enter. */
  | 'maxReviewLoops'
  /** Planner calls one task may make. */
  | 'maxPlannerCalls'
  /** Cost the optimizer may spend per day. */
  | 'maxOptimizerCostPerDay'
  /** Cost one workspace may spend per day. */
  | 'workspaceDailyBudget'
  /** Cost one provider may spend per day. */
  | 'providerDailyBudget'

/** Every limit §30 names, in its order. */
export const BUDGET_LIMIT_NAMES: readonly BudgetLimitName[] = Object.freeze([
  'maxTokensPerTask',
  'maxCostPerTask',
  'maxAttempts',
  'maxReviewLoops',
  'maxPlannerCalls',
  'maxOptimizerCostPerDay',
  'workspaceDailyBudget',
  'providerDailyBudget',
])

/** The scope one limit governs (§30: per task, per day, per provider). */
export type BudgetScope =
  /** Consumption of one task. */
  | 'task'
  /** Consumption of one workspace during one day. */
  | 'workspace-day'
  /** Consumption of the optimizer during one day. */
  | 'optimizer-day'
  /** Consumption of one provider during one day. */
  | 'provider-day'

/** Scope each §30 limit belongs to, keyed by the limit's §30 name. */
export const BUDGET_LIMIT_SCOPES: Readonly<Record<BudgetLimitName, BudgetScope>> = Object.freeze({
  maxTokensPerTask: 'task',
  maxCostPerTask: 'task',
  maxAttempts: 'task',
  maxReviewLoops: 'task',
  maxPlannerCalls: 'task',
  maxOptimizerCostPerDay: 'optimizer-day',
  workspaceDailyBudget: 'workspace-day',
  providerDailyBudget: 'provider-day',
})

/**
 * The §30 limits one scope declares. A limit that is absent is not declared, so
 * it is not checked — and a declared limit of `0` is a deliberate hard stop, not
 * an absent one.
 */
export interface BudgetLimits {
  /** {@link BudgetLimitName} `maxTokensPerTask`. */
  readonly maxTokensPerTask?: number
  /** {@link BudgetLimitName} `maxCostPerTask`. */
  readonly maxCostPerTask?: number
  /** {@link BudgetLimitName} `maxAttempts`. */
  readonly maxAttempts?: number
  /** {@link BudgetLimitName} `maxReviewLoops`. */
  readonly maxReviewLoops?: number
  /** {@link BudgetLimitName} `maxPlannerCalls`. */
  readonly maxPlannerCalls?: number
  /** {@link BudgetLimitName} `maxOptimizerCostPerDay`. */
  readonly maxOptimizerCostPerDay?: number
  /** {@link BudgetLimitName} `workspaceDailyBudget`. */
  readonly workspaceDailyBudget?: number
  /** {@link BudgetLimitName} `providerDailyBudget`. */
  readonly providerDailyBudget?: number
}

/** The unit of work an admission decision covers. */
export type BudgetRequestKind =
  /** One attempt of a task (charges `maxAttempts`). */
  | 'attempt'
  /** One model call inside an attempt (charges tokens and cost). */
  | 'model-call'
  /** One review loop of a task (charges `maxReviewLoops`). */
  | 'review-loop'
  /** One planner call of a task (charges `maxPlannerCalls`). */
  | 'planner-call'
  /** One optimizer run (charges `maxOptimizerCostPerDay`). */
  | 'optimizer-call'

/** Every request kind, in §30 order. */
export const BUDGET_REQUEST_KINDS: readonly BudgetRequestKind[] = Object.freeze([
  'attempt',
  'model-call',
  'review-loop',
  'planner-call',
  'optimizer-call',
])

/**
 * One pending admission and the charge it would add.
 *
 * `tokens` and `cost` are optional because a caller may not have an estimate.
 * Omitting one is **not** a claim that it costs nothing: a declared limit the
 * request does not measure is refused as unverifiable, so an omitted estimate
 * stalls work visibly instead of bypassing the limit.
 */
export interface BudgetRequest {
  /** What is being admitted. */
  readonly kind: BudgetRequestKind
  /** Tokens the work is expected to spend, as §53 accounts them. */
  readonly tokens?: BudgetAmount
  /** Cost the work is expected to spend, priced from the route's rate. */
  readonly cost?: BudgetAmount
}

/** What one scope has consumed, as the caller measured it. */
export interface BudgetLedger {
  /** Scope the consumption belongs to. */
  readonly scope: BudgetScope
  /** Consumption accumulated in that scope. */
  readonly consumption: BudgetConsumption
}

/** Everything one admission decision reads. */
export interface BudgetAdmissionInput {
  /** Declared §30 limits; an absent limit is not checked. */
  readonly limits: BudgetLimits
  /** Measured consumption per scope. A declared limit whose scope is missing is unverifiable. */
  readonly ledgers: readonly BudgetLedger[]
  /** The work being admitted and the charge it adds. */
  readonly request: BudgetRequest
}

/** Token counts one model call accounted for (§53). */
export interface ModelCallTokens {
  /** Input tokens the call sent. */
  readonly input: BudgetAmount
  /** Output tokens the call produced. */
  readonly output: BudgetAmount
}

/**
 * Cost of one exact route, in the unit the §30 cost limits are stated in. The
 * catalog does not publish prices — a provider may, an adapter need not — so the
 * rate is deployment configuration, and a route without one has an unknown cost
 * rather than a free one.
 */
export interface ModelRate {
  /** Provider route the rate belongs to. */
  readonly provider: string
  /** Model id the rate belongs to. */
  readonly model: string
  /** Cost of one input token. */
  readonly inputPerToken: number
  /** Cost of one output token. */
  readonly outputPerToken: number
}

/** Rates by route, keyed the way a policy states a route (`provider/model`). */
export type ModelRateTable = Readonly<Record<string, ModelRate>>

/** Why an admission stopped. */
export type BudgetRefusalReason =
  /** The charge would take the scope past its declared limit. */
  | 'limit-exceeded'
  /** The scope's consumption or the request's charge is unknown, so the limit cannot be verified. */
  | 'limit-unverifiable'
  /** The caller passed no ledger for the scope a declared limit governs. */
  | 'scope-not-measured'

/** Every refusal reason, so a caller can enumerate what it must handle. */
export const BUDGET_REFUSAL_REASONS: readonly BudgetRefusalReason[] = Object.freeze([
  'limit-exceeded',
  'limit-unverifiable',
  'scope-not-measured',
])

/** One declared limit the decision checked, with the numbers it read. */
export interface BudgetCheck {
  /** §30 limit that was checked. */
  readonly limit: BudgetLimitName
  /** Scope the limit governs. */
  readonly scope: BudgetScope
  /** The declared ceiling. */
  readonly declared: number
  /** Consumption the scope had accumulated. */
  readonly used: BudgetAmount
  /** Charge the request would add. */
  readonly requested: BudgetAmount
}

/** A check that stopped the admission, with the reason it stopped. */
export interface BudgetRefusal extends BudgetCheck {
  /** Why the admission was refused. */
  readonly reason: BudgetRefusalReason
}

/**
 * The §30 admission outcome. `admitted` carries every limit that was checked, so
 * a caller records what the decision was based on; `refused` names the first
 * limit that stopped it together with the numbers (§30 `BudgetExceeded`).
 */
export type BudgetDecision =
  | { readonly kind: 'admitted'; readonly checks: readonly BudgetCheck[] }
  | { readonly kind: 'refused'; readonly refusal: BudgetRefusal }
