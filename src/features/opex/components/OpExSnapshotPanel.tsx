'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'
import { useKPIs } from '../OpExContext'
import { Camera, ChevronDown, ChevronRight, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpExSnapshotPanelProps {
  facilityId: string
  modelId: string
}

interface SnapshotKPIs {
  [key: string]: number | null
}

interface SnapshotItem {
  id: string
  name: string
  notes: string | null
  kpis: unknown
  createdBy: string
  createdAt: Date
}

// ---------------------------------------------------------------------------
// KPI labels for display
// ---------------------------------------------------------------------------

const KPI_LABELS: Record<string, string> = {
  'pnl.annual_revenue': 'Revenue',
  'pnl.total_annual_cost': 'Total Cost',
  'pnl.cost_per_pound': '$/lb',
  'pnl.gross_margin_pct': 'Margin',
  'pnl.gross_profit': 'Profit',
  'pnl.taxable_profit': 'Taxable',
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatValue(val: number | null | undefined, key: string): string {
  if (val === null || val === undefined) return '--'
  if (key.includes('margin') || key.includes('pct')) return val.toFixed(1) + '%'
  if (key.includes('per_pound') || key.includes('per_lb')) {
    return '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return '$' + Math.round(val).toLocaleString()
}

function formatDelta(
  current: number | null,
  snapshot: number | null,
  key: string,
): { text: string; direction: 'up' | 'down' | 'flat' } {
  if (current === null || snapshot === null) return { text: '--', direction: 'flat' }
  const delta = current - snapshot
  if (Math.abs(delta) < 0.01) return { text: '--', direction: 'flat' }

  const direction = delta > 0 ? ('up' as const) : ('down' as const)

  if (key.includes('margin') || key.includes('pct')) {
    return { text: (delta > 0 ? '+' : '') + delta.toFixed(1) + 'pp', direction }
  }
  if (key.includes('per_pound') || key.includes('per_lb')) {
    return { text: (delta > 0 ? '+' : '') + '$' + delta.toFixed(2), direction }
  }
  return { text: (delta > 0 ? '+' : '') + '$' + Math.round(delta).toLocaleString(), direction }
}

/**
 * Determine the color class for a delta indicator.
 * For cost/tax keys, "up" is bad (red) and "down" is good (green).
 * For revenue/profit keys, "up" is good (green) and "down" is bad (red).
 */
function getDeltaColorClass(direction: 'up' | 'down' | 'flat', key: string): string {
  if (direction === 'flat') return 'text-muted-foreground'
  const isCostKey = key.includes('cost') || key.includes('tax')
  if (direction === 'up') return isCostKey ? 'text-red-400' : 'text-emerald-400'
  // direction === 'down'
  return isCostKey ? 'text-emerald-400' : 'text-red-400'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OpExSnapshotPanel({ facilityId, modelId }: OpExSnapshotPanelProps) {
  const [showSave, setShowSave] = useState(false)
  const [snapshotName, setSnapshotName] = useState('')
  const [snapshotNotes, setSnapshotNotes] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const currentKPIs = useKPIs()

  const snapshotsQuery = trpc.opex.listSnapshots.useQuery(
    { facilityId, modelId },
    { enabled: !!facilityId && !!modelId },
  )
  const snapshots = snapshotsQuery.data as SnapshotItem[] | undefined
  const isLoading = snapshotsQuery.isLoading

  const utils = trpc.useUtils()
  const saveMutation = trpc.opex.saveSnapshot.useMutation({
    onSuccess: () => {
      utils.opex.listSnapshots.invalidate({ facilityId, modelId })
      setShowSave(false)
      setSnapshotName('')
      setSnapshotNotes('')
    },
  })

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Snapshots</h2>
        <Button size="sm" variant="outline" onClick={() => setShowSave(true)} className="gap-1.5">
          <Camera className="h-3.5 w-3.5" />
          Save Snapshot
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-card/50 rounded-md animate-pulse" />
          ))}
        </div>
      ) : !snapshots || snapshots.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No snapshots yet. Save one to track changes over time.
        </p>
      ) : (
        <div className="space-y-2">
          {snapshots.map((snapshot) => {
            const isExpanded = expandedId === snapshot.id
            const snapshotKPIs = (snapshot.kpis || {}) as SnapshotKPIs

            return (
              <div key={snapshot.id} className="border border-border rounded-md overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : snapshot.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <div className="flex-1 text-left">
                    <span className="text-sm font-medium">{snapshot.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {new Date(snapshot.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border px-3 py-2 bg-card/30">
                    {snapshot.notes && (
                      <p className="text-xs text-muted-foreground mb-2 italic">{snapshot.notes}</p>
                    )}
                    <div className="space-y-1">
                      {Object.entries(KPI_LABELS).map(([key, label]) => {
                        const snapVal = snapshotKPIs[key] ?? null
                        const currVal = currentKPIs[key] ?? null
                        const delta = formatDelta(currVal, snapVal, key)

                        return (
                          <div key={key} className="flex items-center text-xs">
                            <span className="w-20 text-muted-foreground">{label}</span>
                            <span className="w-24 font-mono text-right">
                              {formatValue(snapVal, key)}
                            </span>
                            <span className="mx-2 text-muted-foreground">&rarr;</span>
                            <span className="w-24 font-mono text-right">
                              {formatValue(currVal, key)}
                            </span>
                            <span
                              className={cn(
                                'ml-2 flex items-center gap-0.5 font-mono',
                                getDeltaColorClass(delta.direction, key),
                              )}
                            >
                              {delta.direction === 'up' && <TrendingUp className="h-3 w-3" />}
                              {delta.direction === 'down' && <TrendingDown className="h-3 w-3" />}
                              {delta.direction === 'flat' && <Minus className="h-3 w-3" />}
                              {delta.text}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Save Snapshot Dialog */}
      <Dialog open={showSave} onOpenChange={setShowSave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Snapshot</DialogTitle>
            <DialogDescription>
              Capture the current state of all values for future comparison.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Snapshot Name</label>
              <input
                type="text"
                className="w-full p-2 rounded-md border border-border bg-background text-sm"
                placeholder="e.g. Pre-expansion baseline"
                value={snapshotName}
                onChange={(e) => setSnapshotName(e.target.value)}
                maxLength={100}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Notes (optional)</label>
              <textarea
                className="w-full p-2 rounded-md border border-border bg-background text-sm resize-none"
                placeholder="Context about this snapshot..."
                value={snapshotNotes}
                onChange={(e) => setSnapshotNotes(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </div>

            {/* Current KPIs preview */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">
                Current Values
              </h4>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(KPI_LABELS).map(([key, label]) => (
                  <div key={key} className="text-center p-2 rounded bg-card/50 border border-border">
                    <div className="text-[10px] text-muted-foreground">{label}</div>
                    <div className="text-sm font-mono font-bold">
                      {formatValue(currentKPIs[key], key)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSave(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                saveMutation.mutate({
                  facilityId,
                  modelId,
                  name: snapshotName,
                  notes: snapshotNotes || undefined,
                })
              }
              disabled={!snapshotName.trim() || saveMutation.isPending}
              className="gap-2"
            >
              {saveMutation.isPending ? (
                'Saving...'
              ) : (
                <>
                  <Camera className="h-4 w-4" />
                  Save
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
