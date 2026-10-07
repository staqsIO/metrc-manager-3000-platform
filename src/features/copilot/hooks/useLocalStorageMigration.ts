'use client'

import { useEffect, useRef } from 'react'
import { trpc } from '@/lib/trpc-client'

const MIGRATION_FLAG_KEY = 'copilot-conversations-migrated:v1'
const STORE_KEY_PREFIX = 'copilot-conversations-'

interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  toolsUsed?: string[]
}

interface StoredConversation {
  id: string
  title: string
  messages: StoredMessage[]
  createdAt: number
  updatedAt: number
}

interface ConversationStore {
  version: number
  activeConversationId: string | null
  conversations: StoredConversation[]
}

/**
 * Walks the user's localStorage `copilot-conversations-*` blobs and ships
 * any non-empty threads to the Prisma-backed `conversations.importLocalStorage`
 * mutation. Runs once per browser per migration version (gate is a
 * localStorage flag); idempotent server-side via a title+createdAt
 * fingerprint, so re-running on a different device for the same user
 * skips already-imported threads.
 */
export function useLocalStorageMigration(enabled: boolean) {
  const triggered = useRef(false)
  const importMutation = trpc.conversations.importLocalStorage.useMutation()
  const utils = trpc.useUtils()

  useEffect(() => {
    if (!enabled) return
    if (triggered.current) return
    if (typeof window === 'undefined') return

    // Already migrated on this browser — skip silently.
    if (localStorage.getItem(MIGRATION_FLAG_KEY)) return
    triggered.current = true

    const threads: Array<{
      facilityId: string | null
      title: string
      createdAt: number
      lastMessageAt: number
      messages: { role: 'user' | 'assistant'; content: string; toolsUsed?: string[]; createdAt?: number }[]
    }> = []

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(STORE_KEY_PREFIX)) continue
      const facilityNamespace = key.slice(STORE_KEY_PREFIX.length)
      // '__org__' is the legacy null-facility namespace; map back to null
      // so the import lands at org scope.
      const facilityId = facilityNamespace === '__org__' ? null : facilityNamespace
      try {
        const raw = localStorage.getItem(key)
        if (!raw) continue
        const parsed = JSON.parse(raw) as ConversationStore
        if (!parsed?.conversations?.length) continue
        for (const conv of parsed.conversations) {
          if (!conv.messages?.length) continue
          threads.push({
            facilityId,
            title: conv.title?.trim() || 'Imported conversation',
            createdAt: conv.createdAt,
            lastMessageAt: conv.updatedAt || conv.createdAt,
            messages: conv.messages.map((m) => ({
              role: m.role,
              content: m.content,
              toolsUsed: m.toolsUsed,
            })),
          })
        }
      } catch {
        // Corrupt/legacy blob — skip silently
      }
    }

    if (threads.length === 0) {
      // Nothing to migrate, but still flip the flag so we don't re-scan.
      localStorage.setItem(MIGRATION_FLAG_KEY, String(Date.now()))
      return
    }

    importMutation
      .mutateAsync({ threads })
      .then(() => {
        localStorage.setItem(MIGRATION_FLAG_KEY, String(Date.now()))
        void utils.conversations.list.invalidate()
      })
      .catch((err: unknown) => {
        // Don't flip the flag on failure — try again next mount.
        console.warn('[copilot] localStorage migration failed:', err instanceof Error ? err.message : err)
        triggered.current = false
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}
