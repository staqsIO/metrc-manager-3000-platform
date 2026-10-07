import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import {
  calculateLaborCost,
  aggregateLaborBySKU,
  rollupSKUCost,
  type LaborEntry,
} from '@/services/engines/labor-engine';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVITY_TYPES = [
  'FILLING',
  'EXTRACTION',
  'PACKAGING',
  'TRIMMING',
  'PLANTING',
  'HARVESTING',
  'CURING',
  'DRYING',
  'QA',
  'OTHER',
] as const;

const activityTypeEnum = z.enum(ACTIVITY_TYPES);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const laborRouter = createTRPCRouter({
  // ----- Employees -----

  listEmployees: facilityProcedure
    .input(
      z.object({
        facilityId: z.string(),
        includeInactive: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.EmployeeWhereInput = {
        facilityId: input.facilityId,
      };
      if (!input.includeInactive) {
        where.isActive = true;
      }
      return ctx.prisma.employee.findMany({
        where,
        orderBy: { name: 'asc' },
      });
    }),

  createEmployee: facilityWriteProcedure
    .input(
      z.object({
        facilityId: z.string(),
        name: z.string().min(1).max(200),
        role: z.string().max(100).optional(),
        hourlyRate: z.number().min(0).max(1000),
        notes: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const employee = await ctx.prisma.employee.create({
        data: {
          facilityId: input.facilityId,
          name: input.name,
          role: input.role ?? null,
          hourlyRate: input.hourlyRate,
          notes: input.notes ?? null,
        },
      });

      await ctx.prisma.actionLog.create({
        data: {
          facilityId: input.facilityId,
          userId: ctx.session.user.id,
          actionType: 'CREATE_EMPLOYEE',
          status: 'COMPLETED',
          targetType: 'EMPLOYEE',
          targetIds: [employee.id],
          targetCount: 1,
          executedAt: new Date(),
        },
      });

      return employee;
    }),

  updateEmployee: facilityWriteProcedure
    .input(
      z.object({
        facilityId: z.string(),
        employeeId: z.string(),
        name: z.string().min(1).max(200).optional(),
        role: z.string().max(100).optional(),
        hourlyRate: z.number().min(0).max(1000).optional(),
        notes: z.string().max(500).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.employee.findFirst({
        where: { id: input.employeeId, facilityId: input.facilityId },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Employee not found' });
      }

      const data: Prisma.EmployeeUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.role !== undefined) data.role = input.role;
      if (input.hourlyRate !== undefined) data.hourlyRate = input.hourlyRate;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.isActive !== undefined) data.isActive = input.isActive;

      return ctx.prisma.employee.update({
        where: { id: input.employeeId },
        data,
      });
    }),

  deleteEmployee: facilityWriteProcedure
    .input(
      z.object({
        facilityId: z.string(),
        employeeId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.employee.findFirst({
        where: { id: input.employeeId, facilityId: input.facilityId },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Employee not found' });
      }

      return ctx.prisma.employee.update({
        where: { id: input.employeeId },
        data: { isActive: false },
      });
    }),

  // ----- Quick Calculator -----

  quickCalc: facilityProcedure
    .input(
      z.object({
        facilityId: z.string(),
        hoursWorked: z.number().min(0),
        hourlyRate: z.number().min(0).max(1000),
        batchSize: z.number().int().min(0),
      }),
    )
    .query(({ input }) => {
      return calculateLaborCost({
        hoursWorked: input.hoursWorked,
        hourlyRate: input.hourlyRate,
        batchSize: input.batchSize,
      });
    }),

  // ----- Work Logs -----

  createWorkLog: facilityWriteProcedure
    .input(
      z.object({
        facilityId: z.string(),
        employeeId: z.string().optional(),
        activityType: activityTypeEnum,
        hoursWorked: z.number().min(0.01).max(24),
        hourlyRate: z.number().min(0).max(1000),
        unitsProduced: z.number().int().min(0).optional(),
        skuName: z.string().optional(),
        description: z.string().optional(),
        workDate: z.date().optional(),
        notes: z.string().optional(),
        metrcBatchId: z.string().optional(),
        tollingBatchId: z.string().optional(),
        packageLabel: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const laborCost = input.hoursWorked * input.hourlyRate;
      const costPerUnit =
        input.unitsProduced && input.unitsProduced > 0
          ? laborCost / input.unitsProduced
          : null;

      let rateSource = 'manual';
      if (input.employeeId) {
        const employee = await ctx.prisma.employee.findFirst({
          where: { id: input.employeeId, facilityId: input.facilityId },
        });
        if (employee) {
          rateSource = 'employee_snapshot';
        }
      }

      const workLog = await ctx.prisma.workLog.create({
        data: {
          facilityId: input.facilityId,
          employeeId: input.employeeId ?? null,
          activityType: input.activityType,
          hoursWorked: input.hoursWorked,
          hourlyRate: input.hourlyRate,
          laborCost,
          unitsProduced: input.unitsProduced ?? null,
          costPerUnit,
          skuName: input.skuName ?? null,
          description: input.description ?? null,
          workDate: input.workDate ?? new Date(),
          notes: input.notes ?? null,
          metrcBatchId: input.metrcBatchId ?? null,
          tollingBatchId: input.tollingBatchId ?? null,
          packageLabel: input.packageLabel ?? null,
          rateSource,
          createdBy: ctx.session.user.id,
        },
      });

      await ctx.prisma.actionLog.create({
        data: {
          facilityId: input.facilityId,
          userId: ctx.session.user.id,
          actionType: 'LABOR_LOG',
          status: 'COMPLETED',
          targetType: 'WORK_LOG',
          targetIds: [workLog.id],
          targetCount: 1,
          executedAt: new Date(),
        },
      });

      return workLog;
    }),

  listWorkLogs: facilityProcedure
    .input(
      z.object({
        facilityId: z.string(),
        employeeId: z.string().optional(),
        skuName: z.string().optional(),
        activityType: activityTypeEnum.optional(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        limit: z.number().min(1).max(200).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.WorkLogWhereInput = {
        facilityId: input.facilityId,
      };
      if (input.employeeId) where.employeeId = input.employeeId;
      if (input.skuName) where.skuName = input.skuName;
      if (input.activityType) where.activityType = input.activityType;
      if (input.dateFrom || input.dateTo) {
        where.workDate = {};
        if (input.dateFrom) where.workDate.gte = input.dateFrom;
        if (input.dateTo) where.workDate.lte = input.dateTo;
      }

      const items = await ctx.prisma.workLog.findMany({
        where,
        orderBy: { workDate: 'desc' },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: { employee: { select: { id: true, name: true } } },
      });

      let nextCursor: string | undefined;
      if (items.length > input.limit) {
        const next = items.pop();
        nextCursor = next?.id;
      }

      return { items, nextCursor };
    }),

  // ----- Aggregations -----

  laborBySKU: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const logs = await ctx.prisma.workLog.findMany({
        where: { facilityId: input.facilityId },
        include: { employee: { select: { id: true, name: true } } },
      });

      const entries: LaborEntry[] = logs.map((l) => ({
        hoursWorked: l.hoursWorked,
        hourlyRate: l.hourlyRate,
        laborCost: l.laborCost,
        unitsProduced: l.unitsProduced,
        costPerUnit: l.costPerUnit,
        skuName: l.skuName,
        activityType: l.activityType,
        workDate: l.workDate,
        employeeId: l.employeeId,
        employeeName: l.employee?.name ?? null,
      }));

      return aggregateLaborBySKU(entries);
    }),

  skuCostRollup: facilityProcedure
    .input(
      z.object({
        facilityId: z.string(),
        skuName: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const logs = await ctx.prisma.workLog.findMany({
        where: { facilityId: input.facilityId, skuName: input.skuName },
      });

      const entries: LaborEntry[] = logs.map((l) => ({
        hoursWorked: l.hoursWorked,
        hourlyRate: l.hourlyRate,
        laborCost: l.laborCost,
        unitsProduced: l.unitsProduced,
        costPerUnit: l.costPerUnit,
        skuName: l.skuName,
        activityType: l.activityType,
        workDate: l.workDate,
        employeeId: l.employeeId,
      }));

      // Fetch BOM data for supply/material cost estimates
      const bom = await ctx.prisma.billOfMaterial.findMany({
        where: { facilityId: input.facilityId, metrcItemName: input.skuName },
        include: { componentItem: true },
      });

      let supplyCost = 0;
      for (const line of bom) {
        if (line.componentItem?.unitCost) {
          supplyCost += line.quantityPerUnit * line.componentItem.unitCost;
        }
      }

      const totalUnitsFromLogs = logs.reduce((sum, l) => sum + (l.unitsProduced ?? 0), 0);

      return rollupSKUCost({
        skuName: input.skuName,
        materialCost: 0, // No Metrc material cost data available yet
        supplyCost: supplyCost * totalUnitsFromLogs,
        laborEntries: entries,
        consumablesPerUnit: 0,
        packagingPerUnit: 0,
        totalUnits: totalUnitsFromLogs,
      });
    }),
});
