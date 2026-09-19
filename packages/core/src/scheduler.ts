/**
 * Deterministic scheduler policy (architecture §14, §15, §16, §27, §30).
 *
 * §16.3 states the assignment function as one intersection followed by one
 * ranking, and §3.2 states who computes it: deterministic code, never a model.
 * This module is that computation. It is pure — it reads a
 * {@link SchedulerTickInput} and returns a {@link SchedulerPlan}, with the clock
 * reading handed in rather than read — so the same state always produces the
 * same admissions, and a test can pin that by calling it twice.
 *
 * Four rules are worth stating where they are implemented:
 *
 * - **Eligibility is a property of the work, capacity is a property of the
 *   moment.** A tick decides eligibility first and reports the reason of the
 *   first candidate it walked (the same convention `selectModelRoute` uses for
 *   §29), so "no agent can do this" and "there is no room right now" never get
 *   confused with each other.
 * - **Fairness is structural, not a score term.** §16.4 asks that one workspace
 *   cannot take a whole pool. A term in the §16.3 score cannot bound a share, so
 *   the bound is a weighted admission round: each workspace may take
 *   `weight` admissions per cycle, and the cycles repeat while anything moved.
 * - **An admission reserves the activity the scheduler itself creates.** A tick
 *   creates attempts, so it reserves an attempt slot per admission and never lets
 *   a plan pass `maxAttempts`. It creates neither model calls nor tool runs: an
 *   attempt enters those phases later and on its own, so `maxConcurrentLlm` and
 *   `maxHeavyTools` are read as **observed saturation** — the tick adds no work to
 *   a resource already at its ceiling, and the runtime that starts the activity
 *   enforces the ceiling itself (§18.2). Reserving them per admission would turn
 *   two phase counters into attempt caps, which §15 does not state.
 * - **Nothing here reads a port.** Model availability comes from an observed
 *   catalog snapshot, so a tick with nothing to do cannot call a provider or a
 *   model — which is what "sleeping/idle does not invoke an LLM" means in code.
 * @module
 */

import {
  DEFAULT_SCHEDULER_LIMITS,
  DEFAULT_SCHEDULER_POLICY,
  RESOURCE_STATE_CHARGES,
  type AgentId,
  type BudgetDecision,
  type BudgetLedger,
  type BudgetRequest,
  type BudgetScope,
  type CatalogSnapshot,
  type EpochMs,
  type ModelPolicy,
  type OperationMeta,
  type PoolLimits,
  type ResourceState,
  type RoleId,
  type SchedulerAdmission,
  type SchedulerAgent,
  type SchedulerDeferral,
  type SchedulerInstanceObservation,
  type SchedulerLimits,
  type SchedulerOccupancy,
  type SchedulerPlan,
  type SchedulerPolicy,
  type SchedulerRank,
  type SchedulerSkipReason,
  type SchedulerTickInput,
  type SchedulerWorkBudget,
  type SchedulerWorkKind,
  type SchedulerWorkspaceState,
  type TaskId,
  type WorkspaceId,
  type WorkspaceOccupancy,
} from '@dsh-mywork/contracts'
import { decideBudgetAdmission } from './budget.ts'
import { defineOperationMeta } from './guards.ts'
import { authorizeOperation } from './security.ts'
import { assertBlueprintWithinRoleContract } from './team.ts'

/**
 * Operation identity of a scheduling decision.
 *
 * A tick is not a domain mutation, so the identity exists only to satisfy the
 * pure gates it calls (`authorizeOperation`, `assertBlueprintWithinRoleContract`)
 * whose failure values carry one. Nothing in a plan is written under it.
 */
const TICK_META: OperationMeta = defineOperationMeta({ operationId: 'scheduler-tick', correlationId: 'scheduler' })

/** Why a §29 route could not be used for one candidate. */
export type RouteRefusal = 'invalid-route' | 'route-absent' | 'provider-outage'

/** Whether a candidate's model policy has a route the observed catalog can serve. */
export interface RouteAvailability {
  /** True when at least one candidate route is registered and not out of service. */
  readonly available: boolean
  /** Why the first candidate was unusable; present only when nothing was available. */
  readonly reason?: RouteRefusal
}

