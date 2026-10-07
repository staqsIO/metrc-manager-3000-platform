import type { MetrcPackage } from '@/services/metrc/types'
import { evaluateRulesAgainstPackages } from './rules-engine'
import type { RuleDefinition, RuleViolation } from './rules-engine'

// --- Types ---

export type DiscountActionType =
  | 'DISCOUNT_RECOMMEND'
  | 'AUTO_DISCOUNT'
  | 'PROMO_FLAG'
  | 'CONSOLIDATE'
  | 'SAMPLE_OUT'

export interface DiscountActionParams {
  discountPct?: number
  discountRange?: { min: number; max: number }
  suggestedAction?: string
  retailPriceMultiplier?: number
}

export interface ScoreBreakdown {
  age: number
  quantity: number
  velocity: number
  category: number
  margin: number
}

export interface DiscountRecommendation {
  packageLabel: string
  itemName: string
  itemCategory: string
  quantity: number
  unitOfMeasure: string
  ageDays: number
  score: number
  scoreBreakdown: ScoreBreakdown
  priority: 'urgent' | 'high' | 'medium' | 'low'
  actionType: DiscountActionType
  actionParams: DiscountActionParams
  suggestedAction: string
  matchedRuleIds: string[]
  matchedRuleNames: string[]
  metadata?: Record<string, unknown>
}

/** Phase 2 stub — Dutchie write-back action */
export interface RetailPriceAction {
  packageLabel: string
  itemName: string
  newPrice?: number
  discountPct?: number
  actionType: 'PRICE_OVERRIDE' | 'DISCOUNT_APPLY' | 'PROMO_TAG'
  dutchieLocationId?: string
}

export interface DiscountSummary {
  totalRecommendations: number
  byActionType: Record<string, number>
  byPriority: Record<string, number>
  averageScore: number
  highScoreCount: number
}

export interface DiscountScoringOptions {
  minScore?: number
  actionTypeFilter?: DiscountActionType
  maxResults?: number
  velocityMap?: Map<string, 'excess' | 'healthy' | 'low' | 'critical'>
  /** Optional map of package label → cost per unit from Canix COGS engine */
  costMap?: Map<string, number>
}

// --- Score Computation ---
//
// Composite score: 0-110.
// Components: age (0-40) + quantity (0-20) + velocity (0-20) + category (0-20) + margin (0-10).
// Margin component: high-margin items get 0 bonus (no urgency), low-margin items get 10 (discount
// before expiry to avoid total loss). Defaults to 5 (neutral) when COGS data is unavailable.
// Priority thresholds: urgent >= 70, high >= 50, medium >= 30, low < 30.

export function computeDiscountScore(
  ageDays: number,
  quantity: number,
  unitOfMeasure: string,
  velocityStatus?: 'excess' | 'healthy' | 'low' | 'critical' | null,
  category?: string,
  costPerUnit?: number | null,
): { score: number; breakdown: ScoreBreakdown } {
  // Age score (0-40)
  let age = 0
  if (ageDays >= 90) age = 40
  else if (ageDays >= 75) age = 30
  else if (ageDays >= 60) age = 20
  else if (ageDays >= 45) age = 10

  // Quantity score (0-20): small remnant quantities score higher for discount urgency.
  // Cannabis-specific thresholds: <10g (~0.35oz) is a single-unit retail quantity;
  // <50g is a partial unit. For count-based items: <5ea is remnant, <25ea is partial.
  let quantityScore = 5
  const isWeight = unitOfMeasure.toLowerCase().includes('gram') || unitOfMeasure.toLowerCase().includes('ounce') || unitOfMeasure.toLowerCase().includes('pound')
  if (isWeight) {
    if (quantity < 10) quantityScore = 20
    else if (quantity < 50) quantityScore = 12
  } else {
    if (quantity < 5) quantityScore = 20
    else if (quantity < 25) quantityScore = 12
  }

  // Velocity score (0-20). Defaults to 10 when velocity data is unavailable (Phase 2: FOR-961).
  let velocity = 10
  if (velocityStatus === 'excess') velocity = 20
  else if (velocityStatus === 'healthy') velocity = 5
  else if (velocityStatus === 'low' || velocityStatus === 'critical') velocity = 0

  // Category score (0-20)
  let categoryScore = 5
  const lowerCat = (category ?? '').toLowerCase()
  if (lowerCat.includes('biomass') || lowerCat.includes('trim') || lowerCat.includes('shake')) {
    categoryScore = 20
  } else if (lowerCat.includes('flower') || lowerCat.includes('bud')) {
    categoryScore = 15
  } else if (lowerCat.includes('concentrate') || lowerCat.includes('extract')) {
    categoryScore = 10
  }

  // Margin score (0-10). When costPerUnit is known, low-margin items get higher urgency
  // (discount before they expire and become total loss). High-margin items can absorb age.
  // Neutral (5) when COGS data is unavailable.
  let marginScore = 5
  if (costPerUnit != null && costPerUnit > 0) {
    // Use cost-to-typical-retail ratio as a proxy for margin pressure.
    // "Typical retail" is approximated from category norms; costPerUnit / retail ratio thresholds:
    //   < 0.30 → high margin (0 bonus), 0.30-0.70 → medium (5), > 0.70 → low margin (10)
    // Since we don't have retail price here, we use the ratio of cost to a category-typical
    // multiplier. For simplicity, the thresholds are expressed as cost fraction buckets.
    // Callers should pass costPerUnit relative to retail price for best results.
    // Without retail context, we score based on absolute cost bands:
    //   This is intentionally coarse — the value comes from having *any* COGS signal.
    marginScore = 5 // medium by default when cost is known but no clear signal
    // Low-cost items (high margin) — less urgency to discount
    // High-cost items (low margin) — more urgency to recover cost before expiry
    // These thresholds work for cannabis retail where typical unit prices are $10-$80
    if (costPerUnit < 5) marginScore = 0       // Very low cost → high margin → no bonus
    else if (costPerUnit < 15) marginScore = 3  // Low-moderate cost
    else if (costPerUnit < 30) marginScore = 5  // Medium cost
    else if (costPerUnit < 50) marginScore = 7  // Moderate-high cost
    else marginScore = 10                       // High cost → low margin → urgent to discount
  }

  const score = age + quantityScore + velocity + categoryScore + marginScore

  return {
    score,
    breakdown: {
      age,
      quantity: quantityScore,
      velocity,
      category: categoryScore,
      margin: marginScore,
    },
  }
}

