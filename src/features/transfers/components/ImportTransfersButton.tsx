'use client'

import { useState, useCallback, useRef } from 'react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'
import { Badge } from '@/shared/components/ui/badge'
import {
  Upload, FileText, AlertTriangle, CheckCircle2, Loader2,
  ArrowLeft, Trash2, ChevronDown, ChevronRight,
} from 'lucide-react'
import { detectCSVType } from '@/services/import/transfer-csv-parser'

interface ImportTransfersButtonProps {
  facilityId: string
}

type Step = 'upload' | 'preview' | 'importing' | 'complete'

interface PreviewData {
  totalParsed: number
  parseErrors: Array<{ row: number; message: string }>
  matched: number
  unmatched: number
  unmatchedFacilities: Array<{ name: string; license: string; count: number }>
  dateRange: { min: string | null; max: string | null }
  categories: Record<string, number>
  sampleRows: Array<{
    manifest: string
    item: string
    category: string
    shippedQty: number | null
    origin: string
    dest: string
  }>
}

interface CompleteData {
  importBatchId: string
  insertedCount: number
  skippedDuplicates: number
  unmatchedCount: number
}

export function ImportTransfersButton({ facilityId }: ImportTransfersButtonProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('upload')
  const [csvText, setCsvText] = useState('')
  const [csvType, setCsvType] = useState<'affiliated' | 'wholesale'>('affiliated')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [completeData, setCompleteData] = useState<CompleteData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const utils = trpc.useUtils()

  const previewMutation = trpc.transfers.importHistoricalTransfers.useMutation({
    onSuccess: (data) => {
      if (data.status === 'preview') {
        setPreview(data.preview as unknown as PreviewData)
        setStep('preview')
        setError(null)
      }
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  const confirmMutation = trpc.transfers.importHistoricalTransfers.useMutation({
    onSuccess: (data) => {
      if (data.status === 'completed') {
        setCompleteData(data as unknown as CompleteData)
        setStep('complete')
        utils.transfers.getImportHistory.invalidate()
        utils.transfers.getHistoryCount.invalidate()
      }
    },
    onError: (err) => {
      setError(err.message)
      setStep('preview')
    },
  })

  const reset = useCallback(() => {
    setStep('upload')
    setCsvText('')
    setCsvType('affiliated')
    setFileName('')
    setPreview(null)
    setCompleteData(null)
    setError(null)
    setShowErrors(false)
    setShowUnmatched(false)
  }, [])

  const handleOpen = () => {
    reset()
    setOpen(true)
  }

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      reset()
    }
    setOpen(isOpen)
  }

  const handleFileSelect = (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setError('Please select a CSV file')
      return
    }
    setFileName(file.name)
    setError(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setCsvText(text)

      // Auto-detect CSV type
      const detected = detectCSVType(text)
      if (detected) {
        setCsvType(detected)
      }
    }
    reader.onerror = () => {
      setError('Failed to read file')
    }
    reader.readAsText(file)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handlePreview = () => {
    if (!csvText) return
    setError(null)
    previewMutation.mutate({
      facilityId,
      csvText,
      csvType,
      confirmed: false,
    })
  }

  const handleConfirm = () => {
    if (!csvText) return
    setStep('importing')
    setError(null)
    confirmMutation.mutate({
      facilityId,
      csvText,
      csvType,
      confirmed: true,
    })
  }

  const isLoading = previewMutation.isPending || confirmMutation.isPending

  return (
    <>
      <button
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        <Upload className="h-4 w-4" />
        Import CSV
      </button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {step === 'upload' && 'Import Historical Transfers'}
              {step === 'preview' && 'Import Preview'}
              {step === 'importing' && 'Importing...'}
              {step === 'complete' && 'Import Complete'}
            </DialogTitle>
            <DialogDescription>
              {step === 'upload' && 'Upload a Metrc transfer CSV to import historical velocity data for run-rate calculations.'}
              {step === 'preview' && 'Review the parsed data before importing.'}
              {step === 'importing' && 'Writing records to the database...'}
              {step === 'complete' && 'Historical transfer data has been imported successfully.'}
            </DialogDescription>
          </DialogHeader>

          {/* Error Banner */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              {/* Drop Zone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                  csvText
                    ? 'border-emerald-500/50 bg-emerald-500/5'
                    : 'border-border hover:border-primary/50 hover:bg-muted/30'
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFileSelect(file)
                  }}
                />
                {csvText ? (
                  <div className="space-y-2">
                    <FileText className="h-8 w-8 text-emerald-500 mx-auto" />
                    <p className="font-medium text-emerald-500">{fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {(csvText.length / 1024).toFixed(0)} KB &middot; Click to change file
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
                    <p className="font-medium">Drop CSV file here or click to browse</p>
                    <p className="text-xs text-muted-foreground">
                      Supports Metrc affiliated and wholesale transfer exports
                    </p>
                  </div>
                )}
              </div>

              {/* CSV Type Selector */}
              {csvText && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">CSV Type</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCsvType('affiliated')}
                      className={cn(
                        'flex-1 px-3 py-2 rounded-md text-sm font-medium border transition-colors',
                        csvType === 'affiliated'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      Affiliated Transfer
                      <span className="block text-xs font-normal mt-0.5 opacity-70">38 columns, includes package labels</span>
                    </button>
                    <button
                      onClick={() => setCsvType('wholesale')}
                      className={cn(
                        'flex-1 px-3 py-2 rounded-md text-sm font-medium border transition-colors',
                        csvType === 'wholesale'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      Wholesale Transfer
                      <span className="block text-xs font-normal mt-0.5 opacity-70">22 columns, no package labels</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 'preview' && preview && (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">Rows Parsed</p>
                  <p className="text-lg font-bold">{preview.totalParsed.toLocaleString()}</p>
                </div>
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <p className="text-xs text-muted-foreground">Matched</p>
                  <p className="text-lg font-bold text-emerald-500">{preview.matched.toLocaleString()}</p>
                </div>
                <div className={cn(
                  'rounded-md border p-3',
                  preview.unmatched > 0
                    ? 'border-yellow-500/30 bg-yellow-500/5'
                    : 'border-border'
                )}>
                  <p className="text-xs text-muted-foreground">Unmatched</p>
                  <p className={cn('text-lg font-bold', preview.unmatched > 0 && 'text-yellow-500')}>
                    {preview.unmatched.toLocaleString()}
                  </p>
                </div>
                <div className={cn(
                  'rounded-md border p-3',
                  preview.parseErrors.length > 0
                    ? 'border-destructive/30 bg-destructive/5'
                    : 'border-border'
                )}>
                  <p className="text-xs text-muted-foreground">Parse Errors</p>
                  <p className={cn('text-lg font-bold', preview.parseErrors.length > 0 && 'text-destructive')}>
                    {preview.parseErrors.length}
                  </p>
                </div>
              </div>

              {/* Date Range */}
              {preview.dateRange.min && (
                <div className="text-sm text-muted-foreground">
                  Date range: <span className="text-foreground font-medium">{preview.dateRange.min}</span>
                  {' '}&rarr;{' '}
                  <span className="text-foreground font-medium">{preview.dateRange.max}</span>
                </div>
              )}

              {/* Categories */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Categories</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(preview.categories)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, count]) => (
                      <Badge key={cat} variant="outline" className="text-xs">
                        {cat} <span className="ml-1 text-muted-foreground">({count})</span>
                      </Badge>
                    ))}
                </div>
              </div>

              {/* Sample Rows */}
              {preview.sampleRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Sample Rows</p>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/30 border-b border-border">
                          <th className="text-left py-1.5 px-2 font-medium">Manifest</th>
                          <th className="text-left py-1.5 px-2 font-medium">Item</th>
                          <th className="text-left py-1.5 px-2 font-medium">Category</th>
                          <th className="text-right py-1.5 px-2 font-medium">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sampleRows.map((row, i) => (
                          <tr key={i} className="border-b border-border/50">
                            <td className="py-1.5 px-2 font-mono">{row.manifest}</td>
                            <td className="py-1.5 px-2 truncate max-w-[200px]">{row.item}</td>
                            <td className="py-1.5 px-2">{row.category}</td>
                            <td className="py-1.5 px-2 text-right">{row.shippedQty?.toLocaleString() ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Unmatched Facilities (collapsible) */}
              {preview.unmatchedFacilities.length > 0 && (
                <div className="space-y-2">
                  <button
                    onClick={() => setShowUnmatched(!showUnmatched)}
                    className="flex items-center gap-1.5 text-sm font-medium text-yellow-500 hover:text-yellow-400"
                  >
                    {showUnmatched ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    Unmatched Facilities ({preview.unmatchedFacilities.length})
                  </button>
                  {showUnmatched && (
                    <div className="rounded-md border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-1 text-xs">
                      <p className="text-muted-foreground mb-2">
                        These facilities from the CSV don&apos;t match any facility in your organization. Rows referencing only unmatched facilities will be skipped.
                      </p>
                      {preview.unmatchedFacilities.map((f, i) => (
                        <div key={i} className="flex justify-between">
                          <span>{f.name}</span>
                          <span className="text-muted-foreground font-mono">{f.license} ({f.count} rows)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Parse Errors (collapsible) */}
              {preview.parseErrors.length > 0 && (
                <div className="space-y-2">
                  <button
                    onClick={() => setShowErrors(!showErrors)}
                    className="flex items-center gap-1.5 text-sm font-medium text-destructive hover:text-destructive/80"
                  >
                    {showErrors ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    Parse Errors ({preview.parseErrors.length})
                  </button>
                  {showErrors && (
                    <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 space-y-1 text-xs max-h-40 overflow-y-auto">
                      {preview.parseErrors.map((err, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="text-muted-foreground shrink-0">Row {err.row}:</span>
                          <span>{err.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Importing */}
          {step === 'importing' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Importing {preview?.matched.toLocaleString()} records...
              </p>
            </div>
          )}

          {/* Step 4: Complete */}
          {step === 'complete' && completeData && (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-4 gap-2">
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                <p className="text-lg font-semibold">Import Successful</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Inserted</p>
                  <p className="text-lg font-bold text-emerald-500">{completeData.insertedCount.toLocaleString()}</p>
                </div>
                <div className="rounded-md border border-border p-3 text-center">
                  <p className="text-xs text-muted-foreground">Duplicates Skipped</p>
                  <p className="text-lg font-bold">{completeData.skippedDuplicates.toLocaleString()}</p>
                </div>
                <div className="rounded-md border border-border p-3 text-center">
                  <p className="text-xs text-muted-foreground">Unmatched</p>
                  <p className="text-lg font-bold">{completeData.unmatchedCount.toLocaleString()}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Batch ID: <span className="font-mono">{completeData.importBatchId}</span>
              </p>
            </div>
          )}

          {/* Footer Actions */}
          <DialogFooter className="gap-2 sm:gap-0">
            {step === 'upload' && (
              <>
                <button
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePreview}
                  disabled={!csvText || isLoading}
                  className={cn(
                    'px-4 py-2 rounded-md text-sm font-medium transition-colors',
                    csvText && !isLoading
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                  )}
                >
                  {previewMutation.isPending ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Parsing...
                    </span>
                  ) : (
                    'Preview Import'
                  )}
                </button>
              </>
            )}

            {step === 'preview' && (
              <>
                <button
                  onClick={() => { setStep('upload'); setPreview(null); }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!preview || preview.matched === 0 || isLoading}
                  className={cn(
                    'px-4 py-2 rounded-md text-sm font-medium transition-colors',
                    preview && preview.matched > 0 && !isLoading
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                  )}
                >
                  Import {preview?.matched.toLocaleString()} Records
                </button>
              </>
            )}

            {step === 'complete' && (
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Import History Panel (shown on History tab)
// ---------------------------------------------------------------------------

interface ImportHistoryPanelProps {
  facilityId: string
}

interface ImportBatch {
  importBatchId: string
  importSource: string
  rowCount: number
  dataDateRange: { min: string | null; max: string | null }
  importedAt: Date | null
}

export function ImportHistoryPanel({ facilityId }: ImportHistoryPanelProps) {
  const { data: imports, isLoading } = trpc.transfers.getImportHistory.useQuery(
    { facilityId },
    { staleTime: 300_000 },
  )

  const utils = trpc.useUtils()
  const rollbackMutation = trpc.transfers.rollbackImport.useMutation({
    onSuccess: () => {
      utils.transfers.getImportHistory.invalidate()
      utils.transfers.getHistoryCount.invalidate()
    },
  })

  const [confirmRollback, setConfirmRollback] = useState<string | null>(null)

  if (isLoading || !imports || imports.length === 0) return null

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">CSV Imports</h3>
      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Source</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">Rows</th>
              <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Date Range</th>
              <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Imported</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs" />
            </tr>
          </thead>
          <tbody>
            {(imports as ImportBatch[]).map((imp) => (
              <tr key={imp.importBatchId} className="border-b border-border/50">
                <td className="py-2 px-3">
                  <Badge variant="outline" className="text-xs">
                    {imp.importSource === 'csv_affiliated' ? 'Affiliated' : 'Wholesale'}
                  </Badge>
                </td>
                <td className="py-2 px-3 text-right font-medium">{imp.rowCount.toLocaleString()}</td>
                <td className="py-2 px-3 text-xs text-muted-foreground">
                  {imp.dataDateRange.min ?? '?'} &rarr; {imp.dataDateRange.max ?? '?'}
                </td>
                <td className="py-2 px-3 text-xs text-muted-foreground">
                  {imp.importedAt ? new Date(imp.importedAt).toLocaleDateString() : '?'}
                </td>
                <td className="py-2 px-3 text-right">
                  {confirmRollback === imp.importBatchId ? (
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => {
                          rollbackMutation.mutate({ facilityId, importBatchId: imp.importBatchId })
                          setConfirmRollback(null)
                        }}
                        disabled={rollbackMutation.isPending}
                        className="px-2 py-1 rounded text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                      >
                        {rollbackMutation.isPending ? 'Deleting...' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setConfirmRollback(null)}
                        className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRollback(imp.importBatchId)}
                      className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Rollback this import"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
