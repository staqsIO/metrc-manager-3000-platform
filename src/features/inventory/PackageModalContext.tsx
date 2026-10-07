'use client'

import { createContext, useContext, useState, useCallback, useRef } from 'react'

interface PackageModalContextValue {
  isOpen: boolean
  packageLabel: string | null
  openPackageModal: (label: string) => void
  closePackageModal: () => void
}

const PackageModalContext = createContext<PackageModalContextValue>({
  isOpen: false,
  packageLabel: null,
  openPackageModal: () => {},
  closePackageModal: () => {},
})

export function PackageModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [packageLabel, setPackageLabel] = useState<string | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openPackageModal = useCallback((label: string) => {
    if (clearTimer.current) {
      clearTimeout(clearTimer.current)
      clearTimer.current = null
    }
    setPackageLabel(label)
    setIsOpen(true)
  }, [])

  const closePackageModal = useCallback(() => {
    setIsOpen(false)
    // Delay clearing label so exit animation still shows content
    clearTimer.current = setTimeout(() => {
      setPackageLabel(null)
      clearTimer.current = null
    }, 300)
  }, [])

  return (
    <PackageModalContext.Provider value={{ isOpen, packageLabel, openPackageModal, closePackageModal }}>
      {children}
    </PackageModalContext.Provider>
  )
}

export function usePackageModal() {
  return useContext(PackageModalContext)
}
