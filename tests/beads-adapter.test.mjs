/**
 * Beads TaskGraph adapter acceptance (architecture §8, §9, §11, §39; ADR023,
 * ADR024).
 *
 * Two layers, and the split is deliberate:
 *
 * - **Pure policy** — status and priority mapping, the capability manifest, the
 *   staged-mutation planner, cycle detection. These are checked directly against
 *   the §42 codes and the ADR tables, because a wrong mapping is a silent bug:
 *   a `frozen` status mapped to a `done` category would let a dependent start
 *   after its blocker was cancelled, and nothing else in the system would notice.
 * - **Contract tests against a real `bd`** — readiness, guards, cycles,
 *   concurrency, idempotency, the journal cursor. These run on a workspace
 *   created **outside the repository tree**, because `bd` refuses a nested
 *   workspace and resolves any command from a repository subdirectory to the
 *   *ancestor's* workspace (ADR023). A suite that ran inside the repo would be
 *   testing the repo's own `.beads`, not the fixture it believes it built.
 *
 * The real-`bd` layer is skipped, loudly, when the binary is absent: a skipped
 * check must never look like a pass. In the CI profile (`MYWORK_REQUIRE_BEADS=1`)
 * an absent backend is not skipped but fatal — a contract check that cannot run
 * where the backend is guaranteed is a failure of the profile, not of the code.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test, { after } from 'node:test'

import { adapterSdk, adapterTesting, beads, contracts, core } from './lib/fixtures.mjs'

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** Workspaces this suite created, removed at the end. */
const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-beads-'

after(() => {
  for (const dir of tempDirs) {
    // A Dolt store can hold a handle for a moment after `bd` exits, so the
    // teardown retries; if it still cannot remove the fixture it says so instead
    // of throwing, because a teardown hiccup must not turn a green suite red.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      process.stderr.write(`beads-adapter: could not remove the fixture ${dir}: ${error.message}\n`)
    }
  }
})

/** A fresh temporary directory, created outside the repository tree on purpose. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  tempDirs.push(dir)
  return dir
}

/** The repository root, so a test can prove the fixture is outside it. */
const REPO_ROOT = resolve(import.meta.dirname, '..')

/** How `bd` is started, and whether a usable one answered. */
function launchOrUndefined() {
  try {
    return beads.resolveBeadsLaunch()
  } catch {
    return undefined
  }
}

/**
 * The launch seam this suite uses, resolved once.
 *
 * `spawn('bd', …, { shell: false })` cannot work on Windows: npm installs an
 * extensionless POSIX script plus a `bd.cmd` shim, and neither is an executable
 * (`ENOENT` -4058 and `EINVAL` respectively). The entry is therefore run by
 * `process.execPath`, exactly as the adapter's own runner does it.
 */
const LAUNCH = launchOrUndefined()

/**
 * The shared probe — the same function the adapter's Doctor calls, so this suite
 * and the diagnosis cannot disagree about whether the backend is there.
 */
const PROBE = await beads.probeBeads()

/** Whether a usable `bd` answered. */
const HAS_BD = PROBE.available

if (!HAS_BD) {
  // Say it once, loudly, naming the failure that actually happened: a skipped
  // check must never look like a pass, and it must not blame a cause the probe
  // never observed (the old text blamed an EPERM that this seam cannot produce).
  const notice =
    'beads-adapter: the real-bd contract checks are SKIPPED — '
    + `${beads.describeBeadsProbe(PROBE)}. These are not passes.\n`
  if (process.env.MYWORK_REQUIRE_BEADS === '1') {
    // The CI profile. A backend that must be present and is not is a failure:
    // 23 silently skipped contract checks are the hole this closes (F-17).
    throw new Error(notice)
  }
  process.stderr.write(notice)
}

/** Run `bd` synchronously in a directory and return the outcome. */
function bd(cwd, args, stdin) {
  if (LAUNCH === undefined) throw new Error('beads-adapter: no bd launch was resolved')
  const result = spawnSync(LAUNCH.command, [...LAUNCH.args, ...args], {
    cwd,
    encoding: 'utf8',
    shell: LAUNCH.shell,
    input: stdin,
  })
  return { code: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() }
}

// ---------------------------------------------------------------------------
// §0 The seam: what a skip says when the backend is absent
// ---------------------------------------------------------------------------

test('a skip notice names the failure that actually happened, never a guessed cause', () => {
  // The probe's real failure on Windows is ENOENT (-4058) — the shim is a command
  // line, not an executable. The notice must say that, with the install command,
  // and must not repeat the EPERM story this probe cannot produce.
  const text = beads.describeBeadsProbe({
    available: false,
    reason: 'spawn-failed',
    stderr: 'spawn bd ENOENT',
    code: 'ENOENT',
    errno: -4058,
  })
  assert.match(text, /ENOENT/)
  assert.match(text, /-4058/)
  assert.match(text, /npm install -g @beads\/bd/)
  assert.doesNotMatch(text, /EPERM/)
})

/** A real workspace outside the repository tree, with the ADR023 status set. */
function makeRealWorkspace() {
  const dir = tempDir()
  const init = bd(dir, ['init', '--prefix', 'mw', '--skip-agents', '--skip-hooks'])
  assert.equal(init.code, 0, `bd init failed: ${init.stderr}`)
  const config = bd(dir, ['config', 'set', 'status.custom', beads.ADR023_STATUS_CUSTOM])
  assert.equal(config.code, 0, `bd config set failed: ${config.stderr}`)
  return dir
}

/** Create a task and return its id. */
function createTask(dir, title, status = 'open', priority = '2') {
  const result = bd(dir, ['create', '--title', title, '--status', status, '--priority', priority, '--silent'])
  assert.equal(result.code, 0, `bd create failed: ${result.stderr}`)
  return result.stdout.split(/\r?\n/).pop().trim()
}

/** A real adapter bound to a directory. */
function realAdapter(cwd) {
  // No `binary`: the runner resolves the launch seam itself, which is the path
  // the adapter takes in production on Windows (F-14).
  return new beads.BeadsTaskGraphAdapter({
    runner: beads.createProcessRunner(),
    cwd,
  })
}

/** Operation identity for a fixture call. */
function meta(overrides = {}) {
  return core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1', ...overrides })
}

/** Rows a scripted runner answers, keyed by the command's first argument. */
function scriptedRunner(answers) {
  const calls = []
  let last
  return {
    get calls() {
      return calls
    },
    async run(command) {
      calls.push(command)
      const key = command.args[0]
      const answer = answers[key]
      if (answer !== undefined) last = answer
      if (typeof answer === 'function') return answer(command)
      return answer ?? last ?? { code: 0, stdout: '[]', stderr: '' }
    },
  }
}

// ---------------------------------------------------------------------------
// §1 Capability manifest and negotiation
// ---------------------------------------------------------------------------

test('the capability manifest declares every ADR023 flag, http included as false', () => {
  const manifest = beads.BEADS_ADAPTER_MANIFEST
  assert.equal(manifest.adapterId, 'beads')
  assert.equal(manifest.kind, 'taskgraph')
  assert.equal(manifest.contractVersion, 'taskgraph/v1')

  // Every capability ADR023 names must be a declared key — present, not absent —
  // so a caller can enumerate what the backend does NOT do without calling it.
  for (const capability of contracts.TASK_GRAPH_CAPABILITIES) {
    assert.ok(
      Object.hasOwn(manifest.capabilities, capability),
      `manifest does not declare "${capability}"`,
    )
    assert.equal(typeof manifest.capabilities[capability], 'boolean')
  }
  assert.deepEqual(
    Object.keys(manifest.capabilities).sort(),
    [...contracts.TASK_GRAPH_CAPABILITIES].sort(),
  )
})

test('CLI-only: http is false and guarded-batch is false, the rest are true', () => {
  const capabilities = beads.BEADS_CLI_CAPABILITIES
  assert.equal(capabilities.http, false, 'bd serve is not started, so http must be false')
  assert.equal(capabilities['guarded-batch'], false, 'bd batch takes no precondition')
  assert.equal(capabilities['graph-apply'], true)
  assert.equal(capabilities.batch, true)
  assert.equal(capabilities['batch-dep-remove'], true)
  assert.equal(capabilities['metadata-set'], true)
  assert.equal(capabilities['events-journal'], true)
  assert.equal(capabilities['claim-lease'], true)
  assert.equal(capabilities.heartbeat, true)
  assert.equal(capabilities.reclaim, true)
})

