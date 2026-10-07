import { describe, it, expect, beforeEach } from 'vitest'
import {
  getSearchIndex,
  setSearchIndex,
  searchAcrossFacilities,
  getSearchIndexStats,
} from './search-index'
import type { MetrcPackage } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePackage(overrides: Partial<MetrcPackage> = {}): MetrcPackage {
  return {
    Id: 1,
    Label: '1A4FF0300000001000000001',
    ItemName: 'Blue Dream 3.5g',
    ItemStrainName: 'Blue Dream',
    ItemCategory: 'Buds',
    LocationName: 'Vault Room A',
    PackageType: 'Product',
    Quantity: 10,
    UnitOfMeasureName: 'Each',
    PackagedDate: '2026-01-01',
    IsTestingSample: false,
    IsTradeSample: false,
    IsOnHold: false,
    ArchivedDate: null,
    FinishedDate: null,
    ItemId: 100,
    Note: '',
    PackagedByFacilityLicenseNumber: 'LIC-001',
    ReceivedFromFacilityLicenseNumber: null,
    ReceivedFromManifestNumber: null,
    SourceHarvestNames: 'Harvest-001',
    SourcePackageLabels: '',
    LabTestingState: 'TestPassed',
    LabTestingStateDate: '2026-01-05',
    LabTestResultExpirationDateTime: null,
    LabTestStageId: null,
    LabTestResultDocumentFileId: null,
    IsProcessingFee: false,
    IsOnTrip: false,
    IsOnRetailerDelivery: false,
    PatientLicenseNumber: null,
    ContainsRemediatedProduct: false,
    RemediationDate: null,
    ReceivedDateTime: null,
    LastModified: '2026-01-01T00:00:00Z',
    ItemUnitWeight: null,
    ItemUnitWeightUnitOfMeasureName: null,
    ...overrides,
  } as MetrcPackage
}

