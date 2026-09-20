/**
 * Skill registry and its context provider (architecture §21.2, §21.5, §24,
 * §35, §36; §62 item 20).
 *
 * The suite drives the registry and the provider against literal definitions,
 * so every branch is decided by data rather than by a model: a skill scoped
 * elsewhere, a candidate that was never activated, one whose declared
 * compatibility the runtime does not offer, a definition revised after an
 * attempt froze its revision, and a write attempted by the memory provider.
 *
 * Three acceptance properties of the card are checked here as behaviour rather
 * than as a claim: discovery never carries the body, the fabric freezes a
 * numeric skill revision the summary and the body agree on, and a running
 * attempt keeps what it froze when the skill moves on.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { adapterTesting, contracts, core } from './lib/fixtures.mjs'

/** The development route of §62 item 7, with a window the budget can be cut from. */
const WINDOW = 128_000

/** Materialization time. Required, not defaulted: a decision against an invented clock is another decision. */
const NOW = 1_000

/** The revisions a §21.7 snapshot freezes. */
const REVISIONS = { task: 7, role: 3, blueprint: 11, workflow: 2 }

/** Scopes every fixture skill is requested in unless a test says otherwise. */
const SCOPE = Object.freeze([Object.freeze({ kind: 'workspace', id: 'w1' })])

/** The one actor §8 lets write the skill registry. */
const ACTOR = 'skill-registry'

/** Operation identity of a registry write. */
function meta(overrides = {}) {
  return core.defineOperationMeta({ operationId: 'op-skill', correlationId: 'corr-skill', ...overrides })
}

/** Time the registry's transitions are stamped with. */
let clock = NOW

/** One §24 skill definition, with the defaults a test usually wants. */
function definition(overrides = {}) {
  const id = overrides.id ?? 'testing'
  return {
    id,
    name: overrides.name ?? id,
    description: 'Run the tests before claiming a change works',
    scopes: SCOPE,
    version: '1.0.0',
    trust: 'trusted',
    compatibility: {},
    revision: 'r1',
    usage: 'Load when a change has to be verified',
    constraints: ['never mark work accepted from self-review'],
    body: '# Testing\n\nRun the narrowest check that can falsify the change, then widen it by risk.',
    mediaType: 'text/markdown',
    provenance: ['experience:MW-016'],
    ...overrides,
  }
}

/** A registry holding one admitted skill, and the definition it was admitted from. */
function registryWith(overrides = {}) {
  const registry = core.createSkillRegistry()
  const skill = definition(overrides)
  const admitted = registry.admit({ skills: [skill], actors: [ACTOR], meta: meta(), nowMs: NOW })
  assert.equal(admitted.ok, true, 'the fixture admission must succeed')
  return { registry, skill, admitted }
}

/** Move one skill through the registry and assert the transition was accepted. */
function transition(registry, id, to, overrides = {}) {
  const result = registry.transition({
    id,
    to,
    actors: overrides.actors ?? [ACTOR],
    meta: overrides.meta ?? meta(),
    nowMs: overrides.nowMs ?? (clock += 1),
    ...(overrides.expectedRevision === undefined ? {} : { expectedRevision: overrides.expectedRevision }),
    ...(overrides.validFrom === undefined ? {} : { validFrom: overrides.validFrom }),
    ...(overrides.validUntil === undefined ? {} : { validUntil: overrides.validUntil }),
  })
  if (overrides.expect === undefined) assert.equal(result.ok, true, `transition to "${to}" must be accepted`)
  return result
}

/**
 * A provider over one registry, bound the way the fabric binds a port.
 *
 * The clock is injected and frozen at {@link NOW} by default: the provider's
 * validity decisions then depend on the fixture time rather than on the wall
 * clock, which is what makes them reproducible.
 */
function providerFor(registry, options = {}) {
  const provider = core.createSkillContextProvider({ now: () => NOW, registry, ...options })
  return { provider, binding: { provider: provider.provider, port: provider } }
}

/**
 * The per-skill revisions §21.7 records on a snapshot: `{ [skillId]: Revision }`,
 * which is what the fabric's `skillRevisions` input is — not a member of §35's
 * revision family set.
 */
function frozenRevisions(provider, input = { scopes: SCOPE, nowMs: NOW }) {
  return provider.skillRevisions(input)
}

/**
 * Discover and materialize in one call, the way an admission path would.
 *
 * One revision registry per call with `options.registry`: §35 mints a snapshot
 * revision from the canonical context, so two attempts that froze different
 * skill revisions are two states only when they are numbered by the same
 * registry.
 */
