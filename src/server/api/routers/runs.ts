import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
import { createTRPCRouter, platformProcedure } from '@/lib/trpc';
import { getUserOrgIds } from '@/lib/auth-helpers';
import { dashboardPrisma } from '@/lib/prisma';

/**
 * Phase 1 — Runs router.
 *
 * Skeleton CRUD over the Run + Artifact + ArtifactVersion tables. No SSE
 * subscribe yet (Phase 1c will wire executeCopilotQuery to write through
 * here, and `/api/copilot/chat` keeps emitting tool events for now).
 *
 * Org scope:
 *   - All procedures resolve the user's accessible orgs via getUserOrgIds
 *     and scope to ctx.activeOrgId when set (matching cross-facility.ts).
 *   - All members of an org can read/list runs; only the run's userId can
 *     start one (create is implicit when executeCopilotQuery runs).
 */

async function resolveScopedOrgIds(ctx: {
  session: { user: { id: string } };
  activeOrgId: string | null;
}): Promise<string[]> {
  const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);
  if (orgIds.length === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No organization membership found' });
  }
  return ctx.activeOrgId && orgIds.includes(ctx.activeOrgId) ? [ctx.activeOrgId] : orgIds;
}

const RUN_STATUSES = ['pending', 'running', 'awaiting_user', 'completed', 'failed', 'scheduled'] as const;

export const runsRouter = createTRPCRouter({
  /**
   * Create a Run row in pending status. The executeCopilotQuery refactor in
   * Phase 1c will call this internally; exposed here so external callers
   * (cron worker, manual runs) can drop in once schedules ship.
   */
  create: platformProcedure
    .input(z.object({
      facilityId: z.string().nullable().optional(),
      skillId: z.string().max(100).nullable().optional(),
      prompt: z.string().min(1).max(2000),
      model: z.string().max(100).optional(),
      scheduleSpec: z.object({
        cron: z.string().max(100),
        triggerOn: z.enum(['change', 'always']).default('change'),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const scopedOrgIds = await resolveScopedOrgIds(ctx);
      const organizationId = scopedOrgIds[0];
      // Validate facility scope when provided
      if (input.facilityId) {
        const fac = await ctx.prisma.metrcFacility.findFirst({
          where: { id: input.facilityId, organizationId: { in: scopedOrgIds } },
          select: { id: true },
        });
        if (!fac) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Facility not in scope' });
        }
      }
      const run = await ctx.prisma.run.create({
        data: {
          organizationId,
          facilityId: input.facilityId ?? null,
          userId: ctx.session.user.id,
          skillId: input.skillId ?? null,
          status: input.scheduleSpec ? 'scheduled' : 'pending',
          prompt: input.prompt,
          model: input.model ?? null,
          scheduleSpec: input.scheduleSpec ?? undefined,
          iterations: [],
          toolsUsed: [],
        },
      });
      return run;
    }),

  /**
   * Fetch a Run plus its current artifact (and that artifact's most recent
   * version). 404s when not in scope so we don't leak existence.
   */
  get: platformProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      const scopedOrgIds = await resolveScopedOrgIds(ctx);
      const run = await ctx.prisma.run.findFirst({
        where: { id: input.runId, organizationId: { in: scopedOrgIds } },
        include: {
          artifacts: {
            include: {
              versions: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }
      const currentArtifact = run.artifacts.find(a => a.id === run.currentArtifactId)
        ?? run.artifacts[0]
        ?? null;
      return {
        run,
        currentArtifact,
        currentVersion: currentArtifact?.versions[0] ?? null,
      };
    }),

  /**
   * Paginated list scoped to the active org. Optional facility filter.
   * Returns runs sorted newest-first with their current-artifact summary.
   */
  list: platformProcedure
    .input(z.object({
      facilityId: z.string().optional(),
      status: z.enum(RUN_STATUSES).optional(),
      /** When true, only return runs with a non-null scheduleSpec (active subscriptions). */
      subscribedOnly: z.boolean().optional(),
      cursor: z.string().nullish(),
      limit: z.number().min(1).max(100).default(25),
    }).optional())
    .query(async ({ ctx, input }) => {
      const scopedOrgIds = await resolveScopedOrgIds(ctx);
      const limit = input?.limit ?? 25;
      const runs = await ctx.prisma.run.findMany({
        where: {
          organizationId: { in: scopedOrgIds },
          ...(input?.facilityId ? { facilityId: input.facilityId } : {}),
          ...(input?.status ? { status: input.status } : {}),
          ...(input?.subscribedOnly ? { scheduleSpec: { not: Prisma.JsonNull } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          organizationId: true,
          facilityId: true,
          userId: true,
          skillId: true,
          status: true,
          prompt: true,
          model: true,
          scheduleSpec: true,
          toolsUsed: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          currentArtifactId: true,
          errorMessage: true,
        },
      });
      let nextCursor: string | undefined;
      if (runs.length > limit) {
        nextCursor = runs.pop()!.id;
      }
      return { runs, nextCursor };
    }),

  /**
   * Mark a Run scheduled or unscheduled by writing/clearing scheduleSpec.
   * The cron worker (Phase 3) reads scheduleSpec to decide what to execute.
   */
  setSchedule: platformProcedure
    .input(z.object({
      runId: z.string(),
      scheduleSpec: z.object({
        cron: z.string().max(100),
        triggerOn: z.enum(['change', 'always']).default('change'),
      }).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const scopedOrgIds = await resolveScopedOrgIds(ctx);
      const existing = await ctx.prisma.run.findFirst({
        where: { id: input.runId, organizationId: { in: scopedOrgIds } },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }
      return ctx.prisma.run.update({
        where: { id: input.runId },
        data: {
          // null explicitly clears the JSONB; undefined leaves it untouched.
          scheduleSpec: input.scheduleSpec === null
            ? Prisma.JsonNull
            : (input.scheduleSpec as unknown as object),
          status: input.scheduleSpec ? 'scheduled' : 'completed',
        },
      });
    }),

  /**
   * Soft-delete by org scope: hard delete the Run + cascade to Artifacts
   * and ArtifactVersions. Used when the user explicitly removes a run from
   * their history. Notifications keep their own row but lose the click-through.
   */
  delete: platformProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const scopedOrgIds = await resolveScopedOrgIds(ctx);
      const existing = await ctx.prisma.run.findFirst({
        where: { id: input.runId, organizationId: { in: scopedOrgIds } },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }
      await ctx.prisma.run.delete({ where: { id: input.runId } });
      return { success: true };
    }),

  /**
   * Pin an artifact version as the run's current view. Lets users "save"
   * a particular finding from a multi-iteration run.
   */
  setCurrentArtifact: platformProcedure
    .input(z.object({ runId: z.string(), artifactId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const scopedOrgIds = await resolveScopedOrgIds(ctx);
      const run = await ctx.prisma.run.findFirst({
        where: { id: input.runId, organizationId: { in: scopedOrgIds } },
        select: { id: true },
      });
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      }
      const artifact = await ctx.prisma.artifact.findFirst({
        where: { id: input.artifactId, runId: input.runId },
        select: { id: true },
      });
      if (!artifact) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Artifact not found for this run' });
      }
      return ctx.prisma.run.update({
        where: { id: input.runId },
        data: { currentArtifactId: input.artifactId },
      });
    }),
});
