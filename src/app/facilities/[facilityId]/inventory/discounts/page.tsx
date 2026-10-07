'use client'

import { useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Tag,
  Package,
  Combine,
  Gift,
  Megaphone,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  Play,
  History,
  Settings2,
  Loader2,
} from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import PackageLabelLink from '@/features/inventory/components/PackageLabelLink'

// --- Types ---

interface DiscountRecommendation {
  packageLabel: string
  itemName: string
  itemCategory: string
  quantity: number
  unitOfMeasure: string
  ageDays: number
  score: number
  scoreBreakdown: { age: number; quantity: number; velocity: number; category: number }
  priority: 'urgent' | 'high' | 'medium' | 'low'
  actionType: string
  actionParams: Record<string, unknown>
  suggestedAction: string
  matchedRuleIds: string[]
  matchedRuleNames: string[]
}

interface DiscountSummary {
  totalRecommendations: number
  byActionType: Record<string, number>
  byPriority: Record<string, number>
  averageScore: number
  highScoreCount: number
}

// --- Helpers ---

function scoreColor(score: number): string {
  if (score >= 70) return 'bg-red-500/15 text-red-500 border-red-500/30'
  if (score >= 50) return 'bg-orange-500/15 text-orange-400 border-orange-500/30'
  if (score >= 30) return 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30'
  return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
}

function priorityColor(priority: string): string {
  switch (priority) {
    case 'urgent': return 'bg-red-500/15 text-red-500 border-red-500/30'
    case 'high': return 'bg-orange-500/15 text-orange-400 border-orange-500/30'
    case 'medium': return 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30'
    case 'low': return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
    default: return 'bg-muted text-muted-foreground'
  }
}

function actionTypeLabel(type: string): string {
  switch (type) {
    case 'DISCOUNT_RECOMMEND': return 'Discount'
    case 'AUTO_DISCOUNT': return 'Auto Discount'
    case 'PROMO_FLAG': return 'Promo'
    case 'CONSOLIDATE': return 'Consolidate'
    case 'SAMPLE_OUT': return 'Sample Out'
    default: return type
  }
}

function actionTypeIcon(type: string) {
  switch (type) {
    case 'DISCOUNT_RECOMMEND': return Tag
    case 'AUTO_DISCOUNT': return Tag
    case 'PROMO_FLAG': return Megaphone
    case 'CONSOLIDATE': return Combine
    case 'SAMPLE_OUT': return Gift
    default: return Tag
  }
}

function SummaryCardSkeleton() {
  return (
    <div className="card-modern p-4">
      <Skeleton className="h-4 w-24 mb-2" />
      <Skeleton className="h-8 w-16" />
    </div>
  )
}

// --- Page ---

