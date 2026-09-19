/**
 * The claim saga: ClaimIntent → graph claim → Attempt + lease → projection →
 * completed (architecture §9, §17, §18.2, §49).
 *
 * §9 states the shape and one prohibition: Beads/Task Graph and MyWork DB share no
 * transaction, so a claim is a saga plus idempotency, and **no workflow may assume
 * "usually the two calls run one after another"**. This module is that saga.
 *
 * Three rules shape every path here.
 *
 * - **The intent is durable before the graph is touched.** §9 step 1 is a commit of
 *   its own; only then does step 2 run. A crash between them leaves a recorded
 *   intent and an untouched graph, which is the case a reconciler can resolve
 *   without guessing.
 * - **Success is an observation, not a return value.** A step is marked `applied`
 *   only when the world shows it. A projection that could not be written leaves the
 *   saga at `attempted` with the attempt live, because §49 is explicit that an
 *   unavailable board does not stop execution — it degrades the projection.
 * - **Authority is checked on three axes, in a fixed order.** A callback presents
 *   the revision it saw, the controller epoch it belongs to, and the fence it holds
 *   (§17). The fence is compared against the *task's* current token, not against
 *   the attempt's own copy: an attempt that was superseded still carries its old
 *   fence, so comparing it to itself would let exactly the late result §17 exists
 *   to reject walk straight through.
 * @module
 */

import { randomUUID } from 'node:crypto'

import {
  ATTEMPT_TERMINAL_STATES,
  AUDIT_SCHEMA,
  MAX_CLAIMANT_LENGTH,
  type AttemptRecord,
  type AttemptSettlementCommand,
  type ClaimCommand,
  type ClaimIntent,
  type ClaimIntentState,
  type ClaimOutcome,
  type ClaimRecoveryRequest,
  type ClaimStep,
  type ClaimStepKind,
  type ClockPort,
  type DomainEvent,
  type EpochMs,
  type MyWorkErrorShape,
  type OperationMeta,
  type Result,
  type Task,
  type TaskGraphPort,
  type TaskId,
  type WorkspaceId,
} from '@dsh-mywork/contracts'
import {
  assertControllerEpoch,
  assertFence,
  assertRevision,
  fail,
  MyWorkError,
  ok,
  reconcileClaim,
} from '@dsh-mywork/core'
import { appendAuditEntry, putArtifact } from '@dsh-mywork/evidence'
import type { MyWorkStore, MyWorkTransaction } from '@dsh-mywork/storage'

import { ExecutionError } from './errors.ts'
import {
  advanceIntent,
  allocateFence,
  assertClaimSchema,
  insertAttempt,
  insertIntent,
  listLiveAttempts,
  listOpenIntents,
  readAttempt,
  readFence,
  readIntent,
  readLiveAttempt,
  readSagaAttempt,
  readSteps,
  requireCounter,
  requireObject,
  requireText,
  settleAttempt,
  writeSteps,
} from './store.ts'
import { CLAIM_SAGA_SCHEMA_NAME, CLAIM_SAGA_SCHEMA_VERSION } from './schema.ts'

/** What the saga needs to run. */
export interface ClaimSagaDeps {
  /** Store opened with every migration this layer writes through. */
  readonly store: MyWorkStore
  /**
   * Task graph the saga writes through. Resolved by the caller through the
   * adapter registry, so this layer never names a backend (§11, §44).
   */
  readonly graph: TaskGraphPort
  /** Time source; a fake clock keeps the saga deterministic in tests. */
  readonly clock: ClockPort
}

/**
 * The saga's surface: one object, no backend names, no board.
 *
 * `claim` runs the five §9 steps. `settle` is the authoritative callback a running
 * worker calls when it finishes. `recover` and `revoke` are the two answers §49
 * requires for an unfinished saga — finish it, or take it away.
 */
export interface ClaimSaga {
  /** Run the §9 claim steps for one task. */
  claim(command: ClaimCommand): Promise<Result<ClaimOutcome>>
  /** The authoritative settlement callback of a running attempt (§17). */
  settle(command: AttemptSettlementCommand): Promise<Result<ClaimOutcome>>
  /** Finish an unfinished saga: verify what is there, then apply the remainder. */
  recover(request: ClaimRecoveryRequest): Promise<Result<ClaimOutcome>>
  /** Take the claim and the lease away and stop the attempt (§49). */
  revoke(request: ClaimRecoveryRequest): Promise<Result<ClaimOutcome>>
  /** The live attempt of a task, if it has one. */
  attemptOf(taskId: TaskId): AttemptRecord | undefined
  /** Every attempt that still holds a lease. */
  liveAttempts(workspaceId?: WorkspaceId): readonly AttemptRecord[]
  /** Every saga that still owes work, oldest first. */
  openIntents(workspaceId?: WorkspaceId): readonly ClaimIntent[]
  /** The step journal of one saga, for the operator's recovery banner (§5.2). */
  stepsOf(operationId: string): readonly ClaimStep[]
}

/** Failure codes a port raises from a guard, before it can have written anything. */
const GUARDED_CODES: readonly string[] = Object.freeze([
  'STALE_REVISION',
  'ENTITY_CYCLE',
  'CAPABILITY_UNSUPPORTED',
  'ADAPTER_UNAVAILABLE',
  'CONTRACT_MISMATCH',
])

/**
 * Whether a thrown value is a typed refusal the caller can act on.
 *
 * The check reads `code` structurally instead of using `instanceof`: every package
 * here bundles its dependencies, so the adapter that answers the task graph carries
 * its **own** copy of the error class and an `instanceof` test would never
 * recognise it — the refusal would surface as an opaque failure instead of the
 * code the architecture assigns it.
 * @param error - value thrown by a port or a store.
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
    code: code as MyWorkErrorShape['code'],
    message: typeof message === 'string' ? message : `dsh-mywork: the task graph refused with ${code}`,
    details:
      typeof details === 'object' && details !== null
        ? (details as Readonly<Record<string, unknown>>)
        : Object.freeze({ code }),
  }
}

/** The §9 steps in order, so the journal and the state machine cannot drift apart. */
const STEP_ORDER: readonly ClaimStepKind[] = Object.freeze(['intent', 'claim', 'attempt', 'projection', 'complete'])

