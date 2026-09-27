/**
 * F-58 acceptance: `@dsh-mywork/web` is the one publishable workspace package,
 * its manifest carries the client declaration the platform scanner reads, and
 * its browser half is a classic-script bundle the page module system registers.
 *
 * The gate is LOCAL by construction (defect R-08): the manifest is read the way
 * `packages/client/modules/src/index.ts` reads it, the bundle is evaluated the
 * way the page evaluates it, and nothing here needs a live profile or a manual
 * GUI reload. The one thing this suite does need is a build, exactly like every
 * other suite in this workspace (`tests/lib/fixtures.mjs` refuses to run without
 * one) — the bundle is a build artifact, so the R-08 hazard is asserted where it
 * can actually happen.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/** Repository root; derived here so this suite needs no built workspace. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The package F-58 creates (D18). */
const PACKAGE_NAME = '@dsh-mywork/web'

/** Package directory. */
const packageDir = join(repoRoot, 'packages', 'web')

/** The built browser half, as the platform serves it. */
const clientBundlePath = join(packageDir, 'lib', 'client.js')

/**
 * Read one package manifest, refusing to test a package that is not there.
 * @param dir - directory name under `packages/`.
 * @returns the parsed manifest.
 */
function manifestOf(dir) {
  const path = join(repoRoot, 'packages', dir, 'package.json')
  assert.ok(existsSync(path), `F-58: ${path} is missing — the package does not exist`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Every workspace package manifest except the UI package's.
 * @returns `{ dir, manifest }` pairs.
 */
function siblingManifests() {
  return readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'web')
    .map(entry => ({ dir: entry.name, manifest: manifestOf(entry.name) }))
}

/**
 * Load the built bundle the way the page module system does: as a classic
 * script that pushes one registration onto `window.__ModuleLoader__`.
 * @returns the single captured registration.
 */
function loadClientBundle() {
  assert.ok(
    existsSync(clientBundlePath),
    `the built browser half is missing: ${clientBundlePath} — run "corepack pnpm -r run build"`,
  )
  const registrations = []
  const pageWindow = { __ModuleLoader__: { load: registration => registrations.push(registration) } }
  new Function('window', readFileSync(clientBundlePath, 'utf8'))(pageWindow)
  assert.equal(registrations.length, 1, 'the bundle must register exactly one factory')
  return registrations[0]
}

/**
 * The baseline module table words the browser half may request. React is a
 * `PLATFORM_MODULES` seed (`packages/client/web/src/platform.ts`), so the
 * stand-in here is only the shape a component needs to render a tree.
 * @returns a `require` for the bundle factory.
 */
function baselineRequire() {
  const createElement = (type, props, ...children) => ({ type, props: { ...props, children } })
  const react = { createElement }
  // The browser half declares its view state through the platform store engine
  // (`defineStore`), which this workspace does not install. The stand-in only
  // has to answer the call: the store's behaviour is asserted against the real
  // registration in `tests/ui-attributes.test.mjs`.
  const store = {
    defineStore: spec => ({
      spec,
      create: () => ({ actions: {}, getSnapshot: () => spec.init(), subscribe: () => () => {} }),
    }),
  }
  const table = new Map([
    ['react', react],
    ['react/jsx-runtime', { jsx: createElement, jsxs: createElement }],
    ['@deepseek-ai/dsh-client-store', store],
  ])
  return specifier => {
    assert.ok(table.has(specifier), `the bundle requested "${specifier}", which is not a baseline module`)
    return table.get(specifier)
  }
}

test('the twelve existing packages stay private, and the UI package alone is publishable', () => {
  // D04 keeps `private` on the twelve; D18 lifts it for `@dsh-mywork/web` only.
  // The check is written as an exact list, so a second publishable package — or
  // a manifest that lost `files` — is a deliberate edit here, not a silent pass.
  const siblings = siblingManifests()
  assert.ok(siblings.length >= 12, `expected the twelve existing packages, found ${siblings.length}`)
  for (const { dir, manifest } of siblings) {
    assert.equal(manifest.private, true, `D04: packages/${dir} must stay private`)
    assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, `packages/${dir} must declare "files"`)
  }
  const publishable = [manifestOf('web'), ...siblings.map(entry => entry.manifest)]
    .filter(manifest => manifest.private !== true)
    .map(manifest => manifest.name)
  assert.deepEqual(publishable, [PACKAGE_NAME], 'D18 lifts "private" for the UI package alone')
})

