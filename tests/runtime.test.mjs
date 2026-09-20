/**
 * DSH session and agent-runtime adapters (MW-015): the §39 `agent-runtime`
 * conformance suite, the §22/§29/§31 scoping the DSH binding performs, and the
 * failures the port contract has to answer for — stop/cancel, a missing session,
 * duplicate and late events, and a process restart.
 *
 * Everything here runs without a model, a provider, an API key, or the live
 * host: the DSH services are scripted stand-ins that record exactly what the
 * binding asked of them, so a call the adapter forgets to make is a failing
 * assertion rather than a quiet omission.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root; every artifact below is addressed from here. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Built entry points this suite exercises. */
const entries = {
  contracts: 'packages/contracts/lib/index.js',
  adapterSdk: 'packages/adapter-sdk/lib/index.js',
  adapterTesting: 'packages/adapter-sdk/lib/testing.js',
  controller: 'packages/controller/lib/index.js',
}

const missing = Object.values(entries).filter(relative => !existsSync(join(repoRoot, relative)))
if (missing.length > 0) {
  throw new Error(
    `runtime tests: missing build output: ${missing.join(', ')}; run "pnpm run build" first (or use "pnpm run check")`,
  )
}

const [contracts, adapterSdk, adapterTesting, controller] = await Promise.all(
  Object.values(entries).map(relative => import(pathToFileURL(join(repoRoot, relative)).href)),
)

const { Context } = await import('@deepseek-ai/cordis')

/** The scope every scoping test asserts. */
const SCOPE = Object.freeze({
  agentPreset: 'mywork-worker',
  model: Object.freeze({ provider: 'opencode-go', model: 'deepseek-v4.1-flash' }),
  permission: 'workspace-write',
})

/** Whether a thrown value is an adapter error with the expected code. */
function adapterErrorWith(code) {
  return error => adapterSdk.isAdapterError(error) && error.code === code
}

/**
 * Scripted stand-in for the three DSH services the binding drives.
 *
 * It keeps the platform's own promises rather than a convenient subset: an
 * explicit session identity is adopted idempotently, a contradicting workspace
 * or preset is refused by code, the roster reports `running` for sessions no
 * live agent serves, and a log is opened through `follow` as a complete opening
 * snapshot. Every call is recorded, including the ones the binding must not
 * make.
 */
