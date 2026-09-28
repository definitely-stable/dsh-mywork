/**
 * Gate runner acceptance (architecture §19; MW-023, E-14).
 *
 * What has to hold: a gate is a process run inside the attempt's worktree under
 * a bound the caller sets, and nothing about a broken tool, an expired bound, or
 * a cancellation may be read as success. The log the process produced is stored
 * as evidence before the verdict is returned — including when the process never
 * started.
 *
 * Every command this suite runs is a fixed spec with an explicit executable
 * (`process.execPath`) and no shell, so no string is ever interpreted twice.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

import { adapterTesting, repoRoot } from './lib/fixtures.mjs'

const gates = await import(pathToFileURL(join(repoRoot, 'packages/gate-runner/lib/index.js')).href)

/** The Node binary running this suite: an executable path, never a shell word. */
const NODE = process.execPath

/** A syntactically valid head; the runner never reads git on its own. */
const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567'

/** Temporary worktrees created by this suite, removed at the end. */
const tempDirs = []

after(() => {
  for (const dir of tempDirs) {
    assert.ok(dir.startsWith(join(tmpdir(), 'dsh-mywork-gates-')), `refusing to remove ${dir}`)
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A fresh temporary worktree the gates run in. */
function worktree() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-gates-'))
  tempDirs.push(dir)
  return dir
}

/**
 * A sink that keeps every log in memory, so a test can prove the evidence was
 * written before the verdict came back.
 */
function memorySink() {
  const stored = []
  return {
    stored,
    async store(input) {
      const ref = { artifactId: `gate-log-${stored.length + 1}`, hash: input.sha256 }
      stored.push({ input, ref })
      return ref
    },
  }
}

/** Options for one gate run, with a fresh clock and sink unless overridden. */
function runOptions(cwd, overrides = {}) {
  const artifacts = overrides.artifacts ?? memorySink()
  return {
    artifacts,
    options: {
      workspaceId: 'W-1',
      cwd,
      headSha: HEAD_SHA,
      clock: new adapterTesting.FakeClock(1_000),
      artifacts,
      ...overrides,
    },
  }
}

/** A spec that runs `script` with the Node binary under the given bound. */
function nodeSpec(script, overrides = {}) {
  return { id: 'tests', command: NODE, args: ['-e', script], timeoutMs: 10_000, ...overrides }
}

/**
 * Whether a process id is still alive. Signal 0 performs the existence check and
 * sends nothing, so this never kills something it did not start.
 */
function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Wait, bounded, for a killed process to disappear. */
async function waitForExit(pid, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!processAlive(pid)) return true
    await new Promise(resolveDelay => setTimeout(resolveDelay, 25))
  }
  return !processAlive(pid)
}

/**
 * What the command wrote to standard output, read from its own section of the
 * log. Matching the raw log would also hit the argument vector, which quotes the
 * script, so the section is the only honest place to read it from.
 */
function capturedStdout(log) {
  const match = /--- stdout ---\n([\s\S]*?)\n--- stderr ---/.exec(log)
  assert.ok(match !== null, `the log must carry a stdout section:\n${log}`)
  return match[1]
}

test('a gate that exits 0 passes and its log is stored before the verdict returns', async () => {
  const cwd = worktree()
  const { artifacts, options } = runOptions(cwd)
  const result = await gates.runGate(nodeSpec("process.stdout.write('all green')"), options)

  assert.equal(result.verdict, 'pass')
  assert.equal(result.exitCode, 0)
  assert.equal(result.headSha, HEAD_SHA)
  assert.equal(result.id, 'tests')
  assert.equal(result.reason, undefined, 'a pass carries no refusal reason')
  assert.deepEqual(result.artifactRef, artifacts.stored[0].ref, 'the verdict references the stored log')
  assert.equal(artifacts.stored.length, 1)
  assert.match(artifacts.stored[0].input.log, /all green/)
  assert.equal(artifacts.stored[0].input.verdict, 'pass')
})

