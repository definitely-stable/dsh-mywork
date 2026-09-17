/**
 * Data authority matrix (architecture §8). Exactly one store owns each domain;
 * every other store, and the Task Board projection in particular, is a reader.
 * The table is pure data: `@dsh-mywork/core` performs the lookups and the
 * enforcement, so this package stays free of runtime logic.
 * @module
 */

/** Stores that can own a domain. */
export type AuthorityOwner =
  /** Beads/Task Graph: descriptions, dependencies, readiness, priority, completion. */
  | 'task-graph'
  /** Task Board: UI layout/order projection only. */
  | 'task-board'
  /** MyWork DB: attempts, ids, git refs, reviews, approvals. */
  | 'mywork-db'
  /** Lease store: lease and fence tokens. */
  | 'lease-store'
  /** Artifact store: build/test/log evidence and review artifacts. */
  | 'artifact-store'
  /** DSH session store: raw session events. */
  | 'dsh-session-store'
  /** Memory provider: long-term semantic memory. */
  | 'memory-provider'
  /** Skill registry. */
  | 'skill-registry'
  /** MyWork registry: role and blueprint revisions. */
  | 'mywork-registry'
  /** MyWork audit store. */
  | 'mywork-audit'

/** Domains the matrix describes. */
export type AuthorityDomain =
  /** Goal/Epic/Task description. */
  | 'task.description'
  /** Task dependencies. */
  | 'task.dependencies'
  /** Ready/Blocked semantic state. */
  | 'task.readiness'
  /** Task priority. */
  | 'task.priority'
  /** Role requirement stored as task metadata. */
  | 'task.role-requirement'
  /** Task UI layout/order. */
  | 'task.board-placement'
  /** Current execution attempt. */
  | 'attempt.current'
  /** Lease and fence token. */
  | 'lease.fence'
  /** Agent and session identifiers. */
  | 'agent.session-ids'
  /** Worktree, base SHA, and head SHA. */
  | 'workspace.git-refs'
  /** Review attempt. */
  | 'review.attempt'
  /** Review findings. */
  | 'review.findings'
  /** Human approval. */
  | 'approval.human'
  /** Final graph completion. */
  | 'task.completion'
  /** Raw session events. */
  | 'session.events'
  /** Build/test/log evidence. */
  | 'evidence.build'
  /** Long-term semantic memory. */
  | 'memory.semantic'
  /** Skills. */
  | 'skills.registry'
  /** Role and blueprint revisions. */
  | 'registry.revisions'
  /** Audit. */
  | 'audit.log'

/** One row of the matrix. */
export interface AuthorityRow {
  /** Domain the row describes. */
  readonly domain: AuthorityDomain
  /**
   * Owners in precedence order. The first entry is the writer; further entries
   * share the write (for example MyWork DB and the lease store for lease/fence).
   * A row always has at least one owner.
   */
  readonly owners: readonly [AuthorityOwner, ...AuthorityOwner[]]
  /**
   * True when the owner is a control surface over another store's data rather
   * than a competing authority (§8: the Task Board is a projection).
   */
  readonly projection: boolean
}

/**
 * The matrix itself, keyed by domain. Rows are immutable by contract: nothing
 * in MyWork rewrites this table at runtime.
 */
export const AUTHORITY_MATRIX: Readonly<Record<AuthorityDomain, AuthorityRow>> = Object.freeze({
  'task.description': { domain: 'task.description', owners: ['task-graph'], projection: false },
  'task.dependencies': { domain: 'task.dependencies', owners: ['task-graph'], projection: false },
  'task.readiness': { domain: 'task.readiness', owners: ['task-graph'], projection: false },
  'task.priority': { domain: 'task.priority', owners: ['task-graph'], projection: false },
  'task.role-requirement': { domain: 'task.role-requirement', owners: ['task-graph'], projection: false },
  'task.board-placement': { domain: 'task.board-placement', owners: ['task-board'], projection: true },
  'attempt.current': { domain: 'attempt.current', owners: ['mywork-db'], projection: false },
  'lease.fence': { domain: 'lease.fence', owners: ['mywork-db', 'lease-store'], projection: false },
  'agent.session-ids': { domain: 'agent.session-ids', owners: ['mywork-db'], projection: false },
  'workspace.git-refs': { domain: 'workspace.git-refs', owners: ['mywork-db'], projection: false },
  'review.attempt': { domain: 'review.attempt', owners: ['mywork-db'], projection: false },
  'review.findings': { domain: 'review.findings', owners: ['mywork-db', 'artifact-store'], projection: false },
  'approval.human': { domain: 'approval.human', owners: ['mywork-db', 'mywork-audit'], projection: false },
  'task.completion': { domain: 'task.completion', owners: ['task-graph'], projection: false },
  'session.events': { domain: 'session.events', owners: ['dsh-session-store'], projection: false },
  'evidence.build': { domain: 'evidence.build', owners: ['artifact-store'], projection: false },
  'memory.semantic': { domain: 'memory.semantic', owners: ['memory-provider'], projection: false },
  'skills.registry': { domain: 'skills.registry', owners: ['skill-registry'], projection: false },
  'registry.revisions': { domain: 'registry.revisions', owners: ['mywork-registry'], projection: false },
  'audit.log': { domain: 'audit.log', owners: ['mywork-audit'], projection: false },
})

/** Every domain, in matrix order. */
export const AUTHORITY_DOMAINS: readonly AuthorityDomain[] = Object.freeze(
  Object.keys(AUTHORITY_MATRIX) as AuthorityDomain[],
)
