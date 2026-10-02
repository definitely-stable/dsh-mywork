/**
 * The shared `bd` probe (F-15, MW-056).
 *
 * The probe answers one question and never throws: a suite and the Doctor must be
 * able to ask "is a usable `bd` there?" and get the same value, with the real
 * failure named — a non-zero exit, an OS spawn error, or no installation at all.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { beads } from './lib/fixtures.mjs'

/** A runner that answers one canned result. */
function runnerReturning(result) {
  return {
    async run() {
      return result
    },
  }
}

/** A runner that fails the way the process seam does. */
function runnerFailing(error) {
  return {
    async run() {
      throw error
    },
  }
}

test('a working backend is reported with the version it printed', async () => {
  const result = await beads.probeBeads({
    runner: runnerReturning({
      code: 0,
      stdout: 'bd version 1.3.0 (f45b249ce: HEAD@f45b249ce6b4)',
      stderr: '',
    }),
    cache: false,
  })
  assert.equal(result.available, true)
  assert.equal(result.version, '1.3.0')
  assert.match(result.banner, /^bd version 1\.3\.0/)
})

test('a probe never throws: an exit code, an OS error, and a missing binary are values', async () => {
  // A `bd` that ran and refused is a non-zero exit, reported as one.
  const refused = await beads.probeBeads({
    runner: runnerReturning({ code: 1, stdout: '', stderr: 'no workspace' }),
    cache: false,
  })
  assert.equal(refused.available, false)
  assert.equal(refused.reason, 'nonzero-exit')
  assert.equal(refused.code, 1)
  assert.equal(refused.stderr, 'no workspace')

  // A `bd` that could not be started keeps the OS code that says why.
  const spawnError = new Error('spawn bd ENOENT')
  spawnError.code = 'ENOENT'
  spawnError.errno = -4058
  const missing = await beads.probeBeads({ runner: runnerFailing(spawnError), cache: false })
  assert.equal(missing.available, false)
  assert.equal(missing.reason, 'spawn-failed')
  assert.equal(missing.code, 'ENOENT')
  assert.equal(missing.errno, -4058)

  // No installation at all is its own reason, and it carries the fix.
  const notFound = await beads.probeBeads({
    runner: runnerFailing(new beads.BeadsLaunchRefusal('dsh-mywork: cannot locate the bd JavaScript entry')),
    cache: false,
  })
  assert.equal(notFound.available, false)
  assert.equal(notFound.reason, 'binary-not-found')
  assert.equal(notFound.hint, beads.BEADS_INSTALL_HINT)

  // The sentence an operator reads names the failure that actually happened —
  // and the fix — instead of a cause the probe never observed.
  const text = beads.describeBeadsProbe(missing)
  assert.match(text, /ENOENT/)
  assert.match(text, /-4058/)
  assert.match(text, /npm install -g @beads\/bd/)
  assert.doesNotMatch(text, /EPERM/)
})
