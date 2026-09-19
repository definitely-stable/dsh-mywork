/**
 * Plan mutation and replanning contracts (architecture §9, §10, §11; ADR024,
 * ADR026).
 *
 * §10.2 makes a structured {@link PlanMutationIntent} the *only* output of the
 * Task Setter, and §10.3 requires every existing task to be classified when the
 * requirements change. The adapter contract (`PlanMutationCommand`) describes the
 * graph operation; this module describes the intent around it — the plan revision
 * it was computed against, the policy that allows touching a running task, and
 * the journal a staged operation leaves behind when no single backend primitive
 * can apply it (ADR024).
 *
 * The classes that a *workflow* reads back — the mutation class used by the L3
 * predicate and the blocker-resolution gate — live in `./workflow.ts`, which is
 * where ADR028 §5.18 puts them.
 * @module
 */

import type {
  CorrelationId,
  EpochMs,
  OperationId,
  Revision,
  TaskId,
  WorkspaceId,
} from './ids.ts'
import type { PlanMutationCommand, TaskDependency } from './taskgraph.ts'
import type { PlanMutationClass } from './workflow.ts'

/**
 * What a policy decides about a task whose attempt is already running (§10.3).
 *
 * The four values are the whole catalog the architecture gives; a mutation that
 * touches a running task carries one of them explicitly, because §10.3 forbids
 * rewriting such a task silently.
 */
export type RunningTaskPolicy =
  /** Let the attempt finish on the task as it is; the task itself is not rewritten. */
  | 'continue'
  /** Cancel the work: the legal path is the `task.stop-and-cancel` composition (§5.4). */
  | 'cancel'
  /** Let the attempt finish and adapt afterwards, so nothing changes now. */
  | 'finish-then-adapt'
  /** A human decides before anything changes. */
  | 'require-human-decision'

/** Every running-task policy, in the order §10.3 lists them. */
export const RUNNING_TASK_POLICIES: readonly RunningTaskPolicy[] = Object.freeze([
  'continue',
  'cancel',
  'finish-then-adapt',
  'require-human-decision',
])

/**
 * Which command produced a mutation.
 *
 * §5.1 splits the planner from the replanner by *type*, not by convention: a
 * planner produces new work only, and changing an existing task is a separate
 * `ReplanCommand` with its own approval. `origin` is that split, carried where a
 * validator can enforce it.
 */
export type PlanMutationOrigin =
  /** The planner: additive only (create, and edges between the tasks it creates). */
  | 'planner'
  /** An explicit re-plan of existing work; may update, cancel and remove. */
  | 'replan'
  /** A {@link WorkProposal} accepted by the Task Setter or a lightweight policy. */
  | 'proposal'

/** Every mutation origin. */
export const PLAN_MUTATION_ORIGINS: readonly PlanMutationOrigin[] = Object.freeze([
  'planner',
  'replan',
  'proposal',
])

/**
 * One task a new plan revision moves to a target state (§10.3).
 *
 * `cancelled` and `superseded` are Task Graph states, so they are applied through
 * `TaskGraphPort.transition` rather than hidden inside a field update: the graph
 * owns the state, and a retirement expressed as metadata would be a silent
 * rewrite no verification could see. `ready` is the same mechanism used by the
 * blocker gate's `void` (§5.5), which releases a dependent whose blocker was
 * cancelled.
 */
export interface PlanRetirement {
  /** Task the revision moves. */
  readonly taskId: TaskId
  /** State the task must reach: a retirement, or the release a `void` performs. */
  readonly to: 'cancelled' | 'superseded' | 'ready'
  /** Why the revision moves it. */
  readonly reason?: string
}

/**
 * One plan mutation, with the context that decides whether it may run.
 *
 * `command.baseRevision` is the plan revision the caller computed against. The
 * backend cannot check it — Beads has no workspace-wide plan revision — so MyWork
 * owns the aggregate and refuses a mismatch with `STALE_REVISION` (§9, §10.1).
 */
export interface PlanMutationIntent {
  /** Workspace whose plan is being changed; cross-workspace edges are out of scope (§63). */
  readonly workspaceId: WorkspaceId
  /** The graph operation itself (§10.2: create / update / dependencies). */
  readonly command: PlanMutationCommand
  /** Which command produced it; decides whether existing tasks may be touched (§5.1). */
  readonly origin: PlanMutationOrigin
  /**
   * Policy for every task with an active attempt that this mutation touches
   * (§10.3). Absent means "no running task may be touched at all", which is the
   * fail-closed default.
   */
  readonly runningTaskPolicy?: RunningTaskPolicy
  /**
   * Refuse when the mutation cannot be applied as one atomic unit, instead of
   * staging it. A caller that must not accept a pause asks for this; the refusal
   * is `PLAN_MUTATION_STAGED` (ADR024: no emulated atomicity).
   */
  readonly requireAtomic?: boolean
  /** Proposal this mutation came from, when a workflow raised the work (§10.4). */
  readonly proposalId?: string
  /** Tasks this revision retires; the `cancelled`/`superseded` classes read it (§10.3). */
  readonly retire?: readonly PlanRetirement[]
}

