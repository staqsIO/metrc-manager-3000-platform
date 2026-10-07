'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { trpc } from '@/lib/trpc-client'
import { KpiCard } from '@/shared/components/KpiCard'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/shared/components/ui/table'
import { Button } from '@/shared/components/ui/button'
import {
  ArrowDownUp, Download, DollarSign, Package, TrendingUp,
  ShieldCheck, ShieldAlert, ArrowRight, ChevronDown, ChevronUp,
  FileSpreadsheet,
} from 'lucide-react'
import type { AgreementItem } from '@/features/tolling/types'
import type { ReconciliationStatement, BatchStatement } from '@/services/engines/tolling-reconciliation-engine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatWeight(val: number): string {
  return val > 0 ? `${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}g` : '0g'
}

function formatCurrency(val: number): string {
  return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatPct(val: number): string {
  return `${val.toFixed(1)}%`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MaterialFlowCard({ statement }: { statement: ReconciliationStatement }) {
  return (
    <div className="card-modern p-6">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <Package className="h-4 w-4" />
        Material Flow
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Input Weight</p>
          <p className="text-lg font-bold">{formatWeight(statement.totalInputWeight)}</p>
        </div>
        <div className="flex items-center justify-center">
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Output Weight</p>
          <p className="text-lg font-bold">{formatWeight(statement.totalOutputWeight)}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Yield</p>
            <p className={cn(
              'text-lg font-bold',
              statement.overallYieldPct >= 70 ? 'text-emerald-500' :
              statement.overallYieldPct >= 50 ? 'text-yellow-500' :
              'text-red-500',
            )}>
              {formatPct(statement.overallYieldPct)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Waste</p>
            <p className="text-lg font-bold text-muted-foreground">{formatPct(statement.overallWastePct)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function FeesSummaryCard({ statement }: { statement: ReconciliationStatement }) {
  const feeTypeEntries = Object.entries(statement.feesByType).sort((a, b) => b[1] - a[1])

  return (
    <div className="card-modern p-6">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <DollarSign className="h-4 w-4" />
        Fees Summary
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Total Fees</p>
          <p className="text-lg font-bold">{formatCurrency(statement.totalFees)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Cost/g (input)</p>
          <p className="text-lg font-bold">{formatCurrency(statement.costPerGramInput)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Cost/g (output)</p>
          <p className="text-lg font-bold">{formatCurrency(statement.costPerGramOutput)}</p>
        </div>
      </div>
      {feeTypeEntries.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">Fee Breakdown by Type</p>
          <div className="space-y-1.5">
            {feeTypeEntries.map(([type, amount]) => (
              <div key={type} className="flex items-center justify-between text-sm">
                <Badge variant="outline" className="text-xs">{type}</Badge>
                <span className="font-medium">{formatCurrency(amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function YieldGuaranteeCard({ statement }: { statement: ReconciliationStatement }) {
  if (statement.yieldGuarantee == null) return null

  const met = statement.yieldGuaranteeMet
  const Icon = met ? ShieldCheck : ShieldAlert

  return (
    <div className="card-modern p-6">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <Icon className={cn('h-4 w-4', met ? 'text-emerald-500' : 'text-red-500')} />
        Yield Guarantee
      </h3>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Guaranteed</p>
          <p className="text-lg font-bold">{formatPct(statement.yieldGuarantee)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Actual</p>
          <p className={cn(
            'text-lg font-bold',
            met ? 'text-emerald-500' : 'text-red-500',
          )}>
            {formatPct(statement.overallYieldPct)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Variance</p>
          <p className={cn(
            'text-lg font-bold',
            (statement.yieldVariance ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500',
          )}>
            {(statement.yieldVariance ?? 0) >= 0 ? '+' : ''}{formatPct(statement.yieldVariance ?? 0)}
          </p>
        </div>
      </div>
      <Badge
        variant="outline"
        className={cn(
          'text-xs',
          met
            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
            : 'bg-red-500/10 text-red-500 border-red-500/20',
        )}
      >
        {met ? 'Guarantee Met' : 'Guarantee Not Met'}
      </Badge>
    </div>
  )
}

function RevenueCard({ statement }: { statement: ReconciliationStatement }) {
  if (statement.totalRevenue == null) return null

  return (
    <div className="card-modern p-6">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4" />
        Revenue &amp; Net Position
      </h3>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Revenue</p>
          <p className="text-lg font-bold text-emerald-500">{formatCurrency(statement.totalRevenue)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Fees</p>
          <p className="text-lg font-bold text-red-500">{formatCurrency(statement.totalFees)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Net Position</p>
          <p className={cn(
            'text-lg font-bold',
            (statement.netPosition ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500',
          )}>
            {formatCurrency(statement.netPosition ?? 0)}
          </p>
        </div>
      </div>
    </div>
  )
}

type SortField = 'batchId' | 'status' | 'lifecycleStage' | 'inputWeight' | 'outputWeight' | 'yieldPct' | 'wastePct' | 'totalFees' | 'commencedAt'
type SortDir = 'asc' | 'desc'

function BatchTable({ batches }: { batches: BatchStatement[] }) {
  const [sortField, setSortField] = useState<SortField>('batchId')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    const copy = [...batches]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'batchId': cmp = a.batchId.localeCompare(b.batchId); break
        case 'status': cmp = a.status.localeCompare(b.status); break
        case 'lifecycleStage': cmp = a.lifecycleStage.localeCompare(b.lifecycleStage); break
        case 'inputWeight': cmp = a.materialIn.totalWeight - b.materialIn.totalWeight; break
        case 'outputWeight': cmp = a.materialOut.totalWeight - b.materialOut.totalWeight; break
        case 'yieldPct': cmp = a.yieldPct - b.yieldPct; break
        case 'wastePct': cmp = a.wastePct - b.wastePct; break
        case 'totalFees': cmp = a.totalFees - b.totalFees; break
        case 'commencedAt': cmp = (a.commencedAt ?? '').localeCompare(b.commencedAt ?? ''); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [batches, sortField, sortDir])

  const SortIcon = sortDir === 'asc' ? ChevronUp : ChevronDown

  function SortableHead({ field, children, className }: { field: SortField; children: React.ReactNode; className?: string }) {
    return (
      <TableHead
        className={cn('cursor-pointer select-none text-xs', className)}
        onClick={() => toggleSort(field)}
      >
        <span className="flex items-center gap-1">
          {children}
          {sortField === field && <SortIcon className="h-3 w-3" />}
        </span>
      </TableHead>
    )
  }

  const stageColors: Record<string, string> = {
    INTAKE: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    PROCESSING: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    TESTING: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    FINISHED: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    SELLING: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    COMMENCED: 'bg-primary/10 text-primary border-primary/20',
  }

  return (
    <div className="card-modern overflow-hidden">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Per-Batch Breakdown
          <Badge variant="outline" className="text-xs ml-1">{batches.length}</Badge>
        </h3>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead field="batchId">Batch ID</SortableHead>
              <SortableHead field="status">Status</SortableHead>
              <SortableHead field="lifecycleStage">Stage</SortableHead>
              <SortableHead field="inputWeight" className="text-right">Input (g)</SortableHead>
              <SortableHead field="outputWeight" className="text-right">Output (g)</SortableHead>
              <SortableHead field="yieldPct" className="text-right">Yield %</SortableHead>
              <SortableHead field="wastePct" className="text-right">Waste %</SortableHead>
              <SortableHead field="totalFees" className="text-right">Fees</SortableHead>
              <SortableHead field="commencedAt">Commenced</SortableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((b) => (
              <TableRow key={b.batchId}>
                <TableCell className="text-xs font-mono">{b.batchId.slice(0, 12)}...</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('text-xs',
                    b.status === 'COMPLETED' && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                    b.status === 'IN_PROGRESS' && 'bg-blue-500/10 text-blue-500 border-blue-500/20',
                    b.status === 'CANCELLED' && 'bg-red-500/10 text-red-500 border-red-500/20',
                  )}>
                    {b.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('text-xs', stageColors[b.lifecycleStage] ?? '')}>
                    {b.lifecycleStage}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-right">{formatWeight(b.materialIn.totalWeight)}</TableCell>
                <TableCell className="text-xs text-right">{formatWeight(b.materialOut.totalWeight)}</TableCell>
                <TableCell className={cn('text-xs text-right',
                  b.yieldPct >= 70 ? 'text-emerald-500' :
                  b.yieldPct >= 50 ? 'text-yellow-500' :
                  b.yieldPct > 0 ? 'text-red-500' : '',
                )}>
                  {b.yieldPct > 0 ? formatPct(b.yieldPct) : '--'}
                </TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">
                  {b.wastePct > 0 ? formatPct(b.wastePct) : '--'}
                </TableCell>
                <TableCell className="text-xs text-right font-medium">
                  {b.totalFees > 0 ? formatCurrency(b.totalFees) : '--'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {b.commencedAt
                    ? new Date(b.commencedAt).toLocaleDateString()
                    : '--'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface TollingReconciliationTabProps {
  facilityId: string
}

export function TollingReconciliationTab({ facilityId }: TollingReconciliationTabProps) {
  const [selectedAgreementId, setSelectedAgreementId] = useState<string>('')

  // Fetch agreements for the selector
  const { data: rawAgreements, isLoading: agreementsLoading } = trpc.tolling.listAgreements.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 60_000 },
  )
  const agreements = rawAgreements as unknown as AgreementItem[] | undefined

  // Fetch reconciliation statement when an agreement is selected
  const { data: rawStatement, isLoading: statementLoading } = trpc.tolling.reconcileStatement.useQuery(
    { facilityId, agreementId: selectedAgreementId },
    { enabled: !!facilityId && !!selectedAgreementId, staleTime: 30_000 },
  )
  const statement = rawStatement as unknown as ReconciliationStatement | undefined

  // CSV export query (disabled by default, fetched on demand)
  const csvQuery = trpc.tolling.exportReconciliationCSV.useQuery(
    { facilityId, agreementId: selectedAgreementId },
    { enabled: false },
  )

  const handleExportCSV = async () => {
    const result = await csvQuery.refetch()
    if (result.data) {
      const { csv, filename } = result.data as { csv: string; filename: string }
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)
    }
  }

  // Loading: agreements
  if (agreementsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card-modern p-4 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Empty: no agreements
  if (!agreements || agreements.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileSpreadsheet className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">No tolling agreements found</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Create a tolling agreement in the Agreements tab to generate a reconciliation statement.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Agreement Selector + Export */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Agreement:</label>
          <select
            className="p-2 rounded-md border border-border bg-background text-sm min-w-[280px]"
            value={selectedAgreementId}
            onChange={(e) => setSelectedAgreementId(e.target.value)}
          >
            <option value="">Select an agreement...</option>
            {agreements.map((a) => (
              <option key={a.id} value={a.id}>
                {a.partnerName} -- {a.agreementType} ({a.status})
              </option>
            ))}
          </select>
        </div>
        {selectedAgreementId && statement && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={csvQuery.isFetching}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            {csvQuery.isFetching ? 'Exporting...' : 'Export CSV'}
          </Button>
        )}
      </div>

      {/* No selection prompt */}
      {!selectedAgreementId && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ArrowDownUp className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">Select an agreement above to view its reconciliation statement.</p>
        </div>
      )}

      {/* Loading: statement */}
      {selectedAgreementId && statementLoading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card-modern p-4 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {/* Statement content */}
      {selectedAgreementId && statement && !statementLoading && (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Total Batches"
              value={statement.summary.totalBatches}
              icon={Package}
              color="text-blue-500"
            />
            <KpiCard
              label="Completed"
              value={statement.summary.completedBatches}
              icon={TrendingUp}
              color="text-emerald-500"
            />
            <KpiCard
              label="Overall Yield"
              value={statement.overallYieldPct > 0 ? `${statement.overallYieldPct}%` : '--'}
              icon={TrendingUp}
              color={
                statement.overallYieldPct >= 70 ? 'text-emerald-500' :
                statement.overallYieldPct >= 50 ? 'text-yellow-500' :
                'text-red-500'
              }
            />
            <KpiCard
              label="Total Fees"
              value={statement.totalFees > 0 ? formatCurrency(statement.totalFees) : '$0'}
              icon={DollarSign}
              color="text-foreground"
            />
          </div>

          {/* Agreement header */}
          <div className="card-modern p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium">{statement.partnerName}</span>
              {statement.partnerLicense && (
                <span className="text-xs text-muted-foreground">License: {statement.partnerLicense}</span>
              )}
              <Badge variant="outline" className="text-xs">{statement.agreementType}</Badge>
              <Badge variant="outline" className="text-xs">{statement.billingMode.replace(/_/g, ' ')}</Badge>
              <Badge
                variant="outline"
                className={cn('text-xs',
                  statement.status === 'ACTIVE' && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                  statement.status === 'COMPLETED' && 'bg-blue-500/10 text-blue-500 border-blue-500/20',
                  statement.status === 'CANCELLED' && 'bg-red-500/10 text-red-500 border-red-500/20',
                  statement.status === 'DRAFT' && 'bg-gray-500/10 text-gray-500 border-gray-500/20',
                )}
              >
                {statement.status}
              </Badge>
              <span className="text-xs text-muted-foreground ml-auto">
                {new Date(statement.startDate).toLocaleDateString()}
                {statement.endDate && ` - ${new Date(statement.endDate).toLocaleDateString()}`}
              </span>
            </div>
          </div>

          {/* Material Flow + Fees Summary side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MaterialFlowCard statement={statement} />
            <FeesSummaryCard statement={statement} />
          </div>

          {/* Yield Guarantee + Revenue (conditional) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <YieldGuaranteeCard statement={statement} />
            <RevenueCard statement={statement} />
          </div>

          {/* Per-Batch Table */}
          {statement.batches.length > 0 ? (
            <BatchTable batches={statement.batches} />
          ) : (
            <div className="card-modern p-8 text-center">
              <p className="text-sm text-muted-foreground">No batches linked to this agreement yet.</p>
            </div>
          )}

          {/* Generated timestamp */}
          <p className="text-xs text-muted-foreground text-right">
            Statement generated: {new Date(statement.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  )
}