function fakeDsh(options = {}) {
  const calls = []
  const sessions = new Map()
  const attached = new Set()
  let minted = 0
  let seq = 0
  let released = 0

  /** Append one durable event and answer with it. */
  function emit(sessionId, type) {
    const session = sessions.get(sessionId)
    if (session === undefined) throw dshFailure('session/not-found', `session "${sessionId}" not found`)
    seq += 1
    const event = { type, seq, time: seq }
    session.events.push(event)
    return event
  }

  function record(method, args) {
    calls.push({ method, ...args })
  }

  /**
   * The controller's own `list` and `prompt` dereference the signal they are
   * given (`signal.throwIfAborted()`), so an in-process caller that omits it gets
   * a TypeError instead of a session. The stand-in refuses the same way.
   */
  function requireSignal(signal, what) {
    if (!(signal instanceof AbortSignal)) {
      throw new TypeError(`Cannot read properties of ${String(signal)} (reading 'throwIfAborted') in ${what}`)
    }
    signal.throwIfAborted()
    return signal
  }

  /**
   * The window a `follow` opening frame carries.
   *
   * A bounded read is the owner's own newest window: position-ordered and
   * exactly as many entries as were asked for. The scripted noise models a
   * misbehaving owner's *delivery* (a repeat, an entry that arrives after a
   * later position), not a truncation, so it is never mixed into a bounded
   * window — a real owner does not truncate and misorder at the same time.
   */
  function windowOf(sessionId, maxMessages) {
    const session = sessions.get(sessionId)
    if (session === undefined) throw dshFailure('session/not-found', `session "${sessionId}" not found`)
    const ordered = session.events.map(event => ({ type: 'event', event }))
    const header = { id: sessionId, ...(session.preset === undefined ? {} : { agentPreset: session.preset }) }
    const cursor = session.events.reduce((max, event) => Math.max(max, event.seq), 0)
    if (maxMessages !== undefined) {
      const window = ordered.slice(-maxMessages)
      return { type: 'snapshot', header, cursor, records: window, hasMore: ordered.length > window.length }
    }
    const records = [...ordered]
    if (options.duplicateLast === true && records.length > 0) records.push(records.at(-1))
    if (options.lateEvent !== undefined && records.length > 0) {
      records.push({ type: 'event', event: { type: options.lateEvent, seq: 1, time: 1 } })
    }
    return { type: 'snapshot', header, cursor, records, hasMore: false }
  }

  const agentRegistry = {
    get(sessionId) {
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
      if (!(options.presets ?? ['read-only', 'workspace-write', 'danger-full-access']).includes(preset)) {
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
      record('session.create', {
        cwd: request.cwd,
        sessionId: request.sessionId,
        agentPreset: request.agentPreset,
      })
      if (options.createFails !== undefined) throw options.createFails
      const explicit = request.sessionId
      if (explicit === undefined) {
        minted += 1
        const sessionId = `session-dsh-${minted}`
        sessions.set(sessionId, { cwd: request.cwd, preset: request.agentPreset, running: true, events: [], pins: [] })
        attached.add(sessionId)
        return { sessionId, ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }) }
      }
      const existing = sessions.get(explicit)
      if (existing === undefined) throw dshFailure('session/not-found', `session "${explicit}" not found`)
      if (existing.cwd !== request.cwd) {
        throw dshFailure('session/conflict', `session "${explicit}" already runs in "${existing.cwd}"`)
      }
      if (existing.preset !== request.agentPreset) {
        throw dshFailure(
          'agent-preset/conflict',
          `session "${explicit}" is composed under "${existing.preset}"`,
        )
      }
      existing.running = true
      attached.add(explicit)
      return { sessionId: explicit, ...(existing.preset === undefined ? {} : { agentPreset: existing.preset }) }
    },

    async list(_request, signal) {
      record('session.list', {})
      requireSignal(signal, 'session/list')
      return {
        items: [...sessions].map(([sessionId, session]) => ({ sessionId, running: session.running })),
      }
    },

    async selectModel(request) {
      record('session.selectModel', {
        sessionId: request.sessionId,
        provider: request.provider,
        model: request.model,
      })
      if (!sessions.has(request.sessionId)) {
        throw dshFailure('session/not-found', `session "${request.sessionId}" not found`)
      }
      if (options.modelUnavailable === true) {
        throw dshFailure('session/model-unavailable', `model "${request.model}" is unavailable`)
      }
      const session = sessions.get(request.sessionId)
      session.pins.push(`model:${request.provider}/${request.model}`)
      emit(request.sessionId, 'model/selection')
      // The deployment answers with the route it resolved, which is deliberately
      // not always the route that was asked for.
      const selected = options.resolveRoute?.(request) ?? { provider: request.provider, model: request.model }
      return { selected }
    },

    async prompt(request, signal) {
      record('session.prompt', {
        sessionId: request.sessionId,
        requestId: request.requestId,
        mode: request.mode,
        text: request.content.map(part => part.text).join(''),
      })
      requireSignal(signal, 'session/prompt')
      if (options.promptFails !== undefined) throw options.promptFails
      if (!sessions.has(request.sessionId)) {
        throw dshFailure('session/not-found', `session "${request.sessionId}" not found`)
      }
      emit(request.sessionId, 'turn/start')
      return { accepted: true }
    },

    async cancel(request) {
      record('session.cancel', { sessionId: request.sessionId })
      if (options.cancelFails !== undefined) throw options.cancelFails
      const session = sessions.get(request.sessionId)
      if (session === undefined || !attached.has(request.sessionId)) {
        throw dshFailure('session/not-found', `session "${request.sessionId}" not found (not attached)`)
      }
      session.running = false
      return { accepted: true }
    },

    follow(request, signal) {
      record('session.follow', { sessionId: request.address.sessionId, maxMessages: request.maxMessages, signal })
      const frame = windowOf(request.address.sessionId, request.maxMessages)
      return (async function* follow() {
        try {
          yield frame
          // The real stream keeps yielding; a read that closes after the opening
          // frame must release it instead of holding the subscription.
          await new Promise(resolve => {
            signal.addEventListener('abort', resolve, { once: true })
          })
        } finally {
          released += 1
        }
      })()
    },
  }

  return {
    api: { controller: sessionController, agents: agentRegistry, commands: commandRuntime },
    calls,
    sessions,
    attached,
    /** How many opened streams were released. */
    releasedCount: () => released,
    /** Calls of one method, in order. */
    of: method => calls.filter(call => call.method === method),
    /** Detach every live agent, as a host restart does, without ending the sessions. */
    detachAll: () => attached.clear(),
  }
}

