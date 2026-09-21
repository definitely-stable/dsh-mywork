/**
 * Session window policy: checkpoint, pressure, and rollover (architecture
 * §21.2, §21.6, §22.3, §22.4, §22.5, §32, §35; §62 items 17, 22, 23).
 *
 * This module is the decision half of the session architecture and it is pure:
 * it never creates a session, never writes an artifact, and never reads a
 * clock. Everything it needs arrives as an argument, so every branch below is
 * decided by data — which is what makes the card's acceptance properties
 * testable without a live Host:
 *
 * - **A rollover preserves the attempt** (§22.5). {@link rolloverSession}
 *   returns the attempt identity it was given, next to a window whose ordinal
 *   is one higher and whose session is new. The attempt is not a parameter it
 *   may change.
 * - **A retry or a rejection creates a new attempt and a new session** (§22.3).
 *   {@link freshSessionPlan} answers with `preservesAttempt: false` and
 *   `reusesSession: false` for every trigger except pressure, and with
 *   `carriesTranscript: false` for all of them.
 * - **A checkpoint that could not be stored is a refusal** (§32). Both
 *   {@link checkpointSession} and {@link rolloverSession} report the failure and
 *   hand back the capsule they built: the evidence survives, and the caller is
 *   never told the work finished.
 *
 * The four shedding actions are reductions of one window, and they compose:
 * prune drops the oldest settled turns, offload moves their bodies into the
 * artifact store, dematerialize lowers a materialized body's disclosure level
 * (§21.2), and compaction replaces a span with a summary plus its anchors. Each
 * is applied at most once, in the policy's order, and when all four are spent
 * and the window is still too full the only honest answer left is
 * `rollover` — which is a decision, not a fifth reduction.
 * @module
 */

import {
  ANCHOR_KINDS,
  ARTIFACT_CHANGES,
  CHECKPOINT_CAPSULE_SCHEMA,
  CONTEXT_LEVELS,
  DEFAULT_CONTEXT_PRESSURE_POLICY,
  DEFAULT_FRESH_SESSION_POLICY,
  FINDING_SEVERITIES,
  IN_ATTEMPT_TRIGGER,
  type CheckpointAnchor,
  type CheckpointCapsule,
  type CheckpointGit,
  type CheckpointResult,
  type CheckpointReview,
  type ContextLevel,
  type ContextPressure,
  type ContextPressureAction,
  type ContextPressurePolicy,
  type FreshSessionPlan,
  type FreshSessionPolicy,
  type PressureDecision,
  type PressureDecisionInput,
  type ResidentContextItem,
  type RolloverRefusalReason,
  type RolloverResult,
  type RolloverTrigger,
  type SessionWindow,
  type SessionWindowSubject,
  type SessionPurpose,
  type ShedItem,
  type WindowPressureStep,
  type WindowReductionInput,
} from '@dsh-mywork/contracts'
import { canonicalForm } from './config.ts'

/** Fields of a checkpoint capsule the caller must state, without what the module derives. */
export interface CheckpointInput {
  /** Task the checkpoint belongs to. */
  readonly taskId: string
  /** Workspace it belongs to. */
  readonly workspaceId: string
  /** Attempt that produced it. */
  readonly attemptId: string
  /** Clock reading the capsule is built at. */
  readonly createdAt: number
  /** Git coordinates of the attempt (§22.4 `git`). */
  readonly git: CheckpointGit
  /** Decisions, accepted and rejected. */
  readonly decisions?: CheckpointCapsule['decisions']
  /** Artifacts the attempt changed. */
  readonly changedArtifacts?: CheckpointCapsule['changedArtifacts']
  /** Verification the attempt accumulated. */
  readonly verification?: CheckpointCapsule['verification']
  /** Review findings to carry. */
  readonly review?: CheckpointReview
  /** What is still unresolved. */
  readonly unresolved?: readonly string[]
  /** Exact anchors. */
  readonly anchors?: readonly CheckpointAnchor[]
  /** References to the history behind the checkpoint. */
  readonly historyRefs?: readonly string[]
  /** What the work was trying to achieve. */
  readonly goal?: string
}

/** What {@link createSessionWindow} accepts. */
export interface SessionWindowInput {
  /** Real session identity the window runs in. */
  readonly sessionId: string
  /** Purpose, workspace, task, and attempt the window serves. */
  readonly subject: SessionWindowSubject
  /** Position inside the attempt; defaults to 1, the first window. */
  readonly ordinal?: number
  /** Aggregate revision; defaults to `ordinal`, the revision the window opens at. */
  readonly revision?: number
  /** Clock reading the window opened. */
  readonly openedAt: number
  /** Clock reading of the most recent activity; defaults to `openedAt`. */
  readonly lastActivityAt?: number
  /** Tokens the conversation holds; defaults to 0. */
  readonly tokens?: number
  /** Reserves and capacity. */
  readonly workingReserve: number
  /** Tokens held back for the model's own answer. */
  readonly safetyReserve: number
  /** Capacity the route published. */
  readonly contextWindow: number
  /** Revisions the window froze. */
  readonly frozenRevisions: number
}

