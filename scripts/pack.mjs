#!/usr/bin/env node
/**
 * Pack the MyWork bundles the way an installed consumer receives them.
 *
 * There are two, because there are two halves (D18): `@dsh-mywork/controller`
 * carries the host composition root, and `@dsh-mywork/web` carries the board
 * panel's browser half together with the profile row that mounts it. Each ships
 * its own patch, so a profile installs each as its own tarball.
 *
 * `pnpm pack` honours the package's `files` allowlist and rewrites workspace
 * protocol ranges, so a tarball is exactly what `dsh plugin add` installs
 * (docs/user/develop/basic/publish.md).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runPnpm } from './lib/process.mjs'

/** Repository root; every path below is addressed from here. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Directory of the controller bundle package. */
const controllerDir = join(repoRoot, 'packages', 'controller')

/**
 * Directory of the UI bundle package.
 *
 * It is a bundle of its own (D18): its browser half is the board panel, and the
 * profile row carrying that half belongs to this package's own patch, so a
 * consumer installs it exactly like the controller — as a second tarball.
 * Packing it here is what makes that channel real: while only the controller
 * was packed, the controller's patch inserted a row for a package no consumer
 * could receive (review A, finding F-1).
 */
const uiDir = join(repoRoot, 'packages', 'web')

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
 * Pack one workspace package into a destination directory.
 *
 * Idempotency note: `pnpm pack` writes a *version-deterministic* file name and
 * silently overwrites an existing one. Comparing a "before" set of names with
 * the names found afterwards therefore cannot work on a second run — the
 * tarball is overwritten under the same name and the difference is empty. This
 * removes the same-named file up front and then asserts on that exact path.
 * @param {string} label - short package name used in the run logs.
 * @param {string} packageDir - absolute path of the package to pack.
 * @param {{ outDir?: string }} [options] - destination; defaults to `.tmp/pack`.
 * @returns {string} absolute path of the produced tarball.
 * @throws {Error} when the build output is missing, `pnpm` cannot be launched,
 *   `pnpm pack` fails, the expected tarball is absent, or it is empty.
 */
function packPackage(label, packageDir, options = {}) {
  const outDir = options.outDir ?? join(repoRoot, '.tmp', 'pack')
  const packagePath = relative(repoRoot, packageDir).replaceAll('\\', '/')
  if (!existsSync(join(packageDir, 'lib', 'index.js'))) {
    throw new Error(`pack: ${packagePath}/lib/index.js is missing — run "pnpm run build" first`)
  }
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const name = tarballName(manifest)
  mkdirSync(outDir, { recursive: true })
  rmSync(join(outDir, name), { force: true })
  rmSync(join(packageDir, name), { force: true })
  const logDir = join(repoRoot, '.tmp', 'pack-logs')
  const logName = `pnpm-pack-${label}`
  const result = runPnpm(['pack', '--pack-destination', outDir], {
    cwd: packageDir,
    env: process.env,
    logDir,
    logName,
  })
  // Record which launch branch ran, so diagnosing the runner never requires
  // reading the launcher's code.
  const launch = result.launch
  writeFileSync(
    join(logDir, `${logName}.launch.log`),
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

/**
 * Pack `@dsh-mywork/controller` into a destination directory.
 * @param {{ outDir?: string }} [options] - destination; defaults to `.tmp/pack`.
 * @returns {string} absolute path of the produced tarball.
 */
export function packController(options = {}) {
  return packPackage('controller', controllerDir, options)
}

/**
 * Pack `@dsh-mywork/web`, the package that owns the board panel's row (D18).
 * @param {{ outDir?: string }} [options] - destination; defaults to `.tmp/pack`.
 * @returns {string} absolute path of the produced tarball.
 */
export function packUi(options = {}) {
  return packPackage('web', uiDir, options)
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  // Both bundles: the controller owns the host half and the panel's row lives in
  // the web package's own patch, so a consumer receives two tarballs.
  for (const [directory, tarball] of [[controllerDir, packController()], [uiDir, packUi()]]) {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    console.log(`pack: ${manifest.name}@${manifest.version}`)
    console.log(tarball)
  }
}
