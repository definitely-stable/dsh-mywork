/**
 * Memory Fabric and Native Memory (architecture §8, §21.4, §21.5, §23, §35,
 * §49, §52; §62 items 20, 24, 25).
 *
 * The suite drives the fabric, the native provider, the disabled provider, and
 * the §21.5 context provider against literal proposals, so every branch is
 * decided by data rather than by a model: a claim proposed twice, a weaker
 * statement that would rewrite a stronger one, a record whose window closed, a
 * reference nobody holds, a backend that is unavailable, and a provider that
 * never answers.
 *
 * Four acceptance properties of the card are checked as behaviour rather than
 * as a claim: retention is idempotent, one scope has exactly one primary
 * writer, a degraded answer is only reachable where the route allows it and is
 * always visible in diagnostics, and a raw transcript reaches the prompt as a
 * *reference* and never as content.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { contracts, core, memoryNative } from './lib/fixtures.mjs'

/** Materialization and retention time. Required, not defaulted: a decision against an invented clock is another decision. */
const NOW = 1_000

/** Operation identity of a memory write. */
function meta(overrides = {}) {
  return core.defineOperationMeta({ operationId: 'op-memory', correlationId: 'corr-memory', ...overrides })
}

/** The scope most tests write in. */
const WORKSPACE = { type: 'workspace', id: 'w1' }

/** A second workspace, for §52's isolation. */
const OTHER_WORKSPACE = { type: 'workspace', id: 'w2' }

/** A task inside {@link WORKSPACE}, with the parent link §23.2 allows. */
const TASK = { type: 'task', id: 't1', parent: WORKSPACE }

/** §23.2's shared scope. */
const GLOBAL = { type: 'global', id: 'global' }

/** A role scope, used where a second writer is wanted. */
const ROLE = { type: 'role', id: 'backend-developer' }

/** The one actor §8 lets write `memory.semantic`. */
const ACTOR = 'memory-provider'

/** Time the retention under test is stamped with when a test has no reason to move the clock. */
function route(scope, primary, optional = false) {
  return { match: { scope }, primary, optional }
}

/** A policy over the routes a test needs, with the timeout tests override. */
function policy(routes, overrides = {}) {
  return { routes, timeoutMs: 50, diagnosticLimit: 20, ...overrides }
}

/**
 * A memory proposal with the defaults a test usually wants.
 *
 * The source is a raw session, deliberately: §23.5 states provenance as
 * references, and several tests check that the transcript behind the reference
 * stays behind it.
 */
function proposal(overrides = {}) {
  return {
    statement: 'A retry after the first timeout succeeded.',
    scope: WORKSPACE,
    kind: 'experience',
    sources: [{ uri: 'session:abc#turn-4', revision: '9', type: 'session' }],
    createdBy: { component: 'worker', run: 'run-1' },
    trust: 'high',
    ...overrides,
  }
}

/** A fabric over one named provider, with the routes a test states. */
function fabricOver(entries, routes, overrides = {}) {
  return core.createMemoryFabric({
    providers: entries.map(([provider, port]) => ({ provider, port })),
    policy: policy(routes, overrides.policy),
    ...(overrides.revisions === undefined ? {} : { revisions: overrides.revisions }),
    ...(overrides.actors === undefined ? {} : { actors: overrides.actors }),
  })
}

/** A fabric over a fresh native provider, routed for the workspace scope. */
function nativeFabric(routes = [route('workspace', 'native')], overrides = {}) {
  const native = memoryNative.createNativeMemoryProvider()
  return { native, fabric: fabricOver([['native', native]], routes, overrides) }
}

/** Assert one refusal carries the reason and §42 code it must. */
function assertRefusal(result, reason, code) {
  assert.equal(result.ok, false, `expected a refusal, got ${JSON.stringify(result).slice(0, 200)}`)
  assert.equal(result.reason, reason)
  assert.equal(result.code, code)
  assert.match(result.message, /^dsh-mywork: /)
  assert.ok(Array.isArray(result.diagnostics), 'a refusal carries the diagnostics of its own call')
}

/** Retain one proposal and assert it was accepted, returning the outcome. */
async function retain(fabric, overrides = {}, request = {}) {
  const result = await fabric.retain({
    proposal: proposal(overrides),
    meta: meta(),
    nowMs: NOW,
    ...request,
  })
  assert.equal(result.ok, true, `the fixture retention must succeed: ${result.message ?? ''}`)
  return result
}

// ---------------------------------------------------------------------------
// §23.9 — one primary writer per scope
// ---------------------------------------------------------------------------

test('a scope is written by the provider its route names, and read back from it', async () => {
  const first = memoryNative.createNativeMemoryProvider({ provider: 'first' })
  const second = memoryNative.createNativeMemoryProvider({ provider: 'second' })
  const fabric = fabricOver(
    [
      ['first', first],
      ['second', second],
    ],
    [route('workspace', 'first'), route('role', 'second')],
  )
  const written = await retain(fabric)
  assert.equal(first.records().length, 1, 'the routed provider holds the record')
  assert.equal(second.records().length, 0, 'the other provider is not a second writer')
  const recalled = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  assert.equal(recalled.ok, true)
  assert.deepEqual(
    recalled.records.map(record => record.id),
    [written.record.id],
  )
})

test('a scope with no route has no primary writer, and the fabric refuses rather than guessing', async () => {
  const { native, fabric } = nativeFabric([route('role', 'native')])
  const refused = await fabric.retain({ proposal: proposal(), meta: meta(), nowMs: NOW })
  assertRefusal(refused, 'scope-unrouted', 'CONTRACT_MISMATCH')
  assert.match(refused.message, /no memory route matches scope "workspace:w1"/)
  assert.deepEqual(refused.diagnostics.map(entry => entry.code), ['route-missing'])
  assert.equal(native.records().length, 0, 'nothing was written anywhere')
})

test('a route that names an unbound provider is refused, not silently served elsewhere', async () => {
  const native = memoryNative.createNativeMemoryProvider()
  const fabric = fabricOver([['native', native]], [
    route('workspace', 'ghost'),
    route('workspace', 'native'),
  ])
  const refused = await fabric.retain({ proposal: proposal(), meta: meta(), nowMs: NOW })
  assertRefusal(refused, 'scope-unrouted', 'CONTRACT_MISMATCH')
  assert.match(refused.message, /names provider "ghost", which is not bound/)
  assert.equal(native.records().length, 0, 'the first matching route decides; the second is not a fallback')
})

test('a record is superseded only by the provider that writes its scope', async () => {
  const workspace = memoryNative.createNativeMemoryProvider({ provider: 'workspace-store' })
  const roles = memoryNative.createNativeMemoryProvider({ provider: 'role-store' })
  const fabric = fabricOver(
    [
      ['workspace-store', workspace],
      ['role-store', roles],
    ],
    [route('workspace', 'workspace-store'), route('role', 'role-store')],
  )
  const written = await retain(fabric)
  const refused = await fabric.retain({
    proposal: proposal({ scope: ROLE, supersedes: [written.record.id] }),
    meta: meta(),
    nowMs: NOW,
  })
  assertRefusal(refused, 'not-primary', 'SECURITY_DENIED')
  assert.equal(roles.records().length, 0, 'nothing was written by the other provider')
  assert.equal(workspace.find(written.record.id).status, 'active', 'the record it wanted to replace is untouched')
})