async function fabricate(registry, options = {}) {
  const { provider, binding } = providerFor(registry, options.providerOptions ?? {})
  const request = { scopes: options.scopes ?? SCOPE }
  const discovery = await core.discoverContext({ providers: [binding], request, nowMs: options.nowMs ?? NOW })
  const decision = await core.materializeContextSnapshot({
    attemptId: options.attemptId ?? 'attempt-1',
    taskId: 'task-1',
    workspaceId: 'w1',
    createdAt: NOW,
    revisions: REVISIONS,
    skillRevisions: frozenRevisions(provider, options.skillRevisionsInput ?? { scopes: request.scopes, nowMs: NOW }),
    route: {
      route: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
      role: 'preferred',
      contextWindow: WINDOW,
      evaluations: [],
    },
    toolSurface: ['read', 'write'],
    discovery,
    providers: [binding],
    registry: options.registry ?? core.createContextSnapshotRevisionRegistry(),
    ...(options.requestedFullContent === undefined ? {} : { requestedFullContent: options.requestedFullContent }),
  })
  return { provider, binding, discovery, decision }
}

test('a skill is admitted as a candidate and is not context yet', () => {
  const { registry } = registryWith()
  const current = registry.current('testing')
  assert.ok(current !== undefined)
  assert.equal(current.revision.state.status, 'candidate')
  assert.equal(current.current, true)
  assert.equal(current.revision.snapshotRevision, 1, 'the first definition of the process mints revision 1')
})

test('admitting the same definition twice mints one revision, a different one mints the next', () => {
  const { registry } = registryWith()
  const again = registry.admit({ skills: [definition()], actors: [ACTOR], meta: meta(), nowMs: NOW })
  assert.equal(again.ok, true)
  assert.equal(again.admitted[0].revision.snapshotRevision, 1, 'the same definition keeps the number it was admitted at')

  const revised = registry.admit({ skills: [definition({ revision: 'r2', body: '# Testing\n\nRevised.' })], actors: [ACTOR], meta: meta(), nowMs: NOW })
  assert.equal(revised.ok, true)
  assert.equal(revised.admitted[0].revision.snapshotRevision, 2, 'a revised definition mints the next number')
})

test('a definition that does not declare a field of §24 is refused before it is stored', () => {
  const registry = core.createSkillRegistry()
  assert.throws(
    () => registry.admit({ skills: [{ ...definition(), smuggled: true }], actors: [ACTOR], meta: meta() }),
    /carries "smuggled", which §24 does not declare/u,
  )
  assert.deepEqual(registry.list(), [], 'a refused admission leaves the registry empty')
})

test('a name is a label, not an identity: two skills may share one', () => {
  const registry = core.createSkillRegistry()
  const first = registry.admit({
    skills: [definition({ id: 'author-a/testing', name: 'testing', description: 'Author A skill' })],
    actors: [ACTOR],
    meta: meta(),
    nowMs: NOW,
  })
  assert.equal(first.ok, true)
  transition(registry, 'author-a/testing', 'active')

  // A second, unrelated skill that happens to be called the same thing.
  const second = registry.admit({
    skills: [definition({ id: 'author-b/testing', name: 'testing', description: 'Author B skill, unrelated' })],
    actors: [ACTOR],
    meta: meta(),
    nowMs: NOW,
  })
  assert.equal(second.ok, true, 'the second skill is admitted, not merged into the first')
  assert.deepEqual(
    registry.list().map(view => [view.revision.id, view.revision.definition.name]),
    [
      ['author-a/testing', 'testing'],
      ['author-b/testing', 'testing'],
    ],
    'two ids, one shared label, two separate chains',
  )
  assert.equal(registry.revision('author-a/testing', 'r1').current, true, 'the served skill is still the first one')
  assert.equal(registry.revision('author-b/testing', 'r1').current, true, 'and the second skill resolves inside its own chain')
  assert.deepEqual(
    registry.list().map(view => view.revision.id),
    ['author-a/testing', 'author-b/testing'],
    'two chains, not one',
  )
  assert.equal(core.skillUri('author-a/testing', 'r1'), 'skill:author-a/testing:r1')
})

test('an id or a revision that cannot be addressed in a uri is refused at admission', () => {
  const registry = core.createSkillRegistry()
  for (const [field, value] of [
    ['id', 'ns:testing'],
    ['revision', 'v1:beta'],
    ['version', '1.0:beta'],
  ]) {
    assert.throws(
      () => registry.admit({ skills: [definition({ [field]: value })], actors: [ACTOR], meta: meta() }),
      /may not contain ":"/u,
      `a colon in "${field}" must be refused where it can still be renamed`,
    )
  }
  assert.deepEqual(registry.list(), [], 'nothing was stored')
})

