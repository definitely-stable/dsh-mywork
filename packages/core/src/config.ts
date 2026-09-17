/**
 * Workspace configuration resolution (architecture §6, §52).
 *
 * A workspace resolves its configuration from the §6.3 overlay chain
 * (platform → global → team → workflow → workspace → task). The mode decides
 * what the chain may decide for this workspace:
 *
 * - `global` — the workspace *uses* the global Team, workflow, Role Blueprints,
 *   memory routes, and pool policies (§6.1), so a workspace-authored layer that
 *   redefines one of them is refused instead of silently ignored.
 * - `isolated` — the workspace owns its Team Work, Task Graph, and memory
 *   namespaces, its workflow settings, agent revisions, and limits (§6.2), so
 *   no layer may hand it someone else's namespace.
 * - `inherit` — the chain applies as written (§6.3), and `workspace`/`task`
 *   layers may override anything except the runtime namespace.
 *
 * The runtime instance/context/memory overlay is workspace-scoped in every mode
 * (§52), so no layer can set it.
 *
 * Malformed input (a layer that is not a document, an unknown domain, a
 * negative counter) throws `TypeError`: it is a deployment error the loader must
 * surface loudly. A well-formed document that contradicts its mode is answered
 * with a typed `Result` failure, because that is domain policy rather than a
 * parsing problem.
 * @module
 */

import {
  CONFIG_DOMAINS,
  CONFIG_LAYERS,
  DEFAULT_WORKSPACE_CONFIG_MODE,
  GLOBAL_ONLY_CONFIG_DOMAINS,
  NAMESPACE_KEYS,
  WORKSPACE_AUTHORED_LAYERS,
  WORKSPACE_CONFIG_MODES,
  type BlueprintId,
  type ConfigDomain,
  type ConfigLayer,
  type ConfigLayerDocument,
  type ConfigLayerValues,
  type OperationMeta,
  type PoolPolicyOverlay,
  type ResolvedWorkspaceConfig,
  type Result,
  type Revision,
  type WorkspaceConfigMode,
  type WorkspaceId,
  type WorkspaceNamespaces,
} from '@dsh-mywork/contracts'
import { MyWorkError, fail, ok } from './errors.ts'
import { isCounter } from './guards.ts'

/** Namespace keys §6.2 gives only to an `isolated` workspace. */
const ISOLATED_NAMESPACE_KEYS: readonly (keyof WorkspaceNamespaces)[] = Object.freeze(['teamWork', 'taskGraph', 'memory'])

/** Namespace key §52 keeps workspace-scoped in every mode. */
const RUNTIME_NAMESPACE_KEY: keyof WorkspaceNamespaces = 'runtime'

/**
 * Mints the ConfigRevision of a resolved configuration state (§6.3, §35).
 *
 * The fingerprint is the identity: the same resolved state keeps the revision
 * it already got, and a changed state gets the next number. The counter lives in
 * the process, so it is not durable; the fingerprint is what a stored record can
 * be compared against.
 */
export interface ConfigRevisionRegistry {
  /**
   * Revision of the configuration state identified by `fingerprint`.
   * @param fingerprint - canonical form produced by the resolver.
   */
  revisionOf(fingerprint: string): Revision
  /** Number of distinct configuration states this registry has seen. */
  size(): number
}

/**
 * Create a revision registry.
 * @returns a registry whose numbering starts at 1.
 */
export function createConfigRevisionRegistry(): ConfigRevisionRegistry {
  const minted = new Map<string, Revision>()
  return Object.freeze({
    revisionOf(fingerprint: string): Revision {
      if (typeof fingerprint !== 'string' || fingerprint === '') {
        throw new TypeError('dsh-mywork: a configuration fingerprint must be a non-empty string')
      }
      const existing = minted.get(fingerprint)
      if (existing !== undefined) return existing
      const revision = minted.size + 1
      minted.set(fingerprint, revision)
      return revision
    },
    size: (): number => minted.size,
  })
}

