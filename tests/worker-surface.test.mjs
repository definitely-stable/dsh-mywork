/**
 * The worker tool surface (F-56, D15).
 *
 * A worker session must see only the tools MyWork declares, and it must be an
 * allowlist rather than a denylist: `tools.restrict` rejects a name the
 * composition has not registered, so a deny list of tools that may not exist
 * yet cannot even be constructed. The list is derived from the two permission
 * sets of `packages/contracts/src/security.ts:201,212` instead of being
 * authored beside them, and that derivation is asserted here behaviourally —
 * a hardcoded list would not answer a narrower permission set.
 *
 * The built packages are imported exactly as a consumer receives them, so a
 * broken build fails here instead of silently testing sources.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Repository root, derived here rather than taken from `lib/fixtures.mjs`: that
 * helper refuses to load while ANY package's `lib/` is missing, and the shared
 * tree is built by several workstreams at once.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `@dsh-mywork/contracts` as built: the §31 permission sets. */
const contracts = await import(pathToFileURL(join(repoRoot, 'packages/contracts/lib/index.js')).href)

/** `@dsh-mywork/core` as built: the surface policy. */
const core = await import(pathToFileURL(join(repoRoot, 'packages/core/lib/index.js')).href)

/** The source of the module under test, for the two structural claims. */
const sourcePath = join(repoRoot, 'packages/core/src/worker-surface.ts')
const source = readFileSync(sourcePath, 'utf8')

/**
 * A plausible worker composition: the tools a session really carries, plus the
 * ones D15 exists to keep out of it.
 */
const AVAILABLE = Object.freeze([
  'plugin_manager',
  'cordis_inspect_list',
  'cordis_inspect_query',
  'spawn_teammate',
  'read',
  'read_image',
  'glob',
  'grep',
  'lsp',
  'write',
  'edit',
  'str_replace_editor',
  'pwsh',
  'bash',
  'team_task_create',
  'create_goal',
  'web_fetch',
])

/** Tool the surface must keep, in the order `AVAILABLE` lists them. */
const KEPT = Object.freeze([
  'read',
  'read_image',
  'glob',
  'grep',
  'lsp',
  'write',
  'edit',
  'str_replace_editor',
  'pwsh',
  'bash',
])

/** Tool the surface must drop: composition-changing, orchestration, network. */
const DROPPED = Object.freeze([
  'plugin_manager',
  'cordis_inspect_list',
  'cordis_inspect_query',
  'spawn_teammate',
  'team_task_create',
  'create_goal',
  'web_fetch',
])

test('workerTools keeps the allowlisted tools and drops everything else', () => {
  const kept = core.workerTools(AVAILABLE)
  assert.deepEqual(kept, KEPT)
  assert.deepEqual(core.workerTools(AVAILABLE, contracts.REVIEWER_DEFAULT_PERMISSIONS), [
    'read',
    'read_image',
    'glob',
    'grep',
    'lsp',
    'pwsh',
    'bash',
  ])

  // The interesting names are absent, and the guard below keeps this from being
  // a vacuous pass: the fixture carries them, and the result is a proper subset.
  for (const name of DROPPED) {
    assert.equal(kept.includes(name), false, `${name} must not be in the worker surface`)
    assert.ok(AVAILABLE.includes(name), `${name} must be present in the fixture`)
  }
  assert.ok(kept.length > 0, 'the fixture must keep something')
  assert.ok(kept.length < AVAILABLE.length, 'the fixture must drop something')
  // A composition with nothing allowlisted yields nothing, not everything.
  assert.deepEqual(core.workerTools(['plugin_manager', 'cordis_inspect_list']), [])

  // The whole list is asserted as a set against literals, so it cannot become a
  // catch-all unnoticed.
  assert.deepEqual([...core.WORKER_TOOL_ALLOWLIST].sort(), [
    'bash',
    'edit',
    'glob',
    'grep',
    'lsp',
    'pwsh',
    'read',
    'read_image',
    'str_replace_editor',
    'write',
  ])
})

