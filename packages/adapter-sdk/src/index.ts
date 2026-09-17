/**
 * Adapter SDK entry: capability manifests (architecture §37) and the adapter
 * error vocabulary every implementation shares. Deterministic fakes live in
 * the `./testing` subpath so production code never pulls them in.
 * @module @dsh-mywork/adapter-sdk
 */

export {
  ADAPTER_KINDS,
  defineAdapterManifest,
  supportsCapability,
  type AdapterCapabilityManifest,
  type AdapterKind,
} from './capabilities.ts'
export { AdapterError, isAdapterError, type AdapterErrorCode } from './errors.ts'
