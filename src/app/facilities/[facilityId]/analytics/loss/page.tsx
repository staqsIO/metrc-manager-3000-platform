'use client'

import { useFacilityId } from '@/shared/hooks/useFacilityId'
import { trpc } from '@/lib/trpc-client'
import { KpiCard } from '@/shared/components/KpiCard'
import { ProgressiveMetric } from '@/shared/components/ProgressiveMetric'
import { EnrichmentPrompt } from '@/shared/components/EnrichmentPrompt'
import { cn } from '@/lib/utils'
import type { LossSignal } from '@/services/engines/financial-overlay-engine'
import {
  AlertTriangle,
  TrendingDown,
  ShieldAlert,
  PackageX,
  DollarSign,
  Loader2,
} from 'lucide-react'

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  critical: { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20', label: 'Critical' },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/20', label: 'High' },
  medium: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', border: 'border-yellow-500/20', label: 'Medium' },
  low: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20', label: 'Low' },
}

const CATEGORY_ICONS: Record<string, typeof AlertTriangle> = {
  waste: TrendingDown,
  yield_drop: TrendingDown,
  idle_inventory: PackageX,
  lab_failures: ShieldAlert,
  fifo_violations: AlertTriangle,
}

export default function LossAnalysisPage() {
  const facilityId = useFacilityId()

  const { data, isLoading, error } = trpc.intelligence.getLossAnalysis.useQuery(
    { facilityId: facilityId! },
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
          Failed to load loss analysis: {error.message}
        </div>
      </div>
    )
  }

  if (!data) return null

  const criticalCount = data.signals.filter((s: LossSignal) => s.severity === 'critical').length
  const highCount = data.signals.filter((s: LossSignal) => s.severity === 'high').length
  const mediumCount = data.signals.filter((s: LossSignal) => s.severity === 'medium').length

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Loss Analysis</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Where are we losing money? Identify operational loss signals with progressive financial enrichment.
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Loss Signals"
          value={data.signals.length}
          icon={AlertTriangle}
          color="text-amber-500"
        />
        <KpiCard
          label="Critical"
          value={criticalCount}
          icon={ShieldAlert}
          color={criticalCount > 0 ? 'text-red-500' : 'text-muted-foreground'}
        />
        <KpiCard
          label="High"
          value={highCount}
          icon={TrendingDown}
          color={highCount > 0 ? 'text-orange-500' : 'text-muted-foreground'}
        />
        {data.hasFinancialData && data.totalDollarLoss != null ? (
          <ProgressiveMetric
            label="Est. Dollar Loss"
            value={data.totalDollarLoss}
            icon={DollarSign}
            prefix="$"
            color="text-red-500"
            source={data.fidelity.costConfidenceTier}
          />
        ) : (
          <KpiCard
            label="Medium"
            value={mediumCount}
            icon={AlertTriangle}
            color={mediumCount > 0 ? 'text-yellow-500' : 'text-muted-foreground'}
          />
        )}
      </div>

      {/* Enrichment prompt when no financial data */}
      {!data.hasFinancialData && (
        <EnrichmentPrompt
          integration="canix"
          message="Connect ERP to see dollar impact of losses"
          variant="block"
        />
      )}

      {/* Signal Cards */}
      {data.signals.length === 0 ? (
        <div className="card-modern p-8 text-center">
          <PackageX className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No loss signals detected. Operations look healthy.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Loss Signals ({data.signals.length})
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {data.signals.map((signal: LossSignal, idx: number) => {
              const style = SEVERITY_STYLES[signal.severity] ?? SEVERITY_STYLES.low
              const CategoryIcon = CATEGORY_ICONS[signal.category] ?? AlertTriangle

              return (
                <div key={idx} className={cn('card-modern p-4 border-l-2', style.border)}>
                  <div className="flex items-start gap-3">
                    <CategoryIcon className={cn('h-5 w-5 mt-0.5 flex-shrink-0', style.text)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', style.bg, style.text)}>
                          {style.label}
                        </span>
                        <span className="text-xs text-muted-foreground capitalize">
                          {signal.category.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{signal.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">{signal.operationalMetric}</p>
                      {signal.dollarImpact != null && (
                        <p className="text-sm font-semibold text-red-500 mt-1">
                          ${signal.dollarImpact.toLocaleString(undefined, { maximumFractionDigits: 2 })} at risk
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground/80 mt-2 italic">{signal.action}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
