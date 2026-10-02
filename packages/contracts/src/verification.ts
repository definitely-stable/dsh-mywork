/**
 * Deterministic verification gates (architecture §19, §32; MW-023, E-13…E-18).
 *
 * A gate is a command run inside the attempt's worktree, and its verdict is a
 * typed value rather than a log line: `pass` is the only verdict that admits a
 * review, so a missing tool, a timeout, or a cancelled run can never be mistaken
 * for success. The log the command produced is evidence — it is stored as a
 * `gate-result` artifact and referenced by the verdict.
 *
 * Two facts are part of the contract because acceptance rests on them:
 *
 * - **A verdict belongs to an exact head.** {@link GateResult.headSha} is the
 *   commit the command ran against; a head that moved mid-run makes every
 *   verdict stale ({@link GATE_REFUSAL_REASONS}, `GATE_HEAD_MOVED`) instead of
 *   silently transferring approval to code nobody ran.
 * - **An absent gate is a failure, not a skip.** A policy with no gate, or a
 *   required gate that never produced a `pass`, refuses review admission with
 *   `GATE_UNCONFIGURED` or `REVIEW_GATES_MISSING`.
 * @module
 */

import type { ArtifactRef } from './artifact.ts'
import type { AttemptId, TaskId, WorkspaceId } from './ids.ts'
import type { OperationMeta, Result } from './operation.ts'

/** Length of a git object name in lowercase hex. */
export const GIT_SHA_LENGTH = 40

/**
 * What one gate decided.
 *
 * `error`, `timeout`, and `cancelled` are failures the same way `fail` is: the
 * only value that admits the work is `pass`. They stay distinct from `fail`
 * because "the tests failed" and "the test runner was not installed" are
 * different facts about the world.
 */
export type GateVerdict =
  /** The command exited 0. */
  | 'pass'
  /** The command exited non-zero. */
  | 'fail'
  /** The command could not be run, or its result could not be trusted. */
  | 'error'
  /** The command exceeded its bounded timeout and was killed. */
  | 'timeout'
  /** The caller cancelled the run. */
  | 'cancelled'

/** Every verdict, in the order §19 lists them. */
export const GATE_VERDICTS: readonly GateVerdict[] = Object.freeze([
  'pass',
  'fail',
  'error',
  'timeout',
  'cancelled',
])

/**
 * Whether a value is one of the five verdicts.
 * @param value - the value to test.
 */
export function isGateVerdict(value: unknown): value is GateVerdict {
  return typeof value === 'string' && (GATE_VERDICTS as readonly string[]).includes(value)
}

/**
 * Whether a verdict admits the work it verified.
 * @param verdict - the verdict to test.
 * @returns true only for `pass`; every other verdict, including `error` and
 *   `timeout`, is a refusal.
 */
export function isGatePassing(verdict: GateVerdict): boolean {
  return verdict === 'pass'
}

/**
 * Why a gate result is missing or a gate set was refused.
 *
 * These reasons are carried in `GateResult.reason` and in the refusal of a gate
 * policy run; they are the vocabulary a board row and an escalation name.
 */
export type GateRefusalReason =
  /** The policy names no gate at all; nothing was verified. */
  | 'GATE_UNCONFIGURED'
  /** A required gate produced no result for this head. */
  | 'GATE_MISSING'
  /** The command's executable could not be started. */
  | 'GATE_TOOL_MISSING'
  /** Two gates of one policy share an identifier. */
  | 'GATE_DUPLICATE_ID'
  /** The worktree's head moved while the gates were running. */
  | 'GATE_HEAD_MOVED'
  /** Review admission found no passing required gate for the exact head. */
  | 'REVIEW_GATES_MISSING'

/** Every refusal reason. */
export const GATE_REFUSAL_REASONS: readonly GateRefusalReason[] = Object.freeze([
  'GATE_UNCONFIGURED',
  'GATE_MISSING',
  'GATE_TOOL_MISSING',
  'GATE_DUPLICATE_ID',
  'GATE_HEAD_MOVED',
  'REVIEW_GATES_MISSING',
])

/**
 * Whether a value is one of the refusal reasons.
 * @param value - the value to test.
 */
export function isGateRefusalReason(value: unknown): value is GateRefusalReason {
  return typeof value === 'string' && (GATE_REFUSAL_REASONS as readonly string[]).includes(value)
}

/** One command a policy asks to run. */
export interface GateSpec {
  /** Identifier of the gate inside its policy; unique per policy. */
  readonly id: string
  /** Executable to run; never a shell string, so no caller can smuggle a pipeline in. */
  readonly command: string
  /** Arguments, passed verbatim. */
  readonly args: readonly string[]
  /** Upper bound on the run; the process is killed when it is reached. */
  readonly timeoutMs: number
  /**
   * Whether a failure of this gate blocks admission. Absent means required: a
   * gate that was configured is a gate whose result matters, and an
   * informational gate has to say so explicitly.
   */
  readonly required?: boolean
  /** Working directory relative to the worktree root; absent means the root. */
  readonly cwd?: string
}

