#!/usr/bin/env node
/**
 * Re-emit the hand-written browser half after every package build.
 *
 * WHY THIS EXISTS (defect R-08). Every `tsdown.config.ts` in this workspace —
 * all twelve of the existing ones and this package's — sets `clean: true`, so
 * tsdown wipes `lib/` before it writes the host bundle. The browser half is not
 * a tsdown product at all: it is a classic script the page module system
 * evaluates, so it has to be copied into `lib/` AFTER that clean. The mechanism
 * lives here, in the build script, and not in the executor's head: the package's
 * `build` script chains it with `&&` after tsdown, so
 * `corepack pnpm -r run build` cannot produce a package whose `lib/client.js` is
 * missing.
 *
 * The copy is verbatim. `tests/ui-package.test.mjs` asserts that the shipped
 * artifact equals this source, so the two cannot drift.
 */

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package root (`packages/web`). */
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The bundle the platform serves, and the authored file that owns it. */
const bundleSource = join(packageDir, 'src', 'client', 'index.js')
const bundleTarget = join(packageDir, 'lib', 'client.js')

/** The declared type face of that bundle. */
const faceSource = join(packageDir, 'src', 'client', 'index.d.ts')
const faceTarget = join(packageDir, 'lib', 'types', 'client', 'index.d.ts')

/**
 * The artifacts to re-emit, in the order the platform reads them.
 * @type {ReadonlyArray<{ from: string, to: string }>}
 */
const artifacts = [
  { from: bundleSource, to: bundleTarget },
  { from: faceSource, to: faceTarget },
]

// The envelope is the whole reason this file exists: a bundle that lost it
// would still be copied, still be served, and never register — the silent
// failure mode R-08 warns about. Refuse the build instead.
const authored = readFileSync(bundleSource, 'utf8')
if (!authored.includes('window.__ModuleLoader__.load(')) {
  throw new Error(
    `web: ${bundleSource} is not a classic-script module-loader registration `
    + '(expected "window.__ModuleLoader__.load(")',
  )
}

for (const { from, to } of artifacts) {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  console.log(`web: wrote ${to.slice(packageDir.length + 1)}`)
}
