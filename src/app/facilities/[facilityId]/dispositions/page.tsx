'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { useFacilityId } from '@/shared/hooks/useFacilityId'
import { cn } from '@/lib/utils'
import {
  ClipboardList, Gift, Users, Megaphone, AlertTriangle, Trash2,
  Settings2, Undo2, Hash, DollarSign, Activity, ShieldCheck,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { KpiCard } from '@/shared/components/KpiCard'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { PageHeader } from '@/shared/components/PageHeader'
import { TableSkeletonRows } from '@/shared/components/ui/table-skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/shared/components/ui/dialog'
import type { DispositionCategory, BudgetStatus } from '@/services/engines/disposition-engine'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type RouterOutputs = inferRouterOutputs<AppRouter>
type DispositionRecord = RouterOutputs['disposition']['list']['records'][number]

const CATEGORY_CONFIG: Record<DispositionCategory, { label: string; icon: typeof Gift; color: string }> = {
  sample: { label: 'Sample', icon: Gift, color: 'text-blue-500' },
  vendor_day: { label: 'Vendor Day', icon: Users, color: 'text-purple-500' },
  promo: { label: 'Promo', icon: Megaphone, color: 'text-emerald-500' },
  damage: { label: 'Damage', icon: AlertTriangle, color: 'text-amber-500' },
  waste: { label: 'Waste', icon: Trash2, color: 'text-red-500' },
}

function BudgetBar({ fraction, status }: { fraction: number | null; status: string }) {
  if (fraction === null) return <span className="text-xs text-muted-foreground">No limit</span>
  const pct = Math.min(fraction * 100, 100)
  const barColor = status === 'exceeded' ? 'bg-red-500' : status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('text-xs font-medium tabular-nums', status === 'exceeded' ? 'text-red-500' : status === 'warning' ? 'text-amber-500' : 'text-muted-foreground')}>
        {Math.round(pct)}%
      </span>
    </div>
  )
}

