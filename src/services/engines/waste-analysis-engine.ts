/**
 * Waste Analysis Engine
 *
 * Pure function engine that aggregates waste/loss data from multiple Metrc sources
 * (harvest waste, plant batch waste, package adjustments, plant destruction) into
 * unified time-series trends and analytics.
 *
 * No imports from React, Prisma, or tRPC — this is a pure computation module.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WasteSourceType = 'harvest' | 'plant_batch' | 'package_adjustment' | 'plant_destruction';

export interface WasteSource {
  type: WasteSourceType;
  date: string;
  weight: number;
  unit: string;
  reason: string;
  entityName: string;
  entityId: string;
}

export interface WasteTrendBucket {
  period: string;
  totalWeight: number;
  bySource: Record<WasteSourceType, number>;
  topReasons: { reason: string; weight: number; count: number }[];
}

export interface WasteAnalysis {
  totalWasteWeight: number;
  wasteRate: number;
  eventCount: number;
  bySource: {
    type: WasteSourceType;
    weight: number;
    count: number;
    pctOfTotal: number;
  }[];
  trends: WasteTrendBucket[];
  topReasons: { reason: string; weight: number; count: number }[];
  comparisonToPrevious: {
    previousWeight: number;
    currentWeight: number;
    changePct: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateKey(date: string, granularity: 'day' | 'week' | 'month'): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'unknown';

  if (granularity === 'day') {
    return d.toISOString().split('T')[0]!;
  }

  if (granularity === 'week') {
    // ISO week: Monday-based. Round down to Monday.
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    return monday.toISOString().split('T')[0]!;
  }

  // month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Aggregate waste sources from multiple Metrc data types.
 */
export function aggregateWasteSources(inputs: {
  harvestWaste?: { Id: number; HarvestId: number; WasteTypeName: string; WasteWeight: number; UnitOfWeightName: string; ActualDate: string }[];
  harvestNames?: Map<number, string>;
  plantBatchWaste?: { Id: number; PlantBatchId: number; PlantBatchName: string; WasteReasonName: string; WasteWeight: number; UnitOfWeightName: string; ActualDate: string }[];
  packageAdjustments?: { label: string; itemName: string; adjustmentReason: string; quantity: number; unit: string; date: string }[];
  plantDestructions?: { Id: number; Label: string; StrainName: string; DestroyedDate: string | null }[];
}): WasteSource[] {
  const sources: WasteSource[] = [];

  for (const w of inputs.harvestWaste ?? []) {
    sources.push({
      type: 'harvest',
      date: w.ActualDate || new Date().toISOString().split('T')[0]!,
      weight: w.WasteWeight,
      unit: w.UnitOfWeightName,
      reason: w.WasteTypeName,
      entityName: inputs.harvestNames?.get(w.HarvestId) ?? `Harvest #${w.HarvestId}`,
      entityId: String(w.Id),
    });
  }

  for (const w of inputs.plantBatchWaste ?? []) {
    sources.push({
      type: 'plant_batch',
      date: w.ActualDate || (w as Record<string, unknown>).LastModified as string || new Date().toISOString().split('T')[0]!,
      weight: w.WasteWeight,
      unit: w.UnitOfWeightName,
      reason: w.WasteReasonName,
      entityName: w.PlantBatchName,
      entityId: String(w.Id),
    });
  }

  for (const a of inputs.packageAdjustments ?? []) {
    if (a.quantity >= 0) continue; // Only negative adjustments are waste/loss
    sources.push({
      type: 'package_adjustment',
      date: a.date,
      weight: Math.abs(a.quantity),
      unit: a.unit,
      reason: a.adjustmentReason,
      entityName: `${a.itemName} (${a.label})`,
      entityId: a.label,
    });
  }

  for (const p of inputs.plantDestructions ?? []) {
    if (!p.DestroyedDate) continue;
    sources.push({
      type: 'plant_destruction',
      date: p.DestroyedDate,
      weight: 1, // Plants are counted, not weighed
      unit: 'Plants',
      reason: 'Destroyed',
      entityName: `${p.StrainName} (${p.Label})`,
      entityId: String(p.Id),
    });
  }

  return sources.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

/**
 * Compute time-series trends from waste sources.
 */
export function computeWasteTrends(
  sources: WasteSource[],
  granularity: 'day' | 'week' | 'month' = 'week',
  days: number = 90,
): WasteTrendBucket[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0]!;

  const filtered = sources.filter(s => s.date >= cutoffStr);

  // Group by period
  const bucketMap = new Map<string, { weight: number; bySource: Record<WasteSourceType, number>; reasons: Map<string, { weight: number; count: number }> }>();

  for (const s of filtered) {
    const key = toDateKey(s.date, granularity);
    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        weight: 0,
        bySource: { harvest: 0, plant_batch: 0, package_adjustment: 0, plant_destruction: 0 },
        reasons: new Map(),
      });
    }
    const bucket = bucketMap.get(key)!;
    bucket.weight += s.weight;
    bucket.bySource[s.type] += s.weight;

    const reasonEntry = bucket.reasons.get(s.reason) ?? { weight: 0, count: 0 };
    reasonEntry.weight += s.weight;
    reasonEntry.count += 1;
    bucket.reasons.set(s.reason, reasonEntry);
  }

  return Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, data]) => ({
      period,
      totalWeight: Math.round(data.weight * 100) / 100,
      bySource: data.bySource,
      topReasons: Array.from(data.reasons.entries())
        .map(([reason, stats]) => ({ reason, ...stats }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 5),
    }));
}

