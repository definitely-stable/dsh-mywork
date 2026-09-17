/**
 * Team Work domain (architecture §13): the agent instance lifecycle, the split
 * between the immutable role contract and the evolvable role strategy, blueprint
 * revisions, and the durable identity.
 *
 * An instance is a short-lived runtime handle: it wakes for one attempt, settles
 * it, and returns to sleep. The durable {@link AgentIdentity} is never mutated
 * by these transitions, which is what keeps a blueprint change from disturbing
 * running work (§35). The returned instance is a fully replaced value, so no
 * field is shared with the previous state.
 *
 * The learning boundary of §13.2 is structural: {@link applyStrategyLearning} is
 * the only change the optimizer can propose, and it refuses a contract payload,
 * while {@link reviseRoleContract} publishes a new contract revision outside the
 * learning loop.
 * @module
 */

import {
  AGENT_BLUEPRINT_FIELDS,
  IDENTITY_FIELDS,
  IDENTITY_RUNTIME_FIELDS,
  LEARNING_POLICY_FIELDS,
  MODEL_POLICY_FIELDS,
  PERMISSIONS,
  REASONING_EFFORTS,
  ROLE_CONTRACT_FIELDS,
  ROLE_FIELDS,
  ROLE_STRATEGY_FIELDS,
  SKILL_POLICY_FIELDS,
  type AgentBlueprint,
  type AgentIdentity,
  type AgentInstance,
  type AgentInstanceState,
  type AttemptId,
  type DomainEvent,
  type EpochMs,
  type FrozenRevisions,
  type OperationMeta,
  type ResolvedWorkspaceConfig,
  type Result,
  type Role,
  type RoleContract,
  type RoleStrategy,
} from '@dsh-mywork/contracts'
import { canonicalForm } from './config.ts'
import { MyWorkError, fail, ok } from './errors.ts'
import { freezeRevisions, isCounter } from './guards.ts'

/**
 * Allowed instance transitions (§13.5).
 *
 * - Cycle: `sleeping → waking → running → settling → sleeping`.
 * - Failure paths: every active state may fail, be revoked, or be terminated;
 *   those three states are terminal for the instance, and the next attempt
 *   mounts a new instance.
 */
export const AGENT_INSTANCE_TRANSITIONS: Readonly<Record<AgentInstanceState, readonly AgentInstanceState[]>> =
  Object.freeze({
    sleeping: ['waking', 'terminated'],
    waking: ['running', 'failed', 'revoked', 'terminated'],
    running: ['settling', 'failed', 'revoked', 'terminated'],
    settling: ['sleeping', 'failed', 'revoked', 'terminated'],
    failed: [],
    revoked: [],
    terminated: [],
  })

/** Instance states in which the instance still holds an attempt. */
export const AGENT_INSTANCE_STATES_WITH_ATTEMPT: readonly AgentInstanceState[] = Object.freeze([
  'running',
  'settling',
])

/** Command accepted by {@link transitionAgentInstance}. */
export interface AgentInstanceTransitionCommand {
  /** Target state. */
  readonly to: AgentInstanceState
  /** Attempt the instance takes over; required for `waking → running`. */
  readonly attemptId?: AttemptId | null
  /** Clock reading of the transition. */
  readonly at: EpochMs
}

/** Accepted transition: the next instance plus the events it produced. */
export interface AgentInstanceTransition {
  /** Instance after the transition. */
  readonly instance: AgentInstance
  /** State the instance was in. */
  readonly from: AgentInstanceState
  /** State the instance moved to. */
  readonly to: AgentInstanceState
  /** Events the transition produced, in order. */
  readonly events: readonly DomainEvent[]
}

/** Whether a transition between two states is allowed. */
export function canTransitionAgentInstance(from: AgentInstanceState, to: AgentInstanceState): boolean {
  return AGENT_INSTANCE_TRANSITIONS[from].includes(to)
}

/** States reachable from the given one, for diagnostics and pools. */
export function allowedAgentInstanceTransitions(from: AgentInstanceState): readonly AgentInstanceState[] {
  return AGENT_INSTANCE_TRANSITIONS[from]
}

