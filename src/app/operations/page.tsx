'use client'

import { useState, useCallback } from 'react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { TransferOpportunityRow } from '@/features/transfers/components/TransferOpportunityRow'
import {
  Building2,
  Package,
  Truck,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Sprout,
  Clock,
  Boxes,
  Trash2,
} from 'lucide-react'
import { FACILITY_TYPE_COLORS } from '@/shared/constants/facility-types'
import { KpiCard } from '@/shared/components/ui/kpi-card'
import {
  computeMedianDaysOfSupply,
  wasteRateStyle,
} from '@/shared/utils/run-rate-medians'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type RouterOutputs = inferRouterOutputs<AppRouter>
type ComparisonData = RouterOutputs['crossFacility']['getRunRateComparison']
type FacilityInfo = ComparisonData['facilities'][number]
type CellData = NonNullable<ComparisonData['matrix'][string]>[string]
type TransferOpp = ComparisonData['transferOpportunities'][number]
type OpsSummaryData = RouterOutputs['crossFacility']['getOperationsSummary']

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type GroupBy = 'none' | 'state' | 'facilityType'

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'All Facilities' },
  { value: 'state', label: 'By State' },
  { value: 'facilityType', label: 'By Type' },
]

const LOOKBACK_OPTIONS = [
  { value: 7, label: '7d' },
  { value: 14, label: '14d' },
  { value: 30, label: '30d' },
  { value: 60, label: '60d' },
  { value: 90, label: '90d' },
]

