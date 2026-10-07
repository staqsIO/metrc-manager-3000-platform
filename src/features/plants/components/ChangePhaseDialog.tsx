'use client'

import { useState, useEffect, useMemo } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { MutationDialog } from '@/shared/components/MutationDialog'
import { useMutationFlow } from '@/shared/hooks/useMutationFlow'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

interface ChangePhaseDialogProps {
  facilityId: string
  plantIds: number[]
  open: boolean
  onClose: () => void
}

type BulkPhasePreview = {
  totalPlants: number
  batchCount: number
  batches: Array<{ batchName: string; plantCount: number; currentPhase: string }>
  toPhase: string
  newLocation?: string
}

export function ChangePhaseDialog({ facilityId, plantIds, open, onClose }: ChangePhaseDialogProps) {
  const [growthPhase, setGrowthPhase] = useState<'Vegetative' | 'Flowering'>('Flowering')
  const [newTag, setNewTag] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [actualDate, setActualDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  const utils = trpc.useUtils()
  const mutation = trpc.plants.changeGrowthPhase.useMutation()

  const flow = useMutationFlow<
    { facilityId: string; plantIds: number[]; growthPhase: 'Vegetative' | 'Flowering'; newTag: string; newLocation?: string; actualDate: string },
    BulkPhasePreview
  >({
    mutationFn: (input) => mutation.mutateAsync(input),
    getPreview: (result) => [(result as { preview: BulkPhasePreview }).preview],
    onSuccess: () => {
      utils.plants.getActive.invalidate()
      utils.plants.getSummary.invalidate()
      onClose()
    },
  })

  // Open the flow when `open` prop becomes true
  useEffect(() => {
    if (open && flow.step === 'idle') {
      flow.open()
    }
  }, [open, flow.step, flow.open])

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTag) return
    flow.preview({ facilityId, plantIds, growthPhase, newTag, newLocation: newLocation || undefined, actualDate })
  }

  // Sync close: when MutationDialog resets, propagate to parent
  const wrappedFlow = useMemo(() => ({
    ...flow,
    reset: () => {
      flow.reset()
      onClose()
    },
  }), [flow, onClose])

  return (
    <MutationDialog
      title="Change Growth Phase"
      description={`Change growth phase for ${plantIds.length} selected plant(s).`}
      flow={wrappedFlow}
      formContent={
        <form id="mutation-form" onSubmit={handleFormSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phase">Target Phase</Label>
              <select
                id="phase"
                value={growthPhase}
                onChange={(e) => setGrowthPhase(e.target.value as 'Vegetative' | 'Flowering')}
                className={cn(
                  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                )}
              >
                <option value="Vegetative">Vegetative</option>
                <option value="Flowering">Flowering</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newTag">New Tag</Label>
              <Input id="newTag" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Metrc tag..." required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="newLocation">New Location</Label>
              <Input id="newLocation" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} required />
            </div>
          </div>
        </form>
      }
      previewContent={(previews) => {
        const p = previews[0]!
        return (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Plants</span>
                <span className="font-bold">{p.totalPlants}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Batches Affected</span>
                <span>{p.batchCount}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Target Phase</span>
                <span className="font-medium">{p.toPhase}</span>
              </div>
            </div>
            {p.batches.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Batch Breakdown</p>
                {p.batches.map((b) => (
                  <div key={b.batchName} className="flex items-center justify-between text-sm px-3 py-1.5 rounded border border-border/50">
                    <span>{b.batchName}</span>
                    <span className="text-muted-foreground">{b.plantCount} plants ({b.currentPhase})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      }}
      confirmLabel="Change Phase"
    />
  )
}
