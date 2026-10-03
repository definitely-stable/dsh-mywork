/**
 * Product observability: one outbound event per settled attempt (F-54, D16).
 *
 * D16 keeps the truth of correlation inside MyWork's own audit and outbox and
 * makes `productTelemetry` the only outbound channel: no OpenTelemetry exporter
 * is built here, and no platform package is imported to reach the service. The
 * platform surface is read structurally through `ctx.get('productTelemetry')`,
 * so this module stays pure and directly unit-testable, and a profile that does
 * not mount product telemetry keeps working — the export is fail-open and says
 * why in its own result: `telemetry-disabled` (no service), `telemetry-unavailable`
 * (the lookup threw), `telemetry-failed` (the channel refused the record). A
 * malformed event is still refused in all three cases, because the record is
 * built before the channel is resolved.
 *
 * The platform record has a **required free-text `body`** and the package does
 * not redact caller strings (`product-telemetry-otel/README.md:104`: "Caller
 * selected strings are not redacted automatically"), which makes the body the
 * main leak channel by construction. It is therefore a fixed string per event
 * name, never a template over caller data: `body` cannot be reached from any
 * input field of {@link ProductEventInput}.
 *
 * F-55 closes the other channel — the attributes — with an **allowlist** rather
 * than a denylist: {@link PRODUCT_ATTRIBUTE_SHAPES} names every key MyWork may
 * disclose **and the shape its value must have**, and the event's own field set
 * is closed the same way ({@link PRODUCT_EVENT_INPUT_FIELDS}). An unknown key is
 * refused, a value that does not fit its key's declared shape is refused, and
 * the body decision is part of the same policy: no level names anything that
 * could carry content. The shape half was review B6: a key alone left the value
 * channel open.
 * @module
 */

import { OPERATION_DOMAINS, type OperationDomain } from '@dsh-mywork/contracts'

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
 * Declared shape of one allowlisted attribute value (review B6).
 *
 * An allowlist that constrains only the KEY leaves the value channel open: a
 * caller can put any string under `mywork.attempt_count` and the record ships
 * it, because the type says `number` and the runtime said nothing. A shape is
 * the missing half — each key names what its value may be, and a value that
 * does not fit is refused instead of exported.
 */
export type ProductAttributeShape =
  /** A non-empty string naming something (an identifier, §44). */
  | 'identifier'
  /** A finite number of milliseconds, zero or more. */
  | 'duration-ms'
  /** A finite, non-negative integer count. */
  | 'count'
  /** A member of {@link PRODUCT_EVENT_OUTCOMES}. */
  | 'outcome'
  /** A member of the §31 operation domains. */
  | 'operation-domain'

/**
 * Every attribute MyWork may put in a product event, with the shape its value
 * must have — and nothing else.
 *
 * Identifiers, an operation domain, an outcome, a duration, and an attempt
 * count: things a deployment can aggregate and correlate on, and none of them
 * content. The table is the gate, not a description of one — a key outside it is
 * refused, and a value that does not fit its declared shape is refused too, so
 * the question "may this be disclosed?" is answered for every key rather than
 * only for the keys somebody remembered to ban (F-55, review B6).
 */
export const PRODUCT_ATTRIBUTE_SHAPES: Readonly<Record<string, ProductAttributeShape>> = Object.freeze({
  'mywork.correlation_id': 'identifier',
  'mywork.workspace_id': 'identifier',
  'mywork.task_id': 'identifier',
  'mywork.attempt_id': 'identifier',
  'mywork.operation_id': 'identifier',
  'mywork.operation_domain': 'operation-domain',
  'mywork.outcome': 'outcome',
  'mywork.duration_ms': 'duration-ms',
  'mywork.attempt_count': 'count',
})

/**
 * Every attribute key MyWork may put in a product event, and nothing else.
 *
 * Derived from {@link PRODUCT_ATTRIBUTE_SHAPES} so the two cannot drift: a key
 * cannot be allowed without a declared shape to validate its value against.
 */
