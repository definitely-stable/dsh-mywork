/**
 * The tool surface a worker session is restricted to (F-56, D15).
 *
 * D15 chose an **allowlist** over a denylist, and the platform decides it: an
 * unknown name in a `tools.restrict` filter is an error
 * (`core/tools/src/index.ts:1114-1117` in the DSH checkout), so a deny list of
 * tools that may not be registered yet — `task_board_*`, a dynamic plugin's
 * tools — cannot even be constructed. The allowlist has no such problem: it
 * names what a worker needs, and the intersection with what the composition
 * actually registered is by construction free of unknown names.
 *
 * The list is built **on top of** the two §31 permission sets the contracts
 * already own (`packages/contracts/src/security.ts:201,212`) rather than beside
 * them: this module imports them, unions them into the ceiling of a worker
 * surface, and derives the tool names from that ceiling. A permission that
 * grants no tool says so with an empty entry, so a new permission in the
 * contracts vocabulary is a compile error here instead of a silent hole.
 *
 * The filter is data, not code: extending the surface is a constant plus a test,
 * which is the revision trigger D15 names for a tool that is both needed and
 * dangerous.
 * @module
 */

import {
  IMPLEMENTATION_WRITE_PERMISSIONS,
  REVIEWER_DEFAULT_PERMISSIONS,
  type Permission,
} from '@dsh-mywork/contracts'

/**
 * The permission ceiling of a worker surface.
 *
 * Exactly the two sets §31 already defines for the roles that run and review
 * work — the writer's (`security.ts:212`) and the reviewer's (`security.ts:201`)
 * — unioned, and nothing added here.
 */
export const WORKER_SURFACE_PERMISSIONS: readonly Permission[] = Object.freeze([
  ...IMPLEMENTATION_WRITE_PERMISSIONS,
  ...REVIEWER_DEFAULT_PERMISSIONS,
])

/**
 * Tool names each permission contributes, and nothing else.
 *
 * Total over the permission vocabulary on purpose: a permission added to the
 * contracts must be answered here, and an empty entry is an answer ("this
 * permission grants no tool") rather than an omission. The tool names are the
 * platform's own (`read`, `write`, `edit`, `glob`, `grep`, `read_image`,
 * `str_replace_editor`, `pwsh`, `bash`, `lsp`, `web_fetch`, `web_search`).
 */
export const WORKER_TOOLS_BY_PERMISSION: Readonly<Record<Permission, readonly string[]>> = Object.freeze({
  'workspace.read': Object.freeze(['read', 'read_image', 'glob', 'grep', 'lsp']),
  'workspace.write': Object.freeze(['write', 'edit', 'str_replace_editor']),
  shell: Object.freeze(['pwsh', 'bash']),
  tests: Object.freeze(['pwsh', 'bash']),
  // Git is read and written through the shell, which `shell` and `tests` grant.
  // Declaring a second entry for it would widen the surface by accident.
  'git.read': Object.freeze([]),
  'git.write': Object.freeze([]),
  // A review verdict is a card command (`contracts/src/board.ts:262`), not a tool.
  'review.approve': Object.freeze([]),
  // Outside the worker ceiling today. The entry records what enabling it would
  // grant, so a future decision is one line and one test rather than a hunt.
  network: Object.freeze(['web_fetch', 'web_search']),
  mcp: Object.freeze([]),
  'secrets.use': Object.freeze([]),
  'task.transition': Object.freeze([]),
  production: Object.freeze([]),
})

/**
 * Tool names a worker session may see under the given permissions.
 *
 * The result follows the ceiling's order, not the caller's, so the same
 * permission set always yields the same list and an audit report is stable.
 * @param permissions - permissions the worker holds; must stay inside
 *   {@link WORKER_SURFACE_PERMISSIONS}.
 * @returns the declared tool names those permissions grant, deduplicated.
 * @throws {TypeError} when a permission is outside the worker ceiling, because
 *   answering it with silence would let a caller believe it widened the surface.
 */
