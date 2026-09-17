/**
 * Adapter registry and capability negotiation (architecture §37, §44).
 *
 * An adapter declares *what it is* (kind), *which contract it implements*, and
 * *what it supports* (capabilities). MyWork asks the registry for a port by
 * kind plus required capabilities — never by provider name — so no policy
 * branches on which integration happens to be installed, and an incompatible or
 * under-capable adapter is refused explicitly instead of being used partially.
 *
 * Registration is reversible: {@link AdapterRegistrationHandle.unregister} and
 * {@link AdapterRegistry.clear} (used when the owning plugin unloads) remove an
 * adapter and its instance.
 * @module
 */

import {
  defineAdapterManifest,
  supportsCapability,
  type AdapterCapabilityManifest,
  type AdapterKind,
} from './capabilities.ts'
import { isContractVersionCompatible } from './contract-version.ts'
import {
  AdapterRefusal,
  adapterUnavailable,
  capabilityUnsupported,
  contractMismatch,
} from './errors.ts'
import { portContractOf } from './port-contract.ts'

/**
 * What an adapter declares and how the registry materialises it (§37, §44).
 *
 * The registration keeps the shape §44 uses (`id`), while the accepted
 * declaration is the §37 manifest (`adapterId`); {@link manifestOfRegistration}
 * is the single place the two meet.
 *
 * `create` is called once, when the registration is accepted, so a broken
 * adapter fails where it is registered rather than at first use.
 */
export interface AdapterRegistration<TPort = unknown, TContext = undefined> {
  /** Port family the adapter implements. */
  readonly kind: AdapterKind
  /** Stable adapter identifier, e.g. `beads` or `hindsight`. */
  readonly id: string
  /** Contract revision the adapter implements, e.g. `memory/v1`. */
  readonly contractVersion: string
  /** Capability flags; an absent key means "not supported". */
  readonly capabilities: Readonly<Record<string, boolean>>
  /**
   * Build the adapter instance.
   * @param context - the context the registrant passed to `register`.
   */
  create(context: TContext): TPort
}

/**
 * The §37 manifest of a §44 registration.
 * @param registration - the declaration an adapter registers.
 * @throws {TypeError} when the declaration is malformed.
 */
export function manifestOfRegistration<TPort, TContext>(
  registration: AdapterRegistration<TPort, TContext>,
): AdapterCapabilityManifest {
  return defineAdapterManifest({
    adapterId: registration.id,
    kind: registration.kind,
    contractVersion: registration.contractVersion,
    capabilities: registration.capabilities,
  })
}

/** What a caller needs from an adapter: a contract revision and capabilities. */
export interface AdapterRequirement {
  /** Contract revision the caller speaks; defaults to the port's current one. */
  readonly contractVersion?: string
  /** Capabilities the caller requires; every one must be declared as supported. */
  readonly capabilities?: readonly string[]
}

/** Identity of a registered adapter. A manifest satisfies this shape. */
export interface AdapterKey {
  /** Port family the adapter implements. */
  readonly kind: AdapterKind
  /** Adapter identifier. */
  readonly id: string
}

/** An adapter the registry accepted. */
export interface RegisteredAdapter<TPort> {
  /** The frozen declaration the adapter was accepted with. */
  readonly manifest: AdapterCapabilityManifest
  /** The instance produced by the registration's factory. */
  readonly adapter: TPort
}

/** Handle returned by {@link AdapterRegistry.register}. */
export interface AdapterRegistrationHandle<TPort> extends RegisteredAdapter<TPort> {
  /**
   * Remove the registration and its instance.
   * @returns `true` when this call removed it, `false` when it was already gone.
   */
  unregister(): boolean
}

/** Outcome of one capability negotiation: the chosen adapter or the refusal. */
export type AdapterResolution<TPort> =
  | ({ readonly ok: true } & RegisteredAdapter<TPort>)
  | { readonly ok: false; readonly refusal: AdapterRefusal }

/** Observability hooks (§38) for the registry lifecycle. */
export interface AdapterRegistryObserver {
  /**
   * One adapter was accepted.
   * @param manifest - the accepted declaration.
   * @param size - registry size after the change.
   */
  readonly onRegistered?: (manifest: AdapterCapabilityManifest, size: number) => void
  /**
   * One adapter was removed.
   * @param manifest - the removed declaration.
   * @param size - registry size after the change.
   */
  readonly onUnregistered?: (manifest: AdapterCapabilityManifest, size: number) => void
  /**
   * A registration or negotiation was refused with a canonical §42 code.
   * @param refusal - the refusal that was raised or returned.
   */
  readonly onRefused?: (refusal: AdapterRefusal) => void
}

/** Options accepted by {@link createAdapterRegistry}. */
export interface AdapterRegistryOptions {
  /** Observability hooks; absent means the registry is silent. */
  readonly observer?: AdapterRegistryObserver
}

