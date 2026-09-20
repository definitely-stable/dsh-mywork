/**
 * Adapter conformance kit (architecture §38, §39).
 *
 * Two layers, on purpose:
 *
 * - {@link runConformance} is the harness. It times every check with the
 *   injected clock, turns a throw into a `failed` result, a
 *   {@link skipConformance} into `skipped`, and reports which checks §39
 *   requires for the port but no check covers yet.
 * - Check builders. {@link commonAdapterChecks} is the registry contract every
 *   adapter of every port must satisfy; {@link agentRuntimeChecks} exercises the
 *   `AgentRuntimePort` contract. The per-port suites for the remaining §36 ports
 *   arrive with the card that binds the port (`taskgraph` in MW-010, `memory` in
 *   MW-019), which is why {@link REQUIRED_CONFORMANCE_CHECKS} already lists what
 *   they will have to cover.
 *
 * The kit never reports a check it did not run as a pass: a §39 check without an
 * implementation shows up in `missing`, and a check that cannot apply to a given
 * adapter reports `skipped` with its reason.
 * @module
 */

import type {
  AgentResumeRequest,
  AgentRunScope,
  AgentRuntimeHandle,
  AgentRuntimePort,
  AgentStartRequest,
  ClockPort,
  MyWorkErrorCode,
} from '@dsh-mywork/contracts'
import {
  ADAPTER_KINDS,
  supportedCapabilities,
  type AdapterKind,
} from './capabilities.ts'
import { nextContractMajor } from './contract-version.ts'
import {
  isAdapterError,
  isAdapterRefusal,
  type AdapterErrorCode,
} from './errors.ts'
import { portContractOf } from './port-contract.ts'
import {
  createAdapterRegistry,
  manifestOfRegistration,
  type AdapterRegistration,
  type AdapterRegistry,
} from './registry.ts'

/**
 * The checks §39 declares mandatory per port, in the order the architecture
 * lists them. Only the three ports §39 spells out are listed: the other §36
 * ports get their list with the card that implements them.
 */
export const REQUIRED_CONFORMANCE_CHECKS: Readonly<Partial<Record<AdapterKind, readonly string[]>>> =
  Object.freeze({
    memory: Object.freeze([
      'retain',
      'recall',
      'scope isolation',
      'idempotency',
      'timeouts',
      'cancellation',
      'invalid ref',
      'backend unavailable',
      'version mismatch',
    ]),
    taskgraph: Object.freeze([
      'ready correctness',
      'claim atomicity',
      'dependency cycles',
      'idempotency',
      'revision conflict',
      'cancel',
      'reopen',
    ]),
    'agent-runtime': Object.freeze([
      'create',
      'resume',
      'stop',
      'status',
      'late event',
      'cancellation',
      'process restart',
    ]),
  })

/** Capability name no manifest declares, used to probe an absent capability. */
export const CONFORMANCE_UNKNOWN_CAPABILITY = 'conformance-unknown-capability'

/** Outcome of one check. */
export type ConformanceStatus = 'passed' | 'failed' | 'skipped'

/** One executed check. */
export interface ConformanceResult {
  /** Check name, matching the suite and (where applicable) the §39 entry. */
  readonly name: string
  /** Outcome. */
  readonly status: ConformanceStatus
  /** Clock reading of the run, in milliseconds. */
  readonly durationMs: number
  /** Why a check failed or was skipped; absent for a pass. */
  readonly reason?: string
}

/** Report of one conformance run. */
export interface ConformanceReport {
  /** Port family the run covered. */
  readonly kind: AdapterKind
  /** Port interface name from §36, for diagnostics. */
  readonly port: string
  /** Adapter under test, when the caller knows it. */
  readonly adapterId?: string
  /** Contract revision under test, when the caller knows it. */
  readonly contractVersion?: string
  /** Every executed check, in suite order. */
  readonly results: readonly ConformanceResult[]
  /** Number of checks that passed. */
  readonly passed: number
  /** Number of checks that failed. */
  readonly failed: number
  /** Number of checks that did not apply. */
  readonly skipped: number
  /** §39 checks of this port that no executed check covers yet. */
  readonly missing: readonly string[]
}

