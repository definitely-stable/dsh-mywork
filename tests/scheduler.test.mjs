/**
 * Scheduler and pools acceptance (architecture §14, §15, §16, §27, §30).
 *
 * The suite drives the deterministic decision against literal state, so every
 * branch is decided by data rather than by a live system: eligibility by role,
 * capability, contract, workspace, security, route, and budget; the §14 pool,
 * role, and workspace ceilings; the §15 attempt, LLM, and heavy-tool limits; the
 * §16.4 weighted fairness between workspaces; and the §16.2 runtime that kicks
 * the decision on an event, on the startup path, and on the safety timer.
 *
 * Two claims are checked against the runtime rather than the policy: a tick with
 * nothing admissible performs no side effect at all, and a reconcile recovers an
 * event that was never delivered.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import {
  blueprintFixture,
  contracts,
  core,
  identityFixture,
  repoRoot,
  reviewFixture,
  scheduler as runtime,
  taskFixture,
} from './lib/fixtures.mjs'

const NOW = 1_000_000
const AGING_STEP = 300_000

/** The development catalog: the flashed model the card pins, plus one fallback provider. */
function catalog(overrides = {}) {
  return {
    providers: [
      { id: 'opencode-go', name: 'OpenCode Go' },
      { id: 'glm', name: 'GLM' },
    ],
    models: [],
    outages: [],
    ...overrides,
  }
}

/** The development routing policy (§62 item 7). */
function policy(overrides = {}) {
  return { preferred: 'opencode-go/deepseek-v4.1-flash', fallback: [], escalation: [], ...overrides }
}

/** A worker role: the contract is the ceiling for its blueprints (§13.2). */
function role(overrides = {}) {
  return {
    id: 'backend-developer',
    contractRevision: 4,
    strategyRevision: 7,
    contract: {
      purpose: 'Implement backend changes',
      requiredCapabilities: ['workspace.read', 'shell'],
      workflowPermissions: ['workspace.read', 'workspace.write', 'shell', 'tests', 'task.transition'],
      prohibitedActions: ['approve own work'],
      outputContract: 'A diff plus the commands that verify it',
      reviewContract: 'An independent reviewer sees the diff and the evidence',
    },
    strategy: {
      researchApproach: ['read the failing test first'],
      strategyModules: ['small-diff'],
      modelPolicy: policy(),
      skillPolicy: { allowed: ['testing'], denied: [] },
      learningPolicy: { strategyEvolution: true, memoryPromotion: false },
    },
    ...overrides,
  }
}

/** A worker blueprint of {@link role}. */
function blueprint(overrides = {}) {
  return {
    ...blueprintFixture(),
    permissions: ['workspace.read', 'workspace.write', 'shell', 'tests', 'task.transition'],
    modelPolicy: policy(),
    pool: 'workers',
    ...overrides,
  }
}

/** A reviewer role: §31 gives it the read side plus the approval, never a write. */
function reviewerRole(overrides = {}) {
  return {
    id: 'code-reviewer',
    contractRevision: 2,
    strategyRevision: 3,
    contract: {
      purpose: 'Review an attempt against its evidence',
      requiredCapabilities: ['workspace.read', 'git.read'],
      workflowPermissions: ['workspace.read', 'git.read', 'tests', 'review.approve'],
      prohibitedActions: ['write the implementation it reviews'],
      outputContract: 'Structured findings bound to the reviewed head SHA',
      reviewContract: 'A second reviewer sees the same artifact',
    },
    strategy: {
      researchApproach: [],
      strategyModules: [],
      modelPolicy: policy(),
      skillPolicy: { allowed: [], denied: [] },
      learningPolicy: { strategyEvolution: true, memoryPromotion: false },
    },
    ...overrides,
  }
}

/** A reviewer blueprint: read-only plus the approval, drawn from the reviewer pool (§27). */
function reviewerBlueprint(overrides = {}) {
  return {
    ...blueprintFixture({ id: 'code-reviewer-default', roleId: 'code-reviewer' }),
    permissions: ['workspace.read', 'git.read', 'tests', 'review.approve'],
    modelPolicy: policy(),
    pool: 'reviewers',
    ...overrides,
  }
}

/** One identity with the role and blueprint it runs. */
function agent(id, roleValue, blueprintValue) {
  return {
    identity: identityFixture({
      id,
      roleId: roleValue.id,
      blueprintId: blueprintValue.id,
      blueprintRevision: blueprintValue.revision,
    }),
    role: roleValue,
    blueprint: blueprintValue,
  }
}

/** A worker identity of the default worker role. */
function worker(id = 'Neo-1', overrides = {}) {
  const roleValue = overrides.role ?? role()
  const blueprintValue = overrides.blueprint ?? blueprint({ roleId: roleValue.id })
  return agent(id, roleValue, blueprintValue)
}

/** A reviewer identity of the default reviewer role. */
function reviewer(id = 'Neo-2', overrides = {}) {
  const roleValue = overrides.role ?? reviewerRole()
  const blueprintValue = overrides.blueprint ?? reviewerBlueprint({ roleId: roleValue.id })
  return agent(id, roleValue, blueprintValue)
}

/** One workspace as the scheduler reads it (§14, §16.2, §16.4, §30, §31). */
function workspace(overrides = {}) {
  return {
    workspaceId: 'W-1',
    enabled: true,
    root: 'H:\\Repo\\DSH-MyWork',
    harnessPolicy: 'workspace-write',
    pools: {
      workers: { minActive: 0, maxActive: 6 },
      reviewers: { minActive: 0, maxActive: 2 },
    },
    roles: {},
    limits: { maxWorkers: 4, maxReviewers: 2 },
    budget: {},
    ledgers: [],
    ...overrides,
  }
}

