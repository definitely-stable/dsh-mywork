/**
 * Context Fabric policy (architecture §21, §29, §35, §53, §62 items 19–21).
 *
 * The fabric is the only owner of model-visible context (§21.1), and this
 * module is the whole of its decision: which candidates a set of providers
 * offered, which of them fit a budget derived from the real model route, where
 * each selected item may be placed in a prompt, and what immutable snapshot the
 * attempt freezes.
 *
 * The pipeline is one direction, and no step can be skipped by a caller:
 *
 * ```text
 * discover → rank / budget → materialize → verify
 * ```
 *
 * Four rules are load-bearing:
 *
 * - **Nothing is admitted without a measured window.** A route that published no
 *   context window yields a refusal, not a default (§21.6, and the same rule
 *   §30 already follows for an unmeasured amount).
 * - **Mandatory context is never trimmed.** It is selected whatever its
 *   relevance, and when it does not fit the attempt is refused with
 *   `CONTEXT_BUDGET_EXCEEDED` rather than started short of its contract.
 * - **Trust decides placement, not selection.** An item whose trust the fabric
 *   does not recognize is still shown — as data. It can never be an instruction.
 * - **A snapshot is frozen and compared, never recomputed.** Verification reads
 *   the revisions and hashes the attempt actually saw.
 *
 * Everything here is pure except the two provider-driving functions, and they
 * touch only the `ContextProviderPort` the caller hands them.
 * @module
 */

import {
  CONTEXT_BUCKET_CLASSES,
  CONTEXT_BUCKETS,
  CONTEXT_CLASSES,
  CONTEXT_FULL_LEVEL,
  CONTEXT_LEVELS,
  CONTEXT_REFUSAL_CODES,
  DEFAULT_CONTEXT_POLICY,
  INSTRUCTION_CONTEXT_CLASSES,
  MANDATORY_CONTEXT_CLASSES,
  TRUSTED_CONTEXT_TRUST,
  type AttemptId,
  type BaseContextClass,
  type ContextBudget,
  type ContextBucket,
  type ContextCandidate,
  type ContextClass,
  type ContextContent,
  type ContextDiscoveryRequest,
  type ContextDrift,
  type ContextDrop,
  type ContextMaterialized,
  type ContextMaterializationPlan,
  type ContextObservation,
  type ContextPlacement,
  type ContextPolicy,
  type ContextPrompt,
  type ContextPromptSection,
  type ContextProviderCapabilities,
  type ContextProviderPort,
  type ContextProvenanceRef,
  type ContextRefusalReason,
  type ContextSelection,
  type ContextSnapshot,
  type ContextSnapshotItem,
  type ContextSnapshotRevisions,
  type ContextTokenEstimates,
  type EpochMs,
  type ModelRouteProvenance,
  type MyWorkErrorCode,
  type Revision,
  type SkillId,
  type TaskId,
  type WorkspaceId,
} from '@dsh-mywork/contracts'
import { canonicalForm } from './config.ts'
import { isCounter } from './guards.ts'

/**
 * Mints the revision of a materialized snapshot (§35 `context-snapshot`).
 *
 * The fingerprint is the identity, exactly as it is for a resolved
 * configuration state: materializing the same context twice keeps the revision
 * the first materialization minted, and a changed context gets the next number.
 * The counter lives in the process, so it is not durable; the fingerprint is
 * what a stored snapshot is compared against.
 */
export interface ContextSnapshotRevisionRegistry {
  /**
   * Revision of the snapshot state identified by `fingerprint`.
   * @param fingerprint - canonical form produced by the materializer.
   */
  revisionOf(fingerprint: string): Revision
  /** Number of distinct snapshot states this registry has seen. */
  size(): number
}

/**
 * Create a snapshot revision registry.
 * @returns a registry whose numbering starts at 1.
 */
export function createContextSnapshotRevisionRegistry(): ContextSnapshotRevisionRegistry {
  const minted = new Map<string, Revision>()
  return Object.freeze({
    revisionOf(fingerprint: string): Revision {
      requireIdentifier(fingerprint, 'a context snapshot fingerprint')
      const existing = minted.get(fingerprint)
      if (existing !== undefined) return existing
      const revision = minted.size + 1
      minted.set(fingerprint, revision)
      return revision
    },
    size: (): number => minted.size,
  })
}

/** Input of {@link resolveContextBudget}. */
export interface ContextBudgetInput {
  /** Policy whose fractions are applied. */
  readonly policy?: ContextPolicy
  /** Context capacity the selected route published; absent means it published none. */
  readonly contextWindow?: number
}

/**
 * Turn §21.6's fractions into token counts for one route (§21.6, §53).
 *
 * The two reserves are held back first, because they are what the attempt needs
 * in order to work and to answer at all; everything else is a cap inside what
 * remains. The result is not a guarantee — {@link decideContextAdmission} is
 * where a selection is actually held to it.
 * @param input - the policy and the window the selected route published.
 * @returns the budget of one attempt.
 * @throws {TypeError} when a fraction is outside `[0, 1]`, the two reserves leave no assembly room, or the window is not a positive token count.
 */
export function resolveContextBudget(input: ContextBudgetInput): ContextBudget {
  const policy = requirePolicy(input?.policy ?? DEFAULT_CONTEXT_POLICY)
  const contextWindow = requireContextWindow(input?.contextWindow)
  const workingReserve = fractionOf(policy.workingReserve.fraction, contextWindow)
  const safetyReserve = fractionOf(policy.safetyReserve.fraction, contextWindow)
  const assembly = contextWindow - workingReserve - safetyReserve
  if (assembly <= 0) {
    throw new TypeError(
      `dsh-mywork: working and safety reserves leave no context budget in a ${contextWindow}-token window`,
    )
  }
  return Object.freeze({
    contextWindow,
    assembly,
    mandatory: fractionOf(policy.mandatory.maxFraction, contextWindow),
    workspaceCanon: fractionOf(policy.workspaceCanon.targetFraction, contextWindow),
    memory: fractionOf(policy.memory.targetFraction, contextWindow),
    dependencies: fractionOf(policy.dependencies.targetFraction, contextWindow),
    workingReserve,
    safetyReserve,
  })
}

/** Input of {@link decideContextAdmission}. */
export interface ContextAdmissionInput {
  /** Policy the attempt runs under; absent means the §21.6 defaults. */
  readonly policy?: ContextPolicy
  /** Context capacity the selected route published (§29); absent means undisclosed. */
  readonly contextWindow?: number
  /** Candidates the providers proposed, in the order they were discovered. */
  readonly candidates: readonly ContextCandidate[]
  /** Materialization time, epoch milliseconds; validity windows are checked against it. */
  readonly nowMs?: EpochMs
}

/** Why the fabric refused to materialize context, with the evidence of the refusal. */
export interface ContextRefusal {
  /** Discriminant of a refusal. */
  readonly kind: 'refused'
  /** What went wrong. */
  readonly reason: ContextRefusalReason
  /** Stable error code of the reason, for the caller's own error path. */
  readonly code: MyWorkErrorCode
  /** Human-readable detail, naming the item or the numbers involved. */
  readonly detail: string
  /** Budget the decision was taken against; absent when no window was published. */
  readonly budget?: ContextBudget
  /** Tokens the selection required, when the refusal is about size. */
  readonly requiredTokens?: number
  /** Tokens the selection was allowed, when the refusal is about size. */
  readonly limitTokens?: number
}

