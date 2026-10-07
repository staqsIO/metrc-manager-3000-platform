import type { MetrcPackage } from '@/services/metrc/types'
import { calculateAgeDays } from '@/services/metrc/types'

// --- Types ---

export interface FragmentedGroup {
  itemName: string
  itemCategory: string
  strain: string
  packageCount: number
  totalQuantity: number
  unitOfMeasure: string
  averageQuantity: number
  smallestQuantity: number
  largestQuantity: number
  packages: {
    label: string
    quantity: number
    ageDays: number
    location: string
  }[]
}

export interface ConsolidationRecommendation {
  targetItemName: string
  targetCategory: string
  targetStrain: string
  sourcePackages: {
    label: string
    quantity: number
    ageDays: number
    location: string
  }[]
  combinedQuantity: number
  unitOfMeasure: string
  estimatedPackagesReduced: number
  reason: string
  priority: 'low' | 'medium' | 'high'
}

export interface SampleOutCandidate {
  label: string
  itemName: string
  itemCategory: string
  strain: string
  quantity: number
  unitOfMeasure: string
  ageDays: number
  location: string
  reason: string
}

export interface BiomassPackage {
  label: string
  itemName: string
  itemCategory: string
  quantity: number
  unitOfMeasure: string
  ageDays: number
  location: string
  estimatedValue: 'high' | 'medium' | 'low' | 'minimal'
  valueRemaining: number          // 0.0–1.0 from degradation curve
  dailyValueLossRate: number      // fraction per day at current age (0 if at floor)
  strain: string
  labTestingState: string
  isOnHold: boolean
  requiresRemediation: boolean
}

export interface BiomassUtilization {
  totalBiomassPackages: number
  totalQuantityByUnit: Record<string, number>
  byCategory: Record<string, {
    count: number
    totalQuantity: number
    packages: BiomassPackage[]
  }>
  recoveryOpportunities: {
    category: string
    packageCount: number
    totalQuantity: number
    unitOfMeasure: string
    suggestedUse: string
    estimatedValueTier: string
  }[]
}

// --- Short Count Detection ---

export interface ShortCountFinding {
  itemName: string
  itemCategory: string
  unitOfMeasure: string
  standardCaseSize: number
  modeFrequency: number
  totalPackagesAnalyzed: number
  shortCountPackages: {
    label: string
    quantity: number
    deficit: number
    reason: string
    ageDays: number
    location: string
  }[]
}

/**
 * Detect packages with quantities that don't match standard case size multiples.
 *
 * Infers the standard case size per ItemName by computing the mode (most common
 * quantity) across all active packages of that item. Packages whose current
 * quantity is NOT a multiple of the inferred case size are flagged.
 *
 * @param packages   Active packages from Metrc
 * @param modeThreshold  Minimum mode frequency to trust the inferred size (default 3)
 */
export function detectShortCounts(
  packages: MetrcPackage[],
  modeThreshold = 3,
): ShortCountFinding[] {
  // Group active packages by ItemName + UnitOfMeasure
  const groups = new Map<string, MetrcPackage[]>()

  for (const pkg of packages) {
    if (pkg.FinishedDate || pkg.ArchivedDate) continue
    if (pkg.Quantity <= 0) continue

    const key = `${pkg.ItemName}::${pkg.UnitOfMeasureName}`
    const group = groups.get(key) ?? []
    group.push(pkg)
    groups.set(key, group)
  }

  const findings: ShortCountFinding[] = []

  for (const [, group] of Array.from(groups.entries())) {
    if (group.length < modeThreshold) continue

    // Compute mode of quantities
    const freq = new Map<number, number>()
    for (const pkg of group) {
      freq.set(pkg.Quantity, (freq.get(pkg.Quantity) ?? 0) + 1)
    }

    let modeValue = 0
    let modeCount = 0
    for (const [value, count] of Array.from(freq.entries())) {
      if (count > modeCount) {
        modeCount = count
        modeValue = value
      }
    }

    // Only trust the mode if it appears enough times
    if (modeCount < modeThreshold || modeValue <= 0) continue

    // Find packages that don't match a multiple of the case size
    const shortPackages = group
      .filter((pkg: MetrcPackage) => pkg.Quantity % modeValue !== 0)
      .map((pkg: MetrcPackage) => {
        const remainder = pkg.Quantity % modeValue
        const deficit = modeValue - remainder
        const ageDays = calculateAgeDays(pkg.PackagedDate)
        return {
          label: pkg.Label,
          quantity: pkg.Quantity,
          deficit,
          reason: `Quantity ${pkg.Quantity} does not match standard case size ${modeValue} (short by ${deficit} ${pkg.UnitOfMeasureName})`,
          ageDays,
          location: pkg.LocationName,
        }
      })

    if (shortPackages.length === 0) continue

    findings.push({
      itemName: group[0].ItemName,
      itemCategory: group[0].ItemCategory,
      unitOfMeasure: group[0].UnitOfMeasureName,
      standardCaseSize: modeValue,
      modeFrequency: modeCount,
      totalPackagesAnalyzed: group.length,
      shortCountPackages: shortPackages.sort((a: { deficit: number }, b: { deficit: number }) => b.deficit - a.deficit),
    })
  }

  // Sort by number of short packages descending
  return findings.sort((a, b) => b.shortCountPackages.length - a.shortCountPackages.length)
}