/** One tick input. */
function tick(overrides = {}) {
  return {
    nowMs: NOW,
    kick: { source: 'reconcile' },
    workers: [],
    reviews: [],
    instances: [],
    agents: [],
    workspaces: [workspace()],
    catalog: catalog(),
    limits: { maxAttempts: 8, maxConcurrentLlm: 4, maxHeavyTools: 2 },
    policy: core.resolveSchedulerPolicy({ agingStepMs: AGING_STEP }),
    ...overrides,
  }
}

/** One ready task. The queue reading is the third argument, so a test can age it. */
function ready(id, overrides = {}, readySince = NOW) {
  return { task: taskFixture({ id, workspaceId: 'W-1', state: 'ready', ...overrides }), readySince }
}

/** One instance observation. */
function instance(overrides = {}) {
  return {
    instanceId: 'I-1',
    agentId: 'Neo-1',
    pool: 'workers',
    roleId: 'backend-developer',
    workspaceId: 'W-1',
    resource: 'model-active',
    ...overrides,
  }
}

/** One queued review. */
function queued(reviewId = 'R-1', overrides = {}) {
  return {
    review: reviewFixture({ id: reviewId, taskId: 'T-1' }),
    workspaceId: 'W-1',
    producerAgentId: 'Neo-1',
    readySince: NOW,
    ...overrides,
  }
}

/** The stable, comparable form of a plan. */
function stable(plan) {
  return JSON.parse(JSON.stringify(plan))
}

/** Reasons of the deferrals of one plan, in order. */
function reasons(plan) {
  return plan.deferrals.map(deferral => deferral.reason)
}

test('the same state produces the same plan, whatever order the caller listed it in', () => {
  const agents = [worker('Neo-3'), worker('Neo-1'), worker('Neo-2')]
  const workers = [
    ready('T-3', { workspaceId: 'W-2', priority: 2 }),
    ready('T-1'),
    ready('T-2', { priority: 2 }),
  ]
  const workspaces = [workspace({ workspaceId: 'W-2' }), workspace({ workspaceId: 'W-1' })]
  const state = tick({ agents, workers, workspaces })

  const first = core.planSchedulerTick(state)
  const second = core.planSchedulerTick(state)
  assert.deepEqual(stable(first), stable(second), 'one state, one plan')

  const shuffled = tick({
    agents: [agents[1], agents[2], agents[0]],
    workers: [workers[2], workers[0], workers[1]],
    workspaces: [workspaces[1], workspaces[0]],
  })
  assert.deepEqual(
    stable(core.planSchedulerTick(shuffled)),
    stable(first),
    'the plan is a function of the state, not of the order the arrays arrived in',
  )
  assert.deepEqual(
    first.admissions.map(admission => [admission.workspaceId, admission.taskId, admission.agentId]),
    [
      ['W-1', 'T-2', 'Neo-1'],
      ['W-2', 'T-3', 'Neo-1'],
      ['W-1', 'T-1', 'Neo-1'],
    ],
    'the weighted rounds decide the order, and within a workspace rank does: priority first, then the lower id',
  )
})

test('the plan is frozen, reports its occupancy, and never writes into its input', () => {
  const state = tick({ agents: [worker()], workers: [ready('T-1')], instances: [instance({ resource: 'sleeping' })] })
  const before = stable(state)
  const plan = core.planSchedulerTick(state)

  assert.equal(Object.isFrozen(plan), true)
  assert.equal(Object.isFrozen(plan.admissions), true)
  assert.equal(Object.isFrozen(plan.admissions[0]), true)
  assert.equal(Object.isFrozen(plan.occupancy), true)
  assert.deepEqual(stable(state), before, 'the decision reads its input and leaves it alone')
  assert.deepEqual(plan.occupancy, {
    activeAttempts: 0,
    llmCalls: 0,
    heavyTools: 0,
    pools: {},
    roles: {},
    workspaces: {},
  }, 'a sleeping instance holds nothing (§15)')
})

test('§15 resource states charge exactly the counters the architecture states', () => {
  assert.deepEqual(contracts.RESOURCE_STATES, [
    'model-active',
    'tool-active',
    'waiting-external',
    'waiting-dependency',
    'review-waiting',
    'idle',
    'sleeping',
  ])
  const charges = contracts.RESOURCE_STATE_CHARGES
  assert.deepEqual(charges['model-active'], {
    poolSlot: true,
    activeAttempt: true,
    llmSlot: true,
    heavyToolSlot: false,
  })
  assert.deepEqual(charges['tool-active'], {
    poolSlot: true,
    activeAttempt: true,
    llmSlot: false,
    heavyToolSlot: true,
  })
  for (const state of ['waiting-external', 'waiting-dependency', 'review-waiting']) {
    assert.deepEqual(charges[state], {
      poolSlot: true,
      activeAttempt: true,
      llmSlot: false,
      heavyToolSlot: false,
    }, `${state} holds its attempt but neither a model call nor a heavy tool`)
  }
  for (const state of ['idle', 'sleeping']) {
    assert.deepEqual(charges[state], {
      poolSlot: false,
      activeAttempt: false,
      llmSlot: false,
      heavyToolSlot: false,
    }, `${state} is warm or asleep and consumes nothing`)
  }

  const counted = core.countSchedulerOccupancy([
    instance({ instanceId: 'I-1', resource: 'model-active' }),
    instance({ instanceId: 'I-2', resource: 'tool-active', agentId: 'Neo-2' }),
    instance({ instanceId: 'I-3', resource: 'waiting-dependency' }),
    instance({ instanceId: 'I-4', resource: 'review-waiting', pool: 'reviewers', roleId: 'code-reviewer' }),
    instance({ instanceId: 'I-5', resource: 'idle' }),
    instance({ instanceId: 'I-6', resource: 'sleeping' }),
  ], core.resolveSchedulerPolicy())
  assert.equal(counted.activeAttempts, 4)
  assert.equal(counted.llmCalls, 1)
  assert.equal(counted.heavyTools, 1)
  assert.deepEqual(counted.pools, { workers: 3, reviewers: 1 })
  assert.deepEqual(counted.workspaces, { 'W-1': { workers: 3, reviewers: 1 } })
  assert.throws(() => core.countSchedulerOccupancy([instance({ resource: 'running' })], core.resolveSchedulerPolicy()), TypeError)
})

