/**
 * Context Fabric (architecture §21, §35, §53, §62 items 19–21).
 *
 * §21.1 makes the fabric the only owner of model-visible context: memory
 * providers, the TaskGraph, skills and plugins return *candidates*, and the
 * fabric decides what is actually materialized into a prompt. This module
 * carries the vocabulary of that decision — the candidate, the provider port,
 * the budget policy, the materialization plan, and the immutable snapshot a
 * running attempt freezes.
 *
 * Three rules of §21 shape the types rather than the implementation:
 *
 * - **Progressive disclosure is a property of the candidate** (§21.2). A level
 *   is carried by the item, so an L2 body cannot be discovered by accident:
 *   discovery answers with what the provider chose to disclose, and full content
 *   is fetched by an explicit materialization request.
 * - **The budget is derived from the real route** (§21.6). The policy holds
 *   fractions, never token counts; the numbers only exist once a model route has
 *   published a context window. A route that published none yields no budget at
 *   all instead of a guessed one.
 * - **A snapshot is an audit artifact** (§21.7, §35). It is frozen on
 *   materialization, and it carries the hashes and revisions a later
 *   re-materialization is compared against.
 *
 * Trust is the fourth rule, and it is stated here rather than left to a caller:
 * §21.1's candidates arrive from sources of different trust, and content that
 * MyWork does not trust may be shown to a model as data but never as an
 * instruction. The fabric reads exactly one level as trusted, and anything it
 * does not recognize is not it.
 * @module
 */

import type { AttemptId, EpochMs, Revision, SkillId, TaskId, WorkspaceId } from './ids.ts'
import type { ModelRoute, ModelRouteRole } from './routing.ts'
import type { MyWorkErrorCode } from './operation.ts'

/** Disclosure level of one context item (§21.2). */
export type ContextLevel =
  /** Abstract: an identity and a one-line purpose. */
  | 'L0'
  /** Overview: usage and constraints. */
  | 'L1'
  /** Full content, fetched on request. */
  | 'L2'

/** Every level, from the cheapest to the most expensive (§21.2). */
export const CONTEXT_LEVELS: readonly ContextLevel[] = Object.freeze(['L0', 'L1', 'L2'])

/** The one level whose content is fetched on request rather than discovered. */
export const CONTEXT_FULL_LEVEL: ContextLevel = 'L2'

/** Base context classes of §21.3. */
export type BaseContextClass =
  /** Policy and security rules the run must obey. */
  | 'policy'
  /** The role contract of the acting agent. */
  | 'role-contract'
  /** The contract of the task the attempt works on. */
  | 'task-contract'
  /** Where the attempt is right now. */
  | 'execution-state'
  /** The workspace canon: conventions, layout, house rules. */
  | 'workspace-canon'
  /** A skill body or its overview. */
  | 'skill'
  /** The accepted result of a dependency task. */
  | 'dependency-result'
  /** A memory record. */
  | 'memory'
  /** A reference to a DSH session. */
  | 'session-reference'
  /** Raw evidence: diffs, logs, command output. */
  | 'raw-evidence'

/** Every base class, in the order §21.3 lists them. */
export const CONTEXT_CLASSES: readonly BaseContextClass[] = Object.freeze([
  'policy',
  'role-contract',
  'task-contract',
  'execution-state',
  'workspace-canon',
  'skill',
  'dependency-result',
  'memory',
  'session-reference',
  'raw-evidence',
])

/**
 * A context class. §21.3 keeps the namespace open — a plugin-defined provider
 * names its own classes — so the base list above is what the fabric reasons
 * about and anything else travels through as an unrecognized class.
 *
 * An unrecognized class is not an error: it is context the fabric has no rule
 * for, which means it can never be mandatory and can never be an instruction.
 */
export type ContextClass = BaseContextClass | (string & {})

/**
 * Classes §21.6 counts against `mandatory.maxFraction`: the security/policy
 * section, the role contract, and the task contract — the context an attempt
 * cannot start without.
 *
 * A mandatory item is selected whatever its relevance, and mandatory context
 * that does not fit blocks the admission instead of being trimmed: an attempt
 * that silently ran without its task contract would be worse than no attempt.
 */
export const MANDATORY_CONTEXT_CLASSES: readonly BaseContextClass[] = Object.freeze([
  'policy',
  'role-contract',
  'task-contract',
])