/** What {@link decideContextAdmission} answered. */
export type ContextAdmissionDecision =
  | { readonly kind: 'admitted'; readonly plan: ContextMaterializationPlan }
  | ContextRefusal

/**
 * Rank the candidates and hold the selection to the budget of one attempt (§21.6).
 *
 * Mandatory items are selected whatever their relevance — but only after the
 * fabric has proved it can measure and verify them: an item with no token
 * estimate, no revision and no hash, or a validity window that has closed is a
 * refusal, because mandatory context is never silently trimmed.
 *
 * Optional items are taken in rank order (stated relevance first, then cheaper
 * items, then uri, so the order never depends on the order providers answered
 * in) while their class target and the assembly budget both have room.
 *
 * A uri proposed more than once is one item: the first candidate in discovery
 * order wins, and every later claim of that uri is recorded as a
 * `duplicate-uri` drop rather than being charged twice or failing the attempt.
 * @param input - policy, published window, candidates, and the materialization time.
 * @returns the plan, or the refusal that stopped it.
 * @throws {TypeError} when a candidate is malformed or the materialization time is missing.
 */
export function decideContextAdmission(input: ContextAdmissionInput): ContextAdmissionDecision {
  const candidates = requireCandidates(input?.candidates)
  const nowMs = input?.nowMs
  if (!isCounter(nowMs)) {
    throw new TypeError('dsh-mywork: context admission needs the materialization time in epoch milliseconds')
  }
  const contextWindow = input?.contextWindow
  if (contextWindow === undefined) {
    return refuse('context-window-undisclosed', 'dsh-mywork: the selected route published no context window, so no context budget can be derived')
  }
  const budget = resolveContextBudget({ ...(input?.policy === undefined ? {} : { policy: input.policy }), contextWindow })

  const dropped: ContextDrop[] = []
  // One item per uri. Two providers may legitimately address the same item —
  // §62 items 25 and 26 put a native and an external memory provider side by
  // side — so a repeated uri is a discovery fact, not a programming error. The
  // first candidate the pass proposed is the one that counts, whatever class it
  // claimed: letting a later claim win would make the plan depend on the order
  // providers happened to answer in.
  const claimed = new Set<string>()
  const unique: ContextCandidate[] = []
  for (const candidate of candidates) {
    if (claimed.has(candidate.uri)) {
      dropped.push(dropOf(candidate, 'duplicate-uri'))
      continue
    }
    claimed.add(candidate.uri)
    unique.push(candidate)
  }
  const mandatoryCandidates = unique.filter(candidate => isMandatoryClass(candidate.kind))
  const optionalCandidates = unique.filter(candidate => !isMandatoryClass(candidate.kind))

  let mandatoryTokens = 0
  for (const candidate of mandatoryCandidates) {
    if (!isValidAt(candidate, nowMs)) {
      return refuse('mandatory-expired', `dsh-mywork: mandatory context "${candidate.uri}" is outside its validity window`, { budget })
    }
    if (candidate.estimatedTokens === undefined) {
      return refuse('mandatory-tokens-unknown', `dsh-mywork: mandatory context "${candidate.uri}" states no token estimate, so its cost cannot be held to the budget`, { budget })
    }
    if (candidate.revision === undefined && candidate.contentHash === undefined) {
      return refuse('mandatory-unverifiable', `dsh-mywork: mandatory context "${candidate.uri}" carries neither a revision nor a content hash, so drift could not be detected`, { budget })
    }
    mandatoryTokens += candidate.estimatedTokens
  }
  if (mandatoryTokens > budget.mandatory) {
    return refuse(
      'mandatory-overflow',
      `dsh-mywork: mandatory context needs ${mandatoryTokens} tokens but its ceiling is ${budget.mandatory} of a ${budget.contextWindow}-token window`,
      { budget, requiredTokens: mandatoryTokens, limitTokens: budget.mandatory },
    )
  }
  if (mandatoryTokens > budget.assembly) {
    return refuse(
      'reserves-overflow',
      `dsh-mywork: mandatory context needs ${mandatoryTokens} tokens but the reserves leave only ${budget.assembly}`,
      { budget, requiredTokens: mandatoryTokens, limitTokens: budget.assembly },
    )
  }

  const used: Record<ContextBucket, number> = { workspaceCanon: 0, memory: 0, dependencies: 0 }
  const selectedOptional: Array<{ readonly candidate: ContextCandidate; readonly bucket?: ContextBucket }> = []
  let assemblyUsed = mandatoryTokens
  for (const candidate of [...optionalCandidates].sort(compareCandidates)) {
    if (!isValidAt(candidate, nowMs)) {
      dropped.push(dropOf(candidate, 'expired'))
      continue
    }
    if (candidate.revision === undefined && candidate.contentHash === undefined) {
      dropped.push(dropOf(candidate, 'unverifiable'))
      continue
    }
    if (candidate.estimatedTokens === undefined) {
      dropped.push(dropOf(candidate, 'tokens-unknown'))
      continue
    }
    const bucket = bucketOf(candidate.kind)
    if (bucket !== undefined && used[bucket] + candidate.estimatedTokens > budget[bucket]) {
      dropped.push(dropOf(candidate, 'over-target'))
      continue
    }
    if (assemblyUsed + candidate.estimatedTokens > budget.assembly) {
      dropped.push(dropOf(candidate, 'over-budget'))
      continue
    }
    if (bucket !== undefined) used[bucket] += candidate.estimatedTokens
    assemblyUsed += candidate.estimatedTokens
    selectedOptional.push(bucket === undefined ? { candidate } : { candidate, bucket })
  }

  const mandatory = withRanks(mandatoryCandidates.map(candidate => selectionOf(candidate, true, undefined)))
  const optional = withRanks(
    selectedOptional.map(entry => selectionOf(entry.candidate, false, entry.bucket)),
  )
  return Object.freeze({
    kind: 'admitted',
    plan: Object.freeze({
      budget,
      mandatory,
      optional,
      dropped: Object.freeze(dropped),
      totalTokens: assemblyUsed,
      reservedTokens: budget.workingReserve + budget.safetyReserve,
    }),
  })
}

/** One provider the fabric may discover context from. */
export interface ContextProviderBinding {
  /** Provider identity; a candidate's `source` must name it. */
  readonly provider: string
  /** The port itself. */
  readonly port: ContextProviderPort
}

/** What one provider answered during discovery. */
export interface ContextProviderObservation {
  /** Provider identity. */
  readonly provider: string
  /** Capabilities it declared; absent when it did not answer. */
  readonly capabilities?: ContextProviderCapabilities
  /** Candidates it contributed to the result. */
  readonly candidates: number
  /** Verbatim failure text, when it did not answer. */
  readonly detail?: string
}

/** The result of one discovery pass (§21.5). */
export interface ContextDiscovery {
  /** Candidates every provider proposed, in provider order. */
  readonly candidates: readonly ContextCandidate[]
  /** One observation per provider, in the order they were asked. */
  readonly providers: readonly ContextProviderObservation[]
  /** Time the pass ran, epoch milliseconds. */
  readonly observedAt: EpochMs
}

/** Input of {@link discoverContext}. */
export interface ContextDiscoveryInput {
  /** Providers to ask. */
  readonly providers: readonly ContextProviderBinding[]
  /** The request every provider is asked with. */
  readonly request: ContextDiscoveryRequest
  /** Time of the pass, epoch milliseconds. */
  readonly nowMs: EpochMs
}

