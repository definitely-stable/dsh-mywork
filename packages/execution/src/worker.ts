/**
 * The worker orchestrator: admission → claim → worktree → frozen context →
 * session → settle (architecture §9, §17, §19, §21.7, §22, §35, §36, §39;
 * MW-022, E-08…E-12).
 *
 * §22 puts a session under an attempt and §9 makes the claim a saga, so the order
 * of the hops is part of the design rather than an implementation detail: the
 * attempt is claimed — and its revisions frozen — **before** anything is
 * materialized, the worktree is prepared before a session is started, and the
 * attempt is settled exactly once however the run ended. {@link createWorker}
 * expresses that order over injected ports, so the whole path is exercisable on
 * fakes with no model call, no git, and no DSH row.
 *
 * Three rules shape the code here.
 *
 * - **The worker owns no authority over the task.** It never moves the task
 *   graph: a finished run is a report plus a settled attempt, and the layer that
 *   owns the graph — the integrator (`E-28`) — decides what an attempt means.
 *   That is why this module never names the graph's terminal state: the string
 *   `done` appears nowhere as a target, and `tests/worker-no-done.test.mjs` pins
 *   the boundary.
 * - **Every exit settles.** A refusal from a port is not a reason to leave an
 *   attempt live: the report artifact is written first, then the attempt reaches
 *   a terminal state, and only then is the caller told what went wrong. §17's
 *   settlement is also where a late result is rejected, so the worker asks the
 *   saga even when the attempt already looks settled — the owner of the fence
 *   decides, not this layer.
 * - **A repeat answers, it does not re-run.** `runId` is derived from the attempt
 *   ({@link attemptRunId}), and an attempt that already settled is reported from
 *   its record plus a read-only observation of the run's session identity: no
 *   worktree, no snapshot, and no second session are ever started (§22, §36).
 * @module
 */

import type {
  AgentRunScope,
  ArtifactRef,
  AttemptGatePort,
  AttemptId,
  AttemptRecord,
  AttemptRunOutcome,
  AttemptRunOutcomeKind,
  AttemptRunPort,
  AttemptState,
  ClockPort,
  ContextSnapshot,
  EpochMs,
  FrozenRevisions,
  MyWorkErrorCode,
  MyWorkErrorShape,
  OperationId,
  OperationMeta,
  Result,
  Revision,
  SessionId,
  TaskId,
  WorktreePort,
  WorktreeRef,
  WorktreeRegistration,
  WorkspaceId,
} from '@dsh-mywork/contracts'
import { attemptRunId, GIT_SHA_LENGTH, MYWORK_ERROR_CODES, resolveWorktreeRefusal } from '@dsh-mywork/contracts'
import { fail, MyWorkError, ok } from '@dsh-mywork/core'
import type { ArtifactStore } from '@dsh-mywork/evidence'
import type { MyWorkStore } from '@dsh-mywork/storage'

import { ExecutionError } from './errors.ts'
import { assertGatesSatisfied, REVIEW_ADMISSION_REFUSAL, type GateAdmission } from './gates-admission.ts'
import type { ClaimSaga } from './service.ts'
import { readAttempt, requireCounter, requireObject, requireText } from './store.ts'

/** Identifier prefix of the context snapshot one attempt owns. */
export const CONTEXT_SNAPSHOT_ARTIFACT_PREFIX = 'context-snapshot-'

/** Identifier prefix of the report one attempt owns; derived, never minted. */
export const WORKER_REPORT_ARTIFACT_PREFIX = 'worker-report-'

/** Identifier prefix of the gate verdicts one attempt owns; derived per gate. */
export const GATE_RESULT_ARTIFACT_PREFIX = 'gate-result-'

/** Schema identifier carried by every worker report. */
export const WORKER_REPORT_SCHEMA = 'mywork.worker-report/v1'

/** Media type of the JSON evidence this layer writes. */
const JSON_CONTENT_TYPE = 'application/json'

/** The attempt state one run outcome settles into (§18.2). */
const TERMINAL_STATE_FOR: Readonly<Record<AttemptRunOutcomeKind, 'completed' | 'failed' | 'cancelled'>> =
  Object.freeze({
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
  })

/**
 * Identity of the context snapshot artifact of one attempt.
 * @param attemptId - attempt the snapshot was frozen for.
 */
export function contextSnapshotArtifactId(attemptId: AttemptId): string {
  return `${CONTEXT_SNAPSHOT_ARTIFACT_PREFIX}${attemptId}`
}

/**
 * Identity of the report artifact of one attempt.
 * @param attemptId - attempt the report describes.
 */
export function workerReportArtifactId(attemptId: AttemptId): string {
  return `${WORKER_REPORT_ARTIFACT_PREFIX}${attemptId}`
}

/**
 * Identity of the verdict artifact of one gate of one attempt.
 *
 * Derived rather than minted, for the same reason the snapshot's is: a second
 * verdict of the same gate for the same attempt is the same record re-stated, and
 * an identity that changed per call would turn that into a second revision of one
 * attempt's verification. The gate id is the policy's own identifier, so two
 * gates of one policy cannot collide.
 * @param attemptId - attempt the verdict belongs to.
 * @param gateId - identifier of the gate inside its policy.
 */
export function gateResultArtifactId(attemptId: AttemptId, gateId: string): string {
  return `${GATE_RESULT_ARTIFACT_PREFIX}${attemptId}-${gateId}`
}

