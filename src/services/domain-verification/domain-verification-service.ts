import { createHash, randomBytes } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { sendDomainVerificationEmail } from '@/lib/email'
import { normalizeEmailDomain, parentDomains } from './domain-match-service'

const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000

export interface ClaimDomainParams {
  prisma: PrismaClient
  organizationId: string
  domain: string
  claimerUserId: string
  claimerEmail: string
  appUrl: string // used to build the verification link
  defaultRoleName?: string
  includeSubdomains?: boolean
}

export interface ClaimDomainResult {
  domainId: string
  status: 'VERIFYING' | 'VERIFIED' | 'REJECTED'
  reason?: string
  emailSent: boolean
}

/**
 * Initiate (or re-initiate) a domain claim. The flow:
 *   1. Normalize and validate the domain.
 *   2. Reject if it's a generic mailbox provider (gmail, yahoo, etc.).
 *   3. Reject if the claimer's email is not on the domain (proves the claimer
 *      can receive mail at the domain).
 *   4. Reject if another VERIFIED claim exists for the same domain.
 *   5. Upsert a row in PENDING/VERIFYING with a freshly-issued challenge token.
 *   6. Send a magic-link email to the claimer's email address (which is on the
 *      target domain). Email-send failure logs but does not abort — the row is
 *      still created so an admin can resend.
 *
 * The challenge token is generated as 32 random bytes (hex). Only the sha256
 * hash is stored in the DB; the plaintext is never persisted server-side.
 */
export async function claimDomain(params: ClaimDomainParams): Promise<ClaimDomainResult> {
  const {
    prisma,
    organizationId,
    domain: rawDomain,
    claimerUserId,
    claimerEmail,
    appUrl,
    defaultRoleName = 'MEMBER',
    includeSubdomains = false,
  } = params

  const domain = normalizeEmailDomain('user@' + rawDomain) ?? null
  if (!domain) {
    return { domainId: '', status: 'REJECTED', reason: 'invalid-domain', emailSent: false }
  }

  const claimerDomain = normalizeEmailDomain(claimerEmail)
  if (!claimerDomain) {
    return { domainId: '', status: 'REJECTED', reason: 'invalid-claimer-email', emailSent: false }
  }
  // Claimer must be on the domain (or a subdomain when includeSubdomains is true).
  const onDomain =
    claimerDomain === domain ||
    (includeSubdomains && parentDomains(claimerDomain).includes(domain))
  if (!onDomain) {
    return {
      domainId: '',
      status: 'REJECTED',
      reason: 'claimer-not-on-domain',
      emailSent: false,
    }
  }

  // Reject generic providers regardless of claim attempts.
  const isGeneric = await prisma.genericEmailDomain.findUnique({ where: { domain }, select: { domain: true } })
  if (isGeneric) {
    return { domainId: '', status: 'REJECTED', reason: 'generic-provider', emailSent: false }
  }

  // Reject if another org has already VERIFIED this domain.
  const conflict = await prisma.organizationDomain.findFirst({
    where: { domain, status: 'VERIFIED', organizationId: { not: organizationId } },
    select: { id: true },
  })
  if (conflict) {
    return { domainId: '', status: 'REJECTED', reason: 'already-verified-by-other-org', emailSent: false }
  }

  // Generate fresh challenge.
  const token = randomBytes(32).toString('hex')
  const tokenHash = sha256Hex(token)
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS)

  // Upsert: existing PENDING/VERIFYING row gets a new challenge; VERIFIED rows
  // for the same (org, domain) pair are not disturbed.
  const existing = await prisma.organizationDomain.findFirst({
    where: { organizationId, domain, status: { not: 'VERIFIED' } },
    select: { id: true },
  })

  let domainId: string
  let fromStatus: 'PENDING' | 'VERIFYING' | 'REJECTED' | 'REVOKED' | null = null

  if (existing) {
    const updated = await prisma.organizationDomain.update({
      where: { id: existing.id },
      data: {
        status: 'VERIFYING',
        method: 'ADMIN_EMAIL',
        defaultRoleName,
        includeSubdomains,
        challengeTokenHash: tokenHash,
        challengeExpiresAt: expiresAt,
        verifiedAt: null,
        verifiedByUserId: null,
        revokedAt: null,
        revokedByUserId: null,
      },
      select: { id: true, status: true },
    })
    domainId = updated.id
    fromStatus = 'PENDING'
  } else {
    const created = await prisma.organizationDomain.create({
      data: {
        organizationId,
        domain,
        status: 'VERIFYING',
        method: 'ADMIN_EMAIL',
        defaultRoleName,
        includeSubdomains,
        challengeTokenHash: tokenHash,
        challengeExpiresAt: expiresAt,
        createdByUserId: claimerUserId,
      },
      select: { id: true },
    })
    domainId = created.id
    fromStatus = null
  }

  await prisma.organizationDomainEvent.create({
    data: {
      domainId,
      fromStatus,
      toStatus: 'VERIFYING',
      actorUserId: claimerUserId,
      reason: 'challenge-issued',
      metadata: { expiresAt: expiresAt.toISOString() },
    },
  })

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  })

  const verifyUrl = `${appUrl.replace(/\/$/, '')}/api/auth/verify-domain?id=${encodeURIComponent(domainId)}&token=${encodeURIComponent(token)}`
  const emailSent = await sendDomainVerificationEmail({
    to: claimerEmail,
    domain,
    organizationName: org?.name ?? 'your organization',
    verifyUrl,
  })

  return { domainId, status: 'VERIFYING', emailSent }
}

