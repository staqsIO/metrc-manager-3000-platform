// localStorage CRUD for copilot conversation persistence
// Scoped per facility, max 50 conversations, 200 messages each

const MAX_CONVERSATIONS = 50
const MAX_MESSAGES = 200
const STORE_VERSION = 1

export interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  toolsUsed?: string[]
  suggestions?: string[]
}

export interface Conversation {
  id: string
  title: string
  messages: StoredMessage[]
  createdAt: number
  updatedAt: number
}

interface ConversationStore {
  version: number
  activeConversationId: string | null
  conversations: Conversation[]
}

function storageKey(facilityId: string): string {
  return `copilot-conversations-${facilityId}`
}

function emptyStore(): ConversationStore {
  return { version: STORE_VERSION, activeConversationId: null, conversations: [] }
}

export function loadStore(facilityId: string): ConversationStore {
  if (typeof window === 'undefined') return emptyStore()
  try {
    const raw = localStorage.getItem(storageKey(facilityId))
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as ConversationStore
    if (parsed.version !== STORE_VERSION) return emptyStore()
    return parsed
  } catch {
    return emptyStore()
  }
}

export function saveStore(facilityId: string, store: ConversationStore): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKey(facilityId), JSON.stringify(store))
  } catch {
    // QuotaExceededError — evict oldest conversations and retry
    if (store.conversations.length > 1) {
      store.conversations = store.conversations.slice(-Math.ceil(store.conversations.length / 2))
      try {
        localStorage.setItem(storageKey(facilityId), JSON.stringify(store))
      } catch {
        // give up silently
      }
    }
  }
}

export function createConversation(facilityId: string): Conversation {
  const store = loadStore(facilityId)
  const conv: Conversation = {
    id: crypto.randomUUID(),
    title: 'New conversation',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  store.conversations.push(conv)
  // Evict oldest if over limit
  if (store.conversations.length > MAX_CONVERSATIONS) {
    store.conversations = store.conversations.slice(-MAX_CONVERSATIONS)
  }
  store.activeConversationId = conv.id
  saveStore(facilityId, store)
  return conv
}

export function getActiveConversation(facilityId: string): Conversation | null {
  const store = loadStore(facilityId)
  if (!store.activeConversationId) return null
  return store.conversations.find(c => c.id === store.activeConversationId) ?? null
}

export function setActiveConversation(facilityId: string, conversationId: string): void {
  const store = loadStore(facilityId)
  if (store.conversations.some(c => c.id === conversationId)) {
    store.activeConversationId = conversationId
    saveStore(facilityId, store)
  }
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
}

export function listConversations(facilityId: string): ConversationSummary[] {
  const store = loadStore(facilityId)
  return store.conversations
    .map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function appendMessage(facilityId: string, conversationId: string, message: StoredMessage): void {
  const store = loadStore(facilityId)
  const conv = store.conversations.find(c => c.id === conversationId)
  if (!conv) return
  conv.messages.push(message)
  // Evict oldest messages if over limit
  if (conv.messages.length > MAX_MESSAGES) {
    conv.messages = conv.messages.slice(-MAX_MESSAGES)
  }
  // Set title from first user message
  if (conv.title === 'New conversation' && message.role === 'user') {
    conv.title = message.content.length > 60 ? message.content.slice(0, 57) + '...' : message.content
  }
  conv.updatedAt = Date.now()
  saveStore(facilityId, store)
}

export function deleteConversation(facilityId: string, conversationId: string): void {
  const store = loadStore(facilityId)
  store.conversations = store.conversations.filter(c => c.id !== conversationId)
  if (store.activeConversationId === conversationId) {
    store.activeConversationId = store.conversations.length > 0
      ? store.conversations[store.conversations.length - 1]!.id
      : null
  }
  saveStore(facilityId, store)
}

export function clearAllConversations(facilityId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(storageKey(facilityId))
  } catch {
    // ignore
  }
}