/** What {@link checkpointSession} accepts. */
export interface CheckpointSessionInput {
  /** Window the checkpoint is taken in. */
  readonly window: SessionWindow
  /** The capsule's contents. */
  readonly checkpoint: CheckpointInput
  /** Store that receives the capsule (§32). */
  readonly port: { put(capsule: CheckpointCapsule): Promise<CheckpointResult> }
}

/** What {@link rolloverSession} accepts. */
export interface RolloverInput {
  /** Window being closed. */
  readonly window: SessionWindow
  /** Decision for this window; only `rollover` may proceed. */
  readonly decision: PressureDecision
  /** Durable capsule the new window starts from. */
  readonly capsule: CheckpointCapsule
  /** Clock reading of the rollover. */
  readonly at: number
  /**
   * Revision of the window the caller observed. When present and not the
   * window's current revision, the rollover is refused as `stale-window`
   * instead of closing a window somebody else has already moved on from.
   */
  readonly expectedRevision?: number
  /** Owner that mints the new session (§22.2). */
  readonly createSession: (subject: SessionWindowSubject) => Promise<{ readonly sessionId: string }>
  /** Reserves and capacity for the new window; defaults to the closing window's. */
  readonly contextWindow?: number
  /** Tokens held back for the working conversation; defaults to the closing window's. */
  readonly workingReserve?: number
  /** Tokens held back for the model's own answer; defaults to the closing window's. */
  readonly safetyReserve?: number
}

/** Result of a rollover: the new window, or the reason there is none. */
export type RolloverOutcome =
  | { readonly ok: true; readonly result: RolloverResult }
  | { readonly ok: false; readonly reason: RolloverRefusalReason; readonly detail: string }

/** Result of one pressure application: the reduced window, or what stopped it. */
export type PressureOutcome =
  | { readonly ok: true; readonly kind: 'continue'; readonly pressure: ContextPressure }
  | { readonly ok: true; readonly kind: 'reduced'; readonly pressure: ContextPressure; readonly window: SessionWindow; readonly step: WindowPressureStep }
  | { readonly ok: true; readonly kind: 'rollover'; readonly pressure: ContextPressure }
  | { readonly ok: false; readonly reason: 'context-window-undisclosed' | 'reserves-overflow'; readonly detail: string }

/** Whether a value is a plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require a non-empty string. */
function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`dsh-mywork: ${label} must be a non-empty string`)
  }
  return value
}

/** Require a non-negative integer. */
function requireCounter(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`dsh-mywork: ${label} must be a non-negative integer`)
  }
  return value as number
}

/** Require a positive integer. */
function requirePositive(value: unknown, label: string): number {
  const counter = requireCounter(value, label)
  if (counter === 0) throw new TypeError(`dsh-mywork: ${label} must be greater than zero`)
  return counter
}

/** Require a fraction inside `[0, 1]`. */
function requireFraction(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`dsh-mywork: ${label} must be a number in [0, 1]`)
  }
  return value
}

/**
 * Open a window.
 *
 * The reserves are checked against the capacity here rather than at the first
 * pressure reading, because a window whose reserves alone exceed its route is
 * not a window that is full — it is a window that could never have held a
 * conversation, and admitting it would push the discovery of that fact to the
 * first turn.
 * @param input - identity, subject, capacity, and clock reading.
 * @throws {TypeError} when a field is malformed or the reserves exceed the capacity.
 */
export function createSessionWindow(input: SessionWindowInput): SessionWindow {
  const sessionId = requireText(input.sessionId, 'a session identity')
  const subject = normalizeSubject(input.subject)
  const ordinal = input.ordinal === undefined ? 1 : requirePositive(input.ordinal, 'a window ordinal')
  const revision = input.revision === undefined ? ordinal : requirePositive(input.revision, 'a window revision')
  const openedAt = requireCounter(input.openedAt, 'a window opening time')
  const lastActivityAt = input.lastActivityAt === undefined ? openedAt : requireCounter(input.lastActivityAt, 'a last-activity time')
  if (lastActivityAt < openedAt) {
    throw new TypeError('dsh-mywork: a window cannot be last active before it opened')
  }
  const tokens = input.tokens === undefined ? 0 : requireCounter(input.tokens, 'a window token count')
  const workingReserve = requireCounter(input.workingReserve, 'a working reserve')
  const safetyReserve = requireCounter(input.safetyReserve, 'a safety reserve')
  const contextWindow = requireCounter(input.contextWindow, 'a context window')
  const frozenRevisions = requireCounter(input.frozenRevisions, 'a frozen revision')

  // A published capacity of zero is a route that disclosed nothing usable, not
  // a full window; the pressure reading reports it as such. Any non-zero
  // capacity, though, has to hold both reserves with room left over.
  if (contextWindow > 0 && workingReserve + safetyReserve >= contextWindow) {
    throw new TypeError(
      `dsh-mywork: reserves ${workingReserve}+${safetyReserve} leave no room inside context window ${contextWindow}`,
    )
  }

  return Object.freeze({
    sessionId,
    subject,
    ordinal,
    revision,
    openedAt,
    lastActivityAt,
    tokens,
    workingReserve,
    safetyReserve,
    contextWindow,
    frozenRevisions,
  })
}

