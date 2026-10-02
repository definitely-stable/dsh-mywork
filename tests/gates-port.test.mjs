/**
 * The attempt gate port (architecture §19; MW-023, E-17).
 *
 * `createAttemptGatePort` is the seam the worker asks for an attempt's verdicts
 * through, so these five tests state what it owes: a green set arrives in policy
 * order and pinned to the request's head; a red required gate arrives as a
 * verdict rather than as a policy refusal; a checkout that moved is refused as a
 * value with no verdicts at all; a malformed request is refused before a single
 * process starts; and the head of the answer is the caller's pin, never what the
 * worktree happens to point at.
 *
 * The packages are loaded by path rather than through `tests/lib/fixtures.mjs`:
 * this suite needs `gate-runner` and a clock, and a shared pre-check of every
 * build output would make it fail for reasons that are not about this port.
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** One built package of the workspace. */
const load = async name => import(pathToFileURL(join(repoRoot, 'packages', name, 'lib', 'index.js')).href)

const contracts = await load('contracts')
const gates = await load('gate-runner')
const adapterTesting = await import(
  pathToFileURL(join(repoRoot, 'packages', 'adapter-sdk', 'lib', 'testing.js')).href
)

const run = promisify(execFile)

/** The head the requests pin. */
const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567'

/** A head that is not the pin, for the moved-checkout test. */
const OTHER_SHA = '1111111111111111111111111111111111111111'

/** Temporary directories this suite created, removed at the end. */
const tempDirs = []

/** A fresh temporary directory. */
function tempDir(prefix = 'dsh-mywork-gates-port-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) {
    assert.ok(dir.startsWith(join(tmpdir(), 'dsh-mywork-gates-port-')), `refusing to remove ${dir}`)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // A directory git still holds open keeps the file locked on Windows.
    }
  }
})

/** Operation identity for one call. */
const meta = operationId => Object.freeze({ operationId, correlationId: 'corr-1' })

/** A sink that keeps every stored log, so a test can count what ran. */
function memorySink() {
  const stored = []
  return {
    stored,
    async store(input) {
      const ref = Object.freeze({ artifactId: `gate-log-${stored.length + 1}`, hash: input.sha256 })
      stored.push({ input, ref })
      return ref
    },
  }
}

/** A spec that runs `script` under the Node binary. */
function nodeSpec(id, script, overrides = {}) {
  return { id, command: process.execPath, args: ['-e', script], timeoutMs: 10_000, ...overrides }
}

/** A request for one attempt against a worktree. */
function request(cwd, overrides = {}) {
  return {
    attemptId: 'A-1',
    taskId: 'T-1',
    workspaceId: 'W-1',
    cwd,
    headSha: HEAD_SHA,
    ...overrides,
  }
}

/** A port over one policy, with a fresh clock and the sink the test owns. */
function portFor(policy, options = {}) {
  const artifacts = options.artifacts ?? memorySink()
  const port = gates.createAttemptGatePort({
    policies: gates.defineGatePolicySource([{ workspaceId: 'W-1', ...policy }]),
    clock: new adapterTesting.FakeClock(1_000),
    artifacts,
    ...(options.readHead === undefined ? {} : { readHead: options.readHead }),
  })
  return { port, artifacts }
}

test('a green set arrives in policy order, pinned to the requested head', async () => {
  const cwd = tempDir()
  const { port, artifacts } = portFor({ gates: [nodeSpec('tests', 'process.exit(0)'), nodeSpec('lint', 'process.exit(0)')] })

  const answered = await port.run(request(cwd), meta('op-green'))
  assert.equal(answered.ok, true, answered.ok ? '' : `${answered.error.code}: ${answered.error.message}`)
  assert.equal(answered.value.refusal, undefined, 'a complete green set is not a refusal')
  assert.deepEqual(answered.value.results.map(result => result.id), ['tests', 'lint'], 'the policy order is the answer order')
  for (const result of answered.value.results) {
    assert.equal(result.verdict, 'pass')
    assert.equal(result.headSha, HEAD_SHA, 'every verdict is about the requested head')
    assert.equal(result.exitCode, 0)
  }
  assert.equal(answered.value.headSha, HEAD_SHA)
  assert.equal(artifacts.stored.length, 2, 'one log per gate, stored before the verdict was returned')
  assert.equal(artifacts.stored[0].input.gateId, 'tests')
  assert.equal(artifacts.stored[1].input.gateId, 'lint')
  assert.deepEqual(answered.value.results[0].artifactRef, artifacts.stored[0].ref, 'the verdict references its own log')
})

test('a red required gate is a verdict, not a refusal', async () => {
  const cwd = tempDir()
  const { port, artifacts } = portFor({ gates: [nodeSpec('tests', 'process.exit(0)'), nodeSpec('lint', 'process.exit(1)')] })

  const answered = await port.run(request(cwd), meta('op-red'))
  assert.equal(answered.ok, true)
  assert.equal(answered.value.refusal, undefined, 'the policy ran: the refusal belongs to the worker that reads it')
  const byId = new Map(answered.value.results.map(result => [result.id, result]))
  assert.equal(contracts.isGatePassing(byId.get('tests').verdict), true)
  assert.equal(byId.get('lint').verdict, 'fail')
  assert.equal(byId.get('lint').exitCode, 1)
  assert.equal(contracts.isGatePassing(byId.get('lint').verdict), false, 'a failing gate is never passing')
  assert.equal(artifacts.stored.length, 2, 'the failing gate stored its log too')
  // §19: the caller blocks on the verdict being non-passing; the port must not
  // have hidden it behind a refusal that reads like "nothing was configured".
  assert.notEqual(answered.value.results.length, 0)
})