/**
 * Ask every provider for candidates (§21.5 `discover`).
 *
 * A provider that fails is recorded and skipped rather than failing the pass:
 * §21.1's fabric decides what is materialized, and one unreachable source is not
 * a reason to refuse an attempt. A provider that answers about a class the
 * caller did not ask for is filtered here, so the restriction holds whatever an
 * adapter does with the request.
 * @param input - providers, request, and the time of the pass.
 * @returns the candidates and one observation per provider.
 * @throws {TypeError} when a provider binding or the request is malformed.
 */
export async function discoverContext(input: ContextDiscoveryInput): Promise<ContextDiscovery> {
  const providers = requireProviders(input?.providers)
  const request = requireDiscoveryRequest(input?.request)
  const nowMs = input?.nowMs
  if (!isCounter(nowMs)) throw new TypeError('dsh-mywork: a discovery pass needs epoch milliseconds')

  const candidates: ContextCandidate[] = []
  const observations: ContextProviderObservation[] = []
  for (const binding of providers) {
    let capabilities: ContextProviderCapabilities
    try {
      capabilities = requireCapabilities(await binding.port.capabilities(), binding.provider)
    } catch (error) {
      observations.push(Object.freeze({ provider: binding.provider, candidates: 0, detail: describeFailure(error) }))
      continue
    }
    try {
      const proposed = await binding.port.discover(request)
      if (!Array.isArray(proposed)) {
        throw new TypeError(`dsh-mywork: provider "${binding.provider}" did not answer with candidates`)
      }
      // Built locally and merged only once the whole answer proved usable: a
      // partially malformed answer used to leave items in the result while the
      // observation reported none, so the audit trail contradicted the plan.
      const accepted: ContextCandidate[] = []
      for (const candidate of proposed) {
        const normalized = requireCandidate(candidate)
        if (normalized.source !== binding.provider) {
          throw new TypeError(
            `dsh-mywork: provider "${binding.provider}" proposed "${normalized.uri}" as source "${normalized.source}"`,
          )
        }
        if (!matchesRequest(normalized, request)) continue
        accepted.push(normalized)
      }
      for (const candidate of accepted) candidates.push(candidate)
      observations.push(Object.freeze({ provider: binding.provider, capabilities, candidates: accepted.length }))
    } catch (error) {
      observations.push(Object.freeze({ provider: binding.provider, capabilities, candidates: 0, detail: describeFailure(error) }))
    }
  }
  return Object.freeze({
    candidates: Object.freeze(candidates),
    providers: Object.freeze(observations),
    observedAt: nowMs,
  })
}

/** Input of {@link materializeContextSnapshot}. */
export interface ContextMaterializationInput {
  /** Attempt the snapshot is built for. */
  readonly attemptId: AttemptId
  /** Task the attempt works on. */
  readonly taskId: TaskId
  /** Workspace the attempt runs in. */
  readonly workspaceId: WorkspaceId
  /** Materialization time, epoch milliseconds. */
  readonly createdAt: EpochMs
  /** Revisions the attempt froze (§35). */
  readonly revisions: ContextSnapshotRevisions
  /** Per-skill revisions the attempt froze; absent means it pinned none. */
  readonly skillRevisions?: Readonly<Record<SkillId, Revision>>
  /** Provenance of the route the attempt selected (§29). */
  readonly route: ModelRouteProvenance
  /** Tools the attempt may see (§21.8). */
  readonly toolSurface: readonly string[]
  /** Memory query the attempt ran; absent when it ran none. */
  readonly memoryQuery?: string
  /** Policy the attempt runs under; absent means the §21.6 defaults. */
  readonly policy?: ContextPolicy
  /** What discovery already answered. */
  readonly discovery: ContextDiscovery
  /**
   * Uris whose full body the caller asks for (§21.2 L2 on request). An item
   * outside this list keeps the level it was discovered at, which is how a
   * progressive-disclosure set stays cheap.
   */
  readonly requestedFullContent?: readonly string[]
  /** Providers that may serve the requested bodies, keyed by their identity. */
  readonly providers?: readonly ContextProviderBinding[]
  /** Registry that mints the snapshot revision. */
  readonly registry: ContextSnapshotRevisionRegistry
}

/** What {@link materializeContextSnapshot} answered. */
export type ContextSnapshotDecision =
  | { readonly kind: 'materialized'; readonly snapshot: ContextSnapshot }
  | ContextRefusal

/**
 * Build the immutable snapshot of one attempt's context (§21.7, §35).
 *
 * The snapshot is decided once: admission ranks the candidates against the
 * budget of the selected route, the requested full bodies are fetched on demand,
 * and everything else keeps the level it was discovered at. A requested body
 * that cannot be fetched — because no provider serves it, because the provider
 * declares no on-demand materialization, or because the source moved past the
 * revision the plan was built from — refuses the whole snapshot instead of
 * silently degrading to an overview.
 * @param input - attempt identity, frozen revisions, route, discovery, and policy.
 * @returns the frozen snapshot, or the refusal that stopped it.
 * @throws {TypeError} when the input itself is malformed.
 */
