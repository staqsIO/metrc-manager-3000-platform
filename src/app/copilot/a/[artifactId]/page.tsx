'use client'

import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { trpc } from '@/lib/trpc-client'
import { Sparkles, ArrowLeft, Star, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/features/copilot/lib/format'
import { CandidateTable, type CandidateRow } from '@/features/copilot/components/artifact-canvas/CandidateTable'
import { SubscribeMenu } from '@/features/copilot/components/SubscribeMenu'

/**
 * Shareable, read-only Artifact view. Renders the saved Copilot finding at a
 * stable URL — auth-gated by org scope, so a link can be shared to any
 * teammate in the same organization. No Metrc data leaves the org because
 * the underlying ArtifactVersion is the deanonymized markdown the user
 * already saw.
 */
export default function ArtifactPage() {
  const params = useParams()
  const router = useRouter()
  const artifactId = (params?.artifactId as string) || ''
  const { status } = useSession()

  const { data, isLoading, error } = trpc.artifacts.get.useQuery(
    { artifactId },
    { enabled: status === 'authenticated' && !!artifactId, staleTime: 60_000 },
  )

  const setPinned = trpc.artifacts.setPinned.useMutation()
  const utils = trpc.useUtils()

  if (status === 'loading' || isLoading) {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <AlertCircle className="h-6 w-6 text-amber-500 mx-auto mb-2" />
          <p className="text-sm text-foreground">
            {error?.message ?? 'Artifact not found or not in your scope.'}
          </p>
          <Link href="/copilot" className="text-xs text-primary mt-2 inline-block">
            Back to Copilot
          </Link>
        </div>
      </div>
    )
  }

  const { artifact, currentVersion, run } = data
  const versionContent = currentVersion?.content as
    | { content?: string; toolResults?: Record<string, unknown> }
    | null
  const content = versionContent?.content ?? ''
  const rawCandidates = versionContent?.toolResults?.find_sample_out_candidates ?? null
  // truncateResults() wraps arrays >8KB as { results, totalCount, truncated } —
  // small results are bare arrays. Normalize both shapes here.
  const candidateRows: CandidateRow[] | null = Array.isArray(rawCandidates)
    ? (rawCandidates as CandidateRow[])
    : rawCandidates && typeof rawCandidates === 'object' && Array.isArray((rawCandidates as { results?: unknown }).results)
      ? ((rawCandidates as { results: CandidateRow[] }).results)
      : null
  const isPinned = !!artifact.pinnedAt
  // Resolve facility scope from the originating run for deep-link targets.
  // Runs created in org-mode have facilityId=null, so the table renders
  // labels as plain text in that case.
  const runFacilityId = (run as { facilityId?: string | null }).facilityId ?? null

  const handleTogglePin = async () => {
    await setPinned.mutateAsync({ artifactId, pinned: !isPinned })
    await utils.artifacts.get.invalidate({ artifactId })
    await utils.artifacts.listPinned.invalidate()
  }

  return (
    <div className="h-screen overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <header className="flex items-start justify-between gap-4 mb-6 pb-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <button
              onClick={() => router.back()}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </button>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold">
                {artifact.type}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {formatRelativeTime(new Date(artifact.createdAt).getTime())}
              </span>
            </div>
            <h1 className="text-xl font-semibold text-foreground line-clamp-2">
              {artifact.title || 'Untitled finding'}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {run.prompt}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <SubscribeMenu
              runId={run.id}
              currentCron={
                (run as { scheduleSpec?: { cron?: string } | null }).scheduleSpec?.cron ?? null
              }
              currentTriggerOn={
                ((run as { scheduleSpec?: { triggerOn?: 'change' | 'always' } | null }).scheduleSpec?.triggerOn) ?? null
              }
              onChange={() => {
                void utils.artifacts.get.invalidate({ artifactId })
              }}
            />
            <button
              onClick={handleTogglePin}
              disabled={setPinned.isPending}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                isPinned
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
              title={isPinned ? 'Unpin (remove from saved reports)' : 'Pin (save to your reports)'}
            >
              <Star className={cn('h-3.5 w-3.5', isPinned && 'fill-current')} />
              {isPinned ? 'Saved' : 'Save'}
            </button>
          </div>
        </header>

        {/* Structured data first (when available) — interactive sortable table */}
        {candidateRows && candidateRows.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Candidates ({candidateRows.length})
            </h2>
            <CandidateTable rows={candidateRows} facilityId={runFacilityId} mode="full" />
          </section>
        )}

        {/* Narrative */}
        <article className="prose prose-invert prose-sm max-w-none">
          {content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          ) : (
            <p className="text-muted-foreground italic">No content available for this artifact.</p>
          )}
        </article>
      </div>
    </div>
  )
}
