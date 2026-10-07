'use client'

import { useEffect } from 'react'
import { MessageSquare } from 'lucide-react'
import { trpc } from '@/lib/trpc-client'
import { useCopilot } from '../CopilotContext'
import { useFacilityId } from '@/shared/hooks/useFacilityId'
import CopilotPanel from './CopilotPanel'

export default function CopilotSidebar() {
  const { isOpen, isExpanded, open, notificationCount, setNotificationCount } = useCopilot()

  const facilityId = useFacilityId() ?? null

  // Proactive notifications: query briefing to count actionable insights
  const { data: briefing } = trpc.copilot.getBriefing.useQuery(
    { facilityId: facilityId! },
    { enabled: !!facilityId && !isOpen, staleTime: 300_000, refetchInterval: 300_000 },
  )

  useEffect(() => {
    if (briefing?.insights) {
      const actionable = briefing.insights.filter(
        i => i.severity === 'critical' || i.severity === 'warning'
      ).length
      setNotificationCount(actionable)
    }
  }, [briefing, setNotificationCount])

  return (
    <>
      {/* Fixed right sidebar */}
      <div
        className={`fixed inset-y-0 right-0 z-40 border-l border-border bg-card transition-all duration-200 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        } ${isExpanded ? 'left-64' : 'w-[380px]'}`}
      >
        <CopilotPanel facilityId={facilityId} isExpanded={isExpanded} />
      </div>

      {/* Floating toggle button — shows on all authenticated pages */}
      {!isOpen && (
        <button
          onClick={() => open()}
          className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 flex items-center justify-center transition-all motion-safe:hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={notificationCount > 0 ? `Open Copilot, ${notificationCount} notifications` : 'Open Copilot'}
        >
          <MessageSquare className="h-5 w-5" />
          {notificationCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-background">
              {notificationCount > 9 ? '9+' : notificationCount}
            </span>
          )}
        </button>
      )}
    </>
  )
}