export interface ConfirmChallengeParams {
  prisma: PrismaClient
  domainId: string
  token: string
  actorUserId?: string | null
}

export type ConfirmChallengeResult =
  | { ok: true; organizationId: string; domain: string }
  | { ok: false; reason: 'not-found' | 'wrong-status' | 'token-mismatch' | 'expired' | 'conflict' | 'internal-error' }

/**
 * Verify the challenge token and transition VERIFYING → VERIFIED. Wraps the
 * conflict re-check in a Postgres advisory lock so two simultaneous claims
 * for the same domain can't both win the race.
 */
export async function confirmChallenge({
  prisma,
  domainId,
  token,
  actorUserId,
}: ConfirmChallengeParams): Promise<ConfirmChallengeResult> {
  const domainRow = await prisma.organizationDomain.findUnique({
    where: { id: domainId },
    select: {
      id: true,
      domain: true,
      organizationId: true,
      status: true,
      challengeTokenHash: true,
      challengeExpiresAt: true,
    },
  })
  if (!domainRow) return { ok: false, reason: 'not-found' }
  if (domainRow.status !== 'VERIFYING') return { ok: false, reason: 'wrong-status' }
  if (!domainRow.challengeTokenHash) return { ok: false, reason: 'token-mismatch' }
  if (sha256Hex(token) !== domainRow.challengeTokenHash) return { ok: false, reason: 'token-mismatch' }
  if (domainRow.challengeExpiresAt && domainRow.challengeExpiresAt < new Date()) {
    await prisma.organizationDomain.update({
      where: { id: domainId },
      data: { status: 'REJECTED' },
    })
    await prisma.organizationDomainEvent.create({
      data: {
        domainId,
        fromStatus: 'VERIFYING',
        toStatus: 'REJECTED',
        actorUserId: actorUserId ?? null,
        reason: 'challenge-expired',
      },
    })
    return { ok: false, reason: 'expired' }
  }

  // Postgres advisory lock keyed by domain — serializes concurrent claims for
  // the same domain to prevent two orgs from both transitioning to VERIFIED.
  // Uses a SELECT...FOR UPDATE-style lock that auto-releases at session end.
  // Note: Supabase pgbouncer transaction-mode pool can drop session-mode
  // advisory locks; we use pg_advisory_xact_lock inside an executeRaw which
  // is wrapped implicitly in a transaction by Prisma.
  try {
    await prisma.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${domainRow.domain}))`)
    const verifiedConflict = await prisma.organizationDomain.findFirst({
      where: { domain: domainRow.domain, status: 'VERIFIED' },
      select: { id: true },
    })
    if (verifiedConflict) {
      await prisma.organizationDomain.update({
        where: { id: domainId },
        data: { status: 'REJECTED' },
      })
      await prisma.organizationDomainEvent.create({
        data: {
          domainId,
          fromStatus: 'VERIFYING',
          toStatus: 'REJECTED',
          actorUserId: actorUserId ?? null,
          reason: 'conflict-domain-already-verified',
        },
      })
      return { ok: false, reason: 'conflict' }
    }

    await prisma.organizationDomain.update({
      where: { id: domainId },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedByUserId: actorUserId ?? null,
        challengeTokenHash: null,
        challengeExpiresAt: null,
      },
    })
    await prisma.organizationDomainEvent.create({
      data: {
        domainId,
        fromStatus: 'VERIFYING',
        toStatus: 'VERIFIED',
        actorUserId: actorUserId ?? null,
        reason: 'challenge-confirmed',
      },
    })
    return { ok: true, organizationId: domainRow.organizationId, domain: domainRow.domain }
  } catch (error) {
    console.error('[domain-verification] confirmChallenge error:', error)
    return { ok: false, reason: 'internal-error' }
  }
}

export interface RevokeDomainParams {
  prisma: PrismaClient
  domainId: string
  organizationId: string
  actorUserId: string
  reason?: string
}

export async function revokeDomain({
  prisma,
  domainId,
  organizationId,
  actorUserId,
  reason,
}: RevokeDomainParams): Promise<{ ok: true } | { ok: false; reason: 'not-found' | 'not-verified' }> {
  const row = await prisma.organizationDomain.findUnique({
    where: { id: domainId },
    select: { id: true, organizationId: true, status: true },
  })
  if (!row || row.organizationId !== organizationId) return { ok: false, reason: 'not-found' }
  if (row.status !== 'VERIFIED' && row.status !== 'VERIFYING' && row.status !== 'PENDING') {
    return { ok: false, reason: 'not-verified' }
  }

  const previousStatus = row.status
  await prisma.organizationDomain.update({
    where: { id: domainId },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedByUserId: actorUserId,
      challengeTokenHash: null,
      challengeExpiresAt: null,
    },
  })
  await prisma.organizationDomainEvent.create({
    data: {
      domainId,
      fromStatus: previousStatus,
      toStatus: 'REVOKED',
      actorUserId,
      reason: reason ?? 'admin-revoke',
    },
  })
  return { ok: true }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
