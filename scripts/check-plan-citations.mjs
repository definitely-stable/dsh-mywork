/**
 * Gate for the plan's platform citations (L1) and its internal line references (L3).
 *
 * Why this exists: the plan corpus (`.work/plan-v0.3`, ~1.2 MB) cites the DSH
 * platform by version, by commit and by `file:line` anchor in more than 200
 * places. When the platform moved from `0.1.7-rc.2` to `0.2.0-rc.2` (2026-10-03)
 * those citations had to be re-derived by hand, and nothing stopped the next
 * revision from re-introducing a stale one. The plan's own canon (§15.6 of
 * `01-MASTER-PLAN.md`) already forbids line references to the plan's own files,
 * and that rule had drifted too: 223 `01-MASTER-PLAN.md:NNN` references pointed
 * past the end of a file that had grown from 443 to 568 lines.
 *
 * What it checks, and what it deliberately does NOT:
 *   1. The superseded peer range `>=0.1.7-rc.2 <0.2.0` must not appear anywhere
 *      in the plan or in the workspace manifests. It admitted the running
 *      runtime only through `includePrerelease` and refused `0.2.0` itself.
 *   2. Every `0.1.7-rc.2` / `c7c4c725` citation outside the historical artifacts
 *      (`evidence/**`, `90-`…`93-`) must sit on a line that says it is
 *      historical. The check is lexical, so the marker list is explicit and a
 *      line that states the fact another way is a finding to reword, not a gate
 *      bug.
 *   3. `01-MASTER-PLAN.md:NNN`-style line references must not appear outside the
 *      historical artifacts (plan canon §15.6: reference steps and cards by ID).
 *   4. Positive controls: the delta document must name the commit and the
 *      version the checkout actually holds — otherwise the gate would pass on a
 *      plan that simply deleted every citation.
 *
 * Usage:
 *   node scripts/check-plan-citations.mjs
 *   node scripts/check-plan-citations.mjs --plan-dir .work/plan-v0.3 \
 *     --dsh-checkout C:\Reposit\deepseek-harness\deepseek-harness
 *
 * Two scopes, and the difference is reported on every run:
 *
 *   `scope=full` — the plan corpus was found and every rule above ran. That is
 *     what CI runs since 2026-10-03: `.work/plan-v0.3` is tracked, so a checkout
 *     carries the corpus (defect R-54 — while it was gitignored, the corpus half
 *     of this gate could not run anywhere but the author's machine).
 *   `scope=repository-only` — the corpus is absent, which is what a copy without
 *     `.work/` gets. The gate still checks the surfaces that ARE tracked
 *     (`README.md` and the two package manifests) and reports the corpus
 *     dependent positive controls as skipped — a green line never hides that
 *     half of the gate did not run (R-52): the README carries the same version
 *     citations as the plan, and it was the surface a previous review found
 *     unscanned. An explicitly requested `--plan-dir` that is missing stays a
 *     hard error, because that is a typo rather than a scope.
 *
 * Exit codes: 0 — clean; 1 — findings; 2 — usage/environment error.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The peer range that was superseded on 2026-10-03. */
const SUPERSEDED_RANGE = '>=0.1.7-rc.2 <0.2.0'

/** The commit the plan is verified against now (checked positively below). */
const CURRENT_COMMIT = '639ed0153'

/** The version the plan targets now; overridden from the checkout when given. */
const CURRENT_VERSION_FALLBACK = '0.2.0-rc.2'

/**
 * Artifacts whose job is to record what was true at the time they were written.
 * They are append-only: a verdict from 2026-09-27 must keep saying 0.1.7-rc.2.
 */
const HISTORICAL_ARTIFACTS = [
  /^evidence[\\/]/,
  /^90-VERIFICATION-A\.md$/,
  /^91-VERIFICATION-B\.md$/,
  /^92-[^\\/]*\.md$/,
  /^93-VERIFICATION-SURFACE\.md$/,
]

/**
 * Markers that make a stale citation explicitly historical on its own line.
 * Worded generously on purpose: the gate wants the line to say why the old
 * version is named, not to force one phrasing.
 */
const HISTORICAL_MARKERS = [
  'историческ',
  'баз',
  'планирования',
  'прежн',
  'было',
  'на 0.1.7',
  'на базе',
  'дельта',
  '→',
  'ранее',
  'замен',
  'отверг',
  'проверялся против',
  'superseded',
  'актуализац',
  'актуализир',
  'неверно',
  'ложн',
  'устарел',
  'git ',
  'замер',
  'команд',
  'кампани',
  'цитат',
]

