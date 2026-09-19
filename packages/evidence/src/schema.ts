/**
 * The evidence schema: the Artifact Store (§32) and the append-only Audit (§34)
 * as tables of the MyWork database.
 *
 * Immutability is enforced by the DATABASE, not only by this layer's code, and
 * it is enforced against every write form rather than the two obvious ones:
 * `UPDATE` and `DELETE` abort on both tables, and a `BEFORE INSERT` guard
 * aborts a statement that would collide with an existing identity — without it,
 * `INSERT OR REPLACE` (plain DML) would rewrite a row through a path that fires
 * no delete trigger. The connection runs with `recursive_triggers = 0`, so the
 * guards must not rely on one trigger firing another. The layer's own checks
 * exist to report a conflict clearly, not to be the only thing standing between
 * an artifact and its overwrite.
 *
 * The replace guards live in their OWN migration (v3) rather than in the table
 * migration (v2): a migration that has been applied is never edited, because a
 * database created by an earlier build would silently keep the old schema. A
 * version-2 database therefore reaches the same guarded state as a fresh one by
 * applying v3.
 * @module
 */

import type { Migration, SqlExecutor } from '@dsh-mywork/storage'

/** Schema version the evidence layer requires on disk. */
export const EVIDENCE_SCHEMA_VERSION = 3

/** Name of the migration that completes the evidence schema. */
export const EVIDENCE_SCHEMA_NAME = 'evidence-immutability'

/** Journal label of the migration that creates the tables. */
export const EVIDENCE_TABLES_MIGRATION_NAME = 'artifact-audit'

/** What the database reports when an immutable artifact row is written. */
export const ARTIFACT_IMMUTABLE_MARKER = 'mywork.artifact.immutable'

/** What the database reports when an append-only audit row is rewritten. */
export const AUDIT_APPEND_ONLY_MARKER = 'mywork.audit.append-only'

/**
 * Version 2 — the tables.
 *
 * Both tables are STRICT, like the kernel tables: a value of the wrong type is
 * refused by SQLite instead of being coerced silently.
 */
const EVIDENCE_TABLES_DDL = `
CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  task_id TEXT,
  attempt_id TEXT,
  review_id TEXT,
  causation_id TEXT,
  bytes BLOB NOT NULL
) STRICT;

CREATE INDEX artifacts_workspace ON artifacts(workspace_id, created_at);

CREATE TRIGGER artifacts_no_update BEFORE UPDATE ON artifacts
BEGIN
  SELECT RAISE(ABORT, '${ARTIFACT_IMMUTABLE_MARKER}');
END;

CREATE TRIGGER artifacts_no_delete BEFORE DELETE ON artifacts
BEGIN
  SELECT RAISE(ABORT, '${ARTIFACT_IMMUTABLE_MARKER}');
END;

CREATE TABLE audit_events (
  position INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  task_id TEXT,
  attempt_id TEXT,
  review_id TEXT,
  agent_id TEXT,
  artifact_id TEXT,
  causation_id TEXT
) STRICT;

CREATE INDEX audit_events_workspace ON audit_events(workspace_id, position);

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, '${AUDIT_APPEND_ONLY_MARKER}');
END;

CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, '${AUDIT_APPEND_ONLY_MARKER}');
END;
`

/**
 * Version 3 — the REPLACE guards.
 *
 * The kernel opens the database with recursive_triggers = 0, so the implicit
 * delete REPLACE performs on the conflicting row fires NO delete trigger.
 * Guarding UPDATE and DELETE alone therefore leaves INSERT OR REPLACE — plain
 * DML, no DDL needed — free to rewrite a row. A BEFORE INSERT guard closes it:
 * a statement that would collide with an existing identity is aborted, so
 * REPLACE never gets the chance to delete anything. IF NOT EXISTS keeps the
 * migration replayable on a database that already has them.
 */
const EVIDENCE_REPLACE_GUARDS_DDL = `
CREATE TRIGGER IF NOT EXISTS artifacts_no_replace BEFORE INSERT ON artifacts
WHEN EXISTS (SELECT 1 FROM artifacts WHERE artifact_id = NEW.artifact_id)
BEGIN
  SELECT RAISE(ABORT, '${ARTIFACT_IMMUTABLE_MARKER}');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_no_replace BEFORE INSERT ON audit_events
WHEN EXISTS (SELECT 1 FROM audit_events WHERE audit_id = NEW.audit_id)
BEGIN
  SELECT RAISE(ABORT, '${AUDIT_APPEND_ONLY_MARKER}');
END;
`

/**
 * The evidence migrations, in version order.
 *
 * A caller composes them with the storage kernel's own list — the kernel is not
 * optional, it owns `schema_migrations`:
 *
 * ```ts
 * await openStore({ path, migrations: [...MYWORK_MIGRATIONS, ...EVIDENCE_MIGRATIONS] })
 * ```
 */
export const EVIDENCE_MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({
    version: 2,
    name: EVIDENCE_TABLES_MIGRATION_NAME,
    up(context: SqlExecutor): void {
      context.exec(EVIDENCE_TABLES_DDL)
    },
  }),
  Object.freeze({
    version: EVIDENCE_SCHEMA_VERSION,
    name: EVIDENCE_SCHEMA_NAME,
    up(context: SqlExecutor): void {
      context.exec(EVIDENCE_REPLACE_GUARDS_DDL)
    },
  }),
])
