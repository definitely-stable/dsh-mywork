/**
 * Gate admission: failing or missing verification blocks review (architecture
 * §19, §32; MW-023, E-17).
 *
 * §19's acceptance is an inequality, and these five tests state it from both
 * sides: no complete passing set of required gates for the exact head means no
 * admission — whether the set is empty, red, broken, or about a different head —
 * while a green set admits and the `done` state stays unreachable without the
 * review that admission guards.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

import { adapterTesting, core, evidence, execution, repoRoot, storage } from './lib/fixtures.mjs'

/**
 * The allocator is the composition layer's module, so it is imported from its
 * source, as every other suite that opens a review schema does (§1.6, D08).
 */
const allocatorModule = await import(
  pathToFileURL(join(repoRoot, 'packages', 'controller', 'src', 'migration-allocator.ts')).href
)

const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-gates-admission-'

/** The head every gate in this suite ran against. */
const HEAD = 'b'.repeat(40)

/** The head a moved gate answered about instead. */
const OTHER_HEAD = 'c'.repeat(40)

/** The attempt under admission. */
const ATTEMPT = 'attempt-op-1'

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) {
    assert.ok(dir.startsWith(join(tmpdir(), TEMP_PREFIX)), `refusing to remove ${dir}`)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // A store left open by a failing test keeps the file locked on Windows.
    }
  }
})

/** An open store carrying the evidence schema, and its artifact store. */
async function gateFixture() {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await storage.openStore({
    path: join(tempDir(), 'controller.sqlite'),
    migrations: [...storage.MYWORK_MIGRATIONS, ...evidence.EVIDENCE_MIGRATIONS],
    clock: { now: () => clock.now() },
  })
  const artifacts = evidence.createArtifactStore(store, { now: () => clock.now() })
  return { clock, store, artifacts }
}

/**
 * Store one gate's verdict the way the runner does: a log artifact plus the
 * `gate-result` record that references it.
 */
function putGateResult(artifacts, input) {
  const log = artifacts.put({
    artifactId: `log-${input.id}-${input.suffix}`,
    kind: 'build-log',
    workspaceId: 'W-1',
    correlationId: 'corr-1',
    contentType: 'text/plain',
    bytes: new TextEncoder().encode(`output of gate ${input.id}`),
    taskId: 'T-1',
    attemptId: input.attemptId ?? ATTEMPT,
  })
  const gate = {
    id: input.id,
    headSha: input.headSha ?? HEAD,
    exitCode: input.exitCode === undefined ? (input.verdict === 'pass' ? 0 : 1) : input.exitCode,
    verdict: input.verdict,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    artifactRef: log.ref,
  }
  return artifacts.put({
    artifactId: `gate-${input.id}-${input.suffix}`,
    kind: 'gate-result',
    workspaceId: 'W-1',
    correlationId: 'corr-1',
    contentType: 'application/json',
    bytes: new TextEncoder().encode(JSON.stringify(gate)),
    taskId: 'T-1',
    attemptId: input.attemptId ?? ATTEMPT,
  })
}

/** Read the attempt's gate results, asserting the read itself succeeded. */
function readGates(store) {
  const read = execution.readGateResults(store, ATTEMPT)
  assert.equal(read.ok, true, read.ok ? '' : `${read.error.code}: ${read.error.message}`)
  return read.value
}

/** The refusal of an admission decision, as the caller branches on it. */
function refusalOf(decision) {
  assert.equal(decision.ok, false, 'admission must be refused')
  assert.equal(decision.error.code, 'TASK_CONFLICT')
  assert.equal(decision.error.details.refusal, 'REVIEW_GATES_MISSING')
  return decision.error
}

/** The gates that kept admission out, in gate-id order so the assertion is about the set. */
function blocksOf(error) {
  return [...error.details.blocks].sort((left, right) => left.id.localeCompare(right.id))
}

test('an attempt with no gate records at all is not admitted to review', async () => {
  const { store } = await gateFixture()
  const results = readGates(store)
  assert.deepEqual(results, [], 'no gate ran, so there is nothing to read')

  const decision = execution.assertGatesSatisfied(ATTEMPT, HEAD, results)
  const refusal = refusalOf(decision)
  assert.match(refusal.message, /no complete passing gate set/)
  assert.deepEqual(refusal.details.blocks, [])
  assert.equal(refusal.details.headSha, HEAD)
  assert.equal(refusal.details.attemptId, ATTEMPT)
})