test('the §24 lifecycle admits only the moves it declares', () => {
  const { registry } = registryWith()
  const illegal = transition(registry, 'testing', 'stale', { expect: 'refuse' })
  assert.equal(illegal.ok, false)
  assert.equal(illegal.code, 'TASK_CONFLICT')
  assert.equal(registry.current('testing').revision.state.status, 'candidate', 'a refused transition leaves the status alone')

  transition(registry, 'testing', 'active')
  assert.equal(registry.current('testing').revision.state.status, 'active')
  transition(registry, 'testing', 'stale')
  transition(registry, 'testing', 'active', { expectedRevision: 'r1' })
  assert.equal(registry.current('testing').revision.state.status, 'active')
  transition(registry, 'testing', 'archived')
  assert.equal(registry.current('testing').revision.state.status, 'archived')

  const revived = transition(registry, 'testing', 'active', { expect: 'refuse' })
  assert.equal(revived.ok, false)
  assert.equal(revived.code, 'TASK_CONFLICT')
  assert.deepEqual(core.skillTransitionTargets('archived'), [], 'archived is terminal')
})

test('a lifecycle transition does not rename the revision a caller pinned', () => {
  const { registry } = registryWith()
  transition(registry, 'testing', 'active')
  const current = registry.current('testing')
  assert.equal(current.revision.definition.revision, 'r1', 'the definition revision is unchanged by the status')
  assert.equal(current.revision.snapshotRevision, 1, 'a transition mints no new §35 revision')
  assert.equal(registry.revision('testing', 'r1').revision.state.status, 'active', 'the old revision resolves to the new state')
})

test('an unsupported skill never activates, and one that is supported does', () => {
  const registry = core.createSkillRegistry({
    facts: { contractVersions: { memory: 'memory/v1' }, capabilities: { recall: true } },
  })
  registry.admit({
    skills: [definition({ id: 'unsupported', compatibility: { adapterKind: 'memory', contractVersion: 'memory/v2' } })],
    actors: [ACTOR],
    meta: meta(),
    nowMs: NOW,
  })
  const refused = transition(registry, 'unsupported', 'active', { expect: 'refuse' })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'CONTRACT_MISMATCH', 'the adapter contract moved, which is not the same as a missing capability')
  assert.match(refused.message, /needs "memory" at contract "memory\/v2" and the runtime holds "memory\/v1"/u)
  assert.equal(registry.current('unsupported').revision.state.status, 'candidate', 'a refused activation leaves the status alone')

  registry.admit({
    skills: [definition({ id: 'supported', compatibility: { adapterKind: 'memory', contractVersion: 'memory/v1', requires: { recall: true } } })],
    actors: [ACTOR],
    meta: meta(),
    nowMs: NOW,
  })
  transition(registry, 'supported', 'active')
  assert.equal(registry.current('supported').revision.state.status, 'active')
})

test('a requirement the runtime does not declare is not assumed to hold', () => {
  const registry = core.createSkillRegistry()
  registry.admit({
    skills: [definition({ id: 'reflector', compatibility: { adapterKind: 'memory', contractVersion: 'memory/v1', requires: { reflect: true } } })],
    actors: [ACTOR],
    meta: meta(),
    nowMs: NOW,
  })
  registry.observeFacts({ contractVersions: { memory: 'memory/v1' }, capabilities: { recall: true } })
  const refused = transition(registry, 'reflector', 'active', { expect: 'refuse' })
  assert.equal(refused.code, 'CAPABILITY_UNSUPPORTED', 'the contract matched; the capability was never granted')
  assert.match(refused.message, /requires the capability "reflect", which was not granted/u)
  assert.equal(
    contracts.skillCompatibilityHolds({ adapterKind: 'memory' }, { contractVersions: { memory: 'memory/v1' } }),
    false,
    'a kind without a contract version names a dependency that cannot be checked',
  )
  assert.equal(
    core.skillRequirementUnmet({ adapterKind: 'memory' }, { contractVersions: { memory: 'memory/v1' } }).reason,
    'incompatible',
    'and the reason names the contract, not a capability',
  )
})

test('a transition names the revision it moves, and an unknown one is refused', () => {
  const { registry } = registryWith()
  registry.admit({ skills: [definition({ revision: 'r2' })], actors: [ACTOR], meta: meta(), nowMs: NOW })
  assert.equal(registry.revision('testing', 'r2').revision.definition.revision, 'r2')
  assert.equal(registry.revision('testing', 'r2').current, true, 'nothing is served, so the newest revision is what a reader resolves')

  const unknown = transition(registry, 'never-admitted', 'active', { expect: 'refuse' })
  assert.equal(unknown.code, 'STALE_REVISION')
  const missing = transition(registry, 'testing', 'active', { expectedRevision: 'r9', expect: 'refuse' })
  assert.equal(missing.code, 'STALE_REVISION')
  assert.match(missing.message, /holds no revision "r9"/u)

  // A caller that pins a revision moves that revision; a caller that pins none
  // moves the one being served, and with nothing served that is the newest.
  const pinned = transition(registry, 'testing', 'archived', { expectedRevision: 'r1' })
  assert.equal(pinned.view.revision.definition.revision, 'r1')
  assert.equal(registry.current('testing').revision.definition.revision, 'r2', 'archiving r1 left r2 to resolve')
  assert.equal(registry.current('testing').revision.state.status, 'candidate')
})

