/**
 * Runtime permission model (architecture §28, §31, §52, §60).
 *
 * §31 makes role permissions a runtime concern rather than a prompt
 * instruction, and lists the domains an operation can belong to. This module
 * carries the vocabulary for those domains, the table that decides which
 * {@link Permission} an operation needs, and the ceiling the harness policy in
 * force puts on that permission. The enforcement itself is pure domain logic in
 * `@dsh-mywork/core`.
 *
 * Two rules of §31 shape every table here:
 *
 * - a granted permission is a ceiling, never a suggestion: a role holds only
 *   what its blueprint grants, and an operation nobody granted is refused;
 * - the harness policy is a second ceiling: MyWork never authorizes an effect
 *   the harness sandbox would refuse anyway.
 * @module
 */

import type { AgentId, WorkspaceId } from './ids.ts'
import type { Permission } from './team.ts'

/** A domain §31 requires runtime enforcement for. */
export type OperationDomain =
  /** Reading and writing files. */
  | 'filesystem'
  /** Running commands. */
  | 'shell'
  /** Reaching the network. */
  | 'network'
  /** Calling MCP servers and tools. */
  | 'mcp'
  /** Using a credential the harness owns. */
  | 'secrets'
  /** Reading and writing git state. */
  | 'git'
  /** Moving a task through its transitions. */
  | 'task'
  /** Moving a review through its transitions. */
  | 'review'
  /** Reaching a production environment (§28 gate). */
  | 'production'

/** Every domain, in the order §31 lists them. */
export const OPERATION_DOMAINS: readonly OperationDomain[] = Object.freeze([
  'filesystem',
  'shell',
  'network',
  'mcp',
  'secrets',
  'git',
  'task',
  'review',
  'production',
])

/**
 * Permission each operation requires, keyed `"<domain>.<action>"`.
 *
 * The table is the whole authority of the gate: a request names a domain and an
 * action, and the required permission is looked up here rather than passed in by
 * the caller, so a caller cannot ask for a weaker permission than its operation
 * needs. A pair that is absent from this table is an operation the gate does not
 * know, and an unknown capability grants nothing (§31).
 */
export const OPERATION_PERMISSIONS: Readonly<Record<string, Permission>> = Object.freeze({
  'filesystem.read': 'workspace.read',
  'filesystem.write': 'workspace.write',
  'shell.execute': 'shell',
  'shell.test': 'tests',
  'network.invoke': 'network',
  'mcp.invoke': 'mcp',
  'secrets.use': 'secrets.use',
  'git.read': 'git.read',
  'git.write': 'git.write',
  'task.transition': 'task.transition',
  'review.approve': 'review.approve',
  'production.access': 'production',
})

/**
 * Operations that must name the path they touch.
 *
 * Without a path there is nothing to check, so a file operation that omits one
 * is refused rather than authorized: the boundary is enforced by the request,
 * not by the caller's willingness to be checked. `shell` is deliberately absent
 * — a command has no single path; its boundary is the harness policy plus the
 * working directory the runtime binds (MW-015).
 */
export const OPERATIONS_REQUIRING_PATH: readonly string[] = Object.freeze([
  'filesystem.read',
  'filesystem.write',
  'git.read',
  'git.write',
])

/**
 * Permissions whose effect the harness file sandbox governs.
 *
 * Network, MCP, secrets, task/review transitions and production are not file
 * effects, so the harness file policy neither grants nor withholds them; the
 * granted permission is what decides those.
 */
export const HARNESS_GOVERNED_PERMISSIONS: readonly Permission[] = Object.freeze([
  'workspace.read',
  'workspace.write',
  'shell',
  'tests',
  'git.read',
  'git.write',
])

/**
 * Policy the DeepSeek Harness file sandbox enforces for this session.
 *
 * The names are the harness's own modes; MyWork never widens them, it only
 * refuses earlier than the harness would.
 */
export type HarnessPolicy = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Every harness policy, from the narrowest to the widest. */
export const HARNESS_POLICIES: readonly HarnessPolicy[] = Object.freeze([
  'read-only',
  'workspace-write',
  'danger-full-access',
])

/**
 * What each harness policy can possibly allow (§31).
 *
 * A permission outside this ceiling is refused by the gate even when a role
 * holds it, because the harness would refuse the effect: authorizing it here
 * would be a promise the platform does not keep.
 */
export const HARNESS_POLICY_CEILING: Readonly<Record<HarnessPolicy, readonly Permission[]>> = Object.freeze({
  'read-only': Object.freeze(['workspace.read', 'git.read'] as const),
  'workspace-write': Object.freeze([
    'workspace.read',
    'workspace.write',
    'shell',
    'tests',
    'git.read',
    'git.write',
  ] as const),
  'danger-full-access': Object.freeze([...HARNESS_GOVERNED_PERMISSIONS]),
})

/**
 * A reference to a credential the harness owns, never the credential itself
 * (§31: a blueprint holds credential references, never secrets).
 *
 * The reference is opaque on purpose: which store resolves it is the harness's
 * business. What this contract fixes is the shape — a reference, and nothing
 * that could carry key material.
 */
