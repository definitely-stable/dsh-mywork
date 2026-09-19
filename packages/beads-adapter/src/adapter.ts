/**
 * Beads 1.3.0 TaskGraph adapter: capability negotiation, status and priority
 * mapping, and the CLI transport (architecture §8, §9, §11; ADR023).
 *
 * The adapter is **CLI-only**, by the owner's decision recorded in ADR023.
 * `bd serve` is deliberately not started, so the `http` capability is declared
 * `false` and the adapter never pretends otherwise: an operation that would need
 * an HTTP transport — a composite mutation guarded by `expected_version` —
 * answers `CAPABILITY_UNSUPPORTED` and the caller takes the staged path of
 * ADR024 instead. The HTTP transport remains a designed-but-unbuilt port.
 *
 * What Beads owns, and what it does not, follows §8 and is not negotiable here:
 * the graph owns descriptions, dependencies, readiness, priority, and final
 * completion; MyWork owns attempts, leases, reviews, and git refs. Nothing in
 * this adapter stores an attempt or interprets one.
 * @module
 */

import {
  AdapterRefusal,
  capabilityUnsupported,
  defineAdapterManifest,
  type AdapterCapabilityManifest,
} from '@dsh-mywork/adapter-sdk'
import { MyWorkError } from '@dsh-mywork/core'
import {
  ADR023_STATUSES,
  ADR023_STATUS_CUSTOM,
  beadsStatusOf,
  optionalPriorityFromBeads,
  parseStatusCustom,
  statusCustomGaps,
  taskStateOfBeads,
  type BeadsStatusCategory,
} from './mapping.ts'
import {
  type BlockedTaskRef,
  type ClaimResult,
  type ClaimTaskCommand,
  type DiagnosticReport,
  type JournalCursor,
  type JournalReadResult,
  type PlanMutationCommand,
  type PlanMutationResult,
  type NewTaskSpec,
  type ReadyTaskQuery,
  type Task,
  type TaskDependency,
  type TaskGraphCapabilities,
  type TaskGraphDescription,
  type TaskGraphEvent,
  type TaskGraphPort,
  type TaskId,
  type TaskRef,
  type TaskTransitionCommand,
} from '@dsh-mywork/contracts'
import {
  canApplyAtomically,
  detectCycle,
  toGraphApplyPlan,
  toStagedMutationPlan,
  verifyStagedMutation,
  type GraphApplyPlan,
  type MetadataUpdate,
} from './plan.ts'
import {
  BD_EXIT_GUARD_FAILED,
  type BeadsCommand,
  type BeadsRunner,
} from './runner.ts'
import { BEADS_INIT_COMMAND, classifyBeadsFailure, discoverWorkspace, type BeadsWorkspace } from './workspace.ts'

/** Adapter id this package registers under. */
export const BEADS_ADAPTER_ID = 'beads'

/**
 * What the CLI transport can do, established by the deterministic probe set
 * ADR023 specifies for the CLI-only case.
 *
 * These are not guesses: each `true` is a command verified against Beads 1.3.0,
 * and each `false` is a capability that genuinely does not exist in this
 * transport. `http` is `false` because `bd serve` is not run; `guarded-batch` is
 * `false` because `bd batch` accepts no precondition — only the single
 * `bd update` does, which is why a guarded transition is a single-issue compare
 * and-set rather than a batched one (ADR024).
 */
export const BEADS_CLI_CAPABILITIES: TaskGraphCapabilities = Object.freeze({
  http: false,
  'graph-apply': true,
  batch: true,
  'batch-dep-remove': true,
  'guarded-batch': false,
  'metadata-set': true,
  'events-journal': true,
  'claim-lease': true,
  heartbeat: true,
  reclaim: true,
})

/**
 * The §37 manifest of this adapter.
 *
 * Every capability of {@link BEADS_CLI_CAPABILITIES} is declared, including the
 * false ones, so a caller can enumerate what the backend does *not* do without
 * calling it. An absent key and a `false` key mean the same thing to
 * `supportsCapability`; declaring them makes the capability set inspectable.
 */
export const BEADS_ADAPTER_MANIFEST: AdapterCapabilityManifest = defineAdapterManifest({
  adapterId: BEADS_ADAPTER_ID,
  kind: 'taskgraph',
  contractVersion: 'taskgraph/v1',
  capabilities: { ...BEADS_CLI_CAPABILITIES },
})

/** Options accepted by {@link createBeadsTaskGraphAdapter}. */
export interface BeadsAdapterOptions {
  /** Process seam. Defaults to the real `bd` process runner. */
  readonly runner: BeadsRunner
  /**
   * Directory the adapter runs `bd` in.
   *
   * The workspace is whatever `bd` resolves from here — including an ancestor's,
   * because that is where the command would actually land. There is deliberately
   * no `--db`/`BEADS_DIR` redirect: worktrees share the database through git
   * common-directory discovery, and a manual redirect would silently point at a
   * different database (ADR023).
   */
  readonly cwd: string
}

/** Readiness rows `bd ready --json` returns. */
interface BeadsIssueRow {
  readonly id: string
  readonly title?: string
  readonly description?: string
  readonly status: string
  readonly priority?: number | null
  readonly assignee?: string | null
  readonly external_ref?: string | null
  readonly metadata?: Readonly<Record<string, unknown>> | null
  readonly revision?: string | number | null
  readonly dependency_count?: number
  readonly dependent_count?: number
}

