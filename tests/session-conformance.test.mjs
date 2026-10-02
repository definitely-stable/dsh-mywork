/**
 * Session-port conformance: the permission policies and the refusal causes
 * (architecture §22, §31, §36, §39, §42; plan step F-44, card MW-015 P21).
 *
 * The acceptance report found three branches of the DSH session binding with no
 * test at all — `read-only`, `danger-full-access`, and "no live agent" — and
 * four different refusals collapsed into one `unavailable`, so a caller could
 * not tell a session that is gone from a deployment that is down. This suite
 * pins both halves:
 *
 * 1. the policy a run is scoped to reaches the platform as data, and the
 *    contract refuses an effect the policy does not admit instead of leaving the
 *    caller to retry it;
 * 2. every refusal names one of the four `SessionRefusalReason` causes, and the
 *    four are told apart even where the transport code behind them is the same.
 *
 * Nothing here writes to the filesystem: the permission tests assert the *port
 * contract* (which mode was pinned, what the gate decided), never an effect on
 * disk, and the workspace they name is never created.
 */

import { assertScratchHome, scratchDshHome, scratchRoot } from './lib/tmp-home.mjs'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { adapterSdk, contracts, core, meta } from './lib/fixtures.mjs'

/** Repository root; every artifact below is addressed from here. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Driving the built controller bundle loads the storage layer, which opens its
 * SQLite state under `$DSH_HOME` — so the variable is pinned to a scratch
 * directory inside `.tmp` *before* the bundle is imported. Without the pin a
 * plain `node --test` run would write into the live profile, which this campaign
 * forbids.
 */
scratchDshHome('session-conformance')

/** The controller bundle, loaded the way a consumer would. */
const controllerEntry = join(repoRoot, 'packages', 'controller', 'lib', 'index.js')
if (!existsSync(controllerEntry)) {
  throw new Error(
    `session conformance: missing build output: ${controllerEntry}; build the contracts and controller packages first`,
  )
}
const controller = await import(pathToFileURL(controllerEntry).href)

/** Workspace the fake runs in; a path that is never written to. */
const WORKSPACE = join(scratchRoot, 'session-conformance-workspace')

/** Workspace the read-only and danger-full-access grants are bound to. */
const WORKSPACE_ID = 'ws-conformance'

/** One file inside {@link WORKSPACE}: the effect a write permission would produce. */
const TOUCHED = join(WORKSPACE, 'notes.md')

/** The scope every scoping test states: preset, route, and policy. */
const SCOPE = Object.freeze({
  agentPreset: 'mywork-worker',
  model: Object.freeze({ provider: 'opencode-go', model: 'deepseek-v4.1-flash' }),
  permission: 'workspace-write',
})

/** A DSH-style failure: a platform code, and a message. */
function dshFailure(code, message) {
  return Object.assign(new Error(message), { code })
}

/**
 * Scripted stand-in for the three DSH services the binding drives.
 *
 * It answers the way the platform documents itself: an explicit identity is
 * adopted, a contradicting workspace or preset is refused by code, the roster
 * reports `running` for a session no live agent serves, and the log is opened
 * through `follow`. Every call is recorded, including the ones the binding must
 * not make.
 * @param options - the deployment's behaviour for this run.
 */
