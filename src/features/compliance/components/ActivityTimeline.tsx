'use client'

import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  XCircle,
  Eye,
  Play,
  RotateCcw,
  Loader2,
  Activity,
} from 'lucide-react'
import type { ActionLogSummary } from '@/services/engines/audit-readiness-engine'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ActivityTimelineProps {
  actions: ActionLogSummary[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  COMPLETED: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'Completed' },
  FAILED: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Failed' },
  PREVIEWING: { icon: Eye, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Preview' },
  CONFIRMED: { icon: Play, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Confirmed' },
  EXECUTING: { icon: Loader2, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Executing' },
  ROLLED_BACK: { icon: RotateCcw, color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'Rolled Back' },
}

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { icon: Activity, color: 'text-muted-foreground', bg: 'bg-muted', label: status }
}

function formatActionType(actionType: string): string {
  return actionType
    .replace(/^AUDIT_/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function groupByDate(actions: ActionLogSummary[]): { date: string; actions: ActionLogSummary[] }[] {
  const groups: Map<string, ActionLogSummary[]> = new Map()
  for (let i = 0; i < actions.length; i++) {
    const dateKey = actions[i].createdAt.substring(0, 10)
    const existing = groups.get(dateKey)
    if (existing) {
      existing.push(actions[i])
    } else {
      groups.set(dateKey, [actions[i]])
    }
  }
  const result: { date: string; actions: ActionLogSummary[] }[] = []
  const entries = Array.from(groups.entries())
  for (let i = 0; i < entries.length; i++) {
    result.push({ date: entries[i][0], actions: entries[i][1] })
  }
  return result
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ActivityTimeline({ actions }: ActivityTimelineProps) {
  if (actions.length === 0) {
    return (
      <div className="card-modern p-8 text-center">
        <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="font-medium">No recent activity</p>
        <p className="text-sm text-muted-foreground">No actions have been recorded for this facility.</p>
      </div>
    )
  }

  const groups = groupByDate(actions)

  return (
    <div className="space-y-6">
      {groups.map(group => (
        <div key={group.date}>
          {/* Date header */}
          <div className="flex items-center gap-2 mb-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium text-muted-foreground px-2">
              {formatDate(group.actions[0].createdAt)}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Timeline entries */}
          <div className="space-y-2">
            {group.actions.map(action => {
              const config = getStatusConfig(action.status)
              const Icon = config.icon
              const isFailed = action.status === 'FAILED'

              return (
                <div
                  key={action.id}
                  className={cn(
                    'card-modern p-3 flex items-start gap-3',
                    isFailed && 'border-l-2 border-l-red-500',
                  )}
                >
                  {/* Status icon */}
                  <div className={cn('mt-0.5 rounded-full p-1.5', config.bg)}>
                    <Icon className={cn('h-3.5 w-3.5', config.color)} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{formatActionType(action.actionType)}</span>
                      <Badge variant="outline" className="text-[11px]">{action.targetType}</Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[11px]',
                          config.color,
                          action.status === 'COMPLETED' && 'border-emerald-500/20',
                          action.status === 'FAILED' && 'border-red-500/20',
                          action.status === 'PREVIEWING' && 'border-blue-500/20',
                        )}
                      >
                        {config.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">
                        {formatTimestamp(action.createdAt)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {action.targetCount} target(s)
                    </div>
                    {isFailed && action.errorMessage && (
                      <div className="mt-1.5 rounded bg-red-500/10 px-2 py-1 text-xs text-red-500">
                        {action.errorMessage}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
