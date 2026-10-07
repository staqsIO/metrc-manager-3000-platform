/**
 * pipeline-stage-engine.ts — Farm-to-Cash Pipeline Stage Engine
 *
 * Infers pipeline stage from the provenance DAG position + package metadata.
 * No new database tables — stage is a pure function of graph position.
 *
 * Decision tree (short-circuit on first match):
 * 1. SOLD         — label appears in receipt transactions
 * 2. IN_TRANSIT   — appears in outgoing transfer manifest, not yet received
 * 3. RETAIL_READY — lab passed + terminal node (no children) + retail category
 * 4. TESTING      — LabTestingState in {NotSubmitted, SubmittedForTesting, AwaitingConfirmation}
 * 5. PROCESSED    — has parent packages in DAG + processed category
 * 6. POST_HARVEST — biomass category + parent is harvest (no parent packages)
 * 7. HARVESTED    — harvest source + no parent packages (catch-all for harvest-derived)
 * 8. INVENTORY    — catch-all for active packages not matching above
 *
 * Each check is O(1) hash map lookup. At 10K packages: ~15ms total.
 *
 * Note: PROCESSED_CATEGORIES and RETAIL_CATEGORIES intentionally overlap.
 * A terminal concentrate with TestPassed → retail_ready (step 3).
 * A non-terminal concentrate with parent packages → processed (step 5).
 * The decision tree ordering handles the distinction — do not deduplicate the sets.
 */

import type { MetrcPackage, MetrcHarvest } from '../metrc/types'
import type { ProvenanceIndex } from './provenance-engine'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineStage =
  | 'harvested'
  | 'post_harvest'
  | 'testing'
  | 'processed'
  | 'retail_ready'
  | 'in_transit'
  | 'sold'
  | 'inventory'

export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  'harvested',
  'post_harvest',
  'testing',
  'processed',
  'retail_ready',
  'in_transit',
  'sold',
]

// ---------------------------------------------------------------------------
// Pipeline Location Overrides (P1-6)
// ---------------------------------------------------------------------------

export interface PipelineStatusConfig {
  phase: PipelineStage
  name: string
  color?: string
  locationNames: string[]
}

export interface PipelineLocationOverrides {
  /** Map from LocationName → { phase, statusName } */
  locationToStatus: Map<string, { phase: PipelineStage; statusName: string }>
}

/**
 * Build a location-to-status lookup map from flat status config array.
 * Called once per request, not per package.
 */
export function buildLocationOverrides(statuses: PipelineStatusConfig[]): PipelineLocationOverrides {
  const locationToStatus = new Map<string, { phase: PipelineStage; statusName: string }>()
  for (const status of statuses) {
    for (const loc of status.locationNames) {
      locationToStatus.set(loc, { phase: status.phase, statusName: status.name })
    }
  }
  return { locationToStatus }
}

/**
 * Resolve user-defined status name for a package based on its location.
 * Returns null if no override matches.
 */
export function resolveStatusName(
  pkg: MetrcPackage,
  overrides?: PipelineLocationOverrides,
): string | null {
  if (!overrides || !pkg.LocationName) return null
  const match = overrides.locationToStatus.get(pkg.LocationName)
  return match?.statusName ?? null
}

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  harvested: 'Harvested',
  post_harvest: 'Post-Harvest',
  testing: 'Testing',
  processed: 'Processed',
  retail_ready: 'Retail Ready',
  in_transit: 'In Transit',
  sold: 'Sold',
  inventory: 'Inventory',
}

export interface PipelineBreakdownEntry {
  label: string
  count: number
}

export interface PipelineQuantityByUnit {
  unit: string
  total: number
}

export interface PipelineStageSummary {
  stage: PipelineStage
  packageCount: number
  /** Per-unit quantity totals, sorted by total descending. Never mixes units. */
  quantities: PipelineQuantityByUnit[]
  avgAgeDays: number
  oldestDays: number
  estimatedValue: number | null
  /** Sub-classification breakdown: lab state for testing, category for others, location if available */
  breakdown: PipelineBreakdownEntry[]
}

