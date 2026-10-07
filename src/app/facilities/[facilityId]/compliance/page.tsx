'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Loader2, Play } from 'lucide-react'
import { AlertsTable } from '@/features/compliance/components/AlertsTable'
import { AlertActivityHeatmap } from '@/features/compliance/components/AlertActivityHeatmap'
import { SeverityDonut } from '@/features/compliance/components/SeverityDonut'
import AiInsightCard from '@/features/copilot/components/AiInsightCard'

export default function CompliancePage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const [evalMessage, setEvalMessage] = useState<string | null>(null)

  const utils = trpc.useUtils()

  const { data: summary } = trpc.compliance.getSummary.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const { data: heatmap } = trpc.compliance.getActivityHeatmap.useQuery(
    { facilityId, daysLookback: 30 },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const runEvaluation = trpc.compliance.runEvaluation.useMutation({
    onSuccess: (result) => {
      utils.compliance.getSummary.invalidate()
      utils.compliance.getAlerts.invalidate()
      setEvalMessage(
        `Evaluation complete: ${result.evaluated} packages checked against ${result.rulesChecked} rules. ` +
        `${result.violationsFound} violations found, ${result.alertsCreated} new alerts created` +
        (result.alertsSkipped > 0 ? `, ${result.alertsSkipped} duplicates skipped.` : '.')
      )
      setTimeout(() => setEvalMessage(null), 8000)
    },
    onError: (err) => {
      setEvalMessage(`Evaluation failed: ${err.message}`)
      setTimeout(() => setEvalMessage(null), 8000)
    },
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Compliance</h1>
          <p className="text-muted-foreground mt-1">
            Alerts, risk scoring, and compliance status monitoring
          </p>
        </div>
        <button
          onClick={() => runEvaluation.mutate({ facilityId })}
          disabled={runEvaluation.isPending}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'disabled:opacity-50 disabled:pointer-events-none'
          )}
        >
          {runEvaluation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run Evaluation
        </button>
      </div>

      {/* Evaluation result message */}
      {evalMessage && (
        <div
          className={cn(
            'mb-6 rounded-md border px-4 py-3 text-sm',
            runEvaluation.isError
              ? 'border-red-500/30 bg-red-500/5 text-red-600'
              : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600'
          )}
        >
          {evalMessage}
        </div>
      )}

      {/* Severity distribution + activity rhythm. Two views of the same
          underlying alert stream: one answers "how is risk weighted" (donut +
          counts), the other answers "when do alerts fire" (day × hour heatmap). */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="lg:col-span-2 card-modern p-5">
          <h3 className="text-sm font-semibold mb-4">Severity Distribution</h3>
          <SeverityDonut
            critical={summary?.criticalOpen ?? 0}
            warning={summary?.warningOpen ?? 0}
            info={summary?.infoOpen ?? 0}
          />
        </div>
        <div className="lg:col-span-3 card-modern p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-semibold">Alert Activity</h3>
            <span className="text-[10px] uppercase tracking-instrument text-muted-foreground">
              {heatmap ? `${heatmap.totalAlerts} alerts · last ${heatmap.daysLookback}d` : 'Last 30d'}
            </span>
          </div>
          <AlertActivityHeatmap
            matrix={heatmap?.matrix ?? Array.from({ length: 7 }, () => new Array(24).fill(0))}
            max={heatmap?.max ?? 0}
          />
        </div>
      </div>

      {/* AI Insights */}
      <AiInsightCard
        facilityId={facilityId}
        maxInsights={3}
        followUpPrompt="Analyze my compliance status. What are the most critical risks and what actions can you take to fix them?"
        className="mb-6"
      />

      {/* Alerts Table */}
      <AlertsTable facilityId={facilityId} />
    </div>
  )
}