/** What one attempt asks the context fabric to freeze (§21.7, §35). */
export interface AttemptContextRequest {
  /** Attempt the snapshot belongs to; it is the snapshot's identity too. */
  readonly attemptId: AttemptId
  /** Task the attempt works on. */
  readonly taskId: TaskId
  /** Workspace the attempt runs in. */
  readonly workspaceId: WorkspaceId
  /** Directory the attempt works in; the fabric reads its context from there. */
  readonly worktreePath: string
  /** Revisions frozen when the attempt was admitted (§35). */
  readonly frozen: FrozenRevisions
}

/**
 * The context seam of the worker: one frozen snapshot per attempt.
 *
 * The port is deliberately narrower than the context fabric: the worker asks for
 * a snapshot of one attempt and nowhere else. The fabric's discovery, ranking,
 * and budget decisions happen behind it, and §21.1 holds because a snapshot is
 * the only thing that can reach a prompt.
 *
 * Determinism is a property of the port, not a nicety: the snapshot is stored
 * under an identity derived from the attempt, so a second materialization of the
 * same attempt that answers differently would be an artifact conflict rather
 * than a silently new revision — which is exactly the alarm §35 wants.
 */
export interface AttemptContextPort {
  /**
   * Materialize the frozen context of one attempt.
   * @param request - attempt, workspace, worktree, and the revisions to freeze.
   * @param meta - operation identity carried by the result.
   * @param options - caller-owned cancellation.
   */
  materialize(
    request: AttemptContextRequest,
    meta: OperationMeta,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Result<ContextSnapshot>>
}

/**
 * One unit of admitted work (§9 "scheduler → claim").
 *
 * The values are the scheduler's decision, not the worker's: which task, which
 * agent, how long the lease lasts, which base commit, which scope, and which
 * revisions were frozen. The worker adds nothing to that list, because inventing
 * any of it here would put a second authority next to the scheduler.
 */
export interface WorkerAdmission {
  /** Task to work on. */
  readonly taskId: TaskId
  /** Workspace the task belongs to. */
  readonly workspaceId: WorkspaceId
  /** Identity claiming the task in the graph (§9). */
  readonly claimant: string
  /** Agent the attempt is created for (§17). */
  readonly agentId: string
  /** Task revision the caller observed when it decided to admit. */
  readonly expectedRevision: Revision
  /** Lease window asked for, in milliseconds. */
  readonly leaseMs: number
  /** Exact base commit the attempt's worktree is cut from (§19). */
  readonly baseSha: string
  /** Scope the session is composed under: preset, route, permission policy. */
  readonly scope: AgentRunScope
  /** Revisions frozen when the attempt was admitted (§35). */
  readonly frozen: FrozenRevisions
  /** Task text handed to the agent; the worker adds the identity lines. */
  readonly instructions: string
  /** Operation identity of the whole admission (§9). */
  readonly meta: OperationMeta
}

/**
 * What a process rebuilt after a crash hands the worker to adopt one attempt.
 *
 * `scope`, `frozen`, and `prompt` are re-asserted rather than assumed: a resumed
 * attempt that silently lost its preset, permission policy, or frozen revisions
 * would be a different attempt, and §39 makes restart a first-class path rather
 * than a special case of `run`.
 */
export interface WorkerResumeRequest {
  /** Attempt the process adopts; its session identity is durable. */
  readonly attemptId: AttemptId
  /** Scope to re-assert on the adopted session. */
  readonly scope: AgentRunScope
  /** Revisions the attempt was admitted with; used when its session never started. */
  readonly frozen: FrozenRevisions
  /** Prompt of the attempt; the port replays it only when its log does not carry it. */
  readonly prompt: string
  /** Operation identity of the recovery. */
  readonly meta: OperationMeta
}

/** Caller-owned controls of one worker call. */
export interface WorkerRunOptions {
  /** Cancellation owned by the caller; an aborted signal ends the run as `cancelled`. */
  readonly signal?: AbortSignal
}

/** What one attempt run produced, as the caller reads it. */
export interface AttemptRunReport {
  /** Operation the attempt belongs to. */
  readonly operationId: OperationId
  /** Task the attempt worked on. */
  readonly taskId: TaskId
  /** Attempt that ran. */
  readonly attemptId: AttemptId
  /** Run identifier the session was opened under; derived from the attempt. */
  readonly runId: string
  /** How the run ended. */
  readonly outcome: AttemptRunOutcomeKind
  /** Terminal attempt state recorded by the settlement. */
  readonly attemptState: AttemptState
  /** Real session identity the run executed in, when the runtime reported one. */
  readonly sessionId?: SessionId
  /** Revisions the attempt was frozen with (§35). */
  readonly frozen: FrozenRevisions
  /** Worktree the attempt ran in; absent when nothing was prepared. */
  readonly worktree?: WorktreeRef
  /** Evidence the attempt produced, in the order it was written. */
  readonly artifactRefs: readonly ArtifactRef[]
  /** Why a `failed` or `cancelled` run ended that way. */
  readonly reason?: string
  /** Why the report artifact could not be written, when it could not. */
  readonly evidenceFailure?: string
  /** True when the attempt had already settled and no port was touched. */
  readonly reused: boolean
}

/** Everything the worker drives; every one of them is injected. */
export interface WorkerDeps {
  /** Store the attempt records are read through. */
  readonly store: MyWorkStore
  /**
   * The claim saga. Reused rather than duplicated: the saga already owns §9's
   * idempotency and §17's authority checks, and a second implementation of
   * "claim exactly once" is where a double attempt would come from.
   */
  readonly saga: ClaimSaga
  /** Worktree isolation port (§19); the only thing here that may touch git. */
  readonly worktrees: WorktreePort
  /** Context fabric port: the attempt's frozen snapshot (§21.7). */
  readonly context: AttemptContextPort
  /** Attempt run port: the session of one attempt (§22, §36). */
  readonly runtime: AttemptRunPort
  /**
   * Gate port: the verdicts the attempt must show before it may be reviewed
   * (§19, E-17).
   *
   * Optional, and its absence is **not** a pass: without `gate-result` records the
   * review queue refuses admission with `REVIEW_GATES_MISSING`
   * (`gates-admission.ts`), so a deployment that injects no runner reads as
   * "verification was not run" rather than as a green light. It is a port rather
   * than an import because `packages/execution` may not spawn a process — its
   * built bundle imports `node:crypto` and nothing else — so the runner lives in
   * its own package and is injected here.
   */
  readonly gates?: AttemptGatePort
  /** Artifact store the attempt's evidence is written to (§32). */
  readonly evidence: ArtifactStore
  /** Time source; a fake clock keeps the worker deterministic in tests. */
  readonly clock: ClockPort
}

/**
 * The worker's surface: run one admitted attempt, or adopt one that a restart
 * left behind.
 */
export interface Worker {
  /**
   * Run one admitted attempt end to end.
   * @param admission - the scheduler's decision for one attempt.
   * @param options - caller-owned cancellation.
   * @returns the report of the settled attempt, or the typed refusal that stopped it.
   */
  runAttempt(
    admission: WorkerAdmission,
    options?: WorkerRunOptions,
  ): Promise<Result<AttemptRunReport>>
  /**
   * Adopt an attempt whose process is gone and drive it to a terminal state.
   * @param request - attempt, scope, frozen revisions, prompt, and operation identity.
   * @param options - caller-owned cancellation.
   */
  resumeAttempt(
    request: WorkerResumeRequest,
    options?: WorkerRunOptions,
  ): Promise<Result<AttemptRunReport>>
}

/** One-line description of a thrown value, for the report. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/**
 * The refusal a thrown value carries, as the typed shape a caller branches on.
 *
 * The check reads `code` structurally instead of using `instanceof`: every
 * package here bundles its dependencies, so a port that throws carries its own
 * copy of the error class. A thrown value that names no MyWork code is reported
 * as a conflict with the thrown text in `details`, because a port that throws
 * instead of answering has broken its contract and the caller must still get a
 * code rather than an exception.
 * @param error - value thrown by a port or a store.
 * @param meta - operation identity of the call that threw.
 * @param what - the call, named for the report.
 */
function refusalOf(error: unknown, meta: OperationMeta, what: string): MyWorkErrorShape {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      readonly code?: unknown
      readonly message?: unknown
      readonly details?: unknown
    }
    if (typeof candidate.code === 'string' && (MYWORK_ERROR_CODES as readonly string[]).includes(candidate.code)) {
      return {
        code: candidate.code as MyWorkErrorCode,
        message:
          typeof candidate.message === 'string' ? candidate.message : `dsh-mywork: ${what} refused without a message`,
        details:
          typeof candidate.details === 'object' && candidate.details !== null
            ? (candidate.details as Readonly<Record<string, unknown>>)
            : Object.freeze({ reason: what, operationId: meta.operationId }),
      }
    }
  }
  return {
    code: 'TASK_CONFLICT',
    message: `dsh-mywork: ${what} failed without a typed refusal: ${describe(error)}`,
    details: Object.freeze({ reason: what, operationId: meta.operationId, thrown: describe(error) }),
  }
}