test('the worker pool never admits past its §14 ceiling', () => {
  const plan = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: Array.from({ length: 10 }, (_unused, index) => ready(`T-${index + 1}`)),
    workspaces: [workspace({ pools: { workers: { minActive: 0, maxActive: 3 }, reviewers: { minActive: 0, maxActive: 2 } } })],
  }))
  assert.equal(plan.admissions.length, 3, 'maxActive is a ceiling, not a hint')
  assert.equal(plan.deferrals.length, 7)
  assert.deepEqual(new Set(reasons(plan)), new Set(['pool-capacity']))
  assert.deepEqual(
    plan.admissions.map(admission => admission.taskId),
    ['T-1', 'T-10', 'T-2'],
    'equal rank is broken by the identifier, compared lexicographically so the order is platform-independent',
  )
  assert.deepEqual(plan.occupancy.pools, {}, 'the occupancy is what the tick read, before its own admissions')
})

test('a declared ceiling of zero is a hard stop, not an absent limit', () => {
  const plan = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1')],
    workspaces: [workspace({ pools: { workers: { minActive: 0, maxActive: 0 } } })],
  }))
  assert.equal(plan.admissions.length, 0)
  assert.deepEqual(reasons(plan), ['pool-capacity'])
})

test('the workspace ceiling is the tighter of §14 and §16.4, and the role ceiling bounds its role', () => {
  const capped = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1'), ready('T-2'), ready('T-3')],
    workspaces: [workspace({ limits: { maxWorkers: 4, maxReviewers: 2 }, scheduling: { weight: 1, maxWorkers: 2 } })],
  }))
  assert.equal(capped.admissions.length, 2, 'a stated ceiling never widens another')
  assert.deepEqual(reasons(capped), ['workspace-capacity'])

  const roleCapped = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1'), ready('T-2'), ready('T-3')],
    workspaces: [workspace({ roles: { 'backend-developer': { maxActive: 1 } } })],
  }))
  assert.equal(roleCapped.admissions.length, 1)
  assert.deepEqual(reasons(roleCapped), ['role-capacity', 'role-capacity'])

  const noLimits = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1'), ready('T-2')],
    workspaces: [workspace({ limits: undefined, pools: {} })],
  }))
  assert.equal(noLimits.admissions.length, 2, 'a limit nobody declared is not checked (§14, §30)')
})

test('§15 ceilings: the tick reserves attempts, and reads the two phase counters as saturation', () => {
  const attemptCapped = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1')],
    instances: [instance({ instanceId: 'I-1' }), instance({ instanceId: 'I-2', agentId: 'Neo-2' })],
    limits: { maxAttempts: 2, maxConcurrentLlm: 4, maxHeavyTools: 2 },
  }))
  assert.deepEqual(reasons(attemptCapped), ['attempt-limit'])
  assert.equal(attemptCapped.occupancy.activeAttempts, 2)

  const llmCapped = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1')],
    instances: [instance({ instanceId: 'I-1' }), instance({ instanceId: 'I-2', agentId: 'Neo-2' })],
    limits: { maxAttempts: 8, maxConcurrentLlm: 2, maxHeavyTools: 2 },
  }))
  assert.deepEqual(reasons(llmCapped), ['llm-limit'])
  assert.equal(llmCapped.occupancy.llmCalls, 2)

  const toolCapped = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1')],
    instances: [
      instance({ instanceId: 'I-1', resource: 'tool-active' }),
      instance({ instanceId: 'I-2', resource: 'tool-active', agentId: 'Neo-2' }),
    ],
    limits: { maxAttempts: 8, maxConcurrentLlm: 4, maxHeavyTools: 2 },
  }))
  assert.deepEqual(reasons(toolCapped), ['heavy-tool-limit'])
  assert.equal(toolCapped.occupancy.heavyTools, 2)
  assert.equal(toolCapped.occupancy.llmCalls, 0, 'a heavy tool is not a model call')

  // §15 `maxAttempts` counts attempts, which is the activity a tick creates, so
  // the plan reserves one slot per admission: 1 active attempt of a ceiling of 3
  // leaves room for exactly two admissions inside this tick.
  const attemptsReserved = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1'), ready('T-2'), ready('T-3'), ready('T-4')],
    instances: [instance({ instanceId: 'I-1' })],
    workspaces: [workspace({ limits: { maxWorkers: 8, maxReviewers: 2 } })],
    limits: { maxAttempts: 3, maxConcurrentLlm: 8, maxHeavyTools: 8 },
  }))
  assert.equal(attemptsReserved.admissions.length, 2, 'two free attempt slots, two admissions')
  assert.deepEqual(reasons(attemptsReserved), ['attempt-limit', 'attempt-limit'])

  // A model call and a heavy tool are phases an attempt enters after admission,
  // so the tick does not reserve them: below the ceiling it keeps filling, and the
  // runtime that starts the phase enforces the ceiling itself.
  const phasesAreObserved = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1'), ready('T-2')],
    instances: [instance({ instanceId: 'I-1', resource: 'tool-active' })],
    limits: { maxAttempts: 8, maxConcurrentLlm: 4, maxHeavyTools: 2 },
  }))
  assert.equal(phasesAreObserved.admissions.length, 2, 'one heavy tool of a ceiling of two leaves the tick filling')
  assert.deepEqual(phasesAreObserved.deferrals, [])
  assert.equal(phasesAreObserved.occupancy.heavyTools, 1)
})

