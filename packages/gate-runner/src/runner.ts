/**
 * The gate runner (architecture §19; MW-023, E-14, E-15, E-18).
 *
 * One gate is one process, run in the attempt's worktree under a bound the
 * caller sets, and its log is stored as evidence *before* the verdict comes
 * back. The verdict is a typed value from `@dsh-mywork/contracts`: `pass` is the
 * only value that admits work, so a tool that could not start, a bound that
 * expired, and a caller's cancellation are all failures — they are distinct
 * values, not distinct colours of green.
 *
 * Three properties are enforced here rather than trusted:
 *
 * - **No shell.** Every command is an explicit executable plus a verbatim
 *   argument vector (`shell: false`), with `timeout` and `maxBuffer` always set.
 *   Nothing a spec contains is ever interpreted twice by a shell.
 * - **A verdict belongs to one head.** The runner never reads git itself: a
 *   {@link HeadReader} is injected, and a head that moved mid-run is a refusal
 *   with every verdict discarded, not an approval transferred to code nobody
 *   ran.
 * - **Time is injected.** Timestamps come from a `ClockPort`; the log records
 *   what the command did and never when, so the same head, gate, and output hash
 *   to the same evidence digest.
 * @module
 */

import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isAbsolute, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import {
  GIT_SHA_LENGTH,
  type ArtifactRef,
  type ClockPort,
  type EpochMs,
  type GateRefusalReason,
  type GateResult,
  type GateSpec,
  type GateVerdict,
  type WorkspaceId,
} from '@dsh-mywork/contracts'

import { GateError } from './errors.ts'

/**
 * Default bound on one gate's captured output (1 MiB). A gate that prints more
 * than this is not trusted: its log would grow the artifact store without limit,
 * so the overflow is an `error` with the truncation recorded in the log.
 */
export const GATE_LOG_MAX_BYTES = 1_048_576

/** Default bound on reading a worktree's head. */
export const GATE_HEAD_READ_TIMEOUT_MS = 30_000

/** Default bound on the output of a head read; an object name is 40 characters. */
export const GATE_HEAD_READ_MAX_BYTES = 4_096

/** Identifier the policy runner reserves for the attempt-base comparison gate. */
export const GATE_BASE_ID = 'base'

/** Identifier the policy runner reserves for the expected-head comparison gate. */
export const GATE_HEAD_ID = 'head'

/** The reserved comparison gate identifiers, in the order §19 lists the pair. */
export const GATE_LOCAL_GATE_IDS: readonly string[] = Object.freeze([GATE_BASE_ID, GATE_HEAD_ID])

/** A lowercase hex git object name, as the contract fixes its length. */
const HEAD_SHA_PATTERN = new RegExp(`^[0-9a-f]{${GIT_SHA_LENGTH}}$`)

/** Promise form of `execFile`; every call site below asks for utf8 strings. */
const execFileAsync: (
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding,
) => Promise<{ readonly stdout: string; readonly stderr: string }> = promisify(execFile)

/** Reads the head commit of a worktree. Injected, so a test owns the head. */
export type HeadReader = (cwd: string) => Promise<string>

/**
 * One gate log, handed to the sink before the verdict is returned.
 *
 * The bytes are the rendered log; `sha256` is their digest, so a reader can tell
 * whether what it read is what was written. Timestamps come from the injected
 * clock and belong to the artifact record, which is why the verdict itself
 * carries none.
 */
export interface GateArtifactInput {
  /** Workspace the evidence belongs to. */
  readonly workspaceId: WorkspaceId
  /** Identifier of the gate inside its policy. */
  readonly gateId: string
  /** Head the command ran against. */
  readonly headSha: string
  /** What the gate decided. */
  readonly verdict: GateVerdict
  /** Rendered log: the command, its exit, and both of its streams. */
  readonly log: string
  /** Lowercase hex SHA-256 of {@link GateArtifactInput.log}. */
  readonly sha256: string
  /** Clock reading taken before the command started. */
  readonly startedAt: EpochMs
  /** Clock reading taken after the command settled. */
  readonly settledAt: EpochMs
}

/**
 * Where a gate's log is stored. The caller owns artifact identity: the runner
 * never invents an id, because only the caller knows how a repeated run on one
 * head is meant to accumulate evidence.
 */
