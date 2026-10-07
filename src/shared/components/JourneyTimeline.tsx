'use client'

import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Package,
  Wheat,
  Truck,
  DollarSign,
  ArrowDown,
  AlertCircle,
  TrendingUp,
  Clock,
  CreditCard,
  User,
  Tag,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Local types — mirrors to avoid deep type-instantiation errors with tRPC inference.
// Keep in sync with: provenance-engine.ts, transfer-correlation.ts, sales-reconciliation.ts
// ---------------------------------------------------------------------------

interface ProvenanceNode {
  label: string
  type: 'package' | 'harvest'
  depth: number
  itemName?: string
  itemCategory?: string
  quantity?: number
  unitOfMeasure?: string
  packagedDate?: string
  labTestingState?: string
  strain?: string
  productionBatch?: string
  harvestName?: string
  harvestType?: string
  sourceStrains?: string
  currentWeight?: number
  harvestStartDate?: string
  finishedDate?: string | null
}

interface TransferLink {
  packageLabel: string
  direction: 'incoming' | 'outgoing'
  manifestNumber: string
  counterpartyFacility: string
  counterpartyLicense: string
  transferDate: string | null
  packageCount: number
  confidence: 'confirmed' | 'likely'
}

interface SalesMatch {
  transactionId: string
  productName: string
  quantity: number
  totalPrice: number
  saleDate: string
  confidence: 'exact'
  customerName: string | null
  customerType: string | null
  paymentMethod: string | null
  employeeName: string | null
  category: string
  brand: string | null
  strainName: string | null
  discountAmount: number
  unitPrice: number
}

interface SalesAnalytics {
  totalRevenue: number
  totalTransactions: number
  totalUnitsSold: number
  avgPrice: number
  totalDiscount: number
  timeInSystem: {
    minDays: number | null
    maxDays: number | null
    avgDays: number | null
  }
  revenueByDescendant: {
    packageLabel: string
    revenue: number
    transactions: number
  }[]
}

// ---------------------------------------------------------------------------
// Lab testing badge styles
// ---------------------------------------------------------------------------

