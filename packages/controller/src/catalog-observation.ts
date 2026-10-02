/**
 * Last-observed model catalog for the scheduler.
 *
 * Scheduler ticks are policy over data and must not call a model provider or a
 * catalog port. This object is the I/O boundary: refresh() resolves the catalog
 * and performs provider reads; read() returns only the last immutable snapshot.
 *
 * A registry that currently has no model-catalog adapter is a valid empty
 * observation. If a catalog adapter was already registered when this object was
 * created, read() refuses until the first refresh completes so a live provider
 * cannot be misreported as an empty route set.
 * @module
 */

import type { MyWorkAdapters } from '@dsh-mywork/adapter-sdk'
import type {
  CatalogModel,
  CatalogOutage,
  CatalogProvider,
  CatalogSnapshot,
  ModelCatalogPort,
} from '@dsh-mywork/contracts'

import { ControllerRuntimeError } from './errors.ts'

/** Immutable catalog observation for a deployment with no registered provider. */
export const EMPTY_CATALOG_SNAPSHOT: CatalogSnapshot = Object.freeze({
  providers: Object.freeze([]),
  models: Object.freeze([]),
  outages: Object.freeze([]),
})

/** Result of observing one registered provider. */
interface CatalogProviderRead {
  /** Models the provider advertised during this refresh. */
  readonly models: readonly CatalogModel[]
  /** Provider-local outage; absent when listModels completed. */
  readonly outage?: CatalogOutage
}

/** Cached model catalog used by the scheduler state projection. */
export interface CatalogObservation {
  /** Whether read() can return a truthful completed observation right now. */
  readonly ready: boolean
  /** Last completed immutable observation; performs no adapter/provider I/O. */
  read(): CatalogSnapshot
  /** Refresh from the currently registered model-catalog adapter. Concurrent calls single-flight. */
  refresh(): Promise<CatalogSnapshot>
}

/**
 * Build the controller-owned model-catalog observation.
 *
 * The registry itself is only inspected during construction/refresh. read() is
 * deliberately free of registry, catalog, provider and model calls.
 */
export function createCatalogObservation(
  adapters?: MyWorkAdapters<undefined>,
): CatalogObservation {
  let current = EMPTY_CATALOG_SNAPSHOT
  let ready = adapters === undefined || adapters.list('model-catalog').length === 0
  let refreshing: Promise<CatalogSnapshot> | undefined

  function read(): CatalogSnapshot {
    if (!ready) {
      throw new ControllerRuntimeError(
        'state-unavailable',
        'dsh-mywork: model catalog has not completed its first observation',
        { details: { source: 'catalog' } },
      )
    }
    return current
  }

  async function performRefresh(): Promise<CatalogSnapshot> {
    if (adapters === undefined || adapters.list('model-catalog').length === 0) {
      current = EMPTY_CATALOG_SNAPSHOT
      ready = true
      return current
    }

    const resolution = adapters.resolve<ModelCatalogPort>('model-catalog')
    if (!resolution.ok) throw resolution.refusal

    const listedProviders = resolution.adapter.listProviders()
    if (!Array.isArray(listedProviders)) {
      throw new TypeError('dsh-mywork: ModelCatalogPort.listProviders() must return an array')
    }
    const providers: CatalogProvider[] = listedProviders.map(provider =>
      Object.freeze({ id: provider.id, name: provider.name }),
    )

    const reads: readonly CatalogProviderRead[] = await Promise.all(
      providers.map(async provider => {
        try {
          const listed = await resolution.adapter.listModels(provider.id)
          if (!Array.isArray(listed)) {
            throw new TypeError(`dsh-mywork: ModelCatalogPort.listModels("${provider.id}") must return an array`)
          }
          return Object.freeze({
            models: Object.freeze(
              listed.map(model => Object.freeze({
                provider: model.provider,
                id: model.id,
                name: model.name,
                ...(model.description === undefined ? {} : { description: model.description }),
              }) as CatalogModel),
            ),
          })
        } catch (error) {
          return Object.freeze({
            models: Object.freeze([]) as readonly CatalogModel[],
            outage: Object.freeze({
              provider: provider.id,
              detail: error instanceof Error ? error.message : String(error),
            }) as CatalogOutage,
          })
        }
      }),
    )

    const models = reads.flatMap(result => result.models)
    const outages = reads.flatMap(result => result.outage === undefined ? [] : [result.outage])
    const next: CatalogSnapshot = Object.freeze({
      providers: Object.freeze(providers),
      models: Object.freeze(models),
      outages: Object.freeze(outages),
    })
    current = next
    ready = true
    return current
  }

  function refresh(): Promise<CatalogSnapshot> {
    if (refreshing !== undefined) return refreshing
    let operation: Promise<CatalogSnapshot>
    operation = performRefresh().finally(() => {
      if (refreshing === operation) refreshing = undefined
    })
    refreshing = operation
    return operation
  }

  return Object.freeze({
    get ready(): boolean {
      return ready
    },
    read,
    refresh,
  })
}
