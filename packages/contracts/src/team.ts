/**
 * Team Work domain (architecture §13): Role, Agent Blueprint, Agent Identity,
 * and the short-lived agent instance.
 *
 * The Role split follows §13.2: the {@link RoleContract} is never rewritten by
 * the optimizer, while the {@link RoleStrategy} is meant to evolve, so they
 * carry separate revisions.
 * @module
 */

import type {
  AgentId,
  AgentInstanceId,
  AttemptId,
  BlueprintId,
  EpochMs,
  Revision,
  RoleId,
  SessionId,
  SkillId,
  WorkspaceId,
} from './ids.ts'

/** What an agent is allowed to do in a workspace (§13.3). */
export type Permission =
  /** Read files in the workspace. */
  | 'workspace.read'
  /** Write files in the workspace. */
  | 'workspace.write'
  /** Run shell commands. */
  | 'shell'
  /** Run the project's test suites. */
  | 'tests'
  /** Read git history and diffs. */
  | 'git.read'
  /** Create branches, worktrees, and commits. */
  | 'git.write'
  /** Approve a review. A worker never holds this for its own attempt (§13.2). */
  | 'review.approve'

/** Every permission, so capability negotiation can enumerate them. */
export const PERMISSIONS: readonly Permission[] = Object.freeze([
  'workspace.read',
  'workspace.write',
  'shell',
  'tests',
  'git.read',
  'git.write',
  'review.approve',
])

/** Model routing policy (§13.1, §13.3). */
export interface ModelPolicy {
  /** Preferred model, e.g. `deepseek/flash`. */
  readonly preferred: string
  /** Models to try when the preferred one is unavailable. */
  readonly fallback: readonly string[]
  /** Models allowed when the work escalates. */
  readonly escalation: readonly string[]
}

/** Reasoning effort requested from the model. */
export type ReasoningEffort = 'low' | 'medium' | 'high'

/** How a role may use skills (§13.1). */
export interface SkillPolicy {
  /** Skills the role may load. */
  readonly allowed: readonly SkillId[]
  /** Skill namespaces the role must not load even when the registry offers them. */
  readonly denied: readonly string[]
}

/** What a role is allowed to learn (§13.1, §32, §33). */
export interface LearningPolicy {
  /** Whether the optimizer may rewrite this role's strategy. */
  readonly strategyEvolution: boolean
  /** Whether lessons from this role may be promoted to long-term memory. */
  readonly memoryPromotion: boolean
}

/** Immutable part of a role (§13.2). */
export interface RoleContract {
  /** What the role exists for. */
  readonly purpose: string
  /** Capabilities a blueprint must satisfy. */
  readonly requiredCapabilities: readonly string[]
  /** Permissions the role may hold. */
  readonly workflowPermissions: readonly Permission[]
  /** Actions the role must never take, e.g. "approve own work". */
  readonly prohibitedActions: readonly string[]
  /** What the role must hand over when it finishes. */
  readonly outputContract: string
  /** What the role expects from a review of its own work. */
  readonly reviewContract: string
}

/** Evolvable part of a role (§13.2). */
export interface RoleStrategy {
  /** How the role researches a task. */
  readonly researchApproach: readonly string[]
  /** Strategy modules the role loads. */
  readonly strategyModules: readonly string[]
  /** Evolvable routing baseline; a blueprint's {@link ModelPolicy} takes precedence. */
  readonly modelPolicy: ModelPolicy
  /** Skill usage policy. */
  readonly skillPolicy: SkillPolicy
  /** Learning policy. */
  readonly learningPolicy: LearningPolicy
}

/** One role: contract plus strategy, each with its own revision (§35). */
export interface Role {
  /** Role identifier. */
  readonly id: RoleId
  /** Immutable contract. */
  readonly contract: RoleContract
  /** Revision of {@link Role.contract}, immutable once published. */
  readonly contractRevision: Revision
  /** Evolvable strategy. */
  readonly strategy: RoleStrategy
  /** Revision of {@link Role.strategy}; the optimizer creates new ones. */
  readonly strategyRevision: Revision
}

/** Concrete configuration of a role (§13.3). */
export interface AgentBlueprint {
  /** Blueprint identifier. */
  readonly id: BlueprintId
  /** Immutable blueprint revision. */
  readonly revision: Revision
  /** Role the blueprint configures. */
  readonly roleId: RoleId
  /** Effective routing policy for this blueprint. */
  readonly modelPolicy: ModelPolicy
  /** Reasoning effort handed to the model. */
  readonly reasoning: ReasoningEffort
  /** DSH agent preset the instance is mounted from. */
  readonly preset: string
  /** Permissions granted to the instance. */
  readonly permissions: readonly Permission[]
  /** Skills the instance may load. */
  readonly skills: readonly SkillId[]
  /** Elastic pool the instance is drawn from (§14). */
  readonly pool: string
}

/** Durable agent identity: the "employee" (§13.4). */
export interface AgentIdentity {
  /** Identity identifier, e.g. `Neo-1`. */
  readonly id: AgentId
  /** Human-readable name. */
  readonly name: string
  /** Role the identity is associated with. */
  readonly roleId: RoleId
  /** Blueprint the identity is currently configured from. */
  readonly blueprintId: BlueprintId
  /** Blueprint revision the identity resolved; a later blueprint revision does not move it. */
  readonly blueprintRevision: Revision
  /** Durable status; mirrors the instance lifecycle (§13.5). */
  readonly status: AgentInstanceState
  /** Workspaces the identity has an overlay for. */
  readonly workspaceOverlays: readonly WorkspaceId[]
  /** Sessions this identity used. */
  readonly sessionRefs: readonly SessionId[]
  /** References to performance records; the learning stages own their shape. */
  readonly performanceRefs: readonly string[]
  /** References to experience records; the learning stages own their shape. */
  readonly experienceRefs: readonly string[]
  /** Where this identity's lessons came from. */
  readonly learningProvenance: readonly string[]
  /** Aggregate revision; every accepted identity change increments it. */
  readonly revision: Revision
}

/** Agent instance / runtime handle lifecycle state (§13.5). */
export type AgentInstanceState =
  /** No instance is mounted. */
  | 'sleeping'
  /** The instance is being mounted. */
  | 'waking'
  /** The instance is executing an attempt. */
  | 'running'
  /** The instance is winding down and flushing its result. */
  | 'settling'
  /** Terminal failure of this instance. */
  | 'failed'
  /** Terminal: the instance lost its lease or was replaced. */
  | 'revoked'
  /** Terminal: the instance was shut down. */
  | 'terminated'

/** Every agent instance state, in the order the architecture lists them. */
export const AGENT_INSTANCE_STATES: readonly AgentInstanceState[] = Object.freeze([
  'sleeping',
  'waking',
  'running',
  'settling',
  'failed',
  'revoked',
  'terminated',
])

/** States in which an instance holds resources. */
export const AGENT_INSTANCE_ACTIVE_STATES: readonly AgentInstanceState[] = Object.freeze([
  'waking',
  'running',
  'settling',
])

/**
 * One short-lived instance of an identity. Instances are runtime handles: they
 * are never stored on {@link AgentIdentity}, which is durable.
 */
export interface AgentInstance {
  /** Instance identifier. */
  readonly id: AgentInstanceId
  /** Durable identity the instance was mounted from. */
  readonly agentId: AgentId
  /** Attempt the instance is executing, once one is bound. */
  readonly attemptId?: AttemptId
  /** Current lifecycle state. */
  readonly state: AgentInstanceState
  /** Clock reading of the transition into {@link AgentInstance.state}. */
  readonly since: EpochMs
}
