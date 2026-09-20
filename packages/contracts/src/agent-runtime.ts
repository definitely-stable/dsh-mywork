/**
 * Agent runtime and session ports (architecture §21, §22, §29, §31, §36, §39).
 *
 * §22 puts a session under an attempt: one attempt runs in one session window,
 * and a session outlives the process that started it. Two ports express that
 * split, and only these two:
 *
 * - {@link AgentRuntimePort} is the attempt-scoped run control MyWork drives:
 *   create/resume/stop/status and the durable events of the run.
 * - {@link SessionPort} is the underlying session record a runtime owns: create
 *   or adopt one session, describe it, read its log, and stop its work.
 *
 * Two facts about the shape are deliberate:
 *
 * - A handle carries the *real* session identity the owner minted, never a
 *   MyWork-local substitute. MyWork records the mapping (authority domain
 *   `agent.session-ids`) and the raw events stay with the owner
 *   (`session.events`, §8) — which is why {@link SessionEvent} exposes position,
 *   type, and time and never the event payload.
 * - Stop means "stop the work", not "destroy the record" (§1.5, §3.2, §51 and
 *   the §6.8 decision of the MW-001 capability check): the session remains
 *   durable evidence, and only its active turn is cancelled.
 *
 * The §39 conformance list for `agent-runtime` — create, resume, stop, status,
 * late event, cancellation, process restart — is expressed by these operations;
 * the kit that enforces them lives in `@dsh-mywork/adapter-sdk`.
 * @module
 */

import type { SessionId } from './ids.ts'
import type { ModelRoute } from './routing.ts'
import type { HarnessPolicy } from './security.ts'

/** One exact model route, as the session owner resolved and accepted it (§29). */
export interface AgentModelSelection extends ModelRoute {
  /**
   * Reasoning effort the owner resolved for the route. Absent means the
   * provider has no such setting or the owner reported none — never a default
   * MyWork invented.
   */
  readonly reasoningEffort?: string
}

/**
 * What one run is scoped to (§21, §22, §29, §31).
 *
 * The scope is the whole of the run's model-visible configuration: an agent
 * preset owns the scoped system prompt, the dynamic context, and the tool
 * surface (§21.9); the route pins the model (§29); the permission policy is the
 * runtime-enforced sandbox mode of §31, not a prompt instruction.
 */
export interface AgentRunScope {
  /**
   * Agent preset the session is composed under. This is how DSH scopes a
   * session's system prompt, dynamic context, and tool surface (the MW-001
   * capability check, §6.1 item 5): a session inherits the composition of its
   * preset, and there is no per-session tool allow-list to set instead.
   */
  readonly agentPreset: string
  /** Route to pin before the prompt is admitted. Absent keeps the deployment default. */
  readonly model?: AgentModelSelection
  /** Permission policy the session runs under. Absent keeps the deployment default. */
  readonly permission?: HarnessPolicy
}

/** One unit of agent work handed to a runtime. */
export interface AgentStartRequest {
  /** Caller-owned run identifier; the runtime rejects a duplicate. */
  readonly runId: string
  /** Workspace the run may touch. */
  readonly workspacePath: string
  /** Task text handed to the agent. */
  readonly prompt: string
  /** Scope the run is composed under; absent means the deployment's own defaults. */
  readonly scope?: AgentRunScope
}

/**
 * Re-attach to a run whose session already exists.
 *
 * This is the restart path (§39 "process restart", §22.3): the session identity
 * is durable, so a runtime rebuilt in a new process resumes the same session
 * from the identity alone. The workspace and the scope are re-asserted rather
 * than assumed — a resumed run that silently lost its workspace, preset, route,
 * or permission policy would be a different run.
 */
export interface AgentResumeRequest {
  /** Run identifier MyWork recorded for this session. */
  readonly runId: string
  /** Real session identity the run executes in. */
  readonly sessionId: SessionId
  /** Workspace the session runs in; the owner refuses an adoption that contradicts it. */
  readonly workspacePath: string
  /** Scope to re-assert on the adopted session. */
  readonly scope?: AgentRunScope
}

/** Caller-owned controls for one port call. */
export interface AgentCallOptions {
  /**
   * Cancellation owned by the caller. A call made with an already aborted
   * signal is refused before the owner is touched, and reports `cancelled`.
   */
  readonly signal?: AbortSignal
}

/** Controls for one event read. */
export interface AgentEventOptions extends AgentCallOptions {
  /** Upper bound on the events one page returns. */
  readonly maxEvents?: number
}

/** Opaque reference to a started run and the session that owns it. */
export interface AgentRuntimeHandle {
  /** Run identifier the handle refers to. */
  readonly runId: string
  /** Real session identity the run executes in (§22, §62 item 22). */
  readonly sessionId: SessionId
  /** Route the owner accepted for this session, after its own normalization (§29). */
  readonly route?: AgentModelSelection
}

/** Observed state of one run. */
export interface AgentRuntimeStatus {
  /** Run identifier the status describes. */
  readonly runId: string
  /** Session the run executes in. */
  readonly sessionId: SessionId
  /**
   * True while the session owner still reports the session as running.
   *
   * It is the owner's answer about the session, read from the durable session
   * roster, so it is the same answer a process rebuilt after a crash receives —
   * and it is why a settled run reports `false` rather than becoming unknown.
   */
  readonly running: boolean
}

/**
 * One durable event of a session log.
 *
 * The payload is deliberately absent: raw session events belong to the session
 * owner (§8 authority matrix, `session.events`), and MyWork consumes positions
 * and types — enough to anchor evidence, to find the end of a turn, and to
 * prove that a pin reached the log.
 */
