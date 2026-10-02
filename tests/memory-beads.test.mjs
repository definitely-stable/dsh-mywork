/**
 * Beads memory provider acceptance (architecture §23.8, §37, §39, §44, §57;
 * §62 item 26).
 *
 * Three layers, and the split is deliberate:
 *
 * - **The §39 suite itself** runs against a scripted `bd` that answers exactly
 *   the payloads Beads 1.3.0 was probed for. Every required check has to execute
 *   — a `skipped` check is reported as skipped, never as a pass.
 * - **Policy** — capability honesty, the key namespace, the id source, and the
 *   writer routing the fabric performs over two providers. These are checked
 *   directly, because a wrong answer here is a silent one: a provider that
 *   emulated `reflect`, or a route that wrote a workspace record into the native
 *   store, would look exactly like a success.
 * - **A real `bd`** — the same provider, the same §39 suite, against a Beads
 *   workspace created **outside the repository tree** (`bd` resolves any command
 *   from a repository subdirectory to the *ancestor's* workspace, so a fixture
 *   inside the repo would be testing the repo's own `.beads`). This layer is what
 *   keeps the scripted one honest: it asserts the raw payload shapes the fake
 *   reproduces, and it is skipped loudly — never silently — when no `bd` can be
 *   reached.
 *
 * `bd` is reached through its JavaScript entry with file-backed stdio rather
 * than through the npm shim with pipes: the DSH file sandbox blocks a child that
 * opens a pipe (`spawn EPERM`), and `scripts/lib/process.mjs` is this
 * repository's answer to that.
 */

import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'

import { runCaptured } from '../scripts/lib/process.mjs'
import { adapterSdk, adapterTesting, beads, contracts, core, memoryNative, repoRoot } from './lib/fixtures.mjs'

// The §44 row mounts the controller, which opens its SQLite state under
// `$DSH_HOME`; the variable is pinned to `.tmp` before that bundle is imported,
// so this suite never writes into a live profile.
scratchDshHome('memory-beads')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Directories this suite created, removed at the end. */
const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-membeads-'

after(() => {
  const leftover = []
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      leftover.push(dir)
    }
  }
  assert.deepEqual(leftover, [], `temporary workspaces were left behind: ${leftover.join(', ')}`)
})

/** A fresh temporary directory, outside the repository tree on purpose. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  tempDirs.push(dir)
  return dir
}

/** A scope the fixtures use. */
function workspaceScope(id) {
  return { type: 'workspace', id }
}

/** Operation identity for a fabric call. */
function meta(overrides = {}) {
  return core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1', ...overrides })
}

