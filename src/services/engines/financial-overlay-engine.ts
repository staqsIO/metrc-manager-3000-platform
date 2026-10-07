/**
 * Financial Overlay Engine
 *
 * Enriches operational data with dollar values using the COGS waterfall.
 * All functions are progressive — they return operational data PLUS financial
 * data when cost sources are available, and just operational data when not.
 *
 * This is the bridge between the DataFidelityProfile and the COGS engine.
 * UI components and Copilot tools call these functions to get enriched results
 * without needing to know the COGS waterfall internals.
 *
 * Pure functions — no React, no Prisma, no tRPC imports.
 */

import type { MetrcPackage, MetrcHarvest } from '../metrc/types';
import type { CostSource, PackageCOGS } from './cogs-engine';

// ============================================================
// Types
// ============================================================

export interface InventoryValuation {
  /** Total packages counted */
  totalPackages: number;
  /** Total weight/quantity across all packages */
  totalQuantity: number;
  /** Unit of measure (most common) */
  primaryUnit: string;
  /** Per-category breakdown with operational + optional financial data */
  categories: CategoryValuation[];
  /** Aggregate financial data (null when no cost data available) */
  financial: {
    totalEstimatedValue: number;
    resolvedPackageCount: number;
    unresolvedPackageCount: number;
    averageConfidence: number;
    highestSource: CostSource;
  } | null;
}

export interface CategoryValuation {
  category: string;
  packageCount: number;
  totalQuantity: number;
  unit: string;
  /** Estimated value (null when no cost data for this category) */
  estimatedValue: number | null;
  /** Cost source for this category's valuation */
  costSource: CostSource | null;
  /** Cost confidence (0-1) */
  confidence: number | null;
}

export interface PipelineValuation {
  stages: PipelineStageValuation[];
  totalWeight: number;
  totalEstimatedValue: number | null;
  /** Whether financial data was available */
  hasFinancialData: boolean;
}

export interface PipelineStageValuation {
  stage: string;
  packageCount: number;
  totalWeight: number;
  avgAgeDays: number;
  /** Estimated dollar value at this stage (null when no cost data) */
  estimatedValue: number | null;
  /** Percentage of total pipeline value */
  valuePercent: number | null;
}

export interface LossSignal {
  category: 'waste' | 'yield_drop' | 'idle_inventory' | 'lab_failures' | 'fifo_violations';
  /** Human-readable description */
  description: string;
  /** Operational metric (always available) */
  operationalMetric: string;
  /** Dollar impact (null when no cost data) */
  dollarImpact: number | null;
  /** Severity: how much should the operator care */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Recommended action */
  action: string;
}

export interface LossAnalysis {
  /** All identified loss signals, sorted by severity */
  signals: LossSignal[];
  /** Total estimated dollar loss (null when no cost data) */
  totalDollarLoss: number | null;
  /** Whether financial data enriched the analysis */
  hasFinancialData: boolean;
  /** Top 3 loss categories by severity */
  topLossCategories: string[];
}

// ============================================================
// Q1 — Inventory Valuation (Progressive)
// ============================================================

/**
 * Compute inventory valuation with progressive financial enrichment.
 * Always returns operational data (counts, weights, categories).
 * When COGS data is provided, adds dollar values per category and total.
 */
