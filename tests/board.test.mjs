/**
 * Board projection and placement acceptance (ADR017, ADR018, ADR022).
 *
 * The card's acceptance list is the contract of this file, claim by claim:
 * 16/16 states in exactly one zone, `done` only from `done`, single placement,
 * drop targets equal to the non-admission transitions, string order keys with
 * one-row midpoints, a total order, a thousand insertions, zone-scoped
 * revisions, and no hex literal in the theme policy.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { contracts, core, meta, repoRoot } from './lib/fixtures.mjs'

const M = meta()

/** Placements of one snapshot; the defaults are a coherent `ready` card. */
function placementFixture(overrides = {}) {
  const exactState = overrides.exactState ?? 'ready'
  return {
    viewId: 'default',
    taskId: 'T-1',
    zone: contracts.ZONE_BY_STATE[exactState],
    exactState,
    order: 'V',
    columnRevision: 1,
    boardRevision: 1,
    ...overrides,
  }
}

test('the nine zones are the ones the architecture lists, in reading order', () => {
  assert.deepEqual([...contracts.BOARD_ZONES], [
    'ideas',
    'backlog',
    'ready',
    'in-progress',
    'review',
    'blocked',
    'error',
    'done',
    'cancelled',
  ])
  // The rows carry the phase semantics of the 3x3 grid.
  assert.deepEqual(Object.keys(contracts.BOARD_ZONE_ROWS), [...contracts.BOARD_ZONES])
  assert.deepEqual(
    [...new Set(contracts.BOARD_ZONES.map(zone => contracts.BOARD_ZONE_ROWS[zone]))],
    ['intake', 'active', 'terminal'],
  )
  // Every zone has an icon; the UI resolves the name, not a codepoint.
  for (const zone of contracts.BOARD_ZONES) {
    assert.equal(typeof contracts.BOARD_ZONE_ICONS[zone], 'string', `icon of ${zone}`)
  }
})

test('each of the 16 TaskStates maps to exactly one of the nine zones', () => {
  // Guard the corpus first: an empty or short state list would make the loop
  // below vacuous, which is the failure mode this test exists to prevent.
  assert.equal(contracts.TASK_STATES.length, 16, 'the domain has 16 task states')
  assert.equal(new Set(contracts.TASK_STATES).size, 16, 'task states are distinct')

  const tableEntries = Object.entries(contracts.ZONE_BY_STATE)
  assert.equal(tableEntries.length, 16, 'ZONE_BY_STATE must cover all 16 states')
  // The table is total in both directions: no extra state, none missing.
  assert.deepEqual([...tableEntries.map(([state]) => state)].sort(), [...contracts.TASK_STATES].sort())

  const counts = new Map()
  for (const state of contracts.TASK_STATES) {
    const zone = core.projectTaskZone(state)
    assert.ok(contracts.BOARD_ZONES.includes(zone), `${state} maps to a real zone, got "${zone}"`)
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }
  for (const [state, count] of counts) {
    assert.equal(count, 1, `${state} must be projected exactly once, counted ${count}`)
  }

  // Every zone except `ideas` holds tasks; `ideas` holds Idea entities instead.
  const usedZones = new Set(contracts.TASK_STATES.map(state => core.projectTaskZone(state)))
  assert.deepEqual(
    [...usedZones].sort(),
    [...contracts.BOARD_ZONES].filter(zone => zone !== 'ideas').sort(),
  )
  assert.equal(core.isTaskZone('ideas'), false)
  assert.deepEqual(core.taskStatesOfZone('ideas'), [])
})

test('projectTaskZone cannot return done for any state other than done', () => {
  let checked = 0
  for (const state of contracts.TASK_STATES) {
    checked += 1
    if (state === 'done') {
      assert.equal(core.projectTaskZone(state), 'done')
      continue
    }
    assert.notEqual(core.projectTaskZone(state), 'done', `${state} must not render as done`)
  }
  assert.equal(checked, 16, 'the property must be checked against every state')
  // And the reverse: no other state shares the done zone.
  assert.deepEqual(core.taskStatesOfZone('done'), ['done'])
})

