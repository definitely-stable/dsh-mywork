/**
 * Where MyWork keeps runtime state (architecture §7): never inside the user's
 * repository, always below `$DSH_HOME/dsh-mywork`.
 *
 * ```text
 * $DSH_HOME/dsh-mywork/
 * └─ state/
 *    ├─ registry.sqlite
 *    └─ controller.sqlite
 * ```
 *
 * The harness-home precedence is the one DeepSeek Harness itself documents
 * (`@deepseek-ai/dsh-home-paths`): an explicit path, then `$DSH_HOME`, then
 * `~/.dsh`, with a blank `$DSH_HOME` treated as unset and `~` expanded. It is
 * mirrored here instead of imported so the store keeps a single external
 * dependency (the contracts package) and stays usable from a bare checkout.
 * @module
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Directory MyWork owns below the harness home. */
export const MYWORK_DIR_NAME = 'dsh-mywork'

/** Directory holding the SQLite state databases (§7). */
export const MYWORK_STATE_DIR_NAME = 'state'

/** Environment variable that overrides the harness home. */
export const DSH_HOME_ENV = 'DSH_HOME'

/** The state databases §7 names for this stage. */
export const MYWORK_STATE_DATABASES: readonly ['registry', 'controller'] = Object.freeze([
  'registry',
  'controller',
] as const)

/** One of the state databases below `$DSH_HOME/dsh-mywork/state`. */
export type MyWorkStateDatabase = (typeof MYWORK_STATE_DATABASES)[number]

/** Resolved MyWork state locations. */
export interface MyWorkLayout {
  /** Resolved harness home (`$DSH_HOME` or the default). */
  readonly dshHome: string
  /** MyWork root: `<dshHome>/dsh-mywork`. */
  readonly root: string
  /** Directory holding the state databases: `<root>/state`. */
  readonly stateDir: string
}

/** Inputs of {@link resolveMyWorkLayout}. */
export interface ResolveMyWorkLayoutOptions {
  /** Explicit harness home; highest precedence. */
  readonly dshHome?: string
  /** Environment consulted for `DSH_HOME`; defaults to `process.env`. */
  readonly env?: Record<string, string | undefined>
}

/** Expand a leading `~`, `~/`, or `~\` against the operating-system home. */
function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** Default harness home: `~/.dsh`. */
export function defaultDshHome(): string {
  return join(homedir(), '.dsh')
}

/**
 * Resolve the MyWork state layout for one home.
 * @param options - explicit home and/or environment mapping.
 * @returns the harness home, the MyWork root, and the state directory.
 */
export function resolveMyWorkLayout(options: ResolveMyWorkLayoutOptions = {}): MyWorkLayout {
  const env = options.env ?? process.env
  const fromEnv = env[DSH_HOME_ENV]
  const selected = options.dshHome
    ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : defaultDshHome())
  const dshHome = resolve(expandHomePath(selected))
  const root = join(dshHome, MYWORK_DIR_NAME)
  return Object.freeze({ dshHome, root, stateDir: join(root, MYWORK_STATE_DIR_NAME) })
}

/**
 * Absolute path of one state database.
 * @param layout - layout returned by {@link resolveMyWorkLayout}.
 * @param database - which state database to address.
 */
export function stateDatabasePath(layout: MyWorkLayout, database: MyWorkStateDatabase): string {
  return join(layout.stateDir, `${database}.sqlite`)
}
