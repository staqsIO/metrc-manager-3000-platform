'use client'

import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/lib/utils'
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { MutationFlowState } from '@/shared/hooks/useMutationFlow'

interface MutationDialogProps<TPreview> {
  title: string
  description?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flow: MutationFlowState<any, TPreview>
  /** Shown during 'form' step */
  formContent?: ReactNode
  /** Shown during 'confirming' step */
  previewContent?: (previews: TPreview[]) => ReactNode
  confirmLabel?: string
  destructive?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_CLASS = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const

export function MutationDialog<TPreview>({
  title,
  description,
  flow,
  formContent,
  previewContent,
  confirmLabel = 'Confirm',
  destructive = false,
  size = 'md',
}: MutationDialogProps<TPreview>) {
  const isOpen = flow.step !== 'idle'

  const handleOpenChange = (open: boolean) => {
    if (!open && flow.step !== 'executing') {
      flow.reset()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className={cn(SIZE_CLASS[size], 'max-h-[85vh] flex flex-col')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {/* Completed */}
        {flow.step === 'completed' && (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              Action completed successfully.
            </p>
          </div>
        )}

        {/* Error */}
        {flow.error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {flow.error}
          </div>
        )}

        {/* Form step */}
        {flow.step === 'form' && formContent && (
          <div className="flex-1 overflow-auto">{formContent}</div>
        )}

        {/* Previewing / Executing spinner */}
        {(flow.step === 'previewing' || flow.step === 'executing') && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Confirming step */}
        {flow.step === 'confirming' && flow.previews && previewContent && (
          <div className="flex-1 overflow-auto">
            {previewContent(flow.previews)}
          </div>
        )}

        {/* Footer */}
        {flow.step === 'form' && formContent && (
          <DialogFooter>
            <Button variant="outline" onClick={flow.reset}>
              Cancel
            </Button>
            <Button type="submit" form="mutation-form">
              Preview
            </Button>
          </DialogFooter>
        )}

        {flow.step === 'confirming' && (
          <DialogFooter>
            <Button variant="outline" onClick={() => flow.open(flow.input ?? undefined)}>
              Back
            </Button>
            <Button
              onClick={flow.confirm}
              variant={destructive ? 'destructive' : 'default'}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        )}

        {flow.step === 'error' && (
          <DialogFooter>
            <Button variant="outline" onClick={flow.reset}>
              Close
            </Button>
            <Button onClick={() => flow.open(flow.input ?? undefined)}>
              Try Again
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
