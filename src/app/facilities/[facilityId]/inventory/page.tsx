'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { Package, Clock, AlertTriangle, CheckCircle2, FlaskConical, XCircle } from 'lucide-react'
import { InventoryTable } from '@/features/inventory/components/InventoryTable'
import BulkActionPanel from '@/features/inventory/components/BulkActionPanel'
import BulkPreviewDialog from '@/features/inventory/components/BulkPreviewDialog'
import { useBulkAction } from '@/shared/hooks/useBulkAction'
import { useTableSelection } from '@/shared/hooks/useTableSelection'
import type { AdjustmentInput } from '@/services/actions/action-types'
import AiInsightCard from '@/features/copilot/components/AiInsightCard'
import { ChangeLocationButton } from '@/features/inventory/components/ChangeLocationButton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs'
import { KpiCard } from '@/shared/components/ui/kpi-card'
import { ACTIONS_ENABLED } from '@/shared/constants/feature-flags'

type PackageStatus = 'active' | 'inactive' | 'onhold'

export default function InventoryPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const facilityId = params?.facilityId as string
  const initialAgeFilter = searchParams?.get('age') as 'fresh' | 'normal' | 'aging' | 'critical' | null
  const selection = useTableSelection<string>({ pageItemKeys: [] })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [statusTab, setStatusTab] = useState<PackageStatus>('active')

  const bulkAction = useBulkAction(facilityId)

  const { data: agingSummary } = trpc.inventory.getAgingSummary.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const { data: labSummary } = trpc.inventory.getLabTestingSummary.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const { data: statusCounts } = trpc.inventory.getStatusCounts.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const handleTabChange = (value: string) => {
    setStatusTab(value as PackageStatus)
    selection.clear()
  }

  const handleAdjust = () => {
    bulkAction.startAction('adjust', Array.from(selection.selectedKeys))
    setDialogOpen(true)
    bulkAction.preview()
  }

  const handleFinish = () => {
    bulkAction.startAction('finish', Array.from(selection.selectedKeys))
    setDialogOpen(true)
    bulkAction.preview()
  }

  const handleBulkEdit = () => {
    const labels = Array.from(selection.selectedKeys)
    // Use sessionStorage to avoid URL length limits with large label selections
    sessionStorage.setItem('reconciliation_labels', JSON.stringify(labels))
    router.push(`/facilities/${facilityId}/operations/reconciliation?source=inventory`)
  }

  const handleConfirm = (adjustments?: AdjustmentInput[]) => {
    bulkAction.confirm(adjustments)
  }

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      if (bulkAction.status === 'completed') {
        selection.clear()
      }
      bulkAction.reset()
    }
    setDialogOpen(open)
  }

  const summaryCards = [
    {
      label: 'Total Packages',
      value: agingSummary?.total ?? 0,
      icon: Package,
      color: 'text-foreground',
      href: undefined as string | undefined,
    },
    {
      label: 'Fresh (0-30d)',
      value: agingSummary?.fresh ?? 0,
      icon: CheckCircle2,
      color: 'text-emerald-500',
      href: `/facilities/${facilityId}/inventory?age=fresh`,
    },
    {
      label: 'Normal (31-60d)',
      value: agingSummary?.normal ?? 0,
      icon: Clock,
      color: 'text-blue-500',
      href: `/facilities/${facilityId}/inventory?age=normal`,
    },
    {
      label: 'Aging (61-90d)',
      value: agingSummary?.aging ?? 0,
      icon: AlertTriangle,
      color: 'text-yellow-500',
      href: `/facilities/${facilityId}/inventory?age=aging`,
    },
    {
      label: 'Critical (90d+)',
      value: agingSummary?.critical ?? 0,
      icon: AlertTriangle,
      color: 'text-red-500',
      href: `/facilities/${facilityId}/inventory?age=critical`,
    },
  ]

  const isReadOnly = statusTab !== 'active' || !ACTIONS_ENABLED

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-muted-foreground mt-1">Packages and bulk actions</p>
        </div>
        <ChangeLocationButton facilityId={facilityId} />
      </div>

      {/* Aging Summary Cards — bucket → status color (Fresh = primary,
          Normal = neutral, Aging = caution, Critical = critical). Each
          card links to the inventory list filtered by that age bucket. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {summaryCards.map((card) => {
          // Map the legacy Tailwind color string to a semantic CSS variable.
          const valueClass =
            card.color === 'text-emerald-500' ? 'text-[hsl(var(--primary))]' :
            card.color === 'text-red-500'     ? 'text-[hsl(var(--signal-critical))]' :
            card.color === 'text-yellow-500'  ? 'text-[hsl(var(--signal-caution))]' :
            undefined
          const tile = (
            <KpiCard
              icon={card.icon}
              label={card.label}
              value={card.value.toLocaleString()}
              valueClass={valueClass}
            />
          )
          return card.href ? (
            <Link key={card.label} href={card.href} className="block">
              {tile}
            </Link>
          ) : (
            <div key={card.label}>{tile}</div>
          )
        })}
      </div>

      {/* Lab Testing Summary — semantic status colors (passed = primary,
          failed = critical, submitted = neutral, pending = caution). */}
      {labSummary && (labSummary.passed > 0 || labSummary.failed > 0 || labSummary.submitted > 0) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <KpiCard
            icon={CheckCircle2}
            label="Tests Passed"
            value={`${labSummary.passed}`}
            valueClass="text-[hsl(var(--primary))]"
          />
          <KpiCard
            icon={XCircle}
            label="Tests Failed"
            value={`${labSummary.failed}`}
            valueClass="text-[hsl(var(--signal-critical))]"
          />
          <KpiCard
            icon={FlaskConical}
            label="Submitted"
            value={`${labSummary.submitted}`}
          />
          <KpiCard
            icon={Clock}
            label="Not Submitted"
            value={`${labSummary.pending}`}
            valueClass="text-[hsl(var(--signal-caution))]"
          />
        </div>
      )}

      {/* AI Insights */}
      <AiInsightCard
        facilityId={facilityId}
        severities={['critical', 'warning']}
        maxInsights={2}
        followUpPrompt="What inventory actions should I prioritize? Look at aging, FIFO violations, and slow-moving packages."
        className="mb-6"
      />

      {/* Status Tabs */}
      <Tabs value={statusTab} onValueChange={handleTabChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="active">
            Active{statusCounts ? ` (${statusCounts.active.toLocaleString()})` : ''}
          </TabsTrigger>
          <TabsTrigger value="inactive">
            Inactive{statusCounts ? ` (${statusCounts.inactive.toLocaleString()})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <InventoryTable
            facilityId={facilityId}
            status="active"
            selectedLabels={selection.selectedKeys}
            onSelectionChange={selection.setSelection}
            initialAgeFilter={initialAgeFilter ?? undefined}
          />
        </TabsContent>

        <TabsContent value="inactive">
          <InventoryTable
            facilityId={facilityId}
            status="inactive"
            selectedLabels={selection.selectedKeys}
            onSelectionChange={selection.setSelection}
          />
        </TabsContent>
      </Tabs>

      {/* Bulk Action Panel — only for active tab */}
      {!isReadOnly && (
        <BulkActionPanel
          selectedCount={selection.selectedCount}
          onAdjust={handleAdjust}
          onFinish={handleFinish}
          onBulkEdit={handleBulkEdit}
          onClear={selection.clear}
        />
      )}

      {/* Bulk Preview Dialog */}
      <BulkPreviewDialog
        open={dialogOpen}
        onOpenChange={handleDialogClose}
        actionType={bulkAction.type}
        status={bulkAction.status}
        previews={bulkAction.previews}
        error={bulkAction.error}
        isLoading={bulkAction.isLoading}
        onConfirm={handleConfirm}
        onCancel={() => handleDialogClose(false)}
      />
    </div>
  )
}
