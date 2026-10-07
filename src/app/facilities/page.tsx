'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Building2, Plus, Star } from 'lucide-react'
import { AddFacilityWizard } from '@/features/facilities/components/AddFacilityWizard'
import {
  FacilityToolbar,
  type FacilityFilters,
  DEFAULT_STATUSES,
} from '@/features/facilities/components/FacilityToolbar'
import { FacilityGridCard } from '@/features/facilities/components/FacilityGridCard'
import { FacilityListRow } from '@/features/facilities/components/FacilityListRow'
import {
  FacilityTable,
  type SortState,
  type SortField,
  type SortDirection,
} from '@/features/facilities/components/FacilityTable'
import { useFacilityPreferences } from '@/shared/hooks/useFacilityPreferences'
import { Skeleton } from '@/shared/components/ui/skeleton'
import type { FacilityItem, FacilityWithHealth } from '@/features/facilities/types'

export default function FacilitiesPage() {
  const [showWizard, setShowWizard] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  const utils = trpc.useUtils()
  const { data: rawFacilities, isLoading } = trpc.facility.listWithHealth.useQuery(
    { includeInactive: true },
    { staleTime: 300_000 }
  )
  const facilitiesWithHealth = useMemo(
    () => (rawFacilities ?? []) as FacilityWithHealth[],
    [rawFacilities],
  )
  const facilities: FacilityItem[] = facilitiesWithHealth

  // Build alert-count map for table view and sorting
  const alertCountMap = useMemo(
    () => new Map(facilitiesWithHealth.map((f) => [f.id, f.alertCount])),
    [facilitiesWithHealth],
  )

  const {
    pinnedIds,
    viewMode,
    togglePin,
    setViewMode,
  } = useFacilityPreferences()

  // --- URL state for filters ---
  const urlQuery = searchParams?.get('q') ?? ''
  const urlStates = searchParams?.getAll('state') ?? []
  const urlTypes = searchParams?.getAll('type') ?? []
  const urlEnvs = searchParams?.getAll('env') ?? []
  const urlStatusesRaw = searchParams?.getAll('status') ?? []
  const urlStatuses = urlStatusesRaw.length > 0 ? urlStatusesRaw : DEFAULT_STATUSES
  const urlSortField = (searchParams?.get('sort') ?? 'name') as SortField
  const urlSortDir = (searchParams?.get('dir') ?? 'asc') as SortDirection

  const [query, setQuery] = useState(urlQuery)
  const [filters, setFilters] = useState<FacilityFilters>({
    states: urlStates,
    types: urlTypes,
    environments: urlEnvs,
    statuses: urlStatuses,
  })
  const [sort, setSort] = useState<SortState>({
    field: urlSortField,
    direction: urlSortDir,
  })

  // Adaptive default: if more than 20 facilities, default to list view (only on first load)
  const [hasSetAdaptiveDefault, setHasSetAdaptiveDefault] = useState(false)
  useEffect(() => {
    if (!isLoading && facilities.length > 20 && !hasSetAdaptiveDefault) {
      // Only override if user hasn't explicitly stored a preference
      const stored = typeof window !== 'undefined' ? localStorage.getItem('f8-facilities-view') : null
      if (!stored) {
        setViewMode('list')
      }
      setHasSetAdaptiveDefault(true)
    }
  }, [isLoading, facilities.length, hasSetAdaptiveDefault, setViewMode])

  // Sync state back to URL
  const updateUrl = useCallback(
    (newQuery: string, newFilters: FacilityFilters, newSort: SortState) => {
      const params = new URLSearchParams()
      if (newQuery) params.set('q', newQuery)
      newFilters.states.forEach((s) => params.append('state', s))
      newFilters.types.forEach((t) => params.append('type', t))
      newFilters.environments.forEach((e) => params.append('env', e))
      newFilters.statuses.forEach((s) => params.append('status', s))
      if (newSort.field !== 'name') params.set('sort', newSort.field)
      if (newSort.direction !== 'asc') params.set('dir', newSort.direction)
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : '/facilities', { scroll: false })
    },
    [router],
  )

  const handleQueryChange = useCallback(
    (q: string) => {
      setQuery(q)
      updateUrl(q, filters, sort)
    },
    [filters, sort, updateUrl],
  )

  const handleFiltersChange = useCallback(
    (f: FacilityFilters) => {
      setFilters(f)
      updateUrl(query, f, sort)
    },
    [query, sort, updateUrl],
  )

  const handleSortChange = useCallback(
    (s: SortState) => {
      setSort(s)
      updateUrl(query, filters, s)
    },
    [query, filters, updateUrl],
  )

  // --- Compute available filter options from data ---
  const availableStates = useMemo(
    () => Array.from(new Set(facilities.map((f) => f.stateCode))).sort(),
    [facilities],
  )

  const availableTypes = useMemo(
    () =>
      Array.from(
        new Set(
          facilities
            .map((f) => f.facilityType)
            .filter((t): t is string => t !== null),
        ),
      ).sort(),
    [facilities],
  )

  // --- Client-side filtering pipeline ---
  const filtered = useMemo(() => {
    let result = facilities

    // Search query
    if (query) {
      const q = query.toLowerCase()
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.licenseNumber.toLowerCase().includes(q) ||
          f.stateCode.toLowerCase().includes(q) ||
          (f.facilityType?.toLowerCase().includes(q) ?? false),
      )
    }

    // State filter
    if (filters.states.length > 0) {
      result = result.filter((f) => filters.states.includes(f.stateCode))
    }

    // Type filter
    if (filters.types.length > 0) {
      result = result.filter(
        (f) => f.facilityType !== null && filters.types.includes(f.facilityType),
      )
    }

    // Environment filter
    if (filters.environments.length > 0) {
      result = result.filter((f) =>
        filters.environments.includes(f.metrcEnvironment),
      )
    }

    // Status filter
    if (filters.statuses.length > 0) {
      result = result.filter((f) => {
        const status = f.isActive ? 'active' : 'inactive'
        return filters.statuses.includes(status)
      })
    }

    // Sort
    result = [...result].sort((a, b) => {
      const dir = sort.direction === 'asc' ? 1 : -1
      switch (sort.field) {
        case 'name':
          return a.name.localeCompare(b.name) * dir
        case 'stateCode':
          return a.stateCode.localeCompare(b.stateCode) * dir
        case 'facilityType':
          return (a.facilityType ?? '').localeCompare(b.facilityType ?? '') * dir
        case 'metrcEnvironment':
          return a.metrcEnvironment.localeCompare(b.metrcEnvironment) * dir
        case 'lastSyncAt': {
          const aTime = a.lastSyncAt ? new Date(a.lastSyncAt).getTime() : 0
          const bTime = b.lastSyncAt ? new Date(b.lastSyncAt).getTime() : 0
          return (aTime - bTime) * dir
        }
        case 'isActive':
          return (Number(a.isActive) - Number(b.isActive)) * dir
        case 'alertCount': {
          const aCount = alertCountMap.get(a.id) ?? 0
          const bCount = alertCountMap.get(b.id) ?? 0
          return (aCount - bCount) * dir
        }
        default:
          return 0
      }
    })

    return result
  }, [facilities, query, filters, sort, alertCountMap])

  // --- Pinned facilities ---
  const pinnedFacilities = useMemo(
    () => filtered.filter((f) => pinnedIds.has(f.id)),
    [filtered, pinnedIds],
  )

  const unpinnedFacilities = useMemo(
    () => filtered.filter((f) => !pinnedIds.has(f.id)),
    [filtered, pinnedIds],
  )

  const showPinnedSection = pinnedFacilities.length > 0 && facilities.length > 3

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Facilities</h1>
          <p className="text-muted-foreground mt-1">
            Manage your Metrc-connected facilities
          </p>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Facility
        </button>
      </div>

      {/* Toolbar */}
      {!isLoading && facilities.length > 0 && (
        <FacilityToolbar
          query={query}
          onQueryChange={handleQueryChange}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          facilityCount={facilities.length}
          filteredCount={filtered.length}
          availableStates={availableStates}
          availableTypes={availableTypes}
        />
      )}

      {/* Content */}
      <div className="mt-6">
        {isLoading ? (
          <LoadingSkeletons viewMode={viewMode} />
        ) : facilities.length === 0 ? (
          /* Empty state */
          <div className="card-modern p-12 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Facilities Yet</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Add your first facility to start tracking Metrc inventory and
              compliance data. You can start in mock mode without API
              credentials.
            </p>
            <button
              onClick={() => setShowWizard(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Your First Facility
            </button>
          </div>
        ) : filtered.length === 0 ? (
          /* No results after filtering */
          <div className="card-modern p-12 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Matching Facilities</h3>
            <p className="text-muted-foreground mb-4 max-w-md mx-auto">
              No facilities match your current filters. Try adjusting your search
              or clearing filters.
            </p>
          </div>
        ) : (
          <>
            {/* Pinned section */}
            {showPinnedSection && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Pinned
                  </h2>
                </div>
                <FacilityViewRenderer
                  viewMode={viewMode}
                  facilities={pinnedFacilities}
                  pinnedIds={pinnedIds}
                  onTogglePin={togglePin}
                  sort={sort}
                  onSortChange={handleSortChange}
                  alertCounts={alertCountMap}
                />
              </div>
            )}

            {/* All Facilities */}
            <div>
              {showPinnedSection && (
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  All Facilities
                </h2>
              )}
              <FacilityViewRenderer
                viewMode={viewMode}
                facilities={showPinnedSection ? unpinnedFacilities : filtered}
                pinnedIds={pinnedIds}
                onTogglePin={togglePin}
                sort={sort}
                onSortChange={handleSortChange}
                alertCounts={alertCountMap}
              />
            </div>
          </>
        )}
      </div>

      <AddFacilityWizard
        open={showWizard}
        onOpenChange={setShowWizard}
        onSuccess={() => utils.facility.listWithHealth.invalidate()}
      />
    </div>
  )
}

