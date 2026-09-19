/**
 * Stable identifiers and counters shared by every MyWork domain record
 * (architecture §8, §9, §17, §35). They are aliases, not brands: the domain
 * validates values at its boundaries instead of encoding ownership in the type.
 * @module
 */

/** Monotonic revision of one aggregate or immutable revision record (§35). */
export type Revision = number

/** Monotonic fence token handed out together with a lease (§17). */
export type FenceToken = number

/** Controller lease epoch a mutation was issued under (§3, §9). */
export type ControllerEpoch = number

/** Clock reading in epoch milliseconds. */
export type EpochMs = number

/** Identifier of a Task Graph task. */
export type TaskId = string

/** Identifier of one execution attempt of a task. */
export type AttemptId = string

/** Identifier of one review of one attempt. */
export type ReviewId = string

/** Identifier of a durable agent identity ("employee", §13.4). */
export type AgentId = string

/** Identifier of a short-lived agent instance / runtime handle (§13.5). */
export type AgentInstanceId = string

/** Identifier of a role. */
export type RoleId = string

/** Identifier of a team (§6.1, §13). */
export type TeamId = string

/** Identifier of a workflow definition (§6.1, §6.3). */
export type WorkflowId = string

/** Identifier of an agent blueprint. */
export type BlueprintId = string

/** Identifier of a skill. */
export type SkillId = string

/** Identifier of a workspace. */
export type WorkspaceId = string

/** Identifier of a DSH session. */
export type SessionId = string

/** Identifier of one cross-store operation (§9). */
export type OperationId = string

/** Identifier correlating the operations, events, and audit rows of one workflow (§9, §43). */
export type CorrelationId = string

/** Identifier of one event on the MyWork event stream (§43). */
export type EventId = string

/** Identifier of one artifact in the Artifact Store (§32). */
export type ArtifactId = string

/** Identifier of one append-only audit row (§34). */
export type AuditId = string