// ---------------------------------------------------------------------------
// §52 — workspace isolation
// ---------------------------------------------------------------------------

test('a record in one workspace is not a record in another', async () => {
  const { native, fabric } = nativeFabric()
  const written = await retain(fabric)
  const elsewhere = await fabric.recall({ scopes: [OTHER_WORKSPACE], nowMs: NOW })
  assert.equal(elsewhere.ok, true)
  assert.deepEqual(elsewhere.records, [], 'another workspace sees nothing')
  const here = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  assert.deepEqual(
    here.records.map(record => record.id),
    [written.record.id],
  )
  assert.equal(native.records().length, 1, 'the record exists; it is the request that does not reach it')
})

test('a task-scoped record is visible to the workspace it declares as its parent', async () => {
  const { fabric } = nativeFabric([route('task', 'native'), route('workspace', 'native')])
  const written = await retain(fabric, { scope: TASK })
  const fromParent = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  assert.equal(fromParent.ok, true, fromParent.message)
  assert.deepEqual(
    fromParent.records.map(record => record.id),
    [written.record.id],
  )
  const fromElsewhere = await fabric.recall({ scopes: [OTHER_WORKSPACE], nowMs: NOW })
  assert.deepEqual(fromElsewhere.records, [])
})

test('global memory is served only to a request that names the global scope', async () => {
  const { fabric } = nativeFabric([
    route('workspace', 'native'),
    route('global', 'native'),
  ])
  const written = await retain(fabric, { scope: GLOBAL })
  const workspaceOnly = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  assert.deepEqual(workspaceOnly.records, [], 'scope is matched exactly; nothing is inherited from the family name')
  const both = await fabric.recall({ scopes: [WORKSPACE, GLOBAL], nowMs: NOW })
  assert.deepEqual(
    both.records.map(record => record.id),
    [written.record.id],
  )
})

// ---------------------------------------------------------------------------
// §23.4 — deduplication and idempotent retention
// ---------------------------------------------------------------------------

test('the same claim proposed twice is one record, reinforced rather than duplicated', async () => {
  const { native, fabric } = nativeFabric()
  const first = await retain(fabric)
  const second = await retain(fabric, {}, { nowMs: NOW + 100 })
  assert.equal(second.created, false)
  assert.equal(second.reinforced, true)
  assert.equal(second.record.id, first.record.id, 'the record keeps its identity')
  assert.equal(second.record.revision, first.record.revision, 'and the §35 number an attempt froze')
  assert.equal(second.record.reinforcedCount, 1)
  assert.equal(native.records().length, 1, 'the provider holds one row')
  assert.deepEqual(second.diagnostics, [], 'a reinforcement is not a degradation')
})

test('whitespace and case do not make a second record', async () => {
  const { native, fabric } = nativeFabric()
  await retain(fabric)
  const again = await retain(fabric, { statement: '  a RETRY after the   first timeout succeeded. ' })
  assert.equal(again.reinforced, true)
  assert.equal(native.records().length, 1)
})

test('a claim is scoped: the same statement in another scope is another record', async () => {
  const { native, fabric } = nativeFabric([
    route('workspace', 'native'),
    route('task', 'native'),
  ])
  const first = await retain(fabric)
  const second = await retain(fabric, { scope: TASK })
  assert.notEqual(second.record.id, first.record.id)
  assert.equal(native.records().length, 2)
})

test('a claim is kinded: the same statement under another kind is another claim', async () => {
  const { native, fabric } = nativeFabric()
  const first = await retain(fabric)
  const second = await retain(fabric, { kind: 'constraint' })
  assert.notEqual(second.record.id, first.record.id)
  assert.equal(native.records().length, 2)
  const only = await fabric.recall({ scopes: [WORKSPACE], kinds: ['constraint'], nowMs: NOW })
  assert.deepEqual(
    only.records.map(record => record.id),
    [second.record.id],
  )
})

// ---------------------------------------------------------------------------
// §23.4, §23.6 — conflict, supersede, staleness
// ---------------------------------------------------------------------------

test('a stronger statement updates the record it repeats, and the old one stops being served', async () => {
  const { native, fabric } = nativeFabric()
  const first = await retain(fabric)
  const second = await retain(fabric, { trust: 'very-high' }, { nowMs: NOW + 100 })
  assert.equal(second.created, true)
  assert.deepEqual(second.superseded, [first.record.id])
  assert.equal(native.find(first.record.id).status, 'superseded')
  const recalled = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW + 200 })
  assert.deepEqual(
    recalled.records.map(record => record.id),
    [second.record.id],
  )
  const decision = recalled.considered.find(entry => entry.record.id === first.record.id)
  assert.equal(decision.served, false)
  assert.equal(decision.reason, 'superseded')
  assert.equal(decision.replacedBy, second.record.id)
  assert.ok(recalled.diagnostics.some(entry => entry.code === 'superseded'))
})

test('a weaker statement cannot rewrite a stronger record (§23.6)', async () => {
  const { native, fabric } = nativeFabric()
  const first = await retain(fabric, { trust: 'very-high' })
  const refused = await fabric.retain({
    proposal: proposal({ trust: 'low' }),
    meta: meta(),
    nowMs: NOW + 100,
  })
  assertRefusal(refused, 'conflict', 'TASK_CONFLICT')
  assert.match(refused.message, /"low" may not supersede the "very-high" record/)
  assert.deepEqual(refused.diagnostics.map(entry => entry.code), ['conflict'])
  assert.equal(native.records().length, 1, 'the refused write left no second record')
  assert.equal(native.find(first.record.id).status, 'active')
  assert.equal(native.find(first.record.id).fingerprint, first.record.fingerprint, 'and did not rewrite it')
})

test('an explicit supersede of an unknown record is refused, and nothing is written', async () => {
  const { native, fabric } = nativeFabric()
  const refused = await fabric.retain({
    proposal: proposal({ supersedes: ['mem-404'] }),
    meta: meta(),
    nowMs: NOW,
  })
  assertRefusal(refused, 'invalid-ref', 'TASK_CONFLICT')
  assert.deepEqual(refused.diagnostics.map(entry => entry.code), ['invalid-ref'])
  assert.equal(native.records().length, 0)
})

test('an explicit supersede of a weaker record by a stronger one is applied', async () => {
  const { fabric } = nativeFabric()
  const older = await retain(fabric, { statement: 'The build takes four minutes.', trust: 'medium' })
  const newer = await retain(
    fabric,
    { statement: 'The build takes six minutes since the bundler change.', trust: 'high', supersedes: [older.record.id] },
    { nowMs: NOW + 100 },
  )
  assert.deepEqual(newer.superseded, [older.record.id])
  assert.deepEqual(newer.record.supersedes, [older.record.id])
  const recalled = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW + 200 })
  assert.deepEqual(
    recalled.records.map(record => record.id),
    [newer.record.id],
  )
})

