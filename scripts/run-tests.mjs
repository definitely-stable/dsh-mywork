#!/usr/bin/env node
/**
 * Run the Node test runner without per-file process isolation on every Node
 * version supported by this workspace.
 *
 * Node 22.8 introduced the option as `--experimental-test-isolation`; Node
 * 23.6 renamed it to `--test-isolation`. The repository supports Node 22, so
 * spelling the newer flag directly makes an otherwise supported runtime refuse
 * to start the suite before a single test executes.
 *
 * Arguments are passed through unchanged after the compatible isolation flag,
 * so callers may provide one test file or the canonical glob.
 */

import { spawnSync } from 'node:child_process'

const [major = 0, minor = 0] = process.versions.node
  .split('.')
  .slice(0, 2)
  .map(part => Number.parseInt(part, 10))

const isolationFlag = major > 23 || (major === 23 && minor >= 6)
  ? '--test-isolation=none'
  : '--experimental-test-isolation=none'

const result = spawnSync(
  process.execPath,
  ['--test', isolationFlag, ...process.argv.slice(2)],
  { stdio: 'inherit', shell: false },
)

if (result.error !== undefined) {
  process.stderr.write(`run-tests: could not start Node: ${result.error.message}\n`)
  process.exitCode = 1
} else {
  process.exitCode = result.status ?? 1
}