/** How one existing task is classified by a new plan revision (§10.3). */
export type PlanChangeClass =
  /** The revision leaves the task exactly as it is. */
  | 'unchanged'
  /** Fields or dependencies of the task change. */
  | 'modified'
  /** The task is cancelled by the new revision. */
  | 'cancelled'
  /** A newer plan revision replaced the task. */
  | 'superseded'
  /** The revision creates the task. */
  | 'newly-created'

/** Every change class, in the order §10.3 lists them. */
export const PLAN_CHANGE_CLASSES: readonly PlanChangeClass[] = Object.freeze([
  'unchanged',
  'modified',
  'cancelled',
  'superseded',
  'newly-created',
])

/** Classification of one task under a candidate plan revision. */
export interface PlanChange {
  /** Task the classification is about; a caller-owned key when it is new. */
  readonly taskId: TaskId
  /** What the revision does to it. */
  readonly class: PlanChangeClass
  /**
   * What produced the class — field names, `dependency-added`,
   * `dependency-removed`. Recorded so a reviewer can see the reason instead of
   * re-deriving it from the mutation.
   */
  readonly reasons: readonly string[]
}

/**
 * What a validator established about one mutation, before it is applied.
 *
 * The review is the evidence an approver reads: the classes of every task, the
 * mutation class the L3 predicate branches on, and the edges the mutation intends
 * to add or remove.
 */
export interface PlanMutationReview {
  /** Plan revision the mutation was computed against. */
  readonly baseRevision: Revision
  /** Plan revision observed when the review was made. */
  readonly observedRevision: Revision
  /** Classification of every task the mutation knows about. */
  readonly changes: readonly PlanChange[]
  /** Class used by the autonomous-approval predicate (ADR026). */
  readonly mutationClass: PlanMutationClass
  /** Edges the mutation intends to add. */
  readonly addedDependencies: readonly TaskDependency[]
  /** Edges the mutation intends to remove. */
  readonly removedDependencies: readonly TaskDependency[]
  /** Ids of existing tasks with an active attempt that the mutation touches (§10.3). */
  readonly runningTasksTouched: readonly TaskId[]
}

/**
 * One separately applied part of a mutation.
 *
 * ADR024 applies "supported parts with their own atomic primitive, the
 * unsupported part as its own step". The split is what makes recovery honest: a
 * part either landed and was observed, or it did not.
 */
export type PlanMutationPartKind =
  /** Tasks the mutation creates. */
  | 'create'
  /** Edges the mutation adds and removes, applied together. */
  | 'edges'
  /** Field and metadata updates. */
  | 'fields'
  /** Tasks the revision retires, applied through `transition` (§10.3). */
  | 'retire'

/** A mutation split into the parts each primitive can carry. */
export interface PlanMutationPart {
  /** Which part this is. */
  readonly kind: PlanMutationPartKind
  /** Command handed to the task graph for this part; `retire` has none. */
  readonly command?: PlanMutationCommand
  /** Retirements this part applies, for the `retire` part. */
  readonly retire?: readonly PlanRetirement[]
}

/** Lifecycle of one staged plan mutation (ADR024). */
export type StagedPlanMutationState =
  /** Intent and admission pause are recorded; the graph is untouched. */
  | 'staged'
  /** Parts are being applied. */
  | 'applying'
  /** Every part landed, integrity verification passed, admission resumed. */
  | 'applied'
  /** Something did not match: the operator decides (ADR024, §5.2). */
  | 'recovery'
  /** The operator reverted the reversible steps; the graph is back. */
  | 'reverted'

/** Every staged-mutation state. */
export const STAGED_PLAN_MUTATION_STATES: readonly StagedPlanMutationState[] = Object.freeze([
  'staged',
  'applying',
  'applied',
  'recovery',
  'reverted',
])

/** What one recorded step of a staged mutation is. */
export type PlanStepKind =
  /** A task is created under a caller-owned key. */
  | 'create'
  /** Fields of an existing task change. */
  | 'update'
  /** An edge is added. */
  | 'add-edge'
  /** An edge is removed. */
  | 'remove-edge'
  /** A task is retired to `cancelled` or `superseded` (§10.3). */
  | 'retire'