/** Validate and freeze a window's subject. */
function normalizeSubject(subject: SessionWindowSubject): SessionWindowSubject {
  if (!isPlainObject(subject)) throw new TypeError('dsh-mywork: a session window subject must be an object')
  const purpose = subject.purpose
  if (purpose !== 'attempt' && purpose !== 'review' && purpose !== 'planning' && purpose !== 'reflection' && purpose !== 'optimization') {
    throw new TypeError(`dsh-mywork: unknown session purpose "${String(purpose)}"`)
  }
  const workspaceId = requireText(subject.workspaceId, 'a workspace identity')
  const taskId = requireText(subject.taskId, 'a task identity')
  const hasAttempt = purpose === 'attempt' || purpose === 'review'
  if (hasAttempt && subject.attemptId === undefined) {
    throw new TypeError(`dsh-mywork: a "${purpose}" session must name the attempt it serves`)
  }
  if (!hasAttempt && subject.attemptId !== undefined) {
    throw new TypeError(`dsh-mywork: a "${purpose}" session serves no attempt`)
  }
  return Object.freeze({
    purpose,
    workspaceId,
    taskId,
    ...(subject.attemptId === undefined ? {} : { attemptId: requireText(subject.attemptId, 'an attempt identity') }),
  })
}

/**
 * How full a window is (§21.6, §53).
 *
 * `available` is the conversation budget: capacity minus both reserves, never
 * negative. A route that published no capacity yields `available: 0` and
 * `utilization: 1` rather than a division by zero — the reading says "nothing
 * fits", which is what the caller has to act on.
 * @param window - the window to read.
 */
export function readContextPressure(window: SessionWindow): ContextPressure {
  return pressureOf(window.tokens, window)
}

/**
 * The same reading, taken from raw numbers.
 *
 * Admission needs it before a window exists, and a decision taken against a
 * fabricated window would be a decision about a different session.
 * @param tokens - tokens the conversation holds.
 * @param capacity - published capacity and the two reserves.
 */
export function pressureOf(
  tokens: number,
  capacity: Pick<SessionWindow, 'contextWindow' | 'workingReserve' | 'safetyReserve'>,
): ContextPressure {
  const available = Math.max(0, capacity.contextWindow - capacity.workingReserve - capacity.safetyReserve)
  const utilization = available === 0 ? 1 : Math.min(1, Math.max(0, tokens / available))
  return Object.freeze({
    tokens,
    contextWindow: capacity.contextWindow,
    workingReserve: capacity.workingReserve,
    safetyReserve: capacity.safetyReserve,
    available,
    utilization,
  })
}

/** Resolve a policy's thresholds, rejecting the ones that cannot hold. */
function normalizePressurePolicy(policy: ContextPressurePolicy | undefined): ContextPressurePolicy {
  if (policy === undefined) return DEFAULT_CONTEXT_PRESSURE_POLICY
  if (!isPlainObject(policy)) throw new TypeError('dsh-mywork: a context pressure policy must be an object')
  const reduceAt = requireFraction(policy.reduceAt, 'a reduce threshold')
  const rolloverAt = requireFraction(policy.rolloverAt, 'a rollover threshold')
  if (rolloverAt < reduceAt) {
    throw new TypeError(`dsh-mywork: a rollover threshold ${rolloverAt} cannot sit below the reduce threshold ${reduceAt}`)
  }
  const order = policy.order
  if (!Array.isArray(order)) throw new TypeError('dsh-mywork: a context pressure policy needs an action order')
  for (const action of order) {
    if (action !== 'prune' && action !== 'offload' && action !== 'dematerialize' && action !== 'compact') {
      throw new TypeError(`dsh-mywork: "${String(action)}" is not a reduction action`)
    }
  }
  return Object.freeze({ reduceAt, rolloverAt, order: Object.freeze([...order]) })
}

/**
 * Decide what a window may do about its pressure (§22.5).
 *
 * The order of the three answers is the point: a window below the reduce
 * threshold continues; one above it takes the cheapest reduction it has not
 * spent yet; one at or above the rollover threshold, or one whose reductions are
 * all spent, rolls over. A window with no published capacity is refused instead
 * of being rolled over, because rolling over cannot give a route a capacity it
 * never published.
 * @param input - tokens, capacity, reserves, policy, and actions already spent.
 */
export function decideContextPressure(input: PressureDecisionInput): PressureDecision {
  const window = input.window
  if (!isPlainObject(window)) throw new TypeError('dsh-mywork: a pressure decision needs a window to measure')
  const contextWindow = requireCounter(window.contextWindow, 'a context window')
  const workingReserve = requireCounter(window.workingReserve, 'a working reserve')
  const safetyReserve = requireCounter(window.safetyReserve, 'a safety reserve')
  const tokens = requireCounter(input.tokens, 'a token count')

  const pressure = pressureOf(tokens, { contextWindow, workingReserve, safetyReserve })

  if (contextWindow === 0) {
    return Object.freeze({ ok: false, reason: 'context-window-undisclosed' as const, pressure })
  }
  if (pressure.available === 0) {
    return Object.freeze({ ok: false, reason: 'reserves-overflow' as const, pressure })
  }

  const policy = normalizePressurePolicy(input.policy)
  const attempted = new Set(input.attempted ?? [])

  if (pressure.utilization >= policy.rolloverAt) {
    return Object.freeze({ ok: true, pressure, action: 'rollover' as const })
  }
  if (pressure.utilization < policy.reduceAt) {
    return Object.freeze({ ok: true, pressure, action: 'continue' as const })
  }
  const next = policy.order.find(action => !attempted.has(action))
  return Object.freeze({ ok: true, pressure, action: next ?? ('rollover' as const) })
}

