'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { AlertTriangle, Star, ArrowUpDown, ArrowUp, ArrowDown, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/shared/components/ui/table'
import { FACILITY_TYPE_COLORS, getDefaultFacilityPage } from '@/shared/constants/facility-types'
import { getEnvironmentLabel } from '@/shared/utils/environment'
import type { FacilityItem } from '@/features/facilities/types'
import { SyncStatusIndicator } from '@/features/facilities/components/SyncStatusIndicator'

export type SortField =
  | 'name'
  | 'stateCode'
  | 'facilityType'
  | 'metrcEnvironment'
  | 'lastSyncAt'
  | 'isActive'
  | 'alertCount'

export type SortDirection = 'asc' | 'desc'

export interface SortState {
  field: SortField
  direction: SortDirection
}

interface FacilityTableProps {
  facilities: FacilityItem[]
  pinnedIds: Set<string>
  onTogglePin: (id: string) => void
  sort: SortState
  onSortChange: (sort: SortState) => void
  /** Map of facilityId -> open alert count. When provided, shows an Alerts column. */
  alertCounts?: Map<string, number>
}

export function FacilityTable({
  facilities,
  pinnedIds,
  onTogglePin,
  sort,
  onSortChange,
  alertCounts,
}: FacilityTableProps) {
  const handleSort = useCallback(
    (field: SortField) => {
      onSortChange({
        field,
        direction:
          sort.field === field && sort.direction === 'asc' ? 'desc' : 'asc',
      })
    },
    [sort, onSortChange],
  )

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-border/20 hover:bg-transparent">
          {/* Pin — not sortable */}
          <TableHead className="w-10" />
          <SortableHeader
            label="Name"
            field="name"
            sort={sort}
            onSort={handleSort}
          />
          <SortableHeader
            label="State"
            field="stateCode"
            sort={sort}
            onSort={handleSort}
            className="hidden sm:table-cell"
          />
          <SortableHeader
            label="Type"
            field="facilityType"
            sort={sort}
            onSort={handleSort}
            className="hidden md:table-cell"
          />
          <SortableHeader
            label="Environment"
            field="metrcEnvironment"
            sort={sort}
            onSort={handleSort}
            className="hidden lg:table-cell"
          />
          <SortableHeader
            label="Last Sync"
            field="lastSyncAt"
            sort={sort}
            onSort={handleSort}
            className="hidden lg:table-cell"
          />
          {alertCounts && (
            <SortableHeader
              label="Alerts"
              field="alertCount"
              sort={sort}
              onSort={handleSort}
              className="w-20"
            />
          )}
          <SortableHeader
            label="Status"
            field="isActive"
            sort={sort}
            onSort={handleSort}
            className="hidden sm:table-cell"
          />
        </TableRow>
      </TableHeader>
      <TableBody className="divide-y divide-border/20">
        {facilities.map((facility) => {
          const isPinned = pinnedIds.has(facility.id)
          const typeColor =
            FACILITY_TYPE_COLORS[facility.facilityType ?? ''] ??
            'bg-muted text-muted-foreground border-border'
          const activeKeyAccess = facility.metrcEnvironment === 'sandbox'
            ? facility.sandboxMetrcKeyAccess
            : facility.metrcKeyAccess
          const isReadOnly = activeKeyAccess === 'readonly'

          return (
            <TableRow
              key={facility.id}
              className="border-0 hover:bg-card/40 transition-colors"
            >
              {/* Pin */}
              <TableCell className="w-10 pr-0">
                <button
                  onClick={() => onTogglePin(facility.id)}
                  className={cn(
                    'flex items-center justify-center h-6 w-6 rounded transition-colors',
                    isPinned
                      ? 'text-yellow-500 hover:text-yellow-400'
                      : 'text-muted-foreground/30 hover:text-muted-foreground',
                  )}
                  aria-label={isPinned ? 'Unpin facility' : 'Pin facility'}
                >
                  <Star
                    className={cn('h-3.5 w-3.5', isPinned && 'fill-current')}
                  />
                </button>
              </TableCell>

              {/* Name + license */}
              <TableCell>
                <Link
                  href={`/facilities/${facility.id}${getDefaultFacilityPage(facility.facilityType)}`}
                  className="hover:underline"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm">{facility.name}</span>
                    {isReadOnly && (
                      <span title="Read-only Metrc key">
                        <Lock className="h-3 w-3 text-amber-400 shrink-0" />
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {facility.licenseNumber}
                  </div>
                </Link>
              </TableCell>

              {/* State */}
              <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                {facility.stateCode}
              </TableCell>

              {/* Type */}
              <TableCell className="hidden md:table-cell">
                {facility.facilityType ? (
                  <span
                    className={cn(
                      'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                      typeColor,
                    )}
                  >
                    {facility.facilityType}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">--</span>
                )}
              </TableCell>

              {/* Environment */}
              <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                {getEnvironmentLabel(facility.metrcEnvironment)}
              </TableCell>

              {/* Last Sync */}
              <TableCell className="hidden lg:table-cell">
                <SyncStatusIndicator
                  lastSyncAt={facility.lastSyncAt}
                  lastSyncStatus={facility.lastSyncStatus}
                  compact
                />
              </TableCell>

              {/* Alerts */}
              {alertCounts && (
                <TableCell className="w-20">
                  {(() => {
                    const count = alertCounts.get(facility.id) ?? 0
                    if (count === 0) {
                      return <span className="text-xs text-muted-foreground tabular-nums">0</span>
                    }
                    return (
                      <span
                        className="inline-flex items-center gap-1 text-xs tabular-nums text-red-500"
                        title={`${count} open compliance ${count === 1 ? 'alert' : 'alerts'}`}
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {count}
                      </span>
                    )
                  })()}
                </TableCell>
              )}

              {/* Status */}
              <TableCell className="hidden sm:table-cell">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                    facility.isActive
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : 'bg-red-500/10 text-red-500',
                  )}
                >
                  {facility.isActive ? 'Active' : 'Inactive'}
                </span>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/* ---------- Sub-components ---------- */

function SortableHeader({
  label,
  field,
  sort,
  onSort,
  className,
}: {
  label: string
  field: SortField
  sort: SortState
  onSort: (field: SortField) => void
  className?: string
}) {
  const isActive = sort.field === field

  const Icon = isActive
    ? sort.direction === 'asc'
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown

  return (
    <TableHead
      className={className}
      aria-sort={
        isActive
          ? sort.direction === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
    >
      <button
        onClick={() => onSort(field)}
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {label}
        <Icon
          className={cn(
            'h-3.5 w-3.5',
            isActive ? 'text-foreground' : 'text-muted-foreground/40',
          )}
        />
      </button>
    </TableHead>
  )
}