/** Input of {@link schedulerRank}. */
export interface SchedulerRankInput {
  /** Priority the Task Graph records; absent counts as 0 (§16.3). */
  readonly priority?: number
  /** Clock reading the work became admissible. */
  readonly readySince: EpochMs
  /** Clock reading of the tick. */
  readonly nowMs: EpochMs
  /** Milliseconds of waiting that add one aging point (§16.3). */
  readonly agingStepMs: number
}

/**
 * Resolve a partial scheduler policy against the defaults.
 *
 * An absent field takes {@link DEFAULT_SCHEDULER_POLICY}; a field that is present
 * but malformed is a programming error, because a policy that silently falls back
 * would schedule work under limits nobody stated.
 * @param partial - fields a deployment states.
 * @throws {TypeError} when a present field has the wrong type.
 */
export function resolveSchedulerPolicy(partial?: Partial<SchedulerPolicy>): SchedulerPolicy {
  if (partial === undefined) return DEFAULT_SCHEDULER_POLICY
  requireObject(partial, 'scheduler policy')
  for (const field of ['workerPool', 'reviewerPool'] as const) {
    const value = partial[field]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(`dsh-mywork: scheduler policy "${field}" must be a non-empty string`)
    }
  }
  for (const field of ['agingStepMs', 'defaultWorkspaceWeight', 'reconcileIntervalMs'] as const) {
    const value = partial[field]
    if (value === undefined) continue
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`dsh-mywork: scheduler policy "${field}" must be a positive integer`)
    }
  }
  return Object.freeze({
    workerPool: partial.workerPool ?? DEFAULT_SCHEDULER_POLICY.workerPool,
    reviewerPool: partial.reviewerPool ?? DEFAULT_SCHEDULER_POLICY.reviewerPool,
    agingStepMs: partial.agingStepMs ?? DEFAULT_SCHEDULER_POLICY.agingStepMs,
    defaultWorkspaceWeight: partial.defaultWorkspaceWeight ?? DEFAULT_SCHEDULER_POLICY.defaultWorkspaceWeight,
    reconcileIntervalMs: partial.reconcileIntervalMs ?? DEFAULT_SCHEDULER_POLICY.reconcileIntervalMs,
  })
}

/**
 * Resolve partial §15 limits against the defaults.
 *
 * A ceiling of `0` is a deliberate hard stop, not an absent limit — the same
 * rule the §30 limits use — so only `undefined` takes the default.
 * @param partial - limits a deployment states.
 * @throws {TypeError} when a present limit is not a non-negative integer.
 */
export function resolveSchedulerLimits(partial?: Partial<SchedulerLimits>): SchedulerLimits {
  if (partial === undefined) return DEFAULT_SCHEDULER_LIMITS
  requireObject(partial, 'scheduler limits')
  const resolved: SchedulerLimits = {
    maxAttempts: readCounter(partial.maxAttempts, 'maxAttempts', DEFAULT_SCHEDULER_LIMITS.maxAttempts),
    maxConcurrentLlm: readCounter(partial.maxConcurrentLlm, 'maxConcurrentLlm', DEFAULT_SCHEDULER_LIMITS.maxConcurrentLlm),
    maxHeavyTools: readCounter(partial.maxHeavyTools, 'maxHeavyTools', DEFAULT_SCHEDULER_LIMITS.maxHeavyTools),
  }
  return Object.freeze(resolved)
}

/**
 * Read whether a candidate's model policy has a usable route in an observed catalog.
 *
 * The check is deliberately data-only: the scheduler never calls a provider, a
 * catalog port, or a model. It walks `preferred` and `fallback` in policy order
 * and answers with the first candidate's refusal when nothing is usable, exactly
 * as §29 routing does. Escalation candidates are never considered — §62 item 7
 * keeps escalation opt-in per request, and a tick never asks for it.
 *
 * A model the catalog does not list is **not** unavailable: the catalog's model
 * list is advisory (§29), and a route that the provider itself would resolve
 * stays usable.
 * @param policy - routing policy of the candidate.
 * @param catalog - catalog as it was last observed.
 */
export function readRouteAvailability(policy: ModelPolicy, catalog: CatalogSnapshot): RouteAvailability {
  requireObject(policy, 'model policy')
  requireObject(catalog, 'catalog snapshot')
  const candidates = [policy.preferred, ...policy.fallback]
  let first: RouteRefusal | undefined
  for (const candidate of candidates) {
    const refusal = refusalOf(candidate, catalog)
    if (refusal === undefined) return Object.freeze({ available: true })
    first ??= refusal
  }
  return Object.freeze(first === undefined ? { available: false } : { available: false, reason: first })
}

