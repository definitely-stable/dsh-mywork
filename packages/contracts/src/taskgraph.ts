/**
 * Task Graph port (architecture §8, §9, §11).
 *
 * §11 names `TaskGraphPort` as the canonical interface and `BeadsTaskGraphAdapter`
 * as its first backend, while §44 keeps Core free of any provider name: the port
 * below is the whole surface MyWork may ask of a task graph, and the adapter that
 * serves it is chosen by the registry, never by this contract.
 *
 * Authority is split by §8. The task graph owns description, dependencies,
 * **readiness**, priority, role requirement and final completion. MyWork owns the
 * current attempt, leases and fences, reviews, git refs and audit. This port
 * therefore never answers "who is running this": it answers "what is the shape of
 * the work and what may start", and {@link ClaimResult} hands back only what the
 * graph itself recorded about a claim.
 * @module
 */

import type { AttemptId, EpochMs, Revision, RoleId, TaskId, WorkspaceId } from './ids.ts'
import type { OperationMeta } from './operation.ts'
import type { Task, TaskState } from './task.ts'

/**
 * Capability flags one task graph may or may not offer (ADR023).
 *
 * Every flag names an operation that really exists somewhere in the backend's
 * surface. A flag is `false` when the backend cannot do it — never when doing it
 * would merely be inconvenient — because a caller that reads `false` gets a
 * {@link TaskGraphCapabilities} refusal instead of a silent emulation, and a
 * caller that reads `true` may rely on the stronger guarantee the flag promises.
 */
export interface TaskGraphCapabilities {
  /** An HTTP transport is available (`bd serve`). CLI-only adapters answer `false`. */
  readonly http: boolean
  /**
   * A whole plan applies as one atomic composite with a cycle check
   * (`bd create --graph`). `false` means a plan must be staged (ADR024).
   */
  readonly 'graph-apply': boolean
  /** Several writes commit as one transaction (`bd batch`). */
  readonly batch: boolean
  /**
   * That transaction can also **remove** dependencies. Kept separate from
   * {@link TaskGraphCapabilities.batch} on purpose: the two backends that offer
   * batching disagree exactly here (ADR024).
   */
  readonly 'batch-dep-remove': boolean
  /**
   * A batch can carry preconditions (`bd update --if-status` / `--if-assignee`).
   * A caller that needs a compare-and-set must check this flag.
   */
  readonly 'guarded-batch': boolean
  /** Metadata is written per key (`bd update --set-metadata`). */
  readonly 'metadata-set': boolean
  /** A durable mutation journal can be read by cursor (`bd events tail --since`). */
  readonly 'events-journal': boolean
  /** An issue can be claimed atomically (`bd update --claim`). */
  readonly 'claim-lease': boolean
  /** A held claim's lease can be kept alive (`bd heartbeat`). */
  readonly heartbeat: boolean
  /** Stale claims can be reverted (`bd reclaim`). */
  readonly reclaim: boolean
}

/** Every task-graph capability name, in the order ADR023 lists them. */
export const TASK_GRAPH_CAPABILITIES: readonly (keyof TaskGraphCapabilities)[] = Object.freeze([
  'http',
  'graph-apply',
  'batch',
  'batch-dep-remove',
  'guarded-batch',
  'metadata-set',
  'events-journal',
  'claim-lease',
  'heartbeat',
  'reclaim',
])

/**
 * How a task graph answers for one workspace, and which backend answered.
 *
 * `probed` records whether this was discovered by asking the backend or declared
 * from a fixed probe set — the distinction ADR023 draws between HTTP discovery
 * and the CLI-only case, kept visible so a caller is never told a fact nobody
 * established.
 */
export interface TaskGraphDescription {
  /** Adapter identifier, e.g. `beads`. */
  readonly adapterId: string
  /** Contract revision the adapter implements, e.g. `taskgraph/v1`. */
  readonly contractVersion: string
  /** What this backend can and cannot do. */
  readonly capabilities: TaskGraphCapabilities
  /** How {@link TaskGraphDescription.capabilities} was established. */
  readonly source: 'probed' | 'declared'
  /** Resolved workspace root this description describes, when known. */
  readonly workspaceRoot?: string
}