/** A DSH-style failure: a code the binding maps, and a message. */
function dshFailure(code, message) {
  return Object.assign(new Error(message), { code })
}

test('the §39 agent-runtime suite covers create, resume, stop, status, late event, cancellation, and restart', async () => {
  const host = new adapterTesting.FakeAgentHost()
  const runtime = new adapterTesting.FakeAgentRuntime({ host })
  const checks = adapterSdk.agentRuntimeChecks({
    runtime,
    runIdPrefix: 'suite',
    scope: SCOPE,
    // A second runtime over the same owner is exactly what a process restart is.
    reopen: () => new adapterTesting.FakeAgentRuntime({ host }),
  })
  const report = await adapterSdk.runConformance({
    kind: 'agent-runtime',
    checks,
    clock: new adapterTesting.FakeClock(0),
    adapterId: 'fake-agent-runtime',
  })

  assert.equal(report.failed, 0, JSON.stringify(report.results, undefined, 2))
  assert.equal(report.passed, checks.length)
  assert.equal(report.skipped, 0, 'no §39 check may be skipped when the suite has a restart hook')
  assert.deepEqual(
    report.results.map(result => result.name),
    [
      'create',
      'create refuses a duplicate run',
      'resume',
      'stop',
      'status',
      'late event',
      'cancellation',
      'process restart',
    ],
  )
  assert.deepEqual(report.missing, [], 'the runtime card must close the §39 gap it was written for')
})

test('a runtime that breaks the port contract fails the checks that cover it', async () => {
  const host = new adapterTesting.FakeAgentHost()
  const runtime = new adapterTesting.FakeAgentRuntime({ host })
  /** The same port, with resume and event reads broken on purpose. */
  const broken = {
    start: (request, options) => runtime.start(request, options),
    resume: async request => ({ runId: request.runId, sessionId: `${request.sessionId}-other` }),
    status: (handle, options) => runtime.status(handle, options),
    stop: (handle, options) => runtime.stop(handle, options),
    events: async () => ({ events: [], cursor: 0, hasMore: false }),
  }
  const report = await adapterSdk.runConformance({
    kind: 'agent-runtime',
    checks: adapterSdk.agentRuntimeChecks({
      runtime: broken,
      runIdPrefix: 'broken',
      scope: SCOPE,
      reopen: () => broken,
    }),
    clock: new adapterTesting.FakeClock(0),
  })

  // The broken operations are exactly the ones whose checks fail: the report is
  // evidence that every §39 check can notice a defect, not decoration.
  const failed = report.results.filter(result => result.status === 'failed').map(result => result.name)
  assert.deepEqual(
    failed,
    ['resume', 'stop', 'late event', 'cancellation', 'process restart'],
    JSON.stringify(report.results, undefined, 2),
  )
})

test('the fake withholds a redelivered position and a late one, and never moves the cursor back', async () => {
  const host = new adapterTesting.FakeAgentHost()
  const runtime = new adapterTesting.FakeAgentRuntime({ host })
  const handle = await runtime.start({ runId: 'run-late', workspacePath: '/w', prompt: 'work' })
  const first = await runtime.events(handle)
  assert.deepEqual(first.events.map(event => event.seq), [1])
  assert.equal(first.cursor, 1)

  host.redeliver(handle.sessionId)
  host.emitLate(handle.sessionId, 1, 'late/arrival')
  const replay = await runtime.events(handle, first.cursor)
  assert.deepEqual(replay.events, [], 'a position the caller already has must not be reported twice')
  assert.equal(replay.cursor, first.cursor, 'a withheld position must not move the cursor')

  host.emit(handle.sessionId, 'turn/end')
  const after = await runtime.events(handle, first.cursor)
  assert.deepEqual(after.events.map(event => event.type), ['turn/end'], 'only genuinely newer positions are delivered')
  assert.equal(after.cursor, 2)
  assert.equal(after.hasMore, false)
})

