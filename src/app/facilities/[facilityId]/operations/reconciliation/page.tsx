'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Button } from '@/shared/components/ui/button'
import {
  GitCompare, Upload, ListPlus, FileSpreadsheet,
  CheckCircle2, AlertTriangle, Clock, ChevronDown, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useReconciliation } from '@/features/reconciliation/hooks/useReconciliation'
import ReconciliationFileUpload from '@/features/reconciliation/components/ReconciliationFileUpload'
import BulkEditGrid from '@/features/reconciliation/components/BulkEditGrid'
import ReconciliationPreviewDialog from '@/features/reconciliation/components/ReconciliationPreviewDialog'

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReconciliationPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const facilityId = params?.facilityId as string

  const [showHistory, setShowHistory] = useState(false)

  const reconciliation = useReconciliation(facilityId)

  // Pre-populate from inventory page "Bulk Edit" button (via sessionStorage)
  const source = searchParams?.get('source')
  const hasLoadedRef = useRef(false)
  useEffect(() => {
    if (hasLoadedRef.current || reconciliation.phase !== 'idle') return
    if (source === 'inventory') {
      const stored = sessionStorage.getItem('reconciliation_labels')
      if (stored) {
        hasLoadedRef.current = true
        sessionStorage.removeItem('reconciliation_labels')
        const labels = JSON.parse(stored) as string[]
        if (labels.length > 0) {
          reconciliation.loadFromLabels(labels)
        }
      }
    }
  }, [source, reconciliation])

  // Metrc summary
  const { data: rawPreview, isLoading: previewLoading } = trpc.operations.reconcilePreview.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )
  const metrcCount = (rawPreview as unknown as { totalMetrcPackages: number } | undefined)?.totalMetrcPackages ?? 0

  // History
  const { data: rawHistory, isLoading: historyLoading } = trpc.reconciliation.listHistory.useQuery(
    { facilityId, pageSize: 10 },
    { enabled: !!facilityId && showHistory, staleTime: 300_000 },
  )
  const history = rawHistory as unknown as {
    items: {
      id: string; status: string; sourceA: string; sourceB: string;
      totalRecords: number | null; mismatchCount: number | null;
      resolvedCount: number | null; createdAt: string;
    }[];
    total: number;
  } | undefined

  // Summary for editing phase
  const editingSummary = useMemo(() => {
    if (reconciliation.phase !== 'editing' || reconciliation.rows.length === 0) return null
    const rows = reconciliation.rows
    const matches = rows.filter(r => r.status === 'match').length
    const mismatches = rows.filter(r => r.status === 'mismatch').length
    const missingInMetrc = rows.filter(r => r.status === 'missing_in_metrc').length
    const missingInExternal = rows.filter(r => r.status === 'missing_in_external').length
    const matchRate = rows.length > 0 ? Math.round((matches / rows.length) * 100) : 0
    return { total: rows.length, matches, mismatches, missingInMetrc, missingInExternal, matchRate }
  }, [reconciliation.phase, reconciliation.rows])

  const isIdle = reconciliation.phase === 'idle'
  const isEditing = reconciliation.phase === 'editing'
  const showGrid = isEditing || reconciliation.phase === 'previewing' || reconciliation.phase === 'executing'

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Bulk Reconciliation</h1>
        <p className="text-muted-foreground mt-1">
          Upload external inventory data, compare against Metrc, and batch-push adjustments.
        </p>
      </div>

      {/* Metrc summary */}
      <div className="card-modern p-4 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <GitCompare className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium">Metrc Inventory</span>
        </div>
        {previewLoading ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <p className="text-sm text-muted-foreground">
            {metrcCount.toLocaleString()} active packages available for reconciliation
          </p>
        )}
      </div>

      {/* Entry Points — shown when idle */}
      {isIdle && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Upload File */}
          <div className="card-modern p-5">
            <div className="flex items-center gap-2 mb-3">
              <Upload className="h-5 w-5 text-blue-500" />
              <h2 className="font-semibold">Upload File</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Drop a CSV or Excel file with package labels and quantities to compare against Metrc.
            </p>
            <ReconciliationFileUpload
              onUpload={reconciliation.uploadFile}
              isLoading={reconciliation.isLoading}
            />
          </div>

          {/* From Inventory */}
          <div className="card-modern p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <FileSpreadsheet className="h-5 w-5 text-emerald-500" />
              <h2 className="font-semibold">From Inventory</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4 flex-1">
              Select packages from your active inventory page, then click &quot;Bulk Edit&quot; to pre-populate the grid.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Navigate to inventory page with bulkEdit mode hint
                window.location.href = `/facilities/${facilityId}/inventory?bulkEdit=true`
              }}
            >
              Go to Active Packages
            </Button>
          </div>

          {/* Manual Entry */}
          <div className="card-modern p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <ListPlus className="h-5 w-5 text-purple-500" />
              <h2 className="font-semibold">Manual Entry</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4 flex-1">
              Start with an empty grid and type or paste package labels to look up.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={reconciliation.startManual}
            >
              Start Empty Grid
            </Button>
          </div>
        </div>
      )}

      {/* Parse errors */}
      {reconciliation.parseErrors.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm">
          <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400 font-medium mb-1">
            <AlertTriangle className="h-4 w-4" />
            {reconciliation.parseErrors.length} parsing warning{reconciliation.parseErrors.length > 1 ? 's' : ''}
          </div>
          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
            {reconciliation.parseErrors.slice(0, 5).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {reconciliation.parseErrors.length > 5 && (
              <li>...and {reconciliation.parseErrors.length - 5} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Summary Cards — shown while editing */}
      {editingSummary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <div className="card-modern p-3">
            <div className="text-xs text-muted-foreground mb-0.5">Compared</div>
            <div className="text-xl font-bold">{editingSummary.total}</div>
          </div>
          <div className="card-modern p-3">
            <div className="text-xs text-muted-foreground mb-0.5">Matched</div>
            <div className="text-xl font-bold text-emerald-500">{editingSummary.matches}</div>
          </div>
          <div className="card-modern p-3">
            <div className="text-xs text-muted-foreground mb-0.5">Mismatches</div>
            <div className={cn('text-xl font-bold', editingSummary.mismatches > 0 ? 'text-amber-500' : 'text-emerald-500')}>
              {editingSummary.mismatches}
            </div>
          </div>
          <div className="card-modern p-3">
            <div className="text-xs text-muted-foreground mb-0.5">Missing</div>
            <div className={cn('text-xl font-bold', editingSummary.missingInMetrc > 0 ? 'text-red-500' : 'text-muted-foreground')}>
              {editingSummary.missingInMetrc + editingSummary.missingInExternal}
            </div>
          </div>
          <div className="card-modern p-3">
            <div className="text-xs text-muted-foreground mb-0.5">Match Rate</div>
            <div className={cn(
              'text-xl font-bold',
              editingSummary.matchRate >= 95 ? 'text-emerald-500' : editingSummary.matchRate >= 80 ? 'text-yellow-500' : 'text-red-500',
            )}>
              {editingSummary.matchRate}%
            </div>
          </div>
        </div>
      )}

      {/* BulkEditGrid */}
      {showGrid && (
        <BulkEditGrid
          facilityId={facilityId}
          rows={reconciliation.rows}
          selectedIds={reconciliation.selectedIds}
          modifiedCells={reconciliation.modifiedCells}
          onUpdateCell={reconciliation.updateCell}
          onToggleRow={reconciliation.toggleRow}
          onSelectAll={reconciliation.selectAll}
          onDeselectAll={reconciliation.deselectAll}
          onApplyToSelected={reconciliation.applyToSelected}
          onPreviewChanges={reconciliation.previewChanges}
          onDiscard={reconciliation.discard}
          onAddRows={reconciliation.addRows}
          showManualEntry={reconciliation.rows.length === 0 || reconciliation.phase === 'editing'}
        />
      )}

      {/* Preview Dialog */}
      {reconciliation.previewSummary && (
        <ReconciliationPreviewDialog
          open={reconciliation.phase === 'previewing' || reconciliation.phase === 'executing'}
          summary={reconciliation.previewSummary}
          isExecuting={reconciliation.phase === 'executing'}
          onExecute={reconciliation.executeChanges}
          onClose={reconciliation.backToEditing}
        />
      )}

      {/* Completed State */}
      {reconciliation.phase === 'completed' && reconciliation.executionResult && (
        <div className="card-modern p-8 text-center my-6">
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-2">Reconciliation Complete</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {reconciliation.executionResult.successCount} adjustment{reconciliation.executionResult.successCount !== 1 ? 's' : ''} applied successfully
            {reconciliation.executionResult.failCount > 0 && (
              <span className="text-red-500">
                , {reconciliation.executionResult.failCount} failed
              </span>
            )}
          </p>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={reconciliation.discard}>
              Start New Reconciliation
            </Button>
          </div>
        </div>
      )}

      {/* Error State */}
      {reconciliation.phase === 'error' && reconciliation.error && (
        <div className="card-modern p-6 my-6 border-red-500/20">
          <div className="flex items-center gap-2 text-red-500 mb-2">
            <AlertTriangle className="h-5 w-5" />
            <h3 className="font-semibold">Error</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{reconciliation.error}</p>
          <Button variant="outline" size="sm" onClick={reconciliation.discard}>
            Try Again
          </Button>
        </div>
      )}

      {/* History */}
      <div className="mt-8">
        <button
          onClick={() => setShowHistory(p => !p)}
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground transition-colors"
        >
          {showHistory ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Clock className="h-4 w-4 text-muted-foreground" />
          Reconciliation History
        </button>

        {showHistory && (
          <div className="mt-3">
            {historyLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : !history?.items?.length ? (
              <p className="text-sm text-muted-foreground py-4">No reconciliation records yet.</p>
            ) : (
              <div className="space-y-2">
                {history.items.map(record => (
                  <div key={record.id} className="card-modern p-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            record.status === 'COMPLETED' && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                            record.status === 'FAILED' && 'bg-red-500/10 text-red-500 border-red-500/20',
                            record.status === 'IN_PROGRESS' && 'bg-blue-500/10 text-blue-500 border-blue-500/20',
                          )}
                        >
                          {record.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {record.sourceA} vs {record.sourceB}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {record.totalRecords ?? 0} records compared
                        {record.mismatchCount ? `, ${record.mismatchCount} mismatches` : ''}
                        {record.resolvedCount ? `, ${record.resolvedCount} resolved` : ''}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(record.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
