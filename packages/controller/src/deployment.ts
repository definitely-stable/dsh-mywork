/**
 * The two ways MyWork is deployed, and what each of them promises (MW-028 E-44).
 *
 * ```text
 * embedded   inside the DSH host process: the row that mounts the controller
 *            owns it, so unloading the row stops it
 * resident   a headless, separately supported profile: no UI session exists, no
 *            browser tab is needed, and it runs until it is explicitly stopped
 * ```
 *
 * Both deployments are the **same** application layer over the **same** external
 * state directory (`$DSH_HOME/dsh-mywork/state`, `packages/storage/src/layout.ts:76`).
 * The mode is a mounting parameter, never a second composition root: §5.1 keeps
 * leadership in the process, and §5.3 keeps exactly one writer per scope no
 * matter how many deployments are mounted.
 *
 * The client layer is deliberately not part of the controller's lifetime. A tab
 * that closes is a `detach` on {@link MyWorkClientSessions}, not a disposal of
 * the controller — that is the acceptance criterion "closing the browser does not
 * stop resident execution" expressed as an object.
 * @module
 */

import type { MyWorkLayout } from '@dsh-mywork/storage'
import { ControllerRuntimeError } from './errors.ts'

/** How this deployment of the controller runs. */
export type MyWorkDeploymentMode = 'embedded' | 'resident'

/** Every deployment mode, so a caller validates instead of guessing. */
export const MYWORK_DEPLOYMENT_MODES: readonly MyWorkDeploymentMode[] = Object.freeze([
  'embedded',
  'resident',
])

/** What each mode promises its host; the properties below never diverge per call. */
interface DeploymentShape {
  /** True when no UI session is needed for the deployment to exist. */
  readonly headless: boolean
  /** True when unloading the host row stops the controller with it. */
  readonly stopsWithHost: boolean
  /** True when closing every client leaves the controller running. */
  readonly survivesClientDetach: boolean
}

/** The fixed shape of each mode, so the promise is a table and not a comment. */
const DEPLOYMENT_SHAPES: Readonly<Record<MyWorkDeploymentMode, DeploymentShape>> = Object.freeze({
  embedded: Object.freeze({ headless: false, stopsWithHost: true, survivesClientDetach: true }),
  resident: Object.freeze({ headless: true, stopsWithHost: false, survivesClientDetach: true }),
})

/** Which deployment this is, and where its state lives. */
export interface MyWorkDeployment {
  /** Mode this deployment mounted. */
  readonly mode: MyWorkDeploymentMode
  /** True when the deployment runs without any UI session. */
  readonly headless: boolean
  /** True when unloading the host row stops the controller with it. */
  readonly stopsWithHost: boolean
  /** True when closing every client leaves the controller running. */
  readonly survivesClientDetach: boolean
  /** External state directory (`<dshHome>/dsh-mywork/state`), never a repository path. */
  readonly stateDir: string
}

/** Inputs of {@link resolveMyWorkDeployment}. */
export interface ResolveMyWorkDeploymentOptions {
  /** Mode to mount; defaults to `embedded`. */
  readonly mode?: MyWorkDeploymentMode
  /** Resolved layout the state directory comes from. */
  readonly layout: MyWorkLayout
}

/**
 * Resolve one deployment descriptor.
 *
 * The state directory is read from the layout, so both modes address the same
 * external `controller.sqlite` — a resident deployment is not a second database.
 * @param options - mode and resolved layout.
 * @returns the frozen descriptor.
 * @throws {ControllerRuntimeError} `invalid-input` when the mode is not one of {@link MYWORK_DEPLOYMENT_MODES}.
 */
export function resolveMyWorkDeployment(options: ResolveMyWorkDeploymentOptions): MyWorkDeployment {
  const mode = options.mode ?? 'embedded'
  const shape = DEPLOYMENT_SHAPES[mode]
  if (shape === undefined) {
    throw new ControllerRuntimeError(
      'invalid-input',
      `dsh-mywork: unknown deployment mode "${String(mode)}"; expected one of ${MYWORK_DEPLOYMENT_MODES.join(', ')}`,
      { details: { mode: String(mode), known: MYWORK_DEPLOYMENT_MODES } },
    )
  }
  return Object.freeze({ mode, ...shape, stateDir: options.layout.stateDir })
}

/**
 * One attached client of a running deployment.
 *
 * Detaching is idempotent and never touches the controller: the client layer may
 * come and go, the leader does not.
 */
export interface MyWorkClientSession {
  /** Stable identity of this attachment, unique within the process. */
  readonly id: string
  /** Optional human label (a tab, a screen, an operator). */
  readonly label?: string
  /** False once detached. */
  readonly attached: boolean
  /** Detach this client; `false` when it was already detached. */
  detach(): boolean
}

/** The client layer of one deployment: who is watching, not who is leading. */
export interface MyWorkClientSessions {
  /** How many clients are attached right now. */
  readonly count: number
  /** Identities of the attached clients, in attachment order. */
  readonly ids: readonly string[]
  /** Attach one client; the returned handle detaches it. */
  attach(label?: string): MyWorkClientSession
  /** Detach every client; returns how many were detached. */
  detachAll(): number
}

