'use client'

import { useState, useCallback } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { parseBOMXlsx } from '@/services/engines/bom-import'
import type { BOMImportLine, BOMImportResult } from '@/services/engines/bom-import'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SupplyItemRef {
  id: string
  name: string
}

interface ResolvedLine extends BOMImportLine {
  matchedSupplyItemId: string | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BOMImportDialog({
  open,
  onOpenChange,
  facilityId,
  supplyItems,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  facilityId: string
  supplyItems: SupplyItemRef[]
  onSuccess: () => void
}) {
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload')
  const [parseResult, setParseResult] = useState<BOMImportResult | null>(null)
  const [resolvedLines, setResolvedLines] = useState<ResolvedLine[]>([])
  const [importResult, setImportResult] = useState<{ created: number; total: number } | null>(null)

  const bulkCreate = trpc.supply.bulkCreateBOMLines.useMutation({
    onSuccess: (data) => {
      setImportResult(data)
      setStep('done')
      onSuccess()
    },
  })

  const reset = useCallback(() => {
    setStep('upload')
    setParseResult(null)
    setResolvedLines([])
    setImportResult(null)
  }, [])

  const handleClose = useCallback((open: boolean) => {
    if (!open) reset()
    onOpenChange(open)
  }, [onOpenChange, reset])

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      const buffer = evt.target?.result as ArrayBuffer
      const result = parseBOMXlsx(buffer)
      setParseResult(result)

      // Match component names to supply items (case-insensitive)
      const itemMap = new Map<string, string>()
      for (const item of supplyItems) {
        itemMap.set(item.name.toLowerCase(), item.id)
      }

      const resolved: ResolvedLine[] = result.lines.map((line) => ({
        ...line,
        matchedSupplyItemId: itemMap.get(line.componentName.toLowerCase()) ?? null,
      }))

      setResolvedLines(resolved)
      setStep('preview')
    }
    reader.readAsArrayBuffer(file)
    // Reset file input
    e.target.value = ''
  }

  function handleConfirmImport() {
    const lines = resolvedLines.map((line) => ({
      metrcItemName: line.metrcItemName,
      metrcItemCategory: line.metrcItemCategory ?? undefined,
      componentItemId: line.matchedSupplyItemId ?? undefined,
      componentMetrcItemName: line.matchedSupplyItemId ? undefined : line.componentName,
      quantityPerUnit: line.quantityPerUnit,
      unit: line.unit,
    }))

    bulkCreate.mutate({ facilityId, lines })
  }

  const matchedCount = resolvedLines.filter((l) => l.matchedSupplyItemId).length
  const unmatchedCount = resolvedLines.length - matchedCount

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import BOMs from Spreadsheet
          </DialogTitle>
          <DialogDescription>
            Upload an .xlsx file with columns: Metrc Item Name, Component Name, Qty Per Unit, Unit (optional), Category (optional)
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="py-8">
            <label
              className={cn(
                'flex flex-col items-center justify-center gap-3 p-8 rounded-lg border-2 border-dashed',
                'border-border hover:border-primary/50 hover:bg-muted/30 cursor-pointer transition-colors',
              )}
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">Click to upload .xlsx file</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Expected columns: Metrc Item Name, Component Name, Qty Per Unit
                </p>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && parseResult && (
          <div className="space-y-4 py-2">
            {/* Stats */}
            <div className="flex gap-3">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                {parseResult.stats.validRows} valid rows
              </Badge>
              {parseResult.stats.skippedRows > 0 && (
                <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                  {parseResult.stats.skippedRows} skipped
                </Badge>
              )}
              <Badge variant="outline">
                {matchedCount} matched to supply items
              </Badge>
              {unmatchedCount > 0 && (
                <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20">
                  {unmatchedCount} as Metrc items
                </Badge>
              )}
            </div>

            {/* Warnings */}
            {parseResult.warnings.length > 0 && (
              <div className="p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-sm">
                <div className="flex items-center gap-2 mb-1 font-medium text-yellow-500">
                  <AlertTriangle className="h-4 w-4" />
                  Warnings
                </div>
                <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                  {parseResult.warnings.slice(0, 5).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {parseResult.warnings.length > 5 && (
                    <li>...and {parseResult.warnings.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}

            {/* Errors */}
            {parseResult.errors.length > 0 && (
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm">
                <div className="flex items-center gap-2 mb-1 font-medium text-destructive">
                  <X className="h-4 w-4" />
                  Errors
                </div>
                <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                  {parseResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Preview table */}
            {resolvedLines.length > 0 && (
              <div className="card-modern overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output Item</th>
                      <th className="p-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Component</th>
                      <th className="p-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Qty/Unit</th>
                      <th className="p-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unit</th>
                      <th className="p-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolvedLines.slice(0, 50).map((line, i) => (
                      <tr key={i} className="border-b border-border">
                        <td className="p-2 font-medium truncate max-w-[150px]">{line.metrcItemName}</td>
                        <td className="p-2 truncate max-w-[150px]">{line.componentName}</td>
                        <td className="p-2 font-mono text-xs">{line.quantityPerUnit}</td>
                        <td className="p-2 text-muted-foreground text-xs">{line.unit}</td>
                        <td className="p-2">
                          {line.matchedSupplyItemId ? (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-xs">
                              Supply
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-xs">
                              Metrc
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {resolvedLines.length > 50 && (
                  <div className="p-2 text-center text-xs text-muted-foreground border-t border-border">
                    Showing first 50 of {resolvedLines.length} rows
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Done */}
        {step === 'done' && importResult && (
          <div className="py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
            <h3 className="font-semibold mb-1">Import Complete</h3>
            <p className="text-muted-foreground text-sm">
              Created {importResult.created} BOM lines (of {importResult.total} submitted).
              {importResult.total - importResult.created > 0 && (
                <> {importResult.total - importResult.created} were duplicates and skipped.</>
              )}
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={reset}>
                Back
              </Button>
              <Button
                onClick={handleConfirmImport}
                disabled={resolvedLines.length === 0 || bulkCreate.isPending}
              >
                {bulkCreate.isPending ? 'Importing...' : `Import ${resolvedLines.length} Lines`}
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button onClick={() => handleClose(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
