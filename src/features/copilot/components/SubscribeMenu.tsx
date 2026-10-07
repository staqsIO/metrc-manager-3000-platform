'use client'

import { useState } from 'react'
import { Bell, BellOff, Calendar, Check, Loader2 } from 'lucide-react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'

interface SchedulePreset {
  id: string
  label: string
  description: string
  cron: string
}

const PRESETS: SchedulePreset[] = [
  { id: 'hourly', label: 'Every hour', description: 'On the hour, every hour', cron: '0 * * * *' },
  { id: 'daily-9', label: 'Daily at 9 AM', description: 'Once a day at 9:00 (server tz)', cron: '0 9 * * *' },
  { id: 'weekday-9', label: 'Weekdays at 9 AM', description: 'Mon–Fri at 9:00', cron: '0 9 * * 1-5' },
  { id: 'monday-9', label: 'Mondays at 9 AM', description: 'Once a week, week start', cron: '0 9 * * 1' },
  { id: 'sunday-night', label: 'Sunday nights', description: 'Once a week at 10 PM', cron: '0 22 * * 0' },
]

interface SubscribeMenuProps {
  runId: string
  /** Existing schedule cron expression, if any. Drives the active state. */
  currentCron?: string | null
  currentTriggerOn?: 'change' | 'always' | null
  onChange?: () => void
  /** When true, renders a compact icon-only trigger. */
  compact?: boolean
}

/**
 * Phase 3 — Subscribe button. Sets `Run.scheduleSpec` to a preset cron, which
 * the agent-runs cron worker picks up at next firing. Default `triggerOn`
 * is 'change' so operators only get pinged when the underlying findings
 * actually move, not on every uneventful tick.
 */
export function SubscribeMenu({ runId, currentCron, currentTriggerOn, onChange, compact = false }: SubscribeMenuProps) {
  const [open, setOpen] = useState(false)
  const [triggerOn, setTriggerOn] = useState<'change' | 'always'>(currentTriggerOn ?? 'change')
  const setSchedule = trpc.runs.setSchedule.useMutation()
  const utils = trpc.useUtils()
  const isSubscribed = !!currentCron

  const matchedPreset = PRESETS.find((p) => p.cron === currentCron) ?? null

  const apply = async (preset: SchedulePreset | null) => {
    await setSchedule.mutateAsync({
      runId,
      scheduleSpec: preset ? { cron: preset.cron, triggerOn } : null,
    })
    await utils.runs.list.invalidate()
    onChange?.()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors',
            compact ? 'px-2 py-1' : 'px-3 py-1.5',
            isSubscribed
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-border text-muted-foreground hover:bg-accent',
          )}
          title={isSubscribed
            ? `Subscribed: ${matchedPreset?.label ?? currentCron}`
            : 'Subscribe — re-run on a schedule and notify on changes'}
        >
          {isSubscribed ? <Bell className="h-3.5 w-3.5" /> : <Calendar className="h-3.5 w-3.5" />}
          {!compact && (isSubscribed ? 'Subscribed' : 'Subscribe')}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-3 py-2 border-b border-border">
          <div className="text-xs font-semibold">Re-run on a schedule</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Auto-execute this query and ping you when the answer changes.
          </p>
        </div>

        <ul className="py-1 max-h-72 overflow-y-auto">
          {PRESETS.map((p) => {
            const isActive = matchedPreset?.id === p.id
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => apply(p)}
                  disabled={setSchedule.isPending}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-accent/40 transition-colors"
                >
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground">{p.label}</div>
                    <div className="text-[10px] text-muted-foreground">{p.description}</div>
                  </div>
                  {isActive && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                </button>
              </li>
            )
          })}
        </ul>

        <div className="px-3 py-2 border-t border-border">
          <label className="flex items-center gap-2 cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={triggerOn === 'change'}
              onChange={(e) => setTriggerOn(e.target.checked ? 'change' : 'always')}
              className="h-3 w-3"
            />
            Only notify when findings change
          </label>
        </div>

        {isSubscribed && (
          <div className="px-3 py-2 border-t border-border">
            <button
              type="button"
              onClick={() => apply(null)}
              disabled={setSchedule.isPending}
              className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-border text-xs text-destructive hover:bg-destructive/10 transition-colors"
            >
              {setSchedule.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <BellOff className="h-3 w-3" />}
              Unsubscribe
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
