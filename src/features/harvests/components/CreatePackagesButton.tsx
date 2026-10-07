'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { MutationDialog } from '@/shared/components/MutationDialog'
import { useMutationFlow } from '@/shared/hooks/useMutationFlow'
import { cn } from '@/lib/utils'
import { Package } from 'lucide-react'
import { format } from 'date-fns'
import type { FormattedHarvest } from '@/services/metrc/types'

interface CreatePackagesButtonProps {
  facilityId: string
  harvest: FormattedHarvest
  onSuccess?: () => void
}

export function CreatePackagesButton({ facilityId, harvest, onSuccess }: CreatePackagesButtonProps) {
  const [tag, setTag] = useState('')
  const [itemName, setItemName] = useState('')
  const [weight, setWeight] = useState('')
  const [unitOfWeightName, setUnitOfWeightName] = useState('Grams')
  const [actualDate, setActualDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  const utils = trpc.useUtils()
  const mutation = trpc.harvests.createPackagesFromHarvest.useMutation()

  const flow = useMutationFlow<
    { facilityId: string; harvestId: number; tag: string; itemName: string; weight: number; unitOfWeightName: string; actualDate: string },
    { harvestName: string; tag: string; itemName: string; weight: number; unitOfWeightName: string; currentHarvestWeight: number; remainingWeight: number }
  >({
    mutationFn: (input) => mutation.mutateAsync(input),
    getPreview: (result) => {
      const r = result as { preview: { harvestName: string; tag: string; itemName: string; weight: number; unitOfWeightName: string; currentHarvestWeight: number; remainingWeight: number } }
      return [r.preview]
    },
    onSuccess: () => {
      utils.harvests.getActive.invalidate()
      utils.harvests.getSummary.invalidate()
      setTag('')
      setItemName('')
      setWeight('')
      onSuccess?.()
    },
  })

  const handleOpen = () => {
    setTag('')
    setItemName('')
    setWeight('')
    setUnitOfWeightName('Grams')
    setActualDate(format(new Date(), 'yyyy-MM-dd'))
    flow.open()
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const w = parseFloat(weight)
    if (isNaN(w) || w <= 0 || !tag || !itemName) return
    flow.preview({ facilityId, harvestId: harvest.id, tag, itemName, weight: w, unitOfWeightName, actualDate })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen} disabled={harvest.status !== 'active'}>
        <Package className="h-4 w-4 mr-1" />
        Create Package
      </Button>

      <MutationDialog
        title="Create Package from Harvest"
        description={`Create a new package from harvest: ${harvest.name}`}
        flow={flow}
        size="lg"
        formContent={
          <form id="mutation-form" onSubmit={handleFormSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tag">Package Tag</Label>
              <Input id="tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Enter Metrc tag..." required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="itemName">Item Name</Label>
              <Input id="itemName" value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g., Blue Dream Flower" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="weight">Weight</Label>
                <Input id="weight" type="number" step="0.01" min="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0.00" required />
                <p className="text-xs text-muted-foreground">Available: {harvest.currentWeight} {harvest.unitOfWeight}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Unit</Label>
                <select
                  id="unit"
                  value={unitOfWeightName}
                  onChange={(e) => setUnitOfWeightName(e.target.value)}
                  className={cn(
                    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                    'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                >
                  <option value="Grams">Grams</option>
                  <option value="Ounces">Ounces</option>
                  <option value="Pounds">Pounds</option>
                  <option value="Kilograms">Kilograms</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="actualDate">Date</Label>
              <Input id="actualDate" type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} required />
            </div>
          </form>
        }
        previewContent={(previews) => {
          const p = previews[0]!
          return (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Harvest</span>
                  <span className="font-medium">{p.harvestName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Package Tag</span>
                  <span className="font-mono text-xs">{p.tag}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Item</span>
                  <span className="font-medium">{p.itemName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Weight</span>
                  <span className="font-medium">{p.weight} {p.unitOfWeightName}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-border pt-2">
                  <span className="text-muted-foreground">Remaining Harvest Weight</span>
                  <span className="font-bold">{p.remainingWeight} {p.unitOfWeightName}</span>
                </div>
              </div>
            </div>
          )
        }}
        confirmLabel="Create Package"
      />
    </>
  )
}
