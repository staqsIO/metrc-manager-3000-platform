import { createTRPCRouter, protectedProcedure } from '@/lib/trpc';
import { dashboardPrisma } from '@/lib/prisma';
import { TRPCError } from '@trpc/server';

export const adminRouter = createTRPCRouter({
  // System health overview for platform admins
  getSystemHealth: protectedProcedure
    .query(async ({ ctx }) => {
      // Require platform admin
      if (!ctx.session.user.isPlatformAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform admin access required' });
      }

      const [
        totalUsers,
        totalOrgs,
        totalFacilities,
        activeFacilities,
        mockFacilities,
        totalAlerts,
        openAlerts,
        totalSyncLogs,
        failedSyncs,
      ] = await Promise.all([
        dashboardPrisma.user.count(),
        dashboardPrisma.organization.count(),
        ctx.prisma.metrcFacility.count(),
        ctx.prisma.metrcFacility.count({ where: { isActive: true } }),
        ctx.prisma.metrcFacility.count({ where: { metrcEnvironment: 'mock' } }),
        ctx.prisma.complianceAlert.count(),
        ctx.prisma.complianceAlert.count({ where: { status: 'OPEN' } }),
        ctx.prisma.metrcSyncLog.count(),
        ctx.prisma.metrcSyncLog.count({ where: { status: 'FAILED' } }),
      ]);

      return {
        users: totalUsers,
        organizations: totalOrgs,
        facilities: {
          total: totalFacilities,
          active: activeFacilities,
          mock: mockFacilities,
          real: activeFacilities - mockFacilities,
        },
        alerts: {
          total: totalAlerts,
          open: openAlerts,
        },
        syncs: {
          total: totalSyncLogs,
          failed: failedSyncs,
        },
      };
    }),

  // List all facilities across all orgs (admin view)
  listAllFacilities: protectedProcedure
    .query(async ({ ctx }) => {
      if (!ctx.session.user.isPlatformAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform admin access required' });
      }

      return ctx.prisma.metrcFacility.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    }),
});
