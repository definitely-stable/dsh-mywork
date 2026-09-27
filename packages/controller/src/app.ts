/**
 * The composition root of MyWork (F-28…F-31, MW-058, D07).
 *
 * One object owns the runtime: it resolves the layout, opens the two state
 * databases with the **full** migration list, brings the subsystems up in a
 * fixed order, publishes the ports it owns into the adapter registry, and takes
 * everything down in the reverse order. There is deliberately no second root —
 * any code that needs a store, a saga, or the scheduler receives it from here.
 *
 * Order is not cosmetic. `openStore` validates the journal, so the migration
 * list must be canonical (kernel, then evidence, then lease, planner, claim
 * saga); the lease must be held before the scheduler decides anything; and the
 * shutdown mirrors the startup so nothing is closed while a tick could still
 * read it.
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
import { CLAIM_SAGA_MIGRATIONS, createClaimSaga, type ClaimSaga } from '@dsh-mywork/execution'
import {
  ControllerLifecycle,
  LEASE_MIGRATIONS,
  createLeaseStore,
} from '@dsh-mywork/lease'
import { PLAN_MUTATION_MIGRATIONS, createPlanner, type Planner } from '@dsh-mywork/planner'
import {
  createScheduler,
  type Scheduler,
  type SchedulerAdmitPort,
  type SchedulerStatePort,
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
import { createMigrationAllocator, type AllocationAdoption, type MigrationAllocator } from './migration-allocator.ts'

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

/** Names of the subsystems the application brings up, in startup order. */
export type MyWorkSubsystemName = 'evidence' | 'lease' | 'planner' | 'execution' | 'scheduler'

/** One subsystem the application owns and stops in reverse order. */
export interface MyWorkSubsystem {
  /** Which subsystem this is. */
  readonly name: MyWorkSubsystemName
  /** Release it; called once, in reverse startup order. */
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
   * The platform token meter (§53, D05, F-51). Optional, because a profile
   * without the `tokenMeter` service still composes — and then no live session
   * can be measured, which this root reports through
   * {@link MyWorkApplication.budgetMeter} instead of replacing the meter with a
   * counter of its own.
   */
  readonly tokenMeter?: TokenMeterPort
}

/**
 * The application the controller row mounts.
 *
 * Every getter is `undefined` until {@link MyWorkApplication.start} has run, so a
 * caller can tell "not composed yet" from "composed and empty" — a distinction
 * the first real store in this workspace made necessary.
 */
export interface MyWorkApplication {
  /** Layout the databases are resolved from; available before `start()`. */
  readonly layout: MyWorkLayout
  /** `controller.sqlite`, open once `start()` resolved. */
  readonly store: MyWorkStore | undefined
  /** `registry.sqlite`, open once `start()` resolved. */
  readonly registry: MyWorkStore | undefined
  /** Version allocator of the controller database (F-63). */
  readonly migrations: MigrationAllocator | undefined
  /** Controller lease and lifecycle. */
  readonly lease: ControllerLifecycle<MyWorkStore> | undefined
  /** Evidence stores of `controller.sqlite`. */
  readonly evidence: { readonly artifacts: ArtifactStore; readonly audit: AuditLog } | undefined
  /** The plan mutator. */
  readonly planner: Planner | undefined
  /** The §9 claim saga. */
  readonly saga: ClaimSaga | undefined
  /** The §16 scheduler runtime; constructed here, armed by its owner. */
  readonly scheduler: Scheduler | undefined
  /**
   * The §53 charge bridge over the injected token meter (F-51, D05).
   *
   * `undefined` when the deployment mounted no `tokenMeter`: every token number
   * MyWork charges has to come from a real measurement, so an absent meter is
   * reported rather than papered over with a number this root would have to
   * invent. Every reading it returns comes from `measure()` on that call.
   */
  readonly budgetMeter: BudgetMeter | undefined
  /** Subsystems brought up, in startup order. */
  readonly services: readonly MyWorkSubsystem[]
  /** Admissions a tick decided, in order; the sink until the claim path owns it. */
  readonly admissions: readonly unknown[]
  /** Bring everything up; idempotent. */
  start(): Promise<void>
  /** Take everything down; idempotent and safe to call twice. */
  stop(): Promise<void>
}

/**
 * Create the application of one controller row.
 * @param options - clock, layout, adapter registry, and identity.
 * @returns the application; nothing is opened until {@link MyWorkApplication.start}.
 */
