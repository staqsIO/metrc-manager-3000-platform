'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { cn, marginColor } from '@/lib/utils'
import { DollarSign, TrendingDown, Percent, CircleDollarSign, Calculator, Warehouse, ChevronDown, ChevronRight, PieChart } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Badge } from '@/shared/components/ui/badge'
import { FACILITY_TYPE_COLORS } from '@/shared/constants/facility-types'

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
  { value: Math.max(1, Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000)), label: 'YTD' },
  { value: 365, label: '365d' },
]

export default function FinancialsPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [daysLookback, setDaysLookback] = useState(30)
  const { data, isLoading } = trpc.financial.getConsolidatedPnL.useQuery(
    { groupBy, daysLookback },
    { staleTime: 300_000 }
  )
  const { data: categoryData } = trpc.financial.getCategoryMargins.useQuery(
    { daysLookback },
    { staleTime: 300_000 }
  )

  const totals = data?.totals
  const facilities = data?.facilities ?? []
  const groups = data?.groups ?? []

  const summaryCards = [
    {
      label: 'Total Revenue',
      value: totals?.revenue ?? 0,
      icon: DollarSign,
      color: 'text-emerald-500',
      prefix: '$',
    },
    {
      label: 'Total Cost',
      value: totals?.cost ?? 0,
      icon: TrendingDown,
      color: 'text-red-500',
      prefix: '$',
    },
    {
      label: 'Gross Margin',
      value: totals?.grossMargin ?? 0,
      icon: Percent,
      color: 'text-blue-500',
      suffix: '%',
    },
    {
      label: 'Gross Profit',
      value: totals?.grossProfit ?? 0,
      icon: CircleDollarSign,
      color: 'text-foreground',
      prefix: '$',
    },
    {
      label: 'Tolling Fees',
      value: totals?.tollingFees ?? 0,
      icon: Calculator,
      color: 'text-amber-500',
      prefix: '$',
    },
    {
      label: 'Supply Cost',
      value: totals?.supplyCost ?? 0,
      icon: Warehouse,
      color: 'text-muted-foreground',
      prefix: '$',
    },
  ]

  // Find max revenue for CSS bar chart scaling
  const maxRevenue = facilities.reduce((max: number, f: { revenue: number }) => Math.max(max, f.revenue), 1)

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Financials</h1>
          <p className="text-muted-foreground mt-1">Consolidated P&L across all facilities</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Lookback Selector */}
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
          {/* Group By Selector */}
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {summaryCards.map((card) => (
          <div key={card.label} className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <card.icon className={cn('h-4 w-4', card.color)} />
              <span className="text-xs text-muted-foreground">{card.label}</span>
            </div>
            <p className={cn('text-2xl font-bold', card.color)}>
              {isLoading ? (
                <span
                  className="inline-block bg-muted/40 rounded animate-pulse align-middle h-[0.7em] w-20"
                  aria-label="Loading value"
                />
              ) : (
                <>
                  {card.prefix}
                  {card.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  {card.suffix && <span className="text-sm font-normal ml-1">{card.suffix}</span>}
                </>
              )}
            </p>
          </div>
        ))}
      </div>

      {/* Category Margins (Actual POS Data) */}
      {categoryData && categoryData.categories.length > 0 && (
        <div className="card-modern p-4 mb-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <PieChart className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-muted-foreground">Category Margins (Actual POS Data)</h3>
            </div>
            <Badge variant="outline" className="text-xs">Last 30d</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">Based on Dutchie transaction data across all facilities</p>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">COGS</TableHead>
                  <TableHead className="text-right">Gross Profit</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                  <TableHead className="text-right">Revenue Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryData.categories.map((cat) => (
                  <TableRow key={cat.category}>
                    <TableCell className="font-medium">{cat.category}</TableCell>
                    <TableCell className="text-right text-emerald-500">
                      ${cat.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right text-red-500">
                      ${cat.cogs.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${cat.grossProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className={cn('text-right font-medium', marginColor(cat.marginPercent))}>
                      {cat.marginPercent.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 bg-muted/30 rounded overflow-hidden">
                          <div
                            className="h-full bg-blue-500/60 rounded"
                            style={{ width: `${Math.min(cat.revenueShare, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-10 text-right">{cat.revenueShare.toFixed(1)}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals Row */}
                <TableRow className="bg-muted/30 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right text-emerald-500">
                    ${categoryData.totals.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="text-right text-red-500">
                    ${categoryData.totals.cogs.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    ${categoryData.totals.grossProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className={cn('text-right font-medium', marginColor(categoryData.totals.marginPercent))}>
                    {categoryData.totals.marginPercent.toFixed(1)}%
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {categoryData.skipped.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {categoryData.skipped.length} facility(ies) skipped (no Dutchie data): {categoryData.skipped.map(s => s.name).join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Facility Comparison */}
      {facilities.length > 0 && (
        <div className="card-modern p-4 mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Facility Comparison</h3>

          {/* CSS bar chart */}
          <div className="space-y-3 mb-6">
            {facilities.map((f: typeof facilities[number]) => (
              <div key={f.id} className="flex items-center gap-3">
                <span className="text-sm w-32 truncate" title={f.name}>{f.name}</span>
                <div className="flex-1 h-6 bg-muted/30 rounded overflow-hidden">
                  <div
                    className="h-full bg-emerald-500/80 rounded transition-all"
                    style={{ width: `${(f.revenue / maxRevenue) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-24 text-right">
                  ${f.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}
          </div>

          {/* Grouped View or Flat Table */}
          {groupBy !== 'none' && groups.length > 0 ? (
            <div className="space-y-4">
              {groups.map((group: typeof groups[number]) => (
                <GroupedTable
                  key={group.key}
                  label={group.label}
                  facilities={group.facilities}
                  totals={group.totals}
                  groupBy={groupBy}
                />
              ))}
            </div>
          ) : (
            <FacilityTable facilities={facilities} />
          )}
        </div>
      )}

      {/* Skeleton sections during load — mirror the loaded layout (Category
          Margins table + Facility Breakdown) so the page reserves visual
          space and stays consistent with the rest of the dashboard. */}
      {isLoading && (
        <>
          <div className="card-modern p-4 mb-6">
            <div className="h-4 w-44 bg-muted/30 rounded animate-pulse mb-3" />
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-7 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          </div>
          <div className="card-modern p-4">
            <div className="h-4 w-36 bg-muted/30 rounded animate-pulse mb-3" />
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-7 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface FacilityRow {
  id: string
  name: string
  facilityType: string | null
  stateCode: string
  revenue: number
  cost: number
  grossMargin: number
  grossProfit: number
  tollingFees: number
  supplyCost: number
}

interface TotalsRow {
  revenue: number
  cost: number
  grossMargin: number
  grossProfit: number
  tollingFees: number
  supplyCost: number
}

function FacilityTable({ facilities }: { facilities: FacilityRow[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Facility</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Margin</TableHead>
            <TableHead className="text-right">Profit</TableHead>
            <TableHead className="text-right">Tolling</TableHead>
            <TableHead className="text-right">Supply</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {facilities.map((f) => (
            <FacilityTableRow key={f.id} f={f} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function FacilityTableRow({ f }: { f: FacilityRow }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{f.name}</TableCell>
      <TableCell>
        {f.facilityType ? (
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded border',
            FACILITY_TYPE_COLORS[f.facilityType] ?? 'bg-muted text-muted-foreground border-border',
          )}>
            {f.facilityType}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{f.stateCode}</TableCell>
      <TableCell className="text-right text-emerald-500">
        ${f.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </TableCell>
      <TableCell className="text-right text-red-500">
        ${f.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </TableCell>
      <TableCell className="text-right">
        {f.grossMargin.toFixed(1)}%
      </TableCell>
      <TableCell className="text-right font-medium">
        ${f.grossProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </TableCell>
      <TableCell className="text-right text-amber-500">
        ${f.tollingFees.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        ${f.supplyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </TableCell>
    </TableRow>
  )
}

function GroupedTable({
  label,
  facilities,
  totals,
  groupBy,
}: {
  label: string
  facilities: FacilityRow[]
  totals: TotalsRow
  groupBy: GroupBy
}) {
  const [expanded, setExpanded] = useState(true)

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
          <span className="text-xs text-muted-foreground">({facilities.length} facilities)</span>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <span className="text-emerald-500 font-medium">
            ${totals.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
          <span className="text-muted-foreground">
            {totals.grossMargin.toFixed(1)}%
          </span>
          <span className="font-medium">
            ${totals.grossProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
      </button>
      {expanded && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Facility</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">Tolling</TableHead>
              <TableHead className="text-right">Supply</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {facilities.map((f) => (
              <FacilityTableRow key={f.id} f={f} />
            ))}
            {/* Subtotal Row */}
            <TableRow className="bg-muted/30 font-semibold">
              <TableCell colSpan={3}>Subtotal</TableCell>
              <TableCell className="text-right text-emerald-500">
                ${totals.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </TableCell>
              <TableCell className="text-right text-red-500">
                ${totals.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </TableCell>
              <TableCell className="text-right">
                {totals.grossMargin.toFixed(1)}%
              </TableCell>
              <TableCell className="text-right">
                ${totals.grossProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </TableCell>
              <TableCell className="text-right text-amber-500">
                ${totals.tollingFees.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                ${totals.supplyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </div>
  )
}