test('a superseded record is refused by materialization even after it was proposed as context', async () => {
  const { fabric } = nativeFabric()
  const first = await retain(fabric)
  const provider = core.createMemoryContextProvider({ fabric, now: () => NOW })
  const served = await provider.serving({ scopes: [{ kind: 'workspace', id: 'w1' }], nowMs: NOW })
  assert.equal(served.served.length, 1)
  const uri = contracts.memoryUri(first.record.id)
  const before = await provider.materialize({ uri, level: 'L2' })
  assert.match(before.content.text, /A retry after the first timeout succeeded\./)
  await retain(fabric, { trust: 'very-high' }, { nowMs: NOW + 100 })
  await assert.rejects(
    () => provider.materialize({ uri, level: 'L2' }),
    error => error.code === 'TASK_CONFLICT' && /not served: superseded/.test(error.message),
    'discovery and materialization apply the same serving rule',
  )
})

test('retrying an update reinforces the record it published, not the one it replaced', async () => {
  const { native, fabric } = nativeFabric()
  const first = await retain(fabric)
  const second = await retain(fabric, { trust: 'very-high' }, { nowMs: NOW + 100 })
  const retry = await retain(fabric, { trust: 'very-high' }, { nowMs: NOW + 200 })
  assert.equal(retry.record.id, second.record.id)
  assert.equal(retry.reinforced, true)
  assert.equal(native.records().length, 2, 'the superseded record is not rewritten into a third one')
  assert.equal(native.find(first.record.id).status, 'superseded')
})

// ---------------------------------------------------------------------------
// §23.5 — validity
// ---------------------------------------------------------------------------

test('a record whose validity window closed is not served, and the recall says so', async () => {
  const { fabric } = nativeFabric()
  const written = await retain(fabric, { validity: { from: NOW - 500, until: NOW } })
  const after = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW + 1 })
  assert.deepEqual(after.records, [])
  assert.equal(after.considered[0].reason, 'outside-validity')
  assert.ok(after.diagnostics.some(entry => entry.code === 'outside-validity'))
  const during = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  assert.deepEqual(
    during.records.map(record => record.id),
    [written.record.id],
  )
})

test('a record whose window has not opened is not served', async () => {
  const { fabric } = nativeFabric()
  await retain(fabric, { validity: { from: NOW + 100 } })
  const before = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  assert.deepEqual(before.records, [])
  assert.equal(before.considered[0].reason, 'outside-validity')
})

test('a validity window that ends before it starts is refused at the boundary', async () => {
  const { fabric } = nativeFabric()
  await assert.rejects(
    () => fabric.retain({ proposal: proposal({ validity: { from: 2_000, until: 1_000 } }), meta: meta(), nowMs: NOW }),
    error => error instanceof TypeError && /ends before it starts/.test(error.message),
  )
})

// ---------------------------------------------------------------------------
// §23.4 — staged validation and the lifecycle gate
// ---------------------------------------------------------------------------

test('a staged proposal is a Candidate that is not served until it is validated', async () => {
  const { fabric } = nativeFabric()
  const staged = await retain(fabric, { validation: 'staged' })
  assert.equal(staged.record.status, 'candidate')
  const before = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  assert.deepEqual(before.records, [])
  assert.equal(before.considered[0].reason, 'status-not-served')
  const validated = await fabric.validate({ id: staged.record.id, meta: meta(), nowMs: NOW + 10 })
  assert.equal(validated.ok, true)
  assert.equal(validated.record.status, 'active')
  const after = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW + 20 })
  assert.deepEqual(
    after.records.map(record => record.id),
    [staged.record.id],
  )
})

test('validating a record that is not a Candidate is refused', async () => {
  const { fabric } = nativeFabric()
  const active = await retain(fabric)
  const refused = await fabric.validate({ id: active.record.id, meta: meta(), nowMs: NOW })
  assertRefusal(refused, 'invalid-transition', 'TASK_CONFLICT')
  assert.match(refused.message, /is "active", not "candidate"/)})

test('the lifecycle refuses a move it does not declare, and allows the ones it does', async () => {
  const { native, fabric } = nativeFabric()
  const first = await retain(fabric)
  const superseded = await retain(fabric, { trust: 'very-high' }, { nowMs: NOW + 100 })
  const archived = await fabric.transition({ id: first.record.id, to: 'archived', meta: meta(), nowMs: NOW + 200 })
  assert.equal(archived.ok, true)
  assert.equal(native.find(first.record.id).status, 'archived')
  const revived = await fabric.transition({ id: first.record.id, to: 'active', meta: meta(), nowMs: NOW + 300 })
  assertRefusal(revived, 'invalid-transition', 'TASK_CONFLICT')
  assert.equal(native.find(superseded.record.id).status, 'active')
})

// ---------------------------------------------------------------------------
// §8 — authority
// ---------------------------------------------------------------------------

test('only the memory-provider actor may retain', async () => {
  const { native, fabric } = nativeFabric([route('workspace', 'native')], { actors: ['memory-provider'] })
  const refused = await fabric.retain({
    proposal: proposal(),
    actors: ['skill-registry'],
    meta: meta(),
    nowMs: NOW,
  })
  assertRefusal(refused, 'denied', 'SECURITY_DENIED')
  assert.match(refused.message, /"skill-registry" may not write memory/)
  assert.equal(native.records().length, 0)
  const accepted = await retain(fabric)
  assert.equal(accepted.created, true)
})

// ---------------------------------------------------------------------------
// §49 — optional memory, degraded answers, and diagnostics
// ---------------------------------------------------------------------------

test('a disabled backend degrades an optional route and says so', async () => {
  const disabled = memoryNative.createDisabledMemoryProvider({ reason: 'this workspace keeps no memory' })
  const fabric = fabricOver([['disabled', disabled]], [route('workspace', 'disabled', true)])
  const recalled = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  assert.equal(recalled.ok, true)
  assert.deepEqual(recalled.records, [])
  assert.equal(recalled.degraded, true, 'the caller is told the answer is not a full one')
  assert.deepEqual(recalled.diagnostics.map(entry => entry.code), ['disabled', 'degraded'])
  assert.match(recalled.diagnostics[0].detail, /this workspace keeps no memory/)
  assert.ok(fabric.diagnostics().some(entry => entry.code === 'degraded'), 'and the fabric recorded it')
})

test('a required route refuses instead of degrading', async () => {
  const disabled = memoryNative.createDisabledMemoryProvider()
  const fabric = fabricOver([['disabled', disabled]], [route('workspace', 'disabled', false)])
  const refused = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  assertRefusal(refused, 'provider-unavailable', 'ADAPTER_UNAVAILABLE')
  assert.match(refused.message, /is unavailable/)
  assert.equal(refused.diagnostics[0].code, 'disabled')
})

test('a write never degrades: a disabled backend refuses the retention', async () => {
  const disabled = memoryNative.createDisabledMemoryProvider()
  const fabric = fabricOver([['disabled', disabled]], [route('workspace', 'disabled', true)])
  const refused = await fabric.retain({ proposal: proposal(), meta: meta(), nowMs: NOW })
  assertRefusal(refused, 'provider-unavailable', 'ADAPTER_UNAVAILABLE')
  assert.equal(refused.diagnostics[0].code, 'disabled')
})

