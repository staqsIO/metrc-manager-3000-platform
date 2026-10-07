'use client'

import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface BulkAction {
  key: string
  label: string
  icon: LucideIcon
  onClick: () => void
  variant?: 'primary' | 'destructive' | 'outline'
  disabled?: boolean
}

interface BulkActionBarProps {
  selectedCount: number
  icon: LucideIcon
  actions: BulkAction[]
  onClear: () => void
}

export function BulkActionBar({ selectedCount, icon: CountIcon, actions, onClear }: BulkActionBarProps) {
  if (selectedCount === 0) return null

  return (
    <div role="toolbar" aria-label="Bulk actions" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-2xl">
      <div className="flex items-center gap-2 pr-3 border-r border-border">
        <CountIcon className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{selectedCount} selected</span>
      </div>
      {actions.map((action) => (
        <button
          key={action.key}
          onClick={action.onClick}
          disabled={action.disabled}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
            action.variant === 'destructive'
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : action.variant === 'outline'
                ? 'border border-border bg-background text-foreground hover:bg-accent'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
          )}
        >
          <action.icon className="h-4 w-4" />
          {action.label}
        </button>
      ))}
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
