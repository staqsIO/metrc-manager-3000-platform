'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  getActiveConversation, createConversation, appendMessage as storageAppendMessage,
  setActiveConversation, listConversations, clearAllConversations,
  type StoredMessage, type ConversationSummary,
} from '../chat-storage'
import { streamCopilotChat } from '../lib/stream-copilot'
import { parseSuggestions, getFallbackSuggestions } from '../lib/suggestions'
import type { AnonymizationAudit } from '@/services/copilot/anonymizer'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  toolsUsed?: string[]
  suggestions?: string[]
  isError?: boolean
  audit?: AnonymizationAudit
}

export interface ToolStep {
  tool: string
  status: 'running' | 'done'
}

export interface SendOptions {
  /** When provided, overrides the auto-derived message history. Used by
   * prefill flows that intentionally start from an empty history rather
   * than reading from the (stale) conversation. */
  overrideHistory?: { role: 'user' | 'assistant'; content: string }[]
  /** Optional skill identifier for response-template injection. */
  skillId?: string
  /** Optional model override (otherwise the server picks a default). */
  model?: string
  /** When true, request the anonymizer audit transcript on the response. */
  captureAudit?: boolean
}

export interface UseCopilotChat {
  // State
  messages: ChatMessage[]
  isSending: boolean
  toolSteps: ToolStep[]
  sendStartedAt: number | null
  currentConversationId: string | null
  conversationList: ConversationSummary[]
  storageNamespace: string

  // Actions
  send: (text: string, opts?: SendOptions) => Promise<void>
  stop: () => void
  retry: () => Promise<void>
  newChat: () => void
  switchConversation: (id: string) => void
  clearHistory: () => void
  refreshConversationList: () => void
  /** Replace messages state — used when hydrating from a server-persisted Conversation. */
  loadMessages: (messages: ChatMessage[]) => void
}

export interface UseCopilotChatOptions {
  /** Server-persisted Conversation id. When set, the hook treats Prisma as
   *  source of truth and skips localStorage hydration/writes. */
  serverConversationId?: string | null
  /** Fired when the server emits a `conversation` SSE event for a turn that
   *  didn't have an id yet (new thread). The consumer typically uses this
   *  to update the URL with `?conversation=<id>` so reload resumes correctly. */
  onServerConversationChange?: (id: string, created: boolean) => void
}

/**
 * Owns the Copilot chat state machine — messages, in-flight request, tool
 * steps, conversation history, abort/retry/new-chat/switch handlers — for
 * any UI surface (right-rail panel, full-page agent surface, future canvas).
 *
 * Stays unaware of the consumer's UI state (input box, skill cards, model
 * selector, audit toggle). Send options are passed in per-call so the hook
 * doesn't depend on whatever React state the consumer chose for those.
 *
 * Pre-rebuild safety extraction (Phase 0b) — behavior parity with the
 * pre-extraction CopilotPanel.tsx state machine, including the deliberate
 * `messagesRef` / `conversationIdRef` workarounds for stale closures during
 * back-to-back sends.
 */
