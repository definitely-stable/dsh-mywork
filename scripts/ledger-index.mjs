#!/usr/bin/env node
/**
 * Rebuild the generated part of `.work/tasks/INDEX.md` from `tasks.json`.
 *
 * The index used to be hand-written, so "does the index agree with the plan?"
 * could only be answered by reading both. It is now a *derived* artifact: the
 * per-phase tables live between `<!-- generated:begin -->` and
 * `<!-- generated:end -->` and are reproducible with this script, while every
 * manual section outside the markers is preserved byte for byte.
 *
 * `lastSyncedRevision` records the ledger revision the tables were built from.
 * Resolution order: `--revision`, then the Host board ledger when it is
 * readable, then `planRevision` from `tasks.json`. The revision stamp is
 * metadata, so `--check` compares the table body and reports a revision
 * mismatch separately instead of failing: a checkout without a Host ledger
 * (CI, a fresh clone) must not be reported as a broken index.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root; every path below is addressed from here. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Derived artifact this script owns. */
export const indexPath = join(repoRoot, '.work', 'tasks', 'INDEX.md')

/** The plan export the tables are generated from. */
export const tasksPath = join(repoRoot, '.work', 'tasks', 'tasks.json')

/** Marker opening the generated region. */
export const BEGIN = '<!-- generated:begin -->'

/** Marker closing the generated region. */
export const END = '<!-- generated:end -->'

/**
 * Phases in lexicographic order, which keeps `01b-board` beside `01-runtime`
 * and `04b-board` beside `04-control` instead of inventing an ordering.
 * @param {Array<{ phase?: string }>} tasks - plan cards.
 * @returns {string[]} distinct phase names, sorted.
 */
export function phaseOrder(tasks) {
  const seen = []
  for (const task of tasks) {
    const phase = task.phase ?? 'unphased'
    if (!seen.includes(phase)) seen.push(phase)
  }
  return seen.sort()
}

/**
 * The status cell for one card: a superseded card names its successors.
 * @param {{ status?: string, supersededBy?: string[] }} task - plan card.
 * @returns {string} the cell text.
 */
function statusCell(task) {
  const status = task.status ?? 'unknown'
  const successors = task.supersededBy ?? []
  return status === 'superseded' && successors.length > 0 ? `superseded → ${successors.join(', ')}` : status
}

/**
 * Render the generated region for a plan export.
 * @param {Array<{ id: string, phase?: string, title: string, dependsOn?: string[], status?: string, supersededBy?: string[] }>} tasks
 *   plan cards, in plan order.
 * @param {string | number} [revision] - the ledger revision the tables were built from.
 * @returns {string} the markdown block, markers excluded.
 */
