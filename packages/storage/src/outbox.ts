/**
 * Transactional outbox (architecture §48): the mutation and the events it
 * produces are committed together, and the publisher delivers them afterwards,
 * so "state updated, event lost" cannot happen.
 *
 * Writes live on the transaction object only: there is no API that appends an
 * event outside the transaction that carries its mutation.
 * @module
 */

import { randomUUID } from 'node:crypto'

import {
  MYWORK_EVENT_SCHEMA,
  type CorrelationId,
  type DomainEvent,
  type EpochMs,
  type EventEnvelope,
  type EventId,
  type WorkspaceId,
} from '@dsh-mywork/contracts'

import type { StorageClock } from './clock.ts'
import { StorageError } from './errors.ts'
import { assertKnownEventType, assertNonEmptyString, decodePayload, encodePayload } from './payload.ts'
import type { SqlExecutor, SqlRow } from './sql.ts'

/** Delivery state of one outbox row. */
export type OutboxStatus = 'pending' | 'delivered'

/** One queued event with its delivery bookkeeping. */
export interface OutboxRecord {
  /** Event exactly as it was appended, payload decoded. */
  readonly envelope: EventEnvelope
  /** `pending` until the publisher reports delivery. */
  readonly status: OutboxStatus
  /** Delivery attempts that failed. */
  readonly attempts: number
  /** Message of the last failed delivery, when one happened. */
  readonly lastError?: string
  /** Clock reading of the append. */
  readonly createdAt: EpochMs
  /** Clock reading of the successful delivery, once delivered. */
  readonly deliveredAt?: EpochMs
}

/** What a caller hands to {@link OutboxWriter.append}. */
export interface OutboxAppendInput {
  /** Event produced by a pure domain transition. */
  readonly event: DomainEvent
  /** Workspace whose event stream the event joins. */
  readonly workspaceId: WorkspaceId
  /** Correlation of the workflow that produced the event (§9). */
  readonly correlationId: CorrelationId
  /** Event that directly caused this one; absent for a root event. */
  readonly causationId?: EventId
  /**
   * Event id to record. Supplying it makes a retried append recognisable as the
   * same event; omitted ids are generated.
   */
  readonly eventId?: EventId
}

/** Outcome of an append. */
export interface OutboxAppendResult {
  /** The stored envelope, identical to the one already recorded for a duplicate. */
  readonly envelope: EventEnvelope
  /** True when the event id was already recorded with byte-identical content. */
  readonly duplicate: boolean
}

/** Outbox writes, available inside a transaction. */
export interface OutboxWriter {
  /** Append one event to the queue. */
  append(input: OutboxAppendInput): OutboxAppendResult
  /**
   * Mark an event delivered.
   * @throws {StorageError} `not-found` for an unknown event id.
   */
  markDelivered(eventId: EventId): void
  /**
   * Record a failed delivery attempt. The row stays `pending`, so the publisher
   * retries instead of losing the event.
   * @throws {StorageError} `not-found` for an unknown event id.
   */
  markFailed(eventId: EventId, error: unknown): void
}

/** Filter for {@link OutboxReader.pending}. */
export interface OutboxQuery {
  /** Restrict the scan to one workspace's stream. */
  readonly workspaceId?: WorkspaceId
  /** Maximum rows to return; defaults to every pending row. */
  readonly limit?: number
}

/** Outbox reads, available without a transaction. */
export interface OutboxReader {
  /** Undelivered events in stream order. */
  pending(query?: OutboxQuery): readonly OutboxRecord[]
  /** One queued event, or `undefined`. */
  get(eventId: EventId): OutboxRecord | undefined
}

/** Longest failure message persisted per attempt. */
const MAX_ERROR_LENGTH = 1_000

/**
 * Build the outbox writer over one transaction.
 * @param executor - statement surface of the open transaction.
 * @param clock - time source for `occurred_at`.
 */
