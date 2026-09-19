/**
 * `@dsh-mywork/planner` — the Task Setter (architecture §10; ADR024, ADR026).
 *
 * §10.2 gives the Task Setter exactly one output: a structured plan mutation with
 * the revision it was computed against. This package validates that mutation
 * (cycles, stale revisions, running tasks, planner scope), applies it — atomically
 * where the backend supports it and through a durable staged operation with an
 * admission pause where it does not (ADR024) — verifies the outcome against the
 * graph, and keeps the operator paths that finish, revert, or explain an
 * interrupted operation (§5.2).
 *
 * It also carries the two things §10 gives the rest of the system: the
 * deterministic class of a plan (ADR026 — the half of the L3 predicate that must
 * not be a judgement) and the derived blocker gate of §5.5.
 *
 * ```ts
 * const store = await openStore({
 *   path,
 *   migrations: [
 *     ...MYWORK_MIGRATIONS,
 *     ...EVIDENCE_MIGRATIONS,
 *     ...LEASE_MIGRATIONS,
 *     ...PLAN_MUTATION_MIGRATIONS,
 *   ],
 * })
 * const planner = createPlanner({ store, graph, clock })
 * const staged = await planner.submit(intent)
 * ```
 *
 * The package opens no database of its own and mounts no Cordis row: the caller
 * composes the migrations and hands in an open store, the same way the lease and
 * evidence layers do, and the card that mounts the runtime owns that composition.
 * @module @dsh-mywork/planner
 */

export {
  PLAN_ERROR_CODES,
  PlanError,
  isPlanError,
  type PlanErrorCode,
  type PlanErrorOptions,
} from './errors.ts'
export {
  PLAN_MUTATION_MIGRATIONS,
  PLAN_MUTATION_SCHEMA_NAME,
  PLAN_MUTATION_SCHEMA_VERSION,
  PLAN_MUTATION_STATE_CHECK,
} from './schema.ts'
export {
  assertPlanSchema,
  commitPlanRevision,
  createPlanStore,
  decideProposal,
  holdAdmission,
  insertGateDecision,
  insertProposal,
  insertStagedMutation,
  listPendingMutations,
  PLAN_MUTATION_HOLD_REASON,
  PLAN_PROPOSAL_KINDS,
  PLAN_PROPOSAL_STATES,
  PLAN_STAGED_STATES,
  readGateDecisions,
  readMutation,
  readOpenHold,
  readPlanRevision,
  readProposal,
  readSteps,
  recordMutationDecision,
  releaseAdmission,
  saveMutationCreated,
  saveMutationReport,
  updateMutationState,
  writeSteps,
  type AdmissionHold,
  type AdmissionHoldInput,
  type PlanStore,
  type RaisedProposal,
} from './store.ts'
export {
  createPlanner,
  PLAN_SCHEMA_NAME,
  type BlockerGateRequest,
  type Planner,
  type PlannerDeps,
  type PlannerRefusal,
} from './service.ts'
