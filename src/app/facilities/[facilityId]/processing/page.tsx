'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Cog, Package, Search,
  FlaskConical, AlertCircle, CheckCircle2, Wheat,
} from 'lucide-react'
import { Pagination } from '@/shared/components/Pagination'
import { CreateProcessingDialog } from '@/features/processing/components/CreateProcessingDialog'
import { TableSkeletonRows } from '@/shared/components/ui/table-skeleton'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { PageHeader } from '@/shared/components/PageHeader'
import { KpiCard } from '@/shared/components/KpiCard'

export default function ProcessingPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [page, setPage] = useState(1)

  const { data, isLoading, error } = trpc.processing.getSourcePackages.useQuery(
    { facilityId, search: search || undefined, category: selectedCategory || undefined, page, pageSize: 25 },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  return (
    <div className="p-8">
      <PageHeader
        title="Processing"
        description="Create new packages from source materials — extraction, infusion, repackaging"
        actions={
          <div className="flex items-center gap-2">
            <CreateProcessingDialog facilityId={facilityId} />
            <Link
              href={`/facilities/${facilityId}/harvests`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <Wheat className="h-4 w-4" />
              Harvests
            </Link>
            <Link
              href={`/facilities/${facilityId}/lab-tests`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <FlaskConical className="h-4 w-4" />
              Lab Tests
            </Link>
          </div>
        }
      />

      {error && (
        <div className="card-modern p-4 mb-6 border-red-500/30">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <p className="text-sm text-red-500">Failed to load source packages: {error.message}</p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Available Sources" value={data?.total ?? 0} icon={Package} color="text-blue-500" />
        <KpiCard label="Categories" value={data?.categories?.length ?? 0} icon={Cog} color="text-emerald-500" />
        <KpiCard label="Lab Tested" value={data?.items?.filter(i => i.labTestingState === 'TestPassed').length ?? 0} icon={FlaskConical} color="text-purple-500" />
        <KpiCard label="Page" value={data ? `${data.page}/${data.totalPages || 1}` : '--'} icon={CheckCircle2} color="text-foreground" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search packages by name, label, or strain..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        {data?.categories && data.categories.length > 0 && (
          <select
            value={selectedCategory}
            onChange={(e) => { setSelectedCategory(e.target.value); setPage(1); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">All Categories</option>
            {data.categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}
      </div>

      {/* Source Packages Table */}
      <div className="card-modern overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Label</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Item</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Category</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Strain</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground">Quantity</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Unit</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Lab Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeletonRows columns={8} />
              ) : !data?.items?.length ? (
                <EmptyState
                  icon={Cog}
                  title="No source packages available"
                  description="Source packages for processing will appear here once available in Metrc."
                  colSpan={8}
                />
              ) : (
                data.items.map((pkg) => (
                  <tr key={pkg.label} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-4 font-mono text-xs">{pkg.label}</td>
                    <td className="py-2.5 px-4">{pkg.itemName}</td>
                    <td className="py-2.5 px-4">
                      <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs">
                        {pkg.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground">{pkg.strain || '\u2014'}</td>
                    <td className="py-2.5 px-4 text-right font-medium">
                      {pkg.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground">{pkg.unit}</td>
                    <td className="py-2.5 px-4 text-muted-foreground">{pkg.location || '\u2014'}</td>
                    <td className="py-2.5 px-4">
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        pkg.labTestingState === 'TestPassed' ? 'bg-emerald-500/10 text-emerald-500' :
                        pkg.labTestingState === 'TestFailed' ? 'bg-red-500/10 text-red-500' :
                        'bg-muted text-muted-foreground'
                      )}>
                        {pkg.labTestingState || 'None'}
                      </span>
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