test('a failing required gate blocks admission', async () => {
  const { store, artifacts } = await gateFixture()
  putGateResult(artifacts, { id: 'build', verdict: 'pass', suffix: 'a' })
  putGateResult(artifacts, { id: 'tests', verdict: 'fail', suffix: 'a' })

  const decision = execution.assertGatesSatisfied(ATTEMPT, HEAD, readGates(store))
  const refusal = refusalOf(decision)
  assert.deepEqual(blocksOf(refusal), [{ id: 'tests', reason: 'not-passing', verdict: 'fail' }])

  // The failing gate is the only one that blocked: the passing one is still read
  // and reported, so an operator can see how far the attempt got.
  const read = readGates(store)
  assert.equal(read.length, 2)
  assert.equal(read[0].artifactRef.hash.length, 64, 'the verdict references its log artifact')
})

test('an error, a timeout, and a verdict about another head are all refusals', async () => {
  const { clock, store, artifacts } = await gateFixture()
  putGateResult(artifacts, { id: 'lint', verdict: 'error', exitCode: null, reason: 'GATE_TOOL_MISSING', suffix: 'a' })
  putGateResult(artifacts, { id: 'unit', verdict: 'timeout', exitCode: null, suffix: 'a' })
  putGateResult(artifacts, { id: 'base', verdict: 'pass', headSha: OTHER_HEAD, suffix: 'a' })

  const refusal = refusalOf(execution.assertGatesSatisfied(ATTEMPT, HEAD, readGates(store)))
  assert.deepEqual(blocksOf(refusal), [
    { id: 'base', reason: 'head-moved' },
    { id: 'lint', reason: 'not-passing', verdict: 'error' },
    { id: 'unit', reason: 'not-passing', verdict: 'timeout' },
  ])

  // A record the contract cannot accept is a refusal too, never an empty set: an
  // empty set would read as "nothing was configured", which is a different fact.
  artifacts.put({
    artifactId: 'gate-broken',
    kind: 'gate-result',
    workspaceId: 'W-1',
    correlationId: 'corr-1',
    contentType: 'application/json',
    bytes: new TextEncoder().encode(JSON.stringify({ id: 'broken', verdict: 'pass' })),
    taskId: 'T-1',
    attemptId: ATTEMPT,
  })
  await clock.advance(10)
  const malformed = execution.readGateResults(store, ATTEMPT)
  assert.equal(malformed.ok, false)
  assert.equal(malformed.error.code, 'CONTRACT_MISMATCH')
  assert.equal(malformed.error.details.reason, 'gate-result-malformed')
})

test('an explicitly empty required gate set admits nothing', async () => {
  const { store, artifacts } = await gateFixture()
  putGateResult(artifacts, { id: 'informational', verdict: 'pass', suffix: 'a' })

  const refusal = refusalOf(
    execution.assertGatesSatisfied(ATTEMPT, HEAD, readGates(store), { requiredGateIds: [] }),
  )
  assert.deepEqual(
    refusal.details.blocks,
    [],
    'an empty required set is a strict refusal, not a missing-gate or informational-gate failure',
  )
  assert.equal(refusal.details.headSha, HEAD)
  assert.equal(refusal.details.attemptId, ATTEMPT)
})

test('a complete green required set admits, and the last result of a gate wins', async () => {
  const { clock, store, artifacts } = await gateFixture()
  putGateResult(artifacts, { id: 'build', verdict: 'pass', suffix: 'a' })
  putGateResult(artifacts, { id: 'tests', verdict: 'pass', suffix: 'a' })
  putGateResult(artifacts, { id: 'bench', verdict: 'fail', suffix: 'a' })

  // `bench` is informational, so its failure does not block when the caller says
  // which gates are required; the two required ones are green.
  const admitted = execution.assertGatesSatisfied(ATTEMPT, HEAD, readGates(store), {
    requiredGateIds: ['build', 'tests'],
  })
  assert.equal(admitted.ok, true, admitted.ok ? '' : admitted.error.message)
  assert.deepEqual(admitted.value.results.map(result => result.id), ['build', 'tests'])
  assert.equal(admitted.value.headSha, HEAD)
  assert.equal(admitted.value.attemptId, ATTEMPT)

  // Without that statement every recorded gate is required — an unstated gate is
  // not an optional one — so the same records refuse.
  refusalOf(execution.assertGatesSatisfied(ATTEMPT, HEAD, readGates(store)))

  // A later result for the same gate is the one that counts, in either direction.
  await clock.advance(10)
  putGateResult(artifacts, { id: 'tests', verdict: 'pass', suffix: 'b' })
  await clock.advance(10)
  putGateResult(artifacts, { id: 'tests', verdict: 'fail', suffix: 'c' })
  const after = refusalOf(execution.assertGatesSatisfied(ATTEMPT, HEAD, readGates(store), { requiredGateIds: ['tests'] }))
  assert.deepEqual(blocksOf(after), [{ id: 'tests', reason: 'not-passing', verdict: 'fail' }])

  // And a required gate that never ran is refused as missing.
  const missing = refusalOf(
    execution.assertGatesSatisfied(ATTEMPT, HEAD, readGates(store), { requiredGateIds: ['tests', 'policy'] }),
  )
  assert.deepEqual(blocksOf(missing), [
    { id: 'policy', reason: 'missing' },
    { id: 'tests', reason: 'not-passing', verdict: 'fail' },
  ])
})

