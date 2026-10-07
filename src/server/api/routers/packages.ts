import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import type { MetrcFacility, Prisma } from '@prisma/client';
import { getMetrcClient, getMetrcClientForWrite } from '@/services/metrc/metrc-factory';
import { getActivePackagesFromDb, getActiveHarvestsFromDb, getInactiveHarvestsFromDb, getIncomingTransfersFromDb, getOutgoingTransfersFromDb, getActiveLocationsFromDb } from '@/services/metrc/snapshot-utils';
import { getCachedAdjustReasons } from '@/services/metrc/adjust-reasons-cache';
import { getDutchieClient } from '@/services/dutchie/dutchie-factory';
import { executeMutationWithVerification } from '@/services/metrc/mutation-executor';
import { checkPackageLocationChange } from '@/services/metrc/verification-checks';
import {
  detectFragmentation,
  generateConsolidationRecommendations,
  findSampleOutCandidates,
  analyzeBiomassUtilization,
  detectShortCounts,
} from '@/services/engines/package-intelligence';
import { buildProvenanceIndex, getProvenance, getProvenanceStats, type ProvenanceTree } from '@/services/engines/provenance-engine';
import { correlateTransfers } from '@/services/engines/transfer-correlation';
import {
  buildSalesIndex,
  computeSalesAnalytics,
  type SalesMatch,
  type SalesAnalytics,
} from '@/services/engines/sales-reconciliation';

// ---------------------------------------------------------------------------
// Shared sales-fetching helper
// ---------------------------------------------------------------------------

interface SalesResult {
  sales: SalesMatch[]
  descendantSales: Record<string, SalesMatch[]>
  salesAnalytics: SalesAnalytics | null
  salesError: string | null
}

