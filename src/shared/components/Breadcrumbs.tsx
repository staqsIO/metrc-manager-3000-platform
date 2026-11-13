'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, Building2, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { trpc } from '@/lib/trpc-client'
import { useFacilityId } from '@/shared/hooks/useFacilityId'
import { FacilitySettingsGearButton } from '@/features/facilities/components/FacilitySettingsGearButton'
import { StateOutline } from './StateOutline'

// Facility route folders that group pages but have no page of their own; a crumb for
// one renders as text, since linking it would 404. Breadcrumbs.test.ts keeps this in sync.
export const SEGMENTS_WITHOUT_PAGE = new Set(['catalog'])

export function Breadcrumbs() {
  const pathname = usePathname()
  const facilityId = useFacilityId()
  if (!pathname || !facilityId) return null // Only show on facility-scoped pages

  const subPath = pathname.replace(`/facilities/${facilityId}`, '')
  const segments = subPath.split('/').filter(Boolean)

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-sm text-muted-foreground px-8 py-2 border-b border-border/30 bg-background/60 backdrop-blur-sm"
    >
      {/* Left: breadcrumb trail */}
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <Link
          href="/facilities"
          className="hover:text-foreground transition-colors flex items-center gap-1 shrink-0"
        >
          <Building2 className="h-3.5 w-3.5" />
          Facilities
        </Link>
        <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
        <FacilityBreadcrumbName facilityId={facilityId} />
        {segments.map((segment, i) => {
          const href = `/facilities/${facilityId}/${segments.slice(0, i + 1).join('/')}`
          const isLast = i === segments.length - 1
          const label = formatSegment(segment)
          return (
            <span key={href} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
              {isLast || SEGMENTS_WITHOUT_PAGE.has(segment) ? (
                <span className={isLast ? 'text-foreground font-medium' : undefined}>{label}</span>
              ) : (
                <Link href={href} className="hover:text-foreground transition-colors">
                  {label}
                </Link>
              )}
            </span>
          )
        })}
      </div>

      {/* Right: facility metadata + settings */}
      <FacilityMetadata facilityId={facilityId} />
    </nav>
  )
}

function FacilityBreadcrumbName({ facilityId }: { facilityId: string }) {
  const { data } = trpc.facility.getById.useQuery(
    { facilityId },
    { staleTime: 60_000 },
  )

  return (
    <Link
      href={`/facilities/${facilityId}/inventory`}
      className="hover:text-foreground transition-colors max-w-[200px] truncate"
    >
      {data?.name ?? facilityId.slice(0, 8)}
    </Link>
  )
}

function FacilityMetadata({ facilityId }: { facilityId: string }) {
  const { data } = trpc.facility.getById.useQuery(
    { facilityId },
    { staleTime: 60_000 },
  )

  if (!data) return null

  const activeKeyAccess = data.metrcEnvironment === 'sandbox'
    ? data.sandboxMetrcKeyAccess
    : data.metrcKeyAccess
  const isReadOnly = activeKeyAccess === 'readonly'

  return (
    <div className="flex items-center gap-2 shrink-0 ml-4">
      <span className="text-xs text-muted-foreground hidden sm:inline-flex items-center gap-1.5">
        <StateOutline stateCode={data.stateCode} size={14} className="text-muted-foreground/60" />
        {data.stateCode} &middot; {data.licenseNumber}
      </span>
      {isReadOnly && (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border bg-amber-500/10 border-amber-500/30 text-amber-400">
          <Lock className="h-2.5 w-2.5" />
          Read-Only
        </span>
      )}
      {data.metrcEnvironment !== 'production' && (
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border',
            data.metrcEnvironment === 'sandbox'
              ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
              : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
          )}
        >
          {data.metrcEnvironment === 'sandbox' ? 'Sandbox' : 'Mock'}
        </span>
      )}
      <FacilitySettingsGearButton facilityId={facilityId} facilityName={data.name} />
    </div>
  )
}

function formatSegment(segment: string): string {
  return segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
