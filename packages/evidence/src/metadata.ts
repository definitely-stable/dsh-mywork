/**
 * Shape validation for everything the evidence layer writes.
 *
 * Both record schemas are CLOSED: a field the contract does not declare is
 * refused instead of stored, so nothing reaches the database merely because a
 * caller added it. Identifiers, media types, hashes, and clock readings each
 * have a shape, and every string is scanned for recognizable secret material
 * (§31: a blueprint holds credential references, never secrets). There is no
 * free-text field in either schema by design — prose belongs in an artifact,
 * and an artifact is referenced by id.
 * @module
 */

import {
  ARTIFACT_KINDS,
  ARTIFACT_METADATA_FIELDS,
  ARTIFACT_PUT_REQUEST_FIELDS,
  ARTIFACT_SCHEMA,
  AUDIT_ENTRY_FIELDS,
  AUDIT_EVENT_TYPES,
  AUDIT_SCHEMA,
  type ArtifactKind,
  type ArtifactMetadata,
  type ArtifactPutRequest,
  type AuditEntry,
  type AuditEventType,
} from '@dsh-mywork/contracts'
import { EvidenceError } from './errors.ts'

/**
 * Shape of a caller-owned identifier. Deliberately narrow: letters, digits,
 * dot, underscore, colon, and dash, at most {@link MAX_ID_LENGTH} characters.
 * A token, a PEM block, or a base64 blob carries characters (`+`, `/`, `=`,
 * whitespace, newlines) this shape refuses, and the length cap refuses the
 * remainder.
 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

/** Longest identifier the store accepts; also the bound that keeps an opaque blob out. */
const MAX_ID_LENGTH = 64

/** Media type: `type/subtype` with the RFC token alphabet. */
const CONTENT_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}$/

/** Lowercase hex SHA-256. */
const HASH_PATTERN = /^[0-9a-f]{64}$/

/**
 * Recognizable secret material. This is a guard, not a classification: it
 * refuses the shapes an agent realistically pastes (provider keys, PEM blocks,
 * bearer tokens, `name=value` credential assignments). A short, unlabelled
 * secret is not detectable by shape at all — that is what credential
 * references (§31) are for, and MW-007 owns that check.
 */
const SECRET_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = Object.freeze([
  { name: 'pem-block', pattern: /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE|RSA|OPENSSH|EC)/ },
  { name: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  // Two spellings rather than one loose pattern: an optional provider group in
  // front of a long tail would also refuse a legitimate identifier such as
  // `sk_workspace_alpha_1`. The underscore form therefore names the providers
  // it knows (Stripe), while the hyphen form covers the dashed keys and keeps
  // separators inside the tail.
  { name: 'provider-key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { name: 'provider-key-underscore', pattern: /\bsk_(?:live|test)_[A-Za-z0-9_-]{16,}\b/ },
  { name: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'json-web-token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  {
    name: 'credential-assignment',
    pattern: /(password|passwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*\S{6,}/i,
  },
])

/** A record read as a plain object with only declared fields. */
type ClosedRecord = Readonly<Record<string, unknown>>

/**
 * Read a value as a plain record and refuse any field the schema does not declare.
 * @param value - the value to read.
 * @param declaredFields - the closed field list for this schema.
 * @param label - schema name used in the message.
 * @throws {EvidenceError} `invalid-input` when the value is not a plain record or carries an undeclared field.
 */
export function readClosedRecord(value: unknown, declaredFields: readonly string[], label: string): ClosedRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EvidenceError('invalid-input', `dsh-mywork: ${label} must be a plain object`)
  }
  const record = value as ClosedRecord
  for (const key of Object.keys(record)) {
    if (!declaredFields.includes(key)) {
      throw new EvidenceError('invalid-input', `dsh-mywork: ${label} does not declare the field "${key}"`, {
        details: { field: key, declared: [...declaredFields] },
      })
    }
  }
  return record
}

/**
 * Read a required identifier-shaped string.
 * @param record - closed record to read from.
 * @param field - field name.
 * @param label - schema name used in the message.
 * @throws {EvidenceError} `invalid-input` when the field is missing or malformed.
 */
export function readId(record: ClosedRecord, field: string, label: string): string {
  const value = record[field]
  if (typeof value !== 'string') {
    throw new EvidenceError('invalid-input', `dsh-mywork: ${label}.${field} must be a string`)
  }
  assertNoSecretMaterial(value, field)
  if (value.length > MAX_ID_LENGTH || !ID_PATTERN.test(value)) {
    throw new EvidenceError('invalid-input', `dsh-mywork: ${label}.${field} is not a usable identifier`, {
      details: { field, length: value.length },
    })
  }
  return value
}

