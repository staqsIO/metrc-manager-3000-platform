'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { usePackageModal } from '@/features/inventory/PackageModalContext'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/components/ui/dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { type AgeCategory, AGE_BADGE_STYLES } from '@/features/inventory/constants'
import { Package, MapPin, Clock, Scale, ExternalLink } from 'lucide-react'

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function PackageDetailModal() {
  const { isOpen, packageLabel, closePackageModal } = usePackageModal()
  const params = useParams()
  const facilityId = params?.facilityId as string | undefined

  const { data: pkg, isLoading, error } = trpc.inventory.getPackageByLabel.useQuery(
    { facilityId: facilityId!, packageLabel: packageLabel! },
    { enabled: !!facilityId && !!packageLabel && isOpen, staleTime: 300_000 },
  )

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) closePackageModal() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{packageLabel}</DialogTitle>
          <DialogDescription>Package summary</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
            <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium">Package not found in active inventory.</p>
            <p className="text-xs text-muted-foreground mt-1">
              It may have been finished or archived.
            </p>
          </div>
        ) : pkg ? (
          <div className="space-y-4">
            {/* Item name + badges */}
            <div>
              <p className="font-semibold">{pkg.ItemName}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                {pkg.ItemCategory && (
                  <Badge variant="outline" className="text-xs">{pkg.ItemCategory}</Badge>
                )}
                {pkg.ItemStrainName && (
                  <Badge variant="outline" className="text-xs">{pkg.ItemStrainName}</Badge>
                )}
                {pkg.LabTestingState && pkg.LabTestingState !== 'NotSubmitted' && (
                  <Badge variant="outline" className="text-xs">{pkg.LabTestingState}</Badge>
                )}
                {pkg.IsOnHold && (
                  <Badge variant="destructive" className="text-xs">On Hold</Badge>
                )}
              </div>
            </div>

            {/* 2x2 metric grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Scale className="h-3 w-3" />
                  Quantity
                </div>
                <p className="text-sm font-semibold">
                  {pkg.Quantity?.toLocaleString()} {pkg.UnitOfMeasureName}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Clock className="h-3 w-3" />
                  Age
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{pkg.ageDays}d</p>
                  <Badge
                    variant="outline"
                    className={cn('text-[10px] capitalize', AGE_BADGE_STYLES[pkg.ageCategory as AgeCategory])}
                  >
                    {pkg.ageCategory}
                  </Badge>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <MapPin className="h-3 w-3" />
                  Location
                </div>
                <p className="text-sm font-semibold truncate">{pkg.LocationName || '-'}</p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Package className="h-3 w-3" />
                  Packaged
                </div>
                <p className="text-sm font-semibold">{formatDate(pkg.PackagedDate)}</p>
              </div>
            </div>

            {/* View Full Details link */}
            {facilityId && (
              <Link
                href={`/facilities/${facilityId}/inventory/${pkg.Id}`}
                onClick={() => closePackageModal()}
                className="flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
              >
                View Full Details
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
