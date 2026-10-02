/**
 * Scheduler vocabulary (architecture §14, §15, §16, §27, §30).
 *
 * §16 makes the scheduler a deterministic service over durable state: an event
 * kicks it, a safety reconcile covers the events that were missed, and the
 * assignment function filters candidates and ranks them. §14 gives the elastic
 * pools and their limits, §15 the resource states that decide which limit a
 * running instance charges, §27 keeps reviewers in a pool of their own, and §30
 * the budget an attempt must pass before it is admitted.
 *
 * This module carries the vocabulary — the resource states with the counters
 * they charge, the events that kick the scheduler, the limits, the workspace
 * fairness weights, and the shape of one tick's plan. The decision itself is
 * pure policy and lives in `@dsh-mywork/core`; the runtime that kicks it lives
 * in `@dsh-mywork/scheduler`.
 * @module
 */

import type {
  AgentId,
  AgentInstanceId,
  BlueprintId,
  EpochMs,
  ReviewId,
  RoleId,
  TaskId,
  WorkspaceId,
} from './ids.ts'
import type { BudgetAmount, BudgetConsumption, BudgetLedger, BudgetLimits, BudgetScope } from './budget.ts'
import type { CatalogSnapshot } from './model-catalog.ts'
import type { HarnessPolicy } from './security.ts'
import type { Task } from './task.ts'
import type { AgentBlueprint, AgentIdentity, PoolLimits, Role, RoleLimits, WorkspaceLimits } from './team.ts'

/**
 * Resource state of one agent instance (§15).
 *
 * §15 refuses to reduce an instance to "running or idle": what it holds decides
 * which limit it charges. The states are the architecture's own, and
 * {@link RESOURCE_STATE_CHARGES} states the counters each of them takes.
 */
export type ResourceState =
  /** A model call is in flight. */
  | 'model-active'
  /** A heavy tool is running. */
  | 'tool-active'
  /** Waiting for something outside MyWork. */
  | 'waiting-external'
  /** Waiting for a dependency of its task. */
  | 'waiting-dependency'
  /** Waiting for a reviewer. */
  | 'review-waiting'
  /** Mounted but running nothing. */
  | 'idle'
  /** Asleep between runs; holds nothing and is woken only by an admission. */
  | 'sleeping'

/** Every resource state, in the order §15 lists them. */
export const RESOURCE_STATES: readonly ResourceState[] = Object.freeze([
  'model-active',
  'tool-active',
  'waiting-external',
  'waiting-dependency',
  'review-waiting',
  'idle',
  'sleeping',
])

/** Counters one resource state charges (§14, §15). */
export interface ResourceCharge {
  /** Holds a slot of its elastic pool (§14 `maxActive`). */
  readonly poolSlot: boolean
  /** Counts as an active attempt (§15 `maxAttempts`). */
  readonly activeAttempt: boolean
  /** Counts against concurrent LLM calls (§15 `maxConcurrentLlm`). */
  readonly llmSlot: boolean
  /** Counts against concurrent heavy tools (§15 `maxHeavyTools`). */
  readonly heavyToolSlot: boolean
}

/** A charge that takes nothing. */
const CHARGES_NOTHING: ResourceCharge = Object.freeze({
  poolSlot: false,
  activeAttempt: false,
  llmSlot: false,
  heavyToolSlot: false,
})

/**
 * What each resource state charges.
 *
 * `idle` and `sleeping` deliberately charge nothing: §14 keeps `minActive`
 * instances warm *while the pool is idle*, so a warm instance is not one that
 * occupies the pool's running capacity, and a sleeping instance holds nothing at
 * all — which is exactly why nothing wakes it except an admission.
 *
 * `model-active` and `tool-active` are exclusive: a state is either calling a
 * model or running a heavy tool, and charging both would make one attempt
 * consume two of the three §15 limits at once.
 */
export const RESOURCE_STATE_CHARGES: Readonly<Record<ResourceState, ResourceCharge>> = Object.freeze({
  'model-active': Object.freeze({ poolSlot: true, activeAttempt: true, llmSlot: true, heavyToolSlot: false }),
  'tool-active': Object.freeze({ poolSlot: true, activeAttempt: true, llmSlot: false, heavyToolSlot: true }),
  'waiting-external': Object.freeze({ poolSlot: true, activeAttempt: true, llmSlot: false, heavyToolSlot: false }),
  'waiting-dependency': Object.freeze({ poolSlot: true, activeAttempt: true, llmSlot: false, heavyToolSlot: false }),
  'review-waiting': Object.freeze({ poolSlot: true, activeAttempt: true, llmSlot: false, heavyToolSlot: false }),
  idle: CHARGES_NOTHING,
  sleeping: CHARGES_NOTHING,
})

