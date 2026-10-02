/**
 * Durable background jobs: the vocabulary of the jobs the controller runs out of
 * band (D09, F-36).
 *
 * A job is identified by a stable `kind` plus a payload; it is **not** modelled
 * on the platform's `JobView`, because the platform's registry is process-local
 * and this vocabulary has to survive a restart. The types here are the contract
 * between the storage layer that owns the `background_job` table and the
 * controller that runs the jobs; nothing here imports the platform.
 * @module
 */

/**
 * What a durable job does.
 *
 * `optimizer`, `migration` and `import` are the jobs MW-033/MW-040 name;
 * `export` and `backup` are the single-file artefacts F-34 locks; `retention`
 * is the scheduled `compact()` of F-39, which must never run on a request path.
 */
export type BackgroundJobKind = 'optimizer' | 'migration' | 'import' | 'export' | 'backup' | 'retention'

/** Every job kind, so a caller (or a test) can pin the vocabulary. */
export const BACKGROUND_JOB_KINDS: readonly BackgroundJobKind[] = Object.freeze([
  'optimizer',
  'migration',
  'import',
  'export',
  'backup',
  'retention',
])

/**
 * Lifecycle of a durable job.
 *
 * `pending` waits for a worker, `running` holds a lease with `lease_until`; a
 * lease that expires returns the job to the pool, so a crashed worker does not
 * strand it. `succeeded` and `failed` are terminal and may be pruned.
 */
export type BackgroundJobStatus = 'pending' | 'running' | 'succeeded' | 'failed'

/** Every job status. */
export const BACKGROUND_JOB_STATUSES: readonly BackgroundJobStatus[] = Object.freeze([
  'pending',
  'running',
  'succeeded',
  'failed',
])

/** Statuses a worker may still claim. */
export const BACKGROUND_JOB_OPEN_STATUSES: readonly BackgroundJobStatus[] = Object.freeze([
  'pending',
  'running',
])
