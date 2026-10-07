/**
 * Operational Intelligence Engine
 *
 * Computes the 4 missing Group A (purely operational) analytics
 * from the Operator Question Framework v5:
 *
 *   Q16 — Harvest Forecast: projected harvest dates from plant batch age + strain history
 *   Q17 — Cycle Time: days per growth phase (clone → veg → flower → harvest) by strain
 *   Q19 — Throughput vs Intake: harvest intake rate vs processing output rate + backlog
 *   Q26 — Plant Compliance: plant counts vs license limits, phase duration alerts
 *
 * Pure functions — no React, no Prisma, no tRPC imports.
 */

import type { MetrcPlantBatch, MetrcHarvest, MetrcPackage } from '../metrc/types';

// ============================================================
// Shared Types
// ============================================================

/** Minimal plant record for computations */
interface PlantInput {
  Id: number;
  Label: string;
  StrainName: string;
  GrowthPhase: string;
  PlantedDate: string;
  VegetativeDate?: string | null;
  FloweringDate?: string | null;
  HarvestedDate?: string | null;
  LocationName: string;
  IsOnHold: boolean;
}

// ============================================================
// Q16 — Harvest Forecast
// ============================================================

export interface HarvestForecastEntry {
  /** Plant batch name or ID */
  batchName: string;
  strainName: string;
  plantCount: number;
  /** Date entered flowering phase */
  floweringStartDate: string | null;
  /** Days in current phase so far */
  daysInCurrentPhase: number;
  /** Average days from flower start to harvest for this strain (from history) */
  avgDaysInFlower: number | null;
  /** Projected harvest date (floweringStart + avgDaysInFlower) */
  projectedHarvestDate: string | null;
  /** Days until projected harvest (negative = overdue) */
  daysUntilHarvest: number | null;
  /** Whether this batch is projected to be ready within the forecast window */
  withinWindow: boolean;
  /** Estimated yield in weight units (historical avg per plant × count) */
  estimatedYield: number | null;
}

export interface HarvestForecastResult {
  /** Batches projected to be ready within the window */
  upcoming: HarvestForecastEntry[];
  /** All flowering batches with projections */
  allFlowering: HarvestForecastEntry[];
  /** Strains with no harvest history (cannot project) */
  strainsWithoutHistory: string[];
  /** Forecast window in days */
  windowDays: number;
}

/**
 * Build strain-level historical averages from completed harvests.
 * Returns: Map<strainName (lowercase), { avgDaysInFlower, avgYieldPerPlant }>
 */
function buildStrainHistoryMap(
  harvests: MetrcHarvest[],
  plantBatches: MetrcPlantBatch[],
): Map<string, { avgDaysInFlower: number; avgYieldPerPlant: number }> {
  // Group completed harvests by strain
  const strainData = new Map<string, { flowerDays: number[]; yieldPerPlant: number[] }>();

  for (const harvest of harvests) {
    if (!harvest.FinishedDate || !harvest.SourceStrainNames) continue;

    const strainKey = harvest.SourceStrainNames.toLowerCase().trim();
    if (!strainData.has(strainKey)) {
      strainData.set(strainKey, { flowerDays: [], yieldPerPlant: [] });
    }

    const data = strainData.get(strainKey)!;

    // Try to find the matching plant batch to get flowering date
    const matchingBatch = plantBatches.find(
      b => b.StrainName?.toLowerCase().trim() === strainKey
        && b.HarvestedCount != null && b.HarvestedCount > 0,
    );

    if (matchingBatch) {
      // Estimate flower duration from harvest date - planted date (rough proxy)
      const harvestDate = new Date(harvest.HarvestStartDate);
      const plantedDate = new Date(matchingBatch.PlantedDate);
      const totalDays = Math.floor((harvestDate.getTime() - plantedDate.getTime()) / (1000 * 60 * 60 * 24));
      // Assume ~60% of total cycle is flowering (industry standard for photoperiod strains)
      const estimatedFlowerDays = Math.round(totalDays * 0.6);
      if (estimatedFlowerDays > 0 && estimatedFlowerDays < 200) {
        data.flowerDays.push(estimatedFlowerDays);
      }
    }

    // Yield per plant estimate
    const totalWeight = harvest.TotalPackagedWeight ?? harvest.CurrentWeight ?? 0;
    const plantCount = harvest.PackageCount ?? 1; // rough proxy
    if (totalWeight > 0 && plantCount > 0) {
      data.yieldPerPlant.push(totalWeight / plantCount);
    }
  }

  const result = new Map<string, { avgDaysInFlower: number; avgYieldPerPlant: number }>();
  strainData.forEach((data, strain) => {
    if (data.flowerDays.length === 0) return;
    const avgFlower = data.flowerDays.reduce((a: number, b: number) => a + b, 0) / data.flowerDays.length;
    const avgYield = data.yieldPerPlant.length > 0
      ? data.yieldPerPlant.reduce((a: number, b: number) => a + b, 0) / data.yieldPerPlant.length
      : 0;
    result.set(strain, { avgDaysInFlower: Math.round(avgFlower), avgYieldPerPlant: avgYield });
  });

  return result;
}