export function computeInventoryValuation(
  packages: MetrcPackage[],
  cogsResults?: PackageCOGS[] | null,
): InventoryValuation {
  // Build COGS lookup by package label
  const cogsMap = new Map<string, PackageCOGS>();
  if (cogsResults) {
    for (const cogs of cogsResults) {
      cogsMap.set(cogs.packageLabel, cogs);
    }
  }

  // Aggregate by category
  const catMap = new Map<string, {
    count: number;
    qty: number;
    unit: string;
    value: number;
    resolvedCount: number;
    totalConfidence: number;
    bestSource: CostSource;
  }>();

  let totalQty = 0;
  let totalValue = 0;
  let resolvedCount = 0;
  let totalConfidence = 0;

  const SOURCE_PRIORITY: Record<CostSource, number> = {
    canix_purchase: 6, canix_bom: 5, canix_standard: 4,
    dutchie: 3, dutchie_inferred: 2, manual: 1, none: 0,
  };

  for (const pkg of packages) {
    const cat = pkg.ItemCategory || 'Unknown';
    totalQty += pkg.Quantity ?? 0;

    const cogs = cogsMap.get(pkg.Label);
    const existing = catMap.get(cat);

    if (existing) {
      existing.count++;
      existing.qty += pkg.Quantity ?? 0;
      if (cogs && cogs.source !== 'none') {
        existing.value += cogs.totalCOGS;
        existing.resolvedCount++;
        existing.totalConfidence += cogs.confidence;
        if (SOURCE_PRIORITY[cogs.source] > SOURCE_PRIORITY[existing.bestSource]) {
          existing.bestSource = cogs.source;
        }
      }
    } else {
      catMap.set(cat, {
        count: 1,
        qty: pkg.Quantity ?? 0,
        unit: pkg.UnitOfMeasureName || 'Each',
        value: cogs && cogs.source !== 'none' ? cogs.totalCOGS : 0,
        resolvedCount: cogs && cogs.source !== 'none' ? 1 : 0,
        totalConfidence: cogs ? cogs.confidence : 0,
        bestSource: cogs?.source ?? 'none',
      });
    }

    if (cogs && cogs.source !== 'none') {
      totalValue += cogs.totalCOGS;
      resolvedCount++;
      totalConfidence += cogs.confidence;
    }
  }

  // Build category results
  const categories: CategoryValuation[] = [];
  catMap.forEach((data, category) => {
    categories.push({
      category,
      packageCount: data.count,
      totalQuantity: Math.round(data.qty * 100) / 100,
      unit: data.unit,
      estimatedValue: data.resolvedCount > 0 ? Math.round(data.value * 100) / 100 : null,
      costSource: data.resolvedCount > 0 ? data.bestSource : null,
      confidence: data.resolvedCount > 0 ? Math.round((data.totalConfidence / data.resolvedCount) * 100) / 100 : null,
    });
  });
  categories.sort((a, b) => b.packageCount - a.packageCount);

  // Determine most common unit
  const unitCounts = new Map<string, number>();
  for (const pkg of packages) {
    const u = pkg.UnitOfMeasureName || 'Each';
    unitCounts.set(u, (unitCounts.get(u) ?? 0) + 1);
  }
  let primaryUnit = 'Each';
  let maxUnitCount = 0;
  unitCounts.forEach((count, unit) => {
    if (count > maxUnitCount) { primaryUnit = unit; maxUnitCount = count; }
  });

  // Highest cost source across all resolved
  let highestSource: CostSource = 'none';
  catMap.forEach((data) => {
    if (SOURCE_PRIORITY[data.bestSource] > SOURCE_PRIORITY[highestSource]) {
      highestSource = data.bestSource;
    }
  });

  return {
    totalPackages: packages.length,
    totalQuantity: Math.round(totalQty * 100) / 100,
    primaryUnit,
    categories,
    financial: resolvedCount > 0 ? {
      totalEstimatedValue: Math.round(totalValue * 100) / 100,
      resolvedPackageCount: resolvedCount,
      unresolvedPackageCount: packages.length - resolvedCount,
      averageConfidence: Math.round((totalConfidence / resolvedCount) * 100) / 100,
      highestSource,
    } : null,
  };
}

// ============================================================
// Q21 — Pipeline Valuation (Progressive)
// ============================================================

/**
 * Enrich pipeline stage data with dollar values.
 * Takes existing pipeline stage summary and COGS results to add financial layer.
 */
