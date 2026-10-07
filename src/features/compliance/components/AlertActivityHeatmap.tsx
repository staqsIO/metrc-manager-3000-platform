'use client'

import { cn } from '@/lib/utils'

interface AlertActivityHeatmapProps {
  /** 7×24 matrix indexed `[dayOfWeek (0=Sun)][hour 0-23]`. */
  matrix: number[][]
  /** Maximum cell value used to scale opacity. 0 renders an all-empty grid. */
  max: number
  className?: string
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
// Re-map Sun-first JS getDay() to Mon-first display index.
const SUN_FIRST_TO_MON_FIRST = [6, 0, 1, 2, 3, 4, 5]

const HOUR_TICKS = [0, 6, 12, 18] as const

/**
 * Day-of-week × hour-of-day heatmap of alert activity. Mon-first row order
 * because cannabis ops are inherently weekday-shaped and "Sun first" buries
 * the weekend at the bottom where it deserves to be.
 *
 * Cell color: red intensity scaled by `count / max`. Empty cells (0) render
 * as a hairline outline so the grid remains readable when activity is sparse.
 */
export function AlertActivityHeatmap({ matrix, max, className }: AlertActivityHeatmapProps) {
  // Build display rows in Mon-first order.
  const displayRows: { day: string; cells: number[] }[] = SUN_FIRST_TO_MON_FIRST.map((sunIdx, monIdx) => ({
    day: DAY_LABELS[monIdx]!,
    cells: matrix[sunIdx] ?? new Array(24).fill(0),
  }))

  return (
    <div className={cn('w-full', className)}>
      <div className="flex flex-col gap-1">
        {displayRows.map((row) => (
          <div key={row.day} className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] uppercase tracking-instrument text-muted-foreground">
              {row.day}
            </span>
            <div className="flex-1 grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[2px]">
              {row.cells.map((count, hour) => (
                <HeatmapCell key={hour} count={count} max={max} day={row.day} hour={hour} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Hour-of-day axis */}
      <div className="flex items-center gap-2 mt-1.5">
        <span className="w-8 shrink-0" />
        <div className="flex-1 grid grid-cols-[repeat(24,minmax(0,1fr))]">
          {Array.from({ length: 24 }, (_, h) => (
            <span
              key={h}
              className="text-[9px] tabular-nums text-muted-foreground/70 text-center"
            >
              {HOUR_TICKS.includes(h as typeof HOUR_TICKS[number]) ? formatHour(h) : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function HeatmapCell({ count, max, day, hour }: { count: number; max: number; day: string; hour: number }) {
  const intensity = max > 0 ? count / max : 0
  // Empty cells: hairline border, no fill. Active cells: red with scaled
  // opacity. Floor at 0.15 so a single-alert cell is still visible.
  const isEmpty = count === 0
  const opacity = isEmpty ? 0 : Math.max(0.15, intensity)
  const label = `${day} ${formatHour(hour)} — ${count} ${count === 1 ? 'alert' : 'alerts'}`
  return (
    <div
      className={cn(
        'aspect-square rounded-sm',
        isEmpty ? 'border border-border/40' : '',
      )}
      style={isEmpty ? undefined : { backgroundColor: `hsl(var(--signal-critical) / ${opacity})` }}
      title={label}
      aria-label={label}
    />
  )
}

function formatHour(h: number): string {
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  if (h < 12) return `${h}a`
  return `${h - 12}p`
}