export interface CredentialReference {
  /** Opaque, non-empty reference the harness resolves. */
  readonly ref: string
}

/** Fields of {@link CredentialReference}; the shape is closed. */
export const CREDENTIAL_REFERENCE_FIELDS: readonly string[] = Object.freeze(['ref'])

/**
 * An operation-specific gate of §28 that a human decides.
 *
 * The gate below never approves one of these on its own: it refuses them, so a
 * role cannot reach a release, a migration, or production by holding a
 * permission.
 */
export type HumanGate =
  /** Dependency upgrades. */
  | 'dependency-upgrade'
  /** Schema migrations. */
  | 'schema-migration'
  /** Security-relevant changes. */
  | 'security-change'
  /** Release. */
  | 'release'
  /** Production access. */
  | 'production-access'

/** Every §28 gate. */
export const HUMAN_GATES: readonly HumanGate[] = Object.freeze([
  'dependency-upgrade',
  'schema-migration',
  'security-change',
  'release',
  'production-access',
])

/** §28 gate an operation domain implies without being asked. */
export const DOMAIN_IMPLIED_GATES: Readonly<Partial<Record<OperationDomain, HumanGate>>> = Object.freeze({
  production: 'production-access',
})

/**
 * What §31 gives a reviewer by default: read the workspace, read the diff, run
 * the verification, approve — and never write the implementation it reviews.
 */
export const REVIEWER_DEFAULT_PERMISSIONS: readonly Permission[] = Object.freeze([
  'workspace.read',
  'git.read',
  'tests',
  'review.approve',
])

/**
 * Permissions that would let a reviewer change what it reviews. A reviewer
 * holding one of these is a configuration defect, not a wider reviewer (§31).
 */
export const IMPLEMENTATION_WRITE_PERMISSIONS: readonly Permission[] = Object.freeze([
  'workspace.write',
  'git.write',
  'shell',
])

/** Fields of an authorization context; the shape is closed. */
export const AUTHORIZATION_CONTEXT_FIELDS: readonly string[] = Object.freeze([
  'agentId',
  'permissions',
  'workspaceId',
  'workspaceRoot',
  'worktreeRoot',
  'harnessPolicy',
  'reviewer',
  'workerAgentId',
])

/** Fields of an operation request; the shape is closed. */
export const OPERATION_REQUEST_FIELDS: readonly string[] = Object.freeze([
  'domain',
  'action',
  'workspaceId',
  'path',
  'credential',
  'gate',
])

/**
 * Rights an operation may be bound to, resolved once and then frozen.
 *
 * The grant is what a blueprint was allowed to hand out — admission already
 * proved it stays inside the role contract (§13.2) — plus the workspace
 * boundary the attempt runs in (§52). Nothing in this shape can be filled in
 * from a prompt or a memory record: there is no field for either.
 */
export interface AuthorizationContext {
  /** Agent the grant belongs to. */
  readonly agentId: AgentId
  /** Permissions the blueprint granted. */
  readonly permissions: readonly Permission[]
  /** Workspace the grant is bound to. */
  readonly workspaceId: WorkspaceId
  /** Directory the workspace owns; path checks resolve against it. */
  readonly workspaceRoot: string
  /** Worktree of this attempt, when it has one; it must sit inside the workspace. */
  readonly worktreeRoot?: string
  /** Harness policy in force while this grant is used. */
  readonly harnessPolicy: HarnessPolicy
  /** True when the holder acts as the reviewer of {@link workerAgentId}'s work. */
  readonly reviewer?: boolean
  /** Worker whose implementation is under review; required to prove independence. */
  readonly workerAgentId?: AgentId
}

/** One operation an agent wants to perform. */
export interface OperationRequest {
  /** Domain the operation belongs to (§31). */
  readonly domain: OperationDomain
  /** Action inside that domain; `domain.action` must exist in {@link OPERATION_PERMISSIONS}. */
  readonly action: string
  /** Workspace the operation targets; it must be the workspace of the grant (§52). */
  readonly workspaceId: WorkspaceId
  /** Path the operation touches, when it touches one. */
  readonly path?: string
  /** Credential reference, required by `secrets.use` and refused elsewhere. */
  readonly credential?: CredentialReference
  /** §28 gate the caller declares for this operation. */
  readonly gate?: HumanGate
}

/** An operation the gate allowed. */
export interface AuthorizationDecision {
  /** Domain of the allowed operation. */
  readonly domain: OperationDomain
  /** Action of the allowed operation. */
  readonly action: string
  /** Permission the operation was authorized by. */
  readonly permission: Permission
  /** Workspace the operation stays inside. */
  readonly workspaceId: WorkspaceId
  /** Harness policy the decision was taken under. */
  readonly harnessPolicy: HarnessPolicy
  /** Path that was checked against the boundary; absent for operations that name none. */
  readonly path?: string
  /**
   * Root the path was checked against — the worktree when the attempt has one,
   * otherwise the workspace. A path alone does not say which file was
   * authorized, so the boundary travels with the decision.
   */
  readonly boundaryRoot?: string
}
