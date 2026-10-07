/**
 * biomass-recommendation-engine.ts — Material Allocation Recommendations
 *
 * Composes biomass inventory classification, strain yield history, BOM inference,
 * and optionally sales velocity to produce actionable processing recommendations.
 *
 * All pure functions — no API calls, no side effects.
 * Designed to be called by the Copilot tool `recommend_biomass_usage`.
 */

import type { BiomassPackage, BiomassUtilization } from './package-intelligence'
import type { BOMSuggestion } from './bom-inference'
import type { StrainYieldTrend } from '@/services/analytics/strain-intelligence'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProcessingPath =
  | 'Live Resin / Fresh-Frozen Extraction'
  | 'Hydrocarbon Extraction (BHO/PHO)'
  | 'Solventless Extraction (Rosin/Wash)'
  | 'Distillate / Ethanol Extraction'
  | 'Pre-Rolls'
  | 'Edibles / Infusion'
  | 'Wholesale Bulk'
  | 'Consolidation'
  | 'Composting / Disposal'
  | 'Hold for Lab Testing'
  | 'Remediation Required'

export type UrgencyLevel = 'critical' | 'high' | 'medium' | 'low'

export interface MaterialRecommendation {
  packageLabel: string
  itemName: string
  strain: string
  category: string
  quantity: number
  unit: string
  ageDays: number
  recommendedProcess: ProcessingPath
  reasoning: string
  urgency: UrgencyLevel
  complianceNotes: string[]
  estimatedValue: BiomassPackage['estimatedValue']
  valueRemaining: number              // 0.0–1.0 from degradation curve
  dailyValueLossRate: number          // fraction per day at current age
  yieldEstimate: number | null        // percentage if historical data available
  yieldConfidence: 'high' | 'medium' | 'low' | 'none'
}

