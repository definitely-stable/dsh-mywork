/**
 * Task Board projection contracts (architecture §8, §12; ADR017, ADR018).
 *
 * The board is a **projection and control surface**, never a competing
 * authority: losing it loses no work, and it is rebuilt from the Task Graph plus
 * MyWork DB. Two rules follow and both are visible in the shapes below:
 *
 * - a zone is a **UI grouping**, not a `TaskState`. Sixteen domain states map
 *   onto nine zones, and the card always shows the exact state as a chip
 *   (ADR018);
 * - drag-and-drop writes nothing. It builds a {@link DropIntent}, which resolves
 *   into a MyWork command and can be refused (ADR017).
 *
 * The mapping table and the projection itself are pure domain logic in
 * `@dsh-mywork/core`; this package carries the vocabulary only.
 * @module
 */

import type { EpochMs, Revision, SessionId, TaskId, WorkspaceId } from './ids.ts'
import type { TaskState } from './task.ts'

/**
 * The nine visual zones (ADR018, v0.2 §1). The order is the reading order, the
 * keyboard traversal order, and the row semantics of the default 3×3 grid.
 */
export type BoardZone =
  /** Intake: ideas, which are `Idea` entities and never tasks. */
  | 'ideas'
  /** Intake queue: captured and planned tasks. */
  | 'backlog'
  /** Intake queue: dependencies satisfied, an attempt may be admitted. */
  | 'ready'
  /** Active: an attempt owns the task. */
  | 'in-progress'
  /** Active: the work is being judged or applied. */
  | 'review'
  /** Active: waiting on a dependency, a gate, or a human. */
  | 'blocked'
  /** Terminal/exception: the work failed or must be redone. */
  | 'error'
  /** Terminal/exception: accepted and complete. */
  | 'done'
  /** Terminal/exception: abandoned or replaced. */
  | 'cancelled'

/** Row a zone belongs to; rows carry the phase semantics of the 3×3 grid. */
export type BoardZoneRow = 'intake' | 'active' | 'terminal'

/**
 * The nine zones in reading order. Frozen and exhaustive: the projection, the
 * UI and the tests all iterate this constant instead of restating the list.
 */
