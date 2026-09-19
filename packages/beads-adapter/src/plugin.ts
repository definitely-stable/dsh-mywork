/**
 * Cordis row of the Beads TaskGraph adapter (architecture §44).
 *
 * The row does exactly two things: it resolves the `bd` workspace, and it
 * registers its declaration in the controller's `myworkAdapters` registry so the
 * rest of MyWork can negotiate for the `taskgraph` port by capability instead of
 * naming Beads. The registration is an effect of this plugin's fiber, so
 * unloading removes it (ADR023, §44).
 *
 * It deliberately does **not** create a workspace, start `bd serve`, or write to
 * the database: a row that repaired its own preconditions could not report them.
 * @module @dsh-mywork/beads-adapter/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { MYWORK_ADAPTERS_SERVICE } from '@dsh-mywork/contracts'
import type { MyWorkAdapters } from '@dsh-mywork/adapter-sdk'

import {
  BEADS_ADAPTER_MANIFEST,
  BeadsTaskGraphAdapter,
  type BeadsAdapterOptions,
} from './adapter.ts'
import { createProcessRunner } from './runner.ts'
import { BEADS_INIT_COMMAND, discoverWorkspace } from './workspace.ts'

/** Plugin display name used by the Cordis loader. */
export const name = '@dsh-mywork/beads-adapter'

/** Row configuration accepted by the adapter plugin. */
export interface BeadsAdapterConfig {
  /**
   * Directory `bd` runs in. Defaults to the plugin context's working directory.
   *
   * No database redirect is offered on purpose: worktrees share the database
   * through git common-directory discovery, and a manual redirect would silently
   * point at a different one (ADR023).
   */
  readonly cwd?: string
  /** Path or name of the `bd` binary. Defaults to `bd` from `PATH`. */
  readonly binary?: string
  /** Milliseconds before a `bd` command is killed. */
  readonly timeoutMs?: number
}

/** Resolve the row configuration, rejecting anything the loader mis-typed. */
function resolveConfig(raw: unknown): BeadsAdapterConfig {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('dsh-mywork: beads adapter config must be an object')
  }
  const config = raw as Record<string, unknown>
  for (const key of ['cwd', 'binary'] as const) {
    const value = config[key]
    if (value !== undefined && typeof value !== 'string') {
      throw new TypeError(`dsh-mywork: beads adapter config "${key}" must be a string`)
    }
  }
  const timeoutMs = config.timeoutMs
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs))) {
    throw new TypeError('dsh-mywork: beads adapter config "timeoutMs" must be a number')
  }
  return {
    ...(config.cwd === undefined ? {} : { cwd: config.cwd as string }),
    ...(config.binary === undefined ? {} : { binary: config.binary as string }),
    ...(timeoutMs === undefined ? {} : { timeoutMs: timeoutMs as number }),
  }
}

/**
 * Mount the adapter row.
 *
 * A missing workspace is **not** a mount failure: the adapter is registered, and
 * every operation answers `ADAPTER_UNAVAILABLE` with the exact init command, so
 * the operator sees a diagnosis instead of a plugin that refused to load. The
 * same facts are what the Doctor reports.
 * @param ctx - the plugin context.
 * @param rawConfig - the row's `config:` value.
 */
export function apply(ctx: Context, rawConfig?: unknown): void {
  const config = resolveConfig(rawConfig)
  const cwd = config.cwd ?? process.cwd()
  const options: BeadsAdapterOptions = {
    runner: createProcessRunner({
      ...(config.binary === undefined ? {} : { binary: config.binary }),
      ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    }),
    cwd,
  }
  const adapter = new BeadsTaskGraphAdapter(options)

  // The registry is another plugin's service, so it may not be mounted yet. A row
  // that hard-required it would fail to load in a profile without the controller.
  const adapters = ctx.get(MYWORK_ADAPTERS_SERVICE) as MyWorkAdapters | undefined
  if (adapters === undefined) {
    ctx.logger?.warn?.(
      `dsh-mywork: ${MYWORK_ADAPTERS_SERVICE} is not mounted, so the beads adapter is not registered`,
    )
    return
  }

  const handle = adapters.register(
    {
      kind: BEADS_ADAPTER_MANIFEST.kind,
      id: BEADS_ADAPTER_MANIFEST.adapterId,
      contractVersion: BEADS_ADAPTER_MANIFEST.contractVersion,
      capabilities: BEADS_ADAPTER_MANIFEST.capabilities,
      create: () => adapter,
    },
    undefined,
  )

  ctx.effect(() => () => {
    handle.unregister()
  })

  // Report the workspace once at mount. The row does not repair it — it names the
  // command an operator would run.
  void discoverWorkspace(options.runner, cwd).then(
    workspace => {
      if (workspace === undefined) {
        ctx.logger?.warn?.(
          `dsh-mywork: no beads workspace is resolvable from ${cwd}; initialise one with "${BEADS_INIT_COMMAND}"`,
        )
        return
      }
      ctx.logger?.info?.(
        `dsh-mywork: beads adapter registered workspace=${workspace.repoRoot} database=${workspace.database} capabilities=http:false,graph-apply:true`,
      )
    },
    (error: unknown) => {
      ctx.logger?.warn?.(`dsh-mywork: beads workspace discovery failed: ${String(error)}`)
    },
  )
}