test('a page deduplicates and orders positions the caller has not seen yet', async () => {
  // The noise has to land *above* the caller's cursor to exercise the page's own
  // discipline: below it, the single `seq <= cursor` filter would absorb it and
  // neither the deduplication nor the ordering could be removed with a test
  // noticing. The log is also deliberately left out of position order, so the
  // page has to sort rather than trust the owner's delivery order.
  const host = new adapterTesting.FakeAgentHost()
  const runtime = new adapterTesting.FakeAgentRuntime({ host })
  const handle = await runtime.start({ runId: 'run-noise', workspacePath: '/w', prompt: 'work' })

  host.emit(handle.sessionId, 'turn/end')
  host.emitLate(handle.sessionId, 5, 'late/high')
  host.redeliver(handle.sessionId)
  host.emit(handle.sessionId, 'turn/start')

  const page = await runtime.events(handle, 1)
  assert.deepEqual(
    page.events.map(event => [event.seq, event.type]),
    [[2, 'turn/end'], [3, 'turn/start'], [5, 'late/high']],
    'positions above the cursor are deduplicated and ascending, whatever order the owner reported them in',
  )
  assert.equal(page.cursor, 5)
})

test('start creates a real scoped DSH session and reports the route the deployment resolved', async () => {
  const dsh = fakeDsh({
    // The deployment resolves the route itself: a canonical model id plus an
    // effort. What the handle reports must be this answer, not our request.
    resolveRoute: request => ({ provider: request.provider, model: 'deepseek-v4.1-flash-2026', reasoningEffort: 'max' }),
  })
  const runtime = new controller.DshAgentRuntime(dsh.api)

  const handle = await runtime.start({
    runId: 'run-scoped',
    workspacePath: 'H:\\Repo\\DSH-MyWork',
    prompt: 'do the work',
    scope: SCOPE,
  })

  assert.equal(handle.runId, 'run-scoped')
  assert.equal(handle.sessionId, 'session-dsh-1', 'the handle must carry the identity DSH minted')
  assert.deepEqual(handle.route, {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash-2026',
    reasoningEffort: 'max',
  })

  assert.deepEqual(dsh.of('session.create').map(call => [call.cwd, call.agentPreset, call.sessionId]), [
    ['H:\\Repo\\DSH-MyWork', 'mywork-worker', undefined],
  ])
  assert.deepEqual(dsh.of('session.selectModel').map(call => [call.provider, call.model]), [
    ['opencode-go', 'deepseek-v4.1-flash'],
  ])
  assert.deepEqual(dsh.of('commands.execute').map(call => call.line), ['/permission workspace-write'])
  assert.deepEqual(dsh.of('session.prompt').map(call => [call.mode, call.text]), [['queue', 'do the work']])
  const requestIds = dsh.of('session.prompt').map(call => call.requestId)
  assert.equal(new Set(requestIds).size, requestIds.length, 'every prompt needs its own identity')
  assert.match(requestIds[0], new RegExp(`^${controller.DSH_REQUEST_ID_PREFIX}`))

  const status = await runtime.status(handle)
  assert.deepEqual(status, { runId: 'run-scoped', sessionId: 'session-dsh-1', running: true })
})

test('a run without a scope pins nothing and invents no defaults', async () => {
  const dsh = fakeDsh()
  const runtime = new controller.DshAgentRuntime(dsh.api)
  const handle = await runtime.start({ runId: 'run-unscoped', workspacePath: '/w', prompt: 'work' })

  assert.equal(handle.route, undefined)
  assert.equal(dsh.of('session.selectModel').length, 0, 'no route may be pinned when the caller stated none')
  assert.equal(dsh.of('commands.execute').length, 0, 'no permission may be pinned when the caller stated none')
  assert.deepEqual(dsh.of('session.create').map(call => call.agentPreset), [undefined])
  assert.equal(dsh.of('session.prompt').length, 1)
})