const STATUS_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400',
  low: 'bg-yellow-500/20 text-yellow-400',
  healthy: 'bg-emerald-500/20 text-emerald-400',
  excess: 'bg-blue-500/20 text-blue-400',
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OperationsPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [daysLookback, setDaysLookback] = useState(30)

  const { data, isLoading } = trpc.crossFacility.getRunRateComparison.useQuery(
    { groupBy, daysLookback },
    { staleTime: 600_000 },
  )

  const { data: opsSummary, isLoading: opsLoading } = trpc.crossFacility.getOperationsSummary.useQuery(
    { daysLookback },
    { staleTime: 600_000 },
  )

  const summary = data?.summary
  const facilities = data?.facilities ?? []
  const categories = data?.categories ?? []
  const matrix = data?.matrix ?? {}
  const transferOpportunities = data?.transferOpportunities ?? []
  const groups = data?.groups ?? []

  // Skipped run-rate facilities are now inlined into `facilities` with
  // dataSource: 'none' — the heatmap renders them with a "No data" badge.
  // opsSummary skipped is for the harvest KPI strip only (not the heatmap).

  // Median days-of-supply from comparison data — extracted to shared util.
  const daysOfSupply = computeMedianDaysOfSupply(facilities)

  const summaryCards = [
    {
      label: 'Active Facilities',
      value: summary?.activeFacilities ?? 0,
      icon: Building2,
      color: 'text-primary',
    },
    {
      label: 'Categories Tracked',
      value: categories.length,
      icon: Package,
      color: 'text-blue-500',
    },
    {
      label: 'Transfer Opportunities',
      value: summary?.totalTransferOpportunities ?? 0,
      icon: Truck,
      color: (summary?.totalTransferOpportunities ?? 0) > 0 ? 'text-amber-500' : 'text-muted-foreground',
    },
    {
      label: 'Critical Categories',
      value: summary?.categoriesWithCritical ?? 0,
      icon: AlertTriangle,
      color: (summary?.categoriesWithCritical ?? 0) > 0 ? 'text-red-500' : 'text-muted-foreground',
    },
  ]

  return (
    <div className="p-8">
      {/* Header + controls */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Inventory Flow</h1>
          <p className="text-muted-foreground mt-1">Multi-facility supply, run-rate, and transfer opportunities</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Lookback selector */}
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            {LOOKBACK_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDaysLookback(opt.value)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  daysLookback === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* GroupBy selector */}
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            {GROUP_BY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGroupBy(opt.value)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  groupBy === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI strips at the top — headline numbers come before the matrix. */}

      {/* Critical Numbers (Harvest Intake / Days of Supply / Throughput / Waste Rate) */}
      <CriticalNumbersHero opsSummary={opsSummary} daysOfSupply={daysOfSupply} opsLoading={opsLoading || isLoading} />

      {/* Summary KPI strip (Active Facilities / Categories Tracked /
          Transfer Opportunities / Critical Categories). Critical Categories
          gets signal-critical when > 0. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {summaryCards.map((card) => {
          const isCritical = card.label === 'Critical Categories'
          const numericValue = typeof card.value === 'number' ? card.value : Number(card.value)
          const valueClass =
            isCritical && numericValue > 0
              ? 'text-[hsl(var(--signal-critical))]'
              : undefined
          return (
            <KpiCard
              key={card.label}
              icon={card.icon}
              label={card.label}
              value={card.value}
              valueClass={valueClass}
              loading={isLoading || opsLoading}
            />
          )
        })}
      </div>

      {/* Run-Rate Heatmap — under the KPIs */}
      {facilities.length > 0 && categories.length > 0 && (
        <div className="card-modern p-4 mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Run-Rate Heatmap</h3>
          {groupBy !== 'none' && groups.length > 0 ? (
            <div className="space-y-4">
              {groups.map((group: { key: string; label: string; facilityIds: string[] }) => (
                <GroupedHeatmap
                  key={group.key}
                  label={group.label}
                  facilityIds={group.facilityIds}
                  allFacilities={facilities}
                  categories={categories}
                  matrix={matrix}
                  groupBy={groupBy}
                />
              ))}
            </div>
          ) : (
            <HeatmapTable
              facilities={facilities}
              categories={categories}
              matrix={matrix}
            />
          )}
        </div>
      )}

      {/* Transfer Opportunities — actionable next step from the heatmap */}
      {transferOpportunities.length > 0 && (
        <div className="card-modern p-4 mb-6 border-l-4 border-l-amber-500">
          <div className="flex items-center gap-2 mb-3">
            <Truck className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Transfer Opportunities</h3>
            <span className="text-xs text-muted-foreground">
              ({transferOpportunities.length} detected)
            </span>
          </div>
          <div className="space-y-2">
            {transferOpportunities.map((opp: TransferOpp) => (
              <TransferOpportunityRow
                key={`${opp.category}-${opp.fromFacility.id}-${opp.toFacility.id}`}
                opportunity={opp}
              />
            ))}
          </div>
        </div>
      )}

      {/* Facility Breakdown table — last, filtered to harvest-producing
          types. Cultivation metrics (Harvest Intake, Throughput, Waste,
          Active Harvests) don't apply to dispensaries; showing them as
          0 / 0 / 0% / 0 misrepresents the org as having broken yields. */}
      {opsSummary && opsSummary.facilities.length > 0 && (
        <FacilityBreakdownTable facilities={opsSummary.facilities} />
      )}

      {/* Skeleton sections during load — mirror the loaded layout shape
          (heatmap card → transfer opportunities → facility breakdown) so the
          page reserves visual space and stays consistent with how loading is
          treated elsewhere in the app. */}
      {(isLoading || opsLoading) && facilities.length === 0 && (
        <>
          <div className="card-modern p-4 mb-6">
            <div className="h-4 w-32 bg-muted/30 rounded animate-pulse mb-4" />
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-8 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          </div>
          <div className="card-modern p-4 mb-6 border-l-4 border-l-muted/30">
            <div className="h-4 w-44 bg-muted/30 rounded animate-pulse mb-3" />
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-6 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          </div>
          <div className="card-modern p-4">
            <div className="h-4 w-40 bg-muted/30 rounded animate-pulse mb-4" />
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-7 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          </div>
        </>
      )}

      {!isLoading && !opsLoading && facilities.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          No active facilities found. Add facilities to see cross-facility run-rate comparisons.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Critical Numbers
// ---------------------------------------------------------------------------

function formatWeight(lbs: number): string {
  if (lbs >= 1000) return `${lbs.toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs/wk`
  return `${lbs.toLocaleString(undefined, { maximumFractionDigits: 1 })} lbs/wk`
}

// Waste-rate thresholds (WASTE_RATE_HIGH=5, WASTE_RATE_WARN=2) and the
// wasteRateStyle helper moved to shared/utils/run-rate-medians.

function CriticalNumbersHero({
  opsSummary,
  daysOfSupply,
  opsLoading,
}: {
  opsSummary: OpsSummaryData | undefined
  daysOfSupply: number | null
  opsLoading: boolean
}) {
  const s = opsSummary?.summary
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <KpiCard
        icon={Sprout}
        label="Harvest Intake"
        value={s ? formatWeight(s.harvestIntakeLbsPerWeek) : '—'}
        loading={opsLoading}
      />
      <KpiCard
        icon={Clock}
        label="Days of Supply"
        value={daysOfSupply !== null ? `${daysOfSupply} days` : '—'}
        loading={opsLoading}
      />
      <KpiCard
        icon={Boxes}
        label="Throughput"
        value={s ? formatWeight(s.throughputLbsPerWeek) : '—'}
        loading={opsLoading}
      />
      <KpiCard
        icon={Trash2}
        label="Waste Rate"
        value={s ? `${s.wasteRatePercent.toFixed(1)}%` : '—'}
        valueClass={s ? wasteRateStyle(s.wasteRatePercent).text : undefined}
        loading={opsLoading}
      />
    </div>
  )
}

function FacilityBreakdownTable({ facilities }: { facilities: OpsSummaryData['facilities'] }) {
  const [expanded, setExpanded] = useState(true)

  // Same filter as /executive/operations FacilityYieldTable — the columns
  // are all cultivation metrics so dispensaries / manufacturers always
  // render as 0/0/0%/0 which misrepresents the org. Keep them out.
  const harvestProducingTypes = new Set(['Cultivator', 'Microbusiness'])
  const visibleFacilities = facilities.filter((f: FacilityInfo) =>
    f.facilityType ? harvestProducingTypes.has(f.facilityType) : true,
  )
  const excludedCount = facilities.length - visibleFacilities.length

  if (visibleFacilities.length === 0) return null

  return (
    <div className="card-modern mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <h3 className="text-sm font-semibold">Facility Breakdown</h3>
          <span className="text-xs text-muted-foreground">
            (Cultivator &amp; Microbusiness — {visibleFacilities.length} of {facilities.length})
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 overflow-x-auto">
          {excludedCount > 0 && (
            <p className="text-xs text-muted-foreground mb-3">
              {excludedCount} non-harvest facility{excludedCount === 1 ? '' : 'ies'} hidden — these columns are cultivation-only.
            </p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-2 font-medium text-muted-foreground">Facility</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground whitespace-nowrap">Harvest Intake</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">Throughput</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground whitespace-nowrap">Waste Rate</th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground whitespace-nowrap">Active Harvests</th>
              </tr>
            </thead>
            <tbody>
              {visibleFacilities.map((f: FacilityInfo) => (
                <tr key={f.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                  <td className="px-2 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{f.name}</span>
                      <span className="text-xs text-muted-foreground">{f.stateCode}</span>
                      {f.facilityType && (
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded border',
                          FACILITY_TYPE_COLORS[f.facilityType] ?? 'bg-muted text-muted-foreground border-border',
                        )}>
                          {f.facilityType}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">{formatWeight(f.harvestIntakeLbsPerWeek)}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">{formatWeight(f.throughputLbsPerWeek)}</td>
                  <td className="px-2 py-2 text-right">
                    <span className={cn('inline-block rounded px-2 py-0.5 text-xs font-medium', wasteRateStyle(f.wasteRatePercent).bg)}>
                      {f.wasteRatePercent.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right">{f.activeHarvestCount}</td>
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
// Heatmap sub-components
// ---------------------------------------------------------------------------

function HeatmapCell({ cell, onClick }: { cell: CellData | undefined; onClick?: () => void }) {
  if (!cell) {
    return (
      <td className="px-2 py-2 text-center">
        <span className="inline-block w-full rounded px-2 py-1 text-xs bg-muted/10 text-muted-foreground">
          &mdash;
        </span>
      </td>
    )
  }

  const colorClass = STATUS_COLORS[cell.status] ?? 'bg-muted/10 text-muted-foreground'
  const hasVelocity = cell.weeksOfSupply !== null
  const label = hasVelocity ? `${cell.weeksOfSupply}w` : '\u2014'
  const title = hasVelocity
    ? `Inventory: ${cell.currentInventory} | Weekly sales: ${cell.weeklySalesRate} · Click for strain breakdown`
    : `Inventory: ${cell.currentInventory} | No sales velocity in window · Click for strain breakdown`

  return (
    <td className="px-2 py-2 text-center">
      <button
        className={cn('inline-block w-full rounded px-2 py-1 text-xs font-medium cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all', colorClass)}
        title={title}
        onClick={onClick}
      >
        {label}
      </button>
    </td>
  )
}

function OverallCell({ weeksOfSupply }: { weeksOfSupply: number | null }) {
  let status = 'excess'
  if (weeksOfSupply !== null) {
    if (weeksOfSupply < 1) status = 'critical'
    else if (weeksOfSupply < 4) status = 'low'
    else if (weeksOfSupply <= 12) status = 'healthy'
  }
  const colorClass = STATUS_COLORS[status] ?? 'bg-muted/10 text-muted-foreground'

  return (
    <td className="px-2 py-2 text-center">
      <span
        className={cn('inline-block w-full rounded px-2 py-1 text-xs font-bold', colorClass)}
        title={weeksOfSupply === null ? 'No sales velocity in window' : undefined}
      >
        {weeksOfSupply !== null ? `${weeksOfSupply}w` : '\u2014'}
      </span>
    </td>
  )
}

/** Small badge on a facility row explaining where its run-rate data came from. */
function DataSourceBadge({
  dataSource,
  skipReason,
}: {
  dataSource: FacilityInfo['dataSource']
  skipReason?: string
}) {
  if (dataSource === 'pos') return null // Default/best — no badge needed.
  if (dataSource === 'transfers') {
    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/40 text-muted-foreground border-border"
        title="Run-rate inferred from live Metrc outbound transfers (no POS connected)"
      >
        Transfers
      </span>
    )
  }
  if (dataSource === 'historical_transfers') {
    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded border bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
        title="Run-rate from imported CSV transfer history — refresh Metrc sync for live data"
      >
        Historical
      </span>
    )
  }
  // 'none'
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded border bg-red-500/10 text-red-500 border-red-500/30"
      title={skipReason ?? 'Facility call failed — no data available'}
    >
      No data
    </span>
  )
}

interface StrainDrilldown {
  facilityId: string
  facilityName: string
  category: string
  weeklySalesRate: number
}

function HeatmapTable({
  facilities,
  categories,
  matrix,
}: {
  facilities: FacilityInfo[]
  categories: string[]
  matrix: Record<string, Record<string, CellData>>
}) {
  const [drilldown, setDrilldown] = useState<StrainDrilldown | null>(null)

  const openDrilldown = useCallback(
    (facilityId: string, facilityName: string, category: string, cell: CellData | undefined) => {
      setDrilldown({
        facilityId,
        facilityName,
        category,
        weeklySalesRate: cell?.weeklySalesRate ?? 0,
      })
    },
    [],
  )

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-2 py-2 font-medium text-muted-foreground whitespace-nowrap">
                Facility
              </th>
              {categories.map((cat) => (
                <th
                  key={cat}
                  className="text-center px-2 py-2 font-medium text-muted-foreground whitespace-nowrap text-xs"
                  title={`Weeks of supply for ${cat} — current package quantity \u00F7 weekly sales velocity`}
                >
                  {cat}
                </th>
              ))}
              <th
                className="text-center px-2 py-2 font-medium text-muted-foreground whitespace-nowrap"
                title="Weighted average weeks-of-supply across all categories for this facility"
              >
                Overall
              </th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((f) => (
              <tr key={f.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                <td className="px-2 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{f.stateCode}</span>
                    {f.facilityType && (
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded border',
                        FACILITY_TYPE_COLORS[f.facilityType] ?? 'bg-muted text-muted-foreground border-border',
                      )}>
                        {f.facilityType}
                      </span>
                    )}
                    <DataSourceBadge dataSource={f.dataSource} skipReason={f.skipReason} />
                  </div>
                </td>
                {categories.map((cat) => {
                  const cell = matrix[f.id]?.[cat]
                  return (
                    <HeatmapCell
                      key={cat}
                      cell={cell}
                      onClick={() => openDrilldown(f.id, f.name, cat, cell)}
                    />
                  )
                })}
                <OverallCell weeksOfSupply={f.overallWeeksOfSupply} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Strain breakdown dialog */}
      <Dialog open={drilldown !== null} onOpenChange={(open) => { if (!open) setDrilldown(null) }}>
        {drilldown && (
          <StrainBreakdownDialog
            facilityId={drilldown.facilityId}
            facilityName={drilldown.facilityName}
            category={drilldown.category}
            categoryWeeklySalesRate={drilldown.weeklySalesRate}
          />
        )}
      </Dialog>
    </>
  )
}

/** Dialog content showing per-strain inventory breakdown within a category. */
function StrainBreakdownDialog({
  facilityId,
  facilityName,
  category,
  categoryWeeklySalesRate,
}: {
  facilityId: string
  facilityName: string
  category: string
  categoryWeeklySalesRate: number
}) {
  const { data, isLoading } = trpc.crossFacility.getCategoryStrainBreakdown.useQuery({
    facilityId,
    category,
    categoryWeeklySalesRate,
  }, { staleTime: 600_000 })

  const strainStatusColor = (wos: number | null): string => {
    if (wos === null) return 'text-muted-foreground'
    if (wos < 1) return 'text-red-500'
    if (wos < 4) return 'text-yellow-500'
    if (wos <= 12) return 'text-emerald-500'
    return 'text-cyan-500'
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="text-base">
          {category} — {facilityName}
        </DialogTitle>
        <p className="text-xs text-muted-foreground">
          Strain-level inventory breakdown
          {categoryWeeklySalesRate > 0 && (
            <> &middot; {categoryWeeklySalesRate.toLocaleString(undefined, { maximumFractionDigits: 1 })} pkg qty/wk category velocity</>
          )}
        </p>
      </DialogHeader>

      {isLoading ? (
        <div className="py-8 text-center text-muted-foreground text-sm">Loading strain data...</div>
      ) : !data || data.strains.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground text-sm">No packages found in this category.</div>
      ) : (
        <div className="overflow-y-auto max-h-[400px] scrollbar-modern">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs">
                <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Strain</th>
                <th className="text-right px-2 py-1.5 font-medium text-muted-foreground" title="Active Metrc packages with this strain">Pkgs</th>
                <th className="text-right px-2 py-1.5 font-medium text-muted-foreground" title="Total quantity across packages (in package unit of measure)">Qty</th>
                <th className="text-right px-2 py-1.5 font-medium text-muted-foreground" title="Share of total category inventory">%</th>
                <th className="text-right px-2 py-1.5 font-medium text-muted-foreground" title="Estimated weeks of supply (proportional to category share — rough, not strain-level POS)">Supply</th>
              </tr>
            </thead>
            <tbody>
              {data.strains.map((s) => (
                <tr key={s.name} className="border-b border-border/30 hover:bg-accent/20 transition-colors">
                  <td className="px-2 py-1.5 font-medium">{s.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{s.packageCount}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.quantity.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{s.pctOfCategory}%</td>
                  <td className={cn('px-2 py-1.5 text-right tabular-nums font-semibold', strainStatusColor(s.weeksOfSupply))}>
                    {s.weeksOfSupply !== null ? `${s.weeksOfSupply}w` : '\u2014'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DialogContent>
  )
}


function GroupedHeatmap({
  label,
  facilityIds,
  allFacilities,
  categories,
  matrix,
  groupBy,
}: {
  label: string
  facilityIds: string[]
  allFacilities: FacilityInfo[]
  categories: string[]
  matrix: Record<string, Record<string, CellData>>
  groupBy: GroupBy
}) {
  const [expanded, setExpanded] = useState(true)
  const groupFacilities = allFacilities.filter((f) => facilityIds.includes(f.id))

  return (
    <div className="rounded-md border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="font-semibold text-sm">
            {groupBy === 'facilityType' && label in FACILITY_TYPE_COLORS ? (
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded border mr-2',
                FACILITY_TYPE_COLORS[label],
              )}>
                {label}
              </span>
            ) : (
              label
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            ({groupFacilities.length} {groupFacilities.length === 1 ? 'facility' : 'facilities'})
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <HeatmapTable
            facilities={groupFacilities}
            categories={categories}
            matrix={matrix}
          />
        </div>
      )}
    </div>
  )
}