/**
 * Dependency rows `bd dep list <id> --json` returns.
 *
 * Each row is the **target issue**, not an edge record: `id` is the task being
 * depended on and `dependency_type` is the edge kind.
 */
interface BeadsDependencyRow {
  readonly id?: string
  readonly dependency_type?: string
}

/**
 * The Beads-backed task graph.
 *
 * Every method is fail-closed. A missing workspace, an unavailable Dolt root, or
 * an undeclared capability produces a typed refusal rather than a partially
 * applied change or a retry, because a cross-store saga (§9) cannot tell a
 * retried success from a duplicated mutation.
 */
export class BeadsTaskGraphAdapter implements TaskGraphPort {
  private readonly runner: BeadsRunner
  private readonly cwd: string
  private workspace: BeadsWorkspace | undefined

  /**
   * @param options - process seam and working directory.
   */
  constructor(options: BeadsAdapterOptions) {
    this.runner = options.runner
    this.cwd = options.cwd
  }

  /**
   * Run one `bd` command in the adapter's directory.
   * @param args - arguments after the binary.
   * @param stdin - standard input, for `bd batch`.
   * @param env - extra environment entries, e.g. `BEADS_ACTOR`.
   */
  private async run(
    args: readonly string[],
    stdin?: string,
    env?: Readonly<Record<string, string>>,
  ): Promise<ReturnType<BeadsRunner['run']>> {
    const command: BeadsCommand = {
      args,
      cwd: this.cwd,
      ...(stdin === undefined ? {} : { stdin }),
      ...(env === undefined ? {} : { env }),
    }
    return this.runner.run(command)
  }

  /**
   * The workspace `bd` resolves, discovered once and cached.
   *
   * A discovery that found nothing is not cached as "absent" — the workspace can
   * appear while the controller is running, and re-asking is cheap compared with
   * reporting a stale absence.
   */
  private async requireWorkspace(): Promise<BeadsWorkspace> {
    if (this.workspace !== undefined) return this.workspace
    const found = await discoverWorkspace(this.runner, this.cwd)
    if (found === undefined) {
      throw new AdapterRefusal(
        'ADAPTER_UNAVAILABLE',
        `dsh-mywork: no beads workspace is resolvable from ${this.cwd}; initialise one with "${BEADS_INIT_COMMAND}"`,
        { details: { cwd: this.cwd, fixCommand: BEADS_INIT_COMMAND } },
      )
    }
    this.workspace = found
    return found
  }

  /**
   * Refuse an operation whose capability this transport does not declare.
   *
   * This is the single place ADR023's rule is enforced: an unsupported capability
   * is a typed `CAPABILITY_UNSUPPORTED` naming the missing flag, never an
   * emulation and never a silent degradation.
   * @param capability - the capability flag the operation needs.
   * @param operation - the operation name, for the refusal message.
   */
  private requireCapability(capability: keyof TaskGraphCapabilities, operation: string): void {
    if (BEADS_CLI_CAPABILITIES[capability] !== true) {
      throw capabilityUnsupported(
        `dsh-mywork: beads adapter does not declare "${capability}", required by ${operation}`,
        { capability, operation, adapterId: BEADS_ADAPTER_ID },
      )
    }
  }

  /** Parse a `--json` payload, mapping malformed output to a typed failure. */
  private parseJson<T>(label: string, stdout: string): T {
    try {
      return JSON.parse(stdout) as T
    } catch (cause) {
      throw new MyWorkError('ADAPTER_UNAVAILABLE', `dsh-mywork: bd ${label} returned malformed JSON`, {
        details: { label, adapterId: BEADS_ADAPTER_ID },
        cause,
      })
    }
  }

  /**
   * Describe the backend.
   *
   * `source` is `declared`: the CLI transport has no discovery endpoint, so the
   * capability set comes from the deterministic probe table rather than from a
   * live negotiation. Reporting it as anything else would overstate what the
   * adapter established.
   */
  async capabilities(): Promise<TaskGraphDescription> {
    const workspace = await this.requireWorkspace()
    return Object.freeze({
      adapterId: BEADS_ADAPTER_ID,
      contractVersion: BEADS_ADAPTER_MANIFEST.contractVersion,
      capabilities: BEADS_CLI_CAPABILITIES,
      source: 'declared' as const,
      workspaceRoot: workspace.repoRoot,
    })
  }

  /** Map one backend row onto the MyWork task record. */
  private toTask(row: BeadsIssueRow): Task {
    const state = taskStateOfBeads(row.status)
    if (state === undefined) {
      throw new MyWorkError(
        'ADAPTER_UNAVAILABLE',
        `dsh-mywork: beads status "${row.status}" has no MyWork mapping`,
        { details: { taskId: row.id, status: row.status } },
      )
    }
    const priority = optionalPriorityFromBeads(row.priority ?? undefined)
    const revision = toRevision(row.revision)
    return Object.freeze({
      id: row.id,
      // The workspace a task belongs to is MyWork's notion; the graph has no
      // equivalent, so the adapter reports the id it was constructed for.
      workspaceId: 'beads',
      title: row.title ?? '',
      description: row.description ?? '',
      state,
      revision,
      dependsOn: Object.freeze([]),
      ...(priority === undefined ? {} : { priority }),
    })
  }

