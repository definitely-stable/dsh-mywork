/**
 * Workspace configuration acceptance (architecture §6, §52).
 *
 * The overlay chain must resolve by precedence rather than by input order, the
 * modes must keep namespaces apart, a layer the mode does not delegate to must
 * be refused instead of ignored, and cross-workspace dependency edges must not
 * pass the graph check.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { core, meta } from './lib/fixtures.mjs'

const M = meta()

/** One layer document. */
function layer(name, revision, values) {
  return { layer: name, revision, values }
}

/** Fresh revision registry per scenario, so numbering is asserted from 1. */
function registry() {
  return core.createConfigRevisionRegistry()
}

/** Pool policies in the shape of §14. */
function pools(overrides = {}) {
  return {
    pools: {
      workers: { minActive: 1, maxActive: 2 },
      reviewers: { minActive: 0, maxActive: 2 },
    },
    roles: { backend: { maxActive: 3 } },
    workspace: { maxWorkers: 4, maxReviewers: 2 },
    ...overrides,
  }
}

test('the §6.3 overlay chain resolves by precedence, not by input order', () => {
  const documents = [
    layer('task', 2, { blueprints: { 'bp-1': 5 } }),
    layer('platform-default', 1, { pools: pools() }),
    layer('global', 3, { teamId: 'core-team', workflowId: 'wf-1', memoryRoutes: ['global'] }),
    layer('team', 4, { blueprints: { 'bp-1': 3, 'bp-2': 9 } }),
    layer('workflow', 5, {}),
    layer('workspace', 6, { pools: { pools: { workers: { maxActive: 4 } } } }),
  ]
  const revisions = registry()
  const resolved = core.resolveWorkspaceConfig({ workspaceId: 'W-1', layers: documents, revisions }, M)
  assert.equal(resolved.ok, true, resolved.ok ? '' : resolved.error.message)
  const config = resolved.value

  assert.deepEqual(config.appliedLayers, ['platform-default', 'global', 'team', 'workspace', 'task'])
  assert.equal(config.mode, 'inherit', '§6.3 makes inherit the default')
  assert.equal(config.teamId, 'core-team')
  assert.equal(config.workflowId, 'wf-1')
  assert.deepEqual(config.blueprints, { 'bp-1': 5, 'bp-2': 9 }, 'the task layer beats the team layer, per key')
  assert.deepEqual(config.memoryRoutes, ['global'])
  assert.equal(config.pools.pools.workers.maxActive, 4, 'the workspace layer beats platform-default')
  assert.equal(config.pools.pools.workers.minActive, 1, 'a field the workspace did not set is inherited')
  assert.deepEqual(config.pools.roles, { backend: { maxActive: 3 } })
  assert.deepEqual(config.layerRevisions, {
    'platform-default': 1,
    global: 3,
    team: 4,
    workspace: 6,
    task: 2,
  })
  assert.equal(Object.isFrozen(config.pools), true, 'the resolved limits are immutable, not only by contract')
  assert.equal(Object.isFrozen(config.pools.pools.workers), true)
  assert.equal(Object.isFrozen(config.blueprints), true)
  assert.equal(Object.isFrozen(config.memoryRoutes), true)
  assert.throws(() => {
    config.pools.pools.workers.maxActive = 99
  }, TypeError)

  const shuffled = core.resolveWorkspaceConfig(
    { workspaceId: 'W-1', layers: [...documents].reverse(), revisions },
    M,
  )
  assert.equal(shuffled.ok, true)
  assert.deepEqual(shuffled.value, config, 'the resolved state depends on the chain, not on array order')
})

test('each mode resolves the namespaces §6.2 and §52 assign', () => {
  const sharedA = core.resolveWorkspaceConfig({ workspaceId: 'W-1', mode: 'global', revisions: registry() }, M)
  const sharedB = core.resolveWorkspaceConfig({ workspaceId: 'W-2', mode: 'global', revisions: registry() }, M)
  assert.equal(sharedA.ok, true)
  assert.equal(sharedB.ok, true)
  for (const key of ['teamWork', 'taskGraph', 'memory']) {
    assert.equal(sharedA.value.namespaces[key], 'global', `global mode shares ${key} (§6.1)`)
    assert.equal(sharedB.value.namespaces[key], 'global')
  }
  assert.notEqual(
    sharedA.value.namespaces.runtime,
    sharedB.value.namespaces.runtime,
    'the runtime overlay stays workspace-scoped in every mode (§52)',
  )

  const isolatedA = core.resolveWorkspaceConfig({ workspaceId: 'W-1', mode: 'isolated', revisions: registry() }, M)
  const isolatedB = core.resolveWorkspaceConfig({ workspaceId: 'W-2', mode: 'isolated', revisions: registry() }, M)
  assert.equal(isolatedA.ok, true)
  assert.equal(isolatedB.ok, true)
  assert.equal(isolatedA.value.namespaces.teamWork, 'ws:W-1')
  assert.equal(isolatedB.value.namespaces.memory, 'ws:W-2')
  for (const key of ['teamWork', 'taskGraph', 'memory', 'runtime']) {
    assert.notEqual(
      isolatedA.value.namespaces[key],
      isolatedB.value.namespaces[key],
      `an isolated workspace owns its ${key} namespace (§6.2)`,
    )
  }

  const inherited = core.resolveWorkspaceConfig(
    {
      workspaceId: 'W-1',
      layers: [layer('workspace', 1, { namespaces: { memory: 'team-memory' } })],
      revisions: registry(),
    },
    M,
  )
  assert.equal(inherited.ok, true, inherited.ok ? '' : inherited.error.message)
  assert.equal(inherited.value.namespaces.memory, 'team-memory', 'inherit lets the workspace pin its memory namespace')
  assert.equal(inherited.value.namespaces.taskGraph, 'global', 'unset namespaces keep the inherited value')
})

