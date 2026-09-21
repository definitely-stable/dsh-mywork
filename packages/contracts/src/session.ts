/**
 * Session architecture: checkpoint, rollover, and context pressure
 * (architecture §22.4, §22.5, §32, §35, §62 items 17, 22, 23).
 *
 * §22.1 fixes the hierarchy — agent identity, task episode, attempt, session
 * window — and this module carries the vocabulary of the two boundaries the
 * architecture draws inside it:
 *
 * - **Fresh session per record** (§22.2). A worker attempt, a review, a
 *   planning operation, a reflection and an optimization run each get their own
 *   session. {@link FreshSessionPolicy} states that as data, so a deployment
 *   reads the policy rather than inferring it from prose.
 * - **A window rolls over inside one attempt; a new attempt gets a new
 *   session** (§22.5). The distinction is the whole point of the module. When an
 *   attempt outgrows its window, the attempt, its identity and its anchors are
 *   *preserved* and only the window changes. When the work is logically retried
 *   or rejected, a **new attempt** starts and receives a **new session** seeded
 *   with the checkpoint and review findings of the previous attempt — and never
 *   with
 *   the whole transcript (§22.3).
 *
 * Three further rules shape the types:
 *
 * - **The checkpoint capsule is the transfer unit** (§22.4). Decisions,
 *   artifacts, git coordinates, verification, review findings, unresolved work
 *   and exact anchors travel; the conversation does not.
 * - **Anchors are exact** (§22.4 `anchors`). A path anchor carries the line, so
 *   the next session starts from a location rather than from a search.
 * - **A checkpoint that could not be stored is a refusal, not a completion**
 *   (§22.5, §32). {@link CheckpointResult} answers with the capsule it built
 *   when persistence failed and reports the failure — rollover then refuses,
 *   because a window whose checkpoint is not durable is a window whose evidence
 *   can be lost.
 *
 * This module is a contract: the policy that decides *which* pressure action a
 * window takes lives in `@dsh-mywork/core`, and the live session it acts on is
 * reached through the `SessionPort` of `./agent-runtime.ts`.
 * @module
 */

import type { ArtifactRef } from './artifact.ts'
import type { ContextLevel } from './context.ts'
import type { AttemptId, EpochMs, ReviewId, Revision, SessionId, TaskId, WorkspaceId } from './ids.ts'
import type { MyWorkErrorCode } from './operation.ts'

/**
 * Why a session exists (§22.2).
 *
 * The list is closed to the five records the architecture names, so a
 * deployment that adds a role has to say which of them it is rather than
 * inventing a sixth spelling of `worker`.
 */
export type SessionPurpose =
  /** One worker attempt (§22.2 `fresh Session per Attempt`). */
  | 'attempt'
  /** One review (§22.2 `fresh Session per Review`). */
  | 'review'
  /** One planning operation (§22.2 `fresh Session per planning operation`). */
  | 'planning'
  /** One reflection of a fast role learner (§22.2). */
  | 'reflection'
  /** One optimization run of the sleep optimizer (§22.2). */
  | 'optimization'

/** Every session purpose, in the order §22.2 lists them. */
export const SESSION_PURPOSES: readonly SessionPurpose[] = Object.freeze([
  'attempt',
  'review',
  'planning',
  'reflection',
  'optimization',
])

/** Whether a session of this purpose is bound to a task attempt. */
export const SESSION_PURPOSES_WITH_ATTEMPT: readonly SessionPurpose[] = Object.freeze(['attempt', 'review'])

/** The default policy of §22.2: what a fresh session is minted for. */
export interface FreshSessionPolicy {
  /** True when every attempt gets a session of its own. */
  readonly perAttempt: boolean
  /** True when every review gets a session of its own. */
  readonly perReview: boolean
  /** True when every planning operation gets a session of its own. */
  readonly perPlanning: boolean
  /** True when every reflection gets a session of its own. */
  readonly perReflection: boolean
  /** True when every optimization run gets a session of its own. */
  readonly perOptimization: boolean
}

/** Fields of {@link FreshSessionPolicy}; the shape is closed. */
export const FRESH_SESSION_POLICY_FIELDS: readonly string[] = Object.freeze([
  'perAttempt',
  'perReview',
  'perPlanning',
  'perReflection',
  'perOptimization',
])

/**
 * The baseline policy of §22.2, as the architecture states it.
 *
 * Every flag is true: a session is per record, not per task and not per agent.
 * A deployment that wants to reuse a session must state it by replacing this
 * value, and the difference is then visible in the configuration rather than
 * hidden in an implementation.
 */
