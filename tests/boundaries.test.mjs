/**
 * Boundary acceptance: the domain modules must stay free of DSH, Beads, and any
 * concrete memory backend, and the built packages must be self-contained.
 *
 * The check reads the sources and the manifests, so a new import cannot slip in
 * without failing the suite.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { repoRoot } from './lib/fixtures.mjs'

/** Third-party or product names the domain must never depend on. */
const FORBIDDEN = [
  '@deepseek-ai/cordis',
  'beads',
  'hindsight',
  'openviking',
  'sqlite',
  'better-sqlite3',
  'node:sqlite',
]

/** Collect every file with one of the given extensions, recursively. */
function collect(dir, extensions, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      collect(path, extensions, found)
    } else if (extensions.some(extension => entry.name.endsWith(extension))) {
      found.push(path)
    }
  }
  return found
}

/**
 * Drop comments and template literals, keeping ordinary strings, so keyword
 * matching cannot hit prose inside a diagnostic while a real import is still
 * visible.
 *
 * The scan is a single left-to-right pass on purpose: handling each construct in
 * its own regular expression lets one construct hide another (a `/*` inside a
 * template would otherwise swallow the code that follows).
 */
function scrub(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1]
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (char === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (char === '`') {
      i += 1
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\') i += 1
        i += 1
      }
      i += 1
      out += '``'
      continue
    }
    if (char === '"' || char === "'") {
      out += char
      i += 1
      while (i < source.length && source[i] !== char) {
        if (source[i] === '\\') {
          out += source[i]
          i += 1
        }
        out += source[i]
        i += 1
      }
      out += char
      i += 1
      continue
    }
    out += char
    i += 1
  }
  return out
}

/** Every module specifier a file imports or re-exports. */
function specifiersOf(source) {
  const scrubbed = scrub(source)
  return [
    ...[...scrubbed.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map(match => match[1]),
    ...[...scrubbed.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)].map(match => match[1]),
    ...[...scrubbed.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]),
  ]
}

/** Read a package manifest. */
function manifestOf(pkg) {
  return JSON.parse(readFileSync(join(repoRoot, 'packages', pkg, 'package.json'), 'utf8'))
}

const sources = {
  contracts: collect(join(repoRoot, 'packages', 'contracts', 'src'), ['.ts']),
  core: collect(join(repoRoot, 'packages', 'core', 'src'), ['.ts']),
}

/** The infrastructure layer: a separate boundary with its own allowed imports. */
const storageSources = collect(join(repoRoot, 'packages', 'storage', 'src'), ['.ts'])

/**
 * The evidence layer: it sits above the kernel, so it may NAME the kernel's
 * types but must not import it at runtime — the composition happens at the
 * caller, which keeps this layer buildable and testable on its own.
 */
const evidenceSources = collect(join(repoRoot, 'packages', 'evidence', 'src'), ['.ts'])

/** Product names the infrastructure layer must not depend on either. */
const FORBIDDEN_FOR_STORAGE = [
  '@deepseek-ai/cordis',
  'beads',
  'hindsight',
  'openviking',
  'better-sqlite3',
]

test('the domain packages have sources to check', () => {
  assert.ok(sources.contracts.length >= 8, `contracts sources: ${sources.contracts.length}`)
  assert.ok(sources.core.length >= 7, `core sources: ${sources.core.length}`)
  // Guard the extraction itself: a regex that silently matches nothing would
  // make every assertion below vacuous.
  const discovered = [...sources.contracts, ...sources.core].flatMap(file =>
    specifiersOf(readFileSync(file, 'utf8')),
  )
  assert.ok(discovered.length >= 25, `expected to discover the domain imports, found ${discovered.length}`)
})

