/**
 * run-rate-engine.ts — Inventory Run-Rate Analysis
 *
 * Compares current Metrc package quantities against Dutchie POS sales
 * velocity to compute weeks-of-supply per category and SKU.
 *
 * Used by both the Copilot tool (analyze_inventory_run_rate) and
 * the Run-Rate Dashboard tRPC endpoint.
 */

import type { MetrcPackage } from '@/services/metrc/types';
import type { IMetrcClient } from '@/services/metrc/types';
import type { IDutchieClient } from '@/services/dutchie/types';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunRateStatus = 'critical' | 'low' | 'healthy' | 'excess';

export interface CategoryRunRate {
  category: string;
  currentInventory: number;
  currentInventoryUnit: string;
  weeklySalesRate: number;
  weeksOfSupply: number | null;
  status: RunRateStatus;
  promoCandidate: boolean;
  /** Incoming PO quantity from Canix, factored into weeksOfSupply when provided */
  incomingPOQuantity?: number;
}

export interface ProductRunRate {
  productName: string;
  category: string;
  currentInventory: number;
  weeklySalesRate: number;
  weeksOfSupply: number | null;
  status: RunRateStatus;
}

export interface StrainRunRate {
  strainName: string;
  productName: string;
  category: string;
  currentInventory: number;
  weeklySalesRate: number;
  weeksOfSupply: number | null;
  status: RunRateStatus;
}

export interface PromoOpportunity {
  category: string;
  weeksOfSupply: number | null;
  currentInventory: number;
  recommendation: string;
}

export interface RestockPriority {
  category: string;
  weeksOfSupply: number | null;
  currentInventory: number;
  urgency: RunRateStatus;
  recommendation: string;
}

export type RunRateDataSource = 'pos' | 'retail_sales' | 'transfers' | 'historical_transfers';

export interface RunRateResult {
  lookbackDays: number;
  salesPeriod: { from: string; to: string };
  totalTransactions: number;
  totalInventoryUnits: number;
  totalWeeklySalesRate: number;
  overallWeeksOfSupply: number | null;
  byCategory: CategoryRunRate[];
  byProduct: ProductRunRate[];
  byStrain: StrainRunRate[];
  promoOpportunities: PromoOpportunity[];
  restockPriorities: RestockPriority[];
  dataSource: RunRateDataSource;
}

export interface RunRateOptions {
  category?: string | null;
  daysLookback?: number;
  limit?: number;
  /** Optional Metrc client for transfer-based velocity fallback when POS data is unavailable */
  metrcClient?: IMetrcClient;
  /** Optional map of category → incoming PO quantity to factor into supply calculations */
  openPOQuantities?: Map<string, number>;
  /** Optional Prisma client for historical TransferLineItem fallback */
  prisma?: PrismaClient;
  /** Facility ID for historical transfer queries */
  facilityId?: string;
}

// ---------------------------------------------------------------------------
// Category normalization (Metrc <-> Dutchie taxonomy mapping)
// ---------------------------------------------------------------------------

const CATEGORY_NORM_MAP: Record<string, string> = {
  // Metrc → canonical
  'buds': 'Flower',
  'bud allocated for extraction': 'Flower',
  'shake/trim': 'Flower',
  'shake/trim (by strain)': 'Flower',
  'shake/trim allocated for extraction': 'Flower',
  'wet whole plants': 'Flower',
  'concentrate': 'Concentrates',
  'concentrate (each)': 'Concentrates',
  'infused (edible)': 'Edibles',
  'infused (non-edible)': 'Infused (Non-Edible)',
  'immature plants': 'Plants',
  'seeds': 'Seeds',
  'genetic material': 'Seeds',
  // Dutchie → canonical
  'flower': 'Flower',
  'pre-rolls': 'Infused (Non-Edible)',
  'pre-roll': 'Infused (Non-Edible)',
  'vapes': 'Infused (Non-Edible)',
  'vape': 'Infused (Non-Edible)',
  'cartridge': 'Infused (Non-Edible)',
  'vape cartridge': 'Infused (Non-Edible)',
  'concentrates': 'Concentrates',
  'extracts': 'Concentrates',
  'extract': 'Concentrates',
  'edibles': 'Edibles',
  'edible': 'Edibles',
  'topicals': 'Infused (Non-Edible)',
  'topical': 'Infused (Non-Edible)',
  'tinctures': 'Infused (Non-Edible)',
  'tincture': 'Infused (Non-Edible)',
  'capsules': 'Edibles',
  'capsule': 'Edibles',
};

