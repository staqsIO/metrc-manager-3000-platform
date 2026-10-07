import { z } from 'zod';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import {
  executeReportFromRows,
  generateCSV,
  getColumnsForType,
  packageToRow,
  harvestToRow,
  plantToRow,
  supplyItemToRow,
  tollingBatchToRow,
  opexCellToRow,
  type ReportColumn,
  type ReportFilter,
  type ReportRow,
  type ReportSort,
  type ReportType,
  type SupplyItemForReport,
  type TollingBatchForReport,
} from '@/services/engines/report-engine';
import type { PrismaClient, Prisma } from '@prisma/client';
import {
  getActivePackagesFromDb,
  getAllHarvestsFromDb,
  getActivePlantsFromDb,
} from '@/services/metrc/snapshot-utils';

// ---------------------------------------------------------------------------
// Shared zod enums
// ---------------------------------------------------------------------------

const reportTypeEnum = z.enum(['INVENTORY', 'HARVEST', 'PLANT', 'SUPPLY', 'TOLLING', 'OPEX']);

const columnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['string', 'number', 'date', 'boolean']),
});

const filterSchema = z.object({
  column: z.string(),
  operator: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'in']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});

const sortSchema = z.object({
  column: z.string(),
  direction: z.enum(['asc', 'desc']),
});

// ---------------------------------------------------------------------------
// fetchReportRows — dispatches to the right data source per report type
// ---------------------------------------------------------------------------

async function fetchReportRows(
  reportType: ReportType,
  facilityId: string,
  prisma: PrismaClient,
  modelId?: string,
): Promise<ReportRow[]> {
  switch (reportType) {
    case 'INVENTORY': {
      const packages = await getActivePackagesFromDb(prisma, facilityId);
      return packages.map(packageToRow);
    }

    case 'HARVEST': {
      const { active, onHold, inactive } = await getAllHarvestsFromDb(prisma, facilityId);
      return [...active, ...onHold, ...inactive].map(harvestToRow);
    }

    case 'PLANT': {
      const plants = await getActivePlantsFromDb(prisma, facilityId);
      return plants.map(plantToRow);
    }

    case 'SUPPLY': {
      const items = await prisma.supplyItem.findMany({
        where: { facilityId },
        include: { category: { select: { name: true } } },
        orderBy: { name: 'asc' },
      });
      return items.map(item => supplyItemToRow(item as unknown as SupplyItemForReport));
    }

    case 'TOLLING': {
      const batches = await prisma.tollingBatch.findMany({
        where: { facilityId },
        include: {
          agreement: {
            select: { partnerName: true, agreementType: true },
          },
        },
        orderBy: { startedAt: 'desc' },
      });
      return batches.map(b => tollingBatchToRow(b as unknown as TollingBatchForReport));
    }

    case 'OPEX': {
      const whereClause: { facilityId: string; status?: string; id?: string } = { facilityId };
      if (modelId) {
        whereClause.id = modelId;
      } else {
        whereClause.status = 'ACTIVE';
      }
      const model = await prisma.opExModel.findFirst({
        where: whereClause,
        include: {
          sections: {
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
        },
      });
      if (!model) return [];
      return model.sections.flatMap(s =>
        s.cellGroups.flatMap(g =>
          g.cells.map(c => opexCellToRow(c, s.name, g.label))
        )
      );
    }

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const reportsRouter = createTRPCRouter({
  availableColumns: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      reportType: reportTypeEnum.default('INVENTORY'),
    }))
    .query(({ input }) => {
      return getColumnsForType(input.reportType);
    }),

  execute: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      reportType: reportTypeEnum.default('INVENTORY'),
      modelId: z.string().optional(),
      columns: z.array(columnSchema),
      filters: z.array(filterSchema).default([]),
      groupBy: z.array(z.string()).default([]),
      sortBy: z.array(sortSchema).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const rows = await fetchReportRows(
        input.reportType,
        input.facilityId,
        ctx.prisma as unknown as PrismaClient,
        input.modelId,
      );
      return executeReportFromRows(rows, {
        columns: input.columns as ReportColumn[],
        filters: input.filters as ReportFilter[],
        groupBy: input.groupBy,
        sortBy: input.sortBy as ReportSort[],
      });
    }),

  exportCSV: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      reportType: reportTypeEnum.default('INVENTORY'),
      modelId: z.string().optional(),
      columns: z.array(columnSchema),
      filters: z.array(filterSchema).default([]),
      groupBy: z.array(z.string()).default([]),
      sortBy: z.array(sortSchema).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const rows = await fetchReportRows(
        input.reportType,
        input.facilityId,
        ctx.prisma as unknown as PrismaClient,
        input.modelId,
      );
      const result = executeReportFromRows(rows, {
        columns: input.columns as ReportColumn[],
        filters: input.filters as ReportFilter[],
        groupBy: input.groupBy,
        sortBy: input.sortBy as ReportSort[],
      });
      return { csv: generateCSV(result), totalRows: result.totalRows };
    }),

  saveTemplate: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      name: z.string(),
      description: z.string().optional(),
      reportType: reportTypeEnum.default('INVENTORY'),
      columns: z.array(columnSchema),
      filters: z.array(filterSchema).default([]),
      groupBy: z.array(z.string()).default([]),
      sortBy: z.array(sortSchema).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.reportTemplate.create({
        data: {
          facilityId: input.facilityId,
          name: input.name,
          description: input.description || null,
          reportType: input.reportType,
          columns: input.columns as unknown as Prisma.InputJsonValue,
          filters: input.filters as unknown as Prisma.InputJsonValue,
          groupBy: input.groupBy,
          sortBy: input.sortBy as unknown as Prisma.InputJsonValue,
          createdBy: ctx.session.user.id,
        },
      });
    }),

  listTemplates: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      reportType: reportTypeEnum.optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: { facilityId: string; reportType?: string } = { facilityId: input.facilityId };
      if (input.reportType) {
        where.reportType = input.reportType;
      }
      return ctx.prisma.reportTemplate.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
      });
    }),

  deleteTemplate: facilityWriteProcedure
    .input(z.object({ facilityId: z.string(), templateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.reportTemplate.delete({
        where: { id: input.templateId },
      });
    }),
});
