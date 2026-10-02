/**
 * The review queue: an independent review of a settled attempt, its evidence
 * package, its verdict, and the reject-flow (architecture §13.2, §14, §18.3,
 * §19, §22.2, §22.3, §32; E-19…E-24).
 *
 * A review is work of its own. It has its own claim table, its own reviewer
 * pool, its own fresh session, and its own lifecycle — it is **not** a
 * continuation of the worker attempt that produced the artifact, because a
 * review that runs inside the attempt it reviews cannot be independent of it.
 * The queue owns *when* a review is queued, claimed, and settled; what state the
 * **task** is in stays in the Task Graph (§7), and this module asks the graph to
 * move it rather than keeping a second copy.
 *
 * Four rules are implemented here rather than restated in a prompt:
 *
 * - **Self-review cannot be admitted.** `assertReviewerIndependence` runs on the
 *   durable identities before the claim is written, so a refusal changes no
 *   state: the row is still `queued` afterwards. Another instance of the same
 *   identity is the same reviewer, not a different one (§13.4).
 * - **A reviewer cannot write what it reviews.** `assertReviewerReadOnly` runs
 *   before the claim, and the scope this queue hands the session starter is
 *   fixed at harness policy `read-only` (E-21).
 * - **An approval is bound to the artifact it saw.** {@link ReviewQueue.approveReview}
 *   re-reads HEAD and re-hashes the diff through the injected `GitPort`, so a
 *   commit or a rebuilt diff after the approval is refused with
 *   `STALE_APPROVAL` instead of being integrated as if it were approved (§19,
 *   E-23).
 * - **Automation never approves.** An approver whose provenance is automatic is
 *   refused on the approve path itself, and the only door an automatic answer
 *   has — {@link ReviewQueue.ruleOnAutomaticVerdict} — answers with a ruling
 *   from `AUTO_REVIEW_RULING_KINDS`, whose vocabulary contains no approval
 *   (D15, F-57, R-42).
 *
 * Everything is timestamped from the injected `ClockPort`, and every mutation is
 * a compare-and-set on `revision`, so a repeated call changes nothing and is
 * told so.
 * @module
 */

import { createHash, randomUUID } from 'node:crypto'

import {
  IMPLEMENTATION_WRITE_PERMISSIONS,
  NEEDS_ATTENTION_REASONS,
  REVIEWER_DEFAULT_PERMISSIONS,
  REVIEW_APPROVAL_CONTENT_TYPE,
  REVIEW_APPROVAL_SCHEMA,
  REVIEW_FINDING_SEVERITIES,
  REVIEW_FINDING_STATUSES,
  REVIEW_VERDICT_CONTENT_TYPE,
  REVIEW_VERDICT_SCHEMA,
  REVIEW_VERDICTS,
  REVIEW_VERDICTS_PASSING,
  TRUSTED_CONTEXT_TRUST,
  type AgentId,
  type AgentInstanceId,
  type ArtifactRef,
  type AttemptId,
  type AttemptRecord,
  type BudgetLimits,
  type ClockPort,
  type ContextCandidate,
  type ContextDiscoveryRequest,
  type ContextMaterialized,
  type ContextMaterializeRequest,
  type ContextProviderCapabilities,
  type ContextProviderPort,
  type ControllerEpoch,
  type EpochMs,
  type FenceToken,
  type FreshSessionPlan,
  type GitPort,
  type HumanGate,
  type MyWorkErrorCode,
  type NeedsAttentionReason,
  type OperationMeta,
  type Permission,
  type Result,
  type Review,
  type ReviewCommandOutcome,
  type ReviewFinding,
  type ReviewFindings,
  type ReviewId,
  type ReviewedArtifact,
  type Revision,
  type ReviewUnverifiedClaim,
  type ReviewVerdict,
  type ReviewVerdictPayload,
  type SessionPurpose,
  type Task,
  type TaskGraphPort,
  type TaskId,
  type TaskState,
  type WorkspaceId,
} from '@dsh-mywork/contracts'
import {
  assertAutoReviewCommand,
  assertReviewerIndependence,
  assertReviewerReadOnly,
  AUTO_REVIEW_COMMANDS,
  canTransitionReview,
  fail,
  isReviewApprovalCurrent,
  MyWorkError,
  ok,
  ruleOnAutoReview,
  transitionReview,
  type AutoReviewRuling,
} from '@dsh-mywork/core'
import { putArtifact } from '@dsh-mywork/evidence'
import type { Migration, MyWorkStore, MyWorkTransaction } from '@dsh-mywork/storage'

import { ExecutionError } from './errors.ts'
import { assertGatesSatisfied, readGateResults, type GateAdmission } from './gates-admission.ts'
import { allocateFence, assertClaimSchema, insertAttempt, readAttempt, readLiveAttempt } from './store.ts'
import { REVIEW_CLAIM_TABLE } from './review-schema.ts'

/** Reviews a task may consume before the loop needs a human (§30, E-24). */
export const DEFAULT_MAX_REVIEW_LOOPS = 3

/**
 * §14's reviewer pool.
 *
 * The name is the one `DEFAULT_SCHEDULER_POLICY.reviewerPool` uses, so a live
 * review this queue reports lands in the same pool the scheduler fills.
 */
export const REVIEW_POOL = 'reviewers'

/** Agent preset a review session is composed from (E-21). */
export const REVIEW_AGENT_PRESET = 'mywork-reviewer'

/**
 * Harness policy a review session runs under (E-21).
 *
 * Read-only is the point of the acceptance criterion: the reviewer must not be
 * able to edit the implementation, and the refusal has to come from the
 * platform policy rather than from a sentence in a prompt.
 */
export const REVIEW_HARNESS_POLICY = 'read-only'

/**
 * Longest artifact id the evidence schema accepts (`packages/evidence/src/metadata.ts:40`).
 *
 * An approval is stored as an artifact, so its id lives under the same closed
 * identifier shape as every other artifact: at most 64 characters of
 * `[A-Za-z0-9._:-]`. Composing an approval id from the head SHA and the diff
 * hash directly overruns that budget — the store then refuses the write with
 * `invalid-input`, and `approveReview` fails for a reason that has nothing to do
 * with the approval.
 */
const ARTIFACT_ID_MAX_LENGTH = 64

/** Prefix of the artifact identity an approval is stored under (§19, E-23). */
const APPROVAL_ARTIFACT_PREFIX = 'review-approval:'

/** Characters of the approval fingerprint kept in its artifact id, when there is room. */
const APPROVAL_FINGERPRINT_CHARS = 16

/**
 * Fewest characters of the fingerprint an approval id may keep.
 *
 * A review id is 38 characters and the prefix takes 16, so the fingerprint is
 * shortened to what is left rather than dropped: the id has to stay a function
 * of the reviewed artifact, or two approvals would collide on one artifact.
 */
const APPROVAL_FINGERPRINT_MIN_CHARS = 8

/** §22.2 purpose of the session one review gets. */
export const REVIEW_SESSION_PURPOSE: SessionPurpose = 'review'

/**
 * Journal of the evidence schema this queue writes artifacts through.
 *
 * `putArtifact` needs the evidence tables, so a store composed without them is
 * refused where the queue was wired instead of halfway through a verdict.
 */
const EVIDENCE_TABLES_MIGRATION = Object.freeze({ version: 2, name: 'artifact-audit' })

/** States in which a review still holds its slot. */
const LIVE_REVIEW_STATES = "('queued','claimed','reviewing','needs-evidence')"

/** One `review_claim` row as SQLite returns it. */
interface ClaimRow {
  readonly review_id: string
  readonly attempt_id: string
  readonly task_id: string
  readonly workspace_id: string
  readonly worker_agent_id: string
  readonly head_sha: string
  readonly diff_hash: string
  readonly state: string
  readonly revision: number
  readonly reviewer_id: string | null
  readonly requested_at: number
  readonly settled_at: number | null
  readonly updated_at: number
}

/** A stored artifact reference, as the approval column carries it. */
interface StoredApproval {
  readonly artifactId: string
  readonly hash: string
}

/** The handoff document stored with a rejected review. */
interface StoredHandoff {
  readonly candidates: readonly ContextCandidate[]
  readonly bodies: Readonly<Record<string, string>>
}

/**
 * One review as the queue stores it.
 *
 * `headSha` and `diffHash` are the artifact the review examines; they are read
 * back by {@link ReviewQueue.approveReview} and compared against the checkout,
 * which is what makes a moved commit a refusal instead of a silent integration.
 */
export interface ReviewClaim {
  /** Review identifier, unique in this queue. */
  readonly reviewId: ReviewId
  /** Attempt under review. */
  readonly attemptId: AttemptId
  /** Task the attempt belongs to; the Task Graph owns its state. */
  readonly taskId: TaskId
  /** Workspace of the task; the §31 boundary and the pool caps read it. */
  readonly workspaceId: WorkspaceId
  /** Durable identity that produced the reviewed attempt, read from the attempt row. */
  readonly workerAgentId: AgentId
  /** Head SHA the review was requested for. */
  readonly headSha: string
  /** Hash of the diff the review was requested for. */
  readonly diffHash: string
  /** Review state, from the §18.3 machine's own dictionary. */
  readonly state: Review['state']
  /** Aggregate revision; every accepted transition increments it. */
  readonly revision: Revision
  /** Reviewer that holds the claim; absent while the review is `queued`. */
  readonly reviewerId?: AgentId
  /** Clock reading the review was queued. */
  readonly requestedAt: EpochMs
  /** Clock reading the review reached a terminal state. */
  readonly settledAt?: EpochMs
  /** Clock reading of the last accepted change. */
  readonly updatedAt: EpochMs
}

/** Everything the queue needs to run. */
export interface ReviewQueueDeps {
  /** Store opened with the claim saga, the evidence tables, and the review-claim migration. */
  readonly store: MyWorkStore
  /** Task graph the reject-flow reads and moves; resolved by the caller (§11, §44). */
  readonly graph: TaskGraphPort
  /** Time source; a fake clock keeps every review deterministic. */
  readonly clock: ClockPort
  /** The review-claim migration the composition root registered, allocated version and all. */
  readonly migration: Migration
  /**
   * Git port used to re-read HEAD and re-hash the diff before an approval. Absent
   * means this deployment cannot verify an approval, and
   * {@link ReviewQueue.approveReview} refuses with `ADAPTER_UNAVAILABLE` rather
   * than taking the caller's word for the artifact.
   */
  readonly git?: GitPort
  /**
   * Review loops a task may consume when its §30 budget declares none. The
   * `BudgetLimits.maxAttempts` of the task is what a caller should pass instead;
   * this is the fallback of a deployment that declared no limit at all.
   */
  readonly maxReviewLoops?: number
}

/** Grant a reviewer is admitted with (E-20, E-21). */
export interface ReviewerGrant {
  /** Durable identity of the reviewer; the identity the independence check compares. */
  readonly agentId: AgentId
  /**
   * Live instance the reviewer runs as. Carried for the audit trail only: a
   * second instance of the same identity is the same reviewer (§13.4).
   */
  readonly instanceId?: AgentInstanceId
  /** Permissions the reviewer holds; an implementation-write permission is refused. */
  readonly permissions: readonly Permission[]
}

/**
 * Who is asking the queue to decide a review.
 *
 * The two members are the reason this type exists: an answer that came from an
 * automatic approver is not a reviewer, and the queue can only refuse it because
 * the provenance travels with the request instead of being assumed.
 */
export type ReviewActor =
  | { readonly kind: 'agent'; readonly grant: ReviewerGrant }
  | {
      readonly kind: 'automatic'
      /** The verdict as it crossed the boundary; `unknown` because it is not ours. */
      readonly verdict: unknown
      /** Whether an automatic approver is mounted; read by `ruleOnAutoReview`. */
      readonly autoReviewActive: boolean
    }

/** The checkout a review examines. */
export interface ReviewWorktree {
  /** Durable worktree identity of the attempt (§17, E-04); the reject-flow preserves it. */
  readonly worktreeId: string
  /** Directory of the checkout. */
  readonly cwd: string
  /** Revision the attempt started from; one diff implementation hashes against it. */
  readonly baseSha: string
}

