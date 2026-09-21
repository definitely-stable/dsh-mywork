/**
 * Beads memory provider (architecture §23.8, §37, §39; §62 item 26).
 *
 * The external `MemoryProviderPort` backend is Beads itself: the same `bd` CLI,
 * the same `.beads` workspace and the same embedded Dolt database the TaskGraph
 * adapter uses, reached through the **key-value store** (`bd kv set` / `bd kv
 * get` / `bd kv list`). Nothing else is added — no server, no API key, no second
 * point of failure (MW-001 §6.6).
 *
 * ## Why `bd kv` and not `bd remember`
 *
 * MW-001 (revision 2) proposed the `bd remember` family before the API could be
 * probed — it marks that probe `BLOCKED (live probe only)` and concludes "confirm
 * the Beads memory … or name another backend". Probing Beads 1.3.0 in an isolated
 * workspace settled it, and the answer is that `remember` is the wrong channel
 * for this port:
 *
 * - `bd remember` values are injected into agent instructions. `bd prime` prints
 *   a `## Persistent Memories (N)` section listing every stored value verbatim,
 *   so a record retained here would reach every agent session in this workspace —
 *   past §23.4's lifecycle gate (a `candidate` is not yet validated), past §23.6's
 *   trust gate (§21.4 renders `medium`/`low` memory as untrusted data, not as
 *   instructions) and past §23.2/§52 scope isolation. Round-trip fidelity needs
 *   the whole `MemoryRecord`, so what would be injected is machine JSON, not a
 *   statement.
 * - `bd kv` is the store Beads documents for "user-defined data that persists
 *   across sessions", it is not injected at prime, and the backend itself keeps
 *   the two namespaces apart: `bd kv set memory.x v` is refused with
 *   `invalid key: key cannot start with "memory." (reserved for persistent
 *   memories)`, so a kv key can never be mistaken for a memory or the other way
 *   round.
 *
 * The costs of that choice are named rather than hidden: `bd kv set` reports no
 * created/updated signal, so `retain` reads the key before writing it (two `bd`
 * invocations), and a write is trusted on its exit code rather than read back.
 *
 * ## What this provider is not
 *
 * It stores records and returns them; it decides nothing. Routing, the lifecycle
 * gate, deduplication and trust live in `@dsh-mywork/core`'s fabric, once for
 * every provider (§23.9), so this backend cannot behave differently from the
 * native one by accident. Two §39 facts are declared rather than emulated:
 * `reflect` is **not implemented** (Beads has no reflection operation, and a
 * digest computed here would be the adapter's, not the backend's), and the store
 * has **no versioning** (`kv set` overwrites in place; `bd history` answers "No
 * history found" for a memory key) — a record's §35 `revision` travels *inside*
 * the value, so it survives a round trip, but the backend keeps no history of it.
 * @module
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  MEMORY_KINDS,
  MEMORY_SCOPE_TYPES,
  memoryScopeKey,
  memoryScopeWithin,
  type EpochMs,
  type MemoryCapabilities,
  type MemoryHealth,
  type MemoryId,
  type MemoryKind,
  type MemoryProviderPort,
  type MemoryProviderRecallOutcome,
  type MemoryProviderRecallRequest,
  type MemoryProviderRetainOutcome,
  type MemoryProviderRetainRequest,
  type MemoryRecord,
  type MemoryScopeRef,
} from '@dsh-mywork/contracts'
import { MyWorkError } from '@dsh-mywork/core'
import { defineAdapterManifest, type AdapterCapabilityManifest } from '@dsh-mywork/adapter-sdk'

import { firstLine, type BeadsCommandResult, type BeadsRunner } from './runner.ts'

/** Adapter id this provider registers under in the §44 registry. */
export const BEADS_MEMORY_ADAPTER_ID = 'beads'

/** Provider id §23.9's routes name when they route a scope to this backend. */
export const BEADS_MEMORY_PROVIDER = 'beads'

