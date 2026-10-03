/**
 * Controller scheduler-state projection: authoritative sources are distinguished
 * from missing sources, graph readiness is re-read as full tasks, and the
 * scheduler consumes an already-observed model catalog without refreshing it.
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

function catalogSource(snapshot = { providers: [], models: [], outages: [] }) {
  return { read: () => snapshot }
}

test('missing runtime sources fail closed before the task graph is touched', async () => {
  const tasks = graph({ 'T-1': task('T-1') })
  const projection = controller.createSchedulerStateProjection({ graph: tasks, catalog: catalogSource() })

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

test('an unavailable cached catalog fails before any TaskGraph or runtime source read starts', async () => {
  const tasks = graph({ 'T-1': task('T-1') })
  let sourceReads = 0
  const countedSources = sources({
    reviews: { read: () => { sourceReads += 1; return [] } },
    instances: { read: () => { sourceReads += 1; return [] } },
    agents: { read: () => { sourceReads += 1; return [] } },
    workspaces: { read: () => { sourceReads += 1; return [] } },
  })
  const unavailable = Object.assign(new Error('catalog not observed'), { code: 'state-unavailable' })
  const projection = controller.createSchedulerStateProjection({
    graph: tasks,
    catalog: { read: () => { throw unavailable } },
    sources: countedSources,
  })

  await assert.rejects(projection.read(), error => error === unavailable)
  assert.equal(tasks.readyCalls, 0)
  assert.equal(sourceReads, 0, 'a catalog prerequisite failure must not launch a partial state observation')
})

test('ready references are expanded once and a task that moved meanwhile is dropped', async () => {
  const tasks = graph(
    {
      'T-1': task('T-1', { dependsOn: ['T-0'] }),
      'T-2': task('T-2', { state: 'assigned', assignee: 'Neo-1', activeAttemptId: 'A-1' }),
    },
    ['T-1', 'T-1', 'T-2'],
  )
  const projection = controller.createSchedulerStateProjection({ graph: tasks, catalog: catalogSource(), sources: sources() })

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

test('the projection reads a cached catalog snapshot and never asks it to refresh', async () => {
  let reads = 0
  let refreshes = 0
  const snapshot = {
    providers: [{ id: 'observed', name: 'Observed' }],
    models: [{ provider: 'observed', id: 'm-1', name: 'Model 1' }],
    outages: [],
  }
  const catalog = {
    read() {
      reads += 1
      return snapshot
    },
    refresh() {
      refreshes += 1
      throw new Error('scheduler-state projection must never refresh the catalog')
    },
  }
  const projection = controller.createSchedulerStateProjection({
    graph: graph({}),
    catalog,
    sources: sources(),
  })

  const first = await projection.read()
  const second = await projection.read()
  assert.equal(reads, 2, 'each state read takes exactly one already-observed snapshot')
  assert.equal(refreshes, 0, 'a scheduler state read performs no catalog/provider I/O')
  assert.deepEqual(first.catalog, snapshot)
  assert.deepEqual(second.catalog, snapshot)
  assert.notEqual(first.catalog, snapshot, 'the projection owns the snapshot it hands to policy')
  assert.equal(Object.isFrozen(first.catalog), true)
  assert.equal(Object.isFrozen(first.catalog.providers), true)
})

test('composed collection sources are read into owned frozen arrays', async () => {
  const reviewRows = [{ reviewId: 'R-1', taskId: 'T-1', workspaceId: 'W-1' }]
  const instanceRows = [{ instanceId: 'I-1' }]
  const agentRows = [{ identity: { id: 'Neo-1' } }]
  const workspaceRows = [{ workspaceId: 'W-1' }]
  const projection = controller.createSchedulerStateProjection({
    graph: graph({}),
    catalog: catalogSource(),
    sources: sources({
      reviews: { read: () => reviewRows },
      instances: { read: () => instanceRows },
      agents: { read: () => agentRows },
      workspaces: { read: () => workspaceRows },
    }),
  })

  const observed = await projection.read()
  reviewRows.push({ reviewId: 'R-2', taskId: 'T-2', workspaceId: 'W-1' })
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
        assert.deepEqual(error.details.missingSources, ['instances', 'agents', 'workspaces'])
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