export interface GateArtifactSink {
  /**
   * Store one gate log.
   * @param input - the log and the facts that describe it.
   * @returns the identity of the stored evidence, which the verdict references.
   */
  store(input: GateArtifactInput): Promise<ArtifactRef>
}

/** What one gate run needs beyond its spec. */
export interface GateRunOptions {
  /** Workspace the run belongs to; carried onto the stored evidence. */
  readonly workspaceId: WorkspaceId
  /** Worktree root the gate runs in. */
  readonly cwd: string
  /** Head this verdict is pinned to; 40 lowercase hex characters. */
  readonly headSha: string
  /** Injected time source for the artifact's readings. */
  readonly clock: ClockPort
  /** Sink the log is stored in before the verdict is returned. */
  readonly artifacts: GateArtifactSink
  /** Caller cancellation; an aborted run is `cancelled`, never `pass`. */
  readonly signal?: AbortSignal
  /** Bound on the captured output; defaults to {@link GATE_LOG_MAX_BYTES}. */
  readonly maxBufferBytes?: number
}

/** What a comparison gate decided, without a process involved. */
export interface LocalGateOutcome {
  /** What the comparison reached. */
  readonly verdict: GateVerdict
  /** Always `null`: no process reported a code, which is what the verdict is for. */
  readonly exitCode: number | null
  /** Why a non-`pass` verdict was reached. */
  readonly reason?: GateRefusalReason
  /** The comparison, written down as the gate's log. */
  readonly explanation: string
}

/** The parts a rendered gate log is built from. */
export interface GateLogParts {
  /** The gate that ran. */
  readonly spec: GateSpec
  /** Directory the command ran in. */
  readonly cwd: string
  /** Head the verdict is pinned to. */
  readonly headSha: string
  /** What the gate decided. */
  readonly verdict: GateVerdict
  /** Process exit code, or `null` when no process reported one. */
  readonly exitCode: number | null
  /** Why a non-`pass` verdict was reached. */
  readonly reason?: GateRefusalReason
  /** Whether the process was killed rather than exiting. */
  readonly killed: boolean
  /** Whether the capture hit its bound and the log below is partial. */
  readonly truncated: boolean
  /** Captured standard output. */
  readonly stdout: string
  /** Captured standard error. */
  readonly stderr: string
  /** What a comparison gate decided, when no process ran. */
  readonly note?: string
}

/** Options accepted by {@link createGitHeadReader}. */
export interface GitHeadReaderOptions {
  /** Path of the git executable; defaults to `git` on `PATH`. */
  readonly gitPath?: string
  /** Bound on one read; defaults to {@link GATE_HEAD_READ_TIMEOUT_MS}. */
  readonly timeoutMs?: number
  /** Bound on the reader's captured output; defaults to {@link GATE_HEAD_READ_MAX_BYTES}. */
  readonly maxBufferBytes?: number
}

/** What one command run reached, before it is turned into a verdict. */
interface ExecOutcome {
  /** What the run decided. */
  readonly verdict: GateVerdict
  /** Process exit code, or `null` when no process reported one. */
  readonly exitCode: number | null
  /** Why a non-`pass` verdict was reached, when the vocabulary names a reason. */
  readonly reason?: GateRefusalReason
  /** Whether the process was killed rather than exiting on its own. */
  readonly killed: boolean
  /** Whether the capture hit its bound, so the log below is partial. */
  readonly truncated: boolean
  /** Captured standard output. */
  readonly stdout: string
  /** Captured standard error. */
  readonly stderr: string
}

/**
 * Whether a gate identifier names a comparison the runner resolves locally.
 * @param id - gate identifier to test.
 */
export function isLocalGateId(id: string): boolean {
  return GATE_LOCAL_GATE_IDS.includes(id)
}

/**
 * Refuse a spec that is not a runnable, bounded gate.
 * @param spec - the spec to check.
 * @throws {GateError} `invalid-spec` when the id or command is blank, the args
 *   are not a vector of strings, the timeout is not positive and finite, or the
 *   cwd would leave the worktree.
 */
