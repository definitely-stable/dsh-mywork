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

export { wallClock, type StorageClock } from './clock.ts'
export {
  MIGRATION_JOURNAL_INCONSISTENT,
  MIGRATIONS_REQUIRED,
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
export type { SqlExecutor, SqliteConnection, SqlRow, SqlValue } from './sql.ts'
export {
  DEFAULT_BUSY_TIMEOUT_MS,
  openStore,
  type MyWorkStore,
  type MyWorkTransaction,
  type OpenStoreOptions,
} from './store.ts'