/**
 * Table headers that make every row below them a comparison, not a claim:
 * a measurement table legitimately lists the old version beside the new one.
 *
 * `Статус` is deliberately NOT here (review finding F-3): the plan's defect
 * registry is `| ID | Дефект | Где | Кто | Статус |`, and excusing every row of
 * it would blind the gate exactly where a "this range is in force" claim is
 * most likely to reappear.
 */
const COMPARATIVE_TABLE_HEADERS = ['диапазон', 'замер', 'вердикт', 'версия рантайма', 'проверка', 'было']

/**
 * A stale version is a claim only where it is not a path segment, not a range
 * bound and not a version tag: `docs/upgrade-guide/v0.1.7-rc.2/`,
 * `>=0.1.7-rc.2 <0.3.0-0` and `v0.1.7-rc.2` are references, not statements
 * about the running platform.
 */
const STALE_VERSION_PATTERN = /(?<![/\w>=~^-])0\.1\.7-rc\.2(?![/\w-])/

/** A commit id is a citation wherever it appears; paths never contain it. */
const STALE_COMMIT_PATTERN = /(?<![\w/])c7c4c725(?![\w/])/

/**
 * Parse the CLI arguments this script understands.
 * @param {string[]} argv - process arguments after the script path.
 * @returns {{ planDir: string, planDirExplicit: boolean, dshCheckout: string | undefined, json: boolean }} the options,
 *   where `planDirExplicit` tells a typo (a requested directory that is missing) from a scope (the default one is absent).
 */
function parseArgs(argv) {
  const options = {
    planDir: join(repoRoot, '.work', 'plan-v0.3'),
    planDirExplicit: false,
    dshCheckout: undefined,
    json: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--plan-dir') {
      options.planDir = resolve(argv[index + 1] ?? '')
      options.planDirExplicit = true
      index += 1
    } else if (arg === '--dsh-checkout') {
      options.dshCheckout = resolve(argv[index + 1] ?? '')
      index += 1
    } else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/check-plan-citations.mjs [--plan-dir <dir>] [--dsh-checkout <dir>] [--json]')
      process.exit(0)
    } else {
      console.error(`check-plan-citations: unknown argument ${JSON.stringify(arg)}`)
      process.exit(2)
    }
  }
  return options
}

/**
 * List every Markdown file under a directory, relative to it.
 * @param {string} root - the directory to walk.
 * @returns {string[]} the relative paths, sorted.
 */
function markdownFiles(root) {
  const found = []
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(current, entry.name)
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(absolute, relative)
      else if (entry.isFile() && entry.name.endsWith('.md')) found.push(relative)
    }
  }
  walk(root, '')
  return found
}

/**
 * Read the platform version a checkout holds, so the gate follows the runtime.
 * Fail-closed (review finding F-4): a `--dsh-checkout` that cannot be read is a
 * usage error, never a silent fallback to the constant — otherwise a typo would
 * turn every version control green.
 * @param {string | undefined} checkout - the DSH checkout path, when given.
 * @returns {string} the version, or the fallback when no checkout was given.
 */
function currentVersion(checkout) {
  if (checkout === undefined) return CURRENT_VERSION_FALLBACK
  const manifest = join(checkout, 'package.json')
  if (!existsSync(manifest)) {
    console.error(`check-plan-citations: --dsh-checkout ${checkout} has no package.json (fail-closed)`)
    process.exit(2)
  }
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
    if (typeof parsed.version !== 'string') {
      console.error(`check-plan-citations: ${manifest} has no "version" string (fail-closed)`)
      process.exit(2)
    }
    return parsed.version
  } catch (error) {
    console.error(`check-plan-citations: cannot read ${manifest}: ${error.message} (fail-closed)`)
    process.exit(2)
  }
}

/**
 * Read the commit a checkout holds, so the positive control follows the tree
 * instead of a constant (review finding F-5). Fail-closed for the same reason.
 * @param {string | undefined} checkout - the DSH checkout path, when given.
 * @returns {string} the short commit, or the constant when no checkout was given.
 */
