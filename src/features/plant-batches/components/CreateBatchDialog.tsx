'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { MutationDialog } from '@/shared/components/MutationDialog'
import { useMutationFlow } from '@/shared/hooks/useMutationFlow'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
import { format } from 'date-fns'

interface CreateBatchDialogProps {
  facilityId: string
}

type BatchPreview = {
  name: string
  strainName: string
  type: string
  count: number
  locationName: string
  tag: string
  actualDate: string
}

export function CreateBatchDialog({ facilityId }: CreateBatchDialogProps) {
  const [name, setName] = useState('')
  const [strainName, setStrainName] = useState('')
  const [type, setType] = useState<'Seed' | 'Clone'>('Clone')
  const [count, setCount] = useState('')
  const [locationName, setLocationName] = useState('')
  const [tag, setTag] = useState('')
  const [actualDate, setActualDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  const utils = trpc.useUtils()
  const mutation = trpc.plantBatches.createBatch.useMutation()

  const flow = useMutationFlow<
    { facilityId: string; name: string; strainName: string; type: 'Seed' | 'Clone'; count: number; locationName: string; tag: string; actualDate: string },
    BatchPreview
  >({
    mutationFn: (input) => mutation.mutateAsync(input),
    getPreview: (result) => [(result as { preview: BatchPreview }).preview],
    onSuccess: () => {
      utils.plantBatches.getActive.invalidate()
      utils.plantBatches.getSummary.invalidate()
      resetForm()
    },
  })

  const resetForm = () => {
    setName('')
    setStrainName('')
    setType('Clone')
    setCount('')
    setLocationName('')
    setTag('')
    setActualDate(format(new Date(), 'yyyy-MM-dd'))
  }

  const handleOpen = () => {
    resetForm()
    flow.open()
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const c = parseInt(count, 10)
    if (isNaN(c) || c <= 0) return
    flow.preview({ facilityId, name, strainName, type, count: c, locationName, tag, actualDate })
  }

  return (
    <>
      <Button onClick={handleOpen} size="sm">
        <Plus className="h-4 w-4 mr-1" />
        New Batch
      </Button>

      <MutationDialog
        title="Create Plant Batch"
        description="Create a new plant batch in Metrc."
        flow={flow}
        size="lg"
        formContent={
          <form id="mutation-form" onSubmit={handleFormSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="batchName">Batch Name</Label>
                <Input id="batchName" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Blue Dream Clone 1" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="strain">Strain</Label>
                <Input id="strain" value={strainName} onChange={(e) => setStrainName(e.target.value)} placeholder="e.g., Blue Dream" required />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <select
                  id="type"
                  value={type}
                  onChange={(e) => setType(e.target.value as 'Seed' | 'Clone')}
                  className={cn(
                    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                    'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                >
                  <option value="Clone">Clone</option>
                  <option value="Seed">Seed</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="count">Count</Label>
                <Input id="count" type="number" min="1" step="1" value={count} onChange={(e) => setCount(e.target.value)} placeholder="0" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input id="date" type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input id="location" value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="e.g., Veg Room A" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tag">Tag</Label>
                <Input id="tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Metrc tag..." required />
              </div>
            </div>
          </form>
        }
        previewContent={(previews) => {
          const p = previews[0]!
          return (
            <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{p.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Strain</span>
                <span className="font-medium">{p.strainName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Type</span>
                <span>{p.type}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Count</span>
                <span className="font-bold">{p.count} plants</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Location</span>
                <span>{p.locationName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tag</span>
                <span className="font-mono text-xs">{p.tag}</span>
              </div>
            </div>
          )
        }}
        confirmLabel="Create Batch"
      />
    </>
  )
}
