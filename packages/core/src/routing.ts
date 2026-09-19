/**
 * Model routing policy (architecture §13.1, §21.6, §29, §53, §62 item 7).
 *
 * Routing walks the candidates a blueprint's {@link ModelPolicy} states — the
 * preferred route, then its fallbacks, then escalation when the request permits
 * it — and selects the first candidate the live catalog can actually serve. The
 * walk is decided by the real catalog, not by the policy text: a route whose
 * provider is not registered is absent, a registered provider that does not
 * answer is in outage, and a route whose published window is undisclosed or too
 * small is refused rather than assumed to fit.
 *
 * Nothing here calls a model. The module reads the catalog and answers with a
 * decision plus the §29 provenance of the route it took, so the whole policy is
 * exercisable against a fake catalog.
 * @module
 */

import type {
  CatalogModel,
  CatalogProvider,
  ModelCatalogPort,
  ModelPolicy,
  ModelRoute,
  ModelRouteDecision,
  ModelRouteProvenance,
  ModelRouteRequest,
  ModelRouteRole,
  RouteEvaluation,
  RouteRefusalReason,
} from '@dsh-mywork/contracts'
import { CATALOG_UNKNOWN_MODEL } from '@dsh-mywork/contracts'

/** One registered provider that did not answer during a catalog read. */
export interface CatalogOutage {
  /** Provider route key that failed. */
  readonly provider: string
  /** Failure text, verbatim, for diagnostics. */
  readonly detail: string
}

/** One observation of the model catalog. */
export interface CatalogSnapshot {
  /** Providers registered when the catalog was read. */
  readonly providers: readonly CatalogProvider[]
  /** Models the registered providers advertised, provider-tagged. */
  readonly models: readonly CatalogModel[]
  /** Registered providers that did not answer. */
  readonly outages: readonly CatalogOutage[]
}

/** A routing request bound to the catalog it is decided against. */
export interface ModelRouteSelection {
  /** Policy, trigger, capacity requirement, and the escalation gate. */
  readonly request: ModelRouteRequest
  /** Catalog observed by {@link readModelCatalog}. */
  readonly catalog: CatalogSnapshot
  /** Port used to resolve the exact capacity of a candidate. */
  readonly port: ModelCatalogPort
}

/** Render a route the way a policy states it. */
export function formatModelRoute(route: ModelRoute): string {
  return `${route.provider}/${route.model}`
}

/**
 * Parse a policy entry into a route.
 *
 * The provider is everything before the **first** slash and the model is the
 * rest, because a model id may itself contain one (`openrouter/anthropic/x`).
 * A policy entry carries configuration data rather than a program, so a
 * malformed entry is answered with `undefined` and becomes the typed
 * `invalid-route` refusal instead of an exception.
 * @param text - policy entry, e.g. `opencode-go/deepseek-v4.1-flash`.
 * @returns the route, or `undefined` when the entry is not a `provider/model` pair.
 */
export function parseModelRoute(text: string): ModelRoute | undefined {
  if (typeof text !== 'string') return undefined
  const trimmed = text.trim()
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1) return undefined
  const provider = trimmed.slice(0, slash)
  const model = trimmed.slice(slash + 1)
  if (/\s/.test(trimmed)) return undefined
  return Object.freeze({ provider, model })
}

/**
 * Read the live catalog once: every registered provider, the models it
 * advertises, and the providers that did not answer.
 *
 * A provider that fails is recorded as an outage rather than dropped or
 * reported as empty: §29 routes around an outage, and it can only do that while
 * "did not answer" and "advertises nothing" remain distinguishable.
 *
 * `listProviders()` is the one call this function does not contain. A registry
 * that cannot even name its providers is broken rather than in outage — there is
 * no candidate list to decide over — so its failure propagates instead of being
 * flattened into an empty catalog, which routing would answer with a misleading
 * `route-absent`.
 * @param port - the model catalog port.
 * @returns the observed catalog, with one outage entry per failing provider.
 * @throws whatever `listProviders()` raised.
 */
export async function readModelCatalog(port: ModelCatalogPort): Promise<CatalogSnapshot> {
  const providers = port.listProviders().map(provider => Object.freeze({ id: provider.id, name: provider.name }))
  const models: CatalogModel[] = []
  const outages: CatalogOutage[] = []
  for (const provider of providers) {
    try {
      const listed = await port.listModels(provider.id)
      for (const model of listed) {
        models.push(Object.freeze({
          provider: model.provider,
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
        }))
      }
    } catch (error) {
      outages.push(Object.freeze({ provider: provider.id, detail: describeFailure(error) }))
    }
  }
  return Object.freeze({
    providers: Object.freeze(providers),
    models: Object.freeze(models),
    outages: Object.freeze(outages),
  })
}

