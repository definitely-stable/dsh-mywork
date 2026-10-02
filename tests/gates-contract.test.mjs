/**
 * Verification-gate contract acceptance (architecture §19, §32; MW-023, E-13).
 *
 * What has to hold: a gate verdict is a typed value rather than a log line, the
 * verdict vocabulary is closed and only `pass` admits work, and the artifact
 * vocabulary grew by exactly one kind — additively, after `gate-decision`, with
 * no existing kind reinterpreted. A "missing gate" is a refusal reason carried
 * by a record, never the absence of one.
 *
 * Every list below is a literal transcription of what the plan fixes, so an
 * edit to a contract has to edit this file too instead of sliding past it.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { contracts } from './lib/fixtures.mjs'

/** Artifact kinds §32 listed before `gate-result` was added, in order. */
const KINDS_BEFORE_GATE_RESULT = [
  'diff',
  'commit',
  'build-log',
  'test-report',
  'screenshot',
  'benchmark',
  'worker-report',
  'review-verdict',
  'planner-dag',
  'context-snapshot',
  'checkpoint',
  'gate-decision',
]

/** The five verdicts §19 names, in the order §19 lists them. */
const VERDICTS = ['pass', 'fail', 'error', 'timeout', 'cancelled']

/** Every refusal reason the gate vocabulary carries. */
const REFUSAL_REASONS = [
  'GATE_UNCONFIGURED',
  'GATE_MISSING',
  'GATE_TOOL_MISSING',
  'GATE_DUPLICATE_ID',
  'GATE_HEAD_MOVED',
  'REVIEW_GATES_MISSING',
]

/** Fields `GateSpec` is closed over, in declared order. */
const SPEC_FIELDS = ['id', 'command', 'args', 'timeoutMs', 'required', 'cwd']

/** Fields `GateResult` is closed over, in declared order. */
const RESULT_FIELDS = ['id', 'headSha', 'exitCode', 'verdict', 'reason', 'artifactRef']

/** A syntactically valid head, so the shape assertions have a real subject. */
const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567'

test('the artifact vocabulary grew by exactly one kind, after gate-decision', () => {
  const kinds = [...contracts.ARTIFACT_KINDS]
  assert.deepEqual(
    kinds.slice(0, KINDS_BEFORE_GATE_RESULT.length),
    KINDS_BEFORE_GATE_RESULT,
    'the kinds §32 listed before this step must keep their exact order',
  )
  assert.equal(kinds.length, KINDS_BEFORE_GATE_RESULT.length + 1, 'exactly one kind may be added')
  assert.equal(kinds.at(-1), 'gate-result')
  assert.equal(kinds.at(-2), 'gate-decision', 'gate-result is appended after gate-decision, never replacing it')
  assert.ok(Object.isFrozen(contracts.ARTIFACT_KINDS), 'the artifact vocabulary must stay frozen')
})

test('the five verdicts are closed, and only pass admits the work', () => {
  assert.deepEqual([...contracts.GATE_VERDICTS], VERDICTS)
  assert.ok(Object.isFrozen(contracts.GATE_VERDICTS), 'the verdict vocabulary must stay frozen')
  for (const verdict of VERDICTS) {
    assert.ok(contracts.isGateVerdict(verdict), `${verdict} must be a verdict`)
  }
  // A tool failure, a timeout, and a cancellation are failures of the same
  // weight as a red test run: none of them may be read as success.
  for (const verdict of ['fail', 'error', 'timeout', 'cancelled']) {
    assert.notEqual(verdict, 'pass')
    assert.equal(contracts.isGatePassing(verdict), false, `${verdict} must not admit the work`)
  }
  assert.equal(contracts.isGatePassing('pass'), true, 'pass is the only admitting verdict')
  // There is no sixth verdict: not "skipped", not "unknown", not a prefix.
  for (const value of ['skipped', 'passed', 'ok', 'PASS', '', null, 0, undefined]) {
    assert.equal(contracts.isGateVerdict(value), false, `${String(value)} must not be a verdict`)
  }
})

test('GateSpec is closed over the fields that make a gate runnable and bounded', () => {
  assert.deepEqual([...contracts.GATE_SPEC_FIELDS], SPEC_FIELDS)
  // The four without which no run can happen: identity, executable, arguments,
  // and the bound. A spec lacking any of them is not a gate.
  for (const field of ['id', 'command', 'args', 'timeoutMs']) {
    assert.ok(contracts.GATE_SPEC_FIELDS.includes(field), `GateSpec must declare ${field}`)
  }
})

test('GateResult is closed over the verdict, the exit code, the head, and the evidence', () => {
  assert.deepEqual([...contracts.GATE_RESULT_FIELDS], RESULT_FIELDS)
  assert.equal(contracts.GIT_SHA_LENGTH, 40)
  assert.ok(new RegExp(`^[0-9a-f]{${contracts.GIT_SHA_LENGTH}}$`).test(HEAD_SHA))
  // A verdict without evidence is not a verdict: the artifact reference is part
  // of the shape, so a caller cannot store a gate that produced no log.
  assert.ok(contracts.GATE_RESULT_FIELDS.includes('artifactRef'))
})

test('a missing gate is a refusal reason carried by a record, not an absent record', () => {
  assert.deepEqual([...contracts.GATE_REFUSAL_REASONS], REFUSAL_REASONS)
  assert.ok(Object.isFrozen(contracts.GATE_REFUSAL_REASONS), 'the refusal vocabulary must stay frozen')
  assert.ok(contracts.GATE_REFUSAL_REASONS.includes('GATE_MISSING'))
  assert.ok(contracts.GATE_REFUSAL_REASONS.includes('GATE_UNCONFIGURED'))
  for (const reason of REFUSAL_REASONS) {
    assert.ok(contracts.isGateRefusalReason(reason), `${reason} must be a refusal reason`)
  }
  assert.equal(contracts.isGateRefusalReason('GATE_SKIPPED'), false, 'there is no "skipped" reason')
  // "No gate ran" therefore has to be recorded as `error` + `GATE_MISSING`; if
  // `missing` were a verdict, an absent record could stand in for it.
  assert.equal(contracts.isGateVerdict('missing'), false)
  assert.deepEqual([...contracts.GATE_POLICY_FIELDS], ['workspaceId', 'gates', 'strict'])
  assert.deepEqual([...contracts.GATE_RUN_RESULT_FIELDS], ['headSha', 'results', 'refusal'])
})
