#!/usr/bin/env node
/**
 * End-to-end check of the published shape: pack the controller bundle, install
 * it into an isolated DSH home with the real `dsh` CLI, verify the composed
 * configuration, and boot the profile so the plugin mounts and unloads.
 *
 * The user's own profile is never addressed: every child process runs with
 * `DSH_HOME` pointing at a fresh directory under `.tmp/`, and the script hashes
 * the real profile manifests before and after to prove they did not change.
 *
 * One assertion does read the real profile, read-only: the board row's
 * `sessionDefaultPermission` must stay beside `plugin`, the shape whose loss
 * (R-47) silently put the board back on the `read-only` default and blocked
 * every card that pins a wider permission. It is skipped when the profile or the
 * row is absent, which is what a clean runner looks like.
 *
 * Usage: node scripts/verify-profile.mjs [--dsh-bin <path-or-command>] [--keep]
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { packController, packUi, repoRoot } from './pack.mjs'
import { quoteCommandArg, resolveCommandOnPath, runCaptured } from './lib/process.mjs'
import {
  BOARD_ROW_ID,
  EXPECTED_SESSION_DEFAULT_PERMISSION,
  inspectBoardRowPermission,
} from './lib/profile-permission.mjs'

/** Profile name created inside the isolated home. */
const PROFILE = 'mywork-verify'

/** Host bundle the verification installs. */
const BUNDLE = '@dsh-mywork/controller'

/** UI bundle the verification installs: the row that mounts the board panel. */
const BUNDLE_UI = '@dsh-mywork/web'

/**
 * Boot lines that mean a composed row did not mount.
 *
 * DSH reports a row it could not resolve as a warning and keeps going, so a
 * missing second package used to leave this gate green while the profile it
 * produced carried a broken entry (review A, finding F-1). The verification
 * treats any of these as a failure.
 *
 * The third marker is the other failure class the two-bundle shape creates
 * (review A, finding N1): a bundle listed in `dsh.profile.bundles` but absent
 * from the profile's `node_modules` is skipped with `cannot resolve profile
 * bundle`, which is neither of the first two lines.
 */
const INACTIVE_MARKERS = ['did not activate', 'failed to import', 'cannot resolve profile bundle']

/** Diagnostic text the controller writes when `diagnostics: true`. */
const MOUNT_LINE = 'dsh-mywork: controller mounted'
const STOP_LINE = 'dsh-mywork: controller stopped'

const argv = process.argv.slice(2)

/**
 * Value of `--name value` or `--name=value`.
 * @param {string} name - option name without dashes.
 * @returns {string | undefined} the value when present.
 */
function option(name) {
  const inline = argv.find(argument => argument.startsWith(`--${name}=`))
  if (inline !== undefined) return inline.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  return index === -1 ? undefined : argv[index + 1]
}

const keep = argv.includes('--keep')
const workDir = join(repoRoot, '.tmp', 'verify-profile')
const home = join(workDir, 'home')
const logsDir = join(workDir, 'logs')
const profileDir = join(home, 'profiles', PROFILE)

let logIndex = 0

/**
 * Resolve the DSH CLI to spawn: an explicit path, `DSH_BIN`, or the launcher
 * DSH installs for the current user.
 * @returns {{ command: string, prefix: string[], shell: boolean, label: string }}
 *   the spawn specification, where `label` is printed for the run record.
 */
function resolveDsh() {
  const requested = option('dsh-bin') ?? process.env.DSH_BIN ?? defaultDshBin()
  if (requested === undefined) {
    fail(
      'cannot locate the dsh CLI: pass --dsh-bin <path>, set DSH_BIN, or install dsh '
      + `(looked for ${join(homedir(), '.dsh', 'bin', 'dsh.cmd')})`,
    )
  }
  const candidate = resolveCommandOnPath(requested)
  if (candidate.endsWith('.js') || candidate.endsWith('.mjs')) {
    return { command: process.execPath, prefix: [candidate], shell: false, label: `${process.execPath} ${candidate}` }
  }
  const shell = candidate.endsWith('.cmd') || candidate.endsWith('.bat')
  return { command: candidate, prefix: [], shell, label: candidate }
}

/**
 * The launcher DSH installs for the current user, when present.
 * @returns {string | undefined} absolute path of the launcher.
 */
