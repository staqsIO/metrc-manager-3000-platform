'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseXlsxBuffer } from '@/services/engines/opex-import'
import type { ImportResult } from '@/services/engines/opex-import'

interface OpExImportDialogProps {
  facilityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function OpExImportDialog({ facilityId, open, onOpenChange }: OpExImportDialogProps) {
  const router = useRouter()
  const [step, setStep] = useState<'upload' | 'preview'>('upload')
  const [filename, setFilename] = useState('')
  const [modelName, setModelName] = useState('')
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const utils = trpc.useUtils()
  const importMutation = trpc.opex.importModel.useMutation({
    onSuccess: (model) => {
      utils.opex.listModels.invalidate({ facilityId })
      onOpenChange(false)
      resetState()
      router.push('/facilities/' + facilityId + '/opex/' + model.id)
    },
  })

  const resetState = () => {
    setStep('upload')
    setFilename('')
    setModelName('')
    setImportResult(null)
    setParseError(null)
    setIsDragging(false)
  }

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setParseError('Only .xlsx and .xls files are supported')
      return
    }

    setFilename(file.name)
    setModelName(file.name.replace(/\.(xlsx|xls)$/, ''))
    setParseError(null)

    try {
      const buffer = await file.arrayBuffer()
      const result = parseXlsxBuffer(buffer, file.name)

      if (result.errors.length > 0) {
        setParseError(result.errors.join('\n'))
        return
      }

      if (result.stats.totalCells === 0) {
        setParseError('No data cells found in the spreadsheet')
        return
      }

      setImportResult(result)
      setStep('preview')
    } catch (err) {
      setParseError(
        'Failed to parse spreadsheet: ' +
        (err instanceof Error ? err.message : 'Unknown error')
      )
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleImport = () => {
    if (!importResult || !modelName.trim()) return

    importMutation.mutate({
      facilityId,
      name: modelName,
      filename,
      sections: importResult.sections,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetState(); onOpenChange(o) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import Spreadsheet
          </DialogTitle>
          <DialogDescription>
            Upload an .xlsx file to create a new OpEx model from your existing spreadsheet data.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="py-4">
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
                isDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50',
              )}
              onClick={() => document.getElementById('xlsx-upload')?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium mb-1">
                Drop your .xlsx file here or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Supports Excel workbooks (.xlsx)
              </p>
              <input
                id="xlsx-upload"
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>

            {parseError && (
              <div className="mt-3 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{parseError}</span>
              </div>
            )}
          </div>
        )}

        {step === 'preview' && importResult && (
          <div className="py-4 space-y-4">
            {/* Model name */}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Model Name</label>
              <input
                type="text"
                className="w-full p-2 rounded-md border border-border bg-background text-sm"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                maxLength={100}
              />
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-2">
              <div className="p-2 rounded-md bg-card border border-border text-center">
                <div className="text-lg font-bold">{importResult.stats.totalSheets}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Sheets</div>
              </div>
              <div className="p-2 rounded-md bg-card border border-border text-center">
                <div className="text-lg font-bold">{importResult.stats.totalCells}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Cells</div>
              </div>
              <div className="p-2 rounded-md bg-card border border-border text-center">
                <div className="text-lg font-bold">{importResult.stats.inputCells}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Inputs</div>
              </div>
              <div className="p-2 rounded-md bg-card border border-border text-center">
                <div className="text-lg font-bold">{importResult.stats.computedCells}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Formulas</div>
              </div>
            </div>

            {/* Section preview */}
            <div>
              <h4 className="text-sm font-medium mb-2">Sections</h4>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {importResult.sections.map((section) => {
                  const cellCount = section.groups.reduce((sum, g) => sum + g.cells.length, 0)
                  return (
                    <div key={section.slug} className="flex items-center justify-between text-sm px-2 py-1 rounded bg-card/50">
                      <span className="truncate">{section.name}</span>
                      <Badge variant="outline" className="text-xs ml-2">
                        {cellCount} cells
                      </Badge>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Warnings */}
            {importResult.warnings.length > 0 && (
              <div className="p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-yellow-400" />
                  <span className="text-sm font-medium text-yellow-400">
                    {importResult.warnings.length} warning{importResult.warnings.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="max-h-20 overflow-y-auto space-y-0.5">
                  {importResult.warnings.slice(0, 10).map((w, i) => (
                    <p key={i} className="text-xs text-yellow-400/80">{w}</p>
                  ))}
                  {importResult.warnings.length > 10 && (
                    <p className="text-xs text-yellow-400/60">
                      ...and {importResult.warnings.length - 10} more
                    </p>
                  )}
                </div>
              </div>
            )}

            {importResult.stats.skippedFormulas > 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {importResult.stats.skippedFormulas} formulas could not be translated and were imported as static values
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={resetState}>
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={!modelName.trim() || importMutation.isPending}
                className="gap-2"
              >
                {importMutation.isPending ? (
                  'Importing...'
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    Import Model
                  </>
                )}
              </Button>
            </>
          )}
          {step === 'upload' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
