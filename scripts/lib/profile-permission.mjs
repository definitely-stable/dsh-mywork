/**
 * Live-profile permission check for the task board row (R-47 / R-51).
 *
 * Why this exists: the board plugin reads `sessionDefaultPermission` from the
 * top level of its own row config. The aggregate shell drops the `plugin` key
 * and hands the row's remaining keys to the plugin, so a value nested one level
 * deeper (`config.config.sessionDefaultPermission`) never reaches it: the
 * platform default `read-only` applies and every card pinned above it needs a
 * human confirmation. The live profile lost that fix once already (R-47 — the
 * key was re-nested and seven `autoRun*` keys the plugin never reads came back),
 * and the regression is invisible on any surface that is not restarted. The
 * shape is therefore asserted here, where it fails a gate instead of waiting to
 * be noticed by a blocked run.
 *
 * The check is lexical on purpose: the workspace declares no YAML dependency,
 * and what it protects is the key layout of one row, not YAML documents in
 * general. It is paired with negative fixtures in
 * `tests/live-profile-permission.test.mjs`, so a rule that stops biting fails
 * the suite rather than passing silently.
 */

/** Row id of the board plugin in the profile patch layer. */
export const BOARD_ROW_ID = 'web-ui-task-board'

/** The permission this deployment expects its board cards to run under. */
export const EXPECTED_SESSION_DEFAULT_PERMISSION = 'workspace-write'

/**
 * Keys the board plugin versions in use never read. They were copied into the
 * profile as protection against runaway runs that never existed, and their
 * presence is a claim about a safeguard that is not there.
 */
const DEAD_KEY_PATTERN = /\b(autoRun[A-Za-z]*)\s*:/g

/** Escape a literal for use inside a regular expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Split a profile patch file into its top-level entries.
 *
 * The loader's own writer emits every entry starting with `- ` in column zero —
 * that is what distinguishes an entry boundary from the nested keys inside it.
 * @param {string} text - the patch file contents.
 * @returns {string[]} one block of text per entry.
 */
function entryBlocks(text) {
  const blocks = []
  let current
  for (const line of text.split(/\r?\n/)) {
    if (/^-(?:\s|$)/.test(line)) {
      if (current !== undefined) blocks.push(current.join('\n'))
      current = [line]
      continue
    }
    if (current !== undefined) current.push(line)
  }
  if (current !== undefined) blocks.push(current.join('\n'))
  return blocks
}

/**
 * Find the entry block that declares a row id, in either the block or the flow
 * style the loader accepts.
 * @param {string} text - the patch file contents.
 * @param {string} id - the row id to find.
 * @returns {string | undefined} the entry's text, or undefined when absent.
 */
function blockFor(text, id) {
  const pattern = new RegExp(`(^|[\\s{,])id:\\s*['"]?${escapeRegExp(id)}['"]?\\s*(,|$)`, 'm')
  return entryBlocks(text).find(block => pattern.test(block))
}

/**
 * Reduce a YAML scalar as written on one line to its bare value.
 * @param {string} raw - the text after the `key:` on that line.
 * @returns {string} the value without trailing mapping punctuation or quotes.
 */
function scalarValue(raw) {
  return raw
    .replace(/[,}\]]+\s*$/, '')
    .trim()
    .replace(/^['"]/, '')
    .replace(/['"]$/, '')
}

/**
 * Inspect the board row's permission wiring in a profile patch layer.
 *
 * Findings are empty when the row is absent: a profile that does not install the
 * board is a legitimate configuration, and the caller reports the skip. When the
 * row is present, the rules are:
 *
 *   1. `sessionDefaultPermission` must appear exactly once in the entry;
 *   2. it must be a sibling of `plugin` — on its own line at the same
 *      indentation, or inside the same flow mapping;
 *   3. its value must be the expected permission;
 *   4. no `autoRun*` key may appear, since no plugin version reads one.
 *
 * @param {string} text - the profile patch file contents.
 * @param {{ id?: string, expected?: string }} [options] - row id and expected permission.
 * @returns {{ found: boolean, findings: string[] }} whether the row exists and what is wrong with it.
 */
export function inspectBoardRowPermission(text, options = {}) {
  const id = options.id ?? BOARD_ROW_ID
  const expected = options.expected ?? EXPECTED_SESSION_DEFAULT_PERMISSION
  const block = blockFor(text, id)
  if (block === undefined) return { found: false, findings: [] }

  const findings = []
  const lines = block.split('\n')
  const keyPattern = /^(\s*)sessionDefaultPermission\s*:\s*(.*)$/
  const occurrences = block.split('sessionDefaultPermission').length - 1
  const keyLines = []
  for (const line of lines) {
    const key = keyPattern.exec(line)
    if (key !== null) keyLines.push({ indent: key[1].length, value: scalarValue(key[2]) })
  }

  // The shell hands the plugin every key of the row config except `plugin`, so a
  // key is "beside plugin" either on the plugin line itself (flow mapping) or on
  // a line indented exactly like the `plugin:` key (block mapping).
  const pluginIndex = lines.findIndex(line => /(^|[\s{,])plugin\s*:/.test(line))
  let sibling
  let covered = 0
  if (pluginIndex === -1) {
    findings.push(
      `the ${id} row does not declare plugin, so this check cannot tell which keys the shell hands to the plugin`,
    )
  } else {
    const pluginLine = lines[pluginIndex]
    const inline = /sessionDefaultPermission\s*:\s*([^,}]*)/.exec(pluginLine)
    if (inline !== null) {
      sibling = scalarValue(inline[1])
      covered = 1
    } else {
      const indent = /^(\s*)/.exec(pluginLine)[1].length
      const beside = keyLines.filter(entry => entry.indent === indent)
      covered = beside.length
      sibling = beside[0]?.value
    }
  }

  if (occurrences === 0) {
    findings.push(`the ${id} row declares no sessionDefaultPermission (expected ${expected} beside plugin)`)
  } else if (sibling === undefined && pluginIndex !== -1) {
    findings.push(
      `sessionDefaultPermission is not a sibling of plugin in the ${id} row: the aggregate shell hands the`
      + ' plugin every key of the row config except plugin, so a nested value never reaches it',
    )
  } else if (sibling !== undefined && sibling !== expected) {
    findings.push(`the ${id} row declares sessionDefaultPermission "${sibling}", expected "${expected}"`)
  }

  // A sibling the plugin reads plus a nested copy it ignores is the shape worth
  // naming: the row looks configured while the effective value is the ignored
  // one. Two nested copies and no sibling is already reported above.
  if (covered > 0 && occurrences > covered) {
    findings.push(
      `sessionDefaultPermission appears ${String(occurrences)} times in the ${id} row while only ${String(covered)}`
      + ' sit beside plugin: the nested copy is the one the plugin ignores (R-47)',
    )
  }

  const dead = [...new Set([...block.matchAll(DEAD_KEY_PATTERN)].map(match => match[1]))]
  if (dead.length > 0) {
    findings.push(`the ${id} row carries keys no plugin version reads: ${dead.join(', ')} (R-47)`)
  }

  return { found: true, findings }
}
