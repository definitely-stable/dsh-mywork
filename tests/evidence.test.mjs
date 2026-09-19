/**
 * Artifact Store and append-only Audit acceptance (architecture §32, §33, §34).
 *
 * What has to hold: a second write under an existing artifact id never replaces
 * the evidence, a read verifies the bytes against the hash it is stored under,
 * secret material has no way into the metadata, and the audit survives both a
 * restart and a log rotation because it is a durable table rather than a file.
 *
 * Every database lives in a fresh temporary directory. The harness state under
 * `$DSH_HOME` is never written; only a read-only fingerprint is taken, so a
 * suite that leaked into the live home would fail instead of passing quietly.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { contracts, evidence, storage } from './lib/fixtures.mjs'

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-evidence-'

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  tempDirs.push(dir)
  return dir
}

/** A path inside a fresh temporary directory. */
function databasePath(dir) {
  return join(dir, 'registry.sqlite')
}

/** Open a temporary MyWork database carrying the evidence schema. */
async function openEvidenceDatabase(dir, clock = { now: () => 1_000 }) {
  return storage.openStore({
    path: databasePath(dir),
    migrations: [...storage.MYWORK_MIGRATIONS, ...evidence.EVIDENCE_MIGRATIONS],
    clock,
  })
}

/** The live harness home, used only to prove this suite never touches it. */
const liveHome = process.env[storage.DSH_HOME_ENV] ?? join(homedir(), '.dsh')

/** What the live harness home looks like, without reading any of its files. */
function liveHomeFingerprint() {
  const root = join(liveHome, storage.MYWORK_DIR_NAME)
  return { exists: existsSync(root), entries: existsSync(root) ? readdirSync(root).sort() : [] }
}

const liveHomeBefore = liveHomeFingerprint()

after(() => {
  const liveHomeAfter = liveHomeFingerprint()
  const leftover = []
  for (const dir of tempDirs) {
    // Delete by handle: only a directory this suite created, under the temp
    // root, is ever a cleanup target. A failing test must not stop the others,
    // because a leaked database handle keeps the file open on Windows.
    assert.ok(dir.startsWith(join(tmpdir(), TEMP_PREFIX)), `refusing to remove a directory this suite did not create: ${dir}`)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      leftover.push(dir)
    }
  }
  assert.deepEqual(liveHomeAfter, liveHomeBefore, 'the evidence suite touched the live DSH home')
  assert.deepEqual(leftover, [], `temporary databases were left behind: ${leftover.join(', ')}`)
})

/** An artifact write request with the fields the acceptance cares about. */
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

/** An audit entry for a §34 event. */
function auditEntry(overrides = {}) {
  return {
    schema: contracts.AUDIT_SCHEMA,
    auditId: 'au-1',
    type: 'review.approved',
    workspaceId: 'W-1',
    correlationId: 'corr-1',
    occurredAt: 1_000,
    ...overrides,
  }
}

/** SHA-256 computed here, so the store's own helper is never the oracle. */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Run a call that must be refused and return the failure.
 * @param fn - the call that must throw.
 * @param code - expected `EvidenceError` code.
 */
function refusal(fn, code) {
  let caught
  try {
    fn()
  } catch (error) {
    caught = error
  }
  assert.ok(caught !== undefined, `expected a refusal with code ${code}, but the call succeeded`)
  assert.equal(caught.name, 'EvidenceError', `expected an EvidenceError, got ${caught.name}: ${caught.message}`)
  assert.equal(caught.code, code, `expected ${code}, got ${caught.code}: ${caught.message}`)
  return caught
}

/**
 * Run a call the DATABASE must refuse (an immutability or append-only trigger)
 * and return the failure. These surface as SQLite errors carrying the marker the
 * trigger raised, not as an `EvidenceError`.
 * @param fn - the call that must throw.
 * @param marker - marker text the trigger raises.
 */
function databaseRefusal(fn, marker) {
  let caught
  try {
    fn()
  } catch (error) {
    caught = error
  }
  assert.ok(caught !== undefined, `expected the database to refuse with "${marker}", but the call succeeded`)
  assert.match(caught.message, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  return caught
}

test('the evidence schema is applied up to version 3 with its journal row', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const journal = store.transaction(tx => tx.all('SELECT version, name FROM schema_migrations ORDER BY version'))
  assert.deepEqual(
    journal.map(row => [row.version, row.name]),
    [
      [1, 'outbox-inbox'],
      [2, 'artifact-audit'],
      [3, 'evidence-immutability'],
    ],
  )
  const triggers = store.transaction(tx =>
    tx.all("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").map(row => row.name),
  )
  assert.deepEqual(triggers, [
    'artifacts_no_delete',
    'artifacts_no_replace',
    'artifacts_no_update',
    'audit_events_no_delete',
    'audit_events_no_replace',
    'audit_events_no_update',
  ])
  store.close()
})