test('a gate that exits non-zero fails, and its log carries both streams', async () => {
  const cwd = worktree()
  const { artifacts, options } = runOptions(cwd)
  const script = "process.stdout.write('OUT-MARK');process.stderr.write('ERR-MARK');process.exit(3)"
  const result = await gates.runGate(nodeSpec(script), options)

  assert.equal(result.verdict, 'fail')
  assert.equal(result.exitCode, 3)
  assert.notEqual(result.verdict, 'pass')
  const [stored] = artifacts.stored
  assert.match(stored.input.log, /OUT-MARK/, 'stdout must survive as evidence')
  assert.match(stored.input.log, /ERR-MARK/, 'stderr must survive as evidence')
  assert.equal(stored.input.sha256, gates.sha256OfLog(stored.input.log))
})

test('an executable that cannot be started is an error with GATE_TOOL_MISSING, never a pass', async () => {
  const cwd = worktree()
  const { artifacts, options } = runOptions(cwd)
  const spec = { id: 'policy', command: 'dsh-mywork-gate-that-does-not-exist', args: [], timeoutMs: 5_000 }
  const result = await gates.runGate(spec, options)

  assert.equal(result.verdict, 'error')
  assert.notEqual(result.verdict, 'pass')
  assert.equal(result.reason, 'GATE_TOOL_MISSING')
  assert.equal(result.exitCode, null, 'no process ever reported an exit code')
  assert.equal(artifacts.stored.length, 1, 'even a gate that never ran leaves evidence')
  assert.match(artifacts.stored[0].input.log, /error/)
})

test('a gate that exceeds its bound is a timeout, and the process is killed', async () => {
  const cwd = worktree()
  const { artifacts, options } = runOptions(cwd)
  const script = "process.stdout.write('PID=' + process.pid);setTimeout(() => {}, 5000)"
  const result = await gates.runGate(nodeSpec(script, { timeoutMs: 300 }), options)

  assert.equal(result.verdict, 'timeout')
  assert.notEqual(result.verdict, 'pass')
  assert.equal(result.exitCode, null)
  const pid = Number(/PID=(\d+)/.exec(capturedStdout(artifacts.stored[0].input.log))[1])
  assert.ok(Number.isInteger(pid) && pid > 0, 'the child reported its pid')
  assert.ok(await waitForExit(pid), `the timed-out process ${pid} must be killed, not left running`)
})

test('an aborted run is cancelled, never a pass', async () => {
  const cwd = worktree()

  // Aborted before the process starts: the bound is already spent.
  const preAborted = new AbortController()
  preAborted.abort()
  const pre = runOptions(cwd, { signal: preAborted.signal })
  const preResult = await gates.runGate(nodeSpec("process.stdout.write('should not run')"), pre.options)
  assert.equal(preResult.verdict, 'cancelled')
  assert.notEqual(preResult.verdict, 'pass')
  assert.equal(preResult.exitCode, null)
  assert.equal(pre.artifacts.stored.length, 1, 'a cancelled gate still leaves evidence')

  // Aborted while the process is running: the caller stops the run.
  const controller = new AbortController()
  const running = runOptions(cwd, { signal: controller.signal })
  const script = "process.stdout.write('PID=' + process.pid);setTimeout(() => {}, 5000)"
  setTimeout(() => controller.abort(), 150)
  const result = await gates.runGate(nodeSpec(script), running.options)
  assert.equal(result.verdict, 'cancelled')
  const pidMatch = /PID=(\d+)/.exec(capturedStdout(running.artifacts.stored[0].input.log))
  if (pidMatch !== null) {
    assert.ok(await waitForExit(Number(pidMatch[1])), 'the cancelled process must be killed')
  }
})

