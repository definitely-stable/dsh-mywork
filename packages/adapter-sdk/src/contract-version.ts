/**
 * Port contract revisions (architecture §37): an adapter declares the contract
 * it implements as `<port>/v<major>`, and the SDK decides whether that
 * declaration is well formed and whether it matches the revision MyWork speaks.
 *
 * Shape and compatibility are deliberately separate: a malformed revision is a
 * programming error (`TypeError`), while a well-formed revision of another
 * major is a contract mismatch the registry reports as `CONTRACT_MISMATCH`.
 * @module
 */

/** Major revision of every port contract this SDK implements. */
export const PORT_CONTRACT_MAJOR = 1

/** A parsed `<family>/v<major>` contract revision. */
export interface ParsedContractVersion {
  /** Port family the revision belongs to, e.g. `memory`. */
  readonly family: string
  /** Positive major revision, e.g. `1`. */
  readonly major: number
}

/** `<port>/v<major>`: a lowercase slug, a literal `v`, and a positive integer. */
const CONTRACT_VERSION = /^([a-z][a-z0-9-]*)\/v([1-9][0-9]*)$/

/**
 * Contract revision MyWork implements for a port family, e.g. `memory/v1`.
 * @param family - port family, normally an {@link AdapterKind}.
 */
export function portContractVersion(family: string): string {
  return `${family}/v${PORT_CONTRACT_MAJOR}`
}

/**
 * Parse a contract revision.
 *
 * The syntax is strict on purpose: `memory`, `memory/v`, `memory/v0`,
 * `Memory/v1`, and `1.0` are all refused, so a typo cannot pass as a supported
 * revision.
 * @param value - the declaration to parse.
 * @returns the parsed revision, or `undefined` when the value is not one.
 */
export function parseContractVersion(value: string): ParsedContractVersion | undefined {
  if (typeof value !== 'string') return undefined
  const match = CONTRACT_VERSION.exec(value)
  if (match === null) return undefined
  const family = match[1]
  const major = match[2]
  if (family === undefined || major === undefined) return undefined
  return Object.freeze({ family, major: Number(major) })
}

/**
 * Whether two contract revisions are compatible.
 *
 * Compatibility means the same port family and the same major revision: a
 * different major is a contract change, not a newer adapter, so it is refused
 * instead of being negotiated silently.
 * @param actual - revision an adapter implements.
 * @param expected - revision the caller requires.
 */
export function isContractVersionCompatible(actual: string, expected: string): boolean {
  const left = parseContractVersion(actual)
  const right = parseContractVersion(expected)
  if (left === undefined || right === undefined) return false
  return left.family === right.family && left.major === right.major
}

/**
 * The next major revision of a contract, e.g. `memory/v1` → `memory/v2`. Used
 * to build a declaration that must be refused and prove it really is.
 * @param version - a valid contract revision.
 * @throws {TypeError} when the value is not a contract revision.
 */
export function nextContractMajor(version: string): string {
  const parsed = parseContractVersion(version)
  if (parsed === undefined) {
    throw new TypeError(`dsh-mywork: "${version}" is not a port contract revision like "memory/v1"`)
  }
  return `${parsed.family}/v${parsed.major + 1}`
}
