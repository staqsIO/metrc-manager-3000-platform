'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp, CheckCircle2, AlertTriangle } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/components/ui/popover'

type FifoViolationDetail = {
  newerLabel: string
  olderLabel: string
  category: string
  strain: string
  daysDifference: number
}

function violationKey(v: FifoViolationDetail) {
  return `${v.newerLabel}::${v.olderLabel}`
}

function truncateLabel(label: string) {
  return label.length > 8 ? '…' + label.slice(-8) : label
}

/**
 * Shows a clickable delta badge for FIFO violations that opens a popover
 * listing resolved and new violations since the last snapshot.
 */
export function FifoChangesPopover({
  currentViolations,
  previousViolations,
  snapshotDate,
}: {
  currentViolations: FifoViolationDetail[]
  previousViolations: FifoViolationDetail[] | undefined
  snapshotDate: Date | string | undefined
}) {
  const [open, setOpen] = useState(false)

  const { resolved, added, diff } = useMemo(() => {
    if (!previousViolations) return { resolved: [], added: [], diff: 0 }

    const prevKeys = new Set(previousViolations.map(violationKey))
    const currKeys = new Set(currentViolations.map(violationKey))

    const resolvedItems = previousViolations.filter(v => !currKeys.has(violationKey(v)))
    const addedItems = currentViolations.filter(v => !prevKeys.has(violationKey(v)))

    return {
      resolved: resolvedItems,
      added: addedItems,
      diff: currentViolations.length - previousViolations.length,
    }
  }, [currentViolations, previousViolations])

  if (!previousViolations || (resolved.length === 0 && added.length === 0)) return null

  const isImproved = diff <= 0 && resolved.length > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center text-[10px] font-semibold tabular-nums ml-1 px-1.5 py-0.5 rounded cursor-pointer transition-colors',
            isImproved
              ? 'text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20'
              : 'text-red-500 bg-red-500/10 hover:bg-red-500/20',
          )}
          title="Click to see FIFO violation changes"
        >
          {diff > 0 ? '↑' : diff < 0 ? '↓' : '±'}
          {Math.abs(diff)}
          {open ? (
            <ChevronUp className="h-2.5 w-2.5 ml-0.5" />
          ) : (
            <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start" sideOffset={6}>
        <div className="px-3 py-2 border-b border-border">
          <p className="text-xs font-semibold">FIFO Violation Changes</p>
          {snapshotDate && (
            <p className="text-[10px] text-muted-foreground">
              vs. snapshot from {new Date(snapshotDate).toLocaleDateString()}
            </p>
          )}
        </div>

        <div className="max-h-[320px] overflow-y-auto scrollbar-modern">
          {/* Resolved violations */}
          {resolved.length > 0 && (
            <div className="px-3 py-2">
              <div className="flex items-center gap-1.5 mb-1.5">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                <span className="text-[11px] font-semibold text-emerald-500">
                  {resolved.length} Resolved
                </span>
              </div>
              <div className="space-y-1">
                {resolved.slice(0, 10).map((v, i) => (
                  <div
                    key={i}
                    className="text-[11px] rounded px-2 py-1 bg-emerald-500/5 border border-emerald-500/10"
                  >
                    <span className="text-muted-foreground">{v.category}</span>
                    {v.strain && (
                      <span className="text-muted-foreground"> · {v.strain}</span>
                    )}
                    <div className="flex items-center gap-1 mt-0.5">
                      <code className="text-[10px]">{truncateLabel(v.newerLabel)}</code>
                      <span className="text-muted-foreground/60">→</span>
                      <code className="text-[10px]">{truncateLabel(v.olderLabel)}</code>
                      <span className="text-muted-foreground/40 ml-auto">{v.daysDifference}d gap</span>
                    </div>
                  </div>
                ))}
                {resolved.length > 10 && (
                  <p className="text-[10px] text-muted-foreground pl-2">
                    +{resolved.length - 10} more resolved
                  </p>
                )}
              </div>
            </div>
          )}

          {/* New violations */}
          {added.length > 0 && (
            <div className={cn('px-3 py-2', resolved.length > 0 && 'border-t border-border')}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="h-3 w-3 text-red-500" />
                <span className="text-[11px] font-semibold text-red-500">
                  {added.length} New
                </span>
              </div>
              <div className="space-y-1">
                {added.slice(0, 10).map((v, i) => (
                  <div
                    key={i}
                    className="text-[11px] rounded px-2 py-1 bg-red-500/5 border border-red-500/10"
                  >
                    <span className="text-muted-foreground">{v.category}</span>
                    {v.strain && (
                      <span className="text-muted-foreground"> · {v.strain}</span>
                    )}
                    <div className="flex items-center gap-1 mt-0.5">
                      <code className="text-[10px]">{truncateLabel(v.newerLabel)}</code>
                      <span className="text-muted-foreground/60">→</span>
                      <code className="text-[10px]">{truncateLabel(v.olderLabel)}</code>
                      <span className="text-muted-foreground/40 ml-auto">{v.daysDifference}d gap</span>
                    </div>
                  </div>
                ))}
                {added.length > 10 && (
                  <p className="text-[10px] text-muted-foreground pl-2">
                    +{added.length - 10} more new
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Summary footer */}
        <div className="px-3 py-1.5 border-t border-border bg-muted/30 text-[10px] text-muted-foreground">
          Now: {currentViolations.length} · Previously: {previousViolations.length}
        </div>
      </PopoverContent>
    </Popover>
  )
}
