/**
 * Claim saga acceptance: ClaimIntent → graph claim → Attempt + lease →
 * projection → completed, with recover and revoke for an unfinished saga
 * (architecture §9, §17, §18.2, §49; §62 item 13).
 *
 * The invariants this suite holds, checked against the database and the graph
 * rather than through the code that claims them:
 *
 * - a fault injected after **any** of the five §9 steps leaves at most one live
 *   attempt and no second execution, and the saga can be finished exactly once;
 * - a late result from a superseded attempt is rejected — the fence is compared
 *   against the *task's* current token, not against the attempt's own copy, so an
 *   attempt that still believes it holds fence 17 cannot settle after the task
 *   moved to 18;
 * - a task has at most one authoritative execution lease, enforced by a partial
 *   unique index rather than by the service, so an insert that bypasses the
 *   service is refused by SQLite itself;
 * - `recover` never resolves a saga on absent evidence: an unreadable graph
 *   leaves the intent open instead of revoking a live attempt.
 *
 * Time comes from `FakeClock`; databases live in fresh temporary directories; the
 * live `$DSH_HOME` state, the board, and the DSH profile are never touched. The
 * task graph is a local fake, so the suite needs neither `bd` nor a model.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { adapterTesting, contracts, core, evidence, execution, lease, repoRoot, storage } from './lib/fixtures.mjs'
import { runCaptured } from '../scripts/lib/process.mjs'

/** Temporary directories created by this suite, removed at the end. */
const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-claim-'

/** A fresh temporary directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) {
    // Refuse anything this suite did not create, and treat a locked database as a
    // best-effort cleanup: the assertion below is what protects the filesystem.
    assert.ok(dir.startsWith(join(tmpdir(), TEMP_PREFIX)), `refusing to remove ${dir}`)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // A store left open by a failing test keeps the file locked on Windows.
    }
  }
})

/** Operation identity for one call. */
function meta(overrides = {}) {
  return core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1', controllerEpoch: 3, ...overrides })
}

/** Open a temporary controller database carrying every schema the saga writes through. */
async function openSagaDatabase(clock) {
  return storage.openStore({
    path: join(tempDir(), 'controller.sqlite'),
    migrations: [
      ...storage.MYWORK_MIGRATIONS,
      ...evidence.EVIDENCE_MIGRATIONS,
      ...lease.LEASE_MIGRATIONS,
      ...execution.CLAIM_SAGA_MIGRATIONS,
    ],
    clock: { now: () => clock.now() },
  })
}

/**
 * A deterministic `TaskGraphPort` for the claim path.
 *
 * It records every call in order, so a test can prove that a step ran (or did
 * not) rather than inferring it from the outcome, and it injects failures at a
 * named call so fault injection after each §9 step is expressible.
 */
