/**
 * Adapter SDK acceptance: capability negotiation, contract-revision checks, the
 * registry lifecycle, the published `myworkAdapters` service, and the
 * conformance kit.
 *
 * The suite exercises the built packages exactly as a consumer would, and it
 * contains the check that matters most for §37/§44: no policy branches on a
 * provider name — resolution goes by kind and declared capability only.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'

/** Repository root; every artifact below is addressed from here. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The controller opens its SQLite state under `DSH_HOME`, so that variable is
 * pointed at a scratch directory BEFORE the built packages are imported or
 * mounted. A run that used the real home would create
 * `dsh-mywork/state/*.sqlite` inside the user's profile, which this campaign
 * forbids; `assertScratchHome` states that positively — the resolved path must
 * live under the repository's `.tmp`, because a pin that merely sets the
 * variable would pass at any value — and the mount test below also asserts the
 * real home stayed absent.
 */
scratchDshHome('adapters')
assertScratchHome()

/**
 * Drop comments in a single left-to-right pass, keeping string and template
 * contents, so prose cannot be mistaken for a branch or for a module specifier
 * while a name inside a comparison still is one.
 *
 * A doc comment really does contain the phrase `from "unreadable"`, and without
 * this pass a built bundle would appear to import a module called `unreadable`.
 */
function codeOnly(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1]
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (char === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (char === '`' || char === '"' || char === "'") {
      const quote = char
      out += char
      i += 1
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          out += source[i]
          i += 1
        }
        out += source[i]
        i += 1
      }
      out += quote
      i += 1
      continue
    }
    out += char
    i += 1
  }
  return out
}

/** Built entry points this suite exercises. */
const entries = {
  contracts: 'packages/contracts/lib/index.js',
  core: 'packages/core/lib/index.js',
  adapterSdk: 'packages/adapter-sdk/lib/index.js',
  adapterTesting: 'packages/adapter-sdk/lib/testing.js',
  controller: 'packages/controller/lib/index.js',
}

const missing = Object.values(entries).filter(relative => !existsSync(join(repoRoot, relative)))
if (missing.length > 0) {
  throw new Error(
    `adapter tests: missing build output: ${missing.join(', ')}; run "pnpm run build" first (or use "pnpm run check")`,
  )
}

const [contracts, core, adapterSdk, adapterTesting, controller] = await Promise.all(
  Object.values(entries).map(relative => import(pathToFileURL(join(repoRoot, relative)).href)),
)

const { Context } = await import('@deepseek-ai/cordis')

/** Registration fixture with overridable declaration fields. */
function registration(overrides = {}) {
  // The base is built for the requested kind, so its contract revision matches
  // the port it claims; the overrides then replace individual fields.
  return { ...adapterTesting.fakeAdapterRegistration({ kind: overrides.kind ?? 'memory' }), ...overrides }
}

/** Whether a thrown value is a refusal with the expected canonical code. */
function refusedWith(code) {
  return error => adapterSdk.isAdapterRefusal(error) && error.code === code
}

/** An observer that records what the registry reported. */
function recordingObserver() {
  const registered = []
  const unregistered = []
  const refused = []
  return {
    registered,
    unregistered,
    refused,
    onRegistered(manifest, size) {
      registered.push({ id: manifest.adapterId, size })
    },
    onUnregistered(manifest, size) {
      unregistered.push({ id: manifest.adapterId, size })
    },
    onRefused(refusal) {
      refused.push(refusal.code)
    },
  }
}

/**
 * A runtime that answers nothing at all, so every §39 check has to notice.
 */
function deadRuntime() {
  const refuse = () => {
    throw new Error('the dead runtime answers nothing')
  }
  return {
    start: refuse,
    resume: refuse,
    status: refuse,
    stop: refuse,
    events: refuse,
  }
}