export function createMyWorkApplication(options: MyWorkApplicationOptions = {}): MyWorkApplication {
  const clock = options.clock ?? systemClock
  const layout = options.layout ?? resolveMyWorkLayout(options.dshHome === undefined ? {} : { dshHome: options.dshHome })
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

  let started = false
  let controller: MyWorkStore | undefined
  let registry: MyWorkStore | undefined
  let allocator: MigrationAllocator | undefined
  let lifecycle: ControllerLifecycle<MyWorkStore> | undefined
  let artifacts: ArtifactStore | undefined
  let audit: AuditLog | undefined
  let planner: Planner | undefined
  let saga: ClaimSaga | undefined
  let scheduler: Scheduler | undefined
  let handles: readonly AdapterRegistrationHandle<unknown>[] = []
  const services: MyWorkSubsystem[] = []
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
   * Empty until the projections that read the queue and the attempts land: a tick
   * over an empty observation admits nothing, which is the honest answer while
   * there is no queue to read. The catalog is empty for the same reason.
   */
  const state: SchedulerStatePort = {
    read: () => ({
      workers: Object.freeze([]),
      reviews: Object.freeze([]),
      instances: Object.freeze([]),
      agents: Object.freeze([]),
      workspaces: Object.freeze([]),
      catalog: Object.freeze({
        providers: Object.freeze([]),
        models: Object.freeze([]),
        outages: Object.freeze([]),
      }),
    }),
  }

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

  return {
    layout,
    get store() {
      return controller
    },
    get registry() {
      return registry
    },
    get migrations() {
      return allocator
    },
    get lease() {
      return lifecycle
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
    get scheduler() {
      return scheduler
    },
    get budgetMeter() {
      return budgetMeter
    },
    get services() {
      return Object.freeze([...services])
    },
    get admissions() {
      return Object.freeze([...admissions])
    },

    async start(): Promise<void> {
      if (started) return
      started = true
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
      controller = await openStore({
        path: controllerPath,
        migrations: myworkDatabaseMigrations(allocator),
      })

      artifacts = createArtifactStore(controller, clock)
      audit = createAuditLog(controller)
      services.push(Object.freeze({ name: 'evidence', dispose: () => undefined }))

      // The lease comes up before anything that admits work: a passive controller
      // must not hand out a planner that would mutate a scope it does not lead.
      lifecycle = new ControllerLifecycle<MyWorkStore>({
        scopeId,
        instanceId,
        processId,
        clock,
        leaseMs,
        leases: createLeaseStore(registry),
        openStores: () => ({ registry: registry as MyWorkStore, controller: controller as MyWorkStore }),
        reconcile: () => ({ operations: 0, leases: 0 }),
        closeStores: () => {
          controller?.close()
          registry?.close()
        },
      })
      await lifecycle.activate()
      services.push(Object.freeze({ name: 'lease', dispose: () => lifecycle?.dispose() ?? Promise.resolve() }))

      planner = createPlanner({ store: controller, graph, clock })
      saga = createClaimSaga({ store: controller, graph, clock })
      scheduler = createScheduler({ state, admit, clock })
      services.push(
        Object.freeze({ name: 'planner', dispose: () => undefined }),
        Object.freeze({ name: 'execution', dispose: () => undefined }),
        // Constructed and reachable, not armed: arming a timer that decides over
        // an empty observation would be noise. Its owner starts it.
        Object.freeze({ name: 'scheduler', dispose: () => scheduler?.stop() ?? Promise.resolve() }),
      )

      publish()
    },

    async stop(): Promise<void> {
      if (!started) return
      started = false
      // Reverse order: the registrations first (so nothing resolves a port that is
      // about to go), then the subsystems, and the lease last — it closes both
      // stores in its own hook.
      for (const handle of handles) handle.unregister()
      handles = []
      for (const service of [...services].reverse()) await service.dispose()
      services.length = 0
      if (lifecycle === undefined) {
        // The lifecycle never activated, so nothing closed the stores for us.
        controller?.close()
        registry?.close()
      }
      controller = undefined
      registry = undefined
      allocator = undefined
      lifecycle = undefined
      artifacts = undefined
      audit = undefined
      planner = undefined
      saga = undefined
      scheduler = undefined
    },
  }
}