/**
 * Events that kick the scheduler (§16.2).
 *
 * The list is §16.2's own, and it is deliberately closed: a kick the scheduler
 * does not know is a programming error rather than a silently ignored wake-up.
 * The timer-driven safety reconcile is not an event — it is
 * {@link SchedulerKickSource} `reconcile`.
 */
export type SchedulerEventType =
  /** A task was captured. */
  | 'task.created'
  /** A task reached `ready`. */
  | 'task.ready'
  /** A dependency of a task was satisfied. */
  | 'dependency.closed'
  /** A task entered `awaiting-review`. */
  | 'review.requested'
  /** A review rejected the attempt it saw. */
  | 'review.rejected'
  /** An instance settled and can take work again. */
  | 'agent.idle'
  /** An attempt failed. */
  | 'agent.failed'
  /** Configuration a tick reads changed. */
  | 'config.changed'
  /** A workspace was enabled for scheduling. */
  | 'workspace.enabled'

/** Every kick event, in the order §16.2 lists them. */
export const SCHEDULER_EVENT_TYPES: readonly SchedulerEventType[] = Object.freeze([
  'task.created',
  'task.ready',
  'dependency.closed',
  'review.requested',
  'review.rejected',
  'agent.idle',
  'agent.failed',
  'config.changed',
  'workspace.enabled',
])

/** What asked for a tick (§16.1, §16.2). */
export type SchedulerKickSource =
  /** An event arrived (§16.2 main path). */
  | 'event'
  /** The safety timer fired: the path that recovers missed events (§16.2). */
  | 'reconcile'
  /** The controller activated the scheduler (§16.1 startup). */
  | 'startup'

/** Every kick source. */
export const SCHEDULER_KICK_SOURCES: readonly SchedulerKickSource[] = Object.freeze([
  'event',
  'reconcile',
  'startup',
])

/**
 * One request for a tick.
 *
 * The identity fields are correlation only: the decision reads state, never the
 * event payload, which is what makes a reconcile able to recover an event that
 * was never delivered.
 */
export interface SchedulerKick {
  /** What asked for the tick. */
  readonly source: SchedulerKickSource
  /** Event that asked for it; present when {@link SchedulerKick.source} is `event`. */
  readonly event?: SchedulerEventType
  /** Workspace the event was about, when it named one. */
  readonly workspaceId?: WorkspaceId
  /** Task the event was about, when it named one. */
  readonly taskId?: TaskId
}

/**
 * Concurrency limits of the scheduler (§15).
 *
 * §15 states them beside the pools because they count different things:
 * {@link SchedulerLimits.maxAttempts} counts active attempts,
 * {@link SchedulerLimits.maxConcurrentLlm} counts model calls in flight, and
 * {@link SchedulerLimits.maxHeavyTools} counts heavy tools running at once.
 *
 * **Who enforces which.** §16.3 names pool and workspace capacity in the
 * assignment filter, and §15's counters are what each of them is counted *from*.
 * The scheduler creates attempts, so it reserves an attempt slot for every
 * admission and never lets the plan pass {@link SchedulerLimits.maxAttempts}.
 * It creates neither model calls nor tool runs: an attempt enters those phases
 * later and on its own (§18.2), so the two remaining ceilings are read as
 * **observed saturation** — the tick refuses to add work while such a resource is
 * already at its ceiling, and the runtime that starts the activity enforces the
 * ceiling itself. Reserving a model-call or heavy-tool slot per admission would
 * instead turn those two counters into attempt caps, which is not what §15
 * states: the §15 example (`maxAttempts: 8`, `maxConcurrentLlm: 4`,
 * `maxHeavyTools: 2`) describes phases of an attempt, not nested ceilings on how
 * many attempts may exist.
 *
 * `maxAttempts` here is the **concurrency** ceiling of §15. It is not the §30
 * `maxAttempts` budget limit of the same name, which bounds how many attempts
 * one task may ever admit and is checked by the §30 admission gate
 * (`@dsh-mywork/core` `decideBudgetAdmission`).
 */
export interface SchedulerLimits {
  /** Active attempts that may exist at once (§15 `maxAttempts`); reserved per admission. */
  readonly maxAttempts: number
  /** Model calls that may be in flight at once (§15 `maxConcurrentLlm`); read as observed saturation. */
  readonly maxConcurrentLlm: number
  /** Heavy tools that may run at once (§15 `maxHeavyTools`); read as observed saturation. */
  readonly maxHeavyTools: number
}

