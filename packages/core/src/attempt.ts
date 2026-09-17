/**
 * Attempt state machine with lease and fence (architecture §17, §18.2).
 *
 * Ownership is checked in two layers, and the difference matters:
 *
 * - The lease carries the controller epoch, and every transition of a leased
 *   attempt must present it: a controller that lost its lease is refused with
 *   `LEASE_LOST`, and a caller that omits the epoch is a programming error
 *   (`TypeError`) rather than a silent bypass. A strictly newer epoch may take
 *   ownership away (`stale`, `revoked`) so a failover can supersede the attempts
 *   of its predecessor (§3, §17), but it may not settle them.
 * - The fence token is compared against the fence of *this* attempt's lease. A
 *   caller that presents a different token is refused with `STALE_FENCE`; a
 *   caller that presents none for a fence-checked target state is likewise a
 *   programming error, because it cannot prove ownership.
 *
 * The task-level current fence — the highest token issued for a task — lives in
 * the lease store (§8), so the §17 supersession (A1 with fence 17 replaced by A2
 * with fence 18) is decided there. Within one attempt the protection is that the
 * superseded attempt is moved to the terminal `stale` state, after which no
 * transition of it is accepted at all and its late result cannot be applied.
 *
 * The returned attempt is frozen at the top level only: `revisions`, `lease`,
 * and `worktree` keep their identity, so nested immutability is a contract of
 * the domain rather than a runtime guarantee.
 * @module
 */

import {
  ATTEMPT_ACTIVE_STATES,
  ATTEMPT_TERMINAL_STATES,
  type Attempt,
  type AttemptState,
  type ControllerEpoch,
  type DomainEvent,
  type EpochMs,
  type FenceToken,
  type Lease,
  type OperationMeta,
  type Result,
  type Revision,
} from '@dsh-mywork/contracts'
import { MyWorkError, fail, ok } from './errors.ts'
import { assertFence, assertRevision, isCounter } from './guards.ts'

/**
 * Allowed attempt transitions (§18.2).
 *
 * - Main line: `created → leased → starting → running → settling → completed`.
 * - Every active state may fail, time out, be cancelled, be revoked, or become
 *   stale; the terminal states have no outgoing edge.
 * - `stale` is the state of an attempt whose fence was superseded by a newer
 *   attempt on the same task (§17).
 */
export const ATTEMPT_TRANSITIONS: Readonly<Record<AttemptState, readonly AttemptState[]>> = Object.freeze({
  created: ['leased', 'cancelled', 'revoked'],
  leased: ['starting', 'failed', 'timed-out', 'cancelled', 'revoked', 'stale'],
  starting: ['running', 'failed', 'timed-out', 'cancelled', 'revoked', 'stale'],
  running: ['settling', 'failed', 'timed-out', 'cancelled', 'revoked', 'stale'],
  settling: ['completed', 'failed', 'timed-out', 'cancelled', 'revoked', 'stale'],
  completed: [],
  failed: [],
  'timed-out': [],
  cancelled: [],
  revoked: [],
  stale: [],
})

/**
 * Target states that assert ownership of the work. Reaching one of them
 * requires the current fence token; `revoked` and `stale` are excluded because
 * they are precisely the states a caller reaches after losing the fence.
 */
export const ATTEMPT_FENCE_CHECKED_STATES: readonly AttemptState[] = Object.freeze([
  'starting',
  'running',
  'settling',
  'completed',
  'failed',
  'timed-out',
  'cancelled',
])

/**
 * Target states that give up ownership of the work. A controller from a newer
 * epoch may reach these (that is how a failover supersedes the attempts of the
 * previous controller, §3, §17), while an obsolete controller may not.
 */
export const ATTEMPT_OWNERSHIP_LOSS_STATES: readonly AttemptState[] = Object.freeze(['stale', 'revoked'])

/** Command accepted by {@link transitionAttempt}. */
export interface AttemptTransitionCommand {
  /** Target state. */
  readonly to: AttemptState
  /** Revision the caller observed; a mismatch is `STALE_REVISION`. */
  readonly expectedRevision?: Revision
  /**
   * Fence the caller holds. Mandatory for a fence-checked target state once the
   * attempt is leased; omitting it is a programming error, because a caller
   * that cannot present its fence cannot prove it still owns the attempt.
   */
  readonly expectedFence?: FenceToken
  /** Lease to attach to the attempt; required for `created → leased`. */
  readonly lease?: Lease
  /**
   * Fence of the previous attempt on the same task, when the caller knows it.
   * A new lease must carry a strictly higher token, so a reused fence cannot
   * silently resurrect an old attempt.
   */
  readonly previousFence?: FenceToken
  /** Clock reading of the transition. */
  readonly at: EpochMs
}

