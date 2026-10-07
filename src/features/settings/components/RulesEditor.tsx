'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Badge } from '@/shared/components/ui/badge'
import { Switch } from '@/shared/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Button } from '@/shared/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { Plus, Pencil, Trash2, RotateCcw, Loader2, Shield } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────

interface RulesEditorProps {
  facilityId: string
}

interface Condition {
  field: string
  operator: string
  value: string | number | boolean | string[]
  itemCategory?: string
}

interface BusinessRule {
  id: string
  facilityId: string
  name: string
  description: string | null
  category: string
  isActive: boolean
  isDefault: boolean
  severity: string
  conditions: unknown
  actionType: string | null
  metadata: unknown
  createdAt: string
  updatedAt: string
}

// ── Constants ──────────────────────────────────────────────────────

const CATEGORIES = ['aging', 'inventory', 'compliance', 'operations', 'discount'] as const

const CATEGORY_LABELS: Record<string, string> = {
  aging: 'Aging',
  inventory: 'Inventory',
  compliance: 'Compliance',
  operations: 'Operations',
  discount: 'Discount',
}

const SEVERITY_OPTIONS = ['INFO', 'WARNING', 'CRITICAL'] as const

const ACTION_TYPES = ['ALERT', 'NOTIFICATION', 'BLOCK', 'DISCOUNT_RECOMMEND', 'AUTO_DISCOUNT', 'PROMO_FLAG', 'CONSOLIDATE', 'SAMPLE_OUT'] as const

const CONDITION_FIELDS = [
  'ageDays',
  'Quantity',
  'LabTestingState',
  'IsOnHold',
  'ProductRequiresRemediation',
  'ItemCategory',
  'LocationName',
] as const

const OPERATORS = [
  { value: 'gt', label: '> (greater than)' },
  { value: 'lt', label: '< (less than)' },
  { value: 'gte', label: '>= (greater or equal)' },
  { value: 'lte', label: '<= (less or equal)' },
  { value: 'eq', label: '= (equals)' },
  { value: 'neq', label: '!= (not equals)' },
  { value: 'contains', label: 'contains' },
] as const

// ── Helpers ────────────────────────────────────────────────────────

function severityColor(severity: string): string {
  switch (severity) {
    case 'CRITICAL':
      return 'bg-red-500/15 text-red-600 border-red-500/30'
    case 'WARNING':
      return 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30'
    case 'INFO':
      return 'bg-blue-500/15 text-blue-600 border-blue-500/30'
    default:
      return ''
  }
}

function parseConditions(raw: unknown): Condition[] {
  if (Array.isArray(raw)) return raw as Condition[]
  return []
}

const emptyCondition: Condition = { field: 'ageDays', operator: 'gt', value: '' }

interface RuleFormState {
  name: string
  description: string
  category: string
  severity: string
  actionType: string
  conditions: Condition[]
}

const defaultFormState: RuleFormState = {
  name: '',
  description: '',
  category: 'compliance',
  severity: 'WARNING',
  actionType: 'ALERT',
  conditions: [{ ...emptyCondition }],
}

// ── Component ──────────────────────────────────────────────────────

