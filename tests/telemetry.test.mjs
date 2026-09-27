/**
 * Product telemetry export (F-54, D16).
 *
 * The event MyWork sends outward is asserted by source, not by the exporter:
 * the event name comes from a closed set, the body is a fixed string that
 * carries no input value, and a profile without `productTelemetry` keeps
 * working with an explicit "disabled" result instead of a thrown error.
 *
 * The built controller bundle is imported exactly as a consumer receives it, so
 * a broken build fails here instead of silently testing sources.
 */

import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'

/**
 * Repository root, derived here rather than taken from `lib/fixtures.mjs`.
 *
 * That helper refuses to load while ANY package's `lib/` is missing, and the
 * shared tree is built by several workstreams at once — a sibling build that
 * cleans `lib/` would fail this suite for a reason that has nothing to do with
 * telemetry. This suite needs one bundle, so it depends on one bundle.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The bundle is imported, not mounted, but it inlines the composition root and
// therefore the storage layer. Pinning `DSH_HOME` first — and proving it is
// inside `<repo>/.tmp/` — keeps the import path incapable of reaching a live
// profile even if a later edit gives the module top-level state.
scratchDshHome('telemetry')
assertScratchHome()

/** The built controller, exactly as a consumer receives it. */
const controller = await import(pathToFileURL(join(repoRoot, 'packages/controller/lib/index.js')).href)

/** The telemetry surface of the built controller. */
const telemetry = {
  PRODUCT_TELEMETRY_SERVICE: controller.PRODUCT_TELEMETRY_SERVICE,
  PRODUCT_EVENT_NAMES: controller.PRODUCT_EVENT_NAMES,
  PRODUCT_EVENT_BODIES: controller.PRODUCT_EVENT_BODIES,
  PRODUCT_EVENT_INPUT_FIELDS: controller.PRODUCT_EVENT_INPUT_FIELDS,
  PRODUCT_ATTRIBUTE_ALLOWLIST: controller.PRODUCT_ATTRIBUTE_ALLOWLIST,
  PRODUCT_ATTRIBUTE_SHAPES: controller.PRODUCT_ATTRIBUTE_SHAPES,
  toProductEvent: controller.toProductEvent,
  emitProductEvent: controller.emitProductEvent,
}

/** The event every test in this file starts from. */
const EVENT = Object.freeze({
  correlationId: 'corr-1',
  operationId: 'op-1',
  workspaceId: 'W-1',
  outcome: 'succeeded',
  durationMs: 1_250,
  at: 1_700_000_000_000,
})

test('an attempt outcome becomes one event of a closed set with a fixed body', () => {
  // The set is asserted against literals: a constant compared with itself would
  // pass even if the set became a catch-all.
  assert.deepEqual(telemetry.PRODUCT_EVENT_NAMES, [
    'mywork.attempt.succeeded',
    'mywork.attempt.failed',
    'mywork.attempt.refused',
  ])

  const record = telemetry.toProductEvent(EVENT)
  assert.equal(record.eventName, 'mywork.attempt.succeeded')
  assert.ok(telemetry.PRODUCT_EVENT_NAMES.includes(record.eventName))
  assert.equal(record.body, 'dsh-mywork: attempt succeeded')
  assert.equal(record.timestamp, EVENT.at)
  assert.deepEqual(record.attributes, {
    'mywork.correlation_id': 'corr-1',
    'mywork.workspace_id': 'W-1',
    'mywork.operation_id': 'op-1',
    'mywork.outcome': 'succeeded',
    'mywork.duration_ms': 1250,
  })

  // `body` is the leak channel the platform does not redact, so "fixed" is
  // proven by the absence of every input value rather than by its wording.
  for (const value of ['corr-1', 'W-1', 'op-1']) {
    assert.equal(record.body.includes(value), false, `the body must not carry "${value}"`)
  }

  // Every outcome maps into the same closed set, and every body stays fixed.
  const expected = [
    ['succeeded', 'mywork.attempt.succeeded', 'dsh-mywork: attempt succeeded'],
    ['failed', 'mywork.attempt.failed', 'dsh-mywork: attempt failed'],
    ['refused', 'mywork.attempt.refused', 'dsh-mywork: attempt refused'],
  ]
  for (const [outcome, eventName, body] of expected) {
    const built = telemetry.toProductEvent({ ...EVENT, outcome })
    assert.equal(built.eventName, eventName, `${outcome} must map to ${eventName}`)
    assert.equal(built.body, body, `${outcome} must carry a fixed body`)
    assert.ok(telemetry.PRODUCT_EVENT_NAMES.includes(built.eventName))
  }
  // An outcome outside the union is refused instead of producing a nameless event.
  assert.throws(() => telemetry.toProductEvent({ ...EVENT, outcome: 'maybe' }), TypeError)
})

