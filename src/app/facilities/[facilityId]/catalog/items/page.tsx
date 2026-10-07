'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Database, Layers, Ruler, Search, /* Plus, */ Pencil, Package,
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

type ItemRow = {
  id: number
  name: string
  category: string
  categoryType: string
  quantityType: string
  unitOfMeasure: string
  strainName: string
  testingState: string
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value || '\u2014'}</span>
    </div>
  )
}

function ItemFormDialog({
  open,
  onClose,
  item,
  facilityId,
}: {
  open: boolean
  onClose: () => void
  item: ItemRow | null
  facilityId: string
}) {
  const isEdit = !!item
  const utils = trpc.useUtils()

  const [name, setName] = useState(item?.name ?? '')
  const [itemCategory, setItemCategory] = useState(item?.category ?? '')
  const [unitOfMeasure, setUnitOfMeasure] = useState(item?.unitOfMeasure ?? '')
  const [strain, setStrain] = useState(item?.strainName ?? '')

  const createMutation = trpc.catalog.createItem.useMutation({
    onSuccess: () => {
      utils.catalog.getItems.invalidate()
      onClose()
    },
  })

  const updateMutation = trpc.catalog.updateItem.useMutation({
    onSuccess: () => {
      utils.catalog.getItems.invalidate()
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
        id: item!.id,
        name,
        itemCategory,
        unitOfMeasure,
      })
    } else {
      createMutation.mutate({
        facilityId,
        name,
        itemCategory,
        unitOfMeasure,
        strain: strain || undefined,
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Item' : 'Add Item'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update item details in Metrc' : 'Create a new item in Metrc'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="item-name">Name</Label>
            <Input
              id="item-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Blue Dream Flower 3.5g"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-category">Item Category</Label>
            <Input
              id="item-category"
              value={itemCategory}
              onChange={(e) => setItemCategory(e.target.value)}
              placeholder="e.g. Flower"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-uom">Unit of Measure</Label>
            <Input
              id="item-uom"
              value={unitOfMeasure}
              onChange={(e) => setUnitOfMeasure(e.target.value)}
              placeholder="e.g. Grams"
              required
            />
          </div>

          {!isEdit && (
            <div className="space-y-2">
              <Label htmlFor="item-strain">Strain (optional)</Label>
              <Input
                id="item-strain"
                value={strain}
                onChange={(e) => setStrain(e.target.value)}
                placeholder="e.g. Blue Dream"
              />
            </div>
          )}

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
                : (isEdit ? 'Save Changes' : 'Create Item')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ItemDetailModal({
  item,
  open,
  onClose,
  onEdit,
}: {
  item: ItemRow | null
  open: boolean
  onClose: () => void
  onEdit: () => void
}) {
  if (!item) return null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>Item details from Metrc</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Metrc ID — prominent and copyable */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Metrc ID</p>
              <CopyButton value={String(item.id)} label="Metrc ID" />
            </div>
          </div>

          {/* Details */}
          <div className="p-3 rounded-lg bg-muted/30 border border-border">
            <DetailRow label="Category" value={item.category} />
            <DetailRow label="Category Type" value={item.categoryType} />
            <DetailRow label="Quantity Type" value={item.quantityType} />
            <DetailRow label="Unit of Measure" value={item.unitOfMeasure} />
            <DetailRow label="Strain" value={item.strainName} />
            <DetailRow label="Default Testing State" value={item.testingState} />
          </div>

          {/* Edit button */}
          <div className="flex justify-end pt-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit Item
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function ItemsPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [page, setPage] = useState(1)
  const [selectedItem, setSelectedItem] = useState<ItemRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ItemRow | null>(null)

  const { data, isLoading } = trpc.catalog.getItems.useQuery(
    { facilityId, search: search || undefined, categoryFilter: categoryFilter || undefined, page, pageSize: 25 },
    { enabled: !!facilityId, staleTime: 30_000 }
  )

  const summary = data?.summary

  const summaryCards = [
    { label: 'Total Items', value: summary?.total ?? 0, icon: Database, color: 'text-foreground' },
    { label: 'Categories', value: summary?.categoryCount ?? 0, icon: Layers, color: 'text-blue-500' },
    { label: 'Units of Measure', value: summary?.uomCount ?? 0, icon: Ruler, color: 'text-cyan-500' },
  ]

  const categoryTabs = [
    { label: 'All', value: '' },
    ...(summary?.categories?.map(c => ({ label: c.name, value: c.name })) ?? []),
  ]

  const handleEdit = () => {
    if (selectedItem) {
      setEditingItem(selectedItem)
      setSelectedItem(null)
      setFormOpen(true)
    }
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Items"
        description="Master catalog of all registered items"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {summaryCards.map((card) => (
          <KpiCard key={card.label} {...card} />
        ))}
      </div>

      {/* Category Tabs + Search + Add Button */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/30 overflow-x-auto">
          {categoryTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setCategoryFilter(tab.value); setPage(1) }}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                categoryFilter === tab.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        {/* <Button
          size="sm"
          onClick={() => { setEditingItem(null); setFormOpen(true) }}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Item
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
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Category</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Unit of Measure</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Strain</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Testing State</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeletonRows columns={6} />
              ) : !data?.items?.length ? (
                <EmptyState
                  icon={Package}
                  title={`No items found${search ? ` matching "${search}"` : ''}${categoryFilter ? ` in category "${categoryFilter}"` : ''}`}
                  variant="filtered"
                  colSpan={6}
                />
              ) : (
                data.items.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                  >
                    <td className="py-2.5 px-4">
                      <CopyButton value={String(item.id)} label="Metrc ID" compact />
                    </td>
                    <td className="py-2.5 px-4 font-medium">{item.name}</td>
                    <td className="py-2.5 px-4">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-500">
                        {item.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground">{item.unitOfMeasure || '\u2014'}</td>
                    <td className="py-2.5 px-4 text-muted-foreground">{item.strainName || '\u2014'}</td>
                    <td className="py-2.5 px-4">
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        item.testingState === 'TestPassed' ? 'bg-emerald-500/10 text-emerald-500' :
                        item.testingState === 'TestFailed' ? 'bg-red-500/10 text-red-500' :
                        item.testingState === 'NotRequired' ? 'bg-muted text-muted-foreground' :
                        'bg-yellow-500/10 text-yellow-500'
                      )}>
                        {item.testingState || '\u2014'}
                      </span>
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

      {/* Item Detail Modal */}
      <ItemDetailModal
        item={selectedItem}
        open={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        onEdit={handleEdit}
      />

      {/* Item Form Dialog (Add / Edit) */}
      {formOpen && (
        <ItemFormDialog
          key={editingItem?.id ?? 'new'}
          open={formOpen}
          onClose={() => { setFormOpen(false); setEditingItem(null) }}
          item={editingItem}
          facilityId={facilityId}
        />
      )}
    </div>
  )
}