/** A proposal the fabric accepts. */
function proposal(overrides = {}) {
  return {
    statement: 'the beads memory provider holds what it was asked to hold',
    scope: workspaceScope('fixture'),
    kind: 'fact',
    sources: [],
    createdBy: { component: 'mw019-test' },
    trust: 'high',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// The scripted backend
// ---------------------------------------------------------------------------

/**
 * A `bd` seam that answers the payloads Beads 1.3.0 was probed for.
 *
 * It is a *contract emulation*, not a convenient stub: the real-`bd` layer below
 * asserts the same shapes against the binary, which is what stops this fake from
 * drifting into a description of what the adapter wishes Beads did.
 */
function fakeBd(options = {}) {
  /** Key-value entries, exactly as `bd kv list` reports them. */
  const entries = new Map()
  /** `bd remember` entries, which share the listing under a `memory.` prefix. */
  const memories = new Map()
  const calls = []
  const schemaVersion = options.schemaVersion ?? 1
  const neverAnswers = options.neverAnswers === true

  return {
    get calls() {
      return calls
    },
    get entries() {
      return entries
    },
    /** Seed an entry the way `bd kv set` would. */
    seed(key, value) {
      entries.set(key, value)
    },
    /** Seed a `bd remember` entry, which the listing shows under `memory.`. */
    seedMemory(key, value) {
      memories.set(key, value)
    },
    runner: {
      async run(command) {
        calls.push(command)
        if (neverAnswers) return new Promise(() => {})
        const args = [...command.args]
        const [group, verb, ...rest] = args
        const json = payload => JSON.stringify(payload)
        if (group === '--version') return { code: 0, stdout: 'bd version 1.3.0 (f45b249ce)', stderr: '' }
        if (group === 'ping') return { code: 0, stdout: '\u2713 bd ping: ok (22ms)', stderr: '' }
        if (group === 'kv' && verb === 'set') {
          const [key, value] = rest
          if (String(key).startsWith('memory.')) {
            return {
              code: 1,
              stdout: json({
                error:
                  'invalid key: key cannot start with "memory." (reserved for persistent memories; use \'bd remember\' / \'bd forget\')',
                schema_version: schemaVersion,
              }),
              stderr: '',
            }
          }
          entries.set(key, value)
          return { code: 0, stdout: json({ key, schema_version: schemaVersion, value }), stderr: '' }
        }
        if (group === 'kv' && verb === 'get') {
          const [key] = rest
          const found = entries.has(key)
          return {
            code: found ? 0 : 1,
            stdout: json({ found, key, schema_version: schemaVersion, value: found ? entries.get(key) : '' }),
            stderr: found ? '' : `No key "${String(key)}"`,
          }
        }
        if (group === 'kv' && verb === 'list') {
          const payload = { schema_version: schemaVersion }
          for (const [key, value] of memories) payload[`memory.${key}`] = value
          for (const [key, value] of entries) payload[key] = value
          return { code: 0, stdout: json(payload), stderr: '' }
        }
        return { code: 1, stdout: '', stderr: `unknown command: ${args.join(' ')}` }
      },
    },
  }
}

/** A runner whose backend is not there at all. */
function absentRunner() {
  return {
    async run() {
      const error = new Error('spawn bd ENOENT')
      error.code = 'ENOENT'
      throw error
    },
  }
}

/** A provider over a scripted backend, in a directory with no workspace. */
function scriptedProvider(options = {}) {
  const fake = options.fake ?? fakeBd(options)
  const cwd = options.cwd ?? tempDir()
  const provider = beads.createBeadsMemoryProvider({
    runner: fake.runner,
    cwd,
    ...(options.beadsDir === undefined ? {} : { beadsDir: options.beadsDir }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.keyPrefix === undefined ? {} : { keyPrefix: options.keyPrefix }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  return { fake, provider, cwd }
}

/** The §39 suite plus the registry contract, run over one provider. */
async function conformanceOf(options) {
  const registration = {
    kind: 'memory',
    id: 'beads',
    contractVersion: 'memory/v1',
    capabilities: beads.BEADS_MEMORY_MANIFEST.capabilities,
    create: () => options.provider,
  }
  return adapterSdk.runConformance({
    kind: 'memory',
    adapterId: 'beads',
    contractVersion: 'memory/v1',
    clock: new adapterTesting.FakeClock(1_000),
    checks: [
      ...adapterSdk.commonAdapterChecks({ registration, context: undefined }),
      ...adapterSdk.memoryChecks(options),
    ],
  })
}

// ---------------------------------------------------------------------------
// The real backend
// ---------------------------------------------------------------------------

/** The real Beads program, as the npm shim launches it. */
function bdEntryPoint() {
  const candidates = []
  if (process.env.BD_BIN !== undefined) candidates.push(process.env.BD_BIN)
  if (process.env.APPDATA !== undefined) {
    candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', '@beads', 'bd', 'bin', 'bd.js'))
  }
  candidates.push(join(dirname(process.execPath), 'node_modules', '@beads', 'bd', 'bin', 'bd.js'))
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir.length > 0) candidates.push(join(dir, 'node_modules', '@beads', 'bd', 'bin', 'bd.js'))
  }
  return candidates.find(candidate => existsSync(candidate))
}

const BD_JS = bdEntryPoint()

if (BD_JS === undefined) {
  // Say it once, loudly. A skipped suite that looks like a pass is the failure
  // mode this project has been bitten by.
  process.stderr.write(
    'memory-beads: the real-bd checks are SKIPPED — the Beads JavaScript entry could not be located. ' +
      'These are not passes.\n',
  )
}

/** Run the real `bd` in a directory, capturing its streams in files. */
function realBd(cwd, args, logDir = cwd) {
  const result = runCaptured(process.execPath, [BD_JS, ...args], {
    cwd,
    env: process.env,
    logDir,
    logName: `bd-${args.join('-').replace(/[^A-Za-z0-9-]/g, '_').slice(0, 60)}`,
  })
  assert.equal(result.error, undefined, `bd ${args.join(' ')} could not be spawned: ${String(result.error)}`)
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

/** A runner over the real `bd`, with file-backed stdio instead of pipes. */
function fileBackedRunner(logDir) {
  let count = 0
  return {
    async run(command) {
      count += 1
      const result = runCaptured(process.execPath, [BD_JS, ...command.args], {
        cwd: command.cwd,
        env: command.env === undefined ? process.env : { ...process.env, ...command.env },
        logDir,
        logName: `call-${count}`,
      })
      if (result.error !== undefined) throw result.error
      return {
        code: result.status ?? 1,
        stdout: result.stdout.replace(/\r?\n$/, ''),
        stderr: result.stderr.replace(/\r?\n$/, ''),
      }
    },
  }
}

/** A real Beads workspace outside the repository tree. */
function makeRealWorkspace() {
  const dir = tempDir()
  const init = realBd(dir, ['init', '--prefix', 'mw19', '--skip-agents', '--skip-hooks'])
  assert.equal(init.code, 0, `bd init failed: ${init.stderr}`)
  return dir
}

/** One restart probe process, as the JSON line it printed. */
function runRestartChild(workspace, mode, label) {
  const result = runCaptured(
    process.execPath,
    [join(repoRoot, 'tests', 'lib', 'mw019-restart-child.mjs'), workspace, BD_JS, mode, label],
    { cwd: repoRoot, env: process.env, logDir: join(workspace, 'logs'), logName: `restart-${mode}-${label}` },
  )
  assert.equal(result.error, undefined, `the restart child could not be spawned: ${String(result.error)}`)
  const lines = result.stdout.trim().split('\n').filter(line => line.startsWith('{'))
  assert.ok(lines.length > 0, `the restart child reported nothing: ${result.stdout}${result.stderr}`)
  return JSON.parse(lines[lines.length - 1])
}

/** A provider over a real workspace. */
function realProvider(cwd, options = {}) {
  return beads.createBeadsMemoryProvider({
    runner: fileBackedRunner(join(cwd, 'logs')),
    cwd,
    ...(options.resolveWorkspace === false ? {} : { beadsDir: join(cwd, '.beads') }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })
}

/** A route, in the shape the fabric's policy normaliser requires. */
function route(scopeType, primary, optional = false) {
  return { match: { scope: scopeType }, primary, optional }
}

// ---------------------------------------------------------------------------
// The §39 suite
// ---------------------------------------------------------------------------

test('the §39 memory suite covers every required check against the scripted backend', async () => {
  const { fake, provider } = scriptedProvider()
  const report = await conformanceOf({
    provider,
    idPrefix: 'scripted',
    scopes: [workspaceScope('scripted-a'), workspaceScope('scripted-b')],
    deadlineMs: 250,
    unresponsive: () => scriptedProvider({ neverAnswers: true, timeoutMs: 250 }).provider,
    unavailable: () =>
      beads.createBeadsMemoryProvider({ runner: absentRunner(), cwd: tempDir(), timeoutMs: 250 }),
    mismatched: () => scriptedProvider({ schemaVersion: 2 }).provider,
  })

  assert.deepEqual(report.missing, [], 'every §39 memory check must have executed')
  assert.equal(report.failed, 0, JSON.stringify(report.results.filter(result => result.status === 'failed'), null, 2))
  assert.equal(report.skipped, 0, JSON.stringify(report.results.filter(result => result.status === 'skipped'), null, 2))
  // The nine §39 names have to be the names that ran, not paraphrases that
  // `missing` would not recognise.
  const executed = new Set(report.results.map(result => result.name))
  assert.deepEqual(
    [...adapterSdk.REQUIRED_CONFORMANCE_CHECKS.memory].filter(name => !executed.has(name)),
    [],
    'every name §39 lists must be the name of a check that ran',
  )
  // The store the checks wrote through is the scripted one, so what they proved
  // is that the adapter drives it correctly — and nothing leaked out of the
  // namespace it owns.
  assert.ok(fake.calls.length > 0, 'the checks must have driven the backend')
  for (const key of fake.entries.keys()) {
    assert.ok(key.startsWith(beads.BEADS_MEMORY_KEY_PREFIX), `an unexpected key was written: ${key}`)
    assert.ok(!key.startsWith('memory.'), `a key in the reserved namespace was written: ${key}`)
  }
})

test('a retention is two invocations, and a recall is one', async () => {
  const { fake, provider } = scriptedProvider()
  const record = {
    id: 'mem-beads-1',
    statement: 'a record the adapter is asked to hold',
    scope: workspaceScope('counted'),
    kind: 'fact',
    sources: [],
    createdBy: { component: 'mw019-test' },
    trust: 'high',
    validity: {},
    supersedes: [],
    status: 'active',
    revision: 1,
    contentHash: 'hash-1',
    fingerprint: 'fp-1',
    retainedAt: 1_700_000_000_000,
    statusChangedAt: 1_700_000_000_000,
    reinforcedCount: 0,
  }
  await provider.retain({ record, mode: 'create' })
  assert.deepEqual(
    fake.calls.map(call => call.args.slice(0, 2).join(' ')),
    ['kv get', 'kv set'],
    'the store reports no created/updated signal, so existence is read before the write',
  )

  // Idempotence is the *absence* of the second write, and the port cannot show
  // that: it has no write counter, so the record it answers with looks the same
  // whether or not the store was rewritten. The call sequence can show it, and
  // that is the only place it can be shown.
  fake.calls.length = 0
  const repeated = await provider.retain({ record, mode: 'create' })
  assert.equal(repeated.created, false)
  assert.deepEqual(
    fake.calls.map(call => call.args.slice(0, 2).join(' ')),
    ['kv get'],
    'a repeated retention must read the record and stop — a second `kv set` is a rewrite nobody asked for',
  )

  fake.calls.length = 0
  await provider.recall({ scopes: [workspaceScope('counted')] })
  assert.deepEqual(fake.calls.map(call => call.args.slice(0, 2).join(' ')), ['kv list'])
})

test('the adapter declares reflect and versioning unsupported rather than emulating them', async () => {
  // The provider has to be reachable: the fabric asks for availability before
  // every call, including the one that discovers a capability is missing.
  const { provider } = scriptedProvider({ beadsDir: join(tempDir(), '.beads') })
  const capabilities = await provider.capabilities()
  assert.equal(capabilities.reflect, false, 'Beads has no reflection operation')
  assert.equal(provider.reflect, undefined, 'no reflection method may exist for a capability declared false')
  assert.equal(capabilities.resolve, true)
  assert.equal(beads.BEADS_MEMORY_MANIFEST.capabilities.reflect, false)
  assert.equal(beads.BEADS_MEMORY_MANIFEST.capabilities.versioning, false, 'bd kv set overwrites in place')
  assert.equal(beads.BEADS_MEMORY_MANIFEST.capabilities.structuredScopes, false)
  assert.equal(beads.BEADS_MEMORY_MANIFEST.contractVersion, 'memory/v1')

  // The fabric reads the declaration, so an unsupported reflection is refused
  // rather than answered with a digest this adapter made up.
  const fabric = core.createMemoryFabric({
    providers: [{ provider: 'beads', port: provider }],
    policy: { routes: [route('workspace', 'beads')], timeoutMs: 2_000, diagnosticLimit: 20 },
  })
  const reflected = await fabric.reflect({
    scope: workspaceScope('reflect-probe'),
    nowMs: 1_700_000_000_000,
    meta: meta(),
  })
  assert.equal(reflected.ok, false)
  assert.equal(reflected.code, 'CAPABILITY_UNSUPPORTED')
  assert.equal(reflected.reason, 'reflect-unsupported')
  assert.ok(
    reflected.diagnostics.some(entry => entry.code === 'reflect-unsupported'),
    'the refusal must carry the diagnostic a Doctor reads',
  )
})

test('a backend that answers in another schema is refused, never decoded by guesswork', async () => {
  const { provider } = scriptedProvider({ schemaVersion: 2 })
  await assert.rejects(
    () => provider.recall({ scopes: [workspaceScope('schema')] }),
    error => error.code === 'CONTRACT_MISMATCH',
  )

  // A value this adapter owns that it cannot read is the same class of failure:
  // a half-understood record would enter the fabric wearing the authority of a
  // validated one, so it is refused rather than skipped.
  const planted = scriptedProvider()
  planted.fake.seed(`${beads.BEADS_MEMORY_KEY_PREFIX}planted`, 'not-an-envelope')
  await assert.rejects(
    () => planted.provider.recall({ scopes: [workspaceScope('planted')] }),
    error => error.code === 'CONTRACT_MISMATCH' && /planted/.test(error.message),
  )

  // A well-formed envelope naming another record is a forgery, not a record.
  const swapped = scriptedProvider()
  swapped.fake.seed(
    `${beads.BEADS_MEMORY_KEY_PREFIX}one`,
    JSON.stringify({
      schema: beads.BEADS_MEMORY_PAYLOAD_SCHEMA,
      record: {
        id: 'another',
        statement: 's',
        scope: workspaceScope('x'),
        kind: 'fact',
        sources: [],
        createdBy: { component: 'c' },
        trust: 'high',
        validity: {},
        supersedes: [],
        status: 'active',
        revision: 1,
        contentHash: 'h',
        fingerprint: 'f',
        retainedAt: 1,
        statusChangedAt: 1,
        reinforcedCount: 0,
      },
    }),
  )
  await assert.rejects(
    () => swapped.provider.recall({ scopes: [workspaceScope('x')] }),
    error => error.code === 'CONTRACT_MISMATCH',
  )
})

test('an absent backend refuses, and never answers as an empty store', async () => {
  const cwd = tempDir()
  const provider = beads.createBeadsMemoryProvider({ runner: absentRunner(), cwd, timeoutMs: 500 })
  const health = await provider.health()
  assert.equal(health.available, false)
  assert.equal(health.reason, 'no-workspace')

  await assert.rejects(
    () => provider.recall({ scopes: [workspaceScope('absent')] }),
    error => error.code === 'ADAPTER_UNAVAILABLE',
    '"I know nothing" and "I cannot answer" are different answers',
  )

  // Through the fabric the same fact becomes a refusal, not an empty recall:
  // §49 degrades a read only where the route says the memory is optional.
  const fabric = core.createMemoryFabric({
    providers: [{ provider: 'beads', port: provider }],
    policy: { routes: [route('workspace', 'beads')], timeoutMs: 2_000, diagnosticLimit: 20 },
  })
  const recalled = await fabric.recall({ scopes: [workspaceScope('absent')], meta: meta() })
  assert.equal(recalled.ok, false)
  assert.equal(recalled.reason, 'provider-unavailable')
  assert.equal(recalled.code, 'ADAPTER_UNAVAILABLE')
})

test('a backend that never answers is refused inside the deadline the adapter declares', async () => {
  const { provider } = scriptedProvider({ neverAnswers: true, timeoutMs: 250 })
  const started = Date.now()
  await assert.rejects(
    () => provider.recall({ scopes: [workspaceScope('hung')] }),
    error => error.code === 'ADAPTER_UNAVAILABLE' && /250ms/.test(error.message),
  )
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 200 && elapsed < 2_000, `the deadline must be the adapter's own, took ${elapsed}ms`)

  // The bound is the provider's, not the runner's: a runner that never answers
  // cannot hang a fabric call.
  const bare = { async run() { return new Promise(() => {}) } }
  const bounded = beads.createBeadsMemoryProvider({ runner: bare, cwd: tempDir(), timeoutMs: 200 })
  await assert.rejects(
    () => bounded.retain({ record: { id: 'x' }, mode: 'create' }),
    error => error.code === 'ADAPTER_UNAVAILABLE' || error instanceof TypeError,
  )
})

test('health answers from the filesystem, without spawning the backend', async () => {
  const { fake, provider } = scriptedProvider()
  const health = await provider.health()
  assert.equal(health.available, false, 'a directory with no workspace above it has no backend')
  assert.equal(health.reason, 'no-workspace')
  assert.deepEqual(fake.calls, [], 'the fabric asks before every call, so health may not spawn')

  const workspace = tempDir()
  const { fake: seeded, provider: withWorkspace } = scriptedProvider({ cwd: workspace, beadsDir: join(workspace, '.beads') })
  const available = await withWorkspace.health()
  assert.equal(available.available, true)
  assert.deepEqual(seeded.calls, [])
})

test('§57 diagnostics read the version and connectivity on demand', async () => {
  const { provider } = scriptedProvider({ beadsDir: join(tempDir(), '.beads') })
  const report = await provider.diagnostics()
  assert.equal(report.adapterId, 'beads')
  assert.equal(report.contractVersion, 'memory/v1')
  assert.equal(report.installedVersion, '1.3.0')
  assert.equal(report.connectivity, 'ok')
  assert.equal(report.capabilities.reflect, false)
  assert.equal(report.timeoutMs, beads.DEFAULT_MEMORY_COMMAND_TIMEOUT_MS)
  assert.equal(Object.isFrozen(report), true)

  // A backend that does not answer reports that instead of throwing: §57 is a
  // diagnosis, not an operation.
  const dead = beads.createBeadsMemoryProvider({ runner: absentRunner(), cwd: tempDir(), timeoutMs: 500 })
  const failed = await dead.diagnostics()
  assert.equal(failed.connectivity, 'failed')
  assert.equal(failed.installedVersion, undefined)
})

test('the key namespace stays out of the one Beads reserves', async () => {
  assert.equal(beads.BEADS_MEMORY_KEY_PREFIX, 'mywork.memory.')
  assert.throws(
    () =>
      beads.createBeadsMemoryProvider({
        runner: fakeBd().runner,
        cwd: tempDir(),
        keyPrefix: 'memory.sneaky.',
      }),
    TypeError,
    'Beads refuses `memory.` through `bd kv`, so a prefix there could never be written',
  )
  assert.throws(() => beads.createBeadsMemoryProvider({ runner: fakeBd().runner, cwd: '' }), TypeError)
  assert.throws(() => beads.createBeadsMemoryProvider({ runner: undefined, cwd: tempDir() }), TypeError)

  // A `bd remember` entry shares the listing under `memory.`, and must never be
  // read as one of ours — not even when its value looks like an envelope.
  const shared = scriptedProvider()
  shared.fake.seedMemory(
    'project-rule',
    JSON.stringify({ schema: beads.BEADS_MEMORY_PAYLOAD_SCHEMA, record: { id: 'not-ours' } }),
  )
  const ignored = await shared.provider.recall({ scopes: [workspaceScope('mixed')] })
  assert.deepEqual(ignored.records, [], 'a memory entry is outside this adapter’s namespace')
  assert.equal(await shared.provider.records().then(held => held.length), 0)

  // A value inside the namespace that cannot be read is refused, never skipped:
  // a record that silently vanished would look like one that was never retained.
  const planted = scriptedProvider()
  planted.fake.seed(`${beads.BEADS_MEMORY_KEY_PREFIX}ours`, 'not-an-envelope')
  await assert.rejects(
    () => planted.provider.recall({ scopes: [workspaceScope('mixed')] }),
    error => error.code === 'CONTRACT_MISMATCH' && /ours/.test(error.message),
  )
})

// ---------------------------------------------------------------------------
// Writer routing (§23.9)
// ---------------------------------------------------------------------------

test('each scope is written by its primary, and nowhere else', async () => {
  const { fake, provider: beadsProvider } = scriptedProvider({ beadsDir: join(tempDir(), '.beads') })
  const nativeProvider = memoryNative.createNativeMemoryProvider()
  const policy = {
    routes: [
      route('workspace', 'beads'),
      route('role', 'native'),
    ],
    timeoutMs: 2_000,
    diagnosticLimit: 20,
  }
  const fabric = core.createMemoryFabric({
    providers: [
      { provider: 'beads', port: beadsProvider },
      { provider: 'native', port: nativeProvider },
    ],
    policy,
  })

  const inWorkspace = await fabric.retain({
    proposal: proposal({ statement: 'workspace knowledge', scope: workspaceScope('routed') }),
    actors: ['memory-provider'],
    meta: meta(),
    nowMs: 1_700_000_000_000,
  })
  assert.equal(inWorkspace.ok, true, JSON.stringify(inWorkspace))
  const inRole = await fabric.retain({
    proposal: proposal({ statement: 'role knowledge', scope: { type: 'role', id: 'reviewer' } }),
    actors: ['memory-provider'],
    meta: meta(),
    nowMs: 1_700_000_000_001,
  })
  assert.equal(inRole.ok, true, JSON.stringify(inRole))

  // The workspace record is in Beads and not in the native store, and the role
  // record is the other way round: the route decides, not the order of binding.
  const beadsHeld = [...fake.entries.values()].map(value => JSON.parse(value).record.statement)
  assert.deepEqual(beadsHeld, ['workspace knowledge'])
  assert.deepEqual(nativeProvider.records().map(record => record.statement), ['role knowledge'])
  assert.equal(nativeProvider.find(inWorkspace.record.id), undefined)
  assert.equal(await beadsProvider.resolve(inRole.record.id).then(() => true, () => false), false)

  // A scope no route names is refused, and nothing is written anywhere.
  const unrouted = await fabric.retain({
    proposal: proposal({ statement: 'nowhere', scope: { type: 'attempt', id: 'a-1' } }),
    actors: ['memory-provider'],
    meta: meta(),
    nowMs: 1_700_000_000_002,
  })
  assert.equal(unrouted.ok, false)
  assert.equal(unrouted.reason, 'scope-unrouted')
  assert.equal(unrouted.code, 'CONTRACT_MISMATCH')
  assert.equal(fake.entries.size, 1)
  assert.equal(nativeProvider.records().length, 1)

  // Reads follow the same route: a recall for the workspace scope reads Beads,
  // and one for the role scope reads the native store.
  const workspaceRead = await fabric.recall({ scopes: [workspaceScope('routed')], meta: meta() })
  assert.equal(workspaceRead.ok, true)
  assert.deepEqual(workspaceRead.records.map(record => record.statement), ['workspace knowledge'])
  const roleRead = await fabric.recall({ scopes: [{ type: 'role', id: 'reviewer' }], meta: meta() })
  assert.equal(roleRead.ok, true)
  assert.deepEqual(roleRead.records.map(record => record.statement), ['role knowledge'])
})

// ---------------------------------------------------------------------------
// The durable id source (MW-018 §8.3)
// ---------------------------------------------------------------------------

test('the id source continues the sequence the workspace already holds', async () => {
  const { fake, provider } = scriptedProvider({ beadsDir: join(tempDir(), '.beads') })
  const held = {
    id: 'mem-beads-7',
    statement: 'a record an earlier process retained',
    scope: workspaceScope('durable'),
    kind: 'fact',
    sources: [],
    createdBy: { component: 'mw019-test' },
    trust: 'high',
    validity: {},
    supersedes: [],
    status: 'active',
    revision: 1,
    contentHash: 'hash-7',
    fingerprint: 'fp-7',
    retainedAt: 1_700_000_000_000,
    statusChangedAt: 1_700_000_000_000,
    reinforcedCount: 0,
  }
  await provider.retain({ record: held, mode: 'create' })

  const policy = {
    routes: [route('workspace', 'beads')],
    timeoutMs: 2_000,
    diagnosticLimit: 20,
  }
  const first = core.createMemoryFabric({
    providers: [{ provider: 'beads', port: provider }],
    policy,
    nextId: beads.createBeadsMemoryIdSource({ provider }),
  })
  const retained = await first.retain({
    proposal: proposal({ statement: 'a record this process retains', scope: workspaceScope('durable') }),
    actors: ['memory-provider'],
    meta: meta(),
    nowMs: 1_700_000_000_001,
  })
  assert.equal(retained.ok, true, JSON.stringify(retained))
  assert.equal(retained.record.id, 'mem-beads-8', 'the sequence continues where the workspace left it')

  // A restart is a new fabric over the same store, and the store is what the
  // source reads: the second fabric continues the sequence rather than
  // restarting it.
  const restarted = core.createMemoryFabric({
    providers: [
      {
        provider: 'beads',
        port: beads.createBeadsMemoryProvider({
          runner: fake.runner,
          cwd: tempDir(),
          beadsDir: join(tempDir(), '.beads'),
        }),
      },
    ],
    policy,
    nextId: beads.createBeadsMemoryIdSource({ provider }),
  })
  const afterRestart = await restarted.retain({
    proposal: proposal({ statement: 'a record the next process retains', scope: workspaceScope('durable') }),
    actors: ['memory-provider'],
    meta: meta(),
    nowMs: 1_700_000_000_002,
  })
  assert.equal(afterRestart.ok, true, JSON.stringify(afterRestart))
  assert.equal(afterRestart.record.id, 'mem-beads-9')
  assert.equal(fake.entries.size, 3)

  assert.equal(beads.highestSequenceOf([{ id: 'mem-beads-7' }, { id: 'mem-beads-9' }, { id: 'mem-1-1' }], 'mem-beads'), 9)
  assert.equal(beads.highestSequenceOf([], 'mem-beads'), 0)
  assert.throws(() => beads.createBeadsMemoryIdSource({ provider: {} }), TypeError)
  assert.throws(() => beads.createBeadsMemoryIdSource({ provider, namespace: 'bad\nname' }), TypeError)
})

test('the default id source is why a durable provider needs its own', { skip: BD_JS === undefined }, async () => {
  // The claim is about *processes*, so it is made in processes: inside one
  // process the fabric's counter never repeats, and only a fresh one starts it
  // over. Every retention below happens in a child, and every child is a restart.
  const workspace = makeRealWorkspace()

  const first = runRestartChild(workspace, 'default', 'first')
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(first.id, 'mem-1-1', 'a fresh process starts the default counter over')

  // The second process retains a different record and mints the same id, which
  // the workspace already holds: the provider refuses rather than overwrite it.
  const second = runRestartChild(workspace, 'default', 'second')
  assert.equal(second.ok, false, `a restart must not overwrite the first process's record: ${JSON.stringify(second)}`)
  assert.equal(second.code, 'TASK_CONFLICT')

  const sourced = runRestartChild(workspace, 'sourced', 'third')
  assert.equal(sourced.ok, true, JSON.stringify(sourced))
  assert.equal(sourced.id, 'mem-beads-1', 'the id source continues the sequence the workspace holds')

  const stored = await realProvider(workspace).records()
  assert.deepEqual(stored.map(record => record.id).sort(), ['mem-1-1', 'mem-beads-1'])
})

// ---------------------------------------------------------------------------
// The two providers apply the same write rule
// ---------------------------------------------------------------------------

test('the beads and native providers agree on which writes may replace a record', async () => {
  const { provider: beadsProvider } = scriptedProvider()
  const nativeProvider = memoryNative.createNativeMemoryProvider()
  const base = {
    id: 'mem-beads-1',
    statement: 'the same claim',
    scope: workspaceScope('rule'),
    kind: 'fact',
    sources: [{ uri: 'repo://a', type: 'repository' }],
    createdBy: { component: 'mw019-test' },
    trust: 'high',
    validity: {},
    supersedes: [],
    status: 'active',
    revision: 1,
    contentHash: 'hash-a',
    fingerprint: 'fp-a',
    retainedAt: 1_700_000_000_000,
    statusChangedAt: 1_700_000_000_000,
    reinforcedCount: 0,
  }
  /**
   * Each case is a write the two providers must answer the same way.
   *
   * Every field `sameContent` compares has a case that moves it alone, so the
   * two copies of the rule are held together field by field rather than by the
   * fields someone remembered to list.
   */
  const cases = [
    { name: 'the same record again', record: { ...base }, mode: 'create' },
    { name: 'a counted reinforcement', record: { ...base, reinforcedCount: 1 }, mode: 'reinforce' },
    { name: 'a lifecycle transition', record: { ...base, status: 'superseded', statusChangedAt: 2 }, mode: 'replace' },
    { name: 'moved scope', record: { ...base, scope: workspaceScope('elsewhere') }, mode: 'replace' },
    { name: 'another scope id', record: { ...base, scope: workspaceScope('rule-2') }, mode: 'replace' },
    { name: 'another scope type', record: { ...base, scope: { type: 'role', id: 'rule' } }, mode: 'replace' },
    { name: 'lowered trust', record: { ...base, trust: 'low' }, mode: 'replace' },
    { name: 'a declared confidence', record: { ...base, confidence: 0.5 }, mode: 'replace' },
    { name: 'a bumped revision', record: { ...base, revision: 2 }, mode: 'replace' },
    { name: 'another author run', record: { ...base, createdBy: { component: 'mw019-test', run: 'run-9' } }, mode: 'replace' },
    { name: 'another author component', record: { ...base, createdBy: { component: 'somebody-else' } }, mode: 'replace' },
    { name: 'a validity window', record: { ...base, validity: { from: 1_700_000_000_000 } }, mode: 'replace' },
    { name: 'a closed validity window', record: { ...base, validity: { until: 1_800_000_000_000 } }, mode: 'replace' },
    { name: 'a superseded predecessor', record: { ...base, supersedes: ['mem-beads-0'] }, mode: 'replace' },
    { name: 'another retention time', record: { ...base, retainedAt: 1_700_000_000_001 }, mode: 'replace' },
    { name: 'dropped sources', record: { ...base, sources: [] }, mode: 'replace' },
    { name: 'another source uri', record: { ...base, sources: [{ uri: 'repo://b', type: 'repository' }] }, mode: 'replace' },
    { name: 'another source revision', record: { ...base, sources: [{ uri: 'repo://a', type: 'repository', revision: 'r2' }] }, mode: 'replace' },
    { name: 'another source type', record: { ...base, sources: [{ uri: 'repo://a', type: 'document' }] }, mode: 'replace' },
    { name: 'another kind', record: { ...base, kind: 'decision' }, mode: 'replace' },
    { name: 'another statement', record: { ...base, statement: 'a different claim' }, mode: 'replace' },
    { name: 'another content hash', record: { ...base, contentHash: 'hash-b' }, mode: 'replace' },
    { name: 'another fingerprint', record: { ...base, fingerprint: 'fp-b' }, mode: 'replace' },
  ]
  for (const entry of cases) {
    const seeded = [
      beads.createBeadsMemoryProvider({ runner: scriptedProvider().fake.runner, cwd: tempDir(), beadsDir: join(tempDir(), '.beads') }),
      memoryNative.createNativeMemoryProvider(),
    ]
    const answers = []
    for (const port of [seeded[0], seeded[1]]) {
      await port.retain({ record: base, mode: 'create' })
      answers.push(
        await port.retain({ record: entry.record, mode: entry.mode }).then(
          outcome => `ok:${String(outcome.created)}`,
          error => `refused:${String(error.code)}`,
        ),
      )
    }
    assert.equal(answers[0], answers[1], `the two providers must answer "${entry.name}" the same way: ${answers.join(' vs ')}`)
  }
})

// ---------------------------------------------------------------------------
// The Cordis row (§44)
// ---------------------------------------------------------------------------

test('the §44 row registers the memory adapter and removes it with its fiber', async () => {
  assertScratchHome()
  const memoryPlugin = await import(
    pathToFileURL(join(repoRoot, 'packages', 'beads-adapter', 'lib', 'memory-plugin.js')).href
  )
  assert.equal(memoryPlugin.name, '@dsh-mywork/beads-adapter/memory')
  const { Context } = await import('@deepseek-ai/cordis')
  const controller = await import(pathToFileURL(join(repoRoot, 'packages', 'controller', 'lib', 'index.js')).href)

  const ctx = new Context()
  const controllerFiber = ctx.plugin(controller, { diagnostics: false })
  await controllerFiber.await()
  const adapters = ctx.get(contracts.MYWORK_ADAPTERS_SERVICE)
  assert.ok(adapters !== undefined)

  const fiber = ctx.plugin(memoryPlugin, { cwd: repoRoot, timeoutMs: 1_000 })
  await fiber.await()
  assert.deepEqual(
    adapters.list('memory').map(manifest => manifest.adapterId),
    ['beads'],
    'the row must register the memory adapter by its §37 declaration',
  )
  const resolved = adapters.resolve('memory', { capabilities: ['retain', 'recall'] })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.manifest.contractVersion, 'memory/v1')
  const port = resolved.adapter
  assert.equal(port.provider, 'beads')

  await fiber.dispose()
  assert.deepEqual(adapters.list('memory'), [], 'unloading the row must remove its registration')
  await controllerFiber.dispose()

  // A row config the loader mis-typed fails the mount loudly rather than
  // mounting a backend nobody can address.
  const bad = new Context()
  const badFiber = bad.plugin(memoryPlugin, { timeoutMs: 'soon' })
  await assert.rejects(badFiber.await(), TypeError)
})

// ---------------------------------------------------------------------------
// The real backend
// ---------------------------------------------------------------------------

test('the real bd answers the payloads the scripted backend reproduces', { skip: BD_JS === undefined }, async () => {
  const workspace = makeRealWorkspace()
  const logs = join(workspace, 'logs')

  const set = realBd(workspace, ['kv', 'set', 'probe-key', 'probe-value', '--json'], logs)
  assert.equal(set.code, 0, set.stderr)
  assert.deepEqual(JSON.parse(set.stdout), { key: 'probe-key', schema_version: 1, value: 'probe-value' })

  const list = realBd(workspace, ['kv', 'list', '--json'], logs)
  assert.equal(list.code, 0, list.stderr)
  assert.deepEqual(JSON.parse(list.stdout), { 'probe-key': 'probe-value', schema_version: 1 })

  const missing = realBd(workspace, ['kv', 'get', 'no-such-key', '--json'], logs)
  assert.equal(missing.code, 1)
  assert.deepEqual(JSON.parse(missing.stdout), { found: false, key: 'no-such-key', schema_version: 1, value: '' })

  const reserved = realBd(workspace, ['kv', 'set', 'memory.sneaky', 'v', '--json'], logs)
  assert.equal(reserved.code, 1)
  assert.match(JSON.parse(reserved.stdout).error, /cannot start with "memory\."/)

  const remember = realBd(workspace, ['remember', 'a human insight', '--key', 'human-key', '--json'], logs)
  assert.equal(remember.code, 0, remember.stderr)
  const shared = JSON.parse(realBd(workspace, ['kv', 'list', '--json'], logs).stdout)
  assert.equal(shared['memory.human-key'], 'a human insight', 'bd remember shares the listing under a memory. prefix')
  assert.equal(shared['probe-key'], 'probe-value')
})

test('the provider round-trips a record through a real Beads workspace', { skip: BD_JS === undefined }, async () => {
  const workspace = makeRealWorkspace()
  const provider = realProvider(workspace)
  const scope = workspaceScope('real')
  const record = {
    id: 'mem-beads-1',
    statement: 'a statement the real backend has to return unchanged',
    scope,
    kind: 'constraint',
    sources: [{ uri: 'repo://mw019', revision: 'abc', type: 'repository' }],
    createdBy: { component: 'mw019-test' },
    trust: 'high',
    validity: {},
    supersedes: [],
    status: 'active',
    revision: 3,
    contentHash: 'hash-real',
    fingerprint: 'fp-real',
    retainedAt: 1_700_000_000_000,
    statusChangedAt: 1_700_000_000_000,
    reinforcedCount: 0,
  }

  const first = await provider.retain({ record, mode: 'create' })
  assert.equal(first.created, true)
  const second = await provider.retain({ record, mode: 'create' })
  assert.equal(second.created, false, 'the same record proposed again must not be stored twice')

  const recalled = await provider.recall({ scopes: [scope] })
  assert.equal(recalled.records.length, 1)
  assert.deepEqual(recalled.records[0], record, 'the real backend must round-trip the whole record')

  const resolved = await provider.resolve(record.id)
  assert.deepEqual(resolved, record)
  await assert.rejects(() => provider.resolve('mem-beads-absent'), error => error.code === 'TASK_CONFLICT')

  // Scope isolation against the real store.
  await provider.retain({
    record: { ...record, id: 'mem-beads-2', scope: workspaceScope('real-other'), statement: 'another scope' },
    mode: 'create',
  })
  const isolated = await provider.recall({ scopes: [scope] })
  assert.deepEqual(isolated.records.map(entry => entry.id), ['mem-beads-1'])

  // A content change under an existing id is refused, not written.
  await assert.rejects(
    () => provider.retain({ record: { ...record, statement: 'rewritten' }, mode: 'replace' }),
    error => error.code === 'TASK_CONFLICT',
  )
  const untouched = await provider.resolve(record.id)
  assert.equal(untouched.statement, record.statement)

  // A write that lost its caller's answer leaves the store coherent.
  const abandoned = provider.retain({
    record: { ...record, id: 'mem-beads-3', statement: 'a write nobody waited for' },
    mode: 'create',
  })
  abandoned.catch(() => undefined)
  await abandoned.catch(() => undefined)
  const afterAbandon = await provider.recall({ scopes: [scope], ids: ['mem-beads-3'] })
  assert.ok(afterAbandon.records.length <= 1)
  assert.equal((await provider.records()).length, 3)
})

test('the §39 suite passes against a real Beads workspace', { skip: BD_JS === undefined }, async () => {
  const workspace = makeRealWorkspace()
  const provider = realProvider(workspace)
  const absent = tempDir()
  const foreign = makeRealWorkspace()
  realBd(foreign, ['kv', 'set', `${beads.BEADS_MEMORY_KEY_PREFIX}planted`, 'not-an-envelope', '--json'], foreign)

  const report = await conformanceOf({
    provider,
    idPrefix: 'real',
    scopes: [workspaceScope('real-a'), workspaceScope('real-b')],
    unavailable: () => realProvider(absent, { resolveWorkspace: false }),
    mismatched: () => realProvider(foreign),
  })

  assert.deepEqual(report.missing, [], 'every §39 memory check must have executed')
  assert.equal(report.failed, 0, JSON.stringify(report.results.filter(result => result.status === 'failed'), null, 2))
  // `timeouts` needs a backend that never answers, which a real `bd` is not.
  // It is proven against the scripted backend above, and reported here as
  // skipped rather than passed.
  assert.deepEqual(
    report.results.filter(result => result.status === 'skipped').map(result => result.name),
    ['timeouts'],
  )
})
