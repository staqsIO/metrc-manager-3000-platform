'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Boxes, Combine, FlaskConical, ChevronDown, ChevronRight, Layers } from 'lucide-react'
import PackageLabelLink from '@/features/inventory/components/PackageLabelLink'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

// ---------------------------------------------------------------------------
// Types (local mirror to avoid deep type-instantiation errors)
// ---------------------------------------------------------------------------

interface FragmentedPackage {
  label: string
  quantity: number
  ageDays: number
  location: string
}

interface FragmentedGroup {
  itemName: string
  itemCategory: string
  strain: string
  packageCount: number
  totalQuantity: number
  unitOfMeasure: string
  averageQuantity: number
  smallestQuantity: number
  largestQuantity: number
  packages: FragmentedPackage[]
}

interface FragmentationResponse {
  groups: FragmentedGroup[]
  totalFragmentedPackages: number
  totalGroups: number
}

interface SourcePackage {
  label: string
  quantity: number
  ageDays: number
  location: string
}

interface ConsolidationRecommendation {
  targetItemName: string
  targetCategory: string
  targetStrain: string
  sourcePackages: SourcePackage[]
  combinedQuantity: number
  unitOfMeasure: string
  estimatedPackagesReduced: number
  reason: string
  priority: 'high' | 'medium' | 'low'
}

interface ConsolidationResponse {
  recommendations: ConsolidationRecommendation[]
  totalRecommendations: number
  estimatedPackagesReduced: number
}

interface SampleOutCandidate {
  label: string
  itemName: string
  itemCategory: string
  strain: string
  quantity: number
  unitOfMeasure: string
  ageDays: number
  location: string
  reason: string
}

interface SampleOutResponse {
  candidates: SampleOutCandidate[]
  totalCandidates: number
}

