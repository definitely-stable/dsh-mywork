/**
 * `INDEX.md` is a derived artifact: the phase tables must be reproducible from
 * the plan export, and everything a human wrote outside the generated markers
 * must survive a rebuild untouched.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { BEGIN, END, buildIndex, phaseOrder, replaceGenerated, withoutRevision } from '../scripts/ledger-index.mjs'

/** A miniature plan export: two cards in one phase, one superseded card in another. */
const TASKS = [
  { id: 'MW-001', phase: '00-foundation', title: 'Alpha', dependsOn: [], status: 'planned' },
  { id: 'MW-002', phase: '00-foundation', title: 'Beta', dependsOn: ['MW-001'], status: 'planned' },
  { id: 'MW-027', phase: '04-control', title: 'Gamma', dependsOn: ['MW-005'], status: 'superseded', supersededBy: ['MW-042', 'MW-047'] },
]

test('buildIndex stamps the revision and emits exactly one row per card', () => {
  const markdown = buildIndex(TASKS, 325)
  assert.match(markdown, /^lastSyncedRevision: 325$/m)
  const rows = markdown.match(/^\| \[MW-\d{3}\]/gm) ?? []
  assert.equal(rows.length, TASKS.length, 'exactly one row per card')
})

test('buildIndex names successors of a superseded card and dashes empty dependencies', () => {
  const markdown = buildIndex(TASKS, 1)
  assert.match(markdown, /^\| \[MW-027\]\(MW-027\.md\) \| Gamma \| MW-005 \| superseded → MW-042, MW-047 \|$/m)
  assert.match(markdown, /^\| \[MW-001\]\(MW-001\.md\) \| Alpha \| — \| planned \|$/m)
  assert.deepEqual(phaseOrder(TASKS), ['00-foundation', '04-control'])
})

test('replaceGenerated marks the tables once and keeps manual sections outside the markers', () => {
  const original = [
    '# Задачи',
    '',
    'Рукописный вводный абзац.',
    '',
    '## 00-foundation',
    '',
    '| ID | Задача | Зависимости | Статус |',
    '|---|---|---|---|',
    '| [MW-001](MW-001.md) | Alpha | — | planned |',
    '',
    '## Правила приёмки',
    '',
    'Текст правила D19, который генератор не имеет права трогать.',
    '',
  ].join('\n')

  const once = replaceGenerated(original, buildIndex(TASKS, 325))
  assert.ok(once.includes(BEGIN) && once.includes(END), 'both markers appear')
  assert.ok(once.includes('Рукописный вводный абзац.'), 'intro survives')
  assert.ok(once.includes('Текст правила D19, который генератор не имеет права трогать.'), 'manual section survives')
  assert.equal(once.indexOf(BEGIN) < once.indexOf('## Правила приёмки'), true, 'the manual section stays outside the region')

  const twice = replaceGenerated(once, buildIndex(TASKS, 325))
  assert.equal(withoutRevision(twice), withoutRevision(once), 'rebuilding is idempotent')
  assert.equal((twice.match(/<!-- generated:begin -->/g) ?? []).length, 1, 'the region is never nested')
})
