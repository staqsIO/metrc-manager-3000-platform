'use client'

import { useState, useEffect, Fragment } from 'react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Badge } from '@/shared/components/ui/badge'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { BulkActionBar } from '@/shared/components/BulkActionBar'
import { BulkDestroyDialog } from './BulkDestroyDialog'
import { useTableSelection } from '@/shared/hooks/useTableSelection'
import { Search, ChevronDown, Sprout, Trash2 } from 'lucide-react'
import { Pagination } from '@/shared/components/Pagination'
import { CopyButton } from '@/shared/components/ui/copy-button'
import { format, parseISO } from 'date-fns'
import type { FormattedPlantBatch } from '@/services/metrc/types'

interface PlantBatchTableProps {
  facilityId: string
}

const COLUMNS = [
  { key: 'checkbox', label: '' },
  { key: 'metrcId', label: 'Metrc ID' },
  { key: 'name', label: 'Name' },
  { key: 'strainName', label: 'Strain' },
  { key: 'type', label: 'Type' },
  { key: 'count', label: 'Count' },
  { key: 'location', label: 'Location' },
  { key: 'ageDays', label: 'Age' },
  { key: 'plantedDate', label: 'Planted Date' },
] as const

const COLUMNS_NO_CHECKBOX = COLUMNS.filter(c => c.key !== 'checkbox')

