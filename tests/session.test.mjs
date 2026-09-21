/**
 * Session checkpoint, rollover, and context pressure acceptance
 * (architecture §21.2, §21.6, §22.2, §22.3, §22.4, §22.5, §32, §35;
 * §62 items 17, 22, 23).
 *
 * The card's four acceptance properties are checked here as behaviour rather
 * than as a claim, against literal windows and literal stores so every branch is
 * decided by data:
 *
 * 1. a rollover preserves the attempt and the anchors, and only the window
 *    changes;
 * 2. a retry or a rejection creates a new attempt *and* a new session;
 * 3. the whole transcript is never carried, only the capsule and the findings;
 * 4. a checkpoint that could not be stored loses no evidence and reports no
 *    completion.
 *
 * Each property also has a mutation behind it in the card's report
 * (`.work/reports/MW-020-sessions.md`, §4.2) and in `.tmp/mw020-mutations.mjs`:
 * the test is shown failing when the code that enforces it is broken, because a
 * test that cannot fail is a defect rather than a test.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { contracts, core } from './lib/fixtures.mjs'

/** Capacity of the route the windows below run on. */
const WINDOW = 100_000

/** Reserves every window holds back. */
const WORKING = 10_000
const SAFETY = 10_000

/** The conversation budget: 80 000 tokens. */
const AVAILABLE = WINDOW - WORKING - SAFETY

/** A clock reading. Required, never defaulted: a decision against an invented clock is another decision. */
const NOW = 1_000

/** The attempt the fixtures work in. */
const ATTEMPT = 'attempt-1'

/** A subject for the attempt the window serves. */
function subject(overrides = {}) {
  return { purpose: 'attempt', workspaceId: 'ws-1', taskId: 'task-1', attemptId: ATTEMPT, ...overrides }
}

/** A window with the defaults a test usually wants. */
function window(overrides = {}) {
  return core.createSessionWindow({
    sessionId: 'session-1',
    subject: subject(),
    openedAt: NOW,
    workingReserve: WORKING,
    safetyReserve: SAFETY,
    contextWindow: WINDOW,
    frozenRevisions: 42,
    ...overrides,
  })
}

/** A resident item with the defaults a test usually wants. */
function item(overrides = {}) {
  return { uri: 'turn-1', tokens: 1_000, live: false, ...overrides }
}

/** A checkpoint input with the defaults a test usually wants. */
function checkpoint(overrides = {}) {
  return {
    taskId: 'task-1',
    workspaceId: 'ws-1',
    attemptId: ATTEMPT,
    createdAt: NOW,
    git: { baseSha: 'aaa111', headSha: 'bbb222' },
    anchors: [{ kind: 'path', ref: 'packages/core/src/session.ts', line: 88 }],
    ...overrides,
  }
}

/** A store that accepts every capsule. */
function acceptingStore() {
  const written = []
  return {
    written,
    async put(capsule) {
      written.push(capsule)
      return { ok: true, capsule: { ...capsule, ref: { artifactId: `art-${written.length}`, hash: 'h' } }, created: true }
    },
  }
}

/** A store whose backend is down. */
function brokenStore(message = 'connection refused') {
  return {
    async put() {
      throw new Error(message)
    },
  }
}

/** A session owner that mints one session per call. */
function sessionOwner() {
  const created = []
  return {
    created,
    async createSession(forSubject) {
      created.push(forSubject)
      return { sessionId: `session-${created.length + 1}` }
    },
  }
}

/** A rollover input with the defaults a test usually wants. */
function rolloverInput(overrides = {}) {
  return {
    window: window(),
    decision: { ok: true, pressure: core.readContextPressure(window()), action: 'rollover' },
    capsule: { ...core.buildCheckpointCapsule(window(), checkpoint()), ref: { artifactId: 'art-1', hash: 'h' } },
    at: NOW + 500,
    createSession: sessionOwner().createSession,
    ...overrides,
  }
}

test('§22.2: a window opens with its reserves held back and its attempt named', () => {
  const opened = window()
  assert.equal(opened.ordinal, 1, 'the first window of an attempt is ordinal 1')
  assert.equal(opened.subject.attemptId, ATTEMPT)
  assert.equal(opened.contextWindow, WINDOW)
  assert.equal(opened.tokens, 0)
  assert.ok(Object.isFrozen(opened), 'a window is immutable')
})

