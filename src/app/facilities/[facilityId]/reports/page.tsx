'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/shared/components/ui/table'
import { FileText, Download, Play, Save, Trash2, Package, Wheat, Sprout, Boxes, FlaskConical, Calculator } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReportType } from '@/services/engines/report-engine'
import { REPORT_TYPE_CONFIGS } from '@/services/engines/report-engine'

interface ColumnDef {
  key: string
  label: string
  type: 'string' | 'number' | 'date' | 'boolean'
}

interface ReportRow {
  [key: string]: string | number | boolean | null
}

interface ReportResultData {
  columns: ColumnDef[]
  rows: ReportRow[]
  totalRows: number
  generatedAt: string
}

interface TemplateItem {
  id: string
  name: string
  reportType: string
  columns: ColumnDef[]
  createdAt: string
}

const REPORT_TYPE_TABS: { id: ReportType; icon: typeof Package }[] = [
  { id: 'INVENTORY', icon: Package },
  { id: 'HARVEST', icon: Wheat },
  { id: 'PLANT', icon: Sprout },
  { id: 'SUPPLY', icon: Boxes },
  { id: 'TOLLING', icon: FlaskConical },
  { id: 'OPEX', icon: Calculator },
]

const DEFAULT_COLUMNS: Record<ReportType, string[]> = {
  INVENTORY: ['label', 'itemName', 'itemCategory', 'quantity', 'unitOfMeasure', 'ageDays', 'labTestingState'],
  HARVEST: ['name', 'sourceStrainNames', 'currentWeight', 'totalPackagedWeight', 'harvestStartDate', 'labTestingState', 'ageDays'],
  PLANT: ['label', 'strainName', 'growthPhase', 'locationName', 'plantedDate', 'ageDays'],
  SUPPLY: ['name', 'category', 'currentStock', 'reorderPoint', 'unitCost', 'totalValue', 'stockStatus'],
  TOLLING: ['partnerName', 'agreementType', 'status', 'inputWeight', 'outputWeight', 'actualYieldPct', 'totalFees'],
  OPEX: ['cellKey', 'cellLabel', 'section', 'group', 'cellType', 'value', 'unit'],
}

