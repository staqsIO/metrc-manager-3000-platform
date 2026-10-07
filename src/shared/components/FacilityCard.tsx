'use client'

import Link from 'next/link'
import { Building2, Key, MapPin, ToggleLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FACILITY_TYPE_COLORS } from '@/shared/constants/facility-types'
import {
  getEnvironmentDotColor,
  getEnvironmentLabel,
  getEnvironmentBadgeClasses,
} from '@/shared/utils/environment'
import type { FacilityItem } from '@/features/facilities/types'

interface FacilityCardProps {
  facility: FacilityItem
  variant?: 'detail' | 'compact'
}

export function FacilityCard({ facility, variant = 'compact' }: FacilityCardProps) {
  if (variant === 'detail') {
    return (
      <Link
        href={`/facilities/${facility.id}/inventory`}
        className="card-modern p-6 block"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-semibold">{facility.name}</h3>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${getEnvironmentBadgeClasses(facility.metrcEnvironment)}`}>
            {getEnvironmentLabel(facility.metrcEnvironment)}
          </span>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Key className="h-3.5 w-3.5" />
            <span>{facility.licenseNumber}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5" />
            <span>{facility.stateCode} - {facility.facilityType || 'General'}</span>
          </div>
          <div className="flex items-center gap-2">
            <ToggleLeft className="h-3.5 w-3.5" />
            <span>{facility.isActive ? 'Active' : 'Inactive'}</span>
          </div>
        </div>
      </Link>
    )
  }

  return (
    <Link
      href={`/facilities/${facility.id}/inventory`}
      className="card-modern p-6 block"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={cn(
          'h-2 w-2 rounded-full',
          getEnvironmentDotColor(facility.metrcEnvironment),
        )} />
        <h3 className="font-semibold">{facility.name}</h3>
        {facility.facilityType && (
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded border ml-auto shrink-0',
            FACILITY_TYPE_COLORS[facility.facilityType] ?? 'bg-muted text-muted-foreground border-border',
          )}>
            {facility.facilityType}
          </span>
        )}
      </div>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>License: {facility.licenseNumber}</p>
        <p>State: {facility.stateCode}</p>
        <p>Mode: {getEnvironmentLabel(facility.metrcEnvironment)}</p>
      </div>
    </Link>
  )
}
