// ---------------------------------------------------------------------------
// Dutchie-Metrc Reconciliation Engine (FOR-1143)
//
// Pure-function diff engine — no React, no Prisma, no tRPC.
// Compares Dutchie data against Metrc data and surfaces discrepancies
// that neither system detects natively. Reduces compliance risk by
// catching cross-system mismatches before auditors do.
//
// See ADR-013 for architectural context.
// ---------------------------------------------------------------------------

import type { MetrcHarvest, MetrcPackage } from '@/services/metrc/types';
import type { DutchieHarvest } from '@/services/dutchie/types';
import { normalizeStrainName } from '@/services/analytics/strain-comparison';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HarvestMatch {
  dutchie: DutchieHarvest;
  metrc: MetrcHarvest;
  matchKey: string;
  matchConfidence: 'exact' | 'normalized';
  conflicts: string[];
}

export interface HarvestReconciliationResult {
  matched: HarvestMatch[];
  dutchieOnly: DutchieHarvest[];
  metrcOnly: MetrcHarvest[];
  warnings: string[];
}

export interface InventoryMatch {
  packageLabel: string;
  metrcPackage: MetrcPackage;
  dutchieQuantitySold: number;
  dutchieTransactionCount: number;
}

export interface InventoryReconciliationResult {
  /** Metrc packages that appeared in Dutchie sales transactions */
  matched: InventoryMatch[];
  /** Package labels in Dutchie sales but not found in Metrc active packages */
  dutchieOnly: string[];
  /** Metrc packages with no Dutchie sales activity (not necessarily a problem) */
  metrcUnsold: number;
  warnings: string[];
}

export type CategoryStatus = 'green' | 'yellow' | 'red';

export interface ReconciliationCategoryScore {
  score: number;  // 0-100
  status: CategoryStatus;
  matchCount: number;
  mismatchCount: number;
  details: string;
}

