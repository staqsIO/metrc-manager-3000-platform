import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { MetrcFacility, Prisma } from '@prisma/client';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getActivePackagesFromDb } from '@/services/metrc/snapshot-utils';
import { getDutchieClient } from '@/services/dutchie/dutchie-factory';
import { getCanixClient } from '@/services/canix/canix-factory';
import { resolvePackageCOGS } from '@/services/engines/cogs-engine';
import { scorePackagesForDiscounts } from '@/services/engines/discount-scoring-engine';
import { computeRunRates } from '@/services/engines/run-rate-engine';
import {
  buildPackageProductMap,
  buildVelocityMap,
  computeAutoDiscountPlan,
  planToRevertOverrides,
  parseDiscountTiers,
  parseCategoryMaxDiscountPct,
  type AutoDiscountPlanItem,
  type AutoDiscountConfigData,
} from '@/services/engines/auto-discount-engine';
import { toRuleDefinitions } from '@/services/engines/discount-utils';

const discountTierSchema = z.object({
  ageDays: z.number().int().min(1).max(365),
  discountPct: z.number().min(1).max(100),
});

// --- Router ---

export const autoDiscountRouter = createTRPCRouter({
  /**
   * Get or create the auto-discount config for a facility.
   */
  getConfig: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      let config = await ctx.prisma.autoDiscountConfig.findUnique({
        where: { facilityId: input.facilityId },
      });

      if (!config) {
        config = await ctx.prisma.autoDiscountConfig.create({
          data: { facilityId: input.facilityId },
        });
      }

      return {
        ...config,
        discountTiers: parseDiscountTiers(config.discountTiers),
        categoryMaxDiscountPct: parseCategoryMaxDiscountPct(config.categoryMaxDiscountPct),
      };
    }),

  /**
   * Update auto-discount config for a facility.
   */
  updateConfig: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      isEnabled: z.boolean().optional(),
      maxDiscountPct: z.number().min(1).max(100).optional(),
      minPriceFloor: z.number().min(0).nullable().optional(),
      minScoreThreshold: z.number().int().min(0).max(100).optional(),
      priorityFilter: z.array(z.enum(['urgent', 'high', 'medium', 'low'])).optional(),
      discountTiers: z.array(discountTierSchema).min(1).max(10).optional(),
      excludedProductIds: z.array(z.string()).optional(),
      excludedCategories: z.array(z.string()).optional(),
      categoryMaxDiscountPct: z.record(z.string(), z.number().min(1).max(100))
        .nullable()
        .optional()
        .transform(val => val && Object.keys(val).length > 0 ? val : null),
      useVelocityData: z.boolean().optional(),
      velocityLookbackDays: z.number().int().min(7).max(180).optional(),
      requireApproval: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { facilityId, ...updates } = input;

      // Ensure config exists
      const existing = await ctx.prisma.autoDiscountConfig.findUnique({
        where: { facilityId },
      });

      if (!existing) {
        return ctx.prisma.autoDiscountConfig.create({
          data: {
            facilityId,
            ...updates,
            discountTiers: updates.discountTiers
              ? (updates.discountTiers as unknown as Prisma.InputJsonValue)
              : undefined,
            categoryMaxDiscountPct: updates.categoryMaxDiscountPct !== undefined
              ? (updates.categoryMaxDiscountPct as unknown as Prisma.InputJsonValue)
              : undefined,
          },
        });
      }

      return ctx.prisma.autoDiscountConfig.update({
        where: { facilityId },
        data: {
          ...updates,
          discountTiers: updates.discountTiers
            ? (updates.discountTiers as unknown as Prisma.InputJsonValue)
            : undefined,
          categoryMaxDiscountPct: updates.categoryMaxDiscountPct !== undefined
            ? (updates.categoryMaxDiscountPct as unknown as Prisma.InputJsonValue)
            : undefined,
        },
      });
    }),

  /**
   * Preview: compute discount plan without writing to Dutchie.
   * Creates a run with PREVIEWING status.
   */
  preview: facilityWriteProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      // Load config (or create default)
      let config = await ctx.prisma.autoDiscountConfig.findUnique({
        where: { facilityId: input.facilityId },
      });
      if (!config) {
        config = await ctx.prisma.autoDiscountConfig.create({
          data: { facilityId: input.facilityId },
        });
      }

      // Load discount rules
      const rules = await ctx.prisma.businessRule.findMany({
        where: { facilityId: input.facilityId, isActive: true, category: 'discount' },
      });
      if (rules.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No discount rules configured. Seed default rules first.',
        });
      }

      const dutchieClient = getDutchieClient(facility);

      // Fetch packages from DB and build product map in parallel
      const [packages, packageProductMap] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        buildPackageProductMap(dutchieClient),
      ]);

      // Canix COGS for margin-aware scoring (best-effort)
      let costMap: Map<string, number> | undefined;
      try {
        const canixClient = getCanixClient(facility);
        const [standardCosts, boms] = await Promise.all([
          canixClient.getStandardCosts(),
          canixClient.getBillsOfMaterials(),
        ]);
        const cogsResults = resolvePackageCOGS(
          packages.map(p => ({ label: p.Label, itemName: p.ItemName ?? '', quantity: p.Quantity, unitOfMeasure: p.UnitOfMeasureName, category: p.ItemCategory ?? '' })),
          { standardCosts, boms, dutchieCosts: [], manualCosts: [] },
        );
        costMap = new Map(cogsResults.filter(r => r.source !== 'none').map(r => [r.packageLabel, r.costPerUnit]));
      } catch { /* Canix unavailable — continue without cost data */ }

      // Optionally compute velocity data
      let velocityMap: Map<string, 'excess' | 'healthy' | 'low' | 'critical'> | undefined;
      if (config.useVelocityData) {
        try {
          const { getMetrcClient } = await import('@/services/metrc/metrc-factory');
          const runRateResult = await computeRunRates(packages, dutchieClient, {
            daysLookback: config.velocityLookbackDays,
            metrcClient: getMetrcClient(facility),
            prisma: ctx.prisma,
            facilityId: input.facilityId,
          });
          velocityMap = buildVelocityMap(runRateResult) as Map<string, 'excess' | 'healthy' | 'low' | 'critical'>;
        } catch {
          // Velocity data unavailable — proceed without it
        }
      }

      // Score packages
      const ruleDefinitions = toRuleDefinitions(rules);
      const recommendations = scorePackagesForDiscounts(ruleDefinitions, packages, {
        velocityMap,
        costMap,
      });

      // Compute plan
      const tiers = parseDiscountTiers(config.discountTiers);
      const configData: AutoDiscountConfigData = {
        maxDiscountPct: config.maxDiscountPct,
        minPriceFloor: config.minPriceFloor,
        minScoreThreshold: config.minScoreThreshold,
        priorityFilter: config.priorityFilter,
        discountTiers: tiers,
        excludedProductIds: config.excludedProductIds,
        excludedCategories: config.excludedCategories,
        categoryMaxDiscountPct: parseCategoryMaxDiscountPct(config.categoryMaxDiscountPct),
      };
      const plan = computeAutoDiscountPlan(recommendations, packageProductMap, configData, costMap);

      if (plan.items.length === 0) {
        // Create a SKIPPED run
        const run = await ctx.prisma.autoDiscountRun.create({
          data: {
            facilityId: input.facilityId,
            configId: config.id,
            trigger: 'manual',
            status: 'SKIPPED',
            recommendationCount: plan.totalRecommendations,
            overrideCount: 0,
            estimatedRevenueImpact: 0,
            planData: [] as unknown as Prisma.InputJsonValue,
          },
        });
        return {
          runId: run.id,
          status: 'SKIPPED' as const,
          plan,
          message: 'No packages matched discount criteria.',
        };
      }

      // Create ActionLog
      const actionLog = await ctx.prisma.actionLog.create({
        data: {
          facilityId: input.facilityId,
          userId: ctx.session.user.id,
          actionType: 'AUTO_DISCOUNT',
          status: 'PREVIEWING',
          targetType: 'PRODUCT',
          targetIds: plan.items.map(i => String(i.productId)),
          targetCount: plan.items.length,
          previewData: plan as unknown as Prisma.InputJsonValue,
        },
      });

      // Create run
      const run = await ctx.prisma.autoDiscountRun.create({
        data: {
          facilityId: input.facilityId,
          configId: config.id,
          trigger: 'manual',
          status: 'PREVIEWING',
          recommendationCount: plan.totalRecommendations,
          overrideCount: plan.items.length,
          estimatedRevenueImpact: plan.estimatedRevenueImpact,
          planData: plan.items as unknown as Prisma.InputJsonValue,
          actionLogId: actionLog.id,
        },
      });

      return {
        runId: run.id,
        status: 'PREVIEWING' as const,
        plan,
      };
    }),

  /**
   * Execute: approve and apply a previewed discount run.
   * Includes drift detection.
   */
  execute: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      runId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      // Load run
      const run = await ctx.prisma.autoDiscountRun.findFirst({
        where: { id: input.runId, facilityId: input.facilityId },
      });
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }
      if (run.status !== 'PREVIEWING') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Run is in "${run.status}" status, expected PREVIEWING`,
        });
      }

      const planItems = run.planData as unknown as AutoDiscountPlanItem[];
      if (!planItems || planItems.length === 0) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Run has no plan data' });
      }

      // Drift detection: re-fetch Dutchie prices and compare
      const dutchieClient = getDutchieClient(facility);
      const currentMap = await buildPackageProductMap(dutchieClient);
      let driftCount = 0;
      for (const item of planItems) {
        const current = currentMap.get(item.packageLabel);
        // Skip items we can't compute drift for: missing product (may have been delisted
        // between preview and execute — not treated as drift), null price, or zero oldPrice
        // (would cause division by zero).
        if (!current || current.unitPrice == null || item.oldPrice <= 0) continue;
        if (Math.abs(current.unitPrice - item.oldPrice) / item.oldPrice > 0.05) {
          driftCount++;
        }
      }
      if (driftCount > 0) {
        // Mark run as FAILED with drift info
        await ctx.prisma.autoDiscountRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            errorMessage: `Price drift detected on ${driftCount} products (>5% change since preview). Re-preview required.`,
            completedAt: new Date(),
          },
        });
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Price drift detected on ${driftCount} products (>5% change since preview). Please re-preview.`,
        });
      }

      // Mark as EXECUTING
      await ctx.prisma.autoDiscountRun.update({
        where: { id: run.id },
        data: { status: 'EXECUTING' },
      });

      // Build overrides and execute
      const overrides = planItems.map(item => ({
        productId: item.productId,
        unitPrice: item.newPrice,
      }));

      try {
        const result = await dutchieClient.updateLocationOverrides(overrides);

        // Update run
        await ctx.prisma.autoDiscountRun.update({
          where: { id: run.id },
          data: {
            status: 'COMPLETED',
            succeededCount: result.succeeded.length,
            failedCount: result.failed.length,
            resultData: result as unknown as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });

        // Update ActionLog
        if (run.actionLogId) {
          await ctx.prisma.actionLog.update({
            where: { id: run.actionLogId },
            data: {
              status: 'COMPLETED',
              executedAt: new Date(),
              beforeState: planItems.map(i => ({ productId: i.productId, price: i.oldPrice })) as unknown as Prisma.InputJsonValue,
              afterState: planItems.map(i => ({ productId: i.productId, price: i.newPrice })) as unknown as Prisma.InputJsonValue,
              metadata: {
                succeededCount: result.succeeded.length,
                failedCount: result.failed.length,
                failures: result.failed,
              } as unknown as Prisma.InputJsonValue,
            },
          });
        }

        // Update config
        await ctx.prisma.autoDiscountConfig.update({
          where: { facilityId: input.facilityId },
          data: { lastRunAt: new Date(), lastRunStatus: 'COMPLETED' },
        });

        return {
          status: 'COMPLETED' as const,
          succeeded: result.succeeded.length,
          failed: result.failed.length,
          failures: result.failed,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.prisma.autoDiscountRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            errorMessage: message,
            completedAt: new Date(),
          },
        });
        await ctx.prisma.autoDiscountConfig.update({
          where: { facilityId: input.facilityId },
          data: { lastRunAt: new Date(), lastRunStatus: 'FAILED' },
        });
        console.error(`[AutoDiscount] execute failed:`, message);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Auto-discount execution failed. Check server logs for details.' });
      }
    }),

  /**
   * Revert: restore original prices from a completed run.
   */
  revert: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      runId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      const run = await ctx.prisma.autoDiscountRun.findFirst({
        where: { id: input.runId, facilityId: input.facilityId },
      });
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }
      if (run.status !== 'COMPLETED') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Run is in "${run.status}" status, expected COMPLETED`,
        });
      }

      // Check for existing revert
      const resultData = run.resultData as Record<string, unknown> | null;
      if (resultData && (resultData as Record<string, unknown>).reverted === true) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This run has already been reverted.',
        });
      }

      const planItems = run.planData as unknown as AutoDiscountPlanItem[];
      if (!planItems || planItems.length === 0) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Run has no plan data to revert' });
      }

      // Mark as reverted first (optimistic lock)
      await ctx.prisma.autoDiscountRun.update({
        where: { id: run.id },
        data: {
          resultData: {
            ...(run.resultData as Record<string, unknown> ?? {}),
            reverted: true,
            revertedAt: new Date().toISOString(),
            revertedBy: ctx.session.user.id,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      // Build revert overrides
      const revertOverrides = planToRevertOverrides(planItems);
      const dutchieClient = getDutchieClient(facility);

      try {
        const result = await dutchieClient.updateLocationOverrides(revertOverrides);

        // Create ROLLED_BACK ActionLog
        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'AUTO_DISCOUNT',
            status: 'ROLLED_BACK',
            targetType: 'PRODUCT',
            targetIds: planItems.map(i => String(i.productId)),
            targetCount: planItems.length,
            executedAt: new Date(),
            beforeState: planItems.map(i => ({ productId: i.productId, price: i.newPrice })) as unknown as Prisma.InputJsonValue,
            afterState: planItems.map(i => ({ productId: i.productId, price: i.oldPrice })) as unknown as Prisma.InputJsonValue,
            metadata: {
              rollbackOf: run.id,
              succeededCount: result.succeeded.length,
              failedCount: result.failed.length,
              failures: result.failed,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        return {
          status: 'REVERTED' as const,
          succeeded: result.succeeded.length,
          failed: result.failed.length,
          failures: result.failed,
        };
      } catch (err) {
        // Undo the optimistic lock on failure
        await ctx.prisma.autoDiscountRun.update({
          where: { id: run.id },
          data: {
            resultData: {
              ...(run.resultData as Record<string, unknown> ?? {}),
              reverted: false,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        const message = err instanceof Error ? err.message : String(err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),

  /**
   * List runs for a facility (paginated).
   */
  listRuns: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      limit: z.number().int().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const runs = await ctx.prisma.autoDiscountRun.findMany({
        where: { facilityId: input.facilityId },
        orderBy: { createdAt: 'desc' },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (runs.length > input.limit) {
        const next = runs.pop();
        nextCursor = next?.id;
      }

      return {
        runs: runs.map(r => ({
          id: r.id,
          trigger: r.trigger,
          status: r.status,
          recommendationCount: r.recommendationCount,
          overrideCount: r.overrideCount,
          succeededCount: r.succeededCount,
          failedCount: r.failedCount,
          estimatedRevenueImpact: r.estimatedRevenueImpact,
          errorMessage: r.errorMessage,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          createdAt: r.createdAt,
          reverted: (r.resultData as Record<string, unknown> | null)?.reverted === true,
        })),
        nextCursor,
      };
    }),

  /**
   * Get full run detail with plan data.
   */
  getRun: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      runId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.prisma.autoDiscountRun.findFirst({
        where: { id: input.runId, facilityId: input.facilityId },
      });
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }
      return {
        ...run,
        planData: (run.planData ?? []) as unknown as AutoDiscountPlanItem[],
        reverted: (run.resultData as Record<string, unknown> | null)?.reverted === true,
      };
    }),

  /**
   * Dashboard stats: active discounts, revenue impact, recent runs.
   */
  getDashboardStats: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [config, recentRuns, previewingCount] = await Promise.all([
        ctx.prisma.autoDiscountConfig.findUnique({
          where: { facilityId: input.facilityId },
        }),
        ctx.prisma.autoDiscountRun.findMany({
          where: { facilityId: input.facilityId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            overrideCount: true,
            succeededCount: true,
            estimatedRevenueImpact: true,
            createdAt: true,
          },
        }),
        ctx.prisma.autoDiscountRun.count({
          where: { facilityId: input.facilityId, status: 'PREVIEWING' },
        }),
      ]);

      // Count active (completed, not reverted) runs
      const completedRuns = await ctx.prisma.autoDiscountRun.findMany({
        where: { facilityId: input.facilityId, status: 'COMPLETED' },
        select: { resultData: true, succeededCount: true, estimatedRevenueImpact: true },
      });
      const activeRuns = completedRuns.filter(
        r => (r.resultData as Record<string, unknown> | null)?.reverted !== true
      );
      const totalActiveDiscounts = activeRuns.reduce((sum, r) => sum + r.succeededCount, 0);
      const totalRevenueImpact = activeRuns.reduce((sum, r) => sum + (r.estimatedRevenueImpact ?? 0), 0);

      return {
        isEnabled: config?.isEnabled ?? false,
        requireApproval: config?.requireApproval ?? true,
        lastRunAt: config?.lastRunAt ?? null,
        lastRunStatus: config?.lastRunStatus ?? null,
        previewingCount,
        totalActiveDiscounts,
        totalRevenueImpact: Math.round(totalRevenueImpact * 100) / 100,
        recentRuns,
      };
    }),
});
