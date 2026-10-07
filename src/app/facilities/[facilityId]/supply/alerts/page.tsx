'use client'

import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/lib/utils'
import { AlertTriangle, Package, TrendingDown, ShoppingCart } from 'lucide-react'

// ---------------------------------------------------------------------------
// Local type mirror (avoid deep type instantiation issues)
// ---------------------------------------------------------------------------

interface LocalLowStockAlert {
  itemId: string
  itemName: string
  currentStock: number
  reorderPoint: number
  unit: string
  shortfall: number
  vendor: string | null
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

function getSeverity(alert: LocalLowStockAlert): 'critical' | 'warning' {
  // Critical if stock is below 50% of reorder point
  return alert.currentStock < alert.reorderPoint * 0.5 ? 'critical' : 'warning'
}

function severityColor(severity: 'critical' | 'warning'): string {
  return severity === 'critical'
    ? 'border-red-500/30 bg-red-500/5'
    : 'border-yellow-500/30 bg-yellow-500/5'
}

function severityBadgeClass(severity: 'critical' | 'warning'): string {
  return severity === 'critical'
    ? 'bg-red-500/10 text-red-500 border-red-500/20'
    : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
}

function stockPercentage(alert: LocalLowStockAlert): number {
  if (alert.reorderPoint === 0) return 100
  return Math.round((alert.currentStock / alert.reorderPoint) * 100)
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function LowStockAlertsPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const { data: rawAlerts, isLoading } = trpc.supply.lowStockAlerts.useQuery(
    { facilityId },
    { enabled: !!facilityId },
  )
  const alerts: LocalLowStockAlert[] = (rawAlerts ?? []) as LocalLowStockAlert[]

  const criticalCount = alerts.filter((a) => getSeverity(a) === 'critical').length
  const warningCount = alerts.filter((a) => getSeverity(a) === 'warning').length

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-yellow-500" />
            Low Stock Alerts
          </h1>
          <p className="text-muted-foreground mt-1">
            Items below reorder point
          </p>
        </div>
      </div>

      {/* Summary Row */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card-modern p-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Alerts</span>
            </div>
            <p className={cn(
              'text-2xl font-bold',
              alerts.length > 0 ? 'text-yellow-500' : '',
            )}>
              {alerts.length}
            </p>
          </div>
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-red-500" />
              <span className="text-xs text-muted-foreground">Critical (below 50%)</span>
            </div>
            <p className={cn(
              'text-2xl font-bold',
              criticalCount > 0 ? 'text-red-500' : '',
            )}>
              {criticalCount}
            </p>
          </div>
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-yellow-500" />
              <span className="text-xs text-muted-foreground">Warning</span>
            </div>
            <p className={cn(
              'text-2xl font-bold',
              warningCount > 0 ? 'text-yellow-400' : '',
            )}>
              {warningCount}
            </p>
          </div>
        </div>
      )}

      {/* Alert Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card-modern p-6">
              <Skeleton className="h-5 w-40 mb-3" />
              <Skeleton className="h-4 w-32 mb-2" />
              <Skeleton className="h-4 w-24 mb-4" />
              <Skeleton className="h-3 w-full mb-2" />
              <Skeleton className="h-8 w-32" />
            </div>
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="card-modern p-12 text-center">
          <Package className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
          <h3 className="font-semibold mb-1">All Stock Levels Healthy</h3>
          <p className="text-muted-foreground text-sm">
            No items are currently below their reorder point.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {alerts.map((alert) => {
            const severity = getSeverity(alert)
            const pct = stockPercentage(alert)

            return (
              <div
                key={alert.itemId}
                className={cn(
                  'card-modern p-6 border',
                  severityColor(severity),
                )}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-sm leading-tight pr-2">
                    {alert.itemName}
                  </h3>
                  <Badge
                    variant="outline"
                    className={cn('text-xs flex-shrink-0', severityBadgeClass(severity))}
                  >
                    {severity === 'critical' ? 'Critical' : 'Warning'}
                  </Badge>
                </div>

                {/* Stock level bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Current: {alert.currentStock} {alert.unit}</span>
                    <span>Reorder: {alert.reorderPoint} {alert.unit}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        severity === 'critical' ? 'bg-red-500' : 'bg-yellow-500',
                      )}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {pct}% of reorder point
                  </div>
                </div>

                {/* Shortfall */}
                <div className="flex items-center gap-2 mb-3">
                  <TrendingDown className={cn(
                    'h-4 w-4',
                    severity === 'critical' ? 'text-red-500' : 'text-yellow-500',
                  )} />
                  <span className="text-sm">
                    <span className="font-semibold">{alert.shortfall} {alert.unit}</span>
                    {' '}below reorder point
                  </span>
                </div>

                {/* Vendor */}
                {alert.vendor && (
                  <div className="text-xs text-muted-foreground mb-3">
                    Vendor: {alert.vendor}
                  </div>
                )}

                {/* Reorder suggestion */}
                <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-xs">
                  <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span>
                    Suggested reorder: <span className="font-semibold">{alert.shortfall} {alert.unit}</span> (to reach reorder point)
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
