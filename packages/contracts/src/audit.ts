/**
 * Audit contracts (architecture §34).
 *
 * Audit is not a log. It is append-only, it is never truncated by ordinary log
 * rotation, and it carries structure rather than prose: a row names what
 * happened, for which workspace, under which correlation, and points at the
 * artifact holding the full detail (§8 keeps the summary in MyWork DB and the
 * text in the Artifact Store). Because no field is free text, secret material
 * has no field to travel in.
 * @module
 */

import type {
  AgentId,
  ArtifactId,
  AttemptId,
  AuditId,
  CorrelationId,
  EpochMs,
  EventId,
  ReviewId,
  TaskId,
  WorkspaceId,
} from './ids.ts'

/** Schema identifier carried by every audit row. */
export const AUDIT_SCHEMA = 'mywork.audit/v1'

/** What the audit records (§34). */
export type AuditEventType =
  /** A task was created. */
  | 'task.created'
  /** A task was modified. */
  | 'task.modified'
  /** An attempt was assigned to an agent. */
  | 'attempt.assigned'
  /** An attempt was revoked. */
  | 'attempt.revoked'
  /** A review rejected its artifact. */
  | 'review.rejected'
  /** A review approved its artifact. */
  | 'review.approved'
  /** A role contract or strategy was revised. */
  | 'role.revised'
  /** A skill was patched. */
  | 'skill.patched'
  /** The optimizer promoted a candidate. */
  | 'optimizer.promoted'
  /** A human overrode an automated decision. */
  | 'human.override'
  /** The controller failed over to another instance. */
  | 'controller.failover'
  /** A typed gate was decided by a human or an admitted policy (ADR028 §5.18). */
  | 'gate.decided'
  /** A staged plan mutation was applied and verified (ADR024). */
  | 'plan.mutation.applied'
  /** A staged plan mutation failed verification and needs an operator (ADR024). */
  | 'plan.mutation.recovered'

/** Every audit event type, in the order §34 lists them. */
export const AUDIT_EVENT_TYPES: readonly AuditEventType[] = Object.freeze([
  'task.created',
  'task.modified',
  'attempt.assigned',
  'attempt.revoked',
  'review.rejected',
  'review.approved',
  'role.revised',
  'skill.patched',
  'optimizer.promoted',
  'human.override',
  'controller.failover',
  'gate.decided',
  'plan.mutation.applied',
  'plan.mutation.recovered',
])

/**
 * Fields an audit row carries, in stored order. Runtime data, so the store can
 * refuse a row carrying a field it does not declare.
 */
export const AUDIT_ENTRY_FIELDS: readonly string[] = Object.freeze([
  'schema',
  'auditId',
  'type',
  'workspaceId',
  'correlationId',
  'occurredAt',
  'taskId',
  'attemptId',
  'reviewId',
  'agentId',
  'artifactId',
  'causationId',
])

/** What a caller appends to the audit. */
export interface AuditEntry {
  /** Always {@link AUDIT_SCHEMA}. */
  readonly schema: typeof AUDIT_SCHEMA
  /** Caller-owned identity of the row. */
  readonly auditId: AuditId
  /** What happened. */
  readonly type: AuditEventType
  /** Workspace the event belongs to. */
  readonly workspaceId: WorkspaceId
  /** Correlation of the workflow that caused it (§33). */
  readonly correlationId: CorrelationId
  /** Clock reading of the event, in epoch milliseconds. */
  readonly occurredAt: EpochMs
  /** Task the event concerns (§33). */
  readonly taskId?: TaskId
  /** Attempt the event concerns (§33). */
  readonly attemptId?: AttemptId
  /** Review the event concerns (§33). */
  readonly reviewId?: ReviewId
  /** Agent the event concerns (§33). */
  readonly agentId?: AgentId
  /** Artifact holding the full detail of this event (§8, §32). */
  readonly artifactId?: ArtifactId
  /** Event that caused this one (§33). */
  readonly causationId?: EventId
}

/** One stored audit row, as read back. */
export interface AuditRecord extends AuditEntry {
  /** Monotonic position of the row in the append-only log. */
  readonly position: number
}
