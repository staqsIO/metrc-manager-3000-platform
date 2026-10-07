'use client'

import { usePathname } from 'next/navigation'

export function useFacilityId(): string | undefined {
  const pathname = usePathname()
  const match = pathname?.match(/\/facilities\/([^/]+)/)
  return match?.[1]
}