test('a layer the mode does not delegate to is refused, never ignored', () => {
  const inGlobal = [
    layer('global', 1, { teamId: 'core-team', pools: pools() }),
    layer('workspace', 2, { pools: { workspace: { maxWorkers: 9 } } }),
  ]
  const poolsRefusal = core.resolveWorkspaceConfig({ workspaceId: 'W-1', mode: 'global', layers: inGlobal, revisions: registry() }, M)
  assert.equal(poolsRefusal.ok, false)
  assert.equal(poolsRefusal.error.code, 'CONTRACT_MISMATCH')
  assert.equal(poolsRefusal.error.details.domain, 'pools')
  assert.equal(poolsRefusal.error.details.layer, 'workspace')

  const teamRefusal = core.resolveWorkspaceConfig(
    {
      workspaceId: 'W-1',
      mode: 'global',
      layers: [layer('global', 1, {}), layer('task', 2, { teamId: 'other-team' })],
      revisions: registry(),
    },
    M,
  )
  assert.equal(teamRefusal.ok, false)
  assert.equal(teamRefusal.error.code, 'CONTRACT_MISMATCH')
  assert.equal(teamRefusal.error.details.domain, 'teamId')

  const namespaceRefusal = core.resolveWorkspaceConfig(
    {
      workspaceId: 'W-1',
      mode: 'global',
      layers: [layer('workspace', 1, { namespaces: { memory: 'other-memory' } })],
      revisions: registry(),
    },
    M,
  )
  assert.equal(namespaceRefusal.ok, false)
  assert.equal(namespaceRefusal.error.code, 'CONTRACT_MISMATCH')
  assert.equal(namespaceRefusal.error.details.namespace, 'memory')

  const isolatedEscape = core.resolveWorkspaceConfig(
    {
      workspaceId: 'W-1',
      mode: 'isolated',
      layers: [layer('global', 1, { namespaces: { memory: 'global-memory' } })],
      revisions: registry(),
    },
    M,
  )
  assert.equal(isolatedEscape.ok, false)
  assert.equal(isolatedEscape.error.code, 'SECURITY_DENIED')
  assert.equal(isolatedEscape.error.details.namespace, 'memory')

  for (const name of ['global', 'isolated', 'inherit']) {
    const runtimeRefusal = core.resolveWorkspaceConfig(
      {
        workspaceId: 'W-1',
        mode: name,
        layers: [layer('global', 1, { namespaces: { runtime: 'shared-runtime' } })],
        revisions: registry(),
      },
      M,
    )
    assert.equal(runtimeRefusal.ok, false, `${name}: the runtime namespace is not a layer's to set`)
    assert.equal(runtimeRefusal.error.code, 'SECURITY_DENIED')
  }

  const incoherent = core.resolveWorkspaceConfig(
    {
      workspaceId: 'W-1',
      layers: [
        layer('platform-default', 1, { pools: { pools: { workers: { minActive: 4, maxActive: 6 } } } }),
        layer('workspace', 2, { pools: { pools: { workers: { maxActive: 2 } } } }),
      ],
      revisions: registry(),
    },
    M,
  )
  assert.equal(incoherent.ok, false, 'a limit the chain resolved below its own floor is a conflict, not a parse error')
  assert.equal(incoherent.error.code, 'CONTRACT_MISMATCH')
  assert.equal(incoherent.error.details.pool, 'workers')
  assert.equal(incoherent.error.details.minActive, 4)
  assert.equal(incoherent.error.details.maxActive, 2)
})

