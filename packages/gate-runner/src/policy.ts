/**
 * The gate set one workspace runs (architecture §19; MW-023, E-16, E-15).
 *
 * The set belongs to the workspace, never to the task: a task cannot widen its
 * own verification, and a workspace without a policy is refused with
 * `GATE_UNCONFIGURED` instead of passing by default. `ResolvedWorkspaceConfig`
 * (`packages/contracts/src/config.ts`) is the configuration root a caller
 * resolves first; the source below is keyed by its `workspaceId`, so no second
 * source of truth is introduced and the `Task` entity is not extended.
 *
 * The policy runner also enforces the exact-head rule: it reads the head before
 * the first gate, between the gates, and after the last one, and a head that
 * moved discards every verdict of the run — the logs stay behind, because they
 * are the evidence of *why* the run was refused.
 * @module
 */

import {
  isGatePassing,
  type GatePolicy,
  type GateResult,
  type GateRunResult,
  type GateSpec,
  type WorkspaceId,
} from '@dsh-mywork/contracts'

import { GateError, isGateError } from './errors.ts'
import {
  GATE_BASE_ID,
  GATE_HEAD_ID,
  assertHeadSha,
  assertUniqueGateIds,
  isLocalGateId,
  resolveGateCwd,
  runGate,
  settleLocalGate,
  type GateArtifactSink,
  type GateRunOptions,
  type HeadReader,
  type LocalGateOutcome,
} from './runner.ts'

/**
 * Where the gate set of a workspace comes from.
 *
 * A source is a lookup and nothing else: it has no default set, because a
 * default would be a workspace whose verification nobody configured.
 */
export interface GatePolicySource {
  /**
   * Policy configured for one workspace.
   * @param workspaceId - the workspace asking.
   * @returns the policy, or `undefined` when the workspace has none.
   */
  policyFor(workspaceId: WorkspaceId): GatePolicy | undefined
}

/** What a policy run needs beyond the gates themselves. */
export interface GatePolicyRunOptions {
  /** Workspace the run belongs to; carried onto every stored log. */
  readonly workspaceId: WorkspaceId
  /** Worktree root every gate runs in. */
  readonly cwd: string
  /**
   * Reads the worktree's head. The runner never reads git itself, so the head a
   * verdict is pinned to is always the injected one.
   */
  readonly readHead: HeadReader
  /** Injected time source for the artifacts' readings. */
  readonly clock: GateRunOptions['clock']
  /** Sink every gate log is stored in before its verdict is returned. */
  readonly artifacts: GateArtifactSink
  /**
   * Base commit of the attempt, compared by the reserved gate id {@link GATE_BASE_ID}.
   * A policy that configures that gate without supplying the base gets `error`
   * with `GATE_MISSING` — an unrun comparison is never a pass.
   */
  readonly attemptBaseSha?: string
  /** Head the attempt is expected to verify, compared by {@link GATE_HEAD_ID}. */
  readonly expectedHeadSha?: string
  /** Caller cancellation; forwarded to every gate. */
  readonly signal?: AbortSignal
  /** Bound on one gate's captured output; defaults to the runner's bound. */
  readonly maxBufferBytes?: number
}

/**
 * Build a frozen source over a list of policies.
 * @param policies - one policy per workspace; a workspace configured twice is refused.
 * @returns a source whose `policyFor` returns the configured policy itself.
 * @throws {GateError} `invalid-policy` when a policy is malformed or a workspace appears twice.
 */
export function defineGatePolicySource(policies: readonly GatePolicy[]): GatePolicySource {
  const byWorkspace: Record<string, GatePolicy> = {}
  for (const policy of policies) {
    assertPolicy(policy)
    if (Object.hasOwn(byWorkspace, policy.workspaceId)) {
      throw new GateError('invalid-policy', `dsh-mywork: workspace "${policy.workspaceId}" is configured twice`, {
        details: { workspaceId: policy.workspaceId },
      })
    }
    byWorkspace[policy.workspaceId] = policy
  }
  const configured = Object.freeze({ ...byWorkspace })
  return Object.freeze({
    policyFor: (workspaceId: WorkspaceId): GatePolicy | undefined => configured[workspaceId],
  })
}