test('§22.2: a window whose reserves leave no room is refused, not admitted full', () => {
  assert.throws(
    () => window({ workingReserve: 60_000, safetyReserve: 40_000 }),
    /leave no room inside context window/,
    'reserves that consume the whole capacity are a construction error',
  )
})

test('§22.2: a review window serves an attempt, and a planning window does not', () => {
  assert.throws(() => window({ subject: subject({ purpose: 'review', attemptId: undefined }) }), /must name the attempt/)
  assert.throws(() => window({ subject: subject({ purpose: 'planning' }) }), /serves no attempt/)
  const planning = window({ subject: subject({ purpose: 'planning', attemptId: undefined }) })
  assert.equal(planning.subject.attemptId, undefined)
})

test('§21.6: the pressure reading holds the reserves out of the conversation budget', () => {
  const pressure = core.readContextPressure(window({ tokens: 40_000 }))
  assert.equal(pressure.available, AVAILABLE)
  assert.equal(pressure.utilization, 0.5)
})

test('§21.6: a route that published no capacity reads as nothing fits, not as a division by zero', () => {
  const pressure = core.readContextPressure(window({ contextWindow: 0, workingReserve: 0, safetyReserve: 0 }))
  assert.equal(pressure.available, 0)
  assert.equal(pressure.utilization, 1, 'an undisclosed window is full, not empty')
})

test('§22.5: below the reduce threshold the window continues', () => {
  const decision = core.decideContextPressure({ tokens: 10_000, window: window() })
  assert.equal(decision.ok, true)
  assert.equal(decision.action, 'continue')
})

test('§22.5: past the reduce threshold the window sheds, cheapest action first', () => {
  const decision = core.decideContextPressure({ tokens: AVAILABLE * 0.85, window: window() })
  assert.equal(decision.ok, true)
  assert.equal(decision.action, 'prune', 'prune is the cheapest reduction in the default order')

  const afterPrune = core.decideContextPressure({ tokens: AVAILABLE * 0.85, window: window(), attempted: ['prune'] })
  assert.equal(afterPrune.action, 'offload')
})

test('§22.5: with every reduction spent, a still-full window rolls over instead of shedding forever', () => {
  const decision = core.decideContextPressure({
    tokens: AVAILABLE * 0.85,
    window: window(),
    attempted: ['prune', 'offload', 'dematerialize', 'compact'],
  })
  assert.equal(decision.ok, true)
  assert.equal(decision.action, 'rollover', 'a fifth reduction does not exist; the window must roll over')
})

test('§22.5: at the rollover threshold the decision is a rollover, not another reduction', () => {
  const decision = core.decideContextPressure({ tokens: AVAILABLE * 0.99, window: window() })
  assert.equal(decision.action, 'rollover')
})

