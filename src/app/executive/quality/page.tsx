'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'
import {
  FlaskConical,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Beaker,
  Timer,
} from 'lucide-react'
import { FACILITY_TYPE_COLORS } from '@/shared/constants/facility-types'
import { KpiCard } from '@/shared/components/ui/kpi-card'

type RouterOutputs = inferRouterOutputs<AppRouter>
type QualityData = RouterOutputs['crossFacility']['getQualitySummary']
type TurnaroundData = RouterOutputs['crossFacility']['getLabTurnaround']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function passRateColor(rate: number): string {
  // Map to semantic CSS variables. >=95% earns the phosphor accent (healthy);
  // 85-94 watch (caution); <85 critical. Three bands instead of four to
  // align with the rest of the executive suite's status palette.
  if (rate >= 95) return 'text-[hsl(var(--primary))]'
  if (rate >= 85) return 'text-[hsl(var(--signal-caution))]'
  return 'text-[hsl(var(--signal-critical))]'
}

function passRateBg(rate: number): string {
  if (rate >= 95) return 'bg-emerald-500'
  if (rate >= 85) return 'bg-yellow-500'
  if (rate >= 70) return 'bg-orange-500'
  return 'bg-red-500'
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function QualityKpis({ summary }: { summary: QualityData['summary'] }) {
  const tested = summary.passedCount + summary.failedCount

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
      <KpiCard
        icon={FlaskConical}
        label="Pass Rate"
        value={`${summary.passRate.toFixed(1)}%`}
        subtitle={`${tested} tested`}
        valueClass={passRateColor(summary.passRate)}
      />
      <KpiCard
        icon={CheckCircle2}
        label="Passed"
        value={`${summary.passedCount}`}
        valueClass="text-[hsl(var(--primary))]"
      />
      <KpiCard
        icon={XCircle}
        label="Failed"
        value={`${summary.failedCount}`}
        valueClass="text-[hsl(var(--signal-critical))]"
      />
      <KpiCard
        icon={Beaker}
        label="In Testing"
        value={`${summary.submittedCount}`}
      />
      <KpiCard
        icon={Clock}
        label="Awaiting"
        value={`${summary.pendingCount}`}
        valueClass="text-[hsl(var(--signal-caution))]"
      />
    </div>
  )
}

