#!/usr/bin/env node
/**
 * Reconcile the three ledgers and enforce the `done` acceptance rule (D19).
 *
 * Truth rule: the **board** is authoritative (the Host ledger on disk),
 * `.work/tasks/tasks.json` is an export, and `.work/tasks/INDEX.md` is a
 * derived artifact. A disagreement is a defect to report, never a choice to
 * make — so this script reports and exits 0 unless `--strict` is passed.
 *
 * Acceptance rule D19: a card may be `done` only when none of its executions
 * failed, *unless* the report carries a justification line for that card. The
 * justifications are not stored in any ledger, so they are an external input:
 * pass `--justifications <path>` and every `MW-0NN` token in that file counts as
 * justified. Without the flag the raw census is reported, which is what the
 * plan's gate asks for.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root; every path below is addressed from here. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The derived index. */
export const indexPath = join(repoRoot, '.work', 'tasks', 'INDEX.md')

/** The plan export. */
export const tasksPath = join(repoRoot, '.work', 'tasks', 'tasks.json')

/** The evidence file that carries the D19 justification lines. */
export const defaultJustificationsPath = join(repoRoot, '.work', 'plan-v0.3', 'evidence', 'foundation-09-done-failed.md')

/**
 * The Host board ledger location, when this machine has one.
 * @returns {string | undefined} absolute path, or undefined off a user profile.
 */
export function defaultBoardPath() {
  const home = process.env.USERPROFILE ?? process.env.HOME
  return home === undefined ? undefined : join(home, '.dsh', 'task-board', 'ledger-v2.json')
}

/**
 * Pull the human id out of a board title.
 *
 * The board stores UUIDs in `id`; `MW-0NN` lives only in the title prefix, so
 * the title is the join key across the three ledgers.
 * @param {string} title - board card title.
 * @returns {string | undefined} the `MW-0NN` token, or undefined.
 */
export function humanId(title) {
  return /MW-\d{3}/.exec(title ?? '')?.[0]
}

/**
 * Normalise a status cell: the index writes `superseded → MW-042, MW-047`.
 * @param {string} status - raw status text.
 * @returns {string} the bare status word.
 */
export function bareStatus(status) {
  return (status ?? '').split('→')[0].trim()
}

/**
 * Parse the generated rows of `INDEX.md` into `{ id: status }`.
 * @param {string} text - the index document.
 * @returns {Map<string, string>} status by human id.
 */
export function parseIndex(text) {
  const found = new Map()
  for (const line of text.split('\n')) {
    const match = /^\|\s*\[(MW-\d{3})\]\([^)]*\)\s*\|(.*)\|\s*$/.exec(line)
    if (match === null) continue
    const cells = match[2].split('|').map(cell => cell.trim())
    found.set(match[1], bareStatus(cells[cells.length - 1]))
  }
  return found
}

/**
 * Every `MW-0NN` mentioned in a justification document.
 * @param {string} text - the document.
 * @returns {Set<string>} justified ids.
 */
export function parseJustifications(text) {
  return new Set(text.match(/MW-\d{3}/g) ?? [])
}

/**
 * Compare the three ledgers. Pure: it takes parsed documents and returns a
 * report, so a disagreement is data rather than an exception.
 * @param {{ board: object, tasksJson: object, index: string, justifications?: Set<string> }} input
 *   the three parsed sources plus optional justified ids.
 * @returns {{ ids: string[], mismatches: Array<{ id: string, board?: string, tasksJson?: string, index?: string }>, doneViolations: Array<{ id: string, failedExecutions: number, sessionIds: string[] }>, justifiedViolations: string[], executions: { total: number, succeeded: number, failed: number }, failedOnDone: number, failedOutsideDone: number, revision: unknown }}
 *   the reconciliation report.
 */
export function compareLedgers(input) {
  const justifications = input.justifications ?? new Set()
  const boardTasks = input.board?.tasks ?? []
  const planTasks = input.tasksJson?.tasks ?? []
  const indexStatus = parseIndex(input.index ?? '')

  const boardByHumanId = new Map()
  for (const task of boardTasks) {
    const id = humanId(task.title)
    if (id !== undefined) boardByHumanId.set(id, task)
  }
  const planByHumanId = new Map(planTasks.map(task => [task.id, task]))

  const ids = [...new Set([...boardByHumanId.keys(), ...planByHumanId.keys(), ...indexStatus.keys()])].sort()

  const mismatches = []
  for (const id of ids) {
    const board = boardByHumanId.get(id)?.status
    const plan = planByHumanId.get(id)?.status
    const index = indexStatus.get(id)
    const present = [board, plan, index].filter(value => value !== undefined)
    if (present.length > 1 && !present.every(value => value === present[0])) {
      mismatches.push({ id, board, tasksJson: plan, index })
    }
  }

  const doneViolations = []
  const justifiedViolations = []
  let failedOnDone = 0
  let failedOutsideDone = 0
  let total = 0
  let succeeded = 0
  let failed = 0
  for (const task of boardTasks) {
    const id = humanId(task.title) ?? task.id
    const executions = task.executions ?? []
    total += executions.length
    succeeded += executions.filter(execution => execution.result === 'succeeded').length
    const failures = executions.filter(execution => execution.result === 'failed')
    failed += failures.length
    if (task.status !== 'done') {
      failedOutsideDone += failures.length
      continue
    }
    failedOnDone += failures.length
    if (failures.length === 0) continue
    const entry = {
      id,
      failedExecutions: failures.length,
      // A launch failure never created a session, so the id is genuinely absent.
      sessionIds: failures.map(failure => failure.sessionId ?? '(no session — failed before launch)'),
    }
    if (justifications.has(id)) justifiedViolations.push(id)
    else doneViolations.push(entry)
  }

  return {
    ids,
    mismatches,
    doneViolations,
    justifiedViolations,
    executions: { total, succeeded, failed },
    failedOnDone,
    failedOutsideDone,
    revision: input.board?.revision,
  }
}

