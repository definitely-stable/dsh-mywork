/**
 * Native Memory (architecture §23.8, §45).
 *
 * Two §23.8 providers:
 *
 * - {@link createNativeMemoryProvider} — the process-local store MyWork keeps
 *   its own retained memory in, and the reference implementation the fabric's
 *   acceptance checks run against.
 * - {@link createDisabledMemoryProvider} — the provider that keeps nothing, so a
 *   deployment can *name* a scope that has no memory backend instead of leaving
 *   it unrouted.
 *
 * Neither decides anything: routing, the §23.4 lifecycle, deduplication, and
 * trust live in `@dsh-mywork/core`'s Memory Fabric (§23.9), so a second backend
 * bound through the same routes cannot behave differently from these two.
 * @module @dsh-mywork/memory-native
 */

export {
  DEFAULT_NATIVE_PROVIDER,
  createNativeMemoryProvider,
  type NativeMemoryOptions,
  type NativeMemoryProvider,
} from './native.ts'
export {
  DEFAULT_DISABLED_PROVIDER,
  DISABLED_MEMORY_REASON,
  createDisabledMemoryProvider,
  type DisabledMemoryOptions,
} from './disabled.ts'