/**
 * The registry MyWork resolves ports from.
 *
 * `register` throws {@link AdapterRefusal} (or `TypeError` for a malformed
 * declaration) because a mis-declared adapter is a configuration error that
 * must fail where it is mounted. `resolve` returns the refusal instead, so an
 * operation missing an adapter can answer with a typed `Result`.
 */
export interface AdapterRegistry<TContext = undefined> {
  /** Number of registered adapters. */
  readonly size: number
  /**
   * Accept an adapter after validating and negotiating its declaration.
   * @param registration - declaration plus the factory that builds the instance.
   * @param context - passed to the registration's factory.
   * @throws {TypeError} when the declaration is malformed.
   * @throws {AdapterRefusal} `CONTRACT_MISMATCH` for an incompatible revision, `TASK_CONFLICT` for a duplicate id.
   */
  register<TPort>(
    registration: AdapterRegistration<TPort, TContext>,
    context?: TContext,
  ): AdapterRegistrationHandle<TPort>
  /**
   * Remove one adapter.
   * @param adapter - kind and id of the adapter.
   * @returns `true` when this call removed it, `false` when it was not registered.
   */
  unregister(adapter: AdapterKey): boolean
  /**
   * Negotiate: pick the first registered adapter of the kind that implements a
   * compatible revision and declares every required capability.
   *
   * Precedence is stable so a caller can tell the two failures apart: an
   * incompatible revision is reported as `CONTRACT_MISMATCH` before a missing
   * capability is considered, and a missing capability as
   * `CAPABILITY_UNSUPPORTED` with the names in `details.missing`. The adapter id
   * is never part of the decision — only `kind`, the revision, and the
   * declared capabilities are.
   * @param kind - port family the caller needs.
   * @param requirement - revision and capabilities the caller needs.
   */
  resolve<TPort = unknown>(kind: AdapterKind, requirement?: AdapterRequirement): AdapterResolution<TPort>
  /**
   * Like {@link AdapterRegistry.resolve}, but throws the refusal.
   * @param kind - port family the caller needs.
   * @param requirement - revision and capabilities the caller needs.
   * @throws {AdapterRefusal} the refusal `resolve` would have returned.
   */
  require<TPort = unknown>(kind: AdapterKind, requirement?: AdapterRequirement): TPort
  /**
   * Declarations of the registered adapters, in registration order.
   * @param kind - optional port family filter.
   */
  list(kind?: AdapterKind): readonly AdapterCapabilityManifest[]
  /**
   * Remove every adapter, as a plugin unload does.
   * @returns how many adapters were removed.
   */
  clear(): number
}

/**
 * The registration surface MyWork publishes to adapters (§44). The controller
 * publishes it as `myworkAdapters`; an adapter row calls it from its own
 * `apply`. It is the registry without {@link AdapterRegistry.clear}, which
 * belongs to the owner of the lifecycle.
 */
export interface MyWorkAdapters<TContext = undefined> {
  /** Number of registered adapters. */
  readonly size: number
  /** See {@link AdapterRegistry.register}. */
  register<TPort>(
    registration: AdapterRegistration<TPort, TContext>,
    context?: TContext,
  ): AdapterRegistrationHandle<TPort>
  /** See {@link AdapterRegistry.unregister}. */
  unregister(adapter: AdapterKey): boolean
  /** See {@link AdapterRegistry.resolve}. */
  resolve<TPort = unknown>(kind: AdapterKind, requirement?: AdapterRequirement): AdapterResolution<TPort>
  /** See {@link AdapterRegistry.require}. */
  require<TPort = unknown>(kind: AdapterKind, requirement?: AdapterRequirement): TPort
  /** See {@link AdapterRegistry.list}. */
  list(kind?: AdapterKind): readonly AdapterCapabilityManifest[]
}

/**
 * Create an empty registry.
 * @param options - observability hooks.
 */
