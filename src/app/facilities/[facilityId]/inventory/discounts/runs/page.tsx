'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  History,
  ArrowLeft,
  Check,
  Clock,
  XCircle,
  SkipForward,
  Eye,
  Undo2,
  Loader2,
  ChevronRight,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'

interface RunListItem {
  id: string
  trigger: string
  status: string
  recommendationCount: number
  overrideCount: number
  succeededCount: number
  failedCount: number
  estimatedRevenueImpact: number | null
  errorMessage: string | null
  startedAt: string | Date
  completedAt: string | Date | null
  createdAt: string | Date
  reverted: boolean
}

function statusBadge(status: string, reverted?: boolean) {
  if (reverted) {
    return <Badge className="text-xs bg-purple-500/15 text-purple-400 border-purple-500/30">REVERTED</Badge>
  }
  const styles: Record<string, string> = {
    PENDING: 'bg-muted text-muted-foreground',
    PREVIEWING: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
    APPROVED: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    EXECUTING: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    COMPLETED: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
    FAILED: 'bg-red-500/15 text-red-500 border-red-500/30',
    SKIPPED: 'bg-muted text-muted-foreground',
  }
  return <Badge className={cn('text-xs', styles[status] ?? 'bg-muted text-muted-foreground')}>{status}</Badge>
}

function statusIcon(status: string) {
  switch (status) {
    case 'COMPLETED': return <Check className="h-4 w-4 text-emerald-500" />
    case 'PREVIEWING': return <Eye className="h-4 w-4 text-amber-500" />
    case 'EXECUTING': return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
    case 'FAILED': return <XCircle className="h-4 w-4 text-red-500" />
    case 'SKIPPED': return <SkipForward className="h-4 w-4 text-muted-foreground" />
    default: return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

export default function RunHistoryPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const { data, isLoading, refetch } = trpc.autoDiscount.listRuns.useQuery(
    { facilityId, limit: 50 },
    { enabled: !!facilityId, staleTime: 30_000 }
  )

  const executeMutation = trpc.autoDiscount.execute.useMutation({
    onSuccess: () => {
      setConfirmAction(null)
      void refetch()
    },
  })
  const revertMutation = trpc.autoDiscount.revert.useMutation({
    onSuccess: () => {
      setConfirmAction(null)
      void refetch()
    },
  })

  const [confirmAction, setConfirmAction] = useState<{ type: 'approve' | 'revert'; run: RunListItem } | null>(null)

  const runs = (data?.runs ?? []) as RunListItem[]

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/facilities/${facilityId}/inventory/discounts`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Discount Engine
        </Link>
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-bold">Auto-Discount Run History</h1>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Track all automated discount runs, approve previews, or revert completed runs.
        </p>
      </div>

      {/* Runs Table */}
      <div className="card-modern">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : runs.length === 0 ? (
          <div className="p-12 text-center">
            <History className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold mb-1">No Runs Yet</h3>
            <p className="text-sm text-muted-foreground">
              Preview or enable the cron to start generating discount runs.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Status</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead className="text-right">Overrides</TableHead>
                <TableHead className="text-right">Succeeded</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Revenue Impact</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map(run => (
                <TableRow key={run.id}>
                  <TableCell>{statusIcon(run.status)}</TableCell>
                  <TableCell>{statusBadge(run.status, run.reverted)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">{run.trigger}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">{run.overrideCount}</TableCell>
                  <TableCell className="text-right text-sm">{run.succeededCount}</TableCell>
                  <TableCell className="text-right text-sm">{run.failedCount}</TableCell>
                  <TableCell className="text-right text-sm">
                    {run.estimatedRevenueImpact != null
                      ? `$${Math.abs(run.estimatedRevenueImpact).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(run.createdAt).toLocaleDateString()}{' '}
                    {new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {run.status === 'PREVIEWING' && (
                        <button
                          onClick={() => setConfirmAction({ type: 'approve', run })}
                          className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors"
                        >
                          <Check className="h-3 w-3" />
                          Approve
                        </button>
                      )}
                      {run.status === 'COMPLETED' && !run.reverted && (
                        <button
                          onClick={() => setConfirmAction({ type: 'revert', run })}
                          className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 transition-colors"
                        >
                          <Undo2 className="h-3 w-3" />
                          Revert
                        </button>
                      )}
                      <Link
                        href={`/facilities/${facilityId}/inventory/discounts/runs/${run.id}`}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Details
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Error display */}
      {(executeMutation.isError || revertMutation.isError) && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-500">
          {executeMutation.error?.message ?? revertMutation.error?.message}
        </div>
      )}

      {/* Approve Confirmation Dialog */}
      <Dialog
        open={confirmAction?.type === 'approve'}
        onOpenChange={(open) => { if (!open) setConfirmAction(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Discount Run</DialogTitle>
            <DialogDescription>
              Apply price changes for {confirmAction?.run.overrideCount ?? 0} products to Dutchie?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setConfirmAction(null)}
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (confirmAction?.run) {
                  executeMutation.mutate({ facilityId, runId: confirmAction.run.id })
                }
              }}
              disabled={executeMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {executeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Apply Changes
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revert Confirmation Dialog */}
      <Dialog
        open={confirmAction?.type === 'revert'}
        onOpenChange={(open) => { if (!open) setConfirmAction(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revert Discount Run</DialogTitle>
            <DialogDescription>
              Restore original prices for {confirmAction?.run.overrideCount ?? 0} products. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              autoFocus
              onClick={() => setConfirmAction(null)}
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (confirmAction?.run) {
                  revertMutation.mutate({ facilityId, runId: confirmAction.run.id })
                }
              }}
              disabled={revertMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {revertMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Revert Prices
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