test('an artifact round-trips with its identity, its metadata, and its hash', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const artifacts = evidence.createArtifactStore(store, { now: () => 4_200 })
  const request = artifactRequest()
  const { ref, created } = artifacts.put(request)

  assert.equal(created, true)
  assert.equal(ref.artifactId, 'ev-1')
  assert.equal(ref.hash, sha256(request.bytes))

  const artifact = artifacts.get(ref)
  assert.deepEqual(artifact.bytes, request.bytes)
  assert.equal(artifact.metadata.hash, ref.hash)
  assert.equal(artifact.metadata.size, request.bytes.byteLength)
  assert.equal(artifact.metadata.createdAt, 4_200)
  assert.equal(artifact.metadata.workspaceId, 'W-1')
  assert.equal(artifact.metadata.taskId, 'T-1')
  assert.equal(artifact.metadata.attemptId, 'A-1')
  assert.equal(artifact.metadata.correlationId, 'corr-1')
  assert.equal(artifact.metadata.kind, 'test-report')
  store.close()
})

test('a second write under the same id with other bytes is refused and changes nothing', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const artifacts = evidence.createArtifactStore(store, { now: () => 4_200 })
  const original = artifactRequest()
  const first = artifacts.put(original)

  refusal(
    () => artifacts.put(artifactRequest({ bytes: new TextEncoder().encode('25 pass / 1 fail') })),
    'artifact-conflict',
  )

  // The first version still stands, byte for byte.
  const artifact = artifacts.get(first.ref)
  assert.deepEqual(artifact.bytes, original.bytes)
  assert.equal(artifact.metadata.hash, sha256(original.bytes))
  assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM artifacts').n)), 1)
  store.close()
})

test('rewriting the same artifact with the same evidence is idempotent', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const artifacts = evidence.createArtifactStore(store, { now: () => 4_200 })
  const first = artifacts.put(artifactRequest())
  const second = artifacts.put(artifactRequest())

  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.deepEqual(second.ref, first.ref)
  assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM artifacts').n)), 1)
  store.close()
})

test('a read verifies the stored bytes against the hash they are stored under', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const artifacts = evidence.createArtifactStore(store, { now: () => 4_200 })
  const { ref } = artifacts.put(artifactRequest())

  // Tamper with the row the way a hostile writer holding a raw connection
  // would: the trigger has to be dropped first, which is exactly why a read
  // must not trust the row.
  const tampered = new TextEncoder().encode('26 pass / 0 fail, trust me')
  store.transaction(tx => {
    tx.exec('DROP TRIGGER artifacts_no_update')
    tx.run('UPDATE artifacts SET bytes = ? WHERE artifact_id = ?', tampered, ref.artifactId)
  })

  const failure = refusal(() => artifacts.get(ref), 'hash-mismatch')
  assert.equal(failure.details.storedHash, ref.hash)
  assert.notEqual(failure.details.actualHash, ref.hash)
  store.close()
})

test('a reference naming another hash is refused, and an unknown id is not found', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const artifacts = evidence.createArtifactStore(store, { now: () => 4_200 })
  const { ref } = artifacts.put(artifactRequest())

  refusal(() => artifacts.get({ artifactId: ref.artifactId, hash: 'f'.repeat(64) }), 'hash-mismatch')
  refusal(() => artifacts.get({ artifactId: 'ev-missing', hash: ref.hash }), 'artifact-not-found')
  refusal(() => artifacts.get({ artifactId: ref.artifactId, hash: 'not-a-hash' }), 'invalid-input')
  refusal(() => artifacts.get({ artifactId: ref.artifactId, hash: ref.hash, extra: 1 }), 'invalid-input')
  store.close()
})

