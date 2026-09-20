/**
 * Disabled Memory provider (architecture §23.8, §49; §62 item 25).
 *
 * A deployment may decide that a scope keeps no memory at all. §23.9's routes
 * could express that by leaving the scope unrouted, and this provider exists for
 * the case where the decision must be *named*: a route that points at `disabled`
 * says "this scope has no memory backend, on purpose", which a missing route
 * cannot say.
 *
 * It fails closed and loudly. `health()` reports unavailable with reason
 * `disabled`, so the fabric's §49 policy decides — a degraded empty answer where
 * the route is optional, a refusal where it is required — and `retain` throws
 * rather than accepting a record it will never serve. Silently accepting writes
 * is the one behaviour that would make a disabled backend indistinguishable from
 * a working one.
 * @module
 */

import type {
  ClockPort,
  EpochMs,
  MemoryCapabilities,
  MemoryHealth,
  MemoryId,
  MemoryProviderPort,
  MemoryProviderRecallOutcome,
  MemoryProviderRecallRequest,
  MemoryProviderRetainOutcome,
  MemoryProviderRetainRequest,
  MemoryRecord,
} from '@dsh-mywork/contracts'
import { MyWorkError } from '@dsh-mywork/core'

/** Options accepted by {@link createDisabledMemoryProvider}. */
export interface DisabledMemoryOptions {
  /** Provider id the fabric's routes name. Default `disabled`. */
  readonly provider?: string
  /** Human-readable reason `health()` reports. */
  readonly reason?: string
  /** Time source of `health`. Default: the system clock. */
  readonly clock?: ClockPort
}

/** Provider id the disabled provider answers under by default. */
export const DEFAULT_DISABLED_PROVIDER = 'disabled'

/** Reason code `health()` reports, which the fabric records as a diagnostic. */
export const DISABLED_MEMORY_REASON = 'disabled'

/**
 * Create the provider that keeps nothing (§23.8, §49).
 *
 * It declares no capability and implements neither `reflect` nor `resolve`, so
 * a caller that reaches it is told `CAPABILITY_UNSUPPORTED` rather than handed
 * an empty digest. `recall` throws for the same reason `retain` does: an empty
 * list is a *successful* answer meaning "nothing is known", and a disabled
 * backend must not be able to say that.
 * @param options - the provider id and the reason.
 * @returns the provider.
 * @throws {TypeError} when the provider id is not a non-empty string.
 */
export function createDisabledMemoryProvider(options: DisabledMemoryOptions = {}): MemoryProviderPort {
  const provider = options.provider ?? DEFAULT_DISABLED_PROVIDER
  if (typeof provider !== 'string' || provider.trim().length === 0) {
    throw new TypeError('dsh-mywork: a disabled memory provider id must be a non-empty string')
  }
  const reason = options.reason ?? 'memory is disabled for this scope'
  const clock = options.clock ?? { now: (): number => Date.now(), sleep: async (): Promise<void> => {} }

  function unavailable(operation: string): MyWorkError {
    return new MyWorkError('ADAPTER_UNAVAILABLE', `dsh-mywork: ${reason}; ${operation} was not performed`, {
      details: { provider, reason: DISABLED_MEMORY_REASON, operation },
    })
  }

  return Object.freeze({
    async capabilities(): Promise<MemoryCapabilities> {
      return Object.freeze({ reflect: false, resolve: false, scopeTypes: Object.freeze([]), kinds: Object.freeze([]) })
    },
    async retain(_request: MemoryProviderRetainRequest): Promise<MemoryProviderRetainOutcome> {
      throw unavailable('retain')
    },
    async recall(_request: MemoryProviderRecallRequest): Promise<MemoryProviderRecallOutcome> {
      throw unavailable('recall')
    },
    async resolve(_ref: MemoryId): Promise<MemoryRecord> {
      throw unavailable('resolve')
    },
    async health(): Promise<MemoryHealth> {
      return Object.freeze({
        available: false,
        reason: DISABLED_MEMORY_REASON,
        detail: reason,
        checkedAt: clock.now() as EpochMs,
      })
    },
  })
}
