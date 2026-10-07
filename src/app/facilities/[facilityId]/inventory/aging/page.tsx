'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { Clock, AlertTriangle, Package, TrendingDown, ArrowRightLeft, Lightbulb, Snail, X, CheckCircle } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import AgingActionDialog from '@/features/inventory/components/AgingActionDialog'
import PackageLabelLink from '@/features/inventory/components/PackageLabelLink'
import type { AgingActionType, ActionStatus } from '@/services/actions/action-types'

// ---------------------------------------------------------------------------
// Types (cast via `as unknown as T` to avoid deep type-instantiation errors)
// ---------------------------------------------------------------------------

import { ACTIONS_ENABLED } from '@/shared/constants/feature-flags'

interface AgingBucket {
  category: string
  label: string
  count: number
  totalQuantity: number
  packages: unknown[]
}

interface AgingDistributionData {
  fresh: AgingBucket
  normal: AgingBucket
  aging: AgingBucket
  critical: AgingBucket
  totalPackages: number
  excludedFromAging?: number
  totalQuantityByUnit: Record<string, number>
  averageAgeDays: number
  medianAgeDays: number
}

interface FIFOViolation {
  newerPackage: {
    label: string
    itemName: string
    ageDays: number
    quantity: number
    packagedDate: string
  }
  olderPackage: {
    label: string
    itemName: string
    ageDays: number
    quantity: number
    packagedDate: string
  }
  category: string
  strain: string
  daysDifference: number
}

interface FIFOViolationsData {
  violations: FIFOViolation[]
  totalViolations: number
  worstDaysDifference: number
}

interface AgingRecommendation {
  type: string
  priority: 'urgent' | 'high' | 'medium' | 'low'
  packageLabel: string
  itemName: string
  ageDays: number
  quantity: number
  unitOfMeasure: string
  reason: string
  suggestedAction: string
}

interface AgingRecommendationsData {
  recommendations: AgingRecommendation[]
  totalRecommendations: number
  byType: {
    discount: number
    sample_out: number
    destroy: number
    remediate: number
    expedite_testing: number
  }
}

interface SlowMovingPackage {
  label: string
  itemName: string
  itemCategory: string
  strain: string
  ageDays: number
  quantity: number
  unitOfMeasure: string
  location: string
  lastModified: string
  tier: 'slow' | 'stagnant' | 'dead'
}

interface SlowMovingData {
  packages: SlowMovingPackage[]
  totalSlowMoving: number
  byTier: {
    slow: number
    stagnant: number
    dead: number
  }
}

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type TabKey = 'fifo' | 'recommendations' | 'slow-moving'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function violationSeverity(daysDiff: number): 'critical' | 'high' | 'medium' | 'low' {
  if (daysDiff >= 60) return 'critical'
  if (daysDiff >= 30) return 'high'
  if (daysDiff >= 14) return 'medium'
  return 'low'
}

function violationSeverityColor(daysDiff: number): string {
  if (daysDiff >= 60) return 'bg-red-500/15 text-red-500 border-red-500/30'
  if (daysDiff >= 30) return 'bg-orange-500/15 text-orange-400 border-orange-500/30'
  if (daysDiff >= 14) return 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30'
  return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
}

