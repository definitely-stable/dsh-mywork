/**
 * The composition root of MyWork (F-28…F-31, MW-058, D07; leadership in MW-028).
 *
 * One object owns the runtime: it resolves the layout, opens the registry, hands
 * the leadership runtime the one lease port and the one factory for
 * `controller.sqlite`, and — **only once this controller is the leader** — brings
 * the subsystems up, publishes the ports it owns into the adapter registry, and
 * takes everything down again in the reverse order. There is deliberately no
 * second root: any code that needs a store, a saga, or the scheduler receives it
 * from here.
 *
 * Order is not cosmetic. The registry is opened first because it is both the
 * migration allocator's book and the home of the lease row; leadership is
 * acquired before `controller.sqlite` is opened, so a passive controller never
 * opens a database it may not write to and never hands out a planner that would
 * mutate a scope it does not lead. The lifecycle then reconciles *before* it
 * admits anything, and a durable admission hold keeps the gate closed until the
 * operation that took it settles. Shutdown mirrors that: close admission, settle
 * the work already started, and only then release the lease.
 *
 * The task graph is **not** owned here: the backend row (for example
 * `@dsh-mywork/beads-adapter`) registers itself in `myworkAdapters`, and this
 * root resolves it through the registry on every call. A deployment without a
 * task graph still mounts — the first call that needs one reports
 * `ADAPTER_UNAVAILABLE` instead of failing the composition.
 * @module
 */

import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'

import {
  adapterUnavailable,
  portContractVersion,
  type AdapterRegistrationHandle,
  type MyWorkAdapters,
} from '@dsh-mywork/adapter-sdk'
import { type ClockPort, type TaskGraphPort } from '@dsh-mywork/contracts'
import { systemClock } from '@dsh-mywork/core'
import {
  EVIDENCE_MIGRATIONS,
  createArtifactRetentionMigration,
  createArtifactStore,
  createAuditLog,
  type ArtifactStore,
  type AuditLog,
} from '@dsh-mywork/evidence'
import {
  CLAIM_SAGA_MIGRATIONS,
  REVIEW_CLAIM_ALLOCATION_KEY,
  REVIEW_CLAIM_SCHEMA_NAME,
  createClaimSaga,
  createReviewClaimMigration,
  createReviewQueue,
  type ClaimSaga,
  type ReviewQueue,
} from '@dsh-mywork/execution'
import {
  LEASE_MIGRATIONS,
  createLeaseStore,
  type ControllerLifecycle,
  type ControllerLifecycleInfo,
  type ControllerStores,
} from '@dsh-mywork/lease'
import {
  PLAN_MUTATION_MIGRATIONS,
  createPlanStore,
  createPlanner,
  type AdmissionHold,
  type PlanStore,
  type Planner,
} from '@dsh-mywork/planner'
import {
  createScheduler,
  type Scheduler,
  type SchedulerAdmitPort,
} from '@dsh-mywork/scheduler'
import {
  MYWORK_MIGRATIONS,
  canonicalMigrations,
  createBackgroundJobMigration,
  openStore,
  readMigrationJournal,
  resolveMyWorkLayout,
  stateDatabasePath,
  type AppliedMigration,
  type Migration,
  type MyWorkLayout,
  type MyWorkStore,
} from '@dsh-mywork/storage'
import { createBudgetMeter, type BudgetMeter, type TokenMeterPort } from './budget-meter.ts'
import { createCatalogObservation, type CatalogObservation } from './catalog-observation.ts'
import {
  createClientSessions,
  resolveMyWorkDeployment,
  type MyWorkClientSessions,
  type MyWorkDeployment,
  type MyWorkDeploymentMode,
  type MyWorkShutdownEntry,
} from './deployment.ts'
import { ControllerRuntimeError } from './errors.ts'
import {
  createSchedulerStateProjection,
  type SchedulerStateProjectionSources,
} from './scheduler-state.ts'
import { createReviewSchedulerSource } from './review-scheduler-source.ts'
import type { ControllerHeartbeat } from './heartbeat.ts'
import { createMigrationAllocator, type AllocationAdoption, type MigrationAllocator } from './migration-allocator.ts'
import {
  createControllerRuntime,
  type ControllerRuntime,
  type ControllerStartupEntry,
} from './runtime-root.ts'

