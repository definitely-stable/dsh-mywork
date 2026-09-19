/**
 * `@dsh-mywork/lease` — controller leadership for one MyWork installation scope
 * (architecture §5.3, §16.1, §17, §49).
 *
 * §5.3 states the invariant this package exists to hold: exactly one controller
 * may mutate the runtime state of a scope. The {@link LeaseStorePort} decides
 * leadership by compare-and-set on one durable row and stamps it with a
 * monotonically increasing epoch; {@link ControllerLifecycle} turns that decision
 * into a lifecycle — acquire, open stores, reconcile, admit work, and on
 * disposal stop admission before releasing.
 *
 * ```ts
 * const store = await openStore({ path, migrations: [...MYWORK_MIGRATIONS, ...LEASE_MIGRATIONS] })
 * const lifecycle = new ControllerLifecycle({
 *   scopeId: 'local', instanceId, processId: process.pid, clock,
 *   leaseMs: 15_000,
 *   leases: createLeaseStore(store),
 *   openStores: async () => ({ registry, controller: store }),
 *   reconcile: () => ({ operations: 0, leases: 0 }),
 *   closeStores: ({ registry }) => registry.close(),
 * })
 * await lifecycle.activate()
 * if (lifecycle.isWriter()) {
 *   // this controller leads
 * }
 * ```
 *
 * Scope: leadership and its lifecycle. Scheduling policy (§16.3–16.5), the
 * scheduler loop, and event subscription are the cards that build them.
 * @module @dsh-mywork/lease
 */

export {
  LEASE_ERROR_CODES,
  LeaseError,
  isLeaseError,
  type LeaseErrorCode,
  type LeaseErrorOptions,
} from './errors.ts'
export {
  EPOCH_NOT_MONOTONIC_MARKER,
  LEASE_MIGRATIONS,
  LEASE_SCHEMA_NAME,
  LEASE_SCHEMA_VERSION,
} from './schema.ts'
export {
  acquireLease,
  createLeaseStore,
  heartbeatLease,
  holdsLeadership,
  readLease,
  releaseLease,
  type LeaseExecutor,
  type LeaseStore,
} from './lease.ts'
export {
  ControllerLifecycle,
  type ControllerLifecycleInfo,
  type ControllerLifecycleOptions,
  type ControllerLifecyclePhase,
  type ControllerStores,
  type ReconcileReport,
} from './lifecycle.ts'