export function useCopilotChat(
  facilityId: string | null,
  options: UseCopilotChatOptions = {},
): UseCopilotChat {
  const storageNamespace = facilityId || '__org__'
  const { serverConversationId, onServerConversationChange } = options
  const usingServerStore = !!serverConversationId
  const onServerConversationChangeRef = useRef(onServerConversationChange)
  onServerConversationChangeRef.current = onServerConversationChange

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([])
  const [sendStartedAt, setSendStartedAt] = useState<number | null>(null)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([])

  const abortRef = useRef<AbortController | null>(null)
  const messagesRef = useRef<ChatMessage[]>(messages)
  messagesRef.current = messages
  const conversationIdRef = useRef<string | null>(currentConversationId)
  conversationIdRef.current = currentConversationId

  // Abort any in-flight request on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  // Hydrate from localStorage when storageNamespace changes — skipped when
  // a server Conversation id was passed (the consumer hydrates via tRPC and
  // calls loadMessages instead).
  useEffect(() => {
    if (usingServerStore) return
    const conv = getActiveConversation(storageNamespace)
    if (conv && conv.messages.length > 0) {
      setMessages(conv.messages as ChatMessage[])
      setCurrentConversationId(conv.id)
    } else {
      setMessages([])
      setCurrentConversationId(null)
    }
    setConversationList(listConversations(storageNamespace))
  }, [storageNamespace, usingServerStore])

  // When the server conversation id arrives (or changes via URL), reset
  // local refs so the hook treats it as the active thread.
  useEffect(() => {
    if (serverConversationId) {
      setCurrentConversationId(serverConversationId)
      conversationIdRef.current = serverConversationId
    }
  }, [serverConversationId])

  const handleToolEvent = useCallback((event: { tool: string; status: 'start' | 'end' }) => {
    setToolSteps(prev => {
      if (event.status === 'start') {
        const existing = prev.find(s => s.tool === event.tool && s.status === 'running')
        if (existing) return prev
        return [...prev, { tool: event.tool, status: 'running' }]
      }
      return prev.map(s =>
        s.tool === event.tool && s.status === 'running'
          ? { ...s, status: 'done' as const }
          : s,
      )
    })
  }, [])

  const send = useCallback(async (text: string, opts: SendOptions = {}): Promise<void> => {
    const msg = text.trim()
    if (!msg || isSending) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsSending(true)
    setToolSteps([])
    setSendStartedAt(Date.now())

    let convId = conversationIdRef.current
    if (!convId && !usingServerStore) {
      const conv = createConversation(storageNamespace)
      convId = conv.id
      setCurrentConversationId(convId)
      conversationIdRef.current = convId
    }

    const userMsg: ChatMessage = { role: 'user', content: msg }
    setMessages(prev => [...prev, userMsg])
    if (!usingServerStore && convId) {
      const storedUserMsg: StoredMessage = { role: 'user', content: msg }
      storageAppendMessage(storageNamespace, convId, storedUserMsg)
      setConversationList(listConversations(storageNamespace))
    }

    const history = opts.overrideHistory
      ?? messagesRef.current.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    try {
      const result = await streamCopilotChat(
        facilityId,
        msg,
        history,
        handleToolEvent,
        controller.signal,
        opts.model,
        opts.skillId,
        opts.captureAudit,
        serverConversationId ?? null,
        (id: string, created: boolean) => {
          // Server minted (or confirmed) the Conversation id for this turn —
          // bubble it up so the consumer can update the URL and the next
          // turn carries the same id.
          onServerConversationChangeRef.current?.(id, created)
        },
      )

      const { cleanContent, suggestions: parsed } = parseSuggestions(result.content)
      const suggestions = parsed.length > 0 ? parsed : getFallbackSuggestions(result.toolsUsed)
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: cleanContent,
        toolsUsed: result.toolsUsed,
        suggestions,
        ...(result.audit ? { audit: result.audit } : {}),
      }
      setMessages(prev => [...prev, assistantMsg])
      if (!usingServerStore && convId) {
        const storedAssistantMsg: StoredMessage = {
          role: 'assistant',
          content: cleanContent,
          toolsUsed: result.toolsUsed,
          suggestions,
        }
        storageAppendMessage(storageNamespace, convId, storedAssistantMsg)
        setConversationList(listConversations(storageNamespace))
      }
    } catch (err) {
      if (controller.signal.aborted) return
      let errorMessage = err instanceof Error ? err.message : 'Something went wrong.'
      if (
        errorMessage.includes('<!DOCTYPE')
        || errorMessage.includes('<html')
        || errorMessage.includes('timeout')
        || errorMessage.includes('aborted')
      ) {
        errorMessage = 'The AI model is warming up — it should respond faster on the next attempt.'
      }
      const errorContent = `Sorry, I encountered an error: ${errorMessage}\n\nPlease try again using the retry button below.`
      const errorMsg: ChatMessage = { role: 'assistant', content: errorContent, isError: true }
      setMessages(prev => [...prev, errorMsg])
      if (!usingServerStore && convId) {
        const storedErrMsg: StoredMessage = { role: 'assistant', content: errorContent }
        storageAppendMessage(storageNamespace, convId, storedErrMsg)
      }
    } finally {
      abortRef.current = null
      setIsSending(false)
      setToolSteps([])
      setSendStartedAt(null)
    }
  }, [facilityId, handleToolEvent, isSending, storageNamespace, usingServerStore, serverConversationId])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsSending(false)
    setToolSteps([])
    setSendStartedAt(null)
  }, [])

  const retry = useCallback(async (): Promise<void> => {
    const lastUserMsg = [...messagesRef.current].reverse().find(m => m.role === 'user')
    if (!lastUserMsg) return
    setMessages(prev => {
      const last = prev[prev.length - 1]
      return last?.isError ? prev.slice(0, -1) : prev
    })
    // Tiny delay so the state update settles before the resend reads from
    // messagesRef. Matches the original behavior exactly.
    await new Promise(r => setTimeout(r, 50))
    await send(lastUserMsg.content)
  }, [send])

  const newChat = useCallback(() => {
    abortRef.current?.abort()
    const conv = createConversation(storageNamespace)
    setCurrentConversationId(conv.id)
    conversationIdRef.current = conv.id
    setConversationList(listConversations(storageNamespace))
    setMessages([])
    messagesRef.current = []
    setToolSteps([])
  }, [storageNamespace])

  const switchConversation = useCallback((id: string) => {
    abortRef.current?.abort()
    setActiveConversation(storageNamespace, id)
    const conv = getActiveConversation(storageNamespace)
    if (conv) {
      setMessages(conv.messages as ChatMessage[])
      setCurrentConversationId(conv.id)
    }
    setToolSteps([])
    setIsSending(false)
  }, [storageNamespace])

  const clearHistory = useCallback(() => {
    abortRef.current?.abort()
    clearAllConversations(storageNamespace)
    setMessages([])
    setCurrentConversationId(null)
    setConversationList([])
    setToolSteps([])
  }, [storageNamespace])

  const refreshConversationList = useCallback(() => {
    setConversationList(listConversations(storageNamespace))
  }, [storageNamespace])

  // Server-side hydration: replace messages with the transcript fetched
  // from Prisma. Caller is responsible for ordering (oldest → newest).
  const loadMessages = useCallback((nextMessages: ChatMessage[]) => {
    abortRef.current?.abort()
    setMessages(nextMessages)
    messagesRef.current = nextMessages
    setToolSteps([])
    setIsSending(false)
  }, [])

  return {
    messages,
    isSending,
    toolSteps,
    sendStartedAt,
    currentConversationId,
    conversationList,
    storageNamespace,
    send,
    stop,
    retry,
    newChat,
    switchConversation,
    clearHistory,
    refreshConversationList,
    loadMessages,
  }
}
