import { cn } from '@/lib/utils'

/**
 * Optional source badge — origin annotation for data-provenance signaling
 * (e.g. "Metrc" / "Modeled" / "Mixed"). Renders as text + left-rule, not a
 * colored pill, so it doesn't compete with the value.
 */
export interface KpiSource {
  label: string
  tooltip?: string
}

export interface KpiCardProps {
  label: string
  value: React.ReactNode
  /** Optional lucide icon component shown next to the label, muted color. */
  icon?: React.ComponentType<{ className?: string }>
  /**
   * @deprecated Pass `valueClass` for status colors. The legacy `color` prop
   * was used to apply a Tailwind text class (`text-emerald-500` etc.) to
   * both the icon and the value — that violated the instrument-panel rule
   * that color signals status. Setting this is a no-op.
   */
  color?: string
  /** Subtitle below the value — small muted context (e.g. "last 30d"). */
  subtitle?: string
  /** Provenance / data-source annotation, rendered top-right. */
  source?: KpiSource
  /**
   * Override the value color. Default is foreground neutral. Use this only
   * when the metric earns a status color (e.g. waste-rate critical).
   */
  valueClass?: string
  trend?: {
    value: number
    sentiment?: 'positive-up' | 'positive-down' | 'neutral'
  }
  /**
   * Optional historical series rendered as a small monochrome sparkline next
   * to the value (Braintrust-style inline trend indicator). 2+ points
   * required; fewer renders nothing. Color tracks the value color via
   * `currentColor` so it inherits whatever `valueClass` resolves to.
   */
  sparkline?: number[]
  variant?: 'default' | 'compact'
  loading?: boolean
  children?: React.ReactNode
  className?: string
}

/**
 * Pure-SVG sparkline. No chart library — keeps the KpiCard primitive
 * dependency-free. 80×24 polyline at 1px stroke, color via currentColor.
 */
function InlineSparkline({ data, width = 80, height = 24 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / span) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="opacity-60 shrink-0"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function getTrendColor(
  value: number,
  sentiment: 'positive-up' | 'positive-down' | 'neutral' = 'positive-up'
): string {
  if (sentiment === 'neutral' || value === 0) return 'text-muted-foreground'
  const isPositive = sentiment === 'positive-up' ? value > 0 : value < 0
  // Phosphor accent for positive, signal-critical for negative — no emerald,
  // no red. Both reference --primary / --signal-critical CSS variables via
  // the inline style so they cannot drift from the global tokens.
  return isPositive ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--signal-critical))]'
}

function TrendArrow({ value }: { value: number }) {
  // Typographic arrows instead of lucide icons — instrument readout vibe.
  if (value > 0) return <span aria-hidden>↑</span>
  if (value < 0) return <span aria-hidden>↓</span>
  return <span aria-hidden>—</span>
}

/**
 * Canonical KPI tile — the instrument-panel pattern used across /executive,
 * /executive/operations, /operations, and the Inventory / Harvests / Dashboard
 * KPI strips. Pages should import this rather than redefining their own.
 *
 * Layout:
 *   [icon] LABEL                                          [source]
 *   <big mono value>
 *   subtitle (optional)
 *   trend arrow + percent (optional)
 *
 * Color rules:
 *   - Label, icon, subtitle, source: muted-foreground
 *   - Value: foreground neutral by default; status color via valueClass
 *   - Trend: --primary for positive, --signal-critical for negative
 */
export function KpiCard({
  label,
  value,
  icon: Icon,
  subtitle,
  source,
  valueClass,
  trend,
  sparkline,
  variant = 'default',
  loading,
  children,
  className,
}: KpiCardProps) {
  const isCompact = variant === 'compact'

  return (
    <div
      className={cn(
        'border border-border bg-card min-w-0',
        isCompact ? 'p-3' : 'p-4',
        className,
      )}
    >
      {/* Label row — icon + tracked uppercase + optional source badge */}
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <span className="text-[10px] font-sans uppercase tracking-instrument text-muted-foreground truncate">
          {label}
        </span>
        {source && (
          <span
            className="ml-auto text-[9px] uppercase tracking-instrument text-muted-foreground/70 border-l border-border pl-1.5 shrink-0"
            title={source.tooltip}
          >
            {source.label.replace(/^●\s*/, '')}
          </span>
        )}
      </div>

      {/* Value row — monospace tabular-nums + optional inline sparkline.
          The sparkline (when present) inherits color via `currentColor` so
          it tracks the value's status color automatically. */}
      <div
        className={cn(
          'flex items-baseline gap-3 min-w-0',
          valueClass ?? 'text-foreground',
        )}
      >
        <div
          className={cn(
            'font-numeric tabular-nums font-medium truncate',
            isCompact ? 'text-xl' : 'text-2xl',
          )}
        >
          {loading ? (
            // Pulsing skeleton bar instead of an em-dash — a static `—` reads
            // as "no data" rather than "still loading," which was confusing
            // operators waiting on a populated dashboard.
            <span
              className="inline-block bg-muted/40 rounded animate-pulse align-middle h-[0.7em] w-20"
              aria-label="Loading value"
            />
          ) : value}
        </div>
        {!loading && sparkline && sparkline.length >= 2 && (
          <InlineSparkline data={sparkline} />
        )}
      </div>

      {subtitle && (
        <div className="text-[10px] text-muted-foreground mt-1 truncate">
          {subtitle}
        </div>
      )}

      {/* Trend — typographic arrow + percentage */}
      {trend && (
        <div
          className={cn(
            'flex items-baseline gap-1 mt-2 text-xs font-numeric tabular-nums',
            getTrendColor(trend.value, trend.sentiment),
          )}
        >
          <TrendArrow value={trend.value} />
          <span>{Math.abs(trend.value).toFixed(1)}%</span>
        </div>
      )}

      {children}
    </div>
  )
}
