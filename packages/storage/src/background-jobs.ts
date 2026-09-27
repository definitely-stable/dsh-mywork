/**
 * Durable background jobs: the `background_job` table and the registry over it
 * (F-36, F-37; MW-068, D09).
 *
 * The platform's `ctx.jobs` provider keeps every job in memory, so a job that
 * matters across a restart cannot live there. The carrier is therefore a table
 * in the MyWork state database, written in the same transaction as the state
 * change that scheduled the job — the same discipline the outbox follows.
 *
 * The table's version is **allocated**, never written here: {@link createBackgroundJobMigration}
 * receives the number from the single allocator in the composition layer
 * (§15.3, F-63), because `background_job` is one of several migrations that must
 * not collide.
 * @module
 */

import { randomUUID } from 'node:crypto'

import { BACKGROUND_JOB_KINDS, BACKGROUND_JOB_STATUSES } from '@dsh-mywork/contracts'
import type { BackgroundJobKind, BackgroundJobStatus } from '@dsh-mywork/contracts'

import { StorageError } from './errors.ts'
import type { Migration, MigrationContext } from './migrations.ts'
import type { SqlExecutor, SqlValue } from './sql.ts'

/** Statuses as a SQL list, derived from the contract so the two cannot drift. */
const STATUS_SQL = BACKGROUND_JOB_STATUSES.map(status => `'${status}'`).join(', ')

/** The jobs table: one row per job, the lease in the row itself. */
export const BACKGROUND_JOB_DDL = `
  CREATE TABLE background_job (
    job_id      TEXT    NOT NULL PRIMARY KEY,
    kind        TEXT    NOT NULL,
    status      TEXT    NOT NULL CHECK (status IN (${STATUS_SQL})),
    owner       TEXT,
    payload     TEXT    NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    lease_until INTEGER
  ) STRICT
`

/** The index `claimDue` reads: open jobs, oldest first. */
export const BACKGROUND_JOB_INDEX_DDL = 'CREATE INDEX background_job_due ON background_job (status, lease_until, created_at)'

/**
 * The migration that creates the jobs table.
 *
 * The number comes from the version allocator (F-63) at the composition root;
 * passing it in is what keeps a literal out of this file (R-04).
 * @param version - the allocated version this migration brings the database to.
 * @throws {StorageError} `invalid-input` for a version that is not a positive integer.
 */
export function createBackgroundJobMigration(version: number): Migration {
  if (!Number.isInteger(version) || version < 1) {
    throw new StorageError(
      'invalid-input',
      `dsh-mywork: a migration version must be a positive integer allocated by the version allocator, received ${String(version)}`,
    )
  }
  return {
    version,
    name: 'background-job',
    up(context: MigrationContext): void {
      context.exec(BACKGROUND_JOB_DDL)
      context.exec(BACKGROUND_JOB_INDEX_DDL)
    },
  }
}

/** One job, as stored. */
export interface BackgroundJobRecord {
  /** Stable identity of the job. */
  readonly jobId: string
  /** What the job does. */
  readonly kind: BackgroundJobKind
  /** Where the job is in its lifecycle. */
  readonly status: BackgroundJobStatus
  /** Worker that holds the lease; `null` while nobody does. */
  readonly owner: string | null
  /** The payload, as the JSON text that was stored. */
  readonly payload: string
  /** How many times a worker picked the job up. */
  readonly attempts: number
  /** Clock reading of the enqueue. */
  readonly createdAt: number
  /** Clock reading of the last state change. */
  readonly updatedAt: number
  /** Lease expiry while running; `null` otherwise. */
  readonly leaseUntil: number | null
}

/** Inputs of {@link enqueueBackgroundJob}. */
export interface EnqueueBackgroundJobInput {
  /** What the job does. */
  readonly kind: BackgroundJobKind
  /** JSON-serialisable payload; big output belongs in an artifact, not here. */
  readonly payload: unknown
  /** Clock reading to record. */
  readonly now: number
  /** Job id to use; a fresh UUID when omitted. */
  readonly jobId?: string
}

