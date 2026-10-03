/**
 * Live-profile permission check for the task board row (R-47 / R-51).
 *
 * Why this exists: the board plugin reads `sessionDefaultPermission` from the
 * top level of its own row config — the aggregate shell hands the plugin every
 * key of the row's `config` field except `plugin`. A value nested one level
 * deeper never reaches it, so the platform default `read-only` applies and every
 * card pinned above it needs a human confirmation. The live profile lost that fix
 * once already (R-47: the key was re-nested and seven `autoRun*` keys the plugin
 * never reads came back), and the regression is invisible on any surface that is
 * not restarted. The shape is therefore asserted here, where it fails a gate
 * instead of waiting to be noticed by a blocked run.
 *
 * The rule is structural, not textual. The loader accepts a row as a block
 * mapping or as a flow mapping laid out over one or more lines, and the two
 * layouts put a *nested* key at the same indentation as a direct one
 * (`config: { plugin: p }` beside `sessionDefaultPermission: x`, or a `config`
 * key inside `config`). This module therefore walks the entry and builds the path
 * of enclosing keys for every key it sees, and accepts `sessionDefaultPermission`
 * only when its path is exactly the row's `config` field.
 *
 * It is paired with negative fixtures in `tests/live-profile-permission.test.mjs`,
 * including the shapes an earlier revision passed by mistake, so a rule that
 * stops biting fails the suite rather than passing silently.
 *
 * A bare key on the entry — outside `config` — cannot stand in for the real
 * thing: the loader copies such a key onto the row object rather than into
 * `config`, and mounting hands the plugin only `config`. That was measured on an
 * isolated probe profile (2026-10-03, `--dump-config`, exit 0, no warning), so a
 * finding here is not a false positive for a "bare override" row.
 */

/** Row id of the board plugin in the profile patch layer. */
export const BOARD_ROW_ID = 'web-ui-task-board'

/** The permission this deployment expects its board cards to run under. */
export const EXPECTED_SESSION_DEFAULT_PERMISSION = 'workspace-write'

/** Row field the loader hands to the plugin as its config. */
const ROW_CONFIG_FIELD = 'config'

/** A key name: quoted or bare, followed by a mapping colon. */
const KEY_PATTERN = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.-]*))\s*:(?=\s|$)/

/** Keys the board plugin versions in use never read. */
const DEAD_KEY_PATTERN = /^autoRun/

/** Escape a literal for use inside a regular expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Drop a byte-order mark and every unquoted `#` comment.
 *
 * Comments are text, not structure: a note that names the key, or quotes the
 * value, must not be read as a second declaration. Quoted `#` characters stay.
 * @param {string} text - the patch file contents.
 * @returns {string[]} the lines without comments.
 */
function withoutComments(text) {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => {
    let kept = ''
    let quote
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]
      if (quote !== undefined) {
        // A backslash escapes the next character inside a double-quoted scalar,
        // so an escaped quote must not be read as the end of it.
        if (quote === '"' && character === '\\') {
          kept += character + (line[index + 1] ?? '')
          index += 1
          continue
        }
        kept += character
        if (character === quote) quote = undefined
        continue
      }
      if (character === '"' || character === "'") {
        quote = character
        kept += character
        continue
      }
      if (character === '#') break
      kept += character
    }
    return kept
  })
}

/**
 * Split a patch layer into its top-level entries.
 *
 * The loader's own writer emits every entry starting with `- ` in column zero,
 * which is what distinguishes an entry boundary from the keys nested inside it.
 * @param {string[]} lines - the comment-free lines.
 * @returns {string[][]} one list of lines per entry.
 */
function entryBlocks(lines) {
  const blocks = []
  let current
  for (const line of lines) {
    if (/^-(?:\s|$)/.test(line)) {
      if (current !== undefined) blocks.push(current)
      current = [line]
      continue
    }
    if (current !== undefined) current.push(line)
  }
  if (current !== undefined) blocks.push(current)
  return blocks
}

/**
 * Whether an entry declares a row id.
 * @param {string[]} entry - the entry's lines.
 * @param {string} id - the row id to look for.
 * @returns {boolean} true when the id is declared.
 */
function declaresId(entry, id) {
  const pattern = new RegExp(`(^|[\\s{,])id\\s*:\\s*['"]?${escapeRegExp(id)}['"]?\\s*(,|$)`)
  return entry.some(line => pattern.test(line))
}

