'use client'

import { useState } from 'react'
import { useFacilityId } from '@/shared/hooks/useFacilityId'
import { trpc } from '@/lib/trpc-client'
import { KpiCard } from '@/shared/components/KpiCard'
import { cn } from '@/lib/utils'
import type { HarvestForecastEntry } from '@/services/engines/operational-intelligence-engine'
import {
  Sprout,
  CalendarClock,
  HelpCircle,
  Loader2,
  Leaf,
} from 'lucide-react'

const WINDOW_OPTIONS = [7, 14, 30] as const

export default function HarvestForecastPage() {
  const facilityId = useFacilityId()
  const [windowDays, setWindowDays] = useState<number>(14)

  const { data, isLoading, error } = trpc.intelligence.getHarvestForecast.useQuery(
    { facilityId: facilityId!, windowDays },
    { enabled: !!facilityId, staleTime: 300_000 },
  )

  if (!facilityId) return null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="card-modern p-6 text-center text-red-500">
          Failed to load harvest forecast: {error.message}
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Harvest Forecast</h1>
          <p className="text-sm text-muted-foreground mt-1">
            What batches are ready to harvest within the next {windowDays} days?
          </p>
        </div>

        {/* Window selector */}
        <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1">
          {WINDOW_OPTIONS.map(w => (
            <button
              key={w}
              onClick={() => setWindowDays(w)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                windowDays === w
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          label={`Upcoming (${windowDays}d)`}
          value={data.upcoming.length}
          icon={CalendarClock}
          color={data.upcoming.length > 0 ? 'text-emerald-500' : 'text-muted-foreground'}
        />
        <KpiCard
          label="Total Flowering"
          value={data.allFlowering.length}
          icon={Sprout}
          color="text-purple-500"
        />
        <KpiCard
          label="No History"
          value={data.strainsWithoutHistory.length}
          icon={HelpCircle}
          color={data.strainsWithoutHistory.length > 0 ? 'text-amber-500' : 'text-muted-foreground'}
        />
      </div>

      {/* Strains without history warning */}
      {data.strainsWithoutHistory.length > 0 && (
        <div className="card-modern p-3 border-l-2 border-amber-500/40">
          <div className="flex items-start gap-2">
            <HelpCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-amber-500">Strains without harvest history</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.strainsWithoutHistory.join(', ')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Forecast table */}
      {data.allFlowering.length === 0 ? (
        <div className="card-modern p-8 text-center">
          <Leaf className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No active flowering batches found.</p>
        </div>
      ) : (
        <div className="card-modern overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Batch</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Strain</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plants</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Projected Date</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Days Until</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Est. Yield</th>
                </tr>
              </thead>
              <tbody>
                {data.allFlowering.map((entry: HarvestForecastEntry, idx: number) => {
                  const isUpcoming = entry.withinWindow
                  const isOverdue = entry.daysUntilHarvest != null && entry.daysUntilHarvest < 0

                  return (
                    <tr
                      key={idx}
                      className={cn(
                        'border-b border-border/30 transition-colors hover:bg-muted/20',
                        isUpcoming && 'bg-emerald-500/5',
                        isOverdue && 'bg-red-500/5',
                      )}
                    >
                      <td className="px-4 py-3 font-medium truncate max-w-[200px]" title={entry.batchName}>
                        {entry.batchName}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{entry.strainName}</td>
                      <td className="px-4 py-3 text-right">{entry.plantCount}</td>
                      <td className="px-4 py-3 text-right">
                        {entry.projectedHarvestDate ?? (
                          <span className="text-muted-foreground/50 text-xs">No history</span>
                        )}
                      </td>
                      <td className={cn(
                        'px-4 py-3 text-right font-medium',
                        isOverdue ? 'text-red-500' : isUpcoming ? 'text-emerald-500' : 'text-muted-foreground',
                      )}>
                        {entry.daysUntilHarvest != null ? entry.daysUntilHarvest : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {entry.estimatedYield != null
                          ? `${entry.estimatedYield.toLocaleString()} g`
                          : <span className="text-muted-foreground/50">—</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
