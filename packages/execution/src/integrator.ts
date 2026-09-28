/**
 * The integrator: the only path from an approved attempt to a `done` task
 * (architecture §9, §19, §48; MW-025, E-25…E-29).
 *
 * §19 binds an approval to the exact head SHA and diff hash the reviewer saw, and
 * MW-025 makes the integrator the place that binding is enforced. The rule is
 * therefore stated as an admission check rather than as a hope: an attempt is
 * integrated only when a review approved **the artifact that is in front of the
 * integrator right now**, and any movement of the attempt's head, of its diff, or
 * of the target branch is a refusal *before* anything is written.
 *
 * The order below is the whole design:
 *
 * 1. **Admission.** Read the attempt, its review, and the task; re-hash the
 *    attempt's diff; compare all of it with what was approved. Nothing is
 *    written — no ledger row, no commit, no graph move — so a refusal leaves the
 *    world exactly as it was.
 * 2. **Landing.** Bring the approved revision into the target checkout *staged*,
 *    then create the integration commit through {@link GitPort.commit} so the
 *    `Refs: mw-<hash>` trailer is written by MyWork and not by a git hook (the
 *    acceptance criterion of the card). A conflict aborts the landing and asks a
 *    human; it is never resolved with a strategy flag.
 * 3. **Gates, again.** A successful merge is not acceptance: the workspace's gate
 *    policy runs against the *new* head with `strict`, and a verdict that belongs
 *    to another head is discarded.
 * 4. **Idempotent finalize.** The graph moves to `done` once, guarded by the
 *    revision the caller observed; a repeat of the same `operationId` replays the
 *    recorded outcome instead of creating a second commit or a second transition.
 *
 * Everything the integrator needs from the outside arrives as a port: git, the
 * task graph, the attempt/review records, the gate policy, the escalation sink,
 * and the clock. This package may import `node:crypto` and nothing else, so it
 * cannot reach a repository, a board, or a wall clock on its own.
 * @module
 */

import { createHash } from 'node:crypto'

import {
  GIT_LANDING_STRATEGIES,
  MYWORK_ERROR_CODES,
  type AttemptId,
  type ClockPort,
  type EpochMs,
  type GateResult,
  type GateRunResult,
  type GitCallOptions,
  type GitLandingStrategy,
  type GitPort,
  type MyWorkErrorCode,
  type MyWorkErrorShape,
  type NeedsAttentionReason,
  type OperationMeta,
  type Result,
  type Review,
  type ReviewId,
  type ReviewedArtifact,
  type Revision,
  type Task,
  type TaskGraphPort,
  type TaskId,
  type WorkspaceId,
} from '@dsh-mywork/contracts'
import { assertRevision, fail, isReviewApprovalCurrent, MyWorkError, ok } from '@dsh-mywork/core'
import type { MyWorkStore } from '@dsh-mywork/storage'

import { ExecutionError } from './errors.ts'
import {
  INTEGRATION_SCHEMA_NAME,
  advanceIntegrationOperation,
  insertIntegrationOperation,
  isIntegrationTerminal,
  readIntegrationOperation,
  type IntegrationOperationRecord,
  type IntegrationState,
} from './integration-schema.ts'
import { CLAIM_SAGA_SCHEMA_NAME, CLAIM_SAGA_SCHEMA_VERSION } from './schema.ts'
import { assertClaimSchema, requireCounter, requireObject, requireText } from './store.ts'

/** Landing strategy the integrator uses when the caller names none. */
export const DEFAULT_LANDING_STRATEGY: GitLandingStrategy = 'merge-no-ff'

/** Prefix of the trailer that links a task to the commit that integrated it. */
export const INTEGRATION_REF_PREFIX = 'Refs: mw-'

/**
 * Why an integration was refused.
 *
 * The catalogue is closed and every member is a fact the integrator observed, so
 * a caller branches on a stable reason instead of on a message. Each reason also
 * names the §42 error code the refusal carries, in {@link INTEGRATION_REFUSAL_CODES}.
 */
export type IntegrationRefusalReason =
  /** No review, or a review that is not `approved` (queued, rejected, needs-evidence, …). */
  | 'review-not-approved'
  /** The task is not in `approved`, so there is nothing to integrate. */
  | 'task-not-approved'
  /** The approval no longer describes the attempt's head or diff. */
  | 'stale-approval'
  /** The target branch moved away from the head the integration was decided on. */
  | 'stale-base'
  /** The target checkout has uncommitted changes. */
  | 'target-dirty'
  /** The `operationId` already has an operation that has not settled. */
  | 'integration-in-progress'
  /** No operation was ever admitted under this `operationId`. */
  | 'integration-not-found'
  /** The operation has no commit yet, so there is nothing to finalize. */
  | 'integration-not-landed'
  /** The integration commit did not move the head, so the trailer was not written. */
  | 'landing-not-staged'
  /** The landed head does not carry the approved patch; the target had diverged. */
  | 'landed-content-mismatch'
  /** A required gate is not green for the integrated head. */
  | 'gate-not-passed'
  /** A verdict belongs to a head other than the integrated one. */
  | 'gate-head-moved'
  /** The task still has a live attempt. */
  | 'live-attempt'
  /** The task still has a review that has not settled. */
  | 'open-review'
  /** Git reported a conflict; the landing was aborted and a human was asked. */
  | 'merge-conflict'

/** Every refusal reason, in the order the integration meets them. */
export const INTEGRATION_REFUSAL_REASONS: readonly IntegrationRefusalReason[] = Object.freeze([
  'review-not-approved',
  'task-not-approved',
  'stale-approval',
  'stale-base',
  'target-dirty',
  'integration-in-progress',
  'integration-not-found',
  'integration-not-landed',
  'landing-not-staged',
  'landed-content-mismatch',
  'gate-not-passed',
  'gate-head-moved',
  'live-attempt',
  'open-review',
  'merge-conflict',
])

