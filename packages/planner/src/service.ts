/**
 * The Task Setter's staged plan mutation (architecture §9, §10; ADR024, ADR026).
 *
 * ADR024 applies where no single backend primitive covers a mutation: the intent
 * and an admission pause are made durable *before* the graph is touched, the parts
 * run through their own primitives, and the outcome is verified against the graph
 * before the queue resumes. This module is that operation, plus the two other
 * things §10 asks of the Task Setter — a classification of the replanning changes
 * and a path for what a worker may raise instead of rewriting the DAG.
 *
 * Two rules shape the implementation:
 *
 * - **Nothing is admitted while the journal is open.** The pause is a row, not a
 *   flag, so a killed controller comes back paused (§5.2), and the operation's own
 *   repair path is the only writer that may proceed while it stands.
 * - **Success is an observation, not a return value.** A part that "succeeded" is
 *   only marked as landed when the graph shows it, and the operation commits only
 *   after `verifyPlanIntegrity` has compared the whole intent with the graph.
 * @module
 */

import { randomUUID } from 'node:crypto'

import {
  AUDIT_SCHEMA,
  MAX_DECISION_REASON_LENGTH,
  MAX_PROPOSAL_DETAIL_LENGTH,
  WORK_PROPOSAL_KINDS,
  type BlockerResolutionAction,
  type BlockerResolutionDecision,
  type BlockerResolutionGate,
  type ClockPort,
  type IntegrityReport,
  type MyWorkErrorShape,
  type OperationMeta,
  type PlanDecision,
  type PlanMutationIntent,
  type PlanMutationOutcome,
  type PlanMutationPart,
  type PlanMutationStep,
  type PlanResumeOptions,
  type Result,
  type Revision,
  type StagedPlanMutation,
  type TaskDependency,
  type TaskGraphPort,
  type TaskId,
  type TaskState,
  type WorkProposalInput,
  type WorkProposalRecord,
  type WorkspaceId,
} from '@dsh-mywork/contracts'
import {
  deriveBlockerGates,
  fail,
  invertPlanSteps,
  materializePlanPart,
  MyWorkError,
  observeBlockerGates,
  ok,
  planMutationParts,
  planSteps,
  planTouchedTasks,
  resolvedEdgePair,
  type PlanInversion,
  validatePlanMutation,
  verifyPlanIntegrity,
} from '@dsh-mywork/core'
import { appendAuditEntry, putArtifact } from '@dsh-mywork/evidence'
import type { MyWorkStore, MyWorkTransaction } from '@dsh-mywork/storage'

import { PlanError } from './errors.ts'
import { PLAN_MUTATION_SCHEMA_NAME } from './schema.ts'
import {
  assertPlanSchema,
  claimMutation,
  commitPlanRevision,
  decideProposal,
  holdAdmission,
  insertGateDecision,
  insertProposal,
  insertStagedMutation,
  listPendingMutations,
  PLAN_MUTATION_HOLD_REASON,
  readGateDecisions,
  readMutation,
  readOpenHold,
  readPlanRevision,
  readProposal,
  recordMutationDecision,
  releaseAdmission,
  saveMutationCreated,
  saveMutationMode,
  saveMutationReport,
  updateMutationState,
  writeSteps,
  type AdmissionHold,
} from './store.ts'

/** What the planner needs to run. */
export interface PlannerDeps {
  /** Store opened with `MYWORK_MIGRATIONS`, `EVIDENCE_MIGRATIONS`, and the plan migration. */
  readonly store: MyWorkStore
  /**
   * Task graph this planner writes through. Resolved by the caller through the
   * adapter registry, so this layer never names a backend (§11, §44).
   */
  readonly graph: TaskGraphPort
  /** Time source; a fake clock keeps the staged journal deterministic in tests. */
  readonly clock: ClockPort
}

/** One gate decision, as an operator issues it. */
export interface BlockerGateRequest {
  /** Workspace the gate belongs to. */
  readonly workspaceId: WorkspaceId
  /** Frozen blocker the gate hangs on. */
  readonly blockerTaskId: TaskId
  /** What the operator decided. */
  readonly action: BlockerResolutionAction
  /** Reason; mandatory for `keep-blocking`. */
  readonly reason?: string
  /** Who decided and when. */
  readonly decision: PlanDecision
  /**
   * Operation identity of the decision. `void` and `supersede-dependent` run as
   * staged operations, so this id names one of them and must be fresh: reusing it
   * for a different decision would address the operation that already exists.
   */
  readonly meta: OperationMeta
}

/** The Task Setter's surface: one object, no backend names, no board. */
export interface Planner {
  /** Plan revision on record for a workspace; `0` before the first committed plan. */
  planRevision(workspaceId: WorkspaceId): number
  /** Whether admission is paused right now. */
  admissionHeld(workspaceId?: WorkspaceId): boolean
  /** The open admission pause, when there is one. */
  admissionHold(workspaceId?: WorkspaceId): AdmissionHold | undefined
  /** Operations that have not settled, oldest first. */
  pending(workspaceId?: WorkspaceId): readonly StagedPlanMutation[]
  /** Record the intent and pause admission; the graph is not touched. */
  stage(intent: PlanMutationIntent): Promise<Result<StagedPlanMutation>>
  /** Apply the parts of a staged operation and verify the outcome. */
  apply(operationId: string): Promise<Result<PlanMutationOutcome>>
  /** {@link Planner.stage} followed by {@link Planner.apply}. */
  submit(intent: PlanMutationIntent): Promise<Result<PlanMutationOutcome>>
  /** Finish a recovery: verify what is there, then apply the remainder. */
  resume(operationId: string, decision: PlanDecision, options?: PlanResumeOptions): Promise<Result<PlanMutationOutcome>>
  /** Undo the landed reversible steps of a staged operation (§5.2). */
  revert(operationId: string, decision: PlanDecision): Promise<Result<PlanMutationOutcome>>
  /** Intent against the graph, for the operator's banner (§5.2). */
  integrityReport(operationId: string): Promise<Result<IntegrityReport>>
  /** Worker path: record discovered work without touching the DAG (§10.4). */
  propose(input: WorkProposalInput): Result<WorkProposalRecord>
  /** Task Setter path: accept a proposal into a validated, staged mutation. */
  acceptProposal(
    proposalId: string,
    mutation: PlanMutationIntent,
    decision: PlanDecision,
  ): Promise<Result<PlanMutationOutcome>>
  /** Refuse a proposal, with a reason. */
  rejectProposal(proposalId: string, decision: PlanDecision): Result<WorkProposalRecord>
  /** Derived gates of a workspace; nothing about them is stored (§5.5). */
  gates(workspaceId: WorkspaceId): Promise<readonly BlockerResolutionGate[]>
  /** Decide a gate; `void` and `supersede-dependent` run through the staged path. */
  decideGate(request: BlockerGateRequest): Promise<Result<BlockerResolutionGate>>
}

/** States an operation may be resumed or reverted from. */
const UNSETTLED_STATES: readonly StagedPlanMutation['state'][] = Object.freeze(['staged', 'applying', 'recovery'])

/** One-line description of a thrown value, for the journal. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/**
 * Failure codes a caller may act on, as opposed to a half-applied operation.
 *
 * A moved revision, a cycle, a missing capability or an unreachable adapter all
 * happen *before* the graph is written, so they are reported as themselves and
 * the caller can retry with a different plan or adapter. `TASK_CONFLICT` is not
 * in this list on purpose: it can also arrive from the middle of a batch, where
 * the operation is already partially applied and the operator owns it.
 */
const PRE_WRITE_CODES: readonly string[] = Object.freeze([
  'STALE_REVISION',
  'ENTITY_CYCLE',
  'CAPABILITY_UNSUPPORTED',
  'ADAPTER_UNAVAILABLE',
  'CONTRACT_MISMATCH',
  'TASK_CONFLICT',
])

/** Codes a port raises from a guard, before it can have written anything. */
const GUARDED_CODES: readonly string[] = Object.freeze([
  'STALE_REVISION',
  'ENTITY_CYCLE',
  'CAPABILITY_UNSUPPORTED',
  'ADAPTER_UNAVAILABLE',
  'CONTRACT_MISMATCH',
])

