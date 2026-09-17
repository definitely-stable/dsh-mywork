#!/usr/bin/env node
/**
 * Pack the controller bundle the way an installed consumer receives it.
 *
 * `pnpm pack` honours the package's `files` allowlist and rewrites workspace
 * protocol ranges, so the tarball is exactly what `dsh plugin add` installs
 * (docs/user/develop/basic/publish.md).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runPnpm } from './lib/process.mjs'

/** Repository root; every path below is addressed from here. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Directory of the controller bundle package. */
const controllerDir = join(repoRoot, 'packages', 'controller')

/**
 * Pack `@dsh-mywork/controller` into a destination directory.
 * @param {{ outDir?: string }} [options] - destination; defaults to `.tmp/pack`.
 * @returns {string} absolute path of the produced tarball.
 * @throws {Error} when the build output is missing or `pnpm pack` fails.
 */
export function packController(options = {}) {
  const outDir = options.outDir ?? join(repoRoot, '.tmp', 'pack')
  if (!existsSync(join(controllerDir, 'lib', 'index.js'))) {
    throw new Error('pack: packages/controller/lib/index.js is missing — run "pnpm run build" first')
  }
  const before = new Set(readdirSync(controllerDir).filter(name => name.endsWith('.tgz')))
  const result = runPnpm(['pack'], {
    cwd: controllerDir,
    env: process.env,
    logDir: join(repoRoot, '.tmp', 'pack-logs'),
    logName: 'pnpm-pack',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`pack: pnpm pack exited with code ${String(result.status)}\n${result.stderr}`)
  }
  const produced = readdirSync(controllerDir).filter(name => name.endsWith('.tgz') && !before.has(name))
  if (produced.length !== 1) {
    throw new Error(`pack: expected exactly one new tarball in ${controllerDir}, found ${JSON.stringify(produced)}`)
  }
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const tarball = join(outDir, produced[0])
  renameSync(join(controllerDir, produced[0]), tarball)
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