export const PRODUCT_ATTRIBUTE_ALLOWLIST: readonly string[] = Object.freeze(
  Object.keys(PRODUCT_ATTRIBUTE_SHAPES),
)

/**
 * Every field a product event may carry; the shape is closed.
 *
 * This is where the body decision becomes a rule rather than a promise: no
 * field of a product event can hold a prompt, a response, or file content, so
 * nothing of the sort can reach `body` either.
 */
export const PRODUCT_EVENT_INPUT_FIELDS: readonly string[] = Object.freeze([
  'correlationId',
  'workspaceId',
  'taskId',
  'attemptId',
  'operationId',
  'operationDomain',
  'outcome',
  'durationMs',
  'attemptCount',
  'at',
  'attributes',
])

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
  /** Task the attempt belongs to. */
  readonly taskId?: string
  /** Attempt identifier. */
  readonly attemptId?: string
  /** Domain of the operation (§31), e.g. `filesystem`. */
  readonly operationDomain?: OperationDomain
  /** Duration of the attempt in milliseconds. */
  readonly durationMs?: number
  /** How many attempts the task has taken, for retry diagnostics. */
  readonly attemptCount?: number
  /**
   * Extra attributes a caller wants to disclose.
   *
   * The values are `unknown` on purpose: this is the only place a caller can
   * add anything, so it is the only place a key or a value can be wrong. Every
   * key is checked against {@link PRODUCT_ATTRIBUTE_SHAPES} and every value
   * against that key's declared shape before it is used.
   */
  readonly attributes?: Readonly<Record<string, unknown>>
}

/**
 * Why the export found no usable channel.
 *
 * The three are distinct because they need different responses: `disabled` is a
 * profile that does not mount telemetry, `unavailable` is a lookup that threw,
 * and `failed` is a channel that was there and refused the record. All three
 * leave the attempt alive, which is the fail-open contract of D16.
 */
export type ProductTelemetryUnavailableReason =
  /** No `productTelemetry` service in this profile. */
  | 'telemetry-disabled'
  /** The service lookup itself threw. */
  | 'telemetry-unavailable'
  /** The service exists but `emit` threw. */
  | 'telemetry-failed'

/** Result of one channel lookup: a port, or the reason there is none. */
export type ProductTelemetryResolution =
  | { readonly available: true; readonly port: ProductTelemetryPort }
  | { readonly available: false; readonly reason: ProductTelemetryUnavailableReason }

