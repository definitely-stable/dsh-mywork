/**
 * Gate policy acceptance (architecture §19; MW-023, E-16).
 *
 * What has to hold: the set of checks belongs to the workspace, not to the task,
 * and its absence is a failure rather than a skip. A policy that names no gate
 * refuses with `GATE_UNCONFIGURED`; a gate that cannot be run is an `error`; and
 * an informational gate is the only kind whose failure does not block.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

import { adapterTesting, contracts, repoRoot } from './lib/fixtures.mjs'

const gates = await import(pathToFileURL(join(repoRoot, 'packages/gate-runner/lib/index.js')).href)

/** The head every gate in this suite runs against. */
const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567'

/** A different base, so a `base` gate has something to diverge from. */
const OTHER_SHA = '1111111111111111111111111111111111111111'

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

/** A spec that runs `script` under the Node binary. */
function nodeSpec(id, script, overrides = {}) {
  return { id, command: process.execPath, args: ['-e', script], timeoutMs: 10_000, ...overrides }
}

/** Policy run options with a sink, a steady head, and a fresh clock. */
function policyOptions(cwd, overrides = {}) {
  const artifacts = overrides.artifacts ?? memorySink()
  return {
    artifacts,
    options: {
      workspaceId: 'W-1',
      cwd,
      readHead: async () => HEAD_SHA,
      clock: new adapterTesting.FakeClock(1_000),
      artifacts,
      ...overrides,
    },
  }
}

test('a policy that names no gate refuses with GATE_UNCONFIGURED instead of passing', async () => {
  const cwd = worktree()
  const { options } = policyOptions(cwd)
  const result = await gates.runGatePolicy({ workspaceId: 'W-1', gates: [] }, options)

  assert.equal(result.refusal, 'GATE_UNCONFIGURED')
  assert.notEqual(result.refusal, undefined, 'a refusal is what the caller gets')
  assert.deepEqual([...result.results], [], 'nothing was verified, so no verdict exists')
  assert.equal(result.headSha, HEAD_SHA)

  // The same refusal is what an unconfigured workspace gets: the fallback is an
  // explicit refusal, never a default set and never a silent pass.
  const source = gates.defineGatePolicySource([
    { workspaceId: 'W-2', gates: [nodeSpec('tests', 'process.exit(0)')] },
  ])
  assert.equal(gates.resolveGatePolicy(source, 'W-2').workspaceId, 'W-2')
  assert.throws(
    () => gates.resolveGatePolicy(source, 'W-1'),
    error => gates.isGateError(error) && error.code === 'gate-unconfigured',
  )
  assert.ok(Object.isFrozen(source), 'a policy source is a frozen lookup')
  assert.throws(
    () =>
      gates.defineGatePolicySource([
        { workspaceId: 'W-2', gates: [] },
        { workspaceId: 'W-2', gates: [] },
      ]),
    error => gates.isGateError(error) && error.code === 'invalid-policy',
  )
})

test('a policy with one gate runs exactly one gate', async () => {
  const cwd = worktree()
  const { artifacts, options } = policyOptions(cwd)
  const policy = { workspaceId: 'W-1', gates: [nodeSpec('tests', "process.stdout.write('one')")] }
  const result = await gates.runGatePolicy(policy, options)

  assert.equal(result.refusal, undefined)
  assert.equal(result.results.length, 1)
  assert.equal(result.results[0].id, 'tests')
  assert.equal(result.results[0].verdict, 'pass')
  assert.equal(artifacts.stored.length, 1, 'one gate means one log')
})

