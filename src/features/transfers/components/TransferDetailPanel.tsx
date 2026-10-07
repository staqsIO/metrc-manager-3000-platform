'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { CopyButton } from '@/shared/components/ui/copy-button'
import { Package, Truck, MapPin, FlaskConical } from 'lucide-react'
import { AcceptInMetrcButton } from './AcceptInMetrcButton'
import { CreateBatchFromTransferDialog } from './CreateBatchFromTransferDialog'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type RouterOutputs = inferRouterOutputs<AppRouter>
type DeliveryItem = RouterOutputs['transfers']['getDeliveries'][number]
type DeliveryPackageItem = RouterOutputs['transfers']['getDeliveryPackages'][number]

function LabTestBadge({ state }: { state: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    TestPassed: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', label: 'Passed' },
    TestFailed: { bg: 'bg-red-500/10', text: 'text-red-500', label: 'Failed' },
    SubmittedForTesting: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', label: 'Submitted' },
    NotSubmitted: { bg: 'bg-muted', text: 'text-muted-foreground', label: 'Not Submitted' },
  }
  const s = map[state] ?? { bg: 'bg-muted', text: 'text-muted-foreground', label: state }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', s.bg, s.text)}>
      {s.label}
    </span>
  )
}

function ShipmentStateBadge({ state }: { state: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    Accepted: { bg: 'bg-emerald-500/10', text: 'text-emerald-500' },
    Rejected: { bg: 'bg-red-500/10', text: 'text-red-500' },
    Shipped: { bg: 'bg-blue-500/10', text: 'text-blue-500' },
    Returned: { bg: 'bg-yellow-500/10', text: 'text-yellow-500' },
  }
  const s = map[state] ?? { bg: 'bg-muted', text: 'text-muted-foreground' }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', s.bg, s.text)}>
      {state}
    </span>
  )
}

function DeliveryPackagesTable({ facilityId, deliveryId }: { facilityId: string; deliveryId: number }) {
  const { data: packages, isLoading } = trpc.transfers.getDeliveryPackages.useQuery(
    { facilityId, deliveryId },
    { staleTime: 300_000 }
  )

  if (isLoading) {
    return <div className="py-3 px-4 text-xs text-muted-foreground animate-pulse">Loading packages...</div>
  }

  if (!packages?.length) {
    return <div className="py-3 px-4 text-xs text-muted-foreground">No packages in this delivery</div>
  }

  return (
    <table className="w-full text-xs mt-2">
      <thead>
        <tr className="border-b border-border/50">
          <th className="text-left py-1.5 px-3 font-medium text-muted-foreground">Label</th>
          <th className="text-left py-1.5 px-3 font-medium text-muted-foreground">Item</th>
          <th className="text-left py-1.5 px-3 font-medium text-muted-foreground">Category</th>
          <th className="text-right py-1.5 px-3 font-medium text-muted-foreground">Qty</th>
          <th className="text-right py-1.5 px-3 font-medium text-muted-foreground">Price</th>
          <th className="text-left py-1.5 px-3 font-medium text-muted-foreground">Lab</th>
          <th className="text-left py-1.5 px-3 font-medium text-muted-foreground">State</th>
        </tr>
      </thead>
      <tbody>
        {packages.map((p: DeliveryPackageItem) => (
          <tr key={p.packageId} className="border-b border-border/30 hover:bg-muted/10">
            <td className="py-1.5 px-3">
              <CopyButton value={p.packageLabel} label="Label" compact />
            </td>
            <td className="py-1.5 px-3 font-medium">{p.itemName}</td>
            <td className="py-1.5 px-3 text-muted-foreground">{p.itemCategory}</td>
            <td className="py-1.5 px-3 text-right">
              {(p.quantity ?? 0).toLocaleString()} {p.unitOfMeasure}
            </td>
            <td className="py-1.5 px-3 text-right text-muted-foreground">
              {p.wholesalePrice != null ? `$${p.wholesalePrice.toLocaleString()}` : '\u2014'}
            </td>
            <td className="py-1.5 px-3"><LabTestBadge state={p.labTestingState} /></td>
            <td className="py-1.5 px-3"><ShipmentStateBadge state={p.shipmentPackageState} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface TransferDetailPanelProps {
  facilityId: string
  transferId: number
  manifestNumber: string
  direction?: 'incoming' | 'outgoing' | 'rejected'
  stateCode: string
  environment: string
  licenseNumber: string
}

export function TransferDetailPanel({ facilityId, transferId, manifestNumber, direction, stateCode, environment, licenseNumber }: TransferDetailPanelProps) {
  const [batchDeliveryId, setBatchDeliveryId] = useState<number | null>(null)
  const { data: deliveries, isLoading } = trpc.transfers.getDeliveries.useQuery(
    { facilityId, transferId },
    { staleTime: 300_000 }
  )

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <div className="h-4 w-48 bg-muted animate-pulse rounded" />
        <div className="h-24 bg-muted/50 animate-pulse rounded" />
      </div>
    )
  }

  if (!deliveries?.length) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No deliveries found for this transfer.
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <h4 className="text-sm font-medium text-muted-foreground">
        Deliveries for Manifest #{manifestNumber || transferId}
      </h4>

      {deliveries.map((d: DeliveryItem, idx: number) => (
        <div key={d.id} className="rounded-lg border border-border/50 bg-background">
          <div className="px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="font-medium text-xs text-muted-foreground">Delivery {idx + 1}</span>
            <span className="font-medium">{d.recipientFacilityName}</span>
            <span className="text-xs text-muted-foreground font-mono">{d.recipientFacilityLicense}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Truck className="h-3 w-3" />
              {d.shipmentTypeName}
            </span>
            {d.plannedRoute && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {d.plannedRoute}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Package className="h-3 w-3" />
              {d.totalPackages} pkg
            </span>
            {d.grossWeight != null && (
              <span className="text-xs text-muted-foreground">
                {d.grossWeight.toLocaleString()} {d.grossUnitOfWeight}
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              {d.receivedDateTime ? (
                <span className="text-xs text-emerald-500">
                  Received {new Date(d.receivedDateTime).toLocaleDateString()}
                </span>
              ) : (
                <>
                  <span className="inline-flex items-center rounded-full bg-yellow-500/10 text-yellow-500 px-2 py-0.5 text-xs">
                    Pending
                  </span>
                  <AcceptInMetrcButton
                    stateCode={stateCode}
                    environment={environment}
                    licenseNumber={licenseNumber}
                  />
                </>
              )}
              {direction === 'incoming' && d.receivedDateTime && (
                <button
                  onClick={() => setBatchDeliveryId(d.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                >
                  <FlaskConical className="h-3 w-3" />
                  Create Batch
                </button>
              )}
            </span>
          </div>
          <div className="border-t border-border/30">
            <DeliveryPackagesTable facilityId={facilityId} deliveryId={d.id} />
          </div>
        </div>
      ))}

      {/* Create Batch Dialog */}
      {batchDeliveryId != null && (
        <CreateBatchFromTransferDialog
          facilityId={facilityId}
          transferId={transferId}
          manifestNumber={manifestNumber}
          deliveryId={batchDeliveryId}
          open={batchDeliveryId != null}
          onClose={() => setBatchDeliveryId(null)}
        />
      )}
    </div>
  )
}
