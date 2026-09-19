/**
 * Durable statements of the claim saga (architecture §9, §17, §18.2).
 *
 * Every write here is a single statement whose `WHERE` clause re-states the
 * condition the caller read, so each decision is a genuine compare-and-set rather
 * than a read followed by a hopeful write. That is what makes the saga safe to
 * retry: a repeated call changes no row and is told so, instead of walking the
 * same steps into the graph twice.
 *
 * The fence allocator is the one place a fence token is minted. It is a
 * conditional `UPDATE ... SET fence = fence + 1` inside the same transaction that
 * inserts the attempt, so a token is never burned by a failure between the two —
 * and the `task_fence_monotonic` trigger refuses any write that would lower it,
 * which is what keeps a superseded token from ever being handed out again (§17).
 * @module
 */

import type { SqlExecutor } from '@dsh-mywork/storage'
import type {
  AttemptId,
  AttemptRecord,
  AttemptState,
  ClaimIntent,
  ClaimIntentState,
  ClaimStep,
  ClaimStepKind,
  ClaimStepState,
  ControllerEpoch,
  EpochMs,
  FenceToken,
  OperationId,
  Revision,
  TaskId,
  WorkspaceId,
} from '@dsh-mywork/contracts'
import { isCounter } from '@dsh-mywork/core'

import { ExecutionError } from './errors.ts'

/** One `claim_intent` row as SQLite returns it. */
interface IntentRow {
  readonly operation_id: string
  readonly correlation_id: string
  readonly workspace_id: string
  readonly task_id: string
  readonly claimant: string
  readonly controller_epoch: number
  readonly base_revision: number
  readonly state: string
  readonly attempt_id: string | null
  readonly fence: number | null
  readonly holder: string | null
  readonly failure: string | null
  readonly decided_by: string | null
  readonly decision_reason: string | null
  readonly agent_id: string | null
  readonly lease_ms: number | null
  readonly recorded_at: number
  readonly updated_at: number
}

/** One `attempt` row as SQLite returns it. */
interface AttemptRow {
  readonly attempt_id: string
  readonly task_id: string
  readonly workspace_id: string
  readonly agent_id: string
  readonly state: string
  readonly revision: number
  readonly fence: number
  readonly controller_epoch: number
  readonly lease_expires_at: number
  readonly operation_id: string
  readonly created_at: number
  readonly settled_at: number | null
}

/** One `claim_step` row as SQLite returns it. */
interface StepRow {
  readonly seq: number
  readonly kind: string
  readonly state: string
  readonly detail: string | null
}

/** Read an intent row into the contract shape. */
function toIntent(row: IntentRow): ClaimIntent {
  return Object.freeze({
    operationId: String(row.operation_id),
    correlationId: String(row.correlation_id),
    workspaceId: String(row.workspace_id),
    taskId: String(row.task_id),
    claimant: String(row.claimant),
    controllerEpoch: Number(row.controller_epoch),
    baseRevision: Number(row.base_revision),
    state: String(row.state) as ClaimIntentState,
    ...(row.attempt_id === null ? {} : { attemptId: String(row.attempt_id) }),
    ...(row.fence === null ? {} : { fence: Number(row.fence) }),
    ...(row.holder === null ? {} : { holder: String(row.holder) }),
    ...(row.failure === null ? {} : { failure: String(row.failure) }),
    ...(row.decided_by === null ? {} : { decidedBy: String(row.decided_by) }),
    ...(row.decision_reason === null ? {} : { decisionReason: String(row.decision_reason) }),
    ...(row.agent_id === null ? {} : { agentId: String(row.agent_id) }),
    ...(row.lease_ms === null ? {} : { leaseMs: Number(row.lease_ms) }),
    recordedAt: Number(row.recorded_at),
    updatedAt: Number(row.updated_at),
  })
}

/** Read an attempt row into the contract shape. */
function toAttempt(row: AttemptRow): AttemptRecord {
  return Object.freeze({
    id: String(row.attempt_id),
    taskId: String(row.task_id),
    workspaceId: String(row.workspace_id),
    agentId: String(row.agent_id),
    state: String(row.state) as AttemptState,
    revision: Number(row.revision),
    fence: Number(row.fence),
    controllerEpoch: Number(row.controller_epoch),
    leaseExpiresAt: Number(row.lease_expires_at),
    operationId: String(row.operation_id),
    createdAt: Number(row.created_at),
    ...(row.settled_at === null ? {} : { settledAt: Number(row.settled_at) }),
  })
}

/** Read a step row into the contract shape. */
function toStep(row: StepRow): ClaimStep {
  return Object.freeze({
    seq: Number(row.seq),
    kind: String(row.kind) as ClaimStepKind,
    state: String(row.state) as ClaimStepState,
    ...(row.detail === null ? {} : { detail: String(row.detail) }),
  })
}

