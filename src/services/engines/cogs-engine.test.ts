import { describe, it, expect } from 'vitest'
import {
  buildStandardCostMap,
  buildDutchieCostMap,
  buildManualCostMap,
  resolveCost,
  computeBOMCost,
  resolvePackageCOGS,
  summarizeCOGS,
  validateBOMsAgainstInferred,
  inferBOMsFromActionLogs,
} from './cogs-engine'
import type {
  CanixStandardCost,
  CanixBOM,
  CanixBOMComponent,
} from '../canix/types'
import type { DutchieCostEntry, PackageForCOGS } from './cogs-engine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStandardCost(overrides: Partial<CanixStandardCost> = {}): CanixStandardCost {
  return {
    id: 'sc-1',
    itemId: 'item-1',
    itemName: 'Blue Dream Trim',
    costPerUnit: 5.0,
    unit: 'g',
    effectiveDate: '2026-01-01',
    updatedAt: '2026-01-15',
    ...overrides,
  }
}

function makeBOMComponent(overrides: Partial<CanixBOMComponent> = {}): CanixBOMComponent {
  return {
    id: 'comp-1',
    itemId: 'item-1',
    itemName: 'Blue Dream Trim',
    quantityPerUnit: 10,
    unit: 'g',
    unitCost: 2.5,
    isCannabisDerived: true,
    ...overrides,
  }
}

function makeBOM(overrides: Partial<CanixBOM> = {}): CanixBOM {
  return {
    id: 'bom-1',
    outputItemId: 'item-out-1',
    outputItemName: 'Blue Dream Distillate',
    outputQuantity: 1,
    outputUnit: 'g',
    yieldPercentage: 0.7,
    components: [makeBOMComponent()],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-15',
    ...overrides,
  }
}

