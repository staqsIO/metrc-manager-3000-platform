/**
 * Production Rate Engine — computes daily package creation rates per category.
 *
 * Pure function — no React, Prisma, or tRPC imports.
 * Derives daily production velocity from Metrc package PackagedDate timestamps.
 */

import type { MetrcPackage } from '@/services/metrc/types';

export interface CategoryProductionRate {
  category: string;
  /** Total packages created in the lookback window. */
  packagesCreated: number;
  /** Total quantity (in package UoM) created in the window. */
  quantityCreated: number;
  /** Average packages created per day in the window. */
  packagesPerDay: number;
  /** Average quantity created per day in the window. */
  quantityPerDay: number;
  /** Number of distinct days with production activity. */
  activeDays: number;
}

export interface ProductionRateResult {
  daysInWindow: number;
  totalPackagesCreated: number;
  totalActiveDays: number;
  byCategory: CategoryProductionRate[];
}

/**
 * Compute daily production rates per category from Metrc packages.
 *
 * @param packages — all active packages for a facility
 * @param daysLookback — window to analyze (default 30)
 */
export function computeProductionRates(
  packages: MetrcPackage[],
  daysLookback = 30,
): ProductionRateResult {
  const cutoff = new Date(Date.now() - daysLookback * 86400000);
  const allActiveDays = new Set<string>();

  const categoryMap = new Map<string, {
    packagesCreated: number;
    quantityCreated: number;
    activeDays: Set<string>;
  }>();

  for (const pkg of packages) {
    if (!pkg.PackagedDate) continue;
    const pkgDate = new Date(pkg.PackagedDate);
    if (pkgDate < cutoff) continue;

    const dateKey = pkg.PackagedDate.slice(0, 10); // YYYY-MM-DD
    const category = pkg.ItemCategory || 'Unknown';

    let entry = categoryMap.get(category);
    if (!entry) {
      entry = { packagesCreated: 0, quantityCreated: 0, activeDays: new Set() };
      categoryMap.set(category, entry);
    }

    entry.packagesCreated++;
    entry.quantityCreated += pkg.Quantity;
    entry.activeDays.add(dateKey);
    allActiveDays.add(dateKey);
  }

  const byCategory: CategoryProductionRate[] = Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      category,
      packagesCreated: data.packagesCreated,
      quantityCreated: Math.round(data.quantityCreated * 100) / 100,
      packagesPerDay: Math.round((data.packagesCreated / daysLookback) * 10) / 10,
      quantityPerDay: Math.round((data.quantityCreated / daysLookback) * 10) / 10,
      activeDays: data.activeDays.size,
    }))
    .sort((a, b) => b.quantityPerDay - a.quantityPerDay);

  return {
    daysInWindow: daysLookback,
    totalPackagesCreated: byCategory.reduce((s, c) => s + c.packagesCreated, 0),
    totalActiveDays: allActiveDays.size,
    byCategory,
  };
}
