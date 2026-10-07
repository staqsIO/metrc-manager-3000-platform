import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';

/**
 * Get all organization IDs the current user belongs to, ordered by earliest membership first.
 * Throws FORBIDDEN if the user has no memberships.
 */
export async function getUserOrgIds(
  prisma: PrismaClient,
  userId: string,
): Promise<string[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: { organizationId: true },
    orderBy: { createdAt: 'asc' },
  });
  if (memberships.length === 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'No organization membership found for user',
    });
  }
  return memberships.map((m) => m.organizationId);
}

/**
 * Bump `User.jwtInvalidatedAt` for one or more users. Forces their next NextAuth
 * jwt-callback refresh (≤60s by default, see `JWT_FRESHNESS_CHECK_INTERVAL_SEC`
 * in lib/auth.ts) to re-enrich orgIds / facilityAccess from
 * the DB instead of serving the cached JWT payload.
 *
 * Scope after the ADR-020 Phase 4 follow-up: Membership writes
 * are handled by a Postgres trigger on memberships (migration
 * prisma/migrations/1_jwt_invalidation). Call this helper only for writes
 * that trigger does not cover:
 *   - granting / revoking FacilityAccess (no trigger covers that table)
 *   - flipping Organization.environment when the change is staff-driven and
 *     should propagate immediately
 *
 * See ADR-020 Phase 4 (FOR-1481) for the full freshness contract.
 */
export async function bumpJwtInvalidatedAt(
  prisma: PrismaClient,
  userIds: string | string[],
): Promise<void> {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  if (ids.length === 0) return;
  try {
    await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { jwtInvalidatedAt: new Date() },
    });
  } catch (error) {
    // Best-effort: a missed bump means stale JWT until natural session rollover
    // (7d after Phase 4). Log + continue, never block the calling mutation.
    console.error(`[auth-helpers] bumpJwtInvalidatedAt failed for ${ids.length} user(s):`, error);
  }
}
