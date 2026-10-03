/**
 * The plan-citation gate must keep biting in the mode CI can actually run (R-52).
 *
 * The gate's input corpus lives in `.work/plan-v0.3`, which a checkout may or
 * may not carry: it is tracked since 2026-10-03, but a copy of the repository
 * without it is still a legal input. A scope that reports green while checking
 * nothing is exactly the failure the CI wiring was meant to remove, so every
 * scope has to bite. Each case here runs the real script from a throwaway
 * repository root, so the assertions are about behaviour (exit codes, reported
 * scope) rather than about the script's text:
 *
 *   - corpus absent → `scope=repository-only`, still a real check of README.md;
 *   - a stale citation in that README → exit 1, so the CI half is not decorative;
 *   - an explicitly requested corpus that is missing → exit 2, still fail-closed;
 *   - corpus present → `scope=full`, positive controls bite when the delta
 *     document stops naming the runtime.
 *
 * Everything is written under one temporary prefix this suite creates and
 * removes; the repository, the live profile and `$DSH_HOME` are not involved.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'

import { runCaptured } from '../scripts/lib/process.mjs'

/** Temporary repositories created by this suite, removed at the end. */
const tempDirs = []

/** Prefix every directory this suite creates carries, so cleanup stays inside it. */
const TEMP_PREFIX = 'dsh-mywork-plancite-'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gateSource = join(repoRoot, 'scripts', 'check-plan-citations.mjs')

/** The superseded peer range the gate exists to keep out of the surface. */
const SUPERSEDED_RANGE = '>=0.1.7-rc.2 <0.2.0'

after(() => {
  for (const dir of tempDirs) {
    // Refuse anything this suite did not create, then delete best-effort.
    assert.ok(dir.startsWith(join(tmpdir(), TEMP_PREFIX)), `refusing to remove ${dir}`)
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Build a throwaway repository root holding the gate and its tracked surfaces.
 * @param {{ readme?: string, commit?: string, version?: string, corpus?: boolean, deltaNamesVersion?: boolean }} [options]
 *   surface text and corpus shape.
 * @returns {{ root: string, run: (args: string[]) => { status: number | undefined, stdout: string, stderr: string } }}
 *   the root and a runner that executes the copied gate inside it.
 */
function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  tempDirs.push(root)
  mkdirSync(join(root, 'scripts'), { recursive: true })
  const gate = join(root, 'scripts', 'check-plan-citations.mjs')
  // Patch the two fallback constants in the copy, so the corpus below is checked
  // against values this suite chose and the assertions cannot drift with the
  // plan's own platform pin.
  const source = readFileSync(gateSource, 'utf8')
    .replace(/const CURRENT_COMMIT = '[^']+'/, `const CURRENT_COMMIT = '${options.commit ?? 'aaaaaaaab'}'`)
    .replace(/const CURRENT_VERSION_FALLBACK = '[^']+'/, `const CURRENT_VERSION_FALLBACK = '${options.version ?? '0.0.0-test'}'`)
    .replace(/2-PLATFORM-DELTA-0\.2\.0-rc\.2\.md/g, '2-PLATFORM-DELTA-test.md')
  writeFileSync(gate, source)
  writeFileSync(join(root, 'README.md'), options.readme ?? '# fixture\n\nNo platform citations here.\n')
  for (const manifest of ['packages/controller/package.json', 'packages/web/package.json']) {
    mkdirSync(join(root, dirname(manifest)), { recursive: true })
    writeFileSync(join(root, manifest), '{\n  "name": "fixture",\n  "version": "1.0.0"\n}\n')
  }
  if (options.corpus === true) {
    const planDir = join(root, '.work', 'plan-v0.3')
    mkdirSync(planDir, { recursive: true })
    writeFileSync(join(planDir, '01-MASTER-PLAN.md'), '# fixture master\n\n## 1.4 Delta\n\nSee §1.4.\n')
    writeFileSync(
      join(planDir, '02-PLATFORM-DELTA-test.md'),
      options.deltaNamesVersion === false
        ? `runtime commit ${options.commit ?? 'aaaaaaaab'}, version withheld\n`
        : `runtime commit ${options.commit ?? 'aaaaaaaab'} at version ${options.version ?? '0.0.0-test'}\n`,
    )
  }
  let runIndex = 0
  const run = args => {
    runIndex += 1
    return runCaptured(process.execPath, [gate, ...args], {
      cwd: root,
      env: process.env,
      logDir: join(root, 'logs'),
      logName: `run-${String(runIndex)}`,
    })
  }
  return { root, run }
}

test('without the corpus the gate reports repository-only scope and still checks the README', () => {
  const { run } = fixture()
  const result = run([])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /scope=repository-only/)
  assert.match(result.stdout, /control\(skipped\)/)
  assert.match(result.stdout, /check-plan-citations: PASS \(scope=repository-only\)/)
})

test('a stale citation in the README fails the repository-only scope', () => {
  const { run } = fixture({ readme: `# fixture\n\nPeer range ${SUPERSEDED_RANGE} is in force.\n` })
  const result = run([])
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stdout, /superseded-range: README\.md:3/)
  assert.match(result.stdout, /FAIL \(1 findings, 0 control failures\)/)
})

test('an explicitly requested corpus that is missing stays a hard error', () => {
  const { run } = fixture()
  const result = run(['--plan-dir', join(tmpdir(), TEMP_PREFIX, 'absent')])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /plan directory not found/)
  assert.match(result.stderr, /fail-closed/)
})

test('with the corpus present the gate reports full scope', () => {
  const { run } = fixture({ corpus: true })
  const result = run([])
  assert.equal(result.status, 0, result.stdout)
  assert.match(result.stdout, /scope=full/)
  assert.doesNotMatch(result.stdout, /control\(skipped\)/)
  assert.match(result.stdout, /check-plan-citations: PASS \(scope=full\)/)
})

test('full scope fails when the delta document stops naming the runtime version', () => {
  const { run } = fixture({ corpus: true, deltaNamesVersion: false })
  const result = run([])
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stdout, /control: the delta document does not name the current version 0\.0\.0-test/)
  assert.match(result.stdout, /FAIL \(0 findings, 1 control failures\)/)
})
