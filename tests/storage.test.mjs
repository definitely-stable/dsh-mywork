/**
 * Durable state acceptance (architecture §7, §47, §48, §61).
 *
 * What has to hold: a redelivered event does not change the outcome twice, a
 * restart keeps the data, a failure between the mutation and the commit leaves
 * no half change, the schema version is explicit and migrated, and the suite
 * never touches the live DSH home or its databases.
 *
 * Every database lives in a fresh temporary directory; nothing here reads the
 * harness state under `$DSH_HOME`.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test, { after } from 'node:test'

import { adapterTesting, repoRoot, storage } from './lib/fixtures.mjs'

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-storage-'))
  tempDirs.push(dir)
  return dir
}

/** The `state/registry.sqlite` path §7 describes, inside a temporary home. */
function statePath(dir, database = 'registry') {
  return storage.stateDatabasePath(storage.resolveMyWorkLayout({ dshHome: dir }), database)
}

/** A domain event as a transition would produce it. */
function eventFixture(overrides = {}) {
  return {
    type: 'task.state.changed',
    payload: { taskId: 'T-1', from: 'ready', to: 'assigned', at: 1_000 },
    ...overrides,
  }
}

/** Pending outbox rows of a store. */
function pendingCount(store) {
  return store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM outbox').n))
}

/** Rows of one product table. */
function countOf(store, table) {
  return store.transaction(tx => Number(tx.get(`SELECT COUNT(*) AS n FROM ${table}`).n))
}

const ORIGINAL_DSH_HOME_ENV = 'MYWORK_TEST_ORIGINAL_DSH_HOME'
const capturedDshHome = process.env[ORIGINAL_DSH_HOME_ENV]
const liveHome = storage.resolveMyWorkLayout({
  // run-tests.mjs captures this before any suite can repoint DSH_HOME. A direct
  // invocation has no capture, so its current environment is the original one.
  env: capturedDshHome === undefined ? process.env : { [storage.DSH_HOME_ENV]: capturedDshHome },
}).dshHome

/** What the live harness home looks like, without reading any of its files. */
function liveHomeFingerprint() {
  const root = join(liveHome, storage.MYWORK_DIR_NAME)
  return {
    exists: existsSync(root),
    entries: existsSync(root) ? readdirSync(root).sort() : [],
  }
}

const liveHomeBefore = liveHomeFingerprint()

after(() => {
  // The suite must not have created or changed anything under the live home.
  const liveHomeAfter = liveHomeFingerprint()
  const leftover = []
  for (const dir of tempDirs) {
    // One directory that cannot be removed must not stop the others: a failing
    // test can leave a database handle open on Windows.
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      leftover.push(dir)
    }
  }
  assert.deepEqual(liveHomeAfter, liveHomeBefore, 'the storage suite touched the live DSH home')
  assert.deepEqual(leftover, [], `temporary databases were left behind: ${leftover.join(', ')}`)
})

test('runtime state is rooted below DSH_HOME, never in the repository', () => {
  const dir = tempDir()
  const layout = storage.resolveMyWorkLayout({ dshHome: dir })
  assert.equal(layout.dshHome, dir)
  assert.equal(layout.root, join(dir, 'dsh-mywork'))
  assert.equal(layout.stateDir, join(dir, 'dsh-mywork', 'state'))
  assert.deepEqual([...storage.MYWORK_STATE_DATABASES], ['registry', 'controller'])
  assert.equal(basename(storage.stateDatabasePath(layout, 'registry')), 'registry.sqlite')
  assert.equal(storage.stateDatabasePath(layout, 'controller'), join(dir, 'dsh-mywork', 'state', 'controller.sqlite'))
  assert.equal(layout.root.startsWith(repoRoot), false, 'state must not live inside the repository')

  // Precedence: explicit path, then DSH_HOME, then ~/.dsh; blank means unset.
  assert.equal(storage.resolveMyWorkLayout({ dshHome: dir, env: { [storage.DSH_HOME_ENV]: join(dir, 'ignored') } }).dshHome, dir)
  assert.equal(storage.resolveMyWorkLayout({ env: { [storage.DSH_HOME_ENV]: join(dir, 'env') } }).dshHome, join(dir, 'env'))
  assert.equal(storage.resolveMyWorkLayout({ env: { [storage.DSH_HOME_ENV]: '   ' } }).dshHome, storage.defaultDshHome())
  assert.equal(storage.resolveMyWorkLayout({ env: {} }).dshHome, storage.defaultDshHome())
  assert.equal(storage.resolveMyWorkLayout({ env: { [storage.DSH_HOME_ENV]: '~/env-dsh' } }).dshHome, join(homedir(), 'env-dsh'))
})