/** Artifact references a reviewer is given (§19, §32, E-22). */
export interface ReviewEvidenceInput {
  /** The exact artifact under review. */
  readonly reviewed: ReviewedArtifact
  /** The diff of the attempt. */
  readonly diff: ArtifactRef
  /** `gate-result` records of the run (§19, E-17); empty when no gate ran. */
  readonly gates: readonly ArtifactRef[]
  /** The report the worker wrote about its own work. */
  readonly workerReport: ArtifactRef
  /** The frozen context the attempt ran with (§21.7). */
  readonly contextSnapshot: ArtifactRef
  /** Checkpoint taken for recovery, when the attempt took one. */
  readonly checkpoint?: ArtifactRef
}

/**
 * The evidence package assembled before a review session starts.
 *
 * It is frozen and fingerprinted at request time: what the reviewer was given
 * must be reconstructible afterwards, and a row whose document no longer matches
 * its fingerprint is refused rather than read.
 */
export interface ReviewEvidencePackage {
  /** Review the package belongs to. */
  readonly reviewId: ReviewId
  /** Attempt under review. */
  readonly attemptId: AttemptId
  /** Task under review. */
  readonly taskId: TaskId
  /** The artifact under review. */
  readonly reviewed: ReviewedArtifact
  /** The diff of the attempt. */
  readonly diff: ArtifactRef
  /** `gate-result` records of the run, in the order they were given. */
  readonly gates: readonly ArtifactRef[]
  /** The worker's own report. */
  readonly workerReport: ArtifactRef
  /** The frozen context snapshot of the attempt. */
  readonly contextSnapshot: ArtifactRef
  /** Checkpoint, when the attempt took one. */
  readonly checkpoint?: ArtifactRef
  /** Clock reading the package was assembled at. */
  readonly assembledAt: EpochMs
  /** SHA-256 over the canonical form of this package without the fingerprint field. */
  readonly fingerprint: string
}

/**
 * What a reviewer states about a review.
 *
 * The identity fields and the reviewed artifact are deliberately **not** part of
 * the draft: the queue fills them from the claim row, so a reviewer cannot
 * record a verdict against a revision it did not examine.
 */
export interface ReviewVerdictDraft {
  /** What the reviewer concluded. */
  readonly verdict: ReviewVerdict
  /** One line the verdict is justified by. */
  readonly justification: string
  /** Commands that were run, in the order they were run. */
  readonly commands?: readonly ReviewCommandOutcome[]
  /** Defects found; `FAIL` without one is refused by the state machine. */
  readonly findings?: readonly ReviewFinding[]
  /** Claims of the author's report the reviewer could not reproduce. */
  readonly unverified?: readonly ReviewUnverifiedClaim[]
  /** What the reviewer did not check, and why. */
  readonly limitations?: readonly string[]
}

/** A request to queue a review of a settled attempt (E-19). */
export interface RequestReviewCommand {
  /** Attempt under review. */
  readonly attemptId: AttemptId
  /** Evidence package the reviewer will be given. */
  readonly evidence: ReviewEvidenceInput
  /** Operation identity. */
  readonly meta: OperationMeta
}

/** Outcome of {@link ReviewQueue.requestReview}. */
export interface ReviewRequestOutcome {
  /** The claim as it is stored. */
  readonly claim: ReviewClaim
  /** The frozen evidence package. */
  readonly evidence: ReviewEvidencePackage
  /**
   * The gate results §19 admitted the attempt with: every required gate passed
   * for this exact head, and nothing else reached the reviewer.
   */
  readonly gates: readonly GateAdmission['results'][number][]
  /** False when this call found the review already queued: the request is idempotent. */
  readonly created: boolean
}

/** A request to claim a queued review for a reviewer (E-19, E-20). */
export interface ClaimReviewCommand {
  /** Review to claim. */
  readonly reviewId: ReviewId
  /** Revision the caller observed; a mismatch is `STALE_REVISION`. */
  readonly expectedRevision: Revision
  /** Reviewer asking for the claim, with its provenance. */
  readonly actor: ReviewActor
  /** Operation identity. */
  readonly meta: OperationMeta
}

/** Outcome of {@link ReviewQueue.claimReview} and of every move that stores no artifact. */
export interface ReviewProgress {
  /** The claim after the transition. */
  readonly claim: ReviewClaim
  /** The review contract value the machine accepted. */
  readonly review: Review
}

/** A revision-guarded move that needs no other input. */
export interface ReviewRevisionCommand {
  /** Review to move. */
  readonly reviewId: ReviewId
  /** Revision the caller observed. */
  readonly expectedRevision: Revision
  /** Operation identity. */
  readonly meta: OperationMeta
}

/** A move that carries the findings a reviewer states. */
export interface ReviewFindingsCommand extends ReviewRevisionCommand {
  /** Findings; the machine requires them for `needs-evidence`. */
  readonly findings: ReviewFindings
}

/** A reviewer's verdict (E-22). */
export interface SubmitVerdictCommand extends ReviewRevisionCommand {
  /** What the reviewer states; identity fields are the queue's to fill. */
  readonly draft: ReviewVerdictDraft
}

/** Outcome of {@link ReviewQueue.submitVerdict}. */
export interface ReviewVerdictOutcome {
  /** The claim after the transition. */
  readonly claim: ReviewClaim
  /** The review contract value the machine accepted. */
  readonly review: Review
  /** The stored `mywork.review-verdict/v1` payload. */
  readonly payload: ReviewVerdictPayload
  /** Identity of the artifact the payload was stored as. */
  readonly artifact: ArtifactRef
}

/** A request to confirm or give an approval against the checkout (E-23, §19). */
export interface ApproveReviewCommand {
  /** Review whose approval is confirmed or given. */
  readonly reviewId: ReviewId
  /** Revision the caller observed. */
  readonly expectedRevision: Revision
  /** Who is approving, with its provenance. */
  readonly actor: ReviewActor
  /** The checkout the artifact is re-read from. */
  readonly worktree: ReviewWorktree
  /** Operation identity. */
  readonly meta: OperationMeta
}

/** Outcome of {@link ReviewQueue.approveReview}. */
export interface ReviewApprovalOutcome {
  /** The claim, in `approved`. */
  readonly claim: ReviewClaim
  /** The review contract value the approval binds to. */
  readonly review: Review
  /** The artifact the approval covers, as the checkout reported it. */
  readonly artifact: ReviewedArtifact
  /** Identity of the stored approval record. */
  readonly approval: ArtifactRef
  /** False when this call found the approval already recorded for this artifact. */
  readonly created: boolean
}

/**
 * A request for a human decision (§28, D14, E-24).
 *
 * `HumanDecision` is not a durable entity in this repository yet (D14 is
 * stage-4 work), so the request is expressed with the vocabulary that exists: a
 * `needs-attention` task, a reason from the closed
 * {@link NEEDS_ATTENTION_REASONS} catalogue, and the §28 gate the decision
 * belongs to. It is recorded in the review row and returned, never dropped.
 */
export interface AttentionRequest {
  /** Task that needs the decision. */
  readonly taskId: TaskId
  /** Why `needs-attention` was entered; never absent (v0.2 §5.7). */
  readonly reason: NeedsAttentionReason
  /** §28 gate the decision belongs to, when the trigger names one. */
  readonly gate?: HumanGate
  /** What the human is being asked, in one line. */
  readonly detail: string
  /** Clock reading the request was raised. */
  readonly requestedAt: EpochMs
}

/** The reject-flow's answer: the task asks for changes and a new attempt exists. */
export interface ReviewRejectionOutcome {
  /** The claim, in `rejected`. */
  readonly claim: ReviewClaim
  /** The review contract value the machine accepted. */
  readonly review: Review
  /** State the task was moved to: `changes-requested`, or `needs-attention` at the limit. */
  readonly taskState: TaskState
  /** The new attempt, when one was created. */
  readonly attempt?: AttemptRecord
  /** Fence of the new attempt; strictly greater than the reviewed attempt's. */
  readonly fence?: FenceToken
  /** Identity and directory the next attempt reuses, unchanged. */
  readonly worktree: ReviewWorktree
  /**
   * §22.3 plan of the session the new attempt gets: a new one, carrying the
   * findings and the checkpoint and **never** the transcript.
   */
  readonly session?: FreshSessionPlan
  /** Context candidates the new attempt discovers through {@link ReviewQueue.handoff}. */
  readonly handoff: readonly ContextCandidate[]
  /** Human decision request, present when the loop limit was reached. */
  readonly attention?: AttentionRequest
  /** How many reviews of this task were rejected, including this one. */
  readonly rejected: number
  /** The loop limit that was in force for this task. */
  readonly loopLimit: number
}

/** A request to reject a review and reopen the work (E-24). */
export interface RejectReviewCommand extends ReviewRevisionCommand {
  /** Who is rejecting; an automatic approver may do exactly this (D15). */
  readonly actor: ReviewActor
  /** Findings; the state machine refuses a rejection without them (§18.3). */
  readonly findings: ReviewFindings
  /** Identity and directory the next attempt reuses. */
  readonly worktree: ReviewWorktree
  /** Controller epoch the new attempt belongs to (§17). */
  readonly controllerEpoch: ControllerEpoch
  /** Lease window of the new attempt, in milliseconds. */
  readonly leaseMs: number
  /** The task's §30 limits; `maxAttempts` bounds the review loops. */
  readonly budget?: BudgetLimits
  /** Reason the human request carries above the limit; defaults to `retry-budget-exhausted`. */
  readonly attentionReason?: NeedsAttentionReason
  /** Identity of the new attempt; minted when absent. */
  readonly newAttemptId?: AttemptId
  /** Operation identity. */
  readonly meta: OperationMeta
}

/** A request to escalate a review to a human (§28, E-24). */
export interface EscalateReviewCommand extends ReviewRevisionCommand {
  /** §28 gate the decision belongs to. */
  readonly gate: HumanGate
  /** Why the task needs attention; from the closed catalogue. */
  readonly reason: NeedsAttentionReason
  /** What the human is being asked, in one line. */
  readonly detail: string
}

/** Outcome of {@link ReviewQueue.escalateReview}. */
export interface ReviewEscalationOutcome {
  /** The claim, in `escalated`. */
  readonly claim: ReviewClaim
  /** The review contract value the machine accepted. */
  readonly review: Review
  /** The request a human answers; recorded in the row as well as returned. */
  readonly attention: AttentionRequest
}

/** A request to hand an automatic approver's answer to the D15 rule (R-42). */
export interface AutomaticVerdictCommand {
  /** Review the answer is about. */
  readonly reviewId: ReviewId
  /** The answer as it crossed the boundary. */
  readonly verdict: unknown
  /** Whether an automatic approver is mounted; the rule does not branch on it. */
  readonly autoReviewActive: boolean
  /** Operation identity. */
  readonly meta: OperationMeta
}

/** What MyWork does with an automatic approver's answer. */
export interface AutomaticVerdictOutcome {
  /** The ruling; its vocabulary has no approving member. */
  readonly ruling: AutoReviewRuling
  /** The claim, unchanged: an automatic answer never moves a review. */
  readonly claim: ReviewClaim
}

/**
 * The scope of the session a review runs in (E-21).
 *
 * Data, not a comment: the session starter composes the review session from this
 * value, so "the reviewer cannot write" is a property of what it was handed.
 */
export interface ReviewRunScope {
  /** Review the session belongs to. */
  readonly reviewId: ReviewId
  /** Task under review. */
  readonly taskId: TaskId
  /** Attempt under review. */
  readonly attemptId: AttemptId
  /** Workspace the session is bound to (§52). */
  readonly workspaceId: WorkspaceId
  /** Durable identity of the reviewer. */
  readonly reviewerId: AgentId
  /** Worker identity the review may approve; never the reviewer's own work. */
  readonly workerAgentId: AgentId
  /** Agent preset the session is composed from. */
  readonly agentPreset: string
  /** §14 pool the review is drawn from. */
  readonly pool: string
  /** §22.2 purpose of the session. */
  readonly purpose: SessionPurpose
  /** Harness policy in force: always {@link REVIEW_HARNESS_POLICY}. */
  readonly permission: string
  /** Permissions the reviewer holds. */
  readonly permissions: readonly Permission[]
  /** True: §22.2 gives every review a session of its own. */
  readonly fresh: boolean
  /** False: a review session never carries the worker's transcript. */
  readonly carriesTranscript: boolean
  /** The frozen evidence package the session reads. */
  readonly evidence: ReviewEvidencePackage
}

/**
 * The queue's surface.
 *
 * Every method answers with a {@link Result}; a refusal is a typed code from §42
 * rather than an exception, because the caller of a review decision is a
 * scheduler, a surface, or a reconciler, and each of them branches on the code.
 */
