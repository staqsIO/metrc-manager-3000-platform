'use client'

import { useState } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { trpc } from '@/lib/trpc-client'
import { ShieldAlert, Check, X, Tag, FlaskConical, Combine } from 'lucide-react'
import { Pagination } from '@/shared/components/Pagination'
import Link from 'next/link'
import PackageLabelLink from '@/features/inventory/components/PackageLabelLink'

interface ComplianceAlertItem {
  id: string
  facilityId: string
  category: string
  severity: string
  title: string
  description: string | null
  packageLabel: string | null
  plantLabel: string | null
  transferId: string | null
  employeeId: string | null
  status: string
  resolvedAt: string | null
  resolvedBy: string | null
  resolutionNote: string | null
  ruleId: string | null
  actionType: string | null
  actionParams: unknown
  metadata: unknown
  createdAt: string
  updatedAt: string
}

const ACTION_TYPE_CTAS: Record<string, { label: string; path: string; icon: typeof Tag }> = {
  DISCOUNT_RECOMMEND: { label: 'Apply Discount', path: '/inventory/discounts', icon: Tag },
  SAMPLE_OUT: { label: 'Log Disposition', path: '/dispositions', icon: FlaskConical },
  CONSOLIDATE: { label: 'View Candidates', path: '/inventory', icon: Combine },
}

interface AlertsTableProps {
  facilityId: string
}

type StatusFilter = 'ALL' | 'OPEN' | 'RESOLVED' | 'DISMISSED'
type SeverityFilter = 'ALL' | 'INFO' | 'WARNING' | 'CRITICAL'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'DISMISSED', label: 'Dismissed' },
]

const SEVERITY_FILTERS: { value: SeverityFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'INFO', label: 'Info' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'CRITICAL', label: 'Critical' },
]

const SEVERITY_BADGE_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-500/10 text-red-500 border-red-500/20',
  WARNING: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  INFO: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  OPEN: 'border-red-500/40 text-red-500',
  RESOLVED: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  DISMISSED: 'bg-muted text-muted-foreground border-border',
}

function formatRelativeTime(date: string | Date): string {
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 30) return `${diffDay}d ago`
  return then.toLocaleDateString()
}

export function AlertsTable({ facilityId }: AlertsTableProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const utils = trpc.useUtils()

  const { data, isLoading, isFetching } = trpc.compliance.getAlerts.useQuery({
    facilityId,
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    severity: severityFilter === 'ALL' ? undefined : severityFilter,
    category: categoryFilter === 'ALL' ? undefined : categoryFilter,
    page,
    pageSize,
  }, { staleTime: 300_000,
    placeholderData: keepPreviousData,
  })

  const resolveMutation = trpc.compliance.resolveAlert.useMutation({
    onSuccess: () => {
      utils.compliance.getAlerts.invalidate()
      utils.compliance.getSummary.invalidate()
    },
  })

  const dismissMutation = trpc.compliance.dismissAlert.useMutation({
    onSuccess: () => {
      utils.compliance.getAlerts.invalidate()
      utils.compliance.getSummary.invalidate()
    },
  })

  const items = (data?.items ?? []) as unknown as ComplianceAlertItem[]
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  // Categories from server (all for this facility, independent of filters)
  const categories = (data?.categories ?? []) as string[]

  // Reset page when filters change
  const handleStatusFilter = (value: StatusFilter) => {
    setStatusFilter(value)
    setPage(1)
  }

  const handleSeverityFilter = (value: SeverityFilter) => {
    setSeverityFilter(value)
    setPage(1)
  }

  const handleCategoryFilter = (value: string) => {
    setCategoryFilter(value)
    setPage(1)
  }

  return (
    <div className="space-y-4">
      {/* Filter Pills */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
        {/* Status filters */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground mr-1">Status:</span>
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => handleStatusFilter(f.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                statusFilter === f.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:bg-accent'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Severity filters */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground mr-1">Severity:</span>
          {SEVERITY_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => handleSeverityFilter(f.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                severityFilter === f.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:bg-accent'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Category filter */}
        {categories.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground mr-1">Category:</span>
            <button
              onClick={() => handleCategoryFilter('ALL')}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                categoryFilter === 'ALL'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:bg-accent'
              )}
            >
              All
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => handleCategoryFilter(cat)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                  categoryFilter === cat
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:bg-accent'
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      {isLoading || isFetching ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="compact-hide">Category</TableHead>
                <TableHead>Package Label</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell className="compact-hide"><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-32" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border py-16 text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No alerts found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {statusFilter !== 'ALL' || severityFilter !== 'ALL' || categoryFilter !== 'ALL'
              ? 'Try adjusting your filters.'
              : 'No compliance alerts for this facility. Run an evaluation to check for violations.'}
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="compact-hide">Category</TableHead>
                  <TableHead>Package Label</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(alert => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(SEVERITY_BADGE_STYLES[alert.severity])}
                      >
                        {alert.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium max-w-[400px]">
                      <div title={alert.title}>
                        {alert.title}
                      </div>
                      {alert.description && (
                        <div className="text-xs text-muted-foreground mt-0.5" title={alert.description}>
                          {alert.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="compact-hide text-sm">{alert.category}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {alert.packageLabel ? <PackageLabelLink label={alert.packageLabel} /> : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(STATUS_BADGE_STYLES[alert.status])}
                      >
                        {alert.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatRelativeTime(alert.createdAt)}
                    </TableCell>
                    <TableCell>
                      {alert.status === 'OPEN' && (
                        <div className="flex items-center gap-1">
                          {alert.actionType && ACTION_TYPE_CTAS[alert.actionType] && (() => {
                            const cta = ACTION_TYPE_CTAS[alert.actionType!]!;
                            const CtaIcon = cta.icon;
                            return (
                              <Link
                                href={`/facilities/${facilityId}${cta.path}`}
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                                  'border border-amber-500/30 text-amber-600 hover:bg-amber-500/10',
                                )}
                              >
                                <CtaIcon className="h-3 w-3" />
                                {cta.label}
                              </Link>
                            );
                          })()}
                          <button
                            onClick={() => resolveMutation.mutate({ facilityId, alertId: alert.id })}
                            disabled={resolveMutation.isPending}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                              'border border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10',
                              'disabled:opacity-50 disabled:pointer-events-none'
                            )}
                          >
                            <Check className="h-3 w-3" />
                            Resolve
                          </button>
                          <button
                            onClick={() => dismissMutation.mutate({ facilityId, alertId: alert.id })}
                            disabled={dismissMutation.isPending}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                              'border border-border text-muted-foreground hover:bg-accent',
                              'disabled:opacity-50 disabled:pointer-events-none'
                            )}
                          >
                            <X className="h-3 w-3" />
                            Dismiss
                          </button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
            <Pagination
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
            />
            <div className="flex items-center gap-1.5">
              <span className="text-xs">Rows:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-accent cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