test('the database itself refuses to rewrite or delete an artifact', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const artifacts = evidence.createArtifactStore(store, { now: () => 4_200 })
  const { ref } = artifacts.put(artifactRequest())

  databaseRefusal(
    () => store.transaction(tx => tx.run('UPDATE artifacts SET hash = ? WHERE artifact_id = ?', 'a'.repeat(64), ref.artifactId)),
    evidence.ARTIFACT_IMMUTABLE_MARKER,
  )
  databaseRefusal(
    () => store.transaction(tx => tx.run('DELETE FROM artifacts WHERE artifact_id = ?', ref.artifactId)),
    evidence.ARTIFACT_IMMUTABLE_MARKER,
  )
  assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM artifacts').n)), 1)
  store.close()
})

test('secret material has no way into the artifact metadata', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const artifacts = evidence.createArtifactStore(store, { now: () => 4_200 })

  const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----'
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJOZW8tMSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  refusal(() => artifacts.put(artifactRequest({ workspaceId: pem })), 'secret-material')
  refusal(() => artifacts.put(artifactRequest({ correlationId: jwt })), 'secret-material')
  refusal(() => artifacts.put(artifactRequest({ artifactId: 'sk-live-51H8xQ2mNp7ZrT4v' })), 'secret-material')
  refusal(() => artifacts.put(artifactRequest({ artifactId: 'sk_live_51H8xQ2mNp7ZrT4v9kLmN3pQ' })), 'secret-material')
  refusal(() => artifacts.put(artifactRequest({ correlationId: 'sk_test_4eC39HqLyjWDarjtT1zdp7dc' })), 'secret-material')
  refusal(() => artifacts.put(artifactRequest({ workspaceId: 'password=hunter2000' })), 'secret-material')
  // Neither a secret nor a usable identifier: refused as malformed, not stored.
  refusal(() => artifacts.put(artifactRequest({ workspaceId: 'has space' })), 'invalid-input')

  // A field the §32 schema does not declare is refused rather than stored.
  refusal(() => artifacts.put(artifactRequest({ notes: 'free text nobody declared' })), 'invalid-input')
  refusal(() => artifacts.put(artifactRequest({ contentType: 'not a media type' })), 'invalid-input')
  assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM artifacts').n)), 0)
  store.close()
})

test('legitimate identifiers are not mistaken for secrets', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const artifacts = evidence.createArtifactStore(store, { now: () => 4_200 })

  // The scan has to fail closed without swallowing ordinary identifiers: an id
  // that merely begins with a provider prefix is not a key. These were refused
  // by an earlier, looser pattern (see the report, finding N-1).
  const accepted = [
    'sk_workspace_alpha_1',
    'task-sk-1234',
    'ev-1',
    'W-1',
    'commit-0123456789abcdef0123456789abcdef01234567',
  ]
  for (const [index, artifactId] of accepted.entries()) {
    const result = artifacts.put(artifactRequest({ artifactId, correlationId: `corr-${index}` }))
    assert.equal(result.created, true, `expected "${artifactId}" to be accepted`)
  }
  assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM artifacts').n)), accepted.length)
  store.close()
})

test('a database created before the replace guards reaches them by migration', async () => {
  const dir = tempDir()

  // The state an earlier build left behind: the tables migration only, so the
  // UPDATE/DELETE guards exist and the REPLACE guard does not.
  const tablesOnly = evidence.EVIDENCE_MIGRATIONS.filter(migration => migration.version === 2)
  assert.equal(tablesOnly.length, 1)
  const legacy = await storage.openStore({
    path: databasePath(dir),
    migrations: [...storage.MYWORK_MIGRATIONS, ...tablesOnly],
  })
  const before = legacy.transaction(tx =>
    tx.all("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").map(row => row.name),
  )
  assert.deepEqual(before, [
    'artifacts_no_delete',
    'artifacts_no_update',
    'audit_events_no_delete',
    'audit_events_no_update',
  ])
  legacy.close()

  // Opening it with the current list applies the guard migration, so an existing
  // database is not silently left unguarded — the reason the guard has its own
  // version instead of editing the tables migration.
  const migrated = await openEvidenceDatabase(dir)
  const artifacts = evidence.createArtifactStore(migrated, { now: () => 4_200 })
  const { ref } = artifacts.put(artifactRequest())
  databaseRefusal(
    () =>
      migrated.transaction(tx =>
        tx.run(
          "INSERT OR REPLACE INTO artifacts (artifact_id, hash, kind, workspace_id, correlation_id, content_type, size, created_at, bytes) VALUES (?, ?, 'diff', 'W-1', 'corr-1', 'text/plain', 1, 1, x'00')",
          ref.artifactId,
          'a'.repeat(64),
        ),
      ),
    evidence.ARTIFACT_IMMUTABLE_MARKER,
  )
  assert.deepEqual(artifacts.get(ref).bytes, artifactRequest().bytes)
  migrated.close()
})