  /**
   * Read one task.
   * @param id - task to read.
   */
  async get(id: TaskId): Promise<Task> {
    await this.requireWorkspace()
    const result = await this.run(['show', id, '--json'])
    if (result.code !== 0) throw this.failedCommand(`show ${id}`, result.code, result.stderr)
    const rows = this.parseJson<BeadsIssueRow[]>('show', result.stdout)
    const row = rows[0]
    if (row === undefined) {
      throw new MyWorkError('ADAPTER_UNAVAILABLE', `dsh-mywork: beads task "${id}" was not found`, {
        details: { taskId: id },
      })
    }
    const dependencies = await this.dependencies(id)
    const task = this.toTask(row)
    return Object.freeze({ ...task, dependsOn: Object.freeze(dependencies.map(edge => edge.to)) })
  }

  /**
   * Tasks the backend reports as ready.
   *
   * Readiness comes **only** from `bd ready`, which applies blocker-aware
   * semantics over status categories. It is never derived from an issue field:
   * `bd list --json` does not emit `is_blocked` at all, not even for tasks
   * `bd blocked` reports as blocked (ADR023), so any field-based readiness check
   * would silently report every task as unblocked.
   * @param query - filters to apply on top of the backend query.
   */
  async ready(query: ReadyTaskQuery = {}): Promise<readonly TaskRef[]> {
    await this.requireWorkspace()
    const result = await this.run(['ready', '--json'])
    if (result.code !== 0) throw this.failedCommand('ready', result.code, result.stderr)
    const rows = this.parseJson<BeadsIssueRow[]>('ready', result.stdout)
    const refs = this.select(rows, query).map(row => this.toTaskRef(row))
    return Object.freeze(query.limit === undefined ? refs : refs.slice(0, query.limit))
  }

  /**
   * Tasks the backend reports as blocked, with the ids they wait for.
   *
   * `bd blocked` reports the task but not its blockers, so the edges are read
   * back per task. The list is small by construction — it is the work that
   * cannot start — and asking per task keeps the answer exact instead of
   * inferring blockers from a status category.
   * @param query - filters to apply after the backend query.
   */
  async blocked(query: ReadyTaskQuery = {}): Promise<readonly BlockedTaskRef[]> {
    await this.requireWorkspace()
    const result = await this.run(['blocked', '--json'])
    if (result.code !== 0) throw this.failedCommand('blocked', result.code, result.stderr)
    const rows = this.parseJson<BeadsIssueRow[]>('blocked', result.stdout)
    const selected = this.select(rows, query)
    const refs: BlockedTaskRef[] = []
    for (const row of selected) {
      const edges = await this.dependencies(row.id)
      refs.push(
        Object.freeze({
          ...this.toTaskRef(row),
          // Only edges that actually hold the task back are reported: a
          // `related` link is not a reason a task is blocked.
          blockedBy: Object.freeze(edges.filter(edge => edge.kind === 'blocks').map(edge => edge.to)),
        }),
      )
    }
    return Object.freeze(refs)
  }

  /** Map a backend row to the minimal reference a readiness query returns. */
  private toTaskRef(row: BeadsIssueRow): TaskRef {
    const state = taskStateOfBeads(row.status)
    if (state === undefined) {
      throw new MyWorkError(
        'ADAPTER_UNAVAILABLE',
        `dsh-mywork: beads status "${row.status}" has no MyWork mapping`,
        { details: { taskId: row.id, status: row.status } },
      )
    }
    return Object.freeze({ id: row.id, state })
  }

  /**
   * Apply a query's local filters.
   *
   * Beads has no per-id or per-workspace filter on `ready`/`blocked`, so these
   * are applied here. They narrow the result and never widen it, which is what
   * keeps a filtered readiness query from promising work the backend did not.
   */
  private select(rows: readonly BeadsIssueRow[], query: ReadyTaskQuery): readonly BeadsIssueRow[] {
    const ids = query.ids
    if (ids === undefined) return rows
    const wanted = new Set(ids)
    return rows.filter(row => wanted.has(row.id))
  }

  /**
   * Edges of one task, or of the whole graph.
   *
   * `bd dep list <id> --json` returns the **target issues** (each row is the task
   * being depended on, with `dependency_type`), not an edge record — a parser
   * looking for `depends_on_id` finds nothing and silently reports an empty
   * graph. `bd dep list` without an id is rejected outright, so the whole-graph
   * case enumerates task ids and unions their edges.
   * @param id - optional task to narrow to.
   */
  async dependencies(id?: TaskId): Promise<readonly TaskDependency[]> {
    await this.requireWorkspace()
    if (id !== undefined) return this.dependenciesOf(id)

    const listed = await this.run(['list', '--json'])
    if (listed.code !== 0) throw this.failedCommand('list', listed.code, listed.stderr)
    const rows = this.parseJson<BeadsIssueRow[]>('list', listed.stdout)
    const edges: TaskDependency[] = []
    for (const row of rows) {
      // A task with no dependencies is reported by its own count, so the per-id
      // read is skipped entirely for the common case.
      if ((row.dependency_count ?? 0) === 0) continue
      edges.push(...(await this.dependenciesOf(row.id)))
    }
    return Object.freeze(edges)
  }