export function RulesEditor({ facilityId }: RulesEditorProps) {
  const utils = trpc.useUtils()

  // ── Queries ──────────────────────────────────────────────────────

  const {
    data: rules,
    isLoading,
    error,
  } = trpc.rules.list.useQuery({ facilityId })

  const typedRules = (rules ?? []) as unknown as BusinessRule[]

  // ── Mutations ────────────────────────────────────────────────────

  const createRule = trpc.rules.create.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate({ facilityId })
      closeDialog()
    },
  })

  const updateRule = trpc.rules.update.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate({ facilityId })
      closeDialog()
    },
  })

  const deleteRule = trpc.rules.delete.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate({ facilityId })
    },
  })

  const toggleActive = trpc.rules.toggleActive.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate({ facilityId })
    },
  })

  const seedDefaults = trpc.rules.seedDefaults.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate({ facilityId })
    },
  })

  const resetToDefaults = trpc.rules.resetToDefaults.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate({ facilityId })
      setShowResetConfirm(false)
    },
  })

  // ── State ────────────────────────────────────────────────────────

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [form, setForm] = useState<RuleFormState>({ ...defaultFormState })
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // ── Dialog helpers ───────────────────────────────────────────────

  function openCreateDialog() {
    setEditingRuleId(null)
    setForm({ ...defaultFormState, conditions: [{ ...emptyCondition }] })
    setDialogOpen(true)
  }

  function openEditDialog(rule: BusinessRule) {
    setEditingRuleId(rule.id)
    setForm({
      name: rule.name,
      description: rule.description ?? '',
      category: rule.category,
      severity: rule.severity,
      actionType: rule.actionType ?? 'ALERT',
      conditions: parseConditions(rule.conditions).length > 0
        ? parseConditions(rule.conditions)
        : [{ ...emptyCondition }],
    })
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditingRuleId(null)
    setForm({ ...defaultFormState })
  }

  // ── Form handlers ───────────────────────────────────────────────

  function addCondition() {
    setForm((prev) => ({
      ...prev,
      conditions: [...prev.conditions, { ...emptyCondition }],
    }))
  }

  function removeCondition(index: number) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== index),
    }))
  }

  function updateCondition(index: number, patch: Partial<Condition>) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.map((c, i) =>
        i === index ? { ...c, ...patch } : c
      ),
    }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.conditions.length === 0) return

    // Coerce numeric values
    const conditions = form.conditions.map((c) => {
      const numVal = Number(c.value)
      return {
        field: c.field,
        operator: c.operator as 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq' | 'contains' | 'not_contains' | 'in' | 'not_in',
        value: !isNaN(numVal) && typeof c.value === 'string' && c.value.trim() !== '' && c.field !== 'ItemCategory' && c.field !== 'LocationName' && c.field !== 'LabTestingState'
          ? numVal
          : c.value,
        ...(c.itemCategory ? { itemCategory: c.itemCategory } : {}),
      }
    })

    if (editingRuleId) {
      updateRule.mutate({
        facilityId,
        ruleId: editingRuleId,
        name: form.name,
        description: form.description || undefined,
        severity: form.severity as 'INFO' | 'WARNING' | 'CRITICAL',
        conditions,
        actionType: form.actionType as typeof ACTION_TYPES[number],
      })
    } else {
      createRule.mutate({
        facilityId,
        name: form.name,
        description: form.description || undefined,
        category: form.category,
        severity: form.severity as 'INFO' | 'WARNING' | 'CRITICAL',
        conditions,
        actionType: form.actionType as typeof ACTION_TYPES[number],
      })
    }
  }

  // ── Group rules by category ──────────────────────────────────────

  const grouped = CATEGORIES.reduce<Record<string, BusinessRule[]>>((acc, cat) => {
    acc[cat] = typedRules.filter(r => r.category === cat)
    return acc
  }, {} as Record<string, BusinessRule[]>)

  const totalRules = typedRules.length
  const isMutating =
    createRule.isPending ||
    updateRule.isPending ||
    deleteRule.isPending ||
    toggleActive.isPending ||
    seedDefaults.isPending ||
    resetToDefaults.isPending

  // ── Loading skeleton ─────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-28" />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-6 w-32" />
            <div className="card-modern p-4 space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Error state ──────────────────────────────────────────────────

  if (error) {
    return (
      <div className="card-modern p-8 text-center">
        <Shield className="h-10 w-10 text-destructive mx-auto mb-3" />
        <h3 className="text-lg font-semibold mb-1">Failed to load rules</h3>
        <p className="text-sm text-muted-foreground">{error.message}</p>
      </div>
    )
  }

  // ── Empty state ──────────────────────────────────────────────────

  if (totalRules === 0) {
    return (
      <div className="card-modern p-12 text-center">
        <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Business Rules</h3>
        <p className="text-muted-foreground max-w-md mx-auto mb-6">
          Business rules let you define thresholds and conditions for automated
          alerts, notifications, and compliance blocks.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button
            onClick={() => seedDefaults.mutate({ facilityId })}
            disabled={seedDefaults.isPending}
          >
            {seedDefaults.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Shield className="mr-2 h-4 w-4" />
            )}
            Seed Default Rules
          </Button>
          <Button variant="outline" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Create Custom Rule
          </Button>
        </div>
      </div>
    )
  }

  // ── Main render ──────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {totalRules} rule{totalRules !== 1 ? 's' : ''} configured
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowResetConfirm(true)}
            disabled={isMutating}
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Reset to Defaults
          </Button>
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Add Rule
          </Button>
        </div>
      </div>

      {/* Rules grouped by category */}
      {CATEGORIES.map((category) => {
        const catRules = grouped[category]
        if (!catRules || catRules.length === 0) return null

        return (
          <div key={category}>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {CATEGORY_LABELS[category]}
              </h3>
              <Badge variant="secondary" className="text-xs">
                {catRules.length}
              </Badge>
            </div>

            <div className="space-y-2">
              {catRules.map((rule) => (
                <div
                  key={rule.id}
                  className={cn(
                    'card-modern flex items-center gap-4 px-4 py-3 transition-opacity',
                    !rule.isActive && 'opacity-60'
                  )}
                >
                  {/* Toggle */}
                  <Switch
                    checked={rule.isActive}
                    onCheckedChange={(checked) =>
                      toggleActive.mutate({
                        facilityId,
                        ruleId: rule.id,
                        isActive: checked,
                      })
                    }
                    disabled={toggleActive.isPending}
                  />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {rule.name}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn('text-xs shrink-0', severityColor(rule.severity))}
                      >
                        {rule.severity}
                      </Badge>
                      {rule.isDefault && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          Default
                        </Badge>
                      )}
                    </div>
                    {rule.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {rule.description}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditDialog(rule)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirmId(rule.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* ── Create / Edit Dialog ────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRuleId ? 'Edit Rule' : 'Create Rule'}
            </DialogTitle>
            <DialogDescription>
              {editingRuleId
                ? 'Modify the rule configuration below.'
                : 'Define a new business rule with conditions and actions.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="rule-name">Name *</Label>
              <Input
                id="rule-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., Aging threshold for flower"
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="rule-description">Description</Label>
              <Input
                id="rule-description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Optional description of what this rule does"
              />
            </div>

            {/* Category / Severity / Action Type */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(val) => setForm({ ...form, category: val })}
                  disabled={!!editingRuleId}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {CATEGORY_LABELS[cat]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Severity</Label>
                <Select
                  value={form.severity}
                  onValueChange={(val) => setForm({ ...form, severity: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Action Type</Label>
                <Select
                  value={form.actionType}
                  onValueChange={(val) =>
                    setForm({ ...form, actionType: val })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Conditions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Conditions</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addCondition}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add Condition
                </Button>
              </div>

              {form.conditions.map((condition, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border p-3 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Condition {idx + 1}
                    </span>
                    {form.conditions.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-destructive hover:text-destructive"
                        onClick={() => removeCondition(idx)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {/* Field */}
                    <div className="space-y-1">
                      <Label className="text-xs">Field</Label>
                      <Select
                        value={condition.field}
                        onValueChange={(val) =>
                          updateCondition(idx, { field: val })
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONDITION_FIELDS.map((f) => (
                            <SelectItem key={f} value={f}>
                              {f}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Operator */}
                    <div className="space-y-1">
                      <Label className="text-xs">Operator</Label>
                      <Select
                        value={condition.operator}
                        onValueChange={(val) =>
                          updateCondition(idx, { operator: val })
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPERATORS.map((op) => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Value */}
                    <div className="space-y-1">
                      <Label className="text-xs">Value</Label>
                      <Input
                        className="h-9"
                        value={String(condition.value)}
                        onChange={(e) =>
                          updateCondition(idx, { value: e.target.value })
                        }
                        placeholder="e.g., 30"
                        required
                      />
                    </div>
                  </div>

                  {/* Item Category filter */}
                  <div className="space-y-1">
                    <Label className="text-xs">
                      Item Category Filter{' '}
                      <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      className="h-9"
                      value={condition.itemCategory ?? ''}
                      onChange={(e) =>
                        updateCondition(idx, {
                          itemCategory: e.target.value || undefined,
                        })
                      }
                      placeholder="e.g., Flower, Concentrate"
                    />
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeDialog}
                disabled={createRule.isPending || updateRule.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createRule.isPending ||
                  updateRule.isPending ||
                  !form.name.trim() ||
                  form.conditions.length === 0
                }
              >
                {createRule.isPending || updateRule.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {editingRuleId ? 'Save Changes' : 'Create Rule'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ──────────────────────────── */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Rule</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this rule? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmId(null)}
              disabled={deleteRule.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteRule.isPending}
              onClick={() => {
                if (deleteConfirmId) {
                  deleteRule.mutate(
                    { facilityId, ruleId: deleteConfirmId },
                    {
                      onSuccess: () => setDeleteConfirmId(null),
                    }
                  )
                }
              }}
            >
              {deleteRule.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Confirmation Dialog ───────────────────────────── */}
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset to Defaults</DialogTitle>
            <DialogDescription>
              This will delete all existing rules for this facility and replace
              them with the default rule set. Any custom rules will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResetConfirm(false)}
              disabled={resetToDefaults.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={resetToDefaults.isPending}
              onClick={() => resetToDefaults.mutate({ facilityId })}
            >
              {resetToDefaults.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Reset All Rules
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
