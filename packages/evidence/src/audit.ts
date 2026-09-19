/**
 * The append-only Audit (§34).
 *
 * Audit is not a log. Rows are appended and never rewritten: the database
 * refuses `UPDATE` and `DELETE` on the table, and this layer additionally
 * refuses to append the same audit id twice with different content, so a retry
 * is a no-op while a contradiction is reported. Because audit is a durable
 * table and not a file, ordinary log rotation has nothing to truncate.
 *
 * A row carries structure, not prose: what happened, for which workspace, under
 * which correlation, and which artifact holds the detail (§8 keeps the summary
 * in MyWork DB and the text in the Artifact Store).
 * @module
 */

import {
  AUDIT_SCHEMA,
  type AuditEntry,
  type AuditId,
  type AuditRecord,
  type AuditEventType,
  type WorkspaceId,
} from '@dsh-mywork/contracts'
import type { SqlExecutor, SqlRow } from '@dsh-mywork/storage'
import { EvidenceError } from './errors.ts'
import { readId, validateAuditEntry } from './metadata.ts'

/** Result of a successful {@link appendAuditEntry}. */
export interface AuditAppendResult {
  /** Position of the row in the append-only log. */
  readonly position: number
  /** True when this call appended the row; false when it was already there unchanged. */
  readonly appended: boolean
}

/** Filter accepted by {@link readAuditLog}. */
export interface AuditQuery {
  /** Only rows of this workspace (§52 keeps workspaces apart). */
  readonly workspaceId?: WorkspaceId
  /** Only rows of this event type. */
  readonly type?: AuditEventType
  /** Stop after this many rows; the oldest positions come first. */
  readonly limit?: number
}

/** Columns of `audit_events`, in the order every statement below binds them. */
const AUDIT_COLUMNS =
  'position, audit_id, type, workspace_id, correlation_id, occurred_at, task_id, attempt_id, review_id, agent_id, artifact_id, causation_id'

/**
 * Turn a stored row into a validated audit record.
 * @param row - the row as SQLite returned it.
 * @throws {EvidenceError} `invalid-input` when a column holds a value the schema does not accept.
 */
function rowToRecord(row: SqlRow): AuditRecord {
  const optional: Record<string, unknown> = {}
  for (const [column, field] of [
    ['task_id', 'taskId'],
    ['attempt_id', 'attemptId'],
    ['review_id', 'reviewId'],
    ['agent_id', 'agentId'],
    ['artifact_id', 'artifactId'],
    ['causation_id', 'causationId'],
  ] as const) {
    const value = row[column]
    if (value !== null && value !== undefined) optional[field] = value
  }
  const position = row['position']
  if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0) {
    throw new EvidenceError('invalid-input', 'dsh-mywork: audit position must be a non-negative safe integer')
  }
  return Object.freeze({
    ...validateAuditEntry({
      schema: AUDIT_SCHEMA,
      auditId: row['audit_id'],
      type: row['type'],
      workspaceId: row['workspace_id'],
      correlationId: row['correlation_id'],
      occurredAt: row['occurred_at'],
      ...optional,
    }),
    position,
  })
}

/**
 * Read the stored row for an audit id.
 * @param executor - connection or open transaction.
 * @param auditId - the identity to look up.
 */
function readAuditRow(executor: SqlExecutor, auditId: AuditId): SqlRow | undefined {
  return executor.get(`SELECT ${AUDIT_COLUMNS} FROM audit_events WHERE audit_id = ?`, auditId)
}

/**
 * Whether two entries describe the same audit event.
 * @param left - stored record.
 * @param right - the incoming entry.
 */
function sameEntry(left: AuditRecord, right: AuditEntry): boolean {
  return (
    left.auditId === right.auditId &&
    left.type === right.type &&
    left.workspaceId === right.workspaceId &&
    left.correlationId === right.correlationId &&
    left.occurredAt === right.occurredAt &&
    left.taskId === right.taskId &&
    left.attemptId === right.attemptId &&
    left.reviewId === right.reviewId &&
    left.agentId === right.agentId &&
    left.artifactId === right.artifactId &&
    left.causationId === right.causationId
  )
}

/**
 * Append one audit row.
 *
 * Appending the same audit id twice with the same content is idempotent.
 * Appending it with different content is refused with `audit-conflict`: the
 * audit does not silently change its story.
 * @param executor - connection or open transaction.
 * @param entry - the event to append.
 * @returns the row's position and whether this call appended it.
 * @throws {EvidenceError} `invalid-input`, `secret-material`, or `audit-conflict`.
 */
export function appendAuditEntry(executor: SqlExecutor, entry: AuditEntry): AuditAppendResult {
  const valid = validateAuditEntry(entry)
  const existing = readAuditRow(executor, valid.auditId)
  if (existing !== undefined) {
    const stored = rowToRecord(existing)
    if (sameEntry(stored, valid)) return Object.freeze({ position: stored.position, appended: false })
    throw new EvidenceError(
      'audit-conflict',
      `dsh-mywork: audit id "${valid.auditId}" is already recorded with different content`,
      { details: { auditId: valid.auditId } },
    )
  }
  executor.run(
    `INSERT INTO audit_events (audit_id, type, workspace_id, correlation_id, occurred_at, task_id, attempt_id, review_id, agent_id, artifact_id, causation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    valid.auditId,
    valid.type,
    valid.workspaceId,
    valid.correlationId,
    valid.occurredAt,
    valid.taskId ?? null,
    valid.attemptId ?? null,
    valid.reviewId ?? null,
    valid.agentId ?? null,
    valid.artifactId ?? null,
    valid.causationId ?? null,
  )
  const inserted = executor.get('SELECT last_insert_rowid() AS position')
  const position = inserted?.['position']
  if (typeof position !== 'number' || !Number.isSafeInteger(position)) {
    throw new EvidenceError('invalid-input', 'dsh-mywork: the database did not report the appended audit position')
  }
  return Object.freeze({ position, appended: true })
}

/**
 * Read the audit log in append order.
 * @param executor - connection or open transaction.
 * @param query - optional workspace, type, and limit filters.
 * @returns the matching rows, oldest first.
 * @throws {EvidenceError} `invalid-input` when a filter is malformed.
 */
export function readAuditLog(executor: SqlExecutor, query: AuditQuery = {}): readonly AuditRecord[] {
  const clauses: string[] = []
  const params: (string | number)[] = []
  if (query.workspaceId !== undefined) {
    clauses.push('workspace_id = ?')
    params.push(readId({ workspaceId: query.workspaceId }, 'workspaceId', 'audit query'))
  }
  if (query.type !== undefined) {
    clauses.push('type = ?')
    params.push(query.type)
  }
  let limit = ''
  if (query.limit !== undefined) {
    if (!Number.isSafeInteger(query.limit) || query.limit <= 0) {
      throw new EvidenceError('invalid-input', 'dsh-mywork: audit limit must be a positive safe integer')
    }
    limit = ' LIMIT ?'
    params.push(query.limit)
  }
  const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
  return Object.freeze(
    executor.all(`SELECT ${AUDIT_COLUMNS} FROM audit_events${where} ORDER BY position${limit}`, ...params)
      .map(row => rowToRecord(row)),
  )
}
