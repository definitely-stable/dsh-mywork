/**
 * Team Work acceptance (architecture §13, §35).
 *
 * The instance cycle from sleep to sleep must hold, the attempt binding must be
 * enforced, the failure paths must be terminal for the instance, the contract
 * must stay outside the learning loop, and an admitted attempt must keep the
 * revisions it resolved however the registry moves afterwards.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  blueprintFixture,
  contracts,
  core,
  identityFixture,
  instanceFixture,
  meta,
  roleFixture,
} from './lib/fixtures.mjs'

const M = meta()

/** Resolved configuration of a workspace, optionally pinning a blueprint. */
function configFor(workspaceId, blueprints = {}) {
  const layers = Object.keys(blueprints).length === 0
    ? []
    : [{ layer: 'team', revision: 1, values: { blueprints } }]
  const resolved = core.resolveWorkspaceConfig(
    { workspaceId, layers, revisions: core.createConfigRevisionRegistry() },
    M,
  )
  assert.equal(resolved.ok, true, resolved.ok ? '' : resolved.error.message)
  return resolved.value
}

test('an instance wakes, runs its attempt, settles, and sleeps again', () => {
  let instance = instanceFixture()
  const steps = [
    { to: 'waking', at: 1_000 },
    { to: 'running', at: 1_001, attemptId: 'A-1' },
    { to: 'settling', at: 1_002 },
    { to: 'sleeping', at: 1_003 },
  ]
  for (const step of steps) {
    const result = core.transitionAgentInstance(instance, step, M)
    assert.equal(result.ok, true, `→ ${step.to}: ${result.ok ? '' : result.error.message}`)
    instance = result.value.instance
    assert.equal(result.value.events[0].type, 'agent.instance.state.changed')
  }
  assert.equal(instance.state, 'sleeping')
  assert.equal(instance.attemptId, undefined, 'a sleeping instance holds no attempt')
  assert.equal(instance.since, 1_003)
})

test('the attempt binding of an instance state is enforced', () => {
  const waking = instanceFixture({ state: 'waking', since: 1_000 })
  const withoutAttempt = core.transitionAgentInstance(waking, { to: 'running', at: 1_001 }, M)
  assert.equal(withoutAttempt.ok, false)
  assert.equal(withoutAttempt.error.code, 'TASK_CONFLICT')
  assert.match(withoutAttempt.error.message, /without an attempt/)

  const running = instanceFixture({ state: 'running', since: 1_000, attemptId: 'A-1' })
  const settling = core.transitionAgentInstance(running, { to: 'settling', at: 1_001 }, M)
  assert.equal(settling.ok, true)
  assert.equal(settling.value.instance.attemptId, 'A-1', 'settling keeps the attempt it is winding down')

  const terminated = core.transitionAgentInstance(running, { to: 'terminated', at: 1_002 }, M)
  assert.equal(terminated.ok, true)
  assert.equal(terminated.value.instance.attemptId, undefined, 'a terminated instance holds no attempt')
})

test('every pair outside the transition table is refused with TASK_CONFLICT', () => {
  let refused = 0
  for (const from of contracts.AGENT_INSTANCE_STATES) {
    for (const to of contracts.AGENT_INSTANCE_STATES) {
      if (core.canTransitionAgentInstance(from, to)) continue
      const instance = instanceFixture({
        state: from,
        since: 1_000,
        ...(core.AGENT_INSTANCE_STATES_WITH_ATTEMPT.includes(from) ? { attemptId: 'A-1' } : {}),
      })
      const result = core.transitionAgentInstance(instance, { to, at: 2_000, attemptId: 'A-1' }, M)
      assert.equal(result.ok, false, `${from} → ${to} must be refused`)
      assert.equal(result.error.code, 'TASK_CONFLICT')
      refused += 1
    }
  }
  assert.ok(refused >= 20, `expected the sweep to cover the instance matrix, covered ${refused}`)
})