export const DEFAULT_FRESH_SESSION_POLICY: FreshSessionPolicy = Object.freeze({
  perAttempt: true,
  perReview: true,
  perPlanning: true,
  perReflection: true,
  perOptimization: true,
})

/** Purpose a window serves, with the task and attempt it belongs to. */
export interface SessionWindowSubject {
  /** Purpose of the window (§22.2). */
  readonly purpose: SessionPurpose
  /** Workspace the session runs in. */
  readonly workspaceId: WorkspaceId
  /** Task the work belongs to. */
  readonly taskId: TaskId
  /** Attempt the window serves; absent for a purpose that has no attempt. */
  readonly attemptId?: AttemptId
}

/** Fields of {@link SessionWindowSubject}; the shape is closed. */
export const SESSION_WINDOW_SUBJECT_FIELDS: readonly string[] = Object.freeze([
  'purpose',
  'workspaceId',
  'taskId',
  'attemptId',
])

/**
 * One window of one attempt (§22.5).
 *
 * The ordinal is the position of the window inside its attempt, starting at 1:
 * it is
 * what makes a rollover observable from the outside, and it is the field a
 * reader compares to tell "the same attempt continued" from "a new attempt
 * started".
 */
export interface SessionWindow {
  /** Real session identity the window runs in (§22, §62 item 22). */
  readonly sessionId: SessionId
  /** Subject the window serves. */
  readonly subject: SessionWindowSubject
  /** Position of this window inside its attempt, starting at 1. */
  readonly ordinal: number
  /**
   * Aggregate revision of the window. It is `ordinal` when the window opens and
   * rises with each accepted change to it, so a caller can say which state of
   * the window it acted on — the same discipline every aggregate in this domain
   * follows. A rollover compares the revision the caller observed against this.
   */
  readonly revision: Revision
  /** Clock reading the window opened. */
  readonly openedAt: EpochMs
  /** Clock reading the window closed; absent while it is the live window. */
  readonly closedAt?: EpochMs
  /** Clock reading of the most recent activity in the window. */
  readonly lastActivityAt: EpochMs
  /** Tokens the conversation of the window holds. */
  readonly tokens: number
  /** Tokens held back for the working conversation. */
  readonly workingReserve: number
  /** Tokens held back for the answer of the model itself. */
  readonly safetyReserve: number
  /** Capacity the selected route published for the session of this window. */
  readonly contextWindow: number
  /** Revisions the window froze; a rollover keeps them (§35). */
  readonly frozenRevisions: Revision
}

/** Fields of {@link SessionWindow}; the shape is closed. */
export const SESSION_WINDOW_FIELDS: readonly string[] = Object.freeze([
  'sessionId',
  'subject',
  'ordinal',
  'revision',
  'openedAt',
  'closedAt',
  'lastActivityAt',
  'tokens',
  'workingReserve',
  'safetyReserve',
  'contextWindow',
  'frozenRevisions',
])

/** Where an anchor points (§22.4 `anchors`). */
export type AnchorKind =
  /** A file, with the line the next session must start from. */
  | 'path'
  /** A commit. */
  | 'commit'
  /** An issue or ticket. */
  | 'issue'
  /** An error that was observed, with the message it was observed with. */
  | 'error'
  /** A durable session log position. */
  | 'session'
  /** A stored artifact. */
  | 'artifact'

/** Every anchor kind, in the order §22.4 lists them. */
export const ANCHOR_KINDS: readonly AnchorKind[] = Object.freeze([
  'path',
  'commit',
  'issue',
  'error',
  'session',
  'artifact',
])

/**
 * One exact anchor of a checkpoint (§22.4 `anchors`).
 *
 * `line` is what makes a `path` anchor exact: a reader resumes at the location,
 * and an anchor without one is a reference to a file rather than to the place
 * the work stopped. It is optional because a commit, an issue, an error, a
 * session position and an artifact have no line.
 */
export interface CheckpointAnchor {
  /** What the anchor points at. */
  readonly kind: AnchorKind
  /** The reference itself: a path, a SHA, an issue key, an error code, a session identity. */
  readonly ref: string
  /** Line the anchor points at; only a `path` anchor carries one. */
  readonly line?: number
  /** Short note explaining why the anchor matters. */
  readonly note?: string
}

/** Fields of {@link CheckpointAnchor}; the shape is closed. */
export const CHECKPOINT_ANCHOR_FIELDS: readonly string[] = Object.freeze(['kind', 'ref', 'line', 'note'])

/** One decision the attempt made (§22.4 `decisions.accepted`). */
export interface CheckpointDecision {
  /** What was decided. */
  readonly decision: string
  /** Why; absent when the record states none. */
  readonly reason?: string
  /** Evidence the decision rests on. */
  readonly evidence?: string
}

