'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/shared/components/ui/table'
import { Package, Clock, AlertTriangle, MapPin, FlaskConical, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

// Local types to avoid deep tRPC type instantiation
interface CategoryEntry { category: string; count: number; totalQuantity: number; unitOfMeasure: string; percentage: number }
interface LocationEntry { location: string; count: number; totalQuantity: number }
interface LabEntry { state: string; count: number; percentage: number }
interface TrendsData {
  totalPackages: number
  totalQuantityByUnit: Record<string, number>
  categoryDistribution: CategoryEntry[]
  agingVelocity: { averageAgeDays: number; medianAgeDays: number; packagesOver60Days: number; packagesOver90Days: number; percentOver60: number; percentOver90: number }
  recentActivity: { packagesLast7Days: number; packagesLast30Days: number; avgQuantityLast30Days: number }
  locationDistribution: LocationEntry[]
  labTestingBreakdown: LabEntry[]
}
interface AnomalyItem { type: string; severity: string; title: string; description: string; affectedPackages: number }
interface AnomaliesData { anomalies: AnomalyItem[]; totalAnomalies: number; criticalCount: number; warningCount: number }

type Tab = 'overview' | 'locations' | 'testing'

export default function AnalyticsPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const [tab, setTab] = useState<Tab>('overview')

  const { data: rawTrends, isLoading: trendsLoading } = trpc.analytics.trends.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )
  const { data: rawAnomalies, isLoading: anomaliesLoading } = trpc.analytics.anomalies.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 },
  )

  const trends = rawTrends as unknown as TrendsData | undefined
  const anomalies = rawAnomalies as unknown as AnomaliesData | undefined
  const isLoading = trendsLoading || anomaliesLoading

  const kpis = [
    { label: 'Total Packages', value: trends?.totalPackages ?? 0, icon: Package, color: 'text-blue-500', href: `/facilities/${facilityId}/inventory` },
    { label: 'Last 7 Days', value: trends?.recentActivity.packagesLast7Days ?? 0, icon: Activity, color: 'text-emerald-500', href: `/facilities/${facilityId}/inventory?sort=newest` },
    { label: 'Last 30 Days', value: trends?.recentActivity.packagesLast30Days ?? 0, icon: Activity, color: 'text-cyan-500', href: `/facilities/${facilityId}/inventory?sort=newest` },
    { label: 'Avg Age (days)', value: trends?.agingVelocity.averageAgeDays ?? 0, icon: Clock, color: 'text-yellow-500' },
    { label: 'Over 60 Days', value: `${trends?.agingVelocity.percentOver60 ?? 0}%`, icon: AlertTriangle, color: 'text-orange-500', href: `/facilities/${facilityId}/inventory?age=aging` },
    { label: 'Over 90 Days', value: `${trends?.agingVelocity.percentOver90 ?? 0}%`, icon: AlertTriangle, color: 'text-red-500', href: `/facilities/${facilityId}/inventory?age=critical` },
  ]

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Category Breakdown' },
    { id: 'locations', label: 'Locations' },
    { id: 'testing', label: 'Lab Testing' },
  ]

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-muted-foreground mt-1">Trend analysis and anomaly detection</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {kpis.map(kpi => {
          const content = (
            <div
              key={kpi.label}
              className={cn(
                'card-modern p-4',
                kpi.href && 'cursor-pointer hover:ring-2 ring-primary/30 transition-all',
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                <kpi.icon className={cn('h-4 w-4', kpi.color)} />
                <span className="text-xs text-muted-foreground">{kpi.label}</span>
              </div>
              {isLoading ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <div className="text-xl font-bold">{kpi.value}</div>
              )}
            </div>
          )
          return kpi.href ? (
            <Link key={kpi.label} href={kpi.href}>
              {content}
            </Link>
          ) : (
            content
          )
        })}
      </div>

      {/* Anomaly Alerts */}
      {!anomaliesLoading && anomalies && anomalies.anomalies.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Anomalies Detected ({anomalies.totalAnomalies})
          </h2>
          <div className="grid gap-3">
            {anomalies.anomalies.map((a, i) => (
              <div
                key={i}
                className={cn(
                  'card-modern p-4 border-l-4',
                  a.severity === 'critical' && 'border-l-red-500',
                  a.severity === 'warning' && 'border-l-yellow-500',
                  a.severity === 'info' && 'border-l-blue-500',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs',
                      a.severity === 'critical' && 'bg-red-500/10 text-red-500 border-red-500/20',
                      a.severity === 'warning' && 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
                      a.severity === 'info' && 'bg-blue-500/10 text-blue-500 border-blue-500/20',
                    )}
                  >
                    {a.severity}
                  </Badge>
                  <span className="font-medium">{a.title}</span>
                </div>
                <p className="text-sm text-muted-foreground">{a.description}</p>
                <p className="text-xs text-muted-foreground mt-1">{a.affectedPackages} package(s) affected</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && (
        <div className="card-modern">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Total Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="w-[200px]">Distribution</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(trends?.categoryDistribution ?? []).map(c => (
                  <TableRow key={c.category}>
                    <TableCell className="font-medium">{c.category}</TableCell>
                    <TableCell className="text-right">{c.count}</TableCell>
                    <TableCell className="text-right">{c.totalQuantity.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground">{c.unitOfMeasure}</TableCell>
                    <TableCell className="text-right">{c.percentage}%</TableCell>
                    <TableCell>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${Math.min(c.percentage, 100)}%` }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {tab === 'locations' && (
        <div className="card-modern">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Location</div>
                  </TableHead>
                  <TableHead className="text-right">Packages</TableHead>
                  <TableHead className="text-right">Total Quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(trends?.locationDistribution ?? []).map(l => (
                  <TableRow key={l.location}>
                    <TableCell className="font-medium">{l.location}</TableCell>
                    <TableCell className="text-right">{l.count}</TableCell>
                    <TableCell className="text-right">{l.totalQuantity.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {tab === 'testing' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card-modern p-4"><Skeleton className="h-12 w-full" /></div>
            ))
          ) : (
            (trends?.labTestingBreakdown ?? []).map(l => (
              <div key={l.state} className="card-modern p-4">
                <div className="flex items-center gap-2 mb-2">
                  <FlaskConical className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{l.state}</span>
                </div>
                <div className="text-2xl font-bold">{l.count}</div>
                <div className="text-xs text-muted-foreground">{l.percentage}% of inventory</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