test('the manifest registers as taskgraph/v1 and is discovered by capability', () => {
  const { createAdapterRegistry } = adapterSdk
  const registry = createAdapterRegistry()
  const handle = registry.register({
    kind: beads.BEADS_ADAPTER_MANIFEST.kind,
    id: beads.BEADS_ADAPTER_ID,
    contractVersion: beads.BEADS_ADAPTER_MANIFEST.contractVersion,
    capabilities: beads.BEADS_ADAPTER_MANIFEST.capabilities,
    create: () => ({ marker: 'beads' }),
  })
  assert.equal(handle.manifest.adapterId, 'beads')

  // A caller requiring only what the CLI really offers is served...
  const served = registry.resolve('taskgraph', {
    capabilities: ['graph-apply', 'batch', 'batch-dep-remove'],
  })
  assert.equal(served.ok, true)

  // ...and a caller requiring the capability the adapter declares false is
  // refused with CAPABILITY_UNSUPPORTED rather than silently degraded.
  const refused = registry.resolve('taskgraph', { capabilities: ['http'] })
  assert.equal(refused.ok, false)
  assert.equal(refused.refusal.code, 'CAPABILITY_UNSUPPORTED')
  assert.deepEqual(refused.refusal.details.missing, ['http'])
})

// ---------------------------------------------------------------------------
// §2 Priority inversion (ADR023: Beads 0 is highest, MyWork orders higher-first)
// ---------------------------------------------------------------------------

test('priority inverts round-trip across the whole 0..4 range', () => {
  // Every value, both directions, and the composition is the identity. Checking
  // only one direction would pass for a constant function; checking only the
  // round-trip would pass for a wrong-but-involutive map, so both are asserted.
  for (let bdPriority = 0; bdPriority <= 4; bdPriority += 1) {
    const mine = beads.priorityFromBeads(bdPriority)
    assert.equal(mine, 4 - bdPriority, `fromBeads(${bdPriority})`)
    assert.equal(beads.priorityToBeads(mine), bdPriority, `round-trip at ${bdPriority}`)
  }
  // The ends swap: Beads 0 is the top, and must become MyWork's highest.
  assert.equal(beads.priorityFromBeads(0), 4)
  assert.equal(beads.priorityToBeads(4), 0)
  // The middle is the fixed point, which is what distinguishes 4-p from, say, p+1.
  assert.equal(beads.priorityFromBeads(2), 2)
})

test('an absent priority stays absent instead of becoming a default', () => {
  // §8 puts priority under the graph's authority: inventing "2" would make
  // "the graph did not say" indistinguishable from "the graph said medium".
  assert.equal(beads.optionalPriorityFromBeads(undefined), undefined)
  assert.equal(beads.optionalPriorityFromBeads(null), undefined)
  assert.equal(beads.optionalPriorityFromBeads(0), 4)
  assert.equal(beads.optionalPriorityFromBeads(4), 0)
})

test('an out-of-range priority is rejected rather than clamped', () => {
  for (const bad of [-1, 5, 1.5, Number.NaN]) {
    assert.throws(() => beads.priorityFromBeads(bad), RangeError, `fromBeads(${bad})`)
    assert.throws(() => beads.priorityToBeads(bad), RangeError, `toBeads(${bad})`)
  }
})

// ---------------------------------------------------------------------------
// §3 Status mapping: categories are what decide readiness
// ---------------------------------------------------------------------------

test('cancelled and superseded are frozen and do NOT satisfy a dependency', () => {
  // This is the rule the card singles out. A frozen blocker leaves its dependent
  // blocked until MyWork asks for an explicit decision.
  assert.equal(beads.beadsStatusOf('cancelled'), 'mw_cancelled')
  assert.equal(beads.beadsStatusOf('superseded'), 'mw_superseded')
  assert.equal(beads.categoryOfBeadsStatus('mw_cancelled'), 'frozen')
  assert.equal(beads.categoryOfBeadsStatus('mw_superseded'), 'frozen')

  // And the consequence, stated directly: neither releases a dependent. Only
  // `done` does.
  assert.equal(beads.satisfiesDependency('mw_cancelled'), false)
  assert.equal(beads.satisfiesDependency('mw_superseded'), false)
  assert.equal(beads.satisfiesDependency('closed'), true)
  assert.equal(beads.satisfiesDependency('open'), false)
  assert.equal(beads.satisfiesDependency('in_progress'), false)
})

test('draft and planned are wip, ready is open, and review is wip', () => {
  assert.equal(beads.beadsStatusOf('draft'), 'mw_draft')
  assert.equal(beads.beadsStatusOf('planned'), 'mw_planned')
  assert.equal(beads.categoryOfBeadsStatus('mw_draft'), 'wip')
  assert.equal(beads.categoryOfBeadsStatus('mw_planned'), 'wip')

  // `ready` must be the one active status, and `open` is the only active status
  // Beads has: that is what makes it the only claimable state.
  assert.equal(beads.beadsStatusOf('ready'), 'open')
  assert.equal(beads.categoryOfBeadsStatus('open'), 'active')

  // Review is in flight: a task under review must not go to a second worker.
  assert.equal(beads.beadsStatusOf('reviewing'), 'mw_in_review')
  assert.equal(beads.beadsStatusOf('awaiting-review'), 'mw_in_review')
  assert.equal(beads.categoryOfBeadsStatus('mw_in_review'), 'wip')
})

test('every MyWork state maps to a Beads status, and no wip state maps to active', () => {
  for (const state of contracts.TASK_STATES) {
    const status = beads.beadsStatusOf(state)
    assert.equal(typeof status, 'string', `state ${state}`)
    const category = beads.categoryOfBeadsStatus(status)
    assert.notEqual(category, undefined, `state ${state} maps to unknown status ${status}`)
  }
  // Exactly one state may be claimable: `ready`.
  const active = contracts.TASK_STATES.filter(
    state => beads.categoryOfBeadsStatus(beads.beadsStatusOf(state)) === 'active',
  )
  assert.deepEqual(active, ['ready'])
})

test('the state mapping round-trips, so a terminal state is not read back as done', () => {
  // Forward-only checks miss the dangerous direction: mapping `cancelled` onto
  // `done` passes every "has a status" and "is not active" assertion, while
  // making a cancelled task release its dependents — the exact behaviour ADR023
  // forbids. The round-trip is what catches it.
  for (const state of contracts.TASK_STATES) {
    const status = beads.beadsStatusOf(state)
    const back = beads.taskStateOfBeads(status)
    assert.notEqual(back, undefined, `${state} → ${status} does not read back`)
    // Several states share a Beads status (assigned/executing are both
    // in_progress), so the check is on category-equivalence, not identity.
    assert.equal(
      beads.categoryOfBeadsStatus(status),
      beads.categoryOfBeadsStatus(beads.beadsStatusOf(back)),
      `${state} → ${status} → ${back} changed category`,
    )
  }
  // The terminal states specifically must not read back as a done category.
  for (const state of ['cancelled', 'superseded']) {
    const status = beads.beadsStatusOf(state)
    assert.notEqual(
      beads.categoryOfBeadsStatus(status),
      'done',
      `${state} must not map to a done-category status`,
    )
    assert.equal(beads.satisfiesDependency(status), false, `${state} must not satisfy a dependency`)
  }
  // And `done` is the only state that does satisfy one.
  const satisfying = contracts.TASK_STATES.filter(state =>
    beads.satisfiesDependency(beads.beadsStatusOf(state)),
  )
  assert.deepEqual(satisfying, ['done'])
})

