/**
 * Controller lease, epoch, and leadership record (architecture §5.3, §16.1,
 * §17, §49).
 *
 * §5.3 states the single-controller invariant: exactly one controller may
 * mutate the runtime state of one MyWork installation scope. The record below
 * is what that invariant is checked against, and `§8` places it in the MyWork DB
 * / Lease Store rather than in the UI or the task projection.
 *
 * §49 names the failover: when a controller dies its lease expires, another
 * controller takes leadership at a higher epoch, and reconciliation follows.
 * The epoch is what makes the first controller recognise, on its return, that
 * the work is no longer its own.
 * @module
 */

import type { ControllerEpoch, EpochMs } from './ids.ts'

/**
 * One controller's claim on one installation scope.
 *
 * The shape follows the §5.3 lease verbatim: the instance and process that hold
 * it, when they started and last confirmed it, when it runs out, and the epoch
 * the holder belongs to.
 */
export interface ControllerLease {
  /** Installation scope this row protects; the CAS key. */
  readonly scopeId: string
  /** Identity of the controller instance holding the lease. */
  readonly instanceId: string
  /** Operating-system process id that took the lease (§5.3). */
  readonly processId: number
  /** Leadership epoch; strictly increases with every handover. */
  readonly epoch: ControllerEpoch
  /** Clock reading when this instance acquired leadership. */
  readonly acquiredAt: EpochMs
  /** Clock reading of the most recent successful heartbeat. */
  readonly heartbeatAt: EpochMs
  /** Clock reading after which the lease is expired and claimable. */
  readonly leaseUntil: EpochMs
}

/**
 * Outcome of a leadership attempt.
 *
 * The three cases are distinguished because the caller must react differently:
 * `acquired` may proceed to open stores, `held-by-other` must stay passive, and
 * `expired-taken-over` is a real failover that the new leader owes
 * reconciliation for.
 */
export type ControllerLeadershipOutcome =
  /** This controller now holds the lease. */
  | 'acquired'
  /** This controller already held it and renewed, or re-acquired its own record. */
  | 'renewed'
  /** Another live controller holds it; this one is passive. */
  | 'held-by-other'
  /** The previous lease had expired and this controller took over at a higher epoch. */
  | 'expired-taken-over'

/** Result of one {@link LeaseStorePort.acquire} or `heartbeat` call. */
export interface ControllerLeaseResult {
  /** What happened to leadership. */
  readonly outcome: ControllerLeadershipOutcome
  /** The lease row as it stands after the call; absent only when nothing was claimable. */
  readonly lease?: ControllerLease
}

/**
 * The lease store surface (architecture §36 `lease-store` port; §5.3 acquisition
 * "by CAS/transaction mechanism").
 *
 * Every method is atomic with respect to the durable row: a lease is decided by
 * one transaction, so two controllers racing for it cannot both observe
 * success.
 */
export interface LeaseStorePort {
  /**
   * Try to take leadership of the scope.
   * @param request - this controller's identity and the requested lease window.
   */
  acquire(request: ControllerAcquireRequest): ControllerLeaseResult
  /**
   * Extend the lease this controller already holds.
   * @param request - this controller's identity and the renewal window.
   * @throws {Error} when the lease is no longer held by this instance at this epoch.
   */
  heartbeat(request: ControllerAcquireRequest): ControllerLeaseResult
  /**
   * Read the current row without changing it.
   * @param scopeId - installation scope to read.
   */
  read(scopeId: string): ControllerLease | undefined
  /**
   * Release the lease this controller holds, if it still holds it.
   * @param request - the identity and epoch releasing leadership.
   */
  release(request: ControllerReleaseRequest): boolean
  /**
   * Whether this instance at this epoch may still commit mutations.
   *
   * Both identity and epoch are required: a refused claimant is shown the
   * holder's current epoch, so an epoch alone would let it pass the gate.
   * @param scopeId - installation scope to check.
   * @param instanceId - instance claiming leadership.
   * @param epoch - epoch the instance belongs to.
   * @param at - clock reading the check is made at.
   */
  holdsLeadership(scopeId: string, instanceId: string, epoch: ControllerEpoch, at: EpochMs): boolean
}

/** Identity and window of one leadership attempt. */
export interface ControllerAcquireRequest {
  /** Installation scope to lead. */
  readonly scopeId: string
  /** This controller's instance id. */
  readonly instanceId: string
  /** This controller's process id. */
  readonly processId: number
  /** Clock reading of the attempt. */
  readonly now: EpochMs
  /** How long the lease stays valid after `now`. */
  readonly leaseMs: number
}

/** Identity of one release. */
export interface ControllerReleaseRequest {
  /** Installation scope to give up. */
  readonly scopeId: string
  /** Instance giving it up; a different instance's release is refused. */
  readonly instanceId: string
  /** Epoch the caller holds; releasing a superseded epoch is a no-op. */
  readonly epoch: ControllerEpoch
}