/**
 * The schema every database starts from, in the canonical order.
 *
 * `openStore` refuses a list whose versions do not strictly increase, and the
 * order below is the one the layers were written against: kernel v1, evidence
 * v2–v3, lease v4, plan mutations v5, claim saga v6. Versions are never typed by
 * hand — every number comes from the package that owns the migration, and the
 * migrations that land **after** this list ask {@link MigrationAllocator} for
 * their number (F-63).
 */
export const MYWORK_DATABASE_MIGRATIONS = canonicalMigrations([
  MYWORK_MIGRATIONS,
  EVIDENCE_MIGRATIONS,
  LEASE_MIGRATIONS,
  PLAN_MUTATION_MIGRATIONS,
  CLAIM_SAGA_MIGRATIONS,
])

/**
 * Schema that exists as a factory and therefore needs a number from the
 * allocator: the key is the request's stable identity, never a version.
 *
 * `journalName` is the label the migration writes into `schema_migrations`. It
 * is spelled out rather than derived from `key`, because the recovery below
 * reads that label back and a naming convention that drifts (`background_job`
 * against `background-job`) would silently stop matching (F-63b).
 */
const ALLOCATED_MIGRATIONS: readonly {
  readonly key: string
  readonly journalName: string
  readonly create: (version: number) => Migration
}[] = Object.freeze([
  Object.freeze({ key: 'background_job', journalName: 'background-job', create: createBackgroundJobMigration }),
  Object.freeze({ key: 'artifact-retention', journalName: 'artifact-retention', create: createArtifactRetentionMigration }),
  Object.freeze({
    key: REVIEW_CLAIM_ALLOCATION_KEY,
    journalName: REVIEW_CLAIM_SCHEMA_NAME,
    create: version => createReviewClaimMigration({ version }),
  }),
])

/**
 * The versions one numbered database already recorded, as allocator adoptions.
 *
 * The allocator's book is `registry.sqlite` and the numbers land in the journal
 * of `controller.sqlite`, so the book can be lost while the record survives. A
 * key whose journal row is absent is simply not adopted: no other build numbered
 * it in this database.
 * @param journal - rows of the target database's `schema_migrations`.
 * @returns one adoption per allocated migration that journal already records.
 */
export function adoptedAllocations(journal: readonly AppliedMigration[]): readonly AllocationAdoption[] {
  const byJournalName = new Map(ALLOCATED_MIGRATIONS.map(request => [request.journalName, request.key]))
  return Object.freeze(journal.flatMap(row => {
    const key = byJournalName.get(row.name)
    return key === undefined ? [] : [Object.freeze({ key, version: row.version })]
  }))
}

/**
 * The whole schema of a database: the base list plus every migration the
 * allocator hands out, in allocation order.
 *
 * Allocation is idempotent per request, so asking twice for the same database
 * reproduces the same list — which is what makes a restart safe.
 * @param allocator - the version allocator of the database being opened.
 * @returns the canonical list, validated for strictly increasing versions.
 */
export function myworkDatabaseMigrations(allocator: MigrationAllocator): readonly Migration[] {
  return canonicalMigrations([
    MYWORK_DATABASE_MIGRATIONS,
    ALLOCATED_MIGRATIONS.map(request => request.create(allocator.allocate({ key: request.key }))),
  ])
}

/** Names of the subsystems the application brings up, in dependency order. */
export type MyWorkSubsystemName = 'evidence' | 'lease' | 'planner' | 'execution' | 'scheduler'