test('contracts imports nothing outside its own modules', () => {
  for (const file of sources.contracts) {
    const source = readFileSync(file, 'utf8')
    for (const specifier of specifiersOf(source)) {
      assert.match(specifier, /^\.\//, `${file} must only import its own modules, found "${specifier}"`)
    }
  }
})

test('core imports only its own modules and the contracts package', () => {
  for (const file of sources.core) {
    const source = readFileSync(file, 'utf8')
    for (const specifier of specifiersOf(source)) {
      const allowed = specifier.startsWith('./') || specifier === '@dsh-mywork/contracts'
      assert.ok(allowed, `${file} must not import "${specifier}"`)
    }
  }
})

test('no domain source imports DSH, Beads, or a concrete memory backend', () => {
  for (const [pkg, files] of Object.entries(sources)) {
    for (const file of files) {
      for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
        const lowered = specifier.toLowerCase()
        const hit = FORBIDDEN.find(forbidden => lowered.includes(forbidden))
        assert.equal(hit, undefined, `${pkg}: ${file} must not import "${hit}" through "${specifier}"`)
      }
    }
  }
})

test('the domain packages declare no runtime dependencies', () => {
  const contracts = manifestOf('contracts')
  const core = manifestOf('core')
  assert.equal(contracts.dependencies, undefined, 'contracts must have no runtime dependency')
  assert.equal(contracts.devDependencies, undefined, 'contracts must have no development dependency')
  assert.equal(core.dependencies, undefined, 'core must have no runtime dependency')
  assert.deepEqual(Object.keys(core.devDependencies), ['@dsh-mywork/contracts'])
})

test('the built packages carry exactly the imports they are allowed to', () => {
  const built = {
    'packages/contracts/lib/index.js': [],
    'packages/core/lib/index.js': [],
    // The controller is the published bundle: workspace packages are inlined and
    // only the host's single Cordis instance stays external.
    'packages/controller/lib/index.js': ['@deepseek-ai/cordis'],
  }
  for (const [relative, expected] of Object.entries(built)) {
    const file = join(repoRoot, relative)
    const found = specifiersOf(readFileSync(file, 'utf8'))
    assert.deepEqual(found, expected, `${relative} imports`)
  }
})

test('the storage layer builds on Node builtins and the contracts package only', () => {
  assert.ok(storageSources.length >= 7, `storage sources: ${storageSources.length}`)
  const seen = new Set()
  for (const file of storageSources) {
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      seen.add(specifier)
      const allowed = specifier.startsWith('./')
        || specifier.startsWith('node:')
        || specifier === '@dsh-mywork/contracts'
      assert.ok(allowed, `${file} must not import "${specifier}"`)
    }
  }
  // Guard the extraction: a scan that matched nothing would pass vacuously.
  assert.ok(seen.has('node:sqlite'), `expected the SQLite driver import, found ${[...seen].join(', ')}`)
})

test('the storage layer depends on no product, no DSH package, and no domain module', () => {
  for (const file of storageSources) {
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      const lowered = specifier.toLowerCase()
      const hit = FORBIDDEN_FOR_STORAGE.find(forbidden => lowered.includes(forbidden))
      assert.equal(hit, undefined, `storage: ${file} must not import "${hit}" through "${specifier}"`)
      assert.equal(specifier.startsWith('@dsh-mywork/') && specifier !== '@dsh-mywork/contracts', false,
        `storage: ${file} must not depend on the domain layer through "${specifier}"`)
    }
  }
  const storage = manifestOf('storage')
  assert.equal(storage.dependencies, undefined, 'storage must have no runtime dependency')
  assert.deepEqual(Object.keys(storage.devDependencies), ['@dsh-mywork/contracts'])
})

test('the domain packages do not import the storage layer', () => {
  for (const [pkg, files] of Object.entries(sources)) {
    for (const file of files) {
      for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
        assert.equal(specifier.includes('storage'), false, `${pkg}: ${file} must not import "${specifier}"`)
      }
    }
  }
})

