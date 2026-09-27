/**
 * `@dsh-mywork/evidence` — local immutable evidence for MyWork.
 *
 * The Artifact Store (§32) holds bytes under a caller-owned id and the SHA-256
 * of those bytes; a second write under the same id with other content is
 * refused, and every read re-hashes what it read. The Audit (§34) is
 * append-only, stored in the same durable database rather than in a log file,
 * so log rotation cannot truncate it.
 *
 * Both tables are created by {@link EVIDENCE_MIGRATIONS}, which a caller
 * composes with the storage kernel's list when opening the database:
 *
 * ```ts
 * const store = await openStore({ path, migrations: [...MYWORK_MIGRATIONS, ...EVIDENCE_MIGRATIONS] })
 * const artifacts = createArtifactStore(store)
 * const audit = createAuditLog(store)
 * ```
 *
 * Scope: the local store. Binding it as the `artifact-store` port of §36, and
 * routing runtime operations through §31 authorization, belong to the cards
 * that mount the runtime (MW-015) and to the adapter SDK.
 * @module @dsh-mywork/evidence
 */

export {
  EVIDENCE_ERROR_CODES,
  EvidenceError,
  isEvidenceError,
  type EvidenceErrorCode,
  type EvidenceErrorOptions,
} from './errors.ts'
export {
  ARTIFACT_IMMUTABLE_MARKER,
  AUDIT_APPEND_ONLY_MARKER,
  EVIDENCE_MIGRATIONS,
  EVIDENCE_SCHEMA_NAME,
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_TABLES_MIGRATION_NAME,
} from './schema.ts'
export {
  ARTIFACT_RETENTION_MIGRATION_NAME,
  ARTIFACT_TOMBSTONE_DDL,
  createArtifactRetentionMigration,
  dropArtifactDeleteGuard,
  getArtifact,
  listArtifactDeletionCandidates,
  markArtifactForDeletion,
  pruneArtifacts,
  putArtifact,
  sha256Hex,
  type ArtifactPutResult,
  type ArtifactRetentionDryRun,
  type ArtifactRetentionResult,
  type ArtifactRetentionWindow,
  type MarkArtifactForDeletionInput,
} from './artifacts.ts'
export { appendAuditEntry, readAuditLog, type AuditAppendResult, type AuditQuery } from './audit.ts'
export {
  createArtifactStore,
  createAuditLog,
  type ArtifactStore,
  type AuditLog,
  type EvidenceClock,
  type EvidenceStore,
} from './store.ts'
