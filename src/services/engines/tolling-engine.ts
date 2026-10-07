/**
 * tolling-engine.ts — Advanced Tolling Economics Engine
 *
 * Provides multi-fee calculation, partner comparison, breakeven analysis,
 * and yield variance tracking for cannabis tolling agreements.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeeType = 'FLAT' | 'PER_UNIT' | 'PERCENTAGE' | 'ROYALTY' | 'TRANSPORT' | 'TESTING'

export interface FeeDefinition {
  feeType: FeeType
  label: string
  rate: number
  basis: 'input_weight' | 'output_weight' | 'revenue' | 'fixed'
  minFee?: number
  maxFee?: number
  notes?: string
}

export interface FeeCalculationResult {
  feeType: FeeType
  label: string
  rate: number
  basis: string
  basisValue: number
  rawAmount: number
  cappedAmount: number
}

export interface TollingCalculation {
  inputWeight: number
  outputWeight: number
  yieldPercentage: number
  lossPercentage: number
  fees: FeeCalculationResult[]
  totalFees: number
  costPerGramInput: number
  costPerGramOutput: number
}

export interface TollingComparison {
  partnerName: string
  agreementType: string
  yieldPercentage: number
  totalFees: number
  costPerGramOutput: number
  costPerGramInput: number
  feeBreakdown: FeeCalculationResult[]
  ranking: number
}

export interface BreakevenResult {
  partnerA: string
  partnerB: string
  breakevenYieldPct: number | null
  atBreakeven: {
    partnerAFees: number
    partnerBFees: number
  } | null
  recommendation: string
}

export interface YieldVarianceResult {
  partnerName: string
  batchCount: number
  avgExpectedYield: number
  avgActualYield: number
  avgVariance: number
  reliabilityScore: number // 0-100
  batches: Array<{
    batchId: string
    expectedYield: number
    actualYield: number
    variance: number
  }>
}

// ---------------------------------------------------------------------------
// 1. Calculate Fees (Multi-Fee Structure)
// ---------------------------------------------------------------------------

export function calculateFees(
  feeStructure: FeeDefinition[],
  inputWeight: number,
  outputWeight: number,
  revenue?: number,
): TollingCalculation {
  const yieldPercentage = inputWeight > 0 ? (outputWeight / inputWeight) * 100 : 0
  const lossPercentage = 100 - yieldPercentage

  const fees: FeeCalculationResult[] = feeStructure.map((fee) => {
    let basisValue: number
    switch (fee.basis) {
      case 'input_weight': basisValue = inputWeight; break
      case 'output_weight': basisValue = outputWeight; break
      case 'revenue': basisValue = revenue ?? 0; break
      case 'fixed': basisValue = 1; break
      default: basisValue = 0
    }

    let rawAmount: number
    switch (fee.feeType) {
      case 'FLAT':
      case 'TRANSPORT':
      case 'TESTING':
        rawAmount = fee.rate
        break
      case 'PER_UNIT':
        rawAmount = fee.rate * basisValue
        break
      case 'PERCENTAGE':
      case 'ROYALTY':
        rawAmount = (fee.rate / 100) * basisValue
        break
      default:
        rawAmount = fee.rate * basisValue
    }

    let cappedAmount = rawAmount
    if (fee.minFee != null && cappedAmount < fee.minFee) cappedAmount = fee.minFee
    if (fee.maxFee != null && cappedAmount > fee.maxFee) cappedAmount = fee.maxFee

    return {
      feeType: fee.feeType,
      label: fee.label,
      rate: fee.rate,
      basis: fee.basis,
      basisValue: Math.round(basisValue * 100) / 100,
      rawAmount: Math.round(rawAmount * 100) / 100,
      cappedAmount: Math.round(cappedAmount * 100) / 100,
    }
  })

  const totalFees = fees.reduce((sum, f) => sum + f.cappedAmount, 0)

  return {
    inputWeight,
    outputWeight,
    yieldPercentage: Math.round(yieldPercentage * 10) / 10,
    lossPercentage: Math.round(lossPercentage * 10) / 10,
    fees,
    totalFees: Math.round(totalFees * 100) / 100,
    costPerGramInput: inputWeight > 0 ? Math.round((totalFees / inputWeight) * 100) / 100 : 0,
    costPerGramOutput: outputWeight > 0 ? Math.round((totalFees / outputWeight) * 100) / 100 : 0,
  }
}

/** Legacy compat wrapper — keeps the old tolling router working */
export function calculateTolling(
  inputWeight: number,
  outputWeight: number,
  processingFee: number,
): TollingCalculation {
  return calculateFees(
    [{ feeType: 'PER_UNIT', label: 'Processing Fee', rate: processingFee, basis: 'input_weight' }],
    inputWeight,
    outputWeight,
  )
}

