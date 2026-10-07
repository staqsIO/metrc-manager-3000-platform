import { z } from 'zod';
import { createTRPCRouter, platformProcedure } from '@/lib/trpc';
import { dashboardPrisma } from '@/lib/prisma';
import { getUserOrgIds } from '@/lib/auth-helpers';
import { getDutchieClient } from '@/services/dutchie/dutchie-factory';
import { accumulateCategoryMargins, mergeCategoryAccumulators, formatCategoryMargins, type CategoryAccumulator } from './sales';

/**
 * Revenue source tag. Drives the badge on the /executive Revenue tile.
 *   - 'metrc_sales' — dispensary revenue annualized from synced RetailSaleReceipt rows
 *   - 'opex'        — annualRevenue from the facility's active default OpEx model
 *   - null          — no data available (render "Connect Metrc or configure OpEx" zero state)
 *
 * Wholesale revenue for cultivators/manufacturers is a Phase 3 followup — it
 * requires either adding price columns to TransferLineItem + CSV reimport, or a
 * bulk price-rollup method on IMetrcClient. See lovely-percolating-garden plan.
 */
export type RevenueSource = 'metrc_sales' | 'metrc_wholesale' | 'opex' | null;

/** Dispensary-type strings from Metrc that should pull revenue from RetailSaleReceipt. */
const DISPENSARY_TYPES = new Set(['Dispensary', 'Microbusiness']);