/** The §15 example limits, used when a deployment states none. */
export const DEFAULT_SCHEDULER_LIMITS: SchedulerLimits = Object.freeze({
  maxAttempts: 8,
  maxConcurrentLlm: 4,
  maxHeavyTools: 2,
})

/** Weighted-fair share of a pool one workspace holds (§16.4). */
export interface WorkspaceSchedulingLimits {
  /** Share of an admission round the workspace may take, relative to its peers. */
  readonly weight: number
  /** Attempts of the worker roles this workspace may run at once (§16.4). */
  readonly maxWorkers: number
}

/**
 * Policy a tick runs with.
 *
 * The pool names are policy rather than a closed enum because §14 names the
 * pools in configuration: a deployment that calls its worker pool something else
 * states it here instead of having the scheduler guess.
 */
export interface SchedulerPolicy {
  /** Pool worker attempts are drawn from (§14 `workers`). */
  readonly workerPool: string
  /** Pool review attempts are drawn from (§14 `reviewers`). */
  readonly reviewerPool: string
  /** Milliseconds of waiting that add one aging point (§16.3). */
  readonly agingStepMs: number
  /** Weight a workspace without a §16.4 entry gets. */
  readonly defaultWorkspaceWeight: number
  /** Interval of the safety reconcile timer (§16.2). */
  readonly reconcileIntervalMs: number
}

/** The policy a deployment that states nothing runs with. */
export const DEFAULT_SCHEDULER_POLICY: SchedulerPolicy = Object.freeze({
  workerPool: 'workers',
  reviewerPool: 'reviewers',
  agingStepMs: 300_000,
  defaultWorkspaceWeight: 1,
  reconcileIntervalMs: 60_000,
})

/** One durable identity the scheduler may assign work to (§13.3, §13.4). */
export interface SchedulerAgent {
  /** Durable identity. */
  readonly identity: AgentIdentity
  /** Role the identity is configured with. */
  readonly role: Role
  /** Blueprint the attempt would run; its `pool` decides where the work is drawn from. */
  readonly blueprint: AgentBlueprint
}

/** One agent instance that exists right now (§13.5, §15). */
export interface SchedulerInstanceObservation {
  /** Runtime handle of the instance. */
  readonly instanceId: AgentInstanceId
  /** Identity the instance was mounted from. */
  readonly agentId: AgentId
  /** Pool the instance was drawn from (§14). */
  readonly pool: string
  /** Role the instance runs as. */
  readonly roleId: RoleId
  /** Workspace the instance is working in. */
  readonly workspaceId: WorkspaceId
  /** Resource state deciding which §15 limits the instance charges. */
  readonly resource: ResourceState
}

/** The charge an admission would add to the §30 budget (§30, §53). */
export interface SchedulerCharge {
  /** Tokens the work is expected to spend. */
  readonly tokens?: BudgetAmount
  /** Cost the work is expected to spend. */
  readonly cost?: BudgetAmount
}

/** §30 state of one unit of work. */
export interface SchedulerWorkBudget {
  /** What the task's own scope consumed so far. */
  readonly consumption: BudgetConsumption
  /** What the admission would add; absent means the caller measured nothing. */
  readonly charge?: SchedulerCharge
}

/** One ready task the scheduler may admit, with the queue reading it has. */
export interface SchedulerTaskCandidate {
  /** Task as the Task Graph reports it; only `ready` tasks admit an attempt. */
  readonly task: Task
  /** Clock reading the task reached `ready`; the basis of aging (§16.3). */
  readonly readySince: EpochMs
  /** §30 state of the task. */
  readonly budget?: SchedulerWorkBudget
}

/**
 * One queued review the scheduler may assign (§18.3, §27).
 *
 * This is deliberately a scheduler reference rather than the full {@link Review}
 * aggregate. A queued review has no reviewer yet — choosing one is the decision
 * this scheduler is about to make — while the domain Review aggregate requires
 * the reviewer that owns an already-claimed review. Keeping only the identifiers
 * policy reads prevents a projection from fabricating a reviewer just to satisfy
 * the scheduler's input shape.
 */
export interface SchedulerReviewCandidate {
  /** Durable review identity in the review queue. */
  readonly reviewId: ReviewId
  /** Task whose settled attempt is being reviewed. */
  readonly taskId: TaskId
  /** Workspace of the task under review; the §31 boundary and the pool caps read it. */
  readonly workspaceId: WorkspaceId
  /** Identity that produced the attempt under review; a reviewer must differ (§31). */
  readonly producerAgentId?: AgentId
  /** Clock reading the review reached `queued`; the basis of aging (§16.3). */
  readonly readySince: EpochMs
  /** §30 state of the task the review belongs to. */
  readonly budget?: SchedulerWorkBudget
}

