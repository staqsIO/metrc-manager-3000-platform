'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'
import {
  ArrowLeft,
  Sprout,
  Boxes,
  Trash2,
  DollarSign,
  TrendingUp,
  Clock,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Truck,
} from 'lucide-react'
import { FACILITY_TYPE_COLORS } from '@/shared/constants/facility-types'
import { wasteColor, wasteBadgeColor } from '@/shared/utils/run-rate-medians'
import { useState } from 'react'
import { StateOutline } from '@/shared/components/StateOutline'
import { KpiCard } from '@/shared/components/ui/kpi-card'
import { TransferOpportunityRow } from '@/features/transfers/components/TransferOpportunityRow'

type RouterOutputs = inferRouterOutputs<AppRouter>
type FacilityWithHealth = RouterOutputs['facility']['listWithHealth'][number]
type OpsFacility = RouterOutputs['crossFacility']['getOperationsSummary']['facilities'][number]
type TransferOpp = RouterOutputs['crossFacility']['getRunRateComparison']['transferOpportunities'][number]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatWeight(lbs: number): string {
  return `${lbs.toLocaleString(undefined, { maximumFractionDigits: lbs >= 1000 ? 0 : 1 })} lbs/wk`
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

// wasteColor + wasteBadgeColor moved to shared/utils/run-rate-medians.

const LOOKBACK_OPTIONS = [
  { value: 7, label: '7d' },
  { value: 14, label: '14d' },
  { value: 30, label: '30d' },
  { value: 60, label: '60d' },
  { value: 90, label: '90d' },
]

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

function OperationsTable({ facilities }: { facilities: OpsFacility[] }) {
  const [expanded, setExpanded] = useState(true)
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
          <h3 className="text-sm font-semibold">Operations by Facility</h3>
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
                  Type
                </th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground whitespace-nowrap">
                  Harvest Intake
                </th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">
                  Throughput
                </th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground whitespace-nowrap">
                  Waste Rate
                </th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground whitespace-nowrap">
                  Active Harvests
                </th>
              </tr>
            </thead>
            <tbody>
              {facilities.map((f) => (
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
                  <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                    {formatWeight(f.harvestIntakeLbsPerWeek)}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                    {formatWeight(f.throughputLbsPerWeek)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <span
                      className={cn(
                        'inline-block rounded px-2 py-0.5 text-xs font-medium tabular-nums',
                        wasteBadgeColor(f.wasteRatePercent),
                      )}
                    >
                      {f.wasteRatePercent.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {f.activeHarvestCount}
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

function FinancialTable({
  facilities,
}: {
  facilities: Array<{
    id: string
    name: string
    facilityType: string | null
    revenue: number
    cost: number
    grossMargin: number
    grossProfit: number
  }>
}) {
  const [expanded, setExpanded] = useState(true)
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
          <h3 className="text-sm font-semibold">Financials by Facility</h3>
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
                  Type
                </th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">
                  Revenue
                </th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">
                  COGS
                </th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">
                  Margin
                </th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">
                  Profit
                </th>
              </tr>
            </thead>
            <tbody>
              {facilities.map((f) => (
                <tr
                  key={f.id}
                  className="border-b border-border/50 hover:bg-accent/30 transition-colors"
                >
                  <td className="px-2 py-2 font-medium">{f.name}</td>
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
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatCurrency(f.revenue)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatCurrency(f.cost)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {f.grossMargin.toFixed(1)}%
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatCurrency(f.grossProfit)}
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

function HealthTable({ facilities }: { facilities: FacilityWithHealth[] }) {
  const [expanded, setExpanded] = useState(true)
  // Sort descending by alert count so facilities needing attention surface
  // first.
  const sorted = [...facilities].sort((a, b) => b.alertCount - a.alertCount)
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
          <h3 className="text-sm font-semibold">Compliance</h3>
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
                  Type
                </th>
                <th className="text-right px-2 py-2 font-medium text-muted-foreground">
                  Open Alerts
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
                      href={`/facilities/${f.id}/compliance`}
                      className="font-medium hover:text-primary transition-colors"
                    >
                      {f.name}
                    </Link>
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
                    {f.alertCount > 0 ? (
                      <span className="text-red-500 font-medium tabular-nums">
                        {f.alertCount}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
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

function TransferOpportunities({ opps }: { opps: TransferOpp[] }) {
  if (opps.length === 0) return null
  return (
    <div className="card-modern p-4 border-l-4 border-l-amber-500">
      <div className="flex items-center gap-2 mb-3">
        <Truck className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold">Transfer Opportunities</h3>
        <span className="text-xs text-muted-foreground">
          ({opps.length} detected)
        </span>
      </div>
      <div className="space-y-2">
        {opps.map((opp) => (
          <TransferOpportunityRow
            key={`${opp.category}-${opp.fromFacility.id}-${opp.toFacility.id}`}
            opportunity={opp}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function StateDrillDownPage() {
  const params = useParams()
  const stateCode = (params?.stateCode ?? '') as string
  const [daysLookback, setDaysLookback] = useState(30)

  // Reuse the same queries — React Query deduplicates with the executive overview
  const { data: opsSummary, isLoading: opsLoading } =
    trpc.crossFacility.getOperationsSummary.useQuery(
      { daysLookback },
      { staleTime: 300_000 },
    )

  const { data: comparison, isLoading: compLoading } =
    trpc.crossFacility.getRunRateComparison.useQuery(
      { groupBy: 'state', daysLookback },
      { staleTime: 300_000 },
    )

  const { data: pnl, isLoading: pnlLoading } =
    trpc.financial.getConsolidatedPnL.useQuery(
      { groupBy: 'state' },
      { staleTime: 300_000 },
    )

  const { data: allFacilities, isLoading: facilitiesLoading } =
    trpc.facility.listWithHealth.useQuery(undefined, { staleTime: 300_000 })

  // Filter everything to this state
  const stateFacilities = (allFacilities ?? []).filter(
    (f: FacilityWithHealth) => f.stateCode === stateCode,
  )
  const opsStateFacilities = (opsSummary?.facilities ?? []).filter(
    (f: OpsFacility) => f.stateCode === stateCode,
  )
  const pnlGroup = pnl?.groups?.find(
    (g: { key: string }) => g.key === stateCode,
  )
  const stateTransferOpps = (comparison?.transferOpportunities ?? []).filter(
    (opp: TransferOpp) => opp.fromFacility.stateCode === stateCode,
  )

  // Aggregate state-level ops
  const weeksInWindow = daysLookback / 7
  const totalHarvestLbs = opsStateFacilities.reduce(
    (s: number, f: OpsFacility) => s + f.harvestIntakeLbsPerWeek * weeksInWindow,
    0,
  )
  const totalThroughputLbs = opsStateFacilities.reduce(
    (s: number, f: OpsFacility) => s + f.throughputLbsPerWeek * weeksInWindow,
    0,
  )
  const avgWasteRate =
    opsStateFacilities.length > 0
      ? opsStateFacilities.reduce(
          (s: number, f: OpsFacility) => s + f.wasteRatePercent,
          0,
        ) / opsStateFacilities.length
      : 0

  // Days of supply for this state
  type ComparisonFacility = RouterOutputs['crossFacility']['getRunRateComparison']['facilities'][number]
  const stateFacCompare = (comparison?.facilities ?? []).filter(
    (f: ComparisonFacility) => f.stateCode === stateCode,
  )
  const wosValues = stateFacCompare
    .map((f: ComparisonFacility) => f.overallWeeksOfSupply)
    .filter((v: number | null): v is number => v !== null)
    .sort((a: number, b: number) => a - b)
  const daysOfSupply = (() => {
    if (wosValues.length === 0) return null
    const mid = Math.floor(wosValues.length / 2)
    const median =
      wosValues.length % 2 === 1
        ? wosValues[mid]!
        : (wosValues[mid - 1]! + wosValues[mid]!) / 2
    return Math.round(median * 7)
  })()

  const totalAlerts = stateFacilities.reduce(
    (s: number, f: FacilityWithHealth) => s + f.alertCount,
    0,
  )

  const isLoading =
    opsLoading || compLoading || pnlLoading || facilitiesLoading

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link
            href="/executive"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Executive Overview
          </Link>
          <div className="flex items-center gap-4">
            <StateOutline
              stateCode={stateCode}
              size={40}
              className="text-emerald-500/25"
            />
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{stateCode}</h1>
              <span className="text-muted-foreground">
                {stateFacilities.length}{' '}
                {stateFacilities.length === 1 ? 'facility' : 'facilities'}
              </span>
            </div>
          </div>
        </div>
        <LookbackSelector value={daysLookback} onChange={setDaysLookback} />
      </div>

      {/* State KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard
          icon={DollarSign}
          label="Revenue"
          value={pnlGroup ? formatCurrency(pnlGroup.totals.revenue) : '—'}
          loading={pnlLoading}
        />
        <KpiCard
          icon={TrendingUp}
          label="Gross Margin"
          value={pnlGroup ? `${pnlGroup.totals.grossMargin.toFixed(1)}%` : '—'}
          loading={pnlLoading}
        />
        <KpiCard
          icon={Sprout}
          label="Harvest Intake"
          value={formatWeight(totalHarvestLbs / weeksInWindow)}
          loading={opsLoading}
        />
        <KpiCard
          icon={Boxes}
          label="Throughput"
          value={formatWeight(totalThroughputLbs / weeksInWindow)}
          loading={opsLoading}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <KpiCard
          icon={Trash2}
          label="Waste Rate"
          value={`${avgWasteRate.toFixed(1)}%`}
          valueClass={wasteColor(avgWasteRate)}
          loading={opsLoading}
        />
        <KpiCard
          icon={Clock}
          label="Days of Supply"
          value={daysOfSupply !== null ? `${daysOfSupply} days` : '—'}
          loading={compLoading}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Open Alerts"
          value={String(totalAlerts)}
          valueClass={totalAlerts > 0 ? 'text-[hsl(var(--signal-critical))]' : undefined}
          loading={facilitiesLoading}
        />
      </div>

      {/* Transfer Opportunities */}
      {stateTransferOpps.length > 0 && (
        <div className="mb-6">
          <TransferOpportunities opps={stateTransferOpps} />
        </div>
      )}

      {/* Operations Table */}
      {opsStateFacilities.length > 0 && (
        <div className="mb-6">
          <OperationsTable facilities={opsStateFacilities} />
        </div>
      )}

      {/* Financials Table */}
      {pnlGroup && pnlGroup.facilities.length > 0 && (
        <div className="mb-6">
          <FinancialTable facilities={pnlGroup.facilities} />
        </div>
      )}

      {/* Health Table */}
      {stateFacilities.length > 0 && (
        <div className="mb-6">
          <HealthTable facilities={stateFacilities} />
        </div>
      )}

      {isLoading && stateFacilities.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          Loading {stateCode} data...
        </div>
      )}
    </div>
  )
}
