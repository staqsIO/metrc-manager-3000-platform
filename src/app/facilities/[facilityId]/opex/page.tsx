'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FileSpreadsheet, Plus, TrendingUp } from 'lucide-react'
import OpExImportDialog from '@/features/opex/components/OpExImportDialog'

// ---------------------------------------------------------------------------
// Status badge styling
// ---------------------------------------------------------------------------

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
    case 'DRAFT':
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
    case 'ARCHIVED':
      return 'bg-gray-500/10 text-gray-500 border-gray-500/20'
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// KPI formatting
// ---------------------------------------------------------------------------

function formatCurrency(val: number | null): string {
  if (val === null || val === undefined) return '--'
  return '$' + Math.round(val).toLocaleString()
}

function formatPercent(val: number | null): string {
  if (val === null || val === undefined) return '--'
  return val.toFixed(1) + '%'
}

function formatCurrencyPerUnit(val: number | null): string {
  if (val === null || val === undefined) return '--'
  return '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function OpExModelsPage() {
  const params = useParams()
  const router = useRouter()
  const facilityId = params?.facilityId as string

  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)

  const { data: models, isLoading } = trpc.opex.listModels.useQuery(
    { facilityId },
    { enabled: !!facilityId },
  )

  const { data: templateData } = trpc.opex.listTemplates.useQuery(
    { facilityId },
    { enabled: !!facilityId },
  )

  // Auto-select recommended template when data loads
  const templates = templateData?.templates ?? []
  const recommendedId = templateData?.recommendedTemplateId ?? 'cultivator-standard'
  const activeTemplateId = selectedTemplateId ?? recommendedId

  const utils = trpc.useUtils()
  const createMutation = trpc.opex.createModel.useMutation({
    onSuccess: (model) => {
      utils.opex.listModels.invalidate({ facilityId })
      setShowCreate(false)
      setNewName('')
      setNewDescription('')
      router.push(`/facilities/${facilityId}/opex/${model.id}`)
    },
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6" />
            OpEx Calculator
          </h1>
          <p className="text-muted-foreground mt-1">
            Operating expense models for cost analysis and P&L forecasting
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowImport(true)} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Import .xlsx
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Model
          </Button>
        </div>
      </div>

      {/* Model Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card-modern p-6">
              <Skeleton className="h-5 w-48 mb-3" />
              <Skeleton className="h-4 w-32 mb-6" />
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : !models || models.length === 0 ? (
        <div className="card-modern p-12 text-center">
          <TrendingUp className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold mb-1">No OpEx Models</h3>
          <p className="text-muted-foreground text-sm mb-4">
            Create your first operating expense model to begin cost analysis.
          </p>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Create Model
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map((model: { id: string; name: string; status: string; description: string | null; annualRevenue: number | null; annualCost: number | null; costPerPound: number | null; grossMargin: number | null; updatedAt: Date }) => (
            <button
              key={model.id}
              onClick={() => router.push(`/facilities/${facilityId}/opex/${model.id}`)}
              className="card-modern p-6 text-left hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start justify-between mb-1">
                <h3 className="font-semibold truncate pr-2">{model.name}</h3>
                <Badge
                  variant="outline"
                  className={cn('text-xs flex-shrink-0', statusBadgeClass(model.status))}
                >
                  {model.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Updated {new Date(model.updatedAt).toLocaleDateString()}
              </p>

              {/* KPI Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                    Revenue
                  </div>
                  <div className="text-sm font-bold font-mono">
                    {formatCurrency(model.annualRevenue)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                    $/lb
                  </div>
                  <div className="text-sm font-bold font-mono">
                    {formatCurrencyPerUnit(model.costPerPound)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                    Margin
                  </div>
                  <div className={cn(
                    'text-sm font-bold font-mono',
                    model.grossMargin !== null && model.grossMargin >= 40
                      ? 'text-emerald-400'
                      : model.grossMargin !== null && model.grossMargin >= 20
                        ? 'text-yellow-400'
                        : model.grossMargin !== null
                          ? 'text-red-400'
                          : 'text-muted-foreground',
                  )}>
                    {formatPercent(model.grossMargin)}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Create Model Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New OpEx Model</DialogTitle>
            <DialogDescription>
              Select a template and name for your new operating expense model.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Template Selection */}
            {templates.length > 1 && (
              <div>
                <label className="text-sm text-muted-foreground block mb-2">Template</label>
                <div className="grid grid-cols-2 gap-2">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(t.id)}
                      className={cn(
                        'text-left p-3 rounded-lg border text-sm transition-colors',
                        activeTemplateId === t.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted-foreground/30',
                      )}
                    >
                      <p className="font-medium text-xs">{t.name}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{t.description}</p>
                      {t.id === recommendedId && (
                        <span className="text-[9px] text-primary font-medium mt-1 inline-block">Recommended</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Model Name</label>
              <input
                type="text"
                className="w-full p-2 rounded-md border border-border bg-background text-sm"
                placeholder="e.g. Q1 2025 Forecast"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Description (optional)</label>
              <textarea
                className="w-full p-2 rounded-md border border-border bg-background text-sm resize-none"
                placeholder="Brief description of this model..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate({ facilityId, name: newName, description: newDescription || undefined, templateId: activeTemplateId })}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Model'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Spreadsheet Dialog */}
      <OpExImportDialog
        facilityId={facilityId}
        open={showImport}
        onOpenChange={setShowImport}
      />
    </div>
  )
}