// --- Fragmentation Detection ---

const FRAGMENTATION_THRESHOLD = 3 // Minimum packages of same item to be considered fragmented

export function detectFragmentation(packages: MetrcPackage[]): FragmentedGroup[] {
  const groups = new Map<string, MetrcPackage[]>()

  for (const pkg of packages) {
    if (pkg.FinishedDate || pkg.ArchivedDate) continue
    if (pkg.Quantity <= 0) continue

    const key = `${pkg.ItemName}::${pkg.ItemCategory}::${pkg.ItemStrainName}`
    const group = groups.get(key) ?? []
    group.push(pkg)
    groups.set(key, group)
  }

  const fragmented: FragmentedGroup[] = []

  for (const [, group] of Array.from(groups.entries())) {
    if (group.length < FRAGMENTATION_THRESHOLD) continue

    const quantities = group.map(p => p.Quantity)
    const totalQuantity = quantities.reduce((sum, q) => sum + q, 0)
    const sorted = [...quantities].sort((a, b) => a - b)

    fragmented.push({
      itemName: group[0].ItemName,
      itemCategory: group[0].ItemCategory,
      strain: group[0].ItemStrainName,
      packageCount: group.length,
      totalQuantity,
      unitOfMeasure: group[0].UnitOfMeasureName,
      averageQuantity: Math.round((totalQuantity / group.length) * 100) / 100,
      smallestQuantity: sorted[0],
      largestQuantity: sorted[sorted.length - 1],
      packages: group.map(p => ({
        label: p.Label,
        quantity: p.Quantity,
        ageDays: calculateAgeDays(p.PackagedDate),
        location: p.LocationName,
      })).sort((a, b) => a.quantity - b.quantity),
    })
  }

  // Sort by package count descending (most fragmented first)
  return fragmented.sort((a, b) => b.packageCount - a.packageCount)
}

// --- Consolidation Recommendations ---

export function generateConsolidationRecommendations(packages: MetrcPackage[]): ConsolidationRecommendation[] {
  const fragmented = detectFragmentation(packages)
  const recommendations: ConsolidationRecommendation[] = []

  for (const group of fragmented) {
    // Find small packages that could be consolidated
    const smallPackages = group.packages.filter(
      p => p.quantity < group.averageQuantity * 0.5
    )

    if (smallPackages.length < 2) continue

    const combinedQuantity = smallPackages.reduce((sum, p) => sum + p.quantity, 0)
    const estimatedReduction = smallPackages.length - 1

    let priority: 'low' | 'medium' | 'high' = 'low'
    if (smallPackages.length >= 5) priority = 'high'
    else if (smallPackages.length >= 3) priority = 'medium'

    recommendations.push({
      targetItemName: group.itemName,
      targetCategory: group.itemCategory,
      targetStrain: group.strain,
      sourcePackages: smallPackages,
      combinedQuantity,
      unitOfMeasure: group.unitOfMeasure,
      estimatedPackagesReduced: estimatedReduction,
      reason: `${smallPackages.length} small packages (avg ${Math.round(combinedQuantity / smallPackages.length * 100) / 100} ${group.unitOfMeasure}) can be consolidated into fewer packages`,
      priority,
    })
  }

  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
}

// --- Sample-Out Candidates ---

