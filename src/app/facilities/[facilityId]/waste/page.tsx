'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { useFacilityId } from '@/shared/hooks/useFacilityId'
import { cn } from '@/lib/utils'
import {
  Trash2, Scale, Percent, Hash, TrendingDown, TrendingUp,
  Leaf, Sprout, Package, Skull,
} from 'lucide-react'
import { KpiCard } from '@/shared/components/KpiCard'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { PageHeader } from '@/shared/components/PageHeader'
import { TableSkeletonRows } from '@/shared/components/ui/table-skeleton'
import type { WasteSourceType, WasteAnalysis } from '@/services/engines/waste-analysis-engine'

const SOURCE_CONFIG: Record<WasteSourceType, { label: string; icon: typeof Leaf; color: string }> = {
  harvest: { label: 'Harvest Waste', icon: Leaf, color: 'text-emerald-500' },
  plant_batch: { label: 'Plant Batch Waste', icon: Sprout, color: 'text-green-500' },
  package_adjustment: { label: 'Package Adjustments', icon: Package, color: 'text-blue-500' },
  plant_destruction: { label: 'Plant Destruction', icon: Skull, color: 'text-red-500' },
}

type TabKey = 'overview' | 'by-source' | 'trends' | 'reasons'

export default function WastePage() {
  const facilityId = useFacilityId() ?? ''
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [days, setDays] = useState(3650)
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('week')

  const { data: summary, isLoading: summaryLoading } = trpc.waste.getSummary.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )

  const { data: rawAnalysis, isLoading: analysisLoading, error: analysisError } = trpc.waste.getAnalysis.useQuery(
    { facilityId, days, granularity },
    { enabled: !!facilityId, staleTime: 300_000, retry: 1 },
  )
  const analysis = rawAnalysis as WasteAnalysis | undefined

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'by-source', label: 'By Source' },
    { key: 'trends', label: 'Trends' },
    { key: 'reasons', label: 'Reasons' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Waste & Loss"
        description="Unified waste analytics across harvests, plant batches, package adjustments, and plant destruction"
        icon={Trash2}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
            >
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last year</option>
              <option value={3650}>All time</option>
            </select>
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
            >
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
          </div>
        }
      />

      {/* KPI Row */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="card-modern p-4 animate-pulse">
              <div className="h-4 bg-muted rounded w-20 mb-2" />
              <div className="h-6 bg-muted rounded w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Total Waste"
            value={summary ? `${summary.totalWasteWeight.toLocaleString()} g` : '-'}
            icon={Scale}
          />
          <KpiCard
            label="Waste Rate"
            value={summary ? `${summary.wasteRate}%` : '-'}
            icon={Percent}
          />
          <KpiCard
            label="Events"
            value={summary ? String(summary.eventCount) : '-'}
            icon={Hash}
          />
          <KpiCard
            label="vs Previous"
            value={
              analysis?.comparisonToPrevious
                ? `${analysis.comparisonToPrevious.changePct > 0 ? '+' : ''}${analysis.comparisonToPrevious.changePct}%`
                : 'N/A'
            }
            icon={analysis?.comparisonToPrevious && analysis.comparisonToPrevious.changePct > 0 ? TrendingUp : TrendingDown}
            color={
              analysis?.comparisonToPrevious
                ? analysis.comparisonToPrevious.changePct > 0 ? 'text-red-500' : 'text-emerald-500'
                : undefined
            }
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {analysisLoading ? (
            <div className="card-modern p-6">
              <TableSkeletonRows columns={4} rows={4} />
            </div>
          ) : analysisError ? (
            <EmptyState title="Failed to load waste data" description={analysisError.message} />
          ) : !analysis || !analysis.bySource.some(s => s.count > 0) ? (
            <EmptyState title="No waste data" description="No waste records found for this facility." />
          ) : (
            <>
              {/* Source breakdown donut-like display */}
              <div className="card-modern p-6">
                <h3 className="text-sm font-semibold mb-4">Waste by Source</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {analysis.bySource.filter(s => s.count > 0).map(source => {
                    const config = SOURCE_CONFIG[source.type]
                    const Icon = config.icon
                    return (
                      <div key={source.type} className="p-4 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className={cn('h-4 w-4', config.color)} />
                          <span className="text-sm font-medium">{config.label}</span>
                        </div>
                        <p className="text-2xl font-bold tabular-nums">
                          {source.weight.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">g</span>
                        </p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-muted-foreground">{source.count} events</span>
                          <span className="text-xs font-medium">{source.pctOfTotal}%</span>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', config.color.replace('text-', 'bg-'))}
                            style={{ width: `${Math.min(source.pctOfTotal, 100)}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
                {analysis.bySource.every(s => s.count === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">No waste events in this period.</p>
                )}
              </div>

              {/* Period comparison */}
              {analysis.comparisonToPrevious && (
                <div className="card-modern p-6">
                  <h3 className="text-sm font-semibold mb-4">Period-over-Period Comparison</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 rounded-lg bg-muted/50">
                      <span className="text-xs text-muted-foreground">Previous Period</span>
                      <p className="text-xl font-bold tabular-nums mt-1">
                        {analysis.comparisonToPrevious.previousWeight.toLocaleString()} g
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50">
                      <span className="text-xs text-muted-foreground">Current Period</span>
                      <p className="text-xl font-bold tabular-nums mt-1">
                        {analysis.comparisonToPrevious.currentWeight.toLocaleString()} g
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50">
                      <span className="text-xs text-muted-foreground">Change</span>
                      <p className={cn(
                        'text-xl font-bold tabular-nums mt-1',
                        analysis.comparisonToPrevious.changePct > 0 ? 'text-red-500' : 'text-emerald-500',
                      )}>
                        {analysis.comparisonToPrevious.changePct > 0 ? '+' : ''}
                        {analysis.comparisonToPrevious.changePct}%
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* By Source Tab */}
      {activeTab === 'by-source' && (
        <div className="space-y-4">
          {analysisLoading ? (
            <div className="card-modern p-6">
              <TableSkeletonRows columns={5} rows={4} />
            </div>
          ) : !analysis ? (
            <EmptyState title="No waste data" description="No waste records found." />
          ) : (
            <div className="card-modern overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium">Source Type</th>
                    <th className="text-right px-4 py-3 font-medium">Events</th>
                    <th className="text-right px-4 py-3 font-medium">Weight (g)</th>
                    <th className="text-right px-4 py-3 font-medium">% of Total</th>
                    <th className="px-4 py-3 font-medium text-left">Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.bySource.map(source => {
                    const config = SOURCE_CONFIG[source.type]
                    const Icon = config.icon
                    return (
                      <tr key={source.type} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Icon className={cn('h-4 w-4', config.color)} />
                            <span className="font-medium">{config.label}</span>
                          </div>
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums">{source.count}</td>
                        <td className="text-right px-4 py-3 tabular-nums">{source.weight.toLocaleString()}</td>
                        <td className="text-right px-4 py-3 tabular-nums">{source.pctOfTotal}%</td>
                        <td className="px-4 py-3 min-w-[140px]">
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn('h-full rounded-full', config.color.replace('text-', 'bg-'))}
                              style={{ width: `${Math.min(source.pctOfTotal, 100)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-medium">
                    <td className="px-4 py-3">Total</td>
                    <td className="text-right px-4 py-3 tabular-nums">{analysis.eventCount}</td>
                    <td className="text-right px-4 py-3 tabular-nums">{analysis.totalWasteWeight.toLocaleString()}</td>
                    <td className="text-right px-4 py-3 tabular-nums">100%</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Trends Tab */}
      {activeTab === 'trends' && (
        <div className="space-y-4">
          {analysisLoading ? (
            <div className="card-modern p-6">
              <TableSkeletonRows columns={6} rows={8} />
            </div>
          ) : !analysis?.trends.length ? (
            <EmptyState title="No trend data" description="No waste events in the selected time range." />
          ) : (
            <>
              {/* Visual bar chart */}
              <div className="card-modern p-6">
                <h3 className="text-sm font-semibold mb-4">Waste Over Time</h3>
                <div className="space-y-2">
                  {(() => {
                    const maxWeight = Math.max(...analysis.trends.map(t => t.totalWeight), 1)
                    return analysis.trends.map(trend => (
                      <div key={trend.period} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-24 text-right tabular-nums shrink-0">
                          {trend.period}
                        </span>
                        <div className="flex-1 flex items-center gap-1 h-6">
                          {(['harvest', 'plant_batch', 'package_adjustment', 'plant_destruction'] as WasteSourceType[]).map(type => {
                            const value = trend.bySource[type]
                            if (value <= 0) return null
                            const widthPct = (value / maxWeight) * 100
                            const config = SOURCE_CONFIG[type]
                            return (
                              <div
                                key={type}
                                className={cn('h-full rounded-sm', config.color.replace('text-', 'bg-'))}
                                style={{ width: `${widthPct}%` }}
                                title={`${config.label}: ${value.toLocaleString()} g`}
                              />
                            )
                          })}
                        </div>
                        <span className="text-xs font-medium tabular-nums w-20 text-right">
                          {trend.totalWeight.toLocaleString()} g
                        </span>
                      </div>
                    ))
                  })()}
                </div>
                {/* Legend */}
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
                  {Object.entries(SOURCE_CONFIG).map(([key, config]) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <div className={cn('h-2.5 w-2.5 rounded-sm', config.color.replace('text-', 'bg-'))} />
                      <span className="text-xs text-muted-foreground">{config.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Trend data table */}
              <div className="card-modern overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium">Period</th>
                      <th className="text-right px-4 py-3 font-medium">Total (g)</th>
                      <th className="text-right px-4 py-3 font-medium">Harvest</th>
                      <th className="text-right px-4 py-3 font-medium">Plant Batch</th>
                      <th className="text-right px-4 py-3 font-medium">Pkg Adjust</th>
                      <th className="text-right px-4 py-3 font-medium">Destruction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.trends.map(trend => (
                      <tr key={trend.period} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium tabular-nums">{trend.period}</td>
                        <td className="text-right px-4 py-3 tabular-nums font-medium">{trend.totalWeight.toLocaleString()}</td>
                        <td className="text-right px-4 py-3 tabular-nums text-muted-foreground">
                          {trend.bySource.harvest > 0 ? trend.bySource.harvest.toLocaleString() : '-'}
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums text-muted-foreground">
                          {trend.bySource.plant_batch > 0 ? trend.bySource.plant_batch.toLocaleString() : '-'}
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums text-muted-foreground">
                          {trend.bySource.package_adjustment > 0 ? trend.bySource.package_adjustment.toLocaleString() : '-'}
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums text-muted-foreground">
                          {trend.bySource.plant_destruction > 0 ? trend.bySource.plant_destruction.toLocaleString() : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Reasons Tab */}
      {activeTab === 'reasons' && (
        <div className="space-y-4">
          {analysisLoading ? (
            <div className="card-modern p-6">
              <TableSkeletonRows columns={4} rows={8} />
            </div>
          ) : !analysis?.topReasons.length ? (
            <EmptyState title="No reasons data" description="No waste events with reason data in this period." />
          ) : (
            <>
              {/* Horizontal bar chart */}
              <div className="card-modern p-6">
                <h3 className="text-sm font-semibold mb-4">Top Waste Reasons</h3>
                <div className="space-y-3">
                  {(() => {
                    const maxWeight = Math.max(...analysis.topReasons.map(r => r.weight), 1)
                    return analysis.topReasons.map((reason, i) => (
                      <div key={reason.reason} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">
                            <span className="text-muted-foreground mr-2">#{i + 1}</span>
                            {reason.reason}
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {reason.weight.toLocaleString()} g ({reason.count} events)
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/60"
                            style={{ width: `${(reason.weight / maxWeight) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              </div>

              {/* Reasons table */}
              <div className="card-modern overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium">Rank</th>
                      <th className="text-left px-4 py-3 font-medium">Reason</th>
                      <th className="text-right px-4 py-3 font-medium">Weight (g)</th>
                      <th className="text-right px-4 py-3 font-medium">Events</th>
                      <th className="text-right px-4 py-3 font-medium">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.topReasons.map((reason, i) => (
                      <tr key={reason.reason} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground">#{i + 1}</td>
                        <td className="px-4 py-3 font-medium">{reason.reason}</td>
                        <td className="text-right px-4 py-3 tabular-nums">{reason.weight.toLocaleString()}</td>
                        <td className="text-right px-4 py-3 tabular-nums">{reason.count}</td>
                        <td className="text-right px-4 py-3 tabular-nums">
                          {analysis.totalWasteWeight > 0
                            ? `${Math.round((reason.weight / analysis.totalWasteWeight) * 10000) / 100}%`
                            : '0%'
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
