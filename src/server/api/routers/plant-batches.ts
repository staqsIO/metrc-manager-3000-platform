import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getMetrcClient, getMetrcClientForWrite } from '@/services/metrc/metrc-factory';
import { formatPlantBatch } from '@/services/metrc/types';
import type { MetrcFacility, Prisma } from '@prisma/client';
import { executeMutationWithVerification } from '@/services/metrc/mutation-executor';
import { checkPlantBatchDestroy, checkPlantBatchCreate, checkGrowthPhaseChange, checkPlantBatchWaste } from '@/services/metrc/verification-checks';
import { formatPlantBatchWaste } from '@/services/metrc/types';
import { getActivePlantBatchesFromDb, getAllPlantBatchesFromDb, plantBatchSnapshotToMetrc } from '@/services/metrc/snapshot-utils';

export const plantBatchesRouter = createTRPCRouter({
  /**
   * Get active plant batches for a facility.
   */
  getActive: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      type: z.enum(['Seed', 'Clone']).optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      const allBatches = await getActivePlantBatchesFromDb(ctx.prisma, input.facilityId);

      let batches = allBatches.map(formatPlantBatch);

      if (input.search) {
        const s = input.search.toLowerCase();
        batches = batches.filter(b =>
          b.name.toLowerCase().includes(s) ||
          b.strainName.toLowerCase().includes(s) ||
          b.location.toLowerCase().includes(s)
        );
      }

      if (input.type) {
        batches = batches.filter(b => b.type === input.type);
      }

      batches.sort((a, b) => b.ageDays - a.ageDays);

      const total = batches.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const items = batches.slice(start, start + input.pageSize);

      return { items, total, page: input.page, pageSize: input.pageSize, totalPages };
    }),

  /**
   * Get inactive plant batches.
   */
  getInactive: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      const { inactive: inactiveBatches } = await getAllPlantBatchesFromDb(ctx.prisma, input.facilityId);
      const batches = inactiveBatches.map(formatPlantBatch);

      const total = batches.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const items = batches.slice(start, start + input.pageSize);

      return { items, total, page: input.page, pageSize: input.pageSize, totalPages };
    }),

  /**
   * Get a single plant batch by ID.
   */
  getById: facilityProcedure
    .input(z.object({ facilityId: z.string(), plantBatchId: z.number() }))
    .query(async ({ ctx, input }) => {
      const snapshot = await ctx.prisma.plantBatchSnapshot.findUnique({
        where: { facilityId_metrcBatchId: { facilityId: input.facilityId, metrcBatchId: input.plantBatchId } },
      });
      if (!snapshot) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Plant batch ${input.plantBatchId} not found` });
      }
      return formatPlantBatch(plantBatchSnapshotToMetrc(snapshot));
    }),

  /**
   * Get plant batch summary stats.
   */
  getSummary: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { active, inactive } = await getAllPlantBatchesFromDb(ctx.prisma, input.facilityId);

      const totalPlants = active.reduce((sum, b) => sum + (b.Count ?? 0), 0);
      const totalTracked = active.reduce((sum, b) => sum + (b.TrackedCount ?? 0), 0);
      const totalUntracked = active.reduce((sum, b) => sum + (b.UntrackedCount ?? 0), 0);

      const strainCounts = new Map<string, number>();
      const typeCounts = new Map<string, number>();
      for (const b of active) {
        strainCounts.set(b.StrainName, (strainCounts.get(b.StrainName) || 0) + (b.Count ?? 0));
        typeCounts.set(b.Type, (typeCounts.get(b.Type) || 0) + 1);
      }

      return {
        activeCount: active.length,
        inactiveCount: inactive.length,
        totalPlants,
        totalTracked,
        totalUntracked,
        byType: Array.from(typeCounts.entries()).map(([type, count]) => ({ type, count })),
        topStrains: Array.from(strainCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([strain, plantCount]) => ({ strain, plantCount })),
      };
    }),

  /**
   * Destroy plants in a batch (preview -> confirm -> execute)
   */
  destroyPlants: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      plantBatchId: z.number(),
      count: z.number().min(1),
      reasonNote: z.string().min(1),
      actualDate: z.string(),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      let batch;
      try {
        batch = await client.getPlantBatch(input.plantBatchId);
      } catch {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Plant batch ${input.plantBatchId} not found` });
      }

      if (input.count > batch.Count) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot destroy ${input.count} plants — batch only has ${batch.Count}`,
        });
      }

      if (!input.confirmed) {
        const preview = {
          batchId: batch.Id,
          batchName: batch.Name,
          strain: batch.StrainName,
          currentCount: batch.Count,
          destroyCount: input.count,
          remainingCount: batch.Count - input.count,
          reason: input.reasonNote,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'PLANTBATCH_DESTROY',
            status: 'PREVIEWING',
            targetType: 'PLANT_BATCH',
            targetIds: [String(input.plantBatchId)],
            targetCount: input.count,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      // Capture beforeState
      const beforeState = { Id: batch.Id, Name: batch.Name, Count: batch.Count };

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'PLANTBATCH_DESTROY',
        targetType: 'PLANT_BATCH',
        targetIds: [String(input.plantBatchId)],
        targetCount: input.count,
        executeFn: () => writeClient.destroyPlantBatches([{
          Id: input.plantBatchId,
          PlantBatch: batch.Name,
          Count: input.count,
          ReasonNote: input.reasonNote,
          ActualDate: input.actualDate,
        }]),
        beforeState,
        verifyFn: async () => {
          let afterBatch = null;
          try {
            afterBatch = await writeClient.getPlantBatch(input.plantBatchId);
          } catch {
            // Batch may have been fully destroyed
          }
          return checkPlantBatchDestroy(input.plantBatchId, batch.Count, input.count, afterBatch);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, destroyedCount: input.count, verified: result.verified };
    }),

  /**
   * Create a new plant batch (preview -> confirm -> execute)
   */
  createBatch: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      name: z.string().min(1),
      strainName: z.string().min(1),
      type: z.enum(['Seed', 'Clone']),
      count: z.number().min(1),
      locationName: z.string().min(1),
      tag: z.string().min(1),
      actualDate: z.string(),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Validate tag
      const availableTags = await client.getAvailableTags();
      const tagMatch = availableTags.find(t => t.Label === input.tag);
      if (!tagMatch) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Tag ${input.tag} not found in available tags` });
      }
      if (tagMatch.StatusName !== 'Available') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Tag ${input.tag} has status "${tagMatch.StatusName}"` });
      }

      if (!input.confirmed) {
        const preview = {
          name: input.name,
          strainName: input.strainName,
          type: input.type,
          count: input.count,
          locationName: input.locationName,
          tag: input.tag,
          actualDate: input.actualDate,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'PLANTBATCH_CREATE',
            status: 'PREVIEWING',
            targetType: 'PLANT_BATCH',
            targetIds: [input.name],
            targetCount: input.count,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      const payload = [{
        Name: input.name,
        Type: input.type,
        Count: input.count,
        Strain: input.strainName,
        Location: input.locationName,
        Tag: input.tag,
        PatientLicenseNumber: null,
        ActualDate: input.actualDate,
      }];

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'PLANTBATCH_CREATE',
        targetType: 'PLANT_BATCH',
        targetIds: [input.name],
        targetCount: input.count,
        executeFn: () => writeClient.createPlantBatches(payload as unknown as Record<string, unknown>[]),
        beforeState: null,
        verifyFn: async () => {
          const activeAfter = await writeClient.getActivePlantBatches();
          const batches = Array.isArray(activeAfter) ? activeAfter : [];
          return checkPlantBatchCreate(input.name, batches);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, batchName: input.name, verified: result.verified };
    }),

  /**
   * Change growth phase for a plant batch (preview -> confirm -> execute)
   */
  changeGrowthPhase: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      plantBatchId: z.number(),
      count: z.number().min(1),
      growthPhase: z.enum(['Vegetative', 'Flowering']),
      newTag: z.string().min(1),
      startingTag: z.string().optional(),
      newLocation: z.string().optional(),
      actualDate: z.string(),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      let batch;
      try {
        batch = await client.getPlantBatch(input.plantBatchId);
      } catch {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Plant batch ${input.plantBatchId} not found` });
      }

      if (input.count > batch.Count) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot change ${input.count} plants — batch only has ${batch.Count}`,
        });
      }

      if (!input.confirmed) {
        const preview = {
          batchId: batch.Id,
          batchName: batch.Name,
          strain: batch.StrainName,
          currentCount: batch.Count,
          changeCount: input.count,
          fromPhase: batch.Type,
          toPhase: input.growthPhase,
          newLocation: input.newLocation ?? batch.LocationName,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'PLANTBATCH_CHANGE_PHASE',
            status: 'PREVIEWING',
            targetType: 'PLANT_BATCH',
            targetIds: [String(input.plantBatchId)],
            targetCount: input.count,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      const beforeBatch = batch;
      const beforeState = { Id: batch.Id, Name: batch.Name, Count: batch.Count, Type: batch.Type };
      const expectedRemainingCount = batch.Count - input.count;

      const payload = [{
        Name: batch.Name,
        Count: input.count,
        StartingTag: input.startingTag || input.newTag,
        GrowthPhase: input.growthPhase,
        NewLocation: input.newLocation || batch.LocationName,
        PatientLicenseNumber: null,
        ActualDate: input.actualDate,
      }];

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'PLANTBATCH_CHANGE_PHASE',
        targetType: 'PLANT_BATCH',
        targetIds: [String(input.plantBatchId)],
        targetCount: input.count,
        executeFn: () => writeClient.changePlantBatchGrowthPhase(payload as unknown as Record<string, unknown>[]),
        beforeState,
        verifyFn: async () => {
          let afterBatch = null;
          try {
            afterBatch = await writeClient.getPlantBatch(input.plantBatchId);
          } catch {
            // Batch may have been fully transitioned
          }
          return checkGrowthPhaseChange(input.plantBatchId, expectedRemainingCount, beforeBatch, afterBatch);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, changedCount: input.count, verified: result.verified };
    }),

  /**
   * Get waste records for all plant batches in this facility.
   */
  getWaste: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      const wasteRecords = await client.getPlantBatchWaste(facility.licenseNumber);
      return wasteRecords.map(formatPlantBatchWaste);
    }),

  /**
   * Get valid waste reasons for plant batches.
   */
  getWasteReasons: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      const reasons = await client.getPlantBatchWasteReasons(facility.licenseNumber);
      return reasons.map(r => r.Name);
    }),

  /**
   * Record waste for a plant batch (preview -> confirm -> execute).
   */
  recordWaste: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      plantBatchId: z.number(),
      plantBatchName: z.string(),
      wasteReasonName: z.string(),
      wasteWeight: z.number().positive(),
      unitOfWeightName: z.string().default('Grams'),
      actualDate: z.string(),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Validate batch exists
      let batch;
      try {
        batch = await client.getPlantBatch(input.plantBatchId);
      } catch {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Plant batch ${input.plantBatchId} not found` });
      }

      if (!input.confirmed) {
        const preview = {
          batchId: batch.Id,
          batchName: batch.Name,
          strain: batch.StrainName,
          wasteReasonName: input.wasteReasonName,
          wasteWeight: input.wasteWeight,
          unitOfWeightName: input.unitOfWeightName,
          actualDate: input.actualDate,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'PLANTBATCH_WASTE',
            status: 'PREVIEWING',
            targetType: 'PLANT_BATCH',
            targetIds: [String(input.plantBatchId)],
            targetCount: 1,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      // Capture before state for verification
      const existingWaste = await client.getPlantBatchWaste(facility.licenseNumber);
      const beforeWasteCount = existingWaste.filter(w => w.PlantBatchId === input.plantBatchId).length;

      const beforeState = { batchId: batch.Id, wasteCount: beforeWasteCount };

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'PLANTBATCH_WASTE',
        targetType: 'PLANT_BATCH',
        targetIds: [String(input.plantBatchId)],
        targetCount: 1,
        executeFn: () => writeClient.recordPlantBatchWaste(facility.licenseNumber, [{
          PlantBatchId: input.plantBatchId,
          PlantBatchName: input.plantBatchName,
          WasteReasonName: input.wasteReasonName,
          WasteWeight: input.wasteWeight,
          UnitOfWeightName: input.unitOfWeightName,
          ActualDate: input.actualDate,
        }]),
        beforeState,
        verifyFn: async () => {
          const afterWaste = await writeClient.getPlantBatchWaste(facility.licenseNumber);
          const batchWaste = afterWaste.filter(w => w.PlantBatchId === input.plantBatchId);
          return checkPlantBatchWaste(input.plantBatchId, beforeWasteCount, batchWaste);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, verified: result.verified };
    }),
});
