/**
 * Durable statements of the attempt↔worktree binding (architecture §19; MW-021,
 * E-04).
 *
 * The row is written **after** the checkout exists and **before** the attempt is
 * allowed to do any work, and every statement here is a single guarded write so a
 * repeated call is a compare-and-set rather than a hopeful overwrite. That
 * ordering is what makes the two crash windows of §19 distinguishable:
 *
 * - a saga that stopped before the row was written leaves an attempt with no
 *   binding — nothing was handed to a worker, so a reconciler may abandon it or
 *   repeat the creation;
 * - a binding whose `head_sha` is `NULL` is an attempt that has not settled, which
 *   is why `settleAttemptWorktree` is the only writer of the head.
 * @module
 */

import type { SqlExecutor } from '@dsh-mywork/storage'
import type { AttemptId, EpochMs, WorkspaceId } from '@dsh-mywork/contracts'

import { ExecutionError } from './errors.ts'
import { ATTEMPT_WORKTREE_TABLE } from './worktree-schema.ts'

/** One `attempt_worktree` row, in the shape the contract names. */
export interface AttemptWorktreeRecord {
  /** Attempt the checkout belongs to. */
  readonly attemptId: AttemptId
  /** Absolute directory of the checkout. */
  readonly path: string
  /** Branch the checkout is on. */
  readonly branch: string
  /** Base commit the branch was cut from. */
  readonly baseSha: string
  /** Head commit the attempt finished on; absent until it settled. */
  readonly headSha?: string
  /** Clock reading of the binding. */
  readonly createdAt: EpochMs
  /** Clock reading of the settlement; absent while the attempt is live. */
  readonly settledAt?: EpochMs
}

/** What the store needs to record a binding. */
export interface AttemptWorktreeInput {
  /** Attempt the checkout belongs to. */
  readonly attemptId: AttemptId
  /** Absolute directory of the checkout. */
  readonly path: string
  /** Branch the checkout is on. */
  readonly branch: string
  /** Base commit the branch was cut from, as 40 lowercase hex characters. */
  readonly baseSha: string
  /** Clock reading of the binding. */
  readonly createdAt: EpochMs
}

/** One `attempt_worktree` row as SQLite returns it. */
interface WorktreeRow {
  readonly attempt_id: string
  readonly path: string
  readonly branch: string
  readonly base_sha: string
  readonly head_sha: string | null
  readonly created_at: number
  readonly settled_at: number | null
}

/** Read one row into the record shape. */
function toRecord(row: WorktreeRow): AttemptWorktreeRecord {
  return Object.freeze({
    attemptId: String(row.attempt_id),
    path: String(row.path),
    branch: String(row.branch),
    baseSha: String(row.base_sha),
    ...(row.head_sha === null ? {} : { headSha: String(row.head_sha) }),
    createdAt: Number(row.created_at),
    ...(row.settled_at === null ? {} : { settledAt: Number(row.settled_at) }),
  })
}

/** A non-empty string, refused before the statement is built. */
function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ExecutionError('invalid-input', `dsh-mywork: ${field} must be a non-empty string`)
  }
  return value
}

/** A 40-character lowercase object name, refused before the statement is built. */
function requireSha(value: unknown, field: string): string {
  const sha = requireText(value, field)
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new ExecutionError('invalid-input', `dsh-mywork: ${field} must be 40 lowercase hex characters, received "${sha}"`)
  }
  return sha
}

/**
 * Record the checkout one attempt works in (§19).
 *
 * Written after `prepare` answered, so the row is a statement about a directory
 * that exists. A second row for the same attempt is refused by the primary key,
 * and the refusal is reported as a typed conflict rather than as a raw SQLite
 * error: one attempt with two checkouts is the isolation failure §19 forbids, and
 * a caller has to be able to tell it from a bug.
 * @param executor - transaction to write through.
 * @param input - attempt, path, branch, base commit, and clock reading.
 * @throws {ExecutionError} `invalid-input` for a malformed field.
 * @throws {ExecutionError} `conflict` when the attempt already has a binding.
 */