/**
 * Resolve the policy of one workspace, or refuse.
 * @param source - the configured policies.
 * @param workspaceId - the workspace asking.
 * @returns the configured policy.
 * @throws {GateError} `gate-unconfigured` when the workspace has no policy; the
 *   caller maps it onto `GATE_UNCONFIGURED`, never onto a default set.
 */
export function resolveGatePolicy(source: GatePolicySource, workspaceId: WorkspaceId): GatePolicy {
  const policy = source.policyFor(workspaceId)
  if (policy === undefined) {
    throw new GateError('gate-unconfigured', `dsh-mywork: workspace "${workspaceId}" has no gate policy`, {
      details: { workspaceId },
    })
  }
  return policy
}

/**
 * Whether a gate's result blocks admission.
 * @param gate - the gate to test.
 * @param policy - the policy it belongs to.
 * @returns true when the policy is `strict`, or when the gate did not exempt
 *   itself with `required: false`.
 */
export function isBlockingGate(gate: GateSpec, policy: GatePolicy): boolean {
  return policy.strict === true || gate.required !== false
}

/**
 * Identifiers of the gates whose result blocks admission: a blocking gate that
 * did not pass, or that produced no result at all.
 * @param policy - the policy whose gates were run.
 * @param results - verdicts to check; by construction the results of one head.
 * @param headSha - when given, only verdicts pinned to this head count.
 * @returns blocking gate identifiers, in policy order.
 */
export function blockingGateIds(
  policy: GatePolicy,
  results: readonly GateResult[],
  headSha?: string,
): readonly string[] {
  return policy.gates
    .filter(gate => isBlockingGate(gate, policy) && !hasPassingResult(gate, results, headSha))
    .map(gate => gate.id)
}

/**
 * Whether every blocking gate of the policy passed for the head in question.
 * @param policy - the policy whose gates were run.
 * @param results - verdicts to check.
 * @param headSha - when given, only verdicts pinned to this head count.
 * @returns true only when the run admits the work.
 */
export function gatesSatisfied(policy: GatePolicy, results: readonly GateResult[], headSha?: string): boolean {
  return blockingGateIds(policy, results, headSha).length === 0
}

/**
 * Run one policy against the exact head of a worktree.
 *
 * The gates run in policy order in the worktree root, or in the directory a
 * spec names relative to it. The head is read before the first gate, between the
 * gates, and after the last one; a head that moved returns `GATE_HEAD_MOVED`
 * with an empty result list, and the stored logs remain as evidence.
 * @param policy - the workspace's gates.
 * @param options - worktree, head reader, clock, sink, and optional bounds.
 * @returns the head the run was pinned to, the verdicts, and any refusal.
 * @throws {GateError} `invalid-policy` for a malformed policy, `invalid-spec` for
 *   a gate that cannot be run, and the head reader's own failure when no head can
 *   be pinned — a run without a head cannot produce an attested verdict.
 */
export async function runGatePolicy(
  policy: GatePolicy,
  options: GatePolicyRunOptions,
): Promise<GateRunResult> {
  assertPolicy(policy)
  const worktreeRoot = resolveGateCwd(options.cwd)
  const headSha = await readHead(options, worktreeRoot)

  try {
    assertUniqueGateIds(policy.gates)
  } catch (error) {
    if (isGateError(error) && error.code === 'duplicate-gate-id') {
      return { headSha, results: [], refusal: 'GATE_DUPLICATE_ID' }
    }
    throw error
  }
  if (policy.gates.length === 0) {
    return { headSha, results: [], refusal: 'GATE_UNCONFIGURED' }
  }

  const results: GateResult[] = []
  for (const [index, gate] of policy.gates.entries()) {
    if (index > 0 && !(await headIsPinned(options, worktreeRoot, headSha))) {
      return { headSha, results: [], refusal: 'GATE_HEAD_MOVED' }
    }
    results.push(await runOneGate(gate, options, worktreeRoot, headSha))
  }
  if (!(await headIsPinned(options, worktreeRoot, headSha))) {
    return { headSha, results: [], refusal: 'GATE_HEAD_MOVED' }
  }
  return { headSha, results }
}

