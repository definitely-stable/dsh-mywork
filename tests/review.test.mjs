/**
 * Review acceptance (architecture §13.2, §18.3, §19).
 *
 * Covers the main line, the forbidden-pair sweep, reviewer independence, the
 * evidence an approval and a rejection must carry, and the invalidation of an
 * approval once the head SHA moves.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { contracts, core, meta, reviewFixture } from './lib/fixtures.mjs'

const M = meta()
const ARTIFACT = { headSha: 'a'.repeat(40), diffHash: 'd1' }

/** Walk a review to `reviewing`. */
function reviewingReview() {
  const claimed = core.transitionReview(reviewFixture(), { to: 'claimed', at: 1_100 }, M)
  assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.error.message)
  const reviewing = core.transitionReview(claimed.value.review, { to: 'reviewing', at: 1_200 }, M)
  assert.equal(reviewing.ok, true, reviewing.ok ? '' : reviewing.error.message)
  return reviewing.value.review
}

test('the main line from queued to approved is allowed', () => {
  const approval = core.transitionReview(
    reviewingReview(),
    { to: 'approved', at: 1_300, artifact: ARTIFACT, workerAgentId: 'Neo-1' },
    M,
  )
  assert.equal(approval.ok, true, approval.ok ? '' : approval.error.message)
  assert.equal(approval.value.review.state, 'approved')
  assert.deepEqual(approval.value.review.artifact, ARTIFACT)
  assert.equal(approval.value.review.settledAt, 1_300)
  assert.equal(approval.value.review.revision, 4)
  assert.equal(approval.value.events[0].type, 'review.state.changed')
  assert.deepEqual(core.allowedReviewTransitions('approved'), [])
})

test('every pair outside the transition table is refused with TASK_CONFLICT', () => {
  let refused = 0
  for (const from of contracts.REVIEW_STATES) {
    for (const to of contracts.REVIEW_STATES) {
      if (core.canTransitionReview(from, to)) continue
      const review = reviewFixture({
        state: from,
        revision: 2,
        ...(from === 'approved' ? { artifact: ARTIFACT } : {}),
      })
      const result = core.transitionReview(
        review,
        { to, at: 10, artifact: ARTIFACT, workerAgentId: 'Neo-1', findings: { summary: 'why' } },
        M,
      )
      assert.equal(result.ok, false, `${from} → ${to} must be refused`)
      assert.equal(result.error.code, 'TASK_CONFLICT', `${from} → ${to} must report TASK_CONFLICT`)
      refused += 1
    }
  }
  assert.ok(refused >= 40, `expected the sweep to cover the review matrix, covered ${refused}`)
})

test('a worker cannot approve its own attempt', () => {
  const result = core.transitionReview(
    reviewingReview(),
    { to: 'approved', at: 1_300, artifact: ARTIFACT, workerAgentId: 'Neo-2' },
    M,
  )
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'SECURITY_DENIED')
  assert.match(result.error.message, /cannot review its own attempt/)

  const independence = core.assertReviewerIndependence({ workerAgentId: 'Neo-2', reviewerAgentId: 'Neo-2' }, M)
  assert.equal(independence.ok, false)
  assert.equal(independence.error.code, 'SECURITY_DENIED')
})

test('a reviewer that can write the workspace cannot approve', () => {
  const denied = core.transitionReview(
    reviewingReview(),
    {
      to: 'approved',
      at: 1_300,
      artifact: ARTIFACT,
      workerAgentId: 'Neo-1',
      reviewerPermissions: ['workspace.read', 'workspace.write'],
    },
    M,
  )
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'SECURITY_DENIED')

  const allowed = core.transitionReview(
    reviewingReview(),
    {
      to: 'approved',
      at: 1_300,
      artifact: ARTIFACT,
      workerAgentId: 'Neo-1',
      reviewerPermissions: ['workspace.read', 'tests', 'review.approve'],
    },
    M,
  )
  assert.equal(allowed.ok, true, allowed.ok ? '' : allowed.error.message)
})

