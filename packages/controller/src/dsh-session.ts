/**
 * DSH session and agent-runtime binding (architecture §21, §22, §29, §31, §36,
 * §39, §62 items 7 and 22).
 *
 * Three live DSH Cordis services are the whole platform surface this module
 * touches, and each is described structurally rather than imported — the
 * published bundle keeps DSH out of its build graph, exactly as the model
 * catalog binding does:
 *
 * - `sessionController` owns sessions: `create` (fresh or idempotent adoption of
 *   an explicit identity), `list` (the roster, with `running`), `selectModel`
 *   (which returns the route the deployment *resolved*, not the one we asked
 *   for), `prompt`, `cancel`, and the `follow` stream that opens a session log.
 * - `agents` resolves a session id to the live agent a command needs.
 * - `commands` executes one slash-command line without sending it to a model.
 *
 * Scoping a run is a platform decision with one honest answer: an agent preset
 * owns the system prompt, the dynamic context, and the tool surface of every
 * session composed under it (§21; the MW-001 capability check found no
 * per-session tool allow-list to set instead), so the preset travels as
 * `agentPreset` on session creation. The route is pinned with `selectModel` and
 * the permission policy with the `/permission` command — the same sequence the
 * production task board uses on this machine.
 *
 * Stop means stop the work (§51, MW-001 §6.8): the active turn is cancelled and
 * the session is left in place as durable evidence. Nothing here disposes a
 * session.
 *
 * A refusal says why it refused. Both ports answer with the adapter's transport
 * codes — unchanged, because callers already branch on them — and every refusal
 * that is about a session additionally names one of the four
 * `SessionRefusalReason` causes of the contract (§22, §36, §42). That is what
 * keeps "this session is gone", "this session is not live", "this scope
 * contradicts the record", and "this deployment cannot serve the call" from
 * being four spellings of the same word (MW-015 P21).
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  AdapterError,
  portContractVersion,
  type AdapterErrorCode,
  type MyWorkAdapters,
} from '@dsh-mywork/adapter-sdk'
import {
  SESSION_REFUSAL_CODES,
  type AgentCallOptions,
  type AgentEventOptions,
  type AgentModelSelection,
  type AgentResumeRequest,
  type AgentRunScope,
  type AgentRuntimeHandle,
  type AgentRuntimePort,
  type AgentRuntimeStatus,
  type AgentStartRequest,
  type HarnessPolicy,
  type MyWorkErrorCode,
  type SessionCreateRequest,
  type SessionDescription,
  type SessionEvent,
  type SessionEventPage,
  type SessionId,
  type SessionPort,
  type SessionRefusalReason,
} from '@dsh-mywork/contracts'

/** Cordis service name of the DSH session controller. */
export const DSH_SESSION_SERVICE = 'sessionController'

/** Cordis service name of the DSH agent registry. */
export const DSH_AGENTS_SERVICE = 'agents'

/** Cordis service name of the DSH command runtime. */
export const DSH_COMMANDS_SERVICE = 'commands'

/** Adapter id the session binding registers in `myworkAdapters`. */
export const DSH_SESSION_ADAPTER_ID = 'dsh-session'

/** Adapter id the agent-runtime binding registers in `myworkAdapters`. */
export const DSH_AGENT_RUNTIME_ADAPTER_ID = 'dsh-agent-runtime'

/** Port family of the session binding. */
export const DSH_SESSION_KIND = 'session'

/** Port family of the agent-runtime binding. */
export const DSH_AGENT_RUNTIME_KIND = 'agent-runtime'

/**
 * Capabilities the agent-runtime binding declares (§37).
 *
 * Every flag is a platform fact, not an aspiration: sessions are created and
 * adopted by identity, their roster reports `running`, their log is read by
 * cursor, an active turn is cancelled without disposing the record, and a run is
 * scoped by preset, model route, and permission policy.
 */
export const DSH_AGENT_RUNTIME_CAPABILITIES: Readonly<Record<string, boolean>> = Object.freeze({
  create: true,
  resume: true,
  stop: true,
  status: true,
  events: true,
  modelSelection: true,
  scopedPrompt: true,
  scopedTools: true,
  scopedPermission: true,
  processRestart: true,
})

