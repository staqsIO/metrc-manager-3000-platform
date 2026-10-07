'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Globe,
  Package,
  ShieldAlert,
  Users,
  BarChart3,
  Boxes,
  Truck,
  Calculator,
  FileText,
  Sparkles,
  Clock,
  Zap,
  ClipboardCheck,
  AlertTriangle,
  AlertCircle,
  Info,
  Handshake,
  Building2,
  CircleDollarSign,
  Activity,
  Warehouse,
  Scissors,
  Sprout,
  TrendingUp,
  DollarSign,
  Settings,
  Layers,
  Megaphone,
  BookOpen,
  Database,
  Leaf,
  MapPin,
} from 'lucide-react'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandLoading,
} from '@/shared/components/ui/command'
import { cn } from '@/lib/utils'
import { trpc } from '@/lib/trpc-client'
import { useCopilot } from '@/features/copilot/CopilotContext'
import { useFacilityId } from '@/shared/hooks/useFacilityId'
import { getEnvironmentDotColor } from '@/shared/utils/environment'
import type { FacilityItem } from '@/features/facilities/types'

const navigationItems = [
  // Global pages
  { name: 'Executive', href: '/executive', icon: Globe, scope: 'global', keywords: 'home overview briefing executive rollup' },
  { name: 'Facilities', href: '/facilities', icon: Building2, scope: 'global', keywords: 'locations licenses sites' },
  { name: 'Financials', href: '/financials', icon: CircleDollarSign, scope: 'global', keywords: 'revenue cost margin P&L' },
  { name: 'Cross-Facility', href: '/operations', icon: Activity, scope: 'global', keywords: 'multi-facility compare MSO' },
  // Facility-scoped pages
  { name: 'Inventory', href: '/inventory', icon: Package, scope: 'facility', keywords: 'active packages stock' },
  { name: 'Aging Analysis', href: '/inventory/aging', icon: Clock, scope: 'facility', keywords: 'old expiring shelf life' },
  { name: 'Compliance', href: '/compliance', icon: ShieldAlert, scope: 'facility', keywords: 'alerts rules violations' },
  { name: 'Audit Trail', href: '/compliance/audit', icon: ClipboardCheck, scope: 'facility', keywords: 'history action log' },
  { name: 'Operations', href: '/operations', icon: Users, scope: 'facility', keywords: 'transfers employees' },
  { name: 'Reconciliation', href: '/operations/reconciliation', icon: Layers, scope: 'facility', keywords: 'dutchie POS mismatch' },
  { name: 'Analytics', href: '/analytics', icon: BarChart3, scope: 'facility', keywords: 'metrics overview' },
  { name: 'Strain Analysis', href: '/analytics/strains', icon: BarChart3, scope: 'facility', keywords: 'genetics THC CBD terpenes' },
  { name: 'Yield Tracking', href: '/analytics/yields', icon: BarChart3, scope: 'facility', keywords: 'harvest yield efficiency' },
  { name: 'Package Intelligence', href: '/packages', icon: Boxes, scope: 'facility', keywords: 'fragmentation consolidation' },
  { name: 'Biomass', href: '/packages/biomass', icon: Boxes, scope: 'facility', keywords: 'trim shake extraction distillate' },
  { name: 'Provenance', href: '/packages/provenance', icon: Boxes, scope: 'facility', keywords: 'lineage source chain of custody' },
  { name: 'Fulfillment', href: '/fulfillment', icon: Truck, scope: 'facility', keywords: 'transfer risk shipping' },
  { name: 'Supply Inventory', href: '/supply', icon: Warehouse, scope: 'facility', keywords: 'raw materials inputs supply chain' },
  { name: 'Bill of Materials', href: '/supply/bom', icon: Warehouse, scope: 'facility', keywords: 'BOM recipe components manufacturing' },
  { name: 'Low Stock Alerts', href: '/supply/alerts', icon: Warehouse, scope: 'facility', keywords: 'reorder shortage out of stock' },
  { name: 'Tolling', href: '/tolling', icon: Calculator, scope: 'facility', keywords: 'contract manufacturing processing fees' },
  { name: 'OpEx Calculator', href: '/opex', icon: TrendingUp, scope: 'facility', keywords: 'operating expenses cost model' },
  { name: 'Harvests', href: '/harvests', icon: Scissors, scope: 'facility', keywords: 'active harvests harvest batches' },
  { name: 'Plant Batches', href: '/plant-batches', icon: Sprout, scope: 'facility', keywords: 'plants vegetative flowering growth' },
  { name: 'Sales', href: '/sales', icon: DollarSign, scope: 'facility', keywords: 'revenue transactions POS dutchie' },
  { name: 'Run Rates', href: '/run-rates', icon: TrendingUp, scope: 'facility', keywords: 'velocity weeks of supply sell-through' },
  { name: 'Reports', href: '/reports', icon: FileText, scope: 'facility', keywords: 'export download summary' },
  { name: 'Catalog: Strains', href: '/catalog/strains', icon: Database, scope: 'facility', keywords: 'strains genetics indica sativa hybrid THC CBD master list' },
  { name: 'Catalog: Items', href: '/catalog/items', icon: Database, scope: 'facility', keywords: 'items products categories unit of measure master list' },
  { name: 'Catalog: Locations', href: '/catalog/locations', icon: MapPin, scope: 'facility', keywords: 'locations rooms storage areas master list' },
  { name: 'Copilot', href: '/copilot', icon: Sparkles, scope: 'facility', keywords: 'AI assistant ask chat' },
  { name: 'Settings', href: '/settings', icon: Settings, scope: 'global', keywords: 'configuration preferences rules' },
  { name: "What's New", href: '/changelog', icon: Megaphone, scope: 'global', keywords: 'changelog updates new features releases' },
  { name: 'Guide', href: '/guide', icon: BookOpen, scope: 'global', keywords: 'help documentation how-to reference user guide' },
] as const

