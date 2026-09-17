/**
 * Review domain (architecture §8, §18.3, §19). The review attempt lives in
 * MyWork DB; the full findings live in the Artifact Store. An approval is bound
 * to the exact head SHA and diff hash the reviewer saw, so a later HEAD makes it
 * invalid instead of silently transferable.
 * @module
 */

import type { AgentId, AttemptId, EpochMs, ReviewId, Revision, TaskId } from './ids.ts'

/** Review states (architecture §18.3). */
export type ReviewState =
  /** Requested by the task, waiting for a reviewer. */
  | 'queued'
  /** A reviewer claimed the review. */
  | 'claimed'
  /** The reviewer is working. */
  | 'reviewing'
  /** Terminal: the reviewer approved this exact artifact. */
  | 'approved'
  /** Terminal: the reviewer rejected the attempt. */
  | 'rejected'
  /** The reviewer requires more evidence before deciding. */
  | 'needs-evidence'
  /** Terminal: the review was escalated to a human. */
  | 'escalated'
  /** Terminal: the review was cancelled. */
  | 'cancelled'

/** Every review state, in the order the architecture lists them. */
export const REVIEW_STATES: readonly ReviewState[] = Object.freeze([
  'queued',
  'claimed',
  'reviewing',
  'approved',
  'rejected',
  'needs-evidence',
  'escalated',
  'cancelled',
])

/** States from which no further transition exists. */
export const REVIEW_TERMINAL_STATES: readonly ReviewState[] = Object.freeze([
  'approved',
  'rejected',
  'escalated',
  'cancelled',
])

/** The exact artifact an approval refers to (architecture §19). */
export interface ReviewedArtifact {
  /** Head SHA the reviewer examined. */
  readonly headSha: string
  /** Hash of the diff the reviewer examined. */
  readonly diffHash: string
}

/** Review findings: summary in MyWork DB, full text in the Artifact Store (§8). */
export interface ReviewFindings {
  /** Short verdict summary. */
  readonly summary: string
  /** Artifact reference holding the full findings. */
  readonly artifactRef?: string
}

/** One review of one attempt. */
export interface Review {
  /** Review identifier. */
  readonly id: ReviewId
  /** Task under review. */
  readonly taskId: TaskId
  /** Attempt under review. */
  readonly attemptId: AttemptId
  /** Agent identity of the reviewer; must differ from the attempt's agent. */
  readonly reviewerId: AgentId
  /** Current state. */
  readonly state: ReviewState
  /** Aggregate revision; every accepted transition increments it. */
  readonly revision: Revision
  /** Clock reading of the transition into `queued`. */
  readonly requestedAt: EpochMs
  /** Artifact bound by an approval; present from `approved` on. */
  readonly artifact?: ReviewedArtifact
  /** Findings recorded by the reviewer. */
  readonly findings?: ReviewFindings
  /** Clock reading of the transition into a terminal state. */
  readonly settledAt?: EpochMs
}