/**
 * Create the client layer of one deployment.
 *
 * Identities are a deterministic counter (`client-1`, `client-2`, …) rather than
 * a random or time-derived value: a resident deployment must be reproducible in
 * a test, and nothing about a client needs to be unguessable.
 * @returns the frozen client registry.
 */
export function createClientSessions(): MyWorkClientSessions {
  const attached = new Map<string, { readonly label?: string }>()
  let minted = 0

  function detach(id: string): boolean {
    return attached.delete(id)
  }

  return Object.freeze({
    get count(): number {
      return attached.size
    },
    get ids(): readonly string[] {
      return Object.freeze([...attached.keys()])
    },
    attach(label?: string): MyWorkClientSession {
      minted += 1
      const id = `client-${String(minted)}`
      attached.set(id, label === undefined ? {} : { label })
      const session: MyWorkClientSession = Object.freeze({
        id,
        ...(label === undefined ? {} : { label }),
        get attached(): boolean {
          return attached.has(id)
        },
        detach: (): boolean => detach(id),
      })
      return session
    },
    detachAll(): number {
      const detached = attached.size
      attached.clear()
      return detached
    },
  })
}

/** The steps of a graceful shutdown, in the order they must run. */
export const MYWORK_SHUTDOWN_STEPS = Object.freeze(['admission', 'settle', 'release'] as const)

/** One step of {@link MYWORK_SHUTDOWN_STEPS}. */
export type MyWorkShutdownStep = (typeof MYWORK_SHUTDOWN_STEPS)[number]

/** What the deployment can say about itself while a step runs. */
export interface MyWorkShutdownProbe {
  /** Whether mutations may still be admitted. */
  readonly admitting: boolean
  /** Whether the durable lease is still held. */
  readonly leaseHeld: boolean
}

/** One completed shutdown step, as the deployment observed it. */
export interface MyWorkShutdownEntry {
  /** Which step completed. */
  readonly step: MyWorkShutdownStep
  /** Clock reading after the step. */
  readonly at: number
  /** Admission gate after the step. */
  readonly admitting: boolean
  /** Durable leadership after the step. */
  readonly leaseHeld: boolean
  /** Whether the step itself failed; the trace keeps the failure, `run` rethrows it. */
  readonly failed: boolean
}

/** Options accepted by {@link createGracefulShutdown}. */
export interface MyWorkGracefulShutdownOptions {
  /** Time source of the trace. */
  readonly clock: { now(): number }
  /**
   * The three steps, in the order of {@link MYWORK_SHUTDOWN_STEPS}.
   *
   * `admission` closes every path that could start work, `settle` waits for the
   * work already started (and for the operations the claim path registered), and
   * `release` gives up the lease. Releasing before settling would let a successor
   * write while this controller is still finishing — the one ordering §5.3 calls
   * out explicitly.
   */
  readonly steps: Readonly<Record<MyWorkShutdownStep, () => void | Promise<void>>>
  /** Reads the deployment's own admission gate and the durable lease row. */
  readonly probe: () => MyWorkShutdownProbe
}

/** One idempotent shutdown of a deployment. */
export interface MyWorkGracefulShutdown {
  /** Steps completed so far, in order; readable while `run()` is in flight. */
  readonly trace: readonly MyWorkShutdownEntry[]
  /** Run the steps; the second call returns the first call's promise. */
  run(): Promise<void>
}

/**
 * Create the one shutdown a deployment is allowed.
 *
 * Idempotent by promise, not by flag: two callers that both observe "not stopped
 * yet" must not run the steps twice, and the second caller must see the same
 * outcome. A failing step is recorded with `failed: true` and rethrown — the
 * remaining steps still run, because a shutdown that stops halfway leaves the
 * lease held for no reason.
 * @param options - clock, steps, and the probe.
 * @returns the frozen shutdown.
 */
export function createGracefulShutdown(options: MyWorkGracefulShutdownOptions): MyWorkGracefulShutdown {
  const trace: MyWorkShutdownEntry[] = []
  let running: Promise<void> | undefined

  async function execute(): Promise<void> {
    let failure: { readonly error: unknown } | undefined
    for (const step of MYWORK_SHUTDOWN_STEPS) {
      let failed = false
      try {
        await options.steps[step]()
      } catch (error) {
        failed = true
        failure ??= { error }
      }
      const state = options.probe()
      trace.push(Object.freeze({
        step,
        at: options.clock.now(),
        admitting: state.admitting,
        leaseHeld: state.leaseHeld,
        failed,
      }))
    }
    if (failure !== undefined) throw failure.error
  }

  /** Run the steps once; every caller after the first awaits the same run. */
  function run(): Promise<void> {
    running ??= execute()
    return running
  }

  return Object.freeze({
    get trace(): readonly MyWorkShutdownEntry[] {
      return Object.freeze([...trace])
    },
    run,
  })
}