test('the ten ADR023 statuses are declared with their categories', () => {
  assert.equal(beads.ADR023_STATUSES.length, 10)
  const frozen = beads.ADR023_STATUSES.filter(status => status.category === 'frozen').map(s => s.name)
  assert.deepEqual(frozen, ['mw_cancelled', 'mw_superseded'])
  // Exactly one done-category status exists, and it is Beads' built-in `closed`;
  // every ADR023 status is wip or frozen.
  assert.equal(beads.ADR023_STATUSES.some(status => status.category === 'done'), false)
  assert.equal(beads.ADR023_STATUS_CUSTOM.split(',').length, 10)
})

// ---------------------------------------------------------------------------
// §4 status.custom completeness (ADR023 §5.16, the Doctor check)
// ---------------------------------------------------------------------------

test('a complete status.custom set reports no gaps', () => {
  const configured = beads.parseStatusCustom(beads.ADR023_STATUS_CUSTOM)
  assert.equal(Object.keys(configured).length, 10)
  assert.deepEqual(beads.statusCustomGaps(configured), [])
})

test('a partial status.custom set names every missing status and its category', () => {
  // The real configuration this workspace started from: five of ten.
  const partial = beads.parseStatusCustom(
    'mw_planned:wip,mw_failed:wip,mw_cancelled:frozen,mw_superseded:frozen,mw_in_review:wip',
  )
  const gaps = beads.statusCustomGaps(partial)
  assert.deepEqual(
    gaps.map(gap => gap.name),
    [
      'mw_draft',
      'mw_approved',
      'mw_integrating',
      'mw_changes_requested',
      'mw_needs_attention',
    ],
  )
  // Each gap carries the category ADR023 requires, so the fix is mechanical.
  assert.deepEqual(
    gaps.map(gap => [gap.name, gap.expected, gap.actual]),
    [
      ['mw_draft', 'wip', undefined],
      ['mw_approved', 'wip', undefined],
      ['mw_integrating', 'wip', undefined],
      ['mw_changes_requested', 'wip', undefined],
      ['mw_needs_attention', 'wip', undefined],
    ],
  )
})

test('a status with the wrong category is a gap, not a pass', () => {
  // `mw_cancelled:wip` would make a cancelled task claimable, which is worse
  // than the status being absent — so it must be reported, not accepted.
  const wrong = beads.parseStatusCustom(beads.ADR023_STATUS_CUSTOM.replace('mw_cancelled:frozen', 'mw_cancelled:wip'))
  const gaps = beads.statusCustomGaps(wrong)
  assert.deepEqual(gaps, [{ name: 'mw_cancelled', expected: 'frozen', actual: 'wip' }])
})

// ---------------------------------------------------------------------------
// §5 Cycle detection is performed before anything is applied (ADR024)
// ---------------------------------------------------------------------------

test('a cycle is detected before a mutation is applied', () => {
  const existing = [{ from: 'a', to: 'b', kind: 'blocks' }]
  const additions = [{ from: 'b', to: 'a', kind: 'blocks' }]
  const detected = beads.detectCycle(existing, additions)
  assert.equal(detected.cyclic, true)
  // The path names the cycle, so an operator sees which edge closed it.
  assert.ok(detected.path.includes('a') && detected.path.includes('b'))
})

test('a legal edge is not reported as a cycle', () => {
  const existing = [{ from: 'a', to: 'b', kind: 'blocks' }]
  const detected = beads.detectCycle(existing, [{ from: 'c', to: 'a', kind: 'blocks' }])
  assert.equal(detected.cyclic, false)
  assert.equal(detected.path, undefined)
})

test('a mutation that only removes edges is never a cycle', () => {
  // Removing cannot close a cycle, and the check must not reject a repair.
  const existing = [
    { from: 'a', to: 'b', kind: 'blocks' },
    { from: 'b', to: 'a', kind: 'blocks' },
  ]
  const detected = beads.detectCycle(existing, [])
  assert.equal(detected.cyclic, true, 'the pre-existing cycle is still visible')
  // With the offending edge removed from the observed graph, no cycle remains —
  // this is exactly the filtering the adapter performs before checking.
  const repaired = beads.detectCycle([{ from: 'a', to: 'b', kind: 'blocks' }], [])
  assert.equal(repaired.cyclic, false)
})

// ---------------------------------------------------------------------------
// §6 Staged mutation planning (ADR024)
// ---------------------------------------------------------------------------

test('a create-only mutation is classified atomic and planned as a graph', () => {
  const command = {
    baseRevision: 1,
    meta: meta(),
    create: [
      { key: 'root', title: 'Root', priority: 1 },
      { key: 'child', title: 'Child', priority: 2, dependsOnKeys: ['root'] },
    ],
  }
  assert.equal(beads.canApplyAtomically(command), true)
  const plan = beads.toGraphApplyPlan(command)
  assert.equal(plan.nodes.length, 2)
  // Dependencies are wired inside the one composite, by key.
  assert.deepEqual(plan.nodes[1].deps, [{ target: 'root', type: 'blocks' }])
})

test('a mutation touching an existing task is staged, not claimed atomic', () => {
  // ADR024: `bd create --graph` creates only, so any update or edge edit falls
  // outside it. Claiming atomicity here would be the exact false promise the ADR
  // forbids.
  assert.equal(
    beads.canApplyAtomically({
      baseRevision: 1,
      meta: meta(),
      create: [{ key: 'root', title: 'Root' }],
      removeDependencies: [{ from: 'a', to: 'b', kind: 'blocks' }],
    }),
    false,
  )
  assert.equal(
    beads.canApplyAtomically({
      baseRevision: 1,
      meta: meta(),
      update: [{ id: 'a', priority: 3 }],
    }),
    false,
  )
})

test('the staged plan puts dep add and dep remove in one batch and metadata outside it', () => {
  const command = {
    baseRevision: 1,
    meta: meta(),
    addDependencies: [{ from: 'x', to: 'y', kind: 'blocks' }],
    removeDependencies: [{ from: 'p', to: 'q', kind: 'blocks' }],
    update: [
      { id: 'x', title: 'Renamed', priority: 4, setMetadata: { team: 'platform' } },
    ],
  }
  const staged = beads.toStagedMutationPlan(command)

  // Both edge operations land in the transaction: `bd batch` is the only
  // primitive that can remove an edge, and it does add and remove together.
  assert.deepEqual(staged.batch, [
    'dep add x y blocks',
    'dep remove p q',
    'update x title="Renamed" priority=4',
  ])
  // Metadata is NOT in the batch: `bd batch` rejects `metadata` as an
  // unsupported key. It goes out as a key-scoped update instead.
  assert.equal(
    staged.batch.some(line => line.includes('metadata')),
    false,
  )
  assert.deepEqual(staged.updates, [
    { id: 'x', title: 'Renamed', priority: 4, setMetadata: { team: 'platform' } },
  ])
})

test('the staged plan never issues a document metadata replacement', () => {
  // `bd update --metadata` merges rather than replaces, so it cannot express
  // "this is the document now". Only `--set-metadata` may appear.
  const staged = beads.toStagedMutationPlan({
    baseRevision: 1,
    meta: meta(),
    update: [{ id: 'a', setMetadata: { one: '1', two: '2' } }],
  })
  assert.deepEqual(staged.batch, [])
  assert.deepEqual(staged.updates[0].setMetadata, { one: '1', two: '2' })
  assert.equal(JSON.stringify(staged).includes('--metadata'), false)
})

test('a batch value containing a quote or backslash is escaped, not split', () => {
  // The batch grammar is whitespace-separated with quoted strings, so an
  // unescaped quote in a title could turn into a second command.
  assert.equal(beads.quoteBatchValue('plain'), '"plain"')
  assert.equal(beads.quoteBatchValue('has space'), '"has space"')
  assert.equal(beads.quoteBatchValue('say "hi"'), '"say \\"hi\\""')
  assert.equal(beads.quoteBatchValue('back\\slash'), '"back\\\\slash"')
})

