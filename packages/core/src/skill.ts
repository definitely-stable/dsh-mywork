/**
 * Skill registry and its context provider (architecture §21.2, §21.5, §24,
 * §35, §36).
 *
 * The module has three parts and one boundary between them:
 *
 * - {@link createSkillRegistry} holds versioned skills. A definition is
 *   immutable, `admit` publishes the next revision of it, and `transition`
 *   moves §24's lifecycle. Every write is authorized: §8 gives
 *   `skills.registry` to `skill-registry` alone, so a memory provider that
 *   tries to admit its recall as a skill is refused with `SECURITY_DENIED`
 *   rather than quietly converted.
 * - {@link checkSkillActivation} is the gate. A skill becomes Active only when
 *   it is not archived, no other revision of it is being served, and its
 *   declared compatibility holds against the runtime facts — so an unsupported
 *   skill never activates, and one declined for compatibility keeps its status
 *   instead of being carried into a run.
 * - {@link createSkillContextProvider} is the adapter to §21.5's
 *   `ContextProviderPort`: discovery discloses L0/L1 metadata only, the body is
 *   served when the fabric asks for it by materialization, and the §35 numeric
 *   revision an attempt freezes is minted from the skill definition — which is
 *   why a later revision of a skill does not move a running attempt's snapshot.
 * @module
 */

import {
  SKILL_DEFINITION_FIELDS,
  SKILL_STATUSES,
  SERVED_SKILL_STATUSES,
  skillAppliesTo,
  type ContextCandidate,
  type ContextDiscoveryRequest,
  type ContextLevel,
  type ContextMaterializeRequest,
  type ContextMaterialized,
  type ContextProviderCapabilities,
  type ContextProviderPort,
  type ContextScopeRef,
  type ContextTrustLevel,
  type EpochMs,
  type MyWorkErrorCode,
  type OperationMeta,
  type Revision,
  type SkillActivation,
  type SkillAdmission,
  type SkillAdmissionInput,
  type SkillCompatibility,
  type SkillDefinition,
  type SkillDiscovery,
  type SkillFrozenRevisions,
  type SkillRefusalReason,
  type SkillRefusal,
  type SkillRegistryPort,
  type SkillRevision,
  type SkillRevisionRegistry,
  type SkillRevisionState,
  type SkillRuntimeFacts,
  type SkillServeInput,
  type SkillStatus,
  type SkillTransition,
  type SkillTransitionInput,
  type SkillView,
} from '@dsh-mywork/contracts'
import { assertWriteAuthority } from './authority.ts'
import { MyWorkError } from './errors.ts'
import { isCounter } from './guards.ts'

/**
 * Create a registry of §35's `skill` revision numbers.
 *
 * The fingerprint is the identity, exactly as it is for a resolved
 * configuration state: the same skill definition keeps the number it was first
 * admitted at, a revised definition gets the next one, and a lifecycle
 * transition mints none at all. The counter lives in the process, so it is not
 * durable; the fingerprint is what a persisted skill is compared against.
 * @returns a registry whose numbering starts at 1.
 */
export function createSkillRevisionRegistry(): SkillRevisionRegistry {
  const minted = new Map<string, Revision>()
  return Object.freeze({
    revisionOf(fingerprint: string): Revision {
      requireText(fingerprint, 'a skill fingerprint')
      const existing = minted.get(fingerprint)
      if (existing !== undefined) return existing
      const revision = minted.size + 1
      minted.set(fingerprint, revision)
      return revision
    },
    size: (): number => minted.size,
  })
}

/** Options accepted by {@link createSkillRegistry}. */
export interface SkillRegistryOptions {
  /** Registry that mints §35 skill revisions. Default: a fresh one. */
  readonly revisions?: SkillRevisionRegistry
  /** Definitions to admit at construction. */
  readonly skills?: readonly SkillDefinition[]
  /** Operation identities allowed to write. Default `['skill-registry']`. */
  readonly actors?: readonly string[]
  /** Runtime facts an activation is decided against. */
  readonly facts?: SkillRuntimeFacts
  /** Operation identity of the construction-time admissions. */
  readonly meta?: OperationMeta
  /** Time construction-time admissions are stamped with. */
  readonly nowMs?: number
}

/**
 * Create the skill registry (§24).
 *
 * The registry is the `skill-registry` authority of §8: `admit` and
 * `transition` refuse an actor that does not hold that row, so the registry
 * itself is the boundary against memory records becoming skills by accident.
 * @param options - the revision registry, the seed definitions, and the actors.
 * @returns the registry.
 * @throws {TypeError} when the options themselves are malformed, or when a seed definition is refused.
 */
