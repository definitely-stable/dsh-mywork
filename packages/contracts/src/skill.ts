/**
 * Skills (architecture §21.2, §21.5, §24, §35, §36).
 *
 * §24 keeps the skill registry apart from memory: a skill is procedural
 * knowledge that was *deliberately* admitted into a registry, while a memory
 * record is what a provider recalled. Nothing in this module can turn the
 * second into the first — a skill exists because someone called
 * {@link SkillRegistryPort.admit}, and the write is authorized against the
 * `skills.registry` row of the §8 authority matrix.
 *
 * Three properties of §24 shape the types rather than the implementation:
 *
 * - **Metadata is the discoverable part** (§24, §21.2). `name`, `description`,
 *   `scope`, `version`, `trust`, `compatibility`, usage stats, the last
 *   validation, and the status are the shallow levels; the body is fetched by
 *   materialization and by nothing else.
 * - **A status is not part of the identity** (§24, §35). What a skill *is*
 *   lives in {@link SkillDefinition} and is what the revision pins; whether it
 *   is Candidate, Active, Stale or Archived lives in {@link SkillRevisionState}
 *   and changes without touching the revision a running attempt froze.
 * - **Compatibility is a declared requirement, not a guess** (§37). A skill
 *   states the adapter contract and the capabilities it needs; whether they
 *   hold is decided against the runtime facts at the moment of activation.
 * @module
 */

import type { ContextScopeRef, ContextTrustLevel } from './context.ts'
import type { EpochMs, Revision, SkillId } from './ids.ts'
import type { MyWorkErrorCode, OperationMeta } from './operation.ts'

/**
 * Lifecycle status of a skill (§24 `Candidate → Active → Stale → Archived`).
 *
 * `candidate` is where everything starts and where a patch waits; `active` is
 * the only status a context provider serves; `stale` is a skill whose scope or
 * compatibility no longer holds, kept because it is still re-validatable;
 * `archived` is terminal.
 */
export type SkillStatus =
  /** Admitted, not yet activatable. */
  | 'candidate'
  /** Validated and served to attempts. */
  | 'active'
  /** Was active; its scope, version, or compatibility no longer holds. */
  | 'stale'
  /** Retired; the registry never revives an archived skill. */
  | 'archived'

/** Every status, in the order §24's lifecycle lists them. */
export const SKILL_STATUSES: readonly SkillStatus[] = Object.freeze([
  'candidate',
  'active',
  'stale',
  'archived',
])

/**
 * Statuses a context provider serves. §24's registry holds all four; only one
 * of them is context.
 */
export const SERVED_SKILL_STATUSES: readonly SkillStatus[] = Object.freeze(['active'])

/**
 * Requirements a skill declares before it may become active (§24
 * `compatibility`, §37).
 *
 * Both fields are requirements rather than bindings: a skill says what it needs
 * and the gate decides whether the runtime provides it, so an adapter that
 * moved on makes its skills non-activatable instead of silently wrong.
 */
export interface SkillCompatibility {
  /**
   * Contract revision of the adapter kind the skill needs, e.g. `memory/v1`.
   * Absent means the skill names no adapter dependency.
   */
  readonly contractVersion?: string
  /** Adapter kind the contract version belongs to, e.g. `memory`. */
  readonly adapterKind?: string
  /** Capability flags that must be true, e.g. `{"recall": true}`. */
  readonly requires?: Readonly<Record<string, boolean>>
}

/** Fields of {@link SkillCompatibility}; the shape is closed. */
export const SKILL_COMPATIBILITY_FIELDS: readonly string[] = Object.freeze([
  'contractVersion',
  'adapterKind',
  'requires',
])

/**
 * The metadata of a skill (§24). This is everything discovery may disclose
 * before materialization, and nothing here is the body.
 *
 * `name` is a label, not an identity: two unrelated skills may legitimately be
 * called the same thing, and the registry tells them apart by
 * {@link SkillDefinition.id}. Treating a name as a key would silently turn a
 * second skill into a revision of the first.
 */
