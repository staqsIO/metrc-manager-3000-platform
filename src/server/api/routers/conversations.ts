import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, platformProcedure } from '@/lib/trpc'
import { getUserOrgIds } from '@/lib/auth-helpers'
import { dashboardPrisma } from '@/lib/prisma'

/**
 * Phase 2.5 — Conversation persistence.
 *
 * A Conversation owns multi-turn chat threads. Replaces the localStorage
 * `chat-storage` namespace as source of truth for resume-after-exit and
 * cross-device continuity. ConversationMessage rows are the chronological
 * transcript (USER + ASSISTANT). Assistant rows back-reference the Run
 * that produced them so the UI can deep-link into artifacts.
 *
 * Scope:
 *   - Org-level by default; users see all conversations in any org they
 *     belong to (matches Run/Artifact behavior — share-by-default within org).
 *   - `userId` is captured at create time for "my conversations" filtering
 *     but is not an access control boundary.
 */

async function resolveScopedOrgIds(ctx: {
  session: { user: { id: string } }
  activeOrgId: string | null
}): Promise<string[]> {
  const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id)
  if (orgIds.length === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No organization membership found' })
  }
  return ctx.activeOrgId && orgIds.includes(ctx.activeOrgId) ? [ctx.activeOrgId] : orgIds
}

function deriveTitle(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, ' ')
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed || 'Untitled conversation'
}

