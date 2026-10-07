'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Recycle, Package, Lightbulb, ChevronDown, ChevronRight, Sparkles, AlertTriangle, FlaskConical, ShieldAlert } from 'lucide-react'
import PackageLabelLink from '@/features/inventory/components/PackageLabelLink'
import { Badge } from '@/shared/components/ui/badge'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useCopilot } from '@/features/copilot/CopilotContext'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

// ── Local types to avoid deep type instantiation errors ──────────────
// Source of truth: src/services/engines/package-intelligence.ts (BiomassPackage)

interface BiomassPackage {
  label: string
  itemName: string
  itemCategory: string
  quantity: number
  unitOfMeasure: string
  ageDays: number
  location: string
  estimatedValue: 'high' | 'medium' | 'low' | 'minimal'
  valueRemaining: number
  dailyValueLossRate: number
  strain: string
  labTestingState: string
  isOnHold: boolean
  requiresRemediation: boolean
}

interface CategoryData {
  count: number
  totalQuantity: number
  packages: BiomassPackage[]
}

interface RecoveryOpportunity {
  category: string
  packageCount: number
  totalQuantity: number
  unitOfMeasure: string
  suggestedUse: string
  estimatedValueTier: 'high' | 'medium' | 'low' | 'minimal'
}

interface BiomassUtilization {
  totalBiomassPackages: number
  totalQuantityByUnit: Record<string, number>
  byCategory: Record<string, CategoryData>
  recoveryOpportunities: RecoveryOpportunity[]
}

// ── Value tier badge styling ─────────────────────────────────────────

const VALUE_TIER_STYLES: Record<string, string> = {
  high: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  medium: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  low: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
  minimal: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30',
}

function ValueBadge({ tier, valueRemaining }: { tier: string; valueRemaining?: number }) {
  const pct = valueRemaining != null ? `${Math.round(valueRemaining * 100)}%` : null
  return (
    <Badge className={cn('capitalize', VALUE_TIER_STYLES[tier] ?? VALUE_TIER_STYLES.minimal)}>
      {tier}{pct && <span className="ml-1 opacity-70">{pct}</span>}
    </Badge>
  )
}

// ── Compliance badge ─────────────────────────────────────────────────

function ComplianceBadge({ pkg }: { pkg: BiomassPackage }) {
  if (pkg.requiresRemediation) {
    return (
      <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30 text-xs">
        <ShieldAlert className="h-3 w-3 mr-1" />
        Remediation
      </Badge>
    )
  }
  if (pkg.isOnHold) {
    return (
      <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30 text-xs">
        <AlertTriangle className="h-3 w-3 mr-1" />
        On Hold
      </Badge>
    )
  }
  if (pkg.labTestingState === 'TestFailed') {
    return (
      <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30 text-xs">
        <FlaskConical className="h-3 w-3 mr-1" />
        Failed
      </Badge>
    )
  }
  if (pkg.labTestingState === 'TestPassed') {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs">
        <FlaskConical className="h-3 w-3 mr-1" />
        Passed
      </Badge>
    )
  }
  if (pkg.labTestingState === 'NotSubmitted') {
    return (
      <Badge className="bg-gray-500/15 text-gray-500 border-gray-500/30 text-xs">
        Untested
      </Badge>
    )
  }
  if (pkg.labTestingState === 'AwaitingConfirmation') {
    return (
      <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 text-xs">
        Pending
      </Badge>
    )
  }
  return null
}

// ── Urgency row highlight ────────────────────────────────────────────

function getRowClass(pkg: BiomassPackage): string {
  if (pkg.requiresRemediation || pkg.labTestingState === 'TestFailed') return 'bg-red-500/5'
  if (pkg.isOnHold) return 'bg-orange-500/5'
  if (pkg.dailyValueLossRate > 0.05) return 'bg-red-500/5'
  if (pkg.dailyValueLossRate > 0.02) return 'bg-orange-500/5'
  return ''
}