  /** Edges of exactly one task. */
  private async dependenciesOf(id: TaskId): Promise<readonly TaskDependency[]> {
    const result = await this.run(['dep', 'list', id, '--json'])
    if (result.code !== 0) throw this.failedCommand(`dep list ${id}`, result.code, result.stderr)
    const rows = this.parseJson<BeadsDependencyRow[]>('dep list', result.stdout)
    const edges: TaskDependency[] = []
    for (const row of rows) {
      // The row IS the dependency target; `id` is its issue id.
      const to = row.id
      if (to === undefined) continue
      edges.push(Object.freeze({ from: id, to, kind: row.dependency_type ?? 'blocks' }))
    }
    return Object.freeze(edges)
  }

  /** Build the typed failure for a `bd` command that exited non-zero. */
  private failedCommand(label: string, code: number, stderr: string): MyWorkError {
    const kind = classifyBeadsFailure(code, stderr)
    if (kind === 'no-workspace') {
      return new MyWorkError(
        'ADAPTER_UNAVAILABLE',
        `dsh-mywork: bd ${label} found no beads workspace; initialise one with "${BEADS_INIT_COMMAND}"`,
        { details: { label, exitCode: code, fixCommand: BEADS_INIT_COMMAND, kind } },
      )
    }
    if (kind === 'panic') {
      // ADR023: an unreachable Dolt root surfaces as a panic, not a clean error.
      // It is reported as unavailable with the remedy named, never retried in a
      // loop — retrying a missing Dolt root cannot succeed.
      return new MyWorkError(
        'ADAPTER_UNAVAILABLE',
        `dsh-mywork: bd ${label} panicked (exit ${String(code)}); its Dolt root is likely unreachable — check write access to the Dolt data directory`,
        { details: { label, exitCode: code, kind, stderr: stderr.slice(0, 2000) } },
      )
    }
    return new MyWorkError('ADAPTER_UNAVAILABLE', `dsh-mywork: bd ${label} failed (exit ${String(code)})`, {
      details: { label, exitCode: code, kind, stderr: stderr.slice(0, 2000) },
    })
  }

  /**
   * Claim a task for one worker (ADR023: `bd update --claim`).
   *
   * `--claim` is Beads' own atomic compare-and-set, so concurrency is decided by
   * the backend and exactly one concurrent caller wins. Losing is reported as
   * `won: false` with the holder named, not as an error: a lost race is an
   * ordinary outcome of two workers reaching the same ready task.
   *
   * `expectedRevision` cannot be enforced here — `bd update --claim` takes no
   * precondition, and the adapter declares `http: false`, so the guarded
   * composite ADR023 describes is unavailable. Rather than claim blind, a caller
   * that demands a revision is refused.
   * @param command - task, claimant, and the observation the claim is based on.
   */
  async claim(command: ClaimTaskCommand): Promise<ClaimResult> {
    await this.requireWorkspace()
    this.requireCapability('claim-lease', 'claim')
    if (command.expectedRevision !== undefined) {
      // ADR023: a composite with an expected revision needs the HTTP guard, which
      // is declared false. The caller stages it instead (ADR024).
      throw capabilityUnsupported(
        'dsh-mywork: beads CLI claim cannot enforce expectedRevision; stage the claim through a guarded transition or drop the precondition',
        {
          capability: 'http',
          requiredBy: 'claim',
          operation: command.meta.operationId,
          taskId: command.id,
        },
      )
    }
    // `--claim` alone is idempotent: repeating it as the same actor exits 0 both
    // times. `--assignee` must NOT be combined with it — that pre-sets a holder
    // the claim then competes with, and the second call fails with "issue already
    // claimed by ...". The claimant is therefore supplied through BEADS_ACTOR,
    // which is the identity claim actually records.
    const result = await this.run(
      ['update', command.id, '--claim', '--json'],
      undefined,
      { BEADS_ACTOR: command.claimant },
    )
    if (result.code !== 0) {
      // A claim that lost the race reports the current holder; surface it.
      const holder = await this.currentAssignee(command.id)
      if (holder !== undefined && holder !== command.claimant) {
        return Object.freeze({ won: false, holder })
      }
      throw this.failedCommand(`update --claim ${command.id}`, result.code, result.stderr)
    }
    const task = await this.get(command.id)
    // `--claim` is idempotent for the same claimant, so `won` is decided by who
    // the backend now records, not by whether the call changed anything.
    const holder = await this.currentAssignee(command.id)
    if (holder !== undefined && holder !== command.claimant) {
      return Object.freeze({ won: false, holder })
    }
    return Object.freeze({ won: true, task })
  }

  /** Read a task's current assignee, when it has one. */
  private async currentAssignee(id: TaskId): Promise<string | undefined> {
    const result = await this.run(['show', id, '--json'])
    if (result.code !== 0) return undefined
    const rows = this.parseJson<BeadsIssueRow[]>('show', result.stdout)
    const assignee = rows[0]?.assignee
    return assignee === null || assignee === undefined || assignee === '' ? undefined : assignee
  }

