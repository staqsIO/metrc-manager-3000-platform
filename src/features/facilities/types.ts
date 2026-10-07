import type { FacilityType } from '@/shared/constants/facility-types'

/** Public facility shape returned by facility.list / facility.getById (no encrypted fields). */
export interface FacilityItem {
  id: string
  organizationId: string
  name: string
  licenseNumber: string
  stateCode: string
  facilityType: string | null
  metrcEnvironment: string
  metrcKeyAccess: string | null
  sandboxMetrcKeyAccess: string | null
  dutchieEnvironment: string | null
  dutchieFacilityTypes: string[]
  isActive: boolean
  lastSyncAt: Date | null
  lastSyncStatus: string | null
  syncErrorMessage: string | null
  timezone: string
  createdAt: Date
  updatedAt: Date
}

/** Boolean-only credential presence flags from facility.credentialStatus. */
export interface CredentialStatus {
  metrc: {
    hasProductionVendorKey: boolean
    hasProductionUserKey: boolean
    hasSandboxVendorKey: boolean
    hasSandboxUserKey: boolean
  }
  dutchie: {
    hasProductionLocationKey: boolean
    hasSandboxLocationKey: boolean
  }
}

/** Facility plus open compliance-alert counts.
 *  Sync state lives on the underlying FacilityItem (lastSyncAt, lastSyncStatus).
 *  Render those raw fields directly — no derived score. */
export interface FacilityWithHealth extends FacilityItem {
  alertCount: number
  /** Open-alert counts split by severity — sums to alertCount. */
  alertBreakdown: {
    critical: number
    warning: number
    info: number
  }
}

export type WizardStep = 'info' | 'metrc-keys' | 'dutchie-keys'

export type { FacilityType }
