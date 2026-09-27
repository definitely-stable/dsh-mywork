/**
 * Framework-free MyWork policy: the domain state machines (task, attempt,
 * review, agent instance), authority and concurrency guards, configuration
 * resolution, the controller lifecycle, the system clock, model routing (§29),
 * the budget gate (§30), and the deterministic scheduler policy (§14, §15, §16,
 * §27). Cordis-specific wiring lives in `@dsh-mywork/controller`, so everything
 * here is pure and directly unit-testable.
 * @module @dsh-mywork/core
 */

import type { ClockPort, ControllerInfo, ControllerStatus } from '@dsh-mywork/contracts'

/** Resolved controller configuration. */
export interface ControllerConfig {
  /** Write one lifecycle line per mount and stop to stderr. Default false. */
  readonly diagnostics: boolean
}

/** Defaults applied by {@link resolveControllerConfig}. */
export const DEFAULT_CONTROLLER_CONFIG: ControllerConfig = Object.freeze({ diagnostics: false })

/**
 * Resolve raw row configuration into a validated {@link ControllerConfig}.
 *
 * An absent config (`undefined`/`null`) resolves to the defaults; anything a
 * deployment can express in YAML but the controller does not understand fails
 * loud instead of being silently ignored.
 * @param raw - the row `config:` value the loader passed to `apply`.
 * @returns the resolved configuration.
 * @throws {TypeError} when a present field has the wrong type.
 */
export function resolveControllerConfig(raw: unknown): ControllerConfig {
  if (raw === undefined || raw === null) return DEFAULT_CONTROLLER_CONFIG
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`dsh-mywork: controller config must be an object, received ${describeValue(raw)}`)
  }
  const diagnostics = (raw as { diagnostics?: unknown }).diagnostics
  if (diagnostics === undefined) return DEFAULT_CONTROLLER_CONFIG
  if (typeof diagnostics !== 'boolean') {
    throw new TypeError(
      `dsh-mywork: controller config "diagnostics" must be a boolean, received ${describeValue(diagnostics)}`,
    )
  }
  return Object.freeze({ diagnostics })
}

/** Human-readable kind of a rejected configuration value. */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

/** Lifecycle state of one controller instance. */
export interface ControllerState {
  /** Current phase; `starting` exists only between construction and mount. */
  readonly phase: ControllerStatus
  /** Clock reading taken at mount, absent before the controller mounted. */
  readonly mountedAt?: number
  /** Clock reading taken at stop, absent while the controller is mounted. */
  readonly stoppedAt?: number
}

/** State of a controller instance that has not mounted yet. */
export function initialControllerState(): ControllerState {
  return { phase: 'starting' }
}

/**
 * Move a controller into the mounted phase.
 * @param state - state returned by {@link initialControllerState}.
 * @param nowMs - clock reading of the mount.
 * @throws {Error} when the controller was not in the starting phase.
 */
export function mountController(state: ControllerState, nowMs: number): ControllerState {
  if (state.phase !== 'starting') {
    throw new Error(`dsh-mywork: cannot mount a controller in phase "${state.phase}"`)
  }
  return { phase: 'mounted', mountedAt: nowMs }
}

/**
 * Move a controller into the stopped phase. Idempotent: stopping an already
 * stopped controller returns the same state.
 * @param state - current state.
 * @param nowMs - clock reading of the stop.
 */
export function stopController(state: ControllerState, nowMs: number): ControllerState {
  if (state.phase === 'stopped') return state
  return state.mountedAt === undefined
    ? { phase: 'stopped' }
    : { phase: 'stopped', mountedAt: state.mountedAt, stoppedAt: nowMs }
}

/**
 * Milliseconds the controller has been (or was) mounted.
 * @param state - current state.
 * @param nowMs - clock reading to measure against while still mounted.
 */
export function controllerUptimeMs(state: ControllerState, nowMs: number): number {
  if (state.mountedAt === undefined) return 0
  return Math.max(0, (state.stoppedAt ?? nowMs) - state.mountedAt)
}