export default function DiscountEnginePage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const [actionTypeFilter, setActionTypeFilter] = useState<string>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [minScoreFilter, setMinScoreFilter] = useState<number>(0)
  const [selectedRecs, setSelectedRecs] = useState<Set<string>>(new Set())

  const {
    data: rawData,
    isLoading,
    refetch,
  } = trpc.discount.getRecommendations.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 30_000 }
  )

  const data = rawData as { recommendations: DiscountRecommendation[]; summary: DiscountSummary; rulesCount: number; packagesEvaluated: number } | undefined

  const seedDefaults = trpc.discount.seedDefaults.useMutation({
    onSuccess: () => { void refetch() },
  })

  // Auto-discount stats
  const { data: autoStats } = trpc.autoDiscount.getDashboardStats.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 60_000 }
  )

  const previewMutation = trpc.autoDiscount.preview.useMutation()

  const handlePreview = () => {
    previewMutation.mutate({ facilityId })
  }

  // Filtered recommendations
  const filtered = useMemo(() => {
    if (!data?.recommendations) return []
    let list = [...data.recommendations]
    if (actionTypeFilter !== 'all') list = list.filter(r => r.actionType === actionTypeFilter)
    if (priorityFilter !== 'all') list = list.filter(r => r.priority === priorityFilter)
    if (minScoreFilter > 0) list = list.filter(r => r.score >= minScoreFilter)
    return list
  }, [data?.recommendations, actionTypeFilter, priorityFilter, minScoreFilter])

  // Faceted counts
  const actionTypeCounts = useMemo(() => {
    if (!data?.recommendations) return {} as Record<string, number>
    const base = priorityFilter === 'all'
      ? data.recommendations
      : data.recommendations.filter(r => r.priority === priorityFilter)
    const counts: Record<string, number> = {}
    for (const r of base) {
      counts[r.actionType] = (counts[r.actionType] ?? 0) + 1
    }
    return counts
  }, [data?.recommendations, priorityFilter])

  const priorityCounts = useMemo(() => {
    if (!data?.recommendations) return {} as Record<string, number>
    const base = actionTypeFilter === 'all'
      ? data.recommendations
      : data.recommendations.filter(r => r.actionType === actionTypeFilter)
    const counts: Record<string, number> = {}
    for (const r of base) {
      counts[r.priority] = (counts[r.priority] ?? 0) + 1
    }
    return counts
  }, [data?.recommendations, actionTypeFilter])

  const noRules = data && data.rulesCount === 0
  const hasRecs = (data?.recommendations?.length ?? 0) > 0
  const summary = data?.summary

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold">Discount &amp; Aging Engine</h1>
          <Badge variant="outline" className="text-xs">Beta</Badge>
        </div>
        <p className="text-muted-foreground mt-1">
          Rule-based scoring for discount recommendations, sample-out candidates, consolidation, and promotions.
        </p>

        {/* Tab navigation */}
        <div className="flex items-center gap-1 mt-4 border-b border-border">
          <span className="px-3 py-2 text-sm font-medium border-b-2 border-primary text-foreground">
            Recommendations
          </span>
          <Link
            href={`/facilities/${facilityId}/inventory/discounts/runs`}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
          >
            <History className="h-3.5 w-3.5" />
            Runs
            {(autoStats?.previewingCount ?? 0) > 0 && (
              <span className="ml-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] text-white leading-none">
                {autoStats.previewingCount}
              </span>
            )}
          </Link>
          <Link
            href={`/facilities/${facilityId}/inventory/discounts/auto-config`}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Configuration
          </Link>
        </div>
      </div>

      {/* Pending runs banner */}
      {(autoStats?.previewingCount ?? 0) > 0 && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex items-center gap-4">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">
              {autoStats!.previewingCount} discount run{autoStats!.previewingCount > 1 ? 's' : ''} awaiting approval
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Review and approve pending discount plans before they expire.
            </p>
          </div>
          <Link
            href={`/facilities/${facilityId}/inventory/discounts/runs`}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors"
          >
            Review Runs
          </Link>
        </div>
      )}

      {/* Seed defaults banner */}
      {noRules && (
        <div className="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 flex items-center gap-4">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">No discount rules configured</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Seed default discount rules to start scoring your inventory.
            </p>
          </div>
          <button
            onClick={() => seedDefaults.mutate({ facilityId })}
            disabled={seedDefaults.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {seedDefaults.isPending ? 'Seeding...' : 'Seed Default Rules'}
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          <>
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
          </>
        ) : (
          <>
            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Total Recommendations</span>
              </div>
              <p className="text-2xl font-bold">
                {summary?.totalRecommendations ?? 0}
              </p>
            </div>

            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Discount Candidates</span>
              </div>
              <p className="text-2xl font-bold">
                {(summary?.byActionType?.DISCOUNT_RECOMMEND ?? 0) + (summary?.byActionType?.AUTO_DISCOUNT ?? 0)}
              </p>
            </div>

            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <Combine className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Consolidation Opps</span>
              </div>
              <p className="text-2xl font-bold">
                {summary?.byActionType?.CONSOLIDATE ?? 0}
              </p>
            </div>

            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <Gift className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Sample-Out Candidates</span>
              </div>
              <p className="text-2xl font-bold">
                {summary?.byActionType?.SAMPLE_OUT ?? 0}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Filter Bar */}
      {hasRecs && (
        <div className="card-modern mb-4">
          <div className="space-y-2 px-4 py-3">
            {/* Action type pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">Action:</span>
              {[
                { key: 'all', label: 'All', count: Object.values(actionTypeCounts).reduce((a, b) => a + b, 0) },
                ...['DISCOUNT_RECOMMEND', 'PROMO_FLAG', 'CONSOLIDATE', 'SAMPLE_OUT'].map(k => ({
                  key: k,
                  label: actionTypeLabel(k),
                  count: actionTypeCounts[k] ?? 0,
                })),
              ].filter(p => p.key === 'all' || p.count > 0).map((pill) => (
                <button
                  key={pill.key}
                  onClick={() => setActionTypeFilter(pill.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    actionTypeFilter === pill.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  {pill.label}
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                    actionTypeFilter === pill.key
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-background/50'
                  )}>
                    {pill.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Priority pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">Priority:</span>
              {[
                { key: 'all', label: 'All', count: Object.values(priorityCounts).reduce((a, b) => a + b, 0) },
                { key: 'urgent', label: 'Urgent', count: priorityCounts.urgent ?? 0 },
                { key: 'high', label: 'High', count: priorityCounts.high ?? 0 },
                { key: 'medium', label: 'Medium', count: priorityCounts.medium ?? 0 },
                { key: 'low', label: 'Low', count: priorityCounts.low ?? 0 },
              ].filter(p => p.key === 'all' || p.count > 0).map((pill) => (
                <button
                  key={pill.key}
                  onClick={() => setPriorityFilter(pill.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    priorityFilter === pill.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  {pill.label}
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                    priorityFilter === pill.key
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-background/50'
                  )}>
                    {pill.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Score slider */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Min Score:</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={minScoreFilter}
                onChange={(e) => setMinScoreFilter(Number(e.target.value))}
                className="w-40 accent-primary"
              />
              <span className="text-xs font-mono text-muted-foreground w-8">{minScoreFilter}</span>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations Table */}
      <div className="card-modern">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !hasRecs ? (
          <div className="p-12 text-center">
            <Tag className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold mb-1">No Discount Recommendations</h3>
            <p className="text-sm text-muted-foreground">
              {noRules
                ? 'Seed default rules above to generate recommendations.'
                : 'All inventory is within acceptable thresholds.'}
            </p>
          </div>
        ) : !filtered.length ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground">No recommendations match these filters.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={filtered.length > 0 && filtered.every(r => selectedRecs.has(r.packageLabel))}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedRecs(new Set(filtered.map(r => r.packageLabel)))
                      } else {
                        setSelectedRecs(new Set())
                      }
                    }}
                  />
                </TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Package</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead>Suggested Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((rec) => {
                const ActionIcon = actionTypeIcon(rec.actionType)
                return (
                  <TableRow key={rec.packageLabel}>
                    <TableCell>
                      <Checkbox
                        checked={selectedRecs.has(rec.packageLabel)}
                        onCheckedChange={(checked) => {
                          setSelectedRecs(prev => {
                            const next = new Set(prev)
                            if (checked) next.add(rec.packageLabel)
                            else next.delete(rec.packageLabel)
                            return next
                          })
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge className={cn('text-xs font-mono', scoreColor(rec.score))}>
                        {rec.score}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn('text-xs capitalize', priorityColor(rec.priority))}>
                        {rec.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <ActionIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        <Badge variant="outline" className="text-xs">
                          {actionTypeLabel(rec.actionType)}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <PackageLabelLink label={rec.packageLabel} className="text-sm font-mono font-medium" />
                    </TableCell>
                    <TableCell>
                      <div>
                        <span className="text-sm">{rec.itemName}</span>
                        <p className="text-xs text-muted-foreground">{rec.itemCategory}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm">{rec.quantity} {rec.unitOfMeasure}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-semibold">{rec.ageDays}d</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground max-w-[250px] truncate block" title={rec.suggestedAction}>
                        {rec.suggestedAction}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Cross-link to Aging page */}
      <div className="mt-6">
        <Link
          href={`/facilities/${facilityId}/inventory/aging`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowRight className="h-4 w-4" />
          View legacy Aging Analysis
        </Link>
      </div>

      {/* Floating bulk action panel */}
      {selectedRecs.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{selectedRecs.size} selected</span>
          <div className="h-4 w-px bg-border" />
          <button
            onClick={handlePreview}
            disabled={previewMutation.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {previewMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Preview Discount Application
          </button>
          {previewMutation.isSuccess && (
            <Link
              href={`/facilities/${facilityId}/inventory/discounts/runs/${previewMutation.data.runId}`}
              className="text-xs text-emerald-500 hover:underline"
            >
              View Run →
            </Link>
          )}
          <button
            onClick={() => setSelectedRecs(new Set())}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