const severityIcons = {
  CRITICAL: AlertTriangle,
  WARNING: AlertCircle,
  INFO: Info,
} as const

const severityColors = {
  CRITICAL: 'text-red-400',
  WARNING: 'text-yellow-400',
  INFO: 'text-blue-400',
} as const

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const router = useRouter()
  const copilot = useCopilot()

  const facilityId = useFacilityId()

  // Debounce query at 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Custom event listener for sidebar trigger
  useEffect(() => {
    function handleOpen() {
      setOpen(true)
    }
    document.addEventListener('open-command-palette', handleOpen)
    return () => document.removeEventListener('open-command-palette', handleOpen)
  }, [])

  // Reset query when dialog closes
  const handleOpenChange = useCallback((open: boolean) => {
    setOpen(open)
    if (!open) {
      setQuery('')
      setDebouncedQuery('')
    }
  }, [])

  // Navigate and close
  const navigate = useCallback((href: string) => {
    router.push(href)
    setOpen(false)
  }, [router])

  // Package search — gated on `open` so queries don't fire/refetch when dialog is closed
  const shouldSearchPackages = open && debouncedQuery.length >= 2 && !!facilityId
  const packagesQuery = trpc.inventory.getActive.useQuery(
    { facilityId: facilityId!, search: debouncedQuery, pageSize: 8 },
    { enabled: shouldSearchPackages, staleTime: 30_000 },
  )

  // Compliance alerts search — same open gate
  const shouldSearchAlerts = open && debouncedQuery.length >= 2 && !!facilityId
  const alertsQuery = trpc.compliance.getAlerts.useQuery(
    { facilityId: facilityId!, search: debouncedQuery, pageSize: 8 },
    { enabled: shouldSearchAlerts, staleTime: 30_000 },
  )

  // Tolling agreements search — same open gate
  const shouldSearchTolling = open && debouncedQuery.length >= 2 && !!facilityId
  const tollingQuery = trpc.tolling.listAgreements.useQuery(
    { facilityId: facilityId!, search: debouncedQuery, pageSize: 8 },
    { enabled: shouldSearchTolling, staleTime: 30_000 },
  )

  // Catalog: Strains search — same open gate
  const shouldSearchStrains = open && debouncedQuery.length >= 2 && !!facilityId
  const strainsQuery = trpc.catalog.getStrains.useQuery(
    { facilityId: facilityId!, search: debouncedQuery, pageSize: 5 },
    { enabled: shouldSearchStrains, staleTime: 30_000 },
  )

  // Catalog: Items search — same open gate
  const shouldSearchItems = open && debouncedQuery.length >= 2 && !!facilityId
  const itemsQuery = trpc.catalog.getItems.useQuery(
    { facilityId: facilityId!, search: debouncedQuery, pageSize: 5 },
    { enabled: shouldSearchItems, staleTime: 30_000 },
  )

  // Facility list — always fetched when palette is open (cached 60s)
  const facilitiesQuery = trpc.facility.list.useQuery(undefined, {
    enabled: open,
    staleTime: 60_000,
  })
  const allFacilities = (facilitiesQuery.data ?? []) as FacilityItem[]

  // Cross-facility global search — warm index on open, search on query
  const warmMutation = trpc.crossFacility.warmSearchIndex.useMutation()
  const warmFiredRef = useRef(false)

  useEffect(() => {
    if (open && !warmFiredRef.current) {
      warmFiredRef.current = true
      warmMutation.mutate()
    }
    if (!open) {
      warmFiredRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const shouldGlobalSearch = open && debouncedQuery.length >= 2
  const globalSearchQuery = trpc.crossFacility.globalSearch.useQuery(
    { query: debouncedQuery, limit: 20 },
    { enabled: shouldGlobalSearch, staleTime: 30_000 },
  )
  const globalResults = (globalSearchQuery.data ?? []) as Array<{
    id: number
    label: string
    itemName: string
    strainName: string
    category: string
    location: string
    facilityId: string
    facilityName: string
    stateCode: string
  }>

  // Filter / sort facilities for the palette
  const facilityResults = (() => {
    const q = debouncedQuery.toLowerCase()
    if (q.length >= 1) {
      return allFacilities
        .filter((f) =>
          f.name.toLowerCase().includes(q) ||
          f.licenseNumber.toLowerCase().includes(q) ||
          f.stateCode.toLowerCase().includes(q) ||
          (f.facilityType?.toLowerCase().includes(q) ?? false)
        )
        .slice(0, 6)
    }
    // No query — show 3 most recently synced
    return [...allFacilities]
      .sort((a, b) => {
        const aTime = a.lastSyncAt ? new Date(a.lastSyncAt).getTime() : 0
        const bTime = b.lastSyncAt ? new Date(b.lastSyncAt).getTime() : 0
        return bTime - aTime
      })
      .slice(0, 3)
  })()

  const facilityHeading = debouncedQuery.length >= 1 ? 'Switch Facility' : 'Recent Facilities'

  // Extract data with explicit types to avoid TS2589 deep type instantiation in JSX
  const packageItems = (packagesQuery.data?.items ?? []) as unknown as Array<{
    Id: number
    Label: string
    ItemName: string
    ItemCategory: string | null
    ItemStrainName: string | null
    LocationName: string | null
  }>
  const alertItems = (alertsQuery.data?.items ?? []) as unknown as Array<{
    id: string
    title: string
    severity: string
    packageLabel: string | null
  }>
  const tollingItems = (tollingQuery.data ?? []) as unknown as Array<{
    id: string
    partnerName: string
    agreementType: string
    status: string
    partnerLicense: string | null
  }>
  const strainItems = (strainsQuery.data?.strains ?? []) as unknown as Array<{
    id: number
    name: string
    indicaPercentage: number
    sativaPercentage: number
    thcLevel: number
    cbdLevel: number
  }>
  const itemItems = (itemsQuery.data?.items ?? []) as unknown as Array<{
    id: number
    name: string
    category: string
    unitOfMeasure: string
    strainName: string
  }>

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandInput
        placeholder="Search packages, strains, items, alerts..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {(query !== debouncedQuery || globalSearchQuery.isLoading || packagesQuery.isLoading || alertsQuery.isLoading || tollingQuery.isLoading || strainsQuery.isLoading || itemsQuery.isLoading) ? (
            <div className="flex items-center justify-center gap-2 py-2">
              <svg className="h-4 w-4 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              <span>Searching...</span>
            </div>
          ) : (
            'No results found.'
          )}
        </CommandEmpty>

        {/* Navigation */}
        <CommandGroup heading="Navigation">
          {navigationItems.map((item) => {
            const href = item.scope === 'facility' && facilityId
              ? `/facilities/${facilityId}${item.href}`
              : item.scope === 'global'
                ? item.href
                : null
            if (!href) return null
            return (
              <CommandItem
                key={item.name}
                value={`${item.name} ${item.keywords}`}
                onSelect={() => navigate(href)}
              >
                <item.icon className="h-4 w-4 text-muted-foreground" />
                <span>{item.name}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>

        {/* Facilities */}
        {open && facilityResults.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={facilityHeading}>
              {facilityResults.map((f) => (
                  <CommandItem
                    key={f.id}
                    value={`facility ${f.name} ${f.licenseNumber} ${f.stateCode} ${f.facilityType ?? ''}`}
                    onSelect={() => navigate(`/facilities/${f.id}/inventory`)}
                  >
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', getEnvironmentDotColor(f.metrcEnvironment))} />
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      {f.facilityType && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {f.facilityType}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{f.stateCode}</span>
                    </span>
                  </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* All Facilities — cross-facility global search */}
        {shouldGlobalSearch && (
          <>
            <CommandSeparator />
            <CommandGroup heading={globalSearchQuery.isLoading ? 'All Facilities (searching...)' : 'All Facilities'}>
              {globalSearchQuery.isLoading && (
                <CommandLoading>Searching across all facilities...</CommandLoading>
              )}
              {globalResults.map((entry) => (
                <CommandItem
                  key={`${entry.facilityId}-${entry.id}`}
                  value={`global ${entry.label} ${entry.itemName} ${entry.category ?? ''} ${entry.strainName}`}
                  onSelect={() => navigate(`/facilities/${entry.facilityId}/inventory/${entry.id}`)}
                  className="!py-2"
                >
                  <Package className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="text-sm break-words">{entry.itemName}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{entry.label}</span>
                      <span className="text-xs text-muted-foreground">{entry.stateCode} &middot; {entry.facilityName}</span>
                    </div>
                  </div>
                </CommandItem>
              ))}
              {globalSearchQuery.data && globalResults.length === 0 && !globalSearchQuery.isLoading && (
                <CommandItem disabled value="no-global-results">
                  No matching packages across facilities
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        {/* Packages */}
        {shouldSearchPackages && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Packages">
              {packagesQuery.isLoading && (
                <CommandLoading>Searching packages...</CommandLoading>
              )}
              {packageItems.map((pkg) => (
                <CommandItem
                  key={pkg.Label}
                  value={`package ${pkg.Label} ${pkg.ItemName} ${pkg.ItemCategory ?? ''} ${pkg.ItemStrainName ?? ''}`}
                  onSelect={() => navigate(`/facilities/${facilityId}/inventory/${pkg.Id}`)}
                  className="!py-2"
                >
                  <Package className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm break-words">{pkg.ItemName}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{pkg.Label}</span>
                      {(pkg.ItemStrainName || pkg.LocationName) && (
                        <span className="text-xs text-muted-foreground">
                          {[pkg.ItemStrainName, pkg.LocationName].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>
                </CommandItem>
              ))}
              {packagesQuery.data && packageItems.length === 0 && (
                <CommandItem disabled value="no-packages">
                  No matching packages
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        {/* Catalog: Strains */}
        {shouldSearchStrains && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Strains">
              {strainsQuery.isLoading && (
                <CommandLoading>Searching strains...</CommandLoading>
              )}
              {strainItems.map((strain) => {
                const type = strain.indicaPercentage > strain.sativaPercentage ? 'Indica'
                  : strain.sativaPercentage > strain.indicaPercentage ? 'Sativa' : 'Hybrid'
                return (
                  <CommandItem
                    key={strain.id}
                    value={`strain ${strain.name} ${type}`}
                    onSelect={() => navigate(`/facilities/${facilityId}/catalog/strains`)}
                  >
                    <Leaf className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm truncate">{strain.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {type} · THC {strain.thcLevel} · CBD {strain.cbdLevel}
                      </span>
                    </div>
                  </CommandItem>
                )
              })}
              {strainsQuery.data && strainItems.length === 0 && (
                <CommandItem disabled value="no-strains">
                  No matching strains
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        {/* Catalog: Items */}
        {shouldSearchItems && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Items">
              {itemsQuery.isLoading && (
                <CommandLoading>Searching items...</CommandLoading>
              )}
              {itemItems.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`item ${item.name} ${item.category} ${item.strainName}`}
                  onSelect={() => navigate(`/facilities/${facilityId}/catalog/items`)}
                >
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm truncate">{item.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {[item.category, item.strainName, item.unitOfMeasure].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </CommandItem>
              ))}
              {itemsQuery.data && itemItems.length === 0 && (
                <CommandItem disabled value="no-items">
                  No matching items
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        {/* Compliance Alerts */}
        {shouldSearchAlerts && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Compliance Alerts">
              {alertsQuery.isLoading && (
                <CommandLoading>Searching alerts...</CommandLoading>
              )}
              {alertItems.map((alert) => {
                const SevIcon = severityIcons[alert.severity as keyof typeof severityIcons] ?? Info
                const sevColor = severityColors[alert.severity as keyof typeof severityColors] ?? 'text-muted-foreground'
                return (
                  <CommandItem
                    key={alert.id}
                    value={`alert ${alert.title} ${alert.packageLabel ?? ''}`}
                    onSelect={() => navigate(`/facilities/${facilityId}/compliance`)}
                  >
                    <SevIcon className={`h-4 w-4 ${sevColor}`} />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm truncate">{alert.title}</span>
                      {alert.packageLabel && (
                        <span className="font-mono text-xs text-muted-foreground">{alert.packageLabel}</span>
                      )}
                    </div>
                  </CommandItem>
                )
              })}
              {alertsQuery.data && alertItems.length === 0 && (
                <CommandItem disabled value="no-alerts">
                  No matching alerts
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        {/* Tolling Agreements */}
        {shouldSearchTolling && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tolling Agreements">
              {tollingQuery.isLoading && (
                <CommandLoading>Searching agreements...</CommandLoading>
              )}
              {tollingItems.map((agreement) => (
                <CommandItem
                  key={agreement.id}
                  value={`tolling ${agreement.partnerName} ${agreement.partnerLicense ?? ''}`}
                  onSelect={() => navigate(`/facilities/${facilityId}/tolling`)}
                >
                  <Handshake className="h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm truncate">{agreement.partnerName}</span>
                    <span className="text-xs text-muted-foreground">
                      {agreement.agreementType} · {agreement.status}
                    </span>
                  </div>
                </CommandItem>
              ))}
              {tollingQuery.data && tollingItems.length === 0 && (
                <CommandItem disabled value="no-tolling">
                  No matching agreements
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        {/* Quick Actions */}
        <CommandSeparator />
        <CommandGroup heading="Quick Actions">
          <CommandItem
            value="Ask Copilot"
            onSelect={() => {
              setOpen(false)
              copilot.open(query || undefined)
            }}
          >
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span>Ask Copilot{query ? `: "${query}"` : ''}</span>
          </CommandItem>
          {facilityId && (
            <>
              <CommandItem
                value="Run Compliance Evaluation"
                onSelect={() => navigate(`/facilities/${facilityId}/compliance`)}
              >
                <Zap className="h-4 w-4 text-muted-foreground" />
                <span>Run Compliance Evaluation</span>
              </CommandItem>
              <CommandItem
                value="Save Audit Snapshot"
                onSelect={() => navigate(`/facilities/${facilityId}/compliance/audit`)}
              >
                <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                <span>Save Audit Snapshot</span>
              </CommandItem>
            </>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