export function normalizeCategory(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return CATEGORY_NORM_MAP[lower] ?? raw;
}

// ---------------------------------------------------------------------------
// Supply classification
// ---------------------------------------------------------------------------

export function classifySupply(weeksOfSupply: number): RunRateStatus {
  if (weeksOfSupply < 1) return 'critical';
  if (weeksOfSupply < 4) return 'low';
  if (weeksOfSupply <= 12) return 'healthy';
  return 'excess';
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

export async function computeRunRates(
  packages: MetrcPackage[],
  dutchieClient: IDutchieClient,
  options: RunRateOptions = {},
): Promise<RunRateResult> {
  const daysLookback = options.daysLookback ?? 30;
  const categoryFilter = options.category ?? null;
  const limit = options.limit ?? 50;

  // 1. Group current Metrc inventory by normalized category, product, and strain
  const invByCategory = new Map<string, { qty: number; unit: string; products: Map<string, { qty: number; strains: Map<string, number> }> }>();
  for (const pkg of packages) {
    if (pkg.Quantity <= 0) continue;
    const cat = normalizeCategory(pkg.ItemCategory || 'Unknown');
    if (categoryFilter && !cat.toLowerCase().includes(categoryFilter.toLowerCase())) continue;

    let catEntry = invByCategory.get(cat);
    if (!catEntry) {
      catEntry = { qty: 0, unit: pkg.UnitOfMeasureName, products: new Map() };
      invByCategory.set(cat, catEntry);
    }
    catEntry.qty += pkg.Quantity;
    const prodName = pkg.ItemName || 'Unknown';
    let prodEntry = catEntry.products.get(prodName);
    if (!prodEntry) {
      prodEntry = { qty: 0, strains: new Map() };
      catEntry.products.set(prodName, prodEntry);
    }
    prodEntry.qty += pkg.Quantity;
    const strainName = pkg.ItemStrainName || 'Unknown';
    prodEntry.strains.set(strainName, (prodEntry.strains.get(strainName) ?? 0) + pkg.Quantity);
  }

  // 2. Fetch sales data from Dutchie
  const now = new Date();
  const fromDate = new Date(now.getTime() - daysLookback * 24 * 60 * 60 * 1000);
  const deliveries = await dutchieClient.getDeliveries({
    includeLineItems: true,
    fromDateUTC: fromDate.toISOString(),
    toDateUTC: now.toISOString(),
  });
  const completed = deliveries.filter(d => d.Status === 'Completed');

  // 3. Calculate sales velocity per normalized category and product.
  //    If Dutchie returns no data and a Metrc client is provided, fall back to
  //    outgoing transfer manifests as a proxy for sales velocity.
  const salesByCategory = new Map<string, number>();
  const salesByProduct = new Map<string, { qty: number; category: string }>();
  let totalTransactions = completed.length;
  let dataSource: RunRateDataSource = 'pos';
  // When historical data auto-expands beyond the lookback window, this holds
  // the actual number of days the data spans — used for accurate weekly rate normalization.
  let historicalDaysSpan: number | undefined;

  const applyHistorical = (hv: TransferVelocityResult) => {
    dataSource = 'historical_transfers';
    totalTransactions = hv.totalTransfers;
    historicalDaysSpan = hv.actualDaysSpan;
    for (const [cat, qty] of Array.from(hv.byCategory)) {
      salesByCategory.set(cat, qty);
    }
    for (const [prodName, data] of Array.from(hv.byProduct)) {
      salesByProduct.set(prodName, data);
    }
  };

  if (completed.length > 0) {
    // Tier 1: POS data available — use Dutchie deliveries
    for (const d of completed) {
      for (const li of d.LineItems ?? []) {
        const cat = normalizeCategory(li.Category || 'Unknown');
        if (categoryFilter && !cat.toLowerCase().includes(categoryFilter.toLowerCase())) continue;
        salesByCategory.set(cat, (salesByCategory.get(cat) ?? 0) + li.Quantity);
        const existing = salesByProduct.get(li.ProductName);
        if (existing) {
          existing.qty += li.Quantity;
        } else {
          salesByProduct.set(li.ProductName, { qty: li.Quantity, category: cat });
        }
      }
    }
  } else if (options.prisma && options.facilityId) {
    // Tier 2: Metrc retail sales from DB (zero API calls).
    // Dispensaries sync receipts via retail-sales-sync cron.
    const retailSales = await options.prisma.retailSale.findMany({
      where: {
        facilityId: options.facilityId,
        soldAt: { gte: fromDate, lte: now },
      },
      select: {
        productName: true,
        productCategory: true,
        quantity: true,
        receiptNumber: true,
      },
    });

    if (retailSales.length > 0) {
      dataSource = 'retail_sales';
      const receiptNumbers = new Set(retailSales.map(s => s.receiptNumber));
      totalTransactions = receiptNumbers.size;
      for (const sale of retailSales) {
        const cat = normalizeCategory(sale.productCategory || 'Unknown');
        if (categoryFilter && !cat.toLowerCase().includes(categoryFilter.toLowerCase())) continue;
        const qty = Number(sale.quantity);
        if (qty <= 0) continue;
        salesByCategory.set(cat, (salesByCategory.get(cat) ?? 0) + qty);
        const prodName = sale.productName || 'Unknown';
        const existing = salesByProduct.get(prodName);
        if (existing) {
          existing.qty += qty;
        } else {
          salesByProduct.set(prodName, { qty, category: cat });
        }
      }
    }

    // Tier 3: Historical transfer line items from DB (zero API calls).
    if (salesByCategory.size === 0) {
      const historicalVelocity = await computeHistoricalTransferVelocity(
        options.prisma,
        options.facilityId,
        fromDate,
        now,
        categoryFilter,
      );
      if (historicalVelocity.byCategory.size > 0) {
        applyHistorical(historicalVelocity);
      }
    }

    // Tier 4: Live Metrc transfer API (expensive — N+1 API calls).
    if (salesByCategory.size === 0 && options.metrcClient) {
      try {
        const transferVelocity = await computeTransferVelocity(
          options.metrcClient,
          fromDate,
          now,
          categoryFilter,
        );
        if (transferVelocity.byCategory.size > 0) {
          dataSource = 'transfers';
          totalTransactions = transferVelocity.totalTransfers;
          for (const [cat, qty] of Array.from(transferVelocity.byCategory)) {
            salesByCategory.set(cat, qty);
          }
          for (const [prodName, data] of Array.from(transferVelocity.byProduct)) {
            salesByProduct.set(prodName, data);
          }
        }
      } catch {
        // Live Metrc transfer fetch failed — no data available
      }
    }
  } else if (options.metrcClient) {
    // No DB access — try live Metrc transfers only
    try {
      const transferVelocity = await computeTransferVelocity(
        options.metrcClient,
        fromDate,
        now,
        categoryFilter,
      );
      if (transferVelocity.byCategory.size > 0) {
        dataSource = 'transfers';
        totalTransactions = transferVelocity.totalTransfers;
        for (const [cat, qty] of Array.from(transferVelocity.byCategory)) {
          salesByCategory.set(cat, qty);
        }
        for (const [prodName, data] of Array.from(transferVelocity.byProduct)) {
          salesByProduct.set(prodName, data);
        }
      }
    } catch {
      // Live Metrc transfer fetch failed — no data available
    }
  }

  // Use actual historical span for weekly rate when data auto-expanded beyond the lookback window
  const effectiveDays = historicalDaysSpan ?? daysLookback;
  const weeks = effectiveDays / 7;

  // 4. Build category-level run-rate
  const byCategory: CategoryRunRate[] = [];
  let totalInvUnits = 0;
  let totalWeeklySales = 0;

  for (const [cat, inv] of Array.from(invByCategory)) {
    const totalSold = salesByCategory.get(cat) ?? 0;
    const weeklyRate = totalSold / weeks;

    // Open PO quantities extend effective supply without inflating currentInventory.
    // weeksOfSupply reflects inventory + incoming POs; currentInventory remains actual Metrc stock.
    // TODO: Unit normalization — PO quantities from Canix may differ from Metrc inventory units
    const poQty = options.openPOQuantities?.get(cat) ?? 0;
    const effectiveInventory = inv.qty + poQty;
    const wos = weeklyRate > 0 ? effectiveInventory / weeklyRate : null;
    const status = wos !== null ? classifySupply(wos) : 'excess';

    totalInvUnits += inv.qty;
    totalWeeklySales += weeklyRate;

    byCategory.push({
      category: cat,
      currentInventory: Math.round(inv.qty * 100) / 100,
      currentInventoryUnit: inv.unit,
      weeklySalesRate: Math.round(weeklyRate * 10) / 10,
      weeksOfSupply: wos !== null ? Math.round(wos * 10) / 10 : null,
      status,
      promoCandidate: status === 'excess',
      incomingPOQuantity: poQty > 0 ? poQty : undefined,
    });
  }
  byCategory.sort((a, b) => (a.weeksOfSupply ?? 9999) - (b.weeksOfSupply ?? 9999));

  // 5. Build product-level run-rate
  const byProduct: ProductRunRate[] = [];

  const allProductNames = new Set<string>();
  for (const [, inv] of Array.from(invByCategory)) {
    for (const name of Array.from(inv.products.keys())) allProductNames.add(name);
  }
  for (const name of Array.from(salesByProduct.keys())) allProductNames.add(name);

  for (const prodName of Array.from(allProductNames)) {
    let invQty = 0;
    let prodCat = 'Unknown';
    for (const [cat, inv] of Array.from(invByCategory)) {
      const prodEntry = inv.products.get(prodName);
      if (prodEntry) {
        invQty += prodEntry.qty;
        prodCat = cat;
      }
    }
    const salesData = salesByProduct.get(prodName);
    if (salesData) prodCat = salesData.category;
    const totalSold = salesData?.qty ?? 0;
    const weeklyRate = totalSold / weeks;
    const wos = weeklyRate > 0 ? invQty / weeklyRate : null;
    const status = wos !== null ? classifySupply(wos) : (invQty > 0 ? 'excess' : 'critical');

    byProduct.push({
      productName: prodName,
      category: prodCat,
      currentInventory: Math.round(invQty * 100) / 100,
      weeklySalesRate: Math.round(weeklyRate * 10) / 10,
      weeksOfSupply: wos !== null ? Math.round(wos * 10) / 10 : null,
      status,
    });
  }
  byProduct.sort((a, b) => (a.weeksOfSupply ?? 9999) - (b.weeksOfSupply ?? 9999));

  // 6. Build strain-level run-rate (distributes product sales proportionally by inventory share)
  const byStrain: StrainRunRate[] = [];

  for (const [cat, inv] of Array.from(invByCategory)) {
    for (const [prodName, prodEntry] of Array.from(inv.products)) {
      if (prodEntry.strains.size <= 1 && prodEntry.strains.has('Unknown')) continue;
      const prodSalesData = salesByProduct.get(prodName);
      const prodTotalSold = prodSalesData?.qty ?? 0;
      const prodWeeklyRate = prodTotalSold / weeks;

      for (const [strain, strainQty] of Array.from(prodEntry.strains)) {
        // Distribute product-level sales proportionally by inventory share
        const share = prodEntry.qty > 0 ? strainQty / prodEntry.qty : 0;
        const strainWeeklyRate = prodWeeklyRate * share;
        const wos = strainWeeklyRate > 0 ? strainQty / strainWeeklyRate : null;
        const status = wos !== null ? classifySupply(wos) : (strainQty > 0 ? 'excess' : 'critical');

        byStrain.push({
          strainName: strain,
          productName: prodName,
          category: cat,
          currentInventory: Math.round(strainQty * 100) / 100,
          weeklySalesRate: Math.round(strainWeeklyRate * 10) / 10,
          weeksOfSupply: wos !== null ? Math.round(wos * 10) / 10 : null,
          status,
        });
      }
    }
  }
  byStrain.sort((a, b) => (a.weeksOfSupply ?? 9999) - (b.weeksOfSupply ?? 9999));

  const overallWos = totalWeeklySales > 0 ? Math.round((totalInvUnits / totalWeeklySales) * 10) / 10 : null;

  // When historical data auto-expanded, show the actual period used
  const effectiveFrom = historicalDaysSpan
    ? new Date(now.getTime() - historicalDaysSpan * 24 * 60 * 60 * 1000)
    : fromDate;

  return {
    lookbackDays: effectiveDays,
    salesPeriod: { from: effectiveFrom.toISOString().split('T')[0]!, to: now.toISOString().split('T')[0]! },
    totalTransactions,
    totalInventoryUnits: Math.round(totalInvUnits * 100) / 100,
    totalWeeklySalesRate: Math.round(totalWeeklySales * 10) / 10,
    overallWeeksOfSupply: overallWos,
    byCategory: byCategory.slice(0, limit),
    byProduct: byProduct.slice(0, limit),
    byStrain,
    dataSource,
    promoOpportunities: byCategory.filter(c => c.promoCandidate).map(c => ({
      category: c.category,
      weeksOfSupply: c.weeksOfSupply,
      currentInventory: c.currentInventory,
      recommendation: `${c.category} has ${c.weeksOfSupply ?? '\u221E'}+ weeks of supply \u2014 safe to run promos or increase distribution`,
    })),
    restockPriorities: byCategory.filter(c => c.status === 'critical' || c.status === 'low').map(c => ({
      category: c.category,
      weeksOfSupply: c.weeksOfSupply,
      currentInventory: c.currentInventory,
      urgency: c.status,
      recommendation: c.status === 'critical'
        ? `${c.category} is critically low (<1 week) \u2014 immediate manufacturing/restock needed`
        : `${c.category} is running low (${c.weeksOfSupply} weeks) \u2014 schedule manufacturing soon`,
    })),
  };
}

// ---------------------------------------------------------------------------
// Transfer-based velocity fallback
// ---------------------------------------------------------------------------

interface TransferVelocityResult {
  totalTransfers: number;
  byCategory: Map<string, number>;
  byProduct: Map<string, { qty: number; category: string }>;
  /** Actual number of days spanned by the data (may differ from requested lookback for historical data) */
  actualDaysSpan?: number;
}

/**
 * Compute outgoing transfer velocity as a proxy for sales velocity.
 * Uses outgoing transfers → deliveries → delivery packages to aggregate
 * shipped quantities by category and product over the lookback window.
 */
async function computeTransferVelocity(
  client: IMetrcClient,
  fromDate: Date,
  toDate: Date,
  categoryFilter: string | null,
): Promise<TransferVelocityResult> {
  const byCategory = new Map<string, number>();
  const byProduct = new Map<string, { qty: number; category: string }>();

  // Pass date filters server-side for efficient querying (v2 supports these params).
  const transfers = await client.getOutgoingTransfers({
    lastModifiedStart: fromDate.toISOString(),
    lastModifiedEnd: toDate.toISOString(),
  });

  // Bounded concurrency for delivery/package fetching
  const CONCURRENCY = 5;
  for (let i = 0; i < transfers.length; i += CONCURRENCY) {
    const batch = transfers.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (transfer) => {
        const deliveries = await client.getTransferDeliveries(transfer.Id);
        const allPackages = [];
        for (const delivery of deliveries) {
          const packages = await client.getDeliveryPackages(delivery.Id);
          allPackages.push(...packages);
        }
        return allPackages;
      }),
    );

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const pkg of result.value) {
        const rawCategory = pkg.ItemCategory ?? 'Unknown';
        const cat = normalizeCategory(rawCategory);
        if (categoryFilter && !cat.toLowerCase().includes(categoryFilter.toLowerCase())) continue;

        const qty = pkg.Quantity ?? 0;
        if (qty <= 0) continue;

        byCategory.set(cat, (byCategory.get(cat) ?? 0) + qty);

        const prodName = pkg.ItemName ?? 'Unknown';
        const existing = byProduct.get(prodName);
        if (existing) {
          existing.qty += qty;
        } else {
          byProduct.set(prodName, { qty, category: cat });
        }
      }
    }
  }

  return { totalTransfers: transfers.length, byCategory, byProduct };
}