const LAB_STATE_STYLES: Record<string, string> = {
  TestPassed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  TestFailed: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
  NotSubmitted: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30',
  AwaitingConfirmation: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
  NotRequired: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ---------------------------------------------------------------------------
// Timeline connector
// ---------------------------------------------------------------------------

function TimelineConnector() {
  return (
    <div className="flex justify-center py-1">
      <ArrowDown className="h-4 w-4 text-muted-foreground/50" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Harvest node
// ---------------------------------------------------------------------------

function HarvestCard({ node }: { node: ProvenanceNode }) {
  return (
    <div className="card-modern p-4 border-l-2 border-l-emerald-500">
      <div className="flex items-center gap-2 mb-2">
        <Wheat className="h-4 w-4 shrink-0 text-emerald-500" />
        <p className="font-mono text-sm font-semibold truncate">{node.label}</p>
        <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">Harvest</Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {node.harvestType && (
          <div>
            <span className="text-xs text-muted-foreground">Type</span>
            <p>{node.harvestType}</p>
          </div>
        )}
        {node.sourceStrains && (
          <div>
            <span className="text-xs text-muted-foreground">Strains</span>
            <p className="truncate">{node.sourceStrains}</p>
          </div>
        )}
        {node.currentWeight != null && (
          <div>
            <span className="text-xs text-muted-foreground">Weight</span>
            <p>{node.currentWeight.toLocaleString(undefined, { maximumFractionDigits: 2 })} g</p>
          </div>
        )}
        {node.harvestStartDate && (
          <div>
            <span className="text-xs text-muted-foreground">Start Date</span>
            <p>{formatDate(node.harvestStartDate)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Package node
// ---------------------------------------------------------------------------

function PackageCard({
  node,
  isTarget,
}: {
  node: ProvenanceNode
  isTarget: boolean
}) {
  return (
    <div
      className={cn(
        'card-modern p-4 transition-colors',
        isTarget && 'border-blue-500/50 ring-1 ring-blue-500/20',
        !isTarget && 'border-l-2 border-l-gray-500/40',
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="font-mono text-sm font-semibold truncate">{node.label}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isTarget && (
            <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 text-[10px]">
              This Package
            </Badge>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {node.itemName && (
          <div>
            <span className="text-xs text-muted-foreground">Item</span>
            <p className="truncate">{node.itemName}</p>
          </div>
        )}
        {node.itemCategory && (
          <div>
            <span className="text-xs text-muted-foreground">Category</span>
            <p className="truncate">{node.itemCategory}</p>
          </div>
        )}
        {node.quantity != null && (
          <div>
            <span className="text-xs text-muted-foreground">Quantity</span>
            <p>
              {node.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
              <span className="text-muted-foreground">{node.unitOfMeasure}</span>
            </p>
          </div>
        )}
        {node.packagedDate && (
          <div>
            <span className="text-xs text-muted-foreground">Packaged</span>
            <p>{formatDate(node.packagedDate)}</p>
          </div>
        )}
        {node.strain && (
          <div>
            <span className="text-xs text-muted-foreground">Strain</span>
            <p className="truncate">{node.strain}</p>
          </div>
        )}
        {node.labTestingState && (
          <div>
            <span className="text-xs text-muted-foreground">Lab Testing</span>
            <div className="mt-0.5">
              <Badge className={cn('text-[10px]', LAB_STATE_STYLES[node.labTestingState] ?? LAB_STATE_STYLES.NotSubmitted)}>
                {node.labTestingState}
              </Badge>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Transfer node
// ---------------------------------------------------------------------------

function TransferCard({ link }: { link: TransferLink }) {
  return (
    <div className="card-modern p-4 border-dashed border-l-2 border-l-cyan-500">
      <div className="flex items-center gap-2 mb-2">
        <Truck className="h-4 w-4 shrink-0 text-cyan-500" />
        <p className="text-sm font-semibold">
          {link.direction === 'incoming' ? 'Received From' : 'Sent To'}
        </p>
        <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">Transfer</Badge>
        {link.confidence === 'likely' && (
          <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30 text-[10px]">
            Likely
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <span className="text-xs text-muted-foreground">Facility</span>
          <p className="truncate">{link.counterpartyFacility}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">License</span>
          <p className="font-mono text-xs truncate">{link.counterpartyLicense}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Manifest</span>
          <p className="font-mono text-xs">{link.manifestNumber}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Date</span>
          <p>{formatDate(link.transferDate)}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Packages in Transfer</span>
          <p>{link.packageCount}</p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sale node (enriched)
// ---------------------------------------------------------------------------

function SaleCard({ sale }: { sale: SalesMatch }) {
  return (
    <div className="card-modern p-4 border-l-2 border-l-purple-500">
      <div className="flex items-center gap-2 mb-2">
        <DollarSign className="h-4 w-4 shrink-0 text-purple-500" />
        <p className="text-sm font-semibold">POS Sale</p>
        <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">Dutchie</Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <span className="text-xs text-muted-foreground">Transaction</span>
          <p className="font-mono text-xs truncate">{sale.transactionId}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Product</span>
          <p className="truncate">{sale.productName}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Qty</span>
          <p>{sale.quantity}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Total</span>
          <p>{formatCurrency(sale.totalPrice)}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Sale Date</span>
          <p>{formatDate(sale.saleDate)}</p>
        </div>
        {sale.customerName && (
          <div>
            <span className="text-xs text-muted-foreground">Customer</span>
            <p className="truncate flex items-center gap-1">
              <User className="h-3 w-3 text-muted-foreground" />
              {sale.customerName}
              {sale.customerType && (
                <Badge variant="outline" className="text-[9px] ml-1">{sale.customerType}</Badge>
              )}
            </p>
          </div>
        )}
        {sale.paymentMethod && (
          <div>
            <span className="text-xs text-muted-foreground">Payment</span>
            <p className="flex items-center gap-1">
              <CreditCard className="h-3 w-3 text-muted-foreground" />
              {sale.paymentMethod}
            </p>
          </div>
        )}
        {sale.employeeName && (
          <div>
            <span className="text-xs text-muted-foreground">Employee</span>
            <p className="truncate">{sale.employeeName}</p>
          </div>
        )}
        {sale.category && (
          <div>
            <span className="text-xs text-muted-foreground">Category</span>
            <p className="truncate flex items-center gap-1">
              <Tag className="h-3 w-3 text-muted-foreground" />
              {sale.category}
            </p>
          </div>
        )}
        {sale.brand && (
          <div>
            <span className="text-xs text-muted-foreground">Brand</span>
            <p className="truncate">{sale.brand}</p>
          </div>
        )}
        {sale.discountAmount > 0 && (
          <div>
            <span className="text-xs text-muted-foreground">Discount</span>
            <p className="text-yellow-500">-{formatCurrency(sale.discountAmount)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sales Analytics Banner
// ---------------------------------------------------------------------------

function SalesAnalyticsBanner({ analytics }: { analytics: SalesAnalytics }) {
  return (
    <div className="card-modern p-4 bg-purple-500/5 border-purple-500/20">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="h-4 w-4 text-purple-500" />
        <p className="text-sm font-semibold">Sales Summary</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Total Revenue</p>
          <p className="text-lg font-bold">{formatCurrency(analytics.totalRevenue)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Transactions</p>
          <p className="text-lg font-bold">{analytics.totalTransactions}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Avg Price/Unit</p>
          <p className="text-lg font-bold">{formatCurrency(analytics.avgPrice)}</p>
        </div>
        {analytics.timeInSystem.avgDays != null && (
          <div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Harvest to Sale
            </p>
            <p className="text-lg font-bold">{analytics.timeInSystem.avgDays}d avg</p>
            {analytics.timeInSystem.minDays !== analytics.timeInSystem.maxDays && (
              <p className="text-xs text-muted-foreground">
                {analytics.timeInSystem.minDays}d – {analytics.timeInSystem.maxDays}d
              </p>
            )}
          </div>
        )}
        {analytics.totalDiscount > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Total Discounts</p>
            <p className="text-lg font-bold text-yellow-500">-{formatCurrency(analytics.totalDiscount)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main JourneyTimeline component
// ---------------------------------------------------------------------------

export function JourneyTimeline({
  facilityId,
  packageLabel,
}: {
  facilityId: string
  packageLabel: string
}) {
  const { data, isLoading, error } = trpc.packages.packageJourney.useQuery(
    { facilityId, packageLabel },
    { enabled: !!facilityId && !!packageLabel },
  )

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="card-modern p-8 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
        <h3 className="mt-4 text-lg font-semibold">Failed to load journey</h3>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
      </div>
    )
  }

  if (!data) return null

  const { tree, transfers, sales, descendantSales, salesAnalytics, salesError } = data

  // Group upstream ancestors by depth (deepest = earliest ancestor first)
  const ancestors = [...tree.nodes]
    .filter((n: ProvenanceNode) => n.depth > 0)
    .sort((a: ProvenanceNode, b: ProvenanceNode) => b.depth - a.depth)
  const targetNode = tree.nodes.find((n: ProvenanceNode) => n.depth === 0)
  const downstream = [...tree.downstream].sort((a, b) => a.depth - b.depth)

  const incomingTransfers = transfers.filter((t: TransferLink) => t.direction === 'incoming')
  const outgoingTransfers = transfers.filter((t: TransferLink) => t.direction === 'outgoing')

  const descendantSalesEntries: [string, SalesMatch[]][] = descendantSales
    ? (Object.entries(descendantSales) as [string, SalesMatch[]][]).filter(([, s]) => s.length > 0)
    : []
  const totalSalesCount = sales.length + descendantSalesEntries.reduce((sum, [, s]) => sum + s.length, 0)

  const hasContent = ancestors.length > 0 || downstream.length > 0 || transfers.length > 0 || totalSalesCount > 0

  if (!hasContent && !targetNode) {
    return (
      <div className="card-modern p-8 text-center">
        <Package className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No journey data available</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Source harvest, package lineage, transfer, and sales information is not available for this package.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {/* Section: Incoming Transfers */}
      {incomingTransfers.length > 0 && (
        <>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Received via Transfer
          </p>
          {incomingTransfers.map((t: TransferLink, i: number) => (
            <TransferCard key={`in-${i}`} link={t} />
          ))}
          <TimelineConnector />
        </>
      )}

      {/* Section: Upstream ancestors (deepest first = top of timeline) */}
      {ancestors.length > 0 && (
        <>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Upstream Lineage
          </p>
          {ancestors.map((node) => (
            <div key={node.label}>
              {node.type === 'harvest' ? (
                <HarvestCard node={node} />
              ) : (
                <PackageCard node={node} isTarget={false} />
              )}
              <TimelineConnector />
            </div>
          ))}
        </>
      )}

      {/* Section: Target package */}
      {targetNode && <PackageCard node={targetNode} isTarget={true} />}

      {/* Section: Downstream children */}
      {downstream.length > 0 && (
        <>
          <TimelineConnector />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Downstream Products
          </p>
          {downstream.map((node, i) => (
            <div key={node.label}>
              <PackageCard node={node} isTarget={false} />
              {i < downstream.length - 1 && <TimelineConnector />}
            </div>
          ))}
        </>
      )}

      {/* Section: Outgoing Transfers */}
      {outgoingTransfers.length > 0 && (
        <>
          <TimelineConnector />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Outgoing Transfer
          </p>
          {outgoingTransfers.map((t: TransferLink, i: number) => (
            <TransferCard key={`out-${i}`} link={t} />
          ))}
        </>
      )}

      {/* Section: Sales Error Warning */}
      {salesError && (
        <>
          <TimelineConnector />
          <div className="card-modern p-4 bg-yellow-500/5 border-yellow-500/20">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                Sales data unavailable — POS integration may not be configured for this facility.
              </p>
            </div>
          </div>
        </>
      )}

      {/* Section: Sales Analytics Banner */}
      {salesAnalytics && salesAnalytics.totalTransactions > 0 && (
        <>
          <TimelineConnector />
          <SalesAnalyticsBanner analytics={salesAnalytics} />
        </>
      )}

      {/* Section: Target Package Sales */}
      {sales.length > 0 && (
        <>
          {!salesAnalytics && <TimelineConnector />}
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 mt-2">
            POS Sales ({sales.length} transaction{sales.length !== 1 ? 's' : ''})
          </p>
          {sales.map((sale: SalesMatch, idx: number) => (
            <SaleCard key={`${sale.transactionId}-${idx}`} sale={sale} />
          ))}
        </>
      )}

      {/* Section: Descendant Package Sales */}
      {descendantSalesEntries.length > 0 && (
        <>
          <TimelineConnector />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Revenue from Downstream Products
          </p>
          {descendantSalesEntries.map(([label, dSales]) => (
            <div key={label} className="space-y-1">
              <p className="text-xs font-mono text-muted-foreground ml-1">{label}</p>
              {dSales.map((sale: SalesMatch, idx: number) => (
                <SaleCard key={`${label}-${sale.transactionId}-${idx}`} sale={sale} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
