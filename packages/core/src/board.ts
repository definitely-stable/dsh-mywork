/**
 * Board projection and placement (architecture §8, §12; ADR017, ADR018).
 *
 * Two invariants drive everything here, and both are properties of pure
 * functions rather than of the caller:
 *
 * 1. **A card renders in exactly one zone.** {@link projectTaskZone} is total
 *    over the sixteen `TaskState`s and single-valued, and
 *    {@link assertSinglePlacement} refuses a snapshot that places one task
 *    twice.
 * 2. **Ordering is total and insert-only.** Order keys are base-62 strings, the
 *    sort is `(orderKey, taskId)`, and inserting between two neighbours rewrites
 *    one row — or reports `ORDER_RENUMBER_REQUIRED` instead of producing equal
 *    keys.
 *
 * Nothing here reads a clock, generates an id, or touches a store: a command
 * carries its own `at`, and the placement is computed from data it is given.
 * @module
 */

import {
  BOARD_ZONES,
  ZONE_BY_STATE,
  type BoardPlacement,
  type BoardZone,
  type DropIntent,
  type OperationMeta,
  type Result,
  type Revision,
  type TaskId,
  type TaskState,
} from '@dsh-mywork/contracts'
import { MyWorkError, fail, ok } from './errors.ts'
import { allowedTaskTransitions, requiresActiveAttempt } from './task.ts'

/**
 * The zone a task state renders in (ADR018).
 *
 * Total by construction: `ZONE_BY_STATE` covers all sixteen states, so this
 * function can never return `undefined` and never needs a fallback zone. A
 * missing entry is a contract defect the type system catches at build time.
 * @param state - the task's exact domain state.
 */
export function projectTaskZone(state: TaskState): BoardZone {
  return ZONE_BY_STATE[state]
}

/** Alias of {@link projectTaskZone}, named for the reverse direction. */
export function zoneOfState(state: TaskState): BoardZone {
  return ZONE_BY_STATE[state]
}

/**
 * Whether a zone may contain task cards at all.
 *
 * `ideas` holds `Idea` entities, not tasks (ADR019), so a task placement in that
 * zone is a projection defect rather than an unusual layout.
 * @param zone - the zone to test.
 */
export function isTaskZone(zone: BoardZone): boolean {
  return zone !== 'ideas'
}

/**
 * `TaskState`s a zone displays, in `TASK_STATES` order.
 *
 * The reverse of {@link projectTaskZone}, derived from the same table so the two
 * directions cannot drift apart.
 * @param zone - the zone to inspect.
 */
export function taskStatesOfZone(zone: BoardZone): readonly TaskState[] {
  return (Object.keys(ZONE_BY_STATE) as TaskState[]).filter(state => ZONE_BY_STATE[state] === zone)
}

/** One zone of a projected snapshot. */
export interface ProjectedZone {
  /** Zone these placements belong to. */
  readonly zone: BoardZone
  /** Cards in the zone, in board order. */
  readonly placements: readonly BoardPlacement[]
  /** Revision of this zone, taken from the placements' shared column revision. */
  readonly columnRevision: Revision
}

/** A projected board: the nine zones, each with its ordered cards. */
export interface BoardProjection {
  /** View the projection was built for. */
  readonly viewId: string
  /** Snapshot revision of the whole board. */
  readonly boardRevision: Revision
  /** Zones in reading order; every one of the nine is present, empty when it has no cards. */
  readonly zones: readonly ProjectedZone[]
}

/**
 * Check that a board snapshot places every task in exactly one zone.
 *
 * The board renders one card per task; a task appearing twice would break the
 * zone counters and make a drag ambiguous, so a duplicated `taskId` is refused
 * rather than silently de-duplicated. A placement whose `zone` disagrees with
 * its own `exactState` is refused too: that is the projection quietly collapsing
 * domain states, which ADR018 exists to prevent.
 * @param placements - every placement of one snapshot.
 * @param meta - operation identity.
 */