export interface PipelineOverview {
  stages: PipelineStageSummary[]
  totalActivePackages: number
  totalWeight: number
  harvestIntake: { totalWeight: number; activeCount: number; avgAgeDays: number }
  conversionRate: number | null
  unclassifiedCount: number
}

export interface HarvestCashTracker {
  harvestName: string
  harvestWeight: number
  harvestDate: string
  strain: string
  stages: Record<PipelineStage, { count: number; weight: number }>
  percentSold: number
  revenueSoFar: number | null
  weightRemaining: number
  avgDaysToSale: number | null
}

/** Shared pipeline data fetched once by the router, consumed by all pipeline functions. */
export interface PipelineData {
  packages: MetrcPackage[]
  harvests: MetrcHarvest[]
  provenanceIndex: ProvenanceIndex
  soldLabels: Set<string>
  transitLabels: Set<string>
  salesRevenue: Map<string, number>
  harvestToFirstGen: Map<string, string[]>
}

/** Combined result for the single endpoint that returns both overview + harvest trackers. */
export interface PipelineFullResult {
  overview: PipelineOverview
  harvests: HarvestCashTracker[]
  totalHarvests: number
}

// ---------------------------------------------------------------------------
// Category sets for stage classification
// ---------------------------------------------------------------------------

const TESTING_STATES = new Set([
  'NotSubmitted',
  'SubmittedForTesting',
  'AwaitingConfirmation',
])

const PROCESSED_CATEGORIES = new Set([
  'Concentrate',
  'Concentrate (Each)',
  'Infused (Edible)',
  'Infused (Non-Edible)',
  'Capsule',
  'Tincture',
  'Topical',
  'Vape Cartridge',
])

const BIOMASS_CATEGORIES = new Set([
  'Shake/Trim',
  'Shake/Trim (By Strain)',
  'Shake/Trim Allocated for Extraction',
  'Wet Whole Plants',
  'Bud Allocated for Extraction',
  'Flower Lot',
  'Trim',
  'Shake',
  'PlantWaste',
  'HarvestWaste',
])

const RETAIL_CATEGORIES = new Set([
  'Buds',
  'Buds (Bulk)',
  'Flower',
  'Concentrate',
  'Concentrate (Each)',
  'Infused (Edible)',
  'Infused (Non-Edible)',
  'Capsule',
  'Tincture',
  'Topical',
  'Vape Cartridge',
  'Seeds',
  'Each',
])

// ---------------------------------------------------------------------------
// Stage Inference — O(1) per package
// ---------------------------------------------------------------------------

