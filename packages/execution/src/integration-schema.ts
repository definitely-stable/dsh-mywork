/**
 * The integration ledger: one row per integration operation, keyed by the
 * operation that asked for it (architecture §9, §19, §48; MW-025, E-28).
 *
 * §9 states that the Task Graph and MyWork DB share no transaction, so every
 * cross-store step is a saga plus idempotency. Integration is the last such step:
 * a commit lands in the checkout, gates run against the new head, and only then
 * does the graph move to `done`. A crash between any two of those leaves work
 * that must be *finished*, never repeated — and finishing it requires the
 * operation's own book, not a guess from the repository's state.
 *
 * That book is this table. `operation_id` is the primary key, so the row is the
 * compare-and-set: the insert either creates the operation or reports that
 * somebody already did, and every later write re-states the state it was read in.
 * `landed_head_sha` and `commit_sha` are what make a retry able to skip the
 * landing it already performed, and `refusal` is what makes a settled refusal
 * replayable instead of re-decided.
 *
 * The version of the migration is **allocated**, never written here:
 * {@link createIntegrationMigration} receives the number from the single
 * allocator in the composition layer (§15.3, D08, F-63), because a literal here
 * is how two migrations end up claiming one number and the store stops opening.
 * @module
 */

import { GIT_LANDING_STRATEGIES, type AttemptId, type GitLandingStrategy } from '@dsh-mywork/contracts'
import type { Migration, MigrationContext, SqlExecutor } from '@dsh-mywork/storage'

import { ExecutionError } from './errors.ts'

/** Journal label of the migration that creates the integration ledger. */
export const INTEGRATION_SCHEMA_NAME = 'integration-operation'

/**
 * Where one integration operation is in its lifecycle.
 *
 * The first three states are *in progress*: a retry resumes from them instead of
 * starting over. The last two are settled: a retry replays the recorded outcome
 * and touches neither the repository nor the graph.
 */
export type IntegrationState =
  /** The operation was admitted and the landing is in progress. */
  | 'landing'
  /** The approved result is committed in the target checkout; gates are owed. */
  | 'landed'
  /** Gates ran and at least one was not green; the head may be gated again. */
  | 'gated'
  /** Terminal: the graph records the task as `done`. */
  | 'done'
  /** Terminal: a human must decide; the graph records `needs-attention`. */
  | 'needs-attention'

/** Every state, in lifecycle order. */
export const INTEGRATION_STATES: readonly IntegrationState[] = Object.freeze([
  'landing',
  'landed',
  'gated',
  'done',
  'needs-attention',
])

/** States from which a retry replays the recorded outcome instead of working. */
export const INTEGRATION_TERMINAL_STATES: readonly IntegrationState[] = Object.freeze(['done', 'needs-attention'])

/** Candidate states as a SQL list, derived from the dictionary above. */
const STATE_SQL = INTEGRATION_STATES.map(state => `'${state}'`).join(', ')

/** Landing strategies as a SQL list, derived from the contract so the two cannot drift. */
const STRATEGY_SQL = GIT_LANDING_STRATEGIES.map(strategy => `'${strategy}'`).join(', ')

/**
 * The ledger table.
 *
 * `gates` and `refusal` hold JSON documents: a gate result set is a list of
 * contract shapes and a refusal is a §42 error shape, and both are read back by
 * this layer alone. They are TEXT rather than nested tables because they are
 * never queried by field — the questions asked of this table are "which
 * operation" and "where did it stop", and those are columns.
 */
export const INTEGRATION_OPERATION_DDL = `
CREATE TABLE integration_operation (
  operation_id       TEXT    NOT NULL PRIMARY KEY,
  task_id            TEXT    NOT NULL,
  attempt_id         TEXT    NOT NULL,
  workspace_id       TEXT    NOT NULL,
  state              TEXT    NOT NULL CHECK (state IN (${STATE_SQL})),
  strategy           TEXT    NOT NULL CHECK (strategy IN (${STRATEGY_SQL})),
  base_sha           TEXT    NOT NULL,
  approved_head_sha  TEXT    NOT NULL,
  approved_diff_hash TEXT    NOT NULL,
  landed_head_sha    TEXT,
  commit_sha         TEXT,
  graph_revision     INTEGER,
  gates              TEXT,
  refusal            TEXT,
  attention_reason   TEXT,
  attention_marker   TEXT,
  decision_marker    TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
) STRICT
`

/** The index an operator reads: the open operations of one task. */
export const INTEGRATION_OPERATION_INDEX_DDL =
  'CREATE INDEX integration_operation_task ON integration_operation (task_id, state)'