/** Accepted transition: the next attempt plus the events it produced. */
export interface AttemptTransition {
  /** Attempt after the transition, with an incremented revision. */
  readonly attempt: Attempt
  /** State the attempt was in. */
  readonly from: AttemptState
  /** State the attempt moved to. */
  readonly to: AttemptState
  /** Events the transition produced, in order. */
  readonly events: readonly DomainEvent[]
}

/** Whether an attempt still counts as in flight (§15). */
export function isAttemptActive(state: AttemptState): boolean {
  return ATTEMPT_ACTIVE_STATES.includes(state)
}

/** Whether an attempt reached a final state. */
export function isAttemptTerminal(state: AttemptState): boolean {
  return ATTEMPT_TERMINAL_STATES.includes(state)
}

/** Whether a transition between two states is allowed. */
export function canTransitionAttempt(from: AttemptState, to: AttemptState): boolean {
  return ATTEMPT_TRANSITIONS[from].includes(to)
}

/** States reachable from the given one, for diagnostics and UI. */
export function allowedAttemptTransitions(from: AttemptState): readonly AttemptState[] {
  return ATTEMPT_TRANSITIONS[from]
}

/**
 * Move an attempt to another state.
 *
 * Check order: revision, edge, then the ownership of the work (controller epoch
 * and, for a fence-checked target state, the fence token).
 * @param attempt - current attempt.
 * @param command - target state, revision, fence, lease, and clock reading.
 * @param meta - operation identity, including the controller epoch.
 */
