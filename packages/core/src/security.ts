/**
 * Runtime permission enforcement (architecture §28, §31, §52, §60).
 *
 * §31 requires role permissions to be enforced at runtime rather than
 * requested in a prompt, so every operation an agent attempts passes through
 * {@link authorizeOperation}. The gate is a pure function of two frozen inputs:
 * an {@link AuthorizationContext} — the permissions a blueprint granted, bound
 * to one workspace and to the harness policy in force — and an
 * {@link OperationRequest}. Nothing else can reach it: the context has no field
 * a prompt, a memory record, or a tool result could fill, so untrusted content
 * cannot widen a grant (§60 `prompt injection`).
 *
 * The gate is fail-closed in four directions:
 *
 * - an operation whose `domain.action` is not in the permission table is
 *   refused, so an unknown capability grants nothing;
 * - a permission that is not in the grant is refused rather than escalated;
 * - an effect the harness sandbox would not allow is refused before the harness
 *   has to, so MyWork never promises what the platform will not keep;
 * - a path outside the workspace (or outside the attempt's worktree) is
 *   refused, including textual escapes such as `..` and foreign drive/UNC roots.
 * @module
 */

import type {
  AuthorizationContext,
  AuthorizationDecision,
  CredentialReference,
  HarnessPolicy,
  HumanGate,
  OperationMeta,
  OperationRequest,
  Permission,
  Result,
} from '@dsh-mywork/contracts'
import {
  AUTHORIZATION_CONTEXT_FIELDS,
  CREDENTIAL_REFERENCE_FIELDS,
  DOMAIN_IMPLIED_GATES,
  HARNESS_GOVERNED_PERMISSIONS,
  HARNESS_POLICIES,
  HARNESS_POLICY_CEILING,
  HUMAN_GATES,
  IMPLEMENTATION_WRITE_PERMISSIONS,
  OPERATION_PERMISSIONS,
  OPERATION_REQUEST_FIELDS,
  OPERATIONS_REQUIRING_PATH,
  PERMISSIONS,
} from '@dsh-mywork/contracts'
import { MyWorkError, fail, ok } from './errors.ts'

/**
 * Authorize one operation against the grant that requests it (§31, §52).
 *
 * The checks run in a fixed order so a refusal is always the same refusal for
 * the same input: schema, reviewer configuration, known operation, §28 gate,
 * workspace binding, required path, reviewer independence, permission,
 * credential, harness ceiling, path boundary.
 * @param context - grant, workspace boundary, and harness policy in force.
 * @param request - domain, action, target workspace, and optional path/credential.
 * @param meta - operation identity.
 * @returns the authorized operation, or a `SECURITY_DENIED` failure carrying a
 *   `reason` for the audit trail.
 * @throws {TypeError} when the context or the request is malformed, when the
 *   grant carries an unknown permission, or when the request carries a field
 *   the operation schema does not declare — a prompt or memory field smuggled
 *   into a request is refused rather than ignored.
 */