function fakeDsh(options = {}) {
  const calls = []
  const sessions = new Map()
  const attached = new Set()
  let minted = 0
  let seq = 0

  /** Append one durable event to a session's log. */
  function emit(sessionId, type) {
    const session = sessions.get(sessionId)
    if (session === undefined) throw dshFailure('session/not-found', `session "${sessionId}" not found`)
    seq += 1
    session.events.push({ type, seq, time: seq })
  }

  function record(method, args) {
    calls.push({ method, ...args })
  }

  /**
   * The controller's `list` and `prompt` dereference the signal they are given,
   * so an in-process caller that omits one gets a TypeError rather than a
   * session. The stand-in refuses the same way.
   */
  function requireSignal(signal, what) {
    if (!(signal instanceof AbortSignal)) {
      throw new TypeError(`Cannot read properties of ${String(signal)} (reading 'throwIfAborted') in ${what}`)
    }
    signal.throwIfAborted()
    return signal
  }

  /** The opening frame of a session log, when the deployment can serve one. */
  function openingFrame(sessionId, maxMessages) {
    if (options.logOpensEmpty === true) return undefined
    if (options.logFrameType !== undefined) return { type: options.logFrameType, header: { id: sessionId } }
    const session = sessions.get(sessionId)
    if (session === undefined) throw dshFailure('session/not-found', `session "${sessionId}" not found`)
    const ordered = session.events.map(event => ({ type: 'event', event }))
    const records = maxMessages === undefined ? ordered : ordered.slice(-maxMessages)
    return {
      type: 'snapshot',
      header: { id: sessionId },
      cursor: session.events.length,
      records,
      hasMore: ordered.length > records.length,
    }
  }

  const agentRegistry = {
    get(sessionId) {
      record('agents.get', { sessionId })
      return attached.has(sessionId) ? { session: { id: sessionId } } : undefined
    },
  }

  const commandRuntime = {
    async execute(agent, line, attachments, signal) {
      record('commands.execute', { sessionId: agent.session.id, line, attachments: attachments.length, signal })
      if (options.noPermissionCommand === true) return undefined
      const match = /^\/permission (?<preset>\S+)$/.exec(line)
      if (match === null) return { result: { kind: 'error', text: `unknown command ${line}` } }
      const preset = match.groups.preset
      if (!(options.presets ?? contracts.HARNESS_POLICIES).includes(preset)) {
        return { result: { kind: 'error', text: `unknown preset "${preset}"` } }
      }
      const session = sessions.get(agent.session.id)
      if (session === undefined) return { result: { kind: 'error', text: 'no session' } }
      session.pins.push(`permission:${preset}`)
      emit(agent.session.id, 'permission/preset')
      return { result: { kind: 'success', text: `preset ${preset}` } }
    },
  }

  const sessionController = {
    async create(request) {
      record('session.create', { cwd: request.cwd, sessionId: request.sessionId, agentPreset: request.agentPreset })
      if (options.createFails !== undefined) throw options.createFails
      const explicit = request.sessionId
      if (explicit === undefined) {
        minted += 1
        const sessionId = `session-dsh-${minted}`
        sessions.set(sessionId, { cwd: request.cwd, preset: request.agentPreset, running: true, events: [], pins: [] })
        // A deployment that keeps the record but serves no live agent for it is
        // the state a host restart leaves behind; the roster still lists it.
        if (options.liveAgents !== false) attached.add(sessionId)
        return { sessionId, ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }) }
      }
      const existing = sessions.get(explicit)
      if (existing === undefined) throw dshFailure('session/not-found', `session "${explicit}" not found`)
      if (existing.cwd !== request.cwd) {
        throw dshFailure('session/conflict', `session "${explicit}" already runs in "${existing.cwd}"`)
      }
      if (existing.preset !== request.agentPreset) {
        throw dshFailure('agent-preset/conflict', `session "${explicit}" is composed under "${existing.preset}"`)
      }
      existing.running = true
      if (options.liveAgents !== false) attached.add(explicit)
      return { sessionId: explicit, ...(existing.preset === undefined ? {} : { agentPreset: existing.preset }) }
    },

    async list(_request, signal) {
      record('session.list', {})
      requireSignal(signal, 'session/list')
      return { items: [...sessions].map(([sessionId, session]) => ({ sessionId, running: session.running })) }
    },

    async selectModel(request) {
      record('session.selectModel', { sessionId: request.sessionId, provider: request.provider, model: request.model })
      if (!sessions.has(request.sessionId)) {
        throw dshFailure('session/not-found', `session "${request.sessionId}" not found`)
      }
      const session = sessions.get(request.sessionId)
      session.pins.push(`model:${request.provider}/${request.model}`)
      emit(request.sessionId, 'model/selection')
      return { selected: { provider: request.provider, model: request.model } }
    },

    async prompt(request, signal) {
      record('session.prompt', {
        sessionId: request.sessionId,
        requestId: request.requestId,
        mode: request.mode,
        text: request.content.map(part => part.text).join(''),
      })
      requireSignal(signal, 'session/prompt')
      if (!sessions.has(request.sessionId)) {
        throw dshFailure('session/not-found', `session "${request.sessionId}" not found`)
      }
      emit(request.sessionId, 'turn/start')
      return { accepted: true }
    },

    async cancel(request) {
      record('session.cancel', { sessionId: request.sessionId })
      const session = sessions.get(request.sessionId)
      if (session === undefined || !attached.has(request.sessionId)) {
        throw dshFailure('session/not-found', `session "${request.sessionId}" not found (not attached)`)
      }
      session.running = false
      return { accepted: true }
    },

    follow(request, signal) {
      record('session.follow', { sessionId: request.address.sessionId, signal })
      const frame = openingFrame(request.address.sessionId, request.maxMessages)
      return (async function* follow() {
        // A log with no frame completes at once; a real one keeps yielding, and
        // a read that closes after the opening frame must release it rather than
        // hold the subscription.
        if (frame === undefined) return
        yield frame
        await new Promise(resolve => {
          signal.addEventListener('abort', resolve, { once: true })
        })
      })()
    },
  }

  return {
    api: {
      controller: sessionController,
      agents: agentRegistry,
      ...(options.noCommandRuntime === true ? {} : { commands: commandRuntime }),
    },
    calls,
    sessions,
    /** Calls of one method, in order. */
    of: method => calls.filter(call => call.method === method),
  }
}