export default function ReportsPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const [reportType, setReportType] = useState<ReportType>('INVENTORY')
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set(DEFAULT_COLUMNS.INVENTORY))
  const [groupBy, setGroupBy] = useState<string>('')
  const [sortColumn, setSortColumn] = useState<string>('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [result, setResult] = useState<ReportResultData | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [opexModelId, setOpexModelId] = useState<string>('')

  const { data: rawColumns, isLoading: colsLoading } = trpc.reports.availableColumns.useQuery(
    { facilityId, reportType },
    { enabled: !!facilityId },
  )
  const { data: rawTemplates, isLoading: templatesLoading, refetch: refetchTemplates } = trpc.reports.listTemplates.useQuery(
    { facilityId, reportType },
    { enabled: !!facilityId },
  )
  const { data: opexModels } = trpc.opex.listModels.useQuery(
    { facilityId },
    { enabled: !!facilityId && reportType === 'OPEX' },
  )

  const columns = rawColumns as unknown as ColumnDef[] | undefined
  const templates = rawTemplates as unknown as TemplateItem[] | undefined

  const executeMutation = trpc.reports.execute.useMutation()
  const exportMutation = trpc.reports.exportCSV.useMutation()
  const saveMutation = trpc.reports.saveTemplate.useMutation()
  const deleteMutation = trpc.reports.deleteTemplate.useMutation()

  // Reset state when report type changes
  const handleReportTypeChange = (type: ReportType) => {
    setReportType(type)
    setResult(null)
    setGroupBy('')
    setSortColumn('')
    setOpexModelId('')
    setSelectedColumns(new Set(DEFAULT_COLUMNS[type]))
  }

  const toggleColumn = (key: string) => {
    setSelectedColumns(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const getSelectedColumnDefs = (): ColumnDef[] => {
    if (!columns) return []
    return columns.filter(c => selectedColumns.has(c.key))
  }

  const handleRun = async () => {
    const cols = getSelectedColumnDefs()
    if (cols.length === 0) return

    const sortBy = sortColumn ? [{ column: sortColumn, direction: sortDir }] : []
    const groupByArr = groupBy ? [groupBy] : []

    const res = await executeMutation.mutateAsync({
      facilityId,
      reportType,
      modelId: reportType === 'OPEX' && opexModelId ? opexModelId : undefined,
      columns: cols,
      sortBy,
      groupBy: groupByArr,
    })
    setResult(res as unknown as ReportResultData)
  }

  const handleExport = async () => {
    const cols = getSelectedColumnDefs()
    if (cols.length === 0) return

    const sortBy = sortColumn ? [{ column: sortColumn, direction: sortDir }] : []

    const res = await exportMutation.mutateAsync({
      facilityId,
      reportType,
      modelId: reportType === 'OPEX' && opexModelId ? opexModelId : undefined,
      columns: cols,
      sortBy,
    })

    // Download CSV
    const blob = new Blob([res.csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = reportType.toLowerCase() + '-report-' + new Date().toISOString().substring(0, 10) + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSave = async () => {
    if (!templateName.trim()) return
    const cols = getSelectedColumnDefs()
    if (cols.length === 0) return

    await saveMutation.mutateAsync({
      facilityId,
      reportType,
      name: templateName,
      columns: cols,
      groupBy: groupBy ? [groupBy] : [],
      sortBy: sortColumn ? [{ column: sortColumn, direction: sortDir }] : [],
    })
    setTemplateName('')
    refetchTemplates()
  }

  const handleLoadTemplate = (template: TemplateItem) => {
    const colKeys = new Set(template.columns.map(c => c.key))
    setSelectedColumns(colKeys)
  }

  const handleDeleteTemplate = async (templateId: string) => {
    await deleteMutation.mutateAsync({ facilityId, templateId })
    refetchTemplates()
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground mt-1">Custom report builder with export</p>
      </div>

      {/* Report Type Tabs */}
      <div className="flex border-b border-border mb-6 overflow-x-auto">
        {REPORT_TYPE_TABS.map(t => {
          const Icon = t.icon
          const config = REPORT_TYPE_CONFIGS[t.id]
          return (
            <button
              key={t.id}
              onClick={() => handleReportTypeChange(t.id)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 whitespace-nowrap',
                reportType === t.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {config.label}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Column Selector */}
        <div className="lg:col-span-1">
          {/* OpEx Model Selector */}
          {reportType === 'OPEX' && (
            <div className="card-modern p-4 mb-4">
              <h3 className="font-semibold text-sm mb-3">OpEx Model</h3>
              <select
                className="w-full p-2 rounded-md border border-border bg-background text-sm"
                value={opexModelId}
                onChange={(e) => setOpexModelId(e.target.value)}
              >
                <option value="">
                  {(() => {
                    const active = (opexModels ?? []).find((m: { status: string }) => m.status === 'ACTIVE') as { name: string } | undefined
                    return active ? `Active: ${active.name}` : 'Active model'
                  })()}
                </option>
                {(opexModels ?? []).map((m: { id: string; name: string; status: string }) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.status})</option>
                ))}
              </select>
            </div>
          )}

          <div className="card-modern p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Columns</h3>
            {colsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {(columns ?? []).map(col => (
                  <label key={col.key} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={selectedColumns.has(col.key)}
                      onCheckedChange={() => toggleColumn(col.key)}
                    />
                    <span className="text-sm">{col.label}</span>
                    <Badge variant="outline" className="text-xs ml-auto">{col.type}</Badge>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Sort & Group */}
          <div className="card-modern p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Sort By</h3>
            <select
              className="w-full p-2 rounded-md border border-border bg-background text-sm"
              value={sortColumn}
              onChange={(e) => setSortColumn(e.target.value)}
            >
              <option value="">None</option>
              {(columns ?? []).filter(c => selectedColumns.has(c.key)).map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setSortDir('asc')}
                className={cn('flex-1 py-1 text-xs rounded border', sortDir === 'asc' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
              >
                Ascending
              </button>
              <button
                onClick={() => setSortDir('desc')}
                className={cn('flex-1 py-1 text-xs rounded border', sortDir === 'desc' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
              >
                Descending
              </button>
            </div>

            <h3 className="font-semibold text-sm mb-2 mt-4">Group By</h3>
            <select
              className="w-full p-2 rounded-md border border-border bg-background text-sm"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
            >
              <option value="">None</option>
              {(columns ?? []).filter(c => c.type === 'string' && selectedColumns.has(c.key)).map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Saved Templates */}
          <div className="card-modern p-4">
            <h3 className="font-semibold text-sm mb-3">Saved Templates</h3>
            {templatesLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (templates ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No saved templates</p>
            ) : (
              <div className="space-y-2">
                {(templates ?? []).map(t => (
                  <div key={t.id} className="flex items-center justify-between text-sm">
                    <button onClick={() => handleLoadTemplate(t)} className="text-primary hover:underline truncate">
                      {t.name}
                    </button>
                    <button onClick={() => handleDeleteTemplate(t.id)} className="text-muted-foreground hover:text-red-500">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Report Output */}
        <div className="lg:col-span-3">
          {/* Actions */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <Button onClick={handleRun} disabled={executeMutation.isPending || selectedColumns.size === 0} className="gap-2">
              <Play className="h-4 w-4" />
              {executeMutation.isPending ? 'Running...' : 'Run Report'}
            </Button>
            <Button variant="outline" onClick={handleExport} disabled={exportMutation.isPending || selectedColumns.size === 0} className="gap-2">
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <div className="flex gap-2 ml-auto">
              <input
                type="text"
                placeholder="Template name..."
                className="px-3 py-2 rounded-md border border-border bg-background text-sm"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
              <Button variant="outline" onClick={handleSave} disabled={!templateName.trim() || saveMutation.isPending} className="gap-2">
                <Save className="h-4 w-4" />
                Save
              </Button>
            </div>
          </div>

          {/* Results */}
          {result ? (
            <div className="card-modern">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {REPORT_TYPE_CONFIGS[reportType].label} Results ({result.totalRows} rows)
                </h2>
                <span className="text-xs text-muted-foreground">
                  Generated {new Date(result.generatedAt).toLocaleString()}
                </span>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {result.columns.map(c => (
                        <TableHead key={c.key}>{c.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.slice(0, 100).map((row, i) => (
                      <TableRow key={i}>
                        {result.columns.map(c => (
                          <TableCell key={c.key} className={c.type === 'number' ? 'text-right' : ''}>
                            {row[c.key] === null ? '—' :
                              c.type === 'boolean' ? (row[c.key] ? 'Yes' : 'No') :
                              c.type === 'number' ? Number(row[c.key]).toLocaleString() :
                              String(row[c.key])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {result.totalRows > 100 && (
                <div className="p-3 text-center text-xs text-muted-foreground border-t border-border">
                  Showing first 100 of {result.totalRows} rows. Export CSV for full data.
                </div>
              )}
            </div>
          ) : (
            <div className="card-modern p-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">{REPORT_TYPE_CONFIGS[reportType].label} Report</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                {REPORT_TYPE_CONFIGS[reportType].description}. Select columns, configure sorting and grouping, then click Run Report.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
