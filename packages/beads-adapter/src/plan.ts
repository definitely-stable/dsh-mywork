/**
 * Plan mutation, atomic where the backend supports it and staged otherwise
 * (ADR024).
 *
 * A plan mutation is the one operation Beads cannot serve in a single unit. The
 * two primitives disagree precisely: `bd create --graph` is one atomic composite
 * but creates only; `bd batch` is one transaction and can `dep add` **and**
 * `dep remove`, but carries no guard and cannot write metadata. ADR024 therefore
 * defines a staged path with an admission pause, and forbids the adapter from
 * claiming the atomicity the backend does not offer.
 *
 * Which path runs is decided by the mutation's own shape, not by configuration:
 * a mutation that only creates goes through the atomic composite; anything that
 * also updates or removes edges is staged, because no primitive covers it.
 * @module
 */

import { AdapterRefusal } from '@dsh-mywork/adapter-sdk'
import { MyWorkError } from '@dsh-mywork/core'
import type {
  PlanMutationCommand,
  TaskDependency,
  TaskId,
} from '@dsh-mywork/contracts'

/** One create instruction in a `bd create --graph` plan. */
export interface GraphApplyNode {
  /** Caller-owned key used to wire dependencies inside the same plan. */
  readonly key: string
  readonly title: string
  readonly description?: string
  /** Beads priority (already inverted). */
  readonly priority?: number
  readonly external_ref?: string
  /** Dependencies expressed as plans-internal keys. */
  readonly deps?: readonly { readonly target: string; readonly type?: string }[]
}

/** The `bd create --graph` plan document. */
export interface GraphApplyPlan {
  readonly nodes: readonly GraphApplyNode[]
}

/**
 * Whether a mutation can be applied by the atomic composite.
 *
 * `bd create --graph` creates tasks and wires dependencies among them, so it can
 * serve a mutation that only creates. The moment the mutation touches an existing
 * task — a field update, an added edge, a removed edge — it falls outside the
 * composite and must be staged.
 * @param command - the mutation to classify.
 */
export function canApplyAtomically(command: PlanMutationCommand): boolean {
  const updates = command.update ?? []
  const added = command.addDependencies ?? []
  const removed = command.removeDependencies ?? []
  const creates = command.create ?? []
  if (creates.length === 0) return false
  return updates.length === 0 && added.length === 0 && removed.length === 0
}

/**
 * Build the `bd create --graph` document for a create-only mutation.
 *
 * `deps` name other nodes by **key**, so the graph is wired inside the one
 * composite and a half-created plan is never observed. Keys the mutation did not
 * declare are dropped rather than passed through: Beads would reject the whole
 * plan, and failing the mutation for a key that does not exist is the caller's
 * error to see, not Beads'.
 * @param command - the mutation.
 * @throws {AdapterRefusal} when a dependency names a key the mutation does not create.
 */
export function toGraphApplyPlan(command: PlanMutationCommand): GraphApplyPlan {
  const specs = command.create ?? []
  const keys = new Set(specs.map(spec => spec.key))
  const nodes = specs.map(spec => {
    const dependsOnKeys = spec.dependsOnKeys ?? []
    for (const key of dependsOnKeys) {
      if (!keys.has(key)) {
        throw new AdapterRefusal(
          'TASK_CONFLICT',
          `dsh-mywork: plan node "${spec.key}" depends on unknown key "${key}"`,
          { details: { key: spec.key, unknown: key } },
        )
      }
    }
    return {
      key: spec.key,
      title: spec.title,
      ...(spec.description === undefined ? {} : { description: spec.description }),
      ...(spec.priority === undefined ? {} : { priority: spec.priority }),
      ...(spec.externalRef === undefined ? {} : { external_ref: spec.externalRef }),
      ...(dependsOnKeys.length === 0
        ? {}
        : { deps: dependsOnKeys.map(target => ({ target, type: 'blocks' })) }),
    }
  })
  return { nodes }
}

/** One line of a `bd batch` script. */
export type BatchLine = string

/** The staged mutation split into the parts each primitive can carry. */
export interface StagedMutationPlan {
  /**
   * Lines for the single `bd batch` transaction. Edges are added and removed
   * here: this is the only primitive that can do both, and it does them in one
   * transaction (ADR023 `batch-dep-remove`).
   */
  readonly batch: readonly BatchLine[]
  /**
   * Field updates that `bd batch` cannot express — metadata in particular, which
   * `bd batch` rejects with `unsupported key "metadata"`. Each becomes a separate
   * key-scoped `bd update`, never a document replacement.
   */
  readonly updates: readonly MetadataUpdate[]
}

/** One key-scoped metadata write, or a plain field update the batch cannot carry. */
export interface MetadataUpdate {
  readonly id: TaskId
  readonly title?: string
  readonly priority?: number
  /** Metadata keys to set individually; no document replacement is ever issued. */
  readonly setMetadata?: Readonly<Record<string, string>>
}

/**
 * Split a staged mutation into a batch transaction and its trailing updates.
 *
 * Order matters and is deliberate: edges first, then field updates. A dependency
 * removed before the update means the update cannot race a dependent starting on
 * a stale edge, and ADR024's admission pause means nothing starts during the
 * window anyway.
 * @param command - the mutation to stage.
 */