/** A fresh journal: the intent landed, everything after it is still owed. */
function initialSteps(): readonly ClaimStep[] {
  return Object.freeze(
    STEP_ORDER.map((kind, index) =>
      Object.freeze({
        seq: index + 1,
        kind,
        state: kind === 'intent' ? ('applied' as const) : ('pending' as const),
      }),
    ),
  )
}

/** Mark one step of a journal, leaving the others as they were. */
function markStep(
  steps: readonly ClaimStep[],
  kind: ClaimStepKind,
  state: ClaimStep['state'],
  detail?: string,
): readonly ClaimStep[] {
  return Object.freeze(
    steps.map(step =>
      step.kind === kind
        ? Object.freeze({ ...step, state, ...(detail === undefined ? {} : { detail }) })
        : step,
    ),
  )
}

/** One-line description of a thrown value, for the journal. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/** Whether an attempt reached a state from which it can no longer settle. */
function isTerminalAttempt(state: AttemptRecord['state']): boolean {
  return ATTEMPT_TERMINAL_STATES.includes(state)
}

/** Whether a saga reached a state from which it will not move. */
function isTerminalIntent(state: ClaimIntentState): boolean {
  return state === 'completed' || state === 'recovered' || state === 'revoked' || state === 'abandoned'
}

/** Reject a malformed claim before any store is touched. */
function requireClaim(command: ClaimCommand): void {
  const input = requireObject(command, 'a claim command')
  requireText(input['taskId'], 'taskId')
  requireText(input['workspaceId'], 'workspaceId')
  requireText(input['claimant'], 'claimant', MAX_CLAIMANT_LENGTH)
  requireText(input['agentId'], 'agentId')
  requireCounter(input['expectedRevision'], 'expectedRevision')
  requireCounter(input['leaseMs'], 'leaseMs')
  if (input['leaseMs'] === 0) {
    throw new ExecutionError('invalid-input', 'dsh-mywork: leaseMs must be a positive integer')
  }
  requireObject(input['meta'], 'the operation identity')
}

/** Reject a malformed recovery request before any store is touched. */
function requireRecovery(request: ClaimRecoveryRequest): void {
  const input = requireObject(request, 'a recovery request')
  requireText(input['operationId'], 'operationId')
  if (input['action'] !== 'recover' && input['action'] !== 'revoke') {
    throw new ExecutionError('invalid-input', `dsh-mywork: unknown claim recovery action "${String(input['action'])}"`)
  }
  const decision = requireObject(input['decision'], 'a recovery decision')
  requireText(decision['decidedBy'], 'decidedBy')
  requireCounter(decision['at'], 'at')
  if (decision['reason'] !== undefined) requireText(decision['reason'], 'reason')
}

/**
 * Build the claim saga over one store and one task graph.
 * @param deps - store, task graph, and clock.
 * @throws {ExecutionError} `schema-missing` when the store lacks a schema this layer writes through.
 */
