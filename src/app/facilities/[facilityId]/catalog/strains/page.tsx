'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Database, Leaf, Sprout, Search, /* Plus, */ Pencil,
} from 'lucide-react'
import { KpiCard } from '@/shared/components/KpiCard'
import { Pagination } from '@/shared/components/Pagination'
import { TableSkeletonRows } from '@/shared/components/ui/table-skeleton'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { PageHeader } from '@/shared/components/PageHeader'
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
import { CopyButton } from '@/shared/components/ui/copy-button'

function geneticsBadge(indica: number, sativa: number) {
  if (indica > sativa) return { label: 'Indica', className: 'bg-purple-500/10 text-purple-500' }
  if (sativa > indica) return { label: 'Sativa', className: 'bg-orange-500/10 text-orange-500' }
  return { label: 'Hybrid', className: 'bg-emerald-500/10 text-emerald-500' }
}

type StrainRow = {
  id: number
  name: string
  indicaPercentage: number
  sativaPercentage: number
  thcLevel: number
  cbdLevel: number
  testingStatus: string
}

function StrainFormDialog({
  open,
  onClose,
  strain,
  facilityId,
}: {
  open: boolean
  onClose: () => void
  strain: StrainRow | null
  facilityId: string
}) {
  const isEdit = !!strain
  const utils = trpc.useUtils()

  const [name, setName] = useState(strain?.name ?? '')
  const [indica, setIndica] = useState(strain?.indicaPercentage ?? 0)
  const [sativa, setSativa] = useState(strain?.sativaPercentage ?? 0)
  const [thc, setThc] = useState(strain?.thcLevel ?? 0)
  const [cbd, setCbd] = useState(strain?.cbdLevel ?? 0)

  const createMutation = trpc.catalog.createStrain.useMutation({
    onSuccess: () => {
      utils.catalog.getStrains.invalidate()
      onClose()
    },
  })

  const updateMutation = trpc.catalog.updateStrain.useMutation({
    onSuccess: () => {
      utils.catalog.getStrains.invalidate()
      onClose()
    },
  })

  const mutation = isEdit ? updateMutation : createMutation
  const error = mutation.error?.message

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isEdit) {
      updateMutation.mutate({
        facilityId,
        id: strain!.id,
        name,
        indicaPercentage: indica,
        sativaPercentage: sativa,
        thcLevel: thc,
        cbdLevel: cbd,
      })
    } else {
      createMutation.mutate({
        facilityId,
        name,
        indicaPercentage: indica,
        sativaPercentage: sativa,
        thcLevel: thc,
        cbdLevel: cbd,
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Strain' : 'Add Strain'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update strain details in Metrc' : 'Create a new strain in Metrc'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="strain-name">Name</Label>
            <Input
              id="strain-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Blue Dream"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="strain-indica">Indica %</Label>
              <Input
                id="strain-indica"
                type="number"
                min={0}
                max={100}
                value={indica}
                onChange={(e) => setIndica(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strain-sativa">Sativa %</Label>
              <Input
                id="strain-sativa"
                type="number"
                min={0}
                max={100}
                value={sativa}
                onChange={(e) => setSativa(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="strain-thc">THC Level</Label>
              <Input
                id="strain-thc"
                type="number"
                min={0}
                step={0.1}
                value={thc}
                onChange={(e) => setThc(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strain-cbd">CBD Level</Label>
              <Input
                id="strain-cbd"
                type="number"
                min={0}
                step={0.1}
                value={cbd}
                onChange={(e) => setCbd(Number(e.target.value))}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? (isEdit ? 'Saving...' : 'Creating...')
                : (isEdit ? 'Save Changes' : 'Create Strain')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StrainDetailModal({
  strain,
  open,
  onClose,
  onEdit,
}: {
  strain: StrainRow | null
  open: boolean
  onClose: () => void
  onEdit: () => void
}) {
  if (!strain) return null
  const badge = geneticsBadge(strain.indicaPercentage, strain.sativaPercentage)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {strain.name}
            <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', badge.className)}>
              {badge.label}
            </span>
          </DialogTitle>
          <DialogDescription>Strain details from Metrc</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Metrc ID — prominent and copyable */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Metrc ID</p>
              <CopyButton value={String(strain.id)} label="Metrc ID" />
            </div>
          </div>

          {/* Genetics */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Genetics</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/10">
                <p className="text-xs text-purple-400 mb-0.5">Indica</p>
                <p className="text-lg font-bold text-purple-500">{strain.indicaPercentage}%</p>
              </div>
              <div className="p-2.5 rounded-lg bg-orange-500/5 border border-orange-500/10">
                <p className="text-xs text-orange-400 mb-0.5">Sativa</p>
                <p className="text-lg font-bold text-orange-500">{strain.sativaPercentage}%</p>
              </div>
            </div>
          </div>

          {/* Cannabinoids */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Cannabinoids</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
                <p className="text-xs text-muted-foreground mb-0.5">THC Level</p>
                <p className="text-lg font-bold">{strain.thcLevel}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
                <p className="text-xs text-muted-foreground mb-0.5">CBD Level</p>
                <p className="text-lg font-bold">{strain.cbdLevel}</p>
              </div>
            </div>
          </div>

          {/* Testing */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Testing Status</p>
              <p className="text-sm font-medium">{strain.testingStatus || 'None'}</p>
            </div>
          </div>

          {/* Edit button */}
          <div className="flex justify-end pt-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit Strain
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function StrainsPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedStrain, setSelectedStrain] = useState<StrainRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingStrain, setEditingStrain] = useState<StrainRow | null>(null)

  const { data, isLoading } = trpc.catalog.getStrains.useQuery(
    { facilityId, search: search || undefined, page, pageSize: 25 },
    { enabled: !!facilityId, staleTime: 30_000 }
  )

  const summary = data?.summary

  const summaryCards = [
    { label: 'Total Strains', value: summary?.total ?? 0, icon: Database, color: 'text-foreground' },
    { label: 'Indica-Dominant', value: summary?.indicaCount ?? 0, icon: Leaf, color: 'text-purple-500' },
    { label: 'Sativa-Dominant', value: summary?.sativaCount ?? 0, icon: Leaf, color: 'text-orange-500' },
    { label: 'Hybrid', value: summary?.hybridCount ?? 0, icon: Leaf, color: 'text-emerald-500' },
  ]

  const handleEdit = () => {
    if (selectedStrain) {
      setEditingStrain(selectedStrain)
      setSelectedStrain(null)
      setFormOpen(true)
    }
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Strains"
        description="Master catalog of all registered strains"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
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
            placeholder="Search strains..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        {/* <Button
          size="sm"
          onClick={() => { setEditingStrain(null); setFormOpen(true) }}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Strain
        </Button> */}
      </div>

      {/* Table */}
      <div className="card-modern overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Metrc ID</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Name</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Type</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">Indica %</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">Sativa %</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">THC Level</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">CBD Level</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Testing Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeletonRows columns={8} />
              ) : !data?.strains?.length ? (
                <EmptyState
                  icon={Sprout}
                  title={`No strains found${search ? ` matching "${search}"` : ''}`}
                  variant={search ? 'filtered' : 'onboarding'}
                  description={search ? undefined : 'Strains registered in Metrc will appear here.'}
                  colSpan={8}
                />
              ) : (
                data.strains.map((strain) => {
                  const badge = geneticsBadge(strain.indicaPercentage, strain.sativaPercentage)
                  return (
                    <tr
                      key={strain.id}
                      onClick={() => setSelectedStrain(strain)}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-4">
                        <CopyButton value={String(strain.id)} label="Metrc ID" compact />
                      </td>
                      <td className="py-2.5 px-4 font-medium">{strain.name}</td>
                      <td className="py-2.5 px-4">
                        <span className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          badge.className
                        )}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">{strain.indicaPercentage}%</td>
                      <td className="py-2.5 px-4 text-right">{strain.sativaPercentage}%</td>
                      <td className="py-2.5 px-4 text-right">{strain.thcLevel}</td>
                      <td className="py-2.5 px-4 text-right">{strain.cbdLevel}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{strain.testingStatus || '\u2014'}</td>
                    </tr>
                  )
                })
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

      {/* Strain Detail Modal */}
      <StrainDetailModal
        strain={selectedStrain}
        open={!!selectedStrain}
        onClose={() => setSelectedStrain(null)}
        onEdit={handleEdit}
      />

      {/* Strain Form Dialog (Add / Edit) */}
      {formOpen && (
        <StrainFormDialog
          key={editingStrain?.id ?? 'new'}
          open={formOpen}
          onClose={() => { setFormOpen(false); setEditingStrain(null) }}
          strain={editingStrain}
          facilityId={facilityId}
        />
      )}
    </div>
  )
}