export function authorizeOperation(
  context: unknown,
  request: unknown,
  meta: OperationMeta,
): Result<AuthorizationDecision> {
  const grant = readContext(context)
  const operation = readRequest(request)

  // A grant that may approve is held to §31's read-only reviewer rule whether or
  // not it claims to be a reviewer: the rule is a property of approving, and
  // leaving it to a self-declared flag would let one field disarm it.
  if (grant.reviewer === true || grant.permissions.includes('review.approve')) {
    const writable = IMPLEMENTATION_WRITE_PERMISSIONS.filter(permission => grant.permissions.includes(permission))
    if (writable.length > 0) {
      return denied(
        'reviewer-write-grant',
        `dsh-mywork: an approving grant must not hold implementation write permissions (§31); agent "${grant.agentId}" holds ${writable.join(', ')}`,
        { agentId: grant.agentId, permissions: writable },
        meta,
      )
    }
  }

  const required = OPERATION_PERMISSIONS[`${operation.domain}.${operation.action}`]
  if (required === undefined) {
    return denied(
      'unknown-operation',
      `dsh-mywork: operation "${operation.domain}.${operation.action}" is not a known capability, so it grants nothing (§31)`,
      { domain: operation.domain, action: operation.action },
      meta,
    )
  }

  const gate = operation.gate ?? DOMAIN_IMPLIED_GATES[operation.domain]
  if (gate !== undefined) {
    return denied(
      'human-gate',
      `dsh-mywork: operation "${operation.domain}.${operation.action}" is a §28 gate ("${gate}") and is decided by a human, never by a permission`,
      { gate, domain: operation.domain, action: operation.action },
      meta,
    )
  }

  if (operation.workspaceId !== grant.workspaceId) {
    return denied(
      'foreign-workspace',
      `dsh-mywork: agent "${grant.agentId}" is bound to workspace "${grant.workspaceId}" and may not operate on "${operation.workspaceId}" (§52)`,
      { agentId: grant.agentId, boundWorkspaceId: grant.workspaceId, requestWorkspaceId: operation.workspaceId },
      meta,
    )
  }

  if (OPERATIONS_REQUIRING_PATH.includes(`${operation.domain}.${operation.action}`) && operation.path === undefined) {
    return denied(
      'path-missing',
      `dsh-mywork: operation "${operation.domain}.${operation.action}" touches the filesystem and must name the path it touches, so the boundary can be checked (§60)`,
      { domain: operation.domain, action: operation.action },
      meta,
    )
  }

  const boundaryRoot = grant.worktreeRoot ?? grant.workspaceRoot

  if (required === 'review.approve') {
    if (grant.workerAgentId === undefined) {
      return denied(
        'unverifiable-independence',
        `dsh-mywork: agent "${grant.agentId}" cannot approve without the identity of the worker whose implementation is reviewed (§13.2)`,
        { agentId: grant.agentId },
        meta,
      )
    }
    if (sameAgent(grant.workerAgentId, grant.agentId)) {
      return denied(
        'self-approval',
        `dsh-mywork: agent "${grant.agentId}" cannot approve its own attempt (§13.2)`,
        { agentId: grant.agentId, workerAgentId: grant.workerAgentId },
        meta,
      )
    }
  }

  if (!grant.permissions.includes(required)) {
    return denied(
      'permission-missing',
      `dsh-mywork: operation "${operation.domain}.${operation.action}" needs "${required}", which agent "${grant.agentId}" was not granted`,
      { agentId: grant.agentId, permission: required, granted: [...grant.permissions] },
      meta,
    )
  }

  const usesCredential = required === 'secrets.use'
  if (usesCredential && operation.credential === undefined) {
    return denied(
      'credential-required',
      `dsh-mywork: operation "${operation.domain}.${operation.action}" requires a credential reference, never a secret (§31)`,
      { domain: operation.domain, action: operation.action },
      meta,
    )
  }
  if (!usesCredential && operation.credential !== undefined) {
    return denied(
      'credential-not-expected',
      `dsh-mywork: operation "${operation.domain}.${operation.action}" carries a credential reference it has no use for`,
      { domain: operation.domain, action: operation.action },
      meta,
    )
  }
  if (usesCredential) {
    const reference = assertCredentialReference(operation.credential, meta)
    if (!reference.ok) return fail(reference.error, meta)
  }

  if (
    HARNESS_GOVERNED_PERMISSIONS.includes(required) &&
    !HARNESS_POLICY_CEILING[grant.harnessPolicy].includes(required)
  ) {
    return denied(
      'harness-policy',
      `dsh-mywork: the harness policy "${grant.harnessPolicy}" does not allow "${required}"; MyWork does not authorize an effect the platform refuses (§31)`,
      { agentId: grant.agentId, permission: required, harnessPolicy: grant.harnessPolicy },
      meta,
    )
  }

  if (operation.path !== undefined) {
    if (!isWithinRoot(grant.workspaceRoot, operation.path)) {
      return denied(
        'path-escape',
        `dsh-mywork: path "${operation.path}" is outside workspaceRoot "${grant.workspaceRoot}" (§60 filesystem escape)`,
        { agentId: grant.agentId, path: operation.path, workspaceRoot: grant.workspaceRoot },
        meta,
      )
    }
    if (grant.worktreeRoot !== undefined && !isWithinRoot(grant.worktreeRoot, operation.path)) {
      return denied(
        'worktree-escape',
        `dsh-mywork: path "${operation.path}" is outside the worktree "${grant.worktreeRoot}" of this attempt (§60 worktree escape)`,
        { agentId: grant.agentId, path: operation.path, worktreeRoot: grant.worktreeRoot },
        meta,
      )
    }
  }

  return ok(
    Object.freeze({
      domain: operation.domain,
      action: operation.action,
      permission: required,
      workspaceId: grant.workspaceId,
      harnessPolicy: grant.harnessPolicy,
      ...(operation.path === undefined ? {} : { path: operation.path, boundaryRoot }),
    }),
    meta,
  )
}

