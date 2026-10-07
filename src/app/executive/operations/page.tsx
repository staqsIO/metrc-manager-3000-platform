'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'
import {
  ArrowLeft,
  Sprout,
  Clock,
  Trash2,
  TrendingUp,
  Boxes,
  Leaf,
} from 'lucide-react'
import { FACILITY_TYPE_COLORS } from '@/shared/constants/facility-types'
import { KpiCard } from '@/shared/components/ui/kpi-card'
import { wasteColor } from '@/shared/utils/run-rate-medians'

type RouterOutputs = inferRouterOutputs<AppRouter>
type YieldData = RouterOutputs['crossFacility']['getYieldAnalytics']
type OpsData = RouterOutputs['crossFacility']['getOperationsSummary']
type ProcessingYieldData = RouterOutputs['crossFacility']['getProcessingYield']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatWeight(lbs: number): string {
  return `${lbs.toLocaleString(undefined, { maximumFractionDigits: lbs >= 1000 ? 0 : 1 })} lbs/wk`
}

function yieldColor(pct: number): string {
  if (pct >= 90) return 'text-emerald-500'
  if (pct >= 80) return 'text-yellow-500'
  if (pct >= 70) return 'text-orange-500'
  return 'text-red-500'
}

// wasteColor moved to shared/utils/run-rate-medians (was duplicated
// across this file, /operations, and /executive/states/[stateCode]).

// ---------------------------------------------------------------------------
// Lookback Selector (reused pattern)
// ---------------------------------------------------------------------------

const LOOKBACK_OPTIONS = [
  { value: 30, label: '30d' },
  { value: 60, label: '60d' },
  { value: 90, label: '90d' },
  { value: 180, label: '180d' },
  { value: 365, label: '1y' },
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OperationsKpis({
  ops,
  yields,
  opsLoading,
  yieldLoading,
}: {
  ops: OpsData | undefined
  yields: YieldData | undefined
  opsLoading: boolean
  yieldLoading: boolean
}) {
  const s = ops?.summary
  const y = yields?.summary
  const loading = opsLoading || yieldLoading

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
      <KpiCard
        icon={TrendingUp}
        label="Yield Efficiency"
        value={y ? `${y.yieldEfficiency.toFixed(1)}%` : '—'}
        subtitle="Product out / total harvest"
        valueClass={y ? yieldColor(y.yieldEfficiency) : undefined}
        loading={loading}
      />
      <KpiCard
        icon={Trash2}
        label="Waste Rate"
        value={s ? `${s.wasteRatePercent.toFixed(1)}%` : '—'}
        subtitle="Waste / total output"
        valueClass={s ? wasteColor(s.wasteRatePercent) : undefined}
        loading={loading}
      />
      <KpiCard
        icon={Clock}
        label="Avg Cycle Time"
        value={y && y.avgDaysToFinish > 0 ? `${y.avgDaysToFinish}d` : '—'}
        subtitle="Harvest start to finish"
        loading={loading}
      />
      <KpiCard
        icon={Sprout}
        label="Harvest Intake"
        value={s ? formatWeight(s.harvestIntakeLbsPerWeek) : '—'}
        loading={loading}
      />
      <KpiCard
        icon={Boxes}
        label="Throughput"
        value={s ? formatWeight(s.throughputLbsPerWeek) : '—'}
        loading={loading}
      />
      <KpiCard
        icon={Leaf}
        label="Total Harvests"
        value={y ? `${y.totalHarvests}` : '—'}
        subtitle="In lookback window"
        loading={loading}
      />
    </div>
  )
}