/** Why one policy entry cannot be used, or `undefined` when it can. */
function refusalOf(candidate: string, catalog: CatalogSnapshot): RouteRefusal | undefined {
  const trimmed = typeof candidate === 'string' ? candidate.trim() : ''
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1 || /\s/.test(trimmed)) return 'invalid-route'
  const provider = trimmed.slice(0, slash)
  if (!catalog.providers.some(entry => entry.id === provider)) return 'route-absent'
  if (catalog.outages.some(entry => entry.provider === provider)) return 'provider-outage'
  return undefined
}

/**
 * Count what the observed instances charge (§14, §15).
 *
 * Only instances whose resource state takes a pool slot are counted at all:
 * `idle` and `sleeping` hold nothing, so a warm or sleeping instance never
 * consumes the capacity a tick is filling.
 * @param instances - instances that exist right now.
 * @param policy - policy naming the worker and reviewer pools.
 */
export function countSchedulerOccupancy(
  instances: readonly SchedulerInstanceObservation[],
  policy: SchedulerPolicy,
): SchedulerOccupancy {
  if (!Array.isArray(instances)) throw new TypeError('dsh-mywork: scheduler instances must be an array')
  const pools: Record<string, number> = {}
  const roles: Record<RoleId, number> = {}
  const workspaces: Record<WorkspaceId, WorkspaceOccupancy> = {}
  let activeAttempts = 0
  let llmCalls = 0
  let heavyTools = 0
  for (const instance of instances) {
    requireObject(instance, 'scheduler instance observation')
    const charge = RESOURCE_STATE_CHARGES[requireResourceState(instance.resource)]
    if (charge.llmSlot) llmCalls += 1
    if (charge.heavyToolSlot) heavyTools += 1
    if (!charge.poolSlot) continue
    if (charge.activeAttempt) activeAttempts += 1
    pools[instance.pool] = (pools[instance.pool] ?? 0) + 1
    roles[instance.roleId] = (roles[instance.roleId] ?? 0) + 1
    const current = workspaces[instance.workspaceId] ?? { workers: 0, reviewers: 0 }
    if (instance.pool === policy.workerPool) {
      workspaces[instance.workspaceId] = { workers: current.workers + 1, reviewers: current.reviewers }
    } else if (instance.pool === policy.reviewerPool) {
      workspaces[instance.workspaceId] = { workers: current.workers, reviewers: current.reviewers + 1 }
    }
  }
  return Object.freeze({
    activeAttempts,
    llmCalls,
    heavyTools,
    pools: Object.freeze(pools),
    roles: Object.freeze(roles),
    workspaces: Object.freeze(workspaces),
  })
}

/**
 * Rank one unit of work (§16.3): priority plus whole aging steps of waiting.
 *
 * `deadline`, `backlog pressure`, and `locality` are §16.3's remaining terms and
 * are deliberately absent: none of them has a field in the domain yet, and this
 * card implements `priority` + `aging` + workspace fairness.
 * @param input - priority, the two clock readings, and the aging step.
 */
export function schedulerRank(input: SchedulerRankInput): SchedulerRank {
  requireObject(input, 'scheduler rank input')
  const priority = input.priority ?? 0
  if (!Number.isSafeInteger(priority)) throw new TypeError('dsh-mywork: a task priority must be a safe integer')
  const agingMs = Math.max(0, input.nowMs - input.readySince)
  const agingBonus = input.agingStepMs <= 0 ? 0 : Math.floor(agingMs / input.agingStepMs)
  return Object.freeze({ priority, agingMs, agingBonus, score: priority + agingBonus })
}

/** One unit of work a tick is deciding about, normalized across both kinds. */
interface PendingWork {
  readonly kind: SchedulerWorkKind
  readonly workspaceId: WorkspaceId
  readonly taskId: TaskId
  readonly reviewId?: string
  readonly readySince: EpochMs
  readonly rank: SchedulerRank
  /** Role the task requires; workers only, absent means "any role of the pool". */
  readonly roleRequirement?: RoleId
  /** Identity that produced the attempt under review; reviews only (§31). */
  readonly producerAgentId?: AgentId
  readonly budget?: SchedulerWorkBudget
}