test('a permission policy the deployment will not install fails the run before the prompt', async () => {
  const noCommand = fakeDsh({ noPermissionCommand: true })
  await assert.rejects(
    new controller.DshAgentRuntime(noCommand.api).start({
      runId: 'run-no-command',
      workspacePath: '/w',
      prompt: 'work',
      scope: SCOPE,
    }),
    adapterErrorWith('unavailable'),
  )
  assert.equal(noCommand.of('session.prompt').length, 0, 'an unscoped run must not start')

  const refused = fakeDsh({ presets: ['read-only'] })
  await assert.rejects(
    new controller.DshAgentRuntime(refused.api).start({
      runId: 'run-refused',
      workspacePath: '/w',
      prompt: 'work',
      scope: SCOPE,
    }),
    error => adapterErrorWith('unavailable')(error) && /unknown preset/.test(error.message),
  )
  assert.equal(refused.of('session.prompt').length, 0)
})

test('resume after a process restart re-asserts the scope on the same real session', async () => {
  const dsh = fakeDsh()
  const before = new controller.DshAgentRuntime(dsh.api)
  const handle = await before.start({
    runId: 'run-restart',
    workspacePath: '/w',
    prompt: 'first',
    scope: SCOPE,
  })
  await before.stop(handle)
  dsh.detachAll()

  // A rebuilt process: nothing survives but the recorded identity and scope.
  const after = new controller.DshAgentRuntime(dsh.api)
  assert.deepEqual(await after.status(handle), {
    runId: 'run-restart',
    sessionId: handle.sessionId,
    running: false,
  }, 'the roster is the truth after a restart, and a detached session reports not running')

  const resumed = await after.resume({
    runId: 'run-restart',
    sessionId: handle.sessionId,
    workspacePath: '/w',
    scope: SCOPE,
  })
  assert.equal(resumed.sessionId, handle.sessionId, 'resume must adopt the session, not mint a second one')
  assert.deepEqual(dsh.sessions.get(handle.sessionId).pins, [
    'model:opencode-go/deepseek-v4.1-flash',
    'permission:workspace-write',
    'model:opencode-go/deepseek-v4.1-flash',
    'permission:workspace-write',
  ], 'resume must re-assert both pins, in order, on the adopted session')
  assert.equal(dsh.of('session.selectModel').length, 2, 'the route is pinned again rather than assumed')
  assert.equal(dsh.of('commands.execute').length, 2, 'the permission policy is pinned again rather than assumed')
  assert.deepEqual(dsh.sessions.get(handle.sessionId).cwd, '/w', 'the workspace is re-asserted, not inherited')

  const roster = await after.status(resumed)
  assert.equal(roster.running, true, 'adoption re-attaches the session')

  await assert.rejects(
    after.resume({ runId: 'run-restart', sessionId: 'session-absent', workspacePath: '/w', scope: SCOPE }),
    adapterErrorWith('invalid-ref'),
  )
  await assert.rejects(
    after.resume({ runId: 'run-restart', sessionId: handle.sessionId, workspacePath: '/elsewhere', scope: SCOPE }),
    adapterErrorWith('conflict'),
    'a workspace that contradicts the record is refused, not silently adopted',
  )
})

test('stop cancels the turn, is idempotent, and never disposes the session', async () => {
  const dsh = fakeDsh()
  const runtime = new controller.DshAgentRuntime(dsh.api)
  const handle = await runtime.start({ runId: 'run-stop', workspacePath: '/w', prompt: 'work', scope: SCOPE })

  await runtime.stop(handle)
  await runtime.stop(handle)
  assert.equal(dsh.of('session.cancel').length, 2, 'stop is idempotent at the port and reaches the platform each time')
  assert.equal((await runtime.status(handle)).running, false)
  assert.equal(dsh.sessions.has(handle.sessionId), true, 'the session record must survive the stop')

  // A host restart detaches every session without ending it: there is no running
  // work left to cancel, and stop has to be settled rather than an error.
  dsh.detachAll()
  await runtime.stop(handle)
  assert.equal(dsh.sessions.has(handle.sessionId), true)
})

test('a session the platform does not know is an invalid reference, not an outage', async () => {
  const dsh = fakeDsh()
  const runtime = new controller.DshAgentRuntime(dsh.api)
  const absent = { runId: 'run-absent', sessionId: 'session-absent' }

  await assert.rejects(runtime.status(absent), adapterErrorWith('invalid-ref'))
  await assert.rejects(runtime.stop(absent), adapterErrorWith('invalid-ref'))
  await assert.rejects(runtime.events(absent), adapterErrorWith('invalid-ref'))

  // A platform failure that is not a missing reference stays an outage, so a
  // caller can never mistake one for the other.
  const broken = fakeDsh({ createFails: dshFailure('gateway/internal', 'the controller fell over') })
  await assert.rejects(
    new controller.DshAgentRuntime(broken.api).start({ runId: 'run-broken', workspacePath: '/w', prompt: 'work' }),
    adapterErrorWith('unavailable'),
  )
})

