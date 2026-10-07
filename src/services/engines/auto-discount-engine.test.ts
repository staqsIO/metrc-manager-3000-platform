import { describe, it, expect } from 'vitest'
import {
  computeAutoDiscountPlan,
  parseCategoryMaxDiscountPct,
} from './auto-discount-engine'
import type { AutoDiscountConfigData } from './auto-discount-engine'
import type { DiscountRecommendation } from './discount-scoring-engine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<AutoDiscountConfigData> = {}): AutoDiscountConfigData {
  return {
    maxDiscountPct: 50,
    minPriceFloor: null,
    minScoreThreshold: 30,
    priorityFilter: ['urgent', 'high'],
    discountTiers: [
      { ageDays: 60, discountPct: 10 },
      { ageDays: 90, discountPct: 20 },
      { ageDays: 120, discountPct: 30 },
    ],
    excludedProductIds: [],
    excludedCategories: [],
    categoryMaxDiscountPct: null,
    ...overrides,
  }
}

function makeRecommendation(overrides: Partial<DiscountRecommendation> = {}): DiscountRecommendation {
  return {
    packageLabel: 'PKG-001',
    itemName: 'Blue Dream 3.5g',
    itemCategory: 'Buds',
    quantity: 10,
    unitOfMeasure: 'Grams',
    ageDays: 95,
    score: 60,
    scoreBreakdown: { age: 20, quantity: 15, velocity: 15, category: 10, margin: 5 },
    priority: 'high',
    actionType: 'DISCOUNT_RECOMMEND',
    actionParams: {},
    suggestedAction: 'Apply 20% discount',
    matchedRuleIds: [],
    matchedRuleNames: [],
    ...overrides,
  }
}

function makeProductMap(
  entries: Array<{ label: string; productId: number; productName: string; unitPrice: number }> = [],
): Map<string, { productId: number; productName: string; unitPrice: number }> {
  const map = new Map<string, { productId: number; productName: string; unitPrice: number }>()
  for (const e of entries) {
    map.set(e.label, { productId: e.productId, productName: e.productName, unitPrice: e.unitPrice })
  }
  return map
}

const defaultProductMap = makeProductMap([
  { label: 'PKG-001', productId: 1, productName: 'Blue Dream 3.5g', unitPrice: 40 },
])

// ---------------------------------------------------------------------------
// parseCategoryMaxDiscountPct
// ---------------------------------------------------------------------------