/** Call a port, turning a throw into the typed refusal a caller can branch on. */
async function call<T>(
  what: string,
  meta: OperationMeta,
  body: () => Promise<Result<T>>,
): Promise<Result<T>> {
  try {
    return await body()
  } catch (error) {
    return fail(refusalOf(error, meta, what), meta)
  }
}

/** The attempt state a settled attempt's record answers with, for a repeated call. */
function outcomeOfState(state: AttemptState): AttemptRunOutcomeKind | undefined {
  if (state === 'completed') return 'completed'
  if (state === 'cancelled' || state === 'revoked' || state === 'stale') return 'cancelled'
  if (state === 'failed' || state === 'timed-out') return 'failed'
  // A live state never reaches the reuse path: it is only asked about an
  // attempt whose `settledAt` is already written.
  return undefined
}

/** The worktree as the run request states it. */
function worktreeRefOf(registration: WorktreeRegistration): WorktreeRef {
  return Object.freeze({
    path: registration.path,
    branch: registration.branch,
    baseSha: registration.baseSha,
    // Until the attempt settles, the head of its worktree *is* its base: there
    // is no other commit it can be on, and an absent head must not travel as a
    // guess about work that has not happened yet.
    headSha: registration.headSha ?? registration.baseSha,
  })
}

/** The cancellation one port call carries; absent when the caller stated none. */
function callOptions(options: WorkerRunOptions): { readonly signal: AbortSignal } | undefined {
  return options.signal === undefined ? undefined : { signal: options.signal }
}