test('§16.4 weights bound what one workspace takes from a shared pool', () => {
  const plan = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [
      ...Array.from({ length: 5 }, (_unused, index) => ready(`A-${index + 1}`)),
      ...Array.from({ length: 5 }, (_unused, index) => ready(`B-${index + 1}`, { workspaceId: 'W-2' })),
    ],
    workspaces: [
      workspace({
        workspaceId: 'W-1',
        scheduling: { weight: 2, maxWorkers: 4 },
        pools: { workers: { minActive: 0, maxActive: 3 }, reviewers: { minActive: 0, maxActive: 2 } },
      }),
      workspace({ workspaceId: 'W-2', scheduling: { weight: 1, maxWorkers: 3 } }),
    ],
  }))
  assert.deepEqual(
    plan.admissions.map(admission => admission.workspaceId),
    ['W-1', 'W-1', 'W-2'],
    'the round is weighted, not first-come: two shares for the weight-2 workspace, one for the weight-1 one',
  )
  assert.deepEqual(reasons(plan), Array.from({ length: 7 }, () => 'pool-capacity'))
})

test('a workspace with the only work in the team still cannot exceed its own ceiling', () => {
  const plan = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: Array.from({ length: 6 }, (_unused, index) => ready(`T-${index + 1}`)),
    workspaces: [workspace({ scheduling: { weight: 2, maxWorkers: 2 } })],
  }))
  assert.equal(plan.admissions.length, 2, 'fairness bounds a share; the workspace ceiling bounds the whole')
  assert.deepEqual(reasons(plan), Array.from({ length: 4 }, () => 'workspace-capacity'))
})

test('a workspace without a §16.4 entry gets the policy default weight', () => {
  assert.equal(core.resolveSchedulerPolicy({}).defaultWorkspaceWeight, 1)
  const plan = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [
      ...Array.from({ length: 3 }, (_unused, index) => ready(`A-${index + 1}`)),
      ...Array.from({ length: 3 }, (_unused, index) => ready(`B-${index + 1}`, { workspaceId: 'W-2' })),
    ],
    workspaces: [workspace({ workspaceId: 'W-1' }), workspace({ workspaceId: 'W-2' })],
  }))
  assert.deepEqual(
    plan.admissions.map(admission => admission.workspaceId),
    ['W-1', 'W-2', 'W-1', 'W-2', 'W-1', 'W-2'],
    'equal weights take equal turns, one admission at a time',
  )
})

test('priority orders the work, and aging overtakes it once the wait is long enough', () => {
  const priorityWins = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-high', { priority: 5 }), ready('T-low', {}, NOW - AGING_STEP)],
    workspaces: [workspace({ pools: { workers: { minActive: 0, maxActive: 1 } } })],
  }))
  assert.equal(priorityWins.admissions[0].taskId, 'T-high')
  assert.deepEqual(priorityWins.admissions[0].rank, { priority: 5, agingMs: 0, agingBonus: 0, score: 5 })
  assert.deepEqual(priorityWins.deferrals[0].rank, { priority: 0, agingMs: AGING_STEP, agingBonus: 1, score: 1 })

  const agingWins = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-high', { priority: 5 }), ready('T-low', {}, NOW - 6 * AGING_STEP)],
    workspaces: [workspace({ pools: { workers: { minActive: 0, maxActive: 1 } } })],
  }))
  assert.equal(agingWins.admissions[0].taskId, 'T-low')
  assert.equal(agingWins.admissions[0].rank.score, 6, 'six whole steps of waiting beat a priority of five')

  const boundary = core.schedulerRank({ priority: 0, readySince: NOW - AGING_STEP, nowMs: NOW, agingStepMs: AGING_STEP })
  assert.equal(boundary.agingBonus, 1, 'a full step is a step')
  const justUnder = core.schedulerRank({ priority: 0, readySince: NOW - AGING_STEP + 1, nowMs: NOW, agingStepMs: AGING_STEP })
  assert.equal(justUnder.agingBonus, 0)
  const clockSkew = core.schedulerRank({ priority: 0, readySince: NOW + 10_000, nowMs: NOW, agingStepMs: AGING_STEP })
  assert.equal(clockSkew.agingMs, 0, 'a reading from the future ages nothing instead of going negative')
  assert.throws(() => core.schedulerRank({ priority: 1.5, readySince: NOW, nowMs: NOW, agingStepMs: AGING_STEP }), TypeError)
})

test('eligibility by role, capability, contract, security, route, and budget, each with its own reason', () => {
  const cases = [
    {
      name: 'role-mismatch',
      agents: [worker()],
      workers: [ready('T-1', { roleRequirement: 'frontend-developer' })],
    },
    {
      name: 'capability-unsatisfied',
      agents: [worker('Neo-1', {
        role: role({ contract: { ...role().contract, requiredCapabilities: ['workspace.read', 'shell', 'git.write'] } }),
      })],
      workers: [ready('T-1')],
    },
    {
      name: 'contract-mismatch',
      agents: [worker('Neo-1', {
        role: role({
          contract: { ...role().contract, workflowPermissions: ['workspace.read', 'shell', 'tests', 'task.transition'] },
        }),
      })],
      workers: [ready('T-1')],
    },
    {
      name: 'security-denied',
      agents: [worker('Neo-1', {
        role: role({
          contract: {
            ...role().contract,
            workflowPermissions: ['workspace.read', 'workspace.write', 'shell', 'tests'],
          },
        }),
        blueprint: blueprint({
          roleId: 'backend-developer',
          permissions: ['workspace.read', 'workspace.write', 'shell', 'tests'],
        }),
      })],
      workers: [ready('T-1')],
    },
    {
      name: 'route-unavailable',
      agents: [worker('Neo-1', { blueprint: blueprint({ modelPolicy: policy({ preferred: 'ghost/model' }) }) })],
      workers: [ready('T-1')],
    },
    {
      name: 'no-agent',
      agents: [],
      workers: [ready('T-1')],
    },
  ]

  for (const scenario of cases) {
    const plan = core.planSchedulerTick(tick({ agents: scenario.agents, workers: scenario.workers }))
    assert.equal(plan.admissions.length, 0, `${scenario.name}: nothing is admitted`)
    assert.deepEqual(reasons(plan), [scenario.name], `${scenario.name}: the reason names the gate that refused`)
  }

  const noLedger = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1')],
    workspaces: [workspace({ budget: { maxAttempts: 2 } })],
  }))
  assert.deepEqual(reasons(noLedger), ['budget-refused'], 'a declared limit without its scope ledger is unverifiable, never zero')

  const budgetAdmitted = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [{ ...ready('T-1'), budget: { consumption: { ...contracts.EMPTY_BUDGET_CONSUMPTION, attempts: 1 } } }],
    workspaces: [workspace({ budget: { maxAttempts: 2 } })],
  }))
  assert.equal(budgetAdmitted.admissions.length, 1, 'attempt 2 of a ceiling of 2 is inside the boundary (§30, MW-013 D1)')
  assert.deepEqual(budgetAdmitted.admissions[0].budgetScopes, ['task'])

  const budgetExhausted = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [{ ...ready('T-1'), budget: { consumption: { ...contracts.EMPTY_BUDGET_CONSUMPTION, attempts: 2 } } }],
    workspaces: [workspace({ budget: { maxAttempts: 2 } })],
  }))
  assert.deepEqual(reasons(budgetExhausted), ['budget-refused'], 'the next attempt past the ceiling is not admitted')

  const unmeasuredTokens = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [{ ...ready('T-1'), budget: { consumption: contracts.EMPTY_BUDGET_CONSUMPTION } }],
    workspaces: [workspace({ budget: { maxTokensPerTask: 1_000 } })],
  }))
  assert.deepEqual(reasons(unmeasuredTokens), ['budget-refused'], 'an unmeasured charge is not a free one (MW-013 D2)')
})

