'use client'

import { useState, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'
import { STAGE_ROOM_MAPPINGS } from '@/services/engines/pipeline-stages'
import {
  Sprout,
  Clock,
  Boxes,
  DollarSign,
  TrendingUp,
  Trash2,
  Flame,
  Cookie,
  Wind,
  Coffee,
  Droplet,
  Box,
  Building2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ArrowUpRight,
  Activity,
  Package,
  ShieldAlert,
  FlaskConical,
  Sparkles,
  CheckCircle2,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { FACILITY_TYPE_COLORS, getDefaultFacilityPage } from '@/shared/constants/facility-types'
import { KpiCard } from '@/shared/components/ui/kpi-card'
import { computeMedianDaysOfSupply } from '@/shared/utils/run-rate-medians'
import { StateOutline } from '@/shared/components/StateOutline'
import { formatDistanceToNow } from '@/shared/utils/date'

type RouterOutputs = inferRouterOutputs<AppRouter>
type FacilityWithHealth = RouterOutputs['facility']['listWithHealth'][number]
type PnLData = RouterOutputs['financial']['getConsolidatedPnL']
type ComparisonData = RouterOutputs['crossFacility']['getRunRateComparison']
type OpsSummaryData = RouterOutputs['crossFacility']['getOperationsSummary']
type BriefingRollupData = RouterOutputs['crossFacility']['getBriefingRollup']
type BriefingRollupRow = BriefingRollupData['facilities'][number]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Weight as a total over the lookback window — the honest number for long-cycle cultivators. */
function formatWeightTotal(lbs: number): string {
  return `${lbs.toLocaleString(undefined, { maximumFractionDigits: lbs >= 1000 ? 0 : 1 })} lbs`
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

// computeMedianDaysOfSupply moved to shared/utils/run-rate-medians (was
// duplicated across this file and /operations/page.tsx as an inline IIFE).

// ---------------------------------------------------------------------------
// State overview builder
// ---------------------------------------------------------------------------

interface StateOverview {
  stateCode: string
  facilityCount: number
  revenue: number
  grossMargin: number
  totalAlerts: number
  transferOpps: number
}

function buildStateOverview(
  comparison: ComparisonData | undefined,
  pnl: PnLData | undefined,
  facilities: FacilityWithHealth[] | undefined,
): StateOverview[] {
  const stateMap = new Map<string, StateOverview>()

  if (facilities) {
    for (const f of facilities) {
      const s = stateMap.get(f.stateCode)
      if (s) {
        s.facilityCount++
        s.totalAlerts += f.alertCount
      } else {
        stateMap.set(f.stateCode, {
          stateCode: f.stateCode,
          facilityCount: 1,
          revenue: 0,
          grossMargin: 0,
          totalAlerts: f.alertCount,
          transferOpps: 0,
        })
      }
    }
  }

  // Merge P&L by state
  if (pnl?.groups) {
    for (const group of pnl.groups) {
      const s = stateMap.get(group.key)
      if (s) {
        s.revenue = group.totals.revenue
        s.grossMargin = group.totals.grossMargin
      }
    }
  }

  // Count transfer opportunities per state
  if (comparison?.transferOpportunities) {
    for (const opp of comparison.transferOpportunities) {
      const s = stateMap.get(opp.fromFacility.stateCode)
      if (s) s.transferOpps++
    }
  }

  return Array.from(stateMap.values()).sort((a, b) => b.revenue - a.revenue)
}

// ---------------------------------------------------------------------------
// Pipeline & financial aggregation
// ---------------------------------------------------------------------------

function aggregateInventoryAndSales(comparison: ComparisonData | undefined): {
  totalInventory: number
  totalWeeklySales: number
} {
  let totalInventory = 0
  let totalWeeklySales = 0
  const matrix = comparison?.matrix ?? {}
  for (const facilityId of Object.keys(matrix)) {
    const facData = matrix[facilityId]
    if (!facData) continue
    for (const category of Object.keys(facData)) {
      const cell = facData[category]
      if (!cell) continue
      totalInventory += cell.currentInventory
      totalWeeklySales += cell.weeklySalesRate
    }
  }
  return { totalInventory, totalWeeklySales }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const LOOKBACK_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 14, label: '14d' },
  { value: 30, label: '30d' },
  { value: 60, label: '60d' },
  { value: 90, label: '90d' },
  // Longer windows matter for outdoor operators (e.g. Example Farms — 2 harvests/year).
  // YTD is computed at component time so it reflects the current day-of-year.
  { value: Math.max(1, Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000)), label: 'YTD' },
  { value: 365, label: '365d' },
]

function LookbackSelector({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
      {LOOKBACK_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-3 py-1.5 text-sm rounded-md transition-colors',
            value === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/** Source attribution for data-backed KPIs (Revenue, Gross Margin). */
interface KpiSource {
  label: string
  tooltip?: string
  tone: 'metrc' | 'modeled' | 'warn'
}

// Local KpiTile removed — migrated to shared `KpiCard` from
// `@/shared/components/ui/kpi-card`. The shared primitive is the canonical
// instrument-panel KPI tile used across /executive, /executive/operations,
// and /operations.

/** Build a revenue source badge + subtitle from the pnl.source counts. */
function deriveRevenueSource(pnl: PnLData | undefined): { source?: KpiSource; subtitle?: string } {
  if (!pnl) return {}
  const { metrcSalesFacilityCount, opexFacilityCount, noDataFacilityCount } = pnl.source
  const total = metrcSalesFacilityCount + opexFacilityCount + noDataFacilityCount
  if (total === 0) return {}
  if (metrcSalesFacilityCount > 0 && opexFacilityCount === 0) {
    return {
      source: { label: '\u25CF Metrc', tone: 'metrc', tooltip: `From Metrc data across ${metrcSalesFacilityCount} facilities (retail sales + wholesale transfers)` },
      subtitle: pnl ? `last ${pnl.daysLookback}d` : undefined,
    }
  }
  if (metrcSalesFacilityCount === 0 && opexFacilityCount > 0) {
    return {
      source: { label: '\u25CF Modeled', tone: 'modeled', tooltip: `From OpEx models on ${opexFacilityCount} facilities` },
      subtitle: 'Annual (from OpEx models)',
    }
  }
  if (metrcSalesFacilityCount > 0 && opexFacilityCount > 0) {
    return {
      source: { label: '\u25CF Mixed', tone: 'warn', tooltip: `${metrcSalesFacilityCount} Metrc sales · ${opexFacilityCount} modeled` },
      subtitle: `${metrcSalesFacilityCount} Metrc \u00B7 ${opexFacilityCount} modeled`,
    }
  }
  return {
    source: { label: '\u25CF No data', tone: 'warn', tooltip: 'Connect Metrc or configure an OpEx model' },
    subtitle: undefined,
  }
}

function CriticalNumbers({
  opsSummary,
  pnl,
  daysOfSupply,
  loading,
}: {
  opsSummary: OpsSummaryData | undefined
  pnl: PnLData | undefined
  daysOfSupply: number | null
  loading: { pnl: boolean; ops: boolean; comp: boolean }
}) {
  const s = opsSummary?.summary
  const t = pnl?.totals
  const lookback = s?.daysLookback ?? 30
  const revenueSource = deriveRevenueSource(pnl)

  // Compute waste-rate value class — only metric where status color is
  // earned. Everything else stays neutral foreground so the row reads clean.
  const wasteValueClass = s
    ? s.wasteRatePercent > 5
      ? 'text-[hsl(var(--signal-critical))]'
      : s.wasteRatePercent > 2
        ? 'text-[hsl(var(--signal-caution))]'
        : 'text-foreground'
    : undefined

  // Period-over-period deltas. Only render when prior > 0 — division-by-zero
  // (no harvests last period) would surface as ∞%, which is misleading
  // signal: a fresh facility starting from nothing isn't "infinitely up."
  const harvestTrend = makePctTrend(s?.harvestIntakeLbsInWindow, s?.prior.harvestIntakeLbsInWindow, 'positive-up')
  const throughputTrend = makePctTrend(s?.throughputLbsInWindow, s?.prior.throughputLbsInWindow, 'positive-up')
  const wasteTrend = makePctTrend(s?.wasteRatePercent, s?.prior.wasteRatePercent, 'positive-down')
  // Revenue delta only surfaces when revenue is purely Metrc-derived
  // (retail or wholesale). OpEx-modeled revenue is static, so any "delta"
  // against it would be noise; mixed sources would compare apples to oranges.
  const revenueIsMetrcOnly = revenueSource.source?.label.includes('Metrc')
    && !revenueSource.source.label.includes('Mixed')
  const revenueTrend = revenueIsMetrcOnly
    ? makePctTrend(t?.revenue, pnl?.prior?.metrcRevenue, 'positive-up')
    : undefined

  // Gross Margin renders only when there's a real value to show (was
  // conditional in the original layout — preserved).
  const showGrossMargin = !!(t && t.grossMargin > 0)

  return (
    <div
      className={cn(
        'grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8',
        showGrossMargin ? 'lg:grid-cols-6' : 'lg:grid-cols-5',
      )}
    >
      <KpiCard
        icon={DollarSign}
        label="Revenue"
        value={t ? formatCurrency(t.revenue) : '—'}
        subtitle={revenueSource.subtitle ?? `last ${lookback}d`}
        source={revenueSource.source}
        trend={revenueTrend}
        loading={loading.pnl}
      />
      {showGrossMargin && (
        <KpiCard
          icon={TrendingUp}
          label="Gross Margin"
          value={`${t!.grossMargin.toFixed(1)}%`}
          subtitle={`${formatCurrency(t!.grossProfit)} profit`}
          source={revenueSource.source}
          loading={loading.pnl}
        />
      )}
      <KpiCard
        icon={Sprout}
        label="Wet Weight Harvested"
        value={s ? formatWeightTotal(s.harvestIntakeLbsInWindow) : '—'}
        subtitle={`last ${lookback}d`}
        sparkline={s?.dailyHarvestIntakeLbs}
        trend={harvestTrend}
        loading={loading.ops}
      />
      <KpiCard
        icon={Boxes}
        label="Throughput"
        value={s ? formatWeightTotal(s.throughputLbsInWindow) : '—'}
        subtitle={`last ${lookback}d`}
        sparkline={s?.dailyThroughputLbs}
        trend={throughputTrend}
        loading={loading.ops}
      />
      <KpiCard
        icon={Trash2}
        label="Waste Rate"
        value={s ? `${s.wasteRatePercent.toFixed(1)}%` : '—'}
        valueClass={wasteValueClass}
        trend={wasteTrend}
        loading={loading.ops}
      />
      <KpiCard
        icon={Clock}
        label="Days of Supply"
        value={daysOfSupply !== null ? `${daysOfSupply} days` : '—'}
        subtitle="Median across facilities"
        loading={loading.comp}
      />
    </div>
  )
}

/**
 * Build a `trend` payload for KpiCard from current and prior totals.
 * Returns undefined when the prior is missing or zero — see CriticalNumbers
 * comment for why we don't surface ∞% on cold starts.
 */
function makePctTrend(
  current: number | undefined,
  prior: number | undefined,
  sentiment: 'positive-up' | 'positive-down',
): { value: number; sentiment: 'positive-up' | 'positive-down' } | undefined {
  if (current === undefined || prior === undefined || prior === 0) return undefined
  return { value: ((current - prior) / prior) * 100, sentiment }
}

function StateCard({ state }: { state: StateOverview }) {
  return (
    <Link
      href={`/executive/states/${state.stateCode}`}
      className="surface-rule-row block border border-border bg-card p-5 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <StateOutline
            stateCode={state.stateCode}
            size={20}
            className="text-muted-foreground"
          />
          <span className="font-numeric tabular-nums text-2xl text-foreground font-medium">
            {state.stateCode}
          </span>
          <span className="text-[10px] uppercase tracking-instrument text-muted-foreground">
            {state.facilityCount}{' '}
            {state.facilityCount === 1 ? 'facility' : 'facilities'}
          </span>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground">Revenue</span>
          <p className="font-semibold tabular-nums">
            {formatCurrency(state.revenue)}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Margin</span>
          <p className="font-semibold tabular-nums">
            {state.grossMargin.toFixed(1)}%
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Alerts</span>
          <p
            className={cn(
              'font-semibold tabular-nums',
              state.totalAlerts > 0 ? 'text-red-500' : 'text-muted-foreground',
            )}
          >
            {state.totalAlerts}
          </p>
        </div>
      </div>

      {state.transferOpps > 0 && (
        <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 text-xs"
             style={{ color: 'hsl(var(--signal-caution))' }}>
          <AlertTriangle className="h-3 w-3" />
          {state.transferOpps} transfer{' '}
          {state.transferOpps === 1 ? 'opportunity' : 'opportunities'}
        </div>
      )}
    </Link>
  )
}

function AlertSeverityPills({
  breakdown,
}: {
  breakdown: { critical: number; warning: number; info: number }
}) {
  const total = breakdown.critical + breakdown.warning + breakdown.info
  if (total === 0) {
    return <span className="text-muted-foreground tabular-nums">0</span>
  }
  return (
    <div className="inline-flex items-center justify-end gap-1 tabular-nums">
      {breakdown.critical > 0 && (
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-500"
          title={`${breakdown.critical} critical`}
        >
          {breakdown.critical}C
        </span>
      )}
      {breakdown.warning > 0 && (
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500"
          title={`${breakdown.warning} warning`}
        >
          {breakdown.warning}W
        </span>
      )}
      {breakdown.info > 0 && (
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400"
          title={`${breakdown.info} info`}
        >
          {breakdown.info}I
        </span>
      )}
    </div>
  )
}

function FacilityHealthTable({
  facilities,
}: {
  facilities: FacilityWithHealth[]
}) {
  const [expanded, setExpanded] = useState(true)
  // Sort descending by alert count so the most-pressing facilities surface
  // first. Never-synced facilities (no signal) drop to the end.
  const sorted = useMemo(
    () =>
      [...facilities].sort((a, b) => {
        const aNeverSynced = a.lastSyncAt === null
        const bNeverSynced = b.lastSyncAt === null
        if (aNeverSynced && !bNeverSynced) return 1
        if (!aNeverSynced && bNeverSynced) return -1
        return b.alertCount - a.alertCount
      }),
    [facilities],
  )

  return (
    <div className="card-modern">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <h2 className="text-sm font-semibold">Facility Status</h2>
          <span className="text-xs text-muted-foreground">
            ({facilities.length}{' '}
            {facilities.length === 1 ? 'facility' : 'facilities'})
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-5 pb-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-2 font-medium text-muted-foreground">
                  Facility
                </th>
                <th className="text-left px-2 py-2 font-medium text-muted-foreground">
                  State
                </th>
                <th className="text-left px-2 py-2 font-medium text-muted-foreground">
                  Type
                </th>
                <th
                  className="text-right px-2 py-2 font-medium text-muted-foreground"
                  title="Open compliance alerts — Critical / Warning / Info"
                >
                  Alerts
                </th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">
                  Last Sync
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) => (
                <tr
                  key={f.id}
                  className="border-b border-border/50 hover:bg-accent/30 transition-colors"
                >
                  <td className="px-2 py-2">
                    <Link
                      href={`/facilities/${f.id}/inventory`}
                      className="font-medium hover:text-primary transition-colors"
                    >
                      {f.name}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {f.stateCode}
                  </td>
                  <td className="px-2 py-2">
                    {f.facilityType && (
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded border',
                          FACILITY_TYPE_COLORS[f.facilityType] ??
                            'bg-muted text-muted-foreground border-border',
                        )}
                      >
                        {f.facilityType}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <AlertSeverityPills breakdown={f.alertBreakdown} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {f.lastSyncStatus === 'FAILED' ? (
                        <WifiOff className="h-3 w-3 text-red-500" />
                      ) : f.lastSyncStatus === 'SUCCESS' ? (
                        <Wifi className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Wifi className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span
                        className={cn(
                          'text-xs',
                          f.lastSyncStatus === 'FAILED'
                            ? 'text-red-500'
                            : 'text-muted-foreground',
                        )}
                      >
                        {f.lastSyncAt
                          ? formatDistanceToNow(new Date(f.lastSyncAt))
                          : 'Never'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cash Pipeline
// ---------------------------------------------------------------------------

interface PipelineStage {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  subtext?: string
  /** Hover tooltip explaining what this number represents. */
  tooltip?: string
  color: string
  bgColor: string
}

type StagePackageCounts =
  inferRouterOutputs<AppRouter>['crossFacility']['getStagePackageCounts']

function CashPipeline({
  opsSummary,
  comparison,
  pnl,
  loading,
}: {
  opsSummary: OpsSummaryData | undefined
  comparison: ComparisonData | undefined
  pnl: PnLData | undefined
  loading: boolean
}) {
  const s = opsSummary?.summary
  const t = pnl?.totals
  const { totalInventory, totalWeeklySales } =
    aggregateInventoryAndSales(comparison)
  const lookback = s?.daysLookback ?? 30

  // Yield is a ratio — same whether computed from totals or per-week rates.
  const efficiency =
    s && s.harvestIntakeLbsInWindow > 0
      ? ((s.throughputLbsInWindow / s.harvestIntakeLbsInWindow) * 100).toFixed(1)
      : null

  const stages: PipelineStage[] = [
    {
      icon: Sprout,
      label: 'Harvest',
      value: s ? formatWeightTotal(s.harvestIntakeLbsInWindow) : '\u2014',
      subtext: `wet weight \u00B7 last ${lookback}d`,
      tooltip: 'Reconstructed wet weight from harvests finished in the selected window. Pounds converted from Metrc UnitOfWeight.',
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-500/10',
    },
    {
      icon: Boxes,
      label: 'Processing',
      value: s ? formatWeightTotal(s.throughputLbsInWindow) : '\u2014',
      subtext: efficiency ? `${efficiency}% yield` : `last ${lookback}d`,
      tooltip: 'Total packaged weight from harvests finished in the selected window. Yield = throughput / intake.',
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      icon: Package,
      label: 'Inventory',
      value: loading ? '\u2014' : `${formatNumber(totalInventory)} pkgs`,
      subtext:
        totalWeeklySales > 0 && totalInventory > 0
          ? `${(totalInventory / totalWeeklySales).toFixed(1)} wks supply`
          : undefined,
      tooltip: 'Total active Metrc packages across all facilities and categories. Each package has its own unit of measure (grams, each, etc.).',
      color: 'text-cyan-500',
      bgColor: 'bg-cyan-500/10',
    },
    {
      icon: DollarSign,
      label: 'Sales',
      value: loading
        ? '\u2014'
        : `${formatNumber(totalWeeklySales)} pkg qty/wk`,
      subtext: t && t.revenue > 0
        ? `${formatCurrency(t.revenue)} revenue`
        : 'Connect Metrc or configure OpEx',
      tooltip: 'Weekly sales velocity from POS or transfer data. Quantity is in each package\u2019s unit of measure (grams, each, etc.) — not a uniform unit.',
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-500/10',
    },
  ]

  return (
    <div className="card-modern p-5 mb-8">
      <div className="flex items-center gap-2 mb-5">
        <TrendingUp className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Cash Pipeline</h2>
        <span className="text-xs text-muted-foreground">
          Harvest to revenue flow
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {stages.map((stage, idx) => (
          <div key={stage.label} className="flex items-stretch gap-2">
            <div
              className={cn(
                'flex-1 rounded-lg border border-border p-4',
                stage.bgColor,
              )}
              title={stage.tooltip}
            >
              <div className="flex items-center gap-2 mb-2">
                <stage.icon className={cn('h-4 w-4', stage.color)} />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {stage.label}
                </span>
              </div>
              <p
                className={cn(
                  'text-lg font-bold tabular-nums',
                  stage.color,
                )}
              >
                {loading ? '\u2014' : stage.value}
              </p>
              {stage.subtext && (
                <p className="text-xs text-muted-foreground mt-1">
                  {stage.subtext}
                </p>
              )}
            </div>
            {idx < stages.length - 1 && (
              <div className="hidden lg:flex items-center">
                <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
              </div>
            )}
          </div>
        ))}
      </div>

    </div>
  )
}

// ---------------------------------------------------------------------------
// Production Pipeline — operational status pills (Curing / Decon / Copack /
// Queue). Counts active packages whose LocationName matches a configured
// Metrc room. Distinct from Cash Pipeline (financial flow): these are
// parallel operational stages, not a sequential harvest→revenue flow.
// ---------------------------------------------------------------------------

function ProductionPipeline({
  stageCounts,
  loading,
}: {
  stageCounts: StagePackageCounts | undefined
  loading: boolean
}) {
  return (
    <div className="card-modern p-5 mb-8">
      <div className="flex items-center gap-2 mb-5">
        <Activity className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Production Pipeline</h2>
        <span className="text-xs text-muted-foreground">
          Active packages by Metrc room
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {STAGE_ROOM_MAPPINGS.map((cfg) => {
          const entry = stageCounts?.stages.find((s) => s.stage === cfg.stage)
          const showCount = !loading && stageCounts !== undefined
          return (
            <div
              key={cfg.stage}
              className={cn(
                'rounded-lg border border-border p-4',
                cfg.bgColor,
              )}
              title={cfg.tooltip}
            >
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {cfg.label}
              </span>
              <p
                className={cn(
                  'text-lg font-bold tabular-nums mt-2',
                  cfg.color,
                )}
              >
                {showCount && entry
                  ? `${formatNumber(entry.packageCount)} pkgs`
                  : '\u2014'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {cfg.rooms.length > 0
                  ? cfg.rooms.join(', ')
                  : 'Definition pending'}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// License Expiry Tracker
// ---------------------------------------------------------------------------

interface LicenseAlert {
  facilityId: string
  facilityName: string
  stateCode: string
  licenseNumber: string
  expiryDate: Date
  daysUntilExpiry: number
}

function extractLicenseAlerts(
  facilities: FacilityWithHealth[] | undefined,
): LicenseAlert[] {
  if (!facilities) return []
  const now = new Date()
  const alerts: LicenseAlert[] = []

  for (const f of facilities) {
    if (!f.licenseExpiryDate) continue
    const expiry = new Date(f.licenseExpiryDate)
    const daysUntil = Math.ceil(
      (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    )
    if (daysUntil <= 90) {
      alerts.push({
        facilityId: f.id,
        facilityName: f.name,
        stateCode: f.stateCode,
        licenseNumber: f.licenseNumber,
        expiryDate: expiry,
        daysUntilExpiry: daysUntil,
      })
    }
  }

  return alerts.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
}

function expiryUrgency(days: number): { label: string; color: string; bg: string } {
  if (days <= 0)
    return { label: 'EXPIRED', color: 'text-red-500', bg: 'bg-red-500/10' }
  if (days <= 30)
    return { label: `${days}d`, color: 'text-red-500', bg: 'bg-red-500/10' }
  if (days <= 60)
    return { label: `${days}d`, color: 'text-orange-500', bg: 'bg-orange-500/10' }
  return { label: `${days}d`, color: 'text-yellow-500', bg: 'bg-yellow-500/10' }
}

function LicenseExpiryTracker({
  facilities,
}: {
  facilities: FacilityWithHealth[] | undefined
}) {
  const alerts = useMemo(() => extractLicenseAlerts(facilities), [facilities])
  if (alerts.length === 0) return null

  const expiredCount = alerts.filter((a: LicenseAlert) => a.daysUntilExpiry <= 0).length

  return (
    <div className="card-modern p-5 mb-8">
      <div className="flex items-center gap-2 mb-4">
        <ShieldAlert
          className={cn(
            'h-5 w-5',
            expiredCount > 0 ? 'text-red-500' : 'text-amber-500',
          )}
        />
        <h2 className="text-lg font-semibold">License Renewals</h2>
        <span className="text-xs text-muted-foreground">
          {alerts.length} licens{alerts.length === 1 ? 'e' : 'es'} expiring within 90 days
        </span>
      </div>
      <div className="space-y-2">
        {alerts.map((a: LicenseAlert) => {
          const urgency = expiryUrgency(a.daysUntilExpiry)
          return (
            <div
              key={a.facilityId}
              className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded font-semibold',
                    urgency.bg,
                    urgency.color,
                  )}
                >
                  {urgency.label}
                </span>
                <div>
                  <Link
                    href={`/facilities/${a.facilityId}/inventory`}
                    className="text-sm font-medium hover:text-primary transition-colors"
                  >
                    {a.facilityName}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {a.stateCode} &middot; {a.licenseNumber}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className={cn('text-sm font-medium', urgency.color)}>
                  {a.daysUntilExpiry <= 0
                    ? 'Expired'
                    : `Expires ${a.expiryDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}`}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Runout Alerts
// ---------------------------------------------------------------------------

interface RunoutItem {
  facilityId: string
  facilityName: string
  category: string
  weeksOfSupply: number | null
  currentInventory: number
  weeklySalesRate: number
  status: 'critical' | 'low'
}

function extractRunoutAlerts(
  comparison: ComparisonData | undefined,
  openPOCategories?: Record<string, string[]>,
): RunoutItem[] {
  if (!comparison) return []
  const alerts: RunoutItem[] = []
  const facilityMap = new Map<string, string>(
    comparison.facilities.map((f: ComparisonData['facilities'][number]) => [f.id, f.name]),
  )
  const matrix = comparison.matrix ?? {}

  for (const facilityId of Object.keys(matrix)) {
    const facData = matrix[facilityId]
    if (!facData) continue
    // Build set of categories with open POs for this facility
    const poCategories = openPOCategories?.[facilityId]
      ? new Set(openPOCategories[facilityId])
      : null
    for (const category of Object.keys(facData)) {
      const cell = facData[category]
      if (!cell) continue
      if (cell.status === 'critical' || cell.status === 'low') {
        // Suppress alert if an open PO covers this category
        if (poCategories?.has(category)) continue
        alerts.push({
          facilityId,
          facilityName: facilityMap.get(facilityId) ?? facilityId,
          category,
          weeksOfSupply: cell.weeksOfSupply,
          currentInventory: cell.currentInventory,
          weeklySalesRate: cell.weeklySalesRate,
          status: cell.status,
        })
      }
    }
  }

  return alerts.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'critical' ? -1 : 1
    return (a.weeksOfSupply ?? 0) - (b.weeksOfSupply ?? 0)
  })
}

function RunoutAlerts({
  comparison,
  openPOCategories,
  limit = 10,
}: {
  comparison: ComparisonData | undefined
  openPOCategories?: Record<string, string[]>
  limit?: number
}) {
  const alerts = useMemo(
    () => extractRunoutAlerts(comparison, openPOCategories),
    [comparison, openPOCategories],
  )
  if (alerts.length === 0) return null

  const criticalCount = alerts.filter((a: RunoutItem) => a.status === 'critical').length

  return (
    <div className="card-modern p-5 mb-8">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className={cn('h-5 w-5', criticalCount > 0 ? 'text-red-500' : 'text-yellow-500')} />
        <h2 className="text-lg font-semibold">Runout Alerts</h2>
        <span className="text-xs text-muted-foreground">
          {alerts.length} categor{alerts.length === 1 ? 'y' : 'ies'} low on stock
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Facility</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Category</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Inventory</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Units/Week</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Supply Left</th>
            </tr>
          </thead>
          <tbody>
            {alerts.slice(0, limit).map((a: RunoutItem, i: number) => (
              <tr
                key={`${a.facilityId}-${a.category}-${i}`}
                className="border-b border-border/50 hover:bg-accent/30 transition-colors"
              >
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase',
                      a.status === 'critical'
                        ? 'bg-red-500/10 text-red-500'
                        : 'bg-yellow-500/10 text-yellow-500',
                    )}
                  >
                    {a.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/facilities/${a.facilityId}/inventory`}
                    className="font-medium hover:text-primary transition-colors"
                  >
                    {a.facilityName}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{a.category}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {a.currentInventory.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {a.weeklySalesRate.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={cn(
                      'tabular-nums font-semibold',
                      a.status === 'critical' ? 'text-red-500' : 'text-yellow-500',
                    )}
                  >
                    {a.weeksOfSupply !== null
                      ? `${a.weeksOfSupply.toFixed(1)} wks`
                      : 'No velocity'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {alerts.length > limit && (
          <div className="flex items-center justify-between mt-3 px-3">
            <p className="text-xs text-muted-foreground">
              +{alerts.length - limit} more categor{alerts.length - limit === 1 ? 'y' : 'ies'} at risk
            </p>
            <Link
              href="/executive/operations"
              className="text-xs text-primary hover:underline"
            >
              View all alerts →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Run Rate Snapshot — median weeks-of-supply per category across the org.
// Reads from the already-loaded comparison matrix, no new query.
// ---------------------------------------------------------------------------

interface CategoryMedian {
  category: string
  medianWeeks: number
  sampleSize: number
  /** Sum of weekly sales across facilities — used to pick the top-N most relevant categories. */
  totalWeeklySales: number
}

function computeCategoryMedians(comparison: ComparisonData | undefined): CategoryMedian[] {
  if (!comparison) return []
  const byCategory = new Map<string, { weeks: number[]; sales: number }>()
  for (const facilityId of Object.keys(comparison.matrix)) {
    const row = comparison.matrix[facilityId]
    for (const category of Object.keys(row)) {
      const cell = row[category]
      if (!cell) continue
      const entry = byCategory.get(category) ?? { weeks: [], sales: 0 }
      if (cell.weeksOfSupply !== null) entry.weeks.push(cell.weeksOfSupply)
      entry.sales += cell.weeklySalesRate
      byCategory.set(category, entry)
    }
  }
  const medians: CategoryMedian[] = []
  for (const [category, { weeks, sales }] of Array.from(byCategory.entries())) {
    if (weeks.length === 0) continue
    const sorted = [...weeks].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median =
      sorted.length % 2 === 1
        ? sorted[mid]!
        : (sorted[mid - 1]! + sorted[mid]!) / 2
    medians.push({
      category,
      medianWeeks: Math.round(median * 10) / 10,
      sampleSize: sorted.length,
      totalWeeklySales: sales,
    })
  }
  // Prioritize categories that actually move — sort by total weekly sales desc.
  return medians.sort((a, b) => b.totalWeeklySales - a.totalWeeklySales)
}

// Map a Metrc category name to a small lucide icon. Pure function — keyed
// on lower-cased substring matches so it's resilient to "Buds (Flower)",
// "Concentrate (Bulk)", etc. Falls back to a neutral Package icon.
function categoryIcon(category: string): React.ComponentType<{ className?: string }> {
  const c = category.toLowerCase()
  if (c.includes('flower') || c.includes('buds') || c.includes('shake') || c.includes('trim')) return Sprout
  if (c.includes('pre-roll') || c.includes('preroll') || c.includes('joint')) return Flame
  if (c.includes('edible')) return Cookie
  if (c.includes('vape') || c.includes('cartridge')) return Wind
  if (c.includes('beverage') || c.includes('drink')) return Coffee
  if (c.includes('bulk')) return Box
  if (c.includes('concentrate') || c.includes('extract') || c.includes('rosin') || c.includes('hash')) return Droplet
  return Package
}

function RunRateSnapshot({ comparison }: { comparison: ComparisonData | undefined }) {
  const medians = useMemo(
    () => computeCategoryMedians(comparison).slice(0, 8),
    [comparison],
  )
  if (medians.length === 0) return null

  // Only the worst-cases get color signaling; mid/high supply renders neutral
  // so the row reads as a calm row of categories with the few outliers obvious.
  const colorFor = (weeks: number): string => {
    if (weeks < 1) return 'text-[hsl(var(--signal-critical))]'
    if (weeks < 4) return 'text-[hsl(var(--signal-caution))]'
    return 'text-foreground'
  }

  return (
    <div className="card-modern p-5 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Run Rate Snapshot</h2>
          <span className="text-xs text-muted-foreground">
            Median weeks of supply by category
          </span>
        </div>
        <Link
          href="/operations"
          className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
        >
          View full heatmap <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {medians.map((m) => {
          const Icon = categoryIcon(m.category)
          return (
            <div
              key={m.category}
              className="border border-border bg-card p-3 min-w-0"
              title={`Median across ${m.sampleSize} ${m.sampleSize === 1 ? 'facility' : 'facilities'}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <p className="text-[10px] text-muted-foreground uppercase tracking-instrument truncate">
                  {m.category}
                </p>
              </div>
              <p className={cn('text-lg font-numeric font-medium tabular-nums', colorFor(m.medianWeeks))}>
                {m.medianWeeks}w
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AI Briefing — org-wide rollup
// ---------------------------------------------------------------------------

/**
 * Map a backend topIssue action to its specific deep-link path. Mirrors the
 * `link` field on getBriefing's insight payload — the rollup row's per-issue
 * badge sends the user to the same place the per-facility briefing would.
 */
function issueHref(
  facilityId: string,
  action: BriefingRollupRow['topIssues'][number]['action'],
): string {
  switch (action) {
    case 'audit': return `/facilities/${facilityId}/compliance/audit`
    case 'aging': return `/facilities/${facilityId}/inventory/aging`
    case 'fifo': return `/facilities/${facilityId}/inventory/aging`
    case 'deadstock': return `/facilities/${facilityId}/inventory`
    case 'onhold': return `/facilities/${facilityId}/compliance`
    default: return `/facilities/${facilityId}/inventory`
  }
}

function OrgBriefingRollup() {
  const { data: rollup, isLoading } = trpc.crossFacility.getBriefingRollup.useQuery(
    undefined,
    { staleTime: 300_000 },
  )

  // Severity → border-left color (CSS variable, semantic). No fill backgrounds.
  // Each facility row renders as a flat row with a 2px left-rule, no rounded chrome.
  const severityBorderColor: Record<'critical' | 'warning' | 'ok', string> = {
    critical: 'hsl(var(--signal-critical))',
    warning: 'hsl(var(--signal-caution))',
    ok: 'hsl(var(--border))',
  }

  if (!isLoading && rollup && rollup.facilities.length === 0) return null

  const totals = rollup?.totals
  const facilities = rollup?.facilities ?? []

  return (
    <div className="border border-border bg-card mb-8">
      {/* Header — section label on the left, summary chips on the right */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] font-sans uppercase tracking-instrument text-muted-foreground">
            AI Briefing
          </span>
          <span className="text-[10px] uppercase tracking-instrument text-muted-foreground/60 border-l border-border pl-2">
            Org-wide rollup
          </span>
        </div>
        {totals && (
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-instrument text-muted-foreground">
            <span>{totals.activeFacilities} {totals.activeFacilities === 1 ? 'facility' : 'facilities'}</span>
            {totals.totalCriticalCount > 0 && (
              <span style={{ color: 'hsl(var(--signal-critical))' }}>
                {totals.totalCriticalCount} critical
              </span>
            )}
            {totals.totalWarningCount > 0 && (
              <span style={{ color: 'hsl(var(--signal-caution))' }}>
                {totals.totalWarningCount} warning{totals.totalWarningCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="p-5">
        {isLoading ? (
          // Skeleton mirrors the loaded shape (KPI strip + 5 facility rows)
          // so the page below doesn't jump ~250px when the rollup resolves.
          <>
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <div className="h-5 w-28 bg-muted/30 rounded animate-pulse" />
              <div className="h-5 w-20 bg-muted/30 rounded animate-pulse" />
              <div className="h-5 w-24 bg-muted/30 rounded animate-pulse" />
              <div className="h-5 w-24 bg-muted/30 rounded animate-pulse" />
            </div>
            <div className="space-y-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-9 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          </>
        ) : totals && facilities.length > 0 ? (
          <>
            {/* Aggregate stats — same KPIs as the prior single-facility briefing
                but rolled up across the org (weighted by package count). */}
            <div className="flex flex-wrap items-center gap-4 text-sm mb-4">
              <div className="flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Packages:</span>
                <span className="font-semibold tabular-nums">{totals.totalPackages.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Audit:</span>
                <span
                  className="font-numeric tabular-nums font-semibold"
                  style={{
                    color: totals.avgAuditScore >= 80
                      ? 'hsl(var(--primary))'
                      : totals.avgAuditScore >= 60
                        ? 'hsl(var(--signal-caution))'
                        : 'hsl(var(--signal-critical))',
                  }}
                >
                  {totals.avgAuditScore}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Avg age:</span>
                <span className="font-semibold tabular-nums">{totals.avgAgeDays}d</span>
              </div>
              {totals.avgWeeksOfSupply !== null && (
                <div className="flex items-center gap-1.5">
                  <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Supply:</span>
                  <span className="font-semibold tabular-nums">
                    {totals.avgWeeksOfSupply.toFixed(1)} wks
                  </span>
                </div>
              )}
            </div>

            {/* Ranked facility list. Already sorted server-side by criticality.
                Each row is NOT a single click target — the facility name links
                to the facility's default page, and each issue badge links to
                that issue's specific page. Sending users to a generic Copilot
                chat when they clicked "124 aging" was the wrong destination. */}
            <div className="space-y-1.5">
              {facilities.map((f: BriefingRollupRow) => {
                const severity: 'critical' | 'warning' | 'ok' =
                  f.criticalCount > 0 ? 'critical' : f.warningCount > 0 ? 'warning' : 'ok'
                return (
                  <div
                    key={f.id}
                    className="flex items-center gap-3 border-l-rule px-3 py-2 hover:bg-muted/30 transition-colors"
                    style={{ borderLeftColor: severityBorderColor[severity] }}
                  >
                    <Link
                      href={`/facilities/${f.id}${getDefaultFacilityPage(f.facilityType)}`}
                      className="font-medium text-sm truncate min-w-0 hover:text-primary transition-colors"
                    >
                      {f.name}
                    </Link>
                    <span className="font-numeric tabular-nums text-xs text-muted-foreground shrink-0">
                      {f.stateCode}
                    </span>
                    {/* Per-row stats — fill the dead horizontal whitespace
                        between facility name and issue badges with the four
                        underlying briefing metrics. Muted styling so the
                        colored issue badges still own visual priority. */}
                    <div className="flex-1 hidden md:flex items-center justify-end gap-3 text-[10px] tabular-nums text-muted-foreground/80">
                      <span title="Active packages">
                        {f.totalPackages.toLocaleString()} pkgs
                      </span>
                      <span
                        title="Audit score"
                        style={{
                          color: f.auditScore >= 80
                            ? 'hsl(var(--primary))'
                            : f.auditScore >= 60
                              ? 'hsl(var(--signal-caution))'
                              : 'hsl(var(--signal-critical))',
                        }}
                      >
                        audit {f.auditScore}
                      </span>
                      <span title="Average package age">
                        {f.averageAgeDays}d avg
                      </span>
                      {f.weeksOfSupply !== null && (
                        <span title="Weeks of supply">
                          {f.weeksOfSupply.toFixed(1)}w
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {f.topIssues.length > 0 ? (
                        f.topIssues.map((issue: BriefingRollupRow['topIssues'][number], i: number) => (
                          <Link
                            key={i}
                            href={issueHref(f.id, issue.action)}
                            className="text-[10px] tabular-nums border-l-rule pl-1.5 hover:opacity-80 transition-opacity"
                            style={{
                              color: issue.severity === 'critical'
                                ? 'hsl(var(--signal-critical))'
                                : 'hsl(var(--signal-caution))',
                              borderLeftColor: issue.severity === 'critical'
                                ? 'hsl(var(--signal-critical))'
                                : 'hsl(var(--signal-caution))',
                            }}
                          >
                            {issue.label}
                          </Link>
                        ))
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-instrument"
                          style={{ color: 'hsl(var(--primary))' }}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          All clear
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">
            No accessible facilities to brief.
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Deep-Dive Link Cards
// ---------------------------------------------------------------------------

function DeepDiveCards({
  opsSummary,
}: {
  opsSummary: OpsSummaryData | undefined
}) {
  const s = opsSummary?.summary

  // Flat structured nav: one bordered container, hairline-divided rows.
  // Each row uses surface-rule-row for left-rail accent on hover. No
  // colored icon backgrounds, no rounded-lg tiles, no per-row hover-glow.
  // Category Margins + 280E Tax hidden from this view.
  const items = [
    {
      href: '/executive/quality',
      icon: FlaskConical,
      title: 'Quality & Lab Testing',
      detail: 'Pass rates, risk strains, lab turnaround',
    },
    {
      href: '/executive/operations',
      icon: TrendingUp,
      title: 'Yield & Cycle',
      detail: s
        ? `${s.wasteRatePercent.toFixed(1)}% waste · ${s.activeFacilities} facilities`
        : 'Cultivation efficiency, waste, and cycle time',
    },
  ]

  return (
    <div className="border border-border bg-card mt-8 mb-4">
      <div className="px-5 py-3 border-b border-border">
        <span className="text-[10px] font-sans uppercase tracking-instrument text-muted-foreground">
          Deep Dives
        </span>
      </div>
      {items.map((item, idx) => {
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'surface-rule-row group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40',
              idx < items.length - 1 && 'border-b border-border',
            )}
          >
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-sans font-medium text-sm">{item.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {item.detail}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground/50 shrink-0 transition-colors group-hover:text-foreground" />
          </Link>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ExecutivePage() {
  const { data: session } = useSession()
  const [daysLookback, setDaysLookback] = useState(30)

  // Cross-facility / snapshot-backed queries — bumped staleTime to 10min
  // (was 5min). After the snapshot-first migration these read from a daily-
  // refreshed DB snapshot, not the live Metrc API, so 5-min freshness was
  // overly aggressive and double-fetched on tab focus changes.
  const { data: opsSummary, isLoading: opsLoading } =
    trpc.crossFacility.getOperationsSummary.useQuery(
      { daysLookback },
      { staleTime: 600_000 },
    )

  const { data: comparison, isLoading: compLoading } =
    trpc.crossFacility.getRunRateComparison.useQuery(
      { groupBy: 'state', daysLookback },
      { staleTime: 600_000 },
    )

  const { data: pnl, isLoading: pnlLoading } =
    trpc.financial.getConsolidatedPnL.useQuery(
      { groupBy: 'state', daysLookback },
      { staleTime: 600_000 },
    )

  const { data: facilitiesWithHealth, isLoading: facilitiesLoading } =
    trpc.facility.listWithHealth.useQuery(undefined, { staleTime: 600_000 })

  const { data: openPOCategories } =
    trpc.crossFacility.getOpenPOCategories.useQuery(undefined, { staleTime: 600_000 })

  const { data: stageCounts } =
    trpc.crossFacility.getStagePackageCounts.useQuery(undefined, { staleTime: 600_000 })

  // Memoize derived values — both walk the comparison matrix per render
  // (O(F·C)). Without these, every greeting re-render or LookbackSelector
  // click recomputes through ~30 facilities × ~10 categories.
  const daysOfSupply = useMemo(
    () => computeMedianDaysOfSupply(comparison?.facilities ?? []),
    [comparison?.facilities],
  )

  const stateOverview = useMemo(
    () => buildStateOverview(comparison, pnl, facilitiesWithHealth),
    [comparison, pnl, facilitiesWithHealth],
  )

  const firstName = session?.user?.name?.split(' ')[0] ?? 'there'

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">
            {getGreeting()}, {firstName}
          </h1>
          <p className="text-muted-foreground mt-1">
            Multi-state operations overview
          </p>
        </div>
        <LookbackSelector value={daysLookback} onChange={setDaysLookback} />
      </div>

      {/* Pulse model — layout order:
          AI Briefing (hero) → Critical Numbers → Operational Detail
          → Risk row → Deep-dive tiles → collapsed: State & Facility Health */}

      {/* 1. AI Briefing — synthesis hero. Always mount so its skeleton can
          reserve space during initial load (the component returns null when
          the rollup resolves with zero accessible facilities). */}
      <OrgBriefingRollup />

      {/* 2. Critical Numbers — verification surface for the synthesis above */}
      <CriticalNumbers
        opsSummary={opsSummary}
        pnl={pnl}
        daysOfSupply={daysOfSupply}
        loading={{ pnl: pnlLoading, ops: opsLoading, comp: compLoading }}
      />

      {/* 3. Operational Detail — Cash Pipeline + Run Rate Snapshot.
          Promoted from collapsed section 6 to inline section 3. */}
      <CashPipeline
        opsSummary={opsSummary}
        comparison={comparison}
        pnl={pnl}
        loading={opsLoading || compLoading || pnlLoading}
      />
      <ProductionPipeline
        stageCounts={stageCounts}
        loading={opsLoading || compLoading || pnlLoading}
      />
      <RunRateSnapshot comparison={comparison} />

      {/* 4. Risk row — what needs action right now */}
      <LicenseExpiryTracker facilities={facilitiesWithHealth} />
      <RunoutAlerts comparison={comparison} openPOCategories={openPOCategories} limit={3} />

      {/* 5. Deep-Dive tiles — primary navigation surface */}
      <DeepDiveCards opsSummary={opsSummary} />

      {/* 6. Collapsed: per-state and per-facility verification surface */}
      <details className="card-modern p-5 mb-4 group">
        <summary className="flex items-center justify-between cursor-pointer list-none">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">State &amp; Facility Health</h2>
            <span className="text-xs text-muted-foreground">
              {(facilitiesWithHealth?.length ?? 0)} facilities · {stateOverview.length} state{stateOverview.length === 1 ? '' : 's'}
            </span>
          </div>
          <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
          <span className="text-xs text-muted-foreground hidden group-open:inline">Hide</span>
        </summary>
        <div className="mt-4 space-y-6">
          {stateOverview.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stateOverview.map((state) => (
                <StateCard key={state.stateCode} state={state} />
              ))}
            </div>
          ) : (compLoading || pnlLoading || facilitiesLoading) ? (
            <div className="text-center py-8 text-muted-foreground">Loading state data…</div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">No facilities found.</div>
          )}
          {facilitiesWithHealth && facilitiesWithHealth.length > 0 && (
            <FacilityHealthTable facilities={facilitiesWithHealth} />
          )}
        </div>
      </details>
    </div>
  )
}