export default function DispositionsPage() {
  const facilityId = useFacilityId() ?? ''

  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview')
  const [categoryFilter, setCategoryFilter] = useState<DispositionCategory | ''>('')
  const [showSettings, setShowSettings] = useState(false)
  const [reverseTarget, setReverseTarget] = useState<DispositionRecord | null>(null)
  const [reverseReason, setReverseReason] = useState('')
  const pageSize = 25
  const [cursors, setCursors] = useState<string[]>([])
  const currentCursor = cursors.length > 0 ? cursors[cursors.length - 1] : undefined

  const { data: summary, isLoading: summaryLoading } = trpc.disposition.summary.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )

  const { data: policy } = trpc.disposition.getPolicy.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )

  const { data: records, isLoading: recordsLoading } = trpc.disposition.list.useQuery(
    {
      facilityId,
      limit: pageSize,
      cursor: currentCursor,
      ...(categoryFilter ? { category: categoryFilter as DispositionCategory } : {}),
    },
    { enabled: !!facilityId && activeTab === 'history', staleTime: 300_000 },
  )

  const utils = trpc.useUtils()
  const reverseMutation = trpc.disposition.reverse.useMutation({
    onSuccess: () => {
      setReverseTarget(null)
      setReverseReason('')
      utils.disposition.list.invalidate({ facilityId })
      utils.disposition.summary.invalidate({ facilityId })
    },
  })

  const handleNextPage = () => {
    if (records?.nextCursor) {
      setCursors(prev => [...prev, records.nextCursor!])
    }
  }

  const handlePrevPage = () => {
    setCursors(prev => prev.slice(0, -1))
  }

  const handleCategoryFilterChange = (value: string) => {
    setCategoryFilter(value as DispositionCategory | '')
    setCursors([])
  }

  const tabs = [
    { key: 'overview' as const, label: 'Budget Overview' },
    { key: 'history' as const, label: 'History' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispositions"
        description="Track non-sale inventory movements: samples, vendor days, promos, damage, and waste"
        icon={ClipboardList}
      />

      {/* KPI Row */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="card-modern p-4 animate-pulse">
              <div className="h-4 bg-muted rounded w-20 mb-2" />
              <div className="h-6 bg-muted rounded w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="This Month"
            value={summary ? `${summary.totalCount} records` : '-'}
            icon={Hash}
          />
          <KpiCard
            label="Units Out"
            value={summary ? summary.totalUnits.toFixed(1) : '-'}
            icon={Activity}
          />
          <KpiCard
            label="Total Value"
            value={summary ? `$${summary.totalValue.toFixed(2)}` : '-'}
            icon={DollarSign}
          />
          <KpiCard
            label="Policy"
            value={policy?.isEnabled ? 'Active' : 'Disabled'}
            icon={ShieldCheck}
            isText
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
            )}
          >
            {tab.label}
          </button>
        ))}
        <button
          onClick={() => setShowSettings(s => !s)}
          className="ml-auto p-2 text-muted-foreground hover:text-foreground transition-colors"
          title="Policy Settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>

      {/* Settings Panel (collapsible) */}
      {showSettings && policy && (
        <div className="card-modern p-4 space-y-3">
          <h3 className="text-sm font-semibold">Policy Settings</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Status</span>
              <p className="font-medium">{policy.isEnabled ? 'Enabled' : 'Disabled'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Require Note</span>
              <p className="font-medium">{policy.requireNote ? 'Yes' : 'No'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Budget Override</span>
              <p className="font-medium">{policy.allowBudgetOverride ? 'Allowed' : 'Blocked'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Alert Threshold</span>
              <p className="font-medium">{Math.round(policy.alertThreshold * 100)}%</p>
            </div>
          </div>
          {Object.keys(policy.categoryLimits).length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Category Limits</span>
              <div className="mt-1 grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                {(Object.entries(policy.categoryLimits) as [string, { units: number | null; value: number | null }][]).map(([cat, limit]) => (
                  <div key={cat} className="p-2 rounded-md bg-muted/50">
                    <span className="text-muted-foreground">{CATEGORY_CONFIG[cat as DispositionCategory]?.label ?? cat}</span>
                    <p className="font-mono text-xs">
                      {limit?.units != null ? `${limit.units} units` : 'Unlimited'}
                      {' / '}
                      {limit?.value != null ? `$${limit.value}` : 'Unlimited'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {summaryLoading ? (
            <div className="card-modern p-6">
              <TableSkeletonRows columns={7} rows={5} />
            </div>
          ) : !summary ? (
            <EmptyState title="No data" description="No disposition data available for this month." />
          ) : (
            <div className="card-modern overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium">Category</th>
                    <th className="text-right px-4 py-3 font-medium">Records</th>
                    <th className="text-right px-4 py-3 font-medium">Units</th>
                    <th className="text-right px-4 py-3 font-medium">Value</th>
                    <th className="px-4 py-3 font-medium text-left">Unit Budget</th>
                    <th className="px-4 py-3 font-medium text-left">Value Budget</th>
                    <th className="text-center px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.budgets.map((budget: BudgetStatus) => {
                    const config = CATEGORY_CONFIG[budget.category]
                    const Icon = config.icon
                    return (
                      <tr key={budget.category} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Icon className={cn('h-4 w-4', config.color)} />
                            <span className="font-medium">{budget.label}</span>
                          </div>
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums">{budget.monthlyUsage.count}</td>
                        <td className="text-right px-4 py-3 tabular-nums">{budget.monthlyUsage.units.toFixed(1)}</td>
                        <td className="text-right px-4 py-3 tabular-nums">${budget.monthlyUsage.value.toFixed(2)}</td>
                        <td className="px-4 py-3 min-w-[140px]">
                          <BudgetBar fraction={budget.unitsFraction} status={budget.status} />
                        </td>
                        <td className="px-4 py-3 min-w-[140px]">
                          <BudgetBar fraction={budget.valueFraction} status={budget.status} />
                        </td>
                        <td className="text-center px-4 py-3">
                          <span className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                            budget.status === 'exceeded' ? 'bg-red-500/10 text-red-500' :
                            budget.status === 'warning' ? 'bg-amber-500/10 text-amber-500' :
                            'bg-emerald-500/10 text-emerald-500',
                          )}>
                            {budget.status === 'exceeded' ? 'Exceeded' : budget.status === 'warning' ? 'Warning' : 'OK'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-medium">
                    <td className="px-4 py-3">Total</td>
                    <td className="text-right px-4 py-3 tabular-nums">{summary.totalCount}</td>
                    <td className="text-right px-4 py-3 tabular-nums">{summary.totalUnits.toFixed(1)}</td>
                    <td className="text-right px-4 py-3 tabular-nums">${summary.totalValue.toFixed(2)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {/* Category filter */}
          <div className="flex items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => handleCategoryFilterChange(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
            >
              <option value="">All Categories</option>
              {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
          </div>

          {recordsLoading ? (
            <div className="card-modern p-6">
              <TableSkeletonRows columns={9} rows={10} />
            </div>
          ) : !records?.records.length ? (
            <EmptyState
              title="No dispositions"
              description={categoryFilter ? `No ${CATEGORY_CONFIG[categoryFilter as DispositionCategory]?.label} dispositions recorded.` : 'No dispositions recorded for this facility.'}
            />
          ) : (
            <>
              <div className="card-modern overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium">Date</th>
                      <th className="text-left px-4 py-3 font-medium">Package</th>
                      <th className="text-left px-4 py-3 font-medium">Category</th>
                      <th className="text-right px-4 py-3 font-medium">Qty</th>
                      <th className="text-right px-4 py-3 font-medium">Value</th>
                      <th className="text-left px-4 py-3 font-medium">Recipient</th>
                      <th className="text-left px-4 py-3 font-medium">Note</th>
                      <th className="text-center px-4 py-3 font-medium">Status</th>
                      <th className="text-center px-4 py-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {records.records.map((record: DispositionRecord) => {
                      const cfg = CATEGORY_CONFIG[record.category as DispositionCategory]
                      const CatIcon = cfg?.icon ?? ClipboardList
                      return (
                        <tr key={record.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                            {new Date(record.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {record.packageLabel.length > 20
                              ? `...${record.packageLabel.slice(-12)}`
                              : record.packageLabel}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <CatIcon className={cn('h-3.5 w-3.5', cfg?.color ?? 'text-muted-foreground')} />
                              <span>{cfg?.label ?? record.category}</span>
                            </div>
                          </td>
                          <td className="text-right px-4 py-3 tabular-nums">
                            {record.quantity.toFixed(1)} {record.unitOfMeasure}
                          </td>
                          <td className="text-right px-4 py-3 tabular-nums">
                            ${record.estimatedValue.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {record.recipientName || '-'}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                            {record.note || '-'}
                          </td>
                          <td className="text-center px-4 py-3">
                            <span className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                              record.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-500' :
                              record.status === 'REVERSED' ? 'bg-red-500/10 text-red-500' :
                              'bg-muted text-muted-foreground',
                            )}>
                              {record.status}
                            </span>
                          </td>
                          <td className="text-center px-4 py-3">
                            {record.status === 'COMPLETED' && (
                              <button
                                onClick={() => {
                                  setReverseTarget(record)
                                  setReverseReason('')
                                }}
                                className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                                title="Reverse disposition"
                              >
                                <Undo2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {cursors.length + 1}
                  {records.records.length === pageSize && records.nextCursor ? '+' : ''}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePrevPage}
                    disabled={cursors.length === 0}
                    className={cn(
                      'inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-border transition-colors',
                      cursors.length === 0
                        ? 'text-muted-foreground/50 cursor-not-allowed'
                        : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </button>
                  <button
                    onClick={handleNextPage}
                    disabled={!records.nextCursor}
                    className={cn(
                      'inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-border transition-colors',
                      !records.nextCursor
                        ? 'text-muted-foreground/50 cursor-not-allowed'
                        : 'text-foreground hover:bg-muted',
                    )}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Reverse Disposition Dialog */}
      <Dialog open={!!reverseTarget} onOpenChange={(open) => { if (!open) { setReverseTarget(null); setReverseReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse Disposition</DialogTitle>
            <DialogDescription>
              This will mark the disposition as reversed. Reversed records are excluded from budget calculations.
            </DialogDescription>
          </DialogHeader>
          {reverseTarget && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm p-3 rounded-md bg-muted/50">
                <div>
                  <span className="text-muted-foreground">Package</span>
                  <p className="font-mono text-xs mt-0.5">{reverseTarget.packageLabel}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Category</span>
                  <p className="mt-0.5">{CATEGORY_CONFIG[reverseTarget.category as DispositionCategory]?.label ?? reverseTarget.category}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Quantity</span>
                  <p className="mt-0.5 tabular-nums">{reverseTarget.quantity.toFixed(1)} {reverseTarget.unitOfMeasure}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Value</span>
                  <p className="mt-0.5 tabular-nums">${reverseTarget.estimatedValue.toFixed(2)}</p>
                </div>
              </div>
              <div>
                <label htmlFor="reverse-reason" className="text-sm font-medium">
                  Reason for reversal <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="reverse-reason"
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="Explain why this disposition is being reversed..."
                  className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <button
              onClick={() => { setReverseTarget(null); setReverseReason(''); }}
              className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (reverseTarget && reverseReason.trim()) {
                  reverseMutation.mutate({
                    facilityId,
                    recordId: reverseTarget.id,
                    reason: reverseReason.trim(),
                    confirmed: true,
                  })
                }
              }}
              disabled={!reverseReason.trim() || reverseMutation.isPending}
              className={cn(
                'px-4 py-2 text-sm rounded-md transition-colors',
                !reverseReason.trim() || reverseMutation.isPending
                  ? 'bg-red-500/50 text-red-200 cursor-not-allowed'
                  : 'bg-red-500 text-white hover:bg-red-600',
              )}
            >
              {reverseMutation.isPending ? 'Reversing...' : 'Confirm Reversal'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
