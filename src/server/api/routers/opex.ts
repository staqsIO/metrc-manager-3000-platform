import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { createOpExEngine } from '@/services/engines/opex-engine';
import { getTemplateById, getTemplateForFacility, listTemplates as listAvailableTemplates, getRecommendedTemplateId } from '@/services/engines/template-registry';
import type { CellDefinition } from '@/services/engines/opex-engine';
import type { TemplateSection, TemplateCellGroup } from '@/services/engines/opex-templates';
import type { Prisma } from '@prisma/client';
import type { MetrcFacility } from '@prisma/client';

/**
 * Helper: create sections, groups, and cells from a template section list.
 * Extracted to avoid duplicating the 3-level creation loop.
 */
async function createSectionsFromTemplate(
  tx: Prisma.TransactionClient,
  modelId: string,
  sections: TemplateSection[],
) {
  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const sectionDef = sections[sIdx];

    const section = await tx.opExSection.create({
      data: {
        modelId,
        name: sectionDef.name,
        slug: sectionDef.slug,
        sortOrder: sIdx,
        icon: sectionDef.icon,
      },
    });

    await createGroupsFromTemplate(tx, section.id, modelId, sectionDef.groups);

    // Create sub-sections
    if (sectionDef.subSections) {
      for (let ssIdx = 0; ssIdx < sectionDef.subSections.length; ssIdx++) {
        const subDef = sectionDef.subSections[ssIdx];
        const subSection = await tx.opExSection.create({
          data: {
            modelId,
            name: subDef.name,
            slug: subDef.slug,
            sortOrder: sections.length + ssIdx,
            icon: subDef.icon,
            parentId: section.id,
          },
        });
        await createGroupsFromTemplate(tx, subSection.id, modelId, subDef.groups);
      }
    }
  }
}

async function createGroupsFromTemplate(
  tx: Prisma.TransactionClient,
  sectionId: string,
  modelId: string,
  groups: TemplateCellGroup[],
) {
  for (let gIdx = 0; gIdx < groups.length; gIdx++) {
    const groupDef = groups[gIdx];
    const group = await tx.opExCellGroup.create({
      data: {
        sectionId,
        label: groupDef.label,
        sortOrder: gIdx,
      },
    });

    const cellData = groupDef.cells.map((cell, cIdx) => ({
      groupId: group.id,
      modelId,
      key: cell.key,
      label: cell.label,
      cellType: cell.cellType,
      dataType: cell.dataType,
      value: cell.defaultValue ?? null,
      formula: cell.formula ?? null,
      dependsOn: cell.dependsOn ?? [],
      sortOrder: cIdx,
      unit: cell.unit ?? null,
      precision: cell.precision ?? 2,
      minValue: cell.minValue ?? null,
      maxValue: cell.maxValue ?? null,
      tooltip: cell.tooltip ?? null,
    }));

    if (cellData.length > 0) {
      await tx.opExCell.createMany({ data: cellData });
    }
  }
}

