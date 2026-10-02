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

// Capture the caller's harness home before any test module can repoint DSH_HOME.
// With isolation=none every suite shares one process and therefore one process.env;
// controller suites deliberately point DSH_HOME at a scratch directory. Guards
// that prove the real profile stayed untouched need the value from *before* that
// mutation, not whichever scratch value happens to be visible when their module
// is evaluated. Preserve an existing capture so nested invocations cannot move it.
const ORIGINAL_DSH_HOME_ENV = 'MYWORK_TEST_ORIGINAL_DSH_HOME'
const originalDshHome = process.env[ORIGINAL_DSH_HOME_ENV] ?? process.env.DSH_HOME ?? ''
const env = { ...process.env, [ORIGINAL_DSH_HOME_ENV]: originalDshHome }

const result = spawnSync(
  process.execPath,
  ['--test', isolationFlag, ...process.argv.slice(2)],
  { stdio: 'inherit', shell: false, env },
)

if (result.error !== undefined) {
  process.stderr.write(`run-tests: could not start Node: ${result.error.message}\n`)
  process.exitCode = 1
} else {
  process.exitCode = result.status ?? 1
}
