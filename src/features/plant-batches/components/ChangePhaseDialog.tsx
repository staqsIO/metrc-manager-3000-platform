'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { MutationDialog } from '@/shared/components/MutationDialog'
import { useMutationFlow } from '@/shared/hooks/useMutationFlow'
import { cn } from '@/lib/utils'
import { ArrowUpDown } from 'lucide-react'
import { format } from 'date-fns'

interface ChangePhaseDialogProps {
  facilityId: string
  batch: { id: number; name: string; count: number; type: string }
  onSuccess?: () => void
}

type PhasePreview = {
  batchName: string
  strain: string
  currentCount: number
  changeCount: number
  fromPhase: string
  toPhase: string
  newLocation: string
}

export function ChangePhaseDialog({ facilityId, batch, onSuccess }: ChangePhaseDialogProps) {
  const [growthPhase, setGrowthPhase] = useState<'Vegetative' | 'Flowering'>('Flowering')
  const [newTag, setNewTag] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [count, setCount] = useState(String(batch.count))
  const [actualDate, setActualDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  const utils = trpc.useUtils()
  const mutation = trpc.plantBatches.changeGrowthPhase.useMutation()

  const flow = useMutationFlow<
    { facilityId: string; plantBatchId: number; count: number; growthPhase: 'Vegetative' | 'Flowering'; newTag: string; newLocation?: string; actualDate: string },
    PhasePreview
  >({
    mutationFn: (input) => mutation.mutateAsync(input),
    getPreview: (result) => [(result as { preview: PhasePreview }).preview],
    onSuccess: () => {
      utils.plantBatches.getActive.invalidate()
      utils.plantBatches.getSummary.invalidate()
      onSuccess?.()
    },
  })

  const handleOpen = () => {
    setCount(String(batch.count))
    setNewTag('')
    setNewLocation('')
    setActualDate(format(new Date(), 'yyyy-MM-dd'))
    flow.open()
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const c = parseInt(count, 10)
    if (isNaN(c) || c <= 0 || !newTag) return
    flow.preview({ facilityId, plantBatchId: batch.id, count: c, growthPhase, newTag, newLocation: newLocation || undefined, actualDate })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen}>
        <ArrowUpDown className="h-4 w-4 mr-1" />
        Change Phase
      </Button>

      <MutationDialog
        title="Change Growth Phase"
        description={`Change growth phase for batch: ${batch.name}`}
        flow={flow}
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
                <Label htmlFor="changeCount">Plant Count</Label>
                <Input id="changeCount" type="number" min="1" max={batch.count} value={count} onChange={(e) => setCount(e.target.value)} required />
                <p className="text-xs text-muted-foreground">Max: {batch.count}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="newTag">New Tag</Label>
                <Input id="newTag" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Metrc tag..." required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newLocation">New Location</Label>
                <Input id="newLocation" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} required />
            </div>
          </form>
        }
        previewContent={(previews) => {
          const p = previews[0]!
          return (
            <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Batch</span>
                <span className="font-medium">{p.batchName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Strain</span>
                <span>{p.strain}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Plants</span>
                <span className="font-bold">{p.changeCount} of {p.currentCount}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-border pt-2">
                <span className="text-muted-foreground">Phase Change</span>
                <span>{p.fromPhase} &rarr; <span className="font-medium">{p.toPhase}</span></span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Location</span>
                <span>{p.newLocation}</span>
              </div>
            </div>
          )
        }}
        confirmLabel="Change Phase"
      />
    </>
  )
}