/**
 * What a tick has already promised inside itself.
 *
 * Only the capacities the tick fills are tracked here: pool, role, and workspace
 * slots (§14) and active attempts (§15 `maxAttempts`). Model calls and heavy
 * tools are phases an attempt enters after admission, so they are read from the
 * observation and never promised by a plan.
 */
interface PlannedCharge {
  attempts: number
  readonly pools: Map<string, number>
  readonly roles: Map<RoleId, number>
  readonly workspaces: Map<WorkspaceId, WorkspaceOccupancy>
}

/**
 * Decide one tick: the §16.3 assignment function over the state handed in.
 *
 * The result is frozen and totally ordered: admissions come out in the order the
 * weighted rounds decided them, and deferrals name the reason the work stayed.
 * The function reads nothing but its argument and calls nothing but pure policy,
 * so two calls with the same input produce the same plan.
 * @param input - the state, the limits, and the policy of the tick.
 * @throws {TypeError} when the input is not a scheduler tick.
 */
export function planSchedulerTick(input: SchedulerTickInput): SchedulerPlan {
  const tick = requireTickInput(input)
  const { nowMs, policy, limits } = tick
  const occupancy = countSchedulerOccupancy(tick.instances, policy)
  const workspaces = new Map<WorkspaceId, SchedulerWorkspaceState>()
  for (const workspace of tick.workspaces) workspaces.set(workspace.workspaceId, workspace)

  const admissions: SchedulerAdmission[] = []
  const deferrals: SchedulerDeferral[] = []
  const planned: PlannedCharge = { attempts: 0, pools: new Map(), roles: new Map(), workspaces: new Map() }

  for (const kind of ['worker', 'review'] as const) {
    const pending = new Map<WorkspaceId, PendingWork[]>()
    for (const item of kind === 'worker' ? workerWork(tick, nowMs) : reviewWork(tick, nowMs)) {
      const list = pending.get(item.workspaceId)
      if (list === undefined) pending.set(item.workspaceId, [item])
      else list.push(item)
    }
    for (const list of pending.values()) list.sort(compareWork)
    runFairRounds({ kind, pending, workspaces, tick, occupancy, planned, admissions, deferrals })
  }

  return Object.freeze({
    nowMs,
    kick: tick.kick,
    admissions: Object.freeze(admissions),
    deferrals: Object.freeze(deferrals),
    occupancy,
    limits,
  })
}

/** Admit work of one kind in weighted rounds across the workspaces that have some (§16.4). */
function runFairRounds(context: {
  readonly kind: SchedulerWorkKind
  readonly pending: Map<WorkspaceId, PendingWork[]>
  readonly workspaces: Map<WorkspaceId, SchedulerWorkspaceState>
  readonly tick: SchedulerTickInput
  readonly occupancy: SchedulerOccupancy
  readonly planned: PlannedCharge
  readonly admissions: SchedulerAdmission[]
  readonly deferrals: SchedulerDeferral[]
}): void {
  const { kind, pending, workspaces, tick, occupancy, planned, admissions, deferrals } = context
  const order = [...pending.keys()].sort(compareIds)
  /** Reason that stopped a workspace's own capacity, so its leftovers can name it. */
  const stoppedAt = new Map<WorkspaceId, SchedulerSkipReason>()
  let shared: SchedulerSkipReason | undefined
  let progressed = true

  while (progressed && shared === undefined) {
    progressed = false
    for (const workspaceId of order) {
      const list = pending.get(workspaceId)
      if (list === undefined || list.length === 0) continue
      const workspace = workspaces.get(workspaceId)
      const weight = workspace?.scheduling?.weight ?? tick.policy.defaultWorkspaceWeight
      let taken = 0
      while (taken < weight) {
        const item = list[0]
        if (item === undefined) break
        if (workspace === undefined) {
          deferrals.push(deferralOf(item, 'workspace-unknown'))
          list.shift()
          continue
        }
        if (!workspace.enabled) {
          deferrals.push(deferralOf(item, 'workspace-disabled'))
          list.shift()
          continue
        }
        const chosen = chooseAgent(item, kind, workspace, tick)
        if (chosen.agent === undefined) {
          deferrals.push(deferralOf(item, chosen.reason ?? 'no-agent'))
          list.shift()
          continue
        }
        const capacity = capacityRefusal(kind, workspace, chosen.agent, tick, occupancy, planned)
        if (capacity !== undefined) {
          stoppedAt.set(workspaceId, capacity)
          if (isSharedCapacity(capacity)) shared = capacity
          break
        }
        admissions.push(admit(item, kind, workspace, chosen.agent, chosen.scopes, planned))
        list.shift()
        taken += 1
        progressed = true
      }
      if (shared !== undefined) break
    }
  }

  for (const [workspaceId, list] of pending) {
    for (const item of list) {
      deferrals.push(deferralOf(item, shared ?? stoppedAt.get(workspaceId) ?? 'pool-capacity'))
    }
  }
}

