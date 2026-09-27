/**
 * The §30 limits a deployment runs with when it declares none of its own, and
 * what a refusal means for the work it stopped (F-52, D05).
 *
 * Today the gate checks only what a scope declares, and a limit nobody declares
 * is not checked at all (`budget.ts`: "A limit the request does not charge is not
 * checked at all"), so a fresh deployment admits unbounded work. This module is
 * the missing half: a value per limit, and a decided outcome when one runs out.
 *
 * **Which values are canon.** R-16 (`01-MASTER-PLAN.md` §16, D05) fixes exactly
 * two: **60 steps and 2 000 000 tokens per attempt**. They are marked `CANON`
 * below and a divergence from them is a defect, not a setting. Every other value
 * is a **PROPOSAL** this card could not settle: the owner picks the real numbers
 * (D05), and {@link budgetLimitsFrom} exists so a deployment replaces any of them
 * without editing this file. No value is hidden — each constant says what it is.
 *
 * **Which limits have no default.** The three per-day ceilings
 * (`maxOptimizerCostPerDay`, `workspaceDailyBudget`, `providerDailyBudget`) are
 * deliberately absent. Each governs a scope whose ledger this build does not
 * produce, and the gate refuses a declared limit whose scope was not measured
 * (`scope-not-measured`) — so defaulting them would refuse **every** admission
 * with a limit nobody can measure. A deployment that keeps those ledgers
 * declares them through {@link budgetLimitsFrom}.
 *
 * **What a refusal means.** §30 hands the decision to a pause, an escalation, or
 * a human, and this module chooses the third for every refusal: the work does
 * not retry itself. {@link budgetOutcome} turns a `refused` decision into
 * `needs-attention` with the §5.7 trigger `budget-exhausted` and the
 * {@link BudgetRefusal} as the cause, and states `retry: false` in the type so a
 * caller cannot read a refusal as "try again".
 * @module
 */

import {
  BUDGET_LIMIT_NAMES,
  type BudgetCheck,
  type BudgetDecision,
  type BudgetLimitName,
  type BudgetLimits,
  type BudgetRefusal,
} from '@dsh-mywork/contracts'

/**
 * The limits a deployment runs with when it declares none.
 *
 * Two are canon (R-16, D05) and four are proposals awaiting the owner's D05
 * confirmation. The object is frozen and every value is stated explicitly, so
 * `undefined` here can only mean "this build means not to check it".
 */
export const DEFAULT_BUDGET_LIMITS: BudgetLimits = Object.freeze({
  /** CANON (R-16): 60 steps of the agent cycle per attempt. */
  maxSteps: 60,
  /** CANON (R-16): 2 000 000 tokens per attempt. */
  maxTokensPerTask: 2_000_000,
  /**
   * PROPOSAL (D05, owner confirmation required): 8 attempts per task. Retries
   * plus one review loop fit inside it, and a runaway loop stops on the eighth.
   */
  maxAttempts: 8,
  /**
   * PROPOSAL (D05, owner confirmation required): 4 review loops per task — one
   * more round of "changes requested" than a healthy task ever needs.
   */
  maxReviewLoops: 4,
  /**
   * PROPOSAL (D05, owner confirmation required): 12 planner calls per task.
   * Re-planning is occasional; a task that re-plans twelve times is stuck.
   */
  maxPlannerCalls: 12,
  /**
   * PROPOSAL (D05, owner confirmation required): 25 cost units per task, in the
   * unit `ModelRate` prices in — the deployment's own cost unit. With the rate
   * shape this build documents (cost per single token) that is 25 major units; a
   * deployment whose rates are per million tokens must say so in its rates or
   * override this value, because a ceiling in the wrong unit stops the work it
   * was meant to protect.
   */
  maxCostPerTask: 25,
})

/**
 * The defaults with a deployment's overrides applied.
 *
 * A key the caller leaves absent — or states as `undefined` — keeps its default.
 * A key this build does not know is refused rather than ignored: §30's names are
 * a closed shape, and `maxTokensPerTasks` silently reading as "no limit" is the
 * failure the gate's own closed-shape check exists to prevent.
 * @param config - the deployment's limits; absent means "the defaults as they are".
 * @returns the effective limits, frozen.
 * @throws {TypeError} when a key is not a §30 limit name, or a value is not a non-negative finite number.
 */
export function budgetLimitsFrom(config: BudgetLimits = {}): BudgetLimits {
  if (config === null || typeof config !== 'object') {
    throw new TypeError('dsh-mywork: budget limits must be an object')
  }
  requireKnownLimitNames(config)
  const effective = { ...DEFAULT_BUDGET_LIMITS } as Record<BudgetLimitName, number | undefined>
  for (const limit of BUDGET_LIMIT_NAMES) {
    const declared = config[limit]
    if (declared === undefined) continue
    if (!Number.isFinite(declared) || declared < 0) {
      throw new TypeError(`dsh-mywork: ${limit} must be a non-negative finite number, received ${String(declared)}`)
    }
    effective[limit] = declared
  }
  return Object.freeze(effective as BudgetLimits)
}

/**
 * What a caller must do with one admission decision.
 *
 * `admitted` carries the checks the decision read, exactly as the gate returned
 * them. `needs-attention` is §30's outcome for this build: the work stops, the
 * board shows why, and no automatic retry happens — `retry` is `false` by type,
 * not by convention, so a caller cannot schedule one without saying so itself.
 */
export type BudgetOutcome =
  | { readonly kind: 'admitted'; readonly checks: readonly BudgetCheck[] }
  | {
      /** The work stops and a human decides. */
      readonly kind: 'needs-attention'
      /** §5.7 trigger the card records; the catalogue already names this one. */
      readonly needsAttention: 'budget-exhausted'
      /** The refusal, as the cause the card and the log carry. */
      readonly cause: BudgetRefusal
      /** §30 hands a refusal to a human, so this build never retries on its own. */
      readonly retry: false
    }

/**
 * Turn one admission decision into the outcome the workflow applies.
 * @param decision - the decision of `decideBudgetAdmission`.
 * @returns the outcome, frozen; a refusal never carries a retry.
 * @throws {TypeError} when the decision is not one the gate produces.
 */
export function budgetOutcome(decision: BudgetDecision): BudgetOutcome {
  if (decision === null || typeof decision !== 'object') {
    throw new TypeError('dsh-mywork: a budget outcome needs an admission decision')
  }
  if (decision.kind === 'admitted') {
    return Object.freeze({ kind: 'admitted', checks: decision.checks })
  }
  if (decision.kind === 'refused') {
    return Object.freeze({
      kind: 'needs-attention',
      needsAttention: 'budget-exhausted',
      cause: decision.refusal,
      retry: false,
    })
  }
  // The union is exhausted for a caller inside the type system; a value from
  // outside it is described rather than narrowed away, the way the gate reads
  // the discriminant of an amount.
  const kind: unknown = (decision as { readonly kind?: unknown }).kind
  throw new TypeError(`dsh-mywork: a budget decision is admitted or refused, received ${String(kind)}`)
}

/** Refuse a limit name this build does not know, own or inherited. */
function requireKnownLimitNames(config: object): void {
  for (const name of Object.getOwnPropertyNames(config)) {
    if (!BUDGET_LIMIT_NAMES.includes(name as BudgetLimitName)) {
      throw new TypeError(`dsh-mywork: §30 declares no budget limit "${name}"`)
    }
  }
  for (const name in config) {
    if (!BUDGET_LIMIT_NAMES.includes(name as BudgetLimitName)) {
      throw new TypeError(`dsh-mywork: §30 declares no budget limit "${name}"`)
    }
  }
}
