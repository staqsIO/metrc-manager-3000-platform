import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, platformProcedure } from '@/lib/trpc';

/**
 * Phase 3a — notifications inbox.
 *
 * Notifications are written by the Phase 3c cron worker when a scheduled
 * Run's findings change between executions, by future Phase 4 drafted-action
 * surfaces, and by anything else that needs to ping the user without an
 * email. Strictly user-scoped; no org-level fan-out (each user sees their
 * own inbox).
 */

const NOTIFICATION_TYPES = [
  'agent_finding',
  'drafted_action',
  'run_completed',
  'run_failed',
  'system',
] as const;

export const notificationsRouter = createTRPCRouter({
  /** Paginated list, scoped to the current user. */
  list: platformProcedure
    .input(z.object({
      unreadOnly: z.boolean().optional(),
      cursor: z.string().nullish(),
      limit: z.number().min(1).max(50).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const items = await ctx.prisma.notification.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input?.unreadOnly ? { read: false } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      let nextCursor: string | undefined;
      if (items.length > limit) {
        nextCursor = items.pop()!.id;
      }
      return { items, nextCursor };
    }),

  /** Unread count for the bell badge. Cached aggressively on the client. */
  unreadCount: platformProcedure
    .query(async ({ ctx }) => {
      const count = await ctx.prisma.notification.count({
        where: { userId: ctx.session.user.id, read: false },
      });
      return { count };
    }),

  markRead: platformProcedure
    .input(z.object({ notificationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.notification.findFirst({
        where: { id: input.notificationId, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Notification not found' });
      }
      return ctx.prisma.notification.update({
        where: { id: input.notificationId },
        data: { read: true, readAt: new Date() },
      });
    }),

  markAllRead: platformProcedure
    .mutation(async ({ ctx }) => {
      const result = await ctx.prisma.notification.updateMany({
        where: { userId: ctx.session.user.id, read: false },
        data: { read: true, readAt: new Date() },
      });
      return { updated: result.count };
    }),

  delete: platformProcedure
    .input(z.object({ notificationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.notification.findFirst({
        where: { id: input.notificationId, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Notification not found' });
      }
      await ctx.prisma.notification.delete({ where: { id: input.notificationId } });
      return { success: true };
    }),

  /**
   * Internal: create a notification. Exposed via tRPC so Phase 3c cron and
   * Phase 4 drafted-action surfaces can write through the typed API rather
   * than reaching directly into Prisma. Scoped to the calling user (no
   * cross-user delivery yet).
   */
  create: platformProcedure
    .input(z.object({
      organizationId: z.string(),
      runId: z.string().optional(),
      artifactId: z.string().optional(),
      type: z.enum(NOTIFICATION_TYPES),
      severity: z.enum(['info', 'warning', 'critical']).default('info'),
      title: z.string().min(1).max(200),
      body: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.notification.create({
        data: {
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          runId: input.runId ?? null,
          artifactId: input.artifactId ?? null,
          type: input.type,
          severity: input.severity,
          title: input.title,
          body: input.body ?? null,
        },
      });
    }),
});
