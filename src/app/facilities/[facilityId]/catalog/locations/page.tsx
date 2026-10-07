'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import {
  MapPin, Package, Sprout, Search, // Plus,
} from 'lucide-react'
import { TableSkeletonRows } from '@/shared/components/ui/table-skeleton'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { PageHeader } from '@/shared/components/PageHeader'
import { CopyButton } from '@/shared/components/ui/copy-button'
import { KpiCard } from '@/shared/components/KpiCard'
import { Pagination } from '@/shared/components/Pagination'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Button } from '@/shared/components/ui/button'

function LocationFormDialog({
  open,
  onClose,
  facilityId,
}: {
  open: boolean
  onClose: () => void
  facilityId: string
}) {
  const utils = trpc.useUtils()

  const [name, setName] = useState('')
  const [locationType, setLocationType] = useState('Default Location Type')
  const [successMessage, setSuccessMessage] = useState('')

  const createMutation = trpc.catalog.createLocation.useMutation({
    onSuccess: () => {
      utils.catalog.getLocations.invalidate()
      setSuccessMessage('Location created. It will appear here once packages or batches are assigned to it.')
      setName('')
    },
  })

  const error = createMutation.error?.message

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSuccessMessage('')
    createMutation.mutate({
      facilityId,
      name,
      locationTypeName: locationType,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setSuccessMessage('') } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Location</DialogTitle>
          <DialogDescription>
            Create a new location in Metrc
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="loc-name">Name</Label>
            <Input
              id="loc-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setSuccessMessage('') }}
              placeholder="e.g. Room D"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="loc-type">Location Type</Label>
            <Input
              id="loc-type"
              value={locationType}
              onChange={(e) => setLocationType(e.target.value)}
              placeholder="Default Location Type"
            />
          </div>

          {successMessage && (
            <p className="text-sm text-emerald-500">{successMessage}</p>
          )}

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Location'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function LocationsPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)

  const { data, isLoading } = trpc.catalog.getLocations.useQuery(
    { facilityId, search: search || undefined, page, pageSize: 25 },
    { enabled: !!facilityId, staleTime: 60_000 }
  )

  const summary = data?.summary

  const summaryCards = [
    { label: 'Total Locations', value: summary?.totalLocations ?? 0, icon: MapPin, color: 'text-foreground' },
    { label: 'Packages Stored', value: summary?.totalPackages ?? 0, icon: Package, color: 'text-blue-500' },
    { label: 'Batches Growing', value: summary?.totalBatches ?? 0, icon: Sprout, color: 'text-emerald-500' },
  ]

  return (
    <div className="p-8">
      <PageHeader
        title="Locations"
        description="Active locations registered in Metrc"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {summaryCards.map((card) => (
          <KpiCard key={card.label} {...card} />
        ))}
      </div>

      {/* Search + Add Button */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search locations..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        {/* <Button
          size="sm"
          onClick={() => setFormOpen(true)}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Location
        </Button> */}
      </div>

      {/* Table */}
      <div className="card-modern overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Metrc ID</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location Name</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Type</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">Packages</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">Plant Batches</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeletonRows columns={5} />
              ) : !data?.locations?.length ? (
                <EmptyState
                  icon={MapPin}
                  title={`No locations found${search ? ` matching "${search}"` : ''}`}
                  variant={search ? 'filtered' : 'onboarding'}
                  description={search ? undefined : 'Locations registered in Metrc will appear here.'}
                  colSpan={5}
                />
              ) : (
                data.locations.map((loc) => (
                  <tr key={loc.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-4">
                      <CopyButton value={String(loc.id)} label="Metrc ID" compact />
                    </td>
                    <td className="py-2.5 px-4 font-medium">{loc.name}</td>
                    <td className="py-2.5 px-4 text-muted-foreground">{loc.locationTypeName || '\u2014'}</td>
                    <td className="py-2.5 px-4 text-right">
                      {loc.packageCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-500">
                          <Package className="h-3 w-3" />
                          {loc.packageCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{'\u2014'}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {loc.batchCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-500/10 text-emerald-500">
                          <Sprout className="h-3 w-3" />
                          {loc.batchCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{'\u2014'}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={setPage}
          />
        )}
      </div>

      {/* Location Form Dialog (Create only) */}
      {formOpen && (
        <LocationFormDialog
          open={formOpen}
          onClose={() => setFormOpen(false)}
          facilityId={facilityId}
        />
      )}
    </div>
  )
}
