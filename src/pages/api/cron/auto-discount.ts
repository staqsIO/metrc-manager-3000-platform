import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import type { MetrcFacility, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { getDutchieClient } from '@/services/dutchie/dutchie-factory';
import type { RuleCondition, RuleDefinition } from '@/services/engines/rules-engine';
import { scorePackagesForDiscounts } from '@/services/engines/discount-scoring-engine';
import { computeRunRates } from '@/services/engines/run-rate-engine';
import {
  buildPackageProductMap,
  buildVelocityMap,
  computeAutoDiscountPlan,
  parseDiscountTiers,
  parseCategoryMaxDiscountPct,
  type AutoDiscountConfigData,
} from '@/services/engines/auto-discount-engine';
import { getCanixClient } from '@/services/canix/canix-factory';
import { resolvePackageCOGS } from '@/services/engines/cogs-engine';

function toRuleDefinitions(rules: { id: string; name: string; description: string | null; category: string; severity: string; isActive: boolean; conditions: unknown; actionType: string; actionParams: unknown; metadata: unknown }[]): RuleDefinition[] {
  return rules.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    category: r.category,
    severity: r.severity,
    isActive: r.isActive,
    conditions: r.conditions as unknown as RuleCondition[],
    actionType: r.actionType,
    metadata: {
      ...(r.metadata as Record<string, unknown> ?? {}),
      ...(r.actionParams ? { actionParams: r.actionParams } : {}),
      actionType: r.actionType,
    },
  }));
}