export function createSkillRegistry(options: SkillRegistryOptions = {}): SkillRegistryPort {
  const revisions = options.revisions ?? createSkillRevisionRegistry()
  const actors = Object.freeze([...(options.actors ?? [DEFAULT_SKILL_ACTOR])])
  for (const actor of actors) requireText(actor, 'a skill registry actor')

  const byId = new Map<string, SkillRevision[]>()
  let facts: SkillRuntimeFacts = Object.freeze({ ...(options.facts ?? {}) })

  /**
   * One skill revision as a view of the chain it lives in.
   *
   * A chain holds one entry per *definition* revision: a lifecycle transition
   * replaces the entry rather than appending a second copy of the same
   * definition, so a reader looking up `r1` finds the state the skill is in and
   * never a superseded one.
   *
   * `current` is "the revision a reader resolves" — the served one when the
   * skill has one, and the newest held otherwise — not "the revision admitted
   * last". A candidate waiting behind a served revision is deliberately not
   * current: the skill is still serving what an attempt pinned.
   */
  function viewOf(id: string, revision: SkillRevision): SkillView {
    const chain = byId.get(id) ?? []
    const resolved = servedIn(id) ?? chain[chain.length - 1]
    return Object.freeze({ revision, current: resolved === revision })
  }

  function servedIn(id: string): SkillRevision | undefined {
    return (byId.get(id) ?? []).find(entry => SERVED_STATUSES.includes(entry.state.status))
  }

  /** The revision a reader resolves: the served one, or the newest one held. */
  function currentOf(id: string): SkillView | undefined {
    const chain = byId.get(id)
    if (chain === undefined || chain.length === 0) return undefined
    return viewOf(id, servedIn(id) ?? chain[chain.length - 1]!)
  }

  /**
   * The revision a lifecycle transition operates on.
   *
   * A caller that pins a revision names it. A caller that does not gets the one
   * the skill is currently in the lifecycle at — the served revision when
   * there is one — rather than whichever revision was admitted last: retiring a
   * skill means retiring what is being served, and a candidate waiting behind
   * it is not what "archive this skill" refers to.
   */
  function transitionTargetOf(id: string, expectedRevision: string | undefined): SkillRevision | undefined {
    const chain = byId.get(id) ?? []
    if (expectedRevision !== undefined) return chain.find(entry => entry.definition.revision === expectedRevision)
    return servedIn(id) ?? chain[chain.length - 1]
  }

  const registry: SkillRegistryPort = {
    list(): readonly SkillView[] {
      const views: SkillView[] = []
      for (const [id, chain] of byId.entries()) {
        for (const revision of chain) views.push(viewOf(id, revision))
      }
      return Object.freeze(views)
    },
    current(id: string): SkillView | undefined {
      requireText(id, 'a skill id')
      return currentOf(id)
    },
    revision(id: string, revision: string): SkillView | undefined {
      requireText(id, 'a skill id')
      requireText(revision, 'a skill revision')
      const chain = byId.get(id)
      if (chain === undefined) return undefined
      const found = chain.find(entry => entry.definition.revision === revision)
      return found === undefined ? undefined : viewOf(id, found)
    },
    admit(input: SkillAdmissionInput): SkillAdmission {
      const skills = input?.skills
      if (!Array.isArray(skills) || skills.length === 0) {
        throw new TypeError('dsh-mywork: admitting skills needs at least one definition')
      }
      const meta = input?.meta
      if (meta === undefined || typeof meta !== 'object') {
        throw new TypeError('dsh-mywork: admitting skills needs operation identity')
      }
      const authority = assertWriteAuthority('skills.registry', SKILL_REGISTRY_AUTHORITY, meta)
      if (!authority.ok) return Object.freeze({ ok: false, code: authority.error.code, message: authority.error.message })
      const writers = input.actors ?? actors
      for (const actor of writers) {
        if (!actors.includes(actor)) return denied(`"${actor}" may not write the skill registry`)
      }
      // Built and validated whole before anything is published: a batch that
      // carries one malformed definition changes nothing, so the registry never
      // holds half an admission.
      const nowMs = input.nowMs ?? Date.now()
      if (!isCounter(nowMs)) throw new TypeError('dsh-mywork: a skill admission needs epoch milliseconds')
      const admitted: SkillRevision[] = []
      for (const definition of skills) {
        const checked = normalizeDefinition(definition)
        // The chain is keyed by the definition's `id`, never by its `name`: two
        // unrelated skills may share a label, and merging them would make one a
        // revision of the other without anyone asking.
        const chain = byId.get(checked.id) ?? []
        const held = chain.find(entry => entry.definition.revision === checked.revision)
        if (held !== undefined) {
          // Re admitting what the registry already holds is not a second
          // revision: the definition is the identity, so the same definition
          // resolves to the number it was first admitted at. Replacing it with
          // a different definition under the same revision is the one thing
          // refused — a revision that answered differently over time would
          // break the pin a running attempt holds.
          if (held.fingerprint !== fingerprintOf(checked)) {
            return Object.freeze({
              ok: false,
              code: 'TASK_CONFLICT',
              message: `dsh-mywork: skill "${checked.id}" already holds revision "${checked.revision}" with another definition`,
            })
          }
          admitted.push(held)
          continue
        }
        admitted.push(freezeRevision(checked, revisions, nowMs))
      }
      for (const revision of admitted) {
        const chain = byId.get(revision.id) ?? []
        const known = chain.some(entry => entry.definition.revision === revision.definition.revision)
        if (known) continue
        byId.set(revision.id, [...chain, revision])
      }
      return Object.freeze({ ok: true, admitted: Object.freeze(admitted.map(revision => viewOf(revision.id, revision))) })
    },
    transition(input: SkillTransitionInput): SkillTransition {
      const id = input?.id
      requireText(id, 'a skill id')
      const meta = input?.meta
      if (meta === undefined || typeof meta !== 'object') {
        throw new TypeError('dsh-mywork: a skill transition needs operation identity')
      }
      const authority = assertWriteAuthority('skills.registry', SKILL_REGISTRY_AUTHORITY, meta)
      if (!authority.ok) return Object.freeze({ ok: false, code: authority.error.code, message: authority.error.message })
      const writers = input.actors ?? actors
      for (const actor of writers) {
        if (!actors.includes(actor)) return denied(`"${actor}" may not write the skill registry`)
      }
      const nowMs = input.nowMs
      if (!isCounter(nowMs)) throw new TypeError('dsh-mywork: a skill transition needs epoch milliseconds')
      const to = input.to
      if (!SKILL_STATUSES.includes(to)) throw new TypeError(`dsh-mywork: "${String(to)}" is not a skill status`)

      const target = transitionTargetOf(id, input.expectedRevision)
      if (target === undefined) {
        return Object.freeze({
          ok: false,
          code: 'STALE_REVISION',
          message:
            input.expectedRevision === undefined
              ? `dsh-mywork: the skill registry holds no skill "${id}"`
              : `dsh-mywork: the skill registry holds no revision "${input.expectedRevision}" of skill "${id}"`,
        })
      }
      const current = viewOf(id, target)
      const from = current.revision.state.status
      if (!isAllowedTransition(from, to)) {
        return Object.freeze({
          ok: false,
          code: 'TASK_CONFLICT',
          message: `dsh-mywork: skill "${id}" may not move from "${from}" to "${to}" (§24 lifecycle)`,
        })
      }
      if (to === 'active') {
        // One serving revision per skill: a skill served twice is a context the
        // fabric cannot pin, so the revision that is being served now has to be
        // retired deliberately before its successor takes over.
        const chain = byId.get(id) ?? []
        const served = chain.find(entry => SERVED_STATUSES.includes(entry.state.status))
        const gate = checkSkillActivation({
          skill: current.revision,
          to,
          facts,
          nowMs,
          ...(served === undefined || served.definition.revision === current.revision.definition.revision
            ? {}
            : { servedRevision: served.definition.revision }),
          ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
        })
        if (!gate.ok) return Object.freeze({ ok: false, code: gate.code, message: gate.message })
      }
      const state = normalizeTransitionState(current.revision.state, to, input, nowMs)
      const next: SkillRevision = Object.freeze({
        ...current.revision,
        state,
      })
      // The entry is replaced in place rather than appended: a chain holds one
      // entry per definition revision, so a lookup of `r1` finds the state the
      // skill is in now and the §35 number the attempt froze is unchanged.
      const chain = byId.get(id) ?? []
      const at = chain.findIndex(entry => entry.definition.revision === next.definition.revision)
      const replaced = at === -1 ? [...chain, next] : [...chain.slice(0, at), next, ...chain.slice(at + 1)]
      byId.set(id, replaced)
      return Object.freeze({ ok: true, view: viewOf(id, next) })
    },
    recordServe(input: SkillServeInput): SkillTransition {
      const id = input?.id
      requireText(id, 'a skill id')
      const revision = input?.revision
      requireText(revision, 'a skill revision')
      const meta = input?.meta
      if (meta === undefined || typeof meta !== 'object') {
        throw new TypeError('dsh-mywork: recording a serve needs operation identity')
      }
      const authority = assertWriteAuthority('skills.registry', SKILL_REGISTRY_AUTHORITY, meta)
      if (!authority.ok) return Object.freeze({ ok: false, code: authority.error.code, message: authority.error.message })
      const writers = input.actors ?? actors
      for (const actor of writers) {
        if (!actors.includes(actor)) return denied(`"${actor}" may not write the skill registry`)
      }
      const nowMs = input.nowMs
      if (!isCounter(nowMs)) throw new TypeError('dsh-mywork: recording a serve needs epoch milliseconds')

      const chain = byId.get(id) ?? []
      const entry = chain.find(candidate => candidate.definition.revision === revision)
      if (entry === undefined) {
        return Object.freeze({
          ok: false,
          code: 'STALE_REVISION',
          message: `dsh-mywork: the skill registry holds no revision "${revision}" of skill "${id}"`,
        })
      }
      if (!SERVED_STATUSES.includes(entry.state.status)) {
        return Object.freeze({
          ok: false,
          code: 'TASK_CONFLICT',
          message: `dsh-mywork: skill "${id}" is ${entry.state.status}, so revision "${revision}" was not served`,
        })
      }
      // State only: the fingerprint is built from the definition, so counting a
      // serve mints no §35 revision and moves no pin.
      const next: SkillRevision = Object.freeze({
        ...entry,
        state: Object.freeze({ ...entry.state, servedCount: entry.state.servedCount + 1 }),
      })
      const at = chain.findIndex(candidate => candidate.definition.revision === revision)
      byId.set(id, [...chain.slice(0, at), next, ...chain.slice(at + 1)])
      return Object.freeze({ ok: true, view: viewOf(id, next) })
    },
    facts(): SkillRuntimeFacts {
      return facts
    },
    observeFacts(next: SkillRuntimeFacts): void {
      if (next === undefined || next === null || typeof next !== 'object') {
        throw new TypeError('dsh-mywork: runtime facts must be an object')
      }
      facts = Object.freeze({ ...next })
    },
  }

  for (const skill of options.skills ?? []) {
    const result = registry.admit({
      skills: [skill],
      actors: [...actors],
      meta: options.meta ?? { operationId: 'skill-registry-seed', correlationId: 'skill-registry-seed' },
    })
    if (!result.ok) throw new TypeError(result.message)
  }
  return Object.freeze(registry)
}

