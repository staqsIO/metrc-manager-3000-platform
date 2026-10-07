'use client'

import { trpc } from '@/lib/trpc-client'

/**
 * Hook to fetch the data fidelity profile for a facility.
 *
 * Returns which data layers are connected (Metrc, Dutchie, Canix, OpEx, Supply)
 * and computed convenience flags (hasFinancialData, hasCostData, hasSalesVelocity, etc.).
 *
 * Used by `<ProgressiveMetric>`, `<EnrichmentPrompt>`, and page components
 * to adapt rendering based on data availability.
 *
 * Cached for 5 minutes — fidelity changes at integration-setup frequency, not per-request.
 */
export function useDataFidelity(facilityId: string | undefined) {
  return trpc.facility.getDataFidelity.useQuery(
    { facilityId: facilityId! },
    {
      enabled: !!facilityId,
      staleTime: 300_000, // 5 minutes — fidelity changes on integration-setup timescale
      refetchOnWindowFocus: false,
    },
  )
}
