import { z } from 'zod';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import type { MetrcFacility, Prisma } from '@prisma/client';
import { getActivePackagesFromDb } from '@/services/metrc/snapshot-utils';
import { getDutchieClient } from '@/services/dutchie/dutchie-factory';
import { DEFAULT_RULES } from '@/services/engines/default-rules';
import {
  scorePackagesForDiscounts,
  summarizeDiscountRecommendations,
  type DiscountActionType,
} from '@/services/engines/discount-scoring-engine';
import { computeRunRates } from '@/services/engines/run-rate-engine';
import { buildVelocityMap } from '@/services/engines/auto-discount-engine';
import { toRuleDefinitions } from '@/services/engines/discount-utils';

const DISCOUNT_ACTION_TYPES: [string, ...string[]] = [
  'DISCOUNT_RECOMMEND',
  'AUTO_DISCOUNT',
  'PROMO_FLAG',
  'CONSOLIDATE',
  'SAMPLE_OUT',
];

export const discountRouter = createTRPCRouter({
  getRecommendations: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      actionType: z.enum(DISCOUNT_ACTION_TYPES).optional(),
      minScore: z.number().min(0).max(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      const [rules, packages, autoConfig] = await Promise.all([
        ctx.prisma.businessRule.findMany({
          where: { facilityId: input.facilityId, isActive: true, category: 'discount' },
        }),
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        ctx.prisma.autoDiscountConfig.findUnique({
          where: { facilityId: input.facilityId },
        }),
      ]);

      const ruleDefinitions = toRuleDefinitions(rules);

      // Optionally integrate velocity data from Dutchie sales
      let velocityMap: Map<string, 'excess' | 'healthy' | 'low' | 'critical'> | undefined;
      if (autoConfig?.useVelocityData) {
        try {
          const dutchieClient = getDutchieClient(facility);
          const runRateResult = await computeRunRates(packages, dutchieClient, {
            daysLookback: autoConfig.velocityLookbackDays,
          });
          velocityMap = buildVelocityMap(runRateResult) as Map<string, 'excess' | 'healthy' | 'low' | 'critical'>;
        } catch {
          // Velocity data unavailable — proceed without it
        }
      }

      const recommendations = scorePackagesForDiscounts(ruleDefinitions, packages, {
        minScore: input.minScore,
        actionTypeFilter: input.actionType as DiscountActionType | undefined,
        velocityMap,
      });

      const summary = summarizeDiscountRecommendations(recommendations);

      return {
        recommendations,
        summary,
        rulesCount: ruleDefinitions.length,
        packagesEvaluated: packages.length,
      };
    }),

  getSummary: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [rules, packages] = await Promise.all([
        ctx.prisma.businessRule.findMany({
          where: { facilityId: input.facilityId, isActive: true, category: 'discount' },
        }),
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
      ]);

      if (rules.length === 0) {
        return {
          totalRecommendations: 0,
          byActionType: {},
          byPriority: {},
          averageScore: 0,
          highScoreCount: 0,
          hasRules: false,
        };
      }

      const ruleDefinitions = toRuleDefinitions(rules);
      const recommendations = scorePackagesForDiscounts(ruleDefinitions, packages);
      const summary = summarizeDiscountRecommendations(recommendations);

      return { ...summary, hasRules: true };
    }),

  seedDefaults: facilityWriteProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.businessRule.count({
        where: { facilityId: input.facilityId, isDefault: true, category: 'discount' },
      });

      if (existing > 0) {
        return { seeded: 0, message: 'Discount default rules already exist' };
      }

      const discountDefaults = DEFAULT_RULES.filter(r => r.category === 'discount');
      const creates = discountDefaults.map(rule =>
        ctx.prisma.businessRule.create({
          data: {
            facilityId: input.facilityId,
            name: rule.name,
            description: rule.description,
            category: rule.category,
            severity: rule.severity,
            conditions: rule.conditions as unknown as Prisma.InputJsonValue,
            actionType: rule.actionType,
            actionParams: (rule.actionParams as Prisma.InputJsonValue) ?? undefined,
            metadata: rule.metadata as Prisma.InputJsonValue ?? undefined,
            isDefault: true,
            isActive: true,
          },
        })
      );

      await Promise.all(creates);
      return { seeded: discountDefaults.length, message: `Seeded ${discountDefaults.length} discount rules` };
    }),
});