/**
 * Read an optional identifier-shaped string.
 * @param record - closed record to read from.
 * @param field - field name.
 * @param label - schema name used in the message.
 * @returns the identifier, or `undefined` when the field is absent or `null`.
 * @throws {EvidenceError} `invalid-input` when the field is present and malformed.
 */
export function readOptionalId(record: ClosedRecord, field: string, label: string): string | undefined {
  const value = record[field]
  if (value === undefined || value === null) return undefined
  return readId(record, field, label)
}

/**
 * Read a required non-negative safe integer.
 * @param record - closed record to read from.
 * @param field - field name.
 * @param label - schema name used in the message.
 * @throws {EvidenceError} `invalid-input` when the field is missing or not a non-negative safe integer.
 */
export function readCount(record: ClosedRecord, field: string, label: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new EvidenceError('invalid-input', `dsh-mywork: ${label}.${field} must be a non-negative safe integer`)
  }
  return value
}

/**
 * Read a required member of a closed vocabulary.
 * @param record - closed record to read from.
 * @param field - field name.
 * @param allowed - the vocabulary.
 * @param label - schema name used in the message.
 * @throws {EvidenceError} `invalid-input` when the value is not in the vocabulary.
 */
export function readVocabulary<T extends string>(
  record: ClosedRecord,
  field: string,
  allowed: readonly T[],
  label: string,
): T {
  const value = record[field]
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new EvidenceError('invalid-input', `dsh-mywork: ${label}.${field} is not a known value`, {
      details: { field, allowed: [...allowed] },
    })
  }
  return value as T
}

/**
 * Refuse a string carrying recognizable secret material.
 * @param value - the string to scan.
 * @param field - field name reported in the failure.
 * @throws {EvidenceError} `secret-material` when a known secret shape matches.
 */
export function assertNoSecretMaterial(value: string, field: string): void {
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(value)) {
      throw new EvidenceError('secret-material', `dsh-mywork: ${field} carries what looks like secret material`, {
        details: { field, shape: name },
      })
    }
  }
}

/**
 * Read the schema tag both record schemas carry.
 * @param record - closed record to read from.
 * @param expected - the schema constant this record must declare.
 * @param label - schema name used in the message.
 * @throws {EvidenceError} `invalid-input` when the tag is missing or different.
 */
function readSchemaTag(record: ClosedRecord, expected: string, label: string): void {
  if (record['schema'] !== expected) {
    throw new EvidenceError('invalid-input', `dsh-mywork: ${label}.schema must be "${expected}"`)
  }
}

/**
 * Read a required media type.
 * @param record - closed record to read from.
 * @param field - field name.
 * @param label - schema name used in the message.
 * @throws {EvidenceError} `invalid-input` when the field is not a media type, `secret-material` when it looks like a secret.
 */
export function readContentType(record: ClosedRecord, field: string, label: string): string {
  const value = record[field]
  if (typeof value !== 'string') {
    throw new EvidenceError('invalid-input', `dsh-mywork: ${label}.${field} must be a string`)
  }
  assertNoSecretMaterial(value, field)
  if (!CONTENT_TYPE_PATTERN.test(value)) {
    throw new EvidenceError('invalid-input', `dsh-mywork: ${label}.${field} must be a media type`)
  }
  return value
}

/**
 * Read a required lowercase hex SHA-256.
 * @param record - closed record to read from.
 * @param field - field name.
 * @param label - schema name used in the message.
 * @throws {EvidenceError} `invalid-input` when the field is not a SHA-256.
 */
export function readHash(record: ClosedRecord, field: string, label: string): string {
  const value = record[field]
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new EvidenceError('invalid-input', `dsh-mywork: ${label}.${field} must be a lowercase hex SHA-256`)
  }
  return value
}

/**
 * Validate an artifact write request against the closed §32 schema.
 * @param value - the caller's request.
 * @returns the request with its declared fields checked.
 * @throws {EvidenceError} `invalid-input` / `secret-material` on a malformed request.
 */
