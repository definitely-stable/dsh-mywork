/**
 * Review state machine (architecture §18.3, §19) as pure transitions.
 *
 * Two rules from §13.2 and §19 are enforced here rather than left to caller
 * discipline: a review of a worker's own attempt is refused with
 * `SECURITY_DENIED`, and an approval is bound to the artefact the reviewer saw,
 * so a later head SHA invalidates it with `STALE_REVISION`.
 *
 * The returned review is frozen at the top level only: `artifact` and `findings`
 * keep their identity, so nested immutability is a contract of the domain
 * rather than a runtime guarantee.
 * @module
 */

import {
  REVIEW_TERMINAL_STATES,
  type AgentId,
  type DomainEvent,
  type EpochMs,
  type OperationMeta,
  type Permission,
  type Result,
  type Review,
  type ReviewFindings,
  type ReviewState,
  type ReviewedArtifact,
  type Revision,
} from '@dsh-mywork/contracts'
import { MyWorkError, fail, ok } from './errors.ts'
import { assertRevision } from './guards.ts'

/**
 * Allowed review transitions (§18.3).
 *
 * - Main line: `queued → claimed → reviewing → approved`.
 * - `needs-evidence` may return to `reviewing` once the evidence arrives.
 * - `approved`, `rejected`, `escalated`, and `cancelled` are terminal.
 */
export const REVIEW_TRANSITIONS: Readonly<Record<ReviewState, readonly ReviewState[]>> = Object.freeze({
  queued: ['claimed', 'cancelled'],
  claimed: ['reviewing', 'cancelled'],
  reviewing: ['approved', 'rejected', 'needs-evidence', 'escalated', 'cancelled'],
  'needs-evidence': ['reviewing', 'rejected', 'escalated', 'cancelled'],
  approved: [],
  rejected: [],
  escalated: [],
  cancelled: [],
})

/** Target states that require recorded findings. */
export const REVIEW_STATES_REQUIRING_FINDINGS: readonly ReviewState[] = Object.freeze(['rejected', 'needs-evidence'])

/** Command accepted by {@link transitionReview}. */
export interface ReviewTransitionCommand {
  /** Target state. */
  readonly to: ReviewState
  /** Revision the caller observed; a mismatch is `STALE_REVISION`. */
  readonly expectedRevision?: Revision
  /** Artefact the review refers to; required for `approved`. */
  readonly artifact?: ReviewedArtifact
  /** Findings; required for `rejected` and `needs-evidence`. */
  readonly findings?: ReviewFindings
  /**
   * Agent identity of the worker whose attempt is reviewed. Required for
   * `approved`, because independence cannot be proven without it.
   */
  readonly workerAgentId?: AgentId
  /**
   * Permissions the reviewer holds. When provided, an approval by a reviewer
   * that may write the workspace is refused (§13.2).
   */
  readonly reviewerPermissions?: readonly Permission[]
  /** Clock reading of the transition. */
  readonly at: EpochMs
}

/** Accepted transition: the next review plus the events it produced. */
export interface ReviewTransition {
  /** Review after the transition, with an incremented revision. */
  readonly review: Review
  /** State the review was in. */
  readonly from: ReviewState
  /** State the review moved to. */
  readonly to: ReviewState
  /** Events the transition produced, in order. */
  readonly events: readonly DomainEvent[]
}

/** Whether a review reached a final state. */
export function isReviewTerminal(state: ReviewState): boolean {
  return REVIEW_TERMINAL_STATES.includes(state)
}

/** Whether a transition between two states is allowed. */
export function canTransitionReview(from: ReviewState, to: ReviewState): boolean {
  return REVIEW_TRANSITIONS[from].includes(to)
}

/** States reachable from the given one, for diagnostics and UI. */
export function allowedReviewTransitions(from: ReviewState): readonly ReviewState[] {
  return REVIEW_TRANSITIONS[from]
}

/**
 * Refuse a review performed by the agent that produced the work (§13.2).
 * @param input - worker identity and reviewer identity.
 * @param meta - operation identity.
 */
export function assertReviewerIndependence(
  input: { readonly workerAgentId: AgentId; readonly reviewerAgentId: AgentId },
  meta: OperationMeta,
): Result<true> {
  if (input.workerAgentId === input.reviewerAgentId) {
    return fail(
      new MyWorkError('SECURITY_DENIED', `dsh-mywork: agent "${input.reviewerAgentId}" cannot review its own attempt`, {
        details: { workerAgentId: input.workerAgentId, reviewerAgentId: input.reviewerAgentId },
      }),
      meta,
    )
  }
  return ok(true, meta)
}

/**
 * Refuse a reviewer that can mutate the implementation it reviews (§13.2).
 * @param permissions - permissions the reviewer holds.
 * @param meta - operation identity.
 */
export function assertReviewerReadOnly(permissions: readonly Permission[], meta: OperationMeta): Result<true> {
  if (permissions.includes('workspace.write')) {
    return fail(
      new MyWorkError('SECURITY_DENIED', 'dsh-mywork: a reviewer must not hold workspace.write', {
        details: { permissions: [...permissions] },
      }),
      meta,
    )
  }
  return ok(true, meta)
}

/**
 * Whether an approval still refers to the artefact in front of the reviewer.
 * @param review - the review holding the approval.
 * @param artifact - the artefact currently produced by the attempt.
 */
