import { initTRPC, TRPCError } from '@trpc/server';
import { type CreateNextContextOptions } from '@trpc/server/adapters/next';
import { getServerSession } from 'next-auth';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { isMetrcPlatformEnabled } from '@/lib/feature-flags';
import { getBrand } from '@/lib/brand';
import { ACTIVE_ORG_COOKIE } from '@/lib/active-org';
import { getUserOrgIds } from '@/lib/auth-helpers';

type CreateContextOptions = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
  activeOrgId: string | null;
  /** Raw client-address headers, used only for the demo's free-question limit. */
  forwardedFor?: string | string[] | null;
  realIp?: string | string[] | null;
};

const createInnerTRPCContext = (opts: CreateContextOptions) => {
  if (!prisma) {
    throw new Error('Prisma client not initialized');
  }
  return {
    prisma,
    session: opts.session,
    activeOrgId: opts.activeOrgId,
    // Spread so the field stays optional for createCaller in tests and server components.
    ...(opts.forwardedFor != null ? { forwardedFor: opts.forwardedFor } : {}),
    ...(opts.realIp != null ? { realIp: opts.realIp } : {}),
  };
};

export const createTRPCContext = async (opts: CreateNextContextOptions) => {
  const session = await getServerSession(opts.req, opts.res, authOptions);
  const activeOrgId = opts.req.cookies[ACTIVE_ORG_COOKIE] ?? null;
  return createInnerTRPCContext({ session, activeOrgId, forwardedFor: opts.req.headers['x-forwarded-for'] ?? null, realIp: opts.req.headers['x-real-ip'] ?? null });
};

const t = initTRPC.context<typeof createTRPCContext>().create();

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

// Protected procedure - requires auth
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  if (!ctx.prisma) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Database not available',
    });
  }
  return next({
    ctx: {
      ...ctx,
      prisma: ctx.prisma,
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

// Super admin procedure - platform-wide settings (LLM providers). Checked against the DB, not the JWT,
// so revoking isPlatformAdmin takes effect immediately.
export const superAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const user = await dashboardPrisma.user.findUnique({
    where: { id: ctx.session.user.id },
    select: { isPlatformAdmin: true },
  });
  if (!user?.isPlatformAdmin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Super admin only' });
  }
  return next();
});

// Platform procedure - requires auth and the platform kill switch to be on
export const platformProcedure = protectedProcedure.use(({ next }) => {
  if (!isMetrcPlatformEnabled()) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `${getBrand().name} is currently unavailable.` });
  }
  return next();
});

// FOR-1172: Facility role hierarchy for access checks
const FACILITY_ROLE_HIERARCHY: Record<string, number> = {
  VIEWER: 0,
  OPERATOR: 1,
  ADMIN: 2,
};

/** Check if a facility role meets the minimum required level. */
export function requireFacilityRole(role: string, minimum: string): boolean {
  const roleLevel = FACILITY_ROLE_HIERARCHY[role] ?? -1;
  const minLevel = FACILITY_ROLE_HIERARCHY[minimum];
  if (minLevel === undefined) {
    throw new Error(`Unknown facility role: ${minimum}`);
  }
  return roleLevel >= minLevel;
}

/**
 * Resolve the user's org IDs from JWT or DB fallback.
 * Shared between facilityProcedure and multiFacilityProcedure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveOrgIds(session: any): Promise<string[]> {
  // Always query fresh org IDs from the dashboard DB to avoid JWT staleness.
  // The JWT orgIds can become stale when a user joins/leaves an org without re-signing in,
  // causing facilityProcedure to reject facilities that the user can see in the sidebar
  // (which uses getUserOrgIds with a fresh query). This is a lightweight index scan.
  const orgIds = await getUserOrgIds(dashboardPrisma, session.user.id);
  if (orgIds.length === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No organization membership found' });
  }
  return orgIds;
}

/**
 * Resolve the facility role for a user on a specific facility.
 * If the user has no FacilityAccess rows at all → implicit ADMIN (backward compat).
 * If they have rows but not for this facility → denied.
 */
function resolveFacilityRole(
  facilityAccess: Record<string, string>,
  facilityId: string,
): string {
  const hasAnyGrants = Object.keys(facilityAccess).length > 0;
  if (!hasAnyGrants) {
    // Backward compat: no FacilityAccess rows = implicit ADMIN on all org facilities
    return 'ADMIN';
  }
  if (facilityAccess[facilityId]) {
    return facilityAccess[facilityId];
  }
  // User has grants but NOT for this facility → denied
  throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this facility' });
}