/** Input of {@link checkSkillActivation}. */
export interface SkillActivationInput {
  /** The revision the transition is about. */
  readonly skill: SkillRevision
  /** Status the caller wants to move to. */
  readonly to: SkillStatus
  /** Runtime facts the compatibility is checked against. */
  readonly facts?: SkillRuntimeFacts
  /** Time of the transition, epoch milliseconds. */
  readonly nowMs: number
  /** Revision the caller expects; a different revision is a stale caller. */
  readonly expectedRevision?: string
  /** Definition revision another revision of the same skill is serving; absent when none is. */
  readonly servedRevision?: string
}

/** What {@link checkSkillActivation} decided. */
export type SkillActivationDecision =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly code: 'TASK_CONFLICT' | 'CAPABILITY_UNSUPPORTED' | 'CONTRACT_MISMATCH' | 'STALE_REVISION'
      readonly message: string
    }

/**
 * Decide whether one §24 transition is allowed right now.
 *
 * The gate is deliberately separate from the registry that calls it: activation
 * is the one transition that can put knowledge in front of a model, so it is
 * the one that checks the pinned revision, the revision already being served,
 * and the compatibility the skill declares. Every refusal returns a code and
 * leaves the skill where it was — a skill that cannot be supported here is not
 * activated "for now".
 * @param input - the revision, the target status, the facts, and the time.
 * @returns the decision.
 * @throws {TypeError} when the input itself is malformed.
 */
export function checkSkillActivation(input: SkillActivationInput): SkillActivationDecision {
  const skill = input?.skill
  if (skill === undefined || typeof skill !== 'object') {
    throw new TypeError('dsh-mywork: an activation check needs a skill revision')
  }
  if (!isCounter(input.nowMs)) throw new TypeError('dsh-mywork: an activation check needs epoch milliseconds')
  if (input.to !== 'active') {
    return Object.freeze({ ok: false, code: 'TASK_CONFLICT', message: `dsh-mywork: only "active" is gated by compatibility, not "${String(input.to)}"` })
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== skill.definition.revision) {
    return Object.freeze({
      ok: false,
      code: 'STALE_REVISION',
      message: `dsh-mywork: skill "${skill.id}" is at revision "${skill.definition.revision}", not "${input.expectedRevision}"`,
    })
  }
  if (skill.state.status === 'archived') {
    return Object.freeze({
      ok: false,
      code: 'TASK_CONFLICT',
      message: `dsh-mywork: skill "${skill.id}" is archived and the registry never revives it`,
    })
  }
  if (input.servedRevision !== undefined && input.servedRevision !== skill.definition.revision) {
    return Object.freeze({
      ok: false,
      code: 'TASK_CONFLICT',
      message: `dsh-mywork: skill "${skill.id}" is served at revision "${input.servedRevision}"; it must be retired before "${skill.definition.revision}" is activated`,
    })
  }
  const unmet = skillRequirementUnmet(skill.definition.compatibility, input.facts)
  if (unmet !== undefined) {
    return Object.freeze({
      ok: false,
      code: unmet.reason === 'dependency-unmet' ? 'CAPABILITY_UNSUPPORTED' : 'CONTRACT_MISMATCH',
      message: `dsh-mywork: skill "${skill.id}" ${unmet.detail} (§37)`,
    })
  }
  if (!isValidAt(skill.state, input.nowMs)) {
    return Object.freeze({
      ok: false,
      code: 'TASK_CONFLICT',
      message: `dsh-mywork: skill "${skill.id}" is outside its validity window at ${input.nowMs}`,
    })
  }
  return Object.freeze({ ok: true })
}

