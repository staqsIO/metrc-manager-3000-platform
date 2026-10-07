import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getDutchieClient } from '@/services/dutchie/dutchie-factory';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { normalizeCategory } from '@/services/engines/run-rate-engine';
import { Prisma } from '@prisma/client';
import type { MetrcFacility } from '@prisma/client';
import type { DutchieDelivery, DutchieRawTransaction, DutchieRawProduct } from '@/services/dutchie/types';
import { executeMutationWithVerification } from '@/services/metrc/mutation-executor';
import { checkSalesReceiptCreate } from '@/services/metrc/verification-checks';

export const salesRouter = createTRPCRouter({
  /**
   * Get sales summary KPIs (revenue, AOV, top category, tax, discounts).
   */
  getSummary: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getDutchieClient(facility);
      const deliveries = await client.getDeliveries({ includeLineItems: true });

      const completed = deliveries.filter(d => d.Status === 'Completed');
      const totalRevenue = completed.reduce((sum, d) => sum + d.OrderTotal, 0);
      const totalTransactions = completed.length;
      const avgOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

      // Category breakdown from line items
      const categoryMap = new Map<string, { revenue: number; count: number }>();
      for (const d of completed) {
        for (const li of d.LineItems ?? []) {
          const cat = li.Category || 'Other';
          const existing = categoryMap.get(cat);
          if (existing) {
            existing.revenue += li.TotalPrice;
            existing.count += li.Quantity;
          } else {
            categoryMap.set(cat, { revenue: li.TotalPrice, count: li.Quantity });
          }
        }
      }

      const topCategory = Array.from(categoryMap.entries())
        .sort((a, b) => b[1].revenue - a[1].revenue)[0];

      return {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalTransactions,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        topCategory: topCategory
          ? { name: topCategory[0], revenue: Math.round(topCategory[1].revenue * 100) / 100 }
          : null,
        totalTax: Math.round(completed.reduce((sum, d) => sum + d.TaxAmount, 0) * 100) / 100,
        totalDiscount: Math.round(completed.reduce((sum, d) => sum + d.DiscountAmount, 0) * 100) / 100,
      };
    }),

  /**
   * Get paginated deliveries (transactions), optionally filtered by status.
   */
  getDeliveries: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      status: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getDutchieClient(facility);
      let deliveries = await client.getDeliveries({ includeLineItems: true });

      if (input.status) {
        deliveries = deliveries.filter(d => d.Status === input.status);
      }

      const total = deliveries.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const items = deliveries.slice(start, start + input.pageSize);

      return { items, total, page: input.page, pageSize: input.pageSize, totalPages };
    }),

  /**
   * Get daily sales aggregation for charting (revenue + order count + units sold per day).
   */
  getDailySales: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      days: z.number().min(1).max(90).optional().default(30),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getDutchieClient(facility);
      const deliveries = await client.getDeliveries({ includeLineItems: false });
      const fromDate = new Date(Date.now() - input.days * 86400000);
      return computeDailySales(deliveries, { fromDate });
    }),

  /**
   * Get top products by revenue with unit count, category, and brand.
   */
  getTopProducts: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      limit: z.number().min(1).max(50).optional().default(10),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getDutchieClient(facility);
      const deliveries = await client.getDeliveries({ includeLineItems: true });

      const completed = deliveries.filter(d => d.Status === 'Completed');
      const productMap = new Map<string, {
        revenue: number;
        unitsSold: number;
        category: string;
        brand: string | null;
      }>();

      for (const d of completed) {
        for (const li of d.LineItems ?? []) {
          const key = li.ProductName;
          const existing = productMap.get(key);
          if (existing) {
            existing.revenue += li.TotalPrice;
            existing.unitsSold += li.Quantity;
          } else {
            productMap.set(key, {
              revenue: li.TotalPrice,
              unitsSold: li.Quantity,
              category: li.Category,
              brand: li.Brand,
            });
          }
        }
      }

      return Array.from(productMap.entries())
        .map(([name, data]) => ({
          name,
          revenue: Math.round(data.revenue * 100) / 100,
          unitsSold: data.unitsSold,
          category: data.category,
          brand: data.brand,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, input.limit);
    }),

  /**
   * Get per-category margin analysis using raw Dutchie transaction data (unitCost).
   */
  getCategoryMargins: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      daysLookback: z.number().min(1).max(90).optional().default(30),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getDutchieClient(facility);

      const now = new Date();
      const cutoff = new Date(now.getTime() - input.daysLookback * 86400000);

      const [transactions, products] = await Promise.all([
        client.getTransactions({ includeDetail: true }),
        client.getReportingProducts(),
      ]);

      return computeCategoryMargins(transactions, products, cutoff);
    }),

  /**
   * Get Metrc sales receipts (paginated).
   */
  getMetrcReceipts: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      status: z.enum(['active', 'inactive']).optional(),
      search: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      // Inactive: read from RetailSaleReceipt summary table — zero Metrc API calls.
      // One row per receipt, indexed by (facilityId, soldAt DESC). Sub-millisecond.
      if (input.status === 'inactive') {
        const where: Prisma.RetailSaleReceiptWhereInput = {
          facilityId: input.facilityId,
          ...(input.search ? {
            OR: [
              { receiptNumber: { contains: input.search, mode: 'insensitive' as const } },
              { customerType: { contains: input.search, mode: 'insensitive' as const } },
            ],
          } : {}),
        };

        const [receipts, total] = await Promise.all([
          ctx.prisma.retailSaleReceipt.findMany({
            where,
            orderBy: { soldAt: 'desc' },
            skip: (input.page - 1) * input.pageSize,
            take: input.pageSize,
          }),
          ctx.prisma.retailSaleReceipt.count({ where }),
        ]);

        const items = receipts.map(r => ({
          Id: r.receiptId,
          ReceiptNumber: r.receiptNumber,
          SalesDateTime: r.soldAt.toISOString(),
          SalesCustomerType: r.customerType || 'Unknown',
          TotalPackages: r.lineItemCount,
          TotalPrice: Number(r.totalPrice),
          LastModified: r.soldAt.toISOString(),
          PatientLicenseNumber: null,
        }));

        return {
          items,
          total,
          page: input.page,
          pageSize: input.pageSize,
          totalPages: Math.ceil(total / input.pageSize),
        };
      }

      // Active: live Metrc API (cached 60s)
      const client = getMetrcClient(facility);
      let receipts = await client.getSalesReceipts();

      // Filter to active only (tagged by v2 patcher)
      if (input.status === 'active') {
        receipts = receipts.filter(r =>
          (r as unknown as Record<string, unknown>)._saleStatus === 'active'
        );
      }

      if (input.search) {
        const s = input.search.toLowerCase();
        receipts = receipts.filter(r =>
          r.ReceiptNumber?.toLowerCase().includes(s) ||
          r.SalesCustomerType?.toLowerCase().includes(s)
        );
      }

      receipts.sort((a, b) =>
        new Date(b.SalesDateTime).getTime() - new Date(a.SalesDateTime).getTime()
      );

      const total = receipts.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const items = receipts.slice(start, start + input.pageSize);

      return { items, total, page: input.page, pageSize: input.pageSize, totalPages };
    }),

  /**
   * Get Metrc sales summary (receipt count, total revenue, customer type breakdown).
   */
  getMetrcSalesSummary: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      status: z.enum(['active', 'inactive']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Inactive: aggregate from RetailSaleReceipt summary table
      if (input.status === 'inactive') {
        const where = { facilityId: input.facilityId };
        const [receiptCount, agg, customerTypes] = await Promise.all([
          ctx.prisma.retailSaleReceipt.count({ where }),
          ctx.prisma.retailSaleReceipt.aggregate({ where, _sum: { totalPrice: true } }),
          ctx.prisma.retailSaleReceipt.groupBy({
            by: ['customerType'],
            where,
            _count: true,
          }),
        ]);

        const totalRevenue = Number(agg._sum.totalPrice ?? 0);

        return {
          receiptCount,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          avgReceiptValue: receiptCount > 0 ? Math.round((totalRevenue / receiptCount) * 100) / 100 : 0,
          customerTypes: customerTypes
            .map(r => ({ type: r.customerType || 'Unknown', count: r._count }))
            .sort((a, b) => b.count - a.count),
        };
      }

      // Active: live Metrc API
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      const receipts = await client.getSalesReceipts();

      // Filter to active only when explicitly requested
      const filtered = input.status === 'active'
        ? receipts.filter(r => (r as unknown as Record<string, unknown>)._saleStatus === 'active')
        : receipts;

      let totalRevenue = 0;
      const customerTypes = new Map<string, number>();

      for (const r of filtered) {
        totalRevenue += r.TotalPrice;
        const ct = r.SalesCustomerType || 'Unknown';
        customerTypes.set(ct, (customerTypes.get(ct) || 0) + 1);
      }

      return {
        receiptCount: filtered.length,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        avgReceiptValue: filtered.length > 0 ? Math.round((totalRevenue / filtered.length) * 100) / 100 : 0,
        customerTypes: Array.from(customerTypes.entries())
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count),
      };
    }),

  /**
   * Create a Metrc sales receipt (preview -> confirm -> execute)
   */
  createSalesReceipt: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      salesDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      salesCustomerType: z.string().max(50),
      patientLicenseNumber: z.string().max(100).optional(),
      transactions: z.array(z.object({
        packageLabel: z.string().min(1).max(100),
        quantity: z.number().positive(),
        unitOfMeasure: z.string().min(1).max(50),
        totalAmount: z.number().min(0),
      })).min(1).max(50),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Validate no duplicate package labels
      const labels = input.transactions.map(t => t.packageLabel);
      const uniqueLabels = new Set(labels);
      if (uniqueLabels.size !== labels.length) {
        const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Duplicate package label(s): ${Array.from(new Set(dupes)).join(', ')}`,
        });
      }

      // Validate packages exist
      const activePackages = await client.getActivePackages();
      const packageMap = new Map(activePackages.map(p => [p.Label, p]));
      const missing = input.transactions.filter(t => !packageMap.get(t.packageLabel));
      if (missing.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Package(s) not found: ${missing.map(m => m.packageLabel).join(', ')}`,
        });
      }

      const totalAmount = input.transactions.reduce((sum, t) => sum + t.totalAmount, 0);

      // Validate patient license is provided for Patient customer type
      if (input.salesCustomerType === 'Patient' && !input.patientLicenseNumber) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Patient license number is required for Patient customer type',
        });
      }

      if (!input.confirmed) {
        const preview = {
          salesDate: input.salesDate,
          salesCustomerType: input.salesCustomerType,
          transactionCount: input.transactions.length,
          totalAmount: Math.round(totalAmount * 100) / 100,
          transactions: input.transactions.map(t => ({
            packageLabel: t.packageLabel,
            itemName: packageMap.get(t.packageLabel)?.ItemName ?? 'Unknown',
            quantity: t.quantity,
            unitOfMeasure: t.unitOfMeasure,
            totalAmount: t.totalAmount,
          })),
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'SALES_CREATE_RECEIPT',
            status: 'PREVIEWING',
            targetType: 'SALE',
            targetIds: input.transactions.map(t => t.packageLabel),
            targetCount: input.transactions.length,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      const receiptsBefore = await client.getSalesReceipts();
      const beforeState = { receiptCount: receiptsBefore.length };

      const payload = [{
        SalesDateTime: input.salesDate,
        SalesCustomerType: input.salesCustomerType,
        PatientLicenseNumber: input.patientLicenseNumber ?? '',
        Transactions: input.transactions.map(t => ({
          PackageLabel: t.packageLabel,
          Quantity: t.quantity,
          UnitOfMeasure: t.unitOfMeasure,
          TotalAmount: t.totalAmount,
        })),
      }];

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'SALES_CREATE_RECEIPT',
        targetType: 'SALE',
        targetIds: input.transactions.map(t => t.packageLabel),
        targetCount: input.transactions.length,
        executeFn: () => client.createSalesReceipts(payload as unknown as Record<string, unknown>[]),
        beforeState,
        verifyFn: async () => {
          const receiptsAfter = await client.getSalesReceipts();
          return checkSalesReceiptCreate(receiptsBefore.length, receiptsAfter.length);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, transactionCount: input.transactions.length, verified: result.verified };
    }),
});