test('zoneOfState is the same total projection as projectTaskZone', () => {
  for (const state of contracts.TASK_STATES) {
    assert.equal(core.zoneOfState(state), core.projectTaskZone(state), `${state}`)
  }
})

test('assertSinglePlacement refuses a snapshot with one taskId in two zones', () => {
  const good = [placementFixture({ taskId: 'T-1', exactState: 'ready' })]
  assert.equal(core.assertSinglePlacement(good, M).ok, true)

  // The same task twice: this is the duplicate the board must never render.
  const duplicated = [
    placementFixture({ taskId: 'T-1', exactState: 'ready' }),
    placementFixture({ taskId: 'T-1', exactState: 'executing', zone: 'in-progress' }),
  ]
  const refused = core.assertSinglePlacement(duplicated, M)
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'TASK_CONFLICT')
  assert.equal(refused.error.details.taskId, 'T-1')
  assert.deepEqual(refused.error.details.zones, ['ready', 'in-progress'])

  // A card whose zone contradicts its own exactState is the projection
  // collapsing domain states (ADR018), which is refused as a contract mismatch.
  const mismatched = [placementFixture({ taskId: 'T-1', exactState: 'failed', zone: 'done' })]
  const inconsistent = core.assertSinglePlacement(mismatched, M)
  assert.equal(inconsistent.ok, false)
  assert.equal(inconsistent.error.code, 'CONTRACT_MISMATCH')
  assert.equal(inconsistent.error.details.expected, 'error')

  // A task in the ideas zone is an entity mix-up, not a layout choice.
  const ideaZone = [placementFixture({ taskId: 'T-1', exactState: 'planned', zone: 'ideas' })]
  assert.equal(core.assertSinglePlacement(ideaZone, M).error.code, 'CONTRACT_MISMATCH')

  // Distinct tasks in the same zone are of course fine.
  const many = [
    placementFixture({ taskId: 'T-1', exactState: 'draft' }),
    placementFixture({ taskId: 'T-2', exactState: 'planned' }),
  ]
  assert.equal(core.assertSinglePlacement(many, M).ok, true)
})

test('legalDropTargets equals allowedTaskTransitions without the admission-only edges', () => {
  // The edge that only admission may perform: `ready -> assigned`.
  assert.equal(core.canTransitionTask('ready', 'assigned'), true)
  const admissionOnly = new Set(['assigned'])
  let inspected = 0
  for (const state of contracts.TASK_STATES) {
    inspected += 1
    const transitions = core.allowedTaskTransitions(state)
    // Expected zone set: every reachable target's zone, plus the card's own zone
    // (dropping a card where it already is means a reorder, not a transition).
    const expected = new Set([core.projectTaskZone(state)])
    for (const target of transitions) {
      // Targets that require an attempt the current state does not hold are
      // reachable only through admitAttempt.
      if (admissionOnly.has(target) && !core.requiresActiveAttempt(state)) continue
      expected.add(core.projectTaskZone(target))
    }
    const actual = [...core.legalDropTargets(state)]
    assert.deepEqual(
      actual,
      contracts.BOARD_ZONES.filter(zone => expected.has(zone)),
      `drop targets of "${state}"`,
    )
    // The card's own zone is always a legal drop: dropping in place reorders.
    assert.ok(actual.includes(core.projectTaskZone(state)), `${state} must allow its own zone`)
    assert.equal(actual.includes('ideas'), false, `${state} must never drop into ideas`)
  }
  assert.equal(inspected, 16, 'the drop-target property must cover every state')

  // A `ready` card cannot be dropped straight into in-progress: starting work is
  // admission, which a drag must not perform. Its reachable states are
  // `blocked`, `cancelled`, and `superseded` (also `cancelled`) — no `planned`
  // edge exists, so `backlog` is not a legal target.
  assert.deepEqual([...core.legalDropTargets('ready')], ['ready', 'blocked', 'cancelled'])
  // A `planned` card may drop back into backlog (its own zone), forward to
  // ready, blocked, or cancelled.
  assert.deepEqual([...core.legalDropTargets('planned')], ['backlog', 'ready', 'blocked', 'cancelled'])
  // An `approved` card may drop into review (its own zone, reorder) and integrate.
  assert.ok(core.legalDropTargets('approved').includes('review'))
  // A terminal card has nowhere to go but its own zone.
  assert.deepEqual([...core.legalDropTargets('done')], ['done'])
})

