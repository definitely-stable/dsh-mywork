/**
 * Workspace configuration model (architecture §6, §52).
 *
 * A workspace is configured in one of three modes (§6) and resolves its
 * configuration through the §6.3 overlay chain. Whatever the mode, the runtime
 * overlay is workspace-scoped (§52), and the resolved state carries a
 * {@link ResolvedWorkspaceConfig.configRevision} — the identity a running
 * attempt freezes (§35).
 * @module
 */

import type { BlueprintId, Revision, RoleId, TeamId, WorkflowId, WorkspaceId } from './ids.ts'
import type { WorkspaceLimits } from './team.ts'
import type { WorkspaceSchedulingLimits } from './scheduler.ts'

/** Workspace configuration modes (§6, §62 item 4). */
export type WorkspaceConfigMode =
  /** The workspace uses the global Team, workflow, blueprints, memory routes, and pool policies (§6.1). */
  | 'global'
  /** The workspace owns independent Team Work, namespaces, workflow settings, agent revisions, and limits (§6.2). */
  | 'isolated'
  /** Platform → global → team → workflow → workspace → task (§6.3). */
  | 'inherit'

/** Every mode, in the order §62 lists them. */
export const WORKSPACE_CONFIG_MODES: readonly WorkspaceConfigMode[] = Object.freeze([
  'global',
  'isolated',
  'inherit',
])

/** Mode a workspace uses when it does not choose one (§6.3). */
export const DEFAULT_WORKSPACE_CONFIG_MODE: WorkspaceConfigMode = 'inherit'

/** One layer of the overlay chain (§6.3). */
export type ConfigLayer =
  /** Built-in defaults of the platform. */
  | 'platform-default'
  /** Global MyWork configuration. */
  | 'global'
  /** Team configuration. */
  | 'team'
  /** Workflow configuration. */
  | 'workflow'
  /** Overrides of one workspace. */
  | 'workspace'
  /** Overrides of one task. */
  | 'task'

/** The overlay chain, lowest precedence first (§6.3). */
export const CONFIG_LAYERS: readonly ConfigLayer[] = Object.freeze([
  'platform-default',
  'global',
  'team',
  'workflow',
  'workspace',
  'task',
])

/**
 * Layers a workspace authors. They are the ones §6.1 refuses to let a `global`
 * workspace use to fork the shared domains.
 */
export const WORKSPACE_AUTHORED_LAYERS: readonly ConfigLayer[] = Object.freeze(['workspace', 'task'])

/**
 * Namespaces §6.2 gives a workspace of its own. §52 keeps them apart per
 * workspace: a blueprint or role may be reused, a namespace may not.
 */
export interface WorkspaceNamespaces {
  /** Team Work namespace (§6.2). */
  readonly teamWork: string
  /** Beads/Task Graph namespace (§6.2). */
  readonly taskGraph: string
  /** Memory namespace (§6.2). */
  readonly memory: string
  /** Runtime instance/context/memory overlay; workspace-scoped in every mode (§52). */
  readonly runtime: string
}

/** Namespace keys, in the order §6.2 lists them. */
export const NAMESPACE_KEYS: readonly (keyof WorkspaceNamespaces)[] = Object.freeze([
  'teamWork',
  'taskGraph',
  'memory',
  'runtime',
])

/** A configuration domain one layer may carry. */
export type ConfigDomain =
  /** Team the workspace runs with. */
  | 'teamId'
  /** Workflow settings. */
  | 'workflowId'
  /** Role blueprints, pinned per blueprint. */
  | 'blueprints'
  /** Memory routes. */
  | 'memoryRoutes'
  /** Pool policies (§14). */
  | 'pools'
  /** Namespace overrides. */
  | 'namespaces'

/** Every configuration domain, in the order §6.1/§6.2 name them. */
export const CONFIG_DOMAINS: readonly ConfigDomain[] = Object.freeze([
  'teamId',
  'workflowId',
  'blueprints',
  'memoryRoutes',
  'pools',
  'namespaces',
])

/**
 * Domains §6.1 keeps global: in `global` mode the workspace layers may not
 * redefine them, because the workspace *uses* the global Team, workflow, Role
 * Blueprints, memory routes, and pool policies.
 */
export const GLOBAL_ONLY_CONFIG_DOMAINS: readonly ConfigDomain[] = Object.freeze([
  'teamId',
  'workflowId',
  'blueprints',
  'memoryRoutes',
  'pools',
])