/** Fields of {@link CheckpointDecision}; the shape is closed. */
export const CHECKPOINT_DECISION_FIELDS: readonly string[] = Object.freeze(['decision', 'reason', 'evidence'])

/** One approach the attempt rejected (§22.4 `decisions.rejected`). */
export interface RejectedApproach {
  /** The approach that was rejected. */
  readonly approach: string
  /** Why it was rejected. Required: a rejection without a reason is repeated by the next session. */
  readonly reason: string
}

/** Fields of {@link RejectedApproach}; the shape is closed. */
export const REJECTED_APPROACH_FIELDS: readonly string[] = Object.freeze(['approach', 'reason'])

/** Which side of the ledger a decision sits on. */
export type DecisionOutcome = 'accepted' | 'rejected'

/** Both outcomes, so a reader can enumerate the ledger. */
export const DECISION_OUTCOMES: readonly DecisionOutcome[] = Object.freeze(['accepted', 'rejected'])

/** One artifact the attempt changed (§22.4 `changedArtifacts`). */
export interface ChangedArtifact {
  /** Path of the artifact inside the workspace. */
  readonly path: string
  /** What happened to it. */
  readonly change: 'added' | 'modified' | 'deleted' | 'renamed'
  /** Content hash, when the checkpoint recorded one. */
  readonly hash?: string
  /** Path it was renamed from; only for a rename. */
  readonly previous?: string
}

/** Fields of {@link ChangedArtifact}; the shape is closed. */
export const CHANGED_ARTIFACT_FIELDS: readonly string[] = Object.freeze(['path', 'change', 'hash', 'previous'])

/** Every change kind `changedArtifacts` may state. */
export const ARTIFACT_CHANGES: readonly ChangedArtifact['change'][] = Object.freeze([
  'added',
  'modified',
  'deleted',
  'renamed',
])

/** Git coordinates of the attempt (§22.4 `git`). */
export interface CheckpointGit {
  /** SHA the attempt started from. */
  readonly baseSha: string
  /** SHA the attempt reached; absent while nothing was committed. */
  readonly headSha?: string
  /** Branch the attempt worked on, when it worked on one. */
  readonly branch?: string
}

/** Fields of {@link CheckpointGit}; the shape is closed. */
export const CHECKPOINT_GIT_FIELDS: readonly string[] = Object.freeze(['baseSha', 'headSha', 'branch'])

/** One check the attempt ran, with the result it observed (§22.4 `verification`). */
export interface CheckpointCheck {
  /** What was checked. */
  readonly check: string
  /** Whether it passed. */
  readonly passed: boolean
  /** Exit code the check settled with, when it ran as a process. */
  readonly exitCode?: number
  /** Evidence the result rests on: a path, a command, an artifact reference. */
  readonly evidence?: string
}

/** Fields of {@link CheckpointCheck}; the shape is closed. */
export const CHECKPOINT_CHECK_FIELDS: readonly string[] = Object.freeze(['check', 'passed', 'exitCode', 'evidence'])

/** Verification the attempt accumulated (§22.4 `verification`). */
export interface CheckpointVerification {
  /** Checks that passed. */
  readonly passed: readonly CheckpointCheck[]
  /** Checks that failed. */
  readonly failed: readonly CheckpointCheck[]
}

/** Fields of {@link CheckpointVerification}; the shape is closed. */
export const CHECKPOINT_VERIFICATION_FIELDS: readonly string[] = Object.freeze(['passed', 'failed'])

/**
 * How bad one review finding is, on the single scale this project reviews by.
 *
 * The scale is declared here rather than in `./review.ts` because §22.4 is the
 * first thing that needs the severity of a finding as data: `ReviewFindings` carries
 * a summary and an artifact reference, and the severities themselves have lived
 * in the reports of the reviewers. One scale, never a second one — the four levels are
 * the ones every review in this workspace already writes.
 */
export type FindingSeverity = 'BLOCKER' | 'MAJOR' | 'MINOR' | 'NIT'

/** Every severity, from the most to the least blocking. */
export const FINDING_SEVERITIES: readonly FindingSeverity[] = Object.freeze(['BLOCKER', 'MAJOR', 'MINOR', 'NIT'])

/** One review finding the next session must carry (§22.4 `review.findings`). */
export interface CheckpointFinding {
  /** Identity of the finding inside its review. */
  readonly id: string
  /** How bad it is, on the one scale of {@link FindingSeverity}. */
  readonly severity: FindingSeverity
  /** Where it was found, as exactly as the review knew. */
  readonly location?: string
  /** What is wrong. */
  readonly summary: string
  /** Whether it was closed before the checkpoint; absent means it was not. */
  readonly resolved?: boolean
}