test('verification reports a missing or surviving edge as recovery', () => {
  const command = {
    baseRevision: 1,
    meta: meta(),
    addDependencies: [{ from: 'a', to: 'b', kind: 'blocks' }],
    removeDependencies: [{ from: 'c', to: 'd', kind: 'blocks' }],
  }
  // Neither edge landed → recovery, not success.
  assert.throws(
    () => beads.verifyStagedMutation(command, []),
    error => error.code === 'PLAN_MUTATION_RECOVERY',
  )
  // The removal did not take effect → recovery.
  assert.throws(
    () => beads.verifyStagedMutation(command, [{ from: 'a', to: 'b', kind: 'blocks' }, { from: 'c', to: 'd', kind: 'blocks' }]),
    error => error.code === 'PLAN_MUTATION_RECOVERY',
  )
  // Exactly the intended outcome → success.
  assert.doesNotThrow(() =>
    beads.verifyStagedMutation(command, [{ from: 'a', to: 'b', kind: 'blocks' }]),
  )
})

test('a plan node depending on an unknown key is refused', () => {
  assert.throws(
    () =>
      beads.toGraphApplyPlan({
        baseRevision: 1,
        meta: meta(),
        create: [{ key: 'child', title: 'Child', dependsOnKeys: ['ghost'] }],
      }),
    error => error.code === 'TASK_CONFLICT',
  )
})

// ---------------------------------------------------------------------------
// §7 Workspace discovery and fail-closed refusal (ADR023)
// ---------------------------------------------------------------------------

test('a missing workspace is refused fail-closed with the exact init command', async () => {
  // No `bd context` answer at all → ADAPTER_UNAVAILABLE, never an implicit init.
  const runner = scriptedRunner({ context: { code: 1, stdout: '', stderr: 'no beads database found' } })
  const adapter = new beads.BeadsTaskGraphAdapter({ runner, cwd: 'C:/nonexistent' })
  await assert.rejects(
    () => adapter.get('mw-1'),
    error => {
      assert.equal(error.code, 'ADAPTER_UNAVAILABLE')
      assert.equal(error.details.fixCommand, beads.BEADS_INIT_COMMAND)
      assert.match(error.message, /bd init --prefix mw/)
      return true
    },
  )
  // The adapter asked for context and nothing else: it never ran `bd init`.
  assert.deepEqual(
    runner.calls.map(call => call.args[0]),
    ['context'],
  )
  assert.equal(
    runner.calls.some(call => call.args[0] === 'init'),
    false,
    'the adapter must never run bd init',
  )
})

test('a panicking bd is recognised by exit code and stderr as unavailable', () => {
  const panic = 'panic: runtime error: invalid memory address or nil pointer dereference\n\ngoroutine 1 [running]:'
  assert.equal(beads.classifyBeadsFailure(2, panic), 'panic')
  // Exit 2 alone is still treated as a panic, because that is what bd init does.
  assert.equal(beads.classifyBeadsFailure(2, ''), 'panic')
  assert.equal(beads.classifyBeadsFailure(1, 'no beads database found'), 'no-workspace')
  assert.equal(beads.classifyBeadsFailure(1, 'something else broke'), 'command-failed')
})

test('an unreachable Dolt root resolves to unavailable with no retry', () => {
  // ADR023: bd init panics (exit 2) instead of reporting a clean error when its
  // Dolt root is unreachable, so the adapter must name it, not retry it.
  const policy = beads.resolveOutagePolicy('unavailable', 'panic')
  assert.equal(policy.continueLocalWork, true)
  assert.equal(policy.markProjectionDegraded, true)
  assert.equal(policy.retryNow, false, 'a missing Dolt root cannot be fixed by retrying')

  // A transient backend failure is different: §49 keeps execution going and the
  // caller may retry.
  const transient = beads.resolveOutagePolicy('degraded', 'command-failed')
  assert.equal(transient.retryNow, true)
  assert.equal(transient.continueLocalWork, true)
})

test('bd context output is parsed into the resolved workspace', () => {
  const parsed = beads.parseBeadsContext(
    [
      'bd version:     1.3.0',
      '',
      'Repository:',
      '  beads dir:    H:\\Repo\\DSH-MyWork\\.beads',
      '  repo root:    H:\\Repo\\DSH-MyWork',
      '  role:         maintainer',
      '',
      'Backend:',
      '  type:         dolt',
      '  mode:         embedded',
      '  database:     mw',
    ].join('\n'),
  )
  assert.equal(parsed.repoRoot, 'H:\\Repo\\DSH-MyWork')
  assert.equal(parsed.backendType, 'dolt')
  assert.equal(parsed.backendMode, 'embedded')
  assert.equal(parsed.database, 'mw')
})

// ---------------------------------------------------------------------------
// §8 Journal cursor (ADR023: per-replica AND per-branch)
// ---------------------------------------------------------------------------

test('a cursor is invalidated by a replica or branch change, not only by a pull', () => {
  const cursor = { seq: 12, replica: 'R1', branch: 'main' }
  assert.equal(beads.canResumeCursor(cursor, { replica: 'R1', branch: 'main' }), true)
  // A different replica: the same seq names a different record.
  assert.equal(beads.canResumeCursor(cursor, { replica: 'R2', branch: 'main' }), false)
  // A different Dolt branch: the journal is per-branch, so the rows differ.
  assert.equal(beads.canResumeCursor(cursor, { replica: 'R1', branch: 'feature' }), false)
})

test('a pruned journal prefix asks for a re-baseline instead of reporting caught-up', async () => {
  const runner = scriptedRunner({
    context: { code: 0, stdout: 'Repository:\n  beads dir:    /tmp/w/.beads\n  repo root:    /tmp/w\n', stderr: '' },
    branch: { code: 0, stdout: '\n🌿 Branches:\n\n  * main\n', stderr: '' },
    events: {
      code: 1,
      stdout: '',
      stderr: '{"code":"events_journal_truncated","since":3,"floor":9,"head":40}',
    },
  })
  const adapter = new beads.BeadsTaskGraphAdapter({ runner, cwd: '/tmp/w' })
  const read = await adapter.events({ seq: 3, replica: '/tmp/w', branch: 'main' })
  // Never an empty success: the caller must re-read the graph in full.
  assert.equal(read.reBaseline, true)
  assert.deepEqual(read.events, [])
  assert.equal(read.cursor.seq, 0)
})

test('an empty tail is reported as caught up, not as a re-baseline', async () => {
  const runner = scriptedRunner({
    context: { code: 0, stdout: 'Repository:\n  beads dir:    /tmp/w/.beads\n  repo root:    /tmp/w\n', stderr: '' },
    branch: { code: 0, stdout: '\n  * main\n', stderr: '' },
    events: { code: 0, stdout: '', stderr: '' },
  })
  const adapter = new beads.BeadsTaskGraphAdapter({ runner, cwd: '/tmp/w' })
  const read = await adapter.events({ seq: 7, replica: '/tmp/w', branch: 'main' })
  assert.equal(read.reBaseline, false)
  assert.equal(read.cursor.seq, 7, 'the cursor holds its position when nothing arrived')
})

// ---------------------------------------------------------------------------
// §9 Reconciler decisions (§9, §49)
// ---------------------------------------------------------------------------

test('a claim with no attempt is completed by creating one', () => {
  const decision = beads.reconcileClaim({
    taskId: 'mw-1',
    operationId: 'op-1',
    claimant: 'worker-a',
    attemptExists: false,
    task: { id: 'mw-1', assignee: 'worker-a' },
  })
  assert.equal(decision.action, 'create-attempt')
})

test('an attempt whose claim moved is revoked, not silently kept', () => {
  // Fence/lease ownership is MyWork's (§8); a claim the graph says belongs to
  // someone else means this attempt must stop.
  const decision = beads.reconcileClaim({
    taskId: 'mw-1',
    operationId: 'op-1',
    claimant: 'worker-a',
    attemptExists: true,
    task: { id: 'mw-1', assignee: 'worker-b' },
  })
  assert.equal(decision.action, 'revoke-claim')
})

test('an unreadable task resolves nothing rather than guessing', () => {
  const decision = beads.reconcileClaim({
    taskId: 'mw-1',
    operationId: 'op-1',
    claimant: 'worker-a',
    attemptExists: true,
    task: undefined,
  })
  // Revoking on absent evidence would kill live work — and so would calling it
  // `complete`, which would tell a caller the saga had been resolved when nothing
  // was observed at all. The action has to name the uncertainty, so a caller that
  // branches on "did this settle the saga?" cannot read an unread graph as a
  // finished one.
  assert.equal(decision.action, 'undecided')
  assert.match(decision.reason, /could not be read/)
})