export function findSampleOutCandidates(
  packages: MetrcPackage[],
  thresholds: { maxQuantityGrams: number; maxQuantityEach: number; minAgeDays: number } = {
    maxQuantityGrams: 7,
    maxQuantityEach: 3,
    minAgeDays: 30,
  }
): SampleOutCandidate[] {
  const candidates: SampleOutCandidate[] = []

  for (const pkg of packages) {
    if (pkg.FinishedDate || pkg.ArchivedDate) continue
    if (pkg.Quantity <= 0) continue

    const ageDays = calculateAgeDays(pkg.PackagedDate)
    if (ageDays < thresholds.minAgeDays) continue

    const isWeightBased = pkg.UnitOfMeasureName === 'Grams' || pkg.UnitOfMeasureName === 'Ounces'
    const threshold = isWeightBased ? thresholds.maxQuantityGrams : thresholds.maxQuantityEach

    if (pkg.Quantity <= threshold) {
      const reasons: string[] = []
      if (ageDays >= 60) reasons.push(`aging (${ageDays} days)`)
      if (pkg.Quantity <= threshold * 0.5) reasons.push('very low quantity')
      if (pkg.LabTestingState === 'TestPassed') reasons.push('already tested')

      candidates.push({
        label: pkg.Label,
        itemName: pkg.ItemName,
        itemCategory: pkg.ItemCategory,
        strain: pkg.ItemStrainName,
        quantity: pkg.Quantity,
        unitOfMeasure: pkg.UnitOfMeasureName,
        ageDays,
        location: pkg.LocationName,
        reason: reasons.length > 0
          ? `Low quantity (${pkg.Quantity} ${pkg.UnitOfMeasureName}) - ${reasons.join(', ')}`
          : `Low quantity (${pkg.Quantity} ${pkg.UnitOfMeasureName}) with ${ageDays} days age`,
      })
    }
  }

  return candidates.sort((a, b) => a.quantity - b.quantity)
}

// --- Degradation Curves ---

export interface DegradationCurve {
  halfLifeDays: number
  floorPercent: number  // 0-100, minimum value floor
}

const DEGRADATION_CURVES: Record<string, DegradationCurve> = {
  'Wet Whole Plants':  { halfLifeDays: 5,  floorPercent: 10 },
  'Shake/Trim':        { halfLifeDays: 45, floorPercent: 15 },
  'Extraction Buds':   { halfLifeDays: 60, floorPercent: 20 },
  'PlantWaste':        { halfLifeDays: 30, floorPercent: 5  },
  'HarvestWaste':      { halfLifeDays: 30, floorPercent: 5  },
}

const DEFAULT_CURVE: DegradationCurve = { halfLifeDays: 45, floorPercent: 10 }

/** Exponential decay: value = max(floor, e^(-λt)) where λ = ln(2)/halfLife */
export function computeDegradedValue(ageDays: number, curve: DegradationCurve): number {
  if (ageDays <= 0) return 1
  const lambda = Math.LN2 / curve.halfLifeDays
  const floor = curve.floorPercent / 100
  return Math.max(floor, Math.exp(-lambda * ageDays))
}

/** Daily loss rate as a fraction at the current age (0 when at floor) */
export function computeDailyLossRate(ageDays: number, curve: DegradationCurve): number {
  const lambda = Math.LN2 / curve.halfLifeDays
  const value = computeDegradedValue(ageDays, curve)
  const floor = curve.floorPercent / 100
  return value > floor ? lambda * value : 0
}

function tierFromValue(v: number, quantity: number): 'high' | 'medium' | 'low' | 'minimal' {
  // Small quantities cap at 'medium' regardless of freshness
  const adjusted = quantity < 50 ? Math.min(v, 0.65) : v
  if (adjusted >= 0.7) return 'high'
  if (adjusted >= 0.4) return 'medium'
  if (adjusted >= 0.15) return 'low'
  return 'minimal'
}

export function getDegradationCurve(category: string): DegradationCurve {
  return DEGRADATION_CURVES[category] ?? DEFAULT_CURVE
}

// --- Biomass Utilization ---

const BIOMASS_CATEGORIES = [
  // Legacy/generic names
  'Trim', 'Shake', 'PlantWaste', 'HarvestWaste',
  // Real Metrc category names (CO and other states)
  'Shake/Trim', 'Shake/Trim (by strain)', 'Shake/Trim allocated for extraction',
  'Bud allocated for extraction', 'Wet Whole Plants',
]

// Normalize to a display category for grouping and value lookups
function normalizeBiomassCategory(cat: string): string {
  const lower = cat.toLowerCase()
  if (lower.includes('shake') || lower.includes('trim')) return 'Shake/Trim'
  if (lower === 'bud allocated for extraction') return 'Extraction Buds'
  if (lower === 'wet whole plants') return 'Wet Whole Plants'
  if (lower === 'plantwaste') return 'PlantWaste'
  if (lower === 'harvestwaste') return 'HarvestWaste'
  return cat
}

const VALUE_CATEGORIES: Record<string, string> = {
  Trim: 'Suitable for extraction (concentrates, distillate)',
  Shake: 'Suitable for pre-rolls or edibles',
  'Shake/Trim': 'Suitable for extraction (distillate) or pre-rolls depending on grade',
  'Extraction Buds': 'Allocated for extraction — high-value concentrate/distillate feedstock',
  'Wet Whole Plants': 'Fresh plant material — suitable for live resin or fresh-frozen extraction',
  PlantWaste: 'Limited value - composting or disposal',
  HarvestWaste: 'Limited value - composting or disposal',
}

