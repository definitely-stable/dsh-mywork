/**
 * Deterministic fakes (architecture §58) for the ports declared in
 * `@dsh-mywork/contracts`. They replace real time and a real agent runtime in
 * tests, so policy is exercised without a model, a provider, or a subprocess.
 * @module @dsh-mywork/adapter-sdk/testing
 */

import type {
  AgentCallOptions,
  AgentEventOptions,
  AgentModelSelection,
  AgentResumeRequest,
  AgentRunScope,
  AgentRuntimeHandle,
  AgentRuntimePort,
  AgentRuntimeStatus,
  AgentStartRequest,
  CatalogModel,
  ClockPort,
  ModelCatalogPort,
  ResolvedCatalogModel,
  SessionEvent,
  SessionEventPage,
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

/** One run recorded by {@link FakeAgentHost}. */
export interface FakeAgentRun {
  /** Run identifier the caller submitted. */
  readonly runId: string
  /** Real session identity the owner minted, not the caller's label. */
  readonly sessionId: string
  /** True while the owner still reports the session as running. */
  running: boolean
  /** Agent preset the session is composed under, once a scope was asserted. */
  agentPreset?: string
  /** Route the owner accepted, once a scope pinned one. */
  route?: AgentModelSelection
}

/** One scope assertion the owner recorded, in the order it was applied. */
export type FakePinnedScope =
  | `preset:${string}`
  | `permission:${string}`
  | `model:${string}`

/**
 * Durable side of the fake session owner: sessions, their logs, and the scope
 * pins asserted on them.
 *
 * It exists so the port's restart property is testable without a real platform:
 * a {@link FakeAgentRuntime} holds no state of its own, so a second runtime over
 * the same host *is* a process restart — the truth survived in the owner, not in
 * the process. The host also misbehaves on purpose ({@link redeliver},
 * {@link emitLate}), because the port's cursor discipline is a property the
 * runtime must enforce rather than one it may assume.
 */
export class FakeAgentHost {
  #runs = new Map<string, FakeAgentRun>()
  #logs = new Map<string, SessionEvent[]>()
  #pins = new Map<string, FakePinnedScope[]>()
  #replay = new Set<string>()
  #sessions = 0
  #seq = 0

  /** Run ids the owner accepted so far, in submission order. */
  get runIds(): readonly string[] {
    return [...this.#runs.keys()]
  }

  /** Every session the owner knows. */
  get sessionIds(): readonly string[] {
    return [...this.#runs.values()].map(run => run.sessionId)
  }

  /** Scope assertions recorded for one session, in order. */
  pinsOf(sessionId: string): readonly FakePinnedScope[] {
    return [...(this.#pins.get(sessionId) ?? [])]
  }

  /** Find a run by the caller's label. */
  byRunId(runId: string): FakeAgentRun | undefined {
    return this.#runs.get(runId)
  }

  /** Find a run by the real session identity the owner minted. */
  bySessionId(sessionId: string): FakeAgentRun | undefined {
    for (const run of this.#runs.values()) {
      if (run.sessionId === sessionId) return run
    }
    return undefined
  }

  /**
   * Open one session for a run.
   * @param request - run identity, workspace, and scope.
   * @throws {AdapterError} `conflict` when the run id is already known.
   */
  open(request: AgentStartRequest): FakeAgentRun {
    if (this.#runs.has(request.runId)) {
      throw new AdapterError('conflict', `dsh-mywork: run "${request.runId}" was already started`)
    }
    this.#sessions += 1
    const run: FakeAgentRun = { runId: request.runId, sessionId: `session-fake-${this.#sessions}`, running: true }
    this.#runs.set(run.runId, run)
    this.#logs.set(run.sessionId, [])
    return run
  }

  /**
   * Adopt an existing session for a resumed run.
   * @param request - run identity, real session identity, and scope.
   * @throws {AdapterError} `invalid-ref` when the owner does not know the session.
   */
  adopt(request: AgentResumeRequest): FakeAgentRun {
    const run = this.bySessionId(request.sessionId)
    if (run === undefined) {
      throw new AdapterError('invalid-ref', `dsh-mywork: session "${request.sessionId}" is unknown to the owner`)
    }
    run.running = true
    return run
  }

  /** Settle one run; repeated settlement is a no-op and the record survives. */
  settle(sessionId: string): void {
    const run = this.bySessionId(sessionId)
    if (run !== undefined) run.running = false
  }

  /**
   * Assert one scope on a session, recording each pin and the durable event that
   * proves it reached the log. A scope-less assertion records nothing: the port
   * never invents defaults.
   * @param sessionId - session the scope applies to.
   * @param scope - scope to assert, when the caller stated one.
   */
  assertScope(sessionId: string, scope: AgentRunScope | undefined): void {
    if (scope === undefined) return
    const run = this.bySessionId(sessionId)
    if (run === undefined) return
    const pins = this.#pins.get(sessionId) ?? []
    pins.push(`preset:${scope.agentPreset}`)
    run.agentPreset = scope.agentPreset
    if (scope.model !== undefined) {
      pins.push(`model:${scope.model.provider}/${scope.model.model}`)
      run.route = scope.model
      this.emit(sessionId, 'model/selection')
    }
    if (scope.permission !== undefined) {
      pins.push(`permission:${scope.permission}`)
      this.emit(sessionId, 'permission/preset')
    }
    this.#pins.set(sessionId, pins)
  }

  /** Admit one prompt, which is what makes a session carry a turn. */
  admit(sessionId: string): void {
    this.emit(sessionId, 'turn/start', 1)
  }

  /**
   * Append one durable event at the next position.
   * @param sessionId - session the event belongs to.
   * @param type - durable event type.
   * @param time - clock reading to record; defaults to the session's length.
   */
  emit(sessionId: string, type: string, time?: number): SessionEvent {
    this.#seq += 1
    const event: SessionEvent = {
      seq: this.#seq,
      type,
      time: time ?? this.#seq,
    }
    this.#log(sessionId).push(event)
    return event
  }

  /**
   * Append one event at an older position: the late delivery the port's cursor
   * discipline has to absorb without repeating or losing anything.
   * @param sessionId - session the event belongs to.
   * @param seq - position the owner reports, deliberately at or below the end.
   * @param type - durable event type.
   */
  emitLate(sessionId: string, seq: number, type: string): void {
    this.#log(sessionId).push({ seq, type, time: seq })
  }

  /** Repeat the newest event on the next read: a duplicate delivery. */
  redeliver(sessionId: string): void {
    this.#replay.add(sessionId)
  }

  /**
   * The owner's raw read: every recorded event in recording order, with the
   * scripted duplicate appended. It is deliberately unsorted, duplicated, and
   * unfiltered, so the runtime has to normalise it.
   * @param sessionId - session to read.
   */
  readRaw(sessionId: string): readonly SessionEvent[] {
    const log = this.#log(sessionId)
    const newest = log.at(-1)
    const replay = this.#replay.delete(sessionId) && newest !== undefined ? [newest] : []
    return [...log, ...replay]
  }

  /** The log one session holds, in recording order. */
  #log(sessionId: string): SessionEvent[] {
    const existing = this.#logs.get(sessionId)
    if (existing !== undefined) return existing
    const created: SessionEvent[] = []
    this.#logs.set(sessionId, created)
    return created
  }
}

/** Refuse a call whose caller already cancelled it, before any side effect. */
function refuseIfAborted(signal: AbortSignal | undefined, what: string): void {
  if (signal?.aborted === true) {
    throw new AdapterError('cancelled', `dsh-mywork: ${what} aborted before it was admitted`)
  }
}

/**
 * Scripted agent runtime: records submissions in its {@link FakeAgentHost},
 * reports state from that host, and never calls a model.
 *
 * Duplicate run ids, unknown sessions, and cancelled calls fail through
 * {@link AdapterError}, matching the port's contract. The runtime keeps no state
 * of its own, and the owner normalises nothing: what {@link FakeAgentRuntime.start}
 * reports back is exactly the scope the caller stated.
 */
export class FakeAgentRuntime implements AgentRuntimePort {
  #host: FakeAgentHost

  /**
   * @param options - the durable owner to drive; a new runtime over the same
   *   host models a process restart.
   */
  constructor(options: { host?: FakeAgentHost } = {}) {
    this.#host = options.host ?? new FakeAgentHost()
  }

  /** The owner this runtime drives. */
  get host(): FakeAgentHost {
    return this.#host
  }

  /** Run ids the owner accepted so far, in submission order. */
  get startedRunIds(): readonly string[] {
    return this.#host.runIds
  }

  /**
   * Open one session, assert its scope, and admit the prompt.
   * @param request - run identity, workspace, prompt, and scope.
   * @param options - caller-owned cancellation.
   * @throws {AdapterError} `cancelled` for an aborted call, `conflict` for a duplicate run id.
   */
  async start(request: AgentStartRequest, options: AgentCallOptions = {}): Promise<AgentRuntimeHandle> {
    refuseIfAborted(options.signal, `starting run "${request.runId}"`)
    const run = this.#host.open(request)
    this.#host.assertScope(run.sessionId, request.scope)
    this.#host.admit(run.sessionId)
    return handleOf(run)
  }

  /**
   * Adopt the session a previous run used and re-assert its scope.
   * @param request - run identity, real session identity, and scope.
   * @param options - caller-owned cancellation.
   * @throws {AdapterError} `cancelled` for an aborted call, `invalid-ref` for an unknown session.
   */
  async resume(request: AgentResumeRequest, options: AgentCallOptions = {}): Promise<AgentRuntimeHandle> {
    refuseIfAborted(options.signal, `resuming run "${request.runId}"`)
    const run = this.#host.adopt(request)
    this.#host.assertScope(run.sessionId, request.scope)
    return {
      runId: request.runId,
      sessionId: run.sessionId,
      ...(run.route === undefined ? {} : { route: run.route }),
    }
  }

  /**
   * Read the run's state from the owner.
   * @param handle - handle returned by {@link start} or {@link resume}.
   * @param options - caller-owned cancellation.
   * @throws {AdapterError} `invalid-ref` when the owner does not know the session.
   */
  async status(handle: AgentRuntimeHandle, options: AgentCallOptions = {}): Promise<AgentRuntimeStatus> {
    refuseIfAborted(options.signal, `reading run "${handle.runId}"`)
    const run = this.#require(handle)
    return {
      runId: handle.runId,
      sessionId: run.sessionId,
      running: run.running,
    }
  }

  /**
   * Stop the run's work; the session record survives and stopping twice is a no-op.
   * @param handle - handle returned by {@link start} or {@link resume}.
   * @param options - caller-owned cancellation.
   * @throws {AdapterError} `invalid-ref` when the owner does not know the session.
   */
  async stop(handle: AgentRuntimeHandle, options: AgentCallOptions = {}): Promise<void> {
    refuseIfAborted(options.signal, `stopping run "${handle.runId}"`)
    const run = this.#require(handle)
    this.#host.settle(run.sessionId)
  }

  /**
   * Read the run's durable events after a cursor, normalising the owner's raw
   * read: positions at or below the cursor are withheld, a repeated position is
   * reported once, and the result is ascending.
   * @param handle - handle returned by {@link start} or {@link resume}.
   * @param cursor - last position the caller has seen.
   * @param options - caller-owned cancellation and the page bound.
   * @throws {AdapterError} `invalid-ref` when the owner does not know the session.
   */
  async events(
    handle: AgentRuntimeHandle,
    cursor = 0,
    options: AgentEventOptions = {},
  ): Promise<SessionEventPage> {
    refuseIfAborted(options.signal, `reading events of run "${handle.runId}"`)
    const run = this.#require(handle)
    const all = normaliseEvents(this.#host.readRaw(run.sessionId), cursor)
    // A bounded read serves the most recent window, exactly as the platform does,
    // and says so when that left positions behind.
    const events = options.maxEvents === undefined ? all : all.slice(-options.maxEvents)
    const end = events.at(-1)?.seq
    return {
      events,
      cursor: end ?? cursor,
      hasMore: all.length > events.length,
    }
  }

  /** Look up a run or fail the way the port contract requires. */
  #require(handle: AgentRuntimeHandle): FakeAgentRun {
    // The session identity is authoritative and survives a restart; the run id is
    // the caller's label, so it is the fallback for a handle that carries only one.
    const run = this.#host.bySessionId(handle.sessionId) ?? this.#host.byRunId(handle.runId)
    if (run === undefined) {
      throw new AdapterError('invalid-ref', `dsh-mywork: unknown run "${handle.runId}"`)
    }
    return run
  }
}

/** The handle one recorded run is addressed by. */
function handleOf(run: FakeAgentRun): AgentRuntimeHandle {
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    ...(run.route === undefined ? {} : { route: run.route }),
  }
}

/**
 * Apply the port's cursor discipline to one raw read: keep positions above the
 * cursor, report each position once, and order the result ascending. Bound
 * handling is the caller's, because a bounded page may serve either end.
 * @param raw - events as the owner reported them.
 * @param cursor - last position the caller has seen.
 */
function normaliseEvents(raw: readonly SessionEvent[], cursor: number): readonly SessionEvent[] {
  const seen = new Set<number>()
  const fresh: SessionEvent[] = []
  for (const event of raw) {
    if (event.seq <= cursor || seen.has(event.seq)) continue
    seen.add(event.seq)
    fresh.push(event)
  }
  fresh.sort((left, right) => left.seq - right.seq)
  return fresh
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
