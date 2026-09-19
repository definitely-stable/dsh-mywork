/**
 * Deterministic fakes (architecture §58) for the ports declared in
 * `@dsh-mywork/contracts`. They replace real time and a real agent runtime in
 * tests, so policy is exercised without a model, a provider, or a subprocess.
 * @module @dsh-mywork/adapter-sdk/testing
 */

import type {
  AgentRuntimeHandle,
  AgentRuntimePort,
  AgentRuntimeStatus,
  AgentStartRequest,
  CatalogModel,
  ClockPort,
  ModelCatalogPort,
  ResolvedCatalogModel,
} from '@dsh-mywork/contracts'
import { CATALOG_UNKNOWN_MODEL } from '@dsh-mywork/contracts'
import type { AdapterKind } from './capabilities.ts'
import { portContractVersion } from './contract-version.ts'
import { AdapterError } from './errors.ts'
import type { AdapterRegistration } from './registry.ts'

/** One pending {@link FakeClock.sleep} registration. */
interface Sleeper {
  /** Clock reading at which the sleeper resolves. */
  readonly dueAt: number
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
  readonly signal?: AbortSignal
  /** Installed while the sleep is pending, so cancellation can detach it. */
  onAbort?: () => void
}

/** Error raised when a fake's sleep or run is cancelled. */
function cancelled(what: string): AdapterError {
  return new AdapterError('cancelled', `dsh-mywork: ${what} aborted`)
}

/**
 * Clock whose time moves only through {@link FakeClock.advance}: no timers,
 * no wall-clock dependency, and every pending sleep is observable.
 */
export class FakeClock implements ClockPort {
  #nowMs: number
  #sleepers: Sleeper[] = []

  /**
   * @param startMs - initial clock reading.
   */
  constructor(startMs = 0) {
    this.#nowMs = startMs
  }

  /** Current fake time in epoch milliseconds. */
  now(): number {
    return this.#nowMs
  }

  /** Number of sleeps that are still waiting for time to advance. */
  get pendingSleeps(): number {
    return this.#sleepers.length
  }

  /**
   * Register a sleeper; it resolves when {@link advance} passes its due time.
   * @param ms - delay in milliseconds.
   * @param signal - optional cancellation.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(cancelled('sleep'))
    const dueAt = this.#nowMs + Math.max(0, ms)
    return new Promise<void>((resolve, reject) => {
      const sleeper: Sleeper = signal === undefined
        ? { dueAt, resolve, reject }
        : { dueAt, resolve, reject, signal }
      if (signal !== undefined) {
        sleeper.onAbort = () => {
          this.#sleepers = this.#sleepers.filter(entry => entry !== sleeper)
          reject(cancelled('sleep'))
        }
        signal.addEventListener('abort', sleeper.onAbort, { once: true })
      }
      this.#sleepers.push(sleeper)
    })
  }

  /**
   * Advance fake time and resolve every sleep that is now due, oldest first.
   * @param ms - non-negative duration to advance.
   * @throws {RangeError} when `ms` is negative or not finite.
   */
  async advance(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`dsh-mywork: FakeClock.advance expects a non-negative finite duration, received ${String(ms)}`)
    }
    this.#nowMs += ms
    const due = this.#sleepers.filter(sleeper => sleeper.dueAt <= this.#nowMs)
    due.sort((left, right) => left.dueAt - right.dueAt)
    this.#sleepers = this.#sleepers.filter(sleeper => sleeper.dueAt > this.#nowMs)
    for (const sleeper of due) {
      if (sleeper.signal !== undefined && sleeper.onAbort !== undefined) {
        sleeper.signal.removeEventListener('abort', sleeper.onAbort)
      }
      sleeper.resolve()
    }
    // Let the resolved continuations run before the caller observes the clock.
    await Promise.resolve()
  }
}

/** One run recorded by {@link FakeAgentRuntime}. */
interface FakeRun {
  readonly request: AgentStartRequest
  running: boolean
}

/**
 * Scripted agent runtime: records submissions, reports state, and never calls
 * a model. Duplicate run ids and unknown handles fail through
 * {@link AdapterError}, matching the port's contract.
 */
export class FakeAgentRuntime implements AgentRuntimePort {
  #runs = new Map<string, FakeRun>()