/**
 * The migration that creates the integration ledger.
 *
 * The number comes from the version allocator (F-63) at the composition root;
 * passing it in is what keeps a literal out of this file (D08, R-04).
 * @param version - the allocated version this migration brings the database to.
 * @throws {ExecutionError} `invalid-input` for a version that is not a positive integer.
 */
export function createIntegrationMigration(version: number): Migration {
  if (!Number.isInteger(version) || version < 1) {
    throw new ExecutionError(
      'invalid-input',
      `dsh-mywork: a migration version must be a positive integer allocated by the version allocator, received ${String(version)}`,
      { details: { version: Number.isFinite(version) ? version : null } },
    )
  }
  return {
    version,
    name: INTEGRATION_SCHEMA_NAME,
    up(context: MigrationContext): void {
      context.exec(INTEGRATION_OPERATION_DDL)
      context.exec(INTEGRATION_OPERATION_INDEX_DDL)
    },
  }
}

/** One `integration_operation` row as this layer reads and writes it. */
export interface IntegrationOperationRecord {
  /** Operation identity; the idempotency key of the whole integration. */
  readonly operationId: string
  /** Task the approved attempt belongs to. */
  readonly taskId: string
  /** Attempt whose result was approved. */
  readonly attemptId: AttemptId
  /** Workspace the task belongs to. */
  readonly workspaceId: string
  /** Where the operation is in its lifecycle. */
  readonly state: IntegrationState
  /** How the approved result was brought into the target branch. */
  readonly strategy: GitLandingStrategy
  /** Revision the attempt started from. */
  readonly baseSha: string
  /** Head SHA the approval was bound to. */
  readonly approvedHeadSha: string
  /** Diff hash the approval was bound to. */
  readonly approvedDiffHash: string
  /** Head after the integrator's commit; `null` before the landing. */
  readonly landedHeadSha: string | null
  /** Commit the integrator created, carrying the `Refs: mw-<hash>` trailer. */
  readonly commitSha: string | null
  /** Graph revision the final transition observed; `null` until `done`. */
  readonly graphRevision: number | null
  /** Serialised gate results of the last gate run; `null` before one ran. */
  readonly gates: string | null
  /** Serialised §42 error shape of the last refusal; `null` when none was recorded. */
  readonly refusal: string | null
  /** `needs-attention` reason of a settled escalation; `null` when none was raised. */
  readonly attentionReason: string | null
  /** Marker the board carrier returned for the attention record. */
  readonly attentionMarker: string | null
  /** Marker of the requested human decision (`D14`/`MW-030` owns the entity). */
  readonly decisionMarker: string | null
  /** Clock reading of the insert. */
  readonly createdAt: number
  /** Clock reading of the last write. */
  readonly updatedAt: number
}

/** Fields a caller may change after the row exists; the rest are immutable identity. */
export interface IntegrationOperationPatch {
  /** Next state. */
  readonly state?: IntegrationState
  /** Head after the integrator's commit. */
  readonly landedHeadSha?: string
  /** Commit the integrator created. */
  readonly commitSha?: string
  /** Graph revision the final transition observed. */
  readonly graphRevision?: number
  /** Serialised gate results of the last run. */
  readonly gates?: string
  /** Serialised refusal to record. */
  readonly refusal?: string
  /** Reason of a settled escalation. */
  readonly attentionReason?: string
  /** Marker of the attention record. */
  readonly attentionMarker?: string
  /** Marker of the requested human decision. */
  readonly decisionMarker?: string
}

/** One row as SQLite returns it. */
interface IntegrationRow {
  readonly operation_id: string
  readonly task_id: string
  readonly attempt_id: string
  readonly workspace_id: string
  readonly state: string
  readonly strategy: string
  readonly base_sha: string
  readonly approved_head_sha: string
  readonly approved_diff_hash: string
  readonly landed_head_sha: string | null
  readonly commit_sha: string | null
  readonly graph_revision: number | null
  readonly gates: string | null
  readonly refusal: string | null
  readonly attention_reason: string | null
  readonly attention_marker: string | null
  readonly decision_marker: string | null
  readonly created_at: number
  readonly updated_at: number
}