test('the failure states are terminal for an instance', () => {
  for (const state of ['failed', 'revoked', 'terminated']) {
    assert.deepEqual(core.allowedAgentInstanceTransitions(state), [])
    const result = core.transitionAgentInstance(instanceFixture({ state, since: 1_000 }), { to: 'waking', at: 2_000 }, M)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'TASK_CONFLICT')
  }
  assert.deepEqual(contracts.AGENT_INSTANCE_ACTIVE_STATES, ['waking', 'running', 'settling'])
})

test('a blueprint may never exceed the ceiling of its role contract', () => {
  const role = roleFixture()
  const withinCeiling = core.assertBlueprintWithinRoleContract(role, blueprintFixture({ permissions: ['workspace.read', 'tests'] }), M)
  assert.equal(withinCeiling.ok, true, 'a subset of the contract is allowed')

  const widened = core.assertBlueprintWithinRoleContract(
    role,
    blueprintFixture({ permissions: [...role.contract.workflowPermissions, 'review.approve'] }),
    M,
  )
  assert.equal(widened.ok, false)
  assert.equal(widened.error.code, 'SECURITY_DENIED')
  assert.equal(widened.error.details.permission, 'review.approve')

  const foreign = core.assertBlueprintWithinRoleContract(role, blueprintFixture({ roleId: 'frontend-developer' }), M)
  assert.equal(foreign.ok, false)
  assert.equal(foreign.error.code, 'CONTRACT_MISMATCH')
})

test('learning evolves the strategy and can never rewrite the contract', () => {
  const role = roleFixture()
  const learned = core.applyStrategyLearning(
    role,
    { strategy: { ...role.strategy, researchApproach: ['reproduce the failure first'] } },
    M,
  )
  assert.equal(learned.ok, true, learned.ok ? '' : learned.error.message)
  assert.equal(learned.value.strategyRevision, role.strategyRevision + 1)
  assert.equal(learned.value.contractRevision, role.contractRevision, 'learning does not move the contract revision')
  assert.equal(learned.value.contract, role.contract, 'the contract keeps its identity')
  assert.equal(Object.isFrozen(learned.value), true)
  assert.equal(Object.isFrozen(role), true, 'publishing a successor freezes the role it supersedes')

  for (const smuggle of [{ contract: role.contract }, { contractRevision: 99 }, { contract: undefined }]) {
    const refused = core.applyStrategyLearning(role, { strategy: role.strategy, ...smuggle }, M)
    assert.equal(refused.ok, false, `a payload carrying ${Object.keys(smuggle)[0]} must be refused`)
    assert.equal(refused.error.code, 'SECURITY_DENIED')
  }

  const insideStrategy = () => core.applyStrategyLearning(
    role,
    { strategy: { ...role.strategy, contract: role.contract } },
    M,
  )
  assert.throws(insideStrategy, TypeError, 'the strategy is a closed shape too')
})

test('a proposal that changes nothing publishes no revision', () => {
  const role = roleFixture()
  const sameStrategy = core.applyStrategyLearning(role, { strategy: { ...role.strategy } }, M)
  assert.equal(sameStrategy.ok, true)
  assert.equal(sameStrategy.value, role, 'an empty proposal is not a revision')
  assert.equal(sameStrategy.value.strategyRevision, role.strategyRevision)

  const sameContract = core.reviseRoleContract(role, { ...role.contract }, M)
  assert.equal(sameContract.ok, true)
  assert.equal(sameContract.value, role, 'a contract identical to the current one is not a new revision')
  assert.equal(sameContract.value.contractRevision, role.contractRevision)

  const blueprint = blueprintFixture()
  const sameBlueprint = core.reviseBlueprint(blueprint, {}, M)
  assert.equal(sameBlueprint.ok, true)
  assert.equal(sameBlueprint.value, blueprint)
  assert.equal(sameBlueprint.value.revision, blueprint.revision)
})

