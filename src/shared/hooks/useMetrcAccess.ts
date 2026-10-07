'use client'

import { trpc } from '@/lib/trpc-client'
import { useFacilityId } from './useFacilityId'

export type MetrcAccessLevel = 'full' | 'readonly' | 'unknown'

export function useMetrcAccess() {
  const facilityId = useFacilityId()
  const { data } = trpc.facility.getById.useQuery(
    { facilityId: facilityId! },
    { enabled: !!facilityId, staleTime: 60_000 },
  )

  if (!data) {
    return { isReadOnly: false, accessLevel: 'unknown' as MetrcAccessLevel }
  }

  const access = data.metrcEnvironment === 'sandbox'
    ? data.sandboxMetrcKeyAccess
    : data.metrcKeyAccess

  const accessLevel: MetrcAccessLevel = access === 'readonly'
    ? 'readonly'
    : access === 'full'
      ? 'full'
      : 'unknown'

  return {
    isReadOnly: accessLevel === 'readonly',
    accessLevel,
  }
}