/** Fields of {@link CheckpointFinding}; the shape is closed. */
export const CHECKPOINT_FINDING_FIELDS: readonly string[] = Object.freeze([
  'id',
  'severity',
  'location',
  'summary',
  'resolved',
])

/** Review findings a checkpoint carries (§22.4 `review`). */
export interface CheckpointReview {
  /** Review the findings came from. */
  readonly reviewId: ReviewId
  /** The findings themselves. */
  readonly findings: readonly CheckpointFinding[]
  /** Verdict the review reached, when it reached one. */
  readonly verdict?: string
}

/** Fields of {@link CheckpointReview}; the shape is closed. */
export const CHECKPOINT_REVIEW_FIELDS: readonly string[] = Object.freeze(['reviewId', 'findings', 'verdict'])

/**
 * The structured checkpoint of one attempt (§22.4).
 *
 * It is the only thing a new attempt or a new window receives from the one
 * before it. The shape is closed on purpose: a field that is not here does not
 * travel, and the rule of §22.3 that the whole transcript is not carried over is
 * enforced by
 * this type rather than by the restraint of an implementation.
 */
export interface CheckpointCapsule {
  /** Schema brand, so a stored capsule is recognisable as one. */
  readonly schema: typeof CHECKPOINT_CAPSULE_SCHEMA
  /** Task the checkpoint belongs to. */
  readonly taskId: TaskId
  /** Workspace it belongs to. */
  readonly workspaceId: WorkspaceId
  /** Attempt that produced it. */
  readonly attemptId: AttemptId
  /** Window the checkpoint was taken in; `0` for a capsule not yet bound to a window. */
  readonly windowOrdinal: number
  /** Clock reading the capsule was built. */
  readonly createdAt: EpochMs
  /** What the work was trying to achieve (§22.4 `goal`). */
  readonly goal?: string
  /** Decisions, accepted and rejected (§22.4 `decisions`). */
  readonly decisions: {
    /** Decisions the attempt accepted. */
    readonly accepted: readonly CheckpointDecision[]
    /** Approaches the attempt rejected, each with its reason. */
    readonly rejected: readonly RejectedApproach[]
  }
  /** Artifacts the attempt changed (§22.4 `changedArtifacts`). */
  readonly changedArtifacts: readonly ChangedArtifact[]
  /** Git coordinates of the attempt (§22.4 `git`). */
  readonly git: CheckpointGit
  /** Verification the attempt accumulated (§22.4 `verification`). */
  readonly verification: CheckpointVerification
  /** Review findings the next session must carry (§22.4 `review`). */
  readonly review?: CheckpointReview
  /** What is still unresolved (§22.4 `unresolved`). */
  readonly unresolved: readonly string[]
  /** Exact anchors (§22.4 `anchors`). */
  readonly anchors: readonly CheckpointAnchor[]
  /** References to the history behind the checkpoint, never the history itself (§22.4 `historyRefs`). */
  readonly historyRefs: readonly string[]
  /** Where the capsule itself was stored, once it was stored. */
  readonly ref?: ArtifactRef
  /** Canonical form of everything above; the identity the capsule is addressed by. */
  readonly fingerprint: string
}

/** Fields of {@link CheckpointCapsule}; the shape is closed. */
export const CHECKPOINT_CAPSULE_FIELDS: readonly string[] = Object.freeze([
  'schema',
  'taskId',
  'workspaceId',
  'attemptId',
  'windowOrdinal',
  'createdAt',
  'goal',
  'decisions',
  'changedArtifacts',
  'git',
  'verification',
  'review',
  'unresolved',
  'anchors',
  'historyRefs',
  'ref',
  'fingerprint',
])

/** Schema brand of a checkpoint capsule. */
export const CHECKPOINT_CAPSULE_SCHEMA = 'mywork.checkpoint-capsule/v1'

/**
 * Why a capsule could not be checked in (§32).
 *
 * Each reason is a distinct operational situation, because the next step of the
 * operator differs: a store that is down is retried, a capsule that is malformed is
 * a defect, and a capsule with nothing to persist is a caller mistake.
 */
export type CheckpointRefusalReason =
  /** The artifact store behind the port is unreachable or refused the write. */
  | 'checkpoint-store-unavailable'
  /** The capsule failed its own shape check before any store was touched. */
  | 'capsule-invalid'
  /** The capsule states no anchor, so a rollover would lose the place the work stopped. */
  | 'anchors-missing'