/** The disclosure level one step cheaper than the given one, or `undefined` at the floor. */
export function cheaperContextLevel(level: ContextLevel): ContextLevel | undefined {
  const index = CONTEXT_LEVELS.indexOf(level)
  if (index <= 0) return undefined
  return CONTEXT_LEVELS[index - 1]
}

/** A frozen item that was lowered to a cheaper level. */
export interface DemotedItem {
  /** The item as it now stands. */
  readonly item: ResidentContextItem
  /** Level it carried before. */
  readonly previous: ContextLevel
}

/** What one reduction produced. */
export interface ReductionOutcome {
  /** Tokens the window held before. */
  readonly tokensBefore: number
  /** Tokens the window holds after. */
  readonly tokensAfter: number
  /** What was shed. */
  readonly shed: readonly ShedItem[]
  /** Items whose disclosure level was lowered; only `dematerialize` produces any. */
  readonly demoted: readonly DemotedItem[]
}

/**
 * Drop the oldest settled turns, keeping their anchors (§22.4 `anchors`).
 *
 * A live turn is never pruned: §22.5 rolls a window over at a turn boundary,
 * and dropping the turn that is being written would lose the work rather than
 * the cost of it. When every resident item is live, the reduction sheds nothing
 * and the window keeps its tokens — which is the signal to try the next action.
 * @param input - window, resident items, and the budget to reduce toward.
 */
export function pruneWindow(input: WindowReductionInput): ReductionOutcome {
  const { window, items, pressure } = input
  const target = Math.max(0, pressure.available - input.targetHeadroom)
  let tokens = window.tokens
  const shed: ShedItem[] = []

  for (const item of items) {
    if (tokens <= target) break
    if (item.live) continue
    const cost = Math.max(0, item.tokens)
    tokens = Math.max(0, tokens - cost)
    shed.push(
      Object.freeze({
        ref: item.uri,
        action: 'prune' as const,
        tokens: cost,
        keptAs: anchorOf(item) ?? item.uri,
      }),
    )
  }
  return Object.freeze({ tokensBefore: window.tokens, tokensAfter: tokens, shed: Object.freeze(shed), demoted: Object.freeze([]) })
}

/**
 * Move bulky bodies into the artifact store, keeping their references (§32).
 *
 * Only a body large enough to be worth a round trip is offloaded: moving a
 * two-token line into the store costs a reference and saves nothing.
 * @param input - window, resident items, and the budget to reduce toward.
 */
export function offloadWindow(input: WindowReductionInput): ReductionOutcome {
  const { window, items, pressure, offload } = input
  if (offload === undefined) {
    return Object.freeze({ tokensBefore: window.tokens, tokensAfter: window.tokens, shed: Object.freeze([]), demoted: Object.freeze([]) })
  }
  const target = Math.max(0, pressure.available - input.targetHeadroom)
  let tokens = window.tokens
  const shed: ShedItem[] = []

  for (const item of items) {
    if (tokens <= target) break
    if (item.body === undefined) continue
    const cost = Math.max(0, item.tokens)
    if (cost < offload.minTokens) continue
    tokens = Math.max(0, tokens - cost)
    shed.push(
      Object.freeze({
        ref: item.uri,
        action: 'offload' as const,
        tokens: cost,
        keptAs: `${offload.uriPrefix}${item.uri}`,
      }),
    )
  }
  return Object.freeze({ tokensBefore: window.tokens, tokensAfter: tokens, shed: Object.freeze(shed), demoted: Object.freeze([]) })
}

/**
 * Lower materialized bodies to a cheaper disclosure level (§21.2).
 *
 * This is the inverse of materialization and it is deliberately not the same as
 * offloading: nothing is written anywhere, the body is simply no longer held at
 * full fidelity, and what remains is the item's own reference. An item already
 * at `L0` has nowhere cheaper to go and is left alone.
 * @param input - window, resident items, and the budget to reduce toward.
 */
export function dematerializeWindow(input: WindowReductionInput): ReductionOutcome {
  const { window, items, pressure } = input
  const target = Math.max(0, pressure.available - input.targetHeadroom)
  let tokens = window.tokens
  const shed: ShedItem[] = []
  const demoted: DemotedItem[] = []

  for (const item of items) {
    if (tokens <= target) break
    if (item.body === undefined || item.level === undefined) continue
    const cheaper = cheaperContextLevel(item.level)
    if (cheaper === undefined) continue
    const cost = Math.max(0, item.tokens)
    tokens = Math.max(0, tokens - cost)
    const { body: _body, ...rest } = item
    const lowered: ResidentContextItem = Object.freeze({ ...rest, level: cheaper })
    demoted.push(Object.freeze({ item: lowered, previous: item.level }))
    shed.push(
      Object.freeze({
        ref: item.uri,
        action: 'dematerialize' as const,
        tokens: cost,
        keptAs: `level:${cheaper}`,
      }),
    )
  }
  return Object.freeze({ tokensBefore: window.tokens, tokensAfter: tokens, shed: Object.freeze(shed), demoted: Object.freeze(demoted) })
}

