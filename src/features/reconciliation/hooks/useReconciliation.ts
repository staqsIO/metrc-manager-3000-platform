'use client'

import { useState, useCallback } from 'react'
import { trpc } from '@/lib/trpc-client'
import type { ReconciliationRow } from '@/services/engines/reconciliation-engine'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReconciliationPhase =
  | 'idle'
  | 'uploading'
  | 'editing'
  | 'previewing'
  | 'executing'
  | 'completed'
  | 'error'

export interface ReconciliationPreviewSummary {
  totalAdjustments: number
  increaseCount: number
  decreaseCount: number
  totalIncrease: number
  totalDecrease: number
  adjustments: {
    label: string
    itemName: string
    currentQuantity: number
    newQuantity: number
    delta: number
    unit: string
    reason: string
  }[]
}

export interface ExecutionResult {
  reconciliationRecordId: string
  successCount: number
  failCount: number
  totalBatches: number
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useReconciliation(facilityId: string) {
  const [phase, setPhase] = useState<ReconciliationPhase>('idle')
  const [rows, setRows] = useState<ReconciliationRow[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [modifiedCells, setModifiedCells] = useState<Map<string, Set<string>>>(new Map())
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [previewSummary, setPreviewSummary] = useState<ReconciliationPreviewSummary | null>(null)
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null)

  const utils = trpc.useUtils()

  const parseAndMatchMutation = trpc.reconciliation.parseAndMatch.useMutation()
  const fetchByLabelsMutation = trpc.reconciliation.fetchByLabels.useMutation()
  const previewMutation = trpc.reconciliation.previewBulkAdjust.useMutation()
  const executeMutation = trpc.reconciliation.executeBulkAdjust.useMutation()

  // ---------------------------------------------------------------------------
  // Entry point: Upload file
  // ---------------------------------------------------------------------------

  const uploadFile = useCallback(async (fileBase64: string, filename: string) => {
    setPhase('uploading')
    setError(null)
    try {
      const result = await parseAndMatchMutation.mutateAsync({
        facilityId,
        fileBase64,
        filename,
      })
      setRows(result.rows as ReconciliationRow[])
      setParseErrors(result.parseErrors)
      setSelectedIds(new Set(
        (result.rows as ReconciliationRow[])
          .filter(r => r.status === 'mismatch')
          .map(r => r.label),
      ))
      setModifiedCells(new Map())
      setPhase('editing')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file')
      setPhase('error')
    }
  }, [facilityId, parseAndMatchMutation])

  // ---------------------------------------------------------------------------
  // Entry point: From Inventory (labels from packages page)
  // ---------------------------------------------------------------------------

  const loadFromLabels = useCallback(async (labels: string[]) => {
    setPhase('uploading')
    setError(null)
    try {
      const result = await fetchByLabelsMutation.mutateAsync({
        facilityId,
        labels,
      })
      setRows(result.rows as ReconciliationRow[])
      setParseErrors([])
      setSelectedIds(new Set(labels))
      setModifiedCells(new Map())
      setPhase('editing')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch packages')
      setPhase('error')
    }
  }, [facilityId, fetchByLabelsMutation])

  // ---------------------------------------------------------------------------
  // Entry point: Manual (start with empty grid)
  // ---------------------------------------------------------------------------

  const startManual = useCallback(() => {
    setRows([])
    setSelectedIds(new Set())
    setModifiedCells(new Map())
    setParseErrors([])
    setError(null)
    setPhase('editing')
  }, [])

  // ---------------------------------------------------------------------------
  // Add rows (for manual entry / adding more packages)
  // ---------------------------------------------------------------------------

  const addRows = useCallback(async (labels: string[]) => {
    const existingLabels = new Set(rows.map(r => r.label))
    const newLabels = labels.filter(l => !existingLabels.has(l))
    if (newLabels.length === 0) return

    try {
      const result = await fetchByLabelsMutation.mutateAsync({
        facilityId,
        labels: newLabels,
      })
      setRows(prev => [...prev, ...(result.rows as ReconciliationRow[])])
      setSelectedIds(prev => {
        const next = new Set(prev)
        newLabels.forEach(l => next.add(l))
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add packages')
    }
  }, [facilityId, rows, fetchByLabelsMutation])

  // ---------------------------------------------------------------------------
  // Cell editing
  // ---------------------------------------------------------------------------

  const updateCell = useCallback((label: string, field: keyof ReconciliationRow, value: unknown) => {
    setRows(prev => prev.map(row => {
      if (row.label !== label) return row

      const updated = { ...row, [field]: value }

      // Recompute delta when externalQuantity changes
      if (field === 'externalQuantity' && updated.metrcQuantity !== null) {
        const extQty = value as number | null
        if (extQty !== null) {
          updated.delta = Math.round((extQty - updated.metrcQuantity) * 100) / 100
          updated.status = Math.abs(updated.delta) < 0.01 ? 'match' : 'mismatch'
        } else {
          updated.delta = null
        }
      }

      return updated
    }))

    // Track modification
    setModifiedCells(prev => {
      const next = new Map(prev)
      const fields = next.get(label) ?? new Set<string>()
      fields.add(field as string)
      next.set(label, fields)
      return next
    })
  }, [])

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  const toggleRow = useCallback((label: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(rows.map(r => r.label)))
  }, [rows])

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  // ---------------------------------------------------------------------------
  // Apply value to selected rows (select-and-fill)
  // ---------------------------------------------------------------------------

  const applyToSelected = useCallback((field: keyof ReconciliationRow, value: unknown) => {
    setRows(prev => prev.map(row => {
      if (!selectedIds.has(row.label)) return row
      const updated = { ...row, [field]: value }

      if (field === 'externalQuantity' && updated.metrcQuantity !== null) {
        const extQty = value as number | null
        if (extQty !== null) {
          updated.delta = Math.round((extQty - updated.metrcQuantity) * 100) / 100
          updated.status = Math.abs(updated.delta) < 0.01 ? 'match' : 'mismatch'
        }
      }

      return updated
    }))

    // Track all as modified
    setModifiedCells(prev => {
      const next = new Map(prev)
      Array.from(selectedIds).forEach(label => {
        const fields = next.get(label) ?? new Set<string>()
        fields.add(field as string)
        next.set(label, fields)
      })
      return next
    })
  }, [selectedIds])

  // ---------------------------------------------------------------------------
  // Preview changes
  // ---------------------------------------------------------------------------

  const previewChanges = useCallback(async () => {
    setPhase('previewing')
    setError(null)
    try {
      const selectedRows = rows.filter(r => selectedIds.has(r.label))
      const result = await previewMutation.mutateAsync({
        facilityId,
        rows: selectedRows,
      })
      setPreviewSummary(result as ReconciliationPreviewSummary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
      setPhase('editing')
    }
  }, [facilityId, rows, selectedIds, previewMutation])

  // ---------------------------------------------------------------------------
  // Execute changes
  // ---------------------------------------------------------------------------

  const executeChanges = useCallback(async () => {
    if (!previewSummary) return
    setPhase('executing')
    setError(null)
    try {
      const selectedRows = rows.filter(r => selectedIds.has(r.label))
      const result = await executeMutation.mutateAsync({
        facilityId,
        rows: selectedRows,
        expectedCount: previewSummary.totalAdjustments,
      })
      setExecutionResult(result as ExecutionResult)
      setPhase('completed')
      utils.reconciliation.listHistory.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed')
      setPhase('error')
    }
  }, [facilityId, rows, selectedIds, previewSummary, executeMutation, utils])

  // ---------------------------------------------------------------------------
  // Navigation helpers
  // ---------------------------------------------------------------------------

  const backToEditing = useCallback(() => {
    setPhase('editing')
    setPreviewSummary(null)
  }, [])

  const discard = useCallback(() => {
    setRows([])
    setSelectedIds(new Set())
    setModifiedCells(new Map())
    setParseErrors([])
    setError(null)
    setPreviewSummary(null)
    setExecutionResult(null)
    setPhase('idle')
  }, [])

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    // State
    phase,
    rows,
    selectedIds,
    modifiedCells,
    parseErrors,
    error,
    previewSummary,
    executionResult,
    isLoading: parseAndMatchMutation.isPending ||
      fetchByLabelsMutation.isPending ||
      previewMutation.isPending ||
      executeMutation.isPending,

    // Entry points
    uploadFile,
    loadFromLabels,
    startManual,

    // Grid actions
    addRows,
    updateCell,
    toggleRow,
    selectAll,
    deselectAll,
    applyToSelected,

    // Flow actions
    previewChanges,
    executeChanges,
    backToEditing,
    discard,
  }
}