export interface SkillMetadata {
  /** Human-readable label. Not unique, and never the key of a skill. */
  readonly name: string
  /** One-line purpose: §21.2's L0 abstract. */
  readonly description: string
  /**
   * Scopes the skill applies to. An empty list means the skill is unscoped and
   * applies everywhere; a non-empty list is matched against the request.
   */
  readonly scopes: readonly ContextScopeRef[]
  /** Version of the skill's content, e.g. `1.2.0`. */
  readonly version: string
  /** Trust the skill is held at (§21.4); never inferred from its source. */
  readonly trust: ContextTrustLevel
  /** What the skill needs in order to be active. */
  readonly compatibility: SkillCompatibility
}

/** Fields of {@link SkillMetadata}; the shape is closed. */
export const SKILL_METADATA_FIELDS: readonly string[] = Object.freeze([
  'name',
  'description',
  'scopes',
  'version',
  'trust',
  'compatibility',
])

/**
 * The immutable content of one skill revision (§24, §35 `SkillRevision`).
 *
 * A definition is what a revision of a skill *is*: revising it — including its
 * `version` — is what publishes the next revision. Everything that may change
 * while an attempt runs lives in {@link SkillRevisionState} instead, so a
 * status change cannot move the revision a running attempt froze.
 */
export interface SkillDefinition extends SkillMetadata {
  /**
   * Identity of the skill, stable across its revisions. Two definitions that
   * carry the same id are revisions of one skill; two that carry different ids
   * are two skills, whatever their names say.
   *
   * It is also half of the uri a revision is addressed by
   * (`skill:<id>:<revision>`), so a colon is refused here and in `revision`.
   */
  readonly id: SkillId
  /** Immutable revision of this definition, e.g. `r4`. */
  readonly revision: string
  /** One-line pointer to when the skill applies (§21.2 L1). */
  readonly usage: string
  /** Constraints an attempt must respect (§21.2 L1). */
  readonly constraints: readonly string[]
  /** The procedural knowledge itself; served by materialization only. */
  readonly body: string
  /** Media type of {@link body}, e.g. `text/markdown`. */
  readonly mediaType: string
  /** Size estimate of the body in tokens; absent means unmeasured. */
  readonly estimatedTokens?: number
  /** Content hash the publisher states; absent means the registry computes one. */
  readonly contentHash?: string
  /** Where the skill came from: the experience, task, or author that taught it. */
  readonly provenance: readonly string[]
}

/** Fields of {@link SkillDefinition}; the shape is closed. */
export const SKILL_DEFINITION_FIELDS: readonly string[] = Object.freeze([
  ...SKILL_METADATA_FIELDS,
  'id',
  'revision',
  'usage',
  'constraints',
  'body',
  'mediaType',
  'estimatedTokens',
  'contentHash',
  'provenance',
])

/**
 * The lifecycle state of one skill revision (§24).
 *
 * It travels beside the definition rather than inside it: a transition writes a
 * new view of the same revision, so an attempt that pinned `r4` keeps `r4`
 * whether the skill is active or has since gone stale.
 */
export interface SkillRevisionState {
  /** Where the skill is in §24's lifecycle. */
  readonly status: SkillStatus
  /** Start of the validity window, epoch milliseconds. */
  readonly validFrom?: EpochMs
  /** End of the validity window, epoch milliseconds. */
  readonly validUntil?: EpochMs
  /**
   * How many times the skill was served to an attempt — that is, how many
   * discovery passes proposed it. §24's usage stats: a curator that looks for
   * skills nobody uses reads this, so it is written on the serving path and not
   * only on activation.
   *
   * It is state, not definition: counting a serve never moves
   * {@link SkillRevision.snapshotRevision}, so a pinned attempt is unaffected.
   */
  readonly servedCount: number
  /** When the revision became Active, epoch milliseconds; absent until it did. */
  readonly lastValidatedAt?: EpochMs
  /** When the status last changed, epoch milliseconds. */
  readonly statusChangedAt: EpochMs
}

/** Fields of {@link SkillRevisionState}; the shape is closed. */
export const SKILL_REVISION_STATE_FIELDS: readonly string[] = Object.freeze([
  'status',
  'validFrom',
  'validUntil',
  'servedCount',
  'lastValidatedAt',
  'statusChangedAt',
])

