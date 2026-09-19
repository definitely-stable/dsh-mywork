/**
 * The "blocker was cancelled" gate (§5.5, ADR023).
 *
 * ADR023 records the experiment that makes this gate necessary: `cancelled` and
 * `superseded` are frozen, so they leave the backend's ready set and leave their
 * dependents blocked — a cancelled blocker never releases the work that waited for
 * it. §5.5 therefore defines a gate that is open **exactly** while a frozen
 * blocker has an unsatisfied dependent, and stores only the decision taken about
 * it. Everything in this module is that derivation: pure, total, and independent
 * of a store, so the same function answers for a live graph, a snapshot, and a
 * test.
 * @module
 */

import {
  TASK_TERMINAL_STATES,
  type BlockerGateDependent,
  type BlockerGateObservation,
  type BlockerResolutionDecision,
  type BlockerResolutionGate,
  type TaskDependency,
  type TaskId,
  type TaskState,
} from '@dsh-mywork/contracts'

/** Stable identity of one gate: the workspace and the blocker it hangs on. */
export function gateIdOf(workspaceId: string, blockerTaskId: TaskId): string {
  return `${workspaceId}:${blockerTaskId}`
}

/**
 * Whether a state is frozen, so its dependents can never start on their own.
 *
 * `cancelled` and `superseded` are the two frozen side states of §18.1; ADR023
 * confirms on a live backend that they do not satisfy a dependency.
 * @param state - observed state of the blocker.
 */
export function isFrozenBlocker(state: TaskState): boolean {
  return state === 'cancelled' || state === 'superseded'
}

/** Whether a dependent still waits: a terminal dependent is no longer blocked. */
function stillWaits(state: TaskState): boolean {
  return !TASK_TERMINAL_STATES.includes(state)
}

/**
 * Read the frozen blockers out of one graph observation.
 *
 * A task is a candidate when it is frozen and some edge points at it from a
 * dependent that is not itself terminal. A blocker in `done` is **not** a
 * candidate: it satisfies the dependency, so there is nothing to decide — which is
 * exactly what §5.5 requires the derivation to answer.
 * @param edges - observed dependency edges (`from` depends on `to`).
 * @param states - observed states of the tasks involved.
 * @param workspaceId - workspace the observation belongs to.
 */
export function observeBlockerGates(
  edges: readonly TaskDependency[],
  states: Readonly<Record<TaskId, TaskState>>,
  workspaceId: string,
): readonly BlockerGateObservation[] {
  const byBlocker = new Map<TaskId, BlockerGateDependent[]>()
  for (const edge of edges) {
    const blockerState = states[edge.to]
    if (blockerState === undefined || !isFrozenBlocker(blockerState)) continue
    const dependentState = states[edge.from]
    if (dependentState === undefined) continue
    const entry: BlockerGateDependent = { taskId: edge.from, state: dependentState, edgePresent: true }
    const dependents = byBlocker.get(edge.to)
    if (dependents === undefined) byBlocker.set(edge.to, [entry])
    else dependents.push(entry)
  }
  const observations: BlockerGateObservation[] = []
  for (const [blockerTaskId, dependents] of [...byBlocker.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const blockerState = states[blockerTaskId]
    if (blockerState === undefined) continue
    observations.push(
      Object.freeze({
        workspaceId,
        blockerTaskId,
        blockerState,
        dependents: Object.freeze([...dependents].sort((left, right) => left.taskId.localeCompare(right.taskId))),
      }),
    )
  }
  return Object.freeze(observations)
}

/** Most recent decision for one gate, by decision time then id. */
function latestOf(
  decisions: readonly BlockerResolutionDecision[],
  workspaceId: string,
  blockerTaskId: TaskId,
): BlockerResolutionDecision | undefined {
  const mine = decisions.filter(
    decision => decision.workspaceId === workspaceId && decision.blockerTaskId === blockerTaskId,
  )
  if (mine.length === 0) return undefined
  return [...mine].sort((left, right) =>
    left.decidedAt === right.decidedAt
      ? left.decisionId.localeCompare(right.decisionId)
      : left.decidedAt - right.decidedAt,
  )[mine.length - 1]
}

/**
 * Derive the gates of one workspace from an observation and the recorded
 * decisions.
 *
 * The gate is open while the derived condition holds, and `awaitingDecision` is
 * true only while nobody has answered it with `keep-blocking`: `void` and
 * `supersede-dependent` remove the condition itself, so the gate disappears once
 * they are applied, while a `keep-blocking` decision leaves it open with its
 * reason on record.
 * @param observations - frozen blockers with their dependent edges.
 * @param decisions - decisions recorded for those gates.
 */
export function deriveBlockerGates(
  observations: readonly BlockerGateObservation[],
  decisions: readonly BlockerResolutionDecision[] = [],
): readonly BlockerResolutionGate[] {
  const gates: BlockerResolutionGate[] = []
  for (const observation of observations) {
    const waiting = observation.dependents.filter(
      dependent => dependent.edgePresent && stillWaits(dependent.state),
    )
    const latest = latestOf(decisions, observation.workspaceId, observation.blockerTaskId)
    const open = waiting.length > 0
    gates.push(
      Object.freeze({
        gateId: gateIdOf(observation.workspaceId, observation.blockerTaskId),
        workspaceId: observation.workspaceId,
        blockerTaskId: observation.blockerTaskId,
        dependents: Object.freeze(waiting.map(dependent => dependent.taskId)),
        open,
        awaitingDecision: open && latest?.action !== 'keep-blocking',
        ...(latest === undefined ? {} : { latestDecision: latest }),
      }),
    )
  }
  return Object.freeze(gates)
}

/**
 * Derive, then keep only the gates that are open.
 * @param observations - frozen blockers with their dependent edges.
 * @param decisions - decisions recorded for those gates.
 */
export function openBlockerGates(
  observations: readonly BlockerGateObservation[],
  decisions: readonly BlockerResolutionDecision[] = [],
): readonly BlockerResolutionGate[] {
  return Object.freeze(deriveBlockerGates(observations, decisions).filter(gate => gate.open))
}
