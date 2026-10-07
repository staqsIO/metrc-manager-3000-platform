'use client'

import { useState } from 'react'
import { Store, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import StoreSelector from './StoreSelector'
import ProductComparisonTable from './ProductComparisonTable'
import FindReplaceWizard from './FindReplaceWizard'
import ExecutionStatusPanel from './ExecutionStatusPanel'
import OperationHistory from './OperationHistory'
import { trpc } from '@/lib/trpc-client'
import type { FindReplaceRule, FindReplacePreview } from '@/services/dutchie/types'

type Step = 'select' | 'compare' | 'wizard' | 'executing'
type Tab = 'bulk' | 'history'

interface Props {
  activeFacilityId: string
  initialTab?: Tab
}

export default function DutchieOpsClient({ activeFacilityId, initialTab = 'bulk' }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [step, setStep] = useState<Step>('select')
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<string[]>([activeFacilityId])
  const [rule, setRule] = useState<FindReplaceRule | null>(null)
  const [previews, setPreviews] = useState<FindReplacePreview[]>([])

  const crossStoreQuery = trpc.dutchieBulk.fetchCrossStoreProducts.useQuery(
    { facilityIds: selectedFacilityIds },
    { enabled: (step === 'compare' || step === 'wizard') && selectedFacilityIds.length >= 1, staleTime: 60_000 },
  )

  const previewMutation = trpc.dutchieBulk.previewBulkUpdate.useMutation()
  const executeMutation = trpc.dutchieBulk.executeBulkUpdate.useMutation()

  const handleStoresSelected = (ids: string[]) => {
    setSelectedFacilityIds(ids)
    setStep('compare')
  }

  const handleStartWizard = () => {
    setStep('wizard')
  }

  const handlePreview = async (newRule: FindReplaceRule) => {
    setRule(newRule)
    const result = await previewMutation.mutateAsync({
      facilityIds: selectedFacilityIds,
      rule: newRule,
    })
    setPreviews(result.previews)
  }

  const handleConfirmExecute = async () => {
    if (!rule) return
    const expectedChangeCount = previews.reduce((sum, p) => sum + p.changes.length, 0)
    setStep('executing')
    await executeMutation.mutateAsync({
      facilityIds: selectedFacilityIds,
      rule,
      confirmed: true,
      expectedChangeCount,
    })
  }

  const handleReset = () => {
    setStep('select')
    setRule(null)
    setPreviews([])
    previewMutation.reset()
    executeMutation.reset()
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <Store className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Dutchie Ops</h1>
          </div>
          <p className="text-muted-foreground mt-1">
            Multi-store product management and bulk operations
          </p>
        </div>
        {step !== 'select' && (
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent transition-colors"
          >
            Start Over
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setTab('bulk')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
            tab === 'bulk'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <Store className="h-4 w-4" />
          Bulk Operations
        </button>
        <button
          onClick={() => setTab('history')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
            tab === 'history'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <History className="h-4 w-4" />
          History
        </button>
      </div>

      {tab === 'history' && (
        <OperationHistory facilityId={activeFacilityId} />
      )}

      {tab === 'bulk' && (
        <>
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            {(['select', 'compare', 'wizard', 'executing'] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <div className="h-px w-8 bg-border" />}
                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                  s === step
                    ? 'bg-primary/10 text-primary'
                    : step === 'executing' || (['compare', 'wizard', 'executing'].indexOf(step) > ['compare', 'wizard', 'executing'].indexOf(s))
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : 'bg-muted text-muted-foreground'
                }`}>
                  <span className="font-bold">{i + 1}</span>
                  {s === 'select' && 'Select Stores'}
                  {s === 'compare' && 'Compare'}
                  {s === 'wizard' && 'Find & Replace'}
                  {s === 'executing' && 'Execute'}
                </div>
              </div>
            ))}
          </div>

          {/* Step content */}
          {step === 'select' && (
            <StoreSelector
              activeFacilityId={activeFacilityId}
              selected={selectedFacilityIds}
              onChange={setSelectedFacilityIds}
              onProceed={handleStoresSelected}
            />
          )}

          {step === 'compare' && (
            <ProductComparisonTable
              data={crossStoreQuery.data ?? null}
              isLoading={crossStoreQuery.isLoading}
              onStartBulkUpdate={handleStartWizard}
              onBack={() => setStep('select')}
            />
          )}

          {step === 'wizard' && (
            <FindReplaceWizard
              previews={previews}
              isLoadingPreview={previewMutation.isPending}
              onPreview={handlePreview}
              onConfirm={handleConfirmExecute}
              onBack={() => { setStep('compare'); setPreviews([]); }}
            />
          )}

          {step === 'executing' && (
            <ExecutionStatusPanel
              results={executeMutation.data?.results ?? null}
              isLoading={executeMutation.isPending}
              error={executeMutation.error?.message ?? null}
              onDone={handleReset}
            />
          )}
        </>
      )}
    </div>
  )
}