type Tab = 'fragmentation' | 'consolidation' | 'sample-out'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PackagesPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const [activeTab, setActiveTab] = useState<Tab>('fragmentation')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // -- queries ---------------------------------------------------------------
  const { data: rawFragmentation, isLoading: fragLoading } =
    trpc.packages.fragmentation.useQuery(
      { facilityId },
      { enabled: !!facilityId, staleTime: 300_000 },
    )
  const fragmentation = rawFragmentation as unknown as FragmentationResponse | undefined

  const { data: rawConsolidation, isLoading: consLoading } =
    trpc.packages.consolidationRecs.useQuery(
      { facilityId },
      { enabled: !!facilityId, staleTime: 300_000 },
    )
  const consolidation = rawConsolidation as unknown as ConsolidationResponse | undefined

  const { data: rawSampleOut, isLoading: sampleLoading } =
    trpc.packages.sampleOutCandidates.useQuery(
      { facilityId },
      { enabled: !!facilityId, staleTime: 300_000 },
    )
  const sampleOut = rawSampleOut as unknown as SampleOutResponse | undefined

  const isLoading = fragLoading || consLoading || sampleLoading

  // -- helpers ---------------------------------------------------------------
  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const priorityColor: Record<string, string> = {
    high: 'bg-red-500/15 text-red-500 border-red-500/30',
    medium: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30',
    low: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'fragmentation', label: 'Fragmentation' },
    { key: 'consolidation', label: 'Consolidation' },
    { key: 'sample-out', label: 'Sample-Out' },
  ]

  // -- sorted data -----------------------------------------------------------
  const sortedGroups = fragmentation?.groups
    ? [...fragmentation.groups].sort((a, b) => b.packageCount - a.packageCount)
    : []

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Package Intelligence</h1>
        <p className="text-muted-foreground mt-1">
          Fragmentation analysis, consolidation recommendations, and sample-out candidates
        </p>
      </div>

      {/* ---- Summary Cards ---- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {/* Total Fragmented Groups */}
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Layers className="h-4 w-4 text-foreground" />
            <span className="text-xs text-muted-foreground">Fragmented Groups</span>
          </div>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="text-2xl font-bold">
              {(fragmentation?.totalGroups ?? 0).toLocaleString()}
            </p>
          )}
        </div>

        {/* Total Fragmented Packages */}
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Boxes className="h-4 w-4 text-yellow-500" />
            <span className="text-xs text-muted-foreground">Fragmented Packages</span>
          </div>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="text-2xl font-bold text-yellow-500">
              {(fragmentation?.totalFragmentedPackages ?? 0).toLocaleString()}
            </p>
          )}
        </div>

        {/* Consolidation Recommendations */}
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Combine className="h-4 w-4 text-blue-500" />
            <span className="text-xs text-muted-foreground">Consolidation Recs</span>
          </div>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="text-2xl font-bold text-blue-500">
              {(consolidation?.totalRecommendations ?? 0).toLocaleString()}
            </p>
          )}
        </div>

        {/* Sample-Out Candidates */}
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <FlaskConical className="h-4 w-4 text-purple-500" />
            <span className="text-xs text-muted-foreground">Sample-Out Candidates</span>
          </div>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="text-2xl font-bold text-purple-500">
              {(sampleOut?.totalCandidates ?? 0).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {/* ---- Tab Bar ---- */}
      <div className="flex gap-1 mb-6 rounded-lg bg-muted p-1 w-fit">
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            variant={activeTab === tab.key ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'rounded-md',
              activeTab === tab.key
                ? ''
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* ---- Fragmentation Tab ---- */}
      {activeTab === 'fragmentation' && (
        <div className="space-y-3">
          {fragLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))
          ) : sortedGroups.length === 0 ? (
            <div className="card-modern p-12 text-center">
              <Boxes className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No fragmented package groups found.</p>
            </div>
          ) : (
            sortedGroups.map((group) => {
              const groupKey = `${group.itemName}-${group.strain}-${group.itemCategory}`
              const isExpanded = expandedGroups.has(groupKey)

              return (
                <div key={groupKey} className="card-modern overflow-hidden">
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(groupKey)}
                    className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{group.itemName}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {group.itemCategory}
                          {group.strain ? ` / ${group.strain}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 shrink-0 text-sm">
                      <div className="text-right">
                        <p className="font-semibold">{group.packageCount}</p>
                        <p className="text-xs text-muted-foreground">packages</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">
                          {group.totalQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-xs text-muted-foreground">{group.unitOfMeasure}</p>
                      </div>
                      <div className="text-right hidden md:block compact-hide">
                        <p className="font-semibold">
                          {group.averageQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-xs text-muted-foreground">avg qty</p>
                      </div>
                      <div className="text-right hidden lg:block compact-hide">
                        <p className="text-xs text-muted-foreground">
                          {group.smallestQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} &ndash;{' '}
                          {group.largestQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} {group.unitOfMeasure}
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* Expanded package sub-table */}
                  {isExpanded && (
                    <div className="border-t border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Package Label</TableHead>
                            <TableHead className="text-right">Quantity</TableHead>
                            <TableHead className="text-right">Age (days)</TableHead>
                            <TableHead>Location</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.packages.map((pkg) => (
                            <TableRow key={pkg.label}>
                              <TableCell><PackageLabelLink label={pkg.label} /></TableCell>
                              <TableCell className="text-right">
                                {pkg.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-right">
                                <span
                                  className={cn(
                                    pkg.ageDays > 90
                                      ? 'text-red-500'
                                      : pkg.ageDays > 60
                                        ? 'text-yellow-500'
                                        : 'text-foreground',
                                  )}
                                >
                                  {pkg.ageDays}
                                </span>
                              </TableCell>
                              <TableCell className="text-muted-foreground">{pkg.location}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ---- Consolidation Tab ---- */}
      {activeTab === 'consolidation' && (
        <div className="space-y-4">
          {consLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-lg" />
            ))
          ) : !consolidation?.recommendations?.length ? (
            <div className="card-modern p-12 text-center">
              <Combine className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No consolidation recommendations at this time.</p>
            </div>
          ) : (
            <>
              {/* Estimated packages reduced banner */}
              {consolidation.estimatedPackagesReduced > 0 && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
                  Implementing all recommendations could reduce package count by approximately{' '}
                  <span className="font-semibold">{consolidation.estimatedPackagesReduced}</span> packages.
                </div>
              )}

              {consolidation.recommendations.map((rec, idx) => (
                <div key={idx} className="card-modern p-5">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold truncate">{rec.targetItemName}</p>
                        <Badge
                          className={cn(
                            'text-[10px] uppercase tracking-wider border',
                            priorityColor[rec.priority] ?? priorityColor.low,
                          )}
                        >
                          {rec.priority}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {rec.targetCategory}
                        {rec.targetStrain ? ` / ${rec.targetStrain}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Source Packages</p>
                      <p className="font-semibold">{rec.sourcePackages.length}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Combined Qty</p>
                      <p className="font-semibold">
                        {rec.combinedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                        <span className="text-muted-foreground font-normal">{rec.unitOfMeasure}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Est. Reduction</p>
                      <p className="font-semibold text-emerald-500">
                        -{rec.estimatedPackagesReduced} pkg{rec.estimatedPackagesReduced !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <p className="text-xs text-muted-foreground">Reason</p>
                      <p className="text-sm">{rec.reason}</p>
                    </div>
                  </div>

                  {/* Source packages mini-table */}
                  <details className="group">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none">
                      Show source packages ({rec.sourcePackages.length})
                    </summary>
                    <div className="mt-2 border-t border-border pt-2">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Label</TableHead>
                            <TableHead className="text-right">Quantity</TableHead>
                            <TableHead className="text-right">Age (days)</TableHead>
                            <TableHead>Location</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rec.sourcePackages.map((pkg) => (
                            <TableRow key={pkg.label}>
                              <TableCell><PackageLabelLink label={pkg.label} /></TableCell>
                              <TableCell className="text-right">
                                {pkg.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-right">{pkg.ageDays}</TableCell>
                              <TableCell className="text-muted-foreground">{pkg.location}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </details>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ---- Sample-Out Tab ---- */}
      {activeTab === 'sample-out' && (
        <div>
          {sampleLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full rounded-lg" />
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : !sampleOut?.candidates?.length ? (
            <div className="card-modern p-12 text-center">
              <FlaskConical className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No sample-out candidates identified.</p>
            </div>
          ) : (
            <div className="card-modern overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Package Label</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Strain</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Age (days)</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sampleOut.candidates.map((candidate) => (
                    <TableRow key={candidate.label}>
                      <TableCell><PackageLabelLink label={candidate.label} /></TableCell>
                      <TableCell className="font-medium">{candidate.itemName}</TableCell>
                      <TableCell className="text-muted-foreground">{candidate.itemCategory}</TableCell>
                      <TableCell className="text-muted-foreground">{candidate.strain || '--'}</TableCell>
                      <TableCell className="text-right">
                        {candidate.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                        <span className="text-xs text-muted-foreground">{candidate.unitOfMeasure}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            candidate.ageDays > 90
                              ? 'text-red-500'
                              : candidate.ageDays > 60
                                ? 'text-yellow-500'
                                : 'text-foreground',
                          )}
                        >
                          {candidate.ageDays}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{candidate.location}</TableCell>
                      <TableCell>
                        <span className="text-sm">{candidate.reason}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
