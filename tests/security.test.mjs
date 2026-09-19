/**
 * Runtime permission acceptance (architecture §28, §31, §52, §60).
 *
 * The gate must hold the boundaries the card names: a path may not leave the
 * workspace or the attempt's worktree, an agent may not touch a workspace it is
 * not bound to, nobody approves their own attempt, a permission that was not
 * granted is refused instead of escalated, an unknown capability grants
 * nothing, a reviewer is read-only for implementation, and untrusted content —
 * a prompt or a memory record smuggled into a request — cannot widen a grant.
 *
 * Every denial is asserted by its `reason`, so a test fails if the gate starts
 * refusing for the wrong cause as well as if it stops refusing.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { contracts, core, meta } from './lib/fixtures.mjs'

const M = meta()
const WORKSPACE = 'ws-z2p'
const ROOT = 'C:\\ws\\z2p'

/**
 * Every permission except `review.approve`. A grant that may approve must not
 * hold implementation writes (§31), so a "holds everything" grant has to leave
 * the approving permission out — that rule has its own test.
 */
const ALL_EXCEPT_APPROVE = contracts.PERMISSIONS.filter(permission => permission !== 'review.approve')

/** A grant bound to the default workspace root. */
function context(overrides = {}) {
  return {
    agentId: 'Neo-1',
    permissions: ['workspace.read'],
    workspaceId: WORKSPACE,
    workspaceRoot: ROOT,
    harnessPolicy: 'workspace-write',
    ...overrides,
  }
}

/** An operation request inside the default workspace. */
function request(overrides = {}) {
  return { domain: 'filesystem', action: 'read', workspaceId: WORKSPACE, ...overrides }
}

/** The `reason` a denial carries; fails loudly when the call was allowed. */
function reasonOf(result) {
  assert.equal(result.ok, false, 'expected the gate to refuse')
  return result.error.details.reason
}

test('a granted read inside the workspace is authorized', () => {
  const decision = core.authorizeOperation(context(), request({ path: 'src/index.ts' }), M)
  assert.equal(decision.ok, true, decision.ok ? '' : decision.error.message)
  assert.equal(decision.value.permission, 'workspace.read')
  assert.equal(decision.value.workspaceId, WORKSPACE)
  assert.equal(Object.isFrozen(decision.value), true)
})

test('a permission that was not granted is refused, not escalated', () => {
  const denied = core.authorizeOperation(context(), request({ domain: 'filesystem', action: 'write', path: 'src/a.ts' }), M)
  assert.equal(reasonOf(denied), 'permission-missing')
  assert.deepEqual(denied.error.details.permission, 'workspace.write')
})

test('a path that climbs out of the workspace is refused', () => {
  const grant = context({ permissions: ['workspace.read'] })
  for (const path of ['../secrets.txt', 'src/../../secrets.txt', '..\\..\\Windows\\win.ini', 'a/../../../etc/passwd']) {
    assert.equal(reasonOf(core.authorizeOperation(grant, request({ path }), M)), 'path-escape', path)
  }
})

test('an absolute path outside the workspace is refused', () => {
  const grant = context({ permissions: ['workspace.read'] })
  for (const path of ['C:\\Windows\\System32\\config\\SAM', 'D:\\other\\file.txt', '\\\\server\\share\\file', '/etc/passwd']) {
    assert.equal(reasonOf(core.authorizeOperation(grant, request({ path }), M)), 'path-escape', path)
  }
})

test('a sibling directory sharing the root prefix is not inside the root', () => {
  assert.equal(core.isWithinRoot('C:\\ws\\z2p', 'C:\\ws\\z2p\\src\\a.ts'), true)
  assert.equal(core.isWithinRoot('C:\\ws\\z2p', 'C:\\ws\\z2p-evil\\a.ts'), false)
  assert.equal(core.isWithinRoot('C:\\ws\\z2p', 'C:\\ws\\z2px'), false)
  assert.equal(core.isWithinRoot('/ws/z2p', '/ws/z2p-evil/a.ts'), false)
})

test('windows roots compare case-insensitively and posix roots do not', () => {
  assert.equal(core.isWithinRoot('C:\\ws\\z2p', 'c:\\WS\\Z2P\\src\\a.ts'), true)
  assert.equal(core.isWithinRoot('/ws/z2p', '/WS/Z2P/a.ts'), false)
})

