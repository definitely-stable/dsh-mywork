/**
 * The durable MyWork state store: one SQLite file, a versioned schema, and
 * transactions that carry a mutation together with the events it produces
 * (architecture §7, §47, §48).
 *
 * Statement execution is synchronous because `node:sqlite` is: a transaction
 * callback returns the value it computed, and an async callback is refused
 * rather than quietly committed before its work finishes.
 * @module
 */

import { wallClock, type StorageClock } from './clock.ts'
import { MIGRATIONS_REQUIRED, StorageError } from './errors.ts'
import { createInboxReader, createInboxWriter, type InboxReader, type InboxWriter } from './inbox.ts'
import {
  listAppliedMigrations,
  runMigrations,
  validateMigrations,
  type AppliedMigration,
  type Migration,
} from './migrations.ts'
import { createOutboxReader, createOutboxWriter, type OutboxReader, type OutboxWriter } from './outbox.ts'
import { isThenable } from './payload.ts'
import { openSqlite, withTransaction, type SqlExecutor, type SqliteConnection } from './sql.ts'

/** Milliseconds a writer waits for the database lock before reporting it busy. */
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000

/**
 * One unit of work: a mutation plus, in the same commit, the events it emits
 * and the inbox rows that record the deliveries it consumed.
 */
export interface MyWorkTransaction extends SqlExecutor {
  /** Outbox writes of this transaction (§48). */
  readonly outbox: OutboxWriter
  /** Inbox dedup writes of this transaction (§48). */
  readonly inbox: InboxWriter
}

/** An open store. */
export interface MyWorkStore {
  /** Absolute database path. */
  readonly path: string
  /** Schema version on disk (`PRAGMA user_version`). */
  readonly schemaVersion: number
  /** Applied migrations, oldest first. */
  readonly migrations: readonly AppliedMigration[]
  /** Outbox reads. */
  readonly outbox: OutboxReader
  /** Inbox dedup reads. */
  readonly inbox: InboxReader
  /**
   * Run one write transaction.
   * @param fn - synchronous body; its return value is returned after the commit.
   * @throws {StorageError} `transaction-conflict` when called inside a
   * transaction, `invalid-input` for an async body, `store-closed` after close.
   */
  transaction<T>(fn: (tx: MyWorkTransaction) => T): T
  /** Close the database. The store is unusable afterwards. */
  close(): void
}

/** Inputs of {@link openStore}. */
export interface OpenStoreOptions {
  /** Database file to open; it is created when missing. */
  readonly path: string
  /**
   * Migrations to apply — **required** (D08).
   *
   * There is no default on purpose: opening with an implicit v1 list declares a
   * partial database complete, which is how the schema version became an orphan
   * number. Pass the canonical list assembled at the composition root
   * (`canonicalMigrations([MYWORK_MIGRATIONS, EVIDENCE_MIGRATIONS, …])`).
   */
  readonly migrations: readonly Migration[]
  /** Time source for row timestamps; defaults to the system clock. */
  readonly clock?: StorageClock
  /** Lock wait in milliseconds; defaults to {@link DEFAULT_BUSY_TIMEOUT_MS}. */
  readonly busyTimeoutMs?: number
}

/**
 * Open (and migrate) a MyWork state database.
 * @param options - path, migrations, clock, and lock timeout.
 * @returns the open store.
 * @throws {StorageError} `migrations-required` when `migrations` is missing or
 * empty, `schema-version-unsupported` when the on-disk schema is newer than this
 * build, `migration-failed` when a migration throws, or
 * `migration-journal-inconsistent` when the journal does not match the stamp.
 */
export async function openStore(options: OpenStoreOptions): Promise<MyWorkStore> {
  const requested = options.migrations
  // A typed call is refused at compile time; this is the runtime half, because
  // a JavaScript caller has no compiler to stop it (D08, F-19).
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new StorageError(
      MIGRATIONS_REQUIRED,
      'dsh-mywork: openStore requires an explicit migration list; pass MYWORK_DATABASE_MIGRATIONS',
    )
  }
  const migrations = validateMigrations(requested)
  const clock = options.clock ?? wallClock
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new StorageError(
      'invalid-input',
      `dsh-mywork: busyTimeoutMs must be a non-negative integer, received ${String(busyTimeoutMs)}`,
    )
  }
  const connection = await openSqlite({ path: options.path, busyTimeoutMs })
  try {
    runMigrations(connection, migrations, clock)
  } catch (error) {
    connection.close()
    throw error
  }
  return new SqliteStore(connection, clock)
}

/**
 * Store implementation.
 *
 * Fields are TypeScript-private rather than ECMAScript-private (`#`): a Cordis
 * service is handed to callers through a proxy, and a proxied object cannot
 * reach `#` fields (MW-002 §6.4), so this class stays proxy-safe for the
 * controller that will publish it.
 */
class SqliteStore implements MyWorkStore {
  private readonly connection: SqliteConnection
  private readonly clock: StorageClock
  private readonly outboxReader: OutboxReader
  private readonly inboxReader: InboxReader
  private open = true
  private active = false

  constructor(connection: SqliteConnection, clock: StorageClock) {
    this.connection = connection
    this.clock = clock
    this.outboxReader = createOutboxReader(connection)
    this.inboxReader = createInboxReader(connection)
  }

  get path(): string {
    return this.connection.path
  }

  get schemaVersion(): number {
    this.assertOpen()
    return this.connection.userVersion()
  }

  get migrations(): readonly AppliedMigration[] {
    this.assertOpen()
    return listAppliedMigrations(this.connection)
  }

  get outbox(): OutboxReader {
    this.assertOpen()
    return this.outboxReader
  }

  get inbox(): InboxReader {
    this.assertOpen()
    return this.inboxReader
  }

  transaction<T>(fn: (tx: MyWorkTransaction) => T): T {
    this.assertOpen()
    if (this.active) {
      throw new StorageError(
        'transaction-conflict',
        'dsh-mywork: transactions do not nest; one mutation and its outbox rows are a single unit',
      )
    }
    this.active = true
    try {
      return withTransaction(this.connection, () => {
        const tx: MyWorkTransaction = {
          exec: this.connection.exec,
          run: this.connection.run,
          get: this.connection.get,
          all: this.connection.all,
          outbox: createOutboxWriter(this.connection, this.clock),
          inbox: createInboxWriter(this.connection, this.clock),
        }
        const value = fn(tx)
        if (isThenable(value)) {
          throw new StorageError(
            'invalid-input',
            'dsh-mywork: a transaction body must be synchronous; an async body would commit before its work finished',
          )
        }
        return value
      })
    } finally {
      this.active = false
    }
  }

  close(): void {
    this.assertOpen()
    if (this.active) {
      throw new StorageError('transaction-conflict', 'dsh-mywork: the store cannot close inside a transaction')
    }
    this.connection.close()
    this.open = false
  }

  /** Every entry point checks this, so a closed store is never half-usable. */
  private assertOpen(): void {
    if (!this.open) {
      throw new StorageError('store-closed', `dsh-mywork: store "${this.connection.path}" is closed`)
    }
  }
}