test('§21.6: a route that published nothing is refused rather than rolled over', () => {
  const decision = core.decideContextPressure({
    tokens: 1,
    window: window({ contextWindow: 0, workingReserve: 0, safetyReserve: 0 }),
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'context-window-undisclosed', 'rolling over cannot give a route a capacity it never published')
})

test('§22.4: prune drops the oldest settled turns and keeps their anchors', () => {
  const pressure = core.readContextPressure(window({ tokens: AVAILABLE * 0.9 }))
  const outcome = core.pruneWindow({
    window: window({ tokens: AVAILABLE * 0.9 }),
    items: [item({ uri: 'turn-1', tokens: 30_000, anchor: 'packages/core/src/session.ts:88' }), item({ uri: 'turn-2', tokens: 30_000 })],
    pressure,
    targetHeadroom: 20_000,
    at: NOW,
  })
  assert.ok(outcome.shed.length > 0, 'something was shed')
  assert.equal(outcome.shed[0].ref, 'turn-1', 'the oldest settled turn goes first')
  assert.equal(outcome.shed[0].keptAs, 'packages/core/src/session.ts:88', 'the anchor survives the pruning')
  assert.ok(outcome.tokensAfter < outcome.tokensBefore)
})

test('§22.4: prune never drops the turn being written', () => {
  const pressure = core.readContextPressure(window({ tokens: AVAILABLE * 0.9 }))
  const outcome = core.pruneWindow({
    window: window({ tokens: AVAILABLE * 0.9 }),
    items: [item({ uri: 'live-turn', tokens: 70_000, live: true })],
    pressure,
    targetHeadroom: 20_000,
    at: NOW,
  })
  assert.equal(outcome.shed.length, 0, 'the live turn is not prunable')
  assert.equal(outcome.tokensAfter, outcome.tokensBefore)
})

test('§32: offload moves a bulky body to the store and keeps a reference', () => {
  const pressure = core.readContextPressure(window({ tokens: AVAILABLE * 0.9 }))
  const outcome = core.offloadWindow({
    window: window({ tokens: AVAILABLE * 0.9 }),
    items: [item({ uri: 'build-log', tokens: 40_000, body: 'x'.repeat(100) })],
    pressure,
    targetHeadroom: 20_000,
    at: NOW,
    offload: { uriPrefix: 'artifact://', minTokens: 100 },
  })
  assert.equal(outcome.shed.length, 1)
  assert.equal(outcome.shed[0].action, 'offload')
  assert.equal(outcome.shed[0].keptAs, 'artifact://build-log', 'what is left behind is the reference')
})

test('§32: offload without a target sheds nothing instead of inventing a destination', () => {
  const pressure = core.readContextPressure(window({ tokens: AVAILABLE * 0.9 }))
  const outcome = core.offloadWindow({
    window: window({ tokens: AVAILABLE * 0.9 }),
    items: [item({ uri: 'build-log', tokens: 40_000, body: 'x' })],
    pressure,
    targetHeadroom: 20_000,
    at: NOW,
  })
  assert.equal(outcome.shed.length, 0)
})

test('§21.2: dematerialize lowers the level and drops the body without storing anything', () => {
  const pressure = core.readContextPressure(window({ tokens: AVAILABLE * 0.9 }))
  const outcome = core.dematerializeWindow({
    window: window({ tokens: AVAILABLE * 0.9 }),
    items: [item({ uri: 'skill:default', tokens: 30_000, level: 'L2', body: 'full text' })],
    pressure,
    targetHeadroom: 20_000,
    at: NOW,
  })
  assert.equal(outcome.demoted.length, 1)
  assert.equal(outcome.demoted[0].previous, 'L2')
  assert.equal(outcome.demoted[0].item.level, 'L1', 'one step cheaper, not straight to the floor')
  assert.equal('body' in outcome.demoted[0].item, false, 'the body is gone, not merely hidden')
})

test('§21.2: an item already at the cheapest level is left alone', () => {
  const pressure = core.readContextPressure(window({ tokens: AVAILABLE * 0.9 }))
  const outcome = core.dematerializeWindow({
    window: window({ tokens: AVAILABLE * 0.9 }),
    items: [item({ uri: 'skill:default', tokens: 30_000, level: 'L0', body: 'stub' })],
    pressure,
    targetHeadroom: 20_000,
    at: NOW,
  })
  assert.equal(outcome.demoted.length, 0)
  assert.equal(outcome.tokensAfter, outcome.tokensBefore)
})

test('§22.5: compaction replaces only the span a summary covers', () => {
  const pressure = core.readContextPressure(window({ tokens: AVAILABLE * 0.9 }))
  const outcome = core.compactWindow({
    window: window({ tokens: AVAILABLE * 0.9 }),
    items: [item({ uri: 'turn-1', tokens: 20_000 }), item({ uri: 'turn-2', tokens: 20_000 })],
    pressure,
    targetHeadroom: 20_000,
    at: NOW,
    summary: { text: 'Turns 1 and 2 settled the storage question.', covers: ['turn-1'] },
  })
  assert.equal(outcome.shed.length, 1)
  assert.equal(outcome.shed[0].ref, 'turn-1', 'only the covered turn is compacted')
  assert.match(outcome.shed[0].keptAs, /settled the storage question/)
})

test('§22.5: compaction without a summary sheds nothing rather than inventing one', () => {
  const pressure = core.readContextPressure(window({ tokens: AVAILABLE * 0.9 }))
  const outcome = core.compactWindow({
    window: window({ tokens: AVAILABLE * 0.9 }),
    items: [item({ uri: 'turn-1', tokens: 20_000 })],
    pressure,
    targetHeadroom: 20_000,
    at: NOW,
  })
  assert.equal(outcome.shed.length, 0)
})

test('§22.5: one pressure application performs exactly one action, never a cascade', () => {
  const outcome = core.applyWindowPressure({
    window: window({ tokens: AVAILABLE * 0.9 }),
    items: [item({ uri: 'turn-1', tokens: 40_000 })],
    pressure: core.readContextPressure(window({ tokens: AVAILABLE * 0.9 })),
    targetHeadroom: 20_000,
    at: NOW,
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.kind, 'reduced')
  assert.equal(outcome.step.action, 'prune', 'the first unspent action, and only that one')
})

test('§22.4: a capsule carries the whole structured checkpoint', () => {
  const capsule = core.buildCheckpointCapsule(
    window(),
    checkpoint({
      goal: 'Implement checkpoint and rollover',
      decisions: {
        accepted: [{ decision: 'Pure policy in core', reason: 'testable without a Host' }],
        rejected: [{ approach: 'Bind the live session', reason: 'not verifiable in the sandbox' }],
      },
      changedArtifacts: [{ path: 'packages/core/src/session.ts', change: 'added' }],
      verification: { passed: [{ check: 'typecheck', passed: true, exitCode: 0 }], failed: [] },
      review: { reviewId: 'rev-1', findings: [{ id: 'F1', severity: 'MAJOR', summary: 'x' }], verdict: 'PASS WITH FINDINGS' },
      unresolved: ['independent review'],
      historyRefs: ['dsh://session/session-1'],
    }),
  )
  assert.equal(capsule.schema, contracts.CHECKPOINT_CAPSULE_SCHEMA)
  assert.equal(capsule.attemptId, ATTEMPT)
  assert.equal(capsule.windowOrdinal, 1)
  assert.equal(capsule.git.baseSha, 'aaa111')
  assert.equal(capsule.git.headSha, 'bbb222')
  assert.equal(capsule.decisions.accepted.length, 1)
  assert.equal(capsule.decisions.rejected[0].reason, 'not verifiable in the sandbox')
  assert.equal(capsule.verification.passed[0].exitCode, 0)
  assert.equal(capsule.review.findings[0].severity, 'MAJOR')
  assert.equal(capsule.unresolved.length, 1)
  assert.equal(capsule.historyRefs[0], 'dsh://session/session-1')
  assert.ok(capsule.fingerprint.length > 0, 'the capsule is addressed by a fingerprint')
})

test('§22.4: the same state yields the same capsule fingerprint', () => {
  const first = core.buildCheckpointCapsule(window(), checkpoint())
  const second = core.buildCheckpointCapsule(window(), checkpoint())
  assert.equal(first.fingerprint, second.fingerprint, 'a fingerprint is a function of state, not of time')
})

test('§22.4: a capsule whose task is not the window\u2019s task is refused at construction', () => {
  assert.throws(() => core.buildCheckpointCapsule(window(), checkpoint({ taskId: 'other-task' })), /not the window's task/)
})

test('§32: a stored checkpoint reports the reference it was stored under', async () => {
  const store = acceptingStore()
  const result = await core.checkpointSession({ window: window(), checkpoint: checkpoint(), port: store })
  assert.equal(result.ok, true)
  assert.equal(result.created, true)
  assert.equal(result.capsule.ref.artifactId, 'art-1')
  assert.equal(store.written.length, 1)
})

test('§32: a checkpoint with no anchor is refused before the store is touched', async () => {
  const store = acceptingStore()
  const result = await core.checkpointSession({ window: window(), checkpoint: checkpoint({ anchors: [] }), port: store })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'anchors-missing')
  assert.equal(store.written.length, 0, 'nothing is written for a capsule that cannot seed a resume')
})

test('§32: a failed checkpoint write keeps the evidence and reports no completion', async () => {
  const result = await core.checkpointSession({ window: window(), checkpoint: checkpoint(), port: brokenStore() })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'checkpoint-store-unavailable')
  assert.match(result.detail, /connection refused/)
  assert.equal(result.capsule.attemptId, ATTEMPT, 'the evidence the attempt accumulated is handed back')
  assert.equal(result.capsule.anchors.length, 1, 'and so are its anchors')
  assert.equal(result.capsule.ref, undefined, 'the capsule carries no reference, because none exists')
})

test('§32: a store that claims success without a reference is a refusal, not a completion', async () => {
  // The shape of the port allows a store to answer `ok` and forget the
  // reference. Trusting that answer is precisely "looks finished but is not".
  const noRef = { async put(capsule) { return { ok: true, capsule, created: true } } }
  const result = await core.checkpointSession({ window: window(), checkpoint: checkpoint(), port: noRef })
  assert.equal(result.ok, false, 'an unreferenced capsule is not a stored capsule')
  assert.equal(result.reason, 'checkpoint-store-unavailable')
  assert.equal(result.capsule.ref, undefined)
  assert.equal(result.capsule.attemptId, ATTEMPT, 'the evidence is still handed back')

  const noCapsule = { async put() { return { ok: true, created: true } } }
  const second = await core.checkpointSession({ window: window(), checkpoint: checkpoint(), port: noCapsule })
  assert.equal(second.ok, false, 'a store that answers without a capsule has stored nothing')
  assert.equal(second.capsule.attemptId, ATTEMPT, 'and the capsule this call built is still returned')
})

test('§32: a capsule that cannot be built is refused as capsule-invalid, not thrown', async () => {
  const result = await core.checkpointSession({
    window: window(),
    checkpoint: checkpoint({ git: { baseSha: '' } }),
    port: acceptingStore(),
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'capsule-invalid', 'the declared reason is the one that is returned')
  assert.equal(result.capsule, undefined, 'no capsule could be built, and none is invented')
  assert.match(result.detail, /base SHA/)
})

test('§22.5: a rollover preserves the attempt and only the window changes', async () => {
  const owner = sessionOwner()
  const outcome = await core.rolloverSession(rolloverInput({ createSession: owner.createSession }))
  assert.equal(outcome.ok, true)
  assert.equal(outcome.result.attemptId, ATTEMPT, 'the attempt identity is carried through unchanged')
  assert.equal(outcome.result.previous.subject.attemptId, ATTEMPT)
  assert.equal(outcome.result.next.subject.attemptId, ATTEMPT, 'the new window serves the same attempt')
  assert.equal(outcome.result.next.ordinal, 2, 'the window ordinal moves, the attempt does not')
  assert.equal(outcome.result.next.sessionId, 'session-2', 'the window runs in a new session')
  assert.equal(outcome.result.next.frozenRevisions, 42, 'the revisions stay frozen (§35)')
  assert.equal(outcome.result.previous.closedAt, NOW + 500, 'the closing window records when it closed')
  assert.equal(outcome.result.capsule.anchors.length, 1, 'the anchors travel with the new window')
})

test('§22.5: a rollover without a durable checkpoint refuses and changes nothing', async () => {
  const owner = sessionOwner()
  const outcome = await core.rolloverSession(
    rolloverInput({
      capsule: core.buildCheckpointCapsule(window(), checkpoint()),
      createSession: owner.createSession,
    }),
  )
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'capsule-not-persisted', 'a window whose checkpoint is not durable would lose its evidence')
  assert.equal(owner.created.length, 0, 'no session is created for a rollover that cannot proceed')
})

test('§22.5: a rollover refuses a capsule that belongs to another attempt', async () => {
  const outcome = await core.rolloverSession(
    rolloverInput({
      capsule: {
        ...core.buildCheckpointCapsule(window(), checkpoint({ attemptId: 'attempt-9' })),
        ref: { artifactId: 'art-1', hash: 'h' },
      },
    }),
  )
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'capsule-attempt-mismatch')
})

