/**
 * Memory Fabric, its lifecycle, and its context provider (architecture §21.3,
 * §21.5, §23, §35, §49, §52; §62 items 20, 24 and 25).
 *
 * The module has three parts and one boundary between them:
 *
 * - {@link createMemoryFabric} is the policy §23 describes. It routes a scope
 *   to the one provider that writes it (§23.9), runs §23.4's pipeline over a
 *   proposal — scope classification, source trust, deduplication, conflict
 *   detection, validation — writes through that provider, and decides what a
 *   recall may serve. It holds no records of its own: providers do, and the
 *   fabric keeps only the routing index it needs to address what it admitted.
 * - {@link memoryServeRefusal} is the one serving rule: lifecycle status,
 *   validity window, scope, kind, minimum trust and query are checked in one
 *   place, so a record cannot be reachable on one path and refused on another.
 * - {@link createMemoryContextProvider} is the adapter to §21.5's
 *   `ContextProviderPort`. Discovery proposes records as candidates at L0/L1,
 *   materialization serves the statement and its provenance *references*, and
 *   nothing on either path can carry a source's bytes: §23.5 states provenance
 *   as references, and a record made from a raw transcript therefore cites it
 *   without containing it.
 *
 * §49 is the reason degradation is a policy rather than a fallback: memory that
 * is unavailable continues an attempt only where the route says the memory is
 * optional, and every degraded answer carries a diagnostic. A *write* never
 * degrades — a record that did not land is refused, because an unwritten memory
 * reported as written is a false record, not a degraded one.
 * @module
 */

import {
  DEFAULT_MEMORY_POLICY,
  GLOBAL_MEMORY_SCOPE,
  MEMORY_REFUSAL_CODES,
  MEMORY_SCOPE_TYPES,
  MEMORY_STATUSES,
  MEMORY_TRUST_CLASSES,
  MEMORY_VALIDATIONS,
  SERVED_MEMORY_STATUSES,
  contextScopeOfMemory,
  contextTrustOfMemoryTrust,
  isAllowedMemoryTransition,
  memoryRouteMatches,
  memoryScopeChain,
  memoryScopeKey,
  memoryScopeOfContext,
  memoryScopeWithin,
  memoryTrustRank,
  memoryUri,
  memoryValidAt,
  type ClockPort,
  type ContextCandidate,
  type ContextDiscoveryRequest,
  type ContextLevel,
  type ContextMaterializeRequest,
  type ContextMaterialized,
  type ContextProviderCapabilities,
  type ContextProviderPort,
  type ContextProvenanceRef,
  type ContextScopeRef,
  type EpochMs,
  type MemoryDiagnostic,
  type MemoryDiagnosticCode,
  type MemoryFabricPort,
  type MemoryKind,
  type MemoryNamespaceRevision,
  type MemoryPolicy,
  type MemoryProposal,
  type MemoryProviderBinding,
  type MemoryProviderPort,
  type MemoryProviderReflectOutcome,
  type MemoryRecallRequest,
  type MemoryRecallResult,
  type MemoryRecord,
  type MemoryReflectRequest,
  type MemoryReflectResult,
  type MemoryRefusal,
  type MemoryRefusalReason,
  type MemoryResolveResult,
  type MemoryRetainRequest,
  type MemoryRetainResult,
  type MemoryRevisionRegistry,
  type MemoryRoute,
  type MemoryScopeRef,
  type MemoryServingDecision,
  type MemoryServingReason,
  type MemorySourceRef,
  type MemoryStatus,
  type MemoryTransitionRequest,
  type MemoryTransitionResult,
  type MemoryTrustClass,
  type MemoryValidateRequest,
  type MyWorkErrorCode,
  type OperationMeta,
  type Revision,
} from '@dsh-mywork/contracts'
import { assertWriteAuthority } from './authority.ts'
import { MyWorkError } from './errors.ts'
import { isCounter } from './guards.ts'

/**
 * Create a registry of §35's `memory` revision numbers.
 *
 * The fingerprint is the identity, exactly as it is for a skill definition or a
 * resolved configuration state: the same memory content keeps the number it was
 * first retained at, revised content gets the next one, and a lifecycle move
 * mints none at all. The counter lives in the process, so it is not durable;
 * the fingerprint is what a persisted record is compared against.
 * @returns a registry whose numbering starts at 1.
 */
export function createMemoryRevisionRegistry(): MemoryRevisionRegistry {
  const minted = new Map<string, Revision>()
  return Object.freeze({
    revisionOf(fingerprint: string): Revision {
      requireText(fingerprint, 'a memory fingerprint')
      const existing = minted.get(fingerprint)
      if (existing !== undefined) return existing
      const revision = minted.size + 1
      minted.set(fingerprint, revision)
      return revision
    },
    size: (): number => minted.size,
  })
}

/** Options accepted by {@link createMemoryFabric}. */
export interface MemoryFabricOptions {
  /** Providers the routes may name, by id (§44 binding). */
  readonly providers?: readonly MemoryProviderBinding[]
  /** Routes, timeout and diagnostic bound (§23.9, §49). Default: every scope unrouted. */
  readonly policy?: MemoryPolicy
  /** Registry that mints §35 memory revisions. Default: a fresh one. */
  readonly revisions?: MemoryRevisionRegistry
  /** Operation identities allowed to write. Default `['memory-provider']`. */
  readonly actors?: readonly string[]
  /**
   * Time source of the calls that do not carry a time. Default: the system
   * clock.
   *
   * The *deadline* is not taken from it: a timeout a caller can advance is not
   * a timeout, so the deadline is a wall-clock timer whatever clock stamps the
   * records.
   */
  readonly clock?: ClockPort
  /**
   * Mints the identity of the next record, when the deployment has to.
   *
   * The default — `mem-<fabric instance>-<n>` — is unique within one process and
   * repeats across a restart. That is invisible to a provider that loses its
   * store with the process, and fatal to one that keeps it: the second process
   * mints an id the store already holds, and a provider that refuses to rewrite
   * a record's content refuses the write. A durable provider therefore supplies
   * its own source here — the Beads provider continues the sequence its
   * workspace already holds — and the fabric awaits it so a source that has to
   * read the store can answer.
   */
  readonly nextId?: () => string | Promise<string>
}

/**
 * Create the Memory Fabric (§23).
 *
 * The fabric is the `memory-provider` authority of §8: a write names its actor,
 * and an actor that does not hold that row is refused with `SECURITY_DENIED`
 * rather than trusted.
 * @param options - the providers, the routing policy, and the clock.
 * @returns the fabric.
 * @throws {TypeError} when the options themselves are malformed.
 */