export function isReviewApprovalCurrent(review: Review, artifact: ReviewedArtifact): boolean {
  return review.state === 'approved' && review.artifact !== undefined && sameArtifact(review.artifact, artifact)
}

/**
 * Refuse to carry an approval over a changed artefact (§19): if the head SHA or
 * the diff hash moved after approval, the work must be reviewed again.
 * @param review - the review holding the approval.
 * @param artifact - the artefact currently produced by the attempt.
 * @param meta - operation identity.
 */
export function assertReviewApprovalCurrent(
  review: Review,
  artifact: ReviewedArtifact,
  meta: OperationMeta,
): Result<ReviewedArtifact> {
  if (isReviewApprovalCurrent(review, artifact)) return ok(review.artifact as ReviewedArtifact, meta)
  return fail(
    new MyWorkError('STALE_REVISION', `dsh-mywork: review "${review.id}" does not approve the current artifact`, {
      details: {
        reviewId: review.id,
        state: review.state,
        reviewed: review.artifact ?? null,
        current: artifact,
      },
    }),
    meta,
  )
}

/**
 * Move a review to another state.
 * @param review - current review.
 * @param command - target state, artefact, findings, and clock reading.
 * @param meta - operation identity.
 */
export function transitionReview(
  review: Review,
  command: ReviewTransitionCommand,
  meta: OperationMeta,
): Result<ReviewTransition> {
  const revision = assertRevision(command.expectedRevision, review.revision, meta)
  if (!revision.ok) return fail(revision.error, meta)

  if (!canTransitionReview(review.state, command.to)) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: review "${review.id}" cannot move from "${review.state}" to "${command.to}"`, {
        details: { reviewId: review.id, from: review.state, to: command.to, allowed: [...REVIEW_TRANSITIONS[review.state]] },
      }),
      meta,
    )
  }

  if (command.to === 'approved') {
    const approval = assertApprovable(review, command, meta)
    if (!approval.ok) return fail(approval.error, meta)
  }

  if (REVIEW_STATES_REQUIRING_FINDINGS.includes(command.to) && !hasFindings(command.findings)) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: review "${review.id}" cannot move to "${command.to}" without findings`, {
        details: { reviewId: review.id, to: command.to },
      }),
      meta,
    )
  }

  const artifact = command.to === 'approved' && command.artifact !== undefined ? command.artifact : review.artifact
  const findings = command.findings ?? review.findings
  const settledAt = isReviewTerminal(command.to) ? command.at : review.settledAt
  const built: Review = {
    id: review.id,
    taskId: review.taskId,
    attemptId: review.attemptId,
    reviewerId: review.reviewerId,
    state: command.to,
    revision: review.revision + 1,
    requestedAt: review.requestedAt,
    ...(artifact === undefined ? {} : { artifact }),
    ...(findings === undefined ? {} : { findings }),
    ...(settledAt === undefined ? {} : { settledAt }),
  }
  const next = Object.freeze(built)

  return ok(
    Object.freeze({
      review: next,
      from: review.state,
      to: command.to,
      events: Object.freeze([reviewEvent(review, command, next)]),
    }),
    meta,
  )
}

/** Checks that must pass before an approval is recorded. */
function assertApprovable(review: Review, command: ReviewTransitionCommand, meta: OperationMeta): Result<true> {
  const workerAgentId = command.workerAgentId
  if (workerAgentId === undefined) {
    throw new TypeError(`dsh-mywork: approving review "${review.id}" requires the worker agent identity`)
  }
  const independence = assertReviewerIndependence({ workerAgentId, reviewerAgentId: review.reviewerId }, meta)
  if (!independence.ok) return fail(independence.error, meta)

  if (command.reviewerPermissions !== undefined) {
    const readOnly = assertReviewerReadOnly(command.reviewerPermissions, meta)
    if (!readOnly.ok) return fail(readOnly.error, meta)
  }

  if (!hasArtifact(command.artifact)) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: review "${review.id}" cannot be approved without the reviewed artifact`, {
        details: { reviewId: review.id },
      }),
      meta,
    )
  }
  return ok(true, meta)
}

/** Whether an artefact carries the head SHA and diff hash an approval binds to. */
function hasArtifact(artifact: ReviewedArtifact | undefined): artifact is ReviewedArtifact {
  return (
    artifact !== undefined &&
    typeof artifact.headSha === 'string' &&
    artifact.headSha.trim() !== '' &&
    typeof artifact.diffHash === 'string' &&
    artifact.diffHash.trim() !== ''
  )
}

/** Whether findings carry a usable summary. */
function hasFindings(findings: ReviewFindings | undefined): boolean {
  return findings !== undefined && typeof findings.summary === 'string' && findings.summary.trim() !== ''
}

/** Whether two artefacts are the same revision of the work. */
function sameArtifact(left: ReviewedArtifact, right: ReviewedArtifact): boolean {
  return left.headSha === right.headSha && left.diffHash === right.diffHash
}

/** Event produced by a review transition. */
function reviewEvent(review: Review, command: ReviewTransitionCommand, next: Review): DomainEvent {
  return Object.freeze({
    type: 'review.state.changed',
    payload: Object.freeze({
      reviewId: review.id,
      taskId: review.taskId,
      attemptId: review.attemptId,
      reviewerId: review.reviewerId,
      from: review.state,
      to: command.to,
      revision: next.revision,
      at: command.at,
    }),
  })
}
