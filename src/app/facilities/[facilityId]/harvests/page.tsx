'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Wheat, PauseCircle, CheckCircle2, Scale, Trash2, Sprout,
  TrendingUp, BarChart3, Package, Clock, Zap, ArrowRightLeft, Cog,
} from 'lucide-react'
import { HarvestTable } from '@/features/harvests/components/HarvestTable'
import { PageHeader } from '@/shared/components/PageHeader'
import { KpiCard } from '@/shared/components/ui/kpi-card'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type RouterOutputs = inferRouterOutputs<AppRouter>
type SummaryData = RouterOutputs['harvests']['getSummary']
type YieldAnalytics = NonNullable<SummaryData['yieldAnalytics']>
type StrainData = YieldAnalytics['strains'][number]

function StrainPerformanceChart({ strains }: { strains: StrainData[] }) {
  const top = strains.slice(0, 10)
  if (top.length === 0) return null

  return (
    <div className="card-modern p-4 mb-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Strain Performance Comparison</h3>

      {/* CSS horizontal bar chart */}
      <div className="space-y-3 mb-6">
        {top.map((s) => {
          const total = s.totalPackagedWeight + s.totalWasteWeight + s.totalCurrentWeight
          const yieldPct = total > 0 ? (s.totalPackagedWeight / total) * 100 : 0
          const wastePct = total > 0 ? (s.totalWasteWeight / total) * 100 : 0
          return (
            <div key={s.strain} className="flex items-center gap-3">
              <div className="w-32 text-xs text-foreground truncate shrink-0" title={s.strain}>
                {s.strain}
              </div>
              <div className="flex-1 h-5 rounded-full overflow-hidden flex bg-muted/30">
                <div
                  className="bg-emerald-500/40 h-full transition-all"
                  style={{ width: `${yieldPct}%` }}
                  title={`Packaged: ${yieldPct.toFixed(1)}%`}
                />
                <div
                  className="bg-red-500/40 h-full transition-all"
                  style={{ width: `${wastePct}%` }}
                  title={`Waste: ${wastePct.toFixed(1)}%`}
                />
                <div className="bg-muted h-full flex-1" />
              </div>
              <span className="text-xs text-muted-foreground w-8 text-right shrink-0">
                {s.harvestCount}
              </span>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 mb-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500/40" /> Packaged
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-500/40" /> Waste
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-muted" /> Remaining
        </span>
      </div>

      {/* Detail table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 pr-4 font-medium">Strain</th>
              <th className="text-right py-2 px-2 font-medium">Harvests</th>
              <th className="text-right py-2 px-2 font-medium">Packaged (g)</th>
              <th className="text-right py-2 px-2 font-medium">Waste (g)</th>
              <th className="text-right py-2 px-2 font-medium">Yield Eff %</th>
              <th className="text-right py-2 pl-2 font-medium">Waste Rate %</th>
            </tr>
          </thead>
          <tbody>
            {top.map((s) => (
              <tr key={s.strain} className="border-b border-border/50">
                <td className="py-1.5 pr-4 text-foreground">{s.strain}</td>
                <td className="text-right py-1.5 px-2">{s.harvestCount}</td>
                <td className="text-right py-1.5 px-2">{s.totalPackagedWeight.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                <td className="text-right py-1.5 px-2">{s.totalWasteWeight.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                <td className="text-right py-1.5 px-2 text-emerald-500">{(s.avgYieldEfficiency * 100).toFixed(1)}%</td>
                <td className="text-right py-1.5 pl-2 text-red-500">{(s.avgWasteRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProcessingEfficiencyCard({ ratio }: { ratio: number }) {
  const colorClass = ratio <= 0.5 ? 'text-emerald-500' : ratio <= 1.0 ? 'text-yellow-500' : 'text-red-500'
  const barColorClass = ratio <= 0.5 ? 'bg-emerald-500/40' : ratio <= 1.0 ? 'bg-yellow-500/40' : 'bg-red-500/40'
  // Cap the visual bar at 200% (ratio 2.0) for display
  const barPct = Math.min((ratio / 2) * 100, 100)

  return (
    <div className="card-modern p-4 mb-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Processing Efficiency</h3>
      <p className={cn('text-3xl font-bold mb-2', colorClass)}>
        {ratio.toFixed(2)}
        <span className="text-sm font-normal ml-1">g waste / g output</span>
      </p>
      <div className="h-2 rounded-full bg-muted/30 overflow-hidden mb-2">
        <div className={cn('h-full rounded-full transition-all', barColorClass)} style={{ width: `${barPct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        For every 1g of packaged output, {ratio.toFixed(1)}g is lost to waste
      </p>
    </div>
  )
}

export default function HarvestsPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const { data: summary, error: summaryError } = trpc.harvests.getSummary.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const analytics = summary?.yieldAnalytics

  const summaryCards = [
    {
      label: 'Active',
      value: summary?.activeCount ?? 0,
      icon: Wheat,
      color: 'text-emerald-500',
    },
    {
      label: 'On Hold',
      value: summary?.onHoldCount ?? 0,
      icon: PauseCircle,
      color: 'text-yellow-500',
    },
    {
      label: 'Finished',
      value: summary?.inactiveCount ?? 0,
      icon: CheckCircle2,
      color: 'text-muted-foreground',
    },
    {
      label: 'Active Weight',
      value: summary?.totalActiveWeight ?? 0,
      icon: Scale,
      color: 'text-foreground',
      suffix: 'g',
    },
    {
      label: 'Total Waste',
      value: summary?.totalWasteWeight ?? 0,
      icon: Trash2,
      color: 'text-red-500',
      suffix: 'g',
    },
    {
      label: 'Packaged',
      value: summary?.totalPackagedWeight ?? 0,
      icon: Sprout,
      color: 'text-blue-500',
      suffix: 'g',
    },
  ]

  const yieldAnalyticsCards = analytics ? [
    {
      label: 'Yield Efficiency',
      value: (analytics.avgYieldEfficiency * 100).toFixed(1),
      icon: TrendingUp,
      color: analytics.avgYieldEfficiency >= 0.5 ? 'text-emerald-500' : 'text-yellow-500',
      suffix: '%',
    },
    {
      label: 'Waste Rate',
      value: (analytics.avgWasteRate * 100).toFixed(1),
      icon: BarChart3,
      color: 'text-red-500',
      suffix: '%',
    },
    {
      label: 'Avg Pkg/Harvest',
      value: analytics.avgPackagesPerHarvest.toFixed(1),
      icon: Package,
      color: 'text-blue-500',
    },
    {
      label: 'Avg Days to Finish',
      value: analytics.avgDaysToFinish !== null ? analytics.avgDaysToFinish.toFixed(1) : '\u2014',
      icon: Clock,
      color: 'text-foreground',
    },
    {
      label: 'Total Throughput',
      value: analytics.totalThroughputGrams.toLocaleString(undefined, { maximumFractionDigits: 1 }),
      icon: Zap,
      color: 'text-emerald-500',
      suffix: 'g',
    },
    {
      label: 'Waste:Output',
      value: analytics.wasteToOutputRatio.toFixed(2),
      icon: ArrowRightLeft,
      color: analytics.wasteToOutputRatio <= 0.5 ? 'text-emerald-500' : analytics.wasteToOutputRatio <= 1.0 ? 'text-yellow-500' : 'text-red-500',
      suffix: 'g/g',
    },
  ] : []

  return (
    <div className="p-8">
      <PageHeader
        title="Harvests"
        description="Track-and-trace harvest management"
        actions={
          <Link
            href={`/facilities/${facilityId}/processing`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Cog className="h-4 w-4" />
            Processing
          </Link>
        }
      />

      {/* Summary error */}
      {summaryError && (
        <div className="card-modern p-4 mb-6 border-red-500/30">
          <p className="text-sm text-red-500">Failed to load harvest analytics: {summaryError.message}</p>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {summaryCards.map((card) => (
          <KpiCard
            key={card.label}
            label={card.label}
            value={<>{card.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}{card.suffix && <span className="text-sm font-normal ml-1">{card.suffix}</span>}</>}
            icon={card.icon}
            color={card.color}
          />
        ))}
      </div>

      {/* Yield Analytics Cards */}
      {analytics && yieldAnalyticsCards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {yieldAnalyticsCards.map((card) => (
            <KpiCard
              key={card.label}
              label={card.label}
              value={<>{card.value}{card.suffix && <span className="text-sm font-normal ml-1">{card.suffix}</span>}</>}
              icon={card.icon}
              color={card.color}
            />
          ))}
        </div>
      )}

      {/* Top Strains */}
      {summary?.topStrains && summary.topStrains.length > 0 && (
        <div className="card-modern p-4 mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Top Active Strains</h3>
          <div className="flex flex-wrap gap-2">
            {summary.topStrains.map((s) => (
              <span
                key={s.strain}
                className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground"
              >
                {s.strain}
                <span className="ml-1.5 text-muted-foreground">({s.count})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Strain Performance Chart */}
      {analytics && analytics.strains.length > 0 && (
        <StrainPerformanceChart strains={analytics.strains} />
      )}

      {/* Processing Efficiency */}
      {analytics && analytics.totalHarvests > 0 && (
        <ProcessingEfficiencyCard ratio={analytics.wasteToOutputRatio} />
      )}

      {/* Harvest Table */}
      <HarvestTable facilityId={facilityId} />
    </div>
  )
}
