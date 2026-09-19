/**
 * Controller lifecycle: activation acquires leadership, opens the stores,
 * reconciles, then admits work; disposal stops admission first and only then
 * gives up the lease (architecture §5.3, §16.1, §49).
 *
 * §16.1 orders startup explicitly:
 *
 * ```text
 * Acquire Controller Lease → Open stores → Load configuration
 *   → Reconcile incomplete operations → Reconcile leases/attempts
 *   → Read ready tasks → Fill capacity → Subscribe events → Running
 * ```
 *
 * This module implements the part of that order the controller itself owns —
 * lease, stores, reconciliation, admission — and leaves scheduling policy to the
 * cards that build it. §5.1 is why it is driven by activation and not by a UI:
 * the lifecycle runs inside the host process, so no browser tab is needed for a
 * controller to hold leadership, reconcile, and later be superseded by a
 * failover.
 *
 * Disposal is the reverse order, and the order matters: admission is closed
 * first, so no new mutation starts while the lease is still held, and the lease
 * is released only once the controllers' writes have stopped. Releasing earlier
 * would let a successor take over and write concurrently with a disposal that
 * still believed it held leadership.
 * @module
 */

import type { ControllerEpoch, EpochMs, LeaseStorePort } from '@dsh-mywork/contracts'
import { LeaseError } from './errors.ts'

/** Phase of a controller's lifecycle. */
export type ControllerLifecyclePhase =
  /** Constructed, activation not started. */
  | 'idle'
  /** Activation is acquiring leadership and opening stores. */
  | 'activating'
  /** Leadership held, stores open, reconciliation done: work may be admitted. */
  | 'active'
  /** Another controller holds the scope; this one is passive and admits nothing. */
  | 'passive'
  /** Disposal started: admission is closed, resources are being released. */
  | 'disposing'
  /** Disposed; nothing further may be admitted. */
  | 'disposed'

/** Where a controller's state lives, as opened during activation. */
export interface ControllerStores<TStore = unknown> {
  /** The registry database (`registry.sqlite`, §7). */
  readonly registry: TStore
  /** The controller/lease database (`controller.sqlite`, §7). */
  readonly controller: TStore
}

/** Outcome of reconciliation, reported through the lifecycle snapshot. */
export interface ReconcileReport {
  /** How many incomplete operations the reconciler settled. */
  readonly operations: number
  /** How many stale leases or attempts it reclaimed. */
  readonly leases: number
}

/** Snapshot of one controller's lifecycle. */
export interface ControllerLifecycleInfo {
  /** Current phase. */
  readonly phase: ControllerLifecyclePhase
  /** This controller's instance id. */
  readonly instanceId: string
  /** Epoch this controller holds; absent until leadership is acquired. */
  readonly epoch?: ControllerEpoch
  /** Clock reading leadership was acquired. */
  readonly activatedAt?: EpochMs
  /** Whether mutations may be admitted right now. */
  readonly admitting: boolean
  /**
   * True when activation found a durable hold and left admission closed because
   * of it: a staged plan mutation that has not settled (§5.2, ADR024). Present
   * only while the hold explains the closed gate, so a projection can name the
   * reason instead of showing an unexplained pause.
   */
  readonly admissionHeld?: boolean
}

/**
 * The dependencies one activation needs.
 *
 * Every one is injected. Store opening is a caller-supplied factory rather than
 * a hard dependency on the storage package, so the lifecycle is testable without
 * a database and the controller keeps the same layering as the evidence layer.
 */
