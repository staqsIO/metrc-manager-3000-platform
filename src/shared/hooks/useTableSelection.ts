'use client'

import { useState, useCallback, useMemo } from 'react'

interface UseTableSelectionOptions<T extends string | number> {
  /** Keys of all items on the current page — used for select-all / indeterminate */
  pageItemKeys: T[]
}

interface UseTableSelectionReturn<T extends string | number> {
  /** Currently selected keys */
  selectedKeys: Set<T>
  /** Number of selected items */
  selectedCount: number
  /** Whether a specific key is selected */
  isSelected: (key: T) => boolean
  /** Whether all items on the current page are selected */
  isAllSelected: boolean
  /** Whether some (but not all) items on the current page are selected */
  isPartiallySelected: boolean
  /** Toggle a single key */
  toggle: (key: T) => void
  /** Toggle all items on the current page */
  toggleAll: () => void
  /** Clear all selections */
  clear: () => void
  /** Replace selection with a specific set */
  setSelection: (keys: Set<T>) => void
}

/**
 * Generic table row selection hook.
 *
 * Extracts the toggle-one / toggle-all / clear / indeterminate pattern
 * that was duplicated across Inventory, Plants, Reconciliation, and other pages.
 *
 * Selection state is independent of mutation logic — compose with
 * `useBulkAction` or domain-specific hooks for actions.
 */
export function useTableSelection<T extends string | number>(
  options: UseTableSelectionOptions<T>,
): UseTableSelectionReturn<T> {
  const { pageItemKeys } = options
  const [selectedKeys, setSelectedKeys] = useState<Set<T>>(new Set())

  const isSelected = useCallback(
    (key: T) => selectedKeys.has(key),
    [selectedKeys],
  )

  const isAllSelected = useMemo(
    () => pageItemKeys.length > 0 && pageItemKeys.every((k) => selectedKeys.has(k)),
    [pageItemKeys, selectedKeys],
  )

  const isPartiallySelected = useMemo(
    () => !isAllSelected && pageItemKeys.some((k) => selectedKeys.has(k)),
    [pageItemKeys, selectedKeys, isAllSelected],
  )

  const toggle = useCallback((key: T) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      const allSelected = pageItemKeys.every((k) => prev.has(k))
      if (allSelected) {
        for (const k of pageItemKeys) next.delete(k)
      } else {
        for (const k of pageItemKeys) next.add(k)
      }
      return next
    })
  }, [pageItemKeys])

  const clear = useCallback(() => {
    setSelectedKeys(new Set())
  }, [])

  const setSelection = useCallback((keys: Set<T>) => {
    setSelectedKeys(keys)
  }, [])

  return {
    selectedKeys,
    selectedCount: selectedKeys.size,
    isSelected,
    isAllSelected,
    isPartiallySelected,
    toggle,
    toggleAll,
    clear,
    setSelection,
  }
}