export function computePipelineValuation(
  stageData: Array<{
    stage: string;
    packageCount: number;
    totalWeight: number;
    avgAgeDays: number;
    packageLabels: string[];
  }>,
  cogsResults?: PackageCOGS[] | null,
): PipelineValuation {
  const cogsMap = new Map<string, PackageCOGS>();
  if (cogsResults) {
    for (const cogs of cogsResults) {
      cogsMap.set(cogs.packageLabel, cogs);
    }
  }

  let totalWeight = 0;
  let totalValue = 0;
  let hasAnyFinancial = false;

  const stages = stageData.map((stage) => {
    totalWeight += stage.totalWeight;

    let stageValue = 0;
    let hasValue = false;

    for (const label of stage.packageLabels) {
      const cogs = cogsMap.get(label);
      if (cogs && cogs.source !== 'none') {
        stageValue += cogs.totalCOGS;
        hasValue = true;
      }
    }

    if (hasValue) {
      totalValue += stageValue;
      hasAnyFinancial = true;
    }

    return {
      stage: stage.stage,
      packageCount: stage.packageCount,
      totalWeight: Math.round(stage.totalWeight * 100) / 100,
      avgAgeDays: stage.avgAgeDays,
      estimatedValue: hasValue ? Math.round(stageValue * 100) / 100 : null,
      valuePercent: null as number | null, // computed below
    };
  });

  // Compute value percentages
  if (hasAnyFinancial && totalValue > 0) {
    for (const stage of stages) {
      if (stage.estimatedValue != null) {
        stage.valuePercent = Math.round((stage.estimatedValue / totalValue) * 1000) / 10;
      }
    }
  }

  return {
    stages,
    totalWeight: Math.round(totalWeight * 100) / 100,
    totalEstimatedValue: hasAnyFinancial ? Math.round(totalValue * 100) / 100 : null,
    hasFinancialData: hasAnyFinancial,
  };
}

// ============================================================
// Q27 — Loss Analysis (Progressive)
// ============================================================

/**
 * Identify operational loss signals and optionally enrich with dollar impact.
 * Always returns operational signals. Dollar values added when COGS data available.
 */
