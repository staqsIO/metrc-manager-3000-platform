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

interface CreateProcessingDialogProps {
  facilityId: string
}

type ProcessingPreview = {
  sources: Array<{ label: string; itemName: string; requestedQty: number; availableQty: number; unit: string }>
  output: { tag: string; itemName: string; quantity: number; unitOfMeasure: string }
  note: string
}

export function CreateProcessingDialog({ facilityId }: CreateProcessingDialogProps) {
  const [sourceLabel, setSourceLabel] = useState('')
  const [sourceQty, setSourceQty] = useState('')
  const [sourceUnit, setSourceUnit] = useState('Grams')
  const [outputTag, setOutputTag] = useState('')
  const [outputItem, setOutputItem] = useState('')
  const [outputQty, setOutputQty] = useState('')
  const [outputUnit, setOutputUnit] = useState('Grams')
  const [note, setNote] = useState('')

  const utils = trpc.useUtils()
  const mutation = trpc.processing.createProcessingJob.useMutation()

  const flow = useMutationFlow<
    { facilityId: string; sourcePackages: Array<{ label: string; quantity: number; unitOfMeasure: string }>; outputTag: string; outputItemName: string; outputQuantity: number; outputUnitOfMeasure: string; note?: string },
    ProcessingPreview
  >({
    mutationFn: (input) => mutation.mutateAsync(input),
    getPreview: (result) => [(result as { preview: ProcessingPreview }).preview],
    onSuccess: () => {
      utils.processing.getSourcePackages.invalidate()
      resetForm()
    },
  })

  const resetForm = () => {
    setSourceLabel('')
    setSourceQty('')
    setSourceUnit('Grams')
    setOutputTag('')
    setOutputItem('')
    setOutputQty('')
    setOutputUnit('Grams')
    setNote('')
  }

  const handleOpen = () => {
    resetForm()
    flow.open()
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const sq = parseFloat(sourceQty)
    const oq = parseFloat(outputQty)
    if (isNaN(sq) || sq <= 0 || isNaN(oq) || oq <= 0 || !sourceLabel || !outputTag || !outputItem) return
    flow.preview({
      facilityId,
      sourcePackages: [{ label: sourceLabel, quantity: sq, unitOfMeasure: sourceUnit }],
      outputTag,
      outputItemName: outputItem,
      outputQuantity: oq,
      outputUnitOfMeasure: outputUnit,
      note: note || undefined,
    })
  }

  return (
    <>
      <Button onClick={handleOpen} size="sm">
        <Plus className="h-4 w-4 mr-1" />
        Create Package
      </Button>

      <MutationDialog
        title="Create Processing Package"
        description="Create a new package from source materials."
        flow={flow}
        size="lg"
        formContent={
          <form id="mutation-form" onSubmit={handleFormSubmit} className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Source Package</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2 col-span-1">
                <Label htmlFor="srcLabel">Package Label</Label>
                <Input id="srcLabel" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="Full Metrc label..." required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="srcQty">Quantity</Label>
                <Input id="srcQty" type="number" step="0.01" min="0.01" value={sourceQty} onChange={(e) => setSourceQty(e.target.value)} placeholder="0.00" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="srcUnit">Unit</Label>
                <select
                  id="srcUnit"
                  value={sourceUnit}
                  onChange={(e) => setSourceUnit(e.target.value)}
                  className={cn(
                    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                    'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                >
                  <option value="Grams">Grams</option>
                  <option value="Ounces">Ounces</option>
                  <option value="Pounds">Pounds</option>
                  <option value="Kilograms">Kilograms</option>
                  <option value="Each">Each</option>
                </select>
              </div>
            </div>

            <div className="space-y-1 pt-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Output Package</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="outTag">Output Tag</Label>
                <Input id="outTag" value={outputTag} onChange={(e) => setOutputTag(e.target.value)} placeholder="Metrc tag..." required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="outItem">Item Name</Label>
                <Input id="outItem" value={outputItem} onChange={(e) => setOutputItem(e.target.value)} placeholder="e.g., Live Resin 1g" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="outQty">Output Quantity</Label>
                <Input id="outQty" type="number" step="0.01" min="0.01" value={outputQty} onChange={(e) => setOutputQty(e.target.value)} placeholder="0.00" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="outUnit">Unit</Label>
                <select
                  id="outUnit"
                  value={outputUnit}
                  onChange={(e) => setOutputUnit(e.target.value)}
                  className={cn(
                    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                    'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                >
                  <option value="Grams">Grams</option>
                  <option value="Ounces">Ounces</option>
                  <option value="Pounds">Pounds</option>
                  <option value="Kilograms">Kilograms</option>
                  <option value="Each">Each</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="note">Note (optional)</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Processing notes..." />
            </div>
          </form>
        }
        previewContent={(previews) => {
          const p = previews[0]!
          return (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Sources</p>
                {p.sources.map((s) => (
                  <div key={s.label} className="flex justify-between text-sm">
                    <span className="font-mono text-xs truncate max-w-[200px]">{s.label}</span>
                    <span>{s.requestedQty} / {s.availableQty} {s.unit}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Output</p>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tag</span>
                  <span className="font-mono text-xs">{p.output.tag}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Item</span>
                  <span className="font-medium">{p.output.itemName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Quantity</span>
                  <span className="font-bold">{p.output.quantity} {p.output.unitOfMeasure}</span>
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
