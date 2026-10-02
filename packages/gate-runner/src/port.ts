/**
 * The attempt gate port: the seam the worker asks for the verdicts it records
 * before review (architecture §19; MW-023, E-17).
 *
 * `packages/execution` cannot spawn a process — `node:crypto` is the only
 * external import of its bundle — so the runner is injected through
 * `AttemptGatePort` from `@dsh-mywork/contracts`, and this module is the one
 * implementation of that seam: {@link createAttemptGatePort} adapts
 * {@link runGatePolicy} to it. Three rules shape the adapter.
 *
 * - **The head is the request's, never the worktree's.** A verdict is evidence
 *   about the commit the caller pinned, so every answer carries
 *   `request.headSha` and the port never re-derives it from whatever the
 *   worktree happens to point at. A caller that injects a real reader gets the
 *   §19 protection instead of a second opinion: a reading that differs from the
 *   pin refuses the whole run with `GATE_HEAD_MOVED`, and the logs stay behind as
 *   the evidence of why.
 * - **A policy refusal is a value.** A workspace with no policy
 *   (`GATE_UNCONFIGURED`), a policy with duplicate gate ids
 *   (`GATE_DUPLICATE_ID`), and a head that moved (`GATE_HEAD_MOVED`) are all
 *   `{ ok: true }` answers whose `GateRunResult.refusal` says what happened,
 *   because the worker branches on them and records them as the attempt's
 *   outcome. None of them is a `pass`.
 * - **Only a defect of configuration still throws.** `invalid-policy`,
 *   `invalid-spec`, and an unreadable head are not facts about the attempt but
 *   symptoms of a broken composition; answering them with a verdict-shaped value
 *   would hide the defect behind evidence.
 * @module
 */

import { isAbsolute } from 'node:path'

import {
  ATTEMPT_GATE_REQUEST_FIELDS,
  GIT_SHA_LENGTH,
  type AttemptGatePort,
  type AttemptGateRequest,
  type ClockPort,
  type GatePolicy,
  type GateRefusalReason,
  type GateRunResult,
  type MyWorkErrorShape,
  type OperationMeta,
  type Result,
} from '@dsh-mywork/contracts'

import { isGateError } from './errors.ts'
import { resolveGatePolicy, runGatePolicy, type GatePolicySource } from './policy.ts'
import type { GateArtifactSink, HeadReader } from './runner.ts'

/** The refusal a request that cannot be acted on earns (`CONTRACT_MISMATCH`). */
const REQUEST_REFUSAL_CODE = 'CONTRACT_MISMATCH'

/**
 * The internal signal that the worktree is not at the pinned head.
 *
 * It is not a `GateError`: the gate-runner vocabulary names failures of a spec,
 * a policy, or a head that could not be read, and "the caller's pin and the
 * checkout disagree" is none of those — it is §19's exact-head refusal, which is
 * a value of the run rather than an error code.
 */
class PinnedHeadMoved extends Error {
  /** The head the request pinned. */
  readonly pinned: string

  /** The head the checkout reported. */
  readonly observed: string

  /**
   * @param pinned - the head the request pinned.
   * @param observed - the head the injected reader reported.
   */
  constructor(pinned: string, observed: string) {
    super(`dsh-mywork: the worktree is at ${observed}, not at the pinned ${pinned}`)
    this.name = 'PinnedHeadMoved'
    this.pinned = pinned
    this.observed = observed
  }
}

/** Everything the port runs with; every one of them is injected. */
export interface AttemptGatePortOptions {
  /** Gate sets by workspace; a workspace without one is refused, never defaulted. */
  readonly policies: GatePolicySource
  /** Time source for the stored logs; the port reads no wall clock. */
  readonly clock: ClockPort
  /** Where each gate's log is stored before its verdict is returned. */
  readonly artifacts: GateArtifactSink
  /**
   * Optional reader of the worktree's head.
   *
   * Absent — the default — means the port trusts the caller's pin and runs no
   * git at all. Supplied, it is used *only* to refuse a checkout that moved:
   * the pin in the request stays the head of every verdict either way.
   */
  readonly readHead?: HeadReader
  /** Caller cancellation; an aborted gate is `cancelled`, never `pass`. */
  readonly signal?: AbortSignal
  /** Bound on one gate's captured output; defaults to the runner's bound. */
  readonly maxBufferBytes?: number
}

/** A validated request, or the refusal that kept it from running. */
type RequestCheck =
  | { readonly ok: true; readonly request: AttemptGateRequest }
  | { readonly ok: false; readonly error: MyWorkErrorShape }

/** One malformed-request refusal, addressed to the field that caused it. */
function refusalOfField(field: string, reason: string, message: string): MyWorkErrorShape {
  return Object.freeze({
    code: REQUEST_REFUSAL_CODE,
    message,
    details: Object.freeze({ field, reason }),
  })
}