  /** Run ids accepted so far, in submission order. */
  get startedRunIds(): readonly string[] {
    return [...this.#runs.keys()]
  }

  /**
   * Record a run.
   * @param request - run identity, workspace, and prompt.
   * @throws {AdapterError} `conflict` when the run id was already started.
   */
  async start(request: AgentStartRequest): Promise<AgentRuntimeHandle> {
    if (this.#runs.has(request.runId)) {
      throw new AdapterError('conflict', `dsh-mywork: run "${request.runId}" was already started`)
    }
    this.#runs.set(request.runId, { request, running: true })
    return { runId: request.runId }
  }

  /**
   * Read the run's state.
   * @param handle - handle returned by {@link start}.
   * @throws {AdapterError} `invalid-ref` when the handle is unknown.
   */
  async status(handle: AgentRuntimeHandle): Promise<AgentRuntimeStatus> {
    return { runId: handle.runId, running: this.#run(handle).running }
  }

  /**
   * Stop the run; stopping an already stopped run is a no-op.
   * @param handle - handle returned by {@link start}.
   * @throws {AdapterError} `invalid-ref` when the handle is unknown.
   */
  async stop(handle: AgentRuntimeHandle): Promise<void> {
    this.#run(handle).running = false
  }

  /** Look up a run or fail the way the port contract requires. */
  #run(handle: AgentRuntimeHandle): FakeRun {
    const run = this.#runs.get(handle.runId)
    if (run === undefined) throw new AdapterError('invalid-ref', `dsh-mywork: unknown run "${handle.runId}"`)
    return run
  }
}

/** Options accepted by {@link FakeModelCatalog}. */
export interface FakeModelCatalogOptions {
  /** Providers the fake registers, in order. Default: one provider `fake`. */
  readonly providers?: readonly { readonly id: string; readonly name: string }[]
  /**
   * Models per provider id. A model with a `contextWindow` publishes one; a model
   * without it publishes none, which is the undisclosed-capacity case §29 has to
   * refuse rather than assume.
   */
  readonly models?: Readonly<Record<string, readonly {
    readonly id: string
    readonly name?: string
    readonly contextWindow?: number
  }[]>>
  /** Providers that answer every call with a failure instead of a catalog. */
  readonly outages?: readonly string[]
}

/**
 * Model catalog backed by a literal, with an outage switch
 * (architecture §29, §62 item 7).
 *
 * It answers exactly what it was constructed with — no default window, no
 * implicit model, no invented provider — so a routing test can pin the boundary
 * between "the catalog said so" and "the policy assumed so". Every question it
 * was asked is recorded **before** it answers, so a test can tell a question
 * nobody asked apart from an answer that was a refusal, and an outage names the
 * call it interrupted: a listing failure and an exact-model failure are
 * different sentences, so a test can see which path routing took.
 */
export class FakeModelCatalog implements ModelCatalogPort {
  readonly #providers: readonly { readonly id: string; readonly name: string }[]
  readonly #models: Readonly<Record<string, readonly {
    readonly id: string
    readonly name?: string
    readonly contextWindow?: number
  }[]>>
  #outages: readonly string[]
  #listed: string[] = []
  #asked: string[] = []