export function transitionAttempt(
  attempt: Attempt,
  command: AttemptTransitionCommand,
  meta: OperationMeta,
): Result<AttemptTransition> {
  const revision = assertRevision(command.expectedRevision, attempt.revision, meta)
  if (!revision.ok) return fail(revision.error, meta)

  if (!canTransitionAttempt(attempt.state, command.to)) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: attempt "${attempt.id}" cannot move from "${attempt.state}" to "${command.to}"`, {
        details: { attemptId: attempt.id, from: attempt.state, to: command.to, allowed: [...ATTEMPT_TRANSITIONS[attempt.state]] },
      }),
      meta,
    )
  }

  if (command.to === 'leased') {
    const attached = assertNewLease(attempt, command, meta)
    if (!attached.ok) return fail(attached.error, meta)
  } else if (attempt.lease !== undefined) {
    const ownership = assertOwnership(attempt, attempt.lease, command, meta)
    if (!ownership.ok) return fail(ownership.error, meta)
  }

  const lease = command.to === 'leased' ? command.lease : attempt.lease
  const built: Attempt = {
    id: attempt.id,
    taskId: attempt.taskId,
    workspaceId: attempt.workspaceId,
    agentId: attempt.agentId,
    state: command.to,
    revision: attempt.revision + 1,
    revisions: attempt.revisions,
    ...(lease === undefined ? {} : { lease }),
    ...(attempt.worktree === undefined ? {} : { worktree: attempt.worktree }),
    ...(command.to === 'running' ? { startedAt: command.at } : attempt.startedAt === undefined ? {} : { startedAt: attempt.startedAt }),
    ...(isAttemptTerminal(command.to) ? { settledAt: command.at } : attempt.settledAt === undefined ? {} : { settledAt: attempt.settledAt }),
  }
  const next = Object.freeze(built)

  return ok(
    Object.freeze({
      attempt: next,
      from: attempt.state,
      to: command.to,
      events: Object.freeze([attemptEvent(attempt, command, next)]),
    }),
    meta,
  )
}

/** Validate the lease attached by `created → leased`. */
function assertNewLease(attempt: Attempt, command: AttemptTransitionCommand, meta: OperationMeta): Result<Lease> {
  const lease = command.lease
  if (lease === undefined) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: attempt "${attempt.id}" cannot be leased without a lease`, {
        details: { attemptId: attempt.id },
      }),
      meta,
    )
  }
  if (attempt.lease !== undefined) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: attempt "${attempt.id}" already holds fence ${attempt.lease.fence}`, {
        details: { attemptId: attempt.id, fence: attempt.lease.fence },
      }),
      meta,
    )
  }
  if (lease.attemptId !== attempt.id) {
    return fail(
      new MyWorkError('CONTRACT_MISMATCH', `dsh-mywork: lease belongs to attempt "${lease.attemptId}", not "${attempt.id}"`, {
        details: { attemptId: attempt.id, leaseAttemptId: lease.attemptId },
      }),
      meta,
    )
  }
  if (!isCounter(lease.fence) || !isCounter(lease.controllerEpoch) || !isCounter(lease.expiresAt)) {
    throw new TypeError(`dsh-mywork: lease of attempt "${attempt.id}" must carry integer fence, epoch, and expiry`)
  }
  // A lease is minted under the issuer's own epoch, so the caller must declare
  // it: otherwise an arbitrary epoch could be attached by simply omitting the
  // field, and the ownership checks that follow would be anchored to it.
  const epoch = assertOwnershipEpoch(attempt, lease.controllerEpoch, command, meta)
  if (!epoch.ok) return fail(epoch.error, meta)
  if (command.previousFence !== undefined) {
    if (!isCounter(command.previousFence)) {
      throw new TypeError('dsh-mywork: previousFence must be a non-negative integer')
    }
    if (lease.fence <= command.previousFence) {
      return fail(
        new MyWorkError('TASK_CONFLICT', `dsh-mywork: fence ${lease.fence} must be higher than the previous fence ${command.previousFence}`, {
          details: { attemptId: attempt.id, fence: lease.fence, previousFence: command.previousFence },
        }),
        meta,
      )
    }
  }
  return ok(lease, meta)
}

/** Check that the caller still owns the attempt: epoch first, then fence. */
function assertOwnership(attempt: Attempt, lease: Lease, command: AttemptTransitionCommand, meta: OperationMeta): Result<FenceToken> {
  const epoch = assertOwnershipEpoch(attempt, lease.controllerEpoch, command, meta)
  if (!epoch.ok) return fail(epoch.error, meta)

  if (ATTEMPT_FENCE_CHECKED_STATES.includes(command.to)) {
    if (command.expectedFence === undefined) {
      throw new TypeError(`dsh-mywork: transition to "${command.to}" requires the current fence token`)
    }
    const fence = assertFence(command.expectedFence, lease.fence, meta)
    if (!fence.ok) return fail(fence.error, meta)
  }
  return ok(lease.fence, meta)
}

/**
 * Decide whether the caller's controller epoch may move this attempt.
 *
 * The issuing epoch may always move its own attempt. A strictly newer epoch may
 * only take ownership away (`stale`, `revoked`), which is what a controller
 * failover has to do to the attempts of its predecessor (§3, §17); it may not
 * settle them, because the fence belongs to the old controller. An older epoch
 * may do nothing at all.
 */
function assertOwnershipEpoch(
  attempt: Attempt,
  leaseEpoch: ControllerEpoch,
  command: AttemptTransitionCommand,
  meta: OperationMeta,
): Result<ControllerEpoch> {
  const callerEpoch = meta.controllerEpoch
  if (callerEpoch === undefined) {
    throw new TypeError(
      `dsh-mywork: a transition of leased attempt "${attempt.id}" requires the controller epoch in OperationMeta`,
    )
  }
  if (callerEpoch === leaseEpoch) return ok(leaseEpoch, meta)

  const supersedes = callerEpoch > leaseEpoch && ATTEMPT_OWNERSHIP_LOSS_STATES.includes(command.to)
  if (supersedes) return ok(leaseEpoch, meta)

  return fail(
    new MyWorkError('LEASE_LOST', `dsh-mywork: controller epoch ${callerEpoch} may not move attempt "${attempt.id}" leased to epoch ${leaseEpoch}`, {
      details: { expected: callerEpoch, actual: leaseEpoch, to: command.to },
    }),
    meta,
  )
}

/** Event produced by an attempt transition. */
function attemptEvent(attempt: Attempt, command: AttemptTransitionCommand, next: Attempt): DomainEvent {
  const fence = next.lease?.fence
  return Object.freeze({
    type: 'attempt.state.changed',
    payload: Object.freeze({
      attemptId: attempt.id,
      taskId: attempt.taskId,
      from: attempt.state,
      to: command.to,
      revision: next.revision,
      ...(fence === undefined ? {} : { fence }),
      at: command.at,
    }),
  })
}