function scoreToPriority(score: number): 'urgent' | 'high' | 'medium' | 'low' {
  if (score >= 70) return 'urgent'
  if (score >= 50) return 'high'
  if (score >= 30) return 'medium'
  return 'low'
}

function extractActionParams(violation: RuleViolation): DiscountActionParams {
  const meta = violation.metadata as Record<string, unknown> | undefined
  const ap = meta?.actionParams as DiscountActionParams | undefined
  return ap ?? {}
}

function extractActionType(violation: RuleViolation): DiscountActionType {
  // The rule's actionType was spread into violation.metadata by rules-engine
  const meta = violation.metadata as Record<string, unknown> | undefined
  const at = meta?.actionType as string | undefined
  if (at && isDiscountActionType(at)) return at
  return 'DISCOUNT_RECOMMEND'
}

function isDiscountActionType(s: string): s is DiscountActionType {
  return ['DISCOUNT_RECOMMEND', 'AUTO_DISCOUNT', 'PROMO_FLAG', 'CONSOLIDATE', 'SAMPLE_OUT'].includes(s)
}

function buildSuggestedAction(actionType: DiscountActionType, params: DiscountActionParams, score: number): string {
  if (params.suggestedAction) return params.suggestedAction
  if (params.discountRange) {
    return `Apply ${params.discountRange.min}-${params.discountRange.max}% discount (score: ${score})`
  }
  switch (actionType) {
    case 'DISCOUNT_RECOMMEND': return `Recommend discount (score: ${score})`
    case 'AUTO_DISCOUNT': return `Auto-apply discount (score: ${score})`
    case 'PROMO_FLAG': return 'Safe for promotions'
    case 'CONSOLIDATE': return 'Consolidate fragmented packages'
    case 'SAMPLE_OUT': return 'Use as trade/promo sample'
    default: return `Review for discount action (score: ${score})`
  }
}

// --- Main Engine ---

