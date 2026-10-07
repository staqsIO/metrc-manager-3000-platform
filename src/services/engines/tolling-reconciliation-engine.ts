/**
 * Tolling Reconciliation Engine
 *
 * Pure function engine that composes existing tolling data into a reconciliation
 * statement: "Material in -> product out -> who owes whom."
 *
 * No imports from React, Prisma, or tRPC — this is a pure computation module.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchStatement {
  batchId: string
  status: string
  lifecycleStage: string
  materialIn: { totalWeight: number; packageCount: number; packages: string[] }
  materialOut: { totalWeight: number; packageCount: number; packages: string[] }
  yieldPct: number
  wastePct: number
  fees: { feeType: string; label: string; amount: number; basis: string; rate: number }[]
  totalFees: number
  commencedAt: string | null
}

export interface ReconciliationStatement {
  agreementId: string
  partnerName: string
  partnerLicense: string | null
  agreementType: string
  billingMode: string
  status: string
  startDate: string
  endDate: string | null
  // Aggregate material flow
  totalInputWeight: number
  totalOutputWeight: number
  overallYieldPct: number
  overallWastePct: number
  // Aggregate financials
  totalFees: number
  feesByType: Record<string, number>
  costPerGramInput: number
  costPerGramOutput: number
  // Yield guarantee analysis
  yieldGuarantee: number | null
  yieldVariance: number | null
  yieldGuaranteeMet: boolean | null
  // Per-batch breakdown
  batches: BatchStatement[]
  // Revenue (optional)
  totalRevenue: number | null
  netPosition: number | null
  // Summary counts
  summary: {
    totalBatches: number
    completedBatches: number
    inProgressBatches: number
    commencedBatches: number
  }
  generatedAt: string
}

interface FeeEntry {
  feeType: string
  label: string
  amount: number
  basis: string
  rate: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely parse `calculatedFees` from Prisma JSON.
 * Handles: null, undefined, malformed, or the two known shapes:
 *   - Array<FeeEntry> (direct fee array)
 *   - { fees: Array<FeeEntry>, billingMode?, costBasis? } (extended shape from calculateBatchFees)
 */
function parseFees(raw: unknown): FeeEntry[] {
  if (raw == null) return []

  // Direct array of fees
  if (Array.isArray(raw)) {
    return raw.filter(isFeeEntry)
  }

  // Extended shape: { fees: [...], billingMode, costBasis }
  if (typeof raw === 'object' && 'fees' in (raw as Record<string, unknown>)) {
    const obj = raw as Record<string, unknown>
    if (Array.isArray(obj.fees)) {
      return (obj.fees as unknown[]).filter(isFeeEntry)
    }
  }

  return []
}

function isFeeEntry(val: unknown): val is FeeEntry {
  if (val == null || typeof val !== 'object') return false
  const obj = val as Record<string, unknown>
  return (
    typeof obj.feeType === 'string' &&
    typeof obj.label === 'string' &&
    typeof obj.amount === 'number' &&
    typeof obj.basis === 'string' &&
    typeof obj.rate === 'number'
  )
}

function toISOString(val: Date | string | null | undefined): string | null {
  if (val == null) return null
  if (val instanceof Date) return val.toISOString()
  return val
}

function round2(val: number): number {
  return Math.round(val * 100) / 100
}

