'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { OpExProvider, useOpExStore } from '@/features/opex/OpExContext'
import OpExCellGrid from '@/features/opex/components/OpExCellGrid'
import OpExSidebar from '@/features/opex/components/OpExSidebar'
import OpExKPIBar from '@/features/opex/components/OpExKPIBar'
import OpExModelSwitcher from '@/features/opex/components/OpExModelSwitcher'
import OpExPnLView from '@/features/opex/components/OpExPnLView'
import OpExSnapshotPanel from '@/features/opex/components/OpExSnapshotPanel'
import OpExExport from '@/features/opex/components/OpExExport'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type OpExTab = 'grid' | 'pnl' | 'snapshots'

const TAB_LABELS: Record<OpExTab, string> = {
  grid: 'Calculator',
  pnl: 'P&L View',
  snapshots: 'Snapshots',
}

// ---------------------------------------------------------------------------
// Inner component that uses the OpExStore (must be inside OpExProvider)
// ---------------------------------------------------------------------------

function OpExModelView({
  facilityId,
  modelId,
}: {
  facilityId: string
  modelId: string
}) {
  const store = useOpExStore()
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<OpExTab>('grid')

  // Fetch the full model with sections, groups, cells
  const { data: model, isLoading: modelLoading } = trpc.opex.getModel.useQuery(
    { facilityId, modelId },
    { enabled: !!facilityId && !!modelId, staleTime: 30_000 },
  )

  // Fetch all models for the switcher
  const { data: allModels } = trpc.opex.listModels.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 60_000 },
  )

  // Initialize the store when model data loads
  useEffect(() => {
    if (!model) return

    // Collect all cells from all sections (direct + sub-sections)
    const allCells: Array<{
      id: string
      key: string
      cellType: string
      formula: string | null
      value: number | null
    }> = []

    for (const section of model.sections) {
      for (const group of section.cellGroups) {
        for (const cell of group.cells) {
          allCells.push({
            id: cell.id,
            key: cell.key,
            cellType: cell.cellType,
            formula: cell.formula,
            value: cell.value,
          })
        }
      }
      for (const child of section.children) {
        for (const group of child.cellGroups) {
          for (const cell of group.cells) {
            allCells.push({
              id: cell.id,
              key: cell.key,
              cellType: cell.cellType,
              formula: cell.formula,
              value: cell.value,
            })
          }
        }
      }
    }

    store.initialize(allCells, model.kpiCells)
  }, [model, store])

  const handleSectionClick = useCallback((slug: string) => {
    setActiveSection(slug)
    const el = document.getElementById(`section-${slug}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  if (modelLoading || !model) {
    return <OpExLoadingSkeleton />
  }

  // Filter to top-level sections (no parentId)
  const topSections = model.sections.filter((s: { parentId: string | null }) => !s.parentId)

  // Build model list for switcher
  const modelList = (allModels ?? []).map((m: { id: string; name: string; status: string }) => ({
    id: m.id,
    name: m.name,
    status: m.status,
  }))

  return (
    <div className="flex flex-col h-[calc(100vh-theme(spacing.16)-theme(spacing.12))]">
      {/* Top toolbar: model switcher + actions */}
      <OpExModelSwitcher
        facilityId={facilityId}
        currentModelId={model.id}
        currentModelName={model.name}
        currentModelStatus={model.status}
        models={modelList}
      />

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-card/30">
        {(['grid', 'pnl', 'snapshots'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-3 py-1.5 text-sm rounded-md transition-colors',
              activeTab === tab
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        <div className="flex-1" />
        <OpExExport facilityId={facilityId} modelId={modelId} modelName={model.name} />
      </div>

      {/* Main content: conditionally rendered by tab */}
      {activeTab === 'grid' && (
        <div className="flex flex-1 min-h-0">
          <OpExSidebar
            sections={topSections}
            activeSection={activeSection}
            onSectionClick={handleSectionClick}
          />
          <OpExCellGrid
            facilityId={facilityId}
            modelId={modelId}
            sections={topSections}
          />
        </div>
      )}

      {activeTab === 'pnl' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <OpExPnLView />
        </div>
      )}

      {activeTab === 'snapshots' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <OpExSnapshotPanel facilityId={facilityId} modelId={modelId} />
        </div>
      )}

      {/* Sticky KPI bar */}
      <OpExKPIBar />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function OpExLoadingSkeleton() {
  return (
    <div className="flex flex-col h-[calc(100vh-theme(spacing.16)-theme(spacing.12))]">
      {/* Toolbar skeleton */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-16" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-9" />
      </div>

      {/* Tab bar skeleton */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar skeleton */}
        <div className="w-56 border-r border-border p-4 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>

        {/* Grid skeleton */}
        <div className="flex-1 p-4 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-10 w-full mb-2" />
              {Array.from({ length: 5 }).map((_, j) => (
                <Skeleton key={j} className="h-8 w-full mb-1" />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* KPI bar skeleton */}
      <div className="border-t border-border px-4 py-3 flex gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex-1 text-center">
            <Skeleton className="h-3 w-16 mx-auto mb-1" />
            <Skeleton className="h-5 w-20 mx-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page component (wraps with OpExProvider)
// ---------------------------------------------------------------------------

export default function OpExModelPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const modelId = params?.modelId as string

  return (
    <OpExProvider>
      <OpExModelView facilityId={facilityId} modelId={modelId} />
    </OpExProvider>
  )
}
