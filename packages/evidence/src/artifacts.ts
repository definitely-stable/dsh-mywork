/**
 * The immutable Artifact Store (§32).
 *
 * An artifact is addressed by a caller-owned id and carries the SHA-256 of its
 * own bytes. Writing the same id twice with the same bytes is a no-op that
 * reports `created: false`; writing it with anything else is refused, because
 * evidence that could be rewritten would make every review verdict bound to it
 * meaningless. Reads re-hash the stored bytes and refuse a row that no longer
 * matches the identity it is stored under.
 * @module
 */

import { createHash } from 'node:crypto'
import {
  ARTIFACT_REF_FIELDS,
  ARTIFACT_SCHEMA,
  type Artifact,
  type ArtifactId,
  type ArtifactMetadata,
  type ArtifactPutRequest,
  type ArtifactRef,
} from '@dsh-mywork/contracts'
import type { SqlExecutor, SqlRow } from '@dsh-mywork/storage'
import { EvidenceError } from './errors.ts'
import { readClosedRecord, readHash, readId, validateArtifactMetadata, validateArtifactPutRequest } from './metadata.ts'

/** Result of a successful {@link putArtifact}. */
export interface ArtifactPutResult {
  /** Identity the artifact is stored under. */
  readonly ref: ArtifactRef
  /** True when this call stored the artifact; false when it was already there unchanged. */
  readonly created: boolean
}

/** Columns of `artifacts`, in the order every statement below binds them. */
const ARTIFACT_COLUMNS =
  'artifact_id, hash, kind, workspace_id, correlation_id, content_type, size, created_at, task_id, attempt_id, review_id, causation_id, bytes'

/**
 * SHA-256 of the bytes, as the lowercase hex the store stores and verifies.
 * @param bytes - the evidence.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Read and validate an artifact reference.
 * @param value - the caller's reference.
 * @throws {EvidenceError} `invalid-input` when the reference is malformed.
 */
function validateRef(value: unknown): ArtifactRef {
  const label = 'artifact ref'
  const record = readClosedRecord(value, ARTIFACT_REF_FIELDS, label)
  return Object.freeze({ artifactId: readId(record, 'artifactId', label), hash: readHash(record, 'hash', label) })
}

/**
 * Turn a stored row into validated metadata.
 * @param row - the row as SQLite returned it.
 * @throws {EvidenceError} `invalid-input` when a column holds a value the schema does not accept.
 */
function rowToMetadata(row: SqlRow): ArtifactMetadata {
  const optional: Record<string, unknown> = {}
  for (const [column, field] of [
    ['task_id', 'taskId'],
    ['attempt_id', 'attemptId'],
    ['review_id', 'reviewId'],
    ['causation_id', 'causationId'],
  ] as const) {
    const value = row[column]
    if (value !== null && value !== undefined) optional[field] = value
  }
  return validateArtifactMetadata({
    schema: ARTIFACT_SCHEMA,
    artifactId: row['artifact_id'],
    kind: row['kind'],
    workspaceId: row['workspace_id'],
    correlationId: row['correlation_id'],
    contentType: row['content_type'],
    size: row['size'],
    hash: row['hash'],
    createdAt: row['created_at'],
    ...optional,
  })
}

/**
 * Read the stored row for an artifact id.
 * @param executor - connection or open transaction.
 * @param artifactId - the identity to look up.
 */