function defaultDshBin() {
  for (const name of ['dsh.cmd', 'dsh.exe', 'dsh']) {
    const candidate = join(homedir(), '.dsh', 'bin', name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Print the failure and exit, keeping the work directory for diagnosis. */
function fail(message) {
  console.error(`FAIL ${message}`)
  console.error(`     the work directory is kept for diagnosis: ${workDir}`)
  process.exit(1)
}

/**
 * Assert a condition or fail the verification, printing the captured streams.
 * @param {boolean} condition - the assertion.
 * @param {string} message - failure description.
 * @param {{ status?: number, error?: Error, stdout?: string, stderr?: string, outPath?: string, errPath?: string }} [captured]
 *   the failing command's result, when the assertion is about a command.
 */
function expect(condition, message, captured) {
  if (!condition) {
    if (captured !== undefined) {
      console.error(`     exit=${String(captured.status)}`)
      if (captured.error !== undefined) console.error(`     spawn: ${captured.error.name}: ${captured.error.message}`)
      console.error(`     stdout: ${JSON.stringify((captured.stdout ?? '').slice(-2000))}`)
      console.error(`     stderr: ${JSON.stringify((captured.stderr ?? '').slice(-2000))}`)
      console.error(`     logs: ${String(captured.outPath)}\n           ${String(captured.errPath)}`)
    }
    fail(message)
  }
}

/**
 * Content hash of a file, or undefined when it does not exist.
 * @param {string} path - file to hash.
 * @returns {string | undefined} the digest.
 */
function hashFile(path) {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : undefined
}

/**
 * Real-profile files that must stay byte-identical across the verification.
 * @returns {Map<string, string | undefined>} path → digest.
 */
function realProfileFingerprint() {
  const candidates = [
    join(homedir(), '.dsh', 'profiles', 'web', 'package.json'),
    join(homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml'),
    join(homedir(), '.dsh', 'settings.yaml'),
  ]
  return new Map(candidates.map(path => [path, hashFile(path)]))
}

const dsh = resolveDsh()
console.log(`dsh: ${dsh.label}`)
console.log(`home: ${home} (isolated; the user profile is not used)`)

const beforeRealProfile = realProfileFingerprint()

rmSync(workDir, { recursive: true, force: true })
mkdirSync(home, { recursive: true })

/**
 * Spawn the DSH CLI with the isolated home.
 * @param {string[]} args - CLI arguments.
 * @param {string} logName - log file stem.
 * @param {NodeJS.ProcessEnv} [extraEnv] - additional environment entries.
 */
function dshRun(args, logName, extraEnv = {}) {
  logIndex += 1
  const stem = `${String(logIndex).padStart(2, '0')}-${logName}`
  const options = {
    cwd: repoRoot,
    env: { ...process.env, DSH_HOME: home, ...extraEnv },
    logDir: logsDir,
    logName: stem,
  }
  if (dsh.shell) {
    // A `.cmd` launcher needs a shell; pass one command line instead of an
    // argument vector, which Node 24 deprecates (DEP0190) and would re-quote.
    const line = [dsh.command, ...dsh.prefix, ...args].map(quoteCommandArg).join(' ')
    return runCaptured(line, [], { ...options, shell: true })
  }
  return runCaptured(dsh.command, [...dsh.prefix, ...args], { ...options, shell: false })
}

// 1. Build the artifacts an installed consumer receives: the host bundle and the
//    UI bundle whose own patch carries the board panel's row.
const tarball = packController({ outDir: join(workDir, 'pack') })
console.log(`ok   packed ${tarball}`)
const uiTarball = packUi({ outDir: join(workDir, 'pack') })
console.log(`ok   packed ${uiTarball}`)

// 2. Create the test profile from the keyless sdk-minimal template. Booting it
//    with stdin closed exits immediately after mounting the composition, which
//    doubles as the baseline that the isolated home works before our bundle.
const created = dshRun(['--profile', PROFILE, '--from-default-profile', 'sdk-minimal'], 'create-profile')
expect(created.status === 0, `creating the profile from the sdk-minimal template exited with ${String(created.status)}`, created)
expect(existsSync(join(profileDir, 'package.json')), `profile manifest was not created at ${profileDir}`)
console.log(`ok   created isolated profile ${PROFILE} from the sdk-minimal template`)

// 3. Install the packed bundles through the real plugin path. The UI bundle is
//    installed the same way: it is a bundle of its own, not a dependency of the
//    controller, and installing only one of the two must not be reported green.
const installed = dshRun(['plugin', '--profile', PROFILE, 'add', tarball], 'plugin-add')
expect(installed.status === 0, `dsh plugin add exited with ${String(installed.status)}`, installed)
console.log('ok   dsh plugin add installed the packed host bundle')
const installedUi = dshRun(['plugin', '--profile', PROFILE, 'add', uiTarball], 'plugin-add-ui')
expect(installedUi.status === 0, `dsh plugin add (ui) exited with ${String(installedUi.status)}`, installedUi)
console.log('ok   dsh plugin add installed the packed UI bundle')

// 4. The publication rule: a dependency declaring dsh.bundle joins the layers.
const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
const bundles = manifest.dsh?.profile?.bundles ?? []
expect(manifest.dependencies?.[BUNDLE] !== undefined, `profile manifest does not depend on ${BUNDLE}`)
expect(manifest.dependencies?.[BUNDLE_UI] !== undefined, `profile manifest does not depend on ${BUNDLE_UI}`)
expect(bundles.includes(BUNDLE), `profile bundles ${JSON.stringify(bundles)} do not include ${BUNDLE}`)
expect(bundles.includes(BUNDLE_UI), `profile bundles ${JSON.stringify(bundles)} do not include ${BUNDLE_UI}`)
console.log(`ok   profile bundles reconciled: ${JSON.stringify(bundles)}`)

// 5. Enable the controller's lifecycle diagnostics through the documented user
//    layer, which also proves row configuration reaches the plugin.
writeFileSync(
  join(profileDir, 'cordis.patch.yml'),
  [
    '# Verification overlay (written by scripts/verify-profile.mjs): enable the',
    '# controller lifecycle diagnostics for this isolated profile only.',
    '- id: mywork-controller',
    '  config:',
    '    diagnostics: true',
    '',
  ].join('\n'),
)

// 6. Compose the profile and check both layers and both rows.
const composed = dshRun(['--profile', PROFILE, '--dump-config'], 'dump-config')
expect(composed.status === 0, `dump-config exited with ${String(composed.status)}`, composed)
expect(composed.stdout.includes(`# == ${BUNDLE}`), `composed config has no ${BUNDLE} layer`, composed)
expect(composed.stdout.includes('id: mywork-controller'), 'composed config has no mywork-controller row', composed)
expect(composed.stdout.includes(`name: '${BUNDLE}'`), `composed row does not resolve ${BUNDLE}`, composed)
expect(composed.stdout.includes('diagnostics: true'), 'profile overlay did not reach the row config', composed)
expect(composed.stdout.includes(`# == ${BUNDLE_UI}`), `composed config has no ${BUNDLE_UI} layer`, composed)
expect(composed.stdout.includes(`name: '${BUNDLE_UI}'`), `composed row does not resolve ${BUNDLE_UI}`, composed)
console.log('ok   composed profile contains both layers, both rows, and the overlay config')

// 7. Boot the profile: both rows mount (the UI row mounts silently by design),
//    and the clean EOF shutdown unloads the controller. A row DSH could not
//    resolve is a warning that keeps the process running — and a bundle it
//    cannot resolve at all is skipped the same way — so the markers are
//    asserted here: "the tarball installs" is not the same claim as "every row
//    and bundle it declares activates".
const booted = dshRun(['--profile', PROFILE], 'boot')
const bootOutput = `${booted.stdout}\n${booted.stderr}`
expect(booted.status === 0, `profile boot exited with ${String(booted.status)}`, booted)
expect(bootOutput.includes(MOUNT_LINE), 'booting the profile did not mount the controller', booted)
expect(bootOutput.includes(STOP_LINE), 'unloading the profile did not stop the controller', booted)
for (const marker of INACTIVE_MARKERS) {
  expect(
    !bootOutput.includes(marker),
    `a composed row did not activate (boot output contains "${marker}")`,
    booted,
  )
}
console.log('ok   profile boot mounted and unloaded the controller, and every row activated')
for (const line of bootOutput.split('\n').filter(line => line.includes('dsh-mywork:'))) {
  console.log(`     ${line.trim()}`)
}

// 8. The live profile's board row must keep `sessionDefaultPermission` as a
//    direct child of its config mapping (R-47, R-51). The file is read *before*
//    the fingerprint comparison below, so the comparison covers every read this
//    script performs on the profile. A profile without the row is skipped — that
//    is a legitimate configuration, and a clean runner has no profile at all.
const livePatchPath = join(homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml')
let liveBoard
if (!existsSync(livePatchPath)) {
  liveBoard = { state: 'absent' }
} else {
  try {
    liveBoard = { state: 'read', inspected: inspectBoardRowPermission(readFileSync(livePatchPath, 'utf8')) }
  } catch (error) {
    liveBoard = { state: 'unreadable', reason: error.code ?? error.message }
  }
}

// 9. The user's working profile must be untouched.
const afterRealProfile = realProfileFingerprint()
for (const [path, hash] of beforeRealProfile) {
  expect(afterRealProfile.get(path) === hash, `real profile file changed during verification: ${path}`)
}
console.log(`ok   user profile untouched (${beforeRealProfile.size} fingerprint(s) unchanged)`)

if (liveBoard.state === 'absent') {
  console.log(`skip no live profile at ${livePatchPath}`)
} else if (liveBoard.state === 'unreadable') {
  console.log(`skip cannot read ${livePatchPath}: ${String(liveBoard.reason)}`)
} else if (!liveBoard.inspected.found) {
  console.log(liveBoard.inspected.disabled
    ? `skip the live profile's ${BOARD_ROW_ID} row is disabled`
    : `skip the live profile does not install the ${BOARD_ROW_ID} row`)
} else {
  for (const finding of liveBoard.inspected.findings) console.error(`     ${finding}`)
  expect(
    liveBoard.inspected.findings.length === 0,
    `the live profile's ${BOARD_ROW_ID} row lost its permission wiring: ${livePatchPath}`,
  )
  console.log(
    `ok   live profile board row keeps sessionDefaultPermission `
    + `"${EXPECTED_SESSION_DEFAULT_PERMISSION}" in its config mapping`,
  )
}

if (keep) {
  console.log(`kept: ${workDir}`)
} else {
  rmSync(workDir, { recursive: true, force: true })
  console.log('ok   removed the isolated work directory')
}

console.log('verify:profile: PASS')