test('a disabled or unknown workspace is refused before any identity is considered', () => {
  const disabled = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1')],
    workspaces: [workspace({ enabled: false })],
  }))
  assert.deepEqual(reasons(disabled), ['workspace-disabled'])

  const unknown = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1', { workspaceId: 'W-404' })],
    workspaces: [workspace()],
  }))
  assert.deepEqual(reasons(unknown), ['workspace-unknown'])
})

test('a workspace that rosters its identities refuses work from an identity outside it (§6.1, §16.3)', () => {
  const rostered = core.planSchedulerTick(tick({
    agents: [worker('Neo-1'), worker('Neo-2')],
    workers: [ready('T-1')],
    workspaces: [workspace({ agentIds: ['Neo-2'] })],
  }))
  assert.equal(rostered.admissions.length, 1)
  assert.equal(rostered.admissions[0].agentId, 'Neo-2', 'the roster decides who may be scheduled here')

  const outside = core.planSchedulerTick(tick({
    agents: [worker('Neo-1')],
    workers: [ready('T-1')],
    workspaces: [workspace({ agentIds: ['Neo-2', 'Neo-3'] })],
  }))
  assert.deepEqual(reasons(outside), ['agent-not-in-workspace'])

  const reviewOutside = core.planSchedulerTick(tick({
    agents: [reviewer('Neo-2')],
    reviews: [queued('R-1')],
    workspaces: [workspace({ agentIds: ['Neo-1'] })],
  }))
  assert.deepEqual(reasons(reviewOutside), ['agent-not-in-workspace'], 'the roster binds reviewers too')

  const noRoster = core.planSchedulerTick(tick({
    agents: [worker('Neo-1')],
    workers: [ready('T-1')],
    workspaces: [workspace()],
  }))
  assert.equal(noRoster.admissions.length, 1, 'a workspace that states no roster states nothing (§30 convention)')

  const emptyRoster = core.planSchedulerTick(tick({
    agents: [worker('Neo-1')],
    workers: [ready('T-1')],
    workspaces: [workspace({ agentIds: [] })],
  }))
  assert.deepEqual(reasons(emptyRoster), ['agent-not-in-workspace'], 'a stated roster with nobody in it schedules nobody')

  // A roster is a security-shaped filter, so a malformed one is refused instead
  // of coerced: a string would make `includes` a substring match.
  assert.throws(
    () => core.planSchedulerTick(tick({
      agents: [worker('Neo-1')],
      workers: [ready('T-1')],
      workspaces: [workspace({ agentIds: 'xNeo-1x' })],
    })),
    TypeError,
    'a string roster is not a roster',
  )
  assert.throws(
    () => core.planSchedulerTick(tick({
      agents: [worker('Neo-1')],
      workers: [ready('T-1')],
      workspaces: [workspace({ agentIds: {} })],
    })),
    TypeError,
  )
  assert.throws(
    () => core.planSchedulerTick(tick({
      agents: [worker('Neo-1')],
      workers: [ready('T-1')],
      workspaces: [workspace({ agentIds: [''] })],
    })),
    TypeError,
    'an empty identity id is not an identity',
  )
})

test('model availability is read from the observed catalog, and a fallback route counts', () => {
  const fallback = core.planSchedulerTick(tick({
    agents: [worker('Neo-1', {
      blueprint: blueprint({ modelPolicy: policy({ preferred: 'ghost/model', fallback: ['opencode-go/deepseek-v4.1-flash'] }) }),
    })],
    workers: [ready('T-1')],
  }))
  assert.equal(fallback.admissions.length, 1, '§29 walks the policy, so one usable fallback is enough')

  const outage = core.planSchedulerTick(tick({
    agents: [worker()],
    workers: [ready('T-1')],
    catalog: catalog({ outages: [{ provider: 'opencode-go', detail: 'the provider did not answer' }] }),
  }))
  assert.deepEqual(reasons(outage), ['route-unavailable'])

  const availability = core.readRouteAvailability(
    policy({ preferred: 'ghost/model', fallback: ['opencode-go/deepseek-v4.1-flash'] }),
    catalog({ outages: [{ provider: 'opencode-go', detail: 'down' }] }),
  )
  assert.equal(availability.available, false)
  assert.equal(availability.reason, 'route-absent', 'the first candidate is the primary diagnosis, as in §29 routing')
  assert.equal(core.readRouteAvailability(policy(), catalog()).available, true)
  assert.equal(core.readRouteAvailability(policy({ preferred: 'not-a-route' }), catalog()).reason, 'invalid-route')
})

