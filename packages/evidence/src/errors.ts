/**
 * Failures the MyWork evidence layer raises.
 *
 * These codes are evidence-local for the same reason the storage codes are
 * storage-local (MW-004 §7.2): architecture §42 closes the domain error
 * vocabulary, and "the artifact you named already holds other bytes" is not a
 * domain outcome. A repository answering with a `Result` maps an
 * {@link EvidenceError} to the domain code that fits its operation.
 * @module
 */

/** Every failure the evidence layer can raise. */
export type EvidenceErrorCode =
  /** The caller passed a value the store cannot accept (undeclared field, bad shape). */
  | 'invalid-input'
  /** A metadata value carries what looks like secret material (§31). */
  | 'secret-material'
  /** The artifact id already holds different bytes or other metadata; it is not overwritten. */
  | 'artifact-conflict'
  /** No artifact is stored under the requested identity. */
  | 'artifact-not-found'
  /** The stored bytes do not hash to the identity they are stored under. */
  | 'hash-mismatch'
  /** The audit id is already recorded with different content. */
  | 'audit-conflict'
  /** The database was opened without the evidence migration. */
  | 'schema-missing'

/** Every evidence error code, so a test or a doctor can pin the vocabulary. */
export const EVIDENCE_ERROR_CODES: readonly EvidenceErrorCode[] = Object.freeze([
  'invalid-input',
  'secret-material',
  'artifact-conflict',
  'artifact-not-found',
  'hash-mismatch',
  'audit-conflict',
  'schema-missing',
])

/** Options accepted by the {@link EvidenceError} constructor. */
export interface EvidenceErrorOptions {
  /** Structured context for logs and diagnostics (field, ids, hashes). */
  readonly details?: Readonly<Record<string, unknown>>
  /** Underlying cause, when the failure wraps a SQLite error. */
  readonly cause?: unknown
}

/** Failure raised by the evidence layer. */
export class EvidenceError extends Error {
  /** Machine-readable failure code. */
  readonly code: EvidenceErrorCode

  /** Structured context for logs and diagnostics. */
  readonly details: Readonly<Record<string, unknown>>

  /**
   * @param code - stable evidence failure code.
   * @param message - human-readable detail; never parsed by callers.
   * @param options - optional structured details and cause.
   */
  constructor(code: EvidenceErrorCode, message: string, options: EvidenceErrorOptions = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause })
    this.name = 'EvidenceError'
    this.code = code
    this.details = Object.freeze({ ...options.details })
  }
}

/**
 * Whether a value is an {@link EvidenceError} raised by this layer.
 * @param value - the value to test.
 */
export function isEvidenceError(value: unknown): value is EvidenceError {
  return value instanceof EvidenceError
}