export function createMemoryFabric(options: MemoryFabricOptions = {}): MemoryFabricPort {
  const bindings = options.providers ?? []
  const providers = new Map<string, MemoryProviderPort>()
  for (const binding of bindings) {
    if (binding === null || typeof binding !== 'object') {
      throw new TypeError('dsh-mywork: a memory binding must be an object')
    }
    requireText(binding.provider, 'a memory provider id')
    if (binding.port === null || typeof binding.port !== 'object') {
      throw new TypeError(`dsh-mywork: memory provider "${binding.provider}" has no port`)
    }
    providers.set(binding.provider, binding.port)
  }
  const policy = normalizePolicy(options.policy ?? DEFAULT_MEMORY_POLICY)
  const revisions = options.revisions ?? createMemoryRevisionRegistry()
  const actors = Object.freeze([...(options.actors ?? [DEFAULT_MEMORY_ACTOR])])
  for (const actor of actors) requireText(actor, 'a memory actor')
  const clock = options.clock ?? systemClock()

  /** Where each admitted record lives, so a reference can be routed back (§23.9). */
  const locator = new Map<string, { readonly provider: string; readonly scope: MemoryScopeRef }>()
  /**
   * Mints the identity of the next record; the fabric mints ids so a writer
   * cannot choose its own.
   *
   * The counter is scoped to this fabric instance rather than to the process:
   * two fabrics may be bound to one provider, and a shared counter would make
   * the second one mint an id the provider already holds — which the provider
   * rightly refuses as a conflict, blaming the record for a collision the
   * fabric caused. A provider that outlives the process still needs an id source
   * of its own, and that is {@link MemoryFabricOptions.nextId}.
   */
  let minted = 0
  const instance = ++FABRIC_SEQUENCE
  /** Diagnostics the fabric kept, newest last (§33). */
  const log: MemoryDiagnostic[] = []

  /** The next record id: the deployment's source when it named one, else the counter. */
  async function mintRecordId(): Promise<string> {
    const source = options.nextId
    if (source === undefined) return `mem-${instance}-${++minted}`
    const id = await source()
    requireText(id, 'a minted memory id')
    return id
  }

  function diagnose(
    code: MemoryDiagnosticCode,
    detail: string,
    at: EpochMs,
    extra: { readonly scope?: MemoryScopeRef; readonly provider?: string } = {},
  ): MemoryDiagnostic {
    const entry: MemoryDiagnostic = Object.freeze({ code, detail, at, ...extra })
    log.push(entry)
    while (log.length > policy.diagnosticLimit) log.shift()
    return entry
  }

  /** A refusal carrying the diagnostics the same call produced. */
  function refuse(
    reason: MemoryRefusalReason,
    message: string,
    diagnostics: readonly MemoryDiagnostic[],
    code?: MyWorkErrorCode,
  ): MemoryRefusal {
    const prefix = 'dsh-mywork: '
    return Object.freeze({
      ok: false,
      code: code ?? MEMORY_REFUSAL_CODES[reason],
      reason,
      message: message.startsWith(prefix) ? message : `${prefix}${message}`,
      diagnostics: Object.freeze([...diagnostics]),
    })
  }

  function readClock(): EpochMs {
    const nowMs = clock.now()
    if (!isCounter(nowMs)) throw new TypeError('dsh-mywork: the memory clock must return epoch milliseconds')
    return nowMs
  }

  function routeFor(scope: MemoryScopeRef): MemoryRoute | undefined {
    return policy.routes.find(route => memoryRouteMatches(route, scope))
  }

  /**
   * The one provider that owns a scope (§23.9).
   *
   * A scope with no route, or a route naming a provider that is not bound, has
   * no primary writer: the call is refused rather than written somewhere else.
   */
  function primaryFor(
    scope: MemoryScopeRef,
  ):
    | { readonly ok: true; readonly route: MemoryRoute; readonly port: MemoryProviderPort }
    | { readonly ok: false; readonly reason: MemoryRefusalReason; readonly detail: string } {
    const route = routeFor(scope)
    if (route === undefined) {
      return { ok: false, reason: 'scope-unrouted', detail: `no memory route matches scope "${memoryScopeKey(scope)}"` }
    }
    const port = providers.get(route.primary)
    if (port === undefined) {
      return {
        ok: false,
        reason: 'scope-unrouted',
        detail: `the route for scope "${memoryScopeKey(scope)}" names provider "${route.primary}", which is not bound`,
      }
    }
    return { ok: true, route, port }
  }

  /**
   * One bounded provider interaction: availability first, then the call (§49).
   *
   * Availability is asked before every call rather than cached: a provider that
   * went away must be seen by the call that would have used it. The scope is
   * the one the observation is about, and a reference lookup that does not know
   * one yet passes none rather than inventing a scope to blame.
   */
  async function callProvider<T>(
    providerId: string,
    scope: MemoryScopeRef | undefined,
    at: EpochMs,
    call: (port: MemoryProviderPort) => Promise<T>,
  ): Promise<
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly reason: 'provider-unavailable' | 'timeout' | 'conflict'; readonly diagnostic: MemoryDiagnostic }
  > {
    const about = scope === undefined ? { provider: providerId } : { scope, provider: providerId }
    const port = providers.get(providerId)
    if (port === undefined) {
      const detail = `provider "${providerId}" is not bound`
      return { ok: false, reason: 'provider-unavailable', diagnostic: diagnose('route-missing', detail, at, about) }
    }
    try {
      const health = await withDeadline(() => port.health(), policy.timeoutMs)
      if (!health.available) {
        const code: MemoryDiagnosticCode = health.reason === 'disabled' ? 'disabled' : 'provider-unavailable'
        const detail = `provider "${providerId}" is unavailable: ${health.detail ?? health.reason ?? 'no reason given'}`
        return { ok: false, reason: 'provider-unavailable', diagnostic: diagnose(code, detail, at, about) }
      }
    } catch (error) {
      if (error instanceof MemoryDeadlineExceeded) {
        const detail = `provider "${providerId}" did not answer its health check inside ${policy.timeoutMs}ms`
        return { ok: false, reason: 'timeout', diagnostic: diagnose('timeout', detail, at, about) }
      }
      const detail = `provider "${providerId}" failed its health check: ${messageOf(error)}`
      return { ok: false, reason: 'provider-unavailable', diagnostic: diagnose('provider-unavailable', detail, at, about) }
    }
    try {
      return { ok: true, value: await withDeadline(() => call(port), policy.timeoutMs) }
    } catch (error) {
      if (error instanceof MemoryDeadlineExceeded) {
        const detail = `provider "${providerId}" exceeded the ${policy.timeoutMs}ms deadline`
        return { ok: false, reason: 'timeout', diagnostic: diagnose('timeout', detail, at, about) }
      }
      if (errorCodeOf(error) === 'TASK_CONFLICT') {
        const detail = `provider "${providerId}" refused the write: ${messageOf(error)}`
        return { ok: false, reason: 'conflict', diagnostic: diagnose('conflict', detail, at, about) }
      }
      const detail = `provider "${providerId}" failed the call: ${messageOf(error)}`
      return { ok: false, reason: 'provider-unavailable', diagnostic: diagnose('provider-unavailable', detail, at, about) }
    }
  }

  /**
   * The record one reference names, or why it could not be read.
   *
   * §52 permits a *reference* link across workspaces, so a reference is looked
   * up by identity rather than by scope: the locator is a cache of where the
   * fabric last saw a record, not the source of truth — an id that came from a
   * snapshot, or one a provider was seeded with before this fabric existed,
   * resolves like any other. Enumeration stays scope-bound (`recall`), and the
   * providers asked here are the ones the routes name, in route order.
   *
   * Two failures are told apart, because they lead a caller in opposite
   * directions. A provider the fabric *knows* holds the record, which cannot
   * answer, is an outage: the reference is neither resolved nor refuted, and
   * retrying is the right response. A provider the fabric cannot attribute the
   * reference to, which cannot answer, leaves the reference unknown — that is
   * reported as the invalid reference it is, with the unanswered provider
   * carried along as a diagnostic, so a typo does not become a retry loop.
   */
  async function fetchOwned(
    id: string,
    at: EpochMs,
  ): Promise<
    | { readonly kind: 'found'; readonly record: MemoryRecord; readonly provider: string }
    | { readonly kind: 'missing'; readonly unanswered?: MemoryDiagnostic }
    | { readonly kind: 'failed'; readonly reason: 'provider-unavailable' | 'timeout' | 'conflict'; readonly diagnostic: MemoryDiagnostic }
  > {
    requireText(id, 'a memory id')
    const located = locator.get(id)
    if (located !== undefined) {
      const direct = await readFrom(located.provider, located.scope, id, at)
      if (direct.kind === 'found') return direct
      if (direct.kind === 'failed') return { kind: 'failed', reason: direct.reason, diagnostic: direct.diagnostic }
    }
    // Not in the cache, or the cached provider no longer holds it: ask the
    // providers the policy names, once each, in route order.
    let unanswered: MemoryDiagnostic | undefined
    for (const providerId of routedProviders()) {
      const found = await readFrom(providerId, undefined, id, at)
      if (found.kind === 'found') return found
      if (found.kind === 'failed' && unanswered === undefined) unanswered = found.diagnostic
    }
    return unanswered === undefined ? { kind: 'missing' } : { kind: 'missing', unanswered }
  }

  /** One provider's answer about one reference. */
  async function readFrom(
    providerId: string,
    scope: MemoryScopeRef | undefined,
    id: string,
    at: EpochMs,
  ): Promise<
    | { readonly kind: 'found'; readonly record: MemoryRecord; readonly provider: string }
    | { readonly kind: 'missing' }
    | { readonly kind: 'failed'; readonly reason: 'provider-unavailable' | 'timeout' | 'conflict'; readonly diagnostic: MemoryDiagnostic }
  > {
    const outcome = await callProvider(providerId, scope, at, async port => {
      const capabilities = await port.capabilities()
      if (capabilities.resolve && typeof port.resolve === 'function') {
        try {
          return await (port.resolve as (ref: string) => Promise<MemoryRecord>)(id)
        } catch (error) {
          // §23.8 reports "no such record" by throwing, and that is the same
          // answer as a recall that found nothing. Letting it reach the shared
          // mapping would report a miss as a §23.6 conflict.
          if (errorCodeOf(error) === 'TASK_CONFLICT') return undefined
          throw error
        }
      }
      const recalled = await port.recall({ scopes: Object.freeze([]), ids: Object.freeze([id]) })
      return recalled.records.find(record => record.id === id)
    })
    if (!outcome.ok) return { kind: 'failed', reason: outcome.reason, diagnostic: outcome.diagnostic }
    if (outcome.value === undefined) return { kind: 'missing' }
    locator.set(outcome.value.id, { provider: providerId, scope: outcome.value.scope })
    return { kind: 'found', record: outcome.value, provider: providerId }
  }

  /** Provider ids the routes name, in route order and without repetition. */
  function routedProviders(): readonly string[] {
    const named: string[] = []
    for (const route of policy.routes) {
      if (providers.has(route.primary) && !named.includes(route.primary)) named.push(route.primary)
    }
    return Object.freeze(named)
  }

  /** Write one record through its owner. */
  async function write(
    providerId: string,
    record: MemoryRecord,
    mode: 'create' | 'reinforce' | 'replace',
    scope: MemoryScopeRef,
    at: EpochMs,
    diagnostics: MemoryDiagnostic[],
  ): Promise<{ readonly ok: true; readonly record: MemoryRecord } | { readonly ok: false; readonly refusal: MemoryRefusal }> {
    const outcome = await callProvider(providerId, scope, at, port => port.retain({ record, mode }))
    if (!outcome.ok) {
      diagnostics.push(outcome.diagnostic)
      return { ok: false, refusal: refuse(outcome.reason, outcome.diagnostic.detail, diagnostics) }
    }
    return { ok: true, record: outcome.value.record }
  }

  /** Collect everything one provider holds for a set of scopes. */
  async function collect(
    providerId: string,
    scopes: readonly MemoryScopeRef[],
    kinds: readonly MemoryKind[] | undefined,
    at: EpochMs,
    diagnostics: MemoryDiagnostic[],
  ): Promise<
    | { readonly ok: true; readonly records: readonly MemoryRecord[] }
    | { readonly ok: false; readonly reason: 'provider-unavailable' | 'timeout' | 'conflict'; readonly diagnostic: MemoryDiagnostic }
  > {
    const outcome = await callProvider(providerId, scopes[0] ?? GLOBAL_MEMORY_SCOPE, at, port =>
      port.recall({ scopes, ...(kinds === undefined ? {} : { kinds }) }),
    )
    if (!outcome.ok) {
      diagnostics.push(outcome.diagnostic)
      return outcome
    }
    for (const record of outcome.value.records) {
      locator.set(record.id, { provider: providerId, scope: record.scope })
    }
    return { ok: true, records: outcome.value.records }
  }

  /** One §23.4 validation or transition, with the authority check both share. */
  async function move(input: {
    readonly id: string
    readonly to: MemoryStatus
    readonly from?: MemoryStatus
    readonly at: EpochMs
    readonly meta: OperationMeta
    readonly actors?: readonly string[]
  }): Promise<MemoryTransitionResult> {
    const diagnostics: MemoryDiagnostic[] = []
    const authority = assertWriteAuthority('memory.semantic', MEMORY_AUTHORITY, input.meta)
    if (!authority.ok) return refuse('denied', authority.error.message, diagnostics, authority.error.code)
    for (const actor of input.actors ?? actors) {
      if (!actors.includes(actor)) return refuse('denied', `"${actor}" may not write memory`, diagnostics)
    }
    const found = await fetchOwned(input.id, input.at)
    if (found.kind === 'failed') {
      diagnostics.push(found.diagnostic)
      return refuse(found.reason, found.diagnostic.detail, diagnostics)
    }
    if (found.kind === 'missing') {
      if (found.unanswered !== undefined) diagnostics.push(found.unanswered)
      const detail = `record "${input.id}" is not one the fabric holds`
      diagnostics.push(diagnose('invalid-ref', detail, input.at))
      return refuse('invalid-ref', detail, diagnostics)
    }
    const record = found.record
    if (input.from !== undefined && record.status !== input.from) {
      const detail = `record "${record.id}" is "${record.status}", not "${input.from}" (§23.4)`
      diagnostics.push(diagnose('invalid-transition', detail, input.at, { scope: record.scope, provider: found.provider }))
      return refuse('invalid-transition', detail, diagnostics)
    }
    if (!isAllowedMemoryTransition(record.status, input.to)) {
      const detail = `record "${record.id}" may not move from "${record.status}" to "${input.to}" (§23.4 lifecycle)`
      diagnostics.push(diagnose('invalid-transition', detail, input.at, { scope: record.scope, provider: found.provider }))
      return refuse('invalid-transition', detail, diagnostics)
    }
    const next = Object.freeze({ ...record, status: input.to, statusChangedAt: input.at })
    const written = await write(found.provider, next, 'replace', record.scope, input.at, diagnostics)
    if (!written.ok) return written.refusal
    locator.set(written.record.id, { provider: found.provider, scope: written.record.scope })
    return Object.freeze({ ok: true, record: written.record, diagnostics: Object.freeze([...diagnostics]) })
  }

  const fabric: MemoryFabricPort = {
    async retain(request: MemoryRetainRequest): Promise<MemoryRetainResult> {
      const proposal = request?.proposal
      if (proposal === null || typeof proposal !== 'object') {
        throw new TypeError('dsh-mywork: a memory retention needs a proposal')
      }
      const meta = request?.meta
      if (meta === undefined || typeof meta !== 'object') {
        throw new TypeError('dsh-mywork: a memory retention needs operation identity')
      }
      const diagnostics: MemoryDiagnostic[] = []
      const authority = assertWriteAuthority('memory.semantic', MEMORY_AUTHORITY, meta)
      if (!authority.ok) return refuse('denied', authority.error.message, diagnostics, authority.error.code)
      for (const actor of request.actors ?? actors) {
        if (!actors.includes(actor)) return refuse('denied', `"${actor}" may not write memory`, diagnostics)
      }
      const checked = normalizeProposal(proposal)
      const at = request.nowMs ?? readClock()
      if (!isCounter(at)) throw new TypeError('dsh-mywork: a memory retention needs epoch milliseconds')

      const primary = primaryFor(checked.scope)
      if (!primary.ok) {
        diagnostics.push(diagnose('route-missing', primary.detail, at, { scope: checked.scope }))
        return refuse(primary.reason, primary.detail, diagnostics)
      }
      const providerId = primary.route.primary

      const held = await collect(providerId, [checked.scope], undefined, at, diagnostics)
      if (!held.ok) return refuse(held.reason, held.diagnostic.detail, diagnostics)

      // §23.4 Conflict Detection. A proposal may name the records it replaces,
      // and one that repeats a claim the provider already serves replaces that
      // record rather than living beside it.
      const targets: MemoryRecord[] = []
      for (const id of checked.supersedes) {
        const found = await fetchOwned(id, at)
        if (found.kind === 'failed') {
          diagnostics.push(found.diagnostic)
          return refuse(found.reason, found.diagnostic.detail, diagnostics)
        }
        if (found.kind === 'missing') {
          if (found.unanswered !== undefined) diagnostics.push(found.unanswered)
          const detail = `record "${id}" is not one the fabric holds`
          diagnostics.push(diagnose('invalid-ref', detail, at, { scope: checked.scope, provider: providerId }))
          return refuse('invalid-ref', detail, diagnostics)
        }
        if (found.provider !== providerId) {
          const detail = `record "${id}" is written by "${found.provider}", but scope "${memoryScopeKey(checked.scope)}" has "${providerId}" as its primary writer (§23.9)`
          diagnostics.push(diagnose('not-primary', detail, at, { scope: found.record.scope, provider: found.provider }))
          return refuse('not-primary', detail, diagnostics)
        }
        if (!targets.some(target => target.id === found.record.id)) targets.push(found.record)
      }
      const key = memoryClaimKey(checked.scope, checked.kind, checked.statement)
      const claim = held.records.find(
        record => memoryClaimKey(record.scope, record.kind, record.statement) === key && dedupable(record),
      )
      if (claim !== undefined && !targets.some(target => target.id === claim.id)) targets.push(claim)

      const fingerprint = fingerprintOf(checked)
      if (claim !== undefined && claim.fingerprint === fingerprint && targets.length === 1) {
        // §23.4 Reinforce: the same claim, proposed identically again. The
        // record's content and state do not move, so the §35 number a running
        // attempt froze stays where it is.
        const reinforced = Object.freeze({ ...claim, reinforcedCount: claim.reinforcedCount + 1 })
        const written = await write(providerId, reinforced, 'reinforce', checked.scope, at, diagnostics)
        if (!written.ok) return written.refusal
        locator.set(written.record.id, { provider: providerId, scope: written.record.scope })
        return Object.freeze({
          ok: true,
          record: written.record,
          created: false,
          reinforced: true,
          superseded: Object.freeze([] as string[]),
          diagnostics: Object.freeze([...diagnostics]),
        })
      }

      // §23.6: a weaker record never rewrites a stronger one. Every target is
      // checked before anything is written, so a refused supersede leaves both
      // records exactly as they were.
      for (const target of targets) {
        if (!supersedable(target)) continue
        if (memoryTrustRank(checked.trust) < memoryTrustRank(target.trust)) {
          const detail = `"${checked.trust}" may not supersede the "${target.trust}" record "${target.id}" (§23.6)`
          diagnostics.push(diagnose('conflict', detail, at, { scope: target.scope, provider: providerId }))
          return refuse('conflict', detail, diagnostics)
        }
      }
      // The old records move first, then the new one is written: a failure
      // halfway leaves the memory consistent — either the old claim still
      // holds, or it is superseded and a retry of the same proposal writes its
      // replacement — where the other order would leave two active claims.
      const superseded: string[] = []
      for (const target of targets) {
        if (!supersedable(target)) continue
        const next = Object.freeze({ ...target, status: 'superseded' as MemoryStatus, statusChangedAt: at })
        const written = await write(providerId, next, 'replace', target.scope, at, diagnostics)
        if (!written.ok) return written.refusal
        superseded.push(target.id)
        diagnostics.push(
          diagnose('superseded', `record "${target.id}" was superseded by a later retention`, at, {
            scope: target.scope,
            provider: providerId,
          }),
        )
      }

      const record = Object.freeze({
        id: await mintRecordId(),
        statement: checked.statement,
        scope: checked.scope,
        kind: checked.kind,
        sources: checked.sources,
        createdBy: checked.createdBy,
        trust: checked.trust,
        ...(checked.confidence === undefined ? {} : { confidence: checked.confidence }),
        validity: checked.validity,
        // §23.5 `supersedes` is what this record actually replaced, so an
        // implicit update names its predecessor exactly as an explicit one
        // does: a superseded record's replacement must be findable.
        supersedes: Object.freeze([...new Set([...checked.supersedes, ...superseded])]),
        status: (checked.validation === 'staged' ? 'candidate' : 'active') as MemoryStatus,
        revision: revisions.revisionOf(fingerprint),
        contentHash: contentHashOf(checked.statement),
        fingerprint,
        retainedAt: at,
        statusChangedAt: at,
        reinforcedCount: 0,
      })
      const written = await write(providerId, record, 'create', checked.scope, at, diagnostics)
      if (!written.ok) return written.refusal
      locator.set(written.record.id, { provider: providerId, scope: written.record.scope })
      return Object.freeze({
        ok: true,
        record: written.record,
        created: true,
        reinforced: false,
        superseded: Object.freeze(superseded),
        diagnostics: Object.freeze([...diagnostics]),
      })
    },

    async recall(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
      const scopes = requireScopes(request?.scopes)
      const at = request?.nowMs ?? readClock()
      if (!isCounter(at)) throw new TypeError('dsh-mywork: a memory recall needs epoch milliseconds')
      const kinds = requireKinds(request.kinds)
      const query = requireQuery(request.query)
      const minTrust = requireMinTrust(request.minTrust)
      const limit = requireLimit(request.limit)
      const diagnostics: MemoryDiagnostic[] = []
      // A group is one provider AND one policy answer. §49 lets a read degrade
      // only where the route says the memory is optional, so two scopes that
      // share a provider but not that answer must not share a decision: keying
      // by provider alone let an optional scope's allowance leak onto a
      // required one, and made the answer depend on the order of the scopes.
      const groups = new Map<string, { readonly provider: string; readonly optional: boolean; readonly scopes: MemoryScopeRef[] }>()
      for (const scope of scopes) {
        const primary = primaryFor(scope)
        if (!primary.ok) {
          diagnostics.push(diagnose('route-missing', primary.detail, at, { scope }))
          return refuse(primary.reason, primary.detail, diagnostics)
        }
        const key = `${primary.route.primary}|${primary.route.optional ? 'optional' : 'required'}`
        const group = groups.get(key)
        if (group === undefined) {
          groups.set(key, { provider: primary.route.primary, optional: primary.route.optional, scopes: [scope] })
        } else if (!group.scopes.some(entry => memoryScopeKey(entry) === memoryScopeKey(scope))) {
          group.scopes.push(scope)
        }
      }

      const considered: MemoryServingDecision[] = []
      let degraded = false
      // Deterministic order, required groups first: a mixed request must refuse
      // (and carry the same diagnostics) whichever order the caller listed its
      // scopes in, and a required scope is the one that decides.
      const ordered = [...groups.values()].sort((left, right) => {
        if (left.optional !== right.optional) return left.optional ? 1 : -1
        return left.provider < right.provider ? -1 : left.provider > right.provider ? 1 : 0
      })
      for (const group of ordered) {
        const collected = await collect(group.provider, Object.freeze([...group.scopes]), kinds, at, diagnostics)
        if (!collected.ok) {
          if (!group.optional) return refuse(collected.reason, collected.diagnostic.detail, diagnostics)
          degraded = true
          // One diagnostic per scope the degraded answer actually covers: a
          // single entry naming the first scope would hide which of them lost
          // its memory.
          for (const scope of group.scopes) {
            diagnostics.push(
              diagnose('degraded', `provider "${group.provider}" answered nothing: ${collected.diagnostic.detail}`, at, {
                scope,
                provider: group.provider,
              }),
            )
          }
          continue
        }
        considered.push(
          ...servingOf(
            collected.records,
            {
              scopes,
              ...(kinds === undefined ? {} : { kinds }),
              ...(query === undefined ? {} : { query }),
              ...(minTrust === undefined ? {} : { minTrust }),
              nowMs: at,
            },
            diagnostics,
          ),
        )
      }

      const records = considered
        .filter(decision => decision.served)
        .map(decision => decision.record)
        .sort(compareRecords)
      return Object.freeze({
        ok: true,
        records: Object.freeze(limit === undefined ? records : records.slice(0, limit)),
        considered: Object.freeze(considered),
        degraded,
        diagnostics: Object.freeze([...diagnostics]),
        observedAt: at,
      })
    },

    async reflect(request: MemoryReflectRequest): Promise<MemoryReflectResult> {
      const scope = freezeScope(request?.scope)
      const at = request?.nowMs ?? readClock()
      if (!isCounter(at)) throw new TypeError('dsh-mywork: a memory reflection needs epoch milliseconds')
      const kinds = requireKinds(request.kinds)
      const diagnostics: MemoryDiagnostic[] = []
      const primary = primaryFor(scope)
      if (!primary.ok) {
        diagnostics.push(diagnose('route-missing', primary.detail, at, { scope }))
        return refuse(primary.reason, primary.detail, diagnostics)
      }
      const providerId = primary.route.primary
      const port = providers.get(providerId) as MemoryProviderPort
      const reflect = port.reflect
      // Capabilities go through the same guarded path as every other provider
      // call: a provider that hangs, fails or is disabled must produce a §42
      // refusal with a diagnostic, not a rejection carrying a private error.
      const capabilities = await callProvider(providerId, scope, at, call => call.capabilities())
      if (!capabilities.ok) {
        diagnostics.push(capabilities.diagnostic)
        return refuse(capabilities.reason, capabilities.diagnostic.detail, diagnostics)
      }
      if (!capabilities.value.reflect || typeof reflect !== 'function') {
        const detail = `provider "${providerId}" does not implement reflection (§23.8)`
        diagnostics.push(diagnose('reflect-unsupported', detail, at, { scope, provider: providerId }))
        return refuse('reflect-unsupported', detail, diagnostics)
      }
      const outcome = await callProvider(providerId, scope, at, call =>
        (call.reflect as (input: unknown) => Promise<MemoryProviderReflectOutcome>)({
          scope,
          ...(kinds === undefined ? {} : { kinds }),
          nowMs: at,
        }),
      )
      if (!outcome.ok) {
        // A reflection has no empty-but-successful form, so `optional` cannot
        // turn this into a degraded answer the way it does for a recall: there
        // is no reflection to hand back. The refusal carries the diagnostic.
        diagnostics.push(outcome.diagnostic)
        return refuse(outcome.reason, outcome.diagnostic.detail, diagnostics)
      }
      return Object.freeze({ ok: true, reflection: outcome.value, diagnostics: Object.freeze([...diagnostics]) })
    },

    async resolve(request): Promise<MemoryResolveResult> {
      const id = request?.id
      requireText(id, 'a memory id')
      const at = request?.nowMs ?? readClock()
      if (!isCounter(at)) throw new TypeError('dsh-mywork: a memory resolution needs epoch milliseconds')
      const diagnostics: MemoryDiagnostic[] = []
      const found = await fetchOwned(id, at)
      if (found.kind === 'failed') {
        diagnostics.push(found.diagnostic)
        return refuse(found.reason, found.diagnostic.detail, diagnostics)
      }
      if (found.kind === 'missing') {
        if (found.unanswered !== undefined) diagnostics.push(found.unanswered)
        const detail = `record "${id}" is not one the fabric holds`
        diagnostics.push(diagnose('invalid-ref', detail, at))
        return refuse('invalid-ref', detail, diagnostics)
      }
      return Object.freeze({ ok: true, record: found.record, diagnostics: Object.freeze([...diagnostics]) })
    },

    async validate(request: MemoryValidateRequest): Promise<MemoryTransitionResult> {
      const id = request?.id
      requireText(id, 'a memory id')
      const meta = request?.meta
      if (meta === undefined || typeof meta !== 'object') {
        throw new TypeError('dsh-mywork: a memory validation needs operation identity')
      }
      const at = request?.nowMs ?? readClock()
      if (!isCounter(at)) throw new TypeError('dsh-mywork: a memory validation needs epoch milliseconds')
      return move({
        id,
        to: 'active',
        from: 'candidate',
        at,
        meta,
        ...(request.actors === undefined ? {} : { actors: request.actors }),
      })
    },

    async transition(request: MemoryTransitionRequest): Promise<MemoryTransitionResult> {
      const id = request?.id
      requireText(id, 'a memory id')
      const to = request?.to
      if (!MEMORY_STATUSES.includes(to)) throw new TypeError(`dsh-mywork: "${String(to)}" is not a memory status`)
      const meta = request?.meta
      if (meta === undefined || typeof meta !== 'object') {
        throw new TypeError('dsh-mywork: a memory transition needs operation identity')
      }
      const at = request?.nowMs ?? readClock()
      if (!isCounter(at)) throw new TypeError('dsh-mywork: a memory transition needs epoch milliseconds')
      return move({
        id,
        to,
        at,
        meta,
        ...(request.actors === undefined ? {} : { actors: request.actors }),
      })
    },

    routeFor(scope: MemoryScopeRef): MemoryRoute | undefined {
      return routeFor(freezeScope(scope))
    },

    routes(): readonly MemoryRoute[] {
      return policy.routes
    },

    diagnostics(): readonly MemoryDiagnostic[] {
      return Object.freeze([...log])
    },

    async namespaceRevision(request: MemoryRecallRequest): Promise<MemoryNamespaceRevision> {
      const recalled = await fabric.recall(request)
      if (!recalled.ok) throw new MyWorkError(recalled.code, recalled.message, { details: { reason: recalled.reason } })
      const fingerprint = recalled.records.map(record => `${record.id}:${record.contentHash}:${record.status}`).join('|')
      return Object.freeze({
        revision: revisions.revisionOf(`memory-namespace:${fingerprint}`),
        degraded: recalled.degraded,
        diagnostics: recalled.diagnostics,
      })
    },
  }

  return Object.freeze(fabric)
}

