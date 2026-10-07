import type { MetrcPackage } from '@/services/metrc/types'
import { calculateAgeDays, getAgeCategory } from '@/services/metrc/types'
import type { RuleDefinition } from './rules-engine'
import {
  scorePackagesForDiscounts,
  type DiscountRecommendation,
  type DiscountScoringOptions,
} from './discount-scoring-engine'
import { isLongTermStorageLocation } from '@/shared/constants/aging-exclusions'

// --- Types ---

export interface FIFOViolation {
  newerPackage: {
    label: string
    itemName: string
    ageDays: number
    quantity: number
    packagedDate: string
  }
  olderPackage: {
    label: string
    itemName: string
    ageDays: number
    quantity: number
    packagedDate: string
  }
  category: string
  strain: string
  daysDifference: number
  severity: 'critical' | 'high' | 'medium' | 'low'
}

export interface AgingBucket {
  category: 'fresh' | 'normal' | 'aging' | 'critical'
  label: string
  count: number
  totalQuantity: number
  packages: {
    label: string
    itemName: string
    ageDays: number
    quantity: number
    unitOfMeasure: string
  }[]
}

export interface AgingRecommendation {
  type: 'discount' | 'sample_out' | 'destroy' | 'remediate' | 'expedite_testing'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  packageLabel: string
  itemName: string
  ageDays: number
  quantity: number
  unitOfMeasure: string
  reason: string
  suggestedAction: string
}

export interface SlowMovingPackage {
  label: string
  itemName: string
  itemCategory: string
  strain: string
  ageDays: number
  quantity: number
  unitOfMeasure: string
  location: string
  lastModified: string
  tier: 'slow' | 'stagnant' | 'dead'
}

export interface AgingDistribution {
  fresh: AgingBucket
  normal: AgingBucket
  aging: AgingBucket
  critical: AgingBucket
  /** Total active packages on the facility (BEFORE long-term-storage exclusion). */
  totalPackages: number
  /** Packages excluded from bucket math because they sit in long-term storage
   * (seed banks, genetics libraries, mother stock). UI should disclose this so
   * users understand why buckets can sum to less than totalPackages. */
  excludedFromAging: number
  totalQuantityByUnit: Record<string, number>
  averageAgeDays: number
  medianAgeDays: number
}

// --- FIFO Violation Detection ---

// Category-aware FIFO thresholds — minimum age gap (days) to flag a violation.
// Plant material degrades fast; manufactured products have 12-18 month shelf lives.
const FIFO_MIN_DAYS: Record<string, number> = {
  'Buds': 7, 'Shake/Trim': 7, 'Flower': 7, 'Raw Pre-Rolls': 7,
  'Concentrate': 30, 'Concentrate (Each)': 30, 'Concentrate (Bulk)': 30,
  'Vape Product': 30, 'Vape Cartridge': 30,
  'Infused (Edible)': 30, 'Infused Pre-Rolls': 14, 'Infused (Non-Edible)': 30,
  'Infused Beverage': 14, 'Edibles': 30, 'Edible': 30,
  'Capsule': 30, 'Tincture': 30, 'Topical': 30,
}
const DEFAULT_FIFO_MIN_DAYS = 14

/** Get the minimum FIFO gap for a category, using substring match for state-variant names */
function getFIFOMinDays(category: string): number {
  // Exact match first
  if (FIFO_MIN_DAYS[category] !== undefined) return FIFO_MIN_DAYS[category]
  // Substring match for state variants (e.g., "Concentrate (Bulk)" matches "Concentrate")
  for (const [key, days] of Object.entries(FIFO_MIN_DAYS)) {
    if (category.includes(key) || key.includes(category)) return days
  }
  return DEFAULT_FIFO_MIN_DAYS
}

/** Compute violation severity relative to the category threshold */
function classifyViolationSeverity(daysDiff: number, minDays: number): 'critical' | 'high' | 'medium' | 'low' {
  if (daysDiff >= minDays * 4) return 'critical'
  if (daysDiff >= minDays * 2) return 'high'
  if (daysDiff >= minDays * 1.5) return 'medium'
  return 'low'
}

