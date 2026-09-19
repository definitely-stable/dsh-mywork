/**
 * Workflow-domain contracts that the plan-mutation path publishes (ADR026,
 * ADR028 §5.18).
 *
 * Two things live here because a *workflow* reads them rather than the planner:
 * the deterministic {@link PlanMutationClass} that the L3 auto-approval predicate
 * branches on, and the derived {@link BlockerResolutionGate} that turns a frozen
 * blocker into an explicit decision. ADR028 §5.18 assigns both to this module;
 * the declarative workflow revision itself is added by the workflow-engine card,
 * which appends to this file.
 * @module
 */

import type { ArtifactId, CorrelationId, EpochMs, TaskId, WorkspaceId } from './ids.ts'
import type { TaskState } from './task.ts'

/**
 * Deterministic classification of one plan mutation (ADR026).
 *
 * The architecture forbids deriving this from a model's judgement: the L3
 * predicate must be a pure function of the mutation and the graph, so the class
 * is computed rather than asked for.
 */
export type PlanMutationClass =
  /**
   * Every operation creates a task or an edge between two tasks this mutation
   * creates. Nothing that already exists is touched.
   */
  | 'additive-only'
  /** Some operation updates an existing task or wires an edge to one. */
  | 'modifying'
  /** Some operation removes an edge or moves a task to cancelled/superseded. */
  | 'destructive'

/** Every mutation class, from the mildest to the strongest. */
export const PLAN_MUTATION_CLASSES: readonly PlanMutationClass[] = Object.freeze([
  'additive-only',
  'modifying',
  'destructive',
])

/**
 * What an operator may decide about an open blocker gate (§5.5).
 *
 * `void` removes the edges through a staged mutation, `keep-blocking` accepts
 * that the dependents stay blocked and requires a reason, and
 * `supersede-dependent` replaces the dependents instead of waiting for them.
 */
export type BlockerResolutionAction =
  /** Remove the blocker→dependent edges and return the dependents to `ready`. */
  | 'void'
  /** Leave the edges in place; the reason is mandatory and goes to the audit. */
  | 'keep-blocking'
  /** Move the dependents to `superseded`. */
  | 'supersede-dependent'

/** Every gate action. */
export const BLOCKER_RESOLUTION_ACTIONS: readonly BlockerResolutionAction[] = Object.freeze([
  'void',
  'keep-blocking',
  'supersede-dependent',
])

/**
 * A decision about one blocker gate.
 *
 * The gate's *state* is derived from the graph, so this record is the only thing
 * persisted: it says who decided what, when, and why (§5.5).
 */
export interface BlockerResolutionDecision {
  /** Caller-owned identity of the decision. */
  readonly decisionId: string
  /** Workspace the gate belongs to. */
  readonly workspaceId: WorkspaceId
  /** Frozen task whose dependents are blocked. */
  readonly blockerTaskId: TaskId
  /** What was decided. */
  readonly action: BlockerResolutionAction
  /** Dependents the decision was taken about, as they were observed. */
  readonly dependents: readonly TaskId[]
  /** Why; mandatory for `keep-blocking`, kept otherwise when given. */
  readonly reason?: string
  /** Artifact holding the decision's detail, including the reason (§34). */
  readonly artifactId?: ArtifactId
  /**
   * Staged operation the action was carried out by, for `void` and
   * `supersede-dependent`: §5.5 requires the edges to be removed through a staged
   * mutation, and a decision should name the operation that did it.
   */
  readonly operationId?: string
  /** Who decided. */
  readonly decidedBy: string
  /** Clock reading of the decision. */
  readonly decidedAt: EpochMs
  /** Correlation of the workflow that produced it (§9). */
  readonly correlationId: CorrelationId
}

/**
 * A gate that is open exactly while a frozen blocker has an unsatisfied
 * dependent (§5.5).
 *
 * It is deliberately **not** a `HumanGate` from §28: it belongs to the edge level
 * of the domain model, and mixing it into the five shipping gates would tie
 * release policy to task cancellation.
 */
export interface BlockerResolutionGate {
  /** Stable identity: the workspace and the blocker whose dependents hang on it. */
  readonly gateId: string
  /** Workspace the gate belongs to. */
  readonly workspaceId: WorkspaceId
  /** Frozen blocker: a task in `cancelled` or `superseded` that others wait for. */
  readonly blockerTaskId: TaskId
  /** Dependents that are still blocked by it, in stable id order. */
  readonly dependents: readonly TaskId[]
  /** True while the derived condition holds: a frozen blocker with an unsatisfied dependent. */
  readonly open: boolean
  /**
   * True when the gate is open and no `keep-blocking` decision stands: a human
   * has not yet answered it.
   */
  readonly awaitingDecision: boolean
  /** Most recent decision recorded for this gate, when one exists. */
  readonly latestDecision?: BlockerResolutionDecision
}

/**
 * One dependent of a frozen blocker, as the derivation reads it.
 *
 * The derivation is pure and takes its input from the caller, so the gate can be
 * computed from a graph snapshot without a store.
 */
export interface BlockerGateDependent {
  /** Dependent task. */
  readonly taskId: TaskId
  /** Observed state of the dependent. */
  readonly state: TaskState
  /** True when the blocker→dependent edge is present in the graph. */
  readonly edgePresent: boolean
}

/** One frozen blocker with the dependents observed on it. */
export interface BlockerGateObservation {
  /** Workspace the observation belongs to. */
  readonly workspaceId: WorkspaceId
  /** Blocked task in a frozen state. */
  readonly blockerTaskId: TaskId
  /** Observed state of the blocker; `cancelled` or `superseded`. */
  readonly blockerState: TaskState
  /** Dependents observed on it. */
  readonly dependents: readonly BlockerGateDependent[]
}