/**
 * Classes §21.8 lets the fabric place in an instruction position: the contracts
 * that tell the agent what to do. Everything else — retrieved memory, evidence,
 * workspace canon — is dynamic context, which the fabric renders as data.
 *
 * The table coincides with {@link MANDATORY_CONTEXT_CLASSES} today. They are
 * kept apart because they answer different questions: one decides what a run
 * cannot start without, the other what may be stated as an instruction. A class
 * can belong to the first without the second, and the placement rule must not
 * inherit a budget decision.
 */
export const INSTRUCTION_CONTEXT_CLASSES: readonly BaseContextClass[] = Object.freeze([
  'policy',
  'role-contract',
  'task-contract',
])

/**
 * Where the fabric put one item in the prompt (§21.8).
 *
 * `instruction` is the position that can change what the agent does; `data` is
 * the position it reads. The distinction is what keeps untrusted content from
 * steering a run.
 */
export type ContextPlacement =
  /** Rendered as part of what the agent is told to do. */
  | 'instruction'
  /** Rendered as content the agent may read. */
  | 'data'

/** Every placement. */
export const CONTEXT_PLACEMENTS: readonly ContextPlacement[] = Object.freeze(['instruction', 'data'])

/**
 * Trust the fabric reads from a candidate.
 *
 * §21.4 types a candidate's `trust` as a string, so a provider may state
 * anything; this is the closed set the fabric understands. Exactly one level
 * authorizes an instruction position, and a value outside the set is treated as
 * {@link ContextTrustLevel} `untrusted` rather than as an unknown middle ground.
 */
export type ContextTrustLevel =
  /** MyWork authored or verified the content. */
  | 'trusted'
  /** Content from a source MyWork does not vouch for. */
  | 'untrusted'

/** Every trust level the fabric recognizes. */
export const CONTEXT_TRUST_LEVELS: readonly ContextTrustLevel[] = Object.freeze(['trusted', 'untrusted'])

/**
 * The one value of {@link ContextCandidate.trust} that authorizes an instruction
 * position. Anything else — another string, or no trust at all — is data.
 */
export const TRUSTED_CONTEXT_TRUST: string = 'trusted'

/** A scope one candidate belongs to (§21.4 `scopes`). */
export interface ContextScopeRef {
  /** Scope family, e.g. `workspace`, `task`, `team`, `session`. */
  readonly kind: string
  /** Identifier inside that family. */
  readonly id: string
}

/** Fields of {@link ContextScopeRef}; the shape is closed. */
export const CONTEXT_SCOPE_REF_FIELDS: readonly string[] = Object.freeze(['kind', 'id'])

/**
 * Where one candidate came from (§21.4 `provenance`).
 *
 * Provenance is what makes a snapshot auditable: the snapshot records which
 * source answered, about which uri, at which revision and hash, so a later
 * reader can tell a changed source from a changed selection.
 */
export interface ContextProvenanceRef {
  /** Provider or source that produced the item, e.g. `workspace-canon`. */
  readonly source: string
  /** Uri the item is addressed by. */
  readonly uri: string
  /** Revision the source published for it, when it publishes one. */
  readonly revision?: string
  /** Content hash the source published for it, when it publishes one. */
  readonly contentHash?: string
}

/** Fields of {@link ContextProvenanceRef}; the shape is closed. */
export const CONTEXT_PROVENANCE_REF_FIELDS: readonly string[] = Object.freeze([
  'source',
  'uri',
  'revision',
  'contentHash',
])

/** The body of one context item, at the level it was disclosed (§21.4 `content`). */
export interface ContextContent {
  /** Media type of {@link text}, e.g. `text/markdown`. */
  readonly mediaType: string
  /** The text itself. */
  readonly text: string
}

/** Fields of {@link ContextContent}; the shape is closed. */
export const CONTEXT_CONTENT_FIELDS: readonly string[] = Object.freeze(['mediaType', 'text'])

/**
 * One candidate returned by a context provider (§21.4).
 *
 * A candidate is a *proposal*: it states what the source has, how relevant it
 * believes it is, and how much it costs. Nothing about it decides whether it
 * reaches a prompt — that is the fabric's ranking and budget decision, and the
 * candidate has no field that could claim otherwise.
 */