export interface ReviewQueue {
  /** Queue a review of a settled attempt, idempotently per `(attemptId, headSha)`. */
  requestReview(command: RequestReviewCommand): Promise<Result<ReviewRequestOutcome>>
  /** Claim a queued review for an independent, read-only reviewer. */
  claimReview(command: ClaimReviewCommand): Result<ReviewProgress>
  /** Move a claimed review to `reviewing`: the point where a session may start. */
  beginReviewing(command: ReviewRevisionCommand): Result<ReviewProgress>
  /** Record the reviewer's verdict and move the review accordingly (E-22). */
  submitVerdict(command: SubmitVerdictCommand): Promise<Result<ReviewVerdictOutcome>>
  /** Ask for more evidence; the machine requires findings for it. */
  requestMoreEvidence(command: ReviewFindingsCommand): Result<ReviewProgress>
  /** Return a review that needed evidence to `reviewing`; creates no attempt (E-24). */
  provideEvidence(command: ReviewRevisionCommand): Result<ReviewProgress>
  /** Confirm or give an approval, re-reading the artifact through `GitPort` (E-23). */
  approveReview(command: ApproveReviewCommand): Promise<Result<ReviewApprovalOutcome>>
  /** Reject the work: the task asks for changes and a new attempt is created (E-24). */
  rejectReview(command: RejectReviewCommand): Promise<Result<ReviewRejectionOutcome>>
  /** Escalate to a human: the task enters `needs-attention` with a named reason (§28). */
  escalateReview(command: EscalateReviewCommand): Promise<Result<ReviewEscalationOutcome>>
  /** Hand an automatic approver's answer to the D15 rule; it never moves the review. */
  ruleOnAutomaticVerdict(command: AutomaticVerdictCommand): Result<AutomaticVerdictOutcome>
  /** One review, if it exists. */
  reviewOf(reviewId: ReviewId): ReviewClaim | undefined
  /** Every review of one task, oldest first. */
  queueOf(taskId: TaskId): readonly ReviewClaim[]
  /**
   * Every review that still holds a slot, oldest first.
   *
   * This is what the scheduler draws its §16.3 review work from: the rows whose
   * state is `queued` are the reviews waiting for a reviewer, and the ones under
   * way are the review-pool occupancy of §14.
   */
  liveReviews(workspaceId?: WorkspaceId): readonly ReviewClaim[]
  /** The frozen evidence package of one review, fingerprint verified. */
  evidenceOf(reviewId: ReviewId): ReviewEvidencePackage | undefined
  /** The stored verdict payload of one review. */
  verdictOf(reviewId: ReviewId): ReviewVerdictPayload | undefined
  /** The stored approval record of one review, when one was given. */
  approvalOf(reviewId: ReviewId): ArtifactRef | undefined
  /** The session scope of a claimed review; absent before a reviewer holds it. */
  scopeOf(reviewId: ReviewId): ReviewRunScope | undefined
  /** Every attempt of a task, oldest first. */
  attemptsOf(taskId: TaskId): readonly AttemptRecord[]
  /** The live attempt of a task, if it has one (E-19 (е)). */
  liveAttemptOf(taskId: TaskId): AttemptRecord | undefined
  /** The context port a new attempt discovers the previous review's findings through. */
  handoff(): ContextProviderPort
}

/** The canonical JSON of a value: object keys sorted, `undefined` dropped. */
function canonical(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(entry => canonical(entry)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
}

/** SHA-256 of a document's canonical form, lowercase hex. */
function fingerprintOf(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}

/** Read one row into the stored claim shape. */
function rowToClaim(row: ClaimRow): ReviewClaim {
  return Object.freeze({
    reviewId: String(row.review_id),
    attemptId: String(row.attempt_id),
    taskId: String(row.task_id),
    workspaceId: String(row.workspace_id),
    workerAgentId: String(row.worker_agent_id),
    headSha: String(row.head_sha),
    diffHash: String(row.diff_hash),
    state: String(row.state) as Review['state'],
    revision: Number(row.revision),
    ...(row.reviewer_id === null ? {} : { reviewerId: String(row.reviewer_id) }),
    requestedAt: Number(row.requested_at),
    ...(row.settled_at === null ? {} : { settledAt: Number(row.settled_at) }),
    updatedAt: Number(row.updated_at),
  })
}

/** Refuse with a typed §42 code. */
function refuse<T>(
  code: MyWorkErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>>,
  meta: OperationMeta,
): Result<T> {
  return fail(new MyWorkError(code, message, { details }), meta)
}

/** Parse a stored JSON document, refusing a row this queue cannot read. */
function parseStored<T>(what: string, column: string, text: string): T {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new ExecutionError('conflict', `dsh-mywork: the ${column} of ${what} is not readable JSON`, {
      details: { what, column },
      cause: error,
    })
  }
}

/** Reject a value that is not an artifact reference of the declared shape. */
function readArtifactRef(value: unknown, field: string, meta: OperationMeta): Result<ArtifactRef> {
  if (typeof value !== 'object' || value === null) {
    return refuse('CONTRACT_MISMATCH', `dsh-mywork: ${field} must be an artifact reference`, { field }, meta)
  }
  const ref = value as { readonly artifactId?: unknown; readonly hash?: unknown }
  if (typeof ref.artifactId !== 'string' || ref.artifactId.trim() === '') {
    return refuse('CONTRACT_MISMATCH', `dsh-mywork: ${field}.artifactId must be a non-empty string`, { field }, meta)
  }
  if (typeof ref.hash !== 'string' || ref.hash.trim() === '') {
    return refuse('CONTRACT_MISMATCH', `dsh-mywork: ${field}.hash must be a non-empty string`, { field }, meta)
  }
  return ok(Object.freeze({ artifactId: ref.artifactId, hash: ref.hash }), meta)
}

/** Reject a value that is not a reviewed artifact (head SHA plus diff hash). */
function readReviewedArtifact(value: unknown, field: string, meta: OperationMeta): Result<ReviewedArtifact> {
  if (typeof value !== 'object' || value === null) {
    return refuse('CONTRACT_MISMATCH', `dsh-mywork: ${field} must be a reviewed artifact`, { field }, meta)
  }
  const artifact = value as { readonly headSha?: unknown; readonly diffHash?: unknown }
  if (typeof artifact.headSha !== 'string' || artifact.headSha.trim() === '') {
    return refuse('CONTRACT_MISMATCH', `dsh-mywork: ${field}.headSha must be a non-empty string`, { field }, meta)
  }
  if (typeof artifact.diffHash !== 'string' || artifact.diffHash.trim() === '') {
    return refuse('CONTRACT_MISMATCH', `dsh-mywork: ${field}.diffHash must be a non-empty string`, { field }, meta)
  }
  return ok(Object.freeze({ headSha: artifact.headSha, diffHash: artifact.diffHash }), meta)
}

/** Read the commands of a verdict draft. */
function readCommands(value: unknown, meta: OperationMeta): Result<readonly ReviewCommandOutcome[]> {
  if (value === undefined) return ok(Object.freeze([]), meta)
  if (!Array.isArray(value)) {
    return refuse('CONTRACT_MISMATCH', 'dsh-mywork: verdict commands must be an array', {}, meta)
  }
  const commands: ReviewCommandOutcome[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      return refuse('CONTRACT_MISMATCH', 'dsh-mywork: a verdict command must be an object', {}, meta)
    }
    const command = entry as Record<string, unknown>
    if (typeof command['command'] !== 'string' || command['command'].trim() === '') {
      return refuse('CONTRACT_MISMATCH', 'dsh-mywork: a verdict command needs the command that was run', {}, meta)
    }
    if (!Number.isSafeInteger(command['exitCode'])) {
      return refuse(
        'CONTRACT_MISMATCH',
        'dsh-mywork: a verdict command needs the integer exit code it settled with',
        { command: command['command'] },
        meta,
      )
    }
    if (typeof command['observation'] !== 'string') {
      return refuse(
        'CONTRACT_MISMATCH',
        'dsh-mywork: a verdict command needs the observation it produced',
        { command: command['command'] },
        meta,
      )
    }
    commands.push(
      Object.freeze({
        command: command['command'],
        exitCode: Number(command['exitCode']),
        observation: command['observation'],
      }),
    )
  }
  return ok(Object.freeze(commands), meta)
}

/** Read the findings of a verdict draft, closing severity and status. */
function readFindings(value: unknown, meta: OperationMeta): Result<readonly ReviewFinding[]> {
  if (value === undefined) return ok(Object.freeze([]), meta)
  if (!Array.isArray(value)) {
    return refuse('CONTRACT_MISMATCH', 'dsh-mywork: verdict findings must be an array', {}, meta)
  }
  const findings: ReviewFinding[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      return refuse('CONTRACT_MISMATCH', 'dsh-mywork: a finding must be an object', {}, meta)
    }
    const finding = entry as Record<string, unknown>
    const id = finding['id']
    if (typeof id !== 'string' || id.trim() === '') {
      return refuse('CONTRACT_MISMATCH', 'dsh-mywork: a finding needs a non-empty id', {}, meta)
    }
    const severity = finding['severity']
    if (typeof severity !== 'string' || !(REVIEW_FINDING_SEVERITIES as readonly string[]).includes(severity)) {
      return refuse(
        'CONTRACT_MISMATCH',
        `dsh-mywork: finding "${id}" needs a severity of ${REVIEW_FINDING_SEVERITIES.join(', ')}`,
        { finding: id, severity: typeof severity === 'string' ? severity : null, allowed: [...REVIEW_FINDING_SEVERITIES] },
        meta,
      )
    }
    const summary = finding['summary']
    if (typeof summary !== 'string' || summary.trim() === '') {
      return refuse('CONTRACT_MISMATCH', `dsh-mywork: finding "${id}" needs a non-empty summary`, { finding: id }, meta)
    }
    const status = finding['status']
    if (typeof status !== 'string' || !(REVIEW_FINDING_STATUSES as readonly string[]).includes(status)) {
      return refuse(
        'CONTRACT_MISMATCH',
        `dsh-mywork: finding "${id}" needs a status of ${REVIEW_FINDING_STATUSES.join(', ')}`,
        { finding: id, status: typeof status === 'string' ? status : null, allowed: [...REVIEW_FINDING_STATUSES] },
        meta,
      )
    }
    const location = finding['location']
    const detail = finding['detail']
    if (location !== undefined && typeof location !== 'string') {
      return refuse(
        'CONTRACT_MISMATCH',
        `dsh-mywork: finding "${id}" carries a location that is not a string`,
        { finding: id },
        meta,
      )
    }
    if (detail !== undefined && typeof detail !== 'string') {
      return refuse('CONTRACT_MISMATCH', `dsh-mywork: finding "${id}" carries a detail that is not a string`, { finding: id }, meta)
    }
    findings.push(
      Object.freeze({
        id,
        severity: severity as ReviewFinding['severity'],
        summary,
        status: status as ReviewFinding['status'],
        ...(location === undefined ? {} : { location }),
        ...(detail === undefined ? {} : { detail }),
      }),
    )
  }
  return ok(Object.freeze(findings), meta)
}

/** Read the claims a reviewer could not reproduce. */
function readUnverified(value: unknown, meta: OperationMeta): Result<readonly ReviewUnverifiedClaim[]> {
  if (value === undefined) return ok(Object.freeze([]), meta)
  if (!Array.isArray(value)) {
    return refuse('CONTRACT_MISMATCH', 'dsh-mywork: verdict unverified claims must be an array', {}, meta)
  }
  const claims: ReviewUnverifiedClaim[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      return refuse('CONTRACT_MISMATCH', 'dsh-mywork: an unverified claim must be an object', {}, meta)
    }
    const claim = entry as Record<string, unknown>
    if (typeof claim['claim'] !== 'string' || claim['claim'].trim() === '') {
      return refuse('CONTRACT_MISMATCH', 'dsh-mywork: an unverified claim needs the claim it is about', {}, meta)
    }
    if (typeof claim['reason'] !== 'string' || claim['reason'].trim() === '') {
      return refuse('CONTRACT_MISMATCH', 'dsh-mywork: an unverified claim needs why it could not be reproduced', {}, meta)
    }
    const command = claim['command']
    if (command !== undefined && typeof command !== 'string') {
      return refuse('CONTRACT_MISMATCH', 'dsh-mywork: an unverified claim carries a command that is not a string', {}, meta)
    }
    claims.push(
      Object.freeze({
        claim: claim['claim'],
        reason: claim['reason'],
        ...(command === undefined ? {} : { command }),
      }),
    )
  }
  return ok(Object.freeze(claims), meta)
}