/**
 * Key namespace this provider owns inside the Beads key-value store.
 *
 * It may not begin with `memory.`: Beads reserves that prefix for `bd remember`
 * and refuses to write it through `bd kv`, which is what keeps the two stores
 * distinguishable in one `bd kv list`.
 */
export const BEADS_MEMORY_KEY_PREFIX = 'mywork.memory.'

/** `schema_version` Beads 1.3.0 stamps on its `--json` output. */
export const BEADS_JSON_SCHEMA_VERSION = 1

/** Revision of the envelope this provider writes into a value. */
export const BEADS_MEMORY_PAYLOAD_SCHEMA = 1

/**
 * The §37 declaration: what this backend really does.
 *
 * `reflect` is `false` because Beads has no reflection operation — the fabric
 * answers `CAPABILITY_UNSUPPORTED` instead of an empty digest that would read as
 * "nothing to say". `versioning` is `false` because `bd kv set` overwrites in
 * place and the store keeps no history. `structuredScopes` is `false` because a
 * value carries the record and the store has no scope column; scope is applied
 * by this adapter through the contract's own §23.2 rule.
 */
export const BEADS_MEMORY_MANIFEST: AdapterCapabilityManifest = defineAdapterManifest({
  adapterId: BEADS_MEMORY_ADAPTER_ID,
  kind: 'memory',
  contractVersion: 'memory/v1',
  capabilities: {
    retain: true,
    recall: true,
    reflect: false,
    resolve: true,
    structuredScopes: false,
    versioning: false,
  },
})

/** Options accepted by {@link createBeadsMemoryProvider}. */
export interface BeadsMemoryOptions {
  /** The `bd` process seam; the only interface that touches the operating system. */
  readonly runner: BeadsRunner
  /** Directory `bd` runs in; the workspace is discovered from it, as `bd` does. */
  readonly cwd: string
  /** Provider id §23.9's routes name. Default {@link BEADS_MEMORY_PROVIDER}. */
  readonly provider?: string
  /** Key namespace. Default {@link BEADS_MEMORY_KEY_PREFIX}. */
  readonly keyPrefix?: string
  /** Scope families it declares (§37). Default: every family §23.2 lists. */
  readonly scopeTypes?: readonly string[]
  /** Kinds it declares (§37). Default: every kind §23.3 lists. */
  readonly kinds?: readonly MemoryKind[]
  /**
   * Milliseconds one `bd` invocation may take before the provider refuses it.
   *
   * Enforced by the provider as well as by the runner: a backend that never
   * answers must not be able to hang a fabric call, whatever runner it was
   * built with. Default {@link DEFAULT_MEMORY_COMMAND_TIMEOUT_MS}.
   */
  readonly timeoutMs?: number
  /**
   * The `.beads` directory, when the caller already resolved one.
   *
   * `health` never spawns a process — the fabric asks for availability before
   * every call — so it answers from the filesystem. Given nothing, the nearest
   * `.beads` at or above {@link BeadsMemoryOptions.cwd} is used.
   */
  readonly beadsDir?: string
  /** Time source of `health`. Default: the system clock. */
  readonly now?: () => EpochMs
}

/** Default deadline for one `bd` invocation; matches the runner's own. */
export const DEFAULT_MEMORY_COMMAND_TIMEOUT_MS = 30_000

/** The §57 report: what this backend is, and which capabilities answer. */
export interface BeadsMemoryDiagnostics {
  /** Adapter id from §37. */
  readonly adapterId: string
  /** Contract revision the adapter implements. */
  readonly contractVersion: string
  /** Provider id §23.9's routes name. */
  readonly provider: string
  /** Key namespace owned inside the key-value store. */
  readonly keyPrefix: string
  /** Resolved `.beads` directory, when one could be found without spawning. */
  readonly workspace?: string
  /** Version `bd --version` reported, when the backend answered. */
  readonly installedVersion?: string
  /** Whether `bd ping` answered. */
  readonly connectivity: 'ok' | 'failed'
  /** One-line cause, when a probe failed; never parsed. */
  readonly detail?: string
  /** Every §37 capability flag, as declared. */
  readonly capabilities: Readonly<Record<string, boolean>>
  /** The deadline one `bd` invocation is bounded by, in milliseconds. */
  readonly timeoutMs: number
}

