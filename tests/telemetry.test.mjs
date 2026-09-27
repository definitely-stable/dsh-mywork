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
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { repoRoot } from './lib/fixtures.mjs'
import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'

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
