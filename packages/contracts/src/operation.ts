/**
 * Canonical result, error, and operation identity (architecture §9, §42).
 *
 * Every MyWork mutation is described by one {@link OperationMeta} and answers
 * with a {@link Result}, so callers branch on a stable error code instead of on
 * exception text coming from an adapter or a store.
 * @module
 */

import type { ControllerEpoch, CorrelationId, OperationId, Revision } from './ids.ts'

/**
 * Identity of one mutation (§9). Cross-store workflows carry the same
 * `operationId` through every store hop, so a retry is recognisable as the same
 * operation rather than as a new one.
 */
export interface OperationMeta {
  /** Identifier of this operation; repeated delivery keeps the same value. */
  readonly operationId: OperationId
  /** Identifier correlating every operation and event of one workflow. */
  readonly correlationId: CorrelationId
  /**
   * Aggregate revision the caller observed when it decided to mutate; a
   * mismatch is reported as `STALE_REVISION`.
   */
  readonly expectedRevision?: Revision
  /**
   * Controller lease epoch the caller belongs to; a mismatch is reported as
   * `LEASE_LOST` because a newer controller owns the work.
   */
  readonly controllerEpoch?: ControllerEpoch
}

/** Machine-readable failure codes (architecture §42). */
export type MyWorkErrorCode =
  /** The adapter behind a port is unreachable or not configured. */
  | 'ADAPTER_UNAVAILABLE'
  /** The adapter does not declare the capability the operation needs. */
  | 'CAPABILITY_UNSUPPORTED'
  /** Caller and adapter disagree about the contract revision. */
  | 'CONTRACT_MISMATCH'
  /** The operation conflicts with current state (illegal transition, occupied slot). */
  | 'TASK_CONFLICT'
  /** The caller's expected aggregate revision is not the current one. */
  | 'STALE_REVISION'
  /** The controller epoch moved on: this controller no longer owns the work. */
  | 'LEASE_LOST'
  /** The caller's fence token is behind the attempt's current fence (§17). */
  | 'STALE_FENCE'
  /** The model-visible context would exceed its budget. */
  | 'CONTEXT_BUDGET_EXCEEDED'
  /** The memory backend failed. */
  | 'MEMORY_BACKEND_ERROR'
  /** The referenced session does not exist. */
  | 'SESSION_NOT_FOUND'
  /** A configured budget (tokens, attempts, wall clock) is exhausted. */
  | 'BUDGET_EXCEEDED'
  /** No attempt may be admitted for this task right now (terminal or not ready). */
  | 'UNSCHEDULABLE'
  /** The caller is not allowed to perform this operation (authority, role contract). */
  | 'SECURITY_DENIED'
  /** A planner tried to mutate an existing task instead of adding one (§5.1). */
  | 'PLANNER_SCOPE_DENIED'
  /** No ordering key fits between two neighbours; the zone must be renumbered (§5.3). */
  | 'ORDER_RENUMBER_REQUIRED'
  /** The caller's expected zone revision is not the current one (§5.3). */
  | 'STALE_COLUMN_REVISION'
  /** The command needs an evidence request before it may proceed (§5.12). */
  | 'EVIDENCE_REQUEST_REQUIRED'
  /** A plan mutation could not be applied as one unit and was staged (ADR024). */
  | 'PLAN_MUTATION_STAGED'
  /** A staged plan mutation failed verification and needs an operator (ADR024). */
  | 'PLAN_MUTATION_RECOVERY'
  /** The change would create a dependency cycle and was refused. */
  | 'ENTITY_CYCLE'
  /**
   * An approval no longer covers the artifact in front of the caller: the head
   * SHA or the diff hash moved after it was given (§19, E-23). Kept apart from
   * {@link MyWorkErrorCode} `STALE_REVISION` on purpose — that one is an
   * aggregate revision a retry can re-read, while this one means the work itself
   * changed and must be reviewed again.
   */
  | 'STALE_APPROVAL'

/** Every error code, in the order the architecture lists them. */
export const MYWORK_ERROR_CODES: readonly MyWorkErrorCode[] = Object.freeze([
  'ADAPTER_UNAVAILABLE',
  'CAPABILITY_UNSUPPORTED',
  'CONTRACT_MISMATCH',
  'TASK_CONFLICT',
  'STALE_REVISION',
  'LEASE_LOST',
  'STALE_FENCE',
  'CONTEXT_BUDGET_EXCEEDED',
  'MEMORY_BACKEND_ERROR',
  'SESSION_NOT_FOUND',
  'BUDGET_EXCEEDED',
  'UNSCHEDULABLE',
  'SECURITY_DENIED',
  'PLANNER_SCOPE_DENIED',
  'ORDER_RENUMBER_REQUIRED',
  'STALE_COLUMN_REVISION',
  'EVIDENCE_REQUEST_REQUIRED',
  'PLAN_MUTATION_STAGED',
  'PLAN_MUTATION_RECOVERY',
  'ENTITY_CYCLE',
  'STALE_APPROVAL',
])

/**
 * Failure value carried by a failed {@link Result}. The concrete class lives in
 * `@dsh-mywork/core`; this contract keeps the package free of runtime logic.
 */
export interface MyWorkErrorShape {
  /** Stable failure code. */
  readonly code: MyWorkErrorCode
  /** Human-readable detail; never parsed by callers. */
  readonly message: string
  /** Structured context for logs and audit (expected/actual, ids). */
  readonly details: Readonly<Record<string, unknown>>
}

/** Canonical result of a MyWork operation (architecture §42). */
export type Result<T> =
  | {
      readonly ok: true
      readonly value: T
      readonly meta: OperationMeta
    }
  | {
      readonly ok: false
      readonly error: MyWorkErrorShape
      readonly meta: OperationMeta
    }
