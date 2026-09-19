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
  TeamId,
  WorkspaceId,
} from './ids.ts'

/**
 * What an agent is allowed to do in a workspace (§13.3).
 *
 * The first seven are the workspace-facing permissions of §13.3. The rest name
 * the remaining domains §31 requires runtime enforcement for, so one vocabulary
 * covers every operation a role can attempt: an operation that has no
 * permission here is an operation no role may perform (§31: enforcement, not
 * prompt).
 */
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
  /** Reach the network (§31 `network`). */
  | 'network'
  /** Call MCP servers and their tools (§31 `mcp`). */
  | 'mcp'
  /** Resolve a credential reference the harness owns (§31 `secrets`, never the secret itself). */
  | 'secrets.use'
  /** Move a task through its own transitions (§31 `task transitions`). */
  | 'task.transition'
  /** Reach a production environment (§31 `production`, gated by §28). */
  | 'production'

/** Every permission, so capability negotiation can enumerate them. */
export const PERMISSIONS: readonly Permission[] = Object.freeze([
  'workspace.read',
  'workspace.write',
  'shell',
  'tests',
  'git.read',
  'git.write',
  'review.approve',
  'network',
  'mcp',
  'secrets.use',
  'task.transition',
  'production',
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

/** Every reasoning effort, weakest first. */
export const REASONING_EFFORTS: readonly ReasoningEffort[] = Object.freeze(['low', 'medium', 'high'])

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

/**
 * Fields of {@link RoleContract}. The contract is a closed shape: a value that
 * carries anything else is refused, so a misspelled or smuggled field cannot
 * travel on a published revision.
 */
export const ROLE_CONTRACT_FIELDS: readonly string[] = Object.freeze([
  'purpose',
  'requiredCapabilities',
  'workflowPermissions',
  'prohibitedActions',
  'outputContract',
  'reviewContract',
])

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

/** Fields of {@link RoleStrategy}; like the contract, the strategy is a closed shape. */
export const ROLE_STRATEGY_FIELDS: readonly string[] = Object.freeze([
  'researchApproach',
  'strategyModules',
  'modelPolicy',
  'skillPolicy',
  'learningPolicy',
])

/** Fields of {@link ModelPolicy}. */
export const MODEL_POLICY_FIELDS: readonly string[] = Object.freeze(['preferred', 'fallback', 'escalation'])

/** Fields of {@link SkillPolicy}. */
export const SKILL_POLICY_FIELDS: readonly string[] = Object.freeze(['allowed', 'denied'])

/** Fields of {@link LearningPolicy}. */
export const LEARNING_POLICY_FIELDS: readonly string[] = Object.freeze(['strategyEvolution', 'memoryPromotion'])

/** Fields of {@link Role}. */
export const ROLE_FIELDS: readonly string[] = Object.freeze([
  'id',
  'contract',
  'contractRevision',
  'strategy',
  'strategyRevision',
])

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

/** Fields of {@link AgentBlueprint}. The blueprint is a closed shape (§13.3). */
export const AGENT_BLUEPRINT_FIELDS: readonly string[] = Object.freeze([
  'id',
  'revision',
  'roleId',
  'modelPolicy',
  'reasoning',
  'preset',
  'permissions',
  'skills',
  'pool',
])

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

/**
 * Fields that describe a live runtime handle and must never appear on the
 * durable identity (ADR-004: "Agent Identity долговечна; Session краткоживущая",
 * §13.4, §13.5). An identity keeps *references* to the sessions it used
 * ({@link AgentIdentity.sessionRefs}) and never the live handle itself, so the
 * runtime can be replaced without rewriting the employee.
 *
 * The identity is also a closed shape ({@link IDENTITY_FIELDS}): a field that is
 * neither one of those names nor one of these runtime names is refused, because
 * a denylist alone would let a differently named handle through.
 */
export const IDENTITY_RUNTIME_FIELDS: readonly string[] = Object.freeze([
  'attemptId',
  'instanceId',
  'runtime',
  'runtimeState',
  'session',
  'sessionId',
])

/**
 * Fields of {@link AgentIdentity} — exactly what §13.4 keeps on the durable
 * employee. A new §13.4 field is added to the interface and to this list
 * together; anything else on an identity is a contract violation.
 */
export const IDENTITY_FIELDS: readonly string[] = Object.freeze([
  'id',
  'name',
  'roleId',
  'blueprintId',
  'blueprintRevision',
  'status',
  'workspaceOverlays',
  'sessionRefs',
  'performanceRefs',
  'experienceRefs',
  'learningProvenance',
  'revision',
])

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

/** Limits of one elastic pool (§14). */
export interface PoolLimits {
  /** Instances kept warm while the pool is idle. */
  readonly minActive: number
  /** Instances the pool may run at once. */
  readonly maxActive: number
}

/** Additional concurrency limit of one role (§14). */
export interface RoleLimits {
  /** Instances of the role that may be active at once. */
  readonly maxActive: number
}

/** Limits the workspace imposes on top of the pools (§14). */
export interface WorkspaceLimits {
  /** Attempts of the worker roles that may run at once. */
  readonly maxWorkers: number
  /** Attempts of the reviewer roles that may run at once. */
  readonly maxReviewers: number
}

/**
 * Pool, role, and workspace limits (§14). They are configuration, not runtime
 * state: the pool enforcement itself reads them from the resolved
 * configuration of the workspace it fills.
 */
export interface PoolPolicies {
  /** Pools by name; §14 names `workers`, `reviewers`, `planners`, `optimizers`. */
  readonly pools: Readonly<Record<string, PoolLimits>>
  /** Per-role limits, keyed by role. */
  readonly roles: Readonly<Record<RoleId, RoleLimits>>
  /** Workspace-wide limits. */
  readonly workspace: WorkspaceLimits
}

/**
 * One team: the roster and the limits a workspace runs with (§6.1, §13, §14).
 * The team document names roles, blueprints, and durable identities; the
 * revisions themselves stay in the registry (§8, §35), so a team pins which
 * revision each role and blueprint is currently at.
 */
export interface Team {
  /** Team identifier; the resolved configuration names it. */
  readonly id: TeamId
  /** Human-readable name. */
  readonly name: string
  /** Immutable team revision; a changed roster publishes a new one. */
  readonly revision: Revision
  /** Roles the team runs. */
  readonly roleIds: readonly RoleId[]
  /** Blueprints the team may mount. */
  readonly blueprintIds: readonly BlueprintId[]
  /** Durable identities that belong to the team. */
  readonly agentIds: readonly AgentId[]
  /** Pool, role, and workspace limits (§14). */
  readonly limits: PoolPolicies
}
