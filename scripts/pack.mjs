#!/usr/bin/env node
/**
 * Pack the controller bundle the way an installed consumer receives it.
 *
 * `pnpm pack` honours the package's `files` allowlist and rewrites workspace
 * protocol ranges, so the tarball is exactly what `dsh plugin add` installs
 * (docs/user/develop/basic/publish.md).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runPnpm } from './lib/process.mjs'

/** Repository root; every path below is addressed from here. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Directory of the controller bundle package. */
const controllerDir = join(repoRoot, 'packages', 'controller')

/**
 * The tarball name `pnpm pack` derives from a manifest. pnpm drops the scope:
 * `@dsh-mywork/controller` becomes `dsh-mywork-controller-0.1.0.tgz`.
 * @param {{ name: string, version: string }} manifest - the package manifest.
 * @returns {string} the deterministic tarball file name.
 */
export function tarballName(manifest) {
  return `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`
}

/**
 * Pack `@dsh-mywork/controller` into a destination directory.
 *
 * Idempotency note: `pnpm pack` writes a *version-deterministic* file name and
 * silently overwrites an existing one. Comparing a "before" set of names with
 * the names found afterwards therefore cannot work on a second run — the
 * tarball is overwritten under the same name and the difference is empty. This
 * removes the same-named file up front and then asserts on that exact path.
 * @param {{ outDir?: string }} [options] - destination; defaults to `.tmp/pack`.
 * @returns {string} absolute path of the produced tarball.
 * @throws {Error} when the build output is missing, `pnpm` cannot be launched,
 *   `pnpm pack` fails, the expected tarball is absent, or it is empty.
 */
export function packController(options = {}) {
  const outDir = options.outDir ?? join(repoRoot, '.tmp', 'pack')
  if (!existsSync(join(controllerDir, 'lib', 'index.js'))) {
    throw new Error('pack: packages/controller/lib/index.js is missing — run "pnpm run build" first')
  }
  const manifest = JSON.parse(readFileSync(join(controllerDir, 'package.json'), 'utf8'))
  const name = tarballName(manifest)
  mkdirSync(outDir, { recursive: true })
  rmSync(join(outDir, name), { force: true })
  rmSync(join(controllerDir, name), { force: true })
  const logDir = join(repoRoot, '.tmp', 'pack-logs')
  const result = runPnpm(['pack', '--pack-destination', outDir], {
    cwd: controllerDir,
    env: process.env,
    logDir,
    logName: 'pnpm-pack',
  })
  // Record which launch branch ran, so diagnosing the runner never requires
  // reading the launcher's code.
  const launch = result.launch
  writeFileSync(
    join(logDir, 'pnpm-pack.launch.log'),
    `branch: ${launch.kind}\ncommand: ${launch.command ?? ''}\nargs: ${JSON.stringify(launch.args ?? [])}\n`
      + `shim: ${launch.shim ?? ''}\nshell: ${String(launch.shell)}\n`,
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`pack: pnpm pack exited with code ${String(result.status)}\n${result.stderr}`)
  }
  const tarball = join(outDir, name)
  if (!existsSync(tarball)) {
    throw new Error(`pack: expected ${name} in ${outDir}, found ${JSON.stringify(readdirSync(outDir))}`)
  }
  if (statSync(tarball).size === 0) throw new Error(`pack: produced an empty tarball at ${tarball}`)
  return tarball
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const tarball = packController()
  const manifest = JSON.parse(readFileSync(join(controllerDir, 'package.json'), 'utf8'))
  console.log(`pack: ${manifest.name}@${manifest.version}`)
  console.log(tarball)
}
