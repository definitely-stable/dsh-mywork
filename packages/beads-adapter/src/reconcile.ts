/**
 * Reconciliation and outage behaviour (architecture §9, §48, §49).
 *
 * Beads and MyWork DB have no shared transaction, so §9 requires saga plus
 * idempotency and forbids any workflow from assuming "usually the two calls run
 * one after another". The reconciliations below are the crash-recovery cases §9
 * and §49 name, expressed as decisions the caller applies — the adapter reports
 * what it observed and what it implies; MyWork owns the attempt and lease it
 * would create or revoke (§8).
 *
 * The claim decision itself is not implemented here. It is a pure domain
 * function of the graph's own view, and the saga that acts on it lives in
 * `@dsh-mywork/execution`, so it lives in `@dsh-mywork/core` and this module
 * re-exports it: two private copies of one rule would eventually disagree, and
 * the one that disagreed would be the one revoking a live attempt.
 * @module
 */

export {
  assigneeOf,
  reconcileClaim,
  type ClaimReconciliationInput,
} from '@dsh-mywork/core'

export type { ClaimReconciliation, ClaimReconciliationAction } from '@dsh-mywork/contracts'

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