describe('parseCategoryMaxDiscountPct', () => {
  it('returns null for null input', () => {
    expect(parseCategoryMaxDiscountPct(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(parseCategoryMaxDiscountPct(undefined)).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(parseCategoryMaxDiscountPct('string')).toBeNull()
    expect(parseCategoryMaxDiscountPct(42)).toBeNull()
    expect(parseCategoryMaxDiscountPct(true)).toBeNull()
  })

  it('returns null for empty object', () => {
    expect(parseCategoryMaxDiscountPct({})).toBeNull()
  })

  it('parses valid Record<string, number>', () => {
    const input = { Buds: 20, Concentrate: 15, Edible: 30 }
    expect(parseCategoryMaxDiscountPct(input)).toEqual({
      Buds: 20,
      Concentrate: 15,
      Edible: 30,
    })
  })

  it('filters out non-number values', () => {
    const input = { Buds: 20, Concentrate: 'fifteen', Edible: true }
    expect(parseCategoryMaxDiscountPct(input)).toEqual({ Buds: 20 })
  })

  it('filters out values below 1', () => {
    const input = { Buds: 0, Concentrate: -5, Edible: 30 }
    expect(parseCategoryMaxDiscountPct(input)).toEqual({ Edible: 30 })
  })

  it('filters out values above 100', () => {
    const input = { Buds: 101, Concentrate: 150, Edible: 30 }
    expect(parseCategoryMaxDiscountPct(input)).toEqual({ Edible: 30 })
  })

  it('returns null when all entries are invalid', () => {
    const input = { Buds: 0, Concentrate: 'bad', Edible: 101 }
    expect(parseCategoryMaxDiscountPct(input)).toBeNull()
  })

  it('preserves boundary values 1 and 100', () => {
    const input = { Low: 1, High: 100 }
    expect(parseCategoryMaxDiscountPct(input)).toEqual({ Low: 1, High: 100 })
  })
})

// ---------------------------------------------------------------------------
// computeAutoDiscountPlan — per-category caps
// ---------------------------------------------------------------------------

describe('computeAutoDiscountPlan — category caps', () => {
  it('uses global maxDiscountPct when no category overrides exist', () => {
    const config = makeConfig({ maxDiscountPct: 15 })
    const rec = makeRecommendation({ ageDays: 95, itemCategory: 'Buds' })
    // Tier match: ageDays 95 >= 90 -> 20%, but global max is 15%

    const plan = computeAutoDiscountPlan([rec], defaultProductMap, config)

    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]!.discountPct).toBe(15)
  })

  it('uses global maxDiscountPct when categoryMaxDiscountPct is null', () => {
    const config = makeConfig({ maxDiscountPct: 15, categoryMaxDiscountPct: null })
    const rec = makeRecommendation({ ageDays: 95 })

    const plan = computeAutoDiscountPlan([rec], defaultProductMap, config)

    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]!.discountPct).toBe(15)
  })

  it('applies per-category cap when lower than tier discount', () => {
    const config = makeConfig({
      maxDiscountPct: 50,
      categoryMaxDiscountPct: { Buds: 10 },
    })
    const rec = makeRecommendation({ ageDays: 95, itemCategory: 'Buds' })
    // Tier: 20%, category cap: 10% -> should be capped at 10%

    const plan = computeAutoDiscountPlan([rec], defaultProductMap, config)

    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]!.discountPct).toBe(10)
  })

  it('falls back to global max for categories not in the override map', () => {
    const config = makeConfig({
      maxDiscountPct: 15,
      categoryMaxDiscountPct: { Concentrate: 10 },
    })
    const rec = makeRecommendation({ ageDays: 95, itemCategory: 'Buds' })
    // Buds not in map -> falls back to global max 15%

    const plan = computeAutoDiscountPlan([rec], defaultProductMap, config)

    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]!.discountPct).toBe(15)
  })

  it('uses exact match on category name (not substring)', () => {
    const config = makeConfig({
      maxDiscountPct: 50,
      categoryMaxDiscountPct: { Bud: 5 },
    })
    const rec = makeRecommendation({ ageDays: 95, itemCategory: 'Buds' })
    // "Buds" != "Bud" -> no match -> falls back to global 50%, tier is 20%

    const plan = computeAutoDiscountPlan([rec], defaultProductMap, config)

    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]!.discountPct).toBe(20)
  })

  it('applies different caps to different categories in the same plan', () => {
    const config = makeConfig({
      maxDiscountPct: 50,
      categoryMaxDiscountPct: { Buds: 10, Concentrate: 25 },
    })
    const productMap = makeProductMap([
      { label: 'PKG-001', productId: 1, productName: 'Blue Dream', unitPrice: 40 },
      { label: 'PKG-002', productId: 2, productName: 'Live Resin', unitPrice: 60 },
    ])
    const recs = [
      makeRecommendation({ packageLabel: 'PKG-001', ageDays: 125, itemCategory: 'Buds' }),
      makeRecommendation({ packageLabel: 'PKG-002', ageDays: 125, itemCategory: 'Concentrate' }),
    ]
    // Tier: 120 days -> 30%. Buds capped at 10%, Concentrate capped at 25%

    const plan = computeAutoDiscountPlan(recs, productMap, config)

    expect(plan.items).toHaveLength(2)
    const buds = plan.items.find(i => i.category === 'Buds')
    const conc = plan.items.find(i => i.category === 'Concentrate')
    expect(buds!.discountPct).toBe(10)
    expect(conc!.discountPct).toBe(25)
  })

  it('caps discountRange.max at per-category cap', () => {
    const config = makeConfig({
      maxDiscountPct: 50,
      categoryMaxDiscountPct: { Buds: 12 },
    })
    const rec = makeRecommendation({
      ageDays: 95,
      itemCategory: 'Buds',
      actionParams: { discountRange: { min: 5, max: 25 } },
    })
    // Tier: 20%, rule range: 5-25%, category cap: 12% -> should be 12%

    const plan = computeAutoDiscountPlan([rec], defaultProductMap, config)

    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]!.discountPct).toBe(12)
  })

  it('does not exceed 100% even with corrupted category cap', () => {
    // This tests the defensive Math.min(cap, 100) in getCategoryMaxDiscount
    // In practice, Zod prevents values > 100, but test the engine's defense
    const config = makeConfig({
      maxDiscountPct: 50,
      categoryMaxDiscountPct: { Buds: 150 } as Record<string, number>,
    })
    const rec = makeRecommendation({ ageDays: 95, itemCategory: 'Buds' })
    // Tier: 20%, category cap: 150 -> clamped to 100 -> tier 20% wins

    const plan = computeAutoDiscountPlan([rec], defaultProductMap, config)

    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]!.discountPct).toBe(20)
  })

  it('empty categoryMaxDiscountPct object falls back to global max', () => {
    const config = makeConfig({
      maxDiscountPct: 15,
      categoryMaxDiscountPct: {},
    })
    const rec = makeRecommendation({ ageDays: 95, itemCategory: 'Buds' })

    const plan = computeAutoDiscountPlan([rec], defaultProductMap, config)

    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]!.discountPct).toBe(15)
  })
})
