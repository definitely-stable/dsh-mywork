/**
 * Task-graph state and priority mapping (architecture §8, §11; ADR023).
 *
 * Beads and MyWork describe the same work in different vocabularies, and the
 * translation is the one place a mistake is silent: a state mapped to the wrong
 * category lets a task start too early, and a priority inverted twice lets the
 * wrong work run first. Both directions therefore live here as pure functions
 * over frozen tables, so they are testable without a backend and a round-trip is
 * a property rather than a hope.
 *
 * This module lives in the adapter, not in `@dsh-mywork/core`, on purpose:
 * §36/§44 require the domain to carry no provider name, so the vocabulary of a
 * concrete backend belongs to the package that binds it.
 *
 * The backend side is deliberately expressed as data with its category, because
 * readiness is decided by the category, not by the status name: a `wip` status
 * never appears in a readiness query and a `frozen` status never satisfies a
 * dependency (both confirmed against the real backend — see ADR023).
 * @module
 */

import type { TaskState } from '@dsh-mywork/contracts'

/**
 * Category Beads assigns a status. It is what decides readiness, so it is
 * carried alongside every mapping instead of being resolved by a name prefix.
 */
export type BeadsStatusCategory =
  /** Available to work: the only category that appears in `bd ready`. */
  | 'active'
  /** In flight: excluded from `bd ready`, and does NOT satisfy a dependency. */
  | 'wip'
  /** Held: excluded from `bd ready`, and does NOT satisfy a dependency. */
  | 'frozen'
  /** Complete: satisfies a dependency. */
  | 'done'

/** One Beads status with the category that decides its scheduling behaviour. */
export interface BeadsStatus {
  /** Status name as the backend stores it. */
  readonly name: string
  /** Category Beads assigns it in `status.custom` / its built-in table. */
  readonly category: BeadsStatusCategory
}

/**
 * The ten ADR023 custom statuses with their categories, in the order the ADR
 * lists them.
 *
 * These are the statuses MyWork pins into `status.custom`; the adapter's Doctor
 * compares this table against the live configuration, so the expected set is
 * declared once here rather than spelled out at each call site.
 */
export const ADR023_STATUSES: readonly BeadsStatus[] = Object.freeze([
  Object.freeze({ name: 'mw_draft', category: 'wip' }),
  Object.freeze({ name: 'mw_planned', category: 'wip' }),
  Object.freeze({ name: 'mw_in_review', category: 'wip' }),
  Object.freeze({ name: 'mw_approved', category: 'wip' }),
  Object.freeze({ name: 'mw_integrating', category: 'wip' }),
  Object.freeze({ name: 'mw_changes_requested', category: 'wip' }),
  Object.freeze({ name: 'mw_failed', category: 'wip' }),
  Object.freeze({ name: 'mw_needs_attention', category: 'wip' }),
  Object.freeze({ name: 'mw_cancelled', category: 'frozen' }),
  Object.freeze({ name: 'mw_superseded', category: 'frozen' }),
])

/** The `status.custom` value that installs {@link ADR023_STATUSES} exactly. */
export const ADR023_STATUS_CUSTOM: string = ADR023_STATUSES.map(
  status => `${status.name}:${status.category}`,
).join(',')

/**
 * Beads built-in statuses MyWork maps. Only the ones MyWork can produce or read
 * are listed; anything else is reported as unmapped rather than guessed at.
 */
export const BEADS_BUILTIN_STATUSES: readonly BeadsStatus[] = Object.freeze([
  Object.freeze({ name: 'open', category: 'active' }),
  Object.freeze({ name: 'in_progress', category: 'wip' }),
  Object.freeze({ name: 'blocked', category: 'wip' }),
  Object.freeze({ name: 'deferred', category: 'frozen' }),
  Object.freeze({ name: 'closed', category: 'done' }),
  Object.freeze({ name: 'pinned', category: 'frozen' }),
])

/**
 * MyWork state → the Beads status that carries it.
 *
 * The mapping is chosen so the *category* enforces the rule MyWork needs, not
 * just so the name looks right:
 *
 * - `draft`/`planned` become `mw_draft`/`mw_planned`, both `wip`, so unplanned
 *   work cannot leak into `bd ready`.
 * - `ready` becomes `open` — the one `active` status, and therefore the only
 *   state Beads offers as claimable.
 * - `reviewing` becomes `mw_in_review`, `wip`: a task under review is in flight
 *   and must not be handed to a second worker.
 * - `cancelled`/`superseded` become `frozen` statuses. This is what makes them
 *   *not* satisfy a dependency: Beads leaves the dependent blocked (ADR023),
 *   which is exactly the "blocked until MyWork decides" behaviour required.
 * - `done` becomes `closed`, the only `done` status, and the only one that
 *   releases dependents.
 */
