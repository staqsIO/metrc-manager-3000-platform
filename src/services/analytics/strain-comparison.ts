// ---------------------------------------------------------------------------
// Cross-Facility Strain Comparison Engine (FOR-1186)
//
// Pure-function module — no React, no Prisma, no tRPC.
// Normalizes strain names and aggregates per-facility strain metrics
// into a comparison matrix with significant difference detection.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerStrainMetrics {
  rawName: string;
  avgYieldEfficiency: number;
  labPassRate: number;  // 0.0-1.0
  avgGrowthDays: number;
  harvestCount: number;
  labTestCount: number;
}

export interface PerFacilityStrainMetrics {
  facilityId: string;
  facilityName: string;
  stateCode: string;
  strains: PerStrainMetrics[];
}

export interface StrainFacilityMetrics {
  facilityId: string;
  facilityName: string;
  stateCode: string;
  avgYieldEfficiency: number;
  labPassRate: number;
  avgGrowthDays: number;
  harvestCount: number;
}

export interface StrainComparisonEntry {
  normalizedName: string;
  displayName: string;  // most common raw name variant
  facilities: StrainFacilityMetrics[];
  crossFacilityAvg: {
    yieldEfficiency: number;
    labPassRate: number;
    growthDays: number;
  };
}

export type SignificantMetric = 'yieldEfficiency' | 'labPassRate' | 'growthDays';

export interface SignificantDifference {
  strainName: string;
  metric: SignificantMetric;
  facilityId: string;
  facilityName: string;
  value: number;
  crossFacilityAvg: number;
  deltaPct: number;  // positive = above avg, negative = below avg
}

