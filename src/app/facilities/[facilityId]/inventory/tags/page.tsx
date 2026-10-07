'use client'

import { useState, useMemo, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Tag,
  Package,
  AlertTriangle,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import TagLabel from '@/features/tags/components/TagLabel'

function SummaryCardSkeleton() {
  return (
    <div className="card-modern p-4">
      <Skeleton className="h-4 w-24 mb-2" />
      <Skeleton className="h-8 w-16" />
    </div>
  )
}

export default function TagInventoryPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [tagTypeFilter, setTagTypeFilter] = useState<string>('all')
  const pageSize = 25

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, tagTypeFilter])

  const {
    data,
    isLoading,
  } = trpc.tags.getInventory.useQuery(
    { facilityId, page, pageSize, search: debouncedSearch || undefined, tagType: tagTypeFilter !== 'all' ? tagTypeFilter : undefined },
    { enabled: !!facilityId, staleTime: 30_000 },
  )

  const summary = data?.summary
  const tags = data?.tags ?? []
  const totalPages = data?.totalPages ?? 1

  // Derive tag type options from summary
  const tagTypes = useMemo(() => {
    if (!summary?.byType) return []
    return Object.entries(summary.byType).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count)
  }, [summary?.byType])

  const usagePercent = summary ? Math.round(((summary.total - summary.available) / Math.max(summary.total, 1)) * 100) : 0
  const lowStock = (summary?.available ?? 0) < 50

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold">Tag Inventory</h1>
          <Badge variant="outline" className="text-xs">Beta</Badge>
        </div>
        <p className="text-muted-foreground mt-1">
          View and manage Metrc tag inventory. Tags are assigned to packages during processing.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {isLoading ? (
          <>
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
          </>
        ) : (
          <>
            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Total Tags</span>
              </div>
              <p className="text-2xl font-bold">{summary?.total ?? 0}</p>
            </div>

            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <Package className="h-4 w-4 text-emerald-500" />
                <span className="text-xs text-muted-foreground">Available</span>
              </div>
              <p className="text-2xl font-bold text-emerald-500">{summary?.available ?? 0}</p>
            </div>

            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Usage</span>
              </div>
              <p className="text-2xl font-bold">{usagePercent}%</p>
            </div>
          </>
        )}
      </div>

      {/* Low stock warning */}
      {!isLoading && lowStock && (
        <div className="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 flex items-center gap-4">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">Low tag inventory</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Only {summary?.available ?? 0} tags available. Order more tags from Metrc to avoid processing delays.
            </p>
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="card-modern mb-4">
        <div className="space-y-2 px-4 py-3">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by tag label..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Tag type filter pills */}
          {tagTypes.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">Type:</span>
              {[
                { key: 'all', label: 'All', count: summary?.total ?? 0 },
                ...tagTypes.map(t => ({ key: t.type, label: t.type, count: t.count })),
              ].map((pill) => (
                <button
                  key={pill.key}
                  onClick={() => setTagTypeFilter(pill.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    tagTypeFilter === pill.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80',
                  )}
                >
                  {pill.label}
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                    tagTypeFilter === pill.key
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-background/50',
                  )}>
                    {pill.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tags Table */}
      <div className="card-modern overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Used Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                </TableRow>
              ))
            ) : tags.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  {search ? 'No tags match your search.' : 'No tags available.'}
                </TableCell>
              </TableRow>
            ) : (
              tags.map(tag => (
                <TableRow key={tag.id}>
                  <TableCell>
                    <TagLabel label={tag.label} copyable />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs font-normal">
                      {tag.tagType}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      tag.status === 'Available'
                        ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                        : 'bg-muted text-muted-foreground',
                    )}>
                      {tag.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {tag.usedDateTime
                      ? new Date(tag.usedDateTime).toLocaleDateString()
                      : '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages} ({data?.total ?? 0} tags)
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1 rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1 rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cross-link to Processing */}
      <div className="mt-6 text-sm text-muted-foreground">
        Tags are consumed when creating packages.{' '}
        <Link
          href={`/facilities/${facilityId}/packages`}
          className="text-primary hover:underline"
        >
          Go to Packages
        </Link>
      </div>
    </div>
  )
}
