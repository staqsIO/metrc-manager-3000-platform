import type { MetrcHarvest, MetrcStrain, MetrcLabTest, MetrcPackage, MetrcPlant } from '@/services/metrc/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface YieldTrendPoint {
  period: string  // YYYY-MM
  harvestCount: number
  totalWeight: number
  avgYieldEfficiency: number
  isEstimate: boolean  // true if multi-strain harvest was split
}

export interface StrainYieldTrend {
  strainName: string
  dataPoints: YieldTrendPoint[]
  overallTrend: 'improving' | 'declining' | 'stable' | 'insufficient_data'
  avgYieldEfficiency: number
}

export type RecommendationSeverity = 'info' | 'warning' | 'critical' | 'success'

export interface Recommendation {
  strainName: string
  severity: RecommendationSeverity
  title: string
  description: string
  metric?: string
}

export interface GeneticGroupSummary {
  geneticType: string  // 'Indica', 'Sativa', 'Hybrid', 'Unknown'
  strainCount: number
  avgYieldEfficiency: number
  avgLabPassRate: number
  avgGrowthDays: number
  strains: {
    strainName: string
    yieldEfficiency: number
    labPassRate: number
    growthDays: number
    harvestCount: number
    indicaPct: number
    thcAvg: number
  }[]
}

export interface GrowthDurationEntry {
  strainName: string
  avgDays: number
  minDays: number
  maxDays: number
  harvestCount: number
  trend: 'faster' | 'slower' | 'stable' | 'insufficient_data'
}

