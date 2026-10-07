'use client'

import { useState, useCallback, useRef, memo } from 'react'
import { useCell, useOpExStore } from '../OpExContext'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, FunctionSquare, Lock } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types for the model data shape from getModel
// ---------------------------------------------------------------------------

interface CellData {
  id: string
  key: string
  label: string
  cellType: string
  dataType: string
  value: number | null
  formula: string | null
  unit: string | null
  precision: number
  tooltip: string | null
  sortOrder: number
}

interface CellGroupData {
  id: string
  label: string
  sortOrder: number
  cells: CellData[]
}

interface ChildSectionData {
  id: string
  name: string
  slug: string
  icon: string | null
  sortOrder: number
  cellGroups: CellGroupData[]
}

interface SectionData {
  id: string
  name: string
  slug: string
  icon: string | null
  sortOrder: number
  children: ChildSectionData[]
  cellGroups: CellGroupData[]
}

export interface OpExCellGridProps {
  facilityId: string
  modelId: string
  sections: SectionData[]
}

// ---------------------------------------------------------------------------
// Value formatting
// ---------------------------------------------------------------------------

function formatCellValue(value: number | null, dataType: string, precision: number): string {
  if (value === null || value === undefined) return '--'
  if (isNaN(value)) return '--'

  switch (dataType) {
    case 'currency':
      return '$' + value.toLocaleString(undefined, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      })
    case 'percent':
      return value.toLocaleString(undefined, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }) + '%'
    default:
      return value.toLocaleString(undefined, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      })
  }
}

// ---------------------------------------------------------------------------
// Single Cell Row (memo'd, uses useCell for surgical re-render)
// ---------------------------------------------------------------------------

interface CellRowProps {
  cell: CellData
  facilityId: string
  modelId: string
}

const CellRow = memo(function CellRow({ cell, facilityId, modelId }: CellRowProps) {
  const store = useOpExStore()
  const cellValue = useCell(cell.key)
  const [localInput, setLocalInput] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const utils = trpc.useUtils()

  const updateCellMutation = trpc.opex.updateCell.useMutation({
    onSuccess: () => {
      utils.opex.getModel.invalidate({ facilityId, modelId })
    },
  })

  const isInput = cell.cellType === 'INPUT'
  const isComputed = cell.cellType === 'COMPUTED'
  const isConstant = cell.cellType === 'CONSTANT'

  const displayValue = cellValue.value
  const hasError = !!cellValue.error

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      setLocalInput(raw)

      const parsed = parseFloat(raw)
      if (!isNaN(parsed)) {
        // Immediately update the local store (instant feedback)
        store.updateValue(cell.key, parsed)

        // Debounce the server mutation
        if (debounceRef.current) {
          clearTimeout(debounceRef.current)
        }
        debounceRef.current = setTimeout(() => {
          const cellId = store.getCellId(cell.key)
          if (cellId) {
            updateCellMutation.mutate({
              facilityId,
              modelId,
              cellId,
              value: parsed,
            })
          }
        }, 500)
      }
    },
    [store, cell.key, facilityId, modelId, updateCellMutation],
  )

  const handleBlur = useCallback(() => {
    setLocalInput(null)
  }, [])

  const handleFocus = useCallback(() => {
    setLocalInput(displayValue !== null ? String(displayValue) : '')
  }, [displayValue])

  return (
    <tr className="border-b border-border/50 hover:bg-accent/30 transition-colors">
      {/* Label */}
      <td className="px-4 py-2.5 text-sm">
        <div className="flex items-center gap-2">
          {isComputed && (
            <FunctionSquare className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
          )}
          {isConstant && (
            <Lock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <span className={cn(
            isComputed && 'text-blue-300',
            isConstant && 'text-muted-foreground',
          )}>
            {cell.label}
          </span>
          {cell.tooltip && (
            <span
              className="text-muted-foreground cursor-help"
              title={cell.tooltip}
            >
              ?
            </span>
          )}
        </div>
      </td>

      {/* Value */}
      <td className="px-4 py-2.5 text-sm text-right">
        {hasError ? (
          <span className="text-red-400 font-mono text-xs">{cellValue.error}</span>
        ) : isInput ? (
          <input
            type="number"
            className="w-32 text-right px-2 py-1 rounded border border-border bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            value={localInput !== null ? localInput : (displayValue !== null ? String(displayValue) : '')}
            onChange={handleChange}
            onBlur={handleBlur}
            onFocus={handleFocus}
            step="any"
          />
        ) : (
          <span className={cn(
            'font-mono',
            isComputed && 'text-blue-300',
            isConstant && 'text-muted-foreground',
          )}>
            {formatCellValue(displayValue, cell.dataType, cell.precision)}
          </span>
        )}
      </td>

      {/* Unit */}
      <td className="px-4 py-2.5 text-xs text-muted-foreground">
        {cell.unit}
      </td>
    </tr>
  )
})

// ---------------------------------------------------------------------------
// Collapsible Cell Group
// ---------------------------------------------------------------------------

interface CellGroupProps {
  group: CellGroupData
  facilityId: string
  modelId: string
}

function CellGroup({ group, facilityId, modelId }: CellGroupProps) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors bg-card/50"
      >
        {expanded
          ? <ChevronDown className="h-3 w-3" />
          : <ChevronRight className="h-3 w-3" />
        }
        {group.label}
        <span className="ml-auto text-[10px] font-normal normal-case tracking-normal">
          {group.cells.length} cells
        </span>
      </button>
      {expanded && (
        <table className="w-full">
          <tbody>
            {group.cells.map((cell) => (
              <CellRow
                key={cell.id}
                cell={cell}
                facilityId={facilityId}
                modelId={modelId}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section Block
// ---------------------------------------------------------------------------

interface SectionBlockProps {
  section: SectionData
  facilityId: string
  modelId: string
}

function SectionBlock({ section, facilityId, modelId }: SectionBlockProps) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div id={`section-${section.slug}`} className="mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground hover:bg-accent/50 transition-colors rounded-t-lg border-b border-border bg-card"
      >
        {expanded
          ? <ChevronDown className="h-4 w-4" />
          : <ChevronRight className="h-4 w-4" />
        }
        {section.name}
      </button>

      {expanded && (
        <div className="border border-t-0 border-border rounded-b-lg overflow-hidden bg-card/30">
          {/* Direct cell groups */}
          {section.cellGroups.map((group) => (
            <CellGroup
              key={group.id}
              group={group}
              facilityId={facilityId}
              modelId={modelId}
            />
          ))}

          {/* Sub-sections */}
          {section.children.map((sub) => (
            <div key={sub.id} id={`section-${sub.slug}`} className="border-t border-border">
              <div className="px-6 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-card/20">
                {sub.name}
              </div>
              {sub.cellGroups.map((group) => (
                <CellGroup
                  key={group.id}
                  group={group}
                  facilityId={facilityId}
                  modelId={modelId}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Grid
// ---------------------------------------------------------------------------

export default function OpExCellGrid({ facilityId, modelId, sections }: OpExCellGridProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      {sections.map((section) => (
        <SectionBlock
          key={section.id}
          section={section}
          facilityId={facilityId}
          modelId={modelId}
        />
      ))}
    </div>
  )
}
