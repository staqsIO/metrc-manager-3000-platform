/**
 * provenance-engine.ts — Package Provenance DAG Engine
 *
 * Builds an in-memory adjacency list from package SourcePackageLabels
 * and provides BFS traversal to reconstruct full lineage trees.
 *
 * Complexity: O(N) to build adjacency list, O(V+E) per provenance query
 * where V = lineage chain length (typically 3-6), E = edges between them.
 */

import type { MetrcPackage, MetrcHarvest } from '../metrc/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProvenanceNode {
  label: string
  type: 'package' | 'harvest'
  depth: number // 0 = target package, 1 = immediate parent, etc.
  // Package fields (when type === 'package')
  itemName?: string
  itemCategory?: string
  quantity?: number
  unitOfMeasure?: string
  packagedDate?: string
  labTestingState?: string
  strain?: string
  productionBatch?: string
  // Harvest fields (when type === 'harvest')
  harvestName?: string
  harvestType?: string
  sourceStrains?: string
  currentWeight?: number
  harvestStartDate?: string
  finishedDate?: string | null
}

export interface ProvenanceEdge {
  from: string // parent label (or harvest name)
  to: string // child label
  relationship: 'source_package' | 'source_harvest'
}

export interface ProvenanceTree {
  targetLabel: string
  nodes: ProvenanceNode[]
  edges: ProvenanceEdge[]
  maxDepth: number
  // Downstream: packages that were created FROM this package
  downstream: ProvenanceNode[]
  downstreamEdges: ProvenanceEdge[]
}

// ---------------------------------------------------------------------------
// Adjacency List Builder
// ---------------------------------------------------------------------------

export interface ProvenanceIndex {
  /** parent label -> child labels (forward: parent was used to create children) */
  forwardEdges: Map<string, Set<string>>
  /** child label -> parent labels (backward: child was created from parents) */
  backwardEdges: Map<string, Set<string>>
  /** child label -> harvest names */
  harvestSources: Map<string, Set<string>>
  /** label -> package data */
  packageMap: Map<string, MetrcPackage>
  /** harvest name -> harvest data */
  harvestMap: Map<string, MetrcHarvest>
}

/**
 * Build the provenance index from a list of packages and harvests.
 * Call this once when packages are loaded (e.g., on page load or sync).
 * O(N) where N = total packages.
 */
export function buildProvenanceIndex(
  packages: MetrcPackage[],
  harvests: MetrcHarvest[] = [],
): ProvenanceIndex {
  const forwardEdges = new Map<string, Set<string>>()
  const backwardEdges = new Map<string, Set<string>>()
  const harvestSources = new Map<string, Set<string>>()
  const packageMap = new Map<string, MetrcPackage>()
  const harvestMap = new Map<string, MetrcHarvest>()

  for (const pkg of packages) {
    packageMap.set(pkg.Label, pkg)
  }

  for (const h of harvests) {
    harvestMap.set(h.Name, h)
  }

  for (const pkg of packages) {
    if (pkg.SourcePackageLabels) {
      const parentLabels = pkg.SourcePackageLabels
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      for (const parentLabel of parentLabels) {
        if (!backwardEdges.has(pkg.Label)) {
          backwardEdges.set(pkg.Label, new Set())
        }
        backwardEdges.get(pkg.Label)!.add(parentLabel)

        if (!forwardEdges.has(parentLabel)) {
          forwardEdges.set(parentLabel, new Set())
        }
        forwardEdges.get(parentLabel)!.add(pkg.Label)
      }
    }

    if (pkg.SourceHarvestNames) {
      const harvestNames = pkg.SourceHarvestNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      if (!harvestSources.has(pkg.Label)) {
        harvestSources.set(pkg.Label, new Set())
      }
      for (const hName of harvestNames) {
        harvestSources.get(pkg.Label)!.add(hName)
      }
    }
  }

  return { forwardEdges, backwardEdges, harvestSources, packageMap, harvestMap }
}

// ---------------------------------------------------------------------------
// BFS Provenance Traversal
// ---------------------------------------------------------------------------

/**
 * Get the full provenance tree for a package.
 * BFS backward through parents, BFS forward through children.
 * O(V+E) where V = nodes in lineage, E = edges.
 */
