/**
 * The controller-lease schema: one row holding the leadership record of
 * architecture §5.3, keyed by the installation scope it protects.
 *
 * The row is the single CAS target for leadership. `epoch` only ever moves
 * forward (enforced by the database, not by this layer's code), so a controller
 * that was superseded can recognise its own staleness by comparing the epoch it
 * was issued against the epoch on disk: a lower value can never be reinstated.
 *
 * The state database is `controller.sqlite` of the §7 layout, which the storage
 * kernel owns. This migration is therefore composed with the kernel's list:
 *
 * ```ts
 * await openStore({ path, migrations: [...MYWORK_MIGRATIONS, ...LEASE_MIGRATIONS] })
 * ```
 * @module
 */

import type { Migration, SqlExecutor } from '@dsh-mywork/storage'

/** Schema version the lease layer requires on disk. */
export const LEASE_SCHEMA_VERSION = 4

/** Journal label of the migration that creates the lease table. */
export const LEASE_SCHEMA_NAME = 'controller-lease'

/** What the database reports when an epoch is written that is not an advance. */
export const EPOCH_NOT_MONOTONIC_MARKER = 'mywork.lease.epoch-not-monotonic'

/**
 * Version 4 — the controller lease.
 *
 * The table is STRICT and holds exactly one row per scope: `scope_id` is the
 * primary key, so leadership is a row-level fact and a second controller cannot
 * create a second row to hide behind.
 *
 * `epoch` carries a BEFORE UPDATE trigger that aborts any write lowering it.
 * Monotonicity is the property the whole failover story rests on — a superseded
 * controller must never look current again — so it is enforced where a bug in the
 * lease layer cannot bypass it.
 *
 * The guard tolerates an EQUAL epoch on purpose: a heartbeat rewrites the row's
 * timestamps while leadership stays with the same instance, and that is not a
 * transition. It only fires when the row actually moves to a lower epoch, which
 * is the one direction a failover must make impossible.
 */
const CONTROLLER_LEASE_DDL = `
CREATE TABLE controller_lease (
  scope_id       TEXT    PRIMARY KEY,
  instance_id    TEXT    NOT NULL,
  process_id     INTEGER NOT NULL,
  epoch          INTEGER NOT NULL,
  acquired_at    INTEGER NOT NULL,
  heartbeat_at   INTEGER NOT NULL,
  lease_until    INTEGER NOT NULL
) STRICT;

CREATE TRIGGER controller_lease_epoch_monotonic BEFORE UPDATE ON controller_lease
WHEN NEW.epoch < OLD.epoch
BEGIN
  SELECT RAISE(ABORT, '${EPOCH_NOT_MONOTONIC_MARKER}');
END;
`

/** The lease migrations, in version order. */
export const LEASE_MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({
    version: LEASE_SCHEMA_VERSION,
    name: LEASE_SCHEMA_NAME,
    up(context: SqlExecutor): void {
      context.exec(CONTROLLER_LEASE_DDL)
    },
  }),
])