export function scorePackagesForDiscounts(
  rules: RuleDefinition[],
  packages: MetrcPackage[],
  options?: DiscountScoringOptions,
): DiscountRecommendation[] {
  // Only evaluate discount-category rules
  const discountRules = rules.filter(r => r.category === 'discount')
  if (discountRules.length === 0) return []

  // Get condition matches from the existing rules engine
  const violations = evaluateRulesAgainstPackages(discountRules, packages)

  // Build a lookup: packageLabel → all matching violations
  const byPackage = new Map<string, RuleViolation[]>()
  for (const v of violations) {
    if (!v.packageLabel) continue
    const list = byPackage.get(v.packageLabel) ?? []
    list.push(v)
    byPackage.set(v.packageLabel, list)
  }

  // Build package lookup for enrichment
  const packageMap = new Map<string, MetrcPackage>()
  for (const pkg of packages) {
    packageMap.set(pkg.Label, pkg)
  }

  const recommendations: DiscountRecommendation[] = []

  for (const [label, matchedViolations] of Array.from(byPackage.entries())) {
    const pkg = packageMap.get(label)
    if (!pkg) continue

    // ageDays is always present in violation metadata — rules-engine injects it
    // for every package evaluation (see rules-engine.ts evaluateRulesAgainstPackages)
    const meta = matchedViolations[0].metadata as Record<string, unknown> | undefined
    const ageDays = (meta?.ageDays as number) ?? 0

    // Look up velocity status from optional map (FOR-961)
    const velocityStatus = options?.velocityMap?.get(pkg.ItemName.toLowerCase().trim())
      ?? options?.velocityMap?.get(pkg.ItemCategory.toLowerCase().trim())
      ?? null

    // Look up COGS from optional cost map
    const costPerUnit = options?.costMap?.get(label) ?? null

    // Compute composite score
    const { score, breakdown } = computeDiscountScore(
      ageDays,
      pkg.Quantity,
      pkg.UnitOfMeasureName,
      velocityStatus,
      pkg.ItemCategory,
      costPerUnit,
    )

    // Pick the highest-value action type across all matched rules
    // Priority: DISCOUNT_RECOMMEND > AUTO_DISCOUNT > SAMPLE_OUT > CONSOLIDATE > PROMO_FLAG
    const actionPriority: DiscountActionType[] = ['DISCOUNT_RECOMMEND', 'AUTO_DISCOUNT', 'SAMPLE_OUT', 'CONSOLIDATE', 'PROMO_FLAG']
    let bestActionType: DiscountActionType = 'DISCOUNT_RECOMMEND'
    let bestParams: DiscountActionParams = {}

    for (const at of actionPriority) {
      const matching = matchedViolations.find(v => extractActionType(v) === at)
      if (matching) {
        bestActionType = at
        bestParams = extractActionParams(matching)
        break
      }
    }

    const priority = scoreToPriority(score)
    const suggestedAction = buildSuggestedAction(bestActionType, bestParams, score)

    recommendations.push({
      packageLabel: label,
      itemName: pkg.ItemName,
      itemCategory: pkg.ItemCategory,
      quantity: pkg.Quantity,
      unitOfMeasure: pkg.UnitOfMeasureName,
      ageDays,
      score,
      scoreBreakdown: breakdown,
      priority,
      actionType: bestActionType,
      actionParams: bestParams,
      suggestedAction,
      matchedRuleIds: matchedViolations.map(v => v.ruleId),
      matchedRuleNames: matchedViolations.map(v => v.ruleName),
    })
  }

  // Sort by score descending
  recommendations.sort((a, b) => b.score - a.score)

  // Apply filters
  let filtered = recommendations
  if (options?.minScore != null) {
    filtered = filtered.filter(r => r.score >= options.minScore!)
  }
  if (options?.actionTypeFilter) {
    filtered = filtered.filter(r => r.actionType === options.actionTypeFilter)
  }
  if (options?.maxResults) {
    filtered = filtered.slice(0, options.maxResults)
  }

  return filtered
}

// --- Summary ---

export function summarizeDiscountRecommendations(recs: DiscountRecommendation[]): DiscountSummary {
  const byActionType: Record<string, number> = {}
  const byPriority: Record<string, number> = {}
  let totalScore = 0

  for (const r of recs) {
    byActionType[r.actionType] = (byActionType[r.actionType] ?? 0) + 1
    byPriority[r.priority] = (byPriority[r.priority] ?? 0) + 1
    totalScore += r.score
  }

  return {
    totalRecommendations: recs.length,
    byActionType,
    byPriority,
    averageScore: recs.length > 0 ? Math.round(totalScore / recs.length) : 0,
    highScoreCount: recs.filter(r => r.score >= 50).length,
  }
}

// --- Retail Price Actions (FOR-961) ---

/**
 * Convert discount recommendations to retail price actions.
 * Each recommendation with a discountRange becomes a PRICE_OVERRIDE action.
 */
export function toRetailPriceActions(recs: DiscountRecommendation[]): RetailPriceAction[] {
  return recs
    .filter(r => r.actionType === 'DISCOUNT_RECOMMEND' || r.actionType === 'AUTO_DISCOUNT')
    .map(r => {
      const discountPct = r.actionParams.discountRange
        ? (r.actionParams.discountRange.min + r.actionParams.discountRange.max) / 2
        : r.actionParams.discountPct ?? 0
      return {
        packageLabel: r.packageLabel,
        itemName: r.itemName,
        discountPct,
        actionType: r.actionType === 'AUTO_DISCOUNT' ? 'DISCOUNT_APPLY' as const : 'PRICE_OVERRIDE' as const,
      }
    })
}
