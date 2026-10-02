/**
 * The carrier of durable jobs (F-36, MW-068, D09).
 *
 * What has to hold: the canonical registry carries a migration that creates
 * `background_job` with the agreed columns, the version it brings the database
 * to was **issued by the version allocator** (never written here, R-04), the
 * table does not inherit the artifact delete guards — a job has to be able to
 * finish and be cleaned — and the job vocabulary lives in the contracts package
 * without importing the platform's process-local `JobView`.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

import { contracts, evidence, execution, lease, planner, repoRoot, storage } from '../lib/fixtures.mjs'

// The allocator is the composition layer's module; the tests reach it at its
// source, exactly as the F-63 suite does.
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

/** The canonical set the composition root assembles. */
function canonicalMigrations() {
  return storage.canonicalMigrations([
    storage.MYWORK_MIGRATIONS,
    evidence.EVIDENCE_MIGRATIONS,
    lease.LEASE_MIGRATIONS,
    planner.PLAN_MUTATION_MIGRATIONS,
    execution.CLAIM_SAGA_MIGRATIONS,
  ])
}

/**
 * A store whose schema carries the jobs table, with the version allocated on
 * that very database — the assembly F-29/F-31 performs.
 */
async function openJobsStore(dir) {
  const canonical = canonicalMigrations()
  const path = join(dir, 'controller.sqlite')
  const seed = await storage.openStore({ path, migrations: canonical })
  const allocator = allocatorModule.createMigrationAllocator(seed)
  const version = allocator.allocate({ key: 'background_job' })
  const other = allocator.allocate({ key: 'artifact-retention' })
  seed.close()
  const migrations = storage.canonicalMigrations([canonical, [storage.createBackgroundJobMigration(version)]])
  return { path, migrations, version, other, store: await storage.openStore({ path, migrations }) }
}

test('the jobs table exists with the agreed columns at a version the allocator issued', async () => {
  const dir = tempDir()
  const { version, other, store } = await openJobsStore(dir)
  try {
    const canonical = canonicalMigrations()
    assert.ok(version > canonical.at(-1).version, `the allocated version ${version} sits above the occupied set`)
    assert.notEqual(version, other, 'two concurrent requests never share a number')

    const columns = store.transaction(tx => tx.all('PRAGMA table_info(background_job)').map(row => row.name))
    assert.deepEqual(columns, [
      'job_id', 'kind', 'status', 'owner', 'payload', 'attempts', 'created_at', 'updated_at', 'lease_until',
    ])

    const journal = store.transaction(tx => tx.all('SELECT version, name FROM schema_migrations ORDER BY version'))
    assert.equal(journal.at(-1).version, version, 'the journal records the allocated version')
    assert.equal(journal.at(-1).name, 'background-job')
    assert.equal(store.schemaVersion, version)
  } finally {
    store.close()
  }
})

test('a job is not an artifact: the delete guards do not cover it', async () => {
  const store = (await openJobsStore(tempDir())).store
  try {
    const guard = store.transaction(tx => tx.all("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'background_job'"))
    assert.deepEqual(guard, [], 'a finished job must be cleanable, so no DELETE guard is inherited')

    // The check is not vacuous: the artifact table in the same schema keeps all
    // three of its guards.
    const artifacts = store.transaction(tx => tx
      .all("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'artifacts' ORDER BY name")
      .map(row => row.name))
    assert.deepEqual(artifacts, ['artifacts_no_delete', 'artifacts_no_replace', 'artifacts_no_update'])

    store.transaction(tx => storage.enqueueBackgroundJob(tx, { kind: 'retention', payload: { at: 1 }, now: 1, jobId: 'job-done' }))
    store.transaction(tx => storage.settleBackgroundJob(tx, { jobId: 'job-done', status: 'succeeded', now: 2 }))
    store.transaction(tx => tx.run('DELETE FROM background_job WHERE job_id = ?', 'job-done'))
    assert.equal(store.transaction(tx => tx.get('SELECT COUNT(*) AS n FROM background_job').n), 0)
  } finally {
    store.close()
  }
})

test('the job vocabulary lives in the contracts package and imports no platform type', () => {
  assert.deepEqual(
    [...contracts.BACKGROUND_JOB_KINDS].sort(),
    ['backup', 'export', 'import', 'migration', 'optimizer', 'retention'],
  )
  assert.deepEqual(
    [...contracts.BACKGROUND_JOB_STATUSES].sort(),
    ['failed', 'pending', 'running', 'succeeded'],
  )
  for (const kind of ['optimizer', 'migration', 'import']) {
    assert.ok(contracts.BACKGROUND_JOB_KINDS.includes(kind), `the plan names "${kind}" as a durable job`)
  }

  const source = readFileSync(join(repoRoot, 'packages', 'contracts', 'src', 'background-job.ts'), 'utf8')
  assert.equal(/^\s*import\s/m.test(source), false, 'the contract imports nothing at all, so no platform type can reach it')
  assert.equal(source.includes('@deepseek-ai'), false, 'and no platform package is named in it')

  const built = readFileSync(join(repoRoot, 'packages', 'contracts', 'lib', 'index.js'), 'utf8')
  assert.equal(/from\s*'@deepseek-ai/.test(built), false, 'the built contracts bundle still pulls in no platform code')

  const barrel = readFileSync(join(repoRoot, 'packages', 'contracts', 'src', 'index.ts'), 'utf8')
  assert.ok(barrel.includes("export * from './background-job.ts'"), 'the barrel publishes the module')
})
