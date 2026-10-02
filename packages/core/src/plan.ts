/**
 * Plan mutation policy: validation, replanning classification, and integrity
 * verification (architecture §9, §10; ADR024, ADR026).
 *
 * Everything here is a pure function of an intent and an observation of the
 * graph. That is a requirement rather than a style: ADR026 forbids deciding the
 * safety of a plan from a model's judgement, so the class the L3 predicate
 * branches on is computed, and the verification that decides success or recovery
 * is a comparison of the intent with what the graph actually holds.
 *
 * Nothing in this module writes: the staged journal, the admission pause, and the
 * backend calls belong to the planner that composes them (`@dsh-mywork/planner`).
 * @module
 */

import {
  PLAN_EXTERNAL_REF_PREFIX,
  RUNNING_TASK_POLICIES,
  TASK_STATES_WITH_ACTIVE_ATTEMPT,
  type IntegrityReport,
  type NewTaskSpec,
  type OperationMeta,
  type PlanChange,
  type PlanMutationClass,
  type PlanMutationIntent,
  type PlanMutationPart,
  type PlanMutationPartKind,
  type PlanMutationReview,
  type PlanMutationStep,
  type PlanRetirement,
  type Result,
  type Revision,
  type RunningTaskPolicy,
  type TaskDependency,
  type TaskId,
  type TaskState,
} from '@dsh-mywork/contracts'
import { MyWorkError, fail, ok } from './errors.ts'
import { findDependencyCycle } from './graph.ts'

/**
 * What the policy is allowed to know when it reviews a mutation.
 *
 * The review covers exactly the tasks the caller observed: the task graph has no
 * "list every task" operation, so a caller that wants a complete classification
 * supplies a complete observation, and one that supplies three tasks gets a
 * review of three tasks. Nothing is invented to fill the gap.
 */
export interface PlanObservation {
  /** Plan revision currently on record for the workspace. */
  readonly planRevision: Revision
  /** Observed state of every task the caller wants classified. */
  readonly states: Readonly<Record<TaskId, TaskState>>
  /** Observed dependency edges of the workspace. */
  readonly edges: readonly TaskDependency[]
}

/** What the service read about an existing task before changing it. */
export interface PlanTaskSnapshot {
  /** Title the task carried; recorded so a revert can restore it. */
  readonly title?: string
  /** Priority the task carried; recorded so a revert can restore it. */
  readonly priority?: number
}

/** Stable key of one dependency pair; edge kind is not part of it (ADR023). */
export function planEdgeKey(edge: { readonly from: string; readonly to: string }): string {
  return `${edge.from}\u0000${edge.to}`
}

/** Split a pair key produced by {@link planEdgeKey}. */
export function splitPlanEdgeKey(key: string): { readonly from: string; readonly to: string } {
  const [from, to] = key.split('\u0000')
  return { from: from ?? '', to: to ?? '' }
}

/** Versioned prefix for edge references written to the durable mutation journal. */
export const PLAN_EDGE_REF_V1_PREFIX = 'edge:v1:'

/**
 * Encode an edge reference for durable TEXT storage.
 *
 * `planEdgeKey` deliberately uses NUL because it is an unambiguous in-memory
 * composite key, but `node:sqlite` reads TEXT containing an embedded NUL only up
 * to that byte on affected runtimes. A JSON tuple keeps the endpoints lossless
 * while the prefix leaves room for future journal formats.
 */
function durablePlanEdgeRef(edge: { readonly from: string; readonly to: string }): string {
  return `${PLAN_EDGE_REF_V1_PREFIX}${JSON.stringify([edge.from, edge.to])}`
}

/**
 * Decode a durable edge reference.
 *
 * Intact pre-v1 NUL-joined refs are accepted for compatibility. A legacy value
 * already truncated by a SQLite read has no separator and is rejected instead
 * of inventing an empty endpoint.
 */
function splitDurablePlanEdgeRef(
  ref: string,
): { readonly from: string; readonly to: string } | undefined {
  if (ref.startsWith(PLAN_EDGE_REF_V1_PREFIX)) {
    try {
      const decoded: unknown = JSON.parse(ref.slice(PLAN_EDGE_REF_V1_PREFIX.length))
      if (
        Array.isArray(decoded)
        && decoded.length === 2
        && typeof decoded[0] === 'string'
        && typeof decoded[1] === 'string'
      ) {
        return { from: decoded[0], to: decoded[1] }
      }
    } catch {
      // A malformed durable ref is unresolved recovery input, never a partial edge.
    }
    return undefined
  }
  return ref.includes('\u0000') ? splitPlanEdgeKey(ref) : undefined
}

/**
 * Whether a state satisfies a dependency.
 *
 * Only `done` does. ADR023 records the experiment behind this: `cancelled` and
 * `superseded` sit in the frozen category, leave `bd ready`, and leave their
 * dependents blocked — a cancelled blocker does not release the work that waited
 * for it, which is exactly why the blocker gate exists (§5.5).
 * @param state - observed state of the task depended on.
 */
export function dependencySatisfiedBy(state: TaskState): boolean {
  return state === 'done'
}

/** Whether a state holds an active attempt, so §10.3 protects it. */
function hasActiveAttempt(state: TaskState | undefined): boolean {
  return state !== undefined && TASK_STATES_WITH_ACTIVE_ATTEMPT.includes(state)
}

/** External reference a plan-created task carries, so an operator can find it. */
export function planExternalRef(operationId: string, key: string): string {
  return `${PLAN_EXTERNAL_REF_PREFIX}${operationId}:${key}`
}

/** Keys of the tasks a mutation creates. */
function planKeys(intent: PlanMutationIntent): ReadonlySet<string> {
  return new Set((intent.command.create ?? []).map(spec => spec.key))
}

/**
 * Resolve one edge endpoint against the created keys of the same mutation.
 *
 * An endpoint that names a key this mutation creates is *not* a task id, and a
 * backend handed the literal key would store an edge to a task that does not
 * exist. Resolving is therefore part of applying the mutation, not a
 * convenience: an unresolved key is refused instead of written.
 * @throws {TypeError} when the endpoint is a created key whose id is not known yet.
 */