/** Result of one export attempt; `reason` distinguishes "sent" from why not. */
export interface ProductEmitResult {
  /** Whether a record reached the platform service. */
  readonly emitted: boolean
  /** `emitted` on success, or why the record did not leave. */
  readonly reason: 'emitted' | ProductTelemetryUnavailableReason
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
 * @throws {TypeError} when the event is malformed: an unknown field, an
 *   attribute outside {@link PRODUCT_ATTRIBUTE_SHAPES}, a value that does not
 *   fit its attribute's declared shape, or an outcome outside
 *   {@link PRODUCT_EVENT_OUTCOMES}.
 */
export function toProductEvent(input: ProductEventInput): ProductTelemetryRecord {
  assertProductEventInput(input)
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
  const attributes = attributesOf(input)
  assertAttributeShapes(attributes)
  return Object.freeze({
    eventName,
    body,
    timestamp: input.at,
    attributes: Object.freeze(attributes),
  })
}

/**
 * Resolve the platform service, or `undefined` when the profile has none.
 *
 * A service whose `emit` is not callable is treated as absent, and so is a
 * context whose `get` throws: an absent channel must not crash an attempt, and
 * the result says which of the two it was.
 * @param ctx - the context the controller runs in.
 */
export function resolveProductTelemetry(ctx: ProductTelemetryContext): ProductTelemetryPort | undefined {
  const candidate = probeProductTelemetry(ctx)
  return candidate.available ? candidate.port : undefined
}

/**
 * Export one settled attempt, or report why no channel took it.
 *
 * The record is built **before** the channel is resolved, so a malformed event
 * is refused in every profile — a validation that only ran where a collector
 * exists would let a leak ship silently.
 * @param ctx - the context the controller runs in.
 * @param input - the attempt to report.
 * @returns whether the record was handed to the platform service, and why not.
 * @throws {TypeError} when the event itself is malformed (see {@link toProductEvent}).
 */
export function emitProductEvent(ctx: ProductTelemetryContext, input: ProductEventInput): ProductEmitResult {
  const record = toProductEvent(input)
  const resolution = probeProductTelemetry(ctx)
  if (!resolution.available) {
    return Object.freeze({ emitted: false, reason: resolution.reason, eventName: record.eventName })
  }
  try {
    resolution.port.emit(record)
  } catch {
    // A mounted channel that throws is still a channel that did not take the
    // record. Telemetry is not allowed to fail an attempt, and the reason says
    // which kind of failure it was.
    return Object.freeze({ emitted: false, reason: 'telemetry-failed', eventName: record.eventName })
  }
  return Object.freeze({ emitted: true, reason: 'emitted', eventName: record.eventName })
}

/**
 * Look up the platform service without ever throwing.
 *
 * `ctx.get` is a live service lookup, and a composition may throw from it (a
 * provider that fails to construct, a proxy that refuses). That is a channel we
 * do not have, not an attempt that must die: the caller gets a reason instead.
 * @param ctx - the context the controller runs in.
 * @returns the channel, or why there is none.
 */
function probeProductTelemetry(ctx: ProductTelemetryContext): ProductTelemetryResolution {
  let candidate: unknown
  try {
    candidate = ctx.get(PRODUCT_TELEMETRY_SERVICE)
  } catch {
    return Object.freeze({ available: false, reason: 'telemetry-unavailable' })
  }
  if (candidate === undefined || candidate === null) {
    return Object.freeze({ available: false, reason: 'telemetry-disabled' })
  }
  const emit = (candidate as { emit?: unknown }).emit
  if (typeof emit !== 'function') {
    return Object.freeze({ available: false, reason: 'telemetry-disabled' })
  }
  return Object.freeze({ available: true, port: candidate as ProductTelemetryPort })
}

/** Attributes of one event, built from the typed input and the allowlist only. */
function attributesOf(input: ProductEventInput): Record<string, ProductTelemetryScalar> {
  const attributes: Record<string, ProductTelemetryScalar> = {
    'mywork.correlation_id': input.correlationId,
  }
  if (input.workspaceId !== undefined) attributes['mywork.workspace_id'] = input.workspaceId
  if (input.taskId !== undefined) attributes['mywork.task_id'] = input.taskId
  if (input.attemptId !== undefined) attributes['mywork.attempt_id'] = input.attemptId
  if (input.operationId !== undefined) attributes['mywork.operation_id'] = input.operationId
  if (input.operationDomain !== undefined) attributes['mywork.operation_domain'] = input.operationDomain
  attributes['mywork.outcome'] = input.outcome
  if (input.durationMs !== undefined) attributes['mywork.duration_ms'] = input.durationMs
  if (input.attemptCount !== undefined) attributes['mywork.attempt_count'] = input.attemptCount
  for (const [key, value] of Object.entries(input.attributes ?? {})) {
    // Derived keys are part of the event's own shape; letting a caller restate
    // one would let an event claim an outcome its name does not.
    if (key in attributes) {
      throw new TypeError(`dsh-mywork: product event attribute "${key}" is derived from the event and cannot be supplied`)
    }
    attributes[key] = value as ProductTelemetryScalar
  }
  return attributes
}

/**
 * Refuse anything that is not a product event MyWork is allowed to disclose.
 *
 * Runs on every path, including a profile with no collector: a validation that
 * only ran where telemetry is mounted would let a leak ship silently from the
 * profiles that matter least to observe and most to protect.
 * @param raw - the candidate event.
 * @throws {TypeError} on an unknown field, an attribute outside
 *   {@link PRODUCT_ATTRIBUTE_SHAPES}, or a missing correlation id or clock
 *   reading.
 */
function assertProductEventInput(raw: unknown): asserts raw is ProductEventInput {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`dsh-mywork: a product event must be an object, received ${describeValue(raw)}`)
  }
  const candidate = raw as Record<string, unknown>
  for (const key of Object.keys(candidate)) {
    if (!PRODUCT_EVENT_INPUT_FIELDS.includes(key)) {
      throw new TypeError(
        `dsh-mywork: "${key}" is not a field of a product event; a product event carries ${PRODUCT_EVENT_INPUT_FIELDS.join(', ')}`,
      )
    }
  }
  if (typeof candidate.correlationId !== 'string' || candidate.correlationId.trim() === '') {
    throw new TypeError('dsh-mywork: a product event needs a non-empty correlationId')
  }
  if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) {
    throw new TypeError(`dsh-mywork: a product event needs a finite timestamp, received ${describeValue(candidate.at)}`)
  }
  assertAttributes(candidate.attributes)
}

