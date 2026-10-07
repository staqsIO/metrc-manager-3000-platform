'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { signOutWithCleanup } from '@/lib/active-org'
import { cn } from '@/lib/utils'
import FacilitySwitcher from './FacilitySwitcher'
import OrgSwitcher from './OrgSwitcher'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import {
  // LayoutDashboard,  — Dashboard removed
  Building2,
  Package,
  ShieldAlert,
  Users,
  BarChart3,
  // Boxes,
  Truck,
  // Calculator,
  MapPin,
  FileText,
  Settings,
  ChevronRight,
  Sparkles,
  Search,
  Scissors,
  TrendingUp,
  // Warehouse,
  Sprout,
  DollarSign,
  // Activity,  — Cross-Facility nav hidden
  Store,
  Megaphone,
  // ClipboardList,
  BookOpen,
  LogOut,
  ArrowLeftRight,
  Leaf,
  FlaskConical,
  // Cog,
  Database,
  Globe,
  GitBranch,
  Trash2,
  Upload,
  Cpu,
  type LucideIcon,
} from 'lucide-react'
import { useCopilot } from '@/features/copilot/CopilotContext'

const SIDEBAR_COLLAPSED_KEY = 'f8-sidebar-collapsed-groups'
import { useChangelogBadge } from '@/shared/hooks/useChangelogBadge'
import { useFacilityId } from '@/shared/hooks/useFacilityId'
import { trpc } from '@/lib/trpc-client'
import { isNavVisibleForType } from '@/shared/constants/facility-types'

interface TopNavItem {
  name: string
  href: string
  icon: LucideIcon
  children?: { name: string; href: string }[]
}

const navigation: TopNavItem[] = [
  {
    name: 'Executive',
    href: '/executive',
    icon: Globe,
    children: [
      { name: 'Overview', href: '/executive' },
      { name: 'Quality & Labs', href: '/executive/quality' },
      { name: 'Yield & Cycle', href: '/executive/operations' },
      { name: 'Inventory Flow', href: '/operations' },
      { name: 'Financials', href: '/financials' },
    ],
  },
  { name: 'Copilot', href: '/copilot', icon: Sparkles },
  { name: 'Facilities', href: '/facilities', icon: Building2 },
  { name: 'Imports', href: '/admin/imports', icon: Upload },
]

interface FacilityNavItem {
  name: string
  href: string
  icon: LucideIcon
  children?: { name: string; href: string }[]
}

interface NavGroup {
  label: string
  items: FacilityNavItem[]
}

const facilityNavGroups: NavGroup[] = [
  {
    label: 'Grow & Track',
    items: [
      { name: 'Active Harvests', href: '/harvests', icon: Scissors },
      { name: 'Plants', href: '/plants', icon: Leaf },
      { name: 'Plant Batches', href: '/plant-batches', icon: Sprout },
      // { name: 'Processing', href: '/processing', icon: Cog },
      { name: 'Waste & Loss', href: '/waste', icon: Trash2 },
    ],
  },
  {
    label: 'Move & Sell',
    items: [
      { name: 'Pipeline', href: '/pipeline', icon: GitBranch },
      {
        name: 'Packages',
        href: '/inventory',
        icon: Package,
        children: [
          { name: 'Active Packages', href: '/inventory' },
          { name: 'Aging Analysis', href: '/inventory/aging' },
          { name: 'Intelligence', href: '/packages' },
          { name: 'Biomass', href: '/packages/biomass' },
          { name: 'Provenance', href: '/packages/provenance' },
          { name: 'Tags', href: '/inventory/tags' },
        ],
      },
      { name: 'Transfers', href: '/transfers', icon: ArrowLeftRight },
      // { name: 'Dispositions', href: '/dispositions', icon: ClipboardList },
      { name: 'Fulfillment', href: '/fulfillment', icon: Truck },
      { name: 'Sales', href: '/sales', icon: DollarSign },
      {
        name: 'Dutchie Ops',
        href: '/dutchie-ops',
        icon: Store,
        children: [
          { name: 'Bulk Update', href: '/dutchie-ops' },
          { name: 'History', href: '/dutchie-ops/history' },
        ],
      },
    ],
  },
  {
    label: 'Catalog',
    items: [
      {
        name: 'Strains',
        href: '/catalog/strains',
        icon: Leaf,
      },
      {
        name: 'Items',
        href: '/catalog/items',
        icon: Database,
      },
      {
        name: 'Locations',
        href: '/catalog/locations',
        icon: MapPin,
      },
    ],
  },
  {
    label: 'Analyze & Report',
    items: [
      {
        name: 'Compliance',
        href: '/compliance',
        icon: ShieldAlert,
        children: [
          { name: 'Overview', href: '/compliance' },
          { name: 'Audit Trail', href: '/compliance/audit' },
        ],
      },
      {
        name: 'Operations',
        href: '/operations',
        icon: Users,
      },
      {
        name: 'Analytics',
        href: '/analytics',
        icon: BarChart3,
        children: [
          { name: 'Overview', href: '/analytics' },
          { name: 'Strain Analysis', href: '/analytics/strains' },
          { name: 'Yield Tracking', href: '/analytics/yields' },
          { name: 'Loss Analysis', href: '/analytics/loss' },
          { name: 'Throughput', href: '/analytics/throughput' },
          { name: 'Harvest Forecast', href: '/analytics/forecast' },
        ],
      },
      // Packages items merged into the combined Packages menu under Move & Sell
      { name: 'Lab Tests', href: '/lab-tests', icon: FlaskConical },
      { name: 'Run Rates', href: '/run-rates', icon: TrendingUp },
      { name: 'Reports', href: '/reports', icon: FileText },
    ],
  },
]

