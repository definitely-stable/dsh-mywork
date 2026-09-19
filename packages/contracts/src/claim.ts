/**
 * The claim saga: ClaimIntent, its steps, and the recovery decision
 * (architecture §9, §17, §18.2, §49).
 *
 * Beads/Task Graph and MyWork DB share no ACID transaction, so §9 makes the
 * claim a saga: the intent is recorded durably *before* the graph is touched,
 * every step is idempotent, and no workflow may assume "usually the two calls
 * run one after another". These are the vocabulary types of that saga; the
 * store, the state machine, and the reconciliation are in
 * `@dsh-mywork/execution`.
 *
 * The decision vocabulary lives here rather than in the adapter that first
 * needed it, because the saga and the adapter must not hold two private copies
 * of one truth: `@dsh-mywork/beads-adapter` re-exports
 * {@link ClaimReconciliationAction} from this module.
 * @module
 */

import type { AttemptState } from './attempt.ts'
import type {
  AttemptId,
  ControllerEpoch,
  CorrelationId,
  EpochMs,
  FenceToken,
  OperationId,
  Revision,
  TaskId,
  WorkspaceId,
} from './ids.ts'
import type { OperationMeta } from './operation.ts'
import type { PlanDecision } from './plan.ts'
import type { Task } from './task.ts'

/**
 * Lifecycle of one claim saga (§9 step list, §49 recovery).
 *
 * The main line is `recorded → claimed → attempted → projected → completed`.
 * The side states are the ones §49 requires a reconciler to be able to reach,
 * and `abandoned` is deliberately distinct from `revoked`: an intent whose
 * claim never took effect has nothing to take away, while a revoked one had a
 * live attempt that had to be stopped.
 */
export type ClaimIntentState =
  /** The intent is durable; the graph has not been touched. */
  | 'recorded'
  /** The graph recorded this claimant as the holder. */
  | 'claimed'
  /** An attempt with a lease and a fence token exists. */
  | 'attempted'
  /** The task was moved to `assigned`; the projection may catch up later. */
  | 'projected'
  /** Terminal success: every step landed. */
  | 'completed'
  /** A step failed or was lost; an operator or a reconciler decides (§49). */
  | 'recovering'
  /** A recovery finished the saga. */
  | 'recovered'
  /** Terminal: the lease was revoked, or a newer fence superseded the attempt. */
  | 'revoked'
  /** Terminal: the claim never took effect, so there was nothing to revoke. */
  | 'abandoned'

/** Every claim-intent state, so callers and stores can enumerate them. */
export const CLAIM_INTENT_STATES: readonly ClaimIntentState[] = Object.freeze([
  'recorded',
  'claimed',
  'attempted',
  'projected',
  'completed',
  'recovering',
  'recovered',
  'revoked',
  'abandoned',
])

/** States from which no further step of the saga exists. */
export const CLAIM_INTENT_TERMINAL_STATES: readonly ClaimIntentState[] = Object.freeze([
  'completed',
  'recovered',
  'revoked',
  'abandoned',
])

/** States in which the saga still owes work and a reconciler must look at it. */
export const CLAIM_INTENT_OPEN_STATES: readonly ClaimIntentState[] = Object.freeze([
  'recorded',
  'claimed',
  'attempted',
  'projected',
  'recovering',
])

/**
 * What one recorded step of the saga is (§9 steps 1-5).
 *
 * `intent` and `claim` are the two calls that cannot be made atomic together;
 * `attempt`, `projection`, and `complete` are MyWork-local and follow the
 * recorded claim.
 */
export type ClaimStepKind =
  /** §9 step 1: `MyWork records ClaimIntent(operationId)`. */
  | 'intent'
  /** §9 step 2: `TaskGraph.claim(task, operationId)`. */
  | 'claim'
  /** §9 step 3: `MyWork creates Attempt + Lease`. */
  | 'attempt'
  /** §9 step 4: the task moves to `assigned` for the projection. */
  | 'projection'
  /** §9 step 5: `ClaimIntent → Completed`. */
  | 'complete'

/** Every step kind, in the order §9 lists them. */
export const CLAIM_STEP_KINDS: readonly ClaimStepKind[] = Object.freeze([
  'intent',
  'claim',
  'attempt',
  'projection',
  'complete',
])

/**
 * State of one step, as observed rather than as assumed.
 *
 * The same three values the staged plan mutation uses: a step is `applied` only
 * when the world shows it, never because a call returned without throwing.
 */
