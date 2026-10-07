'use client'

import { useState, useRef } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Badge } from '@/shared/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FileUp, Loader2, CheckCircle2, AlertTriangle, FlaskConical } from 'lucide-react'

interface COAUploadButtonProps {
  facilityId: string
  onSuccess?: () => void
}

type Step = 'idle' | 'form' | 'parsing' | 'preview' | 'confirming' | 'completed' | 'error'

interface PreviewData {
  fileName: string
  fileSize: number
  packageLabel: string | null
  parseTier: string
  parseConfidence: number
  terpeneCount: number
  cannabinoidCount: number
  terpenes: { name: string; value: number; unit: string; confidence: number }[]
  cannabinoids: { name: string; value: number; unit: string; confidence: number }[]
  labInfo: { labName: string | null; licenseNumber: string | null; testDate: string | null; confidence: number }
  batchInfo: { batchNumber: string | null; sampleId: string | null; productName: string | null; confidence: number }
  totalTerpenes: number | null
  totalCannabinoids: number | null
  warnings: string[]
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        value >= 0.8 && 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30',
        value >= 0.5 && value < 0.8 && 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/30',
        value < 0.5 && 'bg-red-500/10 text-red-500 border border-red-500/30',
      )}
    >
      {pct}%
    </span>
  )
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs',
        tier === 'regex' ? 'border-blue-500/30 text-blue-400' : 'border-purple-500/30 text-purple-400',
      )}
    >
      {tier === 'regex' ? 'Regex Engine' : 'LLM Extraction'}
    </Badge>
  )
}

