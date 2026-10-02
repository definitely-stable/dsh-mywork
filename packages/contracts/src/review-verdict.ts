/**
 * The `mywork.review-verdict/v1` payload (architecture §8, §19, §32; E-22).
 *
 * §32 lets the Artifact Store hold a `review-verdict`; this module fixes what one
 * carries, so two reviewers answering the same attempt are comparable and a
 * later reader — a human, the integrator, an acceptance check — branches on a
 * closed verdict rather than on prose.
 *
 * The shape is deliberately the project's own review-report form translated into
 * data (`.work/reports/*-review.md`): the verdict and its one-line justification,
 * the commands that were run with their exit codes, the findings with a severity
 * and a status, the claims that could not be reproduced, and the limits the
 * reviewer names. Turning the practice into a schema is what makes "the reviewer
 * did the work" checkable instead of asserted.
 *
 * Every dictionary here is closed and every field is required unless its
 * documentation says otherwise, because an artifact is read long after the
 * session that wrote it. `@module`
 */

import type { AgentId, AttemptId, EpochMs, ReviewId, TaskId } from './ids.ts'
import type { ReviewedArtifact } from './review.ts'

/** Schema identifier carried by every review-verdict payload. */
export const REVIEW_VERDICT_SCHEMA = 'mywork.review-verdict/v1'

/**
 * What a reviewer concluded.
 *
 * Three members, the vocabulary the project's own review reports already use:
 * `PASS WITH FINDINGS` passes the work *and* records defects, so a verdict that
 * finds something no longer has to be spelled ambiguously.
 */
export type ReviewVerdict =
  /** The work is accepted as it stands. */
  | 'PASS'
  /** The work is accepted, with findings recorded for the reader. */
  | 'PASS WITH FINDINGS'
  /** The work is refused; findings say what must change. */
  | 'FAIL'

/** Every verdict, weakest outcome first. */
export const REVIEW_VERDICTS: readonly ReviewVerdict[] = Object.freeze(['PASS', 'PASS WITH FINDINGS', 'FAIL'])

/** Verdicts that let an approval through; the rest must be refused. */
export const REVIEW_VERDICTS_PASSING: readonly ReviewVerdict[] = Object.freeze(['PASS', 'PASS WITH FINDINGS'])

/**
 * How badly one finding matters. One scale, never a second one beside it.
 */
export type ReviewFindingSeverity =
  /** The work must not proceed until this is fixed. */
  | 'MAJOR'
  /** The work may proceed, but the defect is real and is recorded. */
  | 'MINOR'
  /** Cosmetic or stylistic; recorded so it is not lost. */
  | 'NIT'

/** Every severity, strongest first. */
export const REVIEW_FINDING_SEVERITIES: readonly ReviewFindingSeverity[] = Object.freeze(['MAJOR', 'MINOR', 'NIT'])

/**
 * What state one finding was in when the verdict was written.
 */
export type ReviewFindingStatus =
  /** Still present in the reviewed artifact. */
  | 'open'
  /** The reviewed artifact already carries the fix. */
  | 'addressed'
  /** Known and knowingly accepted, so the verdict may still pass. */
  | 'accepted'

/** Every status, in the order a reviewer reaches them. */
export const REVIEW_FINDING_STATUSES: readonly ReviewFindingStatus[] = Object.freeze([
  'open',
  'addressed',
  'accepted',
])

/**
 * One command the reviewer ran, with what it answered.
 *
 * An exit code is a number and not a string because the reader compares it; the
 * observation is the short reading of the output, which is what the review
 * reports in this workspace carry.
 */
export interface ReviewCommandOutcome {
  /** Command as it was run, verbatim. */
  readonly command: string
  /** Process exit code the command settled with. */
  readonly exitCode: number
  /** What the run showed, in one line. */
  readonly observation: string
}

/** Fields of {@link ReviewCommandOutcome}; the shape is closed. */
export const REVIEW_COMMAND_OUTCOME_FIELDS: readonly string[] = Object.freeze(['command', 'exitCode', 'observation'])

/** One defect the reviewer found. */
export interface ReviewFinding {
  /** Stable id inside this verdict, so a later pass can answer per finding. */
  readonly id: string
  /** How badly it matters. */
  readonly severity: ReviewFindingSeverity
  /** What is wrong, in one line. */
  readonly summary: string
  /** State the finding was in when the verdict was written. */
  readonly status: ReviewFindingStatus
  /** `path:line` the finding points at, when it points at one. */
  readonly location?: string
  /** Why it matters and the minimal fix, when one line is not enough. */
  readonly detail?: string
}

/** Fields of {@link ReviewFinding}; the shape is closed. */
export const REVIEW_FINDING_FIELDS: readonly string[] = Object.freeze([
  'id',
  'severity',
  'summary',
  'status',
  'location',
  'detail',
])

