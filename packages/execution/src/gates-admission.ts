/**
 * Gate admission: a failing or missing verification blocks review (§19, §32;
 * MW-023, E-17).
 *
 * §19 makes review admission the place where verification is checked, and §19's
 * acceptance is stated as an inequality rather than a sequence: **no passing
 * required gate for this exact head means no review**. This module is that check
 * and nothing else — it reads the `gate-result` evidence of one attempt and
 * decides, purely, whether the attempt may be put in front of a reviewer.
 *
 * Three properties are deliberate.
 *
 * - **The check is pure.** {@link assertGatesSatisfied} takes the records it
 *   judges; reading them from the artifact store is {@link readGateResults}. The
 *   review queue (`E-19`) therefore has one call to make, and the decision itself
 *   is testable without a database.
 * - **A verdict belongs to an exact head.** A record whose `headSha` is not the
 *   head under admission is not evidence about that head, so it never counts as a
 *   pass — the gate counts as *missing for this head* and admission is refused.
 * - **Nothing here can turn a broken record into a pass.** A malformed
 *   `gate-result` is a `CONTRACT_MISMATCH` refusal, not an empty result set: an
 *   empty set would read as "no gates configured", which is a different fact.
 * @module
 */

import type {
  AttemptId,
  GateRefusalReason,
  GateResult,
  GateVerdict,
  MyWorkErrorShape,
  OperationMeta,
  Result,
} from '@dsh-mywork/contracts'
import {
  GATE_REFUSAL_REASONS,
  GATE_RESULT_FIELDS,
  GIT_SHA_LENGTH,
  isGateVerdict,
} from '@dsh-mywork/contracts'
import { fail, MyWorkError, ok } from '@dsh-mywork/core'
import { getArtifact } from '@dsh-mywork/evidence'
import type { MyWorkStore } from '@dsh-mywork/storage'

import { ExecutionError } from './errors.ts'

/** Length of a lowercase hex SHA-256, as an artifact hash is stored. */
const SHA256_HEX_LENGTH = 64

/** The one refusal reason review admission reports. */
export const REVIEW_ADMISSION_REFUSAL: GateRefusalReason = 'REVIEW_GATES_MISSING'

/** One stored `gate-result` artifact, as SQLite returns it. */
interface GateResultRow {
  readonly artifact_id: string
  readonly hash: string
}

/**
 * The decision of {@link assertGatesSatisfied} when the gates allow a review.
 *
 * Only the results for the admitted head appear here: a record about another
 * head proves nothing about this one and is never carried forward.
 */
export interface GateAdmission {
  /** Attempt the verdicts belong to. */
  readonly attemptId: AttemptId
  /** Exact head the gates passed on. */
  readonly headSha: string
  /** Latest passing result of every required gate, in the order the gates were recorded. */
  readonly results: readonly GateResult[]
}

/** What a caller may state about the gate set it is admitting. */
export interface GateAdmissionOptions {
  /**
   * Ids of the gates whose failure blocks admission.
   *
   * Absent means **every recorded gate is required**: a caller that does not say
   * which gates are informational has not earned a weaker check, and treating an
   * unstated gate as optional is how a failing check would silently stop
   * mattering. A required id with no result at all is refused the same way a
   * failing one is.
   */
  readonly requiredGateIds?: readonly string[]
}

/** One gate that kept admission from happening, with the fact that kept it. */
interface GateBlock {
  /** Gate identifier. */
  readonly id: string
  /** Why this gate does not admit: its verdict, or the head it answered about. */
  readonly reason: 'missing' | 'head-moved' | 'not-passing'
  /** Verdict the gate reached, when it reached one for this head. */
  readonly verdict?: GateVerdict
}

/**
 * Identity the check's result carries.
 *
 * The check mutates nothing, so it has no operation of its own. The identity is
 * derived from what it decided about, so a refusal can still be correlated with
 * the attempt it refused without this layer minting a random id.
 * @param attemptId - attempt under admission.
 * @param headSha - head under admission; may be empty when only the attempt is known.
 */
function admissionMeta(attemptId: AttemptId, headSha: string): OperationMeta {
  return Object.freeze({
    operationId: `gate-admission-${attemptId}`,
    correlationId: `gate-admission-${attemptId}-${headSha}`,
  })
}

