/**
 * Agent instance lifecycle (architecture §13.5) as a pure state machine.
 *
 * An instance is a short-lived runtime handle: it wakes for one attempt, settles
 * it, and returns to sleep. The durable {@link AgentIdentity} is never mutated
 * by these transitions, which is what keeps a blueprint change from disturbing
 * running work (§35). The returned instance is a fully replaced value, so no
 * field is shared with the previous state.
 * @module
 */

import type {
  AgentInstance,
  AgentInstanceState,
  AttemptId,
  DomainEvent,
  EpochMs,
  OperationMeta,
  Result,
} from '@dsh-mywork/contracts'
import { MyWorkError, fail, ok } from './errors.ts'

/**
 * Allowed instance transitions (§13.5).
 *
 * - Cycle: `sleeping → waking → running → settling → sleeping`.
 * - Failure paths: every active state may fail, be revoked, or be terminated;
 *   those three states are terminal for the instance, and the next attempt
 *   mounts a new instance.
 */
export const AGENT_INSTANCE_TRANSITIONS: Readonly<Record<AgentInstanceState, readonly AgentInstanceState[]>> =
  Object.freeze({
    sleeping: ['waking', 'terminated'],
    waking: ['running', 'failed', 'revoked', 'terminated'],
    running: ['settling', 'failed', 'revoked', 'terminated'],
    settling: ['sleeping', 'failed', 'revoked', 'terminated'],
    failed: [],
    revoked: [],
    terminated: [],
  })

/** Instance states in which the instance still holds an attempt. */
export const AGENT_INSTANCE_STATES_WITH_ATTEMPT: readonly AgentInstanceState[] = Object.freeze([
  'running',
  'settling',
])

/** Command accepted by {@link transitionAgentInstance}. */
export interface AgentInstanceTransitionCommand {
  /** Target state. */
  readonly to: AgentInstanceState
  /** Attempt the instance takes over; required for `waking → running`. */
  readonly attemptId?: AttemptId | null
  /** Clock reading of the transition. */
  readonly at: EpochMs
}

/** Accepted transition: the next instance plus the events it produced. */
export interface AgentInstanceTransition {
  /** Instance after the transition. */
  readonly instance: AgentInstance
  /** State the instance was in. */
  readonly from: AgentInstanceState
  /** State the instance moved to. */
  readonly to: AgentInstanceState
  /** Events the transition produced, in order. */
  readonly events: readonly DomainEvent[]
}

/** Whether a transition between two states is allowed. */
export function canTransitionAgentInstance(from: AgentInstanceState, to: AgentInstanceState): boolean {
  return AGENT_INSTANCE_TRANSITIONS[from].includes(to)
}

/** States reachable from the given one, for diagnostics and pools. */
export function allowedAgentInstanceTransitions(from: AgentInstanceState): readonly AgentInstanceState[] {
  return AGENT_INSTANCE_TRANSITIONS[from]
}

/**
 * Move an agent instance to another state.
 *
 * The attempt binding is enforced here: an instance that runs or settles holds
 * the attempt it executes, and an instance that sleeps or terminates holds none.
 * @param instance - current instance.
 * @param command - target state, attempt binding, and clock reading.
 * @param meta - operation identity.
 */
export function transitionAgentInstance(
  instance: AgentInstance,
  command: AgentInstanceTransitionCommand,
  meta: OperationMeta,
): Result<AgentInstanceTransition> {
  if (!canTransitionAgentInstance(instance.state, command.to)) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: agent instance "${instance.id}" cannot move from "${instance.state}" to "${command.to}"`, {
        details: {
          instanceId: instance.id,
          from: instance.state,
          to: command.to,
          allowed: [...AGENT_INSTANCE_TRANSITIONS[instance.state]],
        },
      }),
      meta,
    )
  }

  const requested = normalizeAttemptId(command.attemptId)
  const attemptId = AGENT_INSTANCE_STATES_WITH_ATTEMPT.includes(command.to) ? (requested ?? instance.attemptId) : undefined

  if (AGENT_INSTANCE_STATES_WITH_ATTEMPT.includes(command.to) && attemptId === undefined) {
    return fail(
      new MyWorkError('TASK_CONFLICT', `dsh-mywork: agent instance "${instance.id}" cannot move to "${command.to}" without an attempt`, {
        details: { instanceId: instance.id, to: command.to },
      }),
      meta,
    )
  }

  const built: AgentInstance = {
    id: instance.id,
    agentId: instance.agentId,
    state: command.to,
    since: command.at,
    ...(attemptId === undefined ? {} : { attemptId }),
  }
  const next = Object.freeze(built)

  const event: DomainEvent = Object.freeze({
    type: 'agent.instance.state.changed',
    payload: Object.freeze({
      instanceId: instance.id,
      agentId: instance.agentId,
      from: instance.state,
      to: command.to,
      ...(attemptId === undefined ? {} : { attemptId }),
      at: command.at,
    }),
  })

  return ok(
    Object.freeze({ instance: next, from: instance.state, to: command.to, events: Object.freeze([event]) }),
    meta,
  )
}

/** Treat an absent, null, or blank attempt reference as "no attempt". */
function normalizeAttemptId(value: AttemptId | null | undefined): AttemptId | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value
}
