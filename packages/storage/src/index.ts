/**
 * `@dsh-mywork/storage` — durable MyWork runtime state.
 *
 * ```ts
 * const layout = resolveMyWorkLayout()
 * const store = await openStore({
 *   path: stateDatabasePath(layout, 'registry'),
 *   migrations: MYWORK_DATABASE_MIGRATIONS,
 * })
 * store.transaction(tx => {
 *   tx.run('UPDATE attempts SET state = ? WHERE id = ?', 'running', attemptId)
 *   tx.outbox.append({ event, workspaceId, correlationId })
 *   tx.inbox.applyOnce('task-projection', eventId, () => applyToProjection())
 * })
 * ```
 *
 * Scope: schema version, migrations, WAL, mutation+outbox transactions, and
 * inbox dedup. Domain tables arrive with the repositories that implement them;
 * this layer owns only `schema_migrations`, `outbox`, and `inbox_dedup`.
 *
 * Writes exist on the transaction object alone, so a mutation cannot be
 * committed without the events it produced.
 * @module @dsh-mywork/storage
 */

export {
  BACKGROUND_JOB_DDL,
  BACKGROUND_JOB_INDEX_DDL,
  claimDueBackgroundJob,
  createBackgroundJobMigration,
  enqueueBackgroundJob,
  listBackgroundJobs,
  settleBackgroundJob,
  type BackgroundJobRecord,
  type ClaimBackgroundJobInput,
  type EnqueueBackgroundJobInput,
  type ListBackgroundJobsFilter,
  type SettleBackgroundJobInput,
} from './background-jobs.ts'
export { wallClock, type StorageClock } from './clock.ts'
export {
  DEFAULT_LOCK_STALE_MS,
  DEFAULT_LOCK_TIMEOUT_MS,
  withFileLock,
  writeFileAtomic,
  type FileLockOptions,
  type WriteFileAtomicOptions,
} from './atomic.ts'
export {
  LOCK_TIMEOUT,
  MIGRATION_JOURNAL_INCONSISTENT,
  MIGRATIONS_REQUIRED,
  STATE_UNREADABLE,
  STORAGE_ERROR_CODES,
  StorageError,
  isStorageError,
  type StorageErrorCode,
  type StorageErrorOptions,
} from './errors.ts'
export type { InboxApplyResult, InboxReader, InboxWriter } from './inbox.ts'
export {
  DSH_HOME_ENV,
  MYWORK_DIR_NAME,
  MYWORK_STATE_DATABASES,
  MYWORK_STATE_DIR_NAME,
  defaultDshHome,
  resolveMyWorkLayout,
  stateDatabasePath,
  type MyWorkLayout,
  type MyWorkStateDatabase,
  type ResolveMyWorkLayoutOptions,
} from './layout.ts'
export {
  MIGRATION_ALLOCATIONS_DDL,
  MYWORK_MIGRATIONS,
  MYWORK_SCHEMA_VERSION,
  assertCanonicalMigrations,
  canonicalMigrations,
  listAppliedMigrations,
  runMigrations,
  validateMigrations,
  type AppliedMigration,
  type Migration,
  type MigrationContext,
  type MigrationSource,
} from './migrations.ts'
export type {
  OutboxAppendInput,
  OutboxAppendResult,
  OutboxQuery,
  OutboxReader,
  OutboxRecord,
  OutboxStatus,
  OutboxWriter,
} from './outbox.ts'
export {
  openSqlite,
  type OpenSqliteOptions,
  type SqlExecutor,
  type SqliteConnection,
  type SqlRow,
  type SqlValue,
} from './sql.ts'
export { JOURNAL_TABLE, readMigrationJournal } from './journal-file.ts'
export {
  compact,
  pruneAuditEvents,
  pruneInboxDedup,
  pruneOutbox,
  type CompactOptions,
  type CompactResult,
  type PruneResult,
  type RetentionWindow,
} from './retention.ts'
export {
  DEFAULT_BUSY_TIMEOUT_MS,
  openStore,
  type MyWorkStore,
  type MyWorkTransaction,
  type OpenStoreOptions,
} from './store.ts'
