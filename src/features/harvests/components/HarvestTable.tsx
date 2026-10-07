'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Badge } from '@/shared/components/ui/badge'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { HarvestDetailModal } from './HarvestDetailModal'
import { BulkFinishHarvestsDialog } from './BulkFinishHarvestsDialog'
import { BulkActionBar } from '@/shared/components/BulkActionBar'
import { useTableSelection } from '@/shared/hooks/useTableSelection'
import { Search, Wheat, CheckCircle2 } from 'lucide-react'
import { Pagination } from '@/shared/components/Pagination'
import { CopyButton } from '@/shared/components/ui/copy-button'
import { format, parseISO } from 'date-fns'
import type { FormattedHarvest } from '@/services/metrc/types'

interface HarvestTableProps {
  facilityId: string
}

const COLUMNS = [
  { key: 'checkbox', label: '' },
  { key: 'metrcId', label: 'Metrc ID' },
  { key: 'name', label: 'Name' },
  { key: 'sourceStrainNames', label: 'Strain' },
  { key: 'currentWeight', label: 'Current Weight' },
  { key: 'dryingLocation', label: 'Drying Location' },
  { key: 'ageDays', label: 'Age' },
  { key: 'harvestStartDate', label: 'Date' },
] as const

const COLUMNS_NO_CHECKBOX = COLUMNS.filter(c => c.key !== 'checkbox')

export function HarvestTable({ facilityId }: HarvestTableProps) {
  const [tab, setTab] = useState('active')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activePage, setActivePage] = useState(1)
  const [inactivePage, setInactivePage] = useState(1)
  const [pageSize] = useState(25)
  const [selectedHarvest, setSelectedHarvest] = useState<FormattedHarvest | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [showBulkFinish, setShowBulkFinish] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setActivePage(1)
    setInactivePage(1)
  }, [debouncedSearch])

  const { data: activeData, isLoading: activeLoading } = trpc.harvests.getActive.useQuery(
    { facilityId, search: debouncedSearch || undefined, page: activePage, pageSize },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const { data: onHoldData, isLoading: onHoldLoading } = trpc.harvests.getOnHold.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const { data: inactiveData, isLoading: inactiveLoading } = trpc.harvests.getInactive.useQuery(
    { facilityId, page: inactivePage, pageSize },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const activeItems = activeData?.items ?? []
  const onHoldItems = onHoldData ?? []
  const inactiveItems = inactiveData?.items ?? []

  // Selection only for active tab
  const activePageKeys = activeItems.map((h: FormattedHarvest) => h.id)
  const selection = useTableSelection<number>({ pageItemKeys: activePageKeys })

  // Clear selection on tab change
  useEffect(() => {
    selection.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Filter on-hold items client-side (no server-side search for on-hold)
  const filteredOnHold = debouncedSearch
    ? onHoldItems.filter((h: FormattedHarvest) => {
        const s = debouncedSearch.toLowerCase()
        return h.name.toLowerCase().includes(s) ||
          h.sourceStrainNames.toLowerCase().includes(s) ||
          h.dryingLocation.toLowerCase().includes(s)
      })
    : onHoldItems

  const handleRowClick = (harvest: FormattedHarvest) => {
    setSelectedHarvest(harvest)
    setDetailOpen(true)
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search harvests..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">
            Active {activeData ? `(${activeData.total})` : ''}
          </TabsTrigger>
          <TabsTrigger value="onHold">
            On Hold {onHoldData ? `(${onHoldItems.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="finished">
            Finished {inactiveData ? `(${inactiveData.total})` : ''}
          </TabsTrigger>
        </TabsList>

        {/* Active Tab — with selection */}
        <TabsContent value="active">
          <HarvestTableContent
            items={activeItems}
            isLoading={activeLoading}
            onRowClick={handleRowClick}
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

        {/* On Hold Tab */}
        <TabsContent value="onHold">
          <HarvestTableContent
            items={filteredOnHold}
            isLoading={onHoldLoading}
            onRowClick={handleRowClick}
          />
        </TabsContent>

        {/* Finished Tab */}
        <TabsContent value="finished">
          <HarvestTableContent
            items={inactiveItems}
            isLoading={inactiveLoading}
            onRowClick={handleRowClick}
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
          icon={Wheat}
          actions={[
            { key: 'finish', label: 'Finish', icon: CheckCircle2, onClick: () => setShowBulkFinish(true), variant: 'destructive' },
          ]}
          onClear={selection.clear}
        />
      )}

      {/* Bulk Finish Dialog */}
      {showBulkFinish && (
        <BulkFinishHarvestsDialog
          facilityId={facilityId}
          harvestIds={Array.from(selection.selectedKeys)}
          open={showBulkFinish}
          onClose={() => {
            setShowBulkFinish(false)
            selection.clear()
          }}
        />
      )}

      {/* Detail Modal */}
      <HarvestDetailModal
        facilityId={facilityId}
        harvest={selectedHarvest}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
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

function HarvestTableContent({
  items,
  isLoading,
  onRowClick,
  selection,
  pagination,
}: {
  items: FormattedHarvest[]
  isLoading: boolean
  onRowClick: (harvest: FormattedHarvest) => void
  selection?: SelectionProps
  pagination?: PaginationInfo
}) {
  const columns = selection ? COLUMNS : COLUMNS_NO_CHECKBOX

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
        <Wheat className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No harvests found</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No harvests match the current filters.
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
            {items.map((harvest) => (
              <TableRow
                key={harvest.id}
                className={cn(
                  'cursor-pointer',
                  selection?.isSelected(harvest.id) && 'bg-primary/5'
                )}
                onClick={() => onRowClick(harvest)}
              >
                {selection && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selection.isSelected(harvest.id)}
                      onChange={() => selection.toggle(harvest.id)}
                      className="rounded border-border"
                    />
                  </TableCell>
                )}
                <TableCell>
                  <CopyButton value={String(harvest.id)} label="Metrc ID" compact />
                </TableCell>
                <TableCell className="font-medium">{harvest.name}</TableCell>
                <TableCell>{harvest.sourceStrainNames || '-'}</TableCell>
                <TableCell>
                  {harvest.currentWeight.toLocaleString(undefined, { maximumFractionDigits: 2 })} {harvest.unitOfWeight}
                </TableCell>
                <TableCell>{harvest.dryingLocation || '-'}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      harvest.ageDays > 30 ? 'border-yellow-500/30 text-yellow-500' :
                      harvest.ageDays > 14 ? 'border-blue-500/30 text-blue-500' :
                      'border-emerald-500/30 text-emerald-500'
                    )}
                  >
                    {harvest.ageDays}d
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(harvest.harvestStartDate)}
                </TableCell>
              </TableRow>
            ))}
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