function violationSeverityLabel(daysDiff: number): string {
  const s = violationSeverity(daysDiff)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function priorityColor(priority: string): string {
  switch (priority) {
    case 'urgent':
      return 'bg-red-500/15 text-red-500 border-red-500/30'
    case 'high':
      return 'bg-orange-500/15 text-orange-400 border-orange-500/30'
    case 'medium':
      return 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30'
    case 'low':
      return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function typeLabel(type: string): string {
  switch (type) {
    case 'discount':
      return 'Discount'
    case 'sample_out':
      return 'Sample Out'
    case 'destroy':
      return 'Destroy'
    case 'remediate':
      return 'Remediate'
    case 'expedite_testing':
      return 'Expedite Testing'
    default:
      return type
  }
}

function actionButtonLabel(type: string): string {
  switch (type) {
    case 'discount': return 'Flag for Discount'
    case 'sample_out': return 'Sample Out'
    case 'destroy': return 'Destroy Package'
    case 'remediate': return 'Flag for Remediation'
    case 'expedite_testing': return 'Expedite Testing'
    default: return 'Take Action'
  }
}

function slowMovingActionType(tier: string): AgingActionType {
  switch (tier) {
    case 'dead': return 'destroy'
    case 'stagnant': return 'sample_out'
    default: return 'discount'
  }
}

function slowMovingButtonLabel(tier: string): string {
  switch (tier) {
    case 'dead': return 'Destroy'
    case 'stagnant': return 'Sample Out'
    default: return 'Flag Discount'
  }
}

function tierColor(tier: string): string {
  switch (tier) {
    case 'slow':
      return 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30'
    case 'stagnant':
      return 'bg-orange-500/15 text-orange-400 border-orange-500/30'
    case 'dead':
      return 'bg-red-500/15 text-red-500 border-red-500/30'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

// ---------------------------------------------------------------------------
// Summary Card Skeleton
// ---------------------------------------------------------------------------

function SummaryCardSkeleton() {
  return (
    <div className="card-modern p-4">
      <Skeleton className="h-4 w-24 mb-2" />
      <Skeleton className="h-8 w-16" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function InventoryAgingPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const [activeTab, setActiveTab] = useState<TabKey>('fifo')

  // ---- Queries ----

  const {
    data: rawAging,
    isLoading: agingLoading,
  } = trpc.inventory.agingDistribution.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )
  const aging = rawAging as unknown as AgingDistributionData | undefined

  const {
    data: rawViolations,
    isLoading: violationsLoading,
  } = trpc.inventory.fifoViolations.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )
  const violations = rawViolations as unknown as FIFOViolationsData | undefined

  const {
    data: rawRecommendations,
    isLoading: recommendationsLoading,
  } = trpc.inventory.agingRecommendations.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )
  const recommendations = rawRecommendations as unknown as AgingRecommendationsData | undefined

  const {
    data: rawSlowMoving,
    isLoading: slowMovingLoading,
  } = trpc.inventory.slowMoving.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )
  const slowMoving = rawSlowMoving as unknown as SlowMovingData | undefined

  // ---- Action dialog state ----

  const [actionDialog, setActionDialog] = useState<{
    open: boolean
    actionType: AgingActionType | null
    packageLabel: string
    packageName: string
    currentQuantity: number
    unitOfMeasure: string
    status: ActionStatus
    previewDescription: string | null
    error: string | null
  }>({
    open: false,
    actionType: null,
    packageLabel: '',
    packageName: '',
    currentQuantity: 0,
    unitOfMeasure: '',
    status: 'idle',
    previewDescription: null,
    error: null,
  })

  // ---- Filter state ----

  const [recTypeFilter, setRecTypeFilter] = useState<string>('all')
  const [recPriorityFilter, setRecPriorityFilter] = useState<string>('all')
  const [fifoSeverityFilter, setFifoSeverityFilter] = useState<string>('all')
  const [slowTierFilter, setSlowTierFilter] = useState<string>('all')

  // ---- Selection state ----

  const [selectedRecs, setSelectedRecs] = useState<Set<string>>(new Set())
  const [selectedFifo, setSelectedFifo] = useState<Set<string>>(new Set())
  const [selectedSlow, setSelectedSlow] = useState<Set<string>>(new Set())

  // ---- Bulk action dialog state ----

  const [bulkDialog, setBulkDialog] = useState<{
    open: boolean
    status: 'idle' | 'previewing' | 'confirming' | 'executing' | 'completed' | 'error'
    summary: { actionType: string; count: number; packages: { label: string; itemName: string }[] }[]
    previewedActions: { actionType: AgingActionType; packageLabel: string; note?: string }[]
    error: string | null
  }>({
    open: false,
    status: 'idle',
    summary: [],
    previewedActions: [],
    error: null,
  })

  // Clear selections when filters change
  useEffect(() => { setSelectedRecs(new Set()) }, [recTypeFilter, recPriorityFilter])
  useEffect(() => { setSelectedFifo(new Set()) }, [fifoSeverityFilter])
  useEffect(() => { setSelectedSlow(new Set()) }, [slowTierFilter])

  const utils = trpc.useUtils()

  const executeAgingAction = trpc.inventory.executeAgingAction.useMutation({
    onSuccess: (data) => {
      if (data.status === 'preview') {
        setActionDialog(prev => ({
          ...prev,
          status: 'confirming',
          previewDescription: data.preview.description,
        }))
      } else {
        setActionDialog(prev => ({ ...prev, status: 'completed', error: null }))
        // Invalidate queries to refresh data
        void utils.inventory.agingRecommendations.invalidate()
        void utils.inventory.fifoViolations.invalidate()
        void utils.inventory.slowMoving.invalidate()
        void utils.inventory.agingDistribution.invalidate()
      }
    },
    onError: (err) => {
      setActionDialog(prev => ({ ...prev, status: 'error', error: err.message }))
    },
  })

  const openActionDialog = useCallback((params: {
    actionType: AgingActionType
    packageLabel: string
    packageName: string
    currentQuantity: number
    unitOfMeasure: string
    note?: string
  }) => {
    setActionDialog({
      open: true,
      actionType: params.actionType,
      packageLabel: params.packageLabel,
      packageName: params.packageName,
      currentQuantity: params.currentQuantity,
      unitOfMeasure: params.unitOfMeasure,
      status: 'previewing',
      previewDescription: null,
      error: null,
    })

    // Fire preview request
    executeAgingAction.mutate({
      facilityId,
      actionType: params.actionType,
      packageLabel: params.packageLabel,
      confirmed: false,
      note: params.note,
    })
  }, [facilityId, executeAgingAction])

  const handleActionConfirm = useCallback((params: { newQuantity?: number; note?: string }) => {
    if (!actionDialog.actionType) return
    setActionDialog(prev => ({ ...prev, status: 'executing' }))
    executeAgingAction.mutate({
      facilityId,
      actionType: actionDialog.actionType!,
      packageLabel: actionDialog.packageLabel,
      confirmed: true,
      newQuantity: params.newQuantity,
      note: params.note,
    })
  }, [facilityId, actionDialog.actionType, actionDialog.packageLabel, executeAgingAction])

  const handleActionCancel = useCallback(() => {
    setActionDialog(prev => ({ ...prev, open: false }))
  }, [])

  // ---- Derived / filtered data ----

  const filteredRecommendations = useMemo(() => {
    if (!recommendations?.recommendations) return []
    const order: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
    let list = [...recommendations.recommendations]
    if (recTypeFilter !== 'all') list = list.filter(r => r.type === recTypeFilter)
    if (recPriorityFilter !== 'all') list = list.filter(r => r.priority === recPriorityFilter)
    return list.sort((a, b) => (order[a.priority] ?? 4) - (order[b.priority] ?? 4))
  }, [recommendations?.recommendations, recTypeFilter, recPriorityFilter])

  // Faceted counts: type counts scoped by current priority filter, and vice versa
  const recTypeCounts = useMemo(() => {
    if (!recommendations?.recommendations) return { discount: 0, sample_out: 0, destroy: 0, remediate: 0, expedite_testing: 0 }
    const list = recPriorityFilter === 'all'
      ? recommendations.recommendations
      : recommendations.recommendations.filter(r => r.priority === recPriorityFilter)
    return {
      discount: list.filter(r => r.type === 'discount').length,
      sample_out: list.filter(r => r.type === 'sample_out').length,
      destroy: list.filter(r => r.type === 'destroy').length,
      remediate: list.filter(r => r.type === 'remediate').length,
      expedite_testing: list.filter(r => r.type === 'expedite_testing').length,
    }
  }, [recommendations?.recommendations, recPriorityFilter])

  const recPriorityCounts = useMemo(() => {
    if (!recommendations?.recommendations) return { urgent: 0, high: 0, medium: 0, low: 0 }
    const list = recTypeFilter === 'all'
      ? recommendations.recommendations
      : recommendations.recommendations.filter(r => r.type === recTypeFilter)
    return {
      urgent: list.filter(r => r.priority === 'urgent').length,
      high: list.filter(r => r.priority === 'high').length,
      medium: list.filter(r => r.priority === 'medium').length,
      low: list.filter(r => r.priority === 'low').length,
    }
  }, [recommendations?.recommendations, recTypeFilter])

  // Auto-reset cross-filter if it yields zero results
  useEffect(() => {
    if (recPriorityFilter !== 'all' && recPriorityCounts[recPriorityFilter as keyof typeof recPriorityCounts] === 0) {
      setRecPriorityFilter('all')
    }
  }, [recPriorityCounts, recPriorityFilter])

  useEffect(() => {
    if (recTypeFilter !== 'all' && recTypeCounts[recTypeFilter as keyof typeof recTypeCounts] === 0) {
      setRecTypeFilter('all')
    }
  }, [recTypeCounts, recTypeFilter])

  const filteredViolations = useMemo(() => {
    if (!violations?.violations) return []
    const list = violations.violations as unknown as FIFOViolation[]
    if (fifoSeverityFilter === 'all') return list
    return list.filter(v => violationSeverity(v.daysDifference) === fifoSeverityFilter)
  }, [violations?.violations, fifoSeverityFilter])

  const fifoSeverityCounts = useMemo(() => {
    if (!violations?.violations) return { critical: 0, high: 0, medium: 0, low: 0 }
    const list = violations.violations as unknown as FIFOViolation[]
    return {
      critical: list.filter(v => v.daysDifference >= 60).length,
      high: list.filter(v => v.daysDifference >= 30 && v.daysDifference < 60).length,
      medium: list.filter(v => v.daysDifference >= 14 && v.daysDifference < 30).length,
      low: list.filter(v => v.daysDifference < 14).length,
    }
  }, [violations?.violations])

  const filteredSlowMoving = useMemo(() => {
    if (!slowMoving?.packages) return []
    const list = slowMoving.packages as unknown as SlowMovingPackage[]
    if (slowTierFilter === 'all') return list
    return list.filter(p => p.tier === slowTierFilter)
  }, [slowMoving?.packages, slowTierFilter])

  // Active selection count based on current tab
  const activeSelectedCount = activeTab === 'recommendations' ? selectedRecs.size
    : activeTab === 'fifo' ? selectedFifo.size
    : selectedSlow.size

  // ---- Bulk action mutation ----

  const bulkExecuteAgingAction = trpc.inventory.bulkExecuteAgingAction.useMutation({
    onSuccess: (data) => {
      if (data.status === 'preview') {
        setBulkDialog(prev => ({
          ...prev,
          status: 'confirming',
          summary: data.summary,
        }))
      } else {
        setBulkDialog(prev => ({ ...prev, status: 'completed', error: null }))
        setSelectedRecs(new Set())
        setSelectedFifo(new Set())
        setSelectedSlow(new Set())
        void utils.inventory.agingRecommendations.invalidate()
        void utils.inventory.fifoViolations.invalidate()
        void utils.inventory.slowMoving.invalidate()
        void utils.inventory.agingDistribution.invalidate()
      }
    },
    onError: (err) => {
      setBulkDialog(prev => ({ ...prev, status: 'error', error: err.message }))
    },
  })

  // Auto-close bulk dialog after completion
  useEffect(() => {
    if (bulkDialog.status !== 'completed') return
    const timer = setTimeout(() => setBulkDialog(prev => ({ ...prev, open: false, status: 'idle' })), 1500)
    return () => clearTimeout(timer)
  }, [bulkDialog.status])

  const buildBulkActions = useCallback(() => {
    const actions: { actionType: AgingActionType; packageLabel: string; note?: string }[] = []

    if (activeTab === 'recommendations') {
      for (const rec of filteredRecommendations) {
        // Use composite key (label:type) to handle duplicate labels with different action types
        if (selectedRecs.has(`${rec.packageLabel}:${rec.type}`)) {
          actions.push({ actionType: rec.type as AgingActionType, packageLabel: rec.packageLabel })
        }
      }
    } else if (activeTab === 'fifo') {
      for (const v of filteredViolations) {
        if (selectedFifo.has(v.olderPackage.label)) {
          actions.push({
            actionType: 'fifo_priority',
            packageLabel: v.olderPackage.label,
            note: `FIFO Priority - use before ${v.newerPackage.label}`,
          })
        }
      }
    } else {
      for (const pkg of filteredSlowMoving) {
        if (selectedSlow.has(pkg.label)) {
          actions.push({ actionType: slowMovingActionType(pkg.tier), packageLabel: pkg.label })
        }
      }
    }
    return actions
  }, [activeTab, filteredRecommendations, selectedRecs, filteredViolations, selectedFifo, filteredSlowMoving, selectedSlow])

  const handleBulkExecute = useCallback(() => {
    const actions = buildBulkActions()
    if (actions.length === 0) return
    setBulkDialog({ open: true, status: 'previewing', summary: [], previewedActions: actions, error: null })
    bulkExecuteAgingAction.mutate({ facilityId, actions, confirmed: false })
  }, [facilityId, buildBulkActions, bulkExecuteAgingAction])

  const handleBulkConfirm = useCallback(() => {
    // Re-use the previewed actions to ensure consistency with preview
    const actions = bulkDialog.previewedActions
    if (actions.length === 0) return
    setBulkDialog(prev => ({ ...prev, status: 'executing' }))
    bulkExecuteAgingAction.mutate({ facilityId, actions, confirmed: true })
  }, [facilityId, bulkDialog.previewedActions, bulkExecuteAgingAction])

  const handleBulkCancel = useCallback(() => {
    setBulkDialog({ open: false, status: 'idle', summary: [], previewedActions: [], error: null })
  }, [])

  const clearSelection = useCallback(() => {
    if (activeTab === 'recommendations') setSelectedRecs(new Set())
    else if (activeTab === 'fifo') setSelectedFifo(new Set())
    else setSelectedSlow(new Set())
  }, [activeTab])

  // ---- Bucket cards config ----

  const buckets: {
    key: keyof Pick<AgingDistributionData, 'fresh' | 'normal' | 'aging' | 'critical'>
    label: string
    colorBorder: string
    colorBg: string
    colorText: string
    colorAccent: string
  }[] = [
    {
      key: 'fresh',
      label: 'Fresh (0-30d)',
      colorBorder: 'border-emerald-500/30',
      colorBg: 'bg-emerald-500/10',
      colorText: 'text-emerald-500',
      colorAccent: 'bg-emerald-500',
    },
    {
      key: 'normal',
      label: 'Normal (31-60d)',
      colorBorder: 'border-blue-500/30',
      colorBg: 'bg-blue-500/10',
      colorText: 'text-blue-500',
      colorAccent: 'bg-blue-500',
    },
    {
      key: 'aging',
      label: 'Aging (61-90d)',
      colorBorder: 'border-yellow-500/30',
      colorBg: 'bg-yellow-500/10',
      colorText: 'text-yellow-500',
      colorAccent: 'bg-yellow-500',
    },
    {
      key: 'critical',
      label: 'Critical (90d+)',
      colorBorder: 'border-red-500/30',
      colorBg: 'bg-red-500/10',
      colorText: 'text-red-500',
      colorAccent: 'bg-red-500',
    },
  ]

  // ---- Tab definitions ----

  const tabs: { key: TabKey; label: string; icon: React.ElementType; count?: number }[] = [
    {
      key: 'fifo',
      label: 'FIFO Violations',
      icon: ArrowRightLeft,
      count: violations?.totalViolations,
    },
    {
      key: 'recommendations',
      label: 'Recommendations',
      icon: Lightbulb,
      count: recommendations?.totalRecommendations,
    },
    {
      key: 'slow-moving',
      label: 'Slow Moving',
      icon: Snail,
      count: slowMoving?.totalSlowMoving,
    },
  ]

  // ---- Render ----

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Inventory Aging</h1>
        <p className="text-muted-foreground mt-1">
          FIFO analysis, aging distribution, and discount recommendations
        </p>
      </div>

      {/* Discount Engine cross-link — hidden until feature is ready for go-live */}

      {/* ================================================================= */}
      {/* Top Summary Cards                                                  */}
      {/* ================================================================= */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {agingLoading || violationsLoading ? (
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
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Average Age</span>
              </div>
              <p className="text-2xl font-bold">
                {aging?.averageAgeDays != null ? `${Math.round(aging.averageAgeDays)}d` : '--'}
              </p>
            </div>

            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Median Age</span>
              </div>
              <p className="text-2xl font-bold">
                {aging?.medianAgeDays != null ? `${Math.round(aging.medianAgeDays)}d` : '--'}
              </p>
            </div>

            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Total Packages</span>
              </div>
              <p className="text-2xl font-bold">
                {aging?.totalPackages != null ? aging.totalPackages.toLocaleString() : '--'}
              </p>
              {(aging?.excludedFromAging ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {aging!.excludedFromAging!.toLocaleString()} in long-term storage excluded
                </p>
              )}
            </div>

            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className={cn('h-4 w-4', (violations?.totalViolations ?? 0) > 0 ? 'text-red-500' : 'text-muted-foreground')} />
                <span className="text-xs text-muted-foreground">FIFO Violations</span>
              </div>
              <p className={cn('text-2xl font-bold', (violations?.totalViolations ?? 0) > 0 && 'text-red-500')}>
                {violations?.totalViolations != null ? violations.totalViolations.toLocaleString() : '--'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* ================================================================= */}
      {/* Aging Distribution Buckets                                         */}
      {/* ================================================================= */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Aging Distribution</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {agingLoading ? (
            <>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="card-modern p-5">
                  <Skeleton className="h-4 w-28 mb-3" />
                  <Skeleton className="h-8 w-14 mb-2" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </>
          ) : (
            buckets.map((bucket) => {
              const data = aging?.[bucket.key]
              return (
                <Link
                  key={bucket.key}
                  href={`/facilities/${facilityId}/inventory?age=${bucket.key}`}
                  className={cn(
                    'rounded-lg border p-5 transition-colors cursor-pointer hover:ring-2 ring-primary/30',
                    bucket.colorBorder,
                    bucket.colorBg
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={cn('h-2.5 w-2.5 rounded-full', bucket.colorAccent)} />
                    <span className="text-sm font-medium text-muted-foreground">
                      {bucket.label}
                    </span>
                  </div>
                  <p className={cn('text-3xl font-bold', bucket.colorText)}>
                    {data?.count != null ? data.count.toLocaleString() : '0'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {data?.totalQuantity != null
                      ? `${data.totalQuantity.toLocaleString()} total units`
                      : 'No packages'}
                  </p>
                </Link>
              )
            })
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* Tabs                                                               */}
      {/* ================================================================= */}
      <div className="mb-4 flex gap-1 border-b border-border pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-md transition-colors -mb-px border-b-2',
              activeTab === tab.key
                ? 'border-primary text-foreground bg-card'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
            {tab.count != null && (
              <span
                className={cn(
                  'ml-1 text-xs rounded-full px-2 py-0.5',
                  activeTab === tab.key
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ================================================================= */}
      {/* FIFO Violations Tab                                                */}
      {/* ================================================================= */}
      {activeTab === 'fifo' && (
        <div className="card-modern">
          {/* Filter pills */}
          {violations?.violations?.length ? (
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <span className="text-xs text-muted-foreground mr-1">Severity:</span>
              {([
                { key: 'all', label: 'All', count: violations.totalViolations },
                { key: 'critical', label: 'Critical', count: fifoSeverityCounts.critical },
                { key: 'high', label: 'High', count: fifoSeverityCounts.high },
                { key: 'medium', label: 'Medium', count: fifoSeverityCounts.medium },
                { key: 'low', label: 'Low', count: fifoSeverityCounts.low },
              ] as const).map((pill) => (
                <button
                  key={pill.key}
                  onClick={() => setFifoSeverityFilter(pill.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    fifoSeverityFilter === pill.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  {pill.label}
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                    fifoSeverityFilter === pill.key
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-background/50'
                  )}>
                    {pill.count}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {violationsLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !violations?.violations?.length ? (
            <div className="p-12 text-center">
              <ArrowRightLeft className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold mb-1">No FIFO Violations</h3>
              <p className="text-sm text-muted-foreground">
                Inventory is being moved in proper first-in, first-out order.
              </p>
            </div>
          ) : !filteredViolations.length ? (
            <div className="p-12 text-center">
              <p className="text-sm text-muted-foreground">No violations match this filter.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {ACTIONS_ENABLED && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={filteredViolations.length > 0 && filteredViolations.every(v => selectedFifo.has(v.olderPackage.label))}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedFifo(new Set(filteredViolations.map(v => v.olderPackage.label)))
                          } else {
                            setSelectedFifo(new Set())
                          }
                        }}
                      />
                    </TableHead>
                  )}
                  <TableHead>Severity</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Newer Package (Being Used)</TableHead>
                  <TableHead>Older Package (Skipped)</TableHead>
                  <TableHead className="text-right">Days Diff</TableHead>
                  {ACTIONS_ENABLED && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredViolations.map((v) => (
                  <TableRow key={`${v.olderPackage.label}-${v.newerPackage.label}`}>
                    {ACTIONS_ENABLED && (
                      <TableCell>
                        <Checkbox
                          checked={selectedFifo.has(v.olderPackage.label)}
                          onCheckedChange={(checked) => {
                            setSelectedFifo(prev => {
                              const next = new Set(prev)
                              if (checked) next.add(v.olderPackage.label)
                              else next.delete(v.olderPackage.label)
                              return next
                            })
                          }}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge className={cn('text-xs', violationSeverityColor(v.daysDifference))}>
                        {violationSeverityLabel(v.daysDifference)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{v.category}</span>
                      {v.strain && (
                        <span className="text-xs text-muted-foreground ml-2">({v.strain})</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <PackageLabelLink label={v.newerPackage.label} className="text-sm font-medium font-mono" />
                        <p className="text-xs text-muted-foreground">{v.newerPackage.itemName}</p>
                        <p className="text-xs text-muted-foreground">
                          {v.newerPackage.ageDays}d old &middot; {v.newerPackage.quantity} units
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <PackageLabelLink label={v.olderPackage.label} className="text-sm font-medium font-mono" />
                        <p className="text-xs text-muted-foreground">{v.olderPackage.itemName}</p>
                        <p className="text-xs text-muted-foreground">
                          {v.olderPackage.ageDays}d old &middot; {v.olderPackage.quantity} units
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-semibold">{v.daysDifference}d</span>
                    </TableCell>
                    {ACTIONS_ENABLED && (
                      <TableCell className="text-right">
                        <button
                          onClick={() => openActionDialog({
                            actionType: 'fifo_priority',
                            packageLabel: v.olderPackage.label,
                            packageName: v.olderPackage.itemName,
                            currentQuantity: v.olderPackage.quantity,
                            unitOfMeasure: 'units',
                            note: `FIFO Priority - use before ${v.newerPackage.label}`,
                          })}
                          className="rounded-md bg-primary/10 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/20 transition-colors"
                        >
                          Prioritize Older
                        </button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* Recommendations Tab                                                */}
      {/* ================================================================= */}
      {activeTab === 'recommendations' && (
        <div className="card-modern">
          {/* Filter pills */}
          {recommendations?.recommendations?.length ? (
            <div className="space-y-2 px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground mr-1">Type:</span>
                {([
                  { key: 'all' as const, label: 'All', count: Object.values(recTypeCounts).reduce((a, b) => a + b, 0) },
                  { key: 'discount' as const, label: 'Discount', count: recTypeCounts.discount },
                  { key: 'sample_out' as const, label: 'Sample Out', count: recTypeCounts.sample_out },
                  { key: 'destroy' as const, label: 'Destroy', count: recTypeCounts.destroy },
                  { key: 'remediate' as const, label: 'Remediate', count: recTypeCounts.remediate },
                  { key: 'expedite_testing' as const, label: 'Expedite', count: recTypeCounts.expedite_testing },
                ]).filter(p => p.key === 'all' || p.count > 0).map((pill) => (
                  <button
                    key={pill.key}
                    onClick={() => setRecTypeFilter(pill.key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      recTypeFilter === pill.key
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    )}
                  >
                    {pill.label}
                    <span className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                      recTypeFilter === pill.key
                        ? 'bg-primary-foreground/20 text-primary-foreground'
                        : 'bg-background/50'
                    )}>
                      {pill.count}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground mr-1">Priority:</span>
                {([
                  { key: 'all' as const, label: 'All', count: Object.values(recPriorityCounts).reduce((a, b) => a + b, 0) },
                  { key: 'urgent' as const, label: 'Urgent', count: recPriorityCounts.urgent },
                  { key: 'high' as const, label: 'High', count: recPriorityCounts.high },
                  { key: 'medium' as const, label: 'Medium', count: recPriorityCounts.medium },
                  { key: 'low' as const, label: 'Low', count: recPriorityCounts.low },
                ]).filter(p => p.key === 'all' || p.count > 0).map((pill) => (
                  <button
                    key={pill.key}
                    onClick={() => setRecPriorityFilter(pill.key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      recPriorityFilter === pill.key
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    )}
                  >
                    {pill.label}
                    <span className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                      recPriorityFilter === pill.key
                        ? 'bg-primary-foreground/20 text-primary-foreground'
                        : 'bg-background/50'
                    )}>
                      {pill.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {recommendationsLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !recommendations?.recommendations?.length ? (
            <div className="p-12 text-center">
              <Lightbulb className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold mb-1">No Recommendations</h3>
              <p className="text-sm text-muted-foreground">
                All inventory is within acceptable aging thresholds.
              </p>
            </div>
          ) : !filteredRecommendations.length ? (
            <div className="p-12 text-center">
              <p className="text-sm text-muted-foreground">No recommendations match these filters.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {ACTIONS_ENABLED && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={filteredRecommendations.length > 0 && filteredRecommendations.every(r => selectedRecs.has(`${r.packageLabel}:${r.type}`))}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedRecs(new Set(filteredRecommendations.map(r => `${r.packageLabel}:${r.type}`)))
                          } else {
                            setSelectedRecs(new Set())
                          }
                        }}
                      />
                    </TableHead>
                  )}
                  <TableHead>Priority</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead>Reason</TableHead>
                  {ACTIONS_ENABLED && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecommendations.map((rec) => (
                  <TableRow key={`${rec.packageLabel}:${rec.type}`}>
                    {ACTIONS_ENABLED && (
                      <TableCell>
                        <Checkbox
                          checked={selectedRecs.has(`${rec.packageLabel}:${rec.type}`)}
                          onCheckedChange={(checked) => {
                            setSelectedRecs(prev => {
                              const next = new Set(prev)
                              const key = `${rec.packageLabel}:${rec.type}`
                              if (checked) next.add(key)
                              else next.delete(key)
                              return next
                            })
                          }}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge className={cn('text-xs capitalize', priorityColor(rec.priority))}>
                        {rec.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {typeLabel(rec.type)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <PackageLabelLink label={rec.packageLabel} className="text-sm font-mono font-medium" />
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{rec.itemName}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm">{rec.quantity} {rec.unitOfMeasure}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-semibold">{rec.ageDays}d</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground max-w-[250px] truncate block" title={rec.reason}>
                        {rec.reason}
                      </span>
                    </TableCell>
                    {ACTIONS_ENABLED && (
                    <TableCell className="text-right">
                      <button
                        onClick={() => openActionDialog({
                          actionType: rec.type as AgingActionType,
                          packageLabel: rec.packageLabel,
                          packageName: rec.itemName,
                          currentQuantity: rec.quantity,
                          unitOfMeasure: rec.unitOfMeasure,
                        })}
                        className={cn(
                          'rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
                          rec.type === 'destroy'
                            ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                            : 'bg-primary/10 text-primary hover:bg-primary/20'
                        )}
                      >
                        {actionButtonLabel(rec.type)}
                      </button>
                    </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* Slow Moving Tab                                                    */}
      {/* ================================================================= */}
      {activeTab === 'slow-moving' && (
        <div className="card-modern">
          {/* Filter pills */}
          {slowMoving?.packages?.length ? (
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <span className="text-xs text-muted-foreground mr-1">Tier:</span>
              {([
                { key: 'all', label: 'All', count: slowMoving.totalSlowMoving },
                { key: 'slow', label: 'Slow', count: slowMoving.byTier?.slow ?? 0 },
                { key: 'stagnant', label: 'Stagnant', count: slowMoving.byTier?.stagnant ?? 0 },
                { key: 'dead', label: 'Dead', count: slowMoving.byTier?.dead ?? 0 },
              ] as const).filter(p => p.key === 'all' || p.count > 0).map((pill) => (
                <button
                  key={pill.key}
                  onClick={() => setSlowTierFilter(pill.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    slowTierFilter === pill.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  {pill.label}
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                    slowTierFilter === pill.key
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-background/50'
                  )}>
                    {pill.count}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {slowMovingLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !slowMoving?.packages?.length ? (
            <div className="p-12 text-center">
              <Snail className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold mb-1">No Slow-Moving Inventory</h3>
              <p className="text-sm text-muted-foreground">
                All packages are moving at an acceptable pace.
              </p>
            </div>
          ) : !filteredSlowMoving.length ? (
            <div className="p-12 text-center">
              <p className="text-sm text-muted-foreground">No packages match this filter.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {ACTIONS_ENABLED && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={filteredSlowMoving.length > 0 && filteredSlowMoving.every(p => selectedSlow.has(p.label))}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedSlow(new Set(filteredSlowMoving.map(p => p.label)))
                          } else {
                            setSelectedSlow(new Set())
                          }
                        }}
                      />
                    </TableHead>
                  )}
                  <TableHead>Tier</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead>Location</TableHead>
                  {ACTIONS_ENABLED && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSlowMoving.map((pkg) => (
                  <TableRow key={pkg.label}>
                    {ACTIONS_ENABLED && (
                      <TableCell>
                        <Checkbox
                          checked={selectedSlow.has(pkg.label)}
                          onCheckedChange={(checked) => {
                            setSelectedSlow(prev => {
                              const next = new Set(prev)
                              if (checked) next.add(pkg.label)
                              else next.delete(pkg.label)
                              return next
                            })
                          }}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge className={cn('text-xs capitalize', tierColor(pkg.tier))}>
                        {pkg.tier}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{pkg.itemName}</p>
                        <p className="text-xs text-muted-foreground">{pkg.itemCategory}</p>
                        {pkg.strain && (
                          <p className="text-xs text-muted-foreground">{pkg.strain}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <PackageLabelLink label={pkg.label} className="text-sm font-mono" />
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm">
                        {pkg.quantity.toLocaleString()} {pkg.unitOfMeasure}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-semibold">{pkg.ageDays}d</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {pkg.location || '--'}
                      </span>
                    </TableCell>
                    {ACTIONS_ENABLED && (
                      <TableCell className="text-right">
                        <button
                          onClick={() => openActionDialog({
                            actionType: slowMovingActionType(pkg.tier),
                            packageLabel: pkg.label,
                            packageName: pkg.itemName,
                            currentQuantity: pkg.quantity,
                            unitOfMeasure: pkg.unitOfMeasure,
                          })}
                          className={cn(
                            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                            pkg.tier === 'dead'
                              ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                              : 'bg-primary/10 text-primary hover:bg-primary/20'
                          )}
                        >
                          {slowMovingButtonLabel(pkg.tier)}
                        </button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* Bulk Action Floating Panel                                         */}
      {/* ================================================================= */}
      {ACTIONS_ENABLED && activeSelectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{activeSelectedCount} selected</span>
          <div className="h-4 w-px bg-border" />
          <button
            onClick={handleBulkExecute}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/20 transition-colors"
          >
            <CheckCircle className="h-3.5 w-3.5" />
            {activeTab === 'fifo' ? 'Prioritize Older' : activeTab === 'recommendations' ? 'Execute Selected' : 'Execute Recommended'} ({activeSelectedCount})
          </button>
          <button
            onClick={clearSelection}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* Bulk Confirmation Dialog                                           */}
      {/* ================================================================= */}
      <Dialog open={bulkDialog.open} onOpenChange={(open) => {
        if (!open) handleBulkCancel()
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {bulkDialog.status === 'completed' ? 'Bulk Action Complete' : 'Confirm Bulk Action'}
            </DialogTitle>
            <DialogDescription>
              {bulkDialog.status === 'previewing' && 'Loading action preview...'}
              {bulkDialog.status === 'confirming' && 'Review the actions below before executing.'}
              {bulkDialog.status === 'executing' && 'Executing actions...'}
              {bulkDialog.status === 'completed' && 'All actions have been executed successfully.'}
              {bulkDialog.status === 'error' && 'An error occurred while executing actions.'}
            </DialogDescription>
          </DialogHeader>

          {bulkDialog.status === 'previewing' && (
            <div className="space-y-2 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          )}

          {(bulkDialog.status === 'confirming' || bulkDialog.status === 'executing') && (
            <div className="max-h-[300px] overflow-y-auto py-2">
              {bulkDialog.summary.map((group) => (
                <div key={group.actionType} className="mb-3 last:mb-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge variant="outline" className="text-xs">{typeLabel(group.actionType)}</Badge>
                    <span className="text-xs text-muted-foreground">{group.count} package{group.count !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="space-y-1 pl-2">
                    {group.packages.map((pkg) => (
                      <div key={pkg.label} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-muted-foreground">{pkg.label.slice(-8)}</span>
                        <span className="text-muted-foreground truncate">{pkg.itemName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {bulkDialog.status === 'completed' && (
            <div className="flex items-center gap-2 py-4 text-emerald-500">
              <CheckCircle className="h-5 w-5" />
              <span className="text-sm font-medium">All actions completed successfully.</span>
            </div>
          )}

          {bulkDialog.status === 'error' && (
            <div className="py-4">
              <p className="text-sm text-destructive">{bulkDialog.error}</p>
            </div>
          )}

          <DialogFooter>
            {bulkDialog.status === 'confirming' && (
              <>
                <button
                  onClick={handleBulkCancel}
                  className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkConfirm}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Confirm &amp; Execute
                </button>
              </>
            )}
            {bulkDialog.status === 'error' && (
              <button
                onClick={handleBulkCancel}
                className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aging Action Confirmation Dialog */}
      <AgingActionDialog
        open={actionDialog.open}
        onOpenChange={(open) => setActionDialog(prev => ({ ...prev, open }))}
        actionType={actionDialog.actionType}
        packageLabel={actionDialog.packageLabel}
        packageName={actionDialog.packageName}
        currentQuantity={actionDialog.currentQuantity}
        unitOfMeasure={actionDialog.unitOfMeasure}
        status={actionDialog.status}
        previewDescription={actionDialog.previewDescription}
        error={actionDialog.error}
        onConfirm={handleActionConfirm}
        onCancel={handleActionCancel}
      />
    </div>
  )
}