/**
 * Read and parse a JSON document.
 * @param {string} path - file path.
 * @returns {object} the parsed document.
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Render the report a human reads.
 * @param {ReturnType<typeof compareLedgers>} report - the reconciliation report.
 * @param {{ boardPath?: string, justified: boolean }} meta - where the board came from.
 * @returns {string} the printable report.
 */
export function formatReport(report, meta) {
  const lines = [
    'ledger-sync: board (authority) vs tasks.json (export) vs INDEX.md (derived)',
    `  board source: ${meta.boardPath ?? '(unavailable)'}`,
    `  board revision: ${String(report.revision)}`,
    `  cards compared: ${report.ids.length}`,
    `  executions: ${report.executions.total} total = ${report.executions.succeeded} succeeded + ${report.executions.failed} failed`,
    `  status mismatches: ${report.mismatches.length}`,
    // Worth stating plainly: a 55/55 mismatch is not 55 defects. The board is an
    // execution ledger (backlog/done/failed) and tasks.json is a plan export
    // (planned/superseded), so the two status vocabularies can never be equal —
    // the agreement that matters is which cards are closed, which is exactly
    // what doneViolations measures.
    ...(report.mismatches.length === report.ids.length && report.ids.length > 0
      ? [
          '    note: every card differs, because the two ledgers speak different vocabularies —',
          '          the board tracks execution (backlog/done/failed) and tasks.json tracks',
          '          planning (planned/superseded). Read doneViolations for closure agreement.',
        ]
      : []),
  ]
  for (const mismatch of report.mismatches) {
    lines.push(`    ${mismatch.id}: board=${String(mismatch.board)} tasks.json=${String(mismatch.tasksJson)} index=${String(mismatch.index)}`)
  }
  lines.push(`  doneViolations: ${report.doneViolations.length}`)
  for (const violation of report.doneViolations) {
    lines.push(`    ${violation.id}: ${violation.failedExecutions} failed execution(s) — ${violation.sessionIds.join(', ')}`)
  }
  if (meta.justified) {
    lines.push(`  justified (D19 line present): ${report.justifiedViolations.length} — ${report.justifiedViolations.join(', ') || '(none)'}`)
  }
  lines.push(
    `  failed executions on done cards: ${report.failedOnDone}; outside done cards: ${report.failedOutsideDone}`,
    '  note: FINAL-REPORT §8.2 P9 states "9 failed executions on done cards".',
    `        The board says ${report.failedOnDone}. 9 matches neither that nor the whole-ledger`,
    `        tally of ${report.executions.failed}, so the report's figure is refuted, not differently counted.`,
  )
  return lines.join('\n')
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const argv = process.argv.slice(2)
  const flag = name => {
    const inline = argv.find(argument => argument.startsWith(`--${name}=`))
    if (inline !== undefined) return inline.slice(name.length + 3)
    const index = argv.indexOf(`--${name}`)
    return index === -1 ? undefined : argv[index + 1]
  }
  const boardPath = flag('board') ?? defaultBoardPath()
  if (boardPath === undefined || !existsSync(boardPath)) {
    console.error('ledger-sync: no board ledger found; pass --board <path> (the Host ledger is authoritative)')
    process.exit(2)
  }
  const justificationsArg = flag('justifications')
  const justifications = justificationsArg !== undefined && existsSync(justificationsArg)
    ? parseJustifications(readFileSync(justificationsArg, 'utf8'))
    : new Set()
  const report = compareLedgers({
    board: readJson(boardPath),
    tasksJson: readJson(flag('tasks') ?? tasksPath),
    index: readFileSync(flag('index') ?? indexPath, 'utf8'),
    justifications,
  })
  console.log(formatReport(report, { boardPath, justified: justifications.size > 0 }))
  if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
  // A mismatch is a finding; only --strict turns it into a failure, so this can
  // be wired into CI once the three ledgers are actually expected to agree.
  if (argv.includes('--strict') && (report.mismatches.length > 0 || report.doneViolations.length > 0)) process.exit(1)
  process.exit(0)
}