/** Inputs of {@link claimDueBackgroundJob}. */
export interface ClaimBackgroundJobInput {
  /** Worker taking the job. */
  readonly owner: string
  /** Clock reading to compare leases against. */
  readonly now: number
  /** How long the lease lasts, in clock units. */
  readonly leaseMs: number
  /** Only claim this kind when given. */
  readonly kind?: BackgroundJobKind
}

/** Inputs of {@link settleBackgroundJob}. */
export interface SettleBackgroundJobInput {
  /** The job to settle. */
  readonly jobId: string
  /** Terminal status; `pending` returns the job to the pool instead. */
  readonly status: Extract<BackgroundJobStatus, 'succeeded' | 'failed' | 'pending'>
  /** Clock reading to record. */
  readonly now: number
}

/** Filter of {@link listBackgroundJobs}. */
export interface ListBackgroundJobsFilter {
  /** Only jobs in this status. */
  readonly status?: BackgroundJobStatus
  /** Only jobs of this kind. */
  readonly kind?: BackgroundJobKind
  /** Maximum rows; defaults to every row. */
  readonly limit?: number
}

/**
 * Record a job. Inside a store transaction it commits together with the state
 * change that scheduled it.
 * @param executor - connection or open transaction.
 * @param input - kind, payload, clock reading, optional id.
 * @throws {StorageError} `invalid-input` for an unknown kind, a bad id, or a payload that is not JSON.
 */
export function enqueueBackgroundJob(executor: SqlExecutor, input: EnqueueBackgroundJobInput): BackgroundJobRecord {
  if (!BACKGROUND_JOB_KINDS.includes(input.kind)) {
    throw new StorageError(
      'invalid-input',
      `dsh-mywork: unknown background job kind "${String(input.kind)}"; known kinds are ${BACKGROUND_JOB_KINDS.join(', ')}`,
    )
  }
  const payload = JSON.stringify(input.payload)
  if (typeof payload !== 'string') {
    throw new StorageError('invalid-input', 'dsh-mywork: a background job payload must be JSON-serialisable')
  }
  const jobId = jobIdOf(input.jobId)
  if (!Number.isInteger(input.now) || input.now < 0) {
    throw new StorageError('invalid-input', `dsh-mywork: a job needs a clock reading, received ${String(input.now)}`)
  }
  executor.run(
    'INSERT INTO background_job (job_id, kind, status, owner, payload, attempts, created_at, updated_at, lease_until) '
      + "VALUES (?, ?, 'pending', NULL, ?, 0, ?, ?, NULL)",
    jobId,
    input.kind,
    payload,
    input.now,
    input.now,
  )
  return jobOf(executor, jobId)
}

/**
 * Read jobs, oldest first.
 * @param executor - connection or open transaction.
 * @param filter - optional status, kind, and row limit.
 */
export function listBackgroundJobs(
  executor: SqlExecutor,
  filter: ListBackgroundJobsFilter = {},
): readonly BackgroundJobRecord[] {
  const clauses: string[] = []
  const params: SqlValue[] = []
  if (filter.status !== undefined) {
    clauses.push('status = ?')
    params.push(filter.status)
  }
  if (filter.kind !== undefined) {
    clauses.push('kind = ?')
    params.push(filter.kind)
  }
  const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
  const limit = filter.limit === undefined ? '' : ' LIMIT ?'
  if (filter.limit !== undefined) params.push(filter.limit)
  return executor
    .all(`SELECT * FROM background_job${where} ORDER BY created_at, job_id${limit}`, ...params)
    .map(row => recordOf(row))
}

/**
 * Take the oldest job that waits for a worker.
 *
 * A job is claimable while it is `pending`, or while it is `running` with a
 * lease that has expired — which is how a worker that died mid-job is recovered.
 * The update is guarded by the same predicate as the read and reports its
 * changed rows, so two workers inside one transaction cannot both take it.
 * @param executor - connection or open transaction.
 * @param input - worker, clock reading, lease length, optional kind.
 * @returns the claimed job, or `undefined` when nothing is due.
 * @throws {StorageError} `invalid-input` for a non-positive lease.
 */
