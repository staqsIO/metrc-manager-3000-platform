import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getMetrcClient, getMetrcClientForWrite } from '@/services/metrc/metrc-factory';
import { formatHarvest } from '@/services/metrc/types';
import type { MetrcFacility, Prisma } from '@prisma/client';
import { executeMutationWithVerification } from '@/services/metrc/mutation-executor';
import { checkHarvestFinish, checkHarvestWaste, checkHarvestPackageCreate, checkHarvestWasteDelete } from '@/services/metrc/verification-checks';
import {
  getActiveHarvestsFromDb,
  getOnHoldHarvestsFromDb,
  getInactiveHarvestsFromDb,
  getAllHarvestsFromDb,
  harvestSnapshotToMetrc,
} from '@/services/metrc/snapshot-utils';

export const harvestsRouter = createTRPCRouter({
  /**
   * Get active harvests for a facility.
   */
  getActive: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      const allHarvests = await getActiveHarvestsFromDb(ctx.prisma, input.facilityId);

      let harvests = allHarvests.map(formatHarvest);

      if (input.search) {
        const s = input.search.toLowerCase();
        harvests = harvests.filter(h =>
          h.name.toLowerCase().includes(s) ||
          h.sourceStrainNames.toLowerCase().includes(s) ||
          h.dryingLocation.toLowerCase().includes(s)
        );
      }

      harvests.sort((a, b) => b.ageDays - a.ageDays);

      const total = harvests.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const items = harvests.slice(start, start + input.pageSize);

      return { items, total, page: input.page, pageSize: input.pageSize, totalPages };
    }),

  /**
   * Get on-hold harvests.
   */
  getOnHold: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const harvests = await getOnHoldHarvestsFromDb(ctx.prisma, input.facilityId);
      return harvests.map(formatHarvest);
    }),

  /**
   * Get inactive (finished/archived) harvests.
   */
  getInactive: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      const allHarvests = await getInactiveHarvestsFromDb(ctx.prisma, input.facilityId);
      const harvests = allHarvests.map(formatHarvest);

      const total = harvests.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const items = harvests.slice(start, start + input.pageSize);

      return { items, total, page: input.page, pageSize: input.pageSize, totalPages };
    }),

  /**
   * Get a single harvest by ID.
   */
  getById: facilityProcedure
    .input(z.object({ facilityId: z.string(), harvestId: z.number() }))
    .query(async ({ ctx, input }) => {
      const snapshot = await ctx.prisma.harvestSnapshot.findUnique({
        where: { facilityId_metrcHarvestId: { facilityId: input.facilityId, metrcHarvestId: input.harvestId } },
      });
      if (!snapshot) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Harvest ${input.harvestId} not found` });
      }
      return formatHarvest(harvestSnapshotToMetrc(snapshot));
    }),

  /**
   * Get valid waste types for this facility's Metrc environment.
   */
  getWasteTypes: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      return client.getHarvestWasteTypes();
    }),

  /**
   * Get waste records for a specific harvest.
   */
  getWaste: facilityProcedure
    .input(z.object({ facilityId: z.string(), harvestId: z.number() }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      return client.getHarvestWaste(input.harvestId);
    }),

  /**
   * Get a summary of all harvests: counts, weight totals, and yield analytics.
   */
  getSummary: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { active, onHold, inactive } = await getAllHarvestsFromDb(ctx.prisma, input.facilityId);

      const totalActiveWeight = active.reduce((sum, h) => sum + h.CurrentWeight, 0);
      const totalWasteWeight = [...active, ...inactive].reduce((sum, h) => sum + h.TotalWasteWeight, 0);
      const totalPackagedWeight = [...active, ...inactive].reduce((sum, h) => sum + h.TotalPackagedWeight, 0);

      const strainCounts = new Map<string, number>();
      for (const h of active) {
        strainCounts.set(h.SourceStrainNames, (strainCounts.get(h.SourceStrainNames) || 0) + 1);
      }

      // Yield analytics — computed from the same data, no extra API calls
      const allHarvests = [...active, ...inactive];
      const totalHarvests = allHarvests.length;

      let totalPackageCount = 0;
      let finishedDaysSum = 0;
      let finishedCount = 0;
      let allTotalWeight = 0;

      const strainMap = new Map<string, {
        harvestCount: number;
        totalPackagedWeight: number;
        totalWasteWeight: number;
        totalCurrentWeight: number;
        totalWeight: number;
      }>();

      for (const h of allHarvests) {
        const packaged = h.TotalPackagedWeight;
        const waste = h.TotalWasteWeight;
        const current = h.CurrentWeight;
        const weight = packaged + waste + current;

        totalPackageCount += h.PackageCount;
        allTotalWeight += weight;

        if (h.FinishedDate) {
          const start = new Date(h.HarvestStartDate).getTime();
          const end = new Date(h.FinishedDate).getTime();
          const days = (end - start) / (1000 * 60 * 60 * 24);
          if (Number.isFinite(days) && days >= 0) {
            finishedDaysSum += days;
            finishedCount++;
          }
        }

        const strain = h.SourceStrainNames || 'Unknown';
        const existing = strainMap.get(strain);
        if (existing) {
          existing.harvestCount++;
          existing.totalPackagedWeight += packaged;
          existing.totalWasteWeight += waste;
          existing.totalCurrentWeight += current;
          existing.totalWeight += weight;
        } else {
          strainMap.set(strain, {
            harvestCount: 1,
            totalPackagedWeight: packaged,
            totalWasteWeight: waste,
            totalCurrentWeight: current,
            totalWeight: weight,
          });
        }
      }

      const yieldAnalytics = totalHarvests > 0 ? {
        totalHarvests,
        avgYieldEfficiency: allTotalWeight > 0 ? totalPackagedWeight / allTotalWeight : 0,
        avgWasteRate: allTotalWeight > 0 ? totalWasteWeight / allTotalWeight : 0,
        avgPackagesPerHarvest: Math.round((totalPackageCount / totalHarvests) * 10) / 10,
        avgDaysToFinish: finishedCount > 0 ? Math.round(finishedDaysSum / finishedCount * 10) / 10 : null as number | null,
        totalThroughputGrams: Math.round(totalPackagedWeight * 100) / 100,
        wasteToOutputRatio: totalPackagedWeight > 0
          ? Math.round((totalWasteWeight / totalPackagedWeight) * 1000) / 1000
          : 0,
        strains: Array.from(strainMap.entries())
          .map(([strain, data]) => ({
            strain,
            harvestCount: data.harvestCount,
            totalPackagedWeight: Math.round(data.totalPackagedWeight * 100) / 100,
            totalWasteWeight: Math.round(data.totalWasteWeight * 100) / 100,
            totalCurrentWeight: Math.round(data.totalCurrentWeight * 100) / 100,
            avgYieldEfficiency: data.totalWeight > 0 ? data.totalPackagedWeight / data.totalWeight : 0,
            avgWasteRate: data.totalWeight > 0 ? data.totalWasteWeight / data.totalWeight : 0,
          }))
          .sort((a, b) => b.harvestCount - a.harvestCount),
      } : null;

      return {
        activeCount: active.length,
        onHoldCount: onHold.length,
        inactiveCount: inactive.length,
        totalActiveWeight: Math.round(totalActiveWeight * 100) / 100,
        totalWasteWeight: Math.round(totalWasteWeight * 100) / 100,
        totalPackagedWeight: Math.round(totalPackagedWeight * 100) / 100,
        topStrains: Array.from(strainCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([strain, count]) => ({ strain, count })),
        yieldAnalytics,
      };
    }),

  /**
   * Finish harvests (preview -> confirm -> execute)
   */
  finishHarvests: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      harvestIds: z.array(z.number()).min(1).max(50),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      const allHarvests = await getActiveHarvestsFromDb(ctx.prisma, ctx.facility.id);
      const targets = input.harvestIds.map(id => {
        const h = allHarvests.find(h => h.Id === id);
        return { id, name: h?.Name ?? 'Unknown', currentWeight: h?.CurrentWeight ?? 0, found: !!h };
      });

      const missing = targets.filter(t => !t.found);
      if (missing.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Harvest IDs not found: ${missing.map(m => m.id).join(', ')}`,
        });
      }

      if (!input.confirmed) {
        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'HARVEST_FINISH',
            status: 'PREVIEWING',
            targetType: 'HARVEST',
            targetIds: input.harvestIds.map(String),
            targetCount: input.harvestIds.length,
            previewData: targets as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, previews: targets };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      // Capture beforeState
      const beforeState = targets.map(t => ({
        id: t.id,
        name: t.name,
        currentWeight: t.currentWeight,
      }));

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'HARVEST_FINISH',
        targetType: 'HARVEST',
        targetIds: input.harvestIds.map(String),
        targetCount: input.harvestIds.length,
        executeFn: () => writeClient.finishHarvests(input.harvestIds.map(id => ({ Id: id }))),
        beforeState,
        verifyFn: async () => {
          // Re-read active harvests — finished ones should either have FinishedDate or be gone
          const activeAfter = await writeClient.getActiveHarvests();
          return checkHarvestFinish(input.harvestIds, activeAfter);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, count: input.harvestIds.length, verified: result.verified };
    }),

  /**
   * Record waste for a harvest (preview -> confirm -> execute)
   */
  recordWaste: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      harvestId: z.number(),
      wasteTypeName: z.string(),
      wasteWeight: z.number().positive(),
      unitOfWeightName: z.string().default('Grams'),
      actualDate: z.string(),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      let harvest;
      try {
        harvest = await client.getHarvest(input.harvestId);
      } catch {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Harvest ${input.harvestId} not found` });
      }

      if (!input.confirmed) {
        const preview = {
          harvestId: harvest.Id,
          harvestName: harvest.Name,
          wasteTypeName: input.wasteTypeName,
          wasteWeight: input.wasteWeight,
          unitOfWeightName: input.unitOfWeightName,
          currentTotalWaste: harvest.TotalWasteWeight,
          newTotalWaste: Math.round((harvest.TotalWasteWeight + input.wasteWeight) * 100) / 100,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'HARVEST_WASTE',
            status: 'PREVIEWING',
            targetType: 'HARVEST',
            targetIds: [String(input.harvestId)],
            targetCount: 1,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      // Capture beforeState
      const beforeState = {
        harvestId: harvest.Id,
        TotalWasteWeight: harvest.TotalWasteWeight,
      };

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'HARVEST_WASTE',
        targetType: 'HARVEST',
        targetIds: [String(input.harvestId)],
        targetCount: 1,
        executeFn: () => writeClient.recordHarvestWaste([{
          Id: input.harvestId,
          WasteType: input.wasteTypeName,
          WasteWeight: input.wasteWeight,
          UnitOfWeight: input.unitOfWeightName,
          ActualDate: input.actualDate,
        }]),
        beforeState,
        verifyFn: async () => {
          const afterHarvest = await writeClient.getHarvest(input.harvestId);
          return checkHarvestWaste(input.harvestId, harvest.TotalWasteWeight, input.wasteWeight, afterHarvest);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, verified: result.verified };
    }),

  /**
   * Create packages from a harvest (preview -> confirm -> execute)
   */
  createPackagesFromHarvest: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      harvestId: z.number(),
      tag: z.string(),
      itemName: z.string(),
      weight: z.number().positive(),
      unitOfWeightName: z.string().default('Grams'),
      actualDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      let harvest;
      try {
        harvest = await client.getHarvest(input.harvestId);
      } catch {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Harvest ${input.harvestId} not found` });
      }

      if (input.weight > harvest.CurrentWeight) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Requested weight ${input.weight} exceeds harvest current weight ${harvest.CurrentWeight}`,
        });
      }

      // Validate tag
      const availableTags = await client.getAvailableTags();
      const tagMatch = availableTags.find(t => t.Label === input.tag);
      if (!tagMatch) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Tag ${input.tag} not found in available tags` });
      }
      if (tagMatch.StatusName !== 'Available') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Tag ${input.tag} has status "${tagMatch.StatusName}" (expected "Available")` });
      }

      if (!input.confirmed) {
        const preview = {
          harvestId: harvest.Id,
          harvestName: harvest.Name,
          strain: harvest.SourceStrainNames,
          tag: input.tag,
          itemName: input.itemName,
          weight: input.weight,
          unitOfWeightName: input.unitOfWeightName,
          currentHarvestWeight: harvest.CurrentWeight,
          remainingWeight: Math.round((harvest.CurrentWeight - input.weight) * 100) / 100,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'HARVEST_CREATE_PACKAGE',
            status: 'PREVIEWING',
            targetType: 'HARVEST',
            targetIds: [String(input.harvestId)],
            targetCount: 1,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      const beforeState = {
        harvestId: harvest.Id,
        currentWeight: harvest.CurrentWeight,
      };

      const payload = [{
        HarvestId: input.harvestId,
        Tag: input.tag,
        Item: input.itemName,
        Weight: input.weight,
        UnitOfWeight: input.unitOfWeightName,
        IsProductionBatch: false,
        ProductionBatchNumber: null,
        IsDonation: false,
        ActualDate: input.actualDate,
      }];

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'HARVEST_CREATE_PACKAGE',
        targetType: 'HARVEST',
        targetIds: [String(input.harvestId), input.tag],
        targetCount: 1,
        executeFn: () => writeClient.createPackagesFromHarvest(payload as unknown as Record<string, unknown>[]),
        beforeState,
        verifyFn: async () => {
          const activeAfter = await writeClient.getActivePackages();
          return checkHarvestPackageCreate(input.tag, activeAfter);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, tag: input.tag, verified: result.verified };
    }),

  /**
   * Delete a harvest waste record (preview -> confirm -> execute).
   */
  deleteWaste: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      harvestId: z.number(),
      wasteId: z.number(),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Verify harvest and waste record exist
      const [harvest, wasteRecords] = await Promise.all([
        client.getHarvest(input.harvestId).catch(() => {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Harvest ${input.harvestId} not found` });
        }),
        client.getHarvestWaste(input.harvestId),
      ]);

      const wasteRecord = wasteRecords.find(w => w.Id === input.wasteId);
      if (!wasteRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Waste record ${input.wasteId} not found on harvest ${input.harvestId}` });
      }

      if (!input.confirmed) {
        const preview = {
          harvestId: harvest.Id,
          harvestName: harvest.Name,
          wasteId: wasteRecord.Id,
          wasteTypeName: wasteRecord.WasteTypeName,
          wasteWeight: wasteRecord.WasteWeight,
          unitOfWeightName: wasteRecord.UnitOfWeightName,
          currentTotalWaste: harvest.TotalWasteWeight,
          estimatedNewTotalWaste: Math.max(0, Math.round((harvest.TotalWasteWeight - wasteRecord.WasteWeight) * 100) / 100),
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'HARVEST_WASTE_DELETE',
            status: 'PREVIEWING',
            targetType: 'HARVEST',
            targetIds: [String(input.harvestId), String(input.wasteId)],
            targetCount: 1,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      const beforeState = {
        harvestId: harvest.Id,
        wasteId: wasteRecord.Id,
        TotalWasteWeight: harvest.TotalWasteWeight,
      };

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'HARVEST_WASTE_DELETE',
        targetType: 'HARVEST',
        targetIds: [String(input.harvestId), String(input.wasteId)],
        targetCount: 1,
        executeFn: () => writeClient.deleteHarvestWaste(facility.licenseNumber, input.wasteId),
        beforeState,
        verifyFn: async () => {
          const afterWaste = await writeClient.getHarvestWaste(input.harvestId);
          return checkHarvestWasteDelete(input.wasteId, afterWaste);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, verified: result.verified };
    }),
});