test('the memory provider cannot write the skill registry', () => {
  const registry = core.createSkillRegistry()
  const written = registry.admit({ skills: [definition()], actors: ['memory-provider'], meta: meta() })
  assert.equal(written.ok, false)
  assert.equal(written.code, 'SECURITY_DENIED')
  assert.deepEqual(registry.list(), [], 'a recall is not a skill: nothing was stored')

  registry.admit({ skills: [definition()], actors: [ACTOR], meta: meta(), nowMs: NOW })
  transition(registry, 'testing', 'active')
  const moved = transition(registry, 'testing', 'archived', { actors: ['fast-learner'], expect: 'refuse' })
  assert.equal(moved.code, 'SECURITY_DENIED')
  assert.equal(registry.current('testing').revision.state.status, 'active', 'an unauthorized actor changed nothing')
  assert.equal(contracts.AUTHORITY_MATRIX['skills.registry'].owners.includes('memory-provider'), false)
})

test('discovery discloses scope, metadata, and no body', async () => {
  const { registry } = registryWith()
  transition(registry, 'testing', 'active')
  const { provider } = providerFor(registry)

  const candidates = await provider.discover({ scopes: SCOPE })
  assert.equal(candidates.length, 1)
  const [candidate] = candidates
  assert.equal(candidate.kind, 'skill')
  assert.equal(candidate.source, provider.provider)
  assert.equal(candidate.level, 'L1', '§21.2: discovery is an overview, not the body')
  assert.equal(candidate.uri, core.skillUri('testing', 'r1'))
  assert.equal(candidate.revision, 'r1')
  assert.equal(candidate.trust, 'trusted')
  assert.deepEqual([...candidate.scopes], [...SCOPE])
  const text = candidate.content.text
  assert.match(text, /testing — Run the tests/u)
  assert.match(text, /usage:/u)
  assert.doesNotMatch(text, /narrowest check that can falsify/u, 'the body must not be on a candidate')

  const { provider: l0 } = providerFor(registry, { defaultLevel: 'L0' })
  const [abstract] = await l0.discover({ scopes: SCOPE })
  assert.equal(abstract.level, 'L0')
  assert.doesNotMatch(abstract.content.text, /usage:/u, 'L0 is the identity and a one-line purpose')

  assert.throws(
    () => core.createSkillContextProvider({ registry, defaultLevel: 'L2' }),
    /discovery discloses L0\/L1 only/u,
    'a provider cannot be built to disclose the body',
  )
})

test('discovery serves only Active skills, and says why each other one was left out', async () => {
  const registry = core.createSkillRegistry()
  registry.admit({
    skills: [
      definition({ id: 'elsewhere', scopes: [{ kind: 'workspace', id: 'w9' }] }),
      definition({ id: 'active-one' }),
    ],
    actors: [ACTOR],
    meta: meta(),
    nowMs: NOW,
  })
  transition(registry, 'active-one', 'active')
  const { provider } = providerFor(registry)

  assert.deepEqual((await provider.discover({ scopes: SCOPE })).map(candidate => candidate.uri), [core.skillUri('active-one', 'r1')])

  const activation = provider.activation({ scopes: SCOPE, nowMs: clock + 10 })
  assert.equal(activation.served.length, 1)
  assert.equal(activation.served[0].definition.id, 'active-one')
  assert.equal(activation.observedAt, clock + 10)
  const reasons = new Map(activation.considered.map(entry => [entry.revision.id, entry.reason]))
  assert.deepEqual([...reasons.keys()].sort(), ['active-one', 'elsewhere'], 'every revision the registry holds is accounted for')
  assert.equal(reasons.get('elsewhere'), 'scope-mismatch')
  assert.equal(reasons.get('active-one'), undefined)
  assert.match(activation.considered.find(entry => entry.revision.id === 'elsewhere').detail, /scoped elsewhere/u)

  assert.deepEqual(await provider.discover({ scopes: [{ kind: 'workspace', id: 'w9' }] }), [], 'the other workspace sees nothing of w1')
  assert.deepEqual(await provider.discover({ scopes: SCOPE, classes: ['memory'] }), [], 'the provider answers about skills only')
})

