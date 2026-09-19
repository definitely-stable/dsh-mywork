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

/** One unit of agent work handed to a runtime. */
export interface AgentStartRequest {
  /** Caller-owned run identifier; the runtime rejects a duplicate. */
  readonly runId: string
  /** Workspace the run may touch. */
  readonly workspacePath: string
  /** Task text handed to the agent. */
  readonly prompt: string
}

/** Opaque reference to a started run. */
export interface AgentRuntimeHandle {
  /** Run identifier the handle refers to. */
  readonly runId: string
}

/** Observed state of one run. */
export interface AgentRuntimeStatus {
  /** Run identifier the status describes. */
  readonly runId: string
  /** True while the runtime still owns the run. */
  readonly running: boolean
}

/**
 * Agent runtime port (architecture §36). Attempts, leases, and fences are
 * modelled in `./attempt.ts`; binding this port to them is part of the adapter
 * SDK and runtime work, not of the domain contracts.
 */
export interface AgentRuntimePort {
  /**
   * Start one run.
   * @param request - run identity, workspace, and prompt.
   * @returns a handle for {@link status} and {@link stop}.
   */
  start(request: AgentStartRequest): Promise<AgentRuntimeHandle>
  /**
   * Read the run's state.
   * @param handle - handle returned by {@link start}.
   */
  status(handle: AgentRuntimeHandle): Promise<AgentRuntimeStatus>
  /**
   * Stop the run; idempotent for an already stopped run.
   * @param handle - handle returned by {@link start}.
   */
  stop(handle: AgentRuntimeHandle): Promise<void>
}

export * from './ids.ts'
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
export * from './team.ts'
export * from './config.ts'
export * from './security.ts'
export * from './artifact.ts'
export * from './audit.ts'
export * from './lease.ts'
export * from './plan.ts'
export * from './workflow.ts'
