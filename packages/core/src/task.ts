/**
 * Task state machine (architecture §18.1) as pure, validated transitions.
 *
 * A transition either produces the next task plus its events, or a typed
 * failure; nothing here reads a clock, generates an id, or touches a store, so
 * every rule below is directly testable. The main line follows §18.1 exactly;
 * the side-state edges are the minimum needed by §17 (revoked attempt returns
 * the task to `ready`), §18.3 (reject produces `changes-requested`), and §10.3
 * (replanning supersedes a task).
 * @module
 */

import {
  TASK_STATES_WITH_ACTIVE_ATTEMPT,
  TASK_TERMINAL_STATES,
  type AttemptId,
  type DomainEvent,
  type EpochMs,
  type OperationMeta,
  type Result,
  type Revision,
  type Task,
  type TaskState,
} from '@dsh-mywork/contracts'
import { MyWorkError, fail, ok } from './errors.ts'
import { assertRevision } from './guards.ts'

/**
 * Allowed task transitions.
 *
 * - Main line: `draft → planned → ready → assigned → executing →
 *   awaiting-review → reviewing → approved → integrating → done`.
 * - `assigned`/`executing → ready` is the revoked-lease path (§17): the attempt
 *   is gone, so the task becomes schedulable again.
 * - `reviewing → changes-requested` is the reject path (§18.3); the task then
 *   returns to `ready` for a new attempt.
 * - `blocked` is only reachable before an attempt exists, because a task that
 *   runs must be revocable rather than silently frozen.
 * - `superseded` is reachable from every state that holds no attempt (§10.3).
 * - `done`, `cancelled`, and `superseded` are terminal.
 *
 * The table lists `ready → assigned` for completeness, but that edge belongs to
 * {@link admitAttempt}: {@link transitionTask} refuses it, so an attempt cannot
 * be bound without the admission checks and the `task.attempt.admitted` event.
 *
 * The returned task is frozen at the top level only: `dependsOn` and other
 * caller-owned values keep their identity, so nested immutability is a contract
 * of the domain, not a runtime guarantee.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = Object.freeze({
  draft: ['planned', 'cancelled', 'superseded'],
  planned: ['ready', 'blocked', 'cancelled', 'superseded'],
  ready: ['assigned', 'blocked', 'cancelled', 'superseded'],
  assigned: ['executing', 'ready', 'failed', 'needs-attention'],
  executing: ['awaiting-review', 'ready', 'failed', 'needs-attention'],
  'awaiting-review': ['reviewing', 'failed', 'needs-attention', 'cancelled', 'superseded'],
  reviewing: ['approved', 'changes-requested', 'failed', 'needs-attention', 'cancelled', 'superseded'],
  approved: ['integrating', 'needs-attention', 'cancelled', 'superseded'],
  integrating: ['done', 'failed', 'needs-attention', 'superseded'],
  blocked: ['ready', 'planned', 'cancelled', 'superseded'],
  'changes-requested': ['ready', 'cancelled', 'superseded'],
  failed: ['ready', 'cancelled', 'superseded'],
  'needs-attention': ['ready', 'failed', 'cancelled', 'superseded'],
  done: [],
  cancelled: [],
  superseded: [],
})

/** Command accepted by {@link transitionTask}. */
export interface TaskTransitionCommand {
  /** Target state. */
  readonly to: TaskState
  /** Revision the caller observed; a mismatch is `STALE_REVISION`. */
  readonly expectedRevision?: Revision
  /**
   * Attempt bound to the task. Required when the target state holds an attempt
   * (`assigned`, `executing`) and forbidden in every other target state, so the
   * transition itself keeps the invariant instead of trusting the caller.
   */
  readonly activeAttemptId?: AttemptId | null
  /** Clock reading of the transition. */
  readonly at: EpochMs
}

/** Accepted transition: the next task plus the events it produced. */
export interface TaskTransition {
  /** Task after the transition, with an incremented revision. */
  readonly task: Task
  /** State the task was in. */
  readonly from: TaskState
  /** State the task moved to. */
  readonly to: TaskState
  /** Events the transition produced, in order. */
  readonly events: readonly DomainEvent[]
}

/** Command accepted by {@link admitAttempt}. */
export interface AttemptAdmission {
  /** Attempt about to start work on the task. */
  readonly attemptId: AttemptId
  /** Revision the caller observed; a mismatch is `STALE_REVISION`. */
  readonly expectedRevision?: Revision
  /** Clock reading of the admission. */
  readonly at: EpochMs
}

/** Whether a task state is terminal (§18.1). */
export function isTaskTerminal(state: TaskState): boolean {
  return TASK_TERMINAL_STATES.includes(state)
}

