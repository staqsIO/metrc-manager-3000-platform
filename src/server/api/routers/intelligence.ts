import { z } from 'zod';
import { createTRPCRouter, facilityProcedure } from '@/lib/trpc';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { getCanixClient } from '@/services/canix/canix-factory';
import type { MetrcFacility } from '@prisma/client';
import { getActivePackagesFromDb } from '@/services/metrc/snapshot-utils';
import { computeDataFidelity } from '@/services/engines/data-fidelity';
import { computeLossAnalysis } from '@/services/engines/financial-overlay-engine';
import {
  computeThroughputAnalysis,
  computeHarvestForecast,
  computeCycleTime,
} from '@/services/engines/operational-intelligence-engine';

/** Swallow Metrc 401/403 errors — not all facility types have access to all endpoints. */
const emptyOnAuthError = <T>(promise: Promise<T[]>): Promise<T[]> =>
  promise.catch(() => [] as T[]);

export const intelligenceRouter = createTRPCRouter({
  getLossAnalysis: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      const fidelity = computeDataFidelity(facility);

      const [packages, harvests] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        emptyOnAuthError(client.getInactiveHarvests()), // Harvests not in DB yet (Phase 2)
      ]);

      // Progressive COGS loading
      let cogsResults = null;
      if (fidelity.hasFinancialData) {
        try {
          const { resolvePackageCOGS } = await import('@/services/engines/cogs-engine');
          const canixClient = getCanixClient(facility);
          const [standardCosts, boms] = await Promise.all([
            canixClient.getStandardCosts(),
            canixClient.getBillsOfMaterials(),
          ]);
          const pkgsForCOGS = packages.map(p => ({
            label: p.Label,
            itemName: p.ItemName,
            quantity: p.Quantity,
            unitOfMeasure: p.UnitOfMeasureName,
            category: p.ItemCategory || 'Unknown',
          }));
          cogsResults = resolvePackageCOGS(pkgsForCOGS, {
            standardCosts,
            boms,
            dutchieCosts: [],
            manualCosts: [],
          });
        } catch {
          cogsResults = null;
        }
      }

      return {
        ...computeLossAnalysis(packages, harvests, cogsResults),
        fidelity,
      };
    }),

  getThroughputAnalysis: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      const [harvests, packages] = await Promise.all([
        emptyOnAuthError(client.getInactiveHarvests()), // Harvests not in DB yet (Phase 2)
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
      ]);

      return computeThroughputAnalysis(harvests, packages);
    }),

  getHarvestForecast: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      windowDays: z.number().min(1).max(90).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      const [activeBatches, harvests] = await Promise.all([
        emptyOnAuthError(client.getActivePlantBatches()),
        emptyOnAuthError(client.getInactiveHarvests()),
      ]);

      return computeHarvestForecast(activeBatches, harvests, activeBatches, {
        windowDays: input.windowDays ?? 14,
      });
    }),

  getCycleTime: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      const [harvests, batches] = await Promise.all([
        emptyOnAuthError(client.getInactiveHarvests()),
        emptyOnAuthError(client.getActivePlantBatches()),
      ]);

      return computeCycleTime(harvests, batches);
    }),
});