/**
 * Code a stale approval is refused with.
 *
 * E-23 adds `STALE_APPROVAL` to the closed §42 catalogue; this module is written
 * against the catalogue as it is *now*, so the code is looked up at run time:
 * while the catalogue does not carry the new member the refusal is answered with
 * `STALE_REVISION`, which is the code core's own `assertReviewApprovalCurrent`
 * already uses for exactly this condition, and the moment the member lands the
 * integrator answers with it without an edit here.
 * @returns the refusal code, read from the catalogue rather than written down.
 */
export function staleApprovalCode(): MyWorkErrorCode {
  return (MYWORK_ERROR_CODES as readonly string[]).includes('STALE_APPROVAL')
    ? ('STALE_APPROVAL' as MyWorkErrorCode)
    : 'STALE_REVISION'
}

/** The §42 code each refusal reason carries. */
export const INTEGRATION_REFUSAL_CODES: Readonly<Record<IntegrationRefusalReason, MyWorkErrorCode>> = Object.freeze({
  'review-not-approved': 'TASK_CONFLICT',
  'task-not-approved': 'TASK_CONFLICT',
  'stale-approval': staleApprovalCode(),
  'stale-base': 'STALE_REVISION',
  'target-dirty': 'TASK_CONFLICT',
  'integration-in-progress': 'TASK_CONFLICT',
  'integration-not-found': 'TASK_CONFLICT',
  'integration-not-landed': 'TASK_CONFLICT',
  'landing-not-staged': 'TASK_CONFLICT',
  'landed-content-mismatch': staleApprovalCode(),
  'gate-not-passed': 'TASK_CONFLICT',
  'gate-head-moved': 'TASK_CONFLICT',
  'live-attempt': 'TASK_CONFLICT',
  'open-review': 'TASK_CONFLICT',
  'merge-conflict': 'TASK_CONFLICT',
})

/** §28 decision the integrator asks for when it cannot reconcile a conflict itself. */
export const INTEGRATION_DECISION_OPTIONS: readonly string[] = Object.freeze([
  'reconcile-by-hand',
  'retry-with-a-fresh-attempt',
])

/**
 * The `Refs: mw-<hash>` trailer of one task.
 *
 * The hash is derived from the task id alone, so the same task always produces the
 * same trailer and a reader can recognise the commit without consulting MyWork —
 * which is what makes the link independent of any installed git hook. `E-07`
 * derives an attempt's `runId` the same way; that helper does not exist yet, so
 * this one is local and is the single place the derivation is written here.
 * @param taskId - task the commit belongs to.
 * @returns the trailer line, without a trailing newline.
 */
export function taskRefTrailer(taskId: TaskId): string {
  const hash = createHash('sha256').update(`mywork-task:${taskId}`).digest('hex').slice(0, 12)
  return `${INTEGRATION_REF_PREFIX}${hash}`
}

/**
 * The full commit message the integrator writes.
 *
 * The trailer is part of the message handed to git, never appended by a hook:
 * a hook is configuration a workspace may not have, and the card's acceptance
 * criterion asks for a link that survives that.
 * @param taskId - task the commit belongs to.
 * @param summary - one-line subject; a default naming the task is used when absent.
 * @returns subject, blank line, trailer.
 */
export function integrationCommitMessage(taskId: TaskId, summary?: string): string {
  const subject = summary === undefined || summary.trim() === '' ? `Integrate ${taskId}` : summary.trim()
  return `${subject}\n\n${taskRefTrailer(taskId)}\n`
}

/** What the integrator must know about an attempt before it may land it. */
export interface IntegrationSubject {
  /** Task the attempt belongs to. */
  readonly taskId: TaskId
  /** Attempt whose approved result is integrated. */
  readonly attemptId: AttemptId
  /** Workspace the task belongs to. */
  readonly workspaceId: WorkspaceId
  /** Checkout of the branch the result is integrated into. */
  readonly targetPath: string
  /** Worktree holding the attempt. */
  readonly attemptPath: string
  /**
   * Revision the attempt started from. The target branch must still be at this
   * revision, because an approval describes a patch against a base; integrating
   * onto a moved branch would land a patch nobody reviewed.
   */
  readonly baseSha: string
  /** Head the attempt ended on. */
  readonly headSha: string
  /** Diff hash recorded for the attempt. */
  readonly diffHash: string
  /**
   * Head of the target branch the caller observed when it decided to integrate.
   *
   * The integration is admitted only while the branch is still there: an
   * approval describes a patch against a base, and a branch that moved under the
   * decision is a fact the caller has to look at again rather than one the
   * integrator may merge past.
   */
  readonly targetHeadSha: string
}

/**
 * What the integrator reads about an attempt, its review, and its task.
 *
 * Four narrow reads rather than one wide port: each answers a question the
 * admission or the finalize asks, and a composition can adapt them from the
 * attempt table (`E-04`), the review queue (`E-19`), and the graph projection.
 */
export interface IntegrationRecordPort {
  /**
   * Read the attempt and the paths it is integrated from.
   * @param attemptId - attempt to read.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   */
  read(attemptId: AttemptId, meta: OperationMeta, options?: GitCallOptions): Promise<Result<IntegrationSubject>>
  /**
   * Read the review of an attempt.
   * @param attemptId - attempt whose review is wanted.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   * @returns the review, or `undefined` when none was requested.
   */
  reviewOf(attemptId: AttemptId, meta: OperationMeta, options?: GitCallOptions): Promise<Result<Review | undefined>>
  /**
   * Attempts of a task that have not settled.
   * @param taskId - task to inspect.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   */
  liveAttempts(taskId: TaskId, meta: OperationMeta, options?: GitCallOptions): Promise<Result<readonly AttemptId[]>>
  /**
   * Reviews of a task that have not reached a terminal state.
   * @param taskId - task to inspect.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   */
  openReviews(taskId: TaskId, meta: OperationMeta, options?: GitCallOptions): Promise<Result<readonly ReviewId[]>>
}

/** What the integrator asks the workspace's gate policy for. */
export interface IntegrationGateRequest {
  /** Workspace whose policy decides the gate set. */
  readonly workspaceId: WorkspaceId
  /** Checkout the gates run in: the target branch, after the landing. */
  readonly cwd: string
  /**
   * Whether every configured gate must pass. The integrator always sends `true`,
   * which is why a gate result needs no per-gate `required` flag here: under
   * `strict` the policy has already decided that each of its gates matters.
   */
  readonly strict: boolean
}