function round1(val: number): number {
  return Math.round(val * 10) / 10
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function generateReconciliationStatement(
  agreement: {
    id: string
    partnerName: string
    partnerLicense: string | null
    agreementType: string
    billingMode: string
    status: string
    startDate: string
    endDate: string | null
    yieldGuarantee: number | null
  },
  batches: {
    id: string
    status: string
    lifecycleStage: string
    inputPackageIds: string[]
    outputPackageIds: string[]
    inputWeight: number | null
    outputWeight: number | null
    wasteWeight: number | null
    wastePct: number | null
    calculatedFees: unknown
    totalFees: number | null
    commencedAt: Date | string | null
  }[],
  salesRevenue?: number | null,
): ReconciliationStatement {
  // Build per-batch statements
  const batchStatements: BatchStatement[] = batches.map((b) => {
    const inWeight = b.inputWeight ?? 0
    const outWeight = b.outputWeight ?? 0
    const yieldPct = inWeight > 0 ? round1((outWeight / inWeight) * 100) : 0
    const wastePct = b.wastePct ?? (b.wasteWeight != null && inWeight > 0
      ? round1((b.wasteWeight / inWeight) * 100)
      : 0)
    const fees = parseFees(b.calculatedFees)

    return {
      batchId: b.id,
      status: b.status,
      lifecycleStage: b.lifecycleStage,
      materialIn: {
        totalWeight: round2(inWeight),
        packageCount: b.inputPackageIds.length,
        packages: b.inputPackageIds,
      },
      materialOut: {
        totalWeight: round2(outWeight),
        packageCount: b.outputPackageIds.length,
        packages: b.outputPackageIds,
      },
      yieldPct,
      wastePct,
      fees,
      totalFees: b.totalFees ?? fees.reduce((sum, f) => sum + f.amount, 0),
      commencedAt: toISOString(b.commencedAt),
    }
  })

  // Aggregate material flow
  const totalInputWeight = round2(batchStatements.reduce((sum, b) => sum + b.materialIn.totalWeight, 0))
  const totalOutputWeight = round2(batchStatements.reduce((sum, b) => sum + b.materialOut.totalWeight, 0))
  const overallYieldPct = totalInputWeight > 0
    ? round1((totalOutputWeight / totalInputWeight) * 100)
    : 0
  // Overall waste: sum waste from batch waste percentages weighted by input
  const totalWasteWeight = batches.reduce((sum, b) => sum + (b.wasteWeight ?? 0), 0)
  const overallWastePct = totalInputWeight > 0
    ? round1((totalWasteWeight / totalInputWeight) * 100)
    : 0

  // Aggregate fees
  const totalFees = round2(batchStatements.reduce((sum, b) => sum + b.totalFees, 0))
  const feesByType: Record<string, number> = {}
  for (const bs of batchStatements) {
    for (const f of bs.fees) {
      feesByType[f.feeType] = round2((feesByType[f.feeType] ?? 0) + f.amount)
    }
  }

  // Cost per gram
  const costPerGramInput = totalInputWeight > 0 ? round2(totalFees / totalInputWeight) : 0
  const costPerGramOutput = totalOutputWeight > 0 ? round2(totalFees / totalOutputWeight) : 0

  // Yield guarantee analysis
  const yieldGuarantee = agreement.yieldGuarantee
  let yieldVariance: number | null = null
  let yieldGuaranteeMet: boolean | null = null
  if (yieldGuarantee != null && totalInputWeight > 0) {
    yieldVariance = round1(overallYieldPct - yieldGuarantee)
    yieldGuaranteeMet = overallYieldPct >= yieldGuarantee
  }

  // Revenue / net position
  const totalRevenue = salesRevenue ?? null
  const netPosition = totalRevenue != null ? round2(totalRevenue - totalFees) : null

  // Summary counts
  const completedBatches = batches.filter((b) => b.status === 'COMPLETED').length
  const inProgressBatches = batches.filter((b) => b.status === 'IN_PROGRESS').length
  const commencedBatches = batches.filter((b) => b.lifecycleStage === 'COMMENCED').length

  return {
    agreementId: agreement.id,
    partnerName: agreement.partnerName,
    partnerLicense: agreement.partnerLicense,
    agreementType: agreement.agreementType,
    billingMode: agreement.billingMode,
    status: agreement.status,
    startDate: agreement.startDate,
    endDate: agreement.endDate,
    totalInputWeight,
    totalOutputWeight,
    overallYieldPct,
    overallWastePct,
    totalFees,
    feesByType,
    costPerGramInput,
    costPerGramOutput,
    yieldGuarantee,
    yieldVariance,
    yieldGuaranteeMet,
    batches: batchStatements,
    totalRevenue,
    netPosition,
    summary: {
      totalBatches: batches.length,
      completedBatches,
      inProgressBatches,
      commencedBatches,
    },
    generatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// CSV Export
// ---------------------------------------------------------------------------

function escapeCSV(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

export function reconciliationToCSV(statement: ReconciliationStatement): string {
  const headers = [
    'Batch ID',
    'Status',
    'Stage',
    'Input Weight (g)',
    'Output Weight (g)',
    'Yield %',
    'Waste %',
    'Total Fees ($)',
    'Commenced',
  ]

  const rows: string[][] = statement.batches.map((b) => [
    b.batchId,
    b.status,
    b.lifecycleStage,
    b.materialIn.totalWeight.toString(),
    b.materialOut.totalWeight.toString(),
    b.yieldPct.toString(),
    b.wastePct.toString(),
    b.totalFees.toFixed(2),
    b.commencedAt ?? '',
  ])

  // Totals row
  rows.push([
    'TOTALS',
    '',
    '',
    statement.totalInputWeight.toString(),
    statement.totalOutputWeight.toString(),
    statement.overallYieldPct.toString(),
    statement.overallWastePct.toString(),
    statement.totalFees.toFixed(2),
    '',
  ])

  const csvLines = [
    `# Reconciliation: ${statement.partnerName.replace(/[\n\r,]/g, ' ')} (${statement.agreementType})`,
    `# Agreement ID: ${statement.agreementId}`,
    `# Generated: ${statement.generatedAt}`,
    `# Billing Mode: ${statement.billingMode}`,
    '',
    headers.map(escapeCSV).join(','),
    ...rows.map((r) => r.map(escapeCSV).join(',')),
  ]

  return csvLines.join('\n')
}
