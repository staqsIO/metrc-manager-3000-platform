import { describe, it, expect } from 'vitest';
import {
  reconcileHarvests,
  reconcileInventory,
  generateReconciliationSummary,
  aggregateDutchieSales,
} from './dutchie-reconciliation-engine';
import type { MetrcHarvest, MetrcPackage } from '@/services/metrc/types';
import type { DutchieHarvest } from '@/services/dutchie/types';

// ---------------------------------------------------------------------------
// Helpers to build test fixtures
// ---------------------------------------------------------------------------

function makeDutchieHarvest(overrides: Partial<DutchieHarvest> = {}): DutchieHarvest {
  return {
    Id: '1',
    HarvestName: 'Blue Dream Harvest',
    StrainName: 'Blue Dream',
    StartDate: '2026-01-15',
    IsActive: true,
    LastModifiedDate: '2026-02-01',
    ...overrides,
  };
}

function makeMetrcHarvest(overrides: Partial<MetrcHarvest> = {}): MetrcHarvest {
  return {
    Id: 1,
    Name: 'Blue Dream Harvest',
    HarvestType: 'Product',
    SourceStrainNames: 'Blue Dream',
    DryingLocationName: 'Dry Room A',
    PatientLicenseNumber: null,
    CurrentWeight: 5000,
    TotalWasteWeight: 200,
    TotalRestoredWeight: 0,
    PackageCount: 10,
    TotalPackagedWeight: 4800,
    UnitOfWeightName: 'Grams',
    LabTestingState: 'TestPassed',
    LabTestingStateDate: '2026-01-20',
    IsOnHold: false,
    HarvestStartDate: '2026-01-15',
    FinishedDate: null,
    ArchivedDate: null,
    LastModified: '2026-02-01',
    ...overrides,
  };
}