test('the §36 port catalog declares every stable port with one contract revision', () => {
  assert.equal(adapterSdk.PORT_CONTRACTS.length, 12)
  assert.deepEqual(
    adapterSdk.PORT_CONTRACTS.map(entry => entry.port),
    [
      'AgentRuntimePort',
      'SessionPort',
      'ModelCatalogPort',
      'TaskGraphPort',
      'TaskBoardPort',
      'ContextProviderPort',
      'MemoryProviderPort',
      'SkillProviderPort',
      'WorkspacePort',
      'ArtifactStorePort',
      'EventBusPort',
      'LeaseStorePort',
    ],
  )
  for (const entry of adapterSdk.PORT_CONTRACTS) {
    assert.equal(entry.contractVersion, `${entry.kind}/v1`)
    assert.equal(adapterSdk.portContractOf(entry.kind), entry)
  }
  assert.deepEqual(
    adapterSdk.ADAPTER_KINDS,
    adapterSdk.PORT_CONTRACTS.map(entry => entry.kind),
  )
  assert.equal(adapterSdk.portContractVersion('memory'), 'memory/v1')
  assert.throws(() => adapterSdk.portContractOf('storage'), TypeError)
})

test('contract revisions are parsed strictly and compared by family and major', () => {
  assert.deepEqual(adapterSdk.parseContractVersion('memory/v1'), { family: 'memory', major: 1 })
  for (const invalid of ['memory', 'memory/v', 'memory/v0', 'memory/v1.0', 'Memory/v1', 'memory/1', '1.0', '']) {
    assert.equal(adapterSdk.parseContractVersion(invalid), undefined, `"${invalid}" must not parse`)
  }
  assert.equal(adapterSdk.isContractVersionCompatible('memory/v1', 'memory/v1'), true)
  assert.equal(adapterSdk.isContractVersionCompatible('memory/v2', 'memory/v1'), false)
  assert.equal(adapterSdk.isContractVersionCompatible('taskgraph/v1', 'memory/v1'), false)
  assert.equal(adapterSdk.isContractVersionCompatible('bogus', 'memory/v1'), false)
  assert.equal(adapterSdk.nextContractMajor('memory/v1'), 'memory/v2')
  assert.throws(() => adapterSdk.nextContractMajor('memory'), TypeError)
})

test('a declaration is validated before it can reach the registry', () => {
  const manifest = adapterSdk.defineAdapterManifest({
    adapterId: 'beads',
    kind: 'taskgraph',
    contractVersion: 'taskgraph/v1',
    capabilities: { claim: true, replan: false },
  })
  assert.equal(Object.isFrozen(manifest), true)
  assert.equal(Object.isFrozen(manifest.capabilities), true)
  assert.deepEqual(adapterSdk.supportedCapabilities(manifest), ['claim'])
  assert.equal(adapterSdk.supportsCapability(manifest, 'claim'), true)
  assert.equal(adapterSdk.supportsCapability(manifest, 'replan'), false)
  assert.equal(adapterSdk.supportsCapability(manifest, 'unknown'), false)

  const malformed = [
    { ...manifest, adapterId: ' ' },
    { ...manifest, kind: 'unknown' },
    { ...manifest, contractVersion: 'taskgraph' },
    { ...manifest, contractVersion: 'memory/v1' },
    { ...manifest, capabilities: { claim: 'yes' } },
    { ...manifest, capabilities: { ' ': true } },
  ]
  for (const declaration of malformed) {
    assert.throws(() => adapterSdk.defineAdapterManifest(declaration), TypeError, JSON.stringify(declaration))
  }
})

test('an incompatible contract revision is refused as CONTRACT_MISMATCH', () => {
  const observer = recordingObserver()
  const registry = adapterSdk.createAdapterRegistry({ observer })
  assert.throws(
    () => registry.register(registration({ contractVersion: 'memory/v2' })),
    refusedWith('CONTRACT_MISMATCH'),
  )
  assert.equal(registry.size, 0, 'a refused registration must not be stored')
  assert.deepEqual(observer.refused, ['CONTRACT_MISMATCH'], 'the refusal must be observable')

  const sizeBefore = observer.refused.length
  registry.register(registration({ id: 'memory-v1' }))
  const resolution = registry.resolve('memory', { contractVersion: 'memory/v2' })
  assert.equal(resolution.ok, false)
  assert.equal(resolution.refusal.code, 'CONTRACT_MISMATCH')
  assert.equal(resolution.refusal.details.required, 'memory/v2')
  assert.equal(observer.refused.length, sizeBefore + 1, 'a failed resolution is a refusal too')
})