/**
 * Move an agent instance to another state.
 *
 * The attempt binding is enforced here: an instance that runs or settles holds
 * the attempt it executes, and an instance that sleeps or terminates holds none.
 * @param instance - current instance.
 * @param command - target state, attempt binding, and clock reading.
 * @param meta - operation identity.
 */
export function transitionAgentInstance(
  instance: AgentInstance,
  command: AgentInstanceTransitionCommand,
  meta: OperationMeta,
): Result<AgentInstanceTransition> {
  if (!canTransitionAgentInstance(instance.state, command.to)) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: agent instance "${instance.id}" cannot move from "${instance.state}" to "${command.to}"`, {
        details: {
          instanceId: instance.id,
          from: instance.state,
          to: command.to,
          allowed: [...AGENT_INSTANCE_TRANSITIONS[instance.state]],
        },
      }),
      meta,
    )
  }

  const requested = normalizeAttemptId(command.attemptId)
  const attemptId = AGENT_INSTANCE_STATES_WITH_ATTEMPT.includes(command.to) ? (requested ?? instance.attemptId) : undefined

  if (AGENT_INSTANCE_STATES_WITH_ATTEMPT.includes(command.to) && attemptId === undefined) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: agent instance "${instance.id}" cannot move to "${command.to}" without an attempt`, {
        details: { instanceId: instance.id, to: command.to },
      }),
      meta,
    )
  }

  const built: AgentInstance = {
    id: instance.id,
    agentId: instance.agentId,
    state: command.to,
    since: command.at,
    ...(attemptId === undefined ? {} : { attemptId }),
  }
  const next = Object.freeze(built)

  const event: DomainEvent = Object.freeze({
    type: 'agent.instance.state.changed',
    payload: Object.freeze({
      instanceId: instance.id,
      agentId: instance.agentId,
      from: instance.state,
      to: command.to,
      ...(attemptId === undefined ? {} : { attemptId }),
      at: command.at,
    }),
  })

  return ok(
    Object.freeze({ instance: next, from: instance.state, to: command.to, events: Object.freeze([event]) }),
    meta,
  )
}

/** Treat an absent, null, or blank attempt reference as "no attempt". */
function normalizeAttemptId(value: AttemptId | null | undefined): AttemptId | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value
}

/**
 * Refuse an identity that is not the closed §13.4 shape.
 *
 * The durable identity keeps *references* to the sessions it used and to the
 * workspaces it has an overlay for; it never holds the attempt, the instance, or
 * the session it is running right now (ADR-004). Two checks enforce that, because
 * either one alone is escapable: the names in {@link IDENTITY_RUNTIME_FIELDS} are
 * refused even when they are absent from {@link IDENTITY_FIELDS}, and any field
 * outside {@link IDENTITY_FIELDS} is refused whatever it is called — a differently
 * named runtime handle cannot slip through a denylist.
 *
 * An undeclared field is a `Result` failure rather than a `TypeError` because an
 * identity is a value a store hands back: admission must answer with a typed
 * refusal, the same way it answers a blueprint that left its role contract.
 * @param identity - the identity about to be stored or resolved.
 * @param meta - operation identity.
 * @throws {TypeError} when the identity is not an object at all.
 */
export function assertDurableIdentity(identity: AgentIdentity, meta: OperationMeta): Result<AgentIdentity> {
  const record = requireObject(identity, 'an agent identity')
  for (const field of IDENTITY_RUNTIME_FIELDS) {
    if (record[field] === undefined) continue
    return fail(
      new MyWorkError(
        'CONTRACT_MISMATCH',
        `dsh-mywork: the durable identity of "${String(record.id)}" stores the runtime field "${field}"; an identity keeps references, never a live handle (ADR-004)`,
        { details: { agentId: record.id, field } },
      ),
      meta,
    )
  }
  for (const field of Object.keys(record)) {
    if (IDENTITY_FIELDS.includes(field)) continue
    return fail(
      new MyWorkError(
        'CONTRACT_MISMATCH',
        `dsh-mywork: the durable identity of "${String(record.id)}" carries "${field}", which is not part of the identity contract (§13.4); runtime and session belong to the attempt`,
        { details: { agentId: record.id, field, allowed: [...IDENTITY_FIELDS] } },
      ),
      meta,
    )
  }

  requireIdentifier(record.id, 'identity id')
  requireIdentifier(record.name, `name of identity "${String(record.id)}"`)
  requireIdentifier(record.roleId, `role of identity "${String(record.id)}"`)
  requireIdentifier(record.blueprintId, `blueprint of identity "${String(record.id)}"`)
  requireCounter(record.blueprintRevision, `blueprintRevision of identity "${String(record.id)}"`)
  requireCounter(record.revision, `revision of identity "${String(record.id)}"`)
  for (const field of ['workspaceOverlays', 'sessionRefs', 'performanceRefs', 'experienceRefs', 'learningProvenance']) {
    if (!Array.isArray(record[field])) {
      throw new TypeError(`dsh-mywork: identity "${String(record.id)}" must carry "${field}" as an array`)
    }
  }
  return ok(identity, meta)
}

