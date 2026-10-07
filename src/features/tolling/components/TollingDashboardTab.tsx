'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { trpc } from '@/lib/trpc-client'
import { KpiCard } from '@/shared/components/KpiCard'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  DollarSign, Beaker, Users, TrendingUp, AlertTriangle,
  CheckCircle2, Clock, ArrowRight,
} from 'lucide-react'
import type { AgreementItem, BatchRow, Tab } from '@/features/tolling/types'

interface TollingDashboardTabProps {
  facilityId: string
  onNavigate: (tab: Tab) => void
}

interface BatchStageCount {
  stage: string
  count: number
  color: string
}

export function TollingDashboardTab({ facilityId, onNavigate }: TollingDashboardTabProps) {
  const { data: rawAgreements, isLoading: agreementsLoading } = trpc.tolling.listAgreements.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 60_000 },
  )
  const agreements = rawAgreements as unknown as AgreementItem[] | undefined

  const { data: rawBatches, isLoading: batchesLoading } = trpc.tolling.listBatches.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 60_000 },
  )
  const batches = rawBatches as unknown as BatchRow[] | undefined

  const isLoading = agreementsLoading || batchesLoading

  // Compute aggregate KPIs
  const kpis = useMemo(() => {
    if (!agreements || !batches) return null

    const activeAgreements = agreements.filter(a => a.status === 'ACTIVE')
    const totalInputWeight = batches.reduce((sum, b) => sum + (b.inputWeight ?? 0), 0)
    const totalOutputWeight = batches.reduce((sum, b) => sum + (b.outputWeight ?? 0), 0)
    const avgYield = totalInputWeight > 0
      ? Math.round((totalOutputWeight / totalInputWeight) * 1000) / 10
      : 0
    const totalFees = agreements.reduce((sum, a) => sum + (a.totalFees ?? 0), 0)
    const uniquePartners = new Set(agreements.map(a => a.partnerName)).size

    return {
      activeAgreements: activeAgreements.length,
      totalBatches: batches.length,
      totalInputWeight,
      totalOutputWeight,
      avgYield,
      totalFees,
      uniquePartners,
    }
  }, [agreements, batches])

  // Batch stage breakdown
  const stageBreakdown = useMemo((): BatchStageCount[] => {
    if (!batches) return []

    const counts = new Map<string, number>()
    for (const b of batches) {
      const stage = b.lifecycleStage || 'UNKNOWN'
      counts.set(stage, (counts.get(stage) ?? 0) + 1)
    }

    const stageColors: Record<string, string> = {
      INTAKE: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      PROCESSING: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      TESTING: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
      FINISHED: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
      SELLING: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
      COMMENCED: 'bg-primary/10 text-primary border-primary/20',
    }

    const stageOrder = ['INTAKE', 'PROCESSING', 'TESTING', 'FINISHED', 'SELLING', 'COMMENCED']
    return stageOrder
      .filter(s => counts.has(s))
      .map(s => ({
        stage: s,
        count: counts.get(s) ?? 0,
        color: stageColors[s] ?? '',
      }))
  }, [batches])

  // Partner summary — aggregate across agreements and batches
  const partnerSummary = useMemo(() => {
    if (!agreements || !batches) return []

    const partners = new Map<string, {
      name: string
      agreementCount: number
      batchCount: number
      totalInput: number
      totalOutput: number
      totalFees: number
      avgYield: number
    }>()

    for (const a of agreements) {
      const existing = partners.get(a.partnerName) ?? {
        name: a.partnerName,
        agreementCount: 0,
        batchCount: 0,
        totalInput: 0,
        totalOutput: 0,
        totalFees: 0,
        avgYield: 0,
      }
      existing.agreementCount++
      existing.totalFees += a.totalFees ?? 0
      partners.set(a.partnerName, existing)
    }

    for (const b of batches) {
      const partnerName = b.agreement?.partnerName
      if (!partnerName) continue
      const existing = partners.get(partnerName)
      if (!existing) continue
      existing.batchCount++
      existing.totalInput += b.inputWeight ?? 0
      existing.totalOutput += b.outputWeight ?? 0
    }

    return Array.from(partners.values())
      .map(p => ({
        ...p,
        avgYield: p.totalInput > 0
          ? Math.round((p.totalOutput / p.totalInput) * 1000) / 10
          : 0,
      }))
      .sort((a, b) => b.totalInput - a.totalInput)
  }, [agreements, batches])

  // At-risk batches — high yield variance or stalled
  const atRiskBatches = useMemo(() => {
    if (!batches) return []
    return batches.filter(b => {
      if (b.yieldVariance !== null && b.yieldVariance !== undefined && Math.abs(b.yieldVariance) > 10) return true
      if (b.lifecycleStage === 'INTAKE' && b.startedAt) {
        const daysSinceStart = Math.floor((Date.now() - new Date(b.startedAt).getTime()) / (1000 * 60 * 60 * 24))
        if (daysSinceStart > 14) return true
      }
      return false
    })
  }, [batches])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card-modern p-4 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Active Agreements"
          value={kpis?.activeAgreements ?? 0}
          icon={Users}
          color="text-blue-500"
        />
        <KpiCard
          label="Total Batches"
          value={kpis?.totalBatches ?? 0}
          icon={Beaker}
          color="text-purple-500"
        />
        <KpiCard
          label="Avg Yield"
          value={kpis?.avgYield ? `${kpis.avgYield}%` : '—'}
          icon={TrendingUp}
          color="text-emerald-500"
        />
        <KpiCard
          label="Total Fees"
          value={kpis?.totalFees ? `$${kpis.totalFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0'}
          icon={DollarSign}
          color="text-foreground"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Batch Pipeline */}
        <div className="card-modern p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Beaker className="h-4 w-4" />
              Batch Pipeline
            </h3>
            <button
              onClick={() => onNavigate('batches')}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              View all <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          {stageBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No batches yet. Create your first batch in the Batches tab.</p>
          ) : (
            <div className="space-y-3">
              {stageBreakdown.map(s => (
                <div key={s.stage} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn('text-xs', s.color)}>
                      {s.stage}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.count}</span>
                    <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/60"
                        style={{ width: `${Math.min(100, (s.count / (kpis?.totalBatches ?? 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* At-Risk Batches */}
        <div className="card-modern p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Needs Attention
              {atRiskBatches.length > 0 && (
                <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 text-xs">
                  {atRiskBatches.length}
                </Badge>
              )}
            </h3>
          </div>

          {atRiskBatches.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              All batches on track
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {atRiskBatches.slice(0, 8).map(b => (
                <div
                  key={b.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium truncate block">
                      {b.agreement?.partnerName ?? 'Unlinked'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {b.lifecycleStage}
                      {b.yieldVariance !== null && b.yieldVariance !== undefined && Math.abs(b.yieldVariance) > 10
                        ? ` · Yield variance: ${b.yieldVariance > 0 ? '+' : ''}${b.yieldVariance.toFixed(1)}%`
                        : ' · Stalled >14 days'}
                    </span>
                  </div>
                  <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 text-xs shrink-0">
                    At Risk
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Partner Performance */}
      {partnerSummary.length > 0 && (
        <div className="card-modern p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" />
              Partner Performance
            </h3>
            <button
              onClick={() => onNavigate('compare')}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              Compare <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Partner</th>
                  <th className="text-right py-2 px-4 font-medium text-muted-foreground">Agreements</th>
                  <th className="text-right py-2 px-4 font-medium text-muted-foreground">Batches</th>
                  <th className="text-right py-2 px-4 font-medium text-muted-foreground">Total Input</th>
                  <th className="text-right py-2 px-4 font-medium text-muted-foreground">Avg Yield</th>
                  <th className="text-right py-2 pl-4 font-medium text-muted-foreground">Total Fees</th>
                </tr>
              </thead>
              <tbody>
                {partnerSummary.map(p => (
                  <tr key={p.name} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 pr-4 font-medium">{p.name}</td>
                    <td className="py-2.5 px-4 text-right">{p.agreementCount}</td>
                    <td className="py-2.5 px-4 text-right">{p.batchCount}</td>
                    <td className="py-2.5 px-4 text-right">
                      {p.totalInput > 0 ? `${p.totalInput.toLocaleString()}g` : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {p.avgYield > 0 ? (
                        <span className={cn(
                          p.avgYield >= 70 ? 'text-emerald-500' :
                          p.avgYield >= 50 ? 'text-yellow-500' :
                          'text-red-500'
                        )}>
                          {p.avgYield}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2.5 pl-4 text-right">
                      {p.totalFees > 0
                        ? `$${p.totalFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          onClick={() => onNavigate('agreements')}
          className="card-modern p-4 text-left hover:bg-muted/30 transition-colors group"
        >
          <div className="flex items-center gap-2 mb-1">
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="text-sm font-medium">Manage Agreements</span>
          </div>
          <p className="text-xs text-muted-foreground">Create and manage tolling agreements</p>
        </button>
        <button
          onClick={() => onNavigate('batches')}
          className="card-modern p-4 text-left hover:bg-muted/30 transition-colors group"
        >
          <div className="flex items-center gap-2 mb-1">
            <Beaker className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="text-sm font-medium">Track Batches</span>
          </div>
          <p className="text-xs text-muted-foreground">Monitor batch lifecycle and yields</p>
        </button>
        <button
          onClick={() => onNavigate('calculator')}
          className="card-modern p-4 text-left hover:bg-muted/30 transition-colors group"
        >
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="text-sm font-medium">Fee Calculator</span>
          </div>
          <p className="text-xs text-muted-foreground">Calculate processing fees and costs</p>
        </button>
      </div>
    </div>
  )
}