test('a skill outside its validity window is not served, and discovery sees the same window', async () => {
  const { registry } = registryWith()
  transition(registry, 'testing', 'active', { validFrom: NOW + 100, validUntil: NOW + 200 })
  const { provider } = providerFor(registry)

  const before = provider.activation({ scopes: SCOPE, nowMs: NOW + 50 })
  assert.equal(before.served.length, 0)
  assert.equal(before.considered[0].reason, 'outside-validity')
  assert.equal(provider.activation({ scopes: SCOPE, nowMs: NOW + 150 }).served.length, 1, 'inside the window it is served')
  assert.equal(provider.activation({ scopes: SCOPE, nowMs: NOW + 250 }).served.length, 0, 'after the window it is not')

  // discovery reads the same clock, so a window it cannot be inside yields
  // nothing — rather than a candidate from a clock nobody set.
  const { provider: outside } = providerFor(registry, { now: () => NOW + 50 })
  assert.deepEqual(await outside.discover({ scopes: SCOPE }), [], 'before the window discovery proposes nothing')
  assert.deepEqual(outside.skillRevisions({ scopes: SCOPE }), {}, 'and freezes nothing')

  const { provider: inside } = providerFor(registry, { now: () => NOW + 150 })
  assert.deepEqual((await inside.discover({ scopes: SCOPE })).map(candidate => candidate.uri), [core.skillUri('testing', 'r1')])
  assert.equal(inside.now(), NOW + 150, 'the pass can be read back and handed to skillRevisions')
  assert.deepEqual(
    inside.skillRevisions({ scopes: SCOPE, nowMs: inside.now() }),
    { testing: 1 },
    'the pass and the frozen revisions describe one moment',
  )
})

test('a body is served only by materialization, and only at L2', async () => {
  const { registry, skill } = registryWith()
  transition(registry, 'testing', 'active')
  const { provider } = providerFor(registry)
  const [candidate] = await provider.discover({ scopes: SCOPE })

  const body = await provider.materialize({ uri: candidate.uri, level: 'L2', expectedRevision: 'r1' })
  assert.equal(body.level, 'L2')
  assert.equal(body.revision, 'r1')
  assert.equal(body.content.text, skill.body)
  assert.equal(body.content.mediaType, 'text/markdown')
  assert.equal(body.contentHash, candidate.contentHash, 'the summary and the body describe one revision')
  assert.ok(body.estimatedTokens > 0, 'a body that states no estimate is still measured')
  assert.deepEqual(body.provenance.map(ref => ref.source), [provider.provider])

  await assert.rejects(() => provider.materialize({ uri: candidate.uri, level: 'L1' }), /served at L2 only/u)
  await assert.rejects(() => provider.materialize({ uri: 'skill:testing:r9', level: 'L2' }), /holds no revision/u)
  await assert.rejects(() => provider.materialize({ uri: 'not-a-skill-uri', level: 'L2' }), /not a skill uri/u)
  await assert.rejects(() => provider.materialize({ uri: candidate.uri, level: 'L2', expectedRevision: 'r2' }), /not "r2"/u)
  await assert.rejects(
    () => provider.materialize({ uri: candidate.uri, level: 'L2', expectedContentHash: 'fnv1a-deadbeef' }),
    /hashes to/u,
  )
})

test('a revised definition is a new revision, and the frozen one still answers', async () => {
  const { registry, skill } = registryWith()
  transition(registry, 'testing', 'active')
  const { provider } = providerFor(registry)
  const [frozen] = await provider.discover({ scopes: SCOPE })

  const revised = registry.admit({
    skills: [definition({ revision: 'r2', version: '2.0.0', body: '# Testing\n\nSecond edition.' })],
    actors: [ACTOR],
    meta: meta(),
    nowMs: NOW,
  })
  assert.equal(revised.ok, true, 'a later revision is admitted beside the served one')
  assert.equal(revised.admitted[0].revision.state.status, 'candidate', 'the newer revision starts where every revision starts')
  assert.equal(revised.admitted[0].current, false, 'a candidate behind a served revision is not what a reader resolves')
  assert.equal(registry.current('testing').revision.definition.revision, 'r1', 'the skill still serves the revision it was serving')
  assert.deepEqual(
    registry.list().map(view => [view.revision.definition.revision, view.revision.state.status]),
    [
      ['r1', 'active'],
      ['r2', 'candidate'],
    ],
    'the registry holds both revisions',
  )

  const stillFrozen = await provider.materialize({ uri: frozen.uri, level: 'L2', expectedRevision: frozen.revision })
  assert.equal(stillFrozen.revision, 'r1')
  assert.equal(stillFrozen.content.text, skill.body, 'the revision an attempt pinned is still the one served')
  assert.equal(stillFrozen.contentHash, frozen.contentHash)
  assert.deepEqual(
    (await provider.discover({ scopes: SCOPE })).map(candidate => candidate.uri),
    [core.skillUri('testing', 'r1')],
    'a candidate revision is not context: only the served revision is',
  )

  transition(registry, 'testing', 'archived')
  transition(registry, 'testing', 'active', { expectedRevision: 'r2' })
  assert.deepEqual((await provider.discover({ scopes: SCOPE })).map(candidate => candidate.uri), [core.skillUri('testing', 'r2')])
  assert.equal(provider.skillRevisions({ scopes: SCOPE, nowMs: NOW }).testing, 2, 'the newer definition is a newer §35 revision')
})