/**
 * Railway cron endpoint for automated discount runs.
 * Runs daily at 7 AM UTC (1h after Metrc sync).
 *
 * Railway cron config:
 *   POST /api/cron/auto-discount
 *   Authorization: Bearer $CRON_SECRET
 *   Schedule: 0 7 * * *
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!verifyCronSecret(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!prisma) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    // Find all facilities with enabled auto-discount configs
    const configs = await prisma.autoDiscountConfig.findMany({
      where: { isEnabled: true },
      include: { facility: true },
    });

    const results = [];

    for (const config of configs) {
      const facility = config.facility as MetrcFacility;
      try {
        // Load discount rules
        const rules = await prisma.businessRule.findMany({
          where: { facilityId: config.facilityId, isActive: true, category: 'discount' },
        });
        if (rules.length === 0) {
          results.push({
            facilityId: config.facilityId,
            facilityName: facility.name,
            status: 'SKIPPED',
            message: 'No discount rules configured',
          });
          continue;
        }

        const metrcClient = getMetrcClient(facility);
        const dutchieClient = getDutchieClient(facility);

        // Fetch packages and product map
        const [packages, packageProductMap] = await Promise.all([
          metrcClient.getActivePackages(),
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

        // Optionally compute velocity
        let velocityMap: Map<string, 'excess' | 'healthy' | 'low' | 'critical'> | undefined;
        if (config.useVelocityData) {
          try {
            const runRateResult = await computeRunRates(packages, dutchieClient, {
              daysLookback: config.velocityLookbackDays,
              metrcClient,
              prisma,
              facilityId: facility.id,
            });
            velocityMap = buildVelocityMap(runRateResult) as Map<string, 'excess' | 'healthy' | 'low' | 'critical'>;
          } catch {
            // Proceed without velocity data
          }
        }

        // Score and compute plan
        const ruleDefinitions = toRuleDefinitions(rules);
        const recommendations = scorePackagesForDiscounts(ruleDefinitions, packages, { velocityMap, costMap });

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
          await prisma.autoDiscountRun.create({
            data: {
              facilityId: config.facilityId,
              configId: config.id,
              trigger: 'cron',
              status: 'SKIPPED',
              recommendationCount: plan.totalRecommendations,
              planData: [] as unknown as Prisma.InputJsonValue,
            },
          });
          await prisma.autoDiscountConfig.update({
            where: { id: config.id },
            data: { lastRunAt: new Date(), lastRunStatus: 'SKIPPED' },
          });
          results.push({
            facilityId: config.facilityId,
            facilityName: facility.name,
            status: 'SKIPPED',
            message: 'No packages matched criteria',
          });
          continue;
        }

        if (config.requireApproval) {
          // Create PREVIEWING run — user must approve via UI
          const actionLog = await prisma.actionLog.create({
            data: {
              facilityId: config.facilityId,
              userId: 'system-cron',
              actionType: 'AUTO_DISCOUNT',
              status: 'PREVIEWING',
              targetType: 'PRODUCT',
              targetIds: plan.items.map(i => String(i.productId)),
              targetCount: plan.items.length,
              previewData: plan as unknown as Prisma.InputJsonValue,
            },
          });
          await prisma.autoDiscountRun.create({
            data: {
              facilityId: config.facilityId,
              configId: config.id,
              trigger: 'cron',
              status: 'PREVIEWING',
              recommendationCount: plan.totalRecommendations,
              overrideCount: plan.items.length,
              estimatedRevenueImpact: plan.estimatedRevenueImpact,
              planData: plan.items as unknown as Prisma.InputJsonValue,
              actionLogId: actionLog.id,
            },
          });
          await prisma.autoDiscountConfig.update({
            where: { id: config.id },
            data: { lastRunAt: new Date(), lastRunStatus: 'PREVIEWING' },
          });
          results.push({
            facilityId: config.facilityId,
            facilityName: facility.name,
            status: 'PREVIEWING',
            overrideCount: plan.items.length,
            message: 'Preview generated, awaiting approval',
          });
        } else {
          // Full auto: compute AND execute
          const overrides = plan.items.map(item => ({
            productId: item.productId,
            unitPrice: item.newPrice,
          }));

          const result = await dutchieClient.updateLocationOverrides(overrides);

          const actionLog = await prisma.actionLog.create({
            data: {
              facilityId: config.facilityId,
              userId: 'system-cron',
              actionType: 'AUTO_DISCOUNT',
              status: 'COMPLETED',
              targetType: 'PRODUCT',
              targetIds: plan.items.map(i => String(i.productId)),
              targetCount: plan.items.length,
              executedAt: new Date(),
              beforeState: plan.items.map(i => ({ productId: i.productId, price: i.oldPrice })) as unknown as Prisma.InputJsonValue,
              afterState: plan.items.map(i => ({ productId: i.productId, price: i.newPrice })) as unknown as Prisma.InputJsonValue,
              metadata: {
                succeededCount: result.succeeded.length,
                failedCount: result.failed.length,
                failures: result.failed,
              } as unknown as Prisma.InputJsonValue,
            },
          });
          await prisma.autoDiscountRun.create({
            data: {
              facilityId: config.facilityId,
              configId: config.id,
              trigger: 'cron',
              status: 'COMPLETED',
              recommendationCount: plan.totalRecommendations,
              overrideCount: plan.items.length,
              succeededCount: result.succeeded.length,
              failedCount: result.failed.length,
              estimatedRevenueImpact: plan.estimatedRevenueImpact,
              planData: plan.items as unknown as Prisma.InputJsonValue,
              resultData: result as unknown as Prisma.InputJsonValue,
              actionLogId: actionLog.id,
              completedAt: new Date(),
            },
          });
          await prisma.autoDiscountConfig.update({
            where: { id: config.id },
            data: { lastRunAt: new Date(), lastRunStatus: 'COMPLETED' },
          });
          results.push({
            facilityId: config.facilityId,
            facilityName: facility.name,
            status: 'COMPLETED',
            succeeded: result.succeeded.length,
            failed: result.failed.length,
          });
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          facilityId: config.facilityId,
          facilityName: facility.name,
          status: 'FAILED',
          errorMessage: msg,
        });
      }
    }

    return res.status(200).json({
      processed: configs.length,
      results,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