/** Fields of {@link GateSpec}; the shape is closed. */
export const GATE_SPEC_FIELDS: readonly string[] = Object.freeze([
  'id',
  'command',
  'args',
  'timeoutMs',
  'required',
  'cwd',
])

/** What one gate produced for one exact head. */
export interface GateResult {
  /** Identifier of the gate inside its policy. */
  readonly id: string
  /** Head commit the command ran against; 40 lowercase hex characters. */
  readonly headSha: string
  /** Process exit code, or `null` when no process reported one. */
  readonly exitCode: number | null
  /** What the gate decided. */
  readonly verdict: GateVerdict
  /** Why a non-`pass` verdict was reached; absent on `pass`. */
  readonly reason?: GateRefusalReason
  /** The gate's output, stored as evidence even when the verdict is `error`. */
  readonly artifactRef: ArtifactRef
}

/** Fields of {@link GateResult}; the shape is closed. */
export const GATE_RESULT_FIELDS: readonly string[] = Object.freeze([
  'id',
  'headSha',
  'exitCode',
  'verdict',
  'reason',
  'artifactRef',
])

/**
 * The gates one workspace runs before review (§19).
 *
 * The set is resolved per workspace, never invented per task: a task cannot
 * widen its own verification, and a workspace without a policy refuses with
 * `GATE_UNCONFIGURED` instead of passing by default.
 */
export interface GatePolicy {
  /** Workspace the policy applies to. */
  readonly workspaceId: WorkspaceId
  /** Gates to run, in order. */
  readonly gates: readonly GateSpec[]
  /**
   * Whether every gate must pass or only the required ones. Absent means the
   * `required` flag of each gate decides on its own.
   */
  readonly strict?: boolean
}

/** Fields of {@link GatePolicy}; the shape is closed. */
export const GATE_POLICY_FIELDS: readonly string[] = Object.freeze([
  'workspaceId',
  'gates',
  'strict',
])

/** The outcome of running one policy against one head. */
export interface GateRunResult {
  /** Head commit the policy ran against. */
  readonly headSha: string
  /** One result per gate that ran, in policy order. */
  readonly results: readonly GateResult[]
  /** Present when the run as a whole was refused before or after the gates. */
  readonly refusal?: GateRefusalReason
}

/** Fields of {@link GateRunResult}; the shape is closed. */
export const GATE_RUN_RESULT_FIELDS: readonly string[] = Object.freeze([
  'headSha',
  'results',
  'refusal',
])

/**
 * What one gate port is asked to run: one policy, one attempt, one exact head.
 *
 * The head travels in the request instead of being read by the port. §19 pins the
 * base commit before the attempt exists and the run has to answer for the same
 * head the worker will report, so the caller that owns the pin names it and the
 * port never re-derives it from whatever the worktree happens to point at.
 */
export interface AttemptGateRequest {
  /** Attempt the verdicts belong to. */
  readonly attemptId: AttemptId
  /** Task the attempt belongs to; the policy is looked up per workspace. */
  readonly taskId: TaskId
  /** Workspace whose policy decides which gates run. */
  readonly workspaceId: WorkspaceId
  /** The attempt's own worktree, never the shared checkout (§19). */
  readonly cwd: string
  /** The commit every verdict is pinned to; a head that moved refuses the run. */
  readonly headSha: string
}

/** Fields of {@link AttemptGateRequest}; the shape is closed. */
export const ATTEMPT_GATE_REQUEST_FIELDS: readonly string[] = Object.freeze([
  'attemptId',
  'taskId',
  'workspaceId',
  'cwd',
  'headSha',
])

/**
 * The port the execution layer asks for the verdicts it records before review.
 *
 * `packages/execution` cannot spawn a process — `node:crypto` is the only
 * external import of its bundle — so the runner is injected rather than
 * imported, and this is the seam that keeps the gate vocabulary in contracts
 * while the process lives in its own package. The worker answers for the
 * outcome: it records every verdict as a `gate-result` artifact and refuses to
 * report a completed run when this port refuses or a required gate did not pass
 * (`REVIEW_GATES_MISSING`). That is also why {@link GateRunResult} carries the
 * refusal as a value: an absent policy or a moved head is a verdict about the
 * attempt, not an exception thrown beside it.
 */
export interface AttemptGatePort {
  /**
   * Run the workspace's policy against the request's pinned head.
   * @param request - the attempt, its worktree, and the head to run against.
   * @param meta - operation identity every refusal is answered with.
   */
  run(request: AttemptGateRequest, meta: OperationMeta): Promise<Result<GateRunResult>>
}