test('a required capability declared false or absent is refused as CAPABILITY_UNSUPPORTED', () => {
  const observer = recordingObserver()
  const registry = adapterSdk.createAdapterRegistry({ observer })
  registry.register(registration({ capabilities: { retain: true, recall: false } }))

  const declared = registry.resolve('memory', { capabilities: ['retain'] })
  assert.equal(declared.ok, true, 'a declared capability must resolve')

  const falsy = registry.resolve('memory', { capabilities: ['recall'] })
  assert.equal(falsy.ok, false)
  assert.equal(falsy.refusal.code, 'CAPABILITY_UNSUPPORTED')
  assert.deepEqual(falsy.refusal.details.missing, ['recall'])

  const absent = registry.resolve('memory', { capabilities: ['retain', 'structuredScopes'] })
  assert.equal(absent.ok, false)
  assert.equal(absent.refusal.code, 'CAPABILITY_UNSUPPORTED')
  assert.deepEqual(absent.refusal.details.missing, ['structuredScopes'])
  assert.deepEqual(observer.refused, ['CAPABILITY_UNSUPPORTED', 'CAPABILITY_UNSUPPORTED'])

  assert.throws(() => registry.require('memory', { capabilities: ['recall'] }), refusedWith('CAPABILITY_UNSUPPORTED'))
})

test('a compatible fake adapter registers, is discovered, and unregisters', async () => {
  const observer = recordingObserver()
  const registry = adapterSdk.createAdapterRegistry({ observer })
  const handle = registry.register(registration({ id: 'fake-memory' }))
  assert.equal(handle.manifest.adapterId, 'fake-memory')
  assert.equal(handle.manifest.kind, 'memory')
  assert.equal(handle.manifest.contractVersion, 'memory/v1')
  assert.equal(Object.isFrozen(handle.manifest), true)
  assert.equal(registry.size, 1)
  assert.deepEqual(registry.list('memory').map(manifest => manifest.adapterId), ['fake-memory'])

  const resolution = registry.resolve('memory', { capabilities: ['retain', 'recall'] })
  assert.equal(resolution.ok, true)
  assert.equal(resolution.adapter, handle.adapter, 'resolution must answer with the registered instance')
  assert.deepEqual(handle.adapter.operations, [], 'the fake must not be called before it is used')
  assert.equal(await handle.adapter.invoke('retain', 'value'), 'value')
  assert.deepEqual(handle.adapter.operations, ['retain'])

  assert.equal(handle.unregister(), true)
  assert.equal(registry.size, 0)
  assert.equal(registry.resolve('memory').ok, false)
  assert.equal(registry.resolve('memory').refusal.code, 'ADAPTER_UNAVAILABLE')
  assert.equal(handle.unregister(), false, 'unregistering twice must report that nothing was removed')
  assert.deepEqual(observer.registered, [{ id: 'fake-memory', size: 1 }])
  assert.deepEqual(observer.unregistered, [{ id: 'fake-memory', size: 0 }])
})

test('registration is refused for a duplicate id and cleared with the registry', () => {
  const observer = recordingObserver()
  const registry = adapterSdk.createAdapterRegistry({ observer })
  registry.register(registration({ id: 'duplicate' }))
  assert.throws(() => registry.register(registration({ id: 'duplicate' })), refusedWith('TASK_CONFLICT'))
  assert.equal(registry.size, 1, 'the first registration must survive')

  registry.register(registration({ id: 'second', kind: 'taskgraph' }))
  assert.equal(registry.size, 2)
  assert.equal(registry.list('taskgraph').length, 1)
  assert.equal(registry.clear(), 2)
  assert.equal(registry.size, 0)
  assert.equal(registry.clear(), 0, 'clearing an empty registry is a no-op')
  assert.deepEqual(observer.unregistered.map(entry => entry.id), ['duplicate', 'second'])
})

