/**
 * Auto-Discount Engine (FOR-961)
 *
 * Pipeline: scoring recommendations -> plan computation -> Dutchie location overrides
 * Handles Metrc-to-Dutchie product mapping, velocity integration, and price guard rails.
 */

import type { IDutchieClient } from '@/services/dutchie/types'
import type { DutchieLocationOverride } from '@/services/dutchie/types'
import type { DiscountRecommendation } from './discount-scoring-engine'
import type { RunRateResult, RunRateStatus } from './run-rate-engine'

// --- Types ---

export interface DiscountTier {
  ageDays: number
  discountPct: number
}

export interface AutoDiscountConfigData {
  maxDiscountPct: number
  minPriceFloor: number | null
  minScoreThreshold: number
  priorityFilter: string[]
  discountTiers: DiscountTier[]
  excludedProductIds: string[]
  excludedCategories: string[]
  categoryMaxDiscountPct?: Record<string, number> | null
}

export interface AutoDiscountPlanItem {
  packageLabel: string
  productId: number
  productName: string
  oldPrice: number
  newPrice: number
  discountPct: number
  score: number
  ageDays: number
  category: string
  priority: string
  tierMatched: DiscountTier | null
}

export interface AutoDiscountPlan {
  items: AutoDiscountPlanItem[]
  estimatedRevenueImpact: number
  totalRecommendations: number
  skippedNoProduct: number
  skippedNoPrice: number
  skippedExcluded: number
  skippedBelowThreshold: number
  skippedPriorityFilter: number
  /** Count of items skipped because COGS floor left no room for discount */
  skippedBelowCost?: number
}

// --- Package-to-Product Mapping ---

/**
 * Build a map from Metrc PackageLabel -> Dutchie productId using transaction data.
 * Fetches recent transactions with line-item detail and extracts the packageId -> productId link.
 * Falls back to name matching against the product catalog.
 */
export async function buildPackageProductMap(
  dutchieClient: IDutchieClient,
  lookbackDays: number = 90,
): Promise<Map<string, { productId: number; productName: string; unitPrice: number }>> {
  const map = new Map<string, { productId: number; productName: string; unitPrice: number }>()

  // Fetch transactions with line items
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - lookbackDays)
  const transactions = await dutchieClient.getTransactions({
    fromDateUTC: fromDate.toISOString(),
    toDateUTC: new Date().toISOString(),
    includeDetail: true,
  })

  // Extract packageId -> productId from transaction items
  for (const tx of transactions) {
    if (tx.isVoid || !tx.items) continue
    for (const item of tx.items) {
      if (!item.packageId || !item.productId) continue
      // Keep the most recent (highest price) entry per package
      const existing = map.get(item.packageId)
      if (!existing || item.unitPrice > existing.unitPrice) {
        map.set(item.packageId, {
          productId: item.productId,
          productName: '', // Will be enriched by product catalog
          unitPrice: item.unitPrice,
        })
      }
    }
  }

  // Enrich with product catalog for names and current prices
  try {
    const products = await dutchieClient.getReportingProducts()
    const productById = new Map(products.map(p => [p.productId, p]))
    for (const [label, entry] of Array.from(map.entries())) {
      const product = productById.get(entry.productId)
      if (product) {
        map.set(label, { ...entry, productName: product.productName })
      }
    }
  } catch {
    // Product catalog fetch failed — return what we have from transactions
  }

  return map
}

// --- Velocity Integration ---

/**
 * Build a map from Metrc ItemName -> velocity status from run-rate data.
 * Used to enhance scoring with sell-through rate information.
 */
export function buildVelocityMap(
  runRateResult: RunRateResult,
): Map<string, RunRateStatus> {
  const map = new Map<string, RunRateStatus>()

  for (const product of runRateResult.byProduct) {
    map.set(product.productName.toLowerCase().trim(), product.status)
  }

  // Also map by category
  for (const cat of runRateResult.byCategory) {
    if (!map.has(cat.category.toLowerCase().trim())) {
      map.set(cat.category.toLowerCase().trim(), cat.status)
    }
  }

  return map
}

// --- Per-Category Cap ---

/**
 * Get the effective max discount for a category.
 * Uses per-category override if set, otherwise falls back to the global cap.
 * Exact match on category name (not substring).
 */
function getCategoryMaxDiscount(
  config: AutoDiscountConfigData,
  category: string,
): number {
  const cap = config.categoryMaxDiscountPct?.[category] ?? config.maxDiscountPct
  return Math.min(cap, 100)
}

// --- Plan Computation ---

/**
 * Compute the auto-discount plan from scored recommendations.
 * Applies discount tiers, guard rails, exclusions, and calculates new prices.
 */
