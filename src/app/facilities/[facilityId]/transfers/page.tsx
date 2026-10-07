'use client'

import { Fragment, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ArrowRight, Package, Search,
  ChevronRight, ChevronDown, Hash, XCircle, History, Clock,
} from 'lucide-react'
import { CopyButton } from '@/shared/components/ui/copy-button'
import { KpiCard } from '@/shared/components/KpiCard'
import { Pagination } from '@/shared/components/Pagination'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { CreateTransferButton } from '@/features/transfers/components/CreateTransferButton'
import { ImportTransfersButton, ImportHistoryPanel } from '@/features/transfers/components/ImportTransfersButton'
import { TransferDetailPanel } from '@/features/transfers/components/TransferDetailPanel'
import { AcceptInMetrcButton } from '@/features/transfers/components/AcceptInMetrcButton'
import { TableSkeletonRows } from '@/shared/components/ui/table-skeleton'
import { PageHeader } from '@/shared/components/PageHeader'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/api/root'

type RouterOutputs = inferRouterOutputs<AppRouter>
type TransferItem = RouterOutputs['transfers']['getIncoming']['items'][number]
type HistoryItem = RouterOutputs['transfers']['getHistory']['items'][number]
type RecentTransfer = RouterOutputs['transfers']['getSummary']['recentTransfers'][number]

type TabType = 'incoming' | 'outgoing' | 'rejected' | 'history'

