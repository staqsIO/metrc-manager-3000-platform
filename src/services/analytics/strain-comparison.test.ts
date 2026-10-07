import { describe, it, expect } from 'vitest'
import {
  normalizeStrainName,
  compareAcrossFacilities,
  flagSignificantDifferences,
} from './strain-comparison'
import type { PerFacilityStrainMetrics, StrainComparisonEntry } from './strain-comparison'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStrainMetrics(
  overrides: Partial<PerFacilityStrainMetrics['strains'][0]> = {},
): PerFacilityStrainMetrics['strains'][0] {
  return {
    rawName: 'Blue Dream',
    avgYieldEfficiency: 120,
    labPassRate: 0.9,
    avgGrowthDays: 60,
    harvestCount: 10,
    labTestCount: 8,
    ...overrides,
  }
}

function makeFacilityData(
  facilityId: string,
  facilityName: string,
  stateCode: string,
  strains: Partial<PerFacilityStrainMetrics['strains'][0]>[],
): PerFacilityStrainMetrics {
  return {
    facilityId,
    facilityName,
    stateCode,
    strains: strains.map(s => makeStrainMetrics(s)),
  }
}

// ---------------------------------------------------------------------------
// normalizeStrainName
// ---------------------------------------------------------------------------

describe('normalizeStrainName', () => {
  it('lowercases and trims', () => {
    expect(normalizeStrainName('  Blue Dream  ')).toBe('blue dream')
  })

  it('collapses whitespace', () => {
    expect(normalizeStrainName('Blue   Dream')).toBe('blue dream')
  })

  it('strips trailing #N suffix', () => {
    expect(normalizeStrainName('Blue Dream #5')).toBe('blue dream')
    expect(normalizeStrainName('Gelato #33')).toBe('gelato')
  })

  it('strips trailing parenthetical', () => {
    expect(normalizeStrainName('OG Kush (Indoor)')).toBe('og kush')
    expect(normalizeStrainName('Blue Dream (Greenhouse Run 2)')).toBe('blue dream')
  })

  it('strips grow-type suffixes', () => {
    expect(normalizeStrainName('Sour Diesel - Indoor')).toBe('sour diesel')
    expect(normalizeStrainName('Purple Punch - Outdoor')).toBe('purple punch')
    expect(normalizeStrainName('Jack Herer - Greenhouse')).toBe('jack herer')
    expect(normalizeStrainName('GMO - Light Dep')).toBe('gmo')
  })

  it('does NOT strip mid-name content', () => {
    expect(normalizeStrainName('Indoor Kush')).toBe('indoor kush')
  })

  it('handles empty string', () => {
    expect(normalizeStrainName('')).toBe('')
  })

  it('handles string with only whitespace', () => {
    expect(normalizeStrainName('   ')).toBe('')
  })

  it('preserves meaningful differences', () => {
    // These should NOT be merged by normalization
    expect(normalizeStrainName('Gelato 33')).not.toBe(normalizeStrainName('Gelato 41'))
    expect(normalizeStrainName('OG Kush')).not.toBe(normalizeStrainName('Purple Kush'))
  })

  it('strips #N but keeps non-# numbers', () => {
    expect(normalizeStrainName('Gelato 33')).toBe('gelato 33')
    expect(normalizeStrainName('Gelato #33')).toBe('gelato')
  })
})

// ---------------------------------------------------------------------------
// compareAcrossFacilities
// ---------------------------------------------------------------------------

