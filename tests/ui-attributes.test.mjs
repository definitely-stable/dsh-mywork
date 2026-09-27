/**
 * F-59 acceptance: the board panel anchors on its OWN data-attribute namespace
 * (`data-mw-*`, D18) and keeps its view state in the slot store rather than in
 * component state.
 *
 * Both claims are checked against the SHIPPED artifact: the prefix scan reads
 * `packages/web/src/**` and the built `lib/client.js` (the plan's own mitigation
 * is "grep the whole bundle, not only src"), and the view-state test loads that
 * bundle the way the page module system does, drives the real store handle and
 * remounts the real component. No live profile and no GUI reload is involved —
 * R-08 forbids a gate that needs either.
 *
 * The loader/stand-in helpers below are duplicated from
 * `tests/ui-package.test.mjs` on purpose: this workspace resolves tests by
 * relative path and the two files may not share a helper module
 * (`tests/lib/fixtures.mjs` requires a built workspace and would couple this
 * suite to the domain packages). `tests/reachability.test.mjs` duplicates
 * `specifiersOf` from `tests/boundaries.test.mjs` for the same reason.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/** Repository root; derived here so this suite needs no built workspace. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Package directory. */
const packageDir = join(repoRoot, 'packages', 'web')

/** The built browser half, as the platform serves it. */
const clientBundlePath = join(packageDir, 'lib', 'client.js')

/** The panel id the sidebar row and the `main` seat must share (`B-26`). */
const PANEL_ID = 'mywork'

/**
 * The attribute namespace the panel is allowed to use, and the exact set it
 * uses today. Adding an anchor is a deliberate edit here, not a silent pass.
 */
const EXPECTED_ATTRIBUTES = [
  'data-mw-board',
  'data-mw-card',
  'data-mw-card-expanded',
  'data-mw-column-active',
  'data-mw-column-filter',
  'data-mw-column-option',
  'data-mw-panel',
]

/** Every file under `packages/web/src`, recursively. */
function sourceFiles(dir = join(packageDir, 'src'), found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(path, found)
    else found.push(path)
  }
  return found
}

/**
 * Every `data-*` attribute name appearing in one text.
 * @param source - file contents.
 * @returns the unique attribute names, in first-appearance order.
 */
function attributesIn(source) {
  return [...new Set([...source.matchAll(/\bdata-[a-z0-9-]+/g)].map(match => match[0]))]
}

/**
 * Drop comments, keeping string literals: an anchor is a string key in the code
 * (`'data-mw-panel': …`), while prose in a doc comment is not an anchor. Line
 * comments are removed after block comments, and no source in this package holds
 * a `//` inside a string, so the simplification is safe for the scanned set.
 * @param source - file contents.
 * @returns the source without comments.
 */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * Load the built bundle the way the page module system does: as a classic
 * script that pushes one registration onto `window.__ModuleLoader__`.
 * @returns the single captured registration.
 */
function loadClientBundle() {
  assert.ok(
    existsSync(clientBundlePath),
    `the built browser half is missing: ${clientBundlePath} — run "corepack pnpm -r run build"`,
  )
  const registrations = []
  const pageWindow = { __ModuleLoader__: { load: registration => registrations.push(registration) } }
  new Function('window', readFileSync(clientBundlePath, 'utf8'))(pageWindow)
  assert.equal(registrations.length, 1, 'the bundle must register exactly one factory')
  return registrations[0]
}

/**
 * The baseline module table words the browser half may request, with a stand-in
 * for `@deepseek-ai/dsh-client-store`. The platform owns the real engine
 * (`packages/client/store/src/index.ts`, `defineStore`), which this workspace
 * does not install; the stand-in implements the same `StoreDecl` contract —
 * `spec { init, persist, actions }` in, `create(scopeKey)` out, baked
 * draft-stripped actions on the instance — so the SEAT WIRING and the panel's
 * read path are executed for real. Engine-level persistence is therefore not
 * exercised here; what is exercised is that the view state lives in the handle,
 * not in the component.
 * @returns a `require` for the bundle factory.
 */
function baselineRequire() {
  const createElement = (type, props, ...children) => ({ type, props: { ...props, children } })
  const react = { createElement }
  const store = {
    defineStore: spec => ({
      spec,
      create(scopeKey) {
        const key = spec.persist === undefined
          ? undefined
          : scopeKey === undefined ? spec.persist : `${spec.persist}.${scopeKey}`
        const persisted = key === undefined || globalThis.localStorage === undefined
          ? undefined
          : globalThis.localStorage.getItem(key)
        let state = persisted === undefined || persisted === null ? spec.init() : JSON.parse(persisted)
        const listeners = new Set()
        const actions = {}
        for (const [name, mutate] of Object.entries(spec.actions)) {
          actions[name] = (...params) => {
            mutate(state, ...params)
            if (key !== undefined && globalThis.localStorage !== undefined) {
              globalThis.localStorage.setItem(key, JSON.stringify(state))
            }
            for (const listener of listeners) listener()
          }
        }
        return {
          actions,
          getSnapshot: () => state,
          subscribe: listener => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
        }
      },
    }),
  }
  const table = new Map([
    ['react', react],
    ['react/jsx-runtime', { jsx: createElement, jsxs: createElement }],
    ['@deepseek-ai/dsh-client-store', store],
  ])
  return specifier => {
    assert.ok(table.has(specifier), `the bundle requested "${specifier}", which is not a baseline module`)
    return table.get(specifier)
  }
}

/**
 * A client root context that answers the one service this half injects.
 * @returns the context plus what the registrations recorded.
 */