/** Whether a task state must hold an attempt. */
export function requiresActiveAttempt(state: TaskState): boolean {
  return TASK_STATES_WITH_ACTIVE_ATTEMPT.includes(state)
}

/** Whether a transition between two states is allowed. */
export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to)
}

/** States reachable from the given one, for diagnostics and UI. */
export function allowedTaskTransitions(from: TaskState): readonly TaskState[] {
  return TASK_TRANSITIONS[from]
}

/**
 * Check a task against the attempt-binding invariants.
 *
 * A terminal task must not hold an attempt, and a task holding an attempt must
 * be in a state that runs one.
 * @param task - the task to check.
 * @param meta - operation identity.
 */
export function assertTaskInvariants(task: Task, meta: OperationMeta): Result<Task> {
  const attemptId = normalizeAttemptId(task.activeAttemptId)
  if (isTaskTerminal(task.state) && attemptId !== undefined) {
    return fail(
      new MyWorkError(
        'TASK_CONFLICT',
        `dsh-mywork: terminal task "${task.id}" must not hold an active attempt`,
        { details: { taskId: task.id, state: task.state, activeAttemptId: attemptId } },
      ),
      meta,
    )
  }
  if (requiresActiveAttempt(task.state) && attemptId === undefined) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: task "${task.id}" in state "${task.state}" requires an active attempt`, {
        details: { taskId: task.id, state: task.state },
      }),
      meta,
    )
  }
  if (!requiresActiveAttempt(task.state) && attemptId !== undefined) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: task "${task.id}" in state "${task.state}" must not hold an active attempt`, {
        details: { taskId: task.id, state: task.state, activeAttemptId: attemptId },
      }),
      meta,
    )
  }
  return ok(task, meta)
}

/**
 * Move a task to another state.
 *
 * `assigned` is not reachable here: admitting an attempt is {@link admitAttempt}'s
 * job, so every admission passes the terminal and readiness checks and always
 * emits `task.attempt.admitted`. The checks run in a fixed order: revision first
 * (the caller must speak about the revision it saw), then the coherence of the
 * incoming task, then the edge itself, then the attempt binding of the target
 * state.
 * @param task - current task.
 * @param command - target state, expected revision, attempt binding, and clock reading.
 * @param meta - operation identity.
 */
export function transitionTask(task: Task, command: TaskTransitionCommand, meta: OperationMeta): Result<TaskTransition> {
  const revision = assertRevision(command.expectedRevision, task.revision, meta)
  if (!revision.ok) return fail(revision.error, meta)

  if (command.to === 'assigned') {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: task "${task.id}" can only be assigned by admitting an attempt`, {
        details: { taskId: task.id, from: task.state, to: command.to },
      }),
      meta,
    )
  }
  return applyTaskTransition(task, command, meta)
}

/**
 * Admit an attempt for a task: the only path from `ready` to `assigned`.
 *
 * A terminal task is refused with `UNSCHEDULABLE`, so a completed task can
 * never acquire an active attempt, and an attempt can be admitted only while
 * the task is `ready`.
 * @param task - current task.
 * @param admission - attempt identity, expected revision, and clock reading.
 * @param meta - operation identity.
 */
export function admitAttempt(task: Task, admission: AttemptAdmission, meta: OperationMeta): Result<TaskTransition> {
  const revision = assertRevision(admission.expectedRevision, task.revision, meta)
  if (!revision.ok) return fail(revision.error, meta)

  if (isTaskTerminal(task.state)) {
    return fail(
      new MyWorkError('UNSCHEDULABLE', `dsh-mywork: task "${task.id}" is "${task.state}" and admits no attempt`, {
        details: { taskId: task.id, state: task.state, attemptId: admission.attemptId },
      }),
      meta,
    )
  }

  const coherent = assertTaskInvariants(task, meta)
  if (!coherent.ok) return fail(coherent.error, meta)

  if (task.state !== 'ready') {
    return fail(
      new MyWorkError('UNSCHEDULABLE', `dsh-mywork: task "${task.id}" is "${task.state}"; only a "ready" task admits an attempt`, {
        details: { taskId: task.id, state: task.state, attemptId: admission.attemptId },
      }),
      meta,
    )
  }

  const moved = applyTaskTransition(
    task,
    { to: 'assigned', activeAttemptId: admission.attemptId, at: admission.at },
    meta,
  )
  if (!moved.ok) return moved

  const admitted: DomainEvent = Object.freeze({
    type: 'task.attempt.admitted',
    payload: Object.freeze({
      taskId: task.id,
      attemptId: admission.attemptId,
      revision: moved.value.task.revision,
      at: admission.at,
    }),
  })
  return ok(
    Object.freeze({
      ...moved.value,
      events: Object.freeze([...moved.value.events, admitted]),
    }),
    meta,
  )
}

/** The transition itself, shared by {@link transitionTask} and {@link admitAttempt}. */
function applyTaskTransition(
  task: Task,
  command: TaskTransitionCommand,
  meta: OperationMeta,
): Result<TaskTransition> {
  const revision = assertRevision(command.expectedRevision, task.revision, meta)
  if (!revision.ok) return fail(revision.error, meta)

  const coherent = assertTaskInvariants(task, meta)
  if (!coherent.ok) return fail(coherent.error, meta)

  if (!canTransitionTask(task.state, command.to)) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: task "${task.id}" cannot move from "${task.state}" to "${command.to}"`, {
        details: { taskId: task.id, from: task.state, to: command.to, allowed: [...TASK_TRANSITIONS[task.state]] },
      }),
      meta,
    )
  }

  const bound = resolveAttemptBinding(task, command, meta)
  if (!bound.ok) return fail(bound.error, meta)
  const boundAttemptId = bound.value

  const built: Task = {
    id: task.id,
    workspaceId: task.workspaceId,
    title: task.title,
    description: task.description,
    state: command.to,
    revision: task.revision + 1,
    dependsOn: task.dependsOn,
    ...(task.epicId === undefined ? {} : { epicId: task.epicId }),
    ...(task.roleRequirement === undefined ? {} : { roleRequirement: task.roleRequirement }),
    ...(task.priority === undefined ? {} : { priority: task.priority }),
    ...(boundAttemptId === undefined ? {} : { activeAttemptId: boundAttemptId }),
    ...(command.to === 'done' ? { completedAt: command.at } : {}),
  }
  const next = Object.freeze(built)

  const produced = assertTaskInvariants(next, meta)
  if (!produced.ok) return fail(produced.error, meta)

  return ok(
    Object.freeze({
      task: next,
      from: task.state,
      to: command.to,
      events: Object.freeze(taskEvents(task, command, next)),
    }),
    meta,
  )
}

