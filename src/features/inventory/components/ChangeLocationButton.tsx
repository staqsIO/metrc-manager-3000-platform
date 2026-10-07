'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { MutationDialog } from '@/shared/components/MutationDialog'
import { useMutationFlow } from '@/shared/hooks/useMutationFlow'
import { cn } from '@/lib/utils'
import { MapPin, Plus, Trash2 } from 'lucide-react'

interface ChangeLocationButtonProps {
  facilityId: string
  onSuccess?: () => void
}

interface MoveEntry {
  label: string
  locationId: string
}

export function ChangeLocationButton({ facilityId, onSuccess }: ChangeLocationButtonProps) {
  const [moves, setMoves] = useState<MoveEntry[]>([{ label: '', locationId: '' }])

  const { data: locations } = trpc.inventory.getLocations.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const utils = trpc.useUtils()
  const mutation = trpc.packages.changeLocations.useMutation()

  type PreviewData = {
    moveCount: number
    moves: Array<{ label: string; itemName: string; currentLocation: string; newLocation: string }>
  }

  const flow = useMutationFlow<
    Parameters<typeof mutation.mutateAsync>[0],
    PreviewData
  >({
    mutationFn: (input) => mutation.mutateAsync(input),
    getPreview: (result) => {
      const r = result as { preview: PreviewData }
      return [r.preview]
    },
    onSuccess: () => {
      utils.inventory.getActive.invalidate()
      utils.packages.fragmentation.invalidate()
      resetForm()
      onSuccess?.()
    },
  })

  const resetForm = () => {
    setMoves([{ label: '', locationId: '' }])
  }

  const handleOpen = () => {
    resetForm()
    flow.open()
  }

  const addMove = () => {
    setMoves(prev => [...prev, { label: '', locationId: '' }])
  }

  const removeMove = (index: number) => {
    setMoves(prev => prev.filter((_, i) => i !== index))
  }

  const updateMove = (index: number, field: keyof MoveEntry, value: string) => {
    setMoves(prev => prev.map((m, i) => i === index ? { ...m, [field]: value } : m))
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (moves.some(m => !m.label || !m.locationId)) return

    flow.preview({
      facilityId,
      moves: moves.map(m => ({
        label: m.label,
        locationId: parseInt(m.locationId, 10),
      })),
    })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen}>
        <MapPin className="h-4 w-4 mr-1" />
        Change Location
      </Button>

      <MutationDialog
        title="Change Package Locations"
        description="Move packages to a different location in Metrc"
        flow={flow}
        size="lg"
        formContent={
          <form id="mutation-form" onSubmit={handleFormSubmit} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Package Moves</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addMove}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Package
                </Button>
              </div>
              <div className="space-y-2">
                {moves.map((m, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_32px] gap-2 items-end">
                    <div className="space-y-1">
                      {i === 0 && <span className="text-xs text-muted-foreground">Package Label</span>}
                      <Input
                        value={m.label}
                        onChange={(e) => updateMove(i, 'label', e.target.value)}
                        placeholder="1A400..."
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      {i === 0 && <span className="text-xs text-muted-foreground">Destination</span>}
                      <select
                        value={m.locationId}
                        onChange={(e) => updateMove(i, 'locationId', e.target.value)}
                        required
                        className={cn(
                          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                          'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        )}
                      >
                        <option value="">Select location...</option>
                        {locations?.map((l: { Id: number; Name: string }) => (
                          <option key={l.Id} value={l.Id}>{l.Name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      {moves.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" className="h-10 w-8" onClick={() => removeMove(i)}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </form>
        }
        previewContent={(previews) => {
          const p = previews[0]!
          return (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Packages to Move</span>
                  <span className="font-medium">{p.moveCount}</span>
                </div>
                <div className="border-t border-border pt-2 space-y-2">
                  {p.moves.map((m, i) => (
                    <div key={i} className="text-sm">
                      <div className="flex justify-between">
                        <span className="font-mono text-xs">{m.label}</span>
                        <span className="text-muted-foreground">{m.itemName}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span>{m.currentLocation}</span>
                        <span>&rarr;</span>
                        <span className="font-medium text-foreground">{m.newLocation}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        }}
        confirmLabel="Move Packages"
      />
    </>
  )
}
