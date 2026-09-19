/**
 * Durable plan-mutation state: the plan revision, the staged journal, the
 * admission pause, proposals, and gate decisions (ADR024, ADR028 §5.5).
 *
 * Every write takes an executor rather than opening a transaction of its own, so
 * the planner can commit a state change, its audit row, its evidence, and its
 * outbox event as one unit (§48). The façade at the bottom binds the same
 * functions to an open store for readers; it must not be called from inside a
 * transaction, because `MyWorkStore.transaction` does not nest.
 * @module
 */

import {
  STAGED_PLAN_MUTATION_STATES,
  WORK_PROPOSAL_KINDS,
  WORK_PROPOSAL_STATES,
  type BlockerResolutionAction,
  type BlockerResolutionDecision,
  type PlanDecision,
  type PlanMutationIntent,
  type PlanMutationStep,
  type PlanStepState,
  type PlanMutationPartKind,
  type PlanStepKind,
  type RunningTaskPolicy,
  type StagedPlanMutation,
  type StagedPlanMutationState,
  type IntegrityReport,
  type WorkProposalInput,
  type WorkProposalRecord,
  type WorkProposalState,
  type TaskId,
  type WorkspaceId,
} from '@dsh-mywork/contracts'
import { EVIDENCE_SCHEMA_NAME } from '@dsh-mywork/evidence'
import type { MyWorkStore, SqlExecutor, SqlRow } from '@dsh-mywork/storage'
import { PlanError } from './errors.ts'
import { PLAN_MUTATION_SCHEMA_NAME } from './schema.ts'

/** Why admission is paused while a staged mutation is open. */
export const PLAN_MUTATION_HOLD_REASON = 'plan-mutation-staged'

/** One open admission pause. */
export interface AdmissionHold {
  /** Identity of the hold row. */
  readonly holdId: string
  /** Workspace whose admission is paused. */
  readonly workspaceId: WorkspaceId
  /** Operation that took the pause, when a staged mutation took it. */
  readonly operationId?: string
  /** Why admission is paused; stable, so a projection can name it. */
  readonly reason: string
  /** Clock reading of the pause. */
  readonly heldAt: number
  /** Clock reading of the release, absent while the pause is open. */
  readonly releasedAt?: number
  /** Who released it. */
  readonly releasedBy?: string
}

/** Inputs of {@link holdAdmission}. */
export interface AdmissionHoldInput {
  /** Identity of the hold row. */
  readonly holdId: string
  /** Workspace whose admission is paused. */
  readonly workspaceId: WorkspaceId
  /** Operation that took the pause. */
  readonly operationId?: string
  /** Why admission is paused. */
  readonly reason: string
  /** Clock reading of the pause. */
  readonly heldAt: number
}

/** Read a text column that must be present. */
function requireText(row: SqlRow, column: string): string {
  const value = row[column]
  if (typeof value !== 'string') {
    throw new PlanError('invalid-input', `dsh-mywork: plan row column "${column}" is not text`)
  }
  return value
}

/** Read an integer column that must be present. */
function requireInteger(row: SqlRow, column: string): number {
  const value = row[column]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new PlanError('invalid-input', `dsh-mywork: plan row column "${column}" is not an integer`)
  }
  return value
}

/** Read an optional text column. */
function optionalText(row: SqlRow, column: string): string | undefined {
  const value = row[column]
  return typeof value === 'string' ? value : undefined
}

/** Decode a JSON column. */
function decodeJson<T>(raw: string, what: string): T {
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new PlanError('invalid-input', `dsh-mywork: stored ${what} is not valid JSON`, {
      details: { raw: raw.slice(0, 200) },
      cause: error,
    })
  }
}

/**
 * Refuse a store that was opened without the schemas this layer writes through.
 *
 * The planner commits its state together with an audit row and an artifact, so a
 * database missing the evidence migration cannot serve it; failing here names the
 * composition instead of failing halfway through a staged operation.
 * @param store - open store the planner will use.
 * @throws {PlanError} `schema-missing` naming the migrations that are absent.
 */