export function insertAttemptWorktree(executor: SqlExecutor, input: AttemptWorktreeInput): AttemptWorktreeRecord {
  const attemptId = requireText(input?.attemptId, 'attemptId')
  const path = requireText(input?.path, 'path')
  const branch = requireText(input?.branch, 'branch')
  const baseSha = requireSha(input?.baseSha, 'baseSha')
  try {
    executor.run(
      `INSERT INTO ${ATTEMPT_WORKTREE_TABLE} (attempt_id, path, branch, base_sha, head_sha, created_at, settled_at)
       VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
      attemptId,
      path,
      branch,
      baseSha,
      input.createdAt,
    )
  } catch (error) {
    throw new ExecutionError(
      'conflict',
      `dsh-mywork: attempt "${attemptId}" already has a worktree binding; one attempt cannot own two checkouts`,
      { details: { attemptId, path }, cause: error },
    )
  }
  const row = executor.get(`SELECT * FROM ${ATTEMPT_WORKTREE_TABLE} WHERE attempt_id = ?`, attemptId)
  if (row === undefined) {
    throw new ExecutionError('conflict', `dsh-mywork: the worktree binding of attempt "${attemptId}" was not recorded`)
  }
  return toRecord(row as unknown as WorktreeRow)
}

/** The checkout of one attempt, if it has one. */
export function readAttemptWorktree(executor: SqlExecutor, attemptId: AttemptId): AttemptWorktreeRecord | undefined {
  const row = executor.get(`SELECT * FROM ${ATTEMPT_WORKTREE_TABLE} WHERE attempt_id = ?`, attemptId)
  return row === undefined ? undefined : toRecord(row as unknown as WorktreeRow)
}

/**
 * Record the head an attempt finished on.
 *
 * `settled_at` is what makes the binding final, so it is written in the same
 * statement that writes the head: a row with a head but no settlement would say
 * the attempt is still running, and one with a settlement but no head would leave
 * §19's "head after the work" unanswerable.
 * @param executor - transaction to write through.
 * @param attemptId - attempt to settle.
 * @param headSha - head commit the worktree is on, as 40 lowercase hex characters.
 * @param at - clock reading of the settlement.
 * @returns whether this caller settled the binding; `false` means it was already settled.
 */
export function settleAttemptWorktree(
  executor: SqlExecutor,
  attemptId: AttemptId,
  headSha: string,
  at: EpochMs,
): boolean {
  const id = requireText(attemptId, 'attemptId')
  const sha = requireSha(headSha, 'headSha')
  const changed = executor.run(
    `UPDATE ${ATTEMPT_WORKTREE_TABLE} SET head_sha = ?, settled_at = ? WHERE attempt_id = ? AND settled_at IS NULL`,
    sha,
    at,
    id,
  )
  return changed === 1
}

/**
 * Every binding of one workspace, oldest first.
 *
 * The workspace is not a column of the table: it belongs to the attempt, and the
 * join is what keeps one truth about it instead of two copies that can disagree.
 * @param executor - transaction to read through.
 * @param workspaceId - workspace to list; every workspace when absent.
 */
export function listAttemptWorktrees(executor: SqlExecutor, workspaceId?: WorkspaceId): readonly AttemptWorktreeRecord[] {
  const rows =
    workspaceId === undefined
      ? executor.all(`SELECT * FROM ${ATTEMPT_WORKTREE_TABLE} ORDER BY created_at, attempt_id`)
      : executor.all(
          `SELECT worktree.* FROM ${ATTEMPT_WORKTREE_TABLE} AS worktree
             JOIN attempt ON attempt.attempt_id = worktree.attempt_id
            WHERE attempt.workspace_id = ?
            ORDER BY worktree.created_at, worktree.attempt_id`,
          workspaceId,
        )
  return Object.freeze(rows.map(row => toRecord(row as unknown as WorktreeRow)))
}

/**
 * Verify that the binding table is on disk.
 *
 * The saga refuses to run with a store that lacks a schema it writes through, and
 * it has to do so **without knowing the version**: the number is allocated at the
 * composition root (F-63, D08), so the table's name — not a literal version — is
 * what this check reads. A missing table therefore names the migration factory
 * the composition root forgot, instead of failing halfway through a claim.
 * @param executor - transaction to read the catalogue through.
 * @throws {ExecutionError} `schema-missing` when `attempt_worktree` is absent.
 */
export function assertAttemptWorktreeSchema(executor: SqlExecutor): void {
  const found = executor.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", ATTEMPT_WORKTREE_TABLE)
  if (found === undefined) {
    throw new ExecutionError(
      'schema-missing',
      `dsh-mywork: the store is missing the "${ATTEMPT_WORKTREE_TABLE}" table; open it with createAttemptWorktreeMigration(<version allocated by the migration allocator>)`,
      { details: { table: ATTEMPT_WORKTREE_TABLE, schema: 'attempt-worktree' } },
    )
  }
}