/** Input of {@link resolveWorkspaceConfig}. */
export interface WorkspaceConfigResolution {
  /** Workspace the configuration is resolved for. */
  readonly workspaceId: WorkspaceId
  /** Mode the workspace runs in; an absent mode means `inherit` (§6.3). */
  readonly mode?: WorkspaceConfigMode
  /** Documents of the layers that provide one; the array order is irrelevant. */
  readonly layers?: readonly ConfigLayerDocument[]
  /** Registry that mints the ConfigRevision of the resolved state. */
  readonly revisions: ConfigRevisionRegistry
}

/**
 * Resolve one workspace's configuration (§6.3).
 *
 * Layers are applied in the §6.3 order whatever order the caller listed them
 * in, so the resolved state depends on the chain and not on input order.
 * @param input - workspace, optional mode, layer documents, and revision registry.
 * @param meta - operation identity.
 */
export function resolveWorkspaceConfig(
  input: WorkspaceConfigResolution,
  meta: OperationMeta,
): Result<ResolvedWorkspaceConfig> {
  const workspaceId = requireIdentifier(input.workspaceId, 'workspaceId')
  const mode = input.mode ?? DEFAULT_WORKSPACE_CONFIG_MODE
  if (!WORKSPACE_CONFIG_MODES.includes(mode)) {
    throw new TypeError(`dsh-mywork: unknown workspace configuration mode ${describeValue(mode)}`)
  }
  if (typeof input.revisions !== 'object' || input.revisions === null || typeof input.revisions.revisionOf !== 'function') {
    throw new TypeError('dsh-mywork: resolveWorkspaceConfig requires a ConfigRevisionRegistry')
  }

  const documents = orderDocuments(input.layers ?? [])
  const policy = assertLayerPolicy(documents, mode, workspaceId, meta)
  if (!policy.ok) return fail(policy.error, meta)

  const merged = mergeDocuments(documents)
  const pools = assertMergedPools(merged.pools, workspaceId, meta)
  if (!pools.ok) return fail(pools.error, meta)

  const applied = documents.filter(document => contributedDomains(document.values).length > 0)
  const namespaces = resolveNamespaces(mode, workspaceId, merged.namespaces)
  const fingerprint = canonicalForm({
    workspaceId,
    mode,
    teamId: merged.teamId,
    workflowId: merged.workflowId,
    blueprints: merged.blueprints,
    memoryRoutes: merged.memoryRoutes,
    pools: merged.pools,
    namespaces,
  })

  const built: ResolvedWorkspaceConfig = {
    workspaceId,
    mode,
    configRevision: input.revisions.revisionOf(fingerprint),
    fingerprint,
    appliedLayers: Object.freeze(applied.map(document => document.layer)),
    layerRevisions: Object.freeze(layerRevisions(applied)),
    ...(merged.teamId === undefined ? {} : { teamId: merged.teamId }),
    ...(merged.workflowId === undefined ? {} : { workflowId: merged.workflowId }),
    blueprints: freezeDeep(merged.blueprints) as Readonly<Record<BlueprintId, Revision>>,
    memoryRoutes: Object.freeze([...merged.memoryRoutes]),
    ...(merged.pools === undefined ? {} : { pools: freezeDeep(merged.pools) as PoolPolicyOverlay }),
    namespaces,
  }
  return ok(Object.freeze(built), meta)
}

/**
 * Namespaces a workspace runs in (§6.2, §52).
 *
 * `isolated` derives all three shared-with-nobody namespaces from the workspace
 * id; `global` and `inherit` keep the shared `global` value unless a layer the
 * mode allows overrode it. The runtime namespace is always derived from the
 * workspace id.
 * @param mode - mode the workspace runs in.
 * @param workspaceId - workspace the namespaces belong to.
 * @param overrides - namespace values the overlay chain resolved.
 */
export function resolveNamespaces(
  mode: WorkspaceConfigMode,
  workspaceId: WorkspaceId,
  overrides: Partial<WorkspaceNamespaces> = {},
): WorkspaceNamespaces {
  const scoped = `ws:${workspaceId}`
  const runtime = `${scoped}/${RUNTIME_NAMESPACE_KEY}`
  if (mode === 'isolated') {
    return Object.freeze({ teamWork: scoped, taskGraph: scoped, memory: scoped, runtime })
  }
  return Object.freeze({
    teamWork: overrides.teamWork ?? 'global',
    taskGraph: overrides.taskGraph ?? 'global',
    memory: overrides.memory ?? 'global',
    runtime,
  })
}