test('reviewers have their own pool, their own ceiling, and must not be the producer', () => {
  const plan = core.planSchedulerTick(tick({
    agents: [worker('Neo-1'), reviewer('Neo-2')],
    reviews: [queued('R-1')],
  }))
  assert.equal(plan.admissions.length, 1)
  assert.deepEqual(
    {
      kind: plan.admissions[0].kind,
      pool: plan.admissions[0].pool,
      agentId: plan.admissions[0].agentId,
      reviewId: plan.admissions[0].reviewId,
    },
    { kind: 'review', pool: 'reviewers', agentId: 'Neo-2', reviewId: 'R-1' },
  )
  assert.deepEqual(plan.admissions[0].budgetScopes, [], 'a review charges maxReviewLoops, and none is declared here')

  const selfReview = core.planSchedulerTick(tick({
    agents: [worker('Neo-1'), reviewer('Neo-2')],
    reviews: [queued('R-1', { producerAgentId: 'Neo-2' })],
  }))
  assert.deepEqual(reasons(selfReview), ['reviewer-not-independent'], '§31 refuses an identity reviewing its own attempt')

  const unknownProducer = core.planSchedulerTick(tick({
    agents: [reviewer('Neo-2')],
    reviews: [queued('R-1', { producerAgentId: undefined })],
  }))
  assert.deepEqual(reasons(unknownProducer), ['reviewer-not-independent'], 'independence that cannot be proven is not assumed')

  const noReviewer = core.planSchedulerTick(tick({ agents: [worker('Neo-1')], reviews: [queued('R-1')] }))
  assert.deepEqual(reasons(noReviewer), ['no-agent'], 'worker identities are not reviewer candidates (§27)')

  const reviewCapped = core.planSchedulerTick(tick({
    agents: [reviewer('Neo-2'), reviewer('Neo-3')],
    reviews: [queued('R-1'), queued('R-2', { review: reviewFixture({ id: 'R-2', taskId: 'T-2' }) })],
    workspaces: [workspace({ pools: { reviewers: { minActive: 0, maxActive: 1 } } })],
  }))
  assert.equal(reviewCapped.admissions.length, 1)
  assert.deepEqual(reasons(reviewCapped), ['pool-capacity'])

  const reviewBudget = core.planSchedulerTick(tick({
    agents: [reviewer('Neo-2')],
    reviews: [queued('R-1', { budget: { consumption: { ...contracts.EMPTY_BUDGET_CONSUMPTION, reviewLoops: 1 } } })],
    workspaces: [workspace({ budget: { maxReviewLoops: 1 } })],
  }))
  assert.deepEqual(reasons(reviewBudget), ['budget-refused'], 'a review loop is charged by maxReviewLoops, not by maxAttempts')

  // The price of reading `maxHeavyTools` as saturation (§15, D3): a saturated
  // tool ceiling stops the review queue too, because the gate is shared by both
  // kinds of work. Pinned here so the cost is a decision, not an accident (§7).
  const saturatedTools = core.planSchedulerTick(tick({
    agents: [worker('Neo-1'), reviewer('Neo-2')],
    workers: [ready('T-1')],
    reviews: [queued('R-1')],
    instances: [
      instance({ instanceId: 'I-1', resource: 'tool-active' }),
      instance({ instanceId: 'I-2', resource: 'tool-active', agentId: 'Neo-2' }),
    ],
    limits: { maxAttempts: 8, maxConcurrentLlm: 4, maxHeavyTools: 2 },
  }))
  assert.equal(saturatedTools.admissions.length, 0)
  assert.deepEqual(reasons(saturatedTools), ['heavy-tool-limit', 'heavy-tool-limit'], 'a worker and a review both wait for the tool ceiling')
})

test('the worker and reviewer pools do not share a slot', () => {
  const plan = core.planSchedulerTick(tick({
    agents: [worker('Neo-1'), reviewer('Neo-2')],
    workers: [ready('T-1')],
    reviews: [queued('R-1', { review: reviewFixture({ id: 'R-1', taskId: 'T-2' }) })],
    workspaces: [workspace({ pools: { workers: { minActive: 0, maxActive: 1 }, reviewers: { minActive: 0, maxActive: 1 } } })],
  }))
  assert.deepEqual(plan.admissions.map(admission => admission.kind), ['worker', 'review'])
  assert.equal(plan.deferrals.length, 0)
})

test('an admission never exceeds the caps the state declared, across repeated ticks', () => {
  const state = tick({
    agents: [worker()],
    workers: Array.from({ length: 12 }, (_unused, index) => ready(`T-${index + 1}`)),
    workspaces: [workspace({ pools: { workers: { minActive: 0, maxActive: 4 }, reviewers: { minActive: 0, maxActive: 2 } } })],
  })
  const first = core.planSchedulerTick(state)
  assert.equal(first.admissions.length, 4)
  assert.deepEqual(stable(core.planSchedulerTick(state)), stable(first), 'the same state gives the same assignment')

  const withInstances = core.planSchedulerTick({
    ...state,
    instances: first.admissions.map((admission, index) => instance({ instanceId: `I-${index + 1}`, agentId: admission.agentId })),
  })
  assert.equal(withInstances.admissions.length, 0, 'the admitted work now occupies the pool, and the next tick sees it')
  assert.deepEqual(new Set(reasons(withInstances)), new Set(['pool-capacity']))
})

test('a kick the architecture does not name is refused instead of silently ignored', async () => {
  const scheduler = runtime.createScheduler({
    state: { read: () => observation({ workers: [ready('T-1')], agents: [worker()] }) },
    admit: { admit() {} },
    clock: fakeClock(),
  })
  assert.throws(() => scheduler.kick({ source: 'event' }), TypeError, 'an event kick without an event')
  assert.throws(() => scheduler.kick({ source: 'event', event: 'task.moved' }), TypeError, 'an event §16.2 does not list')
  assert.throws(() => scheduler.kick({ source: 'reconcile', event: 'task.ready' }), TypeError, 'a reconcile is not an event')
  assert.throws(() => scheduler.kick({ source: 'now' }), TypeError, 'an unknown source')
  const plan = await scheduler.kick({ source: 'event', event: 'dependency.closed', taskId: 'T-1' })
  assert.equal(plan.admissions.length, 1)
  assert.deepEqual(plan.kick, { source: 'event', event: 'dependency.closed', taskId: 'T-1' })
})

