/**
 * `compareLedgers` must report a disagreement instead of throwing, and it must
 * apply acceptance rule D19: a card that is `done` while one of its executions
 * failed is a violation unless a justification names it.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { compareLedgers, humanId, parseIndex } from '../scripts/ledger-sync.mjs'

/** The board is authoritative and stores UUIDs; `MW-0NN` lives in the title. */
const BOARD = {
  revision: 325,
  tasks: [
    {
      id: 'aaaa-1111',
      title: 'MW-001 · Alpha',
      status: 'done',
      executions: [
        { id: 'e1', startedAt: 1, endedAt: 2, result: 'failed', error: 'workspace not found: gone' },
        { id: 'e2', sessionId: 'session-ok', startedAt: 3, endedAt: 4, result: 'succeeded' },
      ],
    },
    {
      id: 'bbbb-2222',
      title: 'MW-002 · Beta',
      status: 'done',
      executions: [{ id: 'e3', sessionId: 'session-ok-2', startedAt: 5, endedAt: 6, result: 'succeeded' }],
    },
    {
      id: 'cccc-3333',
      title: 'MW-003 · Gamma',
      status: 'backlog',
      executions: [],
    },
  ],
}

/** The export disagrees with the board on MW-002 and MW-003. */
const TASKS_JSON = {
  planRevision: 2,
  tasks: [
    { id: 'MW-001', phase: '00-foundation', title: 'Alpha', dependsOn: [], status: 'done' },
    { id: 'MW-002', phase: '00-foundation', title: 'Beta', dependsOn: ['MW-001'], status: 'planned' },
    { id: 'MW-003', phase: '00-foundation', title: 'Gamma', dependsOn: [], status: 'planned' },
  ],
}

const INDEX = [
  '# Задачи',
  '',
  '## 00-foundation',
  '',
  '| ID | Задача | Зависимости | Статус |',
  '|---|---|---|---|',
  '| [MW-001](MW-001.md) | Alpha | — | done |',
  '| [MW-002](MW-002.md) | Beta | MW-001 | done |',
  '| [MW-003](MW-003.md) | Gamma | — | superseded → MW-042 |',
  '',
].join('\n')

test('compareLedgers returns mismatches instead of throwing', () => {
  const report = compareLedgers({ board: BOARD, tasksJson: TASKS_JSON, index: INDEX })
  assert.ok(Array.isArray(report.mismatches), 'mismatches is a list, not an exception')
  const ids = report.mismatches.map(mismatch => mismatch.id)
  assert.deepEqual(ids, ['MW-002', 'MW-003'], 'MW-001 agrees across all three sources')
  const two = report.mismatches.find(mismatch => mismatch.id === 'MW-002')
  assert.equal(two.board, 'done')
  assert.equal(two.tasksJson, 'planned', 'the export still calls a finished card planned')
  assert.equal(two.index, 'done')
  const three = report.mismatches.find(mismatch => mismatch.id === 'MW-003')
  assert.equal(three.board, 'backlog')
  assert.equal(three.index, 'superseded', 'the index arrow is stripped to the bare status')
  assert.equal(humanId('MW-044 · Реализовать workflow engine'), 'MW-044')
  assert.equal(parseIndex(INDEX).get('MW-003'), 'superseded')
})

test('a done card with a failed execution is a doneViolation unless justified', () => {
  const report = compareLedgers({ board: BOARD, tasksJson: TASKS_JSON, index: INDEX })
  assert.equal(report.doneViolations.length, 1, 'MW-001 has a failed execution while done')
  assert.equal(report.doneViolations[0].id, 'MW-001')
  assert.equal(report.doneViolations[0].failedExecutions, 1)
  assert.deepEqual(
    report.doneViolations[0].sessionIds,
    ['(no session — failed before launch)'],
    'a launch failure genuinely has no session id, and that is reported, not hidden',
  )
  assert.equal(report.failedOnDone, 1)
  assert.equal(report.failedOutsideDone, 0)
  assert.deepEqual(report.executions, { total: 3, succeeded: 2, failed: 1 })

  const justified = compareLedgers({
    board: BOARD,
    tasksJson: TASKS_JSON,
    index: INDEX,
    justifications: new Set(['MW-001']),
  })
  assert.equal(justified.doneViolations.length, 0, 'a D19 justification clears the violation')
  assert.deepEqual(justified.justifiedViolations, ['MW-001'])
})