/* ---------- View-mode renderer ---------- */

function FacilityViewRenderer({
  viewMode,
  facilities,
  pinnedIds,
  onTogglePin,
  sort,
  onSortChange,
  alertCounts,
}: {
  viewMode: 'grid' | 'list' | 'table'
  facilities: FacilityItem[]
  pinnedIds: Set<string>
  onTogglePin: (id: string) => void
  sort: SortState
  onSortChange: (sort: SortState) => void
  alertCounts?: Map<string, number>
}) {
  if (viewMode === 'table') {
    return (
      <FacilityTable
        facilities={facilities}
        pinnedIds={pinnedIds}
        onTogglePin={onTogglePin}
        sort={sort}
        onSortChange={onSortChange}
        alertCounts={alertCounts}
      />
    )
  }

  if (viewMode === 'list') {
    return (
      <div className="space-y-2">
        {facilities.map((f) => (
          <FacilityListRow
            key={f.id}
            facility={f}
            isPinned={pinnedIds.has(f.id)}
            onTogglePin={onTogglePin}
            alertCount={alertCounts?.get(f.id)}
          />
        ))}
      </div>
    )
  }

  // Grid view (default)
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {facilities.map((f) => (
        <FacilityGridCard
          key={f.id}
          facility={f}
          isPinned={pinnedIds.has(f.id)}
          onTogglePin={onTogglePin}
          alertCount={alertCounts?.get(f.id)}
        />
      ))}
    </div>
  )
}

/* ---------- Loading skeletons ---------- */

function LoadingSkeletons({ viewMode }: { viewMode: 'grid' | 'list' | 'table' }) {
  if (viewMode === 'table') {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (viewMode === 'list') {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  // Grid
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card-facility p-4 space-y-3">
          <div className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-8 rounded-md" />
            <Skeleton className="h-5 w-16 rounded-md" />
          </div>
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  )
}
