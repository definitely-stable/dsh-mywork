/**
 * Host entry of the MyWork controller plugin.
 *
 * `apply` publishes the `myworkController` service on the host context and
 * registers the shutdown effect that settles it when the plugin unloads. The
 * package is a DSH bundle: `cordis.patch.yml` inserts this row into any profile
 * that lists `@dsh-mywork/controller`.
 * @module @dsh-mywork/controller
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import {
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
 * @param ctx - the plugin's host context.
 * @param config - optional row configuration.
 * @throws {TypeError} when the row configuration is malformed.
 */
export function apply(ctx: Context, config?: Config): void {
  const service = new MyWorkControllerService(ctx, resolveControllerConfig(config), resolveClock(ctx))
  ctx.effect(() => () => service.stop(), 'mywork controller shutdown')
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