export const conversationsRouter = createTRPCRouter({
  /**
   * List recent conversations in the active org, sorted by lastMessageAt.
   * Excludes archived threads by default.
   */
  list: platformProcedure
    .input(
      z
        .object({
          facilityId: z.string().optional(),
          mineOnly: z.boolean().optional(),
          includeArchived: z.boolean().optional(),
          limit: z.number().min(1).max(100).default(25),
          cursor: z.string().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const orgIds = await resolveScopedOrgIds(ctx)
      const conversations = await ctx.prisma.conversation.findMany({
        where: {
          organizationId: { in: orgIds },
          ...(input.facilityId ? { facilityId: input.facilityId } : {}),
          ...(input.mineOnly ? { userId: ctx.session.user.id } : {}),
          ...(input.includeArchived ? {} : { archivedAt: null }),
        },
        orderBy: { lastMessageAt: 'desc' },
        take: input.limit + 1,
        ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
      })
      const hasMore = conversations.length > input.limit
      const items = hasMore ? conversations.slice(0, input.limit) : conversations
      return {
        conversations: items,
        nextCursor: hasMore ? items[items.length - 1]?.id : null,
      }
    }),

  /**
   * Get a single conversation with its full message transcript. The UI
   * hydrates from this on `?conversation=<id>` mount.
   */
  get: platformProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const orgIds = await resolveScopedOrgIds(ctx)
      const conversation = await ctx.prisma.conversation.findUnique({
        where: { id: input.conversationId },
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
        },
      })
      if (!conversation || !orgIds.includes(conversation.organizationId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found in your scope' })
      }
      return conversation
    }),

  /**
   * Create a new conversation. The chat handler calls this implicitly when
   * the user sends the first message of a new thread; exposed for the
   * "New chat" button to optimistically reserve an id before the first send.
   */
  create: platformProcedure
    .input(
      z.object({
        facilityId: z.string().optional(),
        seedPrompt: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgIds = await resolveScopedOrgIds(ctx)
      const orgId = ctx.activeOrgId && orgIds.includes(ctx.activeOrgId) ? ctx.activeOrgId : orgIds[0]
      if (!orgId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No active organization' })
      }
      const conversation = await ctx.prisma.conversation.create({
        data: {
          organizationId: orgId,
          userId: ctx.session.user.id,
          facilityId: input.facilityId ?? null,
          title: input.seedPrompt ? deriveTitle(input.seedPrompt) : 'New conversation',
        },
      })
      return conversation
    }),

  /**
   * Rename a conversation (manual override of the auto-derived title).
   */
  rename: platformProcedure
    .input(
      z.object({
        conversationId: z.string(),
        title: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgIds = await resolveScopedOrgIds(ctx)
      const existing = await ctx.prisma.conversation.findUnique({
        where: { id: input.conversationId },
      })
      if (!existing || !orgIds.includes(existing.organizationId)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      return ctx.prisma.conversation.update({
        where: { id: input.conversationId },
        data: { title: input.title },
      })
    }),

  /**
   * Soft-archive a conversation (drops out of the Recent rail but keeps
   * messages + Run history queryable for compliance). Hard delete is
   * intentionally not exposed — Run/Artifact links would break.
   */
  archive: platformProcedure
    .input(z.object({ conversationId: z.string(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await resolveScopedOrgIds(ctx)
      const existing = await ctx.prisma.conversation.findUnique({
        where: { id: input.conversationId },
      })
      if (!existing || !orgIds.includes(existing.organizationId)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      return ctx.prisma.conversation.update({
        where: { id: input.conversationId },
        data: { archivedAt: input.archived ? new Date() : null },
      })
    }),

  /**
   * One-shot migration: walks the client's localStorage `chat-storage` blobs
   * and lands them in Prisma. Idempotent — the client tracks a per-version
   * flag and only ships threads that don't already exist server-side. We
   * additionally guard via title+createdAt fingerprint so re-running the
   * migration on a fresh device for the same user doesn't create duplicates.
   */
  importLocalStorage: platformProcedure
    .input(
      z.object({
        threads: z
          .array(
            z.object({
              facilityId: z.string().nullable(),
              title: z.string(),
              createdAt: z.number(),
              lastMessageAt: z.number(),
              messages: z
                .array(
                  z.object({
                    role: z.enum(['user', 'assistant']),
                    content: z.string(),
                    toolsUsed: z.array(z.string()).optional(),
                    createdAt: z.number().optional(),
                  }),
                )
                .max(500),
            }),
          )
          .max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgIds = await resolveScopedOrgIds(ctx)
      const orgId = ctx.activeOrgId && orgIds.includes(ctx.activeOrgId) ? ctx.activeOrgId : orgIds[0]
      if (!orgId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No active organization' })
      }

      // Pre-fetch existing fingerprints for this user/org to dedupe.
      const existing = await ctx.prisma.conversation.findMany({
        where: { organizationId: orgId, userId: ctx.session.user.id },
        select: { title: true, createdAt: true },
      })
      const existingFingerprints = new Set(
        existing.map((c) => `${c.title}|${c.createdAt.getTime()}`),
      )

      let imported = 0
      let skipped = 0
      for (const thread of input.threads) {
        const fingerprint = `${thread.title}|${thread.createdAt}`
        if (existingFingerprints.has(fingerprint)) {
          skipped += 1
          continue
        }
        if (thread.messages.length === 0) {
          skipped += 1
          continue
        }
        const created = await ctx.prisma.conversation.create({
          data: {
            organizationId: orgId,
            userId: ctx.session.user.id,
            facilityId: thread.facilityId ?? null,
            title: thread.title.slice(0, 200) || 'Imported conversation',
            createdAt: new Date(thread.createdAt),
            lastMessageAt: new Date(thread.lastMessageAt || thread.createdAt),
          },
        })
        // Bulk insert messages preserving ordering. createMany is faster
        // than per-row creates and we don't need the row ids back.
        await ctx.prisma.conversationMessage.createMany({
          data: thread.messages.map((m, idx) => ({
            conversationId: created.id,
            role: m.role,
            content: m.content,
            toolsUsed: m.toolsUsed ?? [],
            createdAt: new Date(m.createdAt ?? thread.createdAt + idx),
          })),
        })
        imported += 1
      }
      return { imported, skipped }
    }),

  /**
   * Append a chat message. Called by the SSE chat handler on each turn —
   * USER message at request start, ASSISTANT message after the Run completes.
   * Bumps Conversation.lastMessageAt + (for first message) sets the title.
   */
  appendMessage: platformProcedure
    .input(
      z.object({
        conversationId: z.string(),
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
        runId: z.string().optional(),
        toolsUsed: z.array(z.string()).optional(),
        audit: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgIds = await resolveScopedOrgIds(ctx)
      const conversation = await ctx.prisma.conversation.findUnique({
        where: { id: input.conversationId },
      })
      if (!conversation || !orgIds.includes(conversation.organizationId)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }

      const [message] = await ctx.prisma.$transaction([
        ctx.prisma.conversationMessage.create({
          data: {
            conversationId: input.conversationId,
            role: input.role,
            content: input.content,
            runId: input.runId ?? null,
            toolsUsed: input.toolsUsed ?? [],
            audit: (input.audit ?? null) as never,
          },
        }),
        ctx.prisma.conversation.update({
          where: { id: input.conversationId },
          data: {
            lastMessageAt: new Date(),
            // First user message sets the title if it's still the default.
            ...(input.role === 'user' && conversation.title === 'New conversation'
              ? { title: deriveTitle(input.content) }
              : {}),
          },
        }),
      ])
      return message
    }),
})
