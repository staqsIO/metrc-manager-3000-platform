'use client'

import { Fragment, useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Package, TrendingUp, ShoppingCart, Clock, Tag, AlertTriangle,
  ChevronDown, ChevronRight, Info, RefreshCw,
} from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type RouterOutputs = inferRouterOutputs<AppRouter>
type RunRateData = RouterOutputs['runRates']['getRunRates']

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
type CategoryRow = RunRateData['byCategory'][number]
type ProductRow = RunRateData['byProduct'][number]
type StrainRow = RunRateData['byStrain'][number]

const DATA_SOURCE_INFO: Record<string, { label: string; description: string; color: string }> = {
  pos: { label: 'Dutchie POS', description: 'Sales velocity from completed POS transactions', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' },
  retail_sales: { label: 'Metrc Sales (DB)', description: 'Sales velocity from synced Metrc retail receipts', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' },
  transfers: { label: 'Metrc Transfers', description: 'Velocity estimated from outgoing transfer manifests', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
  historical_transfers: { label: 'Historical Transfers', description: 'Velocity from imported historical transfer records (CSV)', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20' },
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-500/10', text: 'text-red-500', label: 'Critical' },
  low: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', label: 'Low' },
  healthy: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', label: 'Healthy' },
  excess: { bg: 'bg-blue-500/10', text: 'text-blue-500', label: 'Excess' },
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.healthy!
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', style.bg, style.text)}>
      {style.label}
    </span>
  )
}

function WeeksOfSupplyBar({ weeks }: { weeks: number | null }) {
  if (weeks === null) return <span className="text-xs text-muted-foreground">No sales</span>
  // Cap the visual bar at 24 weeks for display
  const pct = Math.min((weeks / 24) * 100, 100)
  const color = weeks < 1 ? 'bg-red-500' : weeks < 4 ? 'bg-yellow-500' : weeks <= 12 ? 'bg-emerald-500' : 'bg-blue-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted/30 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-12 text-right shrink-0">{weeks}w</span>
    </div>
  )
}

function CategoryTable({
  categories,
  products,
  strains,
}: {
  categories: CategoryRow[]
  products: ProductRow[]
  strains: StrainRow[]
}) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)

  return (
    <div className="card-modern overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-3 px-4 font-medium w-8"></th>
            <th className="text-left py-3 px-2 font-medium">Category</th>
            <th className="text-right py-3 px-2 font-medium">On Hand</th>
            <th className="text-right py-3 px-2 font-medium">Units/Week</th>
            <th className="text-left py-3 px-2 font-medium w-48">Weeks of Supply</th>
            <th className="text-left py-3 px-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => {
            const isExpanded = expandedCategory === cat.category
            const categoryProducts = products.filter(p => p.category === cat.category && p.currentInventory > 0)
            return (
              <Fragment key={cat.category}>
                <tr
                  className={cn(
                    'border-b border-border/50 cursor-pointer hover:bg-accent/30 transition-colors',
                    isExpanded && 'bg-accent/20',
                  )}
                  onClick={() => {
                    setExpandedCategory(isExpanded ? null : cat.category)
                    if (isExpanded) setExpandedProduct(null)
                  }}
                >
                  <td className="py-2.5 px-4">
                    {categoryProducts.length > 0 && (
                      isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </td>
                  <td className="py-2.5 px-2 font-medium text-foreground">{cat.category}</td>
                  <td className="py-2.5 px-2 text-right">
                    {cat.currentInventory.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    <span className="text-xs text-muted-foreground ml-1">{cat.currentInventoryUnit}</span>
                  </td>
                  <td className="py-2.5 px-2 text-right">
                    {cat.weeklySalesRate.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>
                  <td className="py-2.5 px-2">
                    <WeeksOfSupplyBar weeks={cat.weeksOfSupply} />
                  </td>
                  <td className="py-2.5 px-2">
                    <StatusBadge status={cat.status} />
                  </td>
                </tr>
                {isExpanded && categoryProducts.map((prod) => {
                  const productStrains = strains.filter(s => s.productName === prod.productName && s.category === cat.category)
                  const isProductExpanded = expandedProduct === `${cat.category}::${prod.productName}`
                  const hasStrains = productStrains.length > 0
                  return (
                    <Fragment key={prod.productName}>
                      <tr
                        className={cn(
                          'border-b border-border/30 bg-accent/10',
                          hasStrains && 'cursor-pointer hover:bg-accent/20',
                          isProductExpanded && 'bg-accent/20',
                        )}
                        onClick={hasStrains ? (e) => {
                          e.stopPropagation()
                          setExpandedProduct(isProductExpanded ? null : `${cat.category}::${prod.productName}`)
                        } : undefined}
                      >
                        <td className="py-1.5 px-4 pl-7">
                          {hasStrains && (
                            isProductExpanded
                              ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                              : <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          )}
                        </td>
                        <td className="py-1.5 px-2 pl-6 text-muted-foreground text-xs">{prod.productName}</td>
                        <td className="py-1.5 px-2 text-right text-xs">
                          {prod.currentInventory.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </td>
                        <td className="py-1.5 px-2 text-right text-xs">
                          {prod.weeklySalesRate.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </td>
                        <td className="py-1.5 px-2">
                          <WeeksOfSupplyBar weeks={prod.weeksOfSupply} />
                        </td>
                        <td className="py-1.5 px-2">
                          <StatusBadge status={prod.status} />
                        </td>
                      </tr>
                      {isProductExpanded && productStrains.map((strain) => (
                        <tr key={strain.strainName} className="border-b border-border/20 bg-accent/5">
                          <td className="py-1 px-4"></td>
                          <td className="py-1 px-2 pl-10 text-muted-foreground/70 text-xs italic">{strain.strainName}</td>
                          <td className="py-1 px-2 text-right text-xs text-muted-foreground/70">
                            {strain.currentInventory.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                          </td>
                          <td className="py-1 px-2 text-right text-xs text-muted-foreground/70">
                            {strain.weeklySalesRate.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                            <span className="text-[10px] ml-0.5">est</span>
                          </td>
                          <td className="py-1 px-2">
                            <WeeksOfSupplyBar weeks={strain.weeksOfSupply} />
                          </td>
                          <td className="py-1 px-2">
                            <StatusBadge status={strain.status} />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </Fragment>
            )
          })}
          {categories.length === 0 && (
            <tr>
              <td colSpan={6} className="py-8 text-center text-muted-foreground">
                No inventory data available
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function RunRatesPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const [daysLookback, setDaysLookback] = useState(30)

  const utils = trpc.useUtils()
  const { data, error, isLoading } = trpc.runRates.getRunRates.useQuery(
    { facilityId, daysLookback },
    { enabled: !!facilityId, staleTime: 300_000 },
  )

  const { data: syncStatus } = trpc.inventory.getPackageSyncStatus.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )

  const refreshMutation = trpc.inventory.refreshFromMetrc.useMutation({
    onSuccess: () => {
      void utils.inventory.getPackageSyncStatus.invalidate()
      void utils.runRates.getRunRates.invalidate()
    },
  })

  const lastSyncLabel = syncStatus?.lastSyncAt
    ? `Last synced ${formatTimeAgo(new Date(syncStatus.lastSyncAt))}`
    : 'Never synced'

  const kpiCards = data ? [
    {
      label: 'Inventory Units',
      value: data.totalInventoryUnits.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      icon: Package,
      color: 'text-foreground',
    },
    {
      label: 'Units/Week',
      value: data.totalWeeklySalesRate.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      icon: ShoppingCart,
      color: 'text-blue-500',
    },
    {
      label: 'Weeks of Supply',
      value: data.overallWeeksOfSupply !== null ? String(data.overallWeeksOfSupply) : '\u2014',
      icon: Clock,
      color: data.overallWeeksOfSupply !== null && data.overallWeeksOfSupply < 4 ? 'text-yellow-500' : 'text-emerald-500',
      suffix: 'weeks',
    },
    {
      label: 'Promo Candidates',
      value: String(data.promoOpportunities.length),
      icon: Tag,
      color: 'text-blue-500',
    },
    {
      label: 'Restock Priorities',
      value: String(data.restockPriorities.length),
      icon: AlertTriangle,
      color: data.restockPriorities.length > 0 ? 'text-red-500' : 'text-emerald-500',
    },
  ] : []

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Run Rates</h1>
          <p className="text-muted-foreground mt-1">
            Inventory vs. sales velocity analysis
            {data && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full border border-border">
                {DATA_SOURCE_INFO[data.dataSource]?.label ?? 'No velocity data'}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Lookback:</span>
          <select
            value={daysLookback}
            onChange={(e) => setDaysLookback(Number(e.target.value))}
            className="text-sm bg-background border border-border rounded-md px-2 py-1"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>6 months</option>
            <option value={365}>1 year</option>
            <option value={3650}>All time</option>
          </select>
          <div className="flex items-center gap-2 ml-3 pl-3 border-l border-border">
            <span className="text-xs text-muted-foreground">{lastSyncLabel}</span>
            <button
              onClick={() => refreshMutation.mutate({ facilityId })}
              disabled={refreshMutation.isPending}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                refreshMutation.isPending
                  ? 'border-border text-muted-foreground cursor-wait'
                  : 'border-border text-foreground hover:bg-muted/50'
              )}
              title="Fetch latest packages from Metrc"
            >
              <RefreshCw className={cn('h-3 w-3', refreshMutation.isPending && 'animate-spin')} />
              {refreshMutation.isPending ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="card-modern p-4 mb-6 border-red-500/30">
          <p className="text-sm text-red-500">Failed to load run-rate data: {error.message}</p>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card-modern p-4 h-20 animate-pulse">
                <div className="h-3 w-20 bg-muted rounded mb-3" />
                <div className="h-6 w-16 bg-muted rounded" />
              </div>
            ))}
          </div>
          <div className="text-sm text-muted-foreground mb-2">Loading run rate data from Metrc...</div>
          <div className="card-modern p-4 animate-pulse">
            <div className="h-4 w-32 bg-muted rounded mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 bg-muted/60 rounded" />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            {kpiCards.map((card) => (
              <div key={card.label} className="card-modern p-4">
                <div className="flex items-center gap-2 mb-1">
                  <card.icon className={cn('h-4 w-4', card.color)} />
                  <span className="text-xs text-muted-foreground">{card.label}</span>
                </div>
                <p className={cn('text-2xl font-bold', card.color)}>
                  {card.value}
                  {card.suffix && <span className="text-sm font-normal ml-1">{card.suffix}</span>}
                </p>
              </div>
            ))}
          </div>

          {/* Sales period + data source info */}
          <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground">
            <span>Sales period: {data.salesPeriod.from} to {data.salesPeriod.to}</span>
            <span>{data.totalTransactions} transactions</span>
            {DATA_SOURCE_INFO[data.dataSource] && (
              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium', DATA_SOURCE_INFO[data.dataSource]!.color)}>
                <Info className="h-3 w-3" />
                {DATA_SOURCE_INFO[data.dataSource]!.label}
              </span>
            )}
          </div>
          {data.dataSource === 'historical_transfers' && (
            <div className="card-modern p-3 mb-4 border-amber-500/20 flex items-start gap-2">
              <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Velocity data is based on imported historical transfer records. Dispensaries with synced Metrc sales receipts will use those automatically.
              </p>
            </div>
          )}

          {/* Promo Opportunities */}
          {data.promoOpportunities.length > 0 && (
            <div className="card-modern p-4 mb-6 border-blue-500/20">
              <div className="flex items-center gap-2 mb-3">
                <Tag className="h-4 w-4 text-blue-500" />
                <h3 className="text-sm font-medium">Promo Opportunities</h3>
              </div>
              <div className="space-y-2">
                {data.promoOpportunities.map((opp: { category: string; weeksOfSupply: number | null; currentInventory: number; recommendation: string }) => (
                  <div key={opp.category} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{opp.category}</span>
                    <span className="text-muted-foreground text-xs">{opp.recommendation}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Restock Alerts */}
          {data.restockPriorities.length > 0 && (
            <div className="card-modern p-4 mb-6 border-red-500/20">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <h3 className="text-sm font-medium">Restock Priorities</h3>
              </div>
              <div className="space-y-2">
                {data.restockPriorities.map((item: { category: string; weeksOfSupply: number | null; currentInventory: number; urgency: string; recommendation: string }) => (
                  <div key={item.category} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={item.urgency} />
                      <span className="text-foreground">{item.category}</span>
                    </div>
                    <span className="text-muted-foreground text-xs">{item.recommendation}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Category Table with SKU drill-down */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-muted-foreground">Category Breakdown</h3>
            </div>
            <CategoryTable categories={data.byCategory} products={data.byProduct} strains={data.byStrain} />
          </div>
        </>
      )}
    </div>
  )
}
