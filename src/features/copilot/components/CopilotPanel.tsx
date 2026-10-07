'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  X, Send, Square, RotateCcw, Sparkles, Plus, History as HistoryIcon, ExternalLink, Loader2, CheckCircle2,
  AlertTriangle, Building2, Package, ShieldCheck, ArrowDownUp,
  Layers, FlaskConical, Clock, Timer, Combine, GitBranch,
  Maximize2, Minimize2, Trash2,
  BarChart3, DollarSign, Tag, Receipt, ClipboardCheck, ClipboardList,
  Sun, Sprout, PackageSearch,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import React from 'react'
import { useCopilot } from '../CopilotContext'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/shared/components/ui/dropdown-menu'
import { findDeepLinks } from '@/features/copilot/lib/deep-links'
import {
  getToolDisplayName,
  getToolCategory,
  getToolBadgeClass,
  getToolPrefix,
} from '@/features/copilot/lib/tool-display'
import { formatRelativeTime, deriveDisplayName, reconcileSelectedModel } from '@/features/copilot/lib/format'
import { useCopilotChat } from '@/features/copilot/hooks/useCopilotChat'
import { getBrand } from '@/lib/brand'

interface CopilotPanelProps {
  facilityId: string | null
  isExpanded?: boolean
  isFullPage?: boolean
  /** Server-persisted Conversation id. When set, the panel hydrates messages
   *  from Prisma instead of localStorage and bumps writes to the server. */
  serverConversationId?: string | null
  /** Fires when the server emits a Conversation id for a freshly-minted
   *  thread (no id was passed in). Consumers wire this to update the URL. */
  onServerConversationChange?: (id: string, created: boolean) => void
  /** Initial transcript fetched server-side. Overrides localStorage hydration
   *  while serverConversationId is set. */
  initialMessages?: import('../hooks/useCopilotChat').ChatMessage[]
}

// ---------------------------------------------------------------------------
// Icon mapping for skill cards
// ---------------------------------------------------------------------------

const SKILL_ICON_MAP: Record<string, LucideIcon> = {
  AlertTriangle,
  Building2,
  Package,
  ShieldCheck,
  ArrowDownUp,
  Layers,
  FlaskConical,
  Clock,
  Timer,
  Combine,
  GitBranch,
  BarChart3,
  DollarSign,
  Tag,
  Receipt,
  ClipboardCheck,
  ClipboardList,
  Sun,
  Sprout,
  PackageSearch,
  Trash2,
}

const PRIMARY_SKILL_CAP = 6

const SKILL_CATEGORIES = ['all', 'compliance', 'inventory', 'operations'] as const
type SkillCategory = typeof SKILL_CATEGORIES[number]

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  all: 'All',
  compliance: 'Compliance',
  inventory: 'Inventory',
  operations: 'Operations',
}

// ---------------------------------------------------------------------------
// Deep link detection — maps text patterns to facility-relative URLs
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Warmup indicator — shows "warming up" after 5s of no response
// ---------------------------------------------------------------------------

function WarmupIndicator({ startedAt }: { startedAt: number | null }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startedAt) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  const isWarming = elapsed >= 5

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span>
        {isWarming
          ? `AI model is warming up... (${elapsed}s)`
          : 'Connecting...'}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Smart table component — stacked cards in sidebar, HTML table in expanded
// ---------------------------------------------------------------------------

function getChildrenProp(el: React.ReactElement): React.ReactNode {
  return (el.props as { children?: React.ReactNode }).children
}

function extractTableData(children: React.ReactNode): { headers: string[]; rows: string[][] } {
  const headers: string[] = []
  const rows: string[][] = []

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    const childContent = getChildrenProp(child)
    const tag = child.type
    if (tag === 'thead') {
      // Walk thead > tr > th
      React.Children.forEach(childContent, (tr) => {
        if (!React.isValidElement(tr)) return
        React.Children.forEach(getChildrenProp(tr), (th) => {
          if (!React.isValidElement(th)) return
          const text = extractText(getChildrenProp(th))
          headers.push(text)
        })
      })
    } else if (tag === 'tbody') {
      React.Children.forEach(childContent, (tr) => {
        if (!React.isValidElement(tr)) return
        const row: string[] = []
        React.Children.forEach(getChildrenProp(tr), (td) => {
          if (!React.isValidElement(td)) return
          const text = extractText(getChildrenProp(td))
          row.push(text)
        })
        if (row.length > 0) rows.push(row)
      })
    }
  })

  return { headers, rows }
}