test('§22.5: a rollover refuses a window that was not decided to roll over', async () => {
  const outcome = await core.rolloverSession(
    rolloverInput({ decision: { ok: true, pressure: core.readContextPressure(window()), action: 'prune' } }),
  )
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'rollover-not-warranted')
})

test('§22.5: a rollover refuses an already closed window', async () => {
  const outcome = await core.rolloverSession(rolloverInput({ window: { ...window(), closedAt: NOW } }))
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'window-closed')
})

test('§22.5: a capsule taken in another window of the same attempt is stale', async () => {
  const stale = { ...core.buildCheckpointCapsule(window(), checkpoint()), ref: { artifactId: 'art-1', hash: 'h' }, windowOrdinal: 5 }
  const owner = sessionOwner()
  const outcome = await core.rolloverSession(rolloverInput({ capsule: stale, createSession: owner.createSession }))
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'stale-window', 'the attempt has already left the place this capsule describes')
  assert.equal(owner.created.length, 0, 'and no session is minted for it')
})

test('§22.5: an observed revision that is not the window revision is stale', async () => {
  const owner = sessionOwner()
  const outcome = await core.rolloverSession(rolloverInput({ expectedRevision: 99, createSession: owner.createSession }))
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'stale-window')
  assert.equal(owner.created.length, 0)

  const fresh = await core.rolloverSession(rolloverInput({ expectedRevision: 1, createSession: owner.createSession }))
  assert.equal(fresh.ok, true, 'the revision the window actually carries is accepted')
})

