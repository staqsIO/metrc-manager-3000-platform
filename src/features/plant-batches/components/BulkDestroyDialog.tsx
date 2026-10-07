'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'

interface BatchInfo {
  id: number
  name: string
  count: number
  strainName: string
}

interface BulkDestroyDialogProps {
  facilityId: string
  batches: BatchInfo[]
  open: boolean
  onClose: () => void
}

export function BulkDestroyDialog({ facilityId, batches, open, onClose }: BulkDestroyDialogProps) {
  const [reasonNote, setReasonNote] = useState('')
  const [actualDate, setActualDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [step, setStep] = useState<'form' | 'executing' | 'completed' | 'error'>('form')
  const [progress, setProgress] = useState(0)
  const [errors, setErrors] = useState<string[]>([])

  const utils = trpc.useUtils()
  const mutation = trpc.plantBatches.destroyPlants.useMutation()

  const totalPlants = batches.reduce((sum, b) => sum + b.count, 0)

  // Reset state when dialog reopens (guards against always-mounted rendering)
  useEffect(() => {
    if (open) {
      setStep('form')
      setReasonNote('')
      setActualDate(format(new Date(), 'yyyy-MM-dd'))
      setProgress(0)
      setErrors([])
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reasonNote) return

    setStep('executing')
    setProgress(0)
    setErrors([])
    const failedBatches: string[] = []

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      try {
        // Preview first — creates PREVIEWING ActionLog entry for audit trail
        await mutation.mutateAsync({
          facilityId,
          plantBatchId: batch.id,
          count: batch.count,
          reasonNote,
          actualDate,
          confirmed: false,
        })
        // Execute — creates COMPLETED ActionLog entry
        await mutation.mutateAsync({
          facilityId,
          plantBatchId: batch.id,
          count: batch.count,
          reasonNote,
          actualDate,
          confirmed: true,
        })
      } catch (err) {
        failedBatches.push(`${batch.name}: ${err instanceof Error ? err.message : 'Failed'}`)
      }
      setProgress(i + 1)
    }

    // Always invalidate if any work was done (handles partial success)
    if (progress > failedBatches.length || batches.length > failedBatches.length) {
      utils.plantBatches.getActive.invalidate()
      utils.plantBatches.getSummary.invalidate()
    }

    if (failedBatches.length > 0) {
      setErrors(failedBatches)
      setStep('error')
    } else {
      setStep('completed')
      setTimeout(() => onClose(), 1500)
    }
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && step !== 'executing') {
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Destroy Plant Batches</DialogTitle>
          <DialogDescription>
            Destroy all plants in {batches.length} selected batch(es) ({totalPlants.toLocaleString()} total plants).
          </DialogDescription>
        </DialogHeader>

        {step === 'completed' && (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              All {batches.length} batches destroyed successfully.
            </p>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-2">
            {progress - errors.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-emerald-500 bg-emerald-500/10 rounded-md p-3">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {progress - errors.length} of {batches.length} batches destroyed successfully.
              </div>
            )}
            <div className="space-y-1">
              {errors.map((err, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {err}
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 'executing' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Processing {progress} of {batches.length} batches...
            </p>
          </div>
        )}

        {step === 'form' && (
          <form id="bulk-destroy-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-md border border-border bg-muted/30 p-4 space-y-1 max-h-40 overflow-auto">
              {batches.map((b) => (
                <div key={b.id} className="flex items-center justify-between text-sm">
                  <span>{b.name}</span>
                  <span className="text-muted-foreground">{b.count} plants &middot; {b.strainName || 'Unknown'}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Input
                id="reason"
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
                placeholder="Reason for destruction..."
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={actualDate}
                onChange={(e) => setActualDate(e.target.value)}
                required
              />
            </div>
          </form>
        )}

        {step === 'form' && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="bulk-destroy-form" variant="destructive">
              Destroy {totalPlants.toLocaleString()} Plants
            </Button>
          </DialogFooter>
        )}

        {step === 'error' && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