export const TASK_STATE_TO_BEADS_STATUS: Readonly<Record<TaskState, string>> = Object.freeze({
  draft: 'mw_draft',
  planned: 'mw_planned',
  ready: 'open',
  assigned: 'in_progress',
  executing: 'in_progress',
  'awaiting-review': 'mw_in_review',
  reviewing: 'mw_in_review',
  approved: 'mw_approved',
  integrating: 'mw_integrating',
  done: 'closed',
  blocked: 'blocked',
  'changes-requested': 'mw_changes_requested',
  failed: 'mw_failed',
  cancelled: 'mw_cancelled',
  superseded: 'mw_superseded',
  'needs-attention': 'mw_needs_attention',
})

/**
 * Beads status → the MyWork state it is read back as.
 *
 * `closed` reads back as `done`, not as `approved`: Beads records completion,
 * while the approval and integration detail lives in MyWork (§8 keeps final graph
 * completion with the graph and the review attempt with MyWork DB).
 */
const BEADS_STATUS_TO_TASK_STATE: Readonly<Record<string, TaskState>> = Object.freeze({
  open: 'ready',
  in_progress: 'executing',
  blocked: 'blocked',
  deferred: 'blocked',
  pinned: 'needs-attention',
  closed: 'done',
  mw_draft: 'draft',
  mw_planned: 'planned',
  mw_in_review: 'reviewing',
  mw_approved: 'approved',
  mw_integrating: 'integrating',
  mw_changes_requested: 'changes-requested',
  mw_failed: 'failed',
  mw_needs_attention: 'needs-attention',
  mw_cancelled: 'cancelled',
  mw_superseded: 'superseded',
})

/** Lowest Beads priority value; in Beads `0` is the highest. */
export const BEADS_PRIORITY_MIN = 0

/** Highest Beads priority value. */
export const BEADS_PRIORITY_MAX = 4

/**
 * Invert a Beads priority into a MyWork priority (ADR023).
 *
 * Beads puts `0` first; MyWork orders higher-first, as §8 stores it. The mapping
 * is the order-reversing bijection `4 - p`, so the two ends swap and the middle
 * stays put.
 * @param bdPriority - Beads priority in `0..4`.
 * @throws {RangeError} when the value is outside `0..4` or is not an integer.
 */
export function priorityFromBeads(bdPriority: number): number {
  if (!Number.isInteger(bdPriority) || bdPriority < BEADS_PRIORITY_MIN || bdPriority > BEADS_PRIORITY_MAX) {
    throw new RangeError(
      `dsh-mywork: Beads priority must be an integer in ${BEADS_PRIORITY_MIN}..${BEADS_PRIORITY_MAX}, received ${String(bdPriority)}`,
    )
  }
  return BEADS_PRIORITY_MAX - bdPriority
}

/**
 * Invert a MyWork priority into a Beads priority.
 * @param myworkPriority - MyWork priority (higher first) in `0..4`.
 * @throws {RangeError} when the value is outside `0..4` or is not an integer.
 */
export function priorityToBeads(myworkPriority: number): number {
  if (
    !Number.isInteger(myworkPriority) ||
    myworkPriority < BEADS_PRIORITY_MIN ||
    myworkPriority > BEADS_PRIORITY_MAX
  ) {
    throw new RangeError(
      `dsh-mywork: MyWork priority must be an integer in ${BEADS_PRIORITY_MIN}..${BEADS_PRIORITY_MAX}, received ${String(myworkPriority)}`,
    )
  }
  return BEADS_PRIORITY_MAX - myworkPriority
}

/**
 * Read an optional priority the way a task record carries it.
 *
 * An absent priority stays absent rather than becoming a default: inventing a
 * medium value would make an unstated priority indistinguishable from a stated
 * one, and §8 puts priority under the graph's authority.
 * @param bdPriority - Beads priority, or `undefined`/`null` when unset.
 * @returns the inverted priority, or `undefined` when the backend had none.
 * @throws {RangeError} when a present value is outside `0..4`.
 */
export function optionalPriorityFromBeads(bdPriority: number | null | undefined): number | undefined {
  if (bdPriority === undefined || bdPriority === null) return undefined
  return priorityFromBeads(bdPriority)
}

/**
 * The Beads status that carries a MyWork state.
 * @param state - MyWork state.
 * @throws {TypeError} when the state has no mapped status.
 */