/** The provider, with the §57 view a Doctor reads. */
export interface BeadsMemoryProvider extends MemoryProviderPort {
  /** Provider id §23.9's routes name. */
  readonly provider: string
  /** The §37 declaration this provider answers under. */
  readonly manifest: AdapterCapabilityManifest
  /**
   * Every record the workspace holds for this provider, ordered by id.
   *
   * A read-only view outside the port, the same one the native provider offers:
   * the fabric never needs it, and an id source for a store that outlives the
   * process does (see {@link createBeadsMemoryIdSource}).
   */
  records(): Promise<readonly MemoryRecord[]>
  /** Read the backend's version and connectivity on demand (§57). */
  diagnostics(): Promise<BeadsMemoryDiagnostics>
}

/** The envelope one key holds. */
interface BeadsMemoryEnvelope {
  /** Revision of this envelope. */
  readonly schema: number
  /** The record, exactly as the fabric handed it over. */
  readonly record: MemoryRecord
}

/**
 * Create the Beads memory provider (§23.8).
 *
 * The provider is stateless: every call reads or writes the workspace, so two
 * providers over one workspace cannot disagree, and a process restart loses
 * nothing. That is the durability MW-018's native provider explicitly does not
 * have, and the reason this card exists.
 * @param options - the runner, the working directory, and the declared surface.
 * @returns the provider.
 * @throws {TypeError} when the options are malformed.
 */