function estimateValue(
  category: string, quantity: number, ageDays: number,
): { tier: 'high' | 'medium' | 'low' | 'minimal'; valueRemaining: number; dailyLossRate: number } {
  const curve = getDegradationCurve(category)
  const valueRemaining = computeDegradedValue(ageDays, curve)
  const dailyLossRate = computeDailyLossRate(ageDays, curve)

  if (category === 'PlantWaste' || category === 'HarvestWaste') {
    return { tier: 'minimal', valueRemaining, dailyLossRate: 0 }
  }

  return { tier: tierFromValue(valueRemaining, quantity), valueRemaining, dailyLossRate }
}

/**
 * @param excludedItemPatterns — item name substrings to exclude from biomass
 *   (case-insensitive). Operators configure these via OperatorBenchmark
 *   `category: 'biomass'`, `key: 'excluded_item_patterns'`, `notes` field.
 *   Example: ['mids', 'pre-ground', 'homie packs'] excludes retail products
 *   that share a Metrc category with extraction-grade biomass.
 */
export function analyzeBiomassUtilization(
  packages: MetrcPackage[],
  excludedItemPatterns?: string[],
): BiomassUtilization {
  const biomassPackages: BiomassPackage[] = []
  const byCategory: BiomassUtilization['byCategory'] = {}
  const totalQuantityByUnit: Record<string, number> = {}

  // Pre-compute lowercased exclusion patterns for O(patterns × packages) matching.
  const exclusions = (excludedItemPatterns ?? [])
    .map(p => p.toLowerCase().trim())
    .filter(Boolean)

  for (const pkg of packages) {
    if (pkg.FinishedDate || pkg.ArchivedDate) continue
    if (pkg.Quantity <= 0) continue

    // Check if this is a biomass-related category
    const isBiomass = BIOMASS_CATEGORIES.includes(pkg.ItemCategory) ||
      pkg.PackageType === 'PlantWaste' ||
      pkg.PackageType === 'HarvestWaste'

    if (!isBiomass) continue

    // Exclude items matching operator-configured patterns (e.g., "mids" are retail, not extraction)
    if (exclusions.length > 0) {
      const nameLower = pkg.ItemName.toLowerCase()
      if (exclusions.some(p => nameLower.includes(p))) continue
    }

    const ageDays = calculateAgeDays(pkg.PackagedDate)
    const cat = normalizeBiomassCategory(pkg.ItemCategory)

    const { tier, valueRemaining, dailyLossRate } = estimateValue(cat, pkg.Quantity, ageDays)

    const biomassItem: BiomassPackage = {
      label: pkg.Label,
      itemName: pkg.ItemName,
      itemCategory: cat,
      quantity: pkg.Quantity,
      unitOfMeasure: pkg.UnitOfMeasureName,
      ageDays,
      location: pkg.LocationName,
      estimatedValue: tier,
      valueRemaining,
      dailyValueLossRate: dailyLossRate,
      strain: pkg.ItemStrainName || '',
      labTestingState: pkg.LabTestingState || '',
      isOnHold: pkg.IsOnHold ?? false,
      requiresRemediation: pkg.ProductRequiresRemediation ?? false,
    }

    biomassPackages.push(biomassItem)

    if (!byCategory[cat]) {
      byCategory[cat] = { count: 0, totalQuantity: 0, packages: [] }
    }
    byCategory[cat].count++
    byCategory[cat].totalQuantity += pkg.Quantity
    byCategory[cat].packages.push(biomassItem)

    totalQuantityByUnit[pkg.UnitOfMeasureName] =
      (totalQuantityByUnit[pkg.UnitOfMeasureName] ?? 0) + pkg.Quantity
  }

  // Generate recovery opportunities
  const recoveryOpportunities = Object.entries(byCategory)
    .filter(([, data]) => data.totalQuantity > 0)
    .map(([cat, data]) => ({
      category: cat,
      packageCount: data.count,
      totalQuantity: data.totalQuantity,
      unitOfMeasure: data.packages[0]?.unitOfMeasure ?? 'Grams',
      suggestedUse: VALUE_CATEGORIES[cat] ?? 'Evaluate for potential value recovery',
      estimatedValueTier: data.packages.some(p => p.estimatedValue === 'high') ? 'High'
        : data.packages.some(p => p.estimatedValue === 'medium') ? 'Medium'
        : 'Low',
    }))

  return {
    totalBiomassPackages: biomassPackages.length,
    totalQuantityByUnit,
    byCategory,
    recoveryOpportunities,
  }
}