/**
 * Capabilities the session binding declares (§37).
 *
 * Deliberately narrower than the runtime's: `SessionPort` is the record surface
 * (create or adopt, read the log, stop the work) and offers no run control, no
 * scope, and no model selection. A caller that requires one of those of the
 * `session` port must be refused rather than answered by an adapter that
 * happens to serve both families.
 */
export const DSH_SESSION_CAPABILITIES: Readonly<Record<string, boolean>> = Object.freeze({
  create: true,
  events: true,
  cancel: true,
  processRestart: true,
})

/** One session roster row, as the DSH session controller reports it. */
export interface DshSessionSummary {
  readonly sessionId: string
  readonly running: boolean
}

/** One exact route as DSH resolved it (§29). */
export interface DshModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Durable address of one session log. */
export interface DshSessionAddress {
  readonly kind: 'session'
  readonly sessionId: string
}

/** One durable session event, without its payload. */
export interface DshWireEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
}

/** One logical session header carried by a `follow` opening frame. */
export interface DshWireHeader {
  readonly id: string
  readonly agentPreset?: string
}

/** Opening frame of a `follow` stream: the visible window of the session log. */
export interface DshFollowSnapshot {
  readonly type: 'snapshot'
  readonly header: DshWireHeader
  /** Last committed position of the log, which is the cursor the snapshot is complete up to. */
  readonly cursor: number
  readonly records: readonly { readonly event: DshWireEvent }[]
  readonly hasMore: boolean
}

/** Any other frame the stream may carry; this binding closes after the opening one. */
export interface DshFollowOtherFrame {
  readonly type: 'event' | 'assistant-stream'
}

/** One frame of the `follow` stream. */
export type DshFollowFrame = DshFollowSnapshot | DshFollowOtherFrame

/**
 * The part of the DSH session controller this binding uses.
 *
 * Names and shapes are the controller's own — `create`, `list`, `selectModel`,
 * `prompt`, `cancel`, `follow` and their request fields
 * (`packages/api/session-controller/src/index.ts`) — so the wrapper is a rename
 * rather than a translation, and a platform change surfaces here as a type error
 * or as a loud refusal rather than as a silent no-op.
 */
export interface DshSessionController {
  /** Create a session, or idempotently adopt the one `sessionId` names. */
  create(request: {
    readonly cwd?: string
    readonly sessionId?: string
    readonly agentPreset?: string
  }): Promise<{ readonly sessionId: string; readonly agentPreset?: string }>
  /**
   * Read every visible session, including the ones no live agent serves.
   *
   * The signal is not decoration: the controller's own `list` and `prompt`
   * dereference it, so an in-process caller that omits it gets a `TypeError`
   * instead of a session. Both are therefore always passed one.
   */
  list(
    request: { readonly cursor?: string },
    signal: AbortSignal,
  ): Promise<{ readonly items: readonly DshSessionSummary[] }>
  /** Resolve and install one session-local route. */
  selectModel(request: {
    readonly sessionId: string
    readonly provider?: string
    readonly model: string
    readonly reasoningEffort?: string
  }): Promise<{ readonly selected: DshModelSelection }>
  /** Admit one prompt into the session's agent. */
  prompt(
    request: {
      readonly requestId: string
      readonly sessionId: string
      readonly mode: 'queue' | 'steer'
      readonly content: readonly { readonly type: 'text'; readonly text: string }[]
    },
    signal: AbortSignal,
  ): Promise<{ readonly accepted: true }>
  /**
   * Cancel the session's active turn, keeping its pending inbox. The controller
   * answers synchronously; the union keeps the structural description honest
   * about that while every caller here awaits the result either way.
   */
  cancel(request: { readonly sessionId: string }): { readonly accepted: true } | Promise<{ readonly accepted: true }>
  /** Open the session log: a complete opening snapshot, then live frames. */
  follow(
    request: { readonly address: DshSessionAddress; readonly maxMessages?: number },
    signal: AbortSignal,
  ): AsyncIterable<DshFollowFrame>
}

/** One live agent, as far as a command needs to address it. */
export interface DshAgent {
  readonly session: { readonly id: string }
}

/** The part of the DSH agent registry this binding uses. */
export interface DshAgentRegistry {
  /** The live agent serving one session, or undefined when no agent is attached. */
  get(sessionId: string): DshAgent | undefined
}

