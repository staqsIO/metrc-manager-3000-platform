'use client'

import { cn } from '@/lib/utils'

/**
 * Shows a delta indicator (e.g., "↓4" in green or "↑3" in red) next to a metric.
 * By default, lower = better (green ↓) — suitable for violations, aging, holds.
 * Set `invertColor` for metrics where higher = better (e.g., audit score, weeks of supply).
 */
export function DeltaBadge({
  current,
  previous,
  invertColor = false,
}: {
  current: number
  previous: number | null | undefined
  invertColor?: boolean
}) {
  if (previous == null) return null
  const diff = current - previous
  if (diff === 0) return null

  const isIncrease = diff > 0
  // By default: decrease = good (green), increase = bad (red)
  // invertColor flips: increase = good (green), decrease = bad (red)
  const isGood = invertColor ? isIncrease : !isIncrease

  return (
    <span
      className={cn(
        'inline-flex items-center text-[10px] font-semibold tabular-nums ml-1 px-1 py-0.5 rounded',
        isGood
          ? 'text-emerald-500 bg-emerald-500/10'
          : 'text-red-500 bg-red-500/10',
      )}
      title={`Previous: ${previous}`}
    >
      {isIncrease ? '↑' : '↓'}
      {Math.abs(diff)}
    </span>
  )
}