export type ClaimStepState =
  /** Not attempted yet. */
  | 'pending'
  /** Observed in the world. */
  | 'applied'
  /** Attempted and not observed; the saga must be reconciled. */
  | 'failed'

/** One recorded step of a claim saga. */
export interface ClaimStep {
  /** Position inside the saga; steps are applied in this order. */
  readonly seq: number
  /** Which §9 step this is. */
  readonly kind: ClaimStepKind
  /** How the step ended, as observed. */
  readonly state: ClaimStepState
  /** Free-form detail for the operator: an adapter message, a reason. */
  readonly detail?: string
}

/**
 * The durable record of one claim saga (§9 step 1).
 *
 * `claimant` is stored here on purpose. It is the identity the graph records as
 * the assignee, and §49's "Attempt exists, agent does not" case needs it to tell
 * "this worker still holds the claim" from "somebody else does" — a question the
 * saga must be able to ask without a live worker to ask it of.
 */
export interface ClaimIntent {
  /** Operation identity carried through every store hop (§9). */
  readonly operationId: OperationId
  /** Correlation of the workflow that issued it (§9). */
  readonly correlationId: CorrelationId
  /** Task being claimed. */
  readonly taskId: TaskId
  /** Workspace the task belongs to. */
  readonly workspaceId: WorkspaceId
  /** Identity claiming the task; the graph records it as the assignee. */
  readonly claimant: string
  /** Controller epoch that issued the claim (§3). */
  readonly controllerEpoch: ControllerEpoch
  /** Task revision the caller observed when it decided to claim. */
  readonly baseRevision: Revision
  /** Current state. */
  readonly state: ClaimIntentState
  /** Attempt this saga created, once §9 step 3 ran. */
  readonly attemptId?: AttemptId
  /** Fence token of that attempt (§17). */
  readonly fence?: FenceToken
  /** Holder the graph reported, when this saga lost the race or was revoked. */
  readonly holder?: string
  /** Why the saga stopped short, when it did. */
  readonly failure?: string
  /** Who decided the recovery or the revocation, when one happened. */
  readonly decidedBy?: string
  /** Why that decision was taken. */
  readonly decisionReason?: string
  /**
   * Agent the attempt was created for, recorded on the saga.
   *
   * A recovery creates the attempt §9 says is missing, and §17's attempt names the
   * agent performing the work — so the saga has to remember it rather than invent
   * one at recovery time. Absent only for a saga that never reached step 3 and
   * whose recovery therefore has no agent to restore.
   */
  readonly agentId?: string
  /** Lease window the caller asked for, recorded so a recovery issues the same one. */
  readonly leaseMs?: number
  /** Clock reading of the intent. */
  readonly recordedAt: EpochMs
  /** Clock reading of the last change to this record. */
  readonly updatedAt: EpochMs
}

/** What one claim asks for. */
export interface ClaimCommand {
  /** Task to claim. */
  readonly taskId: TaskId
  /** Workspace the task belongs to. */
  readonly workspaceId: WorkspaceId
  /** Identity claiming the task. */
  readonly claimant: string
  /**
   * Task revision the caller observed. Enforced against the recorded intent,
   * not against the graph: `bd update --claim` takes no precondition, so a
   * guarded claim is staged through this saga instead (ADR023, ADR024).
   */
  readonly expectedRevision: Revision
  /** Agent that will perform the work of the attempt. */
  readonly agentId: string
  /** How long the issued lease stays valid, from the moment it is issued. */
  readonly leaseMs: number
  /** Operation identity of the saga (§9). */
  readonly meta: OperationMeta
}

/**
 * What one authoritative callback asserts before it may change anything.
 *
 * All three axes are required together, because they answer three different
 * questions: the revision says "you are speaking about the state you saw", the
 * epoch says "your controller still owns the work", and the fence says "your
 * attempt is still the one that owns this task" (§17).
 */
export interface AttemptAuthority {
  /** Attempt the caller believes it owns. */
  readonly attemptId: AttemptId
  /** Attempt revision the caller observed; a mismatch is `STALE_REVISION`. */
  readonly expectedRevision: Revision
  /** Controller epoch the caller belongs to; a mismatch is `LEASE_LOST`. */
  readonly controllerEpoch: ControllerEpoch
  /** Fence token the caller holds; a mismatch is `STALE_FENCE` (§17). */
  readonly expectedFence: FenceToken
  /** Clock reading of the call. */
  readonly at: EpochMs
}

