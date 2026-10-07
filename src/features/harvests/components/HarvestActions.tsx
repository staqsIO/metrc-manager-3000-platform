'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { MutationDialog } from '@/shared/components/MutationDialog'
import { useMutationFlow } from '@/shared/hooks/useMutationFlow'
import { cn } from '@/lib/utils'
import { CheckCircle2, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import type { FormattedHarvest } from '@/services/metrc/types'

// ---------------------------------------------------------------------------
// FinishHarvestButton
// ---------------------------------------------------------------------------

interface FinishHarvestButtonProps {
  facilityId: string
  harvest: FormattedHarvest
  onSuccess?: () => void
}

export function FinishHarvestButton({ facilityId, harvest, onSuccess }: FinishHarvestButtonProps) {
  const utils = trpc.useUtils()
  const finishMutation = trpc.harvests.finishHarvests.useMutation()

  const flow = useMutationFlow<
    { facilityId: string; harvestIds: number[] },
    { id: number; name: string; currentWeight: number }
  >({
    mutationFn: (input) => finishMutation.mutateAsync(input),
    getPreview: (result) => (result as { previews: { id: number; name: string; currentWeight: number }[] }).previews,
    onSuccess: () => {
      utils.harvests.getActive.invalidate()
      utils.harvests.getOnHold.invalidate()
      utils.harvests.getInactive.invalidate()
      utils.harvests.getSummary.invalidate()
      onSuccess?.()
    },
  })

  const handleOpen = () => {
    flow.preview({ facilityId, harvestIds: [harvest.id] })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen} disabled={harvest.status !== 'active'}>
        <CheckCircle2 className="h-4 w-4 mr-1" />
        Finish
      </Button>

      <MutationDialog
        title="Finish Harvest"
        description="Review the harvest to be finished."
        flow={flow}
        previewContent={(previews) => (
          <div className="space-y-3">
            {previews.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3 rounded-md border border-border bg-muted/30">
                <div>
                  <p className="font-medium text-sm">{item.name}</p>
                  <p className="text-xs text-muted-foreground">ID: {item.id}</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {item.currentWeight.toLocaleString()} {harvest.unitOfWeight}
                </p>
              </div>
            ))}
            <p className="text-sm text-muted-foreground">
              This will mark the harvest as finished in Metrc. This action cannot be undone.
            </p>
          </div>
        )}
        confirmLabel="Confirm Finish"
        destructive
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// RecordWasteButton
// ---------------------------------------------------------------------------

interface RecordWasteButtonProps {
  facilityId: string
  harvest: FormattedHarvest
  onSuccess?: () => void
}

export function RecordWasteButton({ facilityId, harvest, onSuccess }: RecordWasteButtonProps) {
  const [wasteTypeName, setWasteTypeName] = useState('')
  const [wasteWeight, setWasteWeight] = useState('')
  const [unitOfWeightName, setUnitOfWeightName] = useState('Grams')
  const [actualDate, setActualDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  const wasteTypesQuery = trpc.harvests.getWasteTypes.useQuery(
    { facilityId },
    { staleTime: 5 * 60 * 1000 }
  )
  const wasteTypes = wasteTypesQuery.data ?? ['Plant Material', 'Roots', 'Stalks', 'Trim Waste', 'Other']
  useEffect(() => {
    if (!wasteTypeName && wasteTypes.length > 0) {
      setWasteTypeName(wasteTypes[0]!)
    }
  }, [wasteTypes, wasteTypeName])

  const isQuantityType = /quantity/i.test(wasteTypeName)
  const utils = trpc.useUtils()
  const wasteMutation = trpc.harvests.recordWaste.useMutation()

  const flow = useMutationFlow<
    { facilityId: string; harvestId: number; wasteTypeName: string; wasteWeight: number; unitOfWeightName: string; actualDate: string },
    { harvestName: string; wasteWeight: number; currentTotalWaste: number; newTotalWaste: number }
  >({
    mutationFn: (input) => wasteMutation.mutateAsync(input),
    getPreview: (result) => {
      const r = result as { preview: { harvestName: string; wasteWeight: number; currentTotalWaste: number; newTotalWaste: number } }
      return [r.preview]
    },
    onSuccess: () => {
      utils.harvests.getActive.invalidate()
      utils.harvests.getWaste.invalidate()
      utils.harvests.getSummary.invalidate()
      setWasteWeight('')
      onSuccess?.()
    },
  })

  const handleOpen = () => {
    setWasteWeight('')
    setUnitOfWeightName('Grams')
    setActualDate(format(new Date(), 'yyyy-MM-dd'))
    flow.open()
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const weight = parseFloat(wasteWeight)
    if (isNaN(weight) || weight <= 0) return
    const unit = isQuantityType ? 'Each' : unitOfWeightName
    flow.preview({ facilityId, harvestId: harvest.id, wasteTypeName, wasteWeight: weight, unitOfWeightName: unit, actualDate })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen} disabled={harvest.status === 'finished'}>
        <Trash2 className="h-4 w-4 mr-1" />
        Record Waste
      </Button>

      <MutationDialog
        title="Record Waste"
        description={`Record waste for harvest: ${harvest.name}`}
        flow={flow}
        formContent={
          <form id="mutation-form" onSubmit={handleFormSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wasteType">Waste Type</Label>
              <select
                id="wasteType"
                value={wasteTypeName}
                onChange={(e) => setWasteTypeName(e.target.value)}
                className={cn(
                  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                )}
              >
                {wasteTypes.map((t) => (
                  <option key={t} value={t}>{t.replace(/\s*\(.*\)$/, '')}</option>
                ))}
              </select>
            </div>
            {isQuantityType ? (
              <div className="space-y-2">
                <Label htmlFor="wasteWeight">Quantity</Label>
                <Input id="wasteWeight" type="number" step="1" min="1" value={wasteWeight} onChange={(e) => setWasteWeight(e.target.value)} placeholder="0" required />
                <p className="text-xs text-muted-foreground">Enter as a count, not weight</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="wasteWeight">Weight</Label>
                  <Input id="wasteWeight" type="number" step="0.01" min="0.01" value={wasteWeight} onChange={(e) => setWasteWeight(e.target.value)} placeholder="0.00" required />
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
            )}
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
                  <span className="text-muted-foreground">{isQuantityType ? 'Quantity' : 'Waste Amount'}</span>
                  <span className="font-medium">{p.wasteWeight} {isQuantityType ? 'count' : unitOfWeightName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Total Waste</span>
                  <span>{p.currentTotalWaste} {unitOfWeightName}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-border pt-2">
                  <span className="text-muted-foreground font-medium">New Total Waste</span>
                  <span className="font-bold">{p.newTotalWaste} {unitOfWeightName}</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                This will record {p.wasteWeight} {isQuantityType ? 'root balls' : `${unitOfWeightName} of waste`} in Metrc.
              </p>
            </div>
          )
        }}
        confirmLabel="Confirm Record Waste"
      />
    </>
  )
}