/** One workspace the scheduler may fill (§14, §16.2, §16.4, §30, §31). */
export interface SchedulerWorkspaceState {
  /** Workspace identifier. */
  readonly workspaceId: WorkspaceId
  /** Whether the workspace accepts new work (§16.2 `workspace.enabled`). */
  readonly enabled: boolean
  /**
   * Identities the team of this workspace rosters (§6.1, §13 `Team.agentIds`).
   *
   * When a workspace states its roster, an identity outside it is not scheduled
   * here — which is what makes the §16.3 workspace filter a check rather than a
   * restatement of the target workspace. Absent means the caller states no
   * roster, and then the filter is only {@link SchedulerWorkspaceState.enabled}:
   * the same convention §30 uses for a limit nobody declared.
   */
  readonly agentIds?: readonly AgentId[]
  /** Directory the workspace owns; the §31 boundary path checks resolve against it. */
  readonly root: string
  /** Harness file policy in force for the workspace (§31). */
  readonly harnessPolicy: HarnessPolicy
  /** Pool limits the workspace resolved (§14). */
  readonly pools: Readonly<Record<string, PoolLimits>>
  /** Per-role limits the workspace resolved (§14). */
  readonly roles: Readonly<Record<RoleId, RoleLimits>>
  /** Workspace-wide limits the workspace resolved (§14). */
  readonly limits?: Partial<WorkspaceLimits>
  /** Weighted-fair share of a pool (§16.4); absent means the policy default. */
  readonly scheduling?: WorkspaceSchedulingLimits
  /** §30 limits that govern an attempt of this workspace. */
  readonly budget: BudgetLimits
  /** Measured consumption of the scopes those limits read (§30). */
  readonly ledgers: readonly BudgetLedger[]
}

/** Everything one tick decides against. */
export interface SchedulerTickInput {
  /** Clock reading of the tick; the only source of time in the decision. */
  readonly nowMs: EpochMs
  /** What asked for the tick. */
  readonly kick: SchedulerKick
  /** Ready tasks, in the order the caller listed them. */
  readonly workers: readonly SchedulerTaskCandidate[]
  /** Queued reviews, in the order the caller listed them. */
  readonly reviews: readonly SchedulerReviewCandidate[]
  /** Instances that exist right now. */
  readonly instances: readonly SchedulerInstanceObservation[]
  /** Identities work may be assigned to. */
  readonly agents: readonly SchedulerAgent[]
  /** Workspaces the scheduler may fill. */
  readonly workspaces: readonly SchedulerWorkspaceState[]
  /** Model catalog as it was last observed; availability is read from it, never asked live. */
  readonly catalog: CatalogSnapshot
  /** §15 limits in force. */
  readonly limits: SchedulerLimits
  /** Policy the tick runs with. */
  readonly policy: SchedulerPolicy
}

/** Why one unit of work was not admitted by a tick. */
export type SchedulerSkipReason =
  /** No workspace state was observed for the task's workspace. */
  | 'workspace-unknown'
  /** The workspace is disabled (§16.2). */
  | 'workspace-disabled'
  /** The workspace rosters identities, and this one is not among them (§6.1, §16.3). */
  | 'agent-not-in-workspace'
  /** No agent of the pool the work needs exists. */
  | 'no-agent'
  /** No agent's role matches the role the task requires. */
  | 'role-mismatch'
  /** No agent's blueprint grants the capabilities its role contract requires. */
  | 'capability-unsatisfied'
  /** No agent's blueprint grants the permissions its role contract allows (§13.2, §31). */
  | 'contract-mismatch'
  /** Every eligible agent was refused by the security gate (§31). */
  | 'security-denied'
  /** No eligible agent has an available model route (§29, §62 item 7). */
  | 'route-unavailable'
  /** Every eligible agent was refused by the §30 budget gate. */
  | 'budget-refused'
  /** The pool has no free slot (§14). */
  | 'pool-capacity'
  /** The workspace has no free slot for this kind of work (§14). */
  | 'workspace-capacity'
  /** The role has no free slot (§14). */
  | 'role-capacity'
  /** No free active-attempt slot (§15 `maxAttempts`). */
  | 'attempt-limit'
  /** No free concurrent-LLM slot (§15 `maxConcurrentLlm`). */
  | 'llm-limit'
  /** No free heavy-tool slot (§15 `maxHeavyTools`). */
  | 'heavy-tool-limit'
  /** The reviewer is the identity that produced the reviewed attempt (§31). */
  | 'reviewer-not-independent'