export function createBeadsMemoryProvider(options: BeadsMemoryOptions): BeadsMemoryProvider {
  const runner = options.runner
  if (runner === null || typeof runner !== 'object' || typeof runner.run !== 'function') {
    throw new TypeError('dsh-mywork: a beads memory provider needs a runner')
  }
  const cwd = options.cwd
  if (typeof cwd !== 'string' || cwd.trim().length === 0) {
    throw new TypeError('dsh-mywork: a beads memory provider needs a working directory')
  }
  const provider = options.provider ?? BEADS_MEMORY_PROVIDER
  requireText(provider, 'a beads memory provider id')
  const keyPrefix = options.keyPrefix ?? BEADS_MEMORY_KEY_PREFIX
  requireText(keyPrefix, 'a beads memory key prefix')
  if (keyPrefix.startsWith('memory.')) {
    throw new TypeError(
      'dsh-mywork: a beads memory key prefix may not start with "memory.", which Beads reserves for bd remember',
    )
  }
  const scopeTypes = Object.freeze([...(options.scopeTypes ?? MEMORY_SCOPE_TYPES)])
  const kinds = Object.freeze([...(options.kinds ?? MEMORY_KINDS)])
  const timeoutMs = options.timeoutMs ?? DEFAULT_MEMORY_COMMAND_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('dsh-mywork: a beads memory command timeout must be a positive number')
  }
  const now = options.now ?? ((): EpochMs => Date.now() as EpochMs)
  const beadsDir = options.beadsDir ?? findBeadsDir(cwd)

  /** The key one record id is stored under. */
  function keyOf(id: MemoryId): string {
    requireText(id, 'a memory id')
    if (/[\u0000-\u001f\u007f]/.test(id)) {
      throw new TypeError('dsh-mywork: a memory id may not contain control characters')
    }
    return `${keyPrefix}${id}`
  }

  /** The record id a key holds, or undefined when the key is not this provider's. */
  function idOf(key: string): string | undefined {
    return key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : undefined
  }

  /**
   * One bounded `bd` invocation.
   *
   * The deadline is this provider's own wall-clock timer, not the runner's: a
   * runner that never answers must not be able to hang a fabric call, and the
   * fabric's own deadline (§49) bounds the fabric's wait, not the process.
   */
  async function run(args: readonly string[]): Promise<BeadsCommandResult> {
    const label = args.join(' ')
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new MyWorkError('ADAPTER_UNAVAILABLE', `dsh-mywork: bd ${label} did not answer inside ${String(timeoutMs)}ms`, {
            details: { command: label, timeoutMs, adapterId: BEADS_MEMORY_ADAPTER_ID },
          }),
        )
      }, timeoutMs)
    })
    try {
      return await Promise.race([runner.run({ args, cwd }), deadline])
    } catch (error) {
      if (error instanceof MyWorkError) throw error
      // A spawn that never happened — no `bd` on PATH, no workspace — is the
      // backend being absent, which §49 reports as unavailability and never as
      // an empty answer.
      throw new MyWorkError('ADAPTER_UNAVAILABLE', `dsh-mywork: bd ${label} could not be run: ${messageOf(error)}`, {
        details: { command: label, adapterId: BEADS_MEMORY_ADAPTER_ID },
        cause: error,
      })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /** Parse one `--json` answer, or report the backend as broken. */
  function parseJson(label: string, text: string): Record<string, unknown> {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (cause) {
      throw new MyWorkError('ADAPTER_UNAVAILABLE', `dsh-mywork: bd ${label} answered with malformed JSON`, {
        details: { command: label, adapterId: BEADS_MEMORY_ADAPTER_ID },
        cause,
      })
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new MyWorkError('ADAPTER_UNAVAILABLE', `dsh-mywork: bd ${label} answered with a non-object payload`, {
        details: { command: label, adapterId: BEADS_MEMORY_ADAPTER_ID },
      })
    }
    return parsed as Record<string, unknown>
  }

  /**
   * Refuse an answer written in a vocabulary this adapter does not know.
   *
   * Guessing would be worse than refusing: a half-understood record would enter
   * the fabric wearing the authority of a validated one (§39 `version mismatch`).
   */
  function requireSchemaVersion(label: string, payload: Record<string, unknown>): void {
    const version = payload.schema_version
    if (version !== BEADS_JSON_SCHEMA_VERSION) {
      throw new MyWorkError(
        'CONTRACT_MISMATCH',
        `dsh-mywork: bd ${label} answered in schema ${String(version)}; this adapter speaks ${String(BEADS_JSON_SCHEMA_VERSION)}`,
        {
          details: {
            command: label,
            expected: BEADS_JSON_SCHEMA_VERSION,
            received: version,
            adapterId: BEADS_MEMORY_ADAPTER_ID,
          },
        },
      )
    }
  }

  /** A failure of one `bd` invocation, with whatever the backend said about it. */
  function backendFailure(label: string, result: BeadsCommandResult): MyWorkError {
    const said = firstLine(result.stderr) || firstLine(result.stdout)
    const detail = said.length > 0 ? said : `exit ${String(result.code)}`
    return new MyWorkError('ADAPTER_UNAVAILABLE', `dsh-mywork: bd ${label} failed: ${detail}`, {
      details: { command: label, code: result.code, adapterId: BEADS_MEMORY_ADAPTER_ID },
    })
  }

  /** A value this provider owns that it cannot read back. */
  function storedValueRefusal(key: string, problem: string, cause?: unknown): MyWorkError {
    return new MyWorkError(
      'CONTRACT_MISMATCH',
      `dsh-mywork: the key "${key}" holds a value this adapter cannot read: ${problem}`,
      {
        details: { key, adapterId: BEADS_MEMORY_ADAPTER_ID },
        ...(cause === undefined ? {} : { cause }),
      },
    )
  }

  /** The record one stored value carries. */
  function decodeValue(key: string, value: unknown): MemoryRecord {
    if (typeof value !== 'string') return throwStored(key, 'the stored value is not a string')
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch (cause) {
      return throwStored(key, 'the stored value is not JSON', cause)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return throwStored(key, 'the stored value is not an envelope object')
    }
    const envelope = parsed as Partial<BeadsMemoryEnvelope>
    if (envelope.schema !== BEADS_MEMORY_PAYLOAD_SCHEMA) {
      return throwStored(
        key,
        `the envelope is schema ${String(envelope.schema)}; this adapter writes ${String(BEADS_MEMORY_PAYLOAD_SCHEMA)}`,
      )
    }
    const problem = recordProblem(envelope.record)
    if (problem !== undefined) return throwStored(key, problem)
    const record = envelope.record as MemoryRecord
    const expected = idOf(key)
    if (expected !== undefined && record.id !== expected) {
      return throwStored(key, `it names the record "${record.id}"`)
    }
    return Object.freeze({ ...record })
  }

  /** Raise the refusal {@link decodeValue} describes. */
  function throwStored(key: string, problem: string, cause?: unknown): never {
    throw storedValueRefusal(key, problem, cause)
  }

  /** Every record this provider holds, ordered by id. */
  async function list(): Promise<readonly MemoryRecord[]> {
    const result = await run(['kv', 'list', '--json'])
    if (result.code !== 0) throw backendFailure('kv list', result)
    const payload = parseJson('kv list', result.stdout)
    requireSchemaVersion('kv list', payload)
    const records: MemoryRecord[] = []
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'schema_version') continue
      if (idOf(key) === undefined) continue
      records.push(decodeValue(key, value))
    }
    records.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    return Object.freeze(records)
  }

  /** The record one key holds, or undefined when the backend holds none. */
  async function readOne(key: string): Promise<MemoryRecord | undefined> {
    const result = await run(['kv', 'get', key, '--json'])
    const payload = parseJson('kv get', result.stdout)
    requireSchemaVersion('kv get', payload)
    if (payload.found !== true) {
      // `bd kv get` answers `{found: false}` with exit 1 for a key it does not
      // hold, and `{error: …}` with exit 1 for a request it refuses. Only the
      // first is an absent record; the second is a backend that said no.
      if (typeof payload.error === 'string') {
        throw new MyWorkError('ADAPTER_UNAVAILABLE', `dsh-mywork: bd kv get refused the key "${key}": ${payload.error}`, {
          details: { key, adapterId: BEADS_MEMORY_ADAPTER_ID },
        })
      }
      if (result.code !== 1 && result.code !== 0) throw backendFailure('kv get', result)
      return undefined
    }
    return decodeValue(key, payload.value)
  }

  /** Write one record, and trust the exit code that it landed. */
  async function write(key: string, record: MemoryRecord): Promise<void> {
    const envelope: BeadsMemoryEnvelope = Object.freeze({ schema: BEADS_MEMORY_PAYLOAD_SCHEMA, record })
    const result = await run(['kv', 'set', key, JSON.stringify(envelope), '--json'])
    if (result.code !== 0) throw backendFailure('kv set', result)
  }

  async function retain(request: MemoryProviderRetainRequest): Promise<MemoryProviderRetainOutcome> {
    const record = requireRecord(request?.record)
    const mode = requireMode(request?.mode)
    const key = keyOf(record.id)
    const held = await readOne(key)
    if (held === undefined) {
      if (mode === 'replace') {
        // A replace of something the provider does not hold would invent a
        // record's history: the fabric only replaces a record it read.
        throw new MyWorkError('TASK_CONFLICT', `dsh-mywork: the beads backend holds no memory "${record.id}" to replace`, {
          details: { id: record.id, mode, adapterId: BEADS_MEMORY_ADAPTER_ID },
        })
      }
      await write(key, record)
      return Object.freeze({ record: Object.freeze({ ...record }), created: true })
    }
    if (!sameContent(held, record)) {
      // §23.4 Supersede: revised content is a new record that names the old one.
      // The identity is the whole content, not the statement alone — a write
      // that moved the scope, lowered the trust or dropped the sources would be
      // a different record wearing an old id (§23.6, §52), which is the one
      // thing this comparison exists to refuse.
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
            adapterId: BEADS_MEMORY_ADAPTER_ID,
          },
        },
      )
    }
    if (mode === 'create') {
      if (held.fingerprint !== record.fingerprint) {
        throw new MyWorkError('TASK_CONFLICT', `dsh-mywork: memory "${record.id}" already exists with another identity`, {
          details: { id: record.id, adapterId: BEADS_MEMORY_ADAPTER_ID },
        })
      }
      // The same record proposed again is the idempotent case — a retry whose
      // first answer was lost. Nothing is written and the caller is told the
      // store already held it.
      return Object.freeze({ record: held, created: false })
    }
    await write(key, record)
    return Object.freeze({ record: Object.freeze({ ...record }), created: false })
  }

  async function recall(request: MemoryProviderRecallRequest): Promise<MemoryProviderRecallOutcome> {
    const scopes = requireScopes(request?.scopes, request?.ids)
    const ids = request?.ids
    const requestKinds = request?.kinds
    if (requestKinds !== undefined && !Array.isArray(requestKinds)) {
      throw new TypeError('dsh-mywork: memory kinds must be an array')
    }
    const limit = request?.limit
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      throw new TypeError('dsh-mywork: a memory provider limit must be a non-negative integer')
    }
    const selected = ids === undefined ? undefined : new Set(ids)
    const found = (await list()).filter(record => {
      if (selected !== undefined) {
        if (!selected.has(record.id)) return false
      } else if (!memoryScopeWithin(record.scope, scopes)) {
        // §23.2 through the contract's own rule: exact on type and id, and a
        // record nested under a requested scope is visible to it.
        return false
      }
      return requestKinds === undefined || requestKinds.includes(record.kind)
    })
    return Object.freeze({
      records: Object.freeze(limit === undefined ? found : found.slice(0, limit)),
    })
  }

  async function resolve(ref: MemoryId): Promise<MemoryRecord> {
    const record = await readOne(keyOf(ref))
    if (record === undefined) {
      // TASK_CONFLICT, which §23's refusal vocabulary maps to `invalid-ref` —
      // deliberately not ADAPTER_UNAVAILABLE, so a typo is not retried forever
      // as if the backend were down.
      throw new MyWorkError('TASK_CONFLICT', `dsh-mywork: the beads backend holds no memory "${ref}"`, {
        details: { id: ref, adapterId: BEADS_MEMORY_ADAPTER_ID },
      })
    }
    return record
  }

  async function capabilities(): Promise<MemoryCapabilities> {
    return Object.freeze({
      // Not implemented, and not emulated: Beads has no reflection operation, so
      // the fabric refuses `reflect` with CAPABILITY_UNSUPPORTED rather than
      // returning a digest this adapter made up (§23.8, §57).
      reflect: false,
      resolve: true,
      scopeTypes,
      kinds,
    })
  }

  async function health(): Promise<MemoryHealth> {
    const checkedAt = now()
    if (beadsDir === undefined) {
      // A precondition, not a liveness probe: the fabric asks before every call,
      // and a `bd ping` per call would cost more than the call it guards. A
      // backend that is present but broken is reported by the call itself, whose
      // failure the fabric maps to `provider-unavailable` (§49).
      return Object.freeze({
        available: false,
        reason: 'no-workspace',
        detail: `no .beads directory at or above ${cwd}; initialise one with "bd init"`,
        checkedAt,
      })
    }
    return Object.freeze({ available: true, checkedAt })
  }

  async function diagnostics(): Promise<BeadsMemoryDiagnostics> {
    const base = {
      adapterId: BEADS_MEMORY_ADAPTER_ID,
      contractVersion: BEADS_MEMORY_MANIFEST.contractVersion,
      provider,
      keyPrefix,
      ...(beadsDir === undefined ? {} : { workspace: beadsDir }),
      capabilities: BEADS_MEMORY_MANIFEST.capabilities,
      timeoutMs,
    }
    const version = await probe(['--version'])
    const ping = await probe(['ping'])
    return Object.freeze({
      ...base,
      ...(version === undefined ? {} : { installedVersion: parseBdVersion(version) }),
      connectivity: ping === undefined ? 'failed' : 'ok',
      ...(ping === undefined
        ? { detail: `bd ping did not answer: ${version === undefined ? 'bd --version did not answer either' : 'see the version probe'}` }
        : {}),
    })
  }

  /** One diagnostic probe that reports instead of throwing (§57). */
  async function probe(args: readonly string[]): Promise<string | undefined> {
    try {
      const result = await run(args)
      return result.code === 0 ? result.stdout : undefined
    } catch {
      return undefined
    }
  }

  return Object.freeze({
    provider,
    manifest: BEADS_MEMORY_MANIFEST,
    capabilities,
    retain,
    recall,
    resolve,
    health,
    records: list,
    diagnostics,
  })
}