test('a path may not leave the worktree of the attempt', () => {
  const worktree = 'C:\\ws\\z2p\\.worktrees\\mw-007'
  const grant = context({ permissions: ['workspace.read', 'workspace.write'], worktreeRoot: worktree })

  const inside = core.authorizeOperation(grant, request({ path: `${worktree}\\src\\a.ts` }), M)
  assert.equal(inside.ok, true, inside.ok ? '' : inside.error.message)
  assert.equal(inside.value.boundaryRoot, worktree)

  // A relative path is resolved against the boundary, so it stays in the worktree.
  const relative = core.authorizeOperation(grant, request({ path: 'src/a.ts' }), M)
  assert.equal(relative.ok, true, relative.ok ? '' : relative.error.message)
  assert.equal(relative.value.boundaryRoot, worktree)

  // Editing the main checkout instead of the attempt worktree is the escape.
  const sibling = core.authorizeOperation(grant, request({ path: 'C:\\ws\\z2p\\src\\a.ts' }), M)
  assert.equal(reasonOf(sibling), 'worktree-escape')
})

test('a decision carries the root the path was checked against', () => {
  const granted = core.authorizeOperation(context({ permissions: ['workspace.read'] }), request({ path: 'src/a.ts' }), M)
  assert.equal(granted.value.boundaryRoot, ROOT)
  const noPath = core.authorizeOperation(context({ permissions: ['network'] }), request({ domain: 'network', action: 'invoke' }), M)
  assert.equal(noPath.value.boundaryRoot, undefined)
})

test('a segment windows would strip before resolving is refused', () => {
  const grant = context({ permissions: ['workspace.read'] })
  for (const path of ['src/.. ', 'srcdir./a.ts', 'a.ts ', 'sub/.. .']) {
    assert.equal(reasonOf(core.authorizeOperation(grant, request({ path }), M)), 'path-escape', path)
  }
})

test('a foreign workspace is reported even when the path is missing', () => {
  const grant = context({ permissions: ['workspace.write'] })
  const denied = core.authorizeOperation(grant, request({ domain: 'filesystem', action: 'write', workspaceId: 'ws-muxtv' }), M)
  assert.equal(reasonOf(denied), 'foreign-workspace')
})

test('a worktree outside the workspace is a configuration error, not a boundary', () => {
  assert.throws(
    () => core.authorizeOperation(context({ worktreeRoot: 'D:\\elsewhere' }), request(), M),
    /worktreeRoot .* is outside workspaceRoot/,
  )
})

test('an agent may not touch a workspace it is not bound to', () => {
  const denied = core.authorizeOperation(context(), request({ workspaceId: 'ws-muxtv', path: 'src/a.ts' }), M)
  assert.equal(reasonOf(denied), 'foreign-workspace')
  assert.equal(denied.error.details.requestWorkspaceId, 'ws-muxtv')
})

test('nobody approves their own attempt', () => {
  const grant = context({ permissions: ['workspace.read', 'review.approve'], reviewer: true, workerAgentId: 'Neo-1' })
  const denied = core.authorizeOperation(grant, request({ domain: 'review', action: 'approve' }), M)
  assert.equal(reasonOf(denied), 'self-approval')
})

test('an approval without the worker identity cannot prove independence', () => {
  const grant = context({ permissions: ['review.approve'], reviewer: true })
  assert.equal(
    reasonOf(core.authorizeOperation(grant, request({ domain: 'review', action: 'approve' }), M)),
    'unverifiable-independence',
  )
})

test('an independent reviewer with the permission approves', () => {
  const grant = context({ permissions: ['workspace.read', 'review.approve'], reviewer: true, workerAgentId: 'Trinity-2' })
  const allowed = core.authorizeOperation(grant, request({ domain: 'review', action: 'approve' }), M)
  assert.equal(allowed.ok, true, allowed.ok ? '' : allowed.error.message)
})

test('a file operation that names no path is refused instead of trusted', () => {
  const grant = context({ permissions: ['workspace.read', 'workspace.write', 'git.read', 'git.write'] })
  for (const [domain, action] of [['filesystem', 'write'], ['filesystem', 'read'], ['git', 'write'], ['git', 'read']]) {
    assert.equal(reasonOf(core.authorizeOperation(grant, request({ domain, action }), M)), 'path-missing', `${domain}.${action}`)
  }
  const named = core.authorizeOperation(grant, request({ domain: 'filesystem', action: 'write', path: 'src/a.ts' }), M)
  assert.equal(named.ok, true, named.ok ? '' : named.error.message)
  assert.equal(named.value.path, 'src/a.ts')
})

