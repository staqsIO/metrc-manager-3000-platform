'use client'

import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/shared/components/ui/table'
import { Truck, Package, AlertTriangle, ArrowDownUp, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CategoryStockItem {
  category: string
  packageCount: number
  totalQuantity: number
  unitOfMeasure: string
  averageAge: number
  expiringWithin30Days: number
  onHoldCount: number
  availableQuantity: number
  riskLevel: string
}

interface FulfillmentRiskItem {
  riskLevel: string
  title: string
  description: string
  category: string
  affectedPackages: number
  metric: number
}

interface TransferVelocityItem {
  period: string
  outgoingCount: number
  outgoingPackages: number
  incomingCount: number
  incomingPackages: number
  netFlow: number
}

interface AssessmentData {
  overallRisk: string
  categoryStock: CategoryStockItem[]
  risks: FulfillmentRiskItem[]
  transferVelocity: TransferVelocityItem[]
  summary: {
    totalAvailablePackages: number
    totalOnHold: number
    totalExpiringSoon: number
    categoriesAtRisk: number
    lowStockCategories: string[]
  }
}

export default function FulfillmentPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const { data: raw, isLoading } = trpc.fulfillment.riskAssessment.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )

  const data = raw as unknown as AssessmentData | undefined

  const riskBadge = (level: string) => (
    <Badge
      variant="outline"
      className={cn(
        'text-xs',
        level === 'critical' && 'bg-red-500/10 text-red-500 border-red-500/20',
        level === 'high' && 'bg-orange-500/10 text-orange-500 border-orange-500/20',
        level === 'medium' && 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
        level === 'low' && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
      )}
    >
      {level}
    </Badge>
  )

  const summaryCards = [
    { label: 'Available Packages', value: data?.summary.totalAvailablePackages ?? 0, icon: Package, color: 'text-blue-500' },
    { label: 'On Hold', value: data?.summary.totalOnHold ?? 0, icon: AlertTriangle, color: (data?.summary.totalOnHold ?? 0) > 0 ? 'text-red-500' : 'text-emerald-500' },
    { label: 'Expiring Soon', value: data?.summary.totalExpiringSoon ?? 0, icon: AlertTriangle, color: (data?.summary.totalExpiringSoon ?? 0) > 0 ? 'text-orange-500' : 'text-emerald-500' },
    { label: 'Categories at Risk', value: data?.summary.categoriesAtRisk ?? 0, icon: ShieldCheck, color: (data?.summary.categoriesAtRisk ?? 0) > 0 ? 'text-yellow-500' : 'text-emerald-500' },
  ]

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Fulfillment Risk</h1>
          {!isLoading && data && riskBadge(data.overallRisk)}
        </div>
        <p className="text-muted-foreground mt-1">Inventory availability and fulfillment risk assessment</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {summaryCards.map(c => (
          <div key={c.label} className="card-modern p-4">
            <div className="flex items-center gap-2 mb-2">
              <c.icon className={cn('h-4 w-4', c.color)} />
              <span className="text-xs text-muted-foreground">{c.label}</span>
            </div>
            {isLoading ? <Skeleton className="h-7 w-16" /> : <div className="text-xl font-bold">{c.value}</div>}
          </div>
        ))}
      </div>

      {/* Risk Alerts */}
      {!isLoading && data && data.risks.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Active Risks ({data.risks.length})
          </h2>
          <div className="grid gap-3">
            {data.risks.map((r, i) => (
              <div
                key={i}
                className={cn(
                  'card-modern p-4 border-l-4',
                  r.riskLevel === 'critical' && 'border-l-red-500',
                  r.riskLevel === 'high' && 'border-l-orange-500',
                  r.riskLevel === 'medium' && 'border-l-yellow-500',
                  r.riskLevel === 'low' && 'border-l-emerald-500',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  {riskBadge(r.riskLevel)}
                  <span className="font-medium">{r.title}</span>
                </div>
                <p className="text-sm text-muted-foreground">{r.description}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {r.affectedPackages} package(s) · {r.category}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transfer Velocity */}
      {!isLoading && data && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <ArrowDownUp className="h-5 w-5 text-cyan-500" />
            Transfer Velocity
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data.transferVelocity.map(v => (
              <div key={v.period} className="card-modern p-4">
                <div className="text-sm font-medium mb-3">{v.period}</div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Incoming</span>
                    <span className="text-emerald-500 font-medium">+{v.incomingPackages} pkgs</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Outgoing</span>
                    <span className="text-red-500 font-medium">-{v.outgoingPackages} pkgs</span>
                  </div>
                  <div className="border-t border-border pt-2 flex justify-between text-sm">
                    <span className="text-muted-foreground">Net Flow</span>
                    <span className={cn('font-bold', v.netFlow >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                      {v.netFlow >= 0 ? '+' : ''}{v.netFlow}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category Stock Table */}
      <div className="card-modern">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Stock by Category
          </h2>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Packages</TableHead>
                <TableHead className="text-right">Available Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Avg Age</TableHead>
                <TableHead className="text-right">On Hold</TableHead>
                <TableHead className="text-right">Expiring</TableHead>
                <TableHead>Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.categoryStock ?? []).map(c => (
                <TableRow key={c.category}>
                  <TableCell className="font-medium">{c.category}</TableCell>
                  <TableCell className="text-right">{c.packageCount}</TableCell>
                  <TableCell className="text-right">{c.availableQuantity.toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground">{c.unitOfMeasure}</TableCell>
                  <TableCell className="text-right">{c.averageAge}d</TableCell>
                  <TableCell className="text-right">
                    {c.onHoldCount > 0 ? (
                      <span className="text-red-500 font-medium">{c.onHoldCount}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.expiringWithin30Days > 0 ? (
                      <span className="text-orange-500 font-medium">{c.expiringWithin30Days}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell>{riskBadge(c.riskLevel)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Low Stock Categories */}
      {!isLoading && data && data.summary.lowStockCategories.length > 0 && (
        <div className="mt-4 card-modern p-4 border-l-4 border-l-red-500">
          <div className="font-medium text-sm mb-2">Low Stock Categories</div>
          <div className="flex flex-wrap gap-2">
            {data.summary.lowStockCategories.map(c => (
              <Badge key={c} variant="outline" className="text-xs bg-red-500/10 text-red-500 border-red-500/20">
                {c}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