/**
 * Route one unit of work, reading the catalog first.
 *
 * Same argument as {@link selectModelRoute} minus the catalog, for the caller
 * that has not read one yet.
 * @param input - the request and the port to read the catalog from.
 */
export async function routeModel(
  input: { readonly request: ModelRouteRequest; readonly port: ModelCatalogPort },
): Promise<ModelRouteDecision> {
  const request = input?.request
  const port = input?.port
  const catalog = await readModelCatalog(port)
  return selectModelRoute({ request, catalog, port })
}

/**
 * Select the first candidate of the policy the observed catalog can serve.
 *
 * Candidates are walked in policy order, and the first one that answers with a
 * usable capacity is selected. Refusing every candidate refuses the decision;
 * the refusal carries the first candidate's reason — the preferred route's
 * failure is the primary diagnosis — together with the whole walk.
 * @param selection - request, observed catalog, and the port used to resolve capacity.
 * @throws {TypeError} when the request itself is malformed (a malformed *policy entry* is a typed refusal, not an exception).
 */
export async function selectModelRoute(selection: ModelRouteSelection): Promise<ModelRouteDecision> {
  const { request, catalog, port } = requireSelection(selection)
  const candidates = policyCandidates(request)
  const evaluations: RouteEvaluation[] = []
  for (const candidate of candidates) {
    const evaluation = await evaluateCandidate(candidate, request, catalog, port)
    evaluations.push(evaluation)
    if (evaluation.outcome !== 'selected') continue
    const route = evaluation.route
    if (route === undefined) continue
    return Object.freeze({ kind: 'routed', provenance: provenanceOf(evaluation, route, request, evaluations) })
  }
  const first = evaluations[0]
  return Object.freeze({
    kind: 'refused',
    reason: first?.reason ?? 'route-absent',
    evaluations: Object.freeze([...evaluations]),
  })
}

/** One policy entry, with the part of the policy that stated it. */
interface RouteCandidate {
  readonly text: string
  readonly role: ModelRouteRole
  /** True when the entry was never asked because the request withheld escalation. */
  readonly withheld: boolean
}

/** Every candidate a request states, in the order it is walked. */
function policyCandidates(request: ModelRouteRequest): readonly RouteCandidate[] {
  const policy = requirePolicy(request.policy)
  const allowed = request.allowEscalation === true
  const candidates: RouteCandidate[] = [
    { text: policy.preferred, role: 'preferred', withheld: false },
    ...policy.fallback.map(text => ({ text, role: 'fallback' as const, withheld: false })),
  ]
  for (const text of policy.escalation) {
    candidates.push({ text, role: 'escalation', withheld: !allowed })
  }
  return candidates
}

/**
 * Ask one candidate and answer what it returned.
 *
 * The order of the checks is the diagnosis order a reader expects: a malformed
 * entry, an unregistered provider, a provider that failed, an answer that does
 * not describe the route asked about, and finally the capacity itself.
 */
async function evaluateCandidate(
  candidate: RouteCandidate,
  request: ModelRouteRequest,
  catalog: CatalogSnapshot,
  port: ModelCatalogPort,
): Promise<RouteEvaluation> {
  if (candidate.withheld) {
    return evaluation(candidate, { outcome: 'withheld', reason: 'escalation-not-permitted' })
  }
  const route = parseModelRoute(candidate.text)
  if (route === undefined) {
    return evaluation(candidate, { outcome: 'refused', reason: 'invalid-route' })
  }
  if (catalog.providers.every(provider => provider.id !== route.provider)) {
    return evaluation(candidate, {
      route,
      outcome: 'refused',
      reason: 'route-absent',
      detail: `the catalog registers no provider "${route.provider}"`,
    })
  }
  const outage = catalog.outages.find(entry => entry.provider === route.provider)
  if (outage !== undefined) {
    return evaluation(candidate, { route, outcome: 'refused', reason: 'provider-outage', detail: outage.detail })
  }
  let resolved
  try {
    resolved = await port.resolveModelInfo(route.provider, route.model)
  } catch (error) {
    // An absent route and an outage lead to different decisions (§29), so the
    // port's own `UNKNOWN_MODEL` code is preserved instead of being flattened
    // into "the provider is down".
    if (failureCode(error) === CATALOG_UNKNOWN_MODEL) {
      return evaluation(candidate, {
        route,
        outcome: 'refused',
        reason: 'route-absent',
        detail: describeFailure(error),
      })
    }
    return evaluation(candidate, {
      route,
      outcome: 'refused',
      reason: 'provider-outage',
      detail: describeFailure(error),
    })
  }
  if (resolved.provider !== route.provider || resolved.id !== route.model) {
    return evaluation(candidate, {
      route,
      outcome: 'refused',
      reason: 'catalog-invalid',
      detail: `the catalog answered about "${resolved.provider}/${resolved.id}"`,
    })
  }
  const contextWindow = resolved.contextWindow
  if (contextWindow !== undefined && (!Number.isInteger(contextWindow) || contextWindow <= 0)) {
    return evaluation(candidate, {
      route,
      outcome: 'refused',
      reason: 'catalog-invalid',
      detail: `the context window is ${String(contextWindow)}, which is not a positive count of tokens`,
    })
  }
  const required = request.requiredContextTokens
  if (required !== undefined) {
    if (contextWindow === undefined) {
      return evaluation(candidate, {
        route,
        outcome: 'refused',
        reason: 'context-window-undisclosed',
        detail: `the request needs ${required} tokens and the adapter published no window`,
      })
    }
    if (contextWindow < required) {
      return evaluation(candidate, {
        route,
        outcome: 'refused',
        reason: 'context-window-too-small',
        detail: `the request needs ${required} tokens and the window holds ${contextWindow}`,
      })
    }
  }
  return evaluation(candidate, {
    route,
    outcome: 'selected',
    ...(contextWindow === undefined ? {} : { contextWindow }),
  })
}

