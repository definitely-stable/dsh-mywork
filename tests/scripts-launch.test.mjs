/**
 * The pnpm launcher must never fall back to `{ command: 'pnpm', shell: true }`.
 *
 * On Windows that handed the decision to `cmd.exe`, which resolved a broken
 * 52-byte store shim and failed with `'…\node_modules\pnpm\pnpm"' is not
 * recognized as an internal or external command`. Each branch is exercised with
 * injected probes, so this suite neither touches the host toolchain nor depends
 * on what `PATH` happens to contain on the machine running it.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { pnpmLaunch, resolveCommandOnPath } from '../scripts/lib/process.mjs'

/** The extensionless store link quoted from `.tmp/pack-logs/pnpm-pack.err.log`. */
const STORE_SHIM = 'H:\\.pnpm-store\\v11\\links\\@\\pnpm\\12.4.2\\hash\\bin\\..\\node_modules\\pnpm\\pnpm'

/**
 * A probe bundle in which nothing exists unless the test says otherwise.
 * @param {object} [overrides] - probe members to replace.
 * @returns {object} the probe bundle.
 */
function probe(overrides = {}) {
  return {
    isFile: () => false,
    pnpmCjsNear: () => undefined,
    corepackEntry: () => undefined,
    pnpmOnPath: () => undefined,
    ...overrides,
  }
}

test('an extensionless npm_execpath resolves to the real pnpm.cjs, not a shell', () => {
  const cjs = 'H:\\.pnpm-store\\v11\\links\\@\\pnpm\\12.4.2\\hash\\node_modules\\pnpm\\bin\\pnpm.cjs'
  const launch = pnpmLaunch({
    env: { npm_execpath: STORE_SHIM },
    probe: probe({ pnpmCjsNear: () => cjs }),
  })
  assert.equal(launch.kind, 'pnpm-cjs')
  assert.equal(launch.shell, false)
  assert.notEqual(launch.command, 'pnpm')
  assert.equal(launch.command, process.execPath)
  assert.deepEqual(launch.args, [cjs])
})

test('an unusable npm_execpath reports unavailable instead of silently using a shell', () => {
  const launch = pnpmLaunch({
    env: { npm_execpath: 'C:\\missing\\pnpm' },
    probe: probe(),
  })
  assert.equal(launch.kind, 'unavailable')
  assert.equal(launch.shell, false)
  assert.match(launch.reason, /no shell-free pnpm launch found/)
  assert.match(launch.reason, /npm_execpath=C:\\missing\\pnpm/)
})

test('a real .cjs npm_execpath is spawned through the current node', () => {
  const cjs = 'C:\\store\\node_modules\\pnpm\\bin\\pnpm.cjs'
  const launch = pnpmLaunch({
    env: { npm_execpath: cjs },
    probe: probe({ isFile: path => path === cjs }),
  })
  assert.equal(launch.kind, 'js-entry')
  assert.equal(launch.shell, false)
  assert.equal(launch.command, process.execPath)
  assert.deepEqual(launch.args, [cjs])
})


test('a bare Windows command prefers a launchable npm shim from PATH', () => {
  const resolved = resolveCommandOnPath('dsh', {
    platform: 'win32',
    where: () => [
      'C:\\npm\\prefix\\dsh',
      'C:\\npm\\prefix\\dsh.cmd',
      'C:\\other\\dsh.exe',
    ],
  })
  assert.equal(resolved, 'C:\\other\\dsh.exe', 'a real executable avoids a shell when one is available')

  const shim = resolveCommandOnPath('dsh', {
    platform: 'win32',
    where: () => ['C:\\npm\\prefix\\dsh', 'C:\\npm\\prefix\\dsh.cmd'],
  })
  assert.equal(shim, 'C:\\npm\\prefix\\dsh.cmd', 'an npm .cmd shim is preferred over its POSIX shim')
})

test('an explicit Windows command path is never rewritten through PATH', () => {
  let lookedUp = false
  const explicit = 'C:\\tools\\dsh.cmd'
  const resolved = resolveCommandOnPath(explicit, {
    platform: 'win32',
    where: () => {
      lookedUp = true
      return ['C:\\wrong\\dsh.cmd']
    },
  })
  assert.equal(resolved, explicit)
  assert.equal(lookedUp, false)
})