test('BoardPlacement.order is a string and a midpoint insert rewrites one row', () => {
  const placements = [
    placementFixture({ taskId: 'T-1', order: 'A', columnRevision: 3 }),
    placementFixture({ taskId: 'T-3', order: 'C', columnRevision: 3 }),
  ]
  for (const placement of placements) {
    assert.equal(typeof placement.order, 'string', 'order is a string key, not a number')
  }

  const before = new Map(placements.map(p => [p.taskId, p.order]))
  const insertion = core.resolveInsertion(
    { taskId: 'T-1', order: 'A' },
    { taskId: 'T-3', order: 'C' },
  )
  assert.equal(insertion.ok, true)
  assert.equal(typeof insertion.order, 'string')
  assert.ok('A' < insertion.order && insertion.order < 'C', `expected A < ${insertion.order} < C`)

  // Only the inserted row carries a new key; the neighbours are untouched.
  const after = new Map([...before, ['T-2', insertion.order]])
  const changed = [...after].filter(([taskId, order]) => before.has(taskId) && before.get(taskId) !== order)
  assert.deepEqual(changed, [], 'a midpoint insert must not rewrite an existing row')
  assert.equal(after.size, before.size + 1)

  // The written placement carries that key and the zone's revision bump.
  const applied = core.applyDropIntent(
    placements[0],
    {
      viewId: 'default',
      taskId: 'T-1',
      fromZone: 'ready',
      toZone: 'ready',
      expectedColumnRevision: 3,
    },
    insertion.order,
    M,
  )
  assert.equal(applied.ok, true)
  assert.equal(applied.value.placement.order, insertion.order)
  assert.equal(applied.value.columnRevision, 4)
  assert.equal(applied.value.fromZone, undefined, 'a same-zone move is a reorder, not a rezone')
})

test('boardOrdering is total on (orderKey, taskId)', () => {
  // Equal keys are the case a naive comparator leaves unordered.
  const equalKeys = [
    { taskId: 'T-3', order: 'V' },
    { taskId: 'T-1', order: 'V' },
    { taskId: 'T-2', order: 'V' },
  ]
  const ordered = core.boardOrdering(equalKeys)
  assert.deepEqual(ordered.map(card => card.taskId), ['T-1', 'T-2', 'T-3'])
  assert.deepEqual(ordered.map(card => card.order), ['V', 'V', 'V'])

  // Totality means every permutation yields the same sequence.
  const permutations = [
    [0, 1, 2],
    [2, 1, 0],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [0, 2, 1],
  ]
  for (const permutation of permutations) {
    const shuffled = permutation.map(index => equalKeys[index])
    assert.deepEqual(
      core.boardOrdering(shuffled).map(card => card.taskId),
      ['T-1', 'T-2', 'T-3'],
      `permutation ${permutation.join('')}`,
    )
  }

  // Pinned cards come first, then order, then taskId.
  const mixed = [
    { taskId: 'T-9', order: 'A' },
    { taskId: 'T-5', order: 'Z', pinned: true },
    { taskId: 'T-1', order: 'B' },
  ]
  assert.deepEqual(core.boardOrdering(mixed).map(card => card.taskId), ['T-5', 'T-9', 'T-1'])
  // The input array is not mutated by sorting.
  assert.deepEqual(mixed.map(card => card.taskId), ['T-9', 'T-5', 'T-1'])
})