/** Reject a malformed argument before anything is read. */
function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ExecutionError('invalid-input', `dsh-mywork: ${field} must be a non-empty string`)
  }
  return value
}

/** Whether a value is a 40-character lowercase hex git object name. */
function isSha(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${GIT_SHA_LENGTH}}$`).test(value)
}

/**
 * Parse one stored `gate-result` payload.
 *
 * The shape is closed: a record carrying a field the contract does not declare,
 * or a verdict outside the five, is not a gate result this layer may act on.
 * @param bytes - the artifact's bytes.
 * @returns the result, or `undefined` when the payload is not one.
 */
function parseGateResult(bytes: Uint8Array): GateResult | undefined {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!GATE_RESULT_FIELDS.includes(key)) return undefined
  }
  const id = record['id']
  const headSha = record['headSha']
  const exitCode = record['exitCode']
  const verdict = record['verdict']
  const reason = record['reason']
  const artifactRef = record['artifactRef']
  if (typeof id !== 'string' || id.trim() === '') return undefined
  if (!isSha(headSha)) return undefined
  if (exitCode !== null && !Number.isSafeInteger(exitCode)) return undefined
  if (!isGateVerdict(verdict)) return undefined
  if (reason !== undefined && !(GATE_REFUSAL_REASONS as readonly unknown[]).includes(reason)) return undefined
  if (typeof artifactRef !== 'object' || artifactRef === null || Array.isArray(artifactRef)) return undefined
  const ref = artifactRef as Record<string, unknown>
  const artifactId = ref['artifactId']
  const hash = ref['hash']
  if (typeof artifactId !== 'string' || artifactId.trim() === '') return undefined
  if (typeof hash !== 'string' || !new RegExp(`^[0-9a-f]{${SHA256_HEX_LENGTH}}$`).test(hash)) return undefined
  return Object.freeze({
    id,
    headSha,
    exitCode: exitCode as number | null,
    verdict,
    ...(reason === undefined ? {} : { reason: reason as GateRefusalReason }),
    artifactRef: Object.freeze({ artifactId, hash }),
  })
}

/**
 * Read the `gate-result` evidence of one attempt, oldest first.
 *
 * Results are returned in the order they were recorded — creation time, then
 * artifact id — which is what makes "the last result of a gate wins" a
 * deterministic rule rather than a matter of iteration order.
 * @param store - an open store carrying the evidence schema.
 * @param attemptId - attempt whose gate results are read.
 * @throws {ExecutionError} `invalid-input` when the attempt id is malformed.
 */
export function readGateResults(store: MyWorkStore, attemptId: AttemptId): Result<readonly GateResult[]> {
  const id = requireText(attemptId, 'attemptId')
  const meta = admissionMeta(id, '')
  const rows = store.transaction(tx =>
    tx.all(
      `SELECT artifact_id, hash FROM artifacts
        WHERE kind = 'gate-result' AND attempt_id = ?
        ORDER BY created_at, artifact_id`,
      id,
    ),
  )
  const results: GateResult[] = []
  for (const raw of rows) {
    const row = raw as unknown as GateResultRow
    const artifactId = String(row.artifact_id)
    const hash = String(row.hash)
    let bytes: Uint8Array
    try {
      bytes = store.transaction(tx => getArtifact(tx, { artifactId, hash })).bytes
    } catch (error) {
      return fail(
        new MyWorkError(
          'CONTRACT_MISMATCH',
          `dsh-mywork: the gate result "${artifactId}" of attempt "${id}" could not be read: ${String(error)}`,
          { details: { attemptId: id, artifactId, reason: 'gate-result-unreadable' } },
        ),
        meta,
      )
    }
    const parsed = parseGateResult(bytes)
    if (parsed === undefined) {
      return fail(
        new MyWorkError(
          'CONTRACT_MISMATCH',
          `dsh-mywork: the artifact "${artifactId}" of attempt "${id}" is stored as a gate result but does not carry one`,
          { details: { attemptId: id, artifactId, reason: 'gate-result-malformed' } },
        ),
        meta,
      )
    }
    results.push(parsed)
  }
  return ok(Object.freeze(results), meta)
}

/**
 * Whether the gates of one attempt admit it to review (§19).
 *
 * The last result recorded for a gate is the one that counts; a gate whose last
 * result is about another head has not answered about this one; and only `pass`
 * admits. `error`, `timeout`, and `cancelled` are refusals exactly like `fail`,
 * because "the runner was missing" is not evidence of success.
 *
 * A caller that states no required set gets the strict reading — every recorded
 * gate must pass — and a caller that states an empty one gets the strictest: an
 * empty set verified nothing, so it admits nothing.
 * @param attemptId - attempt under admission.
 * @param headSha - exact head the attempt produced, as 40 lowercase hex characters.
 * @param results - the attempt's `gate-result` records, oldest first.
 * @param options - which gates are required; absent means all of them.
 * @returns the admitted results, or the `REVIEW_GATES_MISSING` refusal with the
 *   gates that caused it in `details.blocks`.
 * @throws {ExecutionError} `invalid-input` when an argument is malformed.
 */
export function assertGatesSatisfied(
  attemptId: AttemptId,
  headSha: string,
  results: readonly GateResult[],
  options: GateAdmissionOptions = {},
): Result<GateAdmission> {
  const id = requireText(attemptId, 'attemptId')
  if (!isSha(headSha)) {
    throw new ExecutionError(
      'invalid-input',
      `dsh-mywork: headSha must be ${GIT_SHA_LENGTH} lowercase hex characters, received ${String(headSha)}`,
    )
  }
  if (!Array.isArray(results)) {
    throw new ExecutionError('invalid-input', 'dsh-mywork: gate results must be an array')
  }
  const required = options.requiredGateIds
  if (required !== undefined && !Array.isArray(required)) {
    throw new ExecutionError('invalid-input', 'dsh-mywork: requiredGateIds must be an array')
  }
  const meta = admissionMeta(id, headSha)
  const requiredSet = required === undefined ? undefined : new Set(required)

  // The last record of each gate wins; the map keeps first-seen order, so the
  // admitted set is reported in the order the policy ran the gates.
  const latest = new Map<string, GateResult>()
  for (const result of results) {
    if (typeof result !== 'object' || result === null) {
      throw new ExecutionError('invalid-input', 'dsh-mywork: every gate result must be an object')
    }
    const gateId = requireText(result.id, 'a gate result id')
    if (!isSha(result.headSha)) {
      throw new ExecutionError(
        'invalid-input',
        `dsh-mywork: gate "${gateId}" carries no ${GIT_SHA_LENGTH}-character head`,
      )
    }
    if (!isGateVerdict(result.verdict)) {
      throw new ExecutionError('invalid-input', `dsh-mywork: gate "${gateId}" carries an unknown verdict`)
    }
    latest.set(gateId, result)
  }

  const blocks: GateBlock[] = []
  const admitted: GateResult[] = []
  for (const [gateId, result] of latest) {
    if (requiredSet !== undefined && !requiredSet.has(gateId)) continue
    if (result.headSha !== headSha) {
      blocks.push(Object.freeze({ id: gateId, reason: 'head-moved' as const }))
      continue
    }
    if (result.verdict !== 'pass') {
      blocks.push(Object.freeze({ id: gateId, reason: 'not-passing' as const, verdict: result.verdict }))
      continue
    }
    admitted.push(result)
  }
  if (requiredSet !== undefined) {
    for (const gateId of requiredSet) {
      if (!latest.has(gateId)) blocks.push(Object.freeze({ id: gateId, reason: 'missing' as const }))
    }
  }

  if (blocks.length === 0 && admitted.length > 0) {
    return ok(Object.freeze({ attemptId: id, headSha, results: Object.freeze(admitted) }), meta)
  }
  const empty: MyWorkErrorShape = {
    code: 'TASK_CONFLICT',
    // §19's acceptance in one sentence: nothing verified this head, so review
    // admission is refused and the reason names the gates that kept it out.
    message: `dsh-mywork: attempt "${id}" has no complete passing gate set for head ${headSha}`,
    details: Object.freeze({
      attemptId: id,
      headSha,
      refusal: REVIEW_ADMISSION_REFUSAL,
      blocks: Object.freeze(blocks),
    }),
  }
  return fail(empty, meta)
}