test('a second revision cannot be served while one already is', () => {
  const { registry } = registryWith()
  transition(registry, 'testing', 'active')
  const admitted = registry.admit({
    skills: [definition({ revision: 'r2', body: '# Testing\n\nSecond edition.' })],
    actors: [ACTOR],
    meta: meta(),
    nowMs: NOW,
  })
  assert.equal(admitted.ok, true, 'a candidate may wait beside a served revision')

  const taken = transition(registry, 'testing', 'active', { expectedRevision: 'r2', expect: 'refuse' })
  assert.equal(taken.ok, false)
  assert.equal(taken.code, 'TASK_CONFLICT')
  assert.match(taken.message, /is served at revision "r1"/u)
  assert.equal(registry.revision('testing', 'r2').revision.state.status, 'candidate', 'the refused activation changed nothing')

  transition(registry, 'testing', 'archived', { expectedRevision: 'r1' })
  assert.equal(registry.current('testing').revision.definition.revision, 'r2', 'retiring the served revision leaves the candidate to resolve')
  const served = transition(registry, 'testing', 'active', { expectedRevision: 'r2' })
  assert.equal(served.view.revision.state.status, 'active')
  assert.equal(served.view.current, true)
})

test('the fabric freezes one numeric skill revision per skill, and re-resolving keeps it', async () => {
  const { registry } = registryWith()
  transition(registry, 'testing', 'active')
  const first = await fabricate(registry)
  assert.equal(first.decision.kind, 'materialized')
  assert.deepEqual(first.decision.snapshot.skillRevisions, { testing: 1 })
  assert.deepEqual(first.provider.skillRevisions({ scopes: SCOPE, nowMs: NOW }), { testing: 1 }, 'the same definition resolves to the same number')

  const second = await fabricate(registry, { providerOptions: {} })
  assert.deepEqual(second.decision.snapshot.skillRevisions, first.decision.snapshot.skillRevisions)
  assert.equal(second.decision.snapshot.fingerprint, first.decision.snapshot.fingerprint, 'the same context is the same state')
  assert.equal(second.decision.snapshot.revision, first.decision.snapshot.revision, 'the snapshot keeps the revision it minted')
})

test('an update does not move a running attempt: its frozen revisions and body stay put', async () => {
  const { registry, skill } = registryWith()
  transition(registry, 'testing', 'active')
  const revisions = core.createContextSnapshotRevisionRegistry()
  const uri = core.skillUri('testing', 'r1')
  const running = await fabricate(registry, { registry: revisions, requestedFullContent: [uri] })
  assert.equal(running.decision.kind, 'materialized')
  const frozen = running.decision.snapshot
  assert.equal(frozen.items[0].content.text, skill.body, 'the attempt froze the body it was admitted with')

  // While nothing has moved, the same attempt context is the same state: the
  // provider resolves the same definition to the same §35 number.
  assert.deepEqual(running.provider.skillRevisions({ scopes: SCOPE, nowMs: NOW }), { testing: 1 })

  registry.admit({
    skills: [definition({ revision: 'r2', version: '2.0.0', body: '# Testing\n\nSecond edition.' })],
    actors: [ACTOR],
    meta: meta(),
    nowMs: NOW,
  })
  transition(registry, 'testing', 'archived')
  transition(registry, 'testing', 'active', { expectedRevision: 'r2' })

  assert.deepEqual(frozen.skillRevisions, { testing: 1 }, 'the running attempt holds the revision it froze')
  assert.equal(frozen.items[0].content.text, skill.body, 'and the body it froze, which nothing rewrites in place')
  assert.equal(frozen.items[0].revision, 'r1')
  assert.equal(running.provider.skillRevisions({ scopes: SCOPE, nowMs: NOW }).testing, 2, 'a new attempt resolves the new revision')

  const next = await fabricate(registry, { attemptId: 'attempt-2', registry: revisions, requestedFullContent: [core.skillUri('testing', 'r2')] })
  assert.equal(next.decision.kind, 'materialized')
  assert.deepEqual(next.decision.snapshot.skillRevisions, { testing: 2 })
  assert.notEqual(next.decision.snapshot.revision, frozen.revision, 'a different context is a different snapshot')
  assert.deepEqual(frozen.skillRevisions, { testing: 1 }, 'materializing the next attempt left the frozen one alone')

  // The frozen revision is what the attempt reads: r1 keeps answering for it,
  // while the skill itself has moved on and now serves r2.
  const verdict = core.verifyContextSnapshot({
    snapshot: frozen,
    observed: [
      { uri, revision: 'r1', contentHash: frozen.contentHashes[uri] },
      { uri: core.skillUri('testing', 'r2'), revision: 'r2', contentHash: next.decision.snapshot.contentHashes[core.skillUri('testing', 'r2')] },
    ],
  })
  assert.equal(verdict.kind, 'intact', 'the skill revision the attempt saw was not replaced under it')
  assert.equal(registry.current('testing').revision.definition.revision, 'r2', 'the registry itself moved to r2')
})