test('the closed §13 shapes refuse a field they do not declare', () => {
  const role = roleFixture()
  const blueprint = blueprintFixture()

  assert.throws(
    () => core.reviseRoleContract(role, { ...role.contract, approveOwnWork: true }, M),
    TypeError,
    'a smuggled contract field must not travel on a published revision',
  )
  assert.throws(
    () => core.applyStrategyLearning(role, { strategy: { ...role.strategy, extra: 'x' } }, M),
    TypeError,
  )
  assert.throws(
    () => core.reviseBlueprint(blueprint, { extra: 'x' }, M),
    TypeError,
    'a blueprint change may only carry blueprint fields',
  )
  assert.throws(
    () => core.assertBlueprintWithinRoleContract(role, { ...blueprint, extra: 'x' }, M),
    TypeError,
  )

  // A malformed contract shape is a caller error (TypeError); an identity that
  // carries an undeclared field is refused as a Result, because an identity is a
  // value the store hands back and admission must answer with a typed refusal.
  const smuggledIdentity = core.assertDurableIdentity(identityFixture({ extra: 'x' }), M)
  assert.equal(smuggledIdentity.ok, false)
  assert.equal(smuggledIdentity.error.code, 'CONTRACT_MISMATCH')
  assert.equal(smuggledIdentity.error.details.field, 'extra')
})

test('a published contract revision leaves the strategy where it was', () => {
  const role = roleFixture()
  const narrowed = { ...role.contract, workflowPermissions: ['workspace.read'] }
  const revised = core.reviseRoleContract(role, narrowed, M)
  assert.equal(revised.ok, true, revised.ok ? '' : revised.error.message)
  assert.equal(revised.value.contractRevision, role.contractRevision + 1)
  assert.equal(revised.value.strategyRevision, role.strategyRevision)
  assert.equal(revised.value.strategy, role.strategy, 'the strategy is carried over untouched')

  const refused = core.assertBlueprintWithinRoleContract(revised.value, blueprintFixture(), M)
  assert.equal(refused.ok, false, 'a blueprint that used the removed permission is refused after the narrowing')
  assert.equal(refused.error.code, 'SECURITY_DENIED')
})

test('a published blueprint revision leaves the previous one untouched', () => {
  const blueprint = blueprintFixture()
  const next = core.reviseBlueprint(blueprint, { reasoning: 'medium' }, M)
  assert.equal(next.ok, true, next.ok ? '' : next.error.message)
  assert.equal(next.value.revision, blueprint.revision + 1)
  assert.equal(next.value.reasoning, 'medium')
  assert.equal(blueprint.revision, 17, 'the previous revision is not moved')
  assert.equal(blueprint.reasoning, 'high')
  assert.equal(Object.isFrozen(next.value), true)
  assert.equal(Object.isFrozen(blueprint), true, 'publishing the successor freezes the revision it supersedes')
  assert.throws(() => {
    blueprint.reasoning = 'low'
  }, TypeError, 'a published revision is immutable at runtime, not only by contract')

  const forged = core.reviseBlueprint(blueprint, { revision: 99 }, M)
  assert.equal(forged.ok, false)
  assert.equal(forged.error.code, 'CONTRACT_MISMATCH')
  assert.equal(forged.error.details.field, 'revision')
})