/**
 * Replace a span of settled history with a summary plus its anchors.
 *
 * The summary is supplied by the caller rather than invented here: a summary is
 * a claim about the work, and a policy that wrote its own would be putting words
 * in the attempt's mouth. Without one the reduction sheds nothing.
 * @param input - window, resident items, and the budget to reduce toward.
 */
export function compactWindow(input: WindowReductionInput): ReductionOutcome {
  const { window, items, pressure, summary } = input
  const empty = Object.freeze({ tokensBefore: window.tokens, tokensAfter: window.tokens, shed: Object.freeze([]), demoted: Object.freeze([]) })
  if (summary === undefined || summary.text.trim() === '') return empty
  if (summary.covers.length === 0) return empty

  const covered = new Set(summary.covers)
  const target = Math.max(0, pressure.available - input.targetHeadroom)
  let tokens = window.tokens
  const shed: ShedItem[] = []

  for (const item of items) {
    if (tokens <= target) break
    if (item.live) continue
    if (!covered.has(item.uri)) continue
    const cost = Math.max(0, item.tokens)
    tokens = Math.max(0, tokens - cost)
    shed.push(
      Object.freeze({
        ref: item.uri,
        action: 'compact' as const,
        tokens: cost,
        keptAs: summary.text,
      }),
    )
  }
  return Object.freeze({ tokensBefore: window.tokens, tokensAfter: tokens, shed: Object.freeze(shed), demoted: Object.freeze([]) })
}

/** The anchor a resident item keeps when it is shed, if it states one. */
function anchorOf(item: ResidentContextItem): string | undefined {
  if (item.anchor !== undefined && item.anchor.trim() !== '') return item.anchor
  return undefined
}

/** One reduction applied to a window, with the window it produced. */
export interface AppliedReduction {
  /** Action that ran. */
  readonly action: ContextPressureAction
  /** The window after the reduction. */
  readonly window: SessionWindow
  /** The step to report. */
  readonly step: WindowPressureStep
  /** Items whose disclosure level was lowered. */
  readonly demoted: readonly DemotedItem[]
}

/** Apply one reduction action to a window. */
export function applyReduction(
  action: ContextPressureAction,
  input: WindowReductionInput,
): AppliedReduction {
  const outcome =
    action === 'prune'
      ? pruneWindow(input)
      : action === 'offload'
        ? offloadWindow(input)
        : action === 'dematerialize'
          ? dematerializeWindow(input)
          : action === 'compact'
            ? compactWindow(input)
            : undefined
  if (outcome === undefined) {
    throw new TypeError(`dsh-mywork: "${action}" is not a reduction action`)
  }
  const window = Object.freeze({
    ...input.window,
    tokens: outcome.tokensAfter,
    lastActivityAt: Math.max(input.window.lastActivityAt, input.at),
  })
  const step: WindowPressureStep = Object.freeze({
    action,
    tokensBefore: outcome.tokensBefore,
    tokensAfter: outcome.tokensAfter,
    shed: outcome.shed,
  })
  return Object.freeze({ action, window, step, demoted: outcome.demoted })
}

/**
 * Decide and, when the decision is a reduction, apply exactly one action.
 *
 * One action per call, never a cascade: each reduction is observable on its own,
 * and a caller that wants the next one asks again with the action it just spent.
 * @param input - window, resident items, policy, and what was already spent.
 */
export function applyWindowPressure(input: WindowReductionInput): PressureOutcome {
  const decision = decideContextPressure({
    tokens: input.window.tokens,
    window: input.window,
    ...(input.policy === undefined ? {} : { policy: input.policy }),
    ...(input.attempted === undefined ? {} : { attempted: input.attempted }),
  })
  if (!decision.ok) {
    return Object.freeze({ ok: false, reason: decision.reason, detail: `dsh-mywork: window "${input.window.sessionId}" cannot be measured (${decision.reason})` })
  }
  if (decision.action === 'continue') {
    return Object.freeze({ ok: true, kind: 'continue' as const, pressure: decision.pressure })
  }
  if (decision.action === 'rollover') {
    return Object.freeze({ ok: true, kind: 'rollover' as const, pressure: decision.pressure })
  }
  const applied = applyReduction(decision.action, input)
  return Object.freeze({ ok: true, kind: 'reduced' as const, pressure: decision.pressure, window: applied.window, step: applied.step })
}

/**
 * Build a capsule from a window and the work it accumulated (§22.4).
 *
 * The fingerprint is the canonical form of everything the capsule carries, so
 * two capsules built from the same state are the same capsule — which is what
 * lets a store answer "already there" instead of writing a second copy.
 * @param window - window the checkpoint is taken in.
 * @param input - the capsule's contents.
 * @throws {TypeError} when a required field is malformed.
 */