/**
 * The refusal a rejected call carried, in the shape a caller reads it by.
 *
 * A refusal must still be an adapter error — the transport vocabulary every
 * existing caller branches on — and this helper fails loudly when a call that
 * had to be refused succeeded instead.
 * @param call - the promise expected to be refused.
 */
async function refusalOf(call) {
  try {
    await call
  } catch (error) {
    assert.equal(adapterSdk.isAdapterError(error), true, `expected an adapter error, received: ${String(error)}`)
    return error
  }
  throw new Error('expected the call to be refused, and it was not')
}

/** A grant bound to {@link WORKSPACE}, holding the write permission it must not use. */
function grant(overrides = {}) {
  return {
    agentId: 'Neo-1',
    permissions: ['workspace.read', 'workspace.write'],
    workspaceId: WORKSPACE_ID,
    workspaceRoot: WORKSPACE,
    harnessPolicy: 'workspace-write',
    ...overrides,
  }
}

/** One filesystem write inside the workspace. */
function writeRequest(overrides = {}) {
  return { domain: 'filesystem', action: 'write', workspaceId: WORKSPACE_ID, path: TOUCHED, ...overrides }
}

/** A run identifier per call, so a duplicate never hides a refusal. */
let runs = 0
function runId(label) {
  runs += 1
  return `${label}-${runs}`
}

