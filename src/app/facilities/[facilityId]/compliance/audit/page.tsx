'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  ClipboardCheck,
  Save,
  AlertTriangle,
  CheckCircle2,
  Info,
  ArrowRight,
  Loader2,
  Beaker,
  FlaskConical,
  Trash2,
  ExternalLink,
  Sparkles,
  ChevronDown,
  Printer,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Users,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCopilot } from '@/features/copilot/CopilotContext'
import EmployeeActivityTable from '@/features/compliance/components/EmployeeActivityTable'
import ActivityTimeline from '@/features/compliance/components/ActivityTimeline'
import { getBrand } from '@/lib/brand'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FindingActionType = 'expedite_testing' | 'remediate' | 'finish' | 'navigate_aging' | 'navigate_inventory'

interface AuditFindingItem {
  category: string
  severity: string
  title: string
  description: string
  recommendation: string
  affectedCount: number
  affectedPackageLabels?: string[]
  actionType?: FindingActionType
}

type TabId = 'findings' | 'employees' | 'activity'
type DialogStatus = 'idle' | 'previewing' | 'confirming' | 'executing' | 'completed' | 'error'

// ---------------------------------------------------------------------------
// Action config
// ---------------------------------------------------------------------------

const ACTION_CONFIG: Record<string, { label: string; icon: React.ElementType; destructive?: boolean; description: string }> = {
  expedite_testing: {
    label: 'Expedite Testing',
    icon: Beaker,
    description: 'Flag all affected packages with an "Expedite lab testing" note in Metrc.',
  },
  remediate: {
    label: 'Start Remediation',
    icon: FlaskConical,
    description: 'Flag all affected packages for remediation in Metrc. This records a remediation date.',
  },
  finish: {
    label: 'Finish Packages',
    icon: Trash2,
    destructive: true,
    description: 'Finish all affected zero-quantity packages, removing them from active inventory. This is irreversible.',
  },
  navigate_aging: {
    label: 'View Aging Analysis',
    icon: ArrowRight,
    description: '',
  },
  navigate_inventory: {
    label: 'View in Inventory',
    icon: ExternalLink,
    description: '',
  },
}