function fakeClientContext() {
  const registrations = []
  const injectedSeats = []
  return {
    registrations,
    injectedSeats,
    effect: callback => {
      const dispose = callback()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    slots: {
      inject(seat, callback) {
        injectedSeats.push(seat)
        const dispose = callback()
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
}

/**
 * Every element of a rendered tree carrying one attribute, depth-first.
 * @param tree - the element tree a component returned.
 * @param attribute - the attribute name to collect.
 * @returns the matching elements.
 */
function elementsWith(tree, attribute) {
  const found = []
  const visit = node => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (node === null || typeof node !== 'object' || node.props === undefined) return
    if (node.props[attribute] !== undefined) found.push(node)
    visit(node.props.children)
  }
  visit(tree)
  return found
}

test('every data attribute the panel anchors on lives in the data-mw- namespace', () => {
  const files = sourceFiles()
  assert.ok(files.length >= 3, `expected the package sources, found ${files.length}`)
  const scanned = [
    ...files.map(file => ({ label: file.slice(repoRoot.length + 1), source: readFileSync(file, 'utf8') })),
    { label: 'packages/web/lib/client.js', source: readFileSync(clientBundlePath, 'utf8') },
  ]
  const attributes = new Set()
  for (const { source } of scanned) {
    // The plan's gate is a raw grep over the sources: the foreign prefix must not
    // appear in them at all, prose included.
    assert.equal(source.includes('data-dsh-'), false, 'the platform prefix must not appear in the package sources')
    for (const name of attributesIn(codeOnly(source))) attributes.add(name)
  }

  // Guard the extraction: a scan that matched nothing would make the two
  // assertions below vacuous.
  assert.ok(attributes.size >= EXPECTED_ATTRIBUTES.length, `expected the anchors, found ${[...attributes].join(', ')}`)
  assert.deepEqual([...attributes].sort(), EXPECTED_ATTRIBUTES, 'the panel anchors, in the data-mw- namespace')

  // The shell keeps `data-dsh-*` for its own markers (the boot marker and the
  // automatic-focus marker), and the 0.4.3 precedent keeps a private namespace
  // for the same reason: a panel anchor must not collide with a shell selector.
  const foreign = [...attributes].filter(name => name.startsWith('data-dsh-'))
  assert.deepEqual(foreign, [], 'the platform namespace must not be occupied by the panel')
  assert.deepEqual(
    [...attributes].filter(name => !name.startsWith('data-mw-')),
    [],
    'every panel anchor must live in the data-mw- prefix (D18)',
  )
})

test('the view state of the panel lives in the slot store and survives a remount', () => {
  const exports = loadClientBundle().factory(baselineRequire())
  const context = fakeClientContext()
  exports.apply(context)

  assert.deepEqual(context.injectedSeats, ['main'], 'the page waits for the layout seat it renders in')
  assert.equal(context.registrations.length, 1, 'one page, one registration')
  const { options, component } = context.registrations[0]
  assert.equal(options.name, 'main')
  assert.equal(options.key, PANEL_ID, 'the panel id must equal the main-seat key (B-26)')

  // The seat is what carries the state: a handle with a declared persistence
  // key, not a component-local `useState`.
  const handle = options.store
  assert.ok(handle !== undefined && typeof handle.create === 'function', 'the page must be seated with a store handle')
  assert.equal(handle.spec.persist, 'dsh-mywork.web.board-view', 'the view state declares its persistence key')
  assert.deepEqual(handle.spec.init(), { columnFilter: 'all', expandedCardId: null }, 'the view state it owns')

  const columns = [{ id: 'active', title: 'Active' }, { id: 'review', title: 'Review' }]
  const cards = [
    { id: 'T-1', columnId: 'active', title: 'Task 1' },
    { id: 'T-2', columnId: 'review', title: 'Task 2' },
  ]
  /** Mount the panel the way the seat does: store snapshot + baked actions + face. */
  const mount = instance => component({
    useStore: selector => selector(instance.getSnapshot()),
    actions: instance.actions,
    columns,
    cards,
  })

  const instance = handle.create()
  const first = mount(instance)
  assert.equal(first.props['data-mw-panel'], PANEL_ID)
  assert.equal(first.props['data-mw-column-filter'], 'all', 'the filter comes from the store, not from the component')
  assert.equal(elementsWith(first, 'data-mw-card').length, 2)
  assert.deepEqual(elementsWith(first, 'data-mw-card-expanded'), [], 'nothing is expanded yet')

  // The user acts through the store's actions...
  instance.actions.selectColumn('active')
  instance.actions.toggleCard('T-1')

  // ...and a fresh mount (new element, new props object, same store instance —
  // the framework caches one instance per handle and scope) still shows it.
  const second = mount(instance)
  assert.equal(second.props['data-mw-column-filter'], 'active', 'the filter survived the unmount')
  const expanded = elementsWith(second, 'data-mw-card-expanded')
  assert.equal(expanded.length, 1, 'the expanded card survived the unmount')
  assert.equal(expanded[0].props['data-mw-card'], 'T-1')
  assert.equal(elementsWith(second, 'data-mw-card').length, 1, 'the filter selects the visible cards')

  // The read path is the seat itself: a different snapshot renders differently.
  const third = mount({ getSnapshot: () => ({ columnFilter: 'review', expandedCardId: null }), actions: instance.actions })
  assert.equal(third.props['data-mw-column-filter'], 'review')
  const visible = elementsWith(third, 'data-mw-card')
  assert.equal(visible.length, 1)
  assert.equal(visible[0].props['data-mw-card'], 'T-2')

  // The negative half of the claim: the shipped panel owns no local state.
  const shipped = readFileSync(clientBundlePath, 'utf8')
  assert.equal(shipped.includes('useState'), false, 'the panel must not keep view state in component state')
  assert.equal(shipped.includes('useReducer'), false, 'the panel must not keep view state in a reducer')
})
