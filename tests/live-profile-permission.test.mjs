/**
 * The live-profile board permission check must fail on the shapes that already
 * cost this project once (R-47), not merely describe them.
 *
 * The regression was a key nested one level too deep plus seven `autoRun*` keys
 * the plugin never reads; both were invisible on every surface that is not
 * restarted, and the profile only recovered because a human noticed the blocked
 * cards. Every rule below therefore has a negative fixture built from the exact
 * text the live profile carried before the fix, and the fixed shape is asserted
 * to produce no findings — a checker that answers "clean" to both would fail
 * here rather than pass a gate.
 *
 * The fixtures are text: this suite reads no profile, no home directory and no
 * filesystem, so it is safe under the repository rule that tests never touch the
 * live `$DSH_HOME`.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BOARD_ROW_ID,
  EXPECTED_SESSION_DEFAULT_PERMISSION,
  inspectBoardRowPermission,
} from '../scripts/lib/profile-permission.mjs'

/** The row as the live profile carries it after the 2026-10-03 fix (R-47). */
const FIXED = `- {
    id: web-ui-task-board,
    config:
      {
        plugin: "@linxin666/dsh-client-ui-task-board",
        sessionDefaultPermission: workspace-write,
        announceToAgent: true
      }
  }
- id: web-ui-pet
  name: "@linxin666/dsh-pet"
  config:
    visible: false
`

/** The same row as it stood before the fix: the key nested, seven dead keys back. */
const REGRESSED = `- {
    id: web-ui-task-board,
    config:
      {
        plugin: "@linxin666/dsh-client-ui-task-board",
        config: { sessionDefaultPermission: workspace-write },
        announceToAgent: true,
        autoRunTodo: true,
        autoRunPaused: true,
        autoRunMaxConcurrent: 1,
        autoRunMaxRetries: 1,
        autoRunStallMinutes: 30,
        autoRunMaxPerHour: 3,
        autoRunMaxPerDay: 0
      }
  }
`

test('the fixed row passes and the regressed row fails on the same predicate', () => {
  const fixed = inspectBoardRowPermission(FIXED)
  assert.equal(fixed.found, true)
  assert.deepEqual(fixed.findings, [])

  const regressed = inspectBoardRowPermission(REGRESSED)
  assert.equal(regressed.found, true)
  assert.equal(regressed.findings.length, 2)
  assert.match(regressed.findings[0], /not a sibling of plugin/)
  assert.match(regressed.findings[1], /autoRunTodo, autoRunPaused, autoRunMaxConcurrent, autoRunMaxRetries/)
  assert.match(regressed.findings[1], /autoRunStallMinutes, autoRunMaxPerHour, autoRunMaxPerDay/)
})

test('a row that never declares the key is a finding, not a pass', () => {
  const withoutKey = FIXED.replace('        sessionDefaultPermission: workspace-write,\n', '')
  const inspected = inspectBoardRowPermission(withoutKey)
  assert.equal(inspected.findings.length, 1)
  assert.match(inspected.findings[0], /declares no sessionDefaultPermission/)
})

test('a key at the right level with the wrong value is a finding', () => {
  const weakened = FIXED.replace('sessionDefaultPermission: workspace-write', 'sessionDefaultPermission: read-only')
  const inspected = inspectBoardRowPermission(weakened)
  assert.deepEqual(inspected.findings, [
    `the ${BOARD_ROW_ID} row declares sessionDefaultPermission "read-only", expected "${EXPECTED_SESSION_DEFAULT_PERMISSION}"`,
  ])
})

test('a nested copy beside a correct sibling is reported, not averaged away', () => {
  const duplicated = FIXED.replace(
    '        sessionDefaultPermission: workspace-write,',
    '        sessionDefaultPermission: workspace-write,\n        config: { sessionDefaultPermission: read-only },',
  )
  const inspected = inspectBoardRowPermission(duplicated)
  assert.equal(inspected.findings.length, 1)
  assert.match(inspected.findings[0], /appears 2 times/)
  assert.match(inspected.findings[0], /only 1 sit beside plugin/)
})

test('a flow-style row carrying plugin and the key on one line passes', () => {
  const flow = '- { id: web-ui-task-board, config: { plugin: "@linxin666/dsh-client-ui-task-board",'
    + ' sessionDefaultPermission: workspace-write, announceToAgent: true } }\n'
  assert.deepEqual(inspectBoardRowPermission(flow).findings, [])
})

test('indentation is the row\'s own, not a fixed number of spaces', () => {
  const narrowed = `- id: web-ui-task-board
  config:
    plugin: "@linxin666/dsh-client-ui-task-board"
    sessionDefaultPermission: workspace-write
    announceToAgent: true
`
  assert.deepEqual(inspectBoardRowPermission(narrowed).findings, [])
})

test('a profile without the row is skipped rather than failed', () => {
  const inspected = inspectBoardRowPermission('- id: ui-theme\n  config:\n    preference: light\n')
  assert.deepEqual(inspected, { found: false, findings: [] })
})

test('a row that declares the key but no plugin cannot be validated and says so', () => {
  const pluginless = `- id: web-ui-task-board
  config:
    sessionDefaultPermission: workspace-write
`
  const inspected = inspectBoardRowPermission(pluginless)
  assert.equal(inspected.found, true)
  assert.equal(inspected.findings.length, 1)
  assert.match(inspected.findings[0], /does not declare plugin/)
})

test('the row id is matched exactly, so a neighbouring row cannot satisfy it', () => {
  const nearMiss = FIXED.replace('id: web-ui-task-board', 'id: web-ui-task-board-legacy')
  assert.deepEqual(inspectBoardRowPermission(nearMiss), { found: false, findings: [] })
  assert.deepEqual(inspectBoardRowPermission(FIXED, { id: 'web-ui-task-board-legacy' }), {
    found: false,
    findings: [],
  })
})
