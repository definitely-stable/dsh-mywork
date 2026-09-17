/**
 * Adapter error vocabulary.
 *
 * Two kinds of failure are deliberately separated:
 *
 * - {@link AdapterRefusal} carries a canonical code from architecture §42 and
 *   is what policy branches on. The registry raises it, and an adapter raises
 *   it when an operation needs a capability the manifest does not declare.
 * - {@link AdapterError} describes how a call failed *inside* an adapter
 *   (`timeout`, `cancelled`, `invalid-ref`). Those are transport conditions
 *   with no §42 counterpart, so they are never mapped onto a canonical code
 *   that would misdescribe them.
 *
 * A refusal satisfies the `MyWorkErrorShape` contract, so it travels through
 * `Result` and the domain helpers without conversion.
 * @module
 */

import { MYWORK_ERROR_CODES, type MyWorkErrorCode, type MyWorkErrorShape } from '@dsh-mywork/contracts'

/** Machine-readable adapter failure codes (non-canonical, adapter-internal). */
export type AdapterErrorCode =
  /** Backend is unreachable or not yet configured. */
  | 'unavailable'
  /** The referenced entity does not exist or is outside the caller's scope. */
  | 'invalid-ref'
  /** The operation conflicts with current state (duplicate id, stale revision). */
  | 'conflict'
  /** The adapter and the caller disagree about the contract revision. */
  | 'version-mismatch'
  /** The operation exceeded its deadline. */
  | 'timeout'
  /** Caller cancellation. */
  | 'cancelled'

/** Every adapter failure code, in declaration order. */
export const ADAPTER_ERROR_CODES: readonly AdapterErrorCode[] = Object.freeze([
  'unavailable',
  'invalid-ref',
  'conflict',
  'version-mismatch',
  'timeout',
  'cancelled',
])

/**
 * Whether a value carries the shape of one of this module's errors.
 *
 * A plugin bundle inlines its own copy of this SDK, so `instanceof` alone would
 * fail for an error raised by another copy. The check therefore accepts any
 * value that names the class and carries a code from the known set, which is the
 * same promise the class makes.
 */
function hasErrorShape(value: unknown, name: string, codes: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { name?: unknown; code?: unknown }
  return candidate.name === name && typeof candidate.code === 'string' && codes.includes(candidate.code)
}

/** Error raised by an adapter, carrying a stable {@link AdapterErrorCode}. */
export class AdapterError extends Error {
  /** Machine-readable failure code. */
  readonly code: AdapterErrorCode

  /**
   * Identity that survives a bundle boundary; see {@link hasErrorShape}.
   * @param value - the value to test.
   */
  static override [Symbol.hasInstance](value: unknown): boolean {
    return hasErrorShape(value, 'AdapterError', ADAPTER_ERROR_CODES)
  }

  /**
   * @param code - the failure code.
   * @param message - human-readable detail.
   * @param options - optional underlying cause.
   */
  constructor(code: AdapterErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AdapterError'
    this.code = code
  }
}

/**
 * Whether a value is an {@link AdapterError} raised by an adapter.
 * @param value - the value to test.
 */
export function isAdapterError(value: unknown): value is AdapterError {
  return value instanceof AdapterError
}

/** Options accepted by the {@link AdapterRefusal} constructor. */
export interface AdapterRefusalOptions {
  /** Structured context for logs and audit (adapter id, expected/actual). */
  details?: Readonly<Record<string, unknown>>
  /** Underlying cause, when the refusal wraps another error. */
  cause?: unknown
}

/**
 * An adapter decision refused with a canonical code from architecture §42.
 *
 * Code point of view: `ADAPTER_UNAVAILABLE`, `CAPABILITY_UNSUPPORTED`,
 * `CONTRACT_MISMATCH` and `TASK_CONFLICT` are the codes the SDK itself raises.
 */
export class AdapterRefusal extends Error implements MyWorkErrorShape {
  /** Canonical failure code. */
  readonly code: MyWorkErrorCode

  /** Structured context for logs and audit. */
  readonly details: Readonly<Record<string, unknown>>

  /**
   * Identity that survives a bundle boundary; see {@link hasErrorShape}. The
   * accepted code set is the canonical §42 list, so a refusal raised by the
   * controller's copy of this SDK is still recognised by an adapter's copy.
   * @param value - the value to test.
   */
  static override [Symbol.hasInstance](value: unknown): boolean {
    return hasErrorShape(value, 'AdapterRefusal', MYWORK_ERROR_CODES)
  }

  /**
   * @param code - canonical failure code from architecture §42.
   * @param message - human-readable detail; never parsed by callers.
   * @param options - optional structured details and cause.
   */
  constructor(code: MyWorkErrorCode, message: string, options: AdapterRefusalOptions = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause })
    this.name = 'AdapterRefusal'
    this.code = code
    this.details = Object.freeze({ ...options.details })
  }
}

/**
 * Whether a value is an {@link AdapterRefusal} raised by the adapter layer.
 * @param value - the value to test.
 */
export function isAdapterRefusal(value: unknown): value is AdapterRefusal {
  return value instanceof AdapterRefusal
}

/**
 * The port has no adapter able to serve the request (§42 `ADAPTER_UNAVAILABLE`).
 * @param message - human-readable detail.
 * @param details - structured context.
 */
export function adapterUnavailable(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): AdapterRefusal {
  return new AdapterRefusal('ADAPTER_UNAVAILABLE', message, details === undefined ? {} : { details })
}

/**
 * The adapter does not declare a capability the operation requires (§42
 * `CAPABILITY_UNSUPPORTED`). This is the refusal an adapter raises when it is
 * asked for an operation it never claimed to support.
 * @param message - human-readable detail.
 * @param details - structured context; carry the missing capability names.
 */
export function capabilityUnsupported(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): AdapterRefusal {
  return new AdapterRefusal('CAPABILITY_UNSUPPORTED', message, details === undefined ? {} : { details })
}

/**
 * Caller and adapter disagree about the contract revision (§42
 * `CONTRACT_MISMATCH`).
 * @param message - human-readable detail.
 * @param details - structured context; carry expected and actual revisions.
 */
export function contractMismatch(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): AdapterRefusal {
  return new AdapterRefusal('CONTRACT_MISMATCH', message, details === undefined ? {} : { details })
}