/** Namespace of the record ids {@link createBeadsMemoryIdSource} mints. */
export const BEADS_MEMORY_ID_NAMESPACE = 'mem-beads'

/** Options accepted by {@link createBeadsMemoryIdSource}. */
export interface BeadsMemoryIdSourceOptions {
  /** The provider whose workspace holds the sequence to continue. */
  readonly provider: BeadsMemoryProvider
  /** Namespace of the ids it mints. Default {@link BEADS_MEMORY_ID_NAMESPACE}. */
  readonly namespace?: string
}

/**
 * An id source for a store that outlives the process (§23.5, §23.9).
 *
 * The fabric's default id is `mem-<fabric instance>-<n>`, which restarts at
 * `mem-1-1` in the next process. A provider that keeps its store would then be
 * asked to create a record under an id it already holds — and refusing is the
 * correct answer, because §23.4 makes revised content a new record rather than a
 * rewrite, so the store would refuse the second process's first new record
 * forever. This source continues the sequence the workspace already holds
 * instead, reading it once and counting on from there.
 *
 * Two processes sharing one workspace can still race past each other; the
 * provider refuses the loser's colliding write rather than letting it overwrite
 * a record, which is why this closes the restart case and does not claim to
 * close the concurrent-writer case (the fabric's §23.9 single primary writer is
 * what closes that one).
 * @param options - the provider to read the sequence from, and the namespace.
 * @returns a function the fabric's `nextId` option accepts.
 * @throws {TypeError} when the provider or namespace is malformed.
 */
