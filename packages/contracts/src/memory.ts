/**
 * Memory Fabric (architecture §21.3–§21.5, §23, §35, §49, §52; §62 items 20,
 * 24 and 25).
 *
 * §23.1 keeps memory apart from every other store: the Task Graph holds work,
 * the Session Store holds raw episodes, the Artifact Store holds evidence, the
 * Skill Registry holds procedures, and the Memory Fabric holds *retained
 * semantic experience and facts*. Nothing in this module turns one into
 * another — a memory record exists because a caller proposed it to the fabric
 * and the fabric's lifecycle admitted it, and the write is authorized against
 * the `memory.semantic` row of the §8 authority matrix, which `memory-provider`
 * owns.
 *
 * Four properties of §23 shape the types rather than the implementation:
 *
 * - **Memory is scoped, and the scope is data** (§23.2, §52). Every record
 *   carries a {@link MemoryScopeRef}; a request names the scopes it asks about,
 *   and a record in one workspace is not a record in another. `type` stays a
 *   string, so a plugin may name its own scope family.
 * - **Provenance is references, not payloads** (§23.5). A record states where it
 *   came from as {@link MemorySourceRef} — uri, revision, source type — and has
 *   no field that could carry the source's bytes. That is what keeps a raw
 *   transcript out of a prompt even when the memory was extracted from one.
 * - **Trust is declared and never inferred** (§23.6). {@link MemoryTrustClass}
 *   is stated by the writer; {@link MEMORY_TRUST_CLASSES_BY_SOURCE} records the
 *   baseline §23.6 draws, and low-trust input cannot silently rewrite a
 *   high-trust record.
 * - **The lifecycle is explicit** (§23.4). A record is a Candidate, Active,
 *   Stale, Superseded, Invalidated or Archived; only `active` is served, and a
 *   record outside its validity window is refused rather than served silently
 *   stale.
 *
 * §21.1 gives the Context Fabric the only authority over what reaches a prompt:
 * this module hands records to §21.5's `ContextProviderPort` as candidates, and
 * the fabric decides. Memory is a `data` class (§21.8) — retrieved memory is
 * context an attempt reads, never an instruction it obeys.
 * @module
 */

import type { ContextScopeRef, ContextTrustLevel } from './context.ts'
import type { EpochMs, MemoryId, Revision } from './ids.ts'
import type { MyWorkErrorCode, OperationMeta } from './operation.ts'

// ---------------------------------------------------------------------------
// §23.2 — scopes
// ---------------------------------------------------------------------------

/**
 * Scope families §23.2 lists as the baseline.
 *
 * The list is a vocabulary, not a closed set: §23.2 keeps `ScopeRef.type` a
 * string so a plugin may introduce its own family. A record in an unknown
 * family is still a record; it is simply invisible to a request that does not
 * name that family.
 */
export type BaseMemoryScopeType = 'global' | 'team' | 'workspace' | 'role' | 'agent' | 'task' | 'attempt'

/** Baseline scope families, in the order §23.2 lists them. */
export const MEMORY_SCOPE_TYPES: readonly BaseMemoryScopeType[] = Object.freeze([
  'global',
  'team',
  'workspace',
  'role',
  'agent',
  'task',
  'attempt',
])

/** A scope family; §23.2 keeps the namespace open for plugins. */
export type MemoryScopeType = BaseMemoryScopeType | (string & {})

/**
 * Where one memory record belongs (§23.2 `ScopeRef`).
 *
 * `parent` is an explicit link, not an implied hierarchy: a record scoped to a
 * task may name its workspace as parent, and then a request for that workspace
 * is in scope for the record. Nothing is derived from naming conventions —
 * matching is exact on both `type` and `id`.
 */
export interface MemoryScopeRef {
  /** Scope family, e.g. `workspace`. */
  readonly type: MemoryScopeType
  /** Identifier inside that family. */
  readonly id: string
  /** Enclosing scope, when the writer declares one. */
  readonly parent?: MemoryScopeRef
}

/** Fields of {@link MemoryScopeRef}; the shape is closed. */
export const MEMORY_SCOPE_REF_FIELDS: readonly string[] = Object.freeze(['type', 'id', 'parent'])

/**
 * Address of one scope inside its family: `type:id`.
 *
 * Two scopes with the same address are the same scope; the parent chain is
 * deliberately not part of the address, so re-parenting a record does not
 * rename it.
 * @param scope - the scope to address.
 */
export function memoryScopeKey(scope: MemoryScopeRef): string {
  return `${scope.type}:${scope.id}`
}

/**
 * The scope and its ancestors, nearest first.
 * @param scope - the scope to walk.
 */
export function memoryScopeChain(scope: MemoryScopeRef): readonly MemoryScopeRef[] {
  const chain: MemoryScopeRef[] = []
  let current: MemoryScopeRef | undefined = scope
  while (current !== undefined) {
    chain.push(current)
    current = current.parent
  }
  return Object.freeze(chain)
}

/**
 * Whether a record's scope is inside the scopes a request names (§23.2, §52).
 *
 * The match is exact on `type` and `id`. A record is in scope when it belongs
 * to one of the requested scopes or to an ancestor of the record's scope that
 * the request names — so a task-scoped record whose parent is a workspace is
 * visible to that workspace, while a record in another workspace of the same
 * family is not. Global memory is not implied: a request that wants it names
 * the scope {@link GLOBAL_MEMORY_SCOPE}.
 * @param scope - the record's scope.
 * @param requested - scopes the request runs in.
 */
export function memoryScopeWithin(scope: MemoryScopeRef, requested: readonly MemoryScopeRef[]): boolean {
  const addresses = new Set(requested.map(entry => memoryScopeKey(entry)))
  return memoryScopeChain(scope).some(entry => addresses.has(memoryScopeKey(entry)))
}

/**
 * The scope every workspace shares: §23.2's `global`, addressed by a single
 * well-known id because a request names the scopes it wants.
 */
export const GLOBAL_MEMORY_SCOPE: MemoryScopeRef = Object.freeze({ type: 'global', id: 'global' })

/**
 * One memory scope as a context scope (§21.4, §23.2).
 *
 * §21.4 calls the field `kind` and §23.2 calls it `type`; they carry the same
 * value, and this function is the only place the rename happens.
 * @param scope - the memory scope.
 */
export function contextScopeOfMemory(scope: MemoryScopeRef): ContextScopeRef {
  return Object.freeze({ kind: scope.type, id: scope.id })
}

/**
 * One context scope as a memory scope (§21.4, §23.2).
 * @param scope - the context scope.
 */
export function memoryScopeOfContext(scope: ContextScopeRef): MemoryScopeRef {
  return Object.freeze({ type: scope.kind, id: scope.id })
}

// ---------------------------------------------------------------------------
// §23.3 — kinds
// ---------------------------------------------------------------------------