test('an informational gate that fails does not block, a required one that fails does', async () => {
  const informational = {
    workspaceId: 'W-1',
    gates: [
      nodeSpec('tests', 'process.exit(0)'),
      nodeSpec('benchmark', 'process.exit(7)', { required: false }),
    ],
  }
  const informationalRun = policyOptions(worktree())
  const informationalResult = await gates.runGatePolicy(informational, informationalRun.options)
  assert.equal(informationalResult.results[1].verdict, 'fail')
  assert.deepEqual(
    [...gates.blockingGateIds(informational, informationalResult.results)],
    [],
    'a red informational gate blocks nothing',
  )
  assert.equal(gates.gatesSatisfied(informational, informationalResult.results), true, 'a red benchmark does not block')

  const required = {
    workspaceId: 'W-1',
    gates: [nodeSpec('tests', 'process.exit(0)'), nodeSpec('benchmark', 'process.exit(7)')],
  }
  const requiredRun = policyOptions(worktree())
  const requiredResult = await gates.runGatePolicy(required, requiredRun.options)
  assert.deepEqual([...gates.blockingGateIds(required, requiredResult.results)], ['benchmark'])
  assert.equal(gates.gatesSatisfied(required, requiredResult.results), false, 'a required failure blocks admission')

  // `strict` widens the rule to every gate, including one that called itself
  // informational — the workspace decides, not the gate.
  const strict = { workspaceId: 'W-1', strict: true, gates: informational.gates }
  assert.equal(gates.gatesSatisfied(strict, requiredResult.results), false)
  assert.deepEqual([...gates.blockingGateIds(strict, requiredResult.results)], ['benchmark'])
})

test('a base gate fails when the attempt base is not the head it ran against', async () => {
  const policy = {
    workspaceId: 'W-1',
    gates: [nodeSpec('base', "process.stdout.write('the comparison decides, not this command')")],
  }

  const aligned = policyOptions(worktree(), { attemptBaseSha: HEAD_SHA })
  const alignedResult = await gates.runGatePolicy(policy, aligned.options)
  assert.equal(alignedResult.results[0].verdict, 'pass')
  // No process ran, so no process reported an exit code: `null` is what the
  // contract means by it, and the verdict is the carrier of the outcome.
  assert.equal(alignedResult.results[0].exitCode, null)
  assert.match(aligned.artifacts.stored[0].input.log, /base/i, 'the comparison is written down as evidence')

  const diverged = policyOptions(worktree(), { attemptBaseSha: OTHER_SHA })
  const divergedResult = await gates.runGatePolicy(policy, diverged.options)
  assert.equal(divergedResult.results[0].verdict, 'fail')
  assert.notEqual(divergedResult.results[0].verdict, 'pass')
  assert.equal(gates.gatesSatisfied(policy, divergedResult.results), false)
  assert.match(diverged.artifacts.stored[0].input.log, new RegExp(OTHER_SHA))
  assert.match(diverged.artifacts.stored[0].input.log, new RegExp(HEAD_SHA))

  // The comparison the policy configured but did not feed is an error with the
  // reason vocabulary's "required gate produced no result", never a pass.
  const unfed = policyOptions(worktree())
  const unfedResult = await gates.runGatePolicy(policy, unfed.options)
  assert.equal(unfedResult.results[0].verdict, 'error')
  assert.equal(unfedResult.results[0].reason, 'GATE_MISSING')
})

test('a policy whose executable is missing is an error and blocks admission', async () => {
  const policy = {
    workspaceId: 'W-1',
    gates: [
      nodeSpec('tests', 'process.exit(0)'),
      { id: 'lint', command: 'dsh-mywork-gate-that-does-not-exist', args: [], timeoutMs: 5_000 },
    ],
  }
  const { artifacts, options } = policyOptions(worktree())
  const result = await gates.runGatePolicy(policy, options)

  assert.equal(result.results[1].verdict, 'error')
  assert.equal(result.results[1].reason, 'GATE_TOOL_MISSING')
  assert.notEqual(result.results[1].verdict, 'pass')
  assert.equal(gates.gatesSatisfied(policy, result.results), false, 'a tool that never ran cannot admit the work')
  assert.deepEqual([...gates.blockingGateIds(policy, result.results)], ['lint'])
  assert.equal(artifacts.stored.length, 2)
})

test('the workspace decides the set, and a task cannot widen it', async () => {
  const policy = { workspaceId: 'W-1', gates: [nodeSpec('tests', 'process.exit(0)')] }
  const source = gates.defineGatePolicySource([policy])
  const resolved = gates.resolveGatePolicy(source, 'W-1')

  assert.equal(resolved, source.policyFor('W-1'), 'the resolver hands back the configured policy itself')
  assert.deepEqual(
    [...contracts.GATE_POLICY_FIELDS],
    ['workspaceId', 'gates', 'strict'],
    'a policy carries the workspace it belongs to',
  )
  assert.equal(resolved.workspaceId, 'W-1')
  assert.equal(resolved.gates.length, 1)
})
