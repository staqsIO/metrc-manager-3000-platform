// ---------------------------------------------------------------------------
// Potency Trending Engine (FOR-1164)
//
// Pure function — no React, no Prisma, no tRPC.
// Analyzes potency result levels over time by (strain, testType) to detect
// drift, compute consistency scores, and enable run-to-run comparison.
// Uses a two-level group-by index: build once O(N+M), then linear scan per
// group for each downstream analysis.
// ---------------------------------------------------------------------------

import type { MetrcLabTest, MetrcPackage } from '@/services/metrc/types';
import { normalizeStrainName } from '@/services/analytics/strain-comparison';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConsistencyRating = 'excellent' | 'good' | 'moderate' | 'inconsistent';
export type DriftStatus = 'stable' | 'drifting_up' | 'drifting_down' | 'insufficient_data';
export type GroupByMode = 'strain' | 'item';

export interface PotencyDataPoint {
  packageLabel: string;
  testPerformedDate: string;
  resultLevel: number;
  resultUnit: string;
  labFacilityName: string;
  overallPassed: boolean;
}

export interface PotencyTrendGroup {
  groupKey: string;           // normalized strain name or item name
  displayName: string;        // most common raw name variant
  testType: string;
  dataPoints: PotencyDataPoint[];  // chronologically sorted
  // Statistics
  mean: number;
  stddev: number;
  cv: number;                 // coefficient of variation (stddev/mean)
  min: number;
  max: number;
  range: number;
  sampleCount: number;
  resultUnit: string;         // unit from data points (e.g., "%", "mg/g")
  // Drift detection
  driftStatus: DriftStatus;
  recentMean: number;         // mean of last `rollingWindow` tests
  recentStddev: number;
  driftMagnitude: number;     // (recentMean - mean) / stddev, in sigma units
  // Consistency
  consistencyRating: ConsistencyRating;
  consistencyRank: number;    // 1 = most consistent within facility for this testType
}

export interface PotencyOutlier {
  groupKey: string;
  displayName: string;
  testType: string;
  packageLabel: string;
  testPerformedDate: string;
  resultLevel: number;
  mean: number;
  stddev: number;
  sigmaDistance: number;       // how many sigma from mean
}

export interface PotencyTrendingResult {
  groups: PotencyTrendGroup[];
  outliers: PotencyOutlier[];
  summary: {
    totalTestsAnalyzed: number;
    uniqueStrains: number;
    uniqueTestTypes: string[];
    mostConsistentStrain: string | null;
    leastConsistentStrain: string | null;
    driftingStrains: { groupKey: string; displayName: string; testType: string; driftStatus: DriftStatus }[];
  };
  warnings: string[];
}

export interface PotencyTrendingOptions {
  groupBy?: GroupByMode;
  testTypeFilter?: string;        // filter to specific test type
  strainFilter?: string;          // filter to specific strain
  minSamples?: number;            // minimum data points for statistics (default: 3)
  rollingWindow?: number;         // recent tests for drift detection (default: 5)
  outlierThreshold?: number;      // sigma threshold for outlier detection (default: 2)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MIN_SAMPLES = 3;
const DEFAULT_ROLLING_WINDOW = 5;
const DEFAULT_OUTLIER_THRESHOLD = 2;
const DRIFT_SIGMA_THRESHOLD = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
  }
  return sum / values.length;
}

function computeStddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    const diff = values[i] - mean;
    sumSq += diff * diff;
  }
  // Sample stddev (n-1 denominator)
  return Math.sqrt(sumSq / (values.length - 1));
}