export function createOutboxWriter(executor: SqlExecutor, clock: StorageClock): OutboxWriter {
  return {
    append(input: OutboxAppendInput): OutboxAppendResult {
      const workspaceId = assertNonEmptyString(input.workspaceId, 'workspaceId')
      const correlationId = assertNonEmptyString(input.correlationId, 'correlationId')
      const type = assertKnownEventType(input.event.type)
      const payload = encodePayload(input.event.payload)
      const eventId = input.eventId === undefined ? randomUUID() : assertNonEmptyString(input.eventId, 'eventId')
      const causationId = input.causationId === undefined
        ? undefined
        : assertNonEmptyString(input.causationId, 'causationId')

      const existing = readRow(executor, eventId)
      if (existing !== undefined) {
        const same = existing.workspace_id === workspaceId
          && existing.type === type
          && existing.correlation_id === correlationId
          && existing.payload === payload
          && (existing.causation_id ?? null) === (causationId ?? null)
        if (!same) {
          throw new StorageError(
            'conflict',
            `dsh-mywork: event "${eventId}" is already queued with different content; an event id is never reused`,
            { details: { eventId } },
          )
        }
        return { envelope: toRecord(existing).envelope, duplicate: true }
      }

      const occurredAt = clock.now()
      const sequence = nextSequence(executor, workspaceId)
      try {
        executor.run(
          `INSERT INTO outbox
             (event_id, workspace_id, sequence, type, correlation_id, causation_id, occurred_at, payload, status, attempts, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
          eventId,
          workspaceId,
          sequence,
          type,
          correlationId,
          causationId ?? null,
          occurredAt,
          payload,
          occurredAt,
        )
      } catch (error) {
        throw new StorageError('conflict', `dsh-mywork: appending event "${eventId}" failed`, {
          details: { eventId, workspaceId, sequence },
          cause: error,
        })
      }
      return { envelope: toRecord(readRow(executor, eventId) as SqlRow).envelope, duplicate: false }
    },

    markDelivered(eventId: EventId): void {
      const id = assertNonEmptyString(eventId, 'eventId')
      const changed = executor.run(
        "UPDATE outbox SET status = 'delivered', delivered_at = ? WHERE event_id = ?",
        clock.now(),
        id,
      )
      if (changed === 0) throw notQueued(id)
    },

    markFailed(eventId: EventId, error: unknown): void {
      const id = assertNonEmptyString(eventId, 'eventId')
      const changed = executor.run(
        'UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE event_id = ?',
        describeFailure(error),
        id,
      )
      if (changed === 0) throw notQueued(id)
    },
  }
}

/**
 * Build the outbox reader.
 * @param executor - statement surface; a connection or an open transaction.
 */
export function createOutboxReader(executor: SqlExecutor): OutboxReader {
  return {
    pending(query: OutboxQuery = {}): readonly OutboxRecord[] {
      const limit = query.limit === undefined ? undefined : assertLimit(query.limit)
      const workspaceId = query.workspaceId === undefined
        ? undefined
        : assertNonEmptyString(query.workspaceId, 'workspaceId')
      const clauses = ["status = 'pending'"]
      const params: (string | number)[] = []
      if (workspaceId !== undefined) {
        clauses.push('workspace_id = ?')
        params.push(workspaceId)
      }
      const sql = `SELECT * FROM outbox WHERE ${clauses.join(' AND ')} ORDER BY workspace_id, sequence`
      const rows = limit === undefined
        ? executor.all(sql, ...params)
        : executor.all(`${sql} LIMIT ?`, ...params, limit)
      return rows.map(toRecord)
    },

    get(eventId: EventId): OutboxRecord | undefined {
      const row = readRow(executor, assertNonEmptyString(eventId, 'eventId'))
      return row === undefined ? undefined : toRecord(row)
    },
  }
}

/** Next stream position of one workspace: the transaction holds the write lock. */
function nextSequence(executor: SqlExecutor, workspaceId: string): number {
  const row = executor.get('SELECT COALESCE(MAX(sequence), 0) AS last FROM outbox WHERE workspace_id = ?', workspaceId)
  const last = row?.last
  return (typeof last === 'number' ? last : 0) + 1
}

/** Read one row raw, so the caller can diff content before decoding. */
function readRow(executor: SqlExecutor, eventId: string): SqlRow | undefined {
  return executor.get('SELECT * FROM outbox WHERE event_id = ?', eventId)
}

/** Decode one row into the record the API exposes. */
function toRecord(row: SqlRow): OutboxRecord {
  const status = row.status
  if (status !== 'pending' && status !== 'delivered') {
    throw new StorageError('invalid-input', `dsh-mywork: outbox row has unknown status ${String(status)}`)
  }
  const envelope: EventEnvelope = Object.freeze({
    schema: MYWORK_EVENT_SCHEMA,
    eventId: String(row.event_id),
    sequence: Number(row.sequence),
    workspaceId: String(row.workspace_id),
    type: assertKnownEventType(row.type),
    correlationId: String(row.correlation_id),
    ...(row.causation_id === null || row.causation_id === undefined
      ? {}
      : { causationId: String(row.causation_id) }),
    occurredAt: Number(row.occurred_at),
    payload: decodePayload(row.payload),
  })
  return Object.freeze({
    envelope,
    status,
    attempts: Number(row.attempts),
    ...(row.last_error === null || row.last_error === undefined ? {} : { lastError: String(row.last_error) }),
    createdAt: Number(row.created_at),
    ...(row.delivered_at === null || row.delivered_at === undefined ? {} : { deliveredAt: Number(row.delivered_at) }),
  })
}

/** Validate a page size. */
function assertLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new StorageError('invalid-input', `dsh-mywork: outbox limit must be a positive integer, received ${String(limit)}`)
  }
  return limit
}

/** Failure message stored for a delivery attempt. */
function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text
}

/** Failure for a delivery report about an event that is not queued. */
function notQueued(eventId: string): StorageError {
  return new StorageError('not-found', `dsh-mywork: event "${eventId}" is not queued in the outbox`, {
    details: { eventId },
  })
}
