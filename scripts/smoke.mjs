#!/usr/bin/env node
/**
 * Reproducible MyWork smoke check.
 *
 * Mounts the built controller plugin on a real Cordis context, asserts the
 * published service and its lifecycle, unloads it, and exercises the
 * deterministic fakes. Keyless by construction: no model, no provider, no
 * subprocess, and no wall-clock dependency.
 *
 * Run `pnpm run smoke` (or `pnpm run check`), which builds first.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root; every artifact below is addressed from here. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Built entry points this smoke loads, exactly as an installed consumer would. */
const entries = {
  contracts: 'packages/contracts/lib/index.js',
  core: 'packages/core/lib/index.js',
  adapterSdk: 'packages/adapter-sdk/lib/index.js',
  testing: 'packages/adapter-sdk/lib/testing.js',
  controller: 'packages/controller/lib/index.js',
}

const missing = Object.values(entries).filter(relative => !existsSync(join(repoRoot, relative)))
if (missing.length > 0) {
  console.error(`smoke: missing build output: ${missing.join(', ')}`)
  console.error('smoke: run "pnpm run build" first (or use "pnpm run check")')
  process.exit(1)
}

const [contracts, core, adapterSdk, testing, controller] = await Promise.all(
  Object.values(entries).map(relative => import(pathToFileURL(join(repoRoot, relative)).href)),
)

const controllerManifest = JSON.parse(
  readFileSync(join(repoRoot, 'packages', 'controller', 'package.json'), 'utf8'),
)

const { Context } = await import('@deepseek-ai/cordis')

let failures = 0

/**
 * Run one named step, reporting its outcome without stopping the suite.
 * @param label - human-readable step description.
 * @param body - step body; a throw marks the step failed.
 */
async function step(label, body) {
  try {
    await body()
    console.log(`ok   ${label}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL ${label}`)
    console.error(error)
  }
}

/** Capture stderr writes for the duration of one body. */
async function capturingStderr(body) {
  const lines = []
  const original = process.stderr.write
  process.stderr.write = (chunk, ...rest) => {
    lines.push(String(chunk))
    return Reflect.apply(original, process.stderr, [chunk, ...rest])
  }
  try {
    await body()
  } finally {
    process.stderr.write = original
  }
  return lines
}

/** State shared by the mount and unload steps. */
let mounted

await step('plugin module exposes the bundle entry shape', () => {
  assert.equal(controller.name, '@dsh-mywork/controller')
  assert.equal(typeof controller.apply, 'function')
  assert.equal(controller.CONTROLLER_VERSION, controllerManifest.version, 'CONTROLLER_VERSION must match package.json')
  assert.deepEqual([...controller.BOUNDED_CONTEXTS], ['control'])
})

await step('mount publishes myworkController and freezes its snapshot', async () => {
  const clock = new testing.FakeClock(1_000)
  const ctx = new Context()
  await ctx.plugin({
    name: 'fake-clock-provider',
    apply(context) {
      context.provide(contracts.MYWORK_CLOCK_SERVICE, clock)
    },
  })

  const fiber = ctx.plugin(controller, { diagnostics: false })
  await fiber.await()

  const service = ctx.get(contracts.MYWORK_CONTROLLER_SERVICE)
  assert.ok(service !== undefined, 'myworkController must be published while mounted')
  const info = service.info()
  assert.equal(info.status, 'mounted')
  assert.equal(info.service, contracts.MYWORK_CONTROLLER_SERVICE)
  assert.equal(info.version, controllerManifest.version)
  assert.equal(info.mountedAt, 1_000, 'the injected clock must supply the mount timestamp')
  assert.deepEqual([...info.boundedContexts], ['control'])
  assert.equal(Object.isFrozen(info), true)
  assert.ok(
    fiber.getEffects().some(effect => effect.label.includes('mywork controller shutdown')),
    'the shutdown effect must be registered on the plugin fiber',
  )
  mounted = { ctx, fiber, service }
})

await step('unload removes the service and settles the controller', async () => {
  assert.ok(mounted !== undefined, 'the mount step must run first')
  const { ctx, fiber, service } = mounted
  await fiber.dispose()
  assert.equal(ctx.get(contracts.MYWORK_CONTROLLER_SERVICE), undefined, 'the service must be gone after unload')
  const info = service.info()
  assert.equal(info.status, 'stopped')
  assert.equal(info.stoppedAt, 1_000)
  assert.equal(core.controllerUptimeMs({ phase: 'mounted', mountedAt: 1_000 }, 1_400), 400)
})

await step('diagnostics config writes one line per lifecycle transition', async () => {
  const ctx = new Context()
  const lines = await capturingStderr(async () => {
    const fiber = ctx.plugin(controller, { diagnostics: true })
    await fiber.await()
    await fiber.dispose()
  })
  assert.equal(lines.length, 2, `expected exactly two diagnostic lines, received ${JSON.stringify(lines)}`)
  assert.match(lines[0], /^dsh-mywork: controller mounted service=myworkController version=\d+\.\d+\.\d+ contexts=control\n$/)
  assert.match(lines[1], /^dsh-mywork: controller stopped service=myworkController version=\d+\.\d+\.\d+ uptimeMs=\d+\n$/)
})

await step('configuration resolution accepts defaults and rejects malformed rows', () => {
  assert.equal(core.resolveControllerConfig(undefined).diagnostics, false)
  assert.equal(core.resolveControllerConfig({}).diagnostics, false)
  assert.equal(core.resolveControllerConfig({ diagnostics: true }).diagnostics, true)
  assert.throws(() => core.resolveControllerConfig({ diagnostics: 'yes' }), TypeError)
  assert.throws(() => core.resolveControllerConfig('diagnostics'), TypeError)
})