test('emit reports telemetry disabled when the profile mounts no service', () => {
  const asked = []
  const ctx = {
    get(name) {
      asked.push(name)
      return undefined
    },
  }

  const result = telemetry.emitProductEvent(ctx, EVENT)
  assert.equal(result.emitted, false)
  assert.equal(result.reason, 'telemetry-disabled')
  assert.equal(result.eventName, 'mywork.attempt.succeeded')
  // The only service the export asks for is the platform's own name.
  assert.deepEqual(asked, ['productTelemetry'])
  assert.equal(telemetry.PRODUCT_TELEMETRY_SERVICE, 'productTelemetry')
})

test('emit delivers exactly one record when the service is present', () => {
  const delivered = []
  const ctx = {
    get: name => (name === 'productTelemetry' ? { emit: record => delivered.push(record) } : undefined),
  }

  const result = telemetry.emitProductEvent(ctx, EVENT)
  assert.equal(result.emitted, true)
  assert.equal(result.reason, 'emitted')
  assert.equal(delivered.length, 1, 'exactly one record per settled attempt')
  assert.deepEqual(delivered[0], telemetry.toProductEvent(EVENT))

  // A service whose `emit` is not callable is an absent channel, not a crash:
  // an attempt must never fail because telemetry is misconfigured.
  const broken = { get: () => ({}) }
  const skipped = telemetry.emitProductEvent(broken, EVENT)
  assert.equal(skipped.emitted, false)
  assert.equal(skipped.reason, 'telemetry-disabled')
})

test('the attribute allowlist refuses a forbidden or unknown key at every level', () => {
  // The seven keys F-55 names as the leak channels, plus one that is merely
  // unknown: an allowlist refuses all eight, while a denylist built from the
  // same seven would have let the eighth through.
  const forbidden = ['prompt', 'content', 'body', 'bytes', 'payload', 'stderr', 'stdout', 'diff']

  const delivered = []
  const ctx = { get: () => ({ emit: record => delivered.push(record) }) }

  for (const key of forbidden) {
    assert.throws(
      () => telemetry.emitProductEvent(ctx, { ...EVENT, attributes: { [key]: 'secret' } }),
      TypeError,
      `attribute "${key}" must be refused`,
    )
  }

  // The allowlist is asserted against literals: comparing it with itself would
  // pass whatever it became.
  assert.deepEqual(telemetry.PRODUCT_ATTRIBUTE_ALLOWLIST, [
    'mywork.correlation_id',
    'mywork.workspace_id',
    'mywork.task_id',
    'mywork.attempt_id',
    'mywork.operation_id',
    'mywork.operation_domain',
    'mywork.outcome',
    'mywork.duration_ms',
    'mywork.attempt_count',
  ])
  for (const key of forbidden) {
    assert.equal(telemetry.PRODUCT_ATTRIBUTE_ALLOWLIST.includes(key), false, `"${key}" must not be allowlisted`)
  }

  // The body decision is part of the same policy: `body` is neither an event
  // field nor an attribute, so neither level can reach it.
  assert.equal(telemetry.PRODUCT_EVENT_INPUT_FIELDS.includes('body'), false)
  for (const key of forbidden) {
    assert.equal(telemetry.PRODUCT_EVENT_INPUT_FIELDS.includes(key), false, `"${key}" must not be an event field`)
  }
  assert.throws(() => telemetry.emitProductEvent(ctx, { ...EVENT, body: 'file contents' }), TypeError)

  // Nothing reached the sink: the refusal happens before the record is built.
  assert.deepEqual(delivered, [])

  // A nested object cannot smuggle content through an allowlisted key: the
  // shape gate catches it. (The scalar-only check this comment used to describe
  // was unreachable for the case it named — review B6, "не воспроизводимые
  // утверждения" 1 — so the claim now matches the reachable behaviour.)
  assert.throws(
    () => telemetry.emitProductEvent(ctx, { ...EVENT, attributes: { 'mywork.operation_domain': { body: 'x' } } }),
    TypeError,
  )

  // An allowlisted attribute is delivered, so the gate is not a blanket refusal.
  const extra = telemetry.emitProductEvent(ctx, { ...EVENT, attributes: { 'mywork.attempt_count': 2 } })
  assert.equal(extra.emitted, true)
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].attributes['mywork.attempt_count'], 2)

  // Validation runs before the channel is resolved, so a malformed event is
  // refused even where no collector exists — and the channel is never asked.
  const asked = []
  const absent = {
    get(name) {
      asked.push(name)
      return undefined
    },
  }
  assert.throws(() => telemetry.emitProductEvent(absent, { ...EVENT, attributes: { prompt: 'x' } }), TypeError)
  assert.deepEqual(asked, [], 'a malformed event must be refused without asking for a channel')
})