export interface ContextCandidate {
  /** Stable address of the item inside its source. */
  readonly uri: string
  /** Source that returned it. */
  readonly source: string
  /** Context class (§21.3). */
  readonly kind: ContextClass
  /** Scopes the item belongs to. */
  readonly scopes: readonly ContextScopeRef[]
  /** Level this candidate was disclosed at (§21.2). */
  readonly level: ContextLevel
  /** Relevance the source claims; absent is read as no claim, never as zero-confidence. */
  readonly relevance?: number
  /** Trust the source states (§21.4); only {@link TRUSTED_CONTEXT_TRUST} authorizes an instruction. */
  readonly trust?: string
  /** Revision the source published; compared on re-materialization. */
  readonly revision?: string
  /** Content hash the source published; compared on re-materialization. */
  readonly contentHash?: string
  /** Size estimate in tokens; absent means unmeasured, while a stated zero is a measurement of an empty item. */
  readonly estimatedTokens?: number
  /** Start of the validity window, epoch milliseconds. */
  readonly validFrom?: EpochMs
  /** End of the validity window, epoch milliseconds. */
  readonly validUntil?: EpochMs
  /** Where the item came from. */
  readonly provenance: readonly ContextProvenanceRef[]
  /** Inline body, when the source discloses one at this level. */
  readonly content?: ContextContent
  /** Opaque reference a provider resolves during materialization. */
  readonly materializeRef?: string
  /** Provider-specific attributes; the fabric never reads them for a decision. */
  readonly attributes?: Readonly<Record<string, unknown>>
}

/** Fields of {@link ContextCandidate}; the shape is closed. */
export const CONTEXT_CANDIDATE_FIELDS: readonly string[] = Object.freeze([
  'uri',
  'source',
  'kind',
  'scopes',
  'level',
  'relevance',
  'trust',
  'revision',
  'contentHash',
  'estimatedTokens',
  'validFrom',
  'validUntil',
  'provenance',
  'content',
  'materializeRef',
  'attributes',
])

/** What a context provider can do (§21.5, §37). */
export interface ContextProviderCapabilities {
  /** Levels the provider can serve. A request for another level is refused. */
  readonly levels: readonly ContextLevel[]
  /**
   * Whether the provider can fetch L2 content on request. A provider that
   * cannot is still usable: its items stay at the level they were discovered at.
   */
  readonly onDemandMaterialization: boolean
  /** Context classes the provider serves; empty means it claims none. */
  readonly classes: readonly ContextClass[]
  /** Scope families the provider understands. */
  readonly scopeKinds: readonly string[]
}

/** Fields of {@link ContextProviderCapabilities}; the shape is closed. */
export const CONTEXT_PROVIDER_CAPABILITY_FIELDS: readonly string[] = Object.freeze([
  'levels',
  'onDemandMaterialization',
  'classes',
  'scopeKinds',
])

/** One discovery request (§21.5 `discover`). */
export interface ContextDiscoveryRequest {
  /** Scopes the discovery runs in; a provider answers about these only. */
  readonly scopes: readonly ContextScopeRef[]
  /** Classes to restrict the answer to; absent means every class the provider serves. */
  readonly classes?: readonly ContextClass[]
  /** Free-text query for providers that retrieve rather than enumerate. */
  readonly query?: string
  /** Token budget the caller is willing to spend; a hint, not an enforcement. */
  readonly maxTokens?: number
}

/** Fields of {@link ContextDiscoveryRequest}; the shape is closed. */
export const CONTEXT_DISCOVERY_REQUEST_FIELDS: readonly string[] = Object.freeze([
  'scopes',
  'classes',
  'query',
  'maxTokens',
])

/** One materialization request (§21.5 `materialize`). */
export interface ContextMaterializeRequest {
  /** Uri of the item to fetch. */
  readonly uri: string
  /** Level to fetch; L2 is the one that carries a full body. */
  readonly level: ContextLevel
  /** Revision the caller expects; a provider that sees another must refuse. */
  readonly expectedRevision?: string
  /** Content hash the caller expects; a provider that sees another must refuse. */
  readonly expectedContentHash?: string
}

/** Fields of {@link ContextMaterializeRequest}; the shape is closed. */
export const CONTEXT_MATERIALIZE_REQUEST_FIELDS: readonly string[] = Object.freeze([
  'uri',
  'level',
  'expectedRevision',
  'expectedContentHash',
])

/** What a provider answered to one materialization request (§21.5). */
export interface ContextMaterialized {
  /** Uri that was materialized. */
  readonly uri: string
  /** Level the body was fetched at. */
  readonly level: ContextLevel
  /** Revision of the body; absent when the source publishes none. */
  readonly revision?: string
  /** Content hash of the body; required, because a snapshot is compared against it. */
  readonly contentHash: string
  /** The body. */
  readonly content: ContextContent
  /** Size estimate in tokens; absent means unmeasured, while a stated zero is a measurement of an empty body. */
  readonly estimatedTokens?: number
  /** Where this body came from. */
  readonly provenance: readonly ContextProvenanceRef[]
}