/** One conformance check: it passes by resolving, fails by throwing. */
export interface ConformanceCheck {
  /** Check name; §39 names are used verbatim where the check implements one. */
  readonly name: string
  /** Run the check against the adapter. */
  run(): Promise<void>
}

/** Options accepted by {@link runConformance}. */
export interface ConformanceRunOptions {
  /** Port family under test. */
  readonly kind: AdapterKind
  /** The checks to run, in order. */
  readonly checks: readonly ConformanceCheck[]
  /** Time source; a `FakeClock` keeps a run deterministic. */
  readonly clock: ClockPort
  /** Adapter under test, for the report. */
  readonly adapterId?: string
  /** Contract revision under test, for the report. */
  readonly contractVersion?: string
}

/** Control-flow marker: a check reports itself as not applicable. */
export class ConformanceSkip extends Error {
  /** Why the check does not apply to this adapter. */
  readonly reason: string

  /**
   * @param reason - why the check does not apply.
   */
  constructor(reason: string) {
    super(`dsh-mywork: conformance check skipped: ${reason}`)
    this.name = 'ConformanceSkip'
    this.reason = reason
  }
}

/**
 * Report the current check as not applicable, with a reason.
 *
 * A check that silently returns would be counted as a pass; skipping is explicit
 * so the report never claims coverage it does not have.
 * @param reason - why the check does not apply to this adapter.
 */
export function skipConformance(reason: string): never {
  throw new ConformanceSkip(reason)
}

/** Fail a check when a condition does not hold. */
function expect(condition: boolean, what: string): void {
  if (!condition) throw new Error(`dsh-mywork: conformance: ${what}`)
}