/**
 * Whether a thrown value is a typed refusal the caller can act on, and its shape.
 *
 * The check reads `code` structurally instead of using `instanceof`: every
 * package in this workspace bundles its dependencies (`alwaysBundle`), so the
 * adapter that answers the task graph carries its **own** copy of the error class
 * and an `instanceof` test would never recognise it — the refusal would surface as
 * an opaque recovery instead of the code the architecture assigns it.
 * @param error - value thrown by a port or a store.
 * @returns the failure shape to answer with, or `undefined` when it is not a refusal.
 */
function refusalShape(error: unknown): MyWorkErrorShape | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { code, message, details } = error as {
    readonly code?: unknown
    readonly message?: unknown
    readonly details?: unknown
  }
  if (typeof code !== 'string' || !PRE_WRITE_CODES.includes(code)) return undefined
  return {
    code: code as MyWorkErrorShape['code'],
    message: typeof message === 'string' ? message : `dsh-mywork: the task graph refused with ${code}`,
    details:
      typeof details === 'object' && details !== null
        ? (details as Readonly<Record<string, unknown>>)
        : Object.freeze({ code }),
  }
}

/** Whether a thrown value carries one of the given codes, whoever built it. */
function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && (error as { readonly code?: unknown }).code === code
  )
}

/**
 * Created keys whose only evidence is an operator's adoption, where the mutation
 * would write an edge over them.
 *
 * An adopted id is an attestation, not an observation: nothing the port returns
 * proves the task was created by this mutation, so an attested id may settle a
 * create step but must not become a way around policy. An edge whose endpoint is
 * one of these keys would be written on a task the mutation cannot show it
 * created — the same write a planner mutation expressing it with a literal id is
 * refused for (§5.1). A composite call wires its intra-plan edges itself and has
 * no edges part at all, so the atomic path keeps its recovery.
 * @param intent - the mutation being resumed.
 * @param adopted - created keys accepted from `adoptedCreated` on this call.
 */
function adoptedEdgeKeys(intent: PlanMutationIntent, adopted: ReadonlySet<string>): readonly string[] {
  if (!planMutationParts(intent).some(part => part.kind === 'edges')) return []
  const created = new Set((intent.command.create ?? []).map(spec => spec.key))
  const hits = new Set<string>()
  const note = (endpoint: string): void => {
    if (created.has(endpoint) && adopted.has(endpoint)) hits.add(endpoint)
  }
  for (const edge of [...(intent.command.addDependencies ?? []), ...(intent.command.removeDependencies ?? [])]) {
    note(edge.from)
    note(edge.to)
  }
  for (const spec of intent.command.create ?? []) {
    if ((spec.dependsOnKeys ?? []).length === 0) continue
    note(spec.key)
    for (const key of spec.dependsOnKeys ?? []) note(key)
  }
  return Object.freeze([...hits].sort())
}

/**
 * Canonical JSON of a mutation, for deciding whether a re-used operation id names
 * the same intent.
 *
 * Key order is not part of a mutation, so the comparison sorts it: two callers
 * that describe the same operation must not be told they disagree.
 */
function canonicalIntent(intent: PlanMutationIntent): string {
  // The tracing id is not part of what the mutation asks for: a retry of the same work
  // carries a new one and is still a repeat, not a second mutation.
  const { correlationId, ...meta } = intent.command.meta
  void correlationId
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      // Two callers may list the same edges in another order: that is the same ask.
      return value
        .map(walk)
        .sort((left, right) => (JSON.stringify(left) < JSON.stringify(right) ? -1 : 1))
    }
    if (typeof value === 'object' && value !== null) {
      const source = value as Readonly<Record<string, unknown>>
      return Object.fromEntries(Object.keys(source).sort().map(key => [key, walk(source[key])]))
    }
    return value
  }
  return JSON.stringify(walk({ ...intent, command: { ...intent.command, meta } }))
}

/**
 * Build the planner over one store and one task graph.
 * @param deps - store, task graph, and clock.
 * @throws {PlanError} `schema-missing` when the store lacks a schema this layer writes through.
 */