export interface ControllerLifecycleOptions<TStore = unknown> {
  /** Installation scope this controller leads. */
  readonly scopeId: string
  /** This controller's instance id. */
  readonly instanceId: string
  /** Operating-system process id. */
  readonly processId: number
  /** Time source; `FakeClock` keeps expiry and failover deterministic. */
  readonly clock: { now(): number }
  /** How long one lease lasts. */
  readonly leaseMs: number
  /** The lease store this controller competes through. */
  readonly leases: LeaseStorePort
  /** Open both state databases; called once, after leadership is acquired. */
  readonly openStores: () => Promise<ControllerStores<TStore>> | ControllerStores<TStore>
  /**
   * Reconcile incomplete operations and stale leases (§16.1, §49). Called once
   * per successful activation, before the controller admits any work.
   */
  readonly reconcile: (stores: ControllerStores<TStore>) => Promise<ReconcileReport> | ReconcileReport
  /**
   * Whether a durable hold keeps admission closed after this activation.
   *
   * ADR020 makes the admission pause one mechanism shared by the staged plan
   * mutation and the manual workflow pause. The hold is a row, not a flag, so a
   * controller that was killed in the middle of a staged operation comes back
   * paused: this hook reads that row, `activate` leaves admission closed while it
   * stands, and `resumeAdmission` opens it once the operation has settled.
   *
   * Absent means no hold is consulted, which is what every deployment without a
   * planner gets — and keeps this layer free of any dependency on one.
   */
  readonly admissionHold?: (stores: ControllerStores<TStore>) => Promise<boolean> | boolean
  /** Close both stores; called during disposal. */
  readonly closeStores: (stores: ControllerStores<TStore>) => Promise<void> | void
}

/**
 * One controller's activation and disposal.
 *
 * The type parameter is the store handle the caller's factories produce, so the
 * lifecycle never names the storage package.
 */
export class ControllerLifecycle<TStore = unknown> {
  // TypeScript-private rather than `#`-private: a Cordis service is handed to
  // callers through a proxy, and a proxied object cannot reach `#` fields.
  private readonly options: ControllerLifecycleOptions<TStore>
  private phase: ControllerLifecyclePhase = 'idle'
  private admissionOpen = false
  private epoch: ControllerEpoch | undefined
  private activatedAt: EpochMs | undefined
  private stores: ControllerStores<TStore> | undefined
  private report: ReconcileReport | undefined
  private heldByAdmission = false

  /**
   * @param options - identity, clock, lease store, and store factories.
   */
  constructor(options: ControllerLifecycleOptions<TStore>) {
    if (options.instanceId.trim().length === 0) {
      throw new TypeError('dsh-mywork: a controller instance id must be a non-empty string')
    }
    if (!Number.isInteger(options.leaseMs) || options.leaseMs <= 0) {
      throw new TypeError(`dsh-mywork: leaseMs must be a positive integer, received ${String(options.leaseMs)}`)
    }
    this.options = options
  }

  /** Snapshot of the current lifecycle. */
  info(): ControllerLifecycleInfo {
    return Object.freeze({
      phase: this.phase,
      instanceId: this.options.instanceId,
      ...(this.epoch === undefined ? {} : { epoch: this.epoch }),
      ...(this.activatedAt === undefined ? {} : { activatedAt: this.activatedAt }),
      admitting: this.admissionOpen,
      ...(this.heldByAdmission ? { admissionHeld: true } : {}),
    })
  }

  /** Epoch this controller holds, or `undefined` while it is not a leader. */
  get heldEpoch(): ControllerEpoch | undefined {
    return this.epoch
  }

  /** Reconciliation result of this activation; absent when it did not activate. */
  get reconcileReport(): ReconcileReport | undefined {
    return this.report
  }

  /**
   * Whether this controller may still commit a mutation at `at`.
   *
   * This is the gate a mutation path calls. It reads durable state, so a
   * controller that was superseded during a failover is refused even if it has
   * not yet observed the loss itself.
   * @param at - clock reading the check is made at; defaults to now.
   */
  isWriter(at: EpochMs = this.options.clock.now()): boolean {
    if (!this.admissionOpen || this.epoch === undefined) return false
    return this.options.leases.holdsLeadership(this.options.scopeId, this.options.instanceId, this.epoch, at)
  }

  /**
   * Whether this controller currently holds an unexpired lease, regardless of
   * whether it is still admitting work.
   * @param at - clock reading the check is made at.
   */
  holdsLease(at: EpochMs = this.options.clock.now()): boolean {
    if (this.epoch === undefined) return false
    return this.options.leases.holdsLeadership(this.options.scopeId, this.options.instanceId, this.epoch, at)
  }

