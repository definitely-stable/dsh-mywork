/**
 * Task Graph dependency edges against workspace isolation (architecture §52, §63).
 *
 * A global blueprint or role may be reused across workspaces, but a dependency
 * edge may not cross one: v0.1 forbids cross-workspace DAG edges and allows only
 * artifact/reference links, which live in the Artifact Store and are not
 * dependency edges. This module checks the `dependsOn` relation, so the artifact
 * links §52 keeps legal are untouched by it.
 *
 * The checker validates a whole graph rather than one edge, because "the
 * dependency is in another workspace" can only be decided when the dependency is
 * present: an edge into a task the caller did not provide is refused as
 * unverifiable instead of being assumed local.
 * @module
 */

import type { OperationMeta, Result, TaskId, WorkspaceId } from '@dsh-mywork/contracts'
import { MyWorkError, fail, ok } from './errors.ts'

/** One task as the edge checker needs it. */
export interface GraphNode {
  /** Task identifier. */
  readonly id: TaskId
  /** Workspace the task belongs to. */
  readonly workspaceId: WorkspaceId
  /** Tasks that must complete first. */
  readonly dependsOn: readonly TaskId[]
}

/** One accepted dependency edge. */
export interface DependencyEdge {
  /** Task that depends on another. */
  readonly taskId: TaskId
  /** Task it depends on. */
  readonly dependsOn: TaskId
  /** Workspace both tasks live in. */
  readonly workspaceId: WorkspaceId
}

/**
 * Check that every dependency edge stays inside one workspace (§52).
 *
 * @param nodes - the tasks of the graph; ids must be unique.
 * @param meta - operation identity.
 * @returns the accepted edges, in the order the nodes were given.
 * @throws {TypeError} when a node or its dependency list is malformed, or when an id repeats.
 */
export function assertWorkspaceLocalEdges(
  nodes: readonly GraphNode[],
  meta: OperationMeta,
): Result<readonly DependencyEdge[]> {
  if (!Array.isArray(nodes)) {
    throw new TypeError('dsh-mywork: graph nodes must be an array')
  }
  const workspaceOf = new Map<TaskId, WorkspaceId>()
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) {
      throw new TypeError('dsh-mywork: a graph node must be an object')
    }
    const id = requireIdentifier(node.id, 'a graph node id')
    requireIdentifier(node.workspaceId, `workspace of task "${id}"`)
    if (!Array.isArray(node.dependsOn)) {
      throw new TypeError(`dsh-mywork: dependsOn of task "${id}" must be an array`)
    }
    if (workspaceOf.has(id)) {
      throw new TypeError(`dsh-mywork: task "${id}" was provided twice`)
    }
    workspaceOf.set(id, node.workspaceId)
  }

  const edges: DependencyEdge[] = []
  for (const node of nodes) {
    const workspaceId = workspaceOf.get(node.id) as WorkspaceId
    for (const dependency of node.dependsOn) {
      const dependencyId = requireIdentifier(dependency, `a dependency of task "${node.id}"`)
      if (dependencyId === node.id) {
        return fail(
          new MyWorkError('TASK_CONFLICT', `dsh-mywork: task "${node.id}" must not depend on itself`, {
            details: { taskId: node.id, dependsOn: dependencyId, reason: 'self-dependency' },
          }),
          meta,
        )
      }
      const dependencyWorkspace = workspaceOf.get(dependencyId)
      if (dependencyWorkspace === undefined) {
        return fail(
          new MyWorkError(
            'TASK_CONFLICT',
            `dsh-mywork: task "${node.id}" depends on "${dependencyId}", which is not part of the checked graph, so the edge cannot be proven workspace-local; pass the whole graph`,
            {
              details: {
                taskId: node.id,
                dependsOn: dependencyId,
                reason: 'unverifiable-edge',
                hint: 'the checker decides workspace locality only for dependencies present in the same call (§52)',
              },
            },
          ),
          meta,
        )
      }
      if (dependencyWorkspace !== workspaceId) {
        return fail(
          new MyWorkError(
            'TASK_CONFLICT',
            `dsh-mywork: task "${node.id}" in workspace "${workspaceId}" may not depend on "${dependencyId}" in workspace "${dependencyWorkspace}"; cross-workspace edges are forbidden (§52)`,
            {
              details: {
                taskId: node.id,
                dependsOn: dependencyId,
                workspaceId,
                dependencyWorkspace,
                reason: 'cross-workspace-edge',
              },
            },
          ),
          meta,
        )
      }
      edges.push(Object.freeze({ taskId: node.id, dependsOn: dependencyId, workspaceId }))
    }
  }
  return ok(Object.freeze(edges), meta)
}

/** Minimal edge shape the cycle finder reads. */
export interface CycleEdge {
  /** Task that depends on another. */
  readonly from: string
  /** Task it waits for. */
  readonly to: string
}

/**
 * Find a dependency cycle in one set of edges.
 *
 * ADR024 requires a cycle to be rejected *before* anything is applied, and a
 * cyclic graph to be detected again afterwards: the two checks are the same
 * algorithm over different edge sets, so it lives here once — the adapter's
 * pre-write refusal and the planner's integrity verification both call it.
 *
 * The walk is deterministic: nodes are visited in first-appearance order, and the
 * returned path starts and ends with the repeated node (`['A','B','A']`), so two
 * runs over the same edges answer with the same path and an operator can read it.
 * @param edges - edges to check; duplicates are harmless.
 * @returns the cycle path, or `undefined` when the graph is acyclic.
 */
export function findDependencyCycle(edges: readonly CycleEdge[]): readonly string[] | undefined {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const targets = adjacency.get(edge.from)
    if (targets === undefined) adjacency.set(edge.from, [edge.to])
    else targets.push(edge.to)
  }
  const visited = new Set<string>()
  const inStack = new Set<string>()
  let cycle: readonly string[] | undefined

  const walk = (node: string, path: readonly string[]): boolean => {
    if (inStack.has(node)) {
      const start = path.indexOf(node)
      cycle = start === -1 ? Object.freeze([...path, node]) : Object.freeze([...path.slice(start), node])
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
  return cycle
}

/** Reject a missing or blank identifier. */
function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`dsh-mywork: ${field} must be a non-empty string`)
  }
  return value
}