export function assertGateSpec(spec: GateSpec): void {
  if (typeof spec.id !== 'string' || spec.id.trim() === '') {
    throw new GateError('invalid-spec', 'dsh-mywork: a gate needs a non-blank id')
  }
  if (typeof spec.command !== 'string' || spec.command.trim() === '') {
    throw new GateError('invalid-spec', `dsh-mywork: gate "${spec.id}" needs a non-blank command`, {
      details: { gateId: spec.id },
    })
  }
  if (!Array.isArray(spec.args) || spec.args.some(argument => typeof argument !== 'string')) {
    throw new GateError('invalid-spec', `dsh-mywork: gate "${spec.id}" needs an argument vector of strings`, {
      details: { gateId: spec.id },
    })
  }
  if (typeof spec.timeoutMs !== 'number' || !Number.isFinite(spec.timeoutMs) || spec.timeoutMs <= 0) {
    throw new GateError('invalid-spec', `dsh-mywork: gate "${spec.id}" needs a positive finite timeoutMs`, {
      details: { gateId: spec.id, timeoutMs: spec.timeoutMs },
    })
  }
  if (spec.required !== undefined && typeof spec.required !== 'boolean') {
    throw new GateError('invalid-spec', `dsh-mywork: gate "${spec.id}" has a non-boolean required flag`, {
      details: { gateId: spec.id },
    })
  }
  if (spec.cwd !== undefined && !isSafeRelativeCwd(spec.cwd)) {
    throw new GateError('invalid-spec', `dsh-mywork: gate "${spec.id}" cwd must stay inside the worktree`, {
      details: { gateId: spec.id, cwd: spec.cwd },
    })
  }
}

/**
 * Refuse a policy whose gates share an identifier.
 * @param gates - the gates of one policy.
 * @throws {GateError} `duplicate-gate-id` naming the repeated identifier.
 */
export function assertUniqueGateIds(gates: readonly GateSpec[]): void {
  const seen = new Set<string>()
  for (const gate of gates) {
    if (seen.has(gate.id)) {
      throw new GateError('duplicate-gate-id', `dsh-mywork: gate "${gate.id}" is configured twice`, {
        details: { gateId: gate.id },
      })
    }
    seen.add(gate.id)
  }
}

/**
 * Refuse a head that is not a git object name.
 * @param headSha - the value to check.
 * @throws {GateError} `invalid-head` when it is not 40 lowercase hex characters.
 */
export function assertHeadSha(headSha: string): void {
  if (typeof headSha !== 'string' || !HEAD_SHA_PATTERN.test(headSha)) {
    throw new GateError('invalid-head', `dsh-mywork: "${String(headSha)}" is not a 40-character lowercase hex head`, {
      details: { headSha },
    })
  }
}

/**
 * Render a gate's log.
 *
 * The rendering is a pure function of what the command did — never of when it
 * ran — so two runs on one head with one command produce one digest.
 * @param parts - the facts the log records.
 * @returns the rendered log, ending in a newline.
 */
export function renderGateLog(parts: GateLogParts): string {
  const lines = [
    `gate ${parts.spec.id}`,
    `head ${parts.headSha}`,
    `command ${parts.spec.command}`,
    `args ${JSON.stringify(parts.spec.args)}`,
    `cwd ${parts.cwd}`,
    `timeoutMs ${parts.spec.timeoutMs}`,
    `verdict ${parts.verdict}`,
    `exitCode ${parts.exitCode === null ? 'null' : String(parts.exitCode)}`,
    `reason ${parts.reason ?? '-'}`,
    `killed ${parts.killed ? 'true' : 'false'}`,
    `truncated ${parts.truncated ? 'true' : 'false'}`,
  ]
  if (parts.note !== undefined) {
    lines.push('--- note ---', parts.note.trimEnd())
  }
  lines.push('--- stdout ---', parts.stdout.trimEnd(), '--- stderr ---', parts.stderr.trimEnd())
  return `${lines.join('\n')}\n`
}

/**
 * Digest the bytes of a rendered log.
 * @param log - the rendered log.
 * @returns lowercase hex SHA-256 of its UTF-8 bytes.
 */
export function sha256OfLog(log: string): string {
  return createHash('sha256').update(log, 'utf8').digest('hex')
}

