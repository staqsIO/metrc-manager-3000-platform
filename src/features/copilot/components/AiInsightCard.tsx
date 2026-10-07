'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { Sparkles, ArrowRight, ShieldAlert, AlertTriangle, Package, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCopilot } from '../CopilotContext'

interface AiInsightCardProps {
  facilityId: string
  /** Filter insights to only show ones matching these severity levels */
  severities?: ('critical' | 'warning' | 'info' | 'success')[]
  /** Maximum number of insights to show */
  maxInsights?: number
  /** Follow-up prompt for the "Ask Copilot" button */
  followUpPrompt?: string
  className?: string
}

const severityStyles: Record<string, string> = {
  critical: 'border-l-red-500 bg-red-500/5',
  warning: 'border-l-yellow-500 bg-yellow-500/5',
  info: 'border-l-blue-500 bg-blue-500/5',
  success: 'border-l-emerald-500 bg-emerald-500/5',
}

const severityIcons: Record<string, React.ReactNode> = {
  critical: <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />,
  warning: <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />,
  info: <Package className="h-4 w-4 text-blue-500 shrink-0" />,
  success: <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />,
}

export default function AiInsightCard({
  facilityId,
  severities,
  maxInsights = 3,
  followUpPrompt,
  className,
}: AiInsightCardProps) {
  const { open } = useCopilot()

  const { data: briefing, isLoading } = trpc.copilot.getBriefing.useQuery(
    { facilityId },
    { staleTime: 300_000 },
  )

  if (isLoading) {
    return (
      <div className={cn('card-modern p-4 animate-pulse', className)}>
        <div className="h-4 bg-muted rounded w-32 mb-3" />
        <div className="space-y-2">
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-3/4" />
        </div>
      </div>
    )
  }

  if (!briefing) return null

  let insights = briefing.insights
  if (severities) {
    insights = insights.filter(i => severities.includes(i.severity))
  }
  insights = insights.slice(0, maxInsights)

  if (insights.length === 0) return null

  return (
    <div className={cn('card-modern p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">AI Insights</span>
        </div>
        <button
          onClick={() => open(followUpPrompt ?? 'What actions should I take right now based on these insights?')}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          Ask Copilot <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-2">
        {insights.map((insight, i) => {
          // Each getBriefing insight carries an optional `link` to the page
          // that lists the offending packages (aging, FIFO, audit, etc.).
          // Wrap clickable insights in a Link so operators get to the actual
          // list — they were dead-ending on the static card before.
          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {severityIcons[insight.severity]}
                  <span className="text-sm font-medium truncate">{insight.title}</span>
                </div>
                {insight.link && insight.action && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-xs text-foreground/80">
                    {insight.action}
                    <ArrowRight className="h-3 w-3" />
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 ml-6">{insight.detail}</p>
            </>
          )
          const baseClasses = cn(
            'border-l-2 rounded-r-lg px-3 py-2 block',
            severityStyles[insight.severity],
          )
          return insight.link ? (
            <Link
              key={i}
              href={insight.link}
              className={cn(baseClasses, 'hover:bg-muted/30 transition-colors')}
            >
              {body}
            </Link>
          ) : (
            <div key={i} className={baseClasses}>
              {body}
            </div>
          )
        })}
      </div>
    </div>
  )
}
