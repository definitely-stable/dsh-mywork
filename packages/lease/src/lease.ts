/**
 * The controller lease store: acquisition, renewal, expiry, and release of
 * leadership over one MyWork installation scope (architecture §5.3, §16.1, §49).
 *
 * Everything here is one transaction per decision. `acquire` reads the row and
 * writes the row inside a single `BEGIN IMMEDIATE`, and the write's `WHERE`
 * clause re-states the condition the read saw, so two controllers racing for an
 * expired lease cannot both win: the loser's update changes no row and it is
 * told `held-by-other`.
 *
 * The epoch is the failover token. It is bumped on every transition of
 * leadership — a takeover, and also a re-acquisition by the same instance after
 * its own lease expired — so that a superseded controller's epoch is strictly
 * lower than the current one, forever. Monotonicity is additionally enforced by
 * a database trigger, so no path through this module can lower it.
 * @module
 */

import type {
  ControllerAcquireRequest,
  ControllerEpoch,
  ControllerLease,
  ControllerLeaseResult,
  ControllerReleaseRequest,
  EpochMs,
  LeaseStorePort,
} from '@dsh-mywork/contracts'
import { isCounter } from '@dsh-mywork/core'
import { LEASE_SCHEMA_NAME, LEASE_SCHEMA_VERSION } from './schema.ts'
import { LeaseError } from './errors.ts'

/** One row of `controller_lease` as SQLite returns it. */
interface LeaseRow {
  readonly scope_id: string
  readonly instance_id: string
  readonly process_id: number
  readonly epoch: number
  readonly acquired_at: number
  readonly heartbeat_at: number
  readonly lease_until: number
}

/**
 * The slice of the storage kernel the lease layer needs.
 *
 * `transaction` must be synchronous and must take the write lock up front
 * (`BEGIN IMMEDIATE`), which is what makes the compare-and-set below atomic.
 */
export interface LeaseStore {
  /**
   * Run a synchronous body in one transaction.
   * @param fn - body receiving the transaction's statement surface.
   */
  transaction<T>(fn: (tx: LeaseExecutor) => T): T
}

/** Statement surface a lease transaction uses; the kernel's executor slice. */
export interface LeaseExecutor {
  /** Run one statement and read the first row. */
  get(sql: string, ...params: (string | number)[]): Record<string, unknown> | undefined
  /** Run one statement and count the rows it changed. */
  run(sql: string, ...params: (string | number)[]): number
}

/** Read one row into a lease record. */
function toLease(row: LeaseRow): ControllerLease {
  return Object.freeze({
    scopeId: String(row.scope_id),
    instanceId: String(row.instance_id),
    processId: Number(row.process_id),
    epoch: Number(row.epoch),
    acquiredAt: Number(row.acquired_at),
    heartbeatAt: Number(row.heartbeat_at),
    leaseUntil: Number(row.lease_until),
  })
}

/** Read the scope's row, if any. */
function readRow(tx: LeaseExecutor, scopeId: string): ControllerLease | undefined {
  const row = tx.get(
    `SELECT scope_id, instance_id, process_id, epoch, acquired_at, heartbeat_at, lease_until
     FROM controller_lease WHERE scope_id = ?`,
    scopeId,
  )
  return row === undefined ? undefined : toLease(row as unknown as LeaseRow)
}

/** Read the scope's row, which the caller's own write in this transaction guarantees exists. */
function readWrittenRow(tx: LeaseExecutor, scopeId: string): ControllerLease {
  const row = readRow(tx, scopeId)
  if (row === undefined) {
    throw new LeaseError('invalid-input', `dsh-mywork: scope "${scopeId}" disappeared inside its own write transaction`)
  }
  return row
}

/** Reject a malformed acquisition request before it reaches the database. */
function requireAcquire(request: ControllerAcquireRequest): void {
  if (typeof request.scopeId !== 'string' || request.scopeId.trim().length === 0) {
    throw new LeaseError('invalid-input', 'dsh-mywork: a lease scope id must be a non-empty string')
  }
  if (typeof request.instanceId !== 'string' || request.instanceId.trim().length === 0) {
    throw new LeaseError('invalid-input', 'dsh-mywork: a lease instance id must be a non-empty string')
  }
  if (!isCounter(request.processId)) {
    throw new LeaseError('invalid-input', `dsh-mywork: processId must be a non-negative integer, received ${String(request.processId)}`)
  }
  if (!isCounter(request.now)) {
    throw new LeaseError('invalid-input', `dsh-mywork: lease "now" must be a non-negative integer, received ${String(request.now)}`)
  }
  if (!isCounter(request.leaseMs) || request.leaseMs === 0) {
    throw new LeaseError('invalid-input', `dsh-mywork: leaseMs must be a positive integer, received ${String(request.leaseMs)}`)
  }
}