export function detectFIFOViolations(packages: MetrcPackage[]): FIFOViolation[] {
  // Phase 1: long-term storage (seed banks, genetics, mother stock) doesn't
  // follow FIFO rules — those packages are kept by design, not consumed.
  packages = packages.filter((p) => !isLongTermStorageLocation(p.LocationName))
  const violations: FIFOViolation[] = []

  // Group packages by category + strain
  const groups = new Map<string, (MetrcPackage & { ageDays: number })[]>()

  for (const pkg of packages) {
    if (pkg.FinishedDate || pkg.ArchivedDate) continue
    const ageDays = calculateAgeDays(pkg.PackagedDate)
    const strainOrItem = pkg.ItemStrainName || pkg.ItemName
    const key = `${pkg.ItemCategory}::${strainOrItem}`
    const group = groups.get(key) ?? []
    group.push({ ...pkg, ageDays })
    groups.set(key, group)
  }

  // Within each group, check if newer packages have been modified more recently
  // than older packages (suggesting they were pulled first)
  for (const [key, group] of Array.from(groups.entries())) {
    if (group.length < 2) continue

    // Sort by packaged date ascending (oldest first)
    const sorted = [...group].sort(
      (a, b) => new Date(a.PackagedDate).getTime() - new Date(b.PackagedDate).getTime()
    )

    const [category, strain] = key.split('::')
    const minDays = getFIFOMinDays(category ?? '')

    for (let i = 0; i < sorted.length - 1; i++) {
      const older = sorted[i]
      for (let j = i + 1; j < sorted.length; j++) {
        const newer = sorted[j]

        // FIFO violation: newer package was modified more recently AND
        // older package still has significant quantity remaining
        const olderModified = new Date(older.LastModified).getTime()
        const newerModified = new Date(newer.LastModified).getTime()
        const daysDiff = older.ageDays - newer.ageDays

        if (
          newerModified > olderModified &&
          older.Quantity > 0 &&
          newer.ageDays < older.ageDays &&
          daysDiff >= minDays
        ) {
          violations.push({
            newerPackage: {
              label: newer.Label,
              itemName: newer.ItemName,
              ageDays: newer.ageDays,
              quantity: newer.Quantity,
              packagedDate: newer.PackagedDate,
            },
            olderPackage: {
              label: older.Label,
              itemName: older.ItemName,
              ageDays: older.ageDays,
              quantity: older.Quantity,
              packagedDate: older.PackagedDate,
            },
            category,
            strain,
            daysDifference: daysDiff,
            severity: classifyViolationSeverity(daysDiff, minDays),
          })
          break // Only flag the most significant violation per older package
        }
      }
    }
  }

  // Sort by days difference descending (worst violations first)
  return violations.sort((a, b) => b.daysDifference - a.daysDifference)
}

// --- Aging Distribution Analysis ---