test('the suite writes only into temporary directories', async () => {
  const store = await storage.openStore({ path: statePath(tempDir()), migrations: storage.MYWORK_MIGRATIONS })
  assert.ok(store.path.startsWith(tmpdir()), `expected a temporary database, got ${store.path}`)
  assert.equal(existsSync(join(repoRoot, 'state')), false, 'no state directory inside the repository')
  store.close()
})

test('a fresh database is stamped with the schema version, the journal, and WAL', async () => {
  const dir = tempDir()
  const clock = new adapterTesting.FakeClock(5_000)
  const store = await storage.openStore({ path: statePath(dir), clock, migrations: storage.MYWORK_MIGRATIONS })
  try {
    assert.equal(store.schemaVersion, storage.MYWORK_SCHEMA_VERSION)
    assert.ok(storage.MYWORK_SCHEMA_VERSION >= 1)
    assert.deepEqual(store.migrations, [{ version: 1, name: 'outbox-inbox', appliedAt: 5_000 }])
    assert.equal(store.transaction(tx => tx.get('PRAGMA journal_mode').journal_mode), 'wal')
    assert.equal(store.transaction(tx => tx.get('PRAGMA foreign_keys').foreign_keys), 1)
    // The write-ahead log is a real file while the connection is open.
    const stateDir = storage.resolveMyWorkLayout({ dshHome: dir }).stateDir
    const sidecars = readdirSync(stateDir).filter(entry => entry.startsWith('registry.sqlite-'))
    assert.ok(sidecars.includes('registry.sqlite-wal'), `expected a WAL sidecar, found ${sidecars.join(', ')}`)
  } finally {
    store.close()
  }
})

test('the tables are STRICT, so a wrong column type is refused by SQLite', async () => {
  const store = await storage.openStore({ path: statePath(tempDir()), migrations: storage.MYWORK_MIGRATIONS })
  try {
    assert.throws(
      () => store.transaction(tx => tx.run(
        'INSERT INTO inbox_dedup (consumer, event_id, processed_at) VALUES (?, ?, ?)',
        'c',
        'e',
        'not-a-number',
      )),
      /cannot store TEXT value in INTEGER column/,
    )
  } finally {
    store.close()
  }
})

test('an event applied twice changes the result only once', async () => {
  const store = await storage.openStore({ path: statePath(tempDir()), migrations: storage.MYWORK_MIGRATIONS })
  try {
    let effects = 0
    const first = store.transaction(tx => {
      const appended = tx.outbox.append({
        event: eventFixture(),
        workspaceId: 'W-1',
        correlationId: 'corr-1',
        eventId: 'e-1',
      })
      const applied = tx.inbox.applyOnce('task-projection', 'e-1', () => {
        effects += 1
        return 'projected'
      })
      return { appended, applied }
    })
    const second = store.transaction(tx => tx.inbox.applyOnce('task-projection', 'e-1', () => {
      effects += 1
      return 'projected'
    }))

    assert.equal(first.appended.duplicate, false)
    assert.deepEqual(first.applied, { applied: true, value: 'projected' })
    assert.deepEqual(second, { applied: false })
    assert.equal(effects, 1, 'the second delivery must not run the effect')
    assert.equal(pendingCount(store), 1, 'the redelivery must not append another event')
    assert.equal(store.inbox.isProcessed('task-projection', 'e-1'), true)
  } finally {
    store.close()
  }
})