/**
 * Reduce a YAML scalar written on one line to its bare value.
 * A quoted scalar ends at its closing quote, an unquoted one at the first
 * separator, and a mapping or sequence is not a scalar at all.
 * @param {string} raw - the text after the `key:` on that line.
 * @returns {string | undefined} the value, or undefined when a container follows.
 */
function scalarValue(raw) {
  const text = raw.trim()
  if (text === '') return undefined
  const quoted = /^"([^"]*)"|^'([^']*)'/.exec(text)
  if (quoted !== null) return quoted[1] ?? quoted[2]
  if (text.startsWith('{') || text.startsWith('[')) return undefined
  const cut = text.search(/[,}\]]/)
  const value = (cut === -1 ? text : text.slice(0, cut)).trim()
  return value === '' ? undefined : value
}

/**
 * Every key occurrence in one entry, with the path of enclosing keys.
 *
 * A block mapping tracks indentation (`config:` opens a mapping whose keys are
 * indented deeper), a flow mapping tracks brackets, and a container opened by a
 * key extends that key's path for everything inside it. Indentation alone is not
 * enough: `config:` inside `config:` puts its children at the same indentation as
 * the outer mapping's children in some layouts, and the two are not equivalent
 * for the plugin.
 *
 * @param {string[]} entry - the entry's comment-free lines.
 * @returns {{ key: string, path: string[], value: string | undefined }[]} the occurrences.
 */
function keyOccurrences(entry) {
  const occurrences = []
  /** Block mappings currently open, by indentation. */
  const blocks = []
  /** Flow containers currently open, each carrying the path of its keys. */
  const flows = []
  /** Key whose value has not been read yet, for the container that follows it. */
  let pending
  const currentPath = () => (flows.length > 0 ? flows[flows.length - 1].path : blocks.map(open => open.key))

  for (const line of entry) {
    if (line.trim() === '') continue
    const inFlow = flows.length > 0
    const indent = line.length - line.trimStart().length
    if (!inFlow) {
      while (blocks.length > 0 && indent <= blocks[blocks.length - 1].indent) blocks.pop()
    }
    const content = line.slice(indent)
    let quote
    let keyAllowed = true
    let index = 0
    while (index < content.length) {
      const rest = content.slice(index)
      // A key is looked for only where a key may start — at the beginning of the
      // content, after a flow separator, or after a sequence dash — and only
      // outside a quoted scalar, whose contents are data rather than structure.
      // A quoted key opens with the same character as a quoted scalar, so the
      // pattern is tried first and decides which one this is.
      if (keyAllowed && quote === undefined) {
        const spaced = /^\s+/.exec(rest)
        if (spaced !== null) {
          index += spaced[0].length
          continue
        }
        const match = KEY_PATTERN.exec(rest)
        if (match !== null) {
          const key = match[1] ?? match[2] ?? match[3]
          const value = scalarValue(rest.slice(match[0].length))
          occurrences.push({ key, path: currentPath(), value })
          if (!inFlow && rest.slice(match[0].length).trim() === '') {
            // A block mapping follows: its keys are deeper-indented, so the key
            // enters the path now and leaves it when a sibling appears.
            blocks.push({ indent, key })
            pending = undefined
          } else {
            pending = key
          }
          index += match[0].length
          keyAllowed = false
          continue
        }
        if (/^-\s/.test(rest)) {
          index += 2
          continue
        }
      }
      const character = content[index]
      if (quote !== undefined) {
        if (quote === '"' && character === '\\') {
          index += 2
          continue
        }
        if (character === quote) quote = undefined
        index += 1
        continue
      }
      if (character === '"' || character === "'") {
        quote = character
        index += 1
        continue
      }
      if (character === '{' || character === '[') {
        flows.push({ path: pending === undefined ? currentPath() : [...currentPath(), pending] })
        pending = undefined
        keyAllowed = true
        index += 1
        continue
      }
      if (character === '}' || character === ']') {
        flows.pop()
        pending = undefined
        keyAllowed = false
        index += 1
        continue
      }
      if (character === ',') {
        pending = undefined
        keyAllowed = true
        index += 1
        continue
      }
      keyAllowed = false
      index += 1
    }
  }
  return occurrences
}

