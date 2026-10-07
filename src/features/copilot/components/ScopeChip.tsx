'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Building2, Globe, ChevronDown, Check } from 'lucide-react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/shared/components/ui/command'
import { groupFacilitiesByState } from '@/shared/utils/group-facilities'
import type { FacilityItem } from '@/features/facilities/types'

/**
 * Scope chip for /copilot. Tells the user (and the LLM) whether the
 * current run is bounded to a single facility or operates org-wide.
 *
 * Updates `?facility=<id>` on the current pathname so the change applies
 * to whichever Copilot surface the user is on (`/copilot`, `/copilot/a/[id]`).
 * Clearing scope removes the param entirely.
 */
export function ScopeChip({ facilityId }: { facilityId: string | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)

  const { data: facilities } = trpc.facility.list.useQuery(undefined, {
    staleTime: 60_000,
  })
  const allFacilities = useMemo(() => (facilities ?? []) as FacilityItem[], [facilities])
  const currentFacility = allFacilities.find((f) => f.id === facilityId) ?? null

  const grouped = useMemo(() => groupFacilitiesByState(allFacilities), [allFacilities])
  const hasMultipleStates = grouped.length > 1

  const updateScope = useCallback(
    (nextFacilityId: string | null) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (nextFacilityId) {
        params.set('facility', nextFacilityId)
      } else {
        params.delete('facility')
      }
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname ?? '/copilot')
      setOpen(false)
    },
    [pathname, router, searchParams],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
            'border-border bg-card hover:bg-accent',
            currentFacility ? 'text-foreground' : 'text-muted-foreground',
          )}
          title={currentFacility ? 'Scoped to one facility — click to change' : 'Org-wide scope — click to narrow'}
        >
          {currentFacility ? (
            <Building2 className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Globe className="h-3.5 w-3.5" />
          )}
          <span className="max-w-[180px] truncate">
            {currentFacility ? currentFacility.name : 'All facilities'}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search facilities…" className="h-9" />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>No facilities found.</CommandEmpty>

            <CommandGroup heading="Scope">
              <CommandItem
                value="__org__ all facilities org wide"
                onSelect={() => updateScope(null)}
                className="gap-2"
              >
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1">All facilities (org-wide)</span>
                {!facilityId && <Check className="h-3.5 w-3.5 text-primary" />}
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            {grouped.map(([stateCode, facilitiesInState]) => (
              <CommandGroup
                key={stateCode}
                heading={hasMultipleStates ? stateCode : undefined}
              >
                {facilitiesInState.map((f: FacilityItem) => (
                  <CommandItem
                    key={f.id}
                    value={`${f.name} ${f.licenseNumber ?? ''} ${f.stateCode ?? ''}`}
                    onSelect={() => updateScope(f.id)}
                    className="gap-2"
                  >
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs truncate">{f.name}</div>
                      {f.licenseNumber && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {f.licenseNumber}
                        </div>
                      )}
                    </div>
                    {facilityId === f.id && <Check className="h-3.5 w-3.5 text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