/** Read one row into the frozen record shape. */
function toRecord(row: IntegrationRow): IntegrationOperationRecord {
  return Object.freeze({
    operationId: String(row.operation_id),
    taskId: String(row.task_id),
    attemptId: String(row.attempt_id),
    workspaceId: String(row.workspace_id),
    state: String(row.state) as IntegrationState,
    strategy: String(row.strategy) as GitLandingStrategy,
    baseSha: String(row.base_sha),
    approvedHeadSha: String(row.approved_head_sha),
    approvedDiffHash: String(row.approved_diff_hash),
    landedHeadSha: row.landed_head_sha === null ? null : String(row.landed_head_sha),
    commitSha: row.commit_sha === null ? null : String(row.commit_sha),
    graphRevision: row.graph_revision === null ? null : Number(row.graph_revision),
    gates: row.gates === null ? null : String(row.gates),
    refusal: row.refusal === null ? null : String(row.refusal),
    attentionReason: row.attention_reason === null ? null : String(row.attention_reason),
    attentionMarker: row.attention_marker === null ? null : String(row.attention_marker),
    decisionMarker: row.decision_marker === null ? null : String(row.decision_marker),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  })
}

/**
 * Claim one integration operation.
 *
 * The insert is the compare-and-set: `ON CONFLICT DO NOTHING` makes the second
 * caller of one `operationId` observe zero changed rows instead of a duplicate,
 * so a retry can be told "this operation exists" without a read-then-write race.
 * @param executor - transaction to write through.
 * @param record - the operation's identity and its first state.
 * @returns true when this caller created the row, false when it already existed.
 */
export function insertIntegrationOperation(executor: SqlExecutor, record: IntegrationOperationRecord): boolean {
  const changed = executor.run(
    `INSERT INTO integration_operation (
       operation_id, task_id, attempt_id, workspace_id, state, strategy,
       base_sha, approved_head_sha, approved_diff_hash,
       landed_head_sha, commit_sha, graph_revision, gates, refusal,
       attention_reason, attention_marker, decision_marker, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (operation_id) DO NOTHING`,
    record.operationId,
    record.taskId,
    record.attemptId,
    record.workspaceId,
    record.state,
    record.strategy,
    record.baseSha,
    record.approvedHeadSha,
    record.approvedDiffHash,
    record.landedHeadSha,
    record.commitSha,
    record.graphRevision,
    record.gates,
    record.refusal,
    record.attentionReason,
    record.attentionMarker,
    record.decisionMarker,
    record.createdAt,
    record.updatedAt,
  )
  return changed === 1
}

/**
 * Read one integration operation.
 * @param executor - transaction to read through.
 * @param operationId - operation identity.
 * @returns the record, or `undefined` when the operation was never admitted.
 */
export function readIntegrationOperation(
  executor: SqlExecutor,
  operationId: string,
): IntegrationOperationRecord | undefined {
  const row = executor.get('SELECT * FROM integration_operation WHERE operation_id = ?', operationId)
  return row === undefined ? undefined : toRecord(row as unknown as IntegrationRow)
}

/**
 * Advance one integration operation, guarded by the state it was read in.
 *
 * The `WHERE` clause re-states the observed state, so two callers that read the
 * same row cannot both apply a patch: the loser observes zero changed rows and
 * must re-read instead of overwriting the winner's decision.
 * @param executor - transaction to write through.
 * @param operationId - operation identity.
 * @param from - state the caller observed.
 * @param patch - fields to change, plus the clock reading of the write.
 * @returns true when this caller's patch was the one applied.
 */
export function advanceIntegrationOperation(
  executor: SqlExecutor,
  operationId: string,
  from: IntegrationState,
  patch: IntegrationOperationPatch & { readonly at: number },
): boolean {
  const changed = executor.run(
    `UPDATE integration_operation
        SET state            = COALESCE(?, state),
            landed_head_sha  = COALESCE(?, landed_head_sha),
            commit_sha       = COALESCE(?, commit_sha),
            graph_revision   = COALESCE(?, graph_revision),
            gates            = COALESCE(?, gates),
            refusal          = COALESCE(?, refusal),
            attention_reason = COALESCE(?, attention_reason),
            attention_marker = COALESCE(?, attention_marker),
            decision_marker  = COALESCE(?, decision_marker),
            updated_at       = ?
      WHERE operation_id = ? AND state = ?`,
    patch.state ?? null,
    patch.landedHeadSha ?? null,
    patch.commitSha ?? null,
    patch.graphRevision ?? null,
    patch.gates ?? null,
    patch.refusal ?? null,
    patch.attentionReason ?? null,
    patch.attentionMarker ?? null,
    patch.decisionMarker ?? null,
    patch.at,
    operationId,
    from,
  )
  return changed === 1
}

/** Whether a state settles the operation, so a retry must replay instead of work. */
export function isIntegrationTerminal(state: IntegrationState): boolean {
  return INTEGRATION_TERMINAL_STATES.includes(state)
}
