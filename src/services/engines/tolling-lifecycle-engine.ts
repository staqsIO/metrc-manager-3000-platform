/**
 * tolling-lifecycle-engine.ts — Tolling Batch Lifecycle Tracking
 *
 * Computes batch lifecycle status from live Metrc package data by reusing
 * the provenance engine's DAG. Tracks packages from intake through
 * processing, testing, finishing, selling, to commencement (all sold).
 *
 * Key design decision: Packages not found in the active index are treated
 * as sold (they were finished/archived out of the active list). This ensures
 * commencement detection works even when packages drop off.
 */

import type { ProvenanceIndex } from './provenance-engine'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LifecycleStage =
  | 'INTAKE'
  | 'PROCESSING'
  | 'TESTING'
  | 'FINISHED'
  | 'SELLING'
  | 'COMMENCED'

export interface PackageLifecycleInfo {
  label: string
  itemName: string
  category: string
  quantity: number
  unit: string
  labTestingState: string
  packagedDate: string
  finishedDate: string | null
  archivedDate: string | null
  isTerminal: boolean   // No forward edges in DAG (leaf node)
  isSold: boolean       // Quantity===0 OR FinishedDate set OR ArchivedDate set
}

export interface BatchLifecycle {
  batchId: string
  stage: LifecycleStage
  inputPackages: PackageLifecycleInfo[]
  outputPackages: PackageLifecycleInfo[]
  allDescendants: PackageLifecycleInfo[]   // BFS forward from outputs
  totalInputs: number
  totalOutputs: number
  totalDescendants: number
  terminalCount: number
  finishedCount: number
  inTestingCount: number
  soldCount: number
  commencementReady: boolean   // All terminal descendants sold/finished
  commencementPct: number      // % of terminals that are sold
  liveInputWeight: number
  liveOutputWeight: number
  liveYieldPct: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function packageToLifecycleInfo(
  label: string,
  index: ProvenanceIndex,
): PackageLifecycleInfo {
  const pkg = index.packageMap.get(label)

  if (!pkg) {
    // Package not in active index — treat as sold/archived
    return {
      label,
      itemName: 'Archived Package',
      category: 'Unknown',
      quantity: 0,
      unit: 'Unknown',
      labTestingState: 'NotSubmitted',
      packagedDate: '',
      finishedDate: null,
      archivedDate: null,
      isTerminal: true,
      isSold: true, // Not in active list → assumed sold/finished
    }
  }

  const hasChildren = index.forwardEdges.has(label) && index.forwardEdges.get(label)!.size > 0
  const isTerminal = !hasChildren
  const isSold = pkg.Quantity === 0 || pkg.FinishedDate != null || pkg.ArchivedDate != null

  return {
    label: pkg.Label,
    itemName: pkg.ItemName,
    category: pkg.ItemCategory,
    quantity: pkg.Quantity,
    unit: pkg.UnitOfMeasureName,
    labTestingState: pkg.LabTestingState,
    packagedDate: pkg.PackagedDate,
    finishedDate: pkg.FinishedDate,
    archivedDate: pkg.ArchivedDate,
    isTerminal,
    isSold,
  }
}

/**
 * BFS forward from a set of starting labels, collecting all descendants.
 * Returns unique descendant labels (excludes starting labels).
 */
function bfsForward(startLabels: string[], index: ProvenanceIndex): string[] {
  const visited = new Set<string>(startLabels)
  const queue = [...startLabels]
  const descendants: string[] = []

  while (queue.length > 0) {
    const label = queue.shift()!
    const children = index.forwardEdges.get(label)
    if (children) {
      for (const child of Array.from(children)) {
        if (!visited.has(child)) {
          visited.add(child)
          descendants.push(child)
          queue.push(child)
        }
      }
    }
  }

  return descendants
}

// ---------------------------------------------------------------------------
// Main Computation
// ---------------------------------------------------------------------------

/**
 * Compute the lifecycle status of a tolling batch from live Metrc data.
 *
 * @param batchId - The batch database ID
 * @param inputLabels - Metrc package labels linked as inputs
 * @param outputLabels - Metrc package labels linked as outputs
 * @param index - Provenance index built from active packages + harvests
 */
export function computeBatchLifecycle(
  batchId: string,
  inputLabels: string[],
  outputLabels: string[],
  index: ProvenanceIndex,
): BatchLifecycle {
  // Build lifecycle info for inputs and outputs
  const inputPackages = inputLabels.map((l) => packageToLifecycleInfo(l, index))
  const outputPackages = outputLabels.map((l) => packageToLifecycleInfo(l, index))

  // BFS forward from output packages to find all descendants
  const descendantLabels = bfsForward(outputLabels, index)
  const allDescendants = descendantLabels.map((l) => packageToLifecycleInfo(l, index))

  // Combine outputs + descendants for terminal analysis
  const allTerminalCandidates = [...outputPackages, ...allDescendants]
  const terminals = allTerminalCandidates.filter((p) => p.isTerminal)

  const terminalCount = terminals.length
  const soldCount = terminals.filter((p) => p.isSold).length
  const finishedCount = allTerminalCandidates.filter(
    (p) => p.finishedDate != null || p.archivedDate != null,
  ).length
  const inTestingCount = allTerminalCandidates.filter(
    (p) => p.labTestingState === 'TestingInProgress' || p.labTestingState === 'AwaitingConfirmation',
  ).length

  const commencementReady = terminalCount > 0 && soldCount === terminalCount
  const commencementPct = terminalCount > 0
    ? Math.round((soldCount / terminalCount) * 1000) / 10
    : 0

  // Compute live weights from active packages
  const liveInputWeight = inputPackages.reduce((sum, p) => sum + p.quantity, 0)
  const liveOutputWeight = outputPackages.reduce((sum, p) => sum + p.quantity, 0)
  const liveYieldPct = liveInputWeight > 0
    ? Math.round((liveOutputWeight / liveInputWeight) * 1000) / 10
    : 0

  // Determine lifecycle stage
  const stage = determineStage({
    hasOutputs: outputLabels.length > 0,
    commencementReady,
    soldCount,
    terminalCount,
    finishedCount,
    totalCandidates: allTerminalCandidates.length,
    inTestingCount,
  })

  return {
    batchId,
    stage,
    inputPackages,
    outputPackages,
    allDescendants,
    totalInputs: inputLabels.length,
    totalOutputs: outputLabels.length,
    totalDescendants: descendantLabels.length,
    terminalCount,
    finishedCount,
    inTestingCount,
    soldCount,
    commencementReady,
    commencementPct,
    liveInputWeight,
    liveOutputWeight,
    liveYieldPct,
  }
}

// ---------------------------------------------------------------------------
// Stage Determination
// ---------------------------------------------------------------------------

function determineStage(params: {
  hasOutputs: boolean
  commencementReady: boolean
  soldCount: number
  terminalCount: number
  finishedCount: number
  totalCandidates: number
  inTestingCount: number
}): LifecycleStage {
  // 1. No outputs → INTAKE
  if (!params.hasOutputs) return 'INTAKE'

  // 2. All terminals sold → COMMENCED
  if (params.commencementReady) return 'COMMENCED'

  // 3. Some terminals sold → SELLING
  if (params.soldCount > 0) return 'SELLING'

  // 4. All candidates finished → FINISHED
  if (params.totalCandidates > 0 && params.finishedCount === params.totalCandidates) return 'FINISHED'

  // 5. Any in testing → TESTING
  if (params.inTestingCount > 0) return 'TESTING'

  // 6. Otherwise → PROCESSING
  return 'PROCESSING'
}