/**
 * Why one revision is not being served right now (§21.2, §24), or undefined.
 *
 * This is the single serve rule: discovery and materialization both ask it, so
 * a skill cannot be proposed as context and then have its body handed over
 * after it was retired, went out of its window, or lost its compatibility. The
 * scope is checked only when the caller states scopes — materialization
 * addresses a uri the plan already selected, and scope is a property of the
 * request, not of the item.
 * @param revision - the revision to test.
 * @param input - the scopes of the request (when there is one), the time, and the runtime facts.
 * @returns the reason and a one-line detail, or undefined when it is served.
 */
export function serveRefusal(
  revision: SkillRevision,
  input: { readonly scopes?: readonly ContextScopeRef[]; readonly nowMs: number; readonly facts?: SkillRuntimeFacts },
): { readonly reason: SkillRefusalReason; readonly detail: string } | undefined {
  if (input.scopes !== undefined && !skillAppliesTo(revision.definition.scopes, input.scopes)) {
    return Object.freeze({ reason: 'scope-mismatch', detail: `skill "${revision.id}" is scoped elsewhere` })
  }
  if (!SERVED_STATUSES.includes(revision.state.status)) {
    return Object.freeze({ reason: 'status-not-served', detail: `skill "${revision.id}" is ${revision.state.status}` })
  }
  if (!isValidAt(revision.state, input.nowMs)) {
    return Object.freeze({ reason: 'outside-validity', detail: `skill "${revision.id}" is outside its validity window` })
  }
  const unmet = skillRequirementUnmet(revision.definition.compatibility, input.facts)
  if (unmet !== undefined) {
    return Object.freeze({ reason: unmet.reason, detail: `skill "${revision.id}" ${unmet.detail}` })
  }
  return undefined
}

/**
 * Which declared requirement the runtime does not meet, if any (§37).
 *
 * The two causes are kept apart because they are two different repairs: an
 * adapter whose contract revision moved is not the same incident as a
 * capability flag that was never granted, and a caller that cannot tell them
 * apart cannot act on either.
 * @param compatibility - the requirements the skill declares.
 * @param facts - what the runtime offers; absent means it offers nothing.
 * @returns the unmet requirement, or undefined when every one holds.
 */
export function skillRequirementUnmet(
  compatibility: SkillCompatibility,
  facts: SkillRuntimeFacts | undefined,
): { readonly reason: 'incompatible' | 'dependency-unmet'; readonly detail: string } | undefined {
  if (compatibility.contractVersion !== undefined || compatibility.adapterKind !== undefined) {
    const kind = compatibility.adapterKind
    const held = kind === undefined ? undefined : facts?.contractVersions?.[kind]
    if (kind === undefined) {
      return Object.freeze({
        reason: 'incompatible',
        detail: `declares contract version "${compatibility.contractVersion ?? ''}" without the adapter kind it belongs to`,
      })
    }
    if (held !== compatibility.contractVersion) {
      return Object.freeze({
        reason: 'incompatible',
        detail: `needs "${kind}" at contract "${compatibility.contractVersion ?? ''}" and the runtime holds "${held ?? 'none'}"`,
      })
    }
  }
  for (const [capability, required] of Object.entries(compatibility.requires ?? {})) {
    if (!required) continue
    if (facts?.capabilities?.[capability] !== true) {
      return Object.freeze({ reason: 'dependency-unmet', detail: `requires the capability "${capability}", which was not granted` })
    }
  }
  return undefined
}

/**
 * Whether a skill applies to a set of requested scopes (§24 `scope`).
 * @param skill - the revision to test.
 * @param requested - scopes the context request runs in.
 * @returns true when the skill applies.
 */
export function skillCoversScopes(skill: SkillRevision, requested: readonly ContextScopeRef[]): boolean {
  return skillAppliesTo(skill.definition.scopes, requested)
}

/** Options accepted by {@link createSkillContextProvider}. */
export interface SkillContextProviderOptions {
  /** Registry to serve. */
  readonly registry: SkillRegistryPort
  /** Provider identity candidates carry as their `source`. Default `skill-registry`. */
  readonly provider?: string
  /**
   * Level discovery discloses. §21.2 keeps most items at L0/L1, so the default
   * is L1 — the overview — and L2 is reached by materialization only.
   */
  readonly defaultLevel?: ContextLevel
  /** Relevance every served skill claims, when the caller states none. */
  readonly relevance?: number
  /**
   * Time source of the passes that do not carry one: `discover`, and
   * `activation` called without `nowMs`. Default: the system clock.
   *
   * It is injectable because the decision a validity window takes must be
   * reproducible — a pass that reads a clock nobody can set is a decision no
   * test can pin down.
   */
  readonly now?: () => number
}

/**
 * The §21.5 provider over a skill registry (§24, §36 `SkillProviderPort`).
 *
 * Discovery is metadata-only by construction: the body is never placed on a
 * candidate, whatever level it is disclosed at, so a fabric that selects a
 * skill cannot accidentally carry the whole body into a prompt it budgeted an
 * overview for. The body exists in exactly one place — the answer to
 * {@link ContextProviderPort.materialize}.
 *
 * The same serve rule decides both answers (§24, §21.2): a revision that
 * discovery would not propose is a revision whose body `materialize` refuses,
 * so retiring a skill, leaving its validity window, or losing its compatibility
 * cannot leave a body reachable.
 */
