import { z } from 'zod';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { getActivePackagesFromDb, getActiveLocationsFromDb } from '@/services/metrc/snapshot-utils';
import { buildProvenanceIndex } from '@/services/engines/provenance-engine';
import {
  computeFullPipeline,
  traceHarvestToCash,
  buildSoldLabelsFromReceipts,
  buildTransitLabels,
  buildSalesRevenueMap,
  buildHarvestToFirstGenIndex,
  buildLocationOverrides,
  PIPELINE_STAGE_ORDER,
  type PipelineData,
  type PipelineLocationOverrides,
  type PipelineStatusConfig,
  type PipelineStage,
} from '@/services/engines/pipeline-stage-engine';
import type { MetrcFacility, PipelineStatus } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

type ReceiptTransaction = { PackageLabel?: string; TotalPrice?: number };
type ReceiptLike = { Transactions?: ReceiptTransaction[] };
type TransferLike = { DeliveryPackages?: Array<{ PackageLabel?: string }>; PackageCount?: number };

const VALID_PHASES = new Set<string>(PIPELINE_STAGE_ORDER);

/**
 * Shared helper: fetches all data needed for pipeline analysis from Metrc API.
 * Single fetch, single provenance index build, single harvest-to-firstgen index.
 * Filters inactive harvests to last 90 days.
 */
