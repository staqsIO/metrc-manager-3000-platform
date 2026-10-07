'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUp, ArrowDown, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

/**
 * Sample-out candidate shape returned by the Copilot's
 * `find_sample_out_candidates` tool. We intentionally type loosely (allowing
 * partial rows) because the LLM's tool output may have been trimmed and we
 * never want a missing field to crash the rendering.
 */
export interface CandidateRow {
  label?: string
  itemName?: string
  itemCategory?: string
  strain?: string
  quantity?: number
  unitOfMeasure?: string
  ageDays?: number
  location?: string
  reason?: string
}

type SortKey = 'ageDays' | 'quantity' | 'itemCategory'
type SortDir = 'asc' | 'desc'

export interface CandidateTableProps {
  rows: CandidateRow[]
  facilityId: string | null
  /** preview = top 5 rows, no sort headers (right-rail).
   *  full    = all rows, sortable headers (shareable artifact route). */
  mode: 'preview' | 'full'
}

/**
 * Phase 2c-C — interactive structured renderer for `find_sample_out_candidates`
 * artifacts. Replaces the static markdown table from the LLM narrative when
 * the artifact's `toolResults` payload contains structured candidate data.
 *
 * Read-only by design: rows show data and offer navigation/copy affordances,
 * never mutations against Metrc. The `Action` column is intentionally a
 * placeholder pill in this commit — Phase 4 (drafted writes) will populate
 * per-row affordances behind the per-org `copilotWritesEnabled` gate.
 */
export function CandidateTable({ rows, facilityId, mode }: CandidateTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('ageDays')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null)

  const sorted = useMemo(() => {
    if (mode === 'preview') {
      // Stable: trust the caller's order, take top 5.
      return rows.slice(0, 5)
    }
    const copy = rows.slice()
    copy.sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number | string
      const bv = (b[sortKey] ?? 0) as number | string
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
    return copy
  }, [rows, sortKey, sortDir, mode])

  const toggleSort = (key: SortKey) => {
    if (mode === 'preview') return
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const handleCopy = async (label: string) => {
    try {
      await navigator.clipboard.writeText(label)
      setCopiedLabel(label)
      setTimeout(() => setCopiedLabel(null), 1200)
    } catch {
      // clipboard not available (e.g. http) — silently fail
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No candidates available in this finding.
      </p>
    )
  }

  return (
    <div className={cn('rounded border border-border/60', mode === 'preview' && 'text-xs')}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8 text-[10px] uppercase tracking-wider text-muted-foreground">#</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">Package</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">Product</TableHead>
            <TableHead
              className={cn(
                'text-[10px] uppercase tracking-wider text-muted-foreground',
                mode === 'full' && 'cursor-pointer select-none hover:text-foreground',
              )}
              onClick={() => toggleSort('itemCategory')}
            >
              <span className="inline-flex items-center gap-1">
                Category
                {mode === 'full' && sortKey === 'itemCategory' && (
                  sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                )}
              </span>
            </TableHead>
            <TableHead
              className={cn(
                'text-[10px] uppercase tracking-wider text-muted-foreground text-right',
                mode === 'full' && 'cursor-pointer select-none hover:text-foreground',
              )}
              onClick={() => toggleSort('quantity')}
            >
              <span className="inline-flex items-center gap-1 justify-end">
                Qty
                {mode === 'full' && sortKey === 'quantity' && (
                  sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                )}
              </span>
            </TableHead>
            <TableHead
              className={cn(
                'text-[10px] uppercase tracking-wider text-muted-foreground text-right',
                mode === 'full' && 'cursor-pointer select-none hover:text-foreground',
              )}
              onClick={() => toggleSort('ageDays')}
            >
              <span className="inline-flex items-center gap-1 justify-end">
                Age (d)
                {mode === 'full' && sortKey === 'ageDays' && (
                  sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                )}
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row, i) => {
            const label = row.label ?? '—'
            const isCopied = copiedLabel === label
            return (
              <TableRow key={`${label}-${i}`} className="hover:bg-accent/20">
                <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                <TableCell className="font-mono text-[11px] max-w-[180px]">
                  <div className="flex items-center gap-1">
                    {facilityId ? (
                      <Link
                        href={`/facilities/${facilityId}/inventory/aging`}
                        className="truncate hover:text-primary hover:underline transition-colors"
                        title={`${label} — open aging inventory`}
                      >
                        {label}
                      </Link>
                    ) : (
                      <span className="truncate" title={label}>{label}</span>
                    )}
                    {row.label && (
                      <button
                        type="button"
                        onClick={() => handleCopy(label)}
                        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        title="Copy package label"
                      >
                        {isCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[160px] truncate" title={row.itemName ?? ''}>
                  {row.itemName ?? '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.itemCategory ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.quantity != null ? `${row.quantity}${row.unitOfMeasure ? ` ${row.unitOfMeasure}` : ''}` : '—'}
                </TableCell>
                <TableCell className={cn(
                  'text-right tabular-nums font-medium',
                  (row.ageDays ?? 0) >= 300 && 'text-red-400',
                  (row.ageDays ?? 0) >= 100 && (row.ageDays ?? 0) < 300 && 'text-amber-400',
                )}>
                  {row.ageDays ?? '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {mode === 'preview' && rows.length > 5 && (
        <div className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border/60">
          Showing 5 of {rows.length} candidates · Open the full report to see all
        </div>
      )}
    </div>
  )
}
