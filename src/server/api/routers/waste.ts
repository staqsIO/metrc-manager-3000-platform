import { z } from 'zod';
import { createTRPCRouter, facilityProcedure } from '@/lib/trpc';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import type { MetrcFacility } from '@prisma/client';
import {
  aggregateWasteSources,
  computeWasteAnalysis,
  computeWasteTrends,
} from '@/services/engines/waste-analysis-engine';
import { getActiveHarvestsFromDb, getInactiveHarvestsFromDb } from '@/services/metrc/snapshot-utils';

export const wasteRouter = createTRPCRouter({
  /**
   * Full waste analysis with KPIs, source breakdown, trends, and comparison.
   */
  getAnalysis: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      days: z.number().min(7).max(3650).optional().default(3650),
      granularity: z.enum(['day', 'week', 'month']).optional().default('week'),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Use DB snapshots for harvest waste (avoids N+1 live API calls that timeout).
      // Each harvest with TotalWasteWeight > 0 becomes a single waste source entry.
      const [activeHarvests, inactiveHarvests, plantBatchWaste] = await Promise.all([
        getActiveHarvestsFromDb(ctx.prisma, input.facilityId),
        getInactiveHarvestsFromDb(ctx.prisma, input.facilityId),
        client.getPlantBatchWaste(facility.licenseNumber).catch(() => []),
      ]);
      const allHarvests = [...activeHarvests, ...inactiveHarvests];
      const totalPackagedWeight = allHarvests.reduce((sum, h) => sum + h.TotalPackagedWeight, 0);

      // Build synthetic harvest waste records from snapshot aggregate fields
      const harvestWaste = allHarvests
        .filter(h => h.TotalWasteWeight > 0)
        .map(h => ({
          Id: h.Id,
          HarvestId: h.Id,
          WasteWeight: h.TotalWasteWeight,
          UnitOfWeightName: h.UnitOfWeightName || 'Grams',
          ActualDate: h.HarvestStartDate || h.FinishedDate || new Date().toISOString().split('T')[0]!,
          WasteTypeName: 'Harvest Waste',
        }));
      const harvestNames = new Map(allHarvests.map(h => [h.Id, h.Name]));

      const sources = aggregateWasteSources({
        harvestWaste,
        harvestNames,
        plantBatchWaste,
      });

      console.log(`[WASTE-DEBUG] facility=${facility.name} allHarvests=${allHarvests.length} withWaste=${harvestWaste.length} plantBatch=${plantBatchWaste.length} sources=${sources.length} days=${input.days}`);
      if (sources.length > 0) {
        console.log(`[WASTE-DEBUG] sample source: date=${sources[0]!.date} type=${sources[0]!.type} weight=${sources[0]!.weight}`);
      }

      const result = computeWasteAnalysis(sources, totalPackagedWeight, input.days, input.granularity);
      console.log(`[WASTE-DEBUG] bySource counts: ${result.bySource.map(s => `${s.type}=${s.count}`).join(', ')}`);
      return result;
    }),

  /**
   * Waste trends over time.
   */
  getTrends: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      days: z.number().min(7).max(3650).optional().default(3650),
      granularity: z.enum(['day', 'week', 'month']).optional().default('week'),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      const [activeHarvests, inactiveHarvests, plantBatchWaste] = await Promise.all([
        getActiveHarvestsFromDb(ctx.prisma, input.facilityId),
        getInactiveHarvestsFromDb(ctx.prisma, input.facilityId),
        client.getPlantBatchWaste(facility.licenseNumber).catch(() => []),
      ]);
      const allHarvests = [...activeHarvests, ...inactiveHarvests];

      const harvestWaste = allHarvests
        .filter(h => h.TotalWasteWeight > 0)
        .map(h => ({
          Id: h.Id,
          HarvestId: h.Id,
          WasteWeight: h.TotalWasteWeight,
          UnitOfWeightName: h.UnitOfWeightName || 'Grams',
          ActualDate: h.HarvestStartDate || h.FinishedDate || new Date().toISOString().split('T')[0]!,
          WasteTypeName: 'Harvest Waste',
        }));
      const harvestNames = new Map(allHarvests.map(h => [h.Id, h.Name]));

      const sources = aggregateWasteSources({
        harvestWaste,
        harvestNames,
        plantBatchWaste,
      });

      return computeWasteTrends(sources, input.granularity, input.days);
    }),

  /**
   * Lightweight KPI summary for dashboard cards.
   */
  getSummary: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      // DB-only — no live Metrc API calls. Uses snapshotted harvest data.
      const [activeHarvests, inactiveHarvests] = await Promise.all([
        getActiveHarvestsFromDb(ctx.prisma, input.facilityId),
        getInactiveHarvestsFromDb(ctx.prisma, input.facilityId),
      ]);
      const allHarvests = [...activeHarvests, ...inactiveHarvests];

      const totalHarvestWaste = allHarvests.reduce((sum, h) => sum + h.TotalWasteWeight, 0);
      const totalPackagedWeight = allHarvests.reduce((sum, h) => sum + h.TotalPackagedWeight, 0);
      const totalWeight = Math.round(totalHarvestWaste * 100) / 100;
      const throughput = totalPackagedWeight + totalWeight;

      return {
        totalWasteWeight: totalWeight,
        harvestWaste: Math.round(totalHarvestWaste * 100) / 100,
        plantBatchWaste: 0,
        wasteRate: throughput > 0 ? Math.round((totalWeight / throughput) * 10000) / 100 : 0,
        eventCount: allHarvests.filter(h => h.TotalWasteWeight > 0).length,
      };
    }),
});
