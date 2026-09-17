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