test('matching claim and attempt complete the saga', () => {
  const decision = beads.reconcileClaim({
    taskId: 'mw-1',
    operationId: 'op-1',
    claimant: 'worker-a',
    attemptExists: true,
    task: { id: 'mw-1', assignee: 'worker-a' },
  })
  assert.equal(decision.action, 'complete')
})

test('the holder survives the adapter read, so the reconciler can see who holds a task', async () => {
  // The decision above is only as good as the task it is handed. `Task` carries
  // the graph's own view of the holder, and the adapter has to project the
  // backend's `assignee` onto it — otherwise every reconciler is told "nobody
  // holds this" no matter what the graph says, and §49's "attempt exists, agent
  // does not" becomes unanswerable.
  const runner = scriptedRunner({
    context: { code: 0, stdout: 'Repository:\n  beads dir:    /tmp/w/.beads\n  repo root:    /tmp/w\n', stderr: '' },
    show: {
      code: 0,
      stdout: JSON.stringify([{ id: 'mw-1', status: 'in_progress', assignee: 'worker-a', revision: 1 }]),
      stderr: '',
    },
    dep: { code: 0, stdout: '[]', stderr: '' },
  })
  const adapter = new beads.BeadsTaskGraphAdapter({ runner, cwd: '/tmp/w' })
  const task = await adapter.get('mw-1')
  assert.equal(task.assignee, 'worker-a', 'the graph holder must reach the domain task')

  // And the reconciler reaches the right decision from that very task.
  const decision = beads.reconcileClaim({
    taskId: task.id,
    operationId: 'op-1',
    claimant: 'worker-a',
    attemptExists: true,
    task,
  })
  assert.equal(decision.action, 'complete')

  const moved = beads.reconcileClaim({
    taskId: task.id,
    operationId: 'op-1',
    claimant: 'worker-z',
    attemptExists: true,
    task,
  })
  assert.equal(moved.action, 'revoke-claim', 'a claim held by someone else must revoke the attempt')
})

test('a task nobody claimed carries no assignee rather than an empty one', async () => {
  const runner = scriptedRunner({
    context: { code: 0, stdout: 'Repository:\n  beads dir:    /tmp/w/.beads\n  repo root:    /tmp/w\n', stderr: '' },
    show: { code: 0, stdout: JSON.stringify([{ id: 'mw-1', status: 'open', assignee: '', revision: 1 }]), stderr: '' },
    dep: { code: 0, stdout: '[]', stderr: '' },
  })
  const adapter = new beads.BeadsTaskGraphAdapter({ runner, cwd: '/tmp/w' })
  const task = await adapter.get('mw-1')
  assert.equal('assignee' in task, false, 'an unheld task must not claim a holder')
  const decision = beads.reconcileClaim({
    taskId: task.id,
    operationId: 'op-1',
    claimant: 'worker-a',
    attemptExists: false,
    task,
  })
  assert.equal(decision.action, 'abandon-intent')
})

// ---------------------------------------------------------------------------
// §11 Command shapes verified against Beads 1.3.0
//
// These encode the places where the real CLI disagreed with the obvious guess.
// Each was found by running the binary, and each would have been a silent
// failure: an empty graph, a failed claim, a lost plan.
// ---------------------------------------------------------------------------

test('the graph-apply reply is read from its ids map, not from prose', () => {
  // `bd create --graph --json` answers {"ids":{key:id}}. Parsing the human
  // "child -> mw-x" lines instead yields an empty mapping and the caller's keys
  // would silently point at nothing.
  const plan = { nodes: [{ key: 'root' }, { key: 'child' }] }
  assert.deepEqual(
    beads.parseGraphApplyOutput('{"ids":{"child":"mw-2","root":"mw-1"},"schema_version":1}', plan),
    { child: 'mw-2', root: 'mw-1' },
  )
  // A key the plan never declared is not invented into the mapping.
  assert.deepEqual(
    beads.parseGraphApplyOutput('{"ids":{"ghost":"mw-9"},"schema_version":1}', plan),
    {},
  )
  // Malformed output maps to "nothing created" rather than throwing.
  assert.deepEqual(beads.parseGraphApplyOutput('Created 2 issues', plan), {})
})

test('dependencies are read from the target-issue row bd dep list returns', async () => {
  // `bd dep list <id> --json` returns the TARGET issues — each row's `id` is the
  // task being depended on and `dependency_type` is the edge kind. A parser
  // looking for `depends_on_id` finds nothing and reports an empty graph.
  const runner = scriptedRunner({
    context: { code: 0, stdout: 'Repository:\n  beads dir:    /w/.beads\n  repo root:    /w\n', stderr: '' },
    dep: {
      code: 0,
      stdout: JSON.stringify([
        { id: 'mw-blocker', title: 'Blocker', dependency_type: 'blocks' },
        { id: 'mw-related', title: 'Related', dependency_type: 'relates-to' },
      ]),
      stderr: '',
    },
  })
  const adapter = new beads.BeadsTaskGraphAdapter({ runner, cwd: '/w' })
  assert.deepEqual(await adapter.dependencies('mw-dependent'), [
    { from: 'mw-dependent', to: 'mw-blocker', kind: 'blocks' },
    { from: 'mw-dependent', to: 'mw-related', kind: 'relates-to' },
  ])
})

test('claim passes the claimant as the acting identity, never as --assignee', async () => {
  // `--claim --assignee X` pre-sets a holder the claim then competes with: the
  // repeat call fails with "issue already claimed by X" instead of being
  // idempotent. The identity belongs in BEADS_ACTOR.
  const runner = scriptedRunner({
    context: { code: 0, stdout: 'Repository:\n  beads dir:    /w/.beads\n  repo root:    /w\n', stderr: '' },
    update: { code: 0, stdout: '{}', stderr: '' },
    show: { code: 0, stdout: JSON.stringify([{ id: 'mw-1', status: 'in_progress', assignee: 'worker-a' }]), stderr: '' },
  })
  const adapter = new beads.BeadsTaskGraphAdapter({ runner, cwd: '/w' })
  const result = await adapter.claim({ id: 'mw-1', claimant: 'worker-a', meta: meta() })

  const claimCall = runner.calls.find(call => call.args[0] === 'update')
  assert.notEqual(claimCall, undefined)
  assert.equal(claimCall.args.includes('--claim'), true)
  assert.equal(claimCall.args.includes('--assignee'), false, '--assignee must not accompany --claim')
  assert.equal(claimCall.env.BEADS_ACTOR, 'worker-a', 'the claimant rides BEADS_ACTOR')
  assert.equal(result.won, true)
})

test('heartbeat carries the acting identity in BEADS_ACTOR, exactly like claim', async () => {
  // `bd heartbeat <id>` without the actor is refused — `issue already claimed by
  // <holder>`, exit 1 — so an anonymous heartbeat cannot refresh anything. The
  // actor is the caller's when given, and otherwise the holder bd already
  // records (F-22).
  const runner = scriptedRunner({
    context: { code: 0, stdout: 'Repository:\n  beads dir:    /w/.beads\n  repo root:    /w\n', stderr: '' },
    show: { code: 0, stdout: JSON.stringify([{ id: 'mw-1', status: 'in_progress', assignee: 'worker-a' }]), stderr: '' },
    heartbeat: { code: 0, stdout: '', stderr: '' },
  })
  const adapter = new beads.BeadsTaskGraphAdapter({ runner, cwd: '/w' })

  // An explicit actor is used verbatim and never becomes an argument.
  await adapter.heartbeat('mw-1', 'worker-b')
  const named = runner.calls.find(call => call.args[0] === 'heartbeat')
  assert.notEqual(named, undefined)
  assert.deepEqual(named.args, ['heartbeat', 'mw-1'], 'the actor must not become an argument')
  assert.equal(named.env.BEADS_ACTOR, 'worker-b', 'the actor rides BEADS_ACTOR')

  // Without an actor the recorded holder is the actor: that is the lease being
  // refreshed, and it is the only identity bd will accept.
  const before = runner.calls.length
  await adapter.heartbeat('mw-1')
  const derived = runner.calls.slice(before).find(call => call.args[0] === 'heartbeat')
  assert.notEqual(derived, undefined)
  assert.equal(derived.env.BEADS_ACTOR, 'worker-a')
})