test('the resolved state keeps its ConfigRevision and a changed one mints the next', () => {
  const revisions = registry()
  const base = { workspaceId: 'W-1', layers: [layer('global', 1, { teamId: 'core-team' })], revisions }

  const first = core.resolveWorkspaceConfig(base, M)
  const again = core.resolveWorkspaceConfig(
    { workspaceId: 'W-1', layers: [layer('global', 9, { teamId: 'core-team' })], revisions },
    M,
  )
  assert.equal(first.ok, true)
  assert.equal(again.ok, true)
  assert.equal(again.value.fingerprint, first.value.fingerprint, 'the same effective state has one canonical form')
  assert.equal(again.value.configRevision, first.value.configRevision, 'the same state keeps its revision')
  assert.equal(revisions.size(), 1)

  const changed = core.resolveWorkspaceConfig(
    { workspaceId: 'W-1', layers: [layer('global', 1, { teamId: 'other-team' })], revisions },
    M,
  )
  assert.equal(changed.ok, true)
  assert.notEqual(changed.value.fingerprint, first.value.fingerprint)
  assert.equal(changed.value.configRevision, first.value.configRevision + 1)
  assert.equal(revisions.size(), 2)

  const otherWorkspace = core.resolveWorkspaceConfig(
    { workspaceId: 'W-2', layers: [layer('global', 1, { teamId: 'core-team' })], revisions },
    M,
  )
  assert.equal(otherWorkspace.ok, true)
  assert.notEqual(
    otherWorkspace.value.configRevision,
    first.value.configRevision,
    'a resolved state belongs to one workspace, and its runtime namespace is scoped to it (§52)',
  )
})

test('a malformed configuration fails loudly instead of resolving partially', () => {
  const malformed = [
    { workspaceId: 'W-1', layers: [{ layer: 'wrokspace', revision: 1, values: {} }], revisions: registry() },
    { workspaceId: 'W-1', layers: [layer('global', 1, {}), layer('global', 2, {})], revisions: registry() },
    { workspaceId: 'W-1', layers: [layer('global', -1, {})], revisions: registry() },
    { workspaceId: 'W-1', layers: [layer('global', 1, { team: 'core-team' })], revisions: registry() },
    { workspaceId: 'W-1', layers: [layer('global', 1, { blueprints: { 'bp-1': -3 } })], revisions: registry() },
    { workspaceId: 'W-1', layers: [layer('global', 1, { memoryRoutes: [''] })], revisions: registry() },
    {
      workspaceId: 'W-1',
      layers: [layer('global', 1, { pools: { pools: { workers: { minActive: 5, maxActive: 2 } } } })],
      revisions: registry(),
    },
    { workspaceId: 'W-1', layers: [layer('global', 1, { pools: { workers: { minActive: 0, maxActive: 1 } } })], revisions: registry() },
    { workspaceId: 'W-1', layers: [layer('global', 1, { namespaces: { memroy: 'x' } })], revisions: registry() },
    { workspaceId: 'W-1', layers: 'global', revisions: registry() },
    { workspaceId: '', layers: [], revisions: registry() },
    { workspaceId: 'W-1', layers: [], revisions: {} },
  ]
  for (const input of malformed) {
    assert.throws(
      () => core.resolveWorkspaceConfig(input, M),
      TypeError,
      `expected a TypeError for ${JSON.stringify(input)}`,
    )
  }
})

test('cross-workspace dependency edges are refused, artifact references are not', () => {
  const local = [
    { id: 'T-1', workspaceId: 'W-1', dependsOn: [] },
    { id: 'T-2', workspaceId: 'W-1', dependsOn: ['T-1'] },
  ]
  const accepted = core.assertWorkspaceLocalEdges(local, M)
  assert.equal(accepted.ok, true)
  assert.deepEqual(accepted.value, [{ taskId: 'T-2', dependsOn: 'T-1', workspaceId: 'W-1' }])

  const cross = [...local, { id: 'T-9', workspaceId: 'W-2', dependsOn: ['T-1'] }]
  const refused = core.assertWorkspaceLocalEdges(cross, M)
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'TASK_CONFLICT')
  assert.equal(refused.error.details.reason, 'cross-workspace-edge')
  assert.equal(refused.error.details.workspaceId, 'W-2')
  assert.equal(refused.error.details.dependencyWorkspace, 'W-1')

  const unknown = core.assertWorkspaceLocalEdges([{ id: 'T-1', workspaceId: 'W-1', dependsOn: ['T-404'] }], M)
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.details.reason, 'unverifiable-edge')
  assert.match(unknown.error.message, /pass the whole graph/, 'the refusal says how to make the edge verifiable')
  assert.equal(typeof unknown.error.details.hint, 'string')

  const selfEdge = core.assertWorkspaceLocalEdges([{ id: 'T-1', workspaceId: 'W-1', dependsOn: ['T-1'] }], M)
  assert.equal(selfEdge.ok, false)
  assert.equal(selfEdge.error.details.reason, 'self-dependency')

  const artifactLink = [
    { id: 'T-1', workspaceId: 'W-1', dependsOn: [], artifacts: ['W-1/artifact-1'] },
    { id: 'T-9', workspaceId: 'W-2', dependsOn: [], artifacts: ['W-1/artifact-1'] },
  ]
  const linked = core.assertWorkspaceLocalEdges(artifactLink, M)
  assert.equal(linked.ok, true, '§52 allows artifact/reference links across workspaces')

  assert.throws(
    () => core.assertWorkspaceLocalEdges([...local, { id: 'T-2', workspaceId: 'W-1', dependsOn: [] }], M),
    TypeError,
    'a duplicate task id is a caller error',
  )
})