export async function materializeContextSnapshot(input: ContextMaterializationInput): Promise<ContextSnapshotDecision> {
  const attemptId = requireIdentifier(input?.attemptId, 'attemptId')
  const taskId = requireIdentifier(input?.taskId, 'taskId')
  const workspaceId = requireIdentifier(input?.workspaceId, 'workspaceId')
  const createdAt = input?.createdAt
  if (!isCounter(createdAt)) throw new TypeError('dsh-mywork: a context snapshot needs an epoch-millisecond createdAt')
  const revisions = requireSnapshotRevisions(input?.revisions)
  const skillRevisions = requireSkillRevisions(input?.skillRevisions)
  const route = requireRoute(input?.route)
  const toolSurface = requireStringList(input?.toolSurface, 'toolSurface')
  const registry = input?.registry
  if (registry === undefined || typeof registry.revisionOf !== 'function') {
    throw new TypeError('dsh-mywork: a context snapshot needs a revision registry')
  }
  const discovery = requireDiscovery(input?.discovery)
  const requested = requireStringList(input?.requestedFullContent ?? [], 'requestedFullContent')
  const providers = requireProviders(input?.providers ?? [])

  const decision = decideContextAdmission({
    ...(input?.policy === undefined ? {} : { policy: input.policy }),
    ...(route.contextWindow === undefined ? {} : { contextWindow: route.contextWindow }),
    candidates: discovery.candidates,
    nowMs: createdAt,
  })
  if (decision.kind === 'refused') return decision

  const selected = [...decision.plan.mandatory, ...decision.plan.optional]
  const selectedUris = new Set(selected.map(selection => selection.candidate.uri))
  for (const uri of requested) {
    if (!selectedUris.has(uri)) {
      return refuse(
        'materialization-failed',
        `dsh-mywork: "${uri}" was requested at ${CONTEXT_FULL_LEVEL} but the plan does not hold it, so there is nothing to materialize`,
      )
    }
  }
  const items: ContextSnapshotItem[] = []
  let totalTokens = decision.plan.totalTokens
  const bucketUsed: Record<ContextBucket, number> = { workspaceCanon: 0, memory: 0, dependencies: 0 }
  for (const selection of decision.plan.optional) {
    if (selection.bucket !== undefined) bucketUsed[selection.bucket] += selection.tokens
  }
  for (const selection of selected) {
    const item = itemOf(selection)
    // An item that already arrived at the full level with its body needs no
    // fetch: asking the port for what the fabric already holds would refuse a
    // provider that honestly declares no on-demand materialization.
    const requestedBody =
      requested.includes(item.uri) && !(item.level === CONTEXT_FULL_LEVEL && item.content !== undefined)
    if (!requestedBody) {
      items.push(item)
      continue
    }
    const binding = providers.find(entry => entry.provider === item.source)
    if (binding === undefined) {
      return refuse('materialization-failed', `dsh-mywork: no provider "${item.source}" is bound, so "${item.uri}" cannot be fetched at ${CONTEXT_FULL_LEVEL}`)
    }
    const observation = discovery.providers.find(entry => entry.provider === item.source)
    const capabilities = observation?.capabilities
    if (capabilities === undefined || !capabilities.onDemandMaterialization || !capabilities.levels.includes(CONTEXT_FULL_LEVEL)) {
      return refuse('materialization-failed', `dsh-mywork: provider "${item.source}" does not serve ${CONTEXT_FULL_LEVEL} on request (§37 negotiation)`)
    }
    let body: ContextMaterialized
    try {
      body = requireMaterialized(
        await binding.port.materialize({
          uri: item.uri,
          level: CONTEXT_FULL_LEVEL,
          ...(item.revision === undefined ? {} : { expectedRevision: item.revision }),
          ...(item.contentHash === undefined ? {} : { expectedContentHash: item.contentHash }),
        }),
        item.uri,
      )
    } catch (error) {
      return refuse('materialization-failed', `dsh-mywork: "${item.uri}" could not be materialized: ${describeFailure(error)}`)
    }
    if (body.level !== CONTEXT_FULL_LEVEL) {
      return refuse(
        'materialization-failed',
        `dsh-mywork: "${item.uri}" was requested at ${CONTEXT_FULL_LEVEL} but provider "${item.source}" answered at ${body.level}, so the snapshot would have claimed a body it never received`,
      )
    }
    const tokens = body.estimatedTokens ?? item.tokens
    totalTokens += tokens - item.tokens
    if (totalTokens > decision.plan.budget.assembly) {
      return refuse(
        'materialized-overflow',
        `dsh-mywork: the body of "${item.uri}" needs ${tokens} tokens and puts the snapshot at ${totalTokens}, past the assembly budget of ${decision.plan.budget.assembly}`,
        { budget: decision.plan.budget, requiredTokens: totalTokens, limitTokens: decision.plan.budget.assembly },
      )
    }
    if (item.bucket !== undefined) {
      bucketUsed[item.bucket] += tokens - item.tokens
      if (bucketUsed[item.bucket] > decision.plan.budget[item.bucket]) {
        return refuse(
          'materialized-overflow',
          `dsh-mywork: the body of "${item.uri}" needs ${tokens} tokens and puts the ${item.bucket} bucket at ${bucketUsed[item.bucket]}, past its target of ${decision.plan.budget[item.bucket]}`,
          {
            budget: decision.plan.budget,
            requiredTokens: bucketUsed[item.bucket],
            limitTokens: decision.plan.budget[item.bucket],
          },
        )
      }
    }
    items.push(
      Object.freeze({
        ...item,
        level: body.level,
        ...(body.revision === undefined ? {} : { revision: body.revision }),
        contentHash: body.contentHash,
        tokens,
        content: body.content,
        materializedAt: createdAt,
        provenance: mergeProvenance(item.provenance, body.provenance),
      }),
    )
  }

  const contentHashes: Record<string, string> = {}
  for (const item of items) {
    if (item.contentHash !== undefined) contentHashes[item.uri] = item.contentHash
  }
  const built = {
    attemptId,
    taskId,
    workspaceId,
    createdAt,
    revisions,
    skillRevisions,
    // Copied rather than referenced: the snapshot is frozen whole, and freezing
    // it must not reach into an object the caller still owns.
    modelRoute: { provider: route.route.provider, model: route.route.model },
    modelRouteRole: route.role,
    contextWindow: decision.plan.budget.contextWindow,
    toolSurface,
    ...(input?.memoryQuery === undefined ? {} : { memoryQuery: input.memoryQuery }),
    budget: decision.plan.budget,
    items: Object.freeze(items),
    contentHashes: Object.freeze(contentHashes),
    tokenEstimates: estimatesOf(items, decision.plan.budget),
    dropped: decision.plan.dropped,
    provenance: provenanceOf(items, discovery),
  }
  const fingerprint = canonicalForm(built)
  // §21.7 makes the snapshot an audit artifact, so it is frozen whole: a reader
  // that could mutate an item in place would be holding a different snapshot
  // than the one the attempt was admitted with.
  const snapshot = deepFreeze<ContextSnapshot>({
    revision: registry.revisionOf(fingerprint),
    ...built,
    fingerprint,
  })
  return Object.freeze({ kind: 'materialized', snapshot })
}

/** Input of {@link verifyContextSnapshot}. */
export interface ContextVerificationInput {
  /** The snapshot the attempt froze. */
  readonly snapshot: ContextSnapshot
  /** What a re-materialization observed now, one entry per uri. */
  readonly observed: readonly ContextObservation[]
}

/** The result of comparing a snapshot against what its sources say now. */
export type ContextVerification =
  | { readonly kind: 'intact' }
  | { readonly kind: 'drifted'; readonly drift: readonly ContextDrift[] }

/**
 * Compare a frozen snapshot against a fresh observation of the same uris (§21.7).
 *
 * This is what a repeat materialization is for: the attempt keeps the context it
 * was admitted with, and a source that has since moved is reported as drift
 * rather than silently swapped in. An item the source no longer answers about is
 * drift too — "gone" is not "unchanged".
 *
 * Each identity field of an observation is read in three states, and they are
 * kept apart on purpose: a **string** is what the source published, **`null`**
 * is a source that publishes nothing where the snapshot froze a value — drift
 * `unverifiable`, because a frozen revision nobody can confirm is not the same
 * as a confirmed one — and an **absent** field is a caller that did not look,
 * which is not evidence either way. The distinction exists so a partial
 * observation cannot pass as a clean bill of health while a source that dropped
 * its revisions is reported.
 *
 * An observation of a uri the snapshot does not hold is ignored: the snapshot is
 * the authority on what the attempt saw, not the other way round.
 * @param input - the snapshot and the observations to compare it against.
 * @returns `intact`, or every drifted item with both sides of the comparison.
 * @throws {TypeError} when the snapshot or an observation is malformed.
 */
export function verifyContextSnapshot(input: ContextVerificationInput): ContextVerification {
  const snapshot = input?.snapshot
  if (snapshot === undefined || !Array.isArray(snapshot.items)) {
    throw new TypeError('dsh-mywork: verification needs a context snapshot')
  }
  const observed = input?.observed
  if (!Array.isArray(observed)) throw new TypeError('dsh-mywork: verification needs the observations to compare against')
  const byUri = new Map<string, ContextObservation>()
  for (const observation of observed) {
    const uri = requireIdentifier(observation?.uri, 'an observation uri')
    byUri.set(
      uri,
      Object.freeze({
        uri,
        ...(observation.revision === undefined
          ? {}
          : { revision: requireObservationIdentity(observation.revision, uri, 'revision') }),
        ...(observation.contentHash === undefined
          ? {}
          : { contentHash: requireObservationIdentity(observation.contentHash, uri, 'contentHash') }),
      }),
    )
  }
  const drift: ContextDrift[] = []
  for (const item of snapshot.items) {
    const seen = byUri.get(item.uri)
    if (seen === undefined) {
      drift.push(Object.freeze({ uri: item.uri, reason: 'missing' }))
      continue
    }
    const revision = compareIdentity(item.revision, seen.revision)
    const hash = compareIdentity(item.contentHash, seen.contentHash)
    const reason =
      revision === 'changed'
        ? 'revision-changed'
        : hash === 'changed'
          ? 'hash-changed'
          : revision === 'withheld' || hash === 'withheld'
            ? 'unverifiable'
            : undefined
    if (reason === undefined) continue
    drift.push(
      Object.freeze({
        uri: item.uri,
        reason,
        ...(item.revision === undefined ? {} : { expectedRevision: item.revision }),
        ...(seen.revision === undefined || seen.revision === null ? {} : { actualRevision: seen.revision }),
        ...(item.contentHash === undefined ? {} : { expectedHash: item.contentHash }),
        ...(seen.contentHash === undefined || seen.contentHash === null ? {} : { actualHash: seen.contentHash }),
      }),
    )
  }
  return drift.length === 0
    ? Object.freeze({ kind: 'intact' })
    : Object.freeze({ kind: 'drifted', drift: Object.freeze(drift) })
}