export function computeLossAnalysis(
  packages: MetrcPackage[],
  harvests: MetrcHarvest[],
  cogsResults?: PackageCOGS[] | null,
): LossAnalysis {
  const signals: LossSignal[] = [];
  const cogsMap = new Map<string, PackageCOGS>();
  if (cogsResults) {
    for (const cogs of cogsResults) {
      cogsMap.set(cogs.packageLabel, cogs);
    }
  }
  const hasFinancialData = cogsMap.size > 0;

  const now = Date.now();

  // 1. Waste rate from harvests
  let totalHarvestWeight = 0;
  let totalWasteWeight = 0;
  for (const h of harvests) {
    totalHarvestWeight += h.TotalPackagedWeight ?? h.CurrentWeight ?? 0;
    totalWasteWeight += h.TotalWasteWeight ?? 0;
  }
  if (totalHarvestWeight > 0) {
    const wasteRate = (totalWasteWeight / (totalHarvestWeight + totalWasteWeight)) * 100;
    if (wasteRate > 5) { // Flag if waste exceeds 5%
      signals.push({
        category: 'waste',
        description: 'Harvest waste rate above threshold',
        operationalMetric: `${Math.round(wasteRate * 10) / 10}% waste rate (${Math.round(totalWasteWeight)} / ${Math.round(totalHarvestWeight + totalWasteWeight)} total)`,
        dollarImpact: null, // Hard to value waste without input cost data
        severity: wasteRate > 15 ? 'critical' : wasteRate > 10 ? 'high' : 'medium',
        action: 'Review harvest and trimming processes for efficiency improvements',
      });
    }
  }

  // 2. Idle inventory (packages sitting > 90 days)
  const idlePackages = packages.filter((p) => {
    const age = Math.floor((now - new Date(p.PackagedDate).getTime()) / (1000 * 60 * 60 * 24));
    return age > 90;
  });
  if (idlePackages.length > 0) {
    let idleDollarValue: number | null = null;
    if (hasFinancialData) {
      idleDollarValue = 0;
      for (const pkg of idlePackages) {
        const cogs = cogsMap.get(pkg.Label);
        if (cogs && cogs.source !== 'none') idleDollarValue += cogs.totalCOGS;
      }
      if (idleDollarValue === 0) idleDollarValue = null;
    }

    const totalIdleQty = idlePackages.reduce((s, p) => s + (p.Quantity ?? 0), 0);
    signals.push({
      category: 'idle_inventory',
      description: `${idlePackages.length} packages sitting idle for 90+ days`,
      operationalMetric: `${idlePackages.length} packages, ${Math.round(totalIdleQty)} units idle`,
      dollarImpact: idleDollarValue ? Math.round(idleDollarValue * 100) / 100 : null,
      severity: idlePackages.length > 50 ? 'critical' : idlePackages.length > 20 ? 'high' : 'medium',
      action: 'Consider discounting, sampling out, or transferring idle inventory',
    });
  }

  // 3. Lab testing failures (packages on hold or failed)
  const onHoldPackages = packages.filter((p) => p.IsOnHold);
  if (onHoldPackages.length > 0) {
    let holdDollarValue: number | null = null;
    if (hasFinancialData) {
      holdDollarValue = 0;
      for (const pkg of onHoldPackages) {
        const cogs = cogsMap.get(pkg.Label);
        if (cogs && cogs.source !== 'none') holdDollarValue += cogs.totalCOGS;
      }
      if (holdDollarValue === 0) holdDollarValue = null;
    }

    signals.push({
      category: 'lab_failures',
      description: `${onHoldPackages.length} packages currently on hold`,
      operationalMetric: `${onHoldPackages.length} packages on hold — may require remediation or destruction`,
      dollarImpact: holdDollarValue ? Math.round(holdDollarValue * 100) / 100 : null,
      severity: onHoldPackages.length > 10 ? 'high' : 'medium',
      action: 'Review hold reasons; determine if remediation or destruction is needed',
    });
  }

  // 4. Very old packages (>180 days) — potential dead stock
  const deadStock = packages.filter((p) => {
    const age = Math.floor((now - new Date(p.PackagedDate).getTime()) / (1000 * 60 * 60 * 24));
    return age > 180;
  });
  if (deadStock.length > 0) {
    let deadDollarValue: number | null = null;
    if (hasFinancialData) {
      deadDollarValue = 0;
      for (const pkg of deadStock) {
        const cogs = cogsMap.get(pkg.Label);
        if (cogs && cogs.source !== 'none') deadDollarValue += cogs.totalCOGS;
      }
      if (deadDollarValue === 0) deadDollarValue = null;
    }

    signals.push({
      category: 'idle_inventory',
      description: `${deadStock.length} packages older than 180 days — likely dead stock`,
      operationalMetric: `${deadStock.length} packages, potential total write-off`,
      dollarImpact: deadDollarValue ? Math.round(deadDollarValue * 100) / 100 : null,
      severity: 'critical',
      action: 'Evaluate for destruction, deep discounting, or remediation before further value loss',
    });
  }

  // Sort by severity
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  signals.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

  // Total dollar loss
  let totalDollarLoss: number | null = null;
  if (hasFinancialData) {
    totalDollarLoss = 0;
    for (const s of signals) {
      if (s.dollarImpact != null) totalDollarLoss += s.dollarImpact;
    }
    if (totalDollarLoss === 0) totalDollarLoss = null;
  }

  // Top loss categories
  const categoryCounts = new Map<string, number>();
  for (const s of signals) {
    categoryCounts.set(s.category, (categoryCounts.get(s.category) ?? 0) + 1);
  }
  const topLossCategories: string[] = [];
  categoryCounts.forEach((_, cat) => { topLossCategories.push(cat); });

  return {
    signals,
    totalDollarLoss,
    hasFinancialData,
    topLossCategories: topLossCategories.slice(0, 3),
  };
}

// ============================================================
// Q4 — Expiring Material Value at Risk (Progressive)
// ============================================================

export interface ExpiringMaterialEntry {
  packageLabel: string;
  itemName: string;
  category: string;
  quantity: number;
  unit: string;
  /** Days until COA/material expiry */
  daysUntilExpiry: number;
  /** Age of the package in days */
  ageDays: number;
  /** Dollar value at risk (null when no cost data) */
  dollarValueAtRisk: number | null;
  /** Urgency band */
  urgency: 'critical' | 'warning' | 'watch';
}

export interface ExpiringMaterialResult {
  /** Packages at risk, sorted by urgency then days remaining */
  atRisk: ExpiringMaterialEntry[];
  /** Summary counts by urgency */
  byCriticality: { critical: number; warning: number; watch: number };
  /** Total weight at risk */
  totalWeightAtRisk: number;
  /** Total dollar value at risk (null when no cost data) */
  totalDollarValueAtRisk: number | null;
  /** Whether financial data enriched the analysis */
  hasFinancialData: boolean;
  /** Alert threshold used */
  thresholdDays: number;
}

