'use client'

import { useMemo } from 'react'
import { useKPIs, useKPIKeys } from '../OpExContext'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// KPI definitions — resolved dynamically from model kpiCells
// ---------------------------------------------------------------------------

interface KPIDef {
  key: string
  label: string
  format: 'currency' | 'percent' | 'currency_per_unit'
  unit?: string
}

// Known KPI key → label/format mapping (covers all 4 templates)
const KPI_META: Record<string, Omit<KPIDef, 'key'>> = {
  'pnl.annual_revenue': { label: 'Revenue', format: 'currency' },
  'pnl.total_annual_cost': { label: 'Cost', format: 'currency' },
  'pnl.cost_per_pound': { label: '$/lb', format: 'currency_per_unit', unit: '/lb' },
  'pnl.cost_per_unit': { label: '$/Unit', format: 'currency_per_unit', unit: '/unit' },
  'pnl.cost_per_transaction': { label: '$/Txn', format: 'currency_per_unit', unit: '/txn' },
  'pnl.cost_per_test': { label: '$/Test', format: 'currency_per_unit', unit: '/test' },
  'pnl.gross_margin_pct': { label: 'Margin', format: 'percent' },
  'pnl.gross_profit': { label: 'Profit', format: 'currency' },
  'pnl.taxable_profit': { label: 'Taxable Profit', format: 'currency' },
}

function formatKPI(value: number | null | undefined, format: string): string {
  if (value === null || value === undefined || isNaN(value)) return '--'

  switch (format) {
    case 'currency':
      return '$' + Math.round(value).toLocaleString()
    case 'currency_per_unit':
      return '$' + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    case 'percent':
      return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
    default:
      return value.toLocaleString()
  }
}

function getKPIColor(key: string, value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return 'text-muted-foreground'

  if (key === 'pnl.gross_margin_pct') {
    return value >= 40 ? 'text-emerald-400' : value >= 20 ? 'text-yellow-400' : 'text-red-400'
  }
  if (key === 'pnl.gross_profit' || key === 'pnl.taxable_profit') {
    return value >= 0 ? 'text-emerald-400' : 'text-red-400'
  }
  return 'text-foreground'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OpExKPIBar() {
  const kpis = useKPIs()
  const kpiKeys = useKPIKeys()

  // Build KPI definitions from the model's active kpiCells
  const kpiDefs = useMemo<KPIDef[]>(() =>
    kpiKeys.map((key) => {
      const meta = KPI_META[key]
      if (meta) return { key, ...meta }
      // Fallback for unknown keys: derive label from key
      const label = key.split('.').pop()?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? key
      return { key, label, format: 'currency' as const }
    }),
  [kpiKeys])

  return (
    <div className="sticky bottom-0 border-t border-border bg-card/95 backdrop-blur-sm px-4 py-3 z-10">
      <div className="flex items-center justify-between gap-4">
        {kpiDefs.map((kpi) => {
          const value = kpis[kpi.key]
          return (
            <div key={kpi.key} className="flex-1 text-center min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5 truncate">
                {kpi.label}
              </div>
              <div className={cn(
                'text-sm font-bold font-mono truncate',
                getKPIColor(kpi.key, value),
              )}>
                {formatKPI(value, kpi.format)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