export const financialRouter = createTRPCRouter({
  getConsolidatedPnL: platformProcedure
    .input(z.object({
      groupBy: z.enum(['none', 'state', 'facilityType']).optional().default('none'),
      daysLookback: z.number().min(1).max(400).optional().default(30),
    }).optional())
    .query(async ({ ctx, input }) => {
    const groupBy = input?.groupBy ?? 'none';
    const daysLookback = input?.daysLookback ?? 30;
    const salesCutoff = new Date(Date.now() - daysLookback * 86400000);
    // Prior window of equal length, ending where the current one starts.
    const priorCutoff = new Date(salesCutoff.getTime() - daysLookback * 86400000);

    // Get ALL user's orgs, scope to active org if set
    let orgIds: string[];
    try {
      orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);
    } catch {
      return {
        facilities: [],
        groups: [],
        totals: { revenue: 0, cost: 0, grossMargin: 0, grossProfit: 0, tollingFees: 0, supplyCost: 0 },
        source: { metrcSalesFacilityCount: 0, opexFacilityCount: 0, noDataFacilityCount: 0 },
      };
    }
    const scopedOrgIds =
      ctx.activeOrgId && orgIds.includes(ctx.activeOrgId)
        ? [ctx.activeOrgId]
        : orgIds;

    // Get all active facilities across scoped orgs
    const facilities = await ctx.prisma.metrcFacility.findMany({
      where: { organizationId: { in: scopedOrgIds }, isActive: true },
      select: { id: true, name: true, licenseNumber: true, facilityType: true, stateCode: true },
    });

    const facilityIds = facilities.map(f => f.id);
    const dispensaryIds = facilities.filter(f => f.facilityType && DISPENSARY_TYPES.has(f.facilityType)).map(f => f.id);

    // Get active default OpEx models (denormalized KPIs)
    const models = await ctx.prisma.opExModel.findMany({
      where: {
        facilityId: { in: facilityIds },
        status: 'ACTIVE',
        isDefault: true,
      },
      select: {
        facilityId: true,
        annualRevenue: true,
        annualCost: true,
        grossMargin: true,
        grossProfit: true,
        costPerPound: true,
      },
    });

    // Get active tolling agreements
    const tolling = await ctx.prisma.tollingAgreement.findMany({
      where: { facilityId: { in: facilityIds }, status: 'ACTIVE' },
      select: { facilityId: true, totalFees: true, agreementType: true },
    });

    // Get supply item costs (sum of unitCost * currentStock per facility)
    const supplyItems = await ctx.prisma.supplyItem.findMany({
      where: { facilityId: { in: facilityIds }, isActive: true },
      select: { facilityId: true, unitCost: true, currentStock: true },
    });

    // Get Metrc retail sales revenue per dispensary facility (annualized from window).
    // Cheap local aggregate — RetailSaleReceipt is populated by the nightly retail-sales-sync cron.
    const retailSalesByFacility = new Map<string, number>();
    if (dispensaryIds.length > 0) {
      const salesAgg = await ctx.prisma.retailSaleReceipt.groupBy({
        by: ['facilityId'],
        where: {
          facilityId: { in: dispensaryIds },
          soldAt: { gte: salesCutoff },
        },
        _sum: { totalPrice: true },
      });
      for (const row of salesAgg) {
        const raw = row._sum.totalPrice ? Number(row._sum.totalPrice) : 0;
        retailSalesByFacility.set(row.facilityId, raw);
      }
    }

    // Get wholesale transfer revenue per non-dispensary facility (annualized from window).
    // Manufacturers/cultivators generate revenue via wholesale transfers with pricing.
    const PRODUCER_TYPES = new Set(['Cultivator', 'Manufacturer', 'Microbusiness']);
    const producerIds = facilities.filter(f => f.facilityType && PRODUCER_TYPES.has(f.facilityType)).map(f => f.id);
    const wholesaleRevenueByFacility = new Map<string, number>();
    if (producerIds.length > 0) {
      // TransferLineItem.createdDateTime is a string (MM/DD/YYYY format from CSV).
      // Use raw SQL to parse dates, filter by lookback window, and sum pricing.
      const wholesaleAgg = await ctx.prisma.$queryRaw<
        Array<{ facility_id: string; total_revenue: number }>
      >`
        SELECT
          "facilityId" as facility_id,
          COALESCE(SUM("shipperWholesalePrice"), 0) as total_revenue
        FROM "transfer_line_items"
        WHERE "facilityId" = ANY(${producerIds})
          AND "transferType" = 'wholesale'
          AND "shipperWholesalePrice" IS NOT NULL
          AND "isVoided" = false
          AND "createdDateTime" IS NOT NULL
          AND TO_TIMESTAMP("createdDateTime", 'MM/DD/YYYY HH24:MI:SS') >= ${salesCutoff}
        GROUP BY "facilityId"
      `;
      for (const row of wholesaleAgg) {
        wholesaleRevenueByFacility.set(row.facility_id, Math.round(Number(row.total_revenue) * 100) / 100);
      }
    }

    // Aggregate per facility — revenue waterfall: Metrc retail sales → wholesale transfers → OpEx → null
    let metrcSalesFacilityCount = 0;
    let opexFacilityCount = 0;
    let noDataFacilityCount = 0;

    const facilityBreakdown = facilities.map(f => {
      const model = models.find(m => m.facilityId === f.id);
      const facilityTolling = tolling.filter(t => t.facilityId === f.id);
      const facilitySupply = supplyItems.filter(s => s.facilityId === f.id);

      const tollingFees = facilityTolling.reduce((sum, t) => sum + (t.totalFees ?? 0), 0);
      const supplyCost = facilitySupply.reduce((sum, s) => sum + (s.unitCost ?? 0) * s.currentStock, 0);

      // Revenue waterfall
      const metrcSalesAnnualized = retailSalesByFacility.get(f.id);
      let revenue: number;
      let source: RevenueSource;
      let cost: number;
      let grossProfit: number;
      let grossMarginPct: number;
      let costPerPound: number;

      if (metrcSalesAnnualized !== undefined && metrcSalesAnnualized > 0) {
        // Metrc sales are authoritative for dispensaries. COGS stays from OpEx model
        // when available (for an accurate gross profit); otherwise we can't compute margin.
        revenue = Math.round(metrcSalesAnnualized * 100) / 100;
        source = 'metrc_sales';
        metrcSalesFacilityCount++;
        if (model?.annualCost) {
          cost = Number(model.annualCost);
          grossProfit = Math.round((revenue - cost) * 100) / 100;
          grossMarginPct = revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : 0;
          costPerPound = Number(model.costPerPound ?? 0);
        } else {
          // No cost data — report revenue but margin is unknown.
          cost = 0;
          grossProfit = 0;
          grossMarginPct = 0;
          costPerPound = 0;
        }
      } else if (wholesaleRevenueByFacility.has(f.id) && wholesaleRevenueByFacility.get(f.id)! > 0) {
        // Wholesale transfer revenue for manufacturers/cultivators
        revenue = wholesaleRevenueByFacility.get(f.id)!;
        source = 'metrc_wholesale';
        metrcSalesFacilityCount++;
        if (model?.annualCost) {
          cost = Number(model.annualCost);
          grossProfit = Math.round((revenue - cost) * 100) / 100;
          grossMarginPct = revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : 0;
          costPerPound = Number(model.costPerPound ?? 0);
        } else {
          cost = 0;
          grossProfit = 0;
          grossMarginPct = 0;
          costPerPound = 0;
        }
      } else if (model?.annualRevenue) {
        revenue = Number(model.annualRevenue);
        source = 'opex';
        opexFacilityCount++;
        cost = Number(model.annualCost ?? 0);
        grossProfit = Number(model.grossProfit ?? 0);
        grossMarginPct = Number(model.grossMargin ?? 0);
        costPerPound = Number(model.costPerPound ?? 0);
      } else {
        revenue = 0;
        source = null;
        noDataFacilityCount++;
        cost = 0;
        grossProfit = 0;
        grossMarginPct = 0;
        costPerPound = 0;
      }

      return {
        id: f.id,
        name: f.name,
        licenseNumber: f.licenseNumber,
        facilityType: f.facilityType,
        stateCode: f.stateCode,
        revenue,
        cost,
        grossMargin: grossMarginPct,
        grossProfit,
        costPerPound,
        tollingFees: Math.round(tollingFees * 100) / 100,
        supplyCost: Math.round(supplyCost * 100) / 100,
        source,
      };
    });

    // Compute totals from an array of facility breakdowns
    function computeTotals(items: typeof facilityBreakdown) {
      const t = {
        revenue: Math.round(items.reduce((s, f) => s + f.revenue, 0) * 100) / 100,
        cost: Math.round(items.reduce((s, f) => s + f.cost, 0) * 100) / 100,
        grossMargin: 0,
        grossProfit: Math.round(items.reduce((s, f) => s + f.grossProfit, 0) * 100) / 100,
        tollingFees: Math.round(items.reduce((s, f) => s + f.tollingFees, 0) * 100) / 100,
        supplyCost: Math.round(items.reduce((s, f) => s + f.supplyCost, 0) * 100) / 100,
      };
      t.grossMargin = t.revenue > 0 ? Math.round((t.grossProfit / t.revenue) * 10000) / 100 : 0;
      return t;
    }

    const totals = computeTotals(facilityBreakdown);

    // Build grouped view if requested
    let groups: { key: string; label: string; facilities: typeof facilityBreakdown; totals: typeof totals }[] = [];
    if (groupBy !== 'none') {
      const groupMap = new Map<string, typeof facilityBreakdown>();
      for (const f of facilityBreakdown) {
        const key = groupBy === 'state' ? f.stateCode : (f.facilityType || 'Unknown');
        const arr = groupMap.get(key);
        if (arr) arr.push(f);
        else groupMap.set(key, [f]);
      }
      groups = Array.from(groupMap.entries())
        .map(([key, facs]) => ({
          key,
          label: key,
          facilities: facs,
          totals: computeTotals(facs),
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
    }

    // Prior-period Metrc revenue (retail + wholesale only — OpEx-modeled
    // revenue is static so it has no period delta to surface).
    let priorMetrcRevenue = 0;
    if (dispensaryIds.length > 0) {
      const priorRetail = await ctx.prisma.retailSaleReceipt.groupBy({
        by: ['facilityId'],
        where: {
          facilityId: { in: dispensaryIds },
          soldAt: { gte: priorCutoff, lt: salesCutoff },
        },
        _sum: { totalPrice: true },
      });
      for (const row of priorRetail) {
        priorMetrcRevenue += row._sum.totalPrice ? Number(row._sum.totalPrice) : 0;
      }
    }
    if (producerIds.length > 0) {
      const priorWholesale = await ctx.prisma.$queryRaw<
        Array<{ total_revenue: number }>
      >`
        SELECT COALESCE(SUM("shipperWholesalePrice"), 0) as total_revenue
        FROM "transfer_line_items"
        WHERE "facilityId" = ANY(${producerIds})
          AND "transferType" = 'wholesale'
          AND "shipperWholesalePrice" IS NOT NULL
          AND "isVoided" = false
          AND "createdDateTime" IS NOT NULL
          AND TO_TIMESTAMP("createdDateTime", 'MM/DD/YYYY HH24:MI:SS') >= ${priorCutoff}
          AND TO_TIMESTAMP("createdDateTime", 'MM/DD/YYYY HH24:MI:SS') < ${salesCutoff}
      `;
      priorMetrcRevenue += priorWholesale[0]?.total_revenue ? Number(priorWholesale[0].total_revenue) : 0;
    }
    priorMetrcRevenue = Math.round(priorMetrcRevenue * 100) / 100;

    return {
      facilities: facilityBreakdown,
      groups,
      totals,
      daysLookback,
      source: { metrcSalesFacilityCount, opexFacilityCount, noDataFacilityCount },
      prior: { metrcRevenue: priorMetrcRevenue },
    };
  }),

  /**
   * Cross-facility per-category margin analysis from actual Dutchie POS data.
   */
  getCategoryMargins: platformProcedure
    .input(z.object({
      daysLookback: z.number().min(1).max(90).optional().default(30),
    }).optional())
    .query(async ({ ctx, input }) => {
      const daysLookback = input?.daysLookback ?? 30;
      const now = new Date();
      const cutoff = new Date(now.getTime() - daysLookback * 86400000);

      let orgIds: string[];
      try {
        orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);
      } catch {
        return { categories: [], totals: { revenue: 0, cogs: 0, grossProfit: 0, marginPercent: 0 }, byFacility: [], skipped: [] };
      }
      const scopedOrgIds =
        ctx.activeOrgId && orgIds.includes(ctx.activeOrgId)
          ? [ctx.activeOrgId]
          : orgIds;

      const facilities = await ctx.prisma.metrcFacility.findMany({
        where: { organizationId: { in: scopedOrgIds }, isActive: true },
      });

      const API_CONCURRENCY = 5;
      const byFacility: Array<{
        id: string;
        name: string;
        stateCode: string;
        categories: Array<{ category: string; revenue: number; cogs: number; marginPercent: number }>;
      }> = [];
      const skipped: Array<{ id: string; name: string; reason: string }> = [];

      // Raw accumulator — merge unrounded values, format once at end
      const orgAccumulator: CategoryAccumulator = new Map();

      // Process facilities in batches with bounded concurrency
      for (let i = 0; i < facilities.length; i += API_CONCURRENCY) {
        const batch = facilities.slice(i, i + API_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (facility) => {
            const hasDutchie = facility.dutchieEnvironment && facility.dutchieEnvironment !== 'none';
            if (!hasDutchie) {
              // No Dutchie — skip this facility (no margin data without POS)
              return { facility, raw: new Map() as CategoryAccumulator };
            }
            const client = getDutchieClient(facility);
            const [transactions, products] = await Promise.all([
              client.getTransactions({ includeDetail: true }),
              client.getReportingProducts(),
            ]);
            const raw = accumulateCategoryMargins(transactions, products, cutoff);
            return { facility, raw };
          }),
        );

        for (let j = 0; j < results.length; j++) {
          const settled = results[j]!;
          const facility = batch[j]!;
          if (settled.status === 'rejected') {
            console.error(`getCategoryMargins: facility ${facility.id} failed:`, settled.reason);
            skipped.push({ id: facility.id, name: facility.name, reason: 'Failed to fetch POS data' });
            continue;
          }
          const { raw } = settled.value;

          // Per-facility formatted output for drill-down
          const facilityFormatted = formatCategoryMargins(raw);
          byFacility.push({
            id: facility.id,
            name: facility.name,
            stateCode: facility.stateCode,
            categories: facilityFormatted.categories.map(c => ({
              category: c.category,
              revenue: c.revenue,
              cogs: c.cogs,
              marginPercent: c.marginPercent,
            })),
          });

          // Merge raw (unrounded) values into org accumulator
          mergeCategoryAccumulators(orgAccumulator, raw);
        }
      }

      // Format org-level totals from raw accumulators (single rounding pass)
      const { categories, totals } = formatCategoryMargins(orgAccumulator);

      return { categories, totals, byFacility, skipped };
    }),
});
