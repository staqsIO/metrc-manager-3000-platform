'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/shared/components/PageHeader'
import { KpiCard } from '@/shared/components/KpiCard'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Calculator,
  Users,
  FileText,
  BarChart3,
  Plus,
  DollarSign,
  Activity,
  Package,
  Loader2,
  Pencil,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'calculator', label: 'Calculator' },
  { id: 'employees', label: 'Employees' },
  { id: 'work-logs', label: 'Work Logs' },
  { id: 'sku-costs', label: 'SKU Costs' },
] as const

type TabId = typeof TABS[number]['id']

interface EmployeeRow {
  id: string
  name: string
  role: string | null
  hourlyRate: number
  isActive: boolean
  notes: string | null
  facilityId: string
  createdAt: Date
  updatedAt: Date
}

const ACTIVITY_OPTIONS = [
  'FILLING',
  'EXTRACTION',
  'PACKAGING',
  'TRIMMING',
  'PLANTING',
  'HARVESTING',
  'CURING',
  'DRYING',
  'QA',
  'OTHER',
] as const

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LaborPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const [activeTab, setActiveTab] = useState<TabId>('calculator')

  return (
    <div className="p-6">
      <PageHeader
        title="Labor Calculator"
        description="Track labor costs per employee, batch, and SKU."
        icon={Calculator}
      />

      {/* Tabs */}
      <div role="tablist" className="flex gap-1 border-b border-border mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div role="tabpanel">
        {activeTab === 'calculator' && <CalculatorTab facilityId={facilityId} />}
        {activeTab === 'employees' && <EmployeesTab facilityId={facilityId} />}
        {activeTab === 'work-logs' && (
          <EmptyState
            icon={FileText}
            title="Work Logs Coming Soon"
            description="Track detailed work logs per employee, batch, and SKU."
            variant="onboarding"
          />
        )}
        {activeTab === 'sku-costs' && (
          <EmptyState
            icon={BarChart3}
            title="SKU Cost Analysis Coming Soon"
            description="Full 5-component cost rollup: material + supply + labor + consumables + packaging."
            variant="onboarding"
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Calculator Tab
// ---------------------------------------------------------------------------

function CalculatorTab({ facilityId }: { facilityId: string }) {
  const [hoursWorked, setHoursWorked] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [batchSize, setBatchSize] = useState('')
  const [hasCalculated, setHasCalculated] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)

  // Save-as-work-log form state
  const [saveActivityType, setSaveActivityType] = useState<string>('OTHER')
  const [saveSkuName, setSaveSkuName] = useState('')
  const [saveDescription, setSaveDescription] = useState('')
  const [saveEmployeeId, setSaveEmployeeId] = useState('')

  const utils = trpc.useUtils()

  const calcQuery = trpc.labor.quickCalc.useQuery(
    {
      facilityId,
      hoursWorked: parseFloat(hoursWorked) || 0,
      hourlyRate: parseFloat(hourlyRate) || 0,
      batchSize: parseInt(batchSize, 10) || 0,
    },
    { enabled: hasCalculated },
  )

  const employeesQuery = trpc.labor.listEmployees.useQuery(
    { facilityId },
    { enabled: showSaveDialog },
  )

  const createWorkLogMutation = trpc.labor.createWorkLog.useMutation({
    onSuccess: () => {
      setShowSaveDialog(false)
      setSaveActivityType('OTHER')
      setSaveSkuName('')
      setSaveDescription('')
      setSaveEmployeeId('')
      utils.labor.listWorkLogs.invalidate()
    },
  })

  const result = calcQuery.data

  function handleCalculate() {
    if (!hoursWorked || !hourlyRate) return
    setHasCalculated(true)
  }

  function handleSaveWorkLog() {
    createWorkLogMutation.mutate({
      facilityId,
      hoursWorked: parseFloat(hoursWorked) || 0,
      hourlyRate: parseFloat(hourlyRate) || 0,
      unitsProduced: parseInt(batchSize, 10) || undefined,
      activityType: saveActivityType as typeof ACTIVITY_OPTIONS[number],
      skuName: saveSkuName || undefined,
      description: saveDescription || undefined,
      employeeId: saveEmployeeId || undefined,
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Input Fields */}
      <div className="card-modern p-6 space-y-4">
        <div>
          <Label htmlFor="hoursWorked">Hours Worked</Label>
          <Input
            id="hoursWorked"
            type="number"
            min={0}
            step={0.25}
            placeholder="e.g., 8"
            value={hoursWorked}
            onChange={(e) => {
              setHoursWorked(e.target.value)
              setHasCalculated(false)
            }}
          />
          <p className="text-xs text-muted-foreground mt-1">Total hours for this task or shift</p>
        </div>

        <div>
          <Label htmlFor="hourlyRate">Hourly Rate ($)</Label>
          <Input
            id="hourlyRate"
            type="number"
            min={0}
            step={0.5}
            placeholder="e.g., 18.50"
            value={hourlyRate}
            onChange={(e) => {
              setHourlyRate(e.target.value)
              setHasCalculated(false)
            }}
          />
          <p className="text-xs text-muted-foreground mt-1">Wage rate for the employee or role</p>
        </div>

        <div>
          <Label htmlFor="batchSize">Batch Size</Label>
          <Input
            id="batchSize"
            type="number"
            min={0}
            step={1}
            placeholder="e.g., pre-rolls packed, jars filled"
            value={batchSize}
            onChange={(e) => {
              setBatchSize(e.target.value)
              setHasCalculated(false)
            }}
          />
          <p className="text-xs text-muted-foreground mt-1">Number of units produced in this batch</p>
        </div>

        <Button onClick={handleCalculate} disabled={!hoursWorked || !hourlyRate}>
          <Calculator className="h-4 w-4 mr-2" />
          Calculate
        </Button>
      </div>

      {/* Results — progressive disclosure */}
      {hasCalculated && result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Cost / Unit"
              value={result.costPerUnit !== null ? `$${result.costPerUnit.toFixed(2)}` : 'N/A'}
              icon={DollarSign}
              color="text-emerald-500"
              isText
            />
            <KpiCard
              label="Units / Hr"
              value={result.unitsPerHour !== null ? result.unitsPerHour.toFixed(1) : 'N/A'}
              icon={Activity}
              color="text-blue-500"
              isText
            />
            <KpiCard
              label="Total Labor Cost"
              value={`$${result.totalLaborCost.toFixed(2)}`}
              icon={Calculator}
              color="text-muted-foreground"
              isText
            />
            <KpiCard
              label="Batch Size"
              value={result.batchSize.toLocaleString()}
              icon={Package}
              color="text-muted-foreground"
              isText
            />
          </div>

          {result.costPerUnit === null && (
            <p className="text-xs text-muted-foreground">
              Cost/Unit shows N/A because batch size must be greater than 0.
            </p>
          )}

          {/* Save as Work Log */}
          <Button variant="outline" onClick={() => setShowSaveDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Save as Work Log
          </Button>
        </>
      )}

      {/* Save Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Work Log</DialogTitle>
            <DialogDescription>
              Record this calculation as a work log entry.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label>Activity Type</Label>
              <Select value={saveActivityType} onValueChange={setSaveActivityType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_OPTIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a.charAt(0) + a.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>SKU Name (optional)</Label>
              <Input
                placeholder="e.g., Blue Dream 1g Pre-Roll"
                value={saveSkuName}
                onChange={(e) => setSaveSkuName(e.target.value)}
              />
            </div>

            <div>
              <Label>Description (optional)</Label>
              <Input
                placeholder="e.g., Morning shift filling run"
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
              />
            </div>

            <div>
              <Label>Employee (optional)</Label>
              <Select value={saveEmployeeId} onValueChange={setSaveEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee..." />
                </SelectTrigger>
                <SelectContent>
                  {(employeesQuery.data as EmployeeRow[] | undefined)?.map((emp: EmployeeRow) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveWorkLog}
              disabled={createWorkLogMutation.isPending}
            >
              {createWorkLogMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save Work Log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Employees Tab
// ---------------------------------------------------------------------------

interface EmployeeDialogState {
  open: boolean
  mode: 'create' | 'edit'
  employeeId?: string
  name: string
  role: string
  hourlyRate: string
  notes: string
}

const emptyDialog: EmployeeDialogState = {
  open: false,
  mode: 'create',
  name: '',
  role: '',
  hourlyRate: '',
  notes: '',
}

function EmployeesTab({ facilityId }: { facilityId: string }) {
  const [dialog, setDialog] = useState<EmployeeDialogState>(emptyDialog)
  const utils = trpc.useUtils()

  const employeesQuery = trpc.labor.listEmployees.useQuery(
    { facilityId, includeInactive: true },
    { staleTime: 30_000 },
  )

  const createMutation = trpc.labor.createEmployee.useMutation({
    onSuccess: () => {
      setDialog(emptyDialog)
      utils.labor.listEmployees.invalidate()
    },
  })

  const updateMutation = trpc.labor.updateEmployee.useMutation({
    onSuccess: () => {
      setDialog(emptyDialog)
      utils.labor.listEmployees.invalidate()
    },
  })

  const deleteMutation = trpc.labor.deleteEmployee.useMutation({
    onSuccess: () => {
      utils.labor.listEmployees.invalidate()
    },
  })

  const isSaving = createMutation.isPending || updateMutation.isPending

  function openCreate() {
    setDialog({ ...emptyDialog, open: true, mode: 'create' })
  }

  function openEdit(emp: { id: string; name: string; role: string | null; hourlyRate: number; notes: string | null }) {
    setDialog({
      open: true,
      mode: 'edit',
      employeeId: emp.id,
      name: emp.name,
      role: emp.role ?? '',
      hourlyRate: String(emp.hourlyRate),
      notes: emp.notes ?? '',
    })
  }

  function handleSave() {
    if (dialog.mode === 'create') {
      createMutation.mutate({
        facilityId,
        name: dialog.name,
        role: dialog.role || undefined,
        hourlyRate: parseFloat(dialog.hourlyRate) || 0,
        notes: dialog.notes || undefined,
      })
    } else if (dialog.employeeId) {
      updateMutation.mutate({
        facilityId,
        employeeId: dialog.employeeId,
        name: dialog.name,
        role: dialog.role || undefined,
        hourlyRate: parseFloat(dialog.hourlyRate) || undefined,
        notes: dialog.notes || undefined,
      })
    }
  }

  function handleDeactivate(employeeId: string) {
    deleteMutation.mutate({ facilityId, employeeId })
  }

  const employees = (employeesQuery.data ?? []) as EmployeeRow[]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          New Employee
        </Button>
      </div>

      {employees.length === 0 && !employeesQuery.isLoading && (
        <EmptyState
          icon={Users}
          title="No Employees Yet"
          description="Add employees to track labor costs and productivity."
          variant="onboarding"
        />
      )}

      {employeesQuery.isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {employees.map((emp: EmployeeRow) => (
          <div
            key={emp.id}
            className={cn(
              'card-modern p-4 cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all',
              !emp.isActive && 'opacity-60',
            )}
            onClick={() => openEdit(emp)}
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-semibold">{emp.name}</p>
                {emp.role && (
                  <Badge variant="outline" className="mt-1 text-xs">
                    {emp.role}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs',
                    emp.isActive
                      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                      : 'bg-red-500/10 text-red-500 border-red-500/20',
                  )}
                >
                  {emp.isActive ? 'Active' : 'Inactive'}
                </Badge>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openEdit(emp)
                  }}
                  className="p-1 rounded hover:bg-accent"
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
            <p className="text-lg font-bold text-emerald-500">
              ${emp.hourlyRate.toFixed(2)}<span className="text-sm font-normal text-muted-foreground">/hr</span>
            </p>
          </div>
        ))}
      </div>

      {/* Employee Dialog */}
      <Dialog open={dialog.open} onOpenChange={(open) => setDialog((prev) => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog.mode === 'create' ? 'New Employee' : 'Edit Employee'}</DialogTitle>
            <DialogDescription>
              {dialog.mode === 'create'
                ? 'Add a new employee to track labor costs.'
                : 'Update employee details.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="empName">Name *</Label>
              <Input
                id="empName"
                value={dialog.name}
                onChange={(e) => setDialog((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Employee name"
              />
            </div>

            <div>
              <Label htmlFor="empRole">Role</Label>
              <Input
                id="empRole"
                value={dialog.role}
                onChange={(e) => setDialog((prev) => ({ ...prev, role: e.target.value }))}
                placeholder="e.g., Trimmer, Packager"
              />
            </div>

            <div>
              <Label htmlFor="empRate">Hourly Rate ($) *</Label>
              <Input
                id="empRate"
                type="number"
                min={0}
                step={0.5}
                value={dialog.hourlyRate}
                onChange={(e) => setDialog((prev) => ({ ...prev, hourlyRate: e.target.value }))}
                placeholder="e.g., 18.50"
              />
            </div>

            <div>
              <Label htmlFor="empNotes">Notes</Label>
              <Input
                id="empNotes"
                value={dialog.notes}
                onChange={(e) => setDialog((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Optional notes"
              />
            </div>
          </div>

          <DialogFooter>
            {dialog.mode === 'edit' && dialog.employeeId && (
              <Button
                variant="destructive"
                className="mr-auto"
                onClick={() => {
                  handleDeactivate(dialog.employeeId!)
                  setDialog(emptyDialog)
                }}
                disabled={deleteMutation.isPending}
              >
                Deactivate
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialog(emptyDialog)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !dialog.name || !dialog.hourlyRate}
            >
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {dialog.mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
