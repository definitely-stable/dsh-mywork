/**
 * Scheduler runtime (architecture §16).
 *
 * The decision is pure and lives in `@dsh-mywork/core` (`planSchedulerTick`).
 * What this module adds is everything §16 asks of the *service* around it:
 *
 * - §16.1 lifecycle — `start()` runs the startup reconcile and arms the safety
 *   timer; `stop()` disarms it and waits for the tick in flight.
 * - §16.2 event-driven kick — `kick()` runs one tick per event, and the timer
 *   runs the same tick without one, which is what recovers a missed event: the
 *   decision reads state, never the event payload.
 * - §16.3 aging — the runtime keeps its own queue reading per unit of work, so
 *   "how long has this waited" survives across ticks even when the state port
 *   does not track it.
 * - §3.2 — the scheduler is not an LLM. It holds no model port, no provider
 *   port, and no catalog port: the catalog it decides against arrives inside the
 *   state it reads. A tick with nothing to admit therefore cannot call anything.
 *
 * Ticks are serialized: a kick that arrives while a tick is running waits for it,
 * so two ticks never decide against the same state concurrently.
 * @module
 */

import {
  SCHEDULER_EVENT_TYPES,
  SCHEDULER_KICK_SOURCES,
  type AgentId,
  type CatalogSnapshot,
  type ClockPort,
  type EpochMs,
  type ReviewId,
  type SchedulerAdmission,
  type SchedulerAgent,
  type SchedulerInstanceObservation,
  type SchedulerKick,
  type SchedulerLimits,
  type SchedulerPlan,
  type SchedulerPolicy,
  type SchedulerReviewCandidate,
  type SchedulerTaskCandidate,
  type SchedulerTickInput,
  type SchedulerWorkBudget,
  type SchedulerWorkspaceState,
  type Task,
  type TaskId,
  type WorkspaceId,
} from '@dsh-mywork/contracts'
import { planSchedulerTick, resolveSchedulerLimits, resolveSchedulerPolicy } from '@dsh-mywork/core'

/** One ready task as the state port reports it. */
export interface SchedulerObservedTask {
  /** Task as the Task Graph reports it. */
  readonly task: Task
  /**
   * Clock reading the task reached `ready`, when the port tracks it. Absent
   * means the scheduler's own queue reading is used instead (§16.3 aging).
   */
  readonly readySince?: EpochMs
  /** §30 state of the task. */
  readonly budget?: SchedulerWorkBudget
}

/**
 * One queued review as the state port reports it.
 *
 * The observation intentionally stops at durable identifiers. A queued review
 * does not have a reviewer yet, so carrying the full Review aggregate here would
 * force the state port to invent the very identity the scheduler is choosing.
 */
export interface SchedulerObservedReview {
  /** Durable review identity in the review queue. */
  readonly reviewId: ReviewId
  /** Task whose settled attempt is being reviewed. */
  readonly taskId: TaskId
  /** Workspace of the task under review. */
  readonly workspaceId: WorkspaceId
  /** Identity that produced the attempt under review (§31). */
  readonly producerAgentId?: AgentId
  /** Clock reading the review reached `queued`, when the port tracks it. */
  readonly readySince?: EpochMs
  /** §30 state of the task the review belongs to. */
  readonly budget?: SchedulerWorkBudget
}

/**
 * Everything one tick reads.
 *
 * It is a plain observation, never a live object graph: the port reads durable
 * state and hands over data, exactly as the Task Graph adapter does.
 */
export interface SchedulerObservation {
  /** Ready tasks the Task Graph reports. */
  readonly workers: readonly SchedulerObservedTask[]
  /** Queued reviews MyWork DB reports. */
  readonly reviews: readonly SchedulerObservedReview[]
  /** Instances that exist right now. */
  readonly instances: readonly SchedulerInstanceObservation[]
  /** Identities work may be assigned to. */
  readonly agents: readonly SchedulerAgent[]
  /** Workspaces the scheduler may fill. */
  readonly workspaces: readonly SchedulerWorkspaceState[]
  /** Model catalog as it was last observed. */
  readonly catalog: CatalogSnapshot
  /** §15 limits; absent fields take the deployment defaults. */
  readonly limits?: Partial<SchedulerLimits>
}