// ---------------------------------------------------------------------------
// 2. Compare Partners (Multi-Dimensional)
// ---------------------------------------------------------------------------

export function comparePartners(
  partners: Array<{
    partnerName: string
    agreementType?: string
    feeStructure: FeeDefinition[]
    inputWeight: number
    expectedYieldPct: number
    revenue?: number
  }>,
): TollingComparison[] {
  const comparisons: TollingComparison[] = partners.map((p) => {
    const outputWeight = p.inputWeight * (p.expectedYieldPct / 100)
    const calc = calculateFees(p.feeStructure, p.inputWeight, outputWeight, p.revenue)

    return {
      partnerName: p.partnerName,
      agreementType: p.agreementType ?? 'OUTBOUND',
      yieldPercentage: calc.yieldPercentage,
      totalFees: calc.totalFees,
      costPerGramOutput: calc.costPerGramOutput,
      costPerGramInput: calc.costPerGramInput,
      feeBreakdown: calc.fees,
      ranking: 0,
    }
  })

  comparisons.sort((a, b) => a.costPerGramOutput - b.costPerGramOutput)
  comparisons.forEach((c, i) => { c.ranking = i + 1 })

  return comparisons
}

/** Legacy compat wrapper */
export function compareProcessors(
  processors: { partnerName: string; inputWeight: number; outputWeight: number; processingFee: number }[],
): TollingComparison[] {
  return comparePartners(
    processors.map((p) => ({
      partnerName: p.partnerName,
      feeStructure: [{ feeType: 'PER_UNIT' as FeeType, label: 'Processing Fee', rate: p.processingFee, basis: 'input_weight' as const }],
      inputWeight: p.inputWeight,
      expectedYieldPct: p.inputWeight > 0 ? (p.outputWeight / p.inputWeight) * 100 : 0,
    })),
  )
}

// ---------------------------------------------------------------------------
// 3. Find Breakeven Yield
// ---------------------------------------------------------------------------

export function findBreakevenYield(
  partnerA: { name: string; feeStructure: FeeDefinition[] },
  partnerB: { name: string; feeStructure: FeeDefinition[] },
  inputWeight: number,
  revenue?: number,
): BreakevenResult {
  const isLinear = (fees: FeeDefinition[]) =>
    fees.every((f) => f.minFee == null && f.maxFee == null)

  if (isLinear(partnerA.feeStructure) && isLinear(partnerB.feeStructure)) {
    const getYieldCoeff = (fees: FeeDefinition[]): { fixed: number; yieldCoeff: number } => {
      let fixed = 0
      let yieldCoeff = 0
      for (const fee of fees) {
        const isPct = fee.feeType === 'PERCENTAGE' || fee.feeType === 'ROYALTY'
        const mult = isPct ? fee.rate / 100 : fee.rate
        if (fee.basis === 'output_weight') {
          yieldCoeff += mult * inputWeight / 100
        } else if (fee.basis === 'input_weight') {
          fixed += mult * inputWeight
        } else if (fee.basis === 'revenue') {
          fixed += mult * (revenue ?? 0)
        } else {
          fixed += fee.rate
        }
      }
      return { fixed, yieldCoeff }
    }

    const a = getYieldCoeff(partnerA.feeStructure)
    const b = getYieldCoeff(partnerB.feeStructure)
    const coeffDiff = a.yieldCoeff - b.yieldCoeff

    if (Math.abs(coeffDiff) < 0.0001) {
      return {
        partnerA: partnerA.name,
        partnerB: partnerB.name,
        breakevenYieldPct: null,
        atBreakeven: null,
        recommendation: a.fixed <= b.fixed
          ? `${partnerA.name} is always cheaper (fees are parallel)`
          : `${partnerB.name} is always cheaper (fees are parallel)`,
      }
    }

    const breakevenYield = (b.fixed - a.fixed) / coeffDiff

    if (breakevenYield < 0 || breakevenYield > 100) {
      const calcA = calculateFees(partnerA.feeStructure, inputWeight, inputWeight * 0.5, revenue)
      const calcB = calculateFees(partnerB.feeStructure, inputWeight, inputWeight * 0.5, revenue)
      return {
        partnerA: partnerA.name,
        partnerB: partnerB.name,
        breakevenYieldPct: null,
        atBreakeven: null,
        recommendation: calcA.totalFees <= calcB.totalFees
          ? `${partnerA.name} is cheaper at all realistic yields`
          : `${partnerB.name} is cheaper at all realistic yields`,
      }
    }

    const outputAtBE = inputWeight * breakevenYield / 100
    const feesA = calculateFees(partnerA.feeStructure, inputWeight, outputAtBE, revenue)
    const feesB = calculateFees(partnerB.feeStructure, inputWeight, outputAtBE, revenue)
    const rounded = Math.round(breakevenYield * 10) / 10

    return {
      partnerA: partnerA.name,
      partnerB: partnerB.name,
      breakevenYieldPct: rounded,
      atBreakeven: { partnerAFees: feesA.totalFees, partnerBFees: feesB.totalFees },
      recommendation: coeffDiff > 0
        ? `Below ${rounded}% yield, ${partnerA.name} is cheaper. Above, ${partnerB.name} is cheaper.`
        : `Below ${rounded}% yield, ${partnerB.name} is cheaper. Above, ${partnerA.name} is cheaper.`,
    }
  }

  // Non-linear: binary search
  let lo = 0
  let hi = 100
  const feesAtYield = (yieldPct: number) => {
    const output = inputWeight * yieldPct / 100
    const aCalc = calculateFees(partnerA.feeStructure, inputWeight, output, revenue)
    const bCalc = calculateFees(partnerB.feeStructure, inputWeight, output, revenue)
    return { diff: aCalc.totalFees - bCalc.totalFees, feesA: aCalc.totalFees, feesB: bCalc.totalFees }
  }

  const loResult = feesAtYield(lo)
  const hiResult = feesAtYield(hi)

  if (Math.sign(loResult.diff) === Math.sign(hiResult.diff)) {
    return {
      partnerA: partnerA.name,
      partnerB: partnerB.name,
      breakevenYieldPct: null,
      atBreakeven: null,
      recommendation: loResult.diff <= 0
        ? `${partnerA.name} is cheaper at all yield levels`
        : `${partnerB.name} is cheaper at all yield levels`,
    }
  }

  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2
    const midResult = feesAtYield(mid)

    if (Math.abs(midResult.diff) < 0.01) {
      const rounded = Math.round(mid * 10) / 10
      return {
        partnerA: partnerA.name,
        partnerB: partnerB.name,
        breakevenYieldPct: rounded,
        atBreakeven: { partnerAFees: midResult.feesA, partnerBFees: midResult.feesB },
        recommendation: `At ${rounded}% yield, both partners cost the same.`,
      }
    }

    if (Math.sign(midResult.diff) === Math.sign(loResult.diff)) {
      lo = mid
    } else {
      hi = mid
    }
  }

  const finalYield = (lo + hi) / 2
  const finalResult = feesAtYield(finalYield)
  const rounded = Math.round(finalYield * 10) / 10
  return {
    partnerA: partnerA.name,
    partnerB: partnerB.name,
    breakevenYieldPct: rounded,
    atBreakeven: { partnerAFees: finalResult.feesA, partnerBFees: finalResult.feesB },
    recommendation: `Breakeven at approximately ${rounded}% yield.`,
  }
}

