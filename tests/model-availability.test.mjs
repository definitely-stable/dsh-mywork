/**
 * Model availability (F-43, D20).
 *
 * "The model is not available" has to be a typed refusal, and it has to be
 * distinguishable from its neighbours: a provider the catalog does not register
 * at all, and a provider that did not answer. Before this step both "no such
 * model" and "no such provider" reported `route-absent`, so an operator could
 * not tell a wrong policy entry from a provider that is simply absent.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { adapterTesting, contracts, core, repoRoot } from './lib/fixtures.mjs'

/** The controller bundle, loaded the way a consumer would. */
const controllerEntry = join(repoRoot, 'packages/controller/lib/index.js')
if (!existsSync(controllerEntry)) {
  throw new Error(`model availability tests: missing build output: ${controllerEntry}; run "pnpm run build" first`)
}
const controller = await import(pathToFileURL(controllerEntry).href)

/** A policy that names one route, permits no fallback, and asks for no escalation. */
const singleRoute = { preferred: 'glm/sonnet', fallback: [], escalation: [] }

test('a registered provider that cannot resolve the named model is model-not-routable, not an outage', async () => {
  // The provider is registered and its catalogue answers — it simply does not
  // serve the named model. What this test proves is that branch, and only it: an
  // empty advertised list would still route if resolution answered, so nothing
  // here claims the "empty listModels" path, only the refusal reason.
  const catalog = new adapterTesting.FakeModelCatalog({ providers: [{ id: 'glm', name: 'GLM' }], models: {} })
  const decision = await core.routeModel({ port: catalog, request: { policy: singleRoute } })

  assert.equal(decision.kind, 'refused')
  assert.equal(decision.reason, 'model-not-routable')
  assert.notEqual(decision.reason, 'provider-outage', 'an empty catalogue is not an outage')
  assert.notEqual(decision.reason, 'route-absent', 'the provider IS registered')
  assert.deepEqual(catalog.askedRoutes, ['glm/sonnet'], 'the route was asked and refused')
})

test('a missing model and an absent provider stay different reasons', async () => {
  const registered = new adapterTesting.FakeModelCatalog({ providers: [{ id: 'glm', name: 'GLM' }], models: {} })
  const missingModel = await core.routeModel({ port: registered, request: { policy: singleRoute } })
  assert.equal(missingModel.reason, 'model-not-routable', 'the provider is registered, the model is not')

  // The same route against a catalog that registers nothing: the reason must be
  // the older one, otherwise the new value swallowed the distinction it exists
  // to draw.
  const absentProvider = new adapterTesting.FakeModelCatalog({ providers: [], models: {} })
  const absent = await core.routeModel({ port: absentProvider, request: { policy: singleRoute } })
  assert.equal(absent.reason, 'route-absent', 'an unregistered provider keeps its own reason')
  assert.deepEqual(absentProvider.askedRoutes, [], 'an absent route is not asked: absence is not an outage')
})

test('the reason union and its frozen list agree, and the wrapper preserves the registry code', async () => {
  // The value has to land in the enumerable list as well as in the type, or a
  // caller that walks ROUTE_REFUSAL_REASONS would never see it.
  assert.ok(contracts.ROUTE_REFUSAL_REASONS.includes('model-not-routable'))
  assert.equal(contracts.ROUTE_REFUSAL_REASONS.length, 8, 'the additive value must be enumerated')
  assert.equal(
    new Set(contracts.ROUTE_REFUSAL_REASONS).size,
    contracts.ROUTE_REFUSAL_REASONS.length,
    'the list must carry no duplicate entry',
  )

  // The classification above is only reachable because the binding lets the
  // registry's own UNKNOWN_MODEL code through instead of replacing it: routing
  // reads that code to tell a missing model from an outage.
  const wrapper = new controller.DshModelCatalog({
    listProviders: () => [],
    listModels: async () => [],
    resolveModelInfo: async () => {
      throw Object.assign(new Error('the registry serves no such model'), { code: contracts.CATALOG_UNKNOWN_MODEL })
    },
  })
  await assert.rejects(
    wrapper.resolveModelInfo('glm', 'sonnet'),
    error => error.code === contracts.CATALOG_UNKNOWN_MODEL,
    'the UNKNOWN_MODEL code must survive the binding, or routing sees an outage',
  )
})
