/**
 * Task domain (architecture §8, §18.1). A task owns what the Task Graph owns —
 * description, dependencies, readiness, priority, role requirement, completion
 * — and deliberately carries no board layout: `task.board-placement` belongs to
 * the Task Board projection.
 * @module
 */

import type { AttemptId, EpochMs, Revision, RoleId, TaskId, WorkspaceId } from './ids.ts'

/** Task states (architecture §18.1). */
export type TaskState =
  /** Captured but not planned yet. */
  | 'draft'
  /** Planned by the Task Setter; dependencies may still be open. */
  | 'planned'
  /** Dependencies satisfied; an attempt may be admitted. */
  | 'ready'
  /** An attempt was admitted and owns the task. */
  | 'assigned'
  /** The attempt is running. */
  | 'executing'
  /** The attempt settled and a review was requested. */
  | 'awaiting-review'
  /** A reviewer holds the review. */
  | 'reviewing'
  /** The review approved the exact head SHA and diff it saw. */
  | 'approved'
  /** Integration is applying the approved result. */
  | 'integrating'
  /** Terminal: the Task Graph records the task as complete. */
  | 'done'
  /** Side state: waiting on a dependency or an external condition. */
  | 'blocked'
  /** Side state: the review rejected the attempt; a new attempt is needed. */
  | 'changes-requested'
  /** Side state: the attempt failed; a retry is allowed. */
  | 'failed'
  /** Terminal side state: the task was cancelled. */
  | 'cancelled'
  /** Terminal side state: a newer plan revision replaced the task. */
  | 'superseded'
  /** Side state: a human must decide before work continues. */
  | 'needs-attention'

/** Every task state, in the order the architecture lists them. */
export const TASK_STATES: readonly TaskState[] = Object.freeze([
  'draft',
  'planned',
  'ready',
  'assigned',
  'executing',
  'awaiting-review',
  'reviewing',
  'approved',
  'integrating',
  'done',
  'blocked',
  'changes-requested',
  'failed',
  'cancelled',
  'superseded',
  'needs-attention',
])

/** States from which no further transition exists. */
export const TASK_TERMINAL_STATES: readonly TaskState[] = Object.freeze(['done', 'cancelled', 'superseded'])

/**
 * States in which an attempt is bound to the task. Every other state must have
 * no active attempt, which is what keeps a completed task from holding one.
 */
export const TASK_STATES_WITH_ACTIVE_ATTEMPT: readonly TaskState[] = Object.freeze(['assigned', 'executing'])

/** One task as the MyWork domain sees it. */
export interface Task {
  /** Task Graph identifier. */
  readonly id: TaskId
  /** Workspace the task belongs to; cross-workspace edges are out of scope (§63). */
  readonly workspaceId: WorkspaceId
  /** Epic the task belongs to. */
  readonly epicId?: string
  /** Task description (authority: Task Graph). */
  readonly title: string
  /** Acceptance criteria and detail (authority: Task Graph). */
  readonly description: string
  /** Current state. */
  readonly state: TaskState
  /** Aggregate revision; every accepted transition increments it. */
  readonly revision: Revision
  /** Tasks that must complete first (authority: Task Graph). */
  readonly dependsOn: readonly TaskId[]
  /** Role the task requires (authority: Task Graph metadata). */
  readonly roleRequirement?: RoleId
  /** Priority, higher first (authority: Task Graph). */
  readonly priority?: number
  /** Attempt currently bound to the task; present only in `assigned`/`executing`. */
  readonly activeAttemptId?: AttemptId
  /** Clock reading of the transition into `done`. */
  readonly completedAt?: EpochMs
}

/**
 * Task Board projection row (architecture §8). It is a control surface: losing
 * it loses no authority, and it never writes task state.
 */
export interface TaskBoardPlacement {
  /** Task the placement describes. */
  readonly taskId: TaskId
  /** Board column the task is displayed in. */
  readonly column: string
  /** Order inside the column. */
  readonly order: number
  /** Revision of the board snapshot the row came from. */
  readonly boardRevision: Revision
}
