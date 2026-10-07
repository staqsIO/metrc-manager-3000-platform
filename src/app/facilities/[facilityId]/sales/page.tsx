'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { cn, marginColor } from '@/lib/utils'
import {
  DollarSign, Receipt, TrendingUp, Tag, ShoppingCart,
  BarChart3, PieChart, Search,
  Users, Upload,
} from 'lucide-react'
import { KpiCard } from '@/shared/components/KpiCard'
import { Pagination } from '@/shared/components/Pagination'
import { TableSkeletonRows } from '@/shared/components/ui/table-skeleton'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { PageHeader } from '@/shared/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Badge } from '@/shared/components/ui/badge'
import { RecordSaleButton } from '@/features/sales/components/RecordSaleButton'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type RouterOutputs = inferRouterOutputs<AppRouter>
type MetrcReceiptItem = RouterOutputs['sales']['getMetrcReceipts']['items'][number]

export default function SalesPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  // Fetch facility to determine whether Dutchie credentials are configured.
  // Metrc Sales is the primary (default) tab; Dutchie is shown only when
  // active sandbox/production credentials exist.
  const { data: facility } = trpc.facility.getById.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 60_000 },
  )
  const hasDutchie = facility?.dutchieEnvironment != null
    && facility.dutchieEnvironment !== 'none'

  const [activeTab, setActiveTab] = useState<'dutchie' | 'metrc'>('metrc')
  const [metrcStatus, setMetrcStatus] = useState<'active' | 'inactive'>('active')
  const [metrcSearch, setMetrcSearch] = useState('')
  const [metrcPage, setMetrcPage] = useState(1)

  // CSV import state
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const utils = trpc.useUtils()

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImporting(true)
    setImportResult(null)

    try {
      const csvText = await file.text()
      const response = await fetch('/api/import/sales-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, facilityId }),
      })

      const data = await response.json()

      if (data.success) {
        setImportResult({
          success: true,
          message: `Imported ${data.lineItems.inserted.toLocaleString()} line items → ${data.receipts.upserted.toLocaleString()} receipts${data.lineItems.skipped > 0 ? ` (${data.lineItems.skipped.toLocaleString()} duplicates skipped)` : ''}`,
        })
        // Refresh the inactive queries
        void utils.sales.getMetrcReceipts.invalidate()
        void utils.sales.getMetrcSalesSummary.invalidate()
      } else {
        setImportResult({ success: false, message: data.error || 'Import failed' })
      }
    } catch (err) {
      setImportResult({ success: false, message: err instanceof Error ? err.message : 'Import failed' })
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // If a user lands on the dutchie tab on a facility without credentials,
  // snap them back to metrc (shouldn't happen via UI but defends against
  // stale state from a previous session).
  useEffect(() => {
    if (!hasDutchie && activeTab === 'dutchie') setActiveTab('metrc')
  }, [hasDutchie, activeTab])

  // Dutchie queries — only fire when tab is active AND credentials exist
  const dutchieEnabled = !!facilityId && hasDutchie && activeTab === 'dutchie'
  const { data: summary } = trpc.sales.getSummary.useQuery(
    { facilityId },
    { enabled: dutchieEnabled }
  )

  const { data: dailySales } = trpc.sales.getDailySales.useQuery(
    { facilityId, days: 30 },
    { enabled: dutchieEnabled }
  )

  const { data: topProducts } = trpc.sales.getTopProducts.useQuery(
    { facilityId, limit: 10 },
    { enabled: dutchieEnabled }
  )

  const { data: categoryMargins } = trpc.sales.getCategoryMargins.useQuery(
    { facilityId, daysLookback: 30 },
    { enabled: dutchieEnabled, staleTime: 120_000 }
  )

  const { data: recentDeliveries } = trpc.sales.getDeliveries.useQuery(
    { facilityId, page: 1, pageSize: 10 },
    { enabled: dutchieEnabled }
  )

  // Metrc queries
  const { data: metrcSummary } = trpc.sales.getMetrcSalesSummary.useQuery(
    { facilityId, status: metrcStatus },
    { enabled: !!facilityId && activeTab === 'metrc', staleTime: 300_000 }
  )

  const { data: metrcReceipts, isLoading: metrcLoading } = trpc.sales.getMetrcReceipts.useQuery(
    { facilityId, status: metrcStatus, search: metrcSearch || undefined, page: metrcPage, pageSize: 25 },
    { enabled: !!facilityId && activeTab === 'metrc', staleTime: 300_000 }
  )

  const summaryCards = [
    { label: 'Total Revenue', value: summary?.totalRevenue ?? 0, icon: DollarSign, color: 'text-emerald-500', prefix: '$' },
    { label: 'Avg Order Value', value: summary?.avgOrderValue ?? 0, icon: Receipt, color: 'text-blue-500', prefix: '$' },
    { label: 'Transactions', value: summary?.totalTransactions ?? 0, icon: ShoppingCart, color: 'text-foreground' },
    { label: 'Top Category', value: summary?.topCategory?.name ?? '-', icon: Tag, color: 'text-amber-500', isText: true },
    { label: 'Total Tax', value: summary?.totalTax ?? 0, icon: TrendingUp, color: 'text-muted-foreground', prefix: '$' },
    { label: 'Total Discounts', value: summary?.totalDiscount ?? 0, icon: BarChart3, color: 'text-red-500', prefix: '$' },
  ]

  const maxDailyRevenue = dailySales?.reduce((max, d) => Math.max(max, d.revenue), 0) ?? 1

  return (
    <div className="p-8">
      <PageHeader
        title="Sales"
        description={activeTab === 'dutchie' ? 'POS transaction data from Dutchie' : 'Sales receipts from Metrc'}
        actions={activeTab === 'metrc' ? <RecordSaleButton facilityId={facilityId} /> : undefined}
      />
      {/* Hide Dutchie tab + queries entirely when no Dutchie credentials.
          Metrc Sales is the only view rendered for those facilities. */}

      {/* Tab Toggle — Metrc Sales is the primary/default. Dutchie POS only
          renders when the facility has active Dutchie credentials. When the
          tab strip would have a single button (Metrc only), suppress it. */}
      {hasDutchie && (
        <div className="flex items-center gap-1 mb-6 p-1 rounded-lg bg-muted/30 w-fit">
          <button
            onClick={() => setActiveTab('metrc')}
            className={cn(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              activeTab === 'metrc' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Metrc Sales
          </button>
          <button
            onClick={() => setActiveTab('dutchie')}
            className={cn(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              activeTab === 'dutchie' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Dutchie POS
          </button>
        </div>
      )}

      {activeTab === 'dutchie' ? (
        <>
          {/* Dutchie Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            {summaryCards.map((card) => (
              <KpiCard key={card.label} {...card} />
            ))}
          </div>

          {/* Daily Revenue Bar Chart (CSS) */}
          {dailySales && dailySales.length > 0 && (
            <div className="card-modern p-4 mb-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Daily Revenue (Last 30 Days)</h3>
              <div className="flex items-end gap-1 h-32">
                {dailySales.map((day) => (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div
                      className="w-full bg-emerald-500/80 rounded-t hover:bg-emerald-500 transition-colors min-h-[2px]"
                      style={{ height: `${(day.revenue / maxDailyRevenue) * 100}%` }}
                    />
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-popover border border-border rounded px-2 py-1 text-xs whitespace-nowrap z-10">
                      {day.date}: ${day.revenue.toLocaleString()} ({day.orderCount} txn)
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>{dailySales[0]?.date}</span>
                <span>{dailySales[dailySales.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {/* Category Margins */}
          {categoryMargins && categoryMargins.categories.length > 0 && (
            <div className="card-modern p-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <PieChart className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium text-muted-foreground">Category Margins</h3>
                </div>
                <Badge variant="outline" className="text-xs">Last 30d</Badge>
              </div>
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
                    {categoryMargins.categories.map((cat) => (
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
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right text-emerald-500">
                        ${categoryMargins.totals.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell className="text-right text-red-500">
                        ${categoryMargins.totals.cogs.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${categoryMargins.totals.grossProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell className={cn('text-right font-medium', marginColor(categoryMargins.totals.marginPercent))}>
                        {categoryMargins.totals.marginPercent.toFixed(1)}%
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Top Products */}
          {topProducts && topProducts.length > 0 && (
            <div className="card-modern p-4 mb-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Top Products by Revenue</h3>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead className="text-right">Units Sold</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topProducts.map((product, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{product.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{product.category}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{product.brand || '-'}</TableCell>
                        <TableCell className="text-right">{product.unitsSold}</TableCell>
                        <TableCell className="text-right font-medium text-emerald-500">
                          ${product.revenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Recent Transactions */}
          {recentDeliveries && recentDeliveries.items.length > 0 && (
            <div className="card-modern p-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Recent Transactions</h3>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transaction</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentDeliveries.items.map((delivery: { TransactionId: string; CustomerName: string | null; Status: string; PaymentMethod: string | null; EmployeeName: string | null; OrderTotal: number }) => (
                      <TableRow key={delivery.TransactionId}>
                        <TableCell className="font-mono text-xs">{delivery.TransactionId.slice(0, 16)}</TableCell>
                        <TableCell>{delivery.CustomerName || 'Walk-in'}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              delivery.Status === 'Completed' ? 'border-emerald-500/30 text-emerald-500' :
                              delivery.Status === 'Pending' ? 'border-yellow-500/30 text-yellow-500' :
                              delivery.Status === 'Cancelled' ? 'border-red-500/30 text-red-500' :
                              'border-blue-500/30 text-blue-500'
                            )}
                          >
                            {delivery.Status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{delivery.PaymentMethod || '-'}</TableCell>
                        <TableCell className="text-muted-foreground">{delivery.EmployeeName || '-'}</TableCell>
                        <TableCell className="text-right font-medium">
                          ${delivery.OrderTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Metrc Sales Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <Receipt className="h-4 w-4 text-foreground" />
                <span className="text-xs text-muted-foreground">Receipts</span>
              </div>
              <p className="text-2xl font-bold">{metrcSummary?.receiptCount ?? 0}</p>
            </div>
            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="h-4 w-4 text-emerald-500" />
                <span className="text-xs text-muted-foreground">Total Revenue</span>
              </div>
              <p className="text-2xl font-bold text-emerald-500">
                ${(metrcSummary?.totalRevenue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <ShoppingCart className="h-4 w-4 text-blue-500" />
                <span className="text-xs text-muted-foreground">Avg Receipt</span>
              </div>
              <p className="text-2xl font-bold text-blue-500">
                ${(metrcSummary?.avgReceiptValue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-amber-500" />
                <span className="text-xs text-muted-foreground">Customer Types</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {metrcSummary?.customerTypes.map((ct) => (
                  <span key={ct.type} className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs">
                    {ct.type} <span className="ml-1 text-muted-foreground">({ct.count})</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Active / Inactive sub-tabs + Search */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/30">
              {(['active', 'inactive'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => { setMetrcStatus(status); setMetrcPage(1); }}
                  className={cn(
                    'px-3 py-1 rounded-md text-sm font-medium transition-colors capitalize',
                    metrcStatus === status
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {status}
                </button>
              ))}
            </div>
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by receipt number or customer type..."
                value={metrcSearch}
                onChange={(e) => { setMetrcSearch(e.target.value); setMetrcPage(1); }}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            {metrcStatus === 'inactive' && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleCSVImport}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors',
                    importing
                      ? 'border-border text-muted-foreground cursor-wait'
                      : 'border-border text-foreground hover:bg-muted/50'
                  )}
                >
                  <Upload className="h-4 w-4" />
                  {importing ? 'Importing...' : 'Import CSV'}
                </button>
              </>
            )}
          </div>
          {importResult && (
            <div className={cn(
              'mb-4 px-4 py-2 rounded-lg text-sm',
              importResult.success ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
            )}>
              {importResult.message}
            </div>
          )}

          {/* Metrc Receipts Table */}
          <div className="card-modern overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Receipt #</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Date</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Customer Type</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Packages</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {metrcLoading ? (
                    <TableSkeletonRows columns={5} />
                  ) : !metrcReceipts?.items?.length ? (
                    <EmptyState
                      icon={DollarSign}
                      title="No Metrc sales receipts found"
                      description="Sales receipts will appear here once recorded in Metrc."
                      colSpan={5}
                    />
                  ) : (
                    metrcReceipts.items.map((r: MetrcReceiptItem) => (
                      <tr key={r.Id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 px-4 font-mono text-xs">{r.ReceiptNumber}</td>
                        <td className="py-2.5 px-4 text-muted-foreground text-xs">
                          {new Date(r.SalesDateTime).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            r.SalesCustomerType === 'Patient' ? 'bg-blue-500/10 text-blue-500' :
                            r.SalesCustomerType === 'Caregiver' ? 'bg-purple-500/10 text-purple-500' :
                            'bg-muted text-foreground'
                          )}>
                            {r.SalesCustomerType}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">{r.TotalPackages}</td>
                        <td className="py-2.5 px-4 text-right font-medium text-emerald-500">
                          ${r.TotalPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {metrcReceipts && (
              <Pagination
                page={metrcReceipts.page}
                totalPages={metrcReceipts.totalPages}
                pageSize={metrcReceipts.pageSize}
                total={metrcReceipts.total}
                onPageChange={setMetrcPage}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
