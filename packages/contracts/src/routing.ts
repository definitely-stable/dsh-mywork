/**
 * Model routing (architecture §13.1, §13.3, §29, §53).
 *
 * §29 keeps the routing policy separate from the route a run actually took: a
 * blueprint names `preferred`, `fallback`, and `escalation` candidates, and the
 * runtime records the route it really used — with the trigger that moved it and
 * every candidate it walked past — in the attempt's provenance.
 *
 * Two rules of this module are deliberately visible in its types:
 *
 * - A decision that routes **carries its provenance**: there is no way to obtain
 *   a route without the record §29 requires, so a caller cannot forget to write
 *   it.
 * - Escalation is **opt-in per request**. §62 item 7 makes the development
 *   default OpenCode Go Flash, and moving to a paid frontier model is never
 *   automatic: a policy that lists escalation candidates still needs a request
 *   that permits escalation.
 * @module
 */

import type { ModelPolicy } from './team.ts'

/**
 * The platform default routing policy of §6's `platform-default` layer for
 * development: OpenCode Go Flash, no fallback, no escalation.
 *
 * The empty escalation list is the point (§62 item 7): no run of this
 * deployment may leave the development model automatically. A deployment that
 * needs another default states it in its own configuration layer, where the
 * change is visible, rather than inheriting it from here.
 */
export const DEVELOPMENT_MODEL_POLICY: ModelPolicy = Object.freeze({
  preferred: 'opencode-go/deepseek-v4.1-flash',
  fallback: Object.freeze([]),
  escalation: Object.freeze([]),
})

/** One exact provider/model route. */
export interface ModelRoute {
  /** Provider route key, e.g. `opencode-go`. */
  readonly provider: string
  /** Exact model id, e.g. `deepseek-v4.1-flash`. */
  readonly model: string
}

/**
 * Which part of a {@link ModelPolicy} a selected route came from. It is recorded
 * with the route because "we ran on the fallback" and "we ran on the preferred
 * route" are different operational facts (§29).
 */
export type ModelRouteRole = 'preferred' | 'fallback' | 'escalation'

/** Every route role, in policy order. */
export const MODEL_ROUTE_ROLES: readonly ModelRouteRole[] = Object.freeze([
  'preferred',
  'fallback',
  'escalation',
])

/**
 * Why a route was reconsidered at all (architecture §29). The trigger is
 * recorded as part of the provenance: a route chosen after a repeated failure
 * means something different from the same route chosen first time.
 */
export type RouteTrigger =
  /** The previous attempt on this work failed more than once. */
  | 'repeated-failure'
  /** A review loop sent the work back. */
  | 'review-loop'
  /** The task was classified as more complex than the policy assumed. */
  | 'complexity'
  /** The model-visible context no longer fits the current route's window. */
  | 'context-overflow'
  /** The provider did not answer. */
  | 'provider-outage'
  /** Budget policy moved the work to a cheaper or more expensive route. */
  | 'budget-policy'

/** Every trigger §29 lists. */
export const ROUTE_TRIGGERS: readonly RouteTrigger[] = Object.freeze([
  'repeated-failure',
  'review-loop',
  'complexity',
  'context-overflow',
  'provider-outage',
  'budget-policy',
])

/** One routing request: the policy to apply to one unit of work. */
export interface ModelRouteRequest {
  /** Candidate routes a blueprint or role strategy states (§13.1, §13.3). */
  readonly policy: ModelPolicy
  /** What moved the work away from its previous route, when something did. */
  readonly trigger?: RouteTrigger
  /**
   * Context capacity the route must hold, in tokens. Absent means the caller
   * states no requirement; a route whose window is undisclosed then stays
   * eligible, and its provenance records the absence instead of a number.
   */
  readonly requiredContextTokens?: number
  /**
   * Whether {@link ModelPolicy.escalation} candidates may be selected. Absent or
   * false keeps the §62 item 7 default: escalation is never automatic, and the
   * escalation candidates are reported as withheld rather than skipped silently.
   */
  readonly allowEscalation?: boolean
}

/** Why one candidate route was not selected. */
export type RouteRefusalReason =
  /** The policy entry is not a `provider/model` pair. */
  | 'invalid-route'
  /** The catalog does not register the provider, so the route does not exist. */
  | 'route-absent'
  /** The provider is registered but did not answer (§29 provider outage). */
  | 'provider-outage'
  /** The adapter published no context window and the request states a requirement. */
  | 'context-window-undisclosed'
  /** The published context window is smaller than the request requires. */
  | 'context-window-too-small'
  /** The route exists but the request does not permit escalation (§62 item 7). */
  | 'escalation-not-permitted'
  /** The catalog answered with something that cannot describe the route asked about. */
  | 'catalog-invalid'

/** Every refusal reason, so a caller can enumerate what it must handle. */
export const ROUTE_REFUSAL_REASONS: readonly RouteRefusalReason[] = Object.freeze([
  'invalid-route',
  'route-absent',
  'provider-outage',
  'context-window-undisclosed',
  'context-window-too-small',
  'escalation-not-permitted',
  'catalog-invalid',
])

/** What one candidate route answered while the policy was walked. */
export interface RouteEvaluation {
  /** The policy entry as it was stated, e.g. `deepseek/flash`. */
  readonly candidate: string
  /** The entry parsed into a route; absent when it is not a `provider/model` pair. */
  readonly route?: ModelRoute
  /** Which part of the policy named it. */
  readonly role: ModelRouteRole
  /** `selected` for the route taken, `refused` for one that answered and lost, `withheld` for one that was never asked. */
  readonly outcome: 'selected' | 'refused' | 'withheld'
  /** Why it was not selected; absent on the selected candidate. */
  readonly reason?: RouteRefusalReason
  /** Context capacity the candidate published; absent means undisclosed, never zero. */
  readonly contextWindow?: number
  /** Verbatim detail of the failure: provider text, or the value the catalog answered with. */
  readonly detail?: string
}

/**
 * §29 provenance of the route a decision selected: the actual route, the part of
 * the policy it came from, the trigger that moved the work, the capacity it
 * published, and the whole candidate walk that produced it.
 *
 * The record is what an attempt stores. Persisting it is the admission path's
 * job; this module only guarantees that a routed decision cannot exist without
 * one.
 */
export interface ModelRouteProvenance {
  /** The route actually used. */
  readonly route: ModelRoute
  /** Which part of the policy it came from. */
  readonly role: ModelRouteRole
  /** What moved the work, when the caller named a trigger. */
  readonly trigger?: RouteTrigger
  /** Context capacity the selected route published; absent means undisclosed. */
  readonly contextWindow?: number
  /** Every candidate the policy named, in the order it was walked. */
  readonly evaluations: readonly RouteEvaluation[]
}

/**
 * The outcome of routing one unit of work. A refused decision carries the
 * reason and the same candidate walk, so an operator sees why every candidate
 * was unusable instead of only that nothing was chosen.
 */
export type ModelRouteDecision =
  | { readonly kind: 'routed'; readonly provenance: ModelRouteProvenance }
  | {
    readonly kind: 'refused'
    readonly reason: RouteRefusalReason
    readonly evaluations: readonly RouteEvaluation[]
  }