/** One task-graph edge: `from` depends on `to` (`from` cannot start before `to`). */
export interface TaskDependency {
  /** The dependent task. */
  readonly from: TaskId
  /** The task it waits for. */
  readonly to: TaskId
  /** Edge kind as the graph stores it; `blocks` is the only kind MyWork schedules on. */
  readonly kind: string
}

/** What a caller may filter ready work by (§11 `ReadyTaskQuery`). */
export interface ReadyTaskQuery {
  /** Restrict to these tasks; absent means the whole workspace. */
  readonly ids?: readonly TaskId[]
  /** Restrict to one workspace; cross-workspace edges are out of scope (§63). */
  readonly workspaceId?: WorkspaceId
  /** Upper bound on returned tasks. */
  readonly limit?: number
}

/**
 * A task reference from a readiness query.
 *
 * Readiness itself is deliberately absent: {@link TaskGraphPort.ready} returns
 * only what *is* ready, and {@link TaskGraphPort.blocked} only what is blocked,
 * so a caller never re-derives readiness from a field (ADR023: the `is_blocked`
 * field is not in `bd list --json` output and must not be trusted).
 */
export interface TaskRef {
  /** Task identifier. */
  readonly id: TaskId
  /** MyWork state the graph's own status maps onto. */
  readonly state: TaskState
}

/** One task that cannot start, and why. */
export interface BlockedTaskRef extends TaskRef {
  /** Ids the task is waiting for, as the graph reported them. */
  readonly blockedBy: readonly TaskId[]
}

/** Where readiness came from. Recorded so a projection can say how it knows. */
export type ReadinessSource = 'ready' | 'blocked'

/** A claim request (§9 step 2: `TaskGraph.claim(task, operationId)`). */
export interface ClaimTaskCommand {
  /** Task to claim. */
  readonly id: TaskId
  /**
   * Identity claiming the task. Beads records this as the assignee, so it is the
   * durable worker identity, not a per-process handle.
   */
  readonly claimant: string
  /** Operation identity carried through the cross-store saga (§9). */
  readonly meta: OperationMeta
  /**
   * Revision the caller observed. When the backend supports a guarded claim the
   * mismatch is reported as `STALE_REVISION`; when it does not, the adapter
   * refuses rather than claim blind.
   */
  readonly expectedRevision?: Revision
}

/**
 * Outcome of a claim.
 *
 * `won` distinguishes the caller that got the task from the caller that lost the
 * race: losing is a normal result of a concurrent claim, not an error, so it is
 * reported here instead of as a thrown failure.
 */
export interface ClaimResult {
  /** True when this caller now holds the task. */
  readonly won: boolean
  /** The task after the attempt, when it could be read. */
  readonly task?: Task
  /** Who holds it, when the caller lost. */
  readonly holder?: string
}

/** A state transition request (§11 `TaskTransitionCommand`). */
export interface TaskTransitionCommand {
  /** Task to move. */
  readonly id: TaskId
  /** State the task must reach. */
  readonly to: TaskState
  /** Operation identity carried through the cross-store saga (§9). */
  readonly meta: OperationMeta
  /**
   * Revision the caller observed. A backend with `guarded-batch` enforces it in
   * the compare-and-set; a backend without it is refused unless the caller
   * accepts the unguarded single-writer path.
   */
  readonly expectedRevision?: Revision
  /**
   * Assignee the caller believes holds the task, for a guarded transition. Only
   * meaningful together with {@link TaskTransitionCommand.expectedRevision}.
   */
  readonly expectedAssignee?: string
}