test('a skill the fabric asks for at L2 arrives as the body, and one it does not stays an overview', async () => {
  const { registry, skill } = registryWith()
  transition(registry, 'testing', 'active')
  const uri = core.skillUri('testing', 'r1')
  const materialized = await fabricate(registry, { requestedFullContent: [uri] })
  assert.equal(materialized.decision.kind, 'materialized')
  const [item] = materialized.decision.snapshot.items
  assert.equal(item.level, 'L2')
  assert.equal(item.content.text, skill.body)
  assert.equal(item.materializedAt, NOW)

  const overview = await fabricate(registry, { attemptId: 'attempt-2' })
  assert.equal(overview.decision.snapshot.items[0].level, 'L1', 'a skill nobody asked for keeps the level it was discovered at')
  assert.doesNotMatch(overview.decision.snapshot.items[0].content.text, /narrowest check/u)
})

test('a skill the fabric never discovered cannot be materialized into a snapshot', async () => {
  const { registry } = registryWith()
  transition(registry, 'testing', 'active')
  const { provider } = providerFor(registry)

  await assert.rejects(
    () => provider.materialize({ uri: core.skillUri('testing', 'r1'), level: 'L2', expectedContentHash: 'fnv1a-00000000' }),
    /hashes to/u,
  )
  const { decision } = await fabricate(registry, { attemptId: 'attempt-3' })
  assert.equal(decision.kind, 'materialized')
  assert.equal(decision.snapshot.dropped.length, 0, 'a served skill is selected, not dropped')
})

test('a memory record never becomes a skill candidate', async () => {
  const { registry } = registryWith()
  transition(registry, 'testing', 'active')
  const skill = providerFor(registry)
  const memory = new adapterTesting.FakeContextProvider({
    provider: 'memory-fabric',
    classes: ['memory'],
    items: [{ uri: 'memory:m-1', kind: 'memory', level: 'L1', revision: 'm1', contentHash: 'h-m1', trust: 'untrusted' }],
  })

  const discovery = await core.discoverContext({
    providers: [skill.binding, { provider: memory.provider, port: memory }],
    request: { scopes: SCOPE },
    nowMs: NOW,
  })
  // The memory provider legitimately proposes memory candidates — §21.1 says
  // every source proposes and the fabric decides — but a recall is classed as
  // memory and never as a skill, and the skill provider proposes only what the
  // registry holds.
  assert.deepEqual(
    new Map(discovery.candidates.map(candidate => [candidate.uri, candidate.kind])),
    new Map([
      [core.skillUri('testing', 'r1'), 'skill'],
      ['memory:m-1', 'memory'],
    ]),
  )
  assert.deepEqual(
    (await skill.provider.discover({ scopes: SCOPE })).map(candidate => candidate.uri),
    [core.skillUri('testing', 'r1')],
    'a memory record is not among the skill provider candidates',
  )
  assert.deepEqual(skill.provider.skillRevisions({ scopes: SCOPE, nowMs: NOW }), { testing: 1 }, 'only registry skills are frozen')
})

test('an untrusted skill is context the fabric renders as data, not as an instruction', async () => {
  const { registry } = registryWith({ trust: 'untrusted' })
  transition(registry, 'testing', 'active')
  const { provider, discovery, decision } = await fabricate(registry)
  assert.equal(decision.kind, 'materialized')
  const [item] = decision.snapshot.items
  assert.equal(item.placement, 'data', '§21.8: only an instruction class may be placed as one')
  assert.equal(core.isTrustedContextCandidate(discovery.candidates[0]), false, 'the trust a skill declares is what the fabric reads')
  assert.equal(provider.provider, 'skill-registry')
  const prompt = core.assembleContextPrompt(decision.snapshot)
  assert.match(prompt.sections.map(section => section.text).join('\n'), /<<<mywork:data>>>/u)
})

test('the §35 skill revision numbers are shared by the summary and the body', async () => {
  const { registry } = registryWith()
  transition(registry, 'testing', 'active')
  const { provider, binding } = providerFor(registry)
  const candidates = await provider.discover({ scopes: SCOPE })
  assert.deepEqual(
    Object.keys(candidates[0]).sort(),
    [
      'content',
      'contentHash',
      'estimatedTokens',
      'kind',
      'level',
      'materializeRef',
      'provenance',
      'revision',
      'scopes',
      'source',
      'trust',
      'uri',
    ],
    'the candidate carries the fields §21.4 declares and nothing the fabric drops',
  )
  assert.match(candidates[0].content.text, /status: active \| version: 1\.0\.0 \| trust: trusted/u, 'the served state is visible in the L1 text')

  const discovery = await core.discoverContext({ providers: [binding], request: { scopes: SCOPE }, nowMs: NOW })
  assert.deepEqual(discovery.providers.map(observation => [observation.provider, observation.candidates]), [[provider.provider, 1]])
  assert.deepEqual(discovery.providers[0].capabilities.classes, ['skill'])
  assert.deepEqual(discovery.providers[0].capabilities.levels, ['L0', 'L1', 'L2'])
  assert.equal(discovery.providers[0].capabilities.onDemandMaterialization, true)
})

