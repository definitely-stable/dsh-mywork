/**
 * The stable port set (architecture §36, §62 item 32): every port MyWork
 * declares a contract for, the interface it is expressed by, and the contract
 * revision an adapter of that kind must implement.
 *
 * The catalog is the single declaration of "which ports exist". Port interfaces
 * are added to `@dsh-mywork/contracts` by the card that binds the integration
 * (`agent-runtime` exists today), and the conformance kit (§39) grows with
 * them; the kind and its contract revision are stable from here on.
 * @module
 */

import { ADAPTER_KINDS, type AdapterKind } from './capabilities.ts'
import { portContractVersion } from './contract-version.ts'

/** One stable port: its family, its interface name, and its contract revision. */
export interface PortContract {
  /** Port family an adapter of this port registers as. */
  readonly kind: AdapterKind
  /** Interface name from §36; the interface itself lives in `@dsh-mywork/contracts`. */
  readonly port: string
  /** Contract revision every adapter of this port must implement, e.g. `memory/v1`. */
  readonly contractVersion: string
}

/** Port interface names §36 declares, keyed by adapter kind. */
const PORT_INTERFACES: Readonly<Record<AdapterKind, string>> = Object.freeze({
  'agent-runtime': 'AgentRuntimePort',
  session: 'SessionPort',
  'model-catalog': 'ModelCatalogPort',
  taskgraph: 'TaskGraphPort',
  'task-board': 'TaskBoardPort',
  'context-provider': 'ContextProviderPort',
  memory: 'MemoryProviderPort',
  'skill-provider': 'SkillProviderPort',
  workspace: 'WorkspacePort',
  'artifact-store': 'ArtifactStorePort',
  'event-bus': 'EventBusPort',
  'lease-store': 'LeaseStorePort',
})

/** Every stable port with its contract revision, in §36 order. */
export const PORT_CONTRACTS: readonly PortContract[] = Object.freeze(
  ADAPTER_KINDS.map(kind =>
    Object.freeze({ kind, port: PORT_INTERFACES[kind], contractVersion: portContractVersion(kind) }),
  ),
)

/**
 * The contract of one port family.
 * @param kind - port family.
 * @returns the catalog entry for that port.
 * @throws {TypeError} when the kind is not one §36 declares.
 */
export function portContractOf(kind: AdapterKind): PortContract {
  const found = PORT_CONTRACTS.find(entry => entry.kind === kind)
  if (found === undefined) {
    throw new TypeError(`dsh-mywork: "${String(kind)}" is not a stable port of §36`)
  }
  return found
}