/**
 * Q4: Identify packages at risk of expiring before processing.
 * Uses package age as a proxy for expiry risk (COA expiry = lab_date + state_window).
 */
export function computeExpiringMaterial(
  packages: MetrcPackage[],
  cogsResults?: PackageCOGS[] | null,
  options: { thresholdDays?: number } = {},
): ExpiringMaterialResult {
  const thresholdDays = options.thresholdDays ?? 45;
  const now = Date.now();

  const cogsMap = new Map<string, PackageCOGS>();
  if (cogsResults) {
    for (const c of cogsResults) cogsMap.set(c.packageLabel, c);
  }
  const hasFinancialData = cogsMap.size > 0;

  const atRisk: ExpiringMaterialEntry[] = [];
  let totalWeight = 0;
  let totalValue = 0;
  let hasAnyValue = false;

  for (const pkg of packages) {
    const ageDays = Math.floor((now - new Date(pkg.PackagedDate).getTime()) / (1000 * 60 * 60 * 24));

    // Use age > (365 - threshold) as expiry risk proxy
    // Packages older than ~320 days are within 45-day expiry window (365-day COA assumption)
    const estimatedDaysUntilExpiry = Math.max(0, 365 - ageDays);
    if (estimatedDaysUntilExpiry > thresholdDays) continue;

    const cogs = cogsMap.get(pkg.Label);
    const dollarValue = cogs && cogs.source !== 'none' ? cogs.totalCOGS : null;

    let urgency: ExpiringMaterialEntry['urgency'] = 'watch';
    if (estimatedDaysUntilExpiry <= 14) urgency = 'critical';
    else if (estimatedDaysUntilExpiry <= 30) urgency = 'warning';

    atRisk.push({
      packageLabel: pkg.Label,
      itemName: pkg.ItemName,
      category: pkg.ItemCategory || 'Unknown',
      quantity: pkg.Quantity ?? 0,
      unit: pkg.UnitOfMeasureName || 'Each',
      daysUntilExpiry: estimatedDaysUntilExpiry,
      ageDays,
      dollarValueAtRisk: dollarValue ? Math.round(dollarValue * 100) / 100 : null,
      urgency,
    });

    totalWeight += pkg.Quantity ?? 0;
    if (dollarValue != null) { totalValue += dollarValue; hasAnyValue = true; }
  }

  // Sort: critical first, then by days remaining ascending
  const urgencyOrder: Record<string, number> = { critical: 0, warning: 1, watch: 2 };
  atRisk.sort((a, b) => {
    const ud = (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2);
    return ud !== 0 ? ud : a.daysUntilExpiry - b.daysUntilExpiry;
  });

  return {
    atRisk: atRisk.slice(0, 50), // Top 50
    byCriticality: {
      critical: atRisk.filter(e => e.urgency === 'critical').length,
      warning: atRisk.filter(e => e.urgency === 'warning').length,
      watch: atRisk.filter(e => e.urgency === 'watch').length,
    },
    totalWeightAtRisk: Math.round(totalWeight * 100) / 100,
    totalDollarValueAtRisk: hasAnyValue ? Math.round(totalValue * 100) / 100 : null,
    hasFinancialData,
    thresholdDays,
  };
}

// ============================================================
// Q11 — Transfer Loss Analysis (Progressive)
// ============================================================

export interface TransferLossEntry {
  /** Harvest or processing stage name */
  stage: string;
  /** Input weight at this stage */
  inputWeight: number;
  /** Output weight at this stage */
  outputWeight: number;
  /** Weight lost */
  lossWeight: number;
  /** Loss as percentage of input */
  lossPercent: number;
  /** Dollar value of loss (null when no cost data) */
  dollarLoss: number | null;
}

export interface TransferLossResult {
  /** Loss at each identified stage */
  stages: TransferLossEntry[];
  /** Total weight loss across all stages */
  totalLossWeight: number;
  /** Total loss as percentage of original harvest weight */
  totalLossPercent: number;
  /** Total dollar loss (null when no cost data) */
  totalDollarLoss: number | null;
  /** Whether financial data enriched the analysis */
  hasFinancialData: boolean;
  /** Stage with the highest loss percentage */
  worstStage: string | null;
}

