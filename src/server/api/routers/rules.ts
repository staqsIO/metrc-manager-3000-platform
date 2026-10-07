import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import type { MetrcFacility, Prisma } from '@prisma/client';
import { DEFAULT_RULES } from '@/services/engines/default-rules';

const stateCodeSchema = z.string().length(2).regex(/^[A-Z]{2}$/).optional();

const conditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'contains', 'not_contains', 'in', 'not_in']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  itemCategory: z.string().optional(),
});

/**
 * Filter DEFAULT_RULES to include only rules applicable to a given facility state.
 * Rules with no stateCode are universal; rules with a stateCode are only included
 * when the facility's stateCode matches.
 */
function filterRulesForState(facilityState: string | undefined) {
  return DEFAULT_RULES.filter(rule =>
    !rule.stateCode || rule.stateCode === facilityState
  );
}

export const rulesRouter = createTRPCRouter({
  list: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      category: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Prisma.BusinessRuleWhereInput = { facilityId: input.facilityId };
      if (input.category) where.category = input.category;
      if (input.isActive !== undefined) where.isActive = input.isActive;

      return ctx.prisma.businessRule.findMany({
        where,
        orderBy: [{ category: 'asc' }, { severity: 'asc' }, { name: 'asc' }],
      });
    }),

  getById: facilityProcedure
    .input(z.object({ facilityId: z.string(), ruleId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.businessRule.findFirst({
        where: { id: input.ruleId, facilityId: input.facilityId },
      });
    }),

  create: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      name: z.string().min(1).max(200),
      description: z.string().optional(),
      category: z.string(),
      severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
      conditions: z.array(conditionSchema).min(1),
      actionType: z.enum(['ALERT', 'NOTIFICATION', 'BLOCK', 'DISCOUNT_RECOMMEND', 'AUTO_DISCOUNT', 'PROMO_FLAG', 'CONSOLIDATE', 'SAMPLE_OUT']).default('ALERT'),
      actionParams: z.record(z.unknown()).optional(),
      metadata: z.record(z.unknown()).optional(),
      stateCode: stateCodeSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.businessRule.create({
        data: {
          facilityId: input.facilityId,
          name: input.name,
          description: input.description,
          category: input.category,
          severity: input.severity,
          conditions: input.conditions as unknown as Prisma.InputJsonValue,
          actionType: input.actionType,
          actionParams: input.actionParams as Prisma.InputJsonValue ?? undefined,
          metadata: input.metadata as Prisma.InputJsonValue ?? undefined,
          stateCode: input.stateCode,
          isDefault: false,
          isActive: true,
        },
      });
    }),

  update: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      ruleId: z.string(),
      name: z.string().min(1).max(200).optional(),
      description: z.string().optional(),
      severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
      conditions: z.array(conditionSchema).min(1).optional(),
      isActive: z.boolean().optional(),
      actionType: z.enum(['ALERT', 'NOTIFICATION', 'BLOCK', 'DISCOUNT_RECOMMEND', 'AUTO_DISCOUNT', 'PROMO_FLAG', 'CONSOLIDATE', 'SAMPLE_OUT']).optional(),
      actionParams: z.record(z.unknown()).optional(),
      stateCode: stateCodeSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const data: Prisma.BusinessRuleUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      if (input.severity !== undefined) data.severity = input.severity;
      if (input.conditions !== undefined) data.conditions = input.conditions as unknown as Prisma.InputJsonValue;
      if (input.isActive !== undefined) data.isActive = input.isActive;
      if (input.actionType !== undefined) data.actionType = input.actionType;
      if (input.actionParams !== undefined) data.actionParams = input.actionParams as Prisma.InputJsonValue;
      if (input.stateCode !== undefined) data.stateCode = input.stateCode;

      // Compound WHERE ensures facilityId scoping (prevents cross-facility updates)
      const result = await ctx.prisma.businessRule.updateMany({
        where: { id: input.ruleId, facilityId: input.facilityId },
        data: data as Prisma.BusinessRuleUpdateManyMutationInput,
      });

      if (result.count === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found in this facility' });
      }

      return ctx.prisma.businessRule.findFirst({
        where: { id: input.ruleId, facilityId: input.facilityId },
      });
    }),

  delete: facilityWriteProcedure
    .input(z.object({ facilityId: z.string(), ruleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Compound WHERE ensures facilityId scoping (prevents cross-facility deletes)
      const result = await ctx.prisma.businessRule.deleteMany({
        where: { id: input.ruleId, facilityId: input.facilityId },
      });

      if (result.count === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found in this facility' });
      }

      return { success: true };
    }),

  toggleActive: facilityWriteProcedure
    .input(z.object({ facilityId: z.string(), ruleId: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      // Compound WHERE ensures facilityId scoping
      const result = await ctx.prisma.businessRule.updateMany({
        where: { id: input.ruleId, facilityId: input.facilityId },
        data: { isActive: input.isActive },
      });

      if (result.count === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found in this facility' });
      }

      return ctx.prisma.businessRule.findFirst({
        where: { id: input.ruleId, facilityId: input.facilityId },
      });
    }),

  seedDefaults: facilityWriteProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.businessRule.count({
        where: { facilityId: input.facilityId, isDefault: true },
      });

      if (existing > 0) {
        return { seeded: 0, message: 'Default rules already exist' };
      }

      const facility = ctx.facility as MetrcFacility;
      const applicableRules = filterRulesForState(facility.stateCode);

      await ctx.prisma.businessRule.createMany({
        data: applicableRules.map(rule => ({
          facilityId: input.facilityId,
          name: rule.name,
          description: rule.description,
          category: rule.category,
          severity: rule.severity,
          conditions: rule.conditions as unknown as Prisma.InputJsonValue,
          actionType: rule.actionType,
          actionParams: (rule.actionParams as Prisma.InputJsonValue) ?? undefined,
          metadata: rule.metadata as Prisma.InputJsonValue ?? undefined,
          stateCode: rule.stateCode ?? null,
          isDefault: true,
          isActive: true,
        })),
      });
      return { seeded: applicableRules.length, message: `Seeded ${applicableRules.length} default rules` };
    }),

  resetToDefaults: facilityWriteProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Delete all rules for this facility
      await ctx.prisma.businessRule.deleteMany({
        where: { facilityId: input.facilityId },
      });

      const facility = ctx.facility as MetrcFacility;
      const applicableRules = filterRulesForState(facility.stateCode);

      // Re-seed defaults (including actionParams for discount rules)
      await ctx.prisma.businessRule.createMany({
        data: applicableRules.map(rule => ({
          facilityId: input.facilityId,
          name: rule.name,
          description: rule.description,
          category: rule.category,
          severity: rule.severity,
          conditions: rule.conditions as unknown as Prisma.InputJsonValue,
          actionType: rule.actionType,
          actionParams: (rule.actionParams as Prisma.InputJsonValue) ?? undefined,
          metadata: rule.metadata as Prisma.InputJsonValue ?? undefined,
          stateCode: rule.stateCode ?? null,
          isDefault: true,
          isActive: true,
        })),
      });
      return { seeded: applicableRules.length, message: `Reset to ${applicableRules.length} default rules` };
    }),
});
