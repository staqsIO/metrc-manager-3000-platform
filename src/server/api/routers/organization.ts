import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure, platformProcedure } from '@/lib/trpc';
import { dashboardPrisma } from '@/lib/prisma';

export const organizationRouter = createTRPCRouter({
  /**
   * List all organizations the current user belongs to, for the OrgSwitcher.
   */
  list: platformProcedure.query(async ({ ctx }) => {
    const memberships = await dashboardPrisma.membership.findMany({
      where: { userId: ctx.session.user.id },
      select: {
        organizationId: true,
        organization: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return memberships.map((m: any) => ({
      id: m.organization.id,
      name: m.organization.name,
      logoUrl: m.organization.logoUrl as string | null,
      isActive: m.organizationId === ctx.activeOrgId,
    }));
  }),

  /**
   * Validate that the user is a member of the target org.
   * The client sets the cookie and calls router.refresh().
   */
  setActive: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await dashboardPrisma.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: ctx.session.user.id,
          },
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this organization',
        });
      }

      return { success: true };
    }),
});
