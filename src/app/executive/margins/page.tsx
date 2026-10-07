'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'
import {
  BarChart3,
  ArrowLeft,
  DollarSign,
  TrendingUp,
  Package,
  Percent,
} from 'lucide-react'

type RouterOutputs = inferRouterOutputs<AppRouter>
type MarginsData = RouterOutputs['financial']['getCategoryMargins']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

function marginColor(pct: number): string {
  if (pct >= 50) return 'text-emerald-500'
  if (pct >= 30) return 'text-yellow-500'
  if (pct >= 15) return 'text-orange-500'
  return 'text-red-500'
}

function marginBg(pct: number): string {
  if (pct >= 50) return 'bg-emerald-500'
  if (pct >= 30) return 'bg-yellow-500'
  if (pct >= 15) return 'bg-orange-500'
  return 'bg-red-500'
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MarginsKpis({ totals }: { totals: MarginsData['totals'] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div className="card-modern p-5">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="h-4 w-4 text-emerald-500" />
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            Revenue
          </span>
        </div>
        <p className="text-2xl font-bold tabular-nums text-emerald-500">
          {formatCurrency(totals.revenue)}
        </p>
      </div>

      <div className="card-modern p-5">
        <div className="flex items-center gap-2 mb-2">
          <Package className="h-4 w-4 text-blue-500" />
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            COGS
          </span>
        </div>
        <p className="text-2xl font-bold tabular-nums text-blue-500">
          {formatCurrency(totals.cogs)}
        </p>
      </div>

      <div className="card-modern p-5">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            Gross Profit
          </span>
        </div>
        <p className="text-2xl font-bold tabular-nums text-primary">
          {formatCurrency(totals.grossProfit)}
        </p>
      </div>

      <div className="card-modern p-5">
        <div className="flex items-center gap-2 mb-2">
          <Percent className="h-4 w-4 text-primary" />
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            Gross Margin
          </span>
        </div>
        <p className={cn('text-2xl font-bold tabular-nums', marginColor(totals.marginPercent))}>
          {totals.marginPercent.toFixed(1)}%
        </p>
      </div>
    </div>
  )
}

function CategoryTable({ categories }: { categories: MarginsData['categories'] }) {
  if (categories.length === 0) return null

  return (
    <div className="card-modern mb-8">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold">Margin by Category</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Sorted by revenue (highest first)
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Revenue</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">COGS</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Profit</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Units</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Rev Share</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Margin</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c: MarginsData['categories'][number]) => (
              <tr
                key={c.category}
                className="border-b border-border/50 hover:bg-accent/30 transition-colors"
              >
                <td className="px-4 py-3 font-medium">{c.category}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCurrency(c.revenue)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {formatCurrency(c.cogs)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-500">
                  {formatCurrency(c.grossProfit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {c.unitsSold.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {c.revenueShare.toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', marginBg(c.marginPercent))}
                        style={{ width: `${Math.min(c.marginPercent, 100)}%` }}
                      />
                    </div>
                    <span className={cn('tabular-nums font-medium', marginColor(c.marginPercent))}>
                      {c.marginPercent.toFixed(1)}%
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

function FacilityMarginsTable({ byFacility }: { byFacility: MarginsData['byFacility'] }) {
  if (byFacility.length === 0) return null

  return (
    <div className="card-modern">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold">Margins by Facility</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Per-facility category breakdown
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Facility</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">State</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Revenue</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">COGS</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Margin</th>
            </tr>
          </thead>
          <tbody>
            {byFacility.map((f: MarginsData['byFacility'][number]) =>
              f.categories.map((c: MarginsData['byFacility'][number]['categories'][number], i: number) => (
                <tr
                  key={`${f.id}-${c.category}`}
                  className="border-b border-border/50 hover:bg-accent/30 transition-colors"
                >
                  {i === 0 ? (
                    <>
                      <td className="px-4 py-3" rowSpan={f.categories.length}>
                        <Link
                          href={`/facilities/${f.id}/sales`}
                          className="font-medium hover:text-primary transition-colors"
                        >
                          {f.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground" rowSpan={f.categories.length}>
                        {f.stateCode}
                      </td>
                    </>
                  ) : null}
                  <td className="px-4 py-3 text-muted-foreground">{c.category}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(c.revenue)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatCurrency(c.cogs)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('tabular-nums font-medium', marginColor(c.marginPercent))}>
                      {c.marginPercent.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MarginsPage() {
  const { data, isLoading } = trpc.financial.getCategoryMargins.useQuery(
    { daysLookback: 30 },
    { staleTime: 300_000 },
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
            <BarChart3 className="h-6 w-6 text-cyan-500" />
            Category Margins
          </h1>
          <p className="text-muted-foreground mt-1">
            Cross-facility product category revenue, COGS, and margin from POS data
          </p>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="card-modern p-5 h-24 animate-pulse bg-muted/30" />
            ))}
          </div>
          <div className="card-modern h-64 animate-pulse bg-muted/30" />
        </div>
      ) : !data || data.totals.revenue === 0 ? (
        <div className="card-modern p-8 text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-cyan-500/10 flex items-center justify-center mb-5">
            <BarChart3 className="h-8 w-8 text-cyan-500" />
          </div>
          <h2 className="text-xl font-semibold mb-2">No POS Data Available</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Category margin data will appear here once your facilities have
            Dutchie POS integrations configured with recent transaction data.
          </p>
        </div>
      ) : (
        <>
          <MarginsKpis totals={data.totals} />
          <CategoryTable categories={data.categories} />
          <FacilityMarginsTable byFacility={data.byFacility} />

          {data.skipped.length > 0 && (
            <div className="mt-6 text-xs text-muted-foreground">
              {data.skipped.length} facilit{data.skipped.length === 1 ? 'y' : 'ies'} skipped due to POS data errors.
            </div>
          )}
        </>
      )}
    </div>
  )
}
