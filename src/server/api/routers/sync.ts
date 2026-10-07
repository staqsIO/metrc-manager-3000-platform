import { z } from 'zod';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import type { MetrcFacility } from '@prisma/client';
import { runFullSync, getSyncStatus } from '@/services/sync/sync-orchestrator';

export const syncRouter = createTRPCRouter({
  // Get current sync status for a facility
  getStatus: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      return getSyncStatus(facility);
    }),

  // Get sync history (recent sync logs)
  getHistory: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      limit: z.number().min(1).max(50).optional().default(10),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.metrcSyncLog.findMany({
        where: { facilityId: input.facilityId },
        orderBy: { startedAt: 'desc' },
        take: input.limit,
      });
    }),

  // Trigger a manual full sync
  triggerSync: facilityWriteProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      return runFullSync(ctx.prisma, facility);
    }),

  // Get inventory snapshots for a facility
  getSnapshots: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      limit: z.number().min(1).max(30).optional().default(7),
    }))
    .query(async ({ ctx, input }) => {
      const snapshots = await ctx.prisma.inventorySnapshot.findMany({
        where: { facilityId: input.facilityId },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          snapshotType: true,
          totalPackages: true,
          totalQuantity: true,
          totalCategories: true,
          agingDistribution: true,
          createdAt: true,
        },
      });
      return snapshots;
    }),
});