test('the audit appends §34 events and reads them back in order', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const audit = evidence.createAuditLog(store)

  const first = audit.append(auditEntry({ auditId: 'au-1', type: 'task.created', taskId: 'T-1' }))
  const second = audit.append(
    auditEntry({ auditId: 'au-2', type: 'attempt.assigned', taskId: 'T-1', attemptId: 'A-1', agentId: 'Neo-1' }),
  )
  const third = audit.append(auditEntry({ auditId: 'au-3', type: 'review.approved', artifactId: 'ev-1', occurredAt: 2_000 }))

  assert.deepEqual([first.appended, second.appended, third.appended], [true, true, true])
  assert.ok(first.position < second.position && second.position < third.position)

  const rows = audit.read()
  assert.deepEqual(rows.map(row => row.auditId), ['au-1', 'au-2', 'au-3'])
  assert.equal(rows[1].agentId, 'Neo-1')
  assert.equal(rows[2].artifactId, 'ev-1')
  assert.deepEqual(audit.read({ workspaceId: 'W-1' }).length, 3)
  assert.deepEqual(audit.read({ workspaceId: 'W-2' }), [])
  assert.deepEqual(audit.read({ limit: 2 }).map(row => row.auditId), ['au-1', 'au-2'])
  assert.deepEqual(audit.read({ type: 'review.approved' }).map(row => row.auditId), ['au-3'])
  store.close()
})

test('every §34 event type is accepted and an unknown one is refused', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const audit = evidence.createAuditLog(store)

  // Guard the loop below: on an empty vocabulary it would assert nothing. The
  // count is 11 of §34 plus the three ADR028 §5.18 additions the plan-mutation
  // path writes: gate.decided, plan.mutation.applied, plan.mutation.recovered.
  assert.equal(contracts.AUDIT_EVENT_TYPES.length, 14)
  for (const [index, type] of contracts.AUDIT_EVENT_TYPES.entries()) {
    audit.append(auditEntry({ auditId: `au-${index}`, type }))
  }
  assert.equal(audit.read().length, contracts.AUDIT_EVENT_TYPES.length)
  refusal(() => audit.append(auditEntry({ auditId: 'au-x', type: 'task.deleted' })), 'invalid-input')
  store.close()
})

test('retrying an audit row is a no-op, and contradicting it is refused', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const audit = evidence.createAuditLog(store)

  const first = audit.append(auditEntry())
  const retry = audit.append(auditEntry())
  assert.deepEqual([first.appended, retry.appended], [true, false])
  assert.equal(retry.position, first.position)

  refusal(() => audit.append(auditEntry({ type: 'review.rejected' })), 'audit-conflict')
  assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM audit_events').n)), 1)
  store.close()
})

test('the database itself refuses to rewrite or delete an audit row', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const audit = evidence.createAuditLog(store)
  audit.append(auditEntry())

  databaseRefusal(
    () => store.transaction(tx => tx.run("UPDATE audit_events SET type = 'human.override'")),
    evidence.AUDIT_APPEND_ONLY_MARKER,
  )
  databaseRefusal(() => store.transaction(tx => tx.run('DELETE FROM audit_events')), evidence.AUDIT_APPEND_ONLY_MARKER)
  assert.equal(audit.read().length, 1)
  store.close()
})

test('the audit survives a restart', async () => {
  const dir = tempDir()
  const path = databasePath(dir)
  const first = await openEvidenceDatabase(dir)
  const audit = evidence.createAuditLog(first)
  const artifacts = evidence.createArtifactStore(first, { now: () => 4_200 })
  audit.append(auditEntry({ auditId: 'au-before', type: 'task.created' }))
  const { ref } = artifacts.put(artifactRequest())
  first.close()

  const second = await storage.openStore({
    path,
    migrations: [...storage.MYWORK_MIGRATIONS, ...evidence.EVIDENCE_MIGRATIONS],
  })
  const reopenedAudit = evidence.createAuditLog(second)
  const reopenedArtifacts = evidence.createArtifactStore(second)
  assert.deepEqual(reopenedAudit.read().map(row => row.auditId), ['au-before'])
  assert.deepEqual(reopenedArtifacts.get(ref).bytes, artifactRequest().bytes)
  second.close()
})