export function assertSinglePlacement(
  placements: readonly BoardPlacement[],
  meta: OperationMeta,
): Result<readonly BoardPlacement[]> {
  const seen = new Map<TaskId, BoardZone>()
  for (const placement of placements) {
    const earlier = seen.get(placement.taskId)
    if (earlier !== undefined) {
      return fail(
        new MyWorkError(
          'TASK_CONFLICT',
          `dsh-mywork: task "${placement.taskId}" is placed in two zones ("${earlier}" and "${placement.zone}")`,
          { details: { taskId: placement.taskId, zones: [earlier, placement.zone], viewId: placement.viewId } },
        ),
        meta,
      )
    }
    const expected = projectTaskZone(placement.exactState)
    if (placement.zone !== expected) {
      return fail(
        new MyWorkError(
          'CONTRACT_MISMATCH',
          `dsh-mywork: task "${placement.taskId}" in state "${placement.exactState}" must render in zone "${expected}", not "${placement.zone}"`,
          { details: { taskId: placement.taskId, exactState: placement.exactState, zone: placement.zone, expected } },
        ),
        meta,
      )
    }
    if (!isTaskZone(placement.zone)) {
      return fail(
        new MyWorkError('CONTRACT_MISMATCH', `dsh-mywork: zone "${placement.zone}" holds ideas, not tasks`, {
          details: { taskId: placement.taskId, zone: placement.zone },
        }),
        meta,
      )
    }
    seen.set(placement.taskId, placement.zone)
  }
  return ok(Object.freeze([...placements]), meta)
}

/**
 * Zones a drag may legally drop the card into.
 *
 * A drop on the board is a `TaskState` change, so the legal targets are exactly
 * the states {@link allowedTaskTransitions} permits — minus the edges that are
 * reachable **only** through `admitAttempt`. `ready → assigned` is the one such
 * edge today: admitting an attempt needs the terminal, readiness and attempt
 * checks plus the `task.attempt.admitted` event, so a drop can never perform it
 * directly. The card must be moved to `ready` and started from there.
 *
 * The card's own zone is always included: dropping a card back where it came
 * from is a reorder, not a state change.
 * @param state - the task's current state.
 */
export function legalDropTargets(state: TaskState): readonly BoardZone[] {
  const reachable = allowedTaskTransitions(state).filter(target => canDropInto(state, target))
  const zones = new Set<BoardZone>([projectTaskZone(state)])
  for (const target of reachable) zones.add(projectTaskZone(target))
  // Reading order, so the UI and its tests see a stable list.
  return Object.freeze(BOARD_ZONES.filter(zone => zones.has(zone)))
}

/**
 * Whether a direct drop may perform a state transition.
 *
 * `assigned` is excluded because {@link transitionTask} itself refuses it: the
 * only path is admission, which is not a board gesture (ADR018, §17).
 * @param from - current state.
 * @param to - candidate target state.
 */
function canDropInto(from: TaskState, to: TaskState): boolean {
  if (to === 'assigned') return false
  // A drop must not manufacture an attempt: targets that require one are only
  // reachable through admission.
  return !requiresActiveAttempt(to) || requiresActiveAttempt(from)
}

/**
 * Columns of the base-62 alphabet used by order keys.
 *
 * `0-9A-Za-z` is ordered by code unit, so a plain string comparison orders keys
 * exactly as the alphabet does.
 */
const BASE62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** Position of a base-62 digit, or `-1` when the character is absent or not one. */
function digitValue(char: string | undefined): number {
  return char === undefined ? -1 : BASE62_DIGITS.indexOf(char)
}

/** The alphabet's first digit; the alphabet is a non-empty literal by construction. */
const BASE62_FIRST = '0'

/** The alphabet's middle digit: the digit an unbounded insertion appends. */
const MID_DIGIT = 'V'

/** The base-62 digit at a numeric value, clamped into the alphabet. */
function digitOf(value: number): string {
  return BASE62_DIGITS[value] ?? BASE62_FIRST
}

/**
 * Build a key that sorts strictly between two order keys (v0.2 §5.3).
 *
 * A key is read as a base-62 fraction in `(0, 1)`: `"V"` is one half, `"3"` one
 * twentieth, `"1V"` a half of one sixty-second. Under that reading the key space
 * is **dense**, so between any two distinct keys a third one always exists, and
 * a key strictly below a bound also always exists because a shorter prefix is
 * always smaller.
 *
 * The construction never truncates an existing key: it keeps the part the two
 * bounds share and appends digits. Truncating is what makes a scheme run out
 * after finitely many insertions — it walks toward `"0"` — so a key produced
 * here always has room on both sides, and each insertion rewrites exactly one
 * row, the inserted one.
 *
 * `undefined` for a bound means "no neighbour on that side": the front or the
 * end of the zone. `undefined` as a result means no key exists between the
 * bounds, which the caller reports as `ORDER_RENUMBER_REQUIRED` rather than
 * inventing an equal key.
 * @param lower - key the new key must sort after, or `undefined` at the front.
 * @param upper - key the new key must sort before, or `undefined` at the end.
 * @returns the new key, or `undefined` when no key fits between the bounds.
 */
