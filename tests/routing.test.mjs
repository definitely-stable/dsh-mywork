/**
 * Model routing acceptance (architecture §29, §53, §62 item 7).
 *
 * The suite drives the policy against a literal catalog, so every branch is
 * decided by data rather than by a provider: a route the catalog serves, a
 * provider that did not answer, a provider that is not registered at all, a
 * window exactly on the boundary, and a catalog that answers about something
 * else. It also mounts the built controller on a real Cordis context to prove
 * the DSH registry binding is wired, negotiated by kind, and removed on unload.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'
import { adapterTesting, contracts, core, repoRoot } from './lib/fixtures.mjs'

/**
 * This suite MOUNTS the controller, and mounting it opens the SQLite state under
 * `DSH_HOME`. Pin that variable to a scratch directory before the bundle is
 * imported, or a plain `node --test tests/routing.test.mjs` writes
 * `dsh-mywork/state/*.sqlite` into the user's real home — which this campaign
 * forbids. The pin must happen before the import below, because the storage
 * layer resolves its home when it is first loaded, and `assertScratchHome`
 * states the property positively: a pin that merely sets the variable would
 * pass at any value, including the wrong one.
 */
scratchDshHome('routing')
assertScratchHome()

// The controller is the published bundle and is not part of the domain fixture
// set, so this suite loads it the way a consumer would.
const controllerEntry = join(repoRoot, 'packages', 'controller', 'lib', 'index.js')
if (!existsSync(controllerEntry)) {
  throw new Error('routing tests: missing build output: run "pnpm run build" first (or use "pnpm run check")')
}
const controller = await import(pathToFileURL(controllerEntry).href)

const { Context } = await import('@deepseek-ai/cordis')

/** The development catalog: the flashed model the card pins, plus one fallback. */
function developmentCatalog(overrides = {}) {
  return new adapterTesting.FakeModelCatalog({
    providers: [
      { id: 'opencode-go', name: 'OpenCode Go' },
      { id: 'glm', name: 'GLM' },
    ],
    models: {
      'opencode-go': [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 128_000 }],
      glm: [{ id: 'air', name: 'GLM Air', contextWindow: 32_768 }],
    },
    ...overrides,
  })
}

/** A policy with the development route preferred and `glm/air` as its fallback. */
function developmentPolicy(overrides = {}) {
  return {
    preferred: 'opencode-go/deepseek-v4.1-flash',
    fallback: ['glm/air'],
    escalation: [],
    ...overrides,
  }
}

test('the development default is the flashed model and leaves no room for an automatic escalation', () => {
  assert.deepEqual(contracts.DEVELOPMENT_MODEL_POLICY, {
    preferred: 'opencode-go/deepseek-v4.1-flash',
    fallback: [],
    escalation: [],
  })
  // A paid frontier route registered in the catalog is still never reached: the
  // policy does not name it, so the route is absent rather than chosen.
  const catalog = new adapterTesting.FakeModelCatalog({
    providers: [{ id: 'frontier', name: 'Frontier' }],
    models: { frontier: [{ id: 'pro', name: 'Pro', contextWindow: 1_000_000 }] },
  })
  return core.routeModel({ port: catalog, request: { policy: contracts.DEVELOPMENT_MODEL_POLICY } }).then((decision) => {
    assert.equal(decision.kind, 'refused')
    assert.equal(decision.reason, 'route-absent')
    assert.deepEqual(catalog.askedRoutes, [], 'the frontier route must not even be asked')
  })
})

test('a route is parsed at the first slash, so a model id may contain one', () => {
  assert.deepEqual(core.parseModelRoute('opencode-go/deepseek-v4.1-flash'), {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
  })
  assert.deepEqual(core.parseModelRoute('  openrouter/anthropic/x  '), {
    provider: 'openrouter',
    model: 'anthropic/x',
  })
  assert.equal(core.parseModelRoute('no-slash'), undefined)
  assert.equal(core.parseModelRoute('provider/'), undefined)
  assert.equal(core.parseModelRoute('/model'), undefined)
  assert.equal(core.parseModelRoute('two words/model'), undefined)
  assert.equal(core.formatModelRoute({ provider: 'p', model: 'm' }), 'p/m')
})

