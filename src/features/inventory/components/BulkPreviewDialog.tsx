'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Badge } from '@/shared/components/ui/badge'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/lib/utils'
import { AlertTriangle, Loader2 } from 'lucide-react'
import PackageLabelLink from '@/features/inventory/components/PackageLabelLink'
import type {
  AdjustmentPreview,
  FinishPreview,
  ActionStatus,
  AdjustmentInput,
} from '@/services/actions/action-types'

interface BulkPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actionType: 'adjust' | 'finish' | null
  status: ActionStatus
  previews: AdjustmentPreview[] | FinishPreview[]
  error: string | null
  isLoading: boolean
  onConfirm: (adjustments?: AdjustmentInput[]) => void
  onCancel: () => void
}

export default function BulkPreviewDialog({
  open,
  onOpenChange,
  actionType,
  status,
  previews,
  error,
  isLoading,
  onConfirm,
  onCancel,
}: BulkPreviewDialogProps) {
  const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')

  // Initialize edited quantities from previews when dialog opens or previews change
  useEffect(() => {
    if (actionType === 'adjust' && previews.length > 0) {
      const initial: Record<string, number> = {}
      for (const preview of previews as AdjustmentPreview[]) {
        initial[preview.Label] = preview.newQuantity
      }
      setEditedQuantities(initial)
      setReason('')
    }
  }, [actionType, previews])

  // Auto-close on completion
  useEffect(() => {
    if (status === 'completed') {
      const timer = setTimeout(() => {
        onOpenChange(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [status, onOpenChange])

  const handleQuantityChange = useCallback((label: string, value: string) => {
    const parsed = parseFloat(value)
    if (!isNaN(parsed)) {
      setEditedQuantities((prev) => ({ ...prev, [label]: parsed }))
    }
  }, [])

  const handleConfirm = useCallback(() => {
    if (actionType === 'adjust') {
      const adjustments: AdjustmentInput[] = (previews as AdjustmentPreview[]).map(
        (preview) => ({
          Label: preview.Label,
          Quantity: editedQuantities[preview.Label] ?? preview.newQuantity,
          UnitOfMeasureName: '',
          AdjustmentReason: reason,
        })
      )
      onConfirm(adjustments)
    } else {
      onConfirm()
    }
  }, [actionType, previews, editedQuantities, reason, onConfirm])

  const isExecuting = status === 'executing'
  const isCompleted = status === 'completed'

  const title = actionType === 'adjust' ? 'Bulk Adjust Packages' : 'Bulk Finish Packages'
  const description =
    actionType === 'adjust'
      ? `Review and edit quantities for ${previews.length} package(s) before submitting.`
      : `You are about to finish ${previews.length} package(s). This action is irreversible.`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Status Messages */}
        {isCompleted && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
            Action completed successfully.
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Table Content */}
        <div className="flex-1 overflow-auto">
          {actionType === 'adjust' ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">Current Qty</TableHead>
                    <TableHead className="text-right">New Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(previews as AdjustmentPreview[]).map((preview) => {
                    const editedQty = editedQuantities[preview.Label] ?? preview.newQuantity
                    const hasChanged = editedQty !== preview.currentQuantity

                    return (
                      <TableRow key={preview.Label}>
                        <TableCell>
                          <PackageLabelLink label={preview.Label} />
                        </TableCell>
                        <TableCell>{preview.ItemName}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {preview.currentQuantity}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={editedQty}
                            onChange={(e) =>
                              handleQuantityChange(preview.Label, e.target.value)
                            }
                            disabled={isExecuting || isCompleted}
                            className={cn(
                              'w-24 ml-auto text-right tabular-nums',
                              hasChanged && 'border-primary'
                            )}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              <div className="mt-4">
                <label
                  htmlFor="adjustment-reason"
                  className="block text-sm font-medium mb-1.5"
                >
                  Adjustment Reason
                </label>
                <Input
                  id="adjustment-reason"
                  placeholder="Enter reason for adjustment..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={isExecuting || isCompleted}
                />
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Finishing packages is permanent and cannot be undone. Please review
                  carefully.
                </span>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-center">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(previews as FinishPreview[]).map((preview) => (
                    <TableRow key={preview.Label}>
                      <TableCell>
                        <PackageLabelLink label={preview.Label} />
                      </TableCell>
                      <TableCell>{preview.ItemName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {preview.Quantity}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="destructive">Finish</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            onClick={onCancel}
            disabled={isExecuting}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isExecuting || isCompleted || isLoading}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
              actionType === 'finish'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            {isExecuting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isExecuting ? 'Executing...' : 'Confirm & Execute'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