/** Kinds §23.3 lists as the baseline. */
export type BaseMemoryKind =
  /** Something that is the case. */
  | 'fact'
  /** A choice that was made, and why. */
  | 'decision'
  /** A rule the work must respect. */
  | 'constraint'
  /** A stated preference. */
  | 'preference'
  /** Something that happened and what it taught. */
  | 'experience'
  /** Something seen, without a claim about why. */
  | 'observation'
  /** How a procedure is performed. */
  | 'procedure'
  /** A way work fails, kept so it is not repeated. */
  | 'failure-pattern'
  /** A pointer to something outside the record. */
  | 'reference'

/** Baseline kinds, in the order §23.3 lists them. */
export const MEMORY_KINDS: readonly BaseMemoryKind[] = Object.freeze([
  'fact',
  'decision',
  'constraint',
  'preference',
  'experience',
  'observation',
  'procedure',
  'failure-pattern',
  'reference',
])

/** A memory kind; §23.3 keeps the namespace open ("kind расширяем"). */
export type MemoryKind = BaseMemoryKind | (string & {})

// ---------------------------------------------------------------------------
// §23.5 — provenance
// ---------------------------------------------------------------------------

/** Source families a record may cite, as the baseline vocabulary. */
export type MemorySourceType = 'repository' | 'session' | 'artifact' | 'audit' | 'config' | 'document' | 'web' | (string & {})

/** Baseline source families, for diagnostics and route matching. */
export const MEMORY_SOURCE_TYPES: readonly string[] = Object.freeze([
  'repository',
  'session',
  'artifact',
  'audit',
  'config',
  'document',
  'web',
])

/**
 * One source a record was derived from (§23.5 `sources`).
 *
 * A source is a *reference*: a uri, the revision it was read at, and its family.
 * There is deliberately no `text`, `content` or `payload` field — a record made
 * from a raw session transcript cites `session:<id>#turn-4` and carries the
 * retained statement, so the transcript itself cannot travel with it into a
 * prompt.
 */
export interface MemorySourceRef {
  /** Uri of the source, e.g. `session:abc#turn-4`. */
  readonly uri: string
  /** Revision of the source that was read, when the source publishes one. */
  readonly revision?: string
  /** Family of the source, e.g. `repository`. */
  readonly type: MemorySourceType
}

/** Fields of {@link MemorySourceRef}; the shape is closed, and carries no payload. */
export const MEMORY_SOURCE_REF_FIELDS: readonly string[] = Object.freeze(['uri', 'revision', 'type'])

/**
 * Who produced a record (§23.5 `createdBy`).
 *
 * §23.6 draws trust from the *source class*, so the component that wrote a
 * record is part of its provenance rather than a diagnostic detail.
 */
export interface MemoryAuthor {
  /** Component that created the record, e.g. `role-learner`. */
  readonly component: string
  /** Run the record was created in, when the writer has one. */
  readonly run?: string
}

/** Fields of {@link MemoryAuthor}; the shape is closed. */
export const MEMORY_AUTHOR_FIELDS: readonly string[] = Object.freeze(['component', 'run'])

// ---------------------------------------------------------------------------
// §23.6 — trust
// ---------------------------------------------------------------------------

/**
 * Trust class of one record (§23.6).
 *
 * The class is stated by the writer and never inferred from the source's shape:
 * a record extracted from a repository is not trusted because it is a
 * repository record, and one extracted from tool output is not trusted because
 * the tool ran.
 */
export type MemoryTrustClass =
  /** A human decision or a deterministic CI/test result. */
  | 'very-high'
  /** An approved reviewer finding or canonical workspace configuration. */
  | 'high'
  /** A worker observation or a generated summary. */
  | 'medium'
  /** Prose, external web content, or arbitrary tool output. */
  | 'low'

/** Every trust class, from the strongest to the weakest (§23.6). */
export const MEMORY_TRUST_CLASSES: readonly MemoryTrustClass[] = Object.freeze([
  'very-high',
  'high',
  'medium',
  'low',
])

/**
 * Rank of one trust class, higher being stronger.
 *
 * The ranks are what a conflict is decided by: §23.6 keeps low-trust input from
 * changing high-trust state, so a supersede that would move a `high` record on
 * the word of a `low` one is refused rather than applied.
 */
export const MEMORY_TRUST_RANK: Readonly<Record<MemoryTrustClass, number>> = Object.freeze({
  'very-high': 4,
  high: 3,
  medium: 2,
  low: 1,
})

/**
 * The baseline §23.6 draws from source class to trust class, keyed by a source
 * class a writer may name.
 *
 * It is **reference data, not an inference rule**, and deliberately so: the
 * table is keyed by §23.6's *source class* (`tool-output`, `generated-summary`,
 * …), while a {@link MemoryProposal} carries `sources` as uri/revision/type and
 * states `trust` directly. Nothing in a proposal says which §23.6 class it came
 * from, so the fabric cannot derive one without guessing — and a guess is the
 * one thing §23.6's "низкодоверенный input не может автоматически изменить
 * Role Contract/security policy" cannot be built on. A caller that knows the
 * class looks it up here; the fabric records the trust the writer declared.
 */
export const MEMORY_TRUST_CLASSES_BY_SOURCE: Readonly<Record<string, MemoryTrustClass>> = Object.freeze({
  'human-explicit-decision': 'very-high',
  'deterministic-ci': 'very-high',
  'approved-reviewer-finding': 'high',
  'canonical-workspace-config': 'high',
  'worker-observation': 'medium',
  'generated-summary': 'medium',
  'readme-prose': 'low',
  'external-web-content': 'low',
  'tool-output': 'low',
})

/**
 * Rank of a trust class (§23.6).
 * @param trust - the class to rank.
 * @returns the rank, `0` for a class §23.6 does not declare.
 */
export function memoryTrustRank(trust: string): number {
  return MEMORY_TRUST_RANK[trust as MemoryTrustClass] ?? 0
}

/**
 * The §23.6 trust class a source class carries, if the baseline declares one.
 * @param sourceClass - the source class, e.g. `tool-output`.
 * @returns the class, or undefined when the baseline does not name it.
 */
export function memoryTrustOfSource(sourceClass: string): MemoryTrustClass | undefined {
  return MEMORY_TRUST_CLASSES_BY_SOURCE[sourceClass]
}

/**
 * How a record's trust maps onto §21.4's two context trust levels.
 *
 * §21.4's `trusted` is "MyWork authored or verified the content". §23.6's
 * `very-high` and `high` are exactly that statement — a human decision, a
 * deterministic result, an approved review finding, canonical configuration —
 * while `medium` and `low` are content MyWork does not vouch for. Everything
 * lands in `untrusted` unless it is one of the two verified classes, so a
 * record can never reach an instruction position by being nearly trusted.
 * @param trust - the record's trust class.
 */
