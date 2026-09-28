/**
 * Exact-head pinning acceptance (architecture §19; MW-023, E-15).
 *
 * What has to hold: a verdict belongs to the commit it was produced against. If
 * the worktree's head moves while the gates run — between two gates or during
 * the last one — every verdict is discarded with `GATE_HEAD_MOVED`, and the logs
 * stay behind as the evidence of why.
 *
 * The runner never reads git itself: the head reader is injected, which is what
 * lets this suite move the head deterministically instead of committing into the
 * repository it is testing. The production adapter is a fixed `git` spec and is
 * exercised against a throwaway repository of this suite's own.
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { adapterTesting, repoRoot } from './lib/fixtures.mjs'

const gates = await import(pathToFileURL(join(repoRoot, 'packages/gate-runner/lib/index.js')).href)
const run = promisify(execFile)

/** Two distinct, syntactically valid heads. */
const HEAD_BEFORE = '1111111111111111111111111111111111111111'
const HEAD_AFTER = '2222222222222222222222222222222222222222'

/** Temporary directories created by this suite. */
const tempDirs = []

after(() => {
  for (const dir of tempDirs) {
    assert.ok(dir.startsWith(join(tmpdir(), 'dsh-mywork-gates-')), `refusing to remove ${dir}`)
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-gates-'))
  tempDirs.push(dir)
  return dir
}

/** A sink that keeps every stored log, so discarding a verdict is observable. */
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

/**
 * A head reader that walks a scripted list: the last entry repeats, so a test
 * says exactly which read sees the move.
 */
function scriptedHead(heads) {
  let index = 0
  return async () => {
    const head = heads[Math.min(index, heads.length - 1)]
    index += 1
    return head
  }
}

/** One policy of two cheap gates, both of which pass if they are reached. */
function twoGatePolicy() {
  const script = "process.stdout.write('ran')"
  return {
    workspaceId: 'W-1',
    gates: [
      { id: 'tests', command: process.execPath, args: ['-e', script], timeoutMs: 10_000 },
      { id: 'lint', command: process.execPath, args: ['-e', script], timeoutMs: 10_000 },
    ],
  }
}

/** Policy run options bound to one sink and one clock. */
function policyOptions(cwd, readHead, overrides = {}) {
  const artifacts = memorySink()
  return {
    artifacts,
    options: {
      workspaceId: 'W-1',
      cwd,
      readHead,
      clock: new adapterTesting.FakeClock(1_000),
      artifacts,
      ...overrides,
    },
  }
}

test('a head that does not move leaves every verdict valid for that exact head', async () => {
  const cwd = tempDir()
  const { artifacts, options } = policyOptions(cwd, scriptedHead([HEAD_BEFORE]))
  const runResult = await gates.runGatePolicy(twoGatePolicy(), options)

  assert.equal(runResult.refusal, undefined, 'a steady head refuses nothing')
  assert.equal(runResult.headSha, HEAD_BEFORE)
  assert.deepEqual(runResult.results.map(result => result.id), ['tests', 'lint'])
  for (const result of runResult.results) {
    assert.equal(result.headSha, HEAD_BEFORE, 'each verdict names the head it ran against')
    assert.equal(result.verdict, 'pass')
  }
  assert.equal(artifacts.stored.length, 2)
})

test('a head that moves refuses GATE_HEAD_MOVED and discards the verdicts', async () => {
  const cwd = tempDir()

  // The move lands between the two gates: the second gate never runs, because
  // its verdict would already belong to code nobody verified.
  const between = policyOptions(cwd, scriptedHead([HEAD_BEFORE, HEAD_AFTER]))
  const betweenResult = await gates.runGatePolicy(twoGatePolicy(), between.options)
  assert.equal(betweenResult.refusal, 'GATE_HEAD_MOVED')
  assert.deepEqual([...betweenResult.results], [], 'no verdict survives a moved head')
  assert.equal(betweenResult.headSha, HEAD_BEFORE)
  assert.equal(between.artifacts.stored.length, 1, 'only the gate that ran left a log')

  // The move lands during or after the last gate: both verdicts are discarded.
  const afterLast = policyOptions(cwd, scriptedHead([HEAD_BEFORE, HEAD_BEFORE, HEAD_AFTER]))
  const afterResult = await gates.runGatePolicy(twoGatePolicy(), afterLast.options)
  assert.equal(afterResult.refusal, 'GATE_HEAD_MOVED')
  assert.deepEqual([...afterResult.results], [])
  assert.equal(afterResult.headSha, HEAD_BEFORE)
  assert.equal(afterLast.artifacts.stored.length, 2)

  console.log(`GATE_HEAD_MOVED head-before=${HEAD_BEFORE} head-after=${HEAD_AFTER}`)
})

test('GateRunResult.headSha is filled for a refusal as well', async () => {
  const cwd = tempDir()

  // A policy that names no gate: the refusal is a result, and it still says
  // which head it refused for.
  const empty = policyOptions(cwd, scriptedHead([HEAD_BEFORE]))
  const emptyResult = await gates.runGatePolicy({ workspaceId: 'W-1', gates: [] }, empty.options)
  assert.equal(emptyResult.refusal, 'GATE_UNCONFIGURED')
  assert.equal(emptyResult.headSha, HEAD_BEFORE)
  assert.deepEqual([...emptyResult.results], [])

  // A policy with a duplicate id: refused before any process starts.
  const duplicate = policyOptions(cwd, scriptedHead([HEAD_BEFORE]))
  const policy = twoGatePolicy()
  const duplicated = {
    workspaceId: policy.workspaceId,
    gates: [policy.gates[0], { ...policy.gates[1], id: 'tests' }],
  }
  const duplicateResult = await gates.runGatePolicy(duplicated, duplicate.options)
  assert.equal(duplicateResult.refusal, 'GATE_DUPLICATE_ID')
  assert.equal(duplicateResult.headSha, HEAD_BEFORE)
  assert.equal(duplicate.artifacts.stored.length, 0, 'a refused policy runs nothing')
})

test('discarding the verdicts keeps the logs as evidence of the failure', async () => {
  const cwd = tempDir()
  const { artifacts, options } = policyOptions(cwd, scriptedHead([HEAD_BEFORE, HEAD_BEFORE, HEAD_AFTER]))
  const result = await gates.runGatePolicy(twoGatePolicy(), options)

  assert.equal(result.refusal, 'GATE_HEAD_MOVED')
  assert.deepEqual([...result.results], [])
  // The run stored nothing to hand back, so the sink is the only proof that the
  // gates ran — which is exactly why the refusal may not delete it.
  assert.deepEqual(artifacts.stored.map(entry => entry.input.gateId), ['tests', 'lint'])
  for (const entry of artifacts.stored) {
    assert.equal(entry.input.headSha, HEAD_BEFORE)
    assert.equal(entry.input.verdict, 'pass')
    assert.equal(entry.input.sha256, gates.sha256OfLog(entry.input.log))
  }
})

test('the production head reader reads the exact head of a repository', async () => {
  const cwd = tempDir()
  const git = ['-c', 'user.email=gate@example.invalid', '-c', 'user.name=gate']
  const fixed = { shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 1_048_576 }
  await run('git', [...git, 'init', '--quiet'], { ...fixed, cwd })
  await run('git', [...git, 'commit', '--allow-empty', '--quiet', '-m', 'first'], { ...fixed, cwd })
  const { stdout: firstOut } = await run('git', ['rev-parse', 'HEAD'], { ...fixed, cwd })
  const first = firstOut.trim()

  const readHead = gates.createGitHeadReader()
  assert.equal(await readHead(cwd), first, 'the reader reads the head git reports')

  await run('git', [...git, 'commit', '--allow-empty', '--quiet', '-m', 'second'], { ...fixed, cwd })
  const { stdout: secondOut } = await run('git', ['rev-parse', 'HEAD'], { ...fixed, cwd })
  const second = secondOut.trim()
  assert.notEqual(first, second, 'an empty commit really moves the head')
  assert.equal(await readHead(cwd), second, 'the reader follows the head to its new value')
})