  /**
   * Move a task to another state (ADR023: `bd update --if-status` / `--if-assignee`).
   *
   * The guard is the point of this method. `bd update` exits `13` when the
   * precondition no longer held and **nothing was written**, which is a different
   * fact from a general failure (exit `1`) and is reported as `STALE_REVISION` so
   * the caller can distinguish "another actor moved it" from "the backend broke".
   *
   * There is no `guarded-batch` here: the guard lives on the single-issue update,
   * so this is a compare-and-set on one task, never a batched one (ADR024).
   * @param command - task, target state, and the observation the move is based on.
   */
  async transition(command: TaskTransitionCommand): Promise<Task> {
    await this.requireWorkspace()
    const status = beadsStatusOf(command.to)
    const args = ['update', command.id, '--status', status]
    if (command.expectedRevision !== undefined || command.expectedAssignee !== undefined) {
      // Re-read to learn the current status the guard must name: `--if-status`
      // compares against a literal, and the caller gave us a revision, not a
      // status. The read also makes the stale check explicit before the write.
      const current = await this.get(command.id)
      if (command.expectedRevision !== undefined && current.revision !== command.expectedRevision) {
        throw new MyWorkError('STALE_REVISION', `dsh-mywork: task "${command.id}" moved on`, {
          details: {
            taskId: command.id,
            expected: command.expectedRevision,
            actual: current.revision,
          },
        })
      }
      args.push('--if-status', beadsStatusOf(current.state))
      if (command.expectedAssignee !== undefined) {
        args.push('--if-assignee', command.expectedAssignee)
      }
    }
    args.push('--json')
    const result = await this.run(args)
    if (result.code === BD_EXIT_GUARD_FAILED) {
      throw new MyWorkError(
        'STALE_REVISION',
        `dsh-mywork: the guard on task "${command.id}" no longer held; nothing was written`,
        { details: { taskId: command.id, exitCode: result.code, operation: command.meta.operationId } },
      )
    }
    if (result.code !== 0) {
      throw this.failedCommand(`update --status ${status} ${command.id}`, result.code, result.stderr)
    }
    return this.get(command.id)
  }

  /**
   * Keep a held claim's lease alive (ADR023: `bd heartbeat`).
   * @param id - task whose claim this worker holds.
   */
  async heartbeat(id: TaskId): Promise<void> {
    await this.requireWorkspace()
    this.requireCapability('heartbeat', 'heartbeat')
    const result = await this.run(['heartbeat', id])
    if (result.code !== 0) {
      throw this.failedCommand(`heartbeat ${id}`, result.code, result.stderr)
    }
  }

  /**
   * Revert claims whose lease has gone stale (ADR023: `bd reclaim`).
   *
   * Beads skips leases another replica granted, so a returned list is what *this*
   * replica actually reclaimed, not every stale claim in existence.
   * @param options - grace window past lease expiry.
   */
  async reclaim(options: { readonly olderThanMs?: number } = {}): Promise<readonly TaskId[]> {
    await this.requireWorkspace()
    this.requireCapability('reclaim', 'reclaim')
    const args = ['reclaim', '--json']
    if (options.olderThanMs !== undefined) {
      args.push('--older-than', formatDuration(options.olderThanMs))
    }
    const result = await this.run(args)
    if (result.code !== 0) {
      throw this.failedCommand('reclaim', result.code, result.stderr)
    }
    const rows = this.parseJson<BeadsIssueRow[]>('reclaim', result.stdout)
    return Object.freeze(rows.map(row => row.id))
  }

