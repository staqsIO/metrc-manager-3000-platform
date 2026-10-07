'use client'

import { useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Input } from '@/shared/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { cn } from '@/lib/utils'
import {
  Package,
  AlertTriangle,
  DollarSign,
  FolderOpen,
  Plus,
  Search,
  ArrowUpDown,
  Pencil,
  Archive,
  ArrowDown,
  ArrowUp,
  Warehouse,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Local type mirrors (avoid deep type instantiation issues)
// ---------------------------------------------------------------------------

interface LocalSupplyCategory {
  id: string
  name: string
  _count: { items: number }
}

interface LocalSupplyItem {
  id: string
  name: string
  sku: string | null
  unit: string
  currentStock: number
  reorderPoint: number | null
  reorderQty: number | null
  unitCost: number | null
  vendor: string | null
  location: string | null
  notes: string | null
  isActive: boolean
  categoryId: string | null
  category: { id: string; name: string } | null
}

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortField = 'name' | 'sku' | 'currentStock' | 'unitCost' | 'vendor'
type SortDir = 'asc' | 'desc'

function sortItems(items: LocalSupplyItem[], field: SortField, dir: SortDir): LocalSupplyItem[] {
  return [...items].sort((a, b) => {
    let cmp = 0
    switch (field) {
      case 'name':
        cmp = a.name.localeCompare(b.name)
        break
      case 'sku':
        cmp = (a.sku ?? '').localeCompare(b.sku ?? '')
        break
      case 'currentStock':
        cmp = a.currentStock - b.currentStock
        break
      case 'unitCost':
        cmp = (a.unitCost ?? 0) - (b.unitCost ?? 0)
        break
      case 'vendor':
        cmp = (a.vendor ?? '').localeCompare(b.vendor ?? '')
        break
    }
    return dir === 'asc' ? cmp : -cmp
  })
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatCurrency(val: number | null): string {
  if (val === null || val === undefined) return '--'
  return '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function SupplyInventoryPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const utils = trpc.useUtils()

  // --- State ---
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(true)
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAddItem, setShowAddItem] = useState(false)
  const [showReceive, setShowReceive] = useState(false)
  const [editingItem, setEditingItem] = useState<LocalSupplyItem | null>(null)

  // --- Add Item form state ---
  const [newName, setNewName] = useState('')
  const [newSku, setNewSku] = useState('')
  const [newUnit, setNewUnit] = useState('Each')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [newStock, setNewStock] = useState('')
  const [newReorderPoint, setNewReorderPoint] = useState('')
  const [newReorderQty, setNewReorderQty] = useState('')
  const [newUnitCost, setNewUnitCost] = useState('')
  const [newVendor, setNewVendor] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [newNotes, setNewNotes] = useState('')

  // --- Quick Receive form state ---
  const [receiveItemId, setReceiveItemId] = useState('')
  const [receiveQty, setReceiveQty] = useState('')
  const [receiveNotes, setReceiveNotes] = useState('')

  // --- Edit form state ---
  const [editName, setEditName] = useState('')
  const [editSku, setEditSku] = useState('')
  const [editUnit, setEditUnit] = useState('')
  const [editCategoryId, setEditCategoryId] = useState('')
  const [editReorderPoint, setEditReorderPoint] = useState('')
  const [editReorderQty, setEditReorderQty] = useState('')
  const [editUnitCost, setEditUnitCost] = useState('')
  const [editVendor, setEditVendor] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [editNotes, setEditNotes] = useState('')

  // --- Queries ---
  const { data: rawItems, isLoading: itemsLoading } = trpc.supply.listItems.useQuery(
    {
      facilityId,
      categoryId: categoryFilter !== 'all' ? categoryFilter : undefined,
      isActive: activeFilter,
      search: search || undefined,
    },
    { enabled: !!facilityId },
  )
  const items = useMemo(() => (rawItems ?? []) as LocalSupplyItem[], [rawItems])

  const { data: rawCategories } = trpc.supply.listCategories.useQuery(
    { facilityId },
    { enabled: !!facilityId },
  )
  const categories: LocalSupplyCategory[] = (rawCategories ?? []) as LocalSupplyCategory[]

  // --- Mutations ---
  const createItemMutation = trpc.supply.createItem.useMutation({
    onSuccess: () => {
      utils.supply.listItems.invalidate()
      utils.supply.listCategories.invalidate()
      resetAddForm()
      setShowAddItem(false)
    },
  })

  const updateItemMutation = trpc.supply.updateItem.useMutation({
    onSuccess: () => {
      utils.supply.listItems.invalidate()
      setEditingItem(null)
    },
  })

  const deleteItemMutation = trpc.supply.deleteItem.useMutation({
    onSuccess: () => {
      utils.supply.listItems.invalidate()
    },
  })

  const receiveStockMutation = trpc.supply.receiveStock.useMutation({
    onSuccess: () => {
      utils.supply.listItems.invalidate()
      setShowReceive(false)
      setReceiveItemId('')
      setReceiveQty('')
      setReceiveNotes('')
    },
  })

  const consumeStockMutation = trpc.supply.consumeStock.useMutation({
    onSuccess: () => {
      utils.supply.listItems.invalidate()
    },
  })

  // --- Derived data ---
  const sortedItems = useMemo(() => sortItems(items, sortField, sortDir), [items, sortField, sortDir])

  const totalItems = items.length
  const lowStockCount = items.filter(
    (i) => i.reorderPoint !== null && i.currentStock < i.reorderPoint,
  ).length
  const totalValue = items.reduce((sum, i) => {
    if (i.unitCost !== null) return sum + i.currentStock * i.unitCost
    return sum
  }, 0)
  const categoryCount = categories.length

  // --- Helpers ---
  function resetAddForm() {
    setNewName('')
    setNewSku('')
    setNewUnit('Each')
    setNewCategoryId('')
    setNewStock('')
    setNewReorderPoint('')
    setNewReorderQty('')
    setNewUnitCost('')
    setNewVendor('')
    setNewLocation('')
    setNewNotes('')
  }

  function handleAddItem() {
    createItemMutation.mutate({
      facilityId,
      name: newName.trim(),
      sku: newSku.trim() || undefined,
      unit: newUnit,
      categoryId: newCategoryId || undefined,
      currentStock: parseFloat(newStock) || 0,
      reorderPoint: newReorderPoint ? parseFloat(newReorderPoint) : undefined,
      reorderQty: newReorderQty ? parseFloat(newReorderQty) : undefined,
      unitCost: newUnitCost ? parseFloat(newUnitCost) : undefined,
      vendor: newVendor.trim() || undefined,
      location: newLocation.trim() || undefined,
      notes: newNotes.trim() || undefined,
    })
  }

  function openEditDialog(item: LocalSupplyItem) {
    setEditingItem(item)
    setEditName(item.name)
    setEditSku(item.sku ?? '')
    setEditUnit(item.unit)
    setEditCategoryId(item.categoryId ?? '')
    setEditReorderPoint(item.reorderPoint?.toString() ?? '')
    setEditReorderQty(item.reorderQty?.toString() ?? '')
    setEditUnitCost(item.unitCost?.toString() ?? '')
    setEditVendor(item.vendor ?? '')
    setEditLocation(item.location ?? '')
    setEditNotes(item.notes ?? '')
  }

  function handleEditSave() {
    if (!editingItem) return
    updateItemMutation.mutate({
      facilityId,
      itemId: editingItem.id,
      name: editName.trim(),
      sku: editSku.trim() || undefined,
      unit: editUnit,
      categoryId: editCategoryId || null,
      reorderPoint: editReorderPoint ? parseFloat(editReorderPoint) : null,
      reorderQty: editReorderQty ? parseFloat(editReorderQty) : null,
      unitCost: editUnitCost ? parseFloat(editUnitCost) : null,
      vendor: editVendor.trim() || null,
      location: editLocation.trim() || null,
      notes: editNotes.trim() || null,
    })
  }

  function handleQuickAdjust(item: LocalSupplyItem, delta: number) {
    if (delta > 0) {
      receiveStockMutation.mutate({
        facilityId,
        itemId: item.id,
        quantity: delta,
        notes: 'Quick adjustment +' + delta,
      })
    } else if (delta < 0) {
      consumeStockMutation.mutate({
        facilityId,
        itemId: item.id,
        quantity: Math.abs(delta),
        notes: 'Quick adjustment ' + delta,
      })
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Warehouse className="h-6 w-6" />
            Supply Inventory
          </h1>
          <p className="text-muted-foreground mt-1">
            Non-Metrc materials and supplies
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowReceive(true)} className="gap-2">
            <ArrowDown className="h-4 w-4" />
            Receive Stock
          </Button>
          <Button onClick={() => setShowAddItem(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {itemsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card-modern p-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Items</span>
            </div>
            <p className="text-2xl font-bold">{totalItems}</p>
          </div>
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className={cn('h-4 w-4', lowStockCount > 0 ? 'text-yellow-500' : 'text-muted-foreground')} />
              <span className="text-xs text-muted-foreground">Low Stock</span>
            </div>
            <p className={cn('text-2xl font-bold', lowStockCount > 0 ? 'text-yellow-500' : '')}>
              {lowStockCount}
            </p>
          </div>
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Total Value</span>
            </div>
            <p className="text-2xl font-bold text-emerald-500">{formatCurrency(totalValue)}</p>
          </div>
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Categories</span>
            </div>
            <p className="text-2xl font-bold">{categoryCount}</p>
          </div>
        </div>
      )}

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items by name, SKU, or vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={categoryFilter}
          onValueChange={(val) => setCategoryFilter(val)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name} ({cat._count.items})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Button
            variant={activeFilter === true ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter(true)}
          >
            Active
          </Button>
          <Button
            variant={activeFilter === false ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter(false)}
          >
            Archived
          </Button>
          <Button
            variant={activeFilter === undefined ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter(undefined)}
          >
            All
          </Button>
        </div>
      </div>

      {/* Inventory Table */}
      {itemsLoading ? (
        <div className="card-modern p-4">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </div>
      ) : sortedItems.length === 0 ? (
        <div className="card-modern p-12 text-center">
          <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold mb-1">No Items Found</h3>
          <p className="text-muted-foreground text-sm mb-4">
            {search ? 'Try adjusting your search or filters.' : 'Add your first supply item to get started.'}
          </p>
          {!search && (
            <Button onClick={() => setShowAddItem(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Item
            </Button>
          )}
        </div>
      ) : (
        <div className="card-modern overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="p-3">
                  <button
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort('name')}
                  >
                    Name
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="p-3">
                  <button
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort('sku')}
                  >
                    SKU
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Category
                </th>
                <th className="p-3">
                  <button
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort('currentStock')}
                  >
                    Stock
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reorder Pt
                </th>
                <th className="p-3">
                  <button
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort('unitCost')}
                  >
                    Unit Cost
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="p-3">
                  <button
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => toggleSort('vendor')}
                  >
                    Vendor
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  isExpanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  onEdit={() => openEditDialog(item)}
                  onArchive={() => deleteItemMutation.mutate({ facilityId, itemId: item.id })}
                  onQuickAdjust={(delta) => handleQuickAdjust(item, delta)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Item Dialog */}
      <Dialog open={showAddItem} onOpenChange={setShowAddItem}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Supply Item</DialogTitle>
            <DialogDescription>
              Add a new non-Metrc material or supply item to track inventory.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Name *</label>
                <Input
                  placeholder="e.g. 1/4 oz Mylar Bags"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">SKU</label>
                <Input
                  placeholder="e.g. BAG-025"
                  value={newSku}
                  onChange={(e) => setNewSku(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Unit *</label>
                <Select value={newUnit} onValueChange={setNewUnit}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Each">Each</SelectItem>
                    <SelectItem value="lb">lb</SelectItem>
                    <SelectItem value="oz">oz</SelectItem>
                    <SelectItem value="g">g</SelectItem>
                    <SelectItem value="kg">kg</SelectItem>
                    <SelectItem value="mL">mL</SelectItem>
                    <SelectItem value="L">L</SelectItem>
                    <SelectItem value="gal">gal</SelectItem>
                    <SelectItem value="ft">ft</SelectItem>
                    <SelectItem value="roll">roll</SelectItem>
                    <SelectItem value="box">box</SelectItem>
                    <SelectItem value="case">case</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Category</label>
                <Select value={newCategoryId || 'none'} onValueChange={(v) => setNewCategoryId(v === 'none' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Category</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Current Stock *</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newStock}
                  onChange={(e) => setNewStock(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Reorder Point</label>
                <Input
                  type="number"
                  placeholder="e.g. 100"
                  value={newReorderPoint}
                  onChange={(e) => setNewReorderPoint(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Reorder Qty</label>
                <Input
                  type="number"
                  placeholder="e.g. 500"
                  value={newReorderQty}
                  onChange={(e) => setNewReorderQty(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Unit Cost ($)</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={newUnitCost}
                  onChange={(e) => setNewUnitCost(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Vendor</label>
                <Input
                  placeholder="e.g. Pacific Packaging"
                  value={newVendor}
                  onChange={(e) => setNewVendor(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Location</label>
              <Input
                placeholder="e.g. Warehouse B, Shelf 3"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Notes</label>
              <textarea
                className="w-full p-2 rounded-md border border-border bg-background text-sm resize-none"
                placeholder="Additional notes..."
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddItem(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddItem}
              disabled={!newName.trim() || createItemMutation.isPending}
            >
              {createItemMutation.isPending ? 'Adding...' : 'Add Item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Receive Dialog */}
      <Dialog open={showReceive} onOpenChange={setShowReceive}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Receive Stock</DialogTitle>
            <DialogDescription>
              Record receiving inventory for a supply item.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Item *</label>
              <Select value={receiveItemId || 'none'} onValueChange={(v) => setReceiveItemId(v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select item" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled>Select item</SelectItem>
                  {items.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} ({item.currentStock} {item.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Quantity *</label>
              <Input
                type="number"
                placeholder="e.g. 500"
                value={receiveQty}
                onChange={(e) => setReceiveQty(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Notes</label>
              <textarea
                className="w-full p-2 rounded-md border border-border bg-background text-sm resize-none"
                placeholder="e.g. PO #12345, received from vendor..."
                value={receiveNotes}
                onChange={(e) => setReceiveNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReceive(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!receiveItemId || !receiveQty) return
                receiveStockMutation.mutate({
                  facilityId,
                  itemId: receiveItemId,
                  quantity: parseFloat(receiveQty),
                  notes: receiveNotes.trim() || undefined,
                })
              }}
              disabled={!receiveItemId || !receiveQty || receiveStockMutation.isPending}
            >
              {receiveStockMutation.isPending ? 'Receiving...' : 'Receive Stock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Item Dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => { if (!open) setEditingItem(null) }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
            <DialogDescription>
              Update the details for {editingItem?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Name *</label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">SKU</label>
                <Input
                  value={editSku}
                  onChange={(e) => setEditSku(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Unit</label>
                <Select value={editUnit} onValueChange={setEditUnit}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Each">Each</SelectItem>
                    <SelectItem value="lb">lb</SelectItem>
                    <SelectItem value="oz">oz</SelectItem>
                    <SelectItem value="g">g</SelectItem>
                    <SelectItem value="kg">kg</SelectItem>
                    <SelectItem value="mL">mL</SelectItem>
                    <SelectItem value="L">L</SelectItem>
                    <SelectItem value="gal">gal</SelectItem>
                    <SelectItem value="ft">ft</SelectItem>
                    <SelectItem value="roll">roll</SelectItem>
                    <SelectItem value="box">box</SelectItem>
                    <SelectItem value="case">case</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Category</label>
                <Select value={editCategoryId || 'none'} onValueChange={(v) => setEditCategoryId(v === 'none' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Category</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Reorder Point</label>
                <Input
                  type="number"
                  value={editReorderPoint}
                  onChange={(e) => setEditReorderPoint(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Reorder Qty</label>
                <Input
                  type="number"
                  value={editReorderQty}
                  onChange={(e) => setEditReorderQty(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Unit Cost ($)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={editUnitCost}
                  onChange={(e) => setEditUnitCost(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Vendor</label>
                <Input
                  value={editVendor}
                  onChange={(e) => setEditVendor(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Location</label>
                <Input
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Notes</label>
              <textarea
                className="w-full p-2 rounded-md border border-border bg-background text-sm resize-none"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEditSave}
              disabled={!editName.trim() || updateItemMutation.isPending}
            >
              {updateItemMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Item Row Component
// ---------------------------------------------------------------------------

function ItemRow({
  item,
  isExpanded,
  onToggle,
  onEdit,
  onArchive,
  onQuickAdjust,
}: {
  item: LocalSupplyItem
  isExpanded: boolean
  onToggle: () => void
  onEdit: () => void
  onArchive: () => void
  onQuickAdjust: (delta: number) => void
}) {
  const lowStock = item.reorderPoint !== null && item.currentStock < item.reorderPoint

  return (
    <>
      <tr
        className={cn(
          'border-b border-border hover:bg-muted/30 cursor-pointer transition-colors',
          lowStock && 'bg-yellow-500/5',
        )}
        onClick={onToggle}
      >
        <td className="p-3 font-medium">{item.name}</td>
        <td className="p-3 text-muted-foreground font-mono text-xs">{item.sku ?? '--'}</td>
        <td className="p-3">
          {item.category ? (
            <Badge variant="outline" className="text-xs">
              {item.category.name}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-xs">--</span>
          )}
        </td>
        <td className="p-3">
          <div className="flex items-center gap-1">
            <button
              className="h-5 w-5 rounded bg-muted hover:bg-muted/80 flex items-center justify-center text-xs"
              onClick={(e) => { e.stopPropagation(); onQuickAdjust(-1) }}
              title="Consume 1"
            >
              <ArrowDown className="h-3 w-3" />
            </button>
            <span className={cn(
              'font-mono tabular-nums min-w-[3rem] text-center',
              lowStock && 'text-yellow-500 font-semibold',
            )}>
              {item.currentStock}
            </span>
            <button
              className="h-5 w-5 rounded bg-muted hover:bg-muted/80 flex items-center justify-center text-xs"
              onClick={(e) => { e.stopPropagation(); onQuickAdjust(1) }}
              title="Receive 1"
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <span className="text-muted-foreground text-xs ml-1">{item.unit}</span>
          </div>
        </td>
        <td className="p-3 text-muted-foreground font-mono text-xs">
          {item.reorderPoint ?? '--'}
        </td>
        <td className="p-3 text-muted-foreground font-mono text-xs">
          {item.unitCost !== null ? formatCurrency(item.unitCost) : '--'}
        </td>
        <td className="p-3 text-muted-foreground text-xs truncate max-w-[120px]">
          {item.vendor ?? '--'}
        </td>
        <td className="p-3">
          {item.isActive ? (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-xs">
              Active
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-gray-500/10 text-gray-500 border-gray-500/20 text-xs">
              Archived
            </Badge>
          )}
        </td>
        <td className="p-3">
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              className="h-7 w-7 rounded hover:bg-muted flex items-center justify-center"
              onClick={onEdit}
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {item.isActive && (
              <button
                className="h-7 w-7 rounded hover:bg-muted flex items-center justify-center"
                onClick={onArchive}
                title="Archive"
              >
                <Archive className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-border bg-muted/20">
          <td colSpan={9} className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground text-xs block mb-0.5">Location</span>
                <span>{item.location ?? 'Not specified'}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block mb-0.5">Reorder Qty</span>
                <span>{item.reorderQty ?? '--'} {item.unit}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block mb-0.5">Stock Value</span>
                <span>
                  {item.unitCost !== null
                    ? formatCurrency(item.currentStock * item.unitCost)
                    : '--'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block mb-0.5">Notes</span>
                <span className="text-muted-foreground">{item.notes ?? 'None'}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