async function fetchPipelineData(facility: MetrcFacility, prisma: PrismaClient): Promise<PipelineData> {
  const client = getMetrcClient(facility);

  // All calls use .catch() so a read-only API key that lacks permissions for
  // certain endpoint categories degrades gracefully instead of failing entirely.
  const logErr = (endpoint: string) => (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[pipeline] ${facility.name} ${endpoint} failed: ${msg}`);
    return [] as never[];
  };

  // Facility-type-aware endpoint calls: skip endpoints the facility type doesn't
  // support to avoid noisy 401/405 errors in logs.
  const emptyArray = Promise.resolve([] as never[]);
  const ft = facility.facilityType;
  const canHarvest = !ft || ft === 'Cultivator' || ft === 'Microbusiness';
  const canSell = !ft || ft === 'Dispensary' || ft === 'Microbusiness';

  // Phase 1: packages from DB, harvests/sales/transfers still live (Phase 2/3)
  const [activePackages, activeHarvests, inactiveHarvests, receipts, outgoing] =
    await Promise.all([
      getActivePackagesFromDb(prisma, facility.id),
      canHarvest ? client.getActiveHarvests().catch(logErr('getActiveHarvests')) : emptyArray,
      canHarvest ? client.getInactiveHarvests().catch(logErr('getInactiveHarvests')) : emptyArray,
      canSell ? client.getSalesReceipts().catch(logErr('getSalesReceipts')) : emptyArray,
      client.getOutgoingTransfers().catch(logErr('getOutgoingTransfers')),
    ]);

  console.log(`[pipeline] ${facility.name}: ${activePackages.length} pkgs, ${activeHarvests.length} active harvests, ${inactiveHarvests.length} inactive harvests, ${receipts.length} receipts, ${outgoing.length} transfers`);

  // Include harvests from the last 90 days
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const recentInactive = inactiveHarvests.filter((h) => {
    const d = new Date(h.FinishedDate || h.HarvestStartDate);
    return d >= ninetyDaysAgo;
  });
  const allHarvests = [...activeHarvests, ...recentInactive];

  const provenanceIndex = buildProvenanceIndex(activePackages, allHarvests);
  const soldLabels = buildSoldLabelsFromReceipts(receipts as ReceiptLike[]);
  const transitLabels = buildTransitLabels(outgoing as TransferLike[]);
  const salesRevenue = buildSalesRevenueMap(receipts as ReceiptLike[]);
  const harvestToFirstGen = buildHarvestToFirstGenIndex(activePackages);

  return {
    packages: activePackages,
    harvests: allHarvests,
    provenanceIndex,
    soldLabels,
    transitLabels,
    salesRevenue,
    harvestToFirstGen,
  };
}

function parseLocationNames(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string');
  return [];
}

/**
 * Load PipelineConfig + statuses for a facility and build location overrides.
 * Returns undefined if config doesn't exist or is disabled.
 */
async function loadPipelineOverrides(
  db: PrismaClient,
  facilityId: string,
): Promise<PipelineLocationOverrides | undefined> {
  const config = await db.pipelineConfig.findUnique({
    where: { facilityId },
    include: { statuses: true },
  });
  if (!config || !config.isEnabled || !config.statuses?.length) return undefined;

  const statusConfigs: PipelineStatusConfig[] = config.statuses.map((s: PipelineStatus) => ({
    phase: s.phase as PipelineStage,
    name: s.name,
    color: s.color ?? undefined,
    locationNames: parseLocationNames(s.locationNames),
  }));
  return buildLocationOverrides(statusConfigs);
}

export const pipelineRouter = createTRPCRouter({
  /**
   * Full pipeline: overview + all harvest trackers in a single fetch.
   * Returns both PipelineOverview and HarvestCashTracker[] from one set of API calls.
   * When PipelineConfig is enabled, location overrides are applied.
   */
  getFullPipeline: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      const [data, overrides] = await Promise.all([
        fetchPipelineData(facility, ctx.prisma),
        loadPipelineOverrides(ctx.prisma, facility.id),
      ]);
      return computeFullPipeline(data, overrides);
    }),

  /**
   * Trace a single harvest through the pipeline to cash.
   * Uses the same 90-day window as the full pipeline for inactive harvests.
   */
  getHarvestCashFlow: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      harvestName: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const [data, overrides] = await Promise.all([
        fetchPipelineData(facility, ctx.prisma),
        loadPipelineOverrides(ctx.prisma, facility.id),
      ]);
      const harvest = data.harvests.find((h) => h.Name === input.harvestName);
      return traceHarvestToCash(input.harvestName, harvest, data, overrides);
    }),

  // ---------------------------------------------------------------------------
  // Pipeline Configuration CRUD (P1-6)
  // ---------------------------------------------------------------------------

  /** Read config + statuses. Auto-creates empty config if missing. */
  getPipelineConfig: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      let config = await ctx.prisma.pipelineConfig.findUnique({
        where: { facilityId: facility.id },
        include: { statuses: { orderBy: [{ phase: 'asc' }, { sortOrder: 'asc' }] } },
      });
      if (!config) {
        config = await ctx.prisma.pipelineConfig.create({
          data: { facilityId: facility.id, isEnabled: false },
          include: { statuses: { orderBy: [{ phase: 'asc' }, { sortOrder: 'asc' }] } },
        });
      }
      return config;
    }),

  /** Toggle isEnabled, reorder statuses. */
  updatePipelineConfig: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      isEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      // Ensure config exists
      const existing = await ctx.prisma.pipelineConfig.findUnique({
        where: { facilityId: facility.id },
      });
      if (!existing) {
        return ctx.prisma.pipelineConfig.create({
          data: {
            facilityId: facility.id,
            isEnabled: input.isEnabled ?? false,
          },
          include: { statuses: { orderBy: [{ phase: 'asc' }, { sortOrder: 'asc' }] } },
        });
      }
      return ctx.prisma.pipelineConfig.update({
        where: { facilityId: facility.id },
        data: { isEnabled: input.isEnabled ?? existing.isEnabled },
        include: { statuses: { orderBy: [{ phase: 'asc' }, { sortOrder: 'asc' }] } },
      });
    }),

  /** Create or update a pipeline status. */
  upsertPipelineStatus: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      id: z.string().optional(),
      phase: z.string().refine((v) => VALID_PHASES.has(v), { message: 'Invalid pipeline phase' }),
      name: z.string().min(1).max(100),
      color: z.string().nullable().optional(),
      sortOrder: z.number().int().optional(),
      locationNames: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      // Ensure config exists
      let config = await ctx.prisma.pipelineConfig.findUnique({
        where: { facilityId: facility.id },
      });
      if (!config) {
        config = await ctx.prisma.pipelineConfig.create({
          data: { facilityId: facility.id, isEnabled: false },
        });
      }

      if (input.id) {
        // Update existing
        return ctx.prisma.pipelineStatus.update({
          where: { id: input.id },
          data: {
            phase: input.phase,
            name: input.name,
            color: input.color ?? null,
            sortOrder: input.sortOrder ?? 0,
            locationNames: input.locationNames ?? [],
          },
        });
      }

      // Create new
      return ctx.prisma.pipelineStatus.create({
        data: {
          configId: config.id,
          phase: input.phase,
          name: input.name,
          color: input.color ?? null,
          sortOrder: input.sortOrder ?? 0,
          locationNames: input.locationNames ?? [],
        },
      });
    }),

  /** Delete a pipeline status by ID. */
  deletePipelineStatus: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      statusId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.pipelineStatus.delete({
        where: { id: input.statusId },
      });
      return { success: true };
    }),

  /** Fetch Metrc locations with package counts + which pipeline status each is assigned to. */
  getAvailableLocations: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const [metrcLocations, packages, config] = await Promise.all([
        getActiveLocationsFromDb(ctx.prisma, ctx.facility.id),
        getActivePackagesFromDb(ctx.prisma, ctx.facility.id),
        ctx.prisma.pipelineConfig.findUnique({
          where: { facilityId: ctx.facility.id },
          include: { statuses: true },
        }),
      ]);

      // Build location → package count
      const pkgByLocation = new Map<string, number>();
      for (const pkg of packages) {
        const loc = pkg.LocationName || '';
        if (loc) pkgByLocation.set(loc, (pkgByLocation.get(loc) ?? 0) + 1);
      }

      // Build location → assigned status name
      const locationToStatus = new Map<string, { statusId: string; statusName: string; phase: string }>();
      if (config?.statuses) {
        for (const status of config.statuses) {
          const locs = parseLocationNames(status.locationNames);
          for (const loc of locs) {
            locationToStatus.set(loc, {
              statusId: status.id,
              statusName: status.name,
              phase: status.phase,
            });
          }
        }
      }

      return metrcLocations.map((loc) => ({
        id: loc.Id,
        name: loc.Name,
        locationTypeName: loc.LocationTypeName,
        packageCount: pkgByLocation.get(loc.Name) ?? 0,
        assignedStatus: locationToStatus.get(loc.Name) ?? null,
      }));
    }),
});