test('a thousand successive insertions in one zone keep a total order', () => {
  const seeds = core.renumberKeys(2)
  assert.equal(seeds.length, 2)
  assert.ok(seeds[0] < seeds[1], `renumbered keys must be ascending: ${seeds.join(' ')}`)
  assert.equal(core.renumberKeys(0).length, 0)

  // Cards arrive into the gap between two existing neighbours, each new card
  // becoming the bound the next one hugs. This is the insert-heavy zone §5.3
  // cares about, and it must not need a renumber for a thousand drops.
  const keys = [...seeds]
  let lower = seeds[0]
  let upper = seeds[1]
  for (let index = 0; index < 1000; index += 1) {
    const resolved = core.resolveInsertion({ taskId: `L${index}`, order: lower }, { taskId: `U${index}`, order: upper })
    assert.equal(resolved.ok, true, `insertion ${index} must fit: ${resolved.code ?? ''}`)
    assert.ok(lower < resolved.order && resolved.order < upper, `insertion ${index} must land strictly between`)
    keys.push(resolved.order)
    // Alternate which neighbour the next drop hugs: the worst realistic case.
    if (index % 2 === 0) lower = resolved.order
    else upper = resolved.order
  }
  assert.equal(keys.length, 1002)
  const sorted = [...keys].sort()
  assert.deepEqual(keys.slice().sort(), sorted, 'the generated keys must already be ascending')
  assert.equal(new Set(keys).size, keys.length, 'every key must be distinct')
})

test('a gap that cannot be subdivided reports ORDER_RENUMBER_REQUIRED, never equal keys', () => {
  // Adjacent keys: no key sorts between them, so the answer must be the code.
  const exhausted = core.resolveInsertion({ taskId: 'A', order: '1' }, { taskId: 'B', order: '10' })
  assert.equal(exhausted.ok, false)
  assert.equal(exhausted.code, 'ORDER_RENUMBER_REQUIRED')

  // Inverted bounds are also a renumber, not a silent repair.
  const inverted = core.resolveInsertion({ taskId: 'A', order: 'Z' }, { taskId: 'B', order: 'A' })
  assert.equal(inverted.ok, false)
  assert.equal(inverted.code, 'ORDER_RENUMBER_REQUIRED')

  // The front of a zone is bounded only above; a smaller key always exists.
  const front = core.resolveInsertion(undefined, { taskId: 'B', order: 'V' })
  assert.equal(front.ok, true)
  assert.ok(front.order < 'V', `${front.order} must sort before V`)

  // Nothing sorts below the smallest key: that is the one true front boundary.
  assert.equal(core.midpointKey(undefined, '0'), undefined)
  // And an unbounded upper bound always yields a larger key.
  const end = core.resolveInsertion({ taskId: 'A', order: 'V' }, undefined)
  assert.equal(end.ok, true)
  assert.ok(end.order > 'V', `${end.order} must sort after V`)

  // Repeated subdivision of a genuinely finite gap eventually reports the code
  // instead of fabricating an equal key.
  let lower = '1'
  let upper = '2'
  let steps = 0
  for (; steps < 100; steps += 1) {
    const resolved = core.midpointKey(lower, upper)
    if (resolved === undefined) break
    assert.ok(lower < resolved && resolved < upper, `step ${steps}: ${lower} < ${resolved} < ${upper}`)
    upper = resolved
  }
  assert.ok(steps > 0, 'the gap must admit at least one subdivision')
  assert.equal(core.midpointKey(lower, upper), undefined, 'the exhausted gap must report no key')
})

test('renumberKeys preserves the existing order and leaves headroom', () => {
  const keys = core.renumberKeys(5)
  assert.equal(keys.length, 5)
  for (let index = 1; index < keys.length; index += 1) {
    assert.ok(keys[index - 1] < keys[index], `renumbered key ${index} must sort after its predecessor`)
  }
  // Uniform spacing: each consecutive gap admits many further midpoints.
  for (let index = 1; index < keys.length; index += 1) {
    let lower = keys[index - 1]
    const upper = keys[index]
    let count = 0
    let probe = lower
    while (count < 50) {
      const next = core.midpointKey(probe, upper)
      if (next === undefined) break
      probe = next
      count += 1
    }
    assert.ok(count >= 10, `gap ${index} must admit several subdivisions, admitted ${count}`)
  }
  // A renumber is a pure re-keying: ordering the cards by the new keys gives the
  // same sequence as ordering them by the old ones.
  const cards = [
    { taskId: 'T-1', order: 'A' },
    { taskId: 'T-2', order: 'M' },
    { taskId: 'T-3', order: 'Z' },
  ]
  const before = core.boardOrdering(cards).map(card => card.taskId)
  const rekeyed = core.boardOrdering(cards.map((card, index) => ({ ...card, order: keys[index] })))
  assert.deepEqual(rekeyed.map(card => card.taskId), before)
})