/**
 * Q16: Project which plant batches are ready to harvest within the next N days.
 */
export function computeHarvestForecast(
  activeBatches: MetrcPlantBatch[],
  historicalHarvests: MetrcHarvest[],
  allBatches: MetrcPlantBatch[],
  options: { windowDays?: number } = {},
): HarvestForecastResult {
  const windowDays = options.windowDays ?? 14;
  const now = Date.now();
  const strainHistory = buildStrainHistoryMap(historicalHarvests, allBatches);
  const strainsWithoutHistory = new Set<string>();

  const allFlowering: HarvestForecastEntry[] = [];

  for (const batch of activeBatches) {
    if ((batch.Count ?? 0) <= 0) continue;

    const strainKey = (batch.StrainName ?? '').toLowerCase().trim();
    const plantedDate = new Date(batch.PlantedDate);
    const daysInCurrentPhase = Math.floor((now - plantedDate.getTime()) / (1000 * 60 * 60 * 24));

    const history = strainHistory.get(strainKey);
    if (!history) {
      strainsWithoutHistory.add(batch.StrainName ?? 'Unknown');
    }

    const avgDaysInFlower = history?.avgDaysInFlower ?? null;

    // Project harvest date: planted + total estimated cycle
    // If we have avg flower days, assume planted + (avgFlower / 0.6) for total cycle
    let projectedHarvestDate: string | null = null;
    let daysUntilHarvest: number | null = null;

    if (avgDaysInFlower != null) {
      const totalCycleDays = Math.round(avgDaysInFlower / 0.6);
      const projected = new Date(plantedDate.getTime() + totalCycleDays * 24 * 60 * 60 * 1000);
      projectedHarvestDate = projected.toISOString().split('T')[0]!;
      daysUntilHarvest = Math.floor((projected.getTime() - now) / (1000 * 60 * 60 * 24));
    }

    const estimatedYield = history?.avgYieldPerPlant
      ? Math.round(history.avgYieldPerPlant * (batch.Count ?? 0) * 100) / 100
      : null;

    const entry: HarvestForecastEntry = {
      batchName: batch.Name,
      strainName: batch.StrainName ?? 'Unknown',
      plantCount: batch.Count ?? 0,
      floweringStartDate: null, // Not directly available on batch
      daysInCurrentPhase,
      avgDaysInFlower,
      projectedHarvestDate,
      daysUntilHarvest,
      withinWindow: daysUntilHarvest != null && daysUntilHarvest >= 0 && daysUntilHarvest <= windowDays,
      estimatedYield,
    };

    allFlowering.push(entry);
  }

  // Sort by days until harvest ascending (soonest first)
  allFlowering.sort((a, b) => (a.daysUntilHarvest ?? 999) - (b.daysUntilHarvest ?? 999));

  return {
    upcoming: allFlowering.filter(e => e.withinWindow),
    allFlowering,
    strainsWithoutHistory: Array.from(strainsWithoutHistory),
    windowDays,
  };
}

