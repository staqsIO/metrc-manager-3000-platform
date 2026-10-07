'use client'

import { createContext, useContext, useMemo, useCallback, useSyncExternalStore } from 'react'
import { OpExStore } from './opex-store'
import type { CellValue } from './opex-store'

// ---------------------------------------------------------------------------
// Context — provides a stable OpExStore reference
// ---------------------------------------------------------------------------

const OpExStoreContext = createContext<OpExStore | null>(null)

export function OpExProvider({ children }: { children: React.ReactNode }) {
  const store = useMemo(() => new OpExStore(), [])
  return (
    <OpExStoreContext.Provider value={store}>
      {children}
    </OpExStoreContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Get the raw store instance. Throws if used outside OpExProvider.
 */
export function useOpExStore(): OpExStore {
  const store = useContext(OpExStoreContext)
  if (!store) {
    throw new Error('useOpExStore must be used within an OpExProvider')
  }
  return store
}

/**
 * Subscribe to a single cell's value using useSyncExternalStore.
 * Only this component re-renders when the specific cell changes.
 */
export function useCell(key: string): CellValue {
  const store = useOpExStore()

  const subscribe = useCallback(
    (callback: () => void) => store.subscribeTo(key, callback),
    [store, key],
  )

  const getSnapshot = useCallback(
    () => store.getCellSnapshot(key),
    [store, key],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Get the active KPI cell keys (template-specific).
 */
export function useKPIKeys(): string[] {
  const store = useOpExStore()
  return store.getKPIKeys()
}

/**
 * Subscribe to the KPI bar values.
 */
export function useKPIs(): Record<string, number | null> {
  const store = useOpExStore()

  const subscribe = useCallback(
    (callback: () => void) => store.subscribeToKPIs(callback),
    [store],
  )

  const getSnapshot = useCallback(
    () => store.getKPISnapshot(),
    [store],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