/** One revision of one skill: its content, its state, and its identity. */
export interface SkillRevision {
  /** Identifier of the skill this revision belongs to. */
  readonly id: SkillId
  /** The immutable content (§35 `SkillRevision`). */
  readonly definition: SkillDefinition
  /** Where the skill is in §24's lifecycle right now. */
  readonly state: SkillRevisionState
  /**
   * Numeric revision of this skill definition (§35 `skill` family): the same
   * definition keeps the number it was first admitted at, and a revised
   * definition gets the next one. It is what an attempt freezes.
   */
  readonly snapshotRevision: Revision
  /** The revision content hashed and revisioned for; the identity of the above. */
  readonly fingerprint: string
}

/** Fields of {@link SkillRevision}; the shape is closed. */
export const SKILL_REVISION_FIELDS: readonly string[] = Object.freeze([
  'id',
  'definition',
  'state',
  'snapshotRevision',
  'fingerprint',
])

/** One skill the registry holds, as a reader sees it. */
export interface SkillView {
  /** The skill revision itself. */
  readonly revision: SkillRevision
  /** Whether this is the revision the registry currently resolves for the id. */
  readonly current: boolean
}

/** Fields of {@link SkillView}; the shape is closed. */
export const SKILL_VIEW_FIELDS: readonly string[] = Object.freeze(['revision', 'current'])

/**
 * Why a skill was not served (§21.2, §24). One reason per cause, so a caller
 * can tell "not for this scope" apart from "not supported here".
 */
export type SkillRefusalReason =
  /** The skill's scopes do not intersect the requested scopes. */
  | 'scope-mismatch'
  /** The status is not one a provider serves (§24: only Active is). */
  | 'status-not-served'
  /** The validity window does not cover the request time. */
  | 'outside-validity'
  /** The contract revision the skill requires is not the one the runtime holds. */
  | 'incompatible'
  /** A capability the skill requires was not granted by the runtime. */
  | 'dependency-unmet'

/** Every refusal reason. */
export const SKILL_REFUSAL_REASONS: readonly SkillRefusalReason[] = Object.freeze([
  'scope-mismatch',
  'status-not-served',
  'outside-validity',
  'incompatible',
  'dependency-unmet',
])

/** What a provider decided about one skill of the registry. */
export interface SkillActivation {
  /** The skill revision the decision is about. */
  readonly revision: SkillRevision
  /** True when the skill is served at the requested scopes and time. */
  readonly served: boolean
  /** Why it is not served; absent when {@link served} is true. */
  readonly reason?: SkillRefusalReason
  /** One-line explanation, for diagnostics; never parsed. */
  readonly detail?: string
}

/** Fields of {@link SkillActivation}; the shape is closed. */
export const SKILL_ACTIVATION_FIELDS: readonly string[] = Object.freeze([
  'revision',
  'served',
  'reason',
  'detail',
])

/** Outcome of one discovery pass over the registry (§21.2, §21.5). */
export interface SkillDiscovery {
  /** Skills that are served for the request, in registry order. */
  readonly served: readonly SkillRevision[]
  /** Every candidate revision considered, with the decision taken about it. */
  readonly considered: readonly SkillActivation[]
  /** Time the pass ran, epoch milliseconds. */
  readonly observedAt: EpochMs
}

/** Fields of {@link SkillDiscovery}; the shape is closed. */
export const SKILL_DISCOVERY_FIELDS: readonly string[] = Object.freeze(['served', 'considered', 'observedAt'])

/**
 * What the runtime offers a compatibility check (§37 capability negotiation).
 *
 * These are observations about the runtime, not an authorization: who may write
 * the registry is decided by the actors the registry was built with, and an
 * actor named here gains no write.
 */
export interface SkillRuntimeFacts {
  /**
   * Port contract versions the runtime holds, keyed by adapter kind, e.g.
   * `{"memory": "memory/v1"}`.
   */
  readonly contractVersions?: Readonly<Record<string, string>>
  /** Capability flags the runtime was granted, e.g. `{"recall": true}`. */
  readonly capabilities?: Readonly<Record<string, boolean>>
}

