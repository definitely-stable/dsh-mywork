/**
 * Wiring: the evidence layer bound to the storage kernel.
 *
 * The kernel owns `schema_migrations` and the connection, so the evidence
 * schema is applied by composing migration lists when the database is opened:
 *
 * ```ts
 * const store = await openStore({ path, migrations: [...MYWORK_MIGRATIONS, ...EVIDENCE_MIGRATIONS] })
 * const artifacts = createArtifactStore(store)
 * const audit = createAuditLog(store)
 * ```
 *
 * Both factories verify the evidence migration is actually applied, so a
 * database opened without it fails where it was wired instead of later, with a
 * SQL error about a missing table.
 * @module
 */

import type {
  Artifact,
  ArtifactPutRequest,
  ArtifactRef,
  AuditEntry,
  AuditRecord,
} from '@dsh-mywork/contracts'
import type { SqlExecutor } from '@dsh-mywork/storage'
import { appendAuditEntry, readAuditLog, type AuditAppendResult, type AuditQuery } from './audit.ts'
import { getArtifact, putArtifact, type ArtifactPutResult } from './artifacts.ts'
import { EvidenceError } from './errors.ts'
import { EVIDENCE_SCHEMA_NAME, EVIDENCE_SCHEMA_VERSION } from './schema.ts'

/** The slice of the storage kernel the evidence layer needs. */
export interface EvidenceStore {
  /**
   * Run a synchronous body in one transaction.
   * @param fn - body receiving the transaction's statement surface.
   */
  transaction<T>(fn: (tx: SqlExecutor) => T): T
}

/** Time source the artifact store stamps writes with; structurally the storage clock. */
export interface EvidenceClock {
  /** Current time in epoch milliseconds. */
  now(): number
}

/** Default clock: the wall clock, used when a caller does not inject one. */
const systemClock: EvidenceClock = Object.freeze({ now: (): number => Date.now() })

/** Read and write surface of the local Artifact Store (§32). */
export interface ArtifactStore {
  /**
   * Store one artifact; reusing an id with other evidence is refused.
   * @param request - the artifact to store.
   */
  put(request: ArtifactPutRequest): ArtifactPutResult
  /**
   * Read one artifact, verifying its bytes against its hash.
   * @param ref - identity to read.
   */
  get(ref: ArtifactRef): Artifact
}

/** Append-only surface of the audit (§34). */
export interface AuditLog {
  /**
   * Append one audit row; retrying the same row is a no-op.
   * @param entry - the event to append.
   */
  append(entry: AuditEntry): AuditAppendResult
  /**
   * Read the log in append order.
   * @param query - optional workspace, type, and limit filters.
   */
  read(query?: AuditQuery): readonly AuditRecord[]
}

/**
 * Verify the evidence migration was applied to this database.
 * @param store - the store to inspect.
 * @throws {EvidenceError} `schema-missing` when the evidence tables are absent.
 */
function assertEvidenceSchema(store: EvidenceStore): void {
  const applied = store.transaction(tx =>
    tx.get('SELECT name FROM schema_migrations WHERE version = ?', EVIDENCE_SCHEMA_VERSION),
  )
  if (applied === undefined) {
    throw new EvidenceError(
      'schema-missing',
      `dsh-mywork: the database has no evidence schema; open it with migrations [...MYWORK_MIGRATIONS, ...EVIDENCE_MIGRATIONS]`,
      { details: { expectedVersion: EVIDENCE_SCHEMA_VERSION } },
    )
  }
  if (applied['name'] !== EVIDENCE_SCHEMA_NAME) {
    throw new EvidenceError(
      'schema-missing',
      `dsh-mywork: schema version ${EVIDENCE_SCHEMA_VERSION} is "${String(applied['name'])}", not the evidence schema`,
      { details: { expectedName: EVIDENCE_SCHEMA_NAME, found: applied['name'] } },
    )
  }
}

/**
 * Bind the Artifact Store to a store.
 * @param store - an open store carrying the evidence schema.
 * @param clock - time source for `createdAt`; defaults to the wall clock.
 * @returns the artifact store.
 * @throws {EvidenceError} `schema-missing` when the evidence migration was never applied.
 */
export function createArtifactStore(store: EvidenceStore, clock: EvidenceClock = systemClock): ArtifactStore {
  assertEvidenceSchema(store)
  return Object.freeze({
    put: (request: ArtifactPutRequest): ArtifactPutResult =>
      store.transaction(tx => putArtifact(tx, request, clock.now())),
    get: (ref: ArtifactRef): Artifact => store.transaction(tx => getArtifact(tx, ref)),
  })
}

/**
 * Bind the audit log to a store.
 * @param store - an open store carrying the evidence schema.
 * @returns the append-only audit log.
 * @throws {EvidenceError} `schema-missing` when the evidence migration was never applied.
 */
export function createAuditLog(store: EvidenceStore): AuditLog {
  assertEvidenceSchema(store)
  return Object.freeze({
    append: (entry: AuditEntry): AuditAppendResult => store.transaction(tx => appendAuditEntry(tx, entry)),
    read: (query?: AuditQuery): readonly AuditRecord[] =>
      store.transaction(tx => readAuditLog(tx, query ?? {})),
  })
}