/** Validate the documents and return them in the §6.3 order. */
function orderDocuments(layers: readonly ConfigLayerDocument[]): readonly ConfigLayerDocument[] {
  if (!Array.isArray(layers)) {
    throw new TypeError(`dsh-mywork: configuration layers must be an array, received ${describeValue(layers)}`)
  }
  const byLayer = new Map<ConfigLayer, ConfigLayerDocument>()
  for (const document of layers) {
    const layer = readLayer(document)
    if (byLayer.has(layer)) {
      throw new TypeError(`dsh-mywork: configuration layer "${layer}" was provided twice`)
    }
    readValues(document.values, layer)
    byLayer.set(layer, document)
  }
  const ordered: ConfigLayerDocument[] = []
  for (const layer of CONFIG_LAYERS) {
    const document = byLayer.get(layer)
    if (document !== undefined) ordered.push(document)
  }
  return ordered
}

/** Read and validate the `layer` and `revision` of one document. */
function readLayer(document: ConfigLayerDocument): ConfigLayer {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new TypeError(`dsh-mywork: a configuration layer must be an object, received ${describeValue(document)}`)
  }
  const layer = (document as { layer?: unknown }).layer
  if (typeof layer !== 'string' || !CONFIG_LAYERS.includes(layer as ConfigLayer)) {
    throw new TypeError(`dsh-mywork: unknown configuration layer ${describeValue(layer)}`)
  }
  if (!isCounter((document as { revision?: unknown }).revision)) {
    throw new TypeError(`dsh-mywork: revision of configuration layer "${layer}" must be a non-negative integer`)
  }
  return layer as ConfigLayer
}

/**
 * Validate the values of one layer.
 *
 * Anything a deployment can express in YAML but the resolver does not
 * understand fails here, so a misspelled domain cannot silently do nothing.
 */
function readValues(values: unknown, layer: ConfigLayer): ConfigLayerValues {
  const record = requireObject(values, `values of configuration layer "${layer}"`)
  for (const key of Object.keys(record)) {
    if (!CONFIG_DOMAINS.includes(key as ConfigDomain)) {
      throw new TypeError(`dsh-mywork: configuration layer "${layer}" carries unknown domain "${key}"`)
    }
  }
  readOptionalIdentifier(record.teamId, `teamId of configuration layer "${layer}"`)
  readOptionalIdentifier(record.workflowId, `workflowId of configuration layer "${layer}"`)
  readBlueprints(record.blueprints, layer)
  readMemoryRoutes(record.memoryRoutes, layer)
  readPools(record.pools, layer)
  readNamespaces(record.namespaces, layer)
  return values as ConfigLayerValues
}

/** Validate the blueprint pins of one layer. */
function readBlueprints(raw: unknown, layer: ConfigLayer): void {
  if (raw === undefined) return
  const record = requireObject(raw, `blueprints of configuration layer "${layer}"`)
  for (const [id, revision] of Object.entries(record)) {
    if (id.trim() === '') {
      throw new TypeError(`dsh-mywork: configuration layer "${layer}" pins a blueprint without an id`)
    }
    if (!isCounter(revision)) {
      throw new TypeError(
        `dsh-mywork: blueprint "${id}" of configuration layer "${layer}" must be pinned to a non-negative integer revision`,
      )
    }
  }
}

/** Validate the memory routes of one layer. */
function readMemoryRoutes(raw: unknown, layer: ConfigLayer): void {
  if (raw === undefined) return
  if (!Array.isArray(raw)) {
    throw new TypeError(`dsh-mywork: memoryRoutes of configuration layer "${layer}" must be an array`)
  }
  for (const route of raw) {
    if (typeof route !== 'string' || route.trim() === '') {
      throw new TypeError(`dsh-mywork: memoryRoutes of configuration layer "${layer}" must be non-empty strings`)
    }
  }
}