/**
 * Whether §23.4's recall serves a record, and why not when it does not (§23.4,
 * §23.5, §52).
 *
 * One rule for every path: the fabric's recall, the context provider's
 * discovery and its materialization all ask this function, so a record cannot
 * be proposed as context on one path and refused on another.
 * @param record - the record to test.
 * @param request - the scopes, filters and time of the request.
 * @returns the reason it is not served, or undefined when it is.
 */
export function memoryServeRefusal(
  record: MemoryRecord,
  request: {
    readonly scopes: readonly MemoryScopeRef[]
    readonly kinds?: readonly MemoryKind[]
    readonly query?: string
    readonly minTrust?: MemoryTrustClass
    readonly nowMs: EpochMs
  },
): MemoryServingReason | undefined {
  if (!memoryScopeWithin(record.scope, request.scopes)) return 'scope-mismatch'
  if (!SERVED_MEMORY_STATUSES.includes(record.status)) {
    return record.status === 'superseded' ? 'superseded' : 'status-not-served'
  }
  if (!memoryValidAt(record.validity, request.nowMs)) return 'outside-validity'
  if (request.kinds !== undefined && !request.kinds.includes(record.kind)) return 'kind-mismatch'
  if (request.minTrust !== undefined && memoryTrustRank(record.trust) < memoryTrustRank(request.minTrust)) {
    return 'trust-below-minimum'
  }
  if (request.query !== undefined && request.query !== '') {
    if (!record.statement.toLowerCase().includes(request.query.toLowerCase())) return 'query-mismatch'
  }
  return undefined
}