// ── Loading skeleton ─────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="p-8 space-y-8">
      <div>
        <Skeleton className="h-7 w-48 mb-2" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card-modern p-4">
            <Skeleton className="h-4 w-32 mb-2" />
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
      <div>
        <Skeleton className="h-6 w-56 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card-modern p-5">
              <Skeleton className="h-5 w-40 mb-3" />
              <Skeleton className="h-4 w-56 mb-2" />
              <Skeleton className="h-4 w-36" />
            </div>
          ))}
        </div>
      </div>
      <div>
        <Skeleton className="h-6 w-44 mb-4" />
        {[1, 2].map((i) => (
          <div key={i} className="card-modern p-5 mb-4">
            <Skeleton className="h-5 w-64 mb-3" />
            <Skeleton className="h-4 w-48" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Collapsible category section ─────────────────────────────────────

function CategorySection({
  categoryName,
  data,
}: {
  categoryName: string
  data: CategoryData
}) {
  const [isOpen, setIsOpen] = useState(false)

  const complianceIssues = data.packages.filter(p => p.isOnHold || p.requiresRemediation || p.labTestingState === 'TestFailed').length

  return (
    <div className="card-modern overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <div>
            <h4 className="font-semibold">{categoryName}</h4>
            <p className="text-sm text-muted-foreground">
              {data.count.toLocaleString()} package{data.count !== 1 ? 's' : ''} &middot;{' '}
              {data.totalQuantity.toLocaleString()} total quantity
              {complianceIssues > 0 && (
                <span className="text-red-500 ml-2">
                  &middot; {complianceIssues} compliance issue{complianceIssues !== 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
        </div>
        <Badge variant="secondary">{data.count}</Badge>
      </button>

      {isOpen && (
        <div className="border-t border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Strain</TableHead>
                <TableHead>Item Name</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Age (days)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.packages.map((pkg) => (
                <TableRow key={pkg.label} className={getRowClass(pkg)}>
                  <TableCell><PackageLabelLink label={pkg.label} /></TableCell>
                  <TableCell className="text-muted-foreground">{pkg.strain || '—'}</TableCell>
                  <TableCell>{pkg.itemName}</TableCell>
                  <TableCell className="text-right">
                    {pkg.quantity.toLocaleString()} {pkg.unitOfMeasure}
                  </TableCell>
                  <TableCell className={cn(
                    'text-right',
                    pkg.dailyValueLossRate > 0.05 && 'text-red-500 font-semibold',
                    pkg.dailyValueLossRate > 0.02 && pkg.dailyValueLossRate <= 0.05 && 'text-orange-500 font-semibold',
                  )}>
                    {pkg.ageDays}
                    {pkg.dailyValueLossRate > 0.02 && (
                      <span className="ml-1 text-xs">!</span>
                    )}
                  </TableCell>
                  <TableCell><ComplianceBadge pkg={pkg} /></TableCell>
                  <TableCell>
                    <ValueBadge tier={pkg.estimatedValue} valueRemaining={pkg.valueRemaining} />
                  </TableCell>
                </TableRow>
              ))}
              {data.packages.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    No packages in this category
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────

export default function BiomassPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string
  const { open: openCopilot } = useCopilot()

  const { data: rawData, isLoading } = trpc.packages.biomassUtilization.useQuery(
    { facilityId },
    { enabled: !!facilityId, staleTime: 300_000 }
  )

  const data = rawData as unknown as BiomassUtilization | undefined

  if (isLoading) {
    return <LoadingSkeleton />
  }

  if (!data) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Biomass Utilization</h1>
          <p className="text-muted-foreground mt-1">Biomass recovery and value analysis</p>
        </div>
        <div className="card-modern p-12 text-center">
          <Recycle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Biomass Data</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            No biomass packages found for this facility. Biomass utilization data will appear here
            once biomass packages are tracked in inventory.
          </p>
        </div>
      </div>
    )
  }

  const categoryEntries = Object.entries(data.byCategory)
  const quantityEntries = Object.entries(data.totalQuantityByUnit)
  const allPackages = Object.values(data.byCategory).flatMap(c => c.packages)
  const complianceIssues = allPackages.filter(p => p.isOnHold || p.requiresRemediation || p.labTestingState === 'TestFailed').length
  const freshFrozenUrgent = allPackages.filter(p => p.itemCategory === 'Wet Whole Plants' && p.ageDays >= 3).length

  // Build a natural Copilot prefill summarizing what the operator has
  const buildCopilotMessage = () => {
    const parts: string[] = ['What are the best processing recommendations for my current biomass inventory?']
    for (const [cat, catData] of Object.entries(data.byCategory)) {
      const totalQty = catData.totalQuantity.toLocaleString()
      const unit = catData.packages[0]?.unitOfMeasure ?? 'units'
      const strains = Array.from(new Set(catData.packages.map(p => p.strain).filter(Boolean)))
      parts.push(`- ${totalQty} ${unit} of ${cat}${strains.length > 0 ? ` (${strains.join(', ')})` : ''}`)
    }
    if (complianceIssues > 0) parts.push(`\n${complianceIssues} packages have compliance issues that need attention.`)
    if (freshFrozenUrgent > 0) parts.push(`${freshFrozenUrgent} fresh frozen packages need urgent processing.`)
    return parts.join('\n')
  }

  return (
    <div className="p-8">
      {/* Header with Copilot CTA */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Biomass Utilization</h1>
          <p className="text-muted-foreground mt-1">
            Track biomass recovery opportunities and maximize value from plant material
          </p>
        </div>
        <button
          onClick={() => openCopilot(buildCopilotMessage())}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium transition-colors"
        >
          <Sparkles className="h-4 w-4" />
          Ask Copilot for Recommendations
        </button>
      </div>

      {/* ── Summary Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        {/* Total Biomass Packages */}
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-4 w-4 text-foreground" />
            <span className="text-xs text-muted-foreground">Total Biomass Packages</span>
          </div>
          <p className="text-2xl font-bold">{data.totalBiomassPackages.toLocaleString()}</p>
        </div>

        {/* Total Quantity by Unit */}
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Recycle className="h-4 w-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground">Total Quantity</span>
          </div>
          {quantityEntries.length > 0 ? (
            <div className="space-y-0.5">
              {quantityEntries.map(([unit, qty]) => (
                <p key={unit} className="text-2xl font-bold text-emerald-500">
                  {qty.toLocaleString()}{' '}
                  <span className="text-sm font-medium text-muted-foreground">{unit}</span>
                </p>
              ))}
            </div>
          ) : (
            <p className="text-2xl font-bold text-muted-foreground">0</p>
          )}
        </div>

        {/* Compliance Issues */}
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <span className="text-xs text-muted-foreground">Compliance Issues</span>
          </div>
          <p className={cn('text-2xl font-bold', complianceIssues > 0 ? 'text-red-500' : 'text-emerald-500')}>
            {complianceIssues}
          </p>
        </div>

        {/* Recovery Opportunities */}
        <div className="card-modern p-4">
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb className="h-4 w-4 text-yellow-500" />
            <span className="text-xs text-muted-foreground">Recovery Opportunities</span>
          </div>
          <p className="text-2xl font-bold text-yellow-500">
            {data.recoveryOpportunities.length.toLocaleString()}
          </p>
        </div>
      </div>

      {/* ── Fresh Frozen Urgency Banner ────────────────────────────── */}
      {freshFrozenUrgent > 0 && (
        <div className="mb-6 p-4 rounded-lg border border-orange-500/30 bg-orange-500/10">
          <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <p className="text-sm font-medium">
              {freshFrozenUrgent} fresh frozen package{freshFrozenUrgent !== 1 ? 's' : ''} aging
              &mdash; process immediately for maximum terpene preservation.
            </p>
          </div>
        </div>
      )}

      {/* ── Recovery Opportunities ────────────────────────────────── */}
      {data.recoveryOpportunities.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-yellow-500" />
            Recovery Opportunities
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.recoveryOpportunities.map((opp, idx) => (
              <div key={idx} className="card-modern p-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold">{opp.category}</h4>
                  <ValueBadge tier={opp.estimatedValueTier} />
                </div>
                <div className="space-y-1.5 text-sm">
                  <p className="text-muted-foreground">
                    <span className="text-foreground font-medium">
                      {opp.packageCount.toLocaleString()}
                    </span>{' '}
                    package{opp.packageCount !== 1 ? 's' : ''} &middot;{' '}
                    <span className="text-foreground font-medium">
                      {opp.totalQuantity.toLocaleString()}
                    </span>{' '}
                    {opp.unitOfMeasure}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Suggested use:</span>{' '}
                    <span className="text-foreground">{opp.suggestedUse}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── By Category ──────────────────────────────────────────── */}
      {categoryEntries.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Recycle className="h-5 w-5 text-emerald-500" />
            By Category
          </h2>
          <div className="space-y-3">
            {categoryEntries.map(([name, catData]) => (
              <CategorySection key={name} categoryName={name} data={catData as CategoryData} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