  /**
   * Read the mutation journal after a cursor (ADR023, §48).
   *
   * The journal is per-replica and per-branch: rows arrive by direct write, not
   * by merge, so a cursor from a different replica or a different Dolt branch
   * names a different record. Either mismatch requests a re-baseline instead of
   * resuming, which is what keeps a consumer from silently skipping mutations.
   *
   * A pruned prefix is reported the same way. Beads fails such a read rather than
   * returning a truncated success, and the adapter turns that failure into
   * `reBaseline: true` with an empty batch — the caller re-reads the graph in
   * full, which is the only honest recovery.
   * @param cursor - where to resume; absent means re-baseline from the start.
   */
  async events(cursor?: JournalCursor): Promise<JournalReadResult> {
    const workspace = await this.requireWorkspace()
    this.requireCapability('events-journal', 'events')
    const replica = workspace.repoRoot
    const branch = await this.currentBranch()
    if (cursor !== undefined && (cursor.replica !== replica || cursor.branch !== branch)) {
      return Object.freeze({
        events: Object.freeze([]),
        cursor: Object.freeze({ seq: 0, replica, branch }),
        reBaseline: true,
      })
    }
    const since = cursor?.seq ?? 0
    const result = await this.run(['events', 'tail', '--since', String(since), '--json'])
    if (result.code !== 0) {
      if (/events_journal_truncated|below the oldest retained/i.test(result.stderr)) {
        return Object.freeze({
          events: Object.freeze([]),
          cursor: Object.freeze({ seq: 0, replica, branch }),
          reBaseline: true,
        })
      }
      throw this.failedCommand('events tail', result.code, result.stderr)
    }
    const events: TaskGraphEvent[] = []
    let highest = since
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line.trim() === '') continue
      const record = this.parseJson<{ seq?: number; ts?: string; op?: string; issue_id?: string }>(
        'events tail',
        line,
      )
      if (typeof record.seq !== 'number' || typeof record.issue_id !== 'string') continue
      highest = Math.max(highest, record.seq)
      events.push(
        Object.freeze({
          seq: record.seq,
          at: record.ts === undefined ? 0 : Date.parse(record.ts),
          op: record.op ?? '',
          taskId: record.issue_id,
        }),
      )
    }
    return Object.freeze({
      events: Object.freeze(events),
      cursor: Object.freeze({ seq: highest, replica, branch }),
      reBaseline: false,
    })
  }

  /** The Dolt branch the workspace is currently on, or `main` when unknown. */
  private async currentBranch(): Promise<string> {
    const result = await this.run(['branch'])
    if (result.code !== 0) return 'main'
    // `bd branch` prints a bullet next to the active branch.
    const active = result.stdout
      .split(/\r?\n/)
      .map(line => /^\s*\*\s+(\S+)\s*$/.exec(line)?.[1])
      .find(name => name !== undefined)
    return active ?? 'main'
  }

  /**
   * Report the health of this binding.
   *
   * Findings are returned, never acted on: the adapter does not repair the
   * workspace. Each finding an operator can fix carries the exact command, which
   * is the behaviour ADR023 requires for a missing workspace and the card
   * requires for an incomplete `status.custom`.
   */
  async doctor(): Promise<readonly DiagnosticReport[]> {
    const reports: DiagnosticReport[] = []
    const workspace = await discoverWorkspace(this.runner, this.cwd)
    if (workspace === undefined) {
      reports.push(
        Object.freeze({
          check: 'beads.workspace',
          severity: 'error' as const,
          detail: `no beads workspace is resolvable from ${this.cwd}`,
          fixCommand: BEADS_INIT_COMMAND,
        }),
      )
      return Object.freeze(reports)
    }
    reports.push(
      Object.freeze({
        check: 'beads.workspace',
        severity: 'ok' as const,
        detail: `workspace ${workspace.beadsDir} (${workspace.backendType}/${workspace.backendMode}, database ${workspace.database})`,
      }),
    )

    // ADR023: the full ten-status set is what makes the status categories
    // explicit. A partial set does not break readiness — an uncategorised status
    // is excluded from `bd ready` too — but it makes the reason implicit, so the
    // gap is a warning that names every missing status and its category.
    const configured = await this.readStatusCustom()
    if (configured === undefined) {
      reports.push(
        Object.freeze({
          check: 'beads.status.custom',
          severity: 'warning' as const,
          detail:
            'status.custom could not be read; the ten ADR023 statuses cannot be confirmed',
          fixCommand: `bd config set status.custom "${ADR023_STATUS_CUSTOM}"`,
          missing: Object.freeze(ADR023_STATUSES.map(status => status.name)),
        }),
      )
    } else {
      const gaps = statusCustomGaps(configured)
      if (gaps.length === 0) {
        reports.push(
          Object.freeze({
            check: 'beads.status.custom',
            severity: 'ok' as const,
            detail: `all ${String(ADR023_STATUSES.length)} ADR023 statuses are configured with their categories`,
          }),
        )
      } else {
        reports.push(
          Object.freeze({
            check: 'beads.status.custom',
            severity: 'warning' as const,
            detail: `status.custom is incomplete: ${gaps
              .map(gap =>
                gap.actual === undefined
                  ? `${gap.name} (missing, requires ${gap.expected})`
                  : `${gap.name} (has ${gap.actual}, requires ${gap.expected})`,
              )
              .join(', ')}`,
            fixCommand: `bd config set status.custom "${ADR023_STATUS_CUSTOM}"`,
            missing: Object.freeze(gaps.map(gap => gap.name)),
          }),
        )
      }
    }

    // The journal is optional (the card records enabling it as an owner action),
    // so a disabled journal is informational, not a defect of this adapter.
    const journal = await this.readConfig('events-journal')
    if (journal !== undefined && !/^(true|1)$/i.test(journal)) {
      reports.push(
        Object.freeze({
          check: 'beads.events.journal',
          severity: 'warning' as const,
          detail: 'the events journal is disabled, so mutation cursors cannot be read',
          fixCommand: 'bd config set events-journal true',
        }),
      )
    }
    return Object.freeze(reports)
  }

  /** Read `status.custom` as status → category. */
  private async readStatusCustom(): Promise<Readonly<Record<string, BeadsStatusCategory>> | undefined> {
    // `bd statuses` is the only surface that reports each custom status with its
    // category, so it is preferred over reading the raw config string: the raw
    // value would let the adapter believe a category Beads did not accept.
    const result = await this.run(['statuses', '--json'])
    if (result.code !== 0) {
      const raw = await this.readConfig('status.custom')
      return raw === undefined ? undefined : parseStatusCustom(raw)
    }
    const parsed = this.parseJson<{
      custom_statuses?: readonly { name?: string; category?: string }[]
    }>('statuses', result.stdout)
    const configured: Record<string, BeadsStatusCategory> = {}
    for (const entry of parsed.custom_statuses ?? []) {
      if (typeof entry.name !== 'string' || typeof entry.category !== 'string') continue
      if (entry.category === 'active' || entry.category === 'wip' || entry.category === 'frozen' || entry.category === 'done') {
        configured[entry.name] = entry.category
      }
    }
    return Object.freeze(configured)
  }

  /** Read one `bd config` value, or `undefined` when it is unset. */
  private async readConfig(key: string): Promise<string | undefined> {
    const result = await this.run(['config', 'get', key])
    if (result.code !== 0) return undefined
    const value = result.stdout.trim()
    return value === '' ? undefined : value
  }

  /**
   * Apply a plan revision (ADR024).
   *
   * Two paths, chosen by the mutation's shape. A create-only mutation goes
   * through the atomic `bd create --graph` composite, which also cycle-checks
   * internally. Anything touching an existing task is staged: intent is recorded
   * by the caller (ADR024 step 2), the supported parts run, the unsupported part
   * — `dep_remove`, and metadata — runs as its own step, and the outcome is
   * re-read and verified before the caller resumes admission.
   *
   * A cycle is rejected **before** anything is applied, and a verification
   * mismatch raises `PLAN_MUTATION_RECOVERY` instead of reporting success.
   * @param command - the mutation and the revision it was computed against.
   */
  async mutatePlan(command: PlanMutationCommand): Promise<PlanMutationResult> {
    await this.requireWorkspace()
    const creates = command.create ?? []
    const additions = command.addDependencies ?? []
    const removals = command.removeDependencies ?? []

    // A cycle is refused before any write, whichever path would run. Edges the
    // same mutation removes are excluded from the graph the check sees: a
    // mutation that swaps a direction — remove A→B, add B→A — is legal, and
    // checking it against the pre-mutation graph would reject it.
    const removedKeys = new Set(removals.map(edge => `${edge.from}\u0000${edge.to}`))
    const existing = (await this.dependencies()).filter(
      edge => !removedKeys.has(`${edge.from}\u0000${edge.to}`),
    )
    const proposed = [
      ...additions,
      ...creates.flatMap(spec =>
        (spec.dependsOnKeys ?? []).map(key => ({ from: spec.key, to: key, kind: 'blocks' })),
      ),
    ]
    const cycle = detectCycle(existing, proposed)
    if (cycle.cyclic) {
      throw new MyWorkError('ENTITY_CYCLE', 'dsh-mywork: the plan would create a dependency cycle', {
        details: { path: cycle.path ?? [], operationId: command.meta.operationId },
      })
    }

    if (canApplyAtomically(command)) {
      this.requireCapability('graph-apply', 'mutatePlan (atomic composite)')
      const plan = toGraphApplyPlan(command)
      // `--graph` takes a FILE, not stdin: `-` is treated as a literal filename
      // and fails, so the plan is written to a temporary file and removed after.
      const planPath = await writeTempPlan(this.cwd, plan)
      try {
        const result = await this.run(['create', '--graph', planPath, '--json'])
        if (result.code !== 0) {
          throw this.failedCommand('create --graph', result.code, result.stderr)
        }
        const created = parseGraphApplyOutput(result.stdout, plan)
        return Object.freeze({
          mode: 'atomic' as const,
          created,
          addedDependencies: Object.freeze([...additions]),
          removedDependencies: Object.freeze([]),
        })
      } finally {
        await removeTempPlan(planPath)
      }
    }

    return this.applyStaged(command)
  }

  /**
   * Apply a mutation that no single primitive covers (ADR024).
   * @param command - the mutation to stage.
   */
  private async applyStaged(command: PlanMutationCommand): Promise<PlanMutationResult> {
    const staged = toStagedMutationPlan(command)

    // Step 3a: the supported parts, as one transaction where one exists.
    if (staged.batch.length > 0) {
      this.requireCapability('batch', 'mutatePlan (staged batch)')
      const result = await this.run(['batch'], `${staged.batch.join('\n')}\n`)
      if (result.code !== 0) {
        // The batch is one transaction: a failure rolled the whole thing back,
        // so nothing needs undoing and the plan is left in recovery.
        throw new MyWorkError(
          'PLAN_MUTATION_RECOVERY',
          'dsh-mywork: the staged batch failed and was rolled back; the plan needs an operator',
          {
            details: {
              operationId: command.meta.operationId,
              exitCode: result.code,
              stderr: result.stderr.slice(0, 2000),
            },
          },
        )
      }
    }

    // Step 3b: the part `bd batch` cannot carry — metadata, written per key.
    for (const update of staged.updates) {
      await this.applyMetadataUpdate(update, command.meta.operationId)
    }

    // Step 3c: creates, when the mutation also created tasks. They are applied
    // last so an existing task's edges are settled before new dependents appear.
    const created: Record<string, TaskId> = {}
    const creates = command.create ?? []
    if (creates.length > 0) {
      Object.assign(created, await this.createStaged(creates, command.meta.operationId))
    }

    // Step 4: integrity verification against the graph that actually resulted.
    const observed = await this.dependencies()
    verifyStagedMutation(command, observed)

    return Object.freeze({
      mode: 'staged' as const,
      created: Object.freeze(created),
      addedDependencies: Object.freeze([...(command.addDependencies ?? [])]),
      removedDependencies: Object.freeze([...(command.removeDependencies ?? [])]),
    })
  }

  /**
   * Write metadata one key at a time.
   *
   * `--metadata` takes a JSON document, but Beads **merges** it rather than
   * replacing, so it cannot express "this is the document now". Writing per key
   * with `--set-metadata` is the only form whose effect matches its intent, and
   * it is what the card requires: metadata is written by key-scoped operations
   * and document replacement is never used.
   */
  private async applyMetadataUpdate(
    update: MetadataUpdate,
    operationId: string,
  ): Promise<void> {
    this.requireCapability('metadata-set', 'mutatePlan (metadata)')
    const args = ['update', update.id]
    if (update.title !== undefined) args.push('--title', update.title)
    if (update.priority !== undefined) args.push('--priority', String(update.priority))
    for (const [key, value] of Object.entries(update.setMetadata ?? {})) {
      args.push('--set-metadata', `${key}=${value}`)
    }
    const result = await this.run([...args, '--json'])
    if (result.code === BD_EXIT_GUARD_FAILED) {
      throw new MyWorkError(
        'STALE_REVISION',
        `dsh-mywork: the guard on task "${update.id}" no longer held during a staged update`,
        { details: { taskId: update.id, operationId } },
      )
    }
    if (result.code !== 0) {
      throw new MyWorkError(
        'PLAN_MUTATION_RECOVERY',
        `dsh-mywork: staged metadata update on "${update.id}" failed; the plan needs an operator`,
        { details: { taskId: update.id, operationId, exitCode: result.code, stderr: result.stderr.slice(0, 2000) } },
      )
    }
  }

  /** Create staged tasks one at a time, mapping each key to its new id. */
  private async createStaged(
    creates: readonly NewTaskSpec[],
    operationId: string,
  ): Promise<Record<string, TaskId>> {
    const created: Record<string, TaskId> = {}
    for (const spec of creates) {
      const args = ['create', '--title', spec.title]
      if (spec.description !== undefined) args.push('--description', spec.description)
      if (spec.priority !== undefined) args.push('--priority', String(spec.priority))
      if (spec.externalRef !== undefined) args.push('--external-ref', spec.externalRef)
      args.push('--silent')
      const result = await this.run(args)
      if (result.code !== 0) {
        throw new MyWorkError(
          'PLAN_MUTATION_RECOVERY',
          `dsh-mywork: staged create of "${spec.key}" failed; the plan needs an operator`,
          { details: { key: spec.key, operationId, exitCode: result.code, stderr: result.stderr.slice(0, 2000) } },
        )
      }
      const id = result.stdout.trim().split(/\r?\n/).pop()?.trim()
      if (id === undefined || id === '') {
        throw new MyWorkError(
          'PLAN_MUTATION_RECOVERY',
          `dsh-mywork: staged create of "${spec.key}" returned no id`,
          { details: { key: spec.key, operationId } },
        )
      }
      created[spec.key] = id
    }
    return created
  }
}

