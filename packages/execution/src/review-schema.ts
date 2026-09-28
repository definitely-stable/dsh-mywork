/**
 * The review-claim schema: the durable queue of reviews (architecture §18.3,
 * §19; E-19).
 *
 * A review is work of its own, so it gets its own claim — and only that. This
 * table owns **when** a review is queued, claimed, and settled; **what state the
 * task is in** stays in the Task Graph (`packages/contracts/src/taskgraph.ts`),
 * exactly as §7 lays it out. Two authorities over one fact is the defect this
 * separation exists to avoid.
 *
 * The version this migration carries is **handed out by the allocator** (F-63,
 * §15.3): a literal here would be a second place that numbers migrations, and
 * `validateMigrations` refuses a duplicate or an out-of-order version by
 * refusing to open the store at all (defect R-04). This module therefore
 * exports a factory, not a migration: the composition root allocates the number
 * and registers what the factory returns.
 *
 * ```ts
 * const reviewMigration = createReviewClaimMigration({
 *   version: allocator.allocate({ key: REVIEW_CLAIM_ALLOCATION_KEY }),
 * })
 * const store = await openStore({ path, migrations: [...MYWORK_MIGRATIONS, reviewMigration] })
 * ```
 *
 * The table lives in the same database as `attempt` and `claim_intent` (§7): a
 * review claim and the attempt it reviews are read together when a stale
 * approval is refused, so they must not be able to disagree across a crash.
 * @module
 */

import type { Migration, SqlExecutor } from '@dsh-mywork/storage'
import { REVIEW_STATES } from '@dsh-mywork/contracts'

/** Journal name of the migration that creates the review-claim table. */
export const REVIEW_CLAIM_SCHEMA_NAME = 'review-claim'

/**
 * Key the composition root requests the version under (F-63).
 *
 * Exported so the allocator's book and this module cannot drift: the number is
 * requested for this name and for no other.
 */
export const REVIEW_CLAIM_ALLOCATION_KEY = 'review_claim'

/** Table holding one row per review. */
export const REVIEW_CLAIM_TABLE = 'review_claim'

/**
 * Candidate states a stored review claim may hold, as the table enforces them.
 *
 * Built from the review contract rather than typed out, so a state the §18.3
 * machine knows but this table does not cannot be written: the CHECK and
 * `transitionReview` are two views of one dictionary.
 */
export const REVIEW_CLAIM_STATE_CHECK = `(${REVIEW_STATES.map(state => `'${state}'`).join(',')})`

/**
 * Columns of {@link REVIEW_CLAIM_TABLE} in stored order.
 *
 * Runtime data, so the queue can refuse a row it cannot read instead of reading
 * around a missing column.
 */
export const REVIEW_CLAIM_FIELDS: readonly string[] = Object.freeze([
  'review_id',
  'attempt_id',
  'task_id',
  'workspace_id',
  'worker_agent_id',
  'head_sha',
  'diff_hash',
  'state',
  'revision',
  'reviewer_id',
  'evidence',
  'verdict',
  'approval',
  'escalation',
  'handoff',
  'requested_at',
  'settled_at',
  'updated_at',
])

/**
 * The review-claim DDL.
 *
 * `evidence` and `verdict` hold JSON documents rather than nested tables: both
 * are immutable once written, both are read whole by whoever audits the review,
 * and neither is ever compared in a `WHERE` clause — while `state`, `revision`,
 * `head_sha`, and `diff_hash` are, which is why they are columns.
 *
 * `review_claim_idempotent` is the uniqueness §9 asks of every queue: one claim
 * per `(attempt_id, head_sha)`, so requesting the same review twice is the same
 * review rather than a second one. A new commit produces a new head SHA and
 * therefore a legitimately new review.
 */
const REVIEW_CLAIM_DDL = `
CREATE TABLE ${REVIEW_CLAIM_TABLE} (
  review_id       TEXT    PRIMARY KEY,
  attempt_id      TEXT    NOT NULL,
  task_id         TEXT    NOT NULL,
  workspace_id    TEXT    NOT NULL,
  worker_agent_id TEXT    NOT NULL,
  head_sha        TEXT    NOT NULL,
  diff_hash       TEXT    NOT NULL,
  state           TEXT    NOT NULL CHECK (state IN ${REVIEW_CLAIM_STATE_CHECK}),
  revision        INTEGER NOT NULL,
  reviewer_id     TEXT,
  evidence        TEXT,
  verdict         TEXT,
  approval        TEXT,
  escalation      TEXT,
  handoff         TEXT,
  requested_at    INTEGER NOT NULL,
  settled_at      INTEGER,
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX review_claim_idempotent ON ${REVIEW_CLAIM_TABLE} (attempt_id, head_sha);

CREATE INDEX review_claim_task ON ${REVIEW_CLAIM_TABLE} (task_id, requested_at);

CREATE INDEX review_claim_queue ON ${REVIEW_CLAIM_TABLE} (state, requested_at);
`

/** Options of {@link createReviewClaimMigration}. */
export interface ReviewClaimMigrationOptions {
  /**
   * Version handed out by the migration allocator (D08, §1.6). Never a literal
   * written here: the allocator is the only place that numbers migrations.
   */
  readonly version: number
  /** Journal name; defaults to {@link REVIEW_CLAIM_SCHEMA_NAME}. */
  readonly name?: string
}

/**
 * Build the review-claim migration for the version the allocator handed out.
 * @param options - the allocated version and an optional journal name.
 * @returns a frozen migration the caller registers with the store.
 * @throws {TypeError} when the version is not the positive integer an allocator
 *   hands out — a malformed number is a composition mistake, not a review
 *   failure, and it must not reach `openStore`.
 */
export function createReviewClaimMigration(options: ReviewClaimMigrationOptions): Migration {
  const version = options?.version
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError(
      `dsh-mywork: the review-claim migration needs the positive version the allocator handed out, received ${String(version)}`,
    )
  }
  const name = options.name ?? REVIEW_CLAIM_SCHEMA_NAME
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('dsh-mywork: the review-claim migration needs a non-empty journal name')
  }
  return Object.freeze({
    version,
    name,
    up(context: SqlExecutor): void {
      context.exec(REVIEW_CLAIM_DDL)
    },
  })
}