/** Every ready task of the tick, ranked. */
function workerWork(tick: SchedulerTickInput, nowMs: EpochMs): readonly PendingWork[] {
  const work: PendingWork[] = []
  for (const candidate of tick.workers) {
    work.push({
      kind: 'worker',
      workspaceId: candidate.task.workspaceId,
      taskId: candidate.task.id,
      readySince: candidate.readySince,
      rank: schedulerRank({
        ...(candidate.task.priority === undefined ? {} : { priority: candidate.task.priority }),
        readySince: candidate.readySince,
        nowMs,
        agingStepMs: tick.policy.agingStepMs,
      }),
      ...(candidate.task.roleRequirement === undefined ? {} : { roleRequirement: candidate.task.roleRequirement }),
      ...(candidate.budget === undefined ? {} : { budget: candidate.budget }),
    })
  }
  return work
}

/** Every queued review of the tick, ranked. */
function reviewWork(tick: SchedulerTickInput, nowMs: EpochMs): readonly PendingWork[] {
  const work: PendingWork[] = []
  for (const candidate of tick.reviews) {
    work.push({
      kind: 'review',
      workspaceId: candidate.workspaceId,
      taskId: candidate.review.taskId,
      reviewId: candidate.review.id,
      readySince: candidate.readySince,
      rank: schedulerRank({ readySince: candidate.readySince, nowMs, agingStepMs: tick.policy.agingStepMs }),
      ...(candidate.producerAgentId === undefined ? {} : { producerAgentId: candidate.producerAgentId }),
      ...(candidate.budget === undefined ? {} : { budget: candidate.budget }),
    })
  }
  return work
}

/** What a tick found when it walked the candidate identities of one unit of work. */
interface AgentChoice {
  /** Identity the work goes to; absent when nobody could take it. */
  readonly agent?: SchedulerAgent
  /** Why nobody could take it; present exactly when {@link AgentChoice.agent} is absent. */
  readonly reason?: SchedulerSkipReason
  /** §30 scopes the admission charged; present with a chosen agent. */
  readonly scopes: readonly BudgetScope[]
}

/**
 * Walk the candidate identities of one unit of work in identity order.
 *
 * The reason reported when nobody passes is the reason of the **first** candidate
 * walked, the same diagnosis rule §29 routing uses: the first candidate's refusal
 * is the primary one, and a tick that reported the last one would hide it.
 */
function chooseAgent(
  item: PendingWork,
  kind: SchedulerWorkKind,
  workspace: SchedulerWorkspaceState,
  tick: SchedulerTickInput,
): AgentChoice {
  const pool = kind === 'worker' ? tick.policy.workerPool : tick.policy.reviewerPool
  const candidates = tick.agents
    .filter(candidate => candidate.blueprint.pool === pool)
    .sort((left, right) => compareIds(left.identity.id, right.identity.id))
  if (candidates.length === 0) return { reason: 'no-agent', scopes: Object.freeze([]) }

  let firstReason: SchedulerSkipReason | undefined
  for (const candidate of candidates) {
    const verdict = agentVerdict(item, kind, workspace, candidate, tick)
    if (verdict.reason === undefined) {
      return { agent: candidate, scopes: verdict.scopes }
    }
    firstReason ??= verdict.reason
  }
  return { reason: firstReason ?? 'no-agent', scopes: Object.freeze([]) }
}