/** One settled command, as the DSH command runtime reports it. */
export interface DshCommandExecution {
  readonly result: { readonly kind: string; readonly text?: string }
}

/** The part of the DSH command runtime this binding uses. */
export interface DshCommandRuntime {
  /** Parse and execute one slash-command line without sending it to a model. */
  execute(
    agent: DshAgent,
    line: string,
    attachments: readonly unknown[],
    signal: AbortSignal,
  ): Promise<DshCommandExecution | undefined>
}

/** The live DSH services one binding drives. */
export interface DshSessionApi {
  /** The session controller. */
  readonly controller: DshSessionController
  /** The agent registry; absent when the profile mounts none. */
  readonly agents?: DshAgentRegistry
  /** The command runtime; absent when the profile mounts none. */
  readonly commands?: DshCommandRuntime
  /** Mints the identity DSH stores on the accepted prompt message. */
  readonly mintRequestId?: () => string
}

/**
 * The signal passed to a platform call the caller did not want to cancel.
 *
 * It is shared and never aborted on purpose: the controller's `list` and
 * `prompt` dereference the signal they are given, so "no caller cancellation"
 * has to be expressed as a real signal rather than as an absent argument.
 */
const NEVER_ABORTED = new AbortController().signal

/** Prefix every prompt identity this binding mints carries. */
export const DSH_REQUEST_ID_PREFIX = 'dsh-mywork-'

/**
 * The adapter code each refusal keeps.
 *
 * An {@link AdapterErrorCode} describes *how* a call failed — unreachable,
 * unknown reference, conflicting state — which is a transport fact and not a
 * cause. Four different session causes share `unavailable`, so the cause
 * travels beside the code instead of replacing it, and every code below is the
 * one this binding raised before the reasons existed: a caller that already
 * branched on the transport code keeps branching the same way.
 */
const ADAPTER_CODE_OF_REFUSAL: Readonly<Record<SessionRefusalReason, AdapterErrorCode>> = Object.freeze({
  'session-missing': 'invalid-ref',
  'session-not-live': 'unavailable',
  'session-scope-mismatch': 'conflict',
  'runtime-unavailable': 'unavailable',
})

/**
 * A refusal of the DSH binding that names *why* it refused (§36, §39, §42).
 *
 * The transport code answers "how did the call fail" and cannot answer "what is
 * wrong": a caller that has to decide between retrying, resuming, and reporting
 * an outage must not read "this session is gone" and "this deployment is down"
 * as the same answer. The reason travels as data beside the code, together with
 * the canonical §42 code it maps to, so nothing is inferred from the message.
 *
 * The subclass deliberately keeps the base class's name: the SDK recognises an
 * adapter error across a bundle boundary by name plus code
 * (`AdapterError[Symbol.hasInstance]`), and a class that renamed itself would
 * stop being recognised by a caller holding another copy of the SDK.
 */
export class DshSessionRefusal extends AdapterError {
  /** Why the binding refused, from the closed vocabulary of the contract. */
  readonly reason: SessionRefusalReason

  /** Canonical §42 code the reason maps to; see `SESSION_REFUSAL_CODES`. */
  readonly refusalCode: MyWorkErrorCode

  /**
   * @param reason - the cause, as the contract names it.
   * @param message - human-readable detail; never parsed by callers.
   * @param options - optional underlying platform failure.
   */
  constructor(reason: SessionRefusalReason, message: string, options: { cause?: unknown } = {}) {
    super(ADAPTER_CODE_OF_REFUSAL[reason], message, options)
    this.reason = reason
    this.refusalCode = SESSION_REFUSAL_CODES[reason]
  }
}

/**
 * The DSH session adapter: the record surface of §36 over the live controller.
 */
export class DshSessionAdapter implements SessionPort {
  readonly #api: DshSessionApi

  /**
   * @param api - the live DSH services to drive.
   */
  constructor(api: DshSessionApi) {
    this.#api = api
  }

  /**
   * Create a session, or adopt the durable one an explicit identity names.
   * @param request - workspace, optional preset, optional explicit identity.
   * @param options - caller-owned cancellation.
   * @throws {AdapterError} `cancelled` for an aborted call, `conflict` for a
   *   workspace or preset contradiction, `unavailable` when the controller refuses.
   */
  async create(request: SessionCreateRequest, options: AgentCallOptions = {}): Promise<SessionDescription> {
    refuseIfAborted(options.signal, 'creating a session')
    return await this.#create(request, options.signal)
  }

