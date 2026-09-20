/**
 * Native Memory provider (architecture §23.8; §62 item 25).
 *
 * The provider §45 places in `@dsh-mywork/memory-native` is the process-local
 * one: it stores the records the fabric retains, answers structural retrieval,
 * resolves a reference, and reflects on what it holds. It is deliberately
 * *dumb* — it has no routing, no lifecycle gate, no deduplication and no trust
 * policy. Those live in `@dsh-mywork/core`'s fabric, once for every provider, so
 * a second backend cannot behave differently from this one by accident.
 *
 * Two facts about it are stated rather than hidden:
 *
 * - **It is not durable.** The store is a `Map`, so a process restart loses what
 *   was retained. §23.1's long-term memory needs a store that outlives the
 *   process, and this provider is not one; a deployment that needs durability
 *   binds another provider through §23.9's routes.
 * - **A record's content is immutable.** `retain` writes a new record, counts a
 *   reinforcement, or publishes a changed lifecycle state. It refuses to rewrite
 *   the statement under an existing id, because §23.4's "Supersede" is a new
 *   record that names the old one, and rewriting the old one would leave a
 *   snapshot's frozen revision pointing at different text.
 * @module
 */

import {
  MEMORY_KINDS,
  MEMORY_SCOPE_TYPES,
  memoryScopeKey,
  memoryScopeWithin,
  memoryValidAt,
  type ClockPort,
  type EpochMs,
  type MemoryCapabilities,
  type MemoryHealth,
  type MemoryId,
  type MemoryKind,
  type MemoryProviderPort,
  type MemoryProviderRecallOutcome,
  type MemoryProviderRecallRequest,
  type MemoryProviderReflectOutcome,
  type MemoryProviderReflectRequest,
  type MemoryProviderRetainOutcome,
  type MemoryProviderRetainRequest,
  type MemoryRecord,
  type MemoryScopeRef,
} from '@dsh-mywork/contracts'
import { MyWorkError } from '@dsh-mywork/core'

/** Options accepted by {@link createNativeMemoryProvider}. */
export interface NativeMemoryOptions {
  /** Provider id the fabric's routes name. Default `native`. */
  readonly provider?: string
  /** Records the provider starts with. */
  readonly records?: readonly MemoryRecord[]
  /** Scope families it declares (§37). Default: every family §23.2 lists. */
  readonly scopeTypes?: readonly string[]
  /** Kinds it declares (§37). Default: every kind §23.3 lists. */
  readonly kinds?: readonly MemoryKind[]
  /** Time source of `health`. Default: the system clock. */
  readonly clock?: ClockPort
}

/** The native provider, with the read-only views a caller may inspect. */
export interface NativeMemoryProvider extends MemoryProviderPort {
  /** Provider id the fabric's routes name. */
  readonly provider: string
  /** Every record held, in insertion order. */
  records(): readonly MemoryRecord[]
  /** The record one reference names, or undefined. */
  find(id: MemoryId): MemoryRecord | undefined
}

/**
 * Create the native, process-local memory provider (§23.8).
 *
 * The store is a `Map` keyed by record id; retrieval walks it and filters,
 * which is deliberate at this scale — a provider that pre-indexes would have to
 * keep the index consistent with every lifecycle write, and the fabric is the
 * only writer (§23.9).
 * @param options - the provider id, seed records, and declared surface.
 * @returns the provider.
 * @throws {TypeError} when the options are malformed.
 */
