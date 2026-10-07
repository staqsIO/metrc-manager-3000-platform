'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs'
import { type AgeCategory, AGE_BADGE_STYLES } from '@/features/inventory/constants'
import {
  ArrowLeft,
  Package,
  Scale,
  MapPin,
  Box,
  Clock,
  XCircle,
  RefreshCw,
  DollarSign,
  TrendingUp,
  ShoppingCart,
  Timer,
  AlertCircle,
} from 'lucide-react'
import { JourneyTimeline } from '@/shared/components/JourneyTimeline'

function formatActionType(actionType: string): string {
  const map: Record<string, string> = {
    PACKAGE_ADJUST: 'Package Adjustment',
    PACKAGE_FINISH: 'Package Finished',
    AGING_DISCOUNT: 'Discount Applied',
    AGING_SAMPLE_OUT: 'Sample Out',
    AGING_DESTROY: 'Package Destroyed',
    AGING_REMEDIATE: 'Remediation',
    AGING_EXPEDITE_TESTING: 'Expedite Testing',
    AGING_FIFO_PRIORITY: 'FIFO Priority',
    AGING_BULK: 'Bulk Aging Action',
    PROCESSING_CREATE: 'Processing Job',
    HARVEST_FINISH: 'Harvest Finished',
    HARVEST_WASTE: 'Waste Recorded',
    PLANTBATCH_DESTROY: 'Plants Destroyed',
    AUDIT_EXPEDITE_TESTING: 'Audit: Expedite Testing',
    AUDIT_REMEDIATE: 'Audit: Remediation',
    AUDIT_FINISH: 'Audit: Finish Packages',
  }
  return map[actionType] ?? actionType.replace(/_/g, ' ')
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatDateTime(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '-'
  const d = dateStr instanceof Date ? dateStr : new Date(dateStr)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const statusColors: Record<string, string> = {
  PREVIEWING: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  COMPLETED: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  VERIFIED: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  UNVERIFIED: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  FAILED: 'bg-red-500/10 text-red-500 border-red-500/20',
  PARTIALLY_COMPLETED: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  ROLLED_BACK: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
}

function VerifyRecentActionsButton({ facilityId }: { facilityId: string }) {
  const utils = trpc.useUtils()
  const verifyMutation = trpc.inventory.verifyRecentActions.useMutation({
    onSuccess: () => {
      utils.inventory.getPackageHistory.invalidate()
      utils.inventory.getActionHistory.invalidate()
    },
  })

  return (
    <div className="mb-4">
      <button
        onClick={() => verifyMutation.mutate({ facilityId })}
        disabled={verifyMutation.isPending}
        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', verifyMutation.isPending && 'animate-spin')} />
        {verifyMutation.isPending ? 'Verifying...' : 'Verify Recent Actions'}
      </button>
      {verifyMutation.data && (
        <span className="ml-3 text-sm text-muted-foreground">
          {verifyMutation.data.verified}/{verifyMutation.data.total} verified
          {verifyMutation.data.unverified > 0 && `, ${verifyMutation.data.unverified} unverified`}
          {verifyMutation.data.failed > 0 && `, ${verifyMutation.data.failed} failed`}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sales Tab — consumes packageJourney data (no extra API call)
// ---------------------------------------------------------------------------

// Local type mirrors to avoid tRPC deep-instantiation errors.
// SYNC: keep in sync with sales-reconciliation.ts SalesMatch / SalesAnalytics
interface SalesMatchLocal {
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

interface SalesAnalyticsLocal {
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

function SalesTab({
  facilityId,
  packageLabel,
}: {
  facilityId: string
  packageLabel: string
}) {
  // Re-use the same packageJourney query that JourneyTimeline fetches.
  // React Query deduplicates — no extra API call.
  const { data, isLoading, error } = trpc.packages.packageJourney.useQuery(
    { facilityId, packageLabel },
    { enabled: !!facilityId && !!packageLabel, staleTime: 300_000 },
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card-modern p-4">
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card-modern p-8 text-center">
        <DollarSign className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">Failed to load sales data</h3>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
      </div>
    )
  }

  if (!data) return null

  const allSales = data.sales as SalesMatchLocal[]
  const analytics = data.salesAnalytics as SalesAnalyticsLocal | null
  const salesError = data.salesError as string | null
  const descendantEntries: [string, SalesMatchLocal[]][] = data.descendantSales
    ? (Object.entries(data.descendantSales) as [string, SalesMatchLocal[]][]).filter(([, s]) => s.length > 0)
    : []
  const totalSalesCount = allSales.length + descendantEntries.reduce((sum, [, s]) => sum + s.length, 0)

  // Sales data unavailable
  if (salesError) {
    return (
      <div className="card-modern p-8 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-yellow-500" />
        <h3 className="mt-4 text-lg font-semibold">Sales data unavailable</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          POS integration may not be configured for this facility.
        </p>
      </div>
    )
  }

  if (totalSalesCount === 0) {
    return (
      <div className="card-modern p-8 text-center">
        <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No sales recorded</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No Dutchie POS sales have been matched to this package or its descendants.
        </p>
      </div>
    )
  }

  // Revenue from target vs downstream
  const targetRevenue = allSales.reduce((sum, s) => sum + s.totalPrice, 0)
  const downstreamRevenue = (analytics?.totalRevenue ?? 0) - targetRevenue

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Total Revenue</span>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(analytics.totalRevenue)}</p>
          </div>
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Transactions</span>
            </div>
            <p className="text-2xl font-bold">{analytics.totalTransactions}</p>
            <p className="text-xs text-muted-foreground">{analytics.totalUnitsSold} units sold</p>
          </div>
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Avg Price/Unit</span>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(analytics.avgPrice)}</p>
            {analytics.totalDiscount > 0 && (
              <p className="text-xs text-yellow-500">-{formatCurrency(analytics.totalDiscount)} discounts</p>
            )}
          </div>
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Time in System</span>
            </div>
            {analytics.timeInSystem.avgDays != null ? (
              <>
                <p className="text-2xl font-bold">{analytics.timeInSystem.avgDays}d</p>
                {analytics.timeInSystem.minDays !== analytics.timeInSystem.maxDays && (
                  <p className="text-xs text-muted-foreground">
                    {analytics.timeInSystem.minDays}d – {analytics.timeInSystem.maxDays}d range
                  </p>
                )}
              </>
            ) : (
              <p className="text-lg text-muted-foreground">-</p>
            )}
          </div>
        </div>
      )}

      {/* Revenue Attribution */}
      {descendantEntries.length > 0 && analytics && (
        <div className="card-modern p-6">
          <h3 className="text-sm font-semibold mb-4">Revenue Attribution</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-purple-500" />
                <span>This Package</span>
                <span className="text-muted-foreground">({allSales.length} txns)</span>
              </div>
              <span className="font-semibold">{formatCurrency(targetRevenue)}</span>
            </div>
            {analytics.revenueByDescendant
              .filter((r) => r.packageLabel !== packageLabel)
              .map((r) => (
                <div key={r.packageLabel} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-purple-500/40" />
                    <span className="font-mono text-xs truncate max-w-[200px]">{r.packageLabel}</span>
                    <span className="text-muted-foreground">({r.transactions} txns)</span>
                  </div>
                  <span className="font-semibold">{formatCurrency(r.revenue)}</span>
                </div>
              ))}
            {downstreamRevenue > 0 && (
              <div className="border-t pt-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Downstream Total</span>
                <span className="font-semibold">{formatCurrency(downstreamRevenue)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sales Table — Target Package */}
      {allSales.length > 0 && (
        <div className="card-modern p-6">
          <h3 className="text-sm font-semibold mb-4">
            This Package — {allSales.length} Sale{allSales.length !== 1 ? 's' : ''}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Transaction</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Product</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Qty</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Total</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Customer</th>
                  <th className="pb-2 text-xs font-medium text-muted-foreground">Payment</th>
                </tr>
              </thead>
              <tbody>
                {allSales.map((sale, idx) => (
                  <tr key={`${sale.transactionId}-${idx}`} className="border-b border-border/50">
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDate(sale.saleDate)}</td>
                    <td className="py-2 pr-4 font-mono text-xs truncate max-w-[120px]">{sale.transactionId}</td>
                    <td className="py-2 pr-4 truncate max-w-[160px]">{sale.productName}</td>
                    <td className="py-2 pr-4">{sale.quantity}</td>
                    <td className="py-2 pr-4 font-semibold">
                      {formatCurrency(sale.totalPrice)}
                      {sale.discountAmount > 0 && (
                        <span className="text-yellow-500 text-xs ml-1">(-{formatCurrency(sale.discountAmount)})</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 truncate max-w-[120px]">
                      {sale.customerName ?? '-'}
                      {sale.customerType && (
                        <Badge variant="outline" className="text-[9px] ml-1">{sale.customerType}</Badge>
                      )}
                    </td>
                    <td className="py-2">{sale.paymentMethod ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sales Table — Descendant Packages */}
      {descendantEntries.map(([label, dSales]) => (
        <div key={label} className="card-modern p-6">
          <h3 className="text-sm font-semibold mb-1">Downstream Package</h3>
          <p className="font-mono text-xs text-muted-foreground mb-4">{label}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Transaction</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Product</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Qty</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Total</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Customer</th>
                  <th className="pb-2 text-xs font-medium text-muted-foreground">Payment</th>
                </tr>
              </thead>
              <tbody>
                {(dSales as SalesMatchLocal[]).map((sale, idx) => (
                  <tr key={`${label}-${sale.transactionId}-${idx}`} className="border-b border-border/50">
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDate(sale.saleDate)}</td>
                    <td className="py-2 pr-4 font-mono text-xs truncate max-w-[120px]">{sale.transactionId}</td>
                    <td className="py-2 pr-4 truncate max-w-[160px]">{sale.productName}</td>
                    <td className="py-2 pr-4">{sale.quantity}</td>
                    <td className="py-2 pr-4 font-semibold">
                      {formatCurrency(sale.totalPrice)}
                      {sale.discountAmount > 0 && (
                        <span className="text-yellow-500 text-xs ml-1">(-{formatCurrency(sale.discountAmount)})</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 truncate max-w-[120px]">
                      {sale.customerName ?? '-'}
                      {sale.customerType && (
                        <Badge variant="outline" className="text-[9px] ml-1">{sale.customerType}</Badge>
                      )}
                    </td>
                    <td className="py-2">{sale.paymentMethod ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function PackageDetailPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const packageIdParam = params?.packageId as string
  const packageId = Number(packageIdParam)

  const isValidId = !isNaN(packageId) && packageId > 0

  const { data: pkg, isLoading, error } = trpc.inventory.getPackage.useQuery(
    { facilityId, packageId },
    { enabled: !!facilityId && isValidId, staleTime: 300_000 },
  )

  const { data: history = [] } = trpc.inventory.getPackageHistory.useQuery(
    { facilityId, packageLabel: pkg?.Label ?? '' },
    { enabled: !!facilityId && !!pkg?.Label, staleTime: 300_000 },
  )

  const backHref = `/facilities/${facilityId}/inventory`

  // Invalid ID
  if (!isValidId) {
    return (
      <div className="p-8">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to Inventory
        </Link>
        <div className="card-modern p-8 text-center">
          <XCircle className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">Invalid package ID</h2>
          <p className="mt-1 text-sm text-muted-foreground">The package ID &ldquo;{packageIdParam.slice(0, 50)}&rdquo; is not valid.</p>
        </div>
      </div>
    )
  }

  // Loading
  if (isLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-4 w-32 mb-6" />
        <div className="space-y-2 mb-6">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-5 w-64" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card-modern p-4">
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-10 w-72 mb-4" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  // Not found
  if (error || !pkg) {
    return (
      <div className="p-8">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to Inventory
        </Link>
        <div className="card-modern p-8 text-center">
          <Package className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">Package not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">Package #{packageId} could not be found in this facility.</p>
        </div>
      </div>
    )
  }

  const ageCategory = (pkg.ageCategory ?? 'normal') as AgeCategory

  return (
    <div className="p-8">
      {/* Back link */}
      <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" />
        Back to Inventory
      </Link>

      {/* Package Header */}
      <div className="mb-6">
        <p className="font-mono text-sm text-muted-foreground">{pkg.Label}</p>
        <h1 className="text-2xl font-bold mt-1">{pkg.ItemName}</h1>
        <div className="flex flex-wrap gap-2 mt-3">
          <Badge variant="outline">{pkg.ItemCategory}</Badge>
          {pkg.ItemStrainName && (
            <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/20">
              {pkg.ItemStrainName}
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">{pkg.LabTestingState}</Badge>
          {pkg.IsOnHold && (
            <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">On Hold</Badge>
          )}
          {pkg.ProductRequiresRemediation && (
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Requires Remediation</Badge>
          )}
          {pkg.ContainsRemediatedProduct && (
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Remediated</Badge>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Scale className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Quantity</span>
          </div>
          <p className="text-2xl font-bold">{pkg.Quantity}</p>
          <p className="text-xs text-muted-foreground">{pkg.UnitOfMeasureName}</p>
        </div>

        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Age</span>
          </div>
          <p className="text-2xl font-bold">{pkg.ageDays}d</p>
          <Badge variant="outline" className={cn('text-xs mt-1', AGE_BADGE_STYLES[ageCategory])}>
            {ageCategory}
          </Badge>
        </div>

        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Location</span>
          </div>
          <p className="text-lg font-semibold truncate">{pkg.LocationName || '-'}</p>
          {pkg.RoomName && <p className="text-xs text-muted-foreground">{pkg.RoomName}</p>}
        </div>

        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Box className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Package Type</span>
          </div>
          <p className="text-lg font-semibold">{pkg.PackageType}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="provenance">Provenance</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-4">
          <div className="card-modern p-6">
            <h3 className="text-sm font-semibold mb-4">Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Packaged Date</span>
                <p className="font-medium">{formatDate(pkg.PackagedDate)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Last Modified</span>
                <p className="font-medium">{formatDate(pkg.LastModified)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Production Batch</span>
                <p className="font-medium">{pkg.ProductionBatchNumber || '-'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Lab Testing State</span>
                <p className="font-medium">{pkg.LabTestingState}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Lab Testing Date</span>
                <p className="font-medium">{formatDate(pkg.LabTestingStateDate)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Initial Lab State</span>
                <p className="font-medium">{pkg.InitialLabTestingState || '-'}</p>
              </div>
              {pkg.FinishedDate && (
                <div>
                  <span className="text-muted-foreground">Finished Date</span>
                  <p className="font-medium">{formatDate(pkg.FinishedDate)}</p>
                </div>
              )}
              {pkg.ArchivedDate && (
                <div>
                  <span className="text-muted-foreground">Archived Date</span>
                  <p className="font-medium">{formatDate(pkg.ArchivedDate)}</p>
                </div>
              )}
              {pkg.RemediationDate && (
                <div>
                  <span className="text-muted-foreground">Remediation Date</span>
                  <p className="font-medium">{formatDate(pkg.RemediationDate)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Flags */}
          {(pkg.IsDonation || pkg.IsTradesSample || pkg.IsTestingSample || pkg.ProductRequiresRemediation || pkg.ContainsRemediatedProduct) && (
            <div className="card-modern p-6">
              <h3 className="text-sm font-semibold mb-4">Flags</h3>
              <div className="flex flex-wrap gap-2">
                {pkg.IsDonation && <Badge variant="outline">Donation</Badge>}
                {pkg.IsTradesSample && <Badge variant="outline">Trade Sample</Badge>}
                {pkg.IsTestingSample && <Badge variant="outline">Testing Sample</Badge>}
                {pkg.ProductRequiresRemediation && (
                  <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                    Requires Remediation
                  </Badge>
                )}
                {pkg.ContainsRemediatedProduct && (
                  <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                    Contains Remediated Product
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {pkg.Note && (
            <div className="card-modern p-6">
              <h3 className="text-sm font-semibold mb-2">Notes</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{pkg.Note}</p>
            </div>
          )}
        </TabsContent>

        {/* Provenance Tab — Full Seed-to-Sale Journey */}
        <TabsContent value="provenance" className="space-y-6 mt-4">
          <JourneyTimeline
            facilityId={facilityId}
            packageLabel={pkg.Label}
          />
        </TabsContent>

        {/* Sales Tab — re-uses packageJourney data via React Query dedup */}
        <TabsContent value="sales" className="space-y-6 mt-4">
          <SalesTab facilityId={facilityId} packageLabel={pkg.Label} />
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" className="mt-4">
          <VerifyRecentActionsButton facilityId={facilityId} />
          {history.length === 0 ? (
            <div className="card-modern p-8 text-center">
              <Clock className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No activity recorded yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Actions performed on this package will appear here.
              </p>
            </div>
          ) : (
            <div className="card-modern p-6">
              <div className="space-y-0">
                {history.map((entry: { id: string; actionType: string; status: string; targetCount: number | null; executedAt: Date | null; createdAt: Date }, idx: number) => (
                  <div key={entry.id} className="flex gap-4">
                    {/* Timeline indicator */}
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        'h-2.5 w-2.5 rounded-full mt-2',
                        entry.status === 'VERIFIED' ? 'bg-emerald-500' :
                        entry.status === 'COMPLETED' ? 'bg-emerald-500' :
                        entry.status === 'UNVERIFIED' ? 'bg-yellow-500' :
                        entry.status === 'FAILED' ? 'bg-red-500' :
                        'bg-blue-500'
                      )} />
                      {idx < history.length - 1 && (
                        <div className="w-px flex-1 bg-border" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="pb-6 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">
                          {formatActionType(entry.actionType)}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn('text-xs', statusColors[entry.status] ?? '')}
                        >
                          {entry.status}
                        </Badge>
                        {entry.targetCount != null && entry.targetCount > 1 && (
                          <span className="text-xs text-muted-foreground">
                            (bulk: {entry.targetCount} packages)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDateTime(entry.executedAt ?? entry.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