/** Every checkpoint refusal reason. */
export const CHECKPOINT_REFUSAL_REASONS: readonly CheckpointRefusalReason[] = Object.freeze([
  'checkpoint-store-unavailable',
  'capsule-invalid',
  'anchors-missing',
])

/** How a checkpoint refusal maps onto the stable codes of §42. */
export const CHECKPOINT_REFUSAL_CODES: Readonly<Record<CheckpointRefusalReason, MyWorkErrorCode>> = Object.freeze({
  'checkpoint-store-unavailable': 'ADAPTER_UNAVAILABLE',
  'capsule-invalid': 'CONTRACT_MISMATCH',
  'anchors-missing': 'CONTRACT_MISMATCH',
})

/**
 * Outcome of checking a capsule in.
 *
 * The failure case carries the capsule whenever one could be built. That is the
 * whole point of the type: when persistence fails, the evidence the attempt
 * accumulated is still in the hand of the caller, and only its durability is
 * missing. A caller that receives this must not treat the attempt as finished —
 * nothing was settled, and the rollover of §22.5 refuses without a durable
 * checkpoint.
 *
 * `capsule` is optional on failure for one honest reason: an input so malformed
 * that no capsule can be built has no capsule to hand back, and inventing one
 * would be worse than reporting its absence. Every other refusal carries it.
 */
export type CheckpointResult =
  | {
      /** The capsule was stored. */
      readonly ok: true
      /** The capsule, carrying the reference it was stored under. */
      readonly capsule: CheckpointCapsule
      /** True when this call stored it; false when the store already held it unchanged. */
      readonly created: boolean
    }
  | {
      /** The capsule was not stored. */
      readonly ok: false
      /** Why. */
      readonly reason: CheckpointRefusalReason
      /**
       * The capsule that was built; the evidence it describes is not lost with
       * the failure. Absent only when the input could not be built into a
       * capsule at all.
       */
      readonly capsule?: CheckpointCapsule
      /** Human-readable detail; never parsed by callers. */
      readonly detail: string
    }

/** What the owner of the session is asked to do (architecture §22.4, §32). */
export interface CheckpointPort {
  /**
   * Store one capsule as an artifact of kind `checkpoint` (§32).
   * @param capsule - the capsule to store.
   * @returns the stored capsule with its reference, or the capsule and the reason it was not stored.
   */
  put(capsule: CheckpointCapsule): Promise<CheckpointResult>
}

/** How full a window is, and whether it may continue (§53, §22.5). */
export interface ContextPressure {
  /** Tokens the window holds. */
  readonly tokens: number
  /** Capacity the route published. */
  readonly contextWindow: number
  /** Tokens held back for the working conversation. */
  readonly workingReserve: number
  /** Tokens held back for the answer of the model itself. */
  readonly safetyReserve: number
  /** Tokens still available to the conversation, never negative. */
  readonly available: number
  /** Fraction of {@link available} that is used, in `[0, 1]`; `1` when nothing is available. */
  readonly utilization: number
}

/** Fields of {@link ContextPressure}; the shape is closed. */
export const CONTEXT_PRESSURE_FIELDS: readonly string[] = Object.freeze([
  'tokens',
  'contextWindow',
  'workingReserve',
  'safetyReserve',
  'available',
  'utilization',
])

/**
 * What a window may do about its pressure (§22.5).
 *
 * `rollover` is a *stop*, not another reduction: it is the state in which no
 * amount of shedding inside this window is enough, so the attempt must take a
 * checkpoint and continue in a new window. Keeping it in the same enum as the
 * shedding actions is deliberate — a caller that switches on the action cannot
 * forget the fourth case.
 */
export type ContextPressureAction =
  /** The window has room; continue in it. */
  | 'continue'
  /** Drop the oldest settled turns, keeping their anchors. */
  | 'prune'
  /** Move bulky bodies into the artifact store, keeping their references. */
  | 'offload'
  /** Lower materialized bodies to a cheaper disclosure level (§21.2). */
  | 'dematerialize'
  /** Replace a span of settled history with a summary plus its anchors. */
  | 'compact'
  /** Shedding is exhausted; the attempt continues in a new window. */
  | 'rollover'

/** Every pressure action, from the cheapest to the terminal one. */
export const CONTEXT_PRESSURE_ACTIONS: readonly ContextPressureAction[] = Object.freeze([
  'continue',
  'prune',
  'offload',
  'dematerialize',
  'compact',
  'rollover',
])

/** The action that ends a window rather than reducing it. */
export const ROLLOVER_ACTION: ContextPressureAction = 'rollover'

/** The thresholds of §22.5, as fractions of the conversation budget. */
export interface ContextPressurePolicy {
  /** Utilization at which a reduction is attempted. */
  readonly reduceAt: number
  /** Utilization at which reduction is exhausted and the window rolls over. */
  readonly rolloverAt: number
  /** Order the reduction actions are attempted in. */
  readonly order: readonly ContextPressureAction[]
}