/**
 * The prompt one attempt is admitted with.
 *
 * The prompt is built from the admission alone — task identity, attempt
 * identity, and the worktree the attempt owns — and never from the workspace's
 * shared checkout: §19 keeps the shared checkout out of an attempt's world, so
 * nothing this layer could read from it belongs in a prompt.
 * @param admission - task identity and the task text handed in.
 * @param worktree - the attempt's worktree.
 */
export function buildAttemptPrompt(
  admission: { readonly taskId: TaskId; readonly attemptId: AttemptId; readonly instructions: string },
  worktree: Pick<WorktreeRef, 'path' | 'branch' | 'baseSha'>,
): string {
  return [
    admission.instructions.trim(),
    '',
    `task: ${admission.taskId}`,
    `attempt: ${admission.attemptId}`,
    `worktree: ${worktree.path}`,
    `branch: ${worktree.branch}`,
    `base: ${worktree.baseSha}`,
  ].join('\n')
}

/** Reject a malformed admission before the saga is touched. */
function requireAdmission(admission: WorkerAdmission): void {
  const input = requireObject(admission, 'a worker admission')
  requireText(input['taskId'], 'taskId')
  requireText(input['workspaceId'], 'workspaceId')
  requireText(input['claimant'], 'claimant')
  requireText(input['agentId'], 'agentId')
  requireCounter(input['expectedRevision'], 'expectedRevision')
  requireCounter(input['leaseMs'], 'leaseMs')
  requireText(input['baseSha'], 'baseSha')
  if (typeof input['baseSha'] !== 'string' || !new RegExp(`^[0-9a-f]{${GIT_SHA_LENGTH}}$`).test(input['baseSha'])) {
    throw new ExecutionError('invalid-input', `dsh-mywork: baseSha must be ${GIT_SHA_LENGTH} lowercase hex characters`)
  }
  requireText(input['instructions'], 'instructions')
  const scope = requireObject(input['scope'], 'the run scope')
  requireText(scope['agentPreset'], 'scope.agentPreset')
  requireObject(input['frozen'], 'the frozen revisions')
  requireMeta(input['meta'])
}

/** Reject a malformed resume request before the store is read. */
function requireResume(request: WorkerResumeRequest): void {
  const input = requireObject(request, 'a resume request')
  requireText(input['attemptId'], 'attemptId')
  requireText(input['prompt'], 'prompt')
  const scope = requireObject(input['scope'], 'the run scope')
  requireText(scope['agentPreset'], 'scope.agentPreset')
  requireObject(input['frozen'], 'the frozen revisions')
  requireMeta(input['meta'])
}

/**
 * Reject an operation identity a settlement cannot work with.
 *
 * The controller epoch is required rather than defaulted: §17's ownership check
 * needs it to tell "your controller lost leadership" from "your attempt was
 * superseded", and a settlement issued without one cannot be authorised at all.
 * @param value - the identity as the caller supplied it.
 */
function requireMeta(value: unknown): void {
  const meta = requireObject(value, 'the operation identity')
  requireText(meta['operationId'], 'meta.operationId')
  requireText(meta['correlationId'], 'meta.correlationId')
  requireCounter(meta['controllerEpoch'], 'meta.controllerEpoch')
}

/** Everything one settlement needs, gathered as the flow reaches its exit. */
interface SettlementInput {
  readonly attemptId: AttemptId
  readonly meta: OperationMeta
  readonly runId: string
  readonly frozen: FrozenRevisions
  readonly artifactRefs: readonly ArtifactRef[]
  readonly outcome: AttemptRunOutcomeKind
  readonly reused: boolean
  readonly worktree?: WorktreeRef
  readonly sessionId?: SessionId
  readonly reason?: string
}

/**
 * Build the worker over one saga, one worktree port, one context fabric, one
 * attempt runtime, one artifact store, and one clock.
 * @param deps - the injected ports and the store attempt records are read through.
 */