test('a worktree boundary cannot be skipped by omitting the path', () => {
  const grant = context({
    permissions: ['workspace.write'],
    worktreeRoot: 'C:\\ws\\z2p\\.worktrees\\mw-007',
  })
  assert.equal(reasonOf(core.authorizeOperation(grant, request({ domain: 'filesystem', action: 'write' }), M)), 'path-missing')
})

test('an operation without a filesystem effect needs no path', () => {
  const grant = context({ permissions: ['network', 'shell'] })
  assert.equal(core.authorizeOperation(grant, request({ domain: 'network', action: 'invoke' }), M).ok, true)
  assert.equal(core.authorizeOperation(grant, request({ domain: 'shell', action: 'execute' }), M).ok, true)
})

test('an approving grant is read-only whether or not it is flagged as a reviewer', () => {
  const permissions = ['workspace.read', 'review.approve', 'workspace.write', 'git.write', 'shell']
  for (const flag of [true, false, undefined]) {
    const grant = context({
      permissions,
      workerAgentId: 'Trinity-2',
      ...(flag === undefined ? {} : { reviewer: flag }),
    })
    const approve = core.authorizeOperation(grant, request({ domain: 'review', action: 'approve' }), M)
    assert.equal(reasonOf(approve), 'reviewer-write-grant', `reviewer=${String(flag)}`)
    const write = core.authorizeOperation(grant, request({ domain: 'filesystem', action: 'write', path: 'src/a.ts' }), M)
    assert.equal(reasonOf(write), 'reviewer-write-grant', `reviewer=${String(flag)}`)
  }
})

test('an identity that differs only in case is the same actor', () => {
  const grant = context({ permissions: ['review.approve'], workerAgentId: 'neo-1' })
  assert.equal(reasonOf(core.authorizeOperation(grant, request({ domain: 'review', action: 'approve' }), M)), 'self-approval')
  const other = context({ permissions: ['review.approve'], workerAgentId: ' Trinity-2 ' })
  const allowed = core.authorizeOperation(other, request({ domain: 'review', action: 'approve' }), M)
  assert.equal(allowed.ok, true, allowed.ok ? '' : allowed.error.message)
})

test('an identity that differs only in unicode composition is the same actor', () => {
  const composed = 'Jos\u00e9-1'
  const decomposed = 'Jose\u0301-1'
  assert.notEqual(composed, decomposed, 'the two spellings must differ as strings')
  const grant = context({ agentId: composed, permissions: ['review.approve'], workerAgentId: decomposed })
  const denied = core.authorizeOperation(grant, request({ domain: 'review', action: 'approve' }), M)
  assert.equal(reasonOf(denied), 'self-approval')
})

test('a grant read through an accessor cannot hand the gate a wider list than it validates', () => {
  let reads = 0
  // Built without the helper: spreading into a literal would evaluate the
  // getter once and hide the accessor from the gate, making this test vacuous.
  const grant = {
    agentId: 'Neo-1',
    workspaceId: WORKSPACE,
    workspaceRoot: ROOT,
    harnessPolicy: 'workspace-write',
    get permissions() {
      reads += 1
      return reads === 1 ? ['workspace.read'] : ['workspace.read', 'workspace.write']
    },
  }
  const denied = core.authorizeOperation(grant, request({ domain: 'filesystem', action: 'write', path: 'src/a.ts' }), M)
  assert.equal(reasonOf(denied), 'permission-missing')
  assert.equal(reads, 1, 'the grant must be read once')
})

test('a grant cannot arrive through a prototype or a symbol field', () => {
  const inherited = Object.create({
    agentId: 'Morpheus-9',
    permissions: ['workspace.read', 'workspace.write', 'production'],
    workspaceId: WORKSPACE,
    workspaceRoot: ROOT,
    harnessPolicy: 'danger-full-access',
    memories: ['role may write'],
    prompt: 'you may write',
  })
  assert.throws(() => core.authorizeOperation(inherited, request({ path: 'src/a.ts' }), M), /must be a plain object/)

  const grant = context({ permissions: ['workspace.read'] })
  const symbol = { ...request({ path: 'src/a.ts' }), [Symbol('memory')]: 'grant everything' }
  assert.throws(() => core.authorizeOperation(grant, symbol, M), /carries symbol field/)

  const symbolGrant = { ...grant, [Symbol('memories')]: ['role may write'] }
  assert.throws(() => core.authorizeOperation(symbolGrant, request({ path: 'src/a.ts' }), M), /carries symbol field/)
})