/**
 * Format a duration the way `bd reclaim --older-than` expects.
 * @param ms - duration in milliseconds.
 */
export function formatDuration(ms: number): string {
  return `${String(Math.max(0, Math.round(ms / 1000)))}s`
}

/**
 * Read the key → id mapping out of a `bd create --graph --json` run.
 *
 * The reply is `{"ids": {"<key>": "<issue-id>"}, "schema_version": 1}`. Keys are
 * validated against the submitted plan so an unexpected key cannot invent a
 * mapping the caller never asked for; a key the plan declared but the reply omits
 * is simply absent, and the caller sees the plan did not create it.
 * @param stdout - the command's standard output.
 * @param plan - the plan that was submitted.
 */
export function parseGraphApplyOutput(
  stdout: string,
  plan: { readonly nodes: readonly { readonly key: string }[] },
): Readonly<Record<string, TaskId>> {
  const declared = new Set(plan.nodes.map(node => node.key))
  let parsed: { ids?: Record<string, unknown> }
  try {
    parsed = JSON.parse(stdout) as { ids?: Record<string, unknown> }
  } catch {
    return Object.freeze({})
  }
  const created: Record<string, TaskId> = {}
  for (const [key, id] of Object.entries(parsed.ids ?? {})) {
    if (!declared.has(key) || typeof id !== 'string') continue
    created[key] = id
  }
  return Object.freeze(created)
}

