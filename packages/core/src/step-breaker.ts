/**
 * The step circuit-breaker of one agent cycle (F-53, D05, RT-2).
 *
 * **What a step is** — recorded here because a step ceiling without a definition
 * is a number nobody can obey: *a step is one round of the agent cycle inside one
 * attempt — the agent presents its context to the model, consumes the answer, and
 * takes at most one follow-up action from it.* It is neither an attempt (an
 * attempt spans many steps) nor a model call in the §53 sense (one step may
 * produce several). The counter is therefore per attempt, and the ceiling is the
 * ceiling R-16 states: 60 steps per attempt.
 *
 * The breaker decides exactly one thing — whether the next step may run — and it
 * decides it through the mechanisms that already exist rather than beside them:
 * `maxSteps` is a §30 limit name ({@link BudgetLimitName}), the counter is
 * `BudgetConsumption.steps`, and the decision is
 * `@dsh-mywork/core` `decideBudgetAdmission`'s. There is no second counter, no
 * parallel ceiling, and no second refusal shape: a step past the ceiling comes
 * back as the same `BudgetDecision` every other §30 limit produces.
 *
 * **The reset rule, and why it is explicit.** A step counter belongs to one
 * attempt, so a new attempt starts from zero — and a caller has to say that it is
 * starting one (`newAttempt: true`) for it to happen. Carrying the previous
 * attempt's count over would stop a task that retried on the step ceiling of a
 * cycle it is not running, which is the failure mode this rule exists to make
 * impossible to hit by accident.
 * @module
 */

import {
  EMPTY_BUDGET_CONSUMPTION,
  type BudgetConsumption,
  type BudgetDecision,
  type BudgetLimits,
} from '@dsh-mywork/contracts'
import { decideBudgetAdmission } from './budget.ts'

/** Everything {@link stepBudget} reads. */
export interface StepBreakerInput {
  /**
   * The limits in force. Only `maxSteps` is read: the token and cost ceilings
   * govern work this breaker does not measure, and re-deciding them here with no
   * measurement would refuse every step as unverifiable rather than check a step.
   */
  readonly limits: BudgetLimits
  /** Steps of the agent cycle already taken in the attempt this step extends. */
  readonly steps: number
  /**
   * Set when this step is the **first of a new attempt**: the counter starts over
   * (F-53's reset rule). Absent means "the same attempt as the previous step".
   */
  readonly newAttempt?: boolean
}

/**
 * Decide whether the next step of the agent cycle may run.
 *
 * The boundary is §30's: a step that lands exactly on the ceiling is admitted and
 * the one past it is refused as `limit-exceeded`, with the numbers the decision
 * read.
 * @param input - the declared limits, the steps taken in this attempt, and whether a new attempt begins.
 * @returns the admission decision of the next step, built by the §30 gate.
 * @throws {TypeError} when the input, the step count, or the limits are malformed.
 */
export function stepBudget(input: StepBreakerInput): BudgetDecision {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('dsh-mywork: a step breaker input must be an object')
  }
  if (input.limits === null || typeof input.limits !== 'object') {
    throw new TypeError('dsh-mywork: a step breaker needs the limits it decides against')
  }
  const steps = input.newAttempt === true ? 0 : requireSteps(input.steps)
  const declared = input.limits.maxSteps
  const consumption: BudgetConsumption = Object.freeze({ ...EMPTY_BUDGET_CONSUMPTION, steps })
  return decideBudgetAdmission({
    limits: declared === undefined ? Object.freeze({}) : Object.freeze({ maxSteps: declared }),
    ledgers: Object.freeze([Object.freeze({ scope: 'task' as const, consumption })]),
    request: Object.freeze({ kind: 'step' as const }),
  })
}

/**
 * The steps a new attempt starts from: zero, and only through {@link stepBudget}
 * with `newAttempt: true`.
 * @returns zero, as the count of a cycle that has not taken a step yet.
 */
export function stepsOfNewAttempt(): number {
  return 0
}

/** Validate one step count; a count that is not a count is a programming error. */
function requireSteps(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`dsh-mywork: steps must be a non-negative integer, received ${String(value)}`)
  }
  return value
}
