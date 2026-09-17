/**
 * Value checks the store applies before a row is written.
 *
 * The event envelope contract (architecture §43, `@dsh-mywork/contracts`)
 * promises a lossless JSON payload on a known event type; a store that silently
 * mangled a payload would break replay and audit, so the checks run here rather
 * than in a caller's discipline.
 * @module
 */

import { isDeepStrictEqual } from 'node:util'

import { MYWORK_EVENT_TYPES, type MyWorkEventType } from '@dsh-mywork/contracts'

import { StorageError } from './errors.ts'

/**
 * Require a non-empty identifier.
 * @param value - candidate value.
 * @param label - field name used in the failure message.
 * @throws {StorageError} `invalid-input` when the value is not a non-empty string.
 */
export function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new StorageError(
      'invalid-input',
      `dsh-mywork: ${label} must be a non-empty string, received ${describe(value)}`,
    )
  }
  return value
}

/**
 * Require one of the event types the domain declares.
 * @param value - candidate event type.
 * @throws {StorageError} `invalid-input` when the type is not in the vocabulary.
 */
export function assertKnownEventType(value: unknown): MyWorkEventType {
  const type = assertNonEmptyString(value, 'event type')
  if (!MYWORK_EVENT_TYPES.includes(type as MyWorkEventType)) {
    throw new StorageError(
      'invalid-input',
      `dsh-mywork: "${type}" is not a declared event type (${MYWORK_EVENT_TYPES.join(', ')})`,
    )
  }
  return type as MyWorkEventType
}

/**
 * Serialize an event payload, refusing a value that would change on the way
 * in or out of the database.
 * @param payload - payload of a domain event.
 * @returns the JSON text to persist.
 * @throws {StorageError} `invalid-input` when the payload is not an object,
 * cannot be serialized, or does not survive a JSON round trip.
 */
export function encodePayload(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new StorageError('invalid-input', `dsh-mywork: an event payload must be an object, received ${describe(payload)}`)
  }
  let text: string | undefined
  try {
    text = JSON.stringify(payload)
  } catch (error) {
    throw new StorageError('invalid-input', 'dsh-mywork: the event payload is not JSON-serialisable', { cause: error })
  }
  const decoded: unknown = text === undefined ? undefined : JSON.parse(text)
  if (text === undefined || !isDeepStrictEqual(decoded, payload)) {
    throw new StorageError(
      'invalid-input',
      'dsh-mywork: the event payload is not lossless JSON; values that JSON drops (undefined, functions) or rewrites (Date, BigInt) cannot be persisted',
    )
  }
  return text
}

/**
 * Read a persisted payload back.
 * @param text - the stored JSON text.
 * @throws {StorageError} `invalid-input` when the stored value is not a JSON object.
 */
export function decodePayload(text: unknown): Readonly<Record<string, unknown>> {
  if (typeof text !== 'string') {
    throw new StorageError('invalid-input', `dsh-mywork: stored payload must be JSON text, found ${describe(text)}`)
  }
  const decoded: unknown = JSON.parse(text)
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new StorageError('invalid-input', `dsh-mywork: stored payload must decode to an object, decoded ${describe(decoded)}`)
  }
  return decoded as Readonly<Record<string, unknown>>
}

/** Text as it comes back out of SQLite. */
/**
 * Whether a value is a promise, i.e. work that has not finished yet.
 *
 * The store is synchronous, so a transaction body or an inbox effect that
 * returns a promise would be recorded as finished before it is.
 * @param value - the value to test.
 */
export function isThenable(value: unknown): boolean {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function'
}

/** Human-readable kind of a rejected value. */
function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (value === undefined) return 'undefined'
  return typeof value
}