/**
 * Check that a credential is passed as a reference rather than as key material
 * (§31: a blueprint holds credential references, never secrets).
 *
 * The reference is opaque — which store resolves it is the harness's business —
 * so the check is a refusal of secret *shapes*: a PEM block, a JWT, a
 * vendor-prefixed token, an assignment such as `password=…`, or an unbroken
 * opaque run long enough to be a key.
 * @param value - the value to check.
 * @param meta - operation identity.
 * @returns the frozen reference, or a `SECURITY_DENIED` failure naming the shape
 *   that was refused.
 * @throws {TypeError} when the value is not `{ ref: string }`.
 */
export function assertCredentialReference(value: unknown, meta: OperationMeta): Result<CredentialReference> {
  const reference = readCredentialReference(value)
  const material = secretMaterialIn(reference.ref)
  if (material !== undefined) {
    return denied(
      'secret-material',
      `dsh-mywork: a credential reference must not carry secret material; the value looks like ${material} (§31, §60 secret exfiltration)`,
      { shape: material },
      meta,
    )
  }
  return ok(reference, meta)
}

/**
 * Whether `candidate` resolves inside `root` (textual check, no filesystem).
 *
 * Both sides are canonicalized first: separators are unified, `.` segments
 * dropped, and `..` segments resolved before the comparison, so `a/../../etc`
 * cannot pass as a path inside `a`. A candidate that climbs above its own start
 * has no canonical form and is refused. Comparison is segment-wise, so the
 * sibling `C:\ws-evil` is not inside `C:\ws`; Windows-style roots (drive letters
 * and UNC shares) compare case-insensitively, POSIX-style roots case-sensitively.
 *
 * Symlinks and junctions are not resolved: this is a pure domain check, and the
 * harness sandbox remains the enforcement point for the real filesystem.
 * @param root - boundary the path must stay inside.
 * @param candidate - path to check; a relative path is resolved against `root`
 *   and is therefore inside it by construction unless it climbs out with `..`.
 *   Escaping a worktree consequently takes an absolute path — an agent editing
 *   the main checkout instead of its own worktree.
 */
export function isWithinRoot(root: string, candidate: string): boolean {
  const boundary = canonicalizePath(root)
  const target = canonicalizePath(candidate)
  if (boundary === undefined || target === undefined) return false
  const caseInsensitive = isWindowsPrefix(boundary.prefix)
  if (target.absolute) {
    if (!sameText(boundary.prefix, target.prefix, caseInsensitive)) return false
    return hasSegmentPrefix(target.segments, boundary.segments, caseInsensitive)
  }
  return hasSegmentPrefix([...boundary.segments, ...target.segments], boundary.segments, caseInsensitive)
}

/** A path reduced to the prefix that decides absoluteness plus its segments. */
interface CanonicalPath {
  /** True when the path named an absolute root of its own. */
  readonly absolute: boolean
  /** Drive (`C:`), UNC share, or `/`; empty for a relative path. */
  readonly prefix: string
  /** Segments with `.` dropped and `..` resolved. */
  readonly segments: readonly string[]
}