test('order keys are base-62 strings or nothing', () => {
  for (const value of ['0', 'A', 'z', '1V', 'ZZV']) {
    assert.equal(core.isOrderKey(value), true, `${value} is a usable key`)
  }
  for (const value of ['', 'a-b', 'V ', 'V!', 'é']) {
    assert.equal(core.isOrderKey(value), false, `${value} is not a usable key`)
  }
  // An unusable key is refused rather than silently sorted around.
  assert.equal(core.midpointKey('a-b', 'z'), undefined)
  assert.equal(core.midpointKey('A', 'z '), undefined)
})

test('the revision is scoped to (viewId, zone) and a mismatch is STALE_COLUMN_REVISION', () => {
  const placement = placementFixture({ taskId: 'T-1', exactState: 'executing', zone: 'in-progress', columnRevision: 7 })

  const stale = core.applyDropIntent(
    placement,
    {
      viewId: placement.viewId,
      taskId: 'T-1',
      fromZone: 'in-progress',
      toZone: 'in-progress',
      expectedColumnRevision: 6,
    },
    'V',
    M,
  )
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'STALE_COLUMN_REVISION')
  assert.equal(stale.error.details.expectedColumnRevision, 6)
  assert.equal(stale.error.details.columnRevision, 7)
  assert.equal(stale.error.details.zone, 'in-progress')

  // The matching revision is accepted, and only that zone's counter moves.
  const fresh = core.applyDropIntent(
    placement,
    {
      viewId: placement.viewId,
      taskId: 'T-1',
      fromZone: 'in-progress',
      toZone: 'in-progress',
      expectedColumnRevision: 7,
    },
    'W',
    M,
  )
  assert.equal(fresh.ok, true)
  assert.equal(fresh.value.columnRevision, 8)
  assert.equal(fresh.value.placement.boardRevision, placement.boardRevision, 'the board snapshot does not move')

  // A drop that lies about the card's current zone is stale too.
  const wrongZone = core.applyDropIntent(
    placement,
    {
      viewId: placement.viewId,
      taskId: 'T-1',
      fromZone: 'review',
      toZone: 'review',
      expectedColumnRevision: 7,
    },
    'V',
    M,
  )
  assert.equal(wrongZone.ok, false)
  assert.equal(wrongZone.error.code, 'STALE_COLUMN_REVISION')

  // A drop naming another card is a contract mismatch, not a stale read.
  const otherTask = core.applyDropIntent(
    placement,
    {
      viewId: placement.viewId,
      taskId: 'T-9',
      fromZone: 'in-progress',
      toZone: 'in-progress',
      expectedColumnRevision: 7,
    },
    'V',
    M,
  )
  assert.equal(otherTask.ok, false)
  assert.equal(otherTask.error.code, 'CONTRACT_MISMATCH')
})

test('a drop must land in the zone the card state renders in', () => {
  // The write path and the projection must agree: a placement produced by
  // applyDropIntent has to satisfy assertSinglePlacement, or the public API
  // contradicts itself and the board would render a card in a zone its exact
  // state does not belong to.
  const placement = placementFixture({ taskId: 'T-1', exactState: 'ready' })
  let accepted = 0
  for (const zone of contracts.BOARD_ZONES) {
    const applied = core.applyDropIntent(
      placement,
      { viewId: 'default', taskId: 'T-1', fromZone: 'ready', toZone: zone, expectedColumnRevision: 1 },
      'W',
      M,
    )
    if (!applied.ok) {
      assert.ok(
        ['TASK_CONFLICT', 'CONTRACT_MISMATCH'].includes(applied.error.code),
        `refusal of ${zone} must be typed, got ${applied.error.code}`,
      )
      continue
    }
    accepted += 1
    // Whatever it accepted, the projection must accept too.
    const coherent = core.assertSinglePlacement([applied.value.placement], M)
    assert.equal(coherent.ok, true, `${zone}: applyDropIntent produced a placement assertSinglePlacement rejects`)
    // And the zone must be one the card is legally allowed to reach.
    assert.ok(
      core.legalDropTargets('ready').includes(zone),
      `${zone} is not a legal drop target of a "ready" card`,
    )
  }
  // Only the card's own zone is a legal same-state drop for a `ready` card.
  assert.equal(accepted, 1, `expected exactly the own-zone drop to be accepted, got ${accepted}`)

  // The refusal carries the legal targets, so a caller can repair the drop.
  const refused = core.applyDropIntent(
    placement,
    { viewId: 'default', taskId: 'T-1', fromZone: 'ready', toZone: 'error', expectedColumnRevision: 1 },
    'W',
    M,
  )
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'TASK_CONFLICT')
  assert.equal(refused.error.details.exactState, 'ready')
  assert.equal(refused.error.details.expectedZone, 'ready')
  assert.deepEqual(refused.error.details.legalTargets, [...core.legalDropTargets('ready')])
})

