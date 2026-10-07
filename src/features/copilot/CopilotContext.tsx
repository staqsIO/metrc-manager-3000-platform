'use client'

import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'copilot-sidebar-open'

interface CopilotContextValue {
  isOpen: boolean
  open: (prefill?: string) => void
  close: () => void
  toggle: () => void
  prefillMessage: string | null
  clearPrefill: () => void
  notificationCount: number
  setNotificationCount: (count: number) => void
  isExpanded: boolean
  toggleExpanded: () => void
  startNewChat: boolean
  requestNewChat: () => void
  clearNewChatRequest: () => void
}

const CopilotContext = createContext<CopilotContextValue>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  prefillMessage: null,
  clearPrefill: () => {},
  notificationCount: 0,
  setNotificationCount: () => {},
  isExpanded: false,
  toggleExpanded: () => {},
  startNewChat: false,
  requestNewChat: () => {},
  clearNewChatRequest: () => {},
})

function getInitialOpen(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [prefillMessage, setPrefillMessage] = useState<string | null>(null)
  const [notificationCount, setNotificationCount] = useState(0)
  const [startNewChat, setStartNewChat] = useState(false)

  // Hydrate from localStorage after mount
  useEffect(() => {
    setIsOpen(getInitialOpen())
  }, [])

  // Persist to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(isOpen))
    } catch {
      // ignore
    }
  }, [isOpen])

  const open = useCallback((prefill?: string) => {
    if (prefill) {
      setPrefillMessage(prefill)
      setStartNewChat(true)
    }
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    setIsExpanded(false)
  }, [])
  const toggle = useCallback(() => {
    setIsOpen(prev => {
      if (prev) setIsExpanded(false) // reset expanded when closing
      return !prev
    })
  }, [])
  const clearPrefill = useCallback(() => setPrefillMessage(null), [])
  const toggleExpanded = useCallback(() => setIsExpanded(prev => !prev), [])
  const requestNewChat = useCallback(() => setStartNewChat(true), [])
  const clearNewChatRequest = useCallback(() => setStartNewChat(false), [])

  return (
    <CopilotContext.Provider value={{ isOpen, open, close, toggle, prefillMessage, clearPrefill, notificationCount, setNotificationCount, isExpanded, toggleExpanded, startNewChat, requestNewChat, clearNewChatRequest }}>
      {children}
    </CopilotContext.Provider>
  )
}

export function useCopilot() {
  return useContext(CopilotContext)
}