  /**
   * Read the session log after a cursor.
   *
   * The log is opened through `follow`, whose first frame is the complete
   * visible window; the stream is closed immediately after it, so a read costs
   * one frame and never subscribes the caller to live traffic.
   * @param sessionId - real session identity.
   * @param cursor - last position the caller has seen; absent reads from the beginning.
   * @param options - caller-owned cancellation and the page bound.
   * @throws {AdapterError} `cancelled` for an aborted call, `invalid-ref` when the
   *   session does not exist, `unavailable` when the platform cannot serve the read.
   */
  async events(
    sessionId: SessionId,
    cursor = 0,
    options: AgentEventOptions = {},
  ): Promise<SessionEventPage> {
    refuseIfAborted(options.signal, `reading the log of session "${sessionId}"`)
    return await this.#events(sessionId, cursor, options)
  }

  /**
   * Cancel the session's active turn. The session is never disposed: it stays
   * durable evidence (§51, MW-001 §6.8).
   * @param sessionId - real session identity.
   * @param options - caller-owned cancellation.
   * @throws {AdapterError} `cancelled` for an aborted call, `invalid-ref` when the
   *   session does not exist, `unavailable` when the platform refuses.
   */
  async cancel(sessionId: SessionId, options: AgentCallOptions = {}): Promise<void> {
    refuseIfAborted(options.signal, `cancelling session "${sessionId}"`)
    const exists = await this.#sessionExists(sessionId, options.signal)
    if (!exists) {
      throw new DshSessionRefusal('session-missing', `dsh-mywork: session "${sessionId}" does not exist`)
    }
    try {
      await this.#api.controller.cancel({ sessionId })
    } catch (error) {
      // The roster just proved the session is durable, so `session/not-found`
      // here means the controller serves no live agent for it: a session whose
      // process went away has no running work, and stop is idempotent for
      // exactly that state (§39 "process restart"). Nothing was disposed.
      if (dshErrorCode(error) === 'session/not-found') return
      throw mapDshFailure(error, `cancelling session "${sessionId}"`)
    }
  }

  /** Create or adopt one session through the controller. */
  async #create(
    request: SessionCreateRequest,
    signal: AbortSignal | undefined,
  ): Promise<SessionDescription> {
    try {
      const created = await this.#api.controller.create({
        cwd: request.workspacePath,
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
      })
      return {
        sessionId: created.sessionId,
        ...(created.agentPreset === undefined ? {} : { agentPreset: created.agentPreset }),
      }
    } catch (error) {
      if (signal?.aborted === true) throw cancelled(`creating a session in "${request.workspacePath}"`)
      throw mapDshFailure(error, `creating a session in "${request.workspacePath}"`)
    }
  }

  /** Read one opening snapshot of the session log and normalise it. */
  async #events(
    sessionId: SessionId,
    cursor: number,
    options: AgentEventOptions,
  ): Promise<SessionEventPage> {
    const controller = new AbortController()
    const signal = options.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, options.signal])
    let iterator: AsyncIterator<DshFollowFrame> | undefined
    let opening: DshFollowFrame
    try {
      // The call itself stays inside the guard: an implementation that validates
      // eagerly throws here, and a raw platform error must not reach the caller.
      iterator = this.#api.controller.follow(
        {
          address: { kind: 'session', sessionId },
          ...(options.maxEvents === undefined ? {} : { maxMessages: options.maxEvents }),
        },
        signal,
      )[Symbol.asyncIterator]()
      const first = await iterator.next()
      if (first.done === true) {
        throw new DshSessionRefusal(
          'runtime-unavailable',
          `dsh-mywork: the session log of "${sessionId}" opened with no frame`,
        )
      }
      opening = first.value
    } catch (error) {
      if (options.signal?.aborted === true) throw cancelled(`reading the log of session "${sessionId}"`)
      if (error instanceof AdapterError) throw error
      throw mapDshFailure(error, `reading the log of session "${sessionId}"`)
    } finally {
      // The opening frame is the whole read: release the stream either way.
      controller.abort()
      await iterator?.return?.(undefined)
    }
    if (opening.type !== 'snapshot') {
      throw new DshSessionRefusal(
        'runtime-unavailable',
        `dsh-mywork: the session log of "${sessionId}" opened with a "${opening.type}" frame instead of a snapshot`,
      )
    }
    return pageOf(opening, cursor)
  }

  /** Whether the roster knows one session, which is what makes it durable. */
  async #sessionExists(sessionId: SessionId, signal: AbortSignal | undefined): Promise<boolean> {
    try {
      const roster = await this.#api.controller.list({}, signal ?? NEVER_ABORTED)
      return roster.items.some(item => item.sessionId === sessionId)
    } catch (error) {
      if (signal?.aborted === true) throw cancelled(`reading the session roster for "${sessionId}"`)
      throw mapDshFailure(error, `reading the session roster for "${sessionId}"`)
    }
  }
}