/** Human-readable form of a failed check's error. */
function describeFailure(error: unknown): string {
  if (isAdapterRefusal(error)) return `${error.code}: ${error.message}`
  if (isAdapterError(error)) return `${error.name}(${error.code}): ${error.message}`
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/** Capability names a refusal reported as missing. */
function missingCapabilities(details: Readonly<Record<string, unknown>>): readonly string[] {
  const reported = details.missing
  if (!Array.isArray(reported)) return []
  return reported.filter((entry): entry is string => typeof entry === 'string')
}

/** Run a body that must be refused with a canonical §42 code. */
async function expectRefusal(
  body: () => unknown,
  code: MyWorkErrorCode,
  what: string,
): Promise<void> {
  try {
    await body()
  } catch (error) {
    if (isAdapterRefusal(error) && error.code === code) return
    throw new Error(`dsh-mywork: conformance: ${what}: expected ${code}, received ${describeFailure(error)}`)
  }
  throw new Error(`dsh-mywork: conformance: ${what}: expected ${code}, but the call succeeded`)
}

/** Run a body that must fail with an adapter-internal code. */
async function expectAdapterError(
  body: () => unknown,
  code: AdapterErrorCode,
  what: string,
): Promise<void> {
  try {
    await body()
  } catch (error) {
    if (isAdapterError(error) && error.code === code) return
    throw new Error(`dsh-mywork: conformance: ${what}: expected adapter error ${code}, received ${describeFailure(error)}`)
  }
  throw new Error(`dsh-mywork: conformance: ${what}: expected adapter error ${code}, but the call succeeded`)
}

/**
 * Run one suite of checks and report what it covered.
 * @param options - port, checks, and time source.
 */
export async function runConformance(options: ConformanceRunOptions): Promise<ConformanceReport> {
  const { kind, checks, clock } = options
  const results: ConformanceResult[] = []
  for (const check of checks) {
    const startedAt = clock.now()
    let status: ConformanceStatus = 'passed'
    let reason: string | undefined
    try {
      await check.run()
    } catch (error) {
      if (error instanceof ConformanceSkip) {
        status = 'skipped'
        reason = error.reason
      } else {
        status = 'failed'
        reason = describeFailure(error)
      }
    }
    const durationMs = Math.max(0, clock.now() - startedAt)
    results.push(reason === undefined ? { name: check.name, status, durationMs } : { name: check.name, status, durationMs, reason })
  }
  const covered = new Set(results.map(result => result.name))
  const missing = (REQUIRED_CONFORMANCE_CHECKS[kind] ?? []).filter(name => !covered.has(name))
  const port = portContractOf(kind)
  return Object.freeze({
    kind,
    port: port.port,
    ...(options.adapterId === undefined ? {} : { adapterId: options.adapterId }),
    ...(options.contractVersion === undefined ? {} : { contractVersion: options.contractVersion }),
    results: Object.freeze(results),
    passed: results.filter(result => result.status === 'passed').length,
    failed: results.filter(result => result.status === 'failed').length,
    skipped: results.filter(result => result.status === 'skipped').length,
    missing: Object.freeze(missing),
  })
}

/** Options accepted by {@link commonAdapterChecks}. */
export interface CommonAdapterChecksOptions<TPort, TContext> {
  /** The adapter declaration to put through the registry contract. */
  readonly registration: AdapterRegistration<TPort, TContext>
  /** Context passed to the registration's factory. */
  readonly context: TContext
}

/**
 * The registry contract checks every adapter must satisfy, whatever its port:
 * a compatible declaration is accepted, an incompatible revision, a duplicate
 * id, and a capability that is not declared are each refused with a canonical
 * §39/§42 code, discovery goes by declaration rather than by name, and the
 * registration is reversible.
 * @param options - the declaration under test and its context.
 * @returns the checks, each isolated in a fresh registry.
 * @throws {TypeError} when the declaration itself is malformed.
 */
export function commonAdapterChecks<TPort, TContext>(
  options: CommonAdapterChecksOptions<TPort, TContext>,
): readonly ConformanceCheck[] {
  const { registration, context } = options
  const manifest = manifestOfRegistration(registration)
  const supported = supportedCapabilities(manifest)
  const unsupported = Object.freeze(
    Object.entries(manifest.capabilities)
      .filter(([, declared]) => !declared)
      .map(([capability]) => capability),
  )
  const otherKind = ADAPTER_KINDS.find(kind => kind !== manifest.kind)
  const fresh = (): AdapterRegistry<TContext> => createAdapterRegistry<TContext>()

  return Object.freeze([
    {
      name: 'a compatible registration is accepted under its port contract',
      async run() {
        const registry = fresh()
        const handle = registry.register(registration, context)
        expect(Object.isFrozen(handle.manifest), 'the accepted manifest must be frozen')
        expect(registry.size === 1, 'the accepted adapter must be counted')
        expect(registry.list(manifest.kind).length === 1, 'the accepted adapter must be listed for its kind')
      },
    },
    {
      name: 'an incompatible contract revision is refused as CONTRACT_MISMATCH',
      async run() {
        const registry = fresh()
        const next = nextContractMajor(manifest.contractVersion)
        await expectRefusal(
          () => registry.register({ ...registration, contractVersion: next }, context),
          'CONTRACT_MISMATCH',
          `registering an adapter that declares "${next}"`,
        )
        expect(registry.size === 0, 'a refused registration must not be stored')
      },
    },
    {
      name: 'a duplicate registration is refused as TASK_CONFLICT',
      async run() {
        const registry = fresh()
        registry.register(registration, context)
        await expectRefusal(
          () => registry.register(registration, context),
          'TASK_CONFLICT',
          'registering the same adapter id twice',
        )
        expect(registry.size === 1, 'the first registration must survive the refusal')
      },
    },
    {
      name: 'discovery uses the declaration, not the adapter id',
      async run() {
        const registry = fresh()
        const renamed: AdapterRegistration<TPort, TContext> = { ...registration, id: `${manifest.adapterId}-renamed` }
        registry.register(renamed, context)
        const resolution = registry.resolve(manifest.kind, supported.length === 0 ? {} : { capabilities: supported })
        expect(resolution.ok, 'an adapter must be discovered by its declaration, whatever its id')
        if (resolution.ok) expect(resolution.manifest.adapterId === renamed.id, 'the resolved adapter must be the registered one')
      },
    },
    {
      name: 'a capability declared false is refused as CAPABILITY_UNSUPPORTED',
      async run() {
        if (unsupported.length === 0) skipConformance('the adapter declares no capability as false')
        const registry = fresh()
        registry.register(registration, context)
        const resolution = registry.resolve(manifest.kind, { capabilities: unsupported })
        expect(!resolution.ok, 'a required capability declared false must be refused')
        if (!resolution.ok) {
          expect(resolution.refusal.code === 'CAPABILITY_UNSUPPORTED', `the refusal must be CAPABILITY_UNSUPPORTED, received ${resolution.refusal.code}`)
          expect(
            unsupported.every(capability => missingCapabilities(resolution.refusal.details).includes(capability)),
            'the refusal must name the capability that is missing',
          )
        }
      },
    },
    {
      name: 'a capability that is not declared is refused as CAPABILITY_UNSUPPORTED',
      async run() {
        if (Object.hasOwn(manifest.capabilities, CONFORMANCE_UNKNOWN_CAPABILITY)) {
          skipConformance(`the adapter declares "${CONFORMANCE_UNKNOWN_CAPABILITY}", which the probe needs to be absent`)
        }
        const registry = fresh()
        registry.register(registration, context)
        const resolution = registry.resolve(manifest.kind, { capabilities: [CONFORMANCE_UNKNOWN_CAPABILITY] })
        expect(!resolution.ok, 'a capability the adapter never declared must be refused')
        if (!resolution.ok) {
          expect(resolution.refusal.code === 'CAPABILITY_UNSUPPORTED', `the refusal must be CAPABILITY_UNSUPPORTED, received ${resolution.refusal.code}`)
          expect(
            missingCapabilities(resolution.refusal.details).includes(CONFORMANCE_UNKNOWN_CAPABILITY),
            'the refusal must name the capability that is missing',
          )
        }
      },
    },
    {
      name: 'a port with no registered adapter is refused as ADAPTER_UNAVAILABLE',
      async run() {
        if (otherKind === undefined) skipConformance('no second port family exists to probe')
        const registry = fresh()
        const resolution = registry.resolve(otherKind ?? manifest.kind)
        expect(!resolution.ok, 'a port with no adapter must be refused')
        if (!resolution.ok) {
          expect(resolution.refusal.code === 'ADAPTER_UNAVAILABLE', `the refusal must be ADAPTER_UNAVAILABLE, received ${resolution.refusal.code}`)
        }
      },
    },
    {
      name: 'unregistration removes the adapter and is idempotent',
      async run() {
        const registry = fresh()
        const handle = registry.register(registration, context)
        expect(handle.unregister() === true, 'the first unregister must remove the adapter')
        expect(registry.size === 0, 'the registry must be empty after unregistration')
        const resolution = registry.resolve(manifest.kind)
        expect(!resolution.ok && resolution.refusal.code === 'ADAPTER_UNAVAILABLE', 'a removed adapter must not be resolvable')
        expect(handle.unregister() === false, 'unregistering again must report that nothing was removed')
      },
    },
  ])
}

/** Options accepted by {@link agentRuntimeChecks}. */
export interface AgentRuntimeChecksOptions {
  /** Runtime under test. */
  readonly runtime: AgentRuntimePort
  /** Prefix for the run ids the checks create; distinct suites must not collide. */
  readonly runIdPrefix?: string
  /**
   * Scope the checks assert, when the deployment has one to offer. Absent runs
   * the suite against the deployment's own defaults, which is what a conformance
   * run against a real platform has to do: a check may not require a deployment
   * to know a preset or a route invented here.
   */
  readonly scope?: AgentRunScope
  /**
   * Build a runtime that drives the same durable owner while holding no process
   * state — a process restart. Without it the `process restart` check reports
   * itself skipped instead of passing on a property nothing tested.
   */
  readonly reopen?: () => AgentRuntimePort
}

/**
 * The `AgentRuntimePort` checks §39 declares: `create`, `resume`, `stop`,
 * `status`, `late event`, `cancellation`, and `process restart`, plus the
 * duplicate-run refusal the port's own contract states.
 *
 * What the suite can prove through the port alone is proved here; what needs the
 * platform's own vocabulary stays with the adapter that speaks it. So `status`
 * asserts the owner's answer rather than the scope a caller asked for, and
 * `process restart` needs {@link AgentRuntimeChecksOptions.reopen} to say what a
 * restart is for this deployment.
 * @param options - the runtime under test, its scope, and its restart hook.
 */
export function agentRuntimeChecks(options: AgentRuntimeChecksOptions): readonly ConformanceCheck[] {
  const runtime = options.runtime
  const prefix = options.runIdPrefix ?? 'conformance'
  const scope = options.scope
  const request = (runId: string): AgentStartRequest => ({
    runId,
    workspacePath: '/conformance',
    prompt: 'conformance probe',
    ...(scope === undefined ? {} : { scope }),
  })
  const resumeOf = (runId: string, sessionId: string): AgentResumeRequest => ({
    runId,
    sessionId,
    workspacePath: '/conformance',
    ...(scope === undefined ? {} : { scope }),
  })

  return Object.freeze([
    {
      name: 'create',
      async run() {
        const runId = `${prefix}-create`
        const handle = await runtime.start(request(runId))
        expect(handle.runId === runId, 'start must return a handle for the requested run')
        expect(
          typeof handle.sessionId === 'string' && handle.sessionId.length > 0,
          'start must report the real session identity its owner minted',
        )
        const status = await runtime.status(handle)
        expect(status.running === true, 'a started run must report itself as running')
        expect(status.sessionId === handle.sessionId, 'status must answer for the session the handle names')
      },
    },
    {
      name: 'create refuses a duplicate run',
      async run() {
        const runId = `${prefix}-duplicate`
        await runtime.start(request(runId))
        await expectAdapterError(() => runtime.start(request(runId)), 'conflict', 'starting the same run id twice')
      },
    },
    {
      name: 'resume',
      async run() {
        const runId = `${prefix}-resume`
        const handle = await runtime.start(request(runId))
        // A run that already settled is the case resume exists for: the session
        // outlives the turn, so the record is adopted, not recreated.
        await runtime.stop(handle)
        const resumed = await runtime.resume(resumeOf(runId, handle.sessionId))
        expect(resumed.sessionId === handle.sessionId, 'resume must adopt the session the caller named, not mint another')
        const status = await runtime.status(resumed)
        expect(status.sessionId === handle.sessionId, 'a resumed run must stay addressable by its session identity')
        await expectAdapterError(
          () => runtime.resume(resumeOf(runId, `${prefix}-absent-session`)),
          'invalid-ref',
          'resuming a session the owner does not know',
        )
      },
    },
    {
      name: 'stop',
      async run() {
        const runId = `${prefix}-stop`
        const handle = await runtime.start(request(runId))
        await runtime.stop(handle)
        await runtime.stop(handle)
        const status = await runtime.status(handle)
        expect(status.runId === handle.runId, 'status must answer for the run that was stopped')
        expect(status.running === false, 'stop must settle the run')
        // Stop is not destruction (§51, MW-001 §6.8): the session stays durable
        // evidence, so the very same identity can be adopted again afterwards.
        const resumed = await runtime.resume(resumeOf(runId, handle.sessionId))
        expect(resumed.sessionId === handle.sessionId, 'stop must not destroy the session record')
      },
    },
    {
      name: 'status',
      async run() {
        const unknown: AgentRuntimeHandle = {
          runId: `${prefix}-unknown`,
          sessionId: `${prefix}-unknown-session`,
        }
        await expectAdapterError(() => runtime.status(unknown), 'invalid-ref', 'reading an unknown run')
        const handle = await runtime.start(request(`${prefix}-status`))
        await runtime.stop(handle)
        const status = await runtime.status(handle)
        expect(status.running === false, 'a settled run must report itself as not running')
        expect(status.sessionId === handle.sessionId, 'status must report the session it answered for')
      },
    },
    {
      name: 'late event',
      async run() {
        const handle = await runtime.start(request(`${prefix}-late-event`))
        const first = await runtime.events(handle)
        expect(first.events.length > 0, 'a started run must have admitted at least one durable event')
        expect(first.cursor > 0, 'a read that returned events must report a cursor past them')
        const positions = first.events.map(event => event.seq)
        expect(
          positions.every((seq, index) => index === 0 || seq > (positions[index - 1] ?? 0)),
          'a page must be ordered by ascending position and carry no duplicate',
        )
        const repeat = await runtime.events(handle, first.cursor)
        expect(repeat.events.length === 0, 'a page must not repeat an event the caller already has')
        await runtime.stop(handle)
        // A late event arrives after the run settled. It must neither resurrect
        // the run nor be read twice, and it must never pull the cursor back.
        const afterSettle = await runtime.events(handle, first.cursor)
        const again = await runtime.events(handle, afterSettle.cursor)
        expect(again.events.length === 0, 'a repeated read must not report a position twice')
        expect(afterSettle.cursor >= first.cursor, 'a cursor must never move backwards')
        expect((await runtime.status(handle)).running === false, 'reading events must not restart a settled run')
        const ahead = await runtime.events(handle, afterSettle.cursor + 1_000)
        expect(ahead.events.length === 0, 'a cursor ahead of the log must report no events')
        expect(ahead.cursor >= afterSettle.cursor, 'a cursor ahead of the log must not move backwards either')
      },
    },
    {
      name: 'cancellation',
      async run() {
        const aborted = AbortSignal.abort()
        const runId = `${prefix}-cancellation`
        await expectAdapterError(
          () => runtime.start(request(runId), { signal: aborted }),
          'cancelled',
          'starting with an aborted signal',
        )
        // The refusal happened before the owner was touched: the run id is free.
        const handle = await runtime.start(request(runId))
        const before = await runtime.status(handle)
        await expectAdapterError(() => runtime.status(handle, { signal: aborted }), 'cancelled', 'reading with an aborted signal')
        await expectAdapterError(
          () => runtime.events(handle, undefined, { signal: aborted }),
          'cancelled',
          'reading events with an aborted signal',
        )
        await expectAdapterError(() => runtime.stop(handle, { signal: aborted }), 'cancelled', 'stopping with an aborted signal')
        expect(
          (await runtime.status(handle)).running === before.running,
          'a cancelled stop must not settle the run',
        )
      },
    },
    {
      name: 'process restart',
      async run() {
        const reopen = options.reopen
        if (reopen === undefined) {
          skipConformance('the caller supplied no runtime over the same durable owner, so no restart can be simulated')
        }
        const runId = `${prefix}-restart`
        const handle = await runtime.start(request(runId))
        await runtime.stop(handle)
        const before = await runtime.events(handle)
        const restarted = reopen()
        const status = await restarted.status(handle)
        expect(status.sessionId === handle.sessionId, 'a restarted runtime must answer for the session its owner still holds')
        expect(status.running === false, 'a restarted runtime must read the owner state, not invent a running run')
        const resumed = await restarted.resume(resumeOf(runId, handle.sessionId))
        expect(resumed.sessionId === handle.sessionId, 'a restarted runtime must adopt the same session')
        // The log is the durable evidence, so the restarted runtime has to read
        // the same one: every position the caller has already seen must still be
        // there, and nothing at or below its cursor may be reported again.
        const reread = await restarted.events(resumed)
        expect(
          before.events.every(seen => reread.events.some(event => event.seq === seen.seq && event.type === seen.type)),
          'a restarted runtime must read the same durable log, not an empty one',
        )
        const after = await restarted.events(resumed, before.cursor)
        expect(
          after.events.every(event => event.seq > before.cursor),
          'a restarted runtime must not report a position the caller already has',
        )
        expect(after.cursor >= before.cursor, 'the cursor must survive a restart')
      },
    },
  ])
}