test('the catalog is read once per provider, and an outage stays distinguishable from an empty catalog', async () => {
  const catalog = developmentCatalog({ outages: ['glm'] })
  const snapshot = await core.readModelCatalog(catalog)

  assert.deepEqual(snapshot.providers.map(provider => provider.id), ['opencode-go', 'glm'])
  assert.deepEqual(snapshot.models.map(model => `${model.provider}/${model.id}`), ['opencode-go/deepseek-v4.1-flash'])
  assert.deepEqual(snapshot.outages.map(outage => outage.provider), ['glm'])
  assert.match(snapshot.outages[0].detail, /did not answer/)
  assert.equal(Object.isFrozen(snapshot), true, 'the observation must be frozen for its consumers')
  assert.deepEqual(catalog.listedProviders, ['opencode-go', 'glm'], 'every registered provider must be asked')
})

test('the preferred route is selected, and its §29 provenance records the actual route', async () => {
  const catalog = developmentCatalog()
  const decision = await core.routeModel({ port: catalog,
    request: { policy: developmentPolicy(), trigger: 'repeated-failure' },
  })

  assert.equal(decision.kind, 'routed')
  assert.deepEqual(decision.provenance.route, { provider: 'opencode-go', model: 'deepseek-v4.1-flash' })
  assert.equal(decision.provenance.role, 'preferred')
  assert.equal(decision.provenance.trigger, 'repeated-failure')
  assert.equal(decision.provenance.contextWindow, 128_000)
  assert.deepEqual(
    decision.provenance.evaluations.map(entry => [entry.candidate, entry.role, entry.outcome]),
    [['opencode-go/deepseek-v4.1-flash', 'preferred', 'selected']],
    'a routed decision stops walking and records only what it walked',
  )
  assert.deepEqual(catalog.askedRoutes, ['opencode-go/deepseek-v4.1-flash'])
  // §29 requires the actual route to be recorded, so the record must be data a
  // store can take: no live objects, no cycles.
  assert.deepEqual(
    JSON.parse(JSON.stringify(decision.provenance)),
    decision.provenance,
    'the provenance must survive a JSON round trip to be recordable',
  )
  assert.equal(Object.isFrozen(decision.provenance), true)
})

test('a provider in outage is routed around, and the outage is what the provenance records', async () => {
  const catalog = developmentCatalog({ outages: ['opencode-go'] })
  const decision = await core.routeModel({ port: catalog,
    request: { policy: developmentPolicy(), trigger: 'provider-outage' },
  })

  assert.equal(decision.kind, 'routed')
  assert.deepEqual(decision.provenance.route, { provider: 'glm', model: 'air' })
  assert.equal(decision.provenance.role, 'fallback')
  assert.equal(decision.provenance.trigger, 'provider-outage')
  assert.equal(decision.provenance.evaluations[0].outcome, 'refused')
  assert.equal(decision.provenance.evaluations[0].reason, 'provider-outage')
  // The sentence names the LISTING failure: routing read the outage from the
  // snapshot and never re-asked the provider for the exact model. Without this
  // distinction a catalogue that answers "did not answer" on both paths could
  // not tell the two code paths apart.
  assert.match(decision.provenance.evaluations[0].detail, /did not answer the catalog listing/)
  assert.deepEqual(catalog.askedRoutes, ['glm/air'], 'the outage must not be resolved, only routed around')
})

test('an outage recorded in the snapshot is not re-asked through the exact-model lookup', async () => {
  const asked = []
  const port = {
    listProviders: () => [{ id: 'p', name: 'P' }],
    listModels: async () => { throw new Error('the listing is down') },
    resolveModelInfo: async (provider, model) => {
      asked.push(`${provider}/${model}`)
      return { provider, id: model, name: model, contextWindow: 1_000_000 }
    },
  }
  const decision = await core.routeModel({
    port,
    request: { policy: { preferred: 'p/m', fallback: [], escalation: [] } },
  })

  assert.equal(decision.kind, 'refused')
  assert.equal(
    decision.reason,
    'provider-outage',
    'a provider whose listing failed is in outage even when a resolve would have answered',
  )
  assert.match(decision.evaluations[0].detail, /the listing is down/)
  assert.deepEqual(asked, [], 'the snapshot outage must short-circuit the lookup instead of retrying it')
})