/**
 * Check that a blueprint stays inside the role contract it configures (§13.2).
 *
 * The contract is the ceiling: a blueprint may grant fewer permissions than the
 * role allows, never more. This is what keeps a blueprint revision from widening
 * what the role is permitted to do, and it is re-checked at every admission, so
 * a contract narrowed after a blueprint was published refuses the blueprint
 * instead of silently keeping the old grant.
 * @param role - role the blueprint configures.
 * @param blueprint - blueprint about to be admitted.
 * @param meta - operation identity.
 * @throws {TypeError} when the role or the blueprint is malformed.
 */
export function assertBlueprintWithinRoleContract(
  role: Role,
  blueprint: AgentBlueprint,
  meta: OperationMeta,
): Result<AgentBlueprint> {
  const roleRecord = readRole(role)
  const record = readBlueprint(blueprint)
  const roleId = String(roleRecord.id)
  if (record.roleId !== roleRecord.id) {
    return fail(
      new MyWorkError(
        'CONTRACT_MISMATCH',
        `dsh-mywork: blueprint "${String(record.id)}" configures role "${String(record.roleId)}", not "${roleId}"`,
        { details: { blueprintId: record.id, blueprintRole: record.roleId, roleId: roleRecord.id } },
      ),
      meta,
    )
  }
  const allowed = (roleRecord.contract as RoleContract).workflowPermissions
  for (const permission of record.permissions) {
    if (allowed.includes(permission)) continue
    return fail(
      new MyWorkError(
        'SECURITY_DENIED',
        `dsh-mywork: blueprint "${String(record.id)}" grants "${permission}", which the contract of role "${roleId}" does not allow`,
        { details: { blueprintId: record.id, roleId: roleRecord.id, permission, allowed: [...allowed] } },
      ),
      meta,
    )
  }
  return ok(blueprint, meta)
}

/** Change the optimizer may propose for a role (§13.2). */
export interface RoleStrategyLearning {
  /** Strategy the learner proposes; the contract is never part of it. */
  readonly strategy: RoleStrategy
}

/**
 * Publish a new role strategy revision.
 *
 * This is the optimizer's only entry point, so it refuses any payload that
 * carries the contract — even as `{ contract: undefined }`, because the field
 * being present is what a smuggler relies on. Making the contract invisible to
 * learning is a v0.1 baseline ("auto-modification of security/RBAC contracts" is
 * a non-goal of §63), and a refuse is louder than ignoring the field.
 *
 * A strategy that canonically equals the current one publishes nothing: the
 * revision identifies a content, so an empty proposal does not consume a number.
 * @param role - role the learning applies to.
 * @param learning - proposed strategy.
 * @param meta - operation identity.
 * @throws {TypeError} when the role or the proposed strategy is malformed.
 */
export function applyStrategyLearning(role: Role, learning: RoleStrategyLearning, meta: OperationMeta): Result<Role> {
  const current = readRole(role)
  const change = requireObject(learning, 'a role strategy learning')
  for (const field of ['contract', 'contractRevision']) {
    if (!Object.hasOwn(change, field)) continue
    return fail(
      new MyWorkError(
        'SECURITY_DENIED',
        `dsh-mywork: the contract of role "${String(current.id)}" is not optimizable (§13.2); learning may only propose a strategy`,
        { details: { roleId: current.id, field } },
      ),
      meta,
    )
  }
  const strategy = readStrategy(change.strategy, `strategy of role "${String(current.id)}"`)
  if (canonicalForm(strategy) === canonicalForm(current.strategy)) {
    return ok(role, meta)
  }
  Object.freeze(role)
  const built: Role = {
    id: current.id,
    contract: current.contract,
    contractRevision: current.contractRevision,
    strategy: Object.freeze({ ...strategy }),
    strategyRevision: current.strategyRevision + 1,
  }
  return ok(Object.freeze(built), meta)
}

