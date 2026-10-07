'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Input } from '@/shared/components/ui/input'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/lib/utils'
import { GitBranch, GitFork, LayoutGrid, Search, Package, Wheat, ArrowDown, ArrowUp } from 'lucide-react'

// ---------------------------------------------------------------------------
// Local types (mirror to avoid deep type-instantiation errors)
// ---------------------------------------------------------------------------

interface ProvenanceNode {
  label: string
  type: 'package' | 'harvest'
  depth: number
  itemName?: string
  itemCategory?: string
  quantity?: number
  unitOfMeasure?: string
  packagedDate?: string
  labTestingState?: string
  strain?: string
  productionBatch?: string
  harvestName?: string
  harvestType?: string
  sourceStrains?: string
  currentWeight?: number
  harvestStartDate?: string
  finishedDate?: string | null
}

interface ProvenanceEdge {
  from: string
  to: string
  relationship: 'source_package' | 'source_harvest'
}

interface ProvenanceTree {
  targetLabel: string
  nodes: ProvenanceNode[]
  edges: ProvenanceEdge[]
  maxDepth: number
  downstream: ProvenanceNode[]
  downstreamEdges: ProvenanceEdge[]
}

interface ProvenanceStats {
  totalPackages: number
  leafPackages: number
  processingPackages: number
  terminalPackages: number
  avgSourcesPerPackage: number
}

// ---------------------------------------------------------------------------
// Lab testing state badge styles
// ---------------------------------------------------------------------------

const LAB_STATE_STYLES: Record<string, string> = {
  TestPassed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  TestFailed: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
  NotSubmitted: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30',
  AwaitingConfirmation: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
  NotRequired: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
}

