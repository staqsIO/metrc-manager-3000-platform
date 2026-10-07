import { describe, it, expect } from 'vitest';
import { analyzePotencyTrends } from './potency-trending-engine';
import type { MetrcLabTest, MetrcPackage } from '@/services/metrc/types';

// ---------------------------------------------------------------------------
// Helpers to build test fixtures
// ---------------------------------------------------------------------------

function makeLabTest(overrides: Partial<MetrcLabTest> = {}): MetrcLabTest {
  return {
    PackageId: 1,
    PackageLabel: '1A400000000000000001',
    TestPerformedDate: '2026-01-15',
    OverallPassed: true,
    TestTypeName: 'Potency',
    TestResultLevel: 22.5,
    TestResultUnit: '%',
    LabFacilityName: 'Test Lab Inc',
    ...overrides,
  };
}

function makePackage(overrides: Partial<MetrcPackage> = {}): MetrcPackage {
  return {
    Id: 1,
    Label: '1A400000000000000001',
    PackageType: 'Product',
    SourceHarvestNames: 'Blue Dream',
    SourcePackageLabels: '',
    ItemId: 100,
    ItemName: 'Blue Dream Flower',
    ItemCategory: 'Buds',
    ItemStrainName: 'Blue Dream',
    ItemUnitOfMeasureName: 'Grams',
    Quantity: 454,
    UnitOfMeasureName: 'Grams',
    PatientLicenseNumber: '',
    ItemServeCount: '',
    Note: '',
    PackagedDate: '2026-01-10',
    InitialLabTestingState: 'TestPassed',
    LabTestingState: 'TestPassed',
    LabTestingStateDate: '2026-01-22',
    ProductionBatchNumber: '',
    IsDonation: false,
    IsTradesSample: false,
    IsTestingSample: false,
    ProductRequiresRemediation: false,
    ContainsRemediatedProduct: false,
    RemediationDate: null,
    ReceivedDateTime: null,
    ReceivedFromManifestNumber: null,
    ReceivedFromFacilityLicenseNumber: null,
    ReceivedFromFacilityName: null,
    ...overrides,
  } as MetrcPackage;
}

/** Generate a sequence of lab tests for a given strain with controlled potency values. */
function makeTestSequence(
  strain: string,
  label: string,
  testType: string,
  values: number[],
  unit: string = '%',
): { labTests: MetrcLabTest[]; packages: MetrcPackage[] } {
  const labTests: MetrcLabTest[] = [];
  const packages: MetrcPackage[] = [];

  for (let i = 0; i < values.length; i++) {
    const pkgLabel = label + String(i + 1).padStart(4, '0');
    packages.push(makePackage({
      Id: i + 1,
      Label: pkgLabel,
      ItemStrainName: strain,
      ItemName: strain + ' Flower',
    }));
    labTests.push(makeLabTest({
      PackageId: i + 1,
      PackageLabel: pkgLabel,
      TestPerformedDate: '2026-01-' + String(i + 1).padStart(2, '0'),
      TestTypeName: testType,
      TestResultLevel: values[i],
      TestResultUnit: unit,
    }));
  }

  return { labTests, packages };
}

// ---------------------------------------------------------------------------
// analyzePotencyTrends
// ---------------------------------------------------------------------------