test('a read-only session is pinned to read-only, and the contract refuses a file change', async () => {
  // The three uncovered branches start here. A read-only run must not rely on
  // the agent behaving: the mode is pinned on the platform, and MyWork's own
  // gate refuses the effect the mode does not admit — so the answer is a
  // refusal with a cause, never "try again".
  assertScratchHome()
  const dsh = fakeDsh()
  const runtime = new controller.DshAgentRuntime(dsh.api)
  const handle = await runtime.start({
    runId: runId('run-read-only'),
    workspacePath: WORKSPACE,
    prompt: 'change a file',
    scope: { ...SCOPE, permission: 'read-only' },
  })

  assert.deepEqual(dsh.of('commands.execute').map(call => call.line), ['/permission read-only'])
  assert.deepEqual(
    dsh.sessions.get(handle.sessionId).pins,
    ['model:opencode-go/deepseek-v4.1-flash', 'permission:read-only'],
    'the policy reaches the platform as the harness mode itself',
  )

  // The ceiling of `read-only` excludes the write, so the refusal is a decision
  // the caller can act on rather than an invitation to retry.
  assert.equal(contracts.HARNESS_POLICY_CEILING['read-only'].includes('workspace.write'), false)
  const refused = core.authorizeOperation(grant({ harnessPolicy: 'read-only' }), writeRequest(), meta())
  assert.equal(refused.ok, false, 'a read-only policy must not authorize a write')
  assert.equal(refused.error.code, 'SECURITY_DENIED')
  assert.equal(refused.error.details.reason, 'harness-policy')

  // A read the mode does admit is still authorized: the refusal is about the
  // effect, not about the session.
  const read = core.authorizeOperation(
    grant({ harnessPolicy: 'read-only' }),
    writeRequest({ action: 'read' }),
    meta(),
  )
  assert.equal(read.ok, true, read.ok ? '' : read.error.message)
})

test('a danger-full-access session pins the wide mode, and nothing is written to disk', async () => {
  assertScratchHome()
  const dsh = fakeDsh()
  const runtime = new controller.DshAgentRuntime(dsh.api)
  const handle = await runtime.start({
    runId: runId('run-full-access'),
    workspacePath: WORKSPACE,
    prompt: 'change a file',
    scope: { ...SCOPE, permission: 'danger-full-access' },
  })

  assert.deepEqual(dsh.of('commands.execute').map(call => call.line), ['/permission danger-full-access'])
  assert.deepEqual(
    dsh.sessions.get(handle.sessionId).pins,
    ['model:opencode-go/deepseek-v4.1-flash', 'permission:danger-full-access'],
  )

  // The lifted restriction is read off the contract and the gate, not off the
  // disk: this step proves which policy was in force, and a real write is
  // outside its scope.
  assert.equal(contracts.HARNESS_POLICY_CEILING['danger-full-access'].includes('workspace.write'), true)
  const allowed = core.authorizeOperation(grant({ harnessPolicy: 'danger-full-access' }), writeRequest(), meta())
  assert.equal(allowed.ok, true, allowed.ok ? '' : allowed.error.message)
  assert.equal(allowed.value.permission, 'workspace.write')
  assert.equal(existsSync(TOUCHED), false, 'the suite reports a decision; it must not have written a file')
})

test('a session with no live agent is refused as not-live, not as an outage', async () => {
  // The third uncovered branch: the roster holds the session, `agents.get`
  // answers `undefined`, and a call that needs the running agent cannot be
  // served. The refusal has to be distinguishable from a deployment failure.
  assertScratchHome()
  const dsh = fakeDsh({ liveAgents: false })
  const runtime = new controller.DshAgentRuntime(dsh.api)
  const refusal = await refusalOf(
    runtime.start({
      runId: runId('run-agentless'),
      workspacePath: WORKSPACE,
      prompt: 'work',
      scope: { ...SCOPE, permission: 'read-only' },
    }),
  )

  assert.equal(refusal.reason, 'session-not-live')
  assert.equal(refusal.refusalCode, contracts.SESSION_REFUSAL_CODES['session-not-live'])
  assert.equal(refusal.refusalCode, 'STALE_REVISION')
  assert.notEqual(refusal.reason, 'runtime-unavailable', 'a detached agent is not an outage')
  assert.deepEqual(dsh.of('agents.get').map(call => call.sessionId), ['session-dsh-1'], 'the live agent was looked up')
  assert.equal(dsh.of('commands.execute').length, 0, 'no policy may be pinned through an agent that is not there')
  assert.equal(dsh.of('session.prompt').length, 0, 'an unscoped run must not start')
})