export function toStagedMutationPlan(command: PlanMutationCommand): StagedMutationPlan {
  const batch: BatchLine[] = []

  for (const edge of command.addDependencies ?? []) {
    batch.push(`dep add ${edge.from} ${edge.to} ${edge.kind === '' ? 'blocks' : edge.kind}`)
  }
  for (const edge of command.removeDependencies ?? []) {
    batch.push(`dep remove ${edge.from} ${edge.to}`)
  }
  for (const spec of command.update ?? []) {
    // Only the fields `bd batch` really supports go in the transaction; metadata
    // and anything else is deferred to the key-scoped update below.
    const assignments: string[] = []
    if (spec.title !== undefined) assignments.push(`title=${quoteBatchValue(spec.title)}`)
    if (spec.priority !== undefined) assignments.push(`priority=${String(spec.priority)}`)
    if (assignments.length > 0) {
      batch.push(`update ${spec.id} ${assignments.join(' ')}`)
    }
  }

  const updates: MetadataUpdate[] = []
  for (const spec of command.update ?? []) {
    const setMetadata = spec.setMetadata
    if (setMetadata === undefined || Object.keys(setMetadata).length === 0) continue
    updates.push(
      Object.freeze({
        id: spec.id,
        ...(spec.title === undefined ? {} : { title: spec.title }),
        ...(spec.priority === undefined ? {} : { priority: spec.priority }),
        setMetadata: Object.freeze({ ...setMetadata }),
      }),
    )
  }

  return Object.freeze({ batch: Object.freeze(batch), updates: Object.freeze(updates) })
}

/**
 * Quote a value for the `bd batch` line grammar.
 *
 * The grammar is whitespace-separated with double quotes for spaces and `\"`/`\\`
 * for escapes, so a title containing a quote or a backslash must be escaped
 * before it becomes one line — otherwise a title could change the command.
 * @param value - the raw value.
 */
export function quoteBatchValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Verify a staged mutation against the graph it produced (ADR024 step 4).
 *
 * The check is deliberately about the *outcome*, not about the commands that ran:
 * it re-reads the graph and compares the edges the mutation asked for. A mutation
 * that reported success while an edge never landed is exactly the case ADR024
 * requires to end in `PLAN_MUTATION_RECOVERY` rather than in success.
 * @param command - the mutation that was applied.
 * @param observed - edges currently in the graph.
 * @throws {MyWorkError} `PLAN_MUTATION_RECOVERY` when the outcome differs from the intent.
 */
export function verifyStagedMutation(
  command: PlanMutationCommand,
  observed: readonly TaskDependency[],
): void {
  const present = new Set(observed.map(edge => edgeKey(edge)))
  for (const edge of command.addDependencies ?? []) {
    if (!present.has(edgeKey(edge))) {
      throw new MyWorkError(
        'PLAN_MUTATION_RECOVERY',
        `dsh-mywork: staged mutation did not land the edge ${edge.from} → ${edge.to}`,
        { details: { missing: edgeKey(edge), operationId: command.meta.operationId } },
      )
    }
  }
  for (const edge of command.removeDependencies ?? []) {
    if (present.has(edgeKey(edge))) {
      throw new MyWorkError(
        'PLAN_MUTATION_RECOVERY',
        `dsh-mywork: staged mutation did not remove the edge ${edge.from} → ${edge.to}`,
        { details: { stillPresent: edgeKey(edge), operationId: command.meta.operationId } },
      )
    }
  }
}

/** Stable key of a dependency edge. */
export function edgeKey(edge: TaskDependency): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}`
}

/** Result of a cycle check performed before a mutation is applied. */
export interface CycleCheck {
  /** True when applying the mutation would close a cycle. */
  readonly cyclic: boolean
  /** The cycle path that would be created, when one was found. */
  readonly path?: readonly string[]
}

/**
 * Detect whether adding edges would close a cycle in the current graph.
 *
 * ADR024 requires a cycle to be rejected *before* anything is applied, so this
 * runs against the graph as it is plus the edges the mutation proposes. It is
 * checked here rather than left to Beads' own per-edge check because a staged
 * mutation applies edges one at a time: a cycle formed by the *combination* would
 * only appear partway through, after some edges had already landed.
 * @param existing - edges currently in the graph.
 * @param additions - edges the mutation proposes to add.
 */
export function detectCycle(
  existing: readonly TaskDependency[],
  additions: readonly TaskDependency[],
): CycleCheck {
  const adjacency = new Map<string, string[]>()
  for (const edge of [...existing, ...additions]) {
    const targets = adjacency.get(edge.from)
    if (targets === undefined) adjacency.set(edge.from, [edge.to])
    else targets.push(edge.to)
  }
  const visited = new Set<string>()
  const inStack = new Set<string>()
  let cycle: string[] | undefined

  const walk = (node: string, path: string[]): boolean => {
    if (inStack.has(node)) {
      const start = path.indexOf(node)
      cycle = start === -1 ? [...path, node] : [...path.slice(start), node]
      return true
    }
    if (visited.has(node)) return false
    visited.add(node)
    inStack.add(node)
    for (const next of adjacency.get(node) ?? []) {
      if (walk(next, [...path, node])) return true
    }
    inStack.delete(node)
    return false
  }

  for (const node of adjacency.keys()) {
    if (walk(node, [])) break
  }
  return cycle === undefined
    ? Object.freeze({ cyclic: false })
    : Object.freeze({ cyclic: true, path: Object.freeze(cycle) })
}
