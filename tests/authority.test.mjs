/**
 * Authority matrix acceptance (architecture §8).
 *
 * The table must reproduce the architecture row for row, and a write by a store
 * that does not own the domain must be refused rather than trusted.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { contracts, core, meta } from './lib/fixtures.mjs'

const M = meta()

/** The §8 rows, transcribed from the architecture. */
const EXPECTED_OWNERS = {
  'task.description': ['task-graph'],
  'task.dependencies': ['task-graph'],
  'task.readiness': ['task-graph'],
  'task.priority': ['task-graph'],
  'task.role-requirement': ['task-graph'],
  'task.board-placement': ['task-board'],
  'attempt.current': ['mywork-db'],
  'lease.fence': ['mywork-db', 'lease-store'],
  'agent.session-ids': ['mywork-db'],
  'workspace.git-refs': ['mywork-db'],
  'review.attempt': ['mywork-db'],
  'review.findings': ['mywork-db', 'artifact-store'],
  'approval.human': ['mywork-db', 'mywork-audit'],
  'task.completion': ['task-graph'],
  'session.events': ['dsh-session-store'],
  'evidence.build': ['artifact-store'],
  'memory.semantic': ['memory-provider'],
  'skills.registry': ['skill-registry'],
  'registry.revisions': ['mywork-registry'],
  'audit.log': ['mywork-audit'],
}

test('the matrix reproduces every authority row of the architecture', () => {
  assert.deepEqual([...core.authorityDomains()].sort(), Object.keys(EXPECTED_OWNERS).sort())
  for (const [domain, owners] of Object.entries(EXPECTED_OWNERS)) {
    const row = core.authorityOf(domain)
    assert.deepEqual([...row.owners], owners, `${domain} owners`)
    assert.equal(row.domain, domain)
  }
})

test('the Task Board is a projection, not a competing authority', () => {
  assert.equal(core.isProjectionDomain('task.board-placement'), true)
  assert.equal(core.primaryOwnerOf('task.board-placement'), 'task-board')
  const denied = core.assertWriteAuthority('task.completion', 'task-board', M)
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'SECURITY_DENIED')
  assert.deepEqual(denied.error.details.owners, ['task-graph'])
})

test('each domain has at least one owner and every owner is known', () => {
  for (const domain of core.authorityDomains()) {
    const row = core.authorityOf(domain)
    assert.ok(row.owners.length >= 1, `${domain} must have an owner`)
    for (const owner of row.owners) {
      assert.ok(contracts.AUTHORITY_MATRIX[domain].owners.includes(owner))
      assert.equal(typeof owner, 'string')
    }
    assert.equal(core.mayWrite(domain, core.primaryOwnerOf(domain)), true, `${domain} primary owner must write`)
  }
})

test('shared rows accept exactly their listed owners', () => {
  assert.equal(core.mayWrite('lease.fence', 'mywork-db'), true)
  assert.equal(core.mayWrite('lease.fence', 'lease-store'), true)
  assert.equal(core.mayWrite('lease.fence', 'task-graph'), false)
  assert.equal(core.mayWrite('review.findings', 'artifact-store'), true)
  assert.equal(core.mayWrite('review.findings', 'task-board'), false)
  assert.equal(core.mayWrite('approval.human', 'mywork-audit'), true)
  assert.equal(core.mayWrite('approval.human', 'memory-provider'), false)
})

test('a write by a non-owner is refused with SECURITY_DENIED', () => {
  const refused = [
    ['task.description', 'task-board'],
    ['task.priority', 'mywork-db'],
    ['attempt.current', 'task-graph'],
    ['memory.semantic', 'mywork-db'],
    ['session.events', 'mywork-db'],
    ['audit.log', 'mywork-registry'],
  ]
  for (const [domain, owner] of refused) {
    const result = core.assertWriteAuthority(domain, owner, M)
    assert.equal(result.ok, false, `${owner} must not write ${domain}`)
    assert.equal(result.error.code, 'SECURITY_DENIED')
    assert.equal(result.error.details.domain, domain)
    assert.equal(result.error.details.owner, owner)
  }

  const allowed = core.assertWriteAuthority('task.description', 'task-graph', M)
  assert.equal(allowed.ok, true)
  assert.equal(allowed.value.domain, 'task.description')
})

test('an unknown domain is a programming error', () => {
  assert.throws(() => core.authorityOf('task.unknown'), TypeError)
  assert.throws(() => core.primaryOwnerOf(''), TypeError)
})