test('an unknown session is refused as session-missing, not as an outage', async () => {
  assertScratchHome()
  const dsh = fakeDsh()
  const runtime = new controller.DshAgentRuntime(dsh.api)

  await runtime.start({
    runId: runId('run-known'),
    workspacePath: WORKSPACE,
    prompt: 'work',
    scope: { ...SCOPE, permission: 'read-only' },
  })

  const adoption = await refusalOf(
    runtime.resume({ runId: runId('run-absent'), sessionId: 'session-absent', workspacePath: WORKSPACE, scope: SCOPE }),
  )
  assert.equal(adoption.reason, 'session-missing')
  assert.equal(adoption.refusalCode, 'SESSION_NOT_FOUND')
  assert.equal(adoption.code, 'invalid-ref')

  // The roster read answers the same cause: the identity does not resolve.
  const status = await refusalOf(runtime.status({ runId: runId('run-absent'), sessionId: 'session-absent' }))
  assert.equal(status.reason, 'session-missing')
  assert.equal(status.refusalCode, 'SESSION_NOT_FOUND')
})

test('a scope that contradicts the record is refused as a scope mismatch', async () => {
  assertScratchHome()
  const dsh = fakeDsh()
  const runtime = new controller.DshAgentRuntime(dsh.api)
  const handle = await runtime.start({
    runId: runId('run-scoped'),
    workspacePath: WORKSPACE,
    prompt: 'work',
    scope: { ...SCOPE, permission: 'read-only' },
  })

  const elsewhere = await refusalOf(
    runtime.resume({
      runId: runId('run-elsewhere'),
      sessionId: handle.sessionId,
      workspacePath: join(WORKSPACE, 'elsewhere'),
      scope: SCOPE,
    }),
  )
  assert.equal(elsewhere.reason, 'session-scope-mismatch')
  assert.equal(elsewhere.refusalCode, 'CONTRACT_MISMATCH')
  assert.equal(elsewhere.code, 'conflict')

  // The preset is the other half of the composition, and it answers the same
  // cause: the caller asked for a run the record cannot be.
  const reprofile = await refusalOf(
    runtime.resume({
      runId: runId('run-reprofile'),
      sessionId: handle.sessionId,
      workspacePath: WORKSPACE,
      scope: { ...SCOPE, agentPreset: 'another-preset' },
    }),
  )
  assert.equal(reprofile.reason, 'session-scope-mismatch')
  assert.equal(reprofile.refusalCode, 'CONTRACT_MISMATCH')
})