function extractText(node: React.ReactNode): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) return extractText(getChildrenProp(node))
  return ''
}

function CopilotTable({ children, isExpanded }: { children: React.ReactNode; isExpanded: boolean }) {
  if (isExpanded) {
    return (
      <div className="my-2 rounded-md border border-border/50 overflow-hidden">
        <table className="w-full text-xs">{children}</table>
      </div>
    )
  }

  // Sidebar mode: render as stacked key-value cards
  const { headers, rows } = extractTableData(children)
  if (headers.length === 0 || rows.length === 0) {
    // Fallback to regular table if extraction fails
    return (
      <div className="my-2 rounded-md border border-border/50 overflow-hidden">
        <table className="w-full text-xs">{children}</table>
      </div>
    )
  }

  return (
    <div className="my-2 space-y-0 rounded-lg border border-border/50 overflow-hidden divide-y divide-border/30">
      {rows.map((row, ri) => (
        <div key={ri} className="px-2.5 py-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {row.map((cell, ci) => (
            <React.Fragment key={ci}>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {headers[ci] || ''}
              </span>
              <span className="text-xs text-foreground">{cell}</span>
            </React.Fragment>
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CopilotPanel({
  facilityId,
  isExpanded = false,
  isFullPage = false,
  serverConversationId = null,
  onServerConversationChange,
  initialMessages,
}: CopilotPanelProps) {
  const chat = useCopilotChat(facilityId, {
    serverConversationId,
    onServerConversationChange,
  })

  // Hydrate from server-fetched messages once per conversation id. The ref
  // guard prevents (a) stale renders where initialMessages arrives after the
  // id is set — without it, navigating back from an artifact view leaves
  // the panel empty until you click another conversation — and (b) tRPC
  // background refetches from clobbering in-flight local edits.
  const hydratedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!serverConversationId || !initialMessages) return
    if (hydratedFor.current === serverConversationId) return
    chat.loadMessages(initialMessages)
    hydratedFor.current = serverConversationId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverConversationId, initialMessages])
  const {
    messages, isSending, toolSteps, sendStartedAt,
    currentConversationId, conversationList, storageNamespace,
    send, stop, retry, newChat, switchConversation, clearHistory,
  } = chat

  const [input, setInput] = useState('')
  const [skillCategory, setSkillCategory] = useState<SkillCategory>('all')
  const [showAllSkills, setShowAllSkills] = useState(false)
  const [auditMode, setAuditMode] = useState(false)
  const [expandedAuditIdx, setExpandedAuditIdx] = useState<number | null>(null)
  const logSkillClick = trpc.copilot.logSkillClick.useMutation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { isOpen: contextIsOpen, close, prefillMessage, clearPrefill, toggleExpanded, startNewChat, clearNewChatRequest } = useCopilot()
  // The full-page route is "open" by definition — the user navigated to it.
  // The CopilotContext.isOpen flag is only meaningful for the floating widget.
  const isOpen = isFullPage || contextIsOpen

  // Model selector state — panel-local; passed into chat.send per call
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem(`copilot-model-${storageNamespace}`) || ''
  })

  const { data: availableModels } = trpc.copilot.getAvailableModels.useQuery(
    { facilityId: facilityId ?? undefined },
    { staleTime: 5 * 60 * 1000 },
  )

  const { data: activeModel } = trpc.copilot.getActiveModel.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 },
  )
  // null = no LLM provider configured (super admin hasn't set one up yet)
  const activeModelLabel = activeModel === null ? 'AI disabled' : (activeModel?.displayName ?? 'Default model')

  // Drop a persisted model that no enabled provider offers any more (provider removed/edited).
  useEffect(() => {
    if (reconcileSelectedModel(selectedModel, availableModels) !== selectedModel) {
      setSelectedModel('')
      localStorage.removeItem(`copilot-model-${storageNamespace}`)
    }
  }, [selectedModel, availableModels, storageNamespace])

  const handleModelSelect = useCallback((modelId: string) => {
    setSelectedModel(modelId)
    if (modelId) {
      localStorage.setItem(`copilot-model-${storageNamespace}`, modelId)
    } else {
      localStorage.removeItem(`copilot-model-${storageNamespace}`)
    }
  }, [storageNamespace])

  // Wrap chat.send with the panel's per-call options (model + audit toggle)
  const submit = useCallback((text: string, opts: { skillId?: string; overrideHistory?: { role: 'user' | 'assistant'; content: string }[] } = {}) => {
    return send(text, {
      model: selectedModel || undefined,
      captureAudit: auditMode,
      ...opts,
    })
  }, [send, selectedModel, auditMode])

  // Fetch skills (works in both facility and org mode)
  const { data: skills } = trpc.copilot.getSkills.useQuery(
    { facilityId: facilityId ?? undefined },
    { enabled: isOpen && messages.length === 0, staleTime: 300_000 },
  )

  // Notification summary from briefing
  const { data: briefing } = trpc.copilot.getBriefing.useQuery(
    { facilityId: facilityId! },
    { enabled: !!facilityId && isOpen && messages.length === 0, staleTime: 300_000 },
  )

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, toolSteps])

  // Handle prefill messages from CopilotContext
  useEffect(() => {
    if (prefillMessage && isOpen) {
      clearPrefill()
      if (startNewChat) {
        clearNewChatRequest()
        // Start a fresh conversation, then send with explicit empty history
        // so a stale closure can't leak the prior conversation in.
        newChat()
        submit(prefillMessage, { overrideHistory: [] })
      } else {
        submit(prefillMessage)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillMessage, isOpen, storageNamespace])

  const handleSend = (text?: string) => {
    const msg = text || input.trim()
    if (!msg) return
    setInput('')
    void submit(msg)
  }

  const handleStop = () => stop()

  const handleRetry = () => { void retry() }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleNewChat = () => {
    newChat()
    setInput('')
    setSkillCategory('all')
  }

  const handleSwitchConversation = (id: string) => {
    switchConversation(id)
  }

  const handleClearHistory = () => {
    clearHistory()
    setSkillCategory('all')
  }

  const handleDeepLink = (path: string) => {
    if (!facilityId) return
    router.push(`/facilities/${facilityId}${path}`)
  }

  const actionableInsights = briefing?.insights.filter(i => i.severity === 'critical' || i.severity === 'warning') || []

  type SkillItem = { id: string; name: string; shortDescription: string; icon: string; triggerPhrases: string[]; category: string; priority?: 'primary' | 'secondary' }
  const filteredSkills: SkillItem[] = (skills as SkillItem[] | undefined)
    ?.filter(s => skillCategory === 'all' || s.category === skillCategory)
    .slice()
    .sort((a, b) => (a.priority === 'primary' ? 0 : 1) - (b.priority === 'primary' ? 0 : 1)) || []
  const visibleSkills = showAllSkills ? filteredSkills : filteredSkills.slice(0, PRIMARY_SKILL_CAP)
  const hasMoreSkills = filteredSkills.length > PRIMARY_SKILL_CAP

  const handleSkillClick = (skill: SkillItem) => {
    logSkillClick.mutate({
      skillId: skill.id,
      surface: 'skill_card',
      facilityId: facilityId ?? undefined,
    })
    void submit(skill.triggerPhrases[0], { skillId: skill.id })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">{getBrand().name} Copilot</h3>
            <p className="text-xs text-muted-foreground">{facilityId ? 'AI-powered inventory assistant' : 'Cross-facility intelligence'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleNewChat} className="p-1.5 rounded-md text-muted-foreground hover:bg-accent" title="New chat">
            <Plus className="h-4 w-4" />
          </button>
          {/* Privacy audit toggle — when on, captures the anonymized payload sent to the LLM */}
          <button
            onClick={() => setAuditMode(v => !v)}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors',
              auditMode
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-border text-muted-foreground hover:bg-accent',
            )}
            title={auditMode ? 'Privacy audit ON — next response shows what we sent to the LLM' : 'Privacy audit OFF — click to capture the anonymized payload on the next turn'}
          >
            <ShieldCheck className="h-3 w-3" />
            Audit
          </button>
          {/* Model selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'px-2 py-1 rounded-md text-[11px] font-medium border transition-colors',
                  selectedModel
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
                title="Select LLM model"
              >
                {selectedModel
                  ? deriveDisplayName(selectedModel)
                  : activeModelLabel}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => handleModelSelect('')}>
                <span className="text-xs">{activeModelLabel} (Default)</span>
                {activeModel && (
                  <span className="ml-auto text-[10px] text-muted-foreground">{activeModel.provider}</span>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {availableModels?.map((m) => (
                <DropdownMenuItem
                  key={m.model_id}
                  onClick={() => handleModelSelect(m.model_id)}
                >
                  <span className="text-xs">{m.display_name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{m.provider}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1.5 rounded-md text-muted-foreground hover:bg-accent" title="Chat history">
                <HistoryIcon className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
              {conversationList.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground text-center">No conversations yet</div>
              ) : (
                <>
                  {conversationList.map(conv => (
                    <DropdownMenuItem
                      key={conv.id}
                      onClick={() => handleSwitchConversation(conv.id)}
                      className={cn(
                        'flex items-center justify-between gap-2 cursor-pointer',
                        conv.id === currentConversationId && 'bg-accent',
                      )}
                    >
                      <span className="truncate text-xs">{conv.title}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{formatRelativeTime(conv.updatedAt)}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleClearHistory}
                    className="text-xs text-destructive focus:text-destructive cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Clear all conversations
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {!isFullPage && (
            <button onClick={toggleExpanded} className="p-1.5 rounded-md text-muted-foreground hover:bg-accent" title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}>
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}
          {!isFullPage && (
            <button onClick={close} className="p-1.5 rounded-md text-muted-foreground hover:bg-accent" title="Close sidebar">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages — bottom-anchored: when the conversation is short, the
          content sits adjacent to the input rather than leaving a blank gap
          below it. The min-h-full + flex-col + justify-end on the inner
          wrapper pushes content down; once it overflows, scroll engages
          naturally. */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col justify-end p-4 space-y-4">
        {messages.length === 0 ? (
          <div>
            <div className="text-center mb-4">
              <Sparkles className="h-8 w-8 text-primary mx-auto mb-2" />
              {facilityId ? (
                <>
                  <p className="font-medium text-sm">How can I help?</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    I can analyze your data AND take actions in Metrc.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-sm">Organization Overview</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ask me about cross-facility operations, financials, and comparisons.
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    For facility-specific analysis and Metrc actions, open Copilot from a facility page.
                  </p>
                </>
              )}
            </div>

            {/* Proactive notification summary */}
            {actionableInsights.length > 0 && (
              <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
                <p className="text-xs font-semibold text-yellow-600 dark:text-yellow-400 mb-1.5">
                  {actionableInsights.length} issue{actionableInsights.length !== 1 ? 's' : ''} need attention
                </p>
                {actionableInsights.slice(0, 3).map((insight, i) => (
                  <div key={i} className="flex items-center justify-between text-xs mt-1">
                    <span className="text-muted-foreground truncate mr-2">{insight.title}</span>
                    {insight.link && (
                      <button
                        onClick={() => handleDeepLink(insight.link!.replace(`/facilities/${facilityId}`, ''))}
                        className="text-primary hover:underline shrink-0"
                      >
                        {insight.action}
                      </button>
                    )}
                  </div>
                ))}
                {actionableInsights.length > 3 && (
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    +{actionableInsights.length - 3} more
                  </p>
                )}
              </div>
            )}

            {/* Skills Showcase */}
            {skills && skills.length > 0 ? (
              <div>
                {/* Category tabs */}
                <div className="flex gap-1 mb-3">
                  {SKILL_CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      onClick={() => { setSkillCategory(cat); setShowAllSkills(false) }}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                        skillCategory === cat
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>

                {/* Skill cards */}
                <div className={(isExpanded || isFullPage) ? 'grid grid-cols-2 lg:grid-cols-3 gap-2' : 'space-y-2'}>
                  {visibleSkills.map((skill) => {
                    const IconComponent = SKILL_ICON_MAP[skill.icon] || Sparkles
                    return (
                      <button
                        key={skill.id}
                        onClick={() => handleSkillClick(skill)}
                        className="w-full text-left rounded-lg border border-border hover:bg-accent transition-colors px-3 py-2"
                      >
                        <div className="flex items-start gap-2">
                          <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                            <IconComponent className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <span className="text-sm font-medium block">{skill.name}</span>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {skill.shortDescription}
                            </p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
                {hasMoreSkills && (
                  <button
                    onClick={() => setShowAllSkills(v => !v)}
                    className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showAllSkills ? 'Show fewer' : `Show ${filteredSkills.length - PRIMARY_SKILL_CAP} more`}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                (isExpanded || isFullPage) ? 'max-w-2xl' : 'max-w-[85%]',
                msg.role === 'user' ? 'ml-auto' : 'mr-auto',
              )}
            >
              <div
                className={cn(
                  'rounded-xl px-3 py-2 text-sm',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted',
                )}
              >
                {msg.role === 'assistant' ? (
                  <div>
                    {/* Tool badges */}
                    {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {Array.from(new Set(msg.toolsUsed)).map((tool, ti) => {
                          const category = getToolCategory(tool)
                          return (
                            <span
                              key={ti}
                              className={cn(
                                'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                                getToolBadgeClass(category),
                              )}
                            >
                              {getToolPrefix(category)}{getToolDisplayName(tool)}
                            </span>
                          )
                        })}
                      </div>
                    )}

                    {/* Message content */}
                    <div className="copilot-prose max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-3 mb-1.5 first:mt-0">{children}</h3>,
                          h2: ({ children }) => <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-3 mb-1.5 first:mt-0">{children}</h3>,
                          h3: ({ children }) => <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-3 mb-1.5 first:mt-0">{children}</h3>,
                          h4: ({ children }) => <h4 className="text-xs font-medium text-muted-foreground mt-2 mb-1">{children}</h4>,
                          p: ({ children }) => <p className="text-sm leading-relaxed my-1.5">{children}</p>,
                          ul: ({ children }) => <ul className="my-1.5 space-y-1 text-sm">{children}</ul>,
                          ol: ({ children }) => <ol className="my-1.5 space-y-1 text-sm list-decimal list-inside">{children}</ol>,
                          li: ({ children }) => <li className="text-sm leading-snug pl-1">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                          hr: () => <hr className="my-2.5 border-t border-border/60" />,
                          code: ({ children }) => <code className="text-[11px] font-mono bg-black/20 px-1 py-0.5 rounded">{children}</code>,
                          table: ({ children }) => <CopilotTable isExpanded={isExpanded || isFullPage}>{children}</CopilotTable>,
                          thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
                          tbody: ({ children }) => <tbody className="divide-y divide-border/30">{children}</tbody>,
                          tr: ({ children }) => <tr>{children}</tr>,
                          th: ({ children }) => <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</th>,
                          td: ({ children }) => <td className="px-2 py-1.5 text-xs">{children}</td>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>

                    {/* Deep links for this message */}
                    {facilityId && (() => {
                      const links = findDeepLinks(msg.content)
                      if (links.length === 0) return null
                      return (
                        <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-border/50">
                          {links.map((link, li) => (
                            <button
                              key={li}
                              onClick={() => handleDeepLink(link.path)}
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                            >
                              <ExternalLink className="h-2.5 w-2.5" />
                              {link.label}
                            </button>
                          ))}
                        </div>
                      )
                    })()}

                    {/* Retry button on error messages */}
                    {msg.isError && !isSending && (
                      <button
                        onClick={handleRetry}
                        className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-md text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Try again
                      </button>
                    )}

                    {/* Suggestion chips — only on last assistant message */}
                    {i === messages.length - 1 && msg.suggestions && msg.suggestions.length > 0 && !isSending && (
                      <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-border/50">
                        {msg.suggestions.map((s, si) => (
                          <button
                            key={si}
                            onClick={() => handleSend(s)}
                            className="px-2.5 py-1 rounded-full text-xs font-medium border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Privacy audit — what we sent to the LLM */}
                    {msg.audit && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <button
                          onClick={() => setExpandedAuditIdx(expandedAuditIdx === i ? null : i)}
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <span aria-hidden="true">{expandedAuditIdx === i ? '▾' : '▸'}</span>
                          Privacy audit · {msg.audit.mappings.length} values masked, {msg.audit.entries.length} payload{msg.audit.entries.length === 1 ? '' : 's'} sent
                        </button>
                        {expandedAuditIdx === i && (
                          <div className="mt-2 space-y-3">
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Sensitive value → token</div>
                              <div className="rounded border border-border/60 divide-y divide-border/40">
                                {msg.audit.mappings.length === 0 && (
                                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground italic">No sensitive values were detected in this turn.</div>
                                )}
                                {msg.audit.mappings.map((m, mi) => (
                                  <div key={mi} className="grid grid-cols-[60px_1fr_1fr] gap-2 px-2 py-1 text-[11px]">
                                    <span className="text-muted-foreground uppercase tracking-wider">{m.type}</span>
                                    <span className="font-mono text-foreground truncate" title={m.real}>{m.real}</span>
                                    <span className="font-mono text-emerald-400 truncate" title={m.token}>{m.token}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Payloads sent to OpenRouter (anonymized)</div>
                              <div className="space-y-1.5">
                                {msg.audit.entries.map((e, ei) => (
                                  <details key={ei} className="rounded border border-border/60 overflow-hidden">
                                    <summary className="cursor-pointer px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent/30">
                                      {e.source} · {e.sentToLLM.length.toLocaleString()} chars
                                    </summary>
                                    <pre className="px-2 py-1.5 text-[10px] font-mono whitespace-pre-wrap break-all text-foreground/80 bg-muted/30 max-h-48 overflow-auto">{e.sentToLLM}</pre>
                                  </details>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <span>{msg.content}</span>
                )}
              </div>
            </div>
          ))
        )}

        {/* Streaming tool progress */}
        {isSending && (
          <div className={cn('mr-auto', isExpanded ? 'max-w-2xl' : 'max-w-[85%]')}>
            <div className="bg-muted rounded-xl px-3 py-2.5 space-y-1.5">
              {toolSteps.length === 0 ? (
                <WarmupIndicator startedAt={sendStartedAt} />
              ) : (
                toolSteps.map((step, i) => {
                  const category = getToolCategory(step.tool)
                  const displayName = getToolDisplayName(step.tool)
                  const prefix = getToolPrefix(category)
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {step.status === 'running' ? (
                        <Loader2 className="h-3 w-3 animate-spin shrink-0 text-muted-foreground" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                      )}
                      <span className={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                        getToolBadgeClass(category),
                      )}>
                        {prefix}{displayName}
                      </span>
                      {step.status === 'running' && (
                        <span className="text-muted-foreground text-[10px]">running...</span>
                      )}
                    </div>
                  )
                })
              )}
              {/* Always show a "working" indicator at the bottom when tools are done but response isn't */}
              {toolSteps.length > 0 && toolSteps.every(s => s.status === 'done') && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-0.5">
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  <span>Composing response...</span>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={facilityId ? 'Ask anything or request an action...' : 'Ask about your organization...'}
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
          />
          {isSending ? (
            <Button
              size="sm"
              variant="outline"
              onClick={handleStop}
              className="px-3"
              title="Stop generating"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="px-3"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