export interface BiomassRecommendationResult {
  recommendations: MaterialRecommendation[]
  summary: {
    totalPackages: number
    totalWeight: Record<string, number>
    byProcess: Record<string, { count: number; totalQuantity: number }>
    urgentCount: number
    complianceIssueCount: number
  }
  strainInsights: {
    strainName: string
    avgYieldEfficiency: number
    trend: string
    bestProcess: string | null
  }[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Typical yield percentages by process type */
const TYPICAL_YIELDS: Record<string, number> = {
  'Live Resin / Fresh-Frozen Extraction': 0.08,
  'Hydrocarbon Extraction (BHO/PHO)': 0.18,
  'Solventless Extraction (Rosin/Wash)': 0.06,
  'Distillate / Ethanol Extraction': 0.22,
  'Pre-Rolls': 0.85,
  'Edibles / Infusion': 0.70,
  'Wholesale Bulk': 1.0,
}

/** Post-processing yield modifiers — multiplicative factors for secondary processing steps */
const POST_PROCESSING_MODIFIERS: Record<string, { yieldFactor: number; label: string }> = {
  crc: { yieldFactor: 0.88, label: 'CRC (Color Remediation)' },
  winterization: { yieldFactor: 0.92, label: 'Winterization' },
  distillation: { yieldFactor: 0.85, label: 'Short-path distillation' },
}

function detectPostProcessing(outputItemName: string): string[] {
  const lower = outputItemName.toLowerCase()
  const steps: string[] = []
  if (lower.includes('crc')) steps.push('crc')
  if (lower.includes('winteriz')) steps.push('winterization')
  // Only flag standalone "distill" references, not "distillate" (already a process path)
  if (lower.includes('distill') && !lower.includes('distillate')) steps.push('distillation')
  return steps
}

function applyPostProcessingModifiers(baseYield: number, steps: string[]): number {
  let adjusted = baseYield
  for (const step of steps) {
    const mod = POST_PROCESSING_MODIFIERS[step]
    if (mod) adjusted *= mod.yieldFactor
  }
  return Math.round(adjusted * 10) / 10
}

/** Below this valueRemaining threshold, yield estimates are scaled down */
const YIELD_DEGRADATION_THRESHOLD = 0.7

/** Scale yield estimate by degradation factor for aged material */
function adjustYieldForDegradation(baseYield: number, valueRemaining: number): number {
  return valueRemaining < YIELD_DEGRADATION_THRESHOLD
    ? Math.round(baseYield * valueRemaining * 10) / 10
    : baseYield
}

// ---------------------------------------------------------------------------
// Core Engine
// ---------------------------------------------------------------------------

function getUrgency(pkg: BiomassPackage): UrgencyLevel {
  // Compliance overrides — always highest priority
  if (pkg.requiresRemediation) return 'critical'
  if (pkg.labTestingState === 'TestFailed') return 'critical'
  if (pkg.isOnHold) return 'high'

  // Degradation-rate-based urgency (derived from the exponential curve)
  // Fresh frozen at 3d: dailyLossRate ≈ 0.09 → critical
  // Shake/Trim at 60d: dailyLossRate ≈ 0.006 → medium
  // Extraction Buds at 120d: dailyLossRate ≈ 0.003 → low (at floor)
  if (pkg.dailyValueLossRate > 0.05) return 'critical'  // losing >5%/day
  if (pkg.dailyValueLossRate > 0.02) return 'high'       // losing >2%/day
  if (pkg.dailyValueLossRate > 0.005) return 'medium'     // losing >0.5%/day
  return 'low'
}

function getComplianceNotes(pkg: BiomassPackage): string[] {
  const notes: string[] = []
  if (pkg.requiresRemediation) notes.push('Product requires remediation before processing')
  if (pkg.isOnHold) notes.push('Package is on administrative hold — resolve before processing')
  if (pkg.labTestingState === 'TestFailed') notes.push('Lab test failed — requires remediation or disposal')
  if (pkg.labTestingState === 'NotSubmitted') notes.push('Not yet submitted for lab testing')
  if (pkg.labTestingState === 'AwaitingConfirmation') notes.push('Lab results pending — do not process until confirmed')
  if (pkg.labTestingState === 'TestPassed') notes.push('Lab tested and passed — no retest needed for in-house processing')
  return notes
}

function inferProcessFromBOM(
  strain: string,
  category: string,
  bomSuggestions: BOMSuggestion[],
): { process: string; yieldEstimate: number; confidence: number } | null {
  if (bomSuggestions.length === 0) return null

  // Find BOM entries where this category/strain was used as input
  const relevant = bomSuggestions.filter(b => {
    const inputLower = b.componentItemName.toLowerCase()
    const catLower = category.toLowerCase()
    return inputLower.includes(catLower) ||
      (strain && inputLower.toLowerCase().includes(strain.toLowerCase()))
  })

  if (relevant.length === 0) return null

  // Pick the highest-confidence match
  const best = relevant[0]
  const yieldPct = best.averageRatio > 0 ? 1 / best.averageRatio : 0
  return {
    process: best.outputItemName,
    yieldEstimate: Math.round(yieldPct * 10000) / 100, // percentage
    confidence: best.confidence,
  }
}

function recommendProcess(
  pkg: BiomassPackage,
  strainYield: StrainYieldTrend | undefined,
  bomMatch: ReturnType<typeof inferProcessFromBOM>,
): { process: ProcessingPath; reasoning: string; yieldEstimate: number | null; yieldConfidence: MaterialRecommendation['yieldConfidence'] } {
  // Compliance overrides
  if (pkg.requiresRemediation) {
    return { process: 'Remediation Required', reasoning: 'Product requires remediation before any processing.', yieldEstimate: null, yieldConfidence: 'none' }
  }
  if (pkg.labTestingState === 'TestFailed') {
    return { process: 'Remediation Required', reasoning: 'Lab test failed. Must remediate or dispose.', yieldEstimate: null, yieldConfidence: 'none' }
  }
  if (pkg.isOnHold) {
    return { process: 'Hold for Lab Testing', reasoning: 'Package is on hold. Resolve hold status before processing.', yieldEstimate: null, yieldConfidence: 'none' }
  }
  if (pkg.labTestingState === 'NotSubmitted' || pkg.labTestingState === 'AwaitingConfirmation') {
    return { process: 'Hold for Lab Testing', reasoning: 'Awaiting lab test results. Do not process until testing is complete.', yieldEstimate: null, yieldConfidence: 'none' }
  }

  // Waste categories
  if (pkg.itemCategory === 'PlantWaste' || pkg.itemCategory === 'HarvestWaste') {
    return { process: 'Composting / Disposal', reasoning: 'Waste material — limited recovery value.', yieldEstimate: null, yieldConfidence: 'none' }
  }

  // Fresh frozen — time-sensitive
  if (pkg.itemCategory === 'Wet Whole Plants') {
    const valuePct = Math.round(pkg.valueRemaining * 100)
    const baseYield = TYPICAL_YIELDS['Live Resin / Fresh-Frozen Extraction'] * 100
    const adjustedYield = adjustYieldForDegradation(baseYield, pkg.valueRemaining)
    const reasoning = pkg.ageDays <= 3
      ? `Fresh frozen material (${pkg.ageDays}d old). Optimal for live resin extraction — process immediately for maximum terpene preservation. Value remaining: ${valuePct}%.`
      : `Fresh frozen material aging (${pkg.ageDays}d). ${valuePct}% value remaining, losing ~${(pkg.dailyValueLossRate * 100).toFixed(1)}%/day. Urgently process for live resin before further degradation.`
    return { process: 'Live Resin / Fresh-Frozen Extraction', reasoning, yieldEstimate: adjustedYield, yieldConfidence: 'low' }
  }

  // BOM-informed recommendation (if historical data exists)
  if (bomMatch && bomMatch.confidence >= 0.5) {
    const outputLower = bomMatch.process.toLowerCase()
    let process: ProcessingPath = 'Hydrocarbon Extraction (BHO/PHO)'
    if (outputLower.includes('rosin') || outputLower.includes('hash') || outputLower.includes('bubble')) {
      process = 'Solventless Extraction (Rosin/Wash)'
    } else if (outputLower.includes('distillate') || outputLower.includes('rso') || outputLower.includes('ethanol')) {
      process = 'Distillate / Ethanol Extraction'
    } else if (outputLower.includes('pre-roll') || outputLower.includes('preroll') || outputLower.includes('joint')) {
      process = 'Pre-Rolls'
    } else if (outputLower.includes('edible') || outputLower.includes('infus') || outputLower.includes('gummy')) {
      process = 'Edibles / Infusion'
    } else if (outputLower.includes('live') || outputLower.includes('fresh')) {
      process = 'Live Resin / Fresh-Frozen Extraction'
    }

    const conf = bomMatch.confidence >= 0.8 ? 'high' : bomMatch.confidence >= 0.5 ? 'medium' : 'low'

    // Detect and apply post-processing modifiers (CRC, winterization, etc.)
    const postSteps = detectPostProcessing(bomMatch.process)
    const adjustedYield = postSteps.length > 0
      ? applyPostProcessingModifiers(bomMatch.yieldEstimate, postSteps)
      : bomMatch.yieldEstimate
    const postNote = postSteps.length > 0
      ? ` Post-processing (${postSteps.map(s => POST_PROCESSING_MODIFIERS[s]?.label ?? s).join(', ')}) reduces yield by ~${Math.round((1 - postSteps.reduce((f, s) => f * (POST_PROCESSING_MODIFIERS[s]?.yieldFactor ?? 1), 1)) * 100)}%.`
      : ''

    return {
      process,
      reasoning: `Based on ${Math.round(bomMatch.confidence * 100)}% confidence from processing history → ${bomMatch.process} (adjusted yield ${adjustedYield.toFixed(1)}%).${postNote}`,
      yieldEstimate: adjustedYield,
      yieldConfidence: conf,
    }
  }

  // Extraction buds — high-value feedstock
  if (pkg.itemCategory === 'Extraction Buds') {
    const trendNote = strainYield
      ? ` ${pkg.strain} yield trend is ${strainYield.overallTrend} (avg ${strainYield.avgYieldEfficiency.toFixed(1)}%).`
      : ''
    const baseYield = TYPICAL_YIELDS['Hydrocarbon Extraction (BHO/PHO)'] * 100
    const adjustedYield = adjustYieldForDegradation(baseYield, pkg.valueRemaining)
    const valuePct = Math.round(pkg.valueRemaining * 100)
    const valueNote = pkg.valueRemaining < YIELD_DEGRADATION_THRESHOLD
      ? ` Value remaining: ${valuePct}%, losing ~${(pkg.dailyValueLossRate * 100).toFixed(1)}%/day.`
      : ''
    return {
      process: 'Hydrocarbon Extraction (BHO/PHO)',
      reasoning: `Buds allocated for extraction — premium feedstock for concentrates.${trendNote}${valueNote}`,
      yieldEstimate: adjustedYield,
      yieldConfidence: strainYield ? 'medium' : 'low',
    }
  }

  // Shake/Trim — depends on quantity and age
  if (pkg.itemCategory === 'Shake/Trim') {
    const valuePct = Math.round(pkg.valueRemaining * 100)
    const valueNote = pkg.valueRemaining < YIELD_DEGRADATION_THRESHOLD
      ? ` Value remaining: ${valuePct}%, losing ~${(pkg.dailyValueLossRate * 100).toFixed(1)}%/day.`
      : ''
    if (pkg.quantity >= 200) {
      const baseYield = TYPICAL_YIELDS['Distillate / Ethanol Extraction'] * 100
      return {
        process: 'Distillate / Ethanol Extraction',
        reasoning: `Large batch (${pkg.quantity.toLocaleString()} ${pkg.unitOfMeasure}) of shake/trim. Economical for bulk distillate extraction.${valueNote}`,
        yieldEstimate: adjustYieldForDegradation(baseYield, pkg.valueRemaining),
        yieldConfidence: 'low',
      }
    }
    if (pkg.quantity >= 50) {
      const baseYield = TYPICAL_YIELDS['Pre-Rolls'] * 100
      return {
        process: 'Pre-Rolls',
        reasoning: `Mid-size shake/trim batch. Good candidate for pre-roll production — no retest needed if already tested.${valueNote}`,
        yieldEstimate: adjustYieldForDegradation(baseYield, pkg.valueRemaining),
        yieldConfidence: 'low',
      }
    }
    // Small quantity — consolidate first
    return {
      process: 'Consolidation',
      reasoning: `Small shake/trim batch (${pkg.quantity.toLocaleString()} ${pkg.unitOfMeasure}). Consolidate with similar packages before processing.${valueNote}`,
      yieldEstimate: null,
      yieldConfidence: 'none',
    }
  }

  // Fallback for unclassified biomass
  if (pkg.quantity >= 100) {
    return {
      process: 'Wholesale Bulk',
      reasoning: `Unclassified biomass category (${pkg.itemCategory}). Recommend wholesale or further evaluation.`,
      yieldEstimate: null,
      yieldConfidence: 'none',
    }
  }

  return {
    process: 'Consolidation',
    reasoning: `Small quantity of ${pkg.itemCategory}. Consider consolidating with similar packages.`,
    yieldEstimate: null,
    yieldConfidence: 'none',
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeBiomassRecommendations(
  biomass: BiomassUtilization,
  strainYields: StrainYieldTrend[],
  bomSuggestions: BOMSuggestion[],
): BiomassRecommendationResult {
  const warnings: string[] = []
  const recommendations: MaterialRecommendation[] = []

  // Build strain yield lookup
  const strainYieldMap = new Map<string, StrainYieldTrend>()
  for (const sy of strainYields) {
    strainYieldMap.set(sy.strainName.toLowerCase().trim(), sy)
  }

  // Process each biomass package
  const allPackages = Object.values(biomass.byCategory).flatMap(c => c.packages)

  if (allPackages.length === 0) {
    warnings.push('No biomass packages found in inventory.')
    return {
      recommendations: [],
      summary: { totalPackages: 0, totalWeight: {}, byProcess: {}, urgentCount: 0, complianceIssueCount: 0 },
      strainInsights: [],
      warnings,
    }
  }

  // Count packages missing strain data
  const noStrain = allPackages.filter(p => !p.strain).length
  if (noStrain > 0) {
    warnings.push(`${noStrain} package${noStrain > 1 ? 's' : ''} have no strain data — recommendations will use category-level heuristics.`)
  }

  for (const pkg of allPackages) {
    const strainKey = pkg.strain.toLowerCase().trim()
    const strainYield = strainYieldMap.get(strainKey)
    const bomMatch = inferProcessFromBOM(pkg.strain, pkg.itemCategory, bomSuggestions)
    const { process, reasoning, yieldEstimate, yieldConfidence } = recommendProcess(pkg, strainYield, bomMatch)

    recommendations.push({
      packageLabel: pkg.label,
      itemName: pkg.itemName,
      strain: pkg.strain,
      category: pkg.itemCategory,
      quantity: pkg.quantity,
      unit: pkg.unitOfMeasure,
      ageDays: pkg.ageDays,
      recommendedProcess: process,
      reasoning,
      urgency: getUrgency(pkg),
      complianceNotes: getComplianceNotes(pkg),
      estimatedValue: pkg.estimatedValue,
      valueRemaining: pkg.valueRemaining,
      dailyValueLossRate: pkg.dailyValueLossRate,
      yieldEstimate,
      yieldConfidence,
    })
  }

  // Sort: critical urgency first, then high, then by quantity descending
  const urgencyOrder: Record<UrgencyLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  recommendations.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency] || b.quantity - a.quantity)

  // Build summary
  const byProcess: Record<string, { count: number; totalQuantity: number }> = {}
  for (const rec of recommendations) {
    const existing = byProcess[rec.recommendedProcess]
    if (existing) {
      existing.count++
      existing.totalQuantity += rec.quantity
    } else {
      byProcess[rec.recommendedProcess] = { count: 1, totalQuantity: rec.quantity }
    }
  }

  const urgentCount = recommendations.filter(r => r.urgency === 'critical' || r.urgency === 'high').length
  const complianceIssueCount = recommendations.filter(r => r.complianceNotes.length > 0 && r.complianceNotes.some(n => !n.includes('passed'))).length

  // Build strain insights
  const strainInsights: BiomassRecommendationResult['strainInsights'] = []
  const seenStrains = new Set<string>()
  for (const rec of recommendations) {
    const key = rec.strain.toLowerCase().trim()
    if (!key || seenStrains.has(key)) continue
    seenStrains.add(key)

    const sy = strainYieldMap.get(key)
    const strainRecs = recommendations.filter(r => r.strain.toLowerCase().trim() === key)
    const processCounts = new Map<string, number>()
    for (const sr of strainRecs) {
      processCounts.set(sr.recommendedProcess, (processCounts.get(sr.recommendedProcess) ?? 0) + 1)
    }
    let bestProcess: string | null = null
    let bestCount = 0
    for (const [p, c] of Array.from(processCounts.entries())) {
      if (c > bestCount) { bestProcess = p; bestCount = c }
    }

    strainInsights.push({
      strainName: rec.strain,
      avgYieldEfficiency: sy?.avgYieldEfficiency ?? 0,
      trend: sy?.overallTrend ?? 'insufficient_data',
      bestProcess,
    })
  }

  return {
    recommendations,
    summary: {
      totalPackages: recommendations.length,
      totalWeight: biomass.totalQuantityByUnit,
      byProcess,
      urgentCount,
      complianceIssueCount,
    },
    strainInsights,
    warnings,
  }
}
