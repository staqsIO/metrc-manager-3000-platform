'use client'

import { useEffect, useMemo, useRef } from 'react'
import { trpc } from '@/lib/trpc-client'
import { MutationDialog } from '@/shared/components/MutationDialog'
import { useMutationFlow } from '@/shared/hooks/useMutationFlow'

interface BulkFinishHarvestsDialogProps {
  facilityId: string
  harvestIds: number[]
  open: boolean
  onClose: () => void
}

type FinishPreview = {
  id: number
  name: string
  currentWeight: number
  found: boolean
}

export function BulkFinishHarvestsDialog({ facilityId, harvestIds, open, onClose }: BulkFinishHarvestsDialogProps) {
  const utils = trpc.useUtils()
  const mutation = trpc.harvests.finishHarvests.useMutation()

  const flow = useMutationFlow<
    { facilityId: string; harvestIds: number[] },
    FinishPreview
  >({
    mutationFn: (input) => mutation.mutateAsync(input),
    getPreview: (result) => (result as { previews: FinishPreview[] }).previews,
    onSuccess: () => {
      utils.harvests.getActive.invalidate()
      utils.harvests.getSummary.invalidate()
      onClose()
    },
  })

  // Stable ref for harvestIds to avoid re-firing effect on every render
  const harvestIdsRef = useRef(harvestIds)
  harvestIdsRef.current = harvestIds

  useEffect(() => {
    if (open && flow.step === 'idle') {
      // Skip form step — go straight to preview
      flow.preview({ facilityId, harvestIds: harvestIdsRef.current })
    }
  }, [open, flow.step, flow.preview, facilityId])

  const wrappedFlow = useMemo(() => ({
    ...flow,
    reset: () => {
      flow.reset()
      onClose()
    },
  }), [flow, onClose])

  return (
    <MutationDialog
      title="Finish Harvests"
      description={`Finish ${harvestIds.length} selected harvest(s). This marks them as complete in Metrc.`}
      flow={wrappedFlow}
      previewContent={(previews) => (
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-muted/30 p-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Total Harvests</span>
              <span className="font-bold">{previews.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Weight</span>
              <span className="font-medium">
                {previews.reduce((sum, p) => sum + p.currentWeight, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}g
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Harvests to Finish</p>
            {previews.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm px-3 py-1.5 rounded border border-border/50">
                <span>{p.name}</span>
                <span className="text-muted-foreground">
                  {p.currentWeight.toLocaleString(undefined, { maximumFractionDigits: 2 })}g
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      confirmLabel="Finish Harvests"
      destructive
    />
  )
}
