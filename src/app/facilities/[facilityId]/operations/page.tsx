'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/shared/components/ui/table'
import { Users, Clock, AlertTriangle, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmployeeActivityItem {
  userName: string
  transferCount: number
  totalPackagesHandled: number
  firstActivity: string
  lastActivity: string
  activeDays: number
  averagePackagesPerTransfer: number
  timeOfDayDistribution: Record<string, number>
}

interface PatternsData {
  employees: EmployeeActivityItem[]
  totalEmployees: number
  activeEmployees: number
  mostActiveEmployee: { userName: string; transferCount: number } | null
  averageTransfersPerEmployee: number
  afterHoursActivity: { userName: string; count: number; latestTime: string }[]
}

interface TrainingNeedItem {
  userName: string
  category: string
  severity: string
  title: string
  description: string
  metric: number
}

type Tab = 'employees' | 'training' | 'after-hours'

export default function OperationsPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const [tab, setTab] = useState<Tab>('employees')
  const [daysLookback, setDaysLookback] = useState(90)

  const { data: rawPatterns, isLoading: patternsLoading } = trpc.operations.employeePatterns.useQuery(
    { facilityId, daysLookback },
    { enabled: !!facilityId, staleTime: 300_000 },
  )
  const { data: rawNeeds, isLoading: needsLoading } = trpc.operations.trainingNeeds.useQuery(
    { facilityId, daysLookback },
    { enabled: !!facilityId, staleTime: 300_000 },
  )

  const patterns = rawPatterns as unknown as PatternsData | undefined
  const needs = rawNeeds as unknown as TrainingNeedItem[] | undefined
  const isLoading = patternsLoading || needsLoading

  const summaryCards = [
    { label: 'Active Employees', value: patterns?.activeEmployees ?? 0, icon: Users, color: 'text-blue-500' },
    { label: 'Avg Transfers/Employee', value: patterns?.averageTransfersPerEmployee ?? 0, icon: Clock, color: 'text-cyan-500' },
    { label: 'Training Needs', value: needs?.length ?? 0, icon: Shield, color: 'text-yellow-500' },
    { label: 'After-Hours Events', value: patterns?.afterHoursActivity.length ?? 0, icon: AlertTriangle, color: (patterns?.afterHoursActivity.length ?? 0) > 0 ? 'text-red-500' : 'text-emerald-500' },
  ]

  const tabs: { id: Tab; label: string }[] = [
    { id: 'employees', label: 'Employee Activity' },
    { id: 'training', label: 'Training Needs' },
    { id: 'after-hours', label: 'After-Hours' },
  ]

  const severityBadge = (severity: string) => (
    <Badge
      variant="outline"
      className={cn(
        'text-xs',
        severity === 'critical' && 'bg-red-500/10 text-red-500 border-red-500/20',
        severity === 'warning' && 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
        severity === 'info' && 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      )}
    >
      {severity}
    </Badge>
  )

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Operations</h1>
          <p className="text-muted-foreground mt-1">Employee patterns, training needs, and operational warnings</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Lookback:</span>
          <select
            value={daysLookback}
            onChange={(e) => setDaysLookback(Number(e.target.value))}
            className="text-sm bg-background border border-border rounded-md px-2 py-1"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>6 months</option>
            <option value={365}>1 year</option>
            <option value={3650}>All time</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {summaryCards.map(c => (
          <div key={c.label} className="card-modern p-4">
            <div className="flex items-center gap-2 mb-2">
              <c.icon className={cn('h-4 w-4', c.color)} />
              <span className="text-xs text-muted-foreground">{c.label}</span>
            </div>
            {isLoading ? <Skeleton className="h-7 w-16" /> : <div className="text-xl font-bold">{c.value}</div>}
          </div>
        ))}
      </div>

      {/* Most Active Employee Highlight */}
      {!patternsLoading && patterns?.mostActiveEmployee && (
        <div className="card-modern p-4 mb-8 border-l-4 border-l-blue-500">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-blue-500" />
            <span className="font-medium">Most Active Employee</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {patterns.mostActiveEmployee.userName} — {patterns.mostActiveEmployee.transferCount} transfers
          </p>
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

      {/* Employee Activity Tab */}
      {tab === 'employees' && (
        <div className="card-modern">
          {patternsLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Transfers</TableHead>
                  <TableHead className="text-right">Packages</TableHead>
                  <TableHead className="text-right">Avg Pkgs/Transfer</TableHead>
                  <TableHead className="text-right">Active Days</TableHead>
                  <TableHead>Last Activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(patterns?.employees ?? []).map(e => (
                  <TableRow key={e.userName}>
                    <TableCell className="font-medium">{e.userName}</TableCell>
                    <TableCell className="text-right">{e.transferCount}</TableCell>
                    <TableCell className="text-right">{e.totalPackagesHandled}</TableCell>
                    <TableCell className="text-right">{e.averagePackagesPerTransfer}</TableCell>
                    <TableCell className="text-right">{e.activeDays}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(e.lastActivity).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* Training Needs Tab */}
      {tab === 'training' && (
        <div className="space-y-3">
          {needsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : (needs ?? []).length === 0 ? (
            <div className="card-modern p-8 text-center">
              <Shield className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-muted-foreground">No training needs identified</p>
            </div>
          ) : (
            (needs ?? []).map((n, i) => (
              <div
                key={i}
                className={cn(
                  'card-modern p-4 border-l-4',
                  n.severity === 'critical' && 'border-l-red-500',
                  n.severity === 'warning' && 'border-l-yellow-500',
                  n.severity === 'info' && 'border-l-blue-500',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  {severityBadge(n.severity)}
                  <span className="font-medium">{n.title}</span>
                </div>
                <p className="text-sm text-muted-foreground">{n.description}</p>
                <div className="flex gap-2 mt-2">
                  <Badge variant="outline" className="text-xs">{n.userName}</Badge>
                  <Badge variant="outline" className="text-xs">{n.category}</Badge>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* After-Hours Tab */}
      {tab === 'after-hours' && (
        <div className="card-modern">
          {patternsLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : (patterns?.afterHoursActivity ?? []).length === 0 ? (
            <div className="p-8 text-center">
              <Clock className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-muted-foreground">No after-hours activity detected</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">After-Hours Events</TableHead>
                  <TableHead>Latest Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(patterns?.afterHoursActivity ?? []).map(a => (
                  <TableRow key={a.userName}>
                    <TableCell className="font-medium">{a.userName}</TableCell>
                    <TableCell className="text-right">
                      <span className="text-red-500 font-medium">{a.count}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.latestTime}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  )
}