export function beadsStatusOf(state: TaskState): string {
  const status = TASK_STATE_TO_BEADS_STATUS[state]
  if (status === undefined) {
    throw new TypeError(`dsh-mywork: task state "${String(state)}" has no Beads status`)
  }
  return status
}

/**
 * The MyWork state a Beads status reads back as.
 * @param status - Beads status name.
 * @returns the mapped state, or `undefined` for a status MyWork does not model.
 */
export function taskStateOfBeads(status: string): TaskState | undefined {
  return BEADS_STATUS_TO_TASK_STATE[status]
}

/**
 * Every Beads status one MyWork state maps *from*, in reverse-lookup order.
 *
 * Several MyWork states share a Beads status (`assigned` and `executing` are both
 * `in_progress`), so this is a set, not a bijection, and callers that need to
 * recognise a status they just wrote must use {@link beadsStatusOf} instead.
 * @param state - MyWork state.
 */
export function beadsStatusesFor(state: TaskState): readonly string[] {
  return Object.freeze(
    Object.entries(TASK_STATE_TO_BEADS_STATUS)
      .filter(([, status]) => status === beadsStatusOf(state))
      .map(([candidate]) => candidate),
  )
}

/**
 * Whether a Beads status satisfies a dependency.
 *
 * Only `done` does. The `frozen` category is explicitly *not* satisfying even
 * though it is terminal-looking for a human: ADR023 requires a dependent of a
 * cancelled task to stay blocked until MyWork asks for an explicit decision, and
 * this function is the single place that rule is stated.
 * @param status - Beads status name.
 * @param category - category Beads reports for it; looked up when absent.
 */
export function satisfiesDependency(status: string, category?: BeadsStatusCategory): boolean {
  const resolved = category ?? categoryOfBeadsStatus(status)
  return resolved === 'done'
}

/**
 * Category Beads reports for a status, from the built-in and ADR023 tables.
 * @param status - Beads status name.
 * @returns the category, or `undefined` for an unknown status.
 */
export function categoryOfBeadsStatus(status: string): BeadsStatusCategory | undefined {
  const declared = ADR023_STATUSES.find(entry => entry.name === status)
  if (declared !== undefined) return declared.category
  return BEADS_BUILTIN_STATUSES.find(entry => entry.name === status)?.category
}

/** One status the live configuration is missing, or whose category differs. */
export interface StatusCustomGap {
  /** Status name ADR023 requires. */
  readonly name: string
  /** Category ADR023 requires. */
  readonly expected: BeadsStatusCategory
  /** Category actually configured; absent when the status is not configured at all. */
  readonly actual?: BeadsStatusCategory
}

/**
 * Compare a live `status.custom` set against the ten statuses ADR023 requires.
 *
 * A status counts as present only when its **category matches too**: the category
 * is what decides readiness, so `mw_cancelled:wip` would silently make a
 * cancelled task claimable, which is worse than the status being absent. Both
 * "missing" and "wrong category" are therefore reported as gaps.
 * @param configured - status name → category, as the backend reports it.
 * @returns the gaps, in ADR023 order; empty when the set is complete.
 */
export function statusCustomGaps(
  configured: Readonly<Record<string, BeadsStatusCategory>>,
): readonly StatusCustomGap[] {
  return Object.freeze(
    ADR023_STATUSES.flatMap(required => {
      const actual = configured[required.name]
      if (actual === required.category) return []
      return [
        Object.freeze(
          actual === undefined
            ? { name: required.name, expected: required.category }
            : { name: required.name, expected: required.category, actual },
        ),
      ]
    }),
  )
}

/**
 * Parse a raw `status.custom` configuration value (`name:category,...`).
 *
 * A malformed entry is skipped rather than guessed at, so it surfaces later as a
 * gap for that status instead of quietly becoming whichever category the parser
 * felt like.
 * @param raw - the configuration string.
 * @returns status name → category for every well-formed entry.
 */
export function parseStatusCustom(raw: string | undefined): Readonly<Record<string, BeadsStatusCategory>> {
  const parsed: Record<string, BeadsStatusCategory> = {}
  if (raw === undefined) return Object.freeze(parsed)
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (trimmed === '') continue
    const separator = trimmed.lastIndexOf(':')
    if (separator <= 0) continue
    const name = trimmed.slice(0, separator).trim()
    const category = trimmed.slice(separator + 1).trim()
    if (name === '' || !isBeadsStatusCategory(category)) continue
    parsed[name] = category
  }
  return Object.freeze(parsed)
}

/**
 * Whether a string is a category Beads accepts.
 * @param value - candidate category.
 */
export function isBeadsStatusCategory(value: string): value is BeadsStatusCategory {
  return value === 'active' || value === 'wip' || value === 'frozen' || value === 'done'
}