/** Fields of {@link ContextPressurePolicy}; the shape is closed. */
export const CONTEXT_PRESSURE_POLICY_FIELDS: readonly string[] = Object.freeze(['reduceAt', 'rolloverAt', 'order'])

/**
 * Default thresholds: reduce at 80% of the conversation budget, roll over at
 * 95%, and try the cheapest reduction that keeps the meaning of the window first.
 */
export const DEFAULT_CONTEXT_PRESSURE_POLICY: ContextPressurePolicy = Object.freeze({
  reduceAt: 0.8,
  rolloverAt: 0.95,
  order: Object.freeze<readonly ContextPressureAction[]>(['prune', 'offload', 'dematerialize', 'compact']),
})

/** Why a pressure decision could not be made (§21.6). */
export type PressureRefusalReason =
  /** The route published no context window, so no capacity exists to measure against. */
  | 'context-window-undisclosed'
  /** The reserves alone exceed the capacity; no conversation fits. */
  | 'reserves-overflow'

/** Every pressure refusal reason. */
export const PRESSURE_REFUSAL_REASONS: readonly PressureRefusalReason[] = Object.freeze([
  'context-window-undisclosed',
  'reserves-overflow',
])

/** How a pressure refusal maps onto the stable codes of §42. */
export const PRESSURE_REFUSAL_CODES: Readonly<Record<PressureRefusalReason, MyWorkErrorCode>> = Object.freeze({
  'context-window-undisclosed': 'CONTRACT_MISMATCH',
  'reserves-overflow': 'CONTEXT_BUDGET_EXCEEDED',
})

/**
 * What a caller may look at before it knows the size of the window.
 *
 * The capacity is stated alongside the reserves rather than read off the
 * window, so the decision can be taken for a window that does not exist yet —
 * which is what admission needs.
 */
export interface PressureDecisionInput {
  /** Tokens the conversation holds, or is expected to hold. */
  readonly tokens: number
  /** Reserves and capacity to measure against. */
  readonly window: Pick<SessionWindow, 'contextWindow' | 'workingReserve' | 'safetyReserve'>
  /** Thresholds; defaults to {@link DEFAULT_CONTEXT_PRESSURE_POLICY}. */
  readonly policy?: ContextPressurePolicy
  /** Reduction actions already spent; each is attempted at most once. */
  readonly attempted?: readonly ContextPressureAction[]
}

/** The decision, or the reason none could be taken. */
export type PressureDecision =
  | {
      /** A decision was reached. */
      readonly ok: true
      /** How full the window is. */
      readonly pressure: ContextPressure
      /** What the window may do. */
      readonly action: ContextPressureAction
    }
  | {
      /** No decision could be taken. */
      readonly ok: false
      /** Why. */
      readonly reason: PressureRefusalReason
      /** How full the window is, when it could be measured at all. */
      readonly pressure?: ContextPressure
    }

/**
 * One item a reduction action shed, and where it went.
 *
 * The field naming is load-bearing rather than cosmetic: `tests/boundaries.test.mjs`
 * extracts module specifiers with a `from '...'` pattern, so a frozen field array
 * that literally contains the word `from` next to a quoted string is read as an
 * import — the boundary check refuses it, and rightly so. Hence `previous` and
 * `next` for the two ends of a rollover.
 */
export interface ShedItem {
  /** Uri or position of what was shed. */
  readonly ref: string
  /** Which action shed it. */
  readonly action: ContextPressureAction
  /** Tokens it cost before it was shed. */
  readonly tokens: number
  /** Where it can be read now: an artifact reference, or a cheaper level. */
  readonly keptAs: string
}

/** Fields of {@link ShedItem}; the shape is closed. */
export const SHED_ITEM_FIELDS: readonly string[] = Object.freeze(['ref', 'action', 'tokens', 'keptAs'])

/** What one pressure action did to a window (§22.5). */
export interface WindowPressureStep {
  /** Action that was applied. */
  readonly action: ContextPressureAction
  /** Tokens the window held before it. */
  readonly tokensBefore: number
  /** Tokens the window holds after it. */
  readonly tokensAfter: number
  /** What it shed, in the order it shed it. */
  readonly shed: readonly ShedItem[]
}

/** Fields of {@link WindowPressureStep}; the shape is closed. */
export const WINDOW_PRESSURE_STEP_FIELDS: readonly string[] = Object.freeze([
  'action',
  'tokensBefore',
  'tokensAfter',
  'shed',
])