test('an event kick admits the work the event is about, and the reconcile recovers a missed one', async () => {
  const state = mutableState()
  const admitted = []
  const scheduler = runtime.createScheduler({
    state,
    admit: { admit: admission => admitted.push(admission) },
    clock: fakeClock(),
  })

  const before = await scheduler.kick({ source: 'event', event: 'task.created', taskId: 'T-1' })
  assert.equal(before.admissions.length, 0, 'the dependency is still open, so nothing is ready')
  assert.equal(admitted.length, 0, 'a tick with no admissible work calls nothing')

  state.release()
  const after = await scheduler.kick({ source: 'event', event: 'dependency.closed', taskId: 'T-1' })
  assert.deepEqual(after.admissions.map(admission => admission.taskId), ['T-1'])
  assert.equal(admitted.length, 1)

  const missed = mutableState()
  const recovered = []
  const second = runtime.createScheduler({
    state: missed,
    admit: { admit: admission => recovered.push(admission) },
    clock: fakeClock(),
  })
  await second.kick({ source: 'event', event: 'task.created' })
  missed.release()
  assert.equal(recovered.length, 0, 'the missed event delivered nothing')
  const plan = await second.reconcile()
  assert.deepEqual(plan.admissions.map(admission => admission.taskId), ['T-1'])
  assert.equal(plan.kick.source, 'reconcile')
  assert.equal(recovered.length, 1, 'the reconcile recovered the event nobody delivered')
})

test('the safety timer reconciles on its own, and stops when the scheduler stops', async () => {
  const state = mutableState()
  const clock = fakeClock()
  const admitted = []
  const scheduler = runtime.createScheduler({
    state,
    admit: { admit: admission => admitted.push(admission) },
    clock,
    policy: { reconcileIntervalMs: 1_000 },
  })

  const startup = await scheduler.start()
  await drain()
  assert.equal(startup.kick.source, 'startup', '§16.1 runs the startup reconcile before the timer')
  assert.equal(scheduler.snapshot().running, true)
  assert.equal(scheduler.snapshot().ticks, 1)

  state.release()
  await clock.advance(1_000)
  await waitFor(() => scheduler.snapshot().ticks === 2)
  assert.equal(admitted.length, 1, 'the timer path admits the work the missed event would have')
  assert.equal(scheduler.snapshot().lastPlan.kick.source, 'reconcile')

  await scheduler.stop()
  assert.equal(scheduler.snapshot().running, false)
  await clock.advance(5_000)
  await drain()
  assert.equal(scheduler.snapshot().ticks, 2, 'a stopped scheduler reconciles nothing')
  await scheduler.stop()
})

test('a tick with nothing to do reads the state and calls no admission port', async () => {
  let reads = 0
  const calls = []
  const scheduler = runtime.createScheduler({
    state: {
      read: () => {
        reads += 1
        return observation()
      },
    },
    admit: { admit: admission => calls.push(admission) },
    clock: fakeClock(),
  })

  for (const event of contracts.SCHEDULER_EVENT_TYPES) {
    const plan = await scheduler.kick({ source: 'event', event })
    assert.equal(plan.admissions.length, 0)
  }
  await scheduler.reconcile()
  assert.equal(reads, contracts.SCHEDULER_EVENT_TYPES.length + 1, 'every kick is one observation of state')
  assert.deepEqual(calls, [], 'sleeping/idle with no ready work invokes nothing at all')
  assert.equal(scheduler.snapshot().queued, 0)
})

test('the scheduler holds no model port: an injected one is never called, and no source names one', async () => {
  const modelCalls = []
  const scheduler = runtime.createScheduler({
    state: { read: () => observation({ workers: [ready('T-1')], agents: [worker()] }) },
    admit: { admit() {} },
    clock: fakeClock(),
    // A deployment that hands the scheduler a model port by mistake gets a
    // scheduler that ignores it: the port is not part of its dependencies.
    llm: { listProviders: () => modelCalls.push('listProviders'), listModels: () => modelCalls.push('listModels') },
  })
  await scheduler.kick({ source: 'event', event: 'task.ready' })
  await scheduler.reconcile()
  assert.deepEqual(modelCalls, [], 'the scheduler never asks a provider or a model for anything')

  const sourceDir = join(repoRoot, 'packages', 'scheduler', 'src')
  const forbidden = ['ModelCatalogPort', 'resolveModelInfo', 'listModels', 'selectModelRoute', 'routeModel(', 'AgentRuntimePort', 'adapter-sdk']
  const files = readdirSync(sourceDir)
  assert.ok(files.length > 0, 'the scan must read real files')
  for (const file of files) {
    const text = readFileSync(join(sourceDir, file), 'utf8')
    for (const needle of forbidden) {
      assert.equal(text.includes(needle), false, `${file} must not name ${needle}`)
    }
  }
})

test('ticks are serialized, so two kicks never decide against one state at the same time', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const scheduler = runtime.createScheduler({
    state: {
      async read() {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(resolve => setTimeout(resolve, 1))
        inFlight -= 1
        return observation({ workers: [ready('T-1')], agents: [worker()] })
      },
    },
    admit: { admit() {} },
    clock: fakeClock(),
  })

  const plans = await Promise.all([
    scheduler.kick({ source: 'event', event: 'task.ready' }),
    scheduler.kick({ source: 'event', event: 'agent.idle' }),
    scheduler.reconcile(),
  ])
  assert.equal(plans.length, 3)
  assert.equal(maxInFlight, 1, 'a second tick waits for the one in flight')
  assert.equal(scheduler.snapshot().ticks, 3)
})

