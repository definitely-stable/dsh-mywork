/**
 * DSH model catalog binding (architecture §29, §36, §53, §62 item 7).
 *
 * The real catalog of a deployment is the DSH LLM registry published as the
 * Cordis service `llm`: `listProviders()`, `listModels(provider)`, and
 * `resolveModelInfo(provider, model)`. This module is the only place MyWork
 * touches it. It wraps the registry in the {@link ModelCatalogPort} §36 declares
 * and registers that adapter in `myworkAdapters`, so routing negotiates the
 * `model-catalog` port by kind and never names DSH.
 *
 * The registry is described structurally rather than imported. Two reasons, both
 * deliberate: the published bundle must keep DSH as its single external import
 * (a type-only import would still drag the package into the build graph), and
 * the port stays the contract — an adapter that fails to answer is an outage
 * (§29), not a reason for the control plane to crash.
 *
 * A missing registry is reported, never repaired: a profile without the `llm`
 * service mounts the controller and logs that no model-catalog adapter was
 * registered, exactly as the beads row reports a missing workspace.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { MyWorkAdapters } from '@dsh-mywork/adapter-sdk'
import { portContractVersion } from '@dsh-mywork/adapter-sdk'
import {
  type CatalogModel,
  type CatalogProvider,
  type ModelCatalogPort,
  type ResolvedCatalogModel,
} from '@dsh-mywork/contracts'

/** Cordis service name of the DSH LLM registry. */
export const DSH_LLM_SERVICE = 'llm'

/** Adapter id the binding registers in `myworkAdapters`. */
export const DSH_MODEL_CATALOG_ADAPTER_ID = 'dsh-llm'

/** Port family the binding implements. */
export const DSH_MODEL_CATALOG_KIND = 'model-catalog'

/**
 * Capabilities the binding declares (§37). `contextWindow` is supported in the
 * sense of the port: the binding reports the capacity a provider publishes and
 * reports nothing when a provider publishes none, which is why the port's own
 * `contextWindow` is optional and routing refuses an undisclosed window instead
 * of assuming a size.
 */
export const DSH_MODEL_CATALOG_CAPABILITIES: Readonly<Record<string, boolean>> = Object.freeze({
  providers: true,
  models: true,
  contextWindow: true,
})

/**
 * The part of the DSH LLM registry this binding uses, declared structurally.
 *
 * The names and shapes are the registry's own — `LlmProviderInfo`,
 * `LlmModelInfo`, and `LlmResolvedModelInfo` from `@deepseek-ai/.../llm` — so
 * the wrapper is a rename rather than a translation, and a change in the
 * registry surfaces as a type error here.
 */
export interface DshLlmRegistry {
  /** Providers registered right now. */
  listProviders(): readonly { readonly id: string; readonly name: string }[]
  /** Models one registered provider advertises; rejects when the provider does not answer. */
  listModels(provider: string): Promise<readonly {
    readonly provider: string
    readonly id: string
    readonly name: string
    readonly description?: string
  }[]>
  /** Exact model metadata of one route, including its context capacity when the provider owns one. */
  resolveModelInfo(provider: string, model: string): Promise<{
    readonly provider: string
    readonly id: string
    readonly name: string
    readonly context?: { readonly contextWindow: number }
  }>
}

/** {@link ModelCatalogPort} over the DSH LLM registry. */
export class DshModelCatalog implements ModelCatalogPort {
  readonly #llm: DshLlmRegistry

  /**
   * @param llm - the live DSH LLM registry.
   */
  constructor(llm: DshLlmRegistry) {
    this.#llm = llm
  }

  /** Registered providers, with their published names. */
  listProviders(): readonly CatalogProvider[] {
    return this.#llm.listProviders().map(provider => Object.freeze({ id: provider.id, name: provider.name }))
  }

  /**
   * Models one provider advertises.
   * @param provider - provider route key.
   * @throws whatever the registry raised: a missing adapter or an unreachable provider is an outage.
   */
  async listModels(provider: string): Promise<readonly CatalogModel[]> {
    const models = await this.#llm.listModels(provider)
    return models.map(model => Object.freeze({
      provider: model.provider,
      id: model.id,
      name: model.name,
      ...(model.description === undefined ? {} : { description: model.description }),
    }))
  }

  /**
   * Exact metadata of one route, with the capacity its provider owns.
   * @param provider - provider route key.
   * @param model - exact model id.
   * @throws whatever the registry raised: an unknown route or an unreachable provider is an outage.
   */
  async resolveModelInfo(provider: string, model: string): Promise<ResolvedCatalogModel> {
    const resolved = await this.#llm.resolveModelInfo(provider, model)
    const contextWindow = resolved.context?.contextWindow
    return Object.freeze({
      provider: resolved.provider,
      id: resolved.id,
      name: resolved.name,
      ...(contextWindow === undefined ? {} : { contextWindow }),
    })
  }
}

/** Whether a value carries the registry methods this binding calls. */
function isLlmRegistry(value: unknown): value is DshLlmRegistry {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<Record<keyof DshLlmRegistry, unknown>>
  return typeof candidate.listProviders === 'function'
    && typeof candidate.listModels === 'function'
    && typeof candidate.resolveModelInfo === 'function'
}

/**
 * Register the DSH catalog adapter in `myworkAdapters`.
 *
 * The registration belongs to the calling plugin's fiber, so unloading the
 * controller removes the adapter with it (§44).
 * @param ctx - the controller's plugin context.
 * @param adapters - the registry the controller published.
 * @returns whether an adapter was registered; `false` means the profile has no `llm` service.
 */
export function mountModelCatalog(ctx: Context, adapters: MyWorkAdapters<undefined>): boolean {
  const llm: unknown = ctx.get(DSH_LLM_SERVICE)
  if (llm === undefined) {
    ctx.logger?.warn?.(
      `dsh-mywork: the DSH service "${DSH_LLM_SERVICE}" is not mounted, so no ${DSH_MODEL_CATALOG_KIND} adapter was registered`,
    )
    return false
  }
  if (!isLlmRegistry(llm)) {
    ctx.logger?.warn?.(
      `dsh-mywork: the DSH service "${DSH_LLM_SERVICE}" does not answer listProviders/listModels/resolveModelInfo, so no ${DSH_MODEL_CATALOG_KIND} adapter was registered`,
    )
    return false
  }
  const adapter = new DshModelCatalog(llm)
  const handle = adapters.register<ModelCatalogPort>({
    kind: DSH_MODEL_CATALOG_KIND,
    id: DSH_MODEL_CATALOG_ADAPTER_ID,
    contractVersion: portContractVersion(DSH_MODEL_CATALOG_KIND),
    capabilities: DSH_MODEL_CATALOG_CAPABILITIES,
    create: () => adapter,
  })
  ctx.effect(() => () => {
    handle.unregister()
  })
  return true
}