/**
 * One item the window currently holds, as a reduction action sees it.
 *
 * It is deliberately not a `ContextSnapshotItem`: a reduction acts on what is
 * resident *now*, which includes turns that no snapshot ever froze. The three
 * fields a reducer needs are which item it is, what it costs, and whether it may
 * be touched at all — `live` is true for the turn being written, which no
 * reduction may drop.
 */
export interface ResidentContextItem {
  /** Uri or position of the item. */
  readonly uri: string
  /** Tokens it costs while it is resident. */
  readonly tokens: number
  /** True while the item is the turn being written; a reduction leaves it alone. */
  readonly live: boolean
  /** Disclosure level it is held at, for the item that was materialized (§21.2). */
  readonly level?: ContextLevel
  /** The body itself, present only while the item is held at full fidelity. */
  readonly body?: string
  /** Where the item points, kept when the item is shed (§22.4 `anchors`). */
  readonly anchor?: string
}

/** Fields of {@link ResidentContextItem}; the shape is closed. */
export const RESIDENT_CONTEXT_ITEM_FIELDS: readonly string[] = Object.freeze([
  'uri',
  'tokens',
  'live',
  'level',
  'body',
  'anchor',
])

/** A summary a compaction replaces a span of history with. */
export interface CompactionSummary {
  /** The summary itself; a claim of the caller about the work, never a claim of the policy. */
  readonly text: string
  /** Uris the summary stands in for. */
  readonly covers: readonly string[]
}

/** Fields of {@link CompactionSummary}; the shape is closed. */
export const COMPACTION_SUMMARY_FIELDS: readonly string[] = Object.freeze(['text', 'covers'])

/** Where an offload puts the bodies it moves (§32). */
export interface OffloadTarget {
  /** Artifact uri prefix the bodies are stored under. */
  readonly uriPrefix: string
  /** Smallest body worth a round trip; anything cheaper is left where it is. */
  readonly minTokens: number
}

/** Fields of {@link OffloadTarget}; the shape is closed. */
export const OFFLOAD_TARGET_FIELDS: readonly string[] = Object.freeze(['uriPrefix', 'minTokens'])

/** Everything one reduction action needs (§21.2, §21.6, §22.5, §32). */
export interface WindowReductionInput {
  /** Window being reduced. */
  readonly window: SessionWindow
  /** Items the window holds. */
  readonly items: readonly ResidentContextItem[]
  /** How full the window is; the action reduces toward `available - targetHeadroom`. */
  readonly pressure: ContextPressure
  /** Tokens to leave free after the reduction. */
  readonly targetHeadroom: number
  /** Clock reading of the reduction. */
  readonly at: EpochMs
  /** Thresholds, when the caller decides as well as applies. */
  readonly policy?: ContextPressurePolicy
  /** Actions already spent; each is applied at most once. */
  readonly attempted?: readonly ContextPressureAction[]
  /** Where an offload may put a body; without it, offload sheds nothing. */
  readonly offload?: OffloadTarget
  /** The summary a compaction may use; without it, compaction sheds nothing. */
  readonly summary?: CompactionSummary
}

/** Fields of {@link WindowReductionInput}; the shape is closed. */
export const WINDOW_REDUCTION_INPUT_FIELDS: readonly string[] = Object.freeze([
  'window',
  'items',
  'pressure',
  'targetHeadroom',
  'at',
  'policy',
  'attempted',
  'offload',
  'summary',
])

/** What one reduction action produced, before it is bound to a window. */
export interface WindowReduction {
  /** Tokens the window held before. */
  readonly tokensBefore: number
  /** Tokens the window holds after. */
  readonly tokensAfter: number
  /** What was shed, in the order it was shed. */
  readonly shed: readonly ShedItem[]
}

/** Fields of {@link WindowReduction}; the shape is closed. */
export const WINDOW_REDUCTION_FIELDS: readonly string[] = Object.freeze(['tokensBefore', 'tokensAfter', 'shed'])

/** Why a window could not be rolled over (§22.3, §22.5). */
export type RolloverRefusalReason =
  /** The window belongs to another attempt; a rollover never moves between attempts. */
  | 'attempt-mismatch'
  /**
   * The expectation of the caller no longer matches the window: either the
   * observed revision is not the current one, or the checkpoint it presents was
   * taken in a different window of the same attempt.
   */
  | 'stale-window'
  /** The window already closed. */
  | 'window-closed'
  /** The capsule does not belong to the attempt of this window. */
  | 'capsule-attempt-mismatch'
  /** The capsule belongs to another task or workspace, so it cannot seed this window. */
  | 'capsule-invalid'
  /** The capsule was not stored, so the new window would have nothing durable behind it. */
  | 'capsule-not-persisted'
  /** The owner refused to create the new session. */
  | 'session-create-failed'
  /** The pressure decision does not call for a rollover. */
  | 'rollover-not-warranted'