test('§22.5: a capsule of another task or workspace cannot seed this window', async () => {
  const foreign = {
    ...core.buildCheckpointCapsule(window(), checkpoint()),
    ref: { artifactId: 'art-1', hash: 'h' },
    taskId: 'other-task',
  }
  const outcome = await core.rolloverSession(rolloverInput({ capsule: foreign }))
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'capsule-invalid')
})

test('§22.5: every declared rollover refusal is reachable', async () => {
  // A refusal reason nobody can reach is a claim the code does not keep.
  const owner = sessionOwner()
  const base = rolloverInput({ createSession: owner.createSession })
  const persisted = { artifactId: 'art-1', hash: 'h' }
  const probes = {
    'window-closed': { window: { ...window(), closedAt: NOW } },
    'capsule-attempt-mismatch': { capsule: { ...core.buildCheckpointCapsule(window(), checkpoint({ attemptId: 'other' })), ref: persisted } },
    'capsule-invalid': { capsule: { ...core.buildCheckpointCapsule(window(), checkpoint()), ref: persisted, taskId: 'other-task' } },
    'capsule-not-persisted': { capsule: core.buildCheckpointCapsule(window(), checkpoint()) },
    'session-create-failed': { createSession: async () => { throw new Error('down') } },
    'rollover-not-warranted': { decision: { ok: true, pressure: core.readContextPressure(window()), action: 'prune' } },
    'stale-window': { expectedRevision: 99 },
    'attempt-mismatch': { window: window({ subject: { purpose: 'planning', workspaceId: 'ws-1', taskId: 'task-1' } }) },
  }
  assert.deepEqual(Object.keys(probes).sort(), [...contracts.ROLLOVER_REFUSAL_REASONS].sort(), 'every declared reason has a probe')
  for (const [expected, overrides] of Object.entries(probes)) {
    const outcome = await core.rolloverSession({ ...base, ...overrides })
    assert.equal(outcome.ok, false, `${expected} must refuse`)
    assert.equal(outcome.reason, expected)
  }
})

