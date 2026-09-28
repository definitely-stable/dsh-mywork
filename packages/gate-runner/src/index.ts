/**
 * `@dsh-mywork/gate-runner` — deterministic verification gates (§19).
 *
 * The package turns a workspace's gates into typed verdicts pinned to an exact
 * head, with the log of every gate stored as `gate-result` evidence before the
 * verdict is returned. Its contract vocabulary (`GateSpec`, `GateResult`,
 * `GateVerdict`, `GatePolicy`, `GateRefusalReason`) lives in
 * `@dsh-mywork/contracts`, which is the one place the verdict language is
 * defined.
 * @module
 */

export * from './errors.ts'
export * from './runner.ts'
export * from './policy.ts'
export * from './port.ts'
