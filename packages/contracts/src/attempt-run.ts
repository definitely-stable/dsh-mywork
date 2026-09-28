/**
 * Attempt run contracts (architecture §21, §22, §36; MW-022, E-07…E-12).
 *
 * The runtime port (`./agent-runtime.ts`) starts a *session*; this port runs one
 * *attempt*: it is the seam between the worker orchestrator and the runtime, and
 * it exists so the whole admission → worktree → frozen context → session →
 * settle path is exercised on fakes, with no model call and no DSH row.
 *
 * Two deliberate facts about the shape:
 *
 * - **`runId` is caller-owned and derived from the attempt.** A runtime rejects a
 *   duplicate run identifier (§36), and a process rebuilt after a crash has to
 *   find exactly the run the earlier process started — so the identifier is a
 *   deterministic function of the attempt ({@link attemptRunId}), never a fresh
 *   random value.
 * - **The outcome is a closed set.** `completed` means the runtime finished its
 *   work; it says nothing about the task being done — the integrator owns that
 *   (`E-28`). A refusal from the runtime is a `failed` or `cancelled` outcome
 *   with the reason carried alongside, so no caller reads a message to branch.
 * @module
 */

import type { ArtifactRef } from './artifact.ts'
import type { AgentRunScope } from './agent-runtime.ts'
import type { AttemptId, SessionId } from './ids.ts'
import type { OperationMeta, Result } from './operation.ts'
import type { FrozenRevisions } from './revisions.ts'
import type { WorktreeRef } from './attempt.ts'

/** How one attempt run ended. */
export type AttemptRunOutcomeKind =
  /** The runtime finished the turn it was given. */
  | 'completed'
  /** The runtime, or the port in front of it, failed. */
  | 'failed'
  /** The run was cancelled by its caller. */
  | 'cancelled'

/** Every outcome, in the order §21 lists them. */
export const ATTEMPT_RUN_OUTCOMES: readonly AttemptRunOutcomeKind[] = Object.freeze([
  'completed',
  'failed',
  'cancelled',
])

/**
 * Whether a value is one of the three outcomes.
 * @param value - the value to test.
 */
export function isAttemptRunOutcomeKind(value: unknown): value is AttemptRunOutcomeKind {
  return typeof value === 'string' && (ATTEMPT_RUN_OUTCOMES as readonly string[]).includes(value)
}

/** Prefix of every run identifier MyWork derives from an attempt. */
export const ATTEMPT_RUN_ID_PREFIX = 'mywork-attempt-'

/**
 * The run identifier of one attempt.
 *
 * Derived, not minted: the same attempt always names the same run, in this
 * process and in the one that resumes after a restart.
 * @param attemptId - attempt the run belongs to.
 * @returns the run identifier.
 */
export function attemptRunId(attemptId: AttemptId): string {
  return `${ATTEMPT_RUN_ID_PREFIX}${attemptId}`
}

/** What one attempt hands the port. */
export interface AttemptRunRequest {
  /** Caller-owned run identifier; {@link attemptRunId} derives it from the attempt. */
  readonly runId: string
  /** Attempt being executed. */
  readonly attemptId: AttemptId
  /** Isolated worktree of the attempt; the run's workspace path is its `path`. */
  readonly worktree: WorktreeRef
  /** Revisions frozen when the attempt was admitted (§35). */
  readonly frozen: FrozenRevisions
  /** Scope the session is composed under: preset, route, permission policy. */
  readonly scope: AgentRunScope
  /** Prompt admitted to the session. */
  readonly prompt: string
}

/** Fields of {@link AttemptRunRequest}; the shape is closed. */
export const ATTEMPT_RUN_REQUEST_FIELDS: readonly string[] = Object.freeze([
  'runId',
  'attemptId',
  'worktree',
  'frozen',
  'scope',
  'prompt',
])

/** Re-attach to a run whose session already exists (§39, process restart). */
export interface AttemptRunResumeRequest {
  /** Run identifier the earlier process recorded for this attempt. */
  readonly runId: string
  /** Attempt being resumed. */
  readonly attemptId: AttemptId
  /** Real session identity the attempt ran in. */
  readonly sessionId: SessionId
  /** Scope to re-assert on the adopted session. */
  readonly scope: AgentRunScope
}

/** How one attempt run ended, with the evidence it produced. */
export interface AttemptRunOutcome {
  /** Run identifier the outcome describes. */
  readonly runId: string
  /** Attempt the run belonged to. */
  readonly attemptId: AttemptId
  /** Which of the three endings happened. */
  readonly outcome: AttemptRunOutcomeKind
  /** Real session identity the run executed in, when the runtime reported one. */
  readonly sessionId?: SessionId
  /** Evidence the run produced, in the order it was written. */
  readonly artifactRefs: readonly ArtifactRef[]
  /** Why a `failed` or `cancelled` run ended that way; absent on `completed`. */
  readonly reason?: string
}

/** Fields of {@link AttemptRunOutcome}; the shape is closed. */
export const ATTEMPT_RUN_OUTCOME_FIELDS: readonly string[] = Object.freeze([
  'runId',
  'attemptId',
  'outcome',
  'sessionId',
  'artifactRefs',
  'reason',
])

/** Observed state of one run. */
export interface AttemptRunStatus {
  /** Run identifier the status describes. */
  readonly runId: string
  /** True while the session owner still reports the session as running. */
  readonly running: boolean
  /** Real session identity the run executes in, when the owner reports one. */
  readonly sessionId?: SessionId
}

/** Caller-owned controls for one port call. */
export interface AttemptRunCallOptions {
  /** Cancellation owned by the caller; an aborted signal ends the run as `cancelled`. */
  readonly signal?: AbortSignal
}

/**
 * Attempt run port (architecture §21, §22, §36).
 *
 * The worker orchestrator uses it to execute one attempt; the controller mounts
 * the implementation that speaks to the agent runtime. Governance — attempts,
 * leases, fences — lives in `./attempt.ts` and stays with the saga: this port
 * runs a run, it does not decide whether the attempt may exist.
 */
export interface AttemptRunPort {
  /**
   * Execute one attempt: start its session and admit its prompt.
   * @param request - run identity, worktree, frozen revisions, scope, prompt.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   * @returns the outcome with the evidence the run produced.
   */
  run(
    request: AttemptRunRequest,
    meta: OperationMeta,
    options?: AttemptRunCallOptions,
  ): Promise<Result<AttemptRunOutcome>>
  /**
   * Re-attach to an attempt whose session already exists, re-asserting its scope.
   * @param request - run identity, attempt, real session identity, scope.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   */
  resume(
    request: AttemptRunResumeRequest,
    meta: OperationMeta,
    options?: AttemptRunCallOptions,
  ): Promise<Result<AttemptRunOutcome>>
  /**
   * Read one run's state.
   * @param runId - run identifier returned by {@link run}.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   */
  status(
    runId: string,
    meta: OperationMeta,
    options?: AttemptRunCallOptions,
  ): Promise<Result<AttemptRunStatus>>
}