/** Settling a running attempt: the authoritative callback of §17. */
export interface AttemptSettlementCommand {
  /** Authority the caller must present. */
  readonly authority: AttemptAuthority
  /** Terminal state the attempt reaches. */
  readonly to: 'completed' | 'failed' | 'timed-out' | 'cancelled'
  /** Operation identity of the settlement. */
  readonly meta: OperationMeta
}

/** One attempt as the saga stores it, with its lease and fence. */
export interface AttemptRecord {
  /** Attempt identifier. */
  readonly id: AttemptId
  /** Task the attempt works on. */
  readonly taskId: TaskId
  /** Workspace the attempt may touch. */
  readonly workspaceId: WorkspaceId
  /** Agent identity performing the work. */
  readonly agentId: string
  /** Current state (§18.2). */
  readonly state: AttemptState
  /** Aggregate revision; every accepted transition increments it. */
  readonly revision: Revision
  /** Fence token issued with the lease (§17). */
  readonly fence: FenceToken
  /** Controller epoch that issued the lease (§3). */
  readonly controllerEpoch: ControllerEpoch
  /** Clock reading after which the lease is no longer valid. */
  readonly leaseExpiresAt: EpochMs
  /** Saga that created this attempt. */
  readonly operationId: OperationId
  /** Clock reading of the attempt's creation. */
  readonly createdAt: EpochMs
  /** Clock reading of the terminal transition; absent while the attempt is live. */
  readonly settledAt?: EpochMs
}

/**
 * What a reconciler decides about one open saga (§9 crash-recovery, §49).
 *
 * `complete` means intent and attempt agree and nothing has to be done.
 * `create-attempt` is §9's "ClaimIntent exists, TaskGraph claimed, Attempt
 * missing". `revoke-claim` is the mirror: an attempt exists but the claim is not
 * held, so a newer worker owns the work and this one must stop. `abandon-intent`
 * is the case where the claim never took effect, so there is nothing to revoke.
 *
 * `undecided` is deliberately its own value rather than a reuse of `complete`: it
 * means the graph could not be read, so **no** resolution was reached and the
 * intent must stay open. Folding it into `complete` would let a caller that only
 * checks "did the reconciliation settle this?" treat an unread observation as a
 * finished saga — which is the failure mode the whole path exists to avoid.
 */
export type ClaimReconciliationAction =
  | 'complete'
  | 'create-attempt'
  | 'revoke-claim'
  | 'abandon-intent'
  | 'undecided'

/** One reconciliation decision, with the reason it was reached. */
export interface ClaimReconciliation {
  /** What the caller should do. */
  readonly action: ClaimReconciliationAction
  /** Why, in terms of what was observed. */
  readonly reason: string
}

/** What an operator or a reconciler asks the saga to do with an open intent. */
export type ClaimRecoveryAction =
  /** Finish the saga: verify what is there, then apply the remainder. */
  | 'recover'
  /** Take the claim and the lease away, and stop the attempt (§49). */
  | 'revoke'

/** One recovery request. */
export interface ClaimRecoveryRequest {
  /** Operation whose saga is being settled. */
  readonly operationId: OperationId
  /** What to do. */
  readonly action: ClaimRecoveryAction
  /** Who decided and when; a revocation of a live attempt is destructive. */
  readonly decision: PlanDecision
}

/** Outcome of a claim, a settlement, or a recovery. */
export interface ClaimOutcome {
  /** Operation the outcome belongs to. */
  readonly operationId: OperationId
  /** State the saga ended in. */
  readonly state: ClaimIntentState
  /** Task the saga is about. */
  readonly taskId: TaskId
  /** Attempt the saga created, when it created one. */
  readonly attemptId?: AttemptId
  /** Fence token of that attempt. */
  readonly fence?: FenceToken
  /** Holder the graph reported, when this saga lost the race. */
  readonly holder?: string
  /** The reconciliation a recovery reached, when one ran. */
  readonly reconciliation?: ClaimReconciliation
  /** The task as the graph reported it, when it could be read. */
  readonly task?: Task
}

/**
 * Prefix of the external reference a claimed task carries, so an operator can
 * find the saga from the graph side (§9 provenance).
 */
export const CLAIM_EXTERNAL_REF_PREFIX = 'mw-claim:'

/** Longest claimant identity the saga accepts, so a store write cannot be unbounded. */
export const MAX_CLAIMANT_LENGTH = 256
