'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  GitBranch, Package, Sprout, FlaskConical, Cog,
  ShoppingCart, Truck, CheckCircle2, ArrowRight,
  ChevronDown, ChevronRight, TrendingUp, Percent,
  Settings2, Plus, X, MapPin,
} from 'lucide-react'
import { KpiCard } from '@/shared/components/KpiCard'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { TableSkeletonRows } from '@/shared/components/ui/table-skeleton'
import { Switch } from '@/shared/components/ui/switch'
import { useFacilityId } from '@/shared/hooks/useFacilityId'
import { useFacility } from '@/shared/hooks/useFacility'
import type { PipelineStage, PipelineStageSummary, HarvestCashTracker } from '@/services/engines/pipeline-stage-engine'

const STAGE_CONFIG: Record<PipelineStage, { label: string; icon: React.ElementType; color: string; barColor: string; bgColor: string }> = {
  harvested: { label: 'Harvested', icon: Sprout, color: 'text-emerald-500', barColor: 'bg-emerald-500', bgColor: 'bg-emerald-500/10' },
  post_harvest: { label: 'Post-Harvest', icon: Package, color: 'text-lime-500', barColor: 'bg-lime-500', bgColor: 'bg-lime-500/10' },
  testing: { label: 'Testing', icon: FlaskConical, color: 'text-amber-500', barColor: 'bg-amber-500', bgColor: 'bg-amber-500/10' },
  processed: { label: 'Processed', icon: Cog, color: 'text-blue-500', barColor: 'bg-blue-500', bgColor: 'bg-blue-500/10' },
  retail_ready: { label: 'Retail Ready', icon: CheckCircle2, color: 'text-purple-500', barColor: 'bg-purple-500', bgColor: 'bg-purple-500/10' },
  in_transit: { label: 'In Transit', icon: Truck, color: 'text-cyan-500', barColor: 'bg-cyan-500', bgColor: 'bg-cyan-500/10' },
  sold: { label: 'Sold', icon: ShoppingCart, color: 'text-green-500', barColor: 'bg-green-500', bgColor: 'bg-green-500/10' },
  inventory: { label: 'Other Inventory', icon: Package, color: 'text-gray-500', barColor: 'bg-gray-500', bgColor: 'bg-gray-500/10' },
}

/** Configurable phases (sold is auto-detected, inventory is a catch-all) */
const CONFIGURABLE_PHASES: PipelineStage[] = [
  'harvested', 'post_harvest', 'testing', 'processed', 'retail_ready', 'in_transit',
]

