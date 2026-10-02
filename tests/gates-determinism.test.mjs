/**
 * Gate determinism acceptance (architecture §19; MW-023, E-18).
 *
 * What has to hold: one head with one set of gates reaches one verdict. The
 * verdict is a function of what the command did and of nothing else — not of how
 * long it took and not of the wall clock. Time is read from the injected clock,
 * and the package's own sources contain no reading of the wall clock at all.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

import { adapterTesting, repoRoot } from './lib/fixtures.mjs'

const gates = await import(pathToFileURL(join(repoRoot, 'packages/gate-runner/lib/index.js')).href)

/** The head both runs of a determinism case verify. */
const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567'

/** Temporary worktrees created by this suite. */
const tempDirs = []

after(() => {
  for (const dir of tempDirs) {
    assert.ok(dir.startsWith(join(tmpdir(), 'dsh-mywork-gates-')), `refusing to remove ${dir}`)
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A fresh temporary worktree. */
function worktree() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-gates-'))
  tempDirs.push(dir)
  return dir
}

/** A sink that keeps every stored log. */
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

/** Run one spec twice against one worktree, with a clock per run. */
async function twice(spec, clockStart = 1_000) {
  const cwd = worktree()
  const runs = []
  for (let index = 0; index < 2; index += 1) {
    const artifacts = memorySink()
    const options = {
      workspaceId: 'W-1',
      cwd,
      headSha: HEAD_SHA,
      clock: new adapterTesting.FakeClock(clockStart),
      artifacts,
    }
    const result = await gates.runGate(spec, options)
    runs.push({ result, artifacts })
  }
  return runs
}

/** A spec that runs `script` under the Node binary. */
function nodeSpec(script, overrides = {}) {
  return { id: 'tests', command: process.execPath, args: ['-e', script], timeoutMs: 10_000, ...overrides }
}

test('two runs of one gate against one head reach the same verdict and exit code', async () => {
  const [{ result: first }, { result: second }] = await twice(nodeSpec("process.stdout.write('same');process.exit(4)"))

  assert.equal(first.verdict, 'fail')
  assert.equal(second.verdict, first.verdict)
  assert.equal(second.exitCode, first.exitCode)
  assert.equal(first.exitCode, 4)
  assert.equal(first.headSha, second.headSha)
  assert.equal(first.reason, second.reason)
})

test('a slower run reaches the same verdict, because duration is not the verdict', async () => {
  const cwd = worktree()
  const spec = delay => nodeSpec(`const until = Date.now() + ${delay};while (Date.now() < until) {}process.stdout.write('work')`)
  const outcomes = []
  for (const delay of [25, 400]) {
    const artifacts = memorySink()
    const startedAt = Date.now()
    const result = await gates.runGate(spec(delay), {
      workspaceId: 'W-1',
      cwd,
      headSha: HEAD_SHA,
      clock: new adapterTesting.FakeClock(1_000),
      artifacts,
    })
    outcomes.push({ result, elapsed: Date.now() - startedAt })
  }

  // The durations really differ (reported, not asserted: the timing of a machine
  // is not the gate's contract), and the verdict is the same regardless.
  console.log(`gate durations: ${outcomes.map(outcome => `${outcome.elapsed}ms`).join(' vs ')}`)
  const [fast, slow] = outcomes
  assert.equal(fast.result.verdict, 'pass')
  assert.equal(slow.result.verdict, fast.result.verdict)
  assert.equal(slow.result.exitCode, fast.result.exitCode)
})

test('the same head, gate, and command hash to the same evidence digest', async () => {
  const [{ result: first, artifacts: firstArtifacts }, { result: second, artifacts: secondArtifacts }] = await twice(
    nodeSpec("process.stdout.write('stable');process.stderr.write('also stable')"),
  )

  assert.equal(first.verdict, 'pass')
  assert.equal(second.verdict, first.verdict)
  // The log records what the command did, never when: the digest is a function
  // of the head, the gate, and the output, which is what makes the artifact
  // comparable across runs.
  assert.equal(secondArtifacts.stored[0].input.sha256, firstArtifacts.stored[0].input.sha256)
  assert.equal(secondArtifacts.stored[0].input.log, firstArtifacts.stored[0].input.log)
})

test('startedAt and settledAt come from the injected clock', async () => {
  const cwd = worktree()
  const clock = new adapterTesting.FakeClock(7_654)
  const artifacts = memorySink()
  const result = await gates.runGate(nodeSpec("process.stdout.write('timed')"), {
    workspaceId: 'W-1',
    cwd,
    headSha: HEAD_SHA,
    clock,
    artifacts,
  })

  assert.equal(result.verdict, 'pass')
  const [stored] = artifacts.stored
  // The fake clock does not move on its own: both readings are its own value,
  // which is how the test proves the runner never read the wall clock instead.
  assert.equal(stored.input.startedAt, 7_654)
  assert.equal(stored.input.settledAt, 7_654)
  assert.equal(stored.input.startedAt, clock.now())
})

test('the gate-runner sources never read the wall clock or generate randomness', () => {
  const sourceDir = join(repoRoot, 'packages', 'gate-runner', 'src')
  const files = readdirSync(sourceDir).filter(name => name.endsWith('.ts'))
  assert.ok(files.length >= 4, `expected the package sources, found ${files.join(', ')}`)
  for (const file of files) {
    const source = readFileSync(join(sourceDir, file), 'utf8')
    assert.equal(/Date\.now|Math\.random|new Date\b|performance\.now/.test(source), false, `${file} must not read the wall clock`)
  }
  // Positive control: the same scan finds the pattern where it does exist, so
  // the assertion above is not vacuous.
  assert.equal(/Date\.now/.test("const t = Date.now()"), true)
})