export function createClaimSaga(deps: ClaimSagaDeps): ClaimSaga {
  const { store, graph } = deps
  store.transaction(tx =>
    assertClaimSchema(tx, [
      { version: 1, name: 'outbox-inbox' },
      { version: CLAIM_SAGA_SCHEMA_VERSION, name: CLAIM_SAGA_SCHEMA_NAME },
    ]),
  )
  const now = (): EpochMs => deps.clock.now()

  /** Write the evidence, the audit row, and the outbox event of one settled fact. */
  function record(
    tx: MyWorkTransaction,
    input: {
      readonly workspaceId: WorkspaceId
      readonly correlationId: string
      readonly event: DomainEvent
      readonly auditType: 'claim.recorded' | 'claim.recovered' | 'attempt.assigned' | 'attempt.revoked'
      readonly auditId: string
      readonly taskId: TaskId
      readonly attemptId?: string
      readonly detail: Readonly<Record<string, unknown>>
    },
  ): void {
    const artifactId = `${input.auditId}-artifact`
    putArtifact(
      tx,
      {
        artifactId,
        // A claim's detail is the saga record itself: which step landed, which
        // fence was issued, which reconciliation decided. `worker-report` is the
        // closest declared kind, and the artifact kind vocabulary is a closed
        // list in the contracts, so this layer does not invent a thirteenth.
        kind: 'worker-report',
        workspaceId: input.workspaceId,
        correlationId: input.correlationId,
        contentType: 'application/json',
        bytes: new TextEncoder().encode(JSON.stringify(input.detail)),
      },
      now(),
    )
    appendAuditEntry(tx, {
      schema: AUDIT_SCHEMA,
      auditId: input.auditId,
      type: input.auditType,
      workspaceId: input.workspaceId,
      correlationId: input.correlationId,
      occurredAt: now(),
      taskId: input.taskId,
      ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
      artifactId,
    })
    tx.outbox.append({
      event: input.event,
      workspaceId: input.workspaceId,
      correlationId: input.correlationId,
      eventId: input.auditId,
    })
  }

  /** Read one intent, or throw the typed refusal a missing operation deserves. */
  function requireIntent(operationId: string): ClaimIntent {
    const intent = store.transaction(tx => readIntent(tx, operationId))
    if (intent === undefined) {
      throw new ExecutionError('not-found', `dsh-mywork: no claim operation "${operationId}"`, {
        details: { operationId },
      })
    }
    return intent
  }

  /** The outcome a saga already recorded, so a repeat answers instead of re-running. */
  function outcomeOf(intent: ClaimIntent, task?: Task): ClaimOutcome {
    return Object.freeze({
      operationId: intent.operationId,
      state: intent.state,
      taskId: intent.taskId,
      ...(intent.attemptId === undefined ? {} : { attemptId: intent.attemptId }),
      ...(intent.fence === undefined ? {} : { fence: intent.fence }),
      ...(intent.holder === undefined ? {} : { holder: intent.holder }),
      ...(task === undefined ? {} : { task }),
    })
  }

  /**
   * Read the task the graph holds, distinguishing "absent" from "unreadable".
   *
   * The difference decides whether a reconciler may act at all: a task the graph
   * reports as missing is an observation, while a graph that cannot be read is the
   * absence of one, and §49 forbids resolving a saga on the second.
   */
  async function readTask(taskId: TaskId): Promise<{ readonly task?: Task; readonly failure?: MyWorkErrorShape }> {
    try {
      return Object.freeze({ task: await graph.get(taskId) })
    } catch (error) {
      const refusal = refusalShape(error)
      if (refusal !== undefined) return Object.freeze({ failure: refusal })
      throw error
    }
  }

  /**
   * §9 step 3: create the attempt with its lease and its fence.
   *
   * Superseding a live attempt happens here, and only here. A second saga reaches
   * this point only after it **won the graph claim**, which means the graph has
   * already decided that the previous worker no longer holds the task — so moving
   * that attempt to `stale` records a decision the backend made, rather than
   * stealing work MyWork merely believes is free. The partial unique index would
   * refuse the insert otherwise, which is the §17 invariant holding either way.
   */
  function createAttempt(
    tx: MyWorkTransaction,
    intent: ClaimIntent,
    agentId: string,
    leaseMs: number,
  ): { readonly attempt: AttemptRecord; readonly superseded?: AttemptRecord } {
    const at = now()
    const superseded = readLiveAttempt(tx, intent.taskId)
    if (superseded !== undefined) {
      const moved = settleAttempt(tx, superseded.id, superseded.state, 'stale', at)
      if (!moved) {
        throw new ExecutionError(
          'conflict',
          `dsh-mywork: the live attempt "${superseded.id}" of task "${intent.taskId}" moved while superseding it`,
          { details: { taskId: intent.taskId, attemptId: superseded.id } },
        )
      }
    }
    const fence = allocateFence(tx, intent.taskId, at)
    const attempt: AttemptRecord = Object.freeze({
      id: `attempt-${intent.operationId}`,
      taskId: intent.taskId,
      workspaceId: intent.workspaceId,
      agentId,
      state: 'leased' as const,
      revision: 1,
      fence,
      controllerEpoch: intent.controllerEpoch,
      leaseExpiresAt: at + leaseMs,
      operationId: intent.operationId,
      createdAt: at,
    })
    insertAttempt(tx, attempt)
    return Object.freeze({ attempt, ...(superseded === undefined ? {} : { superseded }) });
  }

  /**
   * The ownership checks of §17: is this caller still the owner of this task?
   *
   * The fence is compared against the **task's** current token, and that is the
   * whole point of the order. An attempt that was superseded still carries its old
   * fence, so comparing the caller's token against the attempt's own copy would
   * let exactly the late result §17 exists to reject walk straight through. The
   * epoch follows, because "your controller lost leadership" is a different
   * answer from "your attempt was superseded".
   *
   * The revision is deliberately **not** checked here: see {@link assertRevision}.
   */
  function assertOwnership(
    attempt: AttemptRecord,
    taskFence: number,
    expectedFence: number,
    meta: OperationMeta,
  ): Result<number> {
    if (expectedFence !== taskFence) {
      return fail(
        new MyWorkError('STALE_FENCE', `dsh-mywork: fence ${expectedFence} is not the current fence ${taskFence} of task "${attempt.taskId}"`, {
          details: { expected: expectedFence, actual: taskFence, attemptId: attempt.id, taskId: attempt.taskId },
        }),
        meta,
      )
    }
    if (meta.controllerEpoch === undefined) {
      throw new TypeError(
        `dsh-mywork: a settlement of attempt "${attempt.id}" requires the controller epoch in OperationMeta`,
      )
    }
    const epoch = assertControllerEpoch(meta.controllerEpoch, attempt.controllerEpoch, meta)
    if (!epoch.ok) return fail(epoch.error, meta)
    const fence = assertFence(expectedFence, attempt.fence, meta)
    if (!fence.ok) return fail(fence.error, meta)
    return ok(attempt.fence, meta)
  }

  /**
   * §9 steps 3-5 against a saga whose claim already holds: create the attempt,
   * project it, and complete.
   *
   * Shared by `claim` and by `recover`'s `create-attempt` branch, because §9's
   * crash-recovery case ("ClaimIntent exists, TaskGraph claimed, Attempt missing")
   * must run exactly the same code as the happy path — a second implementation of
   * the same steps is where a double execution would come from.
   */
  async function attemptAndComplete(
    intent: ClaimIntent,
    agentId: string,
    leaseMs: number,
  ): Promise<Result<ClaimOutcome>> {
    const meta: OperationMeta = Object.freeze({
      operationId: intent.operationId,
      correlationId: intent.correlationId,
      expectedRevision: intent.baseRevision,
      controllerEpoch: intent.controllerEpoch,
    })
    let attempt: AttemptRecord
    try {
      attempt = store.transaction(tx => {
        // The state is re-read inside the transaction rather than taken from the
        // caller's copy: `claim` advances the intent to `claimed` in an earlier
        // transaction, so a caller-held state would be stale by exactly one step
        // and the compare-and-set below would refuse a legal transition.
        const current = readIntent(tx, intent.operationId)
        if (current === undefined) {
          throw new ExecutionError('not-found', `dsh-mywork: the claim "${intent.operationId}" disappeared`, {
            details: { operationId: intent.operationId },
          })
        }
        const created = createAttempt(tx, current, agentId, leaseMs)
        const steps = markStep(markStep(readSteps(tx, current.operationId), 'attempt', 'applied'), 'projection', 'pending')
        writeSteps(tx, current.operationId, steps)
        const moved = advanceIntent(tx, current.operationId, current.state, 'attempted', now(), {
          attemptId: created.attempt.id,
          fence: created.attempt.fence,
        })
        if (!moved) {
          throw new ExecutionError('conflict', `dsh-mywork: the claim "${current.operationId}" moved while creating its attempt`, {
            details: { operationId: current.operationId, state: current.state },
          })
        }
        record(tx, {
          workspaceId: current.workspaceId,
          correlationId: current.correlationId,
          event: {
            type: 'attempt.lease.granted',
            payload: {
              operationId: current.operationId,
              attemptId: created.attempt.id,
              taskId: current.taskId,
              fence: created.attempt.fence,
              ...(created.superseded === undefined ? {} : { supersededAttemptId: created.superseded.id }),
            },
          },
          auditType: 'attempt.assigned',
          auditId: `${current.operationId}-attempt`,
          taskId: current.taskId,
          attemptId: created.attempt.id,
          detail: { attempt: created.attempt, superseded: created.superseded ?? null },
        })
        return created.attempt
      })
    } catch (error) {
      if (error instanceof ExecutionError && error.code === 'conflict') {
        const failure = describe(error)
        // The state is read again rather than assumed: the transaction that threw
        // rolled back, so the row is at whatever state the last commit left it.
        store.transaction(tx => {
          const current = readIntent(tx, intent.operationId)
          if (current !== undefined) {
            advanceIntent(tx, current.operationId, current.state, 'recovering', now(), { failure })
            writeSteps(tx, current.operationId, markStep(readSteps(tx, current.operationId), 'attempt', 'failed', failure))
          }
        })
        return fail(
          new MyWorkError('TASK_CONFLICT', error.message, { details: { ...error.details, failure } }),
          meta,
        )
      }
      throw error
    }

    // §9 step 4: the projection. A graph that refuses here does **not** undo the
    // attempt: §49 keeps execution going when the board or the graph is
    // unavailable and degrades the projection instead, so the saga stays at
    // `attempted` with a live, authoritative lease and the caller is told.
    //
    // A task that is already `assigned` is the one refusal that is not a failure:
    // it means the projection landed in an earlier run of this saga (or of a
    // previous one on the same task), and re-issuing `assigned → assigned` would
    // be an illegal transition on every backend. The observation decides.
    let task: Task | undefined = (await readTask(intent.taskId)).task
    let projectionFailure: string | undefined
    if (task?.state !== 'assigned') {
      try {
        task = await graph.transition({
          id: intent.taskId,
          to: 'assigned',
          meta,
          expectedRevision: intent.baseRevision,
          expectedAssignee: intent.claimant,
        })
      } catch (error) {
        const refusal = refusalShape(error)
        if (refusal === undefined) throw error
        const observed = (await readTask(intent.taskId)).task
        if (refusal.code === 'TASK_CONFLICT' && observed?.state === 'assigned') {
          task = observed
        } else {
          projectionFailure = `${refusal.code}: ${refusal.message}`
        }
      }
    }
    if (projectionFailure !== undefined) {
      store.transaction(tx => {
        writeSteps(tx, intent.operationId, markStep(readSteps(tx, intent.operationId), 'projection', 'failed', projectionFailure))
      })
      return ok(
        Object.freeze({
          operationId: intent.operationId,
          state: 'attempted' as const,
          taskId: intent.taskId,
          attemptId: attempt.id,
          fence: attempt.fence,
          projectionDegraded: true,
        }),
        meta,
      )
    }

    // §9 step 5: completed, with the operation identity carried through. The
    // projection is recorded as its own state first, so the window between step 4
    // and step 5 is observable rather than inferred: a saga found in `projected`
    // is one whose task is already `assigned` and which only owes its completion.
    store.transaction(tx => {
      const steps = markStep(readSteps(tx, intent.operationId), 'projection', 'applied')
      writeSteps(tx, intent.operationId, steps)
      const projected = advanceIntent(tx, intent.operationId, 'attempted', 'projected', now())
      if (!projected) {
        throw new ExecutionError('conflict', `dsh-mywork: the claim "${intent.operationId}" moved while projecting`, {
          details: { operationId: intent.operationId },
        })
      }
    })
    store.transaction(tx => {
      const steps = markStep(readSteps(tx, intent.operationId), 'complete', 'applied')
      writeSteps(tx, intent.operationId, steps)
      const moved = advanceIntent(tx, intent.operationId, 'projected', 'completed', now())
      if (!moved) {
        throw new ExecutionError('conflict', `dsh-mywork: the claim "${intent.operationId}" moved while completing`, {
          details: { operationId: intent.operationId },
        })
      }
      record(tx, {
        workspaceId: intent.workspaceId,
        correlationId: intent.correlationId,
        event: {
          type: 'claim.completed',
          payload: { operationId: intent.operationId, taskId: intent.taskId, attemptId: attempt.id, fence: attempt.fence },
        },
        auditType: 'claim.recorded',
        auditId: `${intent.operationId}-completed`,
        taskId: intent.taskId,
        attemptId: attempt.id,
        detail: { operationId: intent.operationId, state: 'completed', attempt },
      })
    })
    return ok(
      Object.freeze({
        operationId: intent.operationId,
        state: 'completed' as const,
        taskId: intent.taskId,
        attemptId: attempt.id,
        fence: attempt.fence,
        ...(task === undefined ? {} : { task }),
      }),
      meta,
    )
  }

  const saga: ClaimSaga = {
    async claim(command: ClaimCommand): Promise<Result<ClaimOutcome>> {
      requireClaim(command)
      const meta = command.meta
      const existing = store.transaction(tx => readIntent(tx, meta.operationId))
      if (existing !== undefined) {
        // The operation id names an operation, not a slot: answering a different
        // claim with the first one's outcome would report work nobody asked for.
        const sameIntent =
          existing.taskId === command.taskId
          && existing.claimant === command.claimant
          && existing.workspaceId === command.workspaceId
        if (!sameIntent) {
          return fail(
            new MyWorkError('TASK_CONFLICT', 'dsh-mywork: the operation id is already used by another claim', {
              details: { operationId: meta.operationId, reason: 'operation-id-reused', taskId: existing.taskId },
            }),
            meta,
          )
        }
        if (isTerminalIntent(existing.state)) {
          // A settled saga answers with what it recorded, and with the task as the
          // graph holds it now, so a repeat and the first call are indistinguishable
          // to the caller — which is what idempotency means here.
          const observed = await readTask(existing.taskId)
          return ok(outcomeOf(existing, observed.task), meta)
        }
        // An unfinished saga is not re-run here: resuming it is `recover`'s job,
        // because only a decision can tell "finish it" from "take it away".
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: the claim "${meta.operationId}" is unfinished in state "${existing.state}"`, {
            details: { operationId: meta.operationId, state: existing.state, reason: 'claim-unfinished' },
          }),
          meta,
        )
      }

      const at = now()
      const intent: ClaimIntent = Object.freeze({
        operationId: meta.operationId,
        correlationId: meta.correlationId,
        workspaceId: command.workspaceId,
        taskId: command.taskId,
        claimant: command.claimant,
        controllerEpoch: meta.controllerEpoch ?? 0,
        baseRevision: command.expectedRevision,
        state: 'recorded' as const,
        // Recorded at step 1 so a recovery can create the attempt §9 says is missing
        // with the agent and the lease window the work was actually admitted for,
        // instead of inventing either at recovery time (§17).
        agentId: command.agentId,
        leaseMs: command.leaseMs,
        recordedAt: at,
        updatedAt: at,
      })

      // §9 step 1. Its own commit, before the graph is touched: a crash from here
      // on leaves a durable statement of what was about to happen.
      store.transaction(tx => {
        insertIntent(tx, intent)
        writeSteps(tx, intent.operationId, initialSteps())
        record(tx, {
          workspaceId: intent.workspaceId,
          correlationId: intent.correlationId,
          event: {
            type: 'claim.intent.recorded',
            payload: { operationId: intent.operationId, taskId: intent.taskId, baseRevision: intent.baseRevision },
          },
          auditType: 'claim.recorded',
          auditId: `${intent.operationId}-recorded`,
          taskId: intent.taskId,
          detail: { intent },
        })
      })

      // §9 step 2. `expectedRevision` is deliberately not passed: `bd update
      // --claim` takes no precondition (ADR023), so the revision is guarded at
      // step 4 through `graph.transition`, which does accept one.
      let claimResult: { readonly won: boolean; readonly holder?: string }
      try {
        claimResult = await graph.claim({ id: intent.taskId, claimant: intent.claimant, meta })
      } catch (error) {
        const refusal = refusalShape(error)
        if (refusal === undefined) throw error
        const failure = `${refusal.code}: ${refusal.message}`
        store.transaction(tx => {
          advanceIntent(tx, intent.operationId, 'recorded', 'recovering', now(), { failure })
          writeSteps(tx, intent.operationId, markStep(readSteps(tx, intent.operationId), 'claim', 'failed', failure))
        })
        return fail(refusal, meta)
      }

      if (!claimResult.won) {
        // Losing the race is an ordinary outcome of two workers reaching one ready
        // task, not an error — but this saga has nothing left to do.
        const holder = claimResult.holder
        store.transaction(tx => {
          advanceIntent(tx, intent.operationId, 'recorded', 'abandoned', now(), {
            ...(holder === undefined ? {} : { holder }),
          })
          writeSteps(
            tx,
            intent.operationId,
            markStep(readSteps(tx, intent.operationId), 'claim', 'failed', `held by ${holder ?? 'another worker'}`),
          )
        })
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: task "${intent.taskId}" is held by "${holder ?? 'another worker'}"`, {
            details: { taskId: intent.taskId, holder: holder ?? null, reason: 'claim-lost' },
          }),
          meta,
        )
      }

      store.transaction(tx => {
        advanceIntent(tx, intent.operationId, 'recorded', 'claimed', now())
        writeSteps(tx, intent.operationId, markStep(readSteps(tx, intent.operationId), 'claim', 'applied'))
      })

      return attemptAndComplete(intent, command.agentId, command.leaseMs)
    },

    async settle(command: AttemptSettlementCommand): Promise<Result<ClaimOutcome>> {
      // The target state and the operation identity are validated before anything is
      // read: `settled_at` is what frees a task's lease slot, so a target that is not
      // terminal would release the lease while leaving the attempt live, and a
      // missing identity would surface as a TypeError from inside a transaction
      // rather than as the refusal the caller can act on.
      const settlement = requireObject(command, 'a settlement command')
      const meta = requireObject(settlement['meta'], 'the operation identity') as unknown as OperationMeta
      if (!ATTEMPT_TERMINAL_STATES.includes(settlement['to'] as AttemptRecord['state'])) {
        throw new ExecutionError(
          'invalid-input',
          `dsh-mywork: a settlement must target a terminal attempt state, received "${String(settlement['to'])}"`,
        )
      }
      const to = settlement['to'] as 'completed' | 'failed' | 'timed-out' | 'cancelled'
      const authority = requireObject(command.authority, 'attempt authority')
      requireText(authority['attemptId'], 'attemptId')
      requireCounter(authority['expectedRevision'], 'expectedRevision')
      requireCounter(authority['expectedFence'], 'expectedFence')
      requireCounter(authority['at'], 'at')
      requireCounter(authority['controllerEpoch'], 'controllerEpoch')
      requireText(meta.operationId, 'operationId')
      requireText(meta.correlationId, 'correlationId')
      const attemptId = String(authority['attemptId'])
      const expectedRevision = Number(authority['expectedRevision'])
      const expectedFence = Number(authority['expectedFence'])
      const at = Number(authority['at'])

      const attempt = store.transaction(tx => readAttempt(tx, attemptId))
      if (attempt === undefined) {
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: no attempt "${attemptId}"`, {
            details: { attemptId, reason: 'attempt-not-found' },
          }),
          meta,
        )
      }
      const intent = store.transaction(tx => readIntent(tx, attempt.operationId))
      if (intent === undefined) {
        return fail(
          new MyWorkError('CONTRACT_MISMATCH', `dsh-mywork: attempt "${attemptId}" names no claim saga`, {
            details: { attemptId, operationId: attempt.operationId },
          }),
          meta,
        )
      }

      const taskFence = store.transaction(tx => readFence(tx, attempt.taskId))
      const checked = assertOwnership(attempt, taskFence, expectedFence, meta)
      if (!checked.ok) return fail(checked.error, meta)

      if (isTerminalAttempt(attempt.state)) {
        // The attempt already settled, so its revision has moved past whatever the
        // caller saw. That is not a stale caller — it is the same fact arriving
        // twice — so a repeat answers with the recorded outcome instead of being
        // refused for a revision the settlement itself changed.
        if (attempt.state !== to) {
          return fail(
            new MyWorkError('TASK_CONFLICT', `dsh-mywork: attempt "${attemptId}" is already "${attempt.state}"`, {
              details: { attemptId, state: attempt.state, requested: to, reason: 'attempt-already-settled' },
            }),
            meta,
          )
        }
        return ok(outcomeOf(intent), meta)
      }

      // Only a live attempt is checked against the revision the caller observed:
      // a caller that cannot say which revision it is speaking about, while the
      // attempt is still open, is exactly the caller the check exists for.
      const revision = assertRevision(expectedRevision, attempt.revision, meta)
      if (!revision.ok) return fail(revision.error, meta)

      const moved = store.transaction(tx => {
        const settled = settleAttempt(
          tx,
          attemptId,
          attempt.state,
          to,
          at,
          expectedRevision,
          expectedFence,
        )
        if (!settled) return false
        writeSteps(
          tx,
          intent.operationId,
          markStep(readSteps(tx, intent.operationId), 'complete', 'applied', `settled as ${to}`),
        )
        // A saga that already completed keeps that state: settling its attempt is a
        // later fact about the same operation, not a second completion. A saga that
        // stopped short of completion (a degraded projection, say) is settled by
        // this call, which is the `recovered` case.
        if (intent.state !== 'completed') {
          advanceIntent(tx, intent.operationId, intent.state, 'recovered', at)
        }
        record(tx, {
          workspaceId: attempt.workspaceId,
          correlationId: meta.correlationId,
          event: {
            type: 'claim.recovered',
            payload: {
              operationId: intent.operationId,
              attemptId,
              taskId: attempt.taskId,
              to: to,
              fence: attempt.fence,
            },
          },
          auditType: 'claim.recovered',
          auditId: `${intent.operationId}-settled-${to}`,
          taskId: attempt.taskId,
          attemptId,
          detail: { attemptId, to: to, fence: attempt.fence, revision: attempt.revision },
        })
        return true
      })
      if (!moved) {
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: attempt "${attemptId}" moved while settling`, {
            details: { attemptId, reason: 'attempt-moved' },
          }),
          meta,
        )
      }
      const settledState = store.transaction(tx => readIntent(tx, intent.operationId)?.state ?? intent.state)
      return ok(
        Object.freeze({
          operationId: intent.operationId,
          // The saga's own state, read back rather than assumed: settling an
          // attempt is not the same fact as finishing a claim, and reporting the
          // second when only the first happened would overstate what occurred.
          state: settledState,
          taskId: attempt.taskId,
          attemptId,
          fence: attempt.fence,
        }),
        meta,
      )
    },

    async recover(request: ClaimRecoveryRequest): Promise<Result<ClaimOutcome>> {
      requireRecovery(request)
      const intent = requireIntent(request.operationId)
      const meta: OperationMeta = Object.freeze({
        operationId: intent.operationId,
        correlationId: intent.correlationId,
        controllerEpoch: intent.controllerEpoch,
      })
      if (isTerminalIntent(intent.state)) return ok(outcomeOf(intent), meta)

      const observed = await readTask(intent.taskId)
      if (observed.failure !== undefined) {
        // §49 and §9's recovery table both forbid acting on absent evidence:
        // revoking a live attempt because the graph could not be read is the one
        // mistake this path exists to avoid.
        return fail(observed.failure, meta)
      }

      // Two different questions, and conflating them revokes the wrong lease.
      //
      // `sagaAttempt` answers "did **this** saga create an attempt?" — that is what
      // `reconcileClaim`'s `attemptExists` means, and it is what decides whether
      // this saga's own work has to be finished or taken away.
      //
      // `taskAttempt` answers "does **anyone** hold this task?" — which may be a
      // newer, legitimate worker. This saga must never revoke that one: §49's
      // "attempt exists, agent does not" is about the agent this saga started.
      const sagaAttempt = store.transaction(tx => readSagaAttempt(tx, intent.operationId))
      const taskAttempt = store.transaction(tx => readLiveAttempt(tx, intent.taskId))
      const decision = reconcileClaim({
        taskId: intent.taskId,
        operationId: intent.operationId,
        claimant: intent.claimant,
        attemptExists: sagaAttempt !== undefined,
        ...(observed.task === undefined ? {} : { task: observed.task }),
      })

      // A live attempt that belongs to another saga means this saga is simply
      // superseded: the graph has moved on, someone else owns the work, and there
      // is nothing here to revoke. Closing the intent is the honest answer, and it
      // leaves the healthy lease untouched.
      if (sagaAttempt === undefined && taskAttempt !== undefined) {
        const at = request.decision.at
        store.transaction(tx => {
          advanceIntent(tx, intent.operationId, intent.state, 'abandoned', at, {
            decidedBy: request.decision.decidedBy,
            ...(request.decision.reason === undefined ? {} : { decisionReason: request.decision.reason }),
            holder: observed.task?.assignee ?? taskAttempt.agentId,
          })
          record(tx, {
            workspaceId: intent.workspaceId,
            correlationId: intent.correlationId,
            event: {
              type: 'claim.recovered',
              payload: {
                operationId: intent.operationId,
                action: 'superseded-by-other-saga',
                taskId: intent.taskId,
                holder: taskAttempt.operationId,
              },
            },
            auditType: 'claim.recovered',
            auditId: `${intent.operationId}-superseded`,
            taskId: intent.taskId,
            detail: { reconciliation: decision, supersededBy: taskAttempt.operationId },
          })
        })
        return ok(
          Object.freeze({
            operationId: intent.operationId,
            state: 'abandoned' as const,
            taskId: intent.taskId,
            reconciliation: decision,
            ...(observed.task === undefined ? {} : { task: observed.task }),
          }),
          meta,
        )
      }

      if (decision.action === 'complete') {
        // The claim and the attempt agree. What is still owed is the projection and
        // the completion, so the saga finishes them rather than being declared done
        // on a guess.
        //
        // Every state short of `completed` is finishable, not just `attempted`: a
        // saga can stop at `attempted` (projection not written), at `projected`
        // (completion not written), or at `recovering` (a step failed and was
        // recorded as such). Treating only one of them as recoverable is how a saga
        // ends up open forever with `recover` reporting success — the dead end a
        // probe found, and the reason this branch keys on "not yet completed"
        // rather than on one state.
        if (sagaAttempt !== undefined && intent.state !== 'completed') {
          // The projection may have landed already: §9 step 4 and step 5 are two
          // commits, and a crash between them leaves the task `assigned` with the
          // saga still short of `completed`. A transition to the state the task is
          // already in is illegal on every backend — `assigned → assigned` is not
          // an edge in the table, and the real adapter refuses it too — so the
          // observation is what decides, not a re-issue of the call. Without this
          // the one window §9 names would be permanently unrecoverable.
          const alreadyProjected = observed.task?.state === 'assigned'
          let task: Task | undefined = observed.task
          if (!alreadyProjected) {
            try {
              task = await graph.transition({
                id: intent.taskId,
                to: 'assigned',
                meta,
                expectedRevision: intent.baseRevision,
                expectedAssignee: intent.claimant,
              })
            } catch (error) {
              const refusal = refusalShape(error)
              if (refusal === undefined) throw error
              // A transition the graph refuses because the task is already where
              // the saga wanted it is the crash window, not a failure: the
              // projection did land, and the saga may finish.
              const movedAlready = refusal.code === 'TASK_CONFLICT'
                && (await readTask(intent.taskId)).task?.state === 'assigned'
              if (!movedAlready) {
                store.transaction(tx => {
                  writeSteps(
                    tx,
                    intent.operationId,
                    markStep(readSteps(tx, intent.operationId), 'projection', 'failed', `${refusal.code}: ${refusal.message}`),
                  )
                })
                return fail(refusal, meta)
              }
              task = (await readTask(intent.taskId)).task
            }
          }
          store.transaction(tx => {
            const steps = markStep(markStep(readSteps(tx, intent.operationId), 'projection', 'applied'), 'complete', 'applied')
            writeSteps(tx, intent.operationId, steps)
            advanceIntent(tx, intent.operationId, intent.state, 'recovered', now(), {
              decidedBy: request.decision.decidedBy,
              ...(request.decision.reason === undefined ? {} : { decisionReason: request.decision.reason }),
            })
            record(tx, {
              workspaceId: intent.workspaceId,
              correlationId: intent.correlationId,
              event: {
                type: 'claim.recovered',
                payload: { operationId: intent.operationId, action: 'complete', taskId: intent.taskId },
              },
              auditType: 'claim.recovered',
              // A recovery is a fact that can happen more than once — a first
              // attempt and the retry that finishes the plan are two different
              // observations — so the id carries a unique suffix. A fixed id would
              // make the second recovery collide in the append-only audit and fail
              // as `audit-conflict`, which is exactly what a repeated `recover` on a
              // saga that moved on would hit.
              auditId: `${intent.operationId}-recovered-complete-${randomUUID().slice(0, 8)}`,
              taskId: intent.taskId,
              attemptId: sagaAttempt.id,
              detail: { reconciliation: decision, attempt: sagaAttempt },
            })
          })
          return ok(
            Object.freeze({
              operationId: intent.operationId,
              state: 'recovered' as const,
              taskId: intent.taskId,
              attemptId: sagaAttempt.id,
              fence: sagaAttempt.fence,
              reconciliation: decision,
              ...(task === undefined ? {} : { task }),
            }),
            meta,
          )
        }
        // Unreachable through the branches above, and deliberately fail-closed: the
        // one answer this path must never give is `ok` on a saga that still owes
        // work, because a reconciler reading that would stop looking at an intent
        // that never settles.
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: the claim "${intent.operationId}" is open in state "${intent.state}" and recovery could not finish it`, {
            details: { operationId: intent.operationId, state: intent.state, action: decision.action, reason: 'claim-unfinishable' },
          }),
          meta,
        )
      }

      if (decision.action === 'create-attempt') {
        // §9's "ClaimIntent exists, TaskGraph claimed, Attempt missing". The
        // reconciliation that was reached is attached to the outcome, so the
        // operator can see which branch ran rather than only that something did.
        // §9's "ClaimIntent exists, TaskGraph claimed, Attempt missing". The agent
        // and the lease window come from the recorded intent, so the recovered
        // attempt is the one the claim was admitted for; a saga that never recorded
        // them cannot have reached step 3, and is refused rather than guessed at.
        if (intent.agentId === undefined || intent.leaseMs === undefined) {
          return fail(
            new MyWorkError('CONTRACT_MISMATCH', `dsh-mywork: the claim "${intent.operationId}" records no agent, so its attempt cannot be recovered`, {
              details: { operationId: intent.operationId, reason: 'claim-agent-missing' },
            }),
            meta,
          )
        }
        const resumed = await attemptAndComplete(intent, intent.agentId, intent.leaseMs)
        if (!resumed.ok) return resumed
        return ok(Object.freeze({ ...resumed.value, reconciliation: decision }), meta)
      }

      if (decision.action === 'revoke-claim') {
        // An attempt exists but the graph no longer names this claimant, so a newer
        // worker owns the work and this one must stop (§49).
        if (sagaAttempt === undefined) {
          throw new ExecutionError('conflict', `dsh-mywork: the claim "${intent.operationId}" has no live attempt to revoke`, {
            details: { operationId: intent.operationId },
          })
        }
        const at = request.decision.at
        store.transaction(tx => {
          settleAttempt(tx, sagaAttempt.id, sagaAttempt.state, 'revoked', at)
          advanceIntent(tx, intent.operationId, intent.state, 'revoked', at, {
            decidedBy: request.decision.decidedBy,
            ...(request.decision.reason === undefined ? {} : { decisionReason: request.decision.reason }),
            ...(observed.task?.assignee === undefined ? {} : { holder: observed.task.assignee }),
          })
          record(tx, {
            workspaceId: intent.workspaceId,
            correlationId: intent.correlationId,
            event: {
              type: 'attempt.lease.revoked',
              payload: { operationId: intent.operationId, attemptId: sagaAttempt.id, taskId: intent.taskId, reason: decision.reason },
            },
            auditType: 'attempt.revoked',
            auditId: `${intent.operationId}-revoked`,
            taskId: intent.taskId,
            attemptId: sagaAttempt.id,
            detail: { reconciliation: decision, attempt: sagaAttempt },
          })
        })
        return ok(
          Object.freeze({
            operationId: intent.operationId,
            state: 'revoked' as const,
            taskId: intent.taskId,
            attemptId: sagaAttempt.id,
            fence: sagaAttempt.fence,
            reconciliation: decision,
            ...(observed.task === undefined ? {} : { task: observed.task }),
          }),
          meta,
        )
      }

      // `abandon-intent`: the claim never took effect, so there is nothing to take
      // away — which is why this is not a revocation.
      const at = request.decision.at
      store.transaction(tx => {
        advanceIntent(tx, intent.operationId, intent.state, 'abandoned', at, {
          decidedBy: request.decision.decidedBy,
          ...(request.decision.reason === undefined ? {} : { decisionReason: request.decision.reason }),
        })
        record(tx, {
          workspaceId: intent.workspaceId,
          correlationId: intent.correlationId,
          event: {
            type: 'claim.recovered',
            payload: { operationId: intent.operationId, action: 'abandon-intent', taskId: intent.taskId },
          },
          auditType: 'claim.recovered',
          auditId: `${intent.operationId}-abandoned`,
          taskId: intent.taskId,
          detail: { reconciliation: decision },
        })
      })
      return ok(
        Object.freeze({
          operationId: intent.operationId,
          state: 'abandoned' as const,
          taskId: intent.taskId,
          reconciliation: decision,
          ...(observed.task === undefined ? {} : { task: observed.task }),
        }),
        meta,
      )
    },

    async revoke(request: ClaimRecoveryRequest): Promise<Result<ClaimOutcome>> {
      requireRecovery(request)
      const intent = requireIntent(request.operationId)
      const meta: OperationMeta = Object.freeze({
        operationId: intent.operationId,
        correlationId: intent.correlationId,
        controllerEpoch: intent.controllerEpoch,
      })
      if (intent.state === 'revoked') return ok(outcomeOf(intent), meta)
      if (isTerminalIntent(intent.state)) {
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: the claim "${intent.operationId}" is already "${intent.state}"`, {
            details: { operationId: intent.operationId, state: intent.state, reason: 'claim-settled' },
          }),
          meta,
        )
      }
      const at = request.decision.at
      // The attempt this saga created, not whatever attempt the task happens to
      // hold. Revoking an explicit operation must never reach a newer worker's
      // lease: that worker took the task over legitimately, and this call names a
      // different operation — the same distinction `recover` has to make.
      const liveAttempt = store.transaction(tx => readSagaAttempt(tx, intent.operationId))
      store.transaction(tx => {
        if (liveAttempt !== undefined) {
          settleAttempt(tx, liveAttempt.id, liveAttempt.state, 'revoked', at)
        }
        advanceIntent(tx, intent.operationId, intent.state, 'revoked', at, {
          decidedBy: request.decision.decidedBy,
          ...(request.decision.reason === undefined ? {} : { decisionReason: request.decision.reason }),
        })
        record(tx, {
          workspaceId: intent.workspaceId,
          correlationId: intent.correlationId,
          event: {
            type: 'attempt.lease.revoked',
            payload: {
              operationId: intent.operationId,
              taskId: intent.taskId,
              ...(liveAttempt === undefined ? {} : { attemptId: liveAttempt.id }),
              reason: request.decision.reason ?? null,
            },
          },
          auditType: 'attempt.revoked',
          auditId: `${intent.operationId}-revoked-by-decision`,
          taskId: intent.taskId,
          ...(liveAttempt === undefined ? {} : { attemptId: liveAttempt.id }),
          detail: { decision: request.decision, attempt: liveAttempt ?? null },
        })
      })
      return ok(
        Object.freeze({
          operationId: intent.operationId,
          state: 'revoked' as const,
          taskId: intent.taskId,
          ...(liveAttempt === undefined ? {} : { attemptId: liveAttempt.id, fence: liveAttempt.fence }),
        }),
        meta,
      )
    },

    attemptOf(taskId: TaskId): AttemptRecord | undefined {
      return store.transaction(tx => readLiveAttempt(tx, taskId))
    },

    liveAttempts(workspaceId?: WorkspaceId): readonly AttemptRecord[] {
      return store.transaction(tx => listLiveAttempts(tx, workspaceId))
    },

    openIntents(workspaceId?: WorkspaceId): readonly ClaimIntent[] {
      return store.transaction(tx => listOpenIntents(tx, workspaceId))
    },

    stepsOf(operationId: string): readonly ClaimStep[] {
      return store.transaction(tx => readSteps(tx, operationId))
    },
  }

  return saga
}