test('the built storage package carries only Node builtin imports', () => {
  const found = specifiersOf(readFileSync(join(repoRoot, 'packages/storage/lib/index.js'), 'utf8'))
  assert.ok(found.length > 0, 'expected the built storage bundle to import its Node builtins')
  for (const specifier of found) {
    assert.match(specifier, /^node:/, `packages/storage/lib/index.js must stay self-contained, found "${specifier}"`)
  }
})

/**
 * Import statements of one source file, as `{ typeOnly, specifier }`.
 *
 * A statement-splitting regex has to tolerate the multi-line brace lists this
 * codebase writes AND the absence of semicolons: `[^;]*` would run straight
 * through one import into the next and report a type-only import as a value
 * import.
 * @param source - file contents.
 */
function importsOf(source) {
  const found = []
  const pattern = /import\s+(type\s+)?([\s\S]*?)from\s*'([^']+)'/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    found.push({ typeOnly: match[1] !== undefined, specifier: match[3] })
  }
  return found
}

test('the evidence layer builds on Node builtins, the contracts package, and the kernel types', () => {
  assert.ok(evidenceSources.length >= 5, `evidence sources: ${evidenceSources.length}`)
  const seen = new Set()
  let kernelImports = 0
  for (const file of evidenceSources) {
    const source = readFileSync(file, 'utf8')
    for (const specifier of specifiersOf(source)) {
      seen.add(specifier)
      const allowed = specifier.startsWith('./')
        || specifier.startsWith('node:')
        || specifier === '@dsh-mywork/contracts'
        || specifier === '@dsh-mywork/storage'
      assert.ok(allowed, `${file} must not import "${specifier}"`)
    }
    // The kernel is a TYPE-ONLY dependency here: a value import would couple the
    // evidence layer to the storage implementation and drag it into the bundle.
    for (const { typeOnly, specifier } of importsOf(source)) {
      if (specifier === '@dsh-mywork/storage') {
        kernelImports += 1
        assert.ok(typeOnly, `${file} must import "@dsh-mywork/storage" as types only`)
      }
    }
  }
  // Guard the extraction: a scan that matched nothing would pass vacuously.
  assert.ok(seen.has('node:crypto'), `expected the hash import, found ${[...seen].join(', ')}`)
  assert.ok(seen.has('@dsh-mywork/storage'), `expected the kernel type import, found ${[...seen].join(', ')}`)
  assert.ok(kernelImports >= 1, 'expected the import extraction to find the kernel type import')
})

test('the evidence layer depends on no product, no DSH package, and no domain module', () => {
  for (const file of evidenceSources) {
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      const lowered = specifier.toLowerCase()
      const hit = FORBIDDEN_FOR_STORAGE.find(forbidden => lowered.includes(forbidden))
      assert.equal(hit, undefined, `evidence: ${file} must not import "${hit}" through "${specifier}"`)
      assert.equal(
        specifier.startsWith('@dsh-mywork/') && !['@dsh-mywork/contracts', '@dsh-mywork/storage'].includes(specifier),
        false,
        `evidence: ${file} must not depend on the domain layer through "${specifier}"`,
      )
    }
  }
  const evidenceManifest = manifestOf('evidence')
  assert.equal(evidenceManifest.dependencies, undefined, 'evidence must have no runtime dependency')
  assert.deepEqual(Object.keys(evidenceManifest.devDependencies), ['@dsh-mywork/contracts', '@dsh-mywork/storage'])
})

test('the domain packages do not import the evidence layer', () => {
  for (const [pkg, files] of Object.entries(sources)) {
    for (const file of files) {
      for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
        assert.equal(specifier.includes('evidence'), false, `${pkg}: ${file} must not import "${specifier}"`)
      }
    }
  }
})

test('the built evidence package carries only Node builtin imports', () => {
  const found = specifiersOf(readFileSync(join(repoRoot, 'packages/evidence/lib/index.js'), 'utf8'))
  assert.ok(found.length > 0, 'expected the built evidence bundle to import its Node builtins')
  for (const specifier of found) {
    assert.match(specifier, /^node:/, `packages/evidence/lib/index.js must stay self-contained, found "${specifier}"`)
  }
})

