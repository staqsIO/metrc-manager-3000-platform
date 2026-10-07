'use client'

import { Fragment, useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Button } from '@/shared/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/shared/components/ui/table'
import { Calculator, Plus, ArrowRight, Trash2, ChevronDown, ChevronRight, Users, Beaker, BarChart3, Target, Activity, TrendingUp, Package, Search, CheckCircle2, DollarSign, FileSpreadsheet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/shared/components/PageHeader'
import type { TollingComparison, FeeCalculationResult, BreakevenResult, YieldVarianceResult } from '@/services/engines/tolling-engine'
import type { LifecycleStage, BatchLifecycle } from '@/services/engines/tolling-lifecycle-engine'
import type { CalcResult, AgreementItem, BatchRow, AvailablePackage, FeeLine, PartnerScenario, Tab } from '@/features/tolling/types'
import { FEE_TYPES, BASIS_OPTIONS, emptyFeeLine } from '@/features/tolling/types'
import { TollingDashboardTab } from '@/features/tolling/components/TollingDashboardTab'
import { TollingReconciliationTab } from '@/features/tolling/components/TollingReconciliationTab'

// ---------------------------------------------------------------------------
// Lifecycle Visual Components
// ---------------------------------------------------------------------------

const LIFECYCLE_STAGES: LifecycleStage[] = ['INTAKE', 'PROCESSING', 'TESTING', 'FINISHED', 'SELLING', 'COMMENCED']

const STAGE_INDEX: Record<LifecycleStage, number> = {
  INTAKE: 0, PROCESSING: 1, TESTING: 2, FINISHED: 3, SELLING: 4, COMMENCED: 5,
}

function LifecyclePipeline({ stage }: { stage: LifecycleStage }) {
  const currentIdx = STAGE_INDEX[stage] ?? 0
  return (
    <div className="flex items-center gap-1" title={stage}>
      {LIFECYCLE_STAGES.map((s, i) => (
        <div
          key={s}
          className={cn(
            'h-2 w-2 rounded-full transition-colors',
            i <= currentIdx ? 'bg-emerald-500' : 'bg-muted-foreground/20',
          )}
          title={s}
        />
      ))}
    </div>
  )
}

function lifecycleStageBadge(stage: string) {
  const colors: Record<string, string> = {
    INTAKE: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    PROCESSING: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    TESTING: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    FINISHED: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    SELLING: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    COMMENCED: 'bg-primary/10 text-primary border-primary/20',
  }
  return (
    <Badge variant="outline" className={cn('text-xs', colors[stage] ?? '')}>
      {stage}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Package Linking Panel
// ---------------------------------------------------------------------------

function PackageLinkingPanel({
  facilityId,
  batchId,
  type,
  onLinked,
}: {
  facilityId: string
  batchId: string
  type: 'input' | 'output'
  onLinked: () => void
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [previewData, setPreviewData] = useState<Array<{ label: string; itemName: string; quantity: number; unit: string }>>([])


  const packagesQuery = trpc.tolling.getAvailablePackages.useQuery(
    { facilityId, search: search || undefined, category: category || undefined, page, pageSize: 10 },
    { enabled: !!facilityId },
  )
  const linkMutation = trpc.tolling.linkPackages.useMutation()

  const data = packagesQuery.data as { items: AvailablePackage[]; total: number; page: number; totalPages: number; categories: string[] } | undefined

  const toggleSelect = (label: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label); else next.add(label)
      return next
    })
  }

  const handleLink = async () => {
    if (selected.size === 0) return
    const labels = Array.from(selected)
    const linkInput = {
      facilityId,
      batchId,
      confirmed: confirming,
      ...(type === 'input' ? { inputPackageLabels: labels } : { outputPackageLabels: labels }),
    }

    if (!confirming) {
      const result = await linkMutation.mutateAsync(linkInput)
      // Extract preview data from the response
      if (result.status === 'preview' && result.preview) {
        const preview = result.preview as { inputPackages?: Array<{ label: string; itemName: string; quantity: number; unit: string }>; outputPackages?: Array<{ label: string; itemName: string; quantity: number; unit: string }> }
        setPreviewData(type === 'input' ? (preview.inputPackages ?? []) : (preview.outputPackages ?? []))
      }
      setConfirming(true)
      return
    }

    await linkMutation.mutateAsync(linkInput)
    setSelected(new Set())
    setConfirming(false)
    setPreviewData([])
    onLinked()
  }

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Package className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Link {type === 'input' ? 'Input' : 'Output'} Packages</span>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            className="w-full pl-8 p-2 rounded-md border border-border bg-background text-sm"
            placeholder="Search by label or item name..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <select
          className="p-2 rounded-md border border-border bg-background text-sm"
          value={category}
          onChange={e => { setCategory(e.target.value); setPage(1) }}
        >
          <option value="">All Categories</option>
          {(data?.categories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {packagesQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : (data?.items ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No available packages found</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead className="text-xs">Label</TableHead>
                <TableHead className="text-xs">Item</TableHead>
                <TableHead className="text-xs text-right">Qty</TableHead>
                <TableHead className="text-xs">Testing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.items ?? []).map(pkg => (
                <TableRow
                  key={pkg.label}
                  className={cn('cursor-pointer', selected.has(pkg.label) && 'bg-primary/5')}
                  onClick={() => toggleSelect(pkg.label)}
                >
                  <TableCell className="py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(pkg.label)}
                      onChange={() => toggleSelect(pkg.label)}
                      className="rounded border-border"
                    />
                  </TableCell>
                  <TableCell className="text-xs font-mono py-1.5">{pkg.label}</TableCell>
                  <TableCell className="text-xs py-1.5">{pkg.itemName}</TableCell>
                  <TableCell className="text-xs text-right py-1.5">{pkg.quantity} {pkg.unit}</TableCell>
                  <TableCell className="text-xs py-1.5">
                    <Badge variant="outline" className="text-[10px]">{pkg.labTestingState}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{data.total} packages</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="h-7 text-xs">Prev</Button>
                <span className="px-2 py-1">{data.page}/{data.totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)} className="h-7 text-xs">Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {selected.size > 0 && (
        <div className="pt-2 border-t border-border space-y-2">
          {/* Preview details when confirming */}
          {confirming && previewData.length > 0 && (
            <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Will link these packages:</p>
              {previewData.map(p => (
                <div key={p.label} className="text-xs flex justify-between">
                  <span><span className="font-mono">{p.label}</span> {p.itemName}</span>
                  <span className="text-muted-foreground">{p.quantity} {p.unit}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleLink}
              disabled={linkMutation.isPending}
              className="gap-1"
            >
              {linkMutation.isPending ? 'Linking...' : confirming ? (
                <><CheckCircle2 className="h-3.5 w-3.5" /> Confirm Link {selected.size} Packages</>
              ) : (
                <>Link {selected.size} Packages</>
              )}
            </Button>
            {confirming && (
              <Button variant="outline" size="sm" onClick={() => { setConfirming(false); setPreviewData([]) }}>Cancel</Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fee Structure Builder (shared between Advanced and Compare tabs)
// ---------------------------------------------------------------------------

function FeeStructureBuilder({
  fees,
  onChange,
}: {
  fees: FeeLine[]
  onChange: (fees: FeeLine[]) => void
}) {
  const updateFee = (idx: number, partial: Partial<FeeLine>) => {
    const updated = fees.map((f, i) => (i === idx ? { ...f, ...partial } : f))
    onChange(updated)
  }
  const removeFee = (idx: number) => onChange(fees.filter((_, i) => i !== idx))
  const addFee = () => onChange([...fees, emptyFeeLine()])

  return (
    <div className="space-y-2">
      {fees.map((fee, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_1fr_80px_1fr_80px_80px_32px] gap-2 items-end">
          <div>
            {idx === 0 && <label className="text-xs text-muted-foreground block mb-1">Type</label>}
            <select
              className="w-full p-2 rounded-md border border-border bg-background text-sm"
              value={fee.feeType}
              onChange={e => updateFee(idx, { feeType: e.target.value as FeeLine['feeType'] })}
            >
              {FEE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            {idx === 0 && <label className="text-xs text-muted-foreground block mb-1">Label</label>}
            <input
              type="text"
              className="w-full p-2 rounded-md border border-border bg-background text-sm"
              placeholder="Fee label"
              value={fee.label}
              onChange={e => updateFee(idx, { label: e.target.value })}
            />
          </div>
          <div>
            {idx === 0 && <label className="text-xs text-muted-foreground block mb-1">Rate</label>}
            <input
              type="number"
              step="0.01"
              className="w-full p-2 rounded-md border border-border bg-background text-sm"
              value={fee.rate || ''}
              onChange={e => updateFee(idx, { rate: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div>
            {idx === 0 && <label className="text-xs text-muted-foreground block mb-1">Basis</label>}
            <select
              className="w-full p-2 rounded-md border border-border bg-background text-sm"
              value={fee.basis}
              onChange={e => updateFee(idx, { basis: e.target.value as FeeLine['basis'] })}
            >
              {BASIS_OPTIONS.map(b => <option key={b} value={b}>{b.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            {idx === 0 && <label className="text-xs text-muted-foreground block mb-1">Min</label>}
            <input
              type="number"
              step="0.01"
              className="w-full p-2 rounded-md border border-border bg-background text-sm"
              placeholder="--"
              value={fee.minFee ?? ''}
              onChange={e => updateFee(idx, { minFee: e.target.value ? parseFloat(e.target.value) : undefined })}
            />
          </div>
          <div>
            {idx === 0 && <label className="text-xs text-muted-foreground block mb-1">Max</label>}
            <input
              type="number"
              step="0.01"
              className="w-full p-2 rounded-md border border-border bg-background text-sm"
              placeholder="--"
              value={fee.maxFee ?? ''}
              onChange={e => updateFee(idx, { maxFee: e.target.value ? parseFloat(e.target.value) : undefined })}
            />
          </div>
          <div>
            {idx === 0 && <label className="text-xs text-muted-foreground block mb-1">&nbsp;</label>}
            <button
              onClick={() => removeFee(idx)}
              className="p-2 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addFee} className="gap-1 mt-1">
        <Plus className="h-3 w-3" /> Add Fee Line
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Yield Variance Panel (embedded in Agreements tab)
// ---------------------------------------------------------------------------

function YieldVariancePanel({
  facilityId,
  agreementId,
}: {
  facilityId: string
  agreementId: string
}) {
  const varianceQuery = trpc.tolling.yieldVariance.useQuery(
    { facilityId, agreementId },
    { enabled: !!facilityId && !!agreementId },
  )

  const data = varianceQuery.data as unknown as YieldVarianceResult | undefined

  if (varianceQuery.isLoading) {
    return (
      <div className="px-8 py-4 space-y-3">
        {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    )
  }

  if (!data || data.batchCount === 0) {
    return (
      <div className="px-8 py-6 text-center">
        <Activity className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No batch data for yield variance analysis</p>
      </div>
    )
  }

  const reliabilityColor =
    data.reliabilityScore >= 80 ? 'text-emerald-500' :
    data.reliabilityScore >= 50 ? 'text-yellow-500' : 'text-red-500'
  const reliabilityBg =
    data.reliabilityScore >= 80 ? 'bg-emerald-500' :
    data.reliabilityScore >= 50 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="px-8 py-4 space-y-4">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card-modern p-3">
          <div className="text-xs text-muted-foreground mb-1">Reliability Score</div>
          <div className={cn('text-xl font-bold', reliabilityColor)}>{data.reliabilityScore}%</div>
          <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={cn('h-full rounded-full', reliabilityBg)} style={{ width: `${data.reliabilityScore}%` }} />
          </div>
        </div>
        <div className="card-modern p-3">
          <div className="text-xs text-muted-foreground mb-1">Avg Expected</div>
          <div className="text-xl font-bold">{data.avgExpectedYield.toFixed(1)}%</div>
        </div>
        <div className="card-modern p-3">
          <div className="text-xs text-muted-foreground mb-1">Avg Actual</div>
          <div className="text-xl font-bold">{data.avgActualYield.toFixed(1)}%</div>
        </div>
        <div className="card-modern p-3">
          <div className="text-xs text-muted-foreground mb-1">Avg Variance</div>
          <div className={cn(
            'text-xl font-bold',
            data.avgVariance > 0 ? 'text-emerald-500' : data.avgVariance < 0 ? 'text-red-500' : 'text-muted-foreground',
          )}>
            {data.avgVariance > 0 ? '+' : ''}{data.avgVariance.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Per-batch table */}
      {data.batches && data.batches.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Batch</TableHead>
              <TableHead className="text-xs text-right">Expected</TableHead>
              <TableHead className="text-xs text-right">Actual</TableHead>
              <TableHead className="text-xs text-right">Variance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.batches.map((b: { batchId: string; expectedYield: number; actualYield: number; variance: number }) => (
              <TableRow key={b.batchId}>
                <TableCell className="text-xs font-mono py-1">{b.batchId.slice(0, 8)}...</TableCell>
                <TableCell className="text-xs text-right py-1">{b.expectedYield.toFixed(1)}%</TableCell>
                <TableCell className="text-xs text-right py-1">{b.actualYield.toFixed(1)}%</TableCell>
                <TableCell className={cn(
                  'text-xs text-right py-1 font-medium',
                  b.variance > 0 ? 'text-emerald-500' : b.variance < 0 ? 'text-red-500' : 'text-muted-foreground',
                )}>
                  {b.variance > 0 ? '+' : ''}{b.variance.toFixed(1)}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Batch Detail Expansion
// ---------------------------------------------------------------------------

function BatchDetailPanel({
  facilityId,
  batch,
  onRefresh,
}: {
  facilityId: string
  batch: BatchRow
  onRefresh: () => void
}) {
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [showLinkOutput, setShowLinkOutput] = useState(false)

  const lifecycleQuery = trpc.tolling.batchLifecycle.useQuery(
    { facilityId, batchId: batch.id },
    { enabled: !!facilityId && (batch.inputPackageIds.length > 0 || batch.outputPackageIds.length > 0) },
  )
  const lifecycle = lifecycleQuery.data as BatchLifecycle | undefined

  const calcFeesMutation = trpc.tolling.calculateBatchFees.useMutation()

  const handleCalcFees = async () => {
    await calcFeesMutation.mutateAsync({ facilityId, batchId: batch.id })
    onRefresh()
  }

  const handleLinked = () => {
    setShowLinkInput(false)
    setShowLinkOutput(false)
    lifecycleQuery.refetch()
    onRefresh()
  }

  return (
    <div className="px-6 py-4 space-y-4">
      {/* Package columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Input Packages */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Input Packages ({batch.inputPackageIds.length})</span>
            <Button variant="outline" size="sm" onClick={() => setShowLinkInput(!showLinkInput)} className="h-7 text-xs gap-1">
              <Plus className="h-3 w-3" /> Add
            </Button>
          </div>
          {batch.inputPackageIds.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No input packages linked</p>
          ) : (
            <div className="space-y-1">
              {(lifecycle?.inputPackages ?? []).map(p => (
                <div key={p.label} className="text-xs border border-border rounded px-2 py-1.5 flex items-center justify-between">
                  <div>
                    <span className="font-mono">{p.label}</span>
                    <span className="text-muted-foreground ml-2">{p.itemName}</span>
                  </div>
                  <span className="text-muted-foreground">{p.quantity} {p.unit}</span>
                </div>
              ))}
              {!lifecycle && batch.inputPackageIds.length > 0 && (
                <div className="space-y-1">
                  {batch.inputPackageIds.map(l => (
                    <div key={l} className="text-xs border border-border rounded px-2 py-1.5 font-mono">{l}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {showLinkInput && (
            <div className="mt-2">
              <PackageLinkingPanel facilityId={facilityId} batchId={batch.id} type="input" onLinked={handleLinked} />
            </div>
          )}
        </div>

        {/* Output Packages */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Output Packages ({batch.outputPackageIds.length})</span>
            <Button variant="outline" size="sm" onClick={() => setShowLinkOutput(!showLinkOutput)} className="h-7 text-xs gap-1">
              <Plus className="h-3 w-3" /> Add
            </Button>
          </div>
          {batch.outputPackageIds.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No output packages linked</p>
          ) : (
            <div className="space-y-1">
              {(lifecycle?.outputPackages ?? []).map(p => (
                <div key={p.label} className="text-xs border border-border rounded px-2 py-1.5 flex items-center justify-between">
                  <div>
                    <span className="font-mono">{p.label}</span>
                    <span className="text-muted-foreground ml-2">{p.itemName}</span>
                  </div>
                  <span className="text-muted-foreground">{p.quantity} {p.unit}</span>
                </div>
              ))}
              {!lifecycle && batch.outputPackageIds.length > 0 && (
                <div className="space-y-1">
                  {batch.outputPackageIds.map(l => (
                    <div key={l} className="text-xs border border-border rounded px-2 py-1.5 font-mono">{l}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {showLinkOutput && (
            <div className="mt-2">
              <PackageLinkingPanel facilityId={facilityId} batchId={batch.id} type="output" onLinked={handleLinked} />
            </div>
          )}
        </div>
      </div>

      {/* Lifecycle KPIs */}
      {lifecycle && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card-modern p-3">
            <div className="text-xs text-muted-foreground mb-1">Stage</div>
            <div className="flex items-center gap-2">
              {lifecycleStageBadge(lifecycle.stage)}
              <LifecyclePipeline stage={lifecycle.stage} />
            </div>
          </div>
          <div className="card-modern p-3">
            <div className="text-xs text-muted-foreground mb-1">Terminal Descendants</div>
            <div className="text-lg font-bold">{lifecycle.soldCount}/{lifecycle.terminalCount} <span className="text-xs font-normal text-muted-foreground">sold</span></div>
          </div>
          <div className="card-modern p-3">
            <div className="text-xs text-muted-foreground mb-1">Commencement</div>
            <div className={cn('text-lg font-bold', lifecycle.commencementReady ? 'text-emerald-500' : 'text-muted-foreground')}>
              {lifecycle.commencementPct}%
            </div>
            {lifecycle.commencementReady && <div className="text-[10px] text-emerald-500 font-medium">READY</div>}
          </div>
          <div className="card-modern p-3">
            <div className="text-xs text-muted-foreground mb-1">Live Yield</div>
            <div className={cn('text-lg font-bold', lifecycle.liveYieldPct > 0 ? 'text-foreground' : 'text-muted-foreground')}>
              {lifecycle.liveYieldPct}%
            </div>
          </div>
        </div>
      )}

      {lifecycleQuery.isLoading && (batch.inputPackageIds.length > 0 || batch.outputPackageIds.length > 0) && (
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      )}

      {/* Fees section */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleCalcFees} disabled={calcFeesMutation.isPending} className="gap-1 text-xs h-7">
          <DollarSign className="h-3 w-3" />
          {calcFeesMutation.isPending ? 'Calculating...' : 'Calculate Fees'}
        </Button>
        {calcFeesMutation.error && (
          <span className="text-xs text-red-500">{calcFeesMutation.error.message}</span>
        )}
      </div>

      {/* Commencement banner */}
      {lifecycle?.commencementReady && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-emerald-500">Tolling contract commenced</p>
            <p className="text-xs text-muted-foreground">
              All {lifecycle.terminalCount} terminal packages are sold. Money is owed per the tolling agreement.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function TollingPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const [tab, setTab] = useState<Tab>('dashboard')

  // Calculator state
  const [inputWeight, setInputWeight] = useState('')
  const [outputWeight, setOutputWeight] = useState('')
  const [processingFee, setProcessingFee] = useState('')
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)

  // New agreement state
  const [showNewForm, setShowNewForm] = useState(false)
  const [partnerName, setPartnerName] = useState('')
  const [agreementType, setAgreementType] = useState<'INBOUND' | 'OUTBOUND'>('OUTBOUND')
  const [newAgreementBillingMode, setNewAgreementBillingMode] = useState<'SEPARATE_INVOICE' | 'BUILT_INTO_ECONOMICS'>('SEPARATE_INVOICE')
  const [startDate, setStartDate] = useState('')

  // Advanced calc state
  const [advFees, setAdvFees] = useState<FeeLine[]>([emptyFeeLine()])
  const [advInputWeight, setAdvInputWeight] = useState('')
  const [advOutputWeight, setAdvOutputWeight] = useState('')
  const [advRevenue, setAdvRevenue] = useState('')
  const [advCalcEnabled, setAdvCalcEnabled] = useState(false)

  // Batches state
  const [batchFilter, setBatchFilter] = useState('')
  const [showNewBatch, setShowNewBatch] = useState(false)
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null)
  const [newBatchAgreementId, setNewBatchAgreementId] = useState('')
  const [newBatchInputWeight, setNewBatchInputWeight] = useState('')
  const [newBatchYield, setNewBatchYield] = useState('')
  const [newBatchNotes, setNewBatchNotes] = useState('')

  // Compare state
  const [comparePartners, setComparePartners] = useState<PartnerScenario[]>([
    { partnerName: '', feeStructure: [emptyFeeLine()], inputWeight: 0, expectedYieldPct: 0 },
    { partnerName: '', feeStructure: [emptyFeeLine()], inputWeight: 0, expectedYieldPct: 0 },
  ])
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [expandedPartner, setExpandedPartner] = useState<number | null>(null)

  // Breakeven state
  const [bePartnerA, setBePartnerA] = useState<{ name: string; feeStructure: FeeLine[] }>({ name: '', feeStructure: [emptyFeeLine()] })
  const [bePartnerB, setBePartnerB] = useState<{ name: string; feeStructure: FeeLine[] }>({ name: '', feeStructure: [emptyFeeLine()] })
  const [beInputWeight, setBeInputWeight] = useState('')
  const [beRevenue, setBeRevenue] = useState('')
  const [beEnabled, setBeEnabled] = useState(false)

  // Agreements expand state (for yield variance)
  const [expandedAgreementId, setExpandedAgreementId] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  const { data: rawAgreements, isLoading, refetch: refetchAgreements } = trpc.tolling.listAgreements.useQuery(
    { facilityId },
    { enabled: !!facilityId },
  )
  const agreements = rawAgreements as unknown as AgreementItem[] | undefined

  const advCalcQuery = trpc.tolling.advancedCalc.useQuery(
    {
      facilityId,
      feeStructure: advFees.filter(f => f.label && f.rate > 0),
      inputWeight: parseFloat(advInputWeight) || 0,
      outputWeight: parseFloat(advOutputWeight) || 0,
      revenue: advRevenue ? parseFloat(advRevenue) : undefined,
    },
    { enabled: advCalcEnabled && advFees.some(f => f.label && f.rate > 0) && !!parseFloat(advInputWeight) && !!parseFloat(advOutputWeight) },
  )

  const batchesQuery = trpc.tolling.listBatches.useQuery(
    { facilityId, agreementId: batchFilter || undefined },
    { enabled: !!facilityId && tab === 'batches' },
  )

  const compareQuery = trpc.tolling.advancedCompare.useQuery(
    {
      facilityId,
      partners: comparePartners
        .filter(p => p.partnerName && p.feeStructure.some(f => f.label && f.rate > 0))
        .map(p => ({
          ...p,
          feeStructure: p.feeStructure.filter(f => f.label && f.rate > 0),
        })),
    },
    {
      enabled: compareEnabled && comparePartners.filter(p => p.partnerName && p.feeStructure.some(f => f.label && f.rate > 0)).length >= 2,
    },
  )

  // Breakeven query
  const breakevenQuery = trpc.tolling.breakeven.useQuery(
    {
      facilityId,
      partnerA: { name: bePartnerA.name, feeStructure: bePartnerA.feeStructure.filter(f => f.label && f.rate > 0) },
      partnerB: { name: bePartnerB.name, feeStructure: bePartnerB.feeStructure.filter(f => f.label && f.rate > 0) },
      inputWeight: parseFloat(beInputWeight) || 0,
      revenue: beRevenue ? parseFloat(beRevenue) : undefined,
    },
    {
      enabled: beEnabled
        && !!bePartnerA.name && bePartnerA.feeStructure.some(f => f.label && f.rate > 0)
        && !!bePartnerB.name && bePartnerB.feeStructure.some(f => f.label && f.rate > 0)
        && !!parseFloat(beInputWeight),
    },
  )
  const beResult = breakevenQuery.data as unknown as BreakevenResult | undefined

  // Inline breakeven for compare tab (auto-runs when compare has 2+ results)
  const compareResults = compareEnabled && compareQuery.data ? (compareQuery.data as TollingComparison[]) : []
  const top2 = compareResults.length >= 2 ? compareResults.slice(0, 2) : []
  const inlineBePartnerA = top2.length === 2 ? comparePartners.find(p => p.partnerName === top2[0]!.partnerName) : undefined
  const inlineBePartnerB = top2.length === 2 ? comparePartners.find(p => p.partnerName === top2[1]!.partnerName) : undefined
  const inlineBreakevenQuery = trpc.tolling.breakeven.useQuery(
    {
      facilityId,
      partnerA: {
        name: inlineBePartnerA?.partnerName ?? '',
        feeStructure: (inlineBePartnerA?.feeStructure ?? []).filter(f => f.label && f.rate > 0),
      },
      partnerB: {
        name: inlineBePartnerB?.partnerName ?? '',
        feeStructure: (inlineBePartnerB?.feeStructure ?? []).filter(f => f.label && f.rate > 0),
      },
      inputWeight: inlineBePartnerA?.inputWeight ?? 0,
    },
    {
      enabled: !!inlineBePartnerA && !!inlineBePartnerB,
    },
  )
  const inlineBeResult = inlineBreakevenQuery.data as unknown as BreakevenResult | undefined

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const calcMutation = trpc.tolling.calculate.useMutation()
  const createMutation = trpc.tolling.createAgreement.useMutation()
  const createBatchMutation = trpc.tolling.createBatch.useMutation()
  const updateBillingModeMutation = trpc.tolling.updateBillingMode.useMutation()

  const handleCalculate = async () => {
    const iw = parseFloat(inputWeight)
    const ow = parseFloat(outputWeight)
    const pf = parseFloat(processingFee)
    if (isNaN(iw) || isNaN(ow) || isNaN(pf)) return

    const res = await calcMutation.mutateAsync({
      facilityId,
      inputWeight: iw,
      outputWeight: ow,
      processingFee: pf,
    })
    setCalcResult(res as unknown as CalcResult)
  }

  const handleCreateAgreement = async () => {
    if (!partnerName.trim() || !startDate) return

    await createMutation.mutateAsync({
      facilityId,
      partnerName,
      agreementType,
      startDate,
      billingMode: newAgreementBillingMode,
    })

    setPartnerName('')
    setStartDate('')
    setNewAgreementBillingMode('SEPARATE_INVOICE')
    setShowNewForm(false)
    refetchAgreements()
  }

  const handleToggleBillingMode = async (agreementId: string, currentMode: string) => {
    const newMode = currentMode === 'SEPARATE_INVOICE' ? 'BUILT_INTO_ECONOMICS' : 'SEPARATE_INVOICE'
    await updateBillingModeMutation.mutateAsync({
      facilityId,
      agreementId,
      billingMode: newMode as 'SEPARATE_INVOICE' | 'BUILT_INTO_ECONOMICS',
    })
    refetchAgreements()
  }

  const handleCreateBatch = async () => {
    if (!newBatchAgreementId) return
    await createBatchMutation.mutateAsync({
      facilityId,
      agreementId: newBatchAgreementId,
      inputWeight: newBatchInputWeight ? parseFloat(newBatchInputWeight) : undefined,
      expectedYieldPct: newBatchYield ? parseFloat(newBatchYield) : undefined,
      notes: newBatchNotes || undefined,
    })
    setNewBatchAgreementId('')
    setNewBatchInputWeight('')
    setNewBatchYield('')
    setNewBatchNotes('')
    setShowNewBatch(false)
    batchesQuery.refetch()
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const statusBadge = (status: string) => (
    <Badge
      variant="outline"
      className={cn(
        'text-xs',
        status === 'ACTIVE' && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        status === 'COMPLETED' && 'bg-blue-500/10 text-blue-500 border-blue-500/20',
        status === 'CANCELLED' && 'bg-red-500/10 text-red-500 border-red-500/20',
        status === 'DRAFT' && 'bg-gray-500/10 text-gray-500 border-gray-500/20',
      )}
    >
      {status}
    </Badge>
  )



  const updatePartnerScenario = (idx: number, partial: Partial<PartnerScenario>) => {
    setComparePartners(prev => prev.map((p, i) => (i === idx ? { ...p, ...partial } : p)))
  }

  // -------------------------------------------------------------------------
  // Tabs config
  // -------------------------------------------------------------------------

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <Activity className="h-4 w-4" /> },
    { id: 'calculator', label: 'Calculator', icon: <Calculator className="h-4 w-4" /> },
    { id: 'advanced', label: 'Advanced', icon: <BarChart3 className="h-4 w-4" /> },
    { id: 'agreements', label: 'Agreements', icon: <ArrowRight className="h-4 w-4" /> },
    { id: 'batches', label: 'Batches', icon: <Beaker className="h-4 w-4" /> },
    { id: 'compare', label: 'Partner Compare', icon: <Users className="h-4 w-4" /> },
    { id: 'breakeven', label: 'Breakeven', icon: <Target className="h-4 w-4" /> },
    { id: 'reconciliation', label: 'Reconciliation', icon: <FileSpreadsheet className="h-4 w-4" /> },
  ]

  return (
    <div className="p-8">
      <PageHeader
        title="Tolling"
        description="Toll processing calculator, agreements, and analytics"
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2',
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ================================================================= */}
      {/* Dashboard Tab */}
      {/* ================================================================= */}
      {tab === 'dashboard' && (
        <TollingDashboardTab facilityId={facilityId} onNavigate={setTab} />
      )}

      {/* ================================================================= */}
      {/* Calculator Tab (original) */}
      {/* ================================================================= */}
      {tab === 'calculator' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card-modern p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Processing Calculator
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Input Weight (g)</label>
                <input
                  type="number"
                  className="w-full p-2 rounded-md border border-border bg-background text-sm"
                  placeholder="e.g. 1000"
                  value={inputWeight}
                  onChange={(e) => setInputWeight(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Output Weight (g)</label>
                <input
                  type="number"
                  className="w-full p-2 rounded-md border border-border bg-background text-sm"
                  placeholder="e.g. 200"
                  value={outputWeight}
                  onChange={(e) => setOutputWeight(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Processing Fee ($/g input)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full p-2 rounded-md border border-border bg-background text-sm"
                  placeholder="e.g. 0.50"
                  value={processingFee}
                  onChange={(e) => setProcessingFee(e.target.value)}
                />
              </div>
              <Button onClick={handleCalculate} disabled={calcMutation.isPending} className="w-full gap-2">
                <Calculator className="h-4 w-4" />
                {calcMutation.isPending ? 'Calculating...' : 'Calculate'}
              </Button>
            </div>
          </div>

          {/* Results */}
          <div>
            {calcResult ? (
              <div className="space-y-4">
                <div className="card-modern p-4">
                  <div className="text-xs text-muted-foreground mb-1">Total Fees</div>
                  <div className="text-2xl font-bold">${calcResult.totalFees.toLocaleString()}</div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="card-modern p-4">
                    <div className="text-xs text-muted-foreground mb-1">Yield</div>
                    <div className={cn('text-xl font-bold', calcResult.yieldPercentage >= 20 ? 'text-emerald-500' : 'text-yellow-500')}>
                      {calcResult.yieldPercentage}%
                    </div>
                  </div>
                  <div className="card-modern p-4">
                    <div className="text-xs text-muted-foreground mb-1">Loss</div>
                    <div className="text-xl font-bold text-red-500">{calcResult.lossPercentage}%</div>
                  </div>
                  <div className="card-modern p-4">
                    <div className="text-xs text-muted-foreground mb-1">Cost/g Input</div>
                    <div className="text-xl font-bold">${calcResult.costPerGramInput}</div>
                  </div>
                  <div className="card-modern p-4">
                    <div className="text-xs text-muted-foreground mb-1">Cost/g Output</div>
                    <div className="text-xl font-bold">${calcResult.costPerGramOutput}</div>
                  </div>
                </div>
                <div className="card-modern p-4 flex items-center gap-3 text-sm">
                  <span>{calcResult.inputWeight}g input</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{calcResult.outputWeight}g output</span>
                  <span className="text-muted-foreground">@ ${calcResult.processingFee}/g</span>
                </div>
              </div>
            ) : (
              <div className="card-modern p-12 text-center">
                <Calculator className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">Enter values and click Calculate</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Advanced Tab */}
      {/* ================================================================= */}
      {tab === 'advanced' && (
        <div className="space-y-6">
          <div className="card-modern p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Multi-Fee Calculator
            </h3>

            {/* Fee structure builder */}
            <div className="mb-6">
              <label className="text-sm text-muted-foreground block mb-2">Fee Structure</label>
              <FeeStructureBuilder fees={advFees} onChange={setAdvFees} />
            </div>

            {/* Input fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Input Weight (g)</label>
                <input
                  type="number"
                  className="w-full p-2 rounded-md border border-border bg-background text-sm"
                  placeholder="e.g. 1000"
                  value={advInputWeight}
                  onChange={e => setAdvInputWeight(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Output Weight (g)</label>
                <input
                  type="number"
                  className="w-full p-2 rounded-md border border-border bg-background text-sm"
                  placeholder="e.g. 200"
                  value={advOutputWeight}
                  onChange={e => setAdvOutputWeight(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Revenue ($, optional)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full p-2 rounded-md border border-border bg-background text-sm"
                  placeholder="e.g. 5000"
                  value={advRevenue}
                  onChange={e => setAdvRevenue(e.target.value)}
                />
              </div>
            </div>

            <Button
              onClick={() => setAdvCalcEnabled(true)}
              disabled={!advFees.some(f => f.label && f.rate > 0) || !parseFloat(advInputWeight) || !parseFloat(advOutputWeight)}
              className="gap-2"
            >
              <Calculator className="h-4 w-4" />
              Calculate
            </Button>
          </div>

          {/* Advanced Results */}
          {advCalcEnabled && advCalcQuery.data && (
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="card-modern p-4">
                  <div className="text-xs text-muted-foreground mb-1">Total Fees</div>
                  <div className="text-2xl font-bold">${advCalcQuery.data.totalFees.toLocaleString()}</div>
                </div>
                <div className="card-modern p-4">
                  <div className="text-xs text-muted-foreground mb-1">Yield</div>
                  <div className={cn('text-xl font-bold', advCalcQuery.data.yieldPercentage >= 20 ? 'text-emerald-500' : 'text-yellow-500')}>
                    {advCalcQuery.data.yieldPercentage}%
                  </div>
                </div>
                <div className="card-modern p-4">
                  <div className="text-xs text-muted-foreground mb-1">Cost/g Input</div>
                  <div className="text-xl font-bold">${advCalcQuery.data.costPerGramInput}</div>
                </div>
                <div className="card-modern p-4">
                  <div className="text-xs text-muted-foreground mb-1">Cost/g Output</div>
                  <div className="text-xl font-bold">${advCalcQuery.data.costPerGramOutput}</div>
                </div>
              </div>

              {/* Fee breakdown table */}
              <div className="card-modern">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Basis Value</TableHead>
                      <TableHead className="text-right">Raw Amount</TableHead>
                      <TableHead className="text-right">Capped Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {advCalcQuery.data.fees.map((fee: { feeType: string; label: string; rate: number; basis: string; basisValue: number; rawAmount: number; cappedAmount: number }, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{fee.label}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{fee.feeType}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{fee.basisValue.toLocaleString()}</TableCell>
                        <TableCell className="text-right">${fee.rawAmount.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-medium">
                          ${fee.cappedAmount.toLocaleString()}
                          {fee.rawAmount !== fee.cappedAmount && (
                            <span className="text-xs text-yellow-500 ml-1">(capped)</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {advCalcEnabled && advCalcQuery.isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* Agreements Tab (original) */}
      {/* ================================================================= */}
      {tab === 'agreements' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold">Tolling Agreements</h2>
            <Button onClick={() => setShowNewForm(!showNewForm)} variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              New Agreement
            </Button>
          </div>

          {/* New Agreement Form */}
          {showNewForm && (
            <div className="card-modern p-4 mb-4">
              <h3 className="font-semibold text-sm mb-3">New Agreement</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Partner Name</label>
                  <input
                    type="text"
                    className="w-full p-2 rounded-md border border-border bg-background text-sm"
                    value={partnerName}
                    onChange={(e) => setPartnerName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Type</label>
                  <select
                    className="w-full p-2 rounded-md border border-border bg-background text-sm"
                    value={agreementType}
                    onChange={(e) => setAgreementType(e.target.value as 'INBOUND' | 'OUTBOUND')}
                  >
                    <option value="OUTBOUND">Outbound (they process)</option>
                    <option value="INBOUND">Inbound (we process)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Start Date</label>
                  <input
                    type="date"
                    className="w-full p-2 rounded-md border border-border bg-background text-sm"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Billing Mode</label>
                  <select
                    className="w-full p-2 rounded-md border border-border bg-background text-sm"
                    value={newAgreementBillingMode}
                    onChange={(e) => setNewAgreementBillingMode(e.target.value as 'SEPARATE_INVOICE' | 'BUILT_INTO_ECONOMICS')}
                  >
                    <option value="SEPARATE_INVOICE">Separate Invoice</option>
                    <option value="BUILT_INTO_ECONOMICS">Built Into Economics</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button onClick={handleCreateAgreement} disabled={createMutation.isPending} size="sm">
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
                <Button variant="outline" onClick={() => setShowNewForm(false)} size="sm">Cancel</Button>
              </div>
            </div>
          )}

          {/* Agreements Table */}
          <div className="card-modern">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : (agreements ?? []).length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-muted-foreground">No tolling agreements yet</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead className="text-right">Input (g)</TableHead>
                    <TableHead className="text-right">Output (g)</TableHead>
                    <TableHead className="text-right">Fee ($/g)</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Billing</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(agreements ?? []).map(a => (
                    <Fragment key={a.id}>
                      <TableRow>
                        <TableCell className="font-medium">{a.partnerName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{a.agreementType}</Badge>
                        </TableCell>
                        <TableCell>{statusBadge(a.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(a.startDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">{a.inputWeight ?? '\u2014'}</TableCell>
                        <TableCell className="text-right">{a.outputWeight ?? '\u2014'}</TableCell>
                        <TableCell className="text-right">{a.processingFee ? `$${a.processingFee}` : '\u2014'}</TableCell>
                        <TableCell className="text-right font-medium">
                          {a.totalFees ? `$${a.totalFees.toLocaleString()}` : '\u2014'}
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={() => handleToggleBillingMode(a.id, a.billingMode)}
                            className="cursor-pointer"
                            title="Click to toggle billing mode"
                          >
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px]',
                                a.billingMode === 'BUILT_INTO_ECONOMICS'
                                  ? 'bg-purple-500/10 text-purple-500 border-purple-500/20'
                                  : 'bg-blue-500/10 text-blue-500 border-blue-500/20',
                              )}
                            >
                              {a.billingMode === 'BUILT_INTO_ECONOMICS' ? 'Built-in' : 'Invoice'}
                            </Badge>
                          </button>
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={() => setExpandedAgreementId(expandedAgreementId === a.id ? null : a.id)}
                            className="p-1 rounded hover:bg-accent transition-colors"
                            title="Yield variance"
                          >
                            {expandedAgreementId === a.id
                              ? <ChevronDown className="h-4 w-4" />
                              : <Activity className="h-4 w-4 text-muted-foreground" />
                            }
                          </button>
                        </TableCell>
                      </TableRow>
                      {expandedAgreementId === a.id && (
                        <TableRow>
                          <TableCell colSpan={10} className="bg-muted/30 p-0">
                            <YieldVariancePanel facilityId={facilityId} agreementId={a.id} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Batches Tab */}
      {/* ================================================================= */}
      {tab === 'batches' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-4">
              <h2 className="font-semibold">Tolling Batches</h2>
              {/* Filter by agreement */}
              <select
                className="p-2 rounded-md border border-border bg-background text-sm"
                value={batchFilter}
                onChange={e => setBatchFilter(e.target.value)}
              >
                <option value="">All Agreements</option>
                {(agreements ?? []).map(a => (
                  <option key={a.id} value={a.id}>{a.partnerName} ({a.agreementType})</option>
                ))}
              </select>
            </div>
            <Button onClick={() => setShowNewBatch(!showNewBatch)} variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              New Batch
            </Button>
          </div>

          {/* New Batch Form */}
          {showNewBatch && (
            <div className="card-modern p-4 mb-4">
              <h3 className="font-semibold text-sm mb-3">New Batch</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Agreement</label>
                  <select
                    className="w-full p-2 rounded-md border border-border bg-background text-sm"
                    value={newBatchAgreementId}
                    onChange={e => setNewBatchAgreementId(e.target.value)}
                  >
                    <option value="">Select agreement...</option>
                    {(agreements ?? []).map(a => (
                      <option key={a.id} value={a.id}>{a.partnerName} ({a.agreementType})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Input Weight (g)</label>
                  <input
                    type="number"
                    className="w-full p-2 rounded-md border border-border bg-background text-sm"
                    placeholder="e.g. 1000"
                    value={newBatchInputWeight}
                    onChange={e => setNewBatchInputWeight(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Expected Yield %</label>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full p-2 rounded-md border border-border bg-background text-sm"
                    placeholder="e.g. 20"
                    value={newBatchYield}
                    onChange={e => setNewBatchYield(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Notes</label>
                  <input
                    type="text"
                    className="w-full p-2 rounded-md border border-border bg-background text-sm"
                    placeholder="Optional notes"
                    value={newBatchNotes}
                    onChange={e => setNewBatchNotes(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button onClick={handleCreateBatch} disabled={createBatchMutation.isPending || !newBatchAgreementId} size="sm">
                  {createBatchMutation.isPending ? 'Creating...' : 'Create Batch'}
                </Button>
                <Button variant="outline" onClick={() => setShowNewBatch(false)} size="sm">Cancel</Button>
              </div>
            </div>
          )}

          {/* Batches Table */}
          <div className="card-modern">
            {batchesQuery.isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : (batchesQuery.data ?? []).length === 0 ? (
              <div className="p-8 text-center">
                <Beaker className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No batches found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Lifecycle</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Input (g)</TableHead>
                    <TableHead className="text-right">Output (g)</TableHead>
                    <TableHead className="text-right">Yield</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((batchesQuery.data ?? []) as BatchRow[]).map((b) => (
                    <Fragment key={b.id}>
                      <TableRow className={cn(b.lifecycleStage === 'COMMENCED' && 'bg-emerald-500/5')}>
                        <TableCell className="font-medium">
                          {b.agreement?.partnerName ?? '\u2014'}
                          {b.agreement?.agreementType && (
                            <Badge variant="outline" className="text-xs ml-2">{b.agreement.agreementType}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <LifecyclePipeline stage={(b.lifecycleStage || 'INTAKE') as LifecycleStage} />
                        </TableCell>
                        <TableCell>
                          {lifecycleStageBadge(b.lifecycleStage || 'INTAKE')}
                        </TableCell>
                        <TableCell className="text-right">{b.inputWeight != null ? b.inputWeight.toLocaleString() : '\u2014'}</TableCell>
                        <TableCell className="text-right">{b.outputWeight != null ? b.outputWeight.toLocaleString() : '\u2014'}</TableCell>
                        <TableCell className="text-right">{b.actualYieldPct != null ? `${b.actualYieldPct}%` : b.expectedYieldPct != null ? <span className="text-muted-foreground">{b.expectedYieldPct}% exp</span> : '\u2014'}</TableCell>
                        <TableCell className="text-right">
                          {b.yieldVariance != null ? (
                            <span className={cn(
                              'font-medium',
                              b.yieldVariance > 0 && 'text-emerald-500',
                              b.yieldVariance < 0 && 'text-red-500',
                              b.yieldVariance === 0 && 'text-muted-foreground',
                            )}>
                              {b.yieldVariance > 0 ? '+' : ''}{b.yieldVariance}%
                            </span>
                          ) : '\u2014'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(b.startedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={() => setExpandedBatchId(expandedBatchId === b.id ? null : b.id)}
                            className="p-1 rounded hover:bg-accent transition-colors"
                          >
                            {expandedBatchId === b.id
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            }
                          </button>
                        </TableCell>
                      </TableRow>
                      {expandedBatchId === b.id && (
                        <TableRow>
                          <TableCell colSpan={9} className="bg-muted/30 p-0">
                            <BatchDetailPanel
                              facilityId={facilityId}
                              batch={b}
                              onRefresh={() => batchesQuery.refetch()}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Partner Compare Tab */}
      {/* ================================================================= */}
      {tab === 'compare' && (
        <div className="space-y-6">
          {/* Partner scenarios */}
          {comparePartners.map((partner, idx) => (
            <div key={idx} className="card-modern p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Partner {idx + 1}
                </h3>
                {comparePartners.length > 2 && (
                  <button
                    onClick={() => setComparePartners(prev => prev.filter((_, i) => i !== idx))}
                    className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="text-sm text-muted-foreground block mb-1">Partner Name</label>
                  <input
                    type="text"
                    className="w-full p-2 rounded-md border border-border bg-background text-sm"
                    placeholder="e.g. Acme Processing"
                    value={partner.partnerName}
                    onChange={e => updatePartnerScenario(idx, { partnerName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground block mb-1">Input Weight (g)</label>
                  <input
                    type="number"
                    className="w-full p-2 rounded-md border border-border bg-background text-sm"
                    placeholder="e.g. 1000"
                    value={partner.inputWeight || ''}
                    onChange={e => updatePartnerScenario(idx, { inputWeight: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground block mb-1">Expected Yield %</label>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full p-2 rounded-md border border-border bg-background text-sm"
                    placeholder="e.g. 20"
                    value={partner.expectedYieldPct || ''}
                    onChange={e => updatePartnerScenario(idx, { expectedYieldPct: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <label className="text-sm text-muted-foreground block mb-2">Fee Structure</label>
              <FeeStructureBuilder
                fees={partner.feeStructure}
                onChange={fees => updatePartnerScenario(idx, { feeStructure: fees })}
              />
            </div>
          ))}

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setComparePartners(prev => [...prev, { partnerName: '', feeStructure: [emptyFeeLine()], inputWeight: 0, expectedYieldPct: 0 }])}
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> Add Partner
            </Button>
            <Button
              onClick={() => setCompareEnabled(true)}
              disabled={comparePartners.filter(p => p.partnerName && p.feeStructure.some(f => f.label && f.rate > 0)).length < 2}
              className="gap-2"
            >
              <BarChart3 className="h-4 w-4" />
              Compare
            </Button>
          </div>

          {/* Compare Results */}
          {compareEnabled && compareQuery.isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          )}

          {compareEnabled && compareQuery.data && (compareQuery.data as TollingComparison[]).length > 0 && (
            <div className="card-modern">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>Partner</TableHead>
                    <TableHead className="text-right">Total Fees</TableHead>
                    <TableHead className="text-right">Yield</TableHead>
                    <TableHead className="text-right">Cost/g Input</TableHead>
                    <TableHead className="text-right">Cost/g Output</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(compareQuery.data as TollingComparison[]).map((c, idx) => (
                    <Fragment key={idx}>
                      <TableRow className={cn(idx === 0 && 'bg-emerald-500/5')}>
                        <TableCell>
                          <Badge variant={idx === 0 ? 'default' : 'outline'} className="text-xs">
                            #{c.ranking}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{c.partnerName}</TableCell>
                        <TableCell className="text-right font-medium">${c.totalFees.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{c.yieldPercentage}%</TableCell>
                        <TableCell className="text-right">${c.costPerGramInput}</TableCell>
                        <TableCell className="text-right font-medium">${c.costPerGramOutput}</TableCell>
                        <TableCell>
                          <button
                            onClick={() => setExpandedPartner(expandedPartner === idx ? null : idx)}
                            className="p-1 rounded hover:bg-accent transition-colors"
                          >
                            {expandedPartner === idx
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4" />
                            }
                          </button>
                        </TableCell>
                      </TableRow>
                      {expandedPartner === idx && c.feeBreakdown && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/30 p-0">
                            <div className="px-8 py-3">
                              <p className="text-xs text-muted-foreground mb-2 font-medium">Fee Breakdown</p>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="text-xs">Label</TableHead>
                                    <TableHead className="text-xs">Type</TableHead>
                                    <TableHead className="text-xs text-right">Basis Value</TableHead>
                                    <TableHead className="text-xs text-right">Raw</TableHead>
                                    <TableHead className="text-xs text-right">Amount</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {c.feeBreakdown.map((fee: FeeCalculationResult, fi: number) => (
                                    <TableRow key={fi}>
                                      <TableCell className="text-xs py-1">{fee.label}</TableCell>
                                      <TableCell className="text-xs py-1">
                                        <Badge variant="outline" className="text-[10px]">{fee.feeType}</Badge>
                                      </TableCell>
                                      <TableCell className="text-xs text-right py-1">{fee.basisValue.toLocaleString()}</TableCell>
                                      <TableCell className="text-xs text-right py-1">${fee.rawAmount.toLocaleString()}</TableCell>
                                      <TableCell className="text-xs text-right py-1 font-medium">${fee.cappedAmount.toLocaleString()}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Inline breakeven between top 2 ranked partners */}
          {inlineBeResult && (
            <div className="card-modern p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-4 w-4 text-blue-500" />
                <h4 className="text-sm font-semibold">Breakeven: {inlineBeResult.partnerA} vs {inlineBeResult.partnerB}</h4>
              </div>
              {inlineBeResult.breakevenYieldPct != null ? (
                <div className="space-y-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{inlineBeResult.breakevenYieldPct.toFixed(1)}%</span>
                    <span className="text-sm text-muted-foreground">breakeven yield</span>
                  </div>
                  {/* Crossover bar */}
                  <div className="h-3 rounded-full overflow-hidden flex">
                    <div
                      className="bg-blue-500/30 h-full"
                      style={{ width: `${Math.min(inlineBeResult.breakevenYieldPct, 100)}%` }}
                    />
                    <div className="w-0.5 bg-foreground/50 h-full shrink-0" />
                    <div className="bg-emerald-500/30 h-full flex-1" />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{inlineBeResult.partnerA} cheaper</span>
                    <span>{inlineBeResult.partnerB} cheaper</span>
                  </div>
                  {inlineBeResult.recommendation && (
                    <p className="text-sm text-muted-foreground">{inlineBeResult.recommendation}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No crossover found &mdash; one partner is always cheaper.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* Breakeven Tab */}
      {/* ================================================================= */}
      {tab === 'breakeven' && (
        <div className="space-y-6">
          {/* Partner cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Partner A */}
            <div className="card-modern p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Partner A
              </h3>
              <div className="mb-4">
                <label className="text-sm text-muted-foreground block mb-1">Partner Name</label>
                <input
                  type="text"
                  className="w-full p-2 rounded-md border border-border bg-background text-sm"
                  placeholder="e.g. Acme Processing"
                  value={bePartnerA.name}
                  onChange={e => setBePartnerA(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <label className="text-sm text-muted-foreground block mb-2">Fee Structure</label>
              <FeeStructureBuilder
                fees={bePartnerA.feeStructure}
                onChange={fees => setBePartnerA(prev => ({ ...prev, feeStructure: fees }))}
              />
            </div>

            {/* Partner B */}
            <div className="card-modern p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Partner B
              </h3>
              <div className="mb-4">
                <label className="text-sm text-muted-foreground block mb-1">Partner Name</label>
                <input
                  type="text"
                  className="w-full p-2 rounded-md border border-border bg-background text-sm"
                  placeholder="e.g. Beta Labs"
                  value={bePartnerB.name}
                  onChange={e => setBePartnerB(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <label className="text-sm text-muted-foreground block mb-2">Fee Structure</label>
              <FeeStructureBuilder
                fees={bePartnerB.feeStructure}
                onChange={fees => setBePartnerB(prev => ({ ...prev, feeStructure: fees }))}
              />
            </div>
          </div>

          {/* Shared params */}
          <div className="card-modern p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Shared Parameters
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Input Weight (g)</label>
                <input
                  type="number"
                  className="w-full p-2 rounded-md border border-border bg-background text-sm"
                  placeholder="e.g. 1000"
                  value={beInputWeight}
                  onChange={e => setBeInputWeight(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Revenue ($, optional)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full p-2 rounded-md border border-border bg-background text-sm"
                  placeholder="e.g. 5000"
                  value={beRevenue}
                  onChange={e => setBeRevenue(e.target.value)}
                />
              </div>
            </div>
            <Button
              onClick={() => setBeEnabled(true)}
              disabled={
                !bePartnerA.name || !bePartnerB.name
                || !bePartnerA.feeStructure.some(f => f.label && f.rate > 0)
                || !bePartnerB.feeStructure.some(f => f.label && f.rate > 0)
                || !parseFloat(beInputWeight)
              }
              className="gap-2"
            >
              <Target className="h-4 w-4" />
              Find Breakeven
            </Button>
          </div>

          {/* Loading */}
          {beEnabled && breakevenQuery.isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          )}

          {/* Results */}
          {beEnabled && beResult && (
            <div className="space-y-4">
              {/* Big breakeven number */}
              <div className="card-modern p-6 text-center">
                {beResult.breakevenYieldPct != null ? (
                  <>
                    <div className="text-4xl font-bold mb-1">{beResult.breakevenYieldPct.toFixed(1)}%</div>
                    <p className="text-sm text-muted-foreground">Breakeven Yield</p>
                  </>
                ) : (
                  <>
                    <div className="text-xl font-semibold text-muted-foreground mb-1">No crossover found</div>
                    <p className="text-sm text-muted-foreground">One partner is always cheaper across all yield percentages</p>
                  </>
                )}
              </div>

              {/* Fees at breakeven */}
              {beResult.breakevenYieldPct != null && beResult.atBreakeven && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="card-modern p-4">
                    <div className="text-xs text-muted-foreground mb-1">{beResult.partnerA} fees at breakeven</div>
                    <div className="text-xl font-bold">${beResult.atBreakeven.partnerAFees.toLocaleString()}</div>
                  </div>
                  <div className="card-modern p-4">
                    <div className="text-xs text-muted-foreground mb-1">{beResult.partnerB} fees at breakeven</div>
                    <div className="text-xl font-bold">${beResult.atBreakeven.partnerBFees.toLocaleString()}</div>
                  </div>
                </div>
              )}

              {/* Crossover bar */}
              {beResult.breakevenYieldPct != null && (
                <div className="card-modern p-4">
                  <p className="text-xs text-muted-foreground mb-2">Cost crossover</p>
                  <div className="h-4 rounded-full overflow-hidden flex">
                    <div
                      className="bg-blue-500/30 h-full transition-all"
                      style={{ width: `${Math.min(beResult.breakevenYieldPct, 100)}%` }}
                    />
                    <div className="w-0.5 bg-foreground/60 h-full shrink-0" />
                    <div className="bg-emerald-500/30 h-full flex-1" />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>{beResult.partnerA} cheaper</span>
                    <span>{beResult.partnerB} cheaper</span>
                  </div>
                </div>
              )}

              {/* Recommendation */}
              {beResult.recommendation && (
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  {beResult.recommendation}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* Reconciliation Tab */}
      {/* ================================================================= */}
      {tab === 'reconciliation' && (
        <TollingReconciliationTab facilityId={facilityId} />
      )}
    </div>
  )
}