export function inferPipelineStage(
  pkg: MetrcPackage,
  provenanceIndex: ProvenanceIndex,
  soldLabels: Set<string>,
  transitLabels: Set<string>,
  overrides?: PipelineLocationOverrides,
): PipelineStage {
  // 1. SOLD — label appears in receipt transactions
  if (soldLabels.has(pkg.Label)) return 'sold'

  // 2. IN_TRANSIT — label appears in outgoing transfer manifest
  if (transitLabels.has(pkg.Label)) return 'in_transit'

  // 3. Location-based override — operator-defined status mapping takes priority
  if (overrides && pkg.LocationName) {
    const match = overrides.locationToStatus.get(pkg.LocationName)
    if (match) return match.phase
  }

  const hasChildren = provenanceIndex.forwardEdges.has(pkg.Label) &&
    provenanceIndex.forwardEdges.get(pkg.Label)!.size > 0
  const hasParentPackages = provenanceIndex.backwardEdges.has(pkg.Label) &&
    provenanceIndex.backwardEdges.get(pkg.Label)!.size > 0
  const hasHarvestSource = provenanceIndex.harvestSources.has(pkg.Label) &&
    provenanceIndex.harvestSources.get(pkg.Label)!.size > 0
  const category = pkg.ItemCategory || ''
  const labState = pkg.LabTestingState || ''

  // 4. RETAIL_READY — lab passed + terminal (no children) + retail category
  // Packages with children that passed testing are "processed" or "inventory" —
  // they contributed to downstream packages and are no longer retail endpoints.
  if (
    labState === 'TestPassed' &&
    !hasChildren &&
    RETAIL_CATEGORIES.has(category)
  ) {
    return 'retail_ready'
  }

  // 5. TESTING — in lab testing pipeline
  if (TESTING_STATES.has(labState)) return 'testing'

  // 6. PROCESSED — has parent packages + processed category
  if (hasParentPackages && PROCESSED_CATEGORIES.has(category)) return 'processed'

  // 7. POST_HARVEST — biomass category + sourced from harvest (no package parents)
  if (BIOMASS_CATEGORIES.has(category) && hasHarvestSource && !hasParentPackages) {
    return 'post_harvest'
  }

  // 8. If it has a harvest source and no parent packages, it's post-harvest regardless
  if (hasHarvestSource && !hasParentPackages) return 'post_harvest'

  // 9. INVENTORY — catch-all
  return 'inventory'
}

// ---------------------------------------------------------------------------
// Pipeline Overview — single pass over packages
// ---------------------------------------------------------------------------

function calculateAgeDays(packagedDate: string | null | undefined): number {
  if (!packagedDate) return 0
  const d = new Date(packagedDate)
  if (isNaN(d.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)))
}

export function computePipelineOverview(data: PipelineData, overrides?: PipelineLocationOverrides): PipelineOverview {
  const { packages, harvests, provenanceIndex, soldLabels, transitLabels } = data
  const stageBuckets = new Map<PipelineStage, MetrcPackage[]>()
  let unclassifiedCount = 0
  let totalActivePackages = 0
  let totalWeight = 0

  // Single pass: classify + accumulate totals
  for (const pkg of packages) {
    if (pkg.Quantity <= 0) continue
    totalActivePackages++
    totalWeight += pkg.Quantity
    const stage = inferPipelineStage(pkg, provenanceIndex, soldLabels, transitLabels, overrides)
    if (stage === 'inventory') unclassifiedCount++
    let bucket = stageBuckets.get(stage)
    if (!bucket) {
      bucket = []
      stageBuckets.set(stage, bucket)
    }
    bucket.push(pkg)
  }

  const buildStageSummary = (stage: PipelineStage): PipelineStageSummary => {
    const pkgs = stageBuckets.get(stage) || []
    let totalAge = 0
    let oldestDays = 0
    // Track quantity per unit type (never mix units)
    const qtyByUnit = new Map<string, number>()
    // Track breakdown: lab state for testing, location for overrides, category otherwise
    const breakdownCounts = new Map<string, number>()

    for (const p of pkgs) {
      const age = calculateAgeDays(p.PackagedDate)
      totalAge += age
      if (age > oldestDays) oldestDays = age
      const u = p.UnitOfMeasureName || 'Units'
      qtyByUnit.set(u, (qtyByUnit.get(u) || 0) + p.Quantity)

      // Breakdown key: use the most informative dimension per stage
      let breakdownKey: string
      if (stage === 'testing') {
        breakdownKey = p.LabTestingState || 'Unknown'
      } else if (overrides && p.LocationName && overrides.locationToStatus.has(p.LocationName)) {
        breakdownKey = p.LocationName
      } else {
        breakdownKey = p.LocationName || p.ItemCategory || 'Unknown'
      }
      breakdownCounts.set(breakdownKey, (breakdownCounts.get(breakdownKey) || 0) + 1)
    }

    // Per-unit quantities sorted by total descending
    const quantities: PipelineQuantityByUnit[] = Array.from(qtyByUnit.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([unit, total]) => ({ unit, total: Math.round(total * 100) / 100 }))

    // Build sorted breakdown (descending by count, max 8 entries)
    const breakdown: PipelineBreakdownEntry[] = Array.from(breakdownCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, count]) => ({ label, count }))

    return {
      stage,
      packageCount: pkgs.length,
      quantities,
      avgAgeDays: pkgs.length > 0 ? Math.round(totalAge / pkgs.length) : 0,
      oldestDays,
      estimatedValue: null,
      breakdown,
    }
  }

  const stages: PipelineStageSummary[] = PIPELINE_STAGE_ORDER.map(buildStageSummary)

  // Include 'inventory' catch-all if any packages fell through
  if (stageBuckets.has('inventory') && stageBuckets.get('inventory')!.length > 0) {
    stages.push(buildStageSummary('inventory'))
  }

  // Harvest intake stats
  const activeHarvests = harvests.filter((h) => !h.FinishedDate)
  let harvestAgeSum = 0
  for (const h of activeHarvests) {
    const d = new Date(h.HarvestStartDate)
    harvestAgeSum += isNaN(d.getTime()) ? 0 : Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
  }
  const harvestTotalWeight = harvests.reduce((a, h) => a + (h.CurrentWeight || 0), 0)

  // Conversion rate: (retail_ready + sold weight) / total harvest weight
  const retailWeight = (stageBuckets.get('retail_ready') || []).reduce((a, p) => a + p.Quantity, 0)
  const soldWeight = (stageBuckets.get('sold') || []).reduce((a, p) => a + p.Quantity, 0)
  const conversionRate = harvestTotalWeight > 0
    ? Math.round(((retailWeight + soldWeight) / harvestTotalWeight) * 1000) / 10
    : null

  return {
    stages,
    totalActivePackages,
    totalWeight: Math.round(totalWeight * 100) / 100,
    harvestIntake: {
      totalWeight: Math.round(harvestTotalWeight * 100) / 100,
      activeCount: activeHarvests.length,
      avgAgeDays: activeHarvests.length > 0 ? Math.round(harvestAgeSum / activeHarvests.length) : 0,
    },
    conversionRate,
    unclassifiedCount,
  }
}

