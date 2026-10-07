'use client'

import { useParams } from 'next/navigation'
import DutchieOpsClient from '@/features/dutchie-ops/DutchieOpsClient'

export default function DutchieOpsPage() {
  const params = useParams()
  const facilityId = params?.facilityId as string

  if (!facilityId) return null

  return <DutchieOpsClient activeFacilityId={facilityId} />
}