export interface SessionEvent {
  /** Durable position inside the session log; strictly increasing. */
  readonly seq: number
  /** Durable event type, e.g. `turn/end`, `permission/preset`, `model/selection`. */
  readonly type: string
  /** Clock reading the owner recorded for the event, epoch milliseconds. */
  readonly time: number
}

/**
 * One cursor-bounded read of a session log.
 *
 * Cursor discipline, which every implementation and its conformance checks
 * share: the page returns the events committed *after* the cursor the caller
 * passed, `cursor` never moves backwards, and a position the caller has already
 * been given is never returned twice — including when the owner redelivers it,
 * or delivers it after a later position (a late event).
 *
 * A bounded page is a *window*, not a prefix: the owner serves its most recent
 * entries, so positions the page never delivered may lie below the returned
 * cursor. `hasMore` reports exactly that, and a caller that persists the cursor
 * and later needs those positions re-reads with a larger `maxEvents` instead of
 * assuming its view was gap-free.
 */
export interface SessionEventPage {
  /** Events committed after the requested cursor, in ascending position order. */
  readonly events: readonly SessionEvent[]
  /**
   * Position this page is complete up to *inside the window it served*: the last
   * delivered position, or the caller's own cursor when the page carried
   * nothing. It is not a claim that every earlier position was delivered —
   * `hasMore` carries that part of the answer.
   */
  readonly cursor: number
  /**
   * True when the owner holds events this page did not carry, because the page
   * was bounded: a bounded read serves the most recent window rather than every
   * position after the cursor. A caller that needs a gap-free view from its own
   * cursor reads again with a larger `maxEvents`; a caller that only anchors
   * evidence can ignore it. It reports the bound, and never the absence of one.
   */
  readonly hasMore: boolean
}

/** Ask the owner for one session: a fresh one, or the one the identity names. */
export interface SessionCreateRequest {
  /** Workspace path the session runs in. */
  readonly workspacePath: string
  /** Agent preset that owns the session's scoped composition (§21). */
  readonly agentPreset?: string
  /**
   * Explicit identity. When present the owner adopts that durable session
   * instead of minting one, which is what makes resume and restart possible;
   * the adoption is idempotent.
   */
  readonly sessionId?: SessionId
}

/** One session as its owner describes it. */
export interface SessionDescription {
  /** Real session identity. */
  readonly sessionId: SessionId
  /** Agent preset the session is composed under, when the owner reports one. */
  readonly agentPreset?: string
}

/**
 * Agent runtime port (architecture §36, §39).
 *
 * Governance: attempts, leases, and fences are modelled in `./attempt.ts`;
 * binding them to this port belongs to the controller, not to the domain
 * contracts. Every call settles through `@dsh-mywork/adapter-sdk`'s adapter
 * errors: `conflict` for a duplicate run, `invalid-ref` for a session the owner
 * does not know, `cancelled` for a cancelled call, `unavailable` when the owner
 * cannot serve the request at all.
 */
export interface AgentRuntimePort {
  /**
   * Create a session for the run, apply its scope, and admit the prompt.
   * @param request - run identity, workspace, prompt, and scope.
   * @param options - caller-owned cancellation.
   * @returns a handle for {@link status}, {@link stop}, and {@link events}.
   */
  start(request: AgentStartRequest, options?: AgentCallOptions): Promise<AgentRuntimeHandle>
  /**
   * Adopt the session a previous run used and re-assert its scope.
   * @param request - run identity, real session identity, and scope to re-assert.
   * @param options - caller-owned cancellation.
   * @returns a handle equivalent to the one {@link start} returned.
   */
  resume(request: AgentResumeRequest, options?: AgentCallOptions): Promise<AgentRuntimeHandle>
  /**
   * Read the run's state.
   * @param handle - handle returned by {@link start} or {@link resume}.
   * @param options - caller-owned cancellation.
   */
  status(handle: AgentRuntimeHandle, options?: AgentCallOptions): Promise<AgentRuntimeStatus>
  /**
   * Stop the run's work; idempotent for an already stopped run, and never
   * destructive: the session record survives as evidence.
   * @param handle - handle returned by {@link start} or {@link resume}.
   * @param options - caller-owned cancellation.
   */
  stop(handle: AgentRuntimeHandle, options?: AgentCallOptions): Promise<void>
  /**
   * Read the run's durable events after a cursor.
   * @param handle - handle returned by {@link start} or {@link resume}.
   * @param cursor - last position the caller has seen; absent reads from the beginning.
   * @param options - caller-owned cancellation and the page bound.
   */
  events(handle: AgentRuntimeHandle, cursor?: number, options?: AgentEventOptions): Promise<SessionEventPage>
}

/**
 * Session port (architecture §36, §39).
 *
 * The record surface a runtime is built on. It is published as its own port
 * because more than one consumer needs it while owning no run: a session is
 * the durable evidence of an attempt, so checkpointing (§22.4), rollover
 * (§22.5), and the board's session links all read sessions without driving one.
 */
export interface SessionPort {
  /**
   * Create a session, or adopt the durable one an explicit identity names.
   * @param request - workspace, optional preset, optional explicit identity.
   * @param options - caller-owned cancellation.
   */
  create(request: SessionCreateRequest, options?: AgentCallOptions): Promise<SessionDescription>
  /**
   * Read the session log after a cursor.
   * @param sessionId - real session identity.
   * @param cursor - last position the caller has seen; absent reads from the beginning.
   * @param options - caller-owned cancellation and the page bound.
   */
  events(sessionId: SessionId, cursor?: number, options?: AgentEventOptions): Promise<SessionEventPage>
  /**
   * Stop the session's current work without destroying the record; idempotent
   * for a session that is not running.
   * @param sessionId - real session identity.
   * @param options - caller-owned cancellation.
   */
  cancel(sessionId: SessionId, options?: AgentCallOptions): Promise<void>
}