/**
 * The gates one candidate identity must pass before it may take one unit of work.
 *
 * The workspace filter is checked here rather than left to the §31 gate: at
 * admission time no grant exists yet, so the gate is asked about the workspace
 * the attempt *would* run in — its `foreign-workspace` branch compares a grant
 * with the operation that uses it, which is a per-operation check downstream, not
 * a statement about the identity. What the scheduler can check is the roster: a
 * workspace that names the identities of its team (§6.1, §13) refuses work from
 * an identity outside it.
 */
function agentVerdict(
  item: PendingWork,
  kind: SchedulerWorkKind,
  workspace: SchedulerWorkspaceState,
  candidate: SchedulerAgent,
  tick: SchedulerTickInput,
): AgentChoice {
  const { identity, role, blueprint } = candidate
  if (workspace.agentIds !== undefined && !workspace.agentIds.includes(identity.id)) {
    return { reason: 'agent-not-in-workspace', scopes: Object.freeze([]) }
  }
  if (identity.roleId !== role.id || blueprint.roleId !== role.id) {
    return { reason: 'role-mismatch', scopes: Object.freeze([]) }
  }
  if (kind === 'worker' && item.roleRequirement !== undefined && role.id !== item.roleRequirement) {
    return { reason: 'role-mismatch', scopes: Object.freeze([]) }
  }
  // §13.2: the contract is the ceiling, and the required capabilities are the floor.
  const withinContract = assertBlueprintWithinRoleContract(role, blueprint, TICK_META)
  if (!withinContract.ok) return { reason: 'contract-mismatch', scopes: Object.freeze([]) }
  if (!role.contract.requiredCapabilities.every(capability => (blueprint.permissions as readonly string[]).includes(capability))) {
    return { reason: 'capability-unsatisfied', scopes: Object.freeze([]) }
  }
  // §31: the gate decides whether this grant may perform the operation, under the
  // harness policy in force — and for a reviewer it proves independence from the
  // worker whose attempt is reviewed. The grant is minted for the workspace the
  // attempt would run in; the boundary itself is enforced per operation, with a
  // real path, once the attempt holds a worktree.
  const gate = authorizeOperation(
    {
      agentId: identity.id,
      permissions: blueprint.permissions,
      workspaceId: workspace.workspaceId,
      workspaceRoot: workspace.root,
      harnessPolicy: workspace.harnessPolicy,
      ...(kind === 'review' ? { reviewer: true } : {}),
      ...(item.producerAgentId === undefined ? {} : { workerAgentId: item.producerAgentId }),
    },
    kind === 'worker'
      ? { domain: 'task', action: 'transition', workspaceId: workspace.workspaceId }
      : { domain: 'review', action: 'approve', workspaceId: workspace.workspaceId },
    TICK_META,
  )
  if (!gate.ok) {
    // The gate's own reason decides which refusal this is: a reviewer that may
    // not approve because it wrote the work is a §31 independence failure, while
    // a grant that simply lacks the permission is an ordinary denial.
    const denial = gate.error.details.reason
    const independence = denial === 'self-approval' || denial === 'unverifiable-independence' || denial === 'reviewer-write-grant'
    return { reason: kind === 'review' && independence ? 'reviewer-not-independent' : 'security-denied', scopes: Object.freeze([]) }
  }
  // §29: a candidate with no usable route is not a candidate.
  if (!readRouteAvailability(blueprint.modelPolicy, tick.catalog).available) {
    return { reason: 'route-unavailable', scopes: Object.freeze([]) }
  }
  const budget = budgetVerdict(item, kind, workspace)
  if (!budget.admitted) return { reason: 'budget-refused', scopes: Object.freeze([]) }
  return { scopes: budget.scopes }
}

/** Run the §30 admission gate of one unit of work, with the scopes it read. */
function budgetVerdict(
  item: PendingWork,
  kind: SchedulerWorkKind,
  workspace: SchedulerWorkspaceState,
): { readonly admitted: boolean; readonly scopes: readonly BudgetScope[] } {
  const request: BudgetRequest = {
    kind: kind === 'worker' ? 'attempt' : 'review-loop',
    ...(item.budget?.charge?.tokens === undefined ? {} : { tokens: item.budget.charge.tokens }),
    ...(item.budget?.charge?.cost === undefined ? {} : { cost: item.budget.charge.cost }),
  }
  const ledgers: BudgetLedger[] = [
    ...(item.budget === undefined ? [] : [{ scope: 'task' as const, consumption: item.budget.consumption }]),
    ...workspace.ledgers,
  ]
  const decision: BudgetDecision = decideBudgetAdmission({ limits: workspace.budget, ledgers, request })
  if (decision.kind === 'refused') return { admitted: false, scopes: Object.freeze([]) }
  const scopes: BudgetScope[] = []
  for (const check of decision.checks) {
    if (!scopes.includes(check.scope)) scopes.push(check.scope)
  }
  return { admitted: true, scopes: Object.freeze(scopes) }
}

