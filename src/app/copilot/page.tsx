'use client'

import { useMemo, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type RunListEntry = inferRouterOutputs<AppRouter>['runs']['list']['runs'][number]
type PinnedArtifactEntry = inferRouterOutputs<AppRouter>['artifacts']['listPinned']['artifacts'][number]
type ConversationListEntry = inferRouterOutputs<AppRouter>['conversations']['list']['conversations'][number]
type ConversationDetail = inferRouterOutputs<AppRouter>['conversations']['get']
import { Sparkles, Clock, Loader2, ArrowRight, AlertCircle, Star, ExternalLink, MessageSquarePlus, MessageSquare, Bell } from 'lucide-react'
import CopilotPanel from '@/features/copilot/components/CopilotPanel'
import type { ChatMessage } from '@/features/copilot/hooks/useCopilotChat'
import { formatRelativeTime } from '@/features/copilot/lib/format'
import { CandidateTable, type CandidateRow } from '@/features/copilot/components/artifact-canvas/CandidateTable'
import { NotificationBell } from '@/features/copilot/components/NotificationBell'
import { ScopeChip } from '@/features/copilot/components/ScopeChip'
import { useLocalStorageMigration } from '@/features/copilot/hooks/useLocalStorageMigration'

/**
 * Phase 2a — agent-first Copilot surface (preview).
 *
 * Three-column desktop layout: history rail (left), the existing
 * CopilotPanel rendering the conversation in full-page mode (center), and
 * a metadata strip (right, hidden until artifacts populate). Phase 2b will
 * split the artifact canvas out of CopilotPanel; for now the panel is the
 * hero and the wrapper just provides the new shell + run history.
 *
 * Opt-in: `?facility=<id>` scopes to a facility, omitted = org mode.
 * `?v2=1` is reserved for future hard-flag gating but not enforced yet —
 * the route is preview-grade and won't be linked from nav until Phase 2b.
 */
/**
 * Map known cron presets back to friendly labels. Falls back to the raw
 * cron expression for custom schedules; we don't try to humanize arbitrary
 * cron because mapping rules to plain English deterministically is a
 * dedicated library's job.
 */
function describeCron(cron: string): string {
  switch (cron) {
    case '0 * * * *': return 'Every hour'
    case '0 9 * * *': return 'Daily at 9 AM'
    case '0 9 * * 1-5': return 'Weekdays at 9 AM'
    case '0 9 * * 1': return 'Mondays at 9 AM'
    case '0 22 * * 0': return 'Sunday nights'
    default: return cron || 'Custom schedule'
  }
}

type ServerMessage = ConversationDetail['messages'][number]
function mapServerMessages(conversation: ConversationDetail): ChatMessage[] {
  return conversation.messages
    .filter((m: ServerMessage) => m.role === 'user' || m.role === 'assistant')
    .map((m: ServerMessage) => {
      if (m.role === 'user') {
        return { role: 'user', content: m.content } as ChatMessage
      }
      // Assistant messages may carry the audit transcript and tools list;
      // suggestions get re-derived from content client-side.
      const audit = m.audit && typeof m.audit === 'object' ? (m.audit as ChatMessage['audit']) : undefined
      return {
        role: 'assistant',
        content: m.content,
        toolsUsed: m.toolsUsed,
        ...(audit ? { audit } : {}),
      } as ChatMessage
    })
}

export default function CopilotV2Page() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const facilityId = searchParams?.get('facility') ?? null
  const activeRunId = searchParams?.get('run') ?? null
  const activeConversationId = searchParams?.get('conversation') ?? null

  // Recent conversations sidebar: server-persisted threads sorted by recency.
  // Polling matches the runs poll cadence so newly-created threads appear
  // without a manual refresh.
  const { data: conversationsData, isLoading: conversationsLoading } = trpc.conversations.list.useQuery(
    facilityId ? { facilityId, limit: 25 } : { limit: 25 },
    {
      enabled: status === 'authenticated',
      staleTime: 5_000,
      refetchInterval: 8_000,
      refetchOnWindowFocus: true,
    },
  )
  const recentConversations = useMemo<ConversationListEntry[]>(
    () => conversationsData?.conversations ?? [],
    [conversationsData],
  )

  // One-shot localStorage → Prisma migration. Runs once per browser per
  // schema version, gated by a localStorage flag. No-op on subsequent loads.
  useLocalStorageMigration(status === 'authenticated')

  // Active conversation transcript — fetched only when the URL pins one.
  const { data: activeConversation } = trpc.conversations.get.useQuery(
    { conversationId: activeConversationId ?? '' },
    {
      enabled: status === 'authenticated' && !!activeConversationId,
      staleTime: 30_000,
    },
  )

  // Last-known runs for the Activity pane (artifact preview). We still drive
  // this off Run records because the artifact + tool transcript live there.
  const { data: runsData } = trpc.runs.list.useQuery(
    facilityId ? { facilityId, limit: 25 } : { limit: 25 },
    {
      enabled: status === 'authenticated',
      staleTime: 5_000,
      refetchInterval: 8_000,
      refetchOnWindowFocus: true,
    },
  )
  const recentRuns = useMemo(() => runsData?.runs ?? [], [runsData])

  // Active subscriptions — Runs with scheduleSpec set. The cron worker
  // re-executes these on schedule and writes notifications when findings
  // change. Lower poll cadence: schedules don't change minute-to-minute.
  const { data: subscriptionsData } = trpc.runs.list.useQuery(
    facilityId
      ? { facilityId, subscribedOnly: true, limit: 10 }
      : { subscribedOnly: true, limit: 10 },
    {
      enabled: status === 'authenticated',
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  )
  const subscriptions = useMemo(() => subscriptionsData?.runs ?? [], [subscriptionsData])
  const subscribedRunIds = useMemo(
    () => new Set(subscriptions.map((r: RunListEntry) => r.id)),
    [subscriptions],
  )

  // Map server messages into the panel's ChatMessage shape (only when
  // hydrating an existing thread). Tool-call audit + suggestions don't
  // exist on the server yet — they're computed client-side from content.
  const initialMessages = useMemo<ChatMessage[] | undefined>(() => {
    if (!activeConversation) return undefined
    return mapServerMessages(activeConversation)
  }, [activeConversation])

  const utils = trpc.useUtils()

  const buildHref = useCallback(
    (params: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams?.toString() ?? '')
      for (const [key, value] of Object.entries(params)) {
        if (value === null) next.delete(key)
        else next.set(key, value)
      }
      const qs = next.toString()
      return qs ? `${pathname}?${qs}` : pathname ?? '/copilot'
    },
    [pathname, searchParams],
  )

  const handleNewChat = useCallback(() => {
    router.replace(buildHref({ conversation: null, run: null }))
  }, [buildHref, router])

  const handleServerConversationChange = useCallback(
    (id: string) => {
      // First message of a freshly minted thread — reflect the new id in
      // the URL so reload resumes the same conversation, and prime the
      // sidebar list cache so the row appears immediately.
      if (activeConversationId !== id) {
        router.replace(buildHref({ conversation: id }))
      }
      void utils.conversations.list.invalidate()
    },
    [activeConversationId, buildHref, router, utils],
  )

  if (status === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }
  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="max-w-sm rounded-lg border border-border bg-card p-6 text-center">
          <AlertCircle className="h-6 w-6 text-amber-500 mx-auto mb-2" />
          <p className="text-sm text-foreground">You need to sign in to use Copilot.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex bg-background">
      {/* LEFT — History rail */}
      <aside className="w-72 border-r border-border bg-card shrink-0 overflow-hidden flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold">Copilot</h1>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold">
              Preview
            </span>
          </div>
          <NotificationBell />
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-2 sticky top-0 bg-card z-10 border-b border-border/50">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Recent
            </span>
            <button
              type="button"
              onClick={handleNewChat}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              title="Start a new conversation"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              New chat
            </button>
          </div>

          {conversationsLoading && (
            <div className="px-4 py-2 text-xs text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          )}
          {!conversationsLoading && recentConversations.length === 0 && (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              No conversations yet. Ask the Copilot a question to start your first one.
            </div>
          )}
          <ul className="space-y-px px-2 pt-2">
            {recentConversations.map((c) => {
              const isActive = activeConversationId === c.id
              const rowClass = cn(
                'block w-full text-left rounded px-2 py-2 text-xs transition-colors border',
                isActive
                  ? 'bg-primary/10 border-primary/40 text-foreground'
                  : 'border-transparent hover:bg-accent/30 hover:border-border/40',
              )
              const href = buildHref({ conversation: c.id, run: null })
              return (
                <li key={c.id}>
                  <Link href={href} className={rowClass} title={c.title}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-foreground font-medium line-clamp-1 flex-1">
                        {c.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatRelativeTime(new Date(c.lastMessageAt).getTime())}
                      </span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>

          {/* Subscriptions — Runs with scheduleSpec. The cron worker re-runs
              these on schedule and notifies on changed findings. Always
              shown when present so users can audit + manage their pings
              without hunting through Recent runs. */}
          {subscriptions.length > 0 && (
            <>
              <div className="px-4 py-2 mt-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t border-border/50 inline-flex items-center gap-1.5 w-full">
                <Bell className="h-3 w-3 text-emerald-500" />
                Subscriptions
                <span className="ml-auto text-[10px] text-muted-foreground/70 font-medium">
                  {subscriptions.length}
                </span>
              </div>
              <ul className="space-y-px px-2">
                {subscriptions.map((r: RunListEntry) => {
                  const spec = (r as { scheduleSpec?: { cron?: string; triggerOn?: string } | null }).scheduleSpec
                  const cron = spec?.cron ?? ''
                  const cadence = describeCron(cron)
                  // Subscriptions deep-link to the artifact view — that's
                  // where Subscribe lives so users can adjust or unsubscribe.
                  const href = r.currentArtifactId
                    ? `/copilot/a/${r.currentArtifactId}`
                    : buildHref({ run: r.id })
                  return (
                    <li key={`sub-${r.id}`}>
                      <Link
                        href={href}
                        className={cn(
                          'block w-full text-left rounded px-2 py-2 text-xs transition-colors border',
                          'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10',
                        )}
                        title={`${cadence} · ${spec?.triggerOn === 'always' ? 'every run' : 'on change'}`}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Bell className="h-3 w-3 text-emerald-500 shrink-0" />
                          <span className="text-foreground line-clamp-1 flex-1 leading-snug">
                            {r.prompt}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground pl-4">
                          {cadence}
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {/* Recent runs as a secondary surface — useful for jumping to a
              prior agentic execution / artifact even when its conversation
              isn't pinned. Hidden when the conversations list is empty to
              avoid double-empty-state confusion. */}
          {recentRuns.length > 0 && (
            <>
              <div className="px-4 py-2 mt-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t border-border/50">
                Recent runs
              </div>
              <ul className="space-y-px px-2">
                {recentRuns.slice(0, 8).map((r: RunListEntry) => {
                  const isActive = activeRunId === r.id
                  const rowClass = cn(
                    'block w-full text-left rounded px-2 py-2 text-xs transition-colors border',
                    isActive
                      ? 'bg-primary/10 border-primary/40 text-foreground'
                      : 'border-transparent hover:bg-accent/30 hover:border-border/40',
                  )
                  const href = buildHref({ run: r.id })
                  return (
                    <li key={r.id}>
                      <Link href={href} className={rowClass} title={r.prompt}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            r.status === 'completed' && 'bg-emerald-500',
                            r.status === 'running' && 'bg-blue-500 animate-pulse',
                            r.status === 'failed' && 'bg-red-500',
                            r.status === 'scheduled' && 'bg-purple-500',
                            (!['completed', 'running', 'failed', 'scheduled'].includes(r.status)) && 'bg-muted-foreground/40',
                          )} />
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {r.status}
                          </span>
                          {subscribedRunIds.has(r.id) && (
                            <Bell
                              className="h-2.5 w-2.5 text-emerald-500"
                              aria-label="Subscribed — re-runs on a schedule"
                            />
                          )}
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {formatRelativeTime(new Date(r.createdAt).getTime())}
                          </span>
                        </div>
                        <div className="text-foreground line-clamp-1 leading-snug">
                          {r.prompt}
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        <footer className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground shrink-0">
          {facilityId ? (
            <Link href={`/facilities/${facilityId}/copilot`} className="inline-flex items-center gap-1 hover:text-foreground">
              Switch to legacy view
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : (
            <span>Org-wide Copilot</span>
          )}
        </footer>
      </aside>

      {/* CENTER — Conversation surface (CopilotPanel in full-page mode) */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Scope bar — explicit indicator of whether the run is org-wide or
            bounded to a single facility. URL `?facility=` is the source of
            truth; the chip both reflects and toggles it. */}
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-card/40 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold shrink-0">
              Scope
            </span>
            <ScopeChip facilityId={facilityId} />
          </div>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            {facilityId
              ? 'Tools default to this facility'
              : 'Tools span every facility you have access to'}
          </span>
        </div>
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <CopilotPanel
            facilityId={facilityId}
            isFullPage
            serverConversationId={activeConversationId}
            initialMessages={initialMessages}
            onServerConversationChange={handleServerConversationChange}
          />
        </div>
      </main>

      {/* RIGHT — Activity pane: latest run artifact + saved reports. Phase
          2b first cut. Phase 2c will move scheduled-run notifications +
          full audit transcript here too. Hidden under 1280px. */}
      <aside className="hidden xl:flex w-80 border-l border-border bg-card shrink-0 flex-col overflow-hidden">
        <ActivityPane
          facilityId={facilityId}
          latestRun={
            (activeRunId ? recentRuns.find((r: RunListEntry) => r.id === activeRunId) : null) ??
            recentRuns[0] ??
            null
          }
        />
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity pane — latest artifact preview + saved reports list
// ---------------------------------------------------------------------------

function ActivityPane({ facilityId, latestRun }: { facilityId: string | null; latestRun: RunListEntry | null }) {
  // Fetch the latest run's artifact + version. Skipped when there's no run
  // or the run hasn't produced an artifact yet.
  const latestArtifactId = latestRun?.currentArtifactId ?? null
  const { data: latestArtifact } = trpc.artifacts.get.useQuery(
    { artifactId: latestArtifactId ?? '' },
    { enabled: !!latestArtifactId, staleTime: 30_000 },
  )

  // Pinned/saved reports for the active org
  const { data: pinnedData } = trpc.artifacts.listPinned.useQuery(
    facilityId ? { facilityId, limit: 5 } : { limit: 5 },
    { staleTime: 60_000, refetchOnWindowFocus: true },
  )

  const setPinned = trpc.artifacts.setPinned.useMutation()
  const utils = trpc.useUtils()
  const isPinned = !!latestArtifact?.artifact.pinnedAt

  const handleTogglePin = async () => {
    if (!latestArtifactId) return
    await setPinned.mutateAsync({ artifactId: latestArtifactId, pinned: !isPinned })
    await utils.artifacts.get.invalidate({ artifactId: latestArtifactId })
    await utils.artifacts.listPinned.invalidate()
  }

  const versionContent = latestArtifact?.currentVersion?.content as
    | { content?: string; toolResults?: Record<string, unknown> }
    | null
  const previewText = (versionContent?.content ?? '').slice(0, 240)
  // When the artifact has structured candidate data, swap the text snippet
  // for the interactive CandidateTable preview. Today only sample-out is
  // wired; future tools (search_packages, get_active_plants, etc.) get the
  // same treatment one at a time.
  // truncateResults() wraps large arrays as { results, totalCount, truncated };
  // small ones stay bare. Normalize both shapes here.
  const rawCandidates = versionContent?.toolResults?.find_sample_out_candidates ?? null
  const candidateRows: CandidateRow[] | null = Array.isArray(rawCandidates)
    ? (rawCandidates as CandidateRow[])
    : rawCandidates && typeof rawCandidates === 'object' && Array.isArray((rawCandidates as { results?: unknown }).results)
      ? ((rawCandidates as { results: CandidateRow[] }).results)
      : null

  return (
    <>
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Activity</h2>
      </header>
      <div className="flex-1 overflow-y-auto">
        {/* Run artifact preview (latest by default; selected run when ?run=id is set) */}
        <section className="px-4 py-3 border-b border-border">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Finding
          </div>
          {!latestRun && (
            <p className="text-xs text-muted-foreground italic">
              Send a question and the artifact will land here.
            </p>
          )}
          {latestRun && !latestArtifactId && (
            <p className="text-xs text-muted-foreground italic">
              Run is still in progress — artifact will appear when it completes.
            </p>
          )}
          {latestArtifact && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-foreground line-clamp-2">
                {latestArtifact.artifact.title || 'Untitled finding'}
              </div>
              {candidateRows && candidateRows.length > 0 ? (
                <CandidateTable rows={candidateRows} facilityId={facilityId} mode="preview" />
              ) : previewText ? (
                <p className="text-[11px] text-muted-foreground line-clamp-4 leading-relaxed">
                  {previewText}…
                </p>
              ) : null}
              <div className="flex items-center gap-1.5 pt-1">
                <button
                  onClick={handleTogglePin}
                  disabled={setPinned.isPending}
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors',
                    isPinned
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'border-border text-muted-foreground hover:bg-accent',
                  )}
                  title={isPinned ? 'Unpin' : 'Save this report'}
                >
                  <Star className={cn('h-3 w-3', isPinned && 'fill-current')} />
                  {isPinned ? 'Saved' : 'Save'}
                </button>
                <Link
                  href={`/copilot/a/${latestArtifactId}`}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-border text-foreground hover:bg-accent transition-colors"
                  title="Open in shareable view"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open
                </Link>
              </div>
            </div>
          )}
        </section>

        {/* Saved reports list */}
        <section className="px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Saved reports
          </div>
          {(!pinnedData?.artifacts || pinnedData.artifacts.length === 0) && (
            <p className="text-xs text-muted-foreground italic">
              Pinned reports show up here. Save findings you want to share or revisit.
            </p>
          )}
          <ul className="space-y-1.5">
            {pinnedData?.artifacts.map((a: PinnedArtifactEntry) => (
              <li key={a.id}>
                <Link
                  href={`/copilot/a/${a.id}`}
                  className="block rounded border border-border hover:border-primary/50 px-2 py-2 transition-colors group"
                >
                  <div className="flex items-start gap-1">
                    <Star className="h-3 w-3 text-amber-500 fill-current shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground line-clamp-1">
                        {a.title || 'Untitled finding'}
                      </div>
                      <div className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                        {a.run.prompt}
                      </div>
                    </div>
                    <ArrowRight className="h-3 w-3 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
