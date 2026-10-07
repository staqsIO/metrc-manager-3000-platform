import { z } from 'zod';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import {
  analyzeEmployeePatterns,
  identifyTrainingNeeds,
  reconcileInventory,
  type ExternalRecord,
} from '@/services/engines/operations-analysis';
import {
  getActivePackagesFromDb,
  getIncomingTransfersFromDb,
  getOutgoingTransfersFromDb,
} from '@/services/metrc/snapshot-utils';

export const operationsRouter = createTRPCRouter({
  employeePatterns: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      daysLookback: z.number().min(7).max(3650).default(90),
    }))
    .query(async ({ ctx, input }) => {
      const fromISO = new Date(Date.now() - input.daysLookback * 86400000).toISOString();
      const [outgoing, incoming] = await Promise.all([
        getOutgoingTransfersFromDb(ctx.prisma, input.facilityId),
        getIncomingTransfersFromDb(ctx.prisma, input.facilityId),
      ]);
      const byLookback = (t: { LastModified: string }) => !t.LastModified || t.LastModified >= fromISO;
      return analyzeEmployeePatterns([...outgoing.filter(byLookback), ...incoming.filter(byLookback)]);
    }),

  trainingNeeds: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      daysLookback: z.number().min(7).max(3650).default(90),
    }))
    .query(async ({ ctx, input }) => {
      const fromISO = new Date(Date.now() - input.daysLookback * 86400000).toISOString();
      const [packages, outgoing, incoming] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        getOutgoingTransfersFromDb(ctx.prisma, input.facilityId),
        getIncomingTransfersFromDb(ctx.prisma, input.facilityId),
      ]);
      const byLookback = (t: { LastModified: string }) => !t.LastModified || t.LastModified >= fromISO;
      return identifyTrainingNeeds(packages, [...outgoing.filter(byLookback), ...incoming.filter(byLookback)]);
    }),

  reconcile: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      externalRecords: z.array(z.object({
        label: z.string(),
        quantity: z.number().optional(),
        category: z.string().optional(),
        location: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      return reconcileInventory(packages, input.externalRecords as ExternalRecord[]);
    }),

  reconcilePreview: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      return {
        totalMetrcPackages: packages.length,
        sampleLabels: packages.slice(0, 5).map(p => p.Label),
      };
    }),
});