test('dedup is per consumer: another consumer still sees the event as new', async () => {
  const store = await storage.openStore({ path: statePath(tempDir()), migrations: storage.MYWORK_MIGRATIONS })
  try {
    store.transaction(tx => tx.inbox.applyOnce('task-projection', 'e-9', () => 'ok'))
    const other = store.transaction(tx => tx.inbox.applyOnce('audit', 'e-9', () => 'ok'))
    assert.deepEqual(other, { applied: true, value: 'ok' })
    assert.equal(store.inbox.isProcessed('task-projection', 'e-9'), true)
    assert.equal(store.inbox.isProcessed('audit', 'e-9'), true)
    assert.equal(store.inbox.isProcessed('scheduler', 'e-9'), false)
    assert.equal(countOf(store, 'inbox_dedup'), 2)
  } finally {
    store.close()
  }
})

test('a restart keeps the schema version, the queued events, and the dedup ledger', async () => {
  const dir = tempDir()
  const path = statePath(dir)
  const first = await storage.openStore({ path, migrations: storage.MYWORK_MIGRATIONS })
  let queued
  try {
    first.transaction(tx => {
      tx.outbox.append({ event: eventFixture(), workspaceId: 'W-1', correlationId: 'corr-1', eventId: 'e-restart' })
      tx.inbox.applyOnce('task-projection', 'e-restart', () => 'projected')
    })
    ;[queued] = first.outbox.pending()
  } finally {
    // Closed here rather than after the assertions: a failing assertion must not
    // leave the database handle open, or the temporary directory cannot be removed.
    first.close()
  }

  const second = await storage.openStore({ path, migrations: storage.MYWORK_MIGRATIONS })
  try {
    assert.equal(second.schemaVersion, storage.MYWORK_SCHEMA_VERSION)
    assert.equal(second.migrations.length, 1)
    const [again] = second.outbox.pending()
    assert.deepEqual(again.envelope, queued.envelope, 'the envelope must survive the restart unchanged')
    assert.deepEqual(again, queued)
    assert.equal(second.inbox.isProcessed('task-projection', 'e-restart'), true)
    const redelivery = second.transaction(tx => tx.inbox.applyOnce('task-projection', 'e-restart', () => 'again'))
    assert.deepEqual(redelivery, { applied: false }, 'dedup must survive the restart')
  } finally {
    second.close()
  }
})

test('a failure between the mutation and the commit leaves no half change', async () => {
  const store = await storage.openStore({ path: statePath(tempDir()), migrations: storage.MYWORK_MIGRATIONS })
  try {
    let visibleInside = null
    assert.throws(
      () => store.transaction(tx => {
        tx.outbox.append({ event: eventFixture(), workspaceId: 'W-1', correlationId: 'corr-1', eventId: 'e-fault' })
        tx.inbox.applyOnce('task-projection', 'e-fault', () => 'projected')
        visibleInside = {
          outbox: Number(tx.get('SELECT COUNT(*) AS n FROM outbox').n),
          dedup: Number(tx.get('SELECT COUNT(*) AS n FROM inbox_dedup').n),
        }
        throw new Error('injected failure before commit')
      }),
      /injected failure before commit/,
    )

    // Both writes were visible inside the transaction and neither survived it.
    assert.deepEqual(visibleInside, { outbox: 1, dedup: 1 })
    assert.deepEqual(store.outbox.pending(), [])
    assert.equal(store.inbox.isProcessed('task-projection', 'e-fault'), false)
    assert.equal(countOf(store, 'outbox'), 0)
    assert.equal(countOf(store, 'inbox_dedup'), 0)

    // The rolled-back dedup row does not block the retry.
    const retry = store.transaction(tx => tx.inbox.applyOnce('task-projection', 'e-fault', () => 'projected'))
    assert.deepEqual(retry, { applied: true, value: 'projected' })
  } finally {
    store.close()
  }
})

