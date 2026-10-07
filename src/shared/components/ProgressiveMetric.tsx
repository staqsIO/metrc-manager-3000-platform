'use client'

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CostSource } from '@/services/engines/cogs-engine'
import { SourceBadge } from './SourceBadge'
import { EnrichmentPrompt } from './EnrichmentPrompt'

interface ProgressiveMetricProps {
  // ── Operational metric (always shown) ──────────────────────
  /** Primary metric value (weight, count, %, days) */
  value: string | number
  /** Label for the primary metric */
  label: string
  /** Icon for the metric */
  icon: LucideIcon
  /** Prefix (e.g., "#") */
  prefix?: string
  /** Suffix (e.g., "lbs", "days", "%") */
  suffix?: string
  /** Color class for the primary metric (default: text-foreground) */
  color?: string

  // ── Financial overlay (shown when available) ───────────────
  /** Financial value (e.g., dollar amount) — null/undefined means no financial data */
  financialValue?: string | number | null
  /** Label for the financial metric */
  financialLabel?: string
  /** Prefix for financial value (default: "$") */
  financialPrefix?: string
  /** Suffix for financial value */
  financialSuffix?: string

  // ── Data source attribution ────────────────────────────────
  /** Source of the financial data */
  source?: CostSource | 'metrc' | 'transfer_proxy'
  /** Confidence score (0-1) */
  confidence?: number

  // ── Enrichment CTA (when financial data could exist but doesn't) ──
  /** Which integration to suggest for financial enrichment */
  enrichmentIntegration?: 'canix' | 'dutchie' | 'opex' | 'supply'
  /** Custom enrichment message */
  enrichmentMessage?: string
  /** Callback when enrichment CTA is clicked */
  onEnrich?: () => void

  /** Additional CSS classes */
  className?: string
}

/**
 * Progressive metric card that always shows operational data
 * and conditionally enriches with financial data when available.
 *
 * Follows the KpiCard pattern but adds:
 * - Secondary financial line (when `financialValue` is provided)
 * - Source badge (data provenance indicator)
 * - Enrichment prompt (when financial data is missing but could exist)
 *
 * The operational metric is ALWAYS the primary display.
 * Financial data is additive, never blocking.
 */
export function ProgressiveMetric({
  value,
  label,
  icon: Icon,
  prefix,
  suffix,
  color = 'text-foreground',
  financialValue,
  financialLabel,
  financialPrefix = '$',
  financialSuffix,
  source,
  confidence,
  enrichmentIntegration,
  enrichmentMessage,
  onEnrich,
  className,
}: ProgressiveMetricProps) {
  const formattedValue = typeof value === 'number'
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : value

  const hasFinancialValue = financialValue != null && financialValue !== ''
  const formattedFinancial = hasFinancialValue
    ? typeof financialValue === 'number'
      ? financialValue.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : financialValue
    : null

  const showEnrichment = !hasFinancialValue && enrichmentIntegration != null

  return (
    <div className={cn('card-modern p-4', className)}>
      {/* Header: icon + label + source badge */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', color)} />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        {source && source !== 'none' && (
          <SourceBadge source={source} confidence={confidence} />
        )}
      </div>

      {/* Primary operational metric */}
      <p className={cn('text-2xl font-bold', color)}>
        {prefix}
        {formattedValue}
        {suffix && <span className="text-sm font-normal ml-1">{suffix}</span>}
      </p>

      {/* Financial overlay (when available) */}
      {hasFinancialValue && formattedFinancial && (
        <p className="text-sm text-muted-foreground mt-0.5">
          {financialLabel && <span className="mr-1">{financialLabel}:</span>}
          <span className="font-medium text-foreground/80">
            {financialPrefix}{formattedFinancial}
            {financialSuffix && <span className="ml-0.5">{financialSuffix}</span>}
          </span>
        </p>
      )}

      {/* Enrichment CTA (when financial data is missing) */}
      {showEnrichment && (
        <div className="mt-1.5">
          <EnrichmentPrompt
            integration={enrichmentIntegration}
            message={enrichmentMessage}
            onConnect={onEnrich}
            variant="inline"
          />
        </div>
      )}
    </div>
  )
}