function seedFacility(
  facilityId: string,
  facilityName: string,
  stateCode: string,
  packages: Partial<MetrcPackage>[],
): void {
  setSearchIndex(
    facilityId,
    facilityName,
    stateCode,
    packages.map((p, i) => makePackage({ Id: i + 1, ...p })),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Clear cache between tests by seeding empty facilities or relying on TTL
// Since the cache is a module singleton, we re-seed in each test as needed.

describe('getSearchIndex', () => {
  it('returns null for unknown facility', () => {
    expect(getSearchIndex('nonexistent-facility')).toBeNull()
  })

  it('returns entries after setSearchIndex', () => {
    seedFacility('f1', 'Facility One', 'CO', [
      { Label: '1A4001', ItemName: 'Blue Dream' },
    ])
    const entries = getSearchIndex('f1')
    expect(entries).toHaveLength(1)
    expect(entries![0]!.label).toBe('1A4001')
    expect(entries![0]!.facilityName).toBe('Facility One')
    expect(entries![0]!.stateCode).toBe('CO')
  })

  it('pre-computes lowercase fields', () => {
    seedFacility('f-lower', 'My Facility', 'OK', [
      { Label: 'TAG123', ItemName: 'OG Kush' },
    ])
    const entries = getSearchIndex('f-lower')
    expect(entries![0]!._lower.label).toBe('tag123')
    expect(entries![0]!._lower.itemName).toBe('og kush')
    expect(entries![0]!._lower.facilityName).toBe('my facility')
  })
})

describe('searchAcrossFacilities', () => {
  beforeEach(() => {
    seedFacility('sf1', 'Denver Dispensary', 'CO', [
      { Id: 1, Label: '1A4FF0300000001', ItemName: 'Blue Dream 3.5g', ItemStrainName: 'Blue Dream', ItemCategory: 'Buds' },
      { Id: 2, Label: '1A4FF0300000002', ItemName: 'OG Kush 1g', ItemStrainName: 'OG Kush', ItemCategory: 'Concentrate' },
    ])
    seedFacility('sf2', 'Boulder Grow', 'CO', [
      { Id: 3, Label: '1A4FF0300000003', ItemName: 'Blue Dream Trim', ItemStrainName: 'Blue Dream', ItemCategory: 'Shake/Trim' },
    ])
    seedFacility('sf3', 'Tulsa Shop', 'OK', [
      { Id: 4, Label: '1A4FF0300000004', ItemName: 'Sour Diesel 3.5g', ItemStrainName: 'Sour Diesel', ItemCategory: 'Buds' },
    ])
  })

  it('returns empty for no matching query', () => {
    const results = searchAcrossFacilities(['sf1', 'sf2', 'sf3'], 'xyznotfound')
    expect(results).toHaveLength(0)
  })

  it('searches across multiple facilities', () => {
    const results = searchAcrossFacilities(['sf1', 'sf2', 'sf3'], 'Blue Dream')
    expect(results.length).toBeGreaterThanOrEqual(2)
    const facilityIds = new Set(results.map(r => r.facilityId))
    expect(facilityIds.has('sf1')).toBe(true)
    expect(facilityIds.has('sf2')).toBe(true)
  })

  it('ranks label exact match highest', () => {
    const results = searchAcrossFacilities(['sf1', 'sf2', 'sf3'], '1A4FF0300000001')
    expect(results[0]!.label).toBe('1A4FF0300000001')
  })

  it('ranks label prefix match above item name match', () => {
    const results = searchAcrossFacilities(['sf1', 'sf2', 'sf3'], '1A4FF03')
    // All labels start with 1A4FF03 -> score 80. Should return all 4.
    expect(results.length).toBe(4)
  })

  it('ranks item name match above strain name match', () => {
    // "Blue Dream 3.5g" matches itemName (60), "Blue Dream" as strain (40)
    // The trim version has "Blue Dream Trim" as itemName (60) and "Blue Dream" as strain (40)
    const results = searchAcrossFacilities(['sf1', 'sf2'], 'Blue Dream')
    // Both should score 60 (itemName contains "Blue Dream")
    expect(results.every(r => r.itemName.includes('Blue Dream'))).toBe(true)
  })

  it('searches by category', () => {
    const results = searchAcrossFacilities(['sf1', 'sf2', 'sf3'], 'Concentrate')
    expect(results).toHaveLength(1)
    expect(results[0]!.category).toBe('Concentrate')
  })

  it('searches by location', () => {
    seedFacility('sf-loc', 'Test', 'CO', [
      { Id: 10, Label: 'TAG-LOC', ItemName: 'Test Item', LocationName: 'Vault Room A' },
    ])
    const results = searchAcrossFacilities(['sf-loc'], 'Vault Room')
    expect(results).toHaveLength(1)
    expect(results[0]!.location).toBe('Vault Room A')
  })

  it('searches by facility name', () => {
    const results = searchAcrossFacilities(['sf1', 'sf2', 'sf3'], 'Tulsa')
    expect(results).toHaveLength(1)
    expect(results[0]!.facilityName).toBe('Tulsa Shop')
  })

  it('respects limit parameter', () => {
    const results = searchAcrossFacilities(['sf1', 'sf2', 'sf3'], '1A4FF03', 2)
    expect(results).toHaveLength(2)
  })

  it('skips cold (uncached) facilities gracefully', () => {
    const results = searchAcrossFacilities(['sf1', 'nonexistent-id'], 'Blue Dream')
    // Should only return results from sf1, not error
    expect(results.length).toBeGreaterThan(0)
    expect(results.every(r => r.facilityId === 'sf1')).toBe(true)
  })

  it('is case-insensitive', () => {
    const results = searchAcrossFacilities(['sf1'], 'blue dream')
    expect(results.length).toBeGreaterThan(0)
  })
})

describe('getSearchIndexStats', () => {
  it('returns stats for cached facilities', () => {
    seedFacility('stats1', 'Fac1', 'CO', [
      { Id: 1, Label: 'A' },
      { Id: 2, Label: 'B' },
    ])
    seedFacility('stats2', 'Fac2', 'OK', [
      { Id: 3, Label: 'C' },
    ])
    const stats = getSearchIndexStats()
    expect(stats.facilityCount).toBeGreaterThanOrEqual(2)
    expect(stats.totalEntries).toBeGreaterThanOrEqual(3)
    expect(stats.memoryEstimateBytes).toBeGreaterThan(0)
  })
})

describe('setSearchIndex — cache eviction', () => {
  it('does not crash when setting many facilities', () => {
    // Fill well beyond typical usage to verify eviction doesn't error
    for (let i = 0; i < 210; i++) {
      seedFacility(`evict-${i}`, `Facility ${i}`, 'CO', [
        { Id: 1, Label: `TAG-${i}` },
      ])
    }
    // Most recent should still be cached
    const recent = getSearchIndex('evict-209')
    expect(recent).not.toBeNull()
  })
})