function FacilityQualityTable({ facilities }: { facilities: QualityData['facilities'] }) {
  if (facilities.length === 0) return null

  return (
    <div className="card-modern mb-8">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold">Quality by Facility</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Sorted by pass rate (lowest first)
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Facility</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">State</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Passed</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Failed</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Pending</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Pass Rate</th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((f: QualityData['facilities'][number]) => (
              <tr
                key={f.id}
                className="border-b border-border/50 hover:bg-accent/30 transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/facilities/${f.id}/lab-tests`}
                    className="font-medium hover:text-primary transition-colors"
                  >
                    {f.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{f.stateCode}</td>
                <td className="px-4 py-3 text-right tabular-nums">{f.totalPackages}</td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-500">
                  {f.passedCount}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-red-500">
                  {f.failedCount > 0 ? f.failedCount : <span className="text-muted-foreground">0</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {f.pendingCount + f.submittedCount}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', passRateBg(f.passRate))}
                        style={{ width: `${Math.min(f.passRate, 100)}%` }}
                      />
                    </div>
                    <span className={cn('tabular-nums font-medium', passRateColor(f.passRate))}>
                      {f.passRate.toFixed(1)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RiskyStrains({ strains }: { strains: QualityData['topRiskyStrains'] }) {
  if (strains.length === 0) return null

  return (
    <div className="card-modern">
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold">Strains with Highest Failure Rates</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Minimum 3 tests required
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Strain</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Tests</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Failures</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Pass Rate</th>
            </tr>
          </thead>
          <tbody>
            {strains.map((s: QualityData['topRiskyStrains'][number]) => (
              <tr
                key={s.strain}
                className="border-b border-border/50 hover:bg-accent/30 transition-colors"
              >
                <td className="px-4 py-3 font-medium">{s.strain}</td>
                <td className="px-4 py-3 text-right tabular-nums">{s.testCount}</td>
                <td className="px-4 py-3 text-right tabular-nums text-red-500">
                  {s.failCount}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={cn('tabular-nums font-medium', passRateColor(s.passRate))}>
                    {s.passRate.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

function turnaroundColor(days: number): string {
  if (days <= 7) return 'text-emerald-500'
  if (days <= 14) return 'text-yellow-500'
  if (days <= 21) return 'text-orange-500'
  return 'text-red-500'
}

type TurnaroundFacility = TurnaroundData['facilities'][number]
type TurnaroundCategory = TurnaroundFacility['turnaround']['byCategory'][number]

function LabTurnaroundSection({ turnaround }: { turnaround: TurnaroundData }) {
  if (turnaround.facilities.length === 0) return null

  return (
    <div className="card-modern mt-6">
      <div className="px-5 py-4">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Lab Testing Turnaround</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Average days from package creation to lab test completion
        </p>
      </div>
      <div className="px-5 pb-5 space-y-4">
        {turnaround.facilities.map((f: TurnaroundFacility) => (
          <div key={f.id} className="border-t border-border/50 pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium text-sm">{f.name}</span>
              {f.facilityType && (
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded border',
                  FACILITY_TYPE_COLORS[f.facilityType] ?? 'bg-muted text-muted-foreground border-border',
                )}>
                  {f.facilityType}
                </span>
              )}
              {f.turnaround.overallAvgDays !== null && (
                <span className={cn('ml-auto text-sm font-semibold tabular-nums', turnaroundColor(f.turnaround.overallAvgDays))}>
                  {f.turnaround.overallAvgDays}d avg
                </span>
              )}
              {f.turnaround.awaitingTestCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500 border border-yellow-500/30">
                  {f.turnaround.awaitingTestCount} awaiting
                </span>
              )}
            </div>
            {f.turnaround.byCategory.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left px-2 py-1 font-medium">Category</th>
                    <th className="text-right px-2 py-1 font-medium">Tested</th>
                    <th className="text-right px-2 py-1 font-medium" title="Average days from package creation to lab test">Avg</th>
                    <th className="text-right px-2 py-1 font-medium">Median</th>
                    <th className="text-right px-2 py-1 font-medium">Range</th>
                  </tr>
                </thead>
                <tbody>
                  {f.turnaround.byCategory.map((c: TurnaroundCategory) => (
                    <tr key={c.category} className="border-t border-border/30">
                      <td className="px-2 py-1.5">{c.category}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{c.testedCount}</td>
                      <td className={cn('px-2 py-1.5 text-right tabular-nums font-semibold', turnaroundColor(c.avgDays))}>
                        {c.avgDays}d
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{c.medianDays}d</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{c.minDays}–{c.maxDays}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function QualityPage() {
  const { data, isLoading } = trpc.crossFacility.getQualitySummary.useQuery(
    undefined,
    { staleTime: 600_000 },
  )

  const { data: turnaround } = trpc.crossFacility.getLabTurnaround.useQuery(
    undefined,
    { staleTime: 600_000 },
  )

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/executive"
          className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-accent transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-primary" />
            Quality & Lab Testing
          </h1>
          <p className="text-muted-foreground mt-1">
            Cross-facility lab test results and strain risk analysis
          </p>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="card-modern p-5 h-24 animate-pulse bg-muted/30" />
            ))}
          </div>
          <div className="card-modern h-64 animate-pulse bg-muted/30" />
        </div>
      ) : !data || data.summary.totalPackages === 0 ? (
        <div className="card-modern p-8 text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-5">
            <FlaskConical className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold mb-2">No Lab Test Data</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Lab test data will appear here once your facilities have packages
            with lab testing states recorded in Metrc.
          </p>
        </div>
      ) : (
        <>
          <QualityKpis summary={data.summary} />
          <FacilityQualityTable facilities={data.facilities} />
          <RiskyStrains strains={data.topRiskyStrains} />

          {turnaround && <LabTurnaroundSection turnaround={turnaround} />}

          {data.skipped.length > 0 && (
            <div className="mt-6 text-xs text-muted-foreground">
              {data.skipped.length} facilit{data.skipped.length === 1 ? 'y' : 'ies'} skipped due to API errors.
            </div>
          )}
        </>
      )}
    </div>
  )
}
