import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import type { Prisma } from '@prisma/client';
import { checkFeasibility, findLowStockItems } from '@/services/engines/supply-engine';
import type { BOMLine } from '@/services/engines/supply-engine';
import { inferBOMsFromHistory } from '@/services/engines/bom-inference';

export const supplyRouter = createTRPCRouter({
  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  listItems: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      categoryId: z.string().optional(),
      isActive: z.boolean().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Prisma.SupplyItemWhereInput = { facilityId: input.facilityId };
      if (input.categoryId !== undefined) where.categoryId = input.categoryId;
      if (input.isActive !== undefined) where.isActive = input.isActive;
      if (input.search) {
        where.OR = [
          { name: { contains: input.search, mode: 'insensitive' } },
          { sku: { contains: input.search, mode: 'insensitive' } },
          { vendor: { contains: input.search, mode: 'insensitive' } },
        ];
      }

      return ctx.prisma.supplyItem.findMany({
        where,
        include: { category: true },
        orderBy: { name: 'asc' },
      });
    }),

  getItem: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      itemId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.supplyItem.findFirst({
        where: { id: input.itemId, facilityId: input.facilityId },
        include: {
          category: true,
          bomLines: {
            include: { componentItem: true },
          },
        },
      });
    }),

  createItem: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      name: z.string().min(1),
      sku: z.string().optional(),
      unit: z.string(),
      categoryId: z.string().optional(),
      currentStock: z.number(),
      reorderPoint: z.number().optional(),
      reorderQty: z.number().optional(),
      unitCost: z.number().optional(),
      vendor: z.string().optional(),
      location: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.supplyItem.create({
        data: {
          facilityId: input.facilityId,
          name: input.name,
          sku: input.sku || null,
          unit: input.unit,
          categoryId: input.categoryId || null,
          currentStock: input.currentStock,
          reorderPoint: input.reorderPoint ?? null,
          reorderQty: input.reorderQty ?? null,
          unitCost: input.unitCost ?? null,
          vendor: input.vendor || null,
          location: input.location || null,
          notes: input.notes || null,
        },
      });
    }),

  updateItem: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      itemId: z.string(),
      name: z.string().min(1).optional(),
      sku: z.string().optional(),
      unit: z.string().optional(),
      categoryId: z.string().nullable().optional(),
      reorderPoint: z.number().nullable().optional(),
      reorderQty: z.number().nullable().optional(),
      unitCost: z.number().nullable().optional(),
      vendor: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      isActive: z.boolean().optional(),
      stockAdjustment: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { facilityId, itemId, stockAdjustment, ...fields } = input;

      // Verify item belongs to this facility
      const existing = await ctx.prisma.supplyItem.findFirst({
        where: { id: itemId, facilityId },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found or access denied' });
      }

      // Build the update data, only including provided fields
      const updateData: Prisma.SupplyItemUpdateInput = {};
      if (fields.name !== undefined) updateData.name = fields.name;
      if (fields.sku !== undefined) updateData.sku = fields.sku;
      if (fields.unit !== undefined) updateData.unit = fields.unit;
      if (fields.categoryId !== undefined) {
        updateData.category = fields.categoryId
          ? { connect: { id: fields.categoryId } }
          : { disconnect: true };
      }
      if (fields.reorderPoint !== undefined) updateData.reorderPoint = fields.reorderPoint;
      if (fields.reorderQty !== undefined) updateData.reorderQty = fields.reorderQty;
      if (fields.unitCost !== undefined) updateData.unitCost = fields.unitCost;
      if (fields.vendor !== undefined) updateData.vendor = fields.vendor;
      if (fields.location !== undefined) updateData.location = fields.location;
      if (fields.notes !== undefined) updateData.notes = fields.notes;
      if (fields.isActive !== undefined) updateData.isActive = fields.isActive;

      if (stockAdjustment !== undefined) {
        return ctx.prisma.$transaction(async (tx) => {
          const item = await tx.supplyItem.update({
            where: { id: itemId },
            data: {
              ...updateData,
              currentStock: { increment: stockAdjustment },
            },
          });

          await tx.supplyTransaction.create({
            data: {
              facilityId,
              itemId,
              type: 'ADJUST',
              quantity: stockAdjustment,
              notes: `Stock adjustment: ${stockAdjustment > 0 ? '+' : ''}${stockAdjustment}`,
              createdBy: ctx.session.user.id,
            },
          });

          return item;
        });
      }

      return ctx.prisma.supplyItem.update({
        where: { id: itemId },
        data: updateData,
      });
    }),

  deleteItem: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      itemId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.supplyItem.findFirst({
        where: { id: input.itemId, facilityId: input.facilityId },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found or access denied' });
      }
      return ctx.prisma.supplyItem.update({
        where: { id: input.itemId },
        data: { isActive: false },
      });
    }),

  // ---------------------------------------------------------------------------
  // Stock Movements
  // ---------------------------------------------------------------------------

  receiveStock: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      itemId: z.string(),
      quantity: z.number().positive(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.supplyItem.findFirst({
        where: { id: input.itemId, facilityId: input.facilityId },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found or access denied' });
      }

      return ctx.prisma.$transaction(async (tx) => {
        await tx.supplyTransaction.create({
          data: {
            facilityId: input.facilityId,
            itemId: input.itemId,
            type: 'RECEIVE',
            quantity: input.quantity,
            notes: input.notes || null,
            createdBy: ctx.session.user.id,
          },
        });

        return tx.supplyItem.update({
          where: { id: input.itemId },
          data: { currentStock: { increment: input.quantity } },
        });
      });
    }),

  consumeStock: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      itemId: z.string(),
      quantity: z.number().positive(),
      referenceType: z.string().optional(),
      referenceId: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.supplyItem.findFirst({
        where: { id: input.itemId, facilityId: input.facilityId },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found or access denied' });
      }

      return ctx.prisma.$transaction(async (tx) => {
        await tx.supplyTransaction.create({
          data: {
            facilityId: input.facilityId,
            itemId: input.itemId,
            type: 'CONSUME',
            quantity: -input.quantity,
            referenceType: input.referenceType || null,
            referenceId: input.referenceId || null,
            notes: input.notes || null,
            createdBy: ctx.session.user.id,
          },
        });

        return tx.supplyItem.update({
          where: { id: input.itemId },
          data: { currentStock: { decrement: input.quantity } },
        });
      });
    }),

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  listCategories: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.supplyCategory.findMany({
        where: { facilityId: input.facilityId },
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { items: true } },
        },
      });
    }),

  createCategory: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      name: z.string().min(1),
      parentId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.supplyCategory.create({
        data: {
          facilityId: input.facilityId,
          name: input.name,
          parentId: input.parentId || null,
        },
      });
    }),

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  listTransactions: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      itemId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Prisma.SupplyTransactionWhereInput = {
        facilityId: input.facilityId,
      };
      if (input.itemId) where.itemId = input.itemId;

      return ctx.prisma.supplyTransaction.findMany({
        where,
        include: { item: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    }),

  // ---------------------------------------------------------------------------
  // Bill of Materials
  // ---------------------------------------------------------------------------

  listBOM: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      metrcItemName: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.billOfMaterial.findMany({
        where: {
          facilityId: input.facilityId,
          metrcItemName: input.metrcItemName,
        },
        include: { componentItem: true },
      });
    }),

  createBOMLine: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      metrcItemName: z.string(),
      metrcItemCategory: z.string().optional(),
      componentItemId: z.string(),
      quantityPerUnit: z.number().positive(),
      unit: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const component = await ctx.prisma.supplyItem.findFirst({
        where: { id: input.componentItemId, facilityId: input.facilityId },
      });
      if (!component) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Component item not found or access denied' });
      }

      return ctx.prisma.billOfMaterial.create({
        data: {
          facilityId: input.facilityId,
          metrcItemName: input.metrcItemName,
          metrcItemCategory: input.metrcItemCategory || null,
          componentItemId: input.componentItemId,
          quantityPerUnit: input.quantityPerUnit,
          unit: input.unit || 'Each',
          notes: input.notes || null,
        },
      });
    }),

  deleteBOMLine: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      bomLineId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.billOfMaterial.findFirst({
        where: { id: input.bomLineId, facilityId: input.facilityId },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'BOM line not found or access denied' });
      }
      return ctx.prisma.billOfMaterial.delete({
        where: { id: input.bomLineId },
      });
    }),

  // ---------------------------------------------------------------------------
  // Feasibility & Alerts
  // ---------------------------------------------------------------------------

  checkFeasibility: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      metrcItemName: z.string(),
      requestedQuantity: z.number().positive(),
    }))
    .query(async ({ ctx, input }) => {
      const bomEntries = await ctx.prisma.billOfMaterial.findMany({
        where: {
          facilityId: input.facilityId,
          metrcItemName: input.metrcItemName,
        },
        include: { componentItem: true },
      });

      const bomLines: BOMLine[] = bomEntries
        .filter((entry) => entry.componentItem !== null)
        .map((entry) => {
          const item = entry.componentItem!;
          return {
            componentItemId: entry.componentItemId!,
            componentName: item.name,
            quantityPerUnit: entry.quantityPerUnit,
            unit: entry.unit,
            currentStock: item.currentStock,
            unitCost: item.unitCost,
          };
        });

      // Metrc-to-Metrc BOM lines: no SupplyItem, zero stock placeholder.
      // Full Metrc inventory lookup is a future enhancement.
      const metrcBomLines: BOMLine[] = bomEntries
        .filter((entry) => entry.componentItem === null && entry.componentMetrcItemName != null)
        .map((entry) => ({
          componentItemId: entry.componentMetrcItemName!,
          componentName: entry.componentMetrcItemName!,
          quantityPerUnit: entry.quantityPerUnit,
          unit: entry.unit,
          currentStock: 0,
          unitCost: null,
        }));

      return checkFeasibility(
        input.metrcItemName,
        input.requestedQuantity,
        [...bomLines, ...metrcBomLines],
      );
    }),

  lowStockAlerts: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.supplyItem.findMany({
        where: {
          facilityId: input.facilityId,
          isActive: true,
          reorderPoint: { not: null },
        },
      });

      // Filter to items where currentStock < reorderPoint
      const lowStockItems = items.filter(
        (item) => item.reorderPoint != null && item.currentStock < item.reorderPoint,
      );

      return findLowStockItems(
        lowStockItems.map((item) => ({
          id: item.id,
          name: item.name,
          currentStock: item.currentStock,
          reorderPoint: item.reorderPoint,
          unit: item.unit,
          vendor: item.vendor,
        })),
      );
    }),

  // ---------------------------------------------------------------------------
  // BOM Management (new endpoints)
  // ---------------------------------------------------------------------------

  listAllBOMs: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.billOfMaterial.findMany({
        where: { facilityId: input.facilityId },
        include: { componentItem: true },
        orderBy: [{ metrcItemName: 'asc' }, { createdAt: 'asc' }],
      });
    }),

  inferBOMs: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const logs = await ctx.prisma.actionLog.findMany({
        where: {
          facilityId: input.facilityId,
          actionType: 'PROCESSING_CREATE',
          status: 'COMPLETED',
        },
        select: {
          previewData: true,
          status: true,
          actionType: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      const existingBOMs = await ctx.prisma.billOfMaterial.findMany({
        where: { facilityId: input.facilityId },
        select: { metrcItemName: true, componentMetrcItemName: true },
      });

      return inferBOMsFromHistory(
        logs.map((l) => ({
          previewData: l.previewData,
          status: l.status,
          actionType: l.actionType,
        })),
        existingBOMs,
      );
    }),

  approveSuggestedBOM: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      metrcItemName: z.string(),
      metrcItemCategory: z.string().optional(),
      componentMetrcItemName: z.string(),
      quantityPerUnit: z.number().positive(),
      unit: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.billOfMaterial.create({
        data: {
          facilityId: input.facilityId,
          metrcItemName: input.metrcItemName,
          metrcItemCategory: input.metrcItemCategory || null,
          componentMetrcItemName: input.componentMetrcItemName,
          quantityPerUnit: input.quantityPerUnit,
          unit: input.unit || 'Each',
          isAutoInferred: true,
          inferenceConfidence: 1.0,
        },
      });
    }),

  updateBOMLine: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      bomLineId: z.string(),
      quantityPerUnit: z.number().positive().optional(),
      unit: z.string().optional(),
      notes: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.billOfMaterial.findFirst({
        where: { id: input.bomLineId, facilityId: input.facilityId },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'BOM line not found or access denied' });
      }

      const updateData: Prisma.BillOfMaterialUpdateInput = {};
      if (input.quantityPerUnit !== undefined) updateData.quantityPerUnit = input.quantityPerUnit;
      if (input.unit !== undefined) updateData.unit = input.unit;
      if (input.notes !== undefined) updateData.notes = input.notes;

      return ctx.prisma.billOfMaterial.update({
        where: { id: input.bomLineId },
        data: updateData,
      });
    }),

  bulkCreateBOMLines: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      lines: z.array(z.object({
        metrcItemName: z.string(),
        metrcItemCategory: z.string().optional(),
        componentItemId: z.string().optional(),
        componentMetrcItemName: z.string().optional(),
        quantityPerUnit: z.number().positive(),
        unit: z.string().optional(),
        notes: z.string().optional(),
      })).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      // Validate exclusive component reference
      for (const line of input.lines) {
        const hasSupplyItem = !!line.componentItemId;
        const hasMetrcItem = !!line.componentMetrcItemName;
        if (!hasSupplyItem && !hasMetrcItem) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Line "${line.metrcItemName}": must specify componentItemId or componentMetrcItemName`,
          });
        }
      }

      const data = input.lines.map((line) => ({
        facilityId: input.facilityId,
        metrcItemName: line.metrcItemName,
        metrcItemCategory: line.metrcItemCategory || null,
        componentItemId: line.componentItemId || null,
        componentMetrcItemName: line.componentMetrcItemName || null,
        quantityPerUnit: line.quantityPerUnit,
        unit: line.unit || 'Each',
        notes: line.notes || null,
      }));

      const result = await ctx.prisma.billOfMaterial.createMany({
        data,
        skipDuplicates: true,
      });

      return { created: result.count, total: input.lines.length };
    }),
});