export function createAdapterRegistry<TContext = undefined>(
  options: AdapterRegistryOptions = {},
): AdapterRegistry<TContext> {
  const entries = new Map<string, RegisteredAdapter<unknown>>()
  const observer = options.observer

  /**
   * Storage key of an adapter: kind and id are its identity. A manifest is
   * accepted as well, so callers can pass whichever shape they hold.
   */
  function storageKey(adapter: AdapterKey | AdapterCapabilityManifest): string {
    const id = 'id' in adapter ? adapter.id : adapter.adapterId
    return `${adapter.kind}\u0000${id}`
  }

  /** Report a refusal to the observer and return it as a failed resolution. */
  function refused<T>(refusal: AdapterRefusal): AdapterResolution<T> {
    observer?.onRefused?.(refusal)
    return Object.freeze({ ok: false, refusal })
  }

  /** Report a refusal to the observer and raise it. */
  function reject(refusal: AdapterRefusal): never {
    observer?.onRefused?.(refusal)
    throw refusal
  }

  /** Remove one entry, reporting the removal when there was one. */
  function take(adapter: AdapterKey | AdapterCapabilityManifest): RegisteredAdapter<unknown> | undefined {
    const key = storageKey(adapter)
    const entry = entries.get(key)
    if (entry === undefined) return undefined
    entries.delete(key)
    observer?.onUnregistered?.(entry.manifest, entries.size)
    return entry
  }

  /** Negotiate one resolution without touching the observer twice. */
  function negotiate<TPort>(
    kind: AdapterKind,
    requirement: AdapterRequirement,
  ): AdapterResolution<TPort> {
    const required = requirement.contractVersion ?? portContractOf(kind).contractVersion
    const requiredCapabilities = requirement.capabilities ?? []
    const candidates = [...entries.values()].filter(entry => entry.manifest.kind === kind)
    if (candidates.length === 0) {
      return refused(adapterUnavailable(`dsh-mywork: no ${kind} adapter is registered`, { kind, required }))
    }
    const compatible = candidates.filter(entry =>
      isContractVersionCompatible(entry.manifest.contractVersion, required),
    )
    if (compatible.length === 0) {
      return refused(
        contractMismatch(
          `dsh-mywork: no ${kind} adapter implements "${required}"; registered: ${candidates.map(entry => entry.manifest.contractVersion).join(', ')}`,
          { kind, required, registered: candidates.map(entry => entry.manifest.contractVersion) },
        ),
      )
    }
    let missingMost: readonly string[] | undefined
    for (const entry of compatible) {
      const missing = requiredCapabilities.filter(
        capability => !supportsCapability(entry.manifest, capability),
      )
      if (missing.length === 0) {
        return Object.freeze({ ok: true, manifest: entry.manifest, adapter: entry.adapter as TPort })
      }
      if (missingMost === undefined || missing.length < missingMost.length) missingMost = missing
    }
    const missing = missingMost ?? []
    return refused(
      capabilityUnsupported(
        `dsh-mywork: no ${kind} adapter declares ${missing.map(name => `"${name}"`).join(', ')}`,
        { kind, required: requiredCapabilities, missing },
      ),
    )
  }

  return {
    get size(): number {
      return entries.size
    },

    register<TPort>(
      registration: AdapterRegistration<TPort, TContext>,
      context?: TContext,
    ): AdapterRegistrationHandle<TPort> {
      const manifest = manifestOfRegistration(registration)
      const contract = portContractOf(manifest.kind)
      if (!isContractVersionCompatible(manifest.contractVersion, contract.contractVersion)) {
        reject(
          contractMismatch(
            `dsh-mywork: adapter "${manifest.adapterId}" implements "${manifest.contractVersion}", but ${contract.port} speaks "${contract.contractVersion}"`,
            {
              adapterId: manifest.adapterId,
              kind: manifest.kind,
              declared: manifest.contractVersion,
              required: contract.contractVersion,
            },
          ),
        )
      }
      const key = storageKey(manifest)
      if (entries.has(key)) {
        reject(
          new AdapterRefusal(
            'TASK_CONFLICT',
            `dsh-mywork: a ${manifest.kind} adapter with id "${manifest.adapterId}" is already registered`,
            { details: { adapterId: manifest.adapterId, kind: manifest.kind } },
          ),
        )
      }
      // The context is optional so a registration whose factory ignores it needs
      // no argument; with the default `TContext = undefined` the cast is exact.
      const adapter = registration.create(context as TContext)
      const entry: RegisteredAdapter<TPort> = Object.freeze({ manifest, adapter })
      entries.set(key, entry)
      observer?.onRegistered?.(manifest, entries.size)
      return Object.freeze({
        manifest,
        adapter,
        unregister: (): boolean => take(manifest) !== undefined,
      })
    },

    unregister(adapter: AdapterKey): boolean {
      return take(adapter) !== undefined
    },

    resolve<TPort = unknown>(
      kind: AdapterKind,
      requirement: AdapterRequirement = {},
    ): AdapterResolution<TPort> {
      return negotiate<TPort>(kind, requirement)
    },

    require<TPort = unknown>(kind: AdapterKind, requirement?: AdapterRequirement): TPort {
      // `negotiate` already reports the refusal to the observer exactly once.
      const resolution = negotiate<TPort>(kind, requirement ?? {})
      if (!resolution.ok) throw resolution.refusal
      return resolution.adapter
    },

    list(kind?: AdapterKind): readonly AdapterCapabilityManifest[] {
      const manifests = [...entries.values()]
        .filter(entry => kind === undefined || entry.manifest.kind === kind)
        .map(entry => entry.manifest)
      return Object.freeze(manifests)
    },

    clear(): number {
      const manifests = [...entries.values()].map(entry => entry.manifest)
      entries.clear()
      manifests.forEach((manifest, index) => {
        observer?.onUnregistered?.(manifest, manifests.length - index - 1)
      })
      return manifests.length
    },
  }
}