/** Fields of {@link ContextMaterialized}; the shape is closed. */
export const CONTEXT_MATERIALIZED_FIELDS: readonly string[] = Object.freeze([
  'uri',
  'level',
  'revision',
  'contentHash',
  'content',
  'estimatedTokens',
  'provenance',
])

/**
 * The port every context source implements (§21.5, §36 `ContextProviderPort`).
 *
 * §21.1 is the reason this port is shaped as it is: a provider returns
 * candidates and bodies, and has no way to place anything in a prompt itself.
 * There is no method here that publishes context — the fabric reads, the fabric
 * decides.
 */
export interface ContextProviderPort {
  /** What this provider can serve (§37 capability negotiation). */
  capabilities(): Promise<ContextProviderCapabilities>
  /**
   * Propose candidates for one request.
   * @param request - the scopes, classes, and query to answer about.
   * @returns candidates, at whatever level the provider chose to disclose.
   */
  discover(request: ContextDiscoveryRequest): Promise<readonly ContextCandidate[]>
  /**
   * Fetch the body of one item.
   * @param request - the uri, the level, and the revision/hash the caller expects.
   * @throws when the item is unknown, the level cannot be served, or the source moved past the expected revision or hash.
   */
  materialize(request: ContextMaterializeRequest): Promise<ContextMaterialized>
}

/** Fractions §21.6's `contextPolicy` states. */
export interface ContextPolicy {
  /** Ceiling on mandatory context as a fraction of the context window. */
  readonly mandatory: { readonly maxFraction: number }
  /** Target for workspace canon as a fraction of the context window. */
  readonly workspaceCanon: { readonly targetFraction: number }
  /** Target for retrieved memory as a fraction of the context window. */
  readonly memory: { readonly targetFraction: number }
  /** Target for dependency results as a fraction of the context window. */
  readonly dependencies: { readonly targetFraction: number }
  /** Share held back for the working conversation of the attempt. */
  readonly workingReserve: { readonly fraction: number }
  /** Share held back so the model can answer at all. */
  readonly safetyReserve: { readonly fraction: number }
}

/** Fields of {@link ContextPolicy}; the shape is closed. */
export const CONTEXT_POLICY_FIELDS: readonly string[] = Object.freeze([
  'mandatory',
  'workspaceCanon',
  'memory',
  'dependencies',
  'workingReserve',
  'safetyReserve',
])

/**
 * The policy §21.6 states as its example, in its own numbers.
 *
 * The fractions are kept exactly as the architecture states them — including
 * that they add up to 1 — because the reading they encode is the architecture's:
 * the two reserves are held back first, the three targets are caps inside what
 * is left, and the mandatory ceiling is the one that blocks a run.
 */
export const DEFAULT_CONTEXT_POLICY: ContextPolicy = Object.freeze({
  mandatory: Object.freeze({ maxFraction: 0.15 }),
  workspaceCanon: Object.freeze({ targetFraction: 0.08 }),
  memory: Object.freeze({ targetFraction: 0.08 }),
  dependencies: Object.freeze({ targetFraction: 0.06 }),
  workingReserve: Object.freeze({ fraction: 0.45 }),
  safetyReserve: Object.freeze({ fraction: 0.18 }),
})

/** The optional buckets §21.6 states a target for. */
export type ContextBucket = 'workspaceCanon' | 'memory' | 'dependencies'

/** Every targeted bucket, in the order §21.6 lists them. */
export const CONTEXT_BUCKETS: readonly ContextBucket[] = Object.freeze([
  'workspaceCanon',
  'memory',
  'dependencies',
])

/** Context class each targeted bucket collects (§21.3, §21.6). */
export const CONTEXT_BUCKET_CLASSES: Readonly<Record<ContextBucket, BaseContextClass>> = Object.freeze({
  workspaceCanon: 'workspace-canon',
  memory: 'memory',
  dependencies: 'dependency-result',
})

/**
 * Token budget of one attempt, derived from the route it selected (§21.6, §53).
 *
 * Every number is a token count because the fractions have already been applied
 * to a real context window. The budget is not a guarantee: it is what the
 * fabric holds the selection to, and what it reports when it refuses.
 */
