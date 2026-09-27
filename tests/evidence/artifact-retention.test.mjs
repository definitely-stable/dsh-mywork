/**
 * Artifact retention under the append-only guards (F-40, MW-008/040, D17, P22).
 *
 * What has to hold: a plain `DELETE` is still refused; the refusal really is the
 * trigger (dropping that one guard lets the delete through, while the update and
 * insert guards stay); a tombstone alone is not enough when the audit names the
 * artifact; an insert that collides with an existing `artifact_id` is still
 * refused; and the dry run reports exactly what the real run would delete.
 *
 * The migration that opens the path takes its version from the single allocator
 * (F-63) — the number is read from `migration_allocations`, never written here.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

import { contracts, evidence, execution, lease, planner, repoRoot, storage } from '../lib/fixtures.mjs'

const allocatorModule = await import(
  pathToFileURL(join(repoRoot, 'packages', 'controller', 'src', 'migration-allocator.ts')).href
)

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-evidence-'))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/**
 * A store carrying the kernel, the evidence tables and the F-40 migration, whose
 * version the allocator issued on this very database.
 */
async function openRetentionStore(dir) {
  const kernel = storage.canonicalMigrations([
    storage.MYWORK_MIGRATIONS,
    evidence.EVIDENCE_MIGRATIONS,
    lease.LEASE_MIGRATIONS,
    planner.PLAN_MUTATION_MIGRATIONS,
    execution.CLAIM_SAGA_MIGRATIONS,
  ])
  const path = join(dir, 'controller.sqlite')
  const seed = await storage.openStore({ path, migrations: kernel })
  const version = allocatorModule.createMigrationAllocator(seed).allocate({ key: 'artifact-retention' })
  seed.close()
  const migrations = storage.canonicalMigrations([kernel, [evidence.createArtifactRetentionMigration(version)]])
  return { path, migrations, version, store: await storage.openStore({ path, migrations }) }
}

/** An artifact write request. */
function artifactRequest(overrides = {}) {
  return {
    artifactId: 'ev-1',
    kind: 'test-report',
    workspaceId: 'W-1',
    correlationId: 'corr-1',
    contentType: 'text/plain',
    bytes: new TextEncoder().encode('26 pass / 0 fail'),
    taskId: 'T-1',
    attemptId: 'A-1',
    ...overrides,
  }
}

/** One audit entry that names an artifact. */
function auditEntry(overrides = {}) {
  return {
    schema: contracts.AUDIT_SCHEMA,
    auditId: 'au-1',
    type: 'attempt.assigned',
    workspaceId: 'W-1',
    correlationId: 'corr-1',
    occurredAt: 1_000,
    ...overrides,
  }
}

test('a plain delete is refused by the guard, and dropping that guard is what lets it through', async () => {
  const { store, version } = await openRetentionStore(tempDir())
  try {
    const artifacts = evidence.createArtifactStore(store, { now: () => 1_000 })
    const { ref } = artifacts.put(artifactRequest())

    assert.throws(
      () => store.transaction(tx => tx.run('DELETE FROM artifacts WHERE artifact_id = ?', ref.artifactId)),
      error => String(error.message).includes(evidence.ARTIFACT_IMMUTABLE_MARKER),
      'the delete guard is in place',
    )

    const dropped = store.transaction(tx => evidence.dropArtifactDeleteGuard(tx))
    assert.equal(typeof dropped, 'string')
    assert.ok(dropped.includes('RAISE'), 'the dropped guard is returned, so it can be put back')

    store.transaction(tx => tx.run('DELETE FROM artifacts WHERE artifact_id = ?', ref.artifactId))
    assert.equal(store.transaction(tx => tx.get('SELECT COUNT(*) AS n FROM artifacts').n), 0, 'the delete went through')

    // Only the delete guard was dropped: the artifact still cannot be rewritten.
    const again = artifacts.put(artifactRequest({ bytes: new TextEncoder().encode('other bytes') }))
    assert.equal(again.created, true)
    assert.throws(
      () => store.transaction(tx => tx.run("UPDATE artifacts SET content_type = 'text/markdown' WHERE artifact_id = ?", ref.artifactId)),
      error => String(error.message).includes(evidence.ARTIFACT_IMMUTABLE_MARKER),
      'the update guard is untouched',
    )

    assert.equal(version, store.schemaVersion, 'the retention migration is the last one applied')
  } finally {
    store.close()
  }
})

test('a tombstone is not enough while the audit names the artifact, and a colliding insert stays refused', async () => {
  const { store } = await openRetentionStore(tempDir())
  try {
    const artifacts = evidence.createArtifactStore(store, { now: () => 1_000 })
    const audit = evidence.createAuditLog(store, { now: () => 1_000 })
    const { ref } = artifacts.put(artifactRequest({ artifactId: 'ev-referenced' }))
    audit.append(auditEntry({ artifactId: 'ev-referenced' }))

    store.transaction(tx => evidence.markArtifactForDeletion(tx, { artifactId: 'ev-referenced', markedAt: 2_000 }))
    assert.throws(
      () => store.transaction(tx => tx.run('DELETE FROM artifacts WHERE artifact_id = ?', ref.artifactId)),
      error => String(error.message).includes(evidence.ARTIFACT_IMMUTABLE_MARKER),
      'an artifact the audit names may not be deleted, even with a tombstone',
    )
    assert.equal(store.transaction(tx => tx.get('SELECT COUNT(*) AS n FROM artifacts').n), 1)

    // The replace guard is untouched: a second write under the same identity is
    // refused by the database, not only by the layer's own check.
    assert.throws(
      () => store.transaction(tx => tx.run(
        'INSERT INTO artifacts (artifact_id, hash, kind, workspace_id, correlation_id, content_type, size, created_at, task_id, attempt_id, review_id, causation_id, bytes) '
          + "VALUES (?, ?, 'test-report', 'W-1', 'corr-1', 'text/plain', 1, 1, NULL, NULL, NULL, NULL, x'00')",
        ref.artifactId,
        'f'.repeat(64),
      )),
      error => String(error.message).includes(evidence.ARTIFACT_IMMUTABLE_MARKER),
      'INSERT with an existing artifact_id is still refused',
    )
  } finally {
    store.close()
  }
})

