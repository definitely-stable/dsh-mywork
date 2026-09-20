/**
 * Shared fixtures for the domain tests.
 *
 * The tests import the built packages exactly as a consumer would, so a broken
 * build fails the suite instead of silently testing sources.
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root; every artifact below is addressed from here. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Built entry points the domain tests exercise. */
const entries = {
  contracts: 'packages/contracts/lib/index.js',
  core: 'packages/core/lib/index.js',
  storage: 'packages/storage/lib/index.js',
  evidence: 'packages/evidence/lib/index.js',
  lease: 'packages/lease/lib/index.js',
  adapterTesting: 'packages/adapter-sdk/lib/testing.js',
  adapterSdk: 'packages/adapter-sdk/lib/index.js',
  beads: 'packages/beads-adapter/lib/index.js',
  planner: 'packages/planner/lib/index.js',
  execution: 'packages/execution/lib/index.js',
  scheduler: 'packages/scheduler/lib/index.js',
  memoryNative: 'packages/memory-native/lib/index.js',
}

const missing = Object.values(entries).filter(relative => !existsSync(join(repoRoot, relative)))
if (missing.length > 0) {
  throw new Error(
    `domain tests: missing build output: ${missing.join(', ')}; run "pnpm run build" first (or use "pnpm run check")`,
  )
}

/** `@dsh-mywork/contracts` as built. */
export const contracts = await import(pathToFileURL(join(repoRoot, entries.contracts)).href)

/** `@dsh-mywork/core` as built. */
export const core = await import(pathToFileURL(join(repoRoot, entries.core)).href)

/** `@dsh-mywork/storage` as built. */
export const storage = await import(pathToFileURL(join(repoRoot, entries.storage)).href)

/** `@dsh-mywork/evidence` as built. */
export const evidence = await import(pathToFileURL(join(repoRoot, entries.evidence)).href)

/** `@dsh-mywork/lease` as built. */
export const lease = await import(pathToFileURL(join(repoRoot, entries.lease)).href)

/** `@dsh-mywork/adapter-sdk/testing` as built: the deterministic fakes. */
export const adapterTesting = await import(pathToFileURL(join(repoRoot, entries.adapterTesting)).href)

/** `@dsh-mywork/beads-adapter` as built: the Beads TaskGraph adapter. */
export const beads = await import(pathToFileURL(join(repoRoot, entries.beads)).href)

/** `@dsh-mywork/adapter-sdk` as built: the registry and negotiation surface. */
export const adapterSdk = await import(pathToFileURL(join(repoRoot, entries.adapterSdk)).href)

/** `@dsh-mywork/planner` as built: the Task Setter. */
export const planner = await import(pathToFileURL(join(repoRoot, entries.planner)).href)

/** `@dsh-mywork/execution` as built: the claim saga, attempts, leases, and fences. */
export const execution = await import(pathToFileURL(join(repoRoot, entries.execution)).href)

/** `@dsh-mywork/scheduler` as built: the event-driven kick and the safety reconcile. */
export const scheduler = await import(pathToFileURL(join(repoRoot, entries.scheduler)).href)

/** `@dsh-mywork/memory-native` as built: the native and disabled memory providers (§23.8). */
export const memoryNative = await import(pathToFileURL(join(repoRoot, entries.memoryNative)).href)

/**
 * Operation identity for fixture calls.
 * @param overrides - fields to replace.
 */
export function meta(overrides = {}) {
  return core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1', ...overrides })
}

/**
 * Task fixture. The defaults describe a coherent `ready` task.
 * @param overrides - fields to replace.
 */
export function taskFixture(overrides = {}) {
  return {
    id: 'T-1',
    workspaceId: 'W-1',
    title: 'Task 1',
    description: 'Do the work',
    state: 'ready',
    revision: 1,
    dependsOn: [],
    ...overrides,
  }
}

/**
 * Lease fixture.
 * @param overrides - fields to replace.
 */
export function leaseFixture(overrides = {}) {
  return { attemptId: 'A-1', fence: 17, controllerEpoch: 3, expiresAt: 5_000, ...overrides }
}

/**
 * Attempt fixture. The defaults describe a `created` attempt without a lease.
 * @param overrides - fields to replace.
 */
export function attemptFixture(overrides = {}) {
  return {
    id: 'A-1',
    taskId: 'T-1',
    workspaceId: 'W-1',
    agentId: 'Neo-1',
    state: 'created',
    revision: 1,
    revisions: { config: 2, role: 4 },
    ...overrides,
  }
}

/**
 * Attempt fixture already leased with fence 17.
 * @param overrides - fields to replace.
 */
export function leasedAttemptFixture(overrides = {}) {
  return attemptFixture({ state: 'leased', revision: 2, lease: leaseFixture(), ...overrides })
}

/**
 * Review fixture.
 * @param overrides - fields to replace.
 */
export function reviewFixture(overrides = {}) {
  return {
    id: 'R-1',
    taskId: 'T-1',
    attemptId: 'A-1',
    reviewerId: 'Neo-2',
    state: 'queued',
    revision: 1,
    requestedAt: 1_000,
    ...overrides,
  }
}

/**
 * Agent instance fixture.
 * @param overrides - fields to replace.
 */
export function instanceFixture(overrides = {}) {
  return { id: 'I-1', agentId: 'Neo-1', state: 'sleeping', since: 1_000, ...overrides }
}

/**
 * Role fixture: a worker role whose contract is the ceiling for its blueprints.
 * @param overrides - fields to replace.
 */
export function roleFixture(overrides = {}) {
  return {
    id: 'backend-developer',
    contractRevision: 4,
    strategyRevision: 7,
    contract: {
      purpose: 'Implement backend changes',
      requiredCapabilities: ['workspace.read', 'shell'],
      workflowPermissions: ['workspace.read', 'workspace.write', 'shell', 'tests'],
      prohibitedActions: ['approve own work'],
      outputContract: 'A diff plus the commands that verify it',
      reviewContract: 'An independent reviewer sees the diff and the evidence',
    },
    strategy: {
      researchApproach: ['read the failing test first'],
      strategyModules: ['small-diff'],
      modelPolicy: { preferred: 'deepseek/flash', fallback: ['glm/air'], escalation: [] },
      skillPolicy: { allowed: ['testing'], denied: [] },
      learningPolicy: { strategyEvolution: true, memoryPromotion: false },
    },
    ...overrides,
  }
}

/**
 * Blueprint fixture for {@link roleFixture}.
 * @param overrides - fields to replace.
 */
export function blueprintFixture(overrides = {}) {
  return {
    id: 'backend-developer-default',
    revision: 17,
    roleId: 'backend-developer',
    modelPolicy: { preferred: 'deepseek/flash', fallback: ['glm/air'], escalation: ['frontier/pro'] },
    reasoning: 'high',
    preset: 'code',
    permissions: ['workspace.read', 'workspace.write', 'shell', 'tests'],
    skills: ['dotnet', 'git'],
    pool: 'workers',
    ...overrides,
  }
}

/**
 * Durable agent identity fixture (§13.4).
 * @param overrides - fields to replace.
 */
export function identityFixture(overrides = {}) {
  return {
    id: 'Neo-1',
    name: 'Neo-1',
    roleId: 'backend-developer',
    blueprintId: 'backend-developer-default',
    blueprintRevision: 17,
    status: 'sleeping',
    workspaceOverlays: [],
    sessionRefs: [],
    performanceRefs: [],
    experienceRefs: [],
    learningProvenance: [],
    revision: 3,
    ...overrides,
  }
}
