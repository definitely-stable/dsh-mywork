/**
 * Product observability: one outbound event per settled attempt (F-54, D16).
 *
 * D16 keeps the truth of correlation inside MyWork's own audit and outbox and
 * makes `productTelemetry` the only outbound channel: no OpenTelemetry exporter
 * is built here, and no platform package is imported to reach the service. The
 * platform surface is read structurally through `ctx.get('productTelemetry')`,
 * so this module stays pure and directly unit-testable, and a profile that does
 * not mount product telemetry keeps working — the export is fail-open and says
 * so in its own result (`reason: 'telemetry-disabled'`).
 *
 * The platform record has a **required free-text `body`** and the package does
 * not redact caller strings (`product-telemetry-otel/README.md:103`: "Caller
 * selected strings are not redacted automatically"), which makes the body the
 * main leak channel by construction. It is therefore a fixed string per event
 * name, never a template over caller data: `body` cannot be reached from any
 * input field of {@link ProductEventInput}.
 * @module
 */

/**
 * Cordis service name of the platform product-telemetry service (D16).
 *
 * The name is the platform's (`packages/host/product-telemetry-otel/src/index.ts:102`
 * in the DSH checkout), not a local invention, and it is the only string this
 * module asks the context for.
 */
export const PRODUCT_TELEMETRY_SERVICE = 'productTelemetry'

/** Value an attribute of a product event may carry. */
export type ProductTelemetryScalar = string | number | boolean

/**
 * The platform record, declared locally on purpose.
 *
 * `@deepseek-ai/dsh-host-product-telemetry-otel` is not an installed dependency
 * and `tests/boundaries.test.mjs` bans every `@deepseek-ai/*` import but
 * `@deepseek-ai/cordis`, so the shape is restated structurally instead of
 * imported. Required fields and their kinds follow
 * `packages/host/product-telemetry-otel/src/index.ts:25-33` in the DSH checkout.
 */
export interface ProductTelemetryRecord {
  /** Product event name; MyWork emits only {@link PRODUCT_EVENT_NAMES}. */
  readonly eventName: string
  /** Human-readable body; always a fixed string, never caller data. */
  readonly body: string
  /** Unix milliseconds the event happened at. */
  readonly timestamp: number
  /** Severity; left unset so the platform applies its INFO default. */
  readonly severityNumber?: number
  /** Allowlisted attributes only (F-55). */
  readonly attributes?: Readonly<Record<string, ProductTelemetryScalar>>
}

/**
 * The one platform method MyWork uses.
 *
 * `emit` is synchronous by contract — it queues the record and never waits for
 * the network (`product-telemetry-otel/src/index.ts:162`), so an attempt is
 * never slowed down by an unreachable collector.
 */
export interface ProductTelemetryPort {
  /** Queue one record for export. */
  emit(record: ProductTelemetryRecord): void
}

/** The slice of a Cordis context this module reads. */
export interface ProductTelemetryContext {
  /** Resolve a service by name; `undefined` when the profile does not mount it. */
  get(name: string): unknown
}

/** How an attempt settled. */
export type ProductEventOutcome =
  /** The attempt produced the work it promised. */
  | 'succeeded'
  /** The attempt ended without the work. */
  | 'failed'
  /** The attempt was refused before it ran (authority, budget, gate). */
  | 'refused'

/** Every outcome, so a caller can bind exhaustively. */
export const PRODUCT_EVENT_OUTCOMES: readonly ProductEventOutcome[] = Object.freeze([
  'succeeded',
  'failed',
  'refused',
])

/**
 * The closed set of event names MyWork exports.
 *
 * A closed set is what makes the name safe to put in a product event: it is a
 * constant from this list, never a string built from task data. A new name is a
 * code change with a test, not a configuration.
 */
export const PRODUCT_EVENT_NAMES: readonly string[] = Object.freeze([
  'mywork.attempt.succeeded',
  'mywork.attempt.failed',
  'mywork.attempt.refused',
])

/** Outcome → event name. Total over {@link PRODUCT_EVENT_OUTCOMES}. */
export const PRODUCT_EVENT_NAME_BY_OUTCOME: Readonly<Record<ProductEventOutcome, string>> = Object.freeze({
  succeeded: 'mywork.attempt.succeeded',
  failed: 'mywork.attempt.failed',
  refused: 'mywork.attempt.refused',
})

/**
 * Fixed body per event name.
 *
 * This map is the whole body policy: `toProductEvent` reads it and never builds
 * a body from input. Adding an interpolated body would undo the only protection
 * the platform does not provide.
 */
export const PRODUCT_EVENT_BODIES: Readonly<Record<string, string>> = Object.freeze({
  'mywork.attempt.succeeded': 'dsh-mywork: attempt succeeded',
  'mywork.attempt.failed': 'dsh-mywork: attempt failed',
  'mywork.attempt.refused': 'dsh-mywork: attempt refused',
})