/** Runs the workspace's gate policy against one head (`E-14`/`E-16`). */
export interface IntegrationGatePort {
  /**
   * Run the policy.
   * @param request - workspace, checkout, and strictness.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   * @returns one verdict per gate, plus the head they belong to.
   */
  run(request: IntegrationGateRequest, meta: OperationMeta, options?: GitCallOptions): Promise<Result<GateRunResult>>
}

/** One escalation the integrator raises when it cannot finish alone. */
export interface IntegrationAttentionRequest {
  /** Task that needs a human. */
  readonly taskId: TaskId
  /** Attempt whose integration stopped. */
  readonly attemptId: AttemptId
  /** Closed-catalogue reason of the board (`packages/contracts/src/board.ts`). */
  readonly reason: NeedsAttentionReason
  /** One-line, concrete detail for the board row. */
  readonly detail: string
  /** Clock reading of the escalation. */
  readonly at: EpochMs
}

/**
 * A request for a human decision.
 *
 * The durable `HumanDecision` entity is `D14`/`MW-030`; this is the request the
 * integrator files, and the port answers with its marker. Nothing here waits for
 * an answer: §28's gate must free the worker session rather than hold it open
 * (`00-RECON.md:284`, `Q-19`), so the decision is a durable record the operator
 * answers later, never a blocking prompt.
 */
export interface IntegrationDecisionRequest {
  /** Task the decision is about. */
  readonly taskId: TaskId
  /** Attempt whose integration stopped. */
  readonly attemptId: AttemptId
  /** Reason the board already carries. */
  readonly reason: NeedsAttentionReason
  /** The question, phrased for an operator. */
  readonly question: string
  /** Answers the integrator can act on. */
  readonly options: readonly string[]
  /** Clock reading of the request. */
  readonly requestedAt: EpochMs
}

/**
 * Where the integrator records an escalation.
 *
 * Both methods are non-blocking by construction: they return a marker, never an
 * answer, so no path in this module can wait on a human.
 */
export interface IntegrationEscalationPort {
  /**
   * Record that a task needs attention.
   * @param request - task, attempt, reason, and detail.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   * @returns the marker of the recorded row.
   */
  raise(request: IntegrationAttentionRequest, meta: OperationMeta, options?: GitCallOptions): Promise<Result<string>>
  /**
   * File a request for a human decision.
   * @param request - task, attempt, question, and answers.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   * @returns the marker of the requested decision.
   */
  requestDecision(request: IntegrationDecisionRequest, meta: OperationMeta, options?: GitCallOptions): Promise<Result<string>>
}

/** One integration run. */
export interface IntegrationCommand {
  /** Attempt whose approved result is integrated. */
  readonly attemptId: AttemptId
  /** Revision of the task the caller observed, i.e. the `approved` revision. */
  readonly expectedRevision: Revision
  /**
   * How to bring the revision in. Absent uses {@link DEFAULT_LANDING_STRATEGY};
   * the integrator never chooses a rewriting strategy on its own.
   */
  readonly strategy?: GitLandingStrategy
  /** Commit subject; the `Refs:` trailer is added by the integrator. */
  readonly summary?: string
  /** Operation identity; `operationId` is the idempotency key of the run. */
  readonly meta: OperationMeta
}

/** A repeat of the final step, or the step a caller runs after a crash. */
export interface IntegrationFinalizeCommand {
  /** Revision of the task the caller observed. */
  readonly expectedRevision: Revision
  /** Operation identity; the same `operationId` replays the same outcome. */
  readonly meta: OperationMeta
}

/** The escalation an operation settled with; `null` when it settled without one. */
export interface IntegrationEscalation {
  /** Why the task needs a human. */
  readonly reason: NeedsAttentionReason
  /** Marker of the board row that carries the reason. */
  readonly marker: string
  /** Marker of the requested human decision; empty when none could be filed. */
  readonly decisionMarker: string
}

/** What one integration produced. */
export interface IntegrationOutcome {
  /** Operation the outcome belongs to. */
  readonly operationId: string
  /** Task under integration. */
  readonly taskId: TaskId
  /** Attempt whose result was integrated. */
  readonly attemptId: AttemptId
  /** Workspace the task belongs to. */
  readonly workspaceId: WorkspaceId
  /** Where the operation stopped. */
  readonly state: IntegrationState
  /** How the revision was brought in. */
  readonly strategy: GitLandingStrategy
  /** Revision the attempt started from. */
  readonly baseSha: string
  /** Head the approval was bound to. */
  readonly approvedHeadSha: string
  /** Diff hash the approval was bound to. */
  readonly approvedDiffHash: string
  /** Head after the integrator's commit; `null` when nothing landed. */
  readonly landedHeadSha: string | null
  /** Commit the integrator created, carrying the trailer. */
  readonly commitSha: string | null
  /** Revision the graph reported when the task became `done`. */
  readonly graphRevision: number | null
  /** Gate verdicts of the last run for the integrated head. */
  readonly gates: readonly GateResult[]
  /** The escalation this operation settled with. */
  readonly escalation: IntegrationEscalation | null
  /** Clock reading of the last write of the operation. */
  readonly at: EpochMs
}

/** What the integrator needs to run. */
export interface IntegratorDeps {
  /** Store opened with the claim-saga schema and the integration ledger. */
  readonly store: MyWorkStore
  /** Git port; the only way this layer touches a repository. */
  readonly git: GitPort
  /** Task graph the final transition writes through. */
  readonly graph: TaskGraphPort
  /** Attempt, review, and open-work reads. */
  readonly records: IntegrationRecordPort
  /** Gate policy runner of the workspace. */
  readonly gates: IntegrationGatePort
  /** Where `needs-attention` and the human decision request are recorded. */
  readonly escalation: IntegrationEscalationPort
  /** Time source; a fake clock keeps the integrator deterministic in tests. */
  readonly clock: ClockPort
  /**
   * Version the allocator gave the integration migration (`D08`, `F-63`).
   *
   * The integrator asserts the ledger is on disk at exactly this version, so a
   * composition that allocated a different number fails where it was wired.
   */
  readonly integrationSchemaVersion: number
}

