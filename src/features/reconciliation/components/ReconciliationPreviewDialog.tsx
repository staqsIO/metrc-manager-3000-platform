'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/shared/components/ui/table'
import type { ReconciliationPreviewSummary } from '../hooks/useReconciliation'

interface ReconciliationPreviewDialogProps {
  open: boolean
  summary: ReconciliationPreviewSummary
  isExecuting: boolean
  onExecute: () => void
  onClose: () => void
}

const PREVIEW_LIMIT = 20

export default function ReconciliationPreviewDialog({
  open,
  summary,
  isExecuting,
  onExecute,
  onClose,
}: ReconciliationPreviewDialogProps) {
  const [confirmed, setConfirmed] = useState(false)
  const [showAll, setShowAll] = useState(false)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setConfirmed(false)
      setShowAll(false)
    }
  }, [open])

  const visibleAdjustments = showAll
    ? summary.adjustments
    : summary.adjustments.slice(0, PREVIEW_LIMIT)
  const hiddenCount = summary.adjustments.length - PREVIEW_LIMIT

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview Adjustments</DialogTitle>
          <DialogDescription>
            Review the following changes before applying them to Metrc.
          </DialogDescription>
        </DialogHeader>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
          <div className="card-modern p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Total</div>
            <div className="text-lg font-bold">{summary.totalAdjustments}</div>
          </div>
          <div className="card-modern p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1">
              <ArrowUp className="h-3 w-3 text-emerald-500" />
              Increases
            </div>
            <div className="text-lg font-bold text-emerald-500">{summary.increaseCount}</div>
          </div>
          <div className="card-modern p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1">
              <ArrowDown className="h-3 w-3 text-red-500" />
              Decreases
            </div>
            <div className="text-lg font-bold text-red-500">{summary.decreaseCount}</div>
          </div>
          <div className="card-modern p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Net Change</div>
            <div className={cn(
              'text-lg font-bold',
              summary.totalIncrease + summary.totalDecrease > 0 ? 'text-emerald-500' : 'text-red-500',
            )}>
              {(summary.totalIncrease + summary.totalDecrease) > 0 ? '+' : ''}
              {(summary.totalIncrease + summary.totalDecrease).toFixed(2)}
            </div>
          </div>
        </div>

        {/* Large batch warning */}
        {summary.totalAdjustments > 100 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm text-yellow-600 dark:text-yellow-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Large batch ({summary.totalAdjustments} adjustments) — execution may take a moment.
          </div>
        )}

        {/* Adjustment Table */}
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Delta</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleAdjustments.map(adj => (
                <TableRow key={adj.label}>
                  <TableCell className="font-mono text-xs">{adj.label}</TableCell>
                  <TableCell className="text-right">
                    {adj.currentQuantity.toFixed(2)} <span className="text-xs text-muted-foreground">{adj.unit}</span>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {adj.newQuantity.toFixed(2)}
                  </TableCell>
                  <TableCell className={cn(
                    'text-right font-medium',
                    adj.delta > 0 ? 'text-emerald-500' : 'text-red-500',
                  )}>
                    {adj.delta > 0 ? '+' : ''}{adj.delta.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-sm">{adj.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!showAll && hiddenCount > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full py-2 text-sm text-muted-foreground hover:text-foreground border-t border-border transition-colors"
            >
              ...and {hiddenCount} more
            </button>
          )}
        </div>

        {/* Confirmation checkbox */}
        <label className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border"
          />
          <span className="text-sm">
            I understand these changes will be applied to Metrc and may affect compliance records.
          </span>
        </label>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isExecuting}
          >
            Go Back
          </Button>
          <Button
            onClick={onExecute}
            disabled={!confirmed || isExecuting}
            className="gap-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            {isExecuting ? 'Executing...' : 'Execute Adjustments'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