test('the allowlist is derived from the contracts permission sets, not authored beside them', () => {
  // Read the import SPECIFIERS rather than substring-searching the header, the
  // way `tests/boundaries.test.mjs` does: a mention of a constant in a comment
  // is not an import, and a copy appended below the header would slip past a
  // prefix search.
  const imports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)].map(match => ({
    names: match[1].split(',').map(name => name.trim()).filter(Boolean),
    specifier: match[2],
  }))
  assert.ok(imports.length > 0, 'the scan must find the module imports at all')
  const contractsImport = imports.find(entry => entry.specifier === '@dsh-mywork/contracts')
  assert.ok(contractsImport !== undefined, 'the allowlist must import from @dsh-mywork/contracts')
  assert.ok(contractsImport.names.includes('IMPLEMENTATION_WRITE_PERMISSIONS'), 'the writer set must be imported')
  assert.ok(contractsImport.names.includes('REVIEWER_DEFAULT_PERMISSIONS'), 'the reviewer set must be imported')

  // ...and does not restate them. A copied list would put two members of one
  // constant on a single line; the scan covers the WHOLE file, not its header.
  for (const set of [contracts.IMPLEMENTATION_WRITE_PERMISSIONS, contracts.REVIEWER_DEFAULT_PERMISSIONS]) {
    for (const line of source.split('\n')) {
      const named = set.filter(permission => line.includes(`'${permission}'`))
      assert.ok(named.length <= 1, `this line looks like a copy of a permission set: ${line.trim()}`)
    }
  }

  // The ceiling is those two sets and nothing else.
  assert.deepEqual(core.WORKER_SURFACE_PERMISSIONS, [
    ...contracts.IMPLEMENTATION_WRITE_PERMISSIONS,
    ...contracts.REVIEWER_DEFAULT_PERMISSIONS,
  ])

  // The derivation is live: a narrower permission set yields a strictly smaller
  // surface, and the sets behave differently from each other.
  const all = core.workerToolAllowlist()
  const reader = core.workerToolAllowlist(['workspace.read'])
  assert.ok(reader.length > 0 && reader.length < all.length, 'a narrower set must narrow the surface')
  assert.ok(reader.includes('read') && reader.includes('grep'))
  for (const name of ['write', 'edit', 'str_replace_editor', 'pwsh', 'bash']) {
    assert.equal(reader.includes(name), false, `${name} must need a permission the reader does not hold`)
  }
  assert.deepEqual(core.workerToolAllowlist([]), [])
  // A permission outside the ceiling cannot widen it, and saying so is not
  // silence: the caller asked for something the surface does not have.
  assert.throws(() => core.workerToolAllowlist(['network']), TypeError)
})

test('the restrict filter carries allow only, and an empty intersection is refused', () => {
  const calls = []
  const tools = {
    restrict(filter) {
      calls.push(filter)
      return () => {}
    },
  }

  const report = core.applyWorkerSurface(tools, { available: AVAILABLE, correlationId: 'corr-1' })
  assert.equal(calls.length, 1, 'the surface is restricted exactly once')
  assert.deepEqual(Object.keys(calls[0]), ['allow'], 'a `deny` list would name tools the composition may not have')
  assert.deepEqual(calls[0].allow, KEPT)
  assert.deepEqual(report.allowed, KEPT)
  assert.deepEqual(report.filtered, DROPPED)
  assert.equal(report.correlationId, 'corr-1')
  // A report exists only for a restriction that was applied, so `filtered` can
  // only ever name tools the session really loses.
  assert.deepEqual(Object.keys(report).sort(), ['allowed', 'correlationId', 'filtered'])
  // Every name the filter carries is one the composition actually has, which is
  // what makes `tools.restrict`'s unknown-name refusal unreachable.
  for (const name of calls[0].allow) {
    assert.ok(AVAILABLE.includes(name), `${name} is not registered in this composition`)
  }

  // An empty intersection is a REFUSAL, not a report: nothing was restricted, so
  // there is no report to hand back, and a caller cannot continue into a session
  // holding every tool the composition registered.
  const emptyCalls = []
  const emptyTools = {
    restrict(filter) {
      emptyCalls.push(filter)
      return () => {}
    },
  }
  let refusal
  try {
    core.applyWorkerSurface(emptyTools, {
      available: ['plugin_manager', 'cordis_inspect_list'],
      correlationId: 'corr-2',
    })
  } catch (error) {
    refusal = error
  }
  assert.ok(refusal !== undefined, 'the empty intersection must be refused, not reported')
  assert.ok(refusal instanceof Error)
  assert.ok(refusal instanceof core.WorkerSurfaceError, 'the refusal must be the typed one')
  assert.equal(core.isWorkerSurfaceError(refusal), true)
  assert.equal(refusal.reason, 'no-allowlisted-tools')
  assert.equal(refusal.correlationId, 'corr-2')
  assert.deepEqual(refusal.registered, ['plugin_manager', 'cordis_inspect_list'])
  assert.deepEqual(emptyCalls, [], 'a refusal must not apply a filter')
  // The guard does not mistake a foreign error for this refusal.
  assert.equal(core.isWorkerSurfaceError(new Error('boom')), false)
  assert.equal(core.isWorkerSurfaceError(undefined), false)
  assert.equal(core.isWorkerSurfaceError({ reason: 'no-allowlisted-tools' }), false)
})