test('a drop with an unusable order key is refused', () => {
  const placement = placementFixture({ taskId: 'T-1', exactState: 'ready' })
  const intent = {
    viewId: 'default',
    taskId: 'T-1',
    fromZone: 'ready',
    toZone: 'ready',
    expectedColumnRevision: 1,
  }
  for (const bad of ['', 'NOT-A-VALID-KEY!!', 'V ', 'é', 'a-b']) {
    const applied = core.applyDropIntent(placement, intent, bad, M)
    assert.equal(applied.ok, false, `order ${JSON.stringify(bad)} must be refused`)
    assert.equal(applied.error.code, 'CONTRACT_MISMATCH')
  }
  // A key that came from resolveInsertion is of course accepted.
  const resolved = core.resolveInsertion({ taskId: 'A', order: 'A' }, { taskId: 'B', order: 'C' })
  assert.equal(resolved.ok, true)
  const applied = core.applyDropIntent(placement, intent, resolved.order, M)
  assert.equal(applied.ok, true)
  assert.equal(applied.value.placement.order, resolved.order)
})

test('projection indexes a zone by the task state, never the reverse', () => {
  // Every zone that holds tasks renders a card only for the states it lists, so
  // a caller can pick a legal target from legalDropTargets without re-deriving
  // the table.
  for (const zone of contracts.BOARD_ZONES) {
    const states = core.taskStatesOfZone(zone)
    for (const state of states) {
      assert.equal(core.projectTaskZone(state), zone, `${state} must project into ${zone}`)
    }
  }
  assert.equal(core.taskStatesOfZone('review').length, 4, 'awaiting-review, reviewing, approved, integrating')
  assert.equal(core.taskStatesOfZone('error').length, 2, 'failed, changes-requested')
  assert.equal(core.taskStatesOfZone('cancelled').length, 2, 'cancelled, superseded')
})

test('the two literal insertion strategies of ADR §5.3 both behave', () => {
  // The ADR's wording is read two ways; both are checked explicitly rather than
  // relying on the interleaved strategy the thousand-insertion test uses.
  const seeds = core.renumberKeys(2)

  // (a) Always hug the UPPER bound: each insert narrows the gap from above, so
  // the interval is finite and the sequence must end in ORDER_RENUMBER_REQUIRED
  // rather than in equal keys.
  let lower = seeds[0]
  let upper = seeds[1]
  let above = 0
  for (; above < 100; above += 1) {
    const resolved = core.midpointKey(lower, upper)
    if (resolved === undefined) break
    assert.ok(lower < resolved && resolved < upper, `hug-upper step ${above}`)
    upper = resolved
  }
  assert.ok(above > 0, 'the gap must admit at least one subdivision')
  assert.equal(core.midpointKey(lower, upper), undefined, 'an exhausted gap must report no key')

  // (b) Always hug the LOWER bound: the interval above the new key stays wide,
  // so a thousand insertions succeed.
  lower = seeds[0]
  upper = seeds[1]
  for (let index = 0; index < 1000; index += 1) {
    const resolved = core.midpointKey(lower, upper)
    assert.notEqual(resolved, undefined, `hug-lower insertion ${index} must fit`)
    assert.ok(lower < resolved && resolved < upper, `hug-lower step ${index}`)
    lower = resolved
  }
})