test('a provider that never answers degrades an optional route inside the policy timeout', async () => {
  const hanging = {
    capabilities: async () => ({ reflect: false, resolve: false, scopeTypes: [], kinds: [] }),
    retain: () => new Promise(() => {}),
    recall: () => new Promise(() => {}),
    health: async () => ({ available: true }),
  }
  const fabric = fabricOver([['slow', hanging]], [route('workspace', 'slow', true)], {
    policy: { timeoutMs: 5 },
  })
  const started = Date.now()
  const recalled = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  const elapsed = Date.now() - started
  assert.equal(recalled.ok, true)
  assert.equal(recalled.degraded, true)
  assert.deepEqual(recalled.diagnostics.map(entry => entry.code), ['timeout', 'degraded'])
  assert.match(recalled.diagnostics[0].detail, /deadline/)
  assert.ok(elapsed >= 4, `the deadline is a real one (waited ${elapsed}ms)`)
})

test('a provider that never answers refuses a required route with the timeout reason', async () => {
  const hanging = {
    capabilities: async () => ({ reflect: false, resolve: false, scopeTypes: [], kinds: [] }),
    retain: () => new Promise(() => {}),
    recall: () => new Promise(() => {}),
    health: async () => ({ available: true }),
  }
  const fabric = fabricOver([['slow', hanging]], [route('workspace', 'slow', false)], {
    policy: { timeoutMs: 5 },
  })
  const refused = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  assertRefusal(refused, 'timeout', 'ADAPTER_UNAVAILABLE')
  const written = await fabric.retain({ proposal: proposal(), meta: meta(), nowMs: NOW })
  assertRefusal(written, 'timeout', 'ADAPTER_UNAVAILABLE')
})

test('diagnostics are bounded and keep the newest', async () => {
  const { fabric } = nativeFabric([route('workspace', 'native')], {
    policy: { diagnosticLimit: 2 },
  })
  for (const id of ['mem-a', 'mem-b', 'mem-c']) {
    await fabric.resolve({ id, nowMs: NOW })
  }
  const kept = fabric.diagnostics()
  assert.equal(kept.length, 2, 'the log is bounded by the policy')
  assert.deepEqual(kept.map(entry => entry.code), ['invalid-ref', 'invalid-ref'])
  assert.ok(kept[kept.length - 1].detail.includes('mem-c'), 'and the newest entry survived')
})

// ---------------------------------------------------------------------------
// §23.8 — resolve and the optional reflect
// ---------------------------------------------------------------------------

test('a reference nobody holds is refused as an invalid ref, and a held one resolves', async () => {
  const { fabric } = nativeFabric()
  const missing = await fabric.resolve({ id: 'mem-404', nowMs: NOW })
  assertRefusal(missing, 'invalid-ref', 'TASK_CONFLICT')
  assert.deepEqual(missing.diagnostics.map(entry => entry.code), ['invalid-ref'])
  const written = await retain(fabric)
  const found = await fabric.resolve({ id: written.record.id, nowMs: NOW })
  assert.equal(found.ok, true)
  assert.equal(found.record.id, written.record.id)
  assert.equal(found.record.statement, written.record.statement)
})

test('reflection is served where the provider implements it, and is not retained', async () => {
  const { native, fabric } = nativeFabric()
  await retain(fabric)
  const reflected = await fabric.reflect({ scope: WORKSPACE, nowMs: NOW })
  assert.equal(reflected.ok, true)
  assert.match(reflected.reflection.text, /1 record\(s\) for scope workspace:w1; 1 active/)
  assert.match(reflected.reflection.text, /- \[experience\] A retry after the first timeout succeeded\./)
  assert.equal(native.records().length, 1, 'a reflection is not a record of its own')
  const recalled = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  assert.equal(recalled.records.length, 1, 'and it did not become context')
})

test('a provider without reflection is refused, not answered with an empty digest', async () => {
  const noReflect = {
    capabilities: async () => ({ reflect: false, resolve: true, scopeTypes: ['workspace'], kinds: [] }),
    retain: async () => {
      throw new Error('unused')
    },
    recall: async () => ({ records: [] }),
    resolve: async () => {
      throw new Error('unused')
    },
    health: async () => ({ available: true }),
  }
  const fabric = fabricOver([['plain', noReflect]], [route('workspace', 'plain', true)])
  const refused = await fabric.reflect({ scope: WORKSPACE, nowMs: NOW })
  assertRefusal(refused, 'reflect-unsupported', 'CAPABILITY_UNSUPPORTED')
  assert.match(refused.message, /does not implement reflection/)
})

// ---------------------------------------------------------------------------
// §23.4 — the serving rule itself
// ---------------------------------------------------------------------------

test('the serving rule names every reason it can refuse a record', async () => {
  // Guard the loop below: on an empty vocabulary it would assert nothing.
  assert.equal(contracts.MEMORY_SERVING_REASONS.length, 7)
  const { fabric } = nativeFabric()
  const base = (await retain(fabric, { validity: { from: NOW - 100 } })).record
  const cases = {
    'scope-mismatch': { record: base, request: { scopes: [OTHER_WORKSPACE], nowMs: NOW } },
    'status-not-served': { record: { ...base, status: 'candidate' }, request: { scopes: [WORKSPACE], nowMs: NOW } },
    superseded: { record: { ...base, status: 'superseded' }, request: { scopes: [WORKSPACE], nowMs: NOW } },
    'outside-validity': {
      record: { ...base, validity: { until: NOW - 1 } },
      request: { scopes: [WORKSPACE], nowMs: NOW },
    },
    'kind-mismatch': { record: base, request: { scopes: [WORKSPACE], kinds: ['fact'], nowMs: NOW } },
    'trust-below-minimum': { record: { ...base, trust: 'low' }, request: { scopes: [WORKSPACE], minTrust: 'high', nowMs: NOW } },
    'query-mismatch': { record: base, request: { scopes: [WORKSPACE], query: 'nothing like it', nowMs: NOW } },
  }
  for (const reason of contracts.MEMORY_SERVING_REASONS) {
    const entry = cases[reason]
    assert.ok(entry !== undefined, `every serving reason has a case: ${reason}`)
    assert.equal(core.memoryServeRefusal(entry.record, entry.request), reason)
  }
  const served = core.memoryServeRefusal(base, { scopes: [WORKSPACE], nowMs: NOW })
  assert.equal(served, undefined, 'and a record that passes is served')
})

test('a record below the trust floor is left out of a recall and named', async () => {
  const { fabric } = nativeFabric()
  await retain(fabric, { trust: 'low' })
  const recalled = await fabric.recall({ scopes: [WORKSPACE], minTrust: 'high', nowMs: NOW })
  assert.deepEqual(recalled.records, [])
  assert.equal(recalled.considered[0].reason, 'trust-below-minimum')
})

test('served records come back strongest first, then newest', async () => {
  const { fabric } = nativeFabric()
  const first = await retain(fabric, { statement: 'First claim.', trust: 'medium' })
  const second = await retain(fabric, { statement: 'Second claim.', trust: 'very-high' }, { nowMs: NOW + 100 })
  const third = await retain(fabric, { statement: 'Third claim.', trust: 'very-high' }, { nowMs: NOW + 200 })
  const recalled = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW + 300 })
  assert.deepEqual(
    recalled.records.map(record => record.id),
    [third.record.id, second.record.id, first.record.id],
  )
})

// ---------------------------------------------------------------------------
// §21.4, §21.5 — the context provider, the prompt, and the raw transcript
// ---------------------------------------------------------------------------