/** Every skip reason, so a caller can enumerate what it must handle. */
export const SCHEDULER_SKIP_REASONS: readonly SchedulerSkipReason[] = Object.freeze([
  'workspace-unknown',
  'workspace-disabled',
  'agent-not-in-workspace',
  'no-agent',
  'role-mismatch',
  'capability-unsatisfied',
  'contract-mismatch',
  'security-denied',
  'route-unavailable',
  'budget-refused',
  'pool-capacity',
  'workspace-capacity',
  'role-capacity',
  'attempt-limit',
  'llm-limit',
  'heavy-tool-limit',
  'reviewer-not-independent',
])

/** Kind of work one admission carries. */
export type SchedulerWorkKind =
  /** An attempt of a ready task, drawn from the worker pool. */
  | 'worker'
  /** A review of a queued review, drawn from the reviewer pool (§27). */
  | 'review'

/** Ranking of one unit of work (§16.3), with the parts it was made of. */
export interface SchedulerRank {
  /** Priority the Task Graph records; absent counts as 0. */
  readonly priority: number
  /** Milliseconds the work has waited since it became admissible. */
  readonly agingMs: number
  /** Whole aging steps the wait is worth. */
  readonly agingBonus: number
  /** Priority plus aging; the value the work is ordered by. */
  readonly score: number
}

/** Counters one tick read and then decided against (§14, §15). */
export interface SchedulerOccupancy {
  /** Active attempts (§15 `maxAttempts`). */
  readonly activeAttempts: number
  /** Model calls in flight (§15 `maxConcurrentLlm`). */
  readonly llmCalls: number
  /** Heavy tools running (§15 `maxHeavyTools`). */
  readonly heavyTools: number
  /** Active instances per pool (§14). */
  readonly pools: Readonly<Record<string, number>>
  /** Active instances per role (§14). */
  readonly roles: Readonly<Record<RoleId, number>>
  /** Active instances per workspace, split by kind of work (§14). */
  readonly workspaces: Readonly<Record<WorkspaceId, WorkspaceOccupancy>>
}

/** Active instances of one workspace (§14). */
export interface WorkspaceOccupancy {
  /** Attempts of the worker roles. */
  readonly workers: number
  /** Attempts of the reviewer roles. */
  readonly reviewers: number
}

/** One admission a tick decided (§16.3). */
export interface SchedulerAdmission {
  /** Kind of work admitted. */
  readonly kind: SchedulerWorkKind
  /** Workspace the work belongs to. */
  readonly workspaceId: WorkspaceId
  /** Pool the identity was drawn from. */
  readonly pool: string
  /** Role the identity runs as. */
  readonly roleId: RoleId
  /** Identity the work is assigned to. */
  readonly agentId: AgentId
  /** Blueprint revision the attempt would run. */
  readonly blueprintId: BlueprintId
  /** Task the attempt is admitted for. */
  readonly taskId: TaskId
  /** Review being assigned; present on review admissions only. */
  readonly reviewId?: ReviewId
  /** Ranking the admission was made on. */
  readonly rank: SchedulerRank
  /** §30 scopes the admission charged, as the gate read them. */
  readonly budgetScopes: readonly BudgetScope[]
}

/** One unit of work a tick could not place, with the reason it stayed. */
export interface SchedulerDeferral {
  /** Kind of work deferred. */
  readonly kind: SchedulerWorkKind
  /** Workspace the work belongs to. */
  readonly workspaceId: WorkspaceId
  /** Task the work belongs to. */
  readonly taskId: TaskId
  /** Review that stayed queued; present on review deferrals only. */
  readonly reviewId?: ReviewId
  /** Why it was not admitted. */
  readonly reason: SchedulerSkipReason
  /** Ranking it would have been admitted on. */
  readonly rank: SchedulerRank
}

/** The deterministic result of one tick (§16.3). */
export interface SchedulerPlan {
  /** Clock reading of the tick. */
  readonly nowMs: EpochMs
  /** What asked for the tick. */
  readonly kick: SchedulerKick
  /** Admissions, in the order they were decided. */
  readonly admissions: readonly SchedulerAdmission[]
  /** Work that stayed where it was, with the reason. */
  readonly deferrals: readonly SchedulerDeferral[]
  /** Counters the tick read before admitting anything. */
  readonly occupancy: SchedulerOccupancy
  /** §15 limits the tick decided against. */
  readonly limits: SchedulerLimits
}