/** Build one evaluation record, omitting the fields the outcome does not carry. */
function evaluation(
  candidate: RouteCandidate,
  fields: {
    readonly route?: ModelRoute
    readonly outcome: RouteEvaluation['outcome']
    readonly reason?: RouteRefusalReason
    readonly contextWindow?: number
    readonly detail?: string
  },
): RouteEvaluation {
  return Object.freeze({
    candidate: candidate.text,
    ...(fields.route === undefined ? {} : { route: fields.route }),
    role: candidate.role,
    outcome: fields.outcome,
    ...(fields.reason === undefined ? {} : { reason: fields.reason }),
    ...(fields.contextWindow === undefined ? {} : { contextWindow: fields.contextWindow }),
    ...(fields.detail === undefined ? {} : { detail: fields.detail }),
  })
}

/** The §29 provenance of a selected route: the route, why it was reached, and the whole walk. */
function provenanceOf(
  selected: RouteEvaluation,
  route: ModelRoute,
  request: ModelRouteRequest,
  evaluations: readonly RouteEvaluation[],
): ModelRouteProvenance {
  return Object.freeze({
    route,
    role: selected.role,
    ...(request.trigger === undefined ? {} : { trigger: request.trigger }),
    ...(selected.contextWindow === undefined ? {} : { contextWindow: selected.contextWindow }),
    evaluations: Object.freeze([...evaluations]),
  })
}

/** Validate the selection itself: a malformed request is a programming error, not a refusal. */
function requireSelection(selection: ModelRouteSelection): ModelRouteSelection {
  if (selection === null || typeof selection !== 'object') {
    throw new TypeError('dsh-mywork: a model route selection must be an object')
  }
  const { request, catalog, port } = selection
  if (request === null || typeof request !== 'object') {
    throw new TypeError('dsh-mywork: a model route request must be an object')
  }
  const required = request.requiredContextTokens
  if (required !== undefined && (!Number.isInteger(required) || required <= 0)) {
    throw new TypeError(
      `dsh-mywork: requiredContextTokens must be a positive count of tokens, received ${String(required)}`,
    )
  }
  if (request.allowEscalation !== undefined && typeof request.allowEscalation !== 'boolean') {
    throw new TypeError(
      `dsh-mywork: allowEscalation must be a boolean, received ${typeof request.allowEscalation}`,
    )
  }
  if (catalog === null || typeof catalog !== 'object' || !Array.isArray(catalog.providers) || !Array.isArray(catalog.outages)) {
    throw new TypeError('dsh-mywork: a catalog snapshot must carry providers and outages')
  }
  if (port === null || typeof port !== 'object' || typeof port.resolveModelInfo !== 'function') {
    throw new TypeError('dsh-mywork: a model catalog port must resolve model info')
  }
  return selection
}

/** Validate the policy: its shape is a published revision's, so a malformed one fails loud. */
function requirePolicy(policy: ModelPolicy): ModelPolicy {
  if (policy === null || typeof policy !== 'object') {
    throw new TypeError('dsh-mywork: a model policy must be an object')
  }
  if (typeof policy.preferred !== 'string' || !Array.isArray(policy.fallback) || !Array.isArray(policy.escalation)) {
    throw new TypeError('dsh-mywork: a model policy must state preferred, fallback, and escalation')
  }
  for (const entry of [policy.preferred, ...policy.fallback, ...policy.escalation]) {
    if (typeof entry !== 'string') {
      throw new TypeError(`dsh-mywork: a model policy entry must be a string, received ${typeof entry}`)
    }
  }
  return policy
}

/** Failure text of a rejected catalog call, without assuming the error is an `Error`. */
function describeFailure(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** The machine code a rejected catalog call carried, when it carried one. */
function failureCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { readonly code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}
