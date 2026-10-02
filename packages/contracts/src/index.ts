/**
 * Public contracts of dsh-mywork: the domain model (tasks, attempts, reviews,
 * team, authority, results, events), the service names of the controller
 * plugin, and the ports it consumes.
 *
 * Everything below is a type or a frozen constant: this package carries no
 * behaviour and depends on nothing else in the workspace.
 * @module @dsh-mywork/contracts
 */

/** Cordis service name the controller plugin publishes. */
export const MYWORK_CONTROLLER_SERVICE = 'myworkController'

/**
 * Cordis service name of the optional time source a deployment may provide.
 * When no provider is mounted, the controller falls back to the system clock.
 */
export const MYWORK_CLOCK_SERVICE = 'myworkClock'

/**
 * Cordis service name of the adapter registry (architecture §44). The
 * controller publishes it; an adapter row registers its declaration through it.
 * The registry's own types live in `@dsh-mywork/adapter-sdk`.
 */
export const MYWORK_ADAPTERS_SERVICE = 'myworkAdapters'

/** Lifecycle phase of a controller instance. */
export type ControllerStatus = 'starting' | 'mounted' | 'stopped'

/** Immutable snapshot of the controller's mount state. */
export interface ControllerInfo {
  /** Cordis service name the controller is published under. */
  readonly service: string
  /** Controller package version that produced this snapshot. */
  readonly version: string
  /** Current lifecycle phase. */
  readonly status: ControllerStatus
  /** Clock reading (epoch milliseconds) taken when the controller mounted. */
  readonly mountedAt: number
  /** Clock reading taken when the controller stopped; absent while mounted. */
  readonly stoppedAt?: number
  /** Bounded contexts the controller owns (architecture §46). */
  readonly boundedContexts: readonly string[]
}

/** The service `@dsh-mywork/controller` provides on the host context. */
export interface MyWorkController {
  /** Snapshot of the controller state; safe to call at any lifecycle point. */
  info(): ControllerInfo
}

/**
 * Injectable time source. `@dsh-mywork/adapter-sdk/testing` ships the
 * deterministic fake, so scheduling policy is testable without real time.
 */
export interface ClockPort {
  /** Current time in epoch milliseconds. */
  now(): number
  /**
   * Resolve once `ms` of this clock has elapsed.
   * @param ms - delay in milliseconds; values <= 0 resolve without waiting.
   * @param signal - optional cancellation.
   * @returns a promise that settles with the delay or the cancellation.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

export * from './ids.ts'
export * from './agent-runtime.ts'
export * from './revisions.ts'
export * from './operation.ts'
export * from './events.ts'
export * from './authority.ts'
export * from './task.ts'
export * from './taskgraph.ts'
export * from './board.ts'
export * from './theme.ts'
export * from './attempt.ts'
export * from './review.ts'
export * from './review-verdict.ts'
export * from './team.ts'
export * from './config.ts'
export * from './security.ts'
export * from './artifact.ts'
export * from './audit.ts'
export * from './lease.ts'
export * from './plan.ts'
export * from './workflow.ts'
export * from './claim.ts'
export * from './model-catalog.ts'
export * from './routing.ts'
export * from './budget.ts'
export * from './context.ts'
export * from './session.ts'
export * from './skill.ts'
export * from './memory.ts'
export * from './scheduler.ts'
export * from './background-job.ts'
export * from './worktree.ts'
export * from './attempt-run.ts'
export * from './verification.ts'
export * from './git.ts'
