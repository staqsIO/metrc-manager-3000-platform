/**
 * supply-engine.ts — Non-Metrc Inventory Engine
 *
 * Provides production feasibility analysis via bottleneck algorithm.
 * For P products with C shared components, finds the constraining
 * component and computes max feasible production in O(C * P).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BOMLine {
  componentItemId: string
  componentName: string
  quantityPerUnit: number
  unit: string
  currentStock: number
  unitCost: number | null
}

export interface FeasibilityResult {
  metrcItemName: string
  requestedQuantity: number
  maxFeasibleQuantity: number
  isFeasible: boolean
  bottleneckComponent: string | null
  components: Array<{
    componentName: string
    requiredQuantity: number
    availableStock: number
    shortfall: number
    unitCost: number | null
    totalCost: number | null
  }>
  totalMaterialCost: number | null
}

export interface LowStockAlert {
  itemId: string
  itemName: string
  currentStock: number
  reorderPoint: number
  unit: string
  shortfall: number
  vendor: string | null
}

export interface MultiProductFeasibility {
  products: FeasibilityResult[]
  sharedBottleneck: string | null
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Check Production Feasibility (Single Product)
// ---------------------------------------------------------------------------

export function checkFeasibility(
  metrcItemName: string,
  requestedQuantity: number,
  bomLines: BOMLine[],
): FeasibilityResult {
  if (bomLines.length === 0) {
    return {
      metrcItemName,
      requestedQuantity,
      maxFeasibleQuantity: requestedQuantity,
      isFeasible: true,
      bottleneckComponent: null,
      components: [],
      totalMaterialCost: null,
    }
  }

  let minFeasible = Infinity
  let bottleneck: string | null = null
  let totalCost = 0
  let hasCostData = false

  const components = bomLines.map((line) => {
    const required = line.quantityPerUnit * requestedQuantity
    const shortfall = Math.max(0, required - line.currentStock)
    const maxFromThis = line.quantityPerUnit > 0
      ? Math.floor(line.currentStock / line.quantityPerUnit)
      : Infinity

    if (maxFromThis < minFeasible) {
      minFeasible = maxFromThis
      bottleneck = line.componentName
    }

    const lineCost = line.unitCost != null ? line.unitCost * required : null
    if (lineCost != null) {
      totalCost += lineCost
      hasCostData = true
    }

    return {
      componentName: line.componentName,
      requiredQuantity: Math.round(required * 100) / 100,
      availableStock: line.currentStock,
      shortfall: Math.round(shortfall * 100) / 100,
      unitCost: line.unitCost,
      totalCost: lineCost != null ? Math.round(lineCost * 100) / 100 : null,
    }
  })

  return {
    metrcItemName,
    requestedQuantity,
    maxFeasibleQuantity: Math.min(minFeasible, requestedQuantity),
    isFeasible: minFeasible >= requestedQuantity,
    bottleneckComponent: minFeasible < requestedQuantity ? bottleneck : null,
    components,
    totalMaterialCost: hasCostData ? Math.round(totalCost * 100) / 100 : null,
  }
}

// ---------------------------------------------------------------------------
// Check Multi-Product Feasibility (Bottleneck Algorithm)
// ---------------------------------------------------------------------------

/**
 * Given multiple products and their BOMs sharing common components,
 * determine feasibility considering shared resource contention.
 * O(C * P) where C = components, P = products.
 */
export function checkMultiProductFeasibility(
  products: Array<{ metrcItemName: string; requestedQuantity: number; bomLines: BOMLine[] }>,
): MultiProductFeasibility {
  const componentDemand = new Map<string, {
    totalDemand: number
    available: number
    name: string
    products: string[]
  }>()

  for (const product of products) {
    for (const line of product.bomLines) {
      const demand = line.quantityPerUnit * product.requestedQuantity
      const existing = componentDemand.get(line.componentItemId)
      if (existing) {
        existing.totalDemand += demand
        existing.products.push(product.metrcItemName)
      } else {
        componentDemand.set(line.componentItemId, {
          totalDemand: demand,
          available: line.currentStock,
          name: line.componentName,
          products: [product.metrcItemName],
        })
      }
    }
  }

  let sharedBottleneck: string | null = null
  let lowestRatio = Infinity
  const warnings: string[] = []

  for (const [, data] of Array.from(componentDemand)) {
    if (data.totalDemand <= 0) continue
    const ratio = data.available / data.totalDemand
    if (ratio < 1 && data.products.length > 1) {
      if (ratio < lowestRatio) {
        lowestRatio = ratio
        sharedBottleneck = data.name
      }
      warnings.push(
        `${data.name}: ${data.available} available vs ${Math.round(data.totalDemand)} needed across ${data.products.length} products`
      )
    }
  }

  const results = products.map((p) => checkFeasibility(p.metrcItemName, p.requestedQuantity, p.bomLines))

  return { products: results, sharedBottleneck, warnings }
}

// ---------------------------------------------------------------------------
// Low Stock Alerts
// ---------------------------------------------------------------------------

export function findLowStockItems(
  items: Array<{
    id: string
    name: string
    currentStock: number
    reorderPoint: number | null
    unit: string
    vendor: string | null
  }>,
): LowStockAlert[] {
  const alerts: LowStockAlert[] = []

  for (const item of items) {
    if (item.reorderPoint != null && item.currentStock < item.reorderPoint) {
      alerts.push({
        itemId: item.id,
        itemName: item.name,
        currentStock: item.currentStock,
        reorderPoint: item.reorderPoint,
        unit: item.unit,
        shortfall: Math.round((item.reorderPoint - item.currentStock) * 100) / 100,
        vendor: item.vendor,
      })
    }
  }

  alerts.sort((a, b) => b.shortfall - a.shortfall)
  return alerts
}