function fakeGraph(options = {}) {
  const tasks = new Map()
  const calls = []
  let claimAttempts = 0
  return {
    tasks,
    calls,
    /** How many times `claim` was entered, including calls that threw. */
    get claimAttempts() {
      return claimAttempts
    },
    addTask(id, state = 'ready', extra = {}) {
      tasks.set(id, { id, workspaceId: 'W-1', title: id, description: '', state, revision: 1, dependsOn: [], ...extra })
      return this
    },
    port: {
      capabilities: async () => ({ adapterId: 'fake', contractVersion: 'taskgraph/v1', capabilities: {}, source: 'declared' }),
      get: async id => {
        calls.push(`get:${id}`)
        if (options.onGet !== undefined) await options.onGet(id)
        const task = tasks.get(id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${id}"`)
        return Object.freeze({ ...task })
      },
      ready: async () => [...tasks.values()].filter(task => task.state === 'ready').map(task => ({ id: task.id, state: task.state })),
      blocked: async () => [],
      claim: async command => {
        claimAttempts += 1
        calls.push(`claim:${command.id}:${command.claimant}`)
        if (options.onClaim !== undefined) {
          const injected = await options.onClaim(command, claimAttempts)
          if (injected !== undefined) return injected
        }
        const task = tasks.get(command.id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${command.id}"`)
        // `bd update --claim` is idempotent for the same actor and refuses a
        // different one, which is exactly the semantics the saga depends on.
        if (task.assignee !== undefined && task.assignee !== command.claimant) {
          return Object.freeze({ won: false, holder: task.assignee })
        }
        task.assignee = command.claimant
        // The graph committed, but the answer was lost on the way back: §9's crash
        // window, and the case a reconciler has to resolve without guessing.
        if (options.loseClaimAnswerOnce === true && claimAttempts === 1) {
          throw new core.MyWorkError('ADAPTER_UNAVAILABLE', 'the claim landed but the answer was lost')
        }
        return Object.freeze({ won: true, task: Object.freeze({ ...task }) })
      },
      transition: async command => {
        calls.push(`transition:${command.id}->${command.to}`)
        if (options.onTransition !== undefined) await options.onTransition(command)
        const task = tasks.get(command.id)
        if (task === undefined) throw new core.MyWorkError('TASK_CONFLICT', `no task "${command.id}"`)
        if (!core.canTransitionTask(task.state, command.to)) {
          throw new core.MyWorkError('TASK_CONFLICT', `illegal transition ${task.state} → ${command.to}`)
        }
        task.state = command.to
        task.revision += 1
        return Object.freeze({ ...task })
      },
      dependencies: async () => [],
      mutatePlan: async () => ({ mode: 'atomic', created: {} }),
      doctor: async () => [],
    },
  }
}

/** A saga over a fresh store and a fresh fake graph. */
async function sagaFixture(options = {}) {
  const clock = new adapterTesting.FakeClock(options.start ?? 1_000)
  const store = await openSagaDatabase(clock)
  const graph = fakeGraph(options)
  graph.addTask('T-1', options.taskState ?? 'ready', options.taskExtra ?? {})
  const saga = execution.createClaimSaga({ store, graph: graph.port, clock })
  return { clock, store, graph, saga }
}

/** A claim command for the fixture. */
function claimCommand(overrides = {}) {
  return {
    taskId: 'T-1',
    workspaceId: 'W-1',
    claimant: 'worker-1',
    agentId: 'Neo-1',
    expectedRevision: 1,
    leaseMs: 5_000,
    meta: meta(),
    ...overrides,
  }
}

/** Unwrap a successful result. */
function unwrap(result) {
  assert.equal(result.ok, true, result.ok ? '' : `${result.error.code}: ${result.error.message}`)
  return result.value
}

/** The number of live attempts a task has, read straight from the database. */
function liveCount(store, taskId) {
  return store.transaction(tx =>
    Number(tx.get('SELECT COUNT(*) AS n FROM attempt WHERE task_id = ? AND settled_at IS NULL', taskId).n),
  )
}

/** The number of intents recorded, read straight from the database. */
function intentCount(store) {
  return store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM claim_intent').n))
}

// ---------------------------------------------------------------------------
// A. Fault injection after every §9 step (acceptance 1)
// ---------------------------------------------------------------------------

test('a fault after the graph claim leaves no attempt, and recovery creates exactly one', async () => {
  // The graph committed the claim and the answer was lost: §9's crash window
  // between step 2 and step 3.
  const { store, graph, saga } = await sagaFixture({ loseClaimAnswerOnce: true })
  try {
    const failed = await saga.claim(claimCommand())
    assert.equal(failed.ok, false)
    assert.equal(failed.error.code, 'ADAPTER_UNAVAILABLE')

    // §9 step 1 landed and step 2 landed in the graph, but MyWork recorded neither
    // the answer nor an attempt — which is exactly the state §9 says a reconciler
    // must be able to finish.
    assert.equal(intentCount(store), 1)
    assert.equal(liveCount(store, 'T-1'), 0)
    assert.equal(graph.tasks.get('T-1').assignee, 'worker-1', 'the graph did record the claim')
    assert.deepEqual(
      saga.stepsOf('op-1').map(step => `${step.kind}:${step.state}`),
      ['intent:applied', 'claim:failed', 'attempt:pending', 'projection:pending', 'complete:pending'],
    )
    assert.equal(saga.openIntents('W-1').length, 1, 'the unfinished saga must be visible to a reconciler')

    // Recovery reads the graph, sees that this claimant holds the task, and creates
    // the missing attempt — exactly once.
    const recovered = unwrap(await saga.recover({
      operationId: 'op-1',
      action: 'recover',
      decision: { decidedBy: 'operator', reason: 'the answer was lost', at: 2_000 },
    }))
    assert.equal(recovered.state, 'completed')
    assert.equal(recovered.reconciliation.action, 'create-attempt')
    assert.equal(liveCount(store, 'T-1'), 1)
    assert.equal(saga.openIntents('W-1').length, 0)
    // One attempt for the whole saga, however many times the path was entered.
    assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)), 1)
    // The recovered attempt is the one the claim was admitted for: §17's attempt
    // names the agent performing the work, and it comes from the recorded intent
    // rather than from a value invented at recovery time.
    const recoveredAttempt = saga.attemptOf('T-1')
    assert.equal(recoveredAttempt.agentId, 'Neo-1', 'recovery must not substitute a synthetic agent')
    assert.equal(recoveredAttempt.leaseExpiresAt, recoveredAttempt.createdAt + 5_000, 'the lease window comes from the caller')

    // And a further recovery changes nothing: the saga is settled.
    const again = unwrap(await saga.recover({
      operationId: 'op-1',
      action: 'recover',
      decision: { decidedBy: 'operator', at: 3_000 },
    }))
    assert.equal(again.state, 'completed')
    assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)), 1)
  } finally {
    store.close()
  }
})

test('a fault after the attempt was created does not create a second one on retry', async () => {
  // The board is unavailable for the projection only; the claim and the attempt
  // both landed before it.
  let transitions = 0
  const { store, saga, graph } = await sagaFixture({
    onTransition: async () => {
      transitions += 1
      if (transitions === 1) throw new core.MyWorkError('ADAPTER_UNAVAILABLE', 'the board is down')
    },
  })
  try {
    const partial = unwrap(await saga.claim(claimCommand()))
    // §49: an unavailable board degrades the projection, it does not stop execution.
    assert.equal(partial.state, 'attempted')
    assert.equal(partial.projectionDegraded, true)
    assert.equal(liveCount(store, 'T-1'), 1, 'the lease stays authoritative while the projection catches up')

    // A repeated claim must not create a second attempt: the saga is unfinished,
    // and finishing it is a decision, not a retry.
    const repeat = await saga.claim(claimCommand())
    assert.equal(repeat.ok, false)
    assert.equal(repeat.error.details.reason, 'claim-unfinished')
    assert.equal(liveCount(store, 'T-1'), 1)
    assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)), 1)

    // Recovery finishes the projection and completes the saga.
    const recovered = unwrap(await saga.recover({
      operationId: 'op-1',
      action: 'recover',
      decision: { decidedBy: 'operator', at: 2_000 },
    }))
    assert.equal(recovered.state, 'recovered')
    assert.equal(graph.tasks.get('T-1').state, 'assigned', 'recovery must finish the projection it owed')
  } finally {
    store.close()
  }
})