export interface SkillContextProvider extends ContextProviderPort {
  /** Provider identity, for a {@link ContextProviderBinding}. */
  readonly provider: string
  /** Level discovery currently discloses. */
  readonly defaultLevel: ContextLevel
  /**
   * Reading of the clock `discover` and an untimed `activation` use.
   *
   * A caller that wants the frozen revision to describe the pass it just ran
   * reads this and passes the same value to {@link skillRevisions}.
   */
  now(): EpochMs
  /**
   * The skills served for a request, with the decision taken about every skill
   * the registry holds. Diagnostics read this; the fabric reads `discover`.
   *
   * It does not count a serve: it is a question about the registry, not an
   * attempt being given context.
   * @param request - scopes and time of one pass; the time defaults to the provider clock.
   * @returns the served revisions and the per-skill decisions.
   */
  activation(request: SkillDiscoveryInput): SkillDiscovery
  /**
   * §35 skill revisions an attempt freezes, keyed by skill id.
   *
   * One entry per skill the request is served, minted from the skill
   * definition: re-resolving the same definitions yields the same numbers and a
   * revised skill yields a new one — which is exactly what a running attempt
   * must not pick up.
   * @param request - the scopes and time the pass is resolved for.
   * @returns numeric revisions of the §35 `skill` family.
   */
  skillRevisions(request: SkillDiscoveryInput): SkillFrozenRevisions
}

/** Input of {@link SkillContextProvider.activation}. */
export interface SkillDiscoveryInput {
  /** Scopes the request runs in. */
  readonly scopes: readonly ContextScopeRef[]
  /** Time of the pass, epoch milliseconds; absent means the provider clock. */
  readonly nowMs?: EpochMs
}

/**
 * Create the skill context provider (§21.5, §24).
 * @param options - the registry to serve and the disclosure defaults.
 * @returns the provider.
 * @throws {TypeError} when the registry is missing or the default level is not one §21.2 declares.
 */
export function createSkillContextProvider(options: SkillContextProviderOptions): SkillContextProvider {
  const registry = options?.registry
  if (registry === undefined || typeof registry.current !== 'function' || typeof registry.list !== 'function') {
    throw new TypeError('dsh-mywork: a skill context provider needs a skill registry')
  }
  const provider = options.provider ?? DEFAULT_SKILL_SOURCE
  requireText(provider, 'a skill provider identity')
  const defaultLevel = options.defaultLevel ?? DEFAULT_SKILL_LEVEL
  if (defaultLevel !== 'L0' && defaultLevel !== 'L1' && defaultLevel !== 'L2') {
    throw new TypeError(`dsh-mywork: "${String(defaultLevel)}" is not a context level`)
  }
  if (defaultLevel === L2_LEVEL) {
    throw new TypeError('dsh-mywork: discovery discloses L0/L1 only; the body is served by materialization (§21.2)')
  }
  if (options.relevance !== undefined && !(typeof options.relevance === 'number' && Number.isFinite(options.relevance))) {
    throw new TypeError('dsh-mywork: a skill relevance must be a finite number')
  }
  const relevance = options.relevance
  const clock = options.now ?? ((): number => Date.now())
  if (typeof clock !== 'function') throw new TypeError('dsh-mywork: a skill provider clock must be a function')
  const readClock = (): EpochMs => {
    const nowMs = clock()
    if (!isCounter(nowMs)) throw new TypeError('dsh-mywork: the skill provider clock must return epoch milliseconds')
    return nowMs
  }

  function activationOf(input: SkillDiscoveryInput): SkillDiscovery {
    const scopes = requireScopes(input?.scopes)
    const nowMs = input?.nowMs ?? readClock()
    if (!isCounter(nowMs)) throw new TypeError('dsh-mywork: a skill discovery pass needs epoch milliseconds')
    const facts = registry.facts()
    const served: SkillRevision[] = []
    const considered: SkillActivation[] = []
    for (const view of registry.list()) {
      const revision = view.revision
      const refusal = serveRefusal(revision, { scopes, nowMs, facts })
      considered.push(
        Object.freeze({
          revision,
          served: refusal === undefined,
          ...(refusal === undefined ? {} : { reason: refusal.reason }),
          ...(refusal === undefined ? {} : { detail: refusal.detail }),
        }),
      )
      if (refusal === undefined) served.push(revision)
    }
    return Object.freeze({
      served: Object.freeze(served),
      considered: Object.freeze(considered),
      observedAt: nowMs,
    })
  }

  /**
   * Count one serving of every revision a discovery pass proposed (§24 usage stats).
   *
   * The count is written by the serving path and never fails the pass: a
   * registry that refuses to record a serve still served the context, and a
   * bookkeeping write is not a reason to hand an attempt less than it was
   * promised. A refusal is therefore reported to the caller of
   * {@link SkillRegistryPort.recordServe} rather than swallowed here, but
   * `discover` does not turn it into an error.
   */
  function countServes(served: readonly SkillRevision[], nowMs: EpochMs): void {
    for (const revision of served) {
      registry.recordServe({
        id: revision.id,
        revision: revision.definition.revision,
        meta: SERVE_OPERATION,
        nowMs,
      })
    }
  }

  /** The revision one `skill:<id>:<revision>` uri addresses. */
  function skillOf(uri: string): SkillRevision {
    requireText(uri, 'a skill uri')
    const parsed = parseSkillUri(uri)
    if (parsed === undefined) {
      throw new TypeError(`dsh-mywork: "${uri}" is not a skill uri of the form "skill:<id>:<revision>"`)
    }
    const found = registry.revision(parsed.id, parsed.revision)
    if (found === undefined) {
      throw new TypeError(`dsh-mywork: the registry holds no revision "${parsed.revision}" of skill "${parsed.id}"`)
    }
    return found.revision
  }

  const port: SkillContextProvider = {
    provider,
    defaultLevel,
    now: (): EpochMs => readClock(),
    activation(request: SkillDiscoveryInput): SkillDiscovery {
      return activationOf(request)
    },
    skillRevisions(request: SkillDiscoveryInput): SkillFrozenRevisions {
      const discovery = activationOf(request)
      const frozen: Record<string, Revision> = {}
      for (const revision of discovery.served) {
        if (frozen[revision.id] === undefined) frozen[revision.id] = revision.snapshotRevision
      }
      return Object.freeze(frozen)
    },
    async capabilities(): Promise<ContextProviderCapabilities> {
      const scopeKinds = new Set<string>()
      for (const view of registry.list()) {
        for (const scope of view.revision.definition.scopes) scopeKinds.add(scope.kind)
      }
      return Object.freeze({
        levels: Object.freeze(['L0', 'L1', 'L2'] as ContextLevel[]),
        onDemandMaterialization: true,
        classes: Object.freeze(['skill']),
        scopeKinds: Object.freeze([...scopeKinds].sort()),
      })
    },
    async discover(request: ContextDiscoveryRequest): Promise<readonly ContextCandidate[]> {
      if (request === undefined || !Array.isArray(request.scopes)) {
        throw new TypeError('dsh-mywork: a skill discovery request needs scopes')
      }
      const scopes = requireScopes(request.scopes)
      if (request.classes !== undefined && !request.classes.includes(SKILL_CLASS)) {
        // The fabric asks for classes it wants; a provider that cannot serve any
        // of them answers with nothing rather than with what it felt like.
        return Object.freeze([])
      }
      const nowMs = readClock()
      const discovery = activationOf({ scopes, nowMs })
      countServes(discovery.served, nowMs)
      return Object.freeze(discovery.served.map(revision => candidateOf(provider, revision, defaultLevel, relevance)))
    },
    async materialize(request: ContextMaterializeRequest): Promise<ContextMaterialized> {
      if (request === undefined || typeof request.uri !== 'string') {
        throw new TypeError('dsh-mywork: a skill materialization needs a uri')
      }
      const revision = skillOf(request.uri)
      const requested = request.level ?? L2_LEVEL
      // A body is the one thing discovery never handed out. Anything below the
      // full level is a caller asking for the wrong thing, whether it wants a
      // body it was never promised or an abstract it may already hold.
      if (requested !== L2_LEVEL) {
        throw new TypeError(
          `dsh-mywork: "${request.uri}" was disclosed at ${defaultLevel}; a body is served at ${L2_LEVEL} only`,
        )
      }
      // The same rule discovery applies. Without it a skill retired between the
      // pass and the fetch — or one whose adapter contract moved — would still
      // hand over its body, and §24's "only Active is served" would hold for the
      // proposal while failing for the content.
      const refusal = serveRefusal(revision, { nowMs: readClock(), facts: registry.facts() })
      if (refusal !== undefined) {
        throw new MyWorkError(MATERIALIZE_REFUSAL_CODES[refusal.reason], `dsh-mywork: ${refusal.detail}`, {
          details: { uri: request.uri, reason: refusal.reason, status: revision.state.status },
        })
      }
      const hash = contentHashOf(revision)
      if (request.expectedRevision !== undefined && request.expectedRevision !== revision.definition.revision) {
        throw new TypeError(
          `dsh-mywork: skill "${revision.id}" is at revision "${revision.definition.revision}", not "${request.expectedRevision}"`,
        )
      }
      if (request.expectedContentHash !== undefined && request.expectedContentHash !== hash) {
        throw new TypeError(`dsh-mywork: skill "${revision.id}" hashes to "${hash}", not "${request.expectedContentHash}"`)
      }
      const text = bodyTextOf(revision)
      const tokens = estimatedTokensOf(revision, text)
      return Object.freeze({
        uri: request.uri,
        level: L2_LEVEL,
        revision: revision.definition.revision,
        contentHash: hash,
        content: Object.freeze({ mediaType: revision.definition.mediaType, text }),
        ...(tokens === undefined ? {} : { estimatedTokens: tokens }),
        provenance: Object.freeze([
          Object.freeze({
            source: provider,
            uri: request.uri,
            revision: revision.definition.revision,
            contentHash: hash,
          }),
        ]),
      })
    },
  }
  return Object.freeze(port)
}

