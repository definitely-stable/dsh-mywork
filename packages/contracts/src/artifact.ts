/**
 * Artifact Store contracts (architecture §32).
 *
 * An artifact is immutable evidence: a diff, a build log, a review verdict, a
 * context snapshot, a checkpoint. Its identity is a caller-owned id together
 * with the SHA-256 of its bytes, so a reader can always tell whether what it
 * read is what was written.
 *
 * The metadata schema is CLOSED and every field has a shape: identifiers, an
 * enum, a media type, a size, a hash, and clock readings. There is deliberately
 * no free-text field, so secret material has no field to travel in (§31: a
 * blueprint holds credential references, never secrets).
 * @module
 */

import type {
  ArtifactId,
  AttemptId,
  CorrelationId,
  EpochMs,
  EventId,
  ReviewId,
  TaskId,
  WorkspaceId,
} from './ids.ts'

/** Schema identifier carried by every artifact metadata record. */
export const ARTIFACT_SCHEMA = 'mywork.artifact/v1'

/** Evidence kinds the store holds (§32). */
export type ArtifactKind =
  /** A diff produced by an attempt. */
  | 'diff'
  /** A commit such an attempt produced. */
  | 'commit'
  /** Output of a build. */
  | 'build-log'
  /** Report of a test run. */
  | 'test-report'
  /** A screenshot taken as evidence. */
  | 'screenshot'
  /** A benchmark result. */
  | 'benchmark'
  /** The report a worker wrote about its own work. */
  | 'worker-report'
  /** The verdict a review reached. */
  | 'review-verdict'
  /** The planner's dependency graph. */
  | 'planner-dag'
  /** A snapshot of the context an attempt ran with. */
  | 'context-snapshot'
  /** A checkpoint taken for recovery. */
  | 'checkpoint'
  /**
   * The detail of a gate decision (§5.5, ADR028 §5.18). A decision's reason is
   * prose, and §34 keeps prose out of the audit row: the row names this artifact
   * instead. Added additively; no existing kind is reinterpreted.
   */
  | 'gate-decision'

/** Every artifact kind, in the order §32 lists them. */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = Object.freeze([
  'diff',
  'commit',
  'build-log',
  'test-report',
  'screenshot',
  'benchmark',
  'worker-report',
  'review-verdict',
  'planner-dag',
  'context-snapshot',
  'checkpoint',
  'gate-decision',
])

/**
 * Fields an artifact metadata record carries, in stored order. Runtime data, so
 * the store can refuse a record carrying a field it does not declare instead of
 * silently storing whatever it was handed.
 */
export const ARTIFACT_METADATA_FIELDS: readonly string[] = Object.freeze([
  'schema',
  'artifactId',
  'kind',
  'workspaceId',
  'correlationId',
  'contentType',
  'size',
  'hash',
  'createdAt',
  'taskId',
  'attemptId',
  'reviewId',
  'causationId',
])

/** Immutable description of one stored artifact. */
export interface ArtifactMetadata {
  /** Always {@link ARTIFACT_SCHEMA}. */
  readonly schema: typeof ARTIFACT_SCHEMA
  /** Caller-owned identity of the artifact. */
  readonly artifactId: ArtifactId
  /** Which kind of evidence this is. */
  readonly kind: ArtifactKind
  /** Workspace the evidence belongs to. */
  readonly workspaceId: WorkspaceId
  /** Correlation of the workflow that produced it (§9, §33). */
  readonly correlationId: CorrelationId
  /** Media type of the bytes. */
  readonly contentType: string
  /** Size of the bytes, so a reader can bound what it is about to load. */
  readonly size: number
  /** Lowercase hex SHA-256 of the bytes. */
  readonly hash: string
  /** Clock reading of the write, in epoch milliseconds. */
  readonly createdAt: EpochMs
  /** Task the evidence belongs to, when it belongs to one. */
  readonly taskId?: TaskId
  /** Attempt that produced the evidence (§33). */
  readonly attemptId?: AttemptId
  /** Review the evidence belongs to (§33). */
  readonly reviewId?: ReviewId
  /** Event that caused this artifact (§33). */
  readonly causationId?: EventId
}

/** Identity of a stored artifact: its id and the hash of its bytes. */
export interface ArtifactRef {
  /** Caller-owned identity of the artifact. */
  readonly artifactId: ArtifactId
  /** Lowercase hex SHA-256 the stored bytes must still match. */
  readonly hash: string
}

/** Fields of {@link ArtifactRef}; the shape is closed. */
export const ARTIFACT_REF_FIELDS: readonly string[] = Object.freeze(['artifactId', 'hash'])

/** What a caller hands the store to store one artifact. */
export interface ArtifactPutRequest {
  /** Caller-owned identity; reusing it with other bytes is refused, not merged. */
  readonly artifactId: ArtifactId
  /** Which kind of evidence this is. */
  readonly kind: ArtifactKind
  /** Workspace the evidence belongs to. */
  readonly workspaceId: WorkspaceId
  /** Correlation of the workflow that produced it. */
  readonly correlationId: CorrelationId
  /** Media type of the bytes. */
  readonly contentType: string
  /** The evidence itself. */
  readonly bytes: Uint8Array
  /** Task the evidence belongs to, when it belongs to one. */
  readonly taskId?: TaskId
  /** Attempt that produced the evidence. */
  readonly attemptId?: AttemptId
  /** Review the evidence belongs to. */
  readonly reviewId?: ReviewId
  /** Event that caused this artifact. */
  readonly causationId?: EventId
}

/** Fields of {@link ArtifactPutRequest}; the shape is closed. */
export const ARTIFACT_PUT_REQUEST_FIELDS: readonly string[] = Object.freeze([
  'artifactId',
  'kind',
  'workspaceId',
  'correlationId',
  'contentType',
  'bytes',
  'taskId',
  'attemptId',
  'reviewId',
  'causationId',
])

/** What a caller reads back: the description, the identity, and the bytes. */
export interface Artifact {
  /** Identity the artifact is stored under. */
  readonly ref: ArtifactRef
  /** Immutable description of the artifact. */
  readonly metadata: ArtifactMetadata
  /** The evidence itself, verified against {@link ArtifactRef.hash} on read. */
  readonly bytes: Uint8Array
}