export function createNativeMemoryProvider(options: NativeMemoryOptions = {}): NativeMemoryProvider {
  const provider = options.provider ?? DEFAULT_NATIVE_PROVIDER
  requireText(provider, 'a native memory provider id')
  const scopeTypes = Object.freeze([...(options.scopeTypes ?? MEMORY_SCOPE_TYPES)])
  const kinds = Object.freeze([...(options.kinds ?? MEMORY_KINDS)])
  const clock = options.clock ?? systemClock()

  /** The whole store: one entry per record id. */
  const records = new Map<MemoryId, MemoryRecord>()
  for (const record of options.records ?? []) {
    const checked = requireRecord(record)
    if (records.has(checked.id)) {
      throw new TypeError(`dsh-mywork: the native provider was seeded with "${checked.id}" twice`)
    }
    records.set(checked.id, checked)
  }

  async function retain(request: MemoryProviderRetainRequest): Promise<MemoryProviderRetainOutcome> {
    const record = requireRecord(request?.record)
    const mode = request?.mode
    if (mode !== 'create' && mode !== 'reinforce' && mode !== 'replace') {
      throw new TypeError(`dsh-mywork: "${String(mode)}" is not a memory write mode`)
    }
    const held = records.get(record.id)
    if (held === undefined) {
      if (mode === 'replace') {
        // A replace of something the provider does not hold would invent a
        // record's history: the fabric only replaces a record it read.
        throw new MyWorkError('TASK_CONFLICT', `dsh-mywork: the native provider holds no memory "${record.id}" to replace`, {
          details: { id: record.id, mode },
        })
      }
      records.set(record.id, Object.freeze({ ...record }))
      return Object.freeze({ record: records.get(record.id) as MemoryRecord, created: true })
    }
    if (!sameContent(held, record)) {
      // §23.4 Supersede: revised content is a new record that names the old
      // one. Rewriting the text under the same id would rewrite what a frozen
      // snapshot already points at — and the identity is the whole content, not
      // the statement alone: a `replace` that moved the scope, lowered the
      // trust or dropped the sources would be a different record wearing an old
      // id, which is precisely what §52 and §23.6 must not allow. The
      // comparison is over the fields themselves rather than over the
      // fingerprint, because the fingerprint is data a caller copies along with
      // the rest of the record.
      throw new MyWorkError(
        'TASK_CONFLICT',
        `dsh-mywork: memory "${record.id}" holds other content; revised memory is a new record that supersedes it`,
        {
          details: {
            id: record.id,
            heldHash: held.contentHash,
            incomingHash: record.contentHash,
            heldFingerprint: held.fingerprint,
            incomingFingerprint: record.fingerprint,
          },
        },
      )
    }
    if (mode === 'create') {
      if (held.fingerprint !== record.fingerprint) {
        throw new MyWorkError('TASK_CONFLICT', `dsh-mywork: memory "${record.id}" already exists with another identity`, {
          details: { id: record.id },
        })
      }
      // The same record proposed again is the idempotent case: nothing is
      // written and the caller is told it already existed.
      return Object.freeze({ record: held, created: false })
    }
    records.set(record.id, Object.freeze({ ...record }))
    return Object.freeze({ record: records.get(record.id) as MemoryRecord, created: false })
  }

  async function recall(request: MemoryProviderRecallRequest): Promise<MemoryProviderRecallOutcome> {
    const scopes = requireScopes(request?.scopes, request?.ids)
    const ids = request?.ids
    if (ids !== undefined && !Array.isArray(ids)) {
      throw new TypeError('dsh-mywork: memory ids must be an array')
    }
    const kinds = request?.kinds
    if (kinds !== undefined && !Array.isArray(kinds)) {
      throw new TypeError('dsh-mywork: memory kinds must be an array')
    }
    const limit = request?.limit
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      throw new TypeError('dsh-mywork: a memory provider limit must be a non-negative integer')
    }
    const found: MemoryRecord[] = []
    const selected = ids === undefined ? undefined : new Set(ids)
    for (const record of records.values()) {
      if (selected !== undefined) {
        if (!selected.has(record.id)) continue
      } else if (!memoryScopeWithin(record.scope, scopes)) {
        continue
      }
      if (kinds !== undefined && !kinds.includes(record.kind)) continue
      found.push(record)
    }
    found.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    return Object.freeze({ records: Object.freeze(limit === undefined ? found : found.slice(0, limit)) })
  }

  async function reflect(request: MemoryProviderReflectRequest): Promise<MemoryProviderReflectOutcome> {
    const scope = requireScope(request?.scope)
    const nowMs = request?.nowMs
    if (!isCounter(nowMs)) throw new TypeError('dsh-mywork: a reflection needs epoch milliseconds')
    const kinds = request.kinds
    const held = [...records.values()]
      .filter(record => memoryScopeKey(record.scope) === memoryScopeKey(scope))
      .filter(record => kinds === undefined || kinds.includes(record.kind))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    const active = held.filter(record => record.status === 'active' && memoryValidAt(record.validity, nowMs))
    const text = [
      `${held.length} record(s) for scope ${memoryScopeKey(scope)}; ${active.length} active at ${nowMs}`,
      ...active.map(record => `- [${record.kind}] ${record.statement}`),
    ].join('\n')
    return Object.freeze({
      scope,
      records: Object.freeze(held),
      text,
      observedAt: nowMs,
    })
  }

  async function resolve(ref: MemoryId): Promise<MemoryRecord> {
    requireText(ref, 'a memory id')
    const record = records.get(ref)
    if (record === undefined) {
      throw new MyWorkError('TASK_CONFLICT', `dsh-mywork: the native provider holds no memory "${ref}"`, {
        details: { id: ref },
      })
    }
    return record
  }

  async function capabilities(): Promise<MemoryCapabilities> {
    return Object.freeze({
      reflect: true,
      resolve: true,
      scopeTypes,
      kinds,
    })
  }

  async function health(): Promise<MemoryHealth> {
    return Object.freeze({ available: true, checkedAt: clock.now() as EpochMs })
  }

  return Object.freeze({
    provider,
    capabilities,
    retain,
    recall,
    reflect,
    resolve,
    health,
    records: (): readonly MemoryRecord[] => Object.freeze([...records.values()]),
    find: (id: MemoryId): MemoryRecord | undefined => records.get(id),
  })
}