/**
 * Write a graph plan to a temporary file inside the workspace.
 *
 * `bd create --graph` reads a path and does not accept stdin, so the plan has to
 * land on disk. It is written into the workspace rather than the system temp
 * directory because `bd` resolves its workspace by walking up from the process
 * directory, and an unrelated path would be an easy way to write into the wrong
 * project.
 * @param cwd - the adapter's working directory.
 * @param plan - the plan document.
 */
export async function writeTempPlan(cwd: string, plan: GraphApplyPlan): Promise<string> {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(cwd, '.mw-plan-'))
  const path = join(dir, 'plan.json')
  await writeFile(path, JSON.stringify(plan), 'utf8')
  return path
}

/**
 * Remove a plan written by {@link writeTempPlan}.
 *
 * The temporary directory is addressed by the same path that was created, so a
 * failure here cannot delete anything outside it.
 * @param planPath - the path {@link writeTempPlan} returned.
 */
export async function removeTempPlan(planPath: string): Promise<void> {
  const { rm } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  await rm(dirname(planPath), { recursive: true, force: true })
}

/**
 * Read a revision the backend reports, which is a stringified int64.
 * @param value - the raw revision field.
 */
export function toRevision(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10)
  // A revision outside the exact-integer range still varies between writes, and
  // the adapter only ever compares it for equality, so it is clamped rather than
  // rejected: refusing here would make a valid task unreadable.
  if (!Number.isFinite(parsed)) return 0
  return parsed
}