test('done stays unreachable without the review admission the gates guard', async () => {
  const { store, artifacts } = await gateFixture()
  putGateResult(artifacts, { id: 'tests', verdict: 'fail', suffix: 'a' })

  // The gate check refuses, so no review is queued, so `approved` is never
  // reached — and `approved` is the only door to `integrating`.
  refusalOf(execution.assertGatesSatisfied(ATTEMPT, HEAD, readGates(store)))

  const intoDone = Object.entries(core.TASK_TRANSITIONS)
    .filter(([, targets]) => targets.includes('done'))
    .map(([from]) => from)
  assert.deepEqual(intoDone, ['integrating'])
  const intoIntegrating = Object.entries(core.TASK_TRANSITIONS)
    .filter(([, targets]) => targets.includes('integrating'))
    .map(([from]) => from)
  assert.deepEqual(intoIntegrating, ['approved'])
  const intoApproved = Object.entries(core.REVIEW_TRANSITIONS)
    .filter(([, targets]) => targets.includes('approved'))
    .map(([from]) => from)
  assert.deepEqual(intoApproved, ['reviewing'])
  // The chain is therefore gates → review → approved → integrating → done, and
  // the failing gate at its head is what keeps `done` out of reach.
  assert.equal(core.canTransitionTask('awaiting-review', 'done'), false)
  assert.equal(core.canTransitionTask('reviewing', 'done'), false)
})

// ---------------------------------------------------------------------------
// E-17 is a *call*: the review queue asks the gates before it queues anything.
// A suite that only exercises the pure check would stay green if that call were
// deleted, so the admission path itself is driven here through `requestReview`.
// ---------------------------------------------------------------------------

/** The diff hash the reviewed artifact of the queue-level test carries. */
const DH = 'd'.repeat(64)

/** The attempt the queue-level test reviews. */
const QUEUE_ATTEMPT = 'A-1'

/** Operation identity for one queue call. */
const op = operationId => core.defineOperationMeta({ operationId, correlationId: 'corr-1' })

/** One encoded payload. */
const text = value => new TextEncoder().encode(value)

/**
 * A `TaskGraphPort` over one task in the given state, recording every transition
 * it was asked for so a test can prove the queue moved nothing.
 */
