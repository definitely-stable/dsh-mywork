/**
 * The `bd` launch seam (F-13, MW-056, ADR023).
 *
 * `spawn('bd', …, { shell: false })` cannot work on Windows: npm installs `bd`
 * as an extensionless POSIX script plus a `bd.cmd` shim, and neither is an
 * executable. The resolver must therefore hand back `process.execPath` plus the
 * JavaScript entry, and it must **refuse** when it cannot find one — falling back
 * to the shim would turn a broken installation into an `ENOENT` at the first
 * command instead of a named, fixable refusal.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { beads } from './lib/fixtures.mjs'

test('win32 resolves to the JavaScript entry run by process.execPath', () => {
  const launch = beads.resolveBeadsLaunch({
    platform: 'win32',
    findEntry: () => 'C:\\x\\bd.js',
  })
  // The interpreter, the entry as its own argument, and no shell: the argument
  // vector is exactly what the shim would have produced, minus cmd.exe.
  assert.deepEqual(launch, { command: process.execPath, args: ['C:\\x\\bd.js'], shell: false })
  assert.equal(launch.shell, false, 'a shell would re-split the argument vector')
})

test('win32 refuses with BEADS_BINARY_NOT_FOUND instead of falling back to the shim', () => {
  assert.throws(
    () => beads.resolveBeadsLaunch({ platform: 'win32', findEntry: () => undefined }),
    error => {
      assert.equal(error.name, 'BeadsLaunchRefusal')
      assert.equal(error.code, beads.BEADS_BINARY_NOT_FOUND)
      // A refusal an operator can act on: the exact install command is attached,
      // not only described in prose.
      assert.match(error.hint, /^npm install -g @beads\/bd@/)
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
