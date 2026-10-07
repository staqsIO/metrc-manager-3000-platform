'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { signOutWithCleanup } from '@/lib/active-org'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Settings, LogOut, Shield, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import OrganizationDomainsPanel from '@/features/settings/components/OrganizationDomainsPanel'

type Tab = 'account' | 'organization' | 'security'

export default function SettingsPage() {
  const { data: session } = useSession()
  const [tab, setTab] = useState<Tab>('account')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'account', label: 'Account' },
    { id: 'organization', label: 'Organization' },
    { id: 'security', label: 'Security' },
  ]

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Account and platform settings</p>
      </div>

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

      {/* Account Tab */}
      {tab === 'account' && (
        <div className="space-y-6 max-w-2xl">
          <div className="card-modern p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Profile
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Name</label>
                <div className="text-sm font-medium">{session?.user?.name || 'Not set'}</div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Email</label>
                <div className="text-sm font-medium">{session?.user?.email || 'Not set'}</div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Auth Provider</label>
                <div className="text-sm font-medium">Google OAuth</div>
              </div>
            </div>
          </div>

          <div className="card-modern p-6">
            <h3 className="font-semibold mb-4">Session</h3>
            <Button variant="outline" onClick={() => signOutWithCleanup()} className="gap-2">
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      )}

      {/* Organization Tab */}
      {tab === 'organization' && (
        <div className="max-w-3xl space-y-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            Settings for your active organization
          </div>
          <OrganizationDomainsPanel />
        </div>
      )}

      {/* Security Tab */}
      {tab === 'security' && (
        <div className="max-w-2xl space-y-6">
          <div className="card-modern p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Security
            </h3>
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Authentication</div>
                  <div className="text-muted-foreground">Google OAuth 2.0</div>
                </div>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500">Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">API Credential Encryption</div>
                  <div className="text-muted-foreground">AES-256-GCM at rest</div>
                </div>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500">Enabled</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Facility Access Control</div>
                  <div className="text-muted-foreground">Organization-scoped with membership validation</div>
                </div>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500">Enforced</Badge>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
