/**
 * The controller heartbeat: renew the lease while this controller leads, and stop
 * the moment leadership is gone (architecture §5.3, §16.1; MW-028 E-43).
 *
 * The loop is driven by the injected {@link ClockPort}, not by `setInterval` and
 * not by `Date.now`, for the same reason `reconcileLoop` in the scheduler is
 * (`packages/scheduler/src/service.ts:290`): a timer the test can advance is the
 * only way to prove "the lease is renewed before it expires" deterministically.
 * A deployment passes the system clock, a test passes `FakeClock`.
 *
 * Losing the lease is not an exception this module swallows: it is the one event
 * this loop exists to observe. `ControllerLifecycle.heartbeat` closes admission
 * and moves the phase to `passive` before it throws
 * (`packages/lease/src/lifecycle.ts:281-299`); this loop records the loss, stops
 * beating, and reports it through {@link ControllerHeartbeat.lost} so the
 * composition root can tear the deployment down instead of pretending to lead.
 * @module
 */

import type { ClockPort } from '@dsh-mywork/contracts'
import { ControllerRuntimeError } from './errors.ts'

/** The slice of a lifecycle one heartbeat needs. */
export interface HeartbeatLifecycle {
  /** Renew the lease; throws when this controller no longer leads. */
  heartbeat(): unknown
}

/** Options accepted by {@link startControllerHeartbeat}. */
export interface ControllerHeartbeatOptions {
  /** The lifecycle whose lease is renewed; never the lease store directly. */
  readonly lifecycle: HeartbeatLifecycle
  /** Time source of the loop; `FakeClock` keeps the cadence deterministic. */
  readonly clock: ClockPort
  /** Lease window the controller acquired. The interval is derived from it. */
  readonly leaseMs: number
  /**
   * Renewal interval; defaults to {@link heartbeatIntervalMs}.
   *
   * Must be a positive integer strictly below `leaseMs`: a renewal that is not
   * strictly inside the window would let the lease expire between two beats,
   * which is the very race the heartbeat exists to prevent.
   */
  readonly intervalMs?: number
  /**
   * Called once, with the error, when a renewal failed and leadership was lost.
   * Errors this callback throws are swallowed: the loss is already reported.
   */
  readonly onLost?: (error: unknown) => void
}

/**
 * One running heartbeat.
 *
 * Every reading is live: `beats` counts renewals that reached the lease store,
 * and it stops growing the moment leadership is lost or the loop is stopped.
 */
export interface ControllerHeartbeat {
  /** Renewal interval in milliseconds; always strictly below the lease window. */
  readonly intervalMs: number
  /** Successful renewals so far. */
  readonly beats: number
  /** True once a renewal failed: this controller no longer leads. */
  readonly lost: boolean
  /** One-line description of the loss, when there was one. */
  readonly reason: string | undefined
  /** True while the loop is still sleeping towards its next renewal. */
  readonly running: boolean
  /** Cancel the loop and wait for it to settle; idempotent. */
  stop(): Promise<void>
}

/**
 * The renewal interval of one lease window: a third of it, at least one
 * millisecond.
 *
 * A third leaves room for two missed renewals — a blocked event loop, a slow
 * write — without the lease expiring under a controller that is still alive,
 * which is the failover a too-long interval would fabricate.
 * @param leaseMs - lease window the controller acquired.
 * @returns the interval, strictly below `leaseMs`.
 * @throws {ControllerRuntimeError} `invalid-input` when the window is not a positive integer.
 */
export function heartbeatIntervalMs(leaseMs: number): number {
  if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
    throw new ControllerRuntimeError(
      'invalid-input',
      `dsh-mywork: leaseMs must be a positive integer, received ${String(leaseMs)}`,
      { details: { leaseMs } },
    )
  }
  return Math.max(1, Math.floor(leaseMs / 3))
}

/** Describe a thrown value without ever throwing. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Start renewing the lease of one controller.
 *
 * The loop sleeps first and renews second, exactly like `reconcileLoop`: the
 * lease was just acquired, so renewing immediately would spend a write on a row
 * that is already fresh.
 * @param options - lifecycle, clock, window, and the optional loss callback.
 * @returns the running heartbeat.
 * @throws {ControllerRuntimeError} `invalid-input` for a malformed window or interval.
 */
export function startControllerHeartbeat(options: ControllerHeartbeatOptions): ControllerHeartbeat {
  const intervalMs = options.intervalMs ?? heartbeatIntervalMs(options.leaseMs)
  if (!Number.isInteger(intervalMs) || intervalMs <= 0 || intervalMs >= options.leaseMs) {
    throw new ControllerRuntimeError(
      'invalid-input',
      `dsh-mywork: a heartbeat interval must be a positive integer below leaseMs (${String(options.leaseMs)}), received ${String(intervalMs)}`,
      { details: { intervalMs, leaseMs: options.leaseMs } },
    )
  }

  const abort = new AbortController()
  let beats = 0
  let lost = false
  let running = true
  let reason: string | undefined

  /** Sleep one interval, renew once, repeat until stopped or superseded. */
  async function loop(): Promise<void> {
    while (!abort.signal.aborted) {
      try {
        await options.clock.sleep(intervalMs, abort.signal)
      } catch {
        // Cancellation is the ordinary way this loop ends: `stop()` aborted it.
        return
      }
      if (abort.signal.aborted) return
      try {
        options.lifecycle.heartbeat()
        beats += 1
      } catch (error) {
        // The lifecycle closed admission and moved to `passive` before throwing.
        // Beating again would only repeat the same failure against a scope that
        // now belongs to somebody else.
        lost = true
        reason = describe(error)
        running = false
        try {
          options.onLost?.(error)
        } catch {
          // The loss is already recorded; an observer must not restart the loop.
        }
        return
      }
    }
  }

  const settled = loop()

  /** Cancel the loop and wait for it; the second call returns the same promise. */
  async function stop(): Promise<void> {
    running = false
    abort.abort()
    await settled
  }

  return Object.freeze({
    intervalMs,
    get beats(): number {
      return beats
    },
    get lost(): boolean {
      return lost
    },
    get reason(): string | undefined {
      return reason
    },
    get running(): boolean {
      return running && !abort.signal.aborted
    },
    stop,
  })
}
