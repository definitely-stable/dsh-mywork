/**
 * The peer contract that turns the DSH compatibility gate ON for this plugin —
 * and the carrier set that is allowed to declare it.
 *
 * The gate reads `peerDependencies` and nothing else, and it only looks at the
 * `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` namespace
 * (`packages/boot/app-boot/src/plugin-compatibility.ts:68` — no key, no verdict
 * at all; `:75` — every other name is skipped; `:76-77` — the range is compared
 * with the runtime version through `semver.satisfies(..., { includePrerelease:
 * true })`). Declaring the platform package is therefore the only way to stop
 * MyWork from being "compatible by blindness", and *which* manifests declare it
 * is part of the contract too: review A's F-2 found that a third package could
 * declare it decoratively, or one of the two carriers could drop it, while this
 * suite stayed green.
 *
 * What this file computes and what it does not. `semver` is not resolvable from
 * this workspace (`await import('semver')` → `ERR_MODULE_NOT_FOUND`), so the
 * range algebra is not re-implemented here. The comparison below implements
 * exactly the two-bound form the pinned range uses (`>=X <Y`) plus semver's
 * prerelease precedence, and reproduces the verdict table the probe measured
 * against the platform's own semver and its real gate
 * (`.tmp/f48-gate-probe.mjs`, evidence
 * `.work/plan-v0.3/evidence/foundation-48-peer-contract.md` §3–§4). Anything
 * else — caret/tilde desugaring, `workspace:` substitution, arbitrary ranges —
 * returns `undefined` instead of a guess and stays probe-only: `^0.1.7`,
 * `~0.1.7` and `>=0.1.7 <0.2.0` all refuse the running prerelease, and only the
 * probe against the platform's semver can state that.
 *
 * Known, deliberate gap (owner decision D04, review A's F-3): the pinned range
 * admits `0.2.0-rc.1`, because a prerelease sorts below its release. Tightening
 * to `<0.2.0-0` is the owner's call; the alternative is exercised below rather
 * than applied.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/** Repository root, derived here so the suite does not need a built workspace. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The range F-48 pins: the running prerelease through the last 0.1.x release. */
const PINNED_RANGE = '>=0.1.7-rc.2 <0.2.0'

/** The packages whose peer is supposed to turn the gate on, by name. */
const CARRIERS = ['@dsh-mywork/controller', '@dsh-mywork/web']

/** The Node range the controller promises its consumers. */
const PINNED_NODE = '^22.19.0 || >=24.0.0'

/**
 * Verdicts for the pinned range, measured by the probe against the platform's
 * own semver and its real gate (`foundation-48-peer-contract.md` §3–§4). The
 * comparison in this file must reproduce them; `0.2.0-rc.1` is the gap the
 * header records.
 */
const MEASURED_BY_PROBE = [
  ['0.1.7-rc.2', true],
  ['0.1.7', true],
  ['0.1.8', true],
  ['0.1.8-rc.1', true],
  ['0.2.0-rc.1', true],
  ['0.2.0', false],
]

/** Every package manifest of the workspace, with its path for failure messages. */
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

/** The declared platform range under test: the value, never a copy of it. */
const declaredRange = controller.peerDependencies['@deepseek-ai/dsh']

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

/**
 * Parse `major.minor.patch[-prerelease]`.
 * @param {string} text - the version.
 * @returns {{ numbers: number[], prerelease: string[] } | undefined} the parts, or undefined when not a plain version.
 */
function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text.trim())
  if (match === null) return undefined
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/**
 * Semver precedence, prerelease included: a prerelease sorts below its release,
 * and a numeric identifier below an alphanumeric one (semver §11). Only what
 * this contract needs — it is not a general semver implementation.
 * @param {string} left - the first version.
 * @param {string} right - the second version.
 * @returns {-1 | 0 | 1 | undefined} the comparison, or undefined when a side is unparsable.
 */
function compareVersions(left, right) {
  const first = parseVersion(left)
  const second = parseVersion(right)
  if (first === undefined || second === undefined) return undefined
  for (let index = 0; index < 3; index += 1) {
    if (first.numbers[index] !== second.numbers[index]) return first.numbers[index] < second.numbers[index] ? -1 : 1
  }
  if (first.prerelease.length === 0 && second.prerelease.length === 0) return 0
  if (first.prerelease.length === 0) return 1
  if (second.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(first.prerelease.length, second.prerelease.length); index += 1) {
    const leftId = first.prerelease[index]
    const rightId = second.prerelease[index]
    if (leftId === undefined) return -1
    if (rightId === undefined) return 1
    if (leftId === rightId) continue
    const leftNumeric = /^\d+$/.test(leftId)
    const rightNumeric = /^\d+$/.test(rightId)
    if (leftNumeric && rightNumeric) return Number(leftId) < Number(rightId) ? -1 : 1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftId < rightId ? -1 : 1
  }
  return 0
}

/**
 * Evaluate the one range form this contract uses: `>=lower <upper`.
 * @param {string} range - the declared requirement.
 * @param {string} version - the runtime version to place in it.
 * @returns {boolean | undefined} the verdict, or undefined for a form this comparison does not implement.
 */
function satisfiesRange(range, version) {
  const match = /^>=(\S+)\s+<(\S+)$/.exec(range.trim())
  if (match === null) return undefined
  const lower = compareVersions(version, match[1])
  const upper = compareVersions(version, match[2])
  if (lower === undefined || upper === undefined) return undefined
  return lower >= 0 && upper < 0
}