/**
 * Why the pool has no room for one more admission right now, or `undefined`.
 *
 * The ceilings are read with the boundary §30 uses: an admission is refused when
 * the counter has already reached the declared ceiling, so a ceiling of `0` is a
 * hard stop and a counter exactly on the ceiling admits nothing further.
 */
function capacityRefusal(
  kind: SchedulerWorkKind,
  workspace: SchedulerWorkspaceState,
  agent: SchedulerAgent,
  tick: SchedulerTickInput,
  occupancy: SchedulerOccupancy,
  planned: PlannedCharge,
): SchedulerSkipReason | undefined {
  const pool = kind === 'worker' ? tick.policy.workerPool : tick.policy.reviewerPool
  const poolCeiling = readPoolLimit(workspace.pools, pool)
  if (poolCeiling !== undefined && (occupancy.pools[pool] ?? 0) + (planned.pools.get(pool) ?? 0) >= poolCeiling) {
    return 'pool-capacity'
  }

  const current = occupancy.workspaces[workspace.workspaceId] ?? { workers: 0, reviewers: 0 }
  const promised = planned.workspaces.get(workspace.workspaceId) ?? { workers: 0, reviewers: 0 }
  const used = kind === 'worker' ? current.workers + promised.workers : current.reviewers + promised.reviewers
  const ceiling = kind === 'worker'
    ? tighterOf(workspace.limits?.maxWorkers, workspace.scheduling?.maxWorkers)
    : workspace.limits?.maxReviewers
  if (ceiling !== undefined && used >= ceiling) return 'workspace-capacity'

  const roleCeiling = workspace.roles[agent.role.id]?.maxActive
  if (roleCeiling !== undefined && (occupancy.roles[agent.role.id] ?? 0) + (planned.roles.get(agent.role.id) ?? 0) >= roleCeiling) {
    return 'role-capacity'
  }

  // §15 `maxAttempts` is the activity this tick creates, so the plan reserves it.
  if (occupancy.activeAttempts + planned.attempts >= tick.limits.maxAttempts) return 'attempt-limit'
  // §15 `maxConcurrentLlm` and `maxHeavyTools` count phases an attempt enters
  // after admission. The tick does not create them, so it reads the observation:
  // work is not added to a resource that is already at its ceiling, and the
  // runtime that starts the model call or the tool enforces the ceiling itself.
  if (occupancy.llmCalls >= tick.limits.maxConcurrentLlm) return 'llm-limit'
  if (occupancy.heavyTools >= tick.limits.maxHeavyTools) return 'heavy-tool-limit'
  return undefined
}

/** Whether a capacity reason is a ceiling every workspace shares. */
function isSharedCapacity(reason: SchedulerSkipReason): boolean {
  return reason === 'pool-capacity' || reason === 'attempt-limit' || reason === 'llm-limit' || reason === 'heavy-tool-limit'
}

/** Build one admission and charge it against the tick's own promises. */
function admit(
  item: PendingWork,
  kind: SchedulerWorkKind,
  workspace: SchedulerWorkspaceState,
  agent: SchedulerAgent,
  scopes: readonly BudgetScope[],
  planned: PlannedCharge,
): SchedulerAdmission {
  const pool = agent.blueprint.pool
  planned.attempts += 1
  planned.pools.set(pool, (planned.pools.get(pool) ?? 0) + 1)
  planned.roles.set(agent.role.id, (planned.roles.get(agent.role.id) ?? 0) + 1)
  const current = planned.workspaces.get(workspace.workspaceId) ?? { workers: 0, reviewers: 0 }
  planned.workspaces.set(
    workspace.workspaceId,
    kind === 'worker'
      ? { workers: current.workers + 1, reviewers: current.reviewers }
      : { workers: current.workers, reviewers: current.reviewers + 1 },
  )
  return Object.freeze({
    kind,
    workspaceId: workspace.workspaceId,
    pool,
    roleId: agent.role.id,
    agentId: agent.identity.id,
    blueprintId: agent.blueprint.id,
    taskId: item.taskId,
    ...(item.reviewId === undefined ? {} : { reviewId: item.reviewId }),
    rank: item.rank,
    budgetScopes: scopes,
  })
}