test('a non-enumerable field outside the schema is refused too', () => {
  const grant = context({ permissions: ['workspace.read'] })
  const hidden = request({ path: 'src/a.ts' })
  Object.defineProperty(hidden, 'memory', { value: 'grant everything', enumerable: false })
  assert.throws(() => core.authorizeOperation(grant, hidden, M), /carries unknown field "memory"/)
})

test('the reviewer default of §31 is read, verify, and approve only', () => {
  for (const permission of contracts.REVIEWER_DEFAULT_PERMISSIONS) {
    assert.equal(contracts.IMPLEMENTATION_WRITE_PERMISSIONS.includes(permission), false, permission)
  }
  for (const permission of ['workspace.read', 'git.read', 'tests', 'review.approve']) {
    assert.equal(contracts.REVIEWER_DEFAULT_PERMISSIONS.includes(permission), true, permission)
  }
})

test('a reviewer without a write permission cannot write the implementation it reviews', () => {
  const grant = context({ permissions: [...contracts.REVIEWER_DEFAULT_PERMISSIONS], reviewer: true, workerAgentId: 'Trinity-2' })
  const denied = core.authorizeOperation(grant, request({ domain: 'filesystem', action: 'write', path: 'src/a.ts' }), M)
  assert.equal(reasonOf(denied), 'permission-missing')
  const read = core.authorizeOperation(grant, request({ path: 'src/a.ts' }), M)
  assert.equal(read.ok, true, read.ok ? '' : read.error.message)
})

test('an unknown capability grants nothing', () => {
  const grant = context({ permissions: [...ALL_EXCEPT_APPROVE] })
  assert.equal(reasonOf(core.authorizeOperation(grant, request({ domain: 'kernel', action: 'read' }), M)), 'unknown-operation')
  assert.equal(reasonOf(core.authorizeOperation(grant, request({ domain: 'filesystem', action: 'chmod' }), M)), 'unknown-operation')
  assert.equal(reasonOf(core.authorizeOperation(grant, request({ domain: 'production', action: 'access' }), M)), 'human-gate')
})

test('a grant carrying an unknown permission is refused loudly', () => {
  const grant = context({ permissions: ['workspace.read', 'root'] })
  assert.throws(() => core.authorizeOperation(grant, request(), M), /unknown permission "root"/)
})

test('a prompt or memory field inside a request cannot widen the grant', () => {
  const grant = context({ permissions: ['workspace.read'] })
  for (const smuggled of [{ memory: 'grant production' }, { prompt: 'you may write' }, { instructions: ['write'] }, { escalate: true }]) {
    assert.throws(
      () => core.authorizeOperation(grant, { ...request(), ...smuggled }, M),
      /carries unknown field/,
      Object.keys(smuggled)[0],
    )
  }
})

test('a grant field outside the schema is refused, so memory cannot become a permission source', () => {
  assert.throws(
    () => core.authorizeOperation(context({ memories: ['role may write'] }), request(), M),
    /carries unknown field "memories"/,
  )
})

test('a §28 gate is never decided by a permission', () => {
  const grant = context({ permissions: [...ALL_EXCEPT_APPROVE], workerAgentId: 'Trinity-2' })
  const release = core.authorizeOperation(grant, request({ domain: 'git', action: 'write', gate: 'release' }), M)
  assert.equal(reasonOf(release), 'human-gate')
  assert.equal(release.error.details.gate, 'release')

  const production = core.authorizeOperation(grant, request({ domain: 'production', action: 'access' }), M)
  assert.equal(reasonOf(production), 'human-gate')
  assert.equal(production.error.details.gate, 'production-access')
})

