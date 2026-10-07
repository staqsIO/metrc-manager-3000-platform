'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Settings2,
  ShieldCheck,
  Gauge,
  TrendingDown,
  Plus,
  Trash2,
  ArrowLeft,
  Check,
  Loader2,
  DollarSign,
  Clock,
  Play,
  Layers,
} from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Switch } from '@/shared/components/ui/switch'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { KpiCard } from '@/shared/components/KpiCard'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog'

interface DiscountTier {
  ageDays: number
  discountPct: number
}

interface PlanItem {
  packageLabel: string
  productId: number
  productName: string
  oldPrice: number
  newPrice: number
  discountPct: number
  score: number
  ageDays: number
  category: string
  priority: string
}

interface PreviewResult {
  runId: string
  status: string
  plan: {
    items: PlanItem[]
    estimatedRevenueImpact: number
    totalRecommendations: number
  }
}

type RunNowStep = 'previewing' | 'confirming' | 'completed' | 'error'

function formatRelativeDate(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  const color =
    status === 'COMPLETED' ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
    : status === 'FAILED' ? 'bg-red-500/15 text-red-500 border-red-500/30'
    : status === 'PREVIEWING' ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
    : 'bg-muted text-muted-foreground'
  return <Badge className={cn('text-xs', color)}>{status}</Badge>
}