export default function TransfersPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const [activeTab, setActiveTab] = useState<TabType>('incoming')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [expandedTransferId, setExpandedTransferId] = useState<number | null>(null)

  // History tab filters
  const [historyDirection, setHistoryDirection] = useState<'all' | 'incoming' | 'outgoing' | 'rejected'>('all')
  const [historyStatus, setHistoryStatus] = useState<'all' | 'active' | 'completed'>('all')

  const { data: summary } = trpc.transfers.getSummary.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const { data: historyCount } = trpc.transfers.getHistoryCount.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const { data: incomingData, isLoading: incomingLoading } = trpc.transfers.getIncoming.useQuery(
    { facilityId, search: search || undefined, page, pageSize: 25 },
    { enabled: !!facilityId && activeTab === 'incoming', staleTime: 300_000 }
  )

  const { data: outgoingData, isLoading: outgoingLoading } = trpc.transfers.getOutgoing.useQuery(
    { facilityId, search: search || undefined, page, pageSize: 25 },
    { enabled: !!facilityId && activeTab === 'outgoing', staleTime: 300_000 }
  )

  const { data: rejectedData, isLoading: rejectedLoading } = trpc.transfers.getRejected.useQuery(
    { facilityId, search: search || undefined, page, pageSize: 25 },
    { enabled: !!facilityId && activeTab === 'rejected', staleTime: 300_000 }
  )

  const { data: historyData, isLoading: historyLoading } = trpc.transfers.getHistory.useQuery(
    { facilityId, search: search || undefined, page, pageSize: 25, direction: historyDirection, status: historyStatus },
    { enabled: !!facilityId && activeTab === 'history', staleTime: 300_000 }
  )

  const { data: facility } = trpc.facility.getById.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 60_000 }
  )

  const liveData = activeTab === 'rejected' ? rejectedData : activeTab === 'incoming' ? incomingData : outgoingData
  const liveLoading = activeTab === 'rejected' ? rejectedLoading : activeTab === 'incoming' ? incomingLoading : outgoingLoading

  const summaryCards = [
    { label: 'Incoming', value: summary?.incomingCount ?? 0, icon: ArrowDownLeft, color: 'text-emerald-500' },
    { label: 'Outgoing', value: summary?.outgoingCount ?? 0, icon: ArrowUpRight, color: 'text-blue-500' },
    { label: 'Rejected', value: summary?.rejectedCount ?? 0, icon: XCircle, color: 'text-destructive' },
    { label: 'Total Packages', value: summary?.totalPackageCount ?? 0, icon: Package, color: 'text-foreground' },
    { label: 'Historical', value: historyCount?.completed ?? 0, icon: History, color: 'text-purple-500' },
  ]

  return (
    <div className="p-8">
      <PageHeader
        title="Transfers"
        description="Track incoming and outgoing manifest transfers"
        actions={
          <div className="flex items-center gap-2">
            <ImportTransfersButton facilityId={facilityId} />
            <CreateTransferButton facilityId={facilityId} />
            <Link
              href={`/facilities/${facilityId}/inventory`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <Package className="h-4 w-4" />
              Inventory
            </Link>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {summaryCards.map((card) => (
          <KpiCard key={card.label} {...card} />
        ))}
      </div>

      {/* Tab Toggle */}
      <div className="flex items-center gap-1 mb-4 p-1 rounded-lg bg-muted/30 w-fit">
        <button
          onClick={() => { setActiveTab('incoming'); setPage(1); }}
          className={cn(
            'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
            activeTab === 'incoming' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <ArrowDownLeft className="h-3.5 w-3.5 inline mr-1.5" />
          Incoming
        </button>
        <button
          onClick={() => { setActiveTab('outgoing'); setPage(1); }}
          className={cn(
            'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
            activeTab === 'outgoing' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <ArrowUpRight className="h-3.5 w-3.5 inline mr-1.5" />
          Outgoing
        </button>
        <button
          onClick={() => { setActiveTab('rejected'); setPage(1); }}
          className={cn(
            'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
            activeTab === 'rejected' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <XCircle className="h-3.5 w-3.5 inline mr-1.5" />
          Rejected
        </button>
        <button
          onClick={() => { setActiveTab('history'); setPage(1); }}
          className={cn(
            'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
            activeTab === 'history' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <History className="h-3.5 w-3.5 inline mr-1.5" />
          History
        </button>
      </div>

      {/* History Filters */}
      {activeTab === 'history' && (
        <div className="flex items-center gap-3 mb-4">
          <select
            value={historyDirection}
            onChange={(e) => { setHistoryDirection(e.target.value as typeof historyDirection); setPage(1); }}
            className="px-3 py-1.5 rounded-md border border-border bg-background text-sm"
          >
            <option value="all">All Directions</option>
            <option value="incoming">Incoming</option>
            <option value="outgoing">Outgoing</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            value={historyStatus}
            onChange={(e) => { setHistoryStatus(e.target.value as typeof historyStatus); setPage(1); }}
            className="px-3 py-1.5 rounded-md border border-border bg-background text-sm"
          >
            <option value="all">All Status</option>
            <option value="active">Active (In Transit)</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={
              activeTab === 'history' ? 'Search by manifest, shipper, or receiver...' :
              activeTab === 'incoming' ? 'Search by shipper or manifest...' :
              activeTab === 'outgoing' ? 'Search by receiver or manifest...' :
              'Search by facility or manifest...'
            }
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* History Table */}
      {activeTab === 'history' ? (
        <>
        <ImportHistoryPanel facilityId={facilityId} />
        <div className="card-modern overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Direction</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Metrc ID</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Manifest</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Shipper</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Receiver</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Packages</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Departure</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">First Seen</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  <TableSkeletonRows columns={10} />
                ) : !historyData?.items?.length ? (
                  <EmptyState
                    icon={History}
                    title="No transfer history found"
                    description={search ? `No results matching "${search}"` : 'Transfer history will accumulate as transfers are fetched from the Metrc API.'}
                    variant="filtered"
                    colSpan={10}
                  />
                ) : (
                  historyData.items.map((t: HistoryItem) => (
                    <tr key={`${t.id}-${t.direction}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-4">
                        {t.isActive ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-500 px-2 py-0.5 text-xs">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-xs">
                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                            Completed
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={cn(
                          'inline-flex items-center gap-1 text-xs font-medium',
                          t.direction === 'incoming' ? 'text-emerald-500' :
                          t.direction === 'outgoing' ? 'text-blue-500' : 'text-destructive'
                        )}>
                          {t.direction === 'incoming' && <ArrowDownLeft className="h-3 w-3" />}
                          {t.direction === 'outgoing' && <ArrowUpRight className="h-3 w-3" />}
                          {t.direction === 'rejected' && <XCircle className="h-3 w-3" />}
                          {t.direction.charAt(0).toUpperCase() + t.direction.slice(1)}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        {t.source === 'csv' ? (
                          <span
                            className="inline-flex items-center rounded bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-instrument text-muted-foreground"
                            title="Imported from historical transfer CSV — no live Metrc ID available"
                          >
                            CSV
                          </span>
                        ) : (
                          <CopyButton value={String(t.id)} label="Metrc ID" compact />
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <Hash className="h-3 w-3 text-muted-foreground" />
                          <span className="font-mono text-xs">{t.manifestNumber || '\u2014'}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-sm">{t.shipperFacilityName}</td>
                      <td className="py-2.5 px-4 text-sm">{t.receiverFacilityName}</td>
                      <td className="py-2.5 px-4 text-right font-medium">{t.packageCount}</td>
                      <td className="py-2.5 px-4 text-muted-foreground text-xs">
                        {t.estimatedDepartureDateTime ? new Date(t.estimatedDepartureDateTime).toLocaleDateString() : '\u2014'}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground text-xs">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(t.firstSeenAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground text-xs">
                        {new Date(t.lastSeenAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {historyData && (
            <Pagination
              page={historyData.page}
              totalPages={historyData.totalPages}
              pageSize={historyData.pageSize}
              total={historyData.total}
              onPageChange={setPage}
            />
          )}
        </div>
        </>
      ) : (
        <>
          {/* Live Transfers Table */}
          <div className="card-modern overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="w-10 py-3 px-2" />
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Metrc ID</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Manifest</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Created</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">
                      {activeTab === 'outgoing' ? 'Receiver' : 'Shipper'}
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">License</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Deliveries</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Packages</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Departure</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">
                      {activeTab === 'outgoing' ? 'Delivered' : 'Received'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {liveLoading ? (
                    <TableSkeletonRows columns={10} />
                  ) : !liveData?.items?.length ? (
                    // When the live snapshot is empty for this tab but the
                    // facility has CSV-imported historical transfers, point
                    // operators at the History tab where the data lives —
                    // otherwise the generic "no transfers found" hides real
                    // data the user already imported.
                    !search && (historyCount?.csvManifests ?? 0) > 0 ? (
                      <EmptyState
                        icon={History}
                        title={`No live ${activeTab} transfers`}
                        description={`Live Metrc sync is paused, but ${historyCount?.csvManifests.toLocaleString()} historical transfers were imported from CSV. View them in the History tab.`}
                        variant="filtered"
                        colSpan={10}
                      >
                        <button
                          onClick={() => { setActiveTab('history'); setPage(1); }}
                          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          View History
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </EmptyState>
                    ) : (
                      <EmptyState
                        icon={ArrowLeftRight}
                        title={`No ${activeTab} transfers found`}
                        description={search ? `No results matching "${search}"` : undefined}
                        variant="filtered"
                        colSpan={10}
                      />
                    )
                  ) : (
                    liveData.items.map((t: TransferItem) => (
                      <Fragment key={t.id}>
                        <tr className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="py-2.5 px-2">
                            <button
                              onClick={() => setExpandedTransferId(expandedTransferId === t.id ? null : t.id)}
                              className="p-1 rounded hover:bg-accent transition-colors"
                            >
                              {expandedTransferId === t.id
                                ? <ChevronDown className="h-4 w-4" />
                                : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              }
                            </button>
                          </td>
                          <td className="py-2.5 px-4">
                            <CopyButton value={String(t.id)} label="Metrc ID" compact />
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <Hash className="h-3 w-3 text-muted-foreground" />
                              <span className="font-mono text-xs">{t.manifestNumber || '\u2014'}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-muted-foreground text-xs">
                            {t.createdDateTime ? new Date(t.createdDateTime).toLocaleDateString() : '\u2014'}
                          </td>
                          <td className="py-2.5 px-4 font-medium">
                            {activeTab === 'outgoing' ? t.receiverFacilityName : t.shipperFacilityName}
                          </td>
                          <td className="py-2.5 px-4 text-muted-foreground font-mono text-xs">
                            {activeTab === 'outgoing' ? t.receiverFacilityLicense : t.shipperFacilityLicense}
                          </td>
                          <td className="py-2.5 px-4 text-right">{t.deliveryCount}</td>
                          <td className="py-2.5 px-4 text-right font-medium">{t.packageCount}</td>
                          <td className="py-2.5 px-4 text-muted-foreground text-xs">
                            {t.estimatedDepartureDateTime ? new Date(t.estimatedDepartureDateTime).toLocaleDateString() : '\u2014'}
                          </td>
                          <td className="py-2.5 px-4">
                            {t.receivedDateTime ? (
                              <span className="text-xs text-emerald-500">
                                {new Date(t.receivedDateTime).toLocaleDateString()}
                              </span>
                            ) : activeTab === 'incoming' && facility ? (
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center rounded-full bg-yellow-500/10 text-yellow-500 px-2 py-0.5 text-xs">
                                  Pending
                                </span>
                                <AcceptInMetrcButton
                                  stateCode={facility.stateCode}
                                  environment={facility.metrcEnvironment}
                                  licenseNumber={facility.licenseNumber}
                                />
                              </div>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-yellow-500/10 text-yellow-500 px-2 py-0.5 text-xs">
                                {activeTab === 'outgoing' ? 'In Transit' : 'Pending'}
                              </span>
                            )}
                          </td>
                        </tr>
                        {expandedTransferId === t.id && (
                          <tr>
                            <td colSpan={10} className="bg-muted/30 p-0">
                              <TransferDetailPanel
                                facilityId={facilityId}
                                transferId={t.id}
                                manifestNumber={t.manifestNumber}
                                direction={activeTab}
                                stateCode={facility?.stateCode ?? ''}
                                environment={facility?.metrcEnvironment ?? 'mock'}
                                licenseNumber={facility?.licenseNumber ?? ''}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {liveData && (
              <Pagination
                page={liveData.page}
                totalPages={liveData.totalPages}
                pageSize={liveData.pageSize}
                total={liveData.total}
                onPageChange={setPage}
              />
            )}
          </div>
        </>
      )}

      {/* Recent Transfers */}
      {activeTab !== 'history' && summary?.recentTransfers && summary.recentTransfers.length > 0 && (
        <div className="card-modern p-4 mt-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Recent Activity</h3>
          <div className="space-y-2">
            {summary.recentTransfers.map((t: RecentTransfer) => (
              <div key={t.id} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{t.manifestNumber || `#${t.id}`}</span>
                  <span className="text-sm">{t.shipperFacilityName} → {t.receiverFacilityName}</span>
                </div>
                <span className="text-xs text-muted-foreground">{t.packageCount} pkg</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
