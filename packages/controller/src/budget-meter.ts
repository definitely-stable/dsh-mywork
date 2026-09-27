/**
 * The bridge from the platform's token meter to the §30 charge (F-51, D05).
 *
 * MyWork does not count tokens. The platform's `tokenMeter` service already
 * replays a session and prices its surface, so the only thing missing between a
 * live session and the §30 gate is a translation: take one
 * `ctx.tokenMeter.measure(session, header?)` reading and turn it into the
 * {@link BudgetCharge} the admission gate and the ledger already speak. This
 * module is that translation and nothing else — it holds no counter, no total,
 * and no state between calls, so a second token accounting cannot grow here.
 *
 * The platform package is **not** imported: the port below mirrors the fields
 * `measure` returns (`token-meter/src/types.ts:22-35`) structurally, exactly as
 * `dsh-session.ts` mirrors the session service. A deployment binds the real
 * `TokenMeter` to it; a test binds a fake.
 *
 * Two rules decide what a measurement is worth, and both are deliberate (D05):
 *
 * - **A measurement is a measurement, even a heuristic one.** `totalTokens` is a
 *   number the meter produced, so it is charged as
 *   `knownAmount(measurement.totalTokens)` — including the measured zero of an
 *   empty surface, which is a reading rather than a missing one. Only a reading
 *   nobody took is unknown. The {@link MeasurementSource} on the charge keeps
 *   the difference visible: `usage` is what a provider reported, `estimated` is
 *   the meter's own heuristic, `none` is an empty surface.
 * - **A cost nobody can price is unknown.** `modelCallCost` prices an input and
 *   an output count separately, and only a `usage` baseline carries that split,
 *   so only a `usage` baseline produces a cost. Pricing an unsplit heuristic
 *   total at the input rate would charge a number the meter never measured, and
 *   in the fail-closed direction this repository uses such a charge must be
 *   `unknown` (a declared cost limit then refuses as unverifiable) rather than a
 *   plausible-looking guess.
 * @module
 */

import { type BudgetAmount, type ModelRate, type ModelRoute } from '@dsh-mywork/contracts'
import { type BudgetCharge, knownAmount, modelCallCost, readCallTokens, unknownAmount } from '@dsh-mywork/core'

/** One baseline anchor of a measurement. */
export type MeasurementBaseline =
  /** Nothing on the surface: a measured zero. */
  | { readonly kind: 'none'; readonly tokens: 0 }
  /** The meter's own heuristic total, with no input/output split. */
  | { readonly kind: 'estimated'; readonly tokens: number }
  /** What a provider reported for the latest call, with its usage split. */
  | { readonly kind: 'usage'; readonly tokens: number; readonly usage: unknown }

/** A token measurement, as far as this bridge reads one. */
export interface TokenMeasurement {
  /** Durable log revision the measurement was taken at. */
  readonly logRevision: number
  /** Anchor the total was measured from. */
  readonly baseline: MeasurementBaseline
  /** Signed repricing of the surface relative to the anchor. */
  readonly surfaceDeltaTokens: number
  /** Current request-and-response pressure; the token number §30 is charged. */
  readonly totalTokens: number
  /** Total route-priced tokens of the current surface. */
  readonly surfaceTokens: number
}

/**
 * The platform service this bridge reads.
 *
 * `TokenMeter` satisfies it structurally: `measure(session, requestHeader?)`
 * returns a {@link TokenMeasurement} (`token-meter/src/index.ts:146`).
 */
export interface TokenMeterPort {
  /** Measure one session through its current durable tail. */
  measure(session: unknown, requestHeader?: unknown): TokenMeasurement
}

/** Which anchor a charge was measured from. */
export type MeasurementSource = MeasurementBaseline['kind']

/**
 * The §30 charge of one measured unit of work, with the provenance of the
 * numbers it carries. It **is** a {@link BudgetCharge}, so the accounting
 * (`chargeConsumption`) and the gate (`decideBudgetAdmission` through
 * `SchedulerCharge`) accept it unchanged.
 */
export interface MeasuredCharge extends BudgetCharge {
  /** Tokens measured; always known, because a reading was taken. */
  readonly tokens: BudgetAmount
  /** Cost priced from the route's rate, or unknown with the reason it is not. */
  readonly cost: BudgetAmount
  /** Anchor the token number came from. */
  readonly source: MeasurementSource
  /** Log revision the charge was measured at, for correlating a charge to a reading. */
  readonly logRevision: number
}

/** Everything {@link bridgeMeasurement} reads. */
export interface MeasurementBridgeInput {
  /** The reading; the only source of every token number in the charge. */
  readonly measurement: TokenMeasurement
  /** Route the work ran on; its rate table entry prices the charge. */
  readonly route: ModelRoute
  /** Rate of that route, or `undefined` when the deployment configured none. */
  readonly rate?: ModelRate
}