test('discovery proposes a statement at L1 and carries no source payload', async () => {
  const { fabric } = nativeFabric()
  const written = await retain(fabric)
  const provider = core.createMemoryContextProvider({ fabric, now: () => NOW })
  const candidates = await provider.discover({ scopes: [{ kind: 'workspace', id: 'w1' }] })
  assert.equal(candidates.length, 1)
  const candidate = candidates[0]
  assert.equal(candidate.uri, `memory:${written.record.id}`)
  assert.equal(candidate.kind, 'memory')
  assert.equal(candidate.level, 'L1')
  assert.equal(candidate.trust, 'trusted')
  assert.match(candidate.content.text, /A retry after the first timeout succeeded\./)
  assert.equal(candidate.revision, String(written.record.revision))
  assert.deepEqual(
    candidate.provenance.map(entry => entry.uri),
    [`memory:${written.record.id}`, 'session:abc#turn-4'],
    'the raw session is cited',
  )
  // The shape has no room for the transcript itself: the assertion above is
  // about the reference, and this one is about the absence of a payload field.
  for (const forbidden of ['text', 'content', 'payload', 'body']) {
    assert.equal(
      contracts.MEMORY_SOURCE_REF_FIELDS.includes(forbidden),
      false,
      `a source reference carries no "${forbidden}" field`,
    )
  }
  assert.equal(candidate.attributes.kind, 'experience')
})

test('medium trust is proposed as data, and never as an instruction', async () => {
  const { fabric } = nativeFabric()
  await retain(fabric, { trust: 'medium' })
  const provider = core.createMemoryContextProvider({ fabric, now: () => NOW })
  const candidates = await provider.discover({ scopes: [{ kind: 'workspace', id: 'w1' }] })
  assert.equal(candidates[0].trust, 'untrusted', '§23.6 medium is content MyWork does not vouch for')
  assert.equal(contracts.INSTRUCTION_CONTEXT_CLASSES.includes('memory'), false)
  assert.equal(contracts.TRUSTED_CONTEXT_TRUST, 'trusted')
})

test('a raw transcript reaches the prompt as a reference and never as content', async () => {
  // The material the record was derived from. The fabric, the provider, and the
  // record itself hold no reference to this store: the only thing that crosses
  // is the uri §23.5 records.
  const RAW_TRANSCRIPT = 'TRANSCRIPT-MARKER-9f3a the whole session pasted verbatim'
  const sessions = new Map([['session:abc#turn-4', RAW_TRANSCRIPT]])
  const { fabric } = nativeFabric()
  const written = await retain(fabric)

  const provider = core.createMemoryContextProvider({ fabric, now: () => NOW })
  const binding = { provider: provider.provider, port: provider }
  const discovery = await core.discoverContext({
    providers: [binding],
    request: { scopes: [{ kind: 'workspace', id: 'w1' }] },
    nowMs: NOW,
  })
  const decision = await core.materializeContextSnapshot({
    attemptId: 'attempt-1',
    taskId: 'task-1',
    workspaceId: 'w1',
    createdAt: NOW,
    revisions: { task: 7, role: 3, blueprint: 11, workflow: 2 },
    route: {
      route: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
      role: 'preferred',
      contextWindow: 128_000,
      evaluations: [],
    },
    toolSurface: [],
    discovery,
    providers: [binding],
    registry: core.createContextSnapshotRevisionRegistry(),
  })
  assert.equal(decision.kind, 'materialized')
  const prompt = core.assembleContextPrompt(decision.snapshot)
  assert.match(prompt.text, /A retry after the first timeout succeeded\./, 'the retained statement is context')
  assert.equal(
    prompt.text.includes(RAW_TRANSCRIPT),
    false,
    'the transcript is not copied into the prompt',
  )
  assert.equal(
    prompt.text.includes(sessions.get('session:abc#turn-4')),
    false,
    'and reading it back through the store it lives in makes no difference',
  )
  const item = decision.snapshot.items.find(entry => entry.uri === contracts.memoryUri(written.record.id))
  assert.equal(item.placement, 'data', '§21.8: retrieved memory is context an attempt reads')
  assert.equal(item.mandatory, false)
  assert.match(prompt.text, /<<<mywork:data>>>/)
})

