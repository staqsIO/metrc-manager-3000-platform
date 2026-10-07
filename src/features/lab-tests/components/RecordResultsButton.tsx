'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { MutationDialog } from '@/shared/components/MutationDialog'
import { useMutationFlow } from '@/shared/hooks/useMutationFlow'
import { cn } from '@/lib/utils'
import { FlaskConical, Plus, Trash2, CheckCircle2, XCircle } from 'lucide-react'
import { format } from 'date-fns'

interface RecordResultsButtonProps {
  facilityId: string
  onSuccess?: () => void
}

interface TestResult {
  labTestTypeName: string
  quantity: number
  passed: boolean
  notes?: string
}

export function RecordResultsButton({ facilityId, onSuccess }: RecordResultsButtonProps) {
  const [packageLabel, setPackageLabel] = useState('')
  const [resultDate, setResultDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [overallPassed, setOverallPassed] = useState(true)
  const [results, setResults] = useState<TestResult[]>([
    { labTestTypeName: '', quantity: 0, passed: true },
  ])

  const utils = trpc.useUtils()
  const mutation = trpc.labTests.recordResults.useMutation()

  const flow = useMutationFlow<
    { facilityId: string; packageLabel: string; resultDate: string; overallPassed: boolean; results: TestResult[] },
    { packageLabel: string; itemName: string; currentLabState: string; resultDate: string; overallPassed: boolean; testCount: number; results: TestResult[] }
  >({
    mutationFn: (input) => mutation.mutateAsync(input),
    getPreview: (result) => {
      const r = result as { preview: { packageLabel: string; itemName: string; currentLabState: string; resultDate: string; overallPassed: boolean; testCount: number; results: TestResult[] } }
      return [r.preview]
    },
    onSuccess: () => {
      utils.labTests.getResults.invalidate()
      utils.labTests.getSummary.invalidate()
      resetForm()
      onSuccess?.()
    },
  })

  const resetForm = () => {
    setPackageLabel('')
    setResultDate(format(new Date(), 'yyyy-MM-dd'))
    setOverallPassed(true)
    setResults([{ labTestTypeName: '', quantity: 0, passed: true }])
  }

  const handleOpen = () => {
    resetForm()
    flow.open()
  }

  const addResult = () => {
    setResults(prev => [...prev, { labTestTypeName: '', quantity: 0, passed: true }])
  }

  const removeResult = (index: number) => {
    setResults(prev => prev.filter((_, i) => i !== index))
  }

  const updateResult = (index: number, field: keyof TestResult, value: unknown) => {
    setResults(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!packageLabel || results.some(r => !r.labTestTypeName)) return
    flow.preview({ facilityId, packageLabel, resultDate, overallPassed, results })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen}>
        <FlaskConical className="h-4 w-4 mr-1" />
        Record Results
      </Button>

      <MutationDialog
        title="Record Lab Test Results"
        description="Submit lab test results for a package to Metrc"
        flow={flow}
        size="lg"
        formContent={
          <form id="mutation-form" onSubmit={handleFormSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="packageLabel">Package Label</Label>
                <Input id="packageLabel" value={packageLabel} onChange={(e) => setPackageLabel(e.target.value)} placeholder="1A400..." required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="resultDate">Result Date</Label>
                <Input id="resultDate" type="date" value={resultDate} onChange={(e) => setResultDate(e.target.value)} required />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Overall Result</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOverallPassed(true)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors',
                    overallPassed ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'border-border text-muted-foreground'
                  )}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Passed
                </button>
                <button
                  type="button"
                  onClick={() => setOverallPassed(false)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors',
                    !overallPassed ? 'bg-red-500/10 border-red-500/30 text-red-500' : 'border-border text-muted-foreground'
                  )}
                >
                  <XCircle className="h-3.5 w-3.5" /> Failed
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Test Results</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addResult}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Test
                </Button>
              </div>
              <div className="space-y-3">
                {results.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_80px_32px] gap-2 items-end">
                    <div className="space-y-1">
                      {i === 0 && <span className="text-xs text-muted-foreground">Test Type</span>}
                      <Input
                        value={r.labTestTypeName}
                        onChange={(e) => updateResult(i, 'labTestTypeName', e.target.value)}
                        placeholder="e.g., Potency"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      {i === 0 && <span className="text-xs text-muted-foreground">Quantity</span>}
                      <Input
                        type="number"
                        step="0.01"
                        value={r.quantity || ''}
                        onChange={(e) => updateResult(i, 'quantity', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-1">
                      {i === 0 && <span className="text-xs text-muted-foreground">Result</span>}
                      <button
                        type="button"
                        onClick={() => updateResult(i, 'passed', !r.passed)}
                        className={cn(
                          'w-full h-10 rounded-md text-xs font-medium border transition-colors',
                          r.passed ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-red-500/10 border-red-500/30 text-red-500'
                        )}
                      >
                        {r.passed ? 'Pass' : 'Fail'}
                      </button>
                    </div>
                    <div>
                      {results.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" className="h-10 w-8" onClick={() => removeResult(i)}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </form>
        }
        previewContent={(previews) => {
          const p = previews[0]!
          return (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Package</span>
                  <span className="font-mono text-xs">{p.packageLabel}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Item</span>
                  <span className="font-medium">{p.itemName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Lab State</span>
                  <span>{p.currentLabState}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Result Date</span>
                  <span>{p.resultDate}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-border pt-2">
                  <span className="text-muted-foreground">Overall Result</span>
                  <span className={cn('font-bold', p.overallPassed ? 'text-emerald-500' : 'text-red-500')}>
                    {p.overallPassed ? 'PASSED' : 'FAILED'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tests</span>
                  <span>{p.testCount} test type{p.testCount !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>
          )
        }}
        confirmLabel="Record Results"
      />
    </>
  )
}