export function buildCheckpointCapsule(window: SessionWindow, input: CheckpointInput): CheckpointCapsule {
  const taskId = requireText(input.taskId, 'a checkpoint task identity')
  const workspaceId = requireText(input.workspaceId, 'a checkpoint workspace identity')
  const attemptId = requireText(input.attemptId, 'a checkpoint attempt identity')
  const createdAt = requireCounter(input.createdAt, 'a checkpoint time')
  if (taskId !== window.subject.taskId) {
    throw new TypeError(`dsh-mywork: checkpoint task "${taskId}" is not the window's task "${window.subject.taskId}"`)
  }
  if (workspaceId !== window.subject.workspaceId) {
    throw new TypeError(`dsh-mywork: checkpoint workspace "${workspaceId}" is not the window's workspace`)
  }
  const git = normalizeGit(input.git)

  const capsule: Omit<CheckpointCapsule, 'fingerprint'> = {
    schema: CHECKPOINT_CAPSULE_SCHEMA,
    taskId,
    workspaceId,
    attemptId,
    windowOrdinal: window.ordinal,
    createdAt,
    ...(input.goal === undefined ? {} : { goal: requireText(input.goal, 'a checkpoint goal') }),
    decisions: Object.freeze({
      accepted: Object.freeze([...(input.decisions?.accepted ?? [])]),
      rejected: Object.freeze([...(input.decisions?.rejected ?? [])]),
    }),
    changedArtifacts: Object.freeze([...(input.changedArtifacts ?? [])]),
    git,
    verification: Object.freeze({
      passed: Object.freeze([...(input.verification?.passed ?? [])]),
      failed: Object.freeze([...(input.verification?.failed ?? [])]),
    }),
    ...(input.review === undefined ? {} : { review: Object.freeze({ ...input.review, findings: Object.freeze([...input.review.findings]) }) }),
    unresolved: Object.freeze([...(input.unresolved ?? [])]),
    anchors: Object.freeze([...(input.anchors ?? [])].map(anchor => Object.freeze({ ...anchor }))),
    historyRefs: Object.freeze([...(input.historyRefs ?? [])]),
  }
  const fingerprint = canonicalForm({ ...capsule, fingerprint: null })
  const built: CheckpointCapsule = Object.freeze({ ...capsule, fingerprint })
  const invalid = capsuleDefect(built)
  if (invalid !== undefined) throw new TypeError(`dsh-mywork: ${invalid}`)
  return built
}

/**
 * Check what a capsule carries against the vocabularies its own contract declares.
 *
 * This exists because §22.4 and §22.3 are claims about *content*, not about key
 * names: a capsule that carries a transcript body in `historyRefs`, an anchor
 * with no line, or `severity: 'CATASTROPHIC'` satisfies every field of the type
 * while breaking the rules the type is named after. The check is the difference
 * between a closed shape and an enforced one.
 *
 * It is deliberately about declared vocabularies and reference shapes, not about
 * judging prose: a `goal`, a `summary` or an `unresolved` line is free text and
 * stays free text.
 * @param capsule - the capsule to check.
 * @returns the defect in one sentence, or `undefined` when the capsule is sound.
 */
export function capsuleDefect(capsule: CheckpointCapsule): string | undefined {
  for (const anchor of capsule.anchors) {
    if (!ANCHOR_KINDS.includes(anchor.kind)) return `anchor kind "${String(anchor.kind)}" is not a declared anchor kind`
    if (typeof anchor.ref !== 'string' || anchor.ref.trim() === '') return `anchor of kind "${anchor.kind}" states no reference`
    // §22.4 calls the anchors exact: a path anchor without a line is a reference
    // to a file rather than to the place the work stopped.
    if (anchor.kind === 'path' && !Number.isInteger(anchor.line)) {
      return `path anchor "${anchor.ref}" states no line, so it is not exact`
    }
    if (anchor.line !== undefined && !Number.isInteger(anchor.line)) {
      return `anchor "${anchor.ref}" states a non-integer line`
    }
  }
  for (const artifact of capsule.changedArtifacts) {
    if (!ARTIFACT_CHANGES.includes(artifact.change)) {
      return `artifact change "${String(artifact.change)}" is not a declared change`
    }
    if (typeof artifact.path !== 'string' || artifact.path.trim() === '') return 'a changed artifact states no path'
  }
  for (const check of [...capsule.verification.passed, ...capsule.verification.failed]) {
    if (typeof check.passed !== 'boolean') return `check "${String(check.check)}" does not state whether it passed`
  }
  for (const rejected of capsule.decisions.rejected) {
    // A rejection without a reason is repeated by the next session, which is the
    // one thing §22.4's `decisions.rejected` exists to prevent.
    if (typeof rejected.reason !== 'string' || rejected.reason.trim() === '') {
      return `rejected approach "${String(rejected.approach)}" states no reason`
    }
  }
  for (const finding of capsule.review?.findings ?? []) {
    if (!FINDING_SEVERITIES.includes(finding.severity)) {
      return `finding severity "${String(finding.severity)}" is not on the one scale`
    }
  }
  for (const ref of capsule.historyRefs) {
    // §22.3 carries the history as a reference and never as content. A history
    // entry that is not a reference is how a transcript would arrive.
    if (!isReference(ref)) return `history reference "${truncate(ref)}" is not a reference`
  }
  return undefined
}

/** Whether a history entry is a reference rather than a body. */
function isReference(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed === '') return false
  // The schemes §22.4 names, and nothing that merely looks like prose: a
  // reference is `scheme://…` with no whitespace, and it stays short because a
  // body is exactly what it must not be.
  if (!/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(trimmed)) return false
  return trimmed.length <= MAX_HISTORY_REF_LENGTH
}

