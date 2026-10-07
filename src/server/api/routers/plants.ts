import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getMetrcClient, getMetrcClientForWrite } from '@/services/metrc/metrc-factory';
import { formatPlant } from '@/services/metrc/types';
import type { MetrcFacility, Prisma } from '@prisma/client';
import { executeMutationWithVerification } from '@/services/metrc/mutation-executor';
import { checkPlantDestroy } from '@/services/metrc/verification-checks';
import { getActivePlantsFromDb } from '@/services/metrc/snapshot-utils';

export const plantsRouter = createTRPCRouter({
  /**
   * Get active plants for a facility.
   */
  getActive: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      growthPhase: z.enum(['Vegetative', 'Flowering']).optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      const allPlants = await getActivePlantsFromDb(ctx.prisma, input.facilityId);

      let plants = allPlants.map(formatPlant);

      if (input.search) {
        const s = input.search.toLowerCase();
        plants = plants.filter(p =>
          p.label.toLowerCase().includes(s) ||
          p.strain.toLowerCase().includes(s) ||
          p.location.toLowerCase().includes(s)
        );
      }

      if (input.growthPhase) {
        plants = plants.filter(p => p.growthPhase === input.growthPhase);
      }

      plants.sort((a, b) => new Date(b.plantedDate).getTime() - new Date(a.plantedDate).getTime());

      const total = plants.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const items = plants.slice(start, start + input.pageSize);

      return { items, total, page: input.page, pageSize: input.pageSize, totalPages };
    }),

  /**
   * Get a single plant by ID.
   */
  getById: facilityProcedure
    .input(z.object({ facilityId: z.string(), plantId: z.number() }))
    .query(async ({ ctx, input }) => {
      const snapshot = await ctx.prisma.plantSnapshot.findUnique({
        where: { facilityId_metrcPlantId: { facilityId: input.facilityId, metrcPlantId: input.plantId } },
      });
      if (!snapshot) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Plant ${input.plantId} not found` });
      }
      const { plantSnapshotToMetrc } = await import('@/services/metrc/snapshot-utils');
      return formatPlant(plantSnapshotToMetrc(snapshot));
    }),

  /**
   * Get a summary of active plants: counts by growth phase, on-hold, and top strains.
   */
  getSummary: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const allPlants = await getActivePlantsFromDb(ctx.prisma, input.facilityId);

      const plants = allPlants.map(formatPlant);

      let vegetativeCount = 0;
      let floweringCount = 0;
      let onHoldCount = 0;

      const strainCounts = new Map<string, number>();

      for (const p of plants) {
        if (p.growthPhase === 'Vegetative') vegetativeCount++;
        if (p.growthPhase === 'Flowering') floweringCount++;
        if (p.isOnHold) onHoldCount++;

        strainCounts.set(p.strain, (strainCounts.get(p.strain) || 0) + 1);
      }

      const topStrains = Array.from(strainCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([strain, count]) => ({ strain, count }));

      return {
        totalCount: plants.length,
        vegetativeCount,
        floweringCount,
        onHoldCount,
        topStrains,
      };
    }),

  /**
   * Bulk change growth phase for selected plants (preview -> confirm -> execute).
   * Groups plants by PlantBatchName before calling the Metrc API (operates at batch level).
   */
  changeGrowthPhase: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      plantIds: z.array(z.number()).min(1).max(100),
      growthPhase: z.enum(['Vegetative', 'Flowering']),
      newTag: z.string().min(1),
      newLocation: z.string().optional(),
      actualDate: z.string(),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      const allPlants = await client.getActivePlants();
      const selectedPlants = input.plantIds.map(id => {
        const p = allPlants.find(pl => pl.Id === id);
        return { id, found: !!p, label: p?.Label ?? 'Unknown', batchName: p?.PlantBatchName ?? 'Unknown', phase: p?.GrowthPhase ?? 'Unknown' };
      });

      const missing = selectedPlants.filter(p => !p.found);
      if (missing.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Plant IDs not found: ${missing.map(m => m.id).join(', ')}`,
        });
      }

      // Group by batch name
      const batchGroups = new Map<string, typeof selectedPlants>();
      for (const p of selectedPlants) {
        const group = batchGroups.get(p.batchName) || [];
        group.push(p);
        batchGroups.set(p.batchName, group);
      }

      if (!input.confirmed) {
        const preview = {
          totalPlants: input.plantIds.length,
          batchCount: batchGroups.size,
          batches: Array.from(batchGroups.entries()).map(([batchName, plants]) => ({
            batchName,
            plantCount: plants.length,
            currentPhase: plants[0]!.phase,
          })),
          toPhase: input.growthPhase,
          newLocation: input.newLocation,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'PLANT_CHANGE_PHASE',
            status: 'PREVIEWING',
            targetType: 'PLANT',
            targetIds: input.plantIds.map(String),
            targetCount: input.plantIds.length,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      const beforeState = selectedPlants.map(p => ({
        id: p.id,
        label: p.label,
        batchName: p.batchName,
        phase: p.phase,
      }));

      // Execute per batch group
      const payloads = Array.from(batchGroups.entries()).map(([batchName, plants]) => ({
        Name: batchName,
        Count: plants.length,
        StartingTag: input.newTag,
        GrowthPhase: input.growthPhase,
        NewLocation: input.newLocation || null,
        PatientLicenseNumber: null,
        ActualDate: input.actualDate,
      }));

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'PLANT_CHANGE_PHASE',
        targetType: 'PLANT',
        targetIds: input.plantIds.map(String),
        targetCount: input.plantIds.length,
        executeFn: () => writeClient.changePlantBatchGrowthPhase(payloads as unknown as Record<string, unknown>[]),
        beforeState,
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, changedCount: input.plantIds.length, verified: result.verified };
    }),

  /**
   * Get waste methods for plant destruction.
   */
  getWasteMethods: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      const methods = await client.getPlantWasteMethods();
      return methods.map(m => ({
        name: m.Name,
        forPlants: m.ForPlants,
        forProductDestruction: m.ForProductDestruction,
      }));
    }),

  /**
   * Destroy mature plants (preview -> confirm -> execute).
   */
  destroyPlants: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      plantIds: z.array(z.number()).min(1),
      wasteMethodName: z.string(),
      reasonNote: z.string().min(1),
      actualDate: z.string(),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Validate plants exist
      const plants = await Promise.all(
        input.plantIds.map(async (id) => {
          try {
            return await client.getPlant(id);
          } catch {
            throw new TRPCError({ code: 'NOT_FOUND', message: `Plant ${id} not found` });
          }
        })
      );

      if (!input.confirmed) {
        const preview = {
          plantCount: plants.length,
          plants: plants.map(p => ({
            id: p.Id,
            label: p.Label,
            strain: p.StrainName,
            growthPhase: p.GrowthPhase,
          })),
          wasteMethodName: input.wasteMethodName,
          reasonNote: input.reasonNote,
          actualDate: input.actualDate,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'PLANT_DESTROY',
            status: 'PREVIEWING',
            targetType: 'PLANT',
            targetIds: input.plantIds.map(String),
            targetCount: input.plantIds.length,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      const beforeState = plants.map(p => ({ Id: p.Id, Label: p.Label, DestroyedDate: p.DestroyedDate }));

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'PLANT_DESTROY',
        targetType: 'PLANT',
        targetIds: input.plantIds.map(String),
        targetCount: input.plantIds.length,
        executeFn: () => writeClient.destroyPlants(facility.licenseNumber, input.plantIds.map(id => ({
          Id: id,
          WasteMethodName: input.wasteMethodName,
          ReasonNote: input.reasonNote,
          ActualDate: input.actualDate,
        }))),
        beforeState,
        verifyFn: async () => {
          const afterPlants = await Promise.all(
            input.plantIds.map(async (id) => {
              try {
                return await writeClient.getPlant(id);
              } catch {
                return null;
              }
            })
          );
          return checkPlantDestroy(input.plantIds, afterPlants.filter(Boolean) as typeof plants);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, destroyedCount: input.plantIds.length, verified: result.verified };
    }),
});
