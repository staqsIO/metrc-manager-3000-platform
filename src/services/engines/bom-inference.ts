/**
 * bom-inference.ts — BOM Inference Engine
 *
 * Mines ActionLog entries where actionType = 'PROCESSING_CREATE' and
 * status = 'COMPLETED' to auto-infer Bills of Material from processing history.
 *
 * Algorithm:
 * 1. Parse each log's previewData.sources[] and previewData.output
 * 2. Compute ratio = source.requestedQty / output.quantity per pair
 * 3. Group by output.itemName → source.itemName, average ratios across runs
 * 4. Confidence = min(1.0, runCount/5) * max(0, 1 - coeffOfVariation)
 * 5. Deduplicate against existing confirmed BOMs
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface BOMSuggestion {
  outputItemName: string
  componentItemName: string
  averageRatio: number
  unit: string
  runCount: number
  confidence: number
  ratios: number[]
}

export interface BOMInferenceResult {
  suggestions: BOMSuggestion[]
  totalLogsAnalyzed: number
}

interface ActionLogEntry {
  previewData: unknown
  status: string
  actionType: string
}

interface ExistingBOMRef {
  metrcItemName: string
  componentMetrcItemName: string | null
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

function isProcessingPreview(data: unknown): data is ProcessingPreviewData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    Array.isArray(d.sources) &&
    d.output != null &&
    typeof d.output === 'object'
  )
}

export function inferBOMsFromHistory(
  logs: ActionLogEntry[],
  existingBOMs: ExistingBOMRef[],
): BOMInferenceResult {
  // Accumulate ratio data per output→source pair
  const pairMap = new Map<string, {
    outputItemName: string
    componentItemName: string
    unit: string
    ratios: number[]
  }>()

  let analyzed = 0

  for (const log of logs) {
    if (log.actionType !== 'PROCESSING_CREATE' || log.status !== 'COMPLETED') continue
    if (!isProcessingPreview(log.previewData)) continue

    const { sources, output } = log.previewData
    if (!output?.itemName || !output?.quantity || output.quantity <= 0) continue

    analyzed++

    for (const src of sources) {
      if (!src.itemName || !src.requestedQty || src.requestedQty <= 0) continue

      const ratio = src.requestedQty / output.quantity

      // Reject absurd ratios (likely data entry errors)
      if (ratio < 0.001 || ratio > 10000) continue

      const key = `${output.itemName}|||${src.itemName}`

      const existing = pairMap.get(key)
      if (existing) {
        existing.ratios.push(ratio)
      } else {
        pairMap.set(key, {
          outputItemName: output.itemName,
          componentItemName: src.itemName,
          unit: src.unit || 'Each',
          ratios: [ratio],
        })
      }
    }
  }

  // Build existing BOM lookup for deduplication
  const existingSet = new Set(
    existingBOMs
      .filter((b) => b.componentMetrcItemName)
      .map((b) => `${b.metrcItemName}|||${b.componentMetrcItemName}`),
  )

  const suggestions: BOMSuggestion[] = []

  for (const [key, data] of Array.from(pairMap.entries())) {
    // Skip if already a confirmed BOM
    if (existingSet.has(key)) continue

    const { ratios } = data
    const runCount = ratios.length
    const avgRatio = ratios.reduce((a: number, b: number) => a + b, 0) / runCount

    // Coefficient of variation
    const variance =
      runCount > 1
        ? ratios.reduce((sum: number, r: number) => sum + (r - avgRatio) ** 2, 0) / (runCount - 1)
        : 0
    const stdDev = Math.sqrt(variance)
    const cv = avgRatio > 0 ? stdDev / avgRatio : 0

    // Confidence: penalize low sample size and high variance
    const confidence = Math.min(1.0, runCount / 5) * Math.max(0, 1 - cv)

    suggestions.push({
      outputItemName: data.outputItemName,
      componentItemName: data.componentItemName,
      averageRatio: Math.round(avgRatio * 10000) / 10000,
      unit: data.unit,
      runCount,
      confidence: Math.round(confidence * 100) / 100,
      ratios: ratios.map((r: number) => Math.round(r * 10000) / 10000),
    })
  }

  // Sort by confidence descending, then by run count
  suggestions.sort((a, b) => b.confidence - a.confidence || b.runCount - a.runCount)

  return { suggestions, totalLogsAnalyzed: analyzed }
}
