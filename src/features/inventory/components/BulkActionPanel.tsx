'use client'

import { Package, Trash2, CheckCircle, X, GitCompare } from 'lucide-react'

interface BulkActionPanelProps {
  selectedCount: number
  onAdjust: () => void
  onFinish: () => void
  onBulkEdit?: () => void
  onClear: () => void
}

export default function BulkActionPanel({ selectedCount, onAdjust, onFinish, onBulkEdit, onClear }: BulkActionPanelProps) {
  if (selectedCount === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-2xl">
      <div className="flex items-center gap-2 pr-3 border-r border-border">
        <Package className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{selectedCount} selected</span>
      </div>
      <button
        onClick={onAdjust}
        className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <CheckCircle className="h-4 w-4" />
        Adjust
      </button>
      <button
        onClick={onFinish}
        className="flex items-center gap-2 rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
      >
        <Trash2 className="h-4 w-4" />
        Finish
      </button>
      {onBulkEdit && (
        <button
          onClick={onBulkEdit}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <GitCompare className="h-4 w-4" />
          Bulk Edit
        </button>
      )}
      <button
        onClick={onClear}
        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title="Clear selection"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