export interface CrossFacilityStrainComparison {
  strains: StrainComparisonEntry[];
  facilities: { id: string; name: string; stateCode: string }[];
  significantDifferences: SignificantDifference[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// 1. normalizeStrainName
// ---------------------------------------------------------------------------

export function normalizeStrainName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')                                      // collapse whitespace
    .replace(/\s*#\d+$/, '')                                    // strip trailing #N
    .replace(/\s*\(.*\)$/, '')                                  // strip trailing parenthetical
    .replace(/\s*-\s*(indoor|outdoor|greenhouse|light dep)$/i, '')  // strip grow-type suffixes
}

// ---------------------------------------------------------------------------
// 2. isSignificantDelta — per-metric significance with minSamples guard
// ---------------------------------------------------------------------------

function isSignificantDelta(
  valueA: number,
  valueB: number,
  countA: number,
  countB: number,
  threshold: number,
  minSamples: number = 5,
): boolean {
  if (countA < minSamples || countB < minSamples) return false;
  const avg = (valueA + valueB) / 2;
  if (avg === 0) return false;
  return Math.abs(valueA - valueB) / avg > threshold;
}

// Per-metric significance thresholds
const SIGNIFICANCE_THRESHOLDS: Record<SignificantMetric, number> = {
  yieldEfficiency: 0.15,
  labPassRate: 0.10,
  growthDays: 0.20,
};

// ---------------------------------------------------------------------------
// 3. compareAcrossFacilities
// ---------------------------------------------------------------------------

export function compareAcrossFacilities(
  facilityResults: PerFacilityStrainMetrics[],
): CrossFacilityStrainComparison {
  const warnings: string[] = [];

  if (facilityResults.length < 2) {
    return {
      strains: [],
      facilities: [],
      significantDifferences: [],
      warnings: ['Cross-facility comparison requires at least 2 facilities.'],
    };
  }

  // Build facility list
  const facilities: { id: string; name: string; stateCode: string }[] = [];
  for (let fi = 0; fi < facilityResults.length; fi++) {
    const f = facilityResults[fi];
    facilities.push({ id: f.facilityId, name: f.facilityName, stateCode: f.stateCode });
  }

  // Aggregate strains by normalized name across all facilities.
  // Map: normalizedName -> { rawNameCounts, facilityMetrics[] }
  const strainMap = new Map<string, {
    rawNameCounts: Map<string, number>;
    facilityMetrics: StrainFacilityMetrics[];
  }>();

  for (let fi = 0; fi < facilityResults.length; fi++) {
    const fResult = facilityResults[fi];
    for (let si = 0; si < fResult.strains.length; si++) {
      const strain = fResult.strains[si];
      const normalized = normalizeStrainName(strain.rawName);
      if (!normalized) continue;

      let entry = strainMap.get(normalized);
      if (!entry) {
        entry = { rawNameCounts: new Map<string, number>(), facilityMetrics: [] };
        strainMap.set(normalized, entry);
      }

      // Track raw name frequency for displayName selection
      const currentCount = entry.rawNameCounts.get(strain.rawName) ?? 0;
      entry.rawNameCounts.set(strain.rawName, currentCount + 1);

      entry.facilityMetrics.push({
        facilityId: fResult.facilityId,
        facilityName: fResult.facilityName,
        stateCode: fResult.stateCode,
        avgYieldEfficiency: strain.avgYieldEfficiency,
        labPassRate: strain.labPassRate,
        avgGrowthDays: strain.avgGrowthDays,
        harvestCount: strain.harvestCount,
      });
    }
  }

  // Build comparison entries for strains present in 2+ facilities
  const strains: StrainComparisonEntry[] = [];
  const strainEntries = Array.from(strainMap.entries());

  for (let ei = 0; ei < strainEntries.length; ei++) {
    const normalizedName = strainEntries[ei][0];
    const data = strainEntries[ei][1];

    // Only include strains present in 2+ facilities for meaningful comparison
    if (data.facilityMetrics.length < 2) continue;

    // Pick the most common raw name as displayName
    let displayName = normalizedName;
    let maxCount = 0;
    const rawNameEntries = Array.from(data.rawNameCounts.entries());
    for (let rni = 0; rni < rawNameEntries.length; rni++) {
      if (rawNameEntries[rni][1] > maxCount) {
        maxCount = rawNameEntries[rni][1];
        displayName = rawNameEntries[rni][0];
      }
    }

    // Compute cross-facility averages (weighted by harvest count)
    let totalYield = 0;
    let totalPassRate = 0;
    let totalGrowthDays = 0;
    let yieldHarvestSum = 0;
    let passRateTestSum = 0;
    let growthHarvestSum = 0;

    for (let mi = 0; mi < data.facilityMetrics.length; mi++) {
      const m = data.facilityMetrics[mi];
      totalYield += m.avgYieldEfficiency * m.harvestCount;
      yieldHarvestSum += m.harvestCount;
      // Lab pass rate: weight by harvest count as proxy (labTestCount not available here)
      totalPassRate += m.labPassRate * m.harvestCount;
      passRateTestSum += m.harvestCount;
      if (m.avgGrowthDays > 0) {
        totalGrowthDays += m.avgGrowthDays * m.harvestCount;
        growthHarvestSum += m.harvestCount;
      }
    }

    const crossFacilityAvg = {
      yieldEfficiency: yieldHarvestSum > 0
        ? Math.round((totalYield / yieldHarvestSum) * 100) / 100
        : 0,
      labPassRate: passRateTestSum > 0
        ? Math.round((totalPassRate / passRateTestSum) * 1000) / 1000
        : 0,
      growthDays: growthHarvestSum > 0
        ? Math.round(totalGrowthDays / growthHarvestSum)
        : 0,
    };

    strains.push({
      normalizedName,
      displayName,
      facilities: data.facilityMetrics,
      crossFacilityAvg,
    });
  }

  // Sort strains by total harvest count descending (most data first)
  strains.sort(function (a: StrainComparisonEntry, b: StrainComparisonEntry) {
    let aTotal = 0;
    for (let i = 0; i < a.facilities.length; i++) aTotal += a.facilities[i].harvestCount;
    let bTotal = 0;
    for (let i = 0; i < b.facilities.length; i++) bTotal += b.facilities[i].harvestCount;
    return bTotal - aTotal;
  });

  // Detect significant differences
  const significantDifferences = flagSignificantDifferences(strains);

  if (strains.length === 0 && strainMap.size > 0) {
    warnings.push('Strains were found but none appear in 2+ facilities. Cross-facility comparison requires shared strains.');
  }

  return {
    strains,
    facilities,
    significantDifferences,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 4. flagSignificantDifferences
// ---------------------------------------------------------------------------

export function flagSignificantDifferences(
  strains: StrainComparisonEntry[],
): SignificantDifference[] {
  const differences: SignificantDifference[] = [];

  for (let si = 0; si < strains.length; si++) {
    const strain = strains[si];
    const avg = strain.crossFacilityAvg;

    for (let fi = 0; fi < strain.facilities.length; fi++) {
      const fac = strain.facilities[fi];
      if (fac.harvestCount < 5) continue;

      const otherHarvests = strain.facilities.reduce(
        function (sum: number, f: StrainFacilityMetrics) { return sum + (f.facilityId !== fac.facilityId ? f.harvestCount : 0); }, 0,
      );

      const yieldDiff = checkMetricSignificance(strain, fac, 'yieldEfficiency', fac.avgYieldEfficiency, avg.yieldEfficiency, otherHarvests);
      if (yieldDiff) differences.push(yieldDiff);

      const passDiff = checkMetricSignificance(strain, fac, 'labPassRate', fac.labPassRate, avg.labPassRate, otherHarvests);
      if (passDiff) differences.push(passDiff);

      if (fac.avgGrowthDays > 0) {
        const growthDiff = checkMetricSignificance(strain, fac, 'growthDays', fac.avgGrowthDays, avg.growthDays, otherHarvests);
        if (growthDiff) differences.push(growthDiff);
      }
    }
  }

  // Sort: largest absolute delta first
  differences.sort(function (a: SignificantDifference, b: SignificantDifference) {
    return Math.abs(b.deltaPct) - Math.abs(a.deltaPct);
  });

  return differences;
}

function checkMetricSignificance(
  strain: StrainComparisonEntry,
  fac: StrainFacilityMetrics,
  metric: SignificantMetric,
  facValue: number,
  avgValue: number,
  otherHarvests: number,
): SignificantDifference | null {
  if (avgValue <= 0) return null;
  if (!isSignificantDelta(facValue, avgValue, fac.harvestCount, otherHarvests, SIGNIFICANCE_THRESHOLDS[metric])) {
    return null;
  }
  return {
    strainName: strain.displayName,
    metric,
    facilityId: fac.facilityId,
    facilityName: fac.facilityName,
    value: facValue,
    crossFacilityAvg: avgValue,
    deltaPct: Math.round(((facValue - avgValue) / avgValue) * 1000) / 10,
  };
}
