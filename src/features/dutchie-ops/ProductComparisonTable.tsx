'use client'

import { useState, useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { AlertTriangle, Check, ArrowLeft, Wand2, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import type { CrossStoreProductMatch } from '@/services/dutchie/types'

interface CrossStoreData {
  matches: CrossStoreProductMatch[]
  facilityNames: Record<string, string>
  skipped: { facilityId: string; facilityName: string; reason: string }[]
  totalProducts: number
}

interface Props {
  data: CrossStoreData | null
  isLoading: boolean
  onStartBulkUpdate: () => void
  onBack: () => void
}

export default function ProductComparisonTable({ data, isLoading, onStartBulkUpdate, onBack }: Props) {
  const [filterMode, setFilterMode] = useState<'all' | 'inconsistent'>('inconsistent')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 50

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [filterMode, debouncedSearch])

  const filtered = useMemo(() => {
    const matches = data?.matches ?? []
    let result = filterMode === 'inconsistent'
      ? matches.filter(m => m.inconsistencies.length > 0)
      : matches

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      result = result.filter(m => {
        const firstProduct = Object.values(m.byFacility)[0]
        if (!firstProduct) return false
        return (
          firstProduct.name.toLowerCase().includes(q) ||
          (firstProduct.sku?.toLowerCase().includes(q) ?? false)
        )
      })
    }

    return result
  }, [data?.matches, filterMode, debouncedSearch])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginatedRows = filtered.slice((page - 1) * pageSize, page * pageSize)

  if (isLoading) {
    return (
      <div className="card-modern p-8 text-center text-muted-foreground">
        Fetching products from all stores...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="card-modern p-8 text-center text-muted-foreground">
        No data available. Go back and select stores.
      </div>
    )
  }

  const facilityIds = Object.keys(data.facilityNames)
  const inconsistentCount = data.matches.filter(m => m.inconsistencies.length > 0).length

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card-modern p-4">
          <p className="text-xs text-muted-foreground">Total Products</p>
          <p className="text-2xl font-bold">{data.totalProducts}</p>
        </div>
        <div className="card-modern p-4">
          <p className="text-xs text-muted-foreground">Matched Groups</p>
          <p className="text-2xl font-bold">{data.matches.length}</p>
        </div>
        <div className="card-modern p-4">
          <p className="text-xs text-muted-foreground">With Inconsistencies</p>
          <p className="text-2xl font-bold text-amber-500">{inconsistentCount}</p>
        </div>
        <div className="card-modern p-4">
          <p className="text-xs text-muted-foreground">Stores Compared</p>
          <p className="text-2xl font-bold">{facilityIds.length}</p>
        </div>
      </div>

      {/* Skipped warnings */}
      {data.skipped.length > 0 && (
        <div className="card-modern p-4 border-amber-500/30">
          <div className="flex items-center gap-2 text-amber-500 mb-2">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">Some stores could not be fetched</span>
          </div>
          {data.skipped.map(s => (
            <p key={s.facilityId} className="text-xs text-muted-foreground ml-6">
              {s.facilityName}: {s.reason}
            </p>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
          <div className="flex items-center border border-border rounded-lg overflow-hidden text-sm">
            <button
              onClick={() => setFilterMode('inconsistent')}
              className={cn(
                'px-3 py-1.5 transition-colors',
                filterMode === 'inconsistent' ? 'bg-primary/10 text-primary' : 'hover:bg-accent',
              )}
            >
              Inconsistent ({inconsistentCount})
            </button>
            <button
              onClick={() => setFilterMode('all')}
              className={cn(
                'px-3 py-1.5 transition-colors',
                filterMode === 'all' ? 'bg-primary/10 text-primary' : 'hover:bg-accent',
              )}
            >
              All ({data.matches.length})
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name or SKU..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 w-56 rounded-lg border border-border bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <button
          onClick={onStartBulkUpdate}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Wand2 className="h-4 w-4" />
          Bulk Find &amp; Replace
        </button>
      </div>

      {/* Table */}
      <div className="card-modern overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Product</TableHead>
                <TableHead className="w-20">Match</TableHead>
                <TableHead className="w-32">Issues</TableHead>
                {facilityIds.map(fId => (
                  <TableHead key={fId} className="min-w-[120px] text-center">
                    {data.facilityNames[fId] ?? fId}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3 + facilityIds.length} className="text-center text-muted-foreground py-8">
                    {debouncedSearch
                      ? `No products matching "${debouncedSearch}"`
                      : filterMode === 'inconsistent'
                        ? 'All matched products are consistent across stores!'
                        : 'No matched products found.'}
                  </TableCell>
                </TableRow>
              )}
              {paginatedRows.map((match) => {
                const firstProduct = Object.values(match.byFacility)[0]!
                return (
                  <TableRow key={match.matchKey}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{firstProduct.name}</p>
                        <p className="text-xs text-muted-foreground">{firstProduct.sku ?? 'No SKU'}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {match.matchType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {match.inconsistencies.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {match.inconsistencies.map(field => (
                            <Badge key={field} variant="outline" className="text-[10px] border-amber-500/30 text-amber-500">
                              {field}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-emerald-500 text-xs">
                          <Check className="h-3 w-3" />
                          Consistent
                        </div>
                      )}
                    </TableCell>
                    {facilityIds.map(fId => {
                      const product = match.byFacility[fId]
                      if (!product) {
                        return (
                          <TableCell key={fId} className="text-center text-muted-foreground text-xs">
                            -
                          </TableCell>
                        )
                      }
                      return (
                        <TableCell key={fId} className="text-center">
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium">
                              {product.unitPrice != null
                                ? `$${product.unitPrice.toFixed(2)}`
                                : '-'}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {product.isActive ? 'Active' : 'Inactive'}
                              {' · '}
                              {product.isVisible ? 'Visible' : 'Hidden'}
                            </p>
                          </div>
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        {filtered.length > pageSize && (
          <div className="flex items-center justify-between p-3 border-t text-sm">
            <span className="text-xs text-muted-foreground">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded border border-border text-xs transition-colors',
                  page <= 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent',
                )}
              >
                <ChevronLeft className="h-3 w-3" />
                Prev
              </button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded border border-border text-xs transition-colors',
                  page >= totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent',
                )}
              >
                Next
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