/** Reduce a path to comparable parts, or `undefined` when it cannot be trusted. */
function canonicalizePath(value: string): CanonicalPath | undefined {
  if (value === '' || value.includes('\0')) return undefined
  const unified = value.replace(/\\/g, '/')
  if (unified.startsWith('//')) {
    const parts = unified.slice(2).split('/').filter(part => part !== '' && part !== '.')
    if (parts.length < 2) return undefined
    const segments = walkSegments(parts.slice(2))
    if (segments === undefined) return undefined
    return { absolute: true, prefix: `//${parts[0]}/${parts[1]}`, segments }
  }
  const drive = /^([A-Za-z]):(?:\/|$)/.exec(unified)
  if (drive !== null) {
    const segments = walkSegments(unified.slice(drive[0].length).split('/'))
    if (segments === undefined) return undefined
    return { absolute: true, prefix: `${drive[1]}:`, segments }
  }
  if (/^[A-Za-z]:/.test(unified)) return undefined
  if (unified.startsWith('/')) {
    const segments = walkSegments(unified.slice(1).split('/'))
    if (segments === undefined) return undefined
    return { absolute: true, prefix: '/', segments }
  }
  const segments = walkSegments(unified.split('/'))
  if (segments === undefined) return undefined
  return { absolute: false, prefix: '', segments }
}

/**
 * Resolve `.` and `..` segments, or refuse a path that climbs above its start.
 *
 * Refusing is deliberate: `..` with nothing left to pop means the path left the
 * region it named, and clamping it to the root (POSIX behaviour) would silently
 * turn an escape attempt into an inside-the-root operation.
 *
 * A segment that ends in a dot or a space is refused as well, because Win32
 * strips those before resolving: checking `a.` or `a ` as a literal name while
 * the filesystem opens `a` — or `.` / `..` — would compare one path and read
 * another.
 */
function walkSegments(parts: readonly string[]): readonly string[] | undefined {
  const segments: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (segments.length === 0) return undefined
      segments.pop()
      continue
    }
    if (/[. ]$/.test(part)) return undefined
    segments.push(part)
  }
  return segments
}

/** Whether a prefix carries Windows case-insensitivity (a drive letter or a UNC share). */
function isWindowsPrefix(prefix: string): boolean {
  return /^[A-Za-z]:$/.test(prefix) || prefix.startsWith('//')
}

/** Compare two path prefixes. */
function sameText(left: string, right: string, caseInsensitive: boolean): boolean {
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right
}

/** Whether `segments` starts with `prefix`, segment by segment. */
function hasSegmentPrefix(
  segments: readonly string[],
  prefix: readonly string[],
  caseInsensitive: boolean,
): boolean {
  if (segments.length < prefix.length) return false
  for (let index = 0; index < prefix.length; index += 1) {
    const segment = segments[index]
    const expected = prefix[index]
    if (segment === undefined || expected === undefined) return false
    if (!sameText(segment, expected, caseInsensitive)) return false
  }
  return true
}

