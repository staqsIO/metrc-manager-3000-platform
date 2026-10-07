'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'
import { FACILITY_TYPE_VALUES, DUTCHIE_RECOMMENDED_TYPES } from '@/shared/constants/facility-types'
import type { FacilityType } from '@/shared/constants/facility-types'
import { US_STATES } from '../constants'
import { CredentialForm } from './CredentialForm'
import { SingleKeyForm } from './SingleKeyForm'
import type { WizardStep } from '../types'

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'info', label: 'Facility Info' },
  { key: 'metrc-keys', label: 'Metrc Keys' },
  { key: 'dutchie-keys', label: 'Dutchie Keys' },
]

function StepIndicator({ current, completed }: { current: WizardStep; completed: Set<WizardStep> }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {STEPS.map((s, i) => {
        const isCurrent = s.key === current
        const isDone = completed.has(s.key)
        return (
          <div key={s.key} className="flex items-center gap-2">
            {i > 0 && <div className="h-px w-6 bg-border" />}
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  'h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium',
                  isDone
                    ? 'bg-emerald-500 text-white'
                    : isCurrent
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className={cn('text-xs', isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                {s.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AddFacilityWizard
// ---------------------------------------------------------------------------

export function AddFacilityWizard({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const [step, setStep] = useState<WizardStep>('info')
  const [completed, setCompleted] = useState<Set<WizardStep>>(new Set())
  const [facilityId, setFacilityId] = useState<string | null>(null)
  const [facilityType, setFacilityType] = useState<FacilityType>('Cultivator')

  // Step 1: Info form
  const [name, setName] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [stateCode, setStateCode] = useState('CA')

  // Step 2: Metrc keys
  const [metrcEnv, setMetrcEnv] = useState<'sandbox' | 'production'>('sandbox')
  const [vendorKey, setVendorKey] = useState('')
  const [userKey, setUserKey] = useState('')
  const [showMetrcKeys, setShowMetrcKeys] = useState(false)

  // Step 3: Dutchie keys
  const [dutchieEnv, setDutchieEnv] = useState<'sandbox' | 'production'>('sandbox')
  const [dutchieApiKey, setDutchieApiKey] = useState('')
  const [showDutchieKey, setShowDutchieKey] = useState(false)

  const createFacility = trpc.facility.create.useMutation()
  const setCredentials = trpc.facility.setCredentials.useMutation()
  const setDutchieCredentials = trpc.facility.setDutchieCredentials.useMutation()

  const reset = () => {
    setStep('info')
    setCompleted(new Set())
    setFacilityId(null)
    setFacilityType('Cultivator')
    setName('')
    setLicenseNumber('')
    setStateCode('CA')
    setMetrcEnv('sandbox')
    setVendorKey('')
    setUserKey('')
    setShowMetrcKeys(false)
    setDutchieEnv('sandbox')
    setDutchieApiKey('')
    setShowDutchieKey(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const finish = () => {
    reset()
    onOpenChange(false)
    onSuccess()
  }

  // Step 1: create facility
  const handleCreateFacility = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const result = await createFacility.mutateAsync({
        name,
        licenseNumber,
        stateCode,
        facilityType,
        metrcEnvironment: 'mock',
      })
      setFacilityId(result.id)
      setCompleted(prev => new Set(prev).add('info'))
      setStep('metrc-keys')
    } catch {
      // Error surfaced via createFacility.error
    }
  }

  // Step 2: set Metrc credentials
  const handleSaveMetrcKeys = async () => {
    if (!facilityId) return
    await setCredentials.mutateAsync({
      facilityId,
      vendorApiKey: vendorKey,
      userApiKey: userKey,
      environment: metrcEnv,
    })
    setVendorKey('')
    setUserKey('')
    setCompleted(prev => new Set(prev).add('metrc-keys'))
    // If facility type recommends Dutchie, go to step 3
    if (DUTCHIE_RECOMMENDED_TYPES.includes(facilityType)) {
      setStep('dutchie-keys')
    } else {
      finish()
    }
  }

  const handleSkipMetrc = () => {
    setCompleted(prev => new Set(prev).add('metrc-keys'))
    if (DUTCHIE_RECOMMENDED_TYPES.includes(facilityType)) {
      setStep('dutchie-keys')
    } else {
      finish()
    }
  }

  // Step 3: set Dutchie credentials
  const handleSaveDutchieKey = async () => {
    if (!facilityId) return
    await setDutchieCredentials.mutateAsync({
      facilityId,
      apiKey: dutchieApiKey,
      environment: dutchieEnv,
    })
    setDutchieApiKey('')
    finish()
  }

  const showDutchieStep = DUTCHIE_RECOMMENDED_TYPES.includes(facilityType)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Facility</DialogTitle>
          <DialogDescription>
            {step === 'info' && 'Enter your facility details to get started.'}
            {step === 'metrc-keys' && 'Connect your Metrc API credentials (optional).'}
            {step === 'dutchie-keys' && 'Connect your Dutchie POS API key (optional).'}
          </DialogDescription>
        </DialogHeader>

        <StepIndicator
          current={step}
          completed={completed}
        />

        {/* Step 1: Facility Info */}
        {step === 'info' && (
          <form onSubmit={handleCreateFacility} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Facility Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Main Cultivation Facility"
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">License Number</label>
              <input
                type="text"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                placeholder="e.g., C10-0000001-LIC"
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">State</label>
                <select
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                >
                  {US_STATES.map((state) => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Facility Type</label>
                <select
                  value={facilityType}
                  onChange={(e) => setFacilityType(e.target.value as FacilityType)}
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                >
                  {FACILITY_TYPE_VALUES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-lg bg-secondary/50 border border-border p-3">
              <p className="text-xs text-muted-foreground">
                Your facility will start in <span className="text-yellow-400 font-medium">Mock Mode</span> with
                sample data. You can connect real API credentials in the next steps.
              </p>
            </div>

            {createFacility.error && (
              <div className="rounded-lg p-3 text-sm bg-red-500/10 text-red-500">
                {createFacility.error.message}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createFacility.isPending}
              >
                {createFacility.isPending ? 'Creating...' : 'Next'}
              </Button>
            </div>
          </form>
        )}

        {/* Step 2: Metrc Keys */}
        {step === 'metrc-keys' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-muted-foreground">Environment:</span>
              <div className="inline-flex rounded-lg border border-border overflow-hidden">
                {(['sandbox', 'production'] as const).map(env => (
                  <button
                    key={env}
                    type="button"
                    onClick={() => setMetrcEnv(env)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium transition-colors',
                      metrcEnv === env
                        ? env === 'sandbox'
                          ? 'bg-blue-500/10 text-blue-500'
                          : 'bg-emerald-500/10 text-emerald-500'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                    )}
                  >
                    {env === 'sandbox' ? 'Sandbox' : 'Production'}
                  </button>
                ))}
              </div>
            </div>

            <CredentialForm
              showKeys={showMetrcKeys}
              key1={vendorKey}
              key2={userKey}
              onKey1Change={setVendorKey}
              onKey2Change={setUserKey}
              onToggleShowKeys={() => setShowMetrcKeys(!showMetrcKeys)}
              onSave={handleSaveMetrcKeys}
              onCancel={handleSkipMetrc}
              isSaving={setCredentials.isPending}
              placeholder1="Vendor API Key"
              placeholder2="User API Key"
            />

            <div className="flex justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSkipMetrc}
              >
                Skip for now
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Dutchie Keys */}
        {step === 'dutchie-keys' && showDutchieStep && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-muted-foreground">Environment:</span>
              <div className="inline-flex rounded-lg border border-border overflow-hidden">
                {(['sandbox', 'production'] as const).map(env => (
                  <button
                    key={env}
                    type="button"
                    onClick={() => setDutchieEnv(env)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium transition-colors',
                      dutchieEnv === env
                        ? env === 'sandbox'
                          ? 'bg-blue-500/10 text-blue-500'
                          : 'bg-emerald-500/10 text-emerald-500'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                    )}
                  >
                    {env === 'sandbox' ? 'Sandbox' : 'Production'}
                  </button>
                ))}
              </div>
            </div>

            <SingleKeyForm
              showKey={showDutchieKey}
              value={dutchieApiKey}
              onChange={setDutchieApiKey}
              onToggleShowKey={() => setShowDutchieKey(!showDutchieKey)}
              onSave={handleSaveDutchieKey}
              onCancel={finish}
              isSaving={setDutchieCredentials.isPending}
              placeholder="Dutchie Location API Key"
            />

            <div className="flex justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={finish}
              >
                Skip for now
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