test('the dry run predicts the deletion, and only tombstoned, unreferenced, old artifacts go', async () => {
  const { store } = await openRetentionStore(tempDir())
  try {
    let clock = 1_000
    const artifacts = evidence.createArtifactStore(store, { now: () => clock })
    const audit = evidence.createAuditLog(store, { now: () => 1_000 })
    const deletable = artifacts.put(artifactRequest({ artifactId: 'ev-old-free' })).ref
    clock = 2_000
    const referenced = artifacts.put(artifactRequest({ artifactId: 'ev-old-referenced' })).ref
    const auditResult = audit.append(auditEntry({ auditId: 'au-ref', artifactId: 'ev-old-referenced', occurredAt: 1_500 }))
    clock = 9_000
    const fresh = artifacts.put(artifactRequest({ artifactId: 'ev-fresh' })).ref
    assert.ok(auditResult.position > 0, 'the audit entry that pins the referenced artifact exists')

    const window = { olderThan: 5_000 }
    assert.deepEqual(
      store.transaction(tx => evidence.listArtifactDeletionCandidates(tx, window)).candidates,
      [],
      'nothing is a candidate before it is marked',
    )

    store.transaction(tx => {
      evidence.markArtifactForDeletion(tx, { artifactId: deletable.artifactId, markedAt: 6_000, reason: 'window' })
      evidence.markArtifactForDeletion(tx, { artifactId: referenced.artifactId, markedAt: 6_000, reason: 'window' })
      evidence.markArtifactForDeletion(tx, { artifactId: fresh.artifactId, markedAt: 6_000, reason: 'window' })
    })

    const dryRun = store.transaction(tx => evidence.listArtifactDeletionCandidates(tx, window))
    assert.deepEqual(dryRun.cutoff, 5_000)
    assert.deepEqual(dryRun.candidates, ['ev-old-free'],
      'the referenced artifact and the fresh one are not candidates')

    const result = store.transaction(tx => evidence.pruneArtifacts(tx, window))
    assert.deepEqual(result, { cutoff: 5_000, candidates: 1, deleted: 1 })

    assert.deepEqual(
      store.transaction(tx => tx.all('SELECT artifact_id FROM artifacts ORDER BY artifact_id')).map(row => row.artifact_id),
      ['ev-fresh', 'ev-old-referenced'],
    )
    // The dry run deleted nothing, and the guard is still standing afterwards.
    assert.throws(
      () => store.transaction(tx => tx.run('DELETE FROM artifacts WHERE artifact_id = ?', referenced.artifactId)),
      error => String(error.message).includes(evidence.ARTIFACT_IMMUTABLE_MARKER),
    )
    assert.throws(
      () => store.transaction(tx => evidence.pruneArtifacts(tx, { olderThan: -1 })),
      error => error.name === 'EvidenceError' && error.code === 'invalid-input',
    )
  } finally {
    store.close()
  }
})

test('a tombstone is spent with the artifact, so a reused id is not deleted again', async () => {
  const { store } = await openRetentionStore(tempDir())
  try {
    let clock = 1_000
    const artifacts = evidence.createArtifactStore(store, { now: () => clock })
    const first = artifacts.put(artifactRequest({ artifactId: 'ev-reused' })).ref
    store.transaction(tx => evidence.markArtifactForDeletion(tx, { artifactId: first.artifactId, markedAt: 6_000 }))

    const window = { olderThan: 5_000 }
    assert.deepEqual(
      store.transaction(tx => evidence.listArtifactDeletionCandidates(tx, window)).candidates,
      ['ev-reused'],
    )
    assert.equal(store.transaction(tx => evidence.pruneArtifacts(tx, window)).deleted, 1)
    assert.equal(
      store.transaction(tx => tx.get('SELECT COUNT(*) AS n FROM artifact_tombstone').n),
      0,
      'the mark is spent with the artifact it authorized',
    )

    // Ids are derived deterministically by the claim saga, so the same identity
    // comes back with a later run: it must not inherit the old permission.
    clock = 9_000
    const second = artifacts.put(artifactRequest({ artifactId: 'ev-reused', bytes: new TextEncoder().encode('second run') }))
    assert.equal(second.created, true)

    const wide = { olderThan: 10_000 }
    assert.deepEqual(
      store.transaction(tx => evidence.listArtifactDeletionCandidates(tx, wide)).candidates,
      [],
      'the new artifact inherits no mark, so it is not a candidate',
    )
    assert.equal(store.transaction(tx => evidence.pruneArtifacts(tx, wide)).deleted, 0, 'and it is not deleted')
    assert.equal(store.transaction(tx => tx.get('SELECT COUNT(*) AS n FROM artifacts').n), 1)
    assert.throws(
      () => store.transaction(tx => tx.run('DELETE FROM artifacts WHERE artifact_id = ?', 'ev-reused')),
      error => String(error.message).includes(evidence.ARTIFACT_IMMUTABLE_MARKER),
      'the recreated artifact is guarded like any other',
    )
  } finally {
    store.close()
  }
})