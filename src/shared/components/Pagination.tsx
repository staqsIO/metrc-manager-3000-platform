'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  page: number
  totalPages: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, totalPages, pageSize, total, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null

  const start = ((page - 1) * pageSize) + 1
  const end = Math.min(page * pageSize, total)

  return (
    <nav
      role="navigation"
      aria-label="Pagination"
      className="flex items-center justify-between px-4 py-3 border-t border-border"
    >
      <p className="text-xs text-muted-foreground">
        Showing {start}&ndash;{end} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label="Go to previous page"
          className="p-2 rounded hover:bg-muted disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs px-2">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          aria-label="Go to next page"
          className="p-2 rounded hover:bg-muted disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  )
}