/**
 * The lease layer: it sits above the kernel like the evidence layer, and for the
 * same reason. It may NAME the kernel's migration and executor shapes but must
 * not import it at runtime — the caller composes the migrations and hands in the
 * store — and it depends on `@dsh-mywork/core` for nothing but pure predicates.
 */
const leaseSources = collect(join(repoRoot, 'packages', 'lease', 'src'), ['.ts'])

test('the lease layer builds on its own modules, the contracts, the kernel types, and core predicates', () => {
  assert.ok(leaseSources.length >= 4, `lease sources: ${leaseSources.length}`)
  const seen = new Set()
  for (const file of leaseSources) {
    const source = readFileSync(file, 'utf8')
    for (const specifier of specifiersOf(source)) {
      seen.add(specifier)
      const allowed = specifier.startsWith('./')
        || specifier === '@dsh-mywork/contracts'
        || specifier === '@dsh-mywork/core'
        || specifier === '@dsh-mywork/storage'
      assert.ok(allowed, `${file} must not import "${specifier}"`)
    }
    // The kernel is a TYPE-ONLY dependency here: a value import would couple the
    // lease layer to the SQLite driver and drag it into the bundle.
    for (const { typeOnly, specifier } of importsOf(source)) {
      if (specifier === '@dsh-mywork/storage') {
        assert.ok(typeOnly, `${file} must import "@dsh-mywork/storage" as types only`)
      }
    }
  }
  // Guard the extraction: a scan that matched nothing would pass vacuously.
  assert.ok(seen.has('@dsh-mywork/contracts'), `expected the contract import, found ${[...seen].join(', ')}`)
  assert.ok(seen.has('@dsh-mywork/storage'), `expected the kernel type import, found ${[...seen].join(', ')}`)
  assert.ok(seen.has('@dsh-mywork/core'), `expected the core predicate import, found ${[...seen].join(', ')}`)
})

test('the lease layer depends on no product, no DSH package, and no other layer', () => {
  for (const file of leaseSources) {
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      const lowered = specifier.toLowerCase()
      const hit = FORBIDDEN_FOR_STORAGE.find(forbidden => lowered.includes(forbidden))
      assert.equal(hit, undefined, `lease: ${file} must not import "${hit}" through "${specifier}"`)
      assert.equal(
        specifier.startsWith('@dsh-mywork/')
          && !['@dsh-mywork/contracts', '@dsh-mywork/storage', '@dsh-mywork/core'].includes(specifier),
        false,
        `lease: ${file} must not depend on another layer through "${specifier}"`,
      )
    }
  }
  const leaseManifest = manifestOf('lease')
  assert.equal(leaseManifest.dependencies, undefined, 'lease must have no runtime dependency')
  assert.deepEqual(
    Object.keys(leaseManifest.devDependencies),
    ['@dsh-mywork/contracts', '@dsh-mywork/core', '@dsh-mywork/storage'],
  )
})

test('the domain packages do not import the lease layer', () => {
  // `@dsh-mywork/lease` the PACKAGE, not `./lease.ts` the contract module of the
  // contracts package — a bare substring match would confuse the two.
  for (const [pkg, files] of Object.entries(sources)) {
    for (const file of files) {
      for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
        assert.equal(
          specifier === '@dsh-mywork/lease' || specifier.includes('packages/lease'),
          false,
          `${pkg}: ${file} must not import the lease layer through "${specifier}"`,
        )
      }
    }
  }
})