test('the outbox keeps one stream per workspace and is idempotent by event id', async () => {
  const store = await storage.openStore({ path: statePath(tempDir()), migrations: storage.MYWORK_MIGRATIONS })
  try {
    const result = store.transaction(tx => {
      const one = tx.outbox.append({ event: eventFixture(), workspaceId: 'W-1', correlationId: 'corr-1', eventId: 'e-1' })
      const two = tx.outbox.append({ event: eventFixture({ type: 'task.review.requested' }), workspaceId: 'W-1', correlationId: 'corr-1' })
      const other = tx.outbox.append({ event: eventFixture(), workspaceId: 'W-2', correlationId: 'corr-2' })
      return { one, two, other }
    })

    assert.equal(result.one.envelope.sequence, 1)
    assert.equal(result.two.envelope.sequence, 2, 'the stream of a workspace is monotonic')
    assert.equal(result.other.envelope.sequence, 1, 'another workspace starts its own stream')
    assert.equal(result.one.envelope.schema, 'mywork.event/v1')
    assert.equal(result.one.duplicate, false)
    assert.match(result.two.envelope.eventId, /^[0-9a-f-]{36}$/, 'a missing event id is generated')

    const pending = store.outbox.pending()
    assert.deepEqual(pending.map(record => [record.envelope.workspaceId, record.envelope.sequence]), [['W-1', 1], ['W-1', 2], ['W-2', 1]])
    assert.deepEqual(store.outbox.pending({ workspaceId: 'W-1', limit: 1 }).map(record => record.envelope.sequence), [1])

    // Re-appending the same event is a no-op; the same id with other content is a conflict.
    const repeat = store.transaction(tx => tx.outbox.append({ event: eventFixture(), workspaceId: 'W-1', correlationId: 'corr-1', eventId: 'e-1' }))
    assert.equal(repeat.duplicate, true)
    assert.equal(repeat.envelope.sequence, 1)
    assert.equal(countOf(store, 'outbox'), 3)
    assert.throws(
      () => store.transaction(tx => tx.outbox.append({
        event: eventFixture({ payload: { taskId: 'T-1', from: 'ready', to: 'executing', at: 1_000 } }),
        workspaceId: 'W-1',
        correlationId: 'corr-1',
        eventId: 'e-1',
      })),
      error => error.code === 'conflict' && /never reused/.test(error.message),
    )
    assert.equal(countOf(store, 'outbox'), 3, 'a rejected append writes nothing')
  } finally {
    store.close()
  }
})

test('a failed delivery keeps the event queued and a delivered one leaves the queue', async () => {
  const clock = new adapterTesting.FakeClock(10_000)
  const store = await storage.openStore({ path: statePath(tempDir()), clock, migrations: storage.MYWORK_MIGRATIONS })
  try {
    store.transaction(tx => tx.outbox.append({ event: eventFixture(), workspaceId: 'W-1', correlationId: 'corr-1', eventId: 'e-1' }))
    await clock.advance(500)
    store.transaction(tx => tx.outbox.markFailed('e-1', new Error('publisher unreachable')))

    const [failed] = store.outbox.pending()
    assert.equal(failed.status, 'pending', 'a failed attempt must not drop the event')
    assert.equal(failed.attempts, 1)
    assert.equal(failed.lastError, 'publisher unreachable')

    store.transaction(tx => tx.outbox.markDelivered('e-1'))
    assert.deepEqual(store.outbox.pending(), [])
    const delivered = store.outbox.get('e-1')
    assert.equal(delivered.status, 'delivered')
    assert.equal(delivered.deliveredAt, 10_500)

    assert.throws(
      () => store.transaction(tx => tx.outbox.markDelivered('e-missing')),
      error => error.code === 'not-found',
    )
    assert.equal(store.outbox.get('e-missing'), undefined)
  } finally {
    store.close()
  }
})