export function workerToolAllowlist(
  permissions: readonly Permission[] = WORKER_SURFACE_PERMISSIONS,
): readonly string[] {
  const granted = new Set<Permission>(permissions)
  for (const permission of granted) {
    if (!WORKER_SURFACE_PERMISSIONS.includes(permission)) {
      throw new TypeError(
        `dsh-mywork: "${permission}" is not part of the worker surface; the surface is ${WORKER_SURFACE_PERMISSIONS.join(', ')}`,
      )
    }
  }
  const names: string[] = []
  const seen = new Set<string>()
  for (const permission of WORKER_SURFACE_PERMISSIONS) {
    if (!granted.has(permission)) continue
    for (const name of WORKER_TOOLS_BY_PERMISSION[permission]) {
      if (seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  return Object.freeze(names)
}

/** The declared surface: what a worker session may see by default. */
export const WORKER_TOOL_ALLOWLIST: readonly string[] = workerToolAllowlist()

/**
 * The tools of `available` that the worker surface keeps.
 *
 * `available` is what the composition actually registered — `ctx.tools`' own
 * view of itself. Intersecting with it is what keeps the filter legal: a name in
 * the allowlist that this profile does not mount never reaches `restrict`, whose
 * unknown-name check would otherwise refuse the whole filter.
 * @param available - tool names the composition registered.
 * @param permissions - permissions the worker holds.
 * @returns the kept names, in the order they were given.
 * @throws {TypeError} when a permission is outside the worker ceiling.
 */
export function workerTools(
  available: readonly string[],
  permissions: readonly Permission[] = WORKER_SURFACE_PERMISSIONS,
): readonly string[] {
  const allowed = new Set(workerToolAllowlist(permissions))
  return Object.freeze(available.filter(name => allowed.has(name)))
}

/** Why a surface was not restricted, when it was not. */
export type WorkerSurfaceReason =
  /** The allowlist was applied. */
  | 'restricted'
  /** The composition registered none of the allowlisted tools. */
  | 'no-allowlisted-tools'

/** Audit record of one worker-surface restriction, tied to the attempt (§38). */
export interface WorkerSurfaceReport {
  /** Correlation id of the attempt the surface belongs to (F-54). */
  readonly correlationId: string
  /** Tool names the worker keeps. */
  readonly allowed: readonly string[]
  /** Tool names the restriction removes, for the audit trail. */
  readonly filtered: readonly string[]
  /** Whether a restriction was applied. */
  readonly restricted: boolean
  /** Which of the two outcomes this report describes. */
  readonly reason: WorkerSurfaceReason
}

/** What {@link applyWorkerSurface} needs to know about the composition. */
export interface WorkerSurfaceInput {
  /** Tool names the composition registered. */
  readonly available: readonly string[]
  /** Correlation id of the attempt the surface belongs to. */
  readonly correlationId: string
  /** Permissions the worker holds; defaults to the whole surface. */
  readonly permissions?: readonly Permission[]
}

/**
 * The slice of `ctx.tools` this module uses: `restrict` in a scoped context.
 *
 * Structural on purpose — the platform package is not a dependency of the core
 * package, and `ctx.tools.restrict` requires an `agent.ctx` scope
 * (`core/tools/src/index.ts:1100`), which only the caller can supply.
 */
export interface WorkerToolRestrictPort {
  /**
   * Keep only the named global tools for the calling scope.
   * @param filter - global-tool mask; MyWork passes `allow` and never `deny`.
   * @returns the disposer that lifts the restriction.
   */
  restrict(filter: { readonly allow: readonly string[] }): () => void
}

/**
 * Restrict a worker session's tool surface and report what that removed.
 *
 * The report is the audit half of D15: it names the tools the session lost and
 * carries the attempt's correlation id, so "why could this worker not see tool
 * X" is answerable from the record of the attempt rather than from a guess.
 *
 * An empty intersection is **reported, not applied**: `restrict({ allow: [] })`
 * would mask every tool of the scope, including ones registered later, and a
 * composition that registered none of the allowlisted tools is a configuration
 * defect to surface (`reason: 'no-allowlisted-tools'`) rather than a session to
 * empty out silently. The caller decides whether to refuse the session.
 * @param tools - the scoped tool runtime of the worker session.
 * @param input - what the composition registered and which attempt this is.
 * @returns the audit record of the restriction.
 * @throws {TypeError} when a permission is outside the worker ceiling.
 */
export function applyWorkerSurface(tools: WorkerToolRestrictPort, input: WorkerSurfaceInput): WorkerSurfaceReport {
  const allow = workerTools(input.available, input.permissions)
  const kept = new Set(allow)
  const filtered = Object.freeze(input.available.filter(name => !kept.has(name)))
  if (allow.length === 0) {
    return Object.freeze({
      correlationId: input.correlationId,
      allowed: allow,
      filtered,
      restricted: false,
      reason: 'no-allowlisted-tools',
    })
  }
  tools.restrict(Object.freeze({ allow }))
  return Object.freeze({
    correlationId: input.correlationId,
    allowed: allow,
    filtered,
    restricted: true,
    reason: 'restricted',
  })
}
