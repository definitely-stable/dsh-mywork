/**
 * Immutable revisions (architecture §35). Every revision is a monotonic
 * counter: a running attempt freezes the revisions it resolved, and a later
 * change creates a new revision instead of mutating the frozen one.
 * @module
 */

import type { Revision } from './ids.ts'

/** Revision families the architecture makes immutable. */
export type RevisionKind =
  /** Workflow definitions. */
  | 'workflow'
  /** Role contract revisions (not optimizable, §13.2). */
  | 'role'
  /** Role strategy revisions (evolvable by the optimizer, §13.2). */
  | 'role-strategy'
  /** Skill revisions. */
  | 'skill'
  /** Agent blueprint revisions. */
  | 'agent-blueprint'
  /** Context snapshot revisions. */
  | 'context-snapshot'
  /** Configuration revisions. */
  | 'config'
  /** Memory revisions. */
  | 'memory'
  /** Board view definition revisions (ADR017). */
  | 'board-view'

/** Every revision family, in the order the architecture lists them. */
export const REVISION_KINDS: readonly RevisionKind[] = Object.freeze([
  'workflow',
  'role',
  'role-strategy',
  'skill',
  'agent-blueprint',
  'context-snapshot',
  'config',
  'memory',
  'board-view',
])

/** One revision of one immutable revision family. */
export interface RevisionRef {
  /** Revision family. */
  readonly kind: RevisionKind
  /** Monotonic counter inside that family. */
  readonly revision: Revision
}

/**
 * Revisions resolved when an attempt was admitted and frozen for its whole
 * lifetime (§35). A family the attempt does not use is simply absent, so the
 * resolution decides the set instead of this contract inventing one.
 */
export type FrozenRevisions = Readonly<Partial<Record<RevisionKind, Revision>>>
