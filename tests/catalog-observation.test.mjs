/**
 * Model-catalog observation boundary for scheduler policy.
 *
 * refresh() is the only method allowed to touch the adapter/catalog/providers;
 * read() is a cached, immutable data read suitable for SchedulerStatePort.
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { adapterSdk, repoRoot } from './lib/fixtures.mjs'

const controller = await import(pathToFileURL(join(repoRoot, 'packages/controller/lib/index.js')).href)

function registerCatalog(adapters, catalog, id = 'test-catalog') {
  return adapters.register({
    kind: 'model-catalog',
    id,
    contractVersion: adapterSdk.portContractVersion('model-catalog'),
    capabilities: {},
    create: () => catalog,
  })
}

test('an empty registry becomes an empty observation only after refresh, without a refusal', async () => {
  const refusals = []
  const adapters = adapterSdk.createAdapterRegistry({
    observer: { onRefused: refusal => refusals.push(refusal) },
  })
  const observation = controller.createCatalogObservation(adapters)

  assert.equal(observation.ready, false, 'a mutable registry has not been observed merely because it is empty right now')
  assert.throws(
    () => observation.read(),
    error => controller.isControllerRuntimeError(error) && error.code === 'state-unavailable',
  )
  assert.deepEqual(await observation.refresh(), { providers: [], models: [], outages: [] })
  assert.equal(observation.ready, true)
  assert.deepEqual(observation.read(), { providers: [], models: [], outages: [] })
  assert.equal(refusals.length, 0, 'absence is observed through list(), not manufactured as a resolve refusal')

  const noRegistry = controller.createCatalogObservation()
  assert.equal(noRegistry.ready, true, 'without a registry there is no live catalog surface to observe')
  assert.deepEqual(noRegistry.read(), { providers: [], models: [], outages: [] })
})

test('a registered catalog is unavailable to read until refresh, then read performs zero provider I/O', async () => {
  let providerReads = 0
  let modelReads = 0
  const adapters = adapterSdk.createAdapterRegistry()
  registerCatalog(adapters, {
    listProviders() {
      providerReads += 1
      return [{ id: 'glm', name: 'GLM' }]
    },
    async listModels(provider) {
      modelReads += 1
      return [{ provider, id: 'flash', name: 'Flash' }]
    },
    async resolveModelInfo() {
      throw new Error('not used by catalog observation')
    },
  })

  const observation = controller.createCatalogObservation(adapters)
  assert.equal(observation.ready, false)
  assert.throws(
    () => observation.read(),
    error => controller.isControllerRuntimeError(error) && error.code === 'state-unavailable',
  )

  const snapshot = await observation.refresh()
  assert.equal(observation.ready, true)
  assert.deepEqual(snapshot, {
    providers: [{ id: 'glm', name: 'GLM' }],
    models: [{ provider: 'glm', id: 'flash', name: 'Flash' }],
    outages: [],
  })
  assert.equal(providerReads, 1)
  assert.equal(modelReads, 1)

  observation.read()
  observation.read()
  observation.read()
  assert.equal(providerReads, 1, 'cached reads must not call listProviders again')
  assert.equal(modelReads, 1, 'cached reads must not call listModels again')
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.providers), true)
  assert.equal(Object.isFrozen(snapshot.models), true)
})

test('one provider outage is data and does not erase healthy providers or models', async () => {
  const adapters = adapterSdk.createAdapterRegistry()
  registerCatalog(adapters, {
    listProviders: () => [
      { id: 'healthy', name: 'Healthy' },
      { id: 'down', name: 'Down' },
    ],
    async listModels(provider) {
      if (provider === 'down') throw new Error('provider timed out')
      return [{ provider, id: 'm-1', name: 'Model 1' }]
    },
    async resolveModelInfo() {
      throw new Error('not used')
    },
  })
  const observation = controller.createCatalogObservation(adapters)

  assert.deepEqual(await observation.refresh(), {
    providers: [
      { id: 'healthy', name: 'Healthy' },
      { id: 'down', name: 'Down' },
    ],
    models: [{ provider: 'healthy', id: 'm-1', name: 'Model 1' }],
    outages: [{ provider: 'down', detail: 'provider timed out' }],
  })
})

test('concurrent refreshes single-flight the provider read', async () => {
  let modelReads = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const adapters = adapterSdk.createAdapterRegistry()
  registerCatalog(adapters, {
    listProviders: () => [{ id: 'glm', name: 'GLM' }],
    async listModels(provider) {
      modelReads += 1
      await gate
      return [{ provider, id: 'flash', name: 'Flash' }]
    },
    async resolveModelInfo() {
      throw new Error('not used')
    },
  })
  const observation = controller.createCatalogObservation(adapters)

  const first = observation.refresh()
  const second = observation.refresh()
  assert.equal(first, second, 'overlapping refresh callers share one promise')
  await Promise.resolve()
  assert.equal(modelReads, 1)
  release()
  await first
  assert.equal(modelReads, 1)
})

test('a failed refresh leaves the last completed snapshot readable', async () => {
  let fail = false
  const adapters = adapterSdk.createAdapterRegistry()
  registerCatalog(adapters, {
    listProviders() {
      if (fail) throw new Error('registry unavailable')
      return [{ id: 'glm', name: 'GLM' }]
    },
    async listModels(provider) {
      return [{ provider, id: 'flash', name: 'Flash' }]
    },
    async resolveModelInfo() {
      throw new Error('not used')
    },
  })
  const observation = controller.createCatalogObservation(adapters)
  const good = await observation.refresh()
  fail = true

  await assert.rejects(observation.refresh(), /registry unavailable/)
  assert.equal(observation.read(), good, 'a failed refresh must not replace the last completed observation')
})