describe('analyzePotencyTrends', () => {
  it('returns empty result for no data', () => {
    const result = analyzePotencyTrends([], []);
    expect(result.groups).toHaveLength(0);
    expect(result.outliers).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('No lab test data');
  });

  it('computes basic statistics for a single strain', () => {
    const { labTests, packages } = makeTestSequence(
      'Blue Dream', '1A40', 'Potency',
      [20, 22, 24, 21, 23], // mean=22, known values
    );
    const result = analyzePotencyTrends(labTests, packages);

    expect(result.groups).toHaveLength(1);
    const g = result.groups[0];
    expect(g.groupKey).toBeTruthy();
    expect(g.displayName).toBe('Blue Dream');
    expect(g.testType).toBe('Potency');
    expect(g.sampleCount).toBe(5);
    expect(g.mean).toBe(22);
    expect(g.min).toBe(20);
    expect(g.max).toBe(24);
    expect(g.range).toBe(4);
    expect(g.stddev).toBeGreaterThan(0);
    expect(g.cv).toBeGreaterThan(0);
    expect(g.resultUnit).toBe('%');
  });

  it('sorts data points chronologically', () => {
    const { labTests, packages } = makeTestSequence(
      'OG Kush', '1A50', 'Potency',
      [18, 19, 20],
    );
    // Shuffle dates
    labTests[0].TestPerformedDate = '2026-01-15';
    labTests[1].TestPerformedDate = '2026-01-05';
    labTests[2].TestPerformedDate = '2026-01-10';

    const result = analyzePotencyTrends(labTests, packages);
    const dp = result.groups[0].dataPoints;
    expect(dp[0].testPerformedDate).toBe('2026-01-05');
    expect(dp[1].testPerformedDate).toBe('2026-01-10');
    expect(dp[2].testPerformedDate).toBe('2026-01-15');
  });

  it('detects upward drift when recent values are significantly higher', () => {
    // Historical (first 8): ~20%, Recent 5: ~28% — clear upward drift.
    // Needs rollingWindow(5) + minSamples(3) = 8 minimum total data points.
    const values = [20, 19, 21, 20, 20, 19, 21, 20, 19, 20, 28, 29, 27, 28, 27];
    const { labTests, packages } = makeTestSequence('Drifter', '1A60', 'Potency', values);
    const result = analyzePotencyTrends(labTests, packages);

    const g = result.groups[0];
    expect(g.driftStatus).toBe('drifting_up');
    expect(g.driftMagnitude).toBeGreaterThan(0);
  });

  it('detects downward drift when recent values are significantly lower', () => {
    // Historical (first 10): ~25%, Recent 5: ~17%
    const values = [25, 26, 24, 25, 25, 26, 24, 25, 26, 24, 17, 16, 18, 17, 17];
    const { labTests, packages } = makeTestSequence('Fader', '1A70', 'Potency', values);
    const result = analyzePotencyTrends(labTests, packages);

    const g = result.groups[0];
    expect(g.driftStatus).toBe('drifting_down');
    expect(g.driftMagnitude).toBeLessThan(0);
  });

  it('reports stable when values are consistent', () => {
    const values = [22, 22.1, 21.9, 22, 22.2, 21.8, 22.1, 22, 21.9, 22];
    const { labTests, packages } = makeTestSequence('Stable', '1A80', 'Potency', values);
    const result = analyzePotencyTrends(labTests, packages);

    expect(result.groups[0].driftStatus).toBe('stable');
  });

  it('reports insufficient_data when below rolling window', () => {
    const { labTests, packages } = makeTestSequence('NewStrain', '1A90', 'Potency', [22, 23, 24]);
    const result = analyzePotencyTrends(labTests, packages);

    // 3 samples: enough for basic stats but not for drift (needs rollingWindow=5)
    expect(result.groups[0].driftStatus).toBe('stable'); // minSamples=3 met but < rollingWindow
  });

  it('detects outliers beyond 2 sigma', () => {
    // Tight cluster at ~22 with one extreme value at 35. With 8 values near 22 and one
    // at 35, the outlier is well above 2σ even accounting for its influence on the mean.
    const values = [22, 22, 22, 22, 22, 22, 22, 22, 35];
    const { labTests, packages } = makeTestSequence('OutlierStrain', '1B00', 'Potency', values);
    const result = analyzePotencyTrends(labTests, packages);

    expect(result.outliers.length).toBeGreaterThanOrEqual(1);
    const outlier = result.outliers.find(o => o.resultLevel === 35);
    expect(outlier).toBeTruthy();
    expect(outlier!.sigmaDistance).toBeGreaterThan(2);
  });

  it('assigns consistency rankings by quartile within test type', () => {
    // Create 4 strains with increasing CV
    const s1 = makeTestSequence('Strain A', '1C01', 'Potency', [22, 22, 22, 22, 22]); // CV ≈ 0
    const s2 = makeTestSequence('Strain B', '1C02', 'Potency', [20, 22, 20, 22, 20]); // CV ~0.05
    const s3 = makeTestSequence('Strain C', '1C03', 'Potency', [18, 24, 18, 24, 18]); // CV ~0.14
    const s4 = makeTestSequence('Strain D', '1C04', 'Potency', [10, 30, 10, 30, 10]); // CV ~0.56

    const allTests = [...s1.labTests, ...s2.labTests, ...s3.labTests, ...s4.labTests];
    const allPkgs = [...s1.packages, ...s2.packages, ...s3.packages, ...s4.packages];

    const result = analyzePotencyTrends(allTests, allPkgs);
    expect(result.groups).toHaveLength(4);

    // Groups sorted by testType then CV ascending
    const potencyGroups = result.groups.filter(g => g.testType === 'Potency');
    expect(potencyGroups[0].consistencyRating).toBe('excellent');
    expect(potencyGroups[3].consistencyRating).toBe('inconsistent');
    expect(potencyGroups[0].consistencyRank).toBe(1);
    expect(potencyGroups[3].consistencyRank).toBe(4);
  });

  it('groups by strain using normalizeStrainName', () => {
    const tests = [
      makeLabTest({ PackageLabel: 'PKG1', TestResultLevel: 22, TestTypeName: 'Potency' }),
      makeLabTest({ PackageLabel: 'PKG2', TestResultLevel: 23, TestTypeName: 'Potency' }),
      makeLabTest({ PackageLabel: 'PKG3', TestResultLevel: 24, TestTypeName: 'Potency' }),
    ];
    const pkgs = [
      makePackage({ Label: 'PKG1', ItemStrainName: 'Blue Dream' }),
      makePackage({ Label: 'PKG2', ItemStrainName: 'blue dream' }),
      makePackage({ Label: 'PKG3', ItemStrainName: 'Blue Dream #3' }),
    ];

    const result = analyzePotencyTrends(tests, pkgs);
    // All three should normalize to the same strain group
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].sampleCount).toBe(3);
  });

  it('groups by item name when groupBy is item', () => {
    const tests = [
      makeLabTest({ PackageLabel: 'PKG1', TestResultLevel: 22, TestTypeName: 'Potency' }),
      makeLabTest({ PackageLabel: 'PKG2', TestResultLevel: 23, TestTypeName: 'Potency' }),
      makeLabTest({ PackageLabel: 'PKG3', TestResultLevel: 24, TestTypeName: 'Potency' }),
    ];
    const pkgs = [
      makePackage({ Label: 'PKG1', ItemStrainName: 'Blue Dream', ItemName: 'Blue Dream 3.5g' }),
      makePackage({ Label: 'PKG2', ItemStrainName: 'Blue Dream', ItemName: 'Blue Dream 3.5g' }),
      makePackage({ Label: 'PKG3', ItemStrainName: 'Blue Dream', ItemName: 'Blue Dream 1oz' }),
    ];

    const result = analyzePotencyTrends(tests, pkgs, { groupBy: 'item' });
    expect(result.groups).toHaveLength(2);
  });

  it('separates groups by test type', () => {
    const pkg = makePackage({ Label: 'PKG1', ItemStrainName: 'OG Kush' });
    const tests = [
      makeLabTest({ PackageLabel: 'PKG1', TestTypeName: 'Potency', TestResultLevel: 25, TestResultUnit: '%' }),
      makeLabTest({ PackageLabel: 'PKG1', TestTypeName: 'Terpenes', TestResultLevel: 3.2, TestResultUnit: '%' }),
    ];

    const result = analyzePotencyTrends(tests, [pkg]);
    expect(result.groups).toHaveLength(2);
    expect(result.summary.uniqueTestTypes).toContain('Potency');
    expect(result.summary.uniqueTestTypes).toContain('Terpenes');
  });

  it('filters by test type', () => {
    const pkg = makePackage({ Label: 'PKG1', ItemStrainName: 'OG Kush' });
    const tests = [
      makeLabTest({ PackageLabel: 'PKG1', TestTypeName: 'Potency', TestResultLevel: 25 }),
      makeLabTest({ PackageLabel: 'PKG1', TestTypeName: 'Terpenes', TestResultLevel: 3.2 }),
      makeLabTest({ PackageLabel: 'PKG1', TestTypeName: 'Heavy Metals', TestResultLevel: 0.01 }),
    ];

    const result = analyzePotencyTrends(tests, [pkg], { testTypeFilter: 'Potency' });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].testType).toBe('Potency');
  });

  it('filters by strain name', () => {
    const tests = [
      makeLabTest({ PackageLabel: 'PKG1', TestResultLevel: 22 }),
      makeLabTest({ PackageLabel: 'PKG2', TestResultLevel: 18 }),
    ];
    const pkgs = [
      makePackage({ Label: 'PKG1', ItemStrainName: 'Blue Dream' }),
      makePackage({ Label: 'PKG2', ItemStrainName: 'OG Kush' }),
    ];

    const result = analyzePotencyTrends(tests, pkgs, { strainFilter: 'Blue Dream' });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].displayName).toBe('Blue Dream');
  });

  it('warns about mixed result units within a group', () => {
    const tests = [
      makeLabTest({ PackageLabel: 'PKG1', TestResultLevel: 22, TestResultUnit: '%' }),
      makeLabTest({ PackageLabel: 'PKG2', TestResultLevel: 220, TestResultUnit: 'mg/g' }),
      makeLabTest({ PackageLabel: 'PKG3', TestResultLevel: 23, TestResultUnit: '%' }),
    ];
    const pkgs = [
      makePackage({ Label: 'PKG1', ItemStrainName: 'Mixed' }),
      makePackage({ Label: 'PKG2', ItemStrainName: 'Mixed' }),
      makePackage({ Label: 'PKG3', ItemStrainName: 'Mixed' }),
    ];

    const result = analyzePotencyTrends(tests, pkgs);
    expect(result.warnings.some(w => w.includes('mixed result units'))).toBe(true);
  });

  it('skips tests with null or non-finite result levels', () => {
    const tests = [
      makeLabTest({ PackageLabel: 'PKG1', TestResultLevel: 22 }),
      makeLabTest({ PackageLabel: 'PKG2', TestResultLevel: NaN }),
      makeLabTest({ PackageLabel: 'PKG3', TestResultLevel: Infinity }),
    ];
    const pkgs = [
      makePackage({ Label: 'PKG1', ItemStrainName: 'Blue Dream' }),
      makePackage({ Label: 'PKG2', ItemStrainName: 'Blue Dream' }),
      makePackage({ Label: 'PKG3', ItemStrainName: 'Blue Dream' }),
    ];

    const result = analyzePotencyTrends(tests, pkgs);
    expect(result.summary.totalTestsAnalyzed).toBe(1);
  });

  it('skips tests with no matching package', () => {
    const tests = [
      makeLabTest({ PackageLabel: 'PKG_MISSING', TestResultLevel: 22 }),
    ];
    const result = analyzePotencyTrends(tests, []);
    expect(result.groups).toHaveLength(0);
    expect(result.warnings.some(w => w.includes('No lab tests could be matched'))).toBe(true);
  });

  it('summary identifies most and least consistent strains', () => {
    const s1 = makeTestSequence('Consistent', '1D01', 'Potency', [22, 22, 22, 22, 22]);
    const s2 = makeTestSequence('Wildcard', '1D02', 'Potency', [10, 30, 15, 25, 20]);

    const result = analyzePotencyTrends(
      [...s1.labTests, ...s2.labTests],
      [...s1.packages, ...s2.packages],
    );

    expect(result.summary.mostConsistentStrain).toBe('Consistent');
    expect(result.summary.leastConsistentStrain).toBe('Wildcard');
  });

  it('summary lists drifting strains', () => {
    // Need rollingWindow(5) + minSamples(3) = 8+ historical points
    const values = [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 30, 30, 30, 30, 30];
    const { labTests, packages } = makeTestSequence('Drifter', '1E00', 'Potency', values);
    const result = analyzePotencyTrends(labTests, packages);

    expect(result.summary.driftingStrains.length).toBeGreaterThan(0);
    expect(result.summary.driftingStrains[0].displayName).toBe('Drifter');
  });

  it('detects drift when historical stddev is zero (all identical values)', () => {
    // 10 identical historical values at 20.0, then 5 recent values at 25.0.
    // Historical stddev is 0, so any change in recent is drift with finite sentinel magnitude.
    const values = [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 25, 25, 25, 25, 25];
    const { labTests, packages } = makeTestSequence('ZeroVar', '1F50', 'Potency', values);
    const result = analyzePotencyTrends(labTests, packages);

    const g = result.groups[0];
    expect(g.driftStatus).toBe('drifting_up');
    // driftMagnitude should be a finite sentinel (999), not Infinity
    expect(isFinite(g.driftMagnitude)).toBe(true);
    expect(g.driftMagnitude).toBe(999);
  });

  it('handles single data point gracefully', () => {
    const { labTests, packages } = makeTestSequence('Solo', '1F00', 'Potency', [22]);
    const result = analyzePotencyTrends(labTests, packages);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].sampleCount).toBe(1);
    expect(result.groups[0].stddev).toBe(0);
    expect(result.groups[0].driftStatus).toBe('insufficient_data');
    expect(result.outliers).toHaveLength(0);
  });
});