/** Longest history reference accepted; beyond this it is a body, not a pointer. */
export const MAX_HISTORY_REF_LENGTH = 512

/** Shorten a value for a diagnostic. */
function truncate(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value)
  return text.length <= 60 ? text : `${text.slice(0, 57)}...`
}

/** Validate the git coordinates a capsule states. */
function normalizeGit(git: CheckpointGit | undefined): CheckpointGit {
  if (!isPlainObject(git)) throw new TypeError('dsh-mywork: a checkpoint must state the git coordinates it worked on')
  const baseSha = requireText(git.baseSha, 'a base SHA')
  return Object.freeze({
    baseSha,
    ...(git.headSha === undefined ? {} : { headSha: requireText(git.headSha, 'a head SHA') }),
    ...(git.branch === undefined ? {} : { branch: requireText(git.branch, 'a branch name') }),
  })
}

/**
 * Check a capsule in (§32), reporting a store failure as a refusal.
 *
 * A capsule with no anchor is refused before the store is touched: §22.4 calls
 * the anchors exact, and a window that rolls over from a checkpoint without one
 * would resume without knowing where the work stopped. The failure hands the
 * capsule back either way, so the evidence is not lost with the write.
 *
 * The answer of the store is checked rather than trusted. A port that resolves
 * `ok: true` without a reference has not made anything durable, and reporting
 * that as success is exactly the "looks finished but is not" failure the card
 * forbids — so it is reported as a refusal with the capsule handed back.
 * @param input - window, capsule contents, and the store.
 */