/**
 * Decide every record of one recall, and say so in diagnostics (§33, §49).
 *
 * A record that is left out because its window closed, or because a later
 * record replaced it, produces a diagnostic: staleness visible only in the
 * absence of a record is exactly the silence §33 forbids.
 */
function servingOf(
  records: readonly MemoryRecord[],
  request: {
    readonly scopes: readonly MemoryScopeRef[]
    readonly kinds?: readonly MemoryKind[]
    readonly query?: string
    readonly minTrust?: MemoryTrustClass
    readonly nowMs: EpochMs
  },
  diagnostics: MemoryDiagnostic[],
): readonly MemoryServingDecision[] {
  const considered: MemoryServingDecision[] = []
  for (const record of records) {
    const reason = memoryServeRefusal(record, request)
    if (reason === undefined) {
      considered.push(Object.freeze({ record, served: true }))
      continue
    }
    const replacedBy = reason === 'superseded' ? replacementOf(record, records) : undefined
    if (reason === 'outside-validity') {
      diagnostics.push({
        code: 'outside-validity',
        detail: `record "${record.id}" is outside its validity window and was not served`,
        at: request.nowMs,
        scope: record.scope,
      })
    }
    if (reason === 'superseded') {
      diagnostics.push({
        code: 'superseded',
        detail: `record "${record.id}" was replaced by "${replacedBy ?? 'a later record'}"`,
        at: request.nowMs,
        scope: record.scope,
      })
    }
    considered.push(
      Object.freeze({ record, served: false, reason, ...(replacedBy === undefined ? {} : { replacedBy }) }),
    )
  }
  return Object.freeze(considered)
}