/** What one plan mutation asks the graph to do (§10.2). */
export interface PlanMutationCommand {
  /** Plan revision the mutation was computed against; a mismatch is `STALE_REVISION`. */
  readonly baseRevision: Revision
  /** Tasks to create. */
  readonly create?: readonly NewTaskSpec[]
  /** Field updates to existing tasks. */
  readonly update?: readonly TaskUpdateSpec[]
  /** Edges to add. */
  readonly addDependencies?: readonly TaskDependency[]
  /** Edges to remove. ADR024: this is the part no atomic primitive covers. */
  readonly removeDependencies?: readonly TaskDependency[]
  /** Operation identity carried through the cross-store saga (§9). */
  readonly meta: OperationMeta
}

/** One task a plan wants to create. */
export interface NewTaskSpec {
  /** Caller-owned key, used to wire dependencies inside the same mutation. */
  readonly key: string
  /** Task title. */
  readonly title: string
  /** Detail and acceptance criteria. */
  readonly description?: string
  /** Priority, higher first; the adapter inverts it for the backend (ADR023). */
  readonly priority?: number
  /** Role the task requires. */
  readonly roleRequirement?: RoleId
  /** Keys of tasks in this same mutation that must complete first. */
  readonly dependsOnKeys?: readonly string[]
  /** External reference linking the task to its MyWork card, e.g. `mw-card:MW-010`. */
  readonly externalRef?: string
}

/** One field update a plan wants to apply. */
export interface TaskUpdateSpec {
  /** Task to update. */
  readonly id: TaskId
  /** New title, when it changes. */
  readonly title?: string
  /** New priority, higher first. */
  readonly priority?: number
  /** Metadata keys to set. Written per key: no document replacement (ADR023). */
  readonly setMetadata?: Readonly<Record<string, string>>
}

/**
 * How a plan mutation was applied.
 *
 * ADR024 is explicit that MyWork must not claim atomicity the backend does not
 * give: `applied` means the backend applied it as one unit, `staged` means it was
 * applied step by step and verified afterwards.
 */
export type PlanMutationMode = 'atomic' | 'staged'

/** Result of a plan mutation. */
export interface PlanMutationResult {
  /** How the mutation was applied. */
  readonly mode: PlanMutationMode
  /** Keys of created tasks mapped to their new ids. */
  readonly created: Readonly<Record<string, TaskId>>
  /** Edges actually added. */
  readonly addedDependencies: readonly TaskDependency[]
  /** Edges actually removed. */
  readonly removedDependencies: readonly TaskDependency[]
}

/** One record read from the mutation journal. */
export interface TaskGraphEvent {
  /** Monotonic sequence number inside this replica's journal. */
  readonly seq: number
  /** Insert time, epoch milliseconds. */
  readonly at: EpochMs
  /** Operation the backend recorded. */
  readonly op: string
  /** Issue the mutation touched. */
  readonly taskId: TaskId
}

/**
 * Where the journal cursor stands.
 *
 * `replica` and `branch` are part of the cursor, not decoration: ADR023 records
 * that the Beads journal is per-replica and per-branch, so a cursor carried
 * across either one names a different record and must be discarded rather than
 * resumed.
 */
export interface JournalCursor {
  /** Last sequence number consumed. */
  readonly seq: number
  /** Replica that produced {@link JournalCursor.seq}. */
  readonly replica: string
  /** Dolt branch the records were committed on. */
  readonly branch: string
}

/** Outcome of reading the journal from a cursor. */
export interface JournalReadResult {
  /** Records after the cursor, in sequence order. */
  readonly events: readonly TaskGraphEvent[]
  /** Cursor to pass to the next read. */
  readonly cursor: JournalCursor
  /**
   * True when the requested prefix had already been pruned or the cursor no
   * longer belongs to this replica/branch, so the caller must re-baseline with a
   * full read instead of assuming it is caught up.
   */
  readonly reBaseline: boolean
}

/**
 * Severity of one diagnostic finding. One scale, shared with the Doctor.
 */
export type DiagnosticSeverity = 'ok' | 'warning' | 'error'

