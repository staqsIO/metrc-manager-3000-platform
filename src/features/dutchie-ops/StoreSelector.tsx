'use client'

import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Building2, Check, AlertCircle } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'

interface Props {
  activeFacilityId: string
  selected: string[]
  onChange: (ids: string[]) => void
  onProceed: (ids: string[]) => void
}

export default function StoreSelector({ activeFacilityId, selected, onChange, onProceed }: Props) {
  const { data: facilities, isLoading } = trpc.facility.list.useQuery(undefined, {
    staleTime: 60_000,
  })

  // Filter to facilities with Dutchie configured
  const dutchieFacilities = (facilities ?? []).filter(
    (f: { dutchieEnvironment?: string }) => f.dutchieEnvironment && f.dutchieEnvironment !== ''
  )

  const toggleFacility = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  const canProceed = selected.length >= 1 && selected.length <= 20

  const selectAll = () => onChange(dutchieFacilities.map((f: { id: string }) => f.id))
  const deselectAll = () => onChange([])

  if (isLoading) {
    return (
      <div className="card-modern p-8 text-center text-muted-foreground">
        Loading facilities...
      </div>
    )
  }

  if (dutchieFacilities.length === 0) {
    return (
      <div className="card-modern p-8">
        <div className="flex items-center gap-3 text-amber-500">
          <AlertCircle className="h-5 w-5" />
          <div>
            <p className="font-medium">No Dutchie-enabled facilities</p>
            <p className="text-sm text-muted-foreground mt-1">
              Bulk operations require at least 1 facility with Dutchie configured.
              Configure Dutchie API keys in Settings.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card-modern p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium">Select stores</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className="text-xs text-primary hover:underline"
            >
              Select All
            </button>
            <span className="text-xs text-muted-foreground">|</span>
            <button
              onClick={deselectAll}
              className="text-xs text-primary hover:underline"
            >
              Deselect All
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Choose 1+ Dutchie-enabled locations. Products will be matched by SKU then name.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {dutchieFacilities.map((facility: { id: string; name: string; metrcLicense?: string; dutchieEnvironment?: string; facilityType?: string; stateCode?: string }) => {
            const isSelected = selected.includes(facility.id)
            const isActive = facility.id === activeFacilityId
            return (
              <button
                key={facility.id}
                onClick={() => toggleFacility(facility.id)}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-accent/50',
                )}
              >
                <div className={cn(
                  'mt-0.5 flex h-5 w-5 items-center justify-center rounded border',
                  isSelected
                    ? 'bg-primary border-primary text-primary-foreground'
                    : 'border-muted-foreground/30',
                )}>
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm truncate">{facility.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[10px]">
                      {facility.dutchieEnvironment}
                    </Badge>
                    {facility.stateCode && (
                      <span className="text-xs text-muted-foreground">{facility.stateCode}</span>
                    )}
                    {facility.facilityType && (
                      <span className="text-xs text-muted-foreground">{facility.facilityType}</span>
                    )}
                    {isActive && (
                      <Badge className="text-[10px] bg-primary/10 text-primary border-none">Current</Badge>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {selected.length} of {dutchieFacilities.length} selected
        </p>
        <button
          onClick={() => onProceed(selected)}
          disabled={!canProceed}
          className={cn(
            'px-6 py-2 rounded-lg text-sm font-medium transition-colors',
            canProceed
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          Compare Products
        </button>
      </div>
    </div>
  )
}