/**
 * The DSH agent-runtime adapter: one attempt's run over a scoped session.
 */
export class DshAgentRuntime implements AgentRuntimePort {
  readonly #sessions: DshSessionAdapter
  readonly #api: DshSessionApi

  /**
   * @param api - the live DSH services to drive.
   */
  constructor(api: DshSessionApi) {
    this.#api = api
    this.#sessions = new DshSessionAdapter(api)
  }

  /** The session record surface this runtime drives. */
  get sessions(): SessionPort {
    return this.#sessions
  }

  /**
   * Create the session, apply the scope, and admit the prompt.
   * @param request - run identity, workspace, prompt, and scope.
   * @param options - caller-owned cancellation.
   * @throws {AdapterError} `cancelled` for an aborted call, `conflict` for a
   *   duplicate session, `unavailable` when a scope cannot be applied at all.
   */
  async start(request: AgentStartRequest, options: AgentCallOptions = {}): Promise<AgentRuntimeHandle> {
    refuseIfAborted(options.signal, `starting run "${request.runId}"`)
    const session = await this.#sessions.create(
      {
        workspacePath: request.workspacePath,
        ...(request.scope === undefined ? {} : { agentPreset: request.scope.agentPreset }),
      },
      options,
    )
    const route = await this.#assertScope(session.sessionId, request.scope, options.signal)
    await this.#prompt(session.sessionId, request.prompt, options.signal)
    return {
      runId: request.runId,
      sessionId: session.sessionId,
      ...(route === undefined ? {} : { route }),
    }
  }

  /**
   * Adopt the session a previous run used and re-assert its scope.
   * @param request - run identity, real session identity, workspace, and scope.
   * @param options - caller-owned cancellation.
   * @throws {AdapterError} `cancelled` for an aborted call, `invalid-ref` for an
   *   unknown session, `conflict` when the workspace contradicts the record.
   */
  async resume(request: AgentResumeRequest, options: AgentCallOptions = {}): Promise<AgentRuntimeHandle> {
    refuseIfAborted(options.signal, `resuming run "${request.runId}"`)
    const session = await this.#sessions.create(
      {
        workspacePath: request.workspacePath,
        sessionId: request.sessionId,
        ...(request.scope === undefined ? {} : { agentPreset: request.scope.agentPreset }),
      },
      options,
    )
    const route = await this.#assertScope(session.sessionId, request.scope, options.signal)
    return {
      runId: request.runId,
      sessionId: session.sessionId,
      ...(route === undefined ? {} : { route }),
    }
  }

  /**
   * Read the run's state from the session roster.
   * @param handle - handle returned by {@link start} or {@link resume}.
   * @param options - caller-owned cancellation.
   * @throws {AdapterError} `cancelled` for an aborted call, `invalid-ref` when the
   *   session does not exist, `unavailable` when the roster cannot be read.
   */
  async status(handle: AgentRuntimeHandle, options: AgentCallOptions = {}): Promise<AgentRuntimeStatus> {
    refuseIfAborted(options.signal, `reading run "${handle.runId}"`)
    try {
      const roster = await this.#api.controller.list({}, options.signal ?? NEVER_ABORTED)
      const found = roster.items.find(item => item.sessionId === handle.sessionId)
      if (found === undefined) {
        throw new DshSessionRefusal(
          'session-missing',
          `dsh-mywork: session "${handle.sessionId}" of run "${handle.runId}" does not exist`,
        )
      }
      return { runId: handle.runId, sessionId: found.sessionId, running: found.running }
    } catch (error) {
      if (options.signal?.aborted === true) throw cancelled(`reading run "${handle.runId}"`)
      if (error instanceof AdapterError) throw error
      throw mapDshFailure(error, `reading run "${handle.runId}"`)
    }
  }

  /**
   * Stop the run's work; idempotent, and never destructive.
   * @param handle - handle returned by {@link start} or {@link resume}.
   * @param options - caller-owned cancellation.
   * @throws {AdapterError} `cancelled` for an aborted call, `invalid-ref` when the
   *   session does not exist.
   */
  async stop(handle: AgentRuntimeHandle, options: AgentCallOptions = {}): Promise<void> {
    refuseIfAborted(options.signal, `stopping run "${handle.runId}"`)
    await this.#sessions.cancel(handle.sessionId, options)
  }

  /**
   * Read the run's durable events after a cursor.
   * @param handle - handle returned by {@link start} or {@link resume}.
   * @param cursor - last position the caller has seen; absent reads from the beginning.
   * @param options - caller-owned cancellation and the page bound.
   */
  async events(
    handle: AgentRuntimeHandle,
    cursor = 0,
    options: AgentEventOptions = {},
  ): Promise<SessionEventPage> {
    refuseIfAborted(options.signal, `reading events of run "${handle.runId}"`)
    return await this.#sessions.events(handle.sessionId, cursor, options)
  }

  /**
   * Apply the scope to a session: preset (already carried by creation), the model
   * route, and the permission policy. Nothing is assumed: a scope the deployment
   * cannot apply fails the call instead of starting an unscoped run.
   * @param sessionId - session to scope.
   * @param scope - scope the caller stated, when it stated one.
   * @param signal - caller-owned cancellation.
   * @returns the route the deployment resolved, when one was pinned.
   */
  async #assertScope(
    sessionId: SessionId,
    scope: AgentRunScope | undefined,
    signal: AbortSignal | undefined,
  ): Promise<AgentModelSelection | undefined> {
    if (scope === undefined) return undefined
    let route: AgentModelSelection | undefined
    if (scope.model !== undefined) {
      try {
        const selected = await this.#api.controller.selectModel({
          sessionId,
          ...(scope.model.reasoningEffort === undefined ? {} : { reasoningEffort: scope.model.reasoningEffort }),
          provider: scope.model.provider,
          model: scope.model.model,
        })
        route = selected.selected
      } catch (error) {
        if (signal?.aborted === true) throw cancelled(`pinning the route of session "${sessionId}"`)
        throw mapDshFailure(error, `pinning the route of session "${sessionId}"`)
      }
    }
    if (scope.permission !== undefined) {
      await this.#pinPermission(sessionId, scope.permission, signal)
    }
    return route
  }

  /**
   * Pin the runtime-enforced permission policy of §31 with the platform's own
   * `/permission` command.
   * @param sessionId - session to pin.
   * @param permission - policy to install.
   * @param signal - caller-owned cancellation.
   * @throws {AdapterError} `cancelled` for an aborted call; otherwise a
   *   {@link DshSessionRefusal} naming `session-not-live` when this profile
   *   serves no live agent for the session, and `runtime-unavailable` when it
   *   serves no agent registry, no command runtime, no `/permission` command, or
   *   a command that refuses the policy.
   */
  async #pinPermission(
    sessionId: SessionId,
    permission: HarnessPolicy,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const agents = this.#api.agents
    const commands = this.#api.commands
    if (agents === undefined || commands === undefined) {
      throw new DshSessionRefusal(
        'runtime-unavailable',
        `dsh-mywork: session "${sessionId}" cannot be pinned to ${permission}: this profile serves no agent registry or command runtime`,
      )
    }
    const agent = agents.get(sessionId)
    if (agent === undefined) {
      throw new DshSessionRefusal(
        'session-not-live',
        `dsh-mywork: session "${sessionId}" has no live agent, so its permission policy cannot be pinned`,
      )
    }
    let execution: DshCommandExecution | undefined
    try {
      execution = await commands.execute(agent, `/permission ${permission}`, [], signal ?? NEVER_ABORTED)
    } catch (error) {
      if (signal?.aborted === true) throw cancelled(`pinning the permission policy of session "${sessionId}"`)
      throw mapDshFailure(error, `pinning the permission policy of session "${sessionId}"`)
    }
    if (execution === undefined) {
      throw new DshSessionRefusal(
        'runtime-unavailable',
        `dsh-mywork: this deployment has no /permission command, so session "${sessionId}" was not pinned to ${permission}`,
      )
    }
    if (execution.result.kind !== 'success') {
      throw new DshSessionRefusal(
        'runtime-unavailable',
        `dsh-mywork: session "${sessionId}" was not pinned to ${permission}: ${execution.result.text ?? 'the command refused'}`,
      )
    }
  }

  /** Admit one prompt, minting the identity the platform stores on the message. */
  async #prompt(sessionId: SessionId, prompt: string, signal: AbortSignal | undefined): Promise<void> {
    const mint = this.#api.mintRequestId ?? defaultRequestId
    try {
      await this.#api.controller.prompt(
        {
          requestId: mint(),
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: prompt }],
        },
        signal ?? NEVER_ABORTED,
      )
    } catch (error) {
      if (signal?.aborted === true) throw cancelled(`prompting session "${sessionId}"`)
      throw mapDshFailure(error, `prompting session "${sessionId}"`)
    }
  }
}

