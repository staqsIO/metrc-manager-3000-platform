'use client'

import { useFacilityId } from '@/shared/hooks/useFacilityId'
import { trpc } from '@/lib/trpc-client'
import { KpiCard } from '@/shared/components/KpiCard'
import { cn } from '@/lib/utils'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Layers,
  Clock,
  AlertTriangle,
  Loader2,
} from 'lucide-react'

const SEVERITY_LABELS: Record<string, { label: string; color: string }> = {
  balanced: { label: 'Balanced', color: 'text-emerald-500' },
  mild_imbalance: { label: 'Mild Imbalance', color: 'text-yellow-500' },
  significant_imbalance: { label: 'Significant Imbalance', color: 'text-orange-500' },
  critical: { label: 'Critical', color: 'text-red-500' },
}

export default function ThroughputPage() {
  const facilityId = useFacilityId()

  const { data, isLoading, error } = trpc.intelligence.getThroughputAnalysis.useQuery(
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
          Failed to load throughput analysis: {error.message}
        </div>
      </div>
    )
  }

  if (!data) return null

  const severity = SEVERITY_LABELS[data.severity] ?? SEVERITY_LABELS.balanced
  const intakeLabel = data.intakeSource === 'harvests' ? 'Harvest Intake'
    : data.intakeSource === 'packages' ? 'Material Received'
    : 'Material Intake'
  const intakeBarWidth = data.avgWeeklyIntake > 0 || data.avgWeeklyOutput > 0
    ? Math.min(100, (data.avgWeeklyIntake / Math.max(data.avgWeeklyIntake, data.avgWeeklyOutput)) * 100)
    : 0
  const outputBarWidth = data.avgWeeklyIntake > 0 || data.avgWeeklyOutput > 0
    ? Math.min(100, (data.avgWeeklyOutput / Math.max(data.avgWeeklyIntake, data.avgWeeklyOutput)) * 100)
    : 0

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Throughput vs Intake</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Am I keeping up? Compare material intake rate against processing output rate.
          <span className="ml-1 text-muted-foreground/60">({data.analysisWindowDays}-day window)</span>
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Weekly Intake"
          value={data.avgWeeklyIntake}
          icon={ArrowDownToLine}
          color="text-blue-500"
          suffix={data.unitOfWeight}
        />
        <KpiCard
          label="Weekly Output"
          value={data.avgWeeklyOutput}
          icon={ArrowUpFromLine}
          color="text-emerald-500"
          suffix={data.unitOfWeight}
        />
        <KpiCard
          label="Backlog"
          value={data.rawMaterialBacklog}
          icon={Layers}
          color={data.backlogGrowing ? 'text-orange-500' : 'text-muted-foreground'}
          suffix={data.unitOfWeight}
        />
        <KpiCard
          label="Weeks to Clear"
          value={data.weeksToClearBacklog != null ? data.weeksToClearBacklog : 'N/A'}
          icon={Clock}
          color="text-muted-foreground"
          isText={data.weeksToClearBacklog == null}
        />
        <KpiCard
          label="Severity"
          value={severity.label}
          icon={AlertTriangle}
          color={severity.color}
          isText
        />
      </div>

      {/* Visual comparison bars */}
      <div className="card-modern p-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Intake vs Output Rate
        </h2>

        <div className="space-y-3">
          {/* Intake bar */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <ArrowDownToLine className="h-3 w-3 text-blue-500" />
                {intakeLabel}
              </span>
              <span className="text-xs font-medium">
                {data.avgWeeklyIntake.toLocaleString()} {data.unitOfWeight}/week
              </span>
            </div>
            <div className="h-6 w-full rounded-md bg-muted/30 overflow-hidden">
              <div
                className="h-full rounded-md bg-blue-500/60 transition-all duration-500"
                style={{ width: `${intakeBarWidth}%` }}
              />
            </div>
          </div>

          {/* Output bar */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <ArrowUpFromLine className="h-3 w-3 text-emerald-500" />
                Processing Output
              </span>
              <span className="text-xs font-medium">
                {data.avgWeeklyOutput.toLocaleString()} {data.unitOfWeight}/week
              </span>
            </div>
            <div className="h-6 w-full rounded-md bg-muted/30 overflow-hidden">
              <div
                className="h-full rounded-md bg-emerald-500/60 transition-all duration-500"
                style={{ width: `${outputBarWidth}%` }}
              />
            </div>
          </div>
        </div>

        {/* Backlog trend */}
        <div className="border-t border-border/50 pt-3 mt-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Backlog trend:</span>
            <span className={cn('font-medium', data.backlogGrowing ? 'text-orange-500' : 'text-emerald-500')}>
              {data.backlogGrowing ? 'Growing' : 'Shrinking'}
              <span className="text-xs ml-1">
                ({data.backlogGrowing ? '+' : ''}{data.backlogDeltaPerWeek.toLocaleString()} {data.unitOfWeight}/week)
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
