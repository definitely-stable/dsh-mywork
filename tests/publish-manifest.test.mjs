/**
 * Publication is impossible by construction, and the tarball channel says what
 * it ships.
 *
 * D04 keeps every package `private: true` and distributes the bundle as a
 * tarball (`pnpm run pack:local` → `scripts/pack.mjs`), so `pnpm pack`'s `files`
 * allowlist — not a registry — decides the artifact's content. D18 names the one
 * package allowed to leave that state: `@dsh-mywork/web`, and only when it goes
 * to the registry.
 *
 * These tests are the executable half of F-49: every manifest keeps the private
 * flag, every shipped manifest has a non-empty allowlist that cannot leak
 * sources, and the patch a bundle points at is inside the allowlist — a tarball
 * that omits `cordis.patch.yml` would install and then mount nothing.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/** Repository root, derived here so the suite does not need a built workspace. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The one package D18 allows to leave `private: true` behind. */
const PUBLISHABLE_EXCEPTION = '@dsh-mywork/web'

/** Every package manifest of the workspace, with its path for failure messages. */
function manifests() {
  const packagesDir = join(repoRoot, 'packages')
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ dir: join(packagesDir, entry.name), name: entry.name }))
    .map(({ dir, name }) => ({ dir, path: join(dir, 'package.json') }))
    .filter(candidate => existsSync(candidate.path))
    .map(candidate => ({ ...candidate, manifest: JSON.parse(readFileSync(candidate.path, 'utf8')) }))
}

test('every package manifest declares a non-empty files allowlist without sources', () => {
  const all = manifests()
  // Guard the discovery: an empty list would make every assertion below vacuous.
  assert.ok(all.length >= 12, `expected the workspace package manifests, found ${all.length}`)
  for (const { path, manifest } of all) {
    assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, `${path} must declare files`)
    assert.ok(manifest.files.includes('lib'), `${path} must ship the built bundle, got ${JSON.stringify(manifest.files)}`)
    for (const entry of manifest.files) {
      assert.equal(
        entry === '.' || entry.startsWith('src') || entry.startsWith('./src'),
        false,
        `${path}: files must not ship sources (${entry})`,
      )
    }
  }
})

test('every package stays private, except the single D18 web package', () => {
  const all = manifests()
  const notPrivate = all.filter(({ manifest }) => manifest.private !== true)
  for (const { path, manifest } of all) {
    if (manifest.name === PUBLISHABLE_EXCEPTION) continue
    assert.equal(manifest.private, true, `${path} must stay private (D04)`)
  }
  assert.ok(
    notPrivate.length <= 1,
    `at most one package may drop private (D18), found ${JSON.stringify(notPrivate.map(entry => entry.manifest.name))}`,
  )
  for (const { manifest } of notPrivate) {
    assert.equal(manifest.name, PUBLISHABLE_EXCEPTION, `${manifest.name} is not the package D18 allowed to publish`)
  }
  // Nothing may be pre-configured for a registry: publication today is a tarball,
  // and a publishConfig would be the first half of a registry release.
  for (const { path, manifest } of all) {
    assert.equal(manifest.publishConfig, undefined, `${path} must not configure a registry publication`)
  }
})

test('every shipped bundle patch is inside its own files allowlist and on disk', () => {
  const all = manifests()
  const withPatch = all.filter(({ manifest }) => manifest.dsh?.bundle?.patch !== undefined)
  // Guard the extraction: with no patch carriers this test would pass vacuously.
  assert.ok(withPatch.length >= 1, 'expected at least one package to declare dsh.bundle.patch')
  for (const { dir, path, manifest } of withPatch) {
    const patch = manifest.dsh.bundle.patch.replace(/^\.\//, '')
    assert.ok(
      manifest.files.includes(patch),
      `${path}: dsh.bundle.patch "./${patch}" is not in files ${JSON.stringify(manifest.files)}`,
    )
    assert.ok(existsSync(join(dir, patch)), `${path}: the patch it ships does not exist at ${join(dir, patch)}`)
  }
})

test('the controller keeps the private flag and the tarball allowlist it ships today', () => {
  const controller = JSON.parse(readFileSync(join(repoRoot, 'packages', 'controller', 'package.json'), 'utf8'))
  assert.equal(controller.private, true)
  assert.deepEqual(controller.files, ['lib', 'cordis.patch.yml'])
  assert.equal(controller.name, '@dsh-mywork/controller')
  assert.equal(controller.version, '0.1.0', 'the tarball name is version-derived (scripts/pack.mjs)')
})