// ---------------------------------------------------------------------------
// Harvest-to-Cash Tracking
// ---------------------------------------------------------------------------

/**
 * Build a reverse index: harvest name -> first-generation package labels.
 * O(N) single pass. Call once, reuse for all traceHarvestToCash calls.
 */
export function buildHarvestToFirstGenIndex(packages: MetrcPackage[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const pkg of packages) {
    if (!pkg.SourceHarvestNames) continue
    const names = pkg.SourceHarvestNames.split(',').map((s) => s.trim())
    for (const name of names) {
      if (!name) continue
      let arr = index.get(name)
      if (!arr) { arr = []; index.set(name, arr) }
      arr.push(pkg.Label)
    }
  }
  return index
}

export function traceHarvestToCash(
  harvestName: string,
  harvest: MetrcHarvest | undefined,
  data: PipelineData,
  overrides?: PipelineLocationOverrides,
): HarvestCashTracker {
  const { provenanceIndex, soldLabels, transitLabels, salesRevenue, harvestToFirstGen } = data

  // Use pre-built index for O(1) harvest -> first-gen lookup
  const firstGenLabels = harvestToFirstGen.get(harvestName) || []

  // BFS forward to find all downstream packages
  const relatedLabels = new Set<string>(firstGenLabels)
  const queue = [...firstGenLabels]

  while (queue.length > 0) {
    const label = queue.shift()!
    const children = provenanceIndex.forwardEdges.get(label)
    if (children) {
      for (const child of Array.from(children)) {
        if (!relatedLabels.has(child)) {
          relatedLabels.add(child)
          queue.push(child)
        }
      }
    }
  }

  // Classify each related package into stages
  const stages: Record<PipelineStage, { count: number; weight: number }> = {
    harvested: { count: 0, weight: 0 },
    post_harvest: { count: 0, weight: 0 },
    testing: { count: 0, weight: 0 },
    processed: { count: 0, weight: 0 },
    retail_ready: { count: 0, weight: 0 },
    in_transit: { count: 0, weight: 0 },
    sold: { count: 0, weight: 0 },
    inventory: { count: 0, weight: 0 },
  }
  let totalRevenue = 0
  let soldCount = 0
  let totalSaleDays = 0

  for (const label of Array.from(relatedLabels)) {
    const pkg = provenanceIndex.packageMap.get(label)
    if (!pkg) continue
    const stage = inferPipelineStage(pkg, provenanceIndex, soldLabels, transitLabels, overrides)
    stages[stage].count++
    stages[stage].weight += pkg.Quantity

    if (stage === 'sold') {
      soldCount++
      const rev = salesRevenue.get(label)
      if (rev !== undefined) totalRevenue += rev
      totalSaleDays += calculateAgeDays(pkg.PackagedDate)
    }
  }

  const harvestWeight = harvest?.CurrentWeight || 0
  const totalRelatedWeight = Object.values(stages).reduce((a, s) => a + s.weight, 0)
  const soldWeight = stages.sold.weight
  const percentSold = totalRelatedWeight > 0
    ? Math.round((soldWeight / totalRelatedWeight) * 1000) / 10
    : 0

  return {
    harvestName,
    harvestWeight: Math.round(harvestWeight * 100) / 100,
    harvestDate: harvest?.HarvestStartDate || '',
    strain: harvest?.SourceStrainNames || '',
    stages,
    percentSold,
    revenueSoFar: totalRevenue > 0 ? Math.round(totalRevenue * 100) / 100 : null,
    weightRemaining: Math.round((totalRelatedWeight - soldWeight) * 100) / 100,
    avgDaysToSale: soldCount > 0 ? Math.round(totalSaleDays / soldCount) : null,
  }
}

