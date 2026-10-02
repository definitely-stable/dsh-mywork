/**
 * Scheduler projection of the durable review queue.
 *
 * Execution owns review_claim and ReviewQueue is its public read boundary. The
 * controller maps queued claims into the smaller scheduler observation shape;
 * it never reads review_claim SQL directly and never fabricates a reviewer.
 * @module
 */

import type { ReviewQueue } from '@dsh-mywork/execution'
import type { SchedulerObservedReview } from '@dsh-mywork/scheduler'

import { ControllerRuntimeError } from './errors.ts'

/** Read-only scheduler source backed by the execution-owned ReviewQueue. */
export interface ReviewSchedulerSource {
  /** Queued review candidates in durable queue order. */
  read(): readonly SchedulerObservedReview[]
}

/**
 * Build a lazy review source over the composition root's ReviewQueue.
 *
 * The queue does not exist until the leader opens controller.sqlite, so the
 * resolver is intentionally lazy. Absence is a composition failure, not an
 * empty queue: returning [] here would recreate the false-zero state RC-A
 * removed.
 */
export function createReviewSchedulerSource(
  resolveQueue: () => ReviewQueue | undefined,
): ReviewSchedulerSource {
  if (typeof resolveQueue !== 'function') {
    throw new TypeError('dsh-mywork: review scheduler source needs a ReviewQueue resolver')
  }

  return Object.freeze({
    read(): readonly SchedulerObservedReview[] {
      const queue = resolveQueue()
      if (queue === undefined) {
        throw new ControllerRuntimeError(
          'state-unavailable',
          'dsh-mywork: review scheduler source is not composed',
          { details: { source: 'reviews' } },
        )
      }

      return Object.freeze(
        queue.liveReviews()
          .filter(claim => claim.state === 'queued')
          .map(claim => Object.freeze({
            reviewId: claim.reviewId,
            taskId: claim.taskId,
            workspaceId: claim.workspaceId,
            producerAgentId: claim.workerAgentId,
            readySince: claim.requestedAt,
          })),
      )
    },
  })
}
