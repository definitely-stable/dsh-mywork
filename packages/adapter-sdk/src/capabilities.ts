/**
 * Adapter capability negotiation (architecture §37): every adapter declares
 * what it supports, and core branches on the declaration instead of on a
 * provider identity.
 * @module
 */

/** Adapter families MyWork defines a port for. */
export type AdapterKind =
  | 'memory'
  | 'taskgraph'
  | 'agent-runtime'
  | 'task-board'
  | 'artifact-store'
  | 'context-provider'
  | 'skill-provider'
  | 'workspace'

/** Every adapter family, in the order the architecture lists them. */
export const ADAPTER_KINDS: readonly AdapterKind[] = Object.freeze([
  'memory',
  'taskgraph',
  'agent-runtime',
  'task-board',
  'artifact-store',
  'context-provider',
  'skill-provider',
  'workspace',
])

/** Identity and declared capabilities of one adapter. */
export interface AdapterCapabilityManifest {
  /** Stable adapter identifier, e.g. `beads` or `dsh-session`. */
  readonly adapterId: string
  /** Port family the adapter implements. */
  readonly kind: AdapterKind
  /** Contract revision the adapter implements, e.g. `memory/v1`. */
  readonly contractVersion: string
  /** Capability flags; an absent key means "not supported". */
  readonly capabilities: Readonly<Record<string, boolean>>
}

/**
 * Validate an adapter declaration and freeze it.
 *
 * A malformed manifest is a programming error, not a runtime condition: the
 * registry refuses it before any work is assigned to the adapter.
 * @param manifest - the declaration to validate.
 * @returns the same declaration, deeply frozen.
 * @throws {TypeError} when an identifier is empty or a capability flag is not a boolean.
 */
export function defineAdapterManifest(manifest: AdapterCapabilityManifest): AdapterCapabilityManifest {
  if (typeof manifest.adapterId !== 'string' || manifest.adapterId.trim() === '') {
    throw new TypeError('dsh-mywork: adapter manifest requires a non-empty adapterId')
  }
  if (!ADAPTER_KINDS.includes(manifest.kind)) {
    throw new TypeError(`dsh-mywork: adapter "${manifest.adapterId}" declares unknown kind "${String(manifest.kind)}"`)
  }
  if (typeof manifest.contractVersion !== 'string' || manifest.contractVersion.trim() === '') {
    throw new TypeError(`dsh-mywork: adapter "${manifest.adapterId}" requires a non-empty contractVersion`)
  }
  const capabilities: Record<string, boolean> = {}
  for (const [capability, supported] of Object.entries(manifest.capabilities)) {
    if (capability.trim() === '') {
      throw new TypeError(`dsh-mywork: adapter "${manifest.adapterId}" declares an empty capability name`)
    }
    if (typeof supported !== 'boolean') {
      throw new TypeError(
        `dsh-mywork: adapter "${manifest.adapterId}" capability "${capability}" must be a boolean, received ${typeof supported}`,
      )
    }
    capabilities[capability] = supported
  }
  return Object.freeze({
    adapterId: manifest.adapterId,
    kind: manifest.kind,
    contractVersion: manifest.contractVersion,
    capabilities: Object.freeze(capabilities),
  })
}

/**
 * Whether an adapter declares a capability as supported.
 * @param manifest - the adapter's declaration.
 * @param capability - capability name to test.
 */
export function supportsCapability(manifest: AdapterCapabilityManifest, capability: string): boolean {
  return manifest.capabilities[capability] === true
}