function FacilityYieldTable({ facilities }: { facilities: YieldData['facilities'] }) {
  // Yield/waste/harvest metrics are cultivation-only (Cultivator and
  // Microbusiness produce harvests; Dispensary and Manufacturer do not).
  // Filter the table to harvest-producing types so we don't show 0/0/0 rows
  // that misrepresent the org as having broken yields.
  const harvestProducingTypes = new Set(['Cultivator', 'Microbusiness'])
  const yieldFacilities = facilities.filter((f: YieldData['facilities'][number]) =>
    f.facilityType ? harvestProducingTypes.has(f.facilityType) : true,
  )
  const excludedCount = facilities.length - yieldFacilities.length

  if (yieldFacilities.length === 0) return null

  return (
    <div className="card-modern mb-8">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold">Yield by Facility</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Cultivation metrics — Cultivator &amp; Microbusiness only.
          {excludedCount > 0 && (
            <> {excludedCount} non-harvest facility{excludedCount === 1 ? '' : 'ies'} hidden.</>
          )}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Facility</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">State</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Yield %</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Waste %</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Harvests</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Active</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Avg Cycle</th>
            </tr>
          </thead>
          <tbody>
            {yieldFacilities.map((f: YieldData['facilities'][number]) => (
              <tr
                key={f.id}
                className="border-b border-border/50 hover:bg-accent/30 transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/facilities/${f.id}/harvests`}
                    className="font-medium hover:text-primary transition-colors"
                  >
                    {f.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{f.stateCode}</td>
                <td className="px-4 py-3">
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
                <td className="px-4 py-3 text-right">
                  <span className={cn('tabular-nums font-medium', yieldColor(f.yieldEfficiency))}>
                    {f.yieldEfficiency.toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={cn('tabular-nums', wasteColor(f.wasteRate))}>
                    {f.wasteRate.toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{f.harvestCount}</td>
                <td className="px-4 py-3 text-right tabular-nums">{f.activeHarvestCount}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {f.avgDaysToFinish > 0 ? `${f.avgDaysToFinish}d` : '\u2014'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatUnitOutputs(byUnit: Record<string, number>): string | null {
  const entries = Object.entries(byUnit)
  if (entries.length === 0) return null
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([unit, qty]) => `${qty.toLocaleString()} ${unit}`)
    .join(' · ')
}

function FacilityProcessingTable({ data }: { data: ProcessingYieldData }) {
  if (data.facilities.length === 0) return null

  return (
    <div className="card-modern mb-8">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold">Processing Yield by Facility</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Manufacturer &amp; Microbusiness — PROCESSING_CREATE actions in the last {data.daysLookback}d.
          Weight outputs (lbs) and unit outputs (Each, etc.) are reported separately and never blended.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Facility</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">State</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground" title="Weight-only yield: output_lbs / input_lbs. Excludes count outputs.">Weight Yield %</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Input (lbs)</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Output (lbs)</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground" title="Non-weight outputs (count units like Each, Tablets) — kept separate from weight">Unit Output</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Runs</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Top Product</th>
            </tr>
          </thead>
          <tbody>
            {data.facilities.map((f: ProcessingYieldData['facilities'][number]) => {
              const top = f.metrics.topProducts[0]
              const unitOutputs = formatUnitOutputs(f.metrics.totalOutputByUnit)
              return (
                <tr
                  key={f.id}
                  className="border-b border-border/50 hover:bg-accent/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/facilities/${f.id}/processing`}
                      className="font-medium hover:text-primary transition-colors"
                    >
                      {f.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{f.stateCode}</td>
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3 text-right">
                    {f.metrics.yieldPercent !== null ? (
                      <span className={cn('font-numeric tabular-nums font-medium', yieldColor(f.metrics.yieldPercent))}>
                        {f.metrics.yieldPercent.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground" title="No weight-unit runs in this window — see Unit Output column">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-numeric tabular-nums">
                    {f.inputLbs > 0 ? f.inputLbs.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-numeric tabular-nums">
                    {f.outputLbs > 0 ? f.outputLbs.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-numeric tabular-nums text-xs">
                    {unitOutputs ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-numeric tabular-nums">
                    {f.metrics.runCount}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs truncate max-w-[200px]">
                    {top ? (
                      <span
                        title={`${top.runs} runs · ${top.totalOutput.toLocaleString()} ${top.unit} total`}
                      >
                        {top.itemName}{' '}
                        <span className="font-numeric tabular-nums text-[10px]">
                          ({top.totalOutput.toLocaleString()} {top.unit})
                        </span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TopStrains({ strains }: { strains: YieldData['topStrains'] }) {
  if (strains.length === 0) return null

  return (
    <div className="card-modern">
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Leaf className="h-4 w-4 text-emerald-500" />
          <h2 className="text-sm font-semibold">Top Strains by Yield</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Minimum 2 harvests required
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Strain</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Yield %</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Harvests</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Facilities</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Avg Cycle</th>
            </tr>
          </thead>
          <tbody>
            {strains.map((s: YieldData['topStrains'][number]) => (
              <tr
                key={s.strain}
                className="border-b border-border/50 hover:bg-accent/30 transition-colors"
              >
                <td className="px-4 py-3 font-medium">{s.strain}</td>
                <td className="px-4 py-3 text-right">
                  <span className={cn('tabular-nums font-medium', yieldColor(s.yieldEfficiency))}>
                    {s.yieldEfficiency.toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{s.harvestCount}</td>
                <td className="px-4 py-3 text-right tabular-nums">{s.facilityCount}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {s.avgDaysToFinish > 0 ? `${s.avgDaysToFinish}d` : '\u2014'}
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
// Production Rates — daily package creation velocity
// ---------------------------------------------------------------------------

type ProductionFacility = RouterOutputs['crossFacility']['getProductionRates']['facilities'][number]

function ProductionRatesSection({
  facilities,
  daysLookback,
}: {
  facilities: ProductionFacility[]
  daysLookback: number
}) {
  // Memoized: collect all categories across all facilities for column
  // headers. Without this, the union walk is O(F·C) per render.
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const f of facilities) {
      for (const c of f.production.byCategory) set.add(c.category)
    }
    return Array.from(set).sort()
  }, [facilities])

  // Memoized: precompute per-facility category lookup maps so the row
  // render doesn't rebuild a Map on every pass through `facilities.map`.
  type ProdCat = ProductionFacility['production']['byCategory'][number]
  const catMaps = useMemo(() => {
    const map = new Map<string, Map<string, ProdCat>>()
    for (const f of facilities) {
      map.set(
        f.id,
        new Map(f.production.byCategory.map((c: ProdCat): [string, ProdCat] => [c.category, c])),
      )
    }
    return map
  }, [facilities])

  return (
    <div className="card-modern mt-6">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold">Daily Production Rates</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Packages created per day by category (last {daysLookback}d)
        </p>
      </div>
      <div className="px-5 pb-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-2 py-2 font-medium text-muted-foreground whitespace-nowrap">Facility</th>
              {categories.map(cat => (
                <th key={cat} className="text-center px-2 py-2 font-medium text-muted-foreground whitespace-nowrap text-xs" title={`Packages created per day for ${cat}`}>
                  {cat}
                </th>
              ))}
              <th className="text-center px-2 py-2 font-medium text-muted-foreground whitespace-nowrap">Total</th>
              <th className="text-center px-2 py-2 font-medium text-muted-foreground whitespace-nowrap" title="Number of days with at least one package created">Active Days</th>
            </tr>
          </thead>
          <tbody>
            {facilities.map(f => {
              const catMap = catMaps.get(f.id) ?? new Map<string, ProdCat>()
              return (
                <tr key={f.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                  <td className="px-2 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{f.name}</span>
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
                  {categories.map(cat => {
                    const c = catMap.get(cat) as ProdCat | undefined
                    return (
                      <td key={cat} className="px-2 py-2 text-center tabular-nums">
                        {c ? (
                          <span
                            className="text-xs"
                            title={`${c.packagesCreated} pkgs total \u00B7 ${c.quantityPerDay} qty/day \u00B7 ${c.activeDays} active days`}
                          >
                            {c.packagesPerDay}/d
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">&mdash;</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-2 py-2 text-center tabular-nums font-medium">
                    {(f.production.totalPackagesCreated / daysLookback).toFixed(1)}/d
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums text-muted-foreground">
                    {f.production.totalActiveDays}/{daysLookback}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function OperationsPage() {
  const [daysLookback, setDaysLookback] = useState(90)

  const { data: ops, isLoading: opsLoading } =
    trpc.crossFacility.getOperationsSummary.useQuery(
      { daysLookback },
      { staleTime: 600_000 },
    )

  const { data: yields, isLoading: yieldLoading } =
    trpc.crossFacility.getYieldAnalytics.useQuery(
      { daysLookback },
      { staleTime: 600_000 },
    )

  const { data: productionData, isLoading: productionLoading } =
    trpc.crossFacility.getProductionRates.useQuery(
      { daysLookback },
      { staleTime: 600_000 },
    )

  const { data: processingYield } =
    trpc.crossFacility.getProcessingYield.useQuery(
      { daysLookback },
      { staleTime: 600_000 },
    )

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link
            href="/executive"
            className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-emerald-500" />
              Yield & Cycle
            </h1>
            <p className="text-muted-foreground mt-1">
              Cultivation efficiency, waste, and cycle time
            </p>
          </div>
        </div>
        <LookbackSelector value={daysLookback} onChange={setDaysLookback} />
      </div>

      {/* Content */}
      {opsLoading && yieldLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="card-modern p-5 h-24 animate-pulse bg-muted/30" />
            ))}
          </div>
          <div className="card-modern h-64 animate-pulse bg-muted/30" />
        </div>
      ) : (
        <>
          <OperationsKpis
            ops={ops}
            yields={yields}
            opsLoading={opsLoading}
            yieldLoading={yieldLoading}
          />

          {yields && yields.facilities.length > 0 && (
            <FacilityYieldTable facilities={yields.facilities} />
          )}

          {/* Processing Yield — Manufacturer / Microbusiness companion to the
              cultivation Yield table. Reads from ActionLog PROCESSING_CREATE
              entries; only renders when there's at least one processing run. */}
          {processingYield && processingYield.facilities.length > 0 && (
            <FacilityProcessingTable data={processingYield} />
          )}

          {/* Production Rates — daily package creation by category per facility */}
          {productionLoading && (
            <div className="card-modern p-5 text-center text-muted-foreground text-sm">Loading production rates...</div>
          )}
          {productionData && productionData.facilities.length > 0 && (
            <ProductionRatesSection facilities={productionData.facilities} daysLookback={daysLookback} />
          )}

          {yields && yields.topStrains.length > 0 && (
            <TopStrains strains={yields.topStrains} />
          )}

          {!yields || (yields.facilities.length === 0 && !yieldLoading) ? (
            <div className="card-modern p-8 text-center">
              <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-5">
                <Sprout className="h-8 w-8 text-emerald-500" />
              </div>
              <h2 className="text-xl font-semibold mb-2">No Harvest Data</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Yield and cycle time data will appear here once your facilities
                have completed harvests recorded in Metrc within the selected time window.
              </p>
            </div>
          ) : null}

          {(yields?.skipped.length ?? 0) + (ops?.skipped.length ?? 0) > 0 && (
            <div className="mt-6 text-xs text-muted-foreground">
              {new Set([
                ...(yields?.skipped ?? []).map((s: { id: string }) => s.id),
                ...(ops?.skipped ?? []).map((s: { id: string }) => s.id),
              ]).size}{' '}
              facilit{new Set([
                ...(yields?.skipped ?? []).map((s: { id: string }) => s.id),
                ...(ops?.skipped ?? []).map((s: { id: string }) => s.id),
              ]).size === 1 ? 'y' : 'ies'} skipped due to API errors.
            </div>
          )}
        </>
      )}
    </div>
  )
}
