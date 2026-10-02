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

/**
 * Third-party or product names the domain must never depend on.
 *
 * The platform family is banned by PREFIX, not by one package name: naming only
 * `@deepseek-ai/cordis` let every other `@deepseek-ai/dsh-*` package through, so
 * the ban was a list of one. The prefix is paired with an explicit allowlist
 * below, because the composition root legitimately imports the host runtime —
 * without the allowlist the prefix ban would be unsatisfiable and the scan
 * gate unreachable (defect R-08).
 */
const FORBIDDEN = [
  '@deepseek-ai/',
  'beads',
  'hindsight',
  'openviking',
  'sqlite',
  'better-sqlite3',
  'node:sqlite',
]

/**
 * The only platform specifiers a layer may import, and only where its own
 * allowed set says so. `@deepseek-ai/cordis` is the host's single plugin
 * runtime: importing it is how a plugin is written, not a boundary leak.
 */
const ALLOWED_PLATFORM = ['@deepseek-ai/cordis']

/**
 * The first forbidden name a specifier hits, or undefined.
 *
 * The allowlist is matched on the whole specifier (plus its subpaths), so
 * `@deepseek-ai/cordis` passes while `@deepseek-ai/dsh-sandbox-policy` does not.
 * @param specifier - the module specifier to test.
 * @param forbidden - names banned by case-insensitive substring.
 * @param allowed - specifiers exempt from `forbidden`.
 */
function forbiddenIn(specifier, forbidden, allowed = []) {
  const lowered = specifier.toLowerCase()
  if (allowed.some(entry => lowered === entry || lowered.startsWith(`${entry}/`))) return undefined
  return forbidden.find(name => lowered.includes(name))
}

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

/**
 * Every module specifier a file imports or re-exports.
 *
 * The capture excludes whitespace on purpose. A module specifier never contains
 * it, and without the exclusion a string literal ENDING in the word `from` —
 * `'…read the sequence from'` — hands its CLOSING quote to the regex as if that
 * quote opened a specifier; `[^'"]+` then runs on to the next quote in the file,
 * possibly hundreds of lines later, and every real import inside that span is
 * skipped. That is the same class of hole as the one F-42 closes, so it is
 * closed here too. Measured across all 115 package sources, the exclusion drops
 * exactly one bogus specifier (`beads-adapter/src/memory.ts`) and adds none.
 */
function specifiersOf(source) {
  const scrubbed = scrub(source)
  return [
    ...[...scrubbed.matchAll(/\bfrom\s*['"]([^'"\s]+)['"]/g)].map(match => match[1]),
    ...[...scrubbed.matchAll(/\bimport\s*['"]([^'"\s]+)['"]/g)].map(match => match[1]),
    ...[...scrubbed.matchAll(/\bimport\s*\(\s*['"]([^'"\s]+)['"]/g)].map(match => match[1]),
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
  '@deepseek-ai/',
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
        const hit = forbiddenIn(specifier, FORBIDDEN)
        assert.equal(hit, undefined, `${pkg}: ${file} must not import "${hit}" through "${specifier}"`)
      }
    }
  }
})

test('the widened ban catches the platform family the single-name list missed', () => {
  // The list used to name exactly one package, so any other `@deepseek-ai/dsh-*`
  // import passed silently. This fixture is the one the plan records as missed.
  const legacy = ['@deepseek-ai/cordis', 'beads', 'hindsight', 'openviking', 'sqlite', 'better-sqlite3', 'node:sqlite']
  const fixture = "import type { Context } from '@deepseek-ai/dsh-sandbox-policy'"
  const [specifier] = specifiersOf(fixture)
  assert.equal(specifier, '@deepseek-ai/dsh-sandbox-policy', 'the fixture must be read as a real specifier')
  assert.equal(legacy.find(name => specifier.toLowerCase().includes(name)), undefined, 'the old list missed it')
  assert.equal(forbiddenIn(specifier, FORBIDDEN), '@deepseek-ai/', 'the widened list catches it')
})

