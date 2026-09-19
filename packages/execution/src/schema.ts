/**
 * The claim-saga schema: the durable intent, its step journal, the attempts with
 * their leases and fences, and the per-task fence allocator (architecture §7,
 * §9, §17, §18.2, §48).
 *
 * The tables live in the controller database of the §7 layout, next to the
 * plan-mutation journal and for the same reason: the intent, its audit row, its
 * artifact, and its outbox event must commit together (§48), and two databases
 * cannot offer that. They share one file with the plan tables on purpose — a
 * claim and a replan are both cross-store sagas over the same graph.
 *
 * Two invariants are enforced by the database rather than by this layer's code,
 * because they are the ones a bug in the layer must not be able to break:
 *
 * - **At most one authoritative lease per task.** `attempt_task_live_lease` is a
 *   partial unique index over the attempts that have not settled, so a second
 *   live attempt on one task is refused by SQLite itself. That is the §17 rule
 *   the card's third acceptance criterion names, and it is the same technique
 *   `admission_hold_open` uses for the plan pause.
 * - **The fence never goes backwards.** The allocator is an `UPDATE ... SET
 *   fence = fence + 1`, and a `BEFORE UPDATE` trigger aborts any write that would
 *   lower it, so a superseded fence token can never be handed out again (§17).
 *
 * The composition is the caller's responsibility, exactly as it is for the
 * planner:
 *
 * ```ts
 * const store = await openStore({
 *   path,
 *   migrations: [
 *     ...MYWORK_MIGRATIONS,
 *     ...EVIDENCE_MIGRATIONS,
 *     ...LEASE_MIGRATIONS,
 *     ...CLAIM_SAGA_MIGRATIONS,
 *   ],
 * })
 * ```
 *
 * A store missing any schema this layer writes through is refused when the saga
 * is built, so a half-composed database fails where it was wired instead of
 * halfway through a claim.
 * @module
 */

import type { Migration, SqlExecutor } from '@dsh-mywork/storage'

/** Schema version the claim saga requires on disk. */
export const CLAIM_SAGA_SCHEMA_VERSION = 6

/** Journal label of the migration that creates the claim-saga tables. */
export const CLAIM_SAGA_SCHEMA_NAME = 'claim-saga'

/** What the database reports when a fence is written that is not an advance. */
export const FENCE_NOT_MONOTONIC_MARKER = 'mywork.execution.fence-not-monotonic'

/** Candidate states a stored claim intent may hold, as the table enforces them. */
export const CLAIM_INTENT_STATE_CHECK =
  "('recorded','claimed','attempted','projected','completed','recovering','recovered','revoked','abandoned')"

/** Candidate states a stored attempt may hold, as the table enforces them. */
export const ATTEMPT_STATE_CHECK =
  "('created','leased','starting','running','settling','completed','failed','timed-out','cancelled','revoked','stale')"

/** Candidate states a stored step may hold. */
export const CLAIM_STEP_STATE_CHECK = "('pending','applied','failed')"

/**
 * Version 6 — the claim saga.
 *
 * `claim_intent.claimant` is stored rather than derived. The graph records the
 * claimant as the assignee, and §49's "attempt exists, agent does not" case has
 * to tell "this worker still holds the claim" from "somebody else does" with no
 * live worker to ask — which is only answerable if the saga remembers who it
 * claimed for.
 *
 * `attempt` carries the fence and the epoch as columns rather than as a nested
 * JSON blob, because both are compared in `WHERE` clauses by the authority
 * checks: a guard that had to parse a document first would be a guard a caller
 * could race.
 *
 * `claim_intent.agent_id` and `lease_ms` are recorded at step 1 for the same
 * reason as `claimant`: a recovery finishes the saga that a crash left behind, and
 * the attempt it creates must name the agent the work was admitted for and a lease
 * window that came from the caller — not a synthetic value invented at recovery
 * time (§17).
 */
const CLAIM_SAGA_DDL = `
CREATE TABLE claim_intent (
  operation_id     TEXT    PRIMARY KEY,
  correlation_id   TEXT    NOT NULL,
  workspace_id     TEXT    NOT NULL,
  task_id          TEXT    NOT NULL,
  claimant         TEXT    NOT NULL,
  controller_epoch INTEGER NOT NULL,
  base_revision    INTEGER NOT NULL,
  state            TEXT    NOT NULL CHECK (state IN ${CLAIM_INTENT_STATE_CHECK}),
  attempt_id       TEXT,
  fence            INTEGER,
  holder           TEXT,
  failure          TEXT,
  decided_by       TEXT,
  decision_reason  TEXT,
  agent_id         TEXT,
  lease_ms         INTEGER,
  recorded_at      INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
) STRICT;

CREATE INDEX claim_intent_open ON claim_intent (state, workspace_id);

CREATE TABLE claim_step (
  operation_id TEXT    NOT NULL,
  seq          INTEGER NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('intent','claim','attempt','projection','complete')),
  state        TEXT    NOT NULL CHECK (state IN ${CLAIM_STEP_STATE_CHECK}),
  detail       TEXT,
  PRIMARY KEY (operation_id, seq)
) STRICT;

CREATE TABLE attempt (
  attempt_id       TEXT    PRIMARY KEY,
  task_id          TEXT    NOT NULL,
  workspace_id     TEXT    NOT NULL,
  agent_id         TEXT    NOT NULL,
  state            TEXT    NOT NULL CHECK (state IN ${ATTEMPT_STATE_CHECK}),
  revision         INTEGER NOT NULL,
  fence            INTEGER NOT NULL,
  controller_epoch INTEGER NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  operation_id     TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  settled_at       INTEGER
) STRICT;

CREATE UNIQUE INDEX attempt_task_live_lease ON attempt (task_id) WHERE settled_at IS NULL;

CREATE INDEX attempt_live ON attempt (settled_at, task_id);

CREATE TABLE task_fence (
  task_id    TEXT    PRIMARY KEY,
  fence      INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TRIGGER task_fence_monotonic BEFORE UPDATE ON task_fence
WHEN NEW.fence < OLD.fence
BEGIN
  SELECT RAISE(ABORT, '${FENCE_NOT_MONOTONIC_MARKER}');
END;
`

/** The claim-saga migrations, in version order. */
export const CLAIM_SAGA_MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({
    version: CLAIM_SAGA_SCHEMA_VERSION,
    name: CLAIM_SAGA_SCHEMA_NAME,
    up(context: SqlExecutor): void {
      context.exec(CLAIM_SAGA_DDL)
    },
  }),
])