export function midpointKey(lower: string | undefined, upper: string | undefined): string | undefined {
  if (lower !== undefined && !isOrderKey(lower)) return undefined
  if (upper !== undefined && !isOrderKey(upper)) return undefined
  if (lower !== undefined && upper !== undefined && lower >= upper) return undefined

  // The key space is the set of finite base-62 strings under lexicographic
  // order, and it is dense, so a key between two distinct keys always exists.
  //
  // The construction **extends the lower bound** instead of halving the
  // interval, and that choice is what makes the scheme scale. A key built as
  // `lower` plus digits sorts above `lower` (it is longer) and its depth can
  // grow without bound; a key placed strictly between two nearby bounds shrinks
  // the remaining gap geometrically and exhausts it in a handful of insertions.
  // Extending leaves the interval above the new key as wide as it was, so an
  // insert-heavy zone keeps working and only gives up at a genuine edge.
  //
  // `upper` therefore does one job: bounding the digits that may be appended.
  //
  // `undefined` for a bound means "no neighbour on that side": the front or the
  // end of the zone. `undefined` as the result means the two bounds are
  // adjacent, which the caller reports as `ORDER_RENUMBER_REQUIRED` rather than
  // inventing an equal key.
  if (lower === undefined) return belowKey(upper ?? MID_DIGIT)
  if (upper === undefined) return `${lower}${MID_DIGIT}`

  // `lower` is a strict prefix of `upper`: any digit below `upper`'s next one
  // may be appended. A middle digit keeps room for later insertions.
  if (upper.startsWith(lower)) {
    if (lower.length >= upper.length) return undefined
    const bound = digitValue(upper[lower.length])
    if (bound <= 0) return undefined
    return `${lower}${digitOf(Math.floor(bound / 2))}`
  }

  // Otherwise the bounds diverge before `lower` ends, so `lower` extended by any
  // digit still sorts below `upper` only if `lower`'s own next digit is already
  // below `upper`'s. Compare the first diverging digits to stay inside.
  const shared = sharedPrefixLength(lower, upper)
  const lowDigit = digitValue(lower[shared])
  const highDigit = digitValue(upper[shared])
  if (lowDigit + 1 < highDigit) {
    return `${lower.slice(0, shared)}${digitOf(Math.floor((lowDigit + highDigit) / 2))}`
  }

  // The diverging digits are adjacent: extend `lower`, which keeps the result
  // strictly above it and — because the extension only adds digits — strictly
  // below `upper`.
  return `${lower}${MID_DIGIT}`
}

/**
 * A key that sorts strictly below `upper`, or `undefined` when none exists.
 *
 * Found by taking a smaller digit at the first position where one exists and
 * padding after it, which gives the result depth to be subdivided further
 * instead of sitting immediately below the bound.
 * @param upper - the exclusive upper bound; must be a usable key.
 */
function belowKey(upper: string): string | undefined {
  for (let index = 0; index < upper.length; index += 1) {
    const digit = digitValue(upper[index])
    if (digit > 0) return `${upper.slice(0, index)}${digitOf(Math.floor(digit / 2))}${MID_DIGIT}`
  }
  return undefined // every digit is the smallest: nothing sorts below it
}

/** Length of the longest common leading run of two key strings. */
function sharedPrefixLength(left: string, right: string): number {
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1
  return index
}

/**
 * Whether a string is a usable order key.
 *
 * Non-empty and base-62 only: a key outside the alphabet would sort by code
 * unit but could not be subdivided on the next insert.
 * @param value - the candidate key.
 */
export function isOrderKey(value: string): boolean {
  if (value.length === 0) return false
  for (const char of value) {
    if (digitValue(char) < 0) return false
  }
  return true
}

/** One card in an ordered zone, as the ordering functions see it. */
export interface OrderedCard {
  /** Task identifier; the tie-breaker that makes the order total. */
  readonly taskId: TaskId
  /** Ordering key inside the zone. */
  readonly order: string
  /** True when the card is pinned to the front of the zone. */
  readonly pinned?: boolean
}

