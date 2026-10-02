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
 * Model availability arrives as an already-observed CatalogSnapshot. The state
 * port never resolves a catalog adapter or calls a provider: refreshing that
 * snapshot belongs to the catalog observation boundary, outside a scheduler tick.
 * @module
 */

import type {
  CatalogSnapshot,
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

/** Read-only source of the last completed catalog observation. */
export interface SchedulerCatalogObservationSource {
  /** Return the cached snapshot. This method must perform no adapter/provider I/O. */
  read(): CatalogSnapshot
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
  /** Last completed model-catalog observation; read() is data-only. */
  readonly catalog: SchedulerCatalogObservationSource
  /** Runtime sources already composed by their owning slices. */
  readonly sources?: Partial<SchedulerStateProjectionSources>
}

/** Scheduler state port with an explicit composition diagnostic. */
export interface SchedulerStateProjection extends SchedulerStatePort {
  /** Required sources that are not composed right now, in canonical order. */
  missingSources(): readonly SchedulerStateSourceName[]
}

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
  if (deps.catalog === null || typeof deps.catalog !== 'object' || typeof deps.catalog.read !== 'function') {
    throw new TypeError('dsh-mywork: scheduler state projection needs a catalog observation source with read()')
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
        Promise.resolve(snapshotData(deps.catalog.read())),
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