test('the cordis allowlist is the only thing that lets a platform import through', () => {
  const fixture = "import { Service, type Context } from '@deepseek-ai/cordis'"
  const [specifier] = specifiersOf(fixture)
  assert.equal(specifier, '@deepseek-ai/cordis')
  // Without the allowlist the prefix ban would make every plugin unsatisfiable.
  assert.equal(forbiddenIn(specifier, FORBIDDEN), '@deepseek-ai/')
  // With it, the host runtime passes — and so does a subpath of it...
  assert.equal(forbiddenIn(specifier, FORBIDDEN, ALLOWED_PLATFORM), undefined)
  assert.equal(forbiddenIn('@deepseek-ai/cordis/plugin', FORBIDDEN, ALLOWED_PLATFORM), undefined)
  // ...while a sibling platform package is still caught, so it is not a blanket.
  assert.equal(forbiddenIn('@deepseek-ai/dsh-home-paths', FORBIDDEN, ALLOWED_PLATFORM), '@deepseek-ai/')
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
  // The two domain bundles inline everything they use, so they import nothing.
  for (const relative of ['packages/contracts/lib/index.js', 'packages/core/lib/index.js']) {
    assert.deepEqual(specifiersOf(readFileSync(join(repoRoot, relative), 'utf8')), [], `${relative} imports`)
  }

  // The controller is the published bundle, and since the composition root mounts
  // nine workspace packages it also reaches Node builtins directly. The invariant
  // is therefore stated as a rule rather than as a fixed list: the only external
  // specifiers are the host runtime and `node:*`; a `@dsh-mywork/*` import would
  // mean a workspace package was NOT inlined, and any other `@deepseek-ai/*`
  // would mean a dependency the host does not promise to provide.
  const controller = specifiersOf(readFileSync(join(repoRoot, 'packages/controller/lib/index.js'), 'utf8'))
  assert.deepEqual(
    controller.filter(specifier => !specifier.startsWith('node:')),
    ['@deepseek-ai/cordis'],
    'the only non-builtin external may be the host runtime',
  )
  assert.deepEqual(
    controller.filter(specifier => specifier.startsWith('@dsh-mywork/')),
    [],
    'the workspace packages must be inlined, not imported',
  )
  // Guard the extraction: a scan that found nothing would pass both checks above.
  assert.ok(
    controller.filter(specifier => specifier.startsWith('node:')).length >= 3,
    `expected the bundle to import its Node builtins, found ${controller.join(', ')}`,
  )
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
      const hit = forbiddenIn(specifier, FORBIDDEN_FOR_STORAGE)
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
      const hit = forbiddenIn(specifier, FORBIDDEN_FOR_STORAGE)
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
      const hit = forbiddenIn(specifier, FORBIDDEN_FOR_STORAGE)
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
 * The execution layer: the claim saga. It sits above the kernel like the lease and
 * evidence layers and follows the same rules — the caller composes the migrations
 * and hands in an open store — so it gets the same checks. Naming it explicitly is
 * the point: without an entry here the package could import a SQLite driver, name
 * a product, or depend on another layer, and the suite would stay green.
 */
const executionSources = collect(join(repoRoot, 'packages', 'execution', 'src'), ['.ts'])

test('the execution layer builds on its own modules, the contracts, core, and the kernel types', () => {
  assert.ok(executionSources.length >= 5, `execution sources: ${executionSources.length}`)
  const seen = new Set()
  for (const file of executionSources) {
    const source = readFileSync(file, 'utf8')
    for (const specifier of specifiersOf(source)) {
      seen.add(specifier)
      const allowed = specifier.startsWith('./')
        || specifier === '@dsh-mywork/contracts'
        || specifier === '@dsh-mywork/core'
        || specifier === '@dsh-mywork/evidence'
        || specifier === '@dsh-mywork/storage'
        || specifier === 'node:crypto'
      assert.ok(allowed, `${file} must not import "${specifier}"`)
    }
    // The kernel is a TYPE-ONLY dependency here, exactly as it is for the lease and
    // evidence layers: a value import would couple the saga to the SQLite driver.
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

test('the execution layer depends on no product, no DSH package, and no other layer', () => {
  for (const file of executionSources) {
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      const hit = forbiddenIn(specifier, FORBIDDEN_FOR_STORAGE)
      assert.equal(hit, undefined, `execution: ${file} must not import "${hit}" through "${specifier}"`)
      assert.equal(
        specifier.startsWith('@dsh-mywork/')
          && !['@dsh-mywork/contracts', '@dsh-mywork/storage', '@dsh-mywork/core', '@dsh-mywork/evidence'].includes(specifier),
        false,
        `execution: ${file} must not depend on another layer through "${specifier}"`,
      )
    }
  }
  const manifest = manifestOf('execution')
  assert.equal(manifest.dependencies, undefined, 'execution must have no runtime dependency')
  assert.deepEqual(
    Object.keys(manifest.devDependencies),
    ['@dsh-mywork/contracts', '@dsh-mywork/core', '@dsh-mywork/evidence', '@dsh-mywork/storage'],
  )
})

test('the built execution package inlines its layers and imports only its own builtin', () => {
  // The scanner is textual and the bundle keeps its doc comments, so prose can
  // contain the word "from" — only real module specifiers are considered, which is
  // what the `node:` / `@` / relative prefixes below select.
  const found = specifiersOf(readFileSync(join(repoRoot, 'packages/execution/lib/index.js'), 'utf8'))
  const modules = found.filter(specifier => specifier.startsWith('node:') || specifier.startsWith('@') || specifier.startsWith('.'))
  // The workspace layers must be inlined; the only external module allowed is the
  // Node builtin the saga uses for its unique evidence suffix.
  assert.deepEqual(modules, ['node:crypto'], `packages/execution/lib/index.js imports ${modules.join(', ')}`)
  // Guard against the scan being vacuous on the wrong file.
  const bundle = readFileSync(join(repoRoot, 'packages/execution/lib/index.js'), 'utf8')
  assert.ok(bundle.includes('claim_intent'), 'expected the built bundle to carry the claim schema')
  assert.ok(bundle.includes('attempt_task_live_lease'), 'expected the built bundle to carry the lease invariant')
  assert.ok(bundle.includes('@dsh-mywork/contracts') === false, 'the contracts package must be inlined, not imported')
})

test('the domain packages do not import the execution layer', () => {
  for (const [pkg, files] of Object.entries(sources)) {
    for (const file of files) {
      for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
        assert.equal(
          specifier === '@dsh-mywork/execution' || specifier.includes('packages/execution'),
          false,
          `${pkg}: ${file} must not import the execution layer through "${specifier}"`,
        )
      }
    }
  }
})

/**
 * Board and projection modules (ADR017, ADR018, ADR022). They are part of the
 * domain layer, so the same boundary applies; naming them explicitly keeps the
 * check from silently passing when a module is renamed away.
 */
const BOARD_MODULES = ['board.ts', 'theme.ts']

/** Product and transport names that would leak an adapter into the projection. */
const FORBIDDEN_IN_BOARD = [
  '@deepseek-ai/',
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
        const hit = forbiddenIn(specifier, FORBIDDEN_IN_BOARD)
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

/**
 * The infrastructure and control packages (F-42).
 *
 * None of them was scanned by any check before, so the hole was total rather
 * than DSH-specific: a SQLite driver, a product name, or another layer could
 * have appeared here and the suite would have stayed green. Naming them
 * explicitly keeps the coverage from silently disappearing when a package is
 * renamed away.
 *
 * The platform family is banned by prefix (F-41), and the composition root
 * legitimately imports the host runtime, so the allowlist is carried here too.
 */
const schedulerSources = collect(join(repoRoot, 'packages', 'scheduler', 'src'), ['.ts'])
const plannerSources = collect(join(repoRoot, 'packages', 'planner', 'src'), ['.ts'])
const adapterSdkSources = collect(join(repoRoot, 'packages', 'adapter-sdk', 'src'), ['.ts'])
const controllerSources = collect(join(repoRoot, 'packages', 'controller', 'src'), ['.ts'])
const memoryNativeSources = collect(join(repoRoot, 'packages', 'memory-native', 'src'), ['.ts'])

/**
 * The two packages E-stage added, under the same scan as the rest of the
 * infrastructure layer (F-42, E-03/E-14). Both spawn a process or read a
 * repository, so they are exactly the kind of package an unlisted dependency
 * would hide in: without an entry here a SQLite driver or a product name could
 * appear in either and this suite would stay green.
 */
const gateRunnerSources = collect(join(repoRoot, 'packages', 'gate-runner', 'src'), ['.ts'])
const worktreeAdapterSources = collect(join(repoRoot, 'packages', 'worktree-adapter', 'src'), ['.ts'])

/**
 * `beads-adapter` joins the scan beyond F-42's five packages, deliberately.
 *
 * It was the one remaining unscanned package, and the `specifiersOf` hole found
 * while writing F-42 fired in exactly one place — `beads-adapter/src/memory.ts`
 * — so leaving it out would have left the hole's only real trigger uncovered.
 * It imports the host runtime, so it carries the same cordis allowlist.
 */
const beadsAdapterSources = collect(join(repoRoot, 'packages', 'beads-adapter', 'src'), ['.ts'])

/** Product and platform names the infrastructure layer must not depend on. */
const FORBIDDEN_FOR_INFRA = [
  '@deepseek-ai/',
  'beads',
  'hindsight',
  'openviking',
  'sqlite',
  'better-sqlite3',
  'node:sqlite',
]

/**
 * Allowed specifiers per package, listed explicitly rather than by prefix, so a
 * new dependency is a deliberate edit to this table instead of a silent pass.
 *
 * `controller` is the composition root: it wires the workspace packages
 * together, so it may import any `@dsh-mywork/*` and any Node builtin — but no
 * additional platform package and no product.
 */
const INFRA_PACKAGES = [
  {
    key: 'scheduler',
    sources: schedulerSources,
    min: 2,
    allowed: ['@dsh-mywork/contracts', '@dsh-mywork/core'],
    expected: ['@dsh-mywork/contracts', '@dsh-mywork/core'],
  },
  {
    key: 'planner',
    sources: plannerSources,
    min: 5,
    allowed: ['@dsh-mywork/contracts', '@dsh-mywork/core', '@dsh-mywork/evidence', '@dsh-mywork/storage', 'node:crypto'],
    expected: ['@dsh-mywork/contracts', '@dsh-mywork/storage'],
  },
  {
    key: 'adapter-sdk',
    sources: adapterSdkSources,
    min: 8,
    allowed: ['@dsh-mywork/contracts'],
    expected: ['@dsh-mywork/contracts'],
  },
  {
    key: 'memory-native',
    sources: memoryNativeSources,
    min: 3,
    allowed: ['@dsh-mywork/contracts', '@dsh-mywork/core'],
    expected: ['@dsh-mywork/contracts'],
  },
  {
    key: 'gate-runner',
    sources: gateRunnerSources,
    min: 4,
    allowed: ['@dsh-mywork/contracts'],
    expected: ['@dsh-mywork/contracts'],
    nodePrefix: true,
  },
  {
    key: 'worktree-adapter',
    sources: worktreeAdapterSources,
    min: 4,
    allowed: ['@dsh-mywork/contracts', '@dsh-mywork/core'],
    expected: ['@dsh-mywork/contracts'],
    nodePrefix: true,
  },
  {
    key: 'controller',
    sources: controllerSources,
    min: 4,
    allowed: ['@deepseek-ai/cordis'],
    expected: ['@dsh-mywork/contracts', '@deepseek-ai/cordis'],
    workspacePrefix: true,
    nodePrefix: true,
  },
  {
    key: 'beads-adapter',
    sources: beadsAdapterSources,
    min: 12,
    allowed: ['@dsh-mywork/contracts', '@dsh-mywork/core', '@dsh-mywork/adapter-sdk', '@deepseek-ai/cordis'],
    expected: ['@dsh-mywork/contracts', '@deepseek-ai/cordis'],
    nodePrefix: true,
  },
]

test('every infrastructure package has sources, so no new block is vacuous', () => {
  for (const pkg of INFRA_PACKAGES) {
    assert.ok(
      pkg.sources.length >= pkg.min,
      `${pkg.key}: expected at least ${pkg.min} sources, found ${pkg.sources.length}`,
    )
  }
})

test('the infrastructure packages depend on no product, no extra platform package, and no stray specifier', () => {
  for (const pkg of INFRA_PACKAGES) {
    const seen = new Set()
    for (const file of pkg.sources) {
      for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
        seen.add(specifier)
        const hit = forbiddenIn(specifier, FORBIDDEN_FOR_INFRA, ALLOWED_PLATFORM)
        assert.equal(hit, undefined, `${pkg.key}: ${file} must not import "${hit}" through "${specifier}"`)
        const allowed = specifier.startsWith('./')
          || (pkg.workspacePrefix === true && specifier.startsWith('@dsh-mywork/'))
          || (pkg.nodePrefix === true && specifier.startsWith('node:'))
          || pkg.allowed.includes(specifier)
        assert.ok(allowed, `${pkg.key}: ${file} must not import "${specifier}"`)
      }
    }
    // Guard the extraction: a scan that matched nothing would pass vacuously.
    for (const expected of pkg.expected) {
      assert.ok(seen.has(expected), `${pkg.key}: expected the "${expected}" import, found ${[...seen].join(', ')}`)
    }
  }
})

test('the controller imports the host runtime, and the allowlist is why that passes', () => {
  const specifiers = controllerSources.flatMap(file => specifiersOf(readFileSync(file, 'utf8')))
  assert.ok(specifiers.includes('@deepseek-ai/cordis'), 'expected the composition root to import the host runtime')
  // The same specifier is banned for a layer with no business importing it.
  assert.equal(forbiddenIn('@deepseek-ai/cordis', FORBIDDEN_FOR_INFRA, []), '@deepseek-ai/')
  assert.equal(forbiddenIn('@deepseek-ai/cordis', FORBIDDEN_FOR_INFRA, ALLOWED_PLATFORM), undefined)
  const strayPlatform = specifiers.filter(
    specifier => specifier.startsWith('@deepseek-ai/') && specifier !== '@deepseek-ai/cordis',
  )
  assert.deepEqual(strayPlatform, [], `the controller must import no other platform package, found ${strayPlatform.join(', ')}`)
})


