import { describe, it, expect } from 'vitest'
import {
  matchProductsAcrossStores,
  computeFindReplacePreview,
} from '../product-sync-engine'
import type { DutchieProductDetail, CrossStoreProductMatch, FindReplaceRule } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<DutchieProductDetail> = {}): DutchieProductDetail {
  return {
    productId: 1,
    globalProductId: null,
    name: 'Blue Dream 3.5g',
    sku: 'BD-35',
    internalName: null,
    description: 'Premium Blue Dream flower',
    brandId: 10,
    brandName: 'Brand A',
    categoryId: 1,
    categoryName: 'Flower',
    unitPrice: 35.0,
    unitCost: 15.0,
    isActive: true,
    isVisible: true,
    strainName: 'Blue Dream',
    masterCategory: 'Flower',
    thcContent: 25,
    cbdContent: 0.5,
    labTestDate: null,
    imageUrl: null,
    lastModifiedDateUtc: null,
    createdDateUtc: null,
    weightPerUnit: 3.5,
    weightUnit: 'g',
    flowerEquivalent: 3.5,
    flowerEquivalentUnit: 'g',
    isTaxExempt: false,
    requiresWeighing: false,
    lowInventoryThreshold: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// matchProductsAcrossStores
// ---------------------------------------------------------------------------

describe('matchProductsAcrossStores', () => {
  it('matches products by SKU across stores', () => {
    const storeProducts = new Map<string, DutchieProductDetail[]>()

    storeProducts.set('store-1', [
      makeProduct({ productId: 1, name: 'Blue Dream 3.5g', sku: 'BD-35' }),
    ])
    storeProducts.set('store-2', [
      makeProduct({ productId: 2, name: 'Blue Dream 3.5g', sku: 'BD-35' }),
    ])

    const matches = matchProductsAcrossStores(storeProducts)

    expect(matches).toHaveLength(1)
    expect(matches[0].matchType).toBe('sku')
    expect(matches[0].matchKey).toBe('BD-35')
    expect(Object.keys(matches[0].byFacility)).toEqual(['store-1', 'store-2'])
  })

  it('matches products by name when SKU is missing', () => {
    const storeProducts = new Map<string, DutchieProductDetail[]>()

    storeProducts.set('store-1', [
      makeProduct({ productId: 1, name: 'OG Kush 1g', sku: null }),
    ])
    storeProducts.set('store-2', [
      makeProduct({ productId: 2, name: 'OG Kush 1g', sku: null }),
    ])

    const matches = matchProductsAcrossStores(storeProducts)

    expect(matches).toHaveLength(1)
    expect(matches[0].matchType).toBe('name')
  })

  it('normalizes name for matching (whitespace, case)', () => {
    const storeProducts = new Map<string, DutchieProductDetail[]>()

    storeProducts.set('store-1', [
      makeProduct({ productId: 1, name: '  Blue  Dream  3.5g  ', sku: null }),
    ])
    storeProducts.set('store-2', [
      makeProduct({ productId: 2, name: 'blue dream 3.5g', sku: null }),
    ])

    const matches = matchProductsAcrossStores(storeProducts)

    expect(matches).toHaveLength(1)
    expect(matches[0].matchType).toBe('name')
  })

  it('SKU match takes priority over name match', () => {
    const storeProducts = new Map<string, DutchieProductDetail[]>()

    storeProducts.set('store-1', [
      makeProduct({ productId: 1, name: 'Blue Dream 3.5g', sku: 'BD-35' }),
    ])
    storeProducts.set('store-2', [
      makeProduct({ productId: 2, name: 'Blue Dream 3.5g', sku: 'BD-35' }),
    ])

    const matches = matchProductsAcrossStores(storeProducts)

    // Should only produce 1 match (via SKU), not 2 (SKU + name)
    expect(matches).toHaveLength(1)
    expect(matches[0].matchType).toBe('sku')
  })

  it('detects inconsistencies in price', () => {
    const storeProducts = new Map<string, DutchieProductDetail[]>()

    storeProducts.set('store-1', [
      makeProduct({ productId: 1, sku: 'BD-35', unitPrice: 35.0 }),
    ])
    storeProducts.set('store-2', [
      makeProduct({ productId: 2, sku: 'BD-35', unitPrice: 40.0 }),
    ])

    const matches = matchProductsAcrossStores(storeProducts)

    expect(matches[0].inconsistencies).toContain('unitPrice')
  })

  it('returns no matches for single-store products', () => {
    const storeProducts = new Map<string, DutchieProductDetail[]>()

    storeProducts.set('store-1', [
      makeProduct({ productId: 1, name: 'Product Alpha', sku: 'UNIQUE-1' }),
    ])
    storeProducts.set('store-2', [
      makeProduct({ productId: 2, name: 'Product Beta', sku: 'UNIQUE-2' }),
    ])

    const matches = matchProductsAcrossStores(storeProducts)
    expect(matches).toHaveLength(0)
  })

  it('sorts matches with inconsistencies first', () => {
    const storeProducts = new Map<string, DutchieProductDetail[]>()

    storeProducts.set('store-1', [
      makeProduct({ productId: 1, sku: 'AAA', unitPrice: 35 }),
      makeProduct({ productId: 3, sku: 'BBB', unitPrice: 40 }),
    ])
    storeProducts.set('store-2', [
      makeProduct({ productId: 2, sku: 'AAA', unitPrice: 35 }), // consistent
      makeProduct({ productId: 4, sku: 'BBB', unitPrice: 99 }), // inconsistent
    ])

    const matches = matchProductsAcrossStores(storeProducts)

    expect(matches).toHaveLength(2)
    // Inconsistent match should come first
    expect(matches[0].matchKey).toBe('BBB')
    expect(matches[0].inconsistencies.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// computeFindReplacePreview
// ---------------------------------------------------------------------------

describe('computeFindReplacePreview', () => {
  function makeMatches(): CrossStoreProductMatch[] {
    return [
      {
        matchKey: 'BD-35',
        matchType: 'sku',
        byFacility: {
          'store-1': makeProduct({ productId: 1, name: 'Blue Dream 3.5g Flower' }),
          'store-2': makeProduct({ productId: 2, name: 'Blue Dream 3.5g Flower' }),
        },
        inconsistencies: [],
      },
    ]
  }

  const facilityNames: Record<string, string> = {
    'store-1': 'Denver Store',
    'store-2': 'Boulder Store',
  }

  it('computes string find-replace on name field', () => {
    const rule: FindReplaceRule = {
      field: 'name',
      find: 'Flower',
      replace: 'Bud',
    }

    const previews = computeFindReplacePreview(makeMatches(), rule, facilityNames)

    expect(previews).toHaveLength(2)
    expect(previews[0].changes).toHaveLength(1)
    expect(previews[0].changes[0].oldValue).toBe('Blue Dream 3.5g Flower')
    expect(previews[0].changes[0].newValue).toBe('Blue Dream 3.5g Bud')
  })

  it('skips products where find pattern is not present', () => {
    const rule: FindReplaceRule = {
      field: 'name',
      find: 'Nonexistent',
      replace: 'Replacement',
    }

    const previews = computeFindReplacePreview(makeMatches(), rule, facilityNames)

    // No changes since pattern doesn't match
    expect(previews).toHaveLength(0)
  })

  it('supports case-insensitive replacement', () => {
    const rule: FindReplaceRule = {
      field: 'name',
      find: 'flower',
      replace: 'Bud',
      caseInsensitive: true,
    }

    const previews = computeFindReplacePreview(makeMatches(), rule, facilityNames)

    expect(previews).toHaveLength(2)
    expect(previews[0].changes[0].newValue).toBe('Blue Dream 3.5g Bud')
  })

  it('supports regex replacement', () => {
    const rule: FindReplaceRule = {
      field: 'name',
      find: '\\d+\\.\\d+g',
      replace: '7g',
      isRegex: true,
    }

    const previews = computeFindReplacePreview(makeMatches(), rule, facilityNames)

    expect(previews).toHaveLength(2)
    expect(previews[0].changes[0].newValue).toBe('Blue Dream 7g Flower')
  })

  it('handles exact-match for numeric fields (unitPrice)', () => {
    const matches: CrossStoreProductMatch[] = [
      {
        matchKey: 'BD-35',
        matchType: 'sku',
        byFacility: {
          'store-1': makeProduct({ productId: 1, unitPrice: 35.0 }),
          'store-2': makeProduct({ productId: 2, unitPrice: 40.0 }),
        },
        inconsistencies: ['unitPrice'],
      },
    ]

    const rule: FindReplaceRule = {
      field: 'unitPrice',
      find: '35',
      replace: '45',
    }

    const previews = computeFindReplacePreview(matches, rule, facilityNames)

    // Only store-1 has price 35, so only 1 facility affected
    expect(previews).toHaveLength(1)
    expect(previews[0].facilityId).toBe('store-1')
    expect(previews[0].changes[0].newValue).toBe('45')
  })

  it('groups changes by facility', () => {
    const matches: CrossStoreProductMatch[] = [
      {
        matchKey: 'BD-35',
        matchType: 'sku',
        byFacility: {
          'store-1': makeProduct({ productId: 1, name: 'Blue Dream Flower' }),
        },
        inconsistencies: [],
      },
      {
        matchKey: 'OG-10',
        matchType: 'sku',
        byFacility: {
          'store-1': makeProduct({ productId: 3, name: 'OG Kush Flower' }),
        },
        inconsistencies: [],
      },
    ]

    const rule: FindReplaceRule = {
      field: 'name',
      find: 'Flower',
      replace: 'Bud',
    }

    const previews = computeFindReplacePreview(matches, rule, facilityNames)

    // Both changes for store-1 should be grouped together
    expect(previews).toHaveLength(1)
    expect(previews[0].facilityId).toBe('store-1')
    expect(previews[0].changes).toHaveLength(2)
  })
})
