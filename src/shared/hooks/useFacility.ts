'use client'

import { useParams } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'

/**
 * Hook to get the current facility from URL params.
 * Use in any component under /facilities/[facilityId]/ routes.
 */
export function useFacility() {
  const params = useParams()
  const facilityId = params?.facilityId as string | undefined

  const { data: facility, isLoading, error } = trpc.facility.getById.useQuery(
    { facilityId: facilityId! },
    { enabled: !!facilityId }
  )

  return {
    facilityId,
    facility,
    isLoading,
    error,
    metrcEnvironment: (facility?.metrcEnvironment ?? 'mock') as 'mock' | 'sandbox' | 'production',
    isActive: facility?.isActive ?? false,
  }
}