/**
 * Publish a new role contract revision (§35, §62 item 29).
 *
 * The contract is immutable, not frozen forever: a human or a reviewer publishes
 * the next revision. The strategy is carried over untouched, and the two
 * revisions never move together. Publishing the same contract twice is refused
 * as a no-op rather than minted as a revision, so a revision number always
 * identifies different content.
 * @param role - role being revised.
 * @param contract - the new contract.
 * @param meta - operation identity.
 * @throws {TypeError} when the role or the new contract is malformed.
 */
export function reviseRoleContract(role: Role, contract: RoleContract, meta: OperationMeta): Result<Role> {
  const current = readRole(role)
  const revised = readContract(contract, `contract of role "${String(current.id)}"`)
  if (canonicalForm(revised) === canonicalForm(current.contract)) {
    return ok(role, meta)
  }
  Object.freeze(role)
  const built: Role = {
    id: current.id,
    contract: Object.freeze({ ...revised }),
    contractRevision: current.contractRevision + 1,
    strategy: current.strategy,
    strategyRevision: current.strategyRevision,
  }
  return ok(Object.freeze(built), meta)
}

/** Change accepted by {@link reviseBlueprint}; the revision is minted, not supplied. */
export type BlueprintChange = Partial<Omit<AgentBlueprint, 'id' | 'revision'>>

/**
 * Publish the next revision of a blueprint (§35).
 *
 * The caller proposes fields; the revision is minted here, so two publishers
 * cannot hand out the same number for different content, and a proposal that
 * changes nothing publishes nothing. Publishing the successor freezes the
 * revision it supersedes, which turns the immutability §35 requires into a
 * runtime guarantee for the value the caller already handed out.
 * @param blueprint - blueprint being revised.
 * @param change - fields to replace; `id` and `revision` are refused.
 * @param meta - operation identity.
 * @throws {TypeError} when the blueprint or the change is malformed.
 */
export function reviseBlueprint(
  blueprint: AgentBlueprint,
  change: BlueprintChange,
  meta: OperationMeta,
): Result<AgentBlueprint> {
  const current = readBlueprint(blueprint)
  const patch = requireObject(change, 'a blueprint change')
  for (const field of ['id', 'revision']) {
    if (!Object.hasOwn(patch, field)) continue
    return fail(
      new MyWorkError(
        'CONTRACT_MISMATCH',
        `dsh-mywork: blueprint "${String(current.id)}" mints its own revision; the change may not supply "${field}"`,
        { details: { blueprintId: current.id, field } },
      ),
      meta,
    )
  }
  for (const field of Object.keys(patch)) {
    if (AGENT_BLUEPRINT_FIELDS.includes(field)) continue
    throw new TypeError(`dsh-mywork: a blueprint change carries unknown field "${field}"`)
  }

  const candidate = { ...blueprint, ...patch, revision: current.revision + 1 }
  const next = readBlueprint(candidate as AgentBlueprint)
  if (canonicalForm({ ...next, revision: current.revision }) === canonicalForm(current)) {
    return ok(blueprint, meta)
  }
  Object.freeze(blueprint)
  return ok(Object.freeze(next), meta)
}

/** Revisions one attempt resolves at admission (§35). */
export interface AttemptRevisionResolution {
  /** Revisions the attempt is frozen on for its whole lifetime. */
  readonly revisions: FrozenRevisions
  /** Durable identity, retargeted to the blueprint the attempt runs. */
  readonly identity: AgentIdentity
}