/**
 * Whether a key path is the row's own config mapping.
 * @param {string[]} path - the path of enclosing keys.
 * @returns {boolean} true when the key sits directly in the row's `config` value.
 */
function isRowConfigPath(path) {
  return path.length === 1 && path[0] === ROW_CONFIG_FIELD
}

/**
 * Inspect the board row's permission wiring in a profile patch layer.
 *
 * Findings are empty when the row is absent — a profile that does not install the
 * board is a legitimate configuration, and the caller reports the skip. When the
 * row is present (and not disabled), the rules are:
 *
 *   1. `sessionDefaultPermission` must appear exactly once as a direct child of
 *      the row's `config` mapping — the only place the plugin reads it;
 *   2. its value must be the expected permission;
 *   3. `plugin`, when declared, must sit in that same mapping — otherwise the
 *      keys the shell hands to the plugin are not the keys checked here;
 *   4. no `autoRun*` key may appear, since no plugin version reads one.
 *
 * @param {string} text - the profile patch file contents.
 * @param {{ id?: string, expected?: string }} [options] - row id and expected permission.
 * @returns {{ found: boolean, disabled: boolean, findings: string[] }} whether the row exists, whether it is disabled, and what is wrong with it.
 */
export function inspectBoardRowPermission(text, options = {}) {
  const id = options.id ?? BOARD_ROW_ID
  const expected = options.expected ?? EXPECTED_SESSION_DEFAULT_PERMISSION
  const entries = entryBlocks(withoutComments(text)).filter(entry => declaresId(entry, id))
  if (entries.length === 0) return { found: false, disabled: false, findings: [] }

  const findings = []
  if (entries.length > 1) {
    findings.push(`the profile declares ${String(entries.length)} entries with id ${id}; only one row can win`)
  }

  for (const entry of entries) {
    const occurrences = keyOccurrences(entry)
    const named = key => occurrences.filter(occurrence => occurrence.key === key)
    // `disabled` counts only as a field of the row itself: a `disabled` key inside
    // the plugin's config is that plugin's business, and skipping the check for it
    // would hide a row that mounts with a read-only default.
    const disabled = named('disabled').some(
      occurrence => occurrence.path.length === 0 && /^true$/i.test(occurrence.value ?? ''),
    )
    if (disabled) return { found: false, disabled: true, findings: [] }

    const dead = [...new Set(occurrences.filter(o => DEAD_KEY_PATTERN.test(o.key)).map(o => o.key))]
    if (dead.length > 0) {
      findings.push(`the ${id} row carries keys no plugin version reads: ${dead.join(', ')} (R-47)`)
    }

    const declarations = named('sessionDefaultPermission')
    const inside = declarations.filter(occurrence => isRowConfigPath(occurrence.path))
    const stray = declarations.filter(occurrence => !isRowConfigPath(occurrence.path))
    if (declarations.length === 0) {
      findings.push(
        `the ${id} row declares no sessionDefaultPermission directly in its config (expected ${expected})`,
      )
    } else if (inside.length === 0) {
      findings.push(
        `sessionDefaultPermission is not a direct child of the ${id} row's config mapping: the shell hands the`
        + ' plugin every key of that mapping except plugin, so a nested value never reaches it',
      )
    } else {
      if (inside.length > 1) {
        findings.push(
          `sessionDefaultPermission is declared ${String(inside.length)} times directly in the ${id} row's config;`
          + ' the last one wins',
        )
      }
      for (const occurrence of inside) {
        if (occurrence.value !== expected) {
          findings.push(`the ${id} row declares sessionDefaultPermission "${String(occurrence.value)}", expected "${expected}"`)
        }
      }
    }
    if (stray.length > 0 && inside.length > 0) {
      findings.push(
        `sessionDefaultPermission also appears ${String(stray.length)} time(s) outside the ${id} row's config mapping,`
        + ' where the plugin does not read it (R-47)',
      )
    }

    const plugins = named('plugin')
    if (plugins.length > 0 && !plugins.some(occurrence => isRowConfigPath(occurrence.path))) {
      findings.push(
        `the ${id} row's plugin key is not a direct child of its config mapping, so the config checked here is not`
        + ' the config the shell hands to the plugin',
      )
    }
  }

  return { found: true, disabled: false, findings }
}