/** Source of the state a tick decides against. */
export interface SchedulerStatePort {
  /** Read the state; never calls a model, a provider, or a catalog. */
  read(): SchedulerObservation | Promise<SchedulerObservation>
}

/**
 * Sink for the admissions a tick decided.
 *
 * The scheduler never claims work itself: §9's saga owns the claim, and this port
 * is how the decision reaches it. An admission handed here twice is the claim
 * path's problem, not the scheduler's — which is why the port is idempotent by
 * contract.
 */
export interface SchedulerAdmitPort {
  /**
   * Hand one admission to the claim path.
   * @param admission - the decision.
   * @param plan - the whole plan it belongs to, for correlation.
   */
  admit(admission: SchedulerAdmission, plan: SchedulerPlan): void | Promise<void>
}

/** What {@link createScheduler} needs. */
export interface SchedulerDeps {
  /** Source of the state every tick reads. */
  readonly state: SchedulerStatePort
  /** Sink for the admissions a tick decides. */
  readonly admit: SchedulerAdmitPort
  /** Time source: the only clock the runtime reads. */
  readonly clock: ClockPort
  /** Policy; absent fields take {@link DEFAULT_SCHEDULER_POLICY}. */
  readonly policy?: Partial<SchedulerPolicy>
  /** §15 limits; overridden by the limits the observation states. */
  readonly limits?: Partial<SchedulerLimits>
}

/** What the runtime has done so far (§38 observability). */
export interface SchedulerSnapshot {
  /** True while the safety timer is armed. */
  readonly running: boolean
  /** Ticks that completed. */
  readonly ticks: number
  /** Admissions handed to the claim path. */
  readonly admissions: number
  /** Units of work the runtime holds a queue reading for. */
  readonly queued: number
  /** Plan of the last completed tick. */
  readonly lastPlan?: SchedulerPlan
  /** Message of the last failure; the error itself was rethrown to the caller. */
  readonly lastError?: string
}

/** The scheduler runtime of one controller epoch (§16.1). */
export interface Scheduler {
  /**
   * Run the startup reconcile and arm the safety timer (§16.1).
   * Idempotent: a second call while running returns the startup plan.
   */
  start(): Promise<SchedulerPlan>
  /** Disarm the timer and wait for the tick in flight. Idempotent. */
  stop(): Promise<void>
  /**
   * Run one tick because an event asked for it (§16.2).
   * @throws {TypeError} when the kick is not one §16.2 describes.
   */
  kick(kick: SchedulerKick): Promise<SchedulerPlan>
  /** Run one tick because the safety timer fired (§16.2). */
  reconcile(): Promise<SchedulerPlan>
  /** Read what the runtime has done so far. */
  snapshot(): SchedulerSnapshot
}

/**
 * Create the scheduler runtime.
 *
 * The returned service owns exactly three things: the tick queue, the aging
 * readings, and the safety timer. It owns no durable state and no store — the
 * state it decides against is read through {@link SchedulerDeps.state} on every
 * tick, so a caller that writes a task and then kicks gets the new state without
 * telling the scheduler anything else.
 * @param deps - state port, admission port, clock, policy, and limits.
 * @throws {TypeError} when a dependency or a stated policy field is malformed.
 */
export function createScheduler(deps: SchedulerDeps): Scheduler {
  return new SchedulerService(deps)
}

/** Implementation of {@link Scheduler}; the class is private to the module. */
class SchedulerService implements Scheduler {
  private readonly state: SchedulerStatePort
  private readonly admit: SchedulerAdmitPort
  private readonly clock: ClockPort
  private readonly policy: SchedulerPolicy
  private readonly limits: Partial<SchedulerLimits> | undefined

