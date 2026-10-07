'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  FlaskConical, CheckCircle2, XCircle, Clock,
  Search, Package,
} from 'lucide-react'
import { CopyButton } from '@/shared/components/ui/copy-button'
import { KpiCard } from '@/shared/components/KpiCard'
import { Pagination } from '@/shared/components/Pagination'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { RecordResultsButton } from '@/features/lab-tests/components/RecordResultsButton'
import { COAUploadButton } from '@/features/lab-tests/components/COAUploadButton'
import { TableSkeletonRows } from '@/shared/components/ui/table-skeleton'
import { PageHeader } from '@/shared/components/PageHeader'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type RouterOutputs = inferRouterOutputs<AppRouter>
type LabTestItem = RouterOutputs['labTests']['getResults']['items'][number]

export default function LabTestsPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(1)

  const { data: summary } = trpc.labTests.getSummary.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const { data, isLoading } = trpc.labTests.getResults.useQuery(
    { facilityId, search: search || undefined, status: statusFilter || undefined, page, pageSize: 25 },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const summaryCards = [
    { label: 'Total Tests', value: summary?.totalCount ?? 0, icon: FlaskConical, color: 'text-foreground' },
    { label: 'Passed', value: summary?.passedCount ?? 0, icon: CheckCircle2, color: 'text-emerald-500' },
    { label: 'Failed', value: summary?.failedCount ?? 0, icon: XCircle, color: 'text-red-500' },
    { label: 'Pending', value: summary?.pendingCount ?? 0, icon: Clock, color: 'text-yellow-500' },
  ]

  const passRate = summary && summary.totalCount > 0
    ? ((summary.passedCount / summary.totalCount) * 100).toFixed(1)
    : null

  const statusTabs = [
    { label: 'All', value: '' },
    { label: 'Passed', value: 'TestPassed' },
    { label: 'Failed', value: 'TestFailed' },
    { label: 'Pending', value: 'NotSubmitted' },
  ]

  return (
    <div className="p-8">
      <PageHeader
        title="Lab Tests"
        description="Track lab testing status and results across packages"
        actions={
          <div className="flex items-center gap-2">
            <COAUploadButton facilityId={facilityId} />
            <RecordResultsButton facilityId={facilityId} />
            <Link
              href={`/facilities/${facilityId}/inventory`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <Package className="h-4 w-4" />
              Inventory
            </Link>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {summaryCards.map((card) => (
          <KpiCard key={card.label} {...card} />
        ))}
      </div>

      {/* Pass Rate Card */}
      {passRate !== null && (
        <div className="card-modern p-4 mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Overall Pass Rate</h3>
          <div className="flex items-center gap-4">
            <p className={cn(
              'text-3xl font-bold',
              Number(passRate) >= 90 ? 'text-emerald-500' :
              Number(passRate) >= 70 ? 'text-yellow-500' : 'text-red-500'
            )}>
              {passRate}%
            </p>
            <div className="flex-1 h-3 rounded-full bg-muted/30 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  Number(passRate) >= 90 ? 'bg-emerald-500/60' :
                  Number(passRate) >= 70 ? 'bg-yellow-500/60' : 'bg-red-500/60'
                )}
                style={{ width: `${passRate}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Status Tabs + Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/30">
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setStatusFilter(tab.value); setPage(1); }}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                statusFilter === tab.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by package label or item..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Results Table */}
      <div className="card-modern overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Metrc ID</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Package</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Item</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Category</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Strain</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeletonRows columns={7} />
              ) : !data?.items?.length ? (
                <EmptyState
                  icon={FlaskConical}
                  title={`No lab test results found${statusFilter ? ` with status "${statusFilter}"` : ''}`}
                  description={search ? `No results matching "${search}"` : undefined}
                  variant="filtered"
                  colSpan={7}
                />
              ) : (
                data.items.map((pkg: LabTestItem) => (
                  <tr key={pkg.label} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-4">
                      <CopyButton value={String(pkg.id)} label="Metrc ID" compact />
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs">{pkg.label}</td>
                    <td className="py-2.5 px-4 font-medium">{pkg.item}</td>
                    <td className="py-2.5 px-4 text-muted-foreground">{pkg.itemCategory}</td>
                    <td className="py-2.5 px-4">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                        pkg.labTestingState === 'TestPassed' ? 'bg-emerald-500/10 text-emerald-500' :
                        pkg.labTestingState === 'TestFailed' ? 'bg-red-500/10 text-red-500' :
                        pkg.labTestingState === 'SubmittedForTesting' ? 'bg-blue-500/10 text-blue-500' :
                        'bg-muted text-muted-foreground'
                      )}>
                        {pkg.labTestingState === 'TestPassed' && <CheckCircle2 className="h-3 w-3" />}
                        {pkg.labTestingState === 'TestFailed' && <XCircle className="h-3 w-3" />}
                        {pkg.labTestingState === 'NotSubmitted' && <Clock className="h-3 w-3" />}
                        {pkg.labTestingState || 'None'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground">{pkg.strainName || '\u2014'}</td>
                    <td className="py-2.5 px-4 text-right">
                      {pkg.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      <span className="text-muted-foreground ml-1">{pkg.unitOfMeasure}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  )
}
