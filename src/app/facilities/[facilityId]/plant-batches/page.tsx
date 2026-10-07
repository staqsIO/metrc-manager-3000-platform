'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { Sprout, CheckCircle2, Leaf, ShieldCheck, Flower2, GitBranch } from 'lucide-react'
import { PlantBatchTable } from '@/features/plant-batches/components/PlantBatchTable'
import { CreateBatchDialog } from '@/features/plant-batches/components/CreateBatchDialog'
import { PageHeader } from '@/shared/components/PageHeader'
import { KpiCard } from '@/shared/components/KpiCard'

export default function PlantBatchesPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const { data: summary } = trpc.plantBatches.getSummary.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const trackedRatio = summary && summary.totalPlants > 0
    ? Math.round((summary.totalTracked / summary.totalPlants) * 100)
    : 0

  const seedCount = summary?.byType.find(t => t.type === 'Seed')?.count ?? 0
  const cloneCount = summary?.byType.find(t => t.type === 'Clone')?.count ?? 0

  const summaryCards = [
    {
      label: 'Active Batches',
      value: summary?.activeCount ?? 0,
      icon: Sprout,
      color: 'text-emerald-500',
    },
    {
      label: 'Inactive Batches',
      value: summary?.inactiveCount ?? 0,
      icon: CheckCircle2,
      color: 'text-muted-foreground',
    },
    {
      label: 'Total Plants',
      value: summary?.totalPlants ?? 0,
      icon: Leaf,
      color: 'text-foreground',
    },
    {
      label: 'Tracked Ratio',
      value: trackedRatio,
      icon: ShieldCheck,
      color: 'text-blue-500',
      suffix: '%',
    },
    {
      label: 'Seeds',
      value: seedCount,
      icon: Flower2,
      color: 'text-amber-500',
    },
    {
      label: 'Clones',
      value: cloneCount,
      icon: GitBranch,
      color: 'text-emerald-500',
    },
  ]

  return (
    <div className="p-8">
      <PageHeader
        title="Plant Batches"
        description="Track-and-trace plant batch management"
        actions={
          <div className="flex items-center gap-2">
            <CreateBatchDialog facilityId={facilityId} />
            <Link
              href={`/facilities/${facilityId}/plants`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <Leaf className="h-4 w-4" />
              Individual Plants
            </Link>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {summaryCards.map((card) => (
          <KpiCard key={card.label} {...card} />
        ))}
      </div>

      {/* Top Strains */}
      {summary?.topStrains && summary.topStrains.length > 0 && (
        <div className="card-modern p-4 mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Top Active Strains</h3>
          <div className="flex flex-wrap gap-2">
            {summary.topStrains.map((s) => (
              <span
                key={s.strain}
                className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground"
              >
                {s.strain}
                <span className="ml-1.5 text-muted-foreground">({s.plantCount})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Plant Batch Table */}
      <PlantBatchTable facilityId={facilityId} />
    </div>
  )
}
