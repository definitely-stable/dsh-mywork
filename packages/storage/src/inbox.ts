/**
 * Inbox dedup (architecture §48): a consumer records the events it has already
 * handled, so a redelivered event does not apply its effect twice.
 *
 * The key is `(consumer, eventId)`: several consumers read the same stream
 * (projection, scheduler, audit), and each one owns its own dedup ledger.
 * @module
 */

import type { EventId } from '@dsh-mywork/contracts'

import type { StorageClock } from './clock.ts'
import { StorageError } from './errors.ts'
import { assertNonEmptyString, isThenable } from './payload.ts'
import type { SqlExecutor } from './sql.ts'

/** Outcome of {@link InboxWriter.applyOnce}. */
export type InboxApplyResult<T> =
  /** The event had not been seen: the effect ran and is now recorded. */
  | { readonly applied: true; readonly value: T }
  /** The event was already handled: the effect did not run. */
  | { readonly applied: false }

/** Inbox writes, available inside a transaction. */
export interface InboxWriter {
  /**
   * Apply one event's effect at most once.
   *
   * The dedup row is written in the same transaction as the effect, so a
   * failure of either leaves neither: a retry sees the event as unhandled and
   * applies it again, while a redelivery after a commit does nothing.
   * @param consumer - durable name of the consuming handler.
   * @param eventId - id of the delivered event.
   * @param apply - synchronous effect to run when the event is new.
   * @throws {StorageError} `invalid-input` for an empty key or an async effect.
   */
  applyOnce<T>(consumer: string, eventId: EventId, apply: () => T): InboxApplyResult<T>
}

/** Inbox reads, available without a transaction. */
export interface InboxReader {
  /** Whether this consumer already handled that event. */
  isProcessed(consumer: string, eventId: EventId): boolean
}

/**
 * Build the inbox writer over one transaction.
 * @param executor - statement surface of the open transaction.
 * @param clock - time source for `processed_at`.
 */
export function createInboxWriter(executor: SqlExecutor, clock: StorageClock): InboxWriter {
  return {
    applyOnce<T>(consumer: string, eventId: EventId, apply: () => T): InboxApplyResult<T> {
      const name = assertNonEmptyString(consumer, 'consumer')
      const id = assertNonEmptyString(eventId, 'eventId')
      if (isProcessed(executor, name, id)) return { applied: false }
      const value = apply()
      if (isThenable(value)) {
        throw new StorageError(
          'invalid-input',
          `dsh-mywork: inbox consumer "${name}" must apply its effect synchronously; an asynchronous effect could be recorded as processed before it finished`,
        )
      }
      executor.run(
        'INSERT INTO inbox_dedup (consumer, event_id, processed_at) VALUES (?, ?, ?)',
        name,
        id,
        clock.now(),
      )
      return { applied: true, value }
    },
  }
}

/**
 * Build the inbox reader.
 * @param executor - statement surface; a connection or an open transaction.
 */
export function createInboxReader(executor: SqlExecutor): InboxReader {
  return {
    isProcessed(consumer: string, eventId: EventId): boolean {
      return isProcessed(executor, assertNonEmptyString(consumer, 'consumer'), assertNonEmptyString(eventId, 'eventId'))
    },
  }
}

/** Shared dedup probe. */
function isProcessed(executor: SqlExecutor, consumer: string, eventId: string): boolean {
  return executor.get('SELECT 1 AS seen FROM inbox_dedup WHERE consumer = ? AND event_id = ?', consumer, eventId) !== undefined
}