/**
 * One claim from the author's report the reviewer could not reproduce.
 *
 * The field exists because "I could not check this" is a fact the acceptance
 * needs: a verdict that omits it reads as if everything was verified.
 */
export interface ReviewUnverifiedClaim {
  /** The claim as the author stated it. */
  readonly claim: string
  /** The command that failed to reproduce it, when the reviewer ran one. */
  readonly command?: string
  /** Why it could not be reproduced. */
  readonly reason: string
}

/** Fields of {@link ReviewUnverifiedClaim}; the shape is closed. */
export const REVIEW_UNVERIFIED_CLAIM_FIELDS: readonly string[] = Object.freeze(['claim', 'command', 'reason'])

/**
 * The payload stored as the `review-verdict` artifact of one review.
 *
 * `artifact` is the {@link ReviewedArtifact} the reviewer actually examined, so
 * the verdict is bound to the same head SHA and diff hash the approval binds to:
 * a later commit makes both stale together instead of one of them silently.
 */
export interface ReviewVerdictPayload {
  /** Always {@link REVIEW_VERDICT_SCHEMA}. */
  readonly schema: typeof REVIEW_VERDICT_SCHEMA
  /** Review this verdict belongs to. */
  readonly reviewId: ReviewId
  /** Task under review. */
  readonly taskId: TaskId
  /** Attempt under review. */
  readonly attemptId: AttemptId
  /** Durable identity of the reviewer. */
  readonly reviewerId: AgentId
  /** What the reviewer concluded. */
  readonly verdict: ReviewVerdict
  /** The exact artifact the reviewer examined. */
  readonly reviewed: ReviewedArtifact
  /** One line the verdict is justified by. */
  readonly justification: string
  /** Commands that were run, in the order they were run. */
  readonly commands: readonly ReviewCommandOutcome[]
  /** Defects found; empty is legal for `PASS`. */
  readonly findings: readonly ReviewFinding[]
  /** Claims that could not be reproduced; empty means everything reproduced. */
  readonly unverified: readonly ReviewUnverifiedClaim[]
  /** Limits the reviewer names: what was not checked and why. */
  readonly limitations: readonly string[]
  /** Clock reading the verdict was written at. */
  readonly at: EpochMs
}

/** Fields of {@link ReviewVerdictPayload}, in fingerprint order; the shape is closed. */
export const REVIEW_VERDICT_FIELDS: readonly string[] = Object.freeze([
  'schema',
  'reviewId',
  'taskId',
  'attemptId',
  'reviewerId',
  'verdict',
  'reviewed',
  'justification',
  'commands',
  'findings',
  'unverified',
  'limitations',
  'at',
])

/**
 * Media type of the stored payload.
 *
 * Fixed here rather than at the write site, so a reader can address the artifact
 * without knowing which writer produced it. The artifact kind is `review-verdict`
 * of {@link ArtifactKind}; naming the media type here is what lets the two
 * halves of the §32 record be written by one module.
 */
export const REVIEW_VERDICT_CONTENT_TYPE = 'application/vnd.mywork.review-verdict+json'

/** Schema identifier carried by every review-approval record (§19, E-23). */
export const REVIEW_APPROVAL_SCHEMA = 'mywork.review-approval/v1'

/**
 * Media type of the stored approval record.
 *
 * An approval is stored as a `review-verdict` artifact because §32 has no kind
 * of its own for it, and a separate media type is what keeps the two records
 * apart: one says what the reviewer concluded, the other says which exact
 * artifact a reviewer approved, and the second is what the integrator reads.
 */
export const REVIEW_APPROVAL_CONTENT_TYPE = 'application/vnd.mywork.review-approval+json'

/**
 * The approval of one exact artifact, as the Artifact Store holds it (§19).
 *
 * It carries the {@link ReviewedArtifact} the approver saw together with the
 * reviewer identity and the instant, so a later reader can tell an approval that
 * still covers HEAD from one that a commit invalidated — and so the invalidation
 * is a comparison of recorded facts rather than a re-run of the review.
 */
export interface ReviewApprovalRecord {
  /** Always {@link REVIEW_APPROVAL_SCHEMA}. */
  readonly schema: typeof REVIEW_APPROVAL_SCHEMA
  /** Review the approval belongs to. */
  readonly reviewId: ReviewId
  /** Task under review. */
  readonly taskId: TaskId
  /** Attempt that was approved. */
  readonly attemptId: AttemptId
  /** Durable identity of the reviewer that approved. */
  readonly reviewerId: AgentId
  /** The exact artifact the approval covers. */
  readonly reviewed: ReviewedArtifact
  /** Clock reading the approval was recorded at. */
  readonly at: EpochMs
}

/** Fields of {@link ReviewApprovalRecord}, in fingerprint order; the shape is closed. */
export const REVIEW_APPROVAL_FIELDS: readonly string[] = Object.freeze([
  'schema',
  'reviewId',
  'taskId',
  'attemptId',
  'reviewerId',
  'reviewed',
  'at',
])