test('a catalog that cannot name its providers at all fails loud instead of inventing a route', async () => {
  const port = {
    listProviders: () => { throw new Error('the registry is broken') },
    listModels: async () => [],
    resolveModelInfo: async () => { throw new Error('the registry is broken') },
  }

  // Reporting this as an empty catalog would answer `route-absent`, which says
  // "the route does not exist" — the opposite of "nobody could be asked".
  await assert.rejects(
    core.routeModel({ port, request: { policy: developmentPolicy() } }),
    /the registry is broken/,
  )
})

test('an unregistered provider is refused as an absent route, never as an outage', async () => {
  const catalog = developmentCatalog()
  const decision = await core.routeModel({ port: catalog,
    request: { policy: developmentPolicy({ preferred: 'ghost/model', fallback: [] }) },
  })

  assert.equal(decision.kind, 'refused')
  assert.equal(decision.reason, 'route-absent')
  assert.equal(decision.evaluations[0].reason, 'route-absent')
  assert.match(decision.evaluations[0].detail, /registers no provider "ghost"/)
  assert.deepEqual(catalog.askedRoutes, [], 'an absent route is not asked: absence is not an outage')
})

test('a registered provider that serves no such model is model-not-routable, not an outage', async () => {
  const catalog = developmentCatalog()
  const decision = await core.routeModel({ port: catalog,
    request: { policy: developmentPolicy({ preferred: 'glm/sonnet', fallback: [] }) },
  })

  assert.equal(decision.kind, 'refused')
  // The provider IS registered, so this is not `route-absent` (that reason is
  // reserved for a provider the catalog does not register at all) and not
  // `provider-outage` (the provider answered).
  assert.equal(decision.reason, 'model-not-routable', 'the provider answered; the model simply does not exist')
  assert.match(decision.evaluations[0].detail, /serves no model "sonnet"/)
  assert.deepEqual(
    catalog.askedRoutes,
    ['glm/sonnet'],
    'this route WAS asked and refused: that is what makes it a missing model rather than an outage',
  )
})

test('an outage with no fallback is refused with the outage, not with the absence', async () => {
  const catalog = developmentCatalog({ outages: ['opencode-go'] })
  const decision = await core.routeModel({ port: catalog,
    request: { policy: developmentPolicy({ fallback: [] }) },
  })

  assert.equal(decision.kind, 'refused')
  assert.equal(decision.reason, 'provider-outage')
  assert.equal(decision.evaluations[0].reason, 'provider-outage')
})

test('a required context window is honoured exactly at the boundary and refused one token past it', async () => {
  const catalog = developmentCatalog()

  const exact = await core.routeModel({ port: catalog,
    request: { policy: developmentPolicy(), requiredContextTokens: 128_000 },
  })
  assert.equal(exact.kind, 'routed', 'a window that holds the request exactly must be selected')

  const tooSmall = await core.routeModel({ port: catalog,
    request: { policy: developmentPolicy({ fallback: [] }), requiredContextTokens: 128_001 },
  })
  assert.equal(tooSmall.kind, 'refused')
  assert.equal(tooSmall.reason, 'context-window-too-small')
  assert.match(tooSmall.evaluations[0].detail, /needs 128001 tokens and the window holds 128000/)
})

test('an undisclosed window is refused when required and stays absent — never zero — when not', async () => {
  const catalog = new adapterTesting.FakeModelCatalog({
    providers: [{ id: 'opencode-go', name: 'OpenCode Go' }],
    models: { 'opencode-go': [{ id: 'deepseek-v4.1-flash', name: 'Unpriced' }] },
  })

  const required = await core.routeModel({ port: catalog,
    request: { policy: developmentPolicy({ fallback: [] }), requiredContextTokens: 1 },
  })
  assert.equal(required.kind, 'refused')
  assert.equal(required.reason, 'context-window-undisclosed')

  const unconstrained = await core.routeModel({ port: catalog,
    request: { policy: developmentPolicy({ fallback: [] }) },
  })
  assert.equal(unconstrained.kind, 'routed')
  assert.equal(
    Object.hasOwn(unconstrained.provenance, 'contextWindow'),
    false,
    'an undisclosed window is absent, not zero',
  )
})