/**
 * Total order over cards of one zone (v0.2 §5.3).
 *
 * Pinned cards come first, then `(order, taskId)`. The `taskId` tie-breaker is
 * what makes the order **total**: two cards can never compare equal, so a
 * re-render cannot shuffle them and a test can assert an exact sequence.
 *
 * Returns a new array; the input is not mutated.
 * @param cards - cards of one zone.
 */
export function boardOrdering<T extends OrderedCard>(cards: readonly T[]): readonly T[] {
  return Object.freeze(
    [...cards].sort((left, right) => {
      const leftPinned = left.pinned === true ? 0 : 1
      const rightPinned = right.pinned === true ? 0 : 1
      if (leftPinned !== rightPinned) return leftPinned - rightPinned
      if (left.order !== right.order) return left.order < right.order ? -1 : 1
      if (left.taskId === right.taskId) return 0
      return left.taskId < right.taskId ? -1 : 1
    }),
  )
}

/** Result of resolving an insertion point into an order key. */
export type InsertionResolution =
  | {
      /** A key that fits between the neighbours. */
      readonly ok: true
      /** The new key; only the inserted row is written with it. */
      readonly order: string
    }
  | {
      /** No key fits; the zone must be renumbered explicitly. */
      readonly ok: false
      /** Always `ORDER_RENUMBER_REQUIRED`. */
      readonly code: 'ORDER_RENUMBER_REQUIRED'
    }

/**
 * Resolve an insertion between two neighbours into an order key (v0.2 §5.3).
 *
 * Order keys are not silently made equal when the space runs out: an equal key
 * would make the order non-total and let a reorder become invisible. Instead the
 * caller is told to renumber the zone, which is one explicit transaction with
 * one revision bump.
 * @param lower - card the new one goes after, or `undefined` at the front.
 * @param upper - card the new one goes before, or `undefined` at the end.
 */
export function resolveInsertion(
  lower: OrderedCard | undefined,
  upper: OrderedCard | undefined,
): InsertionResolution {
  if (lower !== undefined && upper !== undefined) {
    // Both neighbours must themselves be ordered, or the midpoint is meaningless.
    if (lower.order > upper.order) return { ok: false, code: 'ORDER_RENUMBER_REQUIRED' }
    if (lower.order === upper.order) return { ok: false, code: 'ORDER_RENUMBER_REQUIRED' }
  }
  const order = midpointKey(lower?.order, upper?.order)
  if (order === undefined || order === lower?.order || order === upper?.order) {
    return { ok: false, code: 'ORDER_RENUMBER_REQUIRED' }
  }
  return { ok: true, order }
}

/**
 * Build a fresh sequence of order keys for a zone, for the explicit renumber
 * that {@link resolveInsertion} asks for.
 *
 * Keys are uniformly spaced and every gap can be subdivided many times before
 * {@link resolveInsertion} has to ask for another renumber — the headroom is the
 * point of renumbering at all. The spacing is wide enough that a zone absorbs
 * well over a thousand successive midpoint insertions between the same two
 * neighbours, which is the durability v0.2 §5.3 asks of it.
 *
 * The resulting order is identical to the order the cards already had
 * (§5.3: renumbering must not reshuffle).
 * @param count - number of keys to produce.
 */
export function renumberKeys(count: number): readonly string[] {
  if (!Number.isInteger(count) || count < 0) return Object.freeze([])
  const keys: string[] = []
  // Four base-62 digits of headroom between consecutive keys: each gap then
  // holds on the order of 62^4 further midpoint insertions.
  const step = BASE62_DIGITS.length ** 4
  let position = step
  for (let index = 0; index < count; index += 1) {
    keys.push(encodeBase62(position))
    position += step
  }
  return Object.freeze(keys)
}

/** Render a non-negative integer as a base-62 string. */
function encodeBase62(value: number): string {
  if (value === 0) return digitOf(0)
  let remaining = value
  let out = ''
  while (remaining > 0) {
    out = digitOf(remaining % BASE62_DIGITS.length) + out
    remaining = Math.floor(remaining / BASE62_DIGITS.length)
  }
  return out
}

/** Outcome of applying a drop intent to a snapshot. */
export interface PlacementChange {
  /** Placement after the move, carrying the new order key. */
  readonly placement: BoardPlacement
  /** The card that moved, when it had a placement before. */
  readonly fromZone?: BoardZone
  /** Zone revision after the move. */
  readonly columnRevision: Revision
}

