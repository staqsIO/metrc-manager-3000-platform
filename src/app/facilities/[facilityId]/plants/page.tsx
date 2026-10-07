'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Leaf, Sprout, Flower2, PauseCircle, Search,
} from 'lucide-react'
import { CopyButton } from '@/shared/components/ui/copy-button'
import { KpiCard } from '@/shared/components/KpiCard'
import { Pagination } from '@/shared/components/Pagination'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { BulkActionBar } from '@/shared/components/BulkActionBar'
import { ArrowUpDown } from 'lucide-react'
import { ChangePhaseDialog } from '@/features/plants/components/ChangePhaseDialog'
import { TableSkeletonRows } from '@/shared/components/ui/table-skeleton'
import { PageHeader } from '@/shared/components/PageHeader'
import { useTableSelection } from '@/shared/hooks/useTableSelection'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type RouterOutputs = inferRouterOutputs<AppRouter>
type PlantItem = RouterOutputs['plants']['getActive']['items'][number]

export default function PlantsPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const [search, setSearch] = useState('')
  const [phaseFilter, setPhaseFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const [showChangePhase, setShowChangePhase] = useState(false)

  const { data: summary } = trpc.plants.getSummary.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const { data, isLoading } = trpc.plants.getActive.useQuery(
    {
      facilityId,
      search: search || undefined,
      growthPhase: (phaseFilter || undefined) as 'Vegetative' | 'Flowering' | undefined,
      page,
      pageSize: 25,
    },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const pageItemKeys = (data?.items ?? []).map((p: PlantItem) => p.id)
  const selection = useTableSelection<number>({ pageItemKeys })

  const summaryCards = [
    { label: 'Total Plants', value: summary?.totalCount ?? 0, icon: Leaf, color: 'text-emerald-500' },
    { label: 'Vegetative', value: summary?.vegetativeCount ?? 0, icon: Sprout, color: 'text-green-500' },
    { label: 'Flowering', value: summary?.floweringCount ?? 0, icon: Flower2, color: 'text-purple-500' },
    { label: 'On Hold', value: summary?.onHoldCount ?? 0, icon: PauseCircle, color: 'text-yellow-500' },
  ]

  const phaseTabs = [
    { label: 'All', value: '' },
    { label: 'Vegetative', value: 'Vegetative' },
    { label: 'Flowering', value: 'Flowering' },
  ]

  return (
    <div className="p-8">
      <PageHeader
        title="Plants"
        description="Track individual plants across growth phases"
        actions={
          <Link
            href={`/facilities/${facilityId}/plant-batches`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Sprout className="h-4 w-4" />
            Plant Batches
          </Link>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {summaryCards.map((card) => (
          <KpiCard key={card.label} {...card} />
        ))}
      </div>

      {/* Top Strains */}
      {summary?.topStrains && summary.topStrains.length > 0 && (
        <div className="card-modern p-4 mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Top Strains</h3>
          <div className="flex flex-wrap gap-2">
            {summary.topStrains.map((s) => (
              <span
                key={s.strain}
                className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground"
              >
                {s.strain}
                <span className="ml-1.5 text-muted-foreground">({s.count})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Phase Tabs + Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/30">
          {phaseTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setPhaseFilter(tab.value); setPage(1); }}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                phaseFilter === tab.value
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
            placeholder="Search by label, strain, or location..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Plants Table */}
      <div className="card-modern overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="w-10 py-3 px-4">
                  <input
                    type="checkbox"
                    checked={selection.isAllSelected}
                    ref={(el) => { if (el) el.indeterminate = selection.isPartiallySelected }}
                    onChange={selection.toggleAll}
                    className="rounded border-border"
                  />
                </th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Metrc ID</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Label</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Strain</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Phase</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Planted</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeletonRows columns={8} />
              ) : !data?.items?.length ? (
                <EmptyState
                  icon={Leaf}
                  title={`No plants found${phaseFilter ? ` in ${phaseFilter} phase` : ''}`}
                  description={search ? `No results matching "${search}"` : undefined}
                  variant="filtered"
                  colSpan={8}
                />
              ) : (
                data.items.map((plant: PlantItem) => (
                  <tr
                    key={plant.id}
                    className={cn(
                      'border-b border-border/50 hover:bg-muted/20 transition-colors',
                      selection.isSelected(plant.id) && 'bg-primary/5'
                    )}
                  >
                    <td className="py-2.5 px-4">
                      <input
                        type="checkbox"
                        checked={selection.isSelected(plant.id)}
                        onChange={() => selection.toggle(plant.id)}
                        className="rounded border-border"
                      />
                    </td>
                    <td className="py-2.5 px-4">
                      <CopyButton value={String(plant.id)} label="Metrc ID" compact />
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs">{plant.label}</td>
                    <td className="py-2.5 px-4 font-medium">{plant.strain}</td>
                    <td className="py-2.5 px-4">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                        plant.growthPhase === 'Flowering'
                          ? 'bg-purple-500/10 text-purple-500'
                          : 'bg-green-500/10 text-green-500'
                      )}>
                        {plant.growthPhase === 'Flowering'
                          ? <Flower2 className="h-3 w-3" />
                          : <Sprout className="h-3 w-3" />}
                        {plant.growthPhase}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground">{plant.location || plant.room || '\u2014'}</td>
                    <td className="py-2.5 px-4 text-muted-foreground text-xs">
                      {plant.plantedDate ? new Date(plant.plantedDate).toLocaleDateString() : '\u2014'}
                    </td>
                    <td className="py-2.5 px-4">
                      {plant.isOnHold ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 text-yellow-500 px-2 py-0.5 text-xs">
                          <PauseCircle className="h-3 w-3" />
                          On Hold
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-500 px-2 py-0.5 text-xs">
                          Active
                        </span>
                      )}
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

      {/* Floating Action Bar */}
      <BulkActionBar
        selectedCount={selection.selectedCount}
        icon={Leaf}
        actions={[
          { key: 'changePhase', label: 'Change Phase', icon: ArrowUpDown, onClick: () => setShowChangePhase(true) },
        ]}
        onClear={selection.clear}
      />

      {/* Change Phase Dialog */}
      {showChangePhase && (
        <ChangePhaseDialog
          facilityId={facilityId}
          plantIds={Array.from(selection.selectedKeys)}
          open={showChangePhase}
          onClose={() => {
            setShowChangePhase(false)
            selection.clear()
          }}
        />
      )}
    </div>
  )
}
