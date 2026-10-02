/**
 * A scratch `DSH_HOME` for tests that mount the controller.
 *
 * The controller opens its SQLite state under `$DSH_HOME`, so a suite that
 * mounts it without pinning that variable writes into the **live** profile of
 * whoever ran the tests (`<home>/.dsh/dsh-mywork/state/*.sqlite`). That happened
 * once in this campaign, which is why the guard here is a *positive* assertion:
 * it does not ask "is this not the live home?", it asks "is this inside
 * `<repo>/.tmp/`?" — the workspace deliberately never addresses the user's
 * profile, not even to look at it.
 *
 * The module imports nothing but Node builtins on purpose: a suite must be able
 * to import it and call {@link scratchDshHome} **before** it dynamically imports
 * a built bundle, because the bundle reads the variable when it mounts.
 *
 * ```js
 * import { assertScratchHome, scratchDshHome } from './lib/tmp-home.mjs'
 *
 * scratchDshHome('runtime')
 * const controller = await import(pathToFileURL('…/packages/controller/lib/index.js').href)
 *
 * test('…', async () => {
 *   assertScratchHome()
 * })
 * ```
 * @module
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, derived from this file's own location. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The one directory a test may point `DSH_HOME` at. */
export const scratchRoot = join(repoRoot, '.tmp')

/** Name of the environment variable the storage layer reads. */
const DSH_HOME_ENV = 'DSH_HOME'

/** The scratch home this process established, once it has. */
let established = null

/**
 * Point `DSH_HOME` at `<repo>/.tmp/<name>-dsh-home` and create it.
 *
 * Idempotent: the first call in a process wins, so a suite cannot silently
 * re-point the variable halfway through a run. Nothing is deleted — the scratch
 * home stays in `.tmp` for inspection after a failure.
 * @param name - suite name; the directory is `<name>-dsh-home`.
 * @returns the absolute path of the scratch home.
 * @throws {Error} when the name is blank.
 */
export function scratchDshHome(name) {
  if (established !== null) return established
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('dsh-mywork tests: scratchDshHome(name) needs a non-empty suite name')
  }
  const home = join(scratchRoot, `${name.trim()}-dsh-home`)
  mkdirSync(home, { recursive: true })
  process.env[DSH_HOME_ENV] = home
  established = home
  return home
}

/**
 * Assert that `DSH_HOME` is set and resolves inside the scratch root.
 *
 * Call it at the start of a test that mounts or starts something: it fails
 * before any state is opened, and it never reads the user's home.
 * @returns the resolved scratch home, so a test can assert where state landed.
 * @throws {Error} when the variable is unset or points outside `<repo>/.tmp/`.
 */
export function assertScratchHome() {
  const configured = process.env[DSH_HOME_ENV]
  if (typeof configured !== 'string' || configured.trim().length === 0) {
    throw new Error(
      `dsh-mywork tests: ${DSH_HOME_ENV} is not set; call scratchDshHome('<suite>') before importing a bundle that opens state`,
    )
  }
  const home = realpathSync(resolve(configured))
  const root = realpathSync(scratchRoot)
  const inside = relative(root, home)
  if (inside.length === 0 || inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(
      `dsh-mywork tests: ${DSH_HOME_ENV} resolves to "${home}", which is not inside "${root}"; `
        + 'a test must never point the controller at a live profile',
    )
  }
  return home
}
