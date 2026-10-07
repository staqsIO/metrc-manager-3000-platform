'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import {
  Search, Columns3, Filter, ArrowUp, ArrowDown, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/shared/components/ui/dropdown-menu'
import PackageLabelLink from '@/features/inventory/components/PackageLabelLink'
import { getAdjustableRows, type ReconciliationRow, type RowStatus } from '@/services/engines/reconciliation-engine'
import AddPackageInput from './AddPackageInput'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterMode = 'all' | 'mismatch' | 'missing_in_metrc' | 'missing_in_external' | 'match'

interface EditingCell {
  label: string
  field: 'externalQuantity' | 'adjustmentReason'
}

const ADJUSTMENT_REASONS = [
  'Inventory Audit',
  'Damaged/Waste',
  'Scale Variance',
  'Received Incorrect Amount',
  'Data Entry Error',
  'Processing Loss',
  'Vendor Credit',
  'Other',
]

const STATUS_CONFIG: Record<RowStatus, { label: string; color: string; borderColor: string }> = {
  match: { label: 'Match', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20', borderColor: '' },
  mismatch: { label: 'Mismatch', color: 'bg-amber-500/10 text-amber-500 border-amber-500/20', borderColor: 'border-l-2 border-l-amber-500' },
  missing_in_metrc: { label: 'Not in Metrc', color: 'bg-red-500/10 text-red-500 border-red-500/20', borderColor: 'border-l-2 border-l-red-500' },
  missing_in_external: { label: 'Not in File', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20', borderColor: '' },
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BulkEditGridProps {
  facilityId: string
  rows: ReconciliationRow[]
  selectedIds: Set<string>
  modifiedCells: Map<string, Set<string>>
  onUpdateCell: (label: string, field: keyof ReconciliationRow, value: unknown) => void
  onToggleRow: (label: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onApplyToSelected: (field: keyof ReconciliationRow, value: unknown) => void
  onPreviewChanges: () => void
  onDiscard: () => void
  onAddRows: (labels: string[]) => void
  showManualEntry?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BulkEditGrid({
  facilityId,
  rows,
  selectedIds,
  modifiedCells,
  onUpdateCell,
  onToggleRow,
  onSelectAll,
  onDeselectAll,
  onApplyToSelected,
  onPreviewChanges,
  onDiscard,
  onAddRows,
  showManualEntry = false,
}: BulkEditGridProps) {
  const [search, setSearch] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [visibleColumns, setVisibleColumns] = useState({
    label: true,
    metrcQuantity: true,
    externalQuantity: true,
    delta: true,
    unitOfMeasure: true,
    adjustmentReason: true,
    status: true,
  })

  const editInputRef = useRef<HTMLInputElement>(null)
  const editSelectRef = useRef<HTMLSelectElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // ---------------------------------------------------------------------------
  // Filtered rows
  // ---------------------------------------------------------------------------

  const filteredRows = useMemo(() => {
    let result = rows

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(r =>
        r.label.toLowerCase().includes(q) ||
        r.itemName.toLowerCase().includes(q),
      )
    }

    if (filterMode !== 'all') {
      result = result.filter(r => r.status === filterMode)
    }

    return result
  }, [rows, search, filterMode])

  // ---------------------------------------------------------------------------
  // Faceted counts
  // ---------------------------------------------------------------------------

  const statusCounts = useMemo(() => {
    const counts: Record<FilterMode, number> = {
      all: rows.length,
      match: 0,
      mismatch: 0,
      missing_in_metrc: 0,
      missing_in_external: 0,
    }
    for (const r of rows) {
      counts[r.status]++
    }
    return counts
  }, [rows])

  // ---------------------------------------------------------------------------
  // Editing handlers
  // ---------------------------------------------------------------------------

  const startEditing = useCallback((label: string, field: 'externalQuantity' | 'adjustmentReason') => {
    const row = rows.find(r => r.label === label)
    if (!row) return

    setEditingCell({ label, field })
    if (field === 'externalQuantity') {
      setEditValue(row.externalQuantity !== null ? String(row.externalQuantity) : '')
    } else {
      setEditValue(row.adjustmentReason)
    }

    // Focus the correct input after render
    requestAnimationFrame(() => {
      if (field === 'externalQuantity') {
        editInputRef.current?.focus()
      } else {
        editSelectRef.current?.focus()
      }
    })
  }, [rows])

  const commitEdit = useCallback(() => {
    if (!editingCell) return

    if (editingCell.field === 'externalQuantity') {
      const parsed = editValue.trim() === '' ? null : parseFloat(editValue)
      if (editValue.trim() !== '' && isNaN(parsed as number)) return // invalid
      onUpdateCell(editingCell.label, 'externalQuantity', parsed)
    } else {
      onUpdateCell(editingCell.label, 'adjustmentReason', editValue)
    }

    setEditingCell(null)
  }, [editingCell, editValue, onUpdateCell])

  const cancelEdit = useCallback(() => {
    setEditingCell(null)
  }, [])

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitEdit()

      // Move to next editable cell in same column, next row
      if (editingCell) {
        const currentIndex = filteredRows.findIndex(r => r.label === editingCell.label)
        if (currentIndex >= 0 && currentIndex < filteredRows.length - 1) {
          const nextRow = filteredRows[currentIndex + 1]!
          requestAnimationFrame(() => startEditing(nextRow.label, editingCell.field))
        }
      }
    } else if (e.key === 'Escape') {
      cancelEdit()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commitEdit()

      // Tab: move to next editable column in same row, or next row
      if (editingCell) {
        if (editingCell.field === 'externalQuantity') {
          requestAnimationFrame(() => startEditing(editingCell.label, 'adjustmentReason'))
        } else {
          // Move to next row's externalQuantity
          const currentIndex = filteredRows.findIndex(r => r.label === editingCell.label)
          if (currentIndex >= 0 && currentIndex < filteredRows.length - 1) {
            const nextRow = filteredRows[currentIndex + 1]!
            requestAnimationFrame(() => startEditing(nextRow.label, 'externalQuantity'))
          }
        }
      }
    }
  }, [editingCell, commitEdit, cancelEdit, filteredRows, startEditing])

  // Shift+Enter: apply current cell value to all selected rows
  const handleShiftEnter = useCallback(() => {
    if (!editingCell) return
    if (editingCell.field === 'externalQuantity') {
      const parsed = editValue.trim() === '' ? null : parseFloat(editValue)
      if (editValue.trim() !== '' && isNaN(parsed as number)) return
      onApplyToSelected('externalQuantity', parsed)
    } else {
      onApplyToSelected('adjustmentReason', editValue)
    }
    setEditingCell(null)
  }, [editingCell, editValue, onApplyToSelected])

  // ---------------------------------------------------------------------------
  // Selection summary
  // ---------------------------------------------------------------------------

  const selectedCount = selectedIds.size
  const selectedRows = useMemo(
    () => rows.filter(r => selectedIds.has(r.label)),
    [rows, selectedIds],
  )
  const adjustableSelected = getAdjustableRows(selectedRows)
  const totalPositiveDelta = selectedRows
    .filter(r => r.delta !== null && r.delta > 0)
    .reduce((sum, r) => sum + r.delta!, 0)
  const totalNegativeDelta = selectedRows
    .filter(r => r.delta !== null && r.delta < 0)
    .reduce((sum, r) => sum + r.delta!, 0)

  const existingLabels = useMemo(() => new Set(rows.map(r => r.label)), [rows])

  const allSelected = rows.length > 0 && selectedIds.size === rows.length

  // ---------------------------------------------------------------------------
  // Column helpers
  // ---------------------------------------------------------------------------

  const isModified = (label: string, field: string) =>
    modifiedCells.get(label)?.has(field) ?? false

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by label or item..."
            className="w-full h-9 pl-8 pr-8 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              Filter
              {filterMode !== 'all' && (
                <Badge variant="outline" className="ml-1 text-[10px]">
                  {statusCounts[filterMode]}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Show</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={filterMode}
              onValueChange={(v) => setFilterMode(v as FilterMode)}
            >
              <DropdownMenuRadioItem value="all">All ({statusCounts.all})</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="mismatch">Mismatches ({statusCounts.mismatch})</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="missing_in_metrc">Missing in Metrc ({statusCounts.missing_in_metrc})</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="missing_in_external">Missing in File ({statusCounts.missing_in_external})</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="match">Matches ({statusCounts.match})</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Columns */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Columns3 className="h-3.5 w-3.5" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Visible Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={visibleColumns.metrcQuantity}
              onCheckedChange={(v) => setVisibleColumns(p => ({ ...p, metrcQuantity: !!v }))}
            >
              Metrc Qty
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={visibleColumns.externalQuantity}
              onCheckedChange={(v) => setVisibleColumns(p => ({ ...p, externalQuantity: !!v }))}
            >
              External Qty
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={visibleColumns.delta}
              onCheckedChange={(v) => setVisibleColumns(p => ({ ...p, delta: !!v }))}
            >
              Delta
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={visibleColumns.unitOfMeasure}
              onCheckedChange={(v) => setVisibleColumns(p => ({ ...p, unitOfMeasure: !!v }))}
            >
              Unit
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={visibleColumns.adjustmentReason}
              onCheckedChange={(v) => setVisibleColumns(p => ({ ...p, adjustmentReason: !!v }))}
            >
              Adjustment Reason
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={visibleColumns.status}
              onCheckedChange={(v) => setVisibleColumns(p => ({ ...p, status: !!v }))}
            >
              Status
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Row count */}
        <span className="text-xs text-muted-foreground ml-auto">
          Showing {filteredRows.length} of {rows.length} packages
        </span>
      </div>

      {/* Grid */}
      <div ref={gridRef} className="card-modern overflow-auto max-h-[60vh]">
        <table className="w-full text-sm" role="grid" aria-label="Reconciliation grid">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
            <tr className="border-b border-border">
              {/* Checkbox */}
              <th className="w-10 p-2 text-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => allSelected ? onDeselectAll() : onSelectAll()}
                  className="h-4 w-4 rounded border-border"
                />
              </th>
              {/* Label — sticky left */}
              {visibleColumns.label && (
                <th className="sticky left-0 bg-muted/80 backdrop-blur-sm p-2 text-left font-medium text-xs text-muted-foreground min-w-[180px]">
                  Package Label
                </th>
              )}
              {visibleColumns.metrcQuantity && (
                <th className="p-2 text-right font-medium text-xs text-muted-foreground w-[100px]">
                  Metrc Qty
                </th>
              )}
              {visibleColumns.externalQuantity && (
                <th className="p-2 text-right font-medium text-xs text-muted-foreground w-[100px]">
                  External Qty
                </th>
              )}
              {visibleColumns.delta && (
                <th className="p-2 text-right font-medium text-xs text-muted-foreground w-[80px]">
                  Delta
                </th>
              )}
              {visibleColumns.unitOfMeasure && (
                <th className="p-2 text-left font-medium text-xs text-muted-foreground w-[100px]">
                  Unit
                </th>
              )}
              {visibleColumns.adjustmentReason && (
                <th className="p-2 text-left font-medium text-xs text-muted-foreground min-w-[160px]">
                  Adjustment Reason
                </th>
              )}
              {visibleColumns.status && (
                <th className="p-2 text-center font-medium text-xs text-muted-foreground w-[100px]">
                  Status
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={Object.values(visibleColumns).filter(Boolean).length + 1}
                  className="p-8 text-center text-muted-foreground"
                >
                  {rows.length === 0
                    ? 'No packages loaded. Upload a file, select from inventory, or add labels manually.'
                    : 'No packages match the current filter.'}
                </td>
              </tr>
            ) : (
              filteredRows.map((row, idx) => {
                const isSelected = selectedIds.has(row.label)
                const statusConf = STATUS_CONFIG[row.status]

                return (
                  <tr
                    key={row.label}
                    className={cn(
                      'border-b border-border/50 transition-colors',
                      statusConf.borderColor,
                      isSelected && 'bg-primary/5',
                      idx % 2 === 1 && !isSelected && 'bg-muted/20',
                    )}
                  >
                    {/* Checkbox */}
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleRow(row.label)}
                        className="h-4 w-4 rounded border-border"
                      />
                    </td>

                    {/* Label */}
                    {visibleColumns.label && (
                      <td className="sticky left-0 bg-inherit p-2">
                        <PackageLabelLink label={row.label} />
                        {row.itemName && (
                          <div className="text-[11px] text-muted-foreground truncate max-w-[170px]">
                            {row.itemName}
                          </div>
                        )}
                      </td>
                    )}

                    {/* Metrc Qty */}
                    {visibleColumns.metrcQuantity && (
                      <td className="p-2 text-right tabular-nums">
                        {row.metrcQuantity !== null
                          ? row.metrcQuantity.toFixed(2)
                          : <span className="text-muted-foreground">--</span>}
                      </td>
                    )}

                    {/* External Qty — editable */}
                    {visibleColumns.externalQuantity && (
                      <td
                        className={cn(
                          'p-2 text-right tabular-nums relative cursor-pointer',
                          isModified(row.label, 'externalQuantity') && 'bg-blue-500/10',
                        )}
                        tabIndex={0}
                        role="gridcell"
                        aria-label={`External quantity for ${row.label}: ${row.externalQuantity ?? 'empty'}`}
                        onClick={() => startEditing(row.label, 'externalQuantity')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            startEditing(row.label, 'externalQuantity')
                          }
                        }}
                      >
                        {editingCell?.label === row.label && editingCell.field === 'externalQuantity' ? (
                          <input
                            ref={editInputRef}
                            type="number"
                            step="0.01"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.shiftKey && e.key === 'Enter') {
                                e.preventDefault()
                                handleShiftEnter()
                              } else {
                                handleEditKeyDown(e)
                              }
                            }}
                            className="w-full h-7 px-1 text-right bg-background border border-primary rounded text-sm focus:outline-none"
                          />
                        ) : (
                          <>
                            {row.externalQuantity !== null
                              ? row.externalQuantity.toFixed(2)
                              : <span className="text-muted-foreground italic text-xs">click to edit</span>}
                            {isModified(row.label, 'externalQuantity') && (
                              <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-blue-500" />
                            )}
                          </>
                        )}
                      </td>
                    )}

                    {/* Delta */}
                    {visibleColumns.delta && (
                      <td className={cn(
                        'p-2 text-right tabular-nums font-medium',
                        row.delta !== null && row.delta > 0 && 'text-emerald-500',
                        row.delta !== null && row.delta < 0 && 'text-red-500',
                        row.delta !== null && Math.abs(row.delta) < 0.01 && 'text-muted-foreground',
                      )}>
                        {row.delta !== null ? (
                          <span className="inline-flex items-center gap-0.5">
                            {row.delta > 0 && <ArrowUp className="h-3 w-3" />}
                            {row.delta < 0 && <ArrowDown className="h-3 w-3" />}
                            {row.delta > 0 ? '+' : ''}{row.delta.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </td>
                    )}

                    {/* Unit */}
                    {visibleColumns.unitOfMeasure && (
                      <td className="p-2 text-xs text-muted-foreground">
                        {row.unitOfMeasure || '--'}
                      </td>
                    )}

                    {/* Adjustment Reason — editable */}
                    {visibleColumns.adjustmentReason && (
                      <td
                        className={cn(
                          'p-2 relative cursor-pointer',
                          isModified(row.label, 'adjustmentReason') && 'bg-blue-500/10',
                        )}
                        tabIndex={0}
                        role="gridcell"
                        aria-label={`Adjustment reason for ${row.label}: ${row.adjustmentReason || 'none selected'}`}
                        onClick={() => startEditing(row.label, 'adjustmentReason')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            startEditing(row.label, 'adjustmentReason')
                          }
                        }}
                      >
                        {editingCell?.label === row.label && editingCell.field === 'adjustmentReason' ? (
                          <select
                            ref={editSelectRef}
                            value={editValue}
                            onChange={(e) => {
                              setEditValue(e.target.value)
                              onUpdateCell(row.label, 'adjustmentReason', e.target.value)
                              setEditingCell(null)
                            }}
                            onBlur={cancelEdit}
                            onKeyDown={(e) => {
                              if (e.shiftKey && e.key === 'Enter') {
                                e.preventDefault()
                                handleShiftEnter()
                              } else if (e.key === 'Escape') {
                                cancelEdit()
                              }
                            }}
                            className="w-full h-7 px-1 bg-background border border-primary rounded text-sm focus:outline-none"
                          >
                            <option value="">Select reason...</option>
                            {ADJUSTMENT_REASONS.map(r => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        ) : (
                          <>
                            {row.adjustmentReason ? (
                              <span className="text-xs">{row.adjustmentReason}</span>
                            ) : (
                              <span className="text-muted-foreground italic text-xs">select reason</span>
                            )}
                            {isModified(row.label, 'adjustmentReason') && (
                              <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-blue-500" />
                            )}
                          </>
                        )}
                      </td>
                    )}

                    {/* Status */}
                    {visibleColumns.status && (
                      <td className="p-2 text-center">
                        <Badge
                          variant="outline"
                          className={cn('text-[10px]', statusConf.color)}
                        >
                          {statusConf.label}
                        </Badge>
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Manual entry input */}
      {showManualEntry && (
        <AddPackageInput
          facilityId={facilityId}
          existingLabels={existingLabels}
          onAdd={onAddRows}
        />
      )}

      {/* Sticky Footer — Bulk Action Bar */}
      {selectedCount > 0 && (
        <div className="sticky bottom-0 z-20 bg-background/95 backdrop-blur border-t border-border px-4 py-3 flex items-center gap-4 rounded-b-lg">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{selectedCount} packages</span>
            <span className="text-xs text-muted-foreground">selected</span>
            {selectedCount < rows.length && (
              <button
                onClick={onSelectAll}
                className="text-xs text-primary hover:underline"
              >
                Select all {rows.length}
              </button>
            )}
          </div>

          <div className="flex-1 text-center text-xs text-muted-foreground">
            {(totalPositiveDelta > 0 || totalNegativeDelta < 0) && (
              <>
                {totalPositiveDelta > 0 && (
                  <span className="text-emerald-500 mr-3">+{totalPositiveDelta.toFixed(2)}</span>
                )}
                {totalNegativeDelta < 0 && (
                  <span className="text-red-500">{totalNegativeDelta.toFixed(2)}</span>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onDiscard}
            >
              Discard
            </Button>
            <Button
              size="sm"
              onClick={onPreviewChanges}
              disabled={adjustableSelected.length === 0}
            >
              Preview Changes
              {adjustableSelected.length > 0 && (
                <Badge variant="outline" className="ml-1.5 text-[10px]">
                  {adjustableSelected.length}
                </Badge>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