/** Validate the pool policies of one layer (§14). */
function readPools(raw: unknown, layer: ConfigLayer): void {
  if (raw === undefined) return
  const record = requireObject(raw, `pools of configuration layer "${layer}"`)
  for (const key of Object.keys(record)) {
    if (!['pools', 'roles', 'workspace'].includes(key)) {
      throw new TypeError(`dsh-mywork: pools of configuration layer "${layer}" carry unknown section "${key}"`)
    }
  }
  const pools = record.pools === undefined ? {} : requireObject(record.pools, `pools.pools of configuration layer "${layer}"`)
  for (const [name, value] of Object.entries(pools)) {
    const limits = requireObject(value, `pool "${name}" of configuration layer "${layer}"`)
    for (const key of Object.keys(limits)) {
      if (!['minActive', 'maxActive'].includes(key)) {
        throw new TypeError(`dsh-mywork: pool "${name}" of configuration layer "${layer}" carries unknown field "${key}"`)
      }
    }
    const minActive = limits.minActive === undefined ? undefined : requireCounter(limits.minActive, `pool "${name}".minActive`)
    const maxActive = limits.maxActive === undefined ? undefined : requireCounter(limits.maxActive, `pool "${name}".maxActive`)
    if (minActive !== undefined && maxActive !== undefined && minActive > maxActive) {
      throw new TypeError(
        `dsh-mywork: pool "${name}" of configuration layer "${layer}" keeps ${minActive} active instances above its maximum ${maxActive}`,
      )
    }
  }
  const roles = record.roles === undefined ? {} : requireObject(record.roles, `pools.roles of configuration layer "${layer}"`)
  for (const [roleId, value] of Object.entries(roles)) {
    const limits = requireObject(value, `role "${roleId}" of configuration layer "${layer}"`)
    for (const key of Object.keys(limits)) {
      if (key !== 'maxActive') {
        throw new TypeError(`dsh-mywork: role "${roleId}" of configuration layer "${layer}" carries unknown field "${key}"`)
      }
    }
    requireCounter(limits.maxActive, `role "${roleId}".maxActive`)
  }
  const workspace = record.workspace === undefined
    ? {}
    : requireObject(record.workspace, `pools.workspace of configuration layer "${layer}"`)
  for (const key of Object.keys(workspace)) {
    if (!['maxWorkers', 'maxReviewers'].includes(key)) {
      throw new TypeError(`dsh-mywork: pools.workspace of configuration layer "${layer}" carries unknown field "${key}"`)
    }
  }
  if (workspace.maxWorkers !== undefined) requireCounter(workspace.maxWorkers, 'pools.workspace.maxWorkers')
  if (workspace.maxReviewers !== undefined) requireCounter(workspace.maxReviewers, 'pools.workspace.maxReviewers')
}

/** Validate the namespace overrides of one layer. */
function readNamespaces(raw: unknown, layer: ConfigLayer): void {
  if (raw === undefined) return
  const record = requireObject(raw, `namespaces of configuration layer "${layer}"`)
  for (const [key, value] of Object.entries(record)) {
    if (!NAMESPACE_KEYS.includes(key as keyof WorkspaceNamespaces)) {
      throw new TypeError(`dsh-mywork: configuration layer "${layer}" overrides unknown namespace "${key}"`)
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(`dsh-mywork: namespace "${key}" of configuration layer "${layer}" must be a non-empty string`)
    }
  }
}