export interface ContextBudget {
  /** Context capacity the selected route published. */
  readonly contextWindow: number
  /** Tokens the fabric may fill with context at all: the window minus both reserves. */
  readonly assembly: number
  /** Ceiling on mandatory context (§21.6 `mandatory.maxFraction`). */
  readonly mandatory: number
  /** Target for the workspace-canon bucket. */
  readonly workspaceCanon: number
  /** Target for the memory bucket. */
  readonly memory: number
  /** Target for the dependency-result bucket. */
  readonly dependencies: number
  /** Tokens held back for the working conversation. */
  readonly workingReserve: number
  /** Tokens held back for the model's own answer. */
  readonly safetyReserve: number
}

/** Fields of {@link ContextBudget}; the shape is closed. */
export const CONTEXT_BUDGET_FIELDS: readonly string[] = Object.freeze([
  'contextWindow',
  'assembly',
  'mandatory',
  'workspaceCanon',
  'memory',
  'dependencies',
  'workingReserve',
  'safetyReserve',
])

/** Why one candidate did not reach the prompt. */
export type ContextDropReason =
  /** The item's validity window does not cover the materialization time. */
  | 'expired'
  /** The item carries neither a revision nor a content hash, so drift could not be detected. */
  | 'unverifiable'
  /** The item states no token estimate, so its cost cannot be held to the budget. */
  | 'tokens-unknown'
  /** Another candidate already claimed the uri; the first one in discovery order is the one that counts. */
  | 'duplicate-uri'
  /** The item's class target is already full. */
  | 'over-target'
  /** The assembly budget is already full. */
  | 'over-budget'

/** Every drop reason, so a caller can enumerate what it must report. */
export const CONTEXT_DROP_REASONS: readonly ContextDropReason[] = Object.freeze([
  'expired',
  'unverifiable',
  'tokens-unknown',
  'duplicate-uri',
  'over-target',
  'over-budget',
])

/** One candidate the fabric left out, with the reason. */
export interface ContextDrop {
  /** Uri of the dropped candidate. */
  readonly uri: string
  /** Source that proposed it. */
  readonly source: string
  /** Context class it claimed. */
  readonly kind: ContextClass
  /** Why it was left out. */
  readonly reason: ContextDropReason
  /** Tokens it would have cost, when it stated an estimate. */
  readonly estimatedTokens?: number
}

/** Fields of {@link ContextDrop}; the shape is closed. */
export const CONTEXT_DROP_FIELDS: readonly string[] = Object.freeze([
  'uri',
  'source',
  'kind',
  'reason',
  'estimatedTokens',
])

/** One candidate the fabric selected, as the plan holds it. */
export interface ContextSelection {
  /** The candidate itself, as the provider proposed it. */
  readonly candidate: ContextCandidate
  /** Rank the fabric gave it inside its class, `0` being the strongest. */
  readonly rank: number
  /** Whether the item is mandatory context. */
  readonly mandatory: boolean
  /** Bucket the item was charged to; absent for an item outside every target. */
  readonly bucket?: ContextBucket
  /** Where the fabric will place it in the prompt (§21.8). */
  readonly placement: ContextPlacement
  /**
   * True when the item would have been an instruction but was placed as data
   * because its trust does not authorize an instruction position.
   */
  readonly downgraded: boolean
  /** Tokens charged against the budget. */
  readonly tokens: number
}

/** Fields of {@link ContextSelection}; the shape is closed. */
export const CONTEXT_SELECTION_FIELDS: readonly string[] = Object.freeze([
  'candidate',
  'rank',
  'mandatory',
  'bucket',
  'placement',
  'downgraded',
  'tokens',
])

/** What the fabric decided to materialize, and what it left out (§21.6). */
export interface ContextMaterializationPlan {
  /** Budget the plan was decided against. */
  readonly budget: ContextBudget
  /** Mandatory items, in rank order. */
  readonly mandatory: readonly ContextSelection[]
  /** Optional items, in rank order. */
  readonly optional: readonly ContextSelection[]
  /** Candidates that did not reach the plan, each with its reason. */
  readonly dropped: readonly ContextDrop[]
  /** Tokens the whole plan charges. */
  readonly totalTokens: number
  /** Tokens the two reserves hold back. */
  readonly reservedTokens: number
}

/** Fields of {@link ContextMaterializationPlan}; the shape is closed. */
export const CONTEXT_MATERIALIZATION_PLAN_FIELDS: readonly string[] = Object.freeze([
  'budget',
  'mandatory',
  'optional',
  'dropped',
  'totalTokens',
  'reservedTokens',
])

