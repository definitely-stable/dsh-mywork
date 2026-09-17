/**
 * Optimistic-concurrency guards: revision, fence, controller epoch, and the
 * validation of a frozen revision set (architecture §9, §17, §35).
 *
 * The guards are pure and return a `Result`, so a stale caller is answered with
 * its own error code (`STALE_REVISION`, `STALE_FENCE`, `LEASE_LOST`) instead of
 * a generic conflict.
 * @module
 */

import {
  REVISION_KINDS,
  type ControllerEpoch,
  type FenceToken,
  type FrozenRevisions,
  type OperationMeta,
  type Result,
  type Revision,
  type RevisionKind,
} from '@dsh-mywork/contracts'
import { MyWorkError, fail, ok } from './errors.ts'

/** Input accepted by {@link defineOperationMeta}. */
export interface OperationMetaInput {
  /** Identifier of the operation; must be non-empty. */
  readonly operationId: string
  /** Correlation of the workflow; must be non-empty. */
  readonly correlationId: string
  /** Aggregate revision the caller observed. */
  readonly expectedRevision?: Revision
  /** Controller epoch the caller belongs to. */
  readonly controllerEpoch?: ControllerEpoch
}

/**
 * Validate and freeze an operation identity.
 *
 * A malformed identity is a programming error, not a runtime condition: no
 * store may be touched with an operation that cannot be correlated.
 * @param input - operation identity fields.
 * @returns the frozen metadata.
 * @throws {TypeError} when an identifier is empty or a counter is not a non-negative integer.
 */
export function defineOperationMeta(input: OperationMetaInput): OperationMeta {
  requireIdentifier(input.operationId, 'operationId')
  requireIdentifier(input.correlationId, 'correlationId')
  if (input.expectedRevision !== undefined) requireCounter(input.expectedRevision, 'expectedRevision')
  if (input.controllerEpoch !== undefined) requireCounter(input.controllerEpoch, 'controllerEpoch')
  return Object.freeze({
    operationId: input.operationId,
    correlationId: input.correlationId,
    ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
    ...(input.controllerEpoch === undefined ? {} : { controllerEpoch: input.controllerEpoch }),
  })
}

/**
 * Check the caller's expected aggregate revision.
 *
 * An absent expectation means "no concurrency precondition" and always passes.
 * @param expected - revision the caller observed, if any.
 * @param actual - revision the aggregate currently has.
 * @param meta - operation identity.
 */
export function assertRevision(
  expected: Revision | undefined,
  actual: Revision,
  meta: OperationMeta,
): Result<Revision> {
  if (expected === undefined) return ok(actual, meta)
  if (expected !== actual) {
    return fail(
      new MyWorkError('STALE_REVISION', `dsh-mywork: expected revision ${expected}, current revision is ${actual}`, {
        details: { expected, actual },
      }),
      meta,
    )
  }
  return ok(actual, meta)
}

/**
 * Check the caller's fence token against the attempt's current fence (§17).
 *
 * This is what rejects a late result from a superseded attempt: the earlier
 * attempt holds fence 17, the reassigned one holds 18, and the late result
 * arrives carrying 17.
 * @param expected - fence token the caller holds.
 * @param actual - fence token on the attempt's lease.
 * @param meta - operation identity.
 * @throws {TypeError} when a token is not a non-negative integer.
 */
export function assertFence(expected: FenceToken, actual: FenceToken, meta: OperationMeta): Result<FenceToken> {
  requireCounter(expected, 'expectedFence')
  requireCounter(actual, 'actualFence')
  if (expected !== actual) {
    return fail(
      new MyWorkError('STALE_FENCE', `dsh-mywork: fence ${expected} is not the current fence ${actual}`, {
        details: { expected, actual },
      }),
      meta,
    )
  }
  return ok(actual, meta)
}

/**
 * Check the controller epoch the caller belongs to (§3, §9).
 *
 * A controller that lost its lease must not mutate work now owned by a newer
 * epoch; the failure is `LEASE_LOST`, not a generic conflict. An absent epoch
 * means "no ownership precondition" and passes.
 * @param expected - epoch the caller declares, if any.
 * @param actual - epoch recorded with the lease.
 * @param meta - operation identity.
 */
export function assertControllerEpoch(
  expected: ControllerEpoch | undefined,
  actual: ControllerEpoch,
  meta: OperationMeta,
): Result<ControllerEpoch> {
  if (expected === undefined) return ok(actual, meta)
  if (expected !== actual) {
    return fail(
      new MyWorkError('LEASE_LOST', `dsh-mywork: controller epoch ${expected} lost the lease to epoch ${actual}`, {
        details: { expected, actual },
      }),
      meta,
    )
  }
  return ok(actual, meta)
}

/**
 * Validate a resolved revision set and freeze it (§35).
 *
 * A running attempt keeps exactly the revisions resolved at admission, so an
 * unknown revision family is a contract mismatch rather than a silently kept
 * extra key.
 * @param input - resolved revisions, keyed by family.
 * @param meta - operation identity.
 */
export function freezeRevisions(input: FrozenRevisions, meta: OperationMeta): Result<FrozenRevisions> {
  const frozen: Partial<Record<RevisionKind, Revision>> = {}
  for (const [kind, revision] of Object.entries(input)) {
    if (!REVISION_KINDS.includes(kind as RevisionKind)) {
      return fail(
        new MyWorkError('CONTRACT_MISMATCH', `dsh-mywork: unknown revision family "${kind}"`, { details: { kind } }),
        meta,
      )
    }
    if (!isCounter(revision)) {
      return fail(
        new MyWorkError('CONTRACT_MISMATCH', `dsh-mywork: revision "${kind}" must be a non-negative integer`, {
          details: { kind, revision },
        }),
        meta,
      )
    }
    frozen[kind as RevisionKind] = revision
  }
  return ok(Object.freeze(frozen), meta)
}

/** Whether a value is a non-negative safe integer counter. */
export function isCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Reject an empty or non-string identifier. */
function requireIdentifier(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`dsh-mywork: ${field} must be a non-empty string`)
  }
}

/** Reject a counter that is not a non-negative safe integer. */
function requireCounter(value: number, field: string): void {
  if (!isCounter(value)) {
    throw new TypeError(`dsh-mywork: ${field} must be a non-negative integer`)
  }
}