function makePackage(overrides: Partial<PackageForCOGS> = {}): PackageForCOGS {
  return {
    label: 'PKG-001',
    itemName: 'Blue Dream Trim',
    quantity: 100,
    unitOfMeasure: 'Grams',
    category: 'Buds',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// resolveCost — dutchie source discrimination
// ---------------------------------------------------------------------------

describe('resolveCost', () => {
  const emptyStandardMap = buildStandardCostMap([])
  const emptyManualMap = buildManualCostMap([])

  it('should return dutchie source when inferred is false', () => {
    const entry: DutchieCostEntry = {
      metrcPackageLabel: 'PKG-001',
      unitCost: 3.5,
      inferred: false,
    }
    const dutchieMap = buildDutchieCostMap([entry])

    const result = resolveCost('Some Item', 'PKG-001', 'Buds', emptyStandardMap, dutchieMap, emptyManualMap)

    expect(result.source).toBe('dutchie')
    expect(result.confidence).toBe(0.7)
    expect(result.costPerUnit).toBe(3.5)
  })

  it('should return dutchie source when inferred is undefined', () => {
    const entry: DutchieCostEntry = {
      metrcPackageLabel: 'PKG-002',
      unitCost: 4.0,
      // inferred intentionally omitted
    }
    const dutchieMap = buildDutchieCostMap([entry])

    const result = resolveCost('Some Item', 'PKG-002', 'Buds', emptyStandardMap, dutchieMap, emptyManualMap)

    expect(result.source).toBe('dutchie')
    expect(result.confidence).toBe(0.7)
  })

  it('should return dutchie_inferred source when inferred is true', () => {
    const entry: DutchieCostEntry = {
      metrcPackageLabel: 'PKG-003',
      unitCost: 4.0,
      inferred: true,
    }
    const dutchieMap = buildDutchieCostMap([entry])

    const result = resolveCost('Some Item', 'PKG-003', 'Buds', emptyStandardMap, dutchieMap, emptyManualMap)

    expect(result.source).toBe('dutchie_inferred')
    expect(result.confidence).toBe(0.3)
    expect(result.costPerUnit).toBe(4.0)
  })

  it('should prefer canix_standard over dutchie', () => {
    const standardCost = makeStandardCost({ itemName: 'Blue Dream Trim', costPerUnit: 5.0 })
    const standardMap = buildStandardCostMap([standardCost])
    const dutchieEntry: DutchieCostEntry = { metrcPackageLabel: 'PKG-001', unitCost: 3.0 }
    const dutchieMap = buildDutchieCostMap([dutchieEntry])

    const result = resolveCost('Blue Dream Trim', 'PKG-001', 'Buds', standardMap, dutchieMap, emptyManualMap)

    expect(result.source).toBe('canix_standard')
    expect(result.costPerUnit).toBe(5.0)
    expect(result.confidence).toBe(0.95)
  })

  it('should fall through to manual when no canix or dutchie data', () => {
    const manualMap = buildManualCostMap([{ category: 'Buds', costPerUnit: 2.0 }])

    const result = resolveCost('Unknown Item', 'PKG-XXX', 'Buds', emptyStandardMap, new Map(), manualMap)

    expect(result.source).toBe('manual')
    expect(result.costPerUnit).toBe(2.0)
    expect(result.confidence).toBe(0.5)
  })

  it('should return none when no cost data available', () => {
    const result = resolveCost('Unknown Item', 'PKG-XXX', 'Unknown', emptyStandardMap, new Map(), emptyManualMap)

    expect(result.source).toBe('none')
    expect(result.costPerUnit).toBe(0)
    expect(result.confidence).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeBOMCost — canix_bom source for embedded unit costs
// ---------------------------------------------------------------------------

describe('computeBOMCost', () => {
  it('should use canix_bom source for components with embedded unitCost', () => {
    const bom = makeBOM({
      components: [
        makeBOMComponent({ itemName: 'Trim', quantityPerUnit: 10, unitCost: 2.5 }),
      ],
    })
    const standardMap = buildStandardCostMap([])

    const result = computeBOMCost(bom, standardMap)

    expect(result.components[0]?.costSource).toBe('canix_bom')
    expect(result.components[0]?.unitCost).toBe(2.5)
    expect(result.totalCostPerUnit).toBe(25)
  })

  it('should fall back to canix_standard when component has no unitCost', () => {
    const bom = makeBOM({
      components: [
        makeBOMComponent({ itemName: 'Trim', quantityPerUnit: 5, unitCost: null }),
      ],
    })
    const standardCost = makeStandardCost({ itemName: 'Trim', costPerUnit: 3.0 })
    const standardMap = buildStandardCostMap([standardCost])

    const result = computeBOMCost(bom, standardMap)

    expect(result.components[0]?.costSource).toBe('canix_standard')
    expect(result.components[0]?.unitCost).toBe(3.0)
    expect(result.totalCostPerUnit).toBe(15)
  })

  it('should use canix_bom for some components and canix_standard for others', () => {
    const bom = makeBOM({
      components: [
        makeBOMComponent({ id: 'c1', itemName: 'Trim', quantityPerUnit: 10, unitCost: 2.5 }),
        makeBOMComponent({ id: 'c2', itemName: 'Solvent', quantityPerUnit: 2, unitCost: null }),
      ],
    })
    const standardCost = makeStandardCost({ itemName: 'Solvent', costPerUnit: 1.0 })
    const standardMap = buildStandardCostMap([standardCost])

    const result = computeBOMCost(bom, standardMap)

    const trimLine = result.components.find(c => c.componentName === 'Trim')
    const solventLine = result.components.find(c => c.componentName === 'Solvent')

    expect(trimLine?.costSource).toBe('canix_bom')
    expect(solventLine?.costSource).toBe('canix_standard')
    expect(result.totalCostPerUnit).toBe(27) // 10*2.5 + 2*1.0
  })

  it('should assign none source when component has no unitCost and no standard cost', () => {
    const bom = makeBOM({
      components: [
        makeBOMComponent({ itemName: 'Mystery Input', quantityPerUnit: 5, unitCost: null }),
      ],
    })
    const standardMap = buildStandardCostMap([])

    const result = computeBOMCost(bom, standardMap)

    expect(result.components[0]?.costSource).toBe('none')
    expect(result.components[0]?.unitCost).toBe(0)
    expect(result.totalCostPerUnit).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// resolvePackageCOGS — BOM rollup produces canix_bom source
// ---------------------------------------------------------------------------

describe('resolvePackageCOGS', () => {
  it('should use canix_bom source when a matching BOM exists', () => {
    const pkg = makePackage({ itemName: 'Blue Dream Distillate', quantity: 10 })
    const bom = makeBOM({
      outputItemName: 'Blue Dream Distillate',
      components: [makeBOMComponent({ unitCost: 3.0, quantityPerUnit: 5 })],
    })

    const results = resolvePackageCOGS([pkg], {
      standardCosts: [],
      boms: [bom],
      dutchieCosts: [],
      manualCosts: [],
    })

    expect(results[0]?.source).toBe('canix_bom')
    expect(results[0]?.confidence).toBe(0.9)
    expect(results[0]?.costPerUnit).toBe(15) // 5 * 3.0
    expect(results[0]?.totalCOGS).toBe(150) // 15 * 10 qty
    expect(results[0]?.bomCostBreakdown).not.toBeNull()
  })

  it('should fall back to waterfall when no BOM matches', () => {
    const pkg = makePackage({ itemName: 'Blue Dream Trim', quantity: 5 })
    const standardCost = makeStandardCost({ itemName: 'Blue Dream Trim', costPerUnit: 4.0 })

    const results = resolvePackageCOGS([pkg], {
      standardCosts: [standardCost],
      boms: [],
      dutchieCosts: [],
      manualCosts: [],
    })

    expect(results[0]?.source).toBe('canix_standard')
    expect(results[0]?.bomCostBreakdown).toBeNull()
  })

  it('should correctly resolve dutchie_inferred source through waterfall', () => {
    const pkg = makePackage({ itemName: 'Unknown Item', label: 'PKG-INF', quantity: 2 })
    const dutchieEntry: DutchieCostEntry = {
      metrcPackageLabel: 'PKG-INF',
      unitCost: 6.0,
      inferred: true,
    }

    const results = resolvePackageCOGS([pkg], {
      standardCosts: [],
      boms: [],
      dutchieCosts: [dutchieEntry],
      manualCosts: [],
    })

    expect(results[0]?.source).toBe('dutchie_inferred')
    expect(results[0]?.confidence).toBe(0.3)
    expect(results[0]?.totalCOGS).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// summarizeCOGS — bySource includes all sources
// ---------------------------------------------------------------------------

describe('summarizeCOGS', () => {
  it('should include canix_bom and dutchie_inferred in bySource', () => {
    const results = resolvePackageCOGS(
      [
        makePackage({ label: 'PKG-A', itemName: 'Blue Dream Distillate', quantity: 1 }),
        makePackage({ label: 'PKG-B', itemName: 'Unknown Item', quantity: 1 }),
      ],
      {
        standardCosts: [],
        boms: [
          makeBOM({
            outputItemName: 'Blue Dream Distillate',
            components: [makeBOMComponent({ unitCost: 5.0, quantityPerUnit: 2 })],
          }),
        ],
        dutchieCosts: [{ metrcPackageLabel: 'PKG-B', unitCost: 3.0, inferred: true }],
        manualCosts: [],
      },
    )

    const summary = summarizeCOGS(results)

    expect(summary.bySource.canix_bom.count).toBe(1)
    expect(summary.bySource.canix_bom.totalCOGS).toBe(10) // 2 * 5.0
    expect(summary.bySource.dutchie_inferred.count).toBe(1)
    expect(summary.bySource.dutchie_inferred.totalCOGS).toBe(3.0)
    expect(summary.resolvedCount).toBe(2)
    expect(summary.unresolvedCount).toBe(0)
  })

  it('should track unresolved packages with source none', () => {
    const results = resolvePackageCOGS([makePackage({ label: 'PKG-X', itemName: 'Orphan' })], {
      standardCosts: [],
      boms: [],
      dutchieCosts: [],
      manualCosts: [],
    })

    const summary = summarizeCOGS(results)

    expect(summary.bySource.none.count).toBe(1)
    expect(summary.unresolvedCount).toBe(1)
    expect(summary.resolvedCount).toBe(0)
    expect(summary.averageConfidence).toBe(0)
  })

  it('should compute weighted average confidence correctly', () => {
    const results = resolvePackageCOGS(
      [
        makePackage({ label: 'PKG-S', itemName: 'Standard Item', quantity: 1 }),
        makePackage({ label: 'PKG-D', itemName: 'Dutchie Item', quantity: 1 }),
      ],
      {
        standardCosts: [makeStandardCost({ itemName: 'Standard Item', costPerUnit: 5.0 })],
        boms: [],
        dutchieCosts: [{ metrcPackageLabel: 'PKG-D', unitCost: 3.0, inferred: false }],
        manualCosts: [],
      },
    )

    const summary = summarizeCOGS(results)

    // canix_standard confidence 0.95 + dutchie confidence 0.7 / 2 = 0.825 → rounded 0.83
    expect(summary.averageConfidence).toBeCloseTo(0.83, 2)
  })
})

// ---------------------------------------------------------------------------
// validateBOMsAgainstInferred — handles canixRatio <= 0 without NaN
// ---------------------------------------------------------------------------

describe('validateBOMsAgainstInferred', () => {
  it('should skip components where canixRatio is 0', () => {
    const bom = makeBOM({
      components: [
        makeBOMComponent({ quantityPerUnit: 0, isCannabisDerived: true }),
      ],
    })
    const inferred = [
      {
        outputItemName: 'Blue Dream Distillate',
        componentItemName: 'Blue Dream Trim',
        averageRatio: 5.0,
        confidence: 0.8,
      },
    ]

    // Should not throw and should produce no deviations (ratio = 0 is skipped)
    expect(() => validateBOMsAgainstInferred([bom], inferred)).not.toThrow()
    const deviations = validateBOMsAgainstInferred([bom], inferred)
    expect(deviations).toHaveLength(0)
  })

  it('should skip non-cannabis-derived components', () => {
    const bom = makeBOM({
      components: [
        makeBOMComponent({ quantityPerUnit: 10, isCannabisDerived: false }),
      ],
    })
    const inferred = [
      {
        outputItemName: 'Blue Dream Distillate',
        componentItemName: 'Blue Dream Trim',
        averageRatio: 5.0,
        confidence: 0.8,
      },
    ]

    const deviations = validateBOMsAgainstInferred([bom], inferred)
    expect(deviations).toHaveLength(0)
  })

  it('should report info severity for deviations under 10%', () => {
    const bom = makeBOM({
      components: [
        makeBOMComponent({ quantityPerUnit: 10, isCannabisDerived: true, itemName: 'Blue Dream Trim' }),
      ],
    })
    const inferred = [
      {
        outputItemName: 'Blue Dream Distillate',
        componentItemName: 'Blue Dream Trim',
        averageRatio: 10.5, // 5% deviation
        confidence: 0.8,
      },
    ]

    const deviations = validateBOMsAgainstInferred([bom], inferred)
    expect(deviations).toHaveLength(1)
    expect(deviations[0]?.severity).toBe('info')
  })

  it('should report warning severity for 10-25% deviations', () => {
    const bom = makeBOM({
      components: [
        makeBOMComponent({ quantityPerUnit: 10, isCannabisDerived: true, itemName: 'Blue Dream Trim' }),
      ],
    })
    const inferred = [
      {
        outputItemName: 'Blue Dream Distillate',
        componentItemName: 'Blue Dream Trim',
        averageRatio: 12, // 20% deviation
        confidence: 0.8,
      },
    ]

    const deviations = validateBOMsAgainstInferred([bom], inferred)
    expect(deviations[0]?.severity).toBe('warning')
  })

  it('should report critical severity for deviations over 25%', () => {
    const bom = makeBOM({
      components: [
        makeBOMComponent({ quantityPerUnit: 10, isCannabisDerived: true, itemName: 'Blue Dream Trim' }),
      ],
    })
    const inferred = [
      {
        outputItemName: 'Blue Dream Distillate',
        componentItemName: 'Blue Dream Trim',
        averageRatio: 15, // 50% deviation
        confidence: 0.8,
      },
    ]

    const deviations = validateBOMsAgainstInferred([bom], inferred)
    expect(deviations[0]?.severity).toBe('critical')
  })

  it('should skip inferred entries with low confidence (<=0.3)', () => {
    const bom = makeBOM({
      components: [
        makeBOMComponent({ quantityPerUnit: 10, isCannabisDerived: true, itemName: 'Blue Dream Trim' }),
      ],
    })
    const inferred = [
      {
        outputItemName: 'Blue Dream Distillate',
        componentItemName: 'Blue Dream Trim',
        averageRatio: 20,
        confidence: 0.2, // too low
      },
    ]

    const deviations = validateBOMsAgainstInferred([bom], inferred)
    expect(deviations).toHaveLength(0)
  })

  it('should return empty array for empty inputs', () => {
    expect(validateBOMsAgainstInferred([], [])).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// inferBOMsFromActionLogs
// ---------------------------------------------------------------------------

describe('inferBOMsFromActionLogs', () => {
  it('should extract BOM ratios from action log preview data', () => {
    const logs = [
      {
        previewData: {
          sources: [{ itemName: 'Blue Dream Trim', requestedQty: 100 }],
          output: { itemName: 'Blue Dream Distillate', quantity: 10 },
        },
      },
    ]

    const result = inferBOMsFromActionLogs(logs)

    expect(result).toHaveLength(1)
    expect(result[0]?.outputItemName).toBe('blue dream distillate')
    expect(result[0]?.componentItemName).toBe('Blue Dream Trim')
    expect(result[0]?.averageRatio).toBe(10) // 100 / 10
  })

  it('should compute average ratio across multiple logs', () => {
    const logs = [
      {
        previewData: {
          sources: [{ itemName: 'Trim', requestedQty: 100 }],
          output: { itemName: 'Distillate', quantity: 10 }, // ratio 10
        },
      },
      {
        previewData: {
          sources: [{ itemName: 'Trim', requestedQty: 120 }],
          output: { itemName: 'Distillate', quantity: 10 }, // ratio 12
        },
      },
    ]

    const result = inferBOMsFromActionLogs(logs)

    expect(result).toHaveLength(1)
    expect(result[0]?.averageRatio).toBe(11) // (10 + 12) / 2
  })

  it('should handle multiple source components', () => {
    const logs = [
      {
        previewData: {
          sources: [
            { itemName: 'Trim', requestedQty: 100 },
            { itemName: 'Solvent', requestedQty: 50 },
          ],
          output: { itemName: 'Distillate', quantity: 10 },
        },
      },
    ]

    const result = inferBOMsFromActionLogs(logs)

    expect(result).toHaveLength(2)
    const trimEntry = result.find(r => r.componentItemName === 'Trim')
    const solventEntry = result.find(r => r.componentItemName === 'Solvent')
    expect(trimEntry?.averageRatio).toBe(10)
    expect(solventEntry?.averageRatio).toBe(5)
  })

  it('should skip logs with null previewData', () => {
    const logs = [{ previewData: null }, { previewData: null }]
    const result = inferBOMsFromActionLogs(logs)
    expect(result).toHaveLength(0)
  })

  it('should skip logs where output quantity is 0', () => {
    const logs = [
      {
        previewData: {
          sources: [{ itemName: 'Trim', requestedQty: 100 }],
          output: { itemName: 'Distillate', quantity: 0 },
        },
      },
    ]
    const result = inferBOMsFromActionLogs(logs)
    expect(result).toHaveLength(0)
  })

  it('should compute higher confidence for consistent ratios with many samples', () => {
    const logs = Array.from({ length: 10 }, () => ({
      previewData: {
        sources: [{ itemName: 'Trim', requestedQty: 100 }],
        output: { itemName: 'Distillate', quantity: 10 }, // perfectly consistent
      },
    }))

    const result = inferBOMsFromActionLogs(logs)
    // 10 samples, no variance → confidence = min(1.0, 10/5) * max(0, 1-0) = 1.0
    expect(result[0]?.confidence).toBeCloseTo(1.0, 4)
  })
})