export function assertPlanSchema(store: MyWorkStore): void {
  const applied = new Set(store.migrations.map(migration => migration.name))
  const missing = [PLAN_MUTATION_SCHEMA_NAME, EVIDENCE_SCHEMA_NAME].filter(name => !applied.has(name))
  if (missing.length > 0) {
    throw new PlanError(
      'schema-missing',
      `dsh-mywork: the store has no ${missing.join(' and ')} schema; open it with migrations [...MYWORK_MIGRATIONS, ...EVIDENCE_MIGRATIONS, ...PLAN_MUTATION_MIGRATIONS]`,
      { details: { missing, applied: [...applied] } },
    )
  }
}

/** Plan revision on record for a workspace; `0` when no plan was committed yet. */
export function readPlanRevision(executor: SqlExecutor, workspaceId: WorkspaceId): number {
  const row = executor.get('SELECT revision FROM plan_revision WHERE workspace_id = ?', workspaceId)
  if (row === undefined) return 0
  return requireInteger(row, 'revision')
}

/**
 * Commit one plan revision, compare-and-set style.
 *
 * §9 puts `expectedRevision` on every mutation, and the backend has no
 * workspace-wide plan revision to compare against, so the conditional `UPDATE` is
 * the whole guard: a row that no longer holds `expected` means another writer
 * committed first, which is `STALE_REVISION` for the caller.
 * @param executor - open transaction.
 * @param workspaceId - workspace whose plan advanced.
 * @param expected - revision the caller computed against.
 * @param at - clock reading of the commit.
 * @returns the new revision.
 * @throws {PlanError} `stale-revision` when the stored revision moved.
 */
export function commitPlanRevision(
  executor: SqlExecutor,
  workspaceId: WorkspaceId,
  expected: number,
  at: number,
): number {
  const next = expected + 1
  const updated = executor.run(
    'UPDATE plan_revision SET revision = ?, updated_at = ? WHERE workspace_id = ? AND revision = ?',
    next,
    at,
    workspaceId,
    expected,
  )
  if (updated === 0 && expected === 0) {
    const inserted = executor.run(
      'INSERT OR IGNORE INTO plan_revision (workspace_id, revision, updated_at) VALUES (?, ?, ?)',
      workspaceId,
      next,
      at,
    )
    if (inserted === 0) {
      throw new PlanError('stale-revision', 'dsh-mywork: the plan revision moved while the mutation was committed', {
        details: { workspaceId, expected },
      })
    }
    return next
  }
  if (updated === 0) {
    throw new PlanError('stale-revision', 'dsh-mywork: the plan revision moved while the mutation was committed', {
      details: { workspaceId, expected, actual: readPlanRevision(executor, workspaceId) },
    })
  }
  return next
}