test('an approval needs the artefact it binds to, and the worker identity', () => {
  const withoutArtifact = core.transitionReview(
    reviewingReview(),
    { to: 'approved', at: 1_300, workerAgentId: 'Neo-1' },
    M,
  )
  assert.equal(withoutArtifact.ok, false)
  assert.equal(withoutArtifact.error.code, 'TASK_CONFLICT')

  const blankArtifact = core.transitionReview(
    reviewingReview(),
    { to: 'approved', at: 1_300, artifact: { headSha: ' ', diffHash: 'd1' }, workerAgentId: 'Neo-1' },
    M,
  )
  assert.equal(blankArtifact.ok, false)
  assert.equal(blankArtifact.error.code, 'TASK_CONFLICT')

  assert.throws(
    () => core.transitionReview(reviewingReview(), { to: 'approved', at: 1_300, artifact: ARTIFACT }, M),
    TypeError,
  )
})

test('rejection and needs-evidence require findings', () => {
  for (const to of ['rejected', 'needs-evidence']) {
    const bare = core.transitionReview(reviewingReview(), { to, at: 1_400 }, M)
    assert.equal(bare.ok, false, `${to} without findings must be refused`)
    assert.equal(bare.error.code, 'TASK_CONFLICT')

    const blank = core.transitionReview(reviewingReview(), { to, at: 1_400, findings: { summary: '  ' } }, M)
    assert.equal(blank.ok, false)
    assert.equal(blank.error.code, 'TASK_CONFLICT')

    const documented = core.transitionReview(
      reviewingReview(),
      { to, at: 1_400, findings: { summary: 'Missing coverage', artifactRef: 'artifact-9' } },
      M,
    )
    assert.equal(documented.ok, true, documented.ok ? '' : documented.error.message)
    assert.equal(documented.value.review.findings.summary, 'Missing coverage')
  }
})

test('a review that needs evidence can return to reviewing', () => {
  const waiting = core.transitionReview(
    reviewingReview(),
    { to: 'needs-evidence', at: 1_400, findings: { summary: 'Provide the coverage report' } },
    M,
  )
  assert.equal(waiting.ok, true)
  const resumed = core.transitionReview(waiting.value.review, { to: 'reviewing', at: 1_500 }, M)
  assert.equal(resumed.ok, true, resumed.ok ? '' : resumed.error.message)
})

test('an approval stops being valid once the head SHA or diff moves', () => {
  const approved = core.transitionReview(
    reviewingReview(),
    { to: 'approved', at: 1_300, artifact: ARTIFACT, workerAgentId: 'Neo-1' },
    M,
  )
  assert.equal(approved.ok, true)
  const review = approved.value.review

  assert.equal(core.isReviewApprovalCurrent(review, { ...ARTIFACT }), true)
  assert.equal(core.isReviewApprovalCurrent(review, { ...ARTIFACT, headSha: 'b'.repeat(40) }), false)

  const stillValid = core.assertReviewApprovalCurrent(review, { ...ARTIFACT }, M)
  assert.equal(stillValid.ok, true)

  const moved = core.assertReviewApprovalCurrent(review, { ...ARTIFACT, headSha: 'b'.repeat(40) }, M)
  assert.equal(moved.ok, false)
  assert.equal(moved.error.code, 'STALE_REVISION')
  assert.equal(moved.error.details.reviewed.headSha, ARTIFACT.headSha)
  assert.equal(moved.error.details.current.headSha, 'b'.repeat(40))
})

test('a review that is not approved never validates an artefact', () => {
  const queued = reviewFixture()
  assert.equal(core.isReviewApprovalCurrent(queued, ARTIFACT), false)
  const result = core.assertReviewApprovalCurrent(queued, ARTIFACT, M)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'STALE_REVISION')
})

test('review activity classification matches the architecture', () => {
  assert.deepEqual([...contracts.REVIEW_TERMINAL_STATES], ['approved', 'rejected', 'escalated', 'cancelled'])
  for (const state of contracts.REVIEW_STATES) {
    const terminal = contracts.REVIEW_TERMINAL_STATES.includes(state)
    assert.equal(core.isReviewTerminal(state), terminal, `${state} terminality`)
    if (terminal) {
      assert.deepEqual(core.allowedReviewTransitions(state), [], `${state} must have no outgoing edge`)
    } else {
      assert.ok(core.allowedReviewTransitions(state).length > 0, `${state} must have an outgoing edge`)
    }
  }
})