function resolveEndpoint(
  endpoint: string,
  keys: ReadonlySet<string>,
  created: Readonly<Record<string, TaskId>>,
): string {
  if (!keys.has(endpoint)) return endpoint
  const id = created[endpoint]
  if (id === undefined) {
    throw new TypeError(
      `dsh-mywork: the edge endpoint "${endpoint}" names a task this mutation creates, and its id is not known yet`,
    )
  }
  return id
}

/**
 * Resolve every edge of a mutation whose endpoint is a task it creates
 * (ADR026's additive form: an edge between two new tasks).
 *
 * The same resolution is used when the edges are applied and when the outcome is
 * verified, so the check cannot confirm an edge the graph never held.
 * @param intent - the mutation.
 * @param created - created keys already resolved to task ids.
 * @throws {TypeError} when an endpoint is a created key without a known id.
 */
export function resolvePlanEdges(
  intent: PlanMutationIntent,
  created: Readonly<Record<string, TaskId>>,
): { readonly add: readonly TaskDependency[]; readonly remove: readonly TaskDependency[] } {
  const keys = planKeys(intent)
  const map = (edge: TaskDependency): TaskDependency =>
    Object.freeze({
      from: resolveEndpoint(edge.from, keys, created),
      to: resolveEndpoint(edge.to, keys, created),
      kind: edge.kind,
    })
  return Object.freeze({
    add: Object.freeze((intent.command.addDependencies ?? []).map(map)),
    remove: Object.freeze((intent.command.removeDependencies ?? []).map(map)),
  })
}

/**
 * Pair key of a journal step, resolved through the created ids.
 *
 * A step for an edge between two created tasks is journalled by its keys — the
 * ids do not exist when the journal is written — so marking it as landed needs
 * the same resolution the application used.
 * @param ref - versioned durable step reference (or an intact legacy NUL pair).
 * @param created - created keys resolved to ids so far.
 * @returns the resolved pair key, or `undefined` while a key is unresolved.
 */
export function resolvedEdgePair(ref: string, created: Readonly<Record<string, TaskId>>): string | undefined {
  const edge = splitDurablePlanEdgeRef(ref)
  if (edge === undefined) return undefined
  const resolve = (endpoint: string): string | undefined =>
    endpoint.startsWith('key:') ? created[endpoint.slice('key:'.length)] : endpoint
  const resolvedFrom = resolve(edge.from)
  const resolvedTo = resolve(edge.to)
  if (resolvedFrom === undefined || resolvedTo === undefined) return undefined
  return planEdgeKey({ from: resolvedFrom, to: resolvedTo })
}

/**
 * Split an external reference produced by {@link planExternalRef}.
 * @param ref - reference to parse.
 * @returns the operation id and key, or `undefined` for a foreign reference.
 */
export function parsePlanExternalRef(
  ref: string,
): { readonly operationId: string; readonly key: string } | undefined {
  if (!ref.startsWith(PLAN_EXTERNAL_REF_PREFIX)) return undefined
  const rest = ref.slice(PLAN_EXTERNAL_REF_PREFIX.length)
  const separator = rest.lastIndexOf(':')
  if (separator <= 0 || separator === rest.length - 1) return undefined
  return { operationId: rest.slice(0, separator), key: rest.slice(separator + 1) }
}

/** Ids of existing tasks a mutation touches, and how. */
interface PlanTouch {
  /** Fields the mutation updates, per task id. */
  readonly updateFields: Readonly<Record<TaskId, readonly string[]>>
  /** Task ids an added edge points at or comes from. */
  readonly edgeEndpoints: readonly TaskId[]
  /** Task ids whose edges the mutation removes. */
  readonly removalEndpoints: readonly TaskId[]
  /** Task ids the revision retires or releases. */
  readonly retired: Readonly<Record<TaskId, PlanRetirement['to']>>
}

/** Collect what the mutation does to existing tasks. */
function collectTouch(intent: PlanMutationIntent): PlanTouch {
  const updateFields: Record<TaskId, readonly string[]> = {}
  for (const spec of intent.command.update ?? []) {
    const fields: string[] = []
    if (spec.title !== undefined) fields.push('title')
    if (spec.priority !== undefined) fields.push('priority')
    for (const key of Object.keys(spec.setMetadata ?? {})) fields.push(`metadata:${key}`)
    updateFields[spec.id] = Object.freeze(fields.length === 0 ? ['no-op'] : fields)
  }
  const edgeEndpoints: TaskId[] = []
  for (const edge of intent.command.addDependencies ?? []) edgeEndpoints.push(edge.from, edge.to)
  const removalEndpoints: TaskId[] = []
  for (const edge of intent.command.removeDependencies ?? []) removalEndpoints.push(edge.from, edge.to)
  const retired: Record<TaskId, PlanRetirement['to']> = {}
  for (const retirement of intent.retire ?? []) retired[retirement.taskId] = retirement.to
  return Object.freeze({
    updateFields: Object.freeze(updateFields),
    edgeEndpoints: Object.freeze(edgeEndpoints),
    removalEndpoints: Object.freeze(removalEndpoints),
    retired: Object.freeze(retired),
  })
}

/** Keys of tasks the mutation creates. */
function createdKeys(intent: PlanMutationIntent): readonly string[] {
  return (intent.command.create ?? []).map(spec => spec.key)
}

/** Whether the mutation asks the graph to do anything at all. */
export function isEmptyPlanMutation(intent: PlanMutationIntent): boolean {
  const command = intent.command
  return (
    (command.create ?? []).length === 0
    && (command.update ?? []).length === 0
    && (command.addDependencies ?? []).length === 0
    && (command.removeDependencies ?? []).length === 0
    && (intent.retire ?? []).length === 0
  )
}

/**
 * Every existing task the mutation changes, in stable order.
 * @param intent - the mutation.
 */
export function planTouchedTasks(intent: PlanMutationIntent): readonly TaskId[] {
  const touch = collectTouch(intent)
  const ids = new Set<TaskId>([
    ...Object.keys(touch.updateFields),
    ...touch.edgeEndpoints,
    ...touch.removalEndpoints,
    ...Object.keys(touch.retired),
  ])
  return Object.freeze([...ids].sort())
}