/**
 * The §42 code a refusal becomes when a caller asks for a body (§21.5).
 *
 * A refusal has to reach the fabric as a failure of the port, so it carries a
 * code from the shared vocabulary rather than an adapter-private string.
 */
const MATERIALIZE_REFUSAL_CODES: Readonly<Record<SkillRefusalReason, MyWorkErrorCode>> = Object.freeze({
  'scope-mismatch': 'TASK_CONFLICT',
  'status-not-served': 'TASK_CONFLICT',
  'outside-validity': 'TASK_CONFLICT',
  incompatible: 'CONTRACT_MISMATCH',
  'dependency-unmet': 'CAPABILITY_UNSUPPORTED',
})

/** Operation identity of a serve the provider counts (§9). */
const SERVE_OPERATION: OperationMeta = Object.freeze({
  operationId: 'skill-registry-serve',
  correlationId: 'skill-registry-serve',
})

/** Provider identity a skill candidate carries by default. */
export const DEFAULT_SKILL_SOURCE = 'skill-registry'

/** Level discovery discloses by default: §21.2's overview. */
export const DEFAULT_SKILL_LEVEL: ContextLevel = 'L1'

/** The one context class a skill candidate carries (§21.3). */
export const SKILL_CLASS = 'skill'

/** The authority of §8 that owns the skill registry. */
const SKILL_REGISTRY_AUTHORITY = 'skill-registry'

/** Default operation identity allowed to write the registry. */
const DEFAULT_SKILL_ACTOR = 'skill-registry'

/** Statuses §24's provider serves. */
const SERVED_STATUSES: readonly SkillStatus[] = SERVED_SKILL_STATUSES

/** §21.2's full level, the only one that carries a body. */
const L2_LEVEL: ContextLevel = 'L2'

/** The uri scheme of one skill revision: `skill:<id>:<revision>`. */
const SKILL_URI_PREFIX = 'skill:'

/** {@link SkillStatus} transitions of §24 (`Candidate → Active → Stale → Archived`). */
const SKILL_TRANSITIONS: Readonly<Record<SkillStatus, readonly SkillStatus[]>> = Object.freeze({
  candidate: Object.freeze(['active', 'archived'] as SkillStatus[]),
  active: Object.freeze(['stale', 'archived'] as SkillStatus[]),
  stale: Object.freeze(['active', 'archived'] as SkillStatus[]),
  archived: Object.freeze([] as SkillStatus[]),
})

/**
 * Whether §24's lifecycle allows one move.
 * @param from - current status.
 * @param to - status the caller wants.
 */
