'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  Check,
  Undo2,
  Loader2,
  Package,
  DollarSign,
  TrendingDown,
  Clock,
  AlertTriangle,
} from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

interface PlanItem {
  packageLabel: string
  productId: number
  productName: string
  oldPrice: number
  newPrice: number
  discountPct: number
  score: number
  ageDays: number
  category: string
  priority: string
}

function statusColor(status: string): string {
  switch (status) {
    case 'COMPLETED': return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
    case 'PREVIEWING': return 'bg-amber-500/15 text-amber-500 border-amber-500/30'
    case 'FAILED': return 'bg-red-500/15 text-red-500 border-red-500/30'
    case 'SKIPPED': return 'bg-muted text-muted-foreground'
    default: return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
  }
}

function priorityColor(priority: string): string {
  switch (priority) {
    case 'urgent': return 'bg-red-500/15 text-red-500 border-red-500/30'
    case 'high': return 'bg-orange-500/15 text-orange-400 border-orange-500/30'
    case 'medium': return 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30'
    default: return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
  }
}

export default function RunDetailPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const runId = params?.runId as string

  const { data: run, isLoading, refetch } = trpc.autoDiscount.getRun.useQuery(
    { facilityId, runId },
    { enabled: !!facilityId && !!runId, staleTime: 30_000 }
  )

  const executeMutation = trpc.autoDiscount.execute.useMutation({
    onSuccess: () => { void refetch() },
  })
  const revertMutation = trpc.autoDiscount.revert.useMutation({
    onSuccess: () => { void refetch() },
  })

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!run) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Run not found.</p>
      </div>
    )
  }

  const planItems = (run.planData ?? []) as PlanItem[]
  const isReverted = run.reverted

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/facilities/${facilityId}/inventory/discounts/runs`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Run History
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Run Detail</h1>
          <Badge className={cn('text-xs', statusColor(run.status))}>
            {isReverted ? 'REVERTED' : run.status}
          </Badge>
          <Badge variant="outline" className="text-xs capitalize">{run.trigger}</Badge>
        </div>
        <p className="text-muted-foreground mt-1 text-sm font-mono">
          {run.id}
        </p>
      </div>

      {/* Error banner */}
      {run.errorMessage && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-500">Error</p>
            <p className="text-sm text-red-400 mt-0.5">{run.errorMessage}</p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Overrides</span>
          </div>
          <p className="text-2xl font-bold">{run.overrideCount}</p>
          <p className="text-xs text-muted-foreground">
            of {run.recommendationCount} recommendations
          </p>
        </div>
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Check className="h-4 w-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground">Succeeded</span>
          </div>
          <p className="text-2xl font-bold text-emerald-500">{run.succeededCount}</p>
        </div>
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <span className="text-xs text-muted-foreground">Failed</span>
          </div>
          <p className="text-2xl font-bold text-red-500">{run.failedCount}</p>
        </div>
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Revenue Impact</span>
          </div>
          <p className="text-2xl font-bold">
            {run.estimatedRevenueImpact != null
              ? `$${Math.abs(run.estimatedRevenueImpact).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
              : '-'}
          </p>
        </div>
      </div>

      {/* Timestamps */}
      <div className="card-modern p-4 mb-6 flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Started:</span>
          <span>{new Date(run.startedAt).toLocaleString()}</span>
        </div>
        {run.completedAt && (
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Completed:</span>
            <span>{new Date(run.completedAt).toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {(run.status === 'PREVIEWING' || (run.status === 'COMPLETED' && !isReverted)) && (
        <div className="flex items-center gap-3 mb-6">
          {run.status === 'PREVIEWING' && (
            <button
              onClick={() => executeMutation.mutate({ facilityId, runId })}
              disabled={executeMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {executeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Approve &amp; Execute
            </button>
          )}
          {run.status === 'COMPLETED' && !isReverted && (
            <button
              onClick={() => revertMutation.mutate({ facilityId, runId })}
              disabled={revertMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              {revertMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Undo2 className="h-4 w-4" />
              )}
              Revert to Original Prices
            </button>
          )}
          {(executeMutation.isError || revertMutation.isError) && (
            <span className="text-sm text-red-500">
              {executeMutation.error?.message ?? revertMutation.error?.message}
            </span>
          )}
        </div>
      )}

      {/* Plan Table */}
      <div className="card-modern">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-muted-foreground" />
            Discount Plan ({planItems.length} items)
          </h2>
        </div>
        {planItems.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">
            No plan data available.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Package</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Old Price</TableHead>
                <TableHead className="text-right">New Price</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead>Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {planItems.map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-mono text-sm">{item.packageLabel}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate" title={item.productName}>
                    {item.productName || `Product #${item.productId}`}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.category}</TableCell>
                  <TableCell className="text-right text-sm">${item.oldPrice.toFixed(2)}</TableCell>
                  <TableCell className="text-right text-sm font-semibold text-emerald-500">
                    ${item.newPrice.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className="text-xs font-mono">
                      -{item.discountPct}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">{item.score}</TableCell>
                  <TableCell className="text-right text-sm">{item.ageDays}d</TableCell>
                  <TableCell>
                    <Badge className={cn('text-xs capitalize', priorityColor(item.priority))}>
                      {item.priority}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