export function COAUploadButton({ facilityId, onSuccess }: COAUploadButtonProps) {
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [packageLabel, setPackageLabel] = useState('')
  const [fileName, setFileName] = useState('')
  const fileBase64Ref = useRef('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const utils = trpc.useUtils()
  const parseMutation = trpc.coa.parseCOA.useMutation()

  const resetForm = () => {
    setStep('idle')
    setError(null)
    setPreview(null)
    setPackageLabel('')
    setFileName('')
    fileBase64Ref.current = ''
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleOpen = () => {
    resetForm()
    setStep('form')
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are accepted.')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('File size exceeds 10MB limit.')
      return
    }

    setFileName(file.name)
    setError(null)

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Remove the data:application/pdf;base64, prefix
      const base64 = result.split(',')[1] || result
      fileBase64Ref.current = base64
    }
    reader.onerror = () => {
      setError('Failed to read file.')
    }
    reader.readAsDataURL(file)
  }

  const handleParse = async () => {
    if (!fileBase64Ref.current || !fileName) return

    setStep('parsing')
    setError(null)

    try {
      const result = await parseMutation.mutateAsync({
        facilityId,
        fileName,
        fileBase64: fileBase64Ref.current,
        packageLabel: packageLabel || undefined,
        confirmed: false,
      })

      if (result.status === 'preview') {
        setPreview(result.preview as PreviewData)
        setStep('preview')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parsing failed')
      setStep('error')
    }
  }

  const handleConfirm = async () => {
    if (!preview || !fileName) return

    setStep('confirming')
    setError(null)

    try {
      await parseMutation.mutateAsync({
        facilityId,
        fileName,
        packageLabel: packageLabel || undefined,
        confirmed: true,
        previewData: {
          terpenes: preview.terpenes,
          cannabinoids: preview.cannabinoids,
          labInfo: preview.labInfo,
          batchInfo: preview.batchInfo,
          totalTerpenes: preview.totalTerpenes,
          totalCannabinoids: preview.totalCannabinoids,
          overallConfidence: preview.parseConfidence,
          warnings: preview.warnings,
          parseTier: preview.parseTier as 'regex' | 'llm',
          fileSize: preview.fileSize,
        },
      })

      setStep('completed')
      utils.coa.getRecords.invalidate()
      utils.coa.getExpiring.invalidate()

      setTimeout(() => {
        resetForm()
        onSuccess?.()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setStep('error')
    }
  }

  const isOpen = step !== 'idle'

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen}>
        <FileUp className="h-4 w-4 mr-1" />
        Upload COA
      </Button>

      <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open && step !== 'confirming' && step !== 'parsing') {
          resetForm()
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Upload Certificate of Analysis
            </DialogTitle>
            <DialogDescription>
              Upload a COA PDF to extract terpene and cannabinoid data.
            </DialogDescription>
          </DialogHeader>

          {/* FORM STEP */}
          {(step === 'form' || step === 'parsing') && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="coa-file">PDF File</Label>
                <Input
                  ref={fileInputRef}
                  id="coa-file"
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="cursor-pointer"
                />
                {fileName && (
                  <p className="text-xs text-muted-foreground">{fileName}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="coa-package-label">
                  Package Label <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="coa-package-label"
                  value={packageLabel}
                  onChange={(e) => setPackageLabel(e.target.value)}
                  placeholder="1A400..."
                />
                <p className="text-xs text-muted-foreground">
                  Link this COA to a Metrc package label.
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={resetForm} disabled={step === 'parsing'}>
                  Cancel
                </Button>
                <Button
                  onClick={handleParse}
                  disabled={!fileName || step === 'parsing'}
                >
                  {step === 'parsing' ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Parsing...
                    </>
                  ) : (
                    'Parse COA'
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* PREVIEW STEP */}
          {step === 'preview' && preview && (
            <div className="space-y-4">
              {/* Header stats */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TierBadge tier={preview.parseTier} />
                  <span className="text-sm text-muted-foreground">Confidence:</span>
                  <ConfidenceBadge value={preview.parseConfidence} />
                </div>
                <span className="text-xs text-muted-foreground">{preview.fileName}</span>
              </div>

              {/* Warnings */}
              {preview.warnings.length > 0 && (
                <div className="space-y-1">
                  {preview.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 rounded-md px-3 py-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Cannabinoids table */}
              {preview.cannabinoids.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">
                      Cannabinoids ({preview.cannabinoids.length})
                    </h4>
                    {preview.totalCannabinoids !== null && (
                      <span className="text-xs text-muted-foreground">
                        Total: {preview.totalCannabinoids}%
                      </span>
                    )}
                  </div>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/30 border-b border-border">
                          <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Compound</th>
                          <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">Value</th>
                          <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.cannabinoids.map((c, i) => (
                          <tr key={i} className="border-b border-border last:border-0">
                            <td className="px-3 py-1.5 font-medium">{c.name}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-xs">{c.value}{c.unit}</td>
                            <td className="px-3 py-1.5 text-right"><ConfidenceBadge value={c.confidence} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Terpenes table */}
              {preview.terpenes.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">
                      Terpenes ({preview.terpenes.length})
                    </h4>
                    {preview.totalTerpenes !== null && (
                      <span className="text-xs text-muted-foreground">
                        Total: {preview.totalTerpenes}%
                      </span>
                    )}
                  </div>
                  <div className="rounded-md border border-border overflow-hidden max-h-48 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0">
                        <tr className="bg-muted/30 border-b border-border">
                          <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Compound</th>
                          <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">Value</th>
                          <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.terpenes.map((t, i) => (
                          <tr key={i} className="border-b border-border last:border-0">
                            <td className="px-3 py-1.5 font-medium">{t.name}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-xs">{t.value}{t.unit}</td>
                            <td className="px-3 py-1.5 text-right"><ConfidenceBadge value={t.confidence} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Lab & Batch info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-medium text-muted-foreground">Lab Info</h4>
                    <ConfidenceBadge value={preview.labInfo.confidence} />
                  </div>
                  {preview.labInfo.labName && (
                    <p className="text-sm">{preview.labInfo.labName}</p>
                  )}
                  {preview.labInfo.licenseNumber && (
                    <p className="text-xs text-muted-foreground">License: {preview.labInfo.licenseNumber}</p>
                  )}
                  {preview.labInfo.testDate && (
                    <p className="text-xs text-muted-foreground">Date: {preview.labInfo.testDate}</p>
                  )}
                  {!preview.labInfo.labName && !preview.labInfo.licenseNumber && !preview.labInfo.testDate && (
                    <p className="text-xs text-muted-foreground italic">No lab info found</p>
                  )}
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-medium text-muted-foreground">Batch Info</h4>
                    <ConfidenceBadge value={preview.batchInfo.confidence} />
                  </div>
                  {preview.batchInfo.batchNumber && (
                    <p className="text-sm">Batch: {preview.batchInfo.batchNumber}</p>
                  )}
                  {preview.batchInfo.sampleId && (
                    <p className="text-xs text-muted-foreground">Sample: {preview.batchInfo.sampleId}</p>
                  )}
                  {preview.batchInfo.productName && (
                    <p className="text-xs text-muted-foreground">Product: {preview.batchInfo.productName}</p>
                  )}
                  {!preview.batchInfo.batchNumber && !preview.batchInfo.sampleId && !preview.batchInfo.productName && (
                    <p className="text-xs text-muted-foreground italic">No batch info found</p>
                  )}
                </div>
              </div>

              {/* Package label (editable before confirm) */}
              <div className="space-y-2">
                <Label htmlFor="coa-package-label-preview">
                  Package Label <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="coa-package-label-preview"
                  value={packageLabel}
                  onChange={(e) => setPackageLabel(e.target.value)}
                  placeholder="1A400..."
                />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setStep('form')}>
                  Back
                </Button>
                <Button onClick={handleConfirm}>
                  Confirm &amp; Save
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* CONFIRMING STEP */}
          {step === 'confirming' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Saving COA record...</p>
            </div>
          )}

          {/* COMPLETED STEP */}
          {step === 'completed' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p className="text-sm font-medium">COA record saved successfully</p>
            </div>
          )}

          {/* ERROR STEP */}
          {step === 'error' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error || 'An unexpected error occurred.'}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={resetForm}>
                  Close
                </Button>
                <Button onClick={() => setStep('form')}>
                  Try Again
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
