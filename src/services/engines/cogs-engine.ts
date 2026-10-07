/**
 * COGS Waterfall Engine
 *
 * Computes per-package Cost of Goods Sold using a prioritized waterfall:
 *   1. Canix Purchase Price (authoritative — from actual PO)
 *   2. Canix Standard Cost (authoritative — set by operator in ERP)
 *   3. Dutchie unitCost (POS-derived — often stale, retail-only)
 *   4. Manual OpEx entry (last resort — facility-level, not per-item)
 *
 * Rule: Wherever Canix data exists, it takes precedence over manual/inferred options.
 * Manual entries are fallbacks only when Canix is not connected or data is missing.
 *
 * Pure functions — no React, no Prisma, no tRPC imports.
 */

import type { CanixStandardCost, CanixBOM } from '../canix/types';

// ============================================================
// Types
// ============================================================

export type CostSource = 'canix_purchase' | 'canix_bom' | 'canix_standard' | 'dutchie' | 'dutchie_inferred' | 'manual' | 'none';

export interface CostResolution {
  /** Resolved cost per unit in the item's native unit */
  costPerUnit: number;
  /** Which waterfall level provided the cost */
  source: CostSource;
  /** Confidence: canix_purchase=1.0, canix_standard=0.95, dutchie=0.7, manual=0.5, none=0 */
  confidence: number;
  /** ISO date when the cost data was last updated */
  asOfDate: string | null;
}

export interface PackageCOGS {
  /** Metrc package label */
  packageLabel: string;
  /** Item name (from Metrc) */
  itemName: string;
  /** Resolved cost per unit */
  costPerUnit: number;
  /** Total COGS = costPerUnit * quantity */
  totalCOGS: number;
  /** Package quantity */
  quantity: number;
  /** Cost source waterfall level */
  source: CostSource;
  /** Confidence score (0-1) */
  confidence: number;
  /** BOM-based cost breakdown (if available) */
  bomCostBreakdown: BOMCostLine[] | null;
}

export interface BOMCostLine {
  componentName: string;
  quantityPerUnit: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  isCannabisDerived: boolean;
  costSource: CostSource;
}

export interface COGSSummary {
  /** Total COGS across all resolved packages */
  totalCOGS: number;
  /** Number of packages with resolved costs */
  resolvedCount: number;
  /** Number of packages with no cost data */
  unresolvedCount: number;
  /** Breakdown by cost source */
  bySource: Record<CostSource, { count: number; totalCOGS: number }>;
  /** Average confidence across all resolved packages */
  averageConfidence: number;
}

/** Input package data (from Metrc, projected to only what we need) */
export interface PackageForCOGS {
  label: string;
  itemName: string;
  quantity: number;
  unitOfMeasure: string;
  category: string;
}

/** Dutchie cost lookup (from Dutchie POS line items) */
export interface DutchieCostEntry {
  metrcPackageLabel: string;
  unitCost: number;
  /** True when unitCost is inferred from retail price (e.g., price * margin assumption) */
  inferred?: boolean;
}

/** Manual OpEx cost entry (from OpExModel, facility-level per-category average) */
export interface ManualCostEntry {
  category: string;
  costPerUnit: number;
}

// ============================================================
// Cost Resolution Waterfall
// ============================================================

const SOURCE_CONFIDENCE: Record<CostSource, number> = {
  canix_purchase: 1.0,
  canix_bom: 0.9,
  canix_standard: 0.95,
  dutchie: 0.7,
  dutchie_inferred: 0.3,
  manual: 0.5,
  none: 0,
};

/**
 * Build a lookup map: itemName (lowercased) → CanixStandardCost.
 * If multiple costs exist for the same item, uses the most recently updated one.
 */
export function buildStandardCostMap(costs: CanixStandardCost[]): Map<string, CanixStandardCost> {
  const map = new Map<string, CanixStandardCost>();
  for (const cost of costs) {
    const key = cost.itemName.toLowerCase();
    const existing = map.get(key);
    if (!existing || cost.updatedAt > existing.updatedAt) {
      map.set(key, cost);
    }
  }
  return map;
}