test('a gate runs inside the worktree, not in the repository root', async () => {
  const cwd = worktree()
  mkdirSync(join(cwd, 'sub'))
  const script = 'process.stdout.write(process.cwd())'

  const atRoot = runOptions(cwd)
  await gates.runGate(nodeSpec(script), atRoot.options)
  const rootCwd = capturedStdout(atRoot.artifacts.stored[0].input.log).trim()
  assert.equal(
    resolve(rootCwd).toLowerCase(),
    resolve(cwd).toLowerCase(),
    'the gate runs in the worktree it was handed',
  )
  assert.notEqual(resolve(rootCwd).toLowerCase(), resolve(repoRoot).toLowerCase(), 'never in the repository root')

  const inSub = runOptions(cwd)
  await gates.runGate(nodeSpec(script, { cwd: 'sub' }), inSub.options)
  const subCwd = capturedStdout(inSub.artifacts.stored[0].input.log).trim()
  assert.equal(resolve(subCwd).toLowerCase(), resolve(join(cwd, 'sub')).toLowerCase())
})

test('two gates with one id are refused before either runs', async () => {
  const first = nodeSpec("process.stdout.write('first')", { id: 'duplicate' })
  const second = nodeSpec("process.stdout.write('second')", { id: 'duplicate' })
  assert.throws(
    () => gates.assertUniqueGateIds([first, second]),
    error => gates.isGateError(error) && error.code === 'duplicate-gate-id',
  )
  // Positive control: the same validator accepts a set whose ids are unique, so
  // the refusal above is about the duplicate rather than about validating.
  assert.doesNotThrow(() => gates.assertUniqueGateIds([first, { ...second, id: 'lint' }]))
  assert.equal(gates.GATE_ERROR_CODES.includes('duplicate-gate-id'), true)
})

test('every verdict carries an artifact reference, including error and timeout', async () => {
  const cases = [
    ['pass', nodeSpec("process.stdout.write('ok')")],
    ['fail', nodeSpec('process.exit(2)')],
    ['error', { id: 'tests', command: 'dsh-mywork-gate-that-does-not-exist', args: [], timeoutMs: 5_000 }],
    ['timeout', nodeSpec('setTimeout(() => {}, 5000)', { timeoutMs: 250 })],
  ]
  for (const [expected, spec] of cases) {
    const cwd = worktree()
    const { artifacts, options } = runOptions(cwd)
    const result = await gates.runGate(spec, options)
    assert.equal(result.verdict, expected, `${spec.command} must be ${expected}`)
    assert.ok(result.artifactRef, `${expected} must carry an artifactRef`)
    assert.equal(result.artifactRef.artifactId, artifacts.stored[0].ref.artifactId)
    assert.equal(result.artifactRef.hash, gates.sha256OfLog(artifacts.stored[0].input.log))
  }
})

test('a log larger than the bound is truncated, and the verdict is an error, never a pass', async () => {
  const cwd = worktree()
  const { artifacts, options } = runOptions(cwd, { maxBufferBytes: 1_024 })
  const script = "process.stdout.write('x'.repeat(64 * 1024))"
  const result = await gates.runGate(nodeSpec(script), options)

  assert.equal(result.verdict, 'error')
  assert.notEqual(result.verdict, 'pass')
  const { log } = artifacts.stored[0].input
  assert.match(log, /truncated/i, 'the truncation must be visible in the evidence')
  assert.ok(log.length < 64 * 1024, `the stored log stays bounded, found ${log.length} characters`)
})

test('an invalid spec and an invalid head are refused before anything runs', async () => {
  const cwd = worktree()
  const { artifacts, options } = runOptions(cwd)
  const invalid = [
    nodeSpec('', { id: '' }),
    nodeSpec('', { command: '' }),
    nodeSpec('', { timeoutMs: 0 }),
    nodeSpec('', { timeoutMs: Number.NaN }),
    nodeSpec('', { args: 'not-an-array' }),
    nodeSpec('', { cwd: '..' }),
    nodeSpec('', { cwd: resolve(repoRoot) }),
  ]
  for (const spec of invalid) {
    await assert.rejects(
      () => gates.runGate(spec, options),
      error => gates.isGateError(error) && error.code === 'invalid-spec',
      `spec ${JSON.stringify(spec)} must be refused`,
    )
  }
  await assert.rejects(
    () => gates.runGate(nodeSpec(''), { ...options, headSha: 'not-a-head' }),
    error => gates.isGateError(error) && error.code === 'invalid-head',
  )
  assert.equal(artifacts.stored.length, 0, 'nothing may be stored for a spec that never ran')
})
