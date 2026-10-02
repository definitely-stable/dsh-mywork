/**
 * Scheduler state projection owned by the controller composition layer.
 *
 * The scheduler is intentionally a pure consumer of one observation. This
 * module is the boundary that turns authoritative runtime sources into that
 * observation; it never invents workers, agents, workspaces, or availability.
 *
 * A missing runtime source is therefore not represented as an empty array.
 * "There are no agents" and "the agent source is not composed" are different
 * facts, and treating both as [] would make an incomplete controller look like
 * a healthy idle deployment. Required sources fail closed with a typed
 * ControllerRuntimeError until their owning runtime slices are wired.
 *
 * Task readiness is read from TaskGraphPort and then re-read as full tasks so a
 * task that moved after ready() cannot be admitted from a stale reference.
 * Model availability is snapshotted through the adapter registry: an absent
 * catalog means no registered providers, while a registered provider whose
 * listModels call fails is recorded as an outage.
 * @module
 */

import type { MyWorkAdapters } from '@dsh-mywork/adapter-sdk'
import type {
  CatalogModel,
  CatalogOutage,
  CatalogProvider,
  CatalogSnapshot,
  ModelCatalogPort,
  SchedulerAgent,
  SchedulerInstanceObservation,
  SchedulerWorkspaceState,
  Task,
  TaskGraphPort,
} from '@dsh-mywork/contracts'
import type {
  SchedulerObservation,
  SchedulerObservedReview,
  SchedulerObservedTask,
  SchedulerStatePort,
} from '@dsh-mywork/scheduler'

import { ControllerRuntimeError } from './errors.ts'

/** Runtime-owned sources that must exist before one scheduler snapshot is true. */
export const SCHEDULER_STATE_REQUIRED_SOURCES = Object.freeze([
  'reviews',
  'instances',
  'agents',
  'workspaces',
] as const)

/** Name of one required runtime projection source. */
export type SchedulerStateSourceName = (typeof SCHEDULER_STATE_REQUIRED_SOURCES)[number]

/** Read-only source of one scheduler collection. */
export interface SchedulerProjectionSource<T> {
  /** Read one authoritative snapshot of the collection. */
  read(): readonly T[] | Promise<readonly T[]>
}

/** Runtime projections the scheduler observation cannot derive from TaskGraph/catalog. */
export interface SchedulerStateProjectionSources {
  /** Review work owned by the review queue. */
  readonly reviews: SchedulerProjectionSource<SchedulerObservedReview>
  /** Live agent instances and their resource states. */
  readonly instances: SchedulerProjectionSource<SchedulerInstanceObservation>
  /** Durable identities resolved with their role and blueprint revisions. */
  readonly agents: SchedulerProjectionSource<SchedulerAgent>
  /** Resolved workspace scheduling/configuration state. */
  readonly workspaces: SchedulerProjectionSource<SchedulerWorkspaceState>
}

/** Inputs of {@link createSchedulerStateProjection}. */
export interface SchedulerStateProjectionDeps {
  /** Canonical task graph; readiness is never re-derived locally. */
  readonly graph: TaskGraphPort
  /** Adapter registry used to resolve the model catalog dynamically. */
  readonly adapters?: MyWorkAdapters<undefined>
  /** Runtime sources already composed by their owning slices. */
  readonly sources?: Partial<SchedulerStateProjectionSources>
}

/** Scheduler state port with an explicit composition diagnostic. */
export interface SchedulerStateProjection extends SchedulerStatePort {
  /** Required sources that are not composed right now, in canonical order. */
  missingSources(): readonly SchedulerStateSourceName[]
}

/** Frozen empty catalog: absence means there is no registered catalog adapter. */
const EMPTY_CATALOG: CatalogSnapshot = Object.freeze({
  providers: Object.freeze([]),
  models: Object.freeze([]),
  outages: Object.freeze([]),
})

/**
 * Build the controller-owned scheduler state projection.
 *
 * The object is safe to construct before every source exists. read() is not:
 * it refuses until all required runtime sources are composed, so the controller
 * may expose an unarmed scheduler without pretending an incomplete deployment
 * has an empty workload.
 */
export function createSchedulerStateProjection(
  deps: SchedulerStateProjectionDeps,
): SchedulerStateProjection {
  if (deps === null || typeof deps !== 'object' || typeof deps.graph?.ready !== 'function' || typeof deps.graph?.get !== 'function') {
    throw new TypeError('dsh-mywork: scheduler state projection needs a TaskGraphPort with ready() and get()')
  }
  const sources = deps.sources ?? {}

  function missingSources(): readonly SchedulerStateSourceName[] {
    return Object.freeze(
      SCHEDULER_STATE_REQUIRED_SOURCES.filter(name => sources[name] === undefined),
    )
  }

  return Object.freeze({
    missingSources,

    async read(): Promise<SchedulerObservation> {
      const missing = missingSources()
      if (missing.length > 0) {
        throw new ControllerRuntimeError(
          'state-unavailable',
          `dsh-mywork: scheduler state projection is incomplete; missing sources: ${missing.join(', ')}`,
          { details: { missingSources: [...missing] } },
        )
      }

      const [workers, reviews, instances, agents, workspaces, catalog] = await Promise.all([
        readReadyTasks(deps.graph),
        readCollection(sources.reviews!, 'reviews'),
        readCollection(sources.instances!, 'instances'),
        readCollection(sources.agents!, 'agents'),
        readCollection(sources.workspaces!, 'workspaces'),
        readCatalog(deps.adapters),
      ])

      return Object.freeze({
        workers,
        reviews,
        instances,
        agents,
        workspaces,
        catalog,
      })
    },
  })
}

