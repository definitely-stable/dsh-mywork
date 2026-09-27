/**
 * Host entry of the MyWork controller plugin.
 *
 * `apply` publishes two services on the host context — `myworkController` (the
 * control-plane snapshot) and `myworkAdapters` (the adapter registry of §44) —
 * and registers the shutdown effects that settle them when the plugin unloads.
 * The package is a DSH bundle: `cordis.patch.yml` inserts this row into any
 * profile that lists `@dsh-mywork/controller`.
 * @module @dsh-mywork/controller
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import {
  createAdapterRegistry,
  type AdapterCapabilityManifest,
  type AdapterKey,
  type AdapterKind,
  type AdapterRegistration,
  type AdapterRegistrationHandle,
  type AdapterRegistry,
  type AdapterRegistryObserver,
  type AdapterRequirement,
  type AdapterResolution,
  type MyWorkAdapters,
} from '@dsh-mywork/adapter-sdk'
import {
  MYWORK_ADAPTERS_SERVICE,
  MYWORK_CLOCK_SERVICE,
  MYWORK_CONTROLLER_SERVICE,
  type ClockPort,
  type ControllerInfo,
  type MyWorkController,
} from '@dsh-mywork/contracts'
import {
  controllerInfo,
  controllerUptimeMs,
  initialControllerState,
  mountController,
  mountDiagnostic,
  resolveControllerConfig,
  stopController,
  stopDiagnostic,
  systemClock,
  type ControllerConfig,
  type ControllerState,
} from '@dsh-mywork/core'
import { mountModelCatalog } from './model-catalog.ts'
import { mountDshRuntime } from './dsh-session.ts'
import { createMyWorkApplication } from './app.ts'

/** The composition root and the database schema it owns, as this package's surface. */
export {
  MYWORK_DATABASE_MIGRATIONS,
  adoptedAllocations,
  createMyWorkApplication,
  myworkDatabaseMigrations,
  type MyWorkApplication,
  type MyWorkApplicationOptions,
  type MyWorkSubsystem,
  type MyWorkSubsystemName,
} from './app.ts'

/** The migration-version allocator of the composition layer (F-63). */
export {
  MigrationAllocatorError,
  createMigrationAllocator,
  isMigrationAllocatorError,
  type Allocation,
  type AllocationAdoption,
  type MigrationAllocator,
  type MigrationAllocatorErrorCode,
  type MigrationAllocatorOptions,
  type MigrationRequest,
} from './migration-allocator.ts'

/** The §29 catalog binding the controller mounts, re-exported as its public surface. */
export {
  DSH_LLM_SERVICE,
  DSH_MODEL_CATALOG_ADAPTER_ID,
  DSH_MODEL_CATALOG_CAPABILITIES,
  DSH_MODEL_CATALOG_KIND,
  DshModelCatalog,
  mountModelCatalog,
  type DshLlmRegistry,
} from './model-catalog.ts'

/** The §22/§39 session and agent-runtime binding, re-exported as its public surface. */
export {
  DSH_AGENT_RUNTIME_ADAPTER_ID,
  DSH_AGENT_RUNTIME_CAPABILITIES,
  DSH_AGENT_RUNTIME_KIND,
  DSH_AGENTS_SERVICE,
  DSH_COMMANDS_SERVICE,
  DSH_REQUEST_ID_PREFIX,
  DSH_SESSION_ADAPTER_ID,
  DSH_SESSION_CAPABILITIES,
  DSH_SESSION_KIND,
  DSH_SESSION_SERVICE,
  DshAgentRuntime,
  DshSessionAdapter,
  DshSessionRefusal,
  mountDshRuntime,
  type DshAgent,
  type DshAgentRegistry,
  type DshCommandExecution,
  type DshCommandRuntime,
  type DshFollowFrame,
  type DshFollowSnapshot,
  type DshModelSelection,
  type DshSessionAddress,
  type DshSessionApi,
  type DshSessionController,
  type DshSessionSummary,
  type DshWireEvent,
  type DshWireHeader,
} from './dsh-session.ts'

/**
 * The F-54/F-55 product-telemetry export, re-exported as this package's public
 * surface: the record builder, the attribute allowlist that bounds what it may
 * disclose, and the fail-open `emit` wrapper (D16).
 */