test('a serve is counted, and counting it moves no pin', async () => {
  const { registry } = registryWith()
  transition(registry, 'testing', 'active')
  const { provider } = providerFor(registry)
  assert.equal(registry.current('testing').revision.state.servedCount, 0, 'activation alone is not a serve')
  assert.equal(registry.current('testing').revision.state.lastValidatedAt, clock, 'the activation timestamp is what it is')

  await provider.discover({ scopes: SCOPE })
  await provider.discover({ scopes: SCOPE })
  const served = registry.current('testing')
  assert.equal(served.revision.state.servedCount, 2, '§24 usage stats count the passes that proposed the skill')
  assert.equal(served.revision.snapshotRevision, 1, 'counting a serve mints no §35 revision')
  assert.equal(served.revision.fingerprint, registry.revision('testing', 'r1').revision.fingerprint, 'and leaves the identity alone')

  provider.activation({ scopes: SCOPE, nowMs: NOW })
  provider.skillRevisions({ scopes: SCOPE, nowMs: NOW })
  assert.equal(registry.current('testing').revision.state.servedCount, 2, 'diagnostics and pinning are not serving')

  const refused = registry.recordServe({ id: 'testing', revision: 'r9', meta: meta(), nowMs: NOW })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'STALE_REVISION', 'a revision nobody holds was not served')
})

test('a skill retired between discovery and the fetch hands over no body', async () => {
  const { registry } = registryWith()
  transition(registry, 'testing', 'active')
  const { provider, binding } = providerFor(registry)
  const uri = core.skillUri('testing', 'r1')
  const discovery = await core.discoverContext({ providers: [binding], request: { scopes: SCOPE }, nowMs: NOW })
  assert.equal(discovery.candidates.length, 1, 'the skill was proposed while it was Active')

  transition(registry, 'testing', 'archived')
  await assert.rejects(
    () => provider.materialize({ uri, level: 'L2' }),
    (error) => error.code === 'TASK_CONFLICT' && /is archived/u.test(error.message),
    'a retired skill is not served, whatever a caller knows about its uri',
  )

  // And the fabric refuses the whole snapshot rather than degrading quietly.
  const decision = await core.materializeContextSnapshot({
    attemptId: 'attempt-1',
    taskId: 'task-1',
    workspaceId: 'w1',
    createdAt: NOW,
    revisions: REVISIONS,
    skillRevisions: { testing: 1 },
    route: { route: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }, role: 'preferred', contextWindow: WINDOW, evaluations: [] },
    toolSurface: ['read'],
    discovery,
    providers: [binding],
    registry: core.createContextSnapshotRevisionRegistry(),
    requestedFullContent: [uri],
  })
  assert.notEqual(decision.kind, 'materialized', 'the body of a retired skill never reaches a snapshot')
  assert.equal(decision.reason, 'materialization-failed')
})

test('a skill that lost its compatibility hands over no body either', async () => {
  const registry = core.createSkillRegistry({ facts: { contractVersions: { memory: 'memory/v1' } } })
  registry.admit({
    skills: [definition({ compatibility: { adapterKind: 'memory', contractVersion: 'memory/v1' } })],
    actors: [ACTOR],
    meta: meta(),
    nowMs: NOW,
  })
  transition(registry, 'testing', 'active')
  const { provider } = providerFor(registry)
  const uri = core.skillUri('testing', 'r1')
  assert.equal((await provider.discover({ scopes: SCOPE })).length, 1)

  registry.observeFacts({ contractVersions: { memory: 'memory/v2' } })
  assert.equal((await provider.discover({ scopes: SCOPE })).length, 0, 'the pass stops proposing it')
  assert.equal(provider.activation({ scopes: SCOPE, nowMs: NOW }).considered[0].reason, 'incompatible')
  await assert.rejects(
    () => provider.materialize({ uri, level: 'L2' }),
    (error) => error.code === 'CONTRACT_MISMATCH' && /needs "memory" at contract/u.test(error.message),
    'and the body is refused for the same reason the proposal was',
  )
})

test('a skill that left its validity window hands over no body', async () => {
  const { registry } = registryWith()
  transition(registry, 'testing', 'active', { validFrom: NOW, validUntil: NOW + 10 })
  const { provider } = providerFor(registry, { now: () => NOW + 5 })
  const uri = core.skillUri('testing', 'r1')
  assert.equal((await provider.discover({ scopes: SCOPE })).length, 1)

  const { provider: late } = providerFor(registry, { now: () => NOW + 50 })
  assert.deepEqual(await late.discover({ scopes: SCOPE }), [])
  await assert.rejects(() => late.materialize({ uri, level: 'L2' }), (error) => error.code === 'TASK_CONFLICT' && /outside its validity window/u.test(error.message))
})