/**
 * Mount the DSH session and agent-runtime adapters in `myworkAdapters`.
 *
 * Both registrations belong to the calling plugin's fiber, so unloading the
 * controller removes them with it (§44). A profile that mounts no session
 * controller is reported instead of repaired, exactly as a profile without the
 * `llm` service is: the controller still mounts, and nothing negotiates a port
 * this deployment cannot serve.
 * @param ctx - the controller's plugin context.
 * @param adapters - the registry the controller published.
 * @returns whether the adapters were registered; `false` means no session controller is mounted.
 */
export function mountDshRuntime(ctx: Context, adapters: MyWorkAdapters<undefined>): boolean {
  const controller: unknown = ctx.get(DSH_SESSION_SERVICE)
  if (controller === undefined) {
    ctx.logger?.warn?.(
      `dsh-mywork: the DSH service "${DSH_SESSION_SERVICE}" is not mounted, so no session or agent-runtime adapter was registered`,
    )
    return false
  }
  if (!isSessionController(controller)) {
    ctx.logger?.warn?.(
      `dsh-mywork: the DSH service "${DSH_SESSION_SERVICE}" does not answer create/list/selectModel/prompt/cancel/follow, so no session or agent-runtime adapter was registered`,
    )
    return false
  }
  const agents: unknown = ctx.get(DSH_AGENTS_SERVICE)
  const commands: unknown = ctx.get(DSH_COMMANDS_SERVICE)
  const api: DshSessionApi = {
    controller,
    ...(isAgentRegistry(agents) ? { agents } : {}),
    ...(isCommandRuntime(commands) ? { commands } : {}),
  }
  const session = new DshSessionAdapter(api)
  const runtime = new DshAgentRuntime(api)
  const handles = [
    adapters.register<SessionPort>({
      kind: DSH_SESSION_KIND,
      id: DSH_SESSION_ADAPTER_ID,
      contractVersion: portContractVersion(DSH_SESSION_KIND),
      capabilities: DSH_SESSION_CAPABILITIES,
      create: () => session,
    }),
    adapters.register<AgentRuntimePort>({
      kind: DSH_AGENT_RUNTIME_KIND,
      id: DSH_AGENT_RUNTIME_ADAPTER_ID,
      contractVersion: portContractVersion(DSH_AGENT_RUNTIME_KIND),
      capabilities: DSH_AGENT_RUNTIME_CAPABILITIES,
      create: () => runtime,
    }),
  ]
  ctx.effect(() => () => {
    for (const handle of handles) handle.unregister()
  })
  return true
}