export function analyzeAgingDistribution(packages: MetrcPackage[]): AgingDistribution {
  // Phase 1: exclude long-term storage locations from aging buckets + averages.
  // Seed banks/genetics inflate avg age and dominate the Critical bucket
  // without being actionable. `totalPackages` keeps the unfiltered count so
  // it matches headline numbers elsewhere; `excludedFromAging` reports the
  // difference so the UI can disclose it (otherwise users see a discrepancy
  // between Total and bucket sums and assume the page is broken).
  const originalLength = packages.length
  packages = packages.filter((p) => !isLongTermStorageLocation(p.LocationName))
  const excludedFromAging = originalLength - packages.length
  const buckets: Record<string, AgingBucket> = {
    fresh: { category: 'fresh', label: '0-30 days', count: 0, totalQuantity: 0, packages: [] },
    normal: { category: 'normal', label: '31-60 days', count: 0, totalQuantity: 0, packages: [] },
    aging: { category: 'aging', label: '61-90 days', count: 0, totalQuantity: 0, packages: [] },
    critical: { category: 'critical', label: '90+ days', count: 0, totalQuantity: 0, packages: [] },
  }

  const totalQuantityByUnit: Record<string, number> = {}
  const ageDaysList: number[] = []

  for (const pkg of packages) {
    if (pkg.FinishedDate || pkg.ArchivedDate) continue

    const ageDays = calculateAgeDays(pkg.PackagedDate)
    const cat = getAgeCategory(ageDays)
    ageDaysList.push(ageDays)

    buckets[cat].count++
    buckets[cat].totalQuantity += pkg.Quantity
    buckets[cat].packages.push({
      label: pkg.Label,
      itemName: pkg.ItemName,
      ageDays,
      quantity: pkg.Quantity,
      unitOfMeasure: pkg.UnitOfMeasureName,
    })

    totalQuantityByUnit[pkg.UnitOfMeasureName] =
      (totalQuantityByUnit[pkg.UnitOfMeasureName] ?? 0) + pkg.Quantity
  }

  // Sort packages within each bucket by age descending
  for (const bucket of Object.values(buckets)) {
    bucket.packages.sort((a, b) => b.ageDays - a.ageDays)
  }

  const sortedAges = [...ageDaysList].sort((a, b) => a - b)
  const eligibleCount = sortedAges.length
  const averageAgeDays = eligibleCount > 0
    ? Math.round(sortedAges.reduce((sum, d) => sum + d, 0) / eligibleCount)
    : 0
  const medianAgeDays = eligibleCount > 0
    ? sortedAges[Math.floor(eligibleCount / 2)]
    : 0

  return {
    fresh: buckets.fresh as AgingBucket,
    normal: buckets.normal as AgingBucket,
    aging: buckets.aging as AgingBucket,
    critical: buckets.critical as AgingBucket,
    totalPackages: originalLength,
    excludedFromAging,
    totalQuantityByUnit,
    averageAgeDays,
    medianAgeDays,
  }
}

// --- Aging Recommendations ---

export function generateAgingRecommendations(packages: MetrcPackage[]): AgingRecommendation[] {
  // Phase 1: don't recommend discounts/destroy/sample-out on long-term storage.
  packages = packages.filter((p) => !isLongTermStorageLocation(p.LocationName))
  const recommendations: AgingRecommendation[] = []

  for (const pkg of packages) {
    if (pkg.FinishedDate || pkg.ArchivedDate) continue
    // Skip depleted packages — Metrc may still flag them active but there's
    // nothing to discount/destroy/expedite. Mirrors detectSlowMoving guard.
    if (pkg.Quantity <= 0) continue
    const ageDays = calculateAgeDays(pkg.PackagedDate)

    // Critical aging (90+ days): urgent action
    if (ageDays >= 90) {
      if (pkg.LabTestingState === 'NotSubmitted') {
        recommendations.push({
          type: 'destroy',
          priority: 'urgent',
          packageLabel: pkg.Label,
          itemName: pkg.ItemName,
          ageDays,
          quantity: pkg.Quantity,
          unitOfMeasure: pkg.UnitOfMeasureName,
          reason: `Package is ${ageDays} days old and has never been tested`,
          suggestedAction: 'Consider destruction or immediate lab submission',
        })
      } else if (pkg.Quantity > 0) {
        recommendations.push({
          type: 'discount',
          priority: 'urgent',
          packageLabel: pkg.Label,
          itemName: pkg.ItemName,
          ageDays,
          quantity: pkg.Quantity,
          unitOfMeasure: pkg.UnitOfMeasureName,
          reason: `Package is ${ageDays} days old - significant freshness degradation`,
          suggestedAction: 'Apply deep discount (30-50% off) or use for extraction',
        })
      }
    }

    // Aging (60-89 days): proactive action
    if (ageDays >= 60 && ageDays < 90) {
      recommendations.push({
        type: 'discount',
        priority: 'high',
        packageLabel: pkg.Label,
        itemName: pkg.ItemName,
        ageDays,
        quantity: pkg.Quantity,
        unitOfMeasure: pkg.UnitOfMeasureName,
        reason: `Package is ${ageDays} days old - approaching critical aging`,
        suggestedAction: 'Apply moderate discount (15-25% off) to accelerate sell-through',
      })
    }

    // Untested after 14 days
    if (ageDays >= 14 && pkg.LabTestingState === 'NotSubmitted') {
      recommendations.push({
        type: 'expedite_testing',
        priority: ageDays >= 30 ? 'high' : 'medium',
        packageLabel: pkg.Label,
        itemName: pkg.ItemName,
        ageDays,
        quantity: pkg.Quantity,
        unitOfMeasure: pkg.UnitOfMeasureName,
        reason: `Package has been untested for ${ageDays} days`,
        suggestedAction: 'Submit for lab testing immediately',
      })
    }

    // Failed testing: needs remediation
    if (pkg.LabTestingState === 'TestFailed' && pkg.Quantity > 0) {
      recommendations.push({
        type: 'remediate',
        priority: 'urgent',
        packageLabel: pkg.Label,
        itemName: pkg.ItemName,
        ageDays,
        quantity: pkg.Quantity,
        unitOfMeasure: pkg.UnitOfMeasureName,
        reason: 'Package failed lab testing',
        suggestedAction: 'Begin remediation process or schedule for destruction',
      })
    }

    // Small quantities of aging product: sample out
    if (ageDays >= 45 && pkg.Quantity > 0 && pkg.Quantity <= 10 && pkg.UnitOfMeasureName === 'Grams') {
      recommendations.push({
        type: 'sample_out',
        priority: 'low',
        packageLabel: pkg.Label,
        itemName: pkg.ItemName,
        ageDays,
        quantity: pkg.Quantity,
        unitOfMeasure: pkg.UnitOfMeasureName,
        reason: `Small quantity (${pkg.Quantity}g) aging at ${ageDays} days`,
        suggestedAction: 'Use as trade sample or promotional sample',
      })
    }
  }

  // Sort by priority
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
}