/** Input of {@link resolveAttemptRevisions}. */
export interface AttemptAdmissionInput {
  /** Durable identity the attempt belongs to. */
  readonly identity: AgentIdentity
  /** Role the identity is configured with. */
  readonly role: Role
  /** Blueprint resolution the attempt runs. */
  readonly blueprint: AgentBlueprint
  /** Resolved configuration of the workspace the attempt runs in. */
  readonly config: ResolvedWorkspaceConfig
}

/**
 * Freeze the revisions one attempt resolves when it is admitted (§35).
 *
 * The resolution happens once, at admission: the attempt then keeps these
 * revisions for its whole lifetime, so publishing a new blueprint revision
 * changes the *next* admission and leaves a running attempt on the revision it
 * started with. The identity is retargeted in the same step — it records the
 * blueprint and the workspace overlay of the run it is about to make — while the
 * runtime handle of that run stays on the attempt, never on the identity
 * (ADR-004).
 *
 * The blueprint is taken as handed in. A workspace that pins the blueprint in
 * its resolved configuration is enforced (`STALE_REVISION`), but an unpinned id
 * is trusted: which revision is the published one is known to the registry that
 * publishes blueprints, and this module has no registry yet.
 * @param input - identity, role, blueprint, and resolved workspace configuration.
 * @param meta - operation identity.
 * @throws {TypeError} when a value handed in is malformed.
 */
export function resolveAttemptRevisions(
  input: AttemptAdmissionInput,
  meta: OperationMeta,
): Result<AttemptRevisionResolution> {
  const record = requireObject(input, 'an attempt admission')
  const durable = assertDurableIdentity(record.identity as AgentIdentity, meta)
  if (!durable.ok) return fail(durable.error, meta)
  const identity = durable.value

  const role = readRole(record.role as Role)
  const blueprint = readBlueprint(record.blueprint as AgentBlueprint)
  const config = readResolvedConfig(record.config)

  if (identity.roleId !== role.id) {
    return fail(
      new MyWorkError(
        'CONTRACT_MISMATCH',
        `dsh-mywork: identity "${identity.id}" belongs to role "${identity.roleId}", not "${String(role.id)}"`,
        { details: { agentId: identity.id, identityRole: identity.roleId, roleId: role.id } },
      ),
      meta,
    )
  }

  const compatible = assertBlueprintWithinRoleContract(role, blueprint, meta)
  if (!compatible.ok) return fail(compatible.error, meta)

  const pinned = (config.blueprints ?? {})[blueprint.id]
  if (pinned !== undefined && pinned !== blueprint.revision) {
    return fail(
      new MyWorkError(
        'STALE_REVISION',
        `dsh-mywork: workspace "${config.workspaceId}" pins blueprint "${blueprint.id}" to revision ${pinned}, and admission was asked for revision ${blueprint.revision}`,
        { details: { workspaceId: config.workspaceId, blueprintId: blueprint.id, pinned, actual: blueprint.revision } },
      ),
      meta,
    )
  }

  const revisions = freezeRevisions(
    {
      config: config.configRevision,
      role: role.contractRevision,
      'role-strategy': role.strategyRevision,
      'agent-blueprint': blueprint.revision,
    },
    meta,
  )
  if (!revisions.ok) return fail(revisions.error, meta)

  const retargeted = retargetIdentity(identity, blueprint, config)
  return ok(Object.freeze({ revisions: revisions.value, identity: retargeted }), meta)
}

/**
 * Record on the durable identity which blueprint and workspace overlay the next
 * run uses. An admission that resolves the same pair leaves the identity alone,
 * so the revision counts accepted changes rather than admissions.
 *
 * The result is built field by field from {@link IDENTITY_FIELDS} rather than by
 * spreading the input, so nothing an identity was not allowed to carry can ride
 * along on the retarget.
 */