  /** Serializes ticks: a kick never decides against state another tick is using. */
  private chain: Promise<unknown> = Promise.resolve()
  /** Queue reading per unit of work, keyed `task:<id>` / `review:<id>` (§16.3). */
  private readonly queue = new Map<string, EpochMs>()

  private abort: AbortController | undefined
  private loopDone: Promise<void> | undefined
  private startup: Promise<SchedulerPlan> | undefined
  private ticks = 0
  private admissions = 0
  private lastPlan: SchedulerPlan | undefined
  private lastError: string | undefined

  /**
   * @param deps - state port, admission port, clock, policy, and limits.
   * @throws {TypeError} when a dependency or a stated policy field is malformed.
   */
  constructor(deps: SchedulerDeps) {
    if (deps === null || typeof deps !== 'object') throw new TypeError('dsh-mywork: a scheduler needs its dependencies')
    if (typeof deps.state?.read !== 'function') throw new TypeError('dsh-mywork: a scheduler needs a state port with read()')
    if (typeof deps.admit?.admit !== 'function') throw new TypeError('dsh-mywork: a scheduler needs an admission port with admit()')
    if (typeof deps.clock?.now !== 'function' || typeof deps.clock.sleep !== 'function') {
      throw new TypeError('dsh-mywork: a scheduler needs a clock with now() and sleep()')
    }
    this.state = deps.state
    this.admit = deps.admit
    this.clock = deps.clock
    this.policy = resolveSchedulerPolicy(deps.policy)
    this.limits = deps.limits
  }

  /** {@inheritDoc Scheduler.start} */
  async start(): Promise<SchedulerPlan> {
    if (this.abort !== undefined) return this.startup ?? this.enqueue(() => this.runTick({ source: 'startup' }))
    const controller = new AbortController()
    this.abort = controller
    const startup = this.enqueue(() => this.runTick({ source: 'startup' }))
    this.startup = startup
    // The safety timer runs whatever the startup reconcile answered: a failure
    // there is reported to the caller, not turned into a scheduler that never
    // reconciles again.
    this.loopDone = startup.then(
      () => this.reconcileLoop(controller.signal),
      () => this.reconcileLoop(controller.signal),
    )
    return startup
  }

  /** {@inheritDoc Scheduler.stop} */
  async stop(): Promise<void> {
    const controller = this.abort
    if (controller === undefined) return
    this.abort = undefined
    this.startup = undefined
    controller.abort()
    const loop = this.loopDone
    this.loopDone = undefined
    if (loop !== undefined) await loop
    await this.chain
  }

  /** {@inheritDoc Scheduler.kick} */
  kick(kick: SchedulerKick): Promise<SchedulerPlan> {
    const checked = requireKick(kick)
    return this.enqueue(() => this.runTick(checked))
  }

  /** {@inheritDoc Scheduler.reconcile} */
  reconcile(): Promise<SchedulerPlan> {
    return this.enqueue(() => this.runTick({ source: 'reconcile' }))
  }

  /** {@inheritDoc Scheduler.snapshot} */
  snapshot(): SchedulerSnapshot {
    return Object.freeze({
      running: this.abort !== undefined,
      ticks: this.ticks,
      admissions: this.admissions,
      queued: this.queue.size,
      ...(this.lastPlan === undefined ? {} : { lastPlan: this.lastPlan }),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
    })
  }