test('the UI manifest declares the client half the platform scanner requires', () => {
  const manifest = manifestOf('web')
  assert.equal(manifest.name, PACKAGE_NAME)
  // `parseDshClient` accepts platform/inject/external/immediately and requires
  // `platform`; `platform: 'web'` is what makes the row a client row.
  assert.equal(manifest.dsh.client.platform, 'web', 'dsh.client.platform must be "web"')
  // `clientExportOf` accepts a string or an object with a string `default`.
  const client = manifest.exports['./client']
  assert.equal(typeof client, 'object', 'exports["./client"] must be declared')
  assert.equal(client.default, './lib/client.js', 'the client bundle must be the platform convention path')
  assert.equal(typeof client.types, 'string', 'the client face must carry a types path')
  // `icon` is a TOP-LEVEL manifest field, not a member of `dsh.client`
  // (packages/util/package-manifest/src/types.ts).
  assert.equal(typeof manifest.icon, 'string', 'icon is a top-level manifest field')
  assert.ok(existsSync(join(packageDir, manifest.icon)), `the icon file ${manifest.icon} must exist`)
  assert.ok(
    manifest.files.some(entry => entry === 'lib' || entry.startsWith('lib/')),
    'files must cover the built lib/',
  )
  assert.ok(
    manifest.files.some(entry => entry.replace(/^\.\//, '') === manifest.icon.replace(/^\.\//, '')),
    `files must cover the icon (${manifest.icon})`,
  )
  // D04: the publishable package names the platform by package name and states
  // the DSH range it was built against.
  assert.equal(typeof manifest.peerDependencies['@deepseek-ai/dsh'], 'string')
  assert.equal(typeof manifest.dsh.engines.dsh, 'string')
})

test('the browser half survives the full build as a classic script', () => {
  assert.ok(
    existsSync(clientBundlePath),
    `Test-Path packages/web/lib/client.js must be True after "corepack pnpm -r run build" — the `
    + 'hand-written bundle did not survive the clean (defect R-08)',
  )
  const source = readFileSync(clientBundlePath, 'utf8')
  // The registration is the first line: the envelope must not hide under a
  // header, and a scanner that reads the top of the file must see it.
  assert.equal(source.split('\n')[0].trim(), 'window.__ModuleLoader__.load({', 'the first line is the registration')
  // The page module system evaluates `lib/client.js` as a CLASSIC script
  // (scripts/publint-all.ts), so ESM syntax anywhere in it is a boot failure.
  assert.equal(/^\s*export\s/m.test(source), false, 'the bundle must not use ESM export syntax')
  assert.equal(/^\s*import\s/m.test(source), false, 'the bundle must not use ESM import syntax')
  assert.equal(/\bexport\s+default\b/.test(source), false, 'the bundle must not default-export')
  // The hand-written source is the single owner of the shipped artifact: the
  // build copies it, so the copy and its source must not drift.
  const authored = readFileSync(join(packageDir, 'src', 'client', 'index.js'), 'utf8')
  assert.equal(source, authored, 'lib/client.js must be the authored src/client/index.js, not a rewrite')
})

test('the bundle registers one factory on the page module system', () => {
  const registration = loadClientBundle()
  assert.equal(registration.id, PACKAGE_NAME, 'the factory id must be the bare package name')
  assert.equal(typeof registration.factory, 'function', 'the registration must carry a factory')
  const exports = registration.factory(baselineRequire())
  assert.equal(typeof exports.apply, 'function', 'the bundle must export the cordis plugin face')
  assert.ok(Array.isArray(exports.inject), 'the bundle must declare the services it waits for')
  assert.equal(exports.name, undefined, 'the plugin name belongs to the Loader row, not the bundle')
})

test('the controller patch mounts the client row by bare package name', () => {
  const patch = readFileSync(join(repoRoot, 'packages', 'controller', 'cordis.patch.yml'), 'utf8')
  const names = [...patch.matchAll(/^\s*name:\s*'([^']+)'\s*$/gm)].map(match => match[1])
  // A row mounted from a subpath export never carries a half
  // (docs/cookbook/adding-a-settings-card.md:58), so the row names the package.
  assert.deepEqual(names, ['@dsh-mywork/controller', PACKAGE_NAME], 'the patch rows, in order')
  assert.equal(patch.includes(`${PACKAGE_NAME}/`), false, 'a subpath specifier never carries a client half')
})