/** Refuse the layers a mode does not delegate to (§6.1, §6.2, §52). */
function assertLayerPolicy(
  documents: readonly ConfigLayerDocument[],
  mode: WorkspaceConfigMode,
  workspaceId: WorkspaceId,
  meta: OperationMeta,
): Result<WorkspaceConfigMode> {
  for (const document of documents) {
    const values = document.values as ConfigLayerValues
    const namespaces = values.namespaces ?? {}

    if (namespaces[RUNTIME_NAMESPACE_KEY] !== undefined) {
      return fail(
        new MyWorkError(
          'SECURITY_DENIED',
          `dsh-mywork: the runtime namespace is workspace-scoped (§52); configuration layer "${document.layer}" may not set it`,
          { details: { mode, layer: document.layer, namespace: RUNTIME_NAMESPACE_KEY, workspaceId } },
        ),
        meta,
      )
    }

    if (mode === 'isolated') {
      for (const key of ISOLATED_NAMESPACE_KEYS) {
        if (namespaces[key] === undefined) continue
        return fail(
          new MyWorkError(
            'SECURITY_DENIED',
            `dsh-mywork: an isolated workspace derives its "${key}" namespace (§6.2); configuration layer "${document.layer}" may not set it`,
            { details: { mode, layer: document.layer, namespace: key, workspaceId } },
          ),
          meta,
        )
      }
      continue
    }

    if (mode !== 'global' || !WORKSPACE_AUTHORED_LAYERS.includes(document.layer)) continue

    for (const domain of GLOBAL_ONLY_CONFIG_DOMAINS) {
      if ((values as Record<string, unknown>)[domain] === undefined) continue
      return fail(
        new MyWorkError(
          'CONTRACT_MISMATCH',
          `dsh-mywork: mode "global" uses the global "${domain}" (§6.1); configuration layer "${document.layer}" may not redefine it`,
          { details: { mode, layer: document.layer, domain, workspaceId } },
        ),
        meta,
      )
    }
    for (const key of ISOLATED_NAMESPACE_KEYS) {
      if (namespaces[key] === undefined) continue
      return fail(
        new MyWorkError(
          'CONTRACT_MISMATCH',
          `dsh-mywork: mode "global" uses the shared "${key}" namespace (§6.1); configuration layer "${document.layer}" may not override it`,
          { details: { mode, layer: document.layer, namespace: key, workspaceId } },
        ),
        meta,
      )
    }
  }
  return ok(mode, meta)
}

/** Effective values of a chain of documents. */
interface MergedValues {
  readonly teamId?: string
  readonly workflowId?: string
  readonly blueprints: Record<BlueprintId, Revision>
  readonly memoryRoutes: readonly string[]
  readonly pools?: PoolPolicyOverlay
  readonly namespaces: Partial<WorkspaceNamespaces>
}

/**
 * Merge the documents of the chain.
 *
 * Scalars and arrays are replaced by the higher layer; objects (blueprint pins,
 * pool policies, namespaces) merge key by key, so a `workspace` layer can
 * override one pool limit without repeating the rest of the section (§6.3).
 */
function mergeDocuments(documents: readonly ConfigLayerDocument[]): MergedValues {
  let teamId: string | undefined
  let workflowId: string | undefined
  let blueprints: Record<string, unknown> = {}
  let memoryRoutes: readonly string[] = []
  let pools: Record<string, unknown> | undefined
  let namespaces: Record<string, unknown> = {}

  for (const document of documents) {
    const values = document.values as ConfigLayerValues
    if (values.teamId !== undefined) teamId = values.teamId
    if (values.workflowId !== undefined) workflowId = values.workflowId
    if (values.blueprints !== undefined) blueprints = mergeObjects(blueprints, values.blueprints as Record<string, unknown>)
    if (values.memoryRoutes !== undefined) memoryRoutes = Object.freeze([...values.memoryRoutes])
    if (values.pools !== undefined) pools = mergeObjects(pools ?? {}, values.pools as unknown as Record<string, unknown>)
    if (values.namespaces !== undefined) namespaces = mergeObjects(namespaces, values.namespaces as Record<string, unknown>)
  }

  return {
    ...(teamId === undefined ? {} : { teamId }),
    ...(workflowId === undefined ? {} : { workflowId }),
    blueprints: blueprints as Record<BlueprintId, Revision>,
    memoryRoutes,
    ...(pools === undefined ? {} : { pools: pools as unknown as PoolPolicyOverlay }),
    namespaces: namespaces as Partial<WorkspaceNamespaces>,
  }
}

