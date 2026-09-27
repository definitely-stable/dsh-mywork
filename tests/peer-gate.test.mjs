/**
 * The peer contract that turns the DSH compatibility gate ON for this plugin.
 *
 * The gate reads `peerDependencies` and nothing else, and it only looks at the
 * `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` namespace
 * (`packages/boot/app-boot/src/plugin-compatibility.ts:68` — no key, no verdict
 * at all; `:75` — every other name is skipped; `:76-77` — the range is compared
 * with the runtime version through `semver.satisfies(..., { includePrerelease:
 * true })`). Declaring the platform package is therefore the only way to stop
 * MyWork from being "compatible by blindness".
 *
 * The four semver verdicts that decide the range cannot be eyeballed, but the
 * platform's semver is not resolvable from this workspace — adding it would mean
 * a registry install, which F-48 explicitly avoids. So this suite pins what the
 * manifest must say and who the gate is looking at, and the arithmetic is proven
 * against the real gate and the platform's own semver in
 * `.work/plan-v0.3/evidence/foundation-48-peer-contract.md` (probe
 * `.tmp/f48-gate-probe.mjs`): `0.1.7-rc.2`, `0.1.7` and `0.1.8` are accepted,
 * `0.2.0` is refused, and `^0.1.7` / `>=0.1.7 <0.2.0` / `~0.1.7` would have
 * refused the running platform.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/** Repository root, derived here so the suite does not need a built workspace. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The range F-48 pins: the current prerelease through the last 0.1.x release. */
const PINNED_RANGE = '>=0.1.7-rc.2 <0.2.0'

/** The Node range the controller promises its consumers. */
const PINNED_NODE = '^22.19.0 || >=24.0.0'

/** Every package manifest of the workspace. */
function manifests() {
  const packagesDir = join(repoRoot, 'packages')
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(packagesDir, entry.name, 'package.json'))
    .filter(candidate => existsSync(candidate))
    .map(path => ({ path, manifest: JSON.parse(readFileSync(path, 'utf8')) }))
}

/** The controller manifest, read from disk rather than restated here. */
const controller = JSON.parse(readFileSync(join(repoRoot, 'packages', 'controller', 'package.json'), 'utf8'))

/**
 * Mirror of the gate's *subject*: which peers it would check, and whether it
 * looks at all. Deliberately not a re-implementation of the semver comparison
 * (`plugin-compatibility.ts:68` returns `undefined` when the key is absent,
 * `:75` skips every name outside the platform namespace, `:81` collapses an
 * empty mismatch set to `undefined`).
 * @param {object} manifest - a parsed package.json.
 * @returns {Record<string, string> | undefined} the checked peers, or undefined when the gate is blind.
 */
function gatePeers(manifest) {
  if (!Object.hasOwn(manifest, 'peerDependencies')) return undefined
  const peers = {}
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
    peers[name] = range
  }
  return peers
}

test('the controller declares the pinned platform peer that activates the gate', () => {
  assert.equal(
    controller.peerDependencies?.['@deepseek-ai/dsh'],
    PINNED_RANGE,
    'the controller must declare the platform peer, or the gate never runs (plugin-compatibility.ts:68)',
  )
  // The host runtime peer predates F-48 and must survive the edit: it is what the
  // bundle imports at runtime, and the gate itself never looks at it.
  assert.equal(controller.peerDependencies?.['@deepseek-ai/cordis'], '^4.0.2')
})

test('the controller pins the Node range the platform promises, not the root default', () => {
  assert.equal(controller.engines?.node, PINNED_NODE)
  const root = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  // DSH declares `^22.19.0 || >=24.0.0`; the older root default also admits 22.18
  // and every 23.x, which the platform does not promise. `engines` is read by
  // neither the gate nor the platform (0 matches for `.engines` across the DSH
  // sources), so this is a contract for consumers, and it is pinned here so it
  // cannot silently drift back to the wider range.
  assert.notEqual(controller.engines?.node, root.engines?.node)
})

test('the pinned range cannot be neutralized by a workspace or wildcard range', () => {
  const range = controller.peerDependencies['@deepseek-ai/dsh']
  // `workspace:^|~|*` is substituted with the runtime version before the check
  // (plugin-compatibility.ts:76) and `*` matches anything, so either form would
  // turn the gate into a check that cannot fail.
  assert.equal(range.trim() === '', false, 'an empty range is incompatible by definition')
  assert.equal(range.startsWith('workspace:'), false, `"${range}" would be substituted with the runtime version`)
  assert.notEqual(range, '*', `"${range}" would accept any runtime`)
  assert.equal(range.includes('-rc.2'), true, `"${range}" must admit the running prerelease, not only releases`)
})

test('no manifest pulls the platform in as a dependency, only the controller peers on it', () => {
  const all = manifests()
  // Guard the discovery: an empty or one-entry list would make the loop vacuous.
  assert.ok(all.length >= 12, `expected the workspace package manifests, found ${all.length}`)

  const carriers = []
  for (const { path, manifest } of all) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      assert.equal(
        manifest[field]?.['@deepseek-ai/dsh'],
        undefined,
        `${path}: ${field} must not pull the whole CLI in — auto-install-peers would resolve it at install time`,
      )
    }
    const peers = gatePeers(manifest)
    if (peers !== undefined && Object.keys(peers).length > 0) carriers.push({ name: manifest.name, peers })
  }
  assert.ok(carriers.length >= 1, 'expected at least one manifest the gate can actually check')
  const controllerCarrier = carriers.find(carrier => carrier.name === '@dsh-mywork/controller')
  assert.deepEqual(
    controllerCarrier?.peers,
    { '@deepseek-ai/dsh': PINNED_RANGE },
    `the controller must be the carrier of the gate contract, found ${JSON.stringify(carriers)}`,
  )
})

test('a manifest without peerDependencies stays invisible to the gate', () => {
  // The blindness F-48 removes, stated as a check on the mirror: if this ever
  // returns peers, the platform gate changed and the contract needs a re-read.
  assert.equal(gatePeers({ name: '@dsh-mywork/example', version: '0.1.0' }), undefined)
  assert.deepEqual(gatePeers({ peerDependencies: { react: '^18.2.0' } }), {})
  assert.deepEqual(gatePeers({ peerDependencies: { '@deepseek-ai/dsh-react': '^0.1.0' } }), {
    '@deepseek-ai/dsh-react': '^0.1.0',
  })
})