/** Whether a value carries the session-controller methods this binding calls. */
function isSessionController(value: unknown): value is DshSessionController {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<Record<keyof DshSessionController, unknown>>
  return typeof candidate.create === 'function'
    && typeof candidate.list === 'function'
    && typeof candidate.selectModel === 'function'
    && typeof candidate.prompt === 'function'
    && typeof candidate.cancel === 'function'
    && typeof candidate.follow === 'function'
}

/** Whether a value carries the agent-registry method this binding calls. */
function isAgentRegistry(value: unknown): value is DshAgentRegistry {
  return value !== null && typeof value === 'object' && typeof (value as DshAgentRegistry).get === 'function'
}

/** Whether a value carries the command-runtime method this binding calls. */
function isCommandRuntime(value: unknown): value is DshCommandRuntime {
  return value !== null && typeof value === 'object' && typeof (value as DshCommandRuntime).execute === 'function'
}

/** Refuse a call whose caller already cancelled it, before any side effect. */
function refuseIfAborted(signal: AbortSignal | undefined, what: string): void {
  if (signal?.aborted === true) throw cancelled(what)
}

/**
 * Turn one opening snapshot into the page the port promises.
 *
 * The platform's window is not a page: it may repeat a position, deliver one
 * after a later position, and it serves the most recent `maxMessages` entries
 * rather than every position after the cursor. All three are the caller's
 * problem only if the adapter passes them through, so they stop here: positions
 * at or below the cursor are withheld, each position is reported once, and the
 * result is ascending. The platform's own `hasMore` is passed on unchanged — it
 * means "records were cut", which is the bound the caller has to know about, and
 * over-reporting a bound is the harmless direction while dropping it is not.
 *
 * Two frame fields are deliberately not read: `header` (the session's own
 * identity and preset, which this port never reports) and `cursor` (the log's
 * committed end, which is *not* the page's cursor — reporting it would claim a
 * completeness the window may not have given).
 * @param opening - the snapshot the platform opened with.
 * @param cursor - last position the caller has seen.
 */