test('materialization serves the statement with its provenance and refuses a lower level', async () => {
  const { fabric } = nativeFabric()
  const written = await retain(fabric)
  const provider = core.createMemoryContextProvider({ fabric, now: () => NOW })
  const uri = contracts.memoryUri(written.record.id)
  const body = await provider.materialize({ uri, level: 'L2' })
  assert.equal(body.level, 'L2')
  assert.match(body.content.text, /session session:abc#turn-4 @9/)
  assert.equal(body.revision, String(written.record.revision))
  assert.equal(body.provenance.length, 2)
  await assert.rejects(
    () => provider.materialize({ uri, level: 'L1' }),
    error => error instanceof TypeError && /L2 is served by materialization only/.test(error.message),
  )
  await assert.rejects(
    () => provider.materialize({ uri: 'skill:not-a-memory', level: 'L2' }),
    error => error instanceof TypeError && /is not a memory uri/.test(error.message),
  )
  await assert.rejects(
    () => provider.materialize({ uri, level: 'L2', expectedContentHash: 'fnv1a-00000000' }),
    error => error instanceof TypeError && /hashes to/.test(error.message),
  )
})

test('discovery serves nothing when the fabric asks for another class', async () => {
  const { fabric } = nativeFabric()
  await retain(fabric)
  const provider = core.createMemoryContextProvider({ fabric, now: () => NOW })
  const candidates = await provider.discover({
    scopes: [{ kind: 'workspace', id: 'w1' }],
    classes: ['skill'],
  })
  assert.deepEqual(candidates, [])
})

test('a scope the policy has no writer for is a refusal the caller can see', async () => {
  const { fabric } = nativeFabric([route('role', 'native')])
  const provider = core.createMemoryContextProvider({ fabric, now: () => NOW })
  const serving = await provider.serving({ scopes: [{ kind: 'workspace', id: 'w1' }], nowMs: NOW })
  assert.equal(serving.served.length, 0)
  assert.equal(serving.refusal.reason, 'scope-unrouted')
  assert.deepEqual(serving.diagnostics.map(entry => entry.code), ['route-missing'])
  await assert.rejects(
    () => provider.discover({ scopes: [{ kind: 'workspace', id: 'w1' }] }),
    error => error.code === 'CONTRACT_MISMATCH' && /no memory route matches/.test(error.message),
  )
})

test('§21.2 levels are disclosed as the card asks: L0 is an abstract, L2 the provenance', async () => {
  const { fabric } = nativeFabric()
  const written = await retain(fabric, { statement: 'First line of the claim.\nSecond line with detail.' })
  const abstract = core.createMemoryContextProvider({ fabric, defaultLevel: 'L0', now: () => NOW })
  const candidates = await abstract.discover({ scopes: [{ kind: 'workspace', id: 'w1' }] })
  assert.equal(candidates[0].level, 'L0')
  assert.match(candidates[0].content.text, /\[experience\] First line of the claim\.$/)
  assert.equal(candidates[0].content.text.includes('Second line'), false, 'L0 is the abstract, not the statement')
  assert.throws(
    () => core.createMemoryContextProvider({ fabric, defaultLevel: 'L2', now: () => NOW }),
    error => error instanceof TypeError && /discovery discloses L0\/L1 only/.test(error.message),
  )
  const full = core.memoryTextOf(written.record, 'L2')
  assert.match(full, /sources: session session:abc#turn-4 @9/)
})

test('the namespace revision is stable while memory is unchanged, and moves when it changes', async () => {
  const { fabric } = nativeFabric()
  await retain(fabric)
  const provider = core.createMemoryContextProvider({ fabric, now: () => NOW })
  const scope = [{ kind: 'workspace', id: 'w1' }]
  const first = await provider.namespaceRevision({ scopes: scope, nowMs: NOW })
  const again = await provider.namespaceRevision({ scopes: scope, nowMs: NOW })
  assert.equal(first.revision, again.revision, 'the same memory is the same §35 revision')
  assert.equal(first.degraded, false)
  await retain(fabric, { statement: 'Another claim entirely.' }, { nowMs: NOW + 100 })
  const moved = await provider.namespaceRevision({ scopes: scope, nowMs: NOW + 200 })
  assert.notEqual(moved.revision, first.revision, 'a changed namespace is the next revision')
})

// ---------------------------------------------------------------------------
// §23.8 — the providers themselves
// ---------------------------------------------------------------------------

test('the native provider refuses to rewrite a record it already holds', async () => {
  const native = memoryNative.createNativeMemoryProvider()
  const first = await retain(nativeFabric([route('workspace', 'native')]).fabric)
  await native.retain({ record: first.record, mode: 'create' })
  const replaced = { ...first.record, contentHash: 'fnv1a-deadbeef' }
  await assert.rejects(
    () => native.retain({ record: replaced, mode: 'replace' }),
    error => error.code === 'TASK_CONFLICT' && /holds other content/.test(error.message),
  )
  await assert.rejects(
    () => native.retain({ record: { ...first.record, id: 'mem-99' }, mode: 'replace' }),
    error => error.code === 'TASK_CONFLICT' && /holds no memory/.test(error.message),
  )
})

test('the native provider answers structurally: by scope, by kind, by id and by limit', async () => {
  const { native, fabric } = nativeFabric()
  const first = await retain(fabric)
  const second = await retain(fabric, { statement: 'Another claim.', kind: 'fact' })
  assert.deepEqual(
    native.records().map(record => record.id).sort(),
    [first.record.id, second.record.id].sort(),
  )
  const byScope = await native.recall({ scopes: [OTHER_WORKSPACE] })
  assert.deepEqual(byScope.records, [])
  const byKind = await native.recall({ scopes: [WORKSPACE], kinds: ['fact'] })
  assert.deepEqual(
    byKind.records.map(record => record.id),
    [second.record.id],
  )
  const byId = await native.recall({ scopes: [], ids: [first.record.id] })
  assert.deepEqual(
    byId.records.map(record => record.id),
    [first.record.id],
  )
  const limited = await native.recall({ scopes: [WORKSPACE], limit: 1 })
  assert.equal(limited.records.length, 1)
})

test('the disabled provider declares nothing and fails closed', async () => {
  const disabled = memoryNative.createDisabledMemoryProvider()
  assert.deepEqual(await disabled.capabilities(), { reflect: false, resolve: false, scopeTypes: [], kinds: [] })
  const health = await disabled.health()
  assert.equal(health.available, false)
  assert.equal(health.reason, 'disabled')
  await assert.rejects(
    () => disabled.retain({ record: {}, mode: 'create' }),
    error => error.code === 'ADAPTER_UNAVAILABLE' && /memory is disabled/.test(error.message),
  )
  await assert.rejects(
    () => disabled.recall({ scopes: [] }),
    error => error.code === 'ADAPTER_UNAVAILABLE',
    'an empty list would be a successful answer meaning "nothing is known"',
  )
})

test('a fabric built without a policy refuses every scope rather than remembering', async () => {
  const native = memoryNative.createNativeMemoryProvider()
  const fabric = core.createMemoryFabric({ providers: [{ provider: 'native', port: native }] })
  assert.deepEqual(fabric.routes(), [])
  const refused = await fabric.retain({ proposal: proposal(), meta: meta(), nowMs: NOW })
  assertRefusal(refused, 'scope-unrouted', 'CONTRACT_MISMATCH')
  assert.equal(native.records().length, 0)
})

test('a policy route must say whether memory is optional, because §49 turns on it', async () => {
  const native = memoryNative.createNativeMemoryProvider()
  assert.throws(
    () => core.createMemoryFabric({ providers: [{ provider: 'native', port: native }], policy: { routes: [{ match: { scope: 'workspace' }, primary: 'native' }], timeoutMs: 10, diagnosticLimit: 5 } }),
    error => error instanceof TypeError && /must state whether it is optional/.test(error.message),
  )
})

test('a proposal is validated at the boundary', async () => {
  const { fabric } = nativeFabric()
  await assert.rejects(
    () => fabric.retain({ proposal: proposal({ trust: 'certain' }), meta: meta(), nowMs: NOW }),
    error => error instanceof TypeError && /is not a memory trust class/.test(error.message),
  )
  await assert.rejects(
    () => fabric.retain({ proposal: proposal({ statement: '   ' }), meta: meta(), nowMs: NOW }),
    error => error instanceof TypeError && /a memory statement must be a non-empty string/.test(error.message),
  )
  await assert.rejects(
    () => fabric.retain({ proposal: proposal({ sources: undefined }), meta: meta(), nowMs: NOW }),
    error => error instanceof TypeError && /needs a sources array/.test(error.message),
  )
  await assert.rejects(
    () => fabric.retain({ proposal: proposal({ confidence: 2 }), meta: meta(), nowMs: NOW }),
    error => error instanceof TypeError && /between 0 and 1/.test(error.message),
  )
})

test('the claim key is the scope, the kind, and the normalized statement', () => {
  assert.equal(
    core.memoryClaimKey(WORKSPACE, 'fact', '  A  Claim '),
    core.memoryClaimKey(WORKSPACE, 'fact', 'a claim'),
  )
  assert.notEqual(core.memoryClaimKey(WORKSPACE, 'fact', 'a claim'), core.memoryClaimKey(WORKSPACE, 'decision', 'a claim'))
  assert.notEqual(core.memoryClaimKey(WORKSPACE, 'fact', 'a claim'), core.memoryClaimKey(OTHER_WORKSPACE, 'fact', 'a claim'))
})

// ---------------------------------------------------------------------------
// §49, §33 — findings of the independent review (2026-09-20)
// ---------------------------------------------------------------------------

test('a required scope does not degrade because an optional scope shares its provider', async () => {
  const disabled = memoryNative.createDisabledMemoryProvider()
  const fabric = fabricOver([['disabled', disabled]], [
    route('workspace', 'disabled', true),
    route('role', 'disabled', false),
  ])
  // §49 lets a read degrade only where the route says memory is optional. One
  // provider serving both scopes must not let the optional scope's allowance
  // cover the required one — and the answer must not depend on scope order.
  const mixed = await fabric.recall({ scopes: [WORKSPACE, ROLE], nowMs: NOW })
  assertRefusal(mixed, 'provider-unavailable', 'ADAPTER_UNAVAILABLE')
  const reversed = await fabric.recall({ scopes: [ROLE, WORKSPACE], nowMs: NOW })
  assertRefusal(reversed, 'provider-unavailable', 'ADAPTER_UNAVAILABLE')
  const optionalOnly = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW })
  assert.equal(optionalOnly.ok, true)
  assert.equal(optionalOnly.degraded, true, 'the optional scope on its own still degrades')
  const provider = core.createMemoryContextProvider({ fabric, now: () => NOW })
  await assert.rejects(
    () => provider.discover({ scopes: [{ kind: 'workspace', id: 'w1' }, { kind: 'role', id: 'backend-developer' }] }),
    error => error.code === 'ADAPTER_UNAVAILABLE' && /is unavailable/.test(error.message),
    'discovery must fail loudly rather than propose nothing for a required scope',
  )
})

