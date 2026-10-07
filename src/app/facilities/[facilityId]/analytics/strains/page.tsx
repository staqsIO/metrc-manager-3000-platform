'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/shared/components/ui/table'
import { FlaskConical, ArrowUpDown, Package, BarChart3, Dna, Timer, ChevronDown, ChevronUp, GitCompare } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StrainPerf {
  strainName: string
  packageCount: number
  totalQuantity: number
  unitOfMeasure: string
  averageQuantity: number
  averageAgeDays: number
  categories: string[]
  labTestCount: number
  labTestPassRate: number
  avgTestResultLevel: number
  locations: string[]
  onHoldCount: number
  remediationCount: number
}
interface StrainData {
  strains: StrainPerf[]
  totalStrains: number
  topByQuantity: { strainName: string; totalQuantity: number }[]
  topByPassRate: { strainName: string; passRate: number; testCount: number }[]
  topByPackageCount: { strainName: string; count: number }[]
}

interface GeneticStrainDetail {
  strainName: string
  yieldEfficiency: number
  labPassRate: number
  growthDays: number
  harvestCount: number
  indicaPct: number
  thcAvg: number
}
interface GeneticGroup {
  geneticType: string
  strainCount: number
  avgYieldEfficiency: number
  avgLabPassRate: number
  avgGrowthDays: number
  strains: GeneticStrainDetail[]
}
interface GrowthDuration {
  strainName: string
  avgDays: number
  minDays: number
  maxDays: number
  harvestCount: number
  trend: 'faster' | 'slower' | 'stable' | 'insufficient_data'
}
interface StrainIntelligenceData {
  geneticCorrelations: GeneticGroup[]
  growthDurations: GrowthDuration[]
  facilityAvgGrowthDays: number
  warnings: string[]
}

interface CrossFacilityStrainFacilityMetrics {
  facilityId: string
  facilityName: string
  stateCode: string
  avgYieldEfficiency: number
  labPassRate: number
  avgGrowthDays: number
  harvestCount: number
}
interface CrossFacilityStrainEntry {
  normalizedName: string
  displayName: string
  facilities: CrossFacilityStrainFacilityMetrics[]
  crossFacilityAvg: {
    yieldEfficiency: number
    labPassRate: number
    growthDays: number
  }
}
interface CrossFacilitySignificantDifference {
  strainName: string
  metric: 'yieldEfficiency' | 'labPassRate' | 'growthDays'
  facilityId: string
  facilityName: string
  value: number
  crossFacilityAvg: number
  deltaPct: number
}
interface CrossFacilityStrainComparison {
  strains: CrossFacilityStrainEntry[]
  facilities: { id: string; name: string; stateCode: string }[]
  significantDifferences: CrossFacilitySignificantDifference[]
  warnings: string[]
}

type SortKey = 'strainName' | 'packageCount' | 'totalQuantity' | 'averageAgeDays' | 'labTestPassRate' | 'avgTestResultLevel'