describe('compareAcrossFacilities', () => {
  it('returns empty for fewer than 2 facilities', () => {
    const result = compareAcrossFacilities([
      makeFacilityData('f1', 'Fac1', 'CO', [{ rawName: 'Blue Dream' }]),
    ])
    expect(result.strains).toHaveLength(0)
    expect(result.warnings).toContain('Cross-facility comparison requires at least 2 facilities.')
  })

  it('returns empty strains when no shared strains exist', () => {
    const result = compareAcrossFacilities([
      makeFacilityData('f1', 'Fac1', 'CO', [{ rawName: 'Blue Dream' }]),
      makeFacilityData('f2', 'Fac2', 'OK', [{ rawName: 'OG Kush' }]),
    ])
    expect(result.strains).toHaveLength(0)
    expect(result.warnings).toContain('Strains were found but none appear in 2+ facilities. Cross-facility comparison requires shared strains.')
  })

  it('aggregates shared strains across 2 facilities', () => {
    const result = compareAcrossFacilities([
      makeFacilityData('f1', 'Denver Grow', 'CO', [
        { rawName: 'Blue Dream', avgYieldEfficiency: 100, labPassRate: 0.8, avgGrowthDays: 55, harvestCount: 10 },
      ]),
      makeFacilityData('f2', 'Tulsa Shop', 'OK', [
        { rawName: 'Blue Dream', avgYieldEfficiency: 140, labPassRate: 0.95, avgGrowthDays: 65, harvestCount: 10 },
      ]),
    ])

    expect(result.strains).toHaveLength(1)
    expect(result.strains[0].normalizedName).toBe('blue dream')
    expect(result.strains[0].displayName).toBe('Blue Dream')
    expect(result.strains[0].facilities).toHaveLength(2)
  })

  it('computes weighted cross-facility averages', () => {
    const result = compareAcrossFacilities([
      makeFacilityData('f1', 'Fac1', 'CO', [
        { rawName: 'Blue Dream', avgYieldEfficiency: 100, harvestCount: 10, labPassRate: 0.8, avgGrowthDays: 50 },
      ]),
      makeFacilityData('f2', 'Fac2', 'OK', [
        { rawName: 'Blue Dream', avgYieldEfficiency: 200, harvestCount: 10, labPassRate: 0.9, avgGrowthDays: 70 },
      ]),
    ])

    // Weighted avg: (100*10 + 200*10)/(10+10) = 150
    expect(result.strains[0].crossFacilityAvg.yieldEfficiency).toBe(150)
    // (0.8*10 + 0.9*10)/20 = 0.85
    expect(result.strains[0].crossFacilityAvg.labPassRate).toBe(0.85)
    // (50*10 + 70*10)/20 = 60
    expect(result.strains[0].crossFacilityAvg.growthDays).toBe(60)
  })

  it('handles weighted averages with unequal harvest counts', () => {
    const result = compareAcrossFacilities([
      makeFacilityData('f1', 'Fac1', 'CO', [
        { rawName: 'Blue Dream', avgYieldEfficiency: 100, harvestCount: 30 },
      ]),
      makeFacilityData('f2', 'Fac2', 'OK', [
        { rawName: 'Blue Dream', avgYieldEfficiency: 200, harvestCount: 10 },
      ]),
    ])

    // Weighted avg: (100*30 + 200*10)/(30+10) = 5000/40 = 125
    expect(result.strains[0].crossFacilityAvg.yieldEfficiency).toBe(125)
  })

  it('normalizes strain names for matching', () => {
    const result = compareAcrossFacilities([
      makeFacilityData('f1', 'Fac1', 'CO', [
        { rawName: 'Blue Dream #5', avgYieldEfficiency: 100, harvestCount: 10 },
      ]),
      makeFacilityData('f2', 'Fac2', 'OK', [
        { rawName: 'blue dream', avgYieldEfficiency: 120, harvestCount: 10 },
      ]),
    ])

    expect(result.strains).toHaveLength(1)
    expect(result.strains[0].normalizedName).toBe('blue dream')
  })

  it('picks the most common raw name as displayName', () => {
    const result = compareAcrossFacilities([
      makeFacilityData('f1', 'Fac1', 'CO', [{ rawName: 'Blue Dream' }]),
      makeFacilityData('f2', 'Fac2', 'OK', [{ rawName: 'Blue Dream' }]),
      makeFacilityData('f3', 'Fac3', 'MI', [{ rawName: 'blue dream' }]),
    ])

    expect(result.strains[0].displayName).toBe('Blue Dream') // 2 votes vs 1
  })

  it('lists all participating facilities', () => {
    const result = compareAcrossFacilities([
      makeFacilityData('f1', 'Denver', 'CO', [{ rawName: 'Blue Dream' }]),
      makeFacilityData('f2', 'Tulsa', 'OK', [{ rawName: 'Blue Dream' }]),
    ])

    expect(result.facilities).toHaveLength(2)
    expect(result.facilities[0].name).toBe('Denver')
    expect(result.facilities[1].name).toBe('Tulsa')
  })

  it('sorts strains by total harvest count descending', () => {
    const result = compareAcrossFacilities([
      makeFacilityData('f1', 'Fac1', 'CO', [
        { rawName: 'OG Kush', harvestCount: 5 },
        { rawName: 'Blue Dream', harvestCount: 20 },
      ]),
      makeFacilityData('f2', 'Fac2', 'OK', [
        { rawName: 'OG Kush', harvestCount: 5 },
        { rawName: 'Blue Dream', harvestCount: 15 },
      ]),
    ])

    expect(result.strains[0].displayName).toBe('Blue Dream') // 35 total
    expect(result.strains[1].displayName).toBe('OG Kush')    // 10 total
  })

  it('handles 3+ facilities correctly', () => {
    const result = compareAcrossFacilities([
      makeFacilityData('f1', 'Fac1', 'CO', [{ rawName: 'Blue Dream', harvestCount: 10 }]),
      makeFacilityData('f2', 'Fac2', 'OK', [{ rawName: 'Blue Dream', harvestCount: 10 }]),
      makeFacilityData('f3', 'Fac3', 'MI', [{ rawName: 'Blue Dream', harvestCount: 10 }]),
    ])

    expect(result.strains).toHaveLength(1)
    expect(result.strains[0].facilities).toHaveLength(3)
  })

  it('excludes growth days of 0 from averages', () => {
    const result = compareAcrossFacilities([
      makeFacilityData('f1', 'Fac1', 'CO', [
        { rawName: 'Blue Dream', avgGrowthDays: 0, harvestCount: 10 },
      ]),
      makeFacilityData('f2', 'Fac2', 'OK', [
        { rawName: 'Blue Dream', avgGrowthDays: 60, harvestCount: 10 },
      ]),
    ])

    // Only f2 contributes to growth avg (f1 has 0 growth days = no finished harvests)
    expect(result.strains[0].crossFacilityAvg.growthDays).toBe(60)
  })
})