test('a degraded answer names every scope it covers', async () => {
  const disabled = memoryNative.createDisabledMemoryProvider()
  const fabric = fabricOver([['disabled', disabled]], [
    route('workspace', 'disabled', true),
    route('task', 'disabled', true),
  ])
  const recalled = await fabric.recall({ scopes: [WORKSPACE, TASK], nowMs: NOW })
  assert.equal(recalled.ok, true)
  const degraded = recalled.diagnostics.filter(entry => entry.code === 'degraded')
  assert.deepEqual(
    degraded.map(entry => entry.scope.type).sort(),
    ['task', 'workspace'],
    'one diagnostic per scope the degraded answer covers',
  )
})

test('reflection against a provider that never answers is a refusal, not a thrown error', async () => {
  const hanging = {
    capabilities: () => new Promise(() => {}),
    retain: () => new Promise(() => {}),
    recall: () => new Promise(() => {}),
    health: async () => ({ available: true }),
  }
  const fabric = fabricOver([['slow', hanging]], [route('workspace', 'slow', true)], { policy: { timeoutMs: 5 } })
  const reflected = await fabric.reflect({ scope: WORKSPACE, nowMs: NOW })
  assertRefusal(reflected, 'timeout', 'ADAPTER_UNAVAILABLE')
  assert.deepEqual(reflected.diagnostics.map(entry => entry.code), ['timeout'])
  assert.ok(fabric.diagnostics().some(entry => entry.code === 'timeout'), 'and the fabric recorded it')
})

test('reflection against a disabled provider is refused with the §42 code and a diagnostic', async () => {
  const disabled = memoryNative.createDisabledMemoryProvider()
  const fabric = fabricOver([['disabled', disabled]], [route('workspace', 'disabled', true)])
  const reflected = await fabric.reflect({ scope: WORKSPACE, nowMs: NOW })
  assertRefusal(reflected, 'provider-unavailable', 'ADAPTER_UNAVAILABLE')
  assert.equal(reflected.diagnostics[0].code, 'disabled')
})

test('the fabric-level limit returns exactly that many records, in the documented order', async () => {
  const { fabric } = nativeFabric()
  await retain(fabric, { statement: 'First claim.', trust: 'medium' })
  await retain(fabric, { statement: 'Second claim.', trust: 'very-high' }, { nowMs: NOW + 100 })
  await retain(fabric, { statement: 'Third claim.', trust: 'very-high' }, { nowMs: NOW + 200 })
  const all = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW + 300 })
  assert.equal(all.records.length, 3)
  const one = await fabric.recall({ scopes: [WORKSPACE], limit: 1, nowMs: NOW + 300 })
  assert.deepEqual(one.records.map(record => record.id), all.records.slice(0, 1).map(record => record.id))
  const two = await fabric.recall({ scopes: [WORKSPACE], limit: 2, nowMs: NOW + 300 })
  assert.deepEqual(two.records.map(record => record.id), all.records.slice(0, 2).map(record => record.id))
})

test('a claim held by a stale record is published anew rather than reinforced', async () => {
  const { native, fabric } = nativeFabric()
  const first = await retain(fabric)
  const stale = await fabric.transition({ id: first.record.id, to: 'stale', meta: meta(), nowMs: NOW + 10 })
  assert.equal(stale.ok, true)
  const again = await retain(fabric, {}, { nowMs: NOW + 20 })
  assert.equal(again.created, true, 'a stale record no longer holds its claim')
  assert.equal(again.reinforced, false)
  assert.notEqual(again.record.id, first.record.id)
  assert.equal(again.record.status, 'active')
  assert.equal(native.find(first.record.id).status, 'stale', 'the stale record is left where it was')
  const recalled = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW + 30 })
  assert.deepEqual(
    recalled.records.map(record => record.id),
    [again.record.id],
  )
})

test('an immediate proposal does not reinforce the Candidate that was waiting on it', async () => {
  const { native, fabric } = nativeFabric()
  const staged = await retain(fabric, { validation: 'staged' })
  const immediate = await retain(fabric, {}, { nowMs: NOW + 10 })
  assert.equal(immediate.created, true, 'the caller asked for validation now and must not be told it happened')
  assert.equal(immediate.reinforced, false)
  assert.equal(immediate.record.status, 'active')
  assert.deepEqual(immediate.superseded, [staged.record.id])
  assert.equal(native.find(staged.record.id).status, 'superseded')
  const recalled = await fabric.recall({ scopes: [WORKSPACE], nowMs: NOW + 20 })
  assert.deepEqual(
    recalled.records.map(record => record.id),
    [immediate.record.id],
  )
})

test('materialization refuses a record whose window closed after it was proposed', async () => {
  let clock = NOW
  const { fabric } = nativeFabric()
  const written = await retain(fabric, { validity: { until: NOW + 10 } })
  const provider = core.createMemoryContextProvider({ fabric, now: () => clock })
  const candidates = await provider.discover({ scopes: [{ kind: 'workspace', id: 'w1' }], nowMs: NOW })
  assert.equal(candidates.length, 1, 'the record is proposed while its window is open')
  clock = NOW + 50
  await assert.rejects(
    () => provider.materialize({ uri: contracts.memoryUri(written.record.id), level: 'L2' }),
    error => error.code === 'TASK_CONFLICT' && /not served: outside-validity/.test(error.message),
    'the lifecycle check on the materialization path is the one that can fail',
  )
})

test('two fabrics over one provider both retain', async () => {
  const native = memoryNative.createNativeMemoryProvider()
  const routes = [route('workspace', 'native')]
  const first = fabricOver([['native', native]], routes)
  const second = fabricOver([['native', native]], routes)
  const written = await retain(first)
  const other = await retain(second, { statement: 'A claim from the second fabric.' })
  assert.notEqual(other.record.id, written.record.id, 'a shared id counter would have collided here')
  assert.equal(native.records().length, 2)
})

test('a fresh fabric resolves a record the provider already holds', async () => {
  const native = memoryNative.createNativeMemoryProvider()
  const routes = [route('workspace', 'native')]
  const author = fabricOver([['native', native]], routes)
  const written = await retain(author)
  const reader = fabricOver([['native', native]], routes)
  const resolved = await reader.resolve({ id: written.record.id, nowMs: NOW })
  assert.equal(resolved.ok, true, resolved.message)
  assert.equal(resolved.record.statement, written.record.statement)
  const unknown = await reader.resolve({ id: 'mem-404', nowMs: NOW })
  assertRefusal(unknown, 'invalid-ref', 'TASK_CONFLICT')
})