export function buildIndex(tasks, revision = 'unknown') {
  const lines = [`lastSyncedRevision: ${String(revision)}`, '']
  for (const phase of phaseOrder(tasks)) {
    const inPhase = tasks.filter(task => (task.phase ?? 'unphased') === phase)
    lines.push(`## ${phase}`, '', '| ID | Задача | Зависимости | Статус |', '|---|---|---|---|')
    for (const task of inPhase) {
      const dependsOn = (task.dependsOn ?? []).join(', ')
      lines.push(`| [${task.id}](${task.id}.md) | ${task.title} | ${dependsOn === '' ? '—' : dependsOn} | ${statusCell(task)} |`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/**
 * Replace the marked region of an index document, or wrap the existing tables
 * in markers when this document has never been generated before.
 * @param {string} text - the current index document.
 * @param {string} block - the freshly generated block.
 * @returns {string} the new document.
 * @throws {Error} when exactly one marker is present, or no table area exists.
 */
export function replaceGenerated(text, block) {
  // One canonical shape for both paths, so migrating an unmarked document and
  // rebuilding a marked one produce byte-identical output on the first run.
  const marked = `${BEGIN}\n${block}\n${END}`
  const hasBegin = text.includes(BEGIN)
  const hasEnd = text.includes(END)
  if (hasBegin !== hasEnd) throw new Error('ledger-index: exactly one of the generated markers is present')
  if (hasBegin) {
    const start = text.indexOf(BEGIN)
    const stop = text.indexOf(END) + END.length
    return `${text.slice(0, start).trimEnd()}\n${marked}\n${text.slice(stop).trimStart()}`
  }
  // First migration: the tables sit between the intro and the first manual
  // section that is not a phase table.
  const lines = text.split('\n')
  const start = lines.findIndex(line => /^## /.test(line) && !/^## (Что изменилось|Правила приёмки|Критический путь)/.test(line))
  if (start === -1) throw new Error('ledger-index: cannot find the phase-table area to mark')
  let stop = lines.length - 1
  for (let index = lines.length - 1; index > start; index -= 1) {
    if (/^\| \[MW-\d{3}\]/.test(lines[index])) { stop = index; break }
  }
  const head = lines.slice(0, start).join('\n').trimEnd()
  const tail = lines.slice(stop + 1).join('\n').trim()
  return `${head}\n${marked}\n${tail}\n`
}

/**
 * Resolve the revision recorded in the index.
 * @param {{ revision?: string, boardPath?: string, planRevision?: number }} options - explicit value, ledger path, fallback.
 * @returns {string | number} the revision to stamp.
 */
export function resolveRevision(options = {}) {
  if (options.revision !== undefined) return options.revision
  const boardPath = options.boardPath ?? defaultBoardPath()
  if (boardPath !== undefined && existsSync(boardPath)) {
    try {
      const board = JSON.parse(readFileSync(boardPath, 'utf8'))
      if (board.revision !== undefined) return board.revision
    } catch {
      // A corrupt ledger must not stop the index from being rebuilt.
    }
  }
  return options.planRevision ?? 'unknown'
}

/**
 * The Host board ledger location, when this machine has one.
 * @returns {string | undefined} absolute path, or undefined off a user profile.
 */
export function defaultBoardPath() {
  const home = process.env.USERPROFILE ?? process.env.HOME
  return home === undefined ? undefined : join(home, '.dsh', 'task-board', 'ledger-v2.json')
}

/**
 * Read the plan export.
 * @param {string} [path] - override for the export location.
 * @returns {object} the parsed export.
 */
export function readTasks(path = tasksPath) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * The generated block currently on disk, without markers.
 * @param {string} text - the index document.
 * @returns {string | undefined} the block, or undefined when unmarked.
 */
export function currentBlock(text) {
  const start = text.indexOf(BEGIN)
  const stop = text.indexOf(END)
  if (start === -1 || stop === -1) return undefined
  return text.slice(start + BEGIN.length, stop).trim()
}

/**
 * Drop the revision stamp so two blocks can be compared on content alone.
 * @param {string} block - a generated block.
 * @returns {string} the block without its `lastSyncedRevision` line.
 */
export function withoutRevision(block) {
  return block.split('\n').filter(line => !line.startsWith('lastSyncedRevision:')).join('\n').trim()
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
  const check = argv.includes('--check')
  const exportPath = flag('tasks') ?? tasksPath
  const plan = readTasks(exportPath)
  const revision = resolveRevision({ revision: flag('revision'), boardPath: flag('board'), planRevision: plan.planRevision })
  const block = buildIndex(plan.tasks, revision)
  const text = readFileSync(indexPath, 'utf8')
  if (check) {
    const onDisk = currentBlock(text)
    if (onDisk === undefined) {
      console.error('ledger-index: --check failed — INDEX.md has no generated markers')
      process.exit(1)
    }
    const expected = block.trim()
    if (withoutRevision(onDisk) !== withoutRevision(expected)) {
      console.error('ledger-index: --check failed — the generated tables differ from tasks.json')
      console.error(`  cards in file: ${(onDisk.match(/^\| \[MW-\d{3}\]/gm) ?? []).length}, cards expected: ${(expected.match(/^\| \[MW-\d{3}\]/gm) ?? []).length}`)
      process.exit(1)
    }
    const stamped = onDisk.split('\n').find(line => line.startsWith('lastSyncedRevision:'))?.slice('lastSyncedRevision:'.length).trim()
    console.log(`ledger-index: --check OK (${(expected.match(/^\| \[MW-\d{3}\]/gm) ?? []).length} cards)`)
    if (stamped !== String(revision)) {
      console.log(`ledger-index: note — index was built at revision ${String(stamped)}, live revision is ${String(revision)}; rebuild to refresh the stamp`)
    }
    process.exit(0)
  }
  const next = replaceGenerated(text, block)
  if (next === text) {
    console.log('ledger-index: INDEX.md already up to date')
  } else {
    writeFileSync(indexPath, next, 'utf8')
    console.log(`ledger-index: rebuilt INDEX.md at revision ${String(revision)}`)
  }
}
