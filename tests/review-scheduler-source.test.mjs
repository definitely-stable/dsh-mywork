/**
 * Durable review queue -> scheduler observation mapping.
 *
 * Execution owns the review rows. The controller may only consume ReviewQueue's
 * public read façade, select queued work, and narrow it to scheduler data.
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { repoRoot } from './lib/fixtures.mjs'

const controller = await import(pathToFileURL(join(repoRoot, 'packages/controller/lib/index.js')).href)

function claim(reviewId, state, overrides = {}) {
  return {
    reviewId,
    attemptId: `A-${reviewId}`,
    taskId: `T-${reviewId}`,
    workspaceId: 'W-1',
    workerAgentId: 'Neo-worker',
    headSha: 'a'.repeat(40),
    diffHash: 'd'.repeat(64),
    state,
    revision: 1,
    requestedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  }
}

test('an uncomposed ReviewQueue is unavailable, never an empty review queue', () => {
  const source = controller.createReviewSchedulerSource(() => undefined)
  assert.throws(
    () => source.read(),
    error => controller.isControllerRuntimeError(error)
      && error.code === 'state-unavailable'
      && error.details.source === 'reviews',
  )
})

test('only queued durable reviews become scheduler candidates, in queue order', () => {
  const live = [
    claim('R-1', 'queued', { requestedAt: 900 }),
    claim('R-2', 'claimed', { reviewerId: 'Neo-reviewer', requestedAt: 950 }),
    claim('R-3', 'reviewing', { reviewerId: 'Neo-reviewer', requestedAt: 975 }),
    claim('R-4', 'needs-evidence', { reviewerId: 'Neo-reviewer', requestedAt: 990 }),
    claim('R-5', 'queued', { workspaceId: 'W-2', workerAgentId: 'Neo-5', requestedAt: 1_100 }),
  ]
  const source = controller.createReviewSchedulerSource(() => ({
    liveReviews: () => live,
  }))

  const observed = source.read()
  assert.deepEqual(observed, [
    {
      reviewId: 'R-1',
      taskId: 'T-R-1',
      workspaceId: 'W-1',
      producerAgentId: 'Neo-worker',
      readySince: 900,
    },
    {
      reviewId: 'R-5',
      taskId: 'T-R-5',
      workspaceId: 'W-2',
      producerAgentId: 'Neo-5',
      readySince: 1_100,
    },
  ])
  assert.equal(Object.isFrozen(observed), true)
  assert.equal(Object.isFrozen(observed[0]), true)
  assert.equal(Object.hasOwn(observed[0], 'reviewerId'), false, 'scheduler input never fabricates or forwards a reviewer')
})

test('the mapper reads through ReviewQueue exactly once per scheduler observation', () => {
  let reads = 0
  const source = controller.createReviewSchedulerSource(() => ({
    liveReviews() {
      reads += 1
      return [claim('R-1', 'queued')]
    },
  }))

  source.read()
  assert.equal(reads, 1)
  source.read()
  assert.equal(reads, 2)
})