test('escalation is opt-in: the escalation route is withheld and never asked', async () => {
  const catalog = new adapterTesting.FakeModelCatalog({
    providers: [
      { id: 'ghost', name: 'Ghost' },
      { id: 'frontier', name: 'Frontier' },
    ],
    models: { frontier: [{ id: 'pro', name: 'Pro', contextWindow: 1_000_000 }] },
  })
  const policy = { preferred: 'ghost/model', fallback: [], escalation: ['frontier/pro'] }

  const withheld = await core.routeModel({ port: catalog, request: { policy } })
  assert.equal(withheld.kind, 'refused')
  assert.deepEqual(
    withheld.evaluations.map(entry => [entry.role, entry.outcome, entry.reason]),
    // `ghost` IS registered — it simply advertises no models — so the preferred
    // candidate is `model-not-routable`, not `route-absent`.
    [['preferred', 'refused', 'model-not-routable'], ['escalation', 'withheld', 'escalation-not-permitted']],
  )
  assert.deepEqual(
    catalog.askedRoutes,
    ['ghost/model'],
    'the permitted candidate is asked and refused; the withheld escalation must not be asked for at all',
  )

  const permitted = await core.routeModel({ port: catalog, request: { policy, allowEscalation: true } })
  assert.equal(permitted.kind, 'routed')
  assert.deepEqual(permitted.provenance.route, { provider: 'frontier', model: 'pro' })
  assert.equal(permitted.provenance.role, 'escalation')
})

test('a policy entry that is not a route is a typed refusal, not an exception', async () => {
  const catalog = developmentCatalog()
  const decision = await core.routeModel({ port: catalog, request: { policy: { preferred: 'not-a-route', fallback: [], escalation: [] } } })

  assert.equal(decision.kind, 'refused')
  assert.equal(decision.reason, 'invalid-route')
  assert.equal(decision.evaluations[0].route, undefined)
  assert.equal(decision.evaluations[0].candidate, 'not-a-route')
})

test('a catalog that answers about another route, or with a window that is not a count, is refused', async () => {
  const lying = {
    listProviders: () => [{ id: 'p', name: 'P' }],
    listModels: async () => [{ provider: 'p', id: 'x', name: 'X' }],
    resolveModelInfo: async () => ({ provider: 'q', id: 'y', name: 'Y' }),
  }
  const mismatched = await core.selectModelRoute({
    request: { policy: { preferred: 'p/x', fallback: [], escalation: [] } },
    catalog: await core.readModelCatalog(lying),
    port: lying,
  })
  assert.equal(mismatched.kind, 'refused')
  assert.equal(mismatched.reason, 'catalog-invalid')
  assert.match(mismatched.evaluations[0].detail, /answered about "q\/y"/)

  const invalidWindow = {
    listProviders: () => [{ id: 'p', name: 'P' }],
    listModels: async () => [],
    resolveModelInfo: async () => ({ provider: 'p', id: 'x', name: 'X', contextWindow: 0 }),
  }
  const bogus = await core.selectModelRoute({
    request: { policy: { preferred: 'p/x', fallback: [], escalation: [] } },
    catalog: await core.readModelCatalog(invalidWindow),
    port: invalidWindow,
  })
  assert.equal(bogus.kind, 'refused')
  assert.equal(bogus.reason, 'catalog-invalid')
  assert.match(bogus.evaluations[0].detail, /positive count of tokens/)
})

