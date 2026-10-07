import { z } from 'zod';
import { createTRPCRouter, facilityProcedure } from '@/lib/trpc';
import { analyzeInventoryTrends, detectAnomalies } from '@/services/analytics/trend-analysis';
import { analyzeYieldsByStrain, analyzeLossPoints } from '@/services/analytics/yield-analysis';
import { analyzeStrainPerformance } from '@/services/analytics/strain-analysis';
import { analyzeStrainIntelligence } from '@/services/analytics/strain-intelligence';
import { analyzePotencyTrends } from '@/services/engines/potency-trending-engine';
import {
  getActivePackagesFromDb,
  getActivePlantsFromDb,
  getActiveHarvestsFromDb,
  getLabTestResultsFromDb,
} from '@/services/metrc/snapshot-utils';

export const analyticsRouter = createTRPCRouter({
  trends: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      return analyzeInventoryTrends(packages);
    }),

  anomalies: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      const anomalies = detectAnomalies(packages);

      return {
        anomalies,
        totalAnomalies: anomalies.length,
        criticalCount: anomalies.filter(a => a.severity === 'critical').length,
        warningCount: anomalies.filter(a => a.severity === 'warning').length,
      };
    }),

  yieldMetrics: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [packages, plants] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        getActivePlantsFromDb(ctx.prisma, input.facilityId),
      ]);
      return analyzeYieldsByStrain(packages, plants);
    }),

  lossAnalysis: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      return analyzeLossPoints(packages);
    }),

  strainPerformance: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [packages, labTests] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        getLabTestResultsFromDb(ctx.prisma, input.facilityId),
      ]);
      return analyzeStrainPerformance(packages, labTests);
    }),

  strainIntelligence: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as import('@prisma/client').MetrcFacility;
      const { getMetrcClient } = await import('@/services/metrc/metrc-factory');
      const client = getMetrcClient(facility);

      // Strains are not yet in Phase 2 snapshot tables — keep live.
      // All other entities read from DB snapshots.
      const results = await Promise.allSettled([
        getActiveHarvestsFromDb(ctx.prisma, input.facilityId),
        client.getActiveStrains(),
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        getActivePlantsFromDb(ctx.prisma, input.facilityId),
        getLabTestResultsFromDb(ctx.prisma, input.facilityId),
      ]);

      const warnings: string[] = [];
      const getValue = <T>(result: PromiseSettledResult<T>, label: string, fallback: T): T => {
        if (result.status === 'fulfilled') return result.value;
        warnings.push(`Failed to fetch ${label}: ${result.reason}`);
        return fallback;
      };

      const harvests = getValue(results[0], 'harvests', []);
      const strains = getValue(results[1], 'strains', []);
      const packages = getValue(results[2], 'packages', []);
      const plants = getValue(results[3], 'plants', []);
      const labTests = getValue(results[4], 'lab tests', []);

      const intelligence = analyzeStrainIntelligence(harvests, strains, labTests, packages, plants);
      return {
        ...intelligence,
        warnings: [...warnings, ...intelligence.warnings],
      };
    }),

  potencyTrending: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      groupBy: z.enum(['strain', 'item']).optional(),
      testType: z.string().optional(),
      strain: z.string().optional(),
      minSamples: z.number().min(2).max(50).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const [packages, labTests] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        getLabTestResultsFromDb(ctx.prisma, input.facilityId),
      ]);
      return analyzePotencyTrends(labTests, packages, {
        groupBy: input.groupBy,
        testTypeFilter: input.testType,
        strainFilter: input.strain,
        minSamples: input.minSamples,
      });
    }),

  batchComparison: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      strain: z.string(),
      testType: z.string().optional().default('Potency'),
    }))
    .query(async ({ ctx, input }) => {
      const [packages, labTests] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        getLabTestResultsFromDb(ctx.prisma, input.facilityId),
      ]);
      const result = analyzePotencyTrends(labTests, packages, {
        strainFilter: input.strain,
        testTypeFilter: input.testType,
      });
      return {
        group: result.groups[0] ?? null,
        outliers: result.outliers,
        warnings: result.warnings,
      };
    }),
});
