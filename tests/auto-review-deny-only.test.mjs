/**
 * The deny-only rule for automatic approvers (F-57, D15, R-22).
 *
 * `auto-review` is mounted **and active** in the live profile, so "the plugin is
 * not there" is not a protection: the rule has to hold whatever the composition
 * contains. D15 gives the automatic approver exactly one command -
 * `review.request-changes` - and this suite pins both halves: an approving
 * answer can never raise the mode, and the approver's command vocabulary is
 * asserted against the one entry it has.
 *
 * `HumanDecision` (D14) does not exist in this repository yet - it is stage-4
 * work (MW-030/E-52) - so the escalation is expressed with the vocabulary that
 * does exist: a §28 `HumanGate`. The suite therefore asserts the gate, not a
 * durable entity.
 */

import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Repository root, derived here rather than taken from `lib/fixtures.mjs`: that
 * helper refuses to load while ANY package's `lib/` is missing, and the shared
 * tree is built by several workstreams at once.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `@dsh-mywork/contracts` as built: the card-command vocabulary. */
const contracts = await import(pathToFileURL(join(repoRoot, 'packages/contracts/lib/index.js')).href)

/** `@dsh-mywork/core` as built: the review policy. */
const core = await import(pathToFileURL(join(repoRoot, 'packages/core/lib/index.js')).href)

/** Operation identity for the typed refusals. */
const M = core.defineOperationMeta({ operationId: 'op-1', correlationId: 'corr-1' })

test('an approving verdict never raises the mode', () => {
  // The three spellings an approver plausibly uses for "let it through".
  for (const verdict of ['allow', 'approve', 'approved']) {
    const ruling = core.ruleOnAutoReview({ verdict, autoReviewActive: true })
    assert.notEqual(ruling.kind, 'allowed')
    assert.equal(ruling.kind, 'human-decision-required', `${verdict} must escalate, not approve`)
    assert.equal(ruling.gate, 'security-change')
    assert.ok(typeof ruling.reason === 'string' && ruling.reason.length > 0)
  }

  // Anything MyWork cannot read as a verdict is refused rather than allowed: an
  // approver that answers in a vocabulary we do not know must not win by default.
  for (const verdict of ['yes', 'ALLOW', '', null, undefined, 1, true, { decision: 'allow' }, ['deny']]) {
    const ruling = core.ruleOnAutoReview({ verdict, autoReviewActive: true })
    assert.equal(ruling.kind, 'denied', `${JSON.stringify(verdict)} must be denied`)
  }

  // A refusal is a refusal, and the ruling vocabulary has no approving member.
  assert.equal(core.ruleOnAutoReview({ verdict: 'deny', autoReviewActive: true }).kind, 'denied')
  assert.deepEqual(core.AUTO_REVIEW_RULING_KINDS, ['denied', 'human-decision-required'])
  assert.equal(core.AUTO_REVIEW_RULING_KINDS.includes('allowed'), false)
})

test('the automatic approver holds only review.request-changes', () => {
  assert.deepEqual(core.AUTO_REVIEW_COMMANDS, ['review.request-changes'])
  // The refused command really exists in the vocabulary, so this is not a check
  // against a name MyWork invented for the test.
  assert.ok(contracts.CARD_COMMANDS.includes('review.approve'))
  assert.equal(core.AUTO_REVIEW_COMMANDS.includes('review.approve'), false)

  const granted = core.assertAutoReviewCommand('review.request-changes', M)
  assert.equal(granted.ok, true, granted.ok ? '' : granted.error.message)
  assert.equal(granted.value, 'review.request-changes')

  for (const command of ['review.approve', 'board.move', 'task.admit', 'task.retry', '', null, 7, ['review.approve']]) {
    const refused = core.assertAutoReviewCommand(command, M)
    assert.equal(refused.ok, false, `${JSON.stringify(command)} must be refused`)
    assert.equal(refused.error.code, 'SECURITY_DENIED')
  }
})

test('the rule holds with the approver mounted and with it absent', () => {
  // The baseline the plan corrects: `auto-review` is mounted and active in the
  // live profile. The rule is MyWork's, so both compositions must answer alike.
  for (const verdict of ['deny', 'allow', 'approve', 'nonsense']) {
    const mounted = core.ruleOnAutoReview({ verdict, autoReviewActive: true })
    const absent = core.ruleOnAutoReview({ verdict, autoReviewActive: false })
    assert.deepEqual(mounted, absent, `${verdict}: the ruling must not depend on the composition`)
    assert.notEqual(mounted.kind, 'allowed')
  }
  // Non-vacuity: the rule is not a constant, and it distinguishes the two
  // answers the approver can give.
  assert.notDeepEqual(
    core.ruleOnAutoReview({ verdict: 'deny', autoReviewActive: true }),
    core.ruleOnAutoReview({ verdict: 'allow', autoReviewActive: true }),
    'a refusal and an attempt to approve must not produce the same ruling',
  )
})