/** Why an attempt's context was refused (architecture §21.6, §29). */
export type ContextRefusalReason =
  /** The selected route published no context window, so no budget exists to hold a selection to. */
  | 'context-window-undisclosed'
  /** Mandatory context exceeds its ceiling; the attempt must not start (§21.6). */
  | 'mandatory-overflow'
  /** The mandatory context alone leaves no room inside the assembly budget. */
  | 'reserves-overflow'
  /** A mandatory item states no token estimate, so the ceiling cannot be proved. */
  | 'mandatory-tokens-unknown'
  /** A mandatory item carries neither a revision nor a content hash, so it could not be verified later. */
  | 'mandatory-unverifiable'
  /** A mandatory item's validity window has closed, so the contract it carries is stale. */
  | 'mandatory-expired'
  /** An explicitly requested body could not be fetched. */
  | 'materialization-failed'
  /** An explicitly requested body turned out larger than the budget the plan was decided against. */
  | 'materialized-overflow'

/** Every refusal reason, so a caller can enumerate what it must handle. */
export const CONTEXT_REFUSAL_REASONS: readonly ContextRefusalReason[] = Object.freeze([
  'context-window-undisclosed',
  'mandatory-overflow',
  'reserves-overflow',
  'mandatory-tokens-unknown',
  'mandatory-unverifiable',
  'mandatory-expired',
  'materialization-failed',
  'materialized-overflow',
])

/**
 * Stable error code each refusal maps to.
 *
 * The mapping lives here, beside the reasons, so the attempt admission path
 * reports the same code whichever fabric call refused it.
 */
export const CONTEXT_REFUSAL_CODES: Readonly<Record<ContextRefusalReason, MyWorkErrorCode>> = Object.freeze({
  'context-window-undisclosed': 'CONTRACT_MISMATCH',
  'mandatory-overflow': 'CONTEXT_BUDGET_EXCEEDED',
  'reserves-overflow': 'CONTEXT_BUDGET_EXCEEDED',
  'mandatory-tokens-unknown': 'CONTEXT_BUDGET_EXCEEDED',
  'mandatory-unverifiable': 'CONTRACT_MISMATCH',
  'mandatory-expired': 'CONTRACT_MISMATCH',
  'materialization-failed': 'ADAPTER_UNAVAILABLE',
  'materialized-overflow': 'CONTEXT_BUDGET_EXCEEDED',
})

/** Revisions a snapshot freezes (§21.7, §35). */
export interface ContextSnapshotRevisions {
  /** Revision of the task the attempt works on. */
  readonly task: Revision
  /** Revision of the role contract. */
  readonly role: Revision
  /** Revision of the agent blueprint. */
  readonly blueprint: Revision
  /** Revision of the workflow definition. */
  readonly workflow: Revision
  /** Revision of the role strategy, when the role has one. */
  readonly roleStrategy?: Revision
  /** Revision of the configuration the attempt resolved. */
  readonly config?: Revision
  /** Revision of the memory namespace the attempt reads. */
  readonly memory?: Revision
}

/** Fields of {@link ContextSnapshotRevisions}; the shape is closed. */
export const CONTEXT_SNAPSHOT_REVISION_FIELDS: readonly string[] = Object.freeze([
  'task',
  'role',
  'blueprint',
  'workflow',
  'roleStrategy',
  'config',
  'memory',
])

/**
 * One item of a materialized snapshot (§21.7 `selectedContextItems`).
 *
 * The item carries the hash and revision the snapshot was built from, so a later
 * re-materialization of the same uri is compared against what the attempt
 * actually saw rather than against what the source says today.
 */
export interface ContextSnapshotItem {
  /** Uri of the item. */
  readonly uri: string
  /** Source that produced it. */
  readonly source: string
  /** Context class it was selected as. */
  readonly kind: ContextClass
  /** Level the item was materialized at. */
  readonly level: ContextLevel
  /** Where it sits in the prompt (§21.8). */
  readonly placement: ContextPlacement
  /** Whether it is mandatory context. */
  readonly mandatory: boolean
  /** Bucket it was charged to; absent when it belongs to no target. */
  readonly bucket?: ContextBucket
  /** Rank inside its class. */
  readonly rank: number
  /** Revision the item was materialized at; absent when the source publishes none. */
  readonly revision?: string
  /** Content hash the item was materialized at. */
  readonly contentHash?: string
  /** Tokens charged against the budget. */
  readonly tokens: number
  /** True when trust forced the item out of an instruction position. */
  readonly downgraded: boolean
  /** Body, present for items whose content the snapshot carries. */
  readonly content?: ContextContent
  /** When the body was fetched; present only for an on-demand body. */
  readonly materializedAt?: EpochMs
  /** Where the item came from. */
  readonly provenance: readonly ContextProvenanceRef[]
}