function currentCommit(checkout) {
  if (checkout === undefined) return CURRENT_COMMIT
  try {
    // `git -C` walks up the tree, so a directory that is not itself a
    // repository would silently report the enclosing repository's HEAD
    // (verification finding N3). Require the checkout to be the root.
    const top = execFileSync('git', ['-C', checkout, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    if (top === '' || resolve(top).toLowerCase() !== resolve(checkout).toLowerCase()) {
      throw new Error(`--dsh-checkout is not a repository root (git reports ${JSON.stringify(top)})`)
    }
    const full = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    if (!/^[0-9a-f]{40}$/.test(full)) throw new Error(`unexpected revision ${JSON.stringify(full)}`)
    // Nine hex digits: the width the plan corpus cites commits with, and short
    // enough that `git rev-parse --short` cannot disagree with it.
    return full.slice(0, 9)
  } catch (error) {
    console.error(`check-plan-citations: cannot read the commit of ${checkout}: ${error.message} (fail-closed)`)
    process.exit(2)
  }
}

/**
 * Test whether a line states that its stale citation is historical.
 * @param {string} line - the text of the line.
 * @returns {boolean} true when one of the markers is present.
 */
function markedHistorical(line) {
  const lowered = line.toLowerCase()
  return HISTORICAL_MARKERS.some(marker => lowered.includes(marker.toLowerCase()))
}

/**
 * Scan one file and collect findings.
 * @param {string} planDir - the plan directory.
 * @param {string} relative - the file's path relative to the plan directory.
 * @returns {{ file: string, line: number, rule: string, text: string }[]} the findings.
 */
function scanFile(planDir, relative) {
  const findings = []
  const advisory = []
  const historical = HISTORICAL_ARTIFACTS.some(pattern => pattern.test(relative))
  const text = readFileSync(join(planDir, relative), 'utf8')
  const lines = text.split(/\r?\n/)
  // A row inside a comparison table is data, not a statement about the
  // running platform: find each table's header (the line above its `|---|`
  // separator) and excuse rows whose header says the table compares.
  const comparativeRows = new Set()
  for (let index = 1; index < lines.length; index += 1) {
    if (!/^\|[\s:|-]+\|$/.test(lines[index].trim())) continue
    const header = lines[index - 1].toLowerCase()
    if (!COMPARATIVE_TABLE_HEADERS.some(word => header.includes(word))) continue
    for (let row = index + 1; row < lines.length && lines[row].trim().startsWith('|'); row += 1) comparativeRows.add(row)
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const lineNumber = index + 1
    const excused = markedHistorical(line) || comparativeRows.has(index)
    // The superseded range may survive only in the dated records (whose job is
    // to say what was decided then) or where the line says it is the old one
    // (a comparison table, a defect registry entry, a rejection note).
    if (line.includes(SUPERSEDED_RANGE) && !historical && !excused) {
      findings.push({ file: relative, line: lineNumber, rule: 'superseded-range', text: line.trim() })
    }
    if (!historical) {
      if (STALE_VERSION_PATTERN.test(line) && !excused) {
        findings.push({ file: relative, line: lineNumber, rule: 'stale-version-unmarked', text: line.trim() })
      }
      if (STALE_COMMIT_PATTERN.test(line) && !excused) {
        findings.push({ file: relative, line: lineNumber, rule: 'stale-commit-unmarked', text: line.trim() })
      }
      // Plan canon §15.6: the master plan is referenced by section, never by a
      // line that a later edit moves.
      if (/01-MASTER-PLAN\.md:[0-9]/.test(line)) {
        findings.push({ file: relative, line: lineNumber, rule: 'master-plan-line-reference', text: line.trim() })
      }
      // Other plan documents are cited by line too; that predates this campaign
      // and is reported, not enforced, so the gate stays actionable.
      if (/\b(?:00-RECON|10-DECISIONS|2[0-3]-STEPS-[A-Za-z]+|30-CARD-EDITS)\.md:[0-9]/.test(line)) {
        advisory.push({ file: relative, line: lineNumber, rule: 'plan-line-reference', text: line.trim() })
      }
    }
  }
  return { findings, advisory }
}

const options = parseArgs(process.argv.slice(2))

// The plan corpus lives under `.work/plan-v0.3`, which is tracked since
// 2026-10-03 (R-54) but may be absent from a copy of the repository. Absence is
// therefore a scope, not an error — but only for the default path. An explicitly
// requested directory that is missing is a typo, and a typo must not turn every
// rule green (review finding F-4).
const corpusPresent = existsSync(options.planDir) && statSync(options.planDir).isDirectory()
if (!corpusPresent && options.planDirExplicit) {
  console.error(`check-plan-citations: plan directory not found: ${options.planDir} (requested explicitly, fail-closed)`)
  process.exit(2)
}
const scope = corpusPresent ? 'full' : 'repository-only'

const version = currentVersion(options.dshCheckout)
const commit = currentCommit(options.dshCheckout)
const findings = []
const advisory = []
if (corpusPresent) {
  for (const relative of markdownFiles(options.planDir)) {
    const scanned = scanFile(options.planDir, relative)
    findings.push(...scanned.findings)
    advisory.push(...scanned.advisory)
  }
} else {
  console.log(
    `check-plan-citations: plan corpus not present (${options.planDir}) — scope=repository-only;`
    + ' README.md and the workspace manifests are still checked',
  )
}
// The repository README carries the same version citations as the plan and is
// part of the surface this gate protects (review finding F-2: without this,
// `README.md:353` — the very line the campaign edited — stayed unscanned).
// Fail-closed when it is absent, like the manifests below (verification N1).
const readmePath = join(repoRoot, 'README.md')
if (!existsSync(readmePath)) {
  console.error(`check-plan-citations: ${readmePath} is missing — run this script from the repository (fail-closed)`)
  process.exit(2)
}
const readme = scanFile(repoRoot, 'README.md')
findings.push(...readme.findings)
advisory.push(...readme.advisory)

// The workspace manifests carry the same range and must not keep the old one.
for (const manifest of ['packages/controller/package.json', 'packages/web/package.json']) {
  const path = join(repoRoot, manifest)
  if (!existsSync(path)) {
    console.error(`check-plan-citations: ${path} is missing — run this script from the repository (fail-closed)`)
    process.exit(2)
  }
  const text = readFileSync(path, 'utf8')
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.includes(SUPERSEDED_RANGE)) {
      findings.push({ file: manifest, line: index + 1, rule: 'superseded-range', text: line.trim() })
    }
  })
}