export function createWorker(deps: WorkerDeps): Worker {
  const { store, saga, worktrees, context, runtime, gates, evidence, clock } = deps
  const now = (): EpochMs => clock.now()

  /** Read one attempt straight from the store, so the settlement sees the current row. */
  function attemptById(attemptId: AttemptId): AttemptRecord | undefined {
    return store.transaction(tx => readAttempt(tx, attemptId))
  }

  /**
   * The session identity a settled run executed in, as its owner reports it.
   *
   * §22 makes a session outlive the process that started it, so a repeated call
   * can name the session without re-running anything. The identity is optional
   * evidence: a runtime that cannot answer must not turn a durable settlement
   * into a failure, and the report simply stays without one.
   */
  async function observeSession(
    runId: string,
    meta: OperationMeta,
    options: WorkerRunOptions,
  ): Promise<SessionId | undefined> {
    const status = await call('runtime.status', meta, () => runtime.status(runId, meta, callOptions(options)))
    return status.ok ? status.value.sessionId : undefined
  }

  /**
   * Write the report of one attempt.
   *
   * A report that could not be written is not a reason to keep the attempt live:
   * the failure is carried back to the caller and into the settlement's reason
   * instead, because losing the explanation is worse than losing the report.
   */
  function writeReport(
    input: SettlementInput,
    attempt: AttemptRecord,
  ): { readonly ref?: ArtifactRef; readonly failure?: string } {
    const body = {
      schema: WORKER_REPORT_SCHEMA,
      attemptId: attempt.id,
      taskId: attempt.taskId,
      runId: input.runId,
      outcome: input.outcome,
      settledAs: TERMINAL_STATE_FOR[input.outcome],
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      frozen: input.frozen,
      ...(input.worktree === undefined ? {} : { worktree: input.worktree }),
      artifactRefs: input.artifactRefs,
    }
    try {
      const stored = evidence.put({
        artifactId: workerReportArtifactId(attempt.id),
        kind: 'worker-report',
        workspaceId: attempt.workspaceId,
        correlationId: input.meta.correlationId,
        contentType: JSON_CONTENT_TYPE,
        bytes: new TextEncoder().encode(JSON.stringify(body)),
        taskId: attempt.taskId,
        attemptId: attempt.id,
      })
      return Object.freeze({ ref: stored.ref })
    } catch (error) {
      return Object.freeze({ failure: describe(error) })
    }
  }

  /** The single exit of every path: evidence first, then one authoritative settlement. */
  async function settle(input: SettlementInput): Promise<Result<AttemptRunReport>> {
    const attempt = attemptById(input.attemptId)
    if (attempt === undefined) {
      return fail(
        new MyWorkError('TASK_CONFLICT', `dsh-mywork: no attempt "${input.attemptId}" to settle`, {
          details: { attemptId: input.attemptId, reason: 'attempt-not-found' },
        }),
        input.meta,
      )
    }
    // A repeated call must not rewrite the evidence of a settled attempt, and it
    // must not re-decide what the attempt's outcome was.
    const written: { readonly ref?: ArtifactRef; readonly failure?: string } = input.reused
      ? Object.freeze({})
      : writeReport(input, attempt)
    const artifactRefs: readonly ArtifactRef[] = Object.freeze([
      ...input.artifactRefs,
      ...(written.ref === undefined ? [] : [written.ref]),
    ])
    let settled: Result<unknown>
    try {
      settled = await saga.settle({
        authority: {
          attemptId: attempt.id,
          expectedRevision: attempt.revision,
          controllerEpoch: attempt.controllerEpoch,
          expectedFence: attempt.fence,
          at: now(),
        },
        to: TERMINAL_STATE_FOR[input.outcome],
        meta: input.meta,
      })
    } catch (error) {
      return fail(refusalOf(error, input.meta, 'the settlement'), input.meta)
    }
    // The saga decides whether this result may still be applied: a superseded
    // attempt is refused with `STALE_FENCE` here and not by a check of ours.
    if (!settled.ok) return fail(settled.error, input.meta)
    const observed = attemptById(attempt.id) ?? attempt
    return ok(
      Object.freeze({
        operationId: input.meta.operationId,
        taskId: observed.taskId,
        attemptId: observed.id,
        runId: input.runId,
        outcome: input.outcome,
        attemptState: observed.state,
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        frozen: input.frozen,
        ...(input.worktree === undefined ? {} : { worktree: input.worktree }),
        artifactRefs,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(written.failure === undefined ? {} : { evidenceFailure: written.failure }),
        reused: input.reused,
      }),
      input.meta,
    )
  }

  /**
   * Settle one attempt as failed and answer with the refusal that caused it.
   *
   * The order matters: the attempt reaches a terminal state *before* the caller
   * is told, so a caller that retries cannot find the attempt still holding the
   * task's only lease slot.
   */
  async function refuse(
    base: Omit<SettlementInput, 'outcome' | 'reused'>,
    error: MyWorkErrorShape,
  ): Promise<Result<AttemptRunReport>> {
    const settled = await settle({
      ...base,
      outcome: 'failed',
      reused: false,
      reason: `${error.code}: ${error.message}`,
    })
    if (!settled.ok) return settled
    return fail(error, base.meta)
  }

  /** Prepare the attempt's worktree, treating an existing registration as this attempt's. */
  async function prepareWorktree(
    admission: WorkerAdmission,
    attemptId: AttemptId,
    meta: OperationMeta,
    options: WorkerRunOptions,
  ): Promise<Result<WorktreeRegistration>> {
    const prepared = await call('worktrees.prepare', meta, () =>
      worktrees.prepare(
        {
          workspaceId: admission.workspaceId,
          taskId: admission.taskId,
          attemptId,
          baseSha: admission.baseSha,
        },
        meta,
        callOptions(options),
      ),
    )
    if (prepared.ok) return prepared
    // `WORKTREE_ALREADY_REGISTERED` is the idempotent answer, not a failure: the
    // attempt owns exactly one worktree, so a second `prepare` adopts the first.
    if (resolveWorktreeRefusal(prepared.error.details['refusal']) !== 'WORKTREE_ALREADY_REGISTERED') return prepared
    return call('worktrees.resolve', meta, () => worktrees.resolve(attemptId, meta, callOptions(options)))
  }

  /**
   * Materialize the attempt's frozen context and store it as its evidence.
   *
   * The snapshot is written *before* the session starts (§21.7 makes it the
   * audit record of what the model was shown), and its identity is derived from
   * the attempt, so a restart re-uses the same artifact instead of minting a
   * second revision of one attempt's context.
   */
  async function materializeContext(
    attempt: AttemptRecord,
    worktreePath: string,
    frozen: FrozenRevisions,
    meta: OperationMeta,
    options: WorkerRunOptions,
  ): Promise<Result<ArtifactRef>> {
    const materialized = await call('context.materialize', meta, () =>
      context.materialize(
        {
          attemptId: attempt.id,
          taskId: attempt.taskId,
          workspaceId: attempt.workspaceId,
          worktreePath,
          frozen,
        },
        meta,
        callOptions(options),
      ),
    )
    if (!materialized.ok) return fail(materialized.error, meta)
    return call('the context snapshot write', meta, async () => {
      const stored = evidence.put({
        artifactId: contextSnapshotArtifactId(attempt.id),
        kind: 'context-snapshot',
        workspaceId: attempt.workspaceId,
        correlationId: meta.correlationId,
        contentType: JSON_CONTENT_TYPE,
        bytes: new TextEncoder().encode(JSON.stringify(materialized.value)),
        taskId: attempt.taskId,
        attemptId: attempt.id,
      })
      return ok(stored.ref, meta)
    })
  }

  /**
   * The refusal an attempt whose gates did not admit it settles as (§19, E-17).
   *
   * The reason is the consumer's own vocabulary member — `REVIEW_GATES_MISSING` —
   * because that is the fact the caller and the board act on: this attempt
   * produced no passing gate set for this head, so no review may be queued for it.
   * @param attemptId - attempt the verdicts belong to.
   * @param headSha - head the gates answered about.
   * @param detail - what kept the set from passing, in the refusal's message.
   * @param extra - additional details (the written verdicts, a run-level refusal).
   */
  function gateRefusal(
    attemptId: AttemptId,
    headSha: string,
    detail: string,
    extra: Readonly<Record<string, unknown>> = {},
  ): MyWorkError {
    return new MyWorkError(
      'TASK_CONFLICT',
      `dsh-mywork: attempt "${attemptId}" produced no passing gate set for head ${headSha} (${detail}); `
        + 'it is settled as failed rather than reported as completed',
      {
        details: {
          attemptId,
          headSha,
          refusal: REVIEW_ADMISSION_REFUSAL,
          reason: 'gates-not-passing',
          ...extra,
        },
      },
    )
  }

  /**
   * Ask for the attempt's gate verdicts, record every one of them, and judge the
   * set (§19, §32; MW-023, E-17).
   *
   * Four properties are deliberate.
   *
   * - **The head is the attempt's own pin, never a fresh read.** It travels in the
   *   request; this layer has no git port, and a head it derived would be a second
   *   opinion about the attempt rather than the pin the caller owns. Nothing here
   *   reads the shared checkout, so §19's isolation holds for verification too.
   * - **Every verdict is evidence, pass or not.** A failing gate is exactly the
   *   fact a reviewer has to be able to see, so the verdicts are written as
   *   `gate-result` artifacts *before* the set is judged — the evidence of a
   *   refusal outlives the refusal.
   * - **The judgement is the consumer's own function.** `assertGatesSatisfied` is
   *   what review admission calls, so it is what decides here: producer and
   *   admission cannot drift apart, and the strict reading (every recorded gate is
   *   required) is the one the queue applies.
   * - **A missing port records nothing, and that is not a pass.** Without
   *   `gate-result` evidence the review queue refuses with `REVIEW_GATES_MISSING`,
   *   so the absence reads as "verification was not run".
   *
   * A failure answer means the attempt must not be reported as completed. The
   * verdicts already written travel in `details.artifactRefs`, so the settlement
   * can still name them in the report of the failed attempt.
   * @param attempt - attempt the verdicts belong to.
   * @param worktree - the attempt's own worktree; the gates run inside it.
   * @param meta - operation identity of the admission.
   * @returns the references of the written verdicts, oldest first.
   */
  async function collectGateVerdicts(
    attempt: AttemptRecord,
    worktree: WorktreeRef,
    meta: OperationMeta,
  ): Promise<Result<readonly ArtifactRef[]>> {
    if (gates === undefined) return ok(Object.freeze([]), meta)
    const headSha = worktree.headSha
    const run = await call('gates.run', meta, () =>
      gates.run(
        {
          attemptId: attempt.id,
          taskId: attempt.taskId,
          workspaceId: attempt.workspaceId,
          cwd: worktree.path,
          headSha,
        },
        meta,
      ),
    )
    if (!run.ok) return fail(run.error, meta)

    const refs: ArtifactRef[] = []
    for (const result of run.value.results) {
      const stored = await call('the gate-result write', meta, async () => {
        const written = evidence.put({
          artifactId: gateResultArtifactId(attempt.id, result.id),
          kind: 'gate-result',
          workspaceId: attempt.workspaceId,
          correlationId: meta.correlationId,
          contentType: JSON_CONTENT_TYPE,
          bytes: new TextEncoder().encode(JSON.stringify(result)),
          taskId: attempt.taskId,
          attemptId: attempt.id,
        })
        return ok(written.ref, meta)
      })
      if (!stored.ok) return stored
      refs.push(stored.value)
    }
    const written = Object.freeze(refs)

    if (run.value.refusal !== undefined) {
      return fail(
        gateRefusal(attempt.id, headSha, `the gate run was refused with ${run.value.refusal}`, {
          gateRefusal: run.value.refusal,
          artifactRefs: written,
        }),
        meta,
      )
    }
    let admitted: Result<GateAdmission>
    try {
      admitted = assertGatesSatisfied(attempt.id, headSha, run.value.results)
    } catch (error) {
      return fail(
        gateRefusal(attempt.id, headSha, `the verdicts could not be judged: ${describe(error)}`, {
          artifactRefs: written,
        }),
        meta,
      )
    }
    if (!admitted.ok) {
      return fail(
        gateRefusal(attempt.id, headSha, `the gate set did not pass: ${admitted.error.message}`, {
          blocks: admitted.error.details?.['blocks'] ?? null,
          artifactRefs: written,
        }),
        meta,
      )
    }
    return ok(written, meta)
  }

  /**
   * The gate verdicts an attempt must show before it may be reported as completed.
   *
   * A run that did not end in `completed` has nothing to verify: the attempt is
   * already settling as `failed` or `cancelled`, and running the workspace's gates
   * over work nobody claims is finished would only spend time and record verdicts
   * that no admission may use.
   * @param attempt - attempt that ran.
   * @param worktree - the attempt's own worktree.
   * @param outcome - how the run ended.
   * @param meta - operation identity of the admission.
   */
  async function gateVerdictsFor(
    attempt: AttemptRecord,
    worktree: WorktreeRef,
    outcome: AttemptRunOutcomeKind,
    meta: OperationMeta,
  ): Promise<Result<readonly ArtifactRef[]>> {
    if (outcome !== 'completed') return ok(Object.freeze([]), meta)
    return collectGateVerdicts(attempt, worktree, meta)
  }

  /** Start the attempt's session: the run path, where no session exists yet. */
  async function startSession(
    attempt: AttemptRecord,
    runId: string,
    worktree: WorktreeRef,
    scope: AgentRunScope,
    frozen: FrozenRevisions,
    prompt: string,
    meta: OperationMeta,
    options: WorkerRunOptions,
  ): Promise<Result<AttemptRunOutcome>> {
    return call('runtime.run', meta, () =>
      runtime.run({ runId, attemptId: attempt.id, worktree, frozen, scope, prompt }, meta, callOptions(options)),
    )
  }

  /**
   * Adopt the session a restart left behind, or start one when it never started.
   *
   * The session identity is durable, so an attempt whose run began is resumed
   * rather than started again; the scope is re-asserted on the adopted session
   * because the platform's restriction is process-local and does not survive in
   * the session log (§39, `E-39`).
   */
  async function adoptSession(
    attempt: AttemptRecord,
    runId: string,
    worktree: WorktreeRef,
    scope: AgentRunScope,
    frozen: FrozenRevisions,
    prompt: string,
    meta: OperationMeta,
    options: WorkerRunOptions,
  ): Promise<Result<AttemptRunOutcome>> {
    const status = await call('runtime.status', meta, () => runtime.status(runId, meta, callOptions(options)))
    if (!status.ok) return fail(status.error, meta)
    const sessionId = status.value.sessionId
    if (sessionId !== undefined) {
      return call('runtime.resume', meta, () =>
        runtime.resume({ runId, attemptId: attempt.id, sessionId, scope }, meta, callOptions(options)),
      )
    }
    return startSession(attempt, runId, worktree, scope, frozen, prompt, meta, options)
  }

  return Object.freeze({
    async runAttempt(
      admission: WorkerAdmission,
      options: WorkerRunOptions = {},
    ): Promise<Result<AttemptRunReport>> {
      requireAdmission(admission)
      const meta = admission.meta
      const claimed = await call('the claim', meta, () =>
        saga.claim({
          taskId: admission.taskId,
          workspaceId: admission.workspaceId,
          claimant: admission.claimant,
          agentId: admission.agentId,
          expectedRevision: admission.expectedRevision,
          leaseMs: admission.leaseMs,
          meta,
        }),
      )
      if (!claimed.ok) return fail(claimed.error, meta)
      const attemptId = claimed.value.attemptId
      if (attemptId === undefined) {
        return fail(
          new MyWorkError(
            'TASK_CONFLICT',
            `dsh-mywork: the claim of task "${admission.taskId}" produced no attempt`,
            {
              details: {
                operationId: meta.operationId,
                taskId: admission.taskId,
                state: claimed.value.state,
                reason: 'claim-produced-no-attempt',
              },
            },
          ),
          meta,
        )
      }
      const runId = attemptRunId(attemptId)
      const attempt = attemptById(attemptId)
      if (attempt === undefined) {
        return fail(
          new MyWorkError(
            'CONTRACT_MISMATCH',
            `dsh-mywork: the claim of task "${admission.taskId}" recorded attempt "${attemptId}" that the store does not hold`,
            { details: { operationId: meta.operationId, attemptId, reason: 'attempt-not-recorded' } },
          ),
          meta,
        )
      }
      if (attempt.settledAt !== undefined) {
        // §9 idempotency: the operation already ran, so the answer is what was
        // recorded — no worktree, no snapshot, no session is touched again. The
        // one call made is the read-only observation of the session the settled
        // attempt ran in, which the owner still holds (§22).
        const sessionId = await observeSession(runId, meta, options)
        return settle({
          attemptId,
          meta,
          runId,
          frozen: admission.frozen,
          artifactRefs: Object.freeze([]),
          outcome: outcomeOfState(attempt.state) ?? 'failed',
          ...(sessionId === undefined ? {} : { sessionId }),
          reused: true,
        })
      }
      const base: Omit<SettlementInput, 'outcome' | 'reused'> = {
        attemptId,
        meta,
        runId,
        frozen: admission.frozen,
        artifactRefs: Object.freeze([]),
      }
      const prepared = await prepareWorktree(admission, attemptId, meta, options)
      if (!prepared.ok) return refuse(base, prepared.error)
      const worktree = worktreeRefOf(prepared.value)
      const snapshot = await materializeContext(attempt, worktree.path, admission.frozen, meta, options)
      if (!snapshot.ok) return refuse({ ...base, worktree }, snapshot.error)
      const withSnapshot: Omit<SettlementInput, 'outcome' | 'reused'> = {
        ...base,
        worktree,
        artifactRefs: Object.freeze([snapshot.value]),
      }
      const ran = await startSession(
        attempt,
        runId,
        worktree,
        admission.scope,
        admission.frozen,
        buildAttemptPrompt(
          { taskId: admission.taskId, attemptId, instructions: admission.instructions },
          worktree,
        ),
        meta,
        options,
      )
      if (!ran.ok) return refuse(withSnapshot, ran.error)
      const sessionId = ran.value.sessionId
      const reason = ran.value.reason
      // §19, E-17: the verdicts are asked for and recorded after the session
      // answered and before a `completed` report is possible. A set that did not
      // pass settles the attempt as failed, so nothing can queue a review of work
      // that nothing verified.
      const runRefs = Object.freeze([snapshot.value, ...ran.value.artifactRefs])
      const verdicts = await gateVerdictsFor(attempt, worktree, ran.value.outcome, meta)
      if (!verdicts.ok) {
        // The verdicts written before the judgement are still this attempt's
        // evidence, so the report of the failed attempt names them too.
        const written = verdicts.error.details?.['artifactRefs'] as readonly ArtifactRef[] | undefined
        return refuse({ ...withSnapshot, artifactRefs: Object.freeze([...runRefs, ...(written ?? [])]) }, verdicts.error)
      }
      return settle({
        ...withSnapshot,
        artifactRefs: Object.freeze([...runRefs, ...verdicts.value]),
        outcome: ran.value.outcome,
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(reason === undefined ? {} : { reason }),
        reused: false,
      })
    },

    async resumeAttempt(
      request: WorkerResumeRequest,
      options: WorkerRunOptions = {},
    ): Promise<Result<AttemptRunReport>> {
      requireResume(request)
      const meta = request.meta
      const attempt = attemptById(request.attemptId)
      if (attempt === undefined) {
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: no attempt "${request.attemptId}" to resume`, {
            details: { attemptId: request.attemptId, reason: 'attempt-not-found' },
          }),
          meta,
        )
      }
      const runId = attemptRunId(attempt.id)
      if (attempt.settledAt !== undefined) {
        const sessionId = await observeSession(runId, meta, options)
        return settle({
          attemptId: attempt.id,
          meta,
          runId,
          frozen: request.frozen,
          artifactRefs: Object.freeze([]),
          outcome: outcomeOfState(attempt.state) ?? 'failed',
          ...(sessionId === undefined ? {} : { sessionId }),
          reused: true,
        })
      }
      const base: Omit<SettlementInput, 'outcome' | 'reused'> = {
        attemptId: attempt.id,
        meta,
        runId,
        frozen: request.frozen,
        artifactRefs: Object.freeze([]),
      }
      // `resolve`, never `prepare`: the attempt owns exactly one worktree, and a
      // restart that created a second one would be the duplicate this path exists
      // to prevent.
      const resolved = await call('worktrees.resolve', meta, () =>
        worktrees.resolve(attempt.id, meta, callOptions(options)),
      )
      if (!resolved.ok) return refuse(base, resolved.error)
      const worktree = worktreeRefOf(resolved.value)
      const snapshot = await materializeContext(attempt, worktree.path, request.frozen, meta, options)
      if (!snapshot.ok) return refuse({ ...base, worktree }, snapshot.error)
      const withSnapshot: Omit<SettlementInput, 'outcome' | 'reused'> = {
        ...base,
        worktree,
        artifactRefs: Object.freeze([snapshot.value]),
      }
      const ran = await adoptSession(
        attempt,
        runId,
        worktree,
        request.scope,
        request.frozen,
        request.prompt,
        meta,
        options,
      )
      if (!ran.ok) return refuse(withSnapshot, ran.error)
      const sessionId = ran.value.sessionId
      const reason = ran.value.reason
      // An adopted attempt answers for its gates exactly like a fresh run: a
      // restart that skipped verification would let a crash launder a review.
      const runRefs = Object.freeze([snapshot.value, ...ran.value.artifactRefs])
      const verdicts = await gateVerdictsFor(attempt, worktree, ran.value.outcome, meta)
      if (!verdicts.ok) {
        const written = verdicts.error.details?.['artifactRefs'] as readonly ArtifactRef[] | undefined
        return refuse({ ...withSnapshot, artifactRefs: Object.freeze([...runRefs, ...(written ?? [])]) }, verdicts.error)
      }
      return settle({
        ...withSnapshot,
        artifactRefs: Object.freeze([...runRefs, ...verdicts.value]),
        outcome: ran.value.outcome,
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(reason === undefined ? {} : { reason }),
        reused: false,
      })
    },
  })
}