export function isAllowedSkillTransition(from: SkillStatus, to: SkillStatus): boolean {
  return isAllowedTransition(from, to)
}

/** Whether one pair of statuses is a move §24 declares. */
function isAllowedTransition(from: SkillStatus, to: SkillStatus): boolean {
  return (SKILL_TRANSITIONS[from] ?? []).includes(to)
}

/** Every status one may move to from `from`, for callers that render the lifecycle. */
export function skillTransitionTargets(from: SkillStatus): readonly SkillStatus[] {
  return SKILL_TRANSITIONS[from] ?? Object.freeze([])
}

/**
 * The uri one skill revision is addressed by.
 * @param id - skill identifier.
 * @param revision - revision of the definition.
 */
export function skillUri(id: string, revision: string): string {
  requireText(id, 'a skill id')
  requireText(revision, 'a skill revision')
  return `${SKILL_URI_PREFIX}${id}:${revision}`
}

/** The L0/L1 text of one skill: metadata only, never the body. */
function metadataTextOf(revision: SkillRevision, level: ContextLevel): string {
  const definition = revision.definition
  const lines = [`${definition.name} — ${definition.description}`]
  if (level === 'L1') {
    lines.push(`usage: ${definition.usage}`)
    if (definition.constraints.length > 0) lines.push(`constraints: ${definition.constraints.join('; ')}`)
    lines.push(`status: ${revision.state.status} | version: ${definition.version} | trust: ${definition.trust}`)
  }
  return lines.join('\n')
}

/** The L2 body of one skill: the procedural knowledge itself. */
function bodyTextOf(revision: SkillRevision): string {
  return revision.definition.body
}

/** The media type a skill candidate discloses at L0/L1. */
function metadataMediaType(revision: SkillRevision): string {
  return revision.definition.mediaType
}

/** Build the candidate one served skill is disclosed as. */
function candidateOf(
  source: string,
  revision: SkillRevision,
  level: ContextLevel,
  relevance: number | undefined,
): ContextCandidate {
  const definition = revision.definition
  const text = metadataTextOf(revision, level)
  const hash = contentHashOf(revision)
  const uri = skillUri(definition.id, definition.revision)
  return Object.freeze({
    uri,
    source,
    kind: SKILL_CLASS,
    scopes: Object.freeze(definition.scopes.map(scope => Object.freeze({ kind: scope.kind, id: scope.id }))),
    level,
    ...(relevance === undefined ? {} : { relevance }),
    trust: definition.trust,
    revision: definition.revision,
    contentHash: hash,
    estimatedTokens: estimatedTokensOf(revision, text) as number,
    provenance: Object.freeze([
      Object.freeze({
        source,
        uri,
        revision: definition.revision,
        contentHash: hash,
      }),
    ]),
    content: Object.freeze({ mediaType: metadataMediaType(revision), text }),
    materializeRef: uri,
  })
}

/** The content hash of one skill revision: the state's when stated, a deterministic one otherwise. */
function contentHashOf(revision: SkillRevision): string {
  return revision.definition.contentHash ?? fnv1a(revision.definition.body)
}

/** The token estimate of one text, computed when the publisher measured none. */
function estimatedTokensOf(revision: SkillRevision, text: string): number | undefined {
  if (revision.definition.estimatedTokens !== undefined) return revision.definition.estimatedTokens
  return estimateTokens(text)
}

/**
 * Deterministic size estimate of one text, in tokens.
 *
 * It is the same heuristic the adapter fakes use: a stated estimate always
 * wins, and this only fills a gap, so a body never looks free to the budget.
 * @param text - the text to estimate.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

/** Deterministic content hash (FNV-1a), the format the adapter fakes publish. */
function fnv1a(text: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/** Parse `skill:<id>:<revision>` back into its two parts. */
function parseSkillUri(uri: string): { readonly id: string; readonly revision: string } | undefined {
  if (!uri.startsWith(SKILL_URI_PREFIX)) return undefined
  const rest = uri.slice(SKILL_URI_PREFIX.length)
  const separator = rest.lastIndexOf(':')
  if (separator <= 0 || separator === rest.length - 1) return undefined
  const id = rest.slice(0, separator)
  const revision = rest.slice(separator + 1)
  if (id === '' || revision === '') return undefined
  return Object.freeze({ id, revision })
}

/** Validate and freeze the scopes of one request. */
function requireScopes(scopes: readonly ContextScopeRef[]): readonly ContextScopeRef[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new TypeError('dsh-mywork: a skill request needs at least one scope')
  }
  return Object.freeze(
    scopes.map(scope => {
      if (scope === null || typeof scope !== 'object') throw new TypeError('dsh-mywork: a scope must be an object')
      requireText((scope as ContextScopeRef).kind, 'a scope kind')
      requireText((scope as ContextScopeRef).id, 'a scope id')
      return Object.freeze({ kind: (scope as ContextScopeRef).kind, id: (scope as ContextScopeRef).id })
    }),
  )
}

/** Whether a state's validity window covers a moment. */
function isValidAt(state: SkillRevisionState, nowMs: number): boolean {
  if (state.validFrom !== undefined && nowMs < state.validFrom) return false
  if (state.validUntil !== undefined && nowMs > state.validUntil) return false
  return true
}

/** Freeze one admitted definition into a revision, minting its §35 number. */
function freezeRevision(definition: SkillDefinition, revisions: SkillRevisionRegistry, nowMs: number): SkillRevision {
  const fingerprint = fingerprintOf(definition)
  return Object.freeze({
    id: definition.id,
    definition,
    state: Object.freeze({
      status: 'candidate',
      servedCount: 0,
      statusChangedAt: nowMs,
    }),
    snapshotRevision: revisions.revisionOf(fingerprint),
    fingerprint,
  })
}

/**
 * The identity of one skill definition (§35).
 *
 * Only the definition is fingerprinted, in a fixed key order, so two admissions
 * of the same content mint one revision and a lifecycle transition — or a
 * counted serve, which changes state alone — mints none.
 */