/** Insert the staged record of one operation (ADR024 step 2). */
export function insertStagedMutation(executor: SqlExecutor, record: StagedPlanMutation): void {
  executor.run(
    `INSERT INTO plan_mutation
       (operation_id, workspace_id, correlation_id, base_revision, origin, running_task_policy, state, mode,
        intent, created, report, failure, decided_by, decision_reason, staged_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.operationId,
    record.workspaceId,
    record.correlationId,
    record.baseRevision,
    record.origin,
    record.runningTaskPolicy ?? null,
    record.state,
    record.mode ?? null,
    JSON.stringify(record.intent),
    JSON.stringify(record.created),
    record.report === undefined ? null : JSON.stringify(record.report),
    record.failure ?? null,
    null,
    null,
    record.stagedAt,
    record.updatedAt,
  )
}

/** Move an operation to another state. */
export function updateMutationState(
  executor: SqlExecutor,
  operationId: string,
  state: StagedPlanMutationState,
  at: number,
  failure?: string,
): void {
  const updated = executor.run(
    'UPDATE plan_mutation SET state = ?, failure = ?, updated_at = ? WHERE operation_id = ?',
    state,
    failure ?? null,
    at,
    operationId,
  )
  if (updated === 0) {
    throw new PlanError('not-found', `dsh-mywork: no plan mutation "${operationId}" to move to "${state}"`, {
      details: { operationId, state },
    })
  }
}

/**
 * Claim an operation for one caller, as a compare-and-set on the row it read.
 *
 * Two callers can read the same journal entry and both walk it into the graph:
 * neither the in-memory record nor the state transition below can see the other
 * one, and the second walk creates a second task. The claim is the state the row
 * was read in, so exactly one caller moves it to `applying` and the loser is told
 * the operation is already being applied instead of writing anything (ADR024's
 * "a repeat does not duplicate" has to hold for overlapping repeats too).
 * @returns true when this caller owns the operation.
 */
export function claimMutation(
  executor: SqlExecutor,
  operationId: string,
  expectedState: StagedPlanMutationState,
  at: number,
): boolean {
  const claimed = executor.run(
    'UPDATE plan_mutation SET state = ?, failure = NULL, updated_at = ? WHERE operation_id = ? AND state = ?',
    'applying',
    at,
    operationId,
    expectedState,
  )
  return claimed === 1
}

/** Record who decided something about an operation and why. */
export function recordMutationDecision(
  executor: SqlExecutor,
  operationId: string,
  decision: PlanDecision,
): void {
  executor.run(
    'UPDATE plan_mutation SET decided_by = ?, decision_reason = ?, updated_at = ? WHERE operation_id = ?',
    decision.decidedBy,
    decision.reason ?? null,
    decision.at,
    operationId,
  )
}

/** Record how an operation's parts were applied. */
export function saveMutationMode(
  executor: SqlExecutor,
  operationId: string,
  mode: 'atomic' | 'staged',
): void {
  executor.run('UPDATE plan_mutation SET mode = ? WHERE operation_id = ?', mode, operationId)
}

/** Record the created-key mapping observed so far. */
export function saveMutationCreated(
  executor: SqlExecutor,
  operationId: string,
  created: Readonly<Record<string, TaskId>>,
): void {
  executor.run('UPDATE plan_mutation SET created = ? WHERE operation_id = ?', JSON.stringify(created), operationId)
}

/** Record the last integrity report on the operation. */
export function saveMutationReport(
  executor: SqlExecutor,
  operationId: string,
  report: IntegrityReport,
): void {
  executor.run('UPDATE plan_mutation SET report = ? WHERE operation_id = ?', JSON.stringify(report), operationId)
}

/** Replace the journal steps of one operation. */
export function writeSteps(
  executor: SqlExecutor,
  operationId: string,
  steps: readonly PlanMutationStep[],
): void {
  executor.run('DELETE FROM plan_mutation_step WHERE operation_id = ?', operationId)
  for (const step of steps) {
    executor.run(
      `INSERT INTO plan_mutation_step (operation_id, seq, part, kind, ref, reversible, state, previous, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      operationId,
      step.seq,
      step.part,
      step.kind,
      step.ref,
      step.reversible ? 1 : 0,
      step.state,
      step.previous === undefined ? null : JSON.stringify(step.previous),
      step.detail ?? null,
    )
  }
}

/** Steps of one operation, in application order. */
export function readSteps(executor: SqlExecutor, operationId: string): readonly PlanMutationStep[] {
  return Object.freeze(
    executor
      .all('SELECT * FROM plan_mutation_step WHERE operation_id = ? ORDER BY seq', operationId)
      .map(row => {
        const previous = optionalText(row, 'previous')
        const detail = optionalText(row, 'detail')
        return Object.freeze({
          seq: requireInteger(row, 'seq'),
          part: requireText(row, 'part') as PlanMutationPartKind,
          kind: requireText(row, 'kind') as PlanStepKind,
          ref: requireText(row, 'ref'),
          reversible: requireInteger(row, 'reversible') === 1,
          state: requireText(row, 'state') as PlanStepState,
          ...(previous === undefined ? {} : { previous: decodeJson<Record<string, string>>(previous, 'step payload') }),
          ...(detail === undefined ? {} : { detail }),
        })
      }),
  )
}