/** Refuse an attribute set that names a key outside the allowlist. */
function assertAttributes(raw: unknown): void {
  if (raw === undefined) return
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`dsh-mywork: product event attributes must be an object, received ${describeValue(raw)}`)
  }
  for (const key of Object.keys(raw)) {
    if (!(key in PRODUCT_ATTRIBUTE_SHAPES)) {
      throw new TypeError(
        `dsh-mywork: "${key}" is not an allowlisted product event attribute; allowed: ${PRODUCT_ATTRIBUTE_ALLOWLIST.join(', ')}`,
      )
    }
  }
}

/**
 * Refuse an attribute whose value does not fit the shape its key declares.
 *
 * Runs over the **finished** attribute map, so a value derived from the input is
 * checked exactly like one a caller supplied: `durationMs: NaN`, a string under
 * `mywork.attempt_count`, or a free string under `mywork.operation_domain` are
 * all refused here rather than exported (review B6).
 * @param attributes - the attributes of one event, after both sources merged.
 * @throws {TypeError} on a value that does not fit its declared shape.
 */
function assertAttributeShapes(attributes: Record<string, ProductTelemetryScalar>): void {
  for (const [key, value] of Object.entries(attributes)) {
    const shape = PRODUCT_ATTRIBUTE_SHAPES[key]
    if (shape === undefined) {
      throw new TypeError(
        `dsh-mywork: "${key}" is not an allowlisted product event attribute; allowed: ${PRODUCT_ATTRIBUTE_ALLOWLIST.join(', ')}`,
      )
    }
    if (!fitsAttributeShape(shape, value)) {
      throw new TypeError(
        `dsh-mywork: product event attribute "${key}" must be ${describeShape(shape)}, received ${describeValue(value)}`,
      )
    }
  }
}

/** Whether a value fits the declared shape of its attribute. */
function fitsAttributeShape(shape: ProductAttributeShape, value: unknown): boolean {
  switch (shape) {
    case 'identifier':
      return typeof value === 'string' && value.trim() !== ''
    case 'duration-ms':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
    case 'count':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0
    case 'outcome':
      return typeof value === 'string' && (PRODUCT_EVENT_OUTCOMES as readonly string[]).includes(value)
    case 'operation-domain':
      return typeof value === 'string' && (OPERATION_DOMAINS as readonly string[]).includes(value)
  }
}

/** Human-readable statement of one attribute shape, for refusal messages. */
function describeShape(shape: ProductAttributeShape): string {
  switch (shape) {
    case 'identifier':
      return 'a non-empty string'
    case 'duration-ms':
      return 'a finite number of milliseconds, zero or more'
    case 'count':
      return 'a finite non-negative integer'
    case 'outcome':
      return `one of ${PRODUCT_EVENT_OUTCOMES.join(', ')}`
    case 'operation-domain':
      return `one of ${OPERATION_DOMAINS.join(', ')}`
  }
}

/** Human-readable kind of a refused value. */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}
