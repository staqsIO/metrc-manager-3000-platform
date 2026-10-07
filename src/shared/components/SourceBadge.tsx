'use client'

import { cn } from '@/lib/utils'
import type { CostSource } from '@/services/engines/cogs-engine'

interface SourceBadgeProps {
  /** Data source identifier */
  source: CostSource | 'metrc' | 'transfer_proxy'
  /** Optional confidence score (0-1) */
  confidence?: number
  /** Additional CSS classes */
  className?: string
}

const SOURCE_CONFIG: Record<string, { dot: string; label: string }> = {
  canix_purchase: { dot: 'bg-purple-500', label: 'ERP' },
  canix_bom: { dot: 'bg-purple-500', label: 'ERP' },
  canix_standard: { dot: 'bg-purple-500', label: 'ERP' },
  dutchie: { dot: 'bg-blue-500', label: 'POS' },
  dutchie_inferred: { dot: 'bg-zinc-400', label: 'Est.' },
  manual: { dot: 'bg-yellow-500', label: 'Manual' },
  metrc: { dot: 'bg-emerald-500', label: 'Metrc' },
  transfer_proxy: { dot: 'bg-zinc-400', label: 'Transfers' },
  none: { dot: 'bg-zinc-600', label: '—' },
}

/**
 * Small provenance indicator showing where a data point comes from.
 *
 * Colors follow the existing `getEnvironmentDotColor` convention:
 * - Metrc = green (authoritative)
 * - Dutchie POS = blue
 * - Canix ERP = purple
 * - Manual = yellow
 * - Estimated / proxy = gray
 */
export function SourceBadge({ source, confidence, className }: SourceBadgeProps) {
  const config = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.none

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] text-muted-foreground',
        className,
      )}
      title={confidence != null ? `${config.label} (${Math.round(confidence * 100)}% confidence)` : config.label}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
      {config.label}
    </span>
  )
}