// ============================================================
// Q17 — Cycle Time by Strain
// ============================================================

export interface StrainCycleTime {
  strainName: string;
  /** Number of completed harvests analyzed */
  harvestCount: number;
  /** Average total days from plant to harvest */
  avgTotalDays: number;
  /** Median total days */
  medianTotalDays: number;
  /** Standard deviation */
  stdDevDays: number;
  /** Min and max observed cycle times */
  minDays: number;
  maxDays: number;
  /** Trend direction over recent harvests */
  trend: 'improving' | 'stable' | 'worsening' | 'insufficient_data';
}

export interface CycleTimeResult {
  /** Per-strain cycle time analysis */
  strains: StrainCycleTime[];
  /** Overall average across all strains */
  overallAvgDays: number;
  /** Strains with cycle time increasing (potential issue) */
  worseningStrains: string[];
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function stdDev(arr: number[], mean: number): number {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/**
 * Q17: Compute average cycle time (days from plant to harvest) per strain.
 */
export function computeCycleTime(
  harvests: MetrcHarvest[],
  plantBatches: MetrcPlantBatch[],
): CycleTimeResult {
  // Build batch lookup by strain for planted dates
  const batchesByStrain = new Map<string, MetrcPlantBatch[]>();
  for (const batch of plantBatches) {
    const key = (batch.StrainName ?? '').toLowerCase().trim();
    if (!batchesByStrain.has(key)) batchesByStrain.set(key, []);
    batchesByStrain.get(key)!.push(batch);
  }

  // Group completed harvests by strain and compute cycle days
  const strainCycles = new Map<string, { days: number[]; dates: Date[] }>();

  for (const harvest of harvests) {
    if (!harvest.FinishedDate || !harvest.SourceStrainNames) continue;

    const strainKey = harvest.SourceStrainNames.toLowerCase().trim();
    const harvestDate = new Date(harvest.HarvestStartDate);
    const batches = batchesByStrain.get(strainKey) ?? [];

    // Find the best matching batch (closest planted date before harvest)
    let bestBatch: MetrcPlantBatch | null = null;
    let bestDiff = Infinity;
    for (const batch of batches) {
      const planted = new Date(batch.PlantedDate);
      const diff = harvestDate.getTime() - planted.getTime();
      if (diff > 0 && diff < bestDiff) {
        bestDiff = diff;
        bestBatch = batch;
      }
    }

    if (bestBatch) {
      const cycleDays = Math.floor(bestDiff / (1000 * 60 * 60 * 24));
      if (cycleDays > 0 && cycleDays < 365) { // sanity check
        if (!strainCycles.has(strainKey)) strainCycles.set(strainKey, { days: [], dates: [] });
        const data = strainCycles.get(strainKey)!;
        data.days.push(cycleDays);
        data.dates.push(harvestDate);
      }
    }
  }

  const strains: StrainCycleTime[] = [];
  const allDays: number[] = [];

  strainCycles.forEach((data, strainKey) => {
    if (data.days.length === 0) return;

    const avg = data.days.reduce((a: number, b: number) => a + b, 0) / data.days.length;
    allDays.push(...data.days);

    // Trend: compare first half avg to second half avg
    let trend: StrainCycleTime['trend'] = 'insufficient_data';
    if (data.days.length >= 4) {
      // Sort by harvest date
      const sorted = data.dates
        .map((d: Date, i: number) => ({ date: d, days: data.days[i]! }))
        .sort((a: { date: Date }, b: { date: Date }) => a.date.getTime() - b.date.getTime());

      const halfIdx = Math.floor(sorted.length / 2);
      const firstHalf = sorted.slice(0, halfIdx).map((s: { days: number }) => s.days);
      const secondHalf = sorted.slice(halfIdx).map((s: { days: number }) => s.days);
      const firstAvg = firstHalf.reduce((a: number, b: number) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a: number, b: number) => a + b, 0) / secondHalf.length;

      const delta = ((secondAvg - firstAvg) / firstAvg) * 100;
      if (delta > 10) trend = 'worsening';
      else if (delta < -10) trend = 'improving';
      else trend = 'stable';
    }

    const originalName = strainKey;

    strains.push({
      strainName: originalName,
      harvestCount: data.days.length,
      avgTotalDays: Math.round(avg),
      medianTotalDays: Math.round(median(data.days)),
      stdDevDays: Math.round(stdDev(data.days, avg) * 10) / 10,
      minDays: Math.min(...data.days),
      maxDays: Math.max(...data.days),
      trend,
    });
  });

  strains.sort((a, b) => b.harvestCount - a.harvestCount);

  return {
    strains,
    overallAvgDays: allDays.length > 0
      ? Math.round(allDays.reduce((a: number, b: number) => a + b, 0) / allDays.length)
      : 0,
    worseningStrains: strains.filter(s => s.trend === 'worsening').map(s => s.strainName),
  };
}

// ============================================================
// Q19 — Throughput vs Intake Rate
// ============================================================

export interface ThroughputAnalysis {
  /** Average material intake (weight per week) — from harvests or incoming transfers */
  avgWeeklyIntake: number;
  /** Average processing output (finished goods weight per week) */
  avgWeeklyOutput: number;
  /** Current raw material backlog weight */
  rawMaterialBacklog: number;
  /** Weeks to clear backlog at current processing rate */
  weeksToClearBacklog: number | null;
  /** Whether backlog is growing (intake > output) */
  backlogGrowing: boolean;
  /** Rate of backlog growth/shrinkage per week */
  backlogDeltaPerWeek: number;
  /** Unit of weight used */
  unitOfWeight: string;
  /** Number of days in the analysis window */
  analysisWindowDays: number;
  /** Imbalance severity */
  severity: 'balanced' | 'mild_imbalance' | 'significant_imbalance' | 'critical';
  /** Source of intake data — helps UI label the metric correctly */
  intakeSource: 'harvests' | 'packages' | 'mixed';
}

/** Categories that represent raw/unprocessed material */
const RAW_MATERIAL_CATEGORIES = new Set([
  'buds', 'flower', 'trim', 'shake', 'biomass', 'whole plant', 'wet whole plant',
  'fresh frozen', 'harvest waste', 'plant waste', 'crude', 'crude oil',
  'buds (each)', 'shake/trim', 'shake/trim (each)',
]);

function isRawMaterial(category: string): boolean {
  return RAW_MATERIAL_CATEGORIES.has(category.toLowerCase());
}

/**
 * Q19: Compare material intake rate against processing output rate.
 *
 * Works for ALL facility types:
 * - Cultivator/Microbusiness: intake = harvest weight
 * - Manufacturer: intake = raw material packages created (received via transfers)
 * - Mixed: uses whichever source has data, or both
 */
export function computeThroughputAnalysis(
  completedHarvests: MetrcHarvest[],
  activePackages: MetrcPackage[],
  options: { windowDays?: number } = {},
): ThroughputAnalysis {
  const windowDays = options.windowDays ?? 60;
  const now = Date.now();
  const windowStart = now - windowDays * 24 * 60 * 60 * 1000;
  const weeks = windowDays / 7;

  // 1a. Harvest-based intake (Cultivator / Microbusiness)
  const harvestsInWindow = completedHarvests.filter(h => {
    const date = new Date(h.HarvestStartDate).getTime();
    return date >= windowStart && date <= now;
  });

  const totalHarvestWeight = harvestsInWindow.reduce(
    (sum, h) => sum + (h.TotalPackagedWeight ?? h.CurrentWeight ?? 0),
    0,
  );

  // 1b. Package-based intake (Manufacturing / any facility receiving material)
  // Raw material packages created in the window = material received via transfers or harvests
  const rawMaterialCreatedInWindow = activePackages.filter(p => {
    const date = new Date(p.PackagedDate).getTime();
    return date >= windowStart && date <= now && isRawMaterial(p.ItemCategory || '');
  });

  const totalRawMaterialIntake = rawMaterialCreatedInWindow.reduce(
    (sum, p) => sum + (p.Quantity ?? 0),
    0,
  );

  // Use whichever intake source has data; prefer harvests when both exist
  let avgWeeklyIntake: number;
  let intakeSource: ThroughputAnalysis['intakeSource'];

  if (totalHarvestWeight > 0 && totalRawMaterialIntake > 0) {
    // Both sources — use harvest weight (more authoritative, avoid double-counting)
    avgWeeklyIntake = weeks > 0 ? Math.round((totalHarvestWeight / weeks) * 100) / 100 : 0;
    intakeSource = 'mixed';
  } else if (totalHarvestWeight > 0) {
    avgWeeklyIntake = weeks > 0 ? Math.round((totalHarvestWeight / weeks) * 100) / 100 : 0;
    intakeSource = 'harvests';
  } else {
    // Manufacturing: use raw material packages as intake proxy
    avgWeeklyIntake = weeks > 0 ? Math.round((totalRawMaterialIntake / weeks) * 100) / 100 : 0;
    intakeSource = 'packages';
  }

  // 2. Calculate processing output rate (finished goods created per week)
  const finishedInWindow = activePackages.filter(p => {
    const date = new Date(p.PackagedDate).getTime();
    return date >= windowStart && date <= now && !isRawMaterial(p.ItemCategory || '');
  });

  const totalOutputWeight = finishedInWindow.reduce(
    (sum, p) => sum + (p.Quantity ?? 0),
    0,
  );

  const avgWeeklyOutput = weeks > 0 ? Math.round((totalOutputWeight / weeks) * 100) / 100 : 0;

  // 3. Calculate raw material backlog
  const rawMaterialBacklog = activePackages
    .filter(p => isRawMaterial(p.ItemCategory || ''))
    .reduce((sum, p) => sum + (p.Quantity ?? 0), 0);

  // 4. Derived metrics
  const backlogDeltaPerWeek = Math.round((avgWeeklyIntake - avgWeeklyOutput) * 100) / 100;
  const backlogGrowing = backlogDeltaPerWeek > 0;
  const weeksToClearBacklog = avgWeeklyOutput > 0
    ? Math.round((rawMaterialBacklog / avgWeeklyOutput) * 10) / 10
    : null;

  // 5. Severity classification
  let severity: ThroughputAnalysis['severity'] = 'balanced';
  if (avgWeeklyOutput === 0 && rawMaterialBacklog > 0) {
    severity = 'critical';
  } else if (avgWeeklyIntake > 0 && avgWeeklyOutput > 0) {
    const ratio = avgWeeklyIntake / avgWeeklyOutput;
    if (ratio > 2.0) severity = 'critical';
    else if (ratio > 1.5) severity = 'significant_imbalance';
    else if (ratio > 1.15) severity = 'mild_imbalance';
  }

  // Detect unit from available data
  const unitOfWeight = harvestsInWindow[0]?.UnitOfWeightName
    ?? rawMaterialCreatedInWindow[0]?.UnitOfMeasureName
    ?? 'Grams';

  return {
    avgWeeklyIntake,
    avgWeeklyOutput,
    rawMaterialBacklog: Math.round(rawMaterialBacklog * 100) / 100,
    weeksToClearBacklog,
    backlogGrowing,
    backlogDeltaPerWeek,
    unitOfWeight,
    analysisWindowDays: windowDays,
    severity,
    intakeSource,
  };
}

// ============================================================
// Q26 — Plant Compliance
// ============================================================

export interface PlantComplianceAlert {
  type: 'approaching_limit' | 'at_limit' | 'over_limit' | 'untagged_plants' | 'phase_duration';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  /** Current value */
  current: number;
  /** Limit value (if applicable) */
  limit?: number;
  /** Percentage of limit used */
  percentUsed?: number;
}

export interface PlantComplianceResult {
  /** Total active plant count */
  totalPlants: number;
  /** Plants by growth phase */
  byPhase: { phase: string; count: number }[];
  /** Plant license limit (if provided) */
  plantLimit: number | null;
  /** Percentage of license used */
  percentUsed: number | null;
  /** Compliance alerts */
  alerts: PlantComplianceAlert[];
  /** Count of plants on hold */
  onHoldCount: number;
  /** Count of untagged plants (in batches but not individually tagged) */
  untrackedCount: number;
}

/**
 * Q26: Check plant counts against license limits and flag compliance risks.
 */
export function computePlantCompliance(
  plants: PlantInput[],
  plantBatches: MetrcPlantBatch[],
  options: {
    /** License plant limit (operator-provided) */
    plantLimit?: number;
    /** Warning threshold as percentage (default: 85%) */
    warningThreshold?: number;
    /** Critical threshold as percentage (default: 95%) */
    criticalThreshold?: number;
  } = {},
): PlantComplianceResult {
  const plantLimit = options.plantLimit ?? null;
  const warningThreshold = options.warningThreshold ?? 85;
  const criticalThreshold = options.criticalThreshold ?? 95;

  // Count by phase
  const phaseMap = new Map<string, number>();
  let onHoldCount = 0;

  for (const plant of plants) {
    const phase = plant.GrowthPhase ?? 'Unknown';
    phaseMap.set(phase, (phaseMap.get(phase) ?? 0) + 1);
    if (plant.IsOnHold) onHoldCount++;
  }

  const byPhase: { phase: string; count: number }[] = [];
  phaseMap.forEach((count, phase) => { byPhase.push({ phase, count }); });
  byPhase.sort((a, b) => b.count - a.count);

  const totalPlants = plants.length;

  // Untracked plants from batches
  const untrackedCount = plantBatches.reduce(
    (sum, b) => sum + (b.UntrackedCount ?? 0),
    0,
  );

  // Build alerts
  const alerts: PlantComplianceAlert[] = [];

  if (plantLimit != null && plantLimit > 0) {
    const percentUsed = (totalPlants / plantLimit) * 100;

    if (totalPlants > plantLimit) {
      alerts.push({
        type: 'over_limit',
        severity: 'critical',
        message: `Plant count (${totalPlants}) exceeds license limit (${plantLimit}) by ${totalPlants - plantLimit} plants`,
        current: totalPlants,
        limit: plantLimit,
        percentUsed,
      });
    } else if (percentUsed >= criticalThreshold) {
      alerts.push({
        type: 'at_limit',
        severity: 'critical',
        message: `Plant count at ${Math.round(percentUsed)}% of license limit (${totalPlants}/${plantLimit})`,
        current: totalPlants,
        limit: plantLimit,
        percentUsed,
      });
    } else if (percentUsed >= warningThreshold) {
      alerts.push({
        type: 'approaching_limit',
        severity: 'warning',
        message: `Plant count at ${Math.round(percentUsed)}% of license limit (${totalPlants}/${plantLimit})`,
        current: totalPlants,
        limit: plantLimit,
        percentUsed,
      });
    }
  }

  if (untrackedCount > 0) {
    alerts.push({
      type: 'untagged_plants',
      severity: 'warning',
      message: `${untrackedCount} plants in batches are not individually tracked/tagged in Metrc`,
      current: untrackedCount,
    });
  }

  // On-hold plants
  if (onHoldCount > 0) {
    alerts.push({
      type: 'phase_duration',
      severity: 'info',
      message: `${onHoldCount} plants currently on hold`,
      current: onHoldCount,
    });
  }

  const percentUsed = plantLimit != null && plantLimit > 0
    ? Math.round((totalPlants / plantLimit) * 1000) / 10
    : null;

  return {
    totalPlants,
    byPhase,
    plantLimit,
    percentUsed,
    alerts,
    onHoldCount,
    untrackedCount,
  };
}
