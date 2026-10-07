'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Bell, BellOff, Check, Loader2, ArrowLeft, AlertCircle } from 'lucide-react'
import { formatRelativeTime } from '@/features/copilot/lib/format'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type NotificationItem = inferRouterOutputs<AppRouter>['notifications']['list']['items'][number]

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
}

/**
 * Phase 3 — full notifications inbox.
 *
 * Mirrors the bell dropdown content but with filters (unread/all, severity)
 * and bulk actions. Items deep-link into /copilot/a/[artifactId] when an
 * artifact is attached, otherwise back into /copilot?run=<id>.
 */
export default function NotificationsPage() {
  const { status } = useSession()
  const [filter, setFilter] = useState<'all' | 'unread'>('unread')

  const { data, isLoading } = trpc.notifications.list.useQuery(
    { limit: 100, ...(filter === 'unread' ? { unreadOnly: true } : {}) },
    { enabled: status === 'authenticated', staleTime: 10_000, refetchOnWindowFocus: true },
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

  const items = useMemo<NotificationItem[]>(() => data?.items ?? [], [data])
  const unreadCount = items.filter((i) => !i.read).length

  if (status === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }
  if (status !== 'authenticated') {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="max-w-sm rounded-lg border border-border bg-card p-6 text-center">
          <AlertCircle className="h-6 w-6 text-amber-500 mx-auto mb-2" />
          <p className="text-sm text-foreground">Sign in to see your notifications.</p>
        </div>
      </div>
    )
  }

  const itemHref = (item: NotificationItem): string | null => {
    if (item.artifactId) return `/copilot/a/${item.artifactId}`
    if (item.runId) return `/copilot?run=${item.runId}`
    return null
  }

  return (
    <div className="h-screen overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Link
          href="/copilot"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Copilot
        </Link>

        <header className="flex items-end justify-between gap-4 mb-6 pb-4 border-b border-border">
          <div>
            <h1 className="text-xl font-semibold text-foreground inline-flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              Notifications
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {unreadCount > 0
                ? `${unreadCount} unread`
                : 'All caught up — no unread notifications.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border overflow-hidden text-[11px]">
              <button
                type="button"
                onClick={() => setFilter('unread')}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  filter === 'unread' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                Unread
              </button>
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={cn(
                  'px-3 py-1.5 border-l border-border transition-colors',
                  filter === 'all' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                All
              </button>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-accent transition-colors"
              >
                <Check className="h-3 w-3" />
                Mark all read
              </button>
            )}
          </div>
        </header>

        {isLoading && (
          <div className="text-xs text-muted-foreground inline-flex items-center gap-2 px-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        )}

        {!isLoading && items.length === 0 && (
          <div className="rounded-lg border border-border bg-card px-6 py-10 text-center">
            <BellOff className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-foreground">No notifications.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Subscribe to a Copilot finding to get pinged when results change.
            </p>
          </div>
        )}

        <ul className="divide-y divide-border/50 rounded-lg border border-border bg-card overflow-hidden">
          {items.map((item) => {
            const href = itemHref(item)
            const body = (
              <div className="flex items-start gap-3 px-4 py-3">
                <span className={cn(
                  'h-2.5 w-2.5 rounded-full mt-1.5 shrink-0',
                  SEVERITY_DOT[item.severity] ?? SEVERITY_DOT.info,
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      'text-sm font-medium line-clamp-1',
                      item.read ? 'text-muted-foreground' : 'text-foreground',
                    )}>
                      {item.title}
                    </span>
                    {!item.read && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                  </div>
                  {item.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {item.body}
                    </p>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(new Date(item.createdAt).getTime())}
                  </span>
                </div>
              </div>
            )
            const handleClick = () => {
              if (!item.read) markRead.mutate({ notificationId: item.id })
            }
            return (
              <li key={item.id}>
                {href ? (
                  <Link href={href} onClick={handleClick} className="block hover:bg-accent/30 transition-colors">
                    {body}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={handleClick}
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
    </div>
  )
}