export function getProvenance(
  targetLabel: string,
  index: ProvenanceIndex,
): ProvenanceTree {
  const nodes: ProvenanceNode[] = []
  const edges: ProvenanceEdge[] = []
  const visited = new Set<string>()
  let maxDepth = 0

  const targetPkg = index.packageMap.get(targetLabel)
  if (targetPkg) {
    nodes.push(packageToNode(targetPkg, 0))
    visited.add(targetLabel)
  }

  // BFS backward (ancestors)
  const queue: Array<{ label: string; depth: number }> = [{ label: targetLabel, depth: 0 }]

  while (queue.length > 0) {
    const { label, depth } = queue.shift()!

    const parents = index.backwardEdges.get(label)
    if (parents) {
      for (const parentLabel of Array.from(parents)) {
        if (!visited.has(parentLabel)) {
          visited.add(parentLabel)
          const parentPkg = index.packageMap.get(parentLabel)
          const parentDepth = depth + 1
          if (parentDepth > maxDepth) maxDepth = parentDepth

          if (parentPkg) {
            nodes.push(packageToNode(parentPkg, parentDepth))
          } else {
            nodes.push({
              label: parentLabel,
              type: 'package',
              depth: parentDepth,
              itemName: 'Archived Package',
              itemCategory: 'Unknown',
            })
          }
          edges.push({ from: parentLabel, to: label, relationship: 'source_package' })
          queue.push({ label: parentLabel, depth: parentDepth })
        } else {
          if (!edges.some((e) => e.from === parentLabel && e.to === label)) {
            edges.push({ from: parentLabel, to: label, relationship: 'source_package' })
          }
        }
      }
    }

    const harvests = index.harvestSources.get(label)
    if (harvests) {
      for (const hName of Array.from(harvests)) {
        const harvestKey = 'harvest:' + hName
        if (!visited.has(harvestKey)) {
          visited.add(harvestKey)
          const harvestData = index.harvestMap.get(hName)
          const hDepth = depth + 1
          if (hDepth > maxDepth) maxDepth = hDepth

          nodes.push(harvestToNode(hName, harvestData, hDepth))
          edges.push({ from: hName, to: label, relationship: 'source_harvest' })
        }
      }
    }
  }

  // BFS forward (downstream / children)
  const downstream: ProvenanceNode[] = []
  const downstreamEdges: ProvenanceEdge[] = []
  const downVisited = new Set<string>([targetLabel])
  const downQueue: Array<{ label: string; depth: number }> = [{ label: targetLabel, depth: 0 }]

  while (downQueue.length > 0) {
    const { label, depth } = downQueue.shift()!
    const children = index.forwardEdges.get(label)
    if (children) {
      for (const childLabel of Array.from(children)) {
        if (!downVisited.has(childLabel)) {
          downVisited.add(childLabel)
          const childPkg = index.packageMap.get(childLabel)
          const childDepth = depth + 1

          if (childPkg) {
            downstream.push(packageToNode(childPkg, childDepth))
          } else {
            downstream.push({
              label: childLabel,
              type: 'package',
              depth: childDepth,
              itemName: 'Archived Package',
            })
          }
          downstreamEdges.push({ from: label, to: childLabel, relationship: 'source_package' })
          downQueue.push({ label: childLabel, depth: childDepth })
        }
      }
    }
  }

  return { targetLabel, nodes, edges, maxDepth, downstream, downstreamEdges }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function packageToNode(pkg: MetrcPackage, depth: number): ProvenanceNode {
  return {
    label: pkg.Label,
    type: 'package',
    depth,
    itemName: pkg.ItemName,
    itemCategory: pkg.ItemCategory,
    quantity: pkg.Quantity,
    unitOfMeasure: pkg.UnitOfMeasureName,
    packagedDate: pkg.PackagedDate,
    labTestingState: pkg.LabTestingState,
    strain: pkg.ItemStrainName,
    productionBatch: pkg.ProductionBatchNumber,
  }
}

function harvestToNode(name: string, harvest: MetrcHarvest | undefined, depth: number): ProvenanceNode {
  return {
    label: name,
    type: 'harvest',
    depth,
    harvestName: name,
    harvestType: harvest?.HarvestType,
    sourceStrains: harvest?.SourceStrainNames,
    currentWeight: harvest?.CurrentWeight,
    harvestStartDate: harvest?.HarvestStartDate,
    finishedDate: harvest?.FinishedDate,
  }
}

// ---------------------------------------------------------------------------
// Utility: Get stats about the provenance index
// ---------------------------------------------------------------------------

export interface ProvenanceStats {
  totalPackages: number
  leafPackages: number
  processingPackages: number
  terminalPackages: number
  avgSourcesPerPackage: number
}

export function getProvenanceStats(index: ProvenanceIndex): ProvenanceStats {
  let leafCount = 0
  let processingCount = 0
  let terminalCount = 0
  let totalSources = 0

  for (const [label] of Array.from(index.packageMap)) {
    const hasParents = index.backwardEdges.has(label) && index.backwardEdges.get(label)!.size > 0
    const hasChildren = index.forwardEdges.has(label) && index.forwardEdges.get(label)!.size > 0

    if (!hasParents) leafCount++
    if (hasParents) {
      processingCount++
      totalSources += index.backwardEdges.get(label)!.size
    }
    if (!hasChildren) terminalCount++
  }

  return {
    totalPackages: index.packageMap.size,
    leafPackages: leafCount,
    processingPackages: processingCount,
    terminalPackages: terminalCount,
    avgSourcesPerPackage: processingCount > 0 ? totalSources / processingCount : 0,
  }
}
