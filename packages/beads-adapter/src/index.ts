/**
 * `@dsh-mywork/beads-adapter`: the first `TaskGraphPort` backend (architecture
 * §11), a capability-aware Beads 1.3.0 adapter (ADR023, ADR024).
 *
 * The adapter is CLI-only. It declares `http: false` because `bd serve` is not
 * started, so every operation that would need the HTTP guard is refused with
 * `CAPABILITY_UNSUPPORTED` and takes the staged path instead of being emulated.
 * @module @dsh-mywork/beads-adapter
 */

export {
  BEADS_ADAPTER_ID,
  BEADS_ADAPTER_MANIFEST,
  BEADS_CLI_CAPABILITIES,
  BeadsTaskGraphAdapter,
  formatDuration,
  parseGraphApplyOutput,
  toRevision,
  type BeadsAdapterOptions,
} from './adapter.ts'

export {
  BD_EXIT_GUARD_FAILED,
  BD_EXIT_PANIC,
  DEFAULT_COMMAND_TIMEOUT_MS,
  createProcessRunner,
  createScriptedRunner,
  type BeadsCommand,
  type BeadsCommandResult,
  type BeadsRunner,
  type ProcessRunnerOptions,
  type ScriptedCall,
  type ScriptedRunner,
} from './runner.ts'

export {
  BEADS_BINARY_NOT_FOUND,
  BEADS_INSTALL_HINT,
  BeadsLaunchRefusal,
  findBeadsBinary,
  findBeadsEntry,
  resolveBeadsLaunch,
  type BeadsLaunch,
  type ResolveBeadsLaunchOptions,
} from './launch.ts'

export {
  DEFAULT_PROBE_TIMEOUT_MS,
  describeBeadsProbe,
  probeBeads,
  type BeadsProbeAvailable,
  type BeadsProbeFailure,
  type BeadsProbeResult,
  type BeadsProbeUnavailable,
  type ProbeBeadsOptions,
} from './probe.ts'

export {
  BEADS_INIT_COMMAND,
  classifyBeadsFailure,
  discoverWorkspace,
  parseBeadsContext,
  type BeadsFailureKind,
  type BeadsWorkspace,
} from './workspace.ts'

export {
  canApplyAtomically,
  detectCycle,
  edgeKey,
  quoteBatchValue,
  toGraphApplyPlan,
  toStagedMutationPlan,
  verifyStagedMutation,
  type BatchLine,
  type CycleCheck,
  type GraphApplyNode,
  type GraphApplyPlan,
  type MetadataUpdate,
  type StagedMutationPlan,
} from './plan.ts'

export {
  ADR023_STATUSES,
  ADR023_STATUS_CUSTOM,
  BEADS_BUILTIN_STATUSES,
  BEADS_PRIORITY_MAX,
  BEADS_PRIORITY_MIN,
  TASK_STATE_TO_BEADS_STATUS,
  beadsStatusOf,
  beadsStatusesFor,
  categoryOfBeadsStatus,
  isBeadsStatusCategory,
  optionalPriorityFromBeads,
  parseStatusCustom,
  priorityFromBeads,
  priorityToBeads,
  satisfiesDependency,
  statusCustomGaps,
  taskStateOfBeads,
  type BeadsStatus,
  type BeadsStatusCategory,
  type StatusCustomGap,
} from './mapping.ts'

export {
  canResumeCursor,
  reconcileClaim,
  resolveOutagePolicy,
  type ClaimReconciliation,
  type ClaimReconciliationAction,
  type ClaimReconciliationInput,
  type GraphAvailability,
  type OutagePolicy,
} from './reconcile.ts'

export {
  BEADS_JSON_SCHEMA_VERSION,
  BEADS_MEMORY_ADAPTER_ID,
  BEADS_MEMORY_ID_NAMESPACE,
  BEADS_MEMORY_KEY_PREFIX,
  BEADS_MEMORY_MANIFEST,
  BEADS_MEMORY_PAYLOAD_SCHEMA,
  BEADS_MEMORY_PROVIDER,
  DEFAULT_MEMORY_COMMAND_TIMEOUT_MS,
  createBeadsMemoryIdSource,
  createBeadsMemoryProvider,
  findBeadsDir,
  highestSequenceOf,
  parseBdVersion,
  type BeadsMemoryDiagnostics,
  type BeadsMemoryIdSourceOptions,
  type BeadsMemoryOptions,
  type BeadsMemoryProvider,
} from './memory.ts'