export interface ReconciliationSummary {
  overallScore: number;  // 0-100
  categories: {
    harvests: ReconciliationCategoryScore;
    inventory: ReconciliationCategoryScore;
  };
  topIssues: string[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function categoryStatus(score: number): CategoryStatus {
  if (score >= 90) return 'green';
  if (score >= 70) return 'yellow';
  return 'red';
}

/** Build a composite key for harvest matching: normalized name + normalized strain */
function harvestKey(name: string, strain: string): string {
  return normalizeStrainName(name) + '::' + normalizeStrainName(strain);
}

// ---------------------------------------------------------------------------
// 1. reconcileHarvests
// ---------------------------------------------------------------------------

export function reconcileHarvests(
  dutchieHarvests: DutchieHarvest[],
  metrcHarvests: MetrcHarvest[],
): HarvestReconciliationResult {
  const warnings: string[] = [];

  if (dutchieHarvests.length === 0 && metrcHarvests.length === 0) {
    return { matched: [], dutchieOnly: [], metrcOnly: [], warnings: ['No harvest data in either system.'] };
  }

  // Build Metrc harvest map keyed by normalized name::strain
  const metrcMap = new Map<string, MetrcHarvest[]>();
  let metrcMissingStrain = 0;
  for (let i = 0; i < metrcHarvests.length; i++) {
    const h = metrcHarvests[i];
    if (!h.Name && !h.SourceStrainNames) {
      metrcMissingStrain++;
      continue;
    }
    const key = harvestKey(h.Name, h.SourceStrainNames);
    const existing = metrcMap.get(key);
    if (existing) {
      existing.push(h);
    } else {
      metrcMap.set(key, [h]);
    }
  }
  if (metrcMissingStrain > 0) {
    warnings.push(metrcMissingStrain + ' Metrc harvest(s) had no name or strain — excluded from matching.');
  }

  const matched: HarvestMatch[] = [];
  const dutchieOnly: DutchieHarvest[] = [];
  const matchedMetrcIds = new Set<number>();

  for (let i = 0; i < dutchieHarvests.length; i++) {
    const dh = dutchieHarvests[i];
    if (!dh.HarvestName && !dh.StrainName) {
      warnings.push('Dutchie harvest ' + dh.Id + ' has no name or strain — skipped.');
      continue;
    }

    const key = harvestKey(dh.HarvestName, dh.StrainName);
    const candidates = metrcMap.get(key);

    if (!candidates || candidates.length === 0) {
      dutchieOnly.push(dh);
      continue;
    }

    // Pick first unmatched candidate
    let matchedMetrc: MetrcHarvest | null = null;
    for (let j = 0; j < candidates.length; j++) {
      if (!matchedMetrcIds.has(candidates[j].Id)) {
        matchedMetrc = candidates[j];
        break;
      }
    }

    if (!matchedMetrc) {
      dutchieOnly.push(dh);
      continue;
    }

    matchedMetrcIds.add(matchedMetrc.Id);

    // Detect conflicts
    const conflicts: string[] = [];
    const dutchieActive = dh.IsActive;
    const metrcFinished = matchedMetrc.FinishedDate !== null;
    if (dutchieActive && metrcFinished) {
      conflicts.push('Dutchie shows active but Metrc shows finished (FinishedDate: ' + matchedMetrc.FinishedDate + ')');
    } else if (!dutchieActive && !metrcFinished) {
      conflicts.push('Dutchie shows inactive but Metrc shows still active (no FinishedDate)');
    }

    // Check start date proximity (>1 day difference)
    const dutchieStart = new Date(dh.StartDate).getTime();
    const metrcStart = new Date(matchedMetrc.HarvestStartDate).getTime();
    if (!isNaN(dutchieStart) && !isNaN(metrcStart)) {
      const daysDiff = Math.abs(dutchieStart - metrcStart) / (1000 * 60 * 60 * 24);
      if (daysDiff > 1) {
        conflicts.push('Start date differs by ' + Math.round(daysDiff) + ' day(s): Dutchie=' + dh.StartDate + ' Metrc=' + matchedMetrc.HarvestStartDate);
      }
    }

    // Determine match confidence
    const exactName = dh.HarvestName.toLowerCase().trim() === matchedMetrc.Name.toLowerCase().trim();
    const exactStrain = dh.StrainName.toLowerCase().trim() === matchedMetrc.SourceStrainNames.toLowerCase().trim();
    const confidence: 'exact' | 'normalized' = exactName && exactStrain ? 'exact' : 'normalized';

    matched.push({
      dutchie: dh,
      metrc: matchedMetrc,
      matchKey: key,
      matchConfidence: confidence,
      conflicts,
    });
  }

  // Remaining unmatched Metrc harvests
  const metrcOnly: MetrcHarvest[] = [];
  for (let i = 0; i < metrcHarvests.length; i++) {
    if (!matchedMetrcIds.has(metrcHarvests[i].Id)) {
      metrcOnly.push(metrcHarvests[i]);
    }
  }

  return { matched, dutchieOnly, metrcOnly, warnings };
}

// ---------------------------------------------------------------------------
// 2. reconcileInventory
//
// Matches Dutchie sales transactions to Metrc packages by package label.
// Note: This reconciles SOLD inventory (transactions with packageId), not
// standing inventory. Full standing inventory reconciliation requires
// typing the Dutchie /reporting/inventory endpoint (pending sandbox validation).
// ---------------------------------------------------------------------------

export interface DutchieSalesPackageAggregate {
  packageLabel: string;
  totalQuantitySold: number;
  transactionCount: number;
}

export function reconcileInventory(
  dutchieSalesAggregates: DutchieSalesPackageAggregate[],
  metrcPackages: MetrcPackage[],
): InventoryReconciliationResult {
  const warnings: string[] = [];

  if (dutchieSalesAggregates.length === 0 && metrcPackages.length === 0) {
    return { matched: [], dutchieOnly: [], metrcUnsold: 0, warnings: ['No inventory data in either system.'] };
  }

  // Build Metrc package map by label
  const metrcMap = new Map<string, MetrcPackage>();
  for (let i = 0; i < metrcPackages.length; i++) {
    metrcMap.set(metrcPackages[i].Label, metrcPackages[i]);
  }

  const matched: InventoryMatch[] = [];
  const dutchieOnly: string[] = [];
  const matchedLabels = new Set<string>();

  for (let i = 0; i < dutchieSalesAggregates.length; i++) {
    const agg = dutchieSalesAggregates[i];
    const metrcPkg = metrcMap.get(agg.packageLabel);

    if (!metrcPkg) {
      dutchieOnly.push(agg.packageLabel);
      continue;
    }

    matchedLabels.add(agg.packageLabel);
    matched.push({
      packageLabel: agg.packageLabel,
      metrcPackage: metrcPkg,
      dutchieQuantitySold: agg.totalQuantitySold,
      dutchieTransactionCount: agg.transactionCount,
    });
  }

  const metrcUnsold = metrcPackages.length - matchedLabels.size;

  if (dutchieOnly.length > 0) {
    warnings.push(dutchieOnly.length + ' Dutchie sales reference package labels not found in Metrc active packages. They may have been transferred out or finished.');
  }

  return { matched, dutchieOnly, metrcUnsold, warnings };
}

// ---------------------------------------------------------------------------
// 3. generateReconciliationSummary
//
// Health score: penalty-based deduction from 100.
// Weights: harvests 50%, inventory 50%.
// Per-category status: green (>=90), yellow (70-89), red (<70).
// ---------------------------------------------------------------------------

const HARVEST_WEIGHT = 0.5;
const INVENTORY_WEIGHT = 0.5;

// Penalty points per discrepancy type.
// Intentionally absolute (not proportional to dataset size). In compliance,
// every unmatched harvest matters regardless of total volume — a facility with
// 500 matched and 5 unmatched is still 5 harvests that auditors will flag.
const HARVEST_UNMATCHED_PENALTY = 3;
const HARVEST_CONFLICT_PENALTY = 1;
const INVENTORY_UNMATCHED_PENALTY = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function generateReconciliationSummary(
  harvestResult: HarvestReconciliationResult,
  inventoryResult: InventoryReconciliationResult,
): ReconciliationSummary {
  // --- Harvest score ---
  const harvestTotal = harvestResult.matched.length + harvestResult.dutchieOnly.length + harvestResult.metrcOnly.length;
  let harvestPenalty = 0;
  harvestPenalty += harvestResult.dutchieOnly.length * HARVEST_UNMATCHED_PENALTY;
  harvestPenalty += harvestResult.metrcOnly.length * HARVEST_UNMATCHED_PENALTY;
  let harvestConflicts = 0;
  for (let i = 0; i < harvestResult.matched.length; i++) {
    if (harvestResult.matched[i].conflicts.length > 0) {
      harvestConflicts++;
      harvestPenalty += HARVEST_CONFLICT_PENALTY;
    }
  }
  const harvestScore = harvestTotal > 0
    ? clamp(Math.round(100 - harvestPenalty), 0, 100)
    : 100;
  const harvestMismatch = harvestResult.dutchieOnly.length + harvestResult.metrcOnly.length + harvestConflicts;

  // --- Inventory score ---
  const inventoryTotal = inventoryResult.matched.length + inventoryResult.dutchieOnly.length;
  let inventoryPenalty = 0;
  inventoryPenalty += inventoryResult.dutchieOnly.length * INVENTORY_UNMATCHED_PENALTY;
  const inventoryScore = inventoryTotal > 0
    ? clamp(Math.round(100 - inventoryPenalty), 0, 100)
    : 100;

  // --- Overall ---
  const overallScore = Math.round(harvestScore * HARVEST_WEIGHT + inventoryScore * INVENTORY_WEIGHT);

  // --- Top issues (most actionable, sorted by severity) ---
  const topIssues: string[] = [];

  if (harvestResult.metrcOnly.length > 0) {
    topIssues.push(harvestResult.metrcOnly.length + ' harvest(s) in Metrc but not in Dutchie — may indicate Dutchie sync gap.');
  }
  if (harvestResult.dutchieOnly.length > 0) {
    topIssues.push(harvestResult.dutchieOnly.length + ' harvest(s) in Dutchie but not in Metrc — verify Metrc harvest creation.');
  }
  for (let i = 0; i < harvestResult.matched.length && topIssues.length < 5; i++) {
    const m = harvestResult.matched[i];
    if (m.conflicts.length > 0) {
      topIssues.push('Harvest "' + m.dutchie.HarvestName + '": ' + m.conflicts[0]);
    }
  }
  if (inventoryResult.dutchieOnly.length > 0 && topIssues.length < 5) {
    topIssues.push(inventoryResult.dutchieOnly.length + ' package label(s) in Dutchie sales not found in Metrc — may be transferred or finished packages.');
  }

  return {
    overallScore,
    categories: {
      harvests: {
        score: harvestScore,
        status: categoryStatus(harvestScore),
        matchCount: harvestResult.matched.length,
        mismatchCount: harvestMismatch,
        details: harvestResult.matched.length + ' matched, ' +
          harvestResult.dutchieOnly.length + ' Dutchie-only, ' +
          harvestResult.metrcOnly.length + ' Metrc-only' +
          (harvestConflicts > 0 ? ', ' + harvestConflicts + ' with conflicts' : ''),
      },
      inventory: {
        score: inventoryScore,
        status: categoryStatus(inventoryScore),
        matchCount: inventoryResult.matched.length,
        mismatchCount: inventoryResult.dutchieOnly.length,
        details: inventoryResult.matched.length + ' matched by label, ' +
          inventoryResult.dutchieOnly.length + ' Dutchie-only, ' +
          inventoryResult.metrcUnsold + ' Metrc packages with no Dutchie sales',
      },
    },
    topIssues: topIssues.slice(0, 5),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 4. aggregateDutchieSales — helper to pre-aggregate transaction items by label
// ---------------------------------------------------------------------------

export interface DutchieTransactionItemLike {
  packageId: string | null;
  quantity: number;
}

export function aggregateDutchieSales(
  items: DutchieTransactionItemLike[],
): DutchieSalesPackageAggregate[] {
  const map = new Map<string, { totalQuantitySold: number; transactionCount: number }>();

  for (let i = 0; i < items.length; i++) {
    const label = items[i].packageId;
    if (!label) continue;

    const existing = map.get(label);
    if (existing) {
      existing.totalQuantitySold += items[i].quantity;
      existing.transactionCount += 1;
    } else {
      map.set(label, { totalQuantitySold: items[i].quantity, transactionCount: 1 });
    }
  }

  const result: DutchieSalesPackageAggregate[] = [];
  const entries = Array.from(map.entries());
  for (let i = 0; i < entries.length; i++) {
    result.push({
      packageLabel: entries[i][0],
      totalQuantitySold: entries[i][1].totalQuantitySold,
      transactionCount: entries[i][1].transactionCount,
    });
  }
  return result;
}