test('the audit survives log rotation because it is not a log file', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const audit = evidence.createAuditLog(store)

  const logFile = join(dir, 'mywork.log')
  writeFileSync(logFile, 'controller mounted\nlifecycle line\n')
  audit.append(auditEntry({ auditId: 'au-kept', type: 'controller.failover' }))

  // Nothing but the database (and its WAL companions) may exist: the audit
  // writes no file, so rotation has no file of ours to truncate.
  const before = readdirSync(dir).sort()
  assert.deepEqual(
    before.filter(name => !name.endsWith('.sqlite') && !name.endsWith('.sqlite-wal') && !name.endsWith('.sqlite-shm')),
    ['mywork.log'],
  )

  // Rotate the log the way a log handler does: truncate, then delete.
  writeFileSync(logFile, '')
  rmSync(logFile)
  assert.equal(existsSync(logFile), false)

  store.close()
  const reopened = await openEvidenceDatabase(dir)
  const rows = evidence.createAuditLog(reopened).read()
  assert.deepEqual(rows.map(row => row.auditId), ['au-kept'])
  assert.equal(rows[0].type, 'controller.failover')
  reopened.close()
})

test('a REPLACE that would rewrite a row is refused, not applied', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const artifacts = evidence.createArtifactStore(store, { now: () => 4_200 })
  const audit = evidence.createAuditLog(store)
  const request = artifactRequest()
  const { ref } = artifacts.put(request)
  audit.append(auditEntry({ auditId: 'au-1', type: 'task.created' }))

  // `INSERT OR REPLACE` is plain DML: it needs no DDL, and the delete it
  // performs internally fires no DELETE trigger while `recursive_triggers = 0`.
  // The BEFORE INSERT guard is what has to stand in its way.
  const forged = new TextEncoder().encode('forged evidence')
  databaseRefusal(
    () =>
      store.transaction(tx =>
        tx.run(
          "INSERT OR REPLACE INTO artifacts (artifact_id, hash, kind, workspace_id, correlation_id, content_type, size, created_at, bytes) VALUES (?, ?, 'diff', 'W-1', 'corr-1', 'text/plain', ?, 1, ?)",
          ref.artifactId,
          sha256(forged),
          forged.byteLength,
          forged,
        ),
      ),
    evidence.ARTIFACT_IMMUTABLE_MARKER,
  )
  databaseRefusal(
    () =>
      store.transaction(tx =>
        tx.run(
          "INSERT OR REPLACE INTO audit_events (audit_id, type, workspace_id, correlation_id, occurred_at) VALUES ('au-1', 'human.override', 'W-1', 'corr-1', 1)",
        ),
      ),
    evidence.AUDIT_APPEND_ONLY_MARKER,
  )

  // The originals still stand, and the store still refuses the forged hash.
  assert.deepEqual(artifacts.get(ref).bytes, request.bytes)
  assert.deepEqual(
    audit.read().map(row => [row.auditId, row.type]),
    [['au-1', 'task.created']],
  )
  store.close()
})

test('opening a database without the evidence migration fails where it is wired', async () => {
  const dir = tempDir()
  const store = await storage.openStore({ path: databasePath(dir), migrations: storage.MYWORK_MIGRATIONS })
  refusal(() => evidence.createArtifactStore(store), 'schema-missing')
  refusal(() => evidence.createAuditLog(store), 'schema-missing')
  store.close()
})

test('the evidence tables reject a value of the wrong type instead of coercing it', async () => {
  const dir = tempDir()
  const store = await openEvidenceDatabase(dir)
  const artifacts = evidence.createArtifactStore(store, { now: () => 4_200 })
  artifacts.put(artifactRequest())

  // STRICT is really on for the evidence tables (the kernel's own suite proves
  // it for its tables). `size` is INTEGER, so a TEXT value in it must be refused
  // by SQLite rather than stored.
  databaseRefusal(
    () =>
      store.transaction(tx =>
        tx.run(
          "INSERT INTO artifacts (artifact_id, hash, kind, workspace_id, correlation_id, content_type, size, created_at, bytes) VALUES ('ev-2', ?, 'diff', 'W-1', 'corr-2', 'text/plain', 'twenty-six', 1, x'00')",
          sha256(new TextEncoder().encode('x')),
        ),
      ),
    'cannot store TEXT value in INTEGER column',
  )
  assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM artifacts').n)), 1)
  store.close()
})
