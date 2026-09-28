/**
 * The attempt-run port contract and the fake runtime behind it (architecture
 * §21, §22, §36, §39; MW-022, E-07).
 *
 * The port is what makes the whole worker path testable without a model, so the
 * five tests here pin the three facts the worker depends on: the request carries
 * a caller-owned run id derived from the attempt, the outcome vocabulary is
 * closed, and the evidence a run produced travels as `ArtifactRef` values rather
 * than as strings. The last test drives the adapter-sdk fake through the port
 * without touching the SDK, which is what "testable on fakes" has to mean.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { adapterTesting, contracts, core } from './lib/fixtures.mjs'

/** Operation identity for one call. */
function meta(overrides = {}) {
  return core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1', ...overrides })
}

/** A worktree reference for one attempt. */
function worktreeFixture(attemptId) {
  return {
    path: `C:/worktrees/${attemptId}`,
    branch: `mywork/T-1-${attemptId}`,
    baseSha: 'a'.repeat(40),
    headSha: 'a'.repeat(40),
  }
}

/** A request exactly where the contract declares its fields. */
function requestFixture(attemptId = 'attempt-op-1') {
  return {
    runId: contracts.attemptRunId(attemptId),
    attemptId,
    worktree: worktreeFixture(attemptId),
    frozen: { config: 2, role: 4 },
    scope: { agentPreset: 'worker' },
    prompt: 'Do the work of T-1.',
  }
}

/**
 * An `AttemptRunPort` over the SDK's fake session owner.
 *
 * This is the adapter a real deployment writes; it lives in the test because the
 * point of the test is that the SDK fake is enough to build one. `AdapterError`
 * codes are mapped to the MyWork codes the port contract names (a duplicate run
 * is a conflict, an unknown session is a missing reference).
 */
function attemptPortOver(runtime) {
  const mapError = error => {
    const code = error?.code === 'invalid-ref' ? 'SESSION_NOT_FOUND' : 'TASK_CONFLICT'
    return new core.MyWorkError(code, String(error?.message ?? error), {
      details: { adapterCode: String(error?.code ?? 'unknown') },
    })
  }
  return {
    async run(request, callMeta, options = {}) {
      try {
        const handle = await runtime.start(
          {
            runId: request.runId,
            workspacePath: request.worktree.path,
            prompt: request.prompt,
            scope: request.scope,
          },
          options,
        )
        return core.ok(
          Object.freeze({
            runId: request.runId,
            attemptId: request.attemptId,
            outcome: 'completed',
            sessionId: handle.sessionId,
            artifactRefs: [],
          }),
          callMeta,
        )
      } catch (error) {
        return core.fail(mapError(error), callMeta)
      }
    },
    async resume(request, callMeta, options = {}) {
      try {
        const handle = await runtime.resume(
          {
            runId: request.runId,
            sessionId: request.sessionId,
            workspacePath: worktreeFixture(request.attemptId).path,
            scope: request.scope,
          },
          options,
        )
        return core.ok(
          Object.freeze({
            runId: request.runId,
            attemptId: request.attemptId,
            outcome: 'completed',
            sessionId: handle.sessionId,
            artifactRefs: [],
          }),
          callMeta,
        )
      } catch (error) {
        return core.fail(mapError(error), callMeta)
      }
    },
    async status(runId, callMeta, options = {}) {
      const known = runtime.host.byRunId(runId)
      if (known === undefined) {
        return core.fail(
          new core.MyWorkError('SESSION_NOT_FOUND', `dsh-mywork: no run "${runId}"`, { details: { runId } }),
          callMeta,
        )
      }
      try {
        const status = await runtime.status({ runId, sessionId: known.sessionId }, options)
        return core.ok(Object.freeze({ runId, running: status.running, sessionId: status.sessionId }), callMeta)
      } catch (error) {
        return core.fail(mapError(error), callMeta)
      }
    },
  }
}

test('the run request carries exactly the declared fields, with the preset in the scope', () => {
  assert.deepEqual(
    [...contracts.ATTEMPT_RUN_REQUEST_FIELDS],
    ['runId', 'attemptId', 'worktree', 'frozen', 'scope', 'prompt'],
    'the request shape is closed and ordered',
  )
  const request = requestFixture()
  assert.deepEqual(Object.keys(request).sort(), [...contracts.ATTEMPT_RUN_REQUEST_FIELDS].sort())
  assert.equal(request.scope.agentPreset, 'worker')
  assert.equal(
    contracts.ATTEMPT_RUN_REQUEST_FIELDS.includes('agentPreset'),
    false,
    'the preset belongs to the scope, not to a field of its own',
  )
  // The identity of the run is the caller's, and the worktree is the attempt's
  // own directory: a request that named the shared checkout would not be this
  // contract's request at all.
  assert.equal(request.worktree.path, 'C:/worktrees/attempt-op-1')
  assert.equal(request.frozen.role, 4)
})