// Facility procedure - validates user has access to the facility via org membership + facility-level ACL
export const facilityProcedure = platformProcedure.use(async ({ ctx, next, getRawInput }) => {
  const rawInput = await getRawInput();
  const input = rawInput as { facilityId?: string };
  if (!input?.facilityId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'facilityId required' });
  }

  const orgIds = await resolveOrgIds(ctx.session);

  // Find the facility in ANY of the user's organizations
  const facility = await ctx.prisma.metrcFacility.findFirst({
    where: {
      id: input.facilityId,
      organizationId: { in: orgIds },
    },
  });

  if (!facility) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Facility not found or access denied' });
  }

  // FOR-1172: Check facility-level access grants from JWT
  const facilityAccess: Record<string, string> = ctx.session.user?.facilityAccess ?? {};
  const facilityRole = resolveFacilityRole(facilityAccess, input.facilityId);

  return next({
    ctx: {
      ...ctx,
      facility,
      organizationId: facility.organizationId,
      facilityRole,
    },
  });
});

// Facility write procedure — requires OPERATOR or ADMIN role.
// FOR-1172 Phase 2 (FOR-1488 + FOR-1491): facility-scoped mutations across all
// affected routers now enforce role at the procedure level. Picking guide:
//   - facilityProcedure        — reads only (VIEWER-safe).
//   - facilityWriteProcedure   — OPERATOR-minimum writes (most mutations).
//   - facilityAdminProcedure   — ADMIN-only (ACL grants, credential mgmt).
// Do NOT regress by using facilityProcedure for new facility-scoped mutations.
export const facilityWriteProcedure = facilityProcedure.use(({ ctx, next }) => {
  if (!requireFacilityRole(ctx.facilityRole, 'OPERATOR')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This action requires Operator or Admin facility access',
    });
  }

  // Block writes when the facility's Metrc key is detected as read-only
  const facility = ctx.facility as { metrcEnvironment: string; metrcKeyAccess?: string | null; sandboxMetrcKeyAccess?: string | null };
  const keyAccess = facility.metrcEnvironment === 'sandbox'
    ? facility.sandboxMetrcKeyAccess
    : facility.metrcKeyAccess;
  if (keyAccess === 'readonly') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This facility has a read-only Metrc API key. Write operations are not available.',
    });
  }

  return next({ ctx });
});

// Facility admin procedure — requires ADMIN role.
// Use for facility-level access-control mutations (granting/revoking FacilityAccess,
// rotating encrypted credentials, deleting facility) where an OPERATOR-level user
// should not be able to change who can access the facility.
export const facilityAdminProcedure = facilityProcedure.use(({ ctx, next }) => {
  if (!requireFacilityRole(ctx.facilityRole, 'ADMIN')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This action requires Admin facility access',
    });
  }
  return next({ ctx });
});

// Multi-facility procedure — validates user has access to ALL requested facilities
export const multiFacilityProcedure = platformProcedure.use(async ({ ctx, next, getRawInput }) => {
  const rawInput = await getRawInput();
  const input = rawInput as { facilityIds?: string[] };
  if (!input?.facilityIds || input.facilityIds.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'facilityIds required (at least 1)' });
  }

  // Deduplicate facility IDs
  const facilityIds = Array.from(new Set(input.facilityIds));
  if (facilityIds.length > 20) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Maximum 20 facilities per request' });
  }

  const orgIds = await resolveOrgIds(ctx.session);

  const facilities = await ctx.prisma.metrcFacility.findMany({
    where: {
      id: { in: facilityIds },
      organizationId: { in: orgIds },
    },
  });

  // Ensure ALL requested facilities were found (user has access to all)
  const foundIds = new Set(facilities.map(f => f.id));
  const missing = facilityIds.filter(id => !foundIds.has(id));
  if (missing.length > 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Access denied or not found for facilities: ${missing.join(', ')}`,
    });
  }

  // FOR-1172: Check facility-level access for all requested facilities
  const facilityAccess: Record<string, string> = ctx.session.user?.facilityAccess ?? {};
  const hasAnyGrants = Object.keys(facilityAccess).length > 0;
  if (hasAnyGrants) {
    const denied = facilityIds.filter(id => !facilityAccess[id]);
    if (denied.length > 0) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Access denied for one or more requested facilities',
      });
    }
  }

  return next({
    ctx: {
      ...ctx,
      facilities,
    },
  });
});