/** State of one step, as observed rather than as assumed. */
export type PlanStepState =
  /** Not attempted yet. */
  | 'pending'
  /** Observed in the graph. */
  | 'applied'
  /** Attempted and not observed; the operation goes to recovery. */
  | 'failed'

/** One recorded step of a staged mutation. */
export interface PlanMutationStep {
  /** Position inside the operation; steps are applied in this order. */
  readonly seq: number
  /** Part this step belongs to. */
  readonly part: PlanMutationPartKind
  /** What the step does. */
  readonly kind: PlanStepKind
  /** Task id, task key, or edge key the step is about. */
  readonly ref: string
  /** Whether the step can be reverted by `revert` (§5.2). */
  readonly reversible: boolean
  /** How the step ended, as observed in the graph. */
  readonly state: PlanStepState
  /** Values the step replaced, so a revert can restore them. */
  readonly previous?: Readonly<Record<string, string>>
  /** Free-form detail for the operator: an adapter message, a reason. */
  readonly detail?: string
}

/**
 * The durable record of one staged plan mutation (ADR024 step 2).
 *
 * Written before the graph is touched and updated as parts land, so a crash
 * leaves the full intent next to the actual state — which is exactly what
 * "no partially visible DAG" requires.
 */
export interface StagedPlanMutation {
  /** Operation identity carried through the whole saga (§9). */
  readonly operationId: OperationId
  /** Workspace the mutation belongs to. */
  readonly workspaceId: WorkspaceId
  /** Correlation of the workflow that issued it (§9). */
  readonly correlationId: CorrelationId
  /** Plan revision the mutation was computed against. */
  readonly baseRevision: Revision
  /** Which command produced it. */
  readonly origin: PlanMutationOrigin
  /** Policy in force for running tasks, when one was declared. */
  readonly runningTaskPolicy?: RunningTaskPolicy
  /** Current state. */
  readonly state: StagedPlanMutationState
  /**
   * How the parts were applied, once they were: `atomic` only when every part went
   * through one backend primitive. Recorded so a repeated call can answer with the
   * same outcome instead of re-applying anything (ADR024).
   */
  readonly mode?: 'atomic' | 'staged'
  /** The full intent, so a recovery can show what was supposed to happen. */
  readonly intent: PlanMutationIntent
  /** Steps, in application order. */
  readonly steps: readonly PlanMutationStep[]
  /** Keys of created tasks mapped to their ids, as far as they are known. */
  readonly created: Readonly<Record<string, TaskId>>
  /** Last integrity report, when one was produced. */
  readonly report?: IntegrityReport
  /** Why the operation is in `recovery`, when it is. */
  readonly failure?: string
  /** Clock reading of the staging. */
  readonly stagedAt: EpochMs
  /** Clock reading of the last update. */
  readonly updatedAt: EpochMs
}

/**
 * Result of integrity verification (ADR024 step 4).
 *
 * It describes the *outcome* rather than the commands that ran: the graph is
 * re-read and compared with the intent, so a mutation that reported success while
 * an edge never landed ends in recovery instead of in success.
 */
export interface IntegrityReport {
  /** Operation the report is about. */
  readonly operationId: OperationId
  /** Workspace the mutation belongs to. */
  readonly workspaceId: WorkspaceId
  /** Plan revision the mutation was computed against. */
  readonly baseRevision: Revision
  /** Plan revision observed at verification time. */
  readonly observedRevision: Revision
  /** Intended edges that are absent from the graph. */
  readonly missing: readonly string[]
  /**
   * Intended removals whose edge is still in the graph.
   *
   * Kept apart from {@link IntegrityReport.unexpected} on purpose: while an
   * operation is unfinished a removal that has not run yet is *work left*, not a
   * contradiction — and a resume that could not tell the two apart would refuse to
   * finish a plan it is holding the whole intent for.
   */
  readonly pendingRemovals: readonly string[]
  /**
   * Edges between tasks this mutation touched that it never asked for — the graph
   * moving in a way the intent does not explain. This is what stops a resume.
   */
  readonly unexpected: readonly string[]
  /** Cycle found in the observed graph, as a path; absent when there is none. */
  readonly cycle?: readonly string[]
  /** Retirements that did not reach their target state, as `id=state`. */
  readonly stateMismatches: readonly string[]
  /** Created keys resolved to task ids, as observed. */
  readonly created: Readonly<Record<string, TaskId>>
  /** Created keys whose task id is unknown, with the external ref to look for. */
  readonly unresolvedCreates: readonly string[]
  /**
   * True only when the intent is fully realized with nothing foreign in the graph:
   * `missing`, `pendingRemovals`, `unexpected`, `stateMismatches` and
   * `unresolvedCreates` are all empty, there is no cycle, and the plan revision
   * did not move.
   */
  readonly verified: boolean
  /** Clock reading of the verification. */
  readonly checkedAt: EpochMs
}

