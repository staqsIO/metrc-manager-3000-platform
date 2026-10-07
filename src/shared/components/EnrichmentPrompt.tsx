'use client'

import { cn } from '@/lib/utils'
import { ArrowUpRight } from 'lucide-react'

interface EnrichmentPromptProps {
  /** Which integration to suggest connecting */
  integration: 'canix' | 'dutchie' | 'opex' | 'supply'
  /** Custom message (overrides default per-integration text) */
  message?: string
  /** Callback when the CTA is clicked (e.g., open FacilitySettingsModal to relevant tab) */
  onConnect?: () => void
  /** Additional CSS classes */
  className?: string
  /** Render as a compact inline hint vs. a bordered block */
  variant?: 'inline' | 'block'
}

const DEFAULT_MESSAGES: Record<string, string> = {
  canix: 'Connect ERP to see cost data',
  dutchie: 'Connect POS to see sales velocity',
  opex: 'Add cost data to see dollar values',
  supply: 'Add supply items to track materials',
}

/**
 * Non-blocking inline CTA suggesting an integration connection.
 *
 * Unlike `EmptyState`, this component NEVER replaces content.
 * It appears alongside operational data to indicate that
 * connecting an additional data source would enrich the view.
 *
 * - `inline` variant: subtle text with arrow, for use inside KPI cards
 * - `block` variant: dashed-border container, for use in data sections
 */
export function EnrichmentPrompt({
  integration,
  message,
  onConnect,
  className,
  variant = 'inline',
}: EnrichmentPromptProps) {
  const text = message ?? DEFAULT_MESSAGES[integration] ?? 'Connect a data source for more detail'

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={onConnect}
        className={cn(
          'inline-flex items-center gap-1 text-[11px] text-muted-foreground/70',
          'hover:text-muted-foreground transition-colors',
          onConnect ? 'cursor-pointer' : 'cursor-default',
          className,
        )}
      >
        {text}
        {onConnect && <ArrowUpRight className="h-3 w-3" />}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onConnect}
      className={cn(
        'w-full rounded-lg border border-dashed border-zinc-700/50 px-4 py-3',
        'flex items-center gap-2 text-xs text-muted-foreground/60',
        'hover:border-zinc-600/50 hover:text-muted-foreground/80 transition-colors',
        onConnect ? 'cursor-pointer' : 'cursor-default',
        className,
      )}
    >
      <span className="flex-1 text-left">{text}</span>
      {onConnect && <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0" />}
    </button>
  )
}