/** The record of one recall that names `record` in its `supersedes` list. */
function replacementOf(record: MemoryRecord, records: readonly MemoryRecord[]): string | undefined {
  return records.find(candidate => candidate.supersedes.includes(record.id))?.id
}

/** Deterministic order of served records: strongest trust, then newest, then id. */
function compareRecords(left: MemoryRecord, right: MemoryRecord): number {
  const byTrust = memoryTrustRank(right.trust) - memoryTrustRank(left.trust)
  if (byTrust !== 0) return byTrust
  if (left.retainedAt !== right.retainedAt) return right.retainedAt - left.retainedAt
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/** Whether a record still holds its claim, so an identical proposal reinforces it. */
function dedupable(record: MemoryRecord): boolean {
  return record.status === 'active' || record.status === 'candidate'
}

/** Whether a record can still be superseded. */
function supersedable(record: MemoryRecord): boolean {
  return record.status === 'active' || record.status === 'candidate' || record.status === 'stale'
}

/**
 * Canonical identity of one claim (§23.4 Deduplication): the scope it belongs
 * to, its kind, and its statement with whitespace and case normalized.
 *
 * Two records with the same claim key are the same claim. A later statement
 * that differs is a different claim, and replaces this one only by naming it in
 * `supersedes` or by repeating the claim with other content.
 * @param scope - scope the claim belongs to.
 * @param kind - kind of the claim.
 * @param statement - the statement itself.
 */
export function memoryClaimKey(scope: MemoryScopeRef, kind: MemoryKind, statement: string): string {
  return `${memoryScopeKey(scope)}|${kind}|${normalizeStatement(statement)}`
}

/** One statement with runs of whitespace collapsed and case folded. */
function normalizeStatement(statement: string): string {
  return statement.trim().replace(/\s+/gu, ' ').toLowerCase()
}

/** Canonical identity of a whole proposal, which is what §35 numbers. */
function fingerprintOf(proposal: NormalizedProposal): string {
  return [
    memoryClaimKey(proposal.scope, proposal.kind, proposal.statement),
    proposal.trust,
    String(proposal.confidence ?? ''),
    `${String(proposal.validity.from ?? '')}-${String(proposal.validity.until ?? '')}`,
    proposal.sources.map(source => `${source.type}:${source.uri}@${source.revision ?? ''}`).join(','),
    `${proposal.createdBy.component}@${proposal.createdBy.run ?? ''}`,
    [...proposal.supersedes].sort().join(','),
    // §23.4 Validation is part of what was proposed: without it a staged
    // proposal and an immediate one would share an identity, and re-proposing
    // the claim as immediate would "reinforce" the Candidate it was waiting on
    // instead of publishing the record the caller asked for.
    proposal.validation,
  ].join('§')
}

/** Deterministic content hash (FNV-1a), the format the adapter fakes publish. */
function contentHashOf(text: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/** A proposal after validation, with every optional field resolved. */
interface NormalizedProposal {
  readonly statement: string
  readonly scope: MemoryScopeRef
  readonly kind: MemoryKind
  readonly sources: readonly MemorySourceRef[]
  readonly createdBy: { readonly component: string; readonly run?: string }
  readonly trust: MemoryTrustClass
  readonly confidence?: number
  readonly validity: { readonly from?: EpochMs; readonly until?: EpochMs }
  readonly supersedes: readonly string[]
  readonly validation: 'immediate' | 'staged'
}

/** Validate and freeze one proposal (§23.4 Candidate Extraction boundary). */
function normalizeProposal(proposal: MemoryProposal): NormalizedProposal {
  const statement = proposal.statement
  requireText(statement, 'a memory statement')
  const kind = proposal.kind
  requireText(kind, 'a memory kind')
  const trust = proposal.trust
  if (!MEMORY_TRUST_CLASSES.includes(trust)) {
    throw new TypeError(`dsh-mywork: "${String(trust)}" is not a memory trust class (§23.6)`)
  }
  if (proposal.confidence !== undefined) {
    const confidence = proposal.confidence
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new TypeError('dsh-mywork: a memory confidence must be a number between 0 and 1')
    }
  }
  const sources = proposal.sources
  if (!Array.isArray(sources)) throw new TypeError('dsh-mywork: a memory proposal needs a sources array')
  const frozenSources = Object.freeze(
    sources.map(source => {
      if (source === null || typeof source !== 'object') {
        throw new TypeError('dsh-mywork: a memory source must be an object')
      }
      requireText(source.uri, 'a memory source uri')
      requireText(source.type, 'a memory source type')
      return Object.freeze({
        uri: source.uri,
        type: source.type,
        ...(source.revision === undefined ? {} : { revision: source.revision }),
      })
    }),
  )
  const author = proposal.createdBy
  if (author === null || typeof author !== 'object') {
    throw new TypeError('dsh-mywork: a memory proposal needs an author')
  }
  requireText(author.component, 'a memory author component')
  if (author.run !== undefined) requireText(author.run, 'a memory author run')
  const validation = proposal.validation ?? 'immediate'
  if (!MEMORY_VALIDATIONS.includes(validation)) {
    throw new TypeError(`dsh-mywork: "${String(validation)}" is not a memory validation mode`)
  }
  const supersedes = proposal.supersedes ?? []
  if (!Array.isArray(supersedes)) throw new TypeError('dsh-mywork: a memory supersedes list must be an array')
  for (const id of supersedes) requireText(id, 'a superseded memory id')
  return Object.freeze({
    statement,
    scope: freezeScope(proposal.scope),
    kind,
    sources: frozenSources,
    createdBy: Object.freeze({ component: author.component, ...(author.run === undefined ? {} : { run: author.run }) }),
    trust,
    ...(proposal.confidence === undefined ? {} : { confidence: proposal.confidence }),
    validity: freezeValidity(proposal.validity ?? {}),
    supersedes: Object.freeze([...supersedes]),
    validation,
  })
}

/** Validate and freeze one scope. */
function freezeScope(scope: MemoryScopeRef | undefined): MemoryScopeRef {
  if (scope === null || typeof scope !== 'object') throw new TypeError('dsh-mywork: a memory scope must be an object')
  requireText(scope.type, 'a memory scope type')
  requireText(scope.id, 'a memory scope id')
  const parent = scope.parent === undefined ? undefined : freezeScope(scope.parent)
  return Object.freeze({ type: scope.type, id: scope.id, ...(parent === undefined ? {} : { parent }) })
}

/** Validate and freeze one validity window. */
function freezeValidity(validity: { readonly from?: EpochMs; readonly until?: EpochMs }): {
  readonly from?: EpochMs
  readonly until?: EpochMs
} {
  if (validity === null || typeof validity !== 'object') {
    throw new TypeError('dsh-mywork: a memory validity must be an object')
  }
  if (validity.from !== undefined && !isCounter(validity.from)) {
    throw new TypeError('dsh-mywork: a memory validity start must be epoch milliseconds')
  }
  if (validity.until !== undefined && !isCounter(validity.until)) {
    throw new TypeError('dsh-mywork: a memory validity end must be epoch milliseconds')
  }
  if (validity.from !== undefined && validity.until !== undefined && validity.until < validity.from) {
    throw new TypeError('dsh-mywork: a memory validity window ends before it starts')
  }
  return Object.freeze({
    ...(validity.from === undefined ? {} : { from: validity.from }),
    ...(validity.until === undefined ? {} : { until: validity.until }),
  })
}

/** Validate and freeze the scopes of one request. */
function requireScopes(scopes: readonly MemoryScopeRef[]): readonly MemoryScopeRef[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new TypeError('dsh-mywork: a memory request needs at least one scope')
  }
  return Object.freeze(scopes.map(scope => freezeScope(scope)))
}