/** Edges the mutation proposes to add, including the intra-plan ones by key. */
function proposedEdges(intent: PlanMutationIntent): readonly TaskDependency[] {
  const explicit = [...(intent.command.addDependencies ?? [])]
  const intraPlan = (intent.command.create ?? []).flatMap(spec =>
    (spec.dependsOnKeys ?? []).map(key => ({ from: spec.key, to: key, kind: 'blocks' })),
  )
  return [...explicit, ...intraPlan]
}

/**
 * Classify one existing task under a candidate revision (§10.3).
 *
 * @param taskId - task being classified.
 * @param observed - its observed state, or `undefined` when it is not in the graph.
 * @param touch - what the mutation does to the tasks it mentions.
 */
function classifyExisting(taskId: TaskId, observed: TaskState | undefined, touch: PlanTouch): PlanChange {
  const retirement = touch.retired[taskId]
  if (retirement !== undefined) {
    const classification: PlanChange['class'] =
      retirement === 'cancelled' ? 'cancelled' : retirement === 'superseded' ? 'superseded' : 'modified'
    return Object.freeze({
      taskId,
      class: classification,
      reasons: Object.freeze([`target:${retirement}`]),
    })
  }
  const reasons: string[] = []
  let result: PlanChange['class'] = 'unchanged'
  if (touch.edgeEndpoints.includes(taskId)) {
    result = 'modified'
    reasons.push('dependency-added')
  }
  if (touch.removalEndpoints.includes(taskId)) {
    result = 'modified'
    reasons.push('dependency-removed')
  }
  const fields = touch.updateFields[taskId]
  if (fields !== undefined) {
    result = 'modified'
    reasons.push(...fields)
  }
  if (observed === undefined && result !== 'unchanged') reasons.push('not-observed')
  return Object.freeze({ taskId, class: result, reasons: Object.freeze(reasons) })
}

/**
 * Classify a mutation without validating it.
 *
 * This is what a plan preview and the L3 predicate read: it answers "what would
 * this do, and how strong is it" without touching a backend.
 * @param intent - the mutation.
 * @param observation - observed revision, states, and edges.
 */
export function reviewPlanMutation(intent: PlanMutationIntent, observation: PlanObservation): PlanMutationReview {
  const touch = collectTouch(intent)
  const changes: PlanChange[] = []
  for (const taskId of Object.keys(observation.states).sort()) {
    changes.push(classifyExisting(taskId, observation.states[taskId], touch))
  }
  for (const key of createdKeys(intent)) {
    changes.push(Object.freeze({ taskId: key, class: 'newly-created' as const, reasons: Object.freeze(['created']) }))
  }
  const runningTouched = planTouchedTasks(intent).filter(id => hasActiveAttempt(observation.states[id]))
  return Object.freeze({
    baseRevision: intent.command.baseRevision,
    observedRevision: observation.planRevision,
    changes: Object.freeze(changes),
    mutationClass: classifyPlanMutation(intent),
    addedDependencies: Object.freeze(proposedEdges(intent)),
    removedDependencies: Object.freeze([...(intent.command.removeDependencies ?? [])]),
    runningTasksTouched: Object.freeze(runningTouched),
  })
}

/**
 * Classify a mutation deterministically (ADR026).
 *
 * The class is a function of the mutation alone: "an edge between two new tasks"
 * is decided by whether both ends are keys this mutation creates, never by what
 * the graph happens to hold. That is what makes the L3 predicate reproducible
 * from the plan document a reviewer is looking at.
 *
 * `destructive` outranks `modifying`, and any single operation that is not
 * additive makes the whole mutation non-additive: the class describes the
 * mutation, not its average.
 * @param intent - the mutation.
 */
export function classifyPlanMutation(intent: PlanMutationIntent): PlanMutationClass {
  const command = intent.command
  if ((command.removeDependencies ?? []).length > 0) return 'destructive'
  const retirements = intent.retire ?? []
  // A retirement to a frozen side state removes work from the plan; releasing a
  // dependent back to `ready` only changes a state, so it stays `modifying`.
  if (retirements.some(retirement => retirement.to !== 'ready')) return 'destructive'
  if (retirements.length > 0) return 'modifying'
  if ((command.update ?? []).length > 0) return 'modifying'
  const creates = command.create ?? []
  if (creates.length === 0) return 'modifying'
  const keys = new Set(creates.map(spec => spec.key))
  for (const edge of command.addDependencies ?? []) {
    // An edge to or from an existing task changes that task's dependency set, so
    // it is `modifying` (ADR026). Only an edge whose both ends this mutation
    // creates is additive.
    if (!keys.has(edge.from) || !keys.has(edge.to)) return 'modifying'
  }
  for (const spec of creates) {
    for (const key of spec.dependsOnKeys ?? []) {
      if (!keys.has(key)) return 'modifying'
    }
  }
  return 'additive-only'
}

/**
 * Whether a mutation may be approved without a human under L3 (ADR026).
 *
 * This is only the class half of that predicate: ADR026 also requires non-empty
 * claims, no claim overlap with existing work, an allowed work type, and no human
 * gates. Those belong to the workflow engine, which composes them with this.
 * @param intent - the mutation.
 */
export function isAdditiveOnly(intent: PlanMutationIntent): boolean {
  return classifyPlanMutation(intent) === 'additive-only'
}

/** Whether the backend can apply this mutation as one composite (ADR024). */
export function isAtomicComposite(intent: PlanMutationIntent): boolean {
  const command = intent.command
  return (
    (command.create ?? []).length > 0
    && (command.update ?? []).length === 0
    && (command.addDependencies ?? []).length === 0
    && (command.removeDependencies ?? []).length === 0
    && (intent.retire ?? []).length === 0
  )
}

/** Read a non-empty string field of a runtime-supplied value. */
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`dsh-mywork: plan mutation ${field} must be a non-empty string`)
  }
  return value
}

/** Reject a runtime value that is not a plain object. */
function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`dsh-mywork: ${what} must be an object`)
  }
  return value as Record<string, unknown>
}