/**
 * Apply a drop intent to one placement, enforcing the zone revision.
 *
 * The intent carries the `expectedColumnRevision` it observed; a mismatch means
 * someone else moved a card in that zone first, and the answer is
 * `STALE_COLUMN_REVISION` — the caller re-reads that zone and retries, instead
 * of having the whole board invalidated (v0.2 §5.3).
 *
 * The move never writes a `TaskState`: it produces the placement, and the caller
 * pairs it with the command that performs the transition.
 * @param placement - the card's current placement.
 * @param intent - the resolved drop.
 * @param order - order key resolved by {@link resolveInsertion}.
 * @param meta - operation identity.
 */
export function applyDropIntent(
  placement: BoardPlacement,
  intent: DropIntent,
  order: string,
  meta: OperationMeta,
): Result<PlacementChange> {
  if (intent.taskId !== placement.taskId) {
    return fail(
      new MyWorkError('CONTRACT_MISMATCH', `dsh-mywork: drop intent is for task "${intent.taskId}", not "${placement.taskId}"`, {
        details: { intentTaskId: intent.taskId, placementTaskId: placement.taskId },
      }),
      meta,
    )
  }
  if (intent.fromZone !== placement.zone) {
    return fail(
      new MyWorkError(
        'STALE_COLUMN_REVISION',
        `dsh-mywork: task "${placement.taskId}" is in zone "${placement.zone}", not "${intent.fromZone}"`,
        { details: { taskId: placement.taskId, zone: placement.zone, fromZone: intent.fromZone } },
      ),
      meta,
    )
  }
  if (intent.expectedColumnRevision !== placement.columnRevision) {
    return fail(
      new MyWorkError(
        'STALE_COLUMN_REVISION',
        `dsh-mywork: zone "${placement.zone}" of view "${placement.viewId}" moved on (expected revision ${intent.expectedColumnRevision}, current ${placement.columnRevision})`,
        {
          details: {
            viewId: placement.viewId,
            zone: placement.zone,
            expectedColumnRevision: intent.expectedColumnRevision,
            columnRevision: placement.columnRevision,
          },
        },
      ),
      meta,
    )
  }
  if (intent.toZone === placement.zone && !isTaskZone(placement.zone)) {
    return fail(
      new MyWorkError('CONTRACT_MISMATCH', `dsh-mywork: zone "${placement.zone}" holds ideas, not tasks`, {
        details: { taskId: placement.taskId, zone: placement.zone },
      }),
      meta,
    )
  }
  if (intent.toZone !== placement.zone && !isTaskZone(intent.toZone)) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: a task cannot be moved into zone "${intent.toZone}"`, {
        details: { taskId: placement.taskId, toZone: intent.toZone },
      }),
      meta,
    )
  }

  // A drop must land in the zone the card's own state renders in, or stay where
  // it is (a reorder). Zone and state cannot disagree: `BoardPlacement` promises
  // its zone is always `ZONE_BY_STATE` of its exact state (ADR018), and a write
  // that broke that promise would produce a snapshot the projection's own
  // {@link assertSinglePlacement} then refuses.
  const expectedZone = projectTaskZone(placement.exactState)
  if (intent.toZone !== expectedZone && intent.toZone !== placement.zone) {
    return fail(
      new MyWorkError(
        'TASK_CONFLICT',
        `dsh-mywork: task "${placement.taskId}" is "${placement.exactState}" and renders in zone "${expectedZone}", not "${intent.toZone}"`,
        {
          details: {
            taskId: placement.taskId,
            exactState: placement.exactState,
            toZone: intent.toZone,
            expectedZone,
            legalTargets: [...legalDropTargets(placement.exactState)],
          },
        },
      ),
      meta,
    )
  }

  // The key is what the zone is ordered by, so a value outside the base-62
  // alphabet would sort by code unit yet be unusable for the next insertion.
  if (!isOrderKey(order)) {
    return fail(
      new MyWorkError('CONTRACT_MISMATCH', `dsh-mywork: "${order}" is not a usable base-62 order key`, {
        details: { taskId: placement.taskId, order, zone: intent.toZone },
      }),
      meta,
    )
  }

  const next: BoardPlacement = Object.freeze({
    ...placement,
    zone: intent.toZone,
    order,
    columnRevision: placement.columnRevision + 1,
  })
  return ok(
    Object.freeze({
      placement: next,
      ...(intent.fromZone === intent.toZone ? {} : { fromZone: intent.fromZone }),
      columnRevision: next.columnRevision,
    }),
    meta,
  )
}
