/**
 * The leadership runtime of one controller: the thin façade between the
 * composition root and the lifecycle steps of §16.1 (MW-028 E-42…E-45).
 *
 * ```text
 * acquire lease → open stores → reconcile → consult the admission hold → admit
 * ```
 *
 * It is deliberately **not** a second composition root. It opens no database and
 * keeps no second lease: the root (`app.ts`) opens `registry.sqlite`, hands this
 * module the one {@link LeaseStorePort} and one factory for `controller.sqlite`,
 * and receives the stores back. What this module owns is the *order* — leadership
 * before stores (`packages/lease/src/lifecycle.ts:236`), reconciliation before
 * the first admission, a durable hold keeping admission closed, a heartbeat
 * driven by the injected clock, and one idempotent shutdown whose steps are
 * `admission → settle → release`.
 *
 * Because the order is the deliverable, this module also records it:
 * {@link ControllerRuntime.startupTrace} and {@link ControllerRuntime.shutdownTrace}
 * are the evidence a test asserts instead of trusting the prose above.
 * @module
 */

import type {
  ClockPort,
  ControllerAcquireRequest,
  ControllerEpoch,
  ControllerLeadershipOutcome,
  ControllerLease,
  ControllerLeaseResult,
  ControllerReleaseRequest,
  EpochMs,
  LeaseStorePort,
} from '@dsh-mywork/contracts'
import {
  ControllerLifecycle,
  type ControllerLifecycleInfo,
  type ControllerStores,
  type ReconcileReport,
} from '@dsh-mywork/lease'
import type { MyWorkStore } from '@dsh-mywork/storage'
import {
  createClientSessions,
  createGracefulShutdown,
  type MyWorkClientSessions,
  type MyWorkDeployment,
  type MyWorkShutdownEntry,
} from './deployment.ts'
import { ControllerRuntimeError } from './errors.ts'
import { startControllerHeartbeat, type ControllerHeartbeat } from './heartbeat.ts'

/** The names of the activation steps, in the only order they may run. */
export const MYWORK_STARTUP_STEPS = Object.freeze([
  'lease',
  'stores',
  'reconcile',
  'admission',
] as const)

/** One step of {@link MYWORK_STARTUP_STEPS}. */
export type ControllerStartupStepName = (typeof MYWORK_STARTUP_STEPS)[number]

/** One activation step, as the runtime observed it after the step completed. */
export interface ControllerStartupEntry {
  /** Which step completed. */
  readonly step: ControllerStartupStepName
  /** Clock reading after the step. */
  readonly at: number
  /** Whether the durable lease row named this instance at that moment. */
  readonly leaseHeld: boolean
  /** Whether mutations could be admitted at that moment. */
  readonly admitting: boolean
  /** Whether a durable admission hold was in force at that moment. */
  readonly admissionHeld: boolean
  /** Epoch this instance holds, once leadership was acquired. */
  readonly epoch?: ControllerEpoch
}

/** What one acquisition of the scope reported to the reconciliation step. */
export interface ControllerLeadershipObservation {
  /** What the lease transaction decided: acquired, renewed, or taken over. */
  readonly outcome: ControllerLeadershipOutcome
  /** Epoch the acquired row carries; absent when another controller holds the scope. */
  readonly epoch?: ControllerEpoch
  /**
   * Stale leases this activation reclaimed by taking over an expired row.
   *
   * `1` exactly when the outcome is `expired-taken-over`: the failed controller's
   * record was superseded rather than left to expire a second time.
   */
  readonly staleLeasesReclaimed: number
}

/** Where the runtime's stores come from and how they are given back. */
export interface MyWorkRuntimeStorage {
  /** The open registry database (`registry.sqlite`), owned by the composition root. */
  readonly registry: MyWorkStore
  /** Open `controller.sqlite`; called once, after leadership is acquired. */
  openController(): Promise<MyWorkStore> | MyWorkStore
  /** Close both stores; called once, after the lease is no longer needed. */
  close(stores: ControllerStores<MyWorkStore>): void | Promise<void>
}