test('a fault before the graph claim leaves an intent that is abandoned, not revoked', async () => {
  const { store, saga } = await sagaFixture({
    onClaim: async () => Object.freeze({ won: false, holder: 'worker-2' }),
  })
  try {
    const lost = await saga.claim(claimCommand())
    assert.equal(lost.ok, false)
    assert.equal(lost.error.code, 'TASK_CONFLICT')
    assert.equal(lost.error.details.reason, 'claim-lost')
    assert.equal(lost.error.details.holder, 'worker-2')
    // Losing the race is an ordinary outcome, and nothing was created for it.
    assert.equal(liveCount(store, 'T-1'), 0)
    assert.equal(store.transaction(tx => tx.get('SELECT state FROM claim_intent WHERE operation_id = ?', 'op-1').state), 'abandoned')
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// B. No double execution (acceptance 1)
// ---------------------------------------------------------------------------

test('two claims for one task produce one live attempt, and the loser is told who holds it', async () => {
  const { store, saga } = await sagaFixture()
  try {
    const first = unwrap(await saga.claim(claimCommand()))
    assert.equal(first.state, 'completed')

    const second = await saga.claim(claimCommand({
      claimant: 'worker-2',
      meta: meta({ operationId: 'op-2' }),
    }))
    assert.equal(second.ok, false)
    assert.equal(second.error.details.reason, 'claim-lost')
    assert.equal(second.error.details.holder, 'worker-1')
    assert.equal(liveCount(store, 'T-1'), 1, 'a task may never hold two authoritative leases')
    assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)), 1)
  } finally {
    store.close()
  }
})

test('a repeated claim with the same operation id is idempotent and creates nothing new', async () => {
  const { store, saga } = await sagaFixture()
  try {
    const first = unwrap(await saga.claim(claimCommand()))
    const second = unwrap(await saga.claim(claimCommand()))
    assert.deepEqual(second, first, 'a repeat must answer with the recorded outcome')
    assert.equal(intentCount(store), 1)
    assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)), 1)
    // One outbox event per settled fact, not one per call.
    const events = store.transaction(tx => tx.all('SELECT type FROM outbox ORDER BY sequence').map(row => row.type))
    assert.deepEqual(events, ['claim.intent.recorded', 'attempt.lease.granted', 'claim.completed'])
  } finally {
    store.close()
  }
})

