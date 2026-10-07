'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type RouterOutputs = inferRouterOutputs<AppRouter>
export type TransferOpportunity =
  RouterOutputs['crossFacility']['getRunRateComparison']['transferOpportunities'][number]

interface TransferOpportunityRowProps {
  opportunity: TransferOpportunity
  className?: string
}

/**
 * One row of a transfer opportunity recommendation. Each row carries three
 * actionable links so operators can act on the suggestion rather than just
 * read it: source facility name → source inventory, target facility name →
 * target inventory, and a trailing "Plan transfer →" CTA → source's
 * transfers page (where the actual Metrc transfer is created).
 *
 * Used on /operations (Inventory Flow) and /executive/states/[stateCode],
 * extracted into shared so both pages stay in sync.
 */
export function TransferOpportunityRow({ opportunity, className }: TransferOpportunityRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-sm py-1.5 px-2 rounded hover:bg-accent/30 transition-colors',
        className,
      )}
    >
      <span className={cn(
        'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase',
        opportunity.urgency === 'high'
          ? 'bg-red-500/20 text-red-400'
          : 'bg-yellow-500/20 text-yellow-400',
      )}>
        {opportunity.urgency}
      </span>
      <span className="font-medium">{opportunity.category}</span>
      <span className="text-muted-foreground">&mdash;</span>
      <Link
        href={`/facilities/${opportunity.fromFacility.id}/inventory`}
        className="text-blue-400 hover:text-blue-300 hover:underline transition-colors"
        title={`View ${opportunity.fromFacility.name} inventory`}
      >
        {opportunity.fromFacility.name}
      </Link>
      <span className="text-xs text-muted-foreground">({opportunity.fromFacility.weeksOfSupply}w, excess)</span>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <Link
        href={`/facilities/${opportunity.toFacility.id}/inventory`}
        className="text-red-400 hover:text-red-300 hover:underline transition-colors"
        title={`View ${opportunity.toFacility.name} inventory`}
      >
        {opportunity.toFacility.name}
      </Link>
      <span className="text-xs text-muted-foreground">({opportunity.toFacility.weeksOfSupply}w)</span>
      <span className="text-muted-foreground">&mdash;</span>
      <span className="font-medium">~{opportunity.suggestedUnits.toLocaleString()} units</span>
      <Link
        href={`/facilities/${opportunity.fromFacility.id}/transfers`}
        className="ml-auto inline-flex items-center gap-1 text-xs text-foreground hover:text-primary transition-colors border-l border-border pl-2"
        title={`Start a transfer from ${opportunity.fromFacility.name}`}
      >
        Plan transfer
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  )
}