/** Fields of {@link SkillRuntimeFacts}; the shape is closed. */
export const SKILL_RUNTIME_FACT_FIELDS: readonly string[] = Object.freeze([
  'contractVersions',
  'capabilities',
])

/**
 * Whether every requirement of a skill is satisfied by the runtime (§37).
 * @param compatibility - the requirements the skill declares.
 * @param facts - what the runtime offers; absent means it offers nothing.
 * @returns true when the skill may be activated against these facts.
 */
export function skillCompatibilityHolds(
  compatibility: SkillCompatibility,
  facts: SkillRuntimeFacts | undefined,
): boolean {
  if (compatibility.contractVersion !== undefined) {
    const kind = compatibility.adapterKind
    if (kind === undefined) return false
    if (facts?.contractVersions?.[kind] !== compatibility.contractVersion) return false
  } else if (compatibility.adapterKind !== undefined) {
    // A kind without a contract version names a dependency it cannot check, so
    // the requirement is refused instead of assumed satisfied.
    return false
  }
  for (const [capability, required] of Object.entries(compatibility.requires ?? {})) {
    if (!required) continue
    if (facts?.capabilities?.[capability] !== true) return false
  }
  return true
}

/**
 * Whether a skill applies to a set of requested scopes.
 *
 * An unscoped skill applies everywhere; a scoped skill applies when at least
 * one of its scopes is requested. The match is exact on both `kind` and `id`:
 * a skill for one workspace is not a skill for the workspace family.
 * @param scopes - scopes the skill declares.
 * @param requested - scopes the context request runs in.
 * @returns true when the skill applies.
 */
export function skillAppliesTo(
  scopes: readonly ContextScopeRef[],
  requested: readonly ContextScopeRef[],
): boolean {
  if (scopes.length === 0) return true
  return scopes.some(scope => requested.some(entry => entry.kind === scope.kind && entry.id === scope.id))
}

/**
 * The skill registry (§24, §36 `SkillProviderPort`).
 *
 * Reading is what a context provider needs; writing is a deliberate act that
 * names its actor, because §8 makes `skills.registry` owned by
 * `skill-registry` and nothing else. There is deliberately no method that takes
 * a memory record and returns a skill.
 */
export interface SkillRegistryPort {
  /** Every revision held, in admission order. */
  list(): readonly SkillView[]
  /** The revision currently resolved for an id, or undefined. */
  current(id: SkillId): SkillView | undefined
  /** One exact revision of one id, whether or not it is current. */
  revision(id: SkillId, revision: string): SkillView | undefined
  /**
   * Admit skill definitions into the registry as Candidate revisions.
   * @param input - the definitions, the actor performing the write, and its operation identity.
   * @returns the admitted revisions, or the refusal that stopped the call.
   */
  admit(input: SkillAdmissionInput): SkillAdmission
  /**
   * Decide and apply one §24 lifecycle transition.
   * @param input - the skill, the target status, the runtime facts, and the actor.
   * @returns the resulting view, or the refusal that stopped the transition.
   */
  transition(input: SkillTransitionInput): SkillTransition
  /**
   * Count one serving of a revision (§24 usage stats).
   *
   * The serving path calls this: a revision that was proposed as context is one
   * an attempt saw, and §24's usage stats are what a curator reads to find a
   * skill nobody uses. It changes state only — the §35 revision and the pin a
   * running attempt holds do not move.
   * @param input - the revision served, the actor, and its operation identity.
   * @returns the resulting view, or the refusal that stopped the call.
   */
  recordServe(input: SkillServeInput): SkillTransition
  /** What the runtime offers, as the registry last observed it. */
  facts(): SkillRuntimeFacts
  /** Record the runtime facts a later activation is decided against. */
  observeFacts(facts: SkillRuntimeFacts): void
}

/** Input of {@link SkillRegistryPort.recordServe}. */
export interface SkillServeInput {
  /** Skill that was served. */
  readonly id: SkillId
  /** Definition revision that was served; a caller that pinned one names it. */
  readonly revision: string
  /**
   * Operation identities performing the write; absent means the actors the
   * registry was built with. A serving path names none, because counting a
   * serve is bookkeeping the registry performs on its own behalf.
   */
  readonly actors?: readonly string[]
  /** Operation identity of the write (§9). */
  readonly meta: OperationMeta
  /** Time of the serving, epoch milliseconds. */
  readonly nowMs: EpochMs
}