/** Every rollover refusal reason. */
export const ROLLOVER_REFUSAL_REASONS: readonly RolloverRefusalReason[] = Object.freeze([
  'attempt-mismatch',
  'stale-window',
  'window-closed',
  'capsule-attempt-mismatch',
  'capsule-invalid',
  'capsule-not-persisted',
  'session-create-failed',
  'rollover-not-warranted',
])

/** How a rollover refusal maps onto the stable codes of §42. */
export const ROLLOVER_REFUSAL_CODES: Readonly<Record<RolloverRefusalReason, MyWorkErrorCode>> = Object.freeze({
  'attempt-mismatch': 'CONTRACT_MISMATCH',
  'stale-window': 'STALE_REVISION',
  'window-closed': 'SESSION_NOT_FOUND',
  'capsule-attempt-mismatch': 'CONTRACT_MISMATCH',
  'capsule-invalid': 'CONTRACT_MISMATCH',
  'capsule-not-persisted': 'CONTRACT_MISMATCH',
  'session-create-failed': 'ADAPTER_UNAVAILABLE',
  'rollover-not-warranted': 'CONTRACT_MISMATCH',
})

/**
 * What a rollover produced (§22.5).
 *
 * The attempt identity is carried through unchanged, and it is carried on
 * purpose: it is the field a test asserts to prove that a rollover stayed
 * inside one attempt.
 */
export interface RolloverResult {
  /** Attempt the windows belong to; the same one that was passed in. */
  readonly attemptId: AttemptId
  /** Window that was closed. */
  readonly previous: SessionWindow
  /** Window that was opened; same attempt, new session, next ordinal. */
  readonly next: SessionWindow
  /** The durable checkpoint the new window starts from. */
  readonly capsule: CheckpointCapsule
  /** What the closing window did about its pressure, cheapest first. */
  readonly steps: readonly WindowPressureStep[]
}

/** Fields of {@link RolloverResult}; the shape is closed. */
export const ROLLOVER_RESULT_FIELDS: readonly string[] = Object.freeze([
  'attemptId',
  'previous',
  'next',
  'capsule',
  'steps',
])

/** Why work moved to a new attempt (§22.3, §22.5). */
export type RolloverTrigger =
  /** Pressure inside one attempt; the attempt is preserved (§22.5). */
  | 'pressure'
  /** A logical retry; a new attempt and a new session are created (§22.3). */
  | 'retry'
  /** A rejection; a new attempt and a new session are created (§22.3). */
  | 'reject'
  /** Recovery after a failed attempt; a new attempt and a new session are created. */
  | 'recovery'
  /** The work was reassigned; a new attempt and a new session are created. */
  | 'reassignment'

/** Every trigger, so a caller can enumerate what it must handle. */
export const ROLLOVER_TRIGGERS: readonly RolloverTrigger[] = Object.freeze([
  'pressure',
  'retry',
  'reject',
  'recovery',
  'reassignment',
])

/** The one trigger that stays inside an attempt. */
export const IN_ATTEMPT_TRIGGER: RolloverTrigger = 'pressure'

/**
 * What a trigger means for the record hierarchy (§22.3, §22.5).
 *
 * This is the answer to the question the card turns on, stated as data rather
 * than as a branch: `preservesAttempt` decides whether the next window carries
 * the same attempt identity, and `reusesSession` is false for every trigger
 * that starts a new attempt.
 */
export interface FreshSessionPlan {
  /** Trigger the plan answers for. */
  readonly trigger: RolloverTrigger
  /** True when the attempt identity survives; only `pressure` does. */
  readonly preservesAttempt: boolean
  /** True when the existing session may be reused; false for every new attempt. */
  readonly reusesSession: boolean
  /** True when a new session must be created. */
  readonly createsSession: boolean
  /** True when the capsule of the previous record is handed to the next session. */
  readonly carriesCheckpoint: boolean
  /** True when the findings of the previous review are handed to the next session. */
  readonly carriesFindings: boolean
  /** False always: §22.3 forbids carrying the whole transcript. */
  readonly carriesTranscript: boolean
}

/** Fields of {@link FreshSessionPlan}; the shape is closed. */
export const FRESH_SESSION_PLAN_FIELDS: readonly string[] = Object.freeze([
  'trigger',
  'preservesAttempt',
  'reusesSession',
  'createsSession',
  'carriesCheckpoint',
  'carriesFindings',
  'carriesTranscript',
])
