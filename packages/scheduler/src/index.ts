/**
 * `@dsh-mywork/scheduler` — the deterministic scheduler runtime (§14, §15, §16,
 * §27, §30).
 *
 * §16 splits the scheduler in two, and so does this workspace: the decision
 * (`planSchedulerTick` in `@dsh-mywork/core`) is pure policy over one state
 * observation, and this package is the service around it — the event-driven kick,
 * the safety reconcile that recovers a missed event, the aging readings, and the
 * pool capacity the decision fills.
 *
 * ```ts
 * const scheduler = createScheduler({ state, admit, clock })
 * await scheduler.start()                                    // §16.1 startup + timer
 * await scheduler.kick({ source: 'event', event: 'dependency.closed', taskId })  // §16.2
 * await scheduler.reconcile()                                // §16.2 safety path
 * ```
 *
 * The package mounts no Cordis row and opens no store: the caller composes the
 * state port out of the Task Graph, MyWork DB, and the model catalog, and hands
 * the admissions to the §9 claim saga. The resident controller that owns the
 * scheduler (ADR020) is the composition that does that.
 *
 * **The scheduler never calls an LLM.** It holds no model port and no catalog
 * port: the catalog it decides against arrives inside the observation, and a tick
 * with nothing admissible performs no side effect at all beyond reading state.
 * @module @dsh-mywork/scheduler
 */

export {
  createScheduler,
  type Scheduler,
  type SchedulerAdmitPort,
  type SchedulerDeps,
  type SchedulerObservation,
  type SchedulerObservedReview,
  type SchedulerObservedTask,
  type SchedulerSnapshot,
  type SchedulerStatePort,
} from './service.ts'