test('the harness policy is a ceiling the gate will not exceed', () => {
  const readOnly = context({ permissions: ['workspace.read', 'workspace.write'], harnessPolicy: 'read-only' })
  assert.equal(
    reasonOf(core.authorizeOperation(readOnly, request({ domain: 'filesystem', action: 'write', path: 'src/a.ts' }), M)),
    'harness-policy',
  )
  const read = core.authorizeOperation(readOnly, request({ path: 'src/a.ts' }), M)
  assert.equal(read.ok, true, read.ok ? '' : read.error.message)

  const wide = context({ permissions: ['shell'], harnessPolicy: 'danger-full-access' })
  const shell = core.authorizeOperation(wide, request({ domain: 'shell', action: 'execute' }), M)
  assert.equal(shell.ok, true, shell.ok ? '' : shell.error.message)
})

test('a task transition needs its own permission', () => {
  const without = core.authorizeOperation(context(), request({ domain: 'task', action: 'transition' }), M)
  assert.equal(reasonOf(without), 'permission-missing')
  const with_ = core.authorizeOperation(context({ permissions: ['task.transition'] }), request({ domain: 'task', action: 'transition' }), M)
  assert.equal(with_.ok, true, with_.ok ? '' : with_.error.message)
})

test('a credential is used as a reference and never as a secret', () => {
  const grant = context({ permissions: ['secrets.use'] })
  const use = { domain: 'secrets', action: 'use' }
  const allowed = core.authorizeOperation(grant, request({ ...use, credential: { ref: 'dsh:credential/deploy-key' } }), M)
  assert.equal(allowed.ok, true, allowed.ok ? '' : allowed.error.message)

  assert.equal(reasonOf(core.authorizeOperation(grant, request(use), M)), 'credential-required')

  const secrets = [
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEow…',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    'sk-live-9f2c8b1a4d',
    'aws AKIAIOSFODNN7EXAMPLE',
    'password=hunter2',
    'c2VjcmV0LWtleS1mb3ItcHJvZHVjdGlvbi0yMDI2v2',
    'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
    'a3f51b7c9d2e4f6089abcdef0123456789abcdef',
    // Residual shapes the first review round left open.
    'password: hunter2',
    '{"password":"hunter2"}',
    'token: abc123',
    'api_key: abc123',
    'AbCdEfGh1234567890Ab-CdEfGh1234567890AbCdEfGh12',
  ]
  for (const ref of secrets) {
    const denied = core.authorizeOperation(grant, request({ ...use, credential: { ref } }), M)
    assert.equal(reasonOf(denied), 'secret-material', ref.slice(0, 24))
  }
})

test('a reference that names a store is not mistaken for a secret', () => {
  const grant = context({ permissions: ['secrets.use'] })
  const use = { domain: 'secrets', action: 'use' }
  for (const ref of [
    'dsh:credential/deploy-key',
    'dsh:credential/ci-token',
    'secret:db-credential',
    'op://prod/db-password:prod',
    'vault://team/z2p/deploy',
    '9f1c8b1a-4d2e-4f60-89ab-cdef01234567',
  ]) {
    const allowed = core.authorizeOperation(grant, request({ ...use, credential: { ref } }), M)
    assert.equal(allowed.ok, true, `${ref}: ${allowed.ok ? '' : allowed.error.message}`)
  }
})

test('a credential reference on an operation that has no use for it is refused', () => {
  const grant = context({ permissions: ['workspace.read'] })
  const denied = core.authorizeOperation(grant, request({ path: 'src/a.ts', credential: { ref: 'dsh:credential/x' } }), M)
  assert.equal(reasonOf(denied), 'credential-not-expected')
})

test('the credential check is available on its own for callers that store a reference', () => {
  const stored = core.assertCredentialReference({ ref: 'dsh:credential/ci-token' }, M)
  assert.equal(stored.ok, true, stored.ok ? '' : stored.error.message)
  assert.equal(Object.isFrozen(stored.value), true)
  assert.equal(reasonOf(core.assertCredentialReference({ ref: 'ghp_0123456789abcdefghijklmnopqrstuvwxyz' }, M)), 'secret-material')
  assert.throws(() => core.assertCredentialReference({ ref: 'x', value: 'secret' }, M), /carries unknown field "value"/)
})

test('a path is checked only for the operation that names one', () => {
  const grant = context({ permissions: ['network'] })
  const allowed = core.authorizeOperation(grant, request({ domain: 'network', action: 'invoke' }), M)
  assert.equal(allowed.ok, true, allowed.ok ? '' : allowed.error.message)
})
