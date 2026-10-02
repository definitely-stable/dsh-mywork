/**
 * Worktree isolation contracts (MW-021, E-02; architecture §19, §31).
 *
 * What has to hold before any adapter exists: the refusal vocabulary is closed
 * and frozen, a lookalike string is never coerced into a refusal, the field
 * vocabularies a caller depends on are the ones the port documents, and the
 * built declarations really carry the two ports — with no `push` anywhere on the
 * git port, because "the integrator cannot reach a remote" is a property of the
 * shape rather than of the implementation's discipline.
 *
 * The last check is textual (an interface is a type and has no runtime value),
 * so it carries its own positive control: the same extraction must find the six
 * methods of `GitPort`. An extraction that silently matched nothing would
 * otherwise pass.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { contracts, repoRoot } from './lib/fixtures.mjs'

/** The six refusals §19 names, in the order the contract freezes them. */
const REFUSALS = [
  'EMPTY_REPOSITORY',
  'WORKTREE_DIRTY',
  'WORKTREE_FOREIGN',
  'WORKTREE_OUTSIDE_WORKSPACE',
  'WORKTREE_ALREADY_REGISTERED',
  'WORKTREE_MISSING',
]

test('the refusal vocabulary is closed, frozen, and mapped onto declared error codes', () => {
  assert.deepEqual([...contracts.WORKTREE_REFUSALS], REFUSALS)
  assert.equal(Object.isFrozen(contracts.WORKTREE_REFUSALS), true, 'the vocabulary must be frozen')
  assert.equal(Object.isFrozen(contracts.WORKTREE_REFUSAL_CODES), true, 'the mapping must be frozen')
  assert.deepEqual(Object.keys(contracts.WORKTREE_REFUSAL_CODES).sort(), [...REFUSALS].sort())
  for (const refusal of REFUSALS) {
    const code = contracts.WORKTREE_REFUSAL_CODES[refusal]
    assert.ok(
      contracts.MYWORK_ERROR_CODES.includes(code),
      `refusal ${refusal} maps to "${code}", which is not a declared MyWork error code`,
    )
  }
  // The two refusals that guard a boundary travel as a denial, not as a conflict:
  // a caller that retries a conflict is doing the right thing, while a caller
  // retrying a security refusal is not.
  assert.equal(contracts.WORKTREE_REFUSAL_CODES.WORKTREE_FOREIGN, 'SECURITY_DENIED')
  assert.equal(contracts.WORKTREE_REFUSAL_CODES.WORKTREE_OUTSIDE_WORKSPACE, 'SECURITY_DENIED')
})

test('a value that merely looks like a refusal is not coerced into one', () => {
  for (const refusal of REFUSALS) {
    assert.equal(contracts.resolveWorktreeRefusal(refusal), refusal)
    assert.equal(contracts.isWorktreeRefusal(refusal), true)
  }
  // A neighbouring domain's code, the same word in another case, an empty string,
  // a non-string, and a partial name: none of them is a refusal of this port.
  const foreign = [
    'STALE_REVISION',
    'TASK_CONFLICT',
    'empty_repository',
    'WORKTREE',
    '',
    ' WORKTREE_DIRTY',
    null,
    undefined,
    42,
    { refusal: 'WORKTREE_DIRTY' },
  ]
  for (const value of foreign) {
    assert.equal(contracts.resolveWorktreeRefusal(value), undefined, `"${String(value)}" must not resolve`)
    assert.equal(contracts.isWorktreeRefusal(value), false)
  }
})

test('the field vocabularies of the policy, the request, and the registration are closed', () => {
  assert.deepEqual([...contracts.WORKTREE_POLICY_FIELDS], ['root', 'branchPrefix', 'retentionMs', 'keepDirty'])
  assert.deepEqual([...contracts.WORKTREE_REQUEST_FIELDS], ['workspaceId', 'taskId', 'attemptId', 'baseSha'])
  assert.deepEqual(
    [...contracts.WORKTREE_REGISTRATION_FIELDS],
    ['attemptId', 'workspaceId', 'taskId', 'path', 'branch', 'baseSha', 'headSha'],
  )
  assert.deepEqual([...contracts.WORKTREE_CLEANUP_OUTCOMES], ['removed', 'kept-dirty', 'kept-orphan'])
  for (const vocabulary of [
    contracts.WORKTREE_POLICY_FIELDS,
    contracts.WORKTREE_REQUEST_FIELDS,
    contracts.WORKTREE_REGISTRATION_FIELDS,
    contracts.WORKTREE_CLEANUP_OUTCOMES,
  ]) {
    assert.equal(Object.isFrozen(vocabulary), true, 'every field vocabulary must be frozen')
  }
  // The registration carries the base SHA the attempt was cut from and the head
  // it ended on; a shape that lost either could not answer §19's acceptance.
  assert.ok(contracts.WORKTREE_REGISTRATION_FIELDS.includes('baseSha'))
  assert.ok(contracts.WORKTREE_REGISTRATION_FIELDS.includes('headSha'))
})

/**
 * The method names declared by one interface in the built declarations.
 * @param declarations - contents of `packages/contracts/lib/index.d.ts`.
 * @param name - interface name to read.
 * @returns the declared method names, in declaration order.
 */
function interfaceBlock(declarations, name) {
  // The bundled declaration file re-declares the interfaces of every module it
  // inlines, so the modifier is optional: what is matched is the interface and
  // its body, not the way the bundler chose to spell it.
  const block = new RegExp(`(?:export )?interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(declarations)
  assert.notEqual(block, null, `the built declarations must declare interface ${name}`)
  return block[0]
}

/**
 * The method names declared by one interface in the built declarations.
 * @param declarations - contents of `packages/contracts/lib/index.d.ts`.
 * @param name - interface name to read.
 * @returns the declared method names, in declaration order.
 */
function methodsOf(declarations, name) {
  return [...interfaceBlock(declarations, name).matchAll(/^ {2}(\w+)\(/gm)].map(match => match[1])
}

test('the built declarations carry both ports, and neither can reach a remote', () => {
  const declarations = readFileSync(join(repoRoot, 'packages', 'contracts', 'lib', 'index.d.ts'), 'utf8')
  assert.deepEqual(methodsOf(declarations, 'WorktreePort'), ['prepare', 'resolve', 'cleanup', 'list'])
  // Positive control: the same extraction on an interface whose method count is
  // known independently, so a regex that matched nothing cannot pass unnoticed.
  assert.deepEqual(
    methodsOf(declarations, 'GitPort'),
    ['resolveHead', 'diffHash', 'isClean', 'commit', 'land', 'abortLanding'],
  )
  const worktreeBlock = interfaceBlock(declarations, 'WorktreePort')
  const gitBlock = interfaceBlock(declarations, 'GitPort')
  for (const [name, block] of [['WorktreePort', worktreeBlock], ['GitPort', gitBlock]]) {
    assert.equal(/\bpush\b/.test(block), false, `${name} must not declare a push: a local port cannot rewrite a remote`)
  }
})