test('§22.5: an invalid clock reading or reserve is refused before a session is minted', async () => {
  // The documented invariant is that a refusal leaves nothing behind. A session
  // created for a window that could not be opened is something left behind.
  for (const [label, overrides] of [
    ['a negative clock reading', { at: -1 }],
    ['a fractional clock reading', { at: 1.5 }],
    ['reserves that exceed the capacity', { workingReserve: 90_000, safetyReserve: 90_000 }],
  ]) {
    const owner = sessionOwner()
    const outcome = await core.rolloverSession(rolloverInput({ ...overrides, createSession: owner.createSession }))
    assert.equal(outcome.ok, false, `${label} must be refused`)
    assert.equal(owner.created.length, 0, `${label} must not leave a session behind`)
  }
})

test('§22.5: a session owner that fails leaves the attempt unrolled', async () => {
  const outcome = await core.rolloverSession(
    rolloverInput({
      createSession: async () => {
        throw new Error('owner unavailable')
      },
    }),
  )
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'session-create-failed')
  assert.match(outcome.detail, /owner unavailable/)
})

test('§22.3: a retry creates a new attempt and a new session, and carries no transcript', () => {
  const plan = core.freshSessionPlan('retry')
  assert.equal(plan.preservesAttempt, false, 'a retry is a new attempt')
  assert.equal(plan.createsSession, true, 'and therefore a new session')
  assert.equal(plan.reusesSession, false)
  assert.equal(plan.carriesCheckpoint, true, 'the checkpoint travels')
  assert.equal(plan.carriesFindings, true, 'the review findings travel')
  assert.equal(plan.carriesTranscript, false, 'the whole transcript never travels')
})

test('§22.3: a rejection creates a new attempt and a new session', () => {
  for (const trigger of ['retry', 'reject', 'recovery', 'reassignment']) {
    const plan = core.freshSessionPlan(trigger)
    assert.equal(plan.preservesAttempt, false, `${trigger} is a new attempt`)
    assert.equal(plan.createsSession, true, `${trigger} is a new session`)
    assert.equal(plan.carriesTranscript, false, `${trigger} carries no transcript`)
  }
})

test('§22.5: pressure is the one trigger that stays inside the attempt', () => {
  const plan = core.freshSessionPlan('pressure')
  assert.equal(plan.preservesAttempt, true)
  assert.equal(plan.reusesSession, true, 'a rollover inside one attempt keeps its session')
  assert.equal(plan.createsSession, false)
  assert.equal(plan.carriesTranscript, false)
})

test('§22.2: a deployment that turns per-attempt sessions off is read, not overwritten', () => {
  const plan = core.freshSessionPlan('pressure', { ...contracts.DEFAULT_FRESH_SESSION_POLICY, perAttempt: false })
  assert.equal(plan.preservesAttempt, true, 'the attempt still survives')
  assert.equal(plan.createsSession, true, 'but the deployment asked for a session of its own')
  assert.equal(plan.reusesSession, false)
})