export function createBeadsMemoryIdSource(options: BeadsMemoryIdSourceOptions): () => Promise<string> {
  const provider = options.provider
  if (provider === null || typeof provider !== 'object' || typeof provider.records !== 'function') {
    throw new TypeError('dsh-mywork: a beads memory id source needs a provider to read the sequence from')
  }
  const namespace = options.namespace ?? BEADS_MEMORY_ID_NAMESPACE
  requireText(namespace, 'a beads memory id namespace')
  if (/[\u0000-\u001f\u007f]/.test(namespace)) {
    throw new TypeError('dsh-mywork: a beads memory id namespace may not contain control characters')
  }
  let next: number | undefined
  return async (): Promise<string> => {
    if (next === undefined) next = highestSequenceOf(await provider.records(), namespace)
    next += 1
    return `${namespace}-${next}`
  }
}

/** The highest `<namespace>-<n>` number a set of ids already holds, or 0. */
export function highestSequenceOf(records: readonly MemoryRecord[], namespace: string): number {
  const pattern = new RegExp(`^${namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`)
  let highest = 0
  for (const record of records) {
    const match = pattern.exec(record.id)
    if (match?.[1] === undefined) continue
    const value = Number.parseInt(match[1], 10)
    if (Number.isSafeInteger(value) && value > highest) highest = value
  }
  return highest
}