  /** Run one tick, serialized behind every tick already queued. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work)
    this.chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** The §16.2 safety path: sleep one interval, then reconcile, until stopped. */
  private async reconcileLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.clock.sleep(this.policy.reconcileIntervalMs, signal)
      } catch {
        return
      }
      if (signal.aborted) return
      try {
        await this.enqueue(() => this.runTick({ source: 'reconcile' }))
      } catch {
        // The failure is recorded in the snapshot by `runTick`; the timer keeps
        // reconciling, because a safety path that stops on the first failure is
        // the failure it exists to cover.
      }
    }
  }

  /** Read the state, decide, and hand the admissions to the claim path. */
  private async runTick(kick: SchedulerKick): Promise<SchedulerPlan> {
    try {
      const observation = requireObservation(await this.state.read())
      const nowMs = this.clock.now()
      const plan = planSchedulerTick(this.tickInput(observation, nowMs, kick))
      this.ticks += 1
      this.lastPlan = plan
      for (const admission of plan.admissions) {
        await this.admit.admit(admission, plan)
        this.admissions += 1
      }
      return plan
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  /** Normalize an observation into the tick the pure policy takes. */
  private tickInput(observation: SchedulerObservation, nowMs: EpochMs, kick: SchedulerKick): SchedulerTickInput {
    const seen = new Set<string>()
    const workers: SchedulerTaskCandidate[] = observation.workers.map(observed => {
      const key = `task:${observed.task.id}`
      seen.add(key)
      return {
        task: observed.task,
        readySince: this.queueReading(key, observed.readySince, nowMs),
        ...(observed.budget === undefined ? {} : { budget: observed.budget }),
      }
    })
    const reviews: SchedulerReviewCandidate[] = observation.reviews.map(observed => {
      const key = `review:${observed.reviewId}`
      seen.add(key)
      return {
        reviewId: observed.reviewId,
        taskId: observed.taskId,
        workspaceId: observed.workspaceId,
        readySince: this.queueReading(key, observed.readySince, nowMs),
        ...(observed.producerAgentId === undefined ? {} : { producerAgentId: observed.producerAgentId }),
        ...(observed.budget === undefined ? {} : { budget: observed.budget }),
      }
    })
    for (const key of [...this.queue.keys()]) {
      if (!seen.has(key)) this.queue.delete(key)
    }
    return {
      nowMs,
      kick,
      workers,
      reviews,
      instances: observation.instances,
      agents: observation.agents,
      workspaces: observation.workspaces,
      catalog: observation.catalog,
      limits: resolveSchedulerLimits(observation.limits ?? this.limits),
      policy: this.policy,
    }
  }

  /**
   * The queue reading of one unit of work.
   *
   * A reading the port states wins; otherwise the first tick that saw the work
   * mints one, and later ticks keep it — so aging measures how long the work has
   * waited for admission, not how long the runtime has been up.
   */
  private queueReading(key: string, stated: EpochMs | undefined, nowMs: EpochMs): EpochMs {
    const reading = stated ?? this.queue.get(key) ?? nowMs
    this.queue.set(key, reading)
    return reading
  }
}

/** Validate a kick against §16.2; an unknown wake-up is a programming error. */
function requireKick(kick: SchedulerKick): SchedulerKick {
  if (kick === null || typeof kick !== 'object' || Array.isArray(kick)) {
    throw new TypeError('dsh-mywork: a scheduler kick must be an object')
  }
  if (!SCHEDULER_KICK_SOURCES.includes(kick.source)) {
    throw new TypeError(`dsh-mywork: "${String(kick.source)}" is not a scheduler kick source`)
  }
  if (kick.source === 'event') {
    if (kick.event === undefined || !SCHEDULER_EVENT_TYPES.includes(kick.event)) {
      throw new TypeError(`dsh-mywork: "${String(kick.event)}" is not a §16.2 scheduler event`)
    }
  } else if (kick.event !== undefined) {
    throw new TypeError(`dsh-mywork: a "${kick.source}" kick does not carry an event`)
  }
  return Object.freeze({ ...kick })
}

/** Validate the shape of an observation. */
function requireObservation(observation: SchedulerObservation): SchedulerObservation {
  if (observation === null || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new TypeError('dsh-mywork: a scheduler observation must be an object')
  }
  for (const field of ['workers', 'reviews', 'instances', 'agents', 'workspaces'] as const) {
    if (!Array.isArray(observation[field])) {
      throw new TypeError(`dsh-mywork: scheduler observation "${field}" must be an array`)
    }
  }
  if (observation.catalog === null || typeof observation.catalog !== 'object') {
    throw new TypeError('dsh-mywork: scheduler observation "catalog" must be an object')
  }
  return observation
}