export function computeAutoDiscountPlan(
  recommendations: DiscountRecommendation[],
  packageProductMap: Map<string, { productId: number; productName: string; unitPrice: number }>,
  config: AutoDiscountConfigData,
  costMap?: Map<string, number>,
): AutoDiscountPlan {
  const items: AutoDiscountPlanItem[] = []
  let skippedNoProduct = 0
  let skippedNoPrice = 0
  let skippedExcluded = 0
  let skippedBelowThreshold = 0
  let skippedPriorityFilter = 0
  let skippedBelowCost = 0
  let estimatedRevenueImpact = 0

  // Sort discount tiers by ageDays descending so we match the highest applicable tier
  const sortedTiers = [...config.discountTiers].sort((a, b) => b.ageDays - a.ageDays)

  for (const rec of recommendations) {
    // Filter by score threshold
    if (rec.score < config.minScoreThreshold) {
      skippedBelowThreshold++
      continue
    }

    // Filter by priority
    if (!config.priorityFilter.includes(rec.priority)) {
      skippedPriorityFilter++
      continue
    }

    // Look up Dutchie product
    const productInfo = packageProductMap.get(rec.packageLabel)
    if (!productInfo) {
      skippedNoProduct++
      continue
    }

    // Must have a current price to compute discount
    if (!productInfo.unitPrice || productInfo.unitPrice <= 0) {
      skippedNoPrice++
      continue
    }

    // Check exclusions
    if (config.excludedProductIds.includes(String(productInfo.productId))) {
      skippedExcluded++
      continue
    }
    if (config.excludedCategories.some(cat =>
      rec.itemCategory.toLowerCase().includes(cat.toLowerCase())
    )) {
      skippedExcluded++
      continue
    }

    // Find the highest matching discount tier by ageDays
    const tier = sortedTiers.find(t => rec.ageDays >= t.ageDays) ?? null
    if (!tier) {
      // No tier matches this age — skip
      continue
    }

    // Compute discount, capping at per-category max (or global max)
    const categoryMax = getCategoryMaxDiscount(config, rec.itemCategory)
    let discountPct = Math.min(tier.discountPct, categoryMax)

    // If the recommendation has a specific discount range from rules, use it as a hint
    if (rec.actionParams.discountRange) {
      const ruleMax = rec.actionParams.discountRange.max
      discountPct = Math.min(Math.max(discountPct, rec.actionParams.discountRange.min), ruleMax, categoryMax)
    }

    // Compute new price
    let newPrice = Math.round(productInfo.unitPrice * (1 - discountPct / 100) * 100) / 100

    // COGS floor: never discount below cost
    const unitCost = costMap?.get(rec.packageLabel)
    if (unitCost != null && unitCost > 0 && newPrice < unitCost) {
      newPrice = Math.ceil(unitCost * 100) / 100 // Round up to nearest cent
      discountPct = Math.round((1 - newPrice / productInfo.unitPrice) * 100 * 100) / 100
    }

    // Enforce price floor
    if (config.minPriceFloor != null && newPrice < config.minPriceFloor) {
      newPrice = config.minPriceFloor
      // Recalculate actual discount percentage
      discountPct = Math.round((1 - newPrice / productInfo.unitPrice) * 100 * 100) / 100
    }

    // Skip if the discount is effectively zero (including when COGS floor leaves no room)
    if (newPrice >= productInfo.unitPrice) {
      if (unitCost != null && unitCost > 0) {
        skippedBelowCost++
      }
      continue
    }

    const priceReduction = (productInfo.unitPrice - newPrice) * rec.quantity
    estimatedRevenueImpact -= priceReduction

    items.push({
      packageLabel: rec.packageLabel,
      productId: productInfo.productId,
      productName: productInfo.productName || rec.itemName,
      oldPrice: productInfo.unitPrice,
      newPrice,
      discountPct: Math.round(discountPct * 100) / 100,
      score: rec.score,
      ageDays: rec.ageDays,
      category: rec.itemCategory,
      priority: rec.priority,
      tierMatched: tier,
    })
  }

  return {
    items,
    estimatedRevenueImpact: Math.round(estimatedRevenueImpact * 100) / 100,
    totalRecommendations: recommendations.length,
    skippedNoProduct,
    skippedNoPrice,
    skippedExcluded,
    skippedBelowThreshold,
    skippedPriorityFilter,
    skippedBelowCost: skippedBelowCost > 0 ? skippedBelowCost : undefined,
  }
}

// --- Override Converters ---

/**
 * Convert plan items to Dutchie location overrides for applying new prices.
 */
export function planToLocationOverrides(plan: AutoDiscountPlan): DutchieLocationOverride[] {
  return plan.items.map(item => ({
    productId: item.productId,
    unitPrice: item.newPrice,
  }))
}

/**
 * Convert plan items to Dutchie location overrides that revert to original prices.
 */
export function planToRevertOverrides(planItems: AutoDiscountPlanItem[]): DutchieLocationOverride[] {
  return planItems.map(item => ({
    productId: item.productId,
    unitPrice: item.oldPrice,
  }))
}

/**
 * Parse per-category max discount percentages from JSON (Prisma stores as Json type).
 * Returns null if the input is empty or invalid.
 */
export function parseCategoryMaxDiscountPct(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'number' && value >= 1 && value <= 100) {
      result[key] = value
    }
  }
  return Object.keys(result).length > 0 ? result : null
}

/**
 * Parse discount tiers from JSON (Prisma stores as Json type).
 */
export function parseDiscountTiers(raw: unknown): DiscountTier[] {
  if (!raw) return []
  const arr = typeof raw === 'string' ? JSON.parse(raw) as unknown[] : raw as unknown[]
  if (!Array.isArray(arr)) return []
  return arr
    .filter((t): t is { ageDays: number; discountPct: number } =>
      typeof t === 'object' && t !== null &&
      typeof (t as Record<string, unknown>).ageDays === 'number' &&
      typeof (t as Record<string, unknown>).discountPct === 'number'
    )
    .map(t => ({ ageDays: t.ageDays, discountPct: t.discountPct }))
}