/** Read one required collection and take ownership of its array identity. */
async function readCollection<T>(
  source: SchedulerProjectionSource<T>,
  name: SchedulerStateSourceName,
): Promise<readonly T[]> {
  const values = await source.read()
  if (!Array.isArray(values)) {
    throw new TypeError(`dsh-mywork: scheduler state source "${name}" must return an array`)
  }
  return Object.freeze(values.map(value => snapshotData(value)))
}

/**
 * Own and deeply freeze plain scheduler data.
 *
 * Projection sources are ports, not trusted object owners: retaining one of
 * their object identities would let a later mutation rewrite a snapshot the
 * scheduler already read. Scheduler observation contracts contain data only,
 * so structuredClone is the exact boundary we need here.
 */
function snapshotData<T>(value: T): T {
  return freezeData(structuredClone(value)) as T
}

/** Recursively freeze one structured-clone result. */
function freezeData(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) freezeData(entry)
    return Object.freeze(value)
  }
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) freezeData(entry)
    return Object.freeze(value)
  }
  return value
}

/**
 * Expand graph readiness references into full tasks.
 *
 * ready() and get() are deliberately two reads. A task may move between them;
 * only the full task that is still ready belongs in this snapshot.
 */
async function readReadyTasks(graph: TaskGraphPort): Promise<readonly SchedulerObservedTask[]> {
  const references = await graph.ready()
  if (!Array.isArray(references)) {
    throw new TypeError('dsh-mywork: TaskGraphPort.ready() must return an array')
  }

  const seen = new Set<string>()
  const workers: SchedulerObservedTask[] = []
  for (const reference of references) {
    if (reference === null || typeof reference !== 'object' || typeof reference.id !== 'string' || reference.id.trim() === '') {
      throw new TypeError('dsh-mywork: TaskGraphPort.ready() returned a task reference without an id')
    }
    if (seen.has(reference.id)) continue
    seen.add(reference.id)

    const task = await graph.get(reference.id)
    if (task.id !== reference.id) {
      throw new TypeError(
        `dsh-mywork: TaskGraphPort.get("${reference.id}") returned task "${String(task.id)}"`,
      )
    }
    if (task.state !== 'ready') continue
    workers.push(Object.freeze({ task: snapshotTask(task) }))
  }
  return Object.freeze(workers)
}

/** Copy the Task Graph value so a mutable adapter object cannot mutate a completed snapshot. */
function snapshotTask(task: Task): Task {
  return snapshotData(task)
}

/**
 * Snapshot the registered model catalog.
 *
 * No model-catalog adapter means the route set is absent and therefore empty.
 * Once an adapter exists, a provider that fails listModels() is an outage and
 * remains present in providers; it is never collapsed into "no such provider".
 */
async function readCatalog(adapters: MyWorkAdapters<undefined> | undefined): Promise<CatalogSnapshot> {
  if (adapters === undefined || adapters.list('model-catalog').length === 0) return EMPTY_CATALOG

  // list() is the side-effect-free absence check. resolve() reports refusals to
  // the registry observer, so using it to discover an optional missing catalog
  // would manufacture one refusal event per scheduler tick in a healthy
  // deployment that intentionally has no model provider.
  const resolution = adapters.resolve<ModelCatalogPort>('model-catalog')
  if (!resolution.ok) throw resolution.refusal

  const listedProviders = resolution.adapter.listProviders()
  if (!Array.isArray(listedProviders)) {
    throw new TypeError('dsh-mywork: ModelCatalogPort.listProviders() must return an array')
  }
  const providers: CatalogProvider[] = listedProviders.map(provider => Object.freeze({ ...provider }))
  const reads = await Promise.all(
    providers.map(async provider => {
      try {
        const listed = await resolution.adapter.listModels(provider.id)
        if (!Array.isArray(listed)) {
          throw new TypeError(`ModelCatalogPort.listModels("${provider.id}") did not return an array`)
        }
        return {
          models: listed.map(model => Object.freeze({ ...model }) as CatalogModel),
          outage: undefined,
        }
      } catch (error) {
        return {
          models: [] as CatalogModel[],
          outage: Object.freeze({
            provider: provider.id,
            detail: error instanceof Error ? error.message : String(error),
          }) as CatalogOutage,
        }
      }
    }),
  )

  const models = reads.flatMap(read => read.models)
  const outages = reads.flatMap(read => read.outage === undefined ? [] : [read.outage])
  return Object.freeze({
    providers: Object.freeze(providers),
    models: Object.freeze(models),
    outages: Object.freeze(outages),
  })
}