/** Read an array of strings. */
function readStrings(value: unknown, field: string, meta: OperationMeta): Result<readonly string[]> {
  if (value === undefined) return ok(Object.freeze([]), meta)
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    return refuse('CONTRACT_MISMATCH', `dsh-mywork: ${field} must be an array of strings`, { field }, meta)
  }
  return ok(Object.freeze([...value] as string[]), meta)
}

/**
 * Read a verdict draft, closing every dictionary it carries (E-22 (а), (б)).
 *
 * The identity fields are refused rather than ignored: a draft that carries
 * `reviewed`, `reviewId`, or a reviewer identity is a caller trying to state
 * what only the queue may state.
 * @param value - the draft as the reviewer stated it.
 * @param meta - operation identity.
 */
export function readReviewVerdictDraft(value: unknown, meta: OperationMeta): Result<ReviewVerdictDraft> {
  if (typeof value !== 'object' || value === null) {
    return refuse('CONTRACT_MISMATCH', 'dsh-mywork: a review verdict draft must be an object', {}, meta)
  }
  const draft = value as Record<string, unknown>
  const declared = ['verdict', 'justification', 'commands', 'findings', 'unverified', 'limitations']
  for (const key of Object.keys(draft)) {
    if (!declared.includes(key)) {
      return refuse(
        'CONTRACT_MISMATCH',
        `dsh-mywork: a review verdict draft carries no "${key}"; the queue fills the identity and the reviewed artifact itself`,
        { field: key, declared },
        meta,
      )
    }
  }
  const verdict = draft['verdict']
  if (typeof verdict !== 'string' || !(REVIEW_VERDICTS as readonly string[]).includes(verdict)) {
    return refuse(
      'CONTRACT_MISMATCH',
      `dsh-mywork: a review verdict must be one of ${REVIEW_VERDICTS.map(entry => `"${entry}"`).join(', ')}`,
      { verdict: typeof verdict === 'string' ? verdict : null, allowed: [...REVIEW_VERDICTS] },
      meta,
    )
  }
  const justification = draft['justification']
  if (typeof justification !== 'string' || justification.trim() === '') {
    return refuse('CONTRACT_MISMATCH', 'dsh-mywork: a review verdict needs a non-empty justification', {}, meta)
  }
  const commands = readCommands(draft['commands'], meta)
  if (!commands.ok) return fail(commands.error, meta)
  const findings = readFindings(draft['findings'], meta)
  if (!findings.ok) return fail(findings.error, meta)
  const unverified = readUnverified(draft['unverified'], meta)
  if (!unverified.ok) return fail(unverified.error, meta)
  const limitations = readStrings(draft['limitations'], 'limitations', meta)
  if (!limitations.ok) return fail(limitations.error, meta)

  return ok(
    Object.freeze({
      verdict: verdict as ReviewVerdict,
      justification,
      commands: commands.value,
      findings: findings.value,
      unverified: unverified.value,
      limitations: limitations.value,
    }),
    meta,
  )
}

/**
 * The review loops a task may consume.
 *
 * The §30 budget of the task is the authority: `maxAttempts` counts the attempts
 * of one task, and a review loop that creates an attempt is exactly what it
 * bounds. A deployment that declared no limit falls back to the queue's own
 * default, and the number is reported in the outcome so no caller has to guess
 * which limit applied.
 * @param budget - the task's §30 limits, when the caller read them.
 * @param fallback - the deployment's own default, when it stated one.
 */
export function resolveReviewLoopLimit(budget: BudgetLimits | undefined, fallback: number | undefined): number {
  const declared = budget?.maxAttempts
  if (declared !== undefined) return declared
  return fallback ?? DEFAULT_MAX_REVIEW_LOOPS
}

/** The machine's reading of a verdict: the state it moves the review to. */
function verdictTarget(verdict: ReviewVerdict): 'approved' | 'rejected' {
  return (REVIEW_VERDICTS_PASSING as readonly string[]).includes(verdict) ? 'approved' : 'rejected'
}

/** The summary the review contract records for a stored verdict. */
function verdictSummary(payload: ReviewVerdictPayload): string {
  if (payload.findings.length === 0) return payload.justification
  return payload.findings.map(finding => `${finding.severity}: ${finding.summary}`).join('; ')
}

/** The context class findings travel to the next attempt as (§21.3). */
const HANDOFF_FINDINGS_KIND = 'raw-evidence'

/** The context class a checkpoint travels to the next attempt as (§21.3). */
const HANDOFF_CHECKPOINT_KIND = 'execution-state'

/** Build the candidates a new attempt discovers after a rejection (§21, E-24). */
function buildHandoff(
  claim: ReviewClaim,
  findings: ReviewFindings,
  checkpoint: ArtifactRef | undefined,
  at: EpochMs,
): readonly ContextCandidate[] {
  const scopes = Object.freeze([
    Object.freeze({ kind: 'task', id: claim.taskId }),
    Object.freeze({ kind: 'attempt', id: claim.attemptId }),
    Object.freeze({ kind: 'review', id: claim.reviewId }),
  ])
  const findingsUri = `review-findings:${claim.reviewId}`
  const body = JSON.stringify({ reviewId: claim.reviewId, summary: findings.summary, at })
  const candidates: ContextCandidate[] = [
    Object.freeze({
      uri: findingsUri,
      source: 'review-reject',
      kind: HANDOFF_FINDINGS_KIND,
      scopes,
      level: 'L2',
      relevance: 1,
      trust: TRUSTED_CONTEXT_TRUST,
      revision: String(claim.revision),
      contentHash: fingerprintOf(body),
      provenance: Object.freeze([
        Object.freeze({ source: 'review-reject', uri: findingsUri, revision: String(claim.revision) }),
      ]),
      content: Object.freeze({ mediaType: 'application/json', text: body }),
      attributes: Object.freeze(
        findings.artifactRef === undefined ? {} : { artifactRef: findings.artifactRef },
      ),
    }),
  ]
  if (checkpoint !== undefined) {
    candidates.push(
      Object.freeze({
        uri: `checkpoint:${checkpoint.artifactId}`,
        source: 'review-reject',
        kind: HANDOFF_CHECKPOINT_KIND,
        scopes,
        level: 'L1',
        relevance: 1,
        trust: TRUSTED_CONTEXT_TRUST,
        contentHash: checkpoint.hash,
        provenance: Object.freeze([
          Object.freeze({
            source: 'artifact',
            uri: `artifact:${checkpoint.artifactId}`,
            revision: checkpoint.hash,
            contentHash: checkpoint.hash,
          }),
        ]),
        attributes: Object.freeze({ artifactId: checkpoint.artifactId, hash: checkpoint.hash }),
      }),
    )
  }
  return Object.freeze(candidates)
}

/** The bodies a handoff provider materializes, keyed by candidate uri. */
function handoffBodies(candidates: readonly ContextCandidate[]): Readonly<Record<string, string>> {
  const bodies: Record<string, string> = {}
  for (const candidate of candidates) {
    if (candidate.content !== undefined) bodies[candidate.uri] = candidate.content.text
  }
  return Object.freeze(bodies)
}

/** The session plan §22.3 gives a rejected attempt's successor. */
function freshSessionPlan(): FreshSessionPlan {
  return Object.freeze({
    trigger: 'reject',
    preservesAttempt: false,
    reusesSession: false,
    createsSession: true,
    carriesCheckpoint: true,
    carriesFindings: true,
    carriesTranscript: false,
  })
}

/**
 * Build the review queue over an open store.
 * @param deps - store, graph, clock, migration, and optional git port.
 * @returns the queue; every call verifies its schema first.
 */