export function contextTrustOfMemoryTrust(trust: MemoryTrustClass): ContextTrustLevel {
  return memoryTrustRank(trust) >= MEMORY_TRUST_RANK.high ? 'trusted' : 'untrusted'
}

// ---------------------------------------------------------------------------
// §23.5 — validity
// ---------------------------------------------------------------------------

/**
 * Validity window of one record (§23.5 `validity`).
 *
 * An absent bound is an open one: §23.5 writes `until: null` for a record that
 * does not expire, and a window that states no `from` is valid since it was
 * retained. A closed window is not the same as an erased record — the record
 * stays, and the fabric refuses to serve it as `outside-validity`.
 */
export interface MemoryValidity {
  /** Start of the window, epoch milliseconds; absent means "since retention". */
  readonly from?: EpochMs
  /** End of the window, epoch milliseconds; absent means open-ended. */
  readonly until?: EpochMs
}

/** Fields of {@link MemoryValidity}; the shape is closed, listed as the keys of the shape itself. */
export const MEMORY_VALIDITY_FIELDS: readonly string[] = Object.freeze(Object.keys({ from: true, until: true }))

/**
 * Whether a validity window covers a moment.
 * @param validity - the window to test.
 * @param nowMs - the moment, epoch milliseconds.
 */
export function memoryValidAt(validity: MemoryValidity, nowMs: EpochMs): boolean {
  if (validity.from !== undefined && nowMs < validity.from) return false
  if (validity.until !== undefined && nowMs > validity.until) return false
  return true
}