export default function AutoConfigPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  const { data: config, isLoading, refetch } = trpc.autoDiscount.getConfig.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 60_000 }
  )

  // Local form state
  const [isEnabled, setIsEnabled] = useState(false)
  const [requireApproval, setRequireApproval] = useState(true)
  const [maxDiscountPct, setMaxDiscountPct] = useState(50)
  const [minPriceFloor, setMinPriceFloor] = useState<string>('')
  const [minScoreThreshold, setMinScoreThreshold] = useState(30)
  const [priorityFilter, setPriorityFilter] = useState<string[]>(['urgent', 'high'])
  const [discountTiers, setDiscountTiers] = useState<DiscountTier[]>([
    { ageDays: 60, discountPct: 10 },
    { ageDays: 90, discountPct: 20 },
    { ageDays: 120, discountPct: 30 },
  ])
  const [useVelocityData, setUseVelocityData] = useState(false)
  const [velocityLookbackDays, setVelocityLookbackDays] = useState(30)
  const [excludedCategories, setExcludedCategories] = useState<string>('')
  const [excludedProductIds, setExcludedProductIds] = useState<string>('')
  const [categoryMaxDiscountPct, setCategoryMaxDiscountPct] = useState<Record<string, number>>({})

  const DEFAULT_ITEM_CATEGORIES = [
    'Buds', 'Shake/Trim', 'Concentrate', 'Edible', 'Pre-Roll',
    'Tincture', 'Topical', 'Capsule', 'Vape Cartridge',
    'Infused (Edible)', 'Infused (Non-Edible)',
  ]

  // Sync from server
  useEffect(() => {
    if (!config) return
    setIsEnabled(config.isEnabled)
    setRequireApproval(config.requireApproval)
    setMaxDiscountPct(config.maxDiscountPct)
    setMinPriceFloor(config.minPriceFloor != null ? String(config.minPriceFloor) : '')
    setMinScoreThreshold(config.minScoreThreshold)
    setPriorityFilter(config.priorityFilter)
    setDiscountTiers(config.discountTiers.length > 0 ? config.discountTiers : [
      { ageDays: 60, discountPct: 10 },
      { ageDays: 90, discountPct: 20 },
      { ageDays: 120, discountPct: 30 },
    ])
    setUseVelocityData(config.useVelocityData)
    setVelocityLookbackDays(config.velocityLookbackDays)
    setExcludedCategories(config.excludedCategories.join(', '))
    setExcludedProductIds(config.excludedProductIds.join(', '))
    setCategoryMaxDiscountPct(config.categoryMaxDiscountPct ?? {})
  }, [config])

  const { data: dashboardStats } = trpc.autoDiscount.getDashboardStats.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 60_000 }
  )

  const updateConfig = trpc.autoDiscount.updateConfig.useMutation({
    onSuccess: () => { void refetch() },
  })

  // --- Run Now dialog state ---
  const [runNowOpen, setRunNowOpen] = useState(false)
  const [runNowStep, setRunNowStep] = useState<RunNowStep>('previewing')
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)
  const [runNowError, setRunNowError] = useState<string | null>(null)
  const [executeResult, setExecuteResult] = useState<{ succeeded: number } | null>(null)

  const previewMutation = trpc.autoDiscount.preview.useMutation()
  const executeMutation = trpc.autoDiscount.execute.useMutation()

  const startRunNow = useCallback(() => {
    setRunNowStep('previewing')
    setPreviewResult(null)
    setRunNowError(null)
    setExecuteResult(null)
    setRunNowOpen(true)
    previewMutation.mutate(
      { facilityId },
      {
        onSuccess: (data) => {
          setPreviewResult(data as PreviewResult)
          setRunNowStep('confirming')
        },
        onError: (err) => {
          setRunNowError(err.message)
          setRunNowStep('error')
        },
      }
    )
  }, [facilityId, previewMutation])

  const confirmExecute = useCallback(() => {
    if (!previewResult) return
    executeMutation.mutate(
      { facilityId, runId: previewResult.runId },
      {
        onSuccess: (data) => {
          setExecuteResult({ succeeded: data.succeeded })
          setRunNowStep('completed')
          void refetch()
          setTimeout(() => {
            setRunNowOpen(false)
          }, 2000)
        },
        onError: (err) => {
          setRunNowError(err.message)
          setRunNowStep('error')
        },
      }
    )
  }, [facilityId, previewResult, executeMutation, refetch])

  const handleSave = () => {
    updateConfig.mutate({
      facilityId,
      isEnabled,
      requireApproval,
      maxDiscountPct,
      minPriceFloor: minPriceFloor ? Number(minPriceFloor) : null,
      minScoreThreshold,
      priorityFilter: priorityFilter as ('urgent' | 'high' | 'medium' | 'low')[],
      discountTiers: discountTiers.filter(t => t.ageDays > 0 && t.discountPct > 0),
      useVelocityData,
      velocityLookbackDays,
      excludedCategories: excludedCategories.split(',').map(s => s.trim()).filter(Boolean),
      excludedProductIds: excludedProductIds.split(',').map(s => s.trim()).filter(Boolean),
      categoryMaxDiscountPct: Object.keys(categoryMaxDiscountPct).length > 0
        ? categoryMaxDiscountPct
        : null,
    })
  }

  const togglePriority = (p: string) => {
    setPriorityFilter(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    )
  }

  const addTier = () => {
    if (discountTiers.length >= 10) return
    const maxAge = Math.max(...discountTiers.map(t => t.ageDays), 0)
    setDiscountTiers([...discountTiers, { ageDays: maxAge + 30, discountPct: 10 }])
  }

  const removeTier = (idx: number) => {
    if (discountTiers.length <= 1) return
    setDiscountTiers(discountTiers.filter((_, i) => i !== idx))
  }

  const updateTier = (idx: number, field: keyof DiscountTier, value: number) => {
    setDiscountTiers(discountTiers.map((t, i) => i === idx ? { ...t, [field]: value } : t))
  }

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/facilities/${facilityId}/inventory/discounts`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Discount Engine
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Auto-Discount Configuration</h1>
          {config?.lastRunStatus && <StatusBadge status={config.lastRunStatus} />}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure automated discount application based on inventory age and sales velocity.
        </p>
      </div>

      {/* Dashboard Stats */}
      {dashboardStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <KpiCard
            label="Status"
            value={dashboardStats.isEnabled ? 'Enabled' : 'Disabled'}
            icon={Settings2}
            color={dashboardStats.isEnabled ? 'text-emerald-500' : 'text-muted-foreground'}
            isText
          />
          <KpiCard
            label="Active Discounts"
            value={dashboardStats.totalActiveDiscounts}
            icon={TrendingDown}
            color="text-blue-500"
          />
          <KpiCard
            label="Revenue Impact"
            value={dashboardStats.totalRevenueImpact.toFixed(2)}
            icon={DollarSign}
            color="text-emerald-500"
            prefix="$"
          />
          <KpiCard
            label="Last Run"
            value={
              dashboardStats.lastRunAt
                ? formatRelativeDate(new Date(dashboardStats.lastRunAt))
                : 'Never'
            }
            icon={Clock}
            color="text-muted-foreground"
            isText
          />
        </div>
      )}

      {/* Section 1: Enable/Disable */}
      <div className="card-modern p-5 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <Settings2 className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">General</h2>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Enable Auto-Discounting</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                When enabled, the cron job will process this facility daily at 7 AM UTC.
              </p>
            </div>
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Require Approval</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                When on, cron generates previews only. You must approve before prices change.
              </p>
            </div>
            <Switch checked={requireApproval} onCheckedChange={setRequireApproval} />
          </div>
          {config?.lastRunAt && (
            <div className="text-xs text-muted-foreground">
              Last run: {new Date(config.lastRunAt).toLocaleString()}
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Discount Tiers */}
      <div className="card-modern p-5 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <TrendingDown className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Discount Tiers</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Packages matching the highest tier by age receive that discount percentage.
        </p>
        <div className="space-y-2">
          {discountTiers
            .sort((a, b) => a.ageDays - b.ageDays)
            .map((tier, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <Label className="text-xs text-muted-foreground w-20">Age (days)</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={tier.ageDays}
                  onChange={(e) => updateTier(idx, 'ageDays', Number(e.target.value))}
                  className="w-24 h-8 text-sm"
                />
              </div>
              <div className="flex items-center gap-2 flex-1">
                <Label className="text-xs text-muted-foreground w-20">Discount %</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={tier.discountPct}
                  onChange={(e) => updateTier(idx, 'discountPct', Number(e.target.value))}
                  className="w-24 h-8 text-sm"
                />
              </div>
              <button
                onClick={() => removeTier(idx)}
                disabled={discountTiers.length <= 1}
                className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={addTier}
          disabled={discountTiers.length >= 10}
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Tier
        </button>
      </div>

      {/* Section 3: Guard Rails */}
      <div className="card-modern p-5 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Guard Rails</h2>
        </div>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Max Discount %</Label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={maxDiscountPct}
                onChange={(e) => setMaxDiscountPct(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="text-sm font-mono w-12 text-right">{maxDiscountPct}%</span>
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Min Price Floor ($)</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-1">
              No product will be discounted below this price. Leave blank for no floor.
            </p>
            <Input
              type="number"
              min={0}
              step={0.01}
              placeholder="e.g. 5.00"
              value={minPriceFloor}
              onChange={(e) => setMinPriceFloor(e.target.value)}
              className="w-40 h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-sm font-medium">Min Score Threshold</Label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={minScoreThreshold}
                onChange={(e) => setMinScoreThreshold(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="text-sm font-mono w-12 text-right">{minScoreThreshold}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Only packages scoring at or above this threshold will be discounted.
            </p>
          </div>
          <div>
            <Label className="text-sm font-medium mb-2 block">Priority Filter</Label>
            <div className="flex gap-4">
              {(['urgent', 'high', 'medium', 'low'] as const).map(p => (
                <label key={p} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={priorityFilter.includes(p)}
                    onCheckedChange={() => togglePriority(p)}
                  />
                  <span className="text-sm capitalize">{p}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Category Discount Caps */}
      <div className="card-modern p-5 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <Layers className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Category Discount Caps</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Set maximum discount percentages per product category. Categories without an override use the global maximum above.
        </p>
        <div className="space-y-2">
          {DEFAULT_ITEM_CATEGORIES.map((category) => (
            <div key={category} className="flex items-center gap-3">
              <Label className="text-sm w-48 truncate" title={category}>{category}</Label>
              <Input
                type="number"
                min={1}
                max={100}
                step={1}
                placeholder={String(maxDiscountPct)}
                value={categoryMaxDiscountPct[category] ?? ''}
                onChange={(e) => {
                  const val = e.target.value
                  setCategoryMaxDiscountPct(prev => {
                    const next = { ...prev }
                    if (val === '' || Number(val) === maxDiscountPct) {
                      delete next[category]
                    } else {
                      next[category] = Number(val)
                    }
                    return next
                  })
                }}
                className="w-24 h-8 text-sm"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Categories must match Metrc item category names exactly.
        </p>
      </div>

      {/* Section 5: Velocity Integration */}
      <div className="card-modern p-5 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <Gauge className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Velocity Integration</h2>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Use Sales Velocity Data</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Factor in weeks-of-supply from Dutchie POS sales data when scoring packages.
              </p>
            </div>
            <Switch checked={useVelocityData} onCheckedChange={setUseVelocityData} />
          </div>
          {useVelocityData && (
            <div>
              <Label className="text-sm font-medium">Lookback Days</Label>
              <Input
                type="number"
                min={7}
                max={180}
                value={velocityLookbackDays}
                onChange={(e) => setVelocityLookbackDays(Number(e.target.value))}
                className="w-32 h-8 text-sm mt-1"
              />
              <p className="text-xs text-muted-foreground mt-0.5">
                How many days of sales history to use for velocity calculation.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Section 6: Exclusions */}
      <div className="card-modern p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Exclusions</h2>
        </div>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Excluded Categories</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-1">
              Comma-separated list of categories to exclude from auto-discounting.
            </p>
            <Input
              placeholder="e.g. Pre-Rolls, Accessories"
              value={excludedCategories}
              onChange={(e) => setExcludedCategories(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-sm font-medium">Excluded Product IDs</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-1">
              Comma-separated Dutchie product IDs to never discount.
            </p>
            <Input
              placeholder="e.g. 12345, 67890"
              value={excludedProductIds}
              onChange={(e) => setExcludedProductIds(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Save Button + Run Now */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={updateConfig.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {updateConfig.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Save Configuration
        </button>
        <button
          onClick={startRunNow}
          disabled={previewMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md border border-border px-6 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          Run Now
        </button>
        {updateConfig.isSuccess && (
          <span className="text-sm text-emerald-500">Saved!</span>
        )}
        {updateConfig.isError && (
          <span className="text-sm text-red-500">
            {updateConfig.error.message}
          </span>
        )}
      </div>

      {/* Run Now Dialog */}
      <Dialog open={runNowOpen} onOpenChange={setRunNowOpen}>
        <DialogContent className="max-w-lg">
          {runNowStep === 'previewing' && (
            <>
              <DialogHeader>
                <DialogTitle>Run Now</DialogTitle>
                <DialogDescription>
                  Scanning inventory for discount-eligible products...
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            </>
          )}

          {runNowStep === 'confirming' && previewResult && (
            <>
              <DialogHeader>
                <DialogTitle>Confirm Discounts</DialogTitle>
                <DialogDescription>
                  {previewResult.plan.items.length} products eligible
                  {' '}
                  (est. ${Math.abs(previewResult.plan.estimatedRevenueImpact).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} revenue impact)
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-3">Product Name</th>
                      <th className="pb-2 pr-3 text-right">Old Price</th>
                      <th className="pb-2 pr-3 text-right">New Price</th>
                      <th className="pb-2 text-right">Discount%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewResult.plan.items.slice(0, 5).map((item) => (
                      <tr key={item.productId} className="border-b border-border/50">
                        <td className="py-1.5 pr-3 truncate max-w-[200px]">{item.productName}</td>
                        <td className="py-1.5 pr-3 text-right text-muted-foreground">${item.oldPrice.toFixed(2)}</td>
                        <td className="py-1.5 pr-3 text-right text-emerald-500">${item.newPrice.toFixed(2)}</td>
                        <td className="py-1.5 text-right">{item.discountPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewResult.plan.items.length > 5 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    ...and {previewResult.plan.items.length - 5} more
                  </p>
                )}
              </div>
              <DialogFooter>
                <button
                  onClick={() => setRunNowOpen(false)}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmExecute}
                  disabled={executeMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {executeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Apply {previewResult.plan.items.length} Discounts
                </button>
              </DialogFooter>
            </>
          )}

          {runNowStep === 'completed' && executeResult && (
            <>
              <DialogHeader>
                <DialogTitle>Discounts Applied</DialogTitle>
                <DialogDescription>
                  {executeResult.succeeded} discounts applied. Prices updated in Dutchie.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-center py-6">
                <Check className="h-10 w-10 text-emerald-500" />
              </div>
            </>
          )}

          {runNowStep === 'error' && (
            <>
              <DialogHeader>
                <DialogTitle>Error</DialogTitle>
                <DialogDescription>
                  {runNowError ?? 'An unexpected error occurred.'}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <button
                  onClick={() => setRunNowOpen(false)}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={startRunNow}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Retry
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