/** Fields of {@link ContextSnapshotItem}; the shape is closed. */
export const CONTEXT_SNAPSHOT_ITEM_FIELDS: readonly string[] = Object.freeze([
  'uri',
  'source',
  'kind',
  'level',
  'placement',
  'mandatory',
  'bucket',
  'rank',
  'revision',
  'contentHash',
  'tokens',
  'downgraded',
  'content',
  'materializedAt',
  'provenance',
])

/** Token accounting of one snapshot, in §53's dimensions. */
export interface ContextTokenEstimates {
  /** Tokens charged to mandatory context. */
  readonly mandatory: number
  /** Tokens charged to the workspace-canon bucket. */
  readonly workspaceCanon: number
  /** Tokens charged to the memory bucket. */
  readonly memory: number
  /** Tokens charged to the dependency-result bucket. */
  readonly dependencies: number
  /** Tokens charged to classes outside every target. */
  readonly general: number
  /** Tokens the whole snapshot charges. */
  readonly total: number
  /** Tokens held back for the working conversation. */
  readonly workingReserve: number
  /** Tokens held back for the model's own answer. */
  readonly safetyReserve: number
}

/** Fields of {@link ContextTokenEstimates}; the shape is closed. */
export const CONTEXT_TOKEN_ESTIMATE_FIELDS: readonly string[] = Object.freeze([
  'mandatory',
  'workspaceCanon',
  'memory',
  'dependencies',
  'general',
  'total',
  'workingReserve',
  'safetyReserve',
])

/**
 * The immutable context of one attempt (§21.7, §35 `ContextSnapshotRevision`).
 *
 * §21.7 calls this a critical audit artifact, and the shape says why: it fixes
 * the revisions the attempt resolved, the route it ran on, the tools it could
 * see, the selected items with their hashes, the estimates that were charged,
 * and the provenance of every item. A later reader can reconstruct what the
 * model was shown without asking any provider what it would answer today.
 *
 * The snapshot is the only input the fabric's prompt assembly accepts, which is
 * how §21.1 is enforced: nothing that is not in a frozen snapshot can reach a
 * prompt.
 */
export interface ContextSnapshot {
  /** Revision of this snapshot in the §35 `context-snapshot` family. */
  readonly revision: Revision
  /** Attempt the snapshot was built for. */
  readonly attemptId: AttemptId
  /** Task the attempt works on. */
  readonly taskId: TaskId
  /** Workspace the attempt runs in. */
  readonly workspaceId: WorkspaceId
  /** Materialization timestamp, epoch milliseconds. */
  readonly createdAt: EpochMs
  /** Revisions frozen for the attempt (§35). */
  readonly revisions: ContextSnapshotRevisions
  /** Per-skill revisions the attempt froze, keyed by skill id. */
  readonly skillRevisions: Readonly<Record<SkillId, Revision>>
  /** Route the attempt selected (§29). */
  readonly modelRoute: ModelRoute
  /** Which part of the model policy the route came from (§29). */
  readonly modelRouteRole: ModelRouteRole
  /** Context capacity the selected route published. */
  readonly contextWindow: number
  /** Tools the attempt could see (§21.8 `scoped tool provider`). */
  readonly toolSurface: readonly string[]
  /** Memory query the attempt ran, when it ran one. */
  readonly memoryQuery?: string
  /** Budget the selection was decided against. */
  readonly budget: ContextBudget
  /** Selected items, mandatory first and then by rank. */
  readonly items: readonly ContextSnapshotItem[]
  /** Content hash of every item that published one, keyed by uri. */
  readonly contentHashes: Readonly<Record<string, string>>
  /** Token accounting of the snapshot (§53). */
  readonly tokenEstimates: ContextTokenEstimates
  /** Candidates that were left out, each with its reason. */
  readonly dropped: readonly ContextDrop[]
  /** Where the whole snapshot came from: every provider that answered. */
  readonly provenance: readonly ContextProvenanceRef[]
  /** Canonical form of the snapshot's state; the identity its revision was minted for. */
  readonly fingerprint: string
}