/** Static controller identity reported through {@link ControllerInfo}. */
export interface ControllerMeta {
  /** Cordis service name the controller is published under. */
  readonly service: string
  /** Controller package version. */
  readonly version: string
  /** Bounded contexts the controller owns. */
  readonly boundedContexts: readonly string[]
}

/**
 * Build the immutable service snapshot for one lifecycle state.
 * @param state - current state.
 * @param meta - static identity of the controller.
 */
export function controllerInfo(state: ControllerState, meta: ControllerMeta): ControllerInfo {
  return Object.freeze({
    service: meta.service,
    version: meta.version,
    status: state.phase,
    mountedAt: state.mountedAt ?? 0,
    ...(state.stoppedAt === undefined ? {} : { stoppedAt: state.stoppedAt }),
    boundedContexts: meta.boundedContexts,
  })
}

/**
 * Diagnostic line written when the controller mounts (only with
 * `diagnostics: true`). The wording is a stable contract for operators and for
 * the profile verification script.
 * @param info - snapshot taken right after the mount.
 */
export function mountDiagnostic(info: ControllerInfo): string {
  return `dsh-mywork: controller mounted service=${info.service} version=${info.version} contexts=${info.boundedContexts.join(',')}`
}

/**
 * Diagnostic line written when the controller stops (only with
 * `diagnostics: true`).
 * @param info - snapshot taken right after the stop.
 * @param uptimeMs - mounted duration measured with the controller's clock.
 */
export function stopDiagnostic(info: ControllerInfo, uptimeMs: number): string {
  return `dsh-mywork: controller stopped service=${info.service} version=${info.version} uptimeMs=${Math.round(uptimeMs)}`
}

/** Error used when a pending {@link ClockPort.sleep} is cancelled. */
function abortedSleep(): Error {
  const error = new Error('dsh-mywork: sleep aborted')
  error.name = 'AbortError'
  return error
}

/** Clock backed by `Date.now()` and `setTimeout`. */
export const systemClock: ClockPort = {
  now: (): number => Date.now(),
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(abortedSleep())
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, Math.max(0, ms))
      function onAbort(): void {
        clearTimeout(timer)
        reject(abortedSleep())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  },
}

