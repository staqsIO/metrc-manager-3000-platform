import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, platformProcedure } from '@/lib/trpc';
import { getUserOrgIds } from '@/lib/auth-helpers';
import { dashboardPrisma } from '@/lib/prisma';

/**
 * Phase 2b — artifacts as first-class objects.
 *
 * Artifacts are saved findings produced by Copilot Runs. They live alongside
 * a Run in the same DB row but can be pinned (saved) and shared via stable
 * URL (`/copilot/a/[id]`). All operations stay strictly read/create on our
 * own DB — no Metrc writes. The "create" path is the run write-through that
 * already happens automatically when AGENT_RUNS_ENABLED is on.
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

export const artifactsRouter = createTRPCRouter({
  /** Fetch a single artifact + its current version. Org-scoped. */
  get: platformProcedure
    .input(z.object({ artifactId: z.string() }))
    .query(async ({ ctx, input }) => {
      const scopedOrgIds = await resolveScopedOrgIds(ctx);
      const artifact = await ctx.prisma.artifact.findFirst({
        where: { id: input.artifactId, organizationId: { in: scopedOrgIds } },
        include: {
          run: {
            select: {
              id: true, prompt: true, model: true, skillId: true, status: true,
              startedAt: true, completedAt: true, userId: true,
              scheduleSpec: true, facilityId: true,
            },
          },
          versions: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      if (!artifact) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Artifact not found' });
      }
      const currentVersion = artifact.versions.find(v => v.id === artifact.currentVersionId)
        ?? artifact.versions[0]
        ?? null;
      return { artifact, currentVersion, run: artifact.run };
    }),

  /** Toggle pinned state. Pinning is the user-visible "save this report" action. */
  setPinned: platformProcedure
    .input(z.object({ artifactId: z.string(), pinned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const scopedOrgIds = await resolveScopedOrgIds(ctx);
      const existing = await ctx.prisma.artifact.findFirst({
        where: { id: input.artifactId, organizationId: { in: scopedOrgIds } },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Artifact not found' });
      }
      return ctx.prisma.artifact.update({
        where: { id: input.artifactId },
        data: { pinnedAt: input.pinned ? new Date() : null },
        select: { id: true, pinnedAt: true },
      });
    }),

  /** List pinned artifacts for the active org. Drives the saved-reports rail. */
  listPinned: platformProcedure
    .input(z.object({
      facilityId: z.string().optional(),
      limit: z.number().min(1).max(100).default(25),
    }).optional())
    .query(async ({ ctx, input }) => {
      const scopedOrgIds = await resolveScopedOrgIds(ctx);
      const limit = input?.limit ?? 25;
      const artifacts = await ctx.prisma.artifact.findMany({
        where: {
          organizationId: { in: scopedOrgIds },
          pinnedAt: { not: null },
          ...(input?.facilityId ? { facilityId: input.facilityId } : {}),
        },
        orderBy: { pinnedAt: 'desc' },
        take: limit,
        include: {
          run: { select: { id: true, prompt: true, skillId: true } },
        },
      });
      return { artifacts };
    }),
});
