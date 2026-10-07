'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bell, BellDot, Check, Loader2 } from 'lucide-react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/features/copilot/lib/format'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/shared/components/ui/dropdown-menu'

type NotificationItem = inferRouterOutputs<AppRouter>['notifications']['list']['items'][number]

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
}

/**
 * Phase 3a — minimal notification bell. Sits in the /copilot left-rail
 * header today; a future global nav slot will promote it. Polls for unread
 * count every 30s; full list loads on dropdown open.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false)

  const { data: unreadData } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  })
  const { data: listData, isLoading: listLoading } = trpc.notifications.list.useQuery(
    { limit: 20 },
    { enabled: open, staleTime: 10_000 },
  )

  const utils = trpc.useUtils()
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate()
      void utils.notifications.unreadCount.invalidate()
    },
  })
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate()
      void utils.notifications.unreadCount.invalidate()
    },
  })

  const unreadCount = unreadData?.count ?? 0
  const items = listData?.items ?? []

  const handleItemClick = (item: NotificationItem) => {
    if (!item.read) markRead.mutate({ notificationId: item.id })
  }

  const itemHref = (item: NotificationItem): string | null => {
    if (item.artifactId) return `/copilot/a/${item.artifactId}`
    if (item.runId) return `/copilot?run=${item.runId}`
    return null
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative inline-flex items-center justify-center h-7 w-7 rounded-md',
            'text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
            unreadCount > 0 && 'text-foreground',
          )}
          title={unreadCount > 0 ? `${unreadCount} unread` : 'Notifications'}
        >
          {unreadCount > 0 ? <BellDot className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 px-1 rounded-full bg-red-500 text-[9px] font-bold text-white inline-flex items-center justify-center tabular-nums">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0 max-h-[480px] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <span className="text-xs font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Check className="h-3 w-3" />
              Mark all read
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {listLoading && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground inline-flex items-center gap-2 justify-center w-full">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          )}
          {!listLoading && items.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No notifications yet.
              <p className="text-[10px] mt-1">Subscribe to a Copilot finding to get pinged when results change.</p>
            </div>
          )}
          <ul className="divide-y divide-border/40">
            {items.map((item: NotificationItem) => {
              const href = itemHref(item)
              const body = (
                <div className="flex items-start gap-2 px-3 py-2.5">
                  <span className={cn('h-2 w-2 rounded-full mt-1.5 shrink-0', SEVERITY_DOT[item.severity] ?? SEVERITY_DOT.info)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('text-xs font-medium line-clamp-1', !item.read && 'text-foreground', item.read && 'text-muted-foreground')}>
                        {item.title}
                      </span>
                      {!item.read && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                    </div>
                    {item.body && (
                      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                        {item.body}
                      </p>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatRelativeTime(new Date(item.createdAt).getTime())}
                    </span>
                  </div>
                </div>
              )
              return (
                <li key={item.id}>
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => handleItemClick(item)}
                      className="block hover:bg-accent/30 transition-colors"
                    >
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleItemClick(item)}
                      className="block w-full text-left hover:bg-accent/30 transition-colors"
                    >
                      {body}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        <div className="border-t border-border shrink-0">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block w-full text-center text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/30 px-3 py-2 transition-colors"
          >
            View all notifications →
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
