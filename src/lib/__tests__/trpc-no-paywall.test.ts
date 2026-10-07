import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/prisma', () => ({
  prisma: { metrcFacility: { findFirst: vi.fn(async () => ({ id: 'fac-1', organizationId: 'org-1' })) } },
  dashboardPrisma: { membership: { findMany: vi.fn(async () => [{ organizationId: 'org-1' }]) } },
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/auth-helpers', () => ({ getUserOrgIds: vi.fn(async () => ['org-1']) }));

import { createTRPCRouter, createCallerFactory, facilityProcedure } from '@/lib/trpc';
import { prisma } from '@/lib/prisma';

const router = createTRPCRouter({
  ping: facilityProcedure.input(z.object({ facilityId: z.string() })).query(({ ctx }) => ctx.facility.id),
});

describe('facility procedures without billing', () => {
  it('allows a member with no subscription plan', async () => {
    const caller = createCallerFactory(router)({
      prisma,
      session: { user: { id: 'u1', email: 'a@example.com', facilityAccess: {} } },
      activeOrgId: null,
    } as never);
    await expect(caller.ping({ facilityId: 'fac-1' })).resolves.toBe('fac-1');
  });
});