/**
 * The order the subsystems are reported in and stopped in reverse.
 *
 * It is the dependency order, not the order of the calls that happen to create
 * them: the scheduler decides work, so it stops first; the planner and the saga
 * write through the stores, so they stop before the lease closes them; and the
 * evidence stores read the same database, so their (empty) disposal is last.
 */
const MY_WORK_SUBSYSTEM_ORDER: readonly MyWorkSubsystemName[] = Object.freeze([
  'evidence',
  'lease',
  'planner',
  'execution',
  'scheduler',
])

/** One subsystem the application owns and stops in reverse order. */
export interface MyWorkSubsystem {
  /** Which subsystem this is. */
  readonly name: MyWorkSubsystemName
  /** Release it; called once, in reverse order of {@link MY_WORK_SUBSYSTEM_ORDER}. */
  readonly dispose: () => void | Promise<void>
}

/** Options accepted by {@link createMyWorkApplication}. */
export interface MyWorkApplicationOptions {
  /** Time source for every subsystem. Defaults to the system clock (D11). */
  readonly clock?: ClockPort
  /** Resolved layout; wins over {@link MyWorkApplicationOptions.dshHome}. */
  readonly layout?: MyWorkLayout
  /** `$DSH_HOME` to resolve the layout from; tests pass a temporary directory. */
  readonly dshHome?: string
  /** The adapter registry the task graph is resolved from. */
  readonly adapters?: MyWorkAdapters<undefined>
  /** Write lifecycle lines to stderr. Default false. */
  readonly diagnostics?: boolean
  /** Installation scope this controller leads. Defaults to `local`. */
  readonly scopeId?: string
  /** This controller's instance id. Defaults to `<host>:<pid>`. */
  readonly instanceId?: string
  /** Operating-system process id. Defaults to `process.pid`. */
  readonly processId?: number
  /** How long one controller lease lasts. Defaults to 15 seconds. */
  readonly leaseMs?: number
  /**
   * How this deployment runs: `embedded` inside the host process, or `resident`
   * as a headless profile (MW-028 E-44). Defaults to `embedded`.
   *
   * The mode changes what the deployment promises (whether unloading the host row
   * stops it), never where the state lives: both modes use the external state
   * directory the layout resolves.
   */
  readonly mode?: MyWorkDeploymentMode
  /**
   * Lease renewal interval; defaults to a third of {@link MyWorkApplicationOptions.leaseMs}.
   *
   * Must stay strictly below the lease window — a renewal that does not fit
   * inside it would let the lease expire under a live controller.
   */
  readonly heartbeatIntervalMs?: number
  /**
   * The platform token meter (§53, D05, F-51). Optional, because a profile
   * without the `tokenMeter` service still composes — and then no live session
   * can be measured, which this root reports through
   * {@link MyWorkApplication.budgetMeter} instead of replacing the meter with a
   * counter of its own.
   */
  readonly tokenMeter?: TokenMeterPort
  /**
   * Authoritative runtime sources for the scheduler projection.
   *
   * Omitted sources are not treated as empty: the projection refuses read()
   * until their owning runtime slices are composed. This keeps an unarmed
   * controller constructible without turning missing state into false zeroes.
   */
  readonly schedulerStateSources?: Partial<SchedulerStateProjectionSources>
}

/**
 * The application the controller row mounts.
 *
 * Every getter that reads the database is `undefined` until {@link MyWorkApplication.start}
 * has run — and stays `undefined` on a passive controller, which never opens
 * `controller.sqlite` at all. That is what lets a caller tell "not composed yet"
 * from "composed and passive" from "composed and leading".
 */