/**
 * What MyWork is willing to say about one settled attempt.
 *
 * Identifiers and enumerations only: no prompt, no response, no file content,
 * no credential — the doc invariant of the platform package
 * (`product-telemetry-otel/src/index.ts:26`) restated as a type with no field
 * that could carry one.
 */
export interface ProductEventInput {
  /** Correlation id of the attempt; the platform's only link to MyWork's audit. */
  readonly correlationId: string
  /** How the attempt settled. */
  readonly outcome: ProductEventOutcome
  /** Clock reading of the settlement, Unix milliseconds. */
  readonly at: number
  /** Operation that produced the attempt. */
  readonly operationId?: string
  /** Workspace the attempt ran in. */
  readonly workspaceId?: string
  /** Duration of the attempt in milliseconds. */
  readonly durationMs?: number
}

/** Result of one export attempt; `reason` distinguishes "sent" from "no channel". */
export interface ProductEmitResult {
  /** Whether a record reached the platform service. */
  readonly emitted: boolean
  /** `emitted` on success, `telemetry-disabled` when the profile mounts no service. */
  readonly reason: 'emitted' | 'telemetry-disabled'
  /** Event name the record carried, so a caller can log what it would have sent. */
  readonly eventName: string
}

/**
 * Build the platform record for one settled attempt.
 *
 * Pure: the clock reading is an input (`at`), so the result is reproducible and
 * a test never depends on wall time.
 * @param input - correlation, outcome, and the identifiers MyWork discloses.
 * @returns the record to hand to `productTelemetry.emit`.
 * @throws {TypeError} when the outcome is not one of {@link PRODUCT_EVENT_OUTCOMES}.
 */
export function toProductEvent(input: ProductEventInput): ProductTelemetryRecord {
  const eventName = PRODUCT_EVENT_NAME_BY_OUTCOME[input.outcome]
  if (eventName === undefined) {
    throw new TypeError(
      `dsh-mywork: "${String(input.outcome)}" is not a product event outcome; expected one of ${PRODUCT_EVENT_OUTCOMES.join(', ')}`,
    )
  }
  const body = PRODUCT_EVENT_BODIES[eventName]
  if (body === undefined) {
    throw new TypeError(`dsh-mywork: product event "${eventName}" has no fixed body; add it to PRODUCT_EVENT_BODIES`)
  }
  return Object.freeze({
    eventName,
    body,
    timestamp: input.at,
    attributes: Object.freeze(attributesOf(input)),
  })
}

/**
 * Resolve the platform service, or `undefined` when the profile has none.
 *
 * A service whose `emit` is not callable is treated as absent: an absent
 * channel must not crash an attempt, and the result says which of the two it
 * was.
 * @param ctx - the context the controller runs in.
 */
export function resolveProductTelemetry(ctx: ProductTelemetryContext): ProductTelemetryPort | undefined {
  const candidate = ctx.get(PRODUCT_TELEMETRY_SERVICE)
  if (candidate === undefined || candidate === null) return undefined
  const emit = (candidate as { emit?: unknown }).emit
  if (typeof emit !== 'function') return undefined
  return candidate as ProductTelemetryPort
}

/**
 * Export one settled attempt, or report that telemetry is disabled.
 *
 * The record is built **before** the channel is resolved, so a malformed event
 * is refused in every profile — a validation that only ran where a collector
 * exists would let a leak ship silently.
 * @param ctx - the context the controller runs in.
 * @param input - the attempt to report.
 * @returns whether the record was handed to the platform service.
 * @throws {TypeError} when the event itself is malformed (see {@link toProductEvent}).
 */
export function emitProductEvent(ctx: ProductTelemetryContext, input: ProductEventInput): ProductEmitResult {
  const record = toProductEvent(input)
  const port = resolveProductTelemetry(ctx)
  if (port === undefined) {
    return Object.freeze({ emitted: false, reason: 'telemetry-disabled', eventName: record.eventName })
  }
  port.emit(record)
  return Object.freeze({ emitted: true, reason: 'emitted', eventName: record.eventName })
}

/** Attributes of one event, built from the typed input only. */
function attributesOf(input: ProductEventInput): Record<string, ProductTelemetryScalar> {
  const attributes: Record<string, ProductTelemetryScalar> = {
    'mywork.correlation_id': input.correlationId,
  }
  if (input.workspaceId !== undefined) attributes['mywork.workspace_id'] = input.workspaceId
  if (input.operationId !== undefined) attributes['mywork.operation_id'] = input.operationId
  attributes['mywork.outcome'] = input.outcome
  if (input.durationMs !== undefined) attributes['mywork.duration_ms'] = input.durationMs
  return attributes
}
