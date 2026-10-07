'use client'

import { useCell } from '../OpExContext'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Value formatting
// ---------------------------------------------------------------------------

function formatPnLValue(value: number | null, key: string): string {
  if (value === null || isNaN(value)) return '--'

  if (key.includes('margin') || key.includes('pct')) {
    return value.toFixed(1) + '%'
  }
  if (key.includes('per_pound') || key.includes('per_lb') || key.includes('per_sqft')) {
    return '$' + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  // Default: currency (whole dollars)
  return '$' + Math.round(value).toLocaleString()
}

// ---------------------------------------------------------------------------
// P&L Line — subscribes to a single cell via useCell
// ---------------------------------------------------------------------------

function PnLLine({
  cellKey,
  label,
  indent = 0,
  bold = false,
  highlight = false,
}: {
  cellKey: string
  label: string
  indent?: number
  bold?: boolean
  highlight?: boolean
}) {
  const cell = useCell(cellKey)
  const value = cell.value

  return (
    <div
      className={cn(
        'flex items-center justify-between py-1.5 px-3',
        indent === 1 && 'pl-7',
        indent === 2 && 'pl-11',
        bold && 'font-semibold',
        highlight && 'bg-primary/5 rounded-md',
      )}
    >
      <span
        className={cn(
          'text-sm',
          bold ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'text-sm font-mono',
          value !== null && value < 0 ? 'text-red-400' : '',
          value !== null && value > 0 && highlight ? 'text-emerald-400' : '',
          bold ? 'font-bold' : '',
        )}
      >
        {formatPnLValue(value, cellKey)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section divider
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="pt-4 pb-1 px-3">
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1">
        {title}
      </h4>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subtotal divider
// ---------------------------------------------------------------------------

function SubtotalLine() {
  return <div className="border-t border-border/50 mx-3 my-1" />
}

// ---------------------------------------------------------------------------
// P&L View — full financial statement
// ---------------------------------------------------------------------------

export default function OpExPnLView() {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-lg font-bold mb-4">Profit & Loss Statement</h2>

      {/* Revenue */}
      <SectionHeader title="Revenue" />
      <PnLLine cellKey="core.annual_harvests" label="Harvests Per Year" indent={1} />
      <PnLLine cellKey="core.yield_per_harvest_lbs" label="Yield Per Harvest (lbs)" indent={1} />
      <PnLLine cellKey="core.annual_yield_lbs" label="Annual Yield (lbs)" indent={1} />
      <PnLLine cellKey="core.avg_price_per_lb" label="Avg Price Per Pound" indent={1} />
      <SubtotalLine />
      <PnLLine cellKey="pnl.annual_revenue" label="Total Revenue" bold highlight />

      {/* COGS — Cultivation */}
      <SectionHeader title="Cost of Goods Sold" />
      <PnLLine cellKey="cultivation.annual_media_cost" label="Grow Media" indent={1} />
      <PnLLine cellKey="cultivation.annual_nutrient_cost" label="Nutrients" indent={1} />
      <PnLLine cellKey="cultivation.annual_clone_cost" label="Clones / Plant Inputs" indent={1} />
      <PnLLine cellKey="cultivation.annual_ipm_cost" label="IPM & Pest Control" indent={1} />
      <PnLLine cellKey="cultivation-env.annual_hvac_maint" label="HVAC Maintenance" indent={1} />

      {/* COGS — Post-Harvest */}
      <PnLLine cellKey="postharvest.annual_trim_cost" label="Trimming" indent={1} />
      <PnLLine cellKey="postharvest.annual_packaging_cost" label="Packaging" indent={1} />
      <PnLLine cellKey="postharvest.annual_testing_cost" label="Lab Testing" indent={1} />

      {/* COGS — Labor */}
      <PnLLine cellKey="labor.total_annual_labor" label="Total Labor (with Benefits)" indent={1} />

      {/* COGS — Consumables & Utilities */}
      <PnLLine cellKey="consumables.annual_total" label="Consumables" indent={1} />
      <PnLLine cellKey="utilities.annual_total" label="Utilities" indent={1} />

      {/* Facility & Overhead */}
      <PnLLine cellKey="facility.annual_total" label="Facility & Overhead" indent={1} />

      {/* Taxes */}
      <PnLLine cellKey="taxes.total_annual_tax" label="Taxes" indent={1} />

      <SubtotalLine />
      <PnLLine cellKey="pnl.total_annual_cost" label="Total Annual Cost" bold />

      {/* Profitability */}
      <SectionHeader title="Profitability" />
      <PnLLine cellKey="pnl.gross_profit" label="Gross Profit" bold highlight />
      <PnLLine cellKey="pnl.gross_margin_pct" label="Gross Margin %" bold />
      <PnLLine cellKey="pnl.cost_per_pound" label="Cost Per Pound" />
      <PnLLine cellKey="core.yield_per_sqft" label="Yield Per Sq Ft (lbs/sqft)" />

      {/* Tax Detail */}
      <SectionHeader title="Tax Detail" />
      <PnLLine cellKey="taxes.annual_excise" label="Excise Tax" indent={1} />
      <PnLLine cellKey="taxes.annual_cultivation_tax" label="Cultivation Tax" indent={1} />
      <PnLLine cellKey="taxes.annual_local" label="Local / City Tax" indent={1} />
      <SubtotalLine />
      <PnLLine cellKey="taxes.total_annual_tax" label="Total Tax Burden" bold />

      {/* Net Profit */}
      <SectionHeader title="Net Result" />
      <PnLLine cellKey="pnl.taxable_profit" label="Taxable Profit (Pre-280E)" bold highlight />
    </div>
  )
}