/**
 * The integrator's surface.
 *
 * `integrate` runs admission, landing, gates, and finalize. `finalize` is the same
 * last step on its own, for a caller that has to finish an operation a crash left
 * behind; both are idempotent per `operationId`.
 */
export interface Integrator {
  /** Admit, land, gate, and finalize one approved attempt. */
  integrate(command: IntegrationCommand): Promise<Result<IntegrationOutcome>>
  /** Finish an admitted operation: move the task to `done`, exactly once. */
  finalize(command: IntegrationFinalizeCommand): Promise<Result<IntegrationOutcome>>
  /** Read the ledger row of one operation, for an operator or a test. */
  operation(operationId: string): IntegrationOperationRecord | undefined
}

/** Failure codes a port may raise from a guard, before the integrator can have written anything. */
const GUARDED_CODES: readonly string[] = Object.freeze([
  'STALE_REVISION',
  'TASK_CONFLICT',
  'STALE_FENCE',
  'LEASE_LOST',
  'SECURITY_DENIED',
  'ADAPTER_UNAVAILABLE',
  'CAPABILITY_UNSUPPORTED',
  'CONTRACT_MISMATCH',
])

/**
 * Whether a thrown value is a typed refusal the caller can act on.
 *
 * The check reads `code` structurally rather than through `instanceof`, because
 * every package here bundles its dependencies and the adapter that answers the
 * task graph carries its own copy of the error class.
 * @param error - value thrown by a port.
 */
function refusalShape(error: unknown): MyWorkErrorShape | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { code, message, details } = error as {
    readonly code?: unknown
    readonly message?: unknown
    readonly details?: unknown
  }
  if (typeof code !== 'string' || !GUARDED_CODES.includes(code)) return undefined
  return {
    code: code as MyWorkErrorCode,
    message: typeof message === 'string' ? message : `dsh-mywork: the task graph refused with ${code}`,
    details:
      typeof details === 'object' && details !== null
        ? (details as Readonly<Record<string, unknown>>)
        : Object.freeze({ code }),
  }
}

/** Serialise a refusal for the ledger. */
function serializeRefusal(error: MyWorkErrorShape): string {
  return JSON.stringify({ code: error.code, message: error.message, details: error.details })
}

/** Read a serialised refusal back; `undefined` for an absent or unreadable value. */
function parseRefusal(text: string | null): MyWorkErrorShape | undefined {
  if (text === null) return undefined
  try {
    const parsed = JSON.parse(text) as { readonly code?: unknown; readonly message?: unknown; readonly details?: unknown }
    if (typeof parsed.code !== 'string' || typeof parsed.message !== 'string') return undefined
    return Object.freeze({
      code: parsed.code as MyWorkErrorCode,
      message: parsed.message,
      details:
        typeof parsed.details === 'object' && parsed.details !== null
          ? (parsed.details as Readonly<Record<string, unknown>>)
          : Object.freeze({}),
    })
  } catch {
    return undefined
  }
}

/** Read serialised gate results back; `undefined` for an absent or unreadable value. */
function parseGates(text: string | null): readonly GateResult[] | undefined {
  if (text === null) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? Object.freeze(parsed as readonly GateResult[]) : undefined
  } catch {
    return undefined
  }
}

/** Whether every verdict of a gate run admits the head it ran against. */
function gatesAllPass(results: readonly GateResult[] | undefined): boolean {
  return results !== undefined && results.length > 0 && results.every(result => result.verdict === 'pass')
}

/**
 * Build the integrator over one store, one repository, and one task graph.
 * @param deps - store, ports, clock, and the allocated schema version.
 * @throws {ExecutionError} `schema-missing` when the store lacks a schema this layer writes through.
 */