test('a deployment that cannot serve the call is refused as runtime-unavailable', async () => {
  // Every way this binding can find the platform unable to serve a call answers
  // one cause, and that cause is the one a caller retries on — never the cause
  // that says the session is gone.
  assertScratchHome()
  const scope = { ...SCOPE, permission: 'read-only' }

  /** A runtime over a deployment with one thing wrong, and the call it refuses. */
  async function refusedBy(behaviour, call) {
    const dsh = fakeDsh(behaviour)
    const runtime = new controller.DshAgentRuntime(dsh.api)
    return await refusalOf(call(dsh, runtime))
  }

  const outages = [
    [
      'an unrecognised platform failure',
      () => refusedBy({ createFails: dshFailure('gateway/internal', 'the controller fell over') }, (_dsh, runtime) =>
        runtime.start({ runId: runId('run-broken'), workspacePath: WORKSPACE, prompt: 'work', scope })),
    ],
    [
      'a profile that serves no command runtime',
      () => refusedBy({ noCommandRuntime: true }, (_dsh, runtime) =>
        runtime.start({ runId: runId('run-no-runtime'), workspacePath: WORKSPACE, prompt: 'work', scope })),
    ],
    [
      'a profile that serves no /permission command',
      () => refusedBy({ noPermissionCommand: true }, (_dsh, runtime) =>
        runtime.start({ runId: runId('run-no-command'), workspacePath: WORKSPACE, prompt: 'work', scope })),
    ],
    [
      'a command that refuses the policy',
      () => refusedBy({ presets: ['workspace-write'] }, (_dsh, runtime) =>
        runtime.start({ runId: runId('run-refused'), workspacePath: WORKSPACE, prompt: 'work', scope })),
    ],
    [
      'a session log that opens with no frame',
      () => refusedBy({ logOpensEmpty: true }, async (_dsh, runtime) => {
        const handle = await runtime.start({ runId: runId('run-empty-log'), workspacePath: WORKSPACE, prompt: 'work' })
        return await runtime.events(handle)
      }),
    ],
    [
      'a session log that opens with a frame this binding cannot read',
      () => refusedBy({ logFrameType: 'roster' }, async (_dsh, runtime) => {
        const handle = await runtime.start({ runId: runId('run-odd-log'), workspacePath: WORKSPACE, prompt: 'work' })
        return await runtime.events(handle)
      }),
    ],
  ]

  for (const [label, probe] of outages) {
    const refusal = await probe()
    assert.equal(refusal.reason, 'runtime-unavailable', `${label} must be an outage`)
    assert.equal(refusal.refusalCode, 'ADAPTER_UNAVAILABLE', label)
    assert.equal(refusal.code, 'unavailable', label)
  }

  // A deployment that refuses the policy must not have started the run: the
  // prompt is admitted only after the scope is in force.
  const refused = fakeDsh({ presets: ['workspace-write'] })
  await refusalOf(
    new controller.DshAgentRuntime(refused.api).start({
      runId: runId('run-refused-again'),
      workspacePath: WORKSPACE,
      prompt: 'work',
      scope,
    }),
  )
  assert.equal(refused.of('session.prompt').length, 0, 'an unscoped run must not start')
})

test('the four causes never collapse into one another', async () => {
  // This is the property the acceptance report asked for: four refusals that
  // used to answer the same word now answer four different causes. Two of them
  // share a transport code, which is exactly why the cause has to travel beside
  // it rather than being read off it.
  assertScratchHome()
  const observed = {}

  const missing = fakeDsh()
  observed['session-missing'] = await refusalOf(
    new controller.DshAgentRuntime(missing.api).resume({
      runId: runId('run-missing'),
      sessionId: 'session-absent',
      workspacePath: WORKSPACE,
      scope: SCOPE,
    }),
  )

  const agentless = fakeDsh({ liveAgents: false })
  observed['session-not-live'] = await refusalOf(
    new controller.DshAgentRuntime(agentless.api).start({
      runId: runId('run-not-live'),
      workspacePath: WORKSPACE,
      prompt: 'work',
      scope: SCOPE,
    }),
  )

  const contradicting = fakeDsh()
  const held = await new controller.DshAgentRuntime(contradicting.api).start({
    runId: runId('run-held'),
    workspacePath: WORKSPACE,
    prompt: 'work',
    scope: { ...SCOPE, permission: 'read-only' },
  })
  observed['session-scope-mismatch'] = await refusalOf(
    new controller.DshAgentRuntime(contradicting.api).resume({
      runId: runId('run-contradiction'),
      sessionId: held.sessionId,
      workspacePath: join(WORKSPACE, 'elsewhere'),
      scope: SCOPE,
    }),
  )

  const down = fakeDsh({ createFails: dshFailure('gateway/internal', 'the controller fell over') })
  observed['runtime-unavailable'] = await refusalOf(
    new controller.DshAgentRuntime(down.api).start({
      runId: runId('run-down'),
      workspacePath: WORKSPACE,
      prompt: 'work',
      scope: SCOPE,
    }),
  )

  assert.deepEqual(Object.keys(observed).sort(), ['runtime-unavailable', 'session-missing', 'session-not-live', 'session-scope-mismatch'])
  for (const [expected, refusal] of Object.entries(observed)) {
    assert.equal(refusal.reason, expected, `${expected} must be refused with its own cause`)
    assert.equal(refusal.refusalCode, contracts.SESSION_REFUSAL_CODES[expected])
  }

  const reasons = Object.values(observed).map(refusal => refusal.reason)
  assert.equal(new Set(reasons).size, 4, 'four refusals must answer four causes')
  const codes = Object.values(observed).map(refusal => refusal.refusalCode)
  assert.equal(new Set(codes).size, 4, 'each cause maps to its own canonical §42 code')

  // A live agent that went away and a deployment that fell over are the pair a
  // retry decision turns on: same transport code, different cause.
  assert.equal(observed['session-not-live'].code, observed['runtime-unavailable'].code)
  assert.notEqual(observed['session-not-live'].reason, observed['runtime-unavailable'].reason)
})