/**
 * The nearest `.beads` directory that is a workspace, at or above `start`.
 *
 * A workspace is marked by `metadata.json`; a bare `.beads` directory is not
 * one. `~/.beads` exists on a machine that has ever run `bd` and holds only
 * `machine-id` and `eventsData`, and `bd` refuses it — `bd where` there answers
 * "No active beads workspace found". Treating the directory's existence as
 * availability would report a backend that every call then fails against, which
 * is the opposite of what §49's health check is for.
 *
 * A filesystem walk, not `bd where`: `health` is asked before every fabric call,
 * and a process spawn there would cost more than the call it guards.
 * @param start - directory to begin at.
 */
export function findBeadsDir(start: string): string | undefined {
  let current = resolve(start)
  for (;;) {
    const candidate = join(current, '.beads')
    if (existsSync(join(candidate, 'metadata.json'))) return candidate
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/** The version token `bd --version` prints, e.g. `1.3.0`. */
export function parseBdVersion(output: string): string {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(output)
  return match?.[1] ?? firstLine(output)
}

/**
 * Whether two records carry the same content, so one may replace the other.
 *
 * Everything a record *is* is compared — statement, scope, kind, sources,
 * author, trust, confidence, validity, the records it supersedes, its revision,
 * its identity, and when it was retained. What is deliberately left out is the
 * lifecycle state: `status`, `statusChangedAt` and `reinforcedCount` are the only
 * fields a write is allowed to move under an existing id (§23.4 Reinforce /
 * Supersede).
 *
 * This is the rule the native provider applies, stated once here because a
 * provider may not depend on another provider's package. The two are held
 * together by a test that drives both through the same write matrix, so relaxing
 * it in one place fails the other's suite.
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

/** Why a value is not a usable record, or undefined when it is one. */
function recordProblem(record: unknown): string | undefined {
  if (record === null || typeof record !== 'object') return 'it carries no record'
  const candidate = record as Partial<MemoryRecord>
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return 'the record has no id'
  if (typeof candidate.statement !== 'string') return 'the record has no statement'
  if (typeof candidate.kind !== 'string' || candidate.kind.length === 0) return 'the record has no kind'
  if (typeof candidate.contentHash !== 'string' || candidate.contentHash.length === 0) {
    return 'the record has no content hash'
  }
  if (typeof candidate.fingerprint !== 'string' || candidate.fingerprint.length === 0) {
    return 'the record has no fingerprint'
  }
  if (!Number.isInteger(candidate.revision) || (candidate.revision ?? 0) < 1) {
    return 'the record has no positive revision'
  }
  const scope = candidate.scope
  if (scope === null || typeof scope !== 'object') return 'the record has no scope'
  if (typeof scope.type !== 'string' || scope.type.length === 0) return 'the record has no scope type'
  if (typeof scope.id !== 'string' || scope.id.length === 0) return 'the record has no scope id'
  return undefined
}

/** Validate and freeze one record the provider is asked to store. */
function requireRecord(record: MemoryRecord | undefined): MemoryRecord {
  if (record === null || typeof record !== 'object') {
    throw new TypeError('dsh-mywork: a memory provider needs a record')
  }
  const problem = recordProblem(record)
  if (problem !== undefined) throw new TypeError(`dsh-mywork: ${problem}`)
  return record
}

/** Validate one write mode. */
function requireMode(mode: unknown): 'create' | 'reinforce' | 'replace' {
  if (mode !== 'create' && mode !== 'reinforce' && mode !== 'replace') {
    throw new TypeError(`dsh-mywork: "${String(mode)}" is not a memory write mode`)
  }
  return mode
}

/** Validate the selectors of one retrieval. */
function requireScopes(
  scopes: readonly MemoryScopeRef[] | undefined,
  ids: readonly MemoryId[] | undefined,
): readonly MemoryScopeRef[] {
  if (ids !== undefined) {
    if (!Array.isArray(ids)) throw new TypeError('dsh-mywork: memory ids must be an array')
    return Object.freeze([])
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new TypeError('dsh-mywork: a memory retrieval needs scopes or ids')
  }
  return Object.freeze(
    scopes.map(scope => {
      if (scope === null || typeof scope !== 'object') {
        throw new TypeError('dsh-mywork: a memory scope must be an object')
      }
      requireText(scope.type, 'a memory scope type')
      requireText(scope.id, 'a memory scope id')
      return scope
    }),
  )
}

/** One value that has to be a non-empty string. */
function requireText(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`dsh-mywork: ${what} must be a non-empty string`)
  }
}

/** Human-readable form of a thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