test('invalid input is refused before anything is written', async () => {
  const store = await storage.openStore({ path: statePath(tempDir()), migrations: storage.MYWORK_MIGRATIONS })
  try {
    const cases = [
      () => store.transaction(tx => tx.outbox.append({ event: eventFixture(), workspaceId: 'W-1', correlationId: 'corr-1', eventId: '' })),
      () => store.transaction(tx => tx.outbox.append({ event: eventFixture(), workspaceId: '', correlationId: 'corr-1' })),
      () => store.transaction(tx => tx.outbox.append({ event: eventFixture({ type: 'nope' }), workspaceId: 'W-1', correlationId: 'corr-1' })),
      () => store.transaction(tx => tx.outbox.append({ event: eventFixture({ payload: { at: new Date(0) } }), workspaceId: 'W-1', correlationId: 'corr-1' })),
      () => store.transaction(tx => tx.outbox.append({ event: eventFixture({ payload: { dropped: undefined } }), workspaceId: 'W-1', correlationId: 'corr-1' })),
      () => store.transaction(tx => tx.inbox.applyOnce('', 'e-1', () => 'x')),
      () => store.transaction(tx => tx.inbox.applyOnce('consumer', '', () => 'x')),
      () => store.outbox.pending({ limit: 0 }),
      () => store.outbox.pending({ workspaceId: '' }),
    ]
    for (const run of cases) {
      assert.throws(run, error => error.code === 'invalid-input' && error.name === 'StorageError', String(run))
    }
    assert.equal(countOf(store, 'outbox'), 0)
    assert.equal(countOf(store, 'inbox_dedup'), 0)

    // The store is synchronous by construction: an async body would commit early.
    assert.throws(
      () => store.transaction(async () => 'later'),
      error => error.code === 'invalid-input' && /synchronous/.test(error.message),
    )
    assert.equal(countOf(store, 'outbox'), 0)

    // Transactions do not nest, and a store cannot close inside one.
    assert.throws(
      () => store.transaction(() => store.transaction(() => 'inner')),
      error => error.code === 'transaction-conflict',
    )
    assert.throws(
      () => store.transaction(() => store.close()),
      error => error.code === 'transaction-conflict',
    )
    assert.throws(
      () => store.transaction(tx => tx.inbox.applyOnce('c', 'e', async () => 'later')),
      error => error.code === 'invalid-input' && /synchronously/.test(error.message),
    )
  } finally {
    store.close()
  }
})

test('a closed store refuses further work, and there is no in-memory mode', async () => {
  const store = await storage.openStore({ path: statePath(tempDir()), migrations: storage.MYWORK_MIGRATIONS })
  store.close()
  assert.throws(() => store.schemaVersion, error => error.code === 'store-closed')
  assert.throws(() => store.outbox, error => error.code === 'store-closed')
  assert.throws(() => store.transaction(() => 'x'), error => error.code === 'store-closed')
  assert.throws(() => store.close(), error => error.code === 'store-closed')

  await assert.rejects(
    () => storage.openStore({ path: ':memory:', migrations: storage.MYWORK_MIGRATIONS }),
    error => error.code === 'invalid-input' && /durable/.test(error.message),
  )
  await assert.rejects(
    () => storage.openStore({ path: statePath(tempDir()), busyTimeoutMs: -1, migrations: storage.MYWORK_MIGRATIONS }),
    error => error.code === 'invalid-input',
  )
})

