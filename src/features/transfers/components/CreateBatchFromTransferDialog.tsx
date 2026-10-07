'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { trpc } from '@/lib/trpc-client'
import { MutationDialog } from '@/shared/components/MutationDialog'
import { useMutationFlow } from '@/shared/hooks/useMutationFlow'
import { Input } from '@/shared/components/ui/input'
import { Loader2 } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type DeliveryPackageItem = inferRouterOutputs<AppRouter>['transfers']['getDeliveryPackages'][number]

interface CreateBatchFromTransferDialogProps {
  facilityId: string
  transferId: number
  manifestNumber?: string
  deliveryId: number
  open: boolean
  onClose: () => void
}

type BatchPreview = {
  sources: Array<{
    label: string
    found: boolean
    itemName: string
    category?: string
    availableQty: number
    requestedQty: number
    unit: string
  }>
  output: {
    tag: string
    itemName: string
    quantity: number
    unitOfMeasure: string
  }
  note: string
  transferId: number
  manifestNumber?: string
}

interface SourcePackage {
  label: string
  quantity: number
  unitOfMeasure: string
  itemName: string
  category: string
}

export function CreateBatchFromTransferDialog({
  facilityId,
  transferId,
  manifestNumber,
  deliveryId,
  open,
  onClose,
}: CreateBatchFromTransferDialogProps) {
  const utils = trpc.useUtils()
  const mutation = trpc.processing.createBatchFromTransfer.useMutation()

  // Fetch delivery packages
  const { data: packages, isLoading: packagesLoading } = trpc.transfers.getDeliveryPackages.useQuery(
    { facilityId, deliveryId },
    { enabled: open, staleTime: 300_000 }
  )

  // Fetch FIFO tag suggestion
  const { data: nextTag } = trpc.tags.getNextAvailable.useQuery(
    { facilityId, count: 1 },
    { enabled: open, staleTime: 30_000 }
  )

  // Fetch items for output item name suggestions
  const { data: itemsData } = trpc.catalog.getItems.useQuery(
    { facilityId, pageSize: 100 },
    { enabled: open, staleTime: 60_000 }
  )

  // Form state
  const [outputTag, setOutputTag] = useState('')
  const [outputItemName, setOutputItemName] = useState('')
  const [outputQuantity, setOutputQuantity] = useState<number>(0)
  const [outputUnitOfMeasure, setOutputUnitOfMeasure] = useState('Grams')
  const [note, setNote] = useState('')

  // Pre-fill FIFO tag when available
  useEffect(() => {
    if (nextTag?.tags?.[0] && !outputTag) {
      setOutputTag(nextTag.tags[0].label)
    }
  }, [nextTag, outputTag])

  // Build source packages from delivery packages (accepted only)
  const sourcePackages: SourcePackage[] = useMemo(() => {
    if (!packages) return []
    return packages
      .filter((p: DeliveryPackageItem) => p.shipmentPackageState === 'Accepted')
      .map((p: DeliveryPackageItem) => ({
        label: p.packageLabel,
        quantity: p.quantity,
        unitOfMeasure: p.unitOfMeasure,
        itemName: p.itemName,
        category: p.itemCategory,
      }))
  }, [packages])

  // Auto-fill output quantity as sum of source quantities when they share the same UoM
  const hasAutoFilled = useRef(false)
  useEffect(() => {
    if (sourcePackages.length > 0 && !hasAutoFilled.current) {
      hasAutoFilled.current = true
      const firstUnit = sourcePackages[0].unitOfMeasure
      const allSameUnit = sourcePackages.every(p => p.unitOfMeasure === firstUnit)
      if (allSameUnit) {
        const total = sourcePackages.reduce((sum, p) => sum + p.quantity, 0)
        setOutputQuantity(total)
        setOutputUnitOfMeasure(firstUnit)
      }
    }
  }, [sourcePackages])

  const flow = useMutationFlow<
    {
      facilityId: string
      transferId: number
      manifestNumber?: string
      sourcePackages: Array<{ label: string; quantity: number; unitOfMeasure: string }>
      outputTag: string
      outputItemName: string
      outputQuantity: number
      outputUnitOfMeasure: string
      note?: string
    },
    BatchPreview
  >({
    mutationFn: (input) => mutation.mutateAsync(input),
    getPreview: (result) => [(result as { preview: BatchPreview }).preview],
    onSuccess: () => {
      utils.transfers.getDeliveries.invalidate()
      utils.transfers.getDeliveryPackages.invalidate()
      utils.processing.invalidate()
      onClose()
    },
  })

  // Open flow to form step when dialog opens
  useEffect(() => {
    if (open && flow.step === 'idle') {
      flow.open()
    }
  }, [open, flow.step, flow.open])

  const wrappedFlow = useMemo(() => ({
    ...flow,
    reset: () => {
      flow.reset()
      setOutputTag('')
      setOutputItemName('')
      setOutputQuantity(0)
      setOutputUnitOfMeasure('Grams')
      setNote('')
      onClose()
    },
  }), [flow, onClose])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (sourcePackages.length === 0 || !outputTag || !outputItemName || outputQuantity <= 0) return

    flow.preview({
      facilityId,
      transferId,
      manifestNumber,
      sourcePackages: sourcePackages.map(p => ({
        label: p.label,
        quantity: p.quantity,
        unitOfMeasure: p.unitOfMeasure,
      })),
      outputTag,
      outputItemName,
      outputQuantity,
      outputUnitOfMeasure,
      note: note || undefined,
    })
  }

  const suggestedTag = nextTag?.tags?.[0]?.label

  return (
    <MutationDialog
      title="Create Processing Batch from Transfer"
      description={`Create a new package from accepted packages in ${manifestNumber ? `Manifest #${manifestNumber}` : `Transfer #${transferId}`}`}
      flow={wrappedFlow}
      size="lg"
      formContent={
        packagesLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sourcePackages.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No accepted packages found in this delivery.
          </div>
        ) : (
          <form id="mutation-form" onSubmit={handleSubmit} className="space-y-4">
            {/* Source Packages */}
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Source Packages ({sourcePackages.length})
              </label>
              <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
                {sourcePackages.map((p) => (
                  <div key={p.label} className="flex items-center justify-between text-sm px-3 py-1.5 rounded border border-border/50 bg-muted/20">
                    <div>
                      <span className="font-mono text-xs">{p.label}</span>
                      <span className="ml-2 text-muted-foreground">{p.itemName}</span>
                    </div>
                    <span className="text-muted-foreground">
                      {(p.quantity ?? 0).toLocaleString()} {p.unitOfMeasure}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Output Tag */}
            <div>
              <label htmlFor="outputTag" className="text-sm font-medium">Output Tag</label>
              {suggestedTag && outputTag === suggestedTag && (
                <span className="ml-2 text-xs text-muted-foreground">(FIFO suggested)</span>
              )}
              <Input
                id="outputTag"
                value={outputTag}
                onChange={(e) => setOutputTag(e.target.value)}
                placeholder="Enter package tag..."
                className="mt-1"
                required
              />
            </div>

            {/* Output Item Name */}
            <div>
              <label htmlFor="outputItemName" className="text-sm font-medium">Output Item Name</label>
              <Input
                id="outputItemName"
                value={outputItemName}
                onChange={(e) => setOutputItemName(e.target.value)}
                placeholder="e.g., Distillate - OG Kush"
                list="item-suggestions"
                className="mt-1"
                required
              />
              {itemsData?.items && (
                <datalist id="item-suggestions">
                  {itemsData.items.map((item) => (
                    <option key={item.id} value={item.name} />
                  ))}
                </datalist>
              )}
            </div>

            {/* Output Quantity + Unit */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="outputQuantity" className="text-sm font-medium">Output Quantity</label>
                <Input
                  id="outputQuantity"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={outputQuantity || ''}
                  onChange={(e) => setOutputQuantity(parseFloat(e.target.value) || 0)}
                  className="mt-1"
                  required
                />
              </div>
              <div>
                <label htmlFor="outputUom" className="text-sm font-medium">Unit of Measure</label>
                <Input
                  id="outputUom"
                  value={outputUnitOfMeasure}
                  onChange={(e) => setOutputUnitOfMeasure(e.target.value)}
                  placeholder="Grams"
                  className="mt-1"
                  required
                />
              </div>
            </div>

            {/* Note */}
            <div>
              <label htmlFor="note" className="text-sm font-medium">Note (optional)</label>
              <Input
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Processing details..."
                className="mt-1"
              />
            </div>
          </form>
        )
      }
      previewContent={(previews) => {
        const preview = previews[0]
        if (!preview) return null
        return (
          <div className="space-y-4">
            {/* Sources */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Source Packages</p>
              <div className="space-y-1">
                {preview.sources.map((s) => (
                  <div key={s.label} className="flex items-center justify-between text-sm px-3 py-1.5 rounded border border-border/50">
                    <div>
                      <span className="font-mono text-xs">{s.label}</span>
                      <span className="ml-2 text-muted-foreground">{s.itemName}</span>
                    </div>
                    <span className={s.found ? 'text-muted-foreground' : 'text-destructive'}>
                      {(s.requestedQty ?? 0).toLocaleString()} / {(s.availableQty ?? 0).toLocaleString()} {s.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Output */}
            <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Output Package</p>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tag</span>
                <span className="font-mono text-xs">{preview.output.tag}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Item</span>
                <span className="font-medium">{preview.output.itemName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Quantity</span>
                <span className="font-medium">{(preview.output.quantity ?? 0).toLocaleString()} {preview.output.unitOfMeasure}</span>
              </div>
            </div>

            {/* Note */}
            {preview.note && (
              <div className="text-sm text-muted-foreground">
                <span className="text-xs font-medium">Note:</span> {preview.note}
              </div>
            )}
          </div>
        )
      }}
      confirmLabel="Create Processing Batch"
    />
  )
}