// ---------------------------------------------------------------------------
// flagSignificantDifferences
// ---------------------------------------------------------------------------

describe('flagSignificantDifferences', () => {
  it('returns empty for strains with insufficient data', () => {
    const strains: StrainComparisonEntry[] = [{
      normalizedName: 'blue dream',
      displayName: 'Blue Dream',
      facilities: [
        { facilityId: 'f1', facilityName: 'Fac1', stateCode: 'CO', avgYieldEfficiency: 100, labPassRate: 0.9, avgGrowthDays: 50, harvestCount: 3 },
        { facilityId: 'f2', facilityName: 'Fac2', stateCode: 'OK', avgYieldEfficiency: 200, labPassRate: 0.5, avgGrowthDays: 80, harvestCount: 3 },
      ],
      crossFacilityAvg: { yieldEfficiency: 150, labPassRate: 0.7, growthDays: 65 },
    }]

    const diffs = flagSignificantDifferences(strains)
    // harvestCount < 5 = minSamples, so no differences flagged
    expect(diffs).toHaveLength(0)
  })

  it('flags yield efficiency above threshold (0.15)', () => {
    const strains: StrainComparisonEntry[] = [{
      normalizedName: 'blue dream',
      displayName: 'Blue Dream',
      facilities: [
        { facilityId: 'f1', facilityName: 'Denver', stateCode: 'CO', avgYieldEfficiency: 200, labPassRate: 0.9, avgGrowthDays: 60, harvestCount: 10 },
        { facilityId: 'f2', facilityName: 'Tulsa', stateCode: 'OK', avgYieldEfficiency: 100, labPassRate: 0.9, avgGrowthDays: 60, harvestCount: 10 },
      ],
      crossFacilityAvg: { yieldEfficiency: 150, labPassRate: 0.9, growthDays: 60 },
    }]

    const diffs = flagSignificantDifferences(strains)
    const yieldDiffs = diffs.filter(d => d.metric === 'yieldEfficiency')
    expect(yieldDiffs.length).toBeGreaterThan(0)
    // Denver is above avg, Tulsa is below avg
    const denverDiff = yieldDiffs.find(d => d.facilityId === 'f1')
    expect(denverDiff).toBeDefined()
    expect(denverDiff!.deltaPct).toBeGreaterThan(0)
  })

  it('flags lab pass rate with tighter threshold (0.10)', () => {
    const strains: StrainComparisonEntry[] = [{
      normalizedName: 'blue dream',
      displayName: 'Blue Dream',
      facilities: [
        { facilityId: 'f1', facilityName: 'Fac1', stateCode: 'CO', avgYieldEfficiency: 100, labPassRate: 0.95, avgGrowthDays: 60, harvestCount: 10 },
        { facilityId: 'f2', facilityName: 'Fac2', stateCode: 'OK', avgYieldEfficiency: 100, labPassRate: 0.75, avgGrowthDays: 60, harvestCount: 10 },
      ],
      crossFacilityAvg: { yieldEfficiency: 100, labPassRate: 0.85, growthDays: 60 },
    }]

    const diffs = flagSignificantDifferences(strains)
    const passDiffs = diffs.filter(d => d.metric === 'labPassRate')
    expect(passDiffs.length).toBeGreaterThan(0)
  })

  it('flags growth days with looser threshold (0.20)', () => {
    const strains: StrainComparisonEntry[] = [{
      normalizedName: 'blue dream',
      displayName: 'Blue Dream',
      facilities: [
        { facilityId: 'f1', facilityName: 'Fac1', stateCode: 'CO', avgYieldEfficiency: 100, labPassRate: 0.9, avgGrowthDays: 80, harvestCount: 10 },
        { facilityId: 'f2', facilityName: 'Fac2', stateCode: 'OK', avgYieldEfficiency: 100, labPassRate: 0.9, avgGrowthDays: 50, harvestCount: 10 },
      ],
      crossFacilityAvg: { yieldEfficiency: 100, labPassRate: 0.9, growthDays: 65 },
    }]

    const diffs = flagSignificantDifferences(strains)
    const growthDiffs = diffs.filter(d => d.metric === 'growthDays')
    expect(growthDiffs.length).toBeGreaterThan(0)
  })

  it('does not flag differences within threshold', () => {
    const strains: StrainComparisonEntry[] = [{
      normalizedName: 'blue dream',
      displayName: 'Blue Dream',
      facilities: [
        { facilityId: 'f1', facilityName: 'Fac1', stateCode: 'CO', avgYieldEfficiency: 102, labPassRate: 0.91, avgGrowthDays: 61, harvestCount: 10 },
        { facilityId: 'f2', facilityName: 'Fac2', stateCode: 'OK', avgYieldEfficiency: 98, labPassRate: 0.89, avgGrowthDays: 59, harvestCount: 10 },
      ],
      crossFacilityAvg: { yieldEfficiency: 100, labPassRate: 0.9, growthDays: 60 },
    }]

    const diffs = flagSignificantDifferences(strains)
    expect(diffs).toHaveLength(0)
  })

  it('sorts differences by absolute delta descending', () => {
    const strains: StrainComparisonEntry[] = [{
      normalizedName: 'blue dream',
      displayName: 'Blue Dream',
      facilities: [
        { facilityId: 'f1', facilityName: 'Fac1', stateCode: 'CO', avgYieldEfficiency: 200, labPassRate: 0.6, avgGrowthDays: 90, harvestCount: 10 },
        { facilityId: 'f2', facilityName: 'Fac2', stateCode: 'OK', avgYieldEfficiency: 80, labPassRate: 0.95, avgGrowthDays: 45, harvestCount: 10 },
      ],
      crossFacilityAvg: { yieldEfficiency: 140, labPassRate: 0.775, growthDays: 67 },
    }]

    const diffs = flagSignificantDifferences(strains)
    // All diffs should be sorted by |deltaPct| descending
    for (let i = 1; i < diffs.length; i++) {
      expect(Math.abs(diffs[i - 1].deltaPct)).toBeGreaterThanOrEqual(Math.abs(diffs[i].deltaPct))
    }
  })

  it('skips zero average values', () => {
    const strains: StrainComparisonEntry[] = [{
      normalizedName: 'blue dream',
      displayName: 'Blue Dream',
      facilities: [
        { facilityId: 'f1', facilityName: 'Fac1', stateCode: 'CO', avgYieldEfficiency: 0, labPassRate: 0, avgGrowthDays: 0, harvestCount: 10 },
        { facilityId: 'f2', facilityName: 'Fac2', stateCode: 'OK', avgYieldEfficiency: 0, labPassRate: 0, avgGrowthDays: 0, harvestCount: 10 },
      ],
      crossFacilityAvg: { yieldEfficiency: 0, labPassRate: 0, growthDays: 0 },
    }]

    const diffs = flagSignificantDifferences(strains)
    expect(diffs).toHaveLength(0)
  })
})