test('the built lease package carries no external import at all', () => {
  const found = specifiersOf(readFileSync(join(repoRoot, 'packages/lease/lib/index.js'), 'utf8'))
  // Unlike the storage and evidence bundles, this one needs no Node builtin: it
  // only issues SQL through the executor the caller hands in. An import here
  // would mean a workspace package was NOT inlined.
  assert.deepEqual(found, [], `packages/lease/lib/index.js must stay self-contained, found ${found.join(', ')}`)
  // Guard against the scan being vacuous on the wrong file.
  assert.ok(
    readFileSync(join(repoRoot, 'packages/lease/lib/index.js'), 'utf8').includes('controller_lease'),
    'expected the built lease bundle to carry the lease schema',
  )
})

/**
 * Board and projection modules (ADR017, ADR018, ADR022). They are part of the
 * domain layer, so the same boundary applies; naming them explicitly keeps the
 * check from silently passing when a module is renamed away.
 */
const BOARD_MODULES = ['board.ts', 'theme.ts']

/** Product and transport names that would leak an adapter into the projection. */
const FORBIDDEN_IN_BOARD = [
  '@deepseek-ai/cordis',
  'beads',
  'hindsight',
  'openviking',
  'react',
  'react-dom',
  'node:http',
  'node:child_process',
]

test('the board and theme modules exist in both domain packages', () => {
  for (const module of BOARD_MODULES) {
    for (const pkg of ['contracts', 'core']) {
      const file = join(repoRoot, 'packages', pkg, 'src', module)
      assert.ok(readFileSync(file, 'utf8').length > 0, `expected packages/${pkg}/src/${module} to exist`)
    }
  }
})

test('the board and theme modules import only their own layer', () => {
  for (const module of BOARD_MODULES) {
    const contractsFile = join(repoRoot, 'packages', 'contracts', 'src', module)
    for (const specifier of specifiersOf(readFileSync(contractsFile, 'utf8'))) {
      assert.match(specifier, /^\.\//, `contracts/src/${module} must only import its own modules, found "${specifier}"`)
    }
    const coreFile = join(repoRoot, 'packages', 'core', 'src', module)
    for (const specifier of specifiersOf(readFileSync(coreFile, 'utf8'))) {
      const allowed = specifier.startsWith('./') || specifier === '@dsh-mywork/contracts'
      assert.ok(allowed, `core/src/${module} must not import "${specifier}"`)
    }
  }
})

test('the board and theme modules depend on no DSH, Beads, HTTP, or UI package', () => {
  let checked = 0
  for (const module of BOARD_MODULES) {
    for (const pkg of ['contracts', 'core']) {
      const file = join(repoRoot, 'packages', pkg, 'src', module)
      for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
        checked += 1
        const lowered = specifier.toLowerCase()
        const hit = FORBIDDEN_IN_BOARD.find(forbidden => lowered.includes(forbidden))
        assert.equal(hit, undefined, `${pkg}/src/${module} must not import "${hit}" through "${specifier}"`)
      }
    }
  }
  // Guard the extraction: the board modules do import their own siblings, so a
  // scan that found nothing would pass this test vacuously.
  assert.ok(checked > 0, 'expected the board modules to import their own layer')
})

test('the built domain bundles carry the board projection', () => {
  // The projection is a real part of the shipped artifact, not a type-only
  // declaration: the tables live in the contracts bundle and the pure
  // projection in the core bundle.
  const contractsBundle = readFileSync(join(repoRoot, 'packages/contracts/lib/index.js'), 'utf8')
  for (const name of ['BOARD_ZONES', 'ZONE_BY_STATE', 'NEEDS_ATTENTION_REASONS']) {
    assert.ok(contractsBundle.includes(name), `expected packages/contracts/lib/index.js to carry ${name}`)
  }
  const coreBundle = readFileSync(join(repoRoot, 'packages/core/lib/index.js'), 'utf8')
  for (const name of ['projectTaskZone', 'legalDropTargets', 'midpointKey', 'resolveSurfacePolicy']) {
    assert.ok(coreBundle.includes(name), `expected packages/core/lib/index.js to carry ${name}`)
  }
})


