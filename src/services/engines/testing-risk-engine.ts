// Testing Risk Assessment Engine
// Pure function — no tRPC, Prisma, or React imports.
// Analyzes historical lab test pass/fail rates by (strain, testType)
// and joins those risks to packages awaiting lab testing.

import type { MetrcPackage, MetrcLabTest } from '@/services/metrc/types';
import { calculateAgeDays } from '@/services/metrc/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type Confidence = 'high' | 'medium' | 'low';

export interface StrainTestRisk {
  strain: string;
  testType: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  passRate: number; // 0-1
  riskLevel: RiskLevel;
  confidence: Confidence;
  lastFailureDate: string | null;
}

export interface AtRiskPackage {
  packageLabel: string;
  itemName: string;
  strain: string;
  category: string;
  quantity: number;
  unit: string;
  labTestingState: string;
  risks: StrainTestRisk[];
  highestRisk: RiskLevel;
  ageDays: number;
}

export interface TestingRiskAssessment {
  risksByStrainAndType: StrainTestRisk[];
  atRiskPackages: AtRiskPackage[];
  summary: {
    totalPackagesAwaiting: number;
    criticalRiskCount: number;
    highRiskCount: number;
    mediumRiskCount: number;
    lowRiskCount: number;
    topRiskyStrains: { strain: string; avgPassRate: number; riskLevel: RiskLevel }[];
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RISK_ORDER: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const AWAITING_STATES = new Set(['NotSubmitted', 'SubmittedForTesting']);

const DEFAULT_RECENCY_MONTHS = 12;

// ---------------------------------------------------------------------------
// Risk classification matrix (confidence-adjusted fixed thresholds)
// ---------------------------------------------------------------------------

function classifyConfidence(totalTests: number): Confidence {
  if (totalTests >= 10) return 'high';
  if (totalTests >= 5) return 'medium';
  return 'low';
}

function classifyRisk(passRate: number, confidence: Confidence): RiskLevel {
  if (passRate < 0.50) {
    if (confidence === 'high') return 'critical';
    if (confidence === 'medium') return 'high';
    return 'medium';
  }
  if (passRate < 0.70) {
    if (confidence === 'high') return 'high';
    return 'medium';
  }
  if (passRate < 0.85) {
    if (confidence === 'high') return 'medium';
    if (confidence === 'medium') return 'medium';
    return 'low';
  }
  return 'low';
}

// ---------------------------------------------------------------------------
// Main assessment function
// ---------------------------------------------------------------------------

export function assessTestingRisk(
  labTests: MetrcLabTest[],
  packages: MetrcPackage[],
  recencyMonths: number = DEFAULT_RECENCY_MONTHS,
): TestingRiskAssessment {
  const warnings: string[] = [];

  // 1. Filter lab tests to recency window
  const cutoff = new Date();
  cutoff.setDate(1); // Normalize to 1st before subtracting to avoid month-length overflow
  cutoff.setMonth(cutoff.getMonth() - recencyMonths);
  const cutoffTime = cutoff.getTime();

  const recentTests = labTests.filter(t => {
    if (!t.TestPerformedDate) return false;
    const d = new Date(t.TestPerformedDate);
    return !isNaN(d.getTime()) && d.getTime() >= cutoffTime;
  });

  if (recentTests.length === 0) {
    warnings.push(`No lab tests found within the last ${recencyMonths} months.`);
  }

  // 2. Build packageLabel -> strainName map from packages
  const labelToStrain = new Map<string, string>();
  for (const pkg of packages) {
    if (pkg.Label && pkg.ItemStrainName) {
      labelToStrain.set(pkg.Label, pkg.ItemStrainName);
    }
  }

  // 3. Group lab tests by (strain, testType), compute pass/fail counts
  //    Key: "strain|||testType"
  const groupKey = (strain: string, testType: string) => `${strain}|||${testType}`;

  const groupMap = new Map<string, {
    strain: string;
    testType: string;
    passed: number;
    failed: number;
    lastFailureDate: string | null;
  }>();

  for (const test of recentTests) {
    if (test.OverallPassed !== true && test.OverallPassed !== false) continue; // skip indeterminate results

    const strain = labelToStrain.get(test.PackageLabel) || 'Unknown';
    const testType = test.TestTypeName || 'Unknown';
    const key = groupKey(strain, testType);

    const existing = groupMap.get(key);

    if (existing) {
      if (test.OverallPassed === true) {
        existing.passed++;
      } else {
        existing.failed++;
        if (
          !existing.lastFailureDate ||
          new Date(test.TestPerformedDate).getTime() > new Date(existing.lastFailureDate).getTime()
        ) {
          existing.lastFailureDate = test.TestPerformedDate;
        }
      }
    } else {
      groupMap.set(key, {
        strain,
        testType,
        passed: test.OverallPassed === true ? 1 : 0,
        failed: test.OverallPassed === true ? 0 : 1,
        lastFailureDate: test.OverallPassed === true ? null : test.TestPerformedDate,
      });
    }
  }

  // 4. Classify risk using the matrix
  const risksByStrainAndType: StrainTestRisk[] = Array.from(groupMap.entries()).map(
    ([, group]) => {
      const total = group.passed + group.failed;
      const passRate = total > 0 ? group.passed / total : 0;
      const confidence = classifyConfidence(total);
      const riskLevel = classifyRisk(passRate, confidence);

      return {
        strain: group.strain,
        testType: group.testType,
        totalTests: total,
        passedTests: group.passed,
        failedTests: group.failed,
        passRate: Math.round(passRate * 1000) / 1000,
        riskLevel,
        confidence,
        lastFailureDate: group.lastFailureDate,
      };
    },
  );

  // Sort risks: worst risk first, then by pass rate ascending
  risksByStrainAndType.sort((a, b) => {
    const riskDiff = RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    return a.passRate - b.passRate;
  });

  // Build a lookup: strain -> StrainTestRisk[]
  const strainRiskMap = new Map<string, StrainTestRisk[]>();
  for (const risk of risksByStrainAndType) {
    const existing = strainRiskMap.get(risk.strain);
    if (existing) {
      existing.push(risk);
    } else {
      strainRiskMap.set(risk.strain, [risk]);
    }
  }

  // 5. Filter packages to awaiting states
  const awaitingPackages = packages.filter(
    pkg => AWAITING_STATES.has(pkg.LabTestingState),
  );

  // 6. Join awaiting packages to their strain's risk scores
  const atRiskPackages: AtRiskPackage[] = [];

  for (const pkg of awaitingPackages) {
    const strain = pkg.ItemStrainName || 'Unknown';
    const risks = strainRiskMap.get(strain) || [];

    // Determine highest risk from associated strain risks
    let highestRisk: RiskLevel = 'low';
    for (const r of risks) {
      if (RISK_ORDER[r.riskLevel] < RISK_ORDER[highestRisk]) {
        highestRisk = r.riskLevel;
      }
    }

    const ageDays = calculateAgeDays(pkg.PackagedDate);

    atRiskPackages.push({
      packageLabel: pkg.Label,
      itemName: pkg.ItemName,
      strain,
      category: pkg.ItemCategory,
      quantity: pkg.Quantity,
      unit: pkg.UnitOfMeasureName,
      labTestingState: pkg.LabTestingState,
      risks,
      highestRisk,
      ageDays: Number.isFinite(ageDays) ? ageDays : 0,
    });
  }

  // 7. Sort at-risk packages by highestRisk descending, then quantity descending
  atRiskPackages.sort((a, b) => {
    const riskDiff = RISK_ORDER[a.highestRisk] - RISK_ORDER[b.highestRisk];
    if (riskDiff !== 0) return riskDiff;
    return b.quantity - a.quantity;
  });

  // 8. Build summary with topRiskyStrains (top 5 by avg pass rate ascending)
  interface StrainAvg { totalPassRate: number; count: number; worstRisk: RiskLevel }
  const strainAvgMap = new Map<string, StrainAvg>();
  for (const risk of risksByStrainAndType) {
    const existing = strainAvgMap.get(risk.strain);
    if (existing) {
      existing.totalPassRate += risk.passRate;
      existing.count++;
      if (RISK_ORDER[risk.riskLevel] < RISK_ORDER[existing.worstRisk]) {
        existing.worstRisk = risk.riskLevel;
      }
    } else {
      strainAvgMap.set(risk.strain, {
        totalPassRate: risk.passRate,
        count: 1,
        worstRisk: risk.riskLevel,
      });
    }
  }

  const topRiskyStrains = Array.from(strainAvgMap.entries())
    .map(([strain, data]) => ({
      strain,
      avgPassRate: Math.round((data.totalPassRate / data.count) * 1000) / 1000,
      riskLevel: data.worstRisk,
    }))
    .sort((a, b) => a.avgPassRate - b.avgPassRate)
    .slice(0, 5);

  const riskCounts: Record<RiskLevel, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const p of atRiskPackages) {
    riskCounts[p.highestRisk]++;
  }

  // 9. Add warnings when data is sparse
  const strainsWithoutHistory = new Set<string>();
  for (const pkg of awaitingPackages) {
    const strain = pkg.ItemStrainName || 'Unknown';
    if (!strainRiskMap.has(strain)) {
      strainsWithoutHistory.add(strain);
    }
  }

  if (strainsWithoutHistory.size > 0) {
    const strainList = Array.from(strainsWithoutHistory).slice(0, 10).join(', ');
    const remaining = strainsWithoutHistory.size > 10 ? ` and ${strainsWithoutHistory.size - 10} more` : '';
    warnings.push(`No test history for strains: ${strainList}${remaining}. Risk defaulted to low.`);
  }

  if (recentTests.length > 0 && recentTests.length < 10) {
    warnings.push(`Only ${recentTests.length} lab tests in the last ${recencyMonths} months. Risk confidence may be low.`);
  }

  return {
    risksByStrainAndType,
    atRiskPackages,
    summary: {
      totalPackagesAwaiting: awaitingPackages.length,
      criticalRiskCount: riskCounts.critical,
      highRiskCount: riskCounts.high,
      mediumRiskCount: riskCounts.medium,
      lowRiskCount: riskCounts.low,
      topRiskyStrains,
    },
    warnings,
  };
}