export function claimDueBackgroundJob(
  executor: SqlExecutor,
  input: ClaimBackgroundJobInput,
): BackgroundJobRecord | undefined {
  if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0) {
    throw new StorageError(
      'invalid-input',
      `dsh-mywork: a job lease must be a positive number of clock units, received ${String(input.leaseMs)}`,
    )
  }
  if (typeof input.owner !== 'string' || input.owner.trim().length === 0) {
    throw new StorageError('invalid-input', 'dsh-mywork: a job lease needs a non-empty owner')
  }
  const kindClause = input.kind === undefined ? '' : ' AND kind = ?'
  const kindParams: SqlValue[] = input.kind === undefined ? [] : [input.kind]
  const candidate = executor.get(
    `SELECT job_id FROM background_job WHERE status IN ('pending', 'running') AND (lease_until IS NULL OR lease_until < ?)${kindClause} `
      + 'ORDER BY created_at, job_id LIMIT 1',
    input.now,
    ...kindParams,
  )
  if (candidate === undefined) return undefined
  const changed = executor.run(
    "UPDATE background_job SET status = 'running', owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = ? "
      + 'WHERE job_id = ? AND (lease_until IS NULL OR lease_until < ?)',
    input.owner,
    input.now + input.leaseMs,
    input.now,
    String(candidate.job_id),
    input.now,
  )
  if (changed !== 1) {
    // The read and the write carry the same predicate inside one transaction, so
    // zero changed rows means the row moved under us: the caller must not be
    // handed a record whose `owner` is somebody else. The guard is load-bearing,
    // and `jobs-durable` pins it with an executor that reports zero.
    throw new StorageError(
      'conflict',
      `dsh-mywork: background job "${String(candidate.job_id)}" was claimed by another worker before this lease landed`,
      { details: { jobId: String(candidate.job_id), owner: input.owner, changed } },
    )
  }
  return jobOf(executor, String(candidate.job_id))
}

/**
 * Move a job to a terminal status, or return it to the pool with `pending`.
 * @param executor - connection or open transaction.
 * @param input - job, target status, clock reading.
 * @throws {StorageError} `not-found` when the job is gone.
 */
export function settleBackgroundJob(executor: SqlExecutor, input: SettleBackgroundJobInput): BackgroundJobRecord {
  const changed = executor.run(
    'UPDATE background_job SET status = ?, updated_at = ?, lease_until = NULL, owner = NULL WHERE job_id = ?',
    input.status,
    input.now,
    input.jobId,
  )
  if (changed !== 1) {
    throw new StorageError('not-found', `dsh-mywork: no background job "${input.jobId}" to settle`)
  }
  return jobOf(executor, input.jobId)
}

/** One job by id. */
function jobOf(executor: SqlExecutor, jobId: string): BackgroundJobRecord {
  const row = executor.get('SELECT * FROM background_job WHERE job_id = ?', jobId)
  if (row === undefined) {
    throw new StorageError('not-found', `dsh-mywork: no background job "${jobId}"`)
  }
  return recordOf(row)
}

/** Map one row. */
function recordOf(row: Record<string, SqlValue>): BackgroundJobRecord {
  return Object.freeze({
    jobId: String(row.job_id),
    kind: String(row.kind) as BackgroundJobKind,
    status: String(row.status) as BackgroundJobStatus,
    owner: row.owner === null || row.owner === undefined ? null : String(row.owner),
    payload: String(row.payload),
    attempts: Number(row.attempts),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    leaseUntil: row.lease_until === null || row.lease_until === undefined ? null : Number(row.lease_until),
  })
}

/** A job identity: the caller's, or a fresh UUID. */
function jobIdOf(jobId: string | undefined): string {
  if (jobId === undefined) return randomUUID()
  if (typeof jobId !== 'string' || jobId.trim().length === 0) {
    throw new StorageError('invalid-input', 'dsh-mywork: a background job id must be a non-empty string')
  }
  return jobId
}
