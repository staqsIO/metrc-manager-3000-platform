'use client'

import { useRouter, usePathname } from 'next/navigation'
import { Building2, ChevronDown, Plus, Check, Pin } from 'lucide-react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { FACILITY_TYPE_COLORS, isNavVisibleForType, getDefaultFacilityPage } from '@/shared/constants/facility-types'
import { useFacilityId } from '@/shared/hooks/useFacilityId'
import { useFacilityPreferences } from '@/shared/hooks/useFacilityPreferences'
import { getEnvironmentDotColor, getEnvironmentLabel } from '@/shared/utils/environment'
import { groupFacilitiesByState } from '@/shared/utils/group-facilities'
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
import type { FacilityItem } from '@/features/facilities/types'

export default function FacilitySwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const currentFacilityId = useFacilityId()
  const { pinnedIds, recentIds, togglePin, addRecent } = useFacilityPreferences()

  const { data: facilities, isLoading } = trpc.facility.list.useQuery()

  const allFacilities = useMemo(
    () => (facilities ?? []) as FacilityItem[],
    [facilities],
  )

  const currentFacility = allFacilities.find((f) => f.id === currentFacilityId)

  // Derive pinned facilities (in pinned order)
  const pinnedFacilities = useMemo(() => {
    if (pinnedIds.size === 0) return []
    return allFacilities.filter((f) => pinnedIds.has(f.id))
  }, [allFacilities, pinnedIds])

  // Derive recent facilities: last 3 visited, excluding pinned and current
  const recentFacilities = useMemo(() => {
    return recentIds
      .filter((id) => id !== currentFacilityId && !pinnedIds.has(id))
      .slice(0, 3)
      .map((id) => allFacilities.find((f) => f.id === id))
      .filter((f): f is FacilityItem => f != null)
  }, [recentIds, currentFacilityId, pinnedIds, allFacilities])

  // Group all facilities by state
  const groupedFacilities = useMemo(() => {
    if (allFacilities.length === 0) return []
    return groupFacilitiesByState(allFacilities)
  }, [allFacilities])

  const hasMultipleStates = groupedFacilities.length > 1

  // Alt+F keyboard shortcut to toggle the popover
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.altKey && e.key === 'f') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Navigate to the selected facility, preserving the current sub-path when possible
  const handleSelect = useCallback(
    (facilityId: string) => {
      setOpen(false)
      addRecent(facilityId)

      // Determine the target facility type for nav visibility check
      const targetFacility = allFacilities.find((f) => f.id === facilityId)

      const defaultPage = getDefaultFacilityPage(targetFacility?.facilityType)

      if (currentFacilityId && pathname) {
        const subPath = pathname.replace(`/facilities/${currentFacilityId}`, '')
        // Check if the target facility type supports the current sub-page
        const navPath = subPath.split('/').slice(0, 2).join('/') || defaultPage
        if (targetFacility && isNavVisibleForType(navPath, targetFacility.facilityType)) {
          router.push(`/facilities/${facilityId}${subPath || defaultPage}`)
        } else {
          router.push(`/facilities/${facilityId}${defaultPage}`)
        }
      } else {
        router.push(`/facilities/${facilityId}${defaultPage}`)
      }
    },
    [currentFacilityId, pathname, router, addRecent, allFacilities],
  )

  // Render a single facility item inside the command list
  function renderFacilityItem(facility: FacilityItem) {
    const isCurrent = facility.id === currentFacilityId
    return (
      <CommandItem
        key={facility.id}
        value={`${facility.name} ${facility.stateCode} ${facility.licenseNumber} ${facility.facilityType ?? ''}`}
        onSelect={() => handleSelect(facility.id)}
        className="flex items-center gap-2 px-2 py-1.5"
      >
        <div
          className={cn(
            'h-2 w-2 rounded-full shrink-0',
            getEnvironmentDotColor(facility.metrcEnvironment, facility.isActive),
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate">{facility.name}</span>
            {facility.facilityType && (
              <span
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded border shrink-0',
                  FACILITY_TYPE_COLORS[facility.facilityType] ??
                    'bg-muted text-muted-foreground border-border',
                )}
              >
                {facility.facilityType}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {facility.stateCode} - {facility.licenseNumber}
            {facility.metrcEnvironment !== 'production' &&
              ` (${getEnvironmentLabel(facility.metrcEnvironment)})`}
          </p>
        </div>
        {isCurrent && <Check className="h-4 w-4 text-primary shrink-0 ml-auto" />}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            togglePin(facility.id)
          }}
          className={cn(
            'shrink-0 p-0.5 rounded-sm hover:bg-accent transition-colors',
            pinnedIds.has(facility.id)
              ? 'text-primary'
              : 'text-muted-foreground/40 hover:text-muted-foreground',
          )}
          aria-label={pinnedIds.has(facility.id) ? 'Unpin facility' : 'Pin facility'}
        >
          <Pin className="h-3 w-3" />
        </button>
      </CommandItem>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
            'border border-border hover:bg-accent transition-colors',
            'text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          )}
          aria-label="Switch facility"
        >
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <span className="text-muted-foreground">Loading...</span>
            ) : currentFacility ? (
              <>
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      'h-2 w-2 rounded-full shrink-0',
                      getEnvironmentDotColor(
                        currentFacility.metrcEnvironment,
                        currentFacility.isActive,
                      ),
                    )}
                  />
                  <p className="font-medium truncate">{currentFacility.name}</p>
                </div>
                <p className="text-xs text-muted-foreground">{currentFacility.licenseNumber}</p>
              </>
            ) : (
              <span className="text-muted-foreground">Select facility</span>
            )}
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="p-0"
        align="start"
        sideOffset={4}
      >
        <Command>
          <CommandInput placeholder="Search facilities..." />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>No facilities found.</CommandEmpty>

            {/* Pinned/Recent sections are redundant with ≤3 facilities */}
            {allFacilities.length > 3 && pinnedFacilities.length > 0 && (
              <CommandGroup heading="Pinned">
                {pinnedFacilities.map(renderFacilityItem)}
              </CommandGroup>
            )}

            {allFacilities.length > 3 && recentFacilities.length > 0 && (
              <>
                {pinnedFacilities.length > 0 && <CommandSeparator />}
                <CommandGroup heading="Recent">
                  {recentFacilities.map(renderFacilityItem)}
                </CommandGroup>
              </>
            )}

            {/* All facilities - grouped by state or flat */}
            {allFacilities.length > 0 && (
              <>
                {allFacilities.length > 3 && (pinnedFacilities.length > 0 || recentFacilities.length > 0) && (
                  <CommandSeparator />
                )}
                {hasMultipleStates ? (
                  groupedFacilities.map(([state, stateFacilities]) => (
                    <CommandGroup key={state} heading={`${state} (${stateFacilities.length})`}>
                      {stateFacilities.map(renderFacilityItem)}
                    </CommandGroup>
                  ))
                ) : (
                  <CommandGroup heading="All Facilities">
                    {allFacilities.map(renderFacilityItem)}
                  </CommandGroup>
                )}
              </>
            )}

            {/* Empty state */}
            {allFacilities.length === 0 && !isLoading && (
              <div className="px-3 py-2 text-sm text-muted-foreground">No facilities yet</div>
            )}

            {/* Add Facility action */}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="add-facility"
                onSelect={() => {
                  setOpen(false)
                  router.push('/facilities')
                }}
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
                <span>Add Facility</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
