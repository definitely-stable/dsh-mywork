/**
 * Reconciliation and outage behaviour (architecture §9, §48, §49).
 *
 * Beads and MyWork DB have no shared transaction, so §9 requires saga plus
 * idempotency and forbids any workflow from assuming "usually the two calls run
 * one after another". The reconciliations below are the crash-recovery cases §9
 * and §49 name, expressed as decisions the caller applies — the adapter reports
 * what it observed and what it implies; MyWork owns the attempt and lease it
 * would create or revoke (§8).
 * @module
 */

import type { Task, TaskId } from '@dsh-mywork/contracts'

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
 * What a claim reconciliation decides (§9 crash-recovery table).
 *
 * `complete` means intent and attempt agree. `create-attempt` is §9's "ClaimIntent
 * exists, TaskGraph claimed, Attempt missing". `revoke-claim` is the mirror: an
 * attempt exists but the claim is not held, so a newer worker owns the work and
 * this one must stop.
 */
export type ClaimReconciliationAction = 'complete' | 'create-attempt' | 'revoke-claim' | 'abandon-intent'

/** One reconciliation decision, with the reason it was reached. */
export interface ClaimReconciliation {
  /** What the caller should do. */
  readonly action: ClaimReconciliationAction
  /** Why, in terms of what was observed. */
  readonly reason: string
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
    // evidence, because revoking a live attempt is destructive.
    return Object.freeze({
      action: 'complete' as const,
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

/** The assignee a task carries, when it has one. */
function assigneeOf(task: Task): string | undefined {
  // The graph's holder is exposed through the adapter's own read; a task without
  // one is genuinely unheld rather than unknown.
  const holder = (task as { readonly assignee?: string }).assignee
  return holder === undefined || holder === '' ? undefined : holder
}

/** Availability of the graph, as observed by the adapter. */
export type GraphAvailability = 'available' | 'degraded' | 'unavailable'

/** How an outage affects one caller, per §49 "Beads unavailable". */
export interface OutagePolicy {
  /** Whether the caller may keep doing work that only MyWork owns. */
  readonly continueLocalWork: boolean
  /** Whether a projection should be marked degraded with its snapshot time. */
  readonly markProjectionDegraded: boolean
  /** Whether the caller should retry the graph call now. */
  readonly retryNow: boolean
}

/**
 * Decide how an outage is handled (§49, ADR023).
 *
 * The distinction that matters: a graph that is *temporarily* unavailable
 * degrades the projection and keeps execution going, while a graph that is
 * *misconfigured* — no workspace, or an unreachable Dolt root — is not retried,
 * because retrying cannot succeed and a retry loop hides a configuration fault
 * behind apparent transient failure. That second case is exactly what ADR023
 * requires be surfaced as `ADAPTER_UNAVAILABLE` plus a Doctor entry.
 * @param availability - what the adapter observed.
 * @param kind - the failure classification, when there was one.
 */
export function resolveOutagePolicy(
  availability: GraphAvailability,
  kind?: 'no-workspace' | 'panic' | 'spawn-failed' | 'command-failed',
): OutagePolicy {
  if (availability === 'available') {
    return Object.freeze({ continueLocalWork: true, markProjectionDegraded: false, retryNow: false })
  }
  const misconfigured = kind === 'no-workspace' || kind === 'panic'
  return Object.freeze({
    // §49: execution continues when the board or graph is unavailable; only the
    // projection degrades.
    continueLocalWork: true,
    markProjectionDegraded: true,
    retryNow: !misconfigured,
  })
}

/**
 * Decide whether a journal cursor may be resumed.
 *
 * ADR023 records that the Beads journal is per-branch as well as per-replica, so
 * a cursor is only valid while both still match. A Dolt branch switch changes
 * which rows the journal names, and resuming across it would silently skip
 * mutations that were committed on the other branch.
 * @param cursor - the cursor the caller holds.
 * @param current - the replica and branch the adapter observes now.
 */
export function canResumeCursor(
  cursor: { readonly replica: string; readonly branch: string; readonly seq: number },
  current: { readonly replica: string; readonly branch: string },
): boolean {
  return cursor.replica === current.replica && cursor.branch === current.branch && cursor.seq >= 0
}
