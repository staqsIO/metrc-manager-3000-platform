'use client'

import Link from 'next/link'
import { AlertTriangle, Star, ChevronRight, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getDefaultFacilityPage } from '@/shared/constants/facility-types'
import { getEnvironmentDotColor } from '@/shared/utils/environment'
import type { FacilityItem } from '@/features/facilities/types'
import { SyncStatusIndicator } from '@/features/facilities/components/SyncStatusIndicator'

interface FacilityListRowProps {
  facility: FacilityItem
  isPinned: boolean
  onTogglePin: (id: string) => void
  alertCount?: number
}

export function FacilityListRow({
  facility,
  isPinned,
  onTogglePin,
  alertCount,
}: FacilityListRowProps) {
  const activeKeyAccess = facility.metrcEnvironment === 'sandbox'
    ? facility.sandboxMetrcKeyAccess
    : facility.metrcKeyAccess
  const isReadOnly = activeKeyAccess === 'readonly'

  // Facility type renders as a tracked uppercase text label rather than a
  // filled colored badge — categorical, not status.
  return (
    <div className="group relative surface-rule-row">
      <Link
        href={`/facilities/${facility.id}${getDefaultFacilityPage(facility.facilityType)}`}
        className="flex items-center gap-3 border-b border-border px-4 py-3 pl-10 transition-colors duration-150 ease-out hover:bg-muted/40"
      >
        {/* Env dot — kept; signals environment (sandbox/production) */}
        <div
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            getEnvironmentDotColor(facility.metrcEnvironment, facility.isActive),
          )}
        />

        {/* Name — UI face, body weight */}
        <span className="font-sans font-medium text-sm truncate min-w-0 flex-1">
          {facility.name}
        </span>

        {/* Open alerts — only render when > 0; tabular text + AlertTriangle */}
        {alertCount !== undefined && alertCount > 0 && (
          <span
            className="hidden sm:inline-flex items-center gap-1 text-[10px] tabular-nums text-red-500 shrink-0"
            title={`${alertCount} open compliance ${alertCount === 1 ? 'alert' : 'alerts'}`}
          >
            <AlertTriangle className="h-3 w-3" />
            {alertCount}
          </span>
        )}

        {/* Type — text-only label, instrument-panel tracking. No filled badge. */}
        {facility.facilityType && (
          <span className="hidden sm:inline-flex items-center text-[10px] uppercase tracking-instrument text-muted-foreground shrink-0">
            {facility.facilityType}
          </span>
        )}

        {/* Read-only — left-rule accent on a tight text label, no pill, no
            colored background. Caution color reserved for soft warnings. */}
        {isReadOnly && (
          <span className="hidden sm:inline-flex items-center gap-1 border-l-rule pl-1.5 text-[10px] uppercase tracking-instrument shrink-0"
                style={{ borderLeftColor: 'hsl(var(--signal-caution))' }}>
            <Lock className="h-2.5 w-2.5 text-muted-foreground" />
            <span className="text-muted-foreground">RO</span>
          </span>
        )}

        {/* State — monospace, treated as a tabular identifier */}
        <span className="hidden sm:inline-flex items-center font-numeric text-xs tabular-nums text-muted-foreground shrink-0">
          {facility.stateCode}
        </span>

        {/* Sync status (hidden below lg) */}
        <span className="hidden lg:inline-flex shrink-0">
          <SyncStatusIndicator
            lastSyncAt={facility.lastSyncAt}
            lastSyncStatus={facility.lastSyncStatus}
          />
        </span>

        {/* Status — text + left-rule, no rounded pill, no /10 fill.
            Active uses phosphor accent, inactive uses signal-critical. */}
        <span
          className="hidden sm:inline-flex items-center border-l-rule pl-2 text-[10px] uppercase tracking-instrument shrink-0"
          style={{
            borderLeftColor: facility.isActive
              ? 'hsl(var(--primary))'
              : 'hsl(var(--signal-critical))',
          }}
        >
          {facility.isActive ? 'Active' : 'Inactive'}
        </span>

        {/* Chevron */}
        <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      </Link>

      {/* Pin button — sibling of Link, not nested inside it */}
      <button
        onClick={() => onTogglePin(facility.id)}
        className={cn(
          'absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center h-6 w-6 shrink-0 rounded transition-colors z-10',
          isPinned
            ? 'text-foreground hover:text-foreground/80'
            : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground',
        )}
        aria-label={isPinned ? 'Unpin facility' : 'Pin facility'}
      >
        <Star className={cn('h-3.5 w-3.5', isPinned && 'fill-current')} />
      </button>
    </div>
  )
}