  /**
   * Activate: acquire leadership, open stores, reconcile, then open admission.
   *
   * A passive controller — one that found a live lease held by somebody else —
   * returns without opening stores and without admitting work. It is not an
   * error: §5.3 permits many mounted controllers and one writer.
   * @returns the resulting lifecycle snapshot.
   * @throws {Error} when activation fails after leadership was acquired; the
   * lease is released so a successor is not blocked by a failed activation.
   */
  async activate(): Promise<ControllerLifecycleInfo> {
    if (this.phase !== 'idle') {
      throw new Error(`dsh-mywork: cannot activate a controller in phase "${this.phase}"`)
    }
    this.phase = 'activating'
    const now = this.options.clock.now()
    const result = this.options.leases.acquire({
      scopeId: this.options.scopeId,
      instanceId: this.options.instanceId,
      processId: this.options.processId,
      now,
      leaseMs: this.options.leaseMs,
    })

    if (result.outcome === 'held-by-other' || result.lease === undefined) {
      this.phase = 'passive'
      return this.info()
    }

    this.epoch = result.lease.epoch
    this.activatedAt = now
    try {
      this.stores = await this.options.openStores()
      this.report = await this.options.reconcile(this.stores)
      this.heldByAdmission = (await this.options.admissionHold?.(this.stores)) ?? false
    } catch (error) {
      // Leadership without open stores is useless and would block a healthy
      // successor until expiry, so it is given back before the failure surfaces.
      this.releaseQuietly()
      throw error
    }
    this.phase = 'active'
    // A durable hold keeps admission closed: the staged plan mutation that took
    // it has not settled, and §5.2 keeps the pause until an operator decides.
    this.admissionOpen = !this.heldByAdmission
    return this.info()
  }

  /**
   * Open admission after a hold was released.
   *
   * The caller releases the durable hold first (the operation settled) and then
   * calls this, so the in-memory gate never claims a pause is over while the row
   * still says otherwise. Idempotent for a controller that is already admitting.
   * @returns the resulting lifecycle snapshot.
   * @throws {LeaseError} `lease-lost` when this controller is not active.
   */
  resumeAdmission(): ControllerLifecycleInfo {
    if (this.phase !== 'active' || this.epoch === undefined) {
      throw new LeaseError(
        'lease-lost',
        `dsh-mywork: controller "${this.options.instanceId}" is not active, so it cannot resume admission`,
      )
    }
    this.heldByAdmission = false
    this.admissionOpen = true
    return this.info()
  }

  /**
   * Renew the lease while admitting work.
   *
   * A renewal that fails means leadership was lost — the lease expired or a
   * successor took over — and admission is closed before the failure is raised,
   * so no mutation starts after the loss was observed.
   * @throws {LeaseError} `lease-lost` when this controller no longer leads.
   */
  heartbeat(): ControllerLifecycleInfo {
    if (this.phase !== 'active' || this.epoch === undefined) {
      throw new LeaseError('lease-lost', `dsh-mywork: controller "${this.options.instanceId}" is not active, so it cannot heartbeat`)
    }
    try {
      this.options.leases.heartbeat({
        scopeId: this.options.scopeId,
        instanceId: this.options.instanceId,
        processId: this.options.processId,
        now: this.options.clock.now(),
        leaseMs: this.options.leaseMs,
      })
    } catch (error) {
      this.admissionOpen = false
      this.phase = 'passive'
      throw error
    }
    return this.info()
  }

  /**
   * Dispose: stop admission, close stores, then release the lease.
   *
   * Idempotent, and safe on a controller that never activated. Admission is
   * closed first and only then is the lease released, so a successor can never
   * begin writing while this controller is still finishing a mutation (§5.3).
   */
  async dispose(): Promise<void> {
    if (this.phase === 'disposed' || this.phase === 'disposing') return
    this.phase = 'disposing'
    this.admissionOpen = false
    // The gate is closed by the disposal itself now, not by the hold, so the
    // snapshot stops blaming the staged operation for it.
    this.heldByAdmission = false
    const stores = this.stores
    this.stores = undefined
    if (stores !== undefined) {
      await this.options.closeStores(stores)
    }
    this.releaseQuietly()
    this.epoch = undefined
    this.phase = 'disposed'
  }

  /** Release if this controller still holds the lease; never throws. */
  private releaseQuietly(): void {
    if (this.epoch === undefined) return
    try {
      this.options.leases.release({
        scopeId: this.options.scopeId,
        instanceId: this.options.instanceId,
        epoch: this.epoch,
      })
    } catch {
      // A disposal that cannot write the row must not mask the original failure;
      // the lease expires on its own, which is the §49 recovery path anyway.
    }
  }
}
