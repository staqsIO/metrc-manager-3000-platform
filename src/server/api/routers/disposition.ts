import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import {
  type DispositionCategory,
  type DispositionRecordData,
  toPolicyData,
  computeMonthlyUsage,
  buildDispositionSummary,
  validateDisposition,
} from '@/services/engines/disposition-engine';

const categorySchema = z.enum(['sample', 'vendor_day', 'promo', 'damage', 'waste']);

const categoryLimitSchema = z.object({
  units: z.number().min(0).nullable(),
  value: z.number().min(0).nullable(),
});

// --- Router ---

export const dispositionRouter = createTRPCRouter({
  /**
   * Get the disposition policy for a facility.
   * Returns defaults if no policy row exists (no auto-create side effect).
   */
  getPolicy: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const policy = await ctx.prisma.dispositionPolicy.findUnique({
        where: { facilityId: input.facilityId },
      });

      const data = toPolicyData(policy);

      return {
        id: policy?.id ?? null,
        facilityId: input.facilityId,
        isEnabled: data.isEnabled,
        categoryLimits: data.categoryLimits,
        allowBudgetOverride: data.allowBudgetOverride,
        requireNote: data.requireNote,
        alertThreshold: data.alertThreshold,
      };
    }),

  /**
   * Update disposition policy for a facility (ADMIN/OPERATOR only).
   * Creates the policy row if it doesn't exist (upsert).
   */
  updatePolicy: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      isEnabled: z.boolean().optional(),
      categoryLimits: z.record(categorySchema, categoryLimitSchema).optional(),
      allowBudgetOverride: z.boolean().optional(),
      requireNote: z.boolean().optional(),
      alertThreshold: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { facilityId, categoryLimits, ...updates } = input;

      const data = {
        ...updates,
        ...(categoryLimits !== undefined
          ? { categoryLimits: categoryLimits as unknown as Prisma.InputJsonValue }
          : {}),
      };

      return ctx.prisma.dispositionPolicy.upsert({
        where: { facilityId },
        create: { facilityId, ...data },
        update: data,
      });
    }),

  /**
   * Record a disposition (sample-out, vendor day, promo, damage, waste).
   * Follows Preview → Confirm → Execute pattern via `confirmed` flag.
   * Budget check + record creation are wrapped in a transaction for atomicity.
   */
  create: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      packageLabel: z.string().min(1),
      category: categorySchema,
      quantity: z.number().positive(),
      unitOfMeasure: z.string().min(1),
      estimatedValue: z.number().min(0).default(0),
      recipientName: z.string().optional(),
      note: z.string().optional(),
      metrcAdjustmentReason: z.string().optional(),
      confirmed: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Load policy
      const policy = await ctx.prisma.dispositionPolicy.findUnique({
        where: { facilityId: input.facilityId },
      });
      const policyData = toPolicyData(policy);

      if (!policyData.isEnabled) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Disposition tracking is disabled for this facility.',
        });
      }

      if (policyData.requireNote && !input.note) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A note is required for dispositions at this facility.',
        });
      }

      // Get current month usage for budget validation
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const records = await ctx.prisma.dispositionRecord.findMany({
        where: {
          facilityId: input.facilityId,
          createdAt: {
            gte: new Date(now.getFullYear(), now.getMonth(), 1),
            lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
          },
          status: 'COMPLETED',
        },
      });

      const currentUsage = computeMonthlyUsage(
        records.map(r => ({
          category: r.category as DispositionCategory,
          quantity: r.quantity,
          estimatedValue: r.estimatedValue,
          createdAt: r.createdAt,
        })),
        month,
      );

      const validation = validateDisposition(
        input.category,
        input.quantity,
        input.estimatedValue,
        currentUsage,
        policyData,
      );

      if (!input.confirmed) {
        // Preview mode — no transaction needed, just log
        const actionLog = await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'DISPOSITION',
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: [input.packageLabel],
            targetCount: 1,
            previewData: {
              category: input.category,
              quantity: input.quantity,
              unitOfMeasure: input.unitOfMeasure,
              estimatedValue: input.estimatedValue,
              recipientName: input.recipientName,
              note: input.note,
              validation,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        return {
          status: 'preview' as const,
          actionLogId: actionLog.id,
          validation,
          preview: {
            packageLabel: input.packageLabel,
            category: input.category,
            quantity: input.quantity,
            unitOfMeasure: input.unitOfMeasure,
            estimatedValue: input.estimatedValue,
            recipientName: input.recipientName,
            note: input.note,
            budgetAllowed: validation.allowed,
            budgetReason: validation.reason,
          },
        };
      }

      // Execute mode — atomic transaction: re-check budget + create record + log
      const result = await ctx.prisma.$transaction(async (tx) => {
        // Re-read usage inside transaction for atomicity
        const txRecords = await tx.dispositionRecord.findMany({
          where: {
            facilityId: input.facilityId,
            createdAt: {
              gte: new Date(now.getFullYear(), now.getMonth(), 1),
              lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
            },
            status: 'COMPLETED',
          },
        });

        const txUsage = computeMonthlyUsage(
          txRecords.map(r => ({
            category: r.category as DispositionCategory,
            quantity: r.quantity,
            estimatedValue: r.estimatedValue,
            createdAt: r.createdAt,
          })),
          month,
        );

        const txValidation = validateDisposition(
          input.category,
          input.quantity,
          input.estimatedValue,
          txUsage,
          policyData,
        );

        if (!txValidation.allowed && !policyData.allowBudgetOverride) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: txValidation.reason ?? 'Budget limit exceeded.',
          });
        }

        const record = await tx.dispositionRecord.create({
          data: {
            facilityId: input.facilityId,
            packageLabel: input.packageLabel,
            category: input.category,
            quantity: input.quantity,
            unitOfMeasure: input.unitOfMeasure,
            estimatedValue: input.estimatedValue,
            recipientName: input.recipientName ?? null,
            note: input.note ?? null,
            metrcAdjustmentReason: input.metrcAdjustmentReason ?? null,
            status: 'COMPLETED',
            createdBy: ctx.session.user.id,
          },
        });

        await tx.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'DISPOSITION',
            status: 'COMPLETED',
            targetType: 'PACKAGE',
            targetIds: [input.packageLabel],
            targetCount: 1,
            executedAt: new Date(),
            metadata: {
              category: input.category,
              quantity: input.quantity,
              estimatedValue: input.estimatedValue,
              dispositionRecordId: record.id,
              budgetExceeded: !txValidation.allowed,
              budgetOverrideUsed: !txValidation.allowed && policyData.allowBudgetOverride,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        return { record, validation: txValidation };
      });

      return {
        status: 'completed' as const,
        record: result.record,
        validation: result.validation,
      };
    }),

  /**
   * List disposition records for a facility (paginated, filterable).
   */
  list: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      category: categorySchema.optional(),
      status: z.enum(['COMPLETED', 'REVERSED']).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Prisma.DispositionRecordWhereInput = {
        facilityId: input.facilityId,
        ...(input.category ? { category: input.category } : {}),
        ...(input.status ? { status: input.status } : {}),
      };

      const records = await ctx.prisma.dispositionRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (records.length > input.limit) {
        const next = records.pop();
        nextCursor = next?.id;
      }

      return { records, nextCursor };
    }),

  /**
   * Get monthly disposition summary with budget status.
   */
  summary: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const month = input.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const [yearStr, monthStr] = month.split('-');
      const year = parseInt(yearStr, 10);
      const mon = parseInt(monthStr, 10);

      const [policy, records] = await Promise.all([
        ctx.prisma.dispositionPolicy.findUnique({
          where: { facilityId: input.facilityId },
        }),
        ctx.prisma.dispositionRecord.findMany({
          where: {
            facilityId: input.facilityId,
            status: 'COMPLETED',
            createdAt: {
              gte: new Date(year, mon - 1, 1),
              lt: new Date(year, mon, 1),
            },
          },
        }),
      ]);

      const policyData = toPolicyData(policy);

      const recordData: DispositionRecordData[] = records.map(r => ({
        category: r.category as DispositionCategory,
        quantity: r.quantity,
        estimatedValue: r.estimatedValue,
        createdAt: r.createdAt,
      }));

      return buildDispositionSummary(recordData, policyData, month);
    }),

  /**
   * Reverse a completed disposition record.
   * Follows Preview → Confirm → Execute pattern via `confirmed` flag.
   * Update + ActionLog wrapped in a transaction for atomicity.
   */
  reverse: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      recordId: z.string(),
      reason: z.string().min(1),
      confirmed: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const record = await ctx.prisma.dispositionRecord.findFirst({
        where: { id: input.recordId, facilityId: input.facilityId },
      });

      if (!record) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Disposition record not found' });
      }
      if (record.status !== 'COMPLETED') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Record is in "${record.status}" status, expected COMPLETED`,
        });
      }

      if (!input.confirmed) {
        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'DISPOSITION',
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: [record.packageLabel],
            targetCount: 1,
            previewData: {
              action: 'reverse',
              recordId: record.id,
              category: record.category,
              quantity: record.quantity,
              estimatedValue: record.estimatedValue,
              packageLabel: record.packageLabel,
              reason: input.reason,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        return {
          status: 'preview' as const,
          record: {
            id: record.id,
            packageLabel: record.packageLabel,
            category: record.category,
            quantity: record.quantity,
            estimatedValue: record.estimatedValue,
            unitOfMeasure: record.unitOfMeasure,
            recipientName: record.recipientName,
            note: record.note,
          },
        };
      }

      // Execute — atomic transaction with TOCTOU re-check
      const result = await ctx.prisma.$transaction(async (tx) => {
        const txRecord = await tx.dispositionRecord.findFirst({
          where: { id: input.recordId, facilityId: input.facilityId },
        });

        if (!txRecord || txRecord.status !== 'COMPLETED') {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Record is no longer in COMPLETED status.',
          });
        }

        const updated = await tx.dispositionRecord.update({
          where: { id: txRecord.id },
          data: { status: 'REVERSED' },
        });

        await tx.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'DISPOSITION',
            status: 'ROLLED_BACK',
            targetType: 'PACKAGE',
            targetIds: [txRecord.packageLabel],
            targetCount: 1,
            executedAt: new Date(),
            metadata: {
              dispositionRecordId: txRecord.id,
              reversalReason: input.reason,
              originalCategory: txRecord.category,
              originalQuantity: txRecord.quantity,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        return updated;
      });

      return { status: 'completed' as const, record: result };
    }),
});
