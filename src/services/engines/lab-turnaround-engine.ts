/**
 * Lab Turnaround Engine — computes average days from package creation to lab test.
 *
 * Pure function — no React, Prisma, or tRPC imports.
 * Joins MetrcPackage (PackagedDate) with MetrcLabTest (TestPerformedDate)
 * via PackageLabel to compute turnaround times per category.
 */

import type { MetrcPackage, MetrcLabTest } from '@/services/metrc/types';

export interface CategoryTurnaround {
  category: string;
  /** Number of packages with completed lab tests. */
  testedCount: number;
  /** Average days from PackagedDate to TestPerformedDate. */
  avgDays: number;
  /** Median days. */
  medianDays: number;
  /** Fastest turnaround in the sample. */
  minDays: number;
  /** Slowest turnaround in the sample. */
  maxDays: number;
}

export interface LabTurnaroundResult {
  /** Total packages with both PackagedDate and a lab test. */
  totalTested: number;
  /** Overall average turnaround across all categories. */
  overallAvgDays: number | null;
  /** Per-category breakdown, sorted by avgDays ascending (fastest first). */
  byCategory: CategoryTurnaround[];
  /** Packages currently awaiting testing (LabTestingState !== TestPassed/TestFailed). */
  awaitingTestCount: number;
}

/**
 * Compute lab testing turnaround times per category.
 *
 * @param packages — active packages for a facility
 * @param labTests — lab test results for a facility
 */
export function computeLabTurnaround(
  packages: MetrcPackage[],
  labTests: MetrcLabTest[],
): LabTurnaroundResult {
  // Build label → earliest test date map (a package may have multiple tests)
  const testDateByLabel = new Map<string, Date>();
  for (const test of labTests) {
    if (!test.TestPerformedDate || !test.PackageLabel) continue;
    const testDate = new Date(test.TestPerformedDate);
    if (isNaN(testDate.getTime())) continue;
    const existing = testDateByLabel.get(test.PackageLabel);
    if (!existing || testDate < existing) {
      testDateByLabel.set(test.PackageLabel, testDate);
    }
  }

  // Compute turnaround per package, grouped by category
  const categoryDays = new Map<string, number[]>();
  let awaitingTestCount = 0;

  for (const pkg of packages) {
    if (!pkg.PackagedDate || !pkg.Label) continue;

    const testDate = testDateByLabel.get(pkg.Label);
    if (!testDate) {
      // Check if awaiting testing
      const state = pkg.LabTestingState;
      if (state && state !== 'TestPassed' && state !== 'TestFailed') {
        awaitingTestCount++;
      }
      continue;
    }

    const pkgDate = new Date(pkg.PackagedDate);
    if (isNaN(pkgDate.getTime())) continue;

    const days = Math.max(0, Math.floor((testDate.getTime() - pkgDate.getTime()) / 86400000));
    const category = pkg.ItemCategory || 'Unknown';

    const arr = categoryDays.get(category) ?? [];
    arr.push(days);
    categoryDays.set(category, arr);
  }

  const allDays: number[] = [];
  const byCategory: CategoryTurnaround[] = [];

  for (const [category, days] of Array.from(categoryDays.entries())) {
    if (days.length === 0) continue;
    days.sort((a, b) => a - b);
    allDays.push(...days);

    const sum = days.reduce((s, d) => s + d, 0);
    const mid = Math.floor(days.length / 2);
    const median = days.length % 2 === 1 ? days[mid]! : (days[mid - 1]! + days[mid]!) / 2;

    byCategory.push({
      category,
      testedCount: days.length,
      avgDays: Math.round((sum / days.length) * 10) / 10,
      medianDays: Math.round(median * 10) / 10,
      minDays: days[0]!,
      maxDays: days[days.length - 1]!,
    });
  }

  byCategory.sort((a, b) => a.avgDays - b.avgDays);

  const overallAvgDays = allDays.length > 0
    ? Math.round((allDays.reduce((s, d) => s + d, 0) / allDays.length) * 10) / 10
    : null;

  return {
    totalTested: allDays.length,
    overallAvgDays,
    byCategory,
    awaitingTestCount,
  };
}
