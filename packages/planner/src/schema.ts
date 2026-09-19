/**
 * The plan-mutation schema: the plan revision aggregate, the staged journal, the
 * durable admission pause, proposals, and gate decisions (architecture §7, §10;
 * ADR024, ADR028 §5.5).
 *
 * The tables live in the controller database of the §7 layout, because a staged
 * operation is the resident controller's recovery state: §49 answers "controller
 * died" with reconcile, and reconcile reads this journal. They share one file with
 * the audit and the artifact of the same operation on purpose — the state change,
 * its audit row, its evidence, and its outbox event commit together (§48), and
 * two databases cannot offer that.
 *
 * That makes the composition the caller's responsibility:
 *
 * ```ts
 * const store = await openStore({
 *   path,
 *   migrations: [
 *     ...MYWORK_MIGRATIONS,
 *     ...EVIDENCE_MIGRATIONS,
 *     ...LEASE_MIGRATIONS,
 *     ...PLAN_MUTATION_MIGRATIONS,
 *   ],
 * })
 * ```
 *
 * A store missing either of the two schemas this layer writes through is refused
 * when the planner is built, so a half-composed database fails where it was wired
 * rather than halfway through a staged operation.
 * @module
 */

import type { Migration, SqlExecutor } from '@dsh-mywork/storage'

/** Schema version the planner layer requires on disk. */
export const PLAN_MUTATION_SCHEMA_VERSION = 5

/** Journal label of the migration that creates the plan-mutation tables. */
export const PLAN_MUTATION_SCHEMA_NAME = 'plan-mutation'

/** Candidate states a stored mutation may hold, as the table enforces them. */
export const PLAN_MUTATION_STATE_CHECK = "('staged','applying','applied','recovery','reverted')"

/**
 * Version 5 — the plan-mutation tables.
 *
 * `plan_revision` is the aggregate every mutation compares against: the backend
 * has no workspace-wide plan revision, so MyWork owns it, and the compare-and-set
 * is a conditional `UPDATE` rather than a read-then-write (§9).
 *
 * `admission_hold` carries a partial unique index on the open holds of a
 * workspace: two staged operations cannot both pause admission, because the
 * second one would silently share a pause it did not take.
 *
 * `plan_mutation_step` keeps one row per journal step so an operator can read
 * which part landed without parsing the intent; `plan_mutation` keeps the intent
 * itself, so recovery always has the whole plan next to the actual state.
 */
const PLAN_MUTATION_DDL = `
CREATE TABLE plan_revision (
  workspace_id TEXT    PRIMARY KEY,
  revision     INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE plan_mutation (
  operation_id        TEXT    PRIMARY KEY,
  workspace_id        TEXT    NOT NULL,
  correlation_id      TEXT    NOT NULL,
  base_revision       INTEGER NOT NULL,
  origin              TEXT    NOT NULL CHECK (origin IN ('planner','replan','proposal')),
  running_task_policy TEXT,
  state               TEXT    NOT NULL CHECK (state IN ${PLAN_MUTATION_STATE_CHECK}),
  mode                TEXT    CHECK (mode IN ('atomic','staged')),
  intent              TEXT    NOT NULL,
  created             TEXT    NOT NULL DEFAULT '{}',
  report              TEXT,
  failure             TEXT,
  decided_by          TEXT,
  decision_reason     TEXT,
  staged_at           INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
) STRICT;

CREATE INDEX plan_mutation_pending ON plan_mutation (state, workspace_id);

CREATE TABLE plan_mutation_step (
  operation_id TEXT    NOT NULL,
  seq          INTEGER NOT NULL,
  part         TEXT    NOT NULL CHECK (part IN ('create','edges','fields','retire')),
  kind         TEXT    NOT NULL CHECK (kind IN ('create','update','add-edge','remove-edge','retire')),
  ref          TEXT    NOT NULL,
  reversible   INTEGER NOT NULL,
  state        TEXT    NOT NULL CHECK (state IN ('pending','applied','failed')),
  previous     TEXT,
  detail       TEXT,
  PRIMARY KEY (operation_id, seq)
) STRICT;

CREATE TABLE admission_hold (
  hold_id      TEXT    PRIMARY KEY,
  workspace_id TEXT    NOT NULL,
  operation_id TEXT,
  reason       TEXT    NOT NULL,
  held_at      INTEGER NOT NULL,
  released_at  INTEGER,
  released_by  TEXT
) STRICT;

CREATE UNIQUE INDEX admission_hold_open ON admission_hold (workspace_id) WHERE released_at IS NULL;

CREATE TABLE work_proposal (
  proposal_id     TEXT    PRIMARY KEY,
  workspace_id    TEXT    NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('blocker','follow-up','scope-change','dependency','security-risk')),
  task_id         TEXT,
  detail          TEXT    NOT NULL,
  raised_by       TEXT    NOT NULL,
  correlation_id  TEXT    NOT NULL,
  state           TEXT    NOT NULL CHECK (state IN ('open','accepted','rejected','superseded')),
  operation_id    TEXT,
  decided_by      TEXT,
  decision_reason TEXT,
  raised_at       INTEGER NOT NULL,
  decided_at      INTEGER
) STRICT;

CREATE INDEX work_proposal_open ON work_proposal (state, workspace_id);

CREATE TABLE blocker_gate_decision (
  decision_id      TEXT    PRIMARY KEY,
  workspace_id     TEXT    NOT NULL,
  blocker_task_id  TEXT    NOT NULL,
  action           TEXT    NOT NULL CHECK (action IN ('void','keep-blocking','supersede-dependent')),
  dependent_ids    TEXT    NOT NULL,
  reason           TEXT,
  artifact_id      TEXT,
  operation_id     TEXT,
  decided_by       TEXT    NOT NULL,
  decided_at       INTEGER NOT NULL,
  correlation_id   TEXT    NOT NULL
) STRICT;

CREATE INDEX blocker_gate_decision_gate ON blocker_gate_decision (workspace_id, blocker_task_id, decided_at);
`

/** The plan-mutation migrations, in version order. */
export const PLAN_MUTATION_MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({
    version: PLAN_MUTATION_SCHEMA_VERSION,
    name: PLAN_MUTATION_SCHEMA_NAME,
    up(context: SqlExecutor): void {
      context.exec(PLAN_MUTATION_DDL)
    },
  }),
])