function retargetIdentity(
  identity: AgentIdentity,
  blueprint: AgentBlueprint,
  config: ResolvedWorkspaceConfig,
): AgentIdentity {
  const movesBlueprint = identity.blueprintId !== blueprint.id || identity.blueprintRevision !== blueprint.revision
  const movesWorkspace = !identity.workspaceOverlays.includes(config.workspaceId)
  if (!movesBlueprint && !movesWorkspace) return identity
  const built: AgentIdentity = {
    id: identity.id,
    name: identity.name,
    roleId: identity.roleId,
    blueprintId: blueprint.id,
    blueprintRevision: blueprint.revision,
    status: identity.status,
    workspaceOverlays: movesWorkspace
      ? Object.freeze([...identity.workspaceOverlays, config.workspaceId])
      : identity.workspaceOverlays,
    sessionRefs: identity.sessionRefs,
    performanceRefs: identity.performanceRefs,
    experienceRefs: identity.experienceRefs,
    learningProvenance: identity.learningProvenance,
    revision: identity.revision + 1,
  }
  return Object.freeze(built)
}

/** Validate a role value. */
function readRole(role: Role): Role {
  const record = requireObject(role, 'a role')
  requireClosedShape(record, ROLE_FIELDS, 'a role')
  const id = requireIdentifier(record.id, 'role id')
  const contract = readContract(record.contract, `contract of role "${id}"`)
  requireCounter(record.contractRevision, `contractRevision of role "${id}"`)
  const strategy = readStrategy(record.strategy, `strategy of role "${id}"`)
  requireCounter(record.strategyRevision, `strategyRevision of role "${id}"`)
  return { ...record, contract, strategy } as unknown as Role
}

/**
 * Validate a role contract value.
 *
 * A malformed contract is a `TypeError`: it is a shape a caller wrote, not a
 * value a store may hand back, so it fails before any revision is minted.
 */
function readContract(contract: unknown, field: string): RoleContract {
  const record = requireObject(contract, field)
  requireClosedShape(record, ROLE_CONTRACT_FIELDS, field)
  requireNonEmptyStrings(record.requiredCapabilities, `${field}.requiredCapabilities`)
  requireNonEmptyStrings(record.prohibitedActions, `${field}.prohibitedActions`)
  for (const key of ['purpose', 'outputContract', 'reviewContract']) {
    requireIdentifier(record[key], `${field}.${key}`)
  }
  if (!Array.isArray(record.workflowPermissions)) {
    throw new TypeError(`dsh-mywork: ${field}.workflowPermissions must be an array`)
  }
  for (const permission of record.workflowPermissions) {
    if (!PERMISSIONS.includes(permission as (typeof PERMISSIONS)[number])) {
      throw new TypeError(`dsh-mywork: ${field}.workflowPermissions carries unknown permission "${String(permission)}"`)
    }
  }
  return contract as RoleContract
}

/** Validate a role strategy value. */
function readStrategy(strategy: unknown, field: string): RoleStrategy {
  const record = requireObject(strategy, field)
  requireClosedShape(record, ROLE_STRATEGY_FIELDS, field)
  requireNonEmptyStrings(record.researchApproach, `${field}.researchApproach`)
  requireNonEmptyStrings(record.strategyModules, `${field}.strategyModules`)
  const modelPolicy = requireObject(record.modelPolicy, `${field}.modelPolicy`)
  requireClosedShape(modelPolicy, MODEL_POLICY_FIELDS, `${field}.modelPolicy`)
  requireIdentifier(modelPolicy.preferred, `${field}.modelPolicy.preferred`)
  requireNonEmptyStrings(modelPolicy.fallback, `${field}.modelPolicy.fallback`)
  requireNonEmptyStrings(modelPolicy.escalation, `${field}.modelPolicy.escalation`)
  const skillPolicy = requireObject(record.skillPolicy, `${field}.skillPolicy`)
  requireClosedShape(skillPolicy, SKILL_POLICY_FIELDS, `${field}.skillPolicy`)
  requireNonEmptyStrings(skillPolicy.allowed, `${field}.skillPolicy.allowed`)
  requireNonEmptyStrings(skillPolicy.denied, `${field}.skillPolicy.denied`)
  const learningPolicy = requireObject(record.learningPolicy, `${field}.learningPolicy`)
  requireClosedShape(learningPolicy, LEARNING_POLICY_FIELDS, `${field}.learningPolicy`)
  for (const key of ['strategyEvolution', 'memoryPromotion']) {
    if (typeof learningPolicy[key] !== 'boolean') {
      throw new TypeError(`dsh-mywork: ${field}.learningPolicy.${key} must be a boolean`)
    }
  }
  return strategy as RoleStrategy
}

