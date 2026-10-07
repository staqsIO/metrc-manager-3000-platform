'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { ChevronDown, ChevronRight, RotateCcw, Loader2 } from 'lucide-react'

interface HistoryLogEntry {
  id: string
  userId: string
  status: string
  targetCount: number
  createdAt: Date
  executedAt: Date | null
  metadata: unknown
  previewData: unknown
  beforeState: unknown
}

interface Props {
  facilityId: string
}

interface OperationMetadata {
  rule?: { field: string; find: string; replace: string };
  succeededCount?: number;
  failedCount?: number;
  failures?: { productId: string; error: string }[];
  rollbackOf?: string;
  rolledBack?: boolean;
  error?: string;
}

const STATUS_STYLES: Record<string, { className: string; label: string }> = {
  PREVIEWING: { className: 'bg-blue-500/10 text-blue-500 border-blue-500/30', label: 'Preview' },
  COMPLETED: { className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30', label: 'Completed' },
  FAILED: { className: 'bg-red-500/10 text-red-500 border-red-500/30', label: 'Failed' },
  ROLLED_BACK: { className: 'bg-amber-500/10 text-amber-500 border-amber-500/30', label: 'Rolled Back' },
}

export default function OperationHistory({ facilityId }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmRollbackId, setConfirmRollbackId] = useState<string | null>(null)

  const historyQuery = trpc.dutchieBulk.getBulkOperationHistory.useQuery(
    { facilityId, limit: 50 },
    { staleTime: 30_000 },
  )

  const rollbackMutation = trpc.dutchieBulk.rollbackBulkUpdate.useMutation({
    onSuccess: () => {
      setConfirmRollbackId(null)
      historyQuery.refetch()
    },
  })

  const logs = (historyQuery.data ?? []) as HistoryLogEntry[]

  if (historyQuery.isLoading) {
    return (
      <div className="card-modern p-8 text-center text-muted-foreground">
        Loading operation history...
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="card-modern p-8 text-center text-muted-foreground">
        No bulk operations have been performed for this facility yet.
      </div>
    )
  }

  return (
    <div className="card-modern overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead className="min-w-[150px]">Date</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="min-w-[200px]">Rule</TableHead>
            <TableHead className="w-24 text-center">Products</TableHead>
            <TableHead className="w-32 text-center">Result</TableHead>
            <TableHead className="w-28">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map(log => {
            const meta = (log.metadata ?? {}) as OperationMetadata
            const preview = (log.previewData ?? {}) as { rule?: OperationMetadata['rule'] }
            const rule = meta.rule ?? preview.rule
            const statusStyle = STATUS_STYLES[log.status] ?? STATUS_STYLES.COMPLETED!
            const isExpanded = expandedId === log.id
            const hasBeforeState = log.beforeState != null && typeof log.beforeState === 'object' && !Array.isArray(log.beforeState) && Object.keys(log.beforeState).length > 0
            const canRollback = log.status === 'COMPLETED' && hasBeforeState && !meta.rolledBack

            return (
              <TableRow key={log.id} className="group">
                <TableCell className="px-2">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    className="p-1 rounded hover:bg-accent transition-colors"
                  >
                    {isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </button>
                </TableCell>
                <TableCell>
                  <div>
                    <p className="text-sm">
                      {new Date(log.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleTimeString('en-US', {
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('text-[10px]', statusStyle.className)}>
                    {statusStyle.label}
                  </Badge>
                  {meta.rolledBack && (
                    <Badge variant="outline" className="text-[10px] ml-1 bg-amber-500/10 text-amber-500 border-amber-500/30">
                      Reverted
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {rule ? (
                    <div className="text-sm">
                      <span className="text-muted-foreground">{rule.field}:</span>{' '}
                      <span className="font-mono text-xs bg-red-500/10 text-red-400 px-1 rounded">{rule.find}</span>
                      {' → '}
                      <span className="font-mono text-xs bg-emerald-500/10 text-emerald-400 px-1 rounded">{rule.replace || '(empty)'}</span>
                    </div>
                  ) : meta.rollbackOf ? (
                    <span className="text-sm text-muted-foreground">Rollback operation</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <span className="text-sm font-medium">{log.targetCount}</span>
                </TableCell>
                <TableCell className="text-center">
                  {meta.succeededCount != null ? (
                    <div className="flex items-center justify-center gap-2 text-xs">
                      <span className="text-emerald-500">{meta.succeededCount} ok</span>
                      {(meta.failedCount ?? 0) > 0 && (
                        <span className="text-red-500">{meta.failedCount} failed</span>
                      )}
                    </div>
                  ) : meta.error ? (
                    <span className="text-xs text-red-500">Error</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {canRollback && (
                    <>
                      {confirmRollbackId === log.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => rollbackMutation.mutate({ facilityId, actionLogId: log.id })}
                            disabled={rollbackMutation.isPending}
                            className="px-2 py-1 text-xs rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
                          >
                            {rollbackMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              'Confirm'
                            )}
                          </button>
                          <button
                            onClick={() => setConfirmRollbackId(null)}
                            className="px-2 py-1 text-xs rounded border border-border hover:bg-accent transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmRollbackId(log.id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Rollback
                        </button>
                      )}
                    </>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {/* Expanded detail — rendered outside the table for better layout */}
      {expandedId && (() => {
        const log = logs.find(l => l.id === expandedId)
        if (!log) return null
        const meta = (log.metadata ?? {}) as OperationMetadata
        return (
          <div className="border-t p-4 bg-accent/30">
            <div className="space-y-3">
              {meta.rule && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Rule Details</p>
                  <div className="text-sm space-y-0.5">
                    <p><span className="text-muted-foreground">Field:</span> {meta.rule.field}</p>
                    <p><span className="text-muted-foreground">Find:</span> <code className="text-xs bg-muted px-1 rounded">{meta.rule.find}</code></p>
                    <p><span className="text-muted-foreground">Replace:</span> <code className="text-xs bg-muted px-1 rounded">{meta.rule.replace || '(empty)'}</code></p>
                  </div>
                </div>
              )}
              {meta.rollbackOf && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Rollback Reference</p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Original operation:</span>{' '}
                    <code className="text-xs bg-muted px-1 rounded">{meta.rollbackOf}</code>
                  </p>
                </div>
              )}
              {meta.failures && meta.failures.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-red-500 mb-1">Failures ({meta.failures.length})</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {meta.failures.map((f, i) => (
                      <p key={i} className="text-xs text-muted-foreground">
                        Product {f.productId}: {f.error}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {meta.error && (
                <div>
                  <p className="text-xs font-medium text-red-500 mb-1">Error</p>
                  <p className="text-sm text-red-400">{meta.error}</p>
                </div>
              )}
              {rollbackMutation.error && confirmRollbackId === expandedId && (
                <div className="p-2 rounded bg-red-500/10 text-red-500 text-xs">
                  Rollback failed: {rollbackMutation.error.message}
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