/**
 * One pool limit as a layer may state it: a layer that changes only the ceiling
 * states only the ceiling, and the chain resolves the pair (§6.3, §14).
 */
export interface PoolLimitOverlay {
  /** Instances kept warm while the pool is idle. */
  readonly minActive?: number
  /** Instances the pool may run at once. */
  readonly maxActive?: number
}

/** Additional role limit as a layer may state it (§14). */
export interface RoleLimitOverlay {
  /** Instances of the role that may be active at once. */
  readonly maxActive?: number
}

/**
 * Pool policies of a layer or of a resolved configuration (§14). Unlike
 * {@link import('./team.ts').PoolPolicies}, which is the complete declaration a
 * team carries, every section of an overlay is optional: a workspace overrides
 * one limit and inherits the rest.
 */
export interface PoolPolicyOverlay {
  /** Pools by name; §14 names `workers`, `reviewers`, `planners`, `optimizers`. */
  readonly pools?: Readonly<Record<string, PoolLimitOverlay>>
  /** Per-role limits, keyed by role. */
  readonly roles?: Readonly<Record<RoleId, RoleLimitOverlay>>
  /** Workspace-wide limits. */
  readonly workspace?: Partial<WorkspaceLimits>
  /**
   * Weighted-fair share each workspace holds in the global pools (§16.4), keyed
   * by workspace. It lives in the `pools` domain because it is the same
   * scheduling policy §14 states, and the domain is global-only in `global`
   * mode: a workspace cannot weight itself against its peers.
   */
  readonly workspaceScheduling?: Readonly<Record<WorkspaceId, WorkspaceSchedulingLimits>>
}

/** Values one layer contributes (§6.3). */
export interface ConfigLayerValues {
  /** Team the workspace runs with (§6.1). */
  readonly teamId?: TeamId
  /** Workflow settings the workspace runs (§6.1). */
  readonly workflowId?: WorkflowId
  /** Revision each blueprint id is pinned to for this workspace (§13.3, §35). */
  readonly blueprints?: Readonly<Record<BlueprintId, Revision>>
  /** Memory routes (§6.1). */
  readonly memoryRoutes?: readonly string[]
  /** Pool policies (§14). */
  readonly pools?: PoolPolicyOverlay
  /** Namespace overrides; the mode decides which of them a layer may set (§6.2, §52). */
  readonly namespaces?: Partial<WorkspaceNamespaces>
}
/** One layer document: the revision of the document and the values it contributes. */
export interface ConfigLayerDocument {
  /** Layer the document belongs to. */
  readonly layer: ConfigLayer
  /** Revision of this document; a change publishes a new revision. */
  readonly revision: Revision
  /** Values the layer contributes. */
  readonly values: ConfigLayerValues
}

/**
 * Resolved configuration of one workspace (§6.3). Every field is the effective
 * value after the overlay chain, so a consumer never merges layers itself.
 */
export interface ResolvedWorkspaceConfig {
  /** Workspace the configuration was resolved for. */
  readonly workspaceId: WorkspaceId
  /** Mode the resolution ran in (§6). */
  readonly mode: WorkspaceConfigMode
  /** Revision identifying exactly this resolved state (§6.3, §35). */
  readonly configRevision: Revision
  /**
   * Canonical form of the resolved state the revision was minted for: two
   * resolutions with the same fingerprint are the same configuration state.
   */
  readonly fingerprint: string
  /** Layers that contributed at least one value, lowest precedence first. */
  readonly appliedLayers: readonly ConfigLayer[]
  /** Revision of each applied layer document. */
  readonly layerRevisions: Readonly<Partial<Record<ConfigLayer, Revision>>>
  /** Effective team, absent when no layer named one. */
  readonly teamId?: TeamId
  /** Effective workflow, absent when no layer named one. */
  readonly workflowId?: WorkflowId
  /** Effective blueprint pins; a blueprint absent here is not pinned. */
  readonly blueprints: Readonly<Record<BlueprintId, Revision>>
  /** Effective memory routes; empty when no layer named any. */
  readonly memoryRoutes: readonly string[]
  /** Effective pool policies, absent when no layer configured any. */
  readonly pools?: PoolPolicyOverlay
  /** Effective namespaces; the mode and §52 decide what may be overridden. */
  readonly namespaces: WorkspaceNamespaces
}