function fingerprintOf(definition: SkillDefinition): string {
  return JSON.stringify([
    definition.id,
    definition.name,
    definition.revision,
    definition.description,
    definition.scopes.map(scope => [scope.kind, scope.id]),
    definition.version,
    definition.trust,
    definition.compatibility.contractVersion ?? null,
    definition.compatibility.adapterKind ?? null,
    Object.entries(definition.compatibility.requires ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    definition.usage,
    definition.constraints,
    definition.body,
    definition.mediaType,
    definition.estimatedTokens ?? null,
    definition.provenance,
  ])
}

/** Validate a definition a caller submitted, and freeze it. */
function normalizeDefinition(definition: SkillDefinition): SkillDefinition {
  if (definition === null || typeof definition !== 'object') {
    throw new TypeError('dsh-mywork: a skill definition must be an object')
  }
  for (const field of Object.keys(definition)) {
    if (!SKILL_DEFINITION_FIELDS.includes(field)) {
      throw new TypeError(`dsh-mywork: a skill definition carries "${field}", which §24 does not declare`)
    }
  }
  requireText(definition.name, 'a skill name')
  requireAddressable(definition.id, 'a skill id')
  requireText(definition.description, 'a skill description')
  requireAddressable(definition.version, 'a skill version')
  requireAddressable(definition.revision, 'a skill revision')
  requireText(definition.usage, 'a skill usage')
  requireText(definition.mediaType, 'a skill media type')
  if (definition.trust !== 'trusted' && definition.trust !== 'untrusted') {
    throw new TypeError(`dsh-mywork: "${String(definition.trust)}" is not a context trust level`)
  }
  if (!Array.isArray(definition.scopes)) throw new TypeError('dsh-mywork: a skill needs a scope list')
  requireScopes(definition.scopes)
  if (!Array.isArray(definition.constraints)) throw new TypeError('dsh-mywork: a skill needs a constraint list')
  for (const constraint of definition.constraints) requireText(constraint, 'a skill constraint')
  if (!Array.isArray(definition.provenance)) throw new TypeError('dsh-mywork: a skill needs a provenance list')
  for (const entry of definition.provenance) requireText(entry, 'a skill provenance entry')
  if (typeof definition.body !== 'string') throw new TypeError('dsh-mywork: a skill body must be a string')
  if (definition.estimatedTokens !== undefined && !isCounter(definition.estimatedTokens)) {
    throw new TypeError('dsh-mywork: a skill token estimate must be a non-negative integer')
  }
  if (definition.contentHash !== undefined) requireText(definition.contentHash, 'a skill content hash')
  const compatibility = definition.compatibility ?? {}
  if (typeof compatibility !== 'object') throw new TypeError('dsh-mywork: skill compatibility must be an object')
  for (const field of Object.keys(compatibility)) {
    if (field !== 'contractVersion' && field !== 'adapterKind' && field !== 'requires') {
      throw new TypeError(`dsh-mywork: a skill compatibility carries "${field}", which §24 does not declare`)
    }
  }
  if (compatibility.contractVersion !== undefined) requireText(compatibility.contractVersion, 'a contract version')
  if (compatibility.adapterKind !== undefined) requireText(compatibility.adapterKind, 'an adapter kind')
  for (const [capability, required] of Object.entries(compatibility.requires ?? {})) {
    requireText(capability, 'a capability name')
    if (typeof required !== 'boolean') throw new TypeError(`dsh-mywork: capability "${capability}" must be a boolean`)
  }
  return Object.freeze({
    name: definition.name,
    id: definition.id,
    description: definition.description,
    scopes: Object.freeze(definition.scopes.map(scope => Object.freeze({ kind: scope.kind, id: scope.id }))),
    version: definition.version,
    trust: definition.trust as ContextTrustLevel,
    compatibility: Object.freeze({ ...compatibility }),
    revision: definition.revision,
    usage: definition.usage,
    constraints: Object.freeze([...definition.constraints]),
    body: definition.body,
    mediaType: definition.mediaType,
    ...(definition.estimatedTokens === undefined ? {} : { estimatedTokens: definition.estimatedTokens }),
    ...(definition.contentHash === undefined ? {} : { contentHash: definition.contentHash }),
    provenance: Object.freeze([...definition.provenance]),
  })
}

/** Build the state one transition publishes. */
function normalizeTransitionState(
  current: SkillRevisionState,
  to: SkillStatus,
  input: SkillTransitionInput,
  nowMs: number,
): SkillRevisionState {
  if (input.validFrom !== undefined && !isCounter(input.validFrom)) {
    throw new TypeError('dsh-mywork: a validity start must be epoch milliseconds')
  }
  if (input.validUntil !== undefined && !isCounter(input.validUntil)) {
    throw new TypeError('dsh-mywork: a validity end must be epoch milliseconds')
  }
  if (input.validFrom !== undefined && input.validUntil !== undefined && input.validFrom > input.validUntil) {
    throw new TypeError('dsh-mywork: a validity window must start no later than it ends')
  }
  const validFrom = input.validFrom ?? current.validFrom
  const validUntil = input.validUntil ?? current.validUntil
  const lastValidatedAt = to === 'active' ? nowMs : current.lastValidatedAt
  return Object.freeze({
    status: to,
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validUntil === undefined ? {} : { validUntil }),
    servedCount: current.servedCount,
    ...(lastValidatedAt === undefined ? {} : { lastValidatedAt }),
    statusChangedAt: nowMs,
  })
}

/** The refusal an unauthorized writer gets, in the shape both writes answer with. */
function denied(message: string): SkillRefusal {
  return Object.freeze({ ok: false, code: 'SECURITY_DENIED', message: `dsh-mywork: ${message}` })
}

/** Reject an empty or non-string text field. */
function requireText(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`dsh-mywork: ${field} must be a non-empty string`)
  }
}

/**
 * Reject a value that cannot be part of a `skill:<id>:<revision>` uri.
 *
 * A revision is addressed by joining the two halves with a colon, so a colon
 * inside either half makes the address ambiguous and the uri unresolvable. The
 * refusal happens at admission, where the author can still rename, instead of at
 * materialization, where the failure would read as "the registry holds no such
 * revision".
 * @param value - the text to check.
 * @param field - what the text is, for the message.
 */
function requireAddressable(value: unknown, field: string): void {
  requireText(value, field)
  if ((value as string).includes(':')) {
    throw new TypeError(
      `dsh-mywork: ${field} may not contain ":", because a skill revision is addressed as "skill:<id>:<revision>"`,
    )
  }
}
