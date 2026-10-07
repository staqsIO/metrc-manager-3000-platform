'use client'

import { useCallback } from 'react'
import {
  Search,
  X,
  Grid3X3,
  List,
  TableProperties,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/shared/components/ui/dropdown-menu'
import { getEnvironmentLabel } from '@/shared/utils/environment'
import type { ViewMode } from '@/shared/hooks/useFacilityPreferences'

export interface FacilityFilters {
  states: string[]
  types: string[]
  environments: string[]
  statuses: string[]
}

export const DEFAULT_STATUSES = ['active']

export const EMPTY_FILTERS: FacilityFilters = {
  states: [],
  types: [],
  environments: [],
  statuses: DEFAULT_STATUSES,
}

const ENVIRONMENT_OPTIONS = ['production', 'sandbox', 'mock', 'none'] as const
const STATUS_OPTIONS = ['active', 'inactive'] as const

interface FacilityToolbarProps {
  query: string
  onQueryChange: (query: string) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  filters: FacilityFilters
  onFiltersChange: (filters: FacilityFilters) => void
  facilityCount: number
  filteredCount: number
  availableStates: string[]
  availableTypes: string[]
}

export function FacilityToolbar({
  query,
  onQueryChange,
  viewMode,
  onViewModeChange,
  filters,
  onFiltersChange,
  facilityCount,
  filteredCount,
  availableStates,
  availableTypes,
}: FacilityToolbarProps) {
  // Don't count the default status filter (['active']) as an active filter
  const isDefaultStatus = filters.statuses.length === 1 && filters.statuses[0] === 'active'
  const activeFilterCount =
    filters.states.length +
    filters.types.length +
    filters.environments.length +
    (isDefaultStatus ? 0 : filters.statuses.length)

  const isFiltered = activeFilterCount > 0 || query.length > 0

  const toggleFilterValue = useCallback(
    (
      key: keyof FacilityFilters,
      value: string,
    ) => {
      onFiltersChange({
        ...filters,
        [key]: filters[key].includes(value)
          ? filters[key].filter((v) => v !== value)
          : [...filters[key], value],
      })
    },
    [filters, onFiltersChange],
  )

  const clearFilters = useCallback(() => {
    onFiltersChange(EMPTY_FILTERS)
    onQueryChange('')
  }, [onFiltersChange, onQueryChange])

  return (
    <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/50 -mx-8 px-8 py-3">
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search facilities..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Search facilities"
            className="flex h-9 w-full rounded-lg border border-border/50 bg-muted/30 pl-9 pr-8 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {query && (
            <button
              onClick={() => onQueryChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter dropdowns */}
        <div className="flex items-center gap-1.5">
          <FilterDropdown
            label="State"
            options={availableStates}
            selected={filters.states}
            onToggle={(v) => toggleFilterValue('states', v)}
          />
          <FilterDropdown
            label="Type"
            options={availableTypes}
            selected={filters.types}
            onToggle={(v) => toggleFilterValue('types', v)}
          />
          <FilterDropdown
            label="Environment"
            options={[...ENVIRONMENT_OPTIONS]}
            selected={filters.environments}
            onToggle={(v) => toggleFilterValue('environments', v)}
            formatLabel={getEnvironmentLabel}
          />
          <FilterDropdown
            label="Status"
            options={[...STATUS_OPTIONS]}
            selected={filters.statuses}
            onToggle={(v) => toggleFilterValue('statuses', v)}
            formatLabel={statusLabel}
          />
        </div>

        {/* Active filters indicator */}
        {isFiltered && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {filteredCount} of {facilityCount}
            </span>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
                Clear {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* View toggle */}
        <div className="view-toggle" role="radiogroup" aria-label="View mode">
          <ViewToggleButton
            active={viewMode === 'grid'}
            onClick={() => onViewModeChange('grid')}
            icon={<Grid3X3 className="h-4 w-4" />}
            label="Grid view"
          />
          <ViewToggleButton
            active={viewMode === 'list'}
            onClick={() => onViewModeChange('list')}
            icon={<List className="h-4 w-4" />}
            label="List view"
          />
          <ViewToggleButton
            active={viewMode === 'table'}
            onClick={() => onViewModeChange('table')}
            icon={<TableProperties className="h-4 w-4" />}
            label="Table view"
          />
        </div>
      </div>
    </div>
  )
}

/* ---------- Sub-components ---------- */

function ViewToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      role="radio"
      aria-checked={active}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center h-7 w-7 rounded-md transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
    </button>
  )
}

function FilterDropdown({
  label,
  options,
  selected,
  onToggle,
  formatLabel,
}: {
  label: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  formatLabel?: (value: string) => string
}) {
  if (options.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1.5 h-9 rounded-lg border px-3 text-sm transition-colors',
            selected.length > 0
              ? 'border-primary/40 bg-primary/5 text-foreground'
              : 'border-border/50 bg-muted/30 text-muted-foreground hover:text-foreground',
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {label}
          {selected.length > 0 && (
            <span className="flex items-center justify-center h-4 min-w-[1rem] rounded-full bg-primary/20 text-[10px] font-medium text-primary px-1">
              {selected.length}
            </span>
          )}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option}
            checked={selected.includes(option)}
            onCheckedChange={() => onToggle(option)}
          >
            {formatLabel ? formatLabel(option) : option}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ---------- Helpers ---------- */

function statusLabel(status: string): string {
  return status === 'active' ? 'Active' : 'Inactive'
}
