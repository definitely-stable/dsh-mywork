/**
 * Authority enforcement over the data authority matrix (architecture §8).
 *
 * Every write names the domain it touches and the store performing it; a store
 * that is not an owner is refused with `SECURITY_DENIED` instead of being
 * trusted to behave. The Task Board is a projection, so it can be read and
 * rebuilt but never becomes a second authority.
 * @module
 */

import {
  AUTHORITY_DOMAINS,
  AUTHORITY_MATRIX,
  type AuthorityDomain,
  type AuthorityOwner,
  type AuthorityRow,
  type OperationMeta,
  type Result,
} from '@dsh-mywork/contracts'
import { MyWorkError, fail, ok } from './errors.ts'

/**
 * Row of the matrix for one domain.
 * @param domain - the domain to look up.
 * @throws {TypeError} when the domain is not in the matrix.
 */
export function authorityOf(domain: AuthorityDomain): AuthorityRow {
  const row = AUTHORITY_MATRIX[domain] as AuthorityRow | undefined
  if (row === undefined) {
    throw new TypeError(`dsh-mywork: unknown authority domain "${String(domain)}"`)
  }
  return row
}

/**
 * The store that writes a domain.
 * @param domain - the domain to look up.
 */
export function primaryOwnerOf(domain: AuthorityDomain): AuthorityOwner {
  return authorityOf(domain).owners[0]
}

/**
 * Whether a store may write a domain.
 * @param domain - the domain being written.
 * @param owner - the store performing the write.
 */
export function mayWrite(domain: AuthorityDomain, owner: AuthorityOwner): boolean {
  return authorityOf(domain).owners.includes(owner)
}

/**
 * Whether the owner of a domain is a control surface rather than an authority.
 * @param domain - the domain to look up.
 */
export function isProjectionDomain(domain: AuthorityDomain): boolean {
  return authorityOf(domain).projection
}

/**
 * Refuse a write by a store that does not own the domain (§8).
 * @param domain - the domain being written.
 * @param owner - the store performing the write.
 * @param meta - operation identity.
 */
export function assertWriteAuthority(
  domain: AuthorityDomain,
  owner: AuthorityOwner,
  meta: OperationMeta,
): Result<AuthorityRow> {
  const row = authorityOf(domain)
  if (!row.owners.includes(owner)) {
    return fail(
      new MyWorkError('SECURITY_DENIED', `dsh-mywork: "${owner}" does not own "${domain}"`, {
        details: { domain, owner, owners: [...row.owners] },
      }),
      meta,
    )
  }
  return ok(row, meta)
}

/** Every domain the matrix describes. */
export function authorityDomains(): readonly AuthorityDomain[] {
  return AUTHORITY_DOMAINS
}