/**
 * How one identity field of a frozen item compares with what a source says now.
 *
 * `unobserved` covers both "the snapshot froze nothing" and "the caller did not
 * look": neither is evidence that anything changed, and neither is evidence that
 * nothing did.
 */
type IdentityComparison =
  /** The snapshot froze nothing here, or the caller did not look. */
  | 'unobserved'
  /** Both sides published the same value. */
  | 'same'
  /** Both sides published a value and they differ. */
  | 'changed'
  /** The source publishes nothing where the snapshot froze a value. */
  | 'withheld'

/** Compare one frozen identity field against what an observation published. */
function compareIdentity(frozen: string | undefined, seen: string | null | undefined): IdentityComparison {
  if (frozen === undefined) return 'unobserved'
  if (seen === undefined) return 'unobserved'
  if (seen === null) return 'withheld'
  return frozen === seen ? 'same' : 'changed'
}

/** Fence a data section opens with. */
export const CONTEXT_DATA_FENCE = '<<<mywork:data>>>'

/** Fence a data section closes with. */
export const CONTEXT_DATA_FENCE_END = '<<<mywork:end>>>'

/**
 * Assemble the model-visible context of one attempt from its snapshot (§21.8).
 *
 * This is the only place MyWork renders context into a prompt, and it accepts
 * nothing but a {@link ContextSnapshot} — so §21.1 holds by construction, and
 * an item that is not in the frozen snapshot has no way in.
 *
 * Instruction sections come from items the fabric placed as instructions.
 * Everything else is rendered as data inside a fence, with the fence token
 * neutralized in every value that came from a source: the body, and the uri,
 * source, class, and revision the fabric interpolates around it. Content that
 * arrived from a source MyWork does not trust therefore cannot close its own
 * section and continue as an instruction.
 * @param snapshot - the frozen snapshot of the attempt.
 * @returns the sections, their rendered text, and the tokens charged.
 * @throws {TypeError} when the argument is not a context snapshot.
 */
export function assembleContextPrompt(snapshot: ContextSnapshot): ContextPrompt {
  if (snapshot === undefined || !Array.isArray(snapshot.items)) {
    throw new TypeError('dsh-mywork: prompt assembly needs a context snapshot')
  }
  const groups = new Map<string, { placement: ContextPlacement; kind: ContextClass; source: string; items: ContextSnapshotItem[] }>()
  for (const item of snapshot.items) {
    const key = `${item.placement}\u0000${item.kind}\u0000${item.source}`
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, { placement: item.placement, kind: item.kind, source: item.source, items: [item] })
    } else {
      group.items.push(item)
    }
  }
  const ordered = [...groups.values()].sort((left, right) => {
    if (left.placement !== right.placement) return left.placement === 'instruction' ? -1 : 1
    return compareClasses(left.kind, right.kind)
  })
  const sections: ContextPromptSection[] = []
  for (const group of ordered) {
    const body = group.items
      .map(item => (item.content === undefined ? referenceOf(item) : neutralize(item.content.text)))
      .join('\n\n')
    const text =
      group.placement === 'instruction'
        ? `## ${neutralize(group.kind)}\n${body}`
        : `${CONTEXT_DATA_FENCE} kind=${neutralize(group.kind)} source=${neutralize(group.source)}\n${body}\n${CONTEXT_DATA_FENCE_END}`
    sections.push(
      Object.freeze({
        placement: group.placement,
        kind: group.kind,
        source: group.source,
        text,
        tokens: group.items.reduce((sum, item) => sum + item.tokens, 0),
      }),
    )
  }
  return Object.freeze({
    sections: Object.freeze(sections),
    text: sections.map(section => section.text).join('\n\n'),
    tokens: sections.reduce((sum, section) => sum + section.tokens, 0),
  })
}

/** Whether a class is one §21.6 counts against the mandatory ceiling. */
export function isMandatoryContextClass(kind: ContextClass): boolean {
  return isMandatoryClass(kind)
}

/** Whether a class is one §21.8 lets the fabric place as an instruction. */
export function isInstructionContextClass(kind: ContextClass): boolean {
  return INSTRUCTION_CONTEXT_CLASSES.includes(kind as BaseContextClass)
}

/** Whether a candidate's trust authorizes an instruction position. */
export function isTrustedContextCandidate(candidate: ContextCandidate): boolean {
  return candidate?.trust === TRUSTED_CONTEXT_TRUST
}

/** The bucket a class is charged to, or `undefined` when it belongs to none. */
export function contextBucketOf(kind: ContextClass): ContextBucket | undefined {
  return bucketOf(kind)
}

/** Build one refusal with its stable code. */
function refuse(
  reason: ContextRefusalReason,
  detail: string,
  extra: { readonly budget?: ContextBudget; readonly requiredTokens?: number; readonly limitTokens?: number } = {},
): ContextRefusal {
  return Object.freeze({
    kind: 'refused',
    reason,
    code: CONTEXT_REFUSAL_CODES[reason],
    detail,
    ...(extra.budget === undefined ? {} : { budget: extra.budget }),
    ...(extra.requiredTokens === undefined ? {} : { requiredTokens: extra.requiredTokens }),
    ...(extra.limitTokens === undefined ? {} : { limitTokens: extra.limitTokens }),
  })
}

/** Whether a class is mandatory (§21.6). */
function isMandatoryClass(kind: ContextClass): boolean {
  return MANDATORY_CONTEXT_CLASSES.includes(kind as BaseContextClass)
}

/** The bucket a class belongs to, or `undefined` when no target names it. */
function bucketOf(kind: ContextClass): ContextBucket | undefined {
  return CONTEXT_BUCKETS.find(bucket => CONTEXT_BUCKET_CLASSES[bucket] === kind)
}

/** Whether a candidate's validity window covers the materialization time. */
function isValidAt(candidate: ContextCandidate, nowMs: EpochMs): boolean {
  if (candidate.validFrom !== undefined && nowMs < candidate.validFrom) return false
  if (candidate.validUntil !== undefined && nowMs > candidate.validUntil) return false
  return true
}

/**
 * Order optional candidates: stated relevance first, then the cheaper item, then
 * the uri. The last two keys exist so the selection never depends on the order
 * providers happened to answer in.
 */