/** The statement surface one saga transaction uses. */
export type ClaimExecutor = SqlExecutor

/**
 * Write the intent of one claim (§9 step 1).
 *
 * The row is written before the graph is touched, which is the whole point of
 * the saga: a crash after this call leaves a durable statement of what was about
 * to happen, and nothing has happened yet.
 * @param executor - transaction to write through.
 * @param intent - the intent to record.
 * @throws {ExecutionError} `conflict` when the operation id is already recorded.
 */
export function insertIntent(executor: ClaimExecutor, intent: ClaimIntent): void {
  try {
    executor.run(
      `INSERT INTO claim_intent
         (operation_id, correlation_id, workspace_id, task_id, claimant, controller_epoch,
          base_revision, state, attempt_id, fence, holder, failure, decided_by, decision_reason,
          agent_id, lease_ms, recorded_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
      intent.operationId,
      intent.correlationId,
      intent.workspaceId,
      intent.taskId,
      intent.claimant,
      intent.controllerEpoch,
      intent.baseRevision,
      intent.state,
      intent.agentId ?? null,
      intent.leaseMs ?? null,
      intent.recordedAt,
      intent.updatedAt,
    )
  } catch (error) {
    throw new ExecutionError('conflict', `dsh-mywork: the claim operation "${intent.operationId}" is already recorded`, {
      details: { operationId: intent.operationId },
      cause: error,
    })
  }
}

/** Read one intent, if it exists. */
export function readIntent(executor: ClaimExecutor, operationId: OperationId): ClaimIntent | undefined {
  const row = executor.get('SELECT * FROM claim_intent WHERE operation_id = ?', operationId)
  return row === undefined ? undefined : toIntent(row as unknown as IntentRow)
}

/** Read every intent that still owes work, oldest first. */
export function listOpenIntents(executor: ClaimExecutor, workspaceId?: WorkspaceId): readonly ClaimIntent[] {
  const rows =
    workspaceId === undefined
      ? executor.all(
          `SELECT * FROM claim_intent
            WHERE state IN ('recorded','claimed','attempted','projected','recovering')
            ORDER BY recorded_at, operation_id`,
        )
      : executor.all(
          `SELECT * FROM claim_intent
            WHERE state IN ('recorded','claimed','attempted','projected','recovering') AND workspace_id = ?
            ORDER BY recorded_at, operation_id`,
          workspaceId,
        )
  return Object.freeze(rows.map(row => toIntent(row as unknown as IntentRow)))
}

/**
 * Move an intent to another state, but only from the state the caller read.
 *
 * This is the compare-and-set that makes a repeated or overlapping call safe: the
 * loser changes no row and is told the operation moved on, instead of applying the
 * same step a second time.
 * @param executor - transaction to write through.
 * @param operationId - operation whose row is moved.
 * @param from - state the caller observed.
 * @param to - state to move to.
 * @param at - clock reading of the change.
 * @param patch - fields to write alongside the state.
 * @returns whether this caller moved the row.
 */
export function advanceIntent(
  executor: ClaimExecutor,
  operationId: OperationId,
  from: ClaimIntentState,
  to: ClaimIntentState,
  at: EpochMs,
  patch: {
    readonly attemptId?: AttemptId
    readonly fence?: FenceToken
    readonly holder?: string
    readonly failure?: string
    readonly decidedBy?: string
    readonly decisionReason?: string
  } = {},
): boolean {
  const changed = executor.run(
    `UPDATE claim_intent
        SET state = ?, updated_at = ?,
            attempt_id      = COALESCE(?, attempt_id),
            fence           = COALESCE(?, fence),
            holder          = COALESCE(?, holder),
            failure         = COALESCE(?, failure),
            decided_by      = COALESCE(?, decided_by),
            decision_reason = COALESCE(?, decision_reason)
      WHERE operation_id = ? AND state = ?`,
    to,
    at,
    patch.attemptId ?? null,
    patch.fence ?? null,
    patch.holder ?? null,
    patch.failure ?? null,
    patch.decidedBy ?? null,
    patch.decisionReason ?? null,
    operationId,
    from,
  )
  return changed === 1
}

/** Write the whole step journal of one operation, replacing what is there. */
export function writeSteps(executor: ClaimExecutor, operationId: OperationId, steps: readonly ClaimStep[]): void {
  executor.run('DELETE FROM claim_step WHERE operation_id = ?', operationId)
  for (const step of steps) {
    executor.run(
      'INSERT INTO claim_step (operation_id, seq, kind, state, detail) VALUES (?, ?, ?, ?, ?)',
      operationId,
      step.seq,
      step.kind,
      step.state,
      step.detail ?? null,
    )
  }
}

/** Read the step journal of one operation, in order. */
export function readSteps(executor: ClaimExecutor, operationId: OperationId): readonly ClaimStep[] {
  const rows = executor.all('SELECT seq, kind, state, detail FROM claim_step WHERE operation_id = ? ORDER BY seq', operationId)
  return Object.freeze(rows.map(row => toStep(row as unknown as StepRow)))
}

/**
 * Mint the next fence token for a task (§17).
 *
 * The token is allocated inside the transaction that inserts the attempt, so a
 * failure between the two cannot burn one. A task with no row yet starts at 1,
 * which makes "fence 0" mean "no attempt has ever been made".
 * @param executor - transaction to write through.
 * @param taskId - task the token is for.
 * @param at - clock reading of the allocation.
 * @throws {ExecutionError} `conflict` when the monotonicity trigger refuses the write.
 */
export function allocateFence(executor: ClaimExecutor, taskId: TaskId, at: EpochMs): FenceToken {
  const existing = executor.get('SELECT fence FROM task_fence WHERE task_id = ?', taskId)
  if (existing === undefined) {
    executor.run('INSERT INTO task_fence (task_id, fence, updated_at) VALUES (?, 1, ?)', taskId, at)
    return 1
  }
  const next = Number(existing['fence']) + 1
  try {
    const changed = executor.run(
      'UPDATE task_fence SET fence = ?, updated_at = ? WHERE task_id = ? AND fence = ?',
      next,
      at,
      taskId,
      Number(existing['fence']),
    )
    if (changed !== 1) {
      // Another allocator won between the read and the write; its token is the one
      // in force and this caller must not invent a second.
      throw new ExecutionError('conflict', `dsh-mywork: the fence of task "${taskId}" moved while allocating`, {
        details: { taskId, observed: Number(existing['fence']) },
      })
    }
  } catch (error) {
    if (error instanceof ExecutionError) throw error
    throw new ExecutionError('conflict', `dsh-mywork: the fence of task "${taskId}" could not be advanced`, {
      details: { taskId },
      cause: error,
    })
  }
  return next
}

/** Read the current fence token of a task; `0` when no attempt was ever made. */
export function readFence(executor: ClaimExecutor, taskId: TaskId): FenceToken {
  const row = executor.get('SELECT fence FROM task_fence WHERE task_id = ?', taskId)
  return row === undefined ? 0 : Number(row['fence'])
}

/**
 * Read the live attempt **of one saga**.
 *
 * Distinct from {@link readLiveAttempt} on purpose, and the distinction is the
 * whole point: a task has at most one live attempt, but that attempt may belong to
 * a *different* saga — a newer worker that legitimately took the task over after
 * this one was superseded. A reconciler asking "did my claim produce an attempt?"
 * must not be answered with somebody else's, because the answer decides whether a
 * lease is revoked: taking away a healthy worker's lease on the strength of an
 * older saga's bookkeeping is the one mistake §49's revocation path must not make.
 * @param executor - transaction to read through.
 * @param operationId - the saga whose attempt is wanted.
 */
export function readSagaAttempt(executor: ClaimExecutor, operationId: OperationId): AttemptRecord | undefined {
  const row = executor.get(
    'SELECT * FROM attempt WHERE operation_id = ? AND settled_at IS NULL',
    operationId,
  )
  return row === undefined ? undefined : toAttempt(row as unknown as AttemptRow)
}

/**
 * Insert one attempt with its lease.
 *
 * A second *live* attempt on the same task is refused by the
 * `attempt_task_live_lease` partial unique index, which is the §17 invariant the
 * card's third acceptance criterion names: at most one authoritative execution
 * lease per task. The refusal is reported as `conflict` with the reason, not as a
 * raw SQLite error, because a caller has to be able to tell it from a bug.
 * @param executor - transaction to write through.
 * @param attempt - the attempt to record.
 * @throws {ExecutionError} `conflict` when the task already has a live attempt.
 */
export function insertAttempt(executor: ClaimExecutor, attempt: AttemptRecord): void {
  try {
    executor.run(
      `INSERT INTO attempt
         (attempt_id, task_id, workspace_id, agent_id, state, revision, fence,
          controller_epoch, lease_expires_at, operation_id, created_at, settled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      attempt.id,
      attempt.taskId,
      attempt.workspaceId,
      attempt.agentId,
      attempt.state,
      attempt.revision,
      attempt.fence,
      attempt.controllerEpoch,
      attempt.leaseExpiresAt,
      attempt.operationId,
      attempt.createdAt,
    )
  } catch (error) {
    throw new ExecutionError(
      'conflict',
      `dsh-mywork: task "${attempt.taskId}" already holds an authoritative execution lease`,
      { details: { taskId: attempt.taskId, attemptId: attempt.id, reason: 'task-already-leased' }, cause: error },
    )
  }
}

/** Read one attempt, if it exists. */
export function readAttempt(executor: ClaimExecutor, attemptId: AttemptId): AttemptRecord | undefined {
  const row = executor.get('SELECT * FROM attempt WHERE attempt_id = ?', attemptId)
  return row === undefined ? undefined : toAttempt(row as unknown as AttemptRow)
}

/** Read the live attempt of a task, if it has one. */
export function readLiveAttempt(executor: ClaimExecutor, taskId: TaskId): AttemptRecord | undefined {
  const row = executor.get('SELECT * FROM attempt WHERE task_id = ? AND settled_at IS NULL', taskId)
  return row === undefined ? undefined : toAttempt(row as unknown as AttemptRow)
}

/** Read every live attempt of a workspace, oldest first. */
export function listLiveAttempts(executor: ClaimExecutor, workspaceId?: WorkspaceId): readonly AttemptRecord[] {
  const rows =
    workspaceId === undefined
      ? executor.all('SELECT * FROM attempt WHERE settled_at IS NULL ORDER BY created_at, attempt_id')
      : executor.all(
          'SELECT * FROM attempt WHERE settled_at IS NULL AND workspace_id = ? ORDER BY created_at, attempt_id',
          workspaceId,
        )
  return Object.freeze(rows.map(row => toAttempt(row as unknown as AttemptRow)))
}

/**
 * Move an attempt to a terminal state, but only from the state the caller read.
 *
 * `settled_at` is what frees the task's lease slot, so it is written in the same
 * statement that moves the state: an attempt that changed state without settling
 * would hold the slot forever, and one that settled without changing state would
 * release a lease it still believes it owns.
 * @param executor - transaction to write through.
 * @param attemptId - attempt to settle.
 * @param from - state the caller observed.
 * @param to - terminal state to move to.
 * @param at - clock reading of the settlement.
 * @param expectedRevision - revision the caller observed; `undefined` skips the check.
 * @param expectedFence - fence the caller holds; `undefined` skips the check.
 * @returns whether this caller settled the attempt.
 */
export function settleAttempt(
  executor: ClaimExecutor,
  attemptId: AttemptId,
  from: AttemptState,
  to: AttemptState,
  at: EpochMs,
  expectedRevision?: Revision,
  expectedFence?: FenceToken,
): boolean {
  const changed = executor.run(
    `UPDATE attempt
        SET state = ?, revision = revision + 1, settled_at = ?
      WHERE attempt_id = ? AND state = ? AND settled_at IS NULL
        AND (? IS NULL OR revision = ?)
        AND (? IS NULL OR fence = ?)`,
    to,
    at,
    attemptId,
    from,
    expectedRevision ?? null,
    expectedRevision ?? null,
    expectedFence ?? null,
    expectedFence ?? null,
  )
  return changed === 1
}

/**
 * Verify that every schema this layer writes through is on disk.
 *
 * The saga commits its intent, its steps, its attempt, its audit row, and its
 * outbox event together (§48), so a store missing any of those tables must fail
 * here — where it was wired — rather than halfway through a claim.
 * @param executor - transaction to read the journal through.
 * @throws {ExecutionError} `schema-missing` when a required migration is absent.
 */
export function assertClaimSchema(executor: ClaimExecutor, required: readonly { version: number; name: string }[]): void {
  const missing: string[] = []
  for (const migration of required) {
    const applied = executor.get('SELECT name FROM schema_migrations WHERE version = ?', migration.version)
    if (applied === undefined || applied['name'] !== migration.name) missing.push(`${migration.version}:${migration.name}`)
  }
  if (missing.length > 0) {
    throw new ExecutionError(
      'schema-missing',
      `dsh-mywork: the store is missing the ${missing.join(', ')} schema; open it with every migration this layer writes through`,
      { details: { missing } },
    )
  }
}

/** Reject a counter that is not a non-negative safe integer. */
export function requireCounter(value: unknown, field: string): void {
  if (!isCounter(value)) {
    throw new ExecutionError('invalid-input', `dsh-mywork: ${field} must be a non-negative integer, received ${String(value)}`)
  }
}

/** Reject an empty or non-string identifier. */
export function requireText(value: unknown, field: string, max?: number): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ExecutionError('invalid-input', `dsh-mywork: ${field} must be a non-empty string`)
  }
  if (max !== undefined && value.length > max) {
    throw new ExecutionError('invalid-input', `dsh-mywork: ${field} exceeds ${max} characters`)
  }
}

/** Reject a value that is not an object. */
export function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new ExecutionError('invalid-input', `dsh-mywork: ${what} must be an object`)
  }
  return value as Record<string, unknown>
}

/** Controller epoch helper kept next to the store for the callers that need it. */
export type StoredEpoch = ControllerEpoch
