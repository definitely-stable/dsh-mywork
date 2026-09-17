/**
 * Attempt, lease, and fence (architecture §8, §17, §18.2). Every unit of real
 * work runs inside an attempt; the lease names the owner and the fence token
 * makes a late result from an earlier attempt recognisable.
 * @module
 */

import type {
  AgentId,
  AttemptId,
  ControllerEpoch,
  EpochMs,
  FenceToken,
  Revision,
  TaskId,
  WorkspaceId,
} from './ids.ts'
import type { FrozenRevisions } from './revisions.ts'

/** Attempt states (architecture §18.2). */
export type AttemptState =
  /** Recorded, not yet leased. */
  | 'created'
  /** A lease with a fence token was issued. */
  | 'leased'
  /** The runtime is starting the agent. */
  | 'starting'
  /** The agent is working. */
  | 'running'
  /** The agent stopped working; its result is being collected. */
  | 'settling'
  /** Terminal success: the attempt produced a result. */
  | 'completed'
  /** Terminal failure. */
  | 'failed'
  /** Terminal failure: the attempt exceeded its deadline. */
  | 'timed-out'
  /** Terminal: the attempt was cancelled. */
  | 'cancelled'
  /** Terminal: the lease was revoked before the attempt settled. */
  | 'revoked'
  /** Terminal: a newer fence superseded this attempt; its late results are rejected. */
  | 'stale'

/** Every attempt state, in the order the architecture lists them. */
export const ATTEMPT_STATES: readonly AttemptState[] = Object.freeze([
  'created',
  'leased',
  'starting',
  'running',
  'settling',
  'completed',
  'failed',
  'timed-out',
  'cancelled',
  'revoked',
  'stale',
])

/** States in which an attempt still counts against a pool or a concurrency limit (§15). */
export const ATTEMPT_ACTIVE_STATES: readonly AttemptState[] = Object.freeze([
  'created',
  'leased',
  'starting',
  'running',
  'settling',
])

/** States from which no further transition exists. */
export const ATTEMPT_TERMINAL_STATES: readonly AttemptState[] = Object.freeze([
  'completed',
  'failed',
  'timed-out',
  'cancelled',
  'revoked',
  'stale',
])

/** Lease issued to one attempt (architecture §17). */
export interface Lease {
  /** Attempt the lease belongs to. */
  readonly attemptId: AttemptId
  /** Monotonic fence token; every new attempt on a task gets a higher one. */
  readonly fence: FenceToken
  /** Controller epoch that issued the lease (§3). */
  readonly controllerEpoch: ControllerEpoch
  /** Clock reading after which the lease is no longer valid. */
  readonly expiresAt: EpochMs
}

/** Git identity of one attempt's isolated worktree (architecture §19). */
export interface WorktreeRef {
  /** Worktree directory. */
  readonly path: string
  /** Branch created for the attempt. */
  readonly branch: string
  /** Base SHA the attempt started from. */
  readonly baseSha: string
  /** Head SHA the attempt finished on. */
  readonly headSha: string
}

/** One execution attempt of one task. */
export interface Attempt {
  /** Attempt identifier. */
  readonly id: AttemptId
  /** Task the attempt works on. */
  readonly taskId: TaskId
  /** Workspace the attempt may touch. */
  readonly workspaceId: WorkspaceId
  /** Agent identity that performs the work. */
  readonly agentId: AgentId
  /** Current state. */
  readonly state: AttemptState
  /** Aggregate revision; every accepted transition increments it. */
  readonly revision: Revision
  /** Lease and fence token; absent until the attempt is leased. */
  readonly lease?: Lease
  /** Revisions frozen when the attempt was admitted (§35). */
  readonly revisions: FrozenRevisions
  /** Isolated worktree, when the workspace is a git repository. */
  readonly worktree?: WorktreeRef
  /** Clock reading of the transition into `running`. */
  readonly startedAt?: EpochMs
  /** Clock reading of the transition out of `settling`. */
  readonly settledAt?: EpochMs
}