test('§22.5: every trigger is answered, so no caller can fall through to a default', () => {
  // The list is literal on purpose: iterating the exported constant would make
  // this test agree with whatever the constant happens to say, including a
  // truncated one.
  const expected = ['pressure', 'retry', 'reject', 'recovery', 'reassignment']
  assert.deepEqual([...contracts.ROLLOVER_TRIGGERS], expected)
  const plans = expected.map(trigger => core.freshSessionPlan(trigger))
  assert.deepEqual(
    plans.map(plan => [plan.trigger, plan.preservesAttempt, plan.createsSession, plan.reusesSession, plan.carriesCheckpoint, plan.carriesFindings, plan.carriesTranscript]),
    [
      ['pressure', true, false, true, true, true, false],
      ['retry', false, true, false, true, true, false],
      ['reject', false, true, false, true, true, false],
      ['recovery', false, true, false, true, true, false],
      ['reassignment', false, true, false, true, true, false],
    ],
  )
})

test('§22.3: a deployment may not turn a retry back into a reused session', () => {
  // The cell that decides whether §22.3 can be configured away: turning
  // per-attempt sessions off must not let a retry keep the session it left.
  const off = { ...contracts.DEFAULT_FRESH_SESSION_POLICY, perAttempt: false }
  for (const trigger of ['retry', 'reject', 'recovery', 'reassignment']) {
    const plan = core.freshSessionPlan(trigger, off)
    assert.equal(plan.preservesAttempt, false, `${trigger} is still a new attempt`)
    assert.equal(plan.createsSession, true, `${trigger} still creates a session`)
    assert.equal(plan.reusesSession, false, `${trigger} may never reuse a session`)
  }
  const rollover = core.freshSessionPlan('pressure', off)
  assert.equal(rollover.createsSession, true, 'the deployment asked for a session of its own')
  assert.equal(rollover.preservesAttempt, true, 'but the attempt survives')
})

test('§22.2: the policy answers for the purposes that have no rollover trigger', () => {
  // `freshSessionPlan` answers for the triggers that move work between attempts;
  // a review and a planning operation are not among them, so the question "does
  // this get a fresh session" needs its own answer.
  const baseline = contracts.DEFAULT_FRESH_SESSION_POLICY
  for (const purpose of contracts.SESSION_PURPOSES) {
    assert.equal(core.freshSessionFor(purpose, baseline), true, `${purpose} gets a session by default`)
  }
  assert.equal(core.freshSessionFor('review', { ...baseline, perReview: false }), false)
  assert.equal(core.freshSessionFor('planning', { ...baseline, perPlanning: false }), false)
  assert.equal(core.freshSessionFor('reflection', { ...baseline, perReflection: false }), false)
  assert.equal(core.freshSessionFor('optimization', { ...baseline, perOptimization: false }), false)
  assert.equal(core.freshSessionFor('attempt', { ...baseline, perReview: false }), true, 'one flag does not speak for another')
})

test('§22.4: the capsule shape is closed, so an unlisted field cannot travel', () => {
  const declared = new Set(contracts.CHECKPOINT_CAPSULE_FIELDS)
  const optional = new Set(['goal', 'review', 'ref'])
  const bare = core.buildCheckpointCapsule(window(), checkpoint())
  for (const key of Object.keys(bare)) {
    assert.ok(declared.has(key), `"${key}" is not a declared capsule field`)
  }
  // Every declared field is reachable; a capsule that states them all still
  // carries nothing outside the declaration.
  const full = core.buildCheckpointCapsule(
    window(),
    checkpoint({
      goal: 'goal',
      review: { reviewId: 'rev-1', findings: [] },
      historyRefs: ['dsh://session/session-1'],
    }),
  )
  for (const key of Object.keys(full)) {
    assert.ok(declared.has(key), `"${key}" is not a declared capsule field`)
  }
  // The declared fields are exactly the ones produced: every field that is not
  // optional is present, and nothing optional is missing from the declaration.
  const required = [...declared].filter(field => !optional.has(field)).sort()
  const produced = Object.keys(bare).sort()
  assert.deepEqual(produced, required, 'the capsule produces exactly its declared non-optional fields')
  assert.ok(required.includes('schema'), 'the schema brand is required')
  assert.ok(required.includes('createdAt'), 'the creation time is required')
})

