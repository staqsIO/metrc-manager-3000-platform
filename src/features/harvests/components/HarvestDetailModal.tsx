'use client'

import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Separator } from '@/shared/components/ui/separator'
import { FinishHarvestButton, RecordWasteButton } from './HarvestActions'
import { CreatePackagesButton } from './CreatePackagesButton'
import { format, parseISO } from 'date-fns'
import { Scale, Trash2, Package, Calendar, MapPin, FlaskConical } from 'lucide-react'
import { CopyButton } from '@/shared/components/ui/copy-button'
import type { FormattedHarvest, MetrcHarvestWaste } from '@/services/metrc/types'

interface HarvestDetailModalProps {
  facilityId: string
  harvest: FormattedHarvest | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  on_hold: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
  finished: 'bg-muted text-muted-foreground border-border',
}

export function HarvestDetailModal({ facilityId, harvest, open, onOpenChange }: HarvestDetailModalProps) {
  const { data: wasteRecords, isLoading: wasteLoading } = trpc.harvests.getWaste.useQuery(
    { facilityId, harvestId: harvest?.id ?? 0 },
    { enabled: !!facilityId && !!harvest, staleTime: 300_000 }
  )

  if (!harvest) return null

  const statusLabel = harvest.status === 'on_hold' ? 'On Hold' : harvest.status === 'active' ? 'Active' : 'Finished'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle className="text-xl">{harvest.name}</DialogTitle>
            <Badge variant="outline" className={cn(STATUS_STYLES[harvest.status])}>
              {statusLabel}
            </Badge>
          </div>
          <DialogDescription>
            {harvest.sourceStrainNames} &middot; {harvest.harvestType}
          </DialogDescription>
        </DialogHeader>

        {/* Metrc ID */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Metrc ID</p>
            <CopyButton value={String(harvest.id)} label="Metrc ID" />
          </div>
        </div>

        {/* Harvest Info Grid */}
        <div className="grid grid-cols-2 gap-4">
          <InfoItem
            icon={Calendar}
            label="Harvest Date"
            value={formatDate(harvest.harvestStartDate)}
          />
          <InfoItem
            icon={Calendar}
            label="Age"
            value={`${harvest.ageDays} days`}
          />
          <InfoItem
            icon={MapPin}
            label="Drying Location"
            value={harvest.dryingLocation || 'N/A'}
          />
          <InfoItem
            icon={FlaskConical}
            label="Lab Testing"
            value={harvest.labTestingState || 'N/A'}
          />
        </div>

        <Separator />

        {/* Weight Summary */}
        <div>
          <h3 className="text-sm font-medium mb-3">Weight Summary</h3>
          <div className="grid grid-cols-3 gap-3">
            <WeightCard
              icon={Scale}
              label="Current Weight"
              value={harvest.currentWeight}
              unit={harvest.unitOfWeight}
              color="text-foreground"
            />
            <WeightCard
              icon={Trash2}
              label="Total Waste"
              value={harvest.totalWasteWeight}
              unit={harvest.unitOfWeight}
              color="text-yellow-500"
            />
            <WeightCard
              icon={Package}
              label="Packaged"
              value={harvest.totalPackagedWeight}
              unit={harvest.unitOfWeight}
              color="text-emerald-500"
            />
          </div>
        </div>

        <Separator />

        {/* Waste History */}
        <div>
          <h3 className="text-sm font-medium mb-3">Waste History</h3>
          {wasteLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : wasteRecords && wasteRecords.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {wasteRecords.map((record: MetrcHarvestWaste) => (
                <div
                  key={record.Id}
                  className="flex items-center justify-between p-3 rounded-md border border-border bg-muted/30 text-sm"
                >
                  <div>
                    <span className="font-medium">{record.WasteTypeName}</span>
                    <span className="text-muted-foreground ml-2">
                      {formatDate(record.ActualDate)}
                    </span>
                  </div>
                  <span className="font-mono">
                    {record.WasteWeight} {record.UnitOfWeightName}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No waste records found.
            </p>
          )}
        </div>

        <Separator />

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <FinishHarvestButton
            facilityId={facilityId}
            harvest={harvest}
            onSuccess={() => onOpenChange(false)}
          />
          <RecordWasteButton
            facilityId={facilityId}
            harvest={harvest}
          />
          <CreatePackagesButton
            facilityId={facilityId}
            harvest={harvest}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function InfoItem({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  )
}

function WeightCard({ icon: Icon, label, value, unit, color }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  unit: string
  color: string
}) {
  return (
    <div className="p-3 rounded-md border border-border bg-muted/30">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn('h-3.5 w-3.5', color)} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={cn('text-lg font-bold', color)}>
        {value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </p>
      <p className="text-xs text-muted-foreground">{unit}</p>
    </div>
  )
}

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'MMM d, yyyy')
  } catch {
    return dateStr
  }
}
