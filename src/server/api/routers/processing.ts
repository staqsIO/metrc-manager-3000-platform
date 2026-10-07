import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getMetrcClient, getMetrcClientForWrite } from '@/services/metrc/metrc-factory';
import type { MetrcFacility, Prisma } from '@prisma/client';
import { getActivePackagesFromDb } from '@/services/metrc/snapshot-utils';
import { executeMutationWithVerification } from '@/services/metrc/mutation-executor';
import { checkProcessingCreate } from '@/services/metrc/verification-checks';

/**
 * Processing router — handles package-to-package transformations.
 *
 * In Metrc, "processing" means creating new packages from source packages:
 * - Extraction (flower → concentrate)
 * - Infusion (concentrate → edible)
 * - Repackaging (bulk → retail units)
 * - Remediation reprocessing
 *
 * The underlying API call is POST /packages/v1/create with source package references.
 */
export const processingRouter = createTRPCRouter({
  /**
   * Get packages available as processing inputs (active, non-hold packages).
   * Grouped by category for the processing UI.
   */
  getSourcePackages: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      category: z.string().optional(),
      search: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      const allPackages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);

      // Only non-hold packages with quantity available
      let sources = allPackages.filter(p => !p.IsOnHold && p.Quantity > 0);

      if (input.category) {
        sources = sources.filter(p => p.ItemCategory === input.category);
      }

      if (input.search) {
        const s = input.search.toLowerCase();
        sources = sources.filter(p =>
          p.ItemName.toLowerCase().includes(s) ||
          p.Label.toLowerCase().includes(s) ||
          p.ItemStrainName?.toLowerCase().includes(s)
        );
      }

      // Sort by quantity descending (largest sources first)
      sources.sort((a, b) => b.Quantity - a.Quantity);

      const total = sources.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const items = sources.slice(start, start + input.pageSize).map(p => ({
        label: p.Label,
        itemName: p.ItemName,
        category: p.ItemCategory,
        strain: p.ItemStrainName,
        quantity: p.Quantity,
        unit: p.UnitOfMeasureName,
        location: p.LocationName,
        labTestingState: p.LabTestingState,
      }));

      const categories = Array.from(new Set(allPackages.filter(p => !p.IsOnHold && p.Quantity > 0).map(p => p.ItemCategory))).sort();

      return { items, total, page: input.page, pageSize: input.pageSize, totalPages, categories };
    }),

  /**
   * Create processing packages (preview -> confirm -> execute).
   *
   * Takes source packages and creates new output packages.
   * This maps to Metrc's POST /packages/v1/create endpoint.
   */
  createProcessingJob: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      sourcePackages: z.array(z.object({
        label: z.string(),
        quantity: z.number().positive(),
        unitOfMeasure: z.string(),
      })).min(1).max(20),
      outputTag: z.string(),
      outputItemName: z.string(),
      outputQuantity: z.number().positive(),
      outputUnitOfMeasure: z.string(),
      note: z.string().optional(),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Validate output tag exists and is available
      const availableTags = await client.getAvailableTags();
      const outputTagMatch = availableTags.find(t => t.Label === input.outputTag);
      if (!outputTagMatch) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Output tag ${input.outputTag} not found in available tags`,
        });
      }
      if (outputTagMatch.StatusName !== 'Available') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Output tag ${input.outputTag} has status "${outputTagMatch.StatusName}" (expected "Available")`,
        });
      }

      // Validate source packages from DB
      const allPackages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      const validationErrors: string[] = [];
      const sourcePreviews = input.sourcePackages.map(src => {
        const pkg = allPackages.find(p => p.Label === src.label);
        if (!pkg) {
          validationErrors.push(`Source package ${src.label} not found`);
          return { label: src.label, found: false, itemName: 'Unknown', availableQty: 0, requestedQty: src.quantity };
        }
        if (pkg.Quantity < src.quantity) {
          validationErrors.push(`Source ${src.label} has ${pkg.Quantity} ${pkg.UnitOfMeasureName} but ${src.quantity} requested`);
        }
        if (pkg.IsOnHold) {
          validationErrors.push(`Source ${src.label} is on hold`);
        }
        return {
          label: src.label,
          found: true,
          itemName: pkg.ItemName,
          strain: pkg.ItemStrainName,
          availableQty: pkg.Quantity,
          requestedQty: src.quantity,
          unit: pkg.UnitOfMeasureName,
        };
      });

      if (validationErrors.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: validationErrors.join('; '),
        });
      }

      if (!input.confirmed) {
        const preview = {
          sources: sourcePreviews,
          output: {
            tag: input.outputTag,
            itemName: input.outputItemName,
            quantity: input.outputQuantity,
            unitOfMeasure: input.outputUnitOfMeasure,
          },
          note: input.note ?? '',
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'PROCESSING_CREATE',
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: input.sourcePackages.map(s => s.label),
            targetCount: input.sourcePackages.length,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      // Re-fetch fresh state for beforeState capture (allPackages may be stale from preview phase)
      const freshPackages = await writeClient.getActivePackages();
      const sourceBefore = input.sourcePackages.map(src => {
        const pkg = freshPackages.find(p => p.Label === src.label)!;
        return { Label: src.label, Quantity: pkg.Quantity };
      });
      const sourceQuantitiesUsed: Record<string, number> = {};
      for (const src of input.sourcePackages) {
        sourceQuantitiesUsed[src.label] = src.quantity;
      }

      // Build the Metrc API payload
      const metrcPayload = [{
        Tag: input.outputTag,
        Item: input.outputItemName,
        Quantity: input.outputQuantity,
        UnitOfMeasure: input.outputUnitOfMeasure,
        IsProductionBatch: false,
        ProductionBatchNumber: null,
        IsDonation: false,
        ActualDate: new Date().toISOString().split('T')[0],
        Ingredients: input.sourcePackages.map(src => ({
          Package: src.label,
          Quantity: src.quantity,
          UnitOfMeasure: src.unitOfMeasure,
        })),
        Note: input.note ?? '',
      }];

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'PROCESSING_CREATE',
        targetType: 'PACKAGE',
        targetIds: [input.outputTag, ...input.sourcePackages.map(s => s.label)],
        targetCount: 1,
        executeFn: () => writeClient.createProcessingPackages(metrcPayload as unknown as Record<string, unknown>[]),
        beforeState: sourceBefore,
        verifyFn: async () => {
          const activeAfter = await writeClient.getActivePackages();
          return checkProcessingCreate(sourceBefore, sourceQuantitiesUsed, input.outputTag, activeAfter);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, outputTag: input.outputTag, verified: result.verified };
    }),

  /**
   * Create processing batch from an accepted inbound transfer (preview -> confirm -> execute).
   *
   * Composition: reads transfer delivery packages, validates they exist as active packages
   * in the receiving facility, then creates a processing package using the same Metrc
   * API as createProcessingJob. Auto-prepends a transfer reference in the note.
   */
  createBatchFromTransfer: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      transferId: z.number(),
      manifestNumber: z.string().optional(),
      sourcePackages: z.array(z.object({
        label: z.string(),
        quantity: z.number().positive(),
        unitOfMeasure: z.string(),
      })).min(1).max(20),
      outputTag: z.string(),
      outputItemName: z.string(),
      outputQuantity: z.number().positive(),
      outputUnitOfMeasure: z.string(),
      note: z.string().optional(),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Validate output tag
      const availableTags = await client.getAvailableTags();
      const outputTagMatch = availableTags.find(t => t.Label === input.outputTag);
      if (!outputTagMatch) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Output tag ${input.outputTag} not found in available tags` });
      }
      if (outputTagMatch.StatusName !== 'Available') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Output tag ${input.outputTag} has status "${outputTagMatch.StatusName}" (expected "Available")` });
      }

      // Validate source packages from DB (transferred packages become active after acceptance)
      const allPackages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      const validationErrors: string[] = [];
      const sourcePreviews = input.sourcePackages.map(src => {
        const pkg = allPackages.find(p => p.Label === src.label);
        if (!pkg) {
          validationErrors.push(`Source package ${src.label} not found in active inventory`);
          return { label: src.label, found: false, itemName: 'Unknown', availableQty: 0, requestedQty: src.quantity };
        }
        if (pkg.Quantity < src.quantity) {
          validationErrors.push(`Source ${src.label} has ${pkg.Quantity} ${pkg.UnitOfMeasureName} but ${src.quantity} requested`);
        }
        if (pkg.IsOnHold) {
          validationErrors.push(`Source ${src.label} is on hold`);
        }
        return {
          label: src.label,
          found: true,
          itemName: pkg.ItemName,
          strain: pkg.ItemStrainName,
          category: pkg.ItemCategory,
          availableQty: pkg.Quantity,
          requestedQty: src.quantity,
          unit: pkg.UnitOfMeasureName,
        };
      });

      if (validationErrors.length > 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: validationErrors.join('; ') });
      }

      const transferNote = `Batch from Transfer${input.manifestNumber ? ` #${input.manifestNumber}` : ` ID ${input.transferId}`}. ${input.note ?? ''}`.trim();

      if (!input.confirmed) {
        const preview = {
          sources: sourcePreviews,
          output: {
            tag: input.outputTag,
            itemName: input.outputItemName,
            quantity: input.outputQuantity,
            unitOfMeasure: input.outputUnitOfMeasure,
          },
          note: transferNote,
          transferId: input.transferId,
          manifestNumber: input.manifestNumber,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'PROCESSING_CREATE_FROM_TRANSFER',
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: input.sourcePackages.map(s => s.label),
            targetCount: input.sourcePackages.length,
            previewData: preview as unknown as Prisma.InputJsonValue,
            metadata: { transferId: input.transferId, manifestNumber: input.manifestNumber } as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      // Execute
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      const freshPackages = await writeClient.getActivePackages();
      const sourceBefore = input.sourcePackages.map(src => {
        const pkg = freshPackages.find(p => p.Label === src.label);
        if (!pkg) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Source package ${src.label} is no longer active. It may have been consumed or placed on hold since the preview.`,
          });
        }
        return { Label: src.label, Quantity: pkg.Quantity };
      });
      const sourceQuantitiesUsed: Record<string, number> = {};
      for (const src of input.sourcePackages) {
        sourceQuantitiesUsed[src.label] = src.quantity;
      }

      const metrcPayload = [{
        Tag: input.outputTag,
        Item: input.outputItemName,
        Quantity: input.outputQuantity,
        UnitOfMeasure: input.outputUnitOfMeasure,
        IsProductionBatch: false,
        ProductionBatchNumber: null,
        IsDonation: false,
        ActualDate: new Date().toISOString().split('T')[0],
        Ingredients: input.sourcePackages.map(src => ({
          Package: src.label,
          Quantity: src.quantity,
          UnitOfMeasure: src.unitOfMeasure,
        })),
        Note: transferNote,
      }];

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'PROCESSING_CREATE_FROM_TRANSFER',
        targetType: 'PACKAGE',
        targetIds: [input.outputTag, ...input.sourcePackages.map(s => s.label)],
        targetCount: 1,
        executeFn: () => writeClient.createProcessingPackages(metrcPayload as unknown as Record<string, unknown>[]),
        beforeState: sourceBefore,
        verifyFn: async () => {
          const activeAfter = await writeClient.getActivePackages();
          return checkProcessingCreate(sourceBefore, sourceQuantitiesUsed, input.outputTag, activeAfter);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, outputTag: input.outputTag, verified: result.verified };
    }),
});