/** Validate a recall's kind filter. */
function requireKinds(kinds: readonly MemoryKind[] | undefined): readonly MemoryKind[] | undefined {
  if (kinds === undefined) return undefined
  if (!Array.isArray(kinds)) throw new TypeError('dsh-mywork: a memory kind filter must be an array')
  for (const kind of kinds) requireText(kind, 'a memory kind')
  return Object.freeze([...kinds])
}

/** Validate a recall's query. */
function requireQuery(query: string | undefined): string | undefined {
  if (query === undefined) return undefined
  if (typeof query !== 'string') throw new TypeError('dsh-mywork: a memory query must be a string')
  return query
}

/** Validate a recall's trust floor. */
function requireMinTrust(trust: MemoryTrustClass | undefined): MemoryTrustClass | undefined {
  if (trust === undefined) return undefined
  if (!MEMORY_TRUST_CLASSES.includes(trust)) {
    throw new TypeError(`dsh-mywork: "${String(trust)}" is not a memory trust class (§23.6)`)
  }
  return trust
}

/** Validate a recall's limit. */
function requireLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  if (!Number.isInteger(limit) || limit < 0) {
    throw new TypeError('dsh-mywork: a memory recall limit must be a non-negative integer')
  }
  return limit
}

/** Freeze the policy, rejecting the shapes the fabric cannot reason about. */
function normalizePolicy(policy: MemoryPolicy): MemoryPolicy {
  if (policy === null || typeof policy !== 'object') throw new TypeError('dsh-mywork: a memory policy must be an object')
  const routes = policy.routes ?? []
  if (!Array.isArray(routes)) throw new TypeError('dsh-mywork: memory routes must be an array')
  for (const route of routes) {
    if (route === null || typeof route !== 'object') throw new TypeError('dsh-mywork: a memory route must be an object')
    requireText(route.primary, 'a memory route primary')
    if (typeof route.optional !== 'boolean') {
      throw new TypeError(`dsh-mywork: memory route "${route.primary}" must state whether it is optional (§49)`)
    }
    if (route.match === null || typeof route.match !== 'object') {
      throw new TypeError(`dsh-mywork: memory route "${route.primary}" needs a match`)
    }
  }
  if (!(typeof policy.timeoutMs === 'number' && Number.isFinite(policy.timeoutMs) && policy.timeoutMs > 0)) {
    throw new TypeError('dsh-mywork: a memory policy needs a positive timeout in milliseconds')
  }
  if (!(Number.isInteger(policy.diagnosticLimit) && policy.diagnosticLimit > 0)) {
    throw new TypeError('dsh-mywork: a memory policy needs a positive diagnostic limit')
  }
  return Object.freeze({
    routes: Object.freeze(
      routes.map(route =>
        Object.freeze({
          match: Object.freeze({ ...route.match }),
          primary: route.primary,
          optional: route.optional,
        }),
      ),
    ),
    timeoutMs: policy.timeoutMs,
    diagnosticLimit: policy.diagnosticLimit,
  })
}

/** Raised when a provider call passes its deadline; never escapes the fabric. */
class MemoryDeadlineExceeded extends Error {
  constructor() {
    super('dsh-mywork: the memory provider did not answer in time')
    this.name = 'MemoryDeadlineExceeded'
  }
}

/**
 * Bound one provider call by the policy's timeout (§49).
 *
 * The deadline is a wall-clock timer rather than the injected clock: a deadline
 * a caller can advance is not a deadline, and the timestamp source is a
 * separate question from the one the call is answering.
 */
async function withDeadline<T>(call: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new MemoryDeadlineExceeded()), timeoutMs)
  })
  try {
    return await Promise.race([call(), deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** One value that has to be a non-empty string. */
function requireText(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`dsh-mywork: ${what} must be a non-empty string`)
  }
}

/** Human-readable detail of a thrown value; never parsed. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The §42 code a thrown value carries, read structurally.
 *
 * A provider may be `@dsh-mywork/core`'s own error, an `AdapterError` from the
 * adapter SDK, or a third implementation, and each ships its own class — so the
 * code is read from the value rather than compared by class identity, which
 * would silently stop matching the moment a provider bundled its own copy.
 */
function errorCodeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { readonly code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** The system clock, used when a fabric is built without one. */
function systemClock(): ClockPort {
  return Object.freeze({
    now: (): number => Date.now(),
    sleep: (ms: number, signal?: AbortSignal): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new Error('dsh-mywork: the sleep was cancelled'))
          return
        }
        const timer = setTimeout(resolve, Math.max(0, ms))
        signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('dsh-mywork: the sleep was cancelled'))
        })
      }),
  })
}