function compareCandidates(left: ContextCandidate, right: ContextCandidate): number {
  const leftRelevance = left.relevance
  const rightRelevance = right.relevance
  if (leftRelevance !== undefined && rightRelevance !== undefined && leftRelevance !== rightRelevance) {
    return rightRelevance - leftRelevance
  }
  if (leftRelevance !== undefined && rightRelevance === undefined) return -1
  if (leftRelevance === undefined && rightRelevance !== undefined) return 1
  const leftTokens = left.estimatedTokens ?? Number.MAX_SAFE_INTEGER
  const rightTokens = right.estimatedTokens ?? Number.MAX_SAFE_INTEGER
  if (leftTokens !== rightTokens) return leftTokens - rightTokens
  return compareStrings(left.uri, right.uri)
}

/** Order context classes: the §21.3 base list first, then anything else by name. */
function compareClasses(left: ContextClass, right: ContextClass): number {
  const leftIndex = CONTEXT_CLASSES.indexOf(left as BaseContextClass)
  const rightIndex = CONTEXT_CLASSES.indexOf(right as BaseContextClass)
  if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex
  if (leftIndex !== -1) return -1
  if (rightIndex !== -1) return 1
  return compareStrings(left, right)
}

/** Compare two strings without depending on the platform locale. */
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Build one selection, deciding placement from class and trust (§21.8). */
function selectionOf(candidate: ContextCandidate, mandatory: boolean, bucket: ContextBucket | undefined): ContextSelection {
  const wouldBeInstruction = isInstructionContextClass(candidate.kind)
  const placement: ContextPlacement = wouldBeInstruction && isTrustedContextCandidate(candidate) ? 'instruction' : 'data'
  return Object.freeze({
    candidate,
    rank: 0,
    mandatory,
    ...(bucket === undefined ? {} : { bucket }),
    placement,
    downgraded: wouldBeInstruction && placement === 'data',
    tokens: candidate.estimatedTokens ?? 0,
  })
}

/** Re-rank one group so every item carries its position inside its own class. */
function withRanks(selections: readonly ContextSelection[]): readonly ContextSelection[] {
  const sorted = [...selections].sort((left, right) => compareCandidates(left.candidate, right.candidate))
  const perClass = new Map<ContextClass, number>()
  return Object.freeze(
    sorted.map(selection => {
      const rank = perClass.get(selection.candidate.kind) ?? 0
      perClass.set(selection.candidate.kind, rank + 1)
      return Object.freeze({ ...selection, rank })
    }),
  )
}

/** Build the drop record of one candidate. */
function dropOf(candidate: ContextCandidate, reason: ContextDrop['reason']): ContextDrop {
  return Object.freeze({
    uri: candidate.uri,
    source: candidate.source,
    kind: candidate.kind,
    reason,
    ...(candidate.estimatedTokens === undefined ? {} : { estimatedTokens: candidate.estimatedTokens }),
  })
}

/** Turn one selection into the item a snapshot holds. */
function itemOf(selection: ContextSelection): ContextSnapshotItem {
  const candidate = selection.candidate
  return Object.freeze({
    uri: candidate.uri,
    source: candidate.source,
    kind: candidate.kind,
    level: candidate.level,
    placement: selection.placement,
    mandatory: selection.mandatory,
    ...(selection.bucket === undefined ? {} : { bucket: selection.bucket }),
    rank: selection.rank,
    ...(candidate.revision === undefined ? {} : { revision: candidate.revision }),
    ...(candidate.contentHash === undefined ? {} : { contentHash: candidate.contentHash }),
    tokens: selection.tokens,
    downgraded: selection.downgraded,
    ...(candidate.content === undefined ? {} : { content: candidate.content }),
    provenance: Object.freeze([...candidate.provenance]),
  })
}

/** Token accounting of one snapshot, in §53's dimensions (§21.6). */
function estimatesOf(items: readonly ContextSnapshotItem[], budget: ContextBudget): ContextTokenEstimates {
  const sum = (predicate: (item: ContextSnapshotItem) => boolean): number =>
    items.filter(predicate).reduce((total, item) => total + item.tokens, 0)
  const mandatory = sum(item => item.mandatory)
  const workspaceCanon = sum(item => item.bucket === 'workspaceCanon')
  const memory = sum(item => item.bucket === 'memory')
  const dependencies = sum(item => item.bucket === 'dependencies')
  return Object.freeze({
    mandatory,
    workspaceCanon,
    memory,
    dependencies,
    general: sum(item => !item.mandatory && item.bucket === undefined),
    total: items.reduce((total, item) => total + item.tokens, 0),
    workingReserve: budget.workingReserve,
    safetyReserve: budget.safetyReserve,
  })
}

/** Provenance of the snapshot: every provider that answered, deduplicated by uri. */
function provenanceOf(
  items: readonly ContextSnapshotItem[],
  discovery: ContextDiscovery,
): readonly ContextProvenanceRef[] {
  const refs: ContextProvenanceRef[] = []
  const seen = new Set<string>()
  for (const observation of discovery.providers) {
    const key = `provider\u0000${observation.provider}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(Object.freeze({ source: observation.provider, uri: `mywork:context/${observation.provider}` }))
  }
  for (const item of items) {
    for (const ref of item.provenance) {
      const key = `${ref.source}\u0000${ref.uri}\u0000${ref.revision ?? ''}\u0000${ref.contentHash ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      refs.push(ref)
    }
  }
  return Object.freeze(refs)
}