export async function checkpointSession(input: CheckpointSessionInput): Promise<CheckpointResult> {
  let capsule: CheckpointCapsule
  try {
    capsule = buildCheckpointCapsule(input.window, input.checkpoint)
  } catch (cause) {
    return Object.freeze({
      ok: false,
      reason: 'capsule-invalid' as const,
      detail: `dsh-mywork: the checkpoint could not be built: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }
  if (capsule.anchors.length === 0) {
    return Object.freeze({
      ok: false,
      reason: 'anchors-missing' as const,
      capsule,
      detail: `dsh-mywork: checkpoint of attempt "${capsule.attemptId}" states no anchor`,
    })
  }
  try {
    const stored = await input.port.put(capsule)
    if (stored?.ok !== true || stored.capsule === undefined || stored.capsule.ref === undefined) {
      return Object.freeze({
        ok: false,
        reason: 'checkpoint-store-unavailable' as const,
        capsule,
        detail: `dsh-mywork: the checkpoint store reported success without storing the capsule (attempt "${capsule.attemptId}")`,
      })
    }
    return stored
  } catch (cause) {
    return Object.freeze({
      ok: false,
      reason: 'checkpoint-store-unavailable' as const,
      capsule,
      detail: `dsh-mywork: the checkpoint store failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }
}

/**
 * Continue one attempt in a new window (§22.5).
 *
 * Every refusal below leaves the attempt and the closing window exactly as they
 * were. That is the property the card asks for: a rollover that could not take
 * its checkpoint does not half-happen, does not settle anything, and does not
 * report success.
 * @param input - window, decision, durable capsule, clock reading, and the session owner.
 */
export async function rolloverSession(input: RolloverInput): Promise<RolloverOutcome> {
  const window = input.window
  if (input.decision.ok !== true || input.decision.action !== 'rollover') {
    return Object.freeze({
      ok: false,
      reason: 'rollover-not-warranted' as const,
      detail: `dsh-mywork: window "${window.sessionId}" was not decided to roll over`,
    })
  }
  if (window.closedAt !== undefined) {
    return Object.freeze({ ok: false, reason: 'window-closed' as const, detail: `dsh-mywork: window "${window.sessionId}" is already closed` })
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== window.revision) {
    return Object.freeze({
      ok: false,
      reason: 'stale-window' as const,
      detail: `dsh-mywork: window "${window.sessionId}" is at revision ${window.revision}, not the expected ${input.expectedRevision}`,
    })
  }
  const attemptId = window.subject.attemptId
  if (attemptId === undefined) {
    return Object.freeze({
      ok: false,
      reason: 'attempt-mismatch' as const,
      detail: `dsh-mywork: a "${window.subject.purpose}" window serves no attempt and cannot roll over`,
    })
  }
  if (input.capsule.attemptId !== attemptId) {
    return Object.freeze({
      ok: false,
      reason: 'capsule-attempt-mismatch' as const,
      detail: `dsh-mywork: capsule of attempt "${input.capsule.attemptId}" cannot seed attempt "${attemptId}"`,
    })
  }
  if (input.capsule.taskId !== window.subject.taskId || input.capsule.workspaceId !== window.subject.workspaceId) {
    return Object.freeze({
      ok: false,
      reason: 'capsule-invalid' as const,
      detail: `dsh-mywork: capsule of task "${input.capsule.taskId}" in workspace "${input.capsule.workspaceId}" does not belong to this window`,
    })
  }
  // A capsule taken in another window of the same attempt is not a checkpoint of
  // the work being closed: the new window would resume from a place the attempt
  // has already left. §22.5 makes that a stale window, not a fresh start.
  if (input.capsule.windowOrdinal !== window.ordinal) {
    return Object.freeze({
      ok: false,
      reason: 'stale-window' as const,
      detail: `dsh-mywork: capsule was taken in window ${input.capsule.windowOrdinal}, but window ${window.ordinal} is being closed`,
    })
  }
  if (input.capsule.ref === undefined) {
    return Object.freeze({
      ok: false,
      reason: 'capsule-not-persisted' as const,
      detail: `dsh-mywork: capsule "${input.capsule.fingerprint}" was not stored, so attempt "${attemptId}" has no durable checkpoint`,
    })
  }

  // The parameters of the new window are validated *before* the session owner is
  // asked for a session: a refusal must not leave a session nobody will use, and
  // an invalid clock reading must be a typed refusal rather than an exception
  // thrown after the session was already minted.
  const nextInput = {
    sessionId: 'pending',
    subject: window.subject,
    ordinal: window.ordinal + 1,
    openedAt: input.at,
    tokens: 0,
    workingReserve: input.workingReserve ?? window.workingReserve,
    safetyReserve: input.safetyReserve ?? window.safetyReserve,
    contextWindow: input.contextWindow ?? window.contextWindow,
    frozenRevisions: window.frozenRevisions,
  }
  try {
    createSessionWindow(nextInput)
  } catch (cause) {
    return Object.freeze({
      ok: false,
      reason: 'stale-window' as const,
      detail: `dsh-mywork: the next window cannot be opened: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }

  let created: { readonly sessionId: string }
  try {
    created = await input.createSession(window.subject)
  } catch (cause) {
    return Object.freeze({
      ok: false,
      reason: 'session-create-failed' as const,
      detail: `dsh-mywork: the session owner refused to open a window: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }
  if (created === null || typeof created !== 'object' || typeof created.sessionId !== 'string' || created.sessionId.trim() === '') {
    return Object.freeze({
      ok: false,
      reason: 'session-create-failed' as const,
      detail: 'dsh-mywork: the session owner returned no session identity',
    })
  }

  // Built from the parameters validated above, so the window cannot fail here.
  const to = createSessionWindow({ ...nextInput, sessionId: created.sessionId })
  const from = Object.freeze({
    ...window,
    closedAt: input.at,
    lastActivityAt: Math.max(window.lastActivityAt, input.at),
    revision: window.revision + 1,
  })

  return Object.freeze({
    ok: true,
    result: Object.freeze({
      attemptId,
      previous: from,
      next: to,
      capsule: input.capsule,
      steps: Object.freeze([]),
    }),
  })
}

/**
 * What a trigger means for the record hierarchy (§22.3, §22.5).
 *
 * The answer is uniform and it is the one the architecture states: only pressure
 * keeps the attempt, every other trigger creates a new attempt *and* a new
 * session, the capsule and the review findings travel, and the transcript never
 * does.
 * @param trigger - why the work is moving.
 * @param policy - §22.2's fresh-session policy; defaults to the architecture's baseline.
 */
export function freshSessionPlan(
  trigger: RolloverTrigger,
  policy: FreshSessionPolicy = DEFAULT_FRESH_SESSION_POLICY,
): FreshSessionPlan {
  const preservesAttempt = trigger === IN_ATTEMPT_TRIGGER
  // §22.2's baseline mints a session per attempt, so a rollover inside one
  // attempt reuses the session it is already in. A deployment that turned
  // `perAttempt` off is saying the opposite, and that choice is read here rather
  // than being overwritten by the default.
  const createsSession = !preservesAttempt || !policy.perAttempt
  return Object.freeze({
    trigger,
    preservesAttempt,
    reusesSession: !createsSession,
    createsSession,
    carriesCheckpoint: true,
    carriesFindings: true,
    carriesTranscript: false,
  })
}

/**
 * Whether a record of this purpose gets a session of its own (§22.2).
 *
 * `freshSessionPlan` answers for the triggers that move work between attempts,
 * and those triggers have no review, planning, reflection or optimization in
 * them. This is the other half of §22.2: the question "does a review get a fresh
 * session" is answered by the policy, not left to the caller to infer.
 * @param purpose - the record's purpose.
 * @param policy - §22.2's fresh-session policy; defaults to the architecture's baseline.
 */
export function freshSessionFor(
  purpose: SessionPurpose,
  policy: FreshSessionPolicy = DEFAULT_FRESH_SESSION_POLICY,
): boolean {
  switch (purpose) {
    case 'attempt':
      return policy.perAttempt
    case 'review':
      return policy.perReview
    case 'planning':
      return policy.perPlanning
    case 'reflection':
      return policy.perReflection
    case 'optimization':
      return policy.perOptimization
  }
}

/**
 * The next ordinal a window of this attempt takes.
 *
 * It is a function rather than `ordinal + 1` at the call site because it is the
 * field that tells "the same attempt continued" from "a new attempt started",
 * and it should be computed in one place.
 * @param window - the window being closed.
 */
export function nextWindowOrdinal(window: SessionWindow): number {
  return window.ordinal + 1
}

/** Whether two windows serve the same attempt. */
export function sameAttempt(left: SessionWindow, right: SessionWindow): boolean {
  return left.subject.attemptId !== undefined && left.subject.attemptId === right.subject.attemptId
}
