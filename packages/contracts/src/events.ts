/**
 * Event envelope (architecture §43). Pure transitions produce
 * {@link DomainEvent}s; the event bus stamps the envelope identity
 * (`eventId`, `sequence`, `occurredAt`) when it appends to the stream.
 * @module
 */

import type { CorrelationId, EpochMs, EventId, WorkspaceId } from './ids.ts'

/** Schema identifier carried by every MyWork event. */
export const MYWORK_EVENT_SCHEMA = 'mywork.event/v1'

/** Event types the domain currently produces. */
export type MyWorkEventType =
  /** A task moved from one state to another. */
  | 'task.state.changed'
  /** An attempt was admitted for a task (task became `assigned`). */
  | 'task.attempt.admitted'
  /** A task entered `awaiting-review`. */
  | 'task.review.requested'
  /** An attempt moved from one state to another. */
  | 'attempt.state.changed'
  /** A review moved from one state to another. */
  | 'review.state.changed'
  /** An agent instance moved from one state to another. */
  | 'agent.instance.state.changed'
  /** A workflow definition was revised (ADR020, §5.18). */
  | 'workflow.revised'
  /** A typed gate was decided by a human or an admitted policy (§5.18). */
  | 'gate.decided'
  /** A staged plan mutation was applied (ADR024). */
  | 'plan.mutation.applied'
  /** A staged plan mutation was rolled back or recovered (ADR024). */
  | 'plan.mutation.recovered'
  /** An imported legacy board was committed (ADR025). */
  | 'import.committed'
  /** Evidence was discarded and is no longer retrievable (§5.18). */
  | 'evidence.discarded'
  /** A card was moved on the board projection (ADR017). */
  | 'board.placement.changed'
  /** A board view definition was revised (ADR017). */
  | 'board.view.revised'

/** Every event type, so consumers and the outbox can enumerate them. */
export const MYWORK_EVENT_TYPES: readonly MyWorkEventType[] = Object.freeze([
  'task.state.changed',
  'task.attempt.admitted',
  'task.review.requested',
  'attempt.state.changed',
  'review.state.changed',
  'agent.instance.state.changed',
  'workflow.revised',
  'gate.decided',
  'plan.mutation.applied',
  'plan.mutation.recovered',
  'import.committed',
  'evidence.discarded',
  'board.placement.changed',
  'board.view.revised',
])

/**
 * What a pure transition emits: type plus plain payload. No clock, no id
 * generator, and no store take part, which is what keeps transitions testable
 * and replayable.
 */
export interface DomainEvent {
  /** Event type from {@link MYWORK_EVENT_TYPES}. */
  readonly type: MyWorkEventType
  /** Lossless JSON payload; never holds live objects. */
  readonly payload: Readonly<Record<string, unknown>>
}

/** Envelope appended to the MyWork event stream (§43). */
export interface EventEnvelope<P = Readonly<Record<string, unknown>>> {
  /** Always {@link MYWORK_EVENT_SCHEMA}. */
  readonly schema: typeof MYWORK_EVENT_SCHEMA
  /** Unique identifier of this event. */
  readonly eventId: EventId
  /** Monotonic position on the workspace stream. */
  readonly sequence: number
  /** Workspace the event belongs to. */
  readonly workspaceId: WorkspaceId
  /** Event type. */
  readonly type: MyWorkEventType
  /** Correlation of the workflow that caused this event (§9). */
  readonly correlationId: CorrelationId
  /** Event that directly caused this one; absent for a root event. */
  readonly causationId?: EventId
  /** Clock reading of the append, in epoch milliseconds. */
  readonly occurredAt: EpochMs
  /** Event payload. */
  readonly payload: P
}

/**
 * Envelope fields every event carries, in the order the architecture lists
 * them. It is runtime data so the event bus can validate an envelope and tests
 * can pin the shape instead of re-declaring it.
 */
export const MYWORK_ENVELOPE_FIELDS: readonly string[] = Object.freeze([
  'schema',
  'eventId',
  'sequence',
  'workspaceId',
  'type',
  'correlationId',
  'causationId',
  'occurredAt',
  'payload',
])
