'use client'

import { useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Input } from '@/shared/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { cn } from '@/lib/utils'
import {
  Layers,
  Plus,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Sparkles,
  CheckCircle2,
  XCircle,
  FlaskConical,
  AlertTriangle,
} from 'lucide-react'
import { BOMImportDialog } from '@/features/supply/components/BOMImportDialog'

// ---------------------------------------------------------------------------
// Local type mirrors (avoid deep type instantiation issues)
// ---------------------------------------------------------------------------

interface LocalBOMLine {
  id: string
  metrcItemName: string
  metrcItemCategory: string | null
  componentItemId: string | null
  componentMetrcItemName: string | null
  quantityPerUnit: number
  unit: string
  notes: string | null
  isAutoInferred: boolean
  inferenceConfidence: number | null
  componentItem: {
    id: string
    name: string
    currentStock: number
    unit: string
    unitCost: number | null
  } | null
}

interface LocalBOMSuggestion {
  outputItemName: string
  componentItemName: string
  averageRatio: number
  unit: string
  runCount: number
  confidence: number
}

interface LocalFeasibilityResult {
  metrcItemName: string
  requestedQuantity: number
  maxFeasibleQuantity: number
  isFeasible: boolean
  bottleneckComponent: string | null
  components: Array<{
    componentName: string
    requiredQuantity: number
    availableStock: number
    shortfall: number
    unitCost: number | null
    totalCost: number | null
  }>
  totalMaterialCost: number | null
}

