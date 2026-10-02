/**
 * Reachability: how many workspace packages the composition root actually pulls
 * in.
 *
 * This is a measurement of the dependency graph, not of a running plugin, so it
 * is a static traversal of `@dsh-mywork/*` specifiers. It starts from
 * `packages/controller/src` rather than the built `lib/index.js` on purpose: the
 * bundle's build is being reworked while the composition root grows, and a
 * reachability metric must not turn red because a build was momentarily
 * unavailable.
 *
 * The scanner mirrors `specifiersOf` in `boundaries.test.mjs` — including its
 * whitespace-safe capture, which exists because a string literal ENDING in the
 * word `from` otherwise hands its closing quote to the regex and swallows the
 * code that follows. It is duplicated rather than imported because importing
 * that file would drag in `tests/lib/fixtures.mjs`, which requires a built
 * workspace and would defeat the point of walking sources.
 */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/** Repository root; derived here so this suite needs no built workspace. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Every file with one of the given extensions, recursively. */
function collect(dir, extensions, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collect(path, extensions, found)
    else if (extensions.some(extension => entry.name.endsWith(extension))) found.push(path)
  }
  return found
}

/** Drop comments and template literals, keeping ordinary strings. */
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

/** Workspace package names a directory imports, transitively closed below. */
function workspaceDepsOf(dir) {
  if (!existsSync(dir)) return []
  const deps = new Set()
  for (const file of collect(dir, ['.ts'])) {
    const scrubbed = scrub(readFileSync(file, 'utf8'))
    for (const match of scrubbed.matchAll(/\bfrom\s*['"]([^'"\s]+)['"]/g)) {
      if (match[1].startsWith('@dsh-mywork/')) deps.add(match[1].slice('@dsh-mywork/'.length))
    }
    for (const match of scrubbed.matchAll(/\bimport\s*\(\s*['"]([^'"\s]+)['"]/g)) {
      if (match[1].startsWith('@dsh-mywork/')) deps.add(match[1].slice('@dsh-mywork/'.length))
    }
  }
  return [...deps]
}

/** Transitive closure of workspace packages reachable from the composition root. */
function reachableFrom(entryDir) {
  const reached = new Set()
  const queue = workspaceDepsOf(entryDir)
  let discovered = queue.length
  while (queue.length > 0) {
    const pkg = queue.shift()
    if (reached.has(pkg)) continue
    reached.add(pkg)
    for (const dep of workspaceDepsOf(join(repoRoot, 'packages', pkg, 'src'))) {
      discovered += 1
      if (!reached.has(dep)) queue.push(dep)
    }
  }
  return { reached, discovered }
}

test('the composition root reaches at least nine workspace packages', () => {
  const { reached, discovered } = reachableFrom(join(repoRoot, 'packages', 'controller', 'src'))

  // Guard the extraction: a traversal that found almost nothing would pass the
  // threshold vacuously on an empty set.
  assert.ok(discovered >= 9, `expected the traversal to discover the workspace edges, found ${discovered}`)
  assert.ok(
    reached.size >= 9,
    `expected at least 9 reachable packages, found ${reached.size}: ${[...reached].sort().join(', ')}`,
  )

  // The five packages F-30 brought in must be among them: reaching nine by some
  // other route would not mean the subsystems were wired.
  for (const pkg of ['storage', 'evidence', 'lease', 'planner', 'execution']) {
    assert.ok(reached.has(pkg), `expected "${pkg}" to be reachable from the composition root`)
  }
})