test('the runtime mints and keeps the queue reading of the work it has seen (§16.3 aging)', async () => {
  // The port reports the task without a queue reading, so the runtime's own
  // reading is the only one there is.
  let tasks = [{ task: taskFixture({ id: 'T-1', workspaceId: 'W-1', state: 'ready' }) }]
  const clock = fakeClock()
  const scheduler = runtime.createScheduler({
    // The work is ready and nobody can take it, so it stays queued across ticks.
    state: { read: () => observation({ workers: tasks, agents: [] }) },
    admit: { admit() {} },
    clock,
  })

  const first = await scheduler.kick({ source: 'event', event: 'task.ready' })
  assert.equal(scheduler.snapshot().queued, 1)
  assert.equal(first.deferrals[0].rank.agingMs, 0, 'the first tick that saw the work minted the reading')
  assert.deepEqual(reasons(first), ['no-agent'])

  await clock.advance(2 * AGING_STEP)
  const later = await scheduler.reconcile()
  assert.equal(later.deferrals[0].rank.agingMs, 2 * AGING_STEP, 'aging measures the wait, not the runtime uptime')
  assert.equal(scheduler.snapshot().queued, 1)

  tasks = []
  await scheduler.reconcile()
  assert.equal(scheduler.snapshot().queued, 0, 'work that left the queue loses its reading')
})

test('a queue reading the state port states wins over the runtime\'s own', async () => {
  // Two ticks, because the asymmetry only exists once the runtime holds a
  // reading of its own: the first tick mints one, the second states a different
  // one, and the port's must win.
  let stated
  const clock = fakeClock()
  const scheduler = runtime.createScheduler({
    state: {
      read: () => observation({
        workers: [{
          task: taskFixture({ id: 'T-1', workspaceId: 'W-1', state: 'ready' }),
          ...(stated === undefined ? {} : { readySince: stated }),
        }],
        agents: [],
      }),
    },
    admit: { admit() {} },
    clock,
  })

  const minted = await scheduler.kick({ source: 'event', event: 'task.ready' })
  assert.equal(minted.deferrals[0].rank.agingMs, 0, 'the runtime minted its own reading at NOW')

  await clock.advance(2 * AGING_STEP)
  stated = NOW - 5 * AGING_STEP
  const statedWins = await scheduler.reconcile()
  assert.equal(
    statedWins.deferrals[0].rank.agingMs,
    7 * AGING_STEP,
    'the port knows when the task reached ready (five steps before NOW), and its reading beats the one the runtime minted; the two steps the clock advanced are on top of it',
  )
})

test('the policy and the limits resolve loudly, and a tick refuses a malformed one', () => {
  const resolved = core.resolveSchedulerPolicy({ workerPool: 'doers', agingStepMs: 1_000 })
  assert.deepEqual(
    { workerPool: resolved.workerPool, reviewerPool: resolved.reviewerPool, agingStepMs: resolved.agingStepMs },
    { workerPool: 'doers', reviewerPool: 'reviewers', agingStepMs: 1_000 },
  )
  assert.throws(() => core.resolveSchedulerPolicy({ agingStepMs: 0 }), TypeError, 'a zero aging step is a programming error')
  assert.throws(() => core.resolveSchedulerPolicy({ workerPool: ' ' }), TypeError)
  assert.deepEqual(core.resolveSchedulerLimits({ maxAttempts: 0 }), { maxAttempts: 0, maxConcurrentLlm: 4, maxHeavyTools: 2 })
  assert.throws(() => core.resolveSchedulerLimits({ maxAttempts: -1 }), TypeError)
  assert.throws(() => core.planSchedulerTick(tick({ workers: 'T-1' })), TypeError)
  assert.throws(() => core.planSchedulerTick(tick({ nowMs: -1 })), TypeError)
  assert.throws(() => core.planSchedulerTick(tick({ workspaces: [workspace({ scheduling: { weight: 0, maxWorkers: 1 } })] })), TypeError)
  assert.throws(() => runtime.createScheduler({ state: {}, admit: {}, clock: fakeClock() }), TypeError)
})

// --- helpers ---------------------------------------------------------------

/** A catalog observation with no work in it. */
function observation(overrides = {}) {
  return {
    workers: [],
    reviews: [],
    instances: [],
    agents: [],
    workspaces: [workspace()],
    catalog: catalog(),
    ...overrides,
  }
}

/** A state port whose readiness the test drives, standing in for the Task Graph. */
function mutableState() {
  let tasks = []
  return {
    release() {
      tasks = [ready('T-1')]
    },
    read() {
      return observation({ workers: tasks, agents: [worker()] })
    },
  }
}

/** A clock whose time only moves when the test says so. */
function fakeClock(startMs = NOW) {
  let now = startMs
  const waiters = []
  return {
    now: () => now,
    sleep(ms, signal) {
      return new Promise((resolve, reject) => {
        const waiter = { at: now + Math.max(0, ms), resolve, signal, onAbort: undefined }
        waiter.onAbort = () => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          reject(Object.assign(new Error('dsh-mywork: sleep aborted'), { name: 'AbortError' }))
        }
        if (signal?.aborted === true) {
          waiter.onAbort()
          return
        }
        signal?.addEventListener('abort', waiter.onAbort, { once: true })
        waiters.push(waiter)
      })
    },
    async advance(ms) {
      now += ms
      for (const waiter of [...waiters]) {
        if (waiter.at > now) continue
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        waiter.signal?.removeEventListener('abort', waiter.onAbort)
        waiter.resolve()
      }
      await drain()
    },
  }
}

/** Let every pending microtask and timer callback of the runtime run. */
async function drain() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise(resolve => setImmediate(resolve))
  }
}

/** Wait for a condition the runtime reaches asynchronously. */
async function waitFor(predicate) {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return
    await drain()
  }
  throw new Error('the scheduler did not reach the expected state')
}