export function validateArtifactPutRequest(value: unknown): ArtifactPutRequest {
  const label = 'artifact request'
  const record = readClosedRecord(value, ARTIFACT_PUT_REQUEST_FIELDS, label)
  const bytes = record['bytes']
  if (!(bytes instanceof Uint8Array)) {
    throw new EvidenceError('invalid-input', `dsh-mywork: ${label}.bytes must be a Uint8Array`)
  }
  const artifactId = readId(record, 'artifactId', label)
  const kind = readVocabulary<ArtifactKind>(record, 'kind', ARTIFACT_KINDS, label)
  const workspaceId = readId(record, 'workspaceId', label)
  const correlationId = readId(record, 'correlationId', label)
  const contentType = readContentType(record, 'contentType', label)
  const taskId = readOptionalId(record, 'taskId', label)
  const attemptId = readOptionalId(record, 'attemptId', label)
  const reviewId = readOptionalId(record, 'reviewId', label)
  const causationId = readOptionalId(record, 'causationId', label)
  return Object.freeze({
    artifactId,
    kind,
    workspaceId,
    correlationId,
    contentType,
    bytes,
    ...(taskId === undefined ? {} : { taskId }),
    ...(attemptId === undefined ? {} : { attemptId }),
    ...(reviewId === undefined ? {} : { reviewId }),
    ...(causationId === undefined ? {} : { causationId }),
  })
}

/**
 * Validate an artifact metadata record as read back from the database, so a row
 * that was tampered with outside the API is refused rather than handed on.
 * @param value - the record to check.
 * @returns the metadata with its declared fields checked.
 * @throws {EvidenceError} `invalid-input` / `secret-material` on a malformed record.
 */
export function validateArtifactMetadata(value: unknown): ArtifactMetadata {
  const label = 'artifact metadata'
  const record = readClosedRecord(value, ARTIFACT_METADATA_FIELDS, label)
  readSchemaTag(record, ARTIFACT_SCHEMA, label)
  const artifactId = readId(record, 'artifactId', label)
  const kind = readVocabulary<ArtifactKind>(record, 'kind', ARTIFACT_KINDS, label)
  const workspaceId = readId(record, 'workspaceId', label)
  const correlationId = readId(record, 'correlationId', label)
  const contentType = readContentType(record, 'contentType', label)
  const size = readCount(record, 'size', label)
  const hash = readHash(record, 'hash', label)
  const createdAt = readCount(record, 'createdAt', label)
  const taskId = readOptionalId(record, 'taskId', label)
  const attemptId = readOptionalId(record, 'attemptId', label)
  const reviewId = readOptionalId(record, 'reviewId', label)
  const causationId = readOptionalId(record, 'causationId', label)
  return Object.freeze({
    schema: ARTIFACT_SCHEMA,
    artifactId,
    kind,
    workspaceId,
    correlationId,
    contentType,
    size,
    hash,
    createdAt,
    ...(taskId === undefined ? {} : { taskId }),
    ...(attemptId === undefined ? {} : { attemptId }),
    ...(reviewId === undefined ? {} : { reviewId }),
    ...(causationId === undefined ? {} : { causationId }),
  })
}

/**
 * Validate an audit row against the closed §34 schema.
 * @param value - the caller's entry.
 * @returns the entry with its declared fields checked.
 * @throws {EvidenceError} `invalid-input` / `secret-material` on a malformed entry.
 */
export function validateAuditEntry(value: unknown): AuditEntry {
  const label = 'audit entry'
  const record = readClosedRecord(value, AUDIT_ENTRY_FIELDS, label)
  readSchemaTag(record, AUDIT_SCHEMA, label)
  const auditId = readId(record, 'auditId', label)
  const type = readVocabulary<AuditEventType>(record, 'type', AUDIT_EVENT_TYPES, label)
  const workspaceId = readId(record, 'workspaceId', label)
  const correlationId = readId(record, 'correlationId', label)
  const occurredAt = readCount(record, 'occurredAt', label)
  const taskId = readOptionalId(record, 'taskId', label)
  const attemptId = readOptionalId(record, 'attemptId', label)
  const reviewId = readOptionalId(record, 'reviewId', label)
  const agentId = readOptionalId(record, 'agentId', label)
  const artifactId = readOptionalId(record, 'artifactId', label)
  const causationId = readOptionalId(record, 'causationId', label)
  return Object.freeze({
    schema: AUDIT_SCHEMA,
    auditId,
    type,
    workspaceId,
    correlationId,
    occurredAt,
    ...(taskId === undefined ? {} : { taskId }),
    ...(attemptId === undefined ? {} : { attemptId }),
    ...(reviewId === undefined ? {} : { reviewId }),
    ...(agentId === undefined ? {} : { agentId }),
    ...(artifactId === undefined ? {} : { artifactId }),
    ...(causationId === undefined ? {} : { causationId }),
  })
}