const READINESS_LEVEL_CONFIG = {
  ready: { label: 'Audit Ready', icon: ShieldCheck, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  at_risk: { label: 'At Risk', icon: ShieldAlert, color: 'text-yellow-500', bg: 'bg-yellow-500/10 border-yellow-500/20' },
  not_ready: { label: 'Not Ready', icon: ShieldX, color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/20' },
}

const TAB_CONFIG: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'findings', label: 'Findings', icon: ClipboardCheck },
  { id: 'employees', label: 'Employee Activity', icon: Users },
  { id: 'activity', label: 'Recent Activity', icon: Activity },
]

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AuditPage() {
  const params = useParams()
  const router = useRouter()
  const facilityId = params?.facilityId as string

  const { open: openCopilot } = useCopilot()

  const [activeTab, setActiveTab] = useState<TabId>('findings')

  // Fetch the full readiness report (heavy query — 6 parallel API calls)
  const { data: readiness, isLoading, error } = trpc.compliance.auditReadiness.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )

  const saveMutation = trpc.compliance.saveAuditSnapshot.useMutation()
  const utils = trpc.useUtils()

  const handleSave = async () => {
    await saveMutation.mutateAsync({ facilityId })
    void utils.compliance.listAuditSnapshots.invalidate()
  }

  const handlePrint = () => {
    window.print()
  }

  // Convenience aliases
  const packageAudit = readiness?.packageAudit
  const findings = packageAudit?.findings ?? []

  // ---- Expandable labels state ----
  const [expandedFindings, setExpandedFindings] = useState<Set<number>>(new Set())
  const toggleExpanded = useCallback((index: number) => {
    setExpandedFindings(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const getFlaggedCount = useCallback((finding: AuditFindingItem): number => {
    if (!packageAudit) return 0
    if (finding.actionType !== 'expedite_testing') return 0
    const flaggedFinding = packageAudit.findings.find(
      (f: AuditFindingItem) => f.title === 'Packages flagged for lab testing' && f.category === finding.category
    )
    return flaggedFinding?.affectedCount ?? 0
  }, [packageAudit])

  // ---- Action dialog state ----
  const [dialog, setDialog] = useState<{
    open: boolean
    actionType: 'expedite_testing' | 'remediate' | 'finish' | null
    labels: string[]
    findingTitle: string
    status: DialogStatus
    previewDescription: string | null
    error: string | null
  }>({ open: false, actionType: null, labels: [], findingTitle: '', status: 'idle', previewDescription: null, error: null })

  const resolveFinding = trpc.compliance.resolveAuditFinding.useMutation({
    onSuccess: (result) => {
      if (result.status === 'preview') {
        setDialog(prev => ({ ...prev, status: 'confirming', previewDescription: result.description }))
      } else {
        setDialog(prev => ({ ...prev, status: 'completed', error: null }))
        void utils.compliance.auditReadiness.invalidate()
      }
    },
    onError: (err) => {
      setDialog(prev => ({ ...prev, status: 'error', error: err.message }))
    },
  })

  const openActionDialog = useCallback((finding: AuditFindingItem) => {
    const actionType = finding.actionType as 'expedite_testing' | 'remediate' | 'finish'
    const labels = finding.affectedPackageLabels ?? []

    setDialog({
      open: true,
      actionType,
      labels,
      findingTitle: finding.title,
      status: 'previewing',
      previewDescription: null,
      error: null,
    })

    resolveFinding.mutate({
      facilityId,
      actionType,
      packageLabels: labels,
      confirmed: false,
    })
  }, [facilityId, resolveFinding])

  const handleConfirm = useCallback(() => {
    if (!dialog.actionType) return
    setDialog(prev => ({ ...prev, status: 'executing' }))
    resolveFinding.mutate({
      facilityId,
      actionType: dialog.actionType!,
      packageLabels: dialog.labels,
      confirmed: true,
    })
  }, [facilityId, dialog.actionType, dialog.labels, resolveFinding])

  useEffect(() => {
    if (dialog.status === 'completed') {
      const timer = setTimeout(() => setDialog(prev => ({ ...prev, open: false })), 3000)
      return () => clearTimeout(timer)
    }
  }, [dialog.status])

  const handleNavigate = useCallback((finding: AuditFindingItem) => {
    if (finding.actionType === 'navigate_aging') {
      router.push(`/facilities/${facilityId}/inventory/aging`)
    } else {
      router.push(`/facilities/${facilityId}/inventory`)
    }
  }, [facilityId, router])

  // ---- Helpers ----

  const scoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-500'
    if (score >= 70) return 'text-yellow-500'
    if (score >= 50) return 'text-orange-500'
    return 'text-red-500'
  }

  const scoreBg = (score: number) => {
    if (score >= 90) return 'bg-emerald-500'
    if (score >= 70) return 'bg-yellow-500'
    if (score >= 50) return 'bg-orange-500'
    return 'bg-red-500'
  }

  const severityIcon = (severity: string) => {
    if (severity === 'critical') return <AlertTriangle className="h-4 w-4 text-red-500" />
    if (severity === 'warning') return <AlertTriangle className="h-4 w-4 text-yellow-500" />
    return <Info className="h-4 w-4 text-blue-500" />
  }

  const severityBadge = (severity: string) => (
    <Badge
      variant="outline"
      className={cn(
        'text-xs',
        severity === 'critical' && 'bg-red-500/10 text-red-500 border-red-500/20',
        severity === 'warning' && 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
        severity === 'info' && 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      )}
    >
      {severity}
    </Badge>
  )

  const isMetrcAction = (actionType?: string) =>
    actionType === 'expedite_testing' || actionType === 'remediate' || actionType === 'finish'

  const isNavigateAction = (actionType?: string) =>
    actionType === 'navigate_aging' || actionType === 'navigate_inventory'

  // ---- Render ----

  return (
    <>
      {/* Print styles */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          nav, aside, header, [data-sidebar], [data-copilot-widget] { display: none !important; }
          body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .card-modern { border: 1px solid #e5e7eb !important; box-shadow: none !important; }
          .print-break-before { page-break-before: always; }
          .print-visible { display: block !important; }
        }
      `}</style>

      <div className="p-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between no-print">
          <div>
            <h1 className="text-2xl font-bold">Audit Readiness</h1>
            <p className="text-muted-foreground mt-1">Comprehensive pre-audit compliance snapshot</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handlePrint} variant="outline" className="gap-2">
              <Printer className="h-4 w-4" />
              Print Report
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending || isLoading} variant="outline" className="gap-2">
              <Save className="h-4 w-4" />
              {saveMutation.isPending ? 'Saving...' : 'Save Snapshot'}
            </Button>
          </div>
        </div>

        {/* Print-only header */}
        <div className="hidden print-visible mb-6">
          <h1 className="text-2xl font-bold">Audit Readiness Report</h1>
          <p className="text-muted-foreground mt-1">
            Generated {readiness ? new Date(readiness.generatedAt).toLocaleString() : ''}
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <div className="grid grid-cols-7 gap-4">
              {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          </div>
        ) : error ? (
          <div className="card-modern p-8 text-center">
            <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
            <p className="font-medium">Failed to load audit readiness</p>
            <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
          </div>
        ) : readiness ? (
          <>
            {/* ============================================================= */}
            {/* Overall Readiness Score                                        */}
            {/* ============================================================= */}
            <div className="card-modern p-6 mb-8">
              <div className="flex items-center justify-center gap-6">
                <div className={cn('text-6xl font-bold', scoreColor(readiness.overallReadiness))}>
                  {readiness.overallReadiness}
                </div>
                <div className="text-left">
                  <div className="text-lg font-semibold">Overall Readiness</div>
                  <div className="text-sm text-muted-foreground">
                    {readiness.packageAudit.packageCount} packages analyzed
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Generated {new Date(readiness.generatedAt).toLocaleString()}
                  </div>
                </div>
                {/* Readiness level badge */}
                {(() => {
                  const levelConfig = READINESS_LEVEL_CONFIG[readiness.readinessLevel as keyof typeof READINESS_LEVEL_CONFIG]
                  const LevelIcon = levelConfig.icon
                  return (
                    <div className={cn('flex items-center gap-2 rounded-lg border px-4 py-2', levelConfig.bg)}>
                      <LevelIcon className={cn('h-5 w-5', levelConfig.color)} />
                      <span className={cn('text-sm font-semibold', levelConfig.color)}>{levelConfig.label}</span>
                    </div>
                  )
                })()}
              </div>
              <div className="flex justify-center gap-4 mt-4">
                <div className="flex items-center gap-1">
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                  <span className="text-sm">{readiness.packageAudit.criticalCount} critical</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-2 w-2 rounded-full bg-yellow-500" />
                  <span className="text-sm">{readiness.packageAudit.warningCount} warnings</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-2 w-2 rounded-full bg-blue-500" />
                  <span className="text-sm">{readiness.packageAudit.infoCount} info</span>
                </div>
              </div>
            </div>

            {/* ============================================================= */}
            {/* Category Score Cards (5 existing + 2 new)                      */}
            {/* ============================================================= */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
              {readiness.packageAudit.categories.map((cat: { name: string; score: number; maxScore: number; findings: Array<{ severity: string; message: string; category: string }> }) => (
                <div key={cat.name} className="card-modern p-4">
                  <div className="text-xs text-muted-foreground mb-2">{cat.name}</div>
                  <div className={cn('text-2xl font-bold mb-2', scoreColor(cat.score))}>
                    {cat.score}
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full', scoreBg(cat.score))}
                      style={{ width: `${cat.score}%` }}
                    />
                  </div>
                  {cat.findings.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-2">
                      {cat.findings.length} finding(s)
                    </div>
                  )}
                </div>
              ))}

              {/* Employee Activity score card */}
              <div className="card-modern p-4">
                <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                  <Users className="h-3 w-3" /> Employee Activity
                </div>
                <div className={cn('text-2xl font-bold mb-2', scoreColor(readiness.employeeScore))}>
                  {readiness.employeeScore}
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', scoreBg(readiness.employeeScore))}
                    style={{ width: `${readiness.employeeScore}%` }}
                  />
                </div>
                {readiness.trainingNeeds.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-2">
                    {readiness.trainingNeeds.length} flag(s)
                  </div>
                )}
              </div>

              {/* Recent Activity score card */}
              <div className="card-modern p-4">
                <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                  <Activity className="h-3 w-3" /> Recent Activity
                </div>
                <div className={cn('text-2xl font-bold mb-2', scoreColor(readiness.activityScore))}>
                  {readiness.activityScore}
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', scoreBg(readiness.activityScore))}
                    style={{ width: `${readiness.activityScore}%` }}
                  />
                </div>
                {readiness.recentActions.failedCount > 0 && (
                  <div className="text-xs text-red-500 mt-2">
                    {readiness.recentActions.failedCount} failed
                  </div>
                )}
              </div>
            </div>

            {/* ============================================================= */}
            {/* Tabs                                                           */}
            {/* ============================================================= */}
            <div className="flex items-center gap-1 mb-6 border-b border-border no-print">
              {TAB_CONFIG.map(tab => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                      activeTab === tab.id
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                    {tab.id === 'findings' && readiness.packageAudit.totalFindings > 0 && (
                      <Badge variant="outline" className="text-[11px] ml-1">{readiness.packageAudit.totalFindings}</Badge>
                    )}
                    {tab.id === 'employees' && readiness.trainingNeeds.length > 0 && (
                      <Badge variant="outline" className="text-[11px] ml-1 bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                        {readiness.trainingNeeds.length}
                      </Badge>
                    )}
                    {tab.id === 'activity' && readiness.recentActions.failedCount > 0 && (
                      <Badge variant="outline" className="text-[11px] ml-1 bg-red-500/10 text-red-500 border-red-500/20">
                        {readiness.recentActions.failedCount}
                      </Badge>
                    )}
                  </button>
                )
              })}
            </div>

            {/* ============================================================= */}
            {/* Tab: Findings (existing)                                       */}
            {/* ============================================================= */}
            {activeTab === 'findings' && (
              <div>
                {findings.length > 0 ? (
                  <div>
                    <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <ClipboardCheck className="h-5 w-5" />
                      Findings ({readiness.packageAudit.totalFindings})
                    </h2>
                    <div className="space-y-3">
                      {findings.map((f: AuditFindingItem, i: number) => {
                        const config = f.actionType ? ACTION_CONFIG[f.actionType] : null
                        const hasLabels = (f.affectedPackageLabels?.length ?? 0) > 0

                        return (
                          <div
                            key={i}
                            className={cn(
                              'card-modern p-4 border-l-4',
                              f.severity === 'critical' && 'border-l-red-500',
                              f.severity === 'warning' && 'border-l-yellow-500',
                              f.severity === 'info' && 'border-l-blue-500',
                            )}
                          >
                            <div className="flex items-start gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  {severityIcon(f.severity)}
                                  {severityBadge(f.severity)}
                                  <span className="font-medium">{f.title}</span>
                                  <Badge variant="outline" className="text-xs ml-auto">{f.category}</Badge>
                                </div>
                                <p className="text-sm text-muted-foreground mb-2">{f.description}</p>
                                <div className="bg-muted/50 rounded p-2 text-sm">
                                  <span className="font-medium text-xs">Recommendation: </span>
                                  <span className="text-muted-foreground text-xs">{f.recommendation}</span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">{f.affectedCount} package(s) affected</p>

                                {hasLabels && (
                                  <div className="mt-2 no-print">
                                    <button
                                      onClick={() => toggleExpanded(i)}
                                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      <ChevronDown className={cn('h-3 w-3 transition-transform', expandedFindings.has(i) && 'rotate-180')} />
                                      {expandedFindings.has(i) ? 'Hide packages' : 'Show packages'}
                                    </button>
                                    {expandedFindings.has(i) && (
                                      <div className="mt-1.5 flex flex-wrap gap-1">
                                        {f.affectedPackageLabels!.slice(0, 5).map(label => (
                                          <span key={label} className="inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                                            {label}
                                          </span>
                                        ))}
                                        {f.affectedPackageLabels!.length > 5 && (
                                          <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                            and {f.affectedPackageLabels!.length - 5} more
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              {config && (
                                <div className="shrink-0 pt-1 flex flex-col items-end gap-1.5 no-print">
                                  {isMetrcAction(f.actionType) && hasLabels ? (
                                    <>
                                      <button
                                        onClick={() => openActionDialog(f)}
                                        className={cn(
                                          'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap',
                                          config.destructive
                                            ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                                            : 'bg-primary/10 text-primary hover:bg-primary/20'
                                        )}
                                      >
                                        <config.icon className="h-3.5 w-3.5" />
                                        {config.label}
                                      </button>
                                      {getFlaggedCount(f) > 0 && (
                                        <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                                          <CheckCircle2 className="h-3 w-3" />
                                          {getFlaggedCount(f)} already flagged
                                        </span>
                                      )}
                                    </>
                                  ) : isNavigateAction(f.actionType) ? (
                                    <button
                                      onClick={() => handleNavigate(f)}
                                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium bg-muted/80 text-foreground hover:bg-muted transition-colors whitespace-nowrap"
                                    >
                                      <config.icon className="h-3.5 w-3.5" />
                                      {config.label}
                                    </button>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="card-modern p-8 text-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                    <p className="font-medium">No findings</p>
                    <p className="text-sm text-muted-foreground">Your facility passed all audit checks.</p>
                  </div>
                )}
              </div>
            )}

            {/* ============================================================= */}
            {/* Tab: Employee Activity                                         */}
            {/* ============================================================= */}
            {activeTab === 'employees' && (
              <div className="print-break-before">
                <EmployeeActivityTable
                  patterns={readiness.employeePatterns}
                  trainingNeeds={readiness.trainingNeeds}
                />
              </div>
            )}

            {/* ============================================================= */}
            {/* Tab: Recent Activity                                           */}
            {/* ============================================================= */}
            {activeTab === 'activity' && (
              <div className="print-break-before">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="card-modern p-3">
                    <div className="text-xs text-muted-foreground">Total Actions</div>
                    <div className="text-xl font-bold">{readiness.recentActions.totalActions}</div>
                  </div>
                  <div className="card-modern p-3">
                    <div className="text-xs text-muted-foreground">Completed</div>
                    <div className="text-xl font-bold text-emerald-500">{readiness.recentActions.completedCount}</div>
                  </div>
                  <div className="card-modern p-3">
                    <div className="text-xs text-muted-foreground">Failed</div>
                    <div className={cn('text-xl font-bold', readiness.recentActions.failedCount > 0 ? 'text-red-500' : '')}>
                      {readiness.recentActions.failedCount}
                    </div>
                  </div>
                  <div className="card-modern p-3">
                    <div className="text-xs text-muted-foreground">Last Reconciliation</div>
                    <div className="text-sm font-medium">
                      {readiness.lastReconciliation?.date
                        ? new Date(readiness.lastReconciliation.date).toLocaleDateString()
                        : 'Never'}
                    </div>
                    {readiness.lastReconciliation?.matchRate != null && (
                      <div className="text-xs text-muted-foreground">{readiness.lastReconciliation.matchRate}% match</div>
                    )}
                  </div>
                </div>
                <ActivityTimeline actions={readiness.recentActions.actions} />
              </div>
            )}

            {/* Print-only footer */}
            <div className="hidden print-visible mt-12 pt-4 border-t border-border text-xs text-muted-foreground text-center">
              Generated by {getBrand().name} &mdash; {new Date().toLocaleDateString()}
            </div>
          </>
        ) : null}

        {/* ================================================================= */}
        {/* Bulk Action Confirmation Dialog                                    */}
        {/* ================================================================= */}
        <Dialog open={dialog.open} onOpenChange={(open) => setDialog(prev => ({ ...prev, open }))}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {dialog.actionType ? ACTION_CONFIG[dialog.actionType]?.label : 'Confirm Action'}
              </DialogTitle>
              <DialogDescription>
                {dialog.actionType ? ACTION_CONFIG[dialog.actionType]?.description : ''}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Finding</span>
                <span className="text-sm font-medium">{dialog.findingTitle}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Packages affected</span>
                <span className="text-sm font-semibold">{dialog.labels.length}</span>
              </div>
            </div>

            {dialog.previewDescription && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-0.5">What will happen</p>
                <p className="text-sm">{dialog.previewDescription}</p>
              </div>
            )}

            {dialog.actionType === 'finish' && dialog.status !== 'completed' && (
              <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Finishing packages is permanent and cannot be undone.</span>
              </div>
            )}

            {dialog.status === 'completed' && (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Action completed on {dialog.labels.length} package(s) — refresh audit to see updated scores.</span>
              </div>
            )}

            {dialog.error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {dialog.error}
              </div>
            )}

            {dialog.status !== 'completed' && (
              <button
                onClick={() => {
                  setDialog(prev => ({ ...prev, open: false }))
                  openCopilot(
                    `Should I ${dialog.actionType === 'finish' ? 'finish/destroy' : dialog.actionType === 'remediate' ? 'start remediation for' : 'expedite testing for'} ${dialog.labels.length} packages related to "${dialog.findingTitle}"? What are the implications?`
                  )
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <Sparkles className="h-3 w-3" />
                Ask Copilot if this is the right call
              </button>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <button
                onClick={() => setDialog(prev => ({ ...prev, open: false }))}
                disabled={dialog.status === 'executing'}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={dialog.status === 'executing' || dialog.status === 'completed' || dialog.status === 'previewing'}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                  dialog.actionType === 'finish'
                    ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                )}
              >
                {dialog.status === 'executing' && <Loader2 className="h-4 w-4 animate-spin" />}
                {dialog.status === 'executing'
                  ? 'Executing...'
                  : dialog.status === 'previewing'
                    ? 'Loading...'
                    : `Confirm (${dialog.labels.length} packages)`}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  )
}