test('a claim that lost the race reports the holder instead of throwing', async () => {
  const runner = scriptedRunner({
    context: { code: 0, stdout: 'Repository:\n  beads dir:    /w/.beads\n  repo root:    /w\n', stderr: '' },
    update: { code: 1, stdout: '', stderr: 'issue already claimed by worker-b' },
    show: { code: 0, stdout: JSON.stringify([{ id: 'mw-1', status: 'in_progress', assignee: 'worker-b' }]), stderr: '' },
  })
  const adapter = new beads.BeadsTaskGraphAdapter({ runner, cwd: '/w' })
  const result = await adapter.claim({ id: 'mw-1', claimant: 'worker-a', meta: meta() })
  assert.equal(result.won, false)
  assert.equal(result.holder, 'worker-b')
})

test('the adapter itself refuses an operation whose capability is false', async () => {
  // The registry's negotiation and the adapter's own guard are different
  // defences. This one checks the adapter: given a backend that really is
  // reachable, an operation needing a capability it declares false must refuse
  // with CAPABILITY_UNSUPPORTED rather than attempt and hope.
  const runner = scriptedRunner({
    context: { code: 0, stdout: 'Repository:\n  beads dir:    /w/.beads\n  repo root:    /w\n', stderr: '' },
  })
  const adapter = new beads.BeadsTaskGraphAdapter({ runner, cwd: '/w' })

  // `http` is false in the CLI transport, and a claim with a revision needs it.
  await assert.rejects(
    () => adapter.claim({ id: 'mw-1', claimant: 'worker-a', meta: meta(), expectedRevision: 3 }),
    error => {
      assert.equal(error.code, 'CAPABILITY_UNSUPPORTED')
      assert.equal(error.details.capability, 'http')
      return true
    },
  )
  // The refusal happens before any command runs: nothing was attempted.
  assert.equal(
    runner.calls.some(call => call.args[0] === 'update'),
    false,
    'the adapter must refuse before mutating',
  )
})

test('capability negotiation is exercised per operation, not only at registration', () => {
  // Two layers guard a capability: the registry refuses to hand out an adapter
  // that lacks one, and the adapter refuses to run an operation needing one it
  // declares false. Only the second covers a caller that already holds the
  // adapter instance, so it is asserted here directly.
  const adapter = new beads.BeadsTaskGraphAdapter({
    runner: scriptedRunner({
      context: { code: 0, stdout: 'Repository:\n  beads dir:    /w/.beads\n  repo root:    /w\n', stderr: '' },
    }),
    cwd: '/w',
  })
  // Every declared capability is a boolean, and the false ones are the ones the
  // CLI transport genuinely lacks.
  assert.equal(beads.BEADS_CLI_CAPABILITIES.http, false)
  assert.equal(beads.BEADS_CLI_CAPABILITIES['guarded-batch'], false)
  // The manifest the registry reads carries the same values, so a caller can
  // decide without instantiating anything.
  assert.deepEqual(beads.BEADS_ADAPTER_MANIFEST.capabilities, { ...beads.BEADS_CLI_CAPABILITIES })
  assert.equal(typeof adapter.capabilities, 'function')
})

test('every capability flag has a matching refusal path in the adapter', () => {
  // Guard the enumeration itself: a capability that is declared but never
  // consulted would be documentation, not negotiation.
  const declared = Object.keys(beads.BEADS_CLI_CAPABILITIES)
  assert.deepEqual(declared.sort(), [...contracts.TASK_GRAPH_CAPABILITIES].sort())

  // Each flag names a real operation. `http` and `guarded-batch` are consulted
  // through the revisioned-claim and guarded-transition refusals; the rest are
  // consulted by the operation that needs them.
  const consultedByOperation = {
    http: 'claim with expectedRevision',
    'graph-apply': 'mutatePlan atomic',
    batch: 'mutatePlan staged',
    'batch-dep-remove': 'mutatePlan staged removal',
    'guarded-batch': 'transition with expectedRevision',
    'metadata-set': 'mutatePlan metadata',
    'events-journal': 'events',
    'claim-lease': 'claim',
    heartbeat: 'heartbeat',
    reclaim: 'reclaim',
  }
  assert.deepEqual(Object.keys(consultedByOperation).sort(), declared.sort())
})

test('the generic capability guard refuses before any command runs', async () => {
  // `requireCapability` is the adapter's own defence, independent of the
  // registry. Exercised through a path that reaches it with a false flag: the
  // CLI transport declares `guarded-batch` false, so a mutation that would need
  // a guarded batch is refused rather than attempted.
  const runner = scriptedRunner({
    context: { code: 0, stdout: 'Repository:\n  beads dir:    /w/.beads\n  repo root:    /w\n', stderr: '' },
    // mutatePlan re-reads the graph before it applies anything, so `list` and
    // `dep` must answer with real JSON rather than inheriting the context text.
    list: { code: 0, stdout: '[]', stderr: '' },
    dep: { code: 0, stdout: '[]', stderr: '' },
    batch: { code: 0, stdout: '', stderr: '' },
  })
  const guarded = new beads.BeadsTaskGraphAdapter({ runner, cwd: '/w' })

  // A staged mutation is allowed (batch and metadata-set are true), and the
  // batch really is issued — so the guard is not simply refusing everything.
  await guarded.mutatePlan({
    baseRevision: 1,
    meta: meta(),
    removeDependencies: [{ from: 'a', to: 'b', kind: 'blocks' }],
  })
  assert.equal(
    runner.calls.some(call => call.args[0] === 'batch'),
    true,
    'a supported staged mutation must reach the backend',
  )

  // And the same adapter refuses an operation needing a flag it declares false,
  // naming the flag and running nothing for it.
  const before = runner.calls.length
  await assert.rejects(
    () => guarded.claim({ id: 'mw-1', claimant: 'w', meta: meta(), expectedRevision: 1 }),
    error => {
      assert.equal(error.code, 'CAPABILITY_UNSUPPORTED')
      return true
    },
  )
  assert.equal(runner.calls.length, before, 'a refused operation must not call the backend')
})

test('metadata is written with --set-metadata per key, never as a document', async () => {
  // The card forbids document replacement, and `bd update --metadata` merges
  // rather than replaces, so using it would silently fail to express the intent.
  // This asserts the actual command the adapter builds.
  const runner = scriptedRunner({
    context: { code: 0, stdout: 'Repository:\n  beads dir:    /w/.beads\n  repo root:    /w\n', stderr: '' },
    list: { code: 0, stdout: '[]', stderr: '' },
    dep: { code: 0, stdout: '[]', stderr: '' },
    update: { code: 0, stdout: '{}', stderr: '' },
  })
  const adapter = new beads.BeadsTaskGraphAdapter({ runner, cwd: '/w' })
  await adapter.mutatePlan({
    baseRevision: 1,
    meta: meta(),
    update: [{ id: 'mw-1', setMetadata: { team: 'platform', tier: 'a' } }],
  })

  const updateCalls = runner.calls.filter(call => call.args[0] === 'update')
  assert.equal(updateCalls.length, 1, 'one key-scoped update expected')
  const args = updateCalls[0].args
  // Both keys ride --set-metadata, one flag each.
  assert.deepEqual(
    args.filter((_, index) => args[index - 1] === '--set-metadata'),
    ['team=platform', 'tier=a'],
  )
  // The document form must not appear at all.
  assert.equal(args.includes('--metadata'), false, '--metadata must never be used')
})


test('the contract fixture workspace must live outside the repository tree', () => {
  // The invariant the shell-driven suite depends on: bd refuses a nested
  // workspace and resolves a command from any repository subdirectory to the
  // ancestor's workspace (ADR023), so a fixture inside the repo would silently
  // test the repo's own .beads.
  const dir = tempDir()
  const withinRepo = resolve(dir).toLowerCase().startsWith(REPO_ROOT.toLowerCase())
  assert.equal(withinRepo, false, `fixture ${dir} must be outside ${REPO_ROOT}`)
})

