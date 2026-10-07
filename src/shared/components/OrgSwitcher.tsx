'use client'

import { useRouter, usePathname } from 'next/navigation'
import { ChevronDown, Check } from 'lucide-react'
import { trpc } from '@/lib/trpc-client'
import { setActiveOrgCookie } from '@/lib/active-org'
import { cn } from '@/lib/utils'
import { BrandMark } from './BrandMark'
import { OrgAvatar } from './OrgAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'

export default function OrgSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const utils = trpc.useUtils()

  const { data: orgs, isLoading } = trpc.organization.list.useQuery()
  const setActiveMutation = trpc.organization.setActive.useMutation()

  const activeOrg = orgs?.find((o: { isActive: boolean }) => o.isActive) ?? orgs?.[0]

  const handleSwitch = async (orgId: string) => {
    if (orgId === activeOrg?.id) return
    try {
      await setActiveMutation.mutateAsync({ organizationId: orgId })
      setActiveOrgCookie(orgId)
      // Org boundary crosses every data scope — invalidate the entire tRPC
      // cache rather than enumerating routers. Previously only a handful of
      // queries were invalidated, leaving the executive page (crossFacility.*,
      // financial.*) showing the prior org's data until a hard reload.
      await utils.invalidate()

      const onFacilityPage = pathname?.startsWith('/facilities/')
      if (onFacilityPage) {
        router.push('/executive')
      } else {
        router.refresh()
      }
    } catch {
      // Mutation failed — membership check denied
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg px-3 py-2">
        <BrandMark className="h-5 w-5" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    )
  }

  // Single org — show the name, no dropdown
  if (orgs && orgs.length <= 1) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg px-3 py-2">
        <OrgAvatar
          name={activeOrg?.name ?? 'Organization'}
          logoUrl={activeOrg?.logoUrl}
          size={20}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground truncate">
              {activeOrg?.name ?? 'Organization'}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left',
            'hover:bg-accent transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset',
          )}
        >
          <OrgAvatar
            name={activeOrg?.name ?? 'Select org'}
            logoUrl={activeOrg?.logoUrl}
            size={20}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-foreground truncate">
                {activeOrg?.name ?? 'Select org'}
              </span>
            </div>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[220px]"
      >
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Organizations
        </DropdownMenuLabel>
        {orgs?.map((org: { id: string; name: string; logoUrl: string | null; isActive: boolean }) => (
          <DropdownMenuItem
            key={org.id}
            disabled={setActiveMutation.isPending}
            onSelect={() => handleSwitch(org.id)}
            className={cn(
              'flex items-center gap-2 cursor-pointer',
              org.id === activeOrg?.id && 'bg-primary/10 text-primary',
            )}
          >
            <OrgAvatar name={org.name} logoUrl={org.logoUrl} size={18} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium truncate">{org.name}</span>
              </div>
            </div>
            {org.id === activeOrg?.id && (
              <Check className="h-3.5 w-3.5 shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