/** Provenance of one item plus the provenance of the body fetched for it. */
function mergeProvenance(
  left: readonly ContextProvenanceRef[],
  right: readonly ContextProvenanceRef[],
): readonly ContextProvenanceRef[] {
  const refs: ContextProvenanceRef[] = []
  const seen = new Set<string>()
  for (const ref of [...left, ...right]) {
    const key = `${ref.source}\u0000${ref.uri}\u0000${ref.revision ?? ''}\u0000${ref.contentHash ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  return Object.freeze(refs)
}

/** Render one item the snapshot holds no body for: a reference the model may ask about. */
function referenceOf(item: ContextSnapshotItem): string {
  // Every field here is provider-controlled — a uri a source built from its own
  // data can contain anything — so the whole line is neutralized, not only the
  // body a full item would have carried.
  return neutralize(
    `- [${item.level}] ${item.uri} (${item.source})${item.revision === undefined ? '' : ` revision=${item.revision}`}`,
  )
}

/**
 * Neutralize the fence token inside any value a provider controls.
 *
 * The escape inserts a zero-width space, so a body that contains the token is
 * rendered differently from a body that closes its own section: it stays inside
 * the data fence it was put in. The same rule covers the metadata the fabric
 * interpolates around a body — uri, source, class, revision — because a fence
 * that only guards the body is a fence a source can walk around.
 */
function neutralize(text: string): string {
  return text.split('<<<').join('<\u200B<<')
}

/** Read a fraction and reject anything outside `[0, 1]`. */
function requireFraction(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`dsh-mywork: context policy ${label} must be a fraction between 0 and 1, received ${describeValue(value)}`)
  }
  return value
}

/** Apply one fraction to a window, rounding down so a budget is never exceeded. */
function fractionOf(fraction: number, contextWindow: number): number {
  return Math.floor(fraction * contextWindow)
}

/** Validate a policy and freeze it. */
function requirePolicy(policy: ContextPolicy): ContextPolicy {
  if (policy === null || typeof policy !== 'object') {
    throw new TypeError(`dsh-mywork: context policy must be an object, received ${describeValue(policy)}`)
  }
  const mandatory = requireFraction(policy.mandatory?.maxFraction, 'mandatory.maxFraction')
  const workspaceCanon = requireFraction(policy.workspaceCanon?.targetFraction, 'workspaceCanon.targetFraction')
  const memory = requireFraction(policy.memory?.targetFraction, 'memory.targetFraction')
  const dependencies = requireFraction(policy.dependencies?.targetFraction, 'dependencies.targetFraction')
  const working = requireFraction(policy.workingReserve?.fraction, 'workingReserve.fraction')
  const safety = requireFraction(policy.safetyReserve?.fraction, 'safetyReserve.fraction')
  if (working + safety > 1) {
    throw new TypeError(
      `dsh-mywork: context policy reserves ${working + safety} of the window, leaving no room for context`,
    )
  }
  return Object.freeze({
    mandatory: Object.freeze({ maxFraction: mandatory }),
    workspaceCanon: Object.freeze({ targetFraction: workspaceCanon }),
    memory: Object.freeze({ targetFraction: memory }),
    dependencies: Object.freeze({ targetFraction: dependencies }),
    workingReserve: Object.freeze({ fraction: working }),
    safetyReserve: Object.freeze({ fraction: safety }),
  })
}

/** Read the context window a route published; absent stays absent, never zero. */
function requireContextWindow(value: unknown): number {
  if (!isCounter(value) || value <= 0) {
    throw new TypeError(
      `dsh-mywork: a context window must be a positive token count, received ${describeValue(value)}`,
    )
  }
  return value
}

/** Validate one candidate and freeze it. */
function requireCandidate(candidate: unknown): ContextCandidate {
  if (candidate === null || typeof candidate !== 'object') {
    throw new TypeError(`dsh-mywork: a context candidate must be an object, received ${describeValue(candidate)}`)
  }
  const value = candidate as ContextCandidate
  const uri = requireIdentifier(value.uri, 'a context candidate uri')
  const source = requireIdentifier(value.source, 'a context candidate source')
  const kind = requireIdentifier(value.kind, `the class of "${uri}"`)
  if (!CONTEXT_LEVELS.includes(value.level)) {
    throw new TypeError(`dsh-mywork: context candidate "${uri}" declares unknown level "${String(value.level)}"`)
  }
  if (!Array.isArray(value.scopes) || !Array.isArray(value.provenance)) {
    throw new TypeError(`dsh-mywork: context candidate "${uri}" needs scopes and provenance arrays`)
  }
  if (value.relevance !== undefined && (typeof value.relevance !== 'number' || !Number.isFinite(value.relevance))) {
    throw new TypeError(`dsh-mywork: context candidate "${uri}" states a non-numeric relevance`)
  }
  if (value.estimatedTokens !== undefined && !isCounter(value.estimatedTokens)) {
    throw new TypeError(`dsh-mywork: context candidate "${uri}" states a token estimate that is not a count`)
  }
  for (const [field, label] of [['validFrom', 'validFrom'], ['validUntil', 'validUntil']] as const) {
    const stamp = value[field]
    if (stamp !== undefined && !isCounter(stamp)) {
      throw new TypeError(`dsh-mywork: context candidate "${uri}" states a non-numeric ${label}`)
    }
  }
  return Object.freeze({
    uri,
    source,
    kind,
    scopes: Object.freeze([...value.scopes]),
    level: value.level,
    ...(value.relevance === undefined ? {} : { relevance: value.relevance }),
    ...(value.trust === undefined ? {} : { trust: value.trust }),
    ...(value.revision === undefined ? {} : { revision: requireIdentifier(value.revision, `the revision of "${uri}"`) }),
    ...(value.contentHash === undefined ? {} : { contentHash: requireIdentifier(value.contentHash, `the hash of "${uri}"`) }),
    ...(value.estimatedTokens === undefined ? {} : { estimatedTokens: value.estimatedTokens }),
    ...(value.validFrom === undefined ? {} : { validFrom: value.validFrom }),
    ...(value.validUntil === undefined ? {} : { validUntil: value.validUntil }),
    provenance: Object.freeze(value.provenance.map(ref => Object.freeze({ ...ref }))),
    ...(value.content === undefined ? {} : { content: freezeContent(value.content, uri) }),
    ...(value.materializeRef === undefined ? {} : { materializeRef: value.materializeRef }),
    ...(value.attributes === undefined ? {} : { attributes: Object.freeze({ ...value.attributes }) }),
  })
}

/**
 * Validate the candidates of an admission input.
 *
 * A repeated uri is deliberately **not** an error here: two providers may
 * address the same item, and {@link decideContextAdmission} resolves that by
 * keeping the first candidate and recording the rest as drops.
 */
function requireCandidates(candidates: unknown): readonly ContextCandidate[] {
  if (!Array.isArray(candidates)) {
    throw new TypeError(`dsh-mywork: context candidates must be an array, received ${describeValue(candidates)}`)
  }
  return Object.freeze(candidates.map(candidate => requireCandidate(candidate)))
}

/** Validate the providers of a discovery or materialization input. */
function requireProviders(providers: unknown): readonly ContextProviderBinding[] {
  if (!Array.isArray(providers)) {
    throw new TypeError(`dsh-mywork: context providers must be an array, received ${describeValue(providers)}`)
  }
  const seen = new Set<string>()
  return Object.freeze(
    providers.map(entry => {
      const provider = requireIdentifier((entry as ContextProviderBinding)?.provider, 'a context provider identity')
      const port = (entry as ContextProviderBinding)?.port
      if (port === undefined || typeof port.discover !== 'function' || typeof port.materialize !== 'function') {
        throw new TypeError(`dsh-mywork: context provider "${provider}" does not implement ContextProviderPort`)
      }
      if (seen.has(provider)) throw new TypeError(`dsh-mywork: two context providers claim the identity "${provider}"`)
      seen.add(provider)
      return Object.freeze({ provider, port })
    }),
  )
}

/** Validate one discovery request. */
function requireDiscoveryRequest(request: unknown): ContextDiscoveryRequest {
  if (request === null || typeof request !== 'object') {
    throw new TypeError(`dsh-mywork: a discovery request must be an object, received ${describeValue(request)}`)
  }
  const value = request as ContextDiscoveryRequest
  if (!Array.isArray(value.scopes)) {
    throw new TypeError('dsh-mywork: a discovery request needs a scopes array')
  }
  for (const scope of value.scopes) {
    requireIdentifier(scope?.kind, 'a context scope kind')
    requireIdentifier(scope?.id, 'a context scope id')
  }
  if (value.classes !== undefined && !Array.isArray(value.classes)) {
    throw new TypeError('dsh-mywork: discovery request classes must be an array')
  }
  return Object.freeze({
    scopes: Object.freeze(value.scopes.map(scope => Object.freeze({ kind: scope.kind, id: scope.id }))),
    ...(value.classes === undefined ? {} : { classes: Object.freeze([...value.classes]) }),
    ...(value.query === undefined ? {} : { query: value.query }),
    ...(value.maxTokens === undefined ? {} : { maxTokens: value.maxTokens }),
  })
}

/** Whether a candidate answers the classes the request restricted it to. */
function matchesRequest(candidate: ContextCandidate, request: ContextDiscoveryRequest): boolean {
  if (request.classes === undefined) return true
  return request.classes.includes(candidate.kind)
}

/** Validate provider capabilities. */
function requireCapabilities(capabilities: unknown, provider: string): ContextProviderCapabilities {
  if (capabilities === null || typeof capabilities !== 'object') {
    throw new TypeError(`dsh-mywork: provider "${provider}" did not answer with capabilities`)
  }
  const value = capabilities as ContextProviderCapabilities
  if (!Array.isArray(value.levels) || !Array.isArray(value.classes) || !Array.isArray(value.scopeKinds)) {
    throw new TypeError(`dsh-mywork: provider "${provider}" answered with malformed capabilities`)
  }
  for (const level of value.levels) {
    if (!CONTEXT_LEVELS.includes(level)) {
      throw new TypeError(`dsh-mywork: provider "${provider}" declares unknown level "${String(level)}"`)
    }
  }
  if (typeof value.onDemandMaterialization !== 'boolean') {
    throw new TypeError(`dsh-mywork: provider "${provider}" must declare onDemandMaterialization as a boolean`)
  }
  return Object.freeze({
    levels: Object.freeze([...value.levels]),
    onDemandMaterialization: value.onDemandMaterialization,
    classes: Object.freeze([...value.classes]),
    scopeKinds: Object.freeze([...value.scopeKinds]),
  })
}

/** Validate one materialized body. */
function requireMaterialized(body: unknown, uri: string): ContextMaterialized {
  if (body === null || typeof body !== 'object') {
    throw new TypeError(`dsh-mywork: "${uri}" was materialized into ${describeValue(body)}`)
  }
  const value = body as ContextMaterialized
  if (value.uri !== uri) {
    throw new TypeError(`dsh-mywork: asked for "${uri}" and received "${String(value.uri)}"`)
  }
  if (!CONTEXT_LEVELS.includes(value.level)) {
    throw new TypeError(`dsh-mywork: "${uri}" was materialized at unknown level "${String(value.level)}"`)
  }
  requireIdentifier(value.contentHash, `the content hash of "${uri}"`)
  const content = freezeContent(value.content, uri)
  if (!Array.isArray(value.provenance)) {
    throw new TypeError(`dsh-mywork: "${uri}" was materialized without provenance`)
  }
  if (value.estimatedTokens !== undefined && !isCounter(value.estimatedTokens)) {
    throw new TypeError(`dsh-mywork: "${uri}" was materialized with a token estimate that is not a count`)
  }
  return Object.freeze({
    uri,
    level: value.level,
    ...(value.revision === undefined ? {} : { revision: value.revision }),
    contentHash: value.contentHash,
    content,
    ...(value.estimatedTokens === undefined ? {} : { estimatedTokens: value.estimatedTokens }),
    provenance: Object.freeze(value.provenance.map(ref => Object.freeze({ ...ref }))),
  })
}

/** Validate one content body. */
function freezeContent(content: unknown, uri: string): ContextContent {
  if (content === null || typeof content !== 'object') {
    throw new TypeError(`dsh-mywork: "${uri}" carries content that is not an object`)
  }
  const value = content as ContextContent
  requireIdentifier(value.mediaType, `the media type of "${uri}"`)
  if (typeof value.text !== 'string') {
    throw new TypeError(`dsh-mywork: "${uri}" carries content whose text is not a string`)
  }
  return Object.freeze({ mediaType: value.mediaType, text: value.text })
}

/** Validate the revisions a snapshot freezes. */
function requireSnapshotRevisions(revisions: unknown): ContextSnapshotRevisions {
  if (revisions === null || typeof revisions !== 'object') {
    throw new TypeError(`dsh-mywork: a context snapshot needs revisions, received ${describeValue(revisions)}`)
  }
  const value = revisions as ContextSnapshotRevisions
  const read = (field: keyof ContextSnapshotRevisions): Revision => {
    const revision = value[field]
    if (!isCounter(revision)) {
      throw new TypeError(`dsh-mywork: context snapshot revision "${field}" must be a non-negative integer`)
    }
    return revision
  }
  const optional = (field: 'roleStrategy' | 'config' | 'memory'): Revision | undefined => {
    const revision = value[field]
    if (revision === undefined) return undefined
    if (!isCounter(revision)) {
      throw new TypeError(`dsh-mywork: context snapshot revision "${field}" must be a non-negative integer`)
    }
    return revision
  }
  const roleStrategy = optional('roleStrategy')
  const config = optional('config')
  const memory = optional('memory')
  return Object.freeze({
    task: read('task'),
    role: read('role'),
    blueprint: read('blueprint'),
    workflow: read('workflow'),
    ...(roleStrategy === undefined ? {} : { roleStrategy }),
    ...(config === undefined ? {} : { config }),
    ...(memory === undefined ? {} : { memory }),
  })
}

/** Validate the per-skill revisions of a snapshot. */
function requireSkillRevisions(skillRevisions: unknown): Readonly<Record<SkillId, Revision>> {
  if (skillRevisions === undefined || skillRevisions === null) return Object.freeze({})
  if (typeof skillRevisions !== 'object' || Array.isArray(skillRevisions)) {
    throw new TypeError('dsh-mywork: context snapshot skill revisions must be an object keyed by skill id')
  }
  const frozen: Record<SkillId, Revision> = {}
  for (const [skill, revision] of Object.entries(skillRevisions)) {
    requireIdentifier(skill, 'a skill id')
    if (!isCounter(revision)) {
      throw new TypeError(`dsh-mywork: context snapshot skill revision "${skill}" must be a non-negative integer`)
    }
    frozen[skill] = revision
  }
  return Object.freeze(frozen)
}

/** Validate the route provenance a snapshot records. */
function requireRoute(route: unknown): ModelRouteProvenance {
  if (route === null || typeof route !== 'object') {
    throw new TypeError(`dsh-mywork: a context snapshot needs the route it was built for, received ${describeValue(route)}`)
  }
  const value = route as ModelRouteProvenance
  requireIdentifier(value.route?.provider, 'a model route provider')
  requireIdentifier(value.route?.model, 'a model route model')
  if (value.contextWindow !== undefined && (!isCounter(value.contextWindow) || value.contextWindow <= 0)) {
    throw new TypeError('dsh-mywork: a route context window must be a positive token count')
  }
  return value
}

/** Validate a discovery result. */
function requireDiscovery(discovery: unknown): ContextDiscovery {
  if (discovery === null || typeof discovery !== 'object') {
    throw new TypeError(`dsh-mywork: a context snapshot needs a discovery result, received ${describeValue(discovery)}`)
  }
  const value = discovery as ContextDiscovery
  if (!Array.isArray(value.candidates) || !Array.isArray(value.providers)) {
    throw new TypeError('dsh-mywork: a discovery result needs candidates and providers arrays')
  }
  return value
}

/** Read a list of non-empty strings. */
function requireStringList(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`dsh-mywork: ${field} must be an array of strings, received ${describeValue(value)}`)
  }
  for (const entry of value) requireIdentifier(entry, `an entry of ${field}`)
  return Object.freeze([...value])
}

/** Reject an empty or non-string identifier. */
function requireIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`dsh-mywork: ${label} must be a non-empty string`)
  }
  return value
}

/**
 * Read one identity field of an observation: a non-empty string, or `null` for
 * "the source published none". Anything else — an empty string, a number, an
 * object — is a malformed observation, not a third state.
 */
function requireObservationIdentity(value: unknown, uri: string, field: string): string | null {
  if (value === null) return null
  return requireIdentifier(value, `the ${field} observation of "${uri}"`)
}

/** Human-readable kind of a rejected value. */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

/** Verbatim text of a failure, for diagnostics. */
function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Freeze a value together with every container it holds.
 *
 * The snapshot's graph is built by the fabric — every item, provenance ref, and
 * estimate is a copy — so freezing it whole cannot reach into a provider's own
 * objects.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  Object.freeze(value)
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry)
  return value
}