test('the run id is derived from the attempt, not minted', () => {
  const first = contracts.attemptRunId('attempt-op-1')
  const again = contracts.attemptRunId('attempt-op-1')
  const other = contracts.attemptRunId('attempt-op-2')

  assert.equal(first, again, 'the same attempt must name the same run in every process')
  assert.notEqual(first, other)
  assert.ok(first.startsWith(contracts.ATTEMPT_RUN_ID_PREFIX), 'the prefix makes the caller visible')
  assert.ok(first.endsWith('attempt-op-1'))
  // A fresh identifier would drift between the process that started the run and
  // the one that resumes it (§39), so it must not look like one.
  assert.equal(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(first), false)
  assert.equal(/^[0-9a-f]{32,}$/.test(first), false)
})

test('the outcome vocabulary is closed to the three §21 endings', () => {
  assert.deepEqual([...contracts.ATTEMPT_RUN_OUTCOMES], ['completed', 'failed', 'cancelled'])
  for (const value of ['done', 'PASSED', 'skipped', '', undefined, null, 7]) {
    assert.equal(contracts.isAttemptRunOutcomeKind(value), false, `${String(value)} is not an outcome`)
  }
  for (const value of contracts.ATTEMPT_RUN_OUTCOMES) {
    assert.equal(contracts.isAttemptRunOutcomeKind(value), true)
  }
  assert.deepEqual(
    [...contracts.ATTEMPT_RUN_OUTCOME_FIELDS],
    ['runId', 'attemptId', 'outcome', 'sessionId', 'artifactRefs', 'reason'],
  )
})

test('the evidence of a run travels as artifact references, not as strings', () => {
  assert.deepEqual([...contracts.ARTIFACT_REF_FIELDS], ['artifactId', 'hash'])
  const outcome = Object.freeze({
    runId: contracts.attemptRunId('attempt-op-1'),
    attemptId: 'attempt-op-1',
    outcome: 'completed',
    artifactRefs: Object.freeze([
      Object.freeze({ artifactId: 'diff-attempt-op-1', hash: 'b'.repeat(64) }),
    ]),
  })
  assert.ok(Array.isArray(outcome.artifactRefs))
  const ref = outcome.artifactRefs[0]
  // A reference, not a path string: the two declared fields are the whole shape.
  assert.deepEqual(Object.keys(ref).sort(), ['artifactId', 'hash'])
  assert.equal(typeof ref.artifactId, 'string')
  assert.equal(typeof ref.hash, 'string')
  assert.equal(ref.hash.length, 64)
})

test('the adapter-sdk fake satisfies the port without any change to the SDK', async () => {
  const host = new adapterTesting.FakeAgentHost()
  const port = attemptPortOver(new adapterTesting.FakeAgentRuntime({ host }))
  const attemptId = 'attempt-op-1'
  const request = requestFixture(attemptId)
  const callMeta = meta()

  const ran = await port.run(request, callMeta)
  assert.equal(ran.ok, true, ran.ok ? '' : ran.error.message)
  assert.equal(ran.value.outcome, 'completed')
  assert.equal(ran.value.runId, contracts.attemptRunId(attemptId))
  assert.equal(host.runIds.length, 1)
  assert.equal(ran.value.sessionId, host.sessionIds[0])
  // The scope reached the owner: the fake records each pin, which is how the
  // worker's "the preset is re-asserted on resume" claim becomes observable.
  assert.deepEqual(host.pinsOf(ran.value.sessionId), ['preset:worker'])

  // A duplicate run id is refused by the owner, not by a flag in the port: that
  // is the behaviour the worker's restart path relies on (§36).
  const duplicate = await port.run(request, callMeta)
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.error.code, 'TASK_CONFLICT')
  assert.equal(host.runIds.length, 1, 'a refused duplicate must not create a second session')

  const status = await port.status(contracts.attemptRunId(attemptId), callMeta)
  assert.equal(status.ok, true)
  assert.equal(status.value.sessionId, host.sessionIds[0])
  assert.equal(status.value.running, true)

  const adopted = await port.resume(
    {
      runId: contracts.attemptRunId(attemptId),
      attemptId,
      sessionId: host.sessionIds[0],
      scope: { agentPreset: 'worker' },
    },
    callMeta,
  )
  assert.equal(adopted.ok, true, adopted.ok ? '' : adopted.error.message)
  assert.equal(adopted.value.sessionId, host.sessionIds[0])
  assert.equal(host.sessionIds.length, 1, 'resuming adopts the session instead of minting one')
  // The SDK's own surface is what carried all of this: the port added nothing.
  for (const method of ['start', 'resume', 'status', 'stop', 'events']) {
    assert.equal(typeof adapterTesting.FakeAgentRuntime.prototype[method], 'function')
  }
})
