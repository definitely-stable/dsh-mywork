/**
 * Durable background jobs: the registry over `background_job` (F-37, MW-068, D09).
 *
 * What has to hold: a job survives the process that enqueued it; a worker takes
 * it with a lease, and no second worker takes it while that lease lives; and a
 * job whose worker died becomes available again when the lease expires, so a
 * crash does not strand work forever.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

import { evidence, execution, lease, planner, repoRoot, storage } from '../lib/fixtures.mjs'

const allocatorModule = await import(
  pathToFileURL(join(repoRoot, 'packages', 'controller', 'src', 'migration-allocator.ts')).href
)

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-storage-'))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/** The canonical set with the jobs table at an allocated version. */
async function jobsMigrations(dir) {
  const canonical = storage.canonicalMigrations([
    storage.MYWORK_MIGRATIONS,
    evidence.EVIDENCE_MIGRATIONS,
    lease.LEASE_MIGRATIONS,
    planner.PLAN_MUTATION_MIGRATIONS,
    execution.CLAIM_SAGA_MIGRATIONS,
  ])
  const path = join(dir, 'controller.sqlite')
  const seed = await storage.openStore({ path, migrations: canonical })
  const version = allocatorModule.createMigrationAllocator(seed).allocate({ key: 'background_job' })
  seed.close()
  return {
    path,
    migrations: storage.canonicalMigrations([canonical, [storage.createBackgroundJobMigration(version)]]),
  }
}

test('an enqueued job is pending, and it is still there after a restart', async () => {
  const dir = tempDir()
  const { path, migrations } = await jobsMigrations(dir)

  const first = await storage.openStore({ path, migrations })
  const enqueued = first.transaction(tx =>
    storage.enqueueBackgroundJob(tx, { kind: 'optimizer', payload: { workspaceId: 'W-1' }, now: 1_000 }))
  try {
    assert.equal(enqueued.status, 'pending')
    assert.equal(enqueued.attempts, 0)
    assert.equal(enqueued.leaseUntil, null)
    assert.deepEqual(JSON.parse(enqueued.payload), { workspaceId: 'W-1' })
    assert.deepEqual(first.transaction(tx => storage.listBackgroundJobs(tx).map(job => job.jobId)), [enqueued.jobId])
  } finally {
    first.close()
  }

  // A different process would reopen the same file; a reopened store is the
  // same proof, and the second open also re-runs the schema check.
  const second = await storage.openStore({ path, migrations })
  try {
    const [restored] = second.transaction(tx => storage.listBackgroundJobs(tx))
    assert.equal(restored.jobId, enqueued.jobId)
    assert.equal(restored.kind, 'optimizer')
    assert.equal(restored.status, 'pending', 'the job waits for a worker across the restart')
  } finally {
    second.close()
  }
})

test('a claim takes a lease, and a second worker cannot take it before the lease expires', async () => {
  const dir = tempDir()
  const { path, migrations } = await jobsMigrations(dir)
  const store = await storage.openStore({ path, migrations })
  try {
    const job = store.transaction(tx =>
      storage.enqueueBackgroundJob(tx, { kind: 'migration', payload: { step: 'F-37' }, now: 2_000 }))

    const claimed = store.transaction(tx =>
      storage.claimDueBackgroundJob(tx, { owner: 'worker-a', now: 2_100, leaseMs: 5_000 }))
    assert.equal(claimed.jobId, job.jobId)
    assert.equal(claimed.status, 'running')
    assert.equal(claimed.owner, 'worker-a')
    assert.equal(claimed.leaseUntil, 7_100, 'the lease runs from the clock reading of the claim')
    assert.equal(claimed.attempts, 1)

    const again = store.transaction(tx =>
      storage.claimDueBackgroundJob(tx, { owner: 'worker-b', now: 2_200, leaseMs: 5_000 }))
    assert.equal(again, undefined, 'a live lease keeps the second worker out')
  } finally {
    store.close()
  }
})

test('a lease that expired returns the job to the pool, and a settled job leaves it', async () => {
  const dir = tempDir()
  const { path, migrations } = await jobsMigrations(dir)
  const store = await storage.openStore({ path, migrations })
  try {
    const job = store.transaction(tx =>
      storage.enqueueBackgroundJob(tx, { kind: 'import', payload: { batch: 1 }, now: 3_000 }))
    store.transaction(tx => storage.claimDueBackgroundJob(tx, { owner: 'worker-a', now: 3_000, leaseMs: 1_000 }))

    const stranded = store.transaction(tx =>
      storage.claimDueBackgroundJob(tx, { owner: 'worker-b', now: 3_500, leaseMs: 1_000 }))
    assert.equal(stranded, undefined, 'the lease is still alive at 3_500')

    const recovered = store.transaction(tx =>
      storage.claimDueBackgroundJob(tx, { owner: 'worker-b', now: 4_001, leaseMs: 1_000 }))
    assert.equal(recovered.jobId, job.jobId, 'a dead worker does not strand the job')
    assert.equal(recovered.owner, 'worker-b')
    assert.equal(recovered.attempts, 2)

    const settled = store.transaction(tx => storage.settleBackgroundJob(tx, { jobId: job.jobId, status: 'succeeded', now: 4_100 }))
    assert.equal(settled.status, 'succeeded')
    assert.equal(settled.leaseUntil, null)
    assert.equal(
      store.transaction(tx => storage.claimDueBackgroundJob(tx, { owner: 'worker-c', now: 9_999, leaseMs: 1_000 })),
      undefined,
      'a terminal job is never claimed again',
    )
    assert.deepEqual(
      store.transaction(tx => storage.listBackgroundJobs(tx, { status: 'succeeded' }).map(entry => entry.jobId)),
      [job.jobId],
    )
  } finally {
    store.close()
  }
})

test('a claim whose guarded update changes no row refuses instead of handing out a foreign lease', async () => {
  const dir = tempDir()
  const { path, migrations } = await jobsMigrations(dir)
  const store = await storage.openStore({ path, migrations })
  try {
    const job = store.transaction(tx =>
      storage.enqueueBackgroundJob(tx, { kind: 'export', payload: { file: 'state' }, now: 5_000 }))

    // An executor that reports "the guarded UPDATE matched nothing" — what a race
    // with a second controller looks like from inside this transaction. The
    // caller must not receive a record whose owner is somebody else, so the guard
    // answers with a typed refusal instead of the row.
    assert.throws(
      () => store.transaction(tx => {
        const racing = {
          exec: sql => tx.exec(sql),
          run: (sql, ...params) => (sql.startsWith('UPDATE background_job') ? 0 : tx.run(sql, ...params)),
          get: (sql, ...params) => tx.get(sql, ...params),
          all: (sql, ...params) => tx.all(sql, ...params),
        }
        return storage.claimDueBackgroundJob(racing, { owner: 'worker-b', now: 5_100, leaseMs: 1_000 })
      }),
      error => error.name === 'StorageError'
        && error.code === 'conflict'
        && /claimed by another worker/.test(error.message)
        && error.details.changed === 0,
      'zero changed rows is a conflict, never a job owned by another worker',
    )

    assert.deepEqual(
      store.transaction(tx => tx.all('SELECT status, owner FROM background_job').map(row => [row.status, row.owner])),
      [['pending', null]],
      'the refused claim left the job untouched and unowned',
    )
    assert.equal(
      store.transaction(tx => storage.claimDueBackgroundJob(tx, { owner: 'worker-b', now: 5_200, leaseMs: 1_000 })).jobId,
      job.jobId,
      'a real claim still works after the refused one',
    )
  } finally {
    store.close()
  }
})