/**
 * Compute full waste analysis with KPIs, source breakdown, trends, and comparison.
 */
export function computeWasteAnalysis(
  sources: WasteSource[],
  totalPackagedWeight: number,
  days: number = 90,
  granularity: 'day' | 'week' | 'month' = 'week',
): WasteAnalysis {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0]!;

  const current = sources.filter(s => s.date >= cutoffStr);

  // Previous period for comparison
  const prevCutoff = new Date(cutoff);
  prevCutoff.setDate(prevCutoff.getDate() - days);
  const prevCutoffStr = prevCutoff.toISOString().split('T')[0]!;
  const previous = sources.filter(s => s.date >= prevCutoffStr && s.date < cutoffStr);

  const totalWasteWeight = Math.round(current.reduce((sum, s) => sum + s.weight, 0) * 100) / 100;
  const wasteRate = totalPackagedWeight > 0
    ? Math.round((totalWasteWeight / (totalPackagedWeight + totalWasteWeight)) * 10000) / 100
    : 0;

  // By source
  const sourceMap: Record<WasteSourceType, { weight: number; count: number }> = {
    harvest: { weight: 0, count: 0 },
    plant_batch: { weight: 0, count: 0 },
    package_adjustment: { weight: 0, count: 0 },
    plant_destruction: { weight: 0, count: 0 },
  };
  for (const s of current) {
    sourceMap[s.type].weight += s.weight;
    sourceMap[s.type].count += 1;
  }

  const bySource = (Object.keys(sourceMap) as WasteSourceType[]).map(type => ({
    type,
    weight: Math.round(sourceMap[type].weight * 100) / 100,
    count: sourceMap[type].count,
    pctOfTotal: totalWasteWeight > 0
      ? Math.round((sourceMap[type].weight / totalWasteWeight) * 10000) / 100
      : 0,
  }));

  // Top reasons
  const reasonMap = new Map<string, { weight: number; count: number }>();
  for (const s of current) {
    const entry = reasonMap.get(s.reason) ?? { weight: 0, count: 0 };
    entry.weight += s.weight;
    entry.count += 1;
    reasonMap.set(s.reason, entry);
  }
  const topReasons = Array.from(reasonMap.entries())
    .map(([reason, stats]) => ({ reason, weight: Math.round(stats.weight * 100) / 100, count: stats.count }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10);

  // Period-over-period comparison
  const previousWeight = Math.round(previous.reduce((sum, s) => sum + s.weight, 0) * 100) / 100;
  const comparisonToPrevious = previousWeight > 0
    ? {
        previousWeight,
        currentWeight: totalWasteWeight,
        changePct: Math.round(((totalWasteWeight - previousWeight) / previousWeight) * 10000) / 100,
      }
    : null;

  return {
    totalWasteWeight,
    wasteRate,
    eventCount: current.length,
    bySource,
    trends: computeWasteTrends(sources, granularity, days),
    topReasons,
    comparisonToPrevious,
  };
}