/** Options accepted by {@link createControllerRuntime}. */
export interface ControllerRuntimeOptions {
  /** Mode this deployment runs in and the external state directory it uses. */
  readonly deployment: MyWorkDeployment
  /**
   * The client layer of the deployment.
   *
   * It belongs to the deployment, not to a lease instance: a runtime that is
   * disposed and composed again sees the same attached clients. Defaults to a
   * fresh, empty layer.
   */
  readonly clients?: MyWorkClientSessions
  /** Time source of the lease, the heartbeat, and both traces. */
  readonly clock: ClockPort
  /** Installation scope this controller leads. */
  readonly scopeId: string
  /** This controller's instance id. */
  readonly instanceId: string
  /** Operating-system process id. */
  readonly processId: number
  /** How long one lease lasts; the heartbeat interval is derived from it. */
  readonly leaseMs: number
  /** The one registry-backed lease port of the composition root. */
  readonly leases: LeaseStorePort
  /** The registry store and the factory for the controller store of the root. */
  readonly storage: MyWorkRuntimeStorage
  /**
   * Reconcile incomplete work before the first admission (§16.1, §49).
   *
   * It receives the stores and what the acquisition observed, and returns the
   * report the lifecycle publishes. It is called exactly once per activation, on
   * the activating controller only: a passive one never reaches it.
   */
  readonly reconcile: (
    stores: ControllerStores<MyWorkStore>,
    leadership: ControllerLeadershipObservation,
  ) => ReconcileReport | Promise<ReconcileReport>
  /**
   * Whether a durable hold keeps admission closed after this activation.
   *
   * Read from the planner's `admission_hold` row, not from memory, so a
   * controller that was killed mid-operation comes back paused.
   */
  readonly admissionHold?: (stores: ControllerStores<MyWorkStore>) => boolean | Promise<boolean>
  /** Close every path that could admit work; the first shutdown step. */
  readonly closeAdmission?: () => void | Promise<void>
  /** Wait for the work already started; the second shutdown step. */
  readonly settle?: () => void | Promise<void>
  /** Release the non-lease subsystems; the lease itself is released here after it. */
  readonly release?: () => void | Promise<void>
  /** Renewal interval override; defaults to a third of `leaseMs`. */
  readonly heartbeatIntervalMs?: number
}

/** The leadership runtime of one deployment. */
export interface ControllerRuntime {
  /** Mode and external state directory of this deployment. */
  readonly deployment: MyWorkDeployment
  /** The client layer: attaching and detaching it never touches leadership. */
  readonly clients: MyWorkClientSessions
  /** Activation steps completed, in order; readable after `activate` settles. */
  readonly startupTrace: readonly ControllerStartupEntry[]
  /** Shutdown steps completed, in order; readable while `shutdown` is in flight. */
  readonly shutdownTrace: readonly MyWorkShutdownEntry[]
  /** The lifecycle this runtime leads through. */
  readonly lifecycle: ControllerLifecycle<MyWorkStore>
  /** The running heartbeat, once this controller is active. */
  readonly heartbeat: ControllerHeartbeat | undefined
  /** The stores, once the lifecycle opened them. */
  readonly stores: ControllerStores<MyWorkStore> | undefined
  /** Whether mutations may be admitted right now. */
  readonly admitting: boolean
  /** What the last acquisition decided; absent before `activate`. */
  readonly leadership: ControllerLeadershipObservation | undefined
  /** Snapshot of the lifecycle; safe at any point. */
  info(): ControllerLifecycleInfo
  /** Take leadership, open stores, reconcile, then admit; once per runtime. */
  activate(): Promise<ControllerLifecycleInfo>
  /** Open admission after the durable hold was released. */
  resumeAdmission(): Promise<ControllerLifecycleInfo>
  /** Register in-flight work the settle step must wait for. */
  trackWork(work: Promise<unknown>): void
  /** Close admission, settle, release; idempotent. */
  shutdown(): Promise<void>
}

/** Describe a thrown value without ever throwing. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Create the leadership runtime of one controller.
 *
 * Nothing durable happens here: the runtime acquires nothing until
 * {@link ControllerRuntime.activate} is called, so a composition that is
 * constructed and never started leaves no lease and no store behind.
 * @param options - deployment, clock, identity, storage, and the hooks above.
 * @returns the frozen runtime.
 * @throws {ControllerRuntimeError} `invalid-input` for a blank id or a non-positive window.
 */