export { MyWorkError, isMyWorkError, ok, fail, type MyWorkErrorOptions } from './errors.ts'
export {
  assertControllerEpoch,
  assertFence,
  assertRevision,
  defineOperationMeta,
  freezeRevisions,
  isCounter,
  type OperationMetaInput,
} from './guards.ts'
export {
  assertWriteAuthority,
  authorityDomains,
  authorityOf,
  isProjectionDomain,
  mayWrite,
  primaryOwnerOf,
} from './authority.ts'
export {
  TASK_TRANSITIONS,
  admitAttempt,
  allowedTaskTransitions,
  assertTaskInvariants,
  canTransitionTask,
  isTaskTerminal,
  requiresActiveAttempt,
  transitionTask,
  type AttemptAdmission,
  type TaskTransition,
  type TaskTransitionCommand,
} from './task.ts'
export {
  ATTEMPT_FENCE_CHECKED_STATES,
  ATTEMPT_OWNERSHIP_LOSS_STATES,
  ATTEMPT_TRANSITIONS,
  allowedAttemptTransitions,
  canTransitionAttempt,
  isAttemptActive,
  isAttemptTerminal,
  transitionAttempt,
  type AttemptTransition,
  type AttemptTransitionCommand,
} from './attempt.ts'
export {
  REVIEW_STATES_REQUIRING_FINDINGS,
  REVIEW_TRANSITIONS,
  allowedReviewTransitions,
  assertReviewApprovalCurrent,
  assertReviewerIndependence,
  assertReviewerReadOnly,
  canTransitionReview,
  isReviewApprovalCurrent,
  isReviewTerminal,
  transitionReview,
  type ReviewTransition,
  type ReviewTransitionCommand,
} from './review.ts'
/** The D15 deny-only rule for automatic approvers (F-57, R-22). */
export {
  AUTO_REVIEW_ALLOWING_VERDICTS,
  AUTO_REVIEW_COMMANDS,
  AUTO_REVIEW_ESCALATION_GATE,
  AUTO_REVIEW_RULING_KINDS,
  assertAutoReviewCommand,
  ruleOnAutoReview,
  type AutoReviewRequest,
  type AutoReviewRuling,
} from './review.ts'
export {
  AGENT_INSTANCE_STATES_WITH_ATTEMPT,
  AGENT_INSTANCE_TRANSITIONS,
  allowedAgentInstanceTransitions,
  applyStrategyLearning,
  assertBlueprintWithinRoleContract,
  assertDurableIdentity,
  canTransitionAgentInstance,
  resolveAttemptRevisions,
  reviseBlueprint,
  reviseRoleContract,
  transitionAgentInstance,
  type AgentInstanceTransition,
  type AgentInstanceTransitionCommand,
  type AttemptAdmissionInput,
  type AttemptRevisionResolution,
  type BlueprintChange,
  type RoleStrategyLearning,
} from './team.ts'
export {
  canonicalForm,
  createConfigRevisionRegistry,
  resolveNamespaces,
  resolveWorkspaceConfig,
  type ConfigRevisionRegistry,
  type WorkspaceConfigResolution,
} from './config.ts'
export { assertWorkspaceLocalEdges, findDependencyCycle, type CycleEdge, type DependencyEdge, type GraphNode } from './graph.ts'
export {
  classifyPlanMutation,
  dependencySatisfiedBy,
  invertPlanSteps,
  isAdditiveOnly,
  isAtomicComposite,
  isEmptyPlanMutation,
  materializePlanPart,
  parsePlanExternalRef,
  planEdgeKey,
  planExternalRef,
  planMutationParts,
  planSteps,
  planTouchedTasks,
  resolvePlanEdges,
  resolvedEdgePair,
  reviewPlanMutation,
  splitPlanEdgeKey,
  validatePlanMutation,
  verifyPlanIntegrity,
  type PlanInversion,
  type PlanObservation,
  type PlanTaskSnapshot,
  type PlanVerificationInput,
} from './plan.ts'
export {
  deriveBlockerGates,
  gateIdOf,
  isFrozenBlocker,
  observeBlockerGates,
  openBlockerGates,
} from './blocker.ts'
export {
  assigneeOf,
  reconcileClaim,
  type ClaimReconciliationInput,
} from './claim.ts'
export { assertCredentialReference, authorizeOperation, isWithinRoot } from './security.ts'
export {
  applyDropIntent,
  assertSinglePlacement,
  boardOrdering,
  isOrderKey,
  isTaskZone,
  legalDropTargets,
  midpointKey,
  projectTaskZone,
  renumberKeys,
  resolveInsertion,
  taskStatesOfZone,
  zoneOfState,
  type BoardProjection,
  type InsertionResolution,
  type OrderedCard,
  type PlacementChange,
  type ProjectedZone,
} from './board.ts'
export { SURFACE_TARGETS, resolveSurfacePolicy, suppressesMotion, type SurfaceTarget } from './theme.ts'
export {
  formatModelRoute,
  parseModelRoute,
  readModelCatalog,
  routeModel,
  selectModelRoute,
  type CatalogOutage,
  type CatalogSnapshot,
  type ModelRouteSelection,
} from './routing.ts'
export {
  addAmounts,
  amountValue,
  chargeConsumption,
  decideBudgetAdmission,
  knownAmount,
  modelCallCost,
  modelRateOf,
  readCallTokens,
  unknownAmount,
  type BudgetCharge,
  type BudgetSettlement,
} from './budget.ts'
export {
  countSchedulerOccupancy,
  planSchedulerTick,
  readRouteAvailability,
  resolveSchedulerLimits,
  resolveSchedulerPolicy,
  schedulerRank,
  type RouteAvailability,
  type RouteRefusal,
  type SchedulerRankInput,
} from './scheduler.ts'
export {
  CONTEXT_DATA_FENCE,
  CONTEXT_DATA_FENCE_END,
  assembleContextPrompt,
  contextBucketOf,
  createContextSnapshotRevisionRegistry,
  decideContextAdmission,
  discoverContext,
  isInstructionContextClass,
  isMandatoryContextClass,
  isTrustedContextCandidate,
  materializeContextSnapshot,
  resolveContextBudget,
  verifyContextSnapshot,
  type ContextAdmissionDecision,
  type ContextAdmissionInput,
  type ContextBudgetInput,
  type ContextDiscovery,
  type ContextDiscoveryInput,
  type ContextMaterializationInput,
  type ContextProviderBinding,
  type ContextProviderObservation,
  type ContextRefusal,
  type ContextSnapshotDecision,
  type ContextSnapshotRevisionRegistry,
  type ContextVerification,
  type ContextVerificationInput,
} from './context.ts'
export {
  DEFAULT_SKILL_LEVEL,
  DEFAULT_SKILL_SOURCE,
  SKILL_CLASS,
  checkSkillActivation,
  createSkillContextProvider,
  createSkillRegistry,
  createSkillRevisionRegistry,
  isAllowedSkillTransition,
  serveRefusal,
  skillCoversScopes,
  skillRequirementUnmet,
  skillTransitionTargets,
  skillUri,
  type SkillActivationDecision,
  type SkillActivationInput,
  type SkillContextProvider,
  type SkillContextProviderOptions,
  type SkillDiscoveryInput,
  type SkillRegistryOptions,
} from './skill.ts'
export {
  DEFAULT_MEMORY_LEVEL,
  DEFAULT_MEMORY_SOURCE,
  MEMORY_CLASS,
  MEMORY_MEDIA_TYPE,
  createMemoryContextProvider,
  createMemoryFabric,
  createMemoryRevisionRegistry,
  memoryClaimKey,
  memoryServeRefusal,
  memoryTextOf,
  type MemoryContextProvider,
  type MemoryContextProviderOptions,
  type MemoryFabricOptions,
  type MemoryServing,
  type MemoryServingInput,
} from './memory.ts'
export {
  applyReduction,
  applyWindowPressure,
  buildCheckpointCapsule,
  cheaperContextLevel,
  checkpointSession,
  compactWindow,
  createSessionWindow,
  decideContextPressure,
  dematerializeWindow,
  freshSessionFor,
  freshSessionPlan,
  nextWindowOrdinal,
  offloadWindow,
  pressureOf,
  pruneWindow,
  readContextPressure,
  rolloverSession,
  sameAttempt,
  type AppliedReduction,
  type CheckpointInput,
  type CheckpointSessionInput,
  type DemotedItem,
  type PressureOutcome,
  type ReductionOutcome,
  type RolloverInput,
  type RolloverOutcome,
  type SessionWindowInput,
} from './session.ts'
/** The §30 limits a deployment runs with until it states its own (F-52, D05). */
export {
  DEFAULT_BUDGET_LIMITS,
  budgetLimitsFrom,
  budgetOutcome,
  type BudgetOutcome,
} from './budget-defaults.ts'
/** The D15 worker tool surface: an allowlist derived from the §31 permission sets (F-56). */
export {
  WORKER_SURFACE_PERMISSIONS,
  WORKER_TOOL_ALLOWLIST,
  WORKER_TOOLS_BY_PERMISSION,
  applyWorkerSurface,
  workerToolAllowlist,
  workerTools,
  type WorkerSurfaceInput,
  type WorkerSurfaceReason,
  type WorkerSurfaceReport,
  type WorkerToolRestrictPort,
} from './worker-surface.ts'
/** The step circuit-breaker of one agent cycle (F-53, D05, RT-2). */
export { stepBudget, stepsOfNewAttempt, type StepBreakerInput } from './step-breaker.ts'