function LabStateBadge({ state }: { state: string }) {
  return (
    <Badge className={cn('text-[10px]', LAB_STATE_STYLES[state] ?? LAB_STATE_STYLES.NotSubmitted)}>
      {state}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="p-8 space-y-8">
      <div>
        <Skeleton className="h-7 w-56 mb-2" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="card-modern p-4">
            <Skeleton className="h-4 w-28 mb-2" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-10 w-full max-w-lg" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Node card component
// ---------------------------------------------------------------------------

function NodeCard({
  node,
  isTarget,
}: {
  node: ProvenanceNode
  isTarget: boolean
}) {
  const isHarvest = node.type === 'harvest'

  return (
    <div
      className={cn(
        'card-modern p-4 transition-colors',
        isTarget && 'border-blue-500/50 ring-1 ring-blue-500/20',
        isHarvest && !isTarget && 'border-l-2 border-l-emerald-500',
        !isHarvest && !isTarget && 'border-l-2 border-l-gray-500/40',
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {isHarvest ? (
            <Wheat className="h-4 w-4 shrink-0 text-emerald-500" />
          ) : (
            <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <p className="font-mono text-sm font-semibold truncate">{node.label}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isTarget && (
            <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 text-[10px]">
              Target
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {isHarvest ? 'Harvest' : `Depth ${node.depth}`}
          </Badge>
        </div>
      </div>

      {isHarvest ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-2">
          {node.harvestName && (
            <div>
              <span className="text-xs text-muted-foreground">Name</span>
              <p className="truncate">{node.harvestName}</p>
            </div>
          )}
          {node.harvestType && (
            <div>
              <span className="text-xs text-muted-foreground">Type</span>
              <p>{node.harvestType}</p>
            </div>
          )}
          {node.sourceStrains && (
            <div>
              <span className="text-xs text-muted-foreground">Strains</span>
              <p className="truncate">{node.sourceStrains}</p>
            </div>
          )}
          {node.currentWeight != null && (
            <div>
              <span className="text-xs text-muted-foreground">Weight</span>
              <p>{node.currentWeight.toLocaleString(undefined, { maximumFractionDigits: 2 })} g</p>
            </div>
          )}
          {node.harvestStartDate && (
            <div>
              <span className="text-xs text-muted-foreground">Start Date</span>
              <p>{node.harvestStartDate}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-2">
          {node.itemName && (
            <div>
              <span className="text-xs text-muted-foreground">Item</span>
              <p className="truncate">{node.itemName}</p>
            </div>
          )}
          {node.itemCategory && (
            <div>
              <span className="text-xs text-muted-foreground">Category</span>
              <p className="truncate">{node.itemCategory}</p>
            </div>
          )}
          {node.quantity != null && (
            <div>
              <span className="text-xs text-muted-foreground">Quantity</span>
              <p>
                {node.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                <span className="text-muted-foreground">{node.unitOfMeasure}</span>
              </p>
            </div>
          )}
          {node.packagedDate && (
            <div>
              <span className="text-xs text-muted-foreground">Packaged</span>
              <p>{node.packagedDate}</p>
            </div>
          )}
          {node.strain && (
            <div>
              <span className="text-xs text-muted-foreground">Strain</span>
              <p className="truncate">{node.strain}</p>
            </div>
          )}
          {node.labTestingState && (
            <div>
              <span className="text-xs text-muted-foreground">Lab Testing</span>
              <div className="mt-0.5">
                <LabStateBadge state={node.labTestingState} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Depth-grouped tree renderer
// ---------------------------------------------------------------------------

function DepthSection({
  title,
  icon,
  nodes,
  direction,
}: {
  title: string
  icon: React.ReactNode
  nodes: ProvenanceNode[]
  direction: 'up' | 'down'
}) {
  if (nodes.length === 0) return null

  const maxDepth = Math.max(...nodes.map((n) => n.depth))
  const depthLevels = Array.from({ length: maxDepth }, (_, i) => i + 1)

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        {icon}
        {title}
        <Badge variant="secondary" className="ml-1">{nodes.length}</Badge>
      </h3>

      {depthLevels.map((depth) => {
        const nodesAtDepth = nodes.filter((n) => n.depth === depth)
        if (nodesAtDepth.length === 0) return null

        return (
          <div key={depth}>
            {/* Arrow connector */}
            <div className="flex justify-center py-1">
              {direction === 'up' ? (
                <ArrowUp className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ArrowDown className="h-5 w-5 text-muted-foreground" />
              )}
            </div>

            {/* Depth label */}
            <p className="text-xs text-muted-foreground mb-2">
              {direction === 'up' ? 'Ancestor' : 'Descendant'} depth {depth}
              {' '}({nodesAtDepth.length} node{nodesAtDepth.length !== 1 ? 's' : ''})
            </p>

            {/* Node cards grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {nodesAtDepth.map((node) => (
                <NodeCard key={node.label} node={node} isTarget={false} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tree view components
// ---------------------------------------------------------------------------

const NODE_WIDTH = 192
const NODE_HEIGHT = 72
const COL_GAP = 32
const ROW_GAP = 48

interface LayoutNode {
  label: string
  node: ProvenanceNode
  isTarget: boolean
  x: number
  y: number
}

function computeTreeLayout(
  ancestors: ProvenanceNode[],
  target: ProvenanceNode | undefined,
  downstream: ProvenanceNode[],
): { nodes: LayoutNode[]; width: number; height: number } {
  if (!target) return { nodes: [], width: 0, height: 0 }

  // Group ancestors by depth (higher depth = further from target = displayed first)
  const maxAncestorDepth = ancestors.length > 0 ? Math.max(...ancestors.map((n) => n.depth)) : 0
  const ancestorRows: ProvenanceNode[][] = []
  for (let d = maxAncestorDepth; d >= 1; d--) {
    const row = ancestors.filter((n) => n.depth === d)
    if (row.length > 0) ancestorRows.push(row)
  }

  // Group downstream by depth
  const maxDownDepth = downstream.length > 0 ? Math.max(...downstream.map((n) => n.depth)) : 0
  const downRows: ProvenanceNode[][] = []
  for (let d = 1; d <= maxDownDepth; d++) {
    const row = downstream.filter((n) => n.depth === d)
    if (row.length > 0) downRows.push(row)
  }

  // All rows: ancestors (top) → target (middle) → downstream (bottom)
  const allRows: { nodes: ProvenanceNode[]; isTarget: boolean }[] = [
    ...ancestorRows.map((row) => ({ nodes: row, isTarget: false })),
    { nodes: [target], isTarget: true },
    ...downRows.map((row) => ({ nodes: row, isTarget: false })),
  ]

  const maxCols = Math.max(...allRows.map((r) => r.nodes.length))
  const totalWidth = maxCols * NODE_WIDTH + (maxCols - 1) * COL_GAP
  const totalHeight = allRows.length * NODE_HEIGHT + (allRows.length - 1) * ROW_GAP

  const layoutNodes: LayoutNode[] = []

  allRows.forEach((row, rowIdx) => {
    const rowWidth = row.nodes.length * NODE_WIDTH + (row.nodes.length - 1) * COL_GAP
    const offsetX = (totalWidth - rowWidth) / 2
    const y = rowIdx * (NODE_HEIGHT + ROW_GAP)

    row.nodes.forEach((node, colIdx) => {
      layoutNodes.push({
        label: node.label,
        node,
        isTarget: row.isTarget,
        x: offsetX + colIdx * (NODE_WIDTH + COL_GAP),
        y,
      })
    })
  })

  return { nodes: layoutNodes, width: totalWidth, height: totalHeight }
}

function TreeNodeCard({ layoutNode }: { layoutNode: LayoutNode }) {
  const { node, isTarget } = layoutNode
  const isHarvest = node.type === 'harvest'

  return (
    <div
      className={cn(
        'absolute rounded-lg border bg-card px-3 py-2 text-xs transition-colors',
        isTarget && 'border-blue-500/50 ring-1 ring-blue-500/20',
        isHarvest && !isTarget && 'border-l-2 border-l-emerald-500',
        !isHarvest && !isTarget && 'border-l-2 border-l-gray-500/40',
      )}
      style={{
        left: layoutNode.x,
        top: layoutNode.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {isHarvest ? (
          <Wheat className="h-3 w-3 shrink-0 text-emerald-500" />
        ) : (
          <Package className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="font-mono font-semibold truncate">{node.label}</span>
        {isTarget && (
          <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 text-[9px] ml-auto px-1 py-0">
            Target
          </Badge>
        )}
      </div>
      <div className="truncate text-muted-foreground">
        {isHarvest ? (node.harvestName ?? node.sourceStrains ?? 'Harvest') : (node.itemName ?? 'Package')}
      </div>
      {node.quantity != null && (
        <div className="text-muted-foreground">
          {node.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} {node.unitOfMeasure ?? 'g'}
        </div>
      )}
      {isHarvest && node.currentWeight != null && (
        <div className="text-muted-foreground">
          {node.currentWeight.toLocaleString(undefined, { maximumFractionDigits: 2 })} g
        </div>
      )}
    </div>
  )
}

function TreeEdges({
  layoutNodes,
  edges,
  downstreamEdges,
  width,
  height,
}: {
  layoutNodes: LayoutNode[]
  edges: ProvenanceEdge[]
  downstreamEdges: ProvenanceEdge[]
  width: number
  height: number
}) {
  const nodeMap = new Map(layoutNodes.map((n) => [n.label, n]))
  const allEdges = [...edges, ...downstreamEdges]

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={width}
      height={height}
      style={{ overflow: 'visible' }}
    >
      {allEdges.map((edge, i) => {
        const from = nodeMap.get(edge.from)
        const to = nodeMap.get(edge.to)
        if (!from || !to) return null

        const x1 = from.x + NODE_WIDTH / 2
        const y1 = from.y + NODE_HEIGHT
        const x2 = to.x + NODE_WIDTH / 2
        const y2 = to.y
        const midY = (y1 + y2) / 2

        return (
          <path
            key={i}
            d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={1.5}
            strokeDasharray={edge.relationship === 'source_harvest' ? '6 4' : undefined}
          />
        )
      })}
    </svg>
  )
}

function ProvenanceTreeView({
  ancestors,
  target,
  downstream,
  edges,
  downstreamEdges,
}: {
  ancestors: ProvenanceNode[]
  target: ProvenanceNode | undefined
  downstream: ProvenanceNode[]
  edges: ProvenanceEdge[]
  downstreamEdges: ProvenanceEdge[]
}) {
  const { nodes: layoutNodes, width, height } = computeTreeLayout(
    ancestors,
    target,
    downstream,
  )

  if (layoutNodes.length === 0) return null

  return (
    <div className="overflow-x-auto pb-4">
      <div className="relative" style={{ width, height, minWidth: width }}>
        <TreeEdges
          layoutNodes={layoutNodes}
          edges={edges}
          downstreamEdges={downstreamEdges}
          width={width}
          height={height}
        />
        {layoutNodes.map((ln) => (
          <TreeNodeCard key={ln.label} layoutNode={ln} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ProvenancePage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const [searchValue, setSearchValue] = useState('')
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'tree'>('grid')

  // -- Stats query (always fetched) ----------------------------------------
  const { data: rawStats, isLoading: statsLoading } =
    trpc.packages.provenanceStats.useQuery(
      { facilityId },
      { enabled: !!facilityId, staleTime: 300_000 },
    )
  const stats = rawStats as unknown as ProvenanceStats | undefined

  // -- Provenance tree query (fetched when label is set) --------------------
  const { data: rawTree, isLoading: treeLoading, error: treeError } =
    trpc.packages.provenance.useQuery(
      { facilityId, packageLabel: activeLabel ?? '' },
      { enabled: !!facilityId && !!activeLabel, staleTime: 300_000 },
    )
  const tree = rawTree as unknown as ProvenanceTree | undefined

  // -- Handlers ------------------------------------------------------------
  const handleSearch = () => {
    const trimmed = searchValue.trim()
    if (trimmed) {
      setActiveLabel(trimmed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  // -- Loading state -------------------------------------------------------
  if (statsLoading) {
    return <LoadingSkeleton />
  }

  // -- Extract tree sections -----------------------------------------------
  const targetNode = tree?.nodes.find((n) => n.depth === 0)
  const ancestors = tree?.nodes.filter((n) => n.depth > 0) ?? []
  const downstream = tree?.downstream ?? []

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitBranch className="h-6 w-6" />
          Package Provenance
        </h1>
        <p className="text-muted-foreground mt-1">
          Trace package lineage from harvest to final product
        </p>
      </div>

      {/* ---- Stats Cards ---- */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-4 w-4 text-foreground" />
            <span className="text-xs text-muted-foreground">Total Packages</span>
          </div>
          <p className="text-2xl font-bold">
            {(stats?.totalPackages ?? 0).toLocaleString()}
          </p>
        </div>

        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wheat className="h-4 w-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground">Leaf Packages</span>
          </div>
          <p className="text-2xl font-bold text-emerald-500">
            {(stats?.leafPackages ?? 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Raw from harvest</p>
        </div>

        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <GitBranch className="h-4 w-4 text-blue-500" />
            <span className="text-xs text-muted-foreground">Processing</span>
          </div>
          <p className="text-2xl font-bold text-blue-500">
            {(stats?.processingPackages ?? 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Derived from others</p>
        </div>

        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-4 w-4 text-yellow-500" />
            <span className="text-xs text-muted-foreground">Terminal</span>
          </div>
          <p className="text-2xl font-bold text-yellow-500">
            {(stats?.terminalPackages ?? 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">No children</p>
        </div>

        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <GitBranch className="h-4 w-4 text-purple-500" />
            <span className="text-xs text-muted-foreground">Avg Sources/Pkg</span>
          </div>
          <p className="text-2xl font-bold text-purple-500">
            {(stats?.avgSourcesPerPackage ?? 0).toFixed(1)}
          </p>
        </div>
      </div>

      {/* ---- Search ---- */}
      <div className="flex gap-2 mb-8 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Enter package label..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-9"
          />
        </div>
        <Button onClick={handleSearch} disabled={!searchValue.trim()}>
          Trace
        </Button>
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'px-2.5 py-2 transition-colors',
              viewMode === 'grid'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:text-foreground',
            )}
            title="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('tree')}
            className={cn(
              'px-2.5 py-2 transition-colors',
              viewMode === 'tree'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:text-foreground',
            )}
            title="Tree view"
          >
            <GitFork className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ---- Tree loading ---- */}
      {treeLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      )}

      {/* ---- Tree error ---- */}
      {treeError && (
        <div className="card-modern p-6 border-red-500/30 text-center">
          <p className="text-red-500 font-medium mb-1">Error loading provenance</p>
          <p className="text-sm text-muted-foreground">{treeError.message}</p>
        </div>
      )}

      {/* ---- No results ---- */}
      {activeLabel && !treeLoading && !treeError && tree && tree.nodes.length === 0 && (
        <div className="card-modern p-12 text-center">
          <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">
            No package found with label <span className="font-mono font-semibold text-foreground">{activeLabel}</span>
          </p>
        </div>
      )}

      {/* ---- Provenance tree ---- */}
      {tree && tree.nodes.length > 0 && !treeLoading && (
        <div className="space-y-8">
          {viewMode === 'grid' && (
            <>
              {/* Upstream ancestors */}
              <DepthSection
                title="Upstream (Ancestors)"
                icon={<ArrowUp className="h-5 w-5 text-emerald-500" />}
                nodes={ancestors}
                direction="up"
              />

              {/* Target package */}
              {targetNode && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Target package</p>
                  <div className="max-w-xl">
                    <NodeCard node={targetNode} isTarget={true} />
                  </div>
                </div>
              )}

              {/* Downstream children */}
              <DepthSection
                title="Downstream (Children)"
                icon={<ArrowDown className="h-5 w-5 text-blue-500" />}
                nodes={downstream}
                direction="down"
              />
            </>
          )}

          {viewMode === 'tree' && (
            <ProvenanceTreeView
              ancestors={ancestors}
              target={targetNode}
              downstream={downstream}
              edges={tree.edges}
              downstreamEdges={tree.downstreamEdges}
            />
          )}

          {/* Summary footer */}
          {(ancestors.length > 0 || downstream.length > 0) && (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Lineage depth: {tree.maxDepth} level{tree.maxDepth !== 1 ? 's' : ''} upstream,{' '}
              {downstream.length > 0
                ? `${Math.max(...downstream.map((n) => n.depth))} level${Math.max(...downstream.map((n) => n.depth)) !== 1 ? 's' : ''} downstream`
                : 'no downstream nodes'}
              . Total nodes: {tree.nodes.length} upstream + {downstream.length} downstream.
            </div>
          )}
        </div>
      )}

      {/* ---- Empty state (no search yet) ---- */}
      {!activeLabel && !treeLoading && (
        <div className="card-modern p-12 text-center">
          <GitBranch className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-2">Trace Package Lineage</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            Enter a package label above to trace its full provenance chain --
            from source harvests through all processing steps to final products.
          </p>
        </div>
      )}
    </div>
  )
}