test('an allowlisted attribute must carry the shape its key declares', () => {
  // Every key names a shape, and the shapes are asserted against literals: a
  // table compared with itself would pass whatever it became.
  assert.deepEqual(telemetry.PRODUCT_ATTRIBUTE_SHAPES, {
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
  assert.deepEqual(telemetry.PRODUCT_ATTRIBUTE_ALLOWLIST, Object.keys(telemetry.PRODUCT_ATTRIBUTE_SHAPES))

  const delivered = []
  const ctx = { get: () => ({ emit: record => delivered.push(record) }) }
  const refuse = (label, input) => {
    assert.throws(() => telemetry.emitProductEvent(ctx, { ...EVENT, ...input }), TypeError, label)
  }

  // The case review B6 reproduced: a string under a key whose type promises a
  // number was delivered before this gate existed.
  refuse('a string under attempt_count', { attributes: { 'mywork.attempt_count': '3 OR 1=1 -- secret notes' } })
  refuse('a fractional attempt_count', { attributes: { 'mywork.attempt_count': 1.5 } })
  refuse('a negative attempt_count', { attributes: { 'mywork.attempt_count': -1 } })
  refuse('a numeric string under duration_ms', { attributes: { 'mywork.duration_ms': '1250' } })
  refuse('an empty identifier', { attributes: { 'mywork.workspace_id': '' } })
  refuse('a number as an identifier', { attributes: { 'mywork.task_id': 7 } })
  refuse('an unknown operation domain', { attributes: { 'mywork.operation_domain': 'not-a-domain' } })
  refuse('an outcome outside the closed set', { attributes: { 'mywork.outcome': 'maybe' } })
  // The same gate covers values DERIVED from the typed input, not just the
  // ones a caller supplies: the type says `number`, and the runtime says so too.
  refuse('a NaN duration', { durationMs: Number.NaN })
  refuse('a negative duration', { durationMs: -5 })
  refuse('an infinite duration', { durationMs: Number.POSITIVE_INFINITY })
  refuse('a string duration', { durationMs: 'slow' })
  refuse('a false correlation id', { correlationId: '   ' })

  // Nothing above reached the sink, and a conforming value still does.
  assert.deepEqual(delivered, [])
  const accepted = telemetry.emitProductEvent(ctx, {
    ...EVENT,
    operationDomain: 'filesystem',
    attemptCount: 3,
  })
  assert.equal(accepted.emitted, true)
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].attributes['mywork.attempt_count'], 3)
  assert.equal(delivered[0].attributes['mywork.operation_domain'], 'filesystem')
})

test('telemetry never fails an attempt: an unusable channel is reported, not thrown', () => {
  // A context whose lookup throws is a channel we do not have. Before review B6
  // this propagated, which contradicted the fail-open contract of F-54.
  const throwing = {
    get() {
      throw new Error('boom')
    },
  }
  const unavailable = telemetry.emitProductEvent(throwing, EVENT)
  assert.equal(unavailable.emitted, false)
  assert.equal(unavailable.reason, 'telemetry-unavailable')
  assert.equal(unavailable.eventName, 'mywork.attempt.succeeded')

  // Absent stays distinct from throwing, and a service without `emit` is absent.
  assert.equal(telemetry.emitProductEvent({ get: () => undefined }, EVENT).reason, 'telemetry-disabled')
  assert.equal(telemetry.emitProductEvent({ get: () => ({}) }, EVENT).reason, 'telemetry-disabled')

  // A mounted channel that throws did not take the record, and that too is a
  // report rather than a crash.
  const failing = {
    get: () => ({
      emit() {
        throw new Error('collector down')
      },
    }),
  }
  const failed = telemetry.emitProductEvent(failing, EVENT)
  assert.equal(failed.emitted, false)
  assert.equal(failed.reason, 'telemetry-failed')

  // Fail-open is about the channel, never about the event: a malformed record is
  // still refused when the lookup throws.
  assert.throws(() => telemetry.emitProductEvent(throwing, { ...EVENT, attributes: { prompt: 'secret' } }), TypeError)
  assert.throws(() => telemetry.emitProductEvent(throwing, { ...EVENT, durationMs: Number.NaN }), TypeError)
})