test('the controller declares the pinned platform peer that activates the gate', () => {
  assert.equal(
    declaredRange,
    PINNED_RANGE,
    'the controller must declare the platform peer, or the gate never runs (plugin-compatibility.ts:68)',
  )
  // The host runtime peer predates F-48 and must survive the edit: it is what the
  // bundle imports at runtime, and the gate itself never looks at it.
  assert.equal(controller.peerDependencies?.['@deepseek-ai/cordis'], '^4.0.2')
})

test('exactly the two intended packages carry the platform peer, by name', () => {
  const all = manifests()
  // Guard the discovery: an empty or truncated list would make the comparison vacuous.
  assert.ok(all.length >= 12, `expected the workspace package manifests, found ${all.length}`)

  const carriers = all
    .filter(({ manifest }) => manifest.peerDependencies?.['@deepseek-ai/dsh'] !== undefined)
    .map(({ manifest }) => manifest.name)
    .sort()
  // A lower bound is not enough: a third, decorative carrier must fail here, and
  // so must a carrier that silently drops the peer (review A, F-2).
  assert.deepEqual(carriers, CARRIERS, `platform peer carriers: ${JSON.stringify(carriers)}`)

  // The same question asked the way the F-60 gate asks it (grep for the exact
  // JSON key): the two notions must not drift apart (review A, F-6).
  const mentions = all
    .filter(({ path }) => readFileSync(path, 'utf8').includes('"@deepseek-ai/dsh"'))
    .map(({ manifest }) => manifest.name)
    .sort()
  assert.deepEqual(mentions, CARRIERS, `manifests mentioning the platform: ${JSON.stringify(mentions)}`)
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
  // `workspace:^|~|*` is substituted with the runtime version before the check
  // (plugin-compatibility.ts:76) and `*` matches anything, so either form would
  // turn the gate into a check that cannot fail.
  assert.equal(declaredRange.trim() === '', false, 'an empty range is incompatible by definition')
  assert.equal(declaredRange.startsWith('workspace:'), false,
    `"${declaredRange}" would be substituted with the runtime version`)
  assert.notEqual(declaredRange, '*', `"${declaredRange}" would accept any runtime`)
  assert.equal(declaredRange.includes('-rc.2'), true,
    `"${declaredRange}" must admit the running prerelease, not only releases`)
})

test('the declared range accepts the built-against version and refuses the next major', () => {
  // The lower bound is the point of the pinned range: `0.1.7-rc.2` is the version
  // this repository is built against, and a range that drops the prerelease tag
  // (`>=0.1.7`, `~0.1.7`, `^0.1.7`) refuses it.
  assert.ok(MEASURED_BY_PROBE.length >= 4, 'expected the measured verdict table, not a single row')
  for (const [version, expected] of MEASURED_BY_PROBE) {
    assert.equal(
      satisfiesRange(declaredRange, version),
      expected,
      `"${declaredRange}" vs ${version}: the probe measured ${String(expected)} against the platform's own semver`,
    )
  }
  // Self-checks of the comparison itself, so a wrong precedence rule cannot hide
  // behind a correct verdict table.
  assert.equal(compareVersions('0.1.7-rc.2', '0.1.7'), -1, 'a prerelease sorts below its release')
  assert.equal(compareVersions('0.2.0-rc.1', '0.2.0'), -1)
  assert.equal(compareVersions('0.1.8', '0.1.8-rc.1'), 1)
  assert.equal(compareVersions('0.2.0-0', '0.2.0-rc.1'), -1, 'a numeric identifier sorts below an alphanumeric one')
  assert.equal(compareVersions('0.1.7', 'nonsense'), undefined, 'an unparsable version is not a verdict')
  // The traps the plan names: both refuse the running prerelease, and both stay
  // outside what this comparison implements — the probe is what states them.
  assert.equal(satisfiesRange('>=0.1.7 <0.2.0', '0.1.7-rc.2'), false)
  assert.equal(satisfiesRange('~0.1.7', '0.1.7-rc.2'), undefined, 'tilde/caret forms stay probe-only')
  assert.equal(satisfiesRange('^0.1.7', '0.1.7-rc.2'), undefined, 'caret forms stay probe-only')
  // The open D04 decision, exercised but NOT applied: the alternative upper bound
  // review A's F-3 proposes would refuse `0.2.0-rc.1`, where today's range does not.
  assert.equal(satisfiesRange('>=0.1.7-rc.2 <0.2.0-0', '0.2.0-rc.1'), false)
})

test('no manifest pulls the platform in as a dependency, only the carriers peer on it', () => {
  const all = manifests()
  for (const { path, manifest } of all) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      assert.equal(
        manifest[field]?.['@deepseek-ai/dsh'],
        undefined,
        `${path}: ${field} must not pull the whole CLI in — auto-install-peers would resolve it at install time`,
      )
    }
    const peers = gatePeers(manifest)
    if (peers === undefined || Object.keys(peers).length === 0) continue
    // The gate's subject and the declared platform peer are the same thing: a
    // second `@deepseek-ai/dsh-*` name in a carrier would be checked too, and
    // nothing in the workspace declares one today.
    assert.deepEqual(
      peers,
      { '@deepseek-ai/dsh': manifest.peerDependencies['@deepseek-ai/dsh'] },
      `${path}: the gate checks exactly the platform peer and nothing else`,
    )
  }
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
