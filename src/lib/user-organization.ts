import { Prisma, type PrismaClient } from '@prisma/client'
import { createPrismaClient } from '@/lib/prisma'
import { getRoleIdByName } from '@/lib/role-lookup'
import { createDomainMatchService } from '@/services/domain-verification'

// JWT invalidation: NOT bumped from this file. A Postgres trigger on
// memberships (migration prisma/migrations/1_jwt_invalidation) bumps
// User.jwtInvalidatedAt on every insert/update/delete. Application-level bumps
// (bumpJwtInvalidatedAt in src/lib/auth-helpers.ts) remain only for writes the
// trigger does not cover, such as FacilityAccess grants/revokes in
// src/server/api/routers/facility.ts. See ADR-020 Phase 4 follow-up.

export interface CreateUserOrganizationParams {
  userId: string
  userName?: string | null
  userEmail: string
  /**
   * When false, a user with no membership and no matching domain claim is left
   * without an org (returns null) instead of getting a personal org. Defaults
   * to true.
   */
  allowPersonalOrg?: boolean
  /**
   * When false, skip the OrganizationDomain claim step. Use for sign-ups whose
   * email ownership has not been proven (password sign-up), otherwise anyone
   * could join a customer org by registering an address on its domain.
   * Defaults to true (IdP-verified and portal-token emails).
   */
  allowDomainClaim?: boolean
}

export type AttachmentReason = 'existing-membership' | 'domain-claim' | 'personal-org-created'

export interface CreateUserOrganizationResult {
  organization: { id: string; name: string; slug: string }
  reason: AttachmentReason
}

const MAX_SLUG_ATTEMPTS = 8

/**
 * Returns the organization the user is (or now is) attached to.
 *
 * Resolution order:
 *   1. Existing membership → return it (idempotent re-entry safe)
 *   2. Customer domain claim → attach as MEMBER, no personal org created
 *   3. Personal org bootstrap → create org + OWNER membership (skipped and
 *      `null` returned when `allowPersonalOrg` is false)
 *
 * All write paths bump `User.jwtInvalidatedAt` so the next NextAuth jwt callback
 * re-enriches `orgIds`/`facilityAccess` instead of serving a
 * stale JWT.
 *
 * Idempotency:
 *   - Membership creation uses `upsert` on the (organizationId, userId) unique key.
 *   - Slug uniqueness is enforced via optimistic insert + P2002 retry, not the
 *     previous read-then-create TOCTOU loop.
 *
 * Residual race window: under concurrent first-sign-ins for the same user, two
 * personal orgs may be created (the duplicate slug retries past the conflict).
 * The `findFirst` on existing membership above narrows but cannot fully eliminate
 * the race — interactive transactions are unreliable on the Supabase pgbouncer
 * pool we use. Acceptable for now; revisit with advisory locks in Phase 2.
 */
export async function createUserOrganization({
  userId,
  userName,
  userEmail,
  allowPersonalOrg = true,
  allowDomainClaim = true,
}: CreateUserOrganizationParams): Promise<CreateUserOrganizationResult | null> {
  const prisma = createPrismaClient()

  const existingMembership = await prisma.membership.findFirst({
    where: { userId },
    include: { organization: true },
  })

  if (existingMembership) {
    return { organization: existingMembership.organization, reason: 'existing-membership' }
  }

  // OrganizationDomain claim: attach to a verified-domain org as MEMBER (or that
  // domain's defaultRoleName) instead of creating a personal FREE org. Replaces
  // the Phase 0 hardcoded CUSTOMER_DOMAIN_CLAIMS map. See ADR-020 Phase 2 (FOR-1479).
  const claim = allowDomainClaim
    ? await createDomainMatchService(prisma).findClaimingOrg(userEmail)
    : null
  if (claim) {
    const claimedOrg = await prisma.organization.findUnique({
      where: { id: claim.organizationId },
      select: { id: true, name: true, slug: true },
    })
    if (claimedOrg) {
      const roleId = await getRoleIdByName(claim.defaultRoleName)
      if (roleId) {
        await prisma.membership.upsert({
          where: { organizationId_userId: { organizationId: claimedOrg.id, userId } },
          create: { organizationId: claimedOrg.id, userId, roleId },
          update: {},
        })
        // jwtInvalidatedAt is bumped by the membership trigger.
        console.log(
          `Attached user ${userEmail} (id=${userId}) as ${claim.defaultRoleName} of "${claimedOrg.name}" via OrganizationDomain ${claim.domainId}`,
        )
        return { organization: claimedOrg, reason: 'domain-claim' }
      }
      console.warn(
        `OrganizationDomain ${claim.domainId} references roleName "${claim.defaultRoleName}" which is missing from the Role table`,
      )
    } else {
      console.warn(
        `OrganizationDomain ${claim.domainId} references org ${claim.organizationId} which doesn't exist on this Dashboard DB`,
      )
    }
  }

  if (allowPersonalOrg === false) {
    return null
  }

  // Personal-org bootstrap path.
  const orgName = userName ? `${userName}'s Org` : `${userEmail || 'User'}'s Org`
  const baseSlug = slugify(userName || (userEmail || 'user').split('@')[0]) + '-org'

  const ownerRoleId = await getRoleIdByName('OWNER')
  if (!ownerRoleId) {
    throw new Error('OWNER role not found in database')
  }

  const organization = await createOrgWithUniqueSlug(prisma, baseSlug, {
    name: orgName,
    description: `Personal organization for ${userName || userEmail || 'User'}`,
    ownerId: userId,
    userId,
    ownerRoleId,
  })

  // jwtInvalidatedAt is bumped by the membership triggers.
  console.log(`Created organization "${orgName}" for user: ${userEmail}`)
  return { organization, reason: 'personal-org-created' }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function createOrgWithUniqueSlug(
  prisma: PrismaClient,
  baseSlug: string,
  data: { name: string; description: string; ownerId: string; userId: string; ownerRoleId: string },
): Promise<{ id: string; name: string; slug: string }> {
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt}`
    try {
      return await prisma.organization.create({
        data: {
          name: data.name,
          slug,
          description: data.description,
          ownerId: data.ownerId,
          memberships: {
            create: { userId: data.userId, roleId: data.ownerRoleId },
          },
        },
        select: { id: true, name: true, slug: true },
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target) &&
        (error.meta.target as string[]).includes('slug')
      ) {
        continue
      }
      throw error
    }
  }
  throw new Error(`Failed to allocate unique slug after ${MAX_SLUG_ATTEMPTS} attempts (base: ${baseSlug})`)
}