function makeMetrcPackage(overrides: Partial<MetrcPackage> = {}): MetrcPackage {
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
    PackagedDate: '2026-01-20',
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

// ---------------------------------------------------------------------------
// reconcileHarvests
// ---------------------------------------------------------------------------

describe('reconcileHarvests', () => {
  it('matches harvests by normalized name + strain', () => {
    const result = reconcileHarvests(
      [makeDutchieHarvest()],
      [makeMetrcHarvest()],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.dutchieOnly).toHaveLength(0);
    expect(result.metrcOnly).toHaveLength(0);
    expect(result.matched[0].matchConfidence).toBe('exact');
  });

  it('matches with normalized names (suffix stripping)', () => {
    const result = reconcileHarvests(
      [makeDutchieHarvest({ HarvestName: 'Blue Dream Harvest #3', StrainName: 'Blue Dream' })],
      [makeMetrcHarvest({ Name: 'Blue Dream Harvest', SourceStrainNames: 'Blue Dream' })],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchConfidence).toBe('normalized');
  });

  it('detects Dutchie-only harvests', () => {
    const result = reconcileHarvests(
      [makeDutchieHarvest({ HarvestName: 'OG Kush Batch', StrainName: 'OG Kush' })],
      [makeMetrcHarvest()],
    );
    expect(result.matched).toHaveLength(0);
    expect(result.dutchieOnly).toHaveLength(1);
  });

  it('detects Metrc-only harvests', () => {
    const result = reconcileHarvests(
      [makeDutchieHarvest()],
      [
        makeMetrcHarvest(),
        makeMetrcHarvest({ Id: 2, Name: 'Gelato Harvest', SourceStrainNames: 'Gelato' }),
      ],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.metrcOnly).toHaveLength(1);
    expect(result.metrcOnly[0].Name).toBe('Gelato Harvest');
  });

  it('detects status conflict: Dutchie active, Metrc finished', () => {
    const result = reconcileHarvests(
      [makeDutchieHarvest({ IsActive: true })],
      [makeMetrcHarvest({ FinishedDate: '2026-02-01' })],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].conflicts).toHaveLength(1);
    expect(result.matched[0].conflicts[0]).toContain('Dutchie shows active but Metrc shows finished');
  });

  it('detects start date mismatch >1 day', () => {
    const result = reconcileHarvests(
      [makeDutchieHarvest({ StartDate: '2026-01-10' })],
      [makeMetrcHarvest({ HarvestStartDate: '2026-01-15' })],
    );
    expect(result.matched[0].conflicts).toHaveLength(1);
    expect(result.matched[0].conflicts[0]).toContain('Start date differs');
  });

  it('handles empty arrays', () => {
    const result = reconcileHarvests([], []);
    expect(result.matched).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('No harvest data');
  });

  it('warns about harvests with no name or strain', () => {
    const result = reconcileHarvests(
      [makeDutchieHarvest()],
      [makeMetrcHarvest({ Name: '', SourceStrainNames: '' })],
    );
    expect(result.warnings.some(w => w.includes('no name or strain'))).toBe(true);
  });

  it('matches multiple harvests with same name+strain 1:1', () => {
    const result = reconcileHarvests(
      [
        makeDutchieHarvest({ Id: '1', HarvestName: 'Blue Dream Harvest', StrainName: 'Blue Dream' }),
        makeDutchieHarvest({ Id: '2', HarvestName: 'Blue Dream Harvest', StrainName: 'Blue Dream' }),
      ],
      [
        makeMetrcHarvest({ Id: 1, Name: 'Blue Dream Harvest', SourceStrainNames: 'Blue Dream' }),
        makeMetrcHarvest({ Id: 2, Name: 'Blue Dream Harvest', SourceStrainNames: 'Blue Dream' }),
      ],
    );
    expect(result.matched).toHaveLength(2);
    expect(result.dutchieOnly).toHaveLength(0);
    expect(result.metrcOnly).toHaveLength(0);
    // Each Metrc harvest should be matched to a different Dutchie harvest
    const metrcIds = result.matched.map(m => m.metrc.Id);
    expect(new Set(metrcIds).size).toBe(2);
  });

  it('strips grow-type suffixes during normalization', () => {
    const result = reconcileHarvests(
      [makeDutchieHarvest({ HarvestName: 'Blue Dream - Indoor', StrainName: 'Blue Dream' })],
      [makeMetrcHarvest({ Name: 'Blue Dream', SourceStrainNames: 'Blue Dream' })],
    );
    expect(result.matched).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// reconcileInventory
// ---------------------------------------------------------------------------

describe('reconcileInventory', () => {
  it('matches packages by label', () => {
    const result = reconcileInventory(
      [{ packageLabel: '1A400000000000000001', totalQuantitySold: 28, transactionCount: 3 }],
      [makeMetrcPackage({ Label: '1A400000000000000001' })],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].dutchieQuantitySold).toBe(28);
    expect(result.dutchieOnly).toHaveLength(0);
  });

  it('detects Dutchie-only labels', () => {
    const result = reconcileInventory(
      [{ packageLabel: 'NONEXISTENT', totalQuantitySold: 10, transactionCount: 1 }],
      [makeMetrcPackage()],
    );
    expect(result.dutchieOnly).toEqual(['NONEXISTENT']);
    expect(result.matched).toHaveLength(0);
  });

  it('counts unsold Metrc packages', () => {
    const result = reconcileInventory(
      [{ packageLabel: '1A400000000000000001', totalQuantitySold: 5, transactionCount: 1 }],
      [
        makeMetrcPackage({ Label: '1A400000000000000001' }),
        makeMetrcPackage({ Id: 2, Label: '1A400000000000000002' }),
        makeMetrcPackage({ Id: 3, Label: '1A400000000000000003' }),
      ],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.metrcUnsold).toBe(2);
  });

  it('handles empty arrays', () => {
    const result = reconcileInventory([], []);
    expect(result.matched).toHaveLength(0);
    expect(result.warnings[0]).toContain('No inventory data');
  });
});

// ---------------------------------------------------------------------------
// aggregateDutchieSales
// ---------------------------------------------------------------------------

describe('aggregateDutchieSales', () => {
  it('aggregates by packageId', () => {
    const result = aggregateDutchieSales([
      { packageId: 'PKG1', quantity: 10 },
      { packageId: 'PKG1', quantity: 5 },
      { packageId: 'PKG2', quantity: 3 },
    ]);
    expect(result).toHaveLength(2);
    const pkg1 = result.find(r => r.packageLabel === 'PKG1');
    expect(pkg1?.totalQuantitySold).toBe(15);
    expect(pkg1?.transactionCount).toBe(2);
  });

  it('skips null packageIds', () => {
    const result = aggregateDutchieSales([
      { packageId: null, quantity: 10 },
      { packageId: 'PKG1', quantity: 5 },
    ]);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for no items', () => {
    expect(aggregateDutchieSales([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// generateReconciliationSummary
// ---------------------------------------------------------------------------

describe('generateReconciliationSummary', () => {
  it('returns 100 for perfect reconciliation', () => {
    const harvest = reconcileHarvests(
      [makeDutchieHarvest()],
      [makeMetrcHarvest()],
    );
    const inventory = reconcileInventory(
      [{ packageLabel: '1A400000000000000001', totalQuantitySold: 10, transactionCount: 1 }],
      [makeMetrcPackage()],
    );
    const summary = generateReconciliationSummary(harvest, inventory);
    expect(summary.overallScore).toBe(100);
    expect(summary.categories.harvests.status).toBe('green');
    expect(summary.categories.inventory.status).toBe('green');
    expect(summary.topIssues).toHaveLength(0);
  });

  it('penalizes unmatched harvests', () => {
    const harvest = reconcileHarvests(
      [
        makeDutchieHarvest(),
        makeDutchieHarvest({ Id: '2', HarvestName: 'OG Kush', StrainName: 'OG Kush' }),
      ],
      [makeMetrcHarvest()],
    );
    const inventory = reconcileInventory([], []);
    const summary = generateReconciliationSummary(harvest, inventory);
    expect(summary.categories.harvests.score).toBeLessThan(100);
    expect(summary.topIssues.length).toBeGreaterThan(0);
  });

  it('returns green/yellow/red status thresholds', () => {
    // All matched = green (100)
    const perfect = generateReconciliationSummary(
      reconcileHarvests([makeDutchieHarvest()], [makeMetrcHarvest()]),
      reconcileInventory(
        [{ packageLabel: 'L1', totalQuantitySold: 1, transactionCount: 1 }],
        [makeMetrcPackage({ Label: 'L1' })],
      ),
    );
    expect(perfect.categories.harvests.status).toBe('green');

    // Many mismatches = lower scores
    const dutchieOnly = Array.from({ length: 15 }, (_, i) =>
      makeDutchieHarvest({ Id: String(i), HarvestName: 'Strain ' + i, StrainName: 'Strain ' + i })
    );
    const bad = generateReconciliationSummary(
      reconcileHarvests(dutchieOnly, []),
      reconcileInventory([], []),
    );
    expect(bad.categories.harvests.score).toBeLessThan(70);
    expect(bad.categories.harvests.status).toBe('red');
  });

  it('caps topIssues at 5', () => {
    const manyHarvests = Array.from({ length: 20 }, (_, i) =>
      makeDutchieHarvest({ Id: String(i), HarvestName: 'Strain ' + i, StrainName: 'Strain ' + i })
    );
    const summary = generateReconciliationSummary(
      reconcileHarvests(manyHarvests, []),
      reconcileInventory([], []),
    );
    expect(summary.topIssues.length).toBeLessThanOrEqual(5);
  });

  it('includes generatedAt timestamp', () => {
    const summary = generateReconciliationSummary(
      reconcileHarvests([], []),
      reconcileInventory([], []),
    );
    expect(summary.generatedAt).toBeTruthy();
    expect(new Date(summary.generatedAt).getTime()).not.toBeNaN();
  });
});