export default function PipelinePage() {
  const facilityId = useFacilityId()
  const { facility } = useFacility()
  const showHarvestTracker = !facility?.facilityType || ['Cultivator', 'Microbusiness'].includes(facility.facilityType)
  const [expandedHarvest, setExpandedHarvest] = useState<string | null>(null)
  const [expandedStage, setExpandedStage] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const { data, isLoading } = trpc.pipeline.getFullPipeline.useQuery(
    { facilityId: facilityId! },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const overview = data?.overview
  const harvestTrackers = data?.harvests

  const kpiCards = [
    { label: 'Active Packages', value: overview?.totalActivePackages ?? 0, icon: Package, color: 'text-foreground' },
    { label: 'Total Weight', value: overview?.totalWeight ?? 0, icon: TrendingUp, color: 'text-blue-500' },
    { label: 'Active Harvests', value: overview?.harvestIntake.activeCount ?? 0, icon: Sprout, color: 'text-emerald-500' },
    { label: 'Conversion Rate', value: overview?.conversionRate != null ? `${overview.conversionRate}%` : 'N/A', icon: Percent, color: 'text-purple-500', isText: true as const },
  ]

  // Use package count for proportional bar widths (unit-agnostic)
  const maxStagePkgCount = overview?.stages
    ? Math.max(...overview.stages.map((s: PipelineStageSummary) => s.packageCount), 1)
    : 1

  return (
    <div className="p-8">
      <PageHeader
        title="Farm-to-Cash Pipeline"
        description="Track product flow from harvest through sale"
        icon={GitBranch}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                showSettings
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <Settings2 className="h-4 w-4" />
              Configure Stages
            </button>
            {facilityId && (
              <Link
                href={`/facilities/${facilityId}/inventory`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <Package className="h-4 w-4" />
                Inventory
              </Link>
            )}
          </div>
        }
      />

      {/* Pipeline Configuration Panel */}
      {showSettings && facilityId && (
        <PipelineConfigPanel facilityId={facilityId} />
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {kpiCards.map((card) => (
          <KpiCard key={card.label} {...card} />
        ))}
      </div>

      {/* Pipeline Flow Visualization */}
      <div className="card-modern p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Pipeline Stages</h2>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-14 bg-muted/30 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : overview?.stages && overview.stages.length > 0 ? (
          <div className="space-y-3">
            {overview.stages
              .filter((s: PipelineStageSummary) => s.packageCount > 0)
              .map((stage: PipelineStageSummary, idx: number, arr: PipelineStageSummary[]) => {
                const config = STAGE_CONFIG[stage.stage]
                const barWidth = Math.max(8, (stage.packageCount / maxStagePkgCount) * 100)
                const StageIcon = config.icon
                const isStageExpanded = expandedStage === stage.stage
                const hasBreakdown = stage.breakdown && stage.breakdown.length > 0
                return (
                  <div key={stage.stage}>
                    <button
                      onClick={() => hasBreakdown && setExpandedStage(isStageExpanded ? null : stage.stage)}
                      className={cn(
                        'w-full text-left rounded-lg transition-colors',
                        hasBreakdown ? 'hover:bg-muted/20 cursor-pointer' : 'cursor-default'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg shrink-0', config.bgColor)}>
                          <StageIcon className={cn('h-4 w-4', config.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium">{config.label}</span>
                              {hasBreakdown && (
                                <ChevronRight className={cn(
                                  'h-3 w-3 text-muted-foreground transition-transform duration-200',
                                  isStageExpanded && 'rotate-90'
                                )} />
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span>{stage.packageCount} pkg{stage.packageCount !== 1 ? 's' : ''}</span>
                              {stage.quantities.map((q, qi) => (
                                <span key={qi} className="font-medium text-foreground">
                                  {q.total.toLocaleString(undefined, { maximumFractionDigits: 0 })} {q.unit}
                                </span>
                              ))}
                              <span>avg {stage.avgAgeDays}d</span>
                            </div>
                          </div>
                          <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                            <div
                              className={cn('h-full rounded-full transition-all duration-500', config.barColor)}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </button>
                    {/* Stage breakdown detail */}
                    {isStageExpanded && stage.breakdown && (
                      <div className="ml-12 mt-2 mb-1 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1">
                        {stage.breakdown.map((b) => (
                          <div key={b.label} className="flex items-center justify-between text-xs py-0.5">
                            <span className="text-muted-foreground truncate">{b.label}</span>
                            <span className="font-medium tabular-nums ml-2">{b.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {idx < arr.length - 1 && (
                      <div className="flex justify-center py-1">
                        <ArrowRight className="h-3 w-3 text-muted-foreground/40 rotate-90" />
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        ) : (
          <EmptyState
            icon={GitBranch}
            title="No pipeline data"
            description="No active packages found for this facility."
          />
        )}
      </div>

      {/* Harvest-to-Cash Tracker — only for cultivation facilities */}
      {showHarvestTracker && <div className="card-modern p-6">
        <h2 className="text-lg font-semibold mb-4">Harvest-to-Cash Tracker</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Track each harvest from field to cash register. Click a row to see stage breakdown.
        </p>

        {isLoading ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-muted-foreground py-2 px-3">Harvest</th>
                <th className="text-left text-xs font-medium text-muted-foreground py-2 px-3">Strain</th>
                <th className="text-right text-xs font-medium text-muted-foreground py-2 px-3">Weight</th>
                <th className="text-left text-xs font-medium text-muted-foreground py-2 px-3">Pipeline Progress</th>
                <th className="text-right text-xs font-medium text-muted-foreground py-2 px-3">% Sold</th>
                <th className="text-right text-xs font-medium text-muted-foreground py-2 px-3">Revenue</th>
              </tr>
            </thead>
            <tbody>
              <TableSkeletonRows columns={6} rows={5} />
            </tbody>
          </table>
        ) : harvestTrackers && harvestTrackers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-medium text-muted-foreground py-2 px-3 w-6" />
                  <th className="text-left text-xs font-medium text-muted-foreground py-2 px-3">Harvest</th>
                  <th className="text-left text-xs font-medium text-muted-foreground py-2 px-3">Strain</th>
                  <th className="text-right text-xs font-medium text-muted-foreground py-2 px-3">Weight</th>
                  <th className="text-left text-xs font-medium text-muted-foreground py-2 px-3 min-w-[200px]">Pipeline Progress</th>
                  <th className="text-right text-xs font-medium text-muted-foreground py-2 px-3">% Sold</th>
                  <th className="text-right text-xs font-medium text-muted-foreground py-2 px-3">Revenue</th>
                  <th className="text-right text-xs font-medium text-muted-foreground py-2 px-3">Avg Days to Sale</th>
                </tr>
              </thead>
              <tbody>
                {harvestTrackers.map((h: HarvestCashTracker) => {
                  const isExpanded = expandedHarvest === h.harvestName
                  const totalPkgs = Object.values(h.stages).reduce((a: number, s: { count: number; weight: number }) => a + s.count, 0)
                  const segments = totalPkgs > 0
                    ? (['sold', 'retail_ready', 'in_transit', 'processed', 'testing', 'post_harvest', 'harvested', 'inventory'] as PipelineStage[])
                        .filter((stage) => h.stages[stage].count > 0)
                        .map((stage) => ({
                          stage,
                          pct: (h.stages[stage].count / totalPkgs) * 100,
                          color: STAGE_CONFIG[stage].barColor,
                        }))
                    : []

                  return (
                    <tr key={h.harvestName} className="group">
                      <td colSpan={8} className="p-0">
                        <button
                          onClick={() => setExpandedHarvest(isExpanded ? null : h.harvestName)}
                          className="w-full text-left hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex items-center border-b border-border/50">
                            <div className="py-3 px-3 w-6">
                              {isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                              }
                            </div>
                            <div className="py-3 px-3 flex-1 min-w-0">
                              <span className="text-sm font-medium truncate block">{h.harvestName}</span>
                              <span className="text-xs text-muted-foreground">{h.harvestDate ? new Date(h.harvestDate).toLocaleDateString() : ''}</span>
                            </div>
                            <div className="py-3 px-3 text-sm">{h.strain || 'Unknown'}</div>
                            <div className="py-3 px-3 text-sm text-right tabular-nums">
                              {h.harvestWeight.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                            <div className="py-3 px-3 min-w-[200px]">
                              {segments.length > 0 ? (
                                <div className="flex h-3 rounded-full overflow-hidden bg-muted/30">
                                  {segments.map((seg) => (
                                    <div
                                      key={seg.stage}
                                      className={cn('h-full transition-all', seg.color)}
                                      style={{ width: `${Math.max(seg.pct, 2)}%` }}
                                      title={`${STAGE_CONFIG[seg.stage].label}: ${Math.round(seg.pct)}%`}
                                    />
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">No packages</span>
                              )}
                            </div>
                            <div className="py-3 px-3 text-sm text-right tabular-nums font-medium">
                              <span className={cn(
                                h.percentSold >= 75 ? 'text-green-500' :
                                h.percentSold >= 50 ? 'text-blue-500' :
                                h.percentSold >= 25 ? 'text-amber-500' :
                                'text-muted-foreground'
                              )}>
                                {h.percentSold}%
                              </span>
                            </div>
                            <div className="py-3 px-3 text-sm text-right tabular-nums">
                              {h.revenueSoFar !== null ? `$${h.revenueSoFar.toLocaleString()}` : '--'}
                            </div>
                            <div className="py-3 px-3 text-sm text-right tabular-nums">
                              {h.avgDaysToSale !== null ? `${h.avgDaysToSale}d` : '--'}
                            </div>
                          </div>
                        </button>

                        {/* Expanded stage breakdown */}
                        {isExpanded && (
                          <div className="bg-muted/10 border-b border-border/50 px-8 py-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              {(['harvested', 'post_harvest', 'testing', 'processed', 'retail_ready', 'in_transit', 'sold', 'inventory'] as PipelineStage[])
                                .filter((stage) => h.stages[stage].count > 0)
                                .map((stage) => {
                                  const config = STAGE_CONFIG[stage]
                                  const stageData = h.stages[stage]
                                  const DetailIcon = config.icon
                                  return (
                                    <div key={stage} className="flex items-center gap-2 p-2 rounded-lg bg-background/50">
                                      <div className={cn('flex h-7 w-7 items-center justify-center rounded', config.bgColor)}>
                                        <DetailIcon className={cn('h-3.5 w-3.5', config.color)} />
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">{config.label}</p>
                                        <p className="text-sm font-medium">
                                          {stageData.count} pkg{stageData.count !== 1 ? 's' : ''}
                                          <span className="text-xs text-muted-foreground ml-1">
                                            ({stageData.weight.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                                          </span>
                                        </p>
                                      </div>
                                    </div>
                                  )
                                })
                              }
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Sprout}
            title="No harvest data"
            description="No harvests found for this facility. Harvest data from Metrc will appear here."
          />
        )}
      </div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pipeline Configuration Panel
// ---------------------------------------------------------------------------

interface LocationInfo {
  id: number
  name: string
  locationTypeName: string
  packageCount: number
  assignedStatus: { statusId: string; statusName: string; phase: string } | null
}

interface StatusRow {
  id: string
  phase: string
  name: string
  color: string | null
  sortOrder: number
  locationNames: string[]
}

function PipelineConfigPanel({ facilityId }: { facilityId: string }) {
  const utils = trpc.useUtils()
  const [collapsedPhases, setCollapsedPhases] = useState<Record<string, boolean>>({})
  const [addingToPhase, setAddingToPhase] = useState<string | null>(null)
  const [newStatusName, setNewStatusName] = useState('')
  const [editingLocationStatus, setEditingLocationStatus] = useState<string | null>(null)

  const { data: config, isLoading: configLoading } = trpc.pipeline.getPipelineConfig.useQuery(
    { facilityId },
    { staleTime: 300_000 }
  )

  const { data: locations } = trpc.pipeline.getAvailableLocations.useQuery(
    { facilityId },
    { staleTime: 300_000 }
  )

  const updateConfig = trpc.pipeline.updatePipelineConfig.useMutation({
    onSuccess: () => {
      utils.pipeline.getPipelineConfig.invalidate({ facilityId })
      utils.pipeline.getFullPipeline.invalidate({ facilityId })
    },
  })

  const upsertStatus = trpc.pipeline.upsertPipelineStatus.useMutation({
    onSuccess: () => {
      utils.pipeline.getPipelineConfig.invalidate({ facilityId })
      utils.pipeline.getAvailableLocations.invalidate({ facilityId })
      utils.pipeline.getFullPipeline.invalidate({ facilityId })
      setNewStatusName('')
      setAddingToPhase(null)
    },
  })

  const deleteStatus = trpc.pipeline.deletePipelineStatus.useMutation({
    onSuccess: () => {
      utils.pipeline.getPipelineConfig.invalidate({ facilityId })
      utils.pipeline.getAvailableLocations.invalidate({ facilityId })
      utils.pipeline.getFullPipeline.invalidate({ facilityId })
    },
  })

  const togglePhase = useCallback((phase: string) => {
    setCollapsedPhases(prev => ({ ...prev, [phase]: !prev[phase] }))
  }, [])

  const handleAddStatus = useCallback((phase: string) => {
    if (!newStatusName.trim()) return
    upsertStatus.mutate({
      facilityId,
      phase,
      name: newStatusName.trim(),
      locationNames: [],
    })
  }, [facilityId, newStatusName, upsertStatus])

  const handleToggleLocation = useCallback((statusId: string, status: StatusRow, locationName: string) => {
    const currentLocs = parseJsonArray(status.locationNames)
    const newLocs = currentLocs.includes(locationName)
      ? currentLocs.filter(l => l !== locationName)
      : [...currentLocs, locationName]
    upsertStatus.mutate({
      facilityId,
      id: statusId,
      phase: status.phase,
      name: status.name,
      color: status.color,
      locationNames: newLocs,
    })
  }, [facilityId, upsertStatus])

  // Group statuses by phase
  const statusesByPhase = new Map<string, StatusRow[]>()
  if (config?.statuses) {
    for (const s of config.statuses) {
      const phase = s.phase
      if (!statusesByPhase.has(phase)) statusesByPhase.set(phase, [])
      statusesByPhase.get(phase)!.push({
        id: s.id,
        phase: s.phase,
        name: s.name,
        color: s.color,
        sortOrder: s.sortOrder,
        locationNames: parseJsonArray(s.locationNames),
      })
    }
  }

  // Unassigned locations = locations not assigned to any status
  const unassignedLocations = (locations ?? []).filter(
    (loc: LocationInfo) => !loc.assignedStatus && loc.packageCount > 0
  )

  if (configLoading) {
    return (
      <div className="card-modern p-6 mb-8">
        <div className="h-32 bg-muted/30 rounded-lg animate-pulse" />
      </div>
    )
  }

  return (
    <div className="card-modern p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Pipeline Configuration</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Map Metrc locations to pipeline phases for accurate stage tracking
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {config?.isEnabled ? 'Enabled' : 'Disabled'}
          </span>
          <Switch
            checked={config?.isEnabled ?? false}
            onCheckedChange={(checked) => {
              updateConfig.mutate({ facilityId, isEnabled: checked })
            }}
          />
        </div>
      </div>

      {/* Phase sections */}
      <div className="space-y-2">
        {CONFIGURABLE_PHASES.map((phase) => {
          const phaseConfig = STAGE_CONFIG[phase]
          const statuses = statusesByPhase.get(phase) || []
          const isCollapsed = collapsedPhases[phase]
          const PhaseIcon = phaseConfig.icon

          return (
            <div key={phase} className="border border-border rounded-lg">
              <button
                onClick={() => togglePhase(phase)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-lg"
              >
                <div className={cn('flex h-7 w-7 items-center justify-center rounded', phaseConfig.bgColor)}>
                  <PhaseIcon className={cn('h-3.5 w-3.5', phaseConfig.color)} />
                </div>
                <span className="text-sm font-medium flex-1">{phaseConfig.label}</span>
                {statuses.length > 0 && (
                  <span className="text-xs text-muted-foreground mr-2">
                    {statuses.length} status{statuses.length !== 1 ? 'es' : ''}
                  </span>
                )}
                <ChevronRight
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform duration-200',
                    !isCollapsed && 'rotate-90'
                  )}
                />
              </button>

              {!isCollapsed && (
                <div className="px-4 pb-3 space-y-2">
                  {statuses.map((status) => {
                    const locs = status.locationNames
                    const isEditingLocs = editingLocationStatus === status.id
                    // Only show locations not assigned to OTHER statuses
                    const unassignedLocs = (locations ?? []).filter(
                      (loc: LocationInfo) => !loc.assignedStatus && !locs.includes(loc.name)
                    )

                    return (
                      <div key={status.id} className="pl-10 py-1.5">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-medium">{status.name}</span>
                          <button
                            onClick={() => deleteStatus.mutate({ facilityId, statusId: status.id })}
                            className="p-1 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Delete status"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>

                        {/* Assigned locations as removable tags */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {locs.map((loc) => {
                            const locInfo = (locations ?? []).find((l: LocationInfo) => l.name === loc)
                            return (
                              <span key={loc} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary pl-2 pr-1 py-0.5 rounded-full">
                                <MapPin className="h-3 w-3" />
                                {loc}
                                {locInfo && <span className="text-primary/60">({locInfo.packageCount})</span>}
                                <button
                                  onClick={() => handleToggleLocation(status.id, status, loc)}
                                  className="ml-0.5 p-0.5 rounded-full hover:bg-primary/20 transition-colors"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </span>
                            )
                          })}

                          {/* Add location button / dropdown */}
                          {isEditingLocs ? (
                            <div className="relative">
                              <div className="absolute top-0 left-0 z-10 mt-1 w-64 p-2 bg-card border border-border rounded-lg shadow-lg space-y-0.5 max-h-48 overflow-y-auto">
                                <div className="flex items-center justify-between px-2 pb-1.5 mb-1 border-b border-border">
                                  <span className="text-xs font-medium text-muted-foreground">Assign location</span>
                                  <button
                                    onClick={() => setEditingLocationStatus(null)}
                                    className="p-0.5 text-muted-foreground hover:text-foreground"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                                {unassignedLocs.length === 0 ? (
                                  <p className="text-xs text-muted-foreground px-2 py-1">All locations assigned</p>
                                ) : (
                                  unassignedLocs.map((loc: LocationInfo) => (
                                    <button
                                      key={loc.id}
                                      onClick={() => handleToggleLocation(status.id, status, loc.name)}
                                      className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-muted/50 transition-colors text-left"
                                    >
                                      <span className="font-medium">{loc.name}</span>
                                      <span className="text-muted-foreground">{loc.packageCount} pkg{loc.packageCount !== 1 ? 's' : ''}</span>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingLocationStatus(status.id)}
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded-full border border-dashed border-border hover:border-foreground/30 transition-colors"
                            >
                              <Plus className="h-3 w-3" />
                              Add location
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Add status form */}
                  {addingToPhase === phase ? (
                    <div className="flex items-center gap-2 pl-10">
                      <input
                        type="text"
                        value={newStatusName}
                        onChange={(e) => setNewStatusName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddStatus(phase)
                          if (e.key === 'Escape') { setAddingToPhase(null); setNewStatusName('') }
                        }}
                        placeholder="Status name..."
                        className="flex-1 h-8 px-3 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                        autoFocus
                      />
                      <button
                        onClick={() => handleAddStatus(phase)}
                        disabled={!newStatusName.trim() || upsertStatus.isPending}
                        className="h-8 px-3 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setAddingToPhase(null); setNewStatusName('') }}
                        className="h-8 px-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddingToPhase(phase); setNewStatusName('') }}
                      className="flex items-center gap-1.5 pl-10 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Status
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Unassigned Locations */}
      {unassignedLocations.length > 0 && (
        <div className="mt-6 pt-4 border-t border-border">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Unassigned Locations ({unassignedLocations.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {unassignedLocations.map((loc: LocationInfo) => (
              <span
                key={loc.id}
                className="inline-flex items-center gap-1.5 text-xs bg-muted/50 px-2.5 py-1 rounded-full text-muted-foreground"
              >
                <MapPin className="h-3 w-3" />
                {loc.name}
                <span className="text-muted-foreground/60">({loc.packageCount})</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((s): s is string => typeof s === 'string')
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return [] }
  }
  return []
}