export interface MyWorkApplication {
  /** Layout the databases are resolved from; available before `start()`. */
  readonly layout: MyWorkLayout
  /** Mode and external state directory of this deployment; available before `start()`. */
  readonly deployment: MyWorkDeployment
  /** The client layer: a closed tab detaches, it never stops the controller. */
  readonly clients: MyWorkClientSessions
  /** `controller.sqlite`, open once this controller is the leader. */
  readonly store: MyWorkStore | undefined
  /** `registry.sqlite`, open once `start()` resolved. */
  readonly registry: MyWorkStore | undefined
  /** Version allocator of the controller database (F-63). */
  readonly migrations: MigrationAllocator | undefined
  /** Controller lease and lifecycle; defined as soon as `start()` began. */
  readonly lease: ControllerLifecycle<MyWorkStore> | undefined
  /** Evidence stores of `controller.sqlite`. */
  readonly evidence: { readonly artifacts: ArtifactStore; readonly audit: AuditLog } | undefined
  /** The plan mutator. */
  readonly planner: Planner | undefined
  /** The §9 claim saga. */
  readonly saga: ClaimSaga | undefined
  /** Durable review queue over controller.sqlite. */
  readonly reviewQueue: ReviewQueue | undefined
  /** The §16 scheduler runtime; constructed here, armed by its owner. */
  readonly scheduler: Scheduler | undefined
  /** Last-observed model catalog; refresh performs I/O, read is snapshot-only. */
  readonly catalog: CatalogObservation
  /**
   * The §53 charge bridge over the injected token meter (F-51, D05).
   *
   * `undefined` when the deployment mounted no `tokenMeter`: every token number
   * MyWork charges has to come from a real measurement, so an absent meter is
   * reported rather than papered over with a number this root would have to
   * invent. Every reading it returns comes from `measure()` on that call.
   */
  readonly budgetMeter: BudgetMeter | undefined
  /** The lease heartbeat of an active controller; absent while passive. */
  readonly heartbeat: ControllerHeartbeat | undefined
  /** Whether mutations may be admitted right now. */
  readonly admitting: boolean
  /** The open admission hold that keeps the gate closed, when there is one. */
  readonly admissionHold: AdmissionHold | undefined
  /** Activation steps completed, in order: `lease → stores → reconcile → admission`. */
  readonly startupTrace: readonly ControllerStartupEntry[]
  /** Shutdown steps completed, in order: `admission → settle → release`. */
  readonly shutdownTrace: readonly MyWorkShutdownEntry[]
  /** Subsystems brought up, in the dependency order the shutdown reverses. */
  readonly services: readonly MyWorkSubsystem[]
  /** Admissions a tick decided, in order; the sink until the claim path owns it. */
  readonly admissions: readonly unknown[]
  /** Bring everything up; idempotent. */
  start(): Promise<void>
  /** Take everything down; idempotent and safe to call twice. */
  stop(): Promise<void>
  /** Register in-flight work the shutdown must wait for. */
  trackWork(work: Promise<unknown>): void
  /** Open admission after the durable hold was released. */
  resumeAdmission(): Promise<ControllerLifecycleInfo>
}

/**
 * Create the application of one controller row.
 * @param options - clock, layout, adapter registry, mode, and identity.
 * @returns the application; nothing is opened until {@link MyWorkApplication.start}.
 * @throws {ControllerRuntimeError} `invalid-input` when the deployment mode is unknown.
 */