test('stop surfaces a real cancellation outage instead of reading it as "already stopped"', async () => {
  // The adapter tolerates exactly one refusal from `cancel`: the platform's own
  // "no live agent" answer for a session the roster still holds. Every other
  // failure has to reach the caller, or an outage would look like a settled run.
  const dsh = fakeDsh({ cancelFails: dshFailure('gateway/internal', 'the command runtime fell over') })
  const runtime = new controller.DshAgentRuntime(dsh.api)
  const handle = await runtime.start({ runId: 'run-cancel-fails', workspacePath: '/w', prompt: 'work' })

  await assert.rejects(runtime.stop(handle), adapterErrorWith('unavailable'))
  assert.equal(dsh.of('session.cancel').length, 1, 'the platform was asked exactly once')
})

test('a duplicate and a late delivery are absorbed by the cursor the port reports', async () => {
  const dsh = fakeDsh({ duplicateLast: true, lateEvent: 'late/arrival' })
  const runtime = new controller.DshAgentRuntime(dsh.api)
  const handle = await runtime.start({ runId: 'run-events', workspacePath: '/w', prompt: 'work', scope: SCOPE })

  const first = await runtime.events(handle)
  const positions = first.events.map(event => event.seq)
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right), 'a page is ordered by position')
  assert.equal(new Set(positions).size, positions.length, 'a redelivered position is reported once')
  assert.deepEqual(first.events.filter(event => event.type === 'late/arrival'), [], 'a position at or below the cursor is withheld')
  assert.equal(first.cursor, positions.at(-1))
  assert.equal(first.hasMore, false)

  const again = await runtime.events(handle, first.cursor)
  assert.deepEqual(again.events, [], 'a page must not repeat what the caller already has')
  assert.equal(again.cursor, first.cursor, 'an empty page must not move the cursor')

  const ahead = await runtime.events(handle, first.cursor + 10)
  assert.deepEqual(ahead.events, [])
  assert.equal(ahead.cursor, first.cursor + 10, 'a cursor ahead of the log stays where the caller put it')

  const bounded = await runtime.events(handle, 0, { maxEvents: 1 })
  assert.equal(bounded.events.length, 1)
  assert.equal(bounded.hasMore, true, 'a bounded read that skipped positions must say so')
  assert.equal(bounded.cursor, bounded.events.at(-1).seq, 'the cursor is the last position the page delivered')
  assert.ok(
    bounded.events.at(0).seq > 1,
    'a bounded read serves the newest window, so it may skip the positions right after the caller cursor',
  )
})

test('the scoped permission and route are durable evidence in the session log', async () => {
  const dsh = fakeDsh()
  const runtime = new controller.DshAgentRuntime(dsh.api)
  const handle = await runtime.start({ runId: 'run-evidence', workspacePath: '/w', prompt: 'work', scope: SCOPE })

  const page = await runtime.events(handle)
  const types = page.events.map(event => event.type)
  assert.ok(types.includes('permission/preset'), `the permission pin must reach the log: ${types.join(', ')}`)
  assert.ok(types.includes('model/selection'), `the route pin must reach the log: ${types.join(', ')}`)
  assert.ok(types.includes('turn/start'), 'the admitted prompt must reach the log')
  for (const event of page.events) {
    assert.deepEqual(Object.keys(event).sort(), ['seq', 'time', 'type'], 'the port reports positions, never payloads')
  }
})

test('reading the log releases the opened stream instead of holding the subscription', async () => {
  const dsh = fakeDsh()
  const runtime = new controller.DshAgentRuntime(dsh.api)
  const handle = await runtime.start({ runId: 'run-stream', workspacePath: '/w', prompt: 'work' })

  await runtime.events(handle)
  await runtime.events(handle)
  assert.equal(dsh.of('session.follow').length, 2)
  assert.equal(dsh.releasedCount(), 2, 'every opened stream must be released once the opening frame is read')
  for (const call of dsh.of('session.follow')) {
    assert.equal(call.signal.aborted, true, 'the stream must be cancelled with its read')
  }
})