test('§22.4: a capsule whose content breaks its own vocabulary is refused', () => {
  const cases = [
    ['a path anchor without a line', { anchors: [{ kind: 'path', ref: 'x.ts' }] }],
    ['an anchor of an undeclared kind', { anchors: [{ kind: 'not-a-kind', ref: 'x' }] }],
    ['an anchor without a reference', { anchors: [{ kind: 'commit', ref: '  ' }] }],
    ['an undeclared artifact change', { changedArtifacts: [{ path: 'p', change: 'exploded' }] }],
    ['a check that does not say whether it passed', { verification: { passed: [{ check: 'c', passed: 'yes' }], failed: [] } }],
    ['a finding off the one severity scale', { review: { reviewId: 'r1', findings: [{ id: 'F', severity: 'CATASTROPHIC', summary: 's' }] } }],
    ['a rejected approach without a reason', { decisions: { accepted: [], rejected: [{ approach: 'a' }] } }],
  ]
  for (const [label, overrides] of cases) {
    assert.throws(
      () => core.buildCheckpointCapsule(window(), checkpoint(overrides)),
      TypeError,
      `${label} must be refused`,
    )
  }
  // The same fields, correctly stated, are accepted — so the check is about the
  // vocabulary and not about refusing everything.
  const sound = core.buildCheckpointCapsule(
    window(),
    checkpoint({
      changedArtifacts: [{ path: 'p', change: 'modified' }],
      verification: { passed: [{ check: 'c', passed: true }], failed: [{ check: 'd', passed: false, exitCode: 1 }] },
      review: { reviewId: 'r1', findings: [{ id: 'F', severity: 'MAJOR', summary: 's' }] },
      decisions: { accepted: [{ decision: 'd' }], rejected: [{ approach: 'a', reason: 'r' }] },
      anchors: [{ kind: 'path', ref: 'x.ts', line: 3 }, { kind: 'commit', ref: 'abc123' }],
    }),
  )
  assert.equal(sound.anchors.length, 2)
})

test('§22.3: a history entry that is a body rather than a reference is refused', () => {
  const body = 'x'.repeat(2189)
  for (const ref of [body, '', '   ', 'totally not a uri', 'session-1']) {
    assert.throws(
      () => core.buildCheckpointCapsule(window(), checkpoint({ historyRefs: [ref] })),
      TypeError,
      `"${ref.slice(0, 20)}" is not a reference and must be refused`,
    )
  }
  for (const ref of ['dsh://session/session-1#turn-4', 'artifact://art-1', 'issue://MW-020']) {
    const capsule = core.buildCheckpointCapsule(window(), checkpoint({ historyRefs: [ref] }))
    assert.deepEqual([...capsule.historyRefs], [ref], `${ref} is a reference and is accepted`)
  }
})

test('§22.4: a transcript is carried as a reference and never as content', () => {
  const capsule = core.buildCheckpointCapsule(
    window(),
    checkpoint({ historyRefs: ['dsh://session/session-1#turn-4'] }),
  )
  assert.deepEqual([...capsule.historyRefs], ['dsh://session/session-1#turn-4'])
  assert.equal('transcript' in capsule, false, 'there is no field a transcript could arrive in')
  assert.equal('messages' in capsule, false)
})

test('§22.5: a rollover keeps the anchor of the work that stopped', async () => {
  const anchors = [
    { kind: 'path', ref: 'packages/core/src/session.ts', line: 88 },
    { kind: 'commit', ref: '067bb58' },
    { kind: 'error', ref: 'EPERM' },
  ]
  const seeded = {
    ...core.buildCheckpointCapsule(window(), checkpoint({ anchors })),
    ref: { artifactId: 'art-1', hash: 'h' },
  }
  const outcome = await core.rolloverSession(rolloverInput({ capsule: seeded }))
  assert.equal(outcome.ok, true)
  assert.equal(outcome.result.capsule.anchors.length, 3)
  assert.equal(outcome.result.capsule.anchors[0].line, 88, 'a path anchor keeps its exact line')
  assert.equal(outcome.result.next.ordinal, core.nextWindowOrdinal(window()))
})

test('§22.5: two windows of one attempt are recognisable as the same attempt', async () => {
  const outcome = await core.rolloverSession(rolloverInput())
  assert.equal(outcome.ok, true)
  assert.equal(core.sameAttempt(outcome.result.previous, outcome.result.next), true)
  assert.equal(core.sameAttempt(outcome.result.previous, window({ sessionId: 'session-9' })), true, 'same attempt, different session')
})