export {
  PRODUCT_ATTRIBUTE_ALLOWLIST,
  PRODUCT_EVENT_BODIES,
  PRODUCT_EVENT_INPUT_FIELDS,
  PRODUCT_EVENT_NAMES,
  PRODUCT_EVENT_NAME_BY_OUTCOME,
  PRODUCT_EVENT_OUTCOMES,
  PRODUCT_TELEMETRY_SERVICE,
  emitProductEvent,
  resolveProductTelemetry,
  toProductEvent,
  type ProductEmitResult,
  type ProductEventInput,
  type ProductEventOutcome,
  type ProductTelemetryContext,
  type ProductTelemetryPort,
  type ProductTelemetryRecord,
  type ProductTelemetryScalar,
} from './telemetry.ts'

/**
 * The §30 charge bridge over the platform token meter (F-51, D05):
 * `measure()` in, a `BudgetCharge` out, and no counter of its own.
 */
export {
  bridgeMeasurement,
  createBudgetMeter,
  type BudgetMeter,
  type BudgetMeterPricing,
  type MeasuredCharge,
  type MeasurementBaseline,
  type MeasurementBridgeInput,
  type MeasurementSource,
  type TokenMeasurement,
  type TokenMeterPort,
} from './budget-meter.ts'

/** Plugin display name used by the Cordis loader in diagnostics. */
export const name = '@dsh-mywork/controller'

/** Controller package version reported through the service. */
export const CONTROLLER_VERSION = '0.1.0'

/**
 * Bounded contexts the controller owns today. Architecture §46 lists the full
 * set; later MW tasks add a context here only when they take its ownership.
 */
export const BOUNDED_CONTEXTS: readonly string[] = Object.freeze(['control'])

/** Row configuration accepted by the controller. */
export interface Config {
  /** Write one lifecycle line per mount and stop to stderr. Default false. */
  diagnostics?: boolean
}

/**
 * Mount the controller for one composition row.
 *
 * The row owns exactly one lifecycle: the application service created here opens
 * the state databases, brings the subsystems up, and publishes the ports it
 * owns into `myworkAdapters`. `apply` awaits that startup, so a caller that
 * awaited the plugin can rely on the store existing — and a row whose home is not
 * writable fails the mount instead of half-mounting.
 * @param ctx - the plugin's host context.
 * @param config - optional row configuration.
 * @throws {TypeError} when the row configuration is malformed.
 */
export async function apply(ctx: Context, config?: Config): Promise<void> {
  const resolved = resolveControllerConfig(config)
  const clock = resolveClock(ctx)
  const service = new MyWorkControllerService(ctx, resolved, clock)
  const adapters = new MyWorkAdaptersService(ctx)
  const app = createMyWorkApplication({
    clock,
    adapters,
    diagnostics: resolved.diagnostics,
  })
  // One effect, one owner: the snapshot service settles first, then the
  // application takes the subsystems, the stores, and the registrations down.
  // Two separate effects would let one half of the row outlive the other.
  ctx.effect(
    () => () => {
      service.stop()
      return app.stop().then(() => {
        adapters.close()
      })
    },
    'mywork controller shutdown',
  )
  await app.start()
  // §29/§36: the DSH LLM registry becomes a port the policy can negotiate. A
  // profile without it still mounts the controller — the binding reports the
  // absence instead of failing the row.
  mountModelCatalog(ctx, adapters)
  // §22/§39: the DSH session controller becomes the session and agent-runtime
  // ports, so one attempt runs in one real, scoped DSH session. Same rule as
  // above: an absent platform surface is reported, not repaired.
  mountDshRuntime(ctx, adapters)
}

/**
 * Resolve the time source: an optional `myworkClock` service provided by the
 * deployment, otherwise the system clock. The port is optional so the
 * controller mounts in any profile.
 * @param ctx - the plugin's host context.
 */
function resolveClock(ctx: Context): ClockPort {
  const provided = ctx.get(MYWORK_CLOCK_SERVICE) as ClockPort | undefined
  return provided ?? systemClock
}

/** The control-plane service published as `myworkController`. */
export class MyWorkControllerService extends Service implements MyWorkController {
  // TypeScript-private, not `#`-private: Cordis hands services to callers
  // through a proxy, and an ECMAScript private field is unreachable through it.
  private state: ControllerState
  private readonly config: ControllerConfig
  private readonly clock: ClockPort