export function createIntegrator(deps: IntegratorDeps): Integrator {
  const { store, git, graph, records, gates, escalation } = deps
  store.transaction(tx =>
    assertClaimSchema(tx, [
      { version: CLAIM_SAGA_SCHEMA_VERSION, name: CLAIM_SAGA_SCHEMA_NAME },
      { version: deps.integrationSchemaVersion, name: INTEGRATION_SCHEMA_NAME },
    ]),
  )
  const now = (): EpochMs => deps.clock.now()

  /** Read one ledger row. */
  function readRow(operationId: string): IntegrationOperationRecord | undefined {
    return store.transaction(tx => readIntegrationOperation(tx, operationId))
  }

  /** Write a refusal into the ledger without moving the operation. */
  function noteRefusal(record: IntegrationOperationRecord, error: MyWorkErrorShape): void {
    store.transaction(tx =>
      advanceIntegrationOperation(tx, record.operationId, record.state, {
        refusal: serializeRefusal(error),
        at: now(),
      }),
    )
  }

  /** Build the refusal of one reason, carrying the reason as a detail. */
  function refuse<T = never>(
    reason: IntegrationRefusalReason,
    message: string,
    details: Readonly<Record<string, unknown>>,
    meta: OperationMeta,
  ): Result<T> {
    return fail(
      new MyWorkError(INTEGRATION_REFUSAL_CODES[reason], `dsh-mywork: ${message}`, {
        details: Object.freeze({ reason, ...details }),
      }),
      meta,
    )
  }

  /** Read the task, mapping a typed graph refusal and rethrowing anything else. */
  async function readTask(taskId: TaskId, meta: OperationMeta): Promise<Result<Task>> {
    try {
      return ok(Object.freeze(await graph.get(taskId)), meta)
    } catch (error) {
      const refusal = refusalShape(error)
      if (refusal !== undefined) return fail(refusal, meta)
      throw error
    }
  }

  /** Move the task, mapping a typed graph refusal and rethrowing anything else. */
  async function transition(
    taskId: TaskId,
    to: Task['state'],
    expectedRevision: Revision,
    meta: OperationMeta,
  ): Promise<Result<Task>> {
    try {
      const task = await graph.transition({ id: taskId, to, expectedRevision, meta })
      return ok(Object.freeze(task), meta)
    } catch (error) {
      const refusal = refusalShape(error)
      if (refusal !== undefined) return fail(refusal, meta)
      throw error
    }
  }

  /** Rebuild the frozen outcome of a ledger row. */
  function toOutcome(record: IntegrationOperationRecord): IntegrationOutcome {
    const escalationState =
      record.attentionReason === null || record.attentionMarker === null
        ? null
        : Object.freeze({
            reason: record.attentionReason as NeedsAttentionReason,
            marker: record.attentionMarker,
            decisionMarker: record.decisionMarker ?? '',
          })
    return Object.freeze({
      operationId: record.operationId,
      taskId: record.taskId,
      attemptId: record.attemptId,
      workspaceId: record.workspaceId,
      state: record.state,
      strategy: record.strategy,
      baseSha: record.baseSha,
      approvedHeadSha: record.approvedHeadSha,
      approvedDiffHash: record.approvedDiffHash,
      landedHeadSha: record.landedHeadSha,
      commitSha: record.commitSha,
      graphRevision: record.graphRevision,
      gates: parseGates(record.gates) ?? Object.freeze([]),
      escalation: escalationState,
      at: record.updatedAt,
    })
  }

  /**
   * Replay a settled operation, or `undefined` when the operation still owes work.
   *
   * The state decides, not the refusal column: a `done` operation whose earlier
   * graph call failed still settled successfully, and the refusal recorded at the
   * time is a diagnostic an operator reads rather than the outcome a retry gets.
   * Only `needs-attention` is a refusal the caller must see again.
   */
  function replay(record: IntegrationOperationRecord, meta: OperationMeta): Result<IntegrationOutcome> | undefined {
    if (!isIntegrationTerminal(record.state)) return undefined
    if (record.state === 'needs-attention') {
      const refusal = parseRefusal(record.refusal)
      if (refusal !== undefined) return fail(refusal, meta)
    }
    return ok(toOutcome(record), meta)
  }

  /** Read the attempt, its review, and the task; refuse unless the approval is current. */
  async function admit(
    command: IntegrationCommand,
    meta: OperationMeta,
  ): Promise<Result<IntegrationSubject>> {
    const subject = await records.read(command.attemptId, meta)
    if (!subject.ok) return fail(subject.error, meta)
    const review = await records.reviewOf(command.attemptId, meta)
    if (!review.ok) return fail(review.error, meta)
    const task = await readTask(subject.value.taskId, meta)
    if (!task.ok) return fail(task.error, meta)

    if (task.value.state !== 'approved') {
      return refuse(
        'task-not-approved',
        `task "${task.value.id}" is "${task.value.state}", not "approved"`,
        { taskId: task.value.id, state: task.value.state },
        meta,
      )
    }
    const revision = assertRevision(command.expectedRevision, task.value.revision, meta)
    if (!revision.ok) return fail(revision.error, meta)

    if (review.value === undefined || review.value.state !== 'approved') {
      return refuse(
        'review-not-approved',
        `attempt "${command.attemptId}" has no approved review (state: ${review.value?.state ?? 'none'})`,
        { reviewId: review.value?.id ?? null, state: review.value?.state ?? null },
        meta,
      )
    }

    // The recorded artifact of the attempt must be the one the reviewer approved.
    const recorded: ReviewedArtifact = Object.freeze({
      headSha: subject.value.headSha,
      diffHash: subject.value.diffHash,
    })
    if (!isReviewApprovalCurrent(review.value, recorded)) {
      return refuse(
        'stale-approval',
        `review "${review.value.id}" does not approve the artifact of attempt "${command.attemptId}"`,
        { reviewId: review.value.id, reviewed: review.value.artifact ?? null, current: recorded },
        meta,
      )
    }

    // The repository must still show that artifact, and the target must not have moved.
    const clean = await git.isClean(subject.value.targetPath, meta)
    if (!clean.ok) return fail(clean.error, meta)
    if (!clean.value) {
      return refuse('target-dirty', `the target checkout "${subject.value.targetPath}" has uncommitted changes`, {
        targetPath: subject.value.targetPath,
      }, meta)
    }
    const targetHead = await git.resolveHead(subject.value.targetPath, meta)
    if (!targetHead.ok) return fail(targetHead.error, meta)
    if (targetHead.value !== subject.value.targetHeadSha) {
      return refuse(
        'stale-base',
        `the target branch is at "${targetHead.value}" while the integration was decided on "${subject.value.targetHeadSha}"`,
        { targetHead: targetHead.value, observedTargetHead: subject.value.targetHeadSha, baseSha: subject.value.baseSha },
        meta,
      )
    }
    const attemptHead = await git.resolveHead(subject.value.attemptPath, meta)
    if (!attemptHead.ok) return fail(attemptHead.error, meta)
    if (attemptHead.value !== subject.value.headSha) {
      return refuse(
        'stale-approval',
        `attempt "${command.attemptId}" moved from "${subject.value.headSha}" to "${attemptHead.value}" after the approval`,
        { reviewed: subject.value.headSha, current: attemptHead.value },
        meta,
      )
    }
    const diffNow = await git.diffHash(subject.value.attemptPath, subject.value.baseSha, attemptHead.value, meta)
    if (!diffNow.ok) return fail(diffNow.error, meta)
    if (diffNow.value !== recorded.diffHash || diffNow.value !== review.value.artifact?.diffHash) {
      return refuse(
        'stale-approval',
        `the diff of attempt "${command.attemptId}" is "${diffNow.value}", not the approved "${String(review.value.artifact?.diffHash)}"`,
        { reviewed: review.value.artifact?.diffHash ?? null, current: diffNow.value },
        meta,
      )
    }
    return ok(subject.value, meta)
  }

  /** Ensure the graph holds the task in `integrating`; report the revision it observed. */
  async function ensureIntegrating(
    record: IntegrationOperationRecord,
    meta: OperationMeta,
  ): Promise<Result<Revision>> {
    const task = await readTask(record.taskId, meta)
    if (!task.ok) return fail(task.error, meta)
    if (task.value.state === 'integrating') return ok(task.value.revision, meta)
    if (task.value.state === 'done') return ok(task.value.revision, meta)
    if (task.value.state !== 'approved') {
      return refuse(
        'task-not-approved',
        `task "${task.value.id}" is "${task.value.state}", not "approved"`,
        { taskId: task.value.id, state: task.value.state },
        meta,
      )
    }
    const moved = await transition(record.taskId, 'integrating', task.value.revision, meta)
    if (!moved.ok) return fail(moved.error, meta)
    return ok(moved.value.revision, meta)
  }

  /**
   * Land the approved revision and create the integration commit.
   *
   * The subject is the caller's; on a resumed landing it comes from the retry,
   * which is harmless because the link the acceptance criterion names is the
   * trailer, and the trailer is derived from the task id and never varies.
   */
  async function land(
    record: IntegrationOperationRecord,
    subject: IntegrationSubject,
    meta: OperationMeta,
    summary?: string,
  ): Promise<Result<IntegrationOperationRecord>> {
    const before = await git.resolveHead(subject.targetPath, meta)
    if (!before.ok) return fail(before.error, meta)
    const landed = await git.land({ cwd: subject.targetPath, revision: record.approvedHeadSha, strategy: record.strategy }, meta)
    if (!landed.ok) {
      noteRefusal(record, landed.error)
      return fail(landed.error, meta)
    }
    if (landed.value.conflicted) {
      return conflict(record, subject, landed.value.conflictedPaths, meta)
    }

    // The trailer belongs to a commit this layer writes, so the link does not
    // depend on a git hook being installed (the card's acceptance criterion).
    // Whether the port left the bring-in staged or committed it itself, the
    // commit below is the one whose body a reader will find the trailer in.
    const committed = await git.commit(
      { cwd: subject.targetPath, message: integrationCommitMessage(record.taskId, summary) },
      meta,
    )
    if (!committed.ok) {
      const aborted = await git.abortLanding(subject.targetPath, meta)
      noteRefusal(record, committed.error)
      if (!aborted.ok) return fail(aborted.error, meta)
      return fail(committed.error, meta)
    }
    const landedHead = await git.resolveHead(subject.targetPath, meta)
    if (!landedHead.ok) return fail(landedHead.error, meta)
    if (landedHead.value === before.value) {
      // Nothing was committed, so the trailer was not written either: the port's
      // `land` must leave the bring-in staged, or its `commit` must be able to
      // create the integration commit. Refusing here keeps the link from being
      // silently absent, which is the one thing this step exists to prevent.
      return refuse(
        'landing-not-staged',
        `the integration commit of "${subject.targetPath}" did not move the head from "${before.value}"`,
        { before: before.value, commitSha: committed.value },
        meta,
      )
    }
    const landedDiff = await git.diffHash(subject.targetPath, record.baseSha, landedHead.value, meta)
    if (!landedDiff.ok) return fail(landedDiff.error, meta)
    if (landedDiff.value !== record.approvedDiffHash) {
      // The branch now carries a commit that is not the approved patch — the merge
      // combined work the reviewer never saw. That is a decision for a human, never
      // something to continue past.
      return mismatch(record, subject, landedHead.value, landedDiff.value, meta)
    }
    const stored = store.transaction(tx =>
      advanceIntegrationOperation(tx, record.operationId, record.state, {
        state: 'landed',
        landedHeadSha: landedHead.value,
        commitSha: committed.value,
        at: now(),
      }),
    )
    if (!stored) {
      throw new ExecutionError(
        'conflict',
        `dsh-mywork: the integration operation "${record.operationId}" moved while recording its landing`,
        { details: { operationId: record.operationId } },
      )
    }
    const next = readRow(record.operationId)
    if (next === undefined) {
      throw new ExecutionError('not-found', `dsh-mywork: the integration operation "${record.operationId}" disappeared`, {
        details: { operationId: record.operationId },
      })
    }
    return ok(next, meta)
  }

  /** Abort a conflicted landing, ask a human, and settle the operation. */
  async function conflict(
    record: IntegrationOperationRecord,
    subject: IntegrationSubject,
    conflictedPaths: readonly string[],
    meta: OperationMeta,
  ): Promise<Result<IntegrationOperationRecord>> {
    const aborted = await git.abortLanding(subject.targetPath, meta)
    if (!aborted.ok) return fail(aborted.error, meta)
    const clean = await git.isClean(subject.targetPath, meta)
    if (!clean.ok) return fail(clean.error, meta)
    const detail = `the landing of attempt "${record.attemptId}" conflicts in ${conflictedPaths.length === 0 ? 'the target checkout' : conflictedPaths.join(', ')}`
    return settleWithHuman(record, 'merge-conflict', detail, {
      conflictedPaths: [...conflictedPaths],
      targetClean: clean.value,
    }, meta)
  }

  /** Escalate a landed head that does not carry the approved patch. */
  async function mismatch(
    record: IntegrationOperationRecord,
    subject: IntegrationSubject,
    landedHead: string,
    landedDiff: string,
    meta: OperationMeta,
  ): Promise<Result<IntegrationOperationRecord>> {
    const detail = `the landed head "${landedHead}" carries diff "${landedDiff}", not the approved "${record.approvedDiffHash}"`
    return settleWithHuman(record, 'landed-content-mismatch', detail, {
      landedHeadSha: landedHead,
      landedDiffHash: landedDiff,
      approvedDiffHash: record.approvedDiffHash,
      targetPath: subject.targetPath,
    }, meta)
  }

  /**
   * Record `needs-attention`, file the human decision, and settle the operation.
   *
   * The order matters: the board row and the decision request are written even
   * when the graph move fails, because losing the escalation would be worse than
   * a task left in `integrating` — the human record is what makes the divergence
   * recoverable, and the refusal carries the graph failure as a detail.
   */
  async function settleWithHuman(
    record: IntegrationOperationRecord,
    reason: IntegrationRefusalReason,
    detail: string,
    details: Readonly<Record<string, unknown>>,
    meta: OperationMeta,
  ): Promise<Result<IntegrationOperationRecord>> {
    const attentionReason: NeedsAttentionReason = 'reconciliation-divergence'
    const observed = await ensureIntegrating(record, meta)
    const moved = observed.ok
      ? await transition(record.taskId, 'needs-attention', observed.value, meta)
      : observed
    const raised = await escalation.raise(
      { taskId: record.taskId, attemptId: record.attemptId, reason: attentionReason, detail, at: now() },
      meta,
    )
    let decisionMarker: string | undefined
    let escalationFailure: string | undefined
    if (!raised.ok) {
      escalationFailure = raised.error.code
    } else {
      const decision = await escalation.requestDecision(
        {
          taskId: record.taskId,
          attemptId: record.attemptId,
          reason: attentionReason,
          question: `task "${record.taskId}" cannot be integrated automatically: ${detail}`,
          options: INTEGRATION_DECISION_OPTIONS,
          requestedAt: now(),
        },
        meta,
      )
      if (decision.ok) decisionMarker = decision.value
      else escalationFailure = decision.error.code
    }
    const error = new MyWorkError(INTEGRATION_REFUSAL_CODES[reason], `dsh-mywork: ${detail}`, {
      details: Object.freeze({
        reason,
        ...details,
        taskMoved: moved.ok,
        ...(moved.ok ? {} : { taskMoveFailure: moved.error.code }),
        ...(escalationFailure === undefined ? {} : { escalationFailure }),
      }),
    })
    store.transaction(tx =>
      advanceIntegrationOperation(tx, record.operationId, record.state, {
        state: 'needs-attention',
        refusal: serializeRefusal(error),
        attentionReason,
        ...(raised.ok ? { attentionMarker: raised.value } : {}),
        ...(decisionMarker === undefined ? {} : { decisionMarker }),
        at: now(),
      }),
    )
    return fail(error, meta)
  }

  /** Run the workspace's gates against the integrated head. */
  async function runGates(
    record: IntegrationOperationRecord,
    subject: IntegrationSubject,
    meta: OperationMeta,
  ): Promise<Result<IntegrationOperationRecord>> {
    if (record.landedHeadSha === null) {
      return refuse('integration-not-landed', `integration "${record.operationId}" has no landed head`, {
        operationId: record.operationId,
      }, meta)
    }
    if (gatesAllPass(parseGates(record.gates))) return ok(record, meta)

    const run = await gates.run({ workspaceId: record.workspaceId, cwd: subject.targetPath, strict: true }, meta)
    if (!run.ok) {
      noteRefusal(record, run.error)
      return fail(run.error, meta)
    }
    const headSha = record.landedHeadSha
    const foreign = run.value.results.filter(result => result.headSha !== headSha)
    if (run.value.headSha !== headSha || foreign.length > 0) {
      const detail = `the gate run reports head "${run.value.headSha}" while the integrated head is "${headSha}"`
      return settleWithHuman(record, 'gate-head-moved', detail, {
        gateHeadSha: run.value.headSha,
        landedHeadSha: headSha,
        foreignGates: foreign.map(result => result.id),
      }, meta)
    }
    const serialized = JSON.stringify(run.value.results)
    const passing = run.value.refusal === undefined && gatesAllPass(run.value.results)
    const stored = store.transaction(tx =>
      advanceIntegrationOperation(tx, record.operationId, record.state, {
        state: passing ? record.state : 'gated',
        gates: serialized,
        at: now(),
      }),
    )
    if (!stored) {
      throw new ExecutionError(
        'conflict',
        `dsh-mywork: the integration operation "${record.operationId}" moved while recording its gate run`,
        { details: { operationId: record.operationId } },
      )
    }
    if (!passing) {
      const failed = run.value.results.filter(result => result.verdict !== 'pass').map(result => `${result.id}:${result.verdict}`)
      const error = new MyWorkError(INTEGRATION_REFUSAL_CODES['gate-not-passed'], 'dsh-mywork: the integrated head is not green', {
        details: Object.freeze({
          reason: 'gate-not-passed',
          headSha,
          refusal: run.value.refusal ?? null,
          failed,
        }),
      })
      noteRefusal({ ...record, state: 'gated' }, error)
      return fail(error, meta)
    }
    const next = readRow(record.operationId)
    if (next === undefined) {
      throw new ExecutionError('not-found', `dsh-mywork: the integration operation "${record.operationId}" disappeared`, {
        details: { operationId: record.operationId },
      })
    }
    return ok(next, meta)
  }

  /** Move the task to `done` once, guarded by the revision the caller observed. */
  async function finalizeRow(
    record: IntegrationOperationRecord,
    expectedRevision: Revision,
    meta: OperationMeta,
  ): Promise<Result<IntegrationOutcome>> {
    const replayed = replay(record, meta)
    if (replayed !== undefined) return replayed
    if (record.landedHeadSha === null) {
      return refuse('integration-not-landed', `integration "${record.operationId}" has no landed head`, {
        operationId: record.operationId,
      }, meta)
    }
    const review = await records.reviewOf(record.attemptId, meta)
    if (!review.ok) return fail(review.error, meta)
    if (review.value === undefined || review.value.state !== 'approved') {
      return refuse(
        'review-not-approved',
        `attempt "${record.attemptId}" has no approved review (state: ${review.value?.state ?? 'none'})`,
        { reviewId: review.value?.id ?? null, state: review.value?.state ?? null },
        meta,
      )
    }
    const approved: ReviewedArtifact = Object.freeze({
      headSha: record.approvedHeadSha,
      diffHash: record.approvedDiffHash,
    })
    if (!isReviewApprovalCurrent(review.value, approved)) {
      return refuse(
        'stale-approval',
        `review "${review.value.id}" no longer approves the artifact of attempt "${record.attemptId}"`,
        { reviewId: review.value.id, reviewed: review.value.artifact ?? null, current: approved },
        meta,
      )
    }
    if (!gatesAllPass(parseGates(record.gates))) {
      return refuse('gate-not-passed', `integration "${record.operationId}" has no green gate run for "${record.landedHeadSha}"`, {
        operationId: record.operationId,
        landedHeadSha: record.landedHeadSha,
      }, meta)
    }
    const live = await records.liveAttempts(record.taskId, meta)
    if (!live.ok) return fail(live.error, meta)
    if (live.value.length > 0) {
      return refuse('live-attempt', `task "${record.taskId}" still has a live attempt`, {
        taskId: record.taskId,
        attempts: [...live.value],
      }, meta)
    }
    const open = await records.openReviews(record.taskId, meta)
    if (!open.ok) return fail(open.error, meta)
    if (open.value.length > 0) {
      return refuse('open-review', `task "${record.taskId}" still has an open review`, {
        taskId: record.taskId,
        reviews: [...open.value],
      }, meta)
    }

    const moved = await transition(record.taskId, 'done', expectedRevision, meta)
    if (!moved.ok) {
      noteRefusal(record, moved.error)
      return fail(moved.error, meta)
    }
    const stored = store.transaction(tx =>
      advanceIntegrationOperation(tx, record.operationId, record.state, {
        state: 'done',
        graphRevision: moved.value.revision,
        at: now(),
      }),
    )
    if (!stored) {
      throw new ExecutionError(
        'conflict',
        `dsh-mywork: the integration operation "${record.operationId}" moved while recording its completion`,
        { details: { operationId: record.operationId } },
      )
    }
    const next = readRow(record.operationId)
    if (next === undefined) {
      throw new ExecutionError('not-found', `dsh-mywork: the integration operation "${record.operationId}" disappeared`, {
        details: { operationId: record.operationId },
      })
    }
    return ok(toOutcome(next), meta)
  }

  /** Finish an operation that already exists: resume the landing, the gates, and the move. */
  async function resume(
    record: IntegrationOperationRecord,
    meta: OperationMeta,
    summary?: string,
  ): Promise<Result<IntegrationOutcome>> {
    const replayed = replay(record, meta)
    if (replayed !== undefined) return replayed
    const subject = await records.read(record.attemptId, meta)
    if (!subject.ok) return fail(subject.error, meta)

    const observed = await ensureIntegrating(record, meta)
    if (!observed.ok) return fail(observed.error, meta)

    // The graph may already carry `done` while the ledger still owes the last
    // write: the transition committed and the crash followed it. Finish the book
    // rather than integrate a second time.
    const task = await readTask(record.taskId, meta)
    if (!task.ok) return fail(task.error, meta)
    if (task.value.state === 'done' && record.landedHeadSha !== null) {
      store.transaction(tx =>
        advanceIntegrationOperation(tx, record.operationId, record.state, {
          state: 'done',
          graphRevision: task.value.revision,
          at: now(),
        }),
      )
      const settled = readRow(record.operationId)
      if (settled !== undefined) return ok(toOutcome(settled), meta)
    }

    let current = record
    if (current.landedHeadSha === null) {
      const landed = await land(current, subject.value, meta, summary)
      if (!landed.ok) return fail(landed.error, meta)
      current = landed.value
    }
    const gated = await runGates(current, subject.value, meta)
    if (!gated.ok) return fail(gated.error, meta)
    return finalizeRow(gated.value, observed.value, meta)
  }

  return Object.freeze({
    async integrate(command: IntegrationCommand): Promise<Result<IntegrationOutcome>> {
      const meta = requireCommand(command)
      const existing = readRow(meta.operationId)
      if (existing !== undefined) return resume(existing, meta)

      const admitted = await admit(command, meta)
      if (!admitted.ok) return fail(admitted.error, meta)

      const strategy = command.strategy ?? DEFAULT_LANDING_STRATEGY
      if (!(GIT_LANDING_STRATEGIES as readonly string[]).includes(strategy)) {
        throw new ExecutionError('invalid-input', `dsh-mywork: unknown landing strategy "${String(strategy)}"`)
      }
      const at = now()
      const record: IntegrationOperationRecord = Object.freeze({
        operationId: meta.operationId,
        taskId: admitted.value.taskId,
        attemptId: admitted.value.attemptId,
        workspaceId: admitted.value.workspaceId,
        state: 'landing',
        strategy,
        baseSha: admitted.value.baseSha,
        approvedHeadSha: admitted.value.headSha,
        approvedDiffHash: admitted.value.diffHash,
        landedHeadSha: null,
        commitSha: null,
        graphRevision: null,
        gates: null,
        refusal: null,
        attentionReason: null,
        attentionMarker: null,
        decisionMarker: null,
        createdAt: at,
        updatedAt: at,
      })
      const created = store.transaction(tx => insertIntegrationOperation(tx, record))
      if (!created) {
        return refuse('integration-in-progress', `integration "${meta.operationId}" is already in progress`, {
          operationId: meta.operationId,
        }, meta)
      }
      return resume(record, meta, command.summary)
    },
    async finalize(command: IntegrationFinalizeCommand): Promise<Result<IntegrationOutcome>> {
      const input = requireObject(command, 'a finalize command')
      const identity = requireObject(input['meta'], 'the operation identity')
      requireText(identity['operationId'], 'operationId')
      requireCounter(input['expectedRevision'], 'expectedRevision')
      const meta = command.meta
      const record = readRow(meta.operationId)
      if (record === undefined) {
        return refuse('integration-not-found', `no integration was admitted under "${meta.operationId}"`, {
          operationId: meta.operationId,
        }, meta)
      }
      return finalizeRow(record, command.expectedRevision, meta)
    },
    operation(operationId: string): IntegrationOperationRecord | undefined {
      return readRow(operationId)
    },
  })
}

/** Reject a malformed integration command before any port is called. */
function requireCommand(command: IntegrationCommand): OperationMeta {
  const input = requireObject(command, 'an integration command')
  requireText(input['attemptId'], 'attemptId')
  requireCounter(input['expectedRevision'], 'expectedRevision')
  const meta = requireObject(input['meta'], 'the operation identity')
  requireText(meta['operationId'], 'operationId')
  requireText(meta['correlationId'], 'correlationId')
  if (input['strategy'] !== undefined) requireText(input['strategy'], 'strategy')
  if (input['summary'] !== undefined) requireText(input['summary'], 'summary')
  return command.meta
}
