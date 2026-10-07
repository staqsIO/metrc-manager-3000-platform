import { domainToASCII } from 'node:url'
import type { PrismaClient } from '@prisma/client'
import type { DomainClaim, DomainMatchService } from './types'

/**
 * Read-side of OrganizationDomain — used by `createUserOrganization` to decide
 * whether a new user with no membership should be auto-attached to an existing
 * customer org instead of getting a personal FREE org.
 *
 * Pure read paths: no writes, no challenge issuance. State machine + challenge
 * lifecycle live in sibling modules (deferred to a later commit in ADR-020
 * Phase 2 / FOR-1479).
 */
export function createDomainMatchService(prisma: PrismaClient): DomainMatchService {
  return {
    async findClaimingOrg(email: string): Promise<DomainClaim | null> {
      const domain = normalizeEmailDomain(email)
      if (!domain) return null

      // Generic providers are off-limits regardless of any OrganizationDomain row.
      if (await isGenericDomain(prisma, domain)) return null

      // Exact-match VERIFIED claim.
      const exact = await prisma.organizationDomain.findFirst({
        where: { domain, status: 'VERIFIED' },
        select: { id: true, organizationId: true, defaultRoleName: true },
      })
      if (exact) {
        return {
          domainId: exact.id,
          organizationId: exact.organizationId,
          defaultRoleName: exact.defaultRoleName,
        }
      }

      // Subdomain claim: when an org claims `example.com` with includeSubdomains=true,
      // a user on `eng.example.com` should match. Walk parent domains.
      const parents = parentDomains(domain)
      if (parents.length > 0) {
        const subdomainMatch = await prisma.organizationDomain.findFirst({
          where: {
            domain: { in: parents },
            status: 'VERIFIED',
            includeSubdomains: true,
          },
          select: { id: true, organizationId: true, defaultRoleName: true },
        })
        if (subdomainMatch) {
          return {
            domainId: subdomainMatch.id,
            organizationId: subdomainMatch.organizationId,
            defaultRoleName: subdomainMatch.defaultRoleName,
          }
        }
      }

      return null
    },

    async isGenericDomain(domain: string): Promise<boolean> {
      return isGenericDomain(prisma, domain)
    },

    normalizeDomain(rawEmail: string): string | null {
      return normalizeEmailDomain(rawEmail)
    },
  }
}

async function isGenericDomain(prisma: PrismaClient, domain: string): Promise<boolean> {
  const row = await prisma.genericEmailDomain.findUnique({ where: { domain }, select: { domain: true } })
  return row !== null
}

/**
 * Lowercases, trims, strips a trailing dot, IDN-punycodes the domain.
 * Returns null when the input doesn't contain a valid email-like `@domain`.
 *
 * Plus-addressing: `user+tag@example.com` → domain `example.com` (the
 * local-part is irrelevant for domain matching).
 */
export function normalizeEmailDomain(rawEmail: string | null | undefined): string | null {
  if (!rawEmail || typeof rawEmail !== 'string') return null
  const trimmed = rawEmail.trim()
  // Use the rightmost @ to split — handles edge cases where local-part itself
  // could contain @-like characters (rare but RFC-allowed inside quotes).
  const atIdx = trimmed.lastIndexOf('@')
  if (atIdx <= 0 || atIdx === trimmed.length - 1) return null

  let domain = trimmed.slice(atIdx + 1).toLowerCase()
  // Strip trailing dot (FQDN form `example.com.`)
  if (domain.endsWith('.')) domain = domain.slice(0, -1)
  // Reject leading dot or empty
  if (domain.length === 0 || domain.startsWith('.')) return null
  // IDN → punycode
  const ascii = domainToASCII(domain)
  if (!ascii) return null
  // Sanity: must contain at least one dot
  if (!ascii.includes('.')) return null
  return ascii
}

/**
 * Returns parent domains for subdomain matching.
 *   parentDomains('eng.example.com') === ['example.com']
 *   parentDomains('example.com')     === []
 *
 * We don't return the public suffix itself (e.g. 'com') because it can never
 * be a legitimate org claim — the partial unique index plus the
 * `includeSubdomains` flag together prevent abuse, but skipping the TLD is
 * a defense-in-depth measure.
 */
export function parentDomains(normalized: string): string[] {
  const labels = normalized.split('.')
  if (labels.length <= 2) return []
  const parents: string[] = []
  for (let i = 1; i < labels.length - 1; i++) {
    parents.push(labels.slice(i).join('.'))
  }
  return parents
}
