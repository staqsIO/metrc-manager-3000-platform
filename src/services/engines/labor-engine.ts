/**
 * Labor Calculator Engine (FOR-954)
 *
 * Pure TypeScript business logic for labor cost calculations.
 * No React or Prisma imports — consumed by tRPC router.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LaborEntry {
  hoursWorked: number
  hourlyRate: number
  laborCost: number
  unitsProduced: number | null
  costPerUnit: number | null
  skuName: string | null
  activityType: string
  workDate: Date | string
  employeeId?: string | null
  employeeName?: string | null
}

export interface QuickCalcInput {
  hoursWorked: number
  hourlyRate: number
  batchSize: number
}

export interface QuickCalcResult {
  totalLaborCost: number
  costPerUnit: number | null // null when batchSize <= 0
  unitsPerHour: number | null
  batchSize: number
}

export interface SKULaborSummary {
  skuName: string
  totalHours: number
  totalLaborCost: number
  totalUnits: number
  avgCostPerUnit: number | null
  entryCount: number
  activityBreakdown: { activity: string; hours: number; cost: number }[]
}

export interface SKUCostRollup {
  skuName: string
  materialCost: number
  supplyCost: number
  laborCost: number
  consumablesCost: number
  packagingCost: number
  totalCostPerUnit: number
  breakdown: { component: string; costPerUnit: number; percentage: number }[]
}

export interface LaborTrendPoint {
  period: string
  totalHours: number
  totalCost: number
  totalUnits: number
  avgCostPerUnit: number | null
}

export interface EmployeeProductivity {
  employeeId: string
  employeeName: string
  totalHours: number
  totalUnits: number
  unitsPerHour: number | null
  totalCost: number
  entryCount: number
}

// ---------------------------------------------------------------------------
// 1. calculateLaborCost
// ---------------------------------------------------------------------------

export function calculateLaborCost(input: QuickCalcInput): QuickCalcResult {
  const totalLaborCost = input.hoursWorked * input.hourlyRate
  const costPerUnit = input.batchSize > 0 ? totalLaborCost / input.batchSize : null
  const unitsPerHour = input.hoursWorked > 0 ? input.batchSize / input.hoursWorked : null

  return {
    totalLaborCost,
    costPerUnit,
    unitsPerHour,
    batchSize: input.batchSize,
  }
}

// ---------------------------------------------------------------------------
// 2. aggregateLaborBySKU
// ---------------------------------------------------------------------------

export function aggregateLaborBySKU(entries: LaborEntry[]): SKULaborSummary[] {
  const map = new Map<string, {
    totalHours: number
    totalLaborCost: number
    totalUnits: number
    entryCount: number
    activityMap: Map<string, { hours: number; cost: number }>
  }>()

  for (const entry of entries) {
    const sku = entry.skuName || 'Unassigned'
    let bucket = map.get(sku)
    if (!bucket) {
      bucket = { totalHours: 0, totalLaborCost: 0, totalUnits: 0, entryCount: 0, activityMap: new Map() }
      map.set(sku, bucket)
    }
    bucket.totalHours += entry.hoursWorked
    bucket.totalLaborCost += entry.laborCost
    bucket.totalUnits += entry.unitsProduced ?? 0
    bucket.entryCount += 1

    const actKey = entry.activityType
    const act = bucket.activityMap.get(actKey)
    if (act) {
      act.hours += entry.hoursWorked
      act.cost += entry.laborCost
    } else {
      bucket.activityMap.set(actKey, { hours: entry.hoursWorked, cost: entry.laborCost })
    }
  }

  const results: SKULaborSummary[] = []
  Array.from(map.entries()).forEach(([skuName, bucket]) => {
    const activityBreakdown: { activity: string; hours: number; cost: number }[] = []
    Array.from(bucket.activityMap.entries()).forEach(([activity, data]) => {
      activityBreakdown.push({ activity, hours: data.hours, cost: data.cost })
    })

    results.push({
      skuName,
      totalHours: bucket.totalHours,
      totalLaborCost: bucket.totalLaborCost,
      totalUnits: bucket.totalUnits,
      avgCostPerUnit: bucket.totalUnits > 0 ? bucket.totalLaborCost / bucket.totalUnits : null,
      entryCount: bucket.entryCount,
      activityBreakdown,
    })
  })

  // Sort by totalLaborCost descending
  results.sort((a, b) => b.totalLaborCost - a.totalLaborCost)
  return results
}

// ---------------------------------------------------------------------------
// 3. rollupSKUCost
// ---------------------------------------------------------------------------

export function rollupSKUCost(input: {
  skuName: string
  materialCost: number
  supplyCost: number
  laborEntries: LaborEntry[]
  consumablesPerUnit: number
  packagingPerUnit: number
  totalUnits: number
}): SKUCostRollup {
  const totalLabor = input.laborEntries.reduce((sum, e) => sum + e.laborCost, 0)
  const laborCostPerUnit = input.totalUnits > 0 ? totalLabor / input.totalUnits : 0
  const materialCostPerUnit = input.totalUnits > 0 ? input.materialCost / input.totalUnits : 0
  const supplyCostPerUnit = input.totalUnits > 0 ? input.supplyCost / input.totalUnits : 0

  const totalCostPerUnit =
    materialCostPerUnit +
    supplyCostPerUnit +
    laborCostPerUnit +
    input.consumablesPerUnit +
    input.packagingPerUnit

  const components = [
    { component: 'Material', costPerUnit: materialCostPerUnit },
    { component: 'Supply', costPerUnit: supplyCostPerUnit },
    { component: 'Labor', costPerUnit: laborCostPerUnit },
    { component: 'Consumables', costPerUnit: input.consumablesPerUnit },
    { component: 'Packaging', costPerUnit: input.packagingPerUnit },
  ]

  const breakdown = components.map(c => ({
    component: c.component,
    costPerUnit: c.costPerUnit,
    percentage: totalCostPerUnit > 0 ? (c.costPerUnit / totalCostPerUnit) * 100 : 0,
  }))

  return {
    skuName: input.skuName,
    materialCost: input.materialCost,
    supplyCost: input.supplyCost,
    laborCost: totalLabor,
    consumablesCost: input.consumablesPerUnit * input.totalUnits,
    packagingCost: input.packagingPerUnit * input.totalUnits,
    totalCostPerUnit,
    breakdown,
  }
}

// ---------------------------------------------------------------------------
// 4. analyzeLaborTrend
// ---------------------------------------------------------------------------

function getWeekNumber(d: Date): number {
  const oneJan = new Date(d.getFullYear(), 0, 1)
  const days = Math.floor((d.getTime() - oneJan.getTime()) / 86400000)
  return Math.ceil((days + oneJan.getDay() + 1) / 7)
}

function formatPeriod(date: Date, groupBy: 'day' | 'week' | 'month'): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  switch (groupBy) {
    case 'day':
      return `${y}-${m}-${d}`
    case 'week':
      return `${y}-W${String(getWeekNumber(date)).padStart(2, '0')}`
    case 'month':
      return `${y}-${m}`
  }
}

export function analyzeLaborTrend(
  entries: LaborEntry[],
  groupBy: 'day' | 'week' | 'month',
): LaborTrendPoint[] {
  const map = new Map<string, { totalHours: number; totalCost: number; totalUnits: number }>()

  for (const entry of entries) {
    const date = entry.workDate instanceof Date ? entry.workDate : new Date(entry.workDate)
    const period = formatPeriod(date, groupBy)
    let bucket = map.get(period)
    if (!bucket) {
      bucket = { totalHours: 0, totalCost: 0, totalUnits: 0 }
      map.set(period, bucket)
    }
    bucket.totalHours += entry.hoursWorked
    bucket.totalCost += entry.laborCost
    bucket.totalUnits += entry.unitsProduced ?? 0
  }

  const results: LaborTrendPoint[] = []
  Array.from(map.entries()).forEach(([period, bucket]) => {
    results.push({
      period,
      totalHours: bucket.totalHours,
      totalCost: bucket.totalCost,
      totalUnits: bucket.totalUnits,
      avgCostPerUnit: bucket.totalUnits > 0 ? bucket.totalCost / bucket.totalUnits : null,
    })
  })

  // Sort chronologically
  results.sort((a, b) => a.period.localeCompare(b.period))
  return results
}

// ---------------------------------------------------------------------------
// 5. compareEmployeeProductivity
// ---------------------------------------------------------------------------

export function compareEmployeeProductivity(entries: LaborEntry[]): EmployeeProductivity[] {
  const map = new Map<string, {
    employeeName: string
    totalHours: number
    totalUnits: number
    totalCost: number
    entryCount: number
  }>()

  for (const entry of entries) {
    const id = entry.employeeId || 'unassigned'
    const name = entry.employeeName || 'Unassigned'
    let bucket = map.get(id)
    if (!bucket) {
      bucket = { employeeName: name, totalHours: 0, totalUnits: 0, totalCost: 0, entryCount: 0 }
      map.set(id, bucket)
    }
    bucket.totalHours += entry.hoursWorked
    bucket.totalUnits += entry.unitsProduced ?? 0
    bucket.totalCost += entry.laborCost
    bucket.entryCount += 1
  }

  const results: EmployeeProductivity[] = []
  Array.from(map.entries()).forEach(([employeeId, bucket]) => {
    results.push({
      employeeId,
      employeeName: bucket.employeeName,
      totalHours: bucket.totalHours,
      totalUnits: bucket.totalUnits,
      unitsPerHour: bucket.totalHours > 0 ? bucket.totalUnits / bucket.totalHours : null,
      totalCost: bucket.totalCost,
      entryCount: bucket.entryCount,
    })
  })

  // Sort by unitsPerHour descending, nulls last
  results.sort((a, b) => {
    if (a.unitsPerHour === null && b.unitsPerHour === null) return 0
    if (a.unitsPerHour === null) return 1
    if (b.unitsPerHour === null) return -1
    return b.unitsPerHour - a.unitsPerHour
  })

  return results
}