/**
 * Check the pool limits the chain resolved against each other (§14).
 *
 * A layer may state one side of a pair, so the coherence of `minActive` and
 * `maxActive` can only be decided once the chain is merged: a workspace that
 * lowers `maxActive` below the inherited `minActive` is a configuration conflict,
 * not a layer that parsed badly.
 */
function assertMergedPools(
  pools: PoolPolicyOverlay | undefined,
  workspaceId: WorkspaceId,
  meta: OperationMeta,
): Result<PoolPolicyOverlay | undefined> {
  if (pools === undefined) return ok(undefined, meta)
  for (const [name, limits] of Object.entries(pools.pools ?? {})) {
    if (limits.minActive === undefined || limits.maxActive === undefined) continue
    if (limits.minActive <= limits.maxActive) continue
    return fail(
      new MyWorkError(
        'CONTRACT_MISMATCH',
        `dsh-mywork: the resolved pool "${name}" of workspace "${workspaceId}" keeps ${limits.minActive} active instances above its maximum ${limits.maxActive}`,
        { details: { workspaceId, pool: name, minActive: limits.minActive, maxActive: limits.maxActive } },
      ),
      meta,
    )
  }
  return ok(pools, meta)
}

/** Recursive merge of plain objects; anything else is replaced by the override. */
function mergeObjects(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key]
    merged[key] = isPlainObject(value) && isPlainObject(current) ? mergeObjects(current, value) : value
  }
  return merged
}

/** Revision of each applied layer document. */
function layerRevisions(documents: readonly ConfigLayerDocument[]): Partial<Record<ConfigLayer, Revision>> {
  const revisions: Partial<Record<ConfigLayer, Revision>> = {}
  for (const document of documents) revisions[document.layer] = document.revision
  return revisions
}

/**
 * Domains a layer states a value for.
 *
 * An object domain that is present but empty (`blueprints: {}`) states nothing,
 * so a layer that only carries it is not an applied layer; an empty array does
 * state something, because replacing the memory routes with none is a decision.
 */
function contributedDomains(values: ConfigLayerValues): readonly ConfigDomain[] {
  const stated: ConfigDomain[] = []
  const record = values as Record<string, unknown>
  for (const domain of CONFIG_DOMAINS) {
    const value = record[domain]
    if (value === undefined) continue
    if (isPlainObject(value) && Object.keys(value).length === 0) continue
    stated.push(domain)
  }
  return stated
}

/**
 * Canonical form of a resolved state.
 *
 * Object keys are sorted and absent values are dropped, so the form depends on
 * the state and not on the order the fields were built in.
 * @param value - the state to canonicalize.
 */
export function canonicalForm(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

/** Recursively sort object keys and drop `undefined` entries. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const entry = value[key]
    if (entry !== undefined) sorted[key] = canonicalize(entry)
  }
  return sorted
}

/** Whether a value is a plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Freeze a merged value together with its containers.
 *
 * The merged maps and arrays are built here, so freezing them costs nothing and
 * makes the resolved configuration immutable in fact, not only by contract.
 * @param value - the freshly built value to freeze.
 */
function freezeDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) freezeDeep(entry)
    return Object.freeze(value) as T
  }
  if (!isPlainObject(value)) return value
  for (const entry of Object.values(value)) freezeDeep(entry)
  return Object.freeze(value) as T
}

/** Human-readable kind of a rejected value. */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'string') return `"${value}"`
  return typeof value
}

/** Reject a missing or blank identifier. */
function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`dsh-mywork: ${field} must be a non-empty string`)
  }
  return value
}

/** Reject a blank optional identifier. */
function readOptionalIdentifier(value: unknown, field: string): void {
  if (value === undefined) return
  requireIdentifier(value, field)
}

/** Require a plain object. */
function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new TypeError(`dsh-mywork: ${field} must be an object, received ${describeValue(value)}`)
  }
  return value
}

/** Require a non-negative safe integer. */
function requireCounter(value: unknown, field: string): number {
  if (!isCounter(value)) {
    throw new TypeError(`dsh-mywork: ${field} must be a non-negative integer`)
  }
  return value
}