// --- Slow/Non-Moving Detection ---

export function detectSlowMoving(
  packages: MetrcPackage[],
  thresholds: { slow: number; stagnant: number; dead: number } = { slow: 45, stagnant: 75, dead: 120 }
): SlowMovingPackage[] {
  // Phase 1: long-term storage is "slow-moving" by design — exclude from
  // the slow/stagnant/dead tiering.
  packages = packages.filter((p) => !isLongTermStorageLocation(p.LocationName))
  const results: SlowMovingPackage[] = []

  for (const pkg of packages) {
    if (pkg.FinishedDate || pkg.ArchivedDate) continue
    if (pkg.Quantity <= 0) continue

    const ageDays = calculateAgeDays(pkg.PackagedDate)

    let tier: 'slow' | 'stagnant' | 'dead' | null = null
    if (ageDays >= thresholds.dead) tier = 'dead'
    else if (ageDays >= thresholds.stagnant) tier = 'stagnant'
    else if (ageDays >= thresholds.slow) tier = 'slow'

    if (tier) {
      results.push({
        label: pkg.Label,
        itemName: pkg.ItemName,
        itemCategory: pkg.ItemCategory,
        strain: pkg.ItemStrainName,
        ageDays,
        quantity: pkg.Quantity,
        unitOfMeasure: pkg.UnitOfMeasureName,
        location: pkg.LocationName,
        lastModified: pkg.LastModified,
        tier,
      })
    }
  }

  return results.sort((a, b) => b.ageDays - a.ageDays)
}

// --- Scored Aging Recommendations Bridge ---

/**
 * Returns both legacy aging recommendations (backward compat) and new scored
 * discount recommendations. If no discount rules are provided, `scored` is empty.
 */
export function generateScoredAgingRecommendations(
  packages: MetrcPackage[],
  discountRules?: RuleDefinition[],
  options?: DiscountScoringOptions,
): { legacy: AgingRecommendation[]; scored: DiscountRecommendation[] } {
  // Phase 1: also filter at this layer so scored discount recommendations
  // (which call scorePackagesForDiscounts directly) skip long-term storage.
  // generateAgingRecommendations filters again internally — idempotent.
  packages = packages.filter((p) => !isLongTermStorageLocation(p.LocationName))
  const legacy = generateAgingRecommendations(packages)
  const scored = discountRules && discountRules.length > 0
    ? scorePackagesForDiscounts(discountRules, packages, options)
    : []
  return { legacy, scored }
}