export default function LeftSidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { toggle: toggleCopilot, isOpen: copilotOpen } = useCopilot()
  const { hasNew: hasNewChangelog } = useChangelogBadge()

  const activeFacilityId = useFacilityId()

  // Fetch facility type for current facility (cached with staleTime)
  const { data: currentFacility } = trpc.facility.getById.useQuery(
    { facilityId: activeFacilityId! },
    { enabled: !!activeFacilityId, staleTime: 60_000 },
  )
  const facilityType = currentFacility?.facilityType ?? null
  // Hide Dutchie-related nav items when no Dutchie credentials are configured.
  // 'none' or null = not connected; 'mock', 'sandbox', 'production' = connected.
  const hasDutchie = currentFacility?.dutchieEnvironment != null
    && currentFacility.dutchieEnvironment !== 'none'

  // Determine which sections are expanded — auto-expand the active section
  const [manuallyToggled, setManuallyToggled] = useState<Record<string, boolean>>({})
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  // Hydrate collapsed groups from localStorage on mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
      if (stored) {
        setCollapsedGroups(JSON.parse(stored))
      }
    } catch {
      // Ignore parse errors or missing localStorage
    }
  }, [])

  const toggleSection = useCallback((sectionHref: string) => {
    setManuallyToggled(prev => {
      const autoExpanded = activeFacilityId
        ? (pathname === `/facilities/${activeFacilityId}${sectionHref}` ||
           pathname?.startsWith(`/facilities/${activeFacilityId}${sectionHref}/`) || false)
        : false
      const currentlyExpanded = sectionHref in prev ? prev[sectionHref] : autoExpanded
      return { ...prev, [sectionHref]: !currentlyExpanded }
    })
  }, [pathname, activeFacilityId])

  const toggleGroup = useCallback((groupLabel: string) => {
    setCollapsedGroups(prev => {
      const next = { ...prev, [groupLabel]: !prev[groupLabel] }
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify(next))
      } catch {
        // Ignore quota errors
      }
      return next
    })
  }, [])

  function isExpanded(sectionHref: string): boolean {
    if (sectionHref in manuallyToggled) return manuallyToggled[sectionHref]
    if (!activeFacilityId) return false
    const fullHref = `/facilities/${activeFacilityId}${sectionHref}`
    return pathname === fullHref || pathname?.startsWith(fullHref + '/') || false
  }

  if (!session) return null

  return (
    <div className="fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border flex flex-col">
      {/* Workspace header */}
      <div className="px-3 py-2 border-b border-border">
        <OrgSwitcher />
      </div>

      {/* Facility Switcher */}
      <div className="px-3 py-3 border-b border-border">
        <FacilitySwitcher />
      </div>

      {/* Search trigger */}
      <div className="px-3 py-1">
        <button
          onClick={() => document.dispatchEvent(new Event('open-command-palette'))}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset"
        >
          <Search className="h-4 w-4" />
          <span>Search</span>
          <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">&#x2318;K</kbd>
        </button>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-modern px-3 py-3">
        <div className="space-y-0.5">
          {navigation.map((item) => {
            // A top-level item is "active" (and its submenu expanded) when:
            //   1. The current pathname matches its own href, OR
            //   2. The current pathname matches any of its children's hrefs.
            // Without (2), child routes that live OUTSIDE the parent's URL
            // space (e.g. `/operations` under Executive) wouldn't auto-expand
            // the parent submenu, leaving the user without a nav reference.
            const childMatches = item.children?.some(
              c => pathname === c.href || pathname?.startsWith(c.href + '/'),
            ) ?? false
            const isActive =
              pathname === item.href
              || pathname?.startsWith(item.href + '/')
              || childMatches
            const hasChildren = item.children && item.children.length > 0

            return (
              <div key={item.name}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
                {hasChildren && isActive && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-3">
                    {item.children!.map((child) => {
                      const isChildActive = pathname === child.href
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            'block rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset',
                            isChildActive
                              ? 'text-primary font-medium bg-primary/5'
                              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                          )}
                        >
                          {child.name}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Super Admin (platform admins only; server enforces access) */}
        {session.user?.isPlatformAdmin && (
          <div className="mt-6">
            <p className="px-3 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Super Admin
            </p>
            <Link
              href="/admin/llm-providers"
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset',
                pathname === '/admin/llm-providers'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Cpu className="h-4 w-4" />
              LLM Providers
            </Link>
          </div>
        )}

        {/* Facility-scoped navigation */}
        {activeFacilityId && (
          <div className="mt-6 space-y-3">
            {facilityNavGroups.map((group) => {
              const visibleItems = group.items.filter(item => {
                if (!isNavVisibleForType(item.href, facilityType)) return false
                // Hide Dutchie-related nav items when no Dutchie credentials are set.
                if (item.href.startsWith('/dutchie-ops') && !hasDutchie) return false
                return true
              })
              if (visibleItems.length === 0) return null
              const isGroupCollapsed = collapsedGroups[group.label]

              return (
                <div key={group.label}>
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className="w-full flex items-center justify-between px-3 mb-1 group"
                  >
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.label}
                    </span>
                    <ChevronRight
                      className={cn(
                        'h-3 w-3 text-muted-foreground transition-transform duration-200',
                        !isGroupCollapsed && 'rotate-90'
                      )}
                    />
                  </button>

                  {!isGroupCollapsed && (
                    <div className="space-y-0.5">
                      {visibleItems.map((item) => {
                        const fullHref = `/facilities/${activeFacilityId}${item.href}`
                        const isSectionActive = pathname === fullHref || pathname?.startsWith(fullHref + '/')
                        const hasChildren = item.children && item.children.length > 0
                        const expanded = hasChildren && isExpanded(item.href)

                        if (!hasChildren) {
                          return (
                            <Link
                              key={item.name}
                              href={fullHref}
                              className={cn(
                                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset',
                                isSectionActive
                                  ? 'bg-primary/10 text-primary'
                                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                              )}
                            >
                              <item.icon className="h-4 w-4" />
                              {item.name}
                            </Link>
                          )
                        }

                        return (
                          <div key={item.name}>
                            <button
                              onClick={() => toggleSection(item.href)}
                              className={cn(
                                'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset',
                                isSectionActive
                                  ? 'bg-primary/10 text-primary'
                                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                              )}
                            >
                              <item.icon className="h-4 w-4" />
                              {item.name}
                              <ChevronRight
                                className={cn(
                                  'h-3 w-3 ml-auto transition-transform duration-200',
                                  expanded ? 'rotate-90' : '',
                                  isSectionActive ? 'opacity-70' : 'opacity-50'
                                )}
                              />
                            </button>

                            {expanded && (
                              <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-3">
                                {item.children!.filter(child => isNavVisibleForType(child.href, facilityType)).map((child) => {
                                  const childHref = `/facilities/${activeFacilityId}${child.href}`
                                  const isChildActive = pathname === childHref
                                  return (
                                    <Link
                                      key={child.href}
                                      href={childHref}
                                      className={cn(
                                        'block rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset',
                                        isChildActive
                                          ? 'text-primary font-medium bg-primary/5'
                                          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                                      )}
                                    >
                                      {child.name}
                                    </Link>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Copilot toggle */}
            <button
              onClick={toggleCopilot}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors w-full',
                copilotOpen
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Sparkles className="h-4 w-4" />
              Copilot
            </button>
          </div>
        )}
      </nav>

      {/* User Menu */}
      <div className="border-t border-border px-3 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent transition-colors relative">
              {session.user?.image ? (
                <Image src={session.user.image} alt="" width={28} height={28} className="h-7 w-7 rounded-full" />
              ) : (
                <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                  <span className="text-xs font-medium">{session.user?.name?.[0] || '?'}</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{session.user?.name || 'User'}</p>
                <p className="text-xs text-muted-foreground truncate">{session.user?.email}</p>
              </div>
              {hasNewChangelog && (
                <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[232px]">
            <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
              {session.user?.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/changelog" className="flex items-center gap-2 cursor-pointer">
                <Megaphone className="h-4 w-4" />
                What&apos;s New
                {hasNewChangelog && (
                  <span className="ml-auto h-2 w-2 rounded-full bg-primary" />
                )}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/guide" className="flex items-center gap-2 cursor-pointer">
                <BookOpen className="h-4 w-4" />
                Guide
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="flex items-center gap-2 cursor-pointer">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => signOutWithCleanup()}
            >
              <LogOut className="h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