test('a call the caller already cancelled never reaches the platform', async () => {
  const dsh = fakeDsh()
  const runtime = new controller.DshAgentRuntime(dsh.api)
  const aborted = AbortSignal.abort()

  await assert.rejects(
    runtime.start({ runId: 'run-aborted', workspacePath: '/w', prompt: 'work' }, { signal: aborted }),
    adapterErrorWith('cancelled'),
  )
  await assert.rejects(
    runtime.resume(
      { runId: 'run-aborted', sessionId: 'session-dsh-1', workspacePath: '/w' },
      { signal: aborted },
    ),
    adapterErrorWith('cancelled'),
  )
  assert.deepEqual(dsh.calls, [], 'nothing may be created, pinned, prompted, or read for a cancelled call')
})

test('the controller registers both DSH ports and unload removes them', async () => {
  const dsh = fakeDsh()
  const ctx = new Context()
  await ctx.plugin({
    name: 'fake-dsh-services',
    apply(context) {
      context.provide(controller.DSH_SESSION_SERVICE, dsh.api.controller)
      context.provide(controller.DSH_AGENTS_SERVICE, dsh.api.agents)
      context.provide(controller.DSH_COMMANDS_SERVICE, dsh.api.commands)
    },
  })
  const fiber = ctx.plugin(controller, { diagnostics: false })
  await fiber.await()

  const adapters = ctx.get(contracts.MYWORK_ADAPTERS_SERVICE)
  assert.deepEqual(
    adapters.list('session').map(manifest => [manifest.adapterId, manifest.contractVersion]),
    [['dsh-session', 'session/v1']],
  )
  assert.deepEqual(
    adapters.list('agent-runtime').map(manifest => [manifest.adapterId, manifest.contractVersion]),
    [['dsh-agent-runtime', 'agent-runtime/v1']],
  )
  // The record surface must not answer for run control it does not offer: the
  // registry resolves by declared capability, so a wide manifest on `session`
  // would hand a caller a port that cannot do what it asked for.
  assert.equal(
    adapterSdk.supportsCapability(adapters.list('session')[0], 'scopedTools'),
    false,
    'the session port must not declare agent-runtime capabilities',
  )
  assert.deepEqual(
    adapters.resolve('session', { capabilities: ['scopedTools'] }).ok,
    false,
    'requiring an agent-runtime capability of the session port must be refused',
  )

  const runtime = adapters.require('agent-runtime', { capabilities: ['create', 'resume', 'stop', 'status', 'events'] })
  const handle = await runtime.start({ runId: 'run-registry', workspacePath: '/w', prompt: 'work', scope: SCOPE })
  assert.equal(handle.sessionId, 'session-dsh-1')
  const session = adapters.require('session', { capabilities: ['create', 'events'] })
  const page = await session.events(handle.sessionId)
  assert.ok(page.events.length > 0)

  await fiber.dispose()
  assert.equal(ctx.get(contracts.MYWORK_ADAPTERS_SERVICE), undefined, 'the registry goes with the plugin')
  assert.deepEqual(adapters.list('session'), [], 'the session registration must not outlive the fiber')
  assert.deepEqual(adapters.list('agent-runtime'), [], 'the runtime registration must not outlive the fiber')
})

test('a profile without the DSH session controller mounts the controller and registers no session port', async () => {
  const ctx = new Context()
  const fiber = ctx.plugin(controller, { diagnostics: false })
  await fiber.await()

  const adapters = ctx.get(contracts.MYWORK_ADAPTERS_SERVICE)
  assert.deepEqual(adapters.list('session'), [])
  assert.deepEqual(adapters.list('agent-runtime'), [])

  // A service that answers some of the surface is reported, never half-bound.
  const partial = new Context()
  await partial.plugin({
    name: 'partial-session-controller',
    apply(context) {
      context.provide(controller.DSH_SESSION_SERVICE, { create: () => ({}), list: () => ({ items: [] }) })
    },
  })
  const partialFiber = partial.plugin(controller, { diagnostics: false })
  await partialFiber.await()
  assert.deepEqual(partial.get(contracts.MYWORK_ADAPTERS_SERVICE).list('agent-runtime'), [])

  await fiber.dispose()
  await partialFiber.dispose()
})