// ---------------------------------------------------------------------------
// 4. Analyze Yield Variance
// ---------------------------------------------------------------------------

export function analyzeYieldVariance(
  partnerName: string,
  batches: Array<{
    batchId: string
    expectedYieldPct: number | null
    actualYieldPct: number | null
  }>,
): YieldVarianceResult {
  const validBatches = batches.filter(
    (b): b is { batchId: string; expectedYieldPct: number; actualYieldPct: number } =>
      b.expectedYieldPct != null && b.actualYieldPct != null
  )

  if (validBatches.length === 0) {
    return {
      partnerName,
      batchCount: 0,
      avgExpectedYield: 0,
      avgActualYield: 0,
      avgVariance: 0,
      reliabilityScore: 0,
      batches: [],
    }
  }

  const batchResults = validBatches.map((b) => ({
    batchId: b.batchId,
    expectedYield: b.expectedYieldPct,
    actualYield: b.actualYieldPct,
    variance: Math.round((b.actualYieldPct - b.expectedYieldPct) * 10) / 10,
  }))

  const avgExpected = validBatches.reduce((s, b) => s + b.expectedYieldPct, 0) / validBatches.length
  const avgActual = validBatches.reduce((s, b) => s + b.actualYieldPct, 0) / validBatches.length
  const avgVariance = avgActual - avgExpected

  const variances = batchResults.map((b) => b.variance)
  const mean = variances.reduce((s, v) => s + v, 0) / variances.length
  const stdDev = Math.sqrt(
    variances.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / variances.length
  )

  // Score: 100 when stdDev = 0, ~75 at stdDev 5%, ~50 at stdDev 10%
  const reliabilityScore = Math.max(0, Math.min(100, Math.round(100 * Math.exp(-stdDev / 10))))

  return {
    partnerName,
    batchCount: validBatches.length,
    avgExpectedYield: Math.round(avgExpected * 10) / 10,
    avgActualYield: Math.round(avgActual * 10) / 10,
    avgVariance: Math.round(avgVariance * 10) / 10,
    reliabilityScore,
    batches: batchResults,
  }
}