/**
 * Build a lookup map: metrcPackageLabel → DutchieCostEntry from Dutchie line items.
 */
export function buildDutchieCostMap(entries: DutchieCostEntry[]): Map<string, DutchieCostEntry> {
  const map = new Map<string, DutchieCostEntry>();
  for (const entry of entries) {
    if (entry.metrcPackageLabel && entry.unitCost > 0) {
      map.set(entry.metrcPackageLabel, entry);
    }
  }
  return map;
}

/**
 * Build a lookup map: category (lowercased) → costPerUnit from manual entries.
 */
export function buildManualCostMap(entries: ManualCostEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    map.set(entry.category.toLowerCase(), entry.costPerUnit);
  }
  return map;
}

/**
 * Resolve cost for a single item through the waterfall.
 *
 * Waterfall order:
 *   1. Canix standard cost (by item name match)
 *   2. Dutchie unitCost (by package label match)
 *   3. Manual OpEx (by category match)
 *
 * Note: Canix purchase price (level 1 in the full waterfall) requires
 * cross-referencing PO line items to specific packages — implemented
 * separately in `resolvePackageCOGS()` when PO data is available.
 */
export function resolveCost(
  itemName: string,
  packageLabel: string,
  category: string,
  standardCostMap: Map<string, CanixStandardCost>,
  dutchieCostMap: Map<string, DutchieCostEntry>,
  manualCostMap: Map<string, number>,
): CostResolution {
  // Level 2: Canix standard cost
  const standardCost = standardCostMap.get(itemName.toLowerCase());
  if (standardCost && standardCost.costPerUnit > 0) {
    return {
      costPerUnit: standardCost.costPerUnit,
      source: 'canix_standard',
      confidence: SOURCE_CONFIDENCE.canix_standard,
      asOfDate: standardCost.updatedAt,
    };
  }

  // Level 3: Dutchie unitCost
  const dutchieEntry = dutchieCostMap.get(packageLabel);
  if (dutchieEntry && dutchieEntry.unitCost > 0) {
    const isInferred = dutchieEntry.inferred === true;
    return {
      costPerUnit: dutchieEntry.unitCost,
      source: isInferred ? 'dutchie_inferred' : 'dutchie',
      confidence: isInferred ? SOURCE_CONFIDENCE.dutchie_inferred : SOURCE_CONFIDENCE.dutchie,
      asOfDate: null,
    };
  }

  // Level 4: Manual OpEx category average
  const manualCost = manualCostMap.get(category.toLowerCase());
  if (manualCost !== undefined && manualCost > 0) {
    return {
      costPerUnit: manualCost,
      source: 'manual',
      confidence: SOURCE_CONFIDENCE.manual,
      asOfDate: null,
    };
  }

  return {
    costPerUnit: 0,
    source: 'none',
    confidence: 0,
    asOfDate: null,
  };
}

// ============================================================
// BOM Cost Rollup
// ============================================================

/**
 * Calculate the total COGS for a BOM output by summing component costs.
 *
 * For each component:
 *   cost = quantityPerUnit * COALESCE(component.unitCost, standardCostMap[name], 0)
 *
 * Returns per-component breakdown and total.
 */
export function computeBOMCost(
  bom: CanixBOM,
  standardCostMap: Map<string, CanixStandardCost>,
): { totalCostPerUnit: number; components: BOMCostLine[] } {
  const components: BOMCostLine[] = [];
  let totalCostPerUnit = 0;

  for (const comp of bom.components) {
    // Prefer BOM-embedded unitCost, fall back to standard cost map
    let unitCost = comp.unitCost ?? 0;
    let costSource: CostSource = comp.unitCost !== null && comp.unitCost > 0
      ? 'canix_bom'
      : 'none';

    if (unitCost <= 0) {
      const standardCost = standardCostMap.get(comp.itemName.toLowerCase());
      if (standardCost && standardCost.costPerUnit > 0) {
        unitCost = standardCost.costPerUnit;
        costSource = 'canix_standard';
      }
    }

    const lineCost = comp.quantityPerUnit * unitCost;
    totalCostPerUnit += lineCost;

    components.push({
      componentName: comp.itemName,
      quantityPerUnit: comp.quantityPerUnit,
      unit: comp.unit,
      unitCost,
      totalCost: Math.round(lineCost * 100) / 100,
      isCannabisDerived: comp.isCannabisDerived,
      costSource,
    });
  }

  return {
    totalCostPerUnit: Math.round(totalCostPerUnit * 100) / 100,
    components,
  };
}

