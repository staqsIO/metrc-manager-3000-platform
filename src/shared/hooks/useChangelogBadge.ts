'use client'

import { useState, useEffect, useCallback } from 'react'
import { getLatestChangelogDate } from '@/shared/constants/changelog'

const STORAGE_KEY = 'changelog-last-seen'

export function useChangelogBadge() {
  // Start false to avoid SSR hydration mismatch
  const [hasNew, setHasNew] = useState(false)

  useEffect(() => {
    const lastSeen = localStorage.getItem(STORAGE_KEY)
    const latest = getLatestChangelogDate()
    setHasNew(lastSeen !== latest)
  }, [])

  const markSeen = useCallback(() => {
    const latest = getLatestChangelogDate()
    localStorage.setItem(STORAGE_KEY, latest)
    setHasNew(false)
  }, [])

  return { hasNew, markSeen }
}
