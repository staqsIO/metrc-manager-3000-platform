'use client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/lib/utils'
import { AlertTriangle, Clock, UserX, Building2 } from 'lucide-react'
import type { EmployeePatterns, TrainingNeed } from '@/services/engines/operations-analysis'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EmployeeActivityTableProps {
  patterns: EmployeePatterns
  trainingNeeds: TrainingNeed[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  after_hours: Clock,
  high_error_rate: Building2,
  low_volume: UserX,
  hold_association: AlertTriangle,
}

function getNeedsForEmployee(userName: string, needs: TrainingNeed[]): TrainingNeed[] {
  const result: TrainingNeed[] = []
  for (let i = 0; i < needs.length; i++) {
    if (needs[i].userName === userName) result.push(needs[i])
  }
  return result
}

function getAfterHoursCount(userName: string, patterns: EmployeePatterns): number {
  for (let i = 0; i < patterns.afterHoursActivity.length; i++) {
    if (patterns.afterHoursActivity[i].userName === userName) {
      return patterns.afterHoursActivity[i].count
    }
  }
  return 0
}

function severityBorderClass(needs: TrainingNeed[]): string {
  for (let i = 0; i < needs.length; i++) {
    if (needs[i].severity === 'critical') return 'border-l-2 border-l-red-500'
  }
  for (let i = 0; i < needs.length; i++) {
    if (needs[i].severity === 'warning') return 'border-l-2 border-l-yellow-500'
  }
  return ''
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EmployeeActivityTable({ patterns, trainingNeeds }: EmployeeActivityTableProps) {
  if (patterns.employees.length === 0) {
    return (
      <div className="card-modern p-8 text-center">
        <UserX className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="font-medium">No employee activity</p>
        <p className="text-sm text-muted-foreground">No transfer data available for employee analysis.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card-modern p-3">
          <div className="text-xs text-muted-foreground">Total Employees</div>
          <div className="text-xl font-bold">{patterns.totalEmployees}</div>
        </div>
        <div className="card-modern p-3">
          <div className="text-xs text-muted-foreground">Avg Transfers/Employee</div>
          <div className="text-xl font-bold">{patterns.averageTransfersPerEmployee}</div>
        </div>
        <div className="card-modern p-3">
          <div className="text-xs text-muted-foreground">After-Hours Employees</div>
          <div className={cn('text-xl font-bold', patterns.afterHoursActivity.length > 0 && 'text-yellow-500')}>
            {patterns.afterHoursActivity.length}
          </div>
        </div>
        <div className="card-modern p-3">
          <div className="text-xs text-muted-foreground">Training Flags</div>
          <div className={cn('text-xl font-bold', trainingNeeds.length > 0 && 'text-red-500')}>
            {trainingNeeds.length}
          </div>
        </div>
      </div>

      {/* Employee table */}
      <div className="card-modern overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">Transfers</TableHead>
              <TableHead className="text-right">Packages</TableHead>
              <TableHead className="text-right">Active Days</TableHead>
              <TableHead className="text-right">After-Hours</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {patterns.employees.map(emp => {
              const needs = getNeedsForEmployee(emp.userName, trainingNeeds)
              const afterHours = getAfterHoursCount(emp.userName, patterns)

              return (
                <TableRow key={emp.userName} className={severityBorderClass(needs)}>
                  <TableCell className="font-medium">{emp.userName}</TableCell>
                  <TableCell className="text-right">{emp.transferCount}</TableCell>
                  <TableCell className="text-right">{emp.totalPackagesHandled}</TableCell>
                  <TableCell className="text-right">{emp.activeDays}</TableCell>
                  <TableCell className="text-right">
                    {afterHours > 0 ? (
                      <span className="text-yellow-500 font-medium">{afterHours}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {needs.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {needs.map((need, idx) => {
                          const Icon = CATEGORY_ICONS[need.category] ?? AlertTriangle
                          return (
                            <Badge
                              key={idx}
                              variant="outline"
                              className={cn(
                                'text-[11px] gap-1',
                                need.severity === 'critical' && 'bg-red-500/10 text-red-500 border-red-500/20',
                                need.severity === 'warning' && 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
                                need.severity === 'info' && 'bg-blue-500/10 text-blue-500 border-blue-500/20',
                              )}
                              title={need.description}
                            >
                              <Icon className="h-3 w-3" />
                              {need.title}
                            </Badge>
                          )
                        })}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