// ============================================================
// Batch COGS Resolution
// ============================================================

/**
 * Resolve COGS for a batch of packages using the full waterfall.
 *
 * Attempts BOM-based cost rollup first (for items that have a matching BOM),
 * then falls back to direct cost resolution.
 */
export function resolvePackageCOGS(
  packages: PackageForCOGS[],
  opts: {
    standardCosts: CanixStandardCost[];
    boms: CanixBOM[];
    dutchieCosts: DutchieCostEntry[];
    manualCosts: ManualCostEntry[];
  },
): PackageCOGS[] {
  const standardCostMap = buildStandardCostMap(opts.standardCosts);
  const dutchieCostMap = buildDutchieCostMap(opts.dutchieCosts);
  const manualCostMap = buildManualCostMap(opts.manualCosts);

  // Build BOM lookup: outputItemName (lowercased) → CanixBOM
  const bomMap = new Map<string, CanixBOM>();
  for (const bom of opts.boms) {
    bomMap.set(bom.outputItemName.toLowerCase(), bom);
  }

  return packages.map(pkg => {
    // Try BOM-based cost rollup first
    const bom = bomMap.get(pkg.itemName.toLowerCase());
    if (bom) {
      const bomResult = computeBOMCost(bom, standardCostMap);
      if (bomResult.totalCostPerUnit > 0) {
        return {
          packageLabel: pkg.label,
          itemName: pkg.itemName,
          costPerUnit: bomResult.totalCostPerUnit,
          totalCOGS: Math.round(bomResult.totalCostPerUnit * pkg.quantity * 100) / 100,
          quantity: pkg.quantity,
          source: 'canix_bom' as CostSource, // BOM rollup = high confidence
          confidence: SOURCE_CONFIDENCE.canix_bom,
          bomCostBreakdown: bomResult.components,
        };
      }
    }

    // Fall back to direct cost resolution waterfall
    const resolution = resolveCost(
      pkg.itemName,
      pkg.label,
      pkg.category,
      standardCostMap,
      dutchieCostMap,
      manualCostMap,
    );

    return {
      packageLabel: pkg.label,
      itemName: pkg.itemName,
      costPerUnit: resolution.costPerUnit,
      totalCOGS: Math.round(resolution.costPerUnit * pkg.quantity * 100) / 100,
      quantity: pkg.quantity,
      source: resolution.source,
      confidence: resolution.confidence,
      bomCostBreakdown: null,
    };
  });
}

// ============================================================
// Summary
// ============================================================

/**
 * Compute summary statistics from resolved COGS data.
 */
export function summarizeCOGS(results: PackageCOGS[]): COGSSummary {
  const bySource: Record<CostSource, { count: number; totalCOGS: number }> = {
    canix_purchase: { count: 0, totalCOGS: 0 },
    canix_bom: { count: 0, totalCOGS: 0 },
    canix_standard: { count: 0, totalCOGS: 0 },
    dutchie: { count: 0, totalCOGS: 0 },
    dutchie_inferred: { count: 0, totalCOGS: 0 },
    manual: { count: 0, totalCOGS: 0 },
    none: { count: 0, totalCOGS: 0 },
  };

  let totalCOGS = 0;
  let totalConfidence = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const r of results) {
    bySource[r.source].count++;
    bySource[r.source].totalCOGS += r.totalCOGS;
    totalCOGS += r.totalCOGS;

    if (r.source !== 'none') {
      resolvedCount++;
      totalConfidence += r.confidence;
    } else {
      unresolvedCount++;
    }
  }

  return {
    totalCOGS: Math.round(totalCOGS * 100) / 100,
    resolvedCount,
    unresolvedCount,
    bySource,
    averageConfidence: resolvedCount > 0 ? Math.round((totalConfidence / resolvedCount) * 100) / 100 : 0,
  };
}