/** Pick the most common string from a list (mode). */
function mostCommon(values: string[]): string {
  if (values.length === 0) return '';
  const counts = new Map<string, number>();
  let best = values[0];
  let bestCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const c = (counts.get(v) || 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function analyzePotencyTrends(
  labTests: MetrcLabTest[],
  packages: MetrcPackage[],
  options: PotencyTrendingOptions = {},
): PotencyTrendingResult {
  const warnings: string[] = [];
  const groupBy = options.groupBy ?? 'strain';
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
  const rollingWindow = options.rollingWindow ?? DEFAULT_ROLLING_WINDOW;
  const outlierThreshold = options.outlierThreshold ?? DEFAULT_OUTLIER_THRESHOLD;

  // -----------------------------------------------------------------------
  // 1. Build PackageLabel → { strainName, itemName } map from packages
  // -----------------------------------------------------------------------
  const labelToMeta = new Map<string, { strainName: string; itemName: string }>();
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    if (pkg.Label) {
      labelToMeta.set(pkg.Label, {
        strainName: pkg.ItemStrainName || 'Unknown',
        itemName: pkg.ItemName || 'Unknown',
      });
    }
  }

  // -----------------------------------------------------------------------
  // 2. Filter lab tests and build group index
  //    Key: groupKey|||testType
  // -----------------------------------------------------------------------
  interface RawGroup {
    rawNames: string[];          // for display name resolution
    testType: string;
    resultUnits: string[];       // for mixed-unit warning
    dataPoints: PotencyDataPoint[];
  }

  const groupMap = new Map<string, RawGroup>();
  let totalFiltered = 0;

  const testTypeFilter = options.testTypeFilter
    ? options.testTypeFilter.toLowerCase()
    : null;
  const strainFilterNorm = options.strainFilter
    ? normalizeStrainName(options.strainFilter)
    : null;

  for (let i = 0; i < labTests.length; i++) {
    const test = labTests[i];

    // Skip tests with no numeric result
    if (test.TestResultLevel == null || !isFinite(test.TestResultLevel)) continue;
    if (!test.TestPerformedDate) continue;
    if (!test.TestTypeName) continue;

    // Test type filter
    if (testTypeFilter && test.TestTypeName.toLowerCase() !== testTypeFilter) continue;

    // Resolve strain/item from package
    const meta = labelToMeta.get(test.PackageLabel);
    if (!meta) continue; // Can't resolve strain without package

    // Strain filter
    const normalizedStrain = normalizeStrainName(meta.strainName);
    if (strainFilterNorm && normalizedStrain !== strainFilterNorm) continue;

    // Group key
    const gk = groupBy === 'strain' ? normalizedStrain : meta.itemName;
    const compositeKey = gk + '|||' + test.TestTypeName;

    totalFiltered++;

    const dataPoint: PotencyDataPoint = {
      packageLabel: test.PackageLabel,
      testPerformedDate: test.TestPerformedDate,
      resultLevel: test.TestResultLevel,
      resultUnit: test.TestResultUnit || '',
      labFacilityName: test.LabFacilityName || '',
      overallPassed: test.OverallPassed,
    };

    const existing = groupMap.get(compositeKey);
    if (existing) {
      existing.dataPoints.push(dataPoint);
      existing.rawNames.push(groupBy === 'strain' ? meta.strainName : meta.itemName);
      existing.resultUnits.push(test.TestResultUnit || '');
    } else {
      groupMap.set(compositeKey, {
        rawNames: [groupBy === 'strain' ? meta.strainName : meta.itemName],
        testType: test.TestTypeName,
        resultUnits: [test.TestResultUnit || ''],
        dataPoints: [dataPoint],
      });
    }
  }

  if (totalFiltered === 0) {
    if (labTests.length === 0) {
      warnings.push('No lab test data available for this facility.');
    } else if (testTypeFilter) {
      warnings.push('No lab tests found for test type "' + options.testTypeFilter + '".');
    } else if (strainFilterNorm) {
      warnings.push('No lab tests found for strain "' + (options.strainFilter || '') + '".');
    } else {
      warnings.push('No lab tests could be matched to active packages.');
    }
    return {
      groups: [],
      outliers: [],
      summary: {
        totalTestsAnalyzed: 0,
        uniqueStrains: 0,
        uniqueTestTypes: [],
        mostConsistentStrain: null,
        leastConsistentStrain: null,
        driftingStrains: [],
      },
      warnings,
    };
  }

  // -----------------------------------------------------------------------
  // 3. Compute statistics per group
  // -----------------------------------------------------------------------
  const groups: PotencyTrendGroup[] = [];
  const outliers: PotencyOutlier[] = [];
  const testTypeSet = new Set<string>();
  const strainSet = new Set<string>();

  const entries = Array.from(groupMap.entries());
  for (let i = 0; i < entries.length; i++) {
    const [compositeKey, raw] = entries[i];
    const groupKey = compositeKey.split('|||')[0];
    const displayName = mostCommon(raw.rawNames);
    testTypeSet.add(raw.testType);
    strainSet.add(groupKey);

    // Sort data points chronologically (ISO 8601 dates sort correctly lexicographically)
    raw.dataPoints.sort((a, b) => a.testPerformedDate.localeCompare(b.testPerformedDate));

    // Mixed unit warning
    const uniqueUnits = new Set(raw.resultUnits.filter(u => u !== ''));
    if (uniqueUnits.size > 1) {
      warnings.push(
        'Group "' + displayName + '" (' + raw.testType +
        ') has mixed result units: ' + Array.from(uniqueUnits).join(', ') +
        '. Statistics may be misleading.',
      );
    }

    const resultUnit = mostCommon(raw.resultUnits.filter(u => u !== '')) || '';
    const values = raw.dataPoints.map(d => d.resultLevel);
    const n = values.length;

    // Basic stats
    const mean = computeMean(values);
    const stddev = n >= minSamples ? computeStddev(values, mean) : 0;
    const cv = mean > 0 && n >= minSamples ? stddev / mean : 0;
    let min = values[0];
    let max = values[0];
    for (let j = 1; j < values.length; j++) {
      if (values[j] < min) min = values[j];
      if (values[j] > max) max = values[j];
    }

    // Drift detection: compare recent window to historical baseline (excluding recent).
    // Using historical-only stats prevents the drifted values from diluting the signal.
    let driftStatus: DriftStatus = 'insufficient_data';
    let recentMean = mean;
    let recentStddev = 0;
    let driftMagnitude = 0;

    const historicalCount = n - rollingWindow;
    if (n >= rollingWindow + minSamples && historicalCount >= minSamples) {
      const historicalValues = values.slice(0, historicalCount);
      const historicalMean = computeMean(historicalValues);
      const historicalStddev = computeStddev(historicalValues, historicalMean);
      const recentValues = values.slice(-rollingWindow);
      recentMean = computeMean(recentValues);
      recentStddev = computeStddev(recentValues, recentMean);

      if (historicalStddev > 0) {
        driftMagnitude = (recentMean - historicalMean) / historicalStddev;
        if (Math.abs(driftMagnitude) > DRIFT_SIGMA_THRESHOLD) {
          driftStatus = driftMagnitude > 0 ? 'drifting_up' : 'drifting_down';
        } else {
          driftStatus = 'stable';
        }
      } else {
        // Zero stddev in historical = all identical values. Any change in recent is drift.
        // Use finite sentinel (999) instead of Infinity to avoid JSON serialization to null.
        driftStatus = recentMean !== historicalMean
          ? (recentMean > historicalMean ? 'drifting_up' : 'drifting_down')
          : 'stable';
        driftMagnitude = recentMean !== historicalMean ? 999 * Math.sign(recentMean - historicalMean) : 0;
      }
    } else if (n >= minSamples) {
      driftStatus = 'stable'; // Not enough for rolling window but enough for basic stats
    }

    // Outlier detection
    if (n >= minSamples && stddev > 0) {
      for (let j = 0; j < raw.dataPoints.length; j++) {
        const sigmaDistance = Math.abs(raw.dataPoints[j].resultLevel - mean) / stddev;
        if (sigmaDistance > outlierThreshold) {
          outliers.push({
            groupKey,
            displayName,
            testType: raw.testType,
            packageLabel: raw.dataPoints[j].packageLabel,
            testPerformedDate: raw.dataPoints[j].testPerformedDate,
            resultLevel: raw.dataPoints[j].resultLevel,
            mean: round(mean, 2),
            stddev: round(stddev, 2),
            sigmaDistance: round(sigmaDistance, 1),
          });
        }
      }
    }

    groups.push({
      groupKey,
      displayName,
      testType: raw.testType,
      dataPoints: raw.dataPoints,
      mean: round(mean, 2),
      stddev: round(stddev, 2),
      cv: round(cv, 4),
      min: round(min, 2),
      max: round(max, 2),
      range: round(max - min, 2),
      sampleCount: n,
      resultUnit,
      driftStatus,
      recentMean: round(recentMean, 2),
      recentStddev: round(recentStddev, 2),
      driftMagnitude: round(driftMagnitude, 2),
      // Placeholder — will be set in consistency ranking step
      consistencyRating: 'moderate',
      consistencyRank: 0,
    });
  }

  // -----------------------------------------------------------------------
  // 4. Consistency ranking: quartile-based within each testType
  //    Only rank groups with >= minSamples
  // -----------------------------------------------------------------------
  const byTestType = new Map<string, PotencyTrendGroup[]>();
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.sampleCount < minSamples) {
      g.consistencyRating = 'moderate'; // default for insufficient data
      g.consistencyRank = 0;
      continue;
    }
    const existing = byTestType.get(g.testType);
    if (existing) {
      existing.push(g);
    } else {
      byTestType.set(g.testType, [g]);
    }
  }

  const testTypeEntries = Array.from(byTestType.entries());
  for (let i = 0; i < testTypeEntries.length; i++) {
    const typeGroups = testTypeEntries[i][1];
    // Sort by CV ascending (most consistent first)
    typeGroups.sort((a, b) => a.cv - b.cv);
    const n = typeGroups.length;
    for (let j = 0; j < n; j++) {
      typeGroups[j].consistencyRank = j + 1;
      const quartile = n > 1 ? j / (n - 1) : 0;
      if (quartile <= 0.25) {
        typeGroups[j].consistencyRating = 'excellent';
      } else if (quartile <= 0.5) {
        typeGroups[j].consistencyRating = 'good';
      } else if (quartile <= 0.75) {
        typeGroups[j].consistencyRating = 'moderate';
      } else {
        typeGroups[j].consistencyRating = 'inconsistent';
      }
    }
  }

  // Sort final groups: by testType, then by CV ascending
  groups.sort((a, b) => {
    const typeCmp = a.testType.localeCompare(b.testType);
    if (typeCmp !== 0) return typeCmp;
    return a.cv - b.cv;
  });

  // Sort outliers by sigma distance descending (worst first)
  outliers.sort((a, b) => b.sigmaDistance - a.sigmaDistance);

  // -----------------------------------------------------------------------
  // 5. Build summary
  // -----------------------------------------------------------------------
  const driftingStrains: PotencyTrendingResult['summary']['driftingStrains'] = [];
  let mostConsistent: PotencyTrendGroup | null = null;
  let leastConsistent: PotencyTrendGroup | null = null;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.driftStatus === 'drifting_up' || g.driftStatus === 'drifting_down') {
      driftingStrains.push({
        groupKey: g.groupKey,
        displayName: g.displayName,
        testType: g.testType,
        driftStatus: g.driftStatus,
      });
    }
    if (g.sampleCount >= minSamples) {
      if (!mostConsistent || g.cv < mostConsistent.cv) {
        mostConsistent = g;
      }
      if (!leastConsistent || g.cv > leastConsistent.cv) {
        leastConsistent = g;
      }
    }
  }

  return {
    groups,
    outliers,
    summary: {
      totalTestsAnalyzed: totalFiltered,
      uniqueStrains: strainSet.size,
      uniqueTestTypes: Array.from(testTypeSet).sort(),
      mostConsistentStrain: mostConsistent ? mostConsistent.displayName : null,
      leastConsistentStrain: leastConsistent ? leastConsistent.displayName : null,
      driftingStrains,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
