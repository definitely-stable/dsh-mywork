/**
 * Time source the store stamps rows with.
 *
 * The port is deliberately narrower than `ClockPort` from
 * `@dsh-mywork/contracts` (a store never sleeps), and it is structural, so a
 * deployment may hand in the controller clock and a test may hand in
 * `FakeClock` from `@dsh-mywork/adapter-sdk/testing` without an adapter.
 * @module
 */

/** Millisecond time source used for envelope and row timestamps. */
export interface StorageClock {
  /** Current time in epoch milliseconds. */
  now(): number
}

/** Default time source: the system wall clock. */
export const wallClock: StorageClock = Object.freeze({ now: (): number => Date.now() })