/**
 * Run one gate and store its log as evidence before returning the verdict.
 *
 * Every path stores evidence, including a command that never started: the
 * artifact reference is part of the verdict's shape, so a gate that produced no
 * log cannot exist.
 * @param spec - the gate to run; validated before anything is stored.
 * @param options - worktree, exact head, clock, sink, and optional bounds.
 * @returns the verdict, its exit code, and the evidence it points at.
 * @throws {GateError} `invalid-spec` or `invalid-head` when the request itself is not runnable.
 */
export async function runGate(spec: GateSpec, options: GateRunOptions): Promise<GateResult> {
  assertGateSpec(spec)
  assertHeadSha(options.headSha)
  assertSink(options.artifacts)
  const cwd = resolveGateCwd(options.cwd, spec.cwd)
  const startedAt = options.clock.now()
  const outcome = await execute(spec, cwd, options)
  const settledAt = options.clock.now()
  const log = renderGateLog({
    spec,
    cwd,
    headSha: options.headSha,
    verdict: outcome.verdict,
    exitCode: outcome.exitCode,
    killed: outcome.killed,
    truncated: outcome.truncated,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
  })
  const artifactRef = await options.artifacts.store({
    workspaceId: options.workspaceId,
    gateId: spec.id,
    headSha: options.headSha,
    verdict: outcome.verdict,
    log,
    sha256: sha256OfLog(log),
    startedAt,
    settledAt,
  })
  return buildResult(spec.id, options.headSha, outcome, artifactRef)
}

/**
 * Settle a gate whose verdict a comparison reached, and store its log.
 *
 * No process runs, so the exit code is `null` in every case: the verdict is the
 * carrier of the outcome, which is exactly what a typed verdict is for.
 * @param spec - the gate; validated before anything is stored.
 * @param options - worktree, exact head, clock, and sink.
 * @param outcome - what the comparison decided.
 * @returns the verdict and the evidence it points at.
 * @throws {GateError} `invalid-spec` or `invalid-head` when the request itself is not runnable.
 */
export async function settleLocalGate(
  spec: GateSpec,
  options: GateRunOptions,
  outcome: LocalGateOutcome,
): Promise<GateResult> {
  assertGateSpec(spec)
  assertHeadSha(options.headSha)
  assertSink(options.artifacts)
  const cwd = resolveGateCwd(options.cwd, spec.cwd)
  const settledAt = options.clock.now()
  const log = renderGateLog({
    spec,
    cwd,
    headSha: options.headSha,
    verdict: outcome.verdict,
    exitCode: outcome.exitCode,
    killed: false,
    truncated: false,
    stdout: '',
    stderr: '',
    note: outcome.explanation,
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
  })
  const artifactRef = await options.artifacts.store({
    workspaceId: options.workspaceId,
    gateId: spec.id,
    headSha: options.headSha,
    verdict: outcome.verdict,
    log,
    sha256: sha256OfLog(log),
    startedAt: settledAt,
    settledAt,
  })
  const settled: ExecOutcome = {
    verdict: outcome.verdict,
    exitCode: outcome.exitCode,
    killed: false,
    truncated: false,
    stdout: '',
    stderr: '',
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
  }
  return buildResult(spec.id, options.headSha, settled, artifactRef)
}

/**
 * Build the reader the composition root injects in production: `git -C <cwd>
 * rev-parse HEAD` as a fixed spec, without a shell.
 *
 * The runner itself never calls this. A caller that wants git reads injects it,
 * which is what keeps the verdict a function of the injected head.
 * @param options - executable path and bounds; every field has a default.
 * @returns a reader returning the head of the repository containing `cwd`.
 */
export function createGitHeadReader(options: GitHeadReaderOptions = {}): HeadReader {
  const gitPath = options.gitPath ?? 'git'
  const timeoutMs = options.timeoutMs ?? GATE_HEAD_READ_TIMEOUT_MS
  const maxBufferBytes = options.maxBufferBytes ?? GATE_HEAD_READ_MAX_BYTES
  return async (cwd: string) => {
    let stdout: string
    try {
      const read = await execFileAsync(gitPath, ['-C', cwd, 'rev-parse', 'HEAD'], {
        cwd,
        timeout: timeoutMs,
        maxBuffer: maxBufferBytes,
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
      })
      stdout = read.stdout
    } catch (error) {
      throw new GateError('head-unavailable', `dsh-mywork: could not read the head of "${cwd}"`, { cause: error })
    }
    const head = stdout.trim()
    assertHeadSha(head)
    return head
  }
}

