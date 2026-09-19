/**
 * Model catalog port (architecture §29, §36, §53, §62 item 7).
 *
 * The port mirrors the DSH LLM registry — `listProviders()`,
 * `listModels(provider)`, `resolveModelInfo(provider, model)` — because that
 * registry is the only catalog MyWork may route on: the real one. It keeps the
 * three distinctions §29 routing depends on, and it keeps them apart:
 *
 * - **Absent**: the provider is not registered at all, so the route does not
 *   exist and no amount of retrying will produce it.
 * - **Outage**: the provider is registered but did not answer (§29 lists
 *   provider outage as a routing trigger, which only makes sense if the two are
 *   distinguishable).
 * - **Undisclosed capacity**: a context window an adapter does not publish stays
 *   absent. It is never read as zero, exactly as an unknown §30 amount is never
 *   read as zero.
 * @module
 */

/** One registered provider route of the catalog. */
export interface CatalogProvider {
  /** Provider route key used to address it, e.g. `opencode-go`. */
  readonly id: string
  /** Human-readable provider name for diagnostics and selectors. */
  readonly name: string
}

/**
 * One model a provider advertises. Membership of this list is **advisory**: it
 * says what a selector may offer, not what a request may name (§29), so routing
 * never treats an unlisted model as an unusable one.
 */
export interface CatalogModel {
  /** Provider route that owns this entry. */
  readonly provider: string
  /** Model id a request names. */
  readonly id: string
  /** Human-readable model name. */
  readonly name: string
  /** Optional user-facing distinction from otherwise similar models. */
  readonly description?: string
}

/** One exact provider/model pair as its owning adapter resolves it. */
export interface ResolvedCatalogModel {
  /** Provider route the model belongs to. */
  readonly provider: string
  /** Exact model id that was resolved. */
  readonly id: string
  /** Human-readable model name. */
  readonly name: string
  /**
   * Provider-owned context capacity in tokens. Absent means the adapter
   * disclosed none; a caller that needs a capacity it cannot read must refuse
   * the route rather than assume one.
   */
  readonly contextWindow?: number
}

/**
 * Failure code that means "this provider serves no such model".
 *
 * It is the DSH registry's own code (`UNKNOWN_MODEL`, raised when an adapter is
 * asked for a model its route does not configure), and the port keeps it: an
 * outage and an absent route lead to different §29 decisions, so a rejection
 * that says the route does not exist must not be reported as an outage. Any
 * other rejection is an outage.
 */
export const CATALOG_UNKNOWN_MODEL = 'UNKNOWN_MODEL'

/**
 * One registered provider that did not answer during a catalog read.
 *
 * It is data, not a port failure: §29 keeps "the provider is not registered"
 * (absent) and "the provider did not answer" (outage) apart, and both a routing
 * decision and a scheduler tick read the distinction from an observation.
 */
export interface CatalogOutage {
  /** Provider route key that failed. */
  readonly provider: string
  /** Failure text, verbatim, for diagnostics. */
  readonly detail: string
}

/**
 * One observation of the model catalog (§29, §53).
 *
 * A snapshot is what a caller read once: the registered providers, the models
 * they advertised, and the providers that did not answer. Consumers that must not
 * touch a port — the scheduler is one, because §3.2 keeps it off the model path —
 * decide against a snapshot instead of reading the catalog themselves.
 */
export interface CatalogSnapshot {
  /** Providers registered when the catalog was read. */
  readonly providers: readonly CatalogProvider[]
  /** Models the registered providers advertised, provider-tagged. */
  readonly models: readonly CatalogModel[]
  /** Registered providers that did not answer. */
  readonly outages: readonly CatalogOutage[]
}

/**
 * The catalog MyWork routes on (§36 `ModelCatalogPort`).
 *
 * An implementation answers about registered providers only. A call that cannot
 * be answered — an unreachable provider, a provider whose adapter is not
 * registered, a malformed catalog — rejects; the rejection is what §29 calls an
 * outage, and it is never converted into an empty result, because "no models"
 * and "I could not ask" lead to different decisions. The single exception is a
 * rejection carrying {@link CATALOG_UNKNOWN_MODEL}, which states that the
 * provider answered and does not serve the route.
 */
export interface ModelCatalogPort {
  /** Providers registered right now, in registration order. */
  listProviders(): readonly CatalogProvider[]
  /**
   * Models one registered provider advertises.
   * @param provider - provider route key.
   * @throws when the provider is not registered or did not answer.
   */
  listModels(provider: string): Promise<readonly CatalogModel[]>
  /**
   * Resolve the exact provider/model pair, including its context capacity.
   * @param provider - provider route key.
   * @param model - exact model id.
   * @throws a rejection carrying {@link CATALOG_UNKNOWN_MODEL} when the router serves no such model; any other rejection when it did not answer.
   */
  resolveModelInfo(provider: string, model: string): Promise<ResolvedCatalogModel>
}