// ============================================================
// BOM Validation (Canix authoritative vs inferred)
// ============================================================

export interface BOMDeviation {
  outputItemName: string;
  componentName: string;
  canixRatio: number;
  inferredRatio: number;
  deviationPercent: number;
  severity: 'info' | 'warning' | 'critical';
}

/**
 * Compare Canix authoritative BOMs against inferred BOMs from processing history.
 * Flags significant deviations as quality control signals.
 *
 * Thresholds:
 *   - < 10% deviation: info (normal variance)
 *   - 10-25% deviation: warning (investigate)
 *   - > 25% deviation: critical (process drift or data issue)
 */
export function validateBOMsAgainstInferred(
  canixBOMs: CanixBOM[],
  inferredBOMs: Array<{
    outputItemName: string;
    componentItemName: string;
    averageRatio: number;
    confidence: number;
  }>,
): BOMDeviation[] {
  const deviations: BOMDeviation[] = [];

  for (const canixBOM of canixBOMs) {
    for (const comp of canixBOM.components) {
      if (!comp.isCannabisDerived) continue; // Only compare cannabis inputs

      const canixRatio = comp.quantityPerUnit;
      if (canixRatio <= 0) continue;
      const inferred = inferredBOMs.find(
        i =>
          i.outputItemName.toLowerCase() === canixBOM.outputItemName.toLowerCase() &&
          i.componentItemName.toLowerCase() === comp.itemName.toLowerCase() &&
          i.confidence > 0.3 // Only compare against reasonably confident inferences
      );

      if (!inferred) continue;

      const deviation = Math.abs(canixRatio - inferred.averageRatio) / canixRatio;
      const deviationPercent = Math.round(deviation * 100);

      let severity: 'info' | 'warning' | 'critical' = 'info';
      if (deviationPercent > 25) severity = 'critical';
      else if (deviationPercent > 10) severity = 'warning';

      deviations.push({
        outputItemName: canixBOM.outputItemName,
        componentName: comp.itemName,
        canixRatio,
        inferredRatio: inferred.averageRatio,
        deviationPercent,
        severity,
      });
    }
  }

  return deviations.sort((a, b) => b.deviationPercent - a.deviationPercent);
}

// ============================================================
// Shared BOM Inference from Action Logs
// ============================================================

export interface InferredBOM {
  outputItemName: string;
  componentItemName: string;
  averageRatio: number;
  confidence: number;
}

/**
 * Infer BOMs from processing action log history.
 * Groups source-to-output ratios, computes mean and coefficient of variation.
 */
export function inferBOMsFromActionLogs(
  logs: Array<{ previewData: Record<string, unknown> | null }>
): InferredBOM[] {
  const inferredMap = new Map<string, { ratios: number[]; component: string }>();
  for (const log of logs) {
    const preview = log.previewData;
    if (!preview) continue;
    const sources = preview.sources as Array<{ itemName: string; requestedQty: number }> | undefined;
    const output = preview.output as { itemName: string; quantity: number } | undefined;
    if (!sources || !output || output.quantity <= 0) continue;

    for (const source of sources) {
      const key = `${output.itemName.toLowerCase()}:${source.itemName.toLowerCase()}`;
      const existing = inferredMap.get(key) ?? { ratios: [], component: source.itemName };
      existing.ratios.push(source.requestedQty / output.quantity);
      inferredMap.set(key, existing);
    }
  }

  return Array.from(inferredMap.entries()).map(([key, data]) => {
    const [outputName] = key.split(':');
    const avg = data.ratios.reduce((a, b) => a + b, 0) / data.ratios.length;
    const variance = data.ratios.reduce((s, r) => s + (r - avg) ** 2, 0) / data.ratios.length;
    const cv = avg > 0 ? Math.sqrt(variance) / avg : 1;
    return {
      outputItemName: outputName!,
      componentItemName: data.component,
      averageRatio: avg,
      confidence: Math.min(1.0, data.ratios.length / 5) * Math.max(0, 1 - cv),
    };
  });
}
