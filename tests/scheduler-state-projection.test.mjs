/**
 * Controller scheduler-state projection: authoritative sources are distinguished
 * from missing sources, graph readiness is re-read as full tasks, and catalog
 * outages stay different from absent providers.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const controllerEntry = join(repoRoot, 'packages', 'controller', 'lib', 'index.js')
if (!existsSync(controllerEntry)) {
  throw new Error('scheduler-state projection tests: missing controller build; run "pnpm run build" first')
}
const controller = await import(pathToFileURL(controllerEntry).href)

function task(id, overrides = {}) {
  return {
    id,
    workspaceId: 'W-1',
    title: `task ${id}`,
    description: 'projection fixture',
    state: 'ready',
    revision: 1,
    dependsOn: [],
    ...overrides,
  }
}

function graph(tasks, readyIds = Object.keys(tasks)) {
  const getCalls = []
  let readyCalls = 0
  return {
    getCalls,
    get readyCalls() {
      return readyCalls
    },
    async ready() {
      readyCalls += 1
      return readyIds.map(id => ({ id, state: 'ready' }))
    },
    async get(id) {
      getCalls.push(id)
      const value = tasks[id]
      if (value === undefined) throw new Error(`missing fixture task ${id}`)
      return value
    },
  }
}

function sources(overrides = {}) {
  return {
    reviews: { read: () => [] },
    instances: { read: () => [] },
    agents: { read: () => [] },
    workspaces: { read: () => [] },
    ...overrides,
  }
}

test('missing runtime sources fail closed before the task graph is touched', async () => {
  const tasks = graph({ 'T-1': task('T-1') })
  const projection = controller.createSchedulerStateProjection({ graph: tasks })

  assert.deepEqual(
    projection.missingSources(),
    ['reviews', 'instances', 'agents', 'workspaces'],
  )
  assert.equal(Object.isFrozen(projection.missingSources()), true)

  await assert.rejects(
    projection.read(),
    error => {
      assert.equal(controller.isControllerRuntimeError(error), true)
      assert.equal(error.code, 'state-unavailable')
      assert.deepEqual(error.details.missingSources, ['reviews', 'instances', 'agents', 'workspaces'])
      return true
    },
  )
  assert.equal(tasks.readyCalls, 0, 'an incomplete projection must not perform a partial graph read')
})

test('ready references are expanded once and a task that moved meanwhile is dropped', async () => {
  const tasks = graph(
    {
      'T-1': task('T-1', { dependsOn: ['T-0'] }),
      'T-2': task('T-2', { state: 'assigned', assignee: 'Neo-1', activeAttemptId: 'A-1' }),
    },
    ['T-1', 'T-1', 'T-2'],
  )
  const projection = controller.createSchedulerStateProjection({ graph: tasks, sources: sources() })

  const observed = await projection.read()
  assert.deepEqual(observed.workers.map(entry => entry.task.id), ['T-1'])
  assert.deepEqual(tasks.getCalls, ['T-1', 'T-2'], 'duplicate ready refs must not duplicate graph reads')
  assert.equal(Object.isFrozen(observed), true)
  assert.equal(Object.isFrozen(observed.workers), true)
  assert.equal(Object.isFrozen(observed.workers[0]), true)
  assert.equal(Object.isFrozen(observed.workers[0].task), true)
  assert.equal(Object.isFrozen(observed.workers[0].task.dependsOn), true)
  assert.deepEqual(observed.catalog, { providers: [], models: [], outages: [] })
})

test('catalog snapshot preserves registered providers and records one provider outage', async () => {
  const tasks = graph({})
  const catalog = {
    listProviders: () => [
      { id: 'healthy', name: 'Healthy' },
      { id: 'down', name: 'Down' },
    ],
    async listModels(provider) {
      if (provider === 'down') throw new Error('provider timed out')
      return [{ provider, id: 'm-1', name: 'Model 1' }]
    },
    async resolveModelInfo() {
      throw new Error('the scheduler projection must not resolve a model route')
    },
  }
  const adapters = {
    list: kind => kind === 'model-catalog' ? [{ kind }] : [],
    resolve(kind) {
      assert.equal(kind, 'model-catalog')
      return { ok: true, manifest: {}, adapter: catalog }
    },
  }
  const projection = controller.createSchedulerStateProjection({
    graph: tasks,
    adapters,
    sources: sources(),
  })

  const observed = await projection.read()
  assert.deepEqual(observed.catalog.providers, [
    { id: 'healthy', name: 'Healthy' },
    { id: 'down', name: 'Down' },
  ])
  assert.deepEqual(observed.catalog.models, [
    { provider: 'healthy', id: 'm-1', name: 'Model 1' },
  ])
  assert.deepEqual(observed.catalog.outages, [
    { provider: 'down', detail: 'provider timed out' },
  ])
  assert.equal(Object.isFrozen(observed.catalog), true)
  assert.equal(Object.isFrozen(observed.catalog.providers), true)
  assert.equal(Object.isFrozen(observed.catalog.models), true)
  assert.equal(Object.isFrozen(observed.catalog.outages), true)
})

test('an absent model-catalog adapter is an empty route set, not a fabricated outage', async () => {
  const projection = controller.createSchedulerStateProjection({
    graph: graph({}),
    adapters: {
      list: () => [],
      resolve: () => { throw new Error('resolve must not run when no catalog is registered') },
    },
    sources: sources(),
  })

  const observed = await projection.read()
  assert.deepEqual(observed.catalog, { providers: [], models: [], outages: [] })
})

test('a non-availability catalog refusal is not collapsed into an empty catalog', async () => {
  const mismatch = Object.assign(new Error('catalog contract mismatch'), { code: 'CONTRACT_MISMATCH' })
  const projection = controller.createSchedulerStateProjection({
    graph: graph({}),
    adapters: {
      list: () => [{ kind: 'model-catalog' }],
      resolve: () => ({ ok: false, refusal: mismatch }),
    },
    sources: sources(),
  })

  await assert.rejects(projection.read(), error => error === mismatch)
})

test('composed collection sources are read into owned frozen arrays', async () => {
  const reviewRows = [{ review: { id: 'R-1' }, workspaceId: 'W-1' }]
  const instanceRows = [{ instanceId: 'I-1' }]
  const agentRows = [{ identity: { id: 'Neo-1' } }]
  const workspaceRows = [{ workspaceId: 'W-1' }]
  const projection = controller.createSchedulerStateProjection({
    graph: graph({}),
    sources: sources({
      reviews: { read: () => reviewRows },
      instances: { read: () => instanceRows },
      agents: { read: () => agentRows },
      workspaces: { read: () => workspaceRows },
    }),
  })

  const observed = await projection.read()
  reviewRows.push({ review: { id: 'R-2' }, workspaceId: 'W-1' })
  reviewRows[0].workspaceId = 'W-mutated'
  instanceRows[0].instanceId = 'I-mutated'
  agentRows[0].identity.id = 'mutated-agent'
  workspaceRows[0].workspaceId = 'W-mutated'
  assert.equal(observed.reviews.length, 1, 'the observation must not retain the source array identity')
  assert.equal(observed.reviews[0].workspaceId, 'W-1', 'nested source mutation must not rewrite a snapshot')
  assert.equal(observed.instances[0].instanceId, 'I-1')
  assert.equal(observed.agents[0].identity.id, 'Neo-1')
  assert.equal(observed.workspaces[0].workspaceId, 'W-1')
  for (const field of ['reviews', 'instances', 'agents', 'workspaces']) {
    assert.equal(Object.isFrozen(observed[field]), true, `${field} array must be frozen`)
    assert.equal(Object.isFrozen(observed[field][0]), true, `${field} values must be frozen`)
  }
  assert.equal(Object.isFrozen(observed.agents[0].identity), true, 'nested agent data must be frozen')
})


test('the composition root exposes an unarmed scheduler that refuses an incomplete state', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-mywork-scheduler-state-'))
  const app = controller.createMyWorkApplication({ dshHome: home })
  try {
    await app.start()
    assert.notEqual(app.scheduler, undefined, 'an active controller still composes the scheduler service')
    await assert.rejects(
      app.scheduler.reconcile(),
      error => {
        assert.equal(controller.isControllerRuntimeError(error), true)
        assert.equal(error.code, 'state-unavailable')
        assert.deepEqual(error.details.missingSources, ['reviews', 'instances', 'agents', 'workspaces'])
        return true
      },
    )
    assert.deepEqual(app.admissions, [], 'an incomplete observation cannot produce an admission')
    assert.equal(app.scheduler.snapshot().running, false, 'reconcile alone must not arm the safety timer')
  } finally {
    await app.stop()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
