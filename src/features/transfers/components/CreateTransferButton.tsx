'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { MutationDialog } from '@/shared/components/MutationDialog'
import { useMutationFlow } from '@/shared/hooks/useMutationFlow'
import { cn } from '@/lib/utils'
import { ArrowUpRight, Plus, Trash2 } from 'lucide-react'
import { format } from 'date-fns'

interface CreateTransferButtonProps {
  facilityId: string
  onSuccess?: () => void
}

interface PackageEntry {
  packageLabel: string
  wholesalePrice: string
}

export function CreateTransferButton({ facilityId, onSuccess }: CreateTransferButtonProps) {
  const [transferTypeName, setTransferTypeName] = useState('Wholesale Manifest')
  const [receiverLicense, setReceiverLicense] = useState('')
  const [departureDate, setDepartureDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [arrivalDate, setArrivalDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [packages, setPackages] = useState<PackageEntry[]>([{ packageLabel: '', wholesalePrice: '' }])
  const [transporterLicense, setTransporterLicense] = useState('')

  const utils = trpc.useUtils()
  const mutation = trpc.transfers.createOutgoingTransfer.useMutation()

  type PreviewData = {
    transferTypeName: string
    receiverFacilityLicenseNumber: string
    packageCount: number
    packages: Array<{ label: string; itemName: string; wholesalePrice?: number }>
    estimatedDepartureDate: string
    estimatedArrivalDate: string
    transporter: { licenseNumber: string; departureDate: string; arrivalDate: string } | null
  }

  const flow = useMutationFlow<
    Parameters<typeof mutation.mutateAsync>[0],
    PreviewData
  >({
    mutationFn: (input) => mutation.mutateAsync(input),
    getPreview: (result) => {
      const r = result as { preview: PreviewData }
      return [r.preview]
    },
    onSuccess: () => {
      utils.transfers.getOutgoing.invalidate()
      utils.transfers.getSummary.invalidate()
      resetForm()
      onSuccess?.()
    },
  })

  const resetForm = () => {
    setTransferTypeName('Wholesale Manifest')
    setReceiverLicense('')
    setDepartureDate(format(new Date(), 'yyyy-MM-dd'))
    setArrivalDate(format(new Date(), 'yyyy-MM-dd'))
    setPackages([{ packageLabel: '', wholesalePrice: '' }])
    setTransporterLicense('')
  }

  const handleOpen = () => {
    resetForm()
    flow.open()
  }

  const addPackage = () => {
    setPackages(prev => [...prev, { packageLabel: '', wholesalePrice: '' }])
  }

  const removePackage = (index: number) => {
    setPackages(prev => prev.filter((_, i) => i !== index))
  }

  const updatePackage = (index: number, field: keyof PackageEntry, value: string) => {
    setPackages(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p))
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!receiverLicense || packages.some(p => !p.packageLabel)) return
    if (arrivalDate < departureDate) return

    const input = {
      facilityId,
      receiverFacilityLicenseNumber: receiverLicense,
      transferTypeName,
      estimatedDepartureDate: departureDate,
      estimatedArrivalDate: arrivalDate,
      packages: packages.map(p => ({
        packageLabel: p.packageLabel,
        ...(p.wholesalePrice ? { wholesalePrice: parseFloat(p.wholesalePrice) } : {}),
      })),
      ...(transporterLicense ? {
        transporter: {
          licenseNumber: transporterLicense,
          departureDate,
          arrivalDate,
        },
      } : {}),
    }
    flow.preview(input)
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen}>
        <ArrowUpRight className="h-4 w-4 mr-1" />
        Create Transfer
      </Button>

      <MutationDialog
        title="Create Outgoing Transfer"
        description="Create a new outgoing manifest transfer in Metrc"
        flow={flow}
        size="lg"
        formContent={
          <form id="mutation-form" onSubmit={handleFormSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="transferType">Transfer Type</Label>
              <select
                id="transferType"
                value={transferTypeName}
                onChange={(e) => setTransferTypeName(e.target.value)}
                className={cn(
                  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                )}
              >
                <option value="Wholesale Manifest">Wholesale Manifest</option>
                <option value="Transfer">Transfer</option>
                <option value="Testing">Testing</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="receiverLicense">Receiver Facility License</Label>
              <Input id="receiverLicense" value={receiverLicense} onChange={(e) => setReceiverLicense(e.target.value)} placeholder="C10-0000XX-LIC" required />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="departure">Departure Date</Label>
                <Input id="departure" type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="arrival">Arrival Date</Label>
                <Input id="arrival" type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} required />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="transporter">Transporter License (optional)</Label>
              <Input id="transporter" value={transporterLicense} onChange={(e) => setTransporterLicense(e.target.value)} placeholder="C12-0000XX-LIC" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Packages</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addPackage}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Package
                </Button>
              </div>
              <div className="space-y-2">
                {packages.map((p, i) => (
                  <div key={i} className="grid grid-cols-[1fr_120px_32px] gap-2 items-end">
                    <div className="space-y-1">
                      {i === 0 && <span className="text-xs text-muted-foreground">Package Label</span>}
                      <Input
                        value={p.packageLabel}
                        onChange={(e) => updatePackage(i, 'packageLabel', e.target.value)}
                        placeholder="1A400..."
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      {i === 0 && <span className="text-xs text-muted-foreground">Price ($)</span>}
                      <Input
                        type="number"
                        step="0.01"
                        value={p.wholesalePrice}
                        onChange={(e) => updatePackage(i, 'wholesalePrice', e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      {packages.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" className="h-10 w-8" onClick={() => removePackage(i)}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </form>
        }
        previewContent={(previews) => {
          const p = previews[0]!
          return (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Transfer Type</span>
                  <span className="font-medium">{p.transferTypeName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Receiver License</span>
                  <span className="font-mono text-xs">{p.receiverFacilityLicenseNumber}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Packages</span>
                  <span className="font-medium">{p.packageCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Departure</span>
                  <span>{p.estimatedDepartureDate}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Arrival</span>
                  <span>{p.estimatedArrivalDate}</span>
                </div>
                {p.transporter && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Transporter</span>
                    <span className="font-mono text-xs">{p.transporter.licenseNumber}</span>
                  </div>
                )}
                <div className="border-t border-border pt-2 mt-2">
                  {p.packages.map((pkg, i) => (
                    <div key={i} className="flex justify-between text-sm py-0.5">
                      <span className="font-mono text-xs">{pkg.label}</span>
                      <span className="text-muted-foreground">{pkg.itemName}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        }}
        confirmLabel="Create Transfer"
      />
    </>
  )
}