// ---------------------------------------------------------------------------
// Historical TransferLineItem-based velocity fallback
// ---------------------------------------------------------------------------

/**
 * Parse a date string in either MM/DD/YYYY HH:MM:SS or ISO format.
 * Returns null if unparseable.
 */
function parseDateFlexible(dateStr: string): Date | null {
  // Try ISO first (2025-03-13T09:54:38 or 2025-03-13)
  const isoDate = new Date(dateStr);
  if (!isNaN(isoDate.getTime()) && dateStr.includes('-')) return isoDate;

  // Try MM/DD/YYYY HH:MM:SS (Metrc CSV export format)
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{2}:\d{2}:\d{2})?/);
  if (match) {
    const [, month, day, year, time] = match;
    const iso = `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}T${time ?? '00:00:00'}`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/**
 * Compute outgoing velocity from historical TransferLineItem records.
 * Queries imported CSV data for outgoing transfers (origin matches facility)
 * within the lookback window.
 */
export async function computeHistoricalTransferVelocity(
  db: PrismaClient,
  facilityId: string,
  fromDate: Date,
  toDate: Date,
  categoryFilter: string | null,
): Promise<TransferVelocityResult> {
  const byCategory = new Map<string, number>();
  const byProduct = new Map<string, { qty: number; category: string }>();

  // Get the facility's license for matching outgoing (origin = our facility)
  const facility = await db.metrcFacility.findUnique({
    where: { id: facilityId },
    select: { licenseNumber: true },
  });
  if (!facility) return { totalTransfers: 0, byCategory, byProduct };

  // Fetch ALL non-voided outgoing lines for this facility and filter dates in JS.
  // createdDateTime is stored as-is from CSVs (MM/DD/YYYY HH:MM:SS or ISO),
  // so Prisma string comparison is unreliable. Client-side filtering is safe
  // given typical transfer volumes (~10K per facility).
  const whereClause: Record<string, unknown> = {
    facilityId,
    originLicenseNumber: facility.licenseNumber,
    isVoided: false,
  };

  if (categoryFilter) {
    whereClause.itemCategory = { contains: categoryFilter, mode: 'insensitive' };
  }

  const allLines = await db.transferLineItem.findMany({
    where: whereClause as never,
    select: {
      itemName: true,
      itemCategory: true,
      shippedQuantity: true,
      createdDateTime: true,
      manifestNumber: true,
    },
  });

  // Parse all dates upfront for reuse
  const parsed = allLines
    .filter(line => !!line.createdDateTime)
    .map(line => ({ ...line, _parsed: parseDateFlexible(line.createdDateTime!) }))
    .filter((line): line is typeof line & { _parsed: Date } => line._parsed !== null);

  // Filter to the requested lookback window only — no auto-expansion.
  // If the window has no records, return zero sales. Users should increase
  // the lookback period explicitly if they want to see older data.
  const lines = parsed.filter(line => line._parsed >= fromDate && line._parsed <= toDate);
  const actualDaysSpan: number | undefined = undefined;

  for (const line of lines) {
    const cat = normalizeCategory(line.itemCategory || 'Unknown');
    const qty = line.shippedQuantity ?? 0;
    if (qty <= 0) continue;

    byCategory.set(cat, (byCategory.get(cat) ?? 0) + qty);

    const prodName = line.itemName || 'Unknown';
    const existing = byProduct.get(prodName);
    if (existing) {
      existing.qty += qty;
    } else {
      byProduct.set(prodName, { qty, category: cat });
    }
  }

  // Count distinct manifests as "transfers"
  const distinctManifests = new Set(lines.map(l => l.manifestNumber));

  return { totalTransfers: distinctManifests.size, byCategory, byProduct, actualDaysSpan };
}