test('an operation id reused for a different claim is refused, not answered with the first outcome', async () => {
  const { store, saga } = await sagaFixture()
  try {
    unwrap(await saga.claim(claimCommand()))
    const reused = await saga.claim(claimCommand({ claimant: 'worker-9' }))
    assert.equal(reused.ok, false)
    assert.equal(reused.error.details.reason, 'operation-id-reused')
    assert.equal(liveCount(store, 'T-1'), 1)
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// C. Late result of a superseded attempt (acceptance 2)
// ---------------------------------------------------------------------------

test('a late result from a superseded attempt is rejected with STALE_FENCE', async () => {
  const { store, saga, clock, graph } = await sagaFixture()
  try {
    const first = unwrap(await saga.claim(claimCommand()))
    assert.equal(first.fence, 1)

    // The task is reassigned. Operationally that means the first worker stopped
    // holding it — the graph released it back to `ready` — and only then did a
    // second saga win the claim. Modelling it the other way round (a claim against
    // a task the graph still shows as held) is exactly the race the graph's own
    // compare-and-set refuses.
    const task = graph.tasks.get('T-1')
    task.state = 'ready'
    task.assignee = undefined
    clock.advance(3_000)
    const second = unwrap(await saga.claim(claimCommand({
      claimant: 'worker-2',
      meta: meta({ operationId: 'op-2' }),
      expectedRevision: task.revision,
    })))
    assert.equal(second.fence, 2, 'every new attempt on a task gets a higher fence')
    assert.equal(liveCount(store, 'T-1'), 1, 'the superseded attempt must not keep its lease')
    assert.equal(
      store.transaction(tx => tx.get('SELECT state FROM attempt WHERE attempt_id = ?', first.attemptId).state),
      'stale',
      'the superseded attempt is moved to the terminal stale state',
    )

    // A1 comes back late, still holding fence 1.
    const late = await saga.settle({
      authority: {
        attemptId: first.attemptId,
        expectedRevision: 1,
        controllerEpoch: 3,
        expectedFence: 1,
        at: 4_000,
      },
      to: 'completed',
      meta: meta({ operationId: 'op-1-settle' }),
    })
    assert.equal(late.ok, false)
    assert.equal(late.error.code, 'STALE_FENCE', 'a late result of a superseded attempt must be rejected')
    assert.equal(late.error.details.actual, 2)

    // And the rejection changed nothing.
    assert.equal(saga.attemptOf('T-1').id, second.attemptId)
    assert.equal(saga.attemptOf('T-1').state, 'leased')
  } finally {
    store.close()
  }
})

test('a settlement with the right fence but a stale revision is STALE_REVISION', async () => {
  const { store, saga, clock } = await sagaFixture()
  try {
    const claimed = unwrap(await saga.claim(claimCommand()))
    clock.advance(2_000)
    const stale = await saga.settle({
      authority: { attemptId: claimed.attemptId, expectedRevision: 99, controllerEpoch: 3, expectedFence: claimed.fence, at: 2_000 },
      to: 'completed',
      meta: meta({ operationId: 'op-1-settle' }),
    })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, 'STALE_REVISION')
    assert.equal(saga.attemptOf('T-1').state, 'leased', 'a refused settlement must not settle anything')
  } finally {
    store.close()
  }
})

test('a settlement from a superseded controller epoch is LEASE_LOST', async () => {
  const { store, saga, clock } = await sagaFixture()
  try {
    const claimed = unwrap(await saga.claim(claimCommand()))
    clock.advance(2_000)
    const lost = await saga.settle({
      authority: { attemptId: claimed.attemptId, expectedRevision: 1, controllerEpoch: 2, expectedFence: claimed.fence, at: 2_000 },
      to: 'completed',
      meta: meta({ operationId: 'op-1-settle', controllerEpoch: 2 }),
    })
    assert.equal(lost.ok, false)
    assert.equal(lost.error.code, 'LEASE_LOST')
  } finally {
    store.close()
  }
})

test('a settlement by the rightful holder settles once and is idempotent', async () => {
  const { store, saga, clock } = await sagaFixture()
  try {
    const claimed = unwrap(await saga.claim(claimCommand()))
    assert.equal(claimed.state, 'completed')
    clock.advance(2_000)
    const settled = unwrap(await saga.settle({
      authority: { attemptId: claimed.attemptId, expectedRevision: 1, controllerEpoch: 3, expectedFence: claimed.fence, at: 2_000 },
      to: 'completed',
      meta: meta({ operationId: 'op-1-settle' }),
    }))
    // The saga had already completed; settling its attempt does not un-complete it.
    assert.equal(settled.state, 'completed')
    assert.equal(liveCount(store, 'T-1'), 0, 'a settled attempt releases the task lease slot')

    const repeat = unwrap(await saga.settle({
      authority: { attemptId: claimed.attemptId, expectedRevision: 1, controllerEpoch: 3, expectedFence: claimed.fence, at: 2_500 },
      to: 'completed',
      meta: meta({ operationId: 'op-1-settle-2' }),
    }))
    assert.equal(repeat.state, 'completed')
    assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)), 1)
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// D. At most one authoritative lease per task (acceptance 3)
// ---------------------------------------------------------------------------

test('the database itself refuses a second live lease on one task', async () => {
  const { store, saga } = await sagaFixture()
  try {
    unwrap(await saga.claim(claimCommand()))
    const live = saga.attemptOf('T-1')
    // Straight at the store, bypassing the service entirely: the invariant has to
    // hold where a bug in the service cannot reach it.
    let refused = false
    try {
      store.transaction(tx => execution.insertAttempt(tx, { ...live, id: 'attempt-forged', operationId: 'op-forged' }))
    } catch (error) {
      refused = true
      assert.equal(error.code, 'conflict')
      assert.equal(error.details.reason, 'task-already-leased')
    }
    assert.equal(refused, true, 'a partial unique index, not the service, must hold this')
    assert.equal(liveCount(store, 'T-1'), 1)

    // The index is real, not merely declared.
    const index = store.transaction(tx =>
      tx.get("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'attempt_task_live_lease'").sql,
    )
    assert.match(String(index), /WHERE settled_at IS NULL/)
  } finally {
    store.close()
  }
})

test('the fence allocator is monotonic and the database refuses to lower it', async () => {
  const { store } = await sagaFixture()
  try {
    assert.equal(store.transaction(tx => execution.readFence(tx, 'T-1')), 0, 'no attempt yet means fence 0')
    assert.equal(store.transaction(tx => execution.allocateFence(tx, 'T-1', 1_000)), 1)
    assert.equal(store.transaction(tx => execution.allocateFence(tx, 'T-1', 1_100)), 2)
    let refused = false
    try {
      store.transaction(tx => tx.run('UPDATE task_fence SET fence = 1 WHERE task_id = ?', 'T-1'))
    } catch (error) {
      refused = true
      assert.match(String(error.message), /fence-not-monotonic/)
    }
    assert.equal(refused, true, 'a superseded fence token must never be reachable again')
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// E. recover and revoke for an unfinished saga (§9, §49)
// ---------------------------------------------------------------------------

test('recovery does not resolve a saga on absent evidence', async () => {
  const { store, saga } = await sagaFixture({
    onClaim: async () => {
      throw new core.MyWorkError('ADAPTER_UNAVAILABLE', 'graph unreachable')
    },
  })
  try {
    await saga.claim(claimCommand())
    assert.equal(saga.openIntents('W-1').length, 1)

    // The graph cannot be read at all now: §49 forbids revoking a live attempt on
    // a read that failed, so the intent must stay open.
    const { saga: blindSaga } = await (async () => {
      const clock = new adapterTesting.FakeClock(2_000)
      const blindStore = store
      const blindGraph = fakeGraph({ onGet: async () => { throw new core.MyWorkError('ADAPTER_UNAVAILABLE', 'down') } })
      blindGraph.addTask('T-1')
      return { saga: execution.createClaimSaga({ store: blindStore, graph: blindGraph.port, clock }) }
    })()
    const result = await blindSaga.recover({
      operationId: 'op-1',
      action: 'recover',
      decision: { decidedBy: 'operator', at: 2_000 },
    })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'ADAPTER_UNAVAILABLE')
    assert.equal(
      store.transaction(tx => tx.get('SELECT state FROM claim_intent WHERE operation_id = ?', 'op-1').state),
      'recovering',
      'an unreadable graph must leave the saga open, not resolve it',
    )
  } finally {
    store.close()
  }
})

test('recovery revokes an attempt whose claim moved to another worker', async () => {
  const { store, saga, graph } = await sagaFixture({
    onTransition: async () => {
      throw new core.MyWorkError('ADAPTER_UNAVAILABLE', 'board down')
    },
  })
  try {
    // The saga stops at `attempted` with a live lease, and then the claim moves on
    // in the graph — the case §49 calls "attempt exists, agent does not".
    const partial = unwrap(await saga.claim(claimCommand()))
    assert.equal(partial.state, 'attempted')
    graph.tasks.get('T-1').assignee = 'worker-7'

    const recovered = unwrap(await saga.recover({
      operationId: 'op-1',
      action: 'recover',
      decision: { decidedBy: 'operator', reason: 'the claim moved on', at: 3_000 },
    }))
    assert.equal(recovered.state, 'revoked')
    assert.equal(recovered.reconciliation.action, 'revoke-claim')
    assert.equal(liveCount(store, 'T-1'), 0, 'a revoked attempt must not keep its lease')
    assert.equal(store.transaction(tx => tx.get('SELECT state FROM attempt WHERE attempt_id = ?', partial.attemptId).state), 'revoked')
  } finally {
    store.close()
  }
})

test('recovery abandons an intent whose claim never took effect', async () => {
  const { store, saga, graph } = await sagaFixture({
    onClaim: async () => {
      throw new core.MyWorkError('ADAPTER_UNAVAILABLE', 'graph unreachable')
    },
  })
  try {
    await saga.claim(claimCommand())
    // The graph is readable again and nobody holds the task: the claim never took
    // effect, so there is nothing to revoke.
    graph.tasks.get('T-1').assignee = undefined
    const recovered = unwrap(await saga.recover({
      operationId: 'op-1',
      action: 'recover',
      decision: { decidedBy: 'operator', at: 3_000 },
    }))
    assert.equal(recovered.state, 'abandoned')
    assert.equal(recovered.reconciliation.action, 'abandon-intent')
    assert.equal(liveCount(store, 'T-1'), 0)
  } finally {
    store.close()
  }
})

test('a crash between the projection and the completion is recoverable, not stuck', async () => {
  // §9 step 4 and step 5 are two commits, so a process that dies between them
  // leaves the task `assigned` with the saga still at `attempted`. Recovery must
  // finish it — and it must not re-issue `assigned → assigned`, which is not an
  // edge in the transition table and is refused by the real adapter too. This
  // window was found by a probe, not by the suite, which is why the test exists.
  const { store, saga, graph, clock } = await sagaFixture()
  try {
    const claimed = unwrap(await saga.claim(claimCommand()))
    assert.equal(claimed.state, 'completed')
    assert.equal(graph.tasks.get('T-1').state, 'assigned')

    // Put the saga back exactly where the interrupted commit would have left it:
    // the projection landed, the completion did not.
    store.transaction(tx => tx.run('UPDATE claim_intent SET state = ? WHERE operation_id = ?', 'attempted', 'op-1'))
    clock.advance(2_000)

    const recovered = unwrap(await saga.recover({
      operationId: 'op-1',
      action: 'recover',
      decision: { decidedBy: 'operator', reason: 'crash between projection and completion', at: 3_000 },
    }))
    assert.equal(recovered.state, 'recovered', 'the window §9 names must not be permanently stuck')
    assert.equal(recovered.reconciliation.action, 'complete')
    assert.equal(graph.tasks.get('T-1').state, 'assigned')
    assert.equal(liveCount(store, 'T-1'), 1, 'the attempt it created is still the authoritative one')
    assert.deepEqual(
      saga.stepsOf('op-1').map(step => `${step.kind}:${step.state}`),
      ['intent:applied', 'claim:applied', 'attempt:applied', 'projection:applied', 'complete:applied'],
    )
  } finally {
    store.close()
  }
})

test('recovery never revokes another saga\'s live lease', async () => {
  // A task has at most one live attempt, but that attempt may belong to a NEWER
  // saga that legitimately took the task over. §49's "attempt exists, agent does
  // not" is about the agent *this* saga started: reading the live attempt by task
  // instead of by saga would make an old saga's recovery revoke a healthy worker's
  // lease — the exact mistake the revocation path must not make.
  let boardDown = true
  const { store, saga, graph, clock } = await sagaFixture({
    onTransition: async () => {
      if (boardDown) throw new core.MyWorkError('ADAPTER_UNAVAILABLE', 'board down')
    },
  })
  try {
    // S1 claims, but the board is down so it stops at `attempted` with a live lease.
    const s1 = unwrap(await saga.claim(claimCommand()))
    assert.equal(s1.state, 'attempted')
    const s1Attempt = saga.attemptOf('T-1').id

    // The task is released and S2 legitimately claims it; the board is back, so S2
    // completes and holds the only live lease.
    const task = graph.tasks.get('T-1')
    task.assignee = undefined
    task.state = 'ready'
    boardDown = false
    clock.advance(1_000)
    const s2 = unwrap(await saga.claim(claimCommand({
      claimant: 'worker-2',
      meta: meta({ operationId: 'op-2' }),
      expectedRevision: task.revision,
    })))
    assert.equal(s2.state, 'completed')
    assert.equal(saga.attemptOf('T-1').id, s2.attemptId, 'S2 holds the live lease')
    assert.equal(
      store.transaction(tx => tx.get('SELECT state FROM attempt WHERE attempt_id = ?', s1Attempt).state),
      'stale',
      'S1 was superseded, and that is a decision the graph made',
    )

    // S1 recovers. The graph holds worker-2, so S1 must NOT touch S2's lease.
    clock.advance(1_000)
    const recovered = unwrap(await saga.recover({
      operationId: 'op-1',
      action: 'recover',
      decision: { decidedBy: 'reconciler', reason: 'old saga is superseded', at: 4_000 },
    }))
    assert.equal(recovered.state, 'abandoned', 'a superseded saga closes its own intent')
    assert.equal(recovered.attemptId, undefined, 'and names no attempt it does not own')

    // The whole point: S2's lease is intact and still the authoritative one.
    assert.equal(saga.attemptOf('T-1').id, s2.attemptId, "another saga's live lease must survive")
    assert.equal(saga.attemptOf('T-1').state, 'leased')
    assert.equal(liveCount(store, 'T-1'), 1)
    assert.equal(
      store.transaction(tx => tx.get('SELECT state FROM attempt WHERE attempt_id = ?', s2.attemptId).state),
      'leased',
    )
    // And S2 can still settle its own attempt.
    const settled = unwrap(await saga.settle({
      authority: { attemptId: s2.attemptId, expectedRevision: 1, controllerEpoch: 3, expectedFence: s2.fence, at: 5_000 },
      to: 'completed',
      meta: meta({ operationId: 'op-2-settle' }),
    }))
    assert.equal(settled.state, 'completed')
  } finally {
    store.close()
  }
})

test('the projection is recorded as its own state, so the step-5 window is observable', async () => {
  // §9 step 4 and step 5 are separate commits, so the saga passes through a state
  // that means "the task is assigned, the completion is still owed". Without it the
  // window is invisible in the database and recovery has to infer it from the graph.
  const { store, saga } = await sagaFixture()
  try {
    unwrap(await saga.claim(claimCommand()))
    // The saga reached `completed`; the step journal proves `projected` was on the
    // path rather than skipped, and the state is a real one the CHECK accepts.
    assert.deepEqual(
      saga.stepsOf('op-1').map(step => `${step.kind}:${step.state}`),
      ['intent:applied', 'claim:applied', 'attempt:applied', 'projection:applied', 'complete:applied'],
    )
    const allowed = store.transaction(tx =>
      String(tx.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'claim_intent'").sql),
    )
    assert.match(allowed, /'projected'/, 'the state must be one the table accepts')
  } finally {
    store.close()
  }
})

test('recovery finishes a saga left in projected, and one left in recovering', async () => {
  const { store, saga, clock } = await sagaFixture()
  try {
    unwrap(await saga.claim(claimCommand()))
    for (const state of ['projected', 'recovering']) {
      store.transaction(tx => tx.run('UPDATE claim_intent SET state = ? WHERE operation_id = ?', state, 'op-1'))
      clock.advance(1_000)
      const recovered = unwrap(await saga.recover({
        operationId: 'op-1',
        action: 'recover',
        decision: { decidedBy: 'reconciler', at: clock.now() },
      }))
      assert.equal(recovered.state, 'recovered', `a saga in "${state}" must be finishable, not a dead end`)
      assert.equal(saga.openIntents('W-1').length, 0, 'and it must stop being open')
      // Put it back for the next round.
      store.transaction(tx => tx.run('UPDATE claim_intent SET state = ? WHERE operation_id = ?', 'completed', 'op-1'))
    }
  } finally {
    store.close()
  }
})

test('a claim for a task the graph already shows as assigned does not degrade the projection', async () => {
  // A previous attempt on this task settled without moving the task back, so the
  // graph still shows it `assigned` — and re-claiming it as the same worker is
  // idempotent on the backend (`bd --claim` is). Step 4 must observe that the task
  // is already where it wanted it rather than issuing `assigned → assigned`, which
  // is not an edge in the transition table and is refused by the real adapter too.
  // Without the observation the claim would report a degraded projection on a
  // perfectly healthy path, and recovery would inherit the same refusal.
  const { store, saga, graph } = await sagaFixture({ taskState: 'assigned', taskExtra: { assignee: 'worker-1' } })
  try {
    const claimed = unwrap(await saga.claim(claimCommand()))
    assert.equal(claimed.state, 'completed', 'the claim must finish, not stop short')
    assert.equal(claimed.projectionDegraded, undefined, 'an already-assigned task is not a degraded projection')
    assert.equal(graph.tasks.get('T-1').state, 'assigned')
    assert.equal(liveCount(store, 'T-1'), 1, 'and the attempt it created is authoritative')
    assert.deepEqual(
      saga.stepsOf('op-1').map(step => `${step.kind}:${step.state}`),
      ['intent:applied', 'claim:applied', 'attempt:applied', 'projection:applied', 'complete:applied'],
    )
  } finally {
    store.close()
  }
})

test('an explicit revoke never reaches another saga\'s live lease', async () => {
  // The same distinction `recover` has to make: a revoke names an operation, and an
  // attempt that a newer saga legitimately holds is not that operation's to take.
  let boardDown = true
  const { store, saga, graph, clock } = await sagaFixture({
    onTransition: async () => {
      if (boardDown) throw new core.MyWorkError('ADAPTER_UNAVAILABLE', 'board down')
    },
  })
  try {
    const s1 = unwrap(await saga.claim(claimCommand()))
    assert.equal(s1.state, 'attempted')
    const task = graph.tasks.get('T-1')
    task.assignee = undefined
    task.state = 'ready'
    boardDown = false
    clock.advance(1_000)
    const s2 = unwrap(await saga.claim(claimCommand({
      claimant: 'worker-2',
      meta: meta({ operationId: 'op-2' }),
      expectedRevision: task.revision,
    })))

    // Revoking the superseded S1 must not touch S2's lease.
    clock.advance(1_000)
    const revoked = unwrap(await saga.revoke({
      operationId: 'op-1',
      action: 'revoke',
      decision: { decidedBy: 'operator', reason: 'old operation is done', at: 5_000 },
    }))
    assert.equal(revoked.state, 'revoked')
    assert.equal(revoked.attemptId, undefined, 'it names no attempt it does not own')
    assert.equal(saga.attemptOf('T-1').id, s2.attemptId, "another saga's live lease must survive")
    assert.equal(saga.attemptOf('T-1').state, 'leased')
    assert.equal(liveCount(store, 'T-1'), 1)
  } finally {
    store.close()
  }
})

test('an explicit revoke stops a live attempt and is idempotent', async () => {
  // The board was unavailable, so the saga stopped at `attempted` with a live
  // lease — the state an operator revokes from.
  const { store, saga } = await sagaFixture({
    onTransition: async () => {
      throw new core.MyWorkError('ADAPTER_UNAVAILABLE', 'board down')
    },
  })
  try {
    const claimed = unwrap(await saga.claim(claimCommand()))
    assert.equal(claimed.state, 'attempted')
    const revoked = unwrap(await saga.revoke({
      operationId: 'op-1',
      action: 'revoke',
      decision: { decidedBy: 'operator', reason: 'the worker is gone', at: 4_000 },
    }))
    assert.equal(revoked.state, 'revoked')
    assert.equal(liveCount(store, 'T-1'), 0)
    assert.equal(store.transaction(tx => tx.get('SELECT state FROM attempt WHERE attempt_id = ?', claimed.attemptId).state), 'revoked')

    const again = unwrap(await saga.revoke({
      operationId: 'op-1',
      action: 'revoke',
      decision: { decidedBy: 'operator', at: 4_500 },
    }))
    assert.equal(again.state, 'revoked')
  } finally {
    store.close()
  }
})

test('a settlement after revocation is refused: the lease is gone', async () => {
  const { store, saga } = await sagaFixture({
    onTransition: async () => {
      throw new core.MyWorkError('ADAPTER_UNAVAILABLE', 'board down')
    },
  })
  try {
    const claimed = unwrap(await saga.claim(claimCommand()))
    unwrap(await saga.revoke({
      operationId: 'op-1',
      action: 'revoke',
      decision: { decidedBy: 'operator', at: 4_000 },
    }))
    const late = await saga.settle({
      authority: { attemptId: claimed.attemptId, expectedRevision: 1, controllerEpoch: 3, expectedFence: claimed.fence, at: 5_000 },
      to: 'completed',
      meta: meta({ operationId: 'op-1-late' }),
    })
    assert.equal(late.ok, false)
    assert.equal(late.error.details.reason, 'attempt-already-settled')
  } finally {
    store.close()
  }
})

test('a completed saga cannot be revoked: the work is finished', async () => {
  const { store, saga } = await sagaFixture()
  try {
    unwrap(await saga.claim(claimCommand()))
    const refused = await saga.revoke({
      operationId: 'op-1',
      action: 'revoke',
      decision: { decidedBy: 'operator', at: 4_000 },
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.details.reason, 'claim-settled')
    assert.equal(store.transaction(tx => tx.get('SELECT state FROM claim_intent WHERE operation_id = ?', 'op-1').state), 'completed')
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// F. The §9 step journal and the events it produces
// ---------------------------------------------------------------------------

test('the five §9 steps are journalled in order and all applied on success', async () => {
  const { store, saga } = await sagaFixture()
  try {
    unwrap(await saga.claim(claimCommand()))
    assert.deepEqual(
      saga.stepsOf('op-1').map(step => `${step.seq}:${step.kind}:${step.state}`),
      ['1:intent:applied', '2:claim:applied', '3:attempt:applied', '4:projection:applied', '5:complete:applied'],
    )
  } finally {
    store.close()
  }
})

test('a claim carries its operation id through every event it emits', async () => {
  const { store, saga } = await sagaFixture()
  try {
    unwrap(await saga.claim(claimCommand()))
    const events = store.transaction(tx => tx.all('SELECT type, payload FROM outbox ORDER BY sequence'))
    assert.deepEqual(events.map(row => row.type), ['claim.intent.recorded', 'attempt.lease.granted', 'claim.completed'])
    for (const row of events) {
      assert.equal(JSON.parse(String(row.payload)).operationId, 'op-1', `every event must carry the operation id (${row.type})`)
    }
  } finally {
    store.close()
  }
})

test('a completed claim writes its audit rows, and they name the attempt', async () => {
  const { store, saga } = await sagaFixture()
  try {
    const claimed = unwrap(await saga.claim(claimCommand()))
    const rows = store.transaction(tx => tx.all('SELECT type, attempt_id, task_id FROM audit_events ORDER BY position'))
    assert.deepEqual(rows.map(row => row.type), ['claim.recorded', 'attempt.assigned', 'claim.recorded'])
    assert.equal(rows[1].attempt_id, claimed.attemptId)
    assert.equal(rows[1].task_id, 'T-1')
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// G. Malformed input is a programming error, not a store write
// ---------------------------------------------------------------------------

test('a malformed claim is refused before anything is written', async () => {
  const { store, saga } = await sagaFixture()
  try {
    for (const bad of [
      claimCommand({ taskId: '' }),
      claimCommand({ claimant: '' }),
      claimCommand({ agentId: '' }),
      claimCommand({ expectedRevision: -1 }),
      claimCommand({ leaseMs: 0 }),
    ]) {
      await assert.rejects(() => saga.claim(bad), error => error.name === 'ExecutionError' && error.code === 'invalid-input')
    }
    assert.equal(intentCount(store), 0, 'a malformed request must not reach the store')
  } finally {
    store.close()
  }
})

test('a claim against a store without the claim schema fails where it was wired', async () => {
  const clock = new adapterTesting.FakeClock(1_000)
  const store = await storage.openStore({
    path: join(tempDir(), 'controller.sqlite'),
    migrations: [...storage.MYWORK_MIGRATIONS, ...evidence.EVIDENCE_MIGRATIONS, ...lease.LEASE_MIGRATIONS],
    clock: { now: () => clock.now() },
  })
  try {
    const graph = fakeGraph()
    graph.addTask('T-1')
    assert.throws(
      () => execution.createClaimSaga({ store, graph: graph.port, clock }),
      error => error.name === 'ExecutionError' && error.code === 'schema-missing',
    )
  } finally {
    store.close()
  }
})

test('a recovery decision without a clock reading is refused as a programming error', async () => {
  const { store, saga } = await sagaFixture()
  try {
    await assert.rejects(
      () => saga.recover({ operationId: 'op-1', action: 'recover', decision: { decidedBy: 'operator', at: -1 } }),
      error => error.name === 'ExecutionError' && error.code === 'invalid-input',
    )
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// H. A real process death between the §9 steps (acceptance 1, durability)
// ---------------------------------------------------------------------------

/** Run the crash child against one database and read its last JSON report. */
function runClaimChild(databasePath, mode, logDir) {
  const captured = runCaptured(
    process.execPath,
    [join(repoRoot, 'tests', 'lib', 'claim-crash-child.mjs'), databasePath, mode],
    { cwd: repoRoot, env: process.env, logDir, logName: `claim-${mode}` },
  )
  const lines = captured.stdout.trim().split('\n').filter(line => line.startsWith('{'))
  assert.ok(lines.length > 0, `the child produced no report: ${captured.stdout}${captured.stderr}`)
  return { captured, report: JSON.parse(lines[lines.length - 1]) }
}

test('a process killed between the intent and the graph claim leaves an intent and no attempt', async () => {
  const dir = tempDir()
  const path = join(dir, 'controller.sqlite')

  // Control run first: the same code path, allowed to finish, proves the
  // difference the crash makes is the crash and not the setup.
  const control = runClaimChild(path, 'commit', dir)
  assert.equal(control.captured.status, 0, `child stderr: ${control.captured.stderr}`)
  assert.equal(control.report.phase, 'committed')
  assert.equal(control.report.ok, true)
  assert.equal(control.report.state, 'completed')
  assert.equal(control.report.schema, control.report.expectedSchema)

  // Now the same saga against a fresh database, killed before the graph is touched.
  const crashDir = tempDir()
  const crashPath = join(crashDir, 'controller.sqlite')
  const crashed = runClaimChild(crashPath, 'after-intent', crashDir)
  assert.equal(crashed.captured.status, 7, `child stderr: ${crashed.captured.stderr}`)
  assert.equal(crashed.report.phase, 'before-claim')

  const store = await storage.openStore({
    path: crashPath,
    migrations: [
      ...storage.MYWORK_MIGRATIONS,
      ...evidence.EVIDENCE_MIGRATIONS,
      ...lease.LEASE_MIGRATIONS,
      ...execution.CLAIM_SAGA_MIGRATIONS,
    ],
  })
  try {
    // §9 step 1 is durable across the death; step 3 never ran.
    assert.equal(store.schemaVersion, execution.CLAIM_SAGA_SCHEMA_VERSION)
    assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM claim_intent').n)), 1)
    assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)), 0)
    assert.equal(
      store.transaction(tx => tx.get('SELECT state FROM claim_intent WHERE operation_id = ?', 'op-crash').state),
      'recorded',
      'the intent is the state the crash left, and nothing invented progress',
    )
    assert.equal(store.transaction(tx => tx.get('PRAGMA integrity_check').integrity_check), 'ok')
  } finally {
    store.close()
  }
})

test('a process killed after the graph claim is recoverable without a second execution', async () => {
  const dir = tempDir()
  const path = join(dir, 'controller.sqlite')
  const crashed = runClaimChild(path, 'after-claim', dir)
  assert.equal(crashed.captured.status, 7, `child stderr: ${crashed.captured.stderr}`)
  assert.equal(crashed.report.phase, 'claim-landed')

  const clock = new adapterTesting.FakeClock(2_000)
  const store = await storage.openStore({
    path,
    migrations: [
      ...storage.MYWORK_MIGRATIONS,
      ...evidence.EVIDENCE_MIGRATIONS,
      ...lease.LEASE_MIGRATIONS,
      ...execution.CLAIM_SAGA_MIGRATIONS,
    ],
    clock: { now: () => clock.now() },
  })
  try {
    // MyWork has the intent and no attempt; the graph holds the claim. This is
    // §9's crash-recovery row, and only a reconciler that reads the graph can
    // tell it from a claim that never landed.
    assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)), 0)

    const graph = fakeGraph()
    graph.addTask('T-1', 'ready', { assignee: 'worker-crash' })
    const saga = execution.createClaimSaga({ store, graph: graph.port, clock })
    assert.equal(saga.openIntents('W-1').length, 1)

    const recovered = unwrap(await saga.recover({
      operationId: 'op-crash',
      action: 'recover',
      decision: { decidedBy: 'reconciler', reason: 'the process died mid-claim', at: 2_000 },
    }))
    assert.equal(recovered.state, 'completed')
    assert.equal(recovered.reconciliation.action, 'create-attempt')
    assert.equal(liveCount(store, 'T-1'), 1, 'exactly one attempt after recovery')
    assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)), 1)
    assert.equal(saga.openIntents('W-1').length, 0)

    // A second recovery is a no-op: the saga is settled and no second attempt
    // appears, which is the whole point of the exercise.
    unwrap(await saga.recover({
      operationId: 'op-crash',
      action: 'recover',
      decision: { decidedBy: 'reconciler', at: 3_000 },
    }))
    assert.equal(store.transaction(tx => Number(tx.get('SELECT COUNT(*) AS n FROM attempt').n)), 1)
  } finally {
    store.close()
  }
})