// ---------------------------------------------------------------------------
// §21.5 — the context provider
// ---------------------------------------------------------------------------

/** Options accepted by {@link createMemoryContextProvider}. */
export interface MemoryContextProviderOptions {
  /** Fabric to serve records from. */
  readonly fabric: MemoryFabricPort
  /** Provider identity candidates carry as their `source`. Default `memory-fabric`. */
  readonly provider?: string
  /**
   * Level discovery discloses. §21.2 keeps most items at L0/L1, so the default
   * is L1 — the statement itself — and L2 is reached by materialization only.
   */
  readonly defaultLevel?: ContextLevel
  /** Relevance every served record claims, when the caller states none. */
  readonly relevance?: number
  /** Minimum trust a record must carry to be proposed as context. */
  readonly minTrust?: MemoryTrustClass
  /**
   * Time source of the passes that do not carry one. Default: the system clock.
   * It is injectable because the validity decision must be reproducible.
   */
  readonly now?: () => number
}

/** Input of {@link MemoryContextProvider.serving}. */
export interface MemoryServingInput {
  /** Scopes the request runs in, as §21.4 states them. */
  readonly scopes: readonly ContextScopeRef[]
  /** Free-text query a statement must contain. */
  readonly query?: string
  /** Kinds to restrict the answer to. */
  readonly kinds?: readonly MemoryKind[]
  /** Minimum trust a record must carry. */
  readonly minTrust?: MemoryTrustClass
  /** Time of the pass, epoch milliseconds; absent means the provider clock. */
  readonly nowMs?: EpochMs
}

/** What one serving pass decided (§21.5, §33). */
export interface MemoryServing {
  /** Records that are served, in the fabric's deterministic order. */
  readonly served: readonly MemoryRecord[]
  /** Every record considered, with the decision taken about it. */
  readonly considered: readonly MemoryServingDecision[]
  /** True when a provider was unavailable or timed out and the route allowed it. */
  readonly degraded: boolean
  /** Diagnostics the pass produced. */
  readonly diagnostics: readonly MemoryDiagnostic[]
  /** Time the pass ran, epoch milliseconds. */
  readonly observedAt: EpochMs
  /** The refusal that stopped the pass; absent when it ran. */
  readonly refusal?: MemoryRefusal
}

/**
 * The §21.5 provider over a memory fabric (§23; §62 items 20, 24 and 25).
 *
 * Discovery discloses L0/L1 and never a source's content: a candidate is the
 * record's statement plus the provenance *references* §23.5 defines, so the raw
 * material a record was extracted from cannot travel with it. What a snapshot
 * carries is decided by §21.6's budget and §21.8's placement — this provider
 * proposes, and §21.1 keeps the fabric the only owner of the prompt.
 */
export interface MemoryContextProvider extends ContextProviderPort {
  /** Provider identity, for a `ContextProviderBinding`. */
  readonly provider: string
  /** Level discovery currently discloses. */
  readonly defaultLevel: ContextLevel
  /** Reading of the clock the passes without a time use. */
  now(): EpochMs
  /**
   * The records served for a request, with the decision taken about each and
   * the diagnostics the pass produced. Diagnostics read this; the context
   * fabric reads `discover`.
   * @param request - scopes, query and time of one pass.
   */
  serving(request: MemoryServingInput): Promise<MemoryServing>
  /**
   * §35's numeric revision of the memory namespace the request reads, for
   * `ContextSnapshot.memoryRevisions`.
   * @param request - the scopes the pass runs in.
   */
  namespaceRevision(request: MemoryServingInput): Promise<MemoryNamespaceRevision>
}

/**
 * Create the memory context provider (§21.5, §23).
 * @param options - the fabric to serve and the disclosure defaults.
 * @returns the provider.
 * @throws {TypeError} when the fabric is missing or the default level is not one §21.2 declares.
 */
export function createMemoryContextProvider(options: MemoryContextProviderOptions): MemoryContextProvider {
  const fabric = options?.fabric
  if (fabric === undefined || typeof fabric.recall !== 'function' || typeof fabric.resolve !== 'function') {
    throw new TypeError('dsh-mywork: a memory context provider needs a memory fabric')
  }
  const provider = options.provider ?? DEFAULT_MEMORY_SOURCE
  requireText(provider, 'a memory provider identity')
  const defaultLevel = options.defaultLevel ?? DEFAULT_MEMORY_LEVEL
  if (defaultLevel !== 'L0' && defaultLevel !== 'L1' && defaultLevel !== 'L2') {
    throw new TypeError(`dsh-mywork: "${String(defaultLevel)}" is not a context level`)
  }
  if (defaultLevel === L2_LEVEL) {
    throw new TypeError(
      'dsh-mywork: discovery discloses L0/L1 only; the statement and its provenance are served at L2 (§21.2)',
    )
  }
  if (options.relevance !== undefined && !(typeof options.relevance === 'number' && Number.isFinite(options.relevance))) {
    throw new TypeError('dsh-mywork: a memory relevance must be a finite number')
  }
  const clock = options.now ?? ((): number => Date.now())
  if (typeof clock !== 'function') throw new TypeError('dsh-mywork: a memory provider clock must be a function')
  const readClock = (): EpochMs => {
    const nowMs = clock()
    if (!isCounter(nowMs)) throw new TypeError('dsh-mywork: the memory provider clock must return epoch milliseconds')
    return nowMs
  }

  async function servingOf(input: MemoryServingInput): Promise<MemoryServing> {
    const scopes = requireContextScopes(input?.scopes)
    const nowMs = input?.nowMs ?? readClock()
    if (!isCounter(nowMs)) throw new TypeError('dsh-mywork: a memory serving pass needs epoch milliseconds')
    const minTrust = input.minTrust ?? options.minTrust
    const recalled = await fabric.recall({
      scopes,
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
      ...(minTrust === undefined ? {} : { minTrust }),
      nowMs,
    })
    if (!recalled.ok) {
      return Object.freeze({
        served: Object.freeze([]),
        considered: Object.freeze([]),
        degraded: false,
        diagnostics: recalled.diagnostics,
        observedAt: nowMs,
        refusal: recalled,
      })
    }
    return Object.freeze({
      served: recalled.records,
      considered: recalled.considered,
      degraded: recalled.degraded,
      diagnostics: recalled.diagnostics,
      observedAt: recalled.observedAt,
    })
  }

  const port: MemoryContextProvider = {
    provider,
    defaultLevel,
    now: (): EpochMs => readClock(),
    async serving(request: MemoryServingInput): Promise<MemoryServing> {
      return servingOf(request)
    },
    async namespaceRevision(request: MemoryServingInput): Promise<MemoryNamespaceRevision> {
      const scopes = requireContextScopes(request?.scopes)
      const nowMs = request?.nowMs ?? readClock()
      return fabric.namespaceRevision({
        scopes,
        ...(request.query === undefined ? {} : { query: request.query }),
        ...(request.kinds === undefined ? {} : { kinds: request.kinds }),
        nowMs,
      })
    },
    async capabilities(): Promise<ContextProviderCapabilities> {
      const named = new Set<string>()
      let catchAll = false
      for (const route of fabric.routes()) {
        if (route.match.scope === undefined) catchAll = true
        else named.add(route.match.scope)
      }
      const scopeKinds = catchAll ? [...MEMORY_SCOPE_TYPES, ...named] : [...named]
      return Object.freeze({
        levels: Object.freeze(['L0', 'L1', 'L2'] as ContextLevel[]),
        onDemandMaterialization: true,
        classes: Object.freeze([MEMORY_CLASS]),
        scopeKinds: Object.freeze([...new Set(scopeKinds)].sort()),
      })
    },
    async discover(request: ContextDiscoveryRequest): Promise<readonly ContextCandidate[]> {
      if (request === undefined || !Array.isArray(request.scopes)) {
        throw new TypeError('dsh-mywork: a memory discovery request needs scopes')
      }
      if (request.classes !== undefined && !request.classes.includes(MEMORY_CLASS)) {
        // The fabric asks for the classes it wants; a provider that cannot serve
        // any of them answers with nothing rather than with what it felt like.
        return Object.freeze([])
      }
      const serving = await servingOf({
        scopes: request.scopes,
        ...(request.query === undefined ? {} : { query: request.query }),
      })
      if (serving.refusal !== undefined) {
        throw new MyWorkError(serving.refusal.code, serving.refusal.message, {
          details: {
            reason: serving.refusal.reason,
            diagnostics: serving.refusal.diagnostics.map(entry => entry.code),
          },
        })
      }
      return Object.freeze(serving.served.map(record => candidateOf(provider, record, defaultLevel, options.relevance)))
    },
    async materialize(request: ContextMaterializeRequest): Promise<ContextMaterialized> {
      if (request === undefined || typeof request.uri !== 'string') {
        throw new TypeError('dsh-mywork: a memory materialization needs a uri')
      }
      const id = parseMemoryUri(request.uri)
      if (id === undefined) {
        throw new TypeError(`dsh-mywork: "${request.uri}" is not a memory uri of the form "memory:<id>"`)
      }
      const requested = request.level ?? L2_LEVEL
      // The statement is disclosed at L0/L1; L2 adds the provenance references.
      // Anything below the full level is a caller asking for the wrong thing.
      if (requested !== L2_LEVEL) {
        throw new TypeError(
          `dsh-mywork: "${request.uri}" was disclosed at ${defaultLevel}; L2 is served by materialization only`,
        )
      }
      const resolved = await fabric.resolve({ id, nowMs: readClock() })
      if (!resolved.ok) {
        throw new MyWorkError(resolved.code, resolved.message, { details: { reason: resolved.reason, uri: request.uri } })
      }
      const record = resolved.record
      // The same rule discovery applies. Without it a record superseded between
      // the pass and the fetch — or one whose window closed — would still hand
      // over its content, and "only Active is served" would hold for the
      // proposal while failing for the body.
      //
      // The scope branch of that rule cannot fail here, and that is deliberate:
      // §52 permits a reference link across workspaces, and a reference is
      // looked up by identity (`MemoryFabricPort.resolve`). What this check is
      // for is the lifecycle — status and validity — which is exactly what the
      // candidate that was handed out may have moved past.
      const refusal = memoryServeRefusal(record, { scopes: memoryScopeChain(record.scope), nowMs: readClock() })
      if (refusal !== undefined) {
        throw new MyWorkError('TASK_CONFLICT', `dsh-mywork: record "${record.id}" is not served: ${refusal}`, {
          details: { uri: request.uri, reason: refusal, status: record.status },
        })
      }
      const text = memoryTextOf(record, L2_LEVEL)
      const hash = itemHashOf(record)
      if (request.expectedRevision !== undefined && request.expectedRevision !== String(record.revision)) {
        throw new TypeError(
          `dsh-mywork: memory "${record.id}" is at revision "${record.revision}", not "${request.expectedRevision}"`,
        )
      }
      if (request.expectedContentHash !== undefined && request.expectedContentHash !== hash) {
        throw new TypeError(`dsh-mywork: memory "${record.id}" hashes to "${hash}", not "${request.expectedContentHash}"`)
      }
      return Object.freeze({
        uri: request.uri,
        level: L2_LEVEL,
        revision: String(record.revision),
        contentHash: hash,
        content: Object.freeze({ mediaType: MEMORY_MEDIA_TYPE, text }),
        estimatedTokens: estimateTokens(text),
        provenance: provenanceOf(provider, record, request.uri, hash),
      })
    },
  }
  return Object.freeze(port)
}

