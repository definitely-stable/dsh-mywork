/**
 * The `attempt_worktree` schema: one durable binding per attempt (architecture
 * §19; MW-021, E-04).
 *
 * The claim saga already records the attempt, its lease, and its fence in the
 * controller database. §19 adds one more durable fact to that record — *which
 * checkout the attempt worked in*, cut from *which* base commit — and it belongs
 * in the same database for the same reason as the intent: a recovery has to be
 * able to answer "did this attempt have a worktree, and from where?" without
 * asking a port whose answer would be about the present rather than about the
 * attempt.
 *
 * The version is **allocated**, never written here: {@link createAttemptWorktreeMigration}
 * receives the number from the single allocator in the composition layer
 * (§15.3, F-63, D08), because `attempt_worktree` is one of several migrations
 * that must not collide — a hand-typed number is exactly the defect R-04 names.
 * @module
 */

import type { Migration, SqlExecutor } from '@dsh-mywork/storage'

import { ExecutionError } from './errors.ts'

/** Journal label of the migration that creates the binding table. */
export const ATTEMPT_WORKTREE_SCHEMA_NAME = 'attempt-worktree'

/** Table name, used by the schema assertion and by the store. */
export const ATTEMPT_WORKTREE_TABLE = 'attempt_worktree'

/**
 * The binding table.
 *
 * `attempt_id` is the primary key rather than a surrogate id, because one attempt
 * has at most one worktree — a second row would mean one attempt with two
 * checkouts, which is precisely the isolation §19 forbids. `base_sha` is checked
 * to be 40 characters by the database, so a truncated or abbreviated SHA cannot
 * be stored and later mistaken for a real pin. `head_sha` and `settled_at` stay
 * `NULL` until the attempt settles: a worktree whose head is not yet recorded is
 * one whose work is still going on.
 *
 * `path` and `branch` are `NOT NULL` and carry the values the port answered with;
 * the row is written *after* the checkout exists, so a row never describes a
 * worktree that was never created.
 */
export const ATTEMPT_WORKTREE_DDL = `
CREATE TABLE ${ATTEMPT_WORKTREE_TABLE} (
  attempt_id TEXT    PRIMARY KEY REFERENCES attempt(attempt_id),
  path       TEXT    NOT NULL,
  branch     TEXT    NOT NULL,
  base_sha   TEXT    NOT NULL CHECK (length(base_sha) = 40),
  head_sha   TEXT,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
) STRICT
`

/**
 * The migration that creates the binding table.
 *
 * The number comes from the version allocator (F-63) at the composition root;
 * passing it in is what keeps a literal out of this file (R-04).
 * @param version - the allocated version this migration brings the database to.
 * @throws {ExecutionError} `invalid-input` for a version that is not a positive integer.
 */
export function createAttemptWorktreeMigration(version: number): Migration {
  if (!Number.isInteger(version) || version < 1) {
    throw new ExecutionError(
      'invalid-input',
      `dsh-mywork: a migration version must be a positive integer allocated by the version allocator, received ${String(version)}`,
    )
  }
  return {
    version,
    name: ATTEMPT_WORKTREE_SCHEMA_NAME,
    up(context: SqlExecutor): void {
      context.exec(ATTEMPT_WORKTREE_DDL)
    },
  }
}