test('the native provider refuses a replace that moves the record to another scope', async () => {
  const native = memoryNative.createNativeMemoryProvider()
  const fabric = fabricOver([['native', native]], [route('workspace', 'native')])
  const { record } = await retain(fabric)
  await assert.rejects(
    () => native.retain({ record: { ...record, scope: OTHER_WORKSPACE }, mode: 'replace' }),
    error => error.code === 'TASK_CONFLICT' && /holds other content/.test(error.message),
    'a replace may publish a new state, never a different record under an old id',
  )
  await assert.rejects(
    () => native.retain({ record: { ...record, trust: 'low' }, mode: 'replace' }),
    error => error.code === 'TASK_CONFLICT',
  )
  const moved = await native.retain({ record: { ...record, status: 'stale' }, mode: 'replace' })
  assert.equal(moved.record.status, 'stale', 'a state change is what replace is for')
})

test('the hash a candidate publishes is the hash materialization returns', async () => {
  const { fabric } = nativeFabric()
  const written = await retain(fabric)
  const provider = core.createMemoryContextProvider({ fabric, now: () => NOW })
  const uri = contracts.memoryUri(written.record.id)
  const candidate = (await provider.discover({ scopes: [{ kind: 'workspace', id: 'w1' }] }))[0]
  const body = await provider.materialize({ uri, level: 'L2' })
  assert.equal(
    body.contentHash,
    candidate.contentHash,
    '§21.5 has the caller state the hash it expects, so the two levels must agree',
  )
  const expected = await provider.materialize({ uri, level: 'L2', expectedContentHash: candidate.contentHash })
  assert.equal(expected.contentHash, candidate.contentHash)
})

test('a snapshot that asks for the full content of a memory item materializes it', async () => {  const { fabric } = nativeFabric()
  const written = await retain(fabric)
  const uri = contracts.memoryUri(written.record.id)
  const provider = core.createMemoryContextProvider({ fabric, now: () => NOW })
  const binding = { provider: provider.provider, port: provider }
  const discovery = await core.discoverContext({
    providers: [binding],
    request: { scopes: [{ kind: 'workspace', id: 'w1' }] },
    nowMs: NOW,
  })
  const decision = await core.materializeContextSnapshot({
    attemptId: 'attempt-1',
    taskId: 'task-1',
    workspaceId: 'w1',
    createdAt: NOW,
    revisions: { task: 7, role: 3, blueprint: 11, workflow: 2 },
    route: {
      route: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
      role: 'preferred',
      contextWindow: 128_000,
      evaluations: [],
    },
    toolSurface: [],
    discovery,
    providers: [binding],
    registry: core.createContextSnapshotRevisionRegistry(),
    requestedFullContent: [uri],
  })
  assert.equal(decision.kind, 'materialized', decision.message)
  const item = decision.snapshot.items.find(entry => entry.uri === uri)
  assert.equal(item.level, 'L2')
  assert.match(item.content.text, /sources: session session:abc#turn-4 @9/)
  assert.equal(
    item.content.text.includes('TRANSCRIPT-MARKER'),
    false,
    'and the body still carries no payload of its source',
  )
})

// ---------------------------------------------------------------------------
// §49, §33 — findings of the fixes-verification pass (2026-09-20)
// ---------------------------------------------------------------------------

/** A provider that answers until a test takes it down, around another provider. */
function flakyProvider(port) {
  let available = true
  return {
    capabilities: () => port.capabilities(),
    retain: request => port.retain(request),
    recall: request => port.recall(request),
    reflect: request => port.reflect(request),
    resolve: ref => port.resolve(ref),
    health: async () => (available ? { available: true } : { available: false, reason: 'down', detail: 'taken down by the test' }),
    goDown: () => {
      available = false
    },
  }
}

test('a reference whose provider went down is an outage, not an invalid ref', async () => {
  const native = memoryNative.createNativeMemoryProvider()
  const flaky = flakyProvider(native)
  const fabric = fabricOver([['flaky', flaky]], [route('workspace', 'flaky')])
  const written = await retain(fabric)
  flaky.goDown()
  const refused = await fabric.resolve({ id: written.record.id, nowMs: NOW })
  assertRefusal(refused, 'provider-unavailable', 'ADAPTER_UNAVAILABLE')
  assert.match(refused.message, /is unavailable/)
  assert.equal(refused.diagnostics[0].code, 'provider-unavailable')
})

test('an unknown reference stays an invalid ref even when another provider is down', async () => {
  const healthy = memoryNative.createNativeMemoryProvider({ provider: 'healthy' })
  const flaky = flakyProvider(memoryNative.createNativeMemoryProvider({ provider: 'flaky' }))
  const fabric = fabricOver(
    [
      ['healthy', healthy],
      ['flaky', flaky],
    ],
    [route('workspace', 'healthy'), route('task', 'flaky')],
  )
  flaky.goDown()
  const unknown = await fabric.resolve({ id: 'mem-404', nowMs: NOW })
  assertRefusal(unknown, 'invalid-ref', 'TASK_CONFLICT')
  assert.deepEqual(
    unknown.diagnostics.map(entry => entry.code),
    ['provider-unavailable', 'invalid-ref'],
    'the provider that could not be asked is named, so the uncertainty is visible without a retry loop',
  )
  const typo = await fabric.retain({ proposal: proposal({ supersedes: ['mem-405'] }), meta: meta(), nowMs: NOW })
  assertRefusal(typo, 'invalid-ref', 'TASK_CONFLICT')
})

test('a refusal carries the same diagnostics whichever order the scopes are listed in', async () => {
  const disabled = memoryNative.createDisabledMemoryProvider()
  const fabric = fabricOver([['disabled', disabled]], [
    route('workspace', 'disabled', true),
    route('task', 'disabled', true),
    route('role', 'disabled', false),
  ])
  const first = await fabric.recall({ scopes: [WORKSPACE, ROLE, TASK], nowMs: NOW })
  const second = await fabric.recall({ scopes: [ROLE, TASK, WORKSPACE], nowMs: NOW })
  assertRefusal(first, 'provider-unavailable', 'ADAPTER_UNAVAILABLE')
  assertRefusal(second, 'provider-unavailable', 'ADAPTER_UNAVAILABLE')
  assert.deepEqual(
    first.diagnostics.map(entry => entry.code),
    second.diagnostics.map(entry => entry.code),
  )
  assert.deepEqual(
    first.diagnostics.map(entry => entry.scope.type),
    second.diagnostics.map(entry => entry.scope.type),
  )
})

test('a replace cannot move when a record was retained', async () => {
  const native = memoryNative.createNativeMemoryProvider()
  const fabric = fabricOver([['native', native]], [route('workspace', 'native')])
  const { record } = await retain(fabric)
  await assert.rejects(
    () => native.retain({ record: { ...record, retainedAt: 999_999 }, mode: 'replace' }),
    error => error.code === 'TASK_CONFLICT' && /holds other content/.test(error.message),
    'recall orders by retention time, so it is content and not lifecycle state',
  )
  const stateOnly = await native.retain({ record: { ...record, status: 'stale' }, mode: 'replace' })
  assert.equal(stateOnly.record.status, 'stale')
  assert.equal(stateOnly.record.retainedAt, record.retainedAt)
})