test('discovery goes by declaration, never by adapter id', () => {
  const registry = adapterSdk.createAdapterRegistry()
  registry.register(registration({ id: 'zzz-incapable', capabilities: { retain: true } }))
  registry.register(registration({ id: 'aaa-capable', capabilities: { retain: true, recall: true } }))

  // The id order is the opposite of the capability order on purpose: the first
  // adapter registered cannot serve `recall`, so only capability may decide.
  const chosen = registry.resolve('memory', { capabilities: ['recall'] })
  assert.equal(chosen.ok, true)
  assert.equal(chosen.manifest.adapterId, 'aaa-capable')

  const renamed = adapterSdk.createAdapterRegistry()
  renamed.register(registration({ id: 'renamed-entirely', capabilities: { retain: true, recall: true } }))
  const byDeclaration = renamed.resolve('memory', { capabilities: ['retain'] })
  assert.equal(byDeclaration.ok, true)
  assert.equal(byDeclaration.manifest.adapterId, 'renamed-entirely')
})

test('a refusal is a canonical error shape and travels through Result', () => {
  const registry = adapterSdk.createAdapterRegistry()
  const resolution = registry.resolve('memory', { capabilities: ['retain'] })
  assert.equal(resolution.ok, false)
  const refusal = resolution.refusal
  assert.equal(adapterSdk.isAdapterRefusal(refusal), true)
  assert.equal(adapterSdk.isAdapterRefusal(new Error('plain')), false)
  assert.equal(refusal.name, 'AdapterRefusal')
  assert.equal(Object.isFrozen(refusal.details), true)

  // The canonical vocabulary is shared with the domain: a refusal is a
  // `MyWorkErrorShape`, so it needs no conversion to become a failed Result.
  const meta = core.defineOperationMeta({ operationId: 'op-adapter', correlationId: 'corr-adapter' })
  const result = core.fail(refusal, meta)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'ADAPTER_UNAVAILABLE')
  assert.equal(result.meta.operationId, 'op-adapter')
  assert.ok(contracts.MYWORK_ERROR_CODES.includes(refusal.code))

  const adapterError = new adapterSdk.AdapterError('timeout', 'dsh-mywork: deadline')
  assert.equal(adapterSdk.isAdapterError(adapterError), true)
  assert.equal(adapterError.code, 'timeout')
})

test('the common conformance checks pass for a compatible adapter', async () => {
  const checks = adapterSdk.commonAdapterChecks({ registration: registration(), context: undefined })
  const report = await adapterSdk.runConformance({
    kind: 'memory',
    checks,
    clock: new adapterTesting.FakeClock(1_000),
    adapterId: 'fake-adapter',
    contractVersion: 'memory/v1',
  })
  assert.equal(report.failed, 0, JSON.stringify(report.results, undefined, 2))
  assert.equal(report.passed, checks.length)
  assert.equal(report.skipped, 0)
  assert.equal(report.port, 'MemoryProviderPort')
  assert.ok(report.results.every(result => result.durationMs === 0), 'the injected FakeClock times the run')
  // Nothing pretends to cover the §39 memory suite: the kit reports what is
  // still missing instead of counting a pass it never ran.
  assert.deepEqual(report.missing, adapterSdk.REQUIRED_CONFORMANCE_CHECKS.memory)
})

test('the common conformance checks fail and skip loudly instead of passing', async () => {
  const brokenFactory = registration({ create: () => { throw new Error('the adapter cannot be built') } })
  const broken = await adapterSdk.runConformance({
    kind: 'memory',
    checks: adapterSdk.commonAdapterChecks({ registration: brokenFactory, context: undefined }),
    clock: new adapterTesting.FakeClock(0),
  })
  assert.ok(broken.failed >= 1, 'a registration whose factory throws must fail a check')
  assert.match(broken.results.find(result => result.status === 'failed').reason, /cannot be built/)

  const noFalseCapability = registration({ capabilities: { retain: true } })
  const skipped = await adapterSdk.runConformance({
    kind: 'memory',
    checks: adapterSdk.commonAdapterChecks({ registration: noFalseCapability, context: undefined }),
    clock: new adapterTesting.FakeClock(0),
  })
  assert.equal(skipped.failed, 0)
  assert.equal(skipped.skipped, 1)
  const reason = skipped.results.find(result => result.status === 'skipped').reason
  assert.match(reason, /declares no capability as false/)
})

