/**
 * `@dsh-mywork/execution` — the claim saga, attempts, leases, and fences
 * (architecture §9, §17, §18.2, §49).
 *
 * §9 gives the cross-store claim its shape: an intent recorded durably before the
 * graph is touched, then the graph claim, then the attempt with its lease and
 * fence, then the projection, then completion — with idempotency at every hop,
 * because Beads and MyWork DB share no transaction. §17 gives the fence token
 * that makes a late result from a superseded attempt recognisable, and §49 names
 * the crashes that leave the saga half-done.
 *
 * This package is that saga. It owns the durable intent and its step journal, the
 * attempt records with their leases, and the per-task fence allocator — and it
 * enforces the invariant §17 rests on, that a task has **at most one authoritative
 * execution lease**, in the database rather than in this layer's code.
 *
 * ```ts
 * const store = await openStore({
 *   path,
 *   migrations: [
 *     ...MYWORK_MIGRATIONS,
 *     ...EVIDENCE_MIGRATIONS,
 *     ...LEASE_MIGRATIONS,
 *     ...CLAIM_SAGA_MIGRATIONS,
 *   ],
 * })
 * const saga = createClaimSaga({ store, graph, clock })
 * const claimed = await saga.claim({ taskId, workspaceId, claimant, agentId, expectedRevision, leaseMs, meta })
 * ```
 *
 * The package opens no database of its own and mounts no Cordis row: the caller
 * composes the migrations and hands in an open store and a resolved task graph,
 * the same way the lease, evidence, and planner layers do. The card that mounts
 * the runtime owns that composition.
 * @module @dsh-mywork/execution
 */

export {
  ExecutionError,
  isExecutionError,
  type ExecutionErrorCode,
  type ExecutionErrorOptions,
} from './errors.ts'
export {
  ATTEMPT_STATE_CHECK,
  CLAIM_INTENT_STATE_CHECK,
  CLAIM_SAGA_MIGRATIONS,
  CLAIM_SAGA_SCHEMA_NAME,
  CLAIM_SAGA_SCHEMA_VERSION,
  CLAIM_STEP_STATE_CHECK,
  FENCE_NOT_MONOTONIC_MARKER,
} from './schema.ts'
export {
  advanceIntent,
  allocateFence,
  assertClaimSchema,
  insertAttempt,
  insertIntent,
  listLiveAttempts,
  listOpenIntents,
  readAttempt,
  readFence,
  readIntent,
  readLiveAttempt,
  readSagaAttempt,
  readSteps,
  settleAttempt,
  writeSteps,
  type ClaimExecutor,
} from './store.ts'
export { createClaimSaga, type ClaimSaga, type ClaimSagaDeps } from './service.ts'
export { buildAttemptPrompt, contextSnapshotArtifactId, createWorker, workerReportArtifactId, CONTEXT_SNAPSHOT_ARTIFACT_PREFIX, WORKER_REPORT_ARTIFACT_PREFIX, WORKER_REPORT_SCHEMA, type AttemptContextPort, type AttemptContextRequest, type AttemptRunReport, type Worker, type WorkerAdmission, type WorkerDeps, type WorkerResumeRequest, type WorkerRunOptions } from './worker.ts'
export { assertGatesSatisfied, readGateResults, REVIEW_ADMISSION_REFUSAL, type GateAdmission, type GateAdmissionOptions } from './gates-admission.ts'
export { INTEGRATION_OPERATION_DDL, INTEGRATION_OPERATION_INDEX_DDL, INTEGRATION_SCHEMA_NAME, INTEGRATION_STATES, INTEGRATION_TERMINAL_STATES, advanceIntegrationOperation, createIntegrationMigration, insertIntegrationOperation, isIntegrationTerminal, readIntegrationOperation, type IntegrationOperationPatch, type IntegrationOperationRecord, type IntegrationState } from './integration-schema.ts'
export { DEFAULT_LANDING_STRATEGY, INTEGRATION_DECISION_OPTIONS, INTEGRATION_REFUSAL_CODES, INTEGRATION_REFUSAL_REASONS, INTEGRATION_REF_PREFIX, createIntegrator, integrationCommitMessage, staleApprovalCode, taskRefTrailer, type IntegrationAttentionRequest, type IntegrationCommand, type IntegrationDecisionRequest, type IntegrationEscalation, type IntegrationEscalationPort, type IntegrationFinalizeCommand, type IntegrationGatePort, type IntegrationGateRequest, type IntegrationOutcome, type IntegrationRecordPort, type IntegrationRefusalReason, type IntegrationSubject, type Integrator, type IntegratorDeps } from './integrator.ts'
export {
  DEFAULT_MAX_REVIEW_LOOPS,
  REVIEW_AGENT_PRESET,
  REVIEW_HARNESS_POLICY,
  REVIEW_POOL,
  REVIEW_SESSION_PURPOSE,
  createReviewQueue,
  readReviewVerdictDraft,
  resolveReviewLoopLimit,
  type ApproveReviewCommand,
  type AttentionRequest,
  type AutomaticVerdictCommand,
  type AutomaticVerdictOutcome,
  type ClaimReviewCommand,
  type EscalateReviewCommand,
  type RejectReviewCommand,
  type RequestReviewCommand,
  type ReviewActor,
  type ReviewApprovalOutcome,
  type ReviewClaim,
  type ReviewEscalationOutcome,
  type ReviewEvidenceInput,
  type ReviewEvidencePackage,
  type ReviewFindingsCommand,
  type ReviewProgress,
  type ReviewQueue,
  type ReviewQueueDeps,
  type ReviewRejectionOutcome,
  type ReviewRequestOutcome,
  type ReviewRevisionCommand,
  type ReviewRunScope,
  type ReviewVerdictDraft,
  type ReviewVerdictOutcome,
  type ReviewerGrant,
  type SubmitVerdictCommand,
} from './review-queue.ts'
export {
  REVIEW_CLAIM_ALLOCATION_KEY,
  REVIEW_CLAIM_FIELDS,
  REVIEW_CLAIM_SCHEMA_NAME,
  REVIEW_CLAIM_STATE_CHECK,
  REVIEW_CLAIM_TABLE,
  createReviewClaimMigration,
  type ReviewClaimMigrationOptions,
} from './review-schema.ts'
export { ATTEMPT_WORKTREE_DDL, ATTEMPT_WORKTREE_SCHEMA_NAME, ATTEMPT_WORKTREE_TABLE, createAttemptWorktreeMigration } from './worktree-schema.ts'
export { assertAttemptWorktreeSchema, insertAttemptWorktree, listAttemptWorktrees, readAttemptWorktree, settleAttemptWorktree, type AttemptWorktreeInput, type AttemptWorktreeRecord } from './worktree-store.ts'