export interface StrainIntelligenceResult {
  yieldTrends: StrainYieldTrend[]
  overallTrend: 'improving' | 'declining' | 'stable' | 'insufficient_data'
  recommendations: Recommendation[]
  geneticCorrelations: GeneticGroupSummary[]
  growthDurations: GrowthDurationEntry[]
  facilityAvgGrowthDays: number
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePeriod(dateStr: string): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return 'Unknown'
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function daysBetween(startStr: string, endStr: string): number {
  const start = new Date(startStr)
  const end = new Date(endStr)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
}

type TrendDirection = 'improving' | 'declining' | 'stable' | 'insufficient_data'

function detectTrend(dataPoints: { value: number }[]): TrendDirection {
  if (dataPoints.length < 2) return 'insufficient_data'

  const midpoint = Math.floor(dataPoints.length / 2)
  const firstHalf = dataPoints.slice(0, midpoint)
  const secondHalf = dataPoints.slice(midpoint)

  const firstAvg = firstHalf.reduce((s, p) => s + p.value, 0) / firstHalf.length
  const secondAvg = secondHalf.reduce((s, p) => s + p.value, 0) / secondHalf.length

  if (firstAvg === 0) return 'stable'

  const change = (secondAvg - firstAvg) / firstAvg
  if (change > 0.1) return 'improving'
  if (change < -0.1) return 'declining'
  return 'stable'
}

interface PeriodAccumulator {
  harvestCount: number
  totalWeight: number
  hasEstimate: boolean
}

interface DurationEntry {
  days: number
  date: string
}

interface StrainDetail {
  strainName: string
  geneticType: string
  yieldEfficiency: number
  labPassRate: number
  growthDays: number
  harvestCount: number
  indicaPct: number
  thcAvg: number
}

// ---------------------------------------------------------------------------
// 1. analyzeYieldTrends
// ---------------------------------------------------------------------------

export function analyzeYieldTrends(
  harvests: MetrcHarvest[],
): { trends: StrainYieldTrend[]; overallTrend: TrendDirection; warnings: string[] } {
  const warnings: string[] = []
  let multiStrainCount = 0

  // Map: strainName -> Map<period, PeriodAccumulator>
  const strainPeriods = new Map<string, Map<string, PeriodAccumulator>>()

  for (let hi = 0; hi < harvests.length; hi++) {
    const harvest = harvests[hi]
    const strainNames = harvest.SourceStrainNames
    if (!strainNames) continue

    const names = strainNames.split(',').map(function (s: string) { return s.trim() }).filter(Boolean)
    const isMulti = names.length > 1
    if (isMulti) multiStrainCount++

    const period = parsePeriod(harvest.HarvestStartDate)
    if (period === 'Unknown') continue

    const totalWeight = harvest.CurrentWeight + harvest.TotalPackagedWeight
    const weightPerStrain = isMulti ? totalWeight / names.length : totalWeight

    for (let ni = 0; ni < names.length; ni++) {
      const name = names[ni]
      let periodsMap = strainPeriods.get(name)
      if (!periodsMap) {
        periodsMap = new Map<string, PeriodAccumulator>()
        strainPeriods.set(name, periodsMap)
      }
      const existing = periodsMap.get(period) ?? { harvestCount: 0, totalWeight: 0, hasEstimate: false }
      existing.harvestCount += 1
      existing.totalWeight += weightPerStrain
      if (isMulti) existing.hasEstimate = true
      periodsMap.set(period, existing)
    }
  }

  if (multiStrainCount > 0) {
    warnings.push(`${multiStrainCount} harvests contain multiple strains. Yields are estimated by splitting equally.`)
  }

  // Build trends per strain
  const trends: StrainYieldTrend[] = []
  const strainEntries = Array.from(strainPeriods.entries())

  for (let si = 0; si < strainEntries.length; si++) {
    const strainName = strainEntries[si][0]
    const periodsMap = strainEntries[si][1]
    const sortedPeriods = Array.from(periodsMap.entries()).sort(
      function (a: [string, PeriodAccumulator], b: [string, PeriodAccumulator]) { return a[0].localeCompare(b[0]) },
    )

    const dataPoints: YieldTrendPoint[] = []
    for (let pi = 0; pi < sortedPeriods.length; pi++) {
      const period = sortedPeriods[pi][0]
      const data = sortedPeriods[pi][1]
      dataPoints.push({
        period,
        harvestCount: data.harvestCount,
        totalWeight: Math.round(data.totalWeight * 100) / 100,
        avgYieldEfficiency: data.harvestCount > 0
          ? Math.round((data.totalWeight / data.harvestCount) * 100) / 100
          : 0,
        isEstimate: data.hasEstimate,
      })
    }

    const overallTrend = detectTrend(
      dataPoints.map(function (dp: YieldTrendPoint) { return { value: dp.avgYieldEfficiency } }),
    )

    let totalWeight = 0
    let totalHarvests = 0
    for (let di = 0; di < dataPoints.length; di++) {
      totalWeight += dataPoints[di].totalWeight
      totalHarvests += dataPoints[di].harvestCount
    }
    const avgYieldEfficiency = totalHarvests > 0
      ? Math.round((totalWeight / totalHarvests) * 100) / 100
      : 0

    trends.push({ strainName, dataPoints, overallTrend, avgYieldEfficiency })
  }

  // Sort by avgYieldEfficiency descending
  trends.sort(function (a: StrainYieldTrend, b: StrainYieldTrend) { return b.avgYieldEfficiency - a.avgYieldEfficiency })

  // Overall trend across all strains
  const overallPeriods = new Map<string, { totalWeight: number; harvestCount: number }>()
  for (let oi = 0; oi < harvests.length; oi++) {
    const harvest = harvests[oi]
    if (!harvest.SourceStrainNames) continue
    const period = parsePeriod(harvest.HarvestStartDate)
    if (period === 'Unknown') continue
    const totalWeight = harvest.CurrentWeight + harvest.TotalPackagedWeight
    const existing = overallPeriods.get(period) ?? { totalWeight: 0, harvestCount: 0 }
    existing.totalWeight += totalWeight
    existing.harvestCount += 1
    overallPeriods.set(period, existing)
  }

  const sortedOverall = Array.from(overallPeriods.entries()).sort(
    function (a: [string, { totalWeight: number; harvestCount: number }], b: [string, { totalWeight: number; harvestCount: number }]) { return a[0].localeCompare(b[0]) },
  )
  const allDataPoints: { value: number }[] = []
  for (let soi = 0; soi < sortedOverall.length; soi++) {
    const data = sortedOverall[soi][1]
    allDataPoints.push({ value: data.harvestCount > 0 ? data.totalWeight / data.harvestCount : 0 })
  }
  const overallTrend = detectTrend(allDataPoints)

  return { trends, overallTrend, warnings }
}

// ---------------------------------------------------------------------------
// 2. generateRecommendations
// ---------------------------------------------------------------------------

export function generateRecommendations(
  harvests: MetrcHarvest[],
  _strains: MetrcStrain[],
  labTests: MetrcLabTest[],
  packages: MetrcPackage[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  plants: MetrcPlant[],
): Recommendation[] {
  const recommendations: Recommendation[] = []

  // Compute yield trends for decline detection
  const { trends } = analyzeYieldTrends(harvests)

  // Compute facility avg yield efficiency
  let totalYield = 0
  let totalHarvestCount = 0
  for (let ti = 0; ti < trends.length; ti++) {
    let trendHarvests = 0
    for (let dp = 0; dp < trends[ti].dataPoints.length; dp++) {
      trendHarvests += trends[ti].dataPoints[dp].harvestCount
    }
    totalYield += trends[ti].avgYieldEfficiency * trendHarvests
    totalHarvestCount += trendHarvests
  }
  const facilityAvgYield = totalHarvestCount > 0 ? totalYield / totalHarvestCount : 0

  // Build per-strain harvest counts
  const strainHarvestCounts = new Map<string, number>()
  for (let hi = 0; hi < harvests.length; hi++) {
    if (!harvests[hi].SourceStrainNames) continue
    const names = harvests[hi].SourceStrainNames.split(',').map(function (s: string) { return s.trim() }).filter(Boolean)
    for (let ni = 0; ni < names.length; ni++) {
      strainHarvestCounts.set(names[ni], (strainHarvestCounts.get(names[ni]) ?? 0) + 1)
    }
  }

  // --- Declining yield ---
  for (let ti = 0; ti < trends.length; ti++) {
    const trend = trends[ti]
    const harvestCount = strainHarvestCounts.get(trend.strainName) ?? 0
    if (harvestCount < 3) continue

    if (trend.overallTrend === 'declining' && facilityAvgYield > 0 && trend.avgYieldEfficiency < facilityAvgYield * 0.9) {
      recommendations.push({
        strainName: trend.strainName,
        severity: 'warning',
        title: `Declining Yield: ${trend.strainName}`,
        description: `Yield efficiency is declining and ${Math.round(((facilityAvgYield - trend.avgYieldEfficiency) / facilityAvgYield) * 100)}% below facility average.`,
        metric: `${trend.avgYieldEfficiency.toFixed(1)} vs ${facilityAvgYield.toFixed(1)} avg`,
      })
    }
  }

  // --- High waste ---
  const harvestsByStrain = new Map<string, MetrcHarvest[]>()
  for (let hi = 0; hi < harvests.length; hi++) {
    const harvest = harvests[hi]
    if (!harvest.SourceStrainNames) continue
    const names = harvest.SourceStrainNames.split(',').map(function (s: string) { return s.trim() }).filter(Boolean)
    for (let ni = 0; ni < names.length; ni++) {
      const list = harvestsByStrain.get(names[ni]) ?? []
      list.push(harvest)
      harvestsByStrain.set(names[ni], list)
    }
  }

  const harvestStrainEntries = Array.from(harvestsByStrain.entries())
  for (let hsi = 0; hsi < harvestStrainEntries.length; hsi++) {
    const strainName = harvestStrainEntries[hsi][0]
    const strainHarvests = harvestStrainEntries[hsi][1]
    if (strainHarvests.length < 3) continue
    let highWasteCount = 0
    for (let shi = 0; shi < strainHarvests.length; shi++) {
      const harvest = strainHarvests[shi]
      const totalGross = harvest.CurrentWeight + harvest.TotalWasteWeight
      if (totalGross > 0 && harvest.TotalWasteWeight / totalGross > 0.25) {
        highWasteCount++
      }
    }
    if (highWasteCount > strainHarvests.length / 2) {
      recommendations.push({
        strainName,
        severity: 'warning',
        title: `High Waste Rate: ${strainName}`,
        description: `${highWasteCount} of ${strainHarvests.length} harvests have waste exceeding 25% of total weight.`,
        metric: `${highWasteCount}/${strainHarvests.length} high waste`,
      })
    }
  }

  // --- Low lab pass rate ---
  const packageStrainMap = new Map<string, string>()
  for (let pi = 0; pi < packages.length; pi++) {
    const pkg = packages[pi]
    if (pkg.ItemStrainName && pkg.Label) {
      packageStrainMap.set(pkg.Label, pkg.ItemStrainName)
    }
  }

  const labTestsByStrain = new Map<string, MetrcLabTest[]>()
  for (let li = 0; li < labTests.length; li++) {
    const test = labTests[li]
    const strain = packageStrainMap.get(test.PackageLabel)
    if (!strain) continue
    const list = labTestsByStrain.get(strain) ?? []
    list.push(test)
    labTestsByStrain.set(strain, list)
  }

  const labStrainEntries = Array.from(labTestsByStrain.entries())
  for (let lsi = 0; lsi < labStrainEntries.length; lsi++) {
    const strainName = labStrainEntries[lsi][0]
    const strainTests = labStrainEntries[lsi][1]
    if (strainTests.length < 3) continue
    let passedCount = 0
    for (let sti = 0; sti < strainTests.length; sti++) {
      if (strainTests[sti].OverallPassed) passedCount++
    }
    const passRate = passedCount / strainTests.length
    if (passRate < 0.8) {
      recommendations.push({
        strainName,
        severity: 'critical',
        title: `Low Lab Pass Rate: ${strainName}`,
        description: `Only ${(passRate * 100).toFixed(0)}% of ${strainTests.length} lab tests passed.`,
        metric: `${(passRate * 100).toFixed(0)}% pass rate`,
      })
    }
  }

  // --- Slow growth ---
  const { durations, facilityAvg } = analyzeGrowthDurations(harvests)
  if (facilityAvg > 0) {
    for (let di = 0; di < durations.length; di++) {
      const entry = durations[di]
      if (entry.harvestCount < 3) continue
      if (entry.avgDays > facilityAvg * 1.2) {
        recommendations.push({
          strainName: entry.strainName,
          severity: 'info',
          title: `Slow Growth Cycle: ${entry.strainName}`,
          description: `Average growth of ${Math.round(entry.avgDays)} days is ${Math.round(((entry.avgDays - facilityAvg) / facilityAvg) * 100)}% above facility average of ${Math.round(facilityAvg)} days.`,
          metric: `${Math.round(entry.avgDays)}d vs ${Math.round(facilityAvg)}d avg`,
        })
      }
    }
  }

  // --- Top performer ---
  for (let ti = 0; ti < trends.length; ti++) {
    const trend = trends[ti]
    const harvestCount = strainHarvestCounts.get(trend.strainName) ?? 0
    if (harvestCount < 3) continue

    const isBestYield = trends.length > 0 && trends[0].strainName === trend.strainName

    const strainTests = labTestsByStrain.get(trend.strainName)
    let passRate = 0
    if (strainTests && strainTests.length > 0) {
      let passed = 0
      for (let sti = 0; sti < strainTests.length; sti++) {
        if (strainTests[sti].OverallPassed) passed++
      }
      passRate = passed / strainTests.length
    }

    if (isBestYield && passRate > 0.9) {
      recommendations.push({
        strainName: trend.strainName,
        severity: 'success',
        title: `Top Performer: ${trend.strainName}`,
        description: `Highest yield efficiency with ${(passRate * 100).toFixed(0)}% lab pass rate.`,
        metric: `${trend.avgYieldEfficiency.toFixed(1)} yield, ${(passRate * 100).toFixed(0)}% pass`,
      })
      break
    }
  }

  return recommendations
}

// ---------------------------------------------------------------------------
// 3. analyzeGeneticCorrelations
// ---------------------------------------------------------------------------

export function analyzeGeneticCorrelations(
  harvests: MetrcHarvest[],
  strains: MetrcStrain[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  labTests: MetrcLabTest[],
): GeneticGroupSummary[] {
  // Build strain lookup by name (case-insensitive, trimmed)
  const strainLookup = new Map<string, MetrcStrain>()
  for (let si = 0; si < strains.length; si++) {
    strainLookup.set(strains[si].Name.toLowerCase().trim(), strains[si])
  }

  // Compute yield per strain from harvests
  const yieldByStrain = new Map<string, { totalYield: number; harvestCount: number }>()
  for (let hi = 0; hi < harvests.length; hi++) {
    const harvest = harvests[hi]
    if (!harvest.SourceStrainNames) continue
    const names = harvest.SourceStrainNames.split(',').map(function (s: string) { return s.trim() }).filter(Boolean)
    const totalWeight = harvest.CurrentWeight + harvest.TotalPackagedWeight
    const weightPerStrain = names.length > 1 ? totalWeight / names.length : totalWeight
    for (let ni = 0; ni < names.length; ni++) {
      const existing = yieldByStrain.get(names[ni]) ?? { totalYield: 0, harvestCount: 0 }
      existing.totalYield += weightPerStrain
      existing.harvestCount += 1
      yieldByStrain.set(names[ni], existing)
    }
  }

  // Compute growth days per strain
  const growthByStrain = new Map<string, number[]>()
  for (let hi = 0; hi < harvests.length; hi++) {
    const harvest = harvests[hi]
    if (!harvest.FinishedDate || !harvest.SourceStrainNames) continue
    const days = daysBetween(harvest.HarvestStartDate, harvest.FinishedDate)
    if (days <= 0) continue
    const names = harvest.SourceStrainNames.split(',').map(function (s: string) { return s.trim() }).filter(Boolean)
    for (let ni = 0; ni < names.length; ni++) {
      const list = growthByStrain.get(names[ni]) ?? []
      list.push(days)
      growthByStrain.set(names[ni], list)
    }
  }

  // Collect all strain names
  const allStrainNames: string[] = []
  const yieldEntries = Array.from(yieldByStrain.keys())
  for (let yi = 0; yi < yieldEntries.length; yi++) {
    allStrainNames.push(yieldEntries[yi])
  }

  const details: StrainDetail[] = []
  for (let sni = 0; sni < allStrainNames.length; sni++) {
    const strainName = allStrainNames[sni]
    const strainInfo = strainLookup.get(strainName.toLowerCase().trim())

    let geneticType = 'Unknown'
    let indicaPct = 0
    let thcAvg = 0
    if (strainInfo) {
      indicaPct = strainInfo.IndicaPercentage
      thcAvg = strainInfo.ThcLevel
      if (strainInfo.IndicaPercentage > 60) geneticType = 'Indica'
      else if (strainInfo.SativaPercentage > 60) geneticType = 'Sativa'
      else geneticType = 'Hybrid'
    }

    const yieldData = yieldByStrain.get(strainName) ?? { totalYield: 0, harvestCount: 0 }
    const yieldEfficiency = yieldData.harvestCount > 0
      ? Math.round((yieldData.totalYield / yieldData.harvestCount) * 100) / 100
      : 0

    const growthDaysList = growthByStrain.get(strainName) ?? []
    let growthDays = 0
    if (growthDaysList.length > 0) {
      let sum = 0
      for (let gi = 0; gi < growthDaysList.length; gi++) sum += growthDaysList[gi]
      growthDays = Math.round(sum / growthDaysList.length)
    }

    const labPassRate = 0

    details.push({
      strainName,
      geneticType,
      yieldEfficiency,
      labPassRate,
      growthDays,
      harvestCount: yieldData.harvestCount,
      indicaPct,
      thcAvg,
    })
  }

  // Group by genetic type
  const groups = new Map<string, StrainDetail[]>()
  for (let di = 0; di < details.length; di++) {
    const detail = details[di]
    const list = groups.get(detail.geneticType) ?? []
    list.push(detail)
    groups.set(detail.geneticType, list)
  }

  const summaries: GeneticGroupSummary[] = []
  const typeOrder = ['Indica', 'Sativa', 'Hybrid', 'Unknown']
  for (let toi = 0; toi < typeOrder.length; toi++) {
    const type = typeOrder[toi]
    const groupStrains = groups.get(type)
    if (!groupStrains || groupStrains.length === 0) continue

    let yieldSum = 0
    let passRateSum = 0
    for (let gsi = 0; gsi < groupStrains.length; gsi++) {
      yieldSum += groupStrains[gsi].yieldEfficiency
      passRateSum += groupStrains[gsi].labPassRate
    }
    const avgYieldEfficiency = yieldSum / groupStrains.length
    const avgLabPassRate = passRateSum / groupStrains.length

    const strainsWithGrowth = groupStrains.filter(function (d: StrainDetail) { return d.growthDays > 0 })
    let growthSum = 0
    for (let gwi = 0; gwi < strainsWithGrowth.length; gwi++) {
      growthSum += strainsWithGrowth[gwi].growthDays
    }
    const avgGrowthDays = strainsWithGrowth.length > 0 ? growthSum / strainsWithGrowth.length : 0

    summaries.push({
      geneticType: type,
      strainCount: groupStrains.length,
      avgYieldEfficiency: Math.round(avgYieldEfficiency * 100) / 100,
      avgLabPassRate: Math.round(avgLabPassRate * 1000) / 1000,
      avgGrowthDays: Math.round(avgGrowthDays),
      strains: groupStrains.map(function (d: StrainDetail) {
        return {
          strainName: d.strainName,
          yieldEfficiency: d.yieldEfficiency,
          labPassRate: d.labPassRate,
          growthDays: d.growthDays,
          harvestCount: d.harvestCount,
          indicaPct: d.indicaPct,
          thcAvg: d.thcAvg,
        }
      }),
    })
  }

  return summaries
}

// ---------------------------------------------------------------------------
// 4. analyzeGrowthDurations
// ---------------------------------------------------------------------------

export function analyzeGrowthDurations(
  harvests: MetrcHarvest[],
): { durations: GrowthDurationEntry[]; facilityAvg: number } {
  // Only finished harvests
  const finished: MetrcHarvest[] = []
  for (let fi = 0; fi < harvests.length; fi++) {
    if (harvests[fi].FinishedDate !== null) finished.push(harvests[fi])
  }

  // Group by strain
  const strainDurations = new Map<string, DurationEntry[]>()
  for (let fi = 0; fi < finished.length; fi++) {
    const harvest = finished[fi]
    if (!harvest.SourceStrainNames || !harvest.FinishedDate) continue
    const days = daysBetween(harvest.HarvestStartDate, harvest.FinishedDate)
    if (days <= 0) continue

    const names = harvest.SourceStrainNames.split(',').map(function (s: string) { return s.trim() }).filter(Boolean)
    for (let ni = 0; ni < names.length; ni++) {
      const list = strainDurations.get(names[ni]) ?? []
      list.push({ days, date: harvest.HarvestStartDate })
      strainDurations.set(names[ni], list)
    }
  }

  const durations: GrowthDurationEntry[] = []
  let totalDaysAll = 0
  let totalCountAll = 0

  const durationEntries = Array.from(strainDurations.entries())
  for (let dei = 0; dei < durationEntries.length; dei++) {
    const strainName = durationEntries[dei][0]
    const entries = durationEntries[dei][1]
    const dayValues: number[] = []
    for (let evi = 0; evi < entries.length; evi++) {
      dayValues.push(entries[evi].days)
    }

    let daySum = 0
    for (let dsi = 0; dsi < dayValues.length; dsi++) daySum += dayValues[dsi]
    const avgDays = daySum / dayValues.length
    const minDays = Math.min.apply(null, dayValues)
    const maxDays = Math.max.apply(null, dayValues)

    totalDaysAll += daySum
    totalCountAll += dayValues.length

    // Trend: sort entries by date, split in half
    let trend: 'faster' | 'slower' | 'stable' | 'insufficient_data' = 'insufficient_data'
    if (entries.length >= 2) {
      const sorted = entries.slice().sort(function (a: DurationEntry, b: DurationEntry) { return a.date.localeCompare(b.date) })
      const mid = Math.floor(sorted.length / 2)
      const firstHalf = sorted.slice(0, mid)
      const secondHalf = sorted.slice(mid)
      let firstSum = 0
      for (let fhi = 0; fhi < firstHalf.length; fhi++) firstSum += firstHalf[fhi].days
      let secondSum = 0
      for (let shi = 0; shi < secondHalf.length; shi++) secondSum += secondHalf[shi].days
      const firstAvg = firstSum / firstHalf.length
      const secondAvg = secondSum / secondHalf.length
      if (firstAvg > 0) {
        const change = (secondAvg - firstAvg) / firstAvg
        if (change < -0.1) trend = 'faster'
        else if (change > 0.1) trend = 'slower'
        else trend = 'stable'
      } else {
        trend = 'stable'
      }
    }

    durations.push({
      strainName,
      avgDays: Math.round(avgDays),
      minDays,
      maxDays,
      harvestCount: dayValues.length,
      trend,
    })
  }

  // Sort by avgDays ascending
  durations.sort(function (a: GrowthDurationEntry, b: GrowthDurationEntry) { return a.avgDays - b.avgDays })

  const facilityAvg = totalCountAll > 0 ? Math.round(totalDaysAll / totalCountAll) : 0

  return { durations, facilityAvg }
}

// ---------------------------------------------------------------------------
// 5. analyzeStrainIntelligence (master function)
// ---------------------------------------------------------------------------

export function analyzeStrainIntelligence(
  harvests: MetrcHarvest[],
  strains: MetrcStrain[],
  labTests: MetrcLabTest[],
  packages: MetrcPackage[],
  plants: MetrcPlant[],
): StrainIntelligenceResult {
  const { trends: yieldTrends, overallTrend, warnings: yieldWarnings } = analyzeYieldTrends(harvests)
  const recommendations = generateRecommendations(harvests, strains, labTests, packages, plants)
  const geneticCorrelations = analyzeGeneticCorrelations(harvests, strains, labTests)
  const { durations: growthDurations, facilityAvg: facilityAvgGrowthDays } = analyzeGrowthDurations(harvests)

  return {
    yieldTrends,
    overallTrend,
    recommendations,
    geneticCorrelations,
    growthDurations,
    facilityAvgGrowthDays,
    warnings: yieldWarnings,
  }
}
