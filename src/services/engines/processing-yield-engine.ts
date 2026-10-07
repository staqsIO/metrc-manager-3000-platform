/**
 * processing-yield-engine.ts — Aggregate processing yield metrics from ActionLogs.
 *
 * Companion to bom-inference.ts. Where bom-inference produces per-pair ratios
 * for BOM suggestion, this engine produces per-facility totals: input weight,
 * output weight, yield %, run count.
 *
 * Used by the Yield & Cycle page to surface Manufacturer + Microbusiness
 * processing yield (the cultivation analogue is the existing harvest-yield
 * table). Cultivators that also process (e.g. in-house extraction) show up
 * here too when they have processing actions.
 */

interface ProcessingSource {
  itemName: string
  requestedQty: number
  unit: string
}

interface ProcessingOutput {
  itemName: string
  quantity: number
  unitOfMeasure: string
}

interface ProcessingPreviewData {
  sources: ProcessingSource[]
  output: ProcessingOutput
}

interface ActionLogEntry {
  previewData: unknown
  status: string
  actionType: string
}

export interface FacilityProcessingMetrics {
  /** Number of completed processing runs in the lookback window */
  runCount: number
  /** Total input weight in grams (sum across all weight-unit sources) */
  totalInputGrams: number
  /** Total output weight in grams (sum across all weight-unit outputs) */
  totalOutputGrams: number
  /**
   * Yield % = output_weight / input_weight, only when both totals > 0.
   * Strictly weight-only — never blends count outputs (cartridges, etc.)
   * with weight outputs. Count outputs land in `totalOutputByUnit`.
   */
  yieldPercent: number | null
  /**
   * Non-weight output totals, grouped by their original unit. Examples:
   *   { "Each": 1500, "Tablets": 200 }
   * Always reported separately from `totalOutputGrams` because
   * weight and non-weight units must not be blended.
   */
  totalOutputByUnit: Record<string, number>
  /** Distinct output products (top 5 by run frequency) with unit + total output */
  topProducts: { itemName: string; runs: number; unit: string; totalOutput: number }[]
  /**
   * Runs where weight yield can't be computed (e.g. output is "Each",
   * not grams/lbs). Still counted in runCount and totalOutputByUnit
   * but excluded from yieldPercent math.
   */
  unmeasurableRuns: number
}

// ---------------------------------------------------------------------------
// Unit conversion — only weight units. Anything else is treated as
// unmeasurable for yield purposes (count outputs, e.g. cartridges, can't
// be summed against weight inputs to compute a meaningful yield %).
// ---------------------------------------------------------------------------

const GRAMS_PER_UNIT: Record<string, number> = {
  // Grams
  grams: 1,
  gram: 1,
  g: 1,
  // Kilograms
  kilograms: 1000,
  kilogram: 1000,
  kg: 1000,
  // Pounds
  pounds: 453.592,
  pound: 453.592,
  lbs: 453.592,
  lb: 453.592,
  // Ounces
  ounces: 28.3495,
  ounce: 28.3495,
  oz: 28.3495,
  // Milligrams
  milligrams: 0.001,
  milligram: 0.001,
  mg: 0.001,
}

function toGrams(qty: number, unit: string | undefined): number | null {
  if (!unit) return null
  const factor = GRAMS_PER_UNIT[unit.trim().toLowerCase()]
  if (factor == null) return null
  return qty * factor
}

function isProcessingPreview(data: unknown): data is ProcessingPreviewData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return Array.isArray(d.sources) && d.output != null && typeof d.output === 'object'
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export function aggregateProcessingYield(logs: ActionLogEntry[]): FacilityProcessingMetrics {
  let runCount = 0
  let totalInputGrams = 0
  let totalOutputGrams = 0
  let unmeasurableRuns = 0
  const totalOutputByUnit: Record<string, number> = {}
  // itemName → { runs, unit, totalOutput }
  const productAggregate = new Map<string, { runs: number; unit: string; totalOutput: number }>()

  for (const log of logs) {
    if (log.actionType !== 'PROCESSING_CREATE' || log.status !== 'COMPLETED') continue
    if (!isProcessingPreview(log.previewData)) continue

    const { sources, output } = log.previewData
    if (!output?.itemName || !output?.quantity || output.quantity <= 0) continue

    runCount++

    // Track per-product breakdown — preserves the output's original unit so
    // weight products (Distillate, lbs) don't visually blend with count
    // products (Cartridges, Each).
    const outUnit = output.unitOfMeasure ?? 'Each'
    const existing = productAggregate.get(output.itemName)
    if (existing) {
      existing.runs += 1
      existing.totalOutput += output.quantity
    } else {
      productAggregate.set(output.itemName, {
        runs: 1,
        unit: outUnit,
        totalOutput: output.quantity,
      })
    }

    // Normalize output to grams. Non-weight outputs (count units like
    // "Each") are tallied in totalOutputByUnit and counted as
    // unmeasurable for yield math — never blended into totalOutputGrams.
    const outputGrams = toGrams(output.quantity, output.unitOfMeasure)
    if (outputGrams === null) {
      const key = outUnit
      totalOutputByUnit[key] = (totalOutputByUnit[key] ?? 0) + output.quantity
      unmeasurableRuns++
      continue
    }

    // Weight output — sum source weights for yield math.
    let runInputGrams = 0
    let runHasMeasurableInput = false
    for (const src of sources) {
      if (!src.itemName || !src.requestedQty || src.requestedQty <= 0) continue
      const grams = toGrams(src.requestedQty, src.unit)
      if (grams === null) continue
      runInputGrams += grams
      runHasMeasurableInput = true
    }

    if (!runHasMeasurableInput) {
      unmeasurableRuns++
      continue
    }

    totalInputGrams += runInputGrams
    totalOutputGrams += outputGrams
  }

  const yieldPercent =
    totalInputGrams > 0 && totalOutputGrams > 0
      ? (totalOutputGrams / totalInputGrams) * 100
      : null

  const topProducts = Array.from(productAggregate.entries())
    .map(([itemName, data]) => ({
      itemName,
      runs: data.runs,
      unit: data.unit,
      totalOutput: Math.round(data.totalOutput * 100) / 100,
    }))
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 5)

  // Round non-weight unit totals
  const roundedByUnit: Record<string, number> = {}
  for (const [unit, qty] of Object.entries(totalOutputByUnit)) {
    roundedByUnit[unit] = Math.round(qty * 100) / 100
  }

  return {
    runCount,
    totalInputGrams: Math.round(totalInputGrams * 100) / 100,
    totalOutputGrams: Math.round(totalOutputGrams * 100) / 100,
    yieldPercent: yieldPercent === null ? null : Math.round(yieldPercent * 10) / 10,
    totalOutputByUnit: roundedByUnit,
    topProducts,
    unmeasurableRuns,
  }
}

/** Convert grams → pounds for display. */
export function gramsToPounds(g: number): number {
  return g / 453.592
}