/**
 * One Doctor finding about a task graph binding.
 *
 * `fixCommand` is a string, never an executed action: the architecture requires
 * the adapter to *print* the exact command, and forbids it from silently
 * repairing the workspace (ADR023 — the adapter never runs `bd init`).
 */
export interface DiagnosticReport {
  /** Stable check name. */
  readonly check: string
  /** How bad this finding is. */
  readonly severity: DiagnosticSeverity
  /** What was observed. */
  readonly detail: string
  /** The exact command an operator can run, when a fix exists. */
  readonly fixCommand?: string
  /** Status names this finding is about, for the `status.custom` check. */
  readonly missing?: readonly string[]
}

/**
 * The canonical task-graph interface (architecture §11).
 *
 * Every method answers a {@link Result}-shaped value or a plain value; none of
 * them throw for an ordinary domain outcome. Failures that a caller must branch
 * on — a missing workspace, an unsupported capability, a stale revision, a cycle
 * — arrive as a typed failure carrying a canonical §42 code, so policy never
 * inspects adapter-specific error text or process exit codes.
 */
export interface TaskGraphPort {
  /** What this backend is and what it can do (ADR023 capability negotiation). */
  capabilities(): Promise<TaskGraphDescription>
  /**
   * Read one task.
   * @param id - task to read.
   * @throws never; a missing task is reported as a typed failure.
   */
  get(id: TaskId): Promise<Task>
  /**
   * Tasks that may start now, from the backend's own readiness query.
   * @param query - filters; absent means the whole workspace.
   */
  ready(query?: ReadyTaskQuery): Promise<readonly TaskRef[]>
  /**
   * Tasks that cannot start, with the ids they wait for.
   *
   * Separate from {@link TaskGraphPort.ready} because the backend computes it
   * that way; readiness is never inferred from a list field (ADR023).
   */
  blocked(query?: ReadyTaskQuery): Promise<readonly BlockedTaskRef[]>
  /**
   * Claim a task for one worker.
   * @param command - task, claimant, and the observation the claim is based on.
   */
  claim(command: ClaimTaskCommand): Promise<ClaimResult>
  /**
   * Move a task to another state.
   * @param command - task, target state, and the observation the move is based on.
   * @throws never; a stale revision or an illegal move is a typed failure.
   */
  transition(command: TaskTransitionCommand): Promise<Task>
  /**
   * Edges of one task, or of the whole graph when no id is given.
   * @param id - optional task to narrow to.
   */
  dependencies(id?: TaskId): Promise<readonly TaskDependency[]>
  /**
   * Apply a plan revision (ADR024).
   * @param command - the mutation, with the revision it was computed against.
   */
  mutatePlan(command: PlanMutationCommand): Promise<PlanMutationResult>
  /**
   * Read the mutation journal after a cursor (ADR023, §48).
   * @param cursor - where to resume; absent means re-baseline from the start.
   */
  events?(cursor?: JournalCursor): Promise<JournalReadResult>
  /**
   * Keep a held claim's lease alive.
   * @param id - task whose claim this worker holds.
   */
  heartbeat?(id: TaskId): Promise<void>
  /**
   * Revert claims whose lease has gone stale.
   * @param options - how stale a lease must be before it is reverted.
   */
  reclaim?(options?: { readonly olderThanMs?: number }): Promise<readonly TaskId[]>
  /**
   * Report the health of this binding, including any operator action.
   *
   * Returns findings instead of logging them: rendering and aggregation belong to
   * the Doctor surface, and the adapter's job is to establish the facts.
   */
  doctor(): Promise<readonly DiagnosticReport[]>
}

/** Identifier of the claimable work one adapter currently holds. */
export interface TaskGraphClaimRef {
  /** Task the claim is held on. */
  readonly id: TaskId
  /** Worker identity the backend recorded. */
  readonly claimant: string
  /** Attempt MyWork bound to this claim, when it has one. */
  readonly attemptId?: AttemptId
}