  /**
   * @param ctx - the context the service is registered in; the owning fiber
   *   unregisters it on unload.
   * @param config - resolved row configuration.
   * @param clock - time source used for lifecycle timestamps.
   */
  constructor(ctx: Context, config: ControllerConfig, clock: ClockPort) {
    super(ctx, MYWORK_CONTROLLER_SERVICE)
    this.config = config
    this.clock = clock
    this.state = mountController(initialControllerState(), clock.now())
    if (this.config.diagnostics) this.write(mountDiagnostic(this.info()))
  }

  /** Snapshot of the controller's current lifecycle state. */
  info(): ControllerInfo {
    return controllerInfo(this.state, {
      service: MYWORK_CONTROLLER_SERVICE,
      version: CONTROLLER_VERSION,
      boundedContexts: BOUNDED_CONTEXTS,
    })
  }

  /**
   * Settle the controller: record the stop time, then emit the optional
   * diagnostic. Registered as the plugin's shutdown effect and idempotent, so
   * an explicit call followed by unload is safe.
   */
  stop(): void {
    if (this.state.phase === 'stopped') return
    const uptimeMs = controllerUptimeMs(this.state, this.clock.now())
    this.state = stopController(this.state, this.clock.now())
    if (this.config.diagnostics) this.write(stopDiagnostic(this.info(), uptimeMs))
  }

  /** Write one lifecycle diagnostic line; stderr keeps stdout protocol-clean. */
  private write(line: string): void {
    process.stderr.write(`${line}\n`)
  }
}

/**
 * The adapter registry published as `myworkAdapters` (architecture §44).
 *
 * An adapter row registers its declaration here from its own `apply` and keeps
 * the returned handle; when the controller unloads, every registration that is
 * still open is removed with it, so a stopped plugin leaves no adapter behind.
 */
export class MyWorkAdaptersService extends Service implements MyWorkAdapters<undefined> {
  // TypeScript-private, not `#`-private: Cordis hands services to callers
  // through a proxy, and an ECMAScript private field is unreachable through it.
  private readonly registry: AdapterRegistry<undefined>

  /**
   * @param ctx - the context the service is registered in; the owning fiber
   *   unregisters it on unload.
   * @param observer - optional observability hooks for the registry (§38).
   */
  constructor(ctx: Context, observer?: AdapterRegistryObserver) {
    super(ctx, MYWORK_ADAPTERS_SERVICE)
    this.registry = createAdapterRegistry<undefined>(observer === undefined ? {} : { observer })
  }

  /** Number of adapters registered right now. */
  get size(): number {
    return this.registry.size
  }

  /**
   * Accept an adapter declaration.
   * @param registration - declaration plus the factory that builds the instance.
   * @param context - passed to the registration's factory.
   * @throws {TypeError} when the declaration is malformed.
   * @throws {AdapterRefusal} `CONTRACT_MISMATCH` for an incompatible contract revision, `TASK_CONFLICT` for a duplicate id.
   */
  register<TPort>(
    registration: AdapterRegistration<TPort, undefined>,
    context?: undefined,
  ): AdapterRegistrationHandle<TPort> {
    return this.registry.register(registration, context)
  }

  /**
   * Remove one adapter.
   * @param adapter - kind and id of the adapter.
   */
  unregister(adapter: AdapterKey): boolean {
    return this.registry.unregister(adapter)
  }

  /**
   * Negotiate a port: first adapter of the kind that implements a compatible
   * revision and declares every required capability.
   * @param kind - port family the caller needs.
   * @param requirement - revision and capabilities the caller needs.
   */
  resolve<TPort = unknown>(kind: AdapterKind, requirement?: AdapterRequirement): AdapterResolution<TPort> {
    return this.registry.resolve<TPort>(kind, requirement)
  }

  /**
   * Like {@link MyWorkAdaptersService.resolve}, but throws the refusal.
   * @param kind - port family the caller needs.
   * @param requirement - revision and capabilities the caller needs.
   * @throws {AdapterRefusal} the refusal `resolve` would have returned.
   */
  require<TPort = unknown>(kind: AdapterKind, requirement?: AdapterRequirement): TPort {
    return this.registry.require<TPort>(kind, requirement)
  }

  /**
   * Declarations of the registered adapters, in registration order.
   * @param kind - optional port family filter.
   */
  list(kind?: AdapterKind): readonly AdapterCapabilityManifest[] {
    return this.registry.list(kind)
  }

  /**
   * Remove every registration; registered as the plugin's shutdown effect.
   * @returns how many adapters were removed.
   */
  close(): number {
    return this.registry.clear()
  }
}
