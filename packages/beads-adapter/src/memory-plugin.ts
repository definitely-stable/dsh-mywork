/**
 * Cordis row of the Beads memory adapter (architecture §44; §23.8, §57).
 *
 * The row does what the TaskGraph row does and nothing more: it resolves the
 * `bd` workspace, builds the provider, and registers its §37 declaration in the
 * controller's `myworkAdapters` registry, so policy negotiates for the `memory`
 * port by capability instead of naming Beads. The registration is an effect of
 * this plugin's fiber, so unloading removes it.
 *
 * It is a **separate row** from `./plugin` on purpose: a profile that wants the
 * task graph but not the memory backend mounts one and not the other, and a
 * change here can never alter what the accepted TaskGraph row registers.
 *
 * Like that row, it deliberately does **not** create a workspace or repair one:
 * a row that fixed its own preconditions could not report them. A missing
 * workspace is not a mount failure — the provider is registered, `health()`
 * answers `no-workspace`, and every operation refuses with `ADAPTER_UNAVAILABLE`,
 * which is exactly what §57's Doctor reads.
 * @module @dsh-mywork/beads-adapter/memory-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { MYWORK_ADAPTERS_SERVICE } from '@dsh-mywork/contracts'
import type { MyWorkAdapters } from '@dsh-mywork/adapter-sdk'

import {
  BEADS_MEMORY_MANIFEST,
  createBeadsMemoryProvider,
  findBeadsDir,
  type BeadsMemoryProvider,
} from './memory.ts'
import { createProcessRunner } from './runner.ts'
import { BEADS_INIT_COMMAND, discoverWorkspace } from './workspace.ts'

/** Plugin display name used by the Cordis loader. */
export const name = '@dsh-mywork/beads-adapter/memory'

/** Row configuration accepted by the memory adapter plugin. */
export interface BeadsMemoryAdapterConfig {
  /** Directory `bd` runs in. Defaults to the plugin context's working directory. */
  readonly cwd?: string
  /** Path or name of the `bd` binary. Defaults to `bd` from `PATH`. */
  readonly binary?: string
  /** Milliseconds before a `bd` command is killed. */
  readonly timeoutMs?: number
  /** Provider id §23.9's routes name. Defaults to `beads`. */
  readonly provider?: string
  /** Key namespace owned inside the Beads key-value store. */
  readonly keyPrefix?: string
}

/** Resolve the row configuration, rejecting anything the loader mis-typed. */
function resolveConfig(raw: unknown): BeadsMemoryAdapterConfig {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('dsh-mywork: beads memory adapter config must be an object')
  }
  const config = raw as Record<string, unknown>
  for (const key of ['cwd', 'binary', 'provider', 'keyPrefix'] as const) {
    const value = config[key]
    if (value !== undefined && typeof value !== 'string') {
      throw new TypeError(`dsh-mywork: beads memory adapter config "${key}" must be a string`)
    }
  }
  const timeoutMs = config.timeoutMs
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs))) {
    throw new TypeError('dsh-mywork: beads memory adapter config "timeoutMs" must be a number')
  }
  return {
    ...(config.cwd === undefined ? {} : { cwd: config.cwd as string }),
    ...(config.binary === undefined ? {} : { binary: config.binary as string }),
    ...(timeoutMs === undefined ? {} : { timeoutMs: timeoutMs as number }),
    ...(config.provider === undefined ? {} : { provider: config.provider as string }),
    ...(config.keyPrefix === undefined ? {} : { keyPrefix: config.keyPrefix as string }),
  }
}

/**
 * Mount the memory adapter row.
 * @param ctx - the plugin context.
 * @param rawConfig - the row's `config:` value.
 */
export function apply(ctx: Context, rawConfig?: unknown): void {
  const config = resolveConfig(rawConfig)
  const cwd = config.cwd ?? process.cwd()
  const runner = createProcessRunner({
    ...(config.binary === undefined ? {} : { binary: config.binary }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
  })
  // `health` must not spawn, so the workspace is looked for on the filesystem
  // here and the row hands over what it found rather than a probe it never ran.
  const beadsDir = findBeadsDir(cwd)
  const provider: BeadsMemoryProvider = createBeadsMemoryProvider({
    runner,
    cwd,
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.keyPrefix === undefined ? {} : { keyPrefix: config.keyPrefix }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(beadsDir === undefined ? {} : { beadsDir }),
  })

  // The registry is another plugin's service, so it may not be mounted yet. A
  // row that hard-required it would fail to load in a profile without the
  // controller.
  const adapters = ctx.get(MYWORK_ADAPTERS_SERVICE) as MyWorkAdapters | undefined
  if (adapters === undefined) {
    ctx.logger?.warn?.(
      `dsh-mywork: ${MYWORK_ADAPTERS_SERVICE} is not mounted, so the beads memory adapter is not registered`,
    )
    return
  }

  const handle = adapters.register(
    {
      kind: BEADS_MEMORY_MANIFEST.kind,
      id: BEADS_MEMORY_MANIFEST.adapterId,
      contractVersion: BEADS_MEMORY_MANIFEST.contractVersion,
      capabilities: BEADS_MEMORY_MANIFEST.capabilities,
      create: () => provider,
    },
    undefined,
  )

  ctx.effect(() => () => {
    handle.unregister()
  })

  // Report the workspace once at mount, through the same `bd where` the
  // TaskGraph row uses. The row does not repair it — it names the command an
  // operator would run.
  void discoverWorkspace(runner, cwd).then(
    workspace => {
      if (workspace === undefined) {
        ctx.logger?.warn?.(
          `dsh-mywork: no beads workspace is resolvable from ${cwd}; initialise one with "${BEADS_INIT_COMMAND}"`,
        )
        return
      }
      ctx.logger?.info?.(
        `dsh-mywork: beads memory adapter registered provider=${provider.provider} workspace=${workspace.repoRoot} capabilities=reflect:false,versioning:false`,
      )
    },
    (error: unknown) => {
      ctx.logger?.warn?.(`dsh-mywork: beads workspace discovery failed: ${String(error)}`)
    },
  )
}
