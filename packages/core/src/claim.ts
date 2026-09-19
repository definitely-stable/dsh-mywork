/**
 * Claim reconciliation: the pure decision §9 and §49 require (architecture §9,
 * §17, §49).
 *
 * Beads and MyWork DB have no shared transaction, so a claim that stopped
 * between its steps leaves an intent, a claim, and an attempt that may disagree.
 * The decision of what to do about that is pure, and it lives in the domain
 * layer rather than in an adapter, because the saga that must act on it is not
 * an adapter either: `@dsh-mywork/beads-adapter` re-exports these types so
 * existing callers keep working, and `@dsh-mywork/execution` decides with the
 * same function.
 *
 * The rule that shapes every branch: **never resolve on absent evidence.** An
 * unreadable graph leaves the intent alone instead of revoking a live attempt,
 * because revoking is destructive and "I could not read it" is not "it is gone".
 * @module
 */

import type { ClaimReconciliation, Task, TaskId } from '@dsh-mywork/contracts'

/** A claim MyWork recorded an intent for, and what the graph now says. */
export interface ClaimReconciliationInput {
  /** Task the intent names. */
  readonly taskId: TaskId
  /** Operation that recorded the intent. */
  readonly operationId: string
  /** Who the intent expected to claim the task. */
  readonly claimant: string
  /** Whether MyWork already created an attempt for this claim. */
  readonly attemptExists: boolean
  /** The task as the graph currently reports it, when it could be read. */
  readonly task?: Task
}

/**
 * Decide what to do about one claim intent.
 *
 * The decision is made from the graph's own view, because the graph is the
 * authority on who holds a task (§8): an attempt MyWork recorded but the graph
 * does not corroborate is exactly the discrepancy §9 requires a reconciler to
 * resolve, in one direction or the other. It never guesses — an unreadable task
 * leaves the intent alone rather than inventing a resolution.
 * @param input - the intent and what the graph says now.
 */
export function reconcileClaim(input: ClaimReconciliationInput): ClaimReconciliation {
  const task = input.task
  if (task === undefined) {
    // The task could not be read: do not resolve in either direction on absent
    // evidence, because revoking a live attempt is destructive. `undecided` says
    // exactly that, so a caller cannot mistake "I could not look" for "nothing to
    // do".
    return Object.freeze({
      action: 'undecided' as const,
      reason: 'the graph could not be read, so nothing is decided and the intent stays open',
    })
  }
  const assignee = assigneeOf(task)
  const holdsClaim = assignee === input.claimant

  if (holdsClaim && input.attemptExists) {
    return Object.freeze({ action: 'complete' as const, reason: 'claim and attempt agree' })
  }
  if (holdsClaim && !input.attemptExists) {
    return Object.freeze({
      action: 'create-attempt' as const,
      reason: `${input.claimant} holds the claim but MyWork has no attempt for it`,
    })
  }
  if (!holdsClaim && input.attemptExists) {
    return Object.freeze({
      action: 'revoke-claim' as const,
      reason: `the claim moved to "${assignee ?? 'nobody'}" while an attempt still exists`,
    })
  }
  return Object.freeze({
    action: 'abandon-intent' as const,
    reason: 'the claim is not held and no attempt was created; the intent never took effect',
  })
}

/**
 * The assignee a task carries, when it has one.
 *
 * The graph's holder is exposed through the adapter's own read; a task without
 * one is genuinely unheld rather than unknown.
 */
export function assigneeOf(task: Task): string | undefined {
  const holder = task.assignee
  return holder === undefined || holder === '' ? undefined : holder
}