test('an attempt freezes the revisions it resolved, and a later blueprint only reaches the next run', () => {
  const role = roleFixture()
  const blueprint = blueprintFixture()
  const identity = identityFixture()
  const pinned = configFor('W-1', { 'backend-developer-default': blueprint.revision })

  const admission = core.resolveAttemptRevisions({ identity, role, blueprint, config: pinned }, M)
  assert.equal(admission.ok, true, admission.ok ? '' : admission.error.message)
  assert.deepEqual(admission.value.revisions, {
    config: pinned.configRevision,
    role: role.contractRevision,
    'role-strategy': role.strategyRevision,
    'agent-blueprint': blueprint.revision,
  })
  assert.equal(Object.isFrozen(admission.value.revisions), true)
  assert.equal(admission.value.identity.blueprintRevision, 17)
  assert.deepEqual(admission.value.identity.workspaceOverlays, ['W-1'])
  assert.equal(admission.value.identity.revision, identity.revision + 1)

  const published = core.reviseBlueprint(blueprint, { reasoning: 'medium' }, M)
  assert.equal(published.ok, true)
  assert.equal(
    admission.value.revisions['agent-blueprint'],
    17,
    'the running attempt keeps the revision it was admitted with (§35)',
  )

  const nextConfig = configFor('W-1', { 'backend-developer-default': published.value.revision })
  const later = core.resolveAttemptRevisions(
    { identity: admission.value.identity, role, blueprint: published.value, config: nextConfig },
    M,
  )
  assert.equal(later.ok, true, later.ok ? '' : later.error.message)
  assert.equal(later.value.revisions['agent-blueprint'], 18, 'the next admission resolves the new revision')
  assert.equal(later.value.identity.blueprintRevision, 18)

  const repeat = core.resolveAttemptRevisions(
    { identity: later.value.identity, role, blueprint: published.value, config: nextConfig },
    M,
  )
  assert.equal(repeat.ok, true)
  assert.equal(repeat.value.identity.revision, later.value.identity.revision, 'an unchanged resolution is not a change')

  const stale = core.resolveAttemptRevisions({ identity, role, blueprint, config: configFor('W-1', { 'backend-developer-default': 16 }) }, M)
  assert.equal(stale.ok, false, 'the workspace pin decides which revision its attempts may run')
  assert.equal(stale.error.code, 'STALE_REVISION')
  assert.equal(stale.error.details.pinned, 16)
})

test('the durable identity carries references, never the running attempt or session', () => {
  const role = roleFixture()
  const blueprint = blueprintFixture()
  const config = configFor('W-1')

  const withRefs = identityFixture({ sessionRefs: ['session-1'] })
  assert.equal(core.assertDurableIdentity(withRefs, M).ok, true, 'a session reference is part of §13.4')

  for (const field of contracts.IDENTITY_RUNTIME_FIELDS) {
    const poisoned = identityFixture({ [field]: field === 'attemptId' ? 'A-1' : 'live-value' })
    const refused = core.resolveAttemptRevisions({ identity: poisoned, role, blueprint, config }, M)
    assert.equal(refused.ok, false, `an identity carrying "${field}" must be refused`)
    assert.equal(refused.error.code, 'CONTRACT_MISMATCH')
    assert.equal(refused.error.details.field, field)
  }

  // A denylist of runtime names is escapable by renaming the field: the identity
  // is a closed shape, so any field outside §13.4 is refused with its own name.
  for (const field of ['liveAttempt', 'currentSession', 'runtimeHandle', 'pool']) {
    const renamed = identityFixture({ [field]: { id: 'A-1', state: 'running' } })
    const refused = core.resolveAttemptRevisions({ identity: renamed, role, blueprint, config }, M)
    assert.equal(refused.ok, false, `an identity carrying "${field}" must be refused`)
    assert.equal(refused.error.code, 'CONTRACT_MISMATCH')
    assert.equal(refused.error.details.field, field)
  }

  const admission = core.resolveAttemptRevisions({ identity: identityFixture(), role, blueprint, config }, M)
  assert.equal(admission.ok, true)
  for (const field of contracts.IDENTITY_RUNTIME_FIELDS) {
    assert.equal(field in admission.value.identity, false, `the admitted identity must not gain "${field}"`)
  }
  assert.deepEqual(
    Object.keys(admission.value.identity).sort(),
    [...contracts.IDENTITY_FIELDS].sort(),
    'the retargeted identity carries exactly the §13.4 fields',
  )

  const wrongRole = core.resolveAttemptRevisions(
    { identity: identityFixture({ roleId: 'frontend-developer' }), role, blueprint, config },
    M,
  )
  assert.equal(wrongRole.ok, false)
  assert.equal(wrongRole.error.code, 'CONTRACT_MISMATCH')
})
