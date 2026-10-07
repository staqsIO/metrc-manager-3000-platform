'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs'
import { cn } from '@/lib/utils'
import { Key, ShoppingCart, Database, Settings, Users, Eye, EyeOff, Shield, X, CheckCircle2, ShieldAlert, Target, Plus, Pencil, Check } from 'lucide-react'
import { DUTCHIE_RECOMMENDED_TYPES, FACILITY_TYPE_VALUES } from '@/shared/constants/facility-types'
import type { FacilityType } from '@/shared/constants/facility-types'
import type { MetrcEnvironment } from '@/lib/facility-context'
import { useSession } from 'next-auth/react'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/shared/components/ui/select'
import { CredentialForm } from './CredentialForm'
import { SingleKeyForm } from './SingleKeyForm'
import { EnvironmentSelector } from './EnvironmentSelector'

export function FacilitySettingsModal({
  open,
  onOpenChange,
  facilityId,
  facilityName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  facilityId: string
  facilityName: string
}) {
  // Credential form state — Metrc
  const [vendorKey, setVendorKey] = useState('')
  const [userKey, setUserKey] = useState('')
  const [showMetrcKeys, setShowMetrcKeys] = useState(false)
  const [metrcCredEnv, setMetrcCredEnv] = useState<'sandbox' | 'production'>('production')
  const [editingMetrc, setEditingMetrc] = useState<'sandbox' | 'production' | null>(null)

  // Credential form state — Dutchie
  const [dutchieApiKey, setDutchieApiKey] = useState('')
  const [showDutchieKeys, setShowDutchieKeys] = useState(false)
  const [dutchieCredEnv, setDutchieCredEnv] = useState<'sandbox' | 'production'>('production')
  const [editingDutchie, setEditingDutchie] = useState<'sandbox' | 'production' | null>(null)

  // Credential form state — Canix
  const [canixApiKey, setCanixApiKey] = useState('')
  const [editingCanix, setEditingCanix] = useState<'sandbox' | 'production' | null>(null)
  const [canixCredEnv, setCanixCredEnv] = useState<'sandbox' | 'production'>('production')
  const [showCanixKeys, setShowCanixKeys] = useState(false)

  // Team tab state
  const [myUserKey, setMyUserKey] = useState('')
  const [myMetrcUsername, setMyMetrcUsername] = useState('')
  const [showMyKey, setShowMyKey] = useState(false)
  const [teamCredEnv, setTeamCredEnv] = useState<'sandbox' | 'production'>('production')

  // Access tab state
  const { data: session } = useSession()
  const [revokeConfirmUserId, setRevokeConfirmUserId] = useState<string | null>(null)

  // General tab state
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [editingLicense, setEditingLicense] = useState(false)
  const [licenseValue, setLicenseValue] = useState('')
  const [editingType, setEditingType] = useState(false)
  const [typeValue, setTypeValue] = useState<string>('')
  const [editingExpiry, setEditingExpiry] = useState(false)
  const [expiryValue, setExpiryValue] = useState('')

  // Benchmark tab state
  const [editingBenchmarkId, setEditingBenchmarkId] = useState<string | null>(null)
  const [editingBenchmarkValue, setEditingBenchmarkValue] = useState('')
  const [newBenchmarkCategory, setNewBenchmarkCategory] = useState('Aging')
  const [newBenchmarkKey, setNewBenchmarkKey] = useState('')
  const [newBenchmarkValue, setNewBenchmarkValue] = useState('')
  const [newBenchmarkUnit, setNewBenchmarkUnit] = useState('')
  const [showAddBenchmark, setShowAddBenchmark] = useState(false)
  const [biomassExclusions, setBiomassExclusions] = useState<string | null>(null) // null = not yet loaded from server
  const [biomassExclusionsSaved, setBiomassExclusionsSaved] = useState(false)

  // Queries
  const { data: facility, refetch: refetchFacility } = trpc.facility.getById.useQuery(
    { facilityId },
    { enabled: open },
  )
  const { data: credStatus, refetch: refetchCreds } = trpc.facility.credentialStatus.useQuery(
    { facilityId },
    { enabled: open },
  )

  // Metrc mutations
  const setCredsMutation = trpc.facility.setCredentials.useMutation()
  const setEnvMutation = trpc.facility.setEnvironment.useMutation()
  const testMutation = trpc.facility.testConnection.useMutation()

  // Dutchie mutations
  const setDutchieCredsMutation = trpc.facility.setDutchieCredentials.useMutation()
  const setDutchieEnvMutation = trpc.facility.setDutchieEnvironment.useMutation()
  const testDutchieMutation = trpc.facility.testDutchieConnection.useMutation()

  // Canix mutations
  const setCanixCredsMutation = trpc.facility.setCanixCredentials.useMutation()
  const setCanixEnvMutation = trpc.facility.setCanixEnvironment.useMutation()
  const testCanixMutation = trpc.facility.testCanixConnection.useMutation()

  // Team queries & mutations
  const { data: teamData, refetch: refetchTeam } = trpc.facility.listUserCredentials.useQuery(
    { facilityId },
    { enabled: open },
  )
  const setUserCredMutation = trpc.facility.setUserCredential.useMutation()
  const setRequireMutation = trpc.facility.setRequirePerUserCredentials.useMutation()

  // Access queries & mutations
  const { data: accessData, refetch: refetchAccess } = trpc.facility.listFacilityAccess.useQuery(
    { facilityId },
    { enabled: open, retry: false },
  )
  const setAccessMutation = trpc.facility.setFacilityAccess.useMutation()
  const revokeAccessMutation = trpc.facility.revokeFacilityAccess.useMutation()
  const bootstrapMutation = trpc.facility.bootstrapFacilityAccess.useMutation()

  // Benchmark queries & mutations
  const { data: benchmarks, refetch: refetchBenchmarks } = trpc.facility.getBenchmarks.useQuery(
    { facilityId },
    { enabled: open },
  )
  const setBenchmarkMutation = trpc.facility.setBenchmark.useMutation()

  // General mutations
  const updateMutation = trpc.facility.update.useMutation()

  if (!facility) return null

  const metrcEnv = (facility.metrcEnvironment || 'mock') as MetrcEnvironment
  const dutchieEnv = (facility.dutchieEnvironment || 'none') as MetrcEnvironment
  const canixEnv = (facility.canixEnvironment || 'none') as MetrcEnvironment
  const isDutchieRec = !facility.facilityType || DUTCHIE_RECOMMENDED_TYPES.includes(facility.facilityType as FacilityType)

  // Metrc handlers
  const handleSaveMetrcCreds = async () => {
    if (!userKey.trim()) return
    await setCredsMutation.mutateAsync({
      facilityId,
      userApiKey: userKey,
      environment: metrcCredEnv,
    })
    setVendorKey('')
    setUserKey('')
    setEditingMetrc(null)
    refetchCreds()
  }

  const handleSetMetrcEnv = (env: MetrcEnvironment) => {
    const metrcOnly = env as 'mock' | 'sandbox' | 'production'
    setEnvMutation.mutate({ facilityId, environment: metrcOnly }, { onSuccess: () => refetchFacility() })
  }

  // Dutchie handlers
  const handleSaveDutchieCreds = async () => {
    if (!dutchieApiKey.trim()) return
    await setDutchieCredsMutation.mutateAsync({
      facilityId,
      apiKey: dutchieApiKey,
      environment: dutchieCredEnv,
    })
    setDutchieApiKey('')
    setEditingDutchie(null)
    refetchCreds()
  }

  const handleSetDutchieEnv = (env: MetrcEnvironment) => {
    setDutchieEnvMutation.mutate({ facilityId, environment: env }, { onSuccess: () => refetchFacility() })
  }

  // Canix handlers
  const handleSaveCanixCreds = async () => {
    if (!canixApiKey.trim()) return
    await setCanixCredsMutation.mutateAsync({
      facilityId,
      apiKey: canixApiKey,
      environment: canixCredEnv,
    })
    setCanixApiKey('')
    setEditingCanix(null)
    refetchCreds()
  }

  const handleSetCanixEnv = (env: MetrcEnvironment) => {
    setCanixEnvMutation.mutate({ facilityId, environment: env }, { onSuccess: () => refetchFacility() })
  }

  // General handlers
  const handleSaveName = async () => {
    if (!nameValue.trim()) return
    await updateMutation.mutateAsync({ facilityId, name: nameValue.trim() })
    setEditingName(false)
    refetchFacility()
  }

  const handleSaveLicense = async () => {
    if (!licenseValue.trim()) return
    await updateMutation.mutateAsync({ facilityId, licenseNumber: licenseValue.trim() })
    setEditingLicense(false)
    refetchFacility()
  }

  const handleSaveType = async () => {
    await updateMutation.mutateAsync({ facilityId, facilityType: typeValue as FacilityType })
    setEditingType(false)
    refetchFacility()
  }

  const handleSaveExpiry = async () => {
    await updateMutation.mutateAsync({
      facilityId,
      licenseExpiryDate: expiryValue ? new Date(expiryValue).toISOString() : null,
    })
    setEditingExpiry(false)
    refetchFacility()
  }

  // Team handlers
  const handleSaveMyKey = async () => {
    if (!myUserKey.trim()) return
    await setUserCredMutation.mutateAsync({
      facilityId,
      userApiKey: myUserKey,
      environment: teamCredEnv,
      metrcUsername: myMetrcUsername || undefined,
    })
    setMyUserKey('')
    setMyMetrcUsername('')
    setShowMyKey(false)
    refetchTeam()
  }

  const handleToggleRequirement = async () => {
    if (!teamData) return
    await setRequireMutation.mutateAsync({
      facilityId,
      required: !teamData.requirePerUserCredentials,
    })
    refetchTeam()
    refetchFacility()
  }

  // Access handlers
  const currentUserId = session?.user?.id
  const isAccessAdmin = accessData
    ? (!accessData.hasAnyGrants || accessData.members.some((m: { userId: string; role: string | null }) => m.userId === currentUserId && m.role === 'ADMIN'))
    : false

  const handleSetRole = async (userId: string, role: 'VIEWER' | 'OPERATOR' | 'ADMIN') => {
    await setAccessMutation.mutateAsync({ facilityId, userId, role })
    refetchAccess()
  }

  const handleRevoke = async (userId: string) => {
    await revokeAccessMutation.mutateAsync({ facilityId, userId })
    setRevokeConfirmUserId(null)
    refetchAccess()
  }

  const handleBootstrap = async () => {
    await bootstrapMutation.mutateAsync({ facilityId })
    refetchAccess()
  }

  const handleDeactivate = async () => {
    await updateMutation.mutateAsync({ facilityId, isActive: !facility.isActive })
    refetchFacility()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{facilityName} Settings</DialogTitle>
          <DialogDescription>Manage API credentials and facility configuration.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="metrc" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="metrc" className="flex-1 gap-1.5">
              <Key className="h-3.5 w-3.5" />
              Metrc API
            </TabsTrigger>
            <TabsTrigger value="dutchie" className="flex-1 gap-1.5">
              <ShoppingCart className="h-3.5 w-3.5" />
              Dutchie POS
            </TabsTrigger>
            <TabsTrigger value="canix" className="flex-1 gap-1.5">
              <Database className="h-3.5 w-3.5" />
              Canix ERP
            </TabsTrigger>
            <TabsTrigger value="team" className="flex-1 gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Team
            </TabsTrigger>
            <TabsTrigger value="access" className="flex-1 gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              Access
            </TabsTrigger>
            <TabsTrigger value="benchmarks" className="flex-1 gap-1.5">
              <Target className="h-3.5 w-3.5" />
              Benchmarks
            </TabsTrigger>
            <TabsTrigger value="general" className="flex-1 gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              General
            </TabsTrigger>
          </TabsList>

          {/* Metrc Tab */}
          <TabsContent value="metrc" className="space-y-4 mt-4">
            {/* Test result */}
            {testMutation.data && (
              <div className={cn(
                'rounded-lg p-3 text-sm',
                testMutation.data.success ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500',
              )}>
                <div>{testMutation.data.message}</div>
                {testMutation.data.success && testMutation.data.metrcKeyAccess && (
                  <div className={cn(
                    'flex items-center gap-1.5 mt-1.5 text-xs font-medium',
                    testMutation.data.metrcKeyAccess === 'full' ? 'text-emerald-400' : 'text-amber-400',
                  )}>
                    {testMutation.data.metrcKeyAccess === 'full' ? (
                      <><CheckCircle2 className="h-3.5 w-3.5" /> Full read/write access</>
                    ) : (
                      <><ShieldAlert className="h-3.5 w-3.5" /> Read-only access — write operations disabled</>
                    )}
                  </div>
                )}
              </div>
            )}

            <EnvironmentSelector
              value={metrcEnv}
              onChange={handleSetMetrcEnv}
              onTestConnection={() => testMutation.mutate({ facilityId })}
              isChanging={setEnvMutation.isPending}
              isTesting={testMutation.isPending}
            />

            {setEnvMutation.error && (
              <div className="rounded-lg p-3 text-sm bg-red-500/10 text-red-500">
                {setEnvMutation.error.message}
              </div>
            )}

            {/* Sandbox credentials */}
            <div className="border-t border-border/50 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <Key className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-sm font-medium">Sandbox</span>
                <Badge variant="outline" className="text-xs">
                  {credStatus?.metrc.hasSandboxUserKey ? 'Configured' : 'Not set'}
                </Badge>
              </div>
              {editingMetrc === 'sandbox' ? (
                <CredentialForm
                  showKeys={showMetrcKeys}
                  key1={vendorKey}
                  key2={userKey}
                  onKey1Change={setVendorKey}
                  onKey2Change={setUserKey}
                  onToggleShowKeys={() => setShowMetrcKeys(!showMetrcKeys)}
                  onSave={handleSaveMetrcCreds}
                  onCancel={() => { setEditingMetrc(null); setVendorKey(''); setUserKey('') }}
                  isSaving={setCredsMutation.isPending}
                  hideKey1
                  placeholder2="Metrc User API Key"
                />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setEditingMetrc('sandbox'); setMetrcCredEnv('sandbox'); setShowMetrcKeys(false) }}
                  className="gap-2"
                >
                  <Key className="h-3 w-3" />
                  {credStatus?.metrc.hasSandboxVendorKey ? 'Update' : 'Set Credentials'}
                </Button>
              )}
            </div>

            {/* Production credentials */}
            <div className="border-t border-border/50 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <Key className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-sm font-medium">Production</span>
                <Badge variant="outline" className="text-xs">
                  {credStatus?.metrc.hasProductionUserKey ? 'Configured' : 'Not set'}
                </Badge>
              </div>
              {editingMetrc === 'production' ? (
                <CredentialForm
                  showKeys={showMetrcKeys}
                  key1={vendorKey}
                  key2={userKey}
                  onKey1Change={setVendorKey}
                  onKey2Change={setUserKey}
                  onToggleShowKeys={() => setShowMetrcKeys(!showMetrcKeys)}
                  onSave={handleSaveMetrcCreds}
                  onCancel={() => { setEditingMetrc(null); setVendorKey(''); setUserKey('') }}
                  isSaving={setCredsMutation.isPending}
                  hideKey1
                  placeholder2="Metrc User API Key"
                />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setEditingMetrc('production'); setMetrcCredEnv('production'); setShowMetrcKeys(false) }}
                  className="gap-2"
                >
                  <Key className="h-3 w-3" />
                  {credStatus?.metrc.hasProductionVendorKey ? 'Update' : 'Set Credentials'}
                </Button>
              )}
            </div>
          </TabsContent>

          {/* Dutchie Tab */}
          <TabsContent value="dutchie" className="space-y-4 mt-4">
            {!isDutchieRec && (
              <div className="rounded-lg p-3 text-sm bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Dutchie POS is most commonly used by dispensaries. You can still configure it if your operation uses Dutchie.
              </div>
            )}

            {testDutchieMutation.data && (
              <div className={cn(
                'rounded-lg p-3 text-sm',
                testDutchieMutation.data.success ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500',
              )}>
                {testDutchieMutation.data.message}
              </div>
            )}

            <EnvironmentSelector
              value={dutchieEnv}
              onChange={handleSetDutchieEnv}
              onTestConnection={() => testDutchieMutation.mutate({ facilityId })}
              isChanging={setDutchieEnvMutation.isPending}
              isTesting={testDutchieMutation.isPending}
              options={['none', 'mock', 'sandbox', 'production']}
            />

            {setDutchieEnvMutation.error && (
              <div className="rounded-lg p-3 text-sm bg-red-500/10 text-red-500">
                {setDutchieEnvMutation.error.message}
              </div>
            )}

            {/* Sandbox key */}
            <div className="border-t border-border/50 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <Key className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-sm font-medium">Sandbox</span>
                <Badge variant="outline" className="text-xs">
                  {credStatus?.dutchie.hasSandboxLocationKey ? 'Configured' : 'Not set'}
                </Badge>
              </div>
              {editingDutchie === 'sandbox' ? (
                <SingleKeyForm
                  showKey={showDutchieKeys}
                  value={dutchieApiKey}
                  onChange={setDutchieApiKey}
                  onToggleShowKey={() => setShowDutchieKeys(!showDutchieKeys)}
                  onSave={handleSaveDutchieCreds}
                  onCancel={() => { setEditingDutchie(null); setDutchieApiKey('') }}
                  isSaving={setDutchieCredsMutation.isPending}
                  placeholder="Dutchie API Key"
                />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setEditingDutchie('sandbox'); setDutchieCredEnv('sandbox'); setShowDutchieKeys(false) }}
                  className="gap-2"
                >
                  <Key className="h-3 w-3" />
                  {credStatus?.dutchie.hasSandboxLocationKey ? 'Update' : 'Set API Key'}
                </Button>
              )}
            </div>

            {/* Production key */}
            <div className="border-t border-border/50 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <Key className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-sm font-medium">Production</span>
                <Badge variant="outline" className="text-xs">
                  {credStatus?.dutchie.hasProductionLocationKey ? 'Configured' : 'Not set'}
                </Badge>
              </div>
              {editingDutchie === 'production' ? (
                <SingleKeyForm
                  showKey={showDutchieKeys}
                  value={dutchieApiKey}
                  onChange={setDutchieApiKey}
                  onToggleShowKey={() => setShowDutchieKeys(!showDutchieKeys)}
                  onSave={handleSaveDutchieCreds}
                  onCancel={() => { setEditingDutchie(null); setDutchieApiKey('') }}
                  isSaving={setDutchieCredsMutation.isPending}
                  placeholder="Dutchie API Key"
                />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setEditingDutchie('production'); setDutchieCredEnv('production'); setShowDutchieKeys(false) }}
                  className="gap-2"
                >
                  <Key className="h-3 w-3" />
                  {credStatus?.dutchie.hasProductionLocationKey ? 'Update' : 'Set API Key'}
                </Button>
              )}
            </div>
          </TabsContent>

          {/* Canix ERP Tab */}
          <TabsContent value="canix" className="space-y-4 mt-4">
            {testCanixMutation.data && (
              <div className={cn(
                'rounded-lg p-3 text-sm',
                testCanixMutation.data.success ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500',
              )}>
                {testCanixMutation.data.message}
              </div>
            )}

            <EnvironmentSelector
              value={canixEnv}
              onChange={handleSetCanixEnv}
              onTestConnection={() => testCanixMutation.mutate({ facilityId })}
              isChanging={setCanixEnvMutation.isPending}
              isTesting={testCanixMutation.isPending}
              options={['none', 'mock', 'sandbox', 'production']}
            />

            {setCanixEnvMutation.error && (
              <div className="rounded-lg p-3 text-sm bg-red-500/10 text-red-500">
                {setCanixEnvMutation.error.message}
              </div>
            )}

            {/* Sandbox key */}
            <div className="border-t border-border/50 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <Key className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-sm font-medium">Sandbox</span>
                <Badge variant="outline" className="text-xs">
                  {credStatus?.canix?.hasSandboxApiKey ? 'Configured' : 'Not set'}
                </Badge>
              </div>
              {editingCanix === 'sandbox' ? (
                <SingleKeyForm
                  showKey={showCanixKeys}
                  value={canixApiKey}
                  onChange={setCanixApiKey}
                  onToggleShowKey={() => setShowCanixKeys(!showCanixKeys)}
                  onSave={handleSaveCanixCreds}
                  onCancel={() => { setEditingCanix(null); setCanixApiKey('') }}
                  isSaving={setCanixCredsMutation.isPending}
                  placeholder="Canix API Key"
                />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setEditingCanix('sandbox'); setCanixCredEnv('sandbox'); setShowCanixKeys(false) }}
                  className="gap-2"
                >
                  <Key className="h-3 w-3" />
                  {credStatus?.canix?.hasSandboxApiKey ? 'Update' : 'Set API Key'}
                </Button>
              )}
            </div>

            {/* Production key */}
            <div className="border-t border-border/50 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <Key className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-sm font-medium">Production</span>
                <Badge variant="outline" className="text-xs">
                  {credStatus?.canix?.hasProductionApiKey ? 'Configured' : 'Not set'}
                </Badge>
              </div>
              {editingCanix === 'production' ? (
                <SingleKeyForm
                  showKey={showCanixKeys}
                  value={canixApiKey}
                  onChange={setCanixApiKey}
                  onToggleShowKey={() => setShowCanixKeys(!showCanixKeys)}
                  onSave={handleSaveCanixCreds}
                  onCancel={() => { setEditingCanix(null); setCanixApiKey('') }}
                  isSaving={setCanixCredsMutation.isPending}
                  placeholder="Canix API Key"
                />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setEditingCanix('production'); setCanixCredEnv('production'); setShowCanixKeys(false) }}
                  className="gap-2"
                >
                  <Key className="h-3 w-3" />
                  {credStatus?.canix?.hasProductionApiKey ? 'Update' : 'Set API Key'}
                </Button>
              )}
            </div>
          </TabsContent>

          {/* Team Tab - Per-User Metrc Credentials */}
          <TabsContent value="team" className="space-y-4 mt-4">
            <div className="rounded-lg p-3 text-sm bg-blue-500/10 text-blue-400 border border-blue-500/20">
              Each team member can configure their own Metrc User API Key. Write operations (adjustments, transfers, etc.) will use the individual&apos;s key for proper audit attribution.
            </div>

            {/* Enforcement toggle */}
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-medium">Require Personal Keys</div>
                <div className="text-xs text-muted-foreground">
                  When enabled, team members must configure their own key before performing write operations.
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleRequirement}
                disabled={setRequireMutation.isPending}
                className={cn(
                  teamData?.requirePerUserCredentials && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                )}
              >
                {teamData?.requirePerUserCredentials ? 'Enforced' : 'Optional'}
              </Button>
            </div>

            {/* My Key section */}
            <div className="border-t border-border/50 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <Key className="h-3.5 w-3.5 text-primary" />
                <span className="text-sm font-medium">My Metrc User Key</span>
              </div>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Metrc Username (optional, for display)"
                  className="w-full p-2 rounded-md border border-border bg-background text-sm"
                  value={myMetrcUsername}
                  onChange={(e) => setMyMetrcUsername(e.target.value)}
                />
                <div className="relative">
                  <input
                    type={showMyKey ? 'text' : 'password'}
                    placeholder="Your Metrc User API Key"
                    className="w-full p-2 pr-10 rounded-md border border-border bg-background text-sm"
                    value={myUserKey}
                    onChange={(e) => setMyUserKey(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowMyKey(!showMyKey)}
                    className="absolute right-2 top-2 text-muted-foreground"
                  >
                    {showMyKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={teamCredEnv}
                    onChange={(e) => setTeamCredEnv(e.target.value as 'sandbox' | 'production')}
                    className="px-2 py-1.5 rounded border border-border bg-background text-sm"
                  >
                    <option value="sandbox">Sandbox</option>
                    <option value="production">Production</option>
                  </select>
                  <Button
                    size="sm"
                    onClick={handleSaveMyKey}
                    disabled={setUserCredMutation.isPending || !myUserKey.trim()}
                  >
                    {setUserCredMutation.isPending ? 'Saving...' : 'Save My Key'}
                  </Button>
                </div>
                {setUserCredMutation.isSuccess && (
                  <div className="text-xs text-emerald-500">Key saved successfully.</div>
                )}
                {setUserCredMutation.isError && (
                  <div className="text-xs text-red-500">{setUserCredMutation.error.message}</div>
                )}
              </div>
            </div>

            {/* Team members status */}
            <div className="border-t border-border/50 pt-3">
              <div className="text-sm font-medium mb-2">Team Members</div>
              <div className="space-y-2">
                {teamData?.members.map((member: {
                  userId: string
                  name: string | null
                  email: string
                  image: string | null
                  metrcUsername: string | null
                  hasKey: boolean
                  isActive: boolean
                  lastVerifiedAt: Date | null
                  configuredAt: Date | null
                }) => (
                  <div key={member.userId} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-medium">{member.name?.[0] || '?'}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm truncate">{member.name || member.email}</div>
                        {member.metrcUsername && (
                          <div className="text-xs text-muted-foreground truncate">Metrc: {member.metrcUsername}</div>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs flex-shrink-0',
                        member.hasKey && member.isActive
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                          : 'text-muted-foreground'
                      )}
                    >
                      {member.hasKey && member.isActive ? 'Configured' : 'Not set'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* Access Tab - Facility-Level Access Control (FOR-1172) */}
          <TabsContent value="access" className="space-y-4 mt-4">
            {/* Query errored (non-admin gets FORBIDDEN) — show read-only notice */}
            {!accessData && (
              <div className="rounded-lg p-3 text-sm bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <div className="font-medium mb-1">View Only</div>
                You do not have admin access to manage roles for this facility. Contact a facility admin to change access settings.
              </div>
            )}

            {/* State 1: No access control configured */}
            {accessData && !accessData.hasAnyGrants && (
              <>
                <div className="rounded-lg p-3 text-sm bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <div className="font-medium mb-1">No access control configured</div>
                  All organization members currently have full admin access to this facility. Enable access control to assign specific roles per team member.
                </div>

                <div className="rounded-lg border border-border/50 p-4">
                  <div className="text-sm font-medium mb-1">Enable Access Control</div>
                  <div className="text-xs text-muted-foreground mb-3">
                    This will grant every current org member the Admin role on this facility. You can then downgrade or revoke access as needed.
                  </div>
                  <Button
                    onClick={handleBootstrap}
                    disabled={bootstrapMutation.isPending}
                    className="gap-2"
                    size="sm"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    {bootstrapMutation.isPending ? 'Enabling...' : 'Enable Access Control'}
                  </Button>
                  {bootstrapMutation.isSuccess && (
                    <div className="text-xs text-emerald-500 mt-2">
                      Access control enabled for {bootstrapMutation.data.grantCount} members.
                    </div>
                  )}
                  {bootstrapMutation.isError && (
                    <div className="text-xs text-red-500 mt-2">
                      {bootstrapMutation.error.message}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* State 2: Access control active */}
            {accessData && accessData.hasAnyGrants && (
              <>
                <div className="rounded-lg p-3 text-sm bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Manage who can view, operate, or administer this facility. Role changes take effect at next sign-in.
                </div>

                {/* Mutation feedback */}
                {setAccessMutation.isError && (
                  <div className="rounded-lg p-2.5 text-xs bg-red-500/10 text-red-500">
                    {setAccessMutation.error.message}
                  </div>
                )}
                {revokeAccessMutation.isError && (
                  <div className="rounded-lg p-2.5 text-xs bg-red-500/10 text-red-500">
                    {revokeAccessMutation.error.message}
                  </div>
                )}

                {/* Role legend */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Admin
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    Operator
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Viewer
                  </span>
                </div>

                {/* Member list */}
                <div className="space-y-1">
                  {accessData.members.map((member: {
                    userId: string
                    name: string | null
                    email: string
                    image: string | null
                    role: string | null
                    grantedBy: string | null
                    grantedAt: Date | null
                  }) => {
                    const isCurrentUser = member.userId === currentUserId

                    return (
                      <div
                        key={member.userId}
                        className={cn(
                          'flex items-center justify-between py-2 px-2 rounded-lg transition-colors',
                          isCurrentUser && 'bg-muted/30',
                        )}
                      >
                        {/* Left: avatar + name */}
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {member.image ? (
                            <img
                              src={member.image}
                              alt=""
                              className="h-7 w-7 rounded-full flex-shrink-0"
                            />
                          ) : (
                            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-medium">
                                {member.name?.[0]?.toUpperCase() || '?'}
                              </span>
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-sm truncate">
                              {member.name || member.email}
                              {isCurrentUser && (
                                <span className="text-xs text-muted-foreground ml-1.5">(you)</span>
                              )}
                            </div>
                            {member.name && (
                              <div className="text-xs text-muted-foreground truncate">{member.email}</div>
                            )}
                          </div>
                        </div>

                        {/* Right: role selector + revoke */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isAccessAdmin ? (
                            <>
                              <Select
                                value={member.role ?? undefined}
                                onValueChange={(val) => handleSetRole(member.userId, val as 'VIEWER' | 'OPERATOR' | 'ADMIN')}
                                disabled={setAccessMutation.isPending}
                              >
                                <SelectTrigger
                                  className={cn(
                                    'h-7 w-[110px] text-xs border',
                                    member.role === 'ADMIN' && 'border-emerald-500/30 text-emerald-400',
                                    member.role === 'OPERATOR' && 'border-blue-500/30 text-blue-400',
                                    member.role === 'VIEWER' && 'border-amber-500/30 text-amber-400',
                                    !member.role && 'border-border text-muted-foreground',
                                  )}
                                >
                                  <SelectValue placeholder="No role" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ADMIN">
                                    <span className="flex items-center gap-1.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                      Admin
                                    </span>
                                  </SelectItem>
                                  <SelectItem value="OPERATOR">
                                    <span className="flex items-center gap-1.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                                      Operator
                                    </span>
                                  </SelectItem>
                                  <SelectItem value="VIEWER">
                                    <span className="flex items-center gap-1.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                      Viewer
                                    </span>
                                  </SelectItem>
                                </SelectContent>
                              </Select>

                              {/* Revoke button */}
                              {revokeConfirmUserId === member.userId ? (
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => handleRevoke(member.userId)}
                                    disabled={revokeAccessMutation.isPending}
                                  >
                                    {revokeAccessMutation.isPending ? '...' : 'Confirm'}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                    onClick={() => setRevokeConfirmUserId(null)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground hover:text-red-400"
                                  onClick={() => setRevokeConfirmUserId(member.userId)}
                                  disabled={isCurrentUser || !member.role}
                                  title={isCurrentUser ? 'Cannot revoke your own access' : 'Revoke access'}
                                >
                                  Revoke
                                </Button>
                              )}
                            </>
                          ) : (
                            /* Non-admin: read-only badge */
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-xs',
                                member.role === 'ADMIN' && 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                                member.role === 'OPERATOR' && 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                                member.role === 'VIEWER' && 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                                !member.role && 'text-muted-foreground',
                              )}
                            >
                              {member.role || 'No access'}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </TabsContent>

          {/* Benchmarks Tab */}
          <TabsContent value="benchmarks" className="space-y-4 mt-4">
            <div className="rounded-lg p-3 text-sm bg-blue-500/10 text-blue-400 border border-blue-500/20">
              Configure operational benchmarks and thresholds. These values are used by analytics dashboards and the Copilot for alerts and scoring.
            </div>

            {/* Biomass Category Exclusions */}
            <div className="border border-border rounded-lg p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Biomass Exclusions</h3>
              <p className="text-xs text-muted-foreground">
                Item names matching these patterns will be excluded from biomass analysis.
                Use this for retail products (mids, pre-ground flower) that share a Metrc category with extraction-grade biomass.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="e.g. mids, pre-ground, homie packs"
                  className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
                  value={biomassExclusions ?? (benchmarks?.find((b: { category: string; key: string; notes: string | null }) => b.category === 'biomass' && b.key === 'excluded_item_patterns')?.notes ?? '')}
                  onChange={(e) => { setBiomassExclusions(e.target.value); setBiomassExclusionsSaved(false); }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setBenchmarkMutation.mutate(
                      {
                        facilityId,
                        category: 'biomass',
                        key: 'excluded_item_patterns',
                        value: 0,
                        notes: biomassExclusions ?? '',
                      },
                      {
                        onSuccess: () => {
                          setBiomassExclusionsSaved(true);
                          refetchBenchmarks();
                        },
                      },
                    );
                  }}
                  disabled={setBenchmarkMutation.isPending || biomassExclusions === null}
                >
                  {setBenchmarkMutation.isPending ? 'Saving...' : biomassExclusionsSaved ? 'Saved' : 'Save'}
                </Button>
              </div>
            </div>

            {(() => {
              const BENCHMARK_CATEGORIES = ['Aging', 'Yield', 'Freshness', 'Compliance', 'Cost'] as const;
              const grouped = new Map<string, Array<{ id: string; key: string; value: number; unit: string | null; category: string }>>();
              for (const cat of BENCHMARK_CATEGORIES) grouped.set(cat, []);
              if (benchmarks) {
                for (const b of benchmarks) {
                  const cat = b.category ?? 'Aging';
                  if (!grouped.has(cat)) grouped.set(cat, []);
                  grouped.get(cat)!.push(b);
                }
              }

              return (
                <div className="space-y-4">
                  {BENCHMARK_CATEGORIES.map(cat => {
                    const items = grouped.get(cat) ?? [];
                    return (
                      <div key={cat} className="border-t border-border/50 pt-3 first:border-t-0 first:pt-0">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{cat}</h3>
                        {items.length === 0 ? (
                          <p className="text-xs text-muted-foreground/60 italic">No benchmarks configured</p>
                        ) : (
                          <div className="space-y-1.5">
                            {items.map(b => (
                              <div key={b.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/20 group">
                                <span className="text-sm">{b.key}</span>
                                <div className="flex items-center gap-2">
                                  {editingBenchmarkId === b.id ? (
                                    <>
                                      <input
                                        type="number"
                                        className="w-24 px-2 py-1 rounded border border-border bg-background text-sm text-right"
                                        value={editingBenchmarkValue}
                                        onChange={(e) => setEditingBenchmarkValue(e.target.value)}
                                        autoFocus
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            const num = parseFloat(editingBenchmarkValue);
                                            if (!isNaN(num)) {
                                              setBenchmarkMutation.mutate(
                                                { facilityId, category: b.category, key: b.key, value: num, unit: b.unit ?? undefined },
                                                { onSuccess: () => { setEditingBenchmarkId(null); refetchBenchmarks(); } },
                                              );
                                            }
                                          }
                                          if (e.key === 'Escape') setEditingBenchmarkId(null);
                                        }}
                                      />
                                      {b.unit && <span className="text-xs text-muted-foreground">{b.unit}</span>}
                                      <button
                                        onClick={() => {
                                          const num = parseFloat(editingBenchmarkValue);
                                          if (!isNaN(num)) {
                                            setBenchmarkMutation.mutate(
                                              { facilityId, category: b.category, key: b.key, value: num, unit: b.unit ?? undefined },
                                              { onSuccess: () => { setEditingBenchmarkId(null); refetchBenchmarks(); } },
                                            );
                                          }
                                        }}
                                        className="text-emerald-500 hover:text-emerald-400"
                                      >
                                        <Check className="h-3.5 w-3.5" />
                                      </button>
                                      <button onClick={() => setEditingBenchmarkId(null)} className="text-muted-foreground hover:text-foreground">
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-sm font-medium">{b.value}</span>
                                      {b.unit && <span className="text-xs text-muted-foreground">{b.unit}</span>}
                                      <button
                                        onClick={() => { setEditingBenchmarkId(b.id); setEditingBenchmarkValue(String(b.value)); }}
                                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add new benchmark */}
                  {showAddBenchmark ? (
                    <div className="border-t border-border/50 pt-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={newBenchmarkCategory}
                          onChange={(e) => setNewBenchmarkCategory(e.target.value)}
                          className="px-2 py-1.5 rounded border border-border bg-background text-sm"
                        >
                          {BENCHMARK_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input
                          type="text"
                          placeholder="Key (e.g., max_age_days)"
                          className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
                          value={newBenchmarkKey}
                          onChange={(e) => setNewBenchmarkKey(e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          placeholder="Value"
                          className="w-24 px-2 py-1.5 rounded border border-border bg-background text-sm"
                          value={newBenchmarkValue}
                          onChange={(e) => setNewBenchmarkValue(e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder="Unit (optional)"
                          className="w-24 px-2 py-1.5 rounded border border-border bg-background text-sm"
                          value={newBenchmarkUnit}
                          onChange={(e) => setNewBenchmarkUnit(e.target.value)}
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            const num = parseFloat(newBenchmarkValue);
                            if (!newBenchmarkKey.trim() || isNaN(num)) return;
                            setBenchmarkMutation.mutate(
                              {
                                facilityId,
                                category: newBenchmarkCategory,
                                key: newBenchmarkKey.trim(),
                                value: num,
                                unit: newBenchmarkUnit.trim() || undefined,
                              },
                              {
                                onSuccess: () => {
                                  setNewBenchmarkKey('');
                                  setNewBenchmarkValue('');
                                  setNewBenchmarkUnit('');
                                  setShowAddBenchmark(false);
                                  refetchBenchmarks();
                                },
                              },
                            );
                          }}
                          disabled={setBenchmarkMutation.isPending || !newBenchmarkKey.trim() || !newBenchmarkValue}
                        >
                          {setBenchmarkMutation.isPending ? 'Saving...' : 'Save'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowAddBenchmark(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAddBenchmark(true)}
                      className="gap-2"
                    >
                      <Plus className="h-3 w-3" />
                      Add Benchmark
                    </Button>
                  )}
                </div>
              );
            })()}
          </TabsContent>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="space-y-3">
              {/* Facility Name */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Facility Name</label>
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={nameValue}
                      onChange={(e) => setNameValue(e.target.value)}
                      className="px-2 py-1 rounded border border-border bg-background text-sm flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updateMutation.isPending || !nameValue.trim()}
                      onClick={handleSaveName}
                    >
                      Save
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingName(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{facility.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setEditingName(true); setNameValue(facility.name) }}
                      className="h-6 text-xs"
                    >
                      Edit
                    </Button>
                  </div>
                )}
              </div>

              {/* License Number */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">License Number</label>
                {editingLicense ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={licenseValue}
                      onChange={(e) => setLicenseValue(e.target.value)}
                      className="px-2 py-1 rounded border border-border bg-background text-sm flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updateMutation.isPending || !licenseValue.trim()}
                      onClick={handleSaveLicense}
                    >
                      Save
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingLicense(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{facility.licenseNumber}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setEditingLicense(true); setLicenseValue(facility.licenseNumber) }}
                      className="h-6 text-xs"
                    >
                      Edit
                    </Button>
                  </div>
                )}
              </div>

              {/* Facility Type */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Facility Type</label>
                {editingType ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={typeValue}
                      onChange={(e) => setTypeValue(e.target.value)}
                      className="px-2 py-1 rounded border border-border bg-background text-sm flex-1"
                    >
                      {FACILITY_TYPE_VALUES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updateMutation.isPending}
                      onClick={handleSaveType}
                    >
                      Save
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingType(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{facility.facilityType || 'Not set'}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setEditingType(true); setTypeValue(facility.facilityType || 'Cultivator') }}
                      className="h-6 text-xs"
                    >
                      Edit
                    </Button>
                  </div>
                )}
              </div>

              {/* License Expiry Date */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">License Expiry Date</label>
                {editingExpiry ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={expiryValue}
                      onChange={(e) => setExpiryValue(e.target.value)}
                      className="px-2 py-1 rounded border border-border bg-background text-sm flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updateMutation.isPending}
                      onClick={handleSaveExpiry}
                    >
                      Save
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingExpiry(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">
                      {facility.licenseExpiryDate
                        ? new Date(facility.licenseExpiryDate).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : 'Not set'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingExpiry(true)
                        setExpiryValue(
                          facility.licenseExpiryDate
                            ? new Date(facility.licenseExpiryDate).toISOString().split('T')[0]!
                            : '',
                        )
                      }}
                      className="h-6 text-xs"
                    >
                      Edit
                    </Button>
                  </div>
                )}
              </div>

              {/* Active/Inactive toggle */}
              <div className="border-t border-border pt-3 mt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">
                      {facility.isActive ? 'Active' : 'Inactive'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {facility.isActive
                        ? 'Deactivating hides this facility from the list'
                        : 'Reactivate to show this facility again'}
                    </div>
                  </div>
                  <Button
                    variant={facility.isActive ? 'outline' : 'default'}
                    size="sm"
                    onClick={handleDeactivate}
                    disabled={updateMutation.isPending}
                  >
                    {facility.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