/** Shape of key material a credential reference must never carry. */
const SECRET_SHAPES: readonly (readonly [string, RegExp])[] = Object.freeze([
  ['a PEM block', /-----BEGIN [A-Z ]+-----/],
  ['a JSON web token', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['a vendor token', /(?:sk-|ghp_|gho_|ghu_|github_pat_|xox[abp]-|AKIA|AIza|ya29\.|glpat-)[A-Za-z0-9_-]{8,}/],
  [
    'an assignment of a secret',
    /(?:^|[\s"'&])(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*=/i,
  ],
  [
    'a column assignment of a secret',
    /(?:^|[\s"'{,])(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)["']?\s*:\s*["'\s]/i,
  ],
  ['a hexadecimal key', /\b[0-9a-fA-F]{32,}\b/],
])

/**
 * Describe the secret shape a value carries, or `undefined` when it carries none.
 *
 * The check refuses secret *shapes*, not unknown references: a reference is
 * opaque, so the rules have to be shapes no honest reference needs. A leading
 * `Bearer ` is stripped first, because that is where a token is handed over.
 * Two limits are deliberate and documented in the README: a long opaque run that
 * mixes case and digits is treated as key material even when it is an id, and a
 * reference with no secret shape at all (for example `op://vault/db-password`)
 * is accepted whatever store it names.
 */
function secretMaterialIn(value: string): string | undefined {
  const trimmed = value.trim()
  const presented = trimmed.replace(/^(?:bearer|token)\s+/i, '')
  for (const [shape, pattern] of SECRET_SHAPES) {
    if (pattern.test(trimmed) || pattern.test(presented)) return shape
  }
  return hasOpaqueKeyRun(presented) ? 'an opaque key' : undefined
}

/**
 * Whether the value contains a run that looks like a base64/hex key: long, and
 * mixing cases and digits. The run alphabet includes `-` and `_` because
 * base64url uses them, so splitting a key on them would let one through; this is
 * why reference ids are expected to be readable rather than opaque. Dashed UUIDs
 * and lowercase slugs still pass, because they do not mix cases and digits.
 */
function hasOpaqueKeyRun(value: string): boolean {
  for (const run of value.split(/[^A-Za-z0-9+/\-_]+/)) {
    if (run.length < 32) continue
    if (!/[A-Z]/.test(run) || !/[a-z]/.test(run) || !/[0-9]/.test(run)) continue
    return true
  }
  return false
}

/**
 * Whether two agent identities name the same actor.
 *
 * Identities are compared case-insensitively here even though {@link AgentId} is
 * a plain string everywhere else: refusing a case-different spelling of the
 * worker as a self-approval is the fail-closed direction, and this workspace is
 * case-insensitive by default (Windows). A canonical `AgentId` rule belongs to
 * the contract, and tightening the sibling check of `transitionReview` (MW-003)
 * is a separate change.
 */
function sameAgent(left: string, right: string): boolean {
  return normalizeAgent(left) === normalizeAgent(right)
}

/** Canonical spelling of an identity for comparison: composed, trimmed, casefolded. */
function normalizeAgent(value: string): string {
  return value.normalize('NFC').trim().toLowerCase()
}

/** Build a `SECURITY_DENIED` failure carrying its audit reason. */
function denied<T = never>(
  reason: string,
  message: string,
  details: Readonly<Record<string, unknown>>,
  meta: OperationMeta,
): Result<T> {
  return fail(new MyWorkError('SECURITY_DENIED', message, { details: { reason, ...details } }), meta)
}

/** Validate the grant an operation is checked against. */
function readContext(value: unknown): AuthorizationContext {
  const record = requireObject(value, 'an authorization context')
  requireClosedShape(record, AUTHORIZATION_CONTEXT_FIELDS, 'an authorization context')
  const agentId = requireIdentifier(record.agentId, 'agentId of the authorization context')
  const workspaceId = requireIdentifier(record.workspaceId, 'workspaceId of the authorization context')
  const workspaceRoot = requireIdentifier(record.workspaceRoot, `workspaceRoot of workspace "${workspaceId}"`)
  if (!HARNESS_POLICIES.includes(record.harnessPolicy as HarnessPolicy)) {
    throw new TypeError(`dsh-mywork: harnessPolicy must be one of ${HARNESS_POLICIES.join(', ')}`)
  }
  // Read once: validating one array and copying another would let an accessor
  // hand a checked grant to the gate and a wider one to the caller.
  const rawPermissions = record.permissions
  if (!Array.isArray(rawPermissions)) {
    throw new TypeError(`dsh-mywork: permissions of agent "${agentId}" must be an array`)
  }
  const granted = rawPermissions as readonly Permission[]
  for (const permission of granted) {
    if (!PERMISSIONS.includes(permission)) {
      throw new TypeError(`dsh-mywork: agent "${agentId}" carries unknown permission "${String(permission)}"`)
    }
  }
  if (record.reviewer !== undefined && typeof record.reviewer !== 'boolean') {
    throw new TypeError(`dsh-mywork: reviewer of agent "${agentId}" must be a boolean`)
  }
  const workerAgentId =
    record.workerAgentId === undefined
      ? undefined
      : requireIdentifier(record.workerAgentId, `workerAgentId of agent "${agentId}"`)
  let worktreeRoot: string | undefined
  if (record.worktreeRoot !== undefined) {
    worktreeRoot = requireIdentifier(record.worktreeRoot, `worktreeRoot of agent "${agentId}"`)
    if (!isWithinRoot(workspaceRoot, worktreeRoot)) {
      throw new TypeError(
        `dsh-mywork: worktreeRoot "${worktreeRoot}" of agent "${agentId}" is outside workspaceRoot "${workspaceRoot}"`,
      )
    }
  }
  const built: AuthorizationContext = {
    agentId,
    permissions: Object.freeze([...granted]),
    workspaceId,
    workspaceRoot,
    harnessPolicy: record.harnessPolicy as HarnessPolicy,
    ...(record.reviewer === undefined ? {} : { reviewer: record.reviewer as boolean }),
    ...(workerAgentId === undefined ? {} : { workerAgentId }),
    ...(worktreeRoot === undefined ? {} : { worktreeRoot }),
  }
  return Object.freeze(built)
}

/** Validate an operation request. */
function readRequest(value: unknown): OperationRequest {
  const record = requireObject(value, 'an operation request')
  requireClosedShape(record, OPERATION_REQUEST_FIELDS, 'an operation request')
  const domain = requireIdentifier(record.domain, 'domain of the operation request')
  const action = requireIdentifier(record.action, 'action of the operation request')
  const workspaceId = requireIdentifier(record.workspaceId, 'workspaceId of the operation request')
  let path: string | undefined
  if (record.path !== undefined) {
    path = requireIdentifier(record.path, 'path of the operation request')
  }
  let credential: CredentialReference | undefined
  if (record.credential !== undefined) {
    credential = readCredentialReference(record.credential)
  }
  let gate: HumanGate | undefined
  if (record.gate !== undefined) {
    if (!HUMAN_GATES.includes(record.gate as HumanGate)) {
      throw new TypeError(`dsh-mywork: gate of the operation request must be one of ${HUMAN_GATES.join(', ')}`)
    }
    gate = record.gate as HumanGate
  }
  const built: OperationRequest = {
    domain: domain as OperationRequest['domain'],
    action,
    workspaceId,
    ...(path === undefined ? {} : { path }),
    ...(credential === undefined ? {} : { credential }),
    ...(gate === undefined ? {} : { gate }),
  }
  return Object.freeze(built)
}

/** Validate a credential reference value. */
function readCredentialReference(value: unknown): CredentialReference {
  const record = requireObject(value, 'a credential reference')
  requireClosedShape(record, CREDENTIAL_REFERENCE_FIELDS, 'a credential reference')
  return Object.freeze({ ref: requireIdentifier(record.ref, 'ref of the credential reference') })
}

/**
 * Reject a field the shape does not declare.
 *
 * Own string keys are checked whether or not they are enumerable, symbols are
 * refused outright, and {@link requireObject} has already refused an exotic
 * prototype — otherwise a value built with `Object.create({...})` would pass a
 * closed shape while its fields arrived by inheritance. A `Proxy` that lies
 * about its own keys cannot be caught in-process; the schemas are read by the
 * host, not by an agent.
 */
function requireClosedShape(record: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const symbols = Object.getOwnPropertySymbols(record)
  if (symbols.length > 0) {
    throw new TypeError(`dsh-mywork: ${field} carries symbol field "${String(symbols[0])}"`)
  }
  for (const key of Object.getOwnPropertyNames(record)) {
    if (allowed.includes(key)) continue
    throw new TypeError(`dsh-mywork: ${field} carries unknown field "${key}"`)
  }
}

/**
 * Require a plain object: no array, no class instance, no inherited fields.
 *
 * "Plain" is judged by identity with this realm's `Object.prototype`, so an
 * object carried across a realm boundary (`node:vm`) is refused rather than
 * trusted. That is the fail-closed direction, and no caller needs it today.
 */
function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`dsh-mywork: ${field} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`dsh-mywork: ${field} must be a plain object without an inherited prototype`)
  }
  return value as Record<string, unknown>
}

/** Require a non-empty string. */
function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`dsh-mywork: ${field} must be a non-empty string`)
  }
  return value
}
