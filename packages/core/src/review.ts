/**
 * Review state machine (architecture §18.3, §19) as pure transitions.
 *
 * Two rules from §13.2 and §19 are enforced here rather than left to caller
 * discipline: a review of a worker's own attempt is refused with
 * `SECURITY_DENIED`, and an approval is bound to the artefact the reviewer saw,
 * so a later head SHA invalidates it with `STALE_REVISION`.
 *
 * A third rule closes R-22 and is D15's: an **automatic** approver never
 * approves. The `auto-review` plugin is mounted and active in the live profile,
 * so its absence is not a protection; the rule is MyWork's, it holds whatever
 * the composition contains, and the approver's whole command vocabulary is the
 * single `review.request-changes` entry of {@link AUTO_REVIEW_COMMANDS}. The
 * escalation it can cause is a §28 human gate rather than a durable decision
 * entity — `HumanDecision` is D14 and stage-4 work.
 *
 * The returned review is frozen at the top level only: `artifact` and `findings`
 * keep their identity, so nested immutability is a contract of the domain
 * rather than a runtime guarantee.
 * @module
 */

import {
  REVIEW_TERMINAL_STATES,
  type AgentId,
  type CardCommand,
  type DomainEvent,
  type EpochMs,
  type HumanGate,
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

/**
 * The command an automatic approver may cause, and the only one (D15).
 *
 * `review.request-changes` is the strongest thing an LLM approver is allowed to
 * reach: it can ask for changes, and it can refuse, but it can never approve.
 * The list is data — a second entry is a code change with a test, which is the
 * revision trigger D15 names.
 */
export const AUTO_REVIEW_COMMANDS: readonly CardCommand[] = Object.freeze(['review.request-changes'])

/**
 * Verdicts an automatic approver uses to mean "let this through".
 *
 * Three spellings rather than one because the answer crosses a system boundary:
 * recognising the intent matters more than the plugin's exact word, and every
 * member escalates rather than approves, so an extra spelling cannot widen
 * anything.
 */
export const AUTO_REVIEW_ALLOWING_VERDICTS: readonly string[] = Object.freeze(['allow', 'approve', 'approved'])

/**
 * Every ruling an automatic approver's answer can produce.
 *
 * There is no approving member: an automatic approver cannot raise a mode, and
 * a vocabulary that cannot name it is the structural half of that rule.
 */
export const AUTO_REVIEW_RULING_KINDS: readonly string[] = Object.freeze(['denied', 'human-decision-required'])

/**
 * §28 gate an approval the automatic approver may not give falls under.
 *
 * A decision to let an LLM reviewer approve is a change to who may authorize
 * work, which is exactly what §28 keeps for a human. When D14 lands and brings a
 * durable `HumanDecision`, this gate is what that decision carries — the gate is
 * the vocabulary that exists today, not a placeholder entity.
 */
export const AUTO_REVIEW_ESCALATION_GATE: HumanGate = 'security-change'

/** One automatic approver's answer, plus the composition it arrived in. */
export interface AutoReviewRequest {
  /** The verdict as it crossed the boundary; `unknown` because it is not ours. */
  readonly verdict: unknown
  /**
   * Whether an automatic approver is mounted.
   *
   * Accepted and deliberately **not** branched on: the rule is MyWork's, so it
   * must hold with the plugin present and with it absent. Taking the flag as an
   * input is what makes that testable — a branch on it would show up as two
   * different rulings.
   */
  readonly autoReviewActive: boolean
}

/** What MyWork does with an automatic approver's answer: never an approval. */
export type AutoReviewRuling =
  /** The approver refused, or said something MyWork cannot read. */
  | { readonly kind: 'denied'; readonly reason: string }
  /** The approver asked to allow: only a human may decide that (§28). */
  | { readonly kind: 'human-decision-required'; readonly gate: HumanGate; readonly reason: string }

/**
 * Turn an automatic approver's answer into what MyWork will do about it.
 *
 * Fail-closed by construction: only `deny` is read as a refusal, only the
 * {@link AUTO_REVIEW_ALLOWING_VERDICTS} escalate, and everything else — an empty
 * answer, a nested object, a verdict from a future version — is refused. There
 * is no input that produces an approval, which is the point: R-22 is the risk of
 * review being bypassed through an LLM approver.
 * @param request - the verdict and the composition it arrived in.
 * @returns the ruling; `kind` is never an approval.
 */
export function ruleOnAutoReview(request: AutoReviewRequest): AutoReviewRuling {
  const verdict = request.verdict
  if (verdict === 'deny') {
    return Object.freeze({ kind: 'denied', reason: 'the automatic reviewer refused the attempt' })
  }
  if (typeof verdict === 'string' && AUTO_REVIEW_ALLOWING_VERDICTS.includes(verdict)) {
    return Object.freeze({
      kind: 'human-decision-required',
      gate: AUTO_REVIEW_ESCALATION_GATE,
      reason: `an automatic reviewer cannot approve "${verdict}": the decision escalates to a human (§28 ${AUTO_REVIEW_ESCALATION_GATE}, D15)`,
    })
  }
  return Object.freeze({
    kind: 'denied',
    reason: `"${String(verdict)}" is not a verdict MyWork can read; an unknown answer never approves`,
  })
}

/**
 * Accept the one command an automatic approver may cause, refuse the rest.
 *
 * §28 and D15 keep approval with a human, so a caller that reaches this with
 * anything else is a configuration defect: the refusal is typed
 * (`SECURITY_DENIED`) rather than a silent no-op, because a silently dropped
 * command leaves an attempt that believes it was decided.
 * @param command - the command the approver's answer would issue.
 * @param meta - operation identity.
 */
export function assertAutoReviewCommand(command: unknown, meta: OperationMeta): Result<CardCommand> {
  if (typeof command === 'string' && (AUTO_REVIEW_COMMANDS as readonly string[]).includes(command)) {
    return ok(command as CardCommand, meta)
  }
  const received = typeof command === 'string' ? `"${command}"` : typeof command
  return fail(
    new MyWorkError(
      'SECURITY_DENIED',
      `dsh-mywork: an automatic reviewer may only cause ${AUTO_REVIEW_COMMANDS.join(', ')}, received ${received}`,
      { details: { command: typeof command === 'string' ? command : null, allowed: [...AUTO_REVIEW_COMMANDS] } },
    ),
    meta,
  )
}