/** Validate the shape of an intent before any policy runs. */
function requireIntent(intent: PlanMutationIntent): OperationMeta {
  const raw = requireObject(intent, 'a plan mutation intent')
  const command = requireObject(raw['command'], 'the command of a plan mutation intent')
  const meta = requireObject(command['meta'], 'the operation meta of a plan mutation') as unknown as OperationMeta
  requireString(meta.operationId, 'operationId')
  requireString(meta.correlationId, 'correlationId')
  requireString(raw['workspaceId'], 'workspaceId')
  const baseRevision = command['baseRevision']
  if (typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new TypeError(
      `dsh-mywork: plan mutation baseRevision must be a non-negative safe integer, received ${String(baseRevision)}`,
    )
  }
  return meta
}

/** The legal path a caller must take for a running task, per §10.3. */
function legalPathOf(policy: RunningTaskPolicy): string {
  switch (policy) {
    case 'cancel':
      return 'cancel through the "task.stop-and-cancel" composition (§5.4), which revokes the attempt first'
    case 'finish-then-adapt':
      return 'apply the change after the attempt settles; the running task keeps its plan until then'
    case 'require-human-decision':
      return 'wait for a human decision; nothing may be rewritten before it'
    case 'continue':
      return 'let the attempt finish on the task as it is; a change contradicts the policy'
  }
}

/** Existing task ids a review classifies as changed. */
function changedTaskIds(review: PlanMutationReview): readonly TaskId[] {
  return review.changes
    .filter(change => change.class !== 'unchanged' && change.class !== 'newly-created')
    .map(change => change.taskId)
}

/**
 * Validate a mutation before anything is written (ADR024, §10.3).
 *
 * The checks run in a fixed order and all of them happen before the graph is
 * touched, so a refusal leaves neither a journal entry nor an admission pause.
 * @param intent - the mutation.
 * @param observation - observed revision, states, and edges.
 * @returns the review, or the typed refusal that stopped it.
 * @throws {TypeError} when the intent is malformed; that is a programming error, not a domain outcome.
 */