test('the agent-runtime suite covers every §39 name for the fake and rejects a dead runtime', async () => {
  // One owner, one runtime, and a second runtime over the same owner: that is
  // what a process restart is, and without it the suite would have to skip a
  // §39 check instead of proving it.
  const host = new adapterTesting.FakeAgentHost()
  const checks = adapterSdk.agentRuntimeChecks({
    runtime: new adapterTesting.FakeAgentRuntime({ host }),
    runIdPrefix: 'suite',
    reopen: () => new adapterTesting.FakeAgentRuntime({ host }),
  })
  const report = await adapterSdk.runConformance({
    kind: 'agent-runtime',
    checks,
    clock: new adapterTesting.FakeClock(0),
    adapterId: 'fake-agent-runtime',
  })
  assert.equal(report.failed, 0, JSON.stringify(report.results, undefined, 2))
  assert.equal(report.passed, checks.length)
  assert.equal(report.skipped, 0, 'a suite with a restart hook has nothing to skip')
  assert.deepEqual(report.results.map(result => result.name), [
    'create',
    'create refuses a duplicate run',
    'resume',
    'stop',
    'status',
    'late event',
    'cancellation',
    'process restart',
  ])
  assert.deepEqual(report.missing, [], 'the runtime card must close the §39 gap it was written for')
  for (const required of adapterSdk.REQUIRED_CONFORMANCE_CHECKS['agent-runtime']) {
    assert.ok(
      report.results.some(result => result.name === required),
      `§39 requires a check named "${required}"`,
    )
  }

  const dead = await adapterSdk.runConformance({
    kind: 'agent-runtime',
    checks: adapterSdk.agentRuntimeChecks({ runtime: deadRuntime(), runIdPrefix: 'dead', reopen: deadRuntime }),
    clock: new adapterTesting.FakeClock(0),
  })
  assert.deepEqual(
    dead.results.filter(result => result.status !== 'failed'),
    [],
    'every check must notice a runtime that answers nothing',
  )
  assert.equal(dead.passed, 0)
})

test('the controller publishes myworkAdapters and drops every registration on unload', async () => {
  const ctx = new Context()
  const fiber = ctx.plugin(controller, { diagnostics: false })
  await fiber.await()

  assert.ok(
    fiber.getEffects().some(effect => effect.label.includes('mywork controller shutdown')),
    'the controller shutdown effect must be registered on the plugin fiber',
  )

  const service = ctx.get(contracts.MYWORK_ADAPTERS_SERVICE)
  assert.ok(service !== undefined, 'myworkAdapters must be published while mounted')

  // The composition root publishes its own rows before any test registration:
  // `app.start()` mounts the evidence and lease stores. Naming them is stronger
  // than counting rows, because a rename or a lost subsystem breaks loudly here
  // instead of shifting a number.
  assert.deepEqual(
    service.list().map(manifest => manifest.adapterId).sort(),
    ['mywork-evidence', 'mywork-lease'],
    'the composition root must publish the evidence and lease rows',
  )

  const handle = service.register(registration({ id: 'service-memory' }))
  assert.equal(service.size, 3, 'the fake adapter joins the two published rows')
  assert.equal(service.require('memory', { capabilities: ['retain'] }), handle.adapter)
  assert.deepEqual(service.list('memory').map(manifest => manifest.adapterId), ['service-memory'])
  assert.throws(() => service.register(registration({ id: 'too-new', contractVersion: 'memory/v2' })), refusedWith('CONTRACT_MISMATCH'))

  await fiber.dispose()
  assert.equal(ctx.get(contracts.MYWORK_ADAPTERS_SERVICE), undefined, 'the service must be gone after unload')
  assert.equal(handle.unregister(), false, 'unload must have removed the registration')

  // Mounting the controller opens its SQLite state under `DSH_HOME`. That
  // variable is pinned to a scratch directory at the top of this file, so the
  // user's real home must still carry no state of ours.
  const liveHome = join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'dsh-mywork')
  assert.equal(existsSync(liveHome), false, `the suite must not write state into the live home (${liveHome})`)
})