export function createControllerRuntime(options: ControllerRuntimeOptions): ControllerRuntime {
  if (options.instanceId.trim().length === 0) {
    throw new ControllerRuntimeError('invalid-input', 'dsh-mywork: a controller instance id must be a non-empty string')
  }
  if (options.scopeId.trim().length === 0) {
    throw new ControllerRuntimeError('invalid-input', 'dsh-mywork: a lease scope id must be a non-empty string')
  }
  if (!Number.isInteger(options.leaseMs) || options.leaseMs <= 0) {
    throw new ControllerRuntimeError(
      'invalid-input',
      `dsh-mywork: leaseMs must be a positive integer, received ${String(options.leaseMs)}`,
      { details: { leaseMs: options.leaseMs } },
    )
  }

  const leasePort = options.leases
  const holdHook = options.admissionHold
  const clients = options.clients ?? createClientSessions()
  const startup: ControllerStartupEntry[] = []
  const inFlight = new Set<Promise<unknown>>()
  let epoch: ControllerEpoch | undefined
  let leadership: ControllerLeadershipObservation | undefined
  let admissionOpen = false
  let heldByAdmission = false
  let heartbeat: ControllerHeartbeat | undefined
  let stores: ControllerStores<MyWorkStore> | undefined
  let activated = false
  let shuttingDown = false

  /** Whether this instance still holds the scope row, read from durable state. */
  function holdsLease(): boolean {
    if (epoch === undefined) return false
    try {
      return leasePort.holdsLeadership(options.scopeId, options.instanceId, epoch, options.clock.now())
    } catch {
      // A closed store is not leadership, and a probe must never throw inside a
      // shutdown step that is already unwinding.
      return false
    }
  }

  /** Record one activation step with the state that held when it completed. */
  function record(step: ControllerStartupStepName, leaseHeld: boolean = holdsLease()): void {
    startup.push(Object.freeze({
      step,
      at: options.clock.now(),
      leaseHeld,
      admitting: admissionOpen,
      admissionHeld: heldByAdmission,
      ...(epoch === undefined ? {} : { epoch }),
    }))
  }

  /**
   * The lease port the lifecycle writes through: the same port the root handed
   * in, with the acquisition recorded, so the traces and the reconciliation
   * report can name what happened without a second source of truth.
   */
  const delegate: LeaseStorePort = Object.freeze({
    acquire(request: ControllerAcquireRequest): ControllerLeaseResult {
      const result = leasePort.acquire(request)
      const held = result.outcome !== 'held-by-other' && result.lease !== undefined
      // A refused claimant is shown the holder's row; quoting its epoch back as
      // this controller's own would poison every later leadership probe.
      epoch = held ? result.lease?.epoch : undefined
      leadership = Object.freeze({
        outcome: result.outcome,
        ...(held && result.lease !== undefined ? { epoch: result.lease.epoch } : {}),
        staleLeasesReclaimed: result.outcome === 'expired-taken-over' ? 1 : 0,
      })
      record('lease', held)
      return result
    },
    heartbeat: (request: ControllerAcquireRequest): ControllerLeaseResult => leasePort.heartbeat(request),
    read: (scopeId: string): ControllerLease | undefined => leasePort.read(scopeId),
    release: (request: ControllerReleaseRequest): boolean => {
      const released = leasePort.release(request)
      if (released && request.epoch === epoch) epoch = undefined
      return released
    },
    holdsLeadership: (scopeId: string, instanceId: string, atEpoch: ControllerEpoch, at: EpochMs): boolean =>
      leasePort.holdsLeadership(scopeId, instanceId, atEpoch, at),
  })

  const lifecycle = new ControllerLifecycle<MyWorkStore>({
    scopeId: options.scopeId,
    instanceId: options.instanceId,
    processId: options.processId,
    clock: options.clock,
    leaseMs: options.leaseMs,
    leases: delegate,
    openStores: async (): Promise<ControllerStores<MyWorkStore>> => {
      const controller = await options.storage.openController()
      stores = Object.freeze({ registry: options.storage.registry, controller })
      record('stores')
      return stores
    },
    reconcile: async (opened: ControllerStores<MyWorkStore>): Promise<ReconcileReport> => {
      const observation = leadership ?? Object.freeze({
        outcome: 'acquired' as const,
        staleLeasesReclaimed: 0,
      })
      const report = await options.reconcile(opened, observation)
      record('reconcile')
      return report
    },
    closeStores: async (opened: ControllerStores<MyWorkStore>): Promise<void> => {
      await options.storage.close(opened)
      stores = undefined
    },
    ...(holdHook === undefined
      ? {}
      : {
          admissionHold: async (opened: ControllerStores<MyWorkStore>): Promise<boolean> => {
            heldByAdmission = await holdHook(opened)
            return heldByAdmission
          },
        }),
  })

  const shutdown = createGracefulShutdown({
    clock: options.clock,
    probe: () => ({ admitting: admissionOpen, leaseHeld: holdsLease() }),
    steps: Object.freeze({
      admission: async (): Promise<void> => {
        admissionOpen = false
        await heartbeat?.stop()
        heartbeat = undefined
        await options.closeAdmission?.()
      },
      settle: async (): Promise<void> => {
        // The snapshot is taken inside the step, so work registered before the
        // shutdown began cannot be missed; `trackWork` refuses anything later.
        await Promise.allSettled([...inFlight])
        await options.settle?.()
      },
      release: async (): Promise<void> => {
        await options.release?.()
        // The row is given up here, while the registry is still open.
        //
        // `ControllerLifecycle.dispose` closes the stores **before** it releases
        // (`packages/lease/src/lifecycle.ts:308-323`) and it swallows a failed
        // release, because a controller whose registry is already gone must still
        // finish disposing. In this composition the lease lives in that registry,
        // so that order would leave the row behind and hand a successor a scope
        // that is only nominally held until it expires — so the release happens
        // first and the disposal's own attempt becomes the harmless no-op. The
        // probes of the shutdown trace read the durable row, which is why this
        // ordering is testable rather than a comment.
        if (epoch !== undefined) {
          try {
            delegate.release({ scopeId: options.scopeId, instanceId: options.instanceId, epoch })
          } catch {
            // A release that cannot be written is not a reason to stop unwinding:
            // the lease expires on its own, which is the §49 recovery path.
          }
          epoch = undefined
        }
        await lifecycle.dispose()
        stores = undefined
      },
    }),
  })

  return Object.freeze({
    deployment: options.deployment,
    clients,
    lifecycle,
    get startupTrace(): readonly ControllerStartupEntry[] {
      return Object.freeze([...startup])
    },
    get shutdownTrace(): readonly MyWorkShutdownEntry[] {
      return shutdown.trace
    },
    get heartbeat(): ControllerHeartbeat | undefined {
      return heartbeat
    },
    get stores(): ControllerStores<MyWorkStore> | undefined {
      return stores
    },
    get admitting(): boolean {
      return admissionOpen
    },
    get leadership(): ControllerLeadershipObservation | undefined {
      return leadership
    },

    info(): ControllerLifecycleInfo {
      return lifecycle.info()
    },

    async activate(): Promise<ControllerLifecycleInfo> {
      if (activated) {
        throw new ControllerRuntimeError('invalid-input', 'dsh-mywork: this controller runtime was already activated')
      }
      activated = true
      const info = await lifecycle.activate()
      admissionOpen = info.admitting
      record('admission')
      if (info.phase === 'active') {
        heartbeat = startControllerHeartbeat({
          lifecycle: { heartbeat: () => lifecycle.heartbeat() },
          clock: options.clock,
          leaseMs: options.leaseMs,
          ...(options.heartbeatIntervalMs === undefined ? {} : { intervalMs: options.heartbeatIntervalMs }),
          onLost: () => {
            // The lifecycle closed admission and moved to `passive` before the
            // throw reached the loop; mirroring it here keeps this runtime's own
            // gate honest for callers of `admitting`.
            admissionOpen = false
          },
        })
      }
      return info
    },

    async resumeAdmission(): Promise<ControllerLifecycleInfo> {
      const info = lifecycle.info()
      if (info.phase !== 'active') {
        throw new ControllerRuntimeError(
          'not-active',
          `dsh-mywork: controller "${options.instanceId}" is in phase "${info.phase}", so admission cannot be resumed`,
          { details: { phase: info.phase } },
        )
      }
      if (stores !== undefined && holdHook !== undefined) {
        // The row is the truth, not the flag the activation set: an operation may
        // have taken a second pause while this controller was running.
        if (await holdHook(stores)) {
          throw new ControllerRuntimeError(
            'hold-still-open',
            'dsh-mywork: a durable admission hold still stands, so admission may not be resumed yet',
          )
        }
      }
      heldByAdmission = false
      const resumed = lifecycle.resumeAdmission()
      admissionOpen = resumed.admitting
      return resumed
    },

    trackWork(work: Promise<unknown>): void {
      if (shuttingDown) {
        throw new ControllerRuntimeError(
          'shutting-down',
          'dsh-mywork: the controller is shutting down, so no new work may be registered',
        )
      }
      inFlight.add(work)
      const forget = (): void => {
        inFlight.delete(work)
      }
      work.then(forget, forget)
    },

    async shutdown(): Promise<void> {
      shuttingDown = true
      try {
        await shutdown.run()
      } catch (error) {
        throw new ControllerRuntimeError(
          'not-active',
          `dsh-mywork: the shutdown of "${options.instanceId}" failed: ${describe(error)}`,
          { cause: error, details: { scopeId: options.scopeId, instanceId: options.instanceId } },
        )
      }
    },
  })
}