/**
 * Decide which attempt the task holds after the transition.
 *
 * Ownership is continuous: a task that already runs attempt A keeps A, and a
 * caller that presents a different attempt is refused (`TASK_CONFLICT`) instead
 * of silently replacing it. Reassignment must go through revocation and `ready`,
 * which is what keeps one task from running two attempts at once (§17).
 * @param task - current task.
 * @param command - the transition being applied.
 * @param meta - operation identity.
 */
function resolveAttemptBinding(
  task: Task,
  command: TaskTransitionCommand,
  meta: OperationMeta,
): Result<AttemptId | undefined> {
  const currentAttemptId = normalizeAttemptId(task.activeAttemptId)
  const requestedAttemptId = normalizeAttemptId(command.activeAttemptId)

  if (!requiresActiveAttempt(command.to)) {
    if (requestedAttemptId !== undefined) {
      return fail(
        new MyWorkError('TASK_CONFLICT', `dsh-mywork: state "${command.to}" must not hold an active attempt`, {
          details: { taskId: task.id, to: command.to, activeAttemptId: requestedAttemptId },
        }),
        meta,
      )
    }
    return ok(undefined, meta)
  }

  if (currentAttemptId !== undefined && requestedAttemptId !== undefined && currentAttemptId !== requestedAttemptId) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: task "${task.id}" cannot swap attempt "${currentAttemptId}" for "${requestedAttemptId}"`, {
        details: { taskId: task.id, currentAttemptId, requestedAttemptId },
      }),
      meta,
    )
  }

  const boundAttemptId = requestedAttemptId ?? currentAttemptId
  if (boundAttemptId === undefined) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: state "${command.to}" requires the attempt that owns task "${task.id}"`, {
        details: { taskId: task.id, to: command.to },
      }),
      meta,
    )
  }
  return ok(boundAttemptId, meta)
}

/** Events a task transition produces. */
function taskEvents(task: Task, command: TaskTransitionCommand, next: Task): DomainEvent[] {
  const events: DomainEvent[] = [
    Object.freeze({
      type: 'task.state.changed',
      payload: Object.freeze({
        taskId: task.id,
        from: task.state,
        to: command.to,
        revision: next.revision,
        at: command.at,
      }),
    }),
  ]
  if (command.to === 'awaiting-review') {
    events.push(
      Object.freeze({
        type: 'task.review.requested',
        payload: Object.freeze({ taskId: task.id, revision: next.revision, at: command.at }),
      }),
    )
  }
  return events
}

/** Treat an absent, null, or blank attempt reference as "no attempt". */
function normalizeAttemptId(value: AttemptId | null | undefined): AttemptId | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value
}