interface LocalSupplyItem {
  id: string
  name: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceLabel(c: number): { label: string; className: string } {
  if (c >= 0.7) return { label: 'High', className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' }
  if (c >= 0.4) return { label: 'Medium', className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' }
  return { label: 'Low', className: 'bg-red-500/10 text-red-400 border-red-500/20' }
}

function getComponentName(line: LocalBOMLine): string {
  return line.componentItem?.name ?? line.componentMetrcItemName ?? 'Unknown'
}

function getSourceBadge(line: LocalBOMLine): { label: string; className: string } {
  if (line.isAutoInferred) return { label: 'Auto-inferred', className: 'bg-purple-500/10 text-purple-400 border-purple-500/20' }
  if (line.componentItem) return { label: 'Supply Item', className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' }
  return { label: 'Metrc Item', className: 'bg-blue-500/10 text-blue-500 border-blue-500/20' }
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function BOMManagementPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const utils = trpc.useUtils()

  // --- State ---
  const [tab, setTab] = useState<'active' | 'suggested' | 'feasibility'>('active')
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showAddBOM, setShowAddBOM] = useState(false)
  const [editingLine, setEditingLine] = useState<LocalBOMLine | null>(null)

  // --- Add BOM form ---
  const [addMetrcItemName, setAddMetrcItemName] = useState('')
  const [addMetrcCategory, setAddMetrcCategory] = useState('')
  const [addComponentItemId, setAddComponentItemId] = useState('')
  const [addComponentMetrcName, setAddComponentMetrcName] = useState('')
  const [addQtyPerUnit, setAddQtyPerUnit] = useState('')
  const [addUnit, setAddUnit] = useState('Each')
  const [addNotes, setAddNotes] = useState('')
  const [addComponentType, setAddComponentType] = useState<'supply' | 'metrc'>('supply')

  // --- Edit form ---
  const [editQty, setEditQty] = useState('')
  const [editUnit, setEditUnit] = useState('')
  const [editNotes, setEditNotes] = useState('')

  // --- Feasibility form ---
  const [feasItemName, setFeasItemName] = useState('')
  const [feasQty, setFeasQty] = useState('')
  const [feasResult, setFeasResult] = useState<LocalFeasibilityResult | null>(null)

  // --- Queries ---
  const { data: rawBOMs, isLoading: bomsLoading } = trpc.supply.listAllBOMs.useQuery(
    { facilityId },
    { enabled: !!facilityId },
  )
  const boms = useMemo(() => (rawBOMs ?? []) as LocalBOMLine[], [rawBOMs])

  const { data: rawInference, isLoading: inferenceLoading } = trpc.supply.inferBOMs.useQuery(
    { facilityId },
    { enabled: !!facilityId && tab === 'suggested' },
  )
  const suggestions = useMemo(() => (rawInference?.suggestions ?? []) as LocalBOMSuggestion[], [rawInference])

  const { data: rawItems } = trpc.supply.listItems.useQuery(
    { facilityId, isActive: true },
    { enabled: !!facilityId },
  )
  const supplyItems = useMemo(() => (rawItems ?? []) as LocalSupplyItem[], [rawItems])

  // --- Mutations ---
  const createBOMMutation = trpc.supply.createBOMLine.useMutation({
    onSuccess: () => {
      utils.supply.listAllBOMs.invalidate()
      resetAddForm()
      setShowAddBOM(false)
    },
  })

  const approveMutation = trpc.supply.approveSuggestedBOM.useMutation({
    onSuccess: () => {
      utils.supply.listAllBOMs.invalidate()
      utils.supply.inferBOMs.invalidate()
    },
  })

  const updateBOMMutation = trpc.supply.updateBOMLine.useMutation({
    onSuccess: () => {
      utils.supply.listAllBOMs.invalidate()
      setEditingLine(null)
    },
  })

  const deleteBOMMutation = trpc.supply.deleteBOMLine.useMutation({
    onSuccess: () => {
      utils.supply.listAllBOMs.invalidate()
    },
  })

  const feasibilityQuery = trpc.supply.checkFeasibility.useQuery(
    { facilityId, metrcItemName: feasItemName, requestedQuantity: parseFloat(feasQty) || 1 },
    { enabled: false },
  )

  // --- Derived data ---
  const groupedBOMs = useMemo(() => {
    const groups = new Map<string, LocalBOMLine[]>()
    for (const bom of boms) {
      const existing = groups.get(bom.metrcItemName)
      if (existing) {
        existing.push(bom)
      } else {
        groups.set(bom.metrcItemName, [bom])
      }
    }
    return groups
  }, [boms])

  const totalBOMs = boms.length
  const itemsCovered = groupedBOMs.size
  const suggestionsCount = suggestions.length

  // --- Handlers ---
  function resetAddForm() {
    setAddMetrcItemName('')
    setAddMetrcCategory('')
    setAddComponentItemId('')
    setAddComponentMetrcName('')
    setAddQtyPerUnit('')
    setAddUnit('Each')
    setAddNotes('')
    setAddComponentType('supply')
  }

  function handleAddBOM() {
    if (addComponentType === 'supply' && addComponentItemId) {
      createBOMMutation.mutate({
        facilityId,
        metrcItemName: addMetrcItemName.trim(),
        metrcItemCategory: addMetrcCategory.trim() || undefined,
        componentItemId: addComponentItemId,
        quantityPerUnit: parseFloat(addQtyPerUnit) || 1,
        unit: addUnit,
        notes: addNotes.trim() || undefined,
      })
    }
  }

  function handleApprove(s: LocalBOMSuggestion) {
    approveMutation.mutate({
      facilityId,
      metrcItemName: s.outputItemName,
      componentMetrcItemName: s.componentItemName,
      quantityPerUnit: s.averageRatio,
      unit: s.unit,
    })
  }

  function openEditDialog(line: LocalBOMLine) {
    setEditingLine(line)
    setEditQty(line.quantityPerUnit.toString())
    setEditUnit(line.unit)
    setEditNotes(line.notes ?? '')
  }

  function handleEditSave() {
    if (!editingLine) return
    updateBOMMutation.mutate({
      facilityId,
      bomLineId: editingLine.id,
      quantityPerUnit: parseFloat(editQty) || undefined,
      unit: editUnit || undefined,
      notes: editNotes.trim() || null,
    })
  }

  async function handleCheckFeasibility() {
    if (!feasItemName.trim() || !feasQty) return
    const result = await feasibilityQuery.refetch()
    if (result.data) {
      setFeasResult(result.data as LocalFeasibilityResult)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6" />
            Bill of Materials
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage component requirements for Metrc items
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowImport(true)} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Import XLSX
          </Button>
          <Button onClick={() => setShowAddBOM(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add BOM
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {bomsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card-modern p-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total BOM Lines</span>
            </div>
            <p className="text-2xl font-bold">{totalBOMs}</p>
          </div>
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Items Covered</span>
            </div>
            <p className="text-2xl font-bold text-emerald-500">{itemsCovered}</p>
          </div>
          <div className="card-modern p-4">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className={cn('h-4 w-4', suggestionsCount > 0 ? 'text-purple-400' : 'text-muted-foreground')} />
              <span className="text-xs text-muted-foreground">Suggestions Available</span>
            </div>
            <p className={cn('text-2xl font-bold', suggestionsCount > 0 ? 'text-purple-400' : '')}>
              {suggestionsCount}
            </p>
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 border-b border-border">
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            tab === 'active' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setTab('active')}
        >
          Active BOMs
        </button>
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2',
            tab === 'suggested' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setTab('suggested')}
        >
          Suggested
          {suggestionsCount > 0 && (
            <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-xs h-5 px-1.5">
              {suggestionsCount}
            </Badge>
          )}
        </button>
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            tab === 'feasibility' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setTab('feasibility')}
        >
          Feasibility Check
        </button>
      </div>

      {/* Tab 1: Active BOMs */}
      {tab === 'active' && (
        bomsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : groupedBOMs.size === 0 ? (
          <div className="card-modern p-12 text-center">
            <Layers className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold mb-1">No Bills of Material</h3>
            <p className="text-muted-foreground text-sm mb-4">
              BOMs define what components are needed to produce each Metrc item. Add them manually, import from a spreadsheet, or check the Suggested tab for auto-inferred BOMs from processing history.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" onClick={() => setTab('suggested')} className="gap-2">
                <Sparkles className="h-4 w-4" />
                View Suggestions
              </Button>
              <Button onClick={() => setShowAddBOM(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Add BOM
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from(groupedBOMs.entries()).map(([itemName, lines]) => (
              <div key={itemName} className="card-modern overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedItem(expandedItem === itemName ? null : itemName)}
                >
                  <div className="flex items-center gap-3">
                    {expandedItem === itemName
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <span className="font-medium">{itemName}</span>
                    {lines[0]?.metrcItemCategory && (
                      <Badge variant="outline" className="text-xs">{lines[0].metrcItemCategory}</Badge>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {lines.length} component{lines.length !== 1 ? 's' : ''}
                  </Badge>
                </button>

                {expandedItem === itemName && (
                  <div className="border-t border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/20">
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Component</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Qty/Unit</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unit</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line) => {
                          const source = getSourceBadge(line)
                          return (
                            <tr key={line.id} className="border-b border-border hover:bg-muted/10">
                              <td className="p-3 font-medium">{getComponentName(line)}</td>
                              <td className="p-3 font-mono text-xs">{line.quantityPerUnit}</td>
                              <td className="p-3 text-muted-foreground text-xs">{line.unit}</td>
                              <td className="p-3">
                                <Badge variant="outline" className={cn('text-xs', source.className)}>
                                  {source.label}
                                </Badge>
                              </td>
                              <td className="p-3">
                                <div className="flex items-center gap-1">
                                  <button
                                    className="h-7 w-7 rounded hover:bg-muted flex items-center justify-center"
                                    onClick={() => openEditDialog(line)}
                                    title="Edit"
                                  >
                                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                  </button>
                                  <button
                                    className="h-7 w-7 rounded hover:bg-muted flex items-center justify-center"
                                    onClick={() => deleteBOMMutation.mutate({ facilityId, bomLineId: line.id })}
                                    title="Delete"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* Tab 2: Suggested */}
      {tab === 'suggested' && (
        inferenceLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="card-modern p-12 text-center">
            <Sparkles className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold mb-1">No Suggestions Available</h3>
            <p className="text-muted-foreground text-sm">
              Auto-inferred BOMs are generated from completed processing history. Process items in Metrc to see suggestions here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s, i) => {
              const conf = confidenceLabel(s.confidence)
              return (
                <div key={i} className="card-modern p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.outputItemName}</span>
                        <span className="text-muted-foreground">needs</span>
                        <span className="font-medium">{s.componentItemName}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="font-mono text-xs">
                          {s.averageRatio} {s.unit} per unit
                        </span>
                        <Badge variant="outline" className={cn('text-xs', conf.className)}>
                          {conf.label} confidence
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {s.runCount} run{s.runCount !== 1 ? 's' : ''} analyzed
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleApprove(s)}
                        disabled={approveMutation.isPending}
                        className="gap-1"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approve
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Tab 3: Feasibility Check */}
      {tab === 'feasibility' && (
        <div className="space-y-4">
          <div className="card-modern p-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-sm text-muted-foreground block mb-1">Metrc Item Name</label>
                <Input
                  placeholder="e.g. Pre-Roll 1g - OG Kush"
                  value={feasItemName}
                  onChange={(e) => setFeasItemName(e.target.value)}
                />
              </div>
              <div className="w-32">
                <label className="text-sm text-muted-foreground block mb-1">Quantity</label>
                <Input
                  type="number"
                  placeholder="100"
                  value={feasQty}
                  onChange={(e) => setFeasQty(e.target.value)}
                />
              </div>
              <Button
                onClick={handleCheckFeasibility}
                disabled={!feasItemName.trim() || !feasQty || feasibilityQuery.isFetching}
                className="gap-2"
              >
                <FlaskConical className="h-4 w-4" />
                {feasibilityQuery.isFetching ? 'Checking...' : 'Check'}
              </Button>
            </div>
          </div>

          {feasResult && (
            <div className="card-modern overflow-hidden">
              <div className={cn(
                'p-4 border-b border-border',
                feasResult.isFeasible ? 'bg-emerald-500/5' : 'bg-red-500/5',
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {feasResult.isFeasible
                      ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      : <XCircle className="h-5 w-5 text-red-500" />}
                    <span className="font-semibold">
                      {feasResult.isFeasible ? 'Feasible' : 'Not Feasible'}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Max producible: <span className="font-mono font-medium text-foreground">{feasResult.maxFeasibleQuantity}</span>
                    {' / '}{feasResult.requestedQuantity} requested
                  </div>
                </div>
                {feasResult.bottleneckComponent && (
                  <div className="flex items-center gap-2 mt-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    <span className="text-muted-foreground">
                      Bottleneck: <span className="font-medium text-foreground">{feasResult.bottleneckComponent}</span>
                    </span>
                  </div>
                )}
                {feasResult.totalMaterialCost != null && (
                  <div className="text-sm text-muted-foreground mt-1">
                    Total material cost: <span className="font-mono font-medium text-emerald-500">
                      ${feasResult.totalMaterialCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>

              {feasResult.components.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Component</th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Required</th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Available</th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Shortfall</th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feasResult.components.map((comp, i) => (
                      <tr
                        key={i}
                        className={cn(
                          'border-b border-border',
                          comp.shortfall > 0 && 'bg-red-500/5',
                          comp.componentName === feasResult.bottleneckComponent && 'bg-yellow-500/5',
                        )}
                      >
                        <td className="p-3 font-medium">{comp.componentName}</td>
                        <td className="p-3 font-mono text-xs">{comp.requiredQuantity}</td>
                        <td className="p-3 font-mono text-xs">{comp.availableStock}</td>
                        <td className="p-3 font-mono text-xs">
                          {comp.shortfall > 0 ? (
                            <span className="text-red-500">-{comp.shortfall}</span>
                          ) : (
                            <span className="text-emerald-500">OK</span>
                          )}
                        </td>
                        <td className="p-3 font-mono text-xs text-muted-foreground">
                          {comp.totalCost != null ? `$${comp.totalCost.toFixed(2)}` : '--'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No BOM defined for this item. Add components in the Active BOMs tab.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Import Dialog */}
      <BOMImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        facilityId={facilityId}
        supplyItems={supplyItems.map((s) => ({ id: s.id, name: s.name }))}
        onSuccess={() => utils.supply.listAllBOMs.invalidate()}
      />

      {/* Add BOM Dialog */}
      <Dialog open={showAddBOM} onOpenChange={setShowAddBOM}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add BOM Line</DialogTitle>
            <DialogDescription>
              Define a component requirement for a Metrc item.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Metrc Item Name *</label>
              <Input
                placeholder="e.g. Pre-Roll 1g - OG Kush"
                value={addMetrcItemName}
                onChange={(e) => setAddMetrcItemName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Category</label>
              <Input
                placeholder="e.g. Flower, Edible, Concentrate"
                value={addMetrcCategory}
                onChange={(e) => setAddMetrcCategory(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Component Type</label>
              <div className="flex gap-2">
                <Button
                  variant={addComponentType === 'supply' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAddComponentType('supply')}
                >
                  Supply Item
                </Button>
                <Button
                  variant={addComponentType === 'metrc' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAddComponentType('metrc')}
                >
                  Metrc Item
                </Button>
              </div>
            </div>
            {addComponentType === 'supply' ? (
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Component Item *</label>
                <Select
                  value={addComponentItemId || 'none'}
                  onValueChange={(v) => setAddComponentItemId(v === 'none' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select supply item" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" disabled>Select item</SelectItem>
                    {supplyItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Metrc Component Name *</label>
                <Input
                  placeholder="e.g. Bulk Flower - OG Kush"
                  value={addComponentMetrcName}
                  onChange={(e) => setAddComponentMetrcName(e.target.value)}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Qty Per Unit *</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 1.5"
                  value={addQtyPerUnit}
                  onChange={(e) => setAddQtyPerUnit(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Unit</label>
                <Select value={addUnit} onValueChange={setAddUnit}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Each">Each</SelectItem>
                    <SelectItem value="Grams">Grams</SelectItem>
                    <SelectItem value="Ounces">Ounces</SelectItem>
                    <SelectItem value="Pounds">Pounds</SelectItem>
                    <SelectItem value="mL">mL</SelectItem>
                    <SelectItem value="L">L</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Notes</label>
              <textarea
                className="w-full p-2 rounded-md border border-border bg-background text-sm resize-none"
                placeholder="Additional notes..."
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddBOM(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddBOM}
              disabled={
                !addMetrcItemName.trim() ||
                (addComponentType === 'supply' && !addComponentItemId) ||
                (addComponentType === 'metrc' && !addComponentMetrcName.trim()) ||
                !addQtyPerUnit ||
                createBOMMutation.isPending
              }
            >
              {createBOMMutation.isPending ? 'Adding...' : 'Add BOM Line'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit BOM Line Dialog */}
      <Dialog open={!!editingLine} onOpenChange={(open) => { if (!open) setEditingLine(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit BOM Line</DialogTitle>
            {editingLine && (
              <DialogDescription>
                Update {getComponentName(editingLine)} for {editingLine.metrcItemName}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Qty Per Unit</label>
              <Input
                type="number"
                step="0.01"
                value={editQty}
                onChange={(e) => setEditQty(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Unit</label>
              <Select value={editUnit} onValueChange={setEditUnit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Each">Each</SelectItem>
                  <SelectItem value="Grams">Grams</SelectItem>
                  <SelectItem value="Ounces">Ounces</SelectItem>
                  <SelectItem value="Pounds">Pounds</SelectItem>
                  <SelectItem value="mL">mL</SelectItem>
                  <SelectItem value="L">L</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Notes</label>
              <textarea
                className="w-full p-2 rounded-md border border-border bg-background text-sm resize-none"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLine(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEditSave}
              disabled={updateBOMMutation.isPending}
            >
              {updateBOMMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