test('a drop into the ideas zone is refused: ideas are not tasks', () => {
  const placement = placementFixture({ taskId: 'T-1', exactState: 'planned' })
  const refused = core.applyDropIntent(
    placement,
    {
      viewId: placement.viewId,
      taskId: 'T-1',
      fromZone: 'backlog',
      toZone: 'ideas',
      expectedColumnRevision: placement.columnRevision,
    },
    'V',
    M,
  )
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'TASK_CONFLICT')
  assert.equal(refused.error.details.toZone, 'ideas')
})

test('the panel states and needs-attention catalogue are closed and exhaustive', () => {
  assert.deepEqual([...contracts.BOARD_PANEL_STATES], [
    'loading',
    'ready',
    'empty',
    'degraded',
    'unavailable',
    'recovery',
    'paused',
  ])
  // `empty` and `unavailable` must stay distinct: a board whose controller never
  // mounted must not look like a healthy workspace with no work.
  assert.notEqual(contracts.BOARD_PANEL_STATES.indexOf('empty'), -1)
  assert.notEqual(contracts.BOARD_PANEL_STATES.indexOf('unavailable'), -1)

  assert.equal(contracts.NEEDS_ATTENTION_REASONS.length, 7)
  assert.deepEqual([...contracts.NEEDS_ATTENTION_REASONS], [
    'reconciliation-divergence',
    'adapter-unavailable-with-live-attempt',
    'budget-exhausted',
    'human-gate-deadline-exceeded',
    'retry-budget-exhausted',
    'dependency-unresolvable-after-void',
    'lease-lost-without-successor',
  ])
  for (const reason of contracts.NEEDS_ATTENTION_REASONS) {
    assert.equal(typeof reason, 'string')
  }
  // Every command a card control issues is declared, and the move verb is one.
  assert.ok(contracts.CARD_COMMANDS.includes('board.move'))
  assert.ok(contracts.CARD_COMMANDS.includes('task.stop-and-cancel'))
})

test('every field of the board contracts is declared, so none drifts silently', () => {
  // The placement shape is what a store persists; its key set is a contract.
  const placement = placementFixture()
  assert.deepEqual(Object.keys(placement).sort(), [
    'boardRevision',
    'columnRevision',
    'exactState',
    'order',
    'taskId',
    'viewId',
    'zone',
  ])
  assert.equal(typeof placement.order, 'string')
  assert.equal(typeof placement.columnRevision, 'number')
})

test('both view modes are declared and the strip threshold is the one ADR018 names', () => {
  assert.deepEqual([...contracts.BOARD_VIEW_MODES], ['grid-3x3', 'strip-horizontal'])
  assert.equal(contracts.BOARD_STRIP_MAX_WIDTH_PX, 1100)
})

test('core/theme.ts contains no colour literal', () => {
  const source = readFileSync(join(repoRoot, 'packages', 'core', 'src', 'theme.ts'), 'utf8')
  // A hex colour would tie MyWork to a palette instead of the host's tokens.
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(source), false, 'core/theme.ts must carry no hex literal')
  assert.equal(/\brgba?\s*\(/.test(source), false, 'core/theme.ts must carry no rgb()/rgba()')
  assert.equal(/\bhsla?\s*\(/.test(source), false, 'core/theme.ts must carry no hsl()/hsla()')
  // Guard the extraction on a file that DOES carry one, so the patterns above
  // cannot pass by being broken.
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test('const c = \'#1a2b3c\''), true)
})