test('a checkout that moved is refused as a value, before any gate runs', async () => {
  const cwd = tempDir()
  const marker = join(cwd, 'ran.txt')
  const { port, artifacts } = portFor(
    { gates: [nodeSpec('tests', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`)] },
    { readHead: async () => OTHER_SHA },
  )

  const answered = await port.run(request(cwd), meta('op-moved'))
  assert.equal(answered.ok, true, 'a moved head is a verdict about the attempt, not an exception')
  assert.equal(answered.value.refusal, 'GATE_HEAD_MOVED')
  assert.deepEqual([...answered.value.results], [], 'no verdict belongs to the pinned head')
  assert.equal(answered.value.headSha, HEAD_SHA, 'the refusal still names the head that was asked about')
  assert.equal(existsSync(marker), false, 'the refusal happened before the first gate started')
  assert.equal(artifacts.stored.length, 0, 'nothing was stored, because nothing ran')

  // Positive control: the same port with the pin's own head runs the gate.
  const agreeing = portFor(
    { gates: [nodeSpec('tests', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`)] },
    { readHead: async () => HEAD_SHA },
  )
  const ran = await agreeing.port.run(request(cwd), meta('op-agree'))
  assert.equal(ran.ok, true)
  assert.equal(ran.value.refusal, undefined)
  assert.equal(existsSync(marker), true, 'the gate really does write when the head agrees')
})

test('a malformed request is refused before a policy is read or a process starts', async () => {
  const cwd = tempDir()
  const marker = join(cwd, 'ran.txt')
  const { port, artifacts } = portFor({
    gates: [nodeSpec('tests', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`)],
  })

  const cases = [
    { overrides: { headSha: '' }, field: 'headSha' },
    { overrides: { headSha: 'not-a-sha' }, field: 'headSha' },
    { overrides: { cwd: join('worktrees', '..', 'wt') }, field: 'cwd' },
    { overrides: { workspaceId: '   ' }, field: 'workspaceId' },
    { overrides: { attemptId: undefined }, field: 'attemptId' },
  ]
  for (const { overrides, field } of cases) {
    const refused = await port.run(request(cwd, overrides), meta(`op-${field}`))
    assert.equal(refused.ok, false, `${field} must be refused`)
    assert.equal(refused.error.code, 'CONTRACT_MISMATCH')
    assert.equal(refused.error.details.field, field)
  }

  // An absolute path that climbs out of the worktree is refused as well: the
  // gates of a policy run relative to `cwd`, and that must stay inside it. The
  // path is spelled out rather than `join`ed, because `join` would normalise the
  // `..` away and the test would then be about an ordinary directory.
  const escaping = await port.run(request(`${cwd}${sep}..${sep}elsewhere`), meta('op-escape'))
  assert.equal(escaping.ok, false)
  assert.equal(escaping.error.details.field, 'cwd')
  assert.equal(escaping.error.details.reason, 'escapes-worktree')

  // An undeclared field is refused rather than ignored, so a caller cannot
  // believe it passed a bound the port never read.
  const undeclared = await port.run({ ...request(cwd), strict: true }, meta('op-undeclared'))
  assert.equal(undeclared.ok, false)
  assert.equal(undeclared.error.details.field, 'strict')
  assert.equal(undeclared.error.details.reason, 'undeclared-field')

  assert.equal(existsSync(marker), false, 'no process ran for any refused request')
  assert.equal(artifacts.stored.length, 0)
})

test('the answer is pinned to the request, not to what the worktree points at', async () => {
  const dir = tempDir()
  await run('git', ['init', '--quiet', '--initial-branch=main', dir])
  await run('git', ['-C', dir, 'config', 'user.email', 'gates@example.invalid'])
  await run('git', ['-C', dir, 'config', 'user.name', 'MyWork Gates Test'])
  await run('git', ['-C', dir, 'config', 'commit.gpgsign', 'false'])
  writeFileSync(join(dir, 'first.txt'), 'first\n')
  await run('git', ['-C', dir, 'add', '-A'])
  await run('git', ['-C', dir, 'commit', '-m', 'first'])
  const pinnedSnapshot = (await run('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim()

  // The repository moves on: the pin belongs to the request, so nothing here is
  // allowed to change the answer.
  writeFileSync(join(dir, 'second.txt'), 'second\n')
  await run('git', ['-C', dir, 'add', '-A'])
  await run('git', ['-C', dir, 'commit', '-m', 'second'])
  const movedOn = (await run('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim()
  assert.notEqual(movedOn, pinnedSnapshot, 'the checkout really did move')

  const { port } = portFor({ gates: [nodeSpec('tests', 'process.exit(0)')] })
  const first = await port.run(request(dir, { headSha: pinnedSnapshot }), meta('op-pin-1'))
  assert.equal(first.ok, true)
  assert.equal(first.value.refusal, undefined, 'the port reads no head of its own, so nothing moved as far as it knows')
  assert.equal(first.value.results[0].headSha, pinnedSnapshot)
  assert.notEqual(first.value.results[0].headSha, movedOn, 'the answer is not the checkout head')

  // And it stays that way when the worktree changes again after the request.
  writeFileSync(join(dir, 'third.txt'), 'third\n')
  await run('git', ['-C', dir, 'add', '-A'])
  await run('git', ['-C', dir, 'commit', '-m', 'third'])
  const second = await port.run(request(dir, { headSha: pinnedSnapshot }), meta('op-pin-2'))
  assert.equal(second.ok, true)
  assert.deepEqual(
    second.value.results.map(result => [result.id, result.verdict, result.headSha]),
    first.value.results.map(result => [result.id, result.verdict, result.headSha]),
    'the verdict does not depend on the repository state the port never read',
  )
})