/** Build one deferral. */
function deferralOf(item: PendingWork, reason: SchedulerSkipReason): SchedulerDeferral {
  return Object.freeze({
    kind: item.kind,
    workspaceId: item.workspaceId,
    taskId: item.taskId,
    ...(item.reviewId === undefined ? {} : { reviewId: item.reviewId }),
    reason,
    rank: item.rank,
  })
}

/**
 * Total order of two units of work inside one workspace (§16.3).
 *
 * Score first (higher wins), then the longer wait, then the identifier, so the
 * order is total and does not depend on the order the caller listed the work in.
 */
function compareWork(left: PendingWork, right: PendingWork): number {
  if (left.rank.score !== right.rank.score) return right.rank.score - left.rank.score
  if (left.readySince !== right.readySince) return left.readySince - right.readySince
  return compareIds(keyOf(left), keyOf(right))
}

/** Stable identity of one unit of work, used as the final tie-break. */
function keyOf(item: PendingWork): string {
  return item.reviewId ?? item.taskId
}

/** Lexicographic order, independent of locale and of the platform collator. */
function compareIds(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** The tighter of two optional ceilings; a stated ceiling never widens another. */
function tighterOf(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return Math.min(left, right)
}

/** Declared `maxActive` of one pool, when the workspace declared the pool at all. */
function readPoolLimit(pools: Readonly<Record<string, PoolLimits>>, pool: string): number | undefined {
  const limits = pools[pool]
  return limits === undefined ? undefined : limits.maxActive
}

/** Validate the shape of a tick; a malformed tick is a programming error. */
function requireTickInput(input: SchedulerTickInput): SchedulerTickInput {
  requireObject(input, 'scheduler tick input')
  for (const field of ['workers', 'reviews', 'instances', 'agents', 'workspaces'] as const) {
    if (!Array.isArray(input[field])) throw new TypeError(`dsh-mywork: scheduler tick "${field}" must be an array`)
  }
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    throw new TypeError('dsh-mywork: scheduler tick "nowMs" must be a non-negative integer')
  }
  requireObject(input.kick, 'scheduler kick')
  requireObject(input.catalog, 'catalog snapshot')
  for (const workspace of input.workspaces) {
    requireObject(workspace, 'scheduler workspace state')
    const weight = workspace.scheduling?.weight
    if (weight !== undefined && (!Number.isSafeInteger(weight) || weight <= 0)) {
      throw new TypeError(
        `dsh-mywork: the §16.4 weight of workspace "${workspace.workspaceId}" must be a positive integer`,
      )
    }
    // The roster is a security-shaped filter, so a malformed one is refused
    // rather than coerced: a string would make `includes` a substring match and
    // admit an identity the workspace never rostered.
    const roster: unknown = workspace.agentIds
    if (roster !== undefined) {
      if (!Array.isArray(roster) || roster.some(id => typeof id !== 'string' || id.trim() === '')) {
        throw new TypeError(
          `dsh-mywork: the roster of workspace "${workspace.workspaceId}" must be an array of non-empty identity ids`,
        )
      }
    }
  }
  return Object.freeze({
    ...input,
    policy: resolveSchedulerPolicy(input.policy),
    limits: resolveSchedulerLimits(input.limits),
  })
}

/** Reject a value that is not a plain object. */
function requireObject(value: unknown, what: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`dsh-mywork: ${what} must be an object`)
  }
}

/** Read one optional counter, falling back to a default only when it is absent. */
function readCounter(value: number | undefined, field: string, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`dsh-mywork: scheduler limit "${field}" must be a non-negative integer`)
  }
  return value
}

/** Reject a value that is not one of §15's resource states. */
function requireResourceState(value: unknown): ResourceState {
  if (typeof value !== 'string' || !Object.hasOwn(RESOURCE_STATE_CHARGES, value)) {
    throw new TypeError(`dsh-mywork: "${String(value)}" is not a §15 resource state`)
  }
  return value as ResourceState
}
