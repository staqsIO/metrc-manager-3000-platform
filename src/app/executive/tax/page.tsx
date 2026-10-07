'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'
import {
  ShieldAlert,
  ArrowLeft,
  DollarSign,
  TrendingUp,
  Calculator,
  ArrowRight,
  AlertTriangle,
  Percent,
} from 'lucide-react'

type RouterOutputs = inferRouterOutputs<AppRouter>
type PnLData = RouterOutputs['financial']['getConsolidatedPnL']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

// ---------------------------------------------------------------------------
// 280E Impact Calculator
// ---------------------------------------------------------------------------

const FEDERAL_RATE = 0.21

function TaxImpactSection({ pnl }: { pnl: PnLData }) {
  const t = pnl.totals
  // Under normal tax: deduct all costs, pay 21% on net income
  // Under 280E: can only deduct COGS, operating expenses are non-deductible
  // Since our OpEx model gives total costs (not split COGS/OpEx), we model
  // a range of COGS allocations to show the 280E impact.

  // Use cost as total expenses, grossProfit as pre-tax profit
  const cogsPercent = t.revenue > 0 ? ((t.cost / t.revenue) * 100) : 0

  // Normal business: taxable income = revenue - all costs = grossProfit
  const normalTaxableIncome = Math.max(0, t.grossProfit)
  const normalTax = normalTaxableIncome * FEDERAL_RATE

  // 280E scenario: Assume COGS is 60% of total costs (industry typical)
  // and remaining 40% is non-deductible operating expense
  const estimatedCogsShare = 0.6
  const estimatedCogs = t.cost * estimatedCogsShare
  const estimatedNonDeductible = t.cost * (1 - estimatedCogsShare)
  const taxableIncome280E = Math.max(0, t.revenue - estimatedCogs)
  const tax280E = taxableIncome280E * FEDERAL_RATE
  const penalty280E = tax280E - normalTax
  const effectiveRate = t.revenue > 0 ? ((tax280E / t.revenue) * 100) : 0

  // Optimization: if COGS allocation improved to 75%
  const optimizedCogsShare = 0.75
  const optimizedCogs = t.cost * optimizedCogsShare
  const optimizedTaxable = Math.max(0, t.revenue - optimizedCogs)
  const optimizedTax = optimizedTaxable * FEDERAL_RATE
  const potentialSavings = tax280E - optimizedTax

  return (
    <div className="space-y-6">
      {/* Tax impact cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card-modern p-5">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Normal Federal Tax (21%)
            </span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-emerald-500">
            {formatCurrency(normalTax)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            If all {formatCurrency(t.cost)} in costs were deductible
          </p>
        </div>

        <div className="card-modern p-5 border-red-500/20">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="h-4 w-4 text-red-500" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Estimated 280E Tax
            </span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-red-500">
            {formatCurrency(tax280E)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Only COGS deductible ({(estimatedCogsShare * 100).toFixed(0)}% of costs assumed)
          </p>
        </div>

        <div className="card-modern p-5 border-amber-500/20">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              280E Penalty
            </span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-amber-500">
            {formatCurrency(penalty280E)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {effectiveRate.toFixed(1)}% effective tax rate
          </p>
        </div>
      </div>

      {/* Non-deductible breakdown */}
      <div className="card-modern p-5">
        <h3 className="text-sm font-semibold mb-4">280E Deduction Breakdown</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Annual Revenue</span>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(t.revenue)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Total Costs</span>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(t.cost)}</p>
            <p className="text-xs text-muted-foreground">{cogsPercent.toFixed(1)}% of revenue</p>
          </div>
          <div>
            <span className="text-emerald-500">Estimated COGS (deductible)</span>
            <p className="text-lg font-bold tabular-nums text-emerald-500">
              {formatCurrency(estimatedCogs)}
            </p>
            <p className="text-xs text-muted-foreground">~{(estimatedCogsShare * 100).toFixed(0)}% of total costs</p>
          </div>
          <div>
            <span className="text-red-500">Non-Deductible OpEx</span>
            <p className="text-lg font-bold tabular-nums text-red-500">
              {formatCurrency(estimatedNonDeductible)}
            </p>
            <p className="text-xs text-muted-foreground">Disallowed under 280E</p>
          </div>
        </div>
      </div>

      {/* COGS Optimization */}
      {potentialSavings > 0 && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Percent className="h-5 w-5 text-emerald-500" />
            <h3 className="text-sm font-semibold">COGS Optimization Opportunity</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            Increasing your COGS allocation from {(estimatedCogsShare * 100).toFixed(0)}% to{' '}
            {(optimizedCogsShare * 100).toFixed(0)}% of total costs could save{' '}
            <span className="text-emerald-500 font-semibold">{formatCurrency(potentialSavings)}/year</span> in
            federal taxes.
          </p>
          <div className="text-sm space-y-1.5 text-muted-foreground">
            <p>Strategies to increase deductible COGS:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Capitalize cultivation labor into COGS</li>
              <li>Allocate facility overhead to production activities</li>
              <li>Reclassify direct production costs currently treated as OpEx</li>
              <li>Document processing and packaging as manufacturing COGS</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

function EmptyState({
  facilities,
}: {
  facilities: PnLData['facilities']
}) {
  const unconfigured = facilities.filter(
    (f: PnLData['facilities'][number]) => f.revenue === 0 && f.cost === 0,
  )

  return (
    <div className="card-modern p-8 text-center">
      <div className="mx-auto h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-5">
        <Calculator className="h-8 w-8 text-amber-500" />
      </div>
      <h2 className="text-xl font-semibold mb-2">
        No Financial Data Available
      </h2>
      <p className="text-muted-foreground max-w-md mx-auto mb-6">
        Configure OpEx models for your facilities to see 280E tax exposure
        analysis. OpEx models provide revenue, cost, and margin data that
        powers this report.
      </p>

      {unconfigured.length > 0 && (
        <div className="card-modern p-5 text-left max-w-lg mx-auto mb-6">
          <p className="text-sm font-medium mb-3">
            Facilities needing OpEx configuration:
          </p>
          <div className="space-y-2">
            {unconfigured.map((f: PnLData['facilities'][number]) => (
              <div
                key={f.id}
                className="flex items-center justify-between p-2 rounded-lg bg-muted/30"
              >
                <div>
                  <span className="text-sm font-medium">{f.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {f.stateCode}
                  </span>
                </div>
                <Link
                  href={`/facilities/${f.id}/opex`}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  Configure
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 max-w-lg mx-auto text-sm text-left">
        <p className="text-amber-200">
          <strong>What is IRC 280E?</strong> Cannabis businesses cannot deduct
          ordinary business expenses under federal tax law — only Cost of
          Goods Sold (COGS) is deductible. This significantly increases
          effective tax rates. Once you configure OpEx models, this page will
          show your financial exposure.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Financial Table
// ---------------------------------------------------------------------------

function FinancialBreakdown({ pnl }: { pnl: PnLData }) {
  const t = pnl.totals

  const activeFacilities = pnl.facilities
    .filter((f: PnLData['facilities'][number]) => f.revenue > 0 || f.cost > 0)
    .sort(
      (a: PnLData['facilities'][number], b: PnLData['facilities'][number]) =>
        b.revenue - a.revenue,
    )

  return (
    <>
      {/* 280E Context Banner */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 mb-6 text-sm">
        <p className="text-amber-200">
          Under IRC Section 280E, cannabis businesses cannot deduct ordinary
          business expenses — only Cost of Goods Sold (COGS). This
          significantly increases effective tax rates compared to non-cannabis
          businesses. The COGS/OpEx split below uses estimated allocations —
          configure your OpEx models for accurate breakdowns.
        </p>
      </div>

      {/* Aggregate KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-4 w-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Total Revenue
            </span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-emerald-500">
            {formatCurrency(t.revenue)}
          </p>
        </div>
        <div className="card-modern p-4">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            Total Costs
          </span>
          <p className="text-2xl font-bold tabular-nums mt-2">
            {formatCurrency(t.cost)}
          </p>
        </div>
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Gross Profit
            </span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-primary">
            {formatCurrency(t.grossProfit)}
          </p>
        </div>
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Gross Margin
            </span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-amber-500">
            {t.grossMargin.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* 280E Tax Impact Analysis */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
          Tax Impact Analysis
        </h2>
        <TaxImpactSection pnl={pnl} />
      </div>

      {/* Per-facility breakdown */}
      <div className="card-modern">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Per-Facility Breakdown</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {activeFacilities.length} facilit{activeFacilities.length === 1 ? 'y' : 'ies'} with financial data
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Facility
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  State
                </th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                  Revenue
                </th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                  Costs
                </th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                  Profit
                </th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                  Margin
                </th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                  $/lb
                </th>
              </tr>
            </thead>
            <tbody>
              {activeFacilities.map((f: PnLData['facilities'][number]) => (
                <tr
                  key={f.id}
                  className="border-b border-border/50 hover:bg-accent/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/facilities/${f.id}/opex`}
                      className="font-medium hover:text-primary transition-colors"
                    >
                      {f.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {f.stateCode}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-500">
                    {formatCurrency(f.revenue)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(f.cost)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-primary">
                    {formatCurrency(f.grossProfit)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {f.grossMargin.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {f.costPerPound > 0
                      ? `$${f.costPerPound.toFixed(0)}`
                      : '\u2014'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-4 py-3" colSpan={2}>
                  Total
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-500">
                  {formatCurrency(t.revenue)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCurrency(t.cost)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-primary">
                  {formatCurrency(t.grossProfit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {t.grossMargin.toFixed(1)}%
                </td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function TaxExposurePage() {
  const { data: pnl, isLoading } =
    trpc.financial.getConsolidatedPnL.useQuery(
      { groupBy: 'state' },
      { staleTime: 300_000 },
    )

  const hasFinancialData =
    pnl &&
    pnl.facilities.length > 0 &&
    pnl.totals.revenue > 0

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
            <ShieldAlert className="h-6 w-6 text-amber-500" />
            280E Tax Exposure
          </h1>
          <p className="text-muted-foreground mt-1">
            Financial analysis under IRC Section 280E
          </p>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="card-modern p-4 h-16 animate-pulse bg-muted/30" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="card-modern p-4 h-24 animate-pulse bg-muted/30"
              />
            ))}
          </div>
          <div className="card-modern p-4 h-64 animate-pulse bg-muted/30" />
        </div>
      ) : hasFinancialData ? (
        <FinancialBreakdown pnl={pnl} />
      ) : (
        <EmptyState facilities={pnl?.facilities ?? []} />
      )}
    </div>
  )
}