export function createPlanner(deps: PlannerDeps): Planner {
  assertPlanSchema(deps.store)
  const { store, graph } = deps
  const now = (): number => deps.clock.now()

  /** Identity of the admission pause one operation took. */
  function holdIdOf(operationId: string): string {
    return `hold-${operationId}`
  }

  /** Read the states of some tasks; a task the graph does not hold is simply absent. */
  async function readStates(ids: readonly TaskId[]): Promise<Record<TaskId, TaskState>> {
    const states: Record<TaskId, TaskState> = {}
    for (const id of ids) {
      try {
        const task = await graph.get(id)
        states[id] = task.state
      } catch (error) {
        // The validator decides what an absent task means — but only an absence may
        // reach it. A port that cannot be read is a typed refusal, and swallowing it
        // would report a running task as absent and let §10.3's guard pass on a guess.
        const refusal = refusalShape(error)
        if (refusal === undefined || refusal.code !== 'TASK_CONFLICT') throw error
      }
    }
    return states
  }

  /** Observation the policy reviews one intent against. */
  async function observe(intent: PlanMutationIntent): Promise<{
    planRevision: Revision
    states: Record<TaskId, TaskState>
    edges: readonly TaskDependency[]
  }> {
    const planRevision = store.transaction(tx => readPlanRevision(tx, intent.workspaceId))
    const edges = await graph.dependencies()
    // A key this mutation creates is not a task yet, and the port answers for it with
    // whatever it uses for "no such task" — which on the real adapter is also the code
    // it uses for an unreachable backend, so reading it strictly would refuse a legal
    // mutation. Keys are read leniently: one that *does* name an existing task is the
    // shadowing case the validator refuses, and every other touched task is strict.
    const creates = intent.command.create ?? []
    const keys = new Set(creates.map(spec => spec.key))
    const states = await readStates(planTouchedTasks(intent).filter(id => !keys.has(id)))
    for (const spec of creates) {
      if (states[spec.key] !== undefined) continue
      try {
        states[spec.key] = (await graph.get(spec.key)).state
      } catch {
        // Absent, which is what a create key should be; the validator decides the rest.
      }
    }
    return { planRevision, states, edges }
  }

  /** Values a revert would restore, read before the change. */
  async function snapshots(intent: PlanMutationIntent): Promise<Record<TaskId, { title?: string; priority?: number }>> {
    const byTask: Record<TaskId, { title?: string; priority?: number }> = {}
    for (const spec of intent.command.update ?? []) {
      try {
        const task = await graph.get(spec.id)
        byTask[spec.id] = {
          title: task.title,
          ...(task.priority === undefined ? {} : { priority: task.priority }),
        }
      } catch {
        // Unreadable task: the step keeps no previous value, so a revert refuses
        // instead of restoring a value nobody observed.
      }
    }
    return byTask
  }

  /** Assert that an operation exists. */
  function requireMutation(operationId: string): StagedPlanMutation {
    const record = store.transaction(tx => readMutation(tx, operationId))
    if (record === undefined) {
      throw new PlanError('not-found', `dsh-mywork: no plan mutation "${operationId}"`, { details: { operationId } })
    }
    return record
  }

  /** Write the evidence, the audit row, and the outbox event of one settled state. */
  function recordSettlement(
    tx: MyWorkTransaction,
    record: StagedPlanMutation,
    type: 'plan.mutation.applied' | 'plan.mutation.recovered',
    report: IntegrityReport,
    detail: Readonly<Record<string, unknown>>,
    decision?: PlanDecision,
  ): void {
    // Identity carries the verification reading and a unique suffix, so every
    // settlement attempt keeps its own immutable evidence: a first recovery and
    // the resume that finishes the plan are two different facts, and neither may
    // overwrite the other (§32, §34).
    const stamp = `${report.checkedAt}-${randomUUID().slice(0, 8)}`
    const artifactId = `plan-${record.operationId}-report-${stamp}`
    putArtifact(
      tx,
      {
        artifactId,
        kind: 'planner-dag',
        workspaceId: record.workspaceId,
        correlationId: record.correlationId,
        contentType: 'application/json',
        bytes: new TextEncoder().encode(JSON.stringify({ report, decision: decision ?? null, detail })),
      },
      now(),
    )
    appendAuditEntry(tx, {
      schema: AUDIT_SCHEMA,
      auditId: `plan-${record.operationId}-${type}-${stamp}`,
      type,
      workspaceId: record.workspaceId,
      correlationId: record.correlationId,
      occurredAt: now(),
      artifactId,
    })
    tx.outbox.append({
      event: { type, payload: { operationId: record.operationId, verified: report.verified, ...detail } },
      workspaceId: record.workspaceId,
      correlationId: record.correlationId,
    })
  }

  /** Move an operation into recovery, keeping the pause and recording the evidence. */
  function enterRecovery(
    tx: MyWorkTransaction,
    record: StagedPlanMutation,
    failure: string,
    report: IntegrityReport | undefined,
    decision?: PlanDecision,
  ): void {
    updateMutationState(tx, record.operationId, 'recovery', now(), failure)
    saveMutationCreated(tx, record.operationId, record.created)
    writeSteps(tx, record.operationId, record.steps)
    const settled: IntegrityReport =
      report ??
      Object.freeze({
        operationId: record.operationId,
        workspaceId: record.workspaceId,
        baseRevision: record.baseRevision,
        observedRevision: record.baseRevision,
        missing: Object.freeze([]),
        pendingRemovals: Object.freeze([]),
        unexpected: Object.freeze([]),
        stateMismatches: Object.freeze([]),
        created: record.created,
        unresolvedCreates: Object.freeze([]),
        verified: false,
        checkedAt: now(),
      })
    saveMutationReport(tx, record.operationId, settled)
    if (decision !== undefined) recordMutationDecision(tx, record.operationId, decision)
    recordSettlement(tx, record, 'plan.mutation.recovered', settled, { failure }, decision)
  }

  /**
   * Mark every edge step from what the graph now holds.
   *
   * A step's reference may name tasks by key — the ids did not exist when the
   * journal was written — so it is resolved through the created ids first.
   * Without that, a step for an edge that *did* land would be journalled as
   * failed, and the operator would be told the opposite of the truth.
   */
  function markEdgeSteps(
    steps: readonly PlanMutationStep[],
    observedEdges: readonly TaskDependency[],
    created: Readonly<Record<string, TaskId>>,
  ): readonly PlanMutationStep[] {
    const present = new Set(observedEdges.map(entry => `${entry.from}\u0000${entry.to}`))
    return steps.map(step => {
      if (step.part !== 'edges') return step
      const expected = resolvedEdgePair(step.ref, created) ?? step.ref
      const landed = step.kind === 'add-edge' ? present.has(expected) : !present.has(expected)
      return { ...step, state: (landed ? 'applied' : 'failed') as 'applied' | 'failed' }
    })
  }

  /**
   * Mark the intra-plan edge steps a composite create wired itself.
   *
   * A composite call creates the tasks *and* their intra-plan edges in one unit, so
   * those edge steps have no part of their own to be marked in: they are marked
   * from the graph, and only for a create that actually carries keys.
   */
  async function markCompositeEdges(
    current: StagedPlanMutation,
    creates: readonly { readonly dependsOnKeys?: readonly string[] }[],
  ): Promise<StagedPlanMutation> {
    if (!creates.some(spec => (spec.dependsOnKeys ?? []).length > 0)) return current
    return Object.freeze({
      ...current,
      steps: markEdgeSteps(current.steps, await graph.dependencies(), current.created),
      updatedAt: now(),
    })
  }

  /**
   * Mark every retirement step from the state the graph now holds.
   *
   * A retirement cannot be read from the journal alone: the transition can land and
   * the answer be lost before the step is written. The state table is what says
   * whether it did, so a step this read cannot settle stays `pending` and blocks a
   * revert as unknown rather than being skipped silently.
   */
  async function markRetireSteps(
    steps: readonly PlanMutationStep[],
    intent: PlanMutationIntent,
  ): Promise<readonly PlanMutationStep[]> {
    const retirements = intent.retire ?? []
    if (retirements.length === 0) return steps
    const states = await readStates(retirements.map(retirement => retirement.taskId))
    return steps.map(step => {
      if (step.part !== 'retire' || step.state === 'applied') return step
      const retirement = retirements.find(candidate => candidate.taskId === step.ref)
      if (retirement === undefined) return step
      const landed = states[retirement.taskId] === retirement.to
      return { ...step, state: (landed ? 'applied' : 'failed') as 'applied' | 'failed' }
    })
  }

  /** Apply the parts of one operation, marking steps from what the graph shows. */
  async function runParts(
    record: StagedPlanMutation,
  ): Promise<{ record: StagedPlanMutation; mode: 'atomic' | 'staged' }> {
    const intent = record.intent
    let working: StagedPlanMutation = record
    // `atomic` is downgraded the moment any primitive answers with a staged apply,
    // so the outcome never claims more atomicity than the backend gave (ADR024).
    let mode: 'atomic' | 'staged' = 'atomic'

    for (const part of planMutationParts(intent)) {
      const pending = working.steps.filter(step => step.part === part.kind && step.state !== 'applied')
      if (part.kind === 'create') {
        if (pending.length === 0) continue
        // The part is sent exactly as `planMutationParts` built it: a composite
        // call keeps the intra-plan keys the backend wires itself, while a staged
        // create carries a findable reference and no keys.
        const command = part.command ?? { baseRevision: working.baseRevision, meta: intent.command.meta }
        const missing = (command.create ?? []).filter(spec => working.created[spec.key] === undefined)
        if (missing.length === 0) {
          // Nothing left to create: every key already has an id — an earlier attempt
          // journalled it, or the operator adopted it. The steps are recorded as
          // landed, so a committed operation never claims its creations are pending,
          // and a composite create still owes its intra-plan edge steps a marking.
          const marked = working.steps.map(step =>
            step.part === 'create'
            && step.state !== 'applied'
            && working.created[step.ref.replace(/^key:/, '')] !== undefined
              ? { ...step, state: 'applied' as const }
              : step,
          )
          if (marked.some((step, index) => step !== working.steps[index])) {
            working = Object.freeze({ ...working, steps: marked, updatedAt: now() })
            store.transaction(tx => writeSteps(tx, working.operationId, working.steps))
          }
          const withEdges = await markCompositeEdges(working, command.create ?? [])
          if (withEdges !== working) {
            working = withEdges
            store.transaction(tx => writeSteps(tx, working.operationId, working.steps))
          }
          continue
        }
        const composite = missing.some(spec => (spec.dependsOnKeys ?? []).length > 0)
        const result = await graph.mutatePlan({ ...command, create: missing })
        if (result.mode !== 'atomic') mode = 'staged'
        const created = { ...working.created, ...result.created }
        const steps: readonly PlanMutationStep[] = working.steps.map(step =>
          step.part !== 'create'
            ? step
            : {
                ...step,
                state: (created[step.ref.replace(/^key:/, '')] === undefined ? 'failed' : 'applied') as
                  | 'applied'
                  | 'failed',
              },
        )
        working = Object.freeze({ ...working, created, steps, updatedAt: now() })
        // The ids become durable *before* anything else is read. A failing read must
        // not be able to lose them: an id nobody journalled is the one state only an
        // operator can resolve, so it is never left to a second network call.
        store.transaction(tx => {
          saveMutationCreated(tx, working.operationId, working.created)
          writeSteps(tx, working.operationId, working.steps)
        })
        if (composite) {
          // A composite create wires its intra-plan edges itself, so those steps are
          // marked from the graph — after the ids are safe.
          working = await markCompositeEdges(working, missing)
          store.transaction(tx => writeSteps(tx, working.operationId, working.steps))
        }
        continue
      }
      if (part.kind === 'edges') {
        // Whether this part has work is decided by the command it materialises to,
        // not by the journal: an edge between two tasks this mutation creates has
        // no id to journal before those tasks exist, so a step-only check would
        // skip the part that wires exactly those edges.
        const materialized = materializePlanPart(part, intent, working.created)
        const materializedCommand =
          materialized.command ?? { baseRevision: working.baseRevision, meta: intent.command.meta }
        const hasWork =
          (materializedCommand.addDependencies ?? []).length > 0
          || (materializedCommand.removeDependencies ?? []).length > 0
        if (!hasWork) continue
        const result = await graph.mutatePlan(materializedCommand)
        if (result.mode !== 'atomic') mode = 'staged'
        const steps = markEdgeSteps(working.steps, await graph.dependencies(), working.created)
        working = Object.freeze({ ...working, steps, updatedAt: now() })
        store.transaction(tx => writeSteps(tx, working.operationId, working.steps))
        continue
      }
      if (part.kind === 'fields') {
        if (pending.length === 0) continue
        const updates = pending
          .map(step => (intent.command.update ?? []).find(spec => spec.id === step.ref))
          .filter((spec): spec is NonNullable<typeof spec> => spec !== undefined)
        const result = await graph.mutatePlan({
          baseRevision: working.baseRevision,
          update: updates,
          meta: intent.command.meta,
        })
        if (result.mode !== 'atomic') mode = 'staged'
        // `TaskGraphPort` exposes no metadata read, so a field step is marked from
        // the backend's own answer; such a step is journalled as irreversible.
        const steps = working.steps.map(step =>
          step.part === 'fields' ? { ...step, state: 'applied' as const } : step,
        )
        working = Object.freeze({ ...working, steps, updatedAt: now() })
        store.transaction(tx => writeSteps(tx, working.operationId, working.steps))
        continue
      }
      // The retire part moves tasks through `transition`: the graph owns states,
      // and a retirement hidden in a field update would be invisible to the check.
      for (const step of pending) {
        const retirement = (intent.retire ?? []).find(candidate => candidate.taskId === step.ref)
        if (retirement === undefined) continue
        const current = await readStates([retirement.taskId])
        if (current[retirement.taskId] === retirement.to) {
          // The transition landed before the journal did: moving it again would be
          // an illegal no-op transition on a port that checks the table.
          working = Object.freeze({
            ...working,
            steps: working.steps.map(candidate =>
              candidate.seq === step.seq ? { ...candidate, state: 'applied' as const } : candidate,
            ),
            updatedAt: now(),
          })
          continue
        }
        await graph.transition({ id: retirement.taskId, to: retirement.to, meta: intent.command.meta })
        const states = await readStates([retirement.taskId])
        const landed = states[retirement.taskId] === retirement.to
        working = Object.freeze({
          ...working,
          steps: working.steps.map(candidate =>
            candidate.seq === step.seq
              ? { ...candidate, state: (landed ? 'applied' : 'failed') as 'applied' | 'failed' }
              : candidate,
          ),
          updatedAt: now(),
        })
      }
      store.transaction(tx => writeSteps(tx, working.operationId, working.steps))
    }
    return { record: working, mode }
  }

  /** Verify an intent against the graph as it stands now. */
  async function verify(record: StagedPlanMutation, created = record.created): Promise<IntegrityReport> {
    const observedEdges = await graph.dependencies()
    const retiredIds = (record.intent.retire ?? []).map(retirement => retirement.taskId)
    const observedStates = await readStates(retiredIds)
    const observedRevision = store.transaction(tx => readPlanRevision(tx, record.workspaceId))
    return verifyPlanIntegrity({
      operationId: record.operationId,
      intent: record.intent,
      baseRevision: record.baseRevision,
      observedRevision,
      created,
      observedEdges,
      observedStates,
      checkedAt: now(),
    })
  }

  /** Verify that the inverse of a staged operation landed, i.e. the graph is back. */
  async function verifyInverse(record: StagedPlanMutation, parts: readonly PlanMutationPart[]): Promise<IntegrityReport> {
    const added: TaskDependency[] = []
    const removed: TaskDependency[] = []
    for (const part of parts) {
      added.push(...(part.command?.addDependencies ?? []))
      removed.push(...(part.command?.removeDependencies ?? []))
    }
    const observedEdges = await graph.dependencies()
    const observedRevision = store.transaction(tx => readPlanRevision(tx, record.workspaceId))
    return verifyPlanIntegrity({
      operationId: record.operationId,
      intent: {
        workspaceId: record.workspaceId,
        origin: 'replan',
        command: {
          baseRevision: record.baseRevision,
          ...(added.length === 0 ? {} : { addDependencies: added }),
          ...(removed.length === 0 ? {} : { removeDependencies: removed }),
          meta: record.intent.command.meta,
        },
      },
      baseRevision: record.baseRevision,
      observedRevision,
      created: {},
      observedEdges,
      observedStates: {},
      checkedAt: now(),
    })
  }

  /** Commit a verified operation: state, plan revision, pause, evidence, event. */
  function commit(record: StagedPlanMutation, report: IntegrityReport, mode: string, decision?: PlanDecision): void {
    store.transaction(tx => {
      updateMutationState(tx, record.operationId, 'applied', now(), undefined)
      if (mode === 'atomic' || mode === 'staged') saveMutationMode(tx, record.operationId, mode)
      saveMutationCreated(tx, record.operationId, record.created)
      writeSteps(tx, record.operationId, record.steps)
      saveMutationReport(tx, record.operationId, report)
      if (decision !== undefined) recordMutationDecision(tx, record.operationId, decision)
      commitPlanRevision(tx, record.workspaceId, record.baseRevision, now())
      releaseAdmission(tx, holdIdOf(record.operationId), now(), decision?.decidedBy ?? 'plan-mutation')
      recordSettlement(tx, record, 'plan.mutation.applied', report, { mode }, decision)
      tx.outbox.append({
        event: {
          type: 'admission.resumed',
          payload: { operationId: record.operationId, mode },
        },
        workspaceId: record.workspaceId,
        correlationId: record.correlationId,
      })
    })
  }

  /**
   * Outcome of an operation that already committed.
   *
   * A repeated `submit`/`apply` must not re-create anything (ADR024), so a settled
   * operation answers with the outcome it recorded rather than running again.
   */
  async function replay(record: StagedPlanMutation): Promise<PlanMutationOutcome> {
    const integrity = record.report ?? (await verify(record))
    return Object.freeze({
      mode: record.mode ?? 'staged',
      operationId: record.operationId,
      state: record.state,
      created: record.created,
      addedDependencies: Object.freeze([...(record.intent.command.addDependencies ?? [])]),
      removedDependencies: Object.freeze([...(record.intent.command.removeDependencies ?? [])]),
      integrity,
    })
  }

  /**
   * Run one already-staged operation to completion or into recovery.
   *
   * Every entry point — `apply`, `submit`, `resume` — goes through here, so the
   * guard against continuing a damaged operation cannot be bypassed by choosing a
   * different method: a create whose id was never journalled is indistinguishable
   * from a create that never ran, and re-running it duplicates the task.
   */
  async function run(record: StagedPlanMutation, decision?: PlanDecision): Promise<Result<PlanMutationOutcome>> {
    const meta = record.intent.command.meta
    if (record.state === 'applied') return ok(await replay(record), meta)
    if (!UNSETTLED_STATES.includes(record.state)) {
      // `apply`, `resume`, and `revert` already refuse a settled operation; `submit`
      // reaches `run` through `stage`, so the same answer belongs here — running a
      // reverted operation again would apply it while nothing can undo it.
      return fail(
        new MyWorkError('TASK_CONFLICT', `dsh-mywork: a plan mutation in state "${record.state}" has nothing to run`, {
          details: { operationId: record.operationId, state: record.state, reason: 'operation-settled' },
        }),
        meta,
      )
    }
    const fresh = record.state === 'staged'
    // One observation decides everything the pre-flight needs: the revision may
    // not have moved, the graph may not hold anything the intent does not explain,
    // and — once an attempt has happened — every created task must be resolved.
    let before: IntegrityReport
    try {
      before = await verify(record)
    } catch (error) {
      // A graph that cannot be read is a typed refusal, like every other port
      // answer: a method that promises a Result must not throw one.
      const refusal = refusalShape(error)
      if (refusal !== undefined) return fail(refusal, meta)
      throw error
    }
    const movedRevision = before.observedRevision !== record.baseRevision
    const damaged =
      before.unexpected.length > 0
      || before.cycle !== undefined
      || (!fresh && before.unresolvedCreates.length > 0)
    if (movedRevision || damaged) {
      const failure = movedRevision ? 'plan-revision-moved' : 'graph-does-not-match-intent'
      store.transaction(tx => enterRecovery(tx, record, failure, before, decision))
      if (movedRevision) {
        return fail(
          new MyWorkError(
            'STALE_REVISION',
            'dsh-mywork: the plan revision moved before this staged operation was applied; nothing was written',
            {
              details: {
                operationId: record.operationId,
                expectedRevision: record.baseRevision,
                actualRevision: before.observedRevision,
              },
            },
          ),
          meta,
        )
      }
      return fail(
        new MyWorkError(
          'PLAN_MUTATION_RECOVERY',
          'dsh-mywork: the graph does not match the intent, so continuing would guess; an operator must decide',
          { details: { operationId: record.operationId, report: before, unresolvedCreates: before.unresolvedCreates } },
        ),
        meta,
      )
    }
    // Claim the operation before anything is written. The claim is a compare-and-set
    // on the state the row was read in, so exactly one of two overlapping callers
    // moves it to `applying`; the loser is told the operation is already running
    // instead of walking the same journal into the graph a second time.
    const claimed = store.transaction(tx => claimMutation(tx, record.operationId, record.state, now()))
    if (!claimed) {
      return fail(
        new MyWorkError('TASK_CONFLICT', 'dsh-mywork: the plan mutation is already being applied', {
          details: { operationId: record.operationId, state: record.state, reason: 'operation-already-claimed' },
        }),
        meta,
      )
    }
    let working: StagedPlanMutation = Object.freeze({ ...record, state: 'applying' as const })
    let mode: 'atomic' | 'staged' = 'staged'
    try {
      const produced = await runParts(working)
      working = produced.record
      mode = produced.mode
    } catch (error) {
      const failure = describe(error)
      // The journal is the record of what landed, and a part that threw may have
      // updated it already: recovery reports the state on disk, not the state the
      // failed call happened to hold in memory.
      const observed = store.transaction(tx => readMutation(tx, working.operationId))
      if (observed !== undefined) working = observed
      store.transaction(tx => enterRecovery(tx, working, failure, undefined, decision))
      // A refusal that provably happened before anything was written is reported as
      // itself, so the caller learns what to change. A refusal from the middle of a
      // staged operation — or one on a mutation that creates tasks, whose creation
      // may have landed without an id reaching the journal — stays `PLAN_MUTATION_RECOVERY`,
      // because calling it "nothing happened" would be a claim nobody can support.
      const refusal = refusalShape(error)
      if (refusal !== undefined) {
        const nothingLanded =
          working.created === undefined
          || (Object.keys(working.created).length === 0
            && !working.steps.some(step => step.state === 'applied'))
        const createsTasks = (working.intent.command.create ?? []).length > 0
        if (GUARDED_CODES.includes(refusal.code) || (nothingLanded && !createsTasks)) {
          return fail(refusal, meta)
        }
      }
      return fail(
        new MyWorkError(
          'PLAN_MUTATION_RECOVERY',
          `dsh-mywork: the staged plan mutation failed (${failure}); the plan needs an operator`,
          { details: { operationId: working.operationId, failure, state: 'recovery' } },
        ),
        meta,
      )
    }
    let report: IntegrityReport
    try {
      report = await verify(working)
    } catch (error) {
      const refusal = refusalShape(error)
      if (refusal === undefined) throw error
      store.transaction(tx => enterRecovery(tx, working, describe(error), undefined, decision))
      return fail(refusal, meta)
    }
    if (!report.verified) {
      store.transaction(tx => enterRecovery(tx, working, 'integrity-verification-failed', report, decision))
      return fail(
        new MyWorkError(
          'PLAN_MUTATION_RECOVERY',
          'dsh-mywork: integrity verification did not confirm the plan; admission stays paused and an operator decides',
          { details: { operationId: working.operationId, report } },
        ),
        meta,
      )
    }
    try {
      commit(working, report, mode, decision)
    } catch (error) {
      if (hasCode(error, 'stale-revision')) {
        store.transaction(tx => enterRecovery(tx, working, 'plan-revision-moved', report, decision))
        return fail(
          new MyWorkError(
            'STALE_REVISION',
            'dsh-mywork: another plan revision was committed while this one was staged',
            { details: { operationId: working.operationId, expectedRevision: working.baseRevision } },
          ),
          meta,
        )
      }
      throw error
    }
    return ok(
      Object.freeze({
        mode,
        operationId: working.operationId,
        state: 'applied' as const,
        created: working.created,
        addedDependencies: Object.freeze([...(working.intent.command.addDependencies ?? [])]),
        removedDependencies: Object.freeze([...(working.intent.command.removeDependencies ?? [])]),
        integrity: report,
      }),
      meta,
    )
  }
  // The commit above recorded the mode, so a replay answers with the same one.

  /** Validate a decision a caller supplied. */
  function requireDecision(decision: PlanDecision, what: string): void {
    if (typeof decision !== 'object' || decision === null) {
      throw new TypeError(`dsh-mywork: ${what} needs a decision object`)
    }
    if (typeof decision.decidedBy !== 'string' || decision.decidedBy.trim().length === 0) {
      throw new TypeError(`dsh-mywork: ${what} needs a deciding actor`)
    }
    if (!Number.isSafeInteger(decision.at) || decision.at < 0) {
      // Without this the value would reach a SQLite binding and surface as a
      // storage error instead of a refusal naming the field.
      throw new TypeError(`dsh-mywork: ${what} needs a clock reading in "at", received ${String(decision.at)}`)
    }
    if (decision.reason !== undefined && decision.reason.length > MAX_DECISION_REASON_LENGTH) {
      throw new TypeError(`dsh-mywork: ${what} reason exceeds ${MAX_DECISION_REASON_LENGTH} characters`)
    }
  }

  /** Read the graph, derive the gates, and fold the stored decisions into them. */
  async function gatesOf(workspaceId: WorkspaceId): Promise<readonly BlockerResolutionGate[]> {
    const edges = await graph.dependencies()
    const ids = new Set<TaskId>()
    for (const edge of edges) {
      ids.add(edge.from)
      ids.add(edge.to)
    }
    const states = await readStates([...ids])
    const observations = observeBlockerGates(edges, states, workspaceId)
    const decisions = store.transaction(tx => readGateDecisions(tx, workspaceId))
    return deriveBlockerGates(observations, decisions)
  }

  /** Record one gate decision with its evidence, its audit row, and its event. */
  function settleGate(
    record: BlockerResolutionDecision,
    payload: Readonly<Record<string, unknown>>,
    meta: OperationMeta,
  ): void {
    store.transaction(tx => {
      putArtifact(
        tx,
        {
          artifactId: record.artifactId ?? `gate-decision-${record.decisionId}`,
          kind: 'gate-decision',
          workspaceId: record.workspaceId,
          correlationId: meta.correlationId,
          contentType: 'application/json',
          bytes: new TextEncoder().encode(JSON.stringify(payload)),
        },
        now(),
      )
      insertGateDecision(tx, record)
      appendAuditEntry(tx, {
        schema: AUDIT_SCHEMA,
        auditId: `audit-${record.decisionId}`,
        type: 'gate.decided',
        workspaceId: record.workspaceId,
        correlationId: meta.correlationId,
        occurredAt: record.decidedAt,
        taskId: record.blockerTaskId,
        ...(record.artifactId === undefined ? {} : { artifactId: record.artifactId }),
      })
      tx.outbox.append({
        event: {
          type: 'gate.decided',
          payload: {
            gateId: `${record.workspaceId}:${record.blockerTaskId}`,
            action: record.action,
            dependents: [...record.dependents],
            operationId: record.operationId ?? null,
            reason: record.reason ?? null,
          },
        },
        workspaceId: record.workspaceId,
        correlationId: meta.correlationId,
      })
    })
  }

  const planner: Planner = {
    planRevision(workspaceId: WorkspaceId): number {
      return store.transaction(tx => readPlanRevision(tx, workspaceId))
    },
    admissionHeld(workspaceId?: WorkspaceId): boolean {
      return store.transaction(tx => readOpenHold(tx, workspaceId)) !== undefined
    },
    admissionHold(workspaceId?: WorkspaceId): AdmissionHold | undefined {
      return store.transaction(tx => readOpenHold(tx, workspaceId))
    },
    pending(workspaceId?: WorkspaceId): readonly StagedPlanMutation[] {
      return store.transaction(tx => listPendingMutations(tx, workspaceId))
    },

    async stage(intent: PlanMutationIntent): Promise<Result<StagedPlanMutation>> {
      const meta = intent.command.meta
      const existing = store.transaction(tx => readMutation(tx, meta.operationId))
      if (existing !== undefined) {
        // Re-staging the same operation is a no-op: one journal entry, one pause,
        // one intent — which is exactly what ADR024's "repeat does not duplicate"
        // requires of the whole path.
        if (existing.workspaceId !== intent.workspaceId) {
          return fail(
            new MyWorkError('TASK_CONFLICT', 'dsh-mywork: the operation id is already used by another workspace', {
              details: { operationId: meta.operationId, workspaceId: existing.workspaceId },
            }),
            meta,
          )
        }
        if (canonicalIntent(existing.intent) !== canonicalIntent(intent)) {
          // The id names an operation, not a slot: answering a different mutation with
          // the first operation's outcome would report work that was never asked for.
          return fail(
            new MyWorkError('TASK_CONFLICT', 'dsh-mywork: the operation id is already used by another mutation', {
              details: { operationId: meta.operationId, reason: 'operation-id-reused' },
            }),
            meta,
          )
        }
        return ok(existing, meta)
      }
      let observed: Awaited<ReturnType<typeof observe>>
      try {
        observed = await observe(intent)
      } catch (error) {
        // Reading the graph is part of the operation: an adapter that refuses is a
        // typed answer, not a raw exception escaping a method that promises a Result.
        const refusal = refusalShape(error)
        if (refusal !== undefined) return fail(refusal, meta)
        throw error
      }
      const validated = validatePlanMutation(intent, {
        planRevision: observed.planRevision,
        states: observed.states,
        edges: observed.edges,
      })
      if (!validated.ok) return fail(validated.error, meta)

      const steps = planSteps(intent, await snapshots(intent))
      const at = now()
      const record: StagedPlanMutation = Object.freeze({
        operationId: meta.operationId,
        workspaceId: intent.workspaceId,
        correlationId: meta.correlationId,
        baseRevision: intent.command.baseRevision,
        origin: intent.origin,
        ...(intent.runningTaskPolicy === undefined ? {} : { runningTaskPolicy: intent.runningTaskPolicy }),
        state: 'staged' as const,
        intent,
        steps,
        created: Object.freeze({}),
        stagedAt: at,
        updatedAt: at,
      })
      try {
        store.transaction(tx => {
          const open = readOpenHold(tx, intent.workspaceId)
          if (open !== undefined && open.operationId !== meta.operationId) {
            throw new PlanError('conflict', 'dsh-mywork: admission is already paused for another staged plan mutation', {
              details: { workspaceId: intent.workspaceId, operationId: open.operationId },
            })
          }
          insertStagedMutation(tx, record)
          writeSteps(tx, record.operationId, steps)
          if (open === undefined) {
            holdAdmission(tx, {
              holdId: holdIdOf(meta.operationId),
              workspaceId: intent.workspaceId,
              operationId: meta.operationId,
              reason: PLAN_MUTATION_HOLD_REASON,
              heldAt: at,
            })
            // ADR024 names both facts, and the queue is genuinely paused here: the
            // events go into the same commit as the journal row and the hold.
            tx.outbox.append({
              event: { type: 'plan.mutation.staged', payload: { operationId: meta.operationId, baseRevision: record.baseRevision } },
              workspaceId: intent.workspaceId,
              correlationId: meta.correlationId,
            })
            tx.outbox.append({
              event: {
                type: 'admission.paused',
                payload: { operationId: meta.operationId, reason: PLAN_MUTATION_HOLD_REASON },
              },
              workspaceId: intent.workspaceId,
              correlationId: meta.correlationId,
            })
          }
        })
      } catch (error) {
        if (hasCode(error, 'conflict')) {
          const conflict = error as { readonly message?: unknown; readonly details?: unknown }
          return fail(
            new MyWorkError(
              'TASK_CONFLICT',
              typeof conflict.message === 'string' ? conflict.message : 'dsh-mywork: admission is already paused',
              {
                details:
                  typeof conflict.details === 'object' && conflict.details !== null
                    ? (conflict.details as Readonly<Record<string, unknown>>)
                    : {},
              },
            ),
            meta,
          )
        }
        // Two callers can stage the same operation at once: the read above saw no row,
        // and the insert that follows loses to the other one. A unique-key violation is
        // that race, so it is answered like the duplicate it is instead of escaping as a
        // raw SQLite error from a method that promises a Result.
        const code = (error as { readonly code?: unknown }).code
        const message = error instanceof Error ? error.message : ''
        if (
          (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT'))
          || message.includes('UNIQUE constraint failed')
        ) {
          return fail(
            new MyWorkError('TASK_CONFLICT', 'dsh-mywork: the operation was staged by another caller', {
              details: { operationId: meta.operationId, reason: 'operation-already-staged' },
            }),
            meta,
          )
        }
        throw error
      }
      return ok(record, meta)
    },

    async apply(operationId: string): Promise<Result<PlanMutationOutcome>> {
      const record = requireMutation(operationId)
      const meta = record.intent.command.meta
      if (record.state === 'applied') return ok(await replay(record), meta)
      if (!UNSETTLED_STATES.includes(record.state)) {
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: the plan mutation is already "${record.state}"`, {
            details: { operationId, state: record.state, reason: 'operation-not-applicable' },
          }),
          meta,
        )
      }
      return run(record)
    },

    async submit(intent: PlanMutationIntent): Promise<Result<PlanMutationOutcome>> {
      const staged = await planner.stage(intent)
      if (!staged.ok) return fail(staged.error, staged.meta)
      return run(staged.value)
    },

    async resume(
      operationId: string,
      decision: PlanDecision,
      options?: PlanResumeOptions,
    ): Promise<Result<PlanMutationOutcome>> {
      requireDecision(decision, 'a resume')
      const record = requireMutation(operationId)
      const meta = record.intent.command.meta
      if (!UNSETTLED_STATES.includes(record.state)) {
        return fail(
          new MyWorkError(
            'TASK_CONFLICT',
            `dsh-mywork: a plan mutation in state "${record.state}" has nothing to resume`,
            { details: { operationId, state: record.state, reason: 'nothing-to-resume' } },
          ),
          meta,
        )
      }
      let working = record
      if (options?.adoptedCreated !== undefined) {
        // An adopted id is an operator's attestation, not an observation: the port
        // exposes no external reference to compare against, so what can be checked
        // is existence — and what must be recorded is that the id was adopted
        // rather than read back from the backend.
        const keys = new Set((record.intent.command.create ?? []).map(spec => spec.key))
        const accepted: Record<string, TaskId> = {}
        const rejected: Record<string, string> = {}
        for (const [key, id] of Object.entries(options.adoptedCreated)) {
          if (!keys.has(key)) {
            rejected[key] = 'the mutation does not create this key'
            continue
          }
          if (typeof id !== 'string' || id.trim().length === 0) {
            rejected[key] = 'the id is not a non-empty string'
            continue
          }
          try {
            const task = await graph.get(id)
            accepted[key] = task.id
          } catch (error) {
            // The port has its own code for a task it does not hold, and one code can
            // also mean the backend is unreachable: calling that "does not hold" would
            // send the operator looking for a task nobody could read.
            const refusal = refusalShape(error)
            rejected[key] =
              refusal === undefined || refusal.code === 'TASK_CONFLICT'
                ? 'the task graph does not hold this id'
                : `the task graph could not be read for this id: ${refusal.code}`
          }
        }
        if (Object.keys(rejected).length > 0) {
          if (record.state !== 'staged') {
            // The journal says "applying" while the caller is told an operator is
            // needed: an attempt landed, so the two records have to agree.
            store.transaction(tx => enterRecovery(tx, record, 'adopted-ids-rejected', undefined, decision))
          }
          return fail(
            new MyWorkError(
              'PLAN_MUTATION_RECOVERY',
              'dsh-mywork: some adopted ids could not be accepted; those creations stay unresolved',
              { details: { operationId, rejectedAdoptions: rejected, accepted } },
            ),
            meta,
          )
        }
        const overAdoption = adoptedEdgeKeys(record.intent, new Set(Object.keys(accepted)))
        if (record.intent.origin === 'planner' && overAdoption.length > 0) {
          // §5.1: the planner creates work and edges between what it creates. An
          // attested id may settle a create step, but writing an edge over it would
          // change a task the mutation cannot show it created — exactly the write the
          // same edge expressed with a literal id is refused for.
          if (record.state !== 'staged') {
            store.transaction(tx => enterRecovery(tx, record, 'adopted-id-scope-unverified', undefined, decision))
          }
          return fail(
            new MyWorkError(
              'PLANNER_SCOPE_DENIED',
              'dsh-mywork: the resume would write an edge over a task the mutation can only attest it created',
              {
                details: {
                  operationId,
                  adoptedCreated: accepted,
                  keys: overAdoption,
                  reason: 'adopted-id-scope-unverified',
                  hint:
                    'a composite mutation (requireAtomic) is the path for intra-plan edges of a create; an edge onto existing work is a replan and needs an approval',
                },
              },
            ),
            meta,
          )
        }
        const created = { ...record.created, ...accepted }
        const note = `id adopted by ${decision.decidedBy}`
        const steps = record.steps.map(step =>
          step.part === 'create' && accepted[step.ref.replace(/^key:/, '')] !== undefined
            ? { ...step, detail: step.detail === undefined ? note : `${step.detail}; ${note}` }
            : step,
        )
        working = Object.freeze({ ...record, created, steps, updatedAt: now() })
        store.transaction(tx => {
          saveMutationCreated(tx, operationId, created)
          writeSteps(tx, operationId, steps)
        })
      }
      // The pre-flight inside `run` verifies what is there before touching
      // anything, so a resume continues an operation whose landed prefix still
      // matches the intent and refuses when the graph moved (§5.2). Resolving the
      // ids of created tasks is the one thing only the operator can do.
      return run(working, decision)
    },

    async revert(operationId: string, decision: PlanDecision): Promise<Result<PlanMutationOutcome>> {
      requireDecision(decision, 'a revert')
      const record = requireMutation(operationId)
      const meta = record.intent.command.meta
      if (!UNSETTLED_STATES.includes(record.state)) {
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: a plan mutation in state "${record.state}" cannot be reverted`, {
            details: { operationId, state: record.state, reason: 'operation-settled' },
          }),
          meta,
        )
      }
      const baseRevision = store.transaction(tx => readPlanRevision(tx, record.workspaceId))
      if (baseRevision !== record.baseRevision) {
        // Same guard as `run`: restoring a graph on top of a plan revision that
        // moved would undo somebody else's committed plan.
        return fail(
          new MyWorkError(
            'STALE_REVISION',
            'dsh-mywork: the plan revision moved while this operation was staged; a revert would undo a committed plan',
            { details: { operationId, expectedRevision: record.baseRevision, actualRevision: baseRevision } },
          ),
          meta,
        )
      }
      // What the journal shows is not what the graph holds: a part can land and its
      // answer be lost before the journal hears about it, and reverting only the
      // journalled prefix would leave that effect in place while reporting a
      // restoration (§5.2). An operation still `staged` provably never wrote — `run`
      // claims it in the store before its first call — so it has nothing to restore;
      // anything later is read from the graph first, and the inversion is computed
      // from what is actually there.
      let inversion: PlanInversion
      if (record.state === 'staged') {
        inversion = Object.freeze({
          parts: Object.freeze([] as PlanMutationPart[]),
          irreversible: Object.freeze([] as PlanMutationStep[]),
        })
      } else {
        // What the journal shows is what the graph is asked about: edges from the
        // dependency read, retirements from the state table. A step neither read can
        // settle stays `pending`, and an irreversible one then stops the revert
        // instead of being skipped.
        let steps: readonly PlanMutationStep[]
        try {
          steps = markEdgeSteps(record.steps, await graph.dependencies(), record.created)
          steps = await markRetireSteps(steps, record.intent)
        } catch (error) {
          const refusal = refusalShape(error)
          if (refusal === undefined) throw error
          return fail(refusal, meta)
        }
        inversion = invertPlanSteps(steps, meta, baseRevision, record.created)
      }
      if (inversion.irreversible.length > 0) {
        return fail(
          new MyWorkError(
            'TASK_CONFLICT',
            'dsh-mywork: the staged operation contains steps that cannot be undone; revert stops rather than restoring half of it',
            {
              details: {
                operationId,
                irreversible: inversion.irreversible.map(step => `${step.kind}:${step.ref}`),
                reason: 'irreversible-steps',
              },
            },
          ),
          meta,
        )
      }
      try {
        for (const part of inversion.parts) {
          await graph.mutatePlan(part.command ?? { baseRevision, meta })
        }
      } catch (error) {
        const failure = describe(error)
        store.transaction(tx => enterRecovery(tx, record, `revert-failed: ${failure}`, undefined, decision))
        const refusal = refusalShape(error)
        if (refusal !== undefined && GUARDED_CODES.includes(refusal.code)) return fail(refusal, meta)
        return fail(
          new MyWorkError('PLAN_MUTATION_RECOVERY', `dsh-mywork: the revert failed (${failure})`, {
            details: { operationId, failure },
          }),
          meta,
        )
      }
      let report: IntegrityReport
      try {
        report = await verifyInverse(record, inversion.parts)
      } catch (error) {
        const refusal = refusalShape(error)
        if (refusal === undefined) throw error
        store.transaction(tx => enterRecovery(tx, record, `revert-unreadable: ${describe(error)}`, undefined, decision))
        return fail(refusal, meta)
      }
      if (!report.verified) {
        // The graph is not back where the revert promised to put it, so the
        // operation stays unsettled and admission stays paused: §5.2's revert is
        // only finished when the restored dependency set has been observed.
        store.transaction(tx => enterRecovery(tx, record, 'revert-not-verified', report, decision))
        return fail(
          new MyWorkError(
            'PLAN_MUTATION_RECOVERY',
            'dsh-mywork: the revert did not restore the graph; the plan still needs an operator',
            { details: { operationId, report } },
          ),
          meta,
        )
      }
      store.transaction(tx => {
        updateMutationState(tx, operationId, 'reverted', now(), undefined)
        saveMutationReport(tx, operationId, report)
        recordMutationDecision(tx, operationId, decision)
        releaseAdmission(tx, holdIdOf(operationId), now(), decision.decidedBy)
        recordSettlement(tx, record, 'plan.mutation.recovered', report, { reverted: true }, decision)
        tx.outbox.append({
          event: { type: 'admission.resumed', payload: { operationId, workspaceId: record.workspaceId } },
          workspaceId: record.workspaceId,
          correlationId: record.correlationId,
        })
      })
      return ok(
        Object.freeze({
          mode: 'staged' as const,
          operationId,
          state: 'reverted' as const,
          created: record.created,
          addedDependencies: Object.freeze([]),
          removedDependencies: Object.freeze([]),
          integrity: report,
        }),
        meta,
      )
    },

    async integrityReport(operationId: string): Promise<Result<IntegrityReport>> {
      const record = requireMutation(operationId)
      // A settled operation answers with the report it committed: recomputing it
      // would compare the graph against a plan revision that the commit itself
      // advanced, and report a healthy operation as unverified (§5.2).
      if (record.report !== undefined && (record.state === 'applied' || record.state === 'reverted')) {
        return ok(record.report, record.intent.command.meta)
      }
      let fresh: IntegrityReport
      try {
        fresh = await verify(record)
      } catch (error) {
        const refusal = refusalShape(error)
        if (refusal !== undefined) return fail(refusal, record.intent.command.meta)
        throw error
      }
      return ok(fresh, record.intent.command.meta)
    },

    propose(input: WorkProposalInput): Result<WorkProposalRecord> {
      if (!WORK_PROPOSAL_KINDS.includes(input.kind)) {
        throw new TypeError(`dsh-mywork: "${String(input.kind)}" is not a work proposal kind of §10.4`)
      }
      if (typeof input.detail !== 'string' || input.detail.trim().length === 0) {
        throw new TypeError('dsh-mywork: a work proposal needs a non-empty detail')
      }
      if (input.detail.length > MAX_PROPOSAL_DETAIL_LENGTH) {
        throw new TypeError(`dsh-mywork: work proposal detail exceeds ${MAX_PROPOSAL_DETAIL_LENGTH} characters`)
      }
      if (typeof input.raisedBy !== 'string' || input.raisedBy.trim().length === 0) {
        throw new TypeError('dsh-mywork: a work proposal needs a raiser')
      }
      const meta: OperationMeta = { operationId: `proposal-${randomUUID()}`, correlationId: input.correlationId }
      const record: WorkProposalRecord = Object.freeze({
        ...input,
        proposalId: meta.operationId,
        state: 'open' as const,
        raisedAt: now(),
      })
      // A proposal records discovered work and changes nothing else: §10.4 keeps
      // the DAG out of a worker's hands, and a test asserts the graph is untouched.
      store.transaction(tx => insertProposal(tx, record))
      return ok(record, meta)
    },

    async acceptProposal(
      proposalId: string,
      mutation: PlanMutationIntent,
      decision: PlanDecision,
    ): Promise<Result<PlanMutationOutcome>> {
      requireDecision(decision, 'accepting a proposal')
      const meta = mutation.command.meta
      const proposal = store.transaction(tx => readProposal(tx, proposalId))
      if (proposal === undefined) {
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: no work proposal "${proposalId}"`, {
            details: { proposalId, reason: 'unknown-proposal' },
          }),
          meta,
        )
      }
      if (proposal.state !== 'open') {
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: the work proposal is already "${proposal.state}"`, {
            details: { proposalId, state: proposal.state, reason: 'proposal-settled' },
          }),
          meta,
        )
      }
      // The accepted proposal becomes an ordinary plan mutation with origin
      // `proposal`: validated, staged, applied and verified like any other. The
      // decision that admitted it is recorded on the proposal; the operation carries
      // the ordinary plan decision of the submission path, not this one (§10.4).
      const applied = await planner.submit({ ...mutation, origin: 'proposal' })
      if (!applied.ok) return applied
      store.transaction(tx => decideProposal(tx, proposalId, 'accepted', decision, applied.value.operationId))
      return applied
    },

    rejectProposal(proposalId: string, decision: PlanDecision): Result<WorkProposalRecord> {
      requireDecision(decision, 'rejecting a proposal')
      const proposal = store.transaction(tx => readProposal(tx, proposalId))
      if (proposal === undefined) {
        throw new PlanError('not-found', `dsh-mywork: no work proposal "${proposalId}"`, { details: { proposalId } })
      }
      if (proposal.state !== 'open') {
        throw new PlanError('conflict', `dsh-mywork: the work proposal is already "${proposal.state}"`, {
          details: { proposalId, state: proposal.state },
        })
      }
      store.transaction(tx => decideProposal(tx, proposalId, 'rejected', decision))
      const updated = store.transaction(tx => readProposal(tx, proposalId))
      if (updated === undefined) {
        throw new PlanError('not-found', `dsh-mywork: no work proposal "${proposalId}"`, { details: { proposalId } })
      }
      return ok(updated, { operationId: proposalId, correlationId: proposal.correlationId })
    },

    gates: gatesOf,

    async decideGate(request: BlockerGateRequest): Promise<Result<BlockerResolutionGate>> {
      const { decision, meta } = request
      requireDecision(decision, 'a gate decision')
      if (request.action === 'keep-blocking' && (request.reason === undefined || request.reason.trim().length === 0)) {
        return fail(
          new MyWorkError(
            'TASK_CONFLICT',
            'dsh-mywork: keep-blocking needs a reason; a blocker nobody explains is not a decision',
            { details: { gate: `${request.workspaceId}:${request.blockerTaskId}`, reason: 'reason-required' } },
          ),
          meta,
        )
      }
      const gates = await gatesOf(request.workspaceId)
      const gate = gates.find(candidate => candidate.blockerTaskId === request.blockerTaskId)
      if (gate === undefined || !gate.open) {
        return fail(
          new MyWorkError('TASK_CONFLICT', 'dsh-mywork: the blocker gate is not open', {
            details: {
              gate: `${request.workspaceId}:${request.blockerTaskId}`,
              reason: 'gate-not-open',
              open: gate?.open ?? false,
            },
          }),
          meta,
        )
      }
      const dependents = [...gate.dependents]
      // §5.5: `void` removes one condition, not every condition. A dependent that a
      // second open gate still holds must not be moved to `ready` — the edge to this
      // blocker comes off, and the task keeps waiting on the other one.
      const otherHolds = new Set(
        gates
          .filter(candidate => candidate.open && candidate.blockerTaskId !== request.blockerTaskId)
          .flatMap(candidate => [...candidate.dependents]),
      )
      const released =
        request.action === 'void' ? dependents.filter(taskId => !otherHolds.has(taskId)) : dependents
      let operationId: string | undefined
      if (request.action !== 'keep-blocking') {
        // §5.5: the edges come off through a staged mutation, and the dependent
        // moves in the same operation, so a failure leaves one journal to resume.
        const baseRevision = store.transaction(tx => readPlanRevision(tx, request.workspaceId))
        const intent: PlanMutationIntent = {
          workspaceId: request.workspaceId,
          origin: 'replan',
          runningTaskPolicy: 'require-human-decision',
          command: {
            baseRevision,
            ...(request.action === 'void'
              ? {
                  removeDependencies: dependents.map(taskId => ({
                    from: taskId,
                    to: request.blockerTaskId,
                    kind: 'blocks',
                  })),
                }
              : {}),
            meta,
          },
          retire: released.map(taskId => ({
            taskId,
            to: request.action === 'void' ? ('ready' as const) : ('superseded' as const),
            ...(request.reason === undefined ? {} : { reason: request.reason }),
          })),
        }
        const applied = await planner.submit(intent)
        if (!applied.ok) return fail(applied.error, meta)
        operationId = applied.value.operationId
      }
      // One decision per operation, not per clock reading: a repeated call then
      // contradicts itself instead of writing a second row under a new key, and the
      // identity of the evidence no longer depends on when it was asked for (§34).
      const decisionId = `gate-${meta.operationId}`
      const artifactId = `artifact-${decisionId}`
      const record: BlockerResolutionDecision = Object.freeze({
        decisionId,
        workspaceId: request.workspaceId,
        blockerTaskId: request.blockerTaskId,
        action: request.action,
        dependents: Object.freeze(dependents),
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        artifactId,
        ...(operationId === undefined ? {} : { operationId }),
        decidedBy: decision.decidedBy,
        decidedAt: decision.at,
        correlationId: meta.correlationId,
      })
      try {
        settleGate(
          record,
          {
            gateId: `${request.workspaceId}:${request.blockerTaskId}`,
            action: request.action,
            dependents,
            reason: request.reason ?? null,
            decidedBy: decision.decidedBy,
            decidedAt: decision.at,
            operationId: operationId ?? null,
          },
          meta,
        )
      } catch (error) {
        // The operation already recorded its decision: a second one is a contradiction
        // the caller has to see, not a raw SQLite error escaping a Result.
        const code = (error as { readonly code?: unknown }).code
        const message = error instanceof Error ? error.message : ''
        if (
          code === 'artifact-conflict'
          || (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT'))
          || message.includes('UNIQUE constraint failed')
        ) {
          return fail(
            new MyWorkError('TASK_CONFLICT', 'dsh-mywork: this operation already recorded a decision for the gate', {
              details: {
                gate: `${request.workspaceId}:${request.blockerTaskId}`,
                decisionId,
                reason: 'gate-already-decided',
              },
            }),
            meta,
          )
        }
        throw error
      }
      const after = await gatesOf(request.workspaceId)
      const resolved = after.find(candidate => candidate.blockerTaskId === request.blockerTaskId)
      // `void` removes the condition itself, so the gate is legitimately gone once
      // it succeeded: the answer is a closed gate carrying the decision, not an
      // error about a gate that no longer needs to exist (§5.5).
      return ok(
        resolved ?? Object.freeze({
          gateId: `${request.workspaceId}:${request.blockerTaskId}`,
          workspaceId: request.workspaceId,
          blockerTaskId: request.blockerTaskId,
          dependents: Object.freeze([]),
          open: false,
          awaitingDecision: false,
          latestDecision: record,
        }),
        meta,
      )
    },
  }

  return Object.freeze(planner)
}

/** Failure shape of a planner refusal, re-exported for callers that branch on it. */
export type PlannerRefusal = MyWorkErrorShape

/** Migration name this layer requires; re-exported for composition messages. */
export const PLAN_SCHEMA_NAME = PLAN_MUTATION_SCHEMA_NAME