export const opexRouter = createTRPCRouter({
  /**
   * List all OpEx models for a facility.
   */
  listModels: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Prisma.OpExModelWhereInput = { facilityId: input.facilityId };
      if (input.status) where.status = input.status;

      return ctx.prisma.opExModel.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          version: true,
          isDefault: true,
          annualRevenue: true,
          annualCost: true,
          costPerPound: true,
          grossMargin: true,
          grossProfit: true,
          taxableProfit: true,
          sourceFile: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),

  /**
   * Get a full model with all sections, groups, and cells.
   */
  getModel: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      modelId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const model = await ctx.prisma.opExModel.findFirst({
        where: { id: input.modelId, facilityId: input.facilityId },
        include: {
          sections: {
            orderBy: { sortOrder: 'asc' },
            include: {
              children: {
                orderBy: { sortOrder: 'asc' },
                include: {
                  cellGroups: {
                    orderBy: { sortOrder: 'asc' },
                    include: {
                      cells: { orderBy: { sortOrder: 'asc' } },
                    },
                  },
                },
              },
              cellGroups: {
                orderBy: { sortOrder: 'asc' },
                include: {
                  cells: { orderBy: { sortOrder: 'asc' } },
                },
              },
            },
          },
        },
      });

      if (!model) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `OpEx model ${input.modelId} not found` });
      }

      return model;
    }),

  /**
   * Create a new OpEx model from the default cannabis template.
   */
  /**
   * List available templates for a facility.
   */
  listTemplates: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      const templates = await listAvailableTemplates();
      const recommended = getRecommendedTemplateId(facility.facilityType);
      return { templates, recommendedTemplateId: recommended };
    }),

  createModel: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      templateId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const template = input.templateId
        ? await getTemplateById(input.templateId)
        : await getTemplateForFacility(facility.facilityType);

      // Create model with sections, groups, and cells in a transaction
      // Extended timeout: templates create ~100 DB operations
      const model = await ctx.prisma.$transaction(async (tx) => {
        const newModel = await tx.opExModel.create({
          data: {
            facilityId: input.facilityId,
            name: input.name,
            description: input.description || template.description,
            status: 'DRAFT',
            kpiCells: template.kpiCells,
            createdBy: ctx.session.user.id,
          },
        });

        await createSectionsFromTemplate(tx, newModel.id, template.sections);

        // Log the creation
        await tx.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'OPEX_CREATE',
            status: 'COMPLETED',
            targetType: 'OPEX_MODEL',
            targetIds: [newModel.id],
            targetCount: 1,
            executedAt: new Date(),
          },
        });

        return newModel;
      }, { maxWait: 10000, timeout: 30000 });

      return model;
    }),

  /**
   * Archive (soft-delete) a model.
   */
  archiveModel: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      modelId: z.string(),
      confirmed: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const model = await ctx.prisma.opExModel.findFirst({
        where: { id: input.modelId, facilityId: input.facilityId },
      });

      if (!model) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `OpEx model ${input.modelId} not found` });
      }

      if (!input.confirmed) {
        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'OPEX_ARCHIVE',
            status: 'PREVIEWING',
            targetType: 'OPEX_MODEL',
            targetIds: [model.id],
            targetCount: 1,
            previewData: { modelName: model.name, currentStatus: model.status } as Prisma.InputJsonValue,
          },
        });
        return { status: 'preview' as const, preview: { id: model.id, name: model.name } };
      }

      await ctx.prisma.opExModel.update({
        where: { id: model.id },
        data: { status: 'ARCHIVED' },
      });

      await ctx.prisma.actionLog.create({
        data: {
          facilityId: input.facilityId,
          userId: ctx.session.user.id,
          actionType: 'OPEX_ARCHIVE',
          status: 'COMPLETED',
          targetType: 'OPEX_MODEL',
          targetIds: [model.id],
          targetCount: 1,
          executedAt: new Date(),
        },
      });

      return { status: 'completed' as const };
    }),

  /**
   * Duplicate an existing model.
   */
  duplicateModel: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      modelId: z.string(),
      newName: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.prisma.opExModel.findFirst({
        where: { id: input.modelId, facilityId: input.facilityId },
        include: {
          sections: {
            where: { parentId: null },
            orderBy: { sortOrder: 'asc' },
            include: {
              cellGroups: {
                orderBy: { sortOrder: 'asc' },
                include: { cells: { orderBy: { sortOrder: 'asc' } } },
              },
              children: {
                orderBy: { sortOrder: 'asc' },
                include: {
                  cellGroups: {
                    orderBy: { sortOrder: 'asc' },
                    include: { cells: { orderBy: { sortOrder: 'asc' } } },
                  },
                },
              },
            },
          },
        },
      });

      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `OpEx model ${input.modelId} not found` });
      }
      // Re-bind after null check so TS narrows inside the $transaction closure
      const sourceModel = source;

      const newModel = await ctx.prisma.$transaction(async (tx) => {
        const model = await tx.opExModel.create({
          data: {
            facilityId: input.facilityId,
            name: input.newName,
            description: sourceModel.description,
            status: 'DRAFT',
            kpiCells: sourceModel.kpiCells,
            createdBy: ctx.session.user.id,
          },
        });

        // Helper to clone cell groups and their cells
        async function cloneGroups(
          sourceSectionGroups: typeof sourceModel.sections[0]['cellGroups'],
          targetSectionId: string,
        ) {
          for (const group of sourceSectionGroups) {
            const newGroup = await tx.opExCellGroup.create({
              data: {
                sectionId: targetSectionId,
                label: group.label,
                sortOrder: group.sortOrder,
              },
            });

            const cellData = group.cells.map((cell) => ({
              groupId: newGroup.id,
              modelId: model.id,
              key: cell.key,
              label: cell.label,
              cellType: cell.cellType,
              dataType: cell.dataType,
              value: cell.value,
              textValue: cell.textValue,
              formula: cell.formula,
              dependsOn: cell.dependsOn,
              sortOrder: cell.sortOrder,
              unit: cell.unit,
              precision: cell.precision,
              minValue: cell.minValue,
              maxValue: cell.maxValue,
              tooltip: cell.tooltip,
            }));

            if (cellData.length > 0) {
              await tx.opExCell.createMany({ data: cellData });
            }
          }
        }

        // Clone sections, sub-sections, groups, and cells
        for (const section of sourceModel.sections) {
          const newSection = await tx.opExSection.create({
            data: {
              modelId: model.id,
              name: section.name,
              slug: section.slug,
              sortOrder: section.sortOrder,
              icon: section.icon,
            },
          });

          await cloneGroups(section.cellGroups, newSection.id);

          // Clone sub-sections (children)
          for (const child of section.children) {
            const newChild = await tx.opExSection.create({
              data: {
                modelId: model.id,
                name: child.name,
                slug: child.slug,
                sortOrder: child.sortOrder,
                icon: child.icon,
                parentId: newSection.id,
              },
            });

            await cloneGroups(child.cellGroups, newChild.id);
          }
        }

        await tx.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'OPEX_DUPLICATE',
            status: 'COMPLETED',
            targetType: 'OPEX_MODEL',
            targetIds: [model.id],
            targetCount: 1,
            executedAt: new Date(),
            metadata: { sourceModelId: input.modelId } as Prisma.InputJsonValue,
          },
        });

        return model;
      });

      return newModel;
    }),

  /**
   * Update a single cell value. Server recomputes the DAG to verify
   * and updates cached KPIs on the model.
   */
  updateCell: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      modelId: z.string(),
      cellId: z.string(),
      value: z.number().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const cell = await ctx.prisma.opExCell.findFirst({
        where: { id: input.cellId, modelId: input.modelId },
      });

      if (!cell) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Cell ${input.cellId} not found` });
      }

      if (cell.cellType !== 'INPUT') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only INPUT cells can be edited directly' });
      }

      // Wrap the entire read-modify-write in a transaction to prevent race conditions
      const result = await ctx.prisma.$transaction(async (tx) => {
        // Update cell value
        await tx.opExCell.update({
          where: { id: cell.id },
          data: { value: input.value },
        });

        // Fetch model for template-specific kpiCells
        const model = await tx.opExModel.findUniqueOrThrow({
          where: { id: input.modelId },
          select: { kpiCells: true },
        });

        // Recompute KPIs server-side
        const allCells = await tx.opExCell.findMany({
          where: { modelId: input.modelId },
        });

        const cellDefs: CellDefinition[] = allCells.map(c => ({
          key: c.key,
          cellType: c.cellType as 'INPUT' | 'COMPUTED' | 'CONSTANT',
          formula: c.formula,
          value: c.id === cell.id ? input.value : c.value,
        }));

        // Use model-stored kpiCells; fall back to cultivator defaults for legacy models
        const kpiCells = model.kpiCells.length > 0
          ? model.kpiCells
          : ['pnl.annual_revenue', 'pnl.total_annual_cost', 'pnl.cost_per_pound', 'pnl.gross_margin_pct', 'pnl.gross_profit', 'pnl.taxable_profit'];

        const engine = createOpExEngine();
        engine.buildGraph(cellDefs);
        engine.setKPICells(kpiCells);

        const evalResult = engine.evaluateAll();

        // Update cached KPIs on the model
        // kpiCells order: [revenue, cost, unit_cost, margin, profit, taxable_profit]
        await tx.opExModel.update({
          where: { id: input.modelId },
          data: {
            annualRevenue: evalResult.kpis[kpiCells[0]] ?? null,
            annualCost: evalResult.kpis[kpiCells[1]] ?? null,
            costPerPound: evalResult.kpis[kpiCells[2]] ?? null,
            grossMargin: evalResult.kpis[kpiCells[3]] ?? null,
            grossProfit: evalResult.kpis[kpiCells[4]] ?? null,
            taxableProfit: evalResult.kpis[kpiCells[5]] ?? null,
          },
        });

        // Update computed cell values in DB
        const computedUpdates = evalResult.updatedCells
          .filter(cv => cv.key !== cell.key)
          .map(cv => tx.opExCell.updateMany({
            where: { modelId: input.modelId, key: cv.key },
            data: { value: cv.value },
          }));

        if (computedUpdates.length > 0) {
          await Promise.all(computedUpdates);
        }

        return evalResult;
      }, { maxWait: 10000, timeout: 30000 });

      return {
        kpis: result.kpis,
        updatedCells: result.updatedCells,
      };
    }),

  /**
   * Batch update multiple cell values.
   */
  updateCells: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      modelId: z.string(),
      updates: z.array(z.object({
        cellId: z.string(),
        key: z.string(),
        value: z.number().nullable(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      // Wrap entire read-modify-write in a single transaction to prevent race conditions
      const result = await ctx.prisma.$transaction(async (tx) => {
        // Update all input cells
        const cellUpdates = input.updates.map(u =>
          tx.opExCell.updateMany({
            where: { id: u.cellId, modelId: input.modelId, cellType: 'INPUT' },
            data: { value: u.value },
          })
        );
        await Promise.all(cellUpdates);

        // Fetch model for template-specific kpiCells
        const model = await tx.opExModel.findUniqueOrThrow({
          where: { id: input.modelId },
          select: { kpiCells: true },
        });

        // Recompute full model
        const allCells = await tx.opExCell.findMany({
          where: { modelId: input.modelId },
        });

        const updateMap = new Map(input.updates.map(u => [u.key, u.value]));
        const cellDefs: CellDefinition[] = allCells.map(c => ({
          key: c.key,
          cellType: c.cellType as 'INPUT' | 'COMPUTED' | 'CONSTANT',
          formula: c.formula,
          value: updateMap.has(c.key) ? updateMap.get(c.key)! : c.value,
        }));

        // Use model-stored kpiCells; fall back to cultivator defaults for legacy models
        const kpiCells = model.kpiCells.length > 0
          ? model.kpiCells
          : ['pnl.annual_revenue', 'pnl.total_annual_cost', 'pnl.cost_per_pound', 'pnl.gross_margin_pct', 'pnl.gross_profit', 'pnl.taxable_profit'];

        const engine = createOpExEngine();
        engine.buildGraph(cellDefs);
        engine.setKPICells(kpiCells);

        const evalResult = engine.evaluateAll();

        // Update cached KPIs
        // kpiCells order: [revenue, cost, unit_cost, margin, profit, taxable_profit]
        await tx.opExModel.update({
          where: { id: input.modelId },
          data: {
            annualRevenue: evalResult.kpis[kpiCells[0]] ?? null,
            annualCost: evalResult.kpis[kpiCells[1]] ?? null,
            costPerPound: evalResult.kpis[kpiCells[2]] ?? null,
            grossMargin: evalResult.kpis[kpiCells[3]] ?? null,
            grossProfit: evalResult.kpis[kpiCells[4]] ?? null,
            taxableProfit: evalResult.kpis[kpiCells[5]] ?? null,
          },
        });

        // Update computed values
        const computedUpdates = evalResult.updatedCells
          .filter(cv => !updateMap.has(cv.key))
          .map(cv => tx.opExCell.updateMany({
            where: { modelId: input.modelId, key: cv.key },
            data: { value: cv.value },
          }));

        if (computedUpdates.length > 0) {
          await Promise.all(computedUpdates);
        }

        // Log batch update
        await tx.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'OPEX_UPDATE',
            status: 'COMPLETED',
            targetType: 'OPEX_MODEL',
            targetIds: [input.modelId],
            targetCount: input.updates.length,
            executedAt: new Date(),
          },
        });

        return evalResult;
      }, { maxWait: 10000, timeout: 30000 });

      return {
        kpis: result.kpis,
        updatedCells: result.updatedCells,
      };
    }),

  /**
   * Save a snapshot of the current model state.
   */
  saveSnapshot: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      modelId: z.string(),
      name: z.string().min(1).max(100),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [allCells, model] = await Promise.all([
        ctx.prisma.opExCell.findMany({ where: { modelId: input.modelId } }),
        ctx.prisma.opExModel.findUniqueOrThrow({
          where: { id: input.modelId },
          select: { kpiCells: true },
        }),
      ]);

      const cellDefs: CellDefinition[] = allCells.map(c => ({
        key: c.key,
        cellType: c.cellType as 'INPUT' | 'COMPUTED' | 'CONSTANT',
        formula: c.formula,
        value: c.value,
      }));

      // Use model-stored kpiCells; fall back to cultivator defaults for legacy models
      const kpiCells = model.kpiCells.length > 0
        ? model.kpiCells
        : ['pnl.annual_revenue', 'pnl.total_annual_cost', 'pnl.cost_per_pound', 'pnl.gross_margin_pct', 'pnl.gross_profit', 'pnl.taxable_profit'];

      const engine = createOpExEngine();
      engine.buildGraph(cellDefs);
      engine.setKPICells(kpiCells);

      const result = engine.evaluateAll();

      // Build cell data map
      const cellData: Record<string, number | null> = {};
      for (const cv of result.updatedCells) {
        cellData[cv.key] = cv.value;
      }

      const snapshot = await ctx.prisma.opExSnapshot.create({
        data: {
          modelId: input.modelId,
          name: input.name,
          notes: input.notes,
          cellData: cellData as Prisma.InputJsonValue,
          kpis: result.kpis as unknown as Prisma.InputJsonValue,
          createdBy: ctx.session.user.id,
        },
      });

      await ctx.prisma.actionLog.create({
        data: {
          facilityId: input.facilityId,
          userId: ctx.session.user.id,
          actionType: 'OPEX_SNAPSHOT',
          status: 'COMPLETED',
          targetType: 'OPEX_MODEL',
          targetIds: [input.modelId],
          targetCount: 1,
          executedAt: new Date(),
        },
      });

      return snapshot;
    }),

  /**
   * List snapshots for a model.
   */
  listSnapshots: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      modelId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.opExSnapshot.findMany({
        where: { modelId: input.modelId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          notes: true,
          kpis: true,
          createdBy: true,
          createdAt: true,
        },
      });
    }),

  /**
   * Search cells across all sections in a model.
   */
  searchCells: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      modelId: z.string(),
      query: z.string().min(1),
    }))
    .query(async ({ ctx, input }) => {
      const q = input.query.toLowerCase();
      const cells = await ctx.prisma.opExCell.findMany({
        where: { modelId: input.modelId },
        select: {
          id: true,
          key: true,
          label: true,
          value: true,
          unit: true,
          cellType: true,
          dataType: true,
          groupId: true,
        },
      });

      return cells.filter(c =>
        c.label.toLowerCase().includes(q) ||
        c.key.toLowerCase().includes(q)
      );
    }),

  /**
   * Import model from uploaded spreadsheet data.
   * The client sends the parsed import result (from opex-import.ts).
   */
  importModel: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      name: z.string().min(1).max(100),
      filename: z.string(),
      sections: z.array(z.object({
        name: z.string(),
        slug: z.string(),
        sortOrder: z.number(),
        groups: z.array(z.object({
          label: z.string(),
          cells: z.array(z.object({
            key: z.string(),
            label: z.string(),
            cellType: z.enum(['INPUT', 'COMPUTED', 'CONSTANT']),
            dataType: z.string(),
            value: z.number().nullable(),
            textValue: z.string().nullable(),
            formula: z.string().nullable(),
            dependsOn: z.array(z.string()),
            unit: z.string().nullable(),
            sourceSheet: z.string(),
            sourceCell: z.string(),
          })),
        })),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const model = await ctx.prisma.$transaction(async (tx) => {
        const newModel = await tx.opExModel.create({
          data: {
            facilityId: input.facilityId,
            name: input.name,
            status: 'DRAFT',
            sourceFile: input.filename,
            importedAt: new Date(),
            createdBy: ctx.session.user.id,
          },
        });

        for (const sectionDef of input.sections) {
          const section = await tx.opExSection.create({
            data: {
              modelId: newModel.id,
              name: sectionDef.name,
              slug: sectionDef.slug,
              sortOrder: sectionDef.sortOrder,
            },
          });

          for (let gIdx = 0; gIdx < sectionDef.groups.length; gIdx++) {
            const groupDef = sectionDef.groups[gIdx];
            const group = await tx.opExCellGroup.create({
              data: {
                sectionId: section.id,
                label: groupDef.label,
                sortOrder: gIdx,
              },
            });

            const cellData = groupDef.cells.map((cell, cIdx) => ({
              groupId: group.id,
              modelId: newModel.id,
              key: cell.key,
              label: cell.label,
              cellType: cell.cellType,
              dataType: cell.dataType,
              value: cell.value,
              textValue: cell.textValue,
              formula: cell.formula,
              dependsOn: cell.dependsOn,
              sortOrder: cIdx,
              unit: cell.unit,
              sourceSheet: cell.sourceSheet,
              sourceCell: cell.sourceCell,
            }));

            if (cellData.length > 0) {
              await tx.opExCell.createMany({ data: cellData });
            }
          }
        }

        await tx.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'OPEX_IMPORT',
            status: 'COMPLETED',
            targetType: 'OPEX_MODEL',
            targetIds: [newModel.id],
            targetCount: 1,
            executedAt: new Date(),
            metadata: { filename: input.filename } as Prisma.InputJsonValue,
          },
        });

        return newModel;
      });

      return model;
    }),
});