export const BOARD_ZONES: readonly BoardZone[] = Object.freeze([
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

/** Row each zone sits in, so the 3×3 default layout needs no second table. */
export const BOARD_ZONE_ROWS: Readonly<Record<BoardZone, BoardZoneRow>> = Object.freeze({
  ideas: 'intake',
  backlog: 'intake',
  ready: 'intake',
  'in-progress': 'active',
  review: 'active',
  blocked: 'active',
  error: 'terminal',
  done: 'terminal',
  cancelled: 'terminal',
})

/**
 * Icon each zone shows (§1). Names are semantic identifiers resolved to real
 * icons by the UI layer, never markup or a font codepoint.
 */
export const BOARD_ZONE_ICONS: Readonly<Record<BoardZone, string>> = Object.freeze({
  ideas: 'lightbulb',
  backlog: 'list',
  ready: 'play',
  'in-progress': 'circle-dashed',
  review: 'eye',
  blocked: 'ban',
  error: 'alert-triangle',
  done: 'check-circle',
  cancelled: 'circle-slash',
})

/**
 * The zone each `TaskState` is displayed in (ADR018).
 *
 * Total and single-valued by construction: every one of the sixteen states
 * appears exactly once, so {@link projectTaskZone} cannot be partial and no
 * state can render in two zones. `ideas` is deliberately absent here — it holds
 * `Idea` entities, not tasks.
 */
export const ZONE_BY_STATE: Readonly<Record<TaskState, BoardZone>> = Object.freeze({
  draft: 'backlog',
  planned: 'backlog',
  ready: 'ready',
  assigned: 'in-progress',
  executing: 'in-progress',
  'awaiting-review': 'review',
  reviewing: 'review',
  approved: 'review',
  integrating: 'review',
  done: 'done',
  blocked: 'blocked',
  'changes-requested': 'error',
  failed: 'error',
  cancelled: 'cancelled',
  superseded: 'cancelled',
  'needs-attention': 'blocked',
})

/**
 * Layout mode of the board (v0.2 §1). `grid-3x3` is the default;
 * `strip-horizontal` puts the same nine zones in one scrolling row and is
 * chosen manually or automatically below 1100 px of panel width.
 */
export type BoardViewMode = 'grid-3x3' | 'strip-horizontal'

/** Every layout mode. */
export const BOARD_VIEW_MODES: readonly BoardViewMode[] = Object.freeze(['grid-3x3', 'strip-horizontal'])

/** Width, in CSS pixels, below which `strip-horizontal` is selected (§1). */
export const BOARD_STRIP_MAX_WIDTH_PX = 1100

/**
 * Panel lifecycle of the board (v0.2 §5.17).
 *
 * The distinction that matters is `empty` versus `unavailable`: a healthy
 * workspace with no tasks and a board whose controller never mounted must not
 * look alike, or the user reads "no work" where the truth is "not connected".
 */
export type BoardPanelState =
  /** First load; the snapshot is not there yet. */
  | 'loading'
  /** Snapshot loaded; the selected view has no cards. */
  | 'ready'
  /** Snapshot loaded; the view is genuinely empty in a healthy workspace. */
  | 'empty'
  /** A frozen snapshot is shown, carrying the time it was taken. */
  | 'degraded'
  /** No controller or no registration for this workspace; never an empty board. */
  | 'unavailable'
  /** A recovery banner is in force. */
  | 'recovery'
  /** Admission is paused; the pause reason is shown. */
  | 'paused'

/** Every panel state, so the UI can prove its switch is exhaustive. */
export const BOARD_PANEL_STATES: readonly BoardPanelState[] = Object.freeze([
  'loading',
  'ready',
  'empty',
  'degraded',
  'unavailable',
  'recovery',
  'paused',
])

/**
 * A board view: the saved representation of one board (ADR017).
 *
 * The view owns layout, filters and ordering — pure presentation. It never
 * carries a task state, which is what keeps the projection from becoming a
 * second authority.
 */
export interface BoardView {
  /** Identifier of the view; the revision key is `(viewId, zone)`. */
  readonly viewId: string
  /** Workspace the view belongs to. */
  readonly workspaceId: WorkspaceId
  /** Human-readable name shown in the view switcher. */
  readonly name: string
  /** Layout mode in force for this view. */
  readonly mode: BoardViewMode
  /** Zones the view shows, in display order; every entry must be a real zone. */
  readonly zones: readonly BoardZone[]
  /** Board revision this view definition was read at. */
  readonly boardRevision: Revision
}

/**
 * One card's placement on the board (ADR017; supersedes `TaskBoardPlacement`).
 *
 * Keyed `(viewId, taskId)`. None of these fields is domain semantics: `zone` and
 * `exactState` are derived from the task, `order` is a string key, and a move
 * either changes the `TaskState` through a command or is refused.
 */
export interface BoardPlacement {
  /** View the placement belongs to. */
  readonly viewId: string
  /** Task the placement describes. */
  readonly taskId: TaskId
  /** Zone the card renders in; always {@link ZONE_BY_STATE} of {@link exactState}. */
  readonly zone: BoardZone
  /**
   * Exact domain state, shown as a chip. Carried here so the projection can
   * prove it did not collapse states; the authority for it stays the Task Graph.
   */
  readonly exactState: TaskState
  /** Finer state behind the zone (attempt, review, or idea state), when there is one. */
  readonly subState?: string
  /**
   * Ordering key inside the zone. A **string** by contract: insertion between two
   * neighbours writes one new key and no row moves (v0.2 §5.3).
   */
  readonly order: string
  /** True when the card is pinned to the front of its zone. */
  readonly pinned?: boolean
  /**
   * Revision of this zone, not of the whole board: a move in one zone must not
   * invalidate a reader of another (v0.2 §5.3).
   */
  readonly columnRevision: Revision
  /** Revision of the board-wide snapshot the row came from. */
  readonly boardRevision: Revision
}

/**
 * What a drag-and-drop builds (ADR017). An intent is a *request*, not a write:
 * it is resolved into a MyWork command and may be refused with a typed error.
 */
export interface DropIntent {
  /** View the drag happened in. */
  readonly viewId: string
  /** Task being dragged. */
  readonly taskId: TaskId
  /** Zone the card came from. */
  readonly fromZone: BoardZone
  /** Zone the pointer is over. */
  readonly toZone: BoardZone
  /**
   * Card the dragged card is dropped before, or absent when it lands at the end
   * of the zone. Together with `orderKeyOf` this names the insertion point.
   */
  readonly beforeTaskId?: TaskId
  /** Card the dragged card is dropped after, absent at the front of the zone. */
  readonly afterTaskId?: TaskId
  /** Zone revision the drag observed; a mismatch is `STALE_COLUMN_REVISION`. */
  readonly expectedColumnRevision: Revision
}

/** Commands a card's controls issue, all of them real domain mutations. */
export type CardCommand =
  /** Start work: admits an attempt (`admitAttempt`). */
  | 'task.admit'
  /** Stop a running card: attempt cancel plus the two task transitions (§5.4). */
  | 'task.stop-and-cancel'
  /** Retry a failed or rejected card: back to `ready`. */
  | 'task.retry'
  /** Cancel a card that holds no attempt. */
  | 'task.cancel'
  /** Approve the exact artifact the review saw. */
  | 'review.approve'
  /** Reject the reviewed attempt with findings. */
  | 'review.request-changes'
  /** Answer a `needs-attention` trigger. */
  | 'task.resolve-attention'
  /** Reorder or rezone the card; the only command that writes placement. */
  | 'board.move'

/** Every card command, so the UI can bind controls exhaustively. */
export const CARD_COMMANDS: readonly CardCommand[] = Object.freeze([
  'task.admit',
  'task.stop-and-cancel',
  'task.retry',
  'task.cancel',
  'review.approve',
  'review.request-changes',
  'task.resolve-attention',
  'board.move',
])

/**
 * Which part of a card the user acted on. Kept as data so the controller can
 * decide whether the interaction is a mutation at all.
 */
export interface CardInteraction {
  /** Card that was acted on. */
  readonly taskId: TaskId
  /** Command the control issues. */
  readonly command: CardCommand
  /** Zone the card was displayed in when the action was taken. */
  readonly zone: BoardZone
  /** Revision of that zone when the action was taken. */
  readonly columnRevision: Revision
  /** Clock reading of the interaction. */
  readonly at: EpochMs
}

/**
 * What a degraded snapshot is missing (ADR018, v0.2 §5.17).
 *
 * A frozen snapshot must say what it could not read, so the UI can label the
 * gap instead of presenting stale data as current.
 */
export interface DegradedProjection {
  /** Reason the projection is degraded. */
  readonly reason: 'adapter-unavailable' | 'reconciliation-pending' | 'partial-read'
  /** Human-readable detail; never parsed by callers. */
  readonly detail: string
  /** Clock reading the shown snapshot was taken at. */
  readonly snapshotAt: EpochMs
  /** Zones whose contents could not be refreshed. */
  readonly staleZones: readonly BoardZone[]
}

/** One evidence item linked to a task, as the board shows it. */
export interface EvidenceSummary {
  /** Artifact the item points at. */
  readonly artifactId: string
  /** Kind of evidence, for grouping and icons. */
  readonly kind: 'diff' | 'test' | 'log' | 'review' | 'build'
  /** Short label for the card. */
  readonly label: string
  /** Clock reading the evidence was produced. */
  readonly at: EpochMs
  /** True when the artifact is still retrievable. */
  readonly available: boolean
}

/**
 * Link from a card to the DSH session that worked on it.
 *
 * Sessions are the harness's data (§8: raw session events belong to the DSH
 * session store). This is a reference the board renders, never a copy.
 */
export interface SessionLink {
  /** Session the link points at. */
  readonly sessionId: SessionId
  /** Attempt the session belongs to, when the run was bound to one. */
  readonly attemptId?: string
  /** Role the run acted as, for the chip on the card. */
  readonly roleId?: string
  /** True while the session is still the live one for the card. */
  readonly active: boolean
  /** Clock reading the session was started. */
  readonly startedAt: EpochMs
}

/**
 * Closed catalogue of `needs-attention` triggers (v0.2 §5.7).
 *
 * Every entry has a deterministic condition and a named source, because the
 * card must show the concrete trigger rather than a generic "needs attention",
 * and because `needs-attention` must never be entered without a reason.
 */
export type NeedsAttentionReason =
  /** Reconciliation found a divergence between the graph and MyWork DB. */
  | 'reconciliation-divergence'
  /** An adapter became unavailable while an attempt was live. */
  | 'adapter-unavailable-with-live-attempt'
  /** A budget ran out with no retry allowed. */
  | 'budget-exhausted'
  /** A human gate passed its deadline. */
  | 'human-gate-deadline-exceeded'
  /** The retry budget for the task is exhausted. */
  | 'retry-budget-exhausted'
  /** A dependency was voided and cannot be resolved. */
  | 'dependency-unresolvable-after-void'
  /** The lease was lost and no successor took over. */
  | 'lease-lost-without-successor'

/** Every trigger, so "no path enters `needs-attention` without a reason" is checkable. */
export const NEEDS_ATTENTION_REASONS: readonly NeedsAttentionReason[] = Object.freeze([
  'reconciliation-divergence',
  'adapter-unavailable-with-live-attempt',
  'budget-exhausted',
  'human-gate-deadline-exceeded',
  'retry-budget-exhausted',
  'dependency-unresolvable-after-void',
  'lease-lost-without-successor',
])
