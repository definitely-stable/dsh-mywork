/**
 * `packController` has to survive being run twice in a row.
 *
 * `pnpm pack` writes a version-deterministic file name and silently overwrites
 * an existing tarball, so the original "diff the set of names before and after"
 * check saw zero new files on a re-run and threw
 * `pack: expected exactly one new tarball … found []`. These tests exercise the
 * real packer, because the defect lived in the interaction with `pnpm pack`
 * rather than in a pure function.
 */

import assert from 'node:assert/strict'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { packController, tarballName } from '../scripts/pack.mjs'

/** Repository root, derived here so the suite does not need a built workspace. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Directory of the controller bundle package. */
const controllerDir = join(repoRoot, 'packages', 'controller')

test('packController returns an existing non-empty tarball on two consecutive runs', () => {
  const first = packController()
  assert.ok(existsSync(first), `first run must produce a tarball, got ${first}`)
  assert.ok(statSync(first).size > 0, 'first run must not produce an empty tarball')

  const second = packController()
  assert.ok(existsSync(second), `second run must produce a tarball, got ${second}`)
  assert.ok(statSync(second).size > 0, 'second run must not produce an empty tarball')
  assert.equal(second, first, 'both runs pack the same deterministic path')
})

test('a leftover same-named tarball in the package directory does not break a run', () => {
  // This is exactly the state a crashed or manual `pnpm pack` leaves behind.
  const leftover = join(controllerDir, tarballName({ name: '@dsh-mywork/controller', version: '0.1.0' }))
  writeFileSync(leftover, '', 'utf8')
  assert.ok(existsSync(leftover), 'precondition: the same-named tarball exists')

  const produced = packController()
  assert.ok(existsSync(produced), 'the run must still produce its tarball')
  assert.ok(statSync(produced).size > 0, 'the produced tarball must not be empty')
})