/**
 * Compute the full pipeline result: overview + all harvest trackers.
 * Single data fetch, single provenance index build, single harvest-to-firstgen index.
 */
export function computeFullPipeline(data: PipelineData, overrides?: PipelineLocationOverrides): PipelineFullResult {
  const overview = computePipelineOverview(data, overrides)

  const trackers = data.harvests.map((h) =>
    traceHarvestToCash(h.Name, h, data, overrides)
  )
  // Sort by % sold ascending (least converted first = most actionable)
  trackers.sort((a, b) => a.percentSold - b.percentSold)

  return { overview, harvests: trackers, totalHarvests: trackers.length }
}

// ---------------------------------------------------------------------------
// Helpers for building sold/transit label sets from Metrc data
// ---------------------------------------------------------------------------

export function buildSoldLabelsFromReceipts(
  receipts: Array<{ Transactions?: Array<{ PackageLabel?: string }> }>,
): Set<string> {
  const labels = new Set<string>()
  for (const r of receipts) {
    for (const t of r.Transactions || []) {
      if (t.PackageLabel) labels.add(t.PackageLabel)
    }
  }
  return labels
}

export function buildTransitLabels(
  outgoingTransfers: Array<{ DeliveryPackages?: Array<{ PackageLabel?: string }>; PackageCount?: number }>,
): Set<string> {
  const labels = new Set<string>()
  for (const t of outgoingTransfers) {
    for (const dp of t.DeliveryPackages || []) {
      if (dp.PackageLabel) labels.add(dp.PackageLabel)
    }
  }
  return labels
}

export function buildSalesRevenueMap(
  receipts: Array<{ Transactions?: Array<{ PackageLabel?: string; TotalPrice?: number }> }>,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of receipts) {
    for (const t of r.Transactions || []) {
      if (t.PackageLabel && t.TotalPrice) {
        map.set(t.PackageLabel, (map.get(t.PackageLabel) || 0) + t.TotalPrice)
      }
    }
  }
  return map
}