/** Build the candidate one served record is disclosed as (§21.4). */
function candidateOf(
  source: string,
  record: MemoryRecord,
  level: ContextLevel,
  relevance: number | undefined,
): ContextCandidate {
  const text = memoryTextOf(record, level)
  const hash = itemHashOf(record)
  const uri = memoryUri(record.id)
  return Object.freeze({
    uri,
    source,
    kind: MEMORY_CLASS,
    scopes: Object.freeze(memoryScopeChain(record.scope).map(scope => contextScopeOfMemory(scope))),
    level,
    ...(relevance === undefined ? {} : { relevance }),
    trust: contextTrustOfMemoryTrust(record.trust),
    revision: String(record.revision),
    contentHash: hash,
    estimatedTokens: estimateTokens(text),
    ...(record.validity.from === undefined ? {} : { validFrom: record.validity.from }),
    ...(record.validity.until === undefined ? {} : { validUntil: record.validity.until }),
    provenance: provenanceOf(source, record, uri, hash),
    content: Object.freeze({ mediaType: MEMORY_MEDIA_TYPE, text }),
    materializeRef: uri,
    attributes: Object.freeze({ kind: record.kind, trust: record.trust, status: record.status }),
  })
}

/**
 * Provenance of one record as §21.4 states it.
 *
 * The record's own sources enter as references — source family, uri, revision —
 * and never as content, which is the mechanical reason a raw transcript cannot
 * be copied into a prompt through its memory.
 */
function provenanceOf(
  source: string,
  record: MemoryRecord,
  uri: string,
  contentHash: string,
): readonly ContextProvenanceRef[] {
  const refs: ContextProvenanceRef[] = [
    Object.freeze({ source, uri, revision: String(record.revision), contentHash }),
  ]
  for (const entry of record.sources) {
    refs.push(
      Object.freeze({
        source: entry.type,
        uri: entry.uri,
        ...(entry.revision === undefined ? {} : { revision: entry.revision }),
      }),
    )
  }
  return Object.freeze(refs)
}

/**
 * The text of one record at one level (§21.2).
 *
 * L0 is the kind and the first line of the statement; L1 is the statement with
 * its kind, trust and scope; L2 adds the provenance references. No level
 * contains anything a source's payload could contribute, because the record has
 * no field such a payload could be read from.
 * @param record - the record to render.
 * @param level - the level to render it at.
 */
export function memoryTextOf(record: MemoryRecord, level: ContextLevel): string {
  const scope = memoryScopeKey(record.scope)
  const head = `[${record.kind}] `
  if (level === 'L0') return `${head}${firstLine(record.statement)}`
  if (level === 'L1') {
    return `${head}${record.statement}\ntrust: ${record.trust} | scope: ${scope} | status: ${record.status}`
  }
  const sources = record.sources.map(
    source => `${source.type} ${source.uri}${source.revision === undefined ? '' : ` @${source.revision}`}`,
  )
  return [
    `${head}${record.statement}`,
    `trust: ${record.trust} | scope: ${scope} | status: ${record.status} | revision: ${record.revision}`,
    `sources: ${sources.length === 0 ? 'none stated' : sources.join(', ')}`,
  ].join('\n')
}

/**
 * Content hash of one record as the context layer compares it (§21.4).
 *
 * Discovery publishes this value on the candidate and materialization returns
 * it, because §21.5's port has the caller state the hash it expects: hashing the
 * level-specific text instead would make a candidate disclosed at L1 and the L2
 * body of the same record disagree, and every on-demand fetch would look like a
 * source that moved under the fabric.
 * @param record - the record to hash.
 */
function itemHashOf(record: MemoryRecord): string {
  return contentHashOf(memoryTextOf(record, L2_LEVEL))
}

/** The first line of a statement, for §21.2's abstract level. */
function firstLine(statement: string): string {
  return (statement.split('\n', 1)[0] ?? statement).trim()
}

/** Deterministic size estimate of one text, in tokens. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

/** Parse `memory:<id>` back into its identity. */
function parseMemoryUri(uri: string): string | undefined {
  if (!uri.startsWith(MEMORY_URI_PREFIX)) return undefined
  const id = uri.slice(MEMORY_URI_PREFIX.length)
  return id === '' ? undefined : id
}

/** Validate and freeze the scopes of one context request as memory scopes. */
function requireContextScopes(scopes: readonly ContextScopeRef[]): readonly MemoryScopeRef[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new TypeError('dsh-mywork: a memory request needs at least one scope')
  }
  return Object.freeze(
    scopes.map(scope => {
      if (scope === null || typeof scope !== 'object') throw new TypeError('dsh-mywork: a scope must be an object')
      requireText(scope.kind, 'a scope kind')
      requireText(scope.id, 'a scope id')
      return memoryScopeOfContext(scope)
    }),
  )
}

/** Provider identity a memory candidate carries by default. */
export const DEFAULT_MEMORY_SOURCE = 'memory-fabric'

/** Level discovery discloses by default: §21.2's overview. */
export const DEFAULT_MEMORY_LEVEL: ContextLevel = 'L1'

/** The one context class a memory candidate carries (§21.3). */
export const MEMORY_CLASS = 'memory'

/** Media type of a memory statement. */
export const MEMORY_MEDIA_TYPE = 'text/plain'

/** The authority of §8 that owns long-term semantic memory. */
const MEMORY_AUTHORITY = 'memory-provider'

/** Default operation identity allowed to write memory. */
const DEFAULT_MEMORY_ACTOR = 'memory-provider'

/** §21.2's full level, the only one that adds the provenance references. */
const L2_LEVEL: ContextLevel = 'L2'

/** The uri scheme of one record: `memory:<id>`. */
const MEMORY_URI_PREFIX = 'memory:'

/** Sequence that keeps two fabrics in one process from minting the same record id. */
let FABRIC_SEQUENCE = 0