export function createMyWorkApplication(options: MyWorkApplicationOptions = {}): MyWorkApplication {
  const clock = options.clock ?? systemClock
  const layout = options.layout ?? resolveMyWorkLayout(options.dshHome === undefined ? {} : { dshHome: options.dshHome })
  const deployment = resolveMyWorkDeployment({
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    layout,
  })
  // One client layer per deployment, created at composition time: a client is
  // attached to the deployment, not to the lease instance that happens to lead
  // it, so closing a tab cannot end a controller's life (E-44).
  const clients = createClientSessions()
  const adapters = options.adapters
  const scopeId = options.scopeId ?? 'local'
  const instanceId = options.instanceId ?? `${hostname()}:${String(options.processId ?? process.pid)}`
  const processId = options.processId ?? process.pid
  const leaseMs = options.leaseMs ?? 15_000
  const diagnostics = options.diagnostics ?? false
  // Built once, at composition time: the bridge is stateless, so binding it here
  // costs nothing and lets a caller tell "no meter was mounted" from "a meter is
  // mounted and the reading is zero".
  const budgetMeter = options.tokenMeter === undefined ? undefined : createBudgetMeter(options.tokenMeter)
  const catalog = createCatalogObservation(adapters)

  let started = false
  let controller: MyWorkStore | undefined
  let registry: MyWorkStore | undefined
  let allocator: MigrationAllocator | undefined
  let runtime: ControllerRuntime | undefined
  let artifacts: ArtifactStore | undefined
  let audit: AuditLog | undefined
  let planner: Planner | undefined
  let saga: ClaimSaga | undefined
  let reviewQueue: ReviewQueue | undefined
  let scheduler: Scheduler | undefined
  let planStore: PlanStore | undefined
  let handles: readonly AdapterRegistrationHandle<unknown>[] = []
  let startupTrace: readonly ControllerStartupEntry[] = []
  let shutdownTrace: readonly MyWorkShutdownEntry[] = []
  let openHold: AdmissionHold | undefined
  /**
   * Whether the lifecycle took the opened stores over.
   *
   * It is what decides who closes them: the lifecycle does, from its own
   * disposal, once `openStores` returned; before that a failed start still owns
   * the handles it opened and has to close them itself.
   */
  let storesHandedOver = false
  let teardown: Promise<void> | undefined
  const up = new Map<MyWorkSubsystemName, MyWorkSubsystem>()
  const admissions: unknown[] = []

  /**
   * The task graph, resolved through the registry on every call.
   *
   * The port is a forwarding proxy rather than a captured instance because the
   * backend row may mount after this root does (and may be replaced): capturing
   * one would freeze whichever adapter happened to be registered first.
   */
  const graph: TaskGraphPort = new Proxy({} as TaskGraphPort, {
    get(_target, property) {
      return async (...args: unknown[]): Promise<unknown> => {
        if (adapters === undefined) {
          throw adapterUnavailable(
            'dsh-mywork: no adapter registry is mounted, so no task graph can be resolved',
          )
        }
        const adapter = adapters.require<TaskGraphPort>('taskgraph')
        const member = (adapter as unknown as Record<string, unknown>)[String(property)]
        if (typeof member !== 'function') {
          throw adapterUnavailable(
            `dsh-mywork: the registered task graph does not implement "${String(property)}"`,
          )
        }
        return await (member as (...inner: unknown[]) => unknown).apply(adapter, args)
      }
    },
  })

  /**
   * The state a tick decides against.
   *
   * This is a real projection boundary rather than a literal empty observation.
   * Task readiness is re-read from its owning TaskGraph port, while model
   * availability comes only from the last completed CatalogObservation. The
   * remaining runtime sources fail closed until their slices compose them. The
   * scheduler stays unarmed here, so an incomplete deployment is observable
   * without producing a background failure loop.
   */
  const reviewSource = createReviewSchedulerSource(() => reviewQueue)
  const schedulerSources: Partial<SchedulerStateProjectionSources> = Object.freeze({
    ...options.schedulerStateSources,
    reviews: options.schedulerStateSources?.reviews ?? reviewSource,
  })
  const state = createSchedulerStateProjection({
    graph,
    catalog,
    sources: schedulerSources,
  })

  /**
   * The sink for admissions.
   *
   * A decision is recorded rather than dropped: handing it to the §9 saga needs
   * an `OperationMeta` the scheduler does not carry, and that routing is the
   * claim path's own card. Recording keeps the decision observable in the
   * meantime, and the scheduler is not armed by this root (see `start`).
   */
  const admit: SchedulerAdmitPort = {
    admit: (admission) => {
      admissions.push(admission)
      if (diagnostics) {
        process.stderr.write(`dsh-mywork: scheduler admitted ${JSON.stringify(admission)}\n`)
      }
    },
  }

  /** Publish the ports this root owns; the task graph row publishes itself. */
  function publish(): void {
    const leases = registry ?? controller
    if (adapters === undefined || artifacts === undefined || leases === undefined) return
    const published: AdapterRegistrationHandle<unknown>[] = [
      adapters.register({
        kind: 'artifact-store',
        id: 'mywork-evidence',
        contractVersion: portContractVersion('artifact-store'),
        capabilities: Object.freeze({}),
        create: () => artifacts,
      }),
      adapters.register({
        kind: 'lease-store',
        id: 'mywork-lease',
        contractVersion: portContractVersion('lease-store'),
        capabilities: Object.freeze({}),
        create: () => createLeaseStore(leases),
      }),
    ]
    handles = Object.freeze(published)
  }

  /**
   * The plan façade of the open controller database.
   *
   * It is created on first use rather than at store-open time, because the two
   * hooks that read it — reconciliation and the admission hold — are exactly the
   * two places a controller must not guess: a database whose plan journal survived
   * while its tables did not has to fail *there*, before any work is admitted.
   * @throws {ControllerRuntimeError} `not-active` when no controller store is open.
   */
  function plans(): PlanStore {
    if (controller === undefined) {
      throw new ControllerRuntimeError(
        'not-active',
        'dsh-mywork: the plan tables are only reachable while this controller holds the controller database',
      )
    }
    planStore ??= createPlanStore(controller)
    return planStore
  }

  /** Close a store without letting a second close mask the original failure. */
  function closeQuietly(store: MyWorkStore | undefined): void {
    if (store === undefined) return
    try {
      store.close()
    } catch {
      // Already closed — by the lifecycle, or by an earlier unwind.
    }
  }

  /** One subsystem entry, so the map keeps the name literal of its key. */
  function subsystem(name: MyWorkSubsystemName, dispose: () => void | Promise<void>): MyWorkSubsystem {
    return Object.freeze({ name, dispose })
  }

  /** Snapshot both traces, so they survive the runtime they came from. */
  function captureTraces(): void {
    if (runtime === undefined) return
    startupTrace = runtime.startupTrace
    shutdownTrace = runtime.shutdownTrace
  }

  /** Forget everything this root opened, so a later `start()` composes afresh. */
  function clearComposition(): void {
    handles = []
    up.clear()
    controller = undefined
    registry = undefined
    allocator = undefined
    runtime = undefined
    artifacts = undefined
    audit = undefined
    planner = undefined
    saga = undefined
    reviewQueue = undefined
    scheduler = undefined
    planStore = undefined
    storesHandedOver = false
    openHold = undefined
  }

  /**
   * One shutdown, used by both `stop()` and a failed `start()`.
   *
   * The runtime runs the three ordered steps; what is left here is the half it
   * cannot see: a start that failed *before* the lifecycle owned the stores has
   * to close the handles it opened, or the next attempt finds the files locked.
   */
  async function unwind(): Promise<void> {
    const active = runtime
    if (active !== undefined) {
      try {
        await active.shutdown()
      } finally {
        // Captured even when a step failed: the trace says how far the shutdown
        // got, which is exactly what an operator needs to see.
        startupTrace = active.startupTrace
        shutdownTrace = active.shutdownTrace
      }
    }
    if (!storesHandedOver) {
      closeQuietly(controller)
      closeQuietly(registry)
    }
    clearComposition()
  }

  /**
   * The one shutdown of this application.
   *
   * Memoised rather than flagged: a caller that arrives while the settle step is
   * still waiting must wait for the same shutdown, not be told "already stopped"
   * while a database handle is still open.
   */
  function shutdownOnce(): Promise<void> {
    teardown ??= unwind().finally(() => {
      teardown = undefined
    })
    return teardown
  }

  return {
    layout,
    deployment,
    clients,
    get store() {
      return controller
    },
    get registry() {
      return registry
    },
    get migrations() {
      return allocator
    },
    get lease(): ControllerLifecycle<MyWorkStore> | undefined {
      return runtime?.lifecycle
    },
    get evidence() {
      return artifacts === undefined || audit === undefined
        ? undefined
        : { artifacts, audit }
    },
    get planner() {
      return planner
    },
    get saga() {
      return saga
    },
    get reviewQueue() {
      return reviewQueue
    },
    get scheduler() {
      return scheduler
    },
    catalog,
    get budgetMeter() {
      return budgetMeter
    },
    get heartbeat() {
      return runtime?.heartbeat
    },
    get admitting() {
      return runtime?.admitting ?? false
    },
    get admissionHold() {
      return openHold
    },
    get startupTrace() {
      // The live trace while a runtime exists, the last snapshot after it: a
      // caller observing an activation or a shutdown in flight must see the steps
      // that already completed, not the empty field `stop()` will fill in later.
      return runtime?.startupTrace ?? startupTrace
    },
    get shutdownTrace() {
      return runtime?.shutdownTrace ?? shutdownTrace
    },
    get services() {
      return Object.freeze(MY_WORK_SUBSYSTEM_ORDER.flatMap(name => {
        const service = up.get(name)
        return service === undefined ? [] : [service]
      }))
    },
    get admissions() {
      return Object.freeze([...admissions])
    },

    async start(): Promise<void> {
      if (started) return
      started = true
      try {
        // The state directory is the one thing the layout does not create: a fresh
        // $DSH_HOME has no dsh-mywork tree at all.
        mkdirSync(layout.stateDir, { recursive: true })
        registry = await openStore({
          path: stateDatabasePath(layout, 'registry'),
          migrations: MYWORK_DATABASE_MIGRATIONS,
        })
        // The registry is the allocator's book of record: it is opened first, so a
        // migration that exists as a factory receives its number **before** the
        // database it lands in is opened. The numbers are therefore decided once,
        // and the controller database opens straight onto its final schema.
        //
        // The book is not the only record, though: the numbers it hands out are
        // written into the controller's journal, which survives the book (F-63b).
        // Reading that journal first means a lost book *adopts* the versions the
        // controller already recorded instead of renumbering migrations onto them
        // — a renumbering the journal check cannot see, because it compares
        // versions and not names, so it would end with a schema change that never
        // runs while the stamp says it did.
        const controllerPath = stateDatabasePath(layout, 'controller')
        allocator = createMigrationAllocator(registry, {
          now: () => clock.now(),
          adopt: adoptedAllocations(readMigrationJournal(controllerPath)),
        })
        const book = allocator

        runtime = createControllerRuntime({
          deployment,
          clients,
          clock,
          scopeId,
          instanceId,
          processId,
          leaseMs,
          leases: createLeaseStore(registry),
          storage: {
            registry,
            // Leadership is already held when this runs: the lifecycle calls it
            // from inside `activate`, after its own acquisition.
            openController: async (): Promise<MyWorkStore> => {
              controller = await openStore({
                path: controllerPath,
                migrations: myworkDatabaseMigrations(book),
              })
              storesHandedOver = true
              artifacts = createArtifactStore(controller, clock)
              audit = createAuditLog(controller)
              planner = createPlanner({ store: controller, graph, clock })
              saga = createClaimSaga({ store: controller, graph, clock })
              const reviewMigration = createReviewClaimMigration({
                version: book.allocate({ key: REVIEW_CLAIM_ALLOCATION_KEY }),
              })
              reviewQueue = createReviewQueue({
                store: controller,
                graph,
                clock,
                migration: reviewMigration,
              })
              up.set('evidence', subsystem('evidence', () => undefined))
              return controller
            },
            close: (stores: ControllerStores<MyWorkStore>): void => {
              closeQuietly(stores.controller)
              closeQuietly(stores.registry)
            },
          },
          // §16.1: the state is reconciled before the first admission, never
          // after. What this step can repair today is the lease row the
          // acquisition already superseded; the incomplete operations of the
          // plan, the claim saga, and the attempts are reported here and settled
          // by the recovery group (MW-031), which owns the §49 scenarios.
          reconcile: (stores: ControllerStores<MyWorkStore>, leadership) => {
            const pendingOperations = plans().pending().length
            const openClaims = saga?.openIntents().length ?? 0
            if (diagnostics) {
              process.stderr.write(
                `dsh-mywork: reconciled ${stores.controller.path}: ${String(pendingOperations)} staged operation(s), `
                + `${String(openClaims)} open claim(s), ${String(leadership.staleLeasesReclaimed)} stale lease(s)\n`,
              )
            }
            return Object.freeze({
              operations: pendingOperations + openClaims,
              leases: leadership.staleLeasesReclaimed,
            })
          },
          // ADR020: a staged plan mutation that has not settled keeps the gate
          // closed, and the row — not a flag — is what says so. The hold is read
          // through the plan store's own façade; the installation is consulted as
          // a whole, because this controller has exactly one admission gate.
          admissionHold: () => {
            openHold = plans().openHold()
            return openHold !== undefined
          },
          // Shutdown step one: nothing may resolve a port this root is about to
          // take down. The durable gate is closed by the lease disposal in step
          // three, which is why the work started meanwhile is awaited in between.
          closeAdmission: () => {
            for (const handle of handles) handle.unregister()
            handles = []
          },
          // Shutdown step two: the scheduler's own stop waits for the tick that is
          // running and for every tick already queued behind it.
          settle: async () => {
            await scheduler?.stop()
          },
          // Shutdown step three, before the runtime releases the lease: the
          // subsystems stop in reverse dependency order.
          release: async () => {
            for (const name of [...MY_WORK_SUBSYSTEM_ORDER].reverse()) {
              if (name === 'lease') continue
              await up.get(name)?.dispose()
            }
          },
          ...(options.heartbeatIntervalMs === undefined
            ? {}
            : { heartbeatIntervalMs: options.heartbeatIntervalMs }),
        })
        // The lease is released by the runtime's own release step, after this
        // root's subsystems stopped. Registering the same idempotent call here
        // keeps one owner per subsystem in the list the host observes.
        const leaseRuntime = runtime
        up.set('lease', subsystem('lease', () => leaseRuntime.lifecycle.dispose()))

        const info = await runtime.activate()
        if (info.phase === 'active') {
          scheduler = createScheduler({ state, admit, clock })
          up.set('planner', subsystem('planner', () => undefined))
          up.set('execution', subsystem('execution', () => undefined))
          // Constructed and reachable, not armed: arming a timer that decides over
          // an empty observation would be noise. Its owner starts it.
          const schedulerRuntime = scheduler
          up.set('scheduler', subsystem('scheduler', () => schedulerRuntime.stop()))
          publish()
        }
      } catch (error) {
        // A start that failed halfway must not leave a lease, a store handle, or
        // a half-composed subsystem behind: the next attempt is a fresh one. The
        // traces are captured first, because they are the evidence of how far the
        // activation got before it failed.
        started = false
        captureTraces()
        try {
          await shutdownOnce()
        } catch {
          // The activation failure is the one to report; a shutdown that failed
          // on top of it has already been recorded in the shutdown trace.
        }
        throw error
      } finally {
        captureTraces()
      }
    },

    async stop(): Promise<void> {
      if (!started && teardown === undefined) return
      started = false
      await shutdownOnce()
    },

    trackWork(work: Promise<unknown>): void {
      if (runtime === undefined) {
        throw new ControllerRuntimeError(
          'not-active',
          'dsh-mywork: only a started controller can register in-flight work',
        )
      }
      runtime.trackWork(work)
    },

    async resumeAdmission(): Promise<ControllerLifecycleInfo> {
      if (runtime === undefined) {
        throw new ControllerRuntimeError(
          'not-active',
          'dsh-mywork: only a started controller can resume admission',
        )
      }
      const info = await runtime.resumeAdmission()
      openHold = undefined
      return info
    },
  }
}