function graphPort(state) {
  const tasks = new Map([
    ['T-1', Object.freeze({ id: 'T-1', workspaceId: 'W-1', title: 'Task 1', description: '', state, revision: 1, dependsOn: [] })],
  ])
  const transitions = []
  return {
    transitions,
    port: {
      capabilities: async () => ({ adapterId: 'fake', contractVersion: 'taskgraph/v1', capabilities: {}, source: 'declared' }),
      get: async id => {
        const task = tasks.get(id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${id}"`)
        return task
      },
      ready: async () => [],
      blocked: async () => [],
      dependencies: async () => [],
      mutatePlan: async () => {
        throw new Error('the review queue never mutates a plan')
      },
      claim: async () => {
        throw new Error('the review queue never claims a task')
      },
      doctor: async () => [],
      transition: async command => {
        transitions.push(command.to)
        const task = tasks.get(command.id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${command.id}"`)
        const next = Object.freeze({ ...task, state: command.to, revision: task.revision + 1 })
        tasks.set(command.id, next)
        return next
      },
    },
  }
}

/** How many reviews the queue holds for a store. */
const queued = store => store.transaction(tx => tx.get('SELECT COUNT(*) AS n FROM review_claim')).n

/**
 * A review queue over a fresh controller database, with one settled attempt and
 * the review migration at the version the **allocator** handed out (§1.6, D08).
 */
async function queueFixture() {
  const clock = new adapterTesting.FakeClock(1_000)
  const path = join(tempDir(), 'controller.sqlite')
  const baseMigrations = [...storage.MYWORK_MIGRATIONS, ...evidence.EVIDENCE_MIGRATIONS, ...execution.CLAIM_SAGA_MIGRATIONS]
  const book = await storage.openStore({ path, migrations: baseMigrations, clock: { now: () => clock.now() } })
  const allocator = allocatorModule.createMigrationAllocator(book, { now: () => clock.now() })
  const version = allocator.allocate({ key: execution.REVIEW_CLAIM_ALLOCATION_KEY })
  book.close()
  const migration = execution.createReviewClaimMigration({ version })
  const store = await storage.openStore({
    path,
    migrations: [...baseMigrations, migration],
    clock: { now: () => clock.now() },
  })
  const artifacts = evidence.createArtifactStore(store, { now: () => clock.now() })
  const graph = graphPort('awaiting-review')
  const queue = execution.createReviewQueue({
    store,
    graph: graph.port,
    clock: { now: () => clock.now() },
    migration,
    git: {
      resolveHead: async (_cwd, callMeta) => core.ok(HEAD, callMeta),
      diffHash: async (_cwd, _base, _head, callMeta) => core.ok(DH, callMeta),
      isClean: async (_cwd, callMeta) => core.ok(true, callMeta),
    },
  })
  const common = { workspaceId: 'W-1', correlationId: 'corr-1', taskId: 'T-1', attemptId: QUEUE_ATTEMPT }
  store.transaction(tx => {
    const fence = execution.allocateFence(tx, 'T-1', clock.now())
    execution.insertAttempt(tx, {
      id: QUEUE_ATTEMPT,
      taskId: 'T-1',
      workspaceId: 'W-1',
      agentId: 'Neo-1',
      state: 'running',
      revision: 1,
      fence,
      controllerEpoch: 3,
      leaseExpiresAt: clock.now() + 60_000,
      operationId: `op-${QUEUE_ATTEMPT}`,
      createdAt: clock.now(),
    })
    execution.settleAttempt(tx, QUEUE_ATTEMPT, 'running', 'completed', clock.now() + 1)
  })
  const refs = {
    diff: artifacts.put({ ...common, artifactId: `${QUEUE_ATTEMPT}-diff`, kind: 'diff', contentType: 'text/x-diff', bytes: text('--- a\n+++ b\n') }).ref,
    workerReport: artifacts.put({ ...common, artifactId: `${QUEUE_ATTEMPT}-report`, kind: 'worker-report', contentType: 'application/json', bytes: text('{}') }).ref,
    contextSnapshot: artifacts.put({ ...common, artifactId: `${QUEUE_ATTEMPT}-context`, kind: 'context-snapshot', contentType: 'application/json', bytes: text('{}') }).ref,
  }
  return { clock, store, artifacts, graph, queue, refs }
}

test('the review queue asks the gates, and a missing gate leaves no review behind', async () => {
  const h = await queueFixture()
  try {
    const evidenceInput = { reviewed: { headSha: HEAD, diffHash: DH }, ...h.refs }

    // An attempt that recorded no gate at all is refused by the queue itself.
    const missing = await h.queue.requestReview({ attemptId: QUEUE_ATTEMPT, evidence: evidenceInput, meta: op('op-missing') })
    const missingRefusal = refusalOf(missing)
    assert.deepEqual(missingRefusal.details.blocks, [])
    assert.equal(queued(h.store), 0, 'a refused admission leaves no review in the queue')

    // A gate that failed on this exact head is refused, and the refusal names it.
    putGateResult(h.artifacts, { id: 'tests', verdict: 'fail', suffix: 'red', attemptId: QUEUE_ATTEMPT })
    const red = await h.queue.requestReview({ attemptId: QUEUE_ATTEMPT, evidence: evidenceInput, meta: op('op-red') })
    const redRefusal = refusalOf(red)
    assert.deepEqual(blocksOf(redRefusal), [{ id: 'tests', reason: 'not-passing', verdict: 'fail' }])
    assert.equal(redRefusal.details.headSha, HEAD)
    assert.equal(queued(h.store), 0, 'a red gate leaves no review in the queue either')

    // The same call with a green gate for the same head is admitted, so the two
    // refusals above are about the gates and not about the harness.
    await h.clock.advance(10)
    putGateResult(h.artifacts, { id: 'tests', verdict: 'pass', suffix: 'green', attemptId: QUEUE_ATTEMPT })
    const admitted = await h.queue.requestReview({ attemptId: QUEUE_ATTEMPT, evidence: evidenceInput, meta: op('op-green') })
    assert.equal(admitted.ok, true, admitted.ok ? '' : admitted.error.message)
    assert.equal(admitted.value.claim.state, 'queued')
    assert.deepEqual(admitted.value.gates.map(gate => gate.id), ['tests'])
    assert.equal(queued(h.store), 1)

    // The evidence the refusal was made of is queryable the way an operator
    // would look for it: two verdicts for this attempt, one of them the green
    // one admission used.
    const stored = h.store.transaction(tx =>
      tx.get("SELECT COUNT(*) AS n FROM artifacts WHERE kind = 'gate-result' AND attempt_id = ?", QUEUE_ATTEMPT),
    )
    assert.equal(stored.n, 2, 'every verdict is stored as gate-result evidence')

    // Nothing in this path moves the task: the graph is the authority (§7).
    assert.deepEqual(h.graph.transitions, [])
  } finally {
    h.store.close()
  }
})