/** How a mutation was applied, including the journal it left (ADR024). */
export interface PlanMutationOutcome {
  /** `atomic` only when every part was applied as one unit; `staged` otherwise. */
  readonly mode: 'atomic' | 'staged'
  /** Operation identity. */
  readonly operationId: OperationId
  /** State the operation reached. */
  readonly state: StagedPlanMutationState
  /** Created keys mapped to their ids. */
  readonly created: Readonly<Record<string, TaskId>>
  /** Edges that landed. */
  readonly addedDependencies: readonly TaskDependency[]
  /** Edges that were removed. */
  readonly removedDependencies: readonly TaskDependency[]
  /** Integrity report produced before the outcome was committed. */
  readonly integrity: IntegrityReport
}

/**
 * Who decided something, and why.
 *
 * A decision is the only thing a derived gate persists (§5.5), so it always
 * carries an actor: an anonymous decision could not be told from an automatic
 * one, and the architecture keeps human approval in the audit (§8).
 */
export interface PlanDecision {
  /** Identity of the deciding actor: a human, the Task Setter, or a named policy. */
  readonly decidedBy: string
  /** Reason; mandatory where the architecture makes it mandatory. */
  readonly reason?: string
  /** Clock reading of the decision. */
  readonly at: EpochMs
}

/** Longest reason a decision may carry; long text belongs in an artifact. */
export const MAX_DECISION_REASON_LENGTH = 2_000

/** Prefix of the external reference a plan-created task carries. */
export const PLAN_EXTERNAL_REF_PREFIX = 'mw-plan:'

/** What a worker is allowed to raise instead of rebuilding the DAG (§10.4). */
export type WorkProposalKind =
  /** The task is blocked by something the worker cannot resolve. */
  | 'blocker'
  /** Follow-up work the worker discovered. */
  | 'follow-up'
  /** The agreed scope no longer matches what the work needs. */
  | 'scope-change'
  /** A dependency the worker believes is missing. */
  | 'dependency'
  /** A security risk the worker found. */
  | 'security-risk'

/** Every proposal kind, in the order §10.4 lists them. */
export const WORK_PROPOSAL_KINDS: readonly WorkProposalKind[] = Object.freeze([
  'blocker',
  'follow-up',
  'scope-change',
  'dependency',
  'security-risk',
])

/** Lifecycle of a proposal; a proposal never changes the graph by itself. */
export type WorkProposalState =
  /** Raised and waiting for the Task Setter or a lightweight policy. */
  | 'open'
  /** Accepted; the accepted mutation is a separate operation with its own id. */
  | 'accepted'
  /** Rejected, with a reason. */
  | 'rejected'
  /** A later plan revision replaced it. */
  | 'superseded'

/** Every proposal state. */
export const WORK_PROPOSAL_STATES: readonly WorkProposalState[] = Object.freeze([
  'open',
  'accepted',
  'rejected',
  'superseded',
])

/** Longest proposal detail; long text belongs in an artifact. */
export const MAX_PROPOSAL_DETAIL_LENGTH = 2_000

/** What a worker raises (§10.4). */
export interface WorkProposalInput {
  /** Workspace the proposal belongs to. */
  readonly workspaceId: WorkspaceId
  /** Which kind of discovered work this is. */
  readonly kind: WorkProposalKind
  /** Task the proposal was raised from, when it came from one. */
  readonly taskId?: TaskId
  /** What the worker found; never a command and never a plan. */
  readonly detail: string
  /** Who raised it. */
  readonly raisedBy: string
  /** Correlation of the workflow that raised it (§9). */
  readonly correlationId: CorrelationId
}

/** A stored proposal. */
export interface WorkProposalRecord extends WorkProposalInput {
  /** Caller-owned identity of the proposal. */
  readonly proposalId: string
  /** Current state. */
  readonly state: WorkProposalState
  /** Clock reading of the raise. */
  readonly raisedAt: EpochMs
  /** Operation that accepted it, when one did. */
  readonly operationId?: OperationId
  /** Who decided, when a decision was made. */
  readonly decidedBy?: string
  /** Why, when a decision was made. */
  readonly decisionReason?: string
  /** Clock reading of the decision. */
  readonly decidedAt?: EpochMs
}

/**
 * Optional input of an operator `resume` (§5.2).
 *
 * A create whose id was never journaled cannot be guessed: the operator resolves
 * it by hand and hands the mapping in, so a resume never creates a duplicate.
 */
export interface PlanResumeOptions {
  /** Created keys the operator resolved, by inspecting the graph. */
  readonly adoptedCreated?: Readonly<Record<string, TaskId>>
}
