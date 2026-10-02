/**
 * The `bd` launch seam (F-13, MW-056, ADR023).
 *
 * npm's Windows `.cmd` shim cannot be spawned with `shell: false`, but the
 * official native release is a real `bd.exe` and can. The resolver therefore
 * prefers a native executable, falls back to the npm JavaScript entry, and
 * refuses rather than ever invoking the shim through a shell.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { beads } from './lib/fixtures.mjs'

test('win32 prefers a native bd.exe and never asks for the npm entry', () => {
  const launch = beads.resolveBeadsLaunch({
    platform: 'win32',
    findBinary: () => 'C:\\tools\\bd.exe',
    findEntry: () => { throw new Error('native binary should win') },
  })
  assert.deepEqual(launch, { command: 'C:\\tools\\bd.exe', args: [], shell: false })
})

test('win32 falls back to the JavaScript entry run by process.execPath', () => {
  const launch = beads.resolveBeadsLaunch({
    platform: 'win32',
    findBinary: () => undefined,
    findEntry: () => 'C:\\x\\bd.js',
  })
  assert.deepEqual(launch, { command: process.execPath, args: ['C:\\x\\bd.js'], shell: false })
  assert.equal(launch.shell, false, 'a shell would re-split the argument vector')
})

test('win32 refuses with BEADS_BINARY_NOT_FOUND instead of falling back to the shim', () => {
  assert.throws(
    () => beads.resolveBeadsLaunch({
      platform: 'win32',
      findBinary: () => undefined,
      findEntry: () => undefined,
    }),
    error => {
      assert.equal(error.name, 'BeadsLaunchRefusal')
      assert.equal(error.code, beads.BEADS_BINARY_NOT_FOUND)
      // A refusal an operator can act on: the exact install command is attached,
      // not only described in prose.
      assert.match(error.hint, /^npm install -g @beads\/bd@/)
      assert.match(error.message, /bd\.exe/)
      assert.match(error.message, /@beads\/bd/)
      return true
    },
  )
})

test('POSIX keeps spawning bd directly, and an explicit entry still wins', () => {
  assert.deepEqual(beads.resolveBeadsLaunch({ platform: 'linux' }), {
    command: 'bd',
    args: [],
    shell: false,
  })
  // The search is a Windows problem; POSIX must not call it at all.
  assert.deepEqual(
    beads.resolveBeadsLaunch({ platform: 'linux', findEntry: () => { throw new Error('not called') } }),
    { command: 'bd', args: [], shell: false },
  )
  // A caller who names the entry has answered the question the search exists for.
  assert.deepEqual(beads.resolveBeadsLaunch({ platform: 'linux', entry: '/opt/bd/bin/bd.js' }), {
    command: process.execPath,
    args: ['/opt/bd/bin/bd.js'],
    shell: false,
  })
})
