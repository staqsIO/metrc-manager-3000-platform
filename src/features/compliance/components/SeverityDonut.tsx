'use client'

import { cn } from '@/lib/utils'

interface SeverityDonutProps {
  critical: number
  warning: number
  info: number
  className?: string
}

interface Bucket {
  label: 'Critical' | 'Warning' | 'Info'
  count: number
  /** CSS color for the donut arc and list dot. */
  color: string
}

const TWO_PI_R = 2 * Math.PI * 16 // radius=16 → circumference≈100.53

/**
 * Compact donut chart of open compliance alerts paired with a sorted list
 * of the same buckets. The donut answers "how is risk weighted?" at a
 * glance; the list answers "what's the exact count and share?" — together
 * they give the same data twice in two different shapes, which is much
 * more readable than a standalone pie.
 *
 * Order in the list is fixed (Critical → Warning → Info) so the eye lands
 * on the worst severity first regardless of count distribution.
 */
export function SeverityDonut({ critical, warning, info, className }: SeverityDonutProps) {
  const total = critical + warning + info
  const buckets: Bucket[] = [
    { label: 'Critical', count: critical, color: 'hsl(var(--signal-critical))' },
    { label: 'Warning', count: warning, color: 'hsl(var(--signal-caution))' },
    { label: 'Info', count: info, color: 'hsl(var(--primary))' },
  ]

  // Build cumulative arcs. Each segment is a separate <circle> with
  // stroke-dasharray sized to its share, offset by what came before it.
  let cumulative = 0
  const segments = buckets.map((b) => {
    const share = total > 0 ? b.count / total : 0
    const length = share * TWO_PI_R
    const offset = -cumulative
    cumulative += length
    return { ...b, length, offset }
  })

  return (
    <div className={cn('flex items-center gap-5', className)}>
      {/* Donut */}
      <div className="relative shrink-0" style={{ width: 96, height: 96 }}>
        <svg viewBox="0 0 40 40" width={96} height={96} className="-rotate-90">
          {/* Track ring — visible when total = 0 */}
          <circle
            cx={20}
            cy={20}
            r={16}
            fill="none"
            stroke="hsl(var(--muted) / 0.4)"
            strokeWidth={5}
          />
          {total > 0 &&
            segments.map((s) =>
              s.count > 0 ? (
                <circle
                  key={s.label}
                  cx={20}
                  cy={20}
                  r={16}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={5}
                  strokeDasharray={`${s.length} ${TWO_PI_R - s.length}`}
                  strokeDashoffset={s.offset}
                  strokeLinecap="butt"
                />
              ) : null,
            )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-numeric tabular-nums font-medium leading-none">
            {total}
          </span>
          <span className="text-[10px] uppercase tracking-instrument text-muted-foreground mt-0.5">
            Open
          </span>
        </div>
      </div>

      {/* List */}
      <ul className="flex-1 min-w-0 space-y-1.5">
        {buckets.map((b) => {
          const pct = total > 0 ? Math.round((b.count / total) * 100) : 0
          return (
            <li key={b.label} className="flex items-center gap-2 text-sm">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: b.color }}
                aria-hidden
              />
              <span className="text-muted-foreground">{b.label}</span>
              <span className="ml-auto font-numeric tabular-nums text-foreground">
                {b.count}
              </span>
              <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">
                {pct}%
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