function readArtifactRow(executor: SqlExecutor, artifactId: ArtifactId): SqlRow | undefined {
  return executor.get(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE artifact_id = ?`, artifactId)
}

/**
 * Whether two metadata records describe the same immutable artifact. The write
 * time is excluded: it is stamped by the store, so a retry of the same write
 * must not look like a different artifact.
 * @param left - stored metadata.
 * @param right - metadata of the incoming write.
 */
function sameArtifact(left: ArtifactMetadata, right: ArtifactMetadata): boolean {
  return (
    left.artifactId === right.artifactId &&
    left.hash === right.hash &&
    left.kind === right.kind &&
    left.workspaceId === right.workspaceId &&
    left.correlationId === right.correlationId &&
    left.contentType === right.contentType &&
    left.size === right.size &&
    left.taskId === right.taskId &&
    left.attemptId === right.attemptId &&
    left.reviewId === right.reviewId &&
    left.causationId === right.causationId
  )
}

/**
 * Store one artifact.
 *
 * Reusing an id with the same bytes and the same description is idempotent.
 * Reusing it with anything else — other bytes, another kind, another workspace
 * — is refused with `artifact-conflict`: the first version stands.
 * @param executor - connection or open transaction.
 * @param request - the artifact to store.
 * @param now - clock reading stamped as `createdAt`, in epoch milliseconds.
 * @returns the identity and whether this call created it.
 * @throws {EvidenceError} `invalid-input`, `secret-material`, or `artifact-conflict`.
 */
export function putArtifact(executor: SqlExecutor, request: ArtifactPutRequest, now: number): ArtifactPutResult {
  const valid = validateArtifactPutRequest(request)
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new EvidenceError('invalid-input', 'dsh-mywork: artifact createdAt must be a non-negative safe integer')
  }
  const hash = sha256Hex(valid.bytes)
  const metadata: ArtifactMetadata = Object.freeze({
    schema: ARTIFACT_SCHEMA,
    artifactId: valid.artifactId,
    kind: valid.kind,
    workspaceId: valid.workspaceId,
    correlationId: valid.correlationId,
    contentType: valid.contentType,
    size: valid.bytes.byteLength,
    hash,
    createdAt: now,
    ...(valid.taskId === undefined ? {} : { taskId: valid.taskId }),
    ...(valid.attemptId === undefined ? {} : { attemptId: valid.attemptId }),
    ...(valid.reviewId === undefined ? {} : { reviewId: valid.reviewId }),
    ...(valid.causationId === undefined ? {} : { causationId: valid.causationId }),
  })
  const existing = readArtifactRow(executor, valid.artifactId)
  if (existing !== undefined) {
    const stored = rowToMetadata(existing)
    if (sameArtifact(stored, metadata)) {
      return Object.freeze({ ref: Object.freeze({ artifactId: stored.artifactId, hash: stored.hash }), created: false })
    }
    throw new EvidenceError(
      'artifact-conflict',
      `dsh-mywork: artifact "${valid.artifactId}" already holds different evidence and is never overwritten`,
      { details: { artifactId: valid.artifactId, storedHash: stored.hash, offeredHash: hash } },
    )
  }
  executor.run(
    `INSERT INTO artifacts (${ARTIFACT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    metadata.artifactId,
    metadata.hash,
    metadata.kind,
    metadata.workspaceId,
    metadata.correlationId,
    metadata.contentType,
    metadata.size,
    metadata.createdAt,
    metadata.taskId ?? null,
    metadata.attemptId ?? null,
    metadata.reviewId ?? null,
    metadata.causationId ?? null,
    valid.bytes,
  )
  return Object.freeze({ ref: Object.freeze({ artifactId: metadata.artifactId, hash }), created: true })
}

/**
 * Read one artifact, verifying its bytes against the hash it is stored under.
 * @param executor - connection or open transaction.
 * @param ref - identity to read, including the hash the caller expects.
 * @returns the identity, the description, and the verified bytes.
 * @throws {EvidenceError} `artifact-not-found`, `hash-mismatch`, or `invalid-input`.
 */
export function getArtifact(executor: SqlExecutor, ref: ArtifactRef): Artifact {
  const wanted = validateRef(ref)
  const row = readArtifactRow(executor, wanted.artifactId)
  if (row === undefined) {
    throw new EvidenceError('artifact-not-found', `dsh-mywork: no artifact "${wanted.artifactId}"`, {
      details: { artifactId: wanted.artifactId },
    })
  }
  const metadata = rowToMetadata(row)
  const bytes = row['bytes']
  if (!(bytes instanceof Uint8Array)) {
    throw new EvidenceError('hash-mismatch', `dsh-mywork: artifact "${wanted.artifactId}" holds no usable bytes`, {
      details: { artifactId: wanted.artifactId },
    })
  }
  if (metadata.hash !== wanted.hash) {
    throw new EvidenceError(
      'hash-mismatch',
      `dsh-mywork: artifact "${wanted.artifactId}" is stored under hash ${metadata.hash}, not ${wanted.hash}`,
      { details: { artifactId: wanted.artifactId, storedHash: metadata.hash, requestedHash: wanted.hash } },
    )
  }
  const actual = sha256Hex(bytes)
  if (bytes.byteLength !== metadata.size || actual !== metadata.hash) {
    throw new EvidenceError(
      'hash-mismatch',
      `dsh-mywork: artifact "${wanted.artifactId}" no longer matches the hash it is stored under`,
      { details: { artifactId: wanted.artifactId, storedHash: metadata.hash, actualHash: actual } },
    )
  }
  return Object.freeze({
    ref: Object.freeze({ artifactId: metadata.artifactId, hash: metadata.hash }),
    metadata,
    bytes,
  })
}