await step('a malformed row config fails the plugin load loudly', async () => {
  const ctx = new Context()
  const fiber = ctx.plugin(controller, { diagnostics: 'yes' })
  await assert.rejects(fiber.await(), TypeError)
  assert.equal(ctx.get(contracts.MYWORK_CONTROLLER_SERVICE), undefined)
})

await step('FakeClock advances, resolves, and cancels deterministically', async () => {
  const clock = new testing.FakeClock(1_000)
  assert.equal(clock.now(), 1_000)
  const sleeping = clock.sleep(500)
  assert.equal(clock.pendingSleeps, 1)
  await clock.advance(499)
  assert.equal(clock.pendingSleeps, 1, 'a sleep must not resolve before its due time')
  await clock.advance(1)
  await sleeping
  assert.equal(clock.pendingSleeps, 0)

  const abort = new AbortController()
  const cancelled = clock.sleep(100, abort.signal)
  abort.abort()
  await assert.rejects(cancelled, error => adapterSdk.isAdapterError(error) && error.code === 'cancelled')
  assert.equal(clock.pendingSleeps, 0)
  await assert.rejects(clock.advance(-1), RangeError)
})

await step('FakeAgentRuntime records runs and fails like the port contract', async () => {
  const runtime = new testing.FakeAgentRuntime()
  const handle = await runtime.start({ runId: 'run-1', workspacePath: '/w', prompt: 'do work' })
  assert.deepEqual(handle, { runId: 'run-1' })
  assert.deepEqual(await runtime.status(handle), { runId: 'run-1', running: true })
  await runtime.stop(handle)
  assert.deepEqual(await runtime.status(handle), { runId: 'run-1', running: false })
  await runtime.stop(handle)
  assert.deepEqual(runtime.startedRunIds, ['run-1'])
  await assert.rejects(
    runtime.start({ runId: 'run-1', workspacePath: '/w', prompt: 'again' }),
    error => adapterSdk.isAdapterError(error) && error.code === 'conflict',
  )
  await assert.rejects(
    runtime.status({ runId: 'missing' }),
    error => adapterSdk.isAdapterError(error) && error.code === 'invalid-ref',
  )
})

await step('adapter manifests validate before registration', () => {
  const manifest = adapterSdk.defineAdapterManifest({
    adapterId: 'beads',
    kind: 'taskgraph',
    contractVersion: 'taskgraph/v1',
    capabilities: { claim: true, replan: false },
  })
  assert.equal(Object.isFrozen(manifest), true)
  assert.equal(Object.isFrozen(manifest.capabilities), true)
  assert.equal(adapterSdk.supportsCapability(manifest, 'claim'), true)
  assert.equal(adapterSdk.supportsCapability(manifest, 'replan'), false)
  assert.equal(adapterSdk.supportsCapability(manifest, 'unknown'), false)
  assert.throws(() => adapterSdk.defineAdapterManifest({ ...manifest, kind: 'unknown' }), TypeError)
  assert.throws(() => adapterSdk.defineAdapterManifest({ ...manifest, adapterId: ' ' }), TypeError)
  const error = new adapterSdk.AdapterError('timeout', 'dsh-mywork: deadline')
  assert.equal(error.code, 'timeout')
  assert.equal(adapterSdk.isAdapterError(error), true)
  assert.equal(adapterSdk.isAdapterError(new Error('plain')), false)
})

/** State shared by the adapter-registry steps. */
let adaptersMounted

await step('the controller publishes myworkAdapters and accepts a compatible adapter', async () => {
  const ctx = new Context()
  const fiber = ctx.plugin(controller, { diagnostics: false })
  await fiber.await()
  const adapters = ctx.get(contracts.MYWORK_ADAPTERS_SERVICE)
  assert.ok(adapters !== undefined, 'myworkAdapters must be published while mounted')
  const handle = adapters.register(testing.fakeAdapterRegistration({ id: 'smoke-memory' }))
  assert.equal(adapters.size, 1)
  const resolved = adapters.resolve('memory', { capabilities: ['retain', 'recall'] })
  assert.equal(resolved.ok, true, 'a capability-compatible adapter must resolve')
  assert.equal(resolved.adapter, handle.adapter)
  assert.deepEqual(
    adapters.list('memory').map(manifest => manifest.adapterId),
    ['smoke-memory'],
  )
  adaptersMounted = { ctx, fiber, adapters, handle }
})

await step('an incompatible revision or a required capability is refused explicitly', () => {
  const { adapters } = adaptersMounted
  assert.throws(
    () => adapters.register(testing.fakeAdapterRegistration({ id: 'too-new', contractVersion: 'memory/v2' })),
    error => adapterSdk.isAdapterRefusal(error) && error.code === 'CONTRACT_MISMATCH',
  )
  const missing = adapters.resolve('memory', { capabilities: ['reflect'] })
  assert.equal(missing.ok, false)
  assert.equal(missing.refusal.code, 'CAPABILITY_UNSUPPORTED')
  assert.deepEqual(missing.refusal.details.missing, ['reflect'])
  const absent = adapters.resolve('taskgraph')
  assert.equal(absent.ok, false)
  assert.equal(absent.refusal.code, 'ADAPTER_UNAVAILABLE')
})

await step('unload drops the registrations together with the service', async () => {
  const { ctx, fiber, handle } = adaptersMounted
  await fiber.dispose()
  assert.equal(ctx.get(contracts.MYWORK_ADAPTERS_SERVICE), undefined, 'the service must be gone after unload')
  assert.equal(handle.unregister(), false, 'unload must have removed the registration')
})

if (failures > 0) {
  console.error(`smoke: ${failures} step(s) failed`)
  process.exitCode = 1
} else {
  console.log('smoke: all steps passed')
}