test('a refusal names the first candidate that failed, while the walk keeps every reason', async () => {
  // preferred is absent, the fallback is in outage: the summary must be the
  // PRIMARY diagnosis, because "the route we wanted does not exist" is a
  // different operational fact from "the backup provider is down".
  const catalog = developmentCatalog({ outages: ['glm'] })
  const decision = await core.routeModel({
    port: catalog,
    request: { policy: developmentPolicy({ preferred: 'ghost/model' }) },
  })

  assert.equal(decision.kind, 'refused')
  assert.deepEqual(
    decision.evaluations.map(entry => [entry.role, entry.reason]),
    [['preferred', 'route-absent'], ['fallback', 'provider-outage']],
  )
  assert.equal(
    decision.reason,
    decision.evaluations[0].reason,
    'the summary is the first candidate, not the last one that happened to fail',
  )
  assert.equal(decision.reason, 'route-absent')
  assert.notEqual(decision.reason, decision.evaluations.at(-1).reason)
})

test('a malformed request fails loud while a malformed policy entry is refused', async () => {
  const catalog = developmentCatalog()
  const snapshot = await core.readModelCatalog(catalog)

  await assert.rejects(
    core.selectModelRoute({
      request: { policy: developmentPolicy(), requiredContextTokens: 0 },
      catalog: snapshot,
      port: catalog,
    }),
    TypeError,
  )
  await assert.rejects(
    core.selectModelRoute({
      request: { policy: developmentPolicy(), allowEscalation: 'yes' },
      catalog: snapshot,
      port: catalog,
    }),
    TypeError,
  )
  await assert.rejects(
    core.selectModelRoute({ request: { policy: { preferred: 7 } }, catalog: snapshot, port: catalog }),
    TypeError,
  )
  await assert.rejects(
    core.selectModelRoute({ request: { policy: developmentPolicy() }, catalog: snapshot, port: {} }),
    TypeError,
  )
})

test('the controller registers the DSH registry as the model-catalog port, and unload removes it', async () => {
  const ctx = new Context()
  const asked = []
  await ctx.plugin({
    name: 'fake-llm-provider',
    apply(context) {
      // The shape the controller binds: DSH's `llm` service.
      context.provide('llm', {
        listProviders: () => [{ id: 'opencode-go', name: 'OpenCode Go' }],
        listModels: async provider => [{ provider, id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }],
        resolveModelInfo: async (provider, model) => {
          asked.push(`${provider}/${model}`)
          return { provider, id: model, name: model, context: { contextWindow: 128_000 } }
        },
      })
    },
  })

  const fiber = ctx.plugin(controller, { diagnostics: false })
  await fiber.await()

  const adapters = ctx.get(contracts.MYWORK_ADAPTERS_SERVICE)
  assert.deepEqual(
    adapters.list('model-catalog').map(manifest => [manifest.adapterId, manifest.contractVersion]),
    [['dsh-llm', 'model-catalog/v1']],
  )

  const port = adapters.require('model-catalog', { capabilities: ['providers', 'contextWindow'] })
  assert.equal(typeof port.listProviders, 'function')
  const decision = await core.routeModel({ port,
    request: { policy: contracts.DEVELOPMENT_MODEL_POLICY, requiredContextTokens: 128_000 },
  })
  assert.equal(decision.kind, 'routed')
  assert.equal(decision.provenance.contextWindow, 128_000, 'the DSH nested window must reach the decision')
  assert.deepEqual(asked, ['opencode-go/deepseek-v4.1-flash'])

  await fiber.dispose()
  assert.equal(ctx.get(contracts.MYWORK_ADAPTERS_SERVICE), undefined, 'the registry goes with the plugin')
  assert.deepEqual(adapters.list('model-catalog'), [], 'the catalog registration must not outlive the fiber')
})

test('a profile without the llm service mounts the controller and registers no catalog adapter', async () => {
  const ctx = new Context()
  const fiber = ctx.plugin(controller, { diagnostics: false })
  await fiber.await()

  const adapters = ctx.get(contracts.MYWORK_ADAPTERS_SERVICE)
  assert.deepEqual(adapters.list('model-catalog'), [])

  const broken = new Context()
  await broken.plugin({
    name: 'broken-llm-provider',
    apply(context) {
      context.provide('llm', { listProviders: () => [] })
    },
  })
  const brokenFiber = broken.plugin(controller, { diagnostics: false })
  await brokenFiber.await()
  assert.deepEqual(broken.get(contracts.MYWORK_ADAPTERS_SERVICE).list('model-catalog'), [])

  await fiber.dispose()
  await brokenFiber.dispose()
})