/**
 * Take leadership, or report who holds it.
 *
 * The decision is made from the row read inside the transaction and applied with
 * a `WHERE` that repeats the same condition, so it is a genuine compare-and-set
 * rather than a read followed by a hopeful write.
 * @param store - an open store carrying the lease schema.
 * @param request - identity and window of the attempt.
 * @returns the outcome and the resulting row.
 * @throws {LeaseError} `invalid-input` for a malformed request.
 */
export function acquireLease(store: LeaseStore, request: ControllerAcquireRequest): ControllerLeaseResult {
  requireAcquire(request)
  return store.transaction(tx => {
    const current = readRow(tx, request.scopeId)
    const leaseUntil = request.now + request.leaseMs

    if (current === undefined) {
      tx.run(
        `INSERT INTO controller_lease
           (scope_id, instance_id, process_id, epoch, acquired_at, heartbeat_at, lease_until)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        request.scopeId,
        request.instanceId,
        request.processId,
        1,
        request.now,
        request.now,
        leaseUntil,
      )
      return Object.freeze({ outcome: 'acquired', lease: readWrittenRow(tx, request.scopeId) })
    }

    const expired = current.leaseUntil <= request.now
    const sameInstance = current.instanceId === request.instanceId

    if (!expired) {
      // A live lease is only renewable by its own holder, and a renewal is not a
      // new epoch: leadership has not moved.
      if (!sameInstance) return Object.freeze({ outcome: 'held-by-other', lease: current })
      tx.run(
        `UPDATE controller_lease SET heartbeat_at = ?, lease_until = ?
         WHERE scope_id = ? AND instance_id = ? AND lease_until > ?`,
        request.now,
        leaseUntil,
        request.scopeId,
        request.instanceId,
        request.now,
      )
      return Object.freeze({ outcome: 'renewed', lease: readWrittenRow(tx, request.scopeId) })
    }

    // The lease expired: leadership is claimable, and the claim is a new epoch.
    // The WHERE repeats the expiry condition, so a controller that lost the race
    // to another claimant changes no row and is told so.
    const changed = tx.run(
      `UPDATE controller_lease
         SET instance_id = ?, process_id = ?, epoch = ?, acquired_at = ?, heartbeat_at = ?, lease_until = ?
       WHERE scope_id = ? AND epoch = ? AND lease_until <= ?`,
      request.instanceId,
      request.processId,
      current.epoch + 1,
      request.now,
      request.now,
      leaseUntil,
      request.scopeId,
      current.epoch,
      request.now,
    )
    if (changed === 0) {
      // Another claimant won the CAS between our read and our write; its row is
      // already visible in this transaction, and it is the one now in force.
      const winner = readRow(tx, request.scopeId)
      return Object.freeze(winner === undefined ? { outcome: 'held-by-other' } : { outcome: 'held-by-other', lease: winner })
    }
    return Object.freeze({
      outcome: sameInstance ? 'renewed' : 'expired-taken-over',
      lease: readWrittenRow(tx, request.scopeId),
    })
  })
}

/**
 * Extend a lease this controller already holds.
 *
 * Unlike {@link acquireLease}, a failure here is not a quiet outcome: a
 * controller that cannot renew has lost leadership and must stop admission,
 * so it is reported as `lease-lost` rather than as a softer result.
 * @param store - an open store carrying the lease schema.
 * @param request - identity and renewal window.
 * @returns the renewed lease.
 * @throws {LeaseError} `invalid-input` for a malformed request, `lease-lost`
 * when this instance no longer holds an unexpired lease at this epoch.
 */
export function heartbeatLease(store: LeaseStore, request: ControllerAcquireRequest): ControllerLeaseResult {
  requireAcquire(request)
  return store.transaction(tx => {
    const current = readRow(tx, request.scopeId)
    if (current === undefined || current.instanceId !== request.instanceId) {
      throw new LeaseError('lease-lost', `dsh-mywork: instance "${request.instanceId}" does not hold scope "${request.scopeId}"`, {
        details: { scopeId: request.scopeId, instanceId: request.instanceId, holder: current?.instanceId ?? null },
      })
    }
    if (current.leaseUntil <= request.now) {
      throw new LeaseError('lease-lost', `dsh-mywork: the lease on "${request.scopeId}" expired at ${current.leaseUntil}`, {
        details: { scopeId: request.scopeId, leaseUntil: current.leaseUntil, now: request.now },
      })
    }
    const changed = tx.run(
      `UPDATE controller_lease SET heartbeat_at = ?, lease_until = ?
       WHERE scope_id = ? AND instance_id = ? AND epoch = ? AND lease_until > ?`,
      request.now,
      request.now + request.leaseMs,
      request.scopeId,
      request.instanceId,
      current.epoch,
      request.now,
    )
    if (changed === 0) {
      throw new LeaseError('lease-lost', `dsh-mywork: scope "${request.scopeId}" was taken over while heartbeating`, {
        details: { scopeId: request.scopeId, epoch: current.epoch },
      })
    }
    return Object.freeze({ outcome: 'renewed', lease: readWrittenRow(tx, request.scopeId) })
  })
}

/**
 * Give up leadership, but only if it is still this instance's to give up.
 *
 * A release carrying a superseded epoch, or naming a different instance, is a
 * no-op: the record belongs to whoever holds it now, and a departing controller
 * must not be able to clear a successor's claim.
 * @param store - an open store carrying the lease schema.
 * @param request - identity and epoch releasing leadership.
 * @returns whether the row was removed.
 */
export function releaseLease(store: LeaseStore, request: ControllerReleaseRequest): boolean {
  return store.transaction(tx => {
    const changed = tx.run(
      'DELETE FROM controller_lease WHERE scope_id = ? AND instance_id = ? AND epoch = ?',
      request.scopeId,
      request.instanceId,
      request.epoch,
    )
    return changed > 0
  })
}

/**
 * Read the scope's row without changing it.
 * @param store - an open store carrying the lease schema.
 * @param scopeId - installation scope to read.
 */
export function readLease(store: LeaseStore, scopeId: string): ControllerLease | undefined {
  return store.transaction(tx => readRow(tx, scopeId))
}

/**
 * Whether `instanceId` at `epoch` may still commit mutations at `at`.
 *
 * This is the check a mutation path makes before writing: the row must name this
 * instance, carry this epoch, and not have expired. Both halves are required —
 * an epoch alone is not ownership, because a refused claimant is shown the
 * holder's current epoch when it loses the race, and it must not be able to pass
 * this gate by quoting it back.
 *
 * It is deliberately a read of durable state rather than of in-memory belief, so
 * a controller whose lease was taken over by a failover answers `false` without
 * needing to have noticed yet.
 * @param store - an open store carrying the lease schema.
 * @param scopeId - installation scope to check.
 * @param instanceId - instance claiming leadership.
 * @param epoch - epoch the instance belongs to.
 * @param at - clock reading the check is made at.
 */
export function holdsLeadership(
  store: LeaseStore,
  scopeId: string,
  instanceId: string,
  epoch: ControllerEpoch,
  at: EpochMs,
): boolean {
  return store.transaction(tx => {
    const current = readRow(tx, scopeId)
    return current !== undefined
      && current.instanceId === instanceId
      && current.epoch === epoch
      && current.leaseUntil > at
  })
}

/**
 * Verify the lease migration was applied to this database.
 * @param store - the store to inspect.
 * @throws {LeaseError} `schema-missing` when the lease table is absent.
 */
function assertLeaseSchema(store: LeaseStore): void {
  const applied = store.transaction(tx =>
    tx.get('SELECT name FROM schema_migrations WHERE version = ?', LEASE_SCHEMA_VERSION),
  )
  if (applied === undefined || applied['name'] !== LEASE_SCHEMA_NAME) {
    throw new LeaseError(
      'schema-missing',
      `dsh-mywork: the database has no controller-lease schema; open it with migrations [...MYWORK_MIGRATIONS, ...LEASE_MIGRATIONS]`,
      { details: { expectedVersion: LEASE_SCHEMA_VERSION, expectedName: LEASE_SCHEMA_NAME, found: applied?.['name'] ?? null } },
    )
  }
}

/**
 * Bind a {@link LeaseStorePort} to an open store.
 * @param store - an open store carrying the lease schema.
 * @returns the port implementation.
 * @throws {LeaseError} `schema-missing` when the lease migration was never applied.
 */
export function createLeaseStore(store: LeaseStore): LeaseStorePort {
  assertLeaseSchema(store)
  return Object.freeze({
    acquire: (request: ControllerAcquireRequest): ControllerLeaseResult => acquireLease(store, request),
    heartbeat: (request: ControllerAcquireRequest): ControllerLeaseResult => heartbeatLease(store, request),
    read: (scopeId: string): ControllerLease | undefined => readLease(store, scopeId),
    release: (request: ControllerReleaseRequest): boolean => releaseLease(store, request),
    holdsLeadership: (scopeId: string, instanceId: string, epoch: ControllerEpoch, at: EpochMs): boolean =>
      holdsLeadership(store, scopeId, instanceId, epoch, at),
  })
}
