/**
 * Adapter SDK entry: the stable port catalog (architecture §36), the capability
 * schema and contract revisions (§37), the adapter registry with capability
 * negotiation (§44), the shared error vocabulary (§42), and the conformance kit
 * (§38, §39). Deterministic fakes live in the `./testing` subpath so production
 * code never pulls them in.
 *
 * Nothing here imports DSH or a concrete integration: an adapter is registered
 * by declaration, and policy asks the registry for a port instead of naming a
 * provider.
 * @module @dsh-mywork/adapter-sdk
 */

export {
  ADAPTER_KINDS,
  defineAdapterManifest,
  supportedCapabilities,
  supportsCapability,
  type AdapterCapabilityManifest,
  type AdapterKind,
} from './capabilities.ts'
export {
  PORT_CONTRACT_MAJOR,
  isContractVersionCompatible,
  nextContractMajor,
  parseContractVersion,
  portContractVersion,
  type ParsedContractVersion,
} from './contract-version.ts'
export { PORT_CONTRACTS, portContractOf, type PortContract } from './port-contract.ts'
export {
  ADAPTER_ERROR_CODES,
  AdapterError,
  AdapterRefusal,
  adapterUnavailable,
  capabilityUnsupported,
  contractMismatch,
  isAdapterError,
  isAdapterRefusal,
  type AdapterErrorCode,
  type AdapterRefusalOptions,
} from './errors.ts'
export {
  createAdapterRegistry,
  manifestOfRegistration,
  type AdapterKey,
  type AdapterRegistration,
  type AdapterRegistrationHandle,
  type AdapterRegistry,
  type AdapterRegistryObserver,
  type AdapterRegistryOptions,
  type AdapterRequirement,
  type AdapterResolution,
  type MyWorkAdapters,
  type RegisteredAdapter,
} from './registry.ts'
export {
  CONFORMANCE_UNKNOWN_CAPABILITY,
  ConformanceSkip,
  REQUIRED_CONFORMANCE_CHECKS,
  agentRuntimeChecks,
  commonAdapterChecks,
  memoryChecks,
  runConformance,
  skipConformance,
  type AgentRuntimeChecksOptions,
  type CommonAdapterChecksOptions,
  type ConformanceCheck,
  type ConformanceReport,
  type ConformanceResult,
  type ConformanceRunOptions,
  type ConformanceStatus,
  type MemoryChecksOptions,
} from './conformance.ts'