/** Fields of {@link ContextSnapshot}; the shape is closed. */
export const CONTEXT_SNAPSHOT_FIELDS: readonly string[] = Object.freeze([
  'revision',
  'attemptId',
  'taskId',
  'workspaceId',
  'createdAt',
  'revisions',
  'skillRevisions',
  'modelRoute',
  'modelRouteRole',
  'contextWindow',
  'toolSurface',
  'memoryQuery',
  'budget',
  'items',
  'contentHashes',
  'tokenEstimates',
  'dropped',
  'provenance',
  'fingerprint',
])

/**
 * One item as a later re-materialization observed it.
 *
 * It is deliberately not a {@link ContextMaterialized}: verification compares
 * what a source says now against what the snapshot froze, and a source that
 * answers without a body still answers with the two fields that matter.
 *
 * The two identity fields distinguish three states, and the distinction is the
 * point: a **string** is what the source published, **`null`** is a source that
 * published none where the snapshot froze one — which is drift — and an
 * **absent** field is a caller that did not look, which is not evidence of
 * anything. A caller that re-materializes through {@link ContextMaterialized}
 * maps an absent `revision` or `contentHash` to `null`.
 */
export interface ContextObservation {
  /** Uri that was re-materialized. */
  readonly uri: string
  /** Revision the source published now; `null` when it published none. */
  readonly revision?: string | null
  /** Content hash the source published now; `null` when it published none. */
  readonly contentHash?: string | null
}

/** Fields of {@link ContextObservation}; the shape is closed. */
export const CONTEXT_OBSERVATION_FIELDS: readonly string[] = Object.freeze(['uri', 'revision', 'contentHash'])

/** Why one item of a frozen snapshot no longer matches its source. */
export type ContextDriftReason =
  /** The source published a different revision than the snapshot froze. */
  | 'revision-changed'
  /** The source published a different content hash than the snapshot froze. */
  | 'hash-changed'
  /** The source publishes no revision or hash where the snapshot froze one. */
  | 'unverifiable'
  /** The source did not answer about this uri at all. */
  | 'missing'

/** Every drift reason. */
export const CONTEXT_DRIFT_REASONS: readonly ContextDriftReason[] = Object.freeze([
  'revision-changed',
  'hash-changed',
  'unverifiable',
  'missing',
])

/** One item of a snapshot that drifted away from its source. */
export interface ContextDrift {
  /** Uri that drifted. */
  readonly uri: string
  /** Why it drifted. */
  readonly reason: ContextDriftReason
  /** Revision the snapshot froze; absent when it froze none. */
  readonly expectedRevision?: string
  /** Revision the source published now; absent when it published none. */
  readonly actualRevision?: string
  /** Content hash the snapshot froze; absent when it froze none. */
  readonly expectedHash?: string
  /** Content hash the source published now; absent when it published none. */
  readonly actualHash?: string
}

/** Fields of {@link ContextDrift}; the shape is closed. */
export const CONTEXT_DRIFT_FIELDS: readonly string[] = Object.freeze([
  'uri',
  'reason',
  'expectedRevision',
  'actualRevision',
  'expectedHash',
  'actualHash',
])

/** One section of the prompt the fabric assembles (§21.8). */
export interface ContextPromptSection {
  /** Placement of the section: an instruction the agent follows, or data it reads. */
  readonly placement: ContextPlacement
  /** Context class the section carries. */
  readonly kind: ContextClass
  /** Source of the section's items. */
  readonly source: string
  /** Text of the section, rendered by the fabric and by nothing else. */
  readonly text: string
  /** Tokens the section was charged. */
  readonly tokens: number
}

/** Fields of {@link ContextPromptSection}; the shape is closed. */
export const CONTEXT_PROMPT_SECTION_FIELDS: readonly string[] = Object.freeze([
  'placement',
  'kind',
  'source',
  'text',
  'tokens',
])

/**
 * The model-visible context of one attempt, assembled from a snapshot (§21.8).
 *
 * This is the only shape the fabric hands to a prompt, and it can only be built
 * from a {@link ContextSnapshot} — so §21.1 holds by construction: a provider
 * that is not in a frozen snapshot has nothing to inject.
 */
export interface ContextPrompt {
  /** Sections, instruction sections first and then data sections. */
  readonly sections: readonly ContextPromptSection[]
  /** The rendered text of every section, in section order. */
  readonly text: string
  /** Tokens the whole prompt was charged. */
  readonly tokens: number
}