export function validatePlanMutation(
  intent: PlanMutationIntent,
  observation: PlanObservation,
): Result<PlanMutationReview> {
  const meta = requireIntent(intent)

  if (isEmptyPlanMutation(intent)) {
    return fail(
      new MyWorkError('TASK_CONFLICT', 'dsh-mywork: the plan mutation asks for nothing', {
        details: { operationId: meta.operationId, reason: 'empty-mutation' },
      }),
      meta,
    )
  }

  const review = reviewPlanMutation(intent, observation)
  const command = intent.command

  // §5.1: the planner creates new work only; changing an existing task is the
  // separate replan command, and mixing the two is refused by type here.
  if (intent.origin === 'planner' && review.mutationClass !== 'additive-only') {
    return fail(
      new MyWorkError(
        'PLANNER_SCOPE_DENIED',
        'dsh-mywork: the planner may only create tasks and edges between them; a change to existing work is a replan',
        {
          details: {
            operationId: meta.operationId,
            mutationClass: review.mutationClass,
            refused: changedTaskIds(review),
            hint: 'send the mutation with origin "replan" and an approval, or drop the non-additive operations',
          },
        },
      ),
      meta,
    )
  }

  // §9/§10.1: the plan revision is a MyWork aggregate; the backend has none, so
  // the compare-and-set happens here.
  if (command.baseRevision !== observation.planRevision) {
    return fail(
      new MyWorkError('STALE_REVISION', 'dsh-mywork: the plan mutation was computed against another plan revision', {
        details: {
          operationId: meta.operationId,
          expectedRevision: command.baseRevision,
          actualRevision: observation.planRevision,
        },
      }),
      meta,
    )
  }

  // §10.3: a running task is never rewritten silently. The policy is named
  // explicitly, and each of the four has a legal path the refusal points at.
  if (review.runningTasksTouched.length > 0) {
    const policy = intent.runningTaskPolicy
    if (policy === undefined) {
      return fail(
        new MyWorkError(
          'TASK_CONFLICT',
          `dsh-mywork: the plan mutation touches ${review.runningTasksTouched.length} task(s) with a running attempt and declares no policy`,
          {
            details: {
              operationId: meta.operationId,
              tasks: review.runningTasksTouched,
              legalPolicies: RUNNING_TASK_POLICIES,
              reason: 'running-task-policy-required',
            },
          },
        ),
        meta,
      )
    }
    return fail(
      new MyWorkError(
        'TASK_CONFLICT',
        `dsh-mywork: running task(s) ${review.runningTasksTouched.join(', ')} cannot be rewritten under policy "${policy}"; ${legalPathOf(policy)}`,
        {
          details: {
            operationId: meta.operationId,
            tasks: review.runningTasksTouched,
            policy,
            legalPath: legalPathOf(policy),
            reason: 'running-task-protected',
          },
        },
      ),
      meta,
    )
  }

  // ADR024: a cycle is refused before anything is applied. Removed edges are
  // excluded from the graph the check sees, so reversing an edge is legal.
  const removed = new Set((command.removeDependencies ?? []).map(edge => planEdgeKey(edge)))
  const existing = observation.edges.filter(edge => !removed.has(planEdgeKey(edge)))
  const cycle = findDependencyCycle([...existing, ...proposedEdges(intent)])
  if (cycle !== undefined) {
    return fail(
      new MyWorkError('ENTITY_CYCLE', 'dsh-mywork: the plan would create a dependency cycle', {
        details: { operationId: meta.operationId, path: cycle },
      }),
      meta,
    )
  }

  // ADR024: a caller that cannot accept a pause asks for atomicity and is
  // refused, because the composite covers creations only. Nothing is emulated.
  if (intent.requireAtomic === true && !isAtomicComposite(intent)) {
    return fail(
      new MyWorkError(
        'PLAN_MUTATION_STAGED',
        'dsh-mywork: the mutation cannot be applied as one atomic unit and staging was refused by the caller',
        {
          details: {
            operationId: meta.operationId,
            reason: 'atomic-not-expressible',
            parts: planMutationParts(intent).map(part => part.kind),
          },
        },
      ),
      meta,
    )
  }

  // A key is a name for a task this mutation creates, and resolving an endpoint
  // cannot tell a key from an id. A key that repeats the id of a task the graph
  // already holds would therefore shadow it — the edge the policy reviewed as one
  // between two new tasks would be written onto the existing task — and two specs
  // under one key would create two tasks behind one reference (S1, ADR026's
  // additive form is what L3 approves on).
  const seenKeys = new Set<string>()
  for (const spec of command.create ?? []) {
    if (observation.states[spec.key] !== undefined) {
      return fail(
        new MyWorkError(
          'TASK_CONFLICT',
          `dsh-mywork: the create key "${spec.key}" is the id of a task the task graph already holds`,
          {
            details: {
              operationId: meta.operationId,
              key: spec.key,
              reason: 'create-key-shadows-existing-task',
            },
          },
        ),
        meta,
      )
    }
    if (seenKeys.has(spec.key)) {
      return fail(
        new MyWorkError('TASK_CONFLICT', `dsh-mywork: two tasks in this mutation are created under the key "${spec.key}"`, {
          details: { operationId: meta.operationId, key: spec.key, reason: 'duplicate-plan-key' },
        }),
        meta,
      )
    }
    seenKeys.add(spec.key)
  }

  // An edge may not invent a task: an endpoint is either an existing task or a
  // key this mutation creates. Otherwise the verification could never see it.
  const keys = new Set(createdKeys(intent))
  const unknown = new Set<string>()
  for (const edge of [...(command.addDependencies ?? []), ...(command.removeDependencies ?? [])]) {
    for (const endpoint of [edge.from, edge.to]) {
      if (!keys.has(endpoint) && observation.states[endpoint] === undefined) unknown.add(endpoint)
    }
  }
  if (unknown.size > 0) {
    return fail(
      new MyWorkError(
        'TASK_CONFLICT',
        'dsh-mywork: the plan wires a dependency to a task that exists neither in the graph nor in this mutation',
        {
          details: {
            operationId: meta.operationId,
            unknown: Object.freeze([...unknown].sort()),
            reason: 'unknown-edge-endpoint',
          },
        },
      ),
      meta,
    )
  }

  for (const spec of command.create ?? []) {
    for (const key of spec.dependsOnKeys ?? []) {
      if (!keys.has(key)) {
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: plan node "${spec.key}" depends on unknown key "${key}"`, {
            details: { operationId: meta.operationId, key: spec.key, unknown: key, reason: 'unknown-plan-key' },
          }),
          meta,
        )
      }
    }
  }

  return ok(review, meta)
}

/** Strip the intra-plan keys from a create spec and give it a findable reference. */
function prepareCreateSpec(spec: NewTaskSpec, operationId: string): NewTaskSpec {
  const { dependsOnKeys, ...rest } = spec
  void dependsOnKeys
  // §5.2's operator resolves a create whose id was never journalled by finding the
  // task; that is only possible if the reference really is on the task, so it is
  // written unless the caller supplied one of its own.
  return Object.freeze({
    ...rest,
    externalRef: spec.externalRef ?? planExternalRef(operationId, spec.key),
  })
}

/**
 * Split a mutation into the parts each primitive can carry (ADR024 step 3).
 *
 * The split is deliberate and has two jobs. It gives recovery a unit it can
 * observe — a part either landed or it did not — and it keeps intra-plan
 * dependencies out of the backend's per-task create path, where they would be
 * dropped without an error: the planner re-issues them as explicit edges once the
 * created ids are known ({@link materializePlanPart}).
 * @param intent - the mutation.
 */
export function planMutationParts(intent: PlanMutationIntent): readonly PlanMutationPart[] {
  const command = intent.command
  const operationId = command.meta.operationId
  if (intent.requireAtomic === true && isAtomicComposite(intent)) {
    // One composite call: the backend wires intra-plan keys itself, and every
    // created task still carries the reference an operator would search for.
    return Object.freeze([
      Object.freeze({
        kind: 'create' as PlanMutationPartKind,
        command: Object.freeze({
          ...command,
          create: Object.freeze((command.create ?? []).map(spec => ensureExternalRef(spec, operationId))),
        }),
      }),
    ])
  }
  const parts: PlanMutationPart[] = []
  const creates = command.create ?? []
  if (creates.length > 0) {
    parts.push(
      Object.freeze({
        kind: 'create' as PlanMutationPartKind,
        command: Object.freeze({
          baseRevision: command.baseRevision,
          create: Object.freeze(creates.map(spec => prepareCreateSpec(spec, operationId))),
          meta: command.meta,
        }),
      }),
    )
  }
  const explicitEdges = (command.addDependencies ?? []).length + (command.removeDependencies ?? []).length
  const intraPlan = creates.some(spec => (spec.dependsOnKeys ?? []).length > 0)
  if (explicitEdges > 0 || intraPlan) {
    parts.push(
      Object.freeze({
        kind: 'edges' as PlanMutationPartKind,
        command: Object.freeze({
          baseRevision: command.baseRevision,
          ...((command.addDependencies ?? []).length === 0 ? {} : { addDependencies: command.addDependencies }),
          ...((command.removeDependencies ?? []).length === 0
            ? {}
            : { removeDependencies: command.removeDependencies }),
          meta: command.meta,
        }),
      }),
    )
  }
  const updates = command.update ?? []
  if (updates.length > 0) {
    parts.push(
      Object.freeze({
        kind: 'fields' as PlanMutationPartKind,
        command: Object.freeze({ baseRevision: command.baseRevision, update: updates, meta: command.meta }),
      }),
    )
  }
  const retirements = intent.retire ?? []
  if (retirements.length > 0) {
    parts.push(Object.freeze({ kind: 'retire' as PlanMutationPartKind, retire: retirements }))
  }
  return Object.freeze(parts)
}

/** Give a create spec the reference an operator would search for. */
function ensureExternalRef(spec: NewTaskSpec, operationId: string): NewTaskSpec {
  return spec.externalRef === undefined
    ? Object.freeze({ ...spec, externalRef: planExternalRef(operationId, spec.key) })
    : spec
}

/**
 * Resolve a part into the command that is actually sent.
 *
 * Two transformations happen here, and both exist because a key is not an id:
 * the intra-plan dependencies of created tasks become ordinary edges from the
 * resolved ids, and any explicit edge whose endpoint names a created task is
 * resolved the same way. Without them a backend would be asked to store an edge
 * to a task that does not exist, and the verification — comparing the same
 * literal string — would confirm it.
 * @param part - part produced by {@link planMutationParts}.
 * @param intent - the mutation the part came from.
 * @param created - created keys already resolved to task ids.
 * @throws {TypeError} when an endpoint needs an id that is not resolved yet.
 */
export function materializePlanPart(
  part: PlanMutationPart,
  intent: PlanMutationIntent,
  created: Readonly<Record<string, TaskId>>,
): PlanMutationPart {
  if (part.kind === 'create') return part
  if (part.kind !== 'edges') return part
  const command = part.command
  if (command === undefined) throw new TypeError('dsh-mywork: an edges part must carry a command')
  const explicit = resolvePlanEdges(intent, created)
  const intraPlan: TaskDependency[] = []
  for (const spec of intent.command.create ?? []) {
    for (const key of spec.dependsOnKeys ?? []) {
      const from = created[spec.key]
      const to = created[key]
      if (from === undefined || to === undefined) {
        throw new TypeError(
          `dsh-mywork: the edge "${spec.key}" → "${key}" needs both tasks resolved before the edges part can be materialised`,
        )
      }
      intraPlan.push({ from, to, kind: 'blocks' })
    }
  }
  const adds = [...explicit.add, ...intraPlan]
  const removes = [...explicit.remove]
  return Object.freeze({
    kind: 'edges' as PlanMutationPartKind,
    command: Object.freeze({
      baseRevision: command.baseRevision,
      ...(adds.length === 0 ? {} : { addDependencies: Object.freeze(adds) }),
      ...(removes.length === 0 ? {} : { removeDependencies: Object.freeze(removes) }),
      meta: command.meta,
    }),
  })
}

/**
 * Journal reference for one edge.
 *
 * An endpoint that names a task this mutation creates is written as `key:<name>`,
 * because the journal is written before those tasks have ids. Marking the step and
 * building its inverse resolve that prefix through the created ids.
 */
function planEdgeRef(edge: TaskDependency, keys: ReadonlySet<string>): string {
  return durablePlanEdgeRef({
    from: keys.has(edge.from) ? `key:${edge.from}` : edge.from,
    to: keys.has(edge.to) ? `key:${edge.to}` : edge.to,
  })
}

/**
 * Journal steps of a staged mutation (ADR024 step 2).
 *
 * Reversibility is decided here, once, from what the port can express: an edge
 * step is undone by the opposite edge step, a field step by restoring the value
 * it replaced, while a creation cannot be undone — the canonical port has no
 * delete — and a retirement is terminal by §18.1. §5.2's "revert only the steps
 * marked reversible" reads exactly this flag.
 * @param intent - the mutation.
 * @param snapshots - values observed before the change, for `update` steps.
 */
export function planSteps(
  intent: PlanMutationIntent,
  snapshots: Readonly<Record<TaskId, PlanTaskSnapshot>> = {},
): readonly PlanMutationStep[] {
  const steps: PlanMutationStep[] = []
  const keys = planKeys(intent)
  // The same edge can be named twice — an intra-plan key dependency repeated in
  // `addDependencies`, for instance — and one edge deserves one journal step.
  const addedEdges = new Set<string>()
  const removedEdges = new Set<string>()
  let seq = 0
  const push = (step: Omit<PlanMutationStep, 'seq' | 'state'>): void => {
    steps.push(Object.freeze({ seq: seq++, state: 'pending' as const, ...step }))
  }
  const pushEdge = (
    kind: 'add-edge' | 'remove-edge',
    ref: string,
    detail?: string,
  ): void => {
    const seen = kind === 'add-edge' ? addedEdges : removedEdges
    if (seen.has(ref)) return
    seen.add(ref)
    push({ part: 'edges', kind, ref, reversible: true, ...(detail === undefined ? {} : { detail }) })
  }
  for (const spec of intent.command.create ?? []) {
    push({
      part: 'create',
      kind: 'create',
      ref: `key:${spec.key}`,
      reversible: false,
      detail: `external-ref ${planExternalRef(intent.command.meta.operationId, spec.key)}`,
    })
  }
  // An edge between two created tasks is journalled by its keys: the ids do not
  // exist yet. Without this step the `edges` part would look empty and never run,
  // and the plan would sit in recovery with its intra-plan edges missing.
  for (const spec of intent.command.create ?? []) {
    for (const key of spec.dependsOnKeys ?? []) {
      pushEdge(
        'add-edge',
        durablePlanEdgeRef({ from: `key:${spec.key}`, to: `key:${key}` }),
        `intra-plan ${spec.key} depends on ${key}`,
      )
    }
  }
  for (const edge of intent.command.addDependencies ?? []) {
    pushEdge('add-edge', planEdgeRef(edge, keys))
  }
  for (const edge of intent.command.removeDependencies ?? []) {
    pushEdge('remove-edge', planEdgeRef(edge, keys))
  }
  for (const spec of intent.command.update ?? []) {
    const snapshot = snapshots[spec.id]
    const previous: Record<string, string> = {}
    if (snapshot?.title !== undefined) previous['title'] = snapshot.title
    if (snapshot?.priority !== undefined) previous['priority'] = String(snapshot.priority)
    // Metadata cannot be read back through `TaskGraphPort`, so a step that sets it
    // cannot be undone: §5.2 reverts the steps marked reversible, and a step that
    // would silently keep the old metadata is not one of them.
    const metadataKeys = Object.keys(spec.setMetadata ?? {})
    push({
      part: 'fields',
      kind: 'update',
      ref: spec.id,
      reversible: metadataKeys.length === 0,
      ...(Object.keys(previous).length === 0 ? {} : { previous: Object.freeze(previous) }),
      ...(metadataKeys.length === 0
        ? {}
        : { detail: `metadata ${metadataKeys.join(',')} is not readable through the task graph port` }),
    })
  }
  for (const retirement of intent.retire ?? []) {
    push({
      part: 'retire',
      kind: 'retire',
      ref: retirement.taskId,
      reversible: false,
      detail: `retired:${retirement.to}`,
    })
  }
  return Object.freeze(steps)
}

/** Inputs of {@link verifyPlanIntegrity}. */
export interface PlanVerificationInput {
  /** Operation being verified. */
  readonly operationId: string
  /** Mutation whose outcome is compared with the graph. */
  readonly intent: PlanMutationIntent
  /** Plan revision observed before the mutation was applied. */
  readonly baseRevision: Revision
  /** Plan revision observed at verification time. */
  readonly observedRevision: Revision
  /**
   * Plan revision the outcome is expected to sit on: the base revision while the
   * operation is unfinished, and `baseRevision + 1` once it committed — a
   * committed plan is *supposed* to have moved the aggregate. Defaults to
   * {@link PlanVerificationInput.baseRevision}.
   */
  readonly expectedRevision?: Revision
  /** Created keys resolved to ids, from the backend's own answer. */
  readonly created: Readonly<Record<string, TaskId>>
  /** Edges read back from the graph after the parts ran. */
  readonly observedEdges: readonly TaskDependency[]
  /** States read back for the retired tasks. */
  readonly observedStates: Readonly<Record<TaskId, TaskState>>
  /** Clock reading of the verification. */
  readonly checkedAt: number
}

/**
 * Resolve edges for verification, tolerating the ones whose task does not exist yet.
 *
 * Application cannot run with an unresolved key — it would write an edge to a task
 * that is not there — but verification runs *before* the tasks exist as well, where
 * an unresolved key edge is work not done yet rather than a contradiction. Those
 * edges are returned separately so the caller can report them as pending.
 * @param intent - the mutation.
 * @param created - created keys resolved to ids so far.
 */
function resolveEdgesForVerification(
  intent: PlanMutationIntent,
  created: Readonly<Record<string, TaskId>>,
): { readonly add: readonly TaskDependency[]; readonly remove: readonly TaskDependency[]; readonly unresolved: readonly string[] } {
  const keys = planKeys(intent)
  const add: TaskDependency[] = []
  const remove: TaskDependency[] = []
  const unresolved: string[] = []
  const visit = (edge: TaskDependency, into: TaskDependency[]): void => {
    const endpoints = [edge.from, edge.to].map(endpoint =>
      keys.has(endpoint) ? created[endpoint] : endpoint,
    )
    if (endpoints.some(endpoint => endpoint === undefined)) {
      unresolved.push(planEdgeKey(edge))
      return
    }
    into.push(Object.freeze({ from: endpoints[0] as string, to: endpoints[1] as string, kind: edge.kind }))
  }
  for (const edge of intent.command.addDependencies ?? []) visit(edge, add)
  for (const edge of intent.command.removeDependencies ?? []) visit(edge, remove)
  return Object.freeze({
    add: Object.freeze(add),
    remove: Object.freeze(remove),
    unresolved: Object.freeze(unresolved),
  })
}

/**
 * Compare the intent with the graph that actually resulted (ADR024 step 4).
 *
 * The comparison is about the outcome, never about the commands that ran: an edge
 * the mutation asked for and the graph does not hold is `missing`; an edge on a
 * touched pair that the mutation never asked for is `unexpected`, which is also
 * how a removal that did not take effect shows up; a cycle anywhere in the
 * observed graph is reported with its path; a retirement that did not reach its
 * state is named. A plan revision that moved while the operation was staged counts
 * as a mismatch too: another writer got there first.
 * @param input - intent, resolved ids, and the observations.
 */
export function verifyPlanIntegrity(input: PlanVerificationInput): IntegrityReport {
  const created = input.created
  const missing: string[] = []
  const pendingRemovals: string[] = []
  const unexpected: string[] = []
  const observed = new Set(input.observedEdges.map(edge => planEdgeKey(edge)))
  // The intent is compared in the form the graph stores: an edge whose endpoint
  // names a created task is checked by the id that task received, never by the
  // literal key the plan was written with. An edge whose task does not exist yet
  // is work not done, not a contradiction.
  const resolved = resolveEdgesForVerification(input.intent, created)

  const intendedAdds: string[] = []
  for (const edge of resolved.add) intendedAdds.push(planEdgeKey(edge))
  for (const spec of input.intent.command.create ?? []) {
    for (const key of spec.dependsOnKeys ?? []) {
      const from = created[spec.key]
      const to = created[key]
      if (from !== undefined && to !== undefined) intendedAdds.push(planEdgeKey({ from, to }))
    }
  }
  const intendedRemoves = new Set(resolved.remove.map(edge => planEdgeKey(edge)))
  /** Ids this mutation handed out: an edge touching one of them cannot predate it. */
  const createdIds = new Set<string>(Object.values(created))
  const touchedNodes = new Set<string>()
  for (const pair of [...intendedAdds, ...intendedRemoves]) {
    const { from, to } = splitPlanEdgeKey(pair)
    touchedNodes.add(from)
    touchedNodes.add(to)
  }

  for (const key of intendedAdds) {
    if (!observed.has(key)) missing.push(key)
  }
  // An edge whose endpoint is a task this mutation has not created yet cannot be
  // compared at all: it is reported as missing work, and the unresolved create it
  // depends on is reported separately.
  for (const pair of resolved.unresolved) missing.push(pair)
  for (const pair of intendedRemoves) {
    if (observed.has(pair)) pendingRemovals.push(pair)
  }
  for (const edge of input.observedEdges) {
    const pair = planEdgeKey(edge)
    if (intendedAdds.includes(pair) || intendedRemoves.has(pair)) continue
    // An edge the mutation never mentions is the graph moving under the operation: no
    // intent explains it, so it is reported rather than absorbed (ADR024: recovery,
    // not a guess). An edge touching a task this mutation just created cannot predate
    // the operation at all, so one endpoint is enough there; for two existing tasks
    // the journal holds no "before", and only the pair the mutation touched can be
    // compared without inventing a baseline.
    const createdEndpoint =
      createdIds.has(edge.from) || createdIds.has(edge.to)
    if (createdEndpoint || (touchedNodes.has(edge.from) && touchedNodes.has(edge.to))) unexpected.push(pair)
  }

  const unresolvedCreates: string[] = []
  for (const spec of input.intent.command.create ?? []) {
    if (created[spec.key] === undefined) unresolvedCreates.push(spec.key)
  }

  const stateMismatches: string[] = []
  for (const retirement of input.intent.retire ?? []) {
    const state = input.observedStates[retirement.taskId]
    if (state !== retirement.to) stateMismatches.push(`${retirement.taskId}=${state ?? 'absent'}`)
  }

  const cycle = findDependencyCycle(input.observedEdges)
  const verified =
    missing.length === 0
    && pendingRemovals.length === 0
    && unexpected.length === 0
    && stateMismatches.length === 0
    && unresolvedCreates.length === 0
    && cycle === undefined
    && input.observedRevision === (input.expectedRevision ?? input.baseRevision)

  return Object.freeze({
    operationId: input.operationId,
    workspaceId: input.intent.workspaceId,
    baseRevision: input.baseRevision,
    observedRevision: input.observedRevision,
    missing: Object.freeze(missing),
    pendingRemovals: Object.freeze(pendingRemovals),
    unexpected: Object.freeze(unexpected),
    ...(cycle === undefined ? {} : { cycle }),
    stateMismatches: Object.freeze(stateMismatches),
    created: Object.freeze({ ...created }),
    unresolvedCreates: Object.freeze(unresolvedCreates),
    verified,
    checkedAt: input.checkedAt,
  })
}

/** Result of inverting a staged operation: what to apply, and what cannot be undone. */
export interface PlanInversion {
  /** Parts that restore the graph to its pre-mutation state. */
  readonly parts: readonly PlanMutationPart[]
  /** Steps that landed but cannot be undone (§5.2). */
  readonly irreversible: readonly PlanMutationStep[]
}

/**
 * Build the inverse of the steps that landed (§5.2).
 *
 * Only `applied` steps take part: a step that never landed has nothing to undo.
 * A step reference written with `key:` prefixes is resolved through the created
 * ids first, because an inverse that put a literal plan key into the graph would
 * be a second defect rather than a rollback. A landed creation or retirement is
 * irreversible and is reported by name, so the operator sees why an automatic
 * revert stops instead of a partial rollback pretending to be complete.
 * @param steps - journal of the operation.
 * @param meta - operation identity for the inverse commands.
 * @param baseRevision - plan revision the inverse is computed against.
 * @param created - created keys resolved to ids, for symbolic step references.
 */
export function invertPlanSteps(
  steps: readonly PlanMutationStep[],
  meta: OperationMeta,
  baseRevision: Revision,
  created: Readonly<Record<string, TaskId>> = {},
): PlanInversion {
  const adds: TaskDependency[] = []
  const removes: TaskDependency[] = []
  const updates: { id: TaskId; title?: string; priority?: number; setMetadata: Record<string, string> }[] = []
  const irreversible: PlanMutationStep[] = []
  // One pair is one edge: a step repeated in the journal must not produce a second
  // inverse command.
  const addedKeys = new Set<string>()
  const removedKeys = new Set<string>()
  for (const step of steps) {
    // A step the journal does not show as landed is read two ways. `failed` is an
    // answer — the graph was observed and does not hold it — so the revert may leave
    // it alone. `pending` is not: the port can write and lose the answer before the
    // journal hears about it, which is the window ADR024 stages for, and for an
    // irreversible step (a create, a retirement, a metadata write) nothing can
    // establish either way. Skipping it would let a revert claim a restoration
    // nobody observed.
    // A create the journal does not show as landed may still have created a task:
    // `PlanMutationResult.created` only promises the ids that were *known*, so a port
    // that wrote the task and answered without the id leaves a `failed` create that
    // nobody can disprove. Such a step therefore blocks a revert exactly as a
    // `pending` one does — otherwise the revert leaves the task behind and claims a
    // restoration. A `failed` retirement or edge is different: the observation said
    // what the graph holds, so it is an answer.
    const unprovenCreate = step.part === 'create' && step.state !== 'applied'
    if (unprovenCreate || (step.state === 'pending' && !step.reversible)) {
      irreversible.push(step)
      continue
    }
    if (step.state !== 'applied') continue
    if (!step.reversible) {
      irreversible.push(step)
      continue
    }
    switch (step.kind) {
      case 'add-edge': {
        const pair = resolvedEdgePair(step.ref, created)
        if (pair === undefined) {
          // Without the ids the inverse cannot be expressed; claiming otherwise
          // would write a plan key where a task id belongs.
          irreversible.push(step)
          break
        }
        if (!removedKeys.has(pair)) {
          removedKeys.add(pair)
          removes.push({ ...splitPlanEdgeKey(pair), kind: 'blocks' })
        }
        break
      }
      case 'remove-edge': {
        const pair = resolvedEdgePair(step.ref, created)
        if (pair === undefined) {
          irreversible.push(step)
          break
        }
        if (!addedKeys.has(pair)) {
          addedKeys.add(pair)
          adds.push({ ...splitPlanEdgeKey(pair), kind: 'blocks' })
        }
        break
      }
      case 'update':
        updates.push({
          id: step.ref,
          ...(step.previous?.['title'] === undefined ? {} : { title: step.previous['title'] }),
          ...(step.previous?.['priority'] === undefined ? {} : { priority: Number(step.previous['priority']) }),
          setMetadata: {},
        })
        break
      default:
        // `create` and `retire` are irreversible and never reach this branch:
        // both are journaled with `reversible: false`.
        irreversible.push(step)
        break
    }
  }
  const parts: PlanMutationPart[] = []
  if (adds.length > 0 || removes.length > 0) {
    parts.push(
      Object.freeze({
        kind: 'edges' as PlanMutationPartKind,
        command: Object.freeze({
          baseRevision,
          ...(adds.length === 0 ? {} : { addDependencies: Object.freeze(adds) }),
          ...(removes.length === 0 ? {} : { removeDependencies: Object.freeze(removes) }),
          meta,
        }),
      }),
    )
  }
  if (updates.length > 0) {
    parts.push(
      Object.freeze({
        kind: 'fields' as PlanMutationPartKind,
        command: Object.freeze({ baseRevision, update: Object.freeze(updates), meta }),
      }),
    )
  }
  return Object.freeze({ parts: Object.freeze(parts), irreversible: Object.freeze(irreversible) })
}