  /**
   * @param options - the literal catalog and the providers that are in outage.
   */
  constructor(options: FakeModelCatalogOptions = {}) {
    this.#providers = Object.freeze(
      (options.providers ?? [{ id: 'fake', name: 'Fake provider' }]).map(provider => Object.freeze({ ...provider })),
    )
    this.#models = options.models ?? {}
    this.#outages = Object.freeze([...(options.outages ?? [])])
  }

  /** Provider ids the fake registers. */
  get providerIds(): readonly string[] {
    return this.#providers.map(provider => provider.id)
  }

  /** Provider ids whose models were listed, in call order. */
  get listedProviders(): readonly string[] {
    return [...this.#listed]
  }

  /** Routes whose exact info was asked for, as `provider/model`, in call order — answered or not. */
  get askedRoutes(): readonly string[] {
    return [...this.#asked]
  }

  /** Mark one provider as unavailable for the rest of this fake's life. */
  outage(provider: string): void {
    if (this.#outages.includes(provider)) return
    this.#outages = Object.freeze([...this.#outages, provider])
  }

  /** {@link ModelCatalogPort.listProviders}. */
  listProviders(): readonly { readonly id: string; readonly name: string }[] {
    return this.#providers
  }

  /**
   * {@link ModelCatalogPort.listModels}.
   * @param provider - provider route key.
   * @throws {AdapterError} `unavailable` when the provider is in outage, `invalid-ref` when it is not registered.
   */
  async listModels(provider: string): Promise<readonly CatalogModel[]> {
    if (!this.providerIds.includes(provider)) {
      throw new AdapterError('invalid-ref', `dsh-mywork: provider "${provider}" is not registered`)
    }
    // The provider WAS asked; a recording taken only after the answer would hide
    // a catalog read that never happened.
    this.#listed.push(provider)
    if (this.#outages.includes(provider)) {
      throw new AdapterError('unavailable', `dsh-mywork: provider "${provider}" did not answer the catalog listing`)
    }
    const models = this.#models[provider]
    if (models === undefined) return Object.freeze([])
    return Object.freeze(models.map(model => Object.freeze({
      provider,
      id: model.id,
      name: model.name ?? model.id,
    })))
  }

  /**
   * {@link ModelCatalogPort.resolveModelInfo}.
   * @param provider - provider route key.
   * @param model - exact model id.
   * @throws {AdapterError} `unavailable` when the provider is in outage, `invalid-ref` when it is not registered, and a {@link CATALOG_UNKNOWN_MODEL} rejection when it serves no such model.
   */
  async resolveModelInfo(provider: string, model: string): Promise<ResolvedCatalogModel> {
    if (!this.providerIds.includes(provider)) {
      throw new AdapterError('invalid-ref', `dsh-mywork: provider "${provider}" is not registered`)
    }
    // Recorded before the answer, so "was never asked" and "was asked and refused"
    // are two different observations for a test.
    this.#asked.push(`${provider}/${model}`)
    if (this.#outages.includes(provider)) {
      throw new AdapterError('unavailable', `dsh-mywork: provider "${provider}" did not answer the exact model lookup`)
    }
    const known = (this.#models[provider] ?? []).find(entry => entry.id === model)
    if (known === undefined) {
      // The code the port reads: the provider answered, and the route does not
      // exist. DSH raises the same one for a model a route does not configure.
      throw unknownModel(provider, model)
    }
    return Object.freeze({
      provider,
      id: model,
      name: known.name ?? model,
      ...(known.contextWindow === undefined ? {} : { contextWindow: known.contextWindow }),
    })
  }
}

/** Rejection of a route a provider does not serve, carrying the port's absence code. */
function unknownModel(provider: string, model: string): Error {
  return Object.assign(new Error(`dsh-mywork: fake provider "${provider}" serves no model "${model}"`), {
    code: CATALOG_UNKNOWN_MODEL,
  })
}

/** Options accepted by {@link fakeAdapterRegistration}. */
export interface FakeAdapterOptions {
  /** Port family the fake registers as. Default `memory`. */
  readonly kind?: AdapterKind
  /** Adapter id. Default `fake-adapter`. */
  readonly id?: string
  /** Contract revision; defaults to the port's current revision for `kind`. */
  readonly contractVersion?: string
  /** Capability flags; defaults to retain/recall supported and reflect not. */
  readonly capabilities?: Readonly<Record<string, boolean>>
  /** Failure {@link FakeAdapter.invoke} raises instead of answering. */
  readonly failWith?: AdapterError
}

/**
 * Scripted adapter instance: records the operations it was asked to perform and
 * can fail on demand, so registry and conformance tests never need a real
 * integration.
 */
export class FakeAdapter {
  #calls: string[] = []
  #failWith: AdapterError | undefined

  /**
   * @param options - scripted failure, if any.
   */
  constructor(options: { failWith?: AdapterError } = {}) {
    this.#failWith = options.failWith
  }

  /** Operations invoked so far, in order. */
  get operations(): readonly string[] {
    return [...this.#calls]
  }

  /**
   * Record one operation and answer with the given value.
   * @param operation - operation name.
   * @param value - value to answer with.
   * @returns the value, unless a failure was scripted.
   * @throws {AdapterError} the scripted failure.
   */
  async invoke<T>(operation: string, value: T): Promise<T> {
    this.#calls.push(operation)
    if (this.#failWith !== undefined) throw this.#failWith
    return value
  }
}

/**
 * A registrable fake adapter: a declaration whose contract revision already
 * matches its port, so it exercises the compatible path of the registry.
 * @param options - declaration and scripted failure.
 */
export function fakeAdapterRegistration(
  options: FakeAdapterOptions = {},
): AdapterRegistration<FakeAdapter, undefined> {
  const kind = options.kind ?? 'memory'
  const failWith = options.failWith
  return {
    kind,
    id: options.id ?? 'fake-adapter',
    contractVersion: options.contractVersion ?? portContractVersion(kind),
    capabilities: options.capabilities ?? Object.freeze({ retain: true, recall: true, reflect: false }),
    create: (): FakeAdapter => (failWith === undefined ? new FakeAdapter() : new FakeAdapter({ failWith })),
  }
}