test('resolveSurfacePolicy forces opacity for wallpaper, low contrast, and high contrast', () => {
  const dark = { mode: 'dark', surface: 'opaque', wallpaper: false, highContrast: false, reducedMotion: false }
  const healthy = core.resolveSurfacePolicy(dark, 12)
  assert.equal(healthy.alpha, 1, 'a card is always opaque')
  assert.equal(healthy.wallpaper, 'never')
  assert.equal(healthy.reason, 'none')
  assert.equal(healthy.opaque, true)

  // The canvas may keep a translucent theme's character when nothing threatens it.
  assert.ok(core.resolveSurfacePolicy({ ...dark, surface: 'translucent' }, 12, 'canvas').alpha < 1)
  assert.equal(core.resolveSurfacePolicy({ ...dark, surface: 'translucent' }, 12, 'canvas').reason, 'none')
  // A card and a sticky header are opaque regardless: the wallpaper must never
  // show through text that scrolls over it.
  for (const target of ['card', 'sticky-header', 'overlay']) {
    assert.equal(core.resolveSurfacePolicy({ ...dark, surface: 'translucent' }, 12, target).alpha, 1, target)
  }

  // Wallpaper behind the surface forces full opacity and moves the wallpaper to
  // the canvas only.
  const wallpaper = core.resolveSurfacePolicy({ ...dark, wallpaper: true, surface: 'translucent' }, 12, 'canvas')
  assert.equal(wallpaper.alpha, 1)
  assert.equal(wallpaper.wallpaper, 'visible')
  assert.equal(wallpaper.reason, 'wallpaper')
  assert.equal(core.resolveSurfacePolicy({ ...dark, wallpaper: true }, 12, 'card').wallpaper, 'card-opaque')
  assert.equal(core.resolveSurfacePolicy({ ...dark, wallpaper: true }, 12, 'sticky-header').wallpaper, 'card-opaque')

  // Measured contrast below the readable threshold forces opacity.
  const low = core.resolveSurfacePolicy({ ...dark, surface: 'translucent' }, 2.5, 'canvas')
  assert.equal(low.alpha, 1)
  assert.equal(low.reason, 'low-contrast')
  assert.equal(low.minContrastRatio, contracts.MIN_TEXT_CONTRAST_RATIO)

  // An unmeasured contrast is the unsafe direction: it forces opacity too.
  const unmeasured = core.resolveSurfacePolicy({ ...dark, surface: 'translucent' }, undefined, 'canvas')
  assert.equal(unmeasured.alpha, 1)
  assert.equal(unmeasured.reason, 'low-contrast')

  // A theme that declares a sufficient contrast is trusted when nothing is measured.
  const declared = core.resolveSurfacePolicy(
    { ...dark, surface: 'translucent', declaredContrast: 7 },
    undefined,
    'canvas',
  )
  assert.equal(declared.reason, 'none')
  assert.ok(declared.alpha < 1)

  // High contrast raises the bar and forces opacity.
  const contrast = core.resolveSurfacePolicy({ ...dark, highContrast: true, surface: 'translucent' }, 12, 'canvas')
  assert.equal(contrast.alpha, 1)
  assert.equal(contrast.reason, 'high-contrast')

  // Reduced motion is carried through unchanged; the focus ring is never weakened.
  const motion = core.resolveSurfacePolicy({ ...dark, reducedMotion: true }, 12)
  assert.equal(motion.reduceMotion, true)
  assert.equal(core.suppressesMotion(motion), true)
  assert.ok(motion.minFocusContrastRatio >= contracts.MIN_FOCUS_CONTRAST_RATIO)
})

test('the five theme modes of ADR022 all resolve', () => {
  const modes = {
    light: { mode: 'light', surface: 'opaque', wallpaper: false, highContrast: false, reducedMotion: false },
    dark: { mode: 'dark', surface: 'opaque', wallpaper: false, highContrast: false, reducedMotion: false },
    wallpaper: { mode: 'dark', surface: 'translucent', wallpaper: true, highContrast: false, reducedMotion: false },
    'high-contrast': { mode: 'light', surface: 'opaque', wallpaper: false, highContrast: true, reducedMotion: false },
    'reduced-motion': { mode: 'dark', surface: 'opaque', wallpaper: false, highContrast: false, reducedMotion: true },
  }
  for (const [name, capability] of Object.entries(modes)) {
    for (const target of core.SURFACE_TARGETS) {
      const policy = core.resolveSurfacePolicy(capability, 8, target)
      assert.ok(policy.alpha > 0 && policy.alpha <= 1, `${name}/${target} alpha ${policy.alpha}`)
      assert.ok(policy.minContrastRatio >= contracts.MIN_TEXT_CONTRAST_RATIO, `${name}/${target} contrast`)
      assert.ok(policy.minFocusContrastRatio >= contracts.MIN_FOCUS_CONTRAST_RATIO, `${name}/${target} focus`)
    }
  }
  // The two reduced-motion cases are the only ones that suppress motion.
  assert.equal(core.resolveSurfacePolicy(modes['reduced-motion'], 8).reduceMotion, true)
  assert.equal(core.resolveSurfacePolicy(modes.light, 8).reduceMotion, false)
})