/**
 * Refuse a policy that is not a gate set.
 * @param policy - the policy to check.
 * @throws {GateError} `invalid-policy` when the workspace id is blank or the gate list is absent.
 */
export function assertPolicy(policy: GatePolicy): void {
  if (typeof policy?.workspaceId !== 'string' || policy.workspaceId.trim() === '') {
    throw new GateError('invalid-policy', 'dsh-mywork: a gate policy needs a non-blank workspaceId')
  }
  if (!Array.isArray(policy.gates)) {
    throw new GateError('invalid-policy', `dsh-mywork: the policy of "${policy.workspaceId}" needs a gate list`, {
      details: { workspaceId: policy.workspaceId },
    })
  }
  if (policy.strict !== undefined && typeof policy.strict !== 'boolean') {
    throw new GateError('invalid-policy', `dsh-mywork: the policy of "${policy.workspaceId}" has a non-boolean strict flag`, {
      details: { workspaceId: policy.workspaceId },
    })
  }
}

/** Whether a gate produced a passing verdict, optionally for one exact head. */
function hasPassingResult(gate: GateSpec, results: readonly GateResult[], headSha?: string): boolean {
  return results.some(
    result =>
      result.id === gate.id
      && isGatePassing(result.verdict)
      && (headSha === undefined || result.headSha === headSha),
  )
}

/** Read the head and refuse anything that is not a git object name. */
async function readHead(options: GatePolicyRunOptions, worktreeRoot: string): Promise<string> {
  if (typeof options.readHead !== 'function') {
    throw new GateError('head-unavailable', 'dsh-mywork: a policy run needs a head reader', {
      details: { cwd: worktreeRoot },
    })
  }
  const head = await options.readHead(worktreeRoot)
  assertHeadSha(head)
  return head
}

/** Whether the worktree still stands on the head the run was pinned to. */
async function headIsPinned(
  options: GatePolicyRunOptions,
  worktreeRoot: string,
  headSha: string,
): Promise<boolean> {
  const now = await readHead(options, worktreeRoot)
  return now === headSha
}

/** Run one gate: a command, or a comparison the policy reserved an id for. */
function runOneGate(
  gate: GateSpec,
  options: GatePolicyRunOptions,
  worktreeRoot: string,
  headSha: string,
): Promise<GateResult> {
  const gateOptions: GateRunOptions = {
    workspaceId: options.workspaceId,
    cwd: worktreeRoot,
    headSha,
    clock: options.clock,
    artifacts: options.artifacts,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
  }
  if (!isLocalGateId(gate.id)) return runGate(gate, gateOptions)
  return settleLocalGate(gate, gateOptions, compareGate(gate, options, headSha))
}

/**
 * Decide a reserved comparison gate.
 *
 * `base` compares the attempt's base commit with the head the gates ran against;
 * `head` compares the head the attempt is expected to verify with the same head.
 * A comparison whose value the caller did not supply is `error` with
 * `GATE_MISSING`: the gate was configured, so its result matters.
 */
function compareGate(gate: GateSpec, options: GatePolicyRunOptions, headSha: string): LocalGateOutcome {
  const isBase = gate.id === GATE_BASE_ID
  const expected = isBase ? options.attemptBaseSha : options.expectedHeadSha
  const label = isBase ? 'base commit of the attempt' : 'expected head'
  if (expected === undefined) {
    return {
      verdict: 'error',
      exitCode: null,
      reason: 'GATE_MISSING',
      explanation: `gate ${gate.id}: the policy configured a comparison against the ${label}, and this run supplied none.`,
    }
  }
  if (expected !== headSha) {
    return {
      verdict: 'fail',
      exitCode: null,
      explanation: `gate ${gate.id}: ${label} ${expected} does not match the verified head ${headSha}.`,
    }
  }
  return {
    verdict: 'pass',
    exitCode: null,
    explanation: `gate ${gate.id}: ${label} ${expected} matches the verified head ${headSha}.`,
  }
}