/**
 * Q11: Calculate transfer loss from harvest through to final product.
 * Uses harvest waste + package quantity deltas as loss proxies.
 */
export function computeTransferLoss(
  harvests: MetrcHarvest[],
  packages: MetrcPackage[],
  cogsResults?: PackageCOGS[] | null,
): TransferLossResult {
  const cogsMap = new Map<string, PackageCOGS>();
  if (cogsResults) {
    for (const c of cogsResults) cogsMap.set(c.packageLabel, c);
  }
  const hasFinancialData = cogsMap.size > 0;

  // Stage 1: Harvest → Post-harvest (waste loss)
  let totalHarvestGross = 0;
  let totalWaste = 0;
  let totalPackagedFromHarvest = 0;

  for (const h of harvests) {
    const gross = (h.TotalPackagedWeight ?? 0) + (h.TotalWasteWeight ?? 0);
    totalHarvestGross += gross;
    totalWaste += h.TotalWasteWeight ?? 0;
    totalPackagedFromHarvest += h.TotalPackagedWeight ?? 0;
  }

  const stages: TransferLossEntry[] = [];

  if (totalHarvestGross > 0) {
    stages.push({
      stage: 'Harvest → Packaged',
      inputWeight: Math.round(totalHarvestGross * 100) / 100,
      outputWeight: Math.round(totalPackagedFromHarvest * 100) / 100,
      lossWeight: Math.round(totalWaste * 100) / 100,
      lossPercent: Math.round((totalWaste / totalHarvestGross) * 1000) / 10,
      dollarLoss: null, // Waste doesn't have COGS
    });
  }

  // Stage 2: Raw material → Finished goods (processing loss)
  const RAW_CATS = new Set(['buds', 'flower', 'trim', 'shake', 'biomass', 'whole plant',
    'wet whole plant', 'fresh frozen', 'crude', 'crude oil', 'shake/trim']);

  let rawWeight = 0;
  let finishedWeight = 0;
  let finishedDollarValue = 0;

  for (const pkg of packages) {
    const cat = (pkg.ItemCategory || '').toLowerCase();
    if (RAW_CATS.has(cat)) {
      rawWeight += pkg.Quantity ?? 0;
    } else {
      finishedWeight += pkg.Quantity ?? 0;
      const cogs = cogsMap.get(pkg.Label);
      if (cogs && cogs.source !== 'none') finishedDollarValue += cogs.totalCOGS;
    }
  }

  const totalInventoryWeight = rawWeight + finishedWeight;
  if (totalInventoryWeight > 0 && rawWeight > 0) {
    // Processing loss is implicit: raw material that hasn't become finished goods
    const processingLoss = totalPackagedFromHarvest > 0
      ? Math.max(0, totalPackagedFromHarvest - totalInventoryWeight)
      : 0;

    if (processingLoss > 0) {
      stages.push({
        stage: 'Processing Loss',
        inputWeight: Math.round(totalPackagedFromHarvest * 100) / 100,
        outputWeight: Math.round(totalInventoryWeight * 100) / 100,
        lossWeight: Math.round(processingLoss * 100) / 100,
        lossPercent: totalPackagedFromHarvest > 0
          ? Math.round((processingLoss / totalPackagedFromHarvest) * 1000) / 10
          : 0,
        dollarLoss: null, // Hard to attribute dollar value to processing loss
      });
    }
  }

  // Totals
  const totalLoss = stages.reduce((s, st) => s + st.lossWeight, 0);
  const totalInput = totalHarvestGross > 0 ? totalHarvestGross : totalInventoryWeight;
  const totalLossPercent = totalInput > 0 ? Math.round((totalLoss / totalInput) * 1000) / 10 : 0;

  let worstStage: string | null = null;
  let worstLoss = 0;
  for (const s of stages) {
    if (s.lossPercent > worstLoss) { worstLoss = s.lossPercent; worstStage = s.stage; }
  }

  return {
    stages,
    totalLossWeight: Math.round(totalLoss * 100) / 100,
    totalLossPercent,
    totalDollarLoss: hasFinancialData && finishedDollarValue > 0 ? null : null, // Conservative — don't speculate
    hasFinancialData,
    worstStage,
  };
}