// ---------------------------------------------------------------------------
// Shared daily-sales computation (used by getDailySales procedure + chat tool)
// ---------------------------------------------------------------------------

export interface DailySalesPoint {
  date: string;
  revenue: number;
  orderCount: number;
  unitsSold: number;
}

/**
 * Group completed Dutchie deliveries by `CompletedDate` (ISO day) and sum
 * revenue, order count, and unit count. Excludes non-completed deliveries
 * and any with a null `CompletedDate`. Optional `fromDate`/`toDate` cutoffs
 * scope the window.
 */
export function computeDailySales(
  deliveries: DutchieDelivery[],
  opts: { fromDate?: Date; toDate?: Date },
) {
  const fromMs = opts.fromDate?.getTime();
  const toMs = opts.toDate?.getTime();
  const dailyMap = new Map<string, { revenue: number; orderCount: number; unitsSold: number }>();

  for (const d of deliveries) {
    if (d.Status !== 'Completed') continue;
    if (!d.CompletedDate) continue;
    const t = new Date(d.CompletedDate).getTime();
    if (fromMs !== undefined && t < fromMs) continue;
    if (toMs !== undefined && t > toMs) continue;

    const key = new Date(d.CompletedDate).toISOString().slice(0, 10);
    const units = (d.LineItems ?? []).reduce((s, li) => s + (li.Quantity || 0), 0);
    const existing = dailyMap.get(key);
    if (existing) {
      existing.revenue += d.OrderTotal;
      existing.orderCount += 1;
      existing.unitsSold += units;
    } else {
      dailyMap.set(key, { revenue: d.OrderTotal, orderCount: 1, unitsSold: units });
    }
  }

  return Array.from(dailyMap.entries())
    .map(([date, data]) => ({
      date,
      revenue: Math.round(data.revenue * 100) / 100,
      orderCount: data.orderCount,
      unitsSold: data.unitsSold,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Shared category margin computation
// ---------------------------------------------------------------------------

export type CategoryAccumulator = Map<string, { revenue: number; cogs: number; unitsSold: number }>;

/**
 * Accumulate raw (unrounded) per-category margin data from Dutchie transactions.
 * Returns a mutable map that can be merged across facilities before formatting.
 */
export function accumulateCategoryMargins(
  transactions: DutchieRawTransaction[],
  products: DutchieRawProduct[],
  cutoff: Date,
): CategoryAccumulator {
  const productCategoryMap = new Map<number, string>();
  for (const p of products) {
    productCategoryMap.set(p.productId, p.category);
  }

  const categoryMap: CategoryAccumulator = new Map();
  const cutoffMs = cutoff.getTime();

  for (const txn of transactions) {
    if (txn.isVoid) continue;
    if (new Date(txn.transactionDate).getTime() < cutoffMs) continue;
    if (!txn.items) continue;

    for (const item of txn.items) {
      if (item.isReturned) continue;
      const rawCategory = productCategoryMap.get(item.productId) ?? 'Other';
      const category = normalizeCategory(rawCategory);
      const existing = categoryMap.get(category);
      const itemRevenue = item.totalPrice;
      const itemCogs = item.unitCost * item.quantity;
      if (existing) {
        existing.revenue += itemRevenue;
        existing.cogs += itemCogs;
        existing.unitsSold += item.quantity;
      } else {
        categoryMap.set(category, { revenue: itemRevenue, cogs: itemCogs, unitsSold: item.quantity });
      }
    }
  }

  return categoryMap;
}

/**
 * Merge one accumulator into another (mutates `target`).
 */
export function mergeCategoryAccumulators(target: CategoryAccumulator, source: CategoryAccumulator): void {
  source.forEach((data, category) => {
    const existing = target.get(category);
    if (existing) {
      existing.revenue += data.revenue;
      existing.cogs += data.cogs;
      existing.unitsSold += data.unitsSold;
    } else {
      target.set(category, { revenue: data.revenue, cogs: data.cogs, unitsSold: data.unitsSold });
    }
  });
}

/**
 * Format raw accumulator into rounded, sorted response shape.
 */
export function formatCategoryMargins(categoryMap: CategoryAccumulator) {
  const totalRevenue = Array.from(categoryMap.values()).reduce((s, c) => s + c.revenue, 0);
  const totalCogs = Array.from(categoryMap.values()).reduce((s, c) => s + c.cogs, 0);
  const totalGrossProfit = totalRevenue - totalCogs;

  const categories = Array.from(categoryMap.entries())
    .map(([category, data]) => {
      const grossProfit = data.revenue - data.cogs;
      return {
        category,
        revenue: Math.round(data.revenue * 100) / 100,
        cogs: Math.round(data.cogs * 100) / 100,
        grossProfit: Math.round(grossProfit * 100) / 100,
        marginPercent: data.revenue > 0 ? Math.round((grossProfit / data.revenue) * 10000) / 100 : 0,
        unitsSold: data.unitsSold,
        revenueShare: totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 10000) / 100 : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return {
    categories,
    totals: {
      revenue: Math.round(totalRevenue * 100) / 100,
      cogs: Math.round(totalCogs * 100) / 100,
      grossProfit: Math.round(totalGrossProfit * 100) / 100,
      marginPercent: totalRevenue > 0 ? Math.round((totalGrossProfit / totalRevenue) * 10000) / 100 : 0,
    },
  };
}

/**
 * Convenience: accumulate + format in one call (for single-facility use).
 */
export function computeCategoryMargins(
  transactions: DutchieRawTransaction[],
  products: DutchieRawProduct[],
  cutoff: Date,
) {
  return formatCategoryMargins(accumulateCategoryMargins(transactions, products, cutoff));
}