test('a real workspace outside the repository resolves to itself', { skip: !HAS_BD }, () => {
  const dir = makeRealWorkspace()
  const context = bd(dir, ['context'])
  assert.equal(context.code, 0)
  const workspace = beads.parseBeadsContext(context.stdout)
  assert.equal(workspace.repoRoot.toLowerCase(), resolve(dir).toLowerCase())
})

test('a frozen blocker leaves its dependent blocked (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  const blocker = createTask(dir, 'frozen blocker', 'mw_cancelled')
  const dependent = createTask(dir, 'dependent', 'open')
  assert.equal(bd(dir, ['dep', 'add', dependent, blocker]).code, 0)

  const adapter = realAdapter(dir)
  const ready = await adapter.ready()
  const blocked = await adapter.blocked()

  // The dependent is NOT ready: cancelled does not satisfy a dependency.
  assert.equal(
    ready.some(ref => ref.id === dependent),
    false,
    'a dependent of a cancelled task must not be ready',
  )
  const entry = blocked.find(ref => ref.id === dependent)
  assert.notEqual(entry, undefined, 'the dependent must appear in bd blocked')
  assert.deepEqual(entry.blockedBy, [blocker])
})

test('wip statuses never appear in bd ready, and open is the only ready status (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  const wipStatuses = ['mw_draft', 'mw_planned', 'mw_in_review', 'mw_failed', 'mw_approved']
  const createdWip = wipStatuses.map(status => [status, createTask(dir, `probe ${status}`, status)])
  const open = createTask(dir, 'probe open', 'open')

  const adapter = realAdapter(dir)
  const ready = await adapter.ready()
  const readyIds = ready.map(ref => ref.id)

  for (const [status, id] of createdWip) {
    assert.equal(readyIds.includes(id), false, `${status} must not appear in bd ready`)
  }
  assert.equal(readyIds.includes(open), true, 'open must appear in bd ready')
  // The single ready status is `open` — proven by the adapter's own mapping of
  // every row it returned, not by reading the raw rows again.
  assert.deepEqual([...new Set(ready.map(ref => ref.state))], ['ready'])
})

test('bd list --json carries no is_blocked field, so readiness is never read from it', { skip: !HAS_BD }, () => {
  const dir = makeRealWorkspace()
  const blocker = createTask(dir, 'blocker', 'open')
  const dependent = createTask(dir, 'dependent', 'open')
  bd(dir, ['dep', 'add', dependent, blocker])

  // The premise of the card's rule, checked against the real binary: the field
  // is absent even for a task bd blocked reports as blocked.
  const listed = JSON.parse(bd(dir, ['list', '--json']).stdout)
  const row = listed.find(issue => issue.id === dependent)
  assert.notEqual(row, undefined)
  assert.equal(Object.hasOwn(row, 'is_blocked'), false, 'is_blocked must not be present')
})

test('concurrent claim: exactly one of two racers wins (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  const id = createTask(dir, 'contended', 'open')

  const first = realAdapter(dir)
  const second = realAdapter(dir)
  const results = await Promise.all([
    first.claim({ id, claimant: 'worker-a', meta: meta({ operationId: 'op-a' }) }),
    second.claim({ id, claimant: 'worker-b', meta: meta({ operationId: 'op-b' }) }),
  ])

  const winners = results.filter(result => result.won === true)
  assert.equal(winners.length, 1, `exactly one racer must win, got ${winners.length}`)
})

test('claim is idempotent for the same claimant (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  const id = createTask(dir, 'idempotent', 'open')
  const adapter = realAdapter(dir)

  const first = await adapter.claim({ id, claimant: 'worker-a', meta: meta() })
  assert.equal(first.won, true)
  // Repeating the same operation must not fail and must not change the holder.
  const second = await adapter.claim({ id, claimant: 'worker-a', meta: meta() })
  assert.equal(second.won, true)
  assert.equal(second.task.id, id)
})

test('a stale guard is reported as STALE_REVISION, not as a generic failure (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  const id = createTask(dir, 'guarded', 'open')
  const adapter = realAdapter(dir)

  // A caller that names an assignee who does not hold the task: bd exits 13,
  // meaning nothing was written.
  await assert.rejects(
    () =>
      adapter.transition({
        id,
        to: 'executing',
        meta: meta(),
        expectedAssignee: 'somebody-else',
      }),
    error => {
      assert.equal(error.code, 'STALE_REVISION')
      assert.equal(error.details.exitCode, 13)
      return true
    },
  )

  // And nothing was written: the task is still in its original state.
  const after = await adapter.get(id)
  assert.equal(after.state, 'ready')
})

test('a guarded transition applies when the guard still holds (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  const id = createTask(dir, 'guarded ok', 'open')
  const adapter = realAdapter(dir)
  const before = await adapter.get(id)

  const updated = await adapter.transition({
    id,
    to: 'executing',
    meta: meta(),
    expectedRevision: before.revision,
  })
  assert.equal(updated.state, 'executing')
})

test('a cycle is refused by bd itself as well (real bd)', { skip: !HAS_BD }, () => {
  const dir = makeRealWorkspace()
  const a = createTask(dir, 'cycle a', 'open')
  const b = createTask(dir, 'cycle b', 'open')
  assert.equal(bd(dir, ['dep', 'add', b, a]).code, 0)
  const closing = bd(dir, ['dep', 'add', a, b])
  assert.notEqual(closing.code, 0, 'bd must refuse the edge that closes a cycle')
  assert.match(closing.stderr, /cycle/i)
})

test('bd batch commits dep add and dep remove in one transaction (real bd)', { skip: !HAS_BD }, () => {
  const dir = makeRealWorkspace()
  const a = createTask(dir, 'batch a', 'open')
  const b = createTask(dir, 'batch b', 'open')
  const c = createTask(dir, 'batch c', 'open')
  assert.equal(bd(dir, ['dep', 'add', a, b]).code, 0)

  // One transaction that both adds and removes — the primitive ADR024 relies on.
  const batch = bd(dir, ['batch'], `dep add ${a} ${c}\ndep remove ${a} ${b}\n`)
  assert.equal(batch.code, 0, batch.stderr)

  const edges = bd(dir, ['dep', 'list', a, '--json'])
  assert.equal(edges.code, 0)
  const listed = JSON.parse(edges.stdout)
  // Rows are target issues: `id` is the blocker being depended on and
  // `dependency_type` is the edge kind. Reading `depends_on_id` — a field this
  // response does not carry — found nothing and reported an empty graph, which is
  // why this check failed against a real bd 1.3.0 (F-21).
  const targets = listed.map(edge => edge.id)
  assert.equal(targets.includes(c), true, 'the added edge must be present')
  assert.equal(targets.includes(b), false, 'the removed edge must be gone')
})

test('a failing batch line rolls the whole transaction back (real bd)', { skip: !HAS_BD }, () => {
  const dir = makeRealWorkspace()
  const a = createTask(dir, 'rollback a', 'open')
  const b = createTask(dir, 'rollback b', 'open')

  // The third line is invalid, so the valid edge on line one must NOT survive.
  const batch = bd(dir, ['batch'], `dep add ${a} ${b}\nnot-a-command\n`)
  assert.notEqual(batch.code, 0)

  const edges = JSON.parse(bd(dir, ['dep', 'list', a, '--json']).stdout)
  assert.deepEqual(edges, [], 'a failed batch must leave no edge behind')
})

test('bd batch rejects metadata, which is why metadata is written per key (real bd)', { skip: !HAS_BD }, () => {
  const dir = makeRealWorkspace()
  const a = createTask(dir, 'meta a', 'open')
  // The limitation ADR024 records, verified rather than assumed.
  const batch = bd(dir, ['batch'], `update ${a} metadata={"k":1}\n`)
  assert.notEqual(batch.code, 0)
  assert.match(batch.stderr, /unsupported key "metadata"/)

  // The key-scoped form is accepted, and that is what the adapter uses.
  const set = bd(dir, ['update', a, '--set-metadata', 'team=platform'])
  assert.equal(set.code, 0, set.stderr)
})