/** Validate a blueprint value. */
function readBlueprint(blueprint: unknown): AgentBlueprint {
  const record = requireObject(blueprint, 'an agent blueprint')
  requireClosedShape(record, AGENT_BLUEPRINT_FIELDS, 'an agent blueprint')
  const id = requireIdentifier(record.id, 'blueprint id')
  requireIdentifier(record.roleId, `role of blueprint "${id}"`)
  requireIdentifier(record.preset, `preset of blueprint "${id}"`)
  requireIdentifier(record.pool, `pool of blueprint "${id}"`)
  requireCounter(record.revision, `revision of blueprint "${id}"`)
  if (!REASONING_EFFORTS.includes(record.reasoning as (typeof REASONING_EFFORTS)[number])) {
    throw new TypeError(`dsh-mywork: reasoning of blueprint "${id}" must be one of ${REASONING_EFFORTS.join(', ')}`)
  }
  if (!Array.isArray(record.permissions)) {
    throw new TypeError(`dsh-mywork: permissions of blueprint "${id}" must be an array`)
  }
  for (const permission of record.permissions) {
    if (!PERMISSIONS.includes(permission as (typeof PERMISSIONS)[number])) {
      throw new TypeError(`dsh-mywork: blueprint "${id}" carries unknown permission "${String(permission)}"`)
    }
  }
  requireNonEmptyStrings(record.skills, `skills of blueprint "${id}"`)
  const modelPolicy = requireObject(record.modelPolicy, `modelPolicy of blueprint "${id}"`)
  requireClosedShape(modelPolicy, MODEL_POLICY_FIELDS, `modelPolicy of blueprint "${id}"`)
  requireIdentifier(modelPolicy.preferred, `modelPolicy.preferred of blueprint "${id}"`)
  requireNonEmptyStrings(modelPolicy.fallback, `modelPolicy.fallback of blueprint "${id}"`)
  requireNonEmptyStrings(modelPolicy.escalation, `modelPolicy.escalation of blueprint "${id}"`)
  return blueprint as AgentBlueprint
}

/**
 * Reject a field the contract does not declare.
 *
 * Every contract of §13 is a closed shape, so a misspelled or smuggled field is a
 * loud `TypeError` instead of a value that travels on a published revision.
 * @param record - the value to check.
 * @param allowed - fields the shape declares.
 * @param field - human-readable name used in the error.
 * @throws {TypeError} when the value carries an undeclared field.
 */
function requireClosedShape(record: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(record)) {
    if (allowed.includes(key)) continue
    throw new TypeError(`dsh-mywork: ${field} carries unknown field "${key}"`)
  }
}

/** Require an array of non-empty strings. */
function requireNonEmptyStrings(value: unknown, field: string): void {
  if (!Array.isArray(value)) {
    throw new TypeError(`dsh-mywork: ${field} must be an array`)
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new TypeError(`dsh-mywork: ${field} must be non-empty strings`)
    }
  }
}

/** Require an object value. */
function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`dsh-mywork: ${field} must be an object`)
  }
  return value as Record<string, unknown>
}

/** Validate the parts of a resolved workspace configuration an admission reads. */
function readResolvedConfig(config: unknown): ResolvedWorkspaceConfig {
  const record = requireObject(config, 'a resolved workspace configuration')
  const workspaceId = requireIdentifier(record.workspaceId, 'workspaceId of the resolved configuration')
  requireCounter(record.configRevision, `configRevision of workspace "${workspaceId}"`)
  const blueprints = requireObject(record.blueprints ?? {}, `blueprints of workspace "${workspaceId}"`)
  for (const [id, revision] of Object.entries(blueprints)) {
    requireCounter(revision, `blueprint pin "${id}" of workspace "${workspaceId}"`)
  }
  return { ...record, workspaceId } as unknown as ResolvedWorkspaceConfig
}

/** Require a non-empty string. */
function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`dsh-mywork: ${field} must be a non-empty string`)
  }
  return value
}

/** Require a non-negative safe integer. */
function requireCounter(value: unknown, field: string): number {
  if (!isCounter(value)) {
    throw new TypeError(`dsh-mywork: ${field} must be a non-negative integer`)
  }
  return value
}
