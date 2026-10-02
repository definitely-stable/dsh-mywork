/**
 * The launch seam as `createProcessRunner` uses it (F-14, MW-056).
 *
 * Two things have to hold at this boundary: an injected launch is spawned exactly
 * as given — the interpreter, then the entry, then the command's own arguments as
 * separate `argv` entries and never a command line — and the default runner
 * resolves the seam itself, so Windows uses either a real native `bd.exe` or
 * the npm JavaScript entry — never the unspawnable `.cmd` shim.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test, { after } from 'node:test'

import { beads, repoRoot } from './lib/fixtures.mjs'

/** A temporary directory this suite owns and removes. */
const dir = mkdtempSync(join(tmpdir(), 'dsh-mywork-beads-launch-'))

/** A stand-in entry that reports the argument vector it really received. */
const entry = join(dir, 'echo-entry.mjs')
writeFileSync(
  entry,
  'process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))\n',
)

after(() => rmSync(dir, { recursive: true, force: true }))

/** Whether a real `bd` answers, so the default-path test can skip honestly. */
const probe = await beads.probeBeads()

test('an injected launch is spawned with the interpreter, the entry, and no shell', async () => {
  const runner = beads.createProcessRunner({
    launch: { command: process.execPath, args: [entry], shell: false },
    timeoutMs: 20_000,
  })
  // An argument no shell could pass through intact: spaces, quotes, and cmd.exe
  // metacharacters. Equality below is what proves no shell was involved.
  const tricky = 'a b "c" & d > e'
  const result = await runner.run({ args: ['--title', tricky, '--json'], cwd: repoRoot })

  assert.equal(result.code, 0, result.stderr)
  const seen = JSON.parse(result.stdout)
  assert.deepEqual(seen.argv, ['--title', tricky, '--json'])
  assert.equal(resolve(seen.cwd), resolve(repoRoot))
})

test('the default runner resolves the seam itself and starts a real bd', { skip: !probe.available }, async () => {
  const runner = beads.createProcessRunner({ timeoutMs: 20_000 })
  const result = await runner.run({ args: ['version'], cwd: repoRoot })

  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /^bd version \d+\.\d+\.\d+/)
  // Windows may resolve the official native release or npm's JavaScript entry;
  // both are shell-free, and neither is the .cmd shim.
  if (process.platform === 'win32') {
    const launch = beads.resolveBeadsLaunch()
    assert.equal(launch.shell, false)
    if (launch.args.length === 0) {
      assert.match(launch.command, /bd\.exe$/i)
    } else {
      assert.equal(launch.command, process.execPath)
      assert.match(launch.args[0], /@beads[\\/]bd[\\/].*\.(?:js|mjs|cjs)$/)
    }
  }
})