export function PlantBatchTable({ facilityId }: PlantBatchTableProps) {
  const [tab, setTab] = useState('active')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'Seed' | 'Clone' | ''>('')
  const [activePage, setActivePage] = useState(1)
  const [inactivePage, setInactivePage] = useState(1)
  const [pageSize] = useState(25)
  const [expandedRows, setExpandedRows] = useState<Map<number, boolean>>(new Map())
  const [showBulkDestroy, setShowBulkDestroy] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setActivePage(1)
    setInactivePage(1)
  }, [debouncedSearch, typeFilter])

  const { data: activeData, isLoading: activeLoading } = trpc.plantBatches.getActive.useQuery(
    {
      facilityId,
      search: debouncedSearch || undefined,
      type: typeFilter || undefined,
      page: activePage,
      pageSize,
    },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const { data: inactiveData, isLoading: inactiveLoading } = trpc.plantBatches.getInactive.useQuery(
    { facilityId, page: inactivePage, pageSize },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const activeItems = activeData?.items ?? []
  const inactiveItems = inactiveData?.items ?? []

  // Selection only for active tab
  const activePageKeys = activeItems.map((b: FormattedPlantBatch) => b.id)
  const selection = useTableSelection<number>({ pageItemKeys: activePageKeys })

  // Clear selection on tab change
  useEffect(() => {
    selection.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const toggleRow = (id: number) => {
    setExpandedRows(prev => {
      const next = new Map(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.set(id, true)
      }
      return next
    })
  }

  // Resolve selected batch data for the bulk destroy dialog
  const selectedBatches = activeItems
    .filter((b: FormattedPlantBatch) => selection.isSelected(b.id))
    .map((b: FormattedPlantBatch) => ({ id: b.id, name: b.name, count: b.count, strainName: b.strainName }))

  return (
    <div className="space-y-4">
      {/* Search + Type Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search plant batches..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'Seed' | 'Clone' | '')}
          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="">All Types</option>
          <option value="Seed">Seed</option>
          <option value="Clone">Clone</option>
        </select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">
            Active {activeData ? `(${activeData.total})` : ''}
          </TabsTrigger>
          <TabsTrigger value="inactive">
            Inactive {inactiveData ? `(${inactiveData.total})` : ''}
          </TabsTrigger>
        </TabsList>

        {/* Active Tab — with selection */}
        <TabsContent value="active">
          <PlantBatchTableContent
            items={activeItems}
            isLoading={activeLoading}
            expandedRows={expandedRows}
            onToggleRow={toggleRow}
            selection={selection}
            pagination={{
              page: activePage,
              totalPages: activeData?.totalPages ?? 1,
              total: activeData?.total ?? 0,
              pageSize,
              onPageChange: setActivePage,
            }}
          />
        </TabsContent>

        {/* Inactive Tab */}
        <TabsContent value="inactive">
          <PlantBatchTableContent
            items={inactiveItems}
            isLoading={inactiveLoading}
            expandedRows={expandedRows}
            onToggleRow={toggleRow}
            pagination={{
              page: inactivePage,
              totalPages: inactiveData?.totalPages ?? 1,
              total: inactiveData?.total ?? 0,
              pageSize,
              onPageChange: setInactivePage,
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Floating Bulk Action Bar (active tab only) */}
      {tab === 'active' && (
        <BulkActionBar
          selectedCount={selection.selectedCount}
          icon={Sprout}
          actions={[
            { key: 'destroy', label: 'Destroy', icon: Trash2, onClick: () => setShowBulkDestroy(true), variant: 'destructive' },
          ]}
          onClear={selection.clear}
        />
      )}

      {/* Bulk Destroy Dialog */}
      {showBulkDestroy && selectedBatches.length > 0 && (
        <BulkDestroyDialog
          facilityId={facilityId}
          batches={selectedBatches}
          open={showBulkDestroy}
          onClose={() => {
            setShowBulkDestroy(false)
            selection.clear()
          }}
        />
      )}
    </div>
  )
}

interface PaginationInfo {
  page: number
  totalPages: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
}

interface SelectionProps {
  isSelected: (key: number) => boolean
  toggle: (key: number) => void
  isAllSelected: boolean
  isPartiallySelected: boolean
  toggleAll: () => void
}

function PlantBatchTableContent({
  items,
  isLoading,
  expandedRows,
  onToggleRow,
  selection,
  pagination,
}: {
  items: FormattedPlantBatch[]
  isLoading: boolean
  expandedRows: Map<number, boolean>
  onToggleRow: (id: number) => void
  selection?: SelectionProps
  pagination?: PaginationInfo
}) {
  const columns = selection ? COLUMNS : COLUMNS_NO_CHECKBOX
  const colSpan = columns.length

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key}>{col.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                {columns.map((col) => (
                  <TableCell key={col.key}>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border py-16 text-center">
        <Sprout className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No plant batches found</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No plant batches match the current filters.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {selection && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={selection.isAllSelected}
                    ref={(el) => { if (el) el.indeterminate = selection.isPartiallySelected }}
                    onChange={selection.toggleAll}
                    className="rounded border-border"
                  />
                </TableHead>
              )}
              {COLUMNS_NO_CHECKBOX.map((col) => (
                <TableHead key={col.key}>{col.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((batch) => {
              const isExpanded = expandedRows.has(batch.id)
              return (
                <Fragment key={batch.id}>
                  <TableRow
                    className={cn(
                      'cursor-pointer',
                      selection?.isSelected(batch.id) && 'bg-primary/5'
                    )}
                    onClick={() => onToggleRow(batch.id)}
                  >
                    {selection && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selection.isSelected(batch.id)}
                          onChange={() => selection.toggle(batch.id)}
                          className="rounded border-border"
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <CopyButton value={String(batch.id)} label="Metrc ID" compact />
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        <ChevronDown
                          className={cn(
                            'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
                            isExpanded ? '' : '-rotate-90'
                          )}
                        />
                        {batch.name}
                      </div>
                    </TableCell>
                    <TableCell>{batch.strainName || '-'}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          batch.type === 'Seed'
                            ? 'border-amber-500/30 text-amber-500'
                            : 'border-emerald-500/30 text-emerald-500'
                        )}
                      >
                        {batch.type}
                      </Badge>
                    </TableCell>
                    <TableCell>{batch.count.toLocaleString()}</TableCell>
                    <TableCell>{batch.location || '-'}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          batch.ageDays > 30 ? 'border-yellow-500/30 text-yellow-500' :
                          batch.ageDays > 14 ? 'border-blue-500/30 text-blue-500' :
                          'border-emerald-500/30 text-emerald-500'
                        )}
                      >
                        {batch.ageDays}d
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(batch.plantedDate)}
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={colSpan} className="bg-muted/30 px-8 py-4">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Metrc ID</span>
                            <p className="font-medium font-mono">{batch.id}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Tracked</span>
                            <p className="font-medium">{batch.trackedCount.toLocaleString()}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Untracked</span>
                            <p className="font-medium">{batch.untrackedCount.toLocaleString()}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Packaged</span>
                            <p className="font-medium">{batch.packagedCount.toLocaleString()}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Harvested</span>
                            <p className="font-medium">{batch.harvestedCount.toLocaleString()}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Destroyed</span>
                            <p className="font-medium text-red-500">{batch.destroyedCount.toLocaleString()}</p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {pagination && (
        <div className="mt-4">
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onPageChange={pagination.onPageChange}
          />
        </div>
      )}
    </>
  )
}

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'MMM d, yyyy')
  } catch {
    return dateStr
  }
}