export function createReviewQueue(deps: ReviewQueueDeps): ReviewQueue {
  const { store, graph, clock, migration, git } = deps

  /** Verify the schemas this queue writes through, inside the caller's transaction. */
  function assertSchema(tx: MyWorkTransaction): void {
    assertClaimSchema(tx, [migration, EVIDENCE_TABLES_MIGRATION])
    const table = tx.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", REVIEW_CLAIM_TABLE)
    if (table === undefined) {
      throw new ExecutionError(
        'schema-missing',
        `dsh-mywork: the store is missing the "${REVIEW_CLAIM_TABLE}" table; open it with the review-claim migration`,
        { details: { table: REVIEW_CLAIM_TABLE, version: migration.version, name: migration.name } },
      )
    }
  }

  /** Read one claim inside a transaction. */
  function readClaim(tx: MyWorkTransaction, reviewId: ReviewId): ReviewClaim | undefined {
    const row = tx.get(`SELECT * FROM ${REVIEW_CLAIM_TABLE} WHERE review_id = ?`, reviewId)
    return row === undefined ? undefined : rowToClaim(row as unknown as ClaimRow)
  }

  /** Read a stored JSON document of one column, parsed and typed by the caller. */
  function readDocument<T>(tx: MyWorkTransaction, reviewId: ReviewId, column: string): T | undefined {
    const row = tx.get(`SELECT ${column} FROM ${REVIEW_CLAIM_TABLE} WHERE review_id = ?`, reviewId)
    const value = row === undefined ? undefined : row[column]
    if (value === undefined || value === null) return undefined
    return parseStored<T>(`review "${reviewId}"`, column, String(value))
  }

  /** The claim after a transition, re-read so the caller sees the stored row. */
  function settledClaim(tx: MyWorkTransaction, reviewId: ReviewId, what: string): ReviewClaim {
    const stored = readClaim(tx, reviewId)
    if (stored === undefined) {
      throw new ExecutionError('conflict', `dsh-mywork: review "${reviewId}" was not found after it ${what}`, {
        details: { reviewId, what },
      })
    }
    return stored
  }

  /** The evidence package of a claim, refused when its fingerprint no longer holds. */
  function evidenceOfClaim(tx: MyWorkTransaction, claim: ReviewClaim): ReviewEvidencePackage | undefined {
    const stored = readDocument<ReviewEvidencePackage>(tx, claim.reviewId, 'evidence')
    if (stored === undefined) return undefined
    const { fingerprint, ...rest } = stored
    if (fingerprintOf(rest) !== fingerprint) {
      throw new ExecutionError(
        'conflict',
        `dsh-mywork: the evidence package of review "${claim.reviewId}" does not match its fingerprint`,
        { details: { reviewId: claim.reviewId, fingerprint } },
      )
    }
    return Object.freeze({ ...rest, fingerprint })
  }

  /** Assemble the evidence package, refusing any incomplete input (E-22). */
  function assembleEvidence(
    claim: ReviewClaim,
    input: ReviewEvidenceInput,
    assembledAt: EpochMs,
    meta: OperationMeta,
  ): Result<ReviewEvidencePackage> {
    const reviewed = readReviewedArtifact(input?.reviewed, 'evidence.reviewed', meta)
    if (!reviewed.ok) return fail(reviewed.error, meta)
    const diff = readArtifactRef(input?.diff, 'evidence.diff', meta)
    if (!diff.ok) return fail(diff.error, meta)
    const workerReport = readArtifactRef(input?.workerReport, 'evidence.workerReport', meta)
    if (!workerReport.ok) return fail(workerReport.error, meta)
    const contextSnapshot = readArtifactRef(input?.contextSnapshot, 'evidence.contextSnapshot', meta)
    if (!contextSnapshot.ok) return fail(contextSnapshot.error, meta)
    const gates: ArtifactRef[] = []
    for (const [index, gate] of (input?.gates ?? []).entries()) {
      const ref = readArtifactRef(gate, `evidence.gates[${index}]`, meta)
      if (!ref.ok) return fail(ref.error, meta)
      gates.push(ref.value)
    }
    let checkpoint: ArtifactRef | undefined
    if (input?.checkpoint !== undefined) {
      const ref = readArtifactRef(input.checkpoint, 'evidence.checkpoint', meta)
      if (!ref.ok) return fail(ref.error, meta)
      checkpoint = ref.value
    }
    const withoutFingerprint = {
      reviewId: claim.reviewId,
      attemptId: claim.attemptId,
      taskId: claim.taskId,
      reviewed: reviewed.value,
      diff: diff.value,
      gates: Object.freeze(gates),
      workerReport: workerReport.value,
      contextSnapshot: contextSnapshot.value,
      ...(checkpoint === undefined ? {} : { checkpoint }),
      assembledAt,
    }
    return ok(Object.freeze({ ...withoutFingerprint, fingerprint: fingerprintOf(withoutFingerprint) }), meta)
  }

  /** The attempt under review, or a refusal that names why the review cannot exist. */
  function requireAttempt(tx: MyWorkTransaction, attemptId: AttemptId, meta: OperationMeta): Result<AttemptRecord> {
    const attempt = readAttempt(tx, attemptId)
    if (attempt === undefined) {
      return refuse(
        'TASK_CONFLICT',
        `dsh-mywork: attempt "${attemptId}" does not exist, so it cannot be reviewed`,
        { attemptId },
        meta,
      )
    }
    if (attempt.settledAt === undefined) {
      return refuse(
        'TASK_CONFLICT',
        `dsh-mywork: attempt "${attemptId}" is still live; a review starts only after the work settled`,
        { attemptId, state: attempt.state },
        meta,
      )
    }
    return ok(attempt, meta)
  }

  /**
   * The review contract value of a stored claim.
   *
   * Only a claimed review has one: the §18.3 contract names the reviewer, and a
   * queued review has none. The refusal is an exception rather than a `Result`
   * because reaching it means the caller applied the machine to a review that
   * nobody holds, which is a defect of this layer and not a domain condition.
   */
  function toReview(claim: ReviewClaim, findings: ReviewFindings | undefined): Review {
    if (claim.reviewerId === undefined) {
      throw new ExecutionError(
        'conflict',
        `dsh-mywork: review "${claim.reviewId}" has no reviewer, so the state machine cannot be applied to it`,
        { details: { reviewId: claim.reviewId, state: claim.state } },
      )
    }
    return Object.freeze({
      id: claim.reviewId,
      taskId: claim.taskId,
      attemptId: claim.attemptId,
      reviewerId: claim.reviewerId,
      state: claim.state,
      revision: claim.revision,
      requestedAt: claim.requestedAt,
      artifact: Object.freeze({ headSha: claim.headSha, diffHash: claim.diffHash }),
      ...(findings === undefined ? {} : { findings }),
      ...(claim.settledAt === undefined ? {} : { settledAt: claim.settledAt }),
    })
  }

  /** The findings a stored verdict implies, for the review contract value. */
  function findingsOf(tx: MyWorkTransaction, claim: ReviewClaim): ReviewFindings | undefined {
    const payload = readDocument<ReviewVerdictPayload>(tx, claim.reviewId, 'verdict')
    if (payload === undefined) return undefined
    return Object.freeze({
      summary: verdictSummary(payload),
      artifactRef: `review-verdict:${claim.reviewId}:r${claim.revision}`,
    })
  }

  /**
   * Move a stored review with a compare-and-set on the revision the caller read.
   *
   * The `WHERE` clause re-states the condition, so two callers racing for the
   * same review cannot both win and a repeated call changes no row.
   */
  function casClaim(
    tx: MyWorkTransaction,
    claim: ReviewClaim,
    to: Review['state'],
    at: EpochMs,
    patch: {
      readonly reviewerId?: AgentId
      readonly evidence?: string
      readonly verdict?: string
      readonly escalation?: string
      readonly handoff?: string
      readonly settle?: boolean
    } = {},
  ): boolean {
    const changed = tx.run(
      `UPDATE ${REVIEW_CLAIM_TABLE}
          SET state = ?, revision = revision + 1, updated_at = ?,
              reviewer_id = COALESCE(?, reviewer_id),
              evidence    = COALESCE(?, evidence),
              verdict     = COALESCE(?, verdict),
              escalation  = COALESCE(?, escalation),
              handoff     = COALESCE(?, handoff),
              settled_at  = CASE WHEN ? = 1 THEN ? ELSE settled_at END
        WHERE review_id = ? AND revision = ? AND state = ?`,
      to,
      at,
      patch.reviewerId ?? null,
      patch.evidence ?? null,
      patch.verdict ?? null,
      patch.escalation ?? null,
      patch.handoff ?? null,
      patch.settle === true ? 1 : 0,
      at,
      claim.reviewId,
      claim.revision,
      claim.state,
    )
    return changed === 1
  }

  /** Turn a lost compare-and-set into the `STALE_REVISION` the caller acted on. */
  function staleRevision<T>(
    tx: MyWorkTransaction,
    claim: ReviewClaim,
    expected: Revision,
    meta: OperationMeta,
  ): Result<T> {
    const current = readClaim(tx, claim.reviewId)
    return refuse(
      'STALE_REVISION',
      `dsh-mywork: review "${claim.reviewId}" is at revision ${current?.revision ?? claim.revision} in state "${current?.state ?? claim.state}", not revision ${expected} in state "${claim.state}"`,
      {
        reviewId: claim.reviewId,
        expectedRevision: expected,
        observedRevision: claim.revision,
        observedState: claim.state,
        currentRevision: current?.revision ?? null,
        currentState: current?.state ?? null,
      },
      meta,
    )
  }

  /** Apply one pure machine transition to the stored review. */
  function applyTransition(
    tx: MyWorkTransaction,
    claim: ReviewClaim,
    command: Parameters<typeof transitionReview>[1],
    meta: OperationMeta,
  ): Result<ReviewProgress> {
    const transition = transitionReview(toReview(claim, findingsOf(tx, claim)), command, meta)
    if (!transition.ok) return fail(transition.error, meta)
    const to = transition.value.to
    const settle = to === 'approved' || to === 'rejected' || to === 'escalated' || to === 'cancelled'
    if (!casClaim(tx, claim, to, command.at, settle ? { settle: true } : {})) {
      return staleRevision(tx, claim, command.expectedRevision ?? claim.revision, meta)
    }
    const stored = settledClaim(tx, claim.reviewId, `moved to "${to}"`)
    return ok(Object.freeze({ claim: stored, review: toReview(stored, transition.value.review.findings) }), meta)
  }

  /** Store one JSON document as an artifact of the review (§32). */
  function writeArtifact(
    tx: MyWorkTransaction,
    request: { readonly artifactId: string; readonly payload: unknown; readonly contentType: string },
    claim: ReviewClaim,
    at: EpochMs,
    meta: OperationMeta,
  ): Result<ArtifactRef> {
    try {
      const written = putArtifact(
        tx,
        {
          artifactId: request.artifactId,
          kind: 'review-verdict',
          workspaceId: claim.workspaceId,
          correlationId: meta.correlationId,
          contentType: request.contentType,
          bytes: new TextEncoder().encode(JSON.stringify(request.payload)),
          taskId: claim.taskId,
          attemptId: claim.attemptId,
          reviewId: claim.reviewId,
        },
        at,
      )
      return ok(written.ref, meta)
    } catch (error) {
      const code = (error as { readonly code?: unknown }).code
      return refuse(
        'TASK_CONFLICT',
        `dsh-mywork: the artifact "${request.artifactId}" of review "${claim.reviewId}" could not be stored (${String(code ?? 'unknown')})`,
        { reviewId: claim.reviewId, artifactId: request.artifactId, reason: String(code ?? null) },
        meta,
      )
    }
  }

  /** Refuse an automatic actor on a path that decides, in D15's own words (R-42). */
  function refuseAutomatic<T>(
    actor: Extract<ReviewActor, { readonly kind: 'automatic' }>,
    claim: ReviewClaim,
    path: string,
    meta: OperationMeta,
  ): Result<T> {
    const ruling = ruleOnAutoReview({ verdict: actor.verdict, autoReviewActive: actor.autoReviewActive })
    const vocabulary = assertAutoReviewCommand('review.approve', meta)
    return refuse(
      'SECURITY_DENIED',
      `dsh-mywork: an automatic reviewer cannot ${path} review "${claim.reviewId}" (ruling "${ruling.kind}"); its whole vocabulary is ${AUTO_REVIEW_COMMANDS.join(', ')}, and "review.approve" is ${vocabulary.ok ? 'allowed' : 'refused'} for it — D15 keeps approval with a human`,
      {
        reviewId: claim.reviewId,
        path,
        ruling: ruling.kind,
        automaticCommands: [...AUTO_REVIEW_COMMANDS],
        approveAllowedForAutomatic: vocabulary.ok,
      },
      meta,
    )
  }

  /**
   * Admit D15's one command an automatic approver may cause — and only that one.
   *
   * `review.request-changes` is the strongest thing an LLM approver is allowed to
   * reach (core `AUTO_REVIEW_COMMANDS`), and in this queue it is the reject path:
   * the task asks for changes and a new attempt is made. An answer that asks to
   * *allow* is not a change request — it is a decision only a human may take, so
   * it is refused here and the caller raises the §28 request instead.
   */
  function admitAutomaticChangeRequest(
    actor: Extract<ReviewActor, { readonly kind: 'automatic' }>,
    claim: ReviewClaim,
    meta: OperationMeta,
  ): Result<true> {
    const vocabulary = assertAutoReviewCommand('review.request-changes', meta)
    if (!vocabulary.ok) return fail(vocabulary.error, meta)
    const ruling = ruleOnAutoReview({ verdict: actor.verdict, autoReviewActive: actor.autoReviewActive })
    if (ruling.kind === 'denied') return ok(true, meta)
    return refuse(
      'SECURITY_DENIED',
      `dsh-mywork: an automatic reviewer asked to allow review "${claim.reviewId}" and may not turn that into a rejection; the decision escalates to a human (§28 ${ruling.gate}, D15)`,
      {
        reviewId: claim.reviewId,
        path: 'reject',
        ruling: ruling.kind,
        gate: ruling.gate,
        automaticCommands: [...AUTO_REVIEW_COMMANDS],
      },
      meta,
    )
  }

  /** The reviewer grant of an agent actor, or the refusal its provenance earns. */
  function admitReviewer(
    actor: ReviewActor,
    claim: ReviewClaim,
    path: string,
    meta: OperationMeta,
  ): Result<ReviewerGrant> {
    if (actor?.kind === 'automatic') return refuseAutomatic<ReviewerGrant>(actor, claim, path, meta)
    if (actor?.kind !== 'agent') {
      return refuse(
        'SECURITY_DENIED',
        'dsh-mywork: a review decision must state who is making it; an anonymous decision is refused (§31)',
        { reviewId: claim.reviewId, path },
        meta,
      )
    }
    const grant = actor.grant
    const identity = typeof grant?.agentId === 'string' ? grant.agentId : ''
    if (identity.trim() === '') {
      return refuse(
        'SECURITY_DENIED',
        'dsh-mywork: a reviewer must state its durable identity (§13.4)',
        { reviewId: claim.reviewId, path },
        meta,
      )
    }
    const independent = assertReviewerIndependence({ workerAgentId: claim.workerAgentId, reviewerAgentId: identity }, meta)
    if (!independent.ok) return fail(independent.error, meta)
    const readOnly = assertReviewerReadOnly(grant.permissions ?? [], meta)
    if (!readOnly.ok) return fail(readOnly.error, meta)
    // §31: the domain invariant knows `workspace.write`; the contract also names
    // the other two ways a reviewer could change what it reviews — a commit
    // (`git.write`) and a shell — and a grant holding either is refused here, at
    // the admission point, rather than trusted to a prompt.
    const held = grant.permissions ?? []
    const writes = held.filter(permission => IMPLEMENTATION_WRITE_PERMISSIONS.includes(permission))
    if (writes.length > 0) {
      return refuse(
        'SECURITY_DENIED',
        `dsh-mywork: a reviewer must not hold ${writes.join(', ')}; that would let it change the implementation it reviews (§31)`,
        { reviewId: claim.reviewId, path, permissions: [...held], refused: Object.freeze(writes) },
        meta,
      )
    }
    return ok(Object.freeze({ ...grant, agentId: identity }), meta)
  }

  /** The review scope the session starter composes the reviewer's session from. */
  function scopeOfClaim(tx: MyWorkTransaction, claim: ReviewClaim): ReviewRunScope | undefined {
    if (claim.reviewerId === undefined) return undefined
    const evidence = evidenceOfClaim(tx, claim)
    if (evidence === undefined) return undefined
    return Object.freeze({
      reviewId: claim.reviewId,
      taskId: claim.taskId,
      attemptId: claim.attemptId,
      workspaceId: claim.workspaceId,
      reviewerId: claim.reviewerId,
      workerAgentId: claim.workerAgentId,
      agentPreset: REVIEW_AGENT_PRESET,
      pool: REVIEW_POOL,
      purpose: REVIEW_SESSION_PURPOSE,
      permission: REVIEW_HARNESS_POLICY,
      permissions: REVIEWER_DEFAULT_PERMISSIONS,
      fresh: true,
      carriesTranscript: false,
      evidence,
    })
  }

  /**
 * Artifact identity of one approval (§19, E-23).
 *
 * The identity is a function of the review and the exact artifact the approval
 * covers, so the same approval composes the same id — which is what makes a
 * repeat approval read the stored record instead of writing a second one — while
 * another head or another diff composes another id, so two approvals never
 * collide on one artifact. The reviewed SHAs are folded into a fingerprint
 * instead of being spelled out because the evidence schema caps an artifact id
 * at {@link ARTIFACT_ID_MAX_LENGTH} characters and a head plus a diff hash alone
 * is longer than that.
 * @param reviewId - review the approval belongs to.
 * @param artifact - artifact the approval covers.
 * @returns the artifact id, or `undefined` when the review leaves no room for one.
 */
function approvalArtifactId(reviewId: ReviewId, artifact: ReviewedArtifact): string | undefined {
  const prefix = `${APPROVAL_ARTIFACT_PREFIX}${reviewId}:`
  const room = ARTIFACT_ID_MAX_LENGTH - prefix.length
  if (room < APPROVAL_FINGERPRINT_MIN_CHARS) return undefined
  const fingerprint = createHash('sha256')
    .update(`${reviewId}:${artifact.headSha}:${artifact.diffHash}`)
    .digest('hex')
  return `${prefix}${fingerprint.slice(0, Math.min(APPROVAL_FINGERPRINT_CHARS, room))}`
}

/** Write the approval record and remember its identity in the row. */
  function recordApproval(
    tx: MyWorkTransaction,
    claim: ReviewClaim,
    artifact: ReviewedArtifact,
    at: EpochMs,
    meta: OperationMeta,
  ): Result<ArtifactRef> {
    if (claim.reviewerId === undefined) {
      return refuse(
        'TASK_CONFLICT',
        `dsh-mywork: review "${claim.reviewId}" has no reviewer, so no approval can be recorded`,
        { reviewId: claim.reviewId },
        meta,
      )
    }
    const artifactId = approvalArtifactId(claim.reviewId, artifact)
    if (artifactId === undefined) {
      return refuse(
        'TASK_CONFLICT',
        `dsh-mywork: the artifact id of review "${claim.reviewId}" does not fit ${ARTIFACT_ID_MAX_LENGTH} characters, so its approval cannot be stored`,
        { reviewId: claim.reviewId },
        meta,
      )
    }
    const written = writeArtifact(
      tx,
      {
        artifactId,
        contentType: REVIEW_APPROVAL_CONTENT_TYPE,
        payload: Object.freeze({
          schema: REVIEW_APPROVAL_SCHEMA,
          reviewId: claim.reviewId,
          taskId: claim.taskId,
          attemptId: claim.attemptId,
          reviewerId: claim.reviewerId,
          reviewed: artifact,
          at,
        }),
      },
      claim,
      at,
      meta,
    )
    if (!written.ok) return fail(written.error, meta)
    const stored = JSON.stringify({ artifactId: written.value.artifactId, hash: written.value.hash })
    const changed = tx.run(`UPDATE ${REVIEW_CLAIM_TABLE} SET approval = ? WHERE review_id = ?`, stored, claim.reviewId)
    if (changed !== 1) {
      throw new ExecutionError('conflict', `dsh-mywork: the approval of review "${claim.reviewId}" could not be recorded`, {
        details: { reviewId: claim.reviewId },
      })
    }
    return ok(written.value, meta)
  }

  /** How many reviews of a task were rejected, this one included. */
  function rejectedCount(tx: MyWorkTransaction, taskId: TaskId): number {
    const row = tx.get(
      `SELECT COUNT(*) AS rejected FROM ${REVIEW_CLAIM_TABLE} WHERE task_id = ? AND state = 'rejected'`,
      taskId,
    )
    return row === undefined ? 0 : Number(row['rejected'])
  }

  /** Read a task from the graph, turning an unreachable adapter into a typed refusal. */
  async function readTask(taskId: TaskId, meta: OperationMeta): Promise<Result<Task>> {
    try {
      return ok(await graph.get(taskId), meta)
    } catch (error) {
      return refuse(
        'ADAPTER_UNAVAILABLE',
        `dsh-mywork: the task graph could not answer about "${taskId}": ${String((error as Error)?.message ?? error)}`,
        { taskId },
        meta,
      )
    }
  }

  /** Move the task through the graph, tolerating a retry that already moved it. */
  async function moveTask(taskId: TaskId, to: TaskState, meta: OperationMeta): Promise<Result<Task>> {
    const current = await readTask(taskId, meta)
    if (!current.ok) return fail(current.error, meta)
    if (current.value.state === to) return ok(current.value, meta)
    try {
      const moved = await graph.transition({ id: taskId, to, meta, expectedRevision: current.value.revision })
      return ok(moved, meta)
    } catch (error) {
      return refuse(
        'ADAPTER_UNAVAILABLE',
        `dsh-mywork: task "${taskId}" could not be moved to "${to}": ${String((error as Error)?.message ?? error)}`,
        { taskId, to, state: current.value.state },
        meta,
      )
    }
  }

  return {
    async requestReview(command: RequestReviewCommand): Promise<Result<ReviewRequestOutcome>> {
      const meta = command.meta
      const attempt = store.transaction(tx => {
        assertSchema(tx)
        return requireAttempt(tx, command.attemptId, meta)
      })
      if (!attempt.ok) return fail(attempt.error, meta)
      const reviewed = readReviewedArtifact(command?.evidence?.reviewed, 'evidence.reviewed', meta)
      if (!reviewed.ok) return fail(reviewed.error, meta)

      // §19, E-17: no passing required gate for this exact head means no review.
      // The gate check is called from here — the review queue is its only caller
      // on the admission path — and a malformed argument is refused rather than
      // thrown, so this method keeps its `Result` contract.
      const gateResults = readGateResults(store, attempt.value.id)
      if (!gateResults.ok) return fail(gateResults.error, meta)
      let gates: Result<GateAdmission>
      try {
        gates = assertGatesSatisfied(attempt.value.id, reviewed.value.headSha, gateResults.value)
      } catch (error) {
        return refuse(
          'CONTRACT_MISMATCH',
          `dsh-mywork: the gates of attempt "${attempt.value.id}" could not be judged for head ${reviewed.value.headSha}: ${String((error as Error)?.message ?? error)}`,
          { attemptId: attempt.value.id, headSha: reviewed.value.headSha },
          meta,
        )
      }
      if (!gates.ok) return fail(gates.error, meta)

      // The graph is the authority for the task's state (§7): the queue reads it
      // and refuses, rather than moving the task into a state the worker owns.
      const task = await readTask(attempt.value.taskId, meta)
      if (!task.ok) return fail(task.error, meta)
      if (task.value.state !== 'awaiting-review') {
        return refuse(
          'TASK_CONFLICT',
          `dsh-mywork: task "${attempt.value.taskId}" is in "${task.value.state}"; a review is requested from "awaiting-review"`,
          { taskId: attempt.value.taskId, state: task.value.state },
          meta,
        )
      }

      const at = clock.now()
      return store.transaction(tx => {
        assertSchema(tx)
        const existing = tx.get(
          `SELECT * FROM ${REVIEW_CLAIM_TABLE} WHERE attempt_id = ? AND head_sha = ?`,
          attempt.value.id,
          reviewed.value.headSha,
        )
        if (existing !== undefined) {
          const claim = rowToClaim(existing as unknown as ClaimRow)
          const stored = evidenceOfClaim(tx, claim)
          // The offered package is assembled at the stored instant, so a retry of
          // the same request compares its content rather than its assembling time.
          const offered = assembleEvidence(claim, command.evidence, stored?.assembledAt ?? at, meta)
          if (!offered.ok) return fail(offered.error, meta)
          if (stored === undefined || stored.fingerprint !== offered.value.fingerprint) {
            return refuse(
              'TASK_CONFLICT',
              `dsh-mywork: review "${claim.reviewId}" is already queued for this attempt and head with another evidence package; evidence is immutable (§32)`,
              {
                reviewId: claim.reviewId,
                storedFingerprint: stored?.fingerprint ?? null,
                offeredFingerprint: offered.value.fingerprint,
              },
              meta,
            )
          }
          return ok(Object.freeze({ claim, evidence: stored, gates: gates.value.results, created: false }), meta)
        }

        const claim: ReviewClaim = Object.freeze({
          reviewId: `R-${randomUUID()}`,
          attemptId: attempt.value.id,
          taskId: attempt.value.taskId,
          workspaceId: attempt.value.workspaceId,
          workerAgentId: attempt.value.agentId,
          headSha: reviewed.value.headSha,
          diffHash: reviewed.value.diffHash,
          state: 'queued',
          revision: 1,
          requestedAt: at,
          updatedAt: at,
        })
        const evidence = assembleEvidence(claim, command.evidence, at, meta)
        if (!evidence.ok) return fail(evidence.error, meta)
        tx.run(
          `INSERT INTO ${REVIEW_CLAIM_TABLE}
             (review_id, attempt_id, task_id, workspace_id, worker_agent_id, head_sha, diff_hash,
              state, revision, reviewer_id, evidence, verdict, escalation, handoff, approval,
              requested_at, settled_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, ?, NULL, ?)`,
          claim.reviewId,
          claim.attemptId,
          claim.taskId,
          claim.workspaceId,
          claim.workerAgentId,
          claim.headSha,
          claim.diffHash,
          claim.state,
          claim.revision,
          JSON.stringify(evidence.value),
          claim.requestedAt,
          claim.updatedAt,
        )
        return ok(Object.freeze({ claim, evidence: evidence.value, gates: gates.value.results, created: true }), meta)
      })
    },

    claimReview(command: ClaimReviewCommand): Result<ReviewProgress> {
      const meta = command.meta
      return store.transaction(tx => {
        assertSchema(tx)
        const claim = readClaim(tx, command.reviewId)
        if (claim === undefined) {
          return refuse('TASK_CONFLICT', `dsh-mywork: review "${command.reviewId}" does not exist`, { reviewId: command.reviewId }, meta)
        }
        // The revision is checked before the state, exactly as `transitionReview`
        // does: a caller that read an older revision is answered with the code
        // that tells it to re-read, not with a conflict it cannot resolve.
        if (command.expectedRevision !== claim.revision) return staleRevision(tx, claim, command.expectedRevision, meta)
        if (claim.state !== 'queued') {
          return refuse(
            'TASK_CONFLICT',
            `dsh-mywork: review "${claim.reviewId}" is in "${claim.state}"; only a queued review is claimed`,
            { reviewId: claim.reviewId, state: claim.state },
            meta,
          )
        }
        if (!canTransitionReview(claim.state, 'claimed')) {
          return refuse(
            'TASK_CONFLICT',
            `dsh-mywork: the review state machine does not move "${claim.state}" to "claimed"`,
            { reviewId: claim.reviewId, from: claim.state },
            meta,
          )
        }
        // E-19 (е): a live worker attempt and a live review of one task are
        // mutually exclusive. The worker side is enforced by the attempt index
        // (§17); this is the review side of the same rule.
        const liveAttempt = readLiveAttempt(tx, claim.taskId)
        if (liveAttempt !== undefined) {
          return refuse(
            'TASK_CONFLICT',
            `dsh-mywork: task "${claim.taskId}" still holds live attempt "${liveAttempt.id}"; a review and a worker attempt are never live at once`,
            { taskId: claim.taskId, attemptId: liveAttempt.id, reviewId: claim.reviewId },
            meta,
          )
        }
        const grant = admitReviewer(command.actor, claim, 'claim', meta)
        if (!grant.ok) return fail(grant.error, meta)
        if (!casClaim(tx, claim, 'claimed', clock.now(), { reviewerId: grant.value.agentId })) {
          return staleRevision(tx, claim, command.expectedRevision, meta)
        }
        const stored = settledClaim(tx, claim.reviewId, 'was claimed')
        return ok(Object.freeze({ claim: stored, review: toReview(stored, findingsOf(tx, stored)) }), meta)
      })
    },

    beginReviewing(command: ReviewRevisionCommand): Result<ReviewProgress> {
      const meta = command.meta
      return store.transaction(tx => {
        assertSchema(tx)
        const claim = readClaim(tx, command.reviewId)
        if (claim === undefined) {
          return refuse('TASK_CONFLICT', `dsh-mywork: review "${command.reviewId}" does not exist`, { reviewId: command.reviewId }, meta)
        }
        if (claim.reviewerId === undefined) {
          return refuse(
            'TASK_CONFLICT',
            `dsh-mywork: review "${claim.reviewId}" has no reviewer; claim it before starting`,
            { reviewId: claim.reviewId, state: claim.state },
            meta,
          )
        }
        return applyTransition(tx, claim, { to: 'reviewing', expectedRevision: command.expectedRevision, at: clock.now() }, meta)
      })
    },

    async submitVerdict(command: SubmitVerdictCommand): Promise<Result<ReviewVerdictOutcome>> {
      const meta = command.meta
      const draft = readReviewVerdictDraft(command.draft, meta)
      if (!draft.ok) return fail(draft.error, meta)
      const at = clock.now()
      return store.transaction(tx => {
        assertSchema(tx)
        const claim = readClaim(tx, command.reviewId)
        if (claim === undefined) {
          return refuse('TASK_CONFLICT', `dsh-mywork: review "${command.reviewId}" does not exist`, { reviewId: command.reviewId }, meta)
        }
        if (claim.reviewerId === undefined) {
          return refuse(
            'TASK_CONFLICT',
            `dsh-mywork: review "${claim.reviewId}" has no reviewer, so no verdict can be recorded`,
            { reviewId: claim.reviewId, state: claim.state },
            meta,
          )
        }
        const to = verdictTarget(draft.value.verdict)
        const findings = draft.value.findings ?? []
        const machineFindings: ReviewFindings | undefined =
          findings.length === 0
            ? undefined
            : Object.freeze({
                summary: verdictSummary({
                  schema: REVIEW_VERDICT_SCHEMA,
                  reviewId: claim.reviewId,
                  taskId: claim.taskId,
                  attemptId: claim.attemptId,
                  reviewerId: claim.reviewerId,
                  verdict: draft.value.verdict,
                  reviewed: { headSha: claim.headSha, diffHash: claim.diffHash },
                  justification: draft.value.justification,
                  commands: [],
                  findings,
                  unverified: [],
                  limitations: [],
                  at,
                }),
                artifactRef: `review-verdict:${claim.reviewId}:r${command.expectedRevision}`,
              })
        // The state machine decides first: a refusal must leave the row, and the
        // artifact store, exactly as they were (E-22 (д), (е)).
        const moved = applyTransition(
          tx,
          claim,
          {
            to,
            expectedRevision: command.expectedRevision,
            at,
            ...(machineFindings === undefined ? {} : { findings: machineFindings }),
            ...(to === 'approved'
              ? {
                  artifact: Object.freeze({ headSha: claim.headSha, diffHash: claim.diffHash }),
                  workerAgentId: claim.workerAgentId,
                  reviewerPermissions: REVIEWER_DEFAULT_PERMISSIONS,
                }
              : {}),
          },
          meta,
        )
        if (!moved.ok) return fail(moved.error, meta)

        const payload: ReviewVerdictPayload = Object.freeze({
          schema: REVIEW_VERDICT_SCHEMA,
          reviewId: claim.reviewId,
          taskId: claim.taskId,
          attemptId: claim.attemptId,
          reviewerId: claim.reviewerId,
          verdict: draft.value.verdict,
          reviewed: Object.freeze({ headSha: claim.headSha, diffHash: claim.diffHash }),
          justification: draft.value.justification,
          commands: draft.value.commands ?? Object.freeze([]),
          findings: Object.freeze([...findings]),
          unverified: draft.value.unverified ?? Object.freeze([]),
          limitations: draft.value.limitations ?? Object.freeze([]),
          at,
        })
        const artifact = writeArtifact(
          tx,
          {
            artifactId: `review-verdict:${claim.reviewId}:r${command.expectedRevision}`,
            payload,
            contentType: REVIEW_VERDICT_CONTENT_TYPE,
          },
          claim,
          at,
          meta,
        )
        if (!artifact.ok) return fail(artifact.error, meta)
        const recorded = tx.run(
          `UPDATE ${REVIEW_CLAIM_TABLE} SET verdict = ? WHERE review_id = ?`,
          JSON.stringify(payload),
          claim.reviewId,
        )
        if (recorded !== 1) {
          throw new ExecutionError('conflict', `dsh-mywork: the verdict of review "${claim.reviewId}" could not be recorded`, {
            details: { reviewId: claim.reviewId },
          })
        }
        return ok(
          Object.freeze({
            claim: settledClaim(tx, claim.reviewId, 'recorded its verdict'),
            review: moved.value.review,
            payload,
            artifact: artifact.value,
          }),
          meta,
        )
      })
    },

    requestMoreEvidence(command: ReviewFindingsCommand): Result<ReviewProgress> {
      const meta = command.meta
      return store.transaction(tx => {
        assertSchema(tx)
        const claim = readClaim(tx, command.reviewId)
        if (claim === undefined) {
          return refuse('TASK_CONFLICT', `dsh-mywork: review "${command.reviewId}" does not exist`, { reviewId: command.reviewId }, meta)
        }
        return applyTransition(
          tx,
          claim,
          { to: 'needs-evidence', expectedRevision: command.expectedRevision, at: clock.now(), findings: command.findings },
          meta,
        )
      })
    },

    provideEvidence(command: ReviewRevisionCommand): Result<ReviewProgress> {
      const meta = command.meta
      return store.transaction(tx => {
        assertSchema(tx)
        const claim = readClaim(tx, command.reviewId)
        if (claim === undefined) {
          return refuse('TASK_CONFLICT', `dsh-mywork: review "${command.reviewId}" does not exist`, { reviewId: command.reviewId }, meta)
        }
        return applyTransition(tx, claim, { to: 'reviewing', expectedRevision: command.expectedRevision, at: clock.now() }, meta)
      })
    },

    async approveReview(command: ApproveReviewCommand): Promise<Result<ReviewApprovalOutcome>> {
      const meta = command.meta
      if (git === undefined) {
        return refuse(
          'ADAPTER_UNAVAILABLE',
          "dsh-mywork: approving a review needs the git port, because the artifact is re-read from the checkout rather than taken on the caller's word (§19)",
          { reviewId: command.reviewId },
          meta,
        )
      }
      const claim = store.transaction(tx => {
        assertSchema(tx)
        return readClaim(tx, command.reviewId)
      })
      if (claim === undefined) {
        return refuse('TASK_CONFLICT', `dsh-mywork: review "${command.reviewId}" does not exist`, { reviewId: command.reviewId }, meta)
      }
      if (claim.reviewerId === undefined) {
        return refuse(
          'TASK_CONFLICT',
          `dsh-mywork: review "${claim.reviewId}" has no reviewer, so nothing can be approved`,
          { reviewId: claim.reviewId, state: claim.state },
          meta,
        )
      }
      const admitted = admitReviewer(command.actor, claim, 'approve', meta)
      if (!admitted.ok) return fail(admitted.error, meta)
      if (command.actor.kind === 'agent' && admitted.value.agentId !== claim.reviewerId) {
        return refuse(
          'SECURITY_DENIED',
          `dsh-mywork: review "${claim.reviewId}" is held by "${claim.reviewerId}"; "${admitted.value.agentId}" may not approve it`,
          { reviewId: claim.reviewId, reviewerId: claim.reviewerId, approver: admitted.value.agentId },
          meta,
        )
      }

      const head = await git.resolveHead(command.worktree.cwd, meta)
      if (!head.ok) return fail(head.error, meta)
      const diff = await git.diffHash(command.worktree.cwd, command.worktree.baseSha, head.value, meta)
      if (!diff.ok) return fail(diff.error, meta)
      const current: ReviewedArtifact = Object.freeze({ headSha: head.value, diffHash: diff.value })
      const at = clock.now()

      return store.transaction(tx => {
        assertSchema(tx)
        const stored = readClaim(tx, command.reviewId)
        if (stored === undefined) {
          return refuse('TASK_CONFLICT', `dsh-mywork: review "${command.reviewId}" does not exist`, { reviewId: command.reviewId }, meta)
        }
        if (command.expectedRevision !== stored.revision) {
          return staleRevision(tx, stored, command.expectedRevision, meta)
        }
        const review = toReview(stored, findingsOf(tx, stored))

        if (stored.state === 'approved') {
          if (!isReviewApprovalCurrent(review, current)) {
            return refuse(
              'STALE_APPROVAL',
              `dsh-mywork: the approval of review "${stored.reviewId}" covers ${stored.headSha}/${stored.diffHash}, but the checkout is at ${current.headSha}/${current.diffHash}; the work must be reviewed again (§19)`,
              {
                reviewId: stored.reviewId,
                reviewed: { headSha: stored.headSha, diffHash: stored.diffHash },
                current,
              },
              meta,
            )
          }
          const existing = readDocument<StoredApproval>(tx, stored.reviewId, 'approval')
          if (existing !== undefined) {
            return ok(
              Object.freeze({
                claim: stored,
                review,
                artifact: current,
                approval: Object.freeze({ artifactId: existing.artifactId, hash: existing.hash }),
                created: false,
              }),
              meta,
            )
          }
          const recorded = recordApproval(tx, stored, current, at, meta)
          if (!recorded.ok) return fail(recorded.error, meta)
          return ok(
            Object.freeze({ claim: stored, review, artifact: current, approval: recorded.value, created: true }),
            meta,
          )
        }

        if (current.headSha !== stored.headSha || current.diffHash !== stored.diffHash) {
          return refuse(
            'STALE_APPROVAL',
            `dsh-mywork: review "${stored.reviewId}" was requested for ${stored.headSha}/${stored.diffHash}, but the checkout is at ${current.headSha}/${current.diffHash}`,
            {
              reviewId: stored.reviewId,
              reviewed: { headSha: stored.headSha, diffHash: stored.diffHash },
              current,
            },
            meta,
          )
        }
        const moved = applyTransition(
          tx,
          stored,
          {
            to: 'approved',
            expectedRevision: command.expectedRevision,
            at,
            artifact: current,
            workerAgentId: stored.workerAgentId,
            reviewerPermissions: REVIEWER_DEFAULT_PERMISSIONS,
          },
          meta,
        )
        if (!moved.ok) return fail(moved.error, meta)
        const recorded = recordApproval(tx, stored, current, at, meta)
        if (!recorded.ok) return fail(recorded.error, meta)
        return ok(
          Object.freeze({
            claim: moved.value.claim,
            review: moved.value.review,
            artifact: current,
            approval: recorded.value,
            created: true,
          }),
          meta,
        )
      })
    },

    async rejectReview(command: RejectReviewCommand): Promise<Result<ReviewRejectionOutcome>> {
      const meta = command.meta
      const claim = store.transaction(tx => {
        assertSchema(tx)
        return readClaim(tx, command.reviewId)
      })
      if (claim === undefined) {
        return refuse('TASK_CONFLICT', `dsh-mywork: review "${command.reviewId}" does not exist`, { reviewId: command.reviewId }, meta)
      }
      if (claim.state !== 'reviewing' && claim.state !== 'needs-evidence') {
        return refuse(
          'TASK_CONFLICT',
          `dsh-mywork: review "${claim.reviewId}" is in "${claim.state}"; only a review under way is rejected`,
          { reviewId: claim.reviewId, state: claim.state },
          meta,
        )
      }
      if (command.actor.kind === 'automatic') {
        const door = admitAutomaticChangeRequest(command.actor, claim, meta)
        if (!door.ok) return fail(door.error, meta)
      } else {
        const granted = admitReviewer(command.actor, claim, 'reject', meta)
        if (!granted.ok) return fail(granted.error, meta)
        if (granted.value.agentId !== claim.reviewerId) {
          return refuse(
            'SECURITY_DENIED',
            `dsh-mywork: review "${claim.reviewId}" is held by "${claim.reviewerId}"; "${granted.value.agentId}" may not reject it`,
            { reviewId: claim.reviewId, reviewerId: claim.reviewerId, actor: granted.value.agentId },
            meta,
          )
        }
      }

      const attempts = store.transaction(tx => {
        assertSchema(tx)
        return tx.all('SELECT attempt_id FROM attempt WHERE task_id = ? ORDER BY created_at, attempt_id', claim.taskId).length
      })
      const loopLimit = resolveReviewLoopLimit(command.budget, deps.maxReviewLoops)
      const exhausted = attempts >= loopLimit
      const requestedReason = command.attentionReason ?? 'retry-budget-exhausted'
      if (!(NEEDS_ATTENTION_REASONS as readonly string[]).includes(requestedReason)) {
        throw new TypeError(`dsh-mywork: "${String(requestedReason)}" is not a needs-attention reason (v0.2 §5.7)`)
      }
      const at = clock.now()
      const targetState: TaskState = exhausted ? 'needs-attention' : 'changes-requested'
      const moved = await moveTask(claim.taskId, targetState, meta)
      if (!moved.ok) return fail(moved.error, meta)

      const evidence = store.transaction(tx => {
        assertSchema(tx)
        const stored = readClaim(tx, claim.reviewId)
        return stored === undefined ? undefined : evidenceOfClaim(tx, stored)
      })
      const handoff = buildHandoff(claim, command.findings, evidence?.checkpoint, at)

      return store.transaction(tx => {
        assertSchema(tx)
        const stored = readClaim(tx, claim.reviewId)
        if (stored === undefined) {
          return refuse('TASK_CONFLICT', `dsh-mywork: review "${command.reviewId}" does not exist`, { reviewId: command.reviewId }, meta)
        }
        const rejected = applyTransition(
          tx,
          stored,
          { to: 'rejected', expectedRevision: command.expectedRevision, at, findings: command.findings },
          meta,
        )
        if (!rejected.ok) return fail(rejected.error, meta)
        tx.run(
          `UPDATE ${REVIEW_CLAIM_TABLE} SET handoff = ? WHERE review_id = ?`,
          JSON.stringify({ candidates: handoff, bodies: handoffBodies(handoff) } satisfies StoredHandoff),
          stored.reviewId,
        )

        if (exhausted) {
          const attention: AttentionRequest = Object.freeze({
            taskId: stored.taskId,
            reason: requestedReason,
            detail: `task "${stored.taskId}" consumed ${attempts} of ${loopLimit} review loops; a human decides whether the work continues`,
            requestedAt: at,
          })
          tx.run(
            `UPDATE ${REVIEW_CLAIM_TABLE} SET escalation = ? WHERE review_id = ?`,
            JSON.stringify(attention),
            stored.reviewId,
          )
          return ok(
            Object.freeze({
              claim: settledClaim(tx, stored.reviewId, 'was rejected'),
              review: rejected.value.review,
              taskState: targetState,
              worktree: command.worktree,
              handoff,
              attention,
              rejected: rejectedCount(tx, stored.taskId),
              loopLimit,
            }),
            meta,
          )
        }

        const attempt: AttemptRecord = Object.freeze({
          id: command.newAttemptId ?? `A-${randomUUID()}`,
          taskId: stored.taskId,
          workspaceId: stored.workspaceId,
          agentId: stored.workerAgentId,
          state: 'created',
          revision: 1,
          fence: allocateFence(tx, stored.taskId, at),
          controllerEpoch: command.controllerEpoch,
          leaseExpiresAt: at + command.leaseMs,
          operationId: meta.operationId,
          createdAt: at,
        })
        insertAttempt(tx, attempt)
        return ok(
          Object.freeze({
            claim: settledClaim(tx, stored.reviewId, 'was rejected'),
            review: rejected.value.review,
            taskState: targetState,
            attempt,
            fence: attempt.fence,
            worktree: command.worktree,
            session: freshSessionPlan(),
            handoff,
            rejected: rejectedCount(tx, stored.taskId),
            loopLimit,
          }),
          meta,
        )
      })
    },

    async escalateReview(command: EscalateReviewCommand): Promise<Result<ReviewEscalationOutcome>> {
      const meta = command.meta
      if (!(NEEDS_ATTENTION_REASONS as readonly string[]).includes(command.reason)) {
        throw new TypeError(`dsh-mywork: "${String(command.reason)}" is not a needs-attention reason (v0.2 §5.7)`)
      }
      const claim = store.transaction(tx => {
        assertSchema(tx)
        return readClaim(tx, command.reviewId)
      })
      if (claim === undefined) {
        return refuse('TASK_CONFLICT', `dsh-mywork: review "${command.reviewId}" does not exist`, { reviewId: command.reviewId }, meta)
      }
      const moved = await moveTask(claim.taskId, 'needs-attention', meta)
      if (!moved.ok) return fail(moved.error, meta)
      const at = clock.now()
      const attention: AttentionRequest = Object.freeze({
        taskId: claim.taskId,
        reason: command.reason,
        gate: command.gate,
        detail: command.detail,
        requestedAt: at,
      })
      return store.transaction(tx => {
        assertSchema(tx)
        const stored = readClaim(tx, command.reviewId)
        if (stored === undefined) {
          return refuse('TASK_CONFLICT', `dsh-mywork: review "${command.reviewId}" does not exist`, { reviewId: command.reviewId }, meta)
        }
        const escalated = applyTransition(
          tx,
          stored,
          { to: 'escalated', expectedRevision: command.expectedRevision, at },
          meta,
        )
        if (!escalated.ok) return fail(escalated.error, meta)
        tx.run(
          `UPDATE ${REVIEW_CLAIM_TABLE} SET escalation = ? WHERE review_id = ?`,
          JSON.stringify(attention),
          stored.reviewId,
        )
        return ok(
          Object.freeze({
            claim: settledClaim(tx, stored.reviewId, 'was escalated'),
            review: escalated.value.review,
            attention,
          }),
          meta,
        )
      })
    },

    ruleOnAutomaticVerdict(command: AutomaticVerdictCommand): Result<AutomaticVerdictOutcome> {
      const meta = command.meta
      return store.transaction(tx => {
        assertSchema(tx)
        const claim = readClaim(tx, command.reviewId)
        if (claim === undefined) {
          return refuse('TASK_CONFLICT', `dsh-mywork: review "${command.reviewId}" does not exist`, { reviewId: command.reviewId }, meta)
        }
        const ruling = ruleOnAutoReview({ verdict: command.verdict, autoReviewActive: command.autoReviewActive })
        return ok(Object.freeze({ ruling, claim }), meta)
      })
    },

    reviewOf(reviewId: ReviewId): ReviewClaim | undefined {
      return store.transaction(tx => {
        assertSchema(tx)
        return readClaim(tx, reviewId)
      })
    },

    queueOf(taskId: TaskId): readonly ReviewClaim[] {
      return store.transaction(tx => {
        assertSchema(tx)
        return Object.freeze(
          tx
            .all(`SELECT * FROM ${REVIEW_CLAIM_TABLE} WHERE task_id = ? ORDER BY requested_at, review_id`, taskId)
            .map(row => rowToClaim(row as unknown as ClaimRow)),
        )
      })
    },

    liveReviews(workspaceId?: WorkspaceId): readonly ReviewClaim[] {
      return store.transaction(tx => {
        assertSchema(tx)
        const rows =
          workspaceId === undefined
            ? tx.all(
                `SELECT * FROM ${REVIEW_CLAIM_TABLE} WHERE state IN ${LIVE_REVIEW_STATES} ORDER BY requested_at, review_id`,
              )
            : tx.all(
                `SELECT * FROM ${REVIEW_CLAIM_TABLE} WHERE state IN ${LIVE_REVIEW_STATES} AND workspace_id = ? ORDER BY requested_at, review_id`,
                workspaceId,
              )
        return Object.freeze(rows.map(row => rowToClaim(row as unknown as ClaimRow)))
      })
    },

    evidenceOf(reviewId: ReviewId): ReviewEvidencePackage | undefined {
      return store.transaction(tx => {
        assertSchema(tx)
        const claim = readClaim(tx, reviewId)
        return claim === undefined ? undefined : evidenceOfClaim(tx, claim)
      })
    },

    verdictOf(reviewId: ReviewId): ReviewVerdictPayload | undefined {
      return store.transaction(tx => {
        assertSchema(tx)
        return readDocument<ReviewVerdictPayload>(tx, reviewId, 'verdict')
      })
    },

    approvalOf(reviewId: ReviewId): ArtifactRef | undefined {
      return store.transaction(tx => {
        assertSchema(tx)
        const stored = readDocument<StoredApproval>(tx, reviewId, 'approval')
        if (stored === undefined || typeof stored.artifactId !== 'string' || stored.artifactId === '') return undefined
        return Object.freeze({ artifactId: stored.artifactId, hash: String(stored.hash ?? '') })
      })
    },

    scopeOf(reviewId: ReviewId): ReviewRunScope | undefined {
      return store.transaction(tx => {
        assertSchema(tx)
        const claim = readClaim(tx, reviewId)
        return claim === undefined ? undefined : scopeOfClaim(tx, claim)
      })
    },

    attemptsOf(taskId: TaskId): readonly AttemptRecord[] {
      return store.transaction(tx => {
        assertSchema(tx)
        const ids = tx
          .all(
            // Fence is the causal attempt sequence for one task. created_at may
            // tie under a fake clock (or a coarse real clock), and attempt_id is
            // identity rather than chronology, so neither can satisfy the
            // public "oldest first" contract as a tie-breaker.
            'SELECT attempt_id FROM attempt WHERE task_id = ? ORDER BY fence, created_at, attempt_id',
            taskId,
          )
          .map(row => String(row['attempt_id']))
        const attempts: AttemptRecord[] = []
        for (const id of ids) {
          const attempt = readAttempt(tx, id)
          if (attempt === undefined) {
            throw new ExecutionError('conflict', `dsh-mywork: attempt "${id}" vanished mid-read`, { details: { attemptId: id } })
          }
          attempts.push(attempt)
        }
        return Object.freeze(attempts)
      })
    },

    liveAttemptOf(taskId: TaskId): AttemptRecord | undefined {
      return store.transaction(tx => {
        assertSchema(tx)
        return readLiveAttempt(tx, taskId)
      })
    },

    handoff(): ContextProviderPort {
      return Object.freeze({
        capabilities: async (): Promise<ContextProviderCapabilities> =>
          Object.freeze({
            levels: Object.freeze(['L1', 'L2'] as const),
            onDemandMaterialization: true,
            classes: Object.freeze([HANDOFF_FINDINGS_KIND, HANDOFF_CHECKPOINT_KIND]),
            scopeKinds: Object.freeze(['task', 'attempt', 'review']),
          }),
        discover: async (request: ContextDiscoveryRequest): Promise<readonly ContextCandidate[]> => {
          const taskScope = request.scopes.find(scope => scope.kind === 'task')
          if (taskScope === undefined) return Object.freeze([])
          return store.transaction(tx => {
            assertSchema(tx)
            const rows = tx.all(
              `SELECT handoff FROM ${REVIEW_CLAIM_TABLE} WHERE task_id = ? AND handoff IS NOT NULL ORDER BY requested_at, review_id`,
              taskScope.id,
            )
            const candidates: ContextCandidate[] = []
            for (const row of rows) {
              const document = parseStored<StoredHandoff>(
                `task "${taskScope.id}"`,
                'handoff',
                String(row['handoff']),
              )
              for (const candidate of document.candidates ?? []) {
                if (request.classes !== undefined && !request.classes.includes(candidate.kind)) continue
                candidates.push(candidate)
              }
            }
            return Object.freeze(candidates)
          })
        },
        materialize: async (request: ContextMaterializeRequest): Promise<ContextMaterialized> => {
          const body = store.transaction(tx => {
            assertSchema(tx)
            for (const row of tx.all(`SELECT review_id, handoff FROM ${REVIEW_CLAIM_TABLE} WHERE handoff IS NOT NULL`)) {
              const document = parseStored<StoredHandoff>(
                `review "${String(row['review_id'])}"`,
                'handoff',
                String(row['handoff']),
              )
              const text = document.bodies?.[request.uri]
              if (text !== undefined) return text
            }
            return undefined
          })
          if (body === undefined) {
            throw new ExecutionError('not-found', `dsh-mywork: no review handoff carries "${request.uri}"`, {
              details: { uri: request.uri, level: request.level },
            })
          }
          return Object.freeze({
            uri: request.uri,
            level: request.level,
            contentHash: fingerprintOf(body),
            content: Object.freeze({ mediaType: 'application/json', text: body }),
            provenance: Object.freeze([Object.freeze({ source: 'review-reject', uri: request.uri })]),
          })
        },
      })
    },
  }
}