test('migrations are ordered, and a failing migration leaves the previous version', async () => {
  const dir = tempDir()
  const path = statePath(dir)
  const failing = [
    { version: 1, name: 'outbox-inbox', up: context => context.exec('CREATE TABLE scratch (id TEXT NOT NULL PRIMARY KEY) STRICT') },
    { version: 2, name: 'broken', up: context => {
      context.exec('CREATE TABLE half (id TEXT NOT NULL PRIMARY KEY) STRICT')
      throw new Error('migration 2 is broken')
    } },
  ]

  await assert.rejects(
    () => storage.openStore({ path, migrations: failing }),
    error => error.code === 'migration-failed'
      && error.details.version === 2
      && error.details.at === 1,
  )

  // The database is still at version 1, with no trace of the broken migration.
  const store = await storage.openStore({ path, migrations: failing.slice(0, 1) })
  try {
    assert.equal(store.schemaVersion, 1)
    assert.deepEqual(store.migrations.map(row => row.version), [1])
    assert.equal(
      store.transaction(tx => tx.get("SELECT name FROM sqlite_master WHERE name = 'half'")),
      undefined,
      'the half-migrated table must not exist',
    )
    assert.equal(store.transaction(tx => tx.get("SELECT name FROM sqlite_master WHERE name = 'scratch'").name), 'scratch')
  } finally {
    store.close()
  }

  // A malformed list never reaches the database.
  const badLists = [
    [{ version: 2, name: 'a', up: () => {} }, { version: 1, name: 'b', up: () => {} }],
    [{ version: 1, name: 'a', up: () => {} }, { version: 1, name: 'b', up: () => {} }],
    [{ version: 0, name: 'a', up: () => {} }],
    [{ version: 1, name: '  ', up: () => {} }],
    [{ version: 1, name: 'a' }],
  ]
  for (const migrations of badLists) {
    await assert.rejects(
      () => storage.openStore({ path: statePath(tempDir()), migrations }),
      error => error.code === 'invalid-input',
    )
  }
})

test('a database written by a newer build is refused, not downgraded', async () => {
  const dir = tempDir()
  const path = statePath(dir)
  const older = [{ version: 1, name: 'outbox-inbox', up: context => context.exec('CREATE TABLE t1 (id TEXT NOT NULL PRIMARY KEY) STRICT') }]
  const newer = [...older, { version: 2, name: 'second', up: context => context.exec('CREATE TABLE t2 (id TEXT NOT NULL PRIMARY KEY) STRICT') }]

  const upgraded = await storage.openStore({ path, migrations: newer })
  try {
    assert.equal(upgraded.schemaVersion, 2)
  } finally {
    upgraded.close()
  }

  await assert.rejects(
    () => storage.openStore({ path, migrations: older }),
    error => error.code === 'schema-version-unsupported'
      && error.details.onDisk === 2
      && error.details.supported === 1,
  )

  // Reopening with the build that produced it is fine, and applies nothing twice.
  const again = await storage.openStore({ path, migrations: newer })
  try {
    assert.equal(again.schemaVersion, 2)
    assert.deepEqual(again.migrations.map(row => row.version), [1, 2])
  } finally {
    again.close()
  }
})

test('two connections on one file share the state and each migration runs once', async () => {
  const path = statePath(tempDir())
  const writer = await storage.openStore({ path, migrations: storage.MYWORK_MIGRATIONS })
  const reader = await storage.openStore({ path, migrations: storage.MYWORK_MIGRATIONS })
  try {
    writer.transaction(tx => tx.outbox.append({ event: eventFixture(), workspaceId: 'W-1', correlationId: 'corr-1', eventId: 'e-shared' }))
    assert.deepEqual(reader.outbox.pending().map(record => record.envelope.eventId), ['e-shared'])
    assert.deepEqual(reader.migrations.map(row => row.version), [1], 'a second open must not re-apply a migration')
    assert.equal(reader.schemaVersion, 1)
  } finally {
    writer.close()
    reader.close()
  }
})
