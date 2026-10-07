'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/shared/components/ui/table'
import { TrendingUp, Sprout, Package, AlertTriangle, ArrowUpDown, Trophy, Lightbulb, Info, XCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StrainYieldItem {
  strainName: string
  totalPlants: number
  growthPhases: Record<string, number>
  totalPackageQuantity: number
  packageCount: number
  averageQuantityPerPackage: number
  unitOfMeasure: string
  estimatedYieldPerPlant: number
  categories: { category: string; quantity: number; count: number }[]
}
interface YieldData {
  strains: StrainYieldItem[]
  topYieldingStrains: { strainName: string; estimatedYieldPerPlant: number }[]
  totalPlants: number
  totalPackages: number
  overallAverageYieldPerPlant: number
}
interface LossCategoryItem { category: string; lossCount: number; totalCount: number; lossPercentage: number }
interface LossData {
  zeroQuantityPackages: number
  nearZeroPackages: number
  failedTestingPackages: number
  onHoldPackages: number
  remediationRequired: number
  totalLossPackages: number
  lossPercentage: number
  byCategory: LossCategoryItem[]
}

interface IntelligenceYieldTrendPoint {
  period: string
  harvestCount: number
  totalWeight: number
  avgYieldEfficiency: number
  isEstimate: boolean
}
interface IntelligenceStrainYieldTrend {
  strainName: string
  dataPoints: IntelligenceYieldTrendPoint[]
  overallTrend: 'improving' | 'declining' | 'stable' | 'insufficient_data'
  avgYieldEfficiency: number
}
interface IntelligenceRecommendation {
  strainName: string
  severity: 'info' | 'warning' | 'critical' | 'success'
  title: string
  description: string
  metric?: string
}
interface IntelligenceData {
  yieldTrends: IntelligenceStrainYieldTrend[]
  overallTrend: 'improving' | 'declining' | 'stable' | 'insufficient_data'
  recommendations: IntelligenceRecommendation[]
  warnings: string[]
}

type SortKey = 'strainName' | 'totalPlants' | 'totalPackageQuantity' | 'estimatedYieldPerPlant' | 'packageCount'

export default function YieldTrackingPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const [sortKey, setSortKey] = useState<SortKey>('estimatedYieldPerPlant')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showAllTrends, setShowAllTrends] = useState(false)

  const { data: rawYield, isLoading: yieldLoading } = trpc.analytics.yieldMetrics.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )
  const { data: rawLoss, isLoading: lossLoading } = trpc.analytics.lossAnalysis.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )
  const { data: rawIntelligence, isLoading: intelligenceLoading } = trpc.analytics.strainIntelligence.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )

  const yieldData = rawYield as unknown as YieldData | undefined
  const lossData = rawLoss as unknown as LossData | undefined
  const intelligence = rawIntelligence as unknown as IntelligenceData | undefined
  const isLoading = yieldLoading || lossLoading

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortedStrains = [...(yieldData?.strains ?? [])].sort((a, b) => {
    const aVal = a[sortKey]
    const bVal = b[sortKey]
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number)
  })

  const summaryCards = [
    { label: 'Total Plants', value: yieldData?.totalPlants ?? 0, icon: Sprout, color: 'text-emerald-500' },
    { label: 'Weight Packages', value: yieldData?.totalPackages ?? 0, icon: Package, color: 'text-blue-500' },
    { label: 'Avg Yield/Plant', value: `${Math.round(yieldData?.overallAverageYieldPerPlant ?? 0)}g`, icon: TrendingUp, color: 'text-cyan-500' },
    { label: 'Loss Rate', value: `${(lossData?.lossPercentage ?? 0).toFixed(1)}%`, icon: AlertTriangle, color: (lossData?.lossPercentage ?? 0) > 10 ? 'text-red-500' : 'text-yellow-500' },
  ]

  const lossCards = [
    { label: 'Zero Qty', value: lossData?.zeroQuantityPackages ?? 0 },
    { label: 'Near-Zero', value: lossData?.nearZeroPackages ?? 0 },
    { label: 'Failed Testing', value: lossData?.failedTestingPackages ?? 0 },
    { label: 'On Hold', value: lossData?.onHoldPackages ?? 0 },
    { label: 'Remediation', value: lossData?.remediationRequired ?? 0 },
  ]

  const SortableHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <button onClick={() => handleSort(field)} className="flex items-center gap-1 hover:text-foreground transition-colors">
      {label}
      <ArrowUpDown className={cn('h-3 w-3', sortKey === field ? 'text-foreground' : 'text-muted-foreground/50')} />
    </button>
  )

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Yield Tracking</h1>
        <p className="text-muted-foreground mt-1">Stage-by-stage yield analysis</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {summaryCards.map(c => (
          <div key={c.label} className="card-modern p-4">
            <div className="flex items-center gap-2 mb-2">
              <c.icon className={cn('h-4 w-4', c.color)} />
              <span className="text-xs text-muted-foreground">{c.label}</span>
            </div>
            {isLoading ? <Skeleton className="h-7 w-20" /> : <div className="text-xl font-bold">{c.value}</div>}
          </div>
        ))}
      </div>

      {/* Top Yielding Strains */}
      {!yieldLoading && yieldData && yieldData.topYieldingStrains.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Top Yielding Strains
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {yieldData.topYieldingStrains.map((s, i) => (
              <div key={s.strainName} className="card-modern p-4 flex items-center gap-3">
                <div className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold',
                  i === 0 && 'bg-yellow-500/20 text-yellow-500',
                  i === 1 && 'bg-gray-400/20 text-gray-400',
                  i === 2 && 'bg-orange-600/20 text-orange-600',
                  i > 2 && 'bg-muted text-muted-foreground',
                )}>
                  #{i + 1}
                </div>
                <div>
                  <div className="font-medium text-sm">{s.strainName}</div>
                  <div className="text-xs text-muted-foreground">{Math.round(s.estimatedYieldPerPlant)}g/plant</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Yield Trends */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-cyan-500" />
          Yield Trends
          {intelligence?.overallTrend && intelligence.overallTrend !== 'insufficient_data' && (
            <Badge
              variant="outline"
              className={cn(
                'text-xs ml-2',
                intelligence.overallTrend === 'improving' && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                intelligence.overallTrend === 'declining' && 'bg-red-500/10 text-red-500 border-red-500/20',
                intelligence.overallTrend === 'stable' && 'bg-muted text-muted-foreground border-border',
              )}
            >
              {intelligence.overallTrend}
            </Badge>
          )}
        </h2>
        {intelligenceLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : intelligence && intelligence.yieldTrends.length > 0 ? (
          <>
            {(() => {
              const visibleTrends = showAllTrends
                ? intelligence.yieldTrends
                : intelligence.yieldTrends.slice(0, 5)
              const maxYield = Math.max(...intelligence.yieldTrends.map(t => t.avgYieldEfficiency), 1)
              return (
                <div className="space-y-3">
                  {visibleTrends.map(trend => (
                    <div key={trend.strainName} className="card-modern p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{trend.strainName}</span>
                          {trend.dataPoints.some(dp => dp.isEstimate) && (
                            <span title="Contains estimated values from multi-strain harvests">
                              <Info className="h-3 w-3 text-muted-foreground" />
                            </span>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs',
                            trend.overallTrend === 'improving' && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                            trend.overallTrend === 'declining' && 'bg-red-500/10 text-red-500 border-red-500/20',
                            trend.overallTrend === 'stable' && 'bg-muted text-muted-foreground border-border',
                            trend.overallTrend === 'insufficient_data' && 'bg-muted text-muted-foreground border-border',
                          )}
                        >
                          {trend.overallTrend === 'insufficient_data' ? 'insufficient data' : trend.overallTrend}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            'h-2 rounded-full',
                            trend.overallTrend === 'improving' && 'bg-emerald-500',
                            trend.overallTrend === 'declining' && 'bg-red-500',
                            trend.overallTrend === 'stable' && 'bg-blue-500',
                            trend.overallTrend === 'insufficient_data' && 'bg-muted-foreground',
                          )}
                          style={{ width: `${Math.max((trend.avgYieldEfficiency / maxYield) * 100, 2)}%` }}
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {trend.avgYieldEfficiency.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
            {intelligence.yieldTrends.length > 5 && (
              <button
                onClick={() => setShowAllTrends(v => !v)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mt-3 py-2"
              >
                {showAllTrends ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    Show all ({intelligence.yieldTrends.length})
                  </>
                )}
              </button>
            )}
          </>
        ) : !intelligenceLoading ? (
          <div className="card-modern p-6 text-center text-sm text-muted-foreground">
            No yield trend data available
          </div>
        ) : null}
      </div>

      {/* Recommendations */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-yellow-500" />
          Recommendations
        </h2>
        {intelligenceLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : intelligence && intelligence.recommendations.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {intelligence.recommendations.map((rec, i) => (
              <div key={`${rec.strainName}-${rec.severity}-${i}`} className="card-modern p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {rec.severity === 'info' && <Info className="h-4 w-4 text-blue-500" aria-label="Info" />}
                    {rec.severity === 'warning' && <AlertTriangle className="h-4 w-4 text-yellow-500" aria-label="Warning" />}
                    {rec.severity === 'critical' && <XCircle className="h-4 w-4 text-red-500" aria-label="Critical" />}
                    {rec.severity === 'success' && <Trophy className="h-4 w-4 text-emerald-500" aria-label="Success" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{rec.title}</div>
                    <div className="text-sm text-muted-foreground mt-1">{rec.description}</div>
                    {rec.metric && (
                      <div className="text-xs text-muted-foreground mt-1">{rec.metric}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : !intelligenceLoading ? (
          <div className="card-modern p-6 text-center text-sm text-muted-foreground">
            All strains performing normally
          </div>
        ) : null}
      </div>

      {/* Yield by Strain Table */}
      <div className="card-modern mb-8">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold">Yield by Strain</h2>
        </div>
        {yieldLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><SortableHeader label="Strain" field="strainName" /></TableHead>
                <TableHead className="text-right"><SortableHeader label="Plants" field="totalPlants" /></TableHead>
                <TableHead className="text-right"><SortableHeader label="Packages" field="packageCount" /></TableHead>
                <TableHead className="text-right"><SortableHeader label="Total Qty (g)" field="totalPackageQuantity" /></TableHead>
                <TableHead className="text-right"><SortableHeader label="Yield/Plant (g)" field="estimatedYieldPerPlant" /></TableHead>
                <TableHead>Categories</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedStrains.map(s => (
                <TableRow key={s.strainName}>
                  <TableCell className="font-medium">{s.strainName}</TableCell>
                  <TableCell className="text-right">{s.totalPlants}</TableCell>
                  <TableCell className="text-right">{s.packageCount}</TableCell>
                  <TableCell className="text-right">{Math.round(s.totalPackageQuantity).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-medium">
                    {s.totalPlants > 0 ? Math.round(s.estimatedYieldPerPlant) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {s.categories.map(c => (
                        <Badge key={c.category} variant="outline" className="text-xs">
                          {c.category} ({c.count})
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Loss Analysis */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          Loss Analysis
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          {lossCards.map(c => (
            <div key={c.label} className="card-modern p-3 text-center">
              {lossLoading ? <Skeleton className="h-8 w-12 mx-auto" /> : (
                <>
                  <div className="text-lg font-bold">{c.value}</div>
                  <div className="text-xs text-muted-foreground">{c.label}</div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="card-modern">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold text-sm">Loss by Category</h3>
          </div>
          {lossLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Loss Count</TableHead>
                  <TableHead className="text-right">Total Count</TableHead>
                  <TableHead className="text-right">Loss %</TableHead>
                  <TableHead className="w-[120px]">Severity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lossData?.byCategory ?? []).map(c => (
                  <TableRow key={c.category}>
                    <TableCell className="font-medium">{c.category}</TableCell>
                    <TableCell className="text-right">{c.lossCount}</TableCell>
                    <TableCell className="text-right">{c.totalCount}</TableCell>
                    <TableCell className="text-right">{c.lossPercentage.toFixed(1)}%</TableCell>
                    <TableCell>
                      <div className={cn(
                        'h-2 rounded-full',
                        c.lossPercentage > 20 ? 'bg-red-500' :
                        c.lossPercentage > 10 ? 'bg-yellow-500' :
                        'bg-emerald-500'
                      )} style={{ width: `${Math.min(c.lossPercentage, 100)}%` }} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  )
}