async function fetchSalesForTree(
  facility: MetrcFacility,
  packageLabel: string,
  tree: ProvenanceTree,
  fromDateUTC?: string,
): Promise<SalesResult> {
  try {
    const dutchie = getDutchieClient(facility);
    const salesIdx = await buildSalesIndex(dutchie, fromDateUTC ? { fromDateUTC } : undefined);

    const sales = salesIdx.get(packageLabel) ?? [];
    const descendantSales: Record<string, SalesMatch[]> = {};
    for (const node of tree.downstream) {
      const nodeSales = salesIdx.get(node.label);
      if (nodeSales && nodeSales.length > 0) {
        descendantSales[node.label] = nodeSales;
      }
    }
    const salesAnalytics = computeSalesAnalytics(salesIdx, tree);
    return { sales, descendantSales, salesAnalytics, salesError: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[sales-reconciliation] Failed to fetch sales:', msg);
    return { sales: [], descendantSales: {}, salesAnalytics: null, salesError: msg };
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const packagesRouter = createTRPCRouter({
  fragmentation: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      const groups = detectFragmentation(packages);

      return {
        groups,
        totalFragmentedPackages: groups.reduce((sum, g) => sum + g.packageCount, 0),
        totalGroups: groups.length,
      };
    }),

  consolidationRecs: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      const recommendations = generateConsolidationRecommendations(packages);

      return {
        recommendations,
        totalRecommendations: recommendations.length,
        estimatedPackagesReduced: recommendations.reduce((sum, r) => sum + r.estimatedPackagesReduced, 0),
      };
    }),

  sampleOutCandidates: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      maxQuantityGrams: z.number().optional(),
      maxQuantityEach: z.number().optional(),
      minAgeDays: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      const candidates = findSampleOutCandidates(packages, {
        maxQuantityGrams: input.maxQuantityGrams ?? 7,
        maxQuantityEach: input.maxQuantityEach ?? 3,
        minAgeDays: input.minAgeDays ?? 30,
      });

      return {
        candidates,
        totalCandidates: candidates.length,
      };
    }),

  biomassUtilization: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      // Load operator-configured biomass exclusion patterns (e.g., "mids", "pre-ground")
      const exclusionBenchmark = await ctx.prisma.operatorBenchmark.findUnique({
        where: { facilityId_category_key: { facilityId: input.facilityId, category: 'biomass', key: 'excluded_item_patterns' } },
      });
      const excludedPatterns = exclusionBenchmark?.notes?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
      return analyzeBiomassUtilization(packages, excludedPatterns);
    }),

  shortCounts: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      modeThreshold: z.number().int().min(2).max(20).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      const findings = detectShortCounts(packages, input.modeThreshold ?? 3);

      return {
        findings,
        totalFindings: findings.length,
        totalShortPackages: findings.reduce((sum, f) => sum + f.shortCountPackages.length, 0),
      };
    }),

  provenance: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      packageLabel: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const [packages, harvests] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, ctx.facility.id),
        getActiveHarvestsFromDb(ctx.prisma, ctx.facility.id),
      ]);
      const index = buildProvenanceIndex(packages, harvests);
      const tree = getProvenance(input.packageLabel, index);
      return tree;
    }),

  provenanceStats: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const [packages, harvests] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, ctx.facility.id),
        getActiveHarvestsFromDb(ctx.prisma, ctx.facility.id),
      ]);
      const index = buildProvenanceIndex(packages, harvests);
      const stats = getProvenanceStats(index);
      return stats;
    }),

  packageJourney: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      packageLabel: z.string().min(1),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      // Packages from DB; harvests + transfers still live (Phase 2/3)
      const [packages, activeHarvests, inactiveHarvests, inTransfers, outTransfers] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, ctx.facility.id),
        getActiveHarvestsFromDb(ctx.prisma, ctx.facility.id).catch(() => []),
        getInactiveHarvestsFromDb(ctx.prisma, ctx.facility.id).catch(() => []),
        getIncomingTransfersFromDb(ctx.prisma, ctx.facility.id).catch(() => []),
        getOutgoingTransfersFromDb(ctx.prisma, ctx.facility.id).catch(() => []),
      ]);
      const harvests = [...activeHarvests, ...inactiveHarvests];

      const provenanceIndex = buildProvenanceIndex(packages, harvests);
      const tree = getProvenance(input.packageLabel, provenanceIndex);
      const pkg = provenanceIndex.packageMap.get(input.packageLabel);

      const transfers = pkg ? correlateTransfers(pkg, inTransfers, outTransfers) : [];

      // Use PackagedDate as fromDateUTC to avoid fetching sales from before the package existed
      const fromDateUTC = pkg?.PackagedDate ?? undefined;
      const salesResult = await fetchSalesForTree(facility, input.packageLabel, tree, fromDateUTC);

      return { tree, transfers, ...salesResult };
    }),

  /**
   * Change package locations (preview -> confirm -> execute)
   */
  changeLocations: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      moves: z.array(z.object({
        label: z.string().min(1).max(100),
        locationId: z.number().int().positive(),
      })).min(1).max(100),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Validate no duplicate package labels
      const moveLabels = input.moves.map(m => m.label);
      const uniqueMoveLabels = new Set(moveLabels);
      if (uniqueMoveLabels.size !== moveLabels.length) {
        const dupes = moveLabels.filter((l, i) => moveLabels.indexOf(l) !== i);
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Duplicate package label(s): ${Array.from(new Set(dupes)).join(', ')}`,
        });
      }

      const [activePackages, locations] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, ctx.facility.id),
        getActiveLocationsFromDb(ctx.prisma, ctx.facility.id),
      ]);
      const packageMap = new Map(activePackages.map(p => [p.Label, p]));
      const locationMap = new Map(locations.map(l => [l.Id, l]));

      const missing = input.moves.filter(m => !packageMap.get(m.label));
      if (missing.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Package(s) not found: ${missing.map(m => m.label).join(', ')}`,
        });
      }

      const invalidLocations = input.moves.filter(m => !locationMap.get(m.locationId));
      if (invalidLocations.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Location ID(s) not found: ${invalidLocations.map(m => m.locationId).join(', ')}`,
        });
      }

      if (!input.confirmed) {
        const preview = {
          moveCount: input.moves.length,
          moves: input.moves.map(m => ({
            label: m.label,
            itemName: packageMap.get(m.label)?.ItemName ?? 'Unknown',
            currentLocation: packageMap.get(m.label)?.LocationName ?? 'Unknown',
            newLocation: locationMap.get(m.locationId)?.Name ?? `Location-${m.locationId}`,
          })),
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'PACKAGE_CHANGE_LOCATION',
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: input.moves.map(m => m.label),
            targetCount: input.moves.length,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      const beforeState = input.moves.map(m => ({
        label: m.label,
        currentLocation: packageMap.get(m.label)?.LocationName ?? 'Unknown',
      }));

      const payload = input.moves.map(m => ({
        Label: m.label,
        LocationId: m.locationId,
      }));

      const expectedMoves = input.moves.map(m => ({
        label: m.label,
        expectedLocation: locationMap.get(m.locationId)?.Name ?? `Location-${m.locationId}`,
      }));

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'PACKAGE_CHANGE_LOCATION',
        targetType: 'PACKAGE',
        targetIds: input.moves.map(m => m.label),
        targetCount: input.moves.length,
        executeFn: () => writeClient.changePackageLocations(payload as unknown as Record<string, unknown>[]),
        beforeState,
        verifyFn: async () => {
          const activeAfter = await client.getActivePackages();
          return checkPackageLocationChange(expectedMoves, activeAfter);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, moveCount: input.moves.length, verified: result.verified };
    }),

  /**
   * Get valid adjustment reasons for packages.
   *
   * Reasons change on a months-to-years cadence, so the result is cached per
   * facility for 24h via `getCachedAdjustReasons`. Cache reset only on process
   * restart — TTL alone is sufficient invalidation.
   */
  getAdjustReasons: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      return getCachedAdjustReasons(facility.id, () =>
        client.getPackageAdjustReasons(facility.licenseNumber),
      );
    }),
});
