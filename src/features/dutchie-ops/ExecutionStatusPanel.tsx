'use client'

import { cn } from '@/lib/utils'
import { CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'

interface FacilityResult {
  facilityId: string
  facilityName: string
  succeeded: string[]
  failed: { productId: string; error: string }[]
}

interface Props {
  results: FacilityResult[] | null
  isLoading: boolean
  error: string | null
  onDone: () => void
}

export default function ExecutionStatusPanel({ results, isLoading, error, onDone }: Props) {
  if (isLoading) {
    return (
      <div className="card-modern p-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
        <p className="text-sm font-medium">Executing bulk update...</p>
        <p className="text-xs text-muted-foreground mt-1">
          Fetching current state, merging changes, and pushing updates per store.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card-modern p-8 text-center">
        <XCircle className="h-8 w-8 text-red-500 mx-auto mb-3" />
        <p className="text-sm font-medium text-red-500">Execution failed</p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
        <button
          onClick={onDone}
          className="mt-4 px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent transition-colors"
        >
          Start Over
        </button>
      </div>
    )
  }

  if (!results) return null

  const totalSucceeded = results.reduce((sum, r) => sum + r.succeeded.length, 0)
  const totalFailed = results.reduce((sum, r) => sum + r.failed.length, 0)

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="card-modern p-6 text-center">
        {totalFailed === 0 ? (
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
        ) : (
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
        )}
        <h3 className="text-lg font-bold">
          {totalFailed === 0 ? 'All updates succeeded!' : 'Completed with some failures'}
        </h3>
        <div className="flex items-center justify-center gap-4 mt-2">
          <span className="text-sm text-emerald-500 font-medium">{totalSucceeded} succeeded</span>
          {totalFailed > 0 && (
            <span className="text-sm text-red-500 font-medium">{totalFailed} failed</span>
          )}
        </div>
      </div>

      {/* Per-facility results */}
      {results.map(result => (
        <div key={result.facilityId} className="card-modern overflow-hidden">
          <div className={cn(
            'px-4 py-3 flex items-center justify-between',
            result.failed.length > 0 ? 'bg-amber-500/5 border-b border-amber-500/20' : 'bg-emerald-500/5 border-b border-emerald-500/20',
          )}>
            <span className="font-medium text-sm">{result.facilityName}</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-500">
                {result.succeeded.length} ok
              </Badge>
              {result.failed.length > 0 && (
                <Badge variant="outline" className="text-xs border-red-500/30 text-red-500">
                  {result.failed.length} failed
                </Badge>
              )}
            </div>
          </div>
          {result.failed.length > 0 && (
            <div className="p-4 space-y-2">
              {result.failed.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                  <span>
                    <span className="font-mono">Product {f.productId}</span>: {f.error}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="flex justify-center pt-2">
        <button
          onClick={onDone}
          className="px-6 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  )
}