/** Whether a value is a 40-character lowercase hex git object name. */
function isSha(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${GIT_SHA_LENGTH}}$`).test(value)
}

/**
 * Check a request before a policy is looked up, a process is spawned, or a log
 * is stored.
 *
 * The shape is closed: an undeclared field is refused rather than ignored, so a
 * caller cannot believe it passed a bound the port never read. The worktree path
 * must be absolute and must not climb out of itself (`..`), because the gates of
 * a policy run relative to it and a path that escapes its own root is not the
 * attempt's checkout.
 * @param value - the request the worker sent.
 * @returns the validated request, or the refusal naming the field.
 */
function validateRequest(value: unknown): RequestCheck {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: refusalOfField('request', 'not-an-object', 'dsh-mywork: a gate request must be a plain object') }
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!ATTEMPT_GATE_REQUEST_FIELDS.includes(key)) {
      return {
        ok: false,
        error: refusalOfField(key, 'undeclared-field', `dsh-mywork: a gate request declares no field "${key}"`),
      }
    }
  }
  const fields: readonly (keyof AttemptGateRequest)[] = ['attemptId', 'taskId', 'workspaceId', 'cwd', 'headSha']
  for (const field of fields) {
    const held = record[field]
    if (typeof held !== 'string' || held.trim() === '') {
      return {
        ok: false,
        error: refusalOfField(field, 'missing', `dsh-mywork: a gate request needs a non-blank ${field}`),
      }
    }
  }
  const headSha = record['headSha'] as string
  if (!isSha(headSha)) {
    return {
      ok: false,
      error: refusalOfField(
        'headSha',
        'not-a-head',
        `dsh-mywork: headSha must be ${GIT_SHA_LENGTH} lowercase hex characters, received ${String(headSha)}`,
      ),
    }
  }
  const cwd = record['cwd'] as string
  if (!isAbsolute(cwd)) {
    return {
      ok: false,
      error: refusalOfField('cwd', 'not-absolute', `dsh-mywork: cwd must be an absolute worktree path, received ${cwd}`),
    }
  }
  if (cwd.split(/[\\/]+/).includes('..')) {
    return {
      ok: false,
      error: refusalOfField('cwd', 'escapes-worktree', `dsh-mywork: cwd must not climb out of the worktree, received ${cwd}`),
    }
  }
  return {
    ok: true,
    request: Object.freeze({
      attemptId: record['attemptId'] as string,
      taskId: record['taskId'] as string,
      workspaceId: record['workspaceId'] as string,
      cwd,
      headSha,
    }),
  }
}

/**
 * Build the port the worker asks for an attempt's verdicts through.
 *
 * The returned port is pure with respect to the repository: it reads no head
 * unless a reader is injected, stores every log in the sink it was given, and
 * takes every clock reading from the injected clock.
 * @param options - policies, clock, sink, and the optional head reader.
 * @returns the port the execution layer injects as `WorkerDeps.gates`.
 */
export function createAttemptGatePort(options: AttemptGatePortOptions): AttemptGatePort {
  const refuse = (meta: OperationMeta, headSha: string, refusal: GateRefusalReason): Result<GateRunResult> =>
    Object.freeze({
      ok: true as const,
      value: Object.freeze({ headSha, results: Object.freeze([]), refusal }),
      meta,
    })

  return Object.freeze({
    async run(request: AttemptGateRequest, meta: OperationMeta): Promise<Result<GateRunResult>> {
      const checked = validateRequest(request)
      if (!checked.ok) return Object.freeze({ ok: false as const, error: checked.error, meta })
      const pinned = checked.request

      let policy: GatePolicy
      try {
        policy = resolveGatePolicy(options.policies, pinned.workspaceId)
      } catch (error) {
        if (isGateError(error) && error.code === 'gate-unconfigured') {
          return refuse(meta, pinned.headSha, 'GATE_UNCONFIGURED')
        }
        throw error
      }

      // The reader the policy uses answers with the caller's pin: the port never
      // names a head of its own, and an injected reader only ever *refuses*.
      const reader = options.readHead
      const readPinned: HeadReader = async cwd => {
        if (reader === undefined) return pinned.headSha
        const observed = await reader(cwd)
        if (observed !== pinned.headSha) throw new PinnedHeadMoved(pinned.headSha, observed)
        return pinned.headSha
      }

      let run: GateRunResult
      try {
        run = await runGatePolicy(policy, {
          workspaceId: pinned.workspaceId,
          cwd: pinned.cwd,
          readHead: readPinned,
          clock: options.clock,
          artifacts: options.artifacts,
          expectedHeadSha: pinned.headSha,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
        })
      } catch (error) {
        if (error instanceof PinnedHeadMoved) return refuse(meta, pinned.headSha, 'GATE_HEAD_MOVED')
        throw error
      }

      // Whatever the run reports, the answer is about the pinned head. The
      // reader above makes the two agree by construction; a run that attested
      // some other commit is refused rather than passed on, because no caller
      // asked about that commit.
      if (run.headSha !== pinned.headSha) return refuse(meta, pinned.headSha, 'GATE_HEAD_MOVED')
      if (run.refusal !== undefined) return refuse(meta, pinned.headSha, run.refusal)
      return Object.freeze({
        ok: true as const,
        value: Object.freeze({ headSha: pinned.headSha, results: Object.freeze([...run.results]) }),
        meta,
      })
    },
  })
}
