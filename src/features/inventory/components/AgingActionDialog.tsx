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
import { Badge } from '@/shared/components/ui/badge'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/lib/utils'
import { AlertTriangle, Loader2, CheckCircle2, Sparkles, ShieldCheck, ShieldAlert } from 'lucide-react'
import type { AgingActionType, ActionStatus } from '@/services/actions/action-types'
import { useCopilot } from '@/features/copilot/CopilotContext'
import PackageLabelLink from '@/features/inventory/components/PackageLabelLink'

interface AgingActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actionType: AgingActionType | null
  packageLabel: string
  packageName: string
  currentQuantity: number
  unitOfMeasure: string
  status: ActionStatus
  previewDescription: string | null
  error: string | null
  verified?: boolean
  onConfirm: (params: { newQuantity?: number; note?: string }) => void
  onCancel: () => void
}

const ACTION_LABELS: Record<AgingActionType, string> = {
  discount: 'Flag for Discount',
  sample_out: 'Sample Out',
  destroy: 'Destroy Package',
  remediate: 'Flag for Remediation',
  expedite_testing: 'Expedite Testing',
  fifo_priority: 'Prioritize Older',
}

const ACTION_DESCRIPTIONS: Record<AgingActionType, string> = {
  discount: 'This will add a note flagging this package for discount pricing.',
  sample_out: 'This will reduce the package quantity by sampling out a portion.',
  destroy: 'This will permanently remove this package from active inventory. This action cannot be undone.',
  remediate: 'This will flag this package as requiring remediation in Metrc.',
  expedite_testing: 'This will add a note to expedite lab testing for this package.',
  fifo_priority: 'This will add a FIFO priority note to ensure this older package is used first.',
}

export default function AgingActionDialog({
  open,
  onOpenChange,
  actionType,
  packageLabel,
  packageName,
  currentQuantity,
  unitOfMeasure,
  status,
  previewDescription,
  error,
  verified,
  onConfirm,
  onCancel,
}: AgingActionDialogProps) {
  const { open: openCopilot } = useCopilot()
  const [sampleQuantity, setSampleQuantity] = useState<number>(0)

  // Initialize sample quantity when dialog opens
  useEffect(() => {
    if (actionType === 'sample_out' && currentQuantity > 0) {
      setSampleQuantity(Math.round(currentQuantity * 0.9 * 100) / 100)
    }
  }, [actionType, currentQuantity])

  // Auto-close on completion
  useEffect(() => {
    if (status === 'completed' || status === 'verified' || status === 'unverified') {
      const timer = setTimeout(() => {
        onOpenChange(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [status, onOpenChange])

  const handleConfirm = useCallback(() => {
    if (actionType === 'sample_out') {
      onConfirm({ newQuantity: sampleQuantity })
    } else {
      onConfirm({})
    }
  }, [actionType, sampleQuantity, onConfirm])

  if (!actionType) return null

  const isExecuting = status === 'executing'
  const isCompleted = status === 'completed' || status === 'verified' || status === 'unverified'
  const isDestructive = actionType === 'destroy'
  const title = ACTION_LABELS[actionType]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {ACTION_DESCRIPTIONS[actionType]}
          </DialogDescription>
        </DialogHeader>

        {/* Package info */}
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Package</span>
            <PackageLabelLink label={packageLabel} className="text-sm font-mono font-medium" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Item</span>
            <span className="text-sm font-medium">{packageName}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Quantity</span>
            <span className="text-sm">
              {currentQuantity.toLocaleString()} {unitOfMeasure}
            </span>
          </div>
        </div>

        {/* Preview description */}
        {previewDescription && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-0.5">What will happen</p>
            <p className="text-sm">{previewDescription}</p>
          </div>
        )}

        {/* Destructive warning */}
        {isDestructive && !isCompleted && (
          <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>This action is permanent and cannot be undone.</span>
          </div>
        )}

        {/* Sample out quantity editor */}
        {actionType === 'sample_out' && !isCompleted && (
          <div>
            <label htmlFor="sample-qty" className="block text-sm font-medium mb-1.5">
              New Quantity (after sampling)
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="sample-qty"
                type="number"
                step="0.01"
                min={0}
                max={currentQuantity}
                value={sampleQuantity}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  if (!isNaN(val)) setSampleQuantity(val)
                }}
                disabled={isExecuting || isCompleted}
                className="w-32"
              />
              <span className="text-sm text-muted-foreground">{unitOfMeasure}</span>
              <Badge variant="outline" className="text-xs ml-auto">
                -{Math.round((currentQuantity - sampleQuantity) * 100) / 100} sampled
              </Badge>
            </div>
          </div>
        )}

        {/* Success */}
        {isCompleted && verified === true && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>Action verified by Metrc.</span>
          </div>
        )}
        {isCompleted && verified === false && (
          <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>Action submitted — verification pending.</span>
          </div>
        )}
        {isCompleted && verified === undefined && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Action completed successfully.</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Ask Copilot */}
        {!isCompleted && (
          <button
            onClick={() => {
              onOpenChange(false)
              openCopilot(
                `Should I ${ACTION_LABELS[actionType].toLowerCase()} package ${packageLabel} (${packageName}, ${currentQuantity} ${unitOfMeasure})? What are the implications?`
              )
            }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <Sparkles className="h-3 w-3" />
            Ask Copilot if this is the right call
          </button>
        )}

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
            disabled={isExecuting || isCompleted}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
              isDestructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            {isExecuting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isExecuting ? 'Executing...' : 'Confirm'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