/** One stored operation, with its steps. */
export function readMutation(executor: SqlExecutor, operationId: string): StagedPlanMutation | undefined {
  const row = executor.get('SELECT * FROM plan_mutation WHERE operation_id = ?', operationId)
  if (row === undefined) return undefined
  const report = optionalText(row, 'report')
  const failure = optionalText(row, 'failure')
  const policy = optionalText(row, 'running_task_policy')
  const mode = optionalText(row, 'mode')
  return Object.freeze({
    operationId: requireText(row, 'operation_id'),
    workspaceId: requireText(row, 'workspace_id'),
    correlationId: requireText(row, 'correlation_id'),
    baseRevision: requireInteger(row, 'base_revision'),
    origin: requireText(row, 'origin') as StagedPlanMutation['origin'],
    ...(policy === undefined ? {} : { runningTaskPolicy: policy as RunningTaskPolicy }),
    state: requireText(row, 'state') as StagedPlanMutationState,
    ...(mode === undefined ? {} : { mode: mode as 'atomic' | 'staged' }),
    intent: decodeJson<PlanMutationIntent>(requireText(row, 'intent'), 'plan mutation intent'),
    steps: readSteps(executor, operationId),
    created: decodeJson<Record<string, TaskId>>(requireText(row, 'created'), 'created ids'),
    ...(report === undefined ? {} : { report: decodeJson<IntegrityReport>(report, 'integrity report') }),
    ...(failure === undefined ? {} : { failure }),
    stagedAt: requireInteger(row, 'staged_at'),
    updatedAt: requireInteger(row, 'updated_at'),
  })
}

/** Operations that have not settled, oldest first. */
export function listPendingMutations(
  executor: SqlExecutor,
  workspaceId?: WorkspaceId,
): readonly StagedPlanMutation[] {
  const rows =
    workspaceId === undefined
      ? executor.all("SELECT operation_id FROM plan_mutation WHERE state IN ('staged','applying','recovery') ORDER BY staged_at, operation_id")
      : executor.all(
          "SELECT operation_id FROM plan_mutation WHERE workspace_id = ? AND state IN ('staged','applying','recovery') ORDER BY staged_at, operation_id",
          workspaceId,
        )
  const pending: StagedPlanMutation[] = []
  for (const row of rows) {
    const record = readMutation(executor, requireText(row, 'operation_id'))
    if (record !== undefined) pending.push(record)
  }
  return Object.freeze(pending)
}

/** Take the admission pause of one workspace. */
export function holdAdmission(executor: SqlExecutor, input: AdmissionHoldInput): AdmissionHold {
  executor.run(
    'INSERT INTO admission_hold (hold_id, workspace_id, operation_id, reason, held_at, released_at, released_by) VALUES (?, ?, ?, ?, ?, NULL, NULL)',
    input.holdId,
    input.workspaceId,
    input.operationId ?? null,
    input.reason,
    input.heldAt,
  )
  return Object.freeze({
    holdId: input.holdId,
    workspaceId: input.workspaceId,
    ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    reason: input.reason,
    heldAt: input.heldAt,
  })
}

/** Release one admission pause; `false` when it was already released. */
export function releaseAdmission(
  executor: SqlExecutor,
  holdId: string,
  at: number,
  releasedBy: string,
): boolean {
  const updated = executor.run(
    'UPDATE admission_hold SET released_at = ?, released_by = ? WHERE hold_id = ? AND released_at IS NULL',
    at,
    releasedBy,
    holdId,
  )
  return updated > 0
}

/** The open pause of one workspace, or of the installation. */
export function readOpenHold(executor: SqlExecutor, workspaceId?: WorkspaceId): AdmissionHold | undefined {
  const row =
    workspaceId === undefined
      ? executor.get('SELECT * FROM admission_hold WHERE released_at IS NULL ORDER BY held_at LIMIT 1')
      : executor.get(
          'SELECT * FROM admission_hold WHERE released_at IS NULL AND workspace_id = ? ORDER BY held_at LIMIT 1',
          workspaceId,
        )
  if (row === undefined) return undefined
  const operationId = optionalText(row, 'operation_id')
  return Object.freeze({
    holdId: requireText(row, 'hold_id'),
    workspaceId: requireText(row, 'workspace_id'),
    ...(operationId === undefined ? {} : { operationId }),
    reason: requireText(row, 'reason'),
    heldAt: requireInteger(row, 'held_at'),
  })
}

