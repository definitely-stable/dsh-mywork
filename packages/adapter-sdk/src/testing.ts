/**
 * Deterministic fakes (architecture §58) for the ports declared in
 * `@dsh-mywork/contracts`. They replace real time and a real agent runtime in
 * tests, so policy is exercised without a model, a provider, or a subprocess.
 * @module @dsh-mywork/adapter-sdk/testing
 */

import type { AgentRuntimeHandle, AgentRuntimePort, AgentRuntimeStatus, AgentStartRequest, ClockPort } from '@dsh-mywork/contracts'
import { AdapterError } from './errors.ts'

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