// ---------------------------------------------------------------------------
// §23.4 — lifecycle
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a record (§23.4).
 *
 * §23.4's chain is `Raw Evidence → Candidate Extraction → … → Active →
 * Reinforce / Update / Supersede / Invalidate → Stale → Archived`. Extraction
 * is the writer's job; from the fabric's side a record arrives as a
 * {@link MemoryStatus} `candidate`, becomes `active` once validation admits it,
 * and leaves that state when it is superseded, invalidated, goes stale, or is
 * archived.
 */
export type MemoryStatus =
  /** Extracted and not yet validated; never served. */
  | 'candidate'
  /** Validated and served, while its validity window covers the request. */
  | 'active'
  /** Was active; its validity no longer holds. Kept because it may be re-validated. */
  | 'stale'
  /** A later record replaced it. */
  | 'superseded'
  /** Withdrawn: it was wrong, poisoned, or refused by policy. */
  | 'invalidated'
  /** Retired; the fabric never serves or revives it. */
  | 'archived'

/** Every status, in the order §23.4's lifecycle reaches them. */
export const MEMORY_STATUSES: readonly MemoryStatus[] = Object.freeze([
  'candidate',
  'active',
  'stale',
  'superseded',
  'invalidated',
  'archived',
])

/**
 * Statuses a recall serves. §23.4 keeps every state in the fabric; only one of
 * them is context.
 */
export const SERVED_MEMORY_STATUSES: readonly MemoryStatus[] = Object.freeze(['active'])

/**
 * Transitions §23.4 declares, from one status to the statuses reachable from it.
 *
 * It is a table rather than a set of `if`s so that a caller rendering the
 * lifecycle and the gate that enforces it cannot disagree.
 */
export const MEMORY_TRANSITIONS: Readonly<Record<MemoryStatus, readonly MemoryStatus[]>> = Object.freeze({
  candidate: Object.freeze(['active', 'invalidated', 'archived'] as MemoryStatus[]),
  active: Object.freeze(['stale', 'superseded', 'invalidated', 'archived'] as MemoryStatus[]),
  stale: Object.freeze(['active', 'superseded', 'invalidated', 'archived'] as MemoryStatus[]),
  superseded: Object.freeze(['archived'] as MemoryStatus[]),
  invalidated: Object.freeze(['archived'] as MemoryStatus[]),
  archived: Object.freeze([] as MemoryStatus[]),
})

/**
 * Whether §23.4's lifecycle allows one move.
 * @param from - current status.
 * @param to - status the caller wants.
 */
export function isAllowedMemoryTransition(from: MemoryStatus, to: MemoryStatus): boolean {
  return (MEMORY_TRANSITIONS[from] ?? []).includes(to)
}

/** Every status one may move to from `from`, for callers that render the lifecycle. */
export function memoryTransitionTargets(from: MemoryStatus): readonly MemoryStatus[] {
  return MEMORY_TRANSITIONS[from] ?? Object.freeze([])
}

// ---------------------------------------------------------------------------
// §23.5 — the record
// ---------------------------------------------------------------------------

/**
 * One retained memory (§23.5).
 *
 * A record is immutable in its *content*: `statement`, `scope`, `kind`,
 * `sources`, `createdBy`, `trust`, `confidence` and `supersedes` are what the
 * writer proposed, and revising any of them publishes a new record that
 * supersedes this one. What moves while an attempt runs is `status`, the
 * reinforcement counter, and the validity window — which is why §35's numeric
 * `revision` is minted from the content and does not move when a record is
 * superseded.
 */
export interface MemoryRecord {
  /** Identity of the record, stable for its whole life. */
  readonly id: MemoryId
  /** The retained statement: one claim, in prose. */
  readonly statement: string
  /** Scope the record belongs to (§23.2). */
  readonly scope: MemoryScopeRef
  /** What kind of memory this is (§23.3). */
  readonly kind: MemoryKind
  /** Where it came from (§23.5); references only. */
  readonly sources: readonly MemorySourceRef[]
  /** Who wrote it (§23.5). */
  readonly createdBy: MemoryAuthor
  /** Trust class the writer declared (§23.6). */
  readonly trust: MemoryTrustClass
  /** Writer's confidence in the statement, `0..1`; absent means it stated none. */
  readonly confidence?: number
  /** Window the statement holds for (§23.5). */
  readonly validity: MemoryValidity
  /** Records this one replaces (§23.5). */
  readonly supersedes: readonly MemoryId[]
  /** Position in §23.4's lifecycle. */
  readonly status: MemoryStatus
  /** Numeric revision of §35's `memory` family, minted from the content. */
  readonly revision: Revision
  /** Deterministic hash of the content the record was minted from. */
  readonly contentHash: string
  /** Canonical identity of the content, for re-derivation. */
  readonly fingerprint: string
  /** When the record was first retained, epoch milliseconds. */
  readonly retainedAt: EpochMs
  /** When its status last changed, epoch milliseconds. */
  readonly statusChangedAt: EpochMs
  /** How many times an identical proposal reinforced it (§23.4 `Reinforce`). */
  readonly reinforcedCount: number
}

/** Fields of {@link MemoryRecord}; the shape is closed. */
export const MEMORY_RECORD_FIELDS: readonly string[] = Object.freeze([
  'id',
  'statement',
  'scope',
  'kind',
  'sources',
  'createdBy',
  'trust',
  'confidence',
  'validity',
  'supersedes',
  'status',
  'revision',
  'contentHash',
  'fingerprint',
  'retainedAt',
  'statusChangedAt',
  'reinforcedCount',
])

/**
 * What a writer proposes to retain (§23.4 `Candidate Extraction`).
 *
 * The proposal carries no id, status or revision: identity, lifecycle position
 * and the §35 number belong to the fabric, so a writer cannot publish a record
 * that skipped validation by naming its own state.
 */
export interface MemoryProposal {
  /** The statement to retain. */
  readonly statement: string
  /** Scope it belongs to (§23.2). */
  readonly scope: MemoryScopeRef
  /** What kind of memory it is (§23.3). */
  readonly kind: MemoryKind
  /** Sources it was derived from (§23.5). */
  readonly sources: readonly MemorySourceRef[]
  /** Who is proposing it (§23.5). */
  readonly createdBy: MemoryAuthor
  /** Trust class the writer declares (§23.6). */
  readonly trust: MemoryTrustClass
  /** Writer's confidence, `0..1`. */
  readonly confidence?: number
  /** Window the statement holds for. */
  readonly validity?: MemoryValidity
  /** Records this proposal replaces (§23.5). */
  readonly supersedes?: readonly MemoryId[]
  /**
   * Whether §23.4's Validation stage happens now or later.
   *
   * `immediate` admits the record as Active; `staged` admits it as a Candidate
   * that only a later validation serves. The default is `immediate`, and a
   * candidate is never recallable in either case.
   */
  readonly validation?: MemoryValidation
}

/** Fields of {@link MemoryProposal}; the shape is closed. */
export const MEMORY_PROPOSAL_FIELDS: readonly string[] = Object.freeze([
  'statement',
  'scope',
  'kind',
  'sources',
  'createdBy',
  'trust',
  'confidence',
  'validity',
  'supersedes',
  'validation',
])

/** When §23.4's Validation stage runs for a proposal. */
export type MemoryValidation =
  /** Validated as part of retention: the record is Active at once. */
  | 'immediate'
  /** Admitted as a Candidate, and served only after {@link MemoryFabricPort.validate}. */
  | 'staged'

/** Every validation mode. */
export const MEMORY_VALIDATIONS: readonly MemoryValidation[] = Object.freeze(['immediate', 'staged'])

// ---------------------------------------------------------------------------
// Serving decisions
// ---------------------------------------------------------------------------

/**
 * Why a held record was not served.
 *
 * One reason per cause, so a caller can tell "not for this scope" apart from
 * "no longer true" without reading prose.
 */
export type MemoryServingReason =
  /** The record's scope is not one the request names (§23.2, §52). */
  | 'scope-mismatch'
  /** The status is not one a recall serves (§23.4: only Active is). */
  | 'status-not-served'
  /** A later record replaced it. */
  | 'superseded'
  /** The validity window does not cover the request time (§23.5). */
  | 'outside-validity'
  /** The record's trust is below the minimum the request set. */
  | 'trust-below-minimum'
  /** The record is not of a kind the request asked for. */
  | 'kind-mismatch'
  /** The record's statement does not contain the requested query. */
  | 'query-mismatch'

/** Every serving reason. */
export const MEMORY_SERVING_REASONS: readonly MemoryServingReason[] = Object.freeze([
  'scope-mismatch',
  'status-not-served',
  'superseded',
  'outside-validity',
  'trust-below-minimum',
  'kind-mismatch',
  'query-mismatch',
])

/** What the fabric decided about one held record. */
export interface MemoryServingDecision {
  /** The record the decision is about. */
  readonly record: MemoryRecord
  /** True when the record is served for the request. */
  readonly served: boolean
  /** Why it is not served; absent when {@link served} is true. */
  readonly reason?: MemoryServingReason
  /** The record that replaced it, when the reason is `superseded`. */
  readonly replacedBy?: MemoryId
}

/** Fields of {@link MemoryServingDecision}; the shape is closed. */
export const MEMORY_SERVING_DECISION_FIELDS: readonly string[] = Object.freeze([
  'record',
  'served',
  'reason',
  'replacedBy',
])

// ---------------------------------------------------------------------------
// Refusals and diagnostics
// ---------------------------------------------------------------------------

/**
 * Why a memory call was refused.
 *
 * These are the causes that stop an operation, as opposed to
 * {@link MemoryServingReason}, which explains a record a recall left out.
 */
export type MemoryRefusalReason =
  /** The caller does not hold the authority §8 gives `memory.semantic`. */
  | 'denied'
  /** The reference names no record the fabric holds. */
  | 'invalid-ref'
  /** A supersede would let a weaker record rewrite a stronger one (§23.6). */
  | 'conflict'
  /** The write would land outside the primary writer §23.9 gives the scope. */
  | 'not-primary'
  /** No route gives the scope a primary writer (§23.9). */
  | 'scope-unrouted'
  /** The primary provider reported itself unavailable, or the call failed. */
  | 'provider-unavailable'
  /** The primary provider did not answer inside the policy's timeout. */
  | 'timeout'
  /** §23.4's transition is not one the lifecycle declares. */
  | 'invalid-transition'
  /** The provider does not implement reflection. */
  | 'reflect-unsupported'

/** Every refusal reason. */
export const MEMORY_REFUSAL_REASONS: readonly MemoryRefusalReason[] = Object.freeze([
  'denied',
  'invalid-ref',
  'conflict',
  'not-primary',
  'scope-unrouted',
  'provider-unavailable',
  'timeout',
  'invalid-transition',
  'reflect-unsupported',
])

/**
 * Stable §42 code each refusal maps to.
 *
 * The mapping lives beside the reasons so every path that refuses a memory call
 * — retention, recall, reflection, resolution — reports the same code for the
 * same cause.
 *
 * An unavailable or timed-out provider is reported as `ADAPTER_UNAVAILABLE`
 * rather than as §42's `MEMORY_BACKEND_ERROR`: the §42 vocabulary describes an
 * unreachable adapter that way, the Beads adapter and the context fabric use the
 * same code for the same cause, and `MEMORY_BACKEND_ERROR` is left for a
 * provider that answered *wrongly* — which is not a state this fabric can
 * observe from the outside.
 */
export const MEMORY_REFUSAL_CODES: Readonly<Record<MemoryRefusalReason, MyWorkErrorCode>> = Object.freeze({
  denied: 'SECURITY_DENIED',
  'invalid-ref': 'TASK_CONFLICT',
  conflict: 'TASK_CONFLICT',
  'not-primary': 'SECURITY_DENIED',
  'scope-unrouted': 'CONTRACT_MISMATCH',
  'provider-unavailable': 'ADAPTER_UNAVAILABLE',
  timeout: 'ADAPTER_UNAVAILABLE',
  'invalid-transition': 'TASK_CONFLICT',
  'reflect-unsupported': 'CAPABILITY_UNSUPPORTED',
})

/** A refused memory call. */
export interface MemoryRefusal {
  /** Always false: this is the failing half of a result. */
  readonly ok: false
  /** Stable failure code (§42). */
  readonly code: MyWorkErrorCode
  /** Machine-readable cause. */
  readonly reason: MemoryRefusalReason
  /** Human-readable detail; never parsed by callers. */
  readonly message: string
  /** Diagnostics produced by the same call, when it produced any. */
  readonly diagnostics: readonly MemoryDiagnostic[]
}

/**
 * What went wrong without stopping the call (§33, §49).
 *
 * §49 requires core execution not to stop when memory is unavailable *and the
 * policy allows a degraded mode*; a degraded answer is only acceptable if the
 * caller can see it. Every diagnostic is therefore recorded on the fabric and
 * returned with the result that produced it.
 */
export type MemoryDiagnosticCode =
  /** A route or a bound provider is missing for the scope. */
  | 'route-missing'
  /** The primary provider reported itself unavailable. */
  | 'provider-unavailable'
  /** The provider was disabled by configuration. */
  | 'disabled'
  /** The provider did not answer inside the timeout. */
  | 'timeout'
  /** The answer is degraded: the policy allowed the call to continue empty. */
  | 'degraded'
  /** A supersede was refused because it would rewrite a stronger record. */
  | 'conflict'
  /** A write would have landed outside the scope's primary writer (§23.9). */
  | 'not-primary'
  /** A record was superseded by a later one. */
  | 'superseded'
  /** A record was left out because its validity window closed. */
  | 'outside-validity'
  /** A reference named no record the fabric holds. */
  | 'invalid-ref'
  /** §23.4's transition is not one the lifecycle declares, or the record is not in the state it must be in. */
  | 'invalid-transition'
  /** Reflection was asked of a provider that does not implement it. */
  | 'reflect-unsupported'

/** Every diagnostic code. */
export const MEMORY_DIAGNOSTIC_CODES: readonly MemoryDiagnosticCode[] = Object.freeze([
  'route-missing',
  'provider-unavailable',
  'disabled',
  'timeout',
  'degraded',
  'conflict',
  'not-primary',
  'superseded',
  'outside-validity',
  'invalid-ref',
  'invalid-transition',
  'reflect-unsupported',
])

/** One diagnostic entry. */
export interface MemoryDiagnostic {
  /** What was observed. */
  readonly code: MemoryDiagnosticCode
  /** Scope the observation is about, when it is about one. */
  readonly scope?: MemoryScopeRef
  /** Provider the observation is about, when one was involved. */
  readonly provider?: string
  /** One-line explanation, for a human; never parsed. */
  readonly detail: string
  /** When it was observed, epoch milliseconds. */
  readonly at: EpochMs
}

/** Fields of {@link MemoryDiagnostic}; the shape is closed. */
export const MEMORY_DIAGNOSTIC_FIELDS: readonly string[] = Object.freeze(['code', 'scope', 'provider', 'detail', 'at'])

// ---------------------------------------------------------------------------
// §23.9 — routing and policy
// ---------------------------------------------------------------------------

/**
 * What a route matches (§23.9 `match`).
 *
 * Routing is per scope, because §23.9 gives each scope exactly one primary
 * writer: a field that is absent matches every scope, and `{ scope: 'workspace' }`
 * is the route for the workspace family. Memory kind is deliberately not part
 * of the match — one claim belongs to one scope, and a second writer for the
 * same scope by kind would be the two-writer case §23.9 forbids.
 */
export interface MemoryRouteMatch {
  /** Scope family the route applies to, e.g. `workspace`. */
  readonly scope?: MemoryScopeType
}

/** Fields of {@link MemoryRouteMatch}; the shape is closed. */
export const MEMORY_ROUTE_MATCH_FIELDS: readonly string[] = Object.freeze(['scope'])

/**
 * One route of §23.9's `memoryRoutes`.
 *
 * `primary` names the one provider that writes the scope: §23.9 allows read
 * federation later, but write ownership is unambiguous, so a retain always goes
 * to the route's primary and never to a second provider.
 */
export interface MemoryRoute {
  /** What the route matches. */
  readonly match: MemoryRouteMatch
  /** Provider id that owns writes for the matched scopes. */
  readonly primary: string
  /**
   * Whether memory on this route is optional.
   *
   * §49 lets core execution continue when memory is unavailable *and the policy
   * allows a degraded mode*: `optional: true` is that allowance for reads, and
   * the degraded answer carries a diagnostic. It never covers a write — a
   * retained record that did not land is reported as a refusal, whatever the
   * route says, because a lost write must not look like a kept one.
   */
  readonly optional: boolean
}

/** Fields of {@link MemoryRoute}; the shape is closed. */
export const MEMORY_ROUTE_FIELDS: readonly string[] = Object.freeze(['match', 'primary', 'optional'])

/** Policy the fabric applies (§23.9, §49). */
export interface MemoryPolicy {
  /** Routes, in precedence order: the first match wins. */
  readonly routes: readonly MemoryRoute[]
  /** Milliseconds one provider call may take before it is a timeout. */
  readonly timeoutMs: number
  /** How many diagnostics the fabric keeps, newest last. */
  readonly diagnosticLimit: number
}

/** Fields of {@link MemoryPolicy}; the shape is closed. */
export const MEMORY_POLICY_FIELDS: readonly string[] = Object.freeze(['routes', 'timeoutMs', 'diagnosticLimit'])

/**
 * The policy a fabric built without one applies.
 *
 * Every scope is unrouted, so the default refuses rather than remembering: a
 * deployment that has not said where memory goes has not authorized a store to
 * keep it.
 */
export const DEFAULT_MEMORY_POLICY: MemoryPolicy = Object.freeze({
  routes: Object.freeze([]),
  timeoutMs: 2_000,
  diagnosticLimit: 50,
})

/**
 * Whether one route matches a scope (§23.9).
 * @param route - the route to test.
 * @param scope - scope of the record or request.
 */
export function memoryRouteMatches(route: MemoryRoute, scope: MemoryScopeRef): boolean {
  return route.match.scope === undefined || route.match.scope === scope.type
}

// ---------------------------------------------------------------------------
// §23.8 — the provider port
// ---------------------------------------------------------------------------

/** What a memory provider can do (§23.8 `MemoryCapabilities`, §37). */
export interface MemoryCapabilities {
  /** Whether the provider implements {@link MemoryProviderPort.reflect}. */
  readonly reflect: boolean
  /** Whether the provider implements {@link MemoryProviderPort.resolve}. */
  readonly resolve: boolean
  /** Scope families the provider understands. */
  readonly scopeTypes: readonly string[]
  /** Kinds the provider stores; empty means it claims none. */
  readonly kinds: readonly MemoryKind[]
}

/** Fields of {@link MemoryCapabilities}; the shape is closed. */
export const MEMORY_CAPABILITY_FIELDS: readonly string[] = Object.freeze(['reflect', 'resolve', 'scopeTypes', 'kinds'])

/**
 * Whether a provider is usable right now (§23.8 `HealthResult`, §49).
 *
 * `available: false` is a statement the fabric acts on: with an optional route
 * the read degrades and says so, with a required route it refuses, and a write
 * always refuses.
 */
export interface MemoryHealth {
  /** True when the provider answers. */
  readonly available: boolean
  /** Machine-readable cause of unavailability, e.g. `disabled`. */
  readonly reason?: string
  /** One-line explanation, for a human; never parsed. */
  readonly detail?: string
  /** When the check ran, epoch milliseconds. */
  readonly checkedAt?: EpochMs
}

/** Fields of {@link MemoryHealth}; the shape is closed. */
export const MEMORY_HEALTH_FIELDS: readonly string[] = Object.freeze(['available', 'reason', 'detail', 'checkedAt'])

/**
 * What a provider is asked to do with one record (§23.8 `retain`).
 *
 * `create` writes a record the provider does not hold; `reinforce` records that
 * the same content was proposed again; `replace` publishes a changed *state* of
 * a record the provider already holds. A provider refuses `replace` when the
 * record's identity differs in any way — not only its statement: revising
 * content, moving the scope, lowering the trust or dropping the sources all
 * publish a new record that supersedes the old one, and never rewrite it.
 */
export type MemoryWriteMode =
  /** First write of this record. */
  | 'create'
  /** Same content proposed again. */
  | 'reinforce'
  /** Same content, new lifecycle state. */
  | 'replace'

/** Every write mode. */
export const MEMORY_WRITE_MODES: readonly MemoryWriteMode[] = Object.freeze(['create', 'reinforce', 'replace'])

/** One provider-level retention (§23.8 `MemoryRetainRequest`). */
export interface MemoryProviderRetainRequest {
  /** The record to write. */
  readonly record: MemoryRecord
  /** What the write means; the provider refuses a mode that does not fit. */
  readonly mode: MemoryWriteMode
}

/** Fields of {@link MemoryProviderRetainRequest}; the shape is closed. */
export const MEMORY_PROVIDER_RETAIN_REQUEST_FIELDS: readonly string[] = Object.freeze(['record', 'mode'])

/** What a provider answered to one retention (§23.8 `MemoryRetainResult`). */
export interface MemoryProviderRetainOutcome {
  /** The record as the provider holds it now. */
  readonly record: MemoryRecord
  /** True when this call created the record, false when it already held it. */
  readonly created: boolean
}

/** Fields of {@link MemoryProviderRetainOutcome}; the shape is closed. */
export const MEMORY_PROVIDER_RETAIN_OUTCOME_FIELDS: readonly string[] = Object.freeze(['record', 'created'])

/**
 * One provider-level retrieval (§23.8 `MemoryRecallRequest`).
 *
 * The provider answers *structurally*: which records it holds for these scopes
 * and kinds. Whether a record may be served — its status, its validity window,
 * its trust — is fabric policy, decided once for every provider instead of once
 * per adapter.
 */
export interface MemoryProviderRecallRequest {
  /** Scopes to collect records for. */
  readonly scopes: readonly MemoryScopeRef[]
  /** Identities to collect; when present the provider answers these records whatever their scope. */
  readonly ids?: readonly MemoryId[]
  /** Kinds to restrict the answer to; absent means every kind. */
  readonly kinds?: readonly MemoryKind[]
  /** Maximum records to return; absent means the provider's own bound. */
  readonly limit?: number
}

/** Fields of {@link MemoryProviderRecallRequest}; the shape is closed. */
export const MEMORY_PROVIDER_RECALL_REQUEST_FIELDS: readonly string[] = Object.freeze([
  'scopes',
  'ids',
  'kinds',
  'limit',
])

/** What a provider answered to one retrieval (§23.8 `MemoryRecallResult`). */
export interface MemoryProviderRecallOutcome {
  /** Records the provider holds for the request, in provider order. */
  readonly records: readonly MemoryRecord[]
}

/** Fields of {@link MemoryProviderRecallOutcome}; the shape is closed. */
export const MEMORY_PROVIDER_RECALL_OUTCOME_FIELDS: readonly string[] = Object.freeze(['records'])

/**
 * One provider-level reflection (§23.8 `reflect`).
 *
 * Reflection is optional by contract: a provider that does not implement it
 * says so through {@link MemoryCapabilities.reflect}, and the fabric refuses
 * rather than returning an empty digest that would read as "nothing to say".
 * What a provider produces here is *not* retained automatically — turning a
 * reflection into a new record is §25's learning path, not this port's.
 */
export interface MemoryProviderReflectRequest {
  /** Scope to reflect on. */
  readonly scope: MemoryScopeRef
  /** Kinds to restrict the reflection to; absent means every kind. */
  readonly kinds?: readonly MemoryKind[]
  /** Time of the reflection, epoch milliseconds. */
  readonly nowMs: EpochMs
}

/** Fields of {@link MemoryProviderReflectRequest}; the shape is closed. */
export const MEMORY_PROVIDER_REFLECT_REQUEST_FIELDS: readonly string[] = Object.freeze(['scope', 'kinds', 'nowMs'])

/** What a provider answered to one reflection (§23.8 `MemoryReflectResult`). */
export interface MemoryProviderReflectOutcome {
  /** Scope that was reflected on. */
  readonly scope: MemoryScopeRef
  /**
   * Records the reflection was built from: everything the provider holds for
   * the scope, with the status each of them is in. A reflection is the
   * provider's digest of its store, not context — §21.1 keeps the fabric the
   * only owner of what reaches a prompt, and a reflection reaches one only by
   * being proposed as a record of its own (§25).
   */
  readonly records: readonly MemoryRecord[]
  /** The reflection itself, in prose. */
  readonly text: string
  /** Time of the reflection, epoch milliseconds. */
  readonly observedAt: EpochMs
}

/** Fields of {@link MemoryProviderReflectOutcome}; the shape is closed. */
export const MEMORY_PROVIDER_REFLECT_OUTCOME_FIELDS: readonly string[] = Object.freeze([
  'scope',
  'records',
  'text',
  'observedAt',
])

/**
 * The port every memory backend implements (§23.8, §36 `MemoryProviderPort`).
 *
 * A provider stores and returns records; it decides nothing about what reaches
 * a prompt, and it holds no policy: routing, the lifecycle gate, deduplication
 * and trust all live in the fabric, so a second provider cannot behave
 * differently from the first by accident.
 */
export interface MemoryProviderPort {
  /** What this provider can do (§37 capability negotiation). */
  capabilities(): Promise<MemoryCapabilities>
  /**
   * Write one record.
   * @param request - the record, and what the write means.
   * @throws when the provider refuses the write, e.g. a `replace` whose content differs.
   */
  retain(request: MemoryProviderRetainRequest): Promise<MemoryProviderRetainOutcome>
  /**
   * Collect the records held for a request.
   * @param request - the scopes and kinds to collect.
   */
  recall(request: MemoryProviderRecallRequest): Promise<MemoryProviderRecallOutcome>
  /**
   * Reflect on what the provider holds for one scope, when it can.
   * @param request - the scope and kinds to reflect on.
   */
  reflect?(request: MemoryProviderReflectRequest): Promise<MemoryProviderReflectOutcome>
  /**
   * Read one record by reference, when the provider can address records directly.
   * @param ref - identity of the record.
   * @throws when the provider holds no such record.
   */
  resolve?(ref: MemoryId): Promise<MemoryRecord>
  /** Whether the provider is usable right now (§49). */
  health(): Promise<MemoryHealth>
}

/** One provider bound to the fabric, with the id §23.9's routes name (§44). */
export interface MemoryProviderBinding {
  /** Provider id, e.g. `native`. */
  readonly provider: string
  /** The port implementation. */
  readonly port: MemoryProviderPort
}

/** Fields of {@link MemoryProviderBinding}; the shape is closed. */
export const MEMORY_PROVIDER_BINDING_FIELDS: readonly string[] = Object.freeze(['provider', 'port'])

// ---------------------------------------------------------------------------
// The fabric port
// ---------------------------------------------------------------------------

/** Input of {@link MemoryFabricPort.retain}. */
export interface MemoryRetainRequest {
  /** The record being proposed. */
  readonly proposal: MemoryProposal
  /**
   * Operation identities performing the write. §8 gives `memory.semantic` one
   * owner — `memory-provider` — so an actor that does not hold that row is
   * refused with `SECURITY_DENIED`.
   */
  readonly actors?: readonly string[]
  /** Operation identity of the write (§9). */
  readonly meta: OperationMeta
  /** Time of the retention, epoch milliseconds. Default: the fabric's clock. */
  readonly nowMs?: EpochMs
}

/** Fields of {@link MemoryRetainRequest}; the shape is closed. */
export const MEMORY_RETAIN_REQUEST_FIELDS: readonly string[] = Object.freeze([
  'proposal',
  'actors',
  'meta',
  'nowMs',
])

/** What a successful retention produced. */
export interface MemoryRetainOutcome {
  /** The record as the fabric holds it. */
  readonly record: MemoryRecord
  /** False when an identical claim was already held, which is the idempotent case. */
  readonly created: boolean
  /** True when this proposal reinforced an existing record rather than creating one. */
  readonly reinforced: boolean
  /** Records this retention moved to §23.4's `superseded`. */
  readonly superseded: readonly MemoryId[]
  /** Diagnostics produced by the call. */
  readonly diagnostics: readonly MemoryDiagnostic[]
}

/** Result of one retention. */
export type MemoryRetainResult = ({ readonly ok: true } & MemoryRetainOutcome) | MemoryRefusal

/** Input of {@link MemoryFabricPort.recall}. */
export interface MemoryRecallRequest {
  /** Scopes the recall runs in; a record outside them is not served (§23.2, §52). */
  readonly scopes: readonly MemoryScopeRef[]
  /** Kinds to restrict the answer to; absent means every kind. */
  readonly kinds?: readonly MemoryKind[]
  /** Free-text query a statement must contain; absent means no filter. */
  readonly query?: string
  /** Minimum trust class a record must carry to be served. */
  readonly minTrust?: MemoryTrustClass
  /** Maximum records to serve; absent means every record that passes. */
  readonly limit?: number
  /** Time of the recall, epoch milliseconds. Default: the fabric's clock. */
  readonly nowMs?: EpochMs
}

/** Fields of {@link MemoryRecallRequest}; the shape is closed. */
export const MEMORY_RECALL_REQUEST_FIELDS: readonly string[] = Object.freeze([
  'scopes',
  'kinds',
  'query',
  'minTrust',
  'limit',
  'nowMs',
])

/** What a successful recall produced. */
export interface MemoryRecallOutcome {
  /** Records that are served, in deterministic order. */
  readonly records: readonly MemoryRecord[]
  /** Every record considered, with the decision taken about it. */
  readonly considered: readonly MemoryServingDecision[]
  /**
   * True when the answer is degraded: a provider was unavailable or timed out,
   * the route allowed it, and the caller is being told rather than being handed
   * a silent empty list.
   */
  readonly degraded: boolean
  /** Diagnostics produced by the call. */
  readonly diagnostics: readonly MemoryDiagnostic[]
  /** Time the recall ran, epoch milliseconds. */
  readonly observedAt: EpochMs
}

/** Result of one recall. */
export type MemoryRecallResult = ({ readonly ok: true } & MemoryRecallOutcome) | MemoryRefusal

/** Input of {@link MemoryFabricPort.reflect}. */
export interface MemoryReflectRequest {
  /** Scope to reflect on. */
  readonly scope: MemoryScopeRef
  /** Kinds to restrict the reflection to. */
  readonly kinds?: readonly MemoryKind[]
  /** Time of the reflection, epoch milliseconds. Default: the fabric's clock. */
  readonly nowMs?: EpochMs
}

/** Fields of {@link MemoryReflectRequest}; the shape is closed. */
export const MEMORY_REFLECT_REQUEST_FIELDS: readonly string[] = Object.freeze(['scope', 'kinds', 'nowMs'])

/** What a successful reflection produced. */
export interface MemoryReflectOutcome {
  /** The provider's reflection. */
  readonly reflection: MemoryProviderReflectOutcome
  /** Diagnostics produced by the call. */
  readonly diagnostics: readonly MemoryDiagnostic[]
}

/** Result of one reflection. */
export type MemoryReflectResult = ({ readonly ok: true } & MemoryReflectOutcome) | MemoryRefusal

/** Input of {@link MemoryFabricPort.resolve}. */
export interface MemoryResolveRequest {
  /** Identity of the record to read. */
  readonly id: MemoryId
  /** Time of the read, epoch milliseconds. Default: the fabric's clock. */
  readonly nowMs?: EpochMs
}

/** Fields of {@link MemoryResolveRequest}; the shape is closed. */
export const MEMORY_RESOLVE_REQUEST_FIELDS: readonly string[] = Object.freeze(['id', 'nowMs'])

/** What a successful resolution produced. */
export interface MemoryResolveOutcome {
  /** The record the reference names. */
  readonly record: MemoryRecord
  /** Diagnostics produced by the call. */
  readonly diagnostics: readonly MemoryDiagnostic[]
}

/** Result of one resolution. */
export type MemoryResolveResult = ({ readonly ok: true } & MemoryResolveOutcome) | MemoryRefusal

/** Input of {@link MemoryFabricPort.validate}. */
export interface MemoryValidateRequest {
  /** Identity of the Candidate to validate. */
  readonly id: MemoryId
  /** Operation identities performing the write. */
  readonly actors?: readonly string[]
  /** Operation identity of the write (§9). */
  readonly meta: OperationMeta
  /** Time of the validation, epoch milliseconds. Default: the fabric's clock. */
  readonly nowMs?: EpochMs
}

/** Fields of {@link MemoryValidateRequest}; the shape is closed. */
export const MEMORY_VALIDATE_REQUEST_FIELDS: readonly string[] = Object.freeze(['id', 'actors', 'meta', 'nowMs'])

/** Input of {@link MemoryFabricPort.transition}. */
export interface MemoryTransitionRequest {
  /** Identity of the record to move. */
  readonly id: MemoryId
  /** Status to move to. */
  readonly to: MemoryStatus
  /** Operation identities performing the write. */
  readonly actors?: readonly string[]
  /** Operation identity of the write (§9). */
  readonly meta: OperationMeta
  /** Time of the transition, epoch milliseconds. Default: the fabric's clock. */
  readonly nowMs?: EpochMs
  /** Why the record moved; recorded in diagnostics when it is one. */
  readonly reason?: string
}

/** Fields of {@link MemoryTransitionRequest}; the shape is closed. */
export const MEMORY_TRANSITION_REQUEST_FIELDS: readonly string[] = Object.freeze([
  'id',
  'to',
  'actors',
  'meta',
  'nowMs',
  'reason',
])

/** What a successful validation or transition produced. */
export interface MemoryTransitionOutcome {
  /** The record in its new state. */
  readonly record: MemoryRecord
  /** Diagnostics produced by the call. */
  readonly diagnostics: readonly MemoryDiagnostic[]
}

/** Result of one validation or transition. */
export type MemoryTransitionResult = ({ readonly ok: true } & MemoryTransitionOutcome) | MemoryRefusal

/**
 * The Memory Fabric (§23, §36).
 *
 * The fabric is the one place that decides *whether* a memory exists, which
 * provider writes it, whether a record may be served, and what a degraded
 * answer means. Providers store records; this port is the policy over them.
 */
export interface MemoryFabricPort {
  /**
   * Run §23.4's pipeline over one proposal and write the result.
   *
   * The pipeline is scope classification, source trust, deduplication, conflict
   * detection, validation — and then the write, through the route's primary.
   * Re-proposing an identical claim is idempotent: the same record is returned,
   * `created` is false, and the reinforcement is counted.
   * @param request - the proposal, its actor and its operation identity.
   */
  retain(request: MemoryRetainRequest): Promise<MemoryRetainResult>
  /**
   * Serve what the scopes hold, applying the lifecycle and validity gate.
   * @param request - the scopes, filters and time of the recall.
   */
  recall(request: MemoryRecallRequest): Promise<MemoryRecallResult>
  /**
   * Ask the route's primary to reflect on a scope (§23.8 `reflect`).
   * @param request - the scope and time of the reflection.
   */
  reflect(request: MemoryReflectRequest): Promise<MemoryReflectResult>
  /**
   * Read one record by reference.
   *
   * A reference is addressed by identity, not by scope, because §52 permits
   * artifact/reference links across workspaces: an id that came from a snapshot,
   * or one a provider was seeded with before this fabric existed, resolves here
   * — while *enumeration* (`recall`) stays scope-bound. A caller that must not
   * cross a workspace boundary reads through `recall`, not through a reference
   * it was handed.
   * @param request - the identity to read.
   */
  resolve(request: MemoryResolveRequest): Promise<MemoryResolveResult>
  /**
   * Serve a Candidate admitted with `validation: 'staged'` (§23.4 Validation).
   * @param request - the record to validate.
   */
  validate(request: MemoryValidateRequest): Promise<MemoryTransitionResult>
  /**
   * Move one record through §23.4's lifecycle.
   * @param request - the record, the target status, and the actor.
   */
  transition(request: MemoryTransitionRequest): Promise<MemoryTransitionResult>
  /** The route that owns one scope, or undefined when none matches (§23.9). */
  routeFor(scope: MemoryScopeRef, kind?: MemoryKind): MemoryRoute | undefined
  /** Every route the policy declares, in precedence order (§23.9). */
  routes(): readonly MemoryRoute[]
  /** Every diagnostic the fabric recorded, newest last. */
  diagnostics(): readonly MemoryDiagnostic[]
  /**
   * §35's numeric revision of the memory namespace these scopes read (§21.7).
   *
   * It is minted from the served records' identities, so re-resolving the same
   * memory yields the same number and any change to it yields the next one —
   * which is what a snapshot freezes. A degraded answer is reported as such
   * rather than folded into the number: a snapshot must not claim it pinned a
   * namespace it could not read.
   * @param request - the scopes to resolve the namespace of.
   */
  namespaceRevision(request: MemoryRecallRequest): Promise<MemoryNamespaceRevision>
}

/**
 * The §35 `memory` revision of one namespace (§21.7
 * `ContextSnapshotRevisions.memory`).
 */
export interface MemoryNamespaceRevision {
  /** Numeric revision of §35's `memory` family. */
  readonly revision: Revision
  /** True when a provider was unavailable or timed out and the answer is partial. */
  readonly degraded: boolean
  /** Diagnostics produced by the resolution. */
  readonly diagnostics: readonly MemoryDiagnostic[]
}

/** Fields of {@link MemoryNamespaceRevision}; the shape is closed. */
export const MEMORY_NAMESPACE_REVISION_FIELDS: readonly string[] = Object.freeze([
  'revision',
  'degraded',
  'diagnostics',
])

/**
 * Registry of immutable revision numbers in §35's `memory` family.
 *
 * The numbering lives in the fabric's process, exactly as the skill registry's
 * does: the fingerprint is the identity, and what a persisted record is
 * compared against is its fingerprint, not the number.
 */
export interface MemoryRevisionRegistry {
  /**
   * Numeric revision of the memory state identified by `fingerprint`.
   * @param fingerprint - canonical identity of one record or namespace state.
   */
  revisionOf(fingerprint: string): Revision
  /** Number of distinct memory states the registry has seen. */
  size(): number
}

/**
 * The uri scheme of one record: `memory:<id>`.
 * @param id - record identity.
 */
export function memoryUri(id: MemoryId): string {
  return `memory:${id}`
}