/**
 * Turn one token measurement into the §30 charge of the work it measured.
 *
 * Pure and total for a well formed measurement: the same reading and rate always
 * produce the same charge, and nothing is remembered between calls.
 * @param input - the measurement, the route it ran on, and the route's rate.
 * @returns the charge, frozen, with its source and log revision.
 * @throws {TypeError} when the measurement, the route, or the rate is malformed.
 */
export function bridgeMeasurement(input: MeasurementBridgeInput): MeasuredCharge {
  const { measurement, route, rate } = requireBridgeInput(input)
  return Object.freeze({
    tokens: knownAmount(measurement.totalTokens),
    cost: costOf(measurement, route, rate),
    source: measurement.baseline.kind,
    logRevision: measurement.logRevision,
  })
}

/** What one measured unit of work costs, from the only split that can be priced. */
function costOf(measurement: TokenMeasurement, route: ModelRoute, rate: ModelRate | undefined): BudgetAmount {
  if (measurement.baseline.kind !== 'usage') {
    return unknownAmount(
      `the meter measured the surface from a "${measurement.baseline.kind}" baseline, which carries no input/output split to price`,
    )
  }
  return modelCallCost(route, rate, readCallTokens(measurement.baseline.usage))
}

/** The pricing one call needs: the route, its rate, and the effective request header. */
export interface BudgetMeterPricing {
  /** Route the measured work ran on. */
  readonly route: ModelRoute
  /** Rate of that route; absent means the deployment configured none. */
  readonly rate?: ModelRate
  /** Effective request envelope `measure` should price the surface under. */
  readonly header?: unknown
}

/**
 * The token meter as the rest of the controller sees it: one session in, one
 * §30 charge out.
 *
 * Deliberately not a counter or a running total — the identity the runtime needs
 * is "measure this session now", and every number it returns comes from the
 * platform service on that call.
 */
export interface BudgetMeter {
  /** Measure one session and bridge the reading to the charge of one route. */
  readonly chargeFor: (session: unknown, pricing: BudgetMeterPricing) => MeasuredCharge
}

/**
 * Bind a platform token meter as the controller's budget meter.
 * @param tokenMeter - the platform service, or a fake with the same `measure`.
 * @returns the bound meter; it keeps no state and holds no counters.
 * @throws {TypeError} when the port has no `measure` method.
 */
export function createBudgetMeter(tokenMeter: TokenMeterPort): BudgetMeter {
  if (tokenMeter === null || typeof tokenMeter !== 'object' || typeof tokenMeter.measure !== 'function') {
    throw new TypeError('dsh-mywork: a budget meter needs a token meter with a measure method')
  }
  return Object.freeze({
    chargeFor: (session: unknown, pricing: BudgetMeterPricing): MeasuredCharge => {
      if (pricing === null || typeof pricing !== 'object') {
        throw new TypeError('dsh-mywork: a budget meter call must state the route it prices')
      }
      return bridgeMeasurement({
        measurement: tokenMeter.measure(session, pricing.header),
        route: pricing.route,
        ...(pricing.rate === undefined ? {} : { rate: pricing.rate }),
      })
    },
  })
}

/** Validate one bridge input: a reading, a route, and a rate that describes the route. */
function requireBridgeInput(input: MeasurementBridgeInput): MeasurementBridgeInput {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('dsh-mywork: a measurement bridge input must be an object')
  }
  const { measurement, route, rate } = input
  if (measurement === null || typeof measurement !== 'object') {
    throw new TypeError('dsh-mywork: a measurement bridge input needs a measurement')
  }
  if (!Number.isFinite(measurement.totalTokens) || measurement.totalTokens < 0) {
    throw new TypeError(
      `dsh-mywork: a measurement total must be a non-negative finite number, received ${String(measurement.totalTokens)}`,
    )
  }
  if (measurement.baseline === null || typeof measurement.baseline !== 'object') {
    throw new TypeError('dsh-mywork: a measurement must state the baseline it was taken from')
  }
  if (route === null || typeof route !== 'object' || typeof route.provider !== 'string' || typeof route.model !== 'string') {
    throw new TypeError('dsh-mywork: a measured charge must know the route it ran on')
  }
  if (rate !== undefined) {
    if (rate.provider !== route.provider || rate.model !== route.model) {
      throw new TypeError(
        `dsh-mywork: the rate for "${route.provider}/${route.model}" describes "${String(rate.provider)}/${String(rate.model)}"`,
      )
    }
  }
  return input
}