test('every declared refusal cause is reachable, and the list and the map agree', async () => {
  // A cause nobody can reach is a claim the code does not keep, and a map that
  // drifts from the list is a mapping no caller can trust.
  assertScratchHome()
  const probes = {
    'session-missing': async () => {
      const dsh = fakeDsh()
      return await refusalOf(
        new controller.DshAgentRuntime(dsh.api).resume({
          runId: runId('probe-missing'),
          sessionId: 'session-absent',
          workspacePath: WORKSPACE,
          scope: SCOPE,
        }),
      )
    },
    'session-not-live': async () => {
      const dsh = fakeDsh({ liveAgents: false })
      return await refusalOf(
        new controller.DshAgentRuntime(dsh.api).start({
          runId: runId('probe-not-live'),
          workspacePath: WORKSPACE,
          prompt: 'work',
          scope: SCOPE,
        }),
      )
    },
    'session-scope-mismatch': async () => {
      const dsh = fakeDsh()
      const runtime = new controller.DshAgentRuntime(dsh.api)
      const handle = await runtime.start({
        runId: runId('probe-held'),
        workspacePath: WORKSPACE,
        prompt: 'work',
        scope: { ...SCOPE, permission: 'read-only' },
      })
      return await refusalOf(
        runtime.resume({
          runId: runId('probe-contradiction'),
          sessionId: handle.sessionId,
          workspacePath: join(WORKSPACE, 'elsewhere'),
          scope: SCOPE,
        }),
      )
    },
    'runtime-unavailable': async () => {
      const dsh = fakeDsh({ createFails: dshFailure('gateway/internal', 'the controller fell over') })
      return await refusalOf(
        new controller.DshAgentRuntime(dsh.api).start({
          runId: runId('probe-down'),
          workspacePath: WORKSPACE,
          prompt: 'work',
          scope: SCOPE,
        }),
      )
    },
  }

  assert.deepEqual(
    Object.keys(probes).sort(),
    [...contracts.SESSION_REFUSAL_REASONS].sort(),
    'every declared refusal cause has a probe',
  )
  for (const [expected, probe] of Object.entries(probes)) {
    const refusal = await probe()
    assert.equal(refusal.reason, expected)
    assert.equal(refusal.refusalCode, contracts.SESSION_REFUSAL_CODES[expected])
  }

  assert.deepEqual(
    Object.keys(contracts.SESSION_REFUSAL_CODES).sort(),
    [...contracts.SESSION_REFUSAL_REASONS].sort(),
    'the code map covers exactly the declared causes',
  )
  for (const code of Object.values(contracts.SESSION_REFUSAL_CODES)) {
    assert.equal(contracts.MYWORK_ERROR_CODES.includes(code), true, `${code} must be a canonical §42 code`)
  }
  assert.equal(
    new Set(Object.values(contracts.SESSION_REFUSAL_CODES)).size,
    contracts.SESSION_REFUSAL_REASONS.length,
    'no two causes may share a canonical code',
  )
})
