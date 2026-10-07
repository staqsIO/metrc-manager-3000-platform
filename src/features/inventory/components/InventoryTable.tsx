'use client'

import { useState, useEffect, useCallback } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Badge } from '@/shared/components/ui/badge'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { trpc } from '@/lib/trpc-client'
import { ArrowUpDown, Search, Package } from 'lucide-react'
import { Pagination } from '@/shared/components/Pagination'
import Link from 'next/link'
import { type AgeCategory, AGE_BADGE_STYLES } from '@/features/inventory/constants'

type PackageStatus = 'active' | 'inactive' | 'onhold'

interface InventoryTableProps {
  facilityId: string
  status?: PackageStatus
  selectedLabels: Set<string>
  onSelectionChange: (labels: Set<string>) => void
  initialAgeFilter?: AgeCategory
}

type SortDir = 'asc' | 'desc'

const AGE_FILTERS: { value: AgeCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'fresh', label: 'Fresh' },
  { value: 'normal', label: 'Normal' },
  { value: 'aging', label: 'Aging' },
  { value: 'critical', label: 'Critical' },
]

const SORTABLE_COLUMNS = [
  { key: 'Label', label: 'Label', compact: '' },
  { key: 'ItemName', label: 'Item', compact: '' },
  { key: 'ItemCategory', label: 'Category', compact: 'compact-hide' },
  { key: 'Quantity', label: 'Quantity', compact: '' },
  { key: 'LocationName', label: 'Location', compact: '' },
  { key: 'ageDays', label: 'Age', compact: '' },
  { key: 'LabTestingState', label: 'Lab', compact: '' },
] as const

export function InventoryTable({ facilityId, status = 'active', selectedLabels, onSelectionChange, initialAgeFilter }: InventoryTableProps) {
  const isReadOnly = status !== 'active'
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [category, setCategory] = useState<string>('')
  const [location, setLocation] = useState<string>('')
  const [ageFilter, setAgeFilter] = useState<AgeCategory | 'all'>(initialAgeFilter ?? 'all')
  const [sortBy, setSortBy] = useState('PackagedDate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, category, location, ageFilter, pageSize])

  const { data, isLoading } = trpc.inventory.getByStatus.useQuery({
    facilityId,
    status,
    search: debouncedSearch || undefined,
    category: category || undefined,
    location: location || undefined,
    ageCategory: ageFilter === 'all' ? undefined : ageFilter,
    sortBy,
    sortDir,
    page,
    pageSize,
  }, { staleTime: 300_000 })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1
  const categories = data?.categories ?? []
  const locations = data?.locations ?? []

  const handleSort = useCallback((key: string) => {
    if (sortBy === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(key)
      setSortDir('asc')
    }
  }, [sortBy])

  const allPageLabels = items.map(item => item.Label)
  const allPageSelected = allPageLabels.length > 0 && allPageLabels.every(l => selectedLabels.has(l))
  const somePageSelected = allPageLabels.some(l => selectedLabels.has(l)) && !allPageSelected

  const toggleAll = useCallback(() => {
    const next = new Set(selectedLabels)
    if (allPageSelected) {
      for (const l of allPageLabels) next.delete(l)
    } else {
      for (const l of allPageLabels) next.add(l)
    }
    onSelectionChange(next)
  }, [selectedLabels, allPageSelected, allPageLabels, onSelectionChange])

  const toggleOne = useCallback((label: string) => {
    const next = new Set(selectedLabels)
    if (next.has(label)) {
      next.delete(label)
    } else {
      next.add(label)
    }
    onSelectionChange(next)
  }, [selectedLabels, onSelectionChange])

  return (
    <TooltipProvider delayDuration={300}>
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search packages..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className={cn(
              'h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'w-full sm:w-48'
            )}
          >
            <option value="">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <select
            value={location}
            onChange={e => setLocation(e.target.value)}
            className={cn(
              'h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'w-full sm:w-48'
            )}
          >
            <option value="">All Locations</option>
            {locations.map(loc => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap">
        {AGE_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setAgeFilter(f.value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
              ageFilter === f.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:bg-accent'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {!isReadOnly && <TableHead className="w-10" />}
                {SORTABLE_COLUMNS.map(col => (
                  <TableHead key={col.key} className={col.compact}>{col.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  {!isReadOnly && <TableCell><Skeleton className="h-4 w-4" /></TableCell>}
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell className="compact-hide"><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border py-16 text-center">
          <Package className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No packages found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {debouncedSearch || category || location || ageFilter !== 'all'
              ? 'Try adjusting your filters.'
              : `No ${status} packages in this facility.`}
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {!isReadOnly && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allPageSelected}
                        ref={(el) => {
                          if (el) {
                            (el as unknown as HTMLInputElement).indeterminate = somePageSelected
                          }
                        }}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                  )}
                  {SORTABLE_COLUMNS.map(col => (
                    <TableHead key={col.key} className={col.compact}>
                      <button
                        onClick={() => handleSort(col.key)}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        {col.label}
                        <ArrowUpDown className={cn(
                          'h-3 w-3',
                          sortBy === col.key ? 'text-foreground' : 'text-muted-foreground/50'
                        )} />
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(item => (
                  <TableRow
                    key={item.Label}
                    data-state={selectedLabels.has(item.Label) ? 'selected' : undefined}
                  >
                    {!isReadOnly && (
                      <TableCell>
                        <Checkbox
                          checked={selectedLabels.has(item.Label)}
                          onCheckedChange={() => toggleOne(item.Label)}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/facilities/${facilityId}/inventory/${item.Id}`}
                        className="hover:text-primary hover:underline transition-colors"
                      >
                        {item.Label}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium max-w-[200px] compact-truncate">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="block truncate cursor-default">{item.ItemName}</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" align="start">
                            {item.ItemName}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                    <TableCell className="compact-hide">{item.ItemCategory}</TableCell>
                    <TableCell>
                      {item.Quantity} {item.UnitOfMeasureName}
                    </TableCell>
                    <TableCell>{item.LocationName || '-'}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(AGE_BADGE_STYLES[item.ageCategory as AgeCategory])}
                      >
                        {item.ageDays}d
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {item.LabTestingState}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
            <Pagination
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
            />
            <div className="flex items-center gap-1.5">
              <span className="text-xs">Rows:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-accent cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
        </>
      )}
    </div>
    </TooltipProvider>
  )
}