/** Insert a raised proposal. */
export function insertProposal(executor: SqlExecutor, record: WorkProposalRecord): void {
  executor.run(
    `INSERT INTO work_proposal
       (proposal_id, workspace_id, kind, task_id, detail, raised_by, correlation_id, state, operation_id, decided_by, decision_reason, raised_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.proposalId,
    record.workspaceId,
    record.kind,
    record.taskId ?? null,
    record.detail,
    record.raisedBy,
    record.correlationId,
    record.state,
    record.operationId ?? null,
    record.decidedBy ?? null,
    record.decisionReason ?? null,
    record.raisedAt,
    record.decidedAt ?? null,
  )
}

/** Decide a proposal. */
export function decideProposal(
  executor: SqlExecutor,
  proposalId: string,
  state: WorkProposalState,
  decision: PlanDecision,
  operationId?: string,
): void {
  const updated = executor.run(
    'UPDATE work_proposal SET state = ?, decided_by = ?, decision_reason = ?, decided_at = ?, operation_id = ? WHERE proposal_id = ?',
    state,
    decision.decidedBy,
    decision.reason ?? null,
    decision.at,
    operationId ?? null,
    proposalId,
  )
  if (updated === 0) {
    throw new PlanError('not-found', `dsh-mywork: no work proposal "${proposalId}" to decide`, {
      details: { proposalId },
    })
  }
}

/** One stored proposal. */
export function readProposal(executor: SqlExecutor, proposalId: string): WorkProposalRecord | undefined {
  const row = executor.get('SELECT * FROM work_proposal WHERE proposal_id = ?', proposalId)
  if (row === undefined) return undefined
  const taskId = optionalText(row, 'task_id')
  const operationId = optionalText(row, 'operation_id')
  const decidedBy = optionalText(row, 'decided_by')
  const decisionReason = optionalText(row, 'decision_reason')
  const decidedAt = row['decided_at']
  return Object.freeze({
    proposalId: requireText(row, 'proposal_id'),
    workspaceId: requireText(row, 'workspace_id'),
    kind: requireText(row, 'kind') as WorkProposalRecord['kind'],
    ...(taskId === undefined ? {} : { taskId }),
    detail: requireText(row, 'detail'),
    raisedBy: requireText(row, 'raised_by'),
    correlationId: requireText(row, 'correlation_id'),
    state: requireText(row, 'state') as WorkProposalState,
    raisedAt: requireInteger(row, 'raised_at'),
    ...(operationId === undefined ? {} : { operationId }),
    ...(decidedBy === undefined ? {} : { decidedBy }),
    ...(decisionReason === undefined ? {} : { decisionReason }),
    ...(typeof decidedAt === 'number' ? { decidedAt } : {}),
  })
}

/** Insert a gate decision; the gate itself is never stored (§5.5). */
export function insertGateDecision(executor: SqlExecutor, decision: BlockerResolutionDecision): void {
  executor.run(
    `INSERT INTO blocker_gate_decision
       (decision_id, workspace_id, blocker_task_id, action, dependent_ids, reason, artifact_id, operation_id, decided_by, decided_at, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    decision.decisionId,
    decision.workspaceId,
    decision.blockerTaskId,
    decision.action,
    JSON.stringify(decision.dependents),
    decision.reason ?? null,
    decision.artifactId ?? null,
    decision.operationId ?? null,
    decision.decidedBy,
    decision.decidedAt,
    decision.correlationId,
  )
}

/** Decisions recorded for one workspace, oldest first. */
export function readGateDecisions(
  executor: SqlExecutor,
  workspaceId: WorkspaceId,
  blockerTaskId?: TaskId,
): readonly BlockerResolutionDecision[] {
  const rows =
    blockerTaskId === undefined
      ? executor.all(
          'SELECT * FROM blocker_gate_decision WHERE workspace_id = ? ORDER BY decided_at, decision_id',
          workspaceId,
        )
      : executor.all(
          'SELECT * FROM blocker_gate_decision WHERE workspace_id = ? AND blocker_task_id = ? ORDER BY decided_at, decision_id',
          workspaceId,
          blockerTaskId,
        )
  return Object.freeze(
    rows.map(row => {
      const reason = optionalText(row, 'reason')
      const artifactId = optionalText(row, 'artifact_id')
      const decisionOperationId = optionalText(row, 'operation_id')
      return Object.freeze({
        decisionId: requireText(row, 'decision_id'),
        workspaceId: requireText(row, 'workspace_id'),
        blockerTaskId: requireText(row, 'blocker_task_id'),
        action: requireText(row, 'action') as BlockerResolutionAction,
        dependents: decodeJson<readonly TaskId[]>(requireText(row, 'dependent_ids'), 'gate decision dependents'),
        ...(reason === undefined ? {} : { reason }),
        ...(artifactId === undefined ? {} : { artifactId }),
        ...(decisionOperationId === undefined ? {} : { operationId: decisionOperationId }),
        decidedBy: requireText(row, 'decided_by'),
        decidedAt: requireInteger(row, 'decided_at'),
        correlationId: requireText(row, 'correlation_id'),
      })
    }),
  )
}

/** Reads and single writes bound to an open store. */
export interface PlanStore {
  /** The store this façade reads through. */
  readonly store: MyWorkStore
  /** Plan revision on record for a workspace. */
  planRevision(workspaceId: WorkspaceId): number
  /** One operation with its steps. */
  mutation(operationId: string): StagedPlanMutation | undefined
  /** Operations that have not settled. */
  pending(workspaceId?: WorkspaceId): readonly StagedPlanMutation[]
  /** The open admission pause, when there is one. */
  openHold(workspaceId?: WorkspaceId): AdmissionHold | undefined
  /** One proposal. */
  proposal(proposalId: string): WorkProposalRecord | undefined
  /** Decisions recorded for one workspace. */
  gateDecisions(workspaceId: WorkspaceId, blockerTaskId?: TaskId): readonly BlockerResolutionDecision[]
}

/**
 * Bind the plan tables to an open store.
 *
 * Every method opens its own transaction, so none of them may be called from
 * inside one; the planner uses the executor-level functions above when it needs
 * several writes to commit together.
 * @param store - store opened with {@link PLAN_MUTATION_MIGRATIONS}.
 * @throws {PlanError} `schema-missing` when the composition is incomplete.
 */
export function createPlanStore(store: MyWorkStore): PlanStore {
  assertPlanSchema(store)
  return Object.freeze({
    store,
    planRevision: (workspaceId: WorkspaceId): number =>
      store.transaction(tx => readPlanRevision(tx, workspaceId)),
    mutation: (operationId: string): StagedPlanMutation | undefined =>
      store.transaction(tx => readMutation(tx, operationId)),
    pending: (workspaceId?: WorkspaceId): readonly StagedPlanMutation[] =>
      store.transaction(tx => listPendingMutations(tx, workspaceId)),
    openHold: (workspaceId?: WorkspaceId): AdmissionHold | undefined =>
      store.transaction(tx => readOpenHold(tx, workspaceId)),
    proposal: (proposalId: string): WorkProposalRecord | undefined =>
      store.transaction(tx => readProposal(tx, proposalId)),
    gateDecisions: (workspaceId: WorkspaceId, blockerTaskId?: TaskId): readonly BlockerResolutionDecision[] =>
      store.transaction(tx => readGateDecisions(tx, workspaceId, blockerTaskId)),
  })
}

/** Every proposal kind, re-exported so a caller validates against the catalog. */
export const PLAN_PROPOSAL_KINDS = WORK_PROPOSAL_KINDS

/** Every staged state, re-exported for validation and tests. */
export const PLAN_STAGED_STATES = STAGED_PLAN_MUTATION_STATES

/** Every proposal state. */
export const PLAN_PROPOSAL_STATES = WORK_PROPOSAL_STATES

/** What a caller may raise, validated by the service. */
export type RaisedProposal = WorkProposalInput
