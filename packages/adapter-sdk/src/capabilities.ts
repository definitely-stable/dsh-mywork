/**
 * Adapter capability schema (architecture §36, §37): the port families MyWork
 * defines, the manifest every adapter declares, and the validation a
 * declaration passes before the registry accepts it.
 * @module
 */

import { parseContractVersion } from './contract-version.ts'

/**
 * Port families, in the order §36 lists the stable ports. One kind corresponds
 * to one port: `agent-runtime` to `AgentRuntimePort`, `memory` to
 * `MemoryProviderPort`, and so on. The port interfaces themselves live in
 * `@dsh-mywork/contracts` and arrive with the card that binds the integration.
 */
export type AdapterKind =
  | 'agent-runtime'
  | 'session'
  | 'model-catalog'
  | 'taskgraph'
  | 'task-board'
  | 'context-provider'
  | 'memory'
  | 'skill-provider'
  | 'workspace'
  | 'artifact-store'
  | 'event-bus'
  | 'lease-store'

/** Every port family, in the order §36 lists the stable ports. */
export const ADAPTER_KINDS: readonly AdapterKind[] = Object.freeze([
  'agent-runtime',
  'session',
  'model-catalog',
  'taskgraph',
  'task-board',
  'context-provider',
  'memory',
  'skill-provider',
  'workspace',
  'artifact-store',
  'event-bus',
  'lease-store',
])

/** Identity and declared capabilities of one adapter (architecture §37). */
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
 * registry refuses it before any work is assigned to the adapter. The check
 * here is structural — the revision must be one, and it must belong to the port
 * family the adapter claims. Whether that revision is *compatible* with the one
 * MyWork implements is decided by the registry, which answers with
 * `CONTRACT_MISMATCH`.
 * @param manifest - the declaration to validate.
 * @returns the same declaration, deeply frozen.
 * @throws {TypeError} when an identifier is empty, the kind is unknown, the revision is malformed or names another port, or a capability flag is not a boolean.
 */
export function defineAdapterManifest(manifest: AdapterCapabilityManifest): AdapterCapabilityManifest {
  if (typeof manifest.adapterId !== 'string' || manifest.adapterId.trim() === '') {
    throw new TypeError('dsh-mywork: adapter manifest requires a non-empty adapterId')
  }
  if (!ADAPTER_KINDS.includes(manifest.kind)) {
    throw new TypeError(`dsh-mywork: adapter "${manifest.adapterId}" declares unknown kind "${String(manifest.kind)}"`)
  }
  const parsed = parseContractVersion(manifest.contractVersion)
  if (parsed === undefined) {
    throw new TypeError(
      `dsh-mywork: adapter "${manifest.adapterId}" requires a contractVersion like "memory/v1", received "${String(manifest.contractVersion)}"`,
    )
  }
  if (parsed.family !== manifest.kind) {
    throw new TypeError(
      `dsh-mywork: adapter "${manifest.adapterId}" declares kind "${manifest.kind}" but implements "${manifest.contractVersion}"`,
    )
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
 * Whether an adapter declares a capability as supported. An absent key is not
 * supported: capability negotiation never assumes a default.
 * @param manifest - the adapter's declaration.
 * @param capability - capability name to test.
 */
export function supportsCapability(manifest: AdapterCapabilityManifest, capability: string): boolean {
  return manifest.capabilities[capability] === true
}

/**
 * Every capability the adapter declares as supported, in declaration order.
 * @param manifest - the adapter's declaration.
 */
export function supportedCapabilities(manifest: AdapterCapabilityManifest): readonly string[] {
  return Object.freeze(
    Object.entries(manifest.capabilities)
      .filter(([, supported]) => supported)
      .map(([capability]) => capability),
  )
}