// Positive controls: a plan that deleted every citation must not pass. They need
// the corpus, so an absent one reports them as skipped instead of satisfied.
const controls = []
const skippedControls = []
if (corpusPresent) {
  const delta = join(options.planDir, '02-PLATFORM-DELTA-0.2.0-rc.2.md')
  if (!existsSync(delta)) {
    controls.push('the delta document 02-PLATFORM-DELTA-0.2.0-rc.2.md is missing')
  } else {
    const text = readFileSync(delta, 'utf8')
    if (!text.includes(commit)) controls.push(`the delta document does not name the current commit ${commit}`)
    if (!text.includes(version)) controls.push(`the delta document does not name the current version ${version}`)
  }
  const master = join(options.planDir, '01-MASTER-PLAN.md')
  if (!existsSync(master) || !readFileSync(master, 'utf8').includes('§1.4')) {
    controls.push('01-MASTER-PLAN.md has no §1.4 platform-delta section')
  }
} else {
  skippedControls.push(
    'positive controls need the plan corpus: the delta document names the commit and version, and §1.4 of the master plan',
  )
}

const report = {
  planDir: options.planDir,
  scope,
  currentVersion: version,
  currentCommit: commit,
  findings: findings.length,
  advisory: advisory.length,
  controls,
  skippedControls,
  detail: findings,
  advisoryDetail: advisory,
}

if (options.json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`check-plan-citations: scope=${scope} plan=${options.planDir} version=${version} commit=${commit}`)
  for (const finding of findings) {
    console.log(`  ${finding.rule}: ${finding.file}:${finding.line}: ${finding.text.slice(0, 160)}`)
  }
  for (const control of controls) console.log(`  control: ${control}`)
  for (const control of skippedControls) console.log(`  control(skipped): ${control}`)
  console.log(findings.length === 0 && controls.length === 0
    ? `check-plan-citations: PASS (scope=${scope})`
    : `check-plan-citations: FAIL (${findings.length} findings, ${controls.length} control failures)`)
  if (advisory.length > 0) {
    console.log(`check-plan-citations: advisory — ${advisory.length} line references to other plan documents (canon §15.6 prefers step/card IDs; not enforced here)`)
    for (const entry of advisory.slice(0, 10)) console.log(`  advisory: ${entry.file}:${entry.line}`)
    if (advisory.length > 10) console.log(`  advisory: … ${advisory.length - 10} more`)
  }
}

process.exit(findings.length === 0 && controls.length === 0 ? 0 : 1)