/** Fields of {@link SkillServeInput}; the shape is closed. */
export const SKILL_SERVE_INPUT_FIELDS: readonly string[] = Object.freeze(['id', 'revision', 'actors', 'meta', 'nowMs'])

/** Input of {@link SkillRegistryPort.admit}. */
export interface SkillAdmissionInput {
  /** Definitions to admit; a skill already held is only admitted as a revision. */
  readonly skills: readonly SkillDefinition[]
  /**
   * Operation identities performing the write. §8 gives `skills.registry` one
   * owner, so an actor that does not hold it — a memory provider, for example —
   * is refused with `SECURITY_DENIED`.
   *
   * The set of actors allowed to write is the one the registry was built with;
   * {@link SkillRuntimeFacts} observes the runtime and authorizes nothing.
   */
  readonly actors: readonly string[]
  /** Operation identity of the write (§9). */
  readonly meta: OperationMeta
  /** Time the admission is stamped with, epoch milliseconds. Default: the registry's clock. */
  readonly nowMs?: EpochMs
}

/** Fields of {@link SkillAdmissionInput}; the shape is closed. */
export const SKILL_ADMISSION_INPUT_FIELDS: readonly string[] = Object.freeze(['skills', 'actors', 'meta', 'nowMs'])

/** Input of {@link SkillRegistryPort.transition}. */
export interface SkillTransitionInput {
  /** Skill to transition. */
  readonly id: SkillId
  /** Status to move to. */
  readonly to: SkillStatus
  /** Operation identities performing the write. */
  readonly actors: readonly string[]
  /** Operation identity of the write (§9). */
  readonly meta: OperationMeta
  /** Time of the transition, epoch milliseconds. */
  readonly nowMs: EpochMs
  /**
   * Revision the caller expects to transition. A caller that pinned a revision
   * still passes it, so a transition decided against a stale view is refused
   * with `STALE_REVISION` instead of moving a skill someone else already moved.
   */
  readonly expectedRevision?: string
  /** Validity window to publish with the transition. */
  readonly validFrom?: EpochMs
  /** End of the validity window to publish with the transition. */
  readonly validUntil?: EpochMs
}

/** Fields of {@link SkillTransitionInput}; the shape is closed. */
export const SKILL_TRANSITION_INPUT_FIELDS: readonly string[] = Object.freeze([
  'id',
  'to',
  'actors',
  'meta',
  'nowMs',
  'expectedRevision',
  'validFrom',
  'validUntil',
])

/** Why a write to the registry was refused. */
export interface SkillRefusal {
  /** Stable failure code (§42). */
  readonly ok: false
  /** Machine-readable failure code. */
  readonly code: MyWorkErrorCode
  /** Human-readable detail; never parsed by callers. */
  readonly message: string
}

/** Result of one admission. */
export type SkillAdmission =
  | { readonly ok: true; readonly admitted: readonly SkillView[] }
  | SkillRefusal

/** Result of one lifecycle transition. */
export type SkillTransition =
  | { readonly ok: true; readonly view: SkillView }
  | SkillRefusal

/** Registry of immutable revision numbers in §35's `skill` family. */
export interface SkillRevisionRegistry {
  /**
   * Numeric revision of the skill definition identified by `fingerprint`.
   * @param fingerprint - canonical identity of one skill definition.
   */
  revisionOf(fingerprint: string): Revision
  /** Number of distinct skill definitions the registry has seen. */
  size(): number
}

/**
 * The skill revisions one attempt freezes, keyed by skill id (§21.7
 * `skillRevisions`, §35 `skill` family). It is what keeps a later revision of a
 * skill from reaching a running attempt: the attempt holds the numbers it froze,
 * and re-resolving the same definitions yields the same numbers.
 */
export type SkillFrozenRevisions = Readonly<Record<SkillId, Revision>>
