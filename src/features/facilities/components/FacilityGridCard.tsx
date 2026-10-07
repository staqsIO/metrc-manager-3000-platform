'use client'

import Link from 'next/link'
import { AlertTriangle, Building2, Star, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getDefaultFacilityPage } from '@/shared/constants/facility-types'
import { getEnvironmentLabel } from '@/shared/utils/environment'
import type { FacilityItem } from '@/features/facilities/types'
import { SyncStatusIndicator } from '@/features/facilities/components/SyncStatusIndicator'

interface FacilityGridCardProps {
  facility: FacilityItem
  isPinned: boolean
  onTogglePin: (id: string) => void
  alertCount?: number
}

export function FacilityGridCard({
  facility,
  isPinned,
  onTogglePin,
  alertCount,
}: FacilityGridCardProps) {
  const activeKeyAccess = facility.metrcEnvironment === 'sandbox'
    ? facility.sandboxMetrcKeyAccess
    : facility.metrcKeyAccess
  const isReadOnly = activeKeyAccess === 'readonly'

  return (
    <div className="group relative">
      <Link
        href={`/facilities/${facility.id}${getDefaultFacilityPage(facility.facilityType)}`}
        className="card-facility block p-4"
      >
        {/* Row 1: neutral icon container + name + license */}
        <div className="flex items-start gap-3 mb-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-muted">
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-sans font-semibold text-sm truncate">{facility.name}</h3>
              {/* Environment label — text + left-rule, no rounded pill */}
              <span className="shrink-0 inline-flex items-center border-l-rule border-border pl-1.5 text-[10px] uppercase tracking-instrument text-muted-foreground">
                {getEnvironmentLabel(facility.metrcEnvironment)}
              </span>
              {isReadOnly && (
                <span
                  className="shrink-0 inline-flex items-center gap-1 border-l-rule pl-1.5 text-[10px] uppercase tracking-instrument text-muted-foreground"
                  style={{ borderLeftColor: 'hsl(var(--signal-caution))' }}
                >
                  <Lock className="h-2.5 w-2.5" />
                  RO
                </span>
              )}
            </div>
            {/* License number — monospace, treated as a tabular identifier */}
            <p className="font-numeric tabular-nums text-xs text-muted-foreground mt-1 truncate">
              {facility.licenseNumber}
            </p>
          </div>
        </div>

        {/* Row 2: state + type as text labels, no filled pills */}
        <div className="flex items-center gap-3 mb-3">
          <span className="font-numeric tabular-nums text-xs text-muted-foreground">
            {facility.stateCode}
          </span>
          {facility.facilityType && (
            <span className="text-[10px] uppercase tracking-instrument text-muted-foreground">
              {facility.facilityType}
            </span>
          )}
        </div>

        {/* Row 3: sync + alerts + active/inactive — hairline divider, text statuses */}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground pt-2 border-t border-border">
          <SyncStatusIndicator
            lastSyncAt={facility.lastSyncAt}
            lastSyncStatus={facility.lastSyncStatus}
          />
          <div className="flex items-center gap-2">
            {alertCount !== undefined && alertCount > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[10px] tabular-nums text-red-500"
                title={`${alertCount} open compliance ${alertCount === 1 ? 'alert' : 'alerts'}`}
              >
                <AlertTriangle className="h-3 w-3" />
                {alertCount}
              </span>
            )}
            <span
              className="inline-flex items-center border-l-rule pl-2 text-[10px] uppercase tracking-instrument"
              style={{
                borderLeftColor: facility.isActive
                  ? 'hsl(var(--primary))'
                  : 'hsl(var(--signal-critical))',
              }}
            >
              {facility.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </Link>

      {/* Pin button — neutral hover, no yellow */}
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onTogglePin(facility.id)
        }}
        className={cn(
          'absolute top-3 right-3 flex items-center justify-center h-7 w-7 rounded transition-colors',
          isPinned
            ? 'opacity-100 text-foreground hover:text-foreground/80'
            : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground',
        )}
        aria-label={isPinned ? 'Unpin facility' : 'Pin facility'}
      >
        <Star className={cn('h-4 w-4', isPinned && 'fill-current')} />
      </button>
    </div>
  )
}