/**
 * Resolve the directory a gate runs in, and refuse to leave the worktree.
 * @param root - worktree root.
 * @param relative - directory relative to the root; absent means the root itself.
 * @throws {GateError} `invalid-spec` when the resolved directory is outside the root.
 */
export function resolveGateCwd(root: string, relative?: string): string {
  const worktreeRoot = resolve(root)
  if (relative === undefined) return worktreeRoot
  const cwd = resolve(worktreeRoot, relative)
  if (cwd !== worktreeRoot && !cwd.startsWith(`${worktreeRoot}${sep}`)) {
    throw new GateError('invalid-spec', `dsh-mywork: "${relative}" leaves the worktree`, {
      details: { root: worktreeRoot, cwd },
    })
  }
  return cwd
}

/**
 * Whether a cwd keeps a gate inside the worktree it was handed.
 * @param value - the cwd field of a spec.
 */
function isSafeRelativeCwd(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '' || isAbsolute(value)) return false
  return !value.split(/[\\/]/).includes('..')
}

/**
 * Run the command and classify what happened, without ever classifying a
 * failure as success.
 */
async function execute(spec: GateSpec, cwd: string, options: GateRunOptions): Promise<ExecOutcome> {
  const maxBuffer = options.maxBufferBytes ?? GATE_LOG_MAX_BYTES
  const execOptions: ExecFileOptionsWithStringEncoding = {
    cwd,
    timeout: spec.timeoutMs,
    maxBuffer,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
  }
  if (options.signal !== undefined) execOptions.signal = options.signal
  try {
    const { stdout, stderr } = await execFileAsync(spec.command, [...spec.args], execOptions)
    return { verdict: 'pass', exitCode: 0, killed: false, truncated: false, stdout, stderr }
  } catch (error) {
    return classify(error, options.signal)
  }
}

/**
 * Turn one rejection into a verdict, in an order that never lets a failure read
 * as success: cancellation first, then the capture overflow, then a killed
 * process, then a spawn failure, and only then a real non-zero exit.
 */
function classify(error: unknown, signal: AbortSignal | undefined): ExecOutcome {
  const stdout = stringField(error, 'stdout')
  const stderr = stringField(error, 'stderr')
  const killed = failureField(error, 'killed') === true
  const code = failureField(error, 'code')
  if (signal?.aborted === true) {
    return { verdict: 'cancelled', exitCode: null, killed, truncated: false, stdout, stderr }
  }
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return { verdict: 'error', exitCode: null, killed, truncated: true, stdout, stderr }
  }
  if (killed) {
    return { verdict: 'timeout', exitCode: null, killed, truncated: false, stdout, stderr }
  }
  if (typeof code === 'string') {
    return { verdict: 'error', exitCode: null, reason: 'GATE_TOOL_MISSING', killed, truncated: false, stdout, stderr }
  }
  if (typeof code === 'number' && Number.isInteger(code)) {
    return { verdict: 'fail', exitCode: code, killed, truncated: false, stdout, stderr }
  }
  return { verdict: 'error', exitCode: null, killed, truncated: false, stdout, stderr }
}

/** Build the verdict the contract fixes, omitting an absent refusal reason. */
function buildResult(
  id: string,
  headSha: string,
  outcome: ExecOutcome,
  artifactRef: ArtifactRef,
): GateResult {
  const result = { id, headSha, exitCode: outcome.exitCode, verdict: outcome.verdict, artifactRef }
  return outcome.reason === undefined ? result : { ...result, reason: outcome.reason }
}

/** Refuse a run whose sink could not store anything. */
function assertSink(sink: GateArtifactSink | undefined): void {
  if (sink === undefined || typeof sink.store !== 'function') {
    throw new GateError('invalid-spec', 'dsh-mywork: a gate run needs an artifact sink for its log')
  }
}

/** Read one field of an unknown rejection value without trusting its shape. */
function failureField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return key in value ? Reflect.get(value, key) : undefined
}

/** Read one field of an unknown rejection value as a string, or an empty one. */
function stringField(value: unknown, key: string): string {
  const field = failureField(value, key)
  return typeof field === 'string' ? field : ''
}