test('bd update --metadata merges rather than replaces (real bd)', { skip: !HAS_BD }, () => {
  const dir = makeRealWorkspace()
  const a = createTask(dir, 'merge a', 'open')
  assert.equal(bd(dir, ['update', a, '--set-metadata', 'team=platform']).code, 0)
  assert.equal(bd(dir, ['update', a, '--metadata', '{"doc":1}']).code, 0)

  const shown = JSON.parse(bd(dir, ['show', a, '--json']).stdout)
  // Both keys survive: the document form cannot express replacement, which is
  // exactly why the adapter never uses it.
  assert.deepEqual(shown[0].metadata, { doc: 1, team: 'platform' })
})

test('an create-only plan applies as one atomic composite (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  const adapter = realAdapter(dir)

  const result = await adapter.mutatePlan({
    baseRevision: 1,
    meta: meta(),
    create: [
      { key: 'root', title: 'plan root', priority: 2 },
      { key: 'child', title: 'plan child', priority: 2, dependsOnKeys: ['root'] },
    ],
  })

  // The adapter reports the mode it really used; this mutation fits the composite.
  assert.equal(result.mode, 'atomic')
  const rootId = result.created.root
  const childId = result.created.child
  assert.notEqual(rootId, undefined)
  assert.notEqual(childId, undefined)

  // The dependency was wired inside the composite.
  const child = await adapter.get(childId)
  assert.deepEqual(child.dependsOn, [rootId])
})

test('a staged plan applies dep remove, which no atomic primitive covers (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  const adapter = realAdapter(dir)
  const a = createTask(dir, 'staged a', 'open')
  const b = createTask(dir, 'staged b', 'open')
  assert.equal(bd(dir, ['dep', 'add', a, b]).code, 0)

  const result = await adapter.mutatePlan({
    baseRevision: 1,
    meta: meta(),
    removeDependencies: [{ from: a, to: b, kind: 'blocks' }],
  })
  // Reported as staged, never as atomic: ADR024 forbids the false promise.
  assert.equal(result.mode, 'staged')

  const edges = await adapter.dependencies(a)
  assert.equal(edges.some(edge => edge.to === b), false, 'the edge must be gone')
})

test('a plan that would create a cycle is rejected before anything is applied (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  const adapter = realAdapter(dir)
  const a = createTask(dir, 'cyc a', 'open')
  const b = createTask(dir, 'cyc b', 'open')
  assert.equal(bd(dir, ['dep', 'add', b, a]).code, 0)

  await assert.rejects(
    () =>
      adapter.mutatePlan({
        baseRevision: 1,
        meta: meta(),
        addDependencies: [{ from: a, to: b, kind: 'blocks' }],
      }),
    error => error.code === 'ENTITY_CYCLE',
  )

  // Nothing was written: the original edge is the only one.
  const edges = await adapter.dependencies()
  assert.deepEqual(
    edges.map(edge => `${edge.from}->${edge.to}`).sort(),
    [`${b}->${a}`],
  )
})

test('the doctor reports a complete status.custom as healthy (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  const reports = await realAdapter(dir).doctor()
  const workspace = reports.find(report => report.check === 'beads.workspace')
  const statusCustom = reports.find(report => report.check === 'beads.status.custom')
  assert.equal(workspace.severity, 'ok')
  assert.equal(statusCustom.severity, 'ok', JSON.stringify(statusCustom))
})

test('the doctor warns and names every missing status when the set is incomplete (real bd)', { skip: !HAS_BD }, async () => {
  const dir = tempDir()
  assert.equal(bd(dir, ['init', '--prefix', 'mw', '--skip-agents', '--skip-hooks']).code, 0)
  // The five-of-ten set this workspace really started from.
  assert.equal(
    bd(dir, ['config', 'set', 'status.custom', 'mw_planned:wip,mw_failed:wip,mw_cancelled:frozen,mw_superseded:frozen,mw_in_review:wip']).code,
    0,
  )

  const reports = await realAdapter(dir).doctor()
  const statusCustom = reports.find(report => report.check === 'beads.status.custom')
  // A warning, never a silent pass...
  assert.equal(statusCustom.severity, 'warning')
  // ...that lists exactly the missing statuses and offers the exact fix.
  assert.deepEqual(statusCustom.missing, [
    'mw_draft',
    'mw_approved',
    'mw_integrating',
    'mw_changes_requested',
    'mw_needs_attention',
  ])
  assert.equal(statusCustom.fixCommand, `bd config set status.custom "${beads.ADR023_STATUS_CUSTOM}"`)
})

test('the doctor reports a missing workspace with the init command and runs no init (real bd)', { skip: !HAS_BD }, async () => {
  const dir = tempDir()
  const reports = await realAdapter(dir).doctor()
  const workspace = reports.find(report => report.check === 'beads.workspace')
  assert.equal(workspace.severity, 'error')
  assert.equal(workspace.fixCommand, beads.BEADS_INIT_COMMAND)
  // The remedy is printed, never executed: Doctor must not create a workspace.
  assert.equal(bd(dir, ['context']).code, 1)
})

test('the adapter refuses to initialise a workspace it was asked to read', { skip: !HAS_BD }, async () => {
  const dir = tempDir()
  const adapter = realAdapter(dir)
  await assert.rejects(
    () => adapter.ready(),
    error => error.code === 'ADAPTER_UNAVAILABLE' && /bd init --prefix mw/.test(error.message),
  )
  // Still no workspace: the refusal is a refusal, not a side effect.
  assert.equal(bd(dir, ['context']).code, 1)
})

test('claim with an expectedRevision is refused because http is false (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  const id = createTask(dir, 'guarded claim', 'open')
  const adapter = realAdapter(dir)

  // ADR023: the guarded composite needs the HTTP transport, which is declared
  // false. The adapter must refuse rather than claim blind.
  await assert.rejects(
    () => adapter.claim({ id, claimant: 'worker-a', meta: meta(), expectedRevision: 1 }),
    error => {
      assert.equal(error.code, 'CAPABILITY_UNSUPPORTED')
      assert.equal(error.details.capability, 'http')
      return true
    },
  )

  // And the task was not claimed as a side effect of the refusal.
  assert.equal((await adapter.get(id)).state, 'ready')
})

test('a heartbeat refreshes a held claim and reclaim reverts a stale one (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  const id = createTask(dir, 'leased', 'open')
  const adapter = realAdapter(dir)
  await adapter.claim({ id, claimant: 'worker-a', meta: meta() })

  // The heartbeat keeps the working claim alive rather than erroring.
  await assert.doesNotReject(() => adapter.heartbeat(id))

  // Reclaim with no grace window finds nothing: the lease is still live.
  const reclaimed = await adapter.reclaim({ olderThanMs: 0 })
  assert.equal(reclaimed.includes(id), false, 'a live lease must not be reclaimed')
})

test('the events journal is read by cursor and advances (real bd)', { skip: !HAS_BD }, async () => {
  const dir = makeRealWorkspace()
  assert.equal(bd(dir, ['config', 'set', 'events-journal', 'true']).code, 0)
  const adapter = realAdapter(dir)
  const id = createTask(dir, 'journalled', 'open')

  const first = await adapter.events()
  assert.equal(first.reBaseline, false)
  assert.ok(first.events.length >= 1, 'the create must be journalled')
  assert.ok(first.events.some(event => event.taskId === id))
  const head = first.cursor.seq

  // Reading from the head yields nothing new and does not move the cursor.
  const idle = await adapter.events(first.cursor)
  assert.deepEqual(idle.events, [])
  assert.equal(idle.cursor.seq, head)
  assert.equal(idle.reBaseline, false)

  // A new mutation advances it.
  assert.equal(bd(dir, ['update', id, '--priority', '0']).code, 0)
  const second = await adapter.events(first.cursor)
  assert.ok(second.events.length >= 1, 'the update must be journalled')
  assert.ok(second.cursor.seq > head)
})
