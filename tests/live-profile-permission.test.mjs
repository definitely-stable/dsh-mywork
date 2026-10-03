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
 * A first revision of the checker decided "beside plugin" from line indentation
 * alone and read comments as structure; the shapes that slipped through
 * (a nested key on one line, a `config` key inside `config`, a commented-out
 * entry) are fixtures here as well, so the hole cannot reopen quietly.
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

/**
 * Findings of an inspection, for terse assertions.
 * @param {string} text - the fixture.
 * @returns {string[]} the findings.
 */
function findingsOf(text) {
  return inspectBoardRowPermission(text).findings
}

test('the fixed row passes and the regressed row fails on the same predicate', () => {
  const fixed = inspectBoardRowPermission(FIXED)
  assert.equal(fixed.found, true)
  assert.deepEqual(fixed.findings, [])

  const regressed = findingsOf(REGRESSED)
  assert.equal(regressed.length, 2)
  assert.ok(
    regressed.some(finding => /is not a direct child of the web-ui-task-board row's config mapping/.test(finding)),
    JSON.stringify(regressed),
  )
  assert.ok(
    regressed.some(finding => finding.includes('autoRunTodo, autoRunPaused, autoRunMaxConcurrent, autoRunMaxRetries')),
    JSON.stringify(regressed),
  )
  assert.ok(
    regressed.some(finding => finding.includes('autoRunStallMinutes, autoRunMaxPerHour, autoRunMaxPerDay')),
    JSON.stringify(regressed),
  )
})

test('a row that never declares the key is a finding, not a pass', () => {
  const withoutKey = FIXED.replace('        sessionDefaultPermission: workspace-write,\n', '')
  const inspected = inspectBoardRowPermission(withoutKey)
  assert.equal(inspected.findings.length, 1)
  assert.match(inspected.findings[0], /declares no sessionDefaultPermission directly in its config/)
})

test('a key at the right level with the wrong value is a finding', () => {
  const weakened = FIXED.replace('sessionDefaultPermission: workspace-write', 'sessionDefaultPermission: read-only')
  assert.deepEqual(findingsOf(weakened), [
    `the ${BOARD_ROW_ID} row declares sessionDefaultPermission "read-only", expected "${EXPECTED_SESSION_DEFAULT_PERMISSION}"`,
  ])
})

test('a nested copy beside a correct sibling is reported, not averaged away', () => {
  const duplicated = FIXED.replace(
    '        sessionDefaultPermission: workspace-write,',
    '        sessionDefaultPermission: workspace-write,\n        config: { sessionDefaultPermission: read-only },',
  )
  const inspected = findingsOf(duplicated)
  assert.equal(inspected.length, 1)
  assert.match(inspected[0], /also appears 1 time\(s\) outside the web-ui-task-board row's config mapping/)
})

test('a flow-style row carrying plugin and the key on one line passes', () => {
  const flow = '- { id: web-ui-task-board, config: { plugin: "@linxin666/dsh-client-ui-task-board",'
    + ' sessionDefaultPermission: workspace-write, announceToAgent: true } }\n'
  assert.deepEqual(findingsOf(flow), [])
})

test('a compact entry cannot hide the nested key on the plugin line', () => {
  const compact = '- { id: web-ui-task-board, config: { plugin: "@linxin666/dsh-client-ui-task-board",'
    + ' config: { sessionDefaultPermission: workspace-write } } }\n'
  const inspected = findingsOf(compact)
  assert.equal(inspected.length, 1)
  assert.match(inspected[0], /is not a direct child/)
})

test('a nested copy sharing the plugin line is not read as a sibling', () => {
  const shared = `- {
    id: web-ui-task-board,
    config:
      {
        plugin: "@linxin666/dsh-client-ui-task-board", config: { sessionDefaultPermission: workspace-write },
        announceToAgent: true
      }
  }
`
  const inspected = findingsOf(shared)
  assert.equal(inspected.length, 1)
  assert.match(inspected[0], /is not a direct child/)
})

test('a key that is a sibling of the row field, not of plugin, is a finding', () => {
  const besideRow = `- id: web-ui-task-board
  config: { plugin: "@linxin666/dsh-client-ui-task-board" }
  sessionDefaultPermission: workspace-write
`
  const inspected = findingsOf(besideRow)
  assert.equal(inspected.length, 1)
  assert.match(inspected[0], /is not a direct child/)
})

test('a config key inside config cannot stand in for the row config', () => {
  const nestedConfig = `- id: web-ui-task-board
  config:
    config:
      plugin: "@linxin666/dsh-client-ui-task-board"
      sessionDefaultPermission: workspace-write
`
  const inspected = findingsOf(nestedConfig)
  assert.equal(inspected.length, 2)
  assert.match(inspected[0], /is not a direct child of the web-ui-task-board row's config mapping/)
  assert.match(inspected[1], /plugin key is not a direct child/)
})

test('indentation is the row\'s own, not a fixed number of spaces', () => {
  const narrowed = `- id: web-ui-task-board
  config:
    plugin: "@linxin666/dsh-client-ui-task-board"
    sessionDefaultPermission: workspace-write
    announceToAgent: true
`
  assert.deepEqual(findingsOf(narrowed), [])
})

test('a config mapping without plugin is still a legitimate override', () => {
  const override = `- id: web-ui-task-board
  config:
    sessionDefaultPermission: workspace-write
`
  assert.deepEqual(findingsOf(override), [])
})

test('a profile without the row is skipped rather than failed', () => {
  assert.deepEqual(inspectBoardRowPermission('- id: ui-theme\n  config:\n    preference: light\n'), {
    found: false,
    disabled: false,
    findings: [],
  })
})

test('a disabled row is skipped, not failed', () => {
  const disabled = `- id: web-ui-task-board
  disabled: true
`
  assert.deepEqual(inspectBoardRowPermission(disabled), { found: false, disabled: true, findings: [] })
  const spelledOut = disabled.replace('true', 'True')
  assert.deepEqual(inspectBoardRowPermission(spelledOut), { found: false, disabled: true, findings: [] })
})

test('disabled inside the config mapping is the plugin\'s business, not a skip', () => {
  const innerDisabled = `- id: web-ui-task-board
  config:
    plugin: "@linxin666/dsh-client-ui-task-board"
    disabled: true
    sessionDefaultPermission: read-only
`
  const inspected = inspectBoardRowPermission(innerDisabled)
  assert.equal(inspected.found, true)
  assert.equal(inspected.disabled, false)
  assert.deepEqual(inspected.findings, [
    `the ${BOARD_ROW_ID} row declares sessionDefaultPermission "read-only", expected "${EXPECTED_SESSION_DEFAULT_PERMISSION}"`,
  ])
})

test('comments are text: a quoted value, a note naming the key, and a commented-out row', () => {
  const annotated = `# sessionDefaultPermission must stay beside plugin (R-47)
- {
    id: web-ui-task-board,
    config:
      {
        plugin: "@linxin666/dsh-client-ui-task-board",
        sessionDefaultPermission: workspace-write, # keep beside plugin (R-47)
        # note, sessionDefaultPermission: read-only was the broken value
        announceToAgent: true
      }
  }
# - id: web-ui-task-board
#   config: { plugin: "@linxin666/dsh-client-ui-task-board" }
# removed: id: web-ui-task-board
`
  assert.deepEqual(findingsOf(annotated), [])
  assert.equal(inspectBoardRowPermission(annotated).found, true)
})

test('an escaped quote inside a flow scalar does not hide the keys after it', () => {
  const escaped = '- { id: web-ui-task-board, config: { plugin: "@linxin666/dsh-client-ui-task-board",'
    + ' note: "a\\"b", sessionDefaultPermission: workspace-write } }\n'
  assert.deepEqual(findingsOf(escaped), [])
})

test('a quoted key name is the same key', () => {
  const quoted = `- {
    id: web-ui-task-board,
    config:
      {
        plugin: "@linxin666/dsh-client-ui-task-board",
        "sessionDefaultPermission": workspace-write
      }
  }
`
  assert.deepEqual(findingsOf(quoted), [])
})

test('a byte-order mark does not hide the first entry', () => {
  const inspected = inspectBoardRowPermission(`\uFEFF${FIXED}`)
  assert.equal(inspected.found, true)
  assert.deepEqual(inspected.findings, [])
})

test('two direct declarations are reported, since the last one wins', () => {
  const twice = FIXED.replace(
    '        sessionDefaultPermission: workspace-write,',
    '        sessionDefaultPermission: workspace-write,\n        sessionDefaultPermission: workspace-write,',
  )
  const inspected = findingsOf(twice)
  assert.equal(inspected.length, 1)
  assert.match(inspected[0], /is declared 2 times directly/)
})

test('two entries with the same id are reported', () => {
  const duplicatedRow = `${FIXED}- {
    id: web-ui-task-board,
    config:
      {
        plugin: "@linxin666/dsh-client-ui-task-board",
        sessionDefaultPermission: read-only
      }
  }
`
  const inspected = findingsOf(duplicatedRow)
  assert.equal(inspected.length, 2)
  assert.match(inspected[0], /declares 2 entries with id web-ui-task-board/)
  assert.match(inspected[1], /declares sessionDefaultPermission "read-only"/)
})

test('the row id is matched exactly, so a neighbouring row cannot satisfy it', () => {
  const nearMiss = FIXED.replace('id: web-ui-task-board', 'id: web-ui-task-board-legacy')
  assert.deepEqual(inspectBoardRowPermission(nearMiss), { found: false, disabled: false, findings: [] })
  assert.deepEqual(inspectBoardRowPermission(FIXED, { id: 'web-ui-task-board-legacy' }), {
    found: false,
    disabled: false,
    findings: [],
  })
})
