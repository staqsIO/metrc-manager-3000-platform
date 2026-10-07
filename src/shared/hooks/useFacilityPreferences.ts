'use client'

import { useState, useCallback, useEffect } from 'react'

const PINNED_KEY = 'f8-pinned-facilities' // gitleaks:allow
const RECENT_KEY = 'f8-recent-facilities'
const VIEW_PREF_KEY = 'f8-facilities-view'
const MAX_RECENT = 10

export type ViewMode = 'grid' | 'list' | 'table'

export function useFacilityPreferences() {
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [recentIds, setRecentIds] = useState<string[]>([])
  const [viewMode, setViewModeState] = useState<ViewMode>('grid')

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const pinned = localStorage.getItem(PINNED_KEY)
      if (pinned) setPinnedIds(new Set(JSON.parse(pinned)))
      const recent = localStorage.getItem(RECENT_KEY)
      if (recent) setRecentIds(JSON.parse(recent))
      const view = localStorage.getItem(VIEW_PREF_KEY) as ViewMode | null
      if (view && ['grid', 'list', 'table'].includes(view)) setViewModeState(view)
    } catch {
      // Ignore parse errors
    }
  }, [])

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(PINNED_KEY, JSON.stringify(Array.from(next)))
      return next
    })
  }, [])

  const addRecent = useCallback((id: string) => {
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((r) => r !== id)].slice(0, MAX_RECENT)
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    localStorage.setItem(VIEW_PREF_KEY, mode)
  }, [])

  return { pinnedIds, recentIds, viewMode, togglePin, addRecent, setViewMode }
}