function pageOf(opening: DshFollowSnapshot, cursor: number): SessionEventPage {
  const seen = new Set<number>()
  const events: SessionEvent[] = []
  for (const record of opening.records) {
    const event = record.event
    if (event.seq <= cursor || seen.has(event.seq)) continue
    seen.add(event.seq)
    events.push({ seq: event.seq, type: event.type, time: event.time })
  }
  events.sort((left, right) => left.seq - right.seq)
  const end = events.at(-1)?.seq
  return {
    events,
    // The cursor is the last delivered position, or the caller's own: it never
    // moves backwards and never past a position the page did not deliver.
    cursor: end ?? cursor,
    hasMore: opening.hasMore,
  }
}

/** The adapter error a cancelled call reports. */
function cancelled(what: string): AdapterError {
  return new AdapterError('cancelled', `dsh-mywork: ${what} aborted before it was admitted`)
}

/** The prompt identity this binding mints when the caller supplies no factory. */
function defaultRequestId(): string {
  return `${DSH_REQUEST_ID_PREFIX}${crypto.randomUUID()}`
}

/**
 * Translate one DSH failure into the port's own error vocabulary.
 *
 * The platform's codes are its own (`session/not-found`, `session/conflict`,
 * `agent-preset/conflict`, `gateway/cancelled`); MyWork's callers only ever see
 * the §42 adapter codes. The translation is also where the *cause* is named: an
 * unknown reference the platform reports is `session-missing`, a refusal of the
 * composition the caller asked for is `session-scope-mismatch`, and an
 * unrecognised failure is `runtime-unavailable` and keeps its cause — a platform
 * that answers something this binding cannot read is an outage, not a caller
 * mistake.
 * @param error - whatever the platform threw.
 * @param what - the operation, for the message.
 */
function mapDshFailure(error: unknown, what: string): AdapterError {
  const code = dshErrorCode(error)
  const detail = error instanceof Error ? error.message : String(error)
  if (code === 'session/not-found') {
    return new DshSessionRefusal('session-missing', `dsh-mywork: ${what}: ${detail}`, { cause: error })
  }
  if (code === 'session/conflict' || code === 'agent-preset/conflict' || code === 'session/invalid-time-zone') {
    return new DshSessionRefusal('session-scope-mismatch', `dsh-mywork: ${what}: ${detail}`, { cause: error })
  }
  if (code === 'gateway/cancelled') {
    // Cancellation is not one of the four session causes: it says nothing about
    // the session, only that the turn the caller asked for was stopped.
    return new AdapterError('cancelled', `dsh-mywork: ${what}: ${detail}`, { cause: error })
  }
  return new DshSessionRefusal(
    'runtime-unavailable',
    `dsh-mywork: ${what} failed${code === undefined ? '' : ` (${code})`}: ${detail}`,
    { cause: error },
  )
}

/** The platform's own failure code, when the failure carries one. */
function dshErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}