test('core and contracts keep no provider-specific branch', () => {
  /** Product and adapter names no policy code may mention. */
  const forbidden = ['beads', 'hindsight', 'openviking', 'better-sqlite3', 'node:sqlite', 'fake-adapter', '@deepseek-ai/cordis']

  /** Collect every TypeScript source of a package, recursively. */
  function sourcesOf(pkg, found = []) {
    for (const entry of readdirSync(join(repoRoot, 'packages', pkg, 'src'), { withFileTypes: true })) {
      const path = join(repoRoot, 'packages', pkg, 'src', entry.name)
      if (entry.isDirectory()) sourcesOf(pkg, found)
      else if (entry.name.endsWith('.ts')) found.push(path)
    }
    return found
  }

  // Guard the scrub itself: a scan that stripped the code too would pass
  // vacuously, so a known identifier must survive it.
  const contractsOperation = codeOnly(readFileSync(join(repoRoot, 'packages', 'contracts', 'src', 'operation.ts'), 'utf8'))
  assert.ok(contractsOperation.includes('MYWORK_ERROR_CODES'), 'the scan must keep real code')
  assert.equal(contractsOperation.includes('/**'), false, 'the scan must drop comments')

  for (const pkg of ['contracts', 'core']) {
    const files = sourcesOf(pkg)
    assert.ok(files.length >= 7, `${pkg} must have sources to scan`)
    for (const file of files) {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase()
      for (const name of forbidden) {
        assert.equal(code.includes(name), false, `${file} must not branch on "${name}"`)
      }
    }
  }

  // The SDK keeps the declaration boundary as well: an adapter is reached
  // through the registry, which has no name-addressed lookup at all.
  const registry = adapterSdk.createAdapterRegistry()
  assert.equal(typeof registry.register, 'function')
  assert.deepEqual(
    Object.keys(registry).sort(),
    ['clear', 'list', 'register', 'require', 'resolve', 'size', 'unregister'],
  )
  assert.equal(
    Object.keys(registry).some(key => /by(id|name)|get(id|name)/i.test(key)),
    false,
    'the registry must offer no lookup by adapter name',
  )
})

test('the adapter SDK and the controller bundle stay self-contained', () => {
  /**
   * Every module specifier a built file imports.
   *
   * Comments are stripped first: the bundle keeps its doc comments, one of which
   * contains the phrase `from "unreadable"`, and without the scrub the scan would
   * report a module named `unreadable`. The capture excludes whitespace for the
   * same reason it does in `boundaries.test.mjs`.
   */
  function specifiersOf(source) {
    return [...codeOnly(source).matchAll(/\bfrom\s*['"]([^'"\s]+)['"]/g)].map(match => match[1])
  }

  const externalsOf = relative =>
    specifiersOf(readFileSync(join(repoRoot, relative), 'utf8')).filter(specifier => !specifier.startsWith('.'))

  // The SDK halves carry no external import at all.
  for (const relative of ['packages/adapter-sdk/lib/index.js', 'packages/adapter-sdk/lib/testing.js']) {
    assert.deepEqual(externalsOf(relative), [], `${relative} external imports`)
  }

  // The published bundle states one invariant: it may reach the host runtime and
  // Node builtins, and nothing else. A `@dsh-mywork/*` import would mean a
  // workspace package was NOT inlined; any other `@deepseek-ai/*` would mean the
  // bundle depends on something the host does not promise to provide.
  const externals = externalsOf('packages/controller/lib/index.js')
  assert.deepEqual(
    externals.filter(specifier => !specifier.startsWith('node:')),
    ['@deepseek-ai/cordis'],
    'the only non-builtin external may be the host runtime',
  )
  assert.deepEqual(
    externals.filter(specifier => specifier.startsWith('@dsh-mywork/')),
    [],
    'the workspace packages must be inlined, not imported',
  )
  // Guard the extraction: a scan that found nothing would pass the two checks
  // above vacuously.
  assert.ok(
    externals.filter(specifier => specifier.startsWith('node:')).length >= 3,
    `expected the bundle to import its Node builtins, found ${externals.join(', ')}`,
  )
})