export default function StrainAnalysisPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const [sortKey, setSortKey] = useState<SortKey>('totalQuantity')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showGeneticDetail, setShowGeneticDetail] = useState(false)
  const [showCrossFacility, setShowCrossFacility] = useState(false)

  const { data: raw, isLoading } = trpc.analytics.strainPerformance.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )
  const { data: rawIntelligence, isLoading: intelligenceLoading } = trpc.analytics.strainIntelligence.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )

  const { data: rawCrossFacility, isLoading: crossFacilityLoading } = trpc.crossFacility.crossFacilityStrainComparison.useQuery(
    undefined,
    { enabled: showCrossFacility, staleTime: 300_000 },
  )

  const data = raw as unknown as StrainData | undefined
  const intelligence = rawIntelligence as unknown as StrainIntelligenceData | undefined
  const crossFacilityData = rawCrossFacility as unknown as CrossFacilityStrainComparison | undefined

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...(data?.strains ?? [])].sort((a, b) => {
    const aVal = a[sortKey]
    const bVal = b[sortKey]
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number)
  })

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <button onClick={() => handleSort(field)} className="flex items-center gap-1 hover:text-foreground transition-colors">
      {label}
      <ArrowUpDown className={cn('h-3 w-3', sortKey === field ? 'text-foreground' : 'text-muted-foreground/50')} />
    </button>
  )

  const passRateBadge = (rate: number, testCount: number) => {
    if (testCount === 0) return <span className="text-xs text-muted-foreground">No tests</span>
    const pct = (rate * 100).toFixed(0)
    return (
      <Badge
        variant="outline"
        className={cn(
          'text-xs',
          rate >= 0.9 && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
          rate >= 0.7 && rate < 0.9 && 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
          rate < 0.7 && 'bg-red-500/10 text-red-500 border-red-500/20',
        )}
      >
        {pct}%
      </Badge>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Strain Analysis</h1>
        <p className="text-muted-foreground mt-1">Strain performance comparison</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-2">
            <FlaskConical className="h-4 w-4 text-purple-500" />
            <span className="text-xs text-muted-foreground">Total Strains</span>
          </div>
          {isLoading ? <Skeleton className="h-7 w-12" /> : <div className="text-xl font-bold">{data?.totalStrains ?? 0}</div>}
        </div>
      </div>

      {/* Top Lists */}
      {!isLoading && data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Top by Quantity */}
          <div className="card-modern p-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <Package className="h-4 w-4 text-blue-500" />
              Top by Quantity
            </h3>
            <div className="space-y-2">
              {data.topByQuantity.map((s, i) => (
                <div key={s.strainName} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-xs font-bold w-5 text-center',
                      i === 0 && 'text-yellow-500',
                      i === 1 && 'text-gray-400',
                      i === 2 && 'text-orange-600',
                    )}>#{i + 1}</span>
                    <span className="text-sm">{s.strainName}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{Math.round(s.totalQuantity).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top by Pass Rate */}
          <div className="card-modern p-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-emerald-500" />
              Top by Pass Rate
            </h3>
            <div className="space-y-2">
              {data.topByPassRate.map((s, i) => (
                <div key={s.strainName} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-xs font-bold w-5 text-center',
                      i === 0 && 'text-yellow-500',
                      i === 1 && 'text-gray-400',
                      i === 2 && 'text-orange-600',
                    )}>#{i + 1}</span>
                    <span className="text-sm">{s.strainName}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{(s.passRate * 100).toFixed(0)}% ({s.testCount})</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top by Package Count */}
          <div className="card-modern p-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-500" />
              Top by Package Count
            </h3>
            <div className="space-y-2">
              {data.topByPackageCount.map((s, i) => (
                <div key={s.strainName} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-xs font-bold w-5 text-center',
                      i === 0 && 'text-yellow-500',
                      i === 1 && 'text-gray-400',
                      i === 2 && 'text-orange-600',
                    )}>#{i + 1}</span>
                    <span className="text-sm">{s.strainName}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Full Strain Table */}
      <div className="card-modern">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold">All Strains</h2>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><SortHeader label="Strain" field="strainName" /></TableHead>
                  <TableHead className="text-right"><SortHeader label="Packages" field="packageCount" /></TableHead>
                  <TableHead className="text-right"><SortHeader label="Total Qty" field="totalQuantity" /></TableHead>
                  <TableHead className="text-right"><SortHeader label="Avg Age" field="averageAgeDays" /></TableHead>
                  <TableHead className="text-right">Lab Tests</TableHead>
                  <TableHead className="text-right"><SortHeader label="Pass Rate" field="labTestPassRate" /></TableHead>
                  <TableHead className="text-right"><SortHeader label="Avg Potency" field="avgTestResultLevel" /></TableHead>
                  <TableHead>Categories</TableHead>
                  <TableHead className="text-right">Hold</TableHead>
                  <TableHead className="text-right">Remed.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(s => (
                  <TableRow key={s.strainName}>
                    <TableCell className="font-medium">{s.strainName}</TableCell>
                    <TableCell className="text-right">{s.packageCount}</TableCell>
                    <TableCell className="text-right">{Math.round(s.totalQuantity).toLocaleString()}</TableCell>
                    <TableCell className="text-right">{Math.round(s.averageAgeDays)}d</TableCell>
                    <TableCell className="text-right">{s.labTestCount}</TableCell>
                    <TableCell className="text-right">{passRateBadge(s.labTestPassRate, s.labTestCount)}</TableCell>
                    <TableCell className="text-right">
                      {s.labTestCount > 0 ? `${s.avgTestResultLevel.toFixed(1)}%` : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {s.categories.slice(0, 3).map(c => (
                          <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                        ))}
                        {s.categories.length > 3 && (
                          <Badge variant="outline" className="text-xs">+{s.categories.length - 3}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {s.onHoldCount > 0 ? (
                        <span className="text-red-500 font-medium">{s.onHoldCount}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.remediationCount > 0 ? (
                        <span className="text-orange-500 font-medium">{s.remediationCount}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Genetic-Yield Correlation */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Dna className="h-5 w-5 text-purple-500" />
          Genetic-Yield Correlation
        </h2>
        {intelligenceLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : intelligence && intelligence.geneticCorrelations.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              {intelligence.geneticCorrelations.map(group => (
                <div key={group.geneticType} className="card-modern p-4">
                  <div className="font-semibold text-sm mb-2">{group.geneticType}</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Strains</span>
                      <span className="font-medium">{group.strainCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Avg Yield</span>
                      <span className="font-medium">{group.avgYieldEfficiency.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pass Rate</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs',
                          group.avgLabPassRate >= 0.9 && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                          group.avgLabPassRate >= 0.7 && group.avgLabPassRate < 0.9 && 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
                          group.avgLabPassRate < 0.7 && 'bg-red-500/10 text-red-500 border-red-500/20',
                        )}
                      >
                        {(group.avgLabPassRate * 100).toFixed(0)}%
                      </Badge>
                    </div>
                    {group.avgGrowthDays > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Avg Growth</span>
                        <span className="font-medium">{group.avgGrowthDays}d</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowGeneticDetail(v => !v)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
            >
              {showGeneticDetail ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Hide detailed comparison
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Show detailed comparison
                </>
              )}
            </button>
            {showGeneticDetail && (
              <div className="card-modern mt-3">
                <div className="overflow-x-auto" role="region" aria-label="Genetic yield correlation details">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Strain</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Yield Efficiency</TableHead>
                        <TableHead className="text-right">Pass Rate</TableHead>
                        <TableHead className="text-right hidden lg:table-cell">Growth Days</TableHead>
                        <TableHead className="text-right">Harvests</TableHead>
                        <TableHead className="text-right hidden lg:table-cell">Indica%</TableHead>
                        <TableHead className="text-right hidden lg:table-cell">THC Avg</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {intelligence.geneticCorrelations.flatMap(group =>
                        group.strains.map(s => (
                          <TableRow key={`${group.geneticType}-${s.strainName}`}>
                            <TableCell className="font-medium">{s.strainName}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{group.geneticType}</Badge>
                            </TableCell>
                            <TableCell className="text-right">{s.yieldEfficiency.toFixed(1)}</TableCell>
                            <TableCell className="text-right">
                              {s.labPassRate > 0 ? `${(s.labPassRate * 100).toFixed(0)}%` : '—'}
                            </TableCell>
                            <TableCell className="text-right hidden lg:table-cell">
                              {s.growthDays > 0 ? `${s.growthDays}d` : '—'}
                            </TableCell>
                            <TableCell className="text-right">{s.harvestCount}</TableCell>
                            <TableCell className="text-right hidden lg:table-cell">
                              {s.indicaPct > 0 ? `${s.indicaPct}%` : '—'}
                            </TableCell>
                            <TableCell className="text-right hidden lg:table-cell">
                              {s.thcAvg > 0 ? `${s.thcAvg.toFixed(1)}%` : '—'}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </>
        ) : !intelligenceLoading ? (
          <div className="card-modern p-6 text-center text-sm text-muted-foreground">
            No genetic correlation data available
          </div>
        ) : null}
      </div>

      {/* Growth Duration */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Timer className="h-5 w-5 text-cyan-500" />
          Growth Duration
        </h2>
        {intelligenceLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : intelligence && intelligence.growthDurations.length > 0 ? (
          <>
            <div className="card-modern p-4 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <Timer className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Facility Average Growth</span>
              </div>
              <div className="text-xl font-bold">{intelligence.facilityAvgGrowthDays}d</div>
            </div>
            <div className="card-modern">
              <div className="overflow-x-auto" role="region" aria-label="Growth duration by strain">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Strain</TableHead>
                      <TableHead className="text-right">Avg Days</TableHead>
                      <TableHead className="text-right">Min Days</TableHead>
                      <TableHead className="text-right">Max Days</TableHead>
                      <TableHead className="text-right">Harvests</TableHead>
                      <TableHead>Trend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {intelligence.growthDurations.map(entry => (
                      <TableRow key={entry.strainName}>
                        <TableCell className="font-medium">{entry.strainName}</TableCell>
                        <TableCell className="text-right">{entry.avgDays}d</TableCell>
                        <TableCell className="text-right">{entry.minDays}d</TableCell>
                        <TableCell className="text-right">{entry.maxDays}d</TableCell>
                        <TableCell className="text-right">{entry.harvestCount}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-xs',
                              entry.trend === 'faster' && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                              entry.trend === 'slower' && 'bg-red-500/10 text-red-500 border-red-500/20',
                              entry.trend === 'stable' && 'bg-muted text-muted-foreground border-border',
                              entry.trend === 'insufficient_data' && 'bg-muted text-muted-foreground border-border',
                            )}
                          >
                            {entry.trend === 'insufficient_data' ? 'insufficient data' : entry.trend}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        ) : !intelligenceLoading ? (
          <div className="card-modern p-6 text-center text-sm text-muted-foreground">
            No growth duration data available (requires finished harvests)
          </div>
        ) : null}
      </div>

      {/* Cross-Facility Strain Comparison */}
      <div className="mt-8">
        <button
          onClick={() => setShowCrossFacility(v => !v)}
          className="flex items-center gap-2 text-lg font-semibold hover:text-foreground transition-colors py-2"
        >
          <GitCompare className="h-5 w-5 text-indigo-500" />
          Cross-Facility Comparison
          {showCrossFacility ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <p className="text-xs text-muted-foreground mb-3">
          Compare strain yield, lab pass rate, and growth duration across all your facilities
        </p>

        {showCrossFacility && (
          <>
            {crossFacilityLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : crossFacilityData && crossFacilityData.strains.length > 0 ? (
              <>
                {/* Warnings */}
                {crossFacilityData.warnings.length > 0 && (
                  <div className="card-modern p-3 mb-4 border-yellow-500/20 bg-yellow-500/5">
                    <div className="text-sm text-yellow-500">
                      {crossFacilityData.warnings.map((w, i) => (
                        <div key={i}>{w}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Significant Differences Summary */}
                {crossFacilityData.significantDifferences.length > 0 && (
                  <div className="card-modern p-4 mb-4">
                    <h3 className="font-semibold text-sm mb-3">Significant Differences</h3>
                    <div className="space-y-2">
                      {crossFacilityData.significantDifferences.slice(0, 10).map((diff, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{diff.strainName}</span>
                            <Badge variant="outline" className="text-xs">
                              {diff.metric === 'yieldEfficiency' ? 'Yield' : diff.metric === 'labPassRate' ? 'Pass Rate' : 'Growth'}
                            </Badge>
                            <span className="text-muted-foreground">at {diff.facilityName}</span>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-xs',
                              diff.deltaPct > 0 && diff.metric !== 'growthDays' && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                              diff.deltaPct < 0 && diff.metric !== 'growthDays' && 'bg-red-500/10 text-red-500 border-red-500/20',
                              diff.deltaPct > 0 && diff.metric === 'growthDays' && 'bg-red-500/10 text-red-500 border-red-500/20',
                              diff.deltaPct < 0 && diff.metric === 'growthDays' && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                            )}
                          >
                            {diff.deltaPct > 0 ? '+' : ''}{diff.deltaPct.toFixed(1)}%
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Comparison Table */}
                <div className="card-modern">
                  <div className="overflow-x-auto" role="region" aria-label="Cross-facility strain comparison">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky left-0 bg-background z-10">Strain</TableHead>
                          {crossFacilityData.facilities.map(fac => (
                            <TableHead key={fac.id} colSpan={3} className="text-center border-l border-border">
                              <div className="flex flex-col items-center">
                                <span className={cn(
                                  'font-medium',
                                  fac.id === facilityId && 'text-indigo-500',
                                )}>
                                  {fac.name}
                                </span>
                                <span className="text-xs text-muted-foreground">{fac.stateCode}</span>
                              </div>
                            </TableHead>
                          ))}
                          <TableHead colSpan={3} className="text-center border-l border-border">
                            <span className="text-muted-foreground">Cross-Facility Avg</span>
                          </TableHead>
                        </TableRow>
                        <TableRow>
                          <TableHead className="sticky left-0 bg-background z-10" />
                          {crossFacilityData.facilities.map(fac => (
                            <CrossFacilitySubHeaders key={fac.id} />
                          ))}
                          <CrossFacilitySubHeaders />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {crossFacilityData.strains.map(strain => {
                          // Build a lookup for this strain's per-facility data
                          const facLookup = new Map<string, CrossFacilityStrainFacilityMetrics>();
                          for (let fi = 0; fi < strain.facilities.length; fi++) {
                            facLookup.set(strain.facilities[fi].facilityId, strain.facilities[fi]);
                          }

                          // Build a Set of significant diff keys for highlighting
                          const sigKeys = new Set<string>();
                          for (let di = 0; di < crossFacilityData.significantDifferences.length; di++) {
                            const d = crossFacilityData.significantDifferences[di];
                            if (d.strainName === strain.displayName) {
                              sigKeys.add(`${d.facilityId}-${d.metric}`);
                            }
                          }

                          return (
                            <TableRow key={strain.normalizedName}>
                              <TableCell className="font-medium sticky left-0 bg-background z-10">
                                {strain.displayName}
                              </TableCell>
                              {crossFacilityData.facilities.map(fac => {
                                const m = facLookup.get(fac.id);
                                if (!m) {
                                  return (
                                    <CrossFacilityEmptyCells key={fac.id} />
                                  );
                                }
                                return (
                                  <CrossFacilityMetricCells
                                    key={fac.id}
                                    metrics={m}
                                    avg={strain.crossFacilityAvg}
                                    sigKeys={sigKeys}
                                    isCurrentFacility={fac.id === facilityId}
                                  />
                                );
                              })}
                              {/* Cross-facility average */}
                              <TableCell className="text-right border-l border-border text-muted-foreground">
                                {strain.crossFacilityAvg.yieldEfficiency.toFixed(1)}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {strain.crossFacilityAvg.labPassRate > 0
                                  ? `${(strain.crossFacilityAvg.labPassRate * 100).toFixed(0)}%`
                                  : '\u2014'}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {strain.crossFacilityAvg.growthDays > 0
                                  ? `${strain.crossFacilityAvg.growthDays}d`
                                  : '\u2014'}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            ) : !crossFacilityLoading ? (
              <div className="card-modern p-6 text-center text-sm text-muted-foreground">
                {crossFacilityData?.warnings && crossFacilityData.warnings.length > 0
                  ? crossFacilityData.warnings[0]
                  : 'No cross-facility strain data available. Requires 2+ facilities with shared strains.'}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cross-Facility Table Sub-components
// ---------------------------------------------------------------------------

function CrossFacilitySubHeaders() {
  return (
    <>
      <TableHead className="text-right border-l border-border text-xs">Yield</TableHead>
      <TableHead className="text-right text-xs">Pass%</TableHead>
      <TableHead className="text-right text-xs">Days</TableHead>
    </>
  )
}

function CrossFacilityEmptyCells() {
  return (
    <>
      <TableCell className="text-right border-l border-border text-muted-foreground">{'\u2014'}</TableCell>
      <TableCell className="text-right text-muted-foreground">{'\u2014'}</TableCell>
      <TableCell className="text-right text-muted-foreground">{'\u2014'}</TableCell>
    </>
  )
}

function CrossFacilityMetricCells({
  metrics,
  avg,
  sigKeys,
  isCurrentFacility,
}: {
  metrics: CrossFacilityStrainFacilityMetrics
  avg: { yieldEfficiency: number; labPassRate: number; growthDays: number }
  sigKeys: Set<string>
  isCurrentFacility: boolean
}) {
  const yieldSig = sigKeys.has(`${metrics.facilityId}-yieldEfficiency`)
  const passSig = sigKeys.has(`${metrics.facilityId}-labPassRate`)
  const growthSig = sigKeys.has(`${metrics.facilityId}-growthDays`)

  const yieldDelta = avg.yieldEfficiency > 0 ? (metrics.avgYieldEfficiency - avg.yieldEfficiency) / avg.yieldEfficiency : 0
  const passDelta = avg.labPassRate > 0 ? (metrics.labPassRate - avg.labPassRate) / avg.labPassRate : 0
  const growthDelta = avg.growthDays > 0 ? (metrics.avgGrowthDays - avg.growthDays) / avg.growthDays : 0

  return (
    <>
      <TableCell className={cn(
        'text-right border-l border-border',
        isCurrentFacility && 'bg-indigo-500/5',
        yieldSig && yieldDelta > 0 && 'text-emerald-500 font-medium',
        yieldSig && yieldDelta < 0 && 'text-red-500 font-medium',
      )}>
        {metrics.avgYieldEfficiency.toFixed(1)}
      </TableCell>
      <TableCell className={cn(
        'text-right',
        isCurrentFacility && 'bg-indigo-500/5',
        passSig && passDelta > 0 && 'text-emerald-500 font-medium',
        passSig && passDelta < 0 && 'text-red-500 font-medium',
      )}>
        {metrics.labPassRate > 0 ? `${(metrics.labPassRate * 100).toFixed(0)}%` : '\u2014'}
      </TableCell>
      <TableCell className={cn(
        'text-right',
        isCurrentFacility && 'bg-indigo-500/5',
        growthSig && growthDelta < 0 && 'text-emerald-500 font-medium',
        growthSig && growthDelta > 0 && 'text-red-500 font-medium',
      )}>
        {metrics.avgGrowthDays > 0 ? `${metrics.avgGrowthDays}d` : '\u2014'}
      </TableCell>
    </>
  )
}