/** Provider id the native provider answers under by default. */
export const DEFAULT_NATIVE_PROVIDER = 'native'

/**
 * Whether two records carry the same content, so one may replace the other.
 *
 * Everything a record *is* is compared — statement, scope, kind, sources,
 * author, trust, confidence, validity, the records it supersedes, its revision,
 * its identity, and when it was retained. What is deliberately left out is the
 * lifecycle state: `status`, `statusChangedAt` and `reinforcedCount` are the
 * only fields a write is allowed to move under an existing id (§23.4 Reinforce /
 * Supersede). `retainedAt` is not one of them — recall orders by it, so
 * rewriting it would silently reorder a memory nobody re-retained.
 */
function sameContent(held: MemoryRecord, incoming: MemoryRecord): boolean {
  return (
    held.statement === incoming.statement &&
    memoryScopeKey(held.scope) === memoryScopeKey(incoming.scope) &&
    held.kind === incoming.kind &&
    held.trust === incoming.trust &&
    held.confidence === incoming.confidence &&
    held.revision === incoming.revision &&
    held.contentHash === incoming.contentHash &&
    held.fingerprint === incoming.fingerprint &&
    held.retainedAt === incoming.retainedAt &&
    held.createdBy.component === incoming.createdBy.component &&
    held.createdBy.run === incoming.createdBy.run &&
    held.validity.from === incoming.validity.from &&
    held.validity.until === incoming.validity.until &&
    [...held.supersedes].sort().join(',') === [...incoming.supersedes].sort().join(',') &&
    held.sources.length === incoming.sources.length &&
    held.sources.every((source, index) => {
      const other = incoming.sources[index]
      return (
        other !== undefined &&
        source.type === other.type &&
        source.uri === other.uri &&
        source.revision === other.revision
      )
    })
  )
}

/** Validate and freeze one record the provider is asked to store. */
function requireRecord(record: MemoryRecord | undefined): MemoryRecord {
  if (record === null || typeof record !== 'object') {
    throw new TypeError('dsh-mywork: a memory provider needs a record')
  }
  requireText(record.id, 'a memory id')
  requireText(record.statement, 'a memory statement')
  requireText(record.kind, 'a memory kind')
  requireText(record.contentHash, 'a memory content hash')
  requireText(record.fingerprint, 'a memory fingerprint')
  requireScope(record.scope)
  if (!Number.isInteger(record.revision) || record.revision < 1) {
    throw new TypeError('dsh-mywork: a memory record needs a positive revision')
  }
  return record
}

/** Validate one scope. */
function requireScope(scope: MemoryScopeRef | undefined): MemoryScopeRef {
  if (scope === null || typeof scope !== 'object') throw new TypeError('dsh-mywork: a memory scope must be an object')
  requireText(scope.type, 'a memory scope type')
  requireText(scope.id, 'a memory scope id')
  return scope
}

/** Validate the selectors of one retrieval. */
function requireScopes(scopes: readonly MemoryScopeRef[] | undefined, ids: readonly MemoryId[] | undefined): readonly MemoryScopeRef[] {
  if (ids !== undefined) {
    if (!Array.isArray(ids)) throw new TypeError('dsh-mywork: memory ids must be an array')
    return Object.freeze([])
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new TypeError('dsh-mywork: a memory retrieval needs scopes or ids')
  }
  return Object.freeze(scopes.map(scope => requireScope(scope)))
}

/** One value that has to be a non-empty string. */
function requireText(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`dsh-mywork: ${what} must be a non-empty string`)
  }
}

/** Whether a value is a non-negative clock reading. */
function isCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** The system clock, used when a provider is built without one. */
function systemClock(): ClockPort {
  return Object.freeze({
    now: (): number => Date.now(),
    sleep: (ms: number, signal?: AbortSignal): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new Error('dsh-mywork: the sleep was cancelled'))
          return
        }
        const timer = setTimeout(resolve, Math.max(0, ms))
        signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('dsh-mywork: the sleep was cancelled'))
        })
      }),
  })
}